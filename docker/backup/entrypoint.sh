#!/bin/sh
# Backup scheduler: sleeps until the next BACKUP_HOUR (UTC), takes a dump,
# repeats. A dump can also be triggered any time with `docker compose exec
# backup /backup.sh` (scripts/backup.sh does exactly that).
set -eu

BACKUP_HOUR="${BACKUP_HOUR:-02}"

echo "[backup] scheduler started; nightly dump at ${BACKUP_HOUR}:00 UTC"
echo "[backup] retention: daily=${KEEP_DAILY:-14} weekly=${KEEP_WEEKLY:-8} monthly=${KEEP_MONTHLY:-12}"

while true; do
    now=$(date -u +%s)
    target=$(date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_HOUR}:00:00" +%s 2>/dev/null || true)
    if [ -z "$target" ]; then
        # BusyBox date fallback
        target=$(( $(date -u -d "$(date -u +%Y-%m-%d) 00:00:00" +%s) + ${BACKUP_HOUR#0} * 3600 ))
    fi
    [ "$target" -le "$now" ] && target=$((target + 86400))
    sleep $((target - now))
    /backup.sh || echo "[backup] nightly dump FAILED"
done
