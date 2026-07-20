from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Institution, User
from app.schemas.membership import InstitutionCreate, InstitutionOut, InstitutionUpdate
from app.security import get_current_user, require_office

router = APIRouter(prefix="/institutions", tags=["membership"])


@router.get("")
def list_institutions(
    db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[InstitutionOut]:
    rows = db.execute(select(Institution).order_by(Institution.name)).scalars().all()
    return [InstitutionOut.model_validate(i) for i in rows]


@router.get("/{institution_id}")
def get_institution(
    institution_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> InstitutionOut:
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise HTTPException(404, "Institution not found")
    return InstitutionOut.model_validate(inst)


@router.post("", dependencies=[Depends(require_office)], status_code=201)
def create_institution(body: InstitutionCreate, db: Session = Depends(get_db)) -> InstitutionOut:
    if body.short_name and db.execute(
        select(Institution).where(Institution.short_name == body.short_name)
    ).scalar_one_or_none():
        raise HTTPException(409, "short_name already in use")
    inst = Institution(**body.model_dump())
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
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(inst, field, value)
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
