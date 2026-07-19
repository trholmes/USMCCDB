#!/bin/sh
# Take one pg_dump now and rotate old dumps.
# Layout in the backups volume:
#   /backups/daily/usmccdb-YYYY-MM-DD.dump      (kept KEEP_DAILY days)
#   /backups/weekly/usmccdb-YYYY-MM-DD.dump     (Sundays, kept KEEP_WEEKLY)
#   /backups/monthly/usmccdb-YYYY-MM-DD.dump    (1st of month, kept KEEP_MONTHLY)
set -eu

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

today=$(date -u +%Y-%m-%d)
mkdir -p /backups/daily /backups/weekly /backups/monthly

dump="/backups/daily/${PGDATABASE}-${today}.dump"
echo "[backup] dumping ${PGDATABASE} -> ${dump}"
pg_dump -Fc --no-owner -f "${dump}.tmp"
mv "${dump}.tmp" "${dump}"

# Member photos live outside the DB — snapshot them alongside the dump.
if [ -d /photos ] && [ -n "$(ls -A /photos 2>/dev/null)" ]; then
    tar czf "/backups/daily/photos-${today}.tar.gz.tmp" -C /photos .
    mv "/backups/daily/photos-${today}.tar.gz.tmp" "/backups/daily/photos-${today}.tar.gz"
fi

# Promote copies on Sundays / 1st of the month.
[ "$(date -u +%u)" = "7" ] && cp "${dump}" "/backups/weekly/${PGDATABASE}-${today}.dump"
[ "$(date -u +%d)" = "01" ] && cp "${dump}" "/backups/monthly/${PGDATABASE}-${today}.dump"

rotate() {
    dir="$1"; keep="$2"; pattern="${3:-*.dump}"
    ls -1 "$dir"/$pattern 2>/dev/null | sort | head -n -"$keep" | while read -r old; do
        echo "[backup] rotating out ${old}"
        rm -f "$old"
    done
}
rotate /backups/daily "$KEEP_DAILY" "photos-*.tar.gz"
rotate /backups/daily "$KEEP_DAILY"
rotate /backups/weekly "$KEEP_WEEKLY"
rotate /backups/monthly "$KEEP_MONTHLY"

echo "[backup] done: $(du -h "${dump}" | cut -f1) ${dump}"
