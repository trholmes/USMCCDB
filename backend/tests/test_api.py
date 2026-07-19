"""API tests against a real PostgreSQL (needs TEST_DATABASE_URL, e.g. the
compose db). Skipped automatically when no test database is configured.

Run inside the stack:
    docker compose exec backend sh -c 'TEST_DATABASE_URL=$DATABASE_URL pytest -q'
"""

import os
from datetime import date

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL not set")

if TEST_DB:
    os.environ["DATABASE_URL"] = TEST_DB
    os.environ["SECRET_KEY"] = "test-secret"
    os.environ["BOOTSTRAP_ADMIN_USERNAME"] = "testadmin"
    os.environ["BOOTSTRAP_ADMIN_PASSWORD"] = "testadmin-pw"

    from fastapi.testclient import TestClient

    from app.db import Base, engine
    from app.main import app


@pytest.fixture(scope="module")
def client():
    from sqlalchemy import text

    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
        conn.commit()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:  # lifespan runs → bootstrap admin created
        yield c
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="module")
def admin(client):
    resp = client.post(
        "/api/v1/auth/login", json={"username": "testadmin", "password": "testadmin-pw"}
    )
    assert resp.status_code == 200, resp.text
    return client  # cookie persists on the client


def test_health(client):
    assert client.get("/api/v1/health").json() == {"status": "ok"}


def test_me_requires_auth(client):
    fresh = TestClient(app)
    assert fresh.get("/api/v1/auth/me").status_code == 401


def test_apply_and_approve_flow(admin):
    # Public application.
    resp = admin.post(
        "/api/v1/people/apply",
        json={
            "given_name": "Priya",
            "family_name": "Kumar",
            "email": "priya@example.edu",
            "career_stage": "postdoc",
            "institution_name": "Test University",
            "is_voting": True,
        },
    )
    assert resp.status_code == 201, resp.text
    pid = resp.json()["id"]
    assert resp.json()["status"] == "pending"

    # Office approves.
    resp = admin.post(f"/api/v1/people/{pid}/status", json={"status": "active"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"

    # Audit trail recorded both transitions.
    events = admin.get(f"/api/v1/people/{pid}/events").json()
    assert [e["to_status"] for e in events] == ["pending", "active"]


def test_author_list_generation(admin):
    # Institution with a formal address.
    inst = admin.post(
        "/api/v1/institutions",
        json={"name": "Univ One", "short_name": "U1", "latex_address": "Univ One, TN, USA"},
    ).json()

    # Two people, alphabetically tricky (accent should not matter).
    p1 = admin.post(
        "/api/v1/people/apply",
        json={"given_name": "Zoe", "family_name": "Ábel", "email": "zoe@example.edu"},
    ).json()
    p2 = admin.post(
        "/api/v1/people/apply",
        json={"given_name": "Al", "family_name": "Baker", "email": "al@example.edu"},
    ).json()

    for pid in (p1["id"], p2["id"]):
        admin.post(f"/api/v1/people/{pid}/status", json={"status": "active"})
        r = admin.post(
            f"/api/v1/people/{pid}/affiliations",
            json={"institution_id": inst["id"], "is_primary": True, "start_date": "2025-01-01"},
        )
        assert r.status_code == 201, r.text
        r = admin.post(
            f"/api/v1/people/{pid}/author-periods", json={"start_date": "2025-06-01"}
        )
        assert r.status_code == 201, r.text

    # Overlapping author period must be rejected.
    r = admin.post(
        f"/api/v1/people/{p1['id']}/author-periods", json={"start_date": "2026-01-01"}
    )
    assert r.status_code == 409

    # Preview: Ábel sorts before Baker despite the accent.
    snap = admin.post(
        "/api/v1/author-lists/preview", json={"cutoff_date": "2026-07-01"}
    ).json()
    names = [a["family_name"] for a in snap["authors"]]
    assert names.index("Ábel") < names.index("Baker")

    # Cutoff before the periods start → nobody.
    early = admin.post(
        "/api/v1/author-lists/preview", json={"cutoff_date": "2025-01-15"}
    ).json()
    assert early["authors"] == []

    # Full flow via a publication + exports.
    pub = admin.post("/api/v1/publications", json={"title": "First USMCC Paper"}).json()
    alist = admin.post(
        f"/api/v1/publications/{pub['id']}/author-list",
        json={"cutoff_date": "2026-07-01"},
    ).json()
    assert len(alist["snapshot"]["authors"]) >= 2

    tex = admin.get(f"/api/v1/author-lists/{alist['id']}/export?format=tex")
    assert tex.status_code == 200
    assert "\\author[" in tex.text
    xml = admin.get(f"/api/v1/author-lists/{alist['id']}/export?format=xml")
    assert "<collaborationauthorlist" in xml.text


def test_member_cannot_do_office_things(admin):
    # Create a plain member account.
    r = admin.post(
        "/api/v1/auth/users",
        json={"username": "plainmember", "password": "member-pw-123", "role": "member"},
    )
    assert r.status_code == 201, r.text

    member = TestClient(app)
    assert (
        member.post(
            "/api/v1/auth/login", json={"username": "plainmember", "password": "member-pw-123"}
        ).status_code
        == 200
    )
    # Directory is visible…
    assert member.get("/api/v1/people").status_code == 200
    # …but office/admin actions are forbidden.
    somebody = member.get("/api/v1/people").json()[0]["id"]
    assert member.post(f"/api/v1/people/{somebody}/status", json={"status": "inactive"}).status_code == 403
    assert member.post("/api/v1/institutions", json={"name": "Nope U"}).status_code == 403
    assert member.get("/api/v1/auth/users").status_code == 403
    assert member.post("/api/v1/publications", json={"title": "Nope"}).status_code == 403


def test_photo_upload_and_serve(admin, tmp_path_factory):
    os.environ["PHOTOS_DIR"] = str(tmp_path_factory.mktemp("photos"))
    from app.config import get_settings

    get_settings.cache_clear()

    person = admin.get("/api/v1/people").json()[0]
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d494844520000000100000001080600000"
        "01f15c4890000000d49444154789c6260010000000500010d0a2db400"
        "00000049454e44ae426082"
    )
    r = admin.post(
        f"/api/v1/people/{person['id']}/photo",
        files={"file": ("me.png", png, "image/png")},
    )
    assert r.status_code == 201, r.text
    assert r.json()["photo_file"]

    served = admin.get(f"/api/v1/people/{person['id']}/photo")
    assert served.status_code == 200
    assert served.content == png

    # Wrong content type is rejected.
    bad = admin.post(
        f"/api/v1/people/{person['id']}/photo",
        files={"file": ("evil.svg", b"<svg/>", "image/svg+xml")},
    )
    assert bad.status_code == 422

    assert admin.delete(f"/api/v1/people/{person['id']}/photo").status_code == 204
    assert admin.get(f"/api/v1/people/{person['id']}/photo").status_code == 404


def test_speakers_flow(admin):
    event = admin.post("/api/v1/events", json={"name": "Snowmass 2026"}).json()
    talk = admin.post(
        "/api/v1/talks",
        json={
            "title": "Muon Collider Status",
            "event_id": event["id"],
            "talk_type": "plenary",
            "date": "2026-08-01",
            "is_invited": True,
        },
    ).json()

    person = admin.get("/api/v1/people").json()[0]
    nom = admin.post(
        f"/api/v1/talks/{talk['id']}/nominations", json={"person_id": person["id"]}
    )
    assert nom.status_code == 201, nom.text

    # Assigning the nomination sets the talk's speaker.
    r = admin.patch(f"/api/v1/nominations/{nom.json()['id']}", json={"status": "assigned"})
    assert r.status_code == 200
    talk_now = admin.get(f"/api/v1/talks?event_id={event['id']}").json()[0]
    assert talk_now["speaker_person_id"] == person["id"]
    assert talk_now["status"] == "assigned"

    stats = admin.get("/api/v1/stats/talks?by=person").json()
    row = next(s for s in stats if s["key_id"] == person["id"])
    assert row["talks"] >= 1 and row["invited"] >= 1
