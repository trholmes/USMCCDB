import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Affiliation, Institution, Person, User
from app.schemas.membership import (
    InstitutionCreate,
    InstitutionOut,
    InstitutionPublic,
    InstitutionUpdate,
)
from app.security import get_current_user, require_office

router = APIRouter(prefix="/institutions", tags=["membership"])


def _normalized_name(name: str) -> str:
    """Case/punctuation/whitespace-insensitive form for duplicate detection
    ("M.I.T." and "mit" collide, "MIT" vs "MIT Lincoln Laboratory" don't)."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _find_similar(db: Session, name: str, exclude_id: int | None = None) -> Institution | None:
    normalized = _normalized_name(name)
    for inst in db.execute(select(Institution)).scalars():
        if inst.id == exclude_id:
            continue
        if _normalized_name(inst.name) == normalized or (
            inst.short_name and _normalized_name(inst.short_name) == normalized
        ):
            return inst
    return None


def _check_ror_conflict(db: Session, ror_id: str | None, exclude_id: int | None = None) -> None:
    if ror_id is None:
        return
    other = db.execute(
        select(Institution).where(Institution.ror_id == ror_id)
    ).scalar_one_or_none()
    if other is not None and other.id != exclude_id:
        raise HTTPException(409, f"ROR id {ror_id} already belongs to '{other.name}'")


def _people_counts(db: Session, institution_id: int | None = None) -> dict[int, int]:
    """Currently affiliated people (open affiliations) per institution,
    matching what GET /people?institution_id= lists on the detail page."""
    stmt = (
        select(Affiliation.institution_id, func.count(func.distinct(Affiliation.person_id)))
        .where(Affiliation.end_date.is_(None))
        .group_by(Affiliation.institution_id)
    )
    if institution_id is not None:
        stmt = stmt.where(Affiliation.institution_id == institution_id)
    return dict(db.execute(stmt).all())


@router.get("")
def list_institutions(
    db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[InstitutionOut]:
    rows = db.execute(select(Institution).order_by(Institution.name)).scalars().all()
    counts = _people_counts(db)
    out = []
    for i in rows:
        item = InstitutionOut.model_validate(i)
        item.people_count = counts.get(i.id, 0)
        out.append(item)
    return out


# Declared before /{institution_id} so "public" isn't parsed as an id.
@router.get("/public")
def list_institutions_public(db: Session = Depends(get_db)) -> list[InstitutionPublic]:
    """Unauthenticated, minimal list feeding the registration form's
    institution autocomplete — picking an existing entry avoids the free-text
    duplicates the office otherwise has to clean up (issues #93/#105)."""
    rows = (
        db.execute(
            select(Institution)
            .where(Institution.is_active.is_(True))
            .order_by(Institution.name)
        )
        .scalars()
        .all()
    )
    return [InstitutionPublic.model_validate(i) for i in rows]


@router.get("/{institution_id}")
def get_institution(
    institution_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> InstitutionOut:
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise HTTPException(404, "Institution not found")
    item = InstitutionOut.model_validate(inst)
    item.people_count = _people_counts(db, institution_id).get(institution_id, 0)
    return item


@router.post("", dependencies=[Depends(require_office)], status_code=201)
def create_institution(body: InstitutionCreate, db: Session = Depends(get_db)) -> InstitutionOut:
    if body.short_name and db.execute(
        select(Institution).where(Institution.short_name == body.short_name)
    ).scalar_one_or_none():
        raise HTTPException(409, "short_name already in use")
    _check_ror_conflict(db, body.ror_id)
    if not body.allow_similar:
        similar = _find_similar(db, body.name)
        if similar is not None:
            raise HTTPException(
                409,
                f"Similar institution already exists: '{similar.name}'"
                f"{f' ({similar.short_name})' if similar.short_name else ''} — "
                "resubmit with allow_similar to create anyway",
            )
    inst = Institution(**body.model_dump(exclude={"allow_similar"}))
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return InstitutionOut.model_validate(inst)


@router.patch("/{institution_id}", dependencies=[Depends(require_office)])
def update_institution(
    institution_id: int, body: InstitutionUpdate, db: Session = Depends(get_db)
) -> InstitutionOut:
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise HTTPException(404, "Institution not found")
    changes = body.model_dump(exclude_unset=True)
    if "ror_id" in changes:
        _check_ror_conflict(db, changes["ror_id"], exclude_id=institution_id)
    for field, value in changes.items():
        setattr(inst, field, value)
    # Reclassifying an institution as non-US ends voting eligibility for the
    # people currently there — clear their flags, like a status change does.
    if changes.get("is_us") is False:
        members = (
            db.execute(
                select(Person)
                .join(Affiliation, Affiliation.person_id == Person.id)
                .where(
                    Affiliation.institution_id == institution_id,
                    Affiliation.is_primary.is_(True),
                    Affiliation.end_date.is_(None),
                    Person.is_voting.is_(True),
                )
            )
            .scalars()
            .all()
        )
        for person in members:
            person.is_voting = False
    db.commit()
    db.refresh(inst)
    return InstitutionOut.model_validate(inst)


@router.delete("/{institution_id}", dependencies=[Depends(require_office)], status_code=204)
def delete_institution(institution_id: int, db: Session = Depends(get_db)) -> None:
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise HTTPException(404, "Institution not found")
    if inst.affiliations:
        raise HTTPException(409, "Institution has affiliations — mark inactive instead")
    db.delete(inst)
    db.commit()
