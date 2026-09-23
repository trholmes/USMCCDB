from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TimestampedBase


class EmailLog(TimestampedBase):
    """Every notification email the system tried to send (issue #166), shown
    in the admin panel's Email tab. Written by services.email.send_email from
    the background task, whatever the outcome: `sent`, `failed` (SMTP error,
    kept in `error`), or `disabled` (SMTP_HOST unset — what *would* have gone
    out). Links to the person the message is about and the account whose
    action triggered it survive their deletion as NULL."""

    __tablename__ = "email_log"

    # Notification key, e.g. registration_submitted (see docs/NOTIFICATIONS.md).
    kind: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    recipients: Mapped[str] = mapped_column(Text, nullable=False)  # comma-separated
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    error: Mapped[str | None] = mapped_column(Text)
    context: Mapped[str | None] = mapped_column(String(200))
    person_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("people.id", ondelete="SET NULL"), index=True
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
