# CLAUDE.md

Guidance for AI agents (and new contributors) working in this repo.

## What this is

Membership / speakers / publications / author-list database for the US Muon
Collider Collaboration (Fence-inspired, self-hosted). Design doc: `docs/PLAN.md`.

- **backend/** — FastAPI + SQLAlchemy 2 + Alembic, PostgreSQL. Routers in
  `app/routers/`, models in `app/models/`, Pydantic schemas in `app/schemas/`,
  CSV/XLSX import + demo-data CLI in `app/cli.py`.
- **frontend/** — React + TypeScript + Mantine 7 + Vite, in `frontend/src/`.
- **docker/**, **scripts/**, `docker-compose.yml` — 5-container deployment
  (db, backend, frontend, caddy, backup).

## Build & test commands

CI (`.github/workflows/ci.yml`) runs two checks on every push; run both before
pushing:

**Backend tests** — need a real PostgreSQL via `TEST_DATABASE_URL`; they skip
silently without it (a "passing" run with everything skipped proves nothing).
With the compose stack up:

```sh
docker compose exec backend sh -c 'TEST_DATABASE_URL=$DATABASE_URL pytest -q'
```

**Frontend typecheck + build** (no separate lint or unit tests):

```sh
cd frontend && npm install --no-audit --no-fund && npm run build
```

### Backend tests without Docker (cloud/sandbox sessions)

In environments with no Docker daemon (e.g. Claude Code on the web), install
deps and boot a throwaway Postgres directly — Postgres 16 server binaries are
preinstalled at `/usr/lib/postgresql/16/bin` but no cluster is running:

```sh
cd backend
pip install -r requirements.txt --ignore-installed PyJWT  # debian PyJWT can't be uninstalled
pip install --force-reinstall cffi                        # system cffi is broken for bcrypt

su postgres -c '/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/testdata -A trust'
su postgres -c '/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/testdata \
  -l /var/lib/postgresql/pg.log -o "-k /var/lib/postgresql -p 5433" start'
su postgres -c '/usr/lib/postgresql/16/bin/createdb -h /var/lib/postgresql -p 5433 testdb'

TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost:5433/testdb" python -m pytest -q
```

Notes: run the server as the `postgres` user with a data dir under
`/var/lib/postgresql` (other paths aren't traversable by that user); the test
fixture creates the `btree_gist` extension and drops/recreates all tables
itself, so the database just has to exist.

## Migrations

- Alembic revisions in `backend/alembic/versions/`, sequential ids (`0001`,
  `0002`, …). Written as raw SQL with `IF [NOT] EXISTS` guards because fresh
  installs get the schema from `metadata.create_all` — a migration must
  tolerate the column/table already existing.
- Every schema change needs **both** the model change and a migration.
- Verify new migrations both ways on a scratch database:
  `DATABASE_URL=... SECRET_KEY=x python -m alembic upgrade head` (and
  `downgrade <prev>`).

## Conventions & invariants

- `frontend/src/constants.ts` mirrors backend enums and permission rules
  (career stages, statuses, research areas, voting eligibility). When one side
  changes, update the other.
- Date ranges (affiliations, author periods) are **inclusive on both ends** —
  author-list generation depends on this. An institution move closes the old
  affiliation the day *before* the move date; a same-day move deletes the
  superseded row (see `_close_primary` in `app/routers/people.py`).
- At most one open primary affiliation per person (partial unique index);
  author periods must not overlap (EXCLUDE constraint, needs `btree_gist`).
- Roles: `admin` / `office` / `member`. Members may edit only the
  `SELF_EDITABLE` fields on their own profile and set only `SELF_SETTABLE_STATUSES`;
  moderation states (`pending`/`rejected`) are office-only. A person holding
  an active `admin_contact` collab role (Administrative Institutional Contact,
  institution-scoped) may also edit the `ADMIN_CONTACT_EDITABLE` fields of
  people currently at their institution. Voting membership
  requires an active, non-student member currently at a US institution
  (`institutions.is_us`) — enforced server-side everywhere the involved
  fields change.
- Status and membership changes are recorded append-only in
  `membership_events`; don't mutate history.
- API tests live in `backend/tests/test_api.py` and exercise the real HTTP
  API via `TestClient` (module-scoped, tables dropped/recreated per run).
- Commit messages: single imperative summary line, optional body.

## Workflow

- Work on a feature branch, never directly on `main`.
- When a change is complete and both CI checks pass locally, commit, push,
  and **open a PR against `main` automatically** — no need to ask first.
  Reference the issue it addresses (e.g. `Closes #15`) and summarize what
  changed and how it was tested.
