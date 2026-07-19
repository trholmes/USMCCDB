#!/usr/bin/env bash
# Stop the whole stack (containers are removed; data volumes are kept).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose --profile tls down
echo "Stack stopped. Data (database, backups, certificates) is preserved."
echo "Start again with scripts/start.sh."
