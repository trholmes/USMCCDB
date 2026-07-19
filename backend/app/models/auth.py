import enum
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase


class UserRole(str, enum.Enum):
    admin = "admin"
    office = "office"
    member = "member"


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
