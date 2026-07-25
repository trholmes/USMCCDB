#!/usr/bin/env bash
# Restore the database (and member photos, when a snapshot exists) from a
# backup. Stops the backend during the restore.
#   Usage: scripts/restore.sh daily/usmccdb-2026-07-19.dump [daily/photos-2026-07-19.tar.gz]
# The photos snapshot taken alongside the dump is restored automatically;
# pass one explicitly to restore a weekly/monthly dump with a daily snapshot.
# Run scripts/list-backups.sh to see what's available.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    echo "Usage: scripts/restore.sh <dump-relative-to-/backups> [<photos-tarball>]" >&2
    echo "Available backups:" >&2
    docker compose exec -T backup sh -c "find /backups -name '*.dump' -o -name 'photos-*.tar.gz' | sort" >&2
    exit 1
fi

echo "Restoring from $1 — this OVERWRITES the current database (and photos, if a snapshot is restored)."
printf "Type 'yes' to continue: "
read -r confirm
[ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }

docker compose stop backend
docker compose exec -T backup /restore.sh "$@"
docker compose start backend
echo "Restore complete."
