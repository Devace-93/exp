"""Account blueprint: usage counters and the audit log.

Both endpoints accept a dashboard JWT or an API key with the matching scope.
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from dbcore.config import config
from dbcore.db import session_scope
from dbcore.models import Account, AuditEvent
from dbcore.plans import effective_plan_limits
from dbcore.usage import get_or_create_counter

from ..auth_utils import require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import serialize_audit_event, serialize_usage
from .auth import account_counts

bp = Blueprint("account", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)


@bp.get("/usage")
@_public_limit
@require_auth_or_api_key
@require_scope("usage:read")
def usage():
    with session_scope() as session:
        account = session.get(Account, g.account_id)
        if account is None:
            raise ApiError(404, "not_found", "Account not found.")
        limits = effective_plan_limits(account.plan, str(account.id))
        counter = get_or_create_counter(session, account.id)
        body = serialize_usage(counter, limits, account_counts(session, account.id))
    return jsonify(body)


@bp.get("/audit")
@_public_limit
@require_auth_or_api_key
@require_scope("audit:read")
def audit_log():
    """Most recent audit events for the account (newest first)."""
    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        limit = 50
    limit = min(max(limit, 1), 200)
    action = (request.args.get("action") or "").strip()

    with session_scope() as session:
        stmt = select(AuditEvent).where(AuditEvent.account_id == g.account_id)
        if action:
            stmt = stmt.where(AuditEvent.action == action)
        rows = session.scalars(stmt.order_by(AuditEvent.ts.desc()).limit(limit)).all()
        items = [serialize_audit_event(r) for r in rows]
    return jsonify({"items": items, "limit": limit})
