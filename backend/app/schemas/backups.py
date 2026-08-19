from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# daily/weekly/monthly come from backup.sh's rotation; pre-restore holds the
# safety dumps restore.sh takes before overwriting anything; uploads holds
# .dump files admins upload through the restore flow.
BackupCategory = Literal["daily", "weekly", "monthly", "pre-restore", "uploads"]


class BackupSnapshot(BaseModel):
    category: BackupCategory
    filename: str
    size_bytes: int
    modified_at: datetime


class BackupStatus(BaseModel):
    snapshots: list[BackupSnapshot]  # newest first
    last_backup_at: datetime | None  # mtime of the newest rotated *.dump
    backup_hour_utc: str


class RestoreStatus(BaseModel):
    """Progress of the most recent restore, relayed from the status file the
    backup container writes (docker/backup/restore.sh)."""

    state: Literal["idle", "queued", "running", "success", "failed"] = "idle"
    detail: str | None = None
    backup: str | None = None
    at: datetime | None = None
