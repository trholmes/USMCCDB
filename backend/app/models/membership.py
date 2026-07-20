import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase


class CareerStage(str, enum.Enum):
    faculty = "faculty"
    staff = "staff"
    postdoc = "postdoc"
    grad = "grad"
    undergrad = "undergrad"
    engineer = "engineer"
    other = "other"


# Standard research areas; people.research_areas holds a comma-separated
# subset of these (normalized and validated in the schemas). A plain tuple
# rather than a DB enum so the multi-valued field fits one text column.
RESEARCH_AREAS = ("accelerator", "experiment", "theory", "other")


class MemberStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    inactive = "inactive"
    alumni = "alumni"
    rejected = "rejected"


class CollabRoleType(str, enum.Enum):
    chair = "chair"
    vice_chair = "vice_chair"
    ib_rep = "ib_rep"
    convener = "convener"
    speakers_chair = "speakers_chair"
    pub_chair = "pub_chair"
    secretary = "secretary"


class Person(TimestampedBase):
    __tablename__ = "people"
    __table_args__ = (
        Index("ix_people_name", "family_name", "given_name"),
        Index("ix_people_status", "status"),
    )

    given_name: Mapped[str] = mapped_column(String(120), nullable=False)
    family_name: Mapped[str] = mapped_column(String(120), nullable=False)
    preferred_name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    orcid: Mapped[str | None] = mapped_column(String(19), unique=True)
    career_stage: Mapped[CareerStage] = mapped_column(
        Enum(CareerStage, name="career_stage"), default=CareerStage.other, nullable=False
    )
    status: Mapped[MemberStatus] = mapped_column(
        Enum(MemberStatus, name="member_status"), default=MemberStatus.pending, nullable=False
    )
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Voting member per the USMCC charter (PhD-holding physicist at a US
    # institution, actively contributing).
    is_voting: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Comma-separated subset of RESEARCH_AREAS (accelerator/experiment/…).
    research_areas: Mapped[str | None] = mapped_column(Text)
    # Free-form comma-separated topics the member is focused on.
    expertise: Mapped[str | None] = mapped_column(Text)
    # Filename (relative to the photos volume) of the member's photo.
    photo_file: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)

    user = relationship("User", back_populates="person", uselist=False)
    affiliations = relationship(
        "Affiliation", back_populates="person", cascade="all, delete-orphan",
        order_by="Affiliation.start_date",
    )
    author_periods = relationship(
        "AuthorPeriod", back_populates="person", cascade="all, delete-orphan",
        order_by="AuthorPeriod.start_date",
    )
    collab_roles = relationship(
        "CollabRole", back_populates="person", cascade="all, delete-orphan"
    )
    wg_memberships = relationship(
        "WorkingGroupMember", back_populates="person", cascade="all, delete-orphan"
    )

    @property
    def display_name(self) -> str:
        return self.preferred_name or f"{self.given_name} {self.family_name}"


class Institution(TimestampedBase):
    __tablename__ = "institutions"

    name: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    short_name: Mapped[str | None] = mapped_column(String(80), unique=True)
    ror_id: Mapped[str | None] = mapped_column(String(40))
    country: Mapped[str | None] = mapped_column(String(80), default="USA")
    latex_address: Mapped[str | None] = mapped_column(Text)  # as printed on author lists
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    affiliations = relationship("Affiliation", back_populates="institution")


class Affiliation(TimestampedBase):
    __tablename__ = "affiliations"
    __table_args__ = (
        # At most one open (end_date IS NULL) primary affiliation per person.
        Index(
            "uq_one_open_primary_affiliation",
            "person_id",
            unique=True,
            postgresql_where=text("is_primary AND end_date IS NULL"),
        ),
    )

    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    institution_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)

    person = relationship("Person", back_populates="affiliations")
    institution = relationship("Institution", back_populates="affiliations")


class WorkingGroup(TimestampedBase):
    __tablename__ = "working_groups"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    members = relationship(
        "WorkingGroupMember", back_populates="working_group", cascade="all, delete-orphan"
    )


class WorkingGroupMember(TimestampedBase):
    __tablename__ = "working_group_members"
    __table_args__ = (UniqueConstraint("working_group_id", "person_id", name="uq_wg_person"),)

    working_group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("working_groups.id", ondelete="CASCADE"), nullable=False
    )
    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    working_group = relationship("WorkingGroup", back_populates="members")
    person = relationship("Person", back_populates="wg_memberships")


class CollabRole(TimestampedBase):
    __tablename__ = "collab_roles"
    __table_args__ = (
        CheckConstraint(
            "(role != 'convener') OR (working_group_id IS NOT NULL)",
            name="convener_requires_wg",
        ),
        CheckConstraint(
            "(role != 'ib_rep') OR (institution_id IS NOT NULL)",
            name="ib_rep_requires_institution",
        ),
    )

    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[CollabRoleType] = mapped_column(
        Enum(CollabRoleType, name="collab_role"), nullable=False
    )
    working_group_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("working_groups.id", ondelete="CASCADE")
    )
    institution_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("institutions.id", ondelete="CASCADE")
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)

    person = relationship("Person", back_populates="collab_roles")
    working_group = relationship("WorkingGroup")
    institution = relationship("Institution")


class MembershipEvent(TimestampedBase):
    """Append-only audit of membership status transitions."""

    __tablename__ = "membership_events"

    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    # Date the transition takes effect (as entered by the member/office);
    # may be back- or future-dated relative to created_at.
    effective_date: Mapped[date | None] = mapped_column(Date)
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)


class AuthorPeriod(TimestampedBase):
    """Authorship eligibility period — distinct from membership status."""

    __tablename__ = "author_periods"
    __table_args__ = (
        # Forbid overlapping eligibility periods per person (btree_gist ext).
        ExcludeConstraint(
            (text("person_id"), "="),
            (text("daterange(start_date, end_date, '[]')"), "&&"),
            using="gist",
            name="no_overlapping_author_periods",
        ),
    )

    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    signing_name: Mapped[str | None] = mapped_column(String(200))  # override for author lists

    person = relationship("Person", back_populates="author_periods")
