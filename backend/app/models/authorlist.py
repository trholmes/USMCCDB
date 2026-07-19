from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase


class AuthorList(TimestampedBase):
    """Frozen, ordered author-list snapshot. Exports render from `snapshot`
    only, never from live membership data, so lists are reproducible."""

    __tablename__ = "author_lists"

    publication_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("publications.id", ondelete="SET NULL"), index=True
    )
    cutoff_date: Mapped[date] = mapped_column(Date, nullable=False)
    generated_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    # [{person_id, display_name, family_name, given_name, orcid,
    #   institution_ids: [..]}, ...] + separate institutions map
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)

    publication = relationship("Publication", back_populates="author_lists")
