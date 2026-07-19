"""Add people.photo_file.

IF NOT EXISTS because fresh installs already get the column from 0001's
metadata.create_all (the model includes it).

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS photo_file VARCHAR(120)")


def downgrade() -> None:
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS photo_file")
