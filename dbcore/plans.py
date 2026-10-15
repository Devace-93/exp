"""Plan limits + entitlement resolution. Source: packages/shared/plan_limits.json."""
from __future__ import annotations

from ._shared import load_shared

UNLIMITED = -1


def _data() -> dict:
    return load_shared("plan_limits.json")


def all_plans() -> dict:
    return _data()["plans"]


def plan_limits(plan: str) -> dict:
    """Return the limit dict for a plan name, falling back to free."""
    plans = all_plans()
    return plans.get(plan, plans["free"])


def is_unlimited(value: int) -> bool:
    return value == UNLIMITED


def within_limit(used: int, limit: int) -> bool:
    """True if `used` is still under `limit` (UNLIMITED always passes)."""
    if is_unlimited(limit):
        return True
    return used < limit


def resolve_plan_from_entitlements(entitlements: list[str]) -> str:
    """Map active RevenueCat entitlements to our effective plan.

    `team` outranks `pro`. No entitlement => free.
    """
    data = _data()
    mapping: dict[str, str] = data["entitlement_to_plan"]
    for ent in data["entitlement_priority"]:
        if ent in entitlements:
            return mapping[ent]
    return "free"


def effective_plan_limits(plan: str, distinct_id: str = "anonymous") -> dict:
    """Limits that actually apply to an account right now.

    While the ``early-access`` flag is ON every account gets the ``enterprise``
    limits (everything unlimited) regardless of its plan, so
    the product can be used in full before billing is switched on. Callers
    that *enforce* limits must use this, never :func:`plan_limits` directly.
    """
    from .feature_flags import is_enabled  # local import: avoid a cycle at import time

    if is_enabled("early-access", distinct_id):
        return plan_limits("enterprise")
    return plan_limits(plan)
