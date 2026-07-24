"""Align backend enums with the frontend labels (issue #53).

Two renames, matching what frontend/src/constants.ts already sends:

- Research area 'Other/Multiple' becomes 'Other' — "multiple" is expressed by
  selecting several areas, so the qualifier was redundant. people.research_areas
  is a comma-separated text column; stored values are remapped in place.
- Collab role 'speakers_chair' becomes 'speakers_comm' (the office adds the
  whole Speakers Committee, not just its chair). The collab_role enum label is
  renamed, carrying existing rows along.

Guards throughout because fresh installs already get 'Other' and
'speakers_comm' from metadata.create_all: the string remap is a no-op without
matching rows, and the enum rename only runs when the old label exists. The
both-labels-present case (never produced by create_all or this migration) is
handled by moving rows before the stale label is left behind unused.

Originally merged as a second revision '0013', colliding with
0013_person_middle_name from a PR merged in parallel — Alembic refuses to
run with a duplicate revision id. Renumbered to 0014; since a database
upgraded during the collision window may have recorded 0013 after running
only one of the two scripts, upgrade() also re-asserts the (guarded)
middle_name column so either ordering heals.

Revision ID: 0014
Revises: 0013
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def _rename_enum_value(old: str, new: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                       WHERE t.typname = 'collab_role' AND e.enumlabel = '{old}') THEN
                IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                           WHERE t.typname = 'collab_role' AND e.enumlabel = '{new}') THEN
                    UPDATE collab_roles SET role = '{new}' WHERE role::text = '{old}';
                ELSE
                    ALTER TYPE collab_role RENAME VALUE '{old}' TO '{new}';
                END IF;
            END IF;
        END $$
        """
    )


def upgrade() -> None:
    # A database stamped 0013 during the collision window may have run the
    # rename script instead of the middle_name one — re-assert the column.
    op.execute("ALTER TABLE people ADD COLUMN IF NOT EXISTS middle_name VARCHAR(120)")
    # 'Other/Multiple' only ever appears as a whole token (validated on write),
    # and no other area contains it as a substring, so replace() is exact.
    op.execute(
        """
        UPDATE people SET research_areas = replace(research_areas, 'Other/Multiple', 'Other')
        WHERE research_areas LIKE '%Other/Multiple%'
        """
    )
    _rename_enum_value("speakers_chair", "speakers_comm")


def downgrade() -> None:
    # 'Other' appears in the other canonical area names only as a substring of
    # nothing (they share no token), so the reverse replace is exact too.
    op.execute(
        """
        UPDATE people SET research_areas = replace(research_areas, 'Other', 'Other/Multiple')
        WHERE research_areas LIKE '%Other%'
        """
    )
    _rename_enum_value("speakers_comm", "speakers_chair")
