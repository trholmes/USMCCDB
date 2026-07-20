"""Track the full set of collaboration leadership roles (issue #22).

Extends the collab_role enum with the positions on the USMCC organigram
(muoncollider.us/contact): elected-council representatives and deputies,
coordinators and deputies, accelerator focus-area leads, Leadership Strategy
Group members, and a free-form `other`. Adds collab_roles.detail to qualify
the generic types ("Accelerator" representative, "Outreach" coordinator, the
focus area for leads, or the full title for `other`).

IF NOT EXISTS guards throughout because fresh installs already get the full
enum, column, and constraint from metadata.create_all. The check constraint
compares role::text so it never instantiates enum values added in this same
transaction (disallowed by PostgreSQL until commit).

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

NEW_ROLE_VALUES = (
    "representative",
    "deputy_representative",
    "coordinator",
    "deputy_coordinator",
    "area_lead",
    "lsg_member",
    "other",
)


def upgrade() -> None:
    for value in NEW_ROLE_VALUES:
        op.execute(f"ALTER TYPE collab_role ADD VALUE IF NOT EXISTS '{value}'")
    op.execute("ALTER TABLE collab_roles ADD COLUMN IF NOT EXISTS detail VARCHAR(200)")
    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE collab_roles ADD CONSTRAINT detail_required_roles CHECK (
                (role::text NOT IN ('representative', 'deputy_representative',
                                    'coordinator', 'deputy_coordinator',
                                    'area_lead', 'other'))
                OR (detail IS NOT NULL)
            );
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$
        """
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; the extra labels are harmless and
    # stay behind. Only the column (and its constraint) are removed.
    op.execute("ALTER TABLE collab_roles DROP CONSTRAINT IF EXISTS detail_required_roles")
    op.execute("ALTER TABLE collab_roles DROP COLUMN IF EXISTS detail")
