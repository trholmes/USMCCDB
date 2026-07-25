#!/bin/sh
# Restore the database — and member photos, when a snapshot is available —
# from the backups volume.
# Usage: /restore.sh daily/usmccdb-2026-07-19.dump [daily/photos-2026-07-19.tar.gz]
# Without a second argument, the photos snapshot taken alongside the dump
# (same directory, same date) is restored if it exists.
# DROPS AND RECREATES the current schema and REPLACES the photos volume
# contents. Stop the backend first (scripts/restore.sh on the host handles
# that).
set -eu

if [ $# -lt 1 ] || [ $# -gt 2 ] || [ ! -f "/backups/$1" ]; then
    echo "Usage: /restore.sh <dump-relative-to-/backups> [<photos-tarball>]" >&2
    echo "Available dumps:" >&2
    find /backups -name '*.dump' | sort >&2
    exit 1
fi

# Default the photos tarball to the snapshot made alongside the dump: the
# date is the last 10 characters of the dump's basename (usmccdb-YYYY-MM-DD).
photos_tar="${2:-}"
if [ -z "$photos_tar" ]; then
    day=$(basename "$1" .dump | tail -c 11)
    candidate="$(dirname "$1")/photos-${day}.tar.gz"
    [ -f "/backups/$candidate" ] && photos_tar="$candidate"
fi
if [ -n "$photos_tar" ] && [ ! -f "/backups/$photos_tar" ]; then
    echo "[restore] photos tarball /backups/$photos_tar not found" >&2
    echo "Available photo snapshots:" >&2
    find /backups -name 'photos-*.tar.gz' | sort >&2
    exit 1
fi

echo "[restore] restoring /backups/$1 into ${PGDATABASE}"
pg_restore --clean --if-exists --no-owner -d "${PGDATABASE}" "/backups/$1"

if [ -n "$photos_tar" ]; then
    echo "[restore] restoring photos from /backups/$photos_tar"
    find /photos -mindepth 1 -delete
    tar xzf "/backups/$photos_tar" -C /photos
else
    echo "[restore] no photos snapshot for this dump — photos volume left untouched"
fi
echo "[restore] done"
