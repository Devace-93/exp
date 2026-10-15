"""Flask extensions instantiated once and wired up in the app factory.

Right now that's just the rate limiter (Flask-Limiter backed by Redis). Keeping
it here lets blueprints import the shared ``limiter`` object without importing
the application module (which would be circular).
"""
from __future__ import annotations

from flask import request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from dbcore.config import config


def _bearer(prefix: str) -> str | None:
    """The bearer token when it carries ``prefix`` (``exp_live_`` / ``exp_env_``)."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        token = header[len("Bearer ") :].strip()
        if token.startswith(prefix):
            return token
    return None


def public_api_key_func() -> str:
    """Rate-limit key for management routes.

    When the caller authenticates with an API key we bucket the limit by that
    key; otherwise we fall back to the client IP. This way one account hammering
    the public API does not eat into another account's budget.
    """
    return request.headers.get("X-API-Key") or _bearer("exp_live_") or get_remote_address()


def eval_key_func() -> str:
    """Rate-limit key for evaluation routes: the environment client key
    (header or bearer), falling back to the client IP."""
    return request.headers.get("X-Environment-Key") or _bearer("exp_env_") or get_remote_address()


# Default limit applies to every route. Management routes additionally apply
# `config.rate_limit_public_api` and evaluation routes `config.rate_limit_eval`
# via explicit `@limiter.limit(...)` decorators.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[config.rate_limit_default],
    storage_uri=config.redis_url,
    strategy="fixed-window",
)
