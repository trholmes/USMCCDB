#!/usr/bin/env bash
# DANGER: wipe the database and start fresh. Backups and TLS certs are KEPT.
# Offers to take a final backup first.
set -euo pipefail
cd "$(dirname "$0")/.."

# Same resolution docker compose uses: an explicit COMPOSE_PROJECT_NAME (from
# .env — set there by start.sh for side-by-side instances) wins over the
# directory name. Keep - and _ , which are valid in project names.
project=$(grep -E '^COMPOSE_PROJECT_NAME=' .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)
if [ -z "$project" ]; then
    project=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
fi

echo "This will DELETE the entire database (volume ${project}_pgdata)."
echo "The backups directory and TLS certificates are kept."
printf "Type 'yes' to continue: "
read -r confirm
[ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }

if docker compose ps --status running backup >/dev/null 2>&1 && \
   docker compose ps --status running backup | grep -q backup; then
    printf "Take a final backup first? [Y/n] "
    read -r dobackup
    if [ "${dobackup:-Y}" != "n" ] && [ "${dobackup:-Y}" != "N" ]; then
        docker compose exec -T backup /backup.sh
    fi
fi

docker compose --profile tls down
docker volume rm "${project}_pgdata"
echo
echo "Database wiped. Restarting fresh stack..."
exec ./scripts/start.sh
