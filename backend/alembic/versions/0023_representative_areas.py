"""Normalize representative areas to the fixed Leadership Council list (issue #159).

collab_roles.detail for representatives and deputy representatives is now one
of Accelerator / Experimental / Theory / Communications, validated by the API.
No schema change: this only brings existing rows into the canonical spelling
so they show up selected in the new area dropdown. Anything that still does
not match is left as is (it displays, and the API asks for a valid area the
next time the row is edited).

Revision ID: 0023
Revises: 0022
"""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

AREA_ROLES = "('representative', 'deputy_representative')"


def upgrade() -> None:
    # Case / whitespace variants of the canonical names.
    op.execute(
        f"""
        UPDATE collab_roles SET detail = initcap(lower(btrim(detail)))
        WHERE role::text IN {AREA_ROLES}
          AND lower(btrim(detail)) IN ('accelerator', 'experimental', 'theory', 'communications')
          AND detail IS DISTINCT FROM initcap(lower(btrim(detail)))
        """
    )
    # Common alternative spellings.
    op.execute(
        f"""
        UPDATE collab_roles SET detail = CASE lower(btrim(detail))
            WHEN 'experiment' THEN 'Experimental'
            WHEN 'experiments' THEN 'Experimental'
            WHEN 'detector' THEN 'Experimental'
            WHEN 'theoretical' THEN 'Theory'
            WHEN 'accelerators' THEN 'Accelerator'
            WHEN 'communication' THEN 'Communications'
            ELSE detail END
        WHERE role::text IN {AREA_ROLES}
        """
    )


def downgrade() -> None:
    # Data-only normalization; the previous free-text spellings are not kept.
    pass
