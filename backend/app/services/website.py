"""Poke the public website to rebuild its People page (issue #173).

The muoncollider.us website regenerates its People page from this
database's public export (GET /people/public and /people/public/stats) on
a nightly schedule. When WEBSITE_REPO and WEBSITE_DISPATCH_TOKEN are set,
changes to the data that page shows additionally fire a GitHub
``repository_dispatch`` event ("membership-updated") at the website
repository, whose update workflow then regenerates and deploys the page
within minutes. Without them, ``queue`` is a no-op and the nightly
schedule remains the only trigger.

The token needs permission to create repository_dispatch events on the
website repository (a fine-grained token with Contents read/write on that
one repository). Delivery is best-effort: the poke runs after the response
and a failure is logged, never surfaced to the member — the nightly run
catches anything missed.
"""

import logging

import httpx
from fastapi import BackgroundTasks

from app.config import get_settings

logger = logging.getLogger(__name__)


def queue(background: BackgroundTasks) -> None:
    """Schedule a website-rebuild poke after the current request succeeds.

    Call it from any endpoint that changes what the public People page
    shows: membership status, the exported profile fields, the photo, or
    the primary institution.
    """
    settings = get_settings()
    if settings.website_repo and settings.website_dispatch_token:
        background.add_task(_dispatch)


def _dispatch() -> None:
    settings = get_settings()
    try:
        httpx.post(
            f"https://api.github.com/repos/{settings.website_repo}/dispatches",
            json={"event_type": "membership-updated"},
            headers={
                "Authorization": f"Bearer {settings.website_dispatch_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=10,
        ).raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Website rebuild dispatch to %s failed: %s", settings.website_repo, exc)
