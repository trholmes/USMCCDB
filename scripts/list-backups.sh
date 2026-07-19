#!/usr/bin/env bash
# List all database backups (in the backups volume).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose exec -T backup sh -c "find /backups -name '*.dump' -exec du -h {} + | sort -k2"
