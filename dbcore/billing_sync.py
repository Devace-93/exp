"""Apply an entitlement snapshot from payments.3m4.net to an exp account.

One code path for both directions of the integration (CONTRACT.md "Billing"):

- **push**: ``POST /api/billing/webhook`` receives a signed event whose
  ``data`` carries the FULL current entitlement set for (identity, app);
- **pull**: ``dbcore.worker.reconcile_billing`` lists the app's subscriptions
  with ``M4PayClient.subscriptions(updated_since=…)`` and feeds each row here.

Both resolve the exp ``Account`` from the accounts identity (``sub`` of the
JWT → ``User.identity_id`` → the user's owner ``Membership``) and call
:func:`apply_entitlements`, which upserts the ``Subscription`` mirror row and
sets ``Account.plan`` through :func:`dbcore.plans.resolve_plan_from_entitlements`.
Snapshots are idempotent, so retries and out-of-order deliveries are safe.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from .models import Account, Membership, Subscription, User
from .plans import resolve_plan_from_entitlements

# Stripe statuses under which payments grants the entitlement.
ENTITLED_STATUSES = ("active", "trialing", "past_due")
_PERIODS = {"month": "monthly", "year": "annual", "monthly": "monthly", "annual": "annual", "yearly": "annual"}


def parse_iso(value) -> datetime | None:
    """``2026-11-01T10:00:00Z`` → aware UTC datetime (None on anything else)."""
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def account_for_identity(session, identity_id) -> Account | None:
    """The account owned by the accounts identity ``identity_id`` (JWT ``sub``),
    or None when that identity never signed in to exp."""
    try:
        uid = uuid.UUID(str(identity_id))
    except (ValueError, TypeError, AttributeError):
        return None
    account_id = session.scalar(
        select(Membership.account_id)
        .join(User, User.id == Membership.user_id)
        .where(User.identity_id == uid, Membership.role == "owner")
        .order_by(Membership.created_at)
        .limit(1)
    )
    return session.get(Account, account_id) if account_id else None


def _period(sub: dict) -> str | None:
    """``monthly`` | ``annual``. payments does not relay the Stripe interval
    (only the product ``label``), so the annual product is recognised by its
    label (``Pro (annual)`` in the catalog) and anything else with an
    entitlement counts as monthly; an explicit ``interval`` wins when present."""
    interval = sub.get("interval") or sub.get("period")
    if isinstance(interval, str) and interval.lower() in _PERIODS:
        return _PERIODS[interval.lower()]
    label = sub.get("label") or sub.get("key") or ""
    if isinstance(label, str) and ("annual" in label.lower() or "year" in label.lower()):
        return "annual"
    return "monthly" if sub.get("entitlement") else None


def apply_entitlements(session, account: Account, data: dict) -> dict:
    """Upsert the account's ``Subscription`` from a payments snapshot and set
    ``account.plan``. ``data`` is the ``data`` object of a push event
    (``{"entitlements": [...], "subscription": {...}|null, ...}``) or one
    item of ``GET /api/v1/subscriptions`` (same keys, ``subscription`` fields
    at the top level).

    Returns ``{"previous_plan", "plan", "entitlements", "status"}`` so the
    caller can emit analytics outside the transaction.
    """
    entitlements = [e for e in (data.get("entitlements") or []) if isinstance(e, str)]
    sub_data = data.get("subscription")
    if sub_data is None and "status" in data:
        sub_data = data  # a reconcile row: the subscription IS the item
    if not isinstance(sub_data, dict):
        sub_data = None

    previous_plan = account.plan
    new_plan = resolve_plan_from_entitlements(entitlements)

    sub = session.scalar(select(Subscription).where(Subscription.account_id == account.id))
    if sub is None:
        sub = Subscription(account_id=account.id)
        session.add(sub)

    if sub_data is None:
        # Nothing at payments any more (never subscribed, or the row is gone).
        sub.status = "none"
        sub.entitlement = None
        sub.will_renew = False
        sub.current_period_end = None
    else:
        sub.stripe_subscription_id = str(sub_data.get("id") or sub.stripe_subscription_id or "") or None
        sub.entitlement = sub_data.get("entitlement") or (entitlements[0] if entitlements else None)
        sub.product_id = sub_data.get("price") or sub_data.get("product") or sub_data.get("label") or sub.product_id
        sub.period = _period(sub_data) or sub.period
        sub.status = sub_data.get("status") or "unknown"
        sub.current_period_start = parse_iso(sub_data.get("current_period_start")) or sub.current_period_start
        sub.current_period_end = parse_iso(sub_data.get("current_period_end"))
        sub.will_renew = sub.status in ENTITLED_STATUSES and not bool(sub_data.get("cancel_at_period_end"))
    sub.raw_payload = data

    account.plan = new_plan
    return {
        "previous_plan": previous_plan,
        "plan": new_plan,
        "entitlements": entitlements,
        "status": sub.status,
    }


def serialize_subscription(sub: Subscription | None) -> dict | None:
    """The ``subscription`` object of ``GET /api/billing/status``."""
    if sub is None or sub.status in (None, "none"):
        return None

    def iso(dt: datetime | None) -> str | None:
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None

    return {
        "id": sub.stripe_subscription_id,
        "entitlement": sub.entitlement,
        "product": sub.product_id,
        "period": sub.period,
        "status": sub.status,
        "active": sub.status in ENTITLED_STATUSES,
        "current_period_end": iso(sub.current_period_end),
        "will_renew": bool(sub.will_renew),
        "updated_at": iso(sub.updated_at),
    }
