"""Institution coordinates and ids from the public ROR API (ror.org).

Backs the ``seed-coordinates`` CLI command. Parsing is kept separate from
the network fetches so it can be unit-tested against fixed JSON payloads
without network access. Coordinates come from the record's first location's
``geonames_details`` — the same field the institution edit form's
browser-side "Fetch from ROR" button reads.
"""

import re
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
    short_name: str | None = None  # candidate short_name (see parse_short_name)
    address: str | None = None  # draft author-list (latex) address


def parse_coordinates(record: dict) -> tuple[float, float] | None:
    """First location's geonames coordinates of a v2 record, if present."""
    locations = record.get("locations") or [{}]
    geo = locations[0].get("geonames_details") or {}
    lat, lng = geo.get("lat"), geo.get("lng")
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


def parse_acronym(record: dict) -> str | None:
    """The record's acronym ("UTK", "FNAL", …)."""
    for name in record.get("names") or []:
        if "acronym" in (name.get("types") or []):
            return name.get("value") or None
    return None


def _university_short_name(name: str) -> str | None:
    """The distinctive part of a university name, the way collaboration
    lists abbreviate them: "Cornell University" → "Cornell", "University of
    Chicago" → "Chicago", "University of California, Berkeley" → "UC
    Berkeley". None when the name doesn't fit a pattern we trust."""
    name = re.sub(r"^The\s+", "", name.strip())
    m = re.match(r"^University of California[,–-]\s*(.+)$", name, re.IGNORECASE)
    if m:
        return f"UC {m.group(1)}"
    m = re.match(r"^University of (.+)$", name, re.IGNORECASE)
    if m and "," not in m.group(1):
        return m.group(1)
    m = re.match(r"^(.+?) University$", name, re.IGNORECASE)
    if m and " of " not in m.group(1).lower():
        return m.group(1)
    return None


def parse_short_name(record: dict) -> str | None:
    """Candidate short name for a record. Universities (ROR type
    "education") read better as the distinctive part of their name
    ("Cornell", not "CU"); labs and everything else keep their acronym
    (FNAL, BNL, …). Falls back to the acronym when the university name
    doesn't fit a known pattern (e.g. "Massachusetts Institute of
    Technology" → "MIT")."""
    if "education" in (record.get("types") or []):
        derived = _university_short_name(_display_name(record) or "")
        if derived:
            return derived
    return parse_acronym(record)


def parse_address(record: dict) -> str | None:
    """A draft author-list address: "<name>, <city>, <ST>, USA" for US
    records (ROR has no street/zip, so this is a starting point for the
    office to refine), "<name>, <city>, <country>" elsewhere."""
    display = _display_name(record)
    locations = record.get("locations") or [{}]
    geo = locations[0].get("geonames_details") or {}
    city = geo.get("name")
    if not display or not city:
        return None
    parts = [display, city]
    if geo.get("country_code") == "US":
        subdivision = geo.get("country_subdivision_code")
        if subdivision:
            parts.append(subdivision)
        parts.append("USA")
    elif geo.get("country_name"):
        parts.append(geo["country_name"])
    return ", ".join(parts)


def _bare_id(record: dict) -> str:
    # v2 record ids are full URLs like https://ror.org/05gvnxz63
    return str(record.get("id", "")).rstrip("/").rsplit("/", 1)[-1]


def _display_name(record: dict) -> str | None:
    for name in record.get("names") or []:
        if "ror_display" in (name.get("types") or []):
            return name.get("value") or None
    return None


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
                name=_display_name(org) or _bare_id(org),
                latitude=coords[0] if coords else None,
                longitude=coords[1] if coords else None,
                short_name=parse_short_name(org),
                address=parse_address(org),
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
