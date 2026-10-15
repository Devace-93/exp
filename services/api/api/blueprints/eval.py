"""Evaluation blueprint (``/eval``): what SDKs call, with an environment
client key.

Each request is metered (+1 ``evaluations`` on the account's monthly counter).
The limit is soft: past it we keep answering — an app in production must never
go dark because of a plan cap — and fire one PostHog ``limit_reached`` event
per period. ``evaluation-api`` OFF is an emergency kill switch (503).

The semantics live in ``dbcore.evaluate``; the assembly of the Evaluation
object is shared with the dashboard preview in ``blueprints.flags``.
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from dbcore.config import config
from dbcore.db import session_scope
from dbcore.models import Account, Environment, Project
from dbcore.plans import effective_plan_limits
from dbcore.posthog_client import capture
from dbcore.usage import meter_evaluation

from ..auth_utils import require_environment_key
from ..errors import ApiError
from ..extensions import eval_key_func, limiter
from ..features import require_feature
from .flags import evaluate_environment

bp = Blueprint("eval", __name__)

_eval_limit = limiter.limit(config.rate_limit_eval, key_func=eval_key_func)


def _meter(session, account: Account) -> None:
    limits = effective_plan_limits(account.plan, str(account.id))
    if meter_evaluation(session, account.id, limits["evaluations_per_month"]):
        capture(
            str(account.id),
            "limit_reached",
            {"which": "evaluations", "plan": account.plan},
            groups={"account": str(account.id)},
        )


def _evaluate() -> dict:
    distinct_id = (request.args.get("distinct_id") or "").strip() or None
    with session_scope() as session:
        project = session.get(Project, g.project_id)
        environment = session.get(Environment, g.environment_id)
        account = session.get(Account, g.account_id)
        if project is None or environment is None or account is None:
            raise ApiError(401, "unauthorized", "Missing or invalid environment key.")
        body = evaluate_environment(session, project, environment, distinct_id)
        _meter(session, account)
    return body


@bp.get("/flags")
@_eval_limit
@require_environment_key
@require_feature("evaluation-api", status=503)
def eval_flags():
    return jsonify(_evaluate())


@bp.get("/flags/<key>")
@_eval_limit
@require_environment_key
@require_feature("evaluation-api", status=503)
def eval_flag(key):
    body = _evaluate()
    flag = body["flags"].get(key)
    if flag is None:
        raise ApiError(404, "not_found", "Flag not found.")
    return jsonify({"key": key, **flag})
