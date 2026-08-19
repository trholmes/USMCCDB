"""Admin backup panel (issue #109).

The nightly dumps are taken by the backup container (docker/backup); its
volume is mounted into the backend at settings.backups_dir so admins can see
what exists, pull a snapshot for offsite storage, and trigger a dump now.

A manual backup is a file handshake with the backup container: we drop
<backups_dir>/requests/<id>.request, its scheduler loop runs /backup.sh and
renames the file to .done or .failed, and we wait for that marker.

Restores work the same way (DOCENT-inspired): this router only validates and
stages — the actual pg_restore runs in the backup container, which ships the
Postgres tools, always takes a pre-restore safety dump first, and writes its
progress to <backups_dir>/restore-status for the panel to poll.
"""

import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import get_settings
from app.models import User
from app.schemas.backups import BackupSnapshot, BackupStatus, RestoreStatus
from app.security import require_admin

router = APIRouter(tags=["backups"])

CATEGORIES = ("daily", "weekly", "monthly", "pre-restore", "uploads")
# Rotated dumps only — pre-restore safety copies and uploads must not make a
# stale nightly schedule look healthy.
ROTATED = ("daily", "weekly", "monthly")
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
    dumps = [
        s for s in snapshots if s.category in ROTATED and s.filename.endswith(".dump")
    ]
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


def _restore_status_file() -> Path:
    return Path(get_settings().backups_dir) / "restore-status"


def _read_restore_status() -> RestoreStatus:
    path = _restore_status_file()
    if not path.is_file():
        return RestoreStatus()
    data: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
    at = None
    if data.get("at"):
        try:
            at = datetime.fromisoformat(data["at"].replace("Z", "+00:00"))
        except ValueError:
            at = None
    state = data.get("state")
    if state not in ("queued", "running", "success", "failed"):
        state = "idle"
    return RestoreStatus(
        state=state, detail=data.get("detail") or None, backup=data.get("backup") or None, at=at
    )


@router.get("/backups/restore-status")
def restore_status(_user: User = Depends(require_admin)) -> RestoreStatus:
    return _read_restore_status()


@router.post("/backups/restore", status_code=202)
async def restore_backup(
    user: User = Depends(require_admin),
    confirm: str = Form(...),
    path: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
) -> RestoreStatus:
    """Restore the database (and same-day photo snapshot, when one exists)
    from a server-side backup or an uploaded .dump.

    Destructive — it overwrites all current data — so it requires typing
    RESTORE to confirm, and the backup container takes a fresh pre-restore
    dump first so a mistaken restore is always recoverable. This endpoint
    only stages the file and drops the sentinel the container polls for."""
    root = Path(get_settings().backups_dir)
    if not root.is_dir():
        raise HTTPException(503, "Backup volume is not available")
    if confirm.strip().upper() != "RESTORE":
        raise HTTPException(400, "Type RESTORE to confirm — this overwrites all current data")
    current = _read_restore_status()
    if current.state in ("queued", "running"):
        raise HTTPException(409, "A restore is already in progress")

    has_upload = file is not None and bool((file.filename or "").strip())
    has_path = bool(path and path.strip())
    if has_upload == has_path:
        raise HTTPException(400, "Choose either an existing backup or an uploaded .dump file")

    if has_upload:
        # pg_dump custom-format archives start with the magic bytes "PGDMP";
        # reject anything else before it ever reaches pg_restore.
        head = await file.read(5)
        if head != b"PGDMP":
            raise HTTPException(400, "That file isn't a pg_dump archive (.dump)")
        uploads = root / "uploads"
        uploads.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        target = uploads / f"upload-{stamp}.dump"
        with target.open("wb") as out:
            out.write(head)
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
        rel = f"uploads/{target.name}"
    else:
        category, _, filename = path.strip().partition("/")
        if (
            category not in CATEGORIES
            or not _FILENAME_RE.fullmatch(filename)
            or not filename.endswith(".dump")
            or not (root / category / filename).is_file()
        ):
            raise HTTPException(404, "Backup not found")
        rel = f"{category}/{filename}"

    requests_dir = root / "requests"
    requests_dir.mkdir(parents=True, exist_ok=True)
    # Show "queued" immediately; the container's restore.sh overwrites this
    # the moment it picks the request up.
    _restore_status_file().write_text(
        f"state=queued\nat={datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
        f"backup={rel}\ndetail=waiting for the backup container\n"
    )
    (requests_dir / f"{uuid.uuid4().hex}.restore").write_text(f"{rel}\n")
    print(f"[audit] restore from {rel} requested by {_audit_label(user)}", flush=True)
    return _read_restore_status()


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
