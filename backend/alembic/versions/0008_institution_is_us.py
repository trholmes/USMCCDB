"""Add institutions.is_us.

Only people currently affiliated with US institutions are eligible for
voting membership, so institutions carry an explicit US flag (the free-text
country column is not reliable enough to gate eligibility). Defaults to
true, matching the country column's "USA" default; existing rows whose
country clearly names another place are backfilled to false. IF NOT EXISTS
because fresh installs already get the column from metadata.create_all.

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE institutions "
        "ADD COLUMN IF NOT EXISTS is_us boolean NOT NULL DEFAULT true"
    )
    op.execute(
        """
        UPDATE institutions SET is_us = false
        WHERE country IS NOT NULL
          AND upper(btrim(country)) NOT IN
              ('USA', 'US', 'U.S.', 'U.S.A.', 'UNITED STATES',
               'UNITED STATES OF AMERICA')
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE institutions DROP COLUMN IF EXISTS is_us")
