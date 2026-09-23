from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ORMModel


class EmailLogOut(ORMModel):
    id: int
    kind: str
    recipients: str
    subject: str
    body: str
    status: str  # sent | failed | disabled
    error: str | None
    context: str | None
    person_id: int | None
    actor_user_id: int | None
    created_at: datetime
    # Display labels filled by the router: the person the message is about
    # and the account whose action triggered it.
    person_name: str | None = None
    actor_login: str | None = None


class EmailLogPage(BaseModel):
    items: list[EmailLogOut]
    total: int
    # Every kind that has ever been logged, for the filter dropdown.
    kinds: list[str]


class EmailTestResult(BaseModel):
    # Where the test message was queued to, or why it was not.
    sent_to: list[str]
    email_enabled: bool
    detail: str
