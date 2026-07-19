from datetime import UTC, datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import (
    Affiliation,
    AuthorPeriod,
    CareerStage,
    Institution,
    MembershipEvent,
    MemberStatus,
    Person,
    User,
)
from app.schemas.membership import (
    AffiliationCreate,
    AffiliationOut,
    AffiliationUpdate,
    AuthorPeriodCreate,
    AuthorPeriodOut,
    AuthorPeriodUpdate,
    MembershipEventOut,
    PersonApply,
    PersonOut,
    PersonSummary,
    PersonUpdate,
    StatusChange,
)
from app.security import get_current_user, is_office, require_office

router = APIRouter(prefix="/people", tags=["membership"])

# Fields a member may edit on their own profile.
SELF_EDITABLE = {"preferred_name", "email", "orcid", "career_stage"}


def _get_person(db: Session, person_id: int) -> Person:
    person = db.get(Person, person_id)
    if person is None:
        raise HTTPException(404, "Person not found")
    return person


@router.post("/apply", status_code=201)
def apply(body: PersonApply, db: Session = Depends(get_db)) -> PersonSummary:
    """Public membership application; creates a pending person record."""
    email = body.email.lower()
    if db.execute(select(Person).where(Person.email == email)).scalar_one_or_none():
        raise HTTPException(409, "A record with this email already exists — contact the office")
    if body.orcid and db.execute(
        select(Person).where(Person.orcid == body.orcid)
    ).scalar_one_or_none():
        raise HTTPException(409, "A record with this ORCID iD already exists — contact the office")

    person = Person(
        given_name=body.given_name,
        family_name=body.family_name,
        preferred_name=body.preferred_name,
        email=email,
        orcid=body.orcid,
        career_stage=body.career_stage,
        status=MemberStatus.pending,
        notes=body.notes,
    )
    db.add(person)
    db.flush()

    institution_id = body.institution_id
    if institution_id is None and body.institution_name:
        inst = Institution(name=body.institution_name, is_active=False)  # office reviews
        db.add(inst)
        db.flush()
        institution_id = inst.id
    if institution_id is not None:
        if db.get(Institution, institution_id) is None:
            raise HTTPException(404, "institution_id not found")
        db.add(
            Affiliation(
                person_id=person.id,
                institution_id=institution_id,
                is_primary=True,
                start_date=datetime.now(UTC).date(),
            )
        )
    db.add(MembershipEvent(person_id=person.id, from_status=None, to_status="pending"))
    db.commit()
    db.refresh(person)
    return PersonSummary.model_validate(person)


@router.get("")
def list_people(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    status: MemberStatus | None = None,
    career_stage: CareerStage | None = None,
    institution_id: int | None = None,
    working_group_id: int | None = None,
    q: str | None = Query(default=None, description="name/email search"),
) -> list[PersonSummary]:
    stmt = select(Person).order_by(Person.family_name, Person.given_name)
    if status is not None:
        stmt = stmt.where(Person.status == status)
    if career_stage is not None:
        stmt = stmt.where(Person.career_stage == career_stage)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Person.given_name.ilike(like),
                Person.family_name.ilike(like),
                Person.preferred_name.ilike(like),
                Person.email.ilike(like),
            )
        )
    if institution_id is not None:
        stmt = stmt.join(Affiliation).where(
            Affiliation.institution_id == institution_id,
            Affiliation.end_date.is_(None),
        )
    if working_group_id is not None:
        from app.models import WorkingGroupMember

        stmt = stmt.join(WorkingGroupMember).where(
            WorkingGroupMember.working_group_id == working_group_id
        )
    people = db.execute(stmt).scalars().unique().all()
    return [PersonSummary.model_validate(p) for p in people]


@router.get("/{person_id}")
def get_person(
    person_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> PersonOut:
    person = db.execute(
        select(Person)
        .options(
            selectinload(Person.affiliations).selectinload(Affiliation.institution),
            selectinload(Person.author_periods),
        )
        .where(Person.id == person_id)
    ).scalar_one_or_none()
    if person is None:
        raise HTTPException(404, "Person not found")
    return PersonOut.model_validate(person)


@router.patch("/{person_id}")
def update_person(
    person_id: int,
    body: PersonUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonOut:
    person = _get_person(db, person_id)
    changes = body.model_dump(exclude_unset=True)
    if not is_office(user):
        if user.person_id != person_id:
            raise HTTPException(403, "You can only edit your own profile")
        illegal = set(changes) - SELF_EDITABLE
        if illegal:
            raise HTTPException(403, f"Members cannot edit: {', '.join(sorted(illegal))}")
    if "email" in changes:
        existing = db.execute(
            select(Person).where(Person.email == changes["email"], Person.id != person_id)
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(409, "Email already in use")
    if changes.get("orcid"):
        existing = db.execute(
            select(Person).where(Person.orcid == changes["orcid"], Person.id != person_id)
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(409, "ORCID iD already in use")
    for field, value in changes.items():
        setattr(person, field, value)
    db.commit()
    return get_person(person_id, db, user)


@router.post("/{person_id}/status")
def change_status(
    person_id: int,
    body: StatusChange,
    db: Session = Depends(get_db),
    actor: User = Depends(require_office),
) -> PersonSummary:
    person = _get_person(db, person_id)
    if body.status == person.status:
        raise HTTPException(400, f"Person is already {person.status.value}")
    db.add(
        MembershipEvent(
            person_id=person.id,
            from_status=person.status.value,
            to_status=body.status.value,
            actor_user_id=actor.id,
            note=body.note,
        )
    )
    person.status = body.status
    person.status_changed_at = datetime.now(UTC)
    db.commit()
    db.refresh(person)
    return PersonSummary.model_validate(person)


@router.get("/{person_id}/events", dependencies=[Depends(require_office)])
def list_events(person_id: int, db: Session = Depends(get_db)) -> list[MembershipEventOut]:
    _get_person(db, person_id)
    events = (
        db.execute(
            select(MembershipEvent)
            .where(MembershipEvent.person_id == person_id)
            .order_by(MembershipEvent.created_at)
        )
        .scalars()
        .all()
    )
    return [MembershipEventOut.model_validate(e) for e in events]


# --- Affiliations (office) ----------------------------------------------------


@router.post("/{person_id}/affiliations", dependencies=[Depends(require_office)], status_code=201)
def add_affiliation(
    person_id: int, body: AffiliationCreate, db: Session = Depends(get_db)
) -> AffiliationOut:
    _get_person(db, person_id)
    if db.get(Institution, body.institution_id) is None:
        raise HTTPException(404, "institution_id not found")
    if body.is_primary and body.end_date is None:
        # Close any currently-open primary affiliation.
        open_primary = db.execute(
            select(Affiliation).where(
                Affiliation.person_id == person_id,
                Affiliation.is_primary.is_(True),
                Affiliation.end_date.is_(None),
            )
        ).scalar_one_or_none()
        if open_primary:
            open_primary.end_date = body.start_date
    affil = Affiliation(person_id=person_id, **body.model_dump())
    db.add(affil)
    db.commit()
    db.refresh(affil)
    return AffiliationOut.model_validate(affil)


@router.patch("/{person_id}/affiliations/{affiliation_id}", dependencies=[Depends(require_office)])
def update_affiliation(
    person_id: int,
    affiliation_id: int,
    body: AffiliationUpdate,
    db: Session = Depends(get_db),
) -> AffiliationOut:
    affil = db.get(Affiliation, affiliation_id)
    if affil is None or affil.person_id != person_id:
        raise HTTPException(404, "Affiliation not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(affil, field, value)
    db.commit()
    db.refresh(affil)
    return AffiliationOut.model_validate(affil)


@router.delete(
    "/{person_id}/affiliations/{affiliation_id}",
    dependencies=[Depends(require_office)],
    status_code=204,
)
def delete_affiliation(person_id: int, affiliation_id: int, db: Session = Depends(get_db)) -> None:
    affil = db.get(Affiliation, affiliation_id)
    if affil is None or affil.person_id != person_id:
        raise HTTPException(404, "Affiliation not found")
    db.delete(affil)
    db.commit()


# --- Author periods (office) ----------------------------------------------------


@router.get("/{person_id}/author-periods")
def list_author_periods(
    person_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[AuthorPeriodOut]:
    _get_person(db, person_id)
    periods = (
        db.execute(
            select(AuthorPeriod)
            .where(AuthorPeriod.person_id == person_id)
            .order_by(AuthorPeriod.start_date)
        )
        .scalars()
        .all()
    )
    return [AuthorPeriodOut.model_validate(p) for p in periods]


@router.post("/{person_id}/author-periods", dependencies=[Depends(require_office)], status_code=201)
def add_author_period(
    person_id: int, body: AuthorPeriodCreate, db: Session = Depends(get_db)
) -> AuthorPeriodOut:
    _get_person(db, person_id)
    period = AuthorPeriod(person_id=person_id, **body.model_dump())
    db.add(period)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(409, "Overlapping author period for this person")
    db.refresh(period)
    return AuthorPeriodOut.model_validate(period)


@router.patch(
    "/{person_id}/author-periods/{period_id}", dependencies=[Depends(require_office)]
)
def update_author_period(
    person_id: int, period_id: int, body: AuthorPeriodUpdate, db: Session = Depends(get_db)
) -> AuthorPeriodOut:
    period = db.get(AuthorPeriod, period_id)
    if period is None or period.person_id != person_id:
        raise HTTPException(404, "Author period not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(period, field, value)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(409, "Overlapping author period for this person")
    db.refresh(period)
    return AuthorPeriodOut.model_validate(period)


@router.delete(
    "/{person_id}/author-periods/{period_id}",
    dependencies=[Depends(require_office)],
    status_code=204,
)
def delete_author_period(person_id: int, period_id: int, db: Session = Depends(get_db)) -> None:
    period = db.get(AuthorPeriod, period_id)
    if period is None or period.person_id != person_id:
        raise HTTPException(404, "Author period not found")
    db.delete(period)
    db.commit()
