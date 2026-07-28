from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import User, UserRole
from app.routers import (
    auth,
    author_lists,
    backups,
    institutions,
    people,
    publications,
    talks,
    working_groups,
)
from app.security import hash_password


def refuse_placeholder_secrets() -> None:
    """Refuse to serve with publicly-known secrets.

    The compose `:?` guards only require non-empty values, so a
    `cp .env.example .env && docker compose up` deploy could otherwise run
    with the documented placeholder JWT signing key (anyone could mint an
    admin token) and a guessable bootstrap admin password.
    """
    settings = get_settings()
    key = settings.secret_key.strip()
    if not key or key == "dev-only-change-me" or key.startswith("change-me"):
        raise RuntimeError(
            "SECRET_KEY is unset or a known placeholder — anyone could forge "
            "login tokens. Set a real value in .env (openssl rand -hex 32) or "
            "let scripts/start.sh generate one."
        )
    if settings.bootstrap_admin_password.strip().startswith("change-me"):
        raise RuntimeError(
            "BOOTSTRAP_ADMIN_PASSWORD is the known placeholder 'change-me'. "
            "Set a real password in .env (or leave it empty to skip creating "
            "the bootstrap admin)."
        )


def bootstrap_admin() -> None:
    """Create the bootstrap local admin — only when no users exist at all."""
    settings = get_settings()
    if not settings.bootstrap_admin_password:
        return
    with SessionLocal() as db:
        if db.execute(select(User.id).limit(1)).first() is not None:
            return
        db.add(
            User(
                username=settings.bootstrap_admin_username,
                password_hash=hash_password(settings.bootstrap_admin_password),
                role=UserRole.admin,
            )
        )
        db.commit()
        print(f"[bootstrap] created admin account '{settings.bootstrap_admin_username}'")


@asynccontextmanager
async def lifespan(app: FastAPI):
    refuse_placeholder_secrets()
    bootstrap_admin()
    yield


app = FastAPI(
    title="USMCC Collaboration Database",
    description="Membership, speakers, and publications database of the "
    "US Muon Collider Collaboration (muoncollider.us). Inspired by CERN's "
    "Glance/Fence systems.",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)

prefix = "/api/v1"
app.include_router(auth.router, prefix=prefix)
app.include_router(people.router, prefix=prefix)
app.include_router(people.stats_router, prefix=prefix)
app.include_router(institutions.router, prefix=prefix)
app.include_router(working_groups.router, prefix=prefix)
app.include_router(talks.router, prefix=prefix)
app.include_router(publications.router, prefix=prefix)
app.include_router(author_lists.router, prefix=prefix)
app.include_router(backups.router, prefix=prefix)


@app.get("/api/v1/health")
def health() -> dict:
    return {"status": "ok"}
