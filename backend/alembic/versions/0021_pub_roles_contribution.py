"""Consolidate publication roles and add per-person contributions.

The editor and analysis_contact roles fold into contact (the contact now
manages the publication; the creator becomes one), and publication_people
gains a contribution text — written by the person, editable by contacts.

Revision ID: 0021
Revises: 0020
"""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE publication_people ADD COLUMN IF NOT EXISTS contribution text")
    # Fold editor / analysis_contact into contact and shrink the enum. Guarded
    # on the old labels existing: fresh installs get the three-value enum from
    # metadata.create_all and must skip all of this.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'pub_person_role'
                  AND e.enumlabel IN ('editor', 'analysis_contact')
            ) THEN
                -- Drop rows whose remap would collide with an existing row of
                -- the same person (uq_pub_person_role): already a contact, or
                -- holding both of the folded roles.
                DELETE FROM publication_people pp
                WHERE pp.role::text IN ('editor', 'analysis_contact')
                  AND EXISTS (
                      SELECT 1 FROM publication_people c
                      WHERE c.publication_id = pp.publication_id
                        AND c.person_id = pp.person_id
                        AND c.role::text = 'contact'
                  );
                DELETE FROM publication_people pp
                WHERE pp.role::text = 'analysis_contact'
                  AND EXISTS (
                      SELECT 1 FROM publication_people e
                      WHERE e.publication_id = pp.publication_id
                        AND e.person_id = pp.person_id
                        AND e.role::text = 'editor'
                  );
                UPDATE publication_people SET role = 'contact'
                WHERE role::text IN ('editor', 'analysis_contact');

                ALTER TYPE pub_person_role RENAME TO pub_person_role_old;
                CREATE TYPE pub_person_role AS ENUM ('contact', 'contributor', 'reviewer');
                ALTER TABLE publication_people
                    ALTER COLUMN role TYPE pub_person_role
                    USING role::text::pub_person_role;
                DROP TYPE pub_person_role_old;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Restore the wider enum so older code can write the folded roles again;
    # which contacts were editors/analysis contacts is not recoverable.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'pub_person_role' AND e.enumlabel = 'editor'
            ) THEN
                ALTER TYPE pub_person_role RENAME TO pub_person_role_old;
                CREATE TYPE pub_person_role AS ENUM
                    ('editor', 'contact', 'analysis_contact', 'contributor', 'reviewer');
                ALTER TABLE publication_people
                    ALTER COLUMN role TYPE pub_person_role
                    USING role::text::pub_person_role;
                DROP TYPE pub_person_role_old;
            END IF;
        END $$;
        """
    )
    op.execute("ALTER TABLE publication_people DROP COLUMN IF EXISTS contribution")
