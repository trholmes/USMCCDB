from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import User, UserRole
from app.routers import auth, author_lists, institutions, people, publications, talks, working_groups
from app.security import hash_password


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


@app.get("/api/v1/health")
def health() -> dict:
    return {"status": "ok"}
