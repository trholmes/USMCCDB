"""Latitude/longitude on institutions for the map view (issue #112).

WGS84 coordinates, nullable — institutions without them simply don't appear
on the map. Typically filled from the institution's ROR record.

Revision ID: 0016
Revises: 0015
"""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE institutions ADD COLUMN IF NOT EXISTS latitude double precision"
    )
    op.execute(
        "ALTER TABLE institutions ADD COLUMN IF NOT EXISTS longitude double precision"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE institutions DROP COLUMN IF EXISTS latitude")
    op.execute("ALTER TABLE institutions DROP COLUMN IF EXISTS longitude")
