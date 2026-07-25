from fastapi import APIRouter, Depends, HTTPException
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
    EventUpdate,
    NominationCreate,
    NominationOut,
    NominationUpdate,
    TalkCreate,
    TalkOut,
    TalkStatRow,
    TalkUpdate,
)
from app.security import get_current_user, is_office, require_office

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


@router.post("/events", dependencies=[Depends(require_office)], status_code=201)
def create_event(body: EventCreate, db: Session = Depends(get_db)) -> EventOut:
    event = Event(**body.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_out(db, event)


@router.patch("/events/{event_id}", dependencies=[Depends(require_office)])
def update_event(event_id: int, body: EventUpdate, db: Session = Depends(get_db)) -> EventOut:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return _event_out(db, event)


@router.delete("/events/{event_id}", dependencies=[Depends(require_office)], status_code=204)
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
    """Office may manage any talk; members only ones they added themselves
    (self-service seminars / colloquia, issue #33)."""
    if not is_office(user) and talk.created_by_user_id != user.id:
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
    talk = Talk(**body.model_dump(), created_by_user_id=user.id)
    db.add(talk)
    db.commit()
    return TalkOut.model_validate(_load_talk(db, talk.id))


@router.patch("/talks/{talk_id}")
def update_talk(
    talk_id: int,
    body: TalkUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TalkOut:
    talk = db.get(Talk, talk_id)
    if talk is None:
        raise HTTPException(404, "Talk not found")
    _require_talk_editor(user, talk)
    data = body.model_dump(exclude_unset=True)
    _check_talk_refs(db, data)
    for field, value in data.items():
        setattr(talk, field, value)
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
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NominationOut:
    talk = db.get(Talk, talk_id)
    if talk is None:
        raise HTTPException(404, "Talk not found")
    if talk.status in (TalkStatus.given, TalkStatus.cancelled):
        raise HTTPException(400, f"Talk is {talk.status.value}; nominations are closed")
    if db.get(Person, body.person_id) is None:
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
        nominated_by_user_id=user.id,
        note=body.note,
    )
    db.add(nom)
    if talk.status == TalkStatus.open:
        talk.status = TalkStatus.nominations
    db.commit()
    db.refresh(nom)
    return NominationOut.model_validate(nom)


@router.patch("/nominations/{nomination_id}")
def update_nomination(
    nomination_id: int,
    body: NominationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NominationOut:
    nom = db.get(Nomination, nomination_id)
    if nom is None:
        raise HTTPException(404, "Nomination not found")
    if not is_office(user):
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
