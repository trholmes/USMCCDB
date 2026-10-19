import datetime as dt
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.models import NominationStatus, TalkStatus, TalkType
from app.schemas.common import ORMModel
from app.schemas.membership import PersonSummary


def _http_url(value: str | None) -> str | None:
    """Links are member input and every page renders them as hrefs, so only
    http(s) is stored (issue #188): a javascript: URL would run when a
    colleague clicked it. Blank means no link."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if not value.lower().startswith(("http://", "https://")):
        raise ValueError("must be a full http:// or https:// address")
    return value


class EventCreate(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    url: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    abstract_deadline: date | None = None
    notes: str | None = None

    @field_validator("url")
    @classmethod
    def _links_http_only(cls, v: str | None) -> str | None:
        return _http_url(v)


class EventUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    abstract_deadline: date | None = None
    notes: str | None = None

    @field_validator("url")
    @classmethod
    def _links_http_only(cls, v: str | None) -> str | None:
        return _http_url(v)


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
    venue: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=500)
    slides_url: str | None = Field(default=None, max_length=500)
    recording_url: str | None = Field(default=None, max_length=500)
    talk_type: TalkType = TalkType.parallel
    date: dt.date | None = None
    working_group_id: int | None = None
    speaker_person_id: int | None = None
    status: TalkStatus = TalkStatus.open
    is_invited: bool = False
    notes: str | None = None

    @field_validator("url", "slides_url", "recording_url")
    @classmethod
    def _links_http_only(cls, v: str | None) -> str | None:
        return _http_url(v)


class TalkUpdate(BaseModel):
    title: str | None = None
    event_id: int | None = None
    venue: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=500)
    slides_url: str | None = Field(default=None, max_length=500)
    recording_url: str | None = Field(default=None, max_length=500)
    talk_type: TalkType | None = None
    date: dt.date | None = None
    working_group_id: int | None = None
    speaker_person_id: int | None = None
    status: TalkStatus | None = None
    is_invited: bool | None = None
    notes: str | None = None

    @field_validator("url", "slides_url", "recording_url")
    @classmethod
    def _links_http_only(cls, v: str | None) -> str | None:
        return _http_url(v)


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
    venue: str | None
    url: str | None
    slides_url: str | None
    recording_url: str | None
    talk_type: TalkType
    date: dt.date | None
    working_group_id: int | None
    speaker_person_id: int | None
    status: TalkStatus
    is_invited: bool
    notes: str | None
    created_by_user_id: int | None
    speaker: PersonSummary | None = None
    nominations: list[NominationOut] = []


class EventPublic(ORMModel):
    """Conference details exposed to anonymous visitors (issue #175)."""

    id: int
    name: str
    url: str | None
    location: str | None
    start_date: date | None
    end_date: date | None


class TalkPublic(ORMModel):
    """A talk on the public talks page (issue #175): what a conference
    programme already shows, nothing about the selection process. The
    speaker's name appears only with their public-listing consent; notes,
    nominations and status never do."""

    id: int
    title: str
    talk_type: TalkType
    date: dt.date | None
    is_invited: bool
    url: str | None
    slides_url: str | None
    recording_url: str | None
    # Where a talk without a conference was given (seminar / colloquium host).
    venue: str | None
    speaker_name: str | None = None
    # The speaker's (primary) institution at the time of the talk — like the
    # Institute column on Glance's public talks page; only with the name.
    speaker_institution: str | None = None
    # The working group the talk was given for (Glance's "Area").
    working_group: str | None = None
    event: EventPublic | None = None


class TalkStatRow(BaseModel):
    key: str  # person or institution display name
    key_id: int
    year: int
    talks: int
    invited: int = 0
