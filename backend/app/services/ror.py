"""Institution coordinates and ids from the public ROR API (ror.org).

Backs the ``seed-coordinates`` CLI command. Parsing is kept separate from
the network fetches so it can be unit-tested against fixed JSON payloads
without network access. Coordinates come from the record's first location's
``geonames_details`` — the same field the institution edit form's
browser-side "Fetch from ROR" button reads.
"""

from dataclasses import dataclass

import httpx

ROR_API = "https://api.ror.org/v2/organizations"
USER_AGENT = "USMCCDB (+https://github.com/trholmes/usmccdb)"


@dataclass
class RorMatch:
    ror_id: str  # bare form, e.g. "05gvnxz63"
    name: str
    latitude: float | None
    longitude: float | None


def parse_coordinates(record: dict) -> tuple[float, float] | None:
    """First location's geonames coordinates of a v2 record, if present."""
    locations = record.get("locations") or [{}]
    geo = locations[0].get("geonames_details") or {}
    lat, lng = geo.get("lat"), geo.get("lng")
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


def _bare_id(record: dict) -> str:
    # v2 record ids are full URLs like https://ror.org/05gvnxz63
    return str(record.get("id", "")).rstrip("/").rsplit("/", 1)[-1]


def _display_name(record: dict) -> str:
    for name in record.get("names") or []:
        if "ror_display" in (name.get("types") or []):
            return name.get("value") or _bare_id(record)
    return _bare_id(record)


def parse_affiliation_match(payload: dict) -> RorMatch | None:
    """The single confident ("chosen") match of an affiliation query, if any.

    ROR's affiliation matcher flags at most one item as chosen; anything
    less certain needs a human decision, so it is deliberately ignored here.
    """
    for item in payload.get("items") or []:
        if item.get("chosen"):
            org = item.get("organization") or {}
            coords = parse_coordinates(org)
            return RorMatch(
                ror_id=_bare_id(org),
                name=_display_name(org),
                latitude=coords[0] if coords else None,
                longitude=coords[1] if coords else None,
            )
    return None


def fetch_record(client: httpx.Client, ror_id: str) -> dict:
    resp = client.get(f"{ROR_API}/{ror_id}")
    resp.raise_for_status()
    return resp.json()


def fetch_affiliation_match(client: httpx.Client, affiliation: str) -> RorMatch | None:
    resp = client.get(ROR_API, params={"affiliation": affiliation})
    resp.raise_for_status()
    return parse_affiliation_match(resp.json())
