"""Admin alerts: everything that currently needs an administrator's
attention, in one place. Each category is a live query — nothing is stored,
so an alert disappears the moment the underlying problem is fixed."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Affiliation,
    AuthorPeriod,
    CollabRole,
    CollabRoleType,
    Institution,
    MemberStatus,
    Person,
    User,
    UserRole,
)
from app.routers.people import STUDENT_STAGES
from app.routers.site import migration_state
from app.schemas.alerts import AccountAlert, AdminAlerts, InstitutionAlert, PersonAlert
from app.security import require_admin

router = APIRouter(prefix="/alerts", tags=["site"], dependencies=[Depends(require_admin)])

# A person's current institution: the one open primary affiliation.
OPEN_PRIMARY = (Affiliation.is_primary.is_(True), Affiliation.end_date.is_(None))


def _person_alert(p: Person, detail: str | None = None) -> PersonAlert:
    return PersonAlert(person_id=p.id, name=p.display_name, email=p.email, detail=detail)


def _pending_registrations(db: Session) -> list[PersonAlert]:
    people = (
        db.execute(
            select(Person)
            .where(Person.status == MemberStatus.pending)
            .order_by(Person.created_at)
        )
        .scalars()
        .all()
    )
    institution_of = dict(
        db.execute(
            select(Affiliation.person_id, Institution.name)
            .join(Institution, Institution.id == Affiliation.institution_id)
            .where(*OPEN_PRIMARY, Affiliation.person_id.in_([p.id for p in people]))
        ).all()
    )
    return [_person_alert(p, institution_of.get(p.id)) for p in people]


def _current_member_counts(db: Session) -> dict[int, int]:
    """Current people per institution: open primary affiliations of active
    members and pending registrants."""
    return dict(
        db.execute(
            select(Affiliation.institution_id, func.count())
            .join(Person, Person.id == Affiliation.person_id)
            .where(
                *OPEN_PRIMARY,
                Person.status.in_((MemberStatus.pending, MemberStatus.active)),
            )
            .group_by(Affiliation.institution_id)
        ).all()
    )


def _institutions_with_members(
    db: Session, member_counts: dict[int, int], active: bool
) -> list[Institution]:
    return (
        db.execute(
            select(Institution)
            .where(
                Institution.id.in_(member_counts.keys()),
                Institution.is_active.is_(active),
            )
            .order_by(Institution.name)
        )
        .scalars()
        .all()
    )


def _institution_alert(i: Institution, member_counts: dict[int, int]) -> InstitutionAlert:
    return InstitutionAlert(
        institution_id=i.id, name=i.name, current_members=member_counts[i.id]
    )


def _unreviewed_institutions(
    db: Session, member_counts: dict[int, int]
) -> list[InstitutionAlert]:
    """Inactive institutions that have people: free-text registrations create
    inactive entries for the office to review (activate, complete, or merge
    into an existing institution)."""
    return [
        _institution_alert(i, member_counts)
        for i in _institutions_with_members(db, member_counts, active=False)
    ]


def _institutions_missing_admin_contact(
    db: Session, member_counts: dict[int, int], today
) -> list[InstitutionAlert]:
    """Active institutions that currently have members (or pending
    registrants — their approval is exactly what the contact is for) but no
    active Administrative Institutional Contact."""
    covered = set(
        db.execute(
            select(CollabRole.institution_id).where(
                CollabRole.role == CollabRoleType.admin_contact,
                CollabRole.start_date <= today,
                (CollabRole.end_date.is_(None)) | (CollabRole.end_date >= today),
            )
        ).scalars()
    )
    return [
        _institution_alert(i, member_counts)
        for i in _institutions_with_members(db, member_counts, active=True)
        if i.id not in covered
    ]


def _unlinked_accounts(db: Session) -> list[AccountAlert]:
    """Active member-role sign-ins with no person record: someone signed in
    (typically via ORCID) but was never connected to the directory. Local
    admin/office service accounts are legitimately unlinked."""
    users = (
        db.execute(
            select(User)
            .where(
                User.is_active.is_(True),
                User.person_id.is_(None),
                User.role == UserRole.member,
            )
            .order_by(User.id)
        )
        .scalars()
        .all()
    )
    return [
        AccountAlert(user_id=u.id, login=u.username or u.orcid or f"#{u.id}") for u in users
    ]


def _active_without_affiliation(db: Session) -> list[PersonAlert]:
    """Active members with no current primary affiliation — invisible to
    author lists, voting eligibility, and their institution's admin contact."""
    has_open_primary = (
        select(Affiliation.id).where(Affiliation.person_id == Person.id, *OPEN_PRIMARY).exists()
    )
    people = (
        db.execute(
            select(Person)
            .where(Person.status == MemberStatus.active, ~has_open_primary)
            .order_by(Person.family_name, Person.given_name)
        )
        .scalars()
        .all()
    )
    return [_person_alert(p) for p in people]


def _ineligible_voting_members(db: Session) -> list[PersonAlert]:
    """Voting flags that have drifted out of eligibility (active, non-student,
    currently at a US institution). The rule is enforced when the involved
    fields change, but bulk imports or an institution's is_us flip can leave
    stale flags behind."""
    at_us_institution = set(
        db.execute(
            select(Affiliation.person_id)
            .join(Institution, Institution.id == Affiliation.institution_id)
            .where(*OPEN_PRIMARY, Institution.is_us.is_(True))
        ).scalars()
    )
    out = []
    for p in (
        db.execute(
            select(Person)
            .where(Person.is_voting.is_(True))
            .order_by(Person.family_name, Person.given_name)
        )
        .scalars()
        .all()
    ):
        reasons = []
        if p.status != MemberStatus.active:
            reasons.append(f"status is {p.status.value}")
        if p.career_stage in STUDENT_STAGES:
            reasons.append(f"career stage is {p.career_stage.value}")
        if p.id not in at_us_institution:
            reasons.append("not currently at a US institution")
        if reasons:
            out.append(_person_alert(p, "; ".join(reasons)))
    return out


def _open_author_periods_not_active(db: Session) -> list[PersonAlert]:
    """Open-ended authorship for people who are no longer active members.
    Authorship legitimately outlives membership for a while, but only with an
    end date — an open period keeps them on every future author list."""
    people = (
        db.execute(
            select(Person)
            .join(AuthorPeriod, AuthorPeriod.person_id == Person.id)
            .where(AuthorPeriod.end_date.is_(None), Person.status != MemberStatus.active)
            .distinct()
            .order_by(Person.family_name, Person.given_name)
        )
        .scalars()
        .all()
    )
    return [_person_alert(p, f"status is {p.status.value}") for p in people]


@router.get("")
def admin_alerts(db: Session = Depends(get_db)) -> AdminAlerts:
    today = datetime.now(UTC).date()
    _, _, migrations_pending = migration_state(db)
    member_counts = _current_member_counts(db)
    alerts = AdminAlerts(
        pending_registrations=_pending_registrations(db),
        unreviewed_institutions=_unreviewed_institutions(db, member_counts),
        institutions_missing_admin_contact=_institutions_missing_admin_contact(
            db, member_counts, today
        ),
        unlinked_accounts=_unlinked_accounts(db),
        active_without_affiliation=_active_without_affiliation(db),
        ineligible_voting_members=_ineligible_voting_members(db),
        open_author_periods_not_active=_open_author_periods_not_active(db),
        migrations_pending=migrations_pending,
        total=0,
    )
    alerts.total = (
        len(alerts.pending_registrations)
        + len(alerts.unreviewed_institutions)
        + len(alerts.institutions_missing_admin_contact)
        + len(alerts.unlinked_accounts)
        + len(alerts.active_without_affiliation)
        + len(alerts.ineligible_voting_members)
        + len(alerts.open_author_periods_not_active)
        + (1 if alerts.migrations_pending else 0)
    )
    return alerts
