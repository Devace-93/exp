"""Authentication helpers: password hashing, JWTs, and route decorators.

Three ways to authenticate against this API:

1. **Dashboard / first-party** — a short-lived JWT access token in the
   ``Authorization: Bearer <token>`` header, refreshed via an opaque refresh
   token stored *hashed* in the ``refresh_tokens`` table.
2. **Management API** — a long-lived API key (``exp_live_…``) in the
   ``X-API-Key`` header (or as a bearer token), looked up by its sha256 hash
   in ``api_keys``.
3. **Evaluation API** — an environment client key (``exp_env_…``) in the
   ``X-Environment-Key`` header (or as a bearer token). It identifies exactly
   one (project, environment), has no role and cannot call anything else.

The ``@require_auth`` / ``@require_api_key`` / ``@require_environment_key``
decorators put the resolved ids on ``flask.g`` so views can stay terse.

Authorization (RBAC) is a second, separate step: every management request
carries ``g.scopes`` (dashboard users: all scopes; API keys: the scopes of the
key's role, see ``dbcore.rbac``) and views declare what they need with
``@require_scope("flags:write")``. Denials are written to the audit log.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from flask import g, request
from sqlalchemy import select

from dbcore import audit
from dbcore.config import config
from dbcore.db import SessionLocal
from dbcore.models import ApiKey, Environment, Project
from dbcore.rbac import all_scopes, scopes_for

from .errors import ApiError

API_KEY_PREFIX = "exp_live_"
ENV_KEY_PREFIX = "exp_env_"

# argon2-cffi password hasher with library defaults (a good modern baseline).
_ph = PasswordHasher()


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        # Malformed hash, etc. Treat as a failed login rather than a 500.
        return False


# --------------------------------------------------------------------------- #
# Tokens and keys
# --------------------------------------------------------------------------- #
def create_access_token(user_id, account_id) -> str:
    """Mint a signed HS256 JWT access token (TTL from config)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "account_id": str(account_id),
        "iat": now,
        "exp": now + timedelta(minutes=config.access_token_ttl_min),
    }
    return jwt.encode(payload, config.jwt_secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """Decode/verify a JWT. Raises ``jwt.PyJWTError`` on bad/expired tokens."""
    return jwt.decode(token, config.jwt_secret_key, algorithms=["HS256"])


def generate_refresh_token() -> str:
    """Opaque, high-entropy refresh token. Only the hash is persisted."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """sha256 hex digest — used for refresh tokens, API keys and client keys at rest."""
    return hashlib.sha256(token.encode()).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=config.refresh_token_ttl_days)


def generate_secret_key(prefix: str) -> tuple[str, str]:
    """``(full_key, display_prefix)`` for ``exp_live_`` / ``exp_env_`` keys.

    ``<prefix>`` + 32 url-safe random chars. The display prefix keeps the brand
    tag plus the first 4 random chars so it is recognisable but not guessable.
    The prefix is deliberately NOT ``sk_live_``: that is Stripe's secret-key
    convention and secret scanners flag it as a leaked Stripe key.
    """
    random_part = secrets.token_urlsafe(24)[:32]
    return f"{prefix}{random_part}", f"{prefix}{random_part[:4]}"


def _bearer_token() -> str:
    header = request.headers.get("Authorization", "")
    return header[len("Bearer ") :].strip() if header.startswith("Bearer ") else ""


# --------------------------------------------------------------------------- #
# Decorators
# --------------------------------------------------------------------------- #
def require_auth(view):
    """Require a valid JWT. Sets ``g.user_id`` and ``g.account_id``."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        token = _bearer_token()
        if not token:
            raise ApiError(401, "unauthorized", "Missing bearer token.")
        try:
            payload = decode_access_token(token)
        except jwt.ExpiredSignatureError:
            raise ApiError(401, "token_expired", "Access token has expired.")
        except jwt.PyJWTError:
            raise ApiError(401, "unauthorized", "Invalid access token.")
        g.user_id = uuid.UUID(payload["sub"])
        g.account_id = uuid.UUID(payload["account_id"])
        g.auth_method = "jwt"
        g.api_key_id = None
        g.api_key_prefix = None
        # Dashboard sessions belong to the account owner: full access.
        g.role = "owner"
        g.scopes = all_scopes()
        return view(*args, **kwargs)

    return wrapper


def _presented_api_key() -> str:
    """The raw API key from ``X-API-Key`` or ``Authorization: Bearer exp_live_…``."""
    raw = request.headers.get("X-API-Key", "").strip()
    if raw:
        return raw
    token = _bearer_token()
    return token if token.startswith(API_KEY_PREFIX) else ""


def _resolve_api_key() -> dict | None:
    """Look up the presented API key; returns its identity or None.

    Also stamps ``last_used_at`` so the dashboard can show key activity. Runs in
    its own short session so it is independent of the view's transaction.
    """
    raw = _presented_api_key()
    if not raw:
        return None
    key_hash = hash_token(raw)
    with SessionLocal() as session:
        api_key = session.scalar(
            select(ApiKey).where(
                ApiKey.key_hash == key_hash,
                ApiKey.revoked_at.is_(None),
            )
        )
        if api_key is None:
            return None
        api_key.last_used_at = datetime.now(timezone.utc)
        info = {
            "account_id": api_key.account_id,
            "key_id": api_key.id,
            "prefix": api_key.prefix,
            "role": api_key.role,
        }
        session.commit()
    return info


def require_api_key(view):
    """Require a valid API key. Sets ``g.account_id`` (``g.user_id`` is None)
    plus the key's identity and the scopes granted by its role."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        info = _resolve_api_key()
        if info is None:
            raise ApiError(401, "unauthorized", "Missing or invalid API key.")
        # Management API access is feature-switched as a whole (checked after
        # key resolution so PostHog can target specific accounts). Dashboard
        # JWT access to the same endpoints is not affected.
        from dbcore.feature_flags import is_enabled

        if not is_enabled("public-api", str(info["account_id"])):
            raise ApiError(403, "feature_disabled", "'public-api' is not available.")
        g.user_id = None
        g.account_id = info["account_id"]
        g.auth_method = "api_key"
        g.api_key_id = info["key_id"]
        g.api_key_prefix = info["prefix"]
        g.role = info["role"]
        g.scopes = scopes_for(info["role"])
        return view(*args, **kwargs)

    return wrapper


def require_auth_or_api_key(view):
    """Accept EITHER a dashboard JWT OR a management API key.

    Used by every management endpoint, which is reachable from both the
    dashboard and the public API / MCP server.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        if request.headers.get("X-API-Key"):
            return require_api_key(view)(*args, **kwargs)
        token = _bearer_token()
        if token.startswith(API_KEY_PREFIX):
            return require_api_key(view)(*args, **kwargs)
        if token:
            return require_auth(view)(*args, **kwargs)
        raise ApiError(401, "unauthorized", "Provide a bearer token or an API key.")

    return wrapper


def _presented_environment_key() -> str:
    raw = request.headers.get("X-Environment-Key", "").strip()
    if raw:
        return raw
    token = _bearer_token()
    return token if token.startswith(ENV_KEY_PREFIX) else ""


def require_environment_key(view):
    """Require a valid environment client key (evaluation API).

    Sets ``g.project_id``, ``g.environment_id``, ``g.account_id`` plus the
    keys needed for the Evaluation envelope. No scopes: a client key cannot
    call the management API at all.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        raw = _presented_environment_key()
        if not raw:
            raise ApiError(401, "unauthorized", "Missing or invalid environment key.")
        key_hash = hash_token(raw)
        with SessionLocal() as session:
            row = session.execute(
                select(Environment, Project)
                .join(Project, Project.id == Environment.project_id)
                .where(Environment.client_key_hash == key_hash)
            ).first()
            if row is None:
                raise ApiError(401, "unauthorized", "Missing or invalid environment key.")
            environment, project = row
            g.user_id = None
            g.account_id = project.account_id
            g.project_id = project.id
            g.project_key = project.key
            g.environment_id = environment.id
            g.environment_key = environment.key
        g.auth_method = "environment_key"
        g.api_key_id = None
        g.api_key_prefix = environment.client_key_prefix
        g.role = None
        g.scopes = frozenset()
        return view(*args, **kwargs)

    return wrapper


# --------------------------------------------------------------------------- #
# Authorization (RBAC)
# --------------------------------------------------------------------------- #
def actor() -> dict:
    """Who is acting, in the shape ``dbcore.audit.record`` expects."""
    if getattr(g, "auth_method", None) == "api_key":
        return {
            "actor_type": "api_key",
            "actor_id": g.api_key_id,
            "actor_label": g.api_key_prefix,
        }
    return {"actor_type": "user", "actor_id": getattr(g, "user_id", None), "actor_label": None}


def require_scope(scope: str):
    """Reject the request unless the credential carries ``scope``.

    Place *below* the auth decorator so ``g.scopes`` is populated. Denials are
    audited (``auth.denied``) and return 403 ``insufficient_scope`` with the
    missing scope, so an agent can explain *why* it cannot proceed.
    """

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            scopes = getattr(g, "scopes", frozenset())
            if scope not in scopes:
                audit.record_standalone(
                    account_id=g.account_id,
                    action="auth.denied",
                    outcome="denied",
                    meta={
                        "required_scope": scope,
                        "role": getattr(g, "role", None),
                        "method": request.method,
                        "path": request.path,
                    },
                    **actor(),
                )
                raise ApiError(
                    403,
                    "insufficient_scope",
                    f"This credential (role '{getattr(g, 'role', None)}') lacks the '{scope}' scope.",
                    extra={"required_scope": scope, "role": getattr(g, "role", None)},
                )
            return view(*args, **kwargs)

        return wrapper

    return decorator
