#!/usr/bin/env bash
# Tail logs. Usage: scripts/logs.sh [service]   (backend, frontend, db, caddy, backup)
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --profile tls logs -f --tail 100 "$@"
