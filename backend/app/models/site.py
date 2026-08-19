from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TimestampedBase


class SiteSetting(TimestampedBase):
    """Key/value store for runtime site configuration edited from the admin
    panel (announcement banner, login-page message) — settings that must be
    changeable without redeploying, unlike the env-based app config."""

    __tablename__ = "site_settings"

    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
