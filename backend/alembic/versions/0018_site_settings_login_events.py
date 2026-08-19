"""Admin panel upgrades: site settings store + login audit.

site_settings is a key/value store for runtime configuration edited in the
admin panel (announcement banner, login-page message); login_events is the
append-only sign-in audit behind the admin Login history card.

Revision ID: 0018
Revises: 0017
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS site_settings (
            id bigserial PRIMARY KEY,
            key varchar(80) NOT NULL UNIQUE,
            value text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_site_settings_key ON site_settings (key)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS login_events (
            id bigserial PRIMARY KEY,
            user_id bigint REFERENCES users(id) ON DELETE SET NULL,
            method varchar(20) NOT NULL,
            success boolean NOT NULL,
            username_attempted varchar(80),
            ip varchar(64),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_login_events_user_id ON login_events (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS login_events")
    op.execute("DROP TABLE IF EXISTS site_settings")
