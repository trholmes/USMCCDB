"""ROR payload parsing for seed-coordinates — pure functions against fixed
JSON payloads, so (like test_migrations.py) these run without a database or
network access."""

from app.services.ror import (
    parse_acronym,
    parse_address,
    parse_affiliation_match,
    parse_coordinates,
    parse_country,
    parse_short_name,
)

RECORD = {
    "id": "https://ror.org/024mw5h28",
    "types": ["education"],
    "names": [
        {"value": "UTK", "types": ["acronym"]},
        {"value": "University of Tennessee", "types": ["ror_display", "label"]},
    ],
    "locations": [
        {
            "geonames_id": 4634946,
            "geonames_details": {
                "name": "Knoxville",
                "lat": 35.960638,
                "lng": -83.920739,
                "country_code": "US",
                "country_name": "United States",
                "country_subdivision_code": "TN",
                "country_subdivision_name": "Tennessee",
            },
        }
    ],
}


def test_parse_coordinates():
    assert parse_coordinates(RECORD) == (35.960638, -83.920739)


def test_parse_coordinates_missing():
    assert parse_coordinates({}) is None
    assert parse_coordinates({"locations": []}) is None
    assert parse_coordinates({"locations": [{"geonames_details": {"lat": 1.0}}]}) is None


def test_parse_acronym():
    assert parse_acronym(RECORD) == "UTK"
    assert parse_acronym({}) is None
    assert parse_acronym({"names": [{"value": "X", "types": ["label"]}]}) is None


def _education(name: str, acronym: str | None = None) -> dict:
    names = [{"value": name, "types": ["ror_display"]}]
    if acronym:
        names.append({"value": acronym, "types": ["acronym"]})
    return {"types": ["education"], "names": names}


def test_short_name_universities_use_name_not_acronym():
    # "University of X" and "X University" take the distinctive part…
    assert parse_short_name(RECORD) == "Tennessee"
    assert parse_short_name(_education("Cornell University", "CU")) == "Cornell"
    assert parse_short_name(_education("The Ohio State University", "OSU")) == "Ohio State"
    assert parse_short_name(_education("Texas A&M University", "TAMU")) == "Texas A&M"
    # …the UC system reads as "UC <campus>"…
    assert (
        parse_short_name(_education("University of California, Berkeley", "UCB"))
        == "UC Berkeley"
    )
    # …and a name that fits no trusted pattern falls back to the acronym.
    assert (
        parse_short_name(_education("Massachusetts Institute of Technology", "MIT")) == "MIT"
    )
    assert parse_short_name(_education("Weird College Name")) is None


def test_short_name_labs_keep_the_acronym():
    lab = {
        "types": ["facility", "funder"],
        "names": [
            {"value": "Fermi National Accelerator Laboratory", "types": ["ror_display"]},
            {"value": "FNAL", "types": ["acronym"]},
        ],
    }
    assert parse_short_name(lab) == "FNAL"


def test_parse_address_us_includes_state_and_usa():
    assert parse_address(RECORD) == "University of Tennessee, Knoxville, TN, USA"


def test_parse_address_non_us_uses_country_name():
    record = {
        "names": [{"value": "CERN Lab", "types": ["ror_display"]}],
        "locations": [
            {
                "geonames_details": {
                    "name": "Geneva",
                    "country_code": "CH",
                    "country_name": "Switzerland",
                }
            }
        ],
    }
    assert parse_address(record) == "CERN Lab, Geneva, Switzerland"


def test_parse_address_requires_name_and_city():
    assert parse_address({}) is None
    # No ror_display name → no address (a bare id is not an address).
    assert parse_address({"locations": RECORD["locations"]}) is None
    # No city either.
    assert parse_address({"names": RECORD["names"], "locations": []}) is None


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
    assert match.short_name == "Tennessee"
    assert match.address == "University of Tennessee, Knoxville, TN, USA"
    assert (match.country_code, match.country_name) == ("US", "United States")
    assert (match.latitude, match.longitude) == (35.960638, -83.920739)


def test_parse_country():
    assert parse_country(RECORD) == ("US", "United States")
    assert parse_country({}) == (None, None)
    assert parse_country({"locations": [{"geonames_details": {"country_code": "CH"}}]}) == (
        "CH",
        None,
    )


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
