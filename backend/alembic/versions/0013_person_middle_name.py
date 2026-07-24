"""Add people.middle_name.

Optional middle name collected on the registration form. IF NOT EXISTS
because fresh installs already get the column from the model via
metadata.create_all.

Revision ID: 0013
Revises: 0012
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS middle_name VARCHAR(120)")


def downgrade() -> None:
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS middle_name")
