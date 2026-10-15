"""API keys blueprint: list, create (shown once), revoke, and ``/me``.

Keys look like ``exp_live_<random>``. We store only a sha256 hash plus a short,
non-sensitive ``prefix`` (e.g. ``exp_live_AbCd``) so the dashboard can label
keys without ever holding the secret.

Every key carries a *role* (viewer | editor | admin) chosen at creation time;
the role maps to scopes in ``packages/shared/api_key_roles.json`` and is what
``@require_scope`` checks on every management endpoint. Active keys count
against the plan's ``api_keys`` limit (402 ``limit_reached``).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.models import Account, ApiKey
from dbcore.plans import effective_plan_limits, within_limit
from dbcore.posthog_client import capture
from dbcore.rbac import all_roles, default_role, is_valid_role, scopes_for

from ..auth_utils import (
    API_KEY_PREFIX,
    actor,
    generate_secret_key,
    hash_token,
    require_api_key,
    require_auth,
)
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import json_body, serialize_account, serialize_api_key

bp = Blueprint("apikeys", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)


@bp.get("")
@require_auth
def list_keys():
    with session_scope() as session:
        rows = session.scalars(
            select(ApiKey)
            .where(ApiKey.account_id == g.account_id, ApiKey.revoked_at.is_(None))
            .order_by(ApiKey.created_at.desc())
        ).all()
        body = [serialize_api_key(k) for k in rows]
    return jsonify(body)


@bp.get("/roles")
def roles():
    """Public: the role catalogue, so clients can render a picker."""
    return jsonify({"default_role": default_role(), "roles": all_roles()})


@bp.post("")
@require_auth
def create_key():
    data = json_body()
    name = (data.get("name") or "").strip() or "API key"
    role = (data.get("role") or default_role()).strip().lower()
    if not is_valid_role(role):
        raise ApiError(
            400,
            "invalid_role",
            f"role must be one of: {', '.join(sorted(all_roles()))}.",
            extra={"roles": sorted(all_roles())},
        )

    full_key, prefix = generate_secret_key(API_KEY_PREFIX)

    with session_scope() as session:
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        active = session.scalar(
            select(func.count(ApiKey.id)).where(
                ApiKey.account_id == account.id, ApiKey.revoked_at.is_(None)
            )
        ) or 0
        if not within_limit(active, limits["api_keys"]):
            capture(
                str(account.id),
                "limit_reached",
                {"which": "api_keys", "plan": account.plan},
                groups={"account": str(account.id)},
            )
            raise ApiError(
                402,
                "limit_reached",
                "Active API key limit reached for your plan.",
                extra={"which": "api_keys"},
            )

        api_key = ApiKey(
            account_id=g.account_id,
            name=name,
            prefix=prefix,
            role=role,
            key_hash=hash_token(full_key),
        )
        session.add(api_key)
        session.flush()
        key_id = str(api_key.id)
        audit.record(
            session,
            account_id=g.account_id,
            action="apikey.create",
            target_type="api_key",
            target_id=key_id,
            meta={"name": name, "prefix": prefix, "role": role},
            **actor(),
        )

    # Return the full key exactly once — it is never recoverable afterwards.
    return (
        jsonify({"id": key_id, "key": full_key, "prefix": prefix, "name": name, "role": role}),
        201,
    )


@bp.delete("/<key_id>")
@require_auth
def delete_key(key_id):
    try:
        kid = uuid.UUID(key_id)
    except ValueError:
        raise ApiError(404, "not_found", "API key not found.")
    with session_scope() as session:
        api_key = session.scalar(
            select(ApiKey).where(ApiKey.id == kid, ApiKey.account_id == g.account_id)
        )
        if api_key is None:
            raise ApiError(404, "not_found", "API key not found.")
        if api_key.revoked_at is None:
            api_key.revoked_at = datetime.now(timezone.utc)
            audit.record(
                session,
                account_id=g.account_id,
                action="apikey.revoke",
                target_type="api_key",
                target_id=str(api_key.id),
                meta={"prefix": api_key.prefix, "role": api_key.role},
                **actor(),
            )
    return "", 204


@bp.get("/me")
@_public_limit
@require_api_key
def me():
    """Identity + permissions of the calling API key.

    Agents (e.g. the exp MCP server) call this once at startup to learn which
    scopes they hold and only expose the matching tools.
    """
    with session_scope() as session:
        account = session.get(Account, g.account_id)
        if account is None:
            raise ApiError(404, "not_found", "Account not found.")
        body = {
            "account": serialize_account(account),
            "key": {"id": str(g.api_key_id), "prefix": g.api_key_prefix, "role": g.role},
            "scopes": sorted(scopes_for(g.role)),
        }
    return jsonify(body)
