"""Flag evaluation semantics — the one place that decides whether a flag is on.

Pure functions, no database: the evaluation API, the dashboard preview and the
unit tests all call :func:`evaluate_flag` with plain values. The rules are
exactly CONTRACT.md "Evaluation" for one flag in one environment:

1. State ``enabled == false`` -> off.
2. ``rollout_percent < 100``: bucket = first 8 hex chars of
   ``sha256("<flag_key>:<distinct_id>")`` as an integer, modulo 100. In when
   ``bucket < rollout_percent``. Without ``distinct_id`` the request is OUT
   unless ``rollout_percent == 100``.
3. On  -> ``boolean``: ``value = true``; other kinds: ``state.value ?? default_value``.
4. Off -> ``boolean``: ``value = false``; other kinds: ``value = null``.

The bucket is deterministic per (flag, user) so a user stays in or out of a
rollout across requests, and independent per flag so 50% of one flag is not
the same half as 50% of another.
"""
from __future__ import annotations

import hashlib
from typing import Any

KINDS = ("boolean", "string", "number", "json")

DEFAULT_STATE = {"enabled": False, "value": None, "rollout_percent": 100}


def default_state() -> dict:
    """The state every environment gets when a flag (or environment) is created."""
    return dict(DEFAULT_STATE)


def value_matches_kind(kind: str, value: Any) -> bool:
    """Type check for ``default_value`` and state ``value`` (``None`` is never
    accepted here; callers decide whether null is allowed)."""
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "string":
        return isinstance(value, str)
    if kind == "number":
        # bool is a subclass of int in Python; a number flag must not accept it.
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == "json":
        return value is not None
    return False


def bucket(flag_key: str, distinct_id: str) -> int:
    """0-99 bucket for a (flag, user) pair; stable across requests and SDKs."""
    digest = hashlib.sha256(f"{flag_key}:{distinct_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def evaluate_flag(
    flag_key: str,
    kind: str,
    default_value: Any,
    *,
    enabled: bool,
    value: Any,
    rollout_percent: int,
    distinct_id: str | None,
) -> dict:
    """``{"kind", "enabled", "value"}`` for one flag in one environment."""
    on = bool(enabled)
    if on and rollout_percent < 100:
        if not distinct_id:
            on = False
        else:
            on = bucket(flag_key, distinct_id) < rollout_percent
    if kind == "boolean":
        out: Any = on
    elif on:
        out = value if value is not None else default_value
    else:
        out = None
    return {"kind": kind, "enabled": on, "value": out}
