"""Affiliation review flag for member-made institution moves.

A member moving their own primary institution sets needs_review on the new
affiliation; the office confirms the change from the Alerts page, which
clears it. IF NOT EXISTS because fresh installs get the column from
metadata.create_all.

Revision ID: 0026
Revises: 0025
"""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE affiliations ADD COLUMN IF NOT EXISTS needs_review "
        "boolean NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE affiliations DROP COLUMN IF EXISTS needs_review")
