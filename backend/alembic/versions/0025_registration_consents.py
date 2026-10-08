"""Registration confirmations: advisor approval and public-listing consent.

Students confirm at registration that their advisor approved them joining
the USMCC; every registrant is asked whether their name and photo may be
listed on the public muoncollider.us/people page. IF NOT EXISTS because
fresh installs get the columns from metadata.create_all.

Revision ID: 0025
Revises: 0024
"""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE people ADD COLUMN IF NOT EXISTS advisor_approved "
        "boolean NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE people ADD COLUMN IF NOT EXISTS public_listing_consent "
        "boolean NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS public_listing_consent")
    op.execute("ALTER TABLE people DROP COLUMN IF EXISTS advisor_approved")
