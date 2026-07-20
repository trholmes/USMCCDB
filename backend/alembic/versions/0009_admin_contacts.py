"""Administrative Institutional Contacts (issue #20).

Adds the charter's Administrative Institutional Contact as an
institution-scoped collab role (like ib_rep), plus the institutional info
each member must keep up to date per the charter: professional title,
department, and the percent of research time devoted to the USMCC.

IF NOT EXISTS guards throughout because fresh installs already get the full
enum, columns, and constraints from metadata.create_all. The check
constraint compares role::text so it never instantiates an enum value added
in this same transaction (disallowed by PostgreSQL until commit).

Revision ID: 0009
Revises: 0008
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE collab_role ADD VALUE IF NOT EXISTS 'admin_contact'")
    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE collab_roles ADD CONSTRAINT admin_contact_requires_institution CHECK (
                (role::text != 'admin_contact') OR (institution_id IS NOT NULL)
            );
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$
        """
    )
    op.execute(
        "ALTER TABLE people ADD COLUMN IF NOT EXISTS professional_title VARCHAR(200)"
    )
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS department VARCHAR(200)")
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS usmcc_percent INTEGER")
    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE people ADD CONSTRAINT usmcc_percent_range CHECK (
                usmcc_percent IS NULL OR (usmcc_percent BETWEEN 0 AND 100)
            );
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$
        """
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; the extra label is harmless and
    # stays behind. Only the columns and constraints are removed.
    op.execute("ALTER TABLE people DROP CONSTRAINT IF EXISTS usmcc_percent_range")
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS usmcc_percent")
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS department")
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS professional_title")
    op.execute(
        "ALTER TABLE collab_roles DROP CONSTRAINT IF EXISTS admin_contact_requires_institution"
    )
