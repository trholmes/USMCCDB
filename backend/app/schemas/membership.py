from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models import CareerStage, CollabRoleType, MemberStatus
from app.models.membership import RESEARCH_AREAS
from app.schemas.common import ORMModel

ORCID_RE = r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$"


def _normalize_research_areas(v: str | None) -> str | None:
    """people.research_areas is a comma-separated subset of RESEARCH_AREAS:
    match case-insensitively, normalize to the canonical names, drop
    duplicates, reject unknown values."""
    if v is None:
        return None
    canonical = {a.lower(): a for a in RESEARCH_AREAS}
    values: list[str] = []
    unknown: list[str] = []
    for token in v.split(","):
        token = token.strip()
        if not token:
            continue
        area = canonical.get(token.lower())
        if area is None:
            unknown.append(token)
        elif area not in values:
            values.append(area)
    if unknown:
        raise ValueError(
            f"unknown research area(s): {', '.join(unknown)}; "
            f"allowed: {', '.join(RESEARCH_AREAS)}"
        )
    return ", ".join(values) or None


def _check_date_order(start_date: date | None, end_date: date | None) -> None:
    """Date ranges are inclusive on both ends; an inverted range matches no
    cutoff date, silently dropping the person from author lists (issue #61)."""
    if start_date is not None and end_date is not None and end_date < start_date:
        raise ValueError("end_date must be on or after start_date")


def _check_new_institution_is_us(
    institution_id: int | None, institution_name: str | None, institution_is_us: bool | None
) -> None:
    """A new institution proposed by free text must be declared US or non-US
    by the proposer — `is_us` gates voting eligibility, so it is never
    defaulted (issue #56)."""
    if institution_id is None and (institution_name or "").strip() and institution_is_us is None:
        raise ValueError(
            "institution_is_us is required when naming an institution not in the list"
        )


class InstitutionBase(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    short_name: str | None = Field(default=None, max_length=80)
    ror_id: str | None = None
    country: str | None = "USA"
    # US-based — gates voting eligibility for currently affiliated people.
    is_us: bool = True
    latex_address: str | None = None
    is_active: bool = True


class InstitutionCreate(InstitutionBase):
    pass


class InstitutionUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    ror_id: str | None = None
    country: str | None = None
    is_us: bool | None = None
    latex_address: str | None = None
    is_active: bool | None = None


class InstitutionOut(ORMModel, InstitutionBase):
    id: int
    # People currently affiliated (open affiliations); filled by the router.
    people_count: int = 0


class InstitutionRef(ORMModel):
    """Small reference used for cross-links (directory rows, etc.)."""

    id: int
    name: str
    short_name: str | None


class AffiliationCreate(BaseModel):
    institution_id: int
    is_primary: bool = False
    # Stage held while at this institution; None = unknown/unrecorded.
    career_stage: CareerStage | None = None
    start_date: date
    end_date: date | None = None

    @model_validator(mode="after")
    def check_date_order(self) -> "AffiliationCreate":
        _check_date_order(self.start_date, self.end_date)
        return self


class AffiliationUpdate(BaseModel):
    is_primary: bool | None = None
    career_stage: CareerStage | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def check_date_order(self) -> "AffiliationUpdate":
        # Partial updates: when only one bound is sent, the router re-checks
        # the merged row against the stored other bound.
        _check_date_order(self.start_date, self.end_date)
        return self


class AffiliationOut(ORMModel):
    id: int
    institution: InstitutionOut
    is_primary: bool
    career_stage: CareerStage | None
    start_date: date
    end_date: date | None


class AuthorPeriodCreate(BaseModel):
    start_date: date
    end_date: date | None = None
    signing_name: str | None = None

    @model_validator(mode="after")
    def check_date_order(self) -> "AuthorPeriodCreate":
        _check_date_order(self.start_date, self.end_date)
        return self


class AuthorPeriodUpdate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    signing_name: str | None = None

    @model_validator(mode="after")
    def check_date_order(self) -> "AuthorPeriodUpdate":
        # Partial updates: when only one bound is sent, the router re-checks
        # the merged row against the stored other bound.
        _check_date_order(self.start_date, self.end_date)
        return self


class AuthorPeriodOut(ORMModel):
    id: int
    person_id: int
    start_date: date
    end_date: date | None
    signing_name: str | None


class PersonRegistration(BaseModel):
    given_name: str = Field(min_length=1, max_length=120)
    middle_name: str | None = Field(default=None, max_length=120)
    family_name: str = Field(min_length=1, max_length=120)
    preferred_name: str | None = None
    email: EmailStr
    orcid: str | None = Field(default=None, pattern=ORCID_RE)
    career_stage: CareerStage = CareerStage.other
    # Charter institutional info: professional title in the organization,
    # department, and percent of research time devoted to the USMCC.
    professional_title: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=200)
    usmcc_percent: int | None = Field(default=None, ge=0, le=100)
    institution_id: int | None = None
    institution_name: str | None = None  # free text if not in the list yet
    # Whether the free-text institution is US-based; required with
    # institution_name (see _check_new_institution_is_us).
    institution_is_us: bool | None = None
    is_voting: bool = False
    research_areas: str | None = None
    expertise: str | None = None
    notes: str | None = None

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower()

    @field_validator("research_areas")
    @classmethod
    def check_research_areas(cls, v: str | None) -> str | None:
        return _normalize_research_areas(v)

    @model_validator(mode="after")
    def require_new_institution_is_us(self) -> "PersonRegistration":
        _check_new_institution_is_us(
            self.institution_id, self.institution_name, self.institution_is_us
        )
        return self


class PersonUpdate(BaseModel):
    given_name: str | None = None
    middle_name: str | None = Field(default=None, max_length=120)
    family_name: str | None = None
    preferred_name: str | None = None
    email: EmailStr | None = None
    orcid: str | None = Field(default=None, pattern=ORCID_RE)
    career_stage: CareerStage | None = None
    professional_title: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=200)
    usmcc_percent: int | None = Field(default=None, ge=0, le=100)
    is_voting: bool | None = None
    research_areas: str | None = None
    expertise: str | None = None
    notes: str | None = None

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str | None) -> str | None:
        return v.lower() if v else v

    @field_validator("research_areas")
    @classmethod
    def check_research_areas(cls, v: str | None) -> str | None:
        return _normalize_research_areas(v)


class StatusChange(BaseModel):
    status: MemberStatus
    # When the change takes effect; defaults to today if omitted.
    effective_date: date | None = None
    note: str | None = None


class InstitutionChange(BaseModel):
    """Self-service / office move to a new primary institution as of a date."""

    institution_id: int | None = None
    institution_name: str | None = None  # free text if not in the list yet
    # Whether the free-text institution is US-based; required with
    # institution_name (see _check_new_institution_is_us).
    institution_is_us: bool | None = None
    start_date: date
    # Optional new career stage taken up with the move; None keeps the
    # person's current stage (which is stamped on the new affiliation).
    career_stage: CareerStage | None = None

    @model_validator(mode="after")
    def require_new_institution_is_us(self) -> "InstitutionChange":
        _check_new_institution_is_us(
            self.institution_id, self.institution_name, self.institution_is_us
        )
        return self


class RegistrationAck(BaseModel):
    """The one answer public registration gives, duplicate or not — the
    response must not confirm whether an email/ORCID iD is already a member
    record (issue #62)."""

    detail: str


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
    research_areas: str | None = None
    # Current primary institution, populated on directory listings.
    primary_institution: InstitutionRef | None = None


class WorkingGroupRef(ORMModel):
    """Small reference used for cross-links (collab-role rows, etc.)."""

    id: int
    name: str
    slug: str


class PersonOut(PersonSummary):
    middle_name: str | None = None
    professional_title: str | None = None
    department: str | None = None
    usmcc_percent: int | None = None
    expertise: str | None
    notes: str | None
    status_changed_at: datetime | None
    affiliations: list[AffiliationOut] = []
    author_periods: list[AuthorPeriodOut] = []
    # Working groups the person belongs to; filled by the router.
    working_groups: list[WorkingGroupRef] = []


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
    # Qualifier for generic roles ("Accelerator" representative, "Outreach"
    # coordinator, focus area for leads, full title for `other`).
    detail: str | None = Field(default=None, max_length=200)
    working_group_id: int | None = None
    institution_id: int | None = None
    start_date: date
    end_date: date | None = None

    @field_validator("detail")
    @classmethod
    def strip_detail(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class CollabRoleUpdate(BaseModel):
    detail: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None

    @field_validator("detail")
    @classmethod
    def strip_detail(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class CollabRoleOut(ORMModel):
    id: int
    person_id: int
    role: CollabRoleType
    detail: str | None
    working_group_id: int | None
    institution_id: int | None
    start_date: date
    end_date: date | None
    # Populated on listings so role holders can be shown by name.
    person: PersonSummary | None = None
    working_group: WorkingGroupRef | None = None
    institution: InstitutionRef | None = None


class MembershipEventOut(ORMModel):
    id: int
    person_id: int
    from_status: str | None
    to_status: str
    effective_date: date | None
    actor_user_id: int | None
    note: str | None
    created_at: datetime


class LabelCount(BaseModel):
    """One row of a categorical breakdown in the membership statistics."""

    label: str
    count: int


class MonthCount(BaseModel):
    month: str  # "YYYY-MM"
    count: int
    # Same count broken down by research area. The field is multi-valued per
    # person, so the per-area numbers can add up to more than count.
    areas: dict[str, int] = Field(default_factory=dict)


class MemberStats(BaseModel):
    total_people: int  # every person record, regardless of status
    active: int
    voting: int  # active voting members
    us_active: int  # active members currently at a US institution
    institutions_with_active: int  # institutions hosting >=1 active member
    by_status: list[LabelCount]
    by_career_stage: list[LabelCount]  # active members only
    # Active members per research area; the field is multi-valued, so these
    # counts can add up to more than the active total.
    by_research_area: list[LabelCount]
    # First activation per person, bucketed by calendar month; months with no
    # activations between the first and last are included with count 0.
    new_members_by_month: list[MonthCount]
    # Effort on the USMCC, from the self-reported usmcc_percent of active
    # members. The field is optional, so aggregates cover only those reporting.
    usmcc_reporting: int  # active members with a reported percentage
    avg_usmcc_percent: float | None  # mean percentage over those reporting
    # Distribution of the reported percentages, bucketed to match the ranges
    # offered on the registration form; every bucket is present (count 0 if empty).
    by_usmcc_percent: list[LabelCount]
    usmcc_fte: float  # summed reported effort, in full-time equivalents
