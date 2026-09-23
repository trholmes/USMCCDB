"""Email log (issue #166).

Records every notification email the system tries to send — delivered,
failed, or skipped because SMTP is not configured — for the admin panel's
Email tab. IF NOT EXISTS because fresh installs get the table from
metadata.create_all.

Revision ID: 0024
Revises: 0023
"""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS email_log (
            id bigserial PRIMARY KEY,
            kind varchar(60) NOT NULL,
            recipients text NOT NULL,
            subject varchar(300) NOT NULL,
            body text NOT NULL,
            status varchar(20) NOT NULL,
            error text,
            context varchar(200),
            person_id bigint REFERENCES people(id) ON DELETE SET NULL,
            actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_email_log_kind ON email_log (kind)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_email_log_status ON email_log (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_email_log_person_id ON email_log (person_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS email_log")
