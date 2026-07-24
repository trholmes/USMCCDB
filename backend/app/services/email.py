"""Outgoing email.

Plain SMTP (STARTTLS by default), configured via SMTP_* settings. When
SMTP_HOST is unset — dev, tests, or an instance that simply doesn't want
mail — sends become logged no-ops, so callers never need to check first.
Delivery failures are logged, never raised: notification mail must not
break the API request that triggered it. Callers should send from a
FastAPI BackgroundTask so the response doesn't wait on the SMTP server.
"""

import logging
import smtplib
from email.message import EmailMessage

from app.config import get_settings

log = logging.getLogger(__name__)


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


def send_email(to: list[str], subject: str, body: str) -> None:
    s = get_settings()
    recipients = sorted({addr for addr in to if addr})
    if not recipients:
        return
    if not s.email_enabled:
        log.info("Email disabled (SMTP_HOST unset); would send %r to %s", subject, recipients)
        return
    msg = EmailMessage()
    msg["From"] = s.email_from or s.contact_email
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        _deliver(msg)
    except Exception:
        log.exception("Failed to send %r to %s", subject, recipients)
