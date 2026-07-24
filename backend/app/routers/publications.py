from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import (
    Person,
    Publication,
    PublicationEvent,
    PublicationPerson,
    PublicationPersonRole,
    PublicationStatus,
    User,
    WorkingGroup,
)
from app.schemas.publications import (
    PubAcknowledgment,
    PublicationCreate,
    PublicationOut,
    PublicationPublic,
    PublicationUpdate,
    PubPersonAdd,
    PubPersonOut,
    PubStatusChange,
)
from app.security import (
    get_current_user,
    get_optional_user,
    is_convener_of,
    is_office,
)
from app.services import notifications
from app.services.email import send_email

router = APIRouter(prefix="/publications", tags=["publications"])


def _load_pub(db: Session, pub_id: int) -> Publication:
    pub = db.execute(
        select(Publication)
        .options(selectinload(Publication.people).selectinload(PublicationPerson.person))
        .where(Publication.id == pub_id)
    ).scalar_one_or_none()
    if pub is None:
        raise HTTPException(404, "Publication not found")
    return pub


def _is_editor(db: Session, user: User, pub_id: int) -> bool:
    if user.person_id is None:
        return False
    row = db.execute(
        select(PublicationPerson.id).where(
            PublicationPerson.publication_id == pub_id,
            PublicationPerson.person_id == user.person_id,
            PublicationPerson.role == PublicationPersonRole.editor,
        )
    ).first()
    return row is not None


def _next_short_code(db: Session, pub_type: str) -> str:
    year = datetime.now(UTC).year
    prefix = f"USMCC-{pub_type.upper().replace('_', '')[:4]}-{year}-"
    count = db.execute(
        select(func.count()).select_from(Publication).where(
            Publication.short_code.like(f"{prefix}%")
        )
    ).scalar_one()
    return f"{prefix}{count + 1:03d}"


@router.get("/public")
def list_public(db: Session = Depends(get_db)) -> list[PublicationPublic]:
    """Anonymous view: published items only, minimal fields."""
    pubs = (
        db.execute(
            select(Publication)
            .where(Publication.status == PublicationStatus.published)
            .order_by(Publication.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [PublicationPublic.model_validate(p) for p in pubs]


@router.get("")
def list_publications(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    status: PublicationStatus | None = None,
    working_group_id: int | None = None,
) -> list[PublicationOut]:
    stmt = (
        select(Publication)
        .options(selectinload(Publication.people).selectinload(PublicationPerson.person))
        .order_by(Publication.created_at.desc())
    )
    if status is not None:
        stmt = stmt.where(Publication.status == status)
    if working_group_id is not None:
        stmt = stmt.where(Publication.working_group_id == working_group_id)
    pubs = db.execute(stmt).scalars().unique().all()
    return [PublicationOut.model_validate(p) for p in pubs]


@router.get("/{pub_id}")
def get_publication(
    pub_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> PublicationOut:
    return PublicationOut.model_validate(_load_pub(db, pub_id))


@router.post("", status_code=201)
def create_publication(
    body: PublicationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublicationOut:
    """Any signed-in user may register a publication; the creator becomes an editor."""
    if body.working_group_id is not None and db.get(WorkingGroup, body.working_group_id) is None:
        raise HTTPException(404, "working_group_id not found")
    pub = Publication(**body.model_dump())
    pub.short_code = _next_short_code(db, body.pub_type.value)
    db.add(pub)
    db.flush()
    if user.person_id is not None:
        db.add(
            PublicationPerson(
                publication_id=pub.id,
                person_id=user.person_id,
                role=PublicationPersonRole.editor,
            )
        )
    db.add(
        PublicationEvent(
            publication_id=pub.id, from_status=None, to_status="in_progress", actor_user_id=user.id
        )
    )
    db.commit()
    return PublicationOut.model_validate(_load_pub(db, pub.id))


@router.patch("/{pub_id}")
def update_publication(
    pub_id: int,
    body: PublicationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublicationOut:
    pub = db.get(Publication, pub_id)
    if pub is None:
        raise HTTPException(404, "Publication not found")
    if not (
        is_office(user)
        or _is_editor(db, user, pub_id)
        or is_convener_of(db, user, pub.working_group_id)
    ):
        raise HTTPException(403, "Only editors, conveners, or the office can edit")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(pub, field, value)
    db.commit()
    return PublicationOut.model_validate(_load_pub(db, pub_id))


@router.post("/{pub_id}/status")
def change_status(
    pub_id: int,
    body: PubStatusChange,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublicationOut:
    pub = db.get(Publication, pub_id)
    if pub is None:
        raise HTTPException(404, "Publication not found")
    if not is_office(user):
        # Editors and WG conveners may request collaboration review; everything
        # else (submitted, published, moving backwards) stays with the office.
        allowed = (
            (_is_editor(db, user, pub_id) or is_convener_of(db, user, pub.working_group_id))
            and pub.status == PublicationStatus.in_progress
            and body.status == PublicationStatus.collab_review
        )
        if not allowed:
            raise HTTPException(403, "Only the office can make this transition")
    if body.status == pub.status:
        raise HTTPException(400, f"Publication is already {pub.status.value}")
    from_status = pub.status.value
    db.add(
        PublicationEvent(
            publication_id=pub.id,
            from_status=from_status,
            to_status=body.status.value,
            actor_user_id=user.id,
            note=body.note,
        )
    )
    pub.status = body.status
    db.commit()
    # Compose emails now (the session closes before background tasks run),
    # deliver after the response.
    for msg in (
        notifications.review_requested(db, pub, user)
        if body.status == PublicationStatus.collab_review
        else None,
        notifications.status_changed(db, pub, from_status, body.status.value, user),
    ):
        if msg is not None:
            background.add_task(send_email, *msg)
    return PublicationOut.model_validate(_load_pub(db, pub_id))


def _can_manage_people(db: Session, user: User, pub: Publication) -> bool:
    return (
        is_office(user)
        or _is_editor(db, user, pub.id)
        or is_convener_of(db, user, pub.working_group_id)
    )


@router.post("/{pub_id}/people", status_code=201)
def add_person(
    pub_id: int,
    body: PubPersonAdd,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PubPersonOut:
    pub = db.get(Publication, pub_id)
    if pub is None:
        raise HTTPException(404, "Publication not found")
    if not _can_manage_people(db, user, pub):
        raise HTTPException(403, "Only editors, conveners, or the office can add people")
    if body.role == PublicationPersonRole.reviewer and not is_office(user):
        raise HTTPException(403, "Only the office can assign reviewers")
    person = db.get(Person, body.person_id)
    if person is None:
        raise HTTPException(404, "Person not found")
    exists = db.execute(
        select(PublicationPerson).where(
            PublicationPerson.publication_id == pub_id,
            PublicationPerson.person_id == body.person_id,
            PublicationPerson.role == body.role,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Person already has this role on the publication")
    pp = PublicationPerson(publication_id=pub_id, person_id=body.person_id, role=body.role)
    db.add(pp)
    db.commit()
    db.refresh(pp)
    if body.role == PublicationPersonRole.reviewer:
        msg = notifications.reviewer_assigned(db, pub, person, user)
        if msg is not None:
            background.add_task(send_email, *msg)
    return PubPersonOut.model_validate(pp)


@router.delete("/{pub_id}/people/{pp_id}", status_code=204)
def remove_person(
    pub_id: int,
    pp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    pp = db.get(PublicationPerson, pp_id)
    if pp is None or pp.publication_id != pub_id:
        raise HTTPException(404, "Assignment not found")
    pub = db.get(Publication, pub_id)
    if not _can_manage_people(db, user, pub):
        raise HTTPException(403, "Only editors, conveners, or the office can remove people")
    if pp.role == PublicationPersonRole.reviewer and not is_office(user):
        raise HTTPException(403, "Only the office can remove reviewers")
    db.delete(pp)
    db.commit()


@router.get("/{pub_id}/acknowledgment")
def acknowledgment(
    pub_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> PubAcknowledgment:
    """Suggested acknowledgment text crediting USMCC and the assigned reviewers."""
    pub = _load_pub(db, pub_id)
    reviewers = [
        f"{pp.person.given_name} {pp.person.family_name}"
        for pp in pub.people
        if pp.role == PublicationPersonRole.reviewer
    ]
    text = (
        "We thank our colleagues in the US Muon Collider Collaboration for "
        "their support of this work and for valuable discussions."
    )
    if reviewers:
        if len(reviewers) == 1:
            names = reviewers[0]
        else:
            names = ", ".join(reviewers[:-1]) + " and " + reviewers[-1]
        text += (
            f" We are grateful to {names} for their careful review of this "
            "manuscript on behalf of the collaboration."
        )
    else:
        text += (
            " We are grateful to the collaboration's internal reviewers for "
            "their careful review of this manuscript."
        )
    return PubAcknowledgment(text=text, reviewers=reviewers)
