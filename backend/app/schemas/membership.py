from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models import CareerStage, CollabRoleType, MemberStatus
from app.schemas.common import ORMModel

ORCID_RE = r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$"


class InstitutionBase(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    short_name: str | None = Field(default=None, max_length=80)
    ror_id: str | None = None
    country: str | None = "USA"
    latex_address: str | None = None
    is_active: bool = True


class InstitutionCreate(InstitutionBase):
    pass


class InstitutionUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    ror_id: str | None = None
    country: str | None = None
    latex_address: str | None = None
    is_active: bool | None = None


class InstitutionOut(ORMModel, InstitutionBase):
    id: int


class AffiliationCreate(BaseModel):
    institution_id: int
    is_primary: bool = False
    start_date: date
    end_date: date | None = None


class AffiliationUpdate(BaseModel):
    is_primary: bool | None = None
    start_date: date | None = None
    end_date: date | None = None


class AffiliationOut(ORMModel):
    id: int
    institution: InstitutionOut
    is_primary: bool
    start_date: date
    end_date: date | None


class AuthorPeriodCreate(BaseModel):
    start_date: date
    end_date: date | None = None
    signing_name: str | None = None


class AuthorPeriodUpdate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    signing_name: str | None = None


class AuthorPeriodOut(ORMModel):
    id: int
    person_id: int
    start_date: date
    end_date: date | None
    signing_name: str | None


class PersonApply(BaseModel):
    given_name: str = Field(min_length=1, max_length=120)
    family_name: str = Field(min_length=1, max_length=120)
    preferred_name: str | None = None
    email: EmailStr
    orcid: str | None = Field(default=None, pattern=ORCID_RE)
    career_stage: CareerStage = CareerStage.other
    institution_id: int | None = None
    institution_name: str | None = None  # free text if not in the list yet
    is_voting: bool = False
    expertise: str | None = None
    notes: str | None = None

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower()


class PersonUpdate(BaseModel):
    given_name: str | None = None
    family_name: str | None = None
    preferred_name: str | None = None
    email: EmailStr | None = None
    orcid: str | None = Field(default=None, pattern=ORCID_RE)
    career_stage: CareerStage | None = None
    is_voting: bool | None = None
    expertise: str | None = None
    notes: str | None = None

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str | None) -> str | None:
        return v.lower() if v else v


class StatusChange(BaseModel):
    status: MemberStatus
    note: str | None = None


class PersonSummary(ORMModel):
    id: int
    given_name: str
    family_name: str
    preferred_name: str | None
    email: str
    orcid: str | None
    career_stage: CareerStage
    status: MemberStatus
    is_voting: bool
    photo_file: str | None = None


class PersonOut(PersonSummary):
    expertise: str | None
    notes: str | None
    status_changed_at: datetime | None
    affiliations: list[AffiliationOut] = []
    author_periods: list[AuthorPeriodOut] = []


class WorkingGroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    is_active: bool = True


class WorkingGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class WorkingGroupOut(ORMModel):
    id: int
    name: str
    slug: str
    description: str | None
    is_active: bool
    member_count: int = 0


class WGMemberAdd(BaseModel):
    person_id: int


class CollabRoleCreate(BaseModel):
    person_id: int
    role: CollabRoleType
    working_group_id: int | None = None
    institution_id: int | None = None
    start_date: date
    end_date: date | None = None


class CollabRoleOut(ORMModel):
    id: int
    person_id: int
    role: CollabRoleType
    working_group_id: int | None
    institution_id: int | None
    start_date: date
    end_date: date | None


class MembershipEventOut(ORMModel):
    id: int
    person_id: int
    from_status: str | None
    to_status: str
    actor_user_id: int | None
    note: str | None
    created_at: datetime
