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


def _contact_emails(db, pub: Publication, exclude_person_id: int | None = None) -> list[str]:
    stmt = (
        select(Person.email)
        .join(PublicationPerson, PublicationPerson.person_id == Person.id)
        .where(
            PublicationPerson.publication_id == pub.id,
            PublicationPerson.role == PublicationPersonRole.contact,
        )
    )
    if exclude_person_id is not None:
        stmt = stmt.where(Person.id != exclude_person_id)
    return [e for e in db.execute(stmt).scalars() if e]


def _office_recipients(db) -> set[str]:
    """The collaboration contact address plus every active office/admin
    account with an email on file."""
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
    return recipients


def registration_submitted(db, person: Person) -> Message | None:
    """Ask everyone who can approve a new registration to review it: office
    and admin accounts, the Administrative Institutional Contacts of the
    registrant's institution, and the collaboration contact address."""
    settings = get_settings()
    recipients = _office_recipients(db)

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

    recipients.discard(person.email)  # registrants don't review themselves
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


def registration_duplicate(
    db, existing: Person, submitted_name: str, submitted_email: str
) -> Message | None:
    """Tell the office a public registration matched an existing member
    record. The submitter got the same neutral acknowledgement as everyone
    else — confirming the match to them would let anyone probe which emails
    belong to collaboration members (issue #62) — so the office has to
    follow up by hand."""
    to = [addr for addr in _office_recipients(db) if addr]
    if not to:
        return None

    lines = [
        f"A membership registration was submitted for {submitted_name} "
        "but matched an existing record, so no new record was created.",
        "",
        f"Submitted email: {submitted_email}",
        f"Existing record: {existing.display_name}",
    ]
    site = get_settings().site_url
    if site:
        lines.append(f"{site.rstrip('/')}/people/{existing.id}")
    lines += [
        "",
        "The submitter was told the registration is pending review and was "
        "NOT told about the existing record. If this is the same person, "
        "please contact them directly.",
    ]
    return (to, f"Duplicate membership registration: {submitted_name}", "\n".join(lines))


def orcid_link_conflict(db, existing: Person, created: Person, orcid_id: str) -> Message | None:
    """Tell the office an authenticated ORCID sign-in matched a directory
    record it could not be linked to safely: the record's login already
    carries a different ORCID iD, or it holds a role above member that a
    directory match alone must not open. The sign-in was given a fresh
    pending registration instead; the office reconciles the two records."""
    to = [addr for addr in _office_recipients(db) if addr]
    if not to:
        return None

    site = get_settings().site_url
    lines = [
        f"Someone signed in with ORCID iD {orcid_id}, which is on the "
        f"directory record of {existing.display_name}, but that record's "
        "login could not take the link automatically (it already carries a "
        "different ORCID iD, or it holds a role above member).",
        "",
        f"Existing record: {existing.display_name}",
    ]
    if site:
        lines.append(f"{site.rstrip('/')}/people/{existing.id}")
    lines += ["", f"New pending registration created for the sign-in: {created.display_name}"]
    if site:
        lines.append(f"{site.rstrip('/')}/people/{created.id}")
    lines += [
        "",
        "The new registration stays pending with no access. If the sign-in "
        "really is the person on the existing record, fix that record's "
        "login (or remove the stale iD) and reject the new registration; "
        "if not, the existing record is carrying someone else's ORCID iD.",
    ]
    return (to, f"ORCID sign-in needs review: {orcid_id}", "\n".join(lines))


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
    """Tell a paper's contacts (minus the actor) its status moved."""
    recipients = _contact_emails(db, pub, exclude_person_id=actor.person_id)
    if not recipients:
        return None
    body = (
        f"{_pub_line(pub)}\n\n"
        f"Status changed from {from_status.replace('_', ' ')} to "
        f"{to_status.replace('_', ' ')} by {_actor_name(db, actor)}."
    )
    return (recipients, f"Publication status update: {pub.title}", body)
