"""Environment-driven configuration.

All values have safe defaults so the service runs locally without any .env file.
Secrets are never stored here: the API has no third-party credentials.
"""

from __future__ import annotations

import os


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_list(value: str | None, default: tuple[str, ...] = ()) -> list[str]:
    if value is None:
        return list(default)
    return [item.strip() for item in value.split(",") if item.strip()]


ENVIRONMENT = (
    os.getenv("ENVIRONMENT")
    or ("production" if os.getenv("VERCEL") else "development")
).strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"

ALLOWED_ORIGINS = _as_list(
    os.getenv("ALLOWED_ORIGINS"),
    ("http://localhost:5173", "http://127.0.0.1:5173"),
)
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", r"https://[a-z0-9-]+\.vercel\.app")
ALLOWED_HOSTS = _as_list(
    os.getenv("ALLOWED_HOSTS"),
    ("localhost", "127.0.0.1", "testserver", "*.vercel.app"),
)

RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "120"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

DOCS_ENABLED = _as_bool(os.getenv("DOCS_ENABLED"), default=not IS_PRODUCTION)
