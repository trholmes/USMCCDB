"""ORCID OAuth (public API, scope /authenticate).

The token endpoint's response already contains the authenticated ORCID iD
and the account name, so sign-in needs no further API calls.
"""

from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from app.config import get_settings


def authorize_url(redirect_uri: str, state: str) -> str:
    s = get_settings()
    params = {
        "client_id": s.orcid_client_id,
        "response_type": "code",
        "scope": "/authenticate",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"https://{s.orcid_host}/oauth/authorize?{urlencode(params)}"


async def exchange_code(code: str, redirect_uri: str) -> dict:
    """Exchange the authorization code; returns the ORCID token payload,
    e.g. {"orcid": "0000-...", "name": "...", "access_token": ...}."""
    s = get_settings()
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"https://{s.orcid_host}/oauth/token",
            data={
                "client_id": s.orcid_client_id,
                "client_secret": s.orcid_client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"ORCID token exchange failed ({resp.status_code})")
    data = resp.json()
    if "orcid" not in data:
        raise HTTPException(502, "ORCID token response missing iD")
    return data
