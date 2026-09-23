"""Outgoing email.

Plain SMTP (STARTTLS by default), configured via SMTP_* settings. When
SMTP_HOST is unset — dev, tests, or an instance that simply doesn't want
mail — sends become logged no-ops, so callers never need to check first.
Delivery failures are logged, never raised: notification mail must not
break the API request that triggered it. Callers should send from a
FastAPI BackgroundTask so the response doesn't wait on the SMTP server.

Every send — delivered, failed, or skipped because email is disabled — is
recorded in email_log (issue #166) for the admin panel's Email tab. The row
is written from the background task with its own session, because the
request's session is closed by the time the task runs.
"""

import logging
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage

from app.config import get_settings

log = logging.getLogger(__name__)


@dataclass
class Message:
    """A composed notification: who gets it and what it says, plus the
    bookkeeping the email log shows. `kind` is the notification's key (see
    docs/NOTIFICATIONS.md); `person_id` is the member the message is about,
    when there is one; `actor_user_id` is the account whose action triggered
    it."""

    to: list[str]
    subject: str
    body: str
    kind: str = "other"
    person_id: int | None = None
    actor_user_id: int | None = None
    # Free-form context for the log ("talk #12", "publication USMCC-PUB-…").
    context: str | None = None
    # Populated by send_email so tests and the log can see the final list.
    recipients: list[str] = field(default_factory=list)


def _deliver(msg: EmailMessage) -> None:
    s = get_settings()
    if s.smtp_tls == "ssl":
        with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=20) as smtp:
            if s.smtp_username:
                smtp.login(s.smtp_username, s.smtp_password)
            smtp.send_message(msg)
        return
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        if s.smtp_tls == "starttls":
            smtp.starttls()
        if s.smtp_username:
            smtp.login(s.smtp_username, s.smtp_password)
        smtp.send_message(msg)


def _record(message: Message, status: str, error: str | None) -> None:
    # Imported here: app.db builds the engine from settings at import time,
    # and this module must stay importable by anything that only composes.
    from app.db import SessionLocal
    from app.models.notifications import EmailLog

    try:
        with SessionLocal() as db:
            db.add(
                EmailLog(
                    kind=message.kind[:60],
                    recipients=", ".join(message.recipients),
                    subject=message.subject[:300],
                    body=message.body,
                    status=status,
                    error=(error or None) and error[:2000],
                    person_id=message.person_id,
                    actor_user_id=message.actor_user_id,
                    context=(message.context or None) and message.context[:200],
                )
            )
            db.commit()
    except Exception:
        log.exception("Could not record %r in the email log", message.subject)


def send_email(message: Message) -> None:
    """Deliver a composed Message (from a BackgroundTask) and log the outcome."""
    s = get_settings()
    message.recipients = sorted({addr for addr in message.to if addr})
    if not message.recipients:
        return
    if not s.email_enabled:
        log.info(
            "Email disabled (SMTP_HOST unset); would send %r to %s",
            message.subject,
            message.recipients,
        )
        _record(message, "disabled", None)
        return
    msg = EmailMessage()
    msg["From"] = s.email_from or s.contact_email
    msg["To"] = ", ".join(message.recipients)
    msg["Subject"] = message.subject
    msg.set_content(message.body)
    try:
        _deliver(msg)
    except Exception as exc:
        log.exception("Failed to send %r to %s", message.subject, message.recipients)
        _record(message, "failed", f"{type(exc).__name__}: {exc}")
        return
    _record(message, "sent", None)
