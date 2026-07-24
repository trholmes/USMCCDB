"""Backfill activation events for imported members.

The CSV/XLSX importers created people directly as active without recording a
membership_events row, so the "new members per year" statistics chart had no
data for them. Insert the missing transition-to-active event for every active
person who lacks one, dating it to their earliest affiliation start (the
importers set that to the registration date), falling back to the record's
creation time.

Revision ID: 0012
Revises: 0011
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

BACKFILL_NOTE = "Backfilled activation for imported member (migration 0012)"


def upgrade() -> None:
    op.execute(
        f"""
        INSERT INTO membership_events
            (person_id, from_status, to_status, effective_date, note)
        SELECT p.id, NULL, 'active',
               COALESCE(
                   (SELECT MIN(a.start_date)
                      FROM affiliations a
                     WHERE a.person_id = p.id),
                   CAST(p.created_at AS DATE)
               ),
               '{BACKFILL_NOTE}'
          FROM people p
         WHERE p.status = 'active'
           AND NOT EXISTS (
               SELECT 1 FROM membership_events e
                WHERE e.person_id = p.id AND e.to_status = 'active'
           )
        """
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM membership_events WHERE note = '{BACKFILL_NOTE}'")
