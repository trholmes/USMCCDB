"""Personal funding acknowledgement on people (issue #127).

grant_number seeds a default acknowledgement text the member can edit
freely; acknowledgement_text is appended to the suggested acknowledgment of
publications the person is attached to (any non-reviewer role).

Revision ID: 0017
Revises: 0016
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS grant_number varchar(200)")
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS acknowledgement_text text")


def downgrade() -> None:
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS grant_number")
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS acknowledgement_text")
