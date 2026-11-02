"""Billing blueprint (only registered when ``BILLING_ENABLED`` is true).

exp never talks to Stripe: the hosted portal payments.3m4.net owns checkout,
the Customer Portal, receipts and donations (see CONTRACT.md "Billing").

- ``GET  /billing/status``  — the account's plan + subscription mirror and the
  portal's product keys, for the dashboard billing page (session auth).
- ``POST /billing/webhook`` — signed push events from payments
  (``m4pay.verify_webhook``), deduped on the event ``id`` via
  ``webhook_events`` and applied with ``dbcore.billing_sync``.

The webhook is NEVER feature-gated and never answers 4xx for a verified event
(payments retries on non-2xx): an identity that never signed in to exp is
acknowledged with ``{"status": "unknown_identity"}`` and picked up by the
nightly reconcile once it does.
"""
from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from dbcore.billing_sync import account_for_identity, apply_entitlements, serialize_subscription
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.m4pay import WebhookError, verify_webhook
from dbcore.models import Account, Subscription, WebhookEvent
from dbcore.plans import all_plans, price_keys
from dbcore.posthog_client import capture

from ..auth_utils import require_auth
from ..errors import ApiError
from ..extensions import limiter
from ..features import require_feature

bp = Blueprint("billing", __name__)

_PLAN_RANK = {"free": 0, "pro": 1, "team": 2, "enterprise": 3}


@bp.get("/status")
@require_auth
@require_feature("billing", status=404)
def status():
    """What the billing page needs: the effective plan, the mirrored
    subscription (``null`` when there is none) and where to buy."""
    with session_scope() as session:
        account = session.get(Account, g.account_id)
        if account is None:
            raise ApiError(404, "not_found", "Account not found.")
        sub = session.scalar(select(Subscription).where(Subscription.account_id == account.id))
        body = {
            "plan": account.plan,
            "label": all_plans().get(account.plan, {}).get("label", account.plan),
            "subscription": serialize_subscription(sub),
            "payments_url": config.payments_url,
            "app": config.payments_app,
            "price_keys": price_keys(),
        }
    return jsonify(body)


def _record_event(session, event: dict) -> bool:
    """Insert the dedupe row; False when the event id was already processed."""
    if session.scalar(select(WebhookEvent.id).where(WebhookEvent.event_id == event["id"])) is not None:
        return False
    try:
        with session.begin_nested():
            session.add(
                WebhookEvent(
                    provider="payments",
                    event_id=str(event["id"]),
                    type=event.get("type"),
                    payload=event,
                    processed_at=datetime.now(timezone.utc),
                )
            )
    except IntegrityError:
        return False  # two deliveries raced on the unique index
    return True


@bp.post("/webhook")
@limiter.exempt
def webhook():
    try:
        event = verify_webhook(config.payments_webhook_secret, request.get_data(), request.headers)
    except WebhookError as err:
        raise ApiError(400, "invalid_signature", str(err)) from err

    if event.get("app") and event["app"] != config.payments_app:
        return jsonify({"status": "ignored", "reason": "other_app"}), 200
    data = event.get("data") if isinstance(event.get("data"), dict) else {}

    with session_scope() as session:
        if not _record_event(session, event):
            return jsonify({"status": "duplicate"}), 200
        account = account_for_identity(session, event.get("identity_id"))
        if account is None:
            # Recorded for audit; the identity has not signed in to exp yet.
            return jsonify({"status": "unknown_identity"}), 200
        account_id = str(account.id)
        result = apply_entitlements(session, account, data)

    # Analytics outside the txn.
    previous_plan, new_plan = result["previous_plan"], result["plan"]
    event_type = event.get("type") or ""
    if event_type.startswith("payment."):
        capture(account_id, event_type.replace(".", "_"), {"plan": new_plan})
    if new_plan != previous_plan:
        if _PLAN_RANK.get(new_plan, 0) > _PLAN_RANK.get(previous_plan, 0):
            capture(account_id, "subscription_activated" if previous_plan == "free" else "upgrade",
                    {"from": previous_plan, "to": new_plan})
        else:
            capture(account_id, "downgrade", {"from": previous_plan, "to": new_plan})
            if new_plan == "free":
                capture(account_id, "churn", {"plan": previous_plan, "status": result["status"]})

    return jsonify({"status": "ok", "plan": new_plan}), 200
