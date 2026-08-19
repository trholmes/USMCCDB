#!/bin/sh
# Restore the database — and member photos, when a snapshot is available —
# from the backups directory.
# Usage: /restore.sh daily/usmccdb-2026-07-19.dump [daily/photos-2026-07-19.tar.gz]
# Without a second argument, the photos snapshot taken alongside the dump
# (same directory, same suffix) is restored if it exists.
#
# DROPS AND RECREATES the current schema and REPLACES the photos volume
# contents — but always takes a fresh pre-restore dump (and photos snapshot)
# first, so a mistaken restore is recoverable from /backups/pre-restore.
# Progress is written to /backups/restore-status for the admin panel, which
# triggers restores through a requests/<id>.restore sentinel (entrypoint.sh);
# running it by hand via scripts/restore.sh works exactly as before.
set -u

STATUS=/backups/restore-status
REL="${1:-}"

write_status() {  # state  detail
    {
        echo "state=$1"
        echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "backup=$REL"
        echo "detail=$2"
    } > "$STATUS"
}
fail() {
    write_status failed "$1"
    echo "[restore] FAILED: $1" >&2
    exit 1
}

usage() {
    echo "Usage: /restore.sh <dump-relative-to-/backups> [<photos-tarball>]" >&2
    echo "Available dumps:" >&2
    find /backups -name '*.dump' | sort >&2
    exit 1
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage
[ -f "/backups/$REL" ] || { write_status failed "no such backup: $REL"; usage; }

write_status running "validating archive"
pg_restore --list "/backups/$REL" > /dev/null 2>&1 \
    || fail "not a valid pg_dump archive: $REL"

# Default the photos tarball to the snapshot made alongside the dump: same
# directory, basename with the database prefix swapped for "photos-"
# (usmccdb-2026-07-19.dump -> photos-2026-07-19.tar.gz, and likewise for
# pre-restore dumps). Uploaded dumps have no snapshot and leave photos alone.
photos_tar="${2:-}"
if [ -z "$photos_tar" ]; then
    base=$(basename "$REL" .dump)
    case "$base" in
        "${PGDATABASE}"-*)
            candidate="$(dirname "$REL")/photos-${base#"${PGDATABASE}"-}.tar.gz"
            [ -f "/backups/$candidate" ] && photos_tar="$candidate"
            ;;
    esac
fi
if [ -n "$photos_tar" ] && [ ! -f "/backups/$photos_tar" ]; then
    write_status failed "photos tarball not found: $photos_tar"
    echo "[restore] photos tarball /backups/$photos_tar not found" >&2
    echo "Available photo snapshots:" >&2
    find /backups -name 'photos-*.tar.gz' | sort >&2
    exit 1
fi

# Safety net: fresh pre-restore snapshots (database + photos) before anything
# is overwritten. Keep the last 10; uploaded dumps are capped at 5.
write_status running "taking pre-restore backup"
stamp=$(date -u +%Y%m%d-%H%M%S)
mkdir -p /backups/pre-restore
safety="/backups/pre-restore/${PGDATABASE}-pre-restore-${stamp}.dump"
pg_dump -Fc --no-owner -f "${safety}.tmp" || fail "pre-restore backup failed"
pg_restore --list "${safety}.tmp" > /dev/null 2>&1 || fail "pre-restore backup is unreadable"
mv "${safety}.tmp" "$safety"
if [ -d /photos ] && [ -n "$(ls -A /photos 2>/dev/null)" ]; then
    tar czf "/backups/pre-restore/photos-pre-restore-${stamp}.tar.gz.tmp" -C /photos .
    mv "/backups/pre-restore/photos-pre-restore-${stamp}.tar.gz.tmp" \
       "/backups/pre-restore/photos-pre-restore-${stamp}.tar.gz"
fi
rotate() {  # dir keep pattern
    ls -1 "$1"/$3 2>/dev/null | sort | head -n -"$2" | while read -r old; do
        echo "[restore] rotating out ${old}"
        rm -f "$old"
    done
}
rotate /backups/pre-restore 10 '*.dump'
rotate /backups/pre-restore 10 'photos-*.tar.gz'
[ -d /backups/uploads ] && rotate /backups/uploads 5 '*.dump'

# Drop other connections so pg_restore --clean can drop/recreate tables
# without blocking on the backend's pooled connections (which reconnect).
write_status running "restoring database"
echo "[restore] restoring /backups/$REL into ${PGDATABASE}"
psql -d "${PGDATABASE}" -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();" \
    > /dev/null 2>&1 || true

if pg_restore --clean --if-exists --no-owner -d "${PGDATABASE}" "/backups/$REL" 2> /tmp/restore.err; then
    restored=ok
else
    # pg_restore exits non-zero on ignorable warnings too; count the restore
    # as successful only if the schema is actually usable afterwards.
    if psql -d "${PGDATABASE}" -tAc "SELECT 1 FROM people LIMIT 1;" > /dev/null 2>&1; then
        restored=warnings
    else
        fail "pg_restore error: $(tail -c 300 /tmp/restore.err | tr '\n' ' ')"
    fi
fi

if [ -n "$photos_tar" ]; then
    write_status running "restoring photos"
    echo "[restore] restoring photos from /backups/$photos_tar"
    find /photos -mindepth 1 -delete
    tar xzf "/backups/$photos_tar" -C /photos
else
    echo "[restore] no photos snapshot for this dump — photos volume left untouched"
fi

if [ "$restored" = warnings ]; then
    write_status success "Restored from $REL (completed with warnings). A pre-restore safety backup was kept."
    echo "[restore] done (with warnings)"
else
    write_status success "Restored from $REL. A pre-restore safety backup was kept."
    echo "[restore] done"
fi
