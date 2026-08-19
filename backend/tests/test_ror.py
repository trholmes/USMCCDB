"""ROR payload parsing for seed-coordinates — pure functions against fixed
JSON payloads, so (like test_migrations.py) these run without a database or
network access."""

from app.services.ror import parse_affiliation_match, parse_coordinates

RECORD = {
    "id": "https://ror.org/024mw5h28",
    "names": [
        {"value": "UTK", "types": ["acronym"]},
        {"value": "University of Tennessee", "types": ["ror_display", "label"]},
    ],
    "locations": [
        {
            "geonames_id": 4634946,
            "geonames_details": {"name": "Knoxville", "lat": 35.960638, "lng": -83.920739},
        }
    ],
}


def test_parse_coordinates():
    assert parse_coordinates(RECORD) == (35.960638, -83.920739)


def test_parse_coordinates_missing():
    assert parse_coordinates({}) is None
    assert parse_coordinates({"locations": []}) is None
    assert parse_coordinates({"locations": [{"geonames_details": {"lat": 1.0}}]}) is None


def test_affiliation_match_uses_only_the_chosen_item():
    payload = {
        "items": [
            {"chosen": False, "score": 0.9, "organization": {"id": "https://ror.org/000000000"}},
            {"chosen": True, "score": 1.0, "organization": RECORD},
        ]
    }
    match = parse_affiliation_match(payload)
    assert match is not None
    assert match.ror_id == "024mw5h28"  # bare id extracted from the URL
    assert match.name == "University of Tennessee"  # the ror_display name
    assert (match.latitude, match.longitude) == (35.960638, -83.920739)


def test_affiliation_match_none_when_nothing_chosen():
    payload = {"items": [{"chosen": False, "score": 0.7, "organization": RECORD}]}
    assert parse_affiliation_match(payload) is None
    assert parse_affiliation_match({"items": []}) is None
    assert parse_affiliation_match({}) is None


def test_affiliation_match_survives_record_without_coordinates():
    org = {"id": "https://ror.org/05gvnxz63", "names": [], "locations": []}
    match = parse_affiliation_match({"items": [{"chosen": True, "organization": org}]})
    assert match is not None
    assert match.ror_id == "05gvnxz63"
    assert match.name == "05gvnxz63"  # falls back to the id
    assert match.latitude is None and match.longitude is None
