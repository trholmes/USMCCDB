"""Workflow notification emails (membership and publications).

Each function *composes* a message — recipients, subject, body — as a
plain tuple, running any queries it needs on the caller's live session.
The caller hands the tuple to email.send_email via BackgroundTasks; the
composition must happen in-request because the DB session is closed by
the time background tasks run.
"""

from datetime import UTC, datetime

from sqlalchemy import select

from app.config import get_settings
from app.models import (
    Affiliation,
    CollabRole,
    CollabRoleType,
    Person,
    Publication,
    PublicationPerson,
    PublicationPersonRole,
    User,
    UserRole,
)

Message = tuple[list[str], str, str]


def _actor_name(db, user: User) -> str:
    if user.person_id is not None:
        person = db.get(Person, user.person_id)
        if person is not None:
            return f"{person.given_name} {person.family_name}"
    return user.username or "an office account"


def _pub_line(pub: Publication) -> str:
    code = f" ({pub.short_code})" if pub.short_code else ""
    line = f'"{pub.title}"{code}'
    site = get_settings().site_url
    if site:
        line += f"\n{site.rstrip('/')}/publications/{pub.id}"
    return line


def _editor_emails(db, pub: Publication, exclude_person_id: int | None = None) -> list[str]:
    stmt = (
        select(Person.email)
        .join(PublicationPerson, PublicationPerson.person_id == Person.id)
        .where(
            PublicationPerson.publication_id == pub.id,
            PublicationPerson.role == PublicationPersonRole.editor,
        )
    )
    if exclude_person_id is not None:
        stmt = stmt.where(Person.id != exclude_person_id)
    return [e for e in db.execute(stmt).scalars() if e]


def registration_submitted(db, person: Person) -> Message | None:
    """Ask everyone who can approve a new registration to review it: office
    and admin accounts, the Administrative Institutional Contacts of the
    applicant's institution, and the collaboration contact address."""
    recipients: set[str] = set()
    settings = get_settings()
    if settings.contact_email:
        recipients.add(settings.contact_email)
    recipients.update(
        db.execute(
            select(Person.email)
            .join(User, User.person_id == Person.id)
            .where(
                User.role.in_((UserRole.admin, UserRole.office)),
                User.is_active.is_(True),
            )
        ).scalars()
    )

    affil = db.execute(
        select(Affiliation).where(
            Affiliation.person_id == person.id,
            Affiliation.is_primary.is_(True),
            Affiliation.end_date.is_(None),
        )
    ).scalar_one_or_none()
    institution = affil.institution if affil is not None else None
    if institution is not None:
        today = datetime.now(UTC).date()
        recipients.update(
            db.execute(
                select(Person.email)
                .join(CollabRole, CollabRole.person_id == Person.id)
                .where(
                    CollabRole.role == CollabRoleType.admin_contact,
                    CollabRole.institution_id == institution.id,
                    CollabRole.start_date <= today,
                    (CollabRole.end_date.is_(None)) | (CollabRole.end_date >= today),
                )
            ).scalars()
        )

    recipients.discard(person.email)  # applicants don't review themselves
    to = [addr for addr in recipients if addr]
    if not to:
        return None

    lines = [
        f"{person.display_name} has registered to join the "
        "US Muon Collider Collaboration.",
        "",
        f"Email: {person.email}",
    ]
    if person.orcid:
        lines.append(f"ORCID iD: {person.orcid}")
    if institution is not None:
        lines.append(f"Institution: {institution.name}")
    lines.append(f"Position: {person.career_stage.value}")
    if settings.site_url:
        lines += ["", f"{settings.site_url.rstrip('/')}/people/{person.id}"]
    lines += [
        "",
        "The registration stays pending — with no access to the database — "
        "until the office or the institution's administrative contact "
        "approves it.",
    ]
    return (to, f"New membership registration: {person.display_name}", "\n".join(lines))


def review_requested(db, pub: Publication, actor: User) -> Message | None:
    """Tell the office a paper is ready for collaboration review."""
    office = get_settings().contact_email
    if not office:
        return None
    body = (
        f"{_actor_name(db, actor)} has requested collaboration review for\n"
        f"{_pub_line(pub)}\n\n"
        "Please assign reviewers and move it along the workflow."
    )
    return ([office], f"Collaboration review requested: {pub.title}", body)


def reviewer_assigned(db, pub: Publication, reviewer: Person, actor: User) -> Message | None:
    """Tell a person they have been asked to review a paper."""
    if not reviewer.email:
        return None
    body = (
        f"Dear {reviewer.given_name},\n\n"
        f"{_actor_name(db, actor)} has assigned you as a collaboration reviewer for\n"
        f"{_pub_line(pub)}\n\n"
        "Thank you for reviewing on behalf of the US Muon Collider Collaboration."
    )
    return ([reviewer.email], f"Review request: {pub.title}", body)


def status_changed(
    db, pub: Publication, from_status: str, to_status: str, actor: User
) -> Message | None:
    """Tell a paper's editors (minus the actor) its status moved."""
    recipients = _editor_emails(db, pub, exclude_person_id=actor.person_id)
    if not recipients:
        return None
    body = (
        f"{_pub_line(pub)}\n\n"
        f"Status changed from {from_status.replace('_', ' ')} to "
        f"{to_status.replace('_', ' ')} by {_actor_name(db, actor)}."
    )
    return (recipients, f"Publication status update: {pub.title}", body)
