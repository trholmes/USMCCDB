#!/bin/sh
# Restore the database from a dump inside the backups volume.
# Usage: /restore.sh daily/usmccdb-2026-07-19.dump
# DROPS AND RECREATES the current schema. Stop the backend first
# (scripts/restore.sh on the host handles that).
set -eu

if [ $# -ne 1 ] || [ ! -f "/backups/$1" ]; then
    echo "Usage: /restore.sh <path-relative-to-/backups>" >&2
    echo "Available dumps:" >&2
    find /backups -name '*.dump' | sort >&2
    exit 1
fi

echo "[restore] restoring /backups/$1 into ${PGDATABASE}"
pg_restore --clean --if-exists --no-owner -d "${PGDATABASE}" "/backups/$1"
echo "[restore] done"
