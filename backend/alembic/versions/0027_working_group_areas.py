"""Leadership Council areas on working groups.

working_groups.areas holds a comma-separated subset of REPRESENTATIVE_AREAS
(zero, one or several), normalized and validated in the schemas. IF NOT
EXISTS because fresh installs get the column from metadata.create_all.

Revision ID: 0027
Revises: 0026
"""

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE working_groups ADD COLUMN IF NOT EXISTS areas text")


def downgrade() -> None:
    op.execute("ALTER TABLE working_groups DROP COLUMN IF EXISTS areas")
