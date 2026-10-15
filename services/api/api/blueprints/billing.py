"""Billing blueprint (only registered when ``BILLING_ENABLED`` is true).

- ``GET  /billing/offerings`` — plans shaped for the RevenueCat-style paywall.
- ``POST /billing/webhook``   — RevenueCat server-to-server events.

The webhook is **idempotent**: every event is deduped on its ``event_id`` via
the ``webhook_events`` table, so RevenueCat retries are safe.
"""
from __future__ import annotations

import hmac
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from sqlalchemy import select

from dbcore.config import config
from dbcore.db import session_scope
from dbcore.models import Account, Subscription, WebhookEvent
from dbcore.plans import all_plans, resolve_plan_from_entitlements
from dbcore.posthog_client import capture

from ..errors import ApiError
from ..features import require_feature

bp = Blueprint("billing", __name__)

# Event types that change a subscription's state.
_RELEVANT = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "CANCELLATION",
    "UNCANCELLATION",
    "EXPIRATION",
    "BILLING_ISSUE",
}
# Types after which the subscription will not auto-renew.
_NON_RENEWING = {"CANCELLATION", "EXPIRATION", "BILLING_ISSUE"}


@bp.get("/offerings")
@require_feature("billing", status=404)
def offerings():
    """Expose purchasable plans for the paywall (free/self-host excluded)."""
    packages = []
    for plan_id, plan in all_plans().items():
        if plan_id in ("free", "selfhost", "enterprise"):
            continue
        packages.append(
            {
                "identifier": plan_id,
                "label": plan.get("label", plan_id),
                "entitlement": plan_id,  # entitlement id matches the plan id
                "price_monthly": plan.get("price_monthly"),
                "price_annual": plan.get("price_annual"),
                "limits": {
                    "projects": plan.get("projects"),
                    "environments_per_project": plan.get("environments_per_project"),
                    "flags_per_project": plan.get("flags_per_project"),
                    "evaluations_per_month": plan.get("evaluations_per_month"),
                    "api_keys": plan.get("api_keys"),
                    "audit_retention_days": plan.get("audit_retention_days"),
                    "max_users": plan.get("max_users"),
                },
            }
        )
    return jsonify({"offerings": packages})


def _parse_ts(ms) -> datetime | None:
    """RevenueCat sends epoch milliseconds; convert to aware UTC datetime."""
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
    except (ValueError, TypeError, OSError):
        return None


@bp.post("/webhook")
def webhook():
    # ---- Verify the shared secret -----------------------------------------
    auth = request.headers.get("Authorization", "")
    expected = config.revenuecat_webhook_token
    # Accept either the raw token or a "Bearer <token>" form.
    presented = auth[len("Bearer ") :] if auth.startswith("Bearer ") else auth
    if not expected or not hmac.compare_digest(presented, expected):
        raise ApiError(401, "unauthorized", "Invalid webhook authorization.")

    payload = request.get_json(silent=True) or {}
    event = payload.get("event") or {}
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id:
        raise ApiError(400, "invalid_event", "Missing event id.")

    with session_scope() as session:
        # ---- Idempotency: dedupe on event_id ------------------------------
        existing = session.scalar(
            select(WebhookEvent).where(WebhookEvent.event_id == event_id)
        )
        if existing is not None:
            return jsonify({"status": "duplicate"}), 200

        session.add(
            WebhookEvent(
                provider="revenuecat",
                event_id=event_id,
                type=event_type,
                payload=payload,
                processed_at=datetime.now(timezone.utc),
            )
        )

        if event_type not in _RELEVANT:
            # Acknowledge but take no state action (still recorded for audit).
            return jsonify({"status": "ignored"}), 200

        # app_user_id is our account_id (RC config: app_user_id = account_id).
        app_user_id = event.get("app_user_id")
        account = session.get(Account, app_user_id) if app_user_id else None
        if account is None:
            # Unknown account — recorded for audit, nothing else to do.
            return jsonify({"status": "no_account"}), 200

        entitlements = event.get("entitlement_ids") or []
        if not entitlements and event.get("entitlement_id"):
            entitlements = [event["entitlement_id"]]
        new_plan = resolve_plan_from_entitlements(entitlements)
        previous_plan = account.plan

        # ---- Upsert the subscription row ----------------------------------
        sub = session.scalar(
            select(Subscription).where(Subscription.account_id == account.id)
        )
        if sub is None:
            sub = Subscription(account_id=account.id)
            session.add(sub)

        sub.rc_app_user_id = app_user_id
        sub.entitlement = entitlements[0] if entitlements else None
        sub.product_id = event.get("product_id")
        sub.period = event.get("period_type")
        sub.status = event_type
        sub.current_period_start = _parse_ts(event.get("purchased_at_ms"))
        sub.current_period_end = _parse_ts(event.get("expiration_at_ms"))
        sub.will_renew = event_type not in _NON_RENEWING
        sub.raw_payload = payload

        # ---- Reflect the entitlement on the account -----------------------
        account.plan = new_plan

    # Analytics outside the txn.
    if event_type == "INITIAL_PURCHASE":
        capture(str(app_user_id), "subscription_activated", {"plan": new_plan})
    elif new_plan != previous_plan:
        rank = {"free": 0, "pro": 1, "team": 2, "enterprise": 3}
        direction = "upgrade" if rank.get(new_plan, 0) > rank.get(previous_plan, 0) else "downgrade"
        capture(str(app_user_id), direction, {"from": previous_plan, "to": new_plan})
    if event_type in ("EXPIRATION", "CANCELLATION"):
        capture(str(app_user_id), "churn", {"plan": previous_plan, "type": event_type})

    return jsonify({"status": "ok", "plan": new_plan}), 200
