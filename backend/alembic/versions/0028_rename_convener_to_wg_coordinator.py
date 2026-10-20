"""Rename the convener role to working group coordinator.

The collab_roles role enum value `convener` becomes `wg_coordinator` and the
check constraint tied to it is renamed to match metadata.create_all on fresh
installs. Renaming the enum value carries any existing rows along (none are
expected); guarded lookups because fresh installs already have the new names.

Revision ID: 0028
Revises: 0027
"""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                       WHERE t.typname = 'collab_role' AND e.enumlabel = 'convener') THEN
                ALTER TYPE collab_role RENAME VALUE 'convener' TO 'wg_coordinator';
            END IF;
            IF EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'convener_requires_wg') THEN
                ALTER TABLE collab_roles RENAME CONSTRAINT convener_requires_wg
                    TO wg_coordinator_requires_wg;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                       WHERE t.typname = 'collab_role' AND e.enumlabel = 'wg_coordinator') THEN
                ALTER TYPE collab_role RENAME VALUE 'wg_coordinator' TO 'convener';
            END IF;
            IF EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'wg_coordinator_requires_wg') THEN
                ALTER TABLE collab_roles RENAME CONSTRAINT wg_coordinator_requires_wg
                    TO convener_requires_wg;
            END IF;
        END $$;
        """
    )
