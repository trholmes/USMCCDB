"""Author-list generation.

Given a cutoff date, collect everyone with an active authorship period,
joined with their affiliations active on that date, ordered alphabetically
by family name (standard HEP practice, accent-insensitive). The result is
stored as a frozen JSON snapshot so past lists never change when membership
data is edited later.
"""

import unicodedata
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Affiliation, AuthorPeriod, Institution, Person


def _sort_key(family: str, given: str) -> tuple[str, str]:
    def fold(s: str) -> str:
        # Accent-insensitive, case-insensitive collation fallback
        # (é -> e, ø stays but sorts stably).
        nfkd = unicodedata.normalize("NFKD", s)
        return "".join(c for c in nfkd if not unicodedata.combining(c)).casefold()

    return (fold(family), fold(given))


def build_snapshot(db: Session, cutoff: date, person_ids: list[int] | None = None) -> dict:
    """Return {"cutoff_date", "authors": [...], "institutions": {id: {...}},
    "warnings": [...]} with authors ordered, institutions numbered by first
    appearance, and a warning per author lacking an affiliation at the cutoff.

    By default the list covers everyone with an active authorship period at
    the cutoff. With ``person_ids`` it is restricted to exactly those people
    instead — included whether or not they have a registered author period
    (their signing name is still used when one is active)."""

    active_period = (
        select(AuthorPeriod)
        .where(
            AuthorPeriod.start_date <= cutoff,
            (AuthorPeriod.end_date.is_(None)) | (AuthorPeriod.end_date >= cutoff),
        )
        .subquery()
    )

    stmt = select(Person, active_period.c.signing_name).order_by(
        Person.family_name, Person.given_name
    )
    if person_ids is None:
        stmt = stmt.join(active_period, active_period.c.person_id == Person.id)
    else:
        stmt = stmt.outerjoin(active_period, active_period.c.person_id == Person.id).where(
            Person.id.in_(person_ids)
        )
    rows = db.execute(stmt).all()

    affil_rows = db.execute(
        select(Affiliation.person_id, Institution)
        .join(Institution, Affiliation.institution_id == Institution.id)
        .where(
            Affiliation.start_date <= cutoff,
            (Affiliation.end_date.is_(None)) | (Affiliation.end_date >= cutoff),
        )
        .order_by(Affiliation.is_primary.desc(), Affiliation.start_date)
    ).all()

    affils_by_person: dict[int, list[Institution]] = {}
    for person_id, inst in affil_rows:
        insts = affils_by_person.setdefault(person_id, [])
        # Overlapping affiliation rows at the same institution (office
        # add_affiliation, importer re-runs) must not repeat the id — a
        # duplicate would render as \author[1,1]{...} in the LaTeX export.
        if all(i.id != inst.id for i in insts):
            insts.append(inst)

    authors = []
    for person, signing_name in rows:
        insts = affils_by_person.get(person.id, [])
        authors.append(
            {
                "person_id": person.id,
                "family_name": person.family_name,
                "given_name": person.given_name,
                "display_name": signing_name
                or f"{person.given_name} {person.family_name}",
                "orcid": person.orcid,
                "institution_ids": [i.id for i in insts],
                "_institutions": insts,  # stripped below
            }
        )

    authors.sort(key=lambda a: _sort_key(a["family_name"], a["given_name"]))

    # Number institutions by first appearance in author order.
    institutions: dict[str, dict] = {}
    order = 0
    for a in authors:
        for inst in a["_institutions"]:
            key = str(inst.id)
            if key not in institutions:
                order += 1
                institutions[key] = {
                    "id": inst.id,
                    "index": order,
                    "name": inst.name,
                    "short_name": inst.short_name,
                    "latex_address": inst.latex_address,
                }
        del a["_institutions"]

    # An author with no affiliation on the cutoff date would silently get an
    # empty affiliation in every export; flag them so the office can fix the
    # gap before publishing.
    warnings = [
        f"{a['display_name']} has no affiliation on the cutoff date"
        for a in authors
        if not a["institution_ids"]
    ]

    return {
        "cutoff_date": cutoff.isoformat(),
        "authors": authors,
        "institutions": institutions,
        "warnings": warnings,
    }
