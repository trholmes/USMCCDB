from datetime import UTC, datetime, date, timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import Date, case, cast, func, or_, select
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
    WorkingGroupMember,
)
from app.models.membership import RESEARCH_AREAS
from app.schemas.membership import (
    AffiliationCreate,
    AffiliationOut,
    AffiliationUpdate,
    AuthorPeriodCreate,
    AuthorPeriodOut,
    AuthorPeriodUpdate,
    InstitutionChange,
    InstitutionRef,
    LabelCount,
    MembershipEventOut,
    MemberStats,
    PersonApply,
    PersonOut,
    PersonSummary,
    PersonUpdate,
    StatusChange,
    WorkingGroupRef,
    MonthCount,
)
from app.config import get_settings
from app.security import (
    get_applicant_user,
    get_current_user,
    is_admin_contact_for,
    is_office,
    require_office,
)
from app.services import notifications
from app.services.email import send_email

PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_PHOTO_BYTES = 10 * 1024 * 1024

router = APIRouter(prefix="/people", tags=["membership"])

# Fields a member may edit on their own profile.
SELF_EDITABLE = {
    "preferred_name",
    "email",
    "orcid",
    "career_stage",
    "professional_title",
    "department",
    "usmcc_percent",
    "research_areas",
    "expertise",
    "is_voting",
}
# Charter institutional info an Administrative Institutional Contact may keep
# up to date for people currently at their institution.
ADMIN_CONTACT_EDITABLE = {
    "career_stage",
    "professional_title",
    "department",
    "usmcc_percent",
}
# Statuses a member may set on themselves — both as the target AND as the
# current status: pending/rejected people cannot self-service at all
# (moderation states stay office-controlled).
SELF_SETTABLE_STATUSES = {MemberStatus.active, MemberStatus.inactive, MemberStatus.alumni}
# Career stages considered "students" — not eligible for voting membership.
STUDENT_STAGES = {CareerStage.undergrad, CareerStage.grad}
# Person columns that are NOT NULL in the DB; explicit JSON nulls must be
# rejected up front or they surface as a 500 at commit.
NON_NULLABLE_FIELDS = {"given_name", "family_name", "email", "career_stage", "is_voting"}


def _voting_eligible(status: MemberStatus, career_stage: CareerStage) -> bool:
    """Voting membership may be held only while active and not a student."""
    return status == MemberStatus.active and career_stage not in STUDENT_STAGES


def _current_institution_is_us(db: Session, person_id: int) -> bool:
    """Voting also requires a current primary affiliation at a US
    institution (only people currently affiliated with US institutions are
    eligible to vote)."""
    affil = _open_primary(db, person_id)
    return affil is not None and affil.institution.is_us


def _get_person(db: Session, person_id: int) -> Person:
    person = db.get(Person, person_id)
    if person is None:
        raise HTTPException(404, "Person not found")
    return person


def _require_self_or_office(user: User, person_id: int, action: str) -> None:
    if not (is_office(user) or user.person_id == person_id):
        raise HTTPException(403, f"You can only {action} your own profile")


def _validate_entered_date(entered: date, label: str) -> None:
    """Sanity-bound member-entered dates: backdating is a feature, but the
    future and the deep past are not. One day of slack covers users whose
    local calendar is ahead of UTC."""
    if entered > datetime.now(UTC).date() + timedelta(days=1):
        raise HTTPException(422, f"{label} cannot be in the future")
    if entered < date(1900, 1, 1):
        raise HTTPException(422, f"{label} is unreasonably far in the past")


def _resolve_institution_id(
    db: Session, institution_id: int | None, institution_name: str | None
) -> int:
    """Return a valid institution id, creating an inactive entry from free
    text (office reviews new entries) when no id was given."""
    if institution_id is None:
        name = (institution_name or "").strip()
        if not name:
            raise HTTPException(422, "Provide institution_id or institution_name")
        inst = Institution(name=name, is_active=False)  # office reviews
        db.add(inst)
        db.flush()
        return inst.id
    if db.get(Institution, institution_id) is None:
        raise HTTPException(404, "institution_id not found")
    return institution_id


def _open_primary(db: Session, person_id: int) -> Affiliation | None:
    return db.execute(
        select(Affiliation).where(
            Affiliation.person_id == person_id,
            Affiliation.is_primary.is_(True),
            Affiliation.end_date.is_(None),
        )
    ).scalar_one_or_none()


def _close_primary(db: Session, affil: Affiliation, move_date: date) -> None:
    """Close an open primary affiliation so a new one starting on move_date
    can be opened. The old affiliation ends the day BEFORE the move
    (author-list date ranges are inclusive on both ends, so sharing the
    boundary date would double-list the person); a same-day move deletes the
    superseded zero-length row instead — a correction, not a move."""
    if move_date < affil.start_date:
        raise HTTPException(
            400,
            "Start date must be on or after the current affiliation "
            f"start date ({affil.start_date.isoformat()})",
        )
    if move_date == affil.start_date:
        db.delete(affil)
        # Flush now: the unit of work runs INSERTs before DELETEs, so the
        # replacement open-primary row would otherwise trip the
        # uq_one_open_primary_affiliation index while this row still exists.
        db.flush()
    else:
        affil.end_date = move_date - timedelta(days=1)


@router.post("/apply", status_code=201)
def apply(
    body: PersonApply,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    applicant: User | None = Depends(get_applicant_user),
) -> PersonSummary:
    """Public membership registration; creates a pending person record and
    notifies everyone who can approve it. A signed-in ORCID user still
    carrying the placeholder record from their first sign-in completes that
    record instead of creating a duplicate."""
    email = body.email.lower()

    person: Person | None = None
    if applicant is not None and applicant.person_id is not None:
        candidate = db.get(Person, applicant.person_id)
        if candidate is not None and candidate.email.endswith("@orcid.placeholder"):
            person = candidate

    email_clash = select(Person).where(Person.email == email)
    if person is not None:
        email_clash = email_clash.where(Person.id != person.id)
    if db.execute(email_clash).scalar_one_or_none():
        raise HTTPException(409, "A record with this email already exists — contact the office")
    if body.orcid:
        orcid_clash = select(Person).where(Person.orcid == body.orcid)
        if person is not None:
            orcid_clash = orcid_clash.where(Person.id != person.id)
        if db.execute(orcid_clash).scalar_one_or_none():
            raise HTTPException(
                409, "A record with this ORCID iD already exists — contact the office"
            )

    if person is None:
        person = Person(
            given_name=body.given_name,
            middle_name=body.middle_name,
            family_name=body.family_name,
            preferred_name=body.preferred_name,
            email=email,
            orcid=body.orcid,
            career_stage=body.career_stage,
            professional_title=body.professional_title,
            department=body.department,
            usmcc_percent=body.usmcc_percent,
            status=MemberStatus.pending,
            is_voting=body.is_voting,
            research_areas=body.research_areas,
            expertise=body.expertise,
            notes=body.notes,
        )
        db.add(person)
        db.flush()
        db.add(MembershipEvent(person_id=person.id, from_status=None, to_status="pending"))
    else:
        # Completing an ORCID-provisioned placeholder: fill in the form
        # fields. The ORCID iD stays the authenticated one from sign-in, and
        # the pending membership event was already recorded at provisioning.
        person.given_name = body.given_name
        person.middle_name = body.middle_name
        person.family_name = body.family_name
        person.preferred_name = body.preferred_name
        person.email = email
        person.career_stage = body.career_stage
        person.professional_title = body.professional_title
        person.department = body.department
        person.usmcc_percent = body.usmcc_percent
        person.is_voting = body.is_voting
        person.research_areas = body.research_areas
        person.expertise = body.expertise
        person.notes = body.notes

    if (
        body.institution_id is not None or (body.institution_name or "").strip()
    ) and _open_primary(db, person.id) is None:
        institution_id = _resolve_institution_id(db, body.institution_id, body.institution_name)
        db.add(
            Affiliation(
                person_id=person.id,
                institution_id=institution_id,
                is_primary=True,
                career_stage=body.career_stage,
                start_date=datetime.now(UTC).date(),
            )
        )

    db.flush()  # sessions don't autoflush — the notification queries need the rows
    msg = notifications.registration_submitted(db, person)
    if msg:
        background.add_task(send_email, *msg)
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
    research_area: str | None = Query(default=None, description="standard research area name"),
    is_voting: bool | None = None,
    q: str | None = Query(default=None, description="name/email search"),
) -> list[PersonSummary]:
    stmt = (
        select(Person)
        .options(selectinload(Person.affiliations).selectinload(Affiliation.institution))
        .order_by(Person.family_name, Person.given_name)
    )
    if status is not None:
        stmt = stmt.where(Person.status == status)
    if career_stage is not None:
        stmt = stmt.where(Person.career_stage == career_stage)
    if research_area is not None:
        # research_areas holds a comma-separated subset of RESEARCH_AREAS
        # (normalized on write); match the canonical name case-insensitively.
        canonical = {a.lower(): a for a in RESEARCH_AREAS}.get(research_area.strip().lower())
        if canonical is None:
            raise HTTPException(
                422, f"Unknown research area; allowed: {', '.join(RESEARCH_AREAS)}"
            )
        stmt = stmt.where(Person.research_areas.ilike(f"%{canonical}%"))
    if is_voting is not None:
        stmt = stmt.where(Person.is_voting.is_(is_voting))
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
        stmt = stmt.join(WorkingGroupMember).where(
            WorkingGroupMember.working_group_id == working_group_id
        )
    people = db.execute(stmt).scalars().unique().all()
    out = []
    for p in people:
        row = PersonSummary.model_validate(p)
        primary = next(
            (a for a in p.affiliations if a.is_primary and a.end_date is None), None
        )
        if primary is not None:
            row.primary_institution = InstitutionRef.model_validate(primary.institution)
        out.append(row)
    return out


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
            selectinload(Person.wg_memberships).selectinload(WorkingGroupMember.working_group),
        )
        .where(Person.id == person_id)
    ).scalar_one_or_none()
    if person is None:
        raise HTTPException(404, "Person not found")
    out = PersonOut.model_validate(person)
    out.working_groups = sorted(
        (WorkingGroupRef.model_validate(m.working_group) for m in person.wg_memberships),
        key=lambda w: w.name.lower(),
    )
    return out


@router.patch("/{person_id}")
def update_person(
    person_id: int,
    body: PersonUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonOut:
    person = _get_person(db, person_id)
    changes = body.model_dump(exclude_unset=True)
    # Explicit nulls on NOT NULL columns would only fail at commit (500).
    for field in NON_NULLABLE_FIELDS & set(changes):
        if changes[field] is None:
            raise HTTPException(422, f"{field} cannot be null")
    if not is_office(user):
        if user.person_id == person_id:
            illegal = set(changes) - SELF_EDITABLE
            if illegal:
                raise HTTPException(403, f"Members cannot edit: {', '.join(sorted(illegal))}")
        elif is_admin_contact_for(db, user, person_id):
            # Administrative Institutional Contacts keep the charter
            # institutional info of the people at their institution current.
            illegal = set(changes) - ADMIN_CONTACT_EDITABLE
            if illegal:
                raise HTTPException(
                    403,
                    "Administrative contacts may only update: "
                    f"{', '.join(sorted(ADMIN_CONTACT_EDITABLE))}",
                )
        else:
            raise HTTPException(403, "You can only edit your own profile")
    # Voting requires an active, non-student member — for every actor, but
    # only checked when the request touches the fields involved, so unrelated
    # edits are never blocked by pre-existing state.
    if "is_voting" in changes or "career_stage" in changes:
        resulting_voting = changes.get("is_voting", person.is_voting)
        resulting_stage = changes.get("career_stage", person.career_stage)
        if resulting_voting and not _voting_eligible(person.status, resulting_stage):
            raise HTTPException(
                422,
                "Voting membership requires an active, non-student member "
                "(not undergrad or grad student).",
            )
        # The US-institution requirement is checked only when the flag itself
        # is being set, so a stage edit is never blocked by affiliation state.
        if "is_voting" in changes and resulting_voting and not _current_institution_is_us(
            db, person_id
        ):
            raise HTTPException(
                422,
                "Voting membership requires a current primary affiliation "
                "with a US institution.",
            )
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
    # The open primary affiliation records the stage held at the current
    # institution — keep it in step with the profile.
    if "career_stage" in changes:
        open_primary = _open_primary(db, person_id)
        if open_primary is not None:
            open_primary.career_stage = person.career_stage
    db.commit()
    return get_person(person_id, db, user)


@router.post("/{person_id}/status")
def change_status(
    person_id: int,
    body: StatusChange,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> PersonSummary:
    person = _get_person(db, person_id)
    if not is_office(actor):
        if actor.person_id != person_id:
            # An Administrative Institutional Contact may decide pending
            # registrations of people at their institution (approve/reject).
            contact_decides = (
                person.status == MemberStatus.pending
                and body.status in (MemberStatus.active, MemberStatus.rejected)
                and is_admin_contact_for(db, actor, person_id)
            )
            if not contact_decides:
                raise HTTPException(403, "You can only change your own status")
        else:
            # Both directions are restricted: members can neither set a
            # moderation state nor leave one (no self-approval/reinstatement).
            if body.status not in SELF_SETTABLE_STATUSES:
                allowed = ", ".join(sorted(s.value for s in SELF_SETTABLE_STATUSES))
                raise HTTPException(403, f"Members may only set their status to: {allowed}")
            if person.status not in SELF_SETTABLE_STATUSES:
                raise HTTPException(
                    403, f"Your status is {person.status.value}; only the office can change it"
                )
    if body.status == person.status:
        raise HTTPException(400, f"Person is already {person.status.value}")
    effective = body.effective_date or datetime.now(UTC).date()
    _validate_entered_date(effective, "effective_date")
    db.add(
        MembershipEvent(
            person_id=person.id,
            from_status=person.status.value,
            to_status=body.status.value,
            effective_date=effective,
            actor_user_id=actor.id,
            note=body.note,
        )
    )
    person.status = body.status
    person.status_changed_at = datetime.now(UTC)
    # Voting membership can't be held while not active — keep the invariant
    # no matter who performs the transition.
    if body.status != MemberStatus.active:
        person.is_voting = False
    db.commit()
    db.refresh(person)
    return PersonSummary.model_validate(person)


@router.get("/{person_id}/events")
def list_events(
    person_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MembershipEventOut]:
    _get_person(db, person_id)
    _require_self_or_office(user, person_id, "view membership history for")
    events = (
        db.execute(
            select(MembershipEvent)
            .where(MembershipEvent.person_id == person_id)
            .order_by(MembershipEvent.created_at)
        )
        .scalars()
        .all()
    )
    out = [MembershipEventOut.model_validate(e) for e in events]
    if not is_office(user):
        # Notes and actor identities are office-internal annotations
        # (rejection reasons etc.) — members see only the transitions.
        for row in out:
            row.note = None
            row.actor_user_id = None
    return out


# --- Photos ---------------------------------------------------------------------


@router.get("/{person_id}/photo")
def get_photo(
    person_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> FileResponse:
    person = _get_person(db, person_id)
    if not person.photo_file:
        raise HTTPException(404, "No photo")
    path = Path(get_settings().photos_dir) / person.photo_file
    if not path.is_file():
        raise HTTPException(404, "Photo file missing")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})


@router.post("/{person_id}/photo", status_code=201)
async def upload_photo(
    person_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PersonSummary:
    person = _get_person(db, person_id)
    _require_self_or_office(user, person_id, "upload a photo for")
    ext = PHOTO_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(422, f"Unsupported type; use one of {sorted(PHOTO_TYPES)}")
    content = await file.read()
    if len(content) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo too large (max 10 MB)")
    photos = Path(get_settings().photos_dir)
    photos.mkdir(parents=True, exist_ok=True)
    # Fixed name per person, timestamped to bust caches on replacement.
    old = person.photo_file
    name = f"{person_id}-{int(datetime.now(UTC).timestamp())}{ext}"
    (photos / name).write_bytes(content)
    person.photo_file = name
    db.commit()
    if old and old != name and (photos / old).is_file():
        (photos / old).unlink()
    db.refresh(person)
    return PersonSummary.model_validate(person)


@router.delete("/{person_id}/photo", status_code=204)
def delete_photo(
    person_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    person = _get_person(db, person_id)
    _require_self_or_office(user, person_id, "remove the photo of")
    if person.photo_file:
        path = Path(get_settings().photos_dir) / person.photo_file
        if path.is_file():
            path.unlink()
        person.photo_file = None
        db.commit()


# --- Institution move (self-service or office) --------------------------------


@router.post("/{person_id}/institution", status_code=201)
def change_institution(
    person_id: int,
    body: InstitutionChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AffiliationOut:
    """Move a person to a new primary institution as of a date, preserving
    history: the current open primary affiliation is closed the day before
    that date and a new open primary is opened. Optionally updates the
    person's career stage along with the move; either way the stage taken up
    at the new institution is stamped on the new affiliation. Available to
    the person themselves or office."""
    person = _get_person(db, person_id)
    _require_self_or_office(user, person_id, "change the institution of")
    _validate_entered_date(body.start_date, "start_date")

    if body.career_stage is not None and body.career_stage != person.career_stage:
        # Same eligibility rule as a profile edit: a voting member cannot
        # become a student while keeping the flag.
        if person.is_voting and not _voting_eligible(person.status, body.career_stage):
            raise HTTPException(
                422,
                "Voting membership requires an active, non-student member "
                "(not undergrad or grad student). Update your voting status first.",
            )
        person.career_stage = body.career_stage

    institution_id = _resolve_institution_id(db, body.institution_id, body.institution_name)

    # A voting member cannot move to a non-US institution while keeping the
    # flag (same shape as the career-stage rule above).
    if person.is_voting and not db.get(Institution, institution_id).is_us:
        raise HTTPException(
            422,
            "Voting membership requires a US institution. "
            "Update your voting status first.",
        )

    open_primary = _open_primary(db, person_id)
    if open_primary is not None:
        if open_primary.institution_id == institution_id:
            raise HTTPException(400, "That is already your current institution")
        _close_primary(db, open_primary, body.start_date)

    affil = Affiliation(
        person_id=person_id,
        institution_id=institution_id,
        is_primary=True,
        career_stage=person.career_stage,
        start_date=body.start_date,
        end_date=None,
    )
    db.add(affil)
    db.commit()
    db.refresh(affil)
    return AffiliationOut.model_validate(affil)


# --- Affiliations (office) ----------------------------------------------------


@router.post("/{person_id}/affiliations", dependencies=[Depends(require_office)], status_code=201)
def add_affiliation(
    person_id: int, body: AffiliationCreate, db: Session = Depends(get_db)
) -> AffiliationOut:
    person = _get_person(db, person_id)
    institution = db.get(Institution, body.institution_id)
    if institution is None:
        raise HTTPException(404, "institution_id not found")
    if body.is_primary and body.end_date is None:
        # The new open primary is where the person currently is — a voting
        # member cannot be placed at a non-US institution (same rule as the
        # self-service move).
        if person.is_voting and not institution.is_us:
            raise HTTPException(
                422,
                "Voting membership requires a US institution. "
                "Update the voting status first.",
            )
        # Close any currently-open primary affiliation (same fencepost rules
        # as the self-service institution move).
        open_primary = _open_primary(db, person_id)
        if open_primary:
            _close_primary(db, open_primary, body.start_date)
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


# --- Membership statistics ------------------------------------------------------

# Separate router: stats live under /stats/* (like /stats/talks), outside the
# /people prefix.
stats_router = APIRouter(tags=["membership"])


@stats_router.get("/stats/members")
def member_stats(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> MemberStats:
    """Aggregate membership statistics: headline counts, breakdowns of the
    active membership, and collaboration growth over time."""
    active = Person.status == MemberStatus.active

    status_counts: dict[MemberStatus, int] = dict(
        db.execute(select(Person.status, func.count()).group_by(Person.status)).all()
    )
    stage_counts: dict[CareerStage, int] = dict(
        db.execute(
            select(Person.career_stage, func.count()).where(active).group_by(Person.career_stage)
        ).all()
    )

    # research_areas holds a comma-separated subset of RESEARCH_AREAS
    # (normalized on write), so a substring match per canonical name is exact.
    by_research_area = []
    for area in RESEARCH_AREAS:
        n = db.scalar(
            select(func.count())
            .select_from(Person)
            .where(active, Person.research_areas.ilike(f"%{area}%"))
        )
        if n:
            by_research_area.append(LabelCount(label=area, count=n))

    current_primary = (Affiliation.is_primary.is_(True), Affiliation.end_date.is_(None))
    us_active = db.scalar(
        select(func.count())
        .select_from(Affiliation)
        .join(Person, Person.id == Affiliation.person_id)
        .join(Institution, Institution.id == Affiliation.institution_id)
        .where(active, *current_primary, Institution.is_us.is_(True))
    )
    institutions_with_active = db.scalar(
        select(func.count(func.distinct(Affiliation.institution_id)))
        .select_from(Affiliation)
        .join(Person, Person.id == Affiliation.person_id)
        .where(active, *current_primary)
    )
    voting = db.scalar(
        select(func.count()).select_from(Person).where(active, Person.is_voting.is_(True))
    )

    # Effort on the USMCC: usmcc_percent is optional, so aggregate only over
    # the active members who reported it (count/avg/sum all skip NULLs).
    usmcc_reporting, usmcc_avg, usmcc_sum = db.execute(
        select(
            func.count(Person.usmcc_percent),
            func.avg(Person.usmcc_percent),
            func.sum(Person.usmcc_percent),
        ).where(active)
    ).one()

    # Distribution of the reported percentages, bucketed to match the ranges
    # the registration form offers ('0-10%', '10-24%', '25-49%', '50-100%');
    # the importer stores range midpoints, so each answer lands in its bucket.
    pct_buckets = [("<10%", 10), ("10-24%", 25), ("25-49%", 50), ("50-100%", 101)]
    bucket = case(
        *[(Person.usmcc_percent < upper, label) for label, upper in pct_buckets]
    ).label("bucket")
    bucket_counts = dict(
        db.execute(
            select(bucket, func.count())
            .where(active, Person.usmcc_percent.is_not(None))
            .group_by(bucket)
        ).all()
    )
    by_usmcc_percent = [
        LabelCount(label=label, count=bucket_counts.get(label, 0)) for label, _ in pct_buckets
    ]

    # Growth: each person's first transition to active, bucketed by month
    # (effective_date as entered, falling back to the recorded timestamp).
    first_active = (
        select(
            MembershipEvent.person_id,
            func.min(
                func.coalesce(
                    MembershipEvent.effective_date, cast(MembershipEvent.created_at, Date)
                )
            ).label("joined"),
        )
        .where(MembershipEvent.to_status == MemberStatus.active.value)
        .group_by(MembershipEvent.person_id)
        .subquery()
    )
    month = func.to_char(first_active.c.joined, "YYYY-MM").label("month")
    month_counts = dict(
        db.execute(select(month, func.count()).group_by(month).order_by(month)).all()
    )
    # Fill the gaps so the chart gets a continuous month axis.
    new_members_by_month = []
    if month_counts:
        y, m = map(int, min(month_counts).split("-"))
        last = max(month_counts)
        while True:
            key = f"{y:04d}-{m:02d}"
            new_members_by_month.append(MonthCount(month=key, count=month_counts.get(key, 0)))
            if key == last:
                break
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    return MemberStats(
        total_people=sum(status_counts.values()),
        active=status_counts.get(MemberStatus.active, 0),
        voting=voting or 0,
        us_active=us_active or 0,
        institutions_with_active=institutions_with_active or 0,
        by_status=[
            LabelCount(label=s.value, count=status_counts[s])
            for s in MemberStatus
            if s in status_counts
        ],
        by_career_stage=[
            LabelCount(label=s.value, count=stage_counts[s])
            for s in CareerStage
            if s in stage_counts
        ],
        by_research_area=by_research_area,
        new_members_by_month=new_members_by_month,
        usmcc_reporting=usmcc_reporting or 0,
        avg_usmcc_percent=float(usmcc_avg) if usmcc_avg is not None else None,
        by_usmcc_percent=by_usmcc_percent,
        usmcc_fte=(usmcc_sum or 0) / 100,
    )
