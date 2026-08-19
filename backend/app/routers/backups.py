"""Admin backup panel (issue #109).

The nightly dumps are taken by the backup container (docker/backup); its
volume is mounted into the backend at settings.backups_dir so admins can see
what exists, pull a snapshot for offsite storage, and trigger a dump now.

A manual backup is a file handshake with the backup container: we drop
<backups_dir>/requests/<id>.request, its scheduler loop runs /backup.sh and
renames the file to .done or .failed, and we wait for that marker. Restores
stay a host-shell operation (scripts/restore.sh) on purpose.
"""

import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings
from app.models import User
from app.schemas.backups import BackupSnapshot, BackupStatus
from app.security import require_admin

router = APIRouter(tags=["backups"])

CATEGORIES = ("daily", "weekly", "monthly")
# What backup.sh produces (and nothing else): no leading dot, no separators,
# so a crafted download path can never leave the category directory.
_FILENAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def _audit_label(user: User) -> str:
    return f"user {user.id} ({user.username or user.orcid or 'unknown'})"


def _status() -> BackupStatus:
    settings = get_settings()
    root = Path(settings.backups_dir)
    snapshots: list[BackupSnapshot] = []
    for category in CATEGORIES:
        directory = root / category
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            if not path.is_file() or not _FILENAME_RE.fullmatch(path.name):
                continue
            stat = path.stat()
            snapshots.append(
                BackupSnapshot(
                    category=category,
                    filename=path.name,
                    size_bytes=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime, UTC),
                )
            )
    snapshots.sort(key=lambda s: (s.modified_at, s.filename), reverse=True)
    dumps = [s for s in snapshots if s.filename.endswith(".dump")]
    return BackupStatus(
        snapshots=snapshots,
        last_backup_at=dumps[0].modified_at if dumps else None,
        backup_hour_utc=settings.backup_hour,
    )


@router.get("/backups")
def backup_status(_user: User = Depends(require_admin)) -> BackupStatus:
    return _status()


@router.post("/backups/run")
def run_backup(user: User = Depends(require_admin)) -> BackupStatus:
    settings = get_settings()
    requests_dir = Path(settings.backups_dir) / "requests"
    try:
        requests_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise HTTPException(503, "Backup volume is not available")

    request = requests_dir / f"{uuid.uuid4().hex}.request"
    request.write_text(
        f"requested by {_audit_label(user)} at {datetime.now(UTC).isoformat()}\n"
    )
    print(f"[audit] manual backup triggered by {_audit_label(user)}", flush=True)

    done = request.with_suffix(".done")
    failed = request.with_suffix(".failed")
    deadline = time.monotonic() + settings.backup_trigger_timeout_seconds
    while time.monotonic() < deadline:
        if done.exists():
            done.unlink(missing_ok=True)
            return _status()
        if failed.exists():
            failed.unlink(missing_ok=True)
            raise HTTPException(502, "Backup failed — check the backup container logs")
        time.sleep(0.5)
    # Withdraw the request so it cannot fire long after the admin gave up
    # (best-effort: the container may pick it up in this instant, which then
    # just leaves a stale marker that its next restart sweeps away).
    request.unlink(missing_ok=True)
    raise HTTPException(504, "Backup timed out — is the backup container running?")


@router.get("/backups/download/{category}/{filename}")
def download_backup(
    category: str, filename: str, user: User = Depends(require_admin)
) -> FileResponse:
    if category not in CATEGORIES or not _FILENAME_RE.fullmatch(filename):
        raise HTTPException(404, "Snapshot not found")
    path = Path(get_settings().backups_dir) / category / filename
    if not path.is_file():
        raise HTTPException(404, "Snapshot not found")
    # A snapshot is the entire database — leave a trace of who took it.
    print(f"[audit] backup {category}/{filename} downloaded by {_audit_label(user)}", flush=True)
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
