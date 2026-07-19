from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
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
    require_office,
)

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
    if not (is_office(user) or is_convener_of(db, user, body.working_group_id)):
        raise HTTPException(403, "Only conveners or the office can propose publications")
    if body.working_group_id is not None and db.get(WorkingGroup, body.working_group_id) is None:
        raise HTTPException(404, "working_group_id not found")
    pub = Publication(**body.model_dump())
    pub.short_code = _next_short_code(db, body.pub_type.value)
    db.add(pub)
    db.flush()
    db.add(
        PublicationEvent(
            publication_id=pub.id, from_status=None, to_status="proposed", actor_user_id=user.id
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
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublicationOut:
    pub = db.get(Publication, pub_id)
    if pub is None:
        raise HTTPException(404, "Publication not found")
    if not is_office(user):
        # Conveners may only advance proposed → in_progress within their WG.
        allowed = (
            is_convener_of(db, user, pub.working_group_id)
            and pub.status == PublicationStatus.proposed
            and body.status == PublicationStatus.in_progress
        )
        if not allowed:
            raise HTTPException(403, "Only the office can make this transition")
    if body.status == pub.status:
        raise HTTPException(400, f"Publication is already {pub.status.value}")
    db.add(
        PublicationEvent(
            publication_id=pub.id,
            from_status=pub.status.value,
            to_status=body.status.value,
            actor_user_id=user.id,
            note=body.note,
        )
    )
    pub.status = body.status
    db.commit()
    return PublicationOut.model_validate(_load_pub(db, pub_id))


@router.post("/{pub_id}/people", dependencies=[Depends(require_office)], status_code=201)
def add_person(pub_id: int, body: PubPersonAdd, db: Session = Depends(get_db)) -> PubPersonOut:
    if db.get(Publication, pub_id) is None:
        raise HTTPException(404, "Publication not found")
    if db.get(Person, body.person_id) is None:
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
    return PubPersonOut.model_validate(pp)


@router.delete("/{pub_id}/people/{pp_id}", dependencies=[Depends(require_office)], status_code=204)
def remove_person(pub_id: int, pp_id: int, db: Session = Depends(get_db)) -> None:
    pp = db.get(PublicationPerson, pp_id)
    if pp is None or pp.publication_id != pub_id:
        raise HTTPException(404, "Assignment not found")
    db.delete(pp)
    db.commit()
