"""Authentication helpers: accounts sessions, API keys, environment keys, and
route decorators.

Three ways to authenticate against this API:

1. **Dashboard / first-party** — the session issued by accounts.3m4.net: an
   EdDSA JWT in the ``3m4_session`` cookie (``Domain=.3m4.net``) or, for
   non-browser clients, the same JWT as ``Authorization: Bearer``. It is
   verified locally against the accounts JWKS (``dbcore.m4session``); this
   service never sees a password. The first time a ``sub`` shows up a local
   ``User`` + ``Account`` + owner ``Membership`` are created (just-in-time
   provisioning) and the profile columns are kept in sync with the claims.
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
from datetime import datetime, timezone
from functools import wraps

from flask import g, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from dbcore import audit
from dbcore.config import config
from dbcore.db import SessionLocal, session_scope
from dbcore.feature_flags import is_enabled
from dbcore.m4session import COOKIE_NAME, SessionError, verify
from dbcore.models import Account, ApiKey, Environment, Membership, Project, User
from dbcore.posthog_client import capture, group_identify
from dbcore.rbac import all_scopes, scopes_for

from .errors import ApiError

API_KEY_PREFIX = "exp_live_"
ENV_KEY_PREFIX = "exp_env_"
JWKS_URL = f"{config.accounts_internal_url}/.well-known/jwks.json"


# --------------------------------------------------------------------------- #
# Tokens and keys
# --------------------------------------------------------------------------- #
def hash_token(token: str) -> str:
    """sha256 hex digest — used for API keys and client keys at rest."""
    return hashlib.sha256(token.encode()).hexdigest()


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


def session_token() -> str | None:
    """The accounts session JWT: a bearer that is neither an API key nor
    an environment key, else the ``3m4_session`` cookie."""
    # An explicit bearer header wins over the ambient cookie, so a client that
    # holds a cookie for one identity can still act as another on purpose.
    bearer = _bearer_token()
    if bearer and not bearer.startswith((API_KEY_PREFIX, ENV_KEY_PREFIX)):
        return bearer
    return request.cookies.get(COOKIE_NAME) or None


def verify_session(token: str) -> dict:
    """Verify an accounts JWT; raises :class:`ApiError` 401 with the contract codes."""
    try:
        return verify(token, jwks_url=JWKS_URL, issuer=config.accounts_url, audience="3m4")
    except SessionError as err:
        raise ApiError(401, err.code, str(err)) from err


# --------------------------------------------------------------------------- #
# Just-in-time provisioning
# --------------------------------------------------------------------------- #
def _verified_at(claims: dict, current: datetime | None) -> datetime | None:
    if not claims.get("email_verified"):
        return None
    return current or datetime.now(timezone.utc)


def _sync_profile(user: User, claims: dict) -> None:
    """Copy the profile claims onto the mirror row (a no-op UPDATE when equal)."""
    user.email = (claims.get("email") or user.email).lower()
    user.handle = claims.get("handle") or user.handle
    user.name = claims.get("name")
    user.avatar_url = claims.get("avatar_url")
    user.email_verified_at = _verified_at(claims, user.email_verified_at)


def _create_tenant(session, identity_id: uuid.UUID, claims: dict) -> tuple[User, Account]:
    user = User(
        identity_id=identity_id,
        email=(claims.get("email") or "").lower(),
        handle=claims.get("handle") or str(identity_id)[:8],
        name=claims.get("name"),
        avatar_url=claims.get("avatar_url"),
        email_verified_at=_verified_at(claims, None),
    )
    account = Account(name=f"{user.handle}'s workspace", plan="free")
    session.add_all([user, account])
    session.flush()
    session.add(Membership(account_id=account.id, user_id=user.id, role="owner"))
    return user, account


def provision(claims: dict) -> tuple[uuid.UUID, uuid.UUID]:
    """Return ``(user_id, account_id)`` for the identity in ``claims``,
    creating the tenant on first sight and refreshing the mirror otherwise.

    New identities are gated by the ``signups`` switch (403 ``signups_disabled``):
    registration itself happens at accounts, so this is where "invite-only"
    is enforced for this app.
    """
    identity_id = uuid.UUID(claims["sub"])
    created = False
    with session_scope() as session:
        user = session.scalar(select(User).where(User.identity_id == identity_id))
        if user is None:
            if not is_enabled("signups", claims["sub"]):
                raise ApiError(403, "signups_disabled", "New accounts are not being accepted right now.")
            try:
                with session.begin_nested():
                    user, _account = _create_tenant(session, identity_id, claims)
                created = True
            except IntegrityError:
                # Two first requests raced on the unique index: use the winner.
                user = session.scalar(select(User).where(User.identity_id == identity_id))
                if user is None:
                    raise
        if not created:
            _sync_profile(user, claims)
        membership = session.scalar(
            select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
        )
        if membership is None:
            raise ApiError(403, "no_account", "User is not attached to an account.")
        user_id, account_id = user.id, membership.account_id
        account_name = session.get(Account, account_id).name
    if created:
        capture(
            str(account_id),
            "signup",
            {"plan": "free", "method": "accounts", "identity_id": claims["sub"]},
            groups={"account": str(account_id)},
        )
        group_identify("account", str(account_id), {"plan": "free", "name": account_name})
    return user_id, account_id


# --------------------------------------------------------------------------- #
# Decorators
# --------------------------------------------------------------------------- #
def _set_session_context(claims: dict, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
    g.identity = claims
    g.user_id = user_id
    g.account_id = account_id
    g.auth_method = "session"
    g.api_key_id = None
    g.api_key_prefix = None
    # Dashboard sessions belong to the account owner: full access.
    g.role = "owner"
    g.scopes = all_scopes()


def require_auth(view=None, *, verified: bool = True):
    """Require an accounts session. Sets ``g.user_id``, ``g.account_id`` and
    ``g.identity`` (the claims).

    Usable bare (``@require_auth``) or as ``@require_auth(verified=False)`` for
    the few routes an unverified user may still call (``/auth/me``, so the
    dashboard can explain the state). Errors: 401 ``no_session`` /
    ``session_expired`` / ``invalid_session``, 403 ``email_unverified``.
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = session_token()
            if not token:
                raise ApiError(401, "no_session", "Not signed in.")
            claims = verify_session(token)
            user_id, account_id = provision(claims)
            if verified and not claims.get("email_verified"):
                raise ApiError(403, "email_unverified", "Verify your e-mail address to continue.")
            _set_session_context(claims, user_id, account_id)
            return fn(*args, **kwargs)

        return wrapper

    return decorator(view) if view is not None else decorator


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
        # sessions on the same endpoints are not affected.
        if not is_enabled("public-api", str(info["account_id"])):
            raise ApiError(403, "feature_disabled", "'public-api' is not available.")
        g.identity = None
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
    """Accept EITHER an accounts session OR a management API key.

    Used by every management endpoint, which is reachable from both the
    dashboard and the public API / MCP server.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        if _presented_api_key():
            return require_api_key(view)(*args, **kwargs)
        if session_token():
            return require_auth(view)(*args, **kwargs)
        raise ApiError(401, "no_session", "Sign in, or provide an API key.")

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
            g.identity = None
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
    identity = getattr(g, "identity", None) or {}
    return {
        "actor_type": "user",
        "actor_id": getattr(g, "user_id", None),
        "actor_label": identity.get("handle"),
    }


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
