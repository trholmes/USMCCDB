"""Per-IP rate limiting for the unauthenticated endpoints (issue #62).

A plain in-process sliding window is enough here: the stack runs a single
uvicorn worker, and Caddy's stock image ships no rate-limit module. Uvicorn
runs with --proxy-headers, so request.client.host is the real client address
behind the reverse proxy.
"""

import threading
import time
from functools import lru_cache
from math import ceil

from fastapi import HTTPException, Request

from app.config import get_settings

_MAX_TRACKED_KEYS = 10_000  # prune stale entries past this many client IPs


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int | None:
        """Record an attempt; None if allowed, else whole seconds to wait."""
        if self.limit <= 0:
            return None
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if t > cutoff]
            if len(hits) >= self.limit:
                self._hits[key] = hits
                return max(1, ceil(hits[0] - cutoff))
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > _MAX_TRACKED_KEYS:
                self._hits = {
                    k: v for k, v in self._hits.items() if v and v[-1] > cutoff
                }
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


@lru_cache
def login_limiter() -> SlidingWindowLimiter:
    s = get_settings()
    return SlidingWindowLimiter(s.login_rate_limit, s.login_rate_window_seconds)


@lru_cache
def registration_limiter() -> SlidingWindowLimiter:
    s = get_settings()
    return SlidingWindowLimiter(
        s.registration_rate_limit, s.registration_rate_window_seconds
    )


def enforce(limiter: SlidingWindowLimiter, request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    wait = limiter.retry_after(key)
    if wait is not None:
        raise HTTPException(
            429,
            "Too many requests — try again later.",
            headers={"Retry-After": str(wait)},
        )
