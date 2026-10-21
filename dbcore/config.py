"""Environment-driven configuration. No secrets in code."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _url(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip().rstrip("/")


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    # database / cache
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://exp:exp@localhost:5432/exp",
    )
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # identity: sessions are issued by accounts.3m4.net (see CONTRACT.md "Auth").
    # ACCOUNTS_URL is the public origin (JWT issuer, where the browser is sent to
    # log in); ACCOUNTS_INTERNAL_URL is where THIS service fetches the JWKS
    # (the `edge` docker network: http://accounts-api-1:5000). Defaults to the
    # public one.
    accounts_url: str = _url("ACCOUNTS_URL", "http://localhost:8085")
    accounts_internal_url: str = _url("ACCOUNTS_INTERNAL_URL", "") or _url("ACCOUNTS_URL", "http://localhost:8085")

    # urls
    app_base_url: str = os.getenv("APP_BASE_URL", "http://localhost:8081")
    dashboard_url: str = os.getenv("DASHBOARD_URL", "http://localhost:8081")

    # billing
    billing_enabled: bool = _bool("BILLING_ENABLED", True)
    revenuecat_webhook_token: str = os.getenv("REVENUECAT_WEBHOOK_AUTH_TOKEN", "")
    revenuecat_api_key: str = os.getenv("REVENUECAT_SECRET_API_KEY", "")

    # posthog
    posthog_api_key: str = os.getenv("POSTHOG_API_KEY", "")
    posthog_host: str = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")
    # Personal API key enables local evaluation of feature flags (no network
    # in the request path). Without it, flags fall back to registry defaults.
    posthog_personal_api_key: str = os.getenv("POSTHOG_PERSONAL_API_KEY", "")
    # One PostHog project is shared with the other 3m4 apps, so exp's own
    # feature switches live there under a prefixed key (``exp-signups`` ...).
    # Registry keys (packages/shared/feature_flags.json) stay unprefixed.
    posthog_flag_prefix: str = os.getenv("POSTHOG_FLAG_PREFIX", "exp-")

    # rate limiting
    rate_limit_default: str = os.getenv("RATE_LIMIT_DEFAULT", "120/minute")
    rate_limit_public_api: str = os.getenv("RATE_LIMIT_PUBLIC_API", "60/minute")
    rate_limit_eval: str = os.getenv("RATE_LIMIT_EVAL", "600/minute")


config = Config()
