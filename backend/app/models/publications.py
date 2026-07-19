import enum
from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    Enum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase


class PublicationType(str, enum.Enum):
    paper = "paper"
    proceedings = "proceedings"
    note = "note"
    white_paper = "white_paper"


class PublicationStatus(str, enum.Enum):
    proposed = "proposed"
    in_progress = "in_progress"
    collab_review = "collab_review"
    submitted = "submitted"
    published = "published"


class PublicationPersonRole(str, enum.Enum):
    editor = "editor"
    contact = "contact"
    analysis_contact = "analysis_contact"


class Publication(TimestampedBase):
    __tablename__ = "publications"

    title: Mapped[str] = mapped_column(String(600), nullable=False, index=True)
    short_code: Mapped[str | None] = mapped_column(String(60), unique=True)
    pub_type: Mapped[PublicationType] = mapped_column(
        Enum(PublicationType, name="pub_type"), default=PublicationType.paper, nullable=False
    )
    status: Mapped[PublicationStatus] = mapped_column(
        Enum(PublicationStatus, name="pub_status"),
        default=PublicationStatus.proposed,
        nullable=False,
        index=True,
    )
    working_group_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("working_groups.id", ondelete="SET NULL")
    )
    arxiv_id: Mapped[str | None] = mapped_column(String(40))
    doi: Mapped[str | None] = mapped_column(String(120))
    journal: Mapped[str | None] = mapped_column(String(200))
    target_journal: Mapped[str | None] = mapped_column(String(200))
    abstract: Mapped[str | None] = mapped_column(Text)
    author_cutoff_date: Mapped[date | None] = mapped_column(Date)

    working_group = relationship("WorkingGroup")
    people = relationship(
        "PublicationPerson", back_populates="publication", cascade="all, delete-orphan"
    )
    author_lists = relationship("AuthorList", back_populates="publication")


class PublicationPerson(TimestampedBase):
    __tablename__ = "publication_people"
    __table_args__ = (
        UniqueConstraint("publication_id", "person_id", "role", name="uq_pub_person_role"),
    )

    publication_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("publications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[PublicationPersonRole] = mapped_column(
        Enum(PublicationPersonRole, name="pub_person_role"), nullable=False
    )

    publication = relationship("Publication", back_populates="people")
    person = relationship("Person")


class PublicationEvent(TimestampedBase):
    """Append-only audit of publication status transitions."""

    __tablename__ = "publication_events"

    publication_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("publications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)
