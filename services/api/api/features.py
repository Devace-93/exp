"""Enforcement of exp's own feature switches in the API.

``@require_feature("key")`` rejects requests when a switch is OFF for the
requester. Backend enforcement is the source of truth — the frontend only
mirrors these switches (delivered via ``/auth/me`` and ``GET /api/features``).

Never gate: login, the RevenueCat webhook. The evaluation API is gated by
``evaluation-api`` as an emergency kill switch (503), never as a feature gate.
"""
from __future__ import annotations

from functools import wraps

from flask import Blueprint, g, jsonify

from dbcore.feature_flags import is_enabled, resolve_all

from .errors import ApiError


def _distinct_id() -> str:
    """PostHog distinct_id for the requester: account id, or "anonymous"."""
    account_id = getattr(g, "account_id", None)
    return str(account_id) if account_id else "anonymous"


def require_feature(key: str, status: int = 403):
    """Reject the request when ``key`` is OFF for the requester.

    Place *after* the auth decorator so ``g.account_id`` is set and the switch
    can target specific accounts / percentage rollouts.
    """

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not is_enabled(key, _distinct_id()):
                raise ApiError(status, "feature_disabled", f"'{key}' is not available.")
            return view(*args, **kwargs)

        return wrapper

    return decorator


bp = Blueprint("features", __name__)


@bp.get("")
def features():
    """Resolved switches for the requester. Public: the marketing pages need
    them before any session exists. A valid accounts session upgrades
    resolution to the account's targeting bucket — but this endpoint never
    *requires* auth, so it tolerates missing, bad or expired sessions.
    """
    distinct = "anonymous"
    try:
        from sqlalchemy import select

        from dbcore.db import SessionLocal
        from dbcore.models import Membership, User

        from .auth_utils import session_token, verify_session

        token = session_token()
        if token:
            claims = verify_session(token)
            with SessionLocal() as session:
                account_id = session.scalar(
                    select(Membership.account_id)
                    .join(User, User.id == Membership.user_id)
                    .where(User.identity_id == claims["sub"])
                    .order_by(Membership.created_at)
                )
            distinct = str(account_id) if account_id else claims["sub"]
    except Exception:
        pass
    return jsonify({"features": resolve_all(distinct)})
