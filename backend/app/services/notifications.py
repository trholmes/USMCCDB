"""Workflow notification emails — who gets told about what.

Each `notify_*` function *composes* a Message (recipients, subject, body,
plus log bookkeeping) running any queries it needs on the caller's live
session, and returns None when there is nobody to tell. The caller hands it
to `queue`, which schedules email.send_email as a BackgroundTask; the
composition must happen in-request because the DB session is closed by the
time background tasks run.

Recipients are built from the audience helpers in the first half of this
module (office, leadership, speakers committee, a person, a paper's
contacts, …), each returning a set of addresses, and combined with set
unions; `finalize` drops blanks, placeholder addresses and the acting user.
The full catalogue — every kind, its trigger and audience — is documented
in docs/NOTIFICATIONS.md; keep the two in step.
"""

from datetime import UTC, datetime

from fastapi import BackgroundTasks
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
    Talk,
    User,
    UserRole,
    WorkingGroup,
)
from app.services.email import Message, send_email

# Sign-ins provisioned from ORCID carry this until the registration form is
# completed; never a deliverable address.
PLACEHOLDER_DOMAIN = "@orcid.placeholder"

# Leadership Council positions whose holders count as "leadership" for
# notifications, whether or not they have a leadership-role account.
LEADERSHIP_POSITIONS = (
    CollabRoleType.chair,
    CollabRoleType.vice_chair,
    CollabRoleType.representative,
    CollabRoleType.deputy_representative,
)


def queue(background: BackgroundTasks, message: Message | None) -> None:
    """Schedule a composed message for delivery after the response."""
    if message is not None:
        background.add_task(send_email, message)


# --- Audiences ------------------------------------------------------------------
#
# Every helper returns a set[str] of addresses (possibly empty); combine with
# `|` and pass through finalize(). Account-based audiences use the exact role,
# not the rank order: "leadership" means the leadership people, not every
# admin who outranks them — admins get their own mail via office().


def _today():
    return datetime.now(UTC).date()


def _active_positions(*roles: CollabRoleType):
    today = _today()
    return (
        CollabRole.role.in_(roles),
        CollabRole.start_date <= today,
        (CollabRole.end_date.is_(None)) | (CollabRole.end_date >= today),
    )


def accounts_with_role(db, *roles: UserRole) -> set[str]:
    """Emails of the people behind active accounts holding exactly one of
    `roles` (a person may hold a role without a sign-in; see position_holders
    for those)."""
    return set(
        db.execute(
            select(Person.email)
            .join(User, User.person_id == Person.id)
            .where(User.role.in_(roles), User.is_active.is_(True))
        ).scalars()
    )


def position_holders(
    db,
    *roles: CollabRoleType,
    working_group_id: int | None = None,
    institution_id: int | None = None,
) -> set[str]:
    """Emails of everyone holding one of the given collaboration positions
    today, optionally scoped to a working group or institution."""
    stmt = (
        select(Person.email)
        .join(CollabRole, CollabRole.person_id == Person.id)
        .where(*_active_positions(*roles))
    )
    if working_group_id is not None:
        stmt = stmt.where(CollabRole.working_group_id == working_group_id)
    if institution_id is not None:
        stmt = stmt.where(CollabRole.institution_id == institution_id)
    return set(db.execute(stmt).scalars())


def admin_list() -> set[str]:
    """The database admins' address (ADMIN_EMAIL, falling back to
    CONTACT_EMAIL) — a listserv, ideally; empty when neither is set."""
    addr = get_settings().admin_notify_email
    return {addr} if addr else set()


def office(db) -> set[str]:
    """Who runs the database: the admin list plus every active admin and
    office account with a person (and so an email) attached."""
    return admin_list() | accounts_with_role(db, UserRole.admin, UserRole.office)


def leadership(db) -> set[str]:
    """Leadership Council: leadership-role accounts plus everyone currently
    holding a Council position (chair, vice chair, representatives and
    deputies), with or without a sign-in."""
    return accounts_with_role(db, UserRole.leadership) | position_holders(
        db, *LEADERSHIP_POSITIONS
    )


def speakers_committee(db) -> set[str]:
    """Speakers committee accounts plus current speakers_comm position holders."""
    return accounts_with_role(db, UserRole.speakers_committee) | position_holders(
        db, CollabRoleType.speakers_comm
    )


def institution_admin_contacts(db, institution_id: int | None) -> set[str]:
    """Active Administrative Institutional Contacts of one institution."""
    if institution_id is None:
        return set()
    return position_holders(db, CollabRoleType.admin_contact, institution_id=institution_id)


def working_group_conveners(db, working_group_id: int | None) -> set[str]:
    if working_group_id is None:
        return set()
    return position_holders(db, CollabRoleType.convener, working_group_id=working_group_id)


def publication_contacts(db, pub: Publication) -> set[str]:
    return set(
        db.execute(
            select(Person.email)
            .join(PublicationPerson, PublicationPerson.person_id == Person.id)
            .where(
                PublicationPerson.publication_id == pub.id,
                PublicationPerson.role == PublicationPersonRole.contact,
            )
        ).scalars()
    )


def person_address(person: Person | None) -> set[str]:
    """The member themselves — nothing for a placeholder record."""
    if person is None or not person.email or person.email.endswith(PLACEHOLDER_DOMAIN):
        return set()
    return {person.email}


def finalize(recipients: set[str], *, exclude: set[str] | None = None) -> list[str]:
    """Deliverable, sorted recipient list: blanks and placeholders dropped,
    plus whatever the caller excludes (typically the acting user, who knows
    what they just did)."""
    out = {
        addr
        for addr in recipients
        if addr and not addr.endswith(PLACEHOLDER_DOMAIN) and addr not in (exclude or set())
    }
    return sorted(out)


def _actor_email(db, user: User | None) -> set[str]:
    if user is None or user.person_id is None:
        return set()
    person = db.get(Person, user.person_id)
    return {person.email} if person is not None and person.email else set()


# --- Shared text helpers ----------------------------------------------------------


def _actor_name(db, user: User | None) -> str:
    if user is not None and user.person_id is not None:
        person = db.get(Person, user.person_id)
        if person is not None:
            return f"{person.given_name} {person.family_name}"
    if user is not None and user.username:
        return user.username
    return "the USMCC office"


def _site() -> str | None:
    site = get_settings().site_url
    return site.rstrip("/") if site else None


def _person_link(person: Person) -> list[str]:
    site = _site()
    return [f"{site}/people/{person.id}"] if site else []


def _pub_line(pub: Publication) -> str:
    code = f" ({pub.short_code})" if pub.short_code else ""
    line = f'"{pub.title}"{code}'
    site = _site()
    if site:
        line += f"\n{site}/publications/{pub.id}"
    return line


def _talk_line(talk: Talk) -> str:
    line = f'"{talk.title}"'
    if talk.event is not None:
        line += f" at {talk.event.name}"
    elif talk.venue:
        line += f" at {talk.venue}"
    if talk.date:
        line += f" ({talk.date.isoformat()})"
    site = _site()
    if site:
        line += f"\n{site}/talks"
    return line


def _footer() -> list[str]:
    contact = get_settings().contact_email
    lines = ["", "— US Muon Collider Collaboration database"]
    if contact:
        lines.append(f"Questions: {contact}")
    return lines


def _current_institution(db, person: Person):
    affil = db.execute(
        select(Affiliation).where(
            Affiliation.person_id == person.id,
            Affiliation.is_primary.is_(True),
            Affiliation.end_date.is_(None),
        )
    ).scalar_one_or_none()
    return affil.institution if affil is not None else None


# --- Membership ---------------------------------------------------------------------


def registration_submitted(db, person: Person) -> Message | None:
    """Ask everyone who can approve a new registration to review it: the
    office and the Administrative Institutional Contacts of the registrant's
    institution."""
    institution = _current_institution(db, person)
    to = finalize(
        office(db) | institution_admin_contacts(db, institution.id if institution else None),
        exclude=person_address(person),  # registrants don't review themselves
    )
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
    lines += [""] + _person_link(person)
    lines += [
        "",
        "The registration stays pending — with no access to the database — "
        "until the office or the institution's administrative contact "
        "approves it.",
    ]
    return Message(
        to,
        f"New membership registration: {person.display_name}",
        "\n".join(lines),
        kind="registration_submitted",
        person_id=person.id,
    )


def registration_duplicate(
    db, existing: Person, submitted_name: str, submitted_email: str
) -> Message | None:
    """Tell the office a public registration matched an existing member
    record. The submitter got the same neutral acknowledgement as everyone
    else — confirming the match to them would let anyone probe which emails
    belong to collaboration members (issue #62) — so the office has to
    follow up by hand."""
    to = finalize(office(db))
    if not to:
        return None

    lines = [
        f"A membership registration was submitted for {submitted_name} "
        "but matched an existing record, so no new record was created.",
        "",
        f"Submitted email: {submitted_email}",
        f"Existing record: {existing.display_name}",
    ]
    lines += _person_link(existing)
    lines += [
        "",
        "The submitter was told the registration is pending review and was "
        "NOT told about the existing record. If this is the same person, "
        "please contact them directly.",
    ]
    return Message(
        to,
        f"Duplicate membership registration: {submitted_name}",
        "\n".join(lines),
        kind="registration_duplicate",
        person_id=existing.id,
    )


def orcid_link_conflict(db, existing: Person, created: Person, orcid_id: str) -> Message | None:
    """Tell the office an authenticated ORCID sign-in matched a directory
    record it could not be linked to safely: the record's login already
    carries a different ORCID iD, or it holds a role above member that a
    directory match alone must not open. The sign-in was given a fresh
    pending registration instead; the office reconciles the two records."""
    to = finalize(office(db))
    if not to:
        return None

    lines = [
        f"Someone signed in with ORCID iD {orcid_id}, which is on the "
        f"directory record of {existing.display_name}, but that record's "
        "login could not take the link automatically (it already carries a "
        "different ORCID iD, or it holds a role above member).",
        "",
        f"Existing record: {existing.display_name}",
    ]
    lines += _person_link(existing)
    lines += ["", f"New pending registration created for the sign-in: {created.display_name}"]
    lines += _person_link(created)
    lines += [
        "",
        "The new registration stays pending with no access. If the sign-in "
        "really is the person on the existing record, fix that record's "
        "login (or remove the stale iD) and reject the new registration; "
        "if not, the existing record is carrying someone else's ORCID iD.",
    ]
    return Message(
        to,
        f"ORCID sign-in needs review: {orcid_id}",
        "\n".join(lines),
        kind="orcid_link_conflict",
        person_id=created.id,
    )


def registration_approved(db, person: Person, actor: User) -> Message | None:
    """Tell a registrant their membership was approved and how to sign in."""
    to = finalize(person_address(person))
    if not to:
        return None
    settings = get_settings()
    site = _site()
    lines = [
        f"Dear {person.preferred_name or person.given_name},",
        "",
        "Your registration with the US Muon Collider Collaboration has been "
        "approved — welcome!",
        "",
    ]
    if site:
        lines.append(f"The collaboration database is at {site}.")
    has_login = (
        db.execute(select(User.id).where(User.person_id == person.id)).first() is not None
    )
    if has_login:
        lines.append("You can now sign in with the account you registered with.")
    elif settings.orcid_enabled:
        lines.append(
            "Sign in with your ORCID iD (\"Sign in with ORCID\" on the login page); "
            "the office can link it to your record if it does not connect automatically."
        )
    else:
        lines.append("The office will send you your account details separately.")
    lines += [
        "",
        "Once signed in, please check your profile — institution, position, "
        "research areas and photo — and keep it up to date.",
    ]
    lines += _footer()
    return Message(
        to,
        "Your USMCC membership has been approved",
        "\n".join(lines),
        kind="registration_approved",
        person_id=person.id,
        actor_user_id=actor.id,
    )


def registration_rejected(db, person: Person, actor: User) -> Message | None:
    """Tell a registrant their registration was not approved. Deliberately
    neutral: the office's note on the transition is internal and is not
    included; the contact address is."""
    to = finalize(person_address(person))
    if not to:
        return None
    lines = [
        f"Dear {person.preferred_name or person.given_name},",
        "",
        "Your registration with the US Muon Collider Collaboration was not "
        "approved at this time.",
        "",
        "If you believe this is a mistake, or your situation has changed, "
        "please get in touch with the collaboration office.",
    ]
    lines += _footer()
    return Message(
        to,
        "Your USMCC membership registration",
        "\n".join(lines),
        kind="registration_rejected",
        person_id=person.id,
        actor_user_id=actor.id,
    )


def membership_status_changed(
    db, person: Person, from_status: str, to_status: str, actor: User
) -> Message | None:
    """Tell a member the office changed their status (active → inactive,
    alumni, …). Not sent for a member's own change, nor for the pending
    decisions, which have their own messages above."""
    to = finalize(person_address(person), exclude=_actor_email(db, actor))
    if not to:
        return None
    lines = [
        f"Dear {person.preferred_name or person.given_name},",
        "",
        f"Your USMCC membership status was changed from {from_status} to "
        f"{to_status} by {_actor_name(db, actor)}.",
    ]
    lines += _person_link(person)
    lines += [
        "",
        "If this does not look right, please contact the collaboration office.",
    ]
    lines += _footer()
    return Message(
        to,
        f"Your USMCC membership status is now {to_status}",
        "\n".join(lines),
        kind="membership_status_changed",
        person_id=person.id,
        actor_user_id=actor.id,
    )


# --- Working groups ---------------------------------------------------------------


def convener_changed(
    db, person: Person, wg: WorkingGroup, change: str, actor: User
) -> Message | None:
    """Tell the leadership and the person that a working group convener was
    added or removed (`change` is 'added', 'removed' or 'term ended')."""
    to = finalize(leadership(db) | person_address(person), exclude=_actor_email(db, actor))
    if not to:
        return None
    site = _site()
    lines = [
        f"{person.display_name} was {change} as convener of the "
        f"{wg.name} working group by {_actor_name(db, actor)}."
        if change != "term ended"
        else f"{person.display_name}'s term as convener of the {wg.name} working "
        f"group was ended by {_actor_name(db, actor)}.",
    ]
    if site:
        lines += ["", f"{site}/working-groups"]
    lines += _footer()
    verb = {"added": "New", "removed": "Removed", "term ended": "Ended"}.get(change, "Changed")
    return Message(
        to,
        f"{verb} convener for {wg.name}: {person.display_name}",
        "\n".join(lines),
        kind="convener_changed",
        person_id=person.id,
        actor_user_id=actor.id,
        context=f"working group {wg.name}",
    )


# --- Speakers bureau ----------------------------------------------------------------


def nomination_submitted(db, talk: Talk, nominee: Person, actor: User) -> Message | None:
    """Tell the speakers committee someone was nominated for a talk."""
    to = finalize(speakers_committee(db), exclude=_actor_email(db, actor))
    if not to:
        return None
    lines = [
        f"{_actor_name(db, actor)} nominated {nominee.display_name} to give",
        _talk_line(talk),
        "",
        "Please review the nominations for this talk and assign a speaker.",
    ]
    lines += _footer()
    return Message(
        to,
        f"Speaker nomination: {nominee.display_name} for {talk.title}",
        "\n".join(lines),
        kind="nomination_submitted",
        person_id=nominee.id,
        actor_user_id=actor.id,
        context=f"talk #{talk.id}",
    )


def speaker_assigned(db, talk: Talk, speaker: Person, actor: User) -> Message | None:
    """Tell a member they have been assigned a talk."""
    to = finalize(person_address(speaker), exclude=_actor_email(db, actor))
    if not to:
        return None
    lines = [
        f"Dear {speaker.preferred_name or speaker.given_name},",
        "",
        f"{_actor_name(db, actor)} has assigned you to give",
        _talk_line(talk),
        "",
        "Thank you for representing the US Muon Collider Collaboration. If you "
        "cannot give this talk, please let the speakers committee know as soon "
        "as possible.",
    ]
    lines += _footer()
    return Message(
        to,
        f"You have been assigned a talk: {talk.title}",
        "\n".join(lines),
        kind="speaker_assigned",
        person_id=speaker.id,
        actor_user_id=actor.id,
        context=f"talk #{talk.id}",
    )


# --- Publications -----------------------------------------------------------------------


def review_requested(db, pub: Publication, actor: User) -> Message | None:
    """Tell the office and the leadership a paper is ready for collaboration
    review."""
    to = finalize(admin_list() | leadership(db), exclude=_actor_email(db, actor))
    if not to:
        return None
    body = (
        f"{_actor_name(db, actor)} has requested collaboration review for\n"
        f"{_pub_line(pub)}\n\n"
        "Please assign reviewers and move it along the workflow."
    )
    return Message(
        to,
        f"Collaboration review requested: {pub.title}",
        body,
        kind="publication_review_requested",
        actor_user_id=actor.id,
        context=pub.short_code or f"publication #{pub.id}",
    )


def reviewer_assigned(db, pub: Publication, reviewer: Person, actor: User) -> Message | None:
    """Tell a person they have been asked to review a paper."""
    to = finalize(person_address(reviewer))
    if not to:
        return None
    body = (
        f"Dear {reviewer.given_name},\n\n"
        f"{_actor_name(db, actor)} has assigned you as a collaboration reviewer for\n"
        f"{_pub_line(pub)}\n\n"
        "Thank you for reviewing on behalf of the US Muon Collider Collaboration."
    )
    return Message(
        to,
        f"Review request: {pub.title}",
        body,
        kind="publication_reviewer_assigned",
        person_id=reviewer.id,
        actor_user_id=actor.id,
        context=pub.short_code or f"publication #{pub.id}",
    )


def status_changed(
    db, pub: Publication, from_status: str, to_status: str, actor: User
) -> Message | None:
    """Tell a paper's contacts (minus the actor) its status moved."""
    to = finalize(publication_contacts(db, pub), exclude=_actor_email(db, actor))
    if not to:
        return None
    body = (
        f"{_pub_line(pub)}\n\n"
        f"Status changed from {from_status.replace('_', ' ')} to "
        f"{to_status.replace('_', ' ')} by {_actor_name(db, actor)}."
    )
    return Message(
        to,
        f"Publication status update: {pub.title}",
        body,
        kind="publication_status_changed",
        actor_user_id=actor.id,
        context=pub.short_code or f"publication #{pub.id}",
    )


# --- Admin ---------------------------------------------------------------------------------


def test_message(db, actor: User) -> Message | None:
    """A test email to the acting admin's own address (Admin → Email tab)."""
    to = finalize(_actor_email(db, actor))
    if not to:
        return None
    settings = get_settings()
    lines = [
        "This is a test message from the USMCC collaboration database.",
        "",
        f"SMTP host: {settings.smtp_host}:{settings.smtp_port} ({settings.smtp_tls})",
        f"From: {settings.email_from or settings.contact_email}",
        f"Admin notifications go to: {settings.admin_notify_email or '(unset)'}",
    ]
    return Message(
        to,
        "USMCC database test email",
        "\n".join(lines),
        kind="test",
        actor_user_id=actor.id,
    )
