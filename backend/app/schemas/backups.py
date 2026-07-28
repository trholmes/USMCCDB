from datetime import datetime
from typing import Literal

from pydantic import BaseModel

BackupCategory = Literal["daily", "weekly", "monthly"]


class BackupSnapshot(BaseModel):
    category: BackupCategory
    filename: str
    size_bytes: int
    modified_at: datetime


class BackupStatus(BaseModel):
    snapshots: list[BackupSnapshot]  # newest first
    last_backup_at: datetime | None  # mtime of the newest *.dump
    backup_hour_utc: str
