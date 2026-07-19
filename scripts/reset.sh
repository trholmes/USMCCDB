#!/usr/bin/env bash
# DANGER: wipe the database and start fresh. Backups and TLS certs are KEPT.
# Offers to take a final backup first.
set -euo pipefail
cd "$(dirname "$0")/.."

project=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')

echo "This will DELETE the entire database (volume ${project}_pgdata)."
echo "The backups volume and TLS certificates are kept."
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
