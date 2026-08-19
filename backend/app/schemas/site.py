from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

BannerLevel = Literal["info", "warning", "critical"]


class PublicSiteSettings(BaseModel):
    """Runtime settings safe to serve unauthenticated — the login page needs
    them before any session exists."""

    banner_message: str | None = None
    banner_level: BannerLevel = "info"
    login_message: str | None = None


class SiteSettingsUpdate(BaseModel):
    # None = leave unchanged (exclude_unset); empty string = clear the setting.
    banner_message: str | None = Field(default=None, max_length=2000)
    banner_level: BannerLevel | None = None
    login_message: str | None = Field(default=None, max_length=4000)


class SystemStatus(BaseModel):
    db_size_bytes: int
    counts: dict[str, int]
    # Newest migration shipped with the code vs. the one the database is at;
    # a mismatch means `alembic upgrade head` is due.
    code_revision: str | None
    db_revision: str | None
    migrations_pending: bool
    backup_hour_utc: str | None = None


class LoginEventOut(ORMModel):
    id: int
    user_id: int | None
    method: str
    success: bool
    username_attempted: str | None
    ip: str | None
    created_at: datetime
    # Display label of the account (username or ORCID iD); filled by the router.
    login: str | None = None
