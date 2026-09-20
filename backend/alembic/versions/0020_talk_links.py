"""External links on talks (issue #140).

url points at the talk's page on the event site (e.g. indico); slides_url
and recording_url point wherever those are hosted (indico, YouTube, ...).

Revision ID: 0020
Revises: 0019
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE talks ADD COLUMN IF NOT EXISTS url varchar(500)")
    op.execute("ALTER TABLE talks ADD COLUMN IF NOT EXISTS slides_url varchar(500)")
    op.execute("ALTER TABLE talks ADD COLUMN IF NOT EXISTS recording_url varchar(500)")


def downgrade() -> None:
    op.execute("ALTER TABLE talks DROP COLUMN IF EXISTS url")
    op.execute("ALTER TABLE talks DROP COLUMN IF EXISTS slides_url")
    op.execute("ALTER TABLE talks DROP COLUMN IF EXISTS recording_url")
