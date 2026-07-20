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

    # The initial affiliation records the stage the applicant applied at.
    person = admin.get(f"/api/v1/people/{pid}").json()
    assert person["affiliations"][0]["career_stage"] == "postdoc"


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


def _linked_member(admin, *, given, family, email, career_stage="postdoc"):
    """Create an active person + a member account linked to them, and return a
    logged-in TestClient plus the person id."""
    person = admin.post(
        "/api/v1/people/apply",
        json={
            "given_name": given,
            "family_name": family,
            "email": email,
            "career_stage": career_stage,
        },
    ).json()
    admin.post(f"/api/v1/people/{person['id']}/status", json={"status": "active"})
    uname = email.split("@")[0]
    r = admin.post(
        "/api/v1/auth/users",
        json={
            "username": uname,
            "password": "member-pw-123",
            "role": "member",
            "person_id": person["id"],
        },
    )
    assert r.status_code == 201, r.text
    c = TestClient(app)
    assert c.post(
        "/api/v1/auth/login", json={"username": uname, "password": "member-pw-123"}
    ).status_code == 200
    return c, person["id"]


def test_member_self_status_change_with_effective_date(admin):
    member, pid = _linked_member(
        admin, given="Sam", family="Self", email="sam.self@example.edu"
    )

    # A member may step back as of a date they enter; history records it.
    r = member.post(
        f"/api/v1/people/{pid}/status",
        json={"status": "inactive", "effective_date": "2026-03-15"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "inactive"

    events = member.get(f"/api/v1/people/{pid}/events").json()
    last = events[-1]
    assert last["to_status"] == "inactive"
    assert last["effective_date"] == "2026-03-15"

    # Members cannot self-assign moderation/application states.
    assert member.post(f"/api/v1/people/{pid}/status", json={"status": "rejected"}).status_code == 403
    assert member.post(f"/api/v1/people/{pid}/status", json={"status": "pending"}).status_code == 403


def test_member_self_institution_move_keeps_history(admin):
    member, pid = _linked_member(
        admin, given="Ida", family="Inst", email="ida.inst@example.edu"
    )
    a = admin.post("/api/v1/institutions", json={"name": "Alpha University"}).json()
    b = admin.post("/api/v1/institutions", json={"name": "Beta Institute"}).json()

    # Start at Alpha.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": a["id"], "start_date": "2025-01-01"},
    ).status_code == 201

    # Move to Beta as of a later date — history is preserved.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": b["id"], "start_date": "2026-06-01"},
    ).status_code == 201

    person = member.get(f"/api/v1/people/{pid}").json()
    affils = sorted(person["affiliations"], key=lambda x: x["start_date"])
    assert [x["institution"]["name"] for x in affils] == ["Alpha University", "Beta Institute"]
    # Old affiliation ends the day BEFORE the move — sharing the boundary date
    # would double-list the person on an author list cut on the move date.
    assert affils[0]["end_date"] == "2026-05-31"
    assert affils[1]["end_date"] is None  # new one is open

    # An author list cut exactly on the move date shows only the new institution.
    for inst_id in (a["id"], b["id"]):
        admin.patch(f"/api/v1/institutions/{inst_id}", json={"latex_address": "addr"})
    admin.post(f"/api/v1/people/{pid}/author-periods", json={"start_date": "2025-01-01"})
    snap = admin.post(
        "/api/v1/author-lists/preview", json={"cutoff_date": "2026-06-01"}
    ).json()
    row = next(x for x in snap["authors"] if x["person_id"] == pid)
    assert row["institution_ids"] == [b["id"]]

    # Backdating before the current start is rejected; future dates are
    # rejected; no cross-profile moves.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": a["id"], "start_date": "2025-01-01"},
    ).status_code == 400
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": a["id"], "start_date": "2199-01-01"},
    ).status_code == 422
    other = admin.get("/api/v1/people").json()[0]["id"]
    if other != pid:
        assert member.post(
            f"/api/v1/people/{other}/institution",
            json={"institution_id": a["id"], "start_date": "2026-01-01"},
        ).status_code == 403

    # A same-day move is a correction: the superseded zero-length row is
    # dropped rather than left as a one-day affiliation.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": a["id"], "start_date": "2026-06-01"},
    ).status_code == 201
    person = member.get(f"/api/v1/people/{pid}").json()
    open_affils = [x for x in person["affiliations"] if x["end_date"] is None]
    assert len(open_affils) == 1 and open_affils[0]["institution"]["id"] == a["id"]
    assert all(x["institution"]["id"] != b["id"] for x in person["affiliations"])


def test_institution_history_records_career_stage(admin):
    member, pid = _linked_member(
        admin, given="Cara", family="Stage", email="cara.stage@example.edu", career_stage="grad"
    )
    a = admin.post("/api/v1/institutions", json={"name": "Gamma College"}).json()
    b = admin.post("/api/v1/institutions", json={"name": "Delta Lab"}).json()

    # A move without a stage stamps the person's current stage.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": a["id"], "start_date": "2025-01-01"},
    ).status_code == 201
    person = member.get(f"/api/v1/people/{pid}").json()
    assert person["affiliations"][0]["career_stage"] == "grad"

    # A move with a new stage updates the profile and the new affiliation,
    # while the closed affiliation keeps the old stage.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": b["id"], "start_date": "2026-06-01", "career_stage": "postdoc"},
    ).status_code == 201
    person = member.get(f"/api/v1/people/{pid}").json()
    assert person["career_stage"] == "postdoc"
    affils = sorted(person["affiliations"], key=lambda x: x["start_date"])
    assert [x["career_stage"] for x in affils] == ["grad", "postdoc"]

    # Editing the stage on the profile keeps the open affiliation in step.
    assert member.patch(f"/api/v1/people/{pid}", json={"career_stage": "staff"}).status_code == 200
    person = member.get(f"/api/v1/people/{pid}").json()
    open_affil = next(x for x in person["affiliations"] if x["end_date"] is None)
    assert open_affil["career_stage"] == "staff"

    # A voting member cannot become a student via an institution move (same
    # rule as a profile edit); nothing about the move is applied.
    assert member.patch(f"/api/v1/people/{pid}", json={"is_voting": True}).status_code == 200
    r = member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": a["id"], "start_date": "2026-07-01", "career_stage": "grad"},
    )
    assert r.status_code == 422
    person = member.get(f"/api/v1/people/{pid}").json()
    assert person["career_stage"] == "staff"
    open_affil = next(x for x in person["affiliations"] if x["end_date"] is None)
    assert open_affil["institution"]["id"] == b["id"]


def test_institution_people_count(admin):
    a = admin.post("/api/v1/institutions", json={"name": "Count University"}).json()
    b = admin.post("/api/v1/institutions", json={"name": "Empty Tech"}).json()

    pids = []
    for name in ("One", "Two", "Three"):
        p = admin.post(
            "/api/v1/people/apply",
            json={
                "given_name": name,
                "family_name": "Counter",
                "email": f"{name.lower()}.counter@example.edu",
            },
        ).json()
        pids.append(p["id"])

    # Two people currently at Count University…
    for pid in pids[:2]:
        assert admin.post(
            f"/api/v1/people/{pid}/affiliations",
            json={"institution_id": a["id"], "start_date": "2025-01-01"},
        ).status_code == 201
    # …and one whose affiliation already ended — past members don't count.
    assert admin.post(
        f"/api/v1/people/{pids[2]}/affiliations",
        json={"institution_id": a["id"], "start_date": "2024-01-01", "end_date": "2024-12-31"},
    ).status_code == 201

    counts = {i["name"]: i["people_count"] for i in admin.get("/api/v1/institutions").json()}
    assert counts["Count University"] == 2
    assert counts["Empty Tech"] == 0
    assert admin.get(f"/api/v1/institutions/{a['id']}").json()["people_count"] == 2


def test_member_voting_eligibility(admin):
    # A grad student cannot self-assign voting membership.
    grad, gid = _linked_member(
        admin, given="Gale", family="Grad", email="gale.grad@example.edu", career_stage="grad"
    )
    assert grad.patch(f"/api/v1/people/{gid}", json={"is_voting": True}).status_code == 422
    # …and neither can the office (the invariant binds every actor).
    assert admin.patch(f"/api/v1/people/{gid}", json={"is_voting": True}).status_code == 422

    # An active postdoc at a US institution can.
    pd, pdid = _linked_member(
        admin, given="Paz", family="Postdoc", email="paz.pd@example.edu", career_stage="postdoc"
    )
    inst = admin.post("/api/v1/institutions", json={"name": "Voting University"}).json()
    assert pd.post(
        f"/api/v1/people/{pdid}/institution",
        json={"institution_id": inst["id"], "start_date": "2025-01-01"},
    ).status_code == 201
    assert pd.patch(f"/api/v1/people/{pdid}", json={"is_voting": True}).status_code == 200
    assert pd.get(f"/api/v1/people/{pdid}").json()["is_voting"] is True

    # Becoming a student again while voting is rejected (invariant enforced).
    assert pd.patch(f"/api/v1/people/{pdid}", json={"career_stage": "grad"}).status_code == 422

    # Explicit nulls on non-nullable fields are a 422, not a 500.
    assert pd.patch(f"/api/v1/people/{pdid}", json={"is_voting": None}).status_code == 422
    assert pd.patch(f"/api/v1/people/{pdid}", json={"career_stage": None}).status_code == 422

    # Stepping back to inactive clears voting automatically.
    assert pd.post(f"/api/v1/people/{pdid}/status", json={"status": "inactive"}).status_code == 200
    assert pd.get(f"/api/v1/people/{pdid}").json()["is_voting"] is False

    # Even with a (hypothetically) stale voting flag, unrelated self-edits
    # must not be blocked by the eligibility check while inactive.
    r = pd.patch(f"/api/v1/people/{pdid}", json={"expertise": "detector R&D"})
    assert r.status_code == 200, r.text


def test_voting_requires_us_institution(admin):
    member, pid = _linked_member(
        admin, given="Uma", family="Usonly", email="uma.usonly@example.edu", career_stage="faculty"
    )
    us = admin.post("/api/v1/institutions", json={"name": "Stateside University"}).json()
    assert us["is_us"] is True  # US is the default
    abroad = admin.post(
        "/api/v1/institutions",
        json={"name": "Overseas Institute", "country": "Switzerland", "is_us": False},
    ).json()

    # Without a current primary affiliation there is no US institution to
    # qualify through.
    assert member.patch(f"/api/v1/people/{pid}", json={"is_voting": True}).status_code == 422

    # At a non-US institution, neither the member nor the office can set the
    # flag (the invariant binds every actor).
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": abroad["id"], "start_date": "2025-01-01"},
    ).status_code == 201
    assert member.patch(f"/api/v1/people/{pid}", json={"is_voting": True}).status_code == 422
    assert admin.patch(f"/api/v1/people/{pid}", json={"is_voting": True}).status_code == 422

    # Moving to a US institution unlocks it.
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": us["id"], "start_date": "2025-06-01"},
    ).status_code == 201
    assert member.patch(f"/api/v1/people/{pid}", json={"is_voting": True}).status_code == 200

    # A voting member cannot move to a non-US institution while keeping the
    # flag (same rule as becoming a student); nothing about the move applies.
    r = member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": abroad["id"], "start_date": "2026-01-01"},
    )
    assert r.status_code == 422
    person = member.get(f"/api/v1/people/{pid}").json()
    open_affil = next(x for x in person["affiliations"] if x["end_date"] is None)
    assert open_affil["institution"]["id"] == us["id"]
    assert person["is_voting"] is True

    # The office affiliation route enforces the same rule for open primaries.
    assert admin.post(
        f"/api/v1/people/{pid}/affiliations",
        json={"institution_id": abroad["id"], "is_primary": True, "start_date": "2026-01-01"},
    ).status_code == 422
    # …but recording closed history at a non-US institution is fine.
    assert admin.post(
        f"/api/v1/people/{pid}/affiliations",
        json={
            "institution_id": abroad["id"],
            "is_primary": False,
            "start_date": "2020-01-01",
            "end_date": "2020-12-31",
        },
    ).status_code == 201

    # Reclassifying the institution as non-US clears the voting flag of the
    # people currently there (like a deactivation does).
    assert admin.patch(f"/api/v1/institutions/{us['id']}", json={"is_us": False}).status_code == 200
    assert member.get(f"/api/v1/people/{pid}").json()["is_voting"] is False
    # …and flipping it back does not silently restore the flag.
    assert admin.patch(f"/api/v1/institutions/{us['id']}", json={"is_us": True}).status_code == 200
    assert member.get(f"/api/v1/people/{pid}").json()["is_voting"] is False


def test_research_areas_normalized(admin):
    member, pid = _linked_member(
        admin, given="Ria", family="Areas", email="ria.areas@example.edu"
    )
    # Standard categories are normalized: case, spacing, and duplicates.
    r = member.patch(
        f"/api/v1/people/{pid}",
        json={
            "research_areas": "experimental particle physics,  ACCELERATOR PHYSICS,"
            " Experimental Particle Physics"
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["research_areas"] == "Experimental Particle Physics, Accelerator Physics"
    # Values outside the standard set are rejected.
    r = member.patch(f"/api/v1/people/{pid}", json={"research_areas": "magnets"})
    assert r.status_code == 422
    # The field can be cleared, and free-form topics live in expertise.
    r = member.patch(
        f"/api/v1/people/{pid}", json={"research_areas": None, "expertise": "muon cooling, MDI"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["research_areas"] is None
    assert body["expertise"] == "muon cooling, MDI"


def test_directory_filters(admin):
    member, pid = _linked_member(
        admin, given="Fay", family="Filter", email="fay.filter@example.edu", career_stage="staff"
    )
    other, oid = _linked_member(
        admin, given="Ned", family="Nofilter", email="ned.nofilter@example.edu"
    )
    inst = admin.post("/api/v1/institutions", json={"name": "Filter University"}).json()
    assert member.post(
        f"/api/v1/people/{pid}/institution",
        json={"institution_id": inst["id"], "start_date": "2025-01-01"},
    ).status_code == 201
    assert member.patch(
        f"/api/v1/people/{pid}",
        json={"research_areas": "Accelerator Physics, Other/Multiple", "is_voting": True},
    ).status_code == 200

    # Research-area filter matches case-insensitively against the canonical
    # names, and the summary rows expose research_areas for the frontend.
    r = member.get("/api/v1/people?research_area=accelerator physics")
    assert r.status_code == 200, r.text
    ids = {p["id"] for p in r.json()}
    assert pid in ids and oid not in ids
    row = next(p for p in r.json() if p["id"] == pid)
    assert row["research_areas"] == "Accelerator Physics, Other/Multiple"

    # Unknown areas are rejected rather than silently matching nothing.
    assert member.get("/api/v1/people?research_area=magnets").status_code == 422

    # Voting filter, both polarities.
    voting = {p["id"] for p in member.get("/api/v1/people?is_voting=true").json()}
    assert pid in voting and oid not in voting
    nonvoting = {p["id"] for p in member.get("/api/v1/people?is_voting=false").json()}
    assert oid in nonvoting and pid not in nonvoting

    # Filters combine.
    r = member.get("/api/v1/people?research_area=Other/Multiple&career_stage=staff&is_voting=true")
    assert [p["id"] for p in r.json()] == [pid]


def test_office_status_change_clears_voting(admin):
    _, pid = _linked_member(
        admin, given="Vera", family="Vote", email="vera.vote@example.edu", career_stage="faculty"
    )
    inst = admin.post("/api/v1/institutions", json={"name": "Vote Lab"}).json()
    assert admin.post(
        f"/api/v1/people/{pid}/affiliations",
        json={"institution_id": inst["id"], "is_primary": True, "start_date": "2025-01-01"},
    ).status_code == 201
    assert admin.patch(f"/api/v1/people/{pid}", json={"is_voting": True}).status_code == 200

    # Office deactivation must clear the voting flag too, not just self-service.
    assert admin.post(f"/api/v1/people/{pid}/status", json={"status": "inactive"}).status_code == 200
    assert admin.get(f"/api/v1/people/{pid}").json()["is_voting"] is False


def test_member_cannot_self_reinstate(admin):
    # A pending applicant with a linked account cannot self-approve…
    person = admin.post(
        "/api/v1/people/apply",
        json={"given_name": "Pat", "family_name": "Pending", "email": "pat.pending@example.edu"},
    ).json()
    r = admin.post(
        "/api/v1/auth/users",
        json={
            "username": "patpending",
            "password": "member-pw-123",
            "role": "member",
            "person_id": person["id"],
        },
    )
    assert r.status_code == 201, r.text
    member = TestClient(app)
    assert member.post(
        "/api/v1/auth/login", json={"username": "patpending", "password": "member-pw-123"}
    ).status_code == 200
    assert member.post(
        f"/api/v1/people/{person['id']}/status", json={"status": "active"}
    ).status_code == 403

    # …nor can a rejected member reinstate themselves.
    admin.post(f"/api/v1/people/{person['id']}/status", json={"status": "rejected"})
    assert member.post(
        f"/api/v1/people/{person['id']}/status", json={"status": "active"}
    ).status_code == 403

    # Future-dated status changes are rejected outright.
    admin.post(f"/api/v1/people/{person['id']}/status", json={"status": "active"})
    assert member.post(
        f"/api/v1/people/{person['id']}/status",
        json={"status": "inactive", "effective_date": "2199-01-01"},
    ).status_code == 422


def test_membership_notes_hidden_from_members(admin):
    member, pid = _linked_member(
        admin, given="Nia", family="Note", email="nia.note@example.edu"
    )
    admin.post(
        f"/api/v1/people/{pid}/status",
        json={"status": "inactive", "note": "office-internal: verify affiliation"},
    )
    # Office sees the note; the member sees the transition but not the note.
    admin_events = admin.get(f"/api/v1/people/{pid}/events").json()
    assert any(e["note"] == "office-internal: verify affiliation" for e in admin_events)
    member_events = member.get(f"/api/v1/people/{pid}/events").json()
    assert [e["to_status"] for e in member_events] == [e["to_status"] for e in admin_events]
    assert all(e["note"] is None and e["actor_user_id"] is None for e in member_events)


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


def test_collab_roles_lifecycle(admin):
    member, pid = _linked_member(
        admin, given="Lea", family="Lead", email="lea.lead@example.edu"
    )

    # Simple roles need no qualifier.
    chair = admin.post(
        "/api/v1/collab-roles",
        json={"person_id": pid, "role": "chair", "start_date": "2025-01-01"},
    )
    assert chair.status_code == 201, chair.text

    # Generic organigram roles require a detail qualifier…
    r = admin.post(
        "/api/v1/collab-roles",
        json={"person_id": pid, "role": "representative", "start_date": "2025-01-01"},
    )
    assert r.status_code == 422
    # …and blank detail does not count.
    r = admin.post(
        "/api/v1/collab-roles",
        json={
            "person_id": pid,
            "role": "coordinator",
            "detail": "   ",
            "start_date": "2025-01-01",
        },
    )
    assert r.status_code == 422

    rep = admin.post(
        "/api/v1/collab-roles",
        json={
            "person_id": pid,
            "role": "representative",
            "detail": "Accelerator",
            "start_date": "2025-01-01",
        },
    )
    assert rep.status_code == 201, rep.text
    assert rep.json()["detail"] == "Accelerator"

    # Scoped roles keep their existing requirements.
    assert admin.post(
        "/api/v1/collab-roles",
        json={"person_id": pid, "role": "convener", "start_date": "2025-01-01"},
    ).status_code == 422

    # Listings resolve the person (for the leadership page).
    roles = admin.get(f"/api/v1/collab-roles?person_id={pid}").json()
    assert {x["role"] for x in roles} == {"chair", "representative"}
    assert all(x["person"]["family_name"] == "Lead" for x in roles)

    # Office can close a term; dates stay editable.
    rep_id = rep.json()["id"]
    r = admin.patch(f"/api/v1/collab-roles/{rep_id}", json={"end_date": "2026-06-30"})
    assert r.status_code == 200 and r.json()["end_date"] == "2026-06-30"
    # …but cannot blank a required qualifier.
    assert admin.patch(
        f"/api/v1/collab-roles/{rep_id}", json={"detail": None}
    ).status_code == 422

    # Members can read but not manage roles.
    assert member.get("/api/v1/collab-roles").status_code == 200
    assert member.post(
        "/api/v1/collab-roles",
        json={"person_id": pid, "role": "chair", "start_date": "2025-01-01"},
    ).status_code == 403
    assert member.patch(
        f"/api/v1/collab-roles/{rep_id}", json={"end_date": "2025-12-31"}
    ).status_code == 403
    assert member.delete(f"/api/v1/collab-roles/{rep_id}").status_code == 403

    assert admin.delete(f"/api/v1/collab-roles/{rep_id}").status_code == 204
