"""Add people.research_areas.

Comma-separated subset of the standard research areas (accelerator,
experiment, theory, other), distinct from the free-form expertise topics.
IF NOT EXISTS because fresh installs already get the column from the model
via metadata.create_all.

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS research_areas TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS research_areas")
