"""Management CLI.

    python -m app.cli create-admin --username chair
    python -m app.cli import-members members.csv [--dry-run]
    python -m app.cli seed-wgs

CSV columns (header required):
    given_name, family_name, email, orcid, institution_short_name,
    career_stage, start_date (YYYY-MM-DD), is_author (true/false)
"""

import csv
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


if __name__ == "__main__":
    cli()
