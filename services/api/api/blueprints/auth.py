"""Auth blueprint: ``GET /auth/me``.

Identity lives in accounts.3m4.net (register / login / magic link / OAuth /
logout / profile all happen there). This app only recognises the session it
issues (see ``api.auth_utils``) and exposes what the dashboard needs about the
*tenant*: the mirrored user, the account, plan, limits, usage, counts and
exp's own feature switches.
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from dbcore.db import session_scope
from dbcore.feature_flags import resolve_all
from dbcore.models import Account, ApiKey, Project, User
from dbcore.plans import effective_plan_limits
from dbcore.usage import get_or_create_counter

from ..auth_utils import require_auth
from ..errors import ApiError
from ..serializers import serialize_account, serialize_usage, serialize_user

bp = Blueprint("auth", __name__)


def account_counts(session, account_id) -> dict:
    """``{projects, api_keys}`` for the usage object and ``/auth/me``."""
    projects = session.scalar(select(func.count(Project.id)).where(Project.account_id == account_id)) or 0
    api_keys = session.scalar(
        select(func.count(ApiKey.id)).where(ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None))
    ) or 0
    return {"projects": projects, "api_keys": api_keys}


@bp.get("/me")
@require_auth(verified=False)
def me():
    """Reachable while the e-mail is still unverified, so the dashboard can
    render its own "verify your e-mail" state instead of a bare 403."""
    with session_scope() as session:
        user = session.get(User, g.user_id)
        account = session.get(Account, g.account_id)
        if user is None or account is None:
            raise ApiError(404, "not_found", "User or account not found.")
        limits = effective_plan_limits(account.plan, str(account.id))
        counter = get_or_create_counter(session, account.id)
        counts = account_counts(session, account.id)
        body = {
            "user": serialize_user(user),
            "account": serialize_account(account),
            "plan": account.plan,
            "limits": limits,
            "usage": serialize_usage(counter, limits, counts),
            "counts": {"projects": counts["projects"]},
            "features": resolve_all(str(account.id)),
        }
    return jsonify(body)
