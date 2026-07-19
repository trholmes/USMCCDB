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


class TalkType(str, enum.Enum):
    plenary = "plenary"
    parallel = "parallel"
    poster = "poster"
    seminar = "seminar"
    outreach = "outreach"


class TalkStatus(str, enum.Enum):
    open = "open"
    nominations = "nominations"
    assigned = "assigned"
    given = "given"
    cancelled = "cancelled"


class NominationStatus(str, enum.Enum):
    nominated = "nominated"
    shortlisted = "shortlisted"
    assigned = "assigned"
    declined = "declined"
    withdrawn = "withdrawn"


class Event(TimestampedBase):
    """A conference / workshop / meeting talks can belong to."""

    __tablename__ = "events"

    name: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    url: Mapped[str | None] = mapped_column(String(500))
    location: Mapped[str | None] = mapped_column(String(300))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    abstract_deadline: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    talks = relationship("Talk", back_populates="event")


class Talk(TimestampedBase):
    __tablename__ = "talks"

    event_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("events.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    talk_type: Mapped[TalkType] = mapped_column(
        Enum(TalkType, name="talk_type"), default=TalkType.parallel, nullable=False
    )
    date: Mapped[date | None] = mapped_column(Date, index=True)
    working_group_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("working_groups.id", ondelete="SET NULL")
    )
    speaker_person_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[TalkStatus] = mapped_column(
        Enum(TalkStatus, name="talk_status"), default=TalkStatus.open, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text)

    event = relationship("Event", back_populates="talks")
    working_group = relationship("WorkingGroup")
    speaker = relationship("Person")
    nominations = relationship(
        "Nomination", back_populates="talk", cascade="all, delete-orphan"
    )


class Nomination(TimestampedBase):
    __tablename__ = "nominations"
    __table_args__ = (UniqueConstraint("talk_id", "person_id", name="uq_talk_person"),)

    talk_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("talks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nominated_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[NominationStatus] = mapped_column(
        Enum(NominationStatus, name="nomination_status"),
        default=NominationStatus.nominated,
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(Text)

    talk = relationship("Talk", back_populates="nominations")
    person = relationship("Person")
