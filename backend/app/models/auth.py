import enum
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase


class UserRole(str, enum.Enum):
    """Account permission level, ordered from most to least privileged.

    Assigned explicitly by an admin — never derived from a person's
    leadership positions (collab_roles). The admin alerts panel suggests
    a change when an active position and the account's role disagree
    (issue #167); the admin decides.
    """

    admin = "admin"
    # Collaboration office: membership moderation, institutions, everything
    # below.
    office = "office"
    # Leadership Council representatives and deputy representatives: working
    # groups and their conveners, plus everything the speakers committee can do.
    leadership = "leadership"
    # Speakers committee: full edit access to talks, events and nominations.
    speakers = "speakers"
    member = "member"


# Rank for "at least this role" comparisons and for picking the more
# privileged role when merging accounts.
ROLE_RANK = {
    UserRole.member: 0,
    UserRole.speakers: 1,
    UserRole.leadership: 2,
    UserRole.office: 3,
    UserRole.admin: 4,
}


class User(TimestampedBase):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "username IS NOT NULL OR orcid IS NOT NULL",
            name="user_has_username_or_orcid",
        ),
    )

    person_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="SET NULL"), unique=True
    )
    username: Mapped[str | None] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    orcid: Mapped[str | None] = mapped_column(String(19), unique=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), default=UserRole.member, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    person = relationship("Person", back_populates="user", foreign_keys=[person_id])


class LoginEvent(TimestampedBase):
    """Append-only sign-in audit shown in the admin panel's login history.
    Failed local attempts keep the username tried (no user row to point at);
    the user link survives account deletion as NULL."""

    __tablename__ = "login_events"

    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    method: Mapped[str] = mapped_column(String(20), nullable=False)  # local | orcid
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    username_attempted: Mapped[str | None] = mapped_column(String(80))
    ip: Mapped[str | None] = mapped_column(String(64))
