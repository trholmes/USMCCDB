"""Track colloquia and self-added talks (issue #33).

Colloquia and seminars are talks with no associated conference, so talks gain
a free-text `venue` (the hosting institution / seminar series) shown where the
conference name would be. The talk_type enum gains `colloquium` alongside the
existing `seminar`. Members may now add talks themselves; `created_by_user_id`
records who added a talk so they can edit or remove their own entries.

IF NOT EXISTS guards throughout because fresh installs already get the full
enum and columns from metadata.create_all.

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE talk_type ADD VALUE IF NOT EXISTS 'colloquium'")
    # talks.date was unintentionally NOT NULL: the model attribute name
    # shadows datetime.date, so SQLAlchemy could not infer optionality from
    # the `date | None` annotation and created_all made the column required.
    op.execute("ALTER TABLE talks ALTER COLUMN date DROP NOT NULL")
    op.execute("ALTER TABLE talks ADD COLUMN IF NOT EXISTS venue VARCHAR(300)")
    op.execute(
        "ALTER TABLE talks ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT "
        "REFERENCES users(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; the extra label is harmless and
    # stays behind. talks.date stays nullable — NOT NULL was never intended
    # and cannot be restored once dateless talks exist. Only the columns are
    # removed.
    op.execute("ALTER TABLE talks DROP COLUMN IF EXISTS created_by_user_id")
    op.execute("ALTER TABLE talks DROP COLUMN IF EXISTS venue")
