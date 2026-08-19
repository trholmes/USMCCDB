#!/bin/sh
# Backup scheduler: takes the nightly dump at BACKUP_HOUR (UTC) and watches
# /backups/requests for manual-backup requests dropped there by the backend's
# admin "Backups" panel (a <id>.request file, renamed to .done/.failed when
# the dump finishes). A dump can also be triggered any time with
# `docker compose exec backup /backup.sh` (scripts/backup.sh does exactly that).
set -eu

BACKUP_HOUR="${BACKUP_HOUR:-02}"
REQUEST_DIR=/backups/requests

mkdir -p "$REQUEST_DIR"
# Requests and markers from before a restart are stale: an old request must
# not fire a surprise dump (or restore!), and old markers would confuse the
# backend.
rm -f "$REQUEST_DIR"/*.request "$REQUEST_DIR"/*.done "$REQUEST_DIR"/*.failed \
      "$REQUEST_DIR"/*.restore
# A restore interrupted by the restart would leave the status stuck on
# "running" forever — mark it failed so the admin panel shows the truth.
if [ -f /backups/restore-status ] && grep -Eq '^state=(queued|running)$' /backups/restore-status; then
    {
        echo "state=failed"
        echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "detail=interrupted by a backup-container restart"
    } > /backups/restore-status
fi

echo "[backup] scheduler started; nightly dump at ${BACKUP_HOUR}:00 UTC"
echo "[backup] retention: daily=${KEEP_DAILY:-14} weekly=${KEEP_WEEKLY:-8} monthly=${KEEP_MONTHLY:-12}"

# Epoch seconds of the next BACKUP_HOUR:00 UTC, computed from the current
# time of day (BusyBox date has no reliable -d parsing).
next_nightly() {
    now=$(date -u +%s)
    h=$(date -u +%H); h=${h#0}
    m=$(date -u +%M); m=${m#0}
    s=$(date -u +%S); s=${s#0}
    t=$(( now - h*3600 - m*60 - s + ${BACKUP_HOUR#0} * 3600 ))
    [ "$t" -le "$now" ] && t=$(( t + 86400 ))
    echo "$t"
}

target=$(next_nightly)
while true; do
    # Restore requests from the admin panel: a <id>.restore file whose first
    # line is the dump path relative to /backups. Progress/result go through
    # /backups/restore-status (written by /restore.sh), not rename markers.
    for req in "$REQUEST_DIR"/*.restore; do
        [ -e "$req" ] || continue
        rel="$(head -n1 "$req")"
        rm -f "$req"
        echo "[backup] restore requested: $rel"
        /restore.sh "$rel" || echo "[backup] restore FAILED"
    done
    for req in "$REQUEST_DIR"/*.request; do
        [ -e "$req" ] || continue
        echo "[backup] manual backup requested: $(basename "$req")"
        # mv is best-effort: the backend withdraws a request it gave up on,
        # which may race the dump we just took — that must not kill us.
        if /backup.sh; then
            mv "$req" "${req%.request}.done" 2>/dev/null || true
        else
            echo "[backup] manual backup FAILED"
            mv "$req" "${req%.request}.failed" 2>/dev/null || true
        fi
    done
    if [ "$(date -u +%s)" -ge "$target" ]; then
        /backup.sh || echo "[backup] nightly dump FAILED"
        target=$(next_nightly)
    fi
    sleep 5
done
