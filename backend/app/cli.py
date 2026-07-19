"""Management CLI.

    python -m app.cli create-admin --username chair
    python -m app.cli import-members members.csv [--dry-run]
    python -m app.cli seed-wgs

CSV columns (header required):
    given_name, family_name, email, orcid, institution_short_name,
    career_stage, start_date (YYYY-MM-DD), is_author (true/false)
"""

import csv
import re
from datetime import date
from pathlib import Path

import typer
from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Affiliation,
    AuthorPeriod,
    CareerStage,
    Institution,
    MemberStatus,
    Person,
    User,
    UserRole,
    WorkingGroup,
)
from app.security import hash_password

cli = typer.Typer(help="USMCC database management commands")

DEFAULT_WGS = [
    ("Accelerator", "accelerator"),
    ("Detector", "detector"),
    ("Physics", "physics"),
    ("Community Engagement", "community"),
]


@cli.command()
def create_admin(
    username: str = typer.Option(..., prompt=True),
    password: str = typer.Option(..., prompt=True, hide_input=True, confirmation_prompt=True),
):
    """Create (or reset the password of) a local admin account."""
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if user is None:
            user = User(username=username, role=UserRole.admin)
            db.add(user)
            typer.echo(f"Creating admin '{username}'")
        else:
            user.role = UserRole.admin
            typer.echo(f"Updating existing user '{username}' (now admin, password reset)")
        user.password_hash = hash_password(password)
        user.is_active = True
        db.commit()
    typer.echo("Done.")


@cli.command()
def seed_wgs():
    """Insert the initial USMCC working groups (idempotent)."""
    with SessionLocal() as db:
        for name, slug in DEFAULT_WGS:
            if db.execute(
                select(WorkingGroup).where(WorkingGroup.slug == slug)
            ).scalar_one_or_none():
                continue
            db.add(WorkingGroup(name=name, slug=slug))
            typer.echo(f"Added working group: {name}")
        db.commit()
    typer.echo("Done.")


@cli.command()
def import_members(
    csv_path: Path = typer.Argument(..., exists=True, readable=True),
    dry_run: bool = typer.Option(False, help="Parse and report, write nothing"),
):
    """Import an initial member list from CSV (upsert on email)."""
    created = updated = skipped = 0
    with SessionLocal() as db, open(csv_path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for i, row in enumerate(reader, start=2):  # header is line 1
            email = (row.get("email") or "").strip().lower()
            given = (row.get("given_name") or "").strip()
            family = (row.get("family_name") or "").strip()
            if not (email and given and family):
                typer.echo(f"line {i}: SKIP (missing given_name/family_name/email)")
                skipped += 1
                continue

            orcid = (row.get("orcid") or "").strip() or None
            stage_raw = (row.get("career_stage") or "other").strip().lower()
            try:
                stage = CareerStage(stage_raw)
            except ValueError:
                typer.echo(f"line {i}: unknown career_stage '{stage_raw}', using 'other'")
                stage = CareerStage.other
            try:
                start = date.fromisoformat((row.get("start_date") or "").strip())
            except ValueError:
                start = date.today()
            is_author = (row.get("is_author") or "").strip().lower() in ("true", "yes", "1")

            person = db.execute(select(Person).where(Person.email == email)).scalar_one_or_none()
            if person is None:
                person = Person(
                    given_name=given,
                    family_name=family,
                    email=email,
                    orcid=orcid,
                    career_stage=stage,
                    status=MemberStatus.active,
                )
                db.add(person)
                db.flush()
                created += 1
            else:
                person.given_name, person.family_name = given, family
                person.orcid = orcid or person.orcid
                person.career_stage = stage
                updated += 1

            short = (row.get("institution_short_name") or "").strip()
            if short:
                inst = db.execute(
                    select(Institution).where(Institution.short_name == short)
                ).scalar_one_or_none()
                if inst is None:
                    inst = Institution(name=short, short_name=short)
                    db.add(inst)
                    db.flush()
                    typer.echo(f"line {i}: created institution '{short}' (fill in details later)")
                has_affil = db.execute(
                    select(Affiliation).where(
                        Affiliation.person_id == person.id,
                        Affiliation.institution_id == inst.id,
                        Affiliation.end_date.is_(None),
                    )
                ).scalar_one_or_none()
                if has_affil is None:
                    db.add(
                        Affiliation(
                            person_id=person.id,
                            institution_id=inst.id,
                            is_primary=True,
                            start_date=start,
                        )
                    )

            if is_author:
                has_period = db.execute(
                    select(AuthorPeriod).where(
                        AuthorPeriod.person_id == person.id,
                        AuthorPeriod.end_date.is_(None),
                    )
                ).scalar_one_or_none()
                if has_period is None:
                    db.add(AuthorPeriod(person_id=person.id, start_date=start))

        if dry_run:
            db.rollback()
            typer.echo(f"DRY RUN — would create {created}, update {updated}, skip {skipped}")
        else:
            db.commit()
            typer.echo(f"Imported: {created} created, {updated} updated, {skipped} skipped")


# --- Direct xlsx imports (match the USMCC Google-form exports) -----------------

ORCID_RE = re.compile(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dX])")

POSITION_MAP = {
    "faculty": CareerStage.faculty,
    "postdoc": CareerStage.postdoc,
    "graduate student": CareerStage.grad,
    "undergraduate student": CareerStage.undergrad,
    "engineer": CareerStage.engineer,
    "accelerator engineer": CareerStage.engineer,
}


def _career_stage(position: str) -> CareerStage:
    p = (position or "").strip().lower()
    if p in POSITION_MAP:
        return POSITION_MAP[p]
    if "student" in p:
        return CareerStage.grad
    if "engineer" in p:
        return CareerStage.engineer
    if "scientist" in p or "researcher" in p or "physicist" in p or "staff" in p:
        return CareerStage.staff
    return CareerStage.other


def _clean_orcid(raw) -> str | None:
    if not raw:
        return None
    m = ORCID_RE.search(str(raw))
    return m.group(1) if m else None


def _get_or_create_institution(db, name: str) -> Institution:
    name = name.strip()
    inst = db.execute(select(Institution).where(Institution.name == name)).scalar_one_or_none()
    if inst is None:
        inst = db.execute(
            select(Institution).where(Institution.short_name == name)
        ).scalar_one_or_none()
    if inst is None:
        inst = Institution(name=name)
        db.add(inst)
        db.flush()
    return inst


@cli.command()
def import_members_xlsx(
    xlsx_path: Path = typer.Argument(..., exists=True, readable=True),
    sheet: str = typer.Option("Members", help="Worksheet name"),
    authors_from_voting: bool = typer.Option(
        True, help="Open an author period for voting members (from registration date)"
    ),
    dry_run: bool = typer.Option(False, help="Parse and report, write nothing"),
):
    """Import the USMCC membership registration spreadsheet (Google-form
    export: Timestamp, voting question, First/Middle/Last Name, Primary
    Affiliation, additional affiliations, Email, ORCID, Position, ...,
    Area(s) of Expertise)."""
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[sheet]
    header = [str(c or "").strip() for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]

    def col(label_start: str) -> int:
        for i, h in enumerate(header):
            if h.lower().startswith(label_start.lower()):
                return i
        raise typer.BadParameter(f"Column starting with '{label_start}' not found in sheet")

    c_ts = col("Timestamp")
    c_voting = col("According to this definition")
    c_first, c_middle, c_last = col("First Name"), col("Middle Name"), col("Last Name")
    c_primary = col("Primary Affiliation")
    c_addl = col("Any additional affiliations")
    c_email, c_orcid, c_position = col("Email"), col("ORCID"), col("Position")
    c_expertise = col("Area(s) of Expertise")

    created = updated = skipped = 0
    with SessionLocal() as db:
        for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            email = str(row[c_email] or "").strip().lower()
            first = str(row[c_first] or "").strip()
            last = str(row[c_last] or "").strip()
            if not (email and first and last):
                if any(row):
                    typer.echo(f"row {i}: SKIP (missing name/email)")
                    skipped += 1
                continue
            middle = str(row[c_middle] or "").strip()
            given = f"{first} {middle}".strip() if middle else first
            voting = "non-voting" not in str(row[c_voting] or "").lower()
            orcid = _clean_orcid(row[c_orcid])
            stage = _career_stage(str(row[c_position] or ""))
            expertise = str(row[c_expertise] or "").strip() or None
            ts = row[c_ts]
            start = ts.date() if hasattr(ts, "date") else date.today()

            person = db.execute(select(Person).where(Person.email == email)).scalar_one_or_none()
            if person is None and orcid:
                person = db.execute(
                    select(Person).where(Person.orcid == orcid)
                ).scalar_one_or_none()
            if person is None:
                person = Person(
                    given_name=given,
                    family_name=last,
                    preferred_name=first if middle else None,
                    email=email,
                    orcid=orcid,
                    career_stage=stage,
                    status=MemberStatus.active,
                    is_voting=voting,
                    expertise=expertise,
                )
                db.add(person)
                db.flush()
                created += 1
            else:
                person.given_name, person.family_name = given, last
                person.orcid = orcid or person.orcid
                person.career_stage = stage
                person.is_voting = voting
                person.expertise = expertise or person.expertise
                updated += 1

            # Primary + additional affiliations.
            primary_name = str(row[c_primary] or "").strip()
            names = [(primary_name, True)] if primary_name else []
            for extra in str(row[c_addl] or "").split(";"):
                if extra.strip():
                    names.append((extra.strip(), False))
            for name, is_primary in names:
                inst = _get_or_create_institution(db, name)
                open_affil = db.execute(
                    select(Affiliation).where(
                        Affiliation.person_id == person.id,
                        Affiliation.institution_id == inst.id,
                        Affiliation.end_date.is_(None),
                    )
                ).scalar_one_or_none()
                if open_affil is None:
                    db.add(
                        Affiliation(
                            person_id=person.id,
                            institution_id=inst.id,
                            is_primary=is_primary,
                            start_date=start,
                        )
                    )

            if authors_from_voting and voting:
                has_period = db.execute(
                    select(AuthorPeriod).where(
                        AuthorPeriod.person_id == person.id,
                        AuthorPeriod.end_date.is_(None),
                    )
                ).scalar_one_or_none()
                if has_period is None:
                    db.add(AuthorPeriod(person_id=person.id, start_date=start))

        if dry_run:
            db.rollback()
            typer.echo(f"DRY RUN — would create {created}, update {updated}, skip {skipped}")
        else:
            db.commit()
            typer.echo(f"Imported: {created} created, {updated} updated, {skipped} skipped")


@cli.command()
def import_talks_xlsx(
    xlsx_path: Path = typer.Argument(..., exists=True, readable=True),
    sheet: str = typer.Option("Assigned Talks", help="Worksheet name"),
    dry_run: bool = typer.Option(False, help="Parse and report, write nothing"),
):
    """Import the Conferences_and_Speakers spreadsheet (columns: Date,
    Conference, Topic, Name, Plenary/Parallel, Invited/Contributed, URL,
    Notes). Creates events by conference name and matches speakers to
    people by full name."""
    import openpyxl

    from app.models import Event, Talk, TalkStatus, TalkType

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[sheet]

    with SessionLocal() as db:
        people = db.execute(select(Person)).scalars().all()
        by_name: dict[str, Person] = {}
        for p in people:
            by_name[f"{p.given_name} {p.family_name}".lower()] = p
            first = p.given_name.split()[0] if p.given_name else ""
            by_name.setdefault(f"{first} {p.family_name}".lower(), p)
            if p.preferred_name:
                by_name.setdefault(f"{p.preferred_name} {p.family_name}".lower(), p)

        events: dict[str, Event] = {}
        created = unmatched = skipped = 0
        for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            when, conf, topic, name = row[0], row[1], row[2], row[3]
            if not (topic or name):
                continue
            title = str(topic or "(untitled)").strip()
            conf_name = str(conf or "").strip()
            talk_date = when.date() if hasattr(when, "date") else None
            plenary = "plenary" in str(row[4] or "").lower()
            invited = "invited" in str(row[5] or "").lower()
            url = str(row[6] or "").strip()
            notes = str(row[7] or "").strip()

            event = None
            if conf_name:
                if conf_name not in events:
                    existing = db.execute(
                        select(Event).where(Event.name == conf_name)
                    ).scalar_one_or_none()
                    events[conf_name] = existing or Event(name=conf_name)
                    if existing is None:
                        db.add(events[conf_name])
                        db.flush()
                event = events[conf_name]

            speaker = by_name.get(str(name or "").strip().lower())
            extra_notes = []
            if url:
                extra_notes.append(url)
            if notes:
                extra_notes.append(notes)
            if speaker is None and name:
                unmatched += 1
                extra_notes.append(f"speaker (unmatched): {name}")

            # Skip exact duplicates on re-import.
            dupe = db.execute(
                select(Talk).where(
                    Talk.title == title,
                    Talk.event_id == (event.id if event else None),
                    Talk.date == talk_date,
                )
            ).scalar_one_or_none()
            if dupe:
                skipped += 1
                continue

            db.add(
                Talk(
                    title=title,
                    event_id=event.id if event else None,
                    talk_type=TalkType.plenary if plenary else TalkType.parallel,
                    date=talk_date,
                    speaker_person_id=speaker.id if speaker else None,
                    status=TalkStatus.given if talk_date and talk_date <= date.today() else TalkStatus.assigned,
                    is_invited=invited,
                    notes="\n".join(extra_notes) or None,
                )
            )
            created += 1

        if dry_run:
            db.rollback()
            typer.echo(
                f"DRY RUN — would create {created} talks "
                f"({unmatched} unmatched speakers, {skipped} duplicates skipped)"
            )
        else:
            db.commit()
            typer.echo(
                f"Imported {created} talks ({unmatched} speakers unmatched — "
                f"kept in notes; {skipped} duplicates skipped)"
            )


if __name__ == "__main__":
    cli()
