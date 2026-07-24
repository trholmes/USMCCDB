from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models import (
    PublicationPersonRole,
    PublicationStatus,
    PublicationType,
)
from app.schemas.common import ORMModel
from app.schemas.membership import PersonSummary


class PublicationCreate(BaseModel):
    title: str = Field(min_length=2, max_length=600)
    pub_type: PublicationType = PublicationType.paper
    working_group_id: int | None = None
    target_journal: str | None = None
    abstract: str | None = None


class PublicationUpdate(BaseModel):
    title: str | None = None
    pub_type: PublicationType | None = None
    working_group_id: int | None = None
    arxiv_id: str | None = None
    doi: str | None = None
    journal: str | None = None
    target_journal: str | None = None
    abstract: str | None = None
    author_cutoff_date: date | None = None


class PubStatusChange(BaseModel):
    status: PublicationStatus
    note: str | None = None


class PubPersonAdd(BaseModel):
    person_id: int
    role: PublicationPersonRole


class PubPersonOut(ORMModel):
    id: int
    person: PersonSummary
    role: PublicationPersonRole


class PublicationOut(ORMModel):
    id: int
    title: str
    short_code: str | None
    pub_type: PublicationType
    status: PublicationStatus
    working_group_id: int | None
    arxiv_id: str | None
    doi: str | None
    journal: str | None
    target_journal: str | None
    abstract: str | None
    author_cutoff_date: date | None
    people: list[PubPersonOut] = []
    created_at: datetime


class PublicationPublic(ORMModel):
    """Minimal shape exposed to anonymous visitors (published items only)."""

    id: int
    title: str
    pub_type: PublicationType
    arxiv_id: str | None
    doi: str | None
    journal: str | None


class PubAcknowledgment(BaseModel):
    text: str
    reviewers: list[str]


class AuthorListRequest(BaseModel):
    cutoff_date: date
    # "collaboration" = every member with an active author period at the cutoff;
    # "involved" = just the people attached to the publication (any role except
    # reviewer), whether or not they have registered author periods.
    scope: Literal["collaboration", "involved"] = "collaboration"


class AuthorEntry(BaseModel):
    person_id: int
    display_name: str
    family_name: str
    given_name: str
    orcid: str | None
    institution_ids: list[int]


class AuthorListInstitution(BaseModel):
    id: int
    name: str
    latex_address: str | None


class AuthorListOut(ORMModel):
    id: int
    publication_id: int | None
    cutoff_date: date
    generated_by_user_id: int | None
    snapshot: dict
    created_at: datetime
