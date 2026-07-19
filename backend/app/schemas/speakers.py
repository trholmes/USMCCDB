import datetime as dt
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models import NominationStatus, TalkStatus, TalkType
from app.schemas.common import ORMModel
from app.schemas.membership import PersonSummary


class EventCreate(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    url: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    abstract_deadline: date | None = None
    notes: str | None = None


class EventUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    abstract_deadline: date | None = None
    notes: str | None = None


class EventOut(ORMModel):
    id: int
    name: str
    url: str | None
    location: str | None
    start_date: date | None
    end_date: date | None
    abstract_deadline: date | None
    notes: str | None
    talk_count: int = 0


class TalkCreate(BaseModel):
    title: str = Field(min_length=2, max_length=500)
    event_id: int | None = None
    talk_type: TalkType = TalkType.parallel
    date: dt.date | None = None
    working_group_id: int | None = None
    speaker_person_id: int | None = None
    status: TalkStatus = TalkStatus.open
    notes: str | None = None


class TalkUpdate(BaseModel):
    title: str | None = None
    event_id: int | None = None
    talk_type: TalkType | None = None
    date: dt.date | None = None
    working_group_id: int | None = None
    speaker_person_id: int | None = None
    status: TalkStatus | None = None
    notes: str | None = None


class NominationCreate(BaseModel):
    person_id: int
    note: str | None = None


class NominationUpdate(BaseModel):
    status: NominationStatus
    note: str | None = None


class NominationOut(ORMModel):
    id: int
    talk_id: int
    person: PersonSummary
    nominated_by_user_id: int | None
    status: NominationStatus
    note: str | None
    created_at: datetime


class TalkOut(ORMModel):
    id: int
    title: str
    event_id: int | None
    talk_type: TalkType
    date: dt.date | None
    working_group_id: int | None
    speaker_person_id: int | None
    status: TalkStatus
    notes: str | None
    speaker: PersonSummary | None = None
    nominations: list[NominationOut] = []


class TalkStatRow(BaseModel):
    key: str  # person or institution display name
    key_id: int
    year: int
    talks: int
