"""HTTP security middleware: response headers and per-client rate limiting."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

HSTS_VALUE = "max-age=63072000; includeSubDomains; preload"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach conservative security headers to every response."""

    def __init__(self, app, *, production: bool = False) -> None:
        super().__init__(app)
        self.production = production

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "cross-origin")
        headers.setdefault("Strict-Transport-Security", HSTS_VALUE)
        if self.production:
            headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return response


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Give immutable demo data a short shared-cache lifetime to cut invocations."""

    CACHEABLE_PREFIXES = (
        "/api/telemetry",
        "/api/metrics",
        "/api/anomalies",
        "/api/threshold-curve",
        "/api/model-info",
        "/api/benchmark",
    )

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method == "GET":
            if request.url.path.startswith("/api/health"):
                response.headers.setdefault("Cache-Control", "no-store")
            elif any(request.url.path.startswith(prefix) for prefix in self.CACHEABLE_PREFIXES):
                response.headers.setdefault(
                    "Cache-Control",
                    "public, s-maxage=300, stale-while-revalidate=600",
                )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window limiter keyed by client IP (proxy aware)."""

    def __init__(
        self,
        app,
        *,
        max_requests: int = 120,
        window_seconds: int = 60,
        max_clients: int = 10_000,
    ) -> None:
        super().__init__(app)
        self.max_requests = max(1, max_requests)
        self.window_seconds = max(1, window_seconds)
        self.max_clients = max(100, max_clients)
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    @staticmethod
    def _client_key(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

    def _prune(self, now: float) -> None:
        if len(self._hits) <= self.max_clients:
            return
        for key in [key for key, hits in self._hits.items() if not hits or now - hits[-1] > self.window_seconds]:
            self._hits.pop(key, None)

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        now = time.monotonic()
        key = self._client_key(request)
        hits = self._hits[key]

        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()

        if len(hits) >= self.max_requests:
            retry_after = max(1, int(self.window_seconds - (now - hits[0])))
            response = JSONResponse(
                {"detail": "Too many requests. Please retry later."},
                status_code=429,
            )
            response.headers["Retry-After"] = str(retry_after)
            return response

        hits.append(now)
        self._prune(now)
        return await call_next(request)
