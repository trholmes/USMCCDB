"""Pure-unit tests for author-list rendering (no database needed)."""

from app.services.author_list import _sort_key
from app.services.exports import render_tex, render_txt, render_xml, tex_escape

SNAPSHOT = {
    "cutoff_date": "2026-07-01",
    "authors": [
        {
            "person_id": 1,
            "family_name": "Alvarez",
            "given_name": "Ana",
            "display_name": "Ana Alvarez",
            "orcid": "0000-0002-1825-0097",
            "institution_ids": [10, 20],
        },
        {
            "person_id": 2,
            "family_name": "Brown",
            "given_name": "Bob",
            "display_name": "Bob Brown",
            "orcid": None,
            "institution_ids": [20],
        },
    ],
    "institutions": {
        "10": {"id": 10, "index": 1, "name": "University of Tennessee, Knoxville",
               "short_name": "UTK", "latex_address": "University of Tennessee, Knoxville, TN 37996, USA"},
        "20": {"id": 20, "index": 2, "name": "Fermilab", "short_name": "FNAL",
               "latex_address": None},
    },
}


def test_sort_key_accent_insensitive():
    assert _sort_key("Álvarez", "Ana") == _sort_key("Alvarez", "Ana")
    assert _sort_key("de la Cruz", "X") < _sort_key("Zhang", "A")
    # Case-insensitive: van Water sorts with V, not after all uppercase names.
    assert _sort_key("van Water", "A") < _sort_key("Zhang", "A")


def test_tex_escape():
    assert tex_escape("O'Brien & Sons_100%") == r"O'Brien \& Sons\_100\%"
    assert tex_escape("a^b") == r"a\textasciicircum{}b"


def test_render_txt():
    out = render_txt(SNAPSHOT)
    assert "A. Alvarez^{1,2}" in out
    assert "B. Brown^{2}" in out
    assert "1. University of Tennessee, Knoxville" in out
    assert "2 authors" in out


def test_render_tex():
    out = render_tex(SNAPSHOT)
    assert r"\author[1,2]{Ana Alvarez}" in out
    assert r"\affil[1]{University of Tennessee, Knoxville, TN 37996, USA}" in out
    # Institution without latex_address falls back to its name.
    assert r"\affil[2]{Fermilab}" in out


def test_render_xml():
    out = render_xml(SNAPSHOT)
    assert '<?xml version="1.0"' in out
    assert "<foaf:familyName>Alvarez</foaf:familyName>" in out
    assert '<cal:authorid source="ORCID">0000-0002-1825-0097</cal:authorid>' in out
    assert 'organizationid="o1"' in out
    # Bob has no ORCID: no empty authorid block for him.
    assert out.count("cal:authorids") == 2  # one open + one close tag, Ana only
