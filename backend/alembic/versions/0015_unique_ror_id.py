"""Unique index on institutions.ror_id (issue #105).

ROR ids (https://ror.org) become the stable external identifier used to
detect duplicate institutions; the column has existed since the beginning
but was never populated or constrained. A plain unique index suffices —
Postgres treats NULLs as distinct, so the many rows without a ROR id are
unaffected.

Revision ID: 0015
Revises: 0014
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_institutions_ror_id ON institutions (ror_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_institutions_ror_id")
