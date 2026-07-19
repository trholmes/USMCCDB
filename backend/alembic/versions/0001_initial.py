"""Initial schema: all tables for membership, speakers, publications,
author lists, and auth.

Revision ID: 0001
Revises:
Create Date: 2026-07-19
"""

from alembic import op

import app.models  # noqa: F401  — register all models on Base.metadata
from app.db import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Needed by the no-overlapping-author-periods EXCLUDE constraint.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
