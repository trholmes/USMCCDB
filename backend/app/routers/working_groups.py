from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import CollabRole, CollabRoleType, Person, User, WorkingGroup, WorkingGroupMember
from app.models.membership import DETAIL_REQUIRED_ROLES
from app.schemas.membership import (
    CollabRoleCreate,
    CollabRoleOut,
    CollabRoleUpdate,
    PersonSummary,
    WGMemberAdd,
    WorkingGroupCreate,
    WorkingGroupOut,
    WorkingGroupUpdate,
)
from app.security import get_current_user, is_convener_of, is_office, require_office

router = APIRouter(tags=["membership"])


def _wg_out(db: Session, wg: WorkingGroup) -> WorkingGroupOut:
    count = db.execute(
        select(func.count()).select_from(WorkingGroupMember).where(
            WorkingGroupMember.working_group_id == wg.id
        )
    ).scalar_one()
    out = WorkingGroupOut.model_validate(wg)
    out.member_count = count
    return out


@router.get("/working-groups")
def list_wgs(
    db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[WorkingGroupOut]:
    wgs = db.execute(select(WorkingGroup).order_by(WorkingGroup.name)).scalars().all()
    return [_wg_out(db, wg) for wg in wgs]


@router.post("/working-groups", dependencies=[Depends(require_office)], status_code=201)
def create_wg(body: WorkingGroupCreate, db: Session = Depends(get_db)) -> WorkingGroupOut:
    if db.execute(
        select(WorkingGroup).where(WorkingGroup.slug == body.slug)
    ).scalar_one_or_none():
        raise HTTPException(409, "slug already in use")
    wg = WorkingGroup(**body.model_dump())
    db.add(wg)
    db.commit()
    db.refresh(wg)
    return _wg_out(db, wg)


@router.patch("/working-groups/{wg_id}", dependencies=[Depends(require_office)])
def update_wg(wg_id: int, body: WorkingGroupUpdate, db: Session = Depends(get_db)) -> WorkingGroupOut:
    wg = db.get(WorkingGroup, wg_id)
    if wg is None:
        raise HTTPException(404, "Working group not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(wg, field, value)
    db.commit()
    db.refresh(wg)
    return _wg_out(db, wg)


@router.get("/working-groups/{wg_id}/members")
def list_wg_members(
    wg_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[PersonSummary]:
    wg = db.get(WorkingGroup, wg_id)
    if wg is None:
        raise HTTPException(404, "Working group not found")
    people = (
        db.execute(
            select(Person)
            .join(WorkingGroupMember, WorkingGroupMember.person_id == Person.id)
            .where(WorkingGroupMember.working_group_id == wg_id)
            .order_by(Person.family_name)
        )
        .scalars()
        .all()
    )
    return [PersonSummary.model_validate(p) for p in people]


@router.post("/working-groups/{wg_id}/members", status_code=201)
def add_wg_member(
    wg_id: int,
    body: WGMemberAdd,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonSummary:
    wg = db.get(WorkingGroup, wg_id)
    if wg is None:
        raise HTTPException(404, "Working group not found")
    person = db.get(Person, body.person_id)
    if person is None:
        raise HTTPException(404, "Person not found")
    # Members may join a WG themselves; adding others needs convener/office.
    if body.person_id != user.person_id and not (
        is_office(user) or is_convener_of(db, user, wg_id)
    ):
        raise HTTPException(403, "Only conveners or the office can add other people")
    exists = db.execute(
        select(WorkingGroupMember).where(
            WorkingGroupMember.working_group_id == wg_id,
            WorkingGroupMember.person_id == body.person_id,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Already a member of this working group")
    db.add(WorkingGroupMember(working_group_id=wg_id, person_id=body.person_id))
    db.commit()
    return PersonSummary.model_validate(person)


@router.delete("/working-groups/{wg_id}/members/{person_id}", status_code=204)
def remove_wg_member(
    wg_id: int,
    person_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    if person_id != user.person_id and not (
        is_office(user) or is_convener_of(db, user, wg_id)
    ):
        raise HTTPException(403, "Only conveners or the office can remove other people")
    membership = db.execute(
        select(WorkingGroupMember).where(
            WorkingGroupMember.working_group_id == wg_id,
            WorkingGroupMember.person_id == person_id,
        )
    ).scalar_one_or_none()
    if membership is None:
        raise HTTPException(404, "Not a member of this working group")
    db.delete(membership)
    db.commit()


# --- Collaboration roles (office) ---------------------------------------------


@router.get("/collab-roles")
def list_collab_roles(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    person_id: int | None = None,
    institution_id: int | None = None,
    role: CollabRoleType | None = None,
) -> list[CollabRoleOut]:
    stmt = (
        select(CollabRole)
        .options(
            selectinload(CollabRole.person),
            selectinload(CollabRole.working_group),
            selectinload(CollabRole.institution),
        )
        .order_by(CollabRole.start_date.desc(), CollabRole.id.desc())
    )
    if person_id is not None:
        stmt = stmt.where(CollabRole.person_id == person_id)
    if institution_id is not None:
        stmt = stmt.where(CollabRole.institution_id == institution_id)
    if role is not None:
        stmt = stmt.where(CollabRole.role == role)
    roles = db.execute(stmt).scalars().all()
    return [CollabRoleOut.model_validate(r) for r in roles]


@router.post("/collab-roles", dependencies=[Depends(require_office)], status_code=201)
def create_collab_role(body: CollabRoleCreate, db: Session = Depends(get_db)) -> CollabRoleOut:
    if db.get(Person, body.person_id) is None:
        raise HTTPException(404, "Person not found")
    if body.role.value == "convener" and body.working_group_id is None:
        raise HTTPException(422, "convener role requires working_group_id")
    if body.role.value in ("ib_rep", "admin_contact") and body.institution_id is None:
        raise HTTPException(422, f"{body.role.value} role requires institution_id")
    if body.role in DETAIL_REQUIRED_ROLES and body.detail is None:
        raise HTTPException(422, f"{body.role.value} role requires detail")
    role = CollabRole(**body.model_dump())
    db.add(role)
    db.commit()
    db.refresh(role)
    return CollabRoleOut.model_validate(role)


@router.patch("/collab-roles/{role_id}", dependencies=[Depends(require_office)])
def update_collab_role(
    role_id: int, body: CollabRoleUpdate, db: Session = Depends(get_db)
) -> CollabRoleOut:
    role = db.get(CollabRole, role_id)
    if role is None:
        raise HTTPException(404, "Role not found")
    updates = body.model_dump(exclude_unset=True)
    if (
        role.role in DETAIL_REQUIRED_ROLES
        and updates.get("detail", role.detail) is None
    ):
        raise HTTPException(422, f"{role.role.value} role requires detail")
    for field, value in updates.items():
        setattr(role, field, value)
    db.commit()
    db.refresh(role)
    return CollabRoleOut.model_validate(role)


@router.delete("/collab-roles/{role_id}", dependencies=[Depends(require_office)], status_code=204)
def delete_collab_role(role_id: int, db: Session = Depends(get_db)) -> None:
    role = db.get(CollabRole, role_id)
    if role is None:
        raise HTTPException(404, "Role not found")
    db.delete(role)
    db.commit()
