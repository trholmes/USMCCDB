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

Revision ID: 0013
Revises: 0012
"""

from alembic import op

revision = "0013"
down_revision = "0012"
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
