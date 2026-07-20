"""Add affiliations.career_stage.

The institution history now records what career stage the person held while
at each institution. Nullable: closed rows from before this field have no
recorded stage. Open affiliations are backfilled from the person's current
stage. IF NOT EXISTS because fresh installs already get the column from the
model via metadata.create_all.

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE affiliations ADD COLUMN IF NOT EXISTS career_stage career_stage"
    )
    # Open affiliations describe the present, so the person's current stage
    # is correct for them; closed rows are left NULL (unknown history).
    op.execute(
        """
        UPDATE affiliations SET career_stage = people.career_stage
        FROM people
        WHERE affiliations.person_id = people.id
          AND affiliations.end_date IS NULL
          AND affiliations.career_stage IS NULL
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE affiliations DROP COLUMN IF EXISTS career_stage")
