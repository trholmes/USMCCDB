"""Democratize publication submissions.

Any signed-in member may now register a publication, so the "proposed"
gatekeeping status goes away: existing proposed rows become in_progress and
the value is removed from the pub_status enum (recreated, since PostgreSQL
cannot drop enum values in place). publication_events keep their historical
"proposed" strings — that table is append-only audit history.

The pub_person_role enum gains "contributor" (people involved in the paper,
used to build subset author lists) and "reviewer" (office-assigned collab
reviewers, credited in the suggested acknowledgment text).

Guarded so fresh installs — which already get the final enums from
metadata.create_all — pass through unchanged.

Revision ID: 0011
Revises: 0010
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE pub_person_role ADD VALUE IF NOT EXISTS 'contributor'")
    op.execute("ALTER TYPE pub_person_role ADD VALUE IF NOT EXISTS 'reviewer'")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'pub_status' AND e.enumlabel = 'proposed'
            ) THEN
                UPDATE publications SET status = 'in_progress' WHERE status = 'proposed';
                ALTER TYPE pub_status RENAME TO pub_status_old;
                CREATE TYPE pub_status AS ENUM
                    ('in_progress', 'collab_review', 'submitted', 'published');
                ALTER TABLE publications
                    ALTER COLUMN status TYPE pub_status
                    USING status::text::pub_status;
                DROP TYPE pub_status_old;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Restore "proposed" as a selectable status (rows stay in_progress).
    # The added pub_person_role values are left in place: enum values cannot
    # be dropped and rows may already use them.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'pub_status' AND e.enumlabel = 'proposed'
            ) THEN
                ALTER TYPE pub_status RENAME TO pub_status_old;
                CREATE TYPE pub_status AS ENUM
                    ('proposed', 'in_progress', 'collab_review', 'submitted', 'published');
                ALTER TABLE publications
                    ALTER COLUMN status TYPE pub_status
                    USING status::text::pub_status;
                DROP TYPE pub_status_old;
            END IF;
        END $$;
        """
    )
