"""Account roles for leadership positions (issue #167).

Adds two user roles between office and member: `leadership` (Leadership
Council representatives and deputies — working groups, their conveners, and
everything the speakers committee may do) and `speakers` (speakers committee
— full edit access to talks, events and nominations). Roles are still
assigned explicitly by an admin; the alerts panel only suggests them from a
person's active positions.

IF NOT EXISTS because fresh installs already get the full enum from
metadata.create_all.

Revision ID: 0022
Revises: 0021
"""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'leadership'")
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'speakers'")


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; the labels stay behind. Accounts
    # holding the new roles fall back to member so older code (whose enum
    # lacks the labels) can still load them.
    op.execute("UPDATE users SET role = 'member' WHERE role::text IN ('leadership', 'speakers')")
