#!/usr/bin/env bash
# Take a database backup right now (in addition to the automatic nightly one).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose exec -T backup /backup.sh
echo
echo "Latest backups:"
docker compose exec -T backup sh -c "find /backups -name '*.dump' | sort | tail -n 5"
