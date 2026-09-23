"""Admin view of every notification email the system tried to send (issue
#166): what went out, to whom, and whether SMTP accepted it. Read-only apart
from the test-email endpoint, which sends the admin a message at their own
address so an SMTP setup can be verified from the panel."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import EmailLog, Person, User
from app.schemas.notifications import EmailLogOut, EmailLogPage, EmailTestResult
from app.security import require_admin
from app.services import notifications

router = APIRouter(
    prefix="/email-log", tags=["site"], dependencies=[Depends(require_admin)]
)


@router.get("")
def list_email_log(
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    kind: str | None = None,
    status: str | None = None,
    q: str | None = Query(default=None, description="subject / recipient search"),
) -> EmailLogPage:
    """Newest first, with the display labels the panel needs."""
    stmt = select(EmailLog)
    if kind:
        stmt = stmt.where(EmailLog.kind == kind)
    if status:
        stmt = stmt.where(EmailLog.status == status)
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(EmailLog.subject.ilike(needle), EmailLog.recipients.ilike(needle))
        )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(EmailLog.id.desc()).offset(offset).limit(limit)).scalars().all()

    person_ids = {r.person_id for r in rows if r.person_id is not None}
    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id is not None}
    people = (
        {
            p.id: p.display_name
            for p in db.execute(select(Person).where(Person.id.in_(person_ids))).scalars()
        }
        if person_ids
        else {}
    )
    actors = (
        {
            u.id: (u.username or u.orcid or f"#{u.id}")
            for u in db.execute(select(User).where(User.id.in_(actor_ids))).scalars()
        }
        if actor_ids
        else {}
    )
    items = []
    for row in rows:
        item = EmailLogOut.model_validate(row)
        item.person_name = people.get(row.person_id) if row.person_id else None
        item.actor_login = actors.get(row.actor_user_id) if row.actor_user_id else None
        items.append(item)
    kinds = sorted(db.execute(select(EmailLog.kind).distinct()).scalars())
    return EmailLogPage(items=items, total=total, kinds=kinds)


@router.post("/test", status_code=202)
def send_test_email(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> EmailTestResult:
    """Queue a test message to the calling admin's own address; the outcome
    shows up in the log like any other send."""
    msg = notifications.test_message(db, user)
    if msg is None:
        raise HTTPException(
            400, "Your account has no person (and so no email address) linked to it"
        )
    notifications.queue(background, msg)
    enabled = get_settings().email_enabled
    return EmailTestResult(
        sent_to=sorted(set(msg.to)),
        email_enabled=enabled,
        detail=(
            "Test email queued; check the log below for the delivery result."
            if enabled
            else "SMTP_HOST is not set, so nothing is delivered — the message is "
            "logged as 'disabled' below."
        ),
    )
