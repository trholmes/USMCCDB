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
from app.models.auth import ROLE_RANK
from app.routers.people import STUDENT_STAGES
from app.routers.site import migration_state
from app.schemas.alerts import (
    AccountAlert,
    AdminAlerts,
    InstitutionAlert,
    PersonAlert,
    RoleSuggestionAlert,
)
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


# Leadership positions that come with database permissions (issue #167) and
# the account role each one calls for. Positions never grant the role by
# themselves — an admin applies (or declines) the suggestion.
ROLE_FOR_POSITION = {
    CollabRoleType.chair: UserRole.admin,
    CollabRoleType.vice_chair: UserRole.admin,
    CollabRoleType.representative: UserRole.leadership,
    CollabRoleType.deputy_representative: UserRole.leadership,
    CollabRoleType.speakers_comm: UserRole.speakers,
}
# Roles that exist only because of such a position: an account still holding
# one after the position ended is flagged for demotion. Admin and office are
# not — they are also given for other reasons (site administration, the
# collaboration office).
POSITION_ONLY_ROLES = (UserRole.leadership, UserRole.speakers)


def _position_title(role: CollabRole) -> str:
    if role.role == CollabRoleType.representative:
        return f"{role.detail} Representative"
    if role.role == CollabRoleType.deputy_representative:
        return f"Deputy {role.detail} Representative"
    return {
        CollabRoleType.chair: "Chair",
        CollabRoleType.vice_chair: "Vice Chair",
        CollabRoleType.speakers_comm: "Speakers Committee",
    }.get(role.role, role.detail or role.role.value)


def _role_suggestions(db: Session, today) -> list[RoleSuggestionAlert]:
    """Accounts whose role is below what an active leadership position calls
    for (a representative signed in but is still a plain member), and
    position-only roles whose position has ended. Only people who have a
    sign-in are listed — the suggestion is about the account, and there is
    nothing to apply before their first login."""
    positions = (
        db.execute(
            select(CollabRole, User)
            .join(User, User.person_id == CollabRole.person_id)
            .where(
                User.is_active.is_(True),
                CollabRole.role.in_(ROLE_FOR_POSITION.keys()),
                CollabRole.start_date <= today,
                (CollabRole.end_date.is_(None)) | (CollabRole.end_date >= today),
            )
            .order_by(CollabRole.start_date, CollabRole.id)
        )
        .all()
    )
    active_by_user: dict[int, tuple[User, list[CollabRole]]] = {}
    for position, user in positions:
        active_by_user.setdefault(user.id, (user, []))[1].append(position)

    out: list[RoleSuggestionAlert] = []

    def suggest(user: User, suggested: UserRole, detail: str) -> None:
        person = db.get(Person, user.person_id)
        out.append(
            RoleSuggestionAlert(
                user_id=user.id,
                login=user.username or user.orcid or f"#{user.id}",
                person_id=user.person_id,
                name=person.display_name if person else f"#{user.person_id}",
                current_role=user.role.value,
                suggested_role=suggested.value,
                detail=detail,
            )
        )

    for user, held in active_by_user.values():
        warranted = max((ROLE_FOR_POSITION[p.role] for p in held), key=ROLE_RANK.__getitem__)
        titles = ", ".join(_position_title(p) for p in held)
        if ROLE_RANK[warranted] > ROLE_RANK[user.role]:
            suggest(user, warranted, titles)
        elif user.role in POSITION_ONLY_ROLES and ROLE_RANK[warranted] < ROLE_RANK[user.role]:
            suggest(user, warranted, f"current position: {titles}")

    # Position-only roles with no active qualifying position at all.
    stale = (
        db.execute(
            select(User)
            .where(
                User.is_active.is_(True),
                User.role.in_(POSITION_ONLY_ROLES),
                User.person_id.isnot(None),
                User.id.notin_(active_by_user.keys()),
            )
            .order_by(User.id)
        )
        .scalars()
        .all()
    )
    for user in stale:
        last = db.execute(
            select(CollabRole)
            .where(
                CollabRole.person_id == user.person_id,
                CollabRole.role.in_(ROLE_FOR_POSITION.keys()),
                CollabRole.end_date.isnot(None),
                CollabRole.end_date < today,
            )
            .order_by(CollabRole.end_date.desc(), CollabRole.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        detail = (
            f"{_position_title(last)} ended {last.end_date.isoformat()}"
            if last is not None
            else "no active leadership position"
        )
        suggest(user, UserRole.member, detail)
    return out


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
        role_suggestions=_role_suggestions(db, today),
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
        + len(alerts.role_suggestions)
        + len(alerts.active_without_affiliation)
        + len(alerts.ineligible_voting_members)
        + len(alerts.open_author_periods_not_active)
        + (1 if alerts.migrations_pending else 0)
    )
    return alerts
