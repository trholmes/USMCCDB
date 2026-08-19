# USMCC Collaboration Database

[![CI](https://github.com/trholmes/USMCCDB/actions/workflows/ci.yml/badge.svg)](https://github.com/trholmes/USMCCDB/actions/workflows/ci.yml)

The membership, speakers, and publications database of the
[US Muon Collider Collaboration](https://muoncollider.us) — inspired by the
[Glance/Fence](https://readthedocs.web.cern.ch/display/FP/Fence+Project) systems
used by the LHC experiments, built as a self-hosted open-source stack:
**FastAPI + PostgreSQL + React (Mantine)**, deployed with a single
`docker compose`, HTTPS via Caddy, nightly backups, and ORCID sign-in.

| | |
|---|---|
| ![Login](docs/screenshots/login.png) | ![Directory](docs/screenshots/directory.png) |
| ![Talks](docs/screenshots/talks.png) | ![Stats](docs/screenshots/stats.png) |
| ![Institution](docs/screenshots/institution.png) | ![Publication with author list](docs/screenshots/publication.png) |

*(Screenshots show the bundled fictional demo dataset — `seed-demo`.)*

## What it does

- **Membership** — people, institutions, dated affiliations, voting-member flag,
  career stage, working groups, leadership roles, member photos, and an
  register → approve workflow with a full audit trail.
- **Speakers bureau** — conferences, talk records (plenary/parallel/poster/
  seminar/outreach, invited vs. contributed), member nominations, office
  assignment, and fair-share statistics per person and institution.
- **Publications** — paper/proceedings/note/white-paper registry any member
  can add to (the creator becomes an editor), with a status workflow
  (in progress → collaboration review → submitted → published). Editors
  attach the people involved from the directory, request collaboration
  review when ready (with suggested acknowledgment text crediting USMCC and
  the assigned reviewers), plus editors/contacts, arXiv/DOI metadata, and
  auto-assigned `USMCC-XXXX-YYYY-NNN` codes.
- **Author lists** — one click builds the alphabetical (accent-aware) author
  list for any cutoff date, either collaboration-wide from members' authorship
  periods and affiliations or from just the people involved in a publication,
  frozen as a snapshot and exportable as **plain text**, **LaTeX (`authblk`)**,
  and **INSPIRE/arXiv `authors.xml`**.
- **Sign-in** — ORCID OAuth for members (free public ORCID API) plus local
  username/password accounts; admins can create as many local accounts as
  needed. Roles: `admin`, `office`, `member` (+ working-group conveners with
  scoped rights).
- **Interconnected, Glance-style** — every page cross-links: directory rows →
  institution pages (with their member lists) → profiles → the person's talks
  and back; speaker and stats entries click through to people. Every listing
  table sorts by any column (click cycles ascending → descending → default).
  Institutions also plot on a member-count-weighted **map**.
- **Self-administering** — a web admin panel covers user accounts (roles,
  merging, password resets), a site announcement banner, sign-in auditing,
  system health, and backups: nightly dumps to host disk plus one-click
  **backup and restore** with automatic pre-restore safety snapshots.

## Quick start

Requirements: any Linux box with Docker (compose v2).

```bash
git clone https://github.com/trholmes/USMCCDB.git
cd USMCCDB
./scripts/start.sh
```

First run creates `.env` with random secrets and prints the **bootstrap admin
password** — log in at <http://localhost:8080>, then change it (Admin → user
accounts). The stack is 5 containers: PostgreSQL, the FastAPI backend, nginx
serving the web UI, Caddy (HTTPS, only when a domain is set), and a nightly
backup sidecar.

That is a complete working instance. To take it from "running" to "fully set
up", work through the sections below in order:

1. **[Domain + HTTPS](#going-live-at-dbmuoncolliderus)** — `SITE_DOMAIN` turns on the Caddy TLS container.
2. **[ORCID sign-in](#orcid-sign-in)** — so members sign in with their ORCID iD instead of local accounts.
3. **[Email notifications](#email-notifications)** — registration and publication-workflow mail.
4. **[Import existing data](#importing-the-existing-spreadsheets)** and **[member photos](#member-photos)**.
5. **[Institution map](#institution-map)** — add coordinates so the map view fills in.
6. **[Admin panel](#the-admin-panel)** — banner/login message, accounts, backups & restore.

Each step is optional and independent — skip what you don't need.

### Going live at db.muoncollider.us

1. Point the domain's DNS **A record** at your server; open ports **80 + 443**.
2. In `.env`, set:
   ```
   SITE_DOMAIN=db.muoncollider.us
   SITE_URL=https://db.muoncollider.us
   CONTACT_EMAIL=you@example.edu
   ```
3. `./scripts/start.sh` again. Caddy starts in its own container, obtains a
   Let's Encrypt certificate automatically, and renews it forever.

### ORCID sign-in

1. Register a (free) public API client at
   <https://orcid.org/developer-tools>, with redirect URI
   `https://db.muoncollider.us/api/v1/auth/orcid/callback`.
2. Put `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET` in `.env`, re-run
   `./scripts/start.sh`.

Members whose ORCID iD is already in the database are linked automatically on
first sign-in; unknown ORCIDs get a pending membership for the office to
approve. Set `ORCID_HOST=sandbox.orcid.org` to test against the ORCID sandbox.

### Email notifications

Everything email-related is already built in — the only setup is pointing the
backend at an SMTP server. When configured, the instance sends:

- **Registration notifications** — when someone submits a membership
  registration (via the form or ORCID sign-up), everyone who can approve it
  is emailed: the office plus the Administrative Institutional Contacts of
  the person's institution. Suspected duplicate registrations notify the
  office too.
- **Publication workflow** — the office (`CONTACT_EMAIL`) is notified when
  someone requests collaboration review, reviewers are notified when the
  office assigns them, and a paper's editors are notified of status changes.

Configuration in `.env` (then re-run `./scripts/start.sh`):

```
SMTP_HOST=smtp.example.edu     # leave empty to disable email entirely
SMTP_PORT=587
SMTP_USERNAME=usmccdb-mailer   # if the server requires auth
SMTP_PASSWORD=...
SMTP_TLS=starttls              # starttls (587) | ssl (465) | none (trusted relay)
EMAIL_FROM=noreply@example.edu # falls back to CONTACT_EMAIL when empty
```

**Where to get SMTP:** nobody needs to run a mail server for this. The two
realistic options are (a) the **authenticated SMTP relay of the university or
lab hosting the instance** — most institutions provide one for services, with
the best deliverability at zero cost — or (b) a **hosted transactional-email
provider** (AWS SES, Mailgun, …), a few dollars a month at this volume. Either
way, ask whoever owns the `EMAIL_FROM` domain to have **SPF/DKIM** cover the
sending server, or the mail lands in spam.

**Testing it:** submit a test registration (or request collaboration review on
a test paper) and watch `./scripts/logs.sh backend` — every send (or send
failure) is logged. With `SMTP_HOST` empty, email is a logged no-op and every
workflow still functions; nothing else in the app depends on it.

### Initializing a new instance from the existing spreadsheets

A fresh database contains nothing but the bootstrap admin account. To go
from there to a fully populated instance:

1. **Seed the working groups** (idempotent):

   ```bash
   docker compose exec backend python -m app.cli seed-wgs
   ```

2. **Import the membership spreadsheet.** Drop the exports in `data/`
   (gitignored — never commit member data), preview with `--dry-run`, then
   run for real:

   ```bash
   docker compose exec backend python -m app.cli import-members-xlsx /data/USMCC_Membership.xlsx --dry-run
   docker compose exec backend python -m app.cli import-members-xlsx /data/USMCC_Membership.xlsx
   ```

   The importer understands the USMCC registration form export (names,
   affiliations, ORCID, position, voting status, expertise) and opens an
   authorship period for each voting member (`--no-authors-from-voting` to
   disable). Institutions are created from the free-text "Primary
   Affiliation" answers as minimal rows **held inactive for office review** —
   they have a name but no short name, ROR id, author-list address, or
   coordinates yet. The next two steps fill those in.

3. **Seed institution coordinates and ROR ids from [ROR](https://ror.org)**
   — without this the map view starts empty:

   ```bash
   docker compose exec backend python -m app.cli seed-coordinates --dry-run
   docker compose exec backend python -m app.cli seed-coordinates
   ```

   Institutions with a ROR id get the coordinates of their ROR record; the
   rest (including everything just created by the member import) are matched
   by their author-list address or name via ROR's affiliation matcher, which
   also fills in the missing ROR id when the match is unambiguous. Anything
   unresolved is listed at the end for the next step. Already-set
   coordinates are never touched, so re-running it later (e.g. after more
   registrations) is safe.

4. **Review the imported institutions** on the Institutions page: fix names,
   add short names and author-list addresses (needed for author-list
   generation), set the US flag (import-created rows default to US, and the
   flag gates voting eligibility), merge any duplicates the free-text
   affiliations produced, and activate each row. The edit form has a
   per-institution "Fetch from ROR" button for anything step 3 couldn't
   resolve.

5. **Import the talks spreadsheet:**

   ```bash
   docker compose exec backend python -m app.cli import-talks-xlsx /data/Conferences_and_Speakers.xlsx
   ```

   Also accepts `--dry-run`. It creates conferences, matches speakers by
   name, and keeps unmatched names in the talk notes.

6. **Import member photos** — see [Member photos](#member-photos) below.

7. **Enable ORCID sign-in** (see above) — members whose ORCID iD came in
   with the spreadsheet are linked to their record automatically on first
   sign-in.

There are also `import-members` (plain CSV), `create-admin`, and `seed-demo`
(fictional demo data) commands — see `python -m app.cli --help`.

### Member photos

Photos live in a dedicated `photos` volume, are served (to signed-in members
only) at `/api/v1/people/{id}/photo`, appear as avatars in the directory and
profiles, and are included in the nightly backups. Members and the office can
also upload/replace a photo by clicking the avatar on a profile page. To import
the photos linked in the registration spreadsheet:

```bash
docker compose exec backend python -m app.cli import-photos-xlsx /data/USMCC_Membership.xlsx
```

Google-Form uploads are usually **restricted to the form owner**, so many
links will fail with a "not shared publicly" message. For those, select the
form's upload folder in your Google Drive, download it as a zip, unpack it
into `data/photos/`, and run:

```bash
docker compose exec backend python -m app.cli import-photos-dir /data/photos
```

It matches people by the name embedded in the file names (form uploads are
named like `IMG_1234 - Jane Doe.jpg`) and lists anything it couldn't match.
Both commands skip people who already have a photo unless you pass
`--overwrite`.

### Institution map

The Institutions page has a **List/Map toggle**; the map shows every
institution with coordinates as a circle sized by its current member count.
Nothing needs configuring — but institutions only appear once they have
coordinates. The office fills them in each institution's edit form, either by
hand or with the **"Fetch from ROR"** button (uses the institution's
[ROR](https://ror.org) id; the lookup happens in the admin's browser, so the
server needs no internet access). The basemap tiles come from CARTO's free
OSM-based tile service — the one external runtime dependency of the app; only
tile requests leave the site, never member data.

### The admin panel

Everything else is configured while the instance runs, in **Admin** (visible
to admin accounts):

- **User accounts** — create local username/password accounts, set roles
  (`admin` / `office` / `member`), link logins to directory records, merge a
  member's local + ORCID accounts, **reset a locked-out local account's
  password** (shows a one-time temporary password), search, and delete logins.
- **Site settings** — an **announcement banner** (info/warning/critical, shown
  on the login page and above every page) and a **login-page message**; both
  apply immediately, no restart.
- **System** — database size, record counts, whether the database schema
  matches the code's migrations, and an audit of recent sign-ins (successes
  and failures, with IP).
- **Backups** — see below.

## Day-to-day operation

| Command | What it does |
|---|---|
| `./scripts/start.sh` | Start/update the whole stack (creates `.env` on first run) |
| `./scripts/stop.sh` | Stop everything (data is kept) |
| `./scripts/backup.sh` | Take a database dump right now |
| `./scripts/list-backups.sh` | List all dumps (daily/weekly/monthly rotation) |
| `./scripts/restore.sh daily/usmccdb-2026-07-19.dump` | Restore a dump and its photo snapshot (stops the backend during restore) |
| `./scripts/reset.sh` | **Wipe the database** and start fresh (offers a final backup first) |
| `./scripts/logs.sh [service]` | Tail logs |

Backups run automatically every night at `BACKUP_HOUR` (UTC) into a host
directory (`BACKUP_DIR` in `.env`, default `./backups` next to
`docker-compose.yml`), rotated as 14 daily / 8 weekly / 12 monthly dumps;
member photos are snapshotted alongside as `photos-<date>.tar.gz`. Restoring
a dump also restores the photo snapshot from the same day when one exists
(weekly and monthly dumps have no snapshot of their own — pass a daily
`photos-*.tar.gz` as a second argument to `restore.sh` to restore photos
with them). Because the dumps live directly on the host disk, off-site
copies are a plain `rsync`/`cp` of that directory.

> **Upgrading from a version that kept backups in a docker volume:** copy the
> old dumps into the new directory once before restarting the stack:
> `docker run --rm -v usmccdb_backups:/from -v "$PWD/backups":/to alpine cp -a /from/. /to/`
> (adjust the `usmccdb_` prefix to your compose project name).

Admins also get a **Backups** tab in the web admin panel showing every
snapshot (with size and age), a "Run backup now" button, and per-snapshot
downloads for manual offsite copies. Restores work from there too: pick a
snapshot (or upload a `.dump`), type RESTORE to confirm, and the backup
container takes a fresh *pre-restore* safety dump before overwriting
anything — so a mistaken restore can itself be undone. `scripts/restore.sh`
still works from a host shell.

All ports/hosts are configurable in `.env` (`HTTP_PORT`, `BIND_HOST`,
`HTTPS_PORT`, `HTTP_REDIRECT_PORT`, database credentials, token lifetime,
backup retention — see `.env.example` for the full annotated list).

### Upgrading

```bash
git pull && ./scripts/start.sh
```

That rebuilds the images and restarts the stack; the backend applies any new
database migrations automatically on startup (`alembic upgrade head` runs
before the server). Admin → System shows whether the running database schema
matches the code, in case something was missed. Nightly backups mean the
night before any upgrade is already snapshotted — take an extra
`./scripts/backup.sh` (or "Run backup now") first if you want a fresh one.

## Prebuilt images

CI publishes images to GitHub Container Registry for every branch, tagged with
the branch name (`main` is also `latest`):
`ghcr.io/trholmes/usmccdb-backend`, `…-frontend`, `…-backup`. To run without
building locally:

```bash
IMAGE_TAG=main docker compose -f docker-compose.yml -f docker-compose.release.yml up -d --no-build --pull always
```

## Architecture

```
                    ┌──────────────┐
   https://…:443 ──▶│ caddy        │   automatic TLS (Let's Encrypt)
                    └──────┬───────┘
                           ▼ :80
                    ┌──────────────┐     ┌──────────────┐
                    │ frontend     │ ──▶ │ backend      │  FastAPI + SQLAlchemy
                    │ nginx + React│ /api│ (uvicorn)    │  + Alembic migrations
                    └──────────────┘     └──────┬───────┘
                                                ▼ :5432
                    ┌──────────────┐     ┌──────────────┐
                    │ backup       │ ──▶ │ db           │  PostgreSQL 16
                    │ nightly dump │     │              │  (pgdata volume)
                    └──────────────┘     └──────────────┘
```

- REST API under `/api/v1` with interactive docs at `/api/v1/docs`.
- JWT session in an httpOnly cookie; `Secure` flag follows
  `X-Forwarded-Proto` (`COOKIE_SECURE=auto`).
- Author lists are stored as frozen JSON snapshots, so a list generated for a
  paper never changes when membership data is edited later.
- Design notes and the original implementation plan live in
  [`docs/PLAN.md`](docs/PLAN.md). Why not literally CERN's Fence? The framework
  and its applications are CERN-internal (Kerberos-gated repos, CERN SSO,
  Oracle/Glance, e-groups); this project reimplements the useful ideas —
  config-light search interfaces, workflows, author-list generation — on an
  open self-hostable stack.

## Development

```bash
# Backend unit tests (no DB needed for the pure ones)
cd backend && pip install -r requirements.txt && pytest tests/test_exports.py

# Full API tests need PostgreSQL, e.g. against the compose db:
docker compose exec db psql -U usmccdb -c "CREATE DATABASE usmccdb_test"
docker compose exec backend sh -c 'TEST_DATABASE_URL=$(echo $DATABASE_URL | sed "s|/usmccdb$|/usmccdb_test|") pytest -v'

# Frontend dev server with hot reload (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```

CI (GitHub Actions) runs the backend test suite against PostgreSQL 16 and the
frontend typecheck/build on every push, then builds and pushes the three
images to GHCR.

## License / contact

Built by and for the US Muon Collider Collaboration. Questions → the USMCC
web/database team (see `CONTACT_EMAIL` on your instance's login page).
