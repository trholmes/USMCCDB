"""Publication-workflow notification emails.

Each function *composes* a message — recipients, subject, body — as a
plain tuple, running any queries it needs on the caller's live session.
The caller hands the tuple to email.send_email via BackgroundTasks; the
composition must happen in-request because the DB session is closed by
the time background tasks run.
"""

from sqlalchemy import select

from app.config import get_settings
from app.models import (
    Person,
    Publication,
    PublicationPerson,
    PublicationPersonRole,
    User,
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
