"""Account roles for leadership positions (issue #167).

Adds two user roles between office and member: `leadership` (Leadership
Council representatives and deputies — working groups, their conveners, and
everything the speakers committee may do) and `speakers_committee` (speakers committee
— full edit access to talks, events and nominations). Roles are still
assigned explicitly by an admin; the alerts panel only suggests them from a
person's active positions. role_suggestion_dismissals records suggestions an
admin rejected so they stay quiet until the positions change.

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
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'speakers_committee'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS role_suggestion_dismissals (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            suggested_role varchar(20) NOT NULL,
            detail varchar(500) NOT NULL,
            dismissed_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_role_suggestion_dismissal UNIQUE (user_id, suggested_role, detail)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_role_suggestion_dismissals_user_id "
        "ON role_suggestion_dismissals (user_id)"
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; the labels stay behind. Accounts
    # holding the new roles fall back to member so older code (whose enum
    # lacks the labels) can still load them.
    op.execute("DROP TABLE IF EXISTS role_suggestion_dismissals")
    op.execute(
        "UPDATE users SET role = 'member' "
        "WHERE role::text IN ('leadership', 'speakers_committee')"
    )
