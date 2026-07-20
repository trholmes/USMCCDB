"""Add membership_events.effective_date.

Records the date a status transition takes effect, as entered by the member or
office (may differ from created_at). IF NOT EXISTS because fresh installs
already get the column from the model via metadata.create_all.

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE membership_events ADD COLUMN IF NOT EXISTS effective_date DATE")


def downgrade() -> None:
    op.execute("ALTER TABLE membership_events DROP COLUMN IF EXISTS effective_date")
