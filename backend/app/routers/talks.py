from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import case, extract, func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import (
    Affiliation,
    Event,
    Institution,
    Nomination,
    NominationStatus,
    Person,
    Talk,
    TalkStatus,
    User,
    WorkingGroup,
)
from app.schemas.speakers import (
    EventCreate,
    EventOut,
    EventPublic,
    EventUpdate,
    NominationCreate,
    NominationOut,
    NominationUpdate,
    TalkCreate,
    TalkOut,
    TalkPublic,
    TalkStatRow,
    TalkUpdate,
)
from app.security import actor_id, can_manage_talks, get_current_user, require_speakers_committee
from app.services import notifications

router = APIRouter(tags=["speakers"])


# --- Events ---------------------------------------------------------------------


def _event_out(db: Session, event: Event) -> EventOut:
    count = db.execute(
        select(func.count()).select_from(Talk).where(Talk.event_id == event.id)
    ).scalar_one()
    out = EventOut.model_validate(event)
    out.talk_count = count
    return out


@router.get("/events")
def list_events(
    db: Session = Depends(get_db), _user: User = Depends(get_current_user)
) -> list[EventOut]:
    events = db.execute(select(Event).order_by(Event.start_date.desc().nulls_last())).scalars().all()
    return [_event_out(db, e) for e in events]


@router.post("/events", dependencies=[Depends(require_speakers_committee)], status_code=201)
def create_event(body: EventCreate, db: Session = Depends(get_db)) -> EventOut:
    event = Event(**body.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_out(db, event)


@router.patch("/events/{event_id}", dependencies=[Depends(require_speakers_committee)])
def update_event(event_id: int, body: EventUpdate, db: Session = Depends(get_db)) -> EventOut:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return _event_out(db, event)


@router.delete("/events/{event_id}", dependencies=[Depends(require_speakers_committee)], status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db)) -> None:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    db.delete(event)
    db.commit()


# --- Talks ---------------------------------------------------------------------


def _load_talk(db: Session, talk_id: int) -> Talk:
    talk = db.execute(
        select(Talk)
        .options(
            selectinload(Talk.speaker),
            selectinload(Talk.nominations).selectinload(Nomination.person),
        )
        .where(Talk.id == talk_id)
    ).scalar_one_or_none()
    if talk is None:
        raise HTTPException(404, "Talk not found")
    return talk


# Talk statuses that appear on the public page: a speaker has been chosen
# (or the talk is already given). Open slots and nominations are the
# committee's business; cancelled talks never happened.
PUBLIC_TALK_STATUSES = (TalkStatus.assigned, TalkStatus.given)


def _public_url(url: str | None) -> str | None:
    """Only http(s) links leave the building: stored URLs are member input and
    the public page renders them as hrefs."""
    if url and url.lower().startswith(("http://", "https://")):
        return url
    return None


def _institution_on(person: Person, on) -> str | None:
    """Short name of the person's primary institution on a date (inclusive
    range, like everywhere else), falling back to the current one for a talk
    without a date or predating the recorded history."""
    primaries = [a for a in person.affiliations if a.is_primary]
    hits = (
        [a for a in primaries if a.start_date <= on and (a.end_date is None or a.end_date >= on)]
        if on is not None
        else []
    ) or [a for a in primaries if a.end_date is None]
    if not hits:
        return None
    inst = hits[0].institution
    return inst.short_name or inst.name


# Declared before any /talks/{talk_id} route so "public" is never parsed as
# an id.
@router.get("/talks/public")
def list_talks_public(db: Session = Depends(get_db)) -> list[TalkPublic]:
    """Unauthenticated: the collaboration's talks for the public talks page
    (issue #175), newest first, with the conference attached so the page can
    group by it. Only assigned and given talks; the speaker is named only
    when they consented to public listing (the same consent as the
    muoncollider.us/people page), and notes, nominations and status stay
    internal."""
    stmt = (
        select(Talk)
        .options(
            selectinload(Talk.speaker)
            .selectinload(Person.affiliations)
            .selectinload(Affiliation.institution),
            selectinload(Talk.event),
            selectinload(Talk.working_group),
        )
        .where(Talk.status.in_(PUBLIC_TALK_STATUSES))
        .order_by(Talk.date.desc().nulls_last(), Talk.id.desc())
    )
    out = []
    for t in db.execute(stmt).scalars().unique().all():
        row = TalkPublic(
            id=t.id,
            title=t.title,
            talk_type=t.talk_type,
            date=t.date,
            is_invited=t.is_invited,
            url=_public_url(t.url),
            slides_url=_public_url(t.slides_url),
            recording_url=_public_url(t.recording_url),
            venue=t.venue,
            working_group=t.working_group.name if t.working_group is not None else None,
            event=EventPublic.model_validate(t.event) if t.event is not None else None,
        )
        if row.event is not None:
            row.event.url = _public_url(row.event.url)
        s = t.speaker
        if s is not None and s.public_listing_consent:
            row.speaker_name = f"{s.preferred_name or s.given_name} {s.family_name}"
            row.speaker_institution = _institution_on(s, t.date)
        out.append(row)
    return out


@router.get("/talks")
def list_talks(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    event_id: int | None = None,
    status: TalkStatus | None = None,
    speaker_person_id: int | None = None,
) -> list[TalkOut]:
    stmt = (
        select(Talk)
        .options(
            selectinload(Talk.speaker),
            selectinload(Talk.nominations).selectinload(Nomination.person),
        )
        .order_by(Talk.date.desc().nulls_last(), Talk.id.desc())
    )
    if event_id is not None:
        stmt = stmt.where(Talk.event_id == event_id)
    if status is not None:
        stmt = stmt.where(Talk.status == status)
    if speaker_person_id is not None:
        stmt = stmt.where(Talk.speaker_person_id == speaker_person_id)
    talks = db.execute(stmt).scalars().unique().all()
    return [TalkOut.model_validate(t) for t in talks]


def _require_talk_editor(user: User, talk: Talk) -> None:
    """Office, leadership and the speakers committee may manage any talk;
    members only ones they added themselves (self-service seminars /
    colloquia, issue #33)."""
    if not can_manage_talks(user) and talk.created_by_user_id != user.id:
        raise HTTPException(403, "Members can only edit talks they added")


def _check_talk_refs(db: Session, data: dict) -> None:
    """404 on dangling references instead of an IntegrityError 500 (issue #61)."""
    for field, model in (
        ("event_id", Event),
        ("speaker_person_id", Person),
        ("working_group_id", WorkingGroup),
    ):
        value = data.get(field)
        if value is not None and db.get(model, value) is None:
            raise HTTPException(404, f"{field} not found")


@router.post("/talks", status_code=201)
def create_talk(
    body: TalkCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TalkOut:
    _check_talk_refs(db, body.model_dump())
    talk = Talk(**body.model_dump(), created_by_user_id=actor_id(user))
    db.add(talk)
    db.commit()
    return TalkOut.model_validate(_load_talk(db, talk.id))


@router.patch("/talks/{talk_id}")
def update_talk(
    talk_id: int,
    body: TalkUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TalkOut:
    talk = db.get(Talk, talk_id)
    if talk is None:
        raise HTTPException(404, "Talk not found")
    _require_talk_editor(user, talk)
    data = body.model_dump(exclude_unset=True)
    _check_talk_refs(db, data)
    previous_speaker = talk.speaker_person_id
    for field, value in data.items():
        setattr(talk, field, value)
    db.flush()
    # A speaker set directly on the talk (rather than through a nomination)
    # is told the same way (issue #166); reassignments to the same person
    # or clearing the speaker send nothing.
    if talk.speaker_person_id is not None and talk.speaker_person_id != previous_speaker:
        speaker = db.get(Person, talk.speaker_person_id)
        notifications.queue(background, notifications.speaker_assigned(db, talk, speaker, user))
    db.commit()
    return TalkOut.model_validate(_load_talk(db, talk_id))


@router.delete("/talks/{talk_id}", status_code=204)
def delete_talk(
    talk_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    talk = db.get(Talk, talk_id)
    if talk is None:
        raise HTTPException(404, "Talk not found")
    _require_talk_editor(user, talk)
    db.delete(talk)
    db.commit()


# --- Nominations ------------------------------------------------------------------


@router.post("/talks/{talk_id}/nominations", status_code=201)
def nominate(
    talk_id: int,
    body: NominationCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NominationOut:
    talk = db.get(Talk, talk_id)
    if talk is None:
        raise HTTPException(404, "Talk not found")
    if talk.status in (TalkStatus.given, TalkStatus.cancelled):
        raise HTTPException(400, f"Talk is {talk.status.value}; nominations are closed")
    nominee = db.get(Person, body.person_id)
    if nominee is None:
        raise HTTPException(404, "Person not found")
    exists = db.execute(
        select(Nomination).where(
            Nomination.talk_id == talk_id, Nomination.person_id == body.person_id
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Already nominated for this talk")
    nom = Nomination(
        talk_id=talk_id,
        person_id=body.person_id,
        nominated_by_user_id=actor_id(user),
        note=body.note,
    )
    db.add(nom)
    if talk.status == TalkStatus.open:
        talk.status = TalkStatus.nominations
    notifications.queue(background, notifications.nomination_submitted(db, talk, nominee, user))
    db.commit()
    db.refresh(nom)
    return NominationOut.model_validate(nom)


@router.patch("/nominations/{nomination_id}")
def update_nomination(
    nomination_id: int,
    body: NominationUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NominationOut:
    nom = db.get(Nomination, nomination_id)
    if nom is None:
        raise HTTPException(404, "Nomination not found")
    if not can_manage_talks(user):
        # Members may only withdraw their own nomination (self or one they made).
        own = user.person_id == nom.person_id or user.id == nom.nominated_by_user_id
        if not (own and body.status == NominationStatus.withdrawn):
            raise HTTPException(403, "Members can only withdraw their own nominations")
    previous_status = nom.status
    nom.status = body.status
    if body.note is not None:
        nom.note = body.note
    if body.status == NominationStatus.assigned:
        talk = db.get(Talk, nom.talk_id)
        if previous_status != NominationStatus.assigned:
            notifications.queue(
                background,
                notifications.speaker_assigned(db, talk, db.get(Person, nom.person_id), user),
            )
        talk.speaker_person_id = nom.person_id
        talk.status = TalkStatus.assigned
        # Any other assigned nominations for this talk drop back to shortlisted.
        others = db.execute(
            select(Nomination).where(
                Nomination.talk_id == nom.talk_id,
                Nomination.id != nom.id,
                Nomination.status == NominationStatus.assigned,
            )
        ).scalars()
        for other in others:
            other.status = NominationStatus.shortlisted
    elif previous_status == NominationStatus.assigned:
        # Moving the assigned nomination out of "assigned" (withdrawn, declined,
        # back to shortlisted, ...) must release the talk, or it keeps showing
        # the departed speaker and crediting them in /stats/talks (issue #64).
        talk = db.get(Talk, nom.talk_id)
        if talk.status == TalkStatus.assigned and talk.speaker_person_id == nom.person_id:
            talk.speaker_person_id = None
            db.flush()  # session is autoflush=False; count must see nom's new status
            active = db.execute(
                select(func.count())
                .select_from(Nomination)
                .where(
                    Nomination.talk_id == nom.talk_id,
                    Nomination.status.notin_(
                        (NominationStatus.withdrawn, NominationStatus.declined)
                    ),
                )
            ).scalar_one()
            talk.status = TalkStatus.nominations if active else TalkStatus.open
    db.commit()
    db.refresh(nom)
    return NominationOut.model_validate(nom)


# --- Fair-share statistics -----------------------------------------------------


@router.get("/stats/talks")
def talk_stats(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    by: str = "person",  # person | institution
) -> list[TalkStatRow]:
    """Talks per person (or per current primary institution) per year, for
    talks that have a speaker and a date."""
    year = extract("year", Talk.date).label("year")
    invited = func.sum(case((Talk.is_invited, 1), else_=0)).label("invited")
    if by == "institution":
        stmt = (
            select(
                Institution.name,
                Institution.id,
                year,
                func.count(Talk.id),
                invited,
            )
            .join(Affiliation, Affiliation.institution_id == Institution.id)
            .join(
                Talk,
                (Talk.speaker_person_id == Affiliation.person_id)
                & (Affiliation.is_primary.is_(True))
                & (Affiliation.end_date.is_(None)),
            )
            .where(Talk.date.isnot(None))
            .group_by(Institution.name, Institution.id, year)
            .order_by(year)
        )
    else:
        stmt = (
            select(
                func.concat(Person.given_name, " ", Person.family_name),
                Person.id,
                year,
                func.count(Talk.id),
                invited,
            )
            .join(Talk, Talk.speaker_person_id == Person.id)
            .where(Talk.date.isnot(None))
            .group_by(Person.id, year)
            .order_by(year)
        )
    rows = db.execute(stmt).all()
    return [
        TalkStatRow(key=r[0], key_id=r[1], year=int(r[2]), talks=r[3], invited=int(r[4] or 0))
        for r in rows
    ]
