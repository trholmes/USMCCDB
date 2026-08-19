from pathlib import Path

from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Institution, Person, Publication, SiteSetting, Talk, User
from app.schemas.site import PublicSiteSettings, SiteSettingsUpdate, SystemStatus
from app.security import require_admin

router = APIRouter(prefix="/site", tags=["site"])

# The runtime-editable settings; anything else PATCHed is rejected by the
# schema. Values live in site_settings as plain strings.
SETTING_KEYS = ("banner_message", "banner_level", "login_message")


def get_site_settings(db: Session) -> dict[str, str]:
    rows = db.execute(select(SiteSetting).where(SiteSetting.key.in_(SETTING_KEYS))).scalars()
    return {s.key: s.value for s in rows}


def _public_out(values: dict[str, str]) -> PublicSiteSettings:
    level = values.get("banner_level")
    return PublicSiteSettings(
        banner_message=values.get("banner_message") or None,
        banner_level=level if level in ("info", "warning", "critical") else "info",
        login_message=values.get("login_message") or None,
    )


@router.get("/settings")
def public_settings(db: Session = Depends(get_db)) -> PublicSiteSettings:
    """Unauthenticated: the login page shows login_message and everyone sees
    the announcement banner, session or not."""
    return _public_out(get_site_settings(db))


@router.patch("/settings", dependencies=[Depends(require_admin)])
def update_settings(body: SiteSettingsUpdate, db: Session = Depends(get_db)) -> PublicSiteSettings:
    changes = body.model_dump(exclude_unset=True)
    existing = {
        s.key: s
        for s in db.execute(
            select(SiteSetting).where(SiteSetting.key.in_(changes.keys()))
        ).scalars()
    }
    for key, value in changes.items():
        value = (value or "").strip()
        if not value:
            # Empty clears the setting (banner taken down, message removed).
            if key in existing:
                db.delete(existing[key])
        elif key in existing:
            existing[key].value = value
        else:
            db.add(SiteSetting(key=key, value=value))
    db.commit()
    return _public_out(get_site_settings(db))


def _code_revision() -> str | None:
    """Newest migration shipped with this code (alembic head)."""
    try:
        ini = Path(__file__).resolve().parents[2] / "alembic.ini"
        script = ScriptDirectory.from_config(AlembicConfig(str(ini)))
        return script.get_current_head()
    except Exception:
        return None


@router.get("/system", dependencies=[Depends(require_admin)])
def system_status(db: Session = Depends(get_db)) -> SystemStatus:
    """Self-diagnosis for the admin panel: database size, record counts, and
    whether the database schema is behind the code's migrations."""
    db_size = db.execute(text("SELECT pg_database_size(current_database())")).scalar_one()
    counts = {
        "people": db.execute(select(func.count()).select_from(Person)).scalar_one(),
        "users": db.execute(select(func.count()).select_from(User)).scalar_one(),
        "institutions": db.execute(
            select(func.count()).select_from(Institution)
        ).scalar_one(),
        "publications": db.execute(
            select(func.count()).select_from(Publication)
        ).scalar_one(),
        "talks": db.execute(select(func.count()).select_from(Talk)).scalar_one(),
    }
    code_rev = _code_revision()
    try:
        db_rev = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        # Fresh installs get the schema from metadata.create_all and have no
        # alembic_version table; that's current by construction, not pending.
        db.rollback()
        db_rev = None
    pending = bool(code_rev and db_rev and code_rev != db_rev)
    return SystemStatus(
        db_size_bytes=db_size,
        counts=counts,
        code_revision=code_rev,
        db_revision=db_rev,
        migrations_pending=pending,
        backup_hour_utc=get_settings().backup_hour or None,
    )
