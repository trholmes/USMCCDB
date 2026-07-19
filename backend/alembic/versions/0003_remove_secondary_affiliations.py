"""First pass for issue #3: remove secondary institutions entirely.

Deletes all non-primary affiliations, then prunes institutions that are left
with no affiliations at all — but only uncurated ones (no author-list address
set) that hold no institutional roles, so hand-added entries survive. A
mechanism to properly assign secondary affiliations is the planned second pass.

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM affiliations WHERE NOT is_primary")
    op.execute(
        """
        DELETE FROM institutions i
        WHERE NOT EXISTS (SELECT 1 FROM affiliations a WHERE a.institution_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM collab_roles r WHERE r.institution_id = i.id)
          AND (i.latex_address IS NULL OR i.latex_address = '')
        """
    )


def downgrade() -> None:
    pass  # data migration — not reversible
