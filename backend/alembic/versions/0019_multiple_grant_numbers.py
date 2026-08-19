"""Room for multiple grant numbers per person.

people.grant_number now holds a comma-separated list (the profile form's
grant tags), so the column needs more headroom than one number did.

Revision ID: 0019
Revises: 0018
"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE people ALTER COLUMN grant_number TYPE varchar(500)")


def downgrade() -> None:
    # Widening back down could truncate; keep the wider column on downgrade.
    pass
