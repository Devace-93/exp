"""Pure functions that turn ORM rows into JSON-safe dicts (and one helper for
the opposite direction, ``json_body``).

Centralising serialization keeps the wire format (the CONTRACT.md shapes)
consistent across every blueprint.
"""
from __future__ import annotations

from datetime import datetime, timezone

from flask import request

from dbcore.evaluate import default_state

from .errors import ApiError


def iso(dt: datetime | None) -> str | None:
    """UTC ISO-8601 with a trailing ``Z`` (or None). Naive datetimes are
    assumed to already be UTC (Postgres timestamptz comes back tz-aware)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def json_body() -> dict:
    """The request's JSON object, or ``{}`` for an empty body. A body that is
    valid JSON but not an object is a 400 rather than a 500 downstream."""
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_body", "Request body must be a JSON object.")
    return data


def serialize_user(user) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "email_verified": user.email_verified_at is not None,
        "created_at": iso(user.created_at),
    }


def serialize_account(account) -> dict:
    return {
        "id": str(account.id),
        "name": account.name,
        "plan": account.plan,
        "created_at": iso(account.created_at),
    }


def serialize_environment(env, client_key: str | None = None) -> dict:
    """Exactly the CONTRACT.md "Environment" shape. ``client_key`` (the
    plaintext) is only present on create / rotate."""
    body = {
        "id": str(env.id),
        "key": env.key,
        "name": env.name,
        "client_key_prefix": env.client_key_prefix,
        "position": env.position,
        "created_at": iso(env.created_at),
    }
    if client_key is not None:
        body["client_key"] = client_key
    return body


def serialize_project(project, environments: list, flag_count: int, client_keys: dict | None = None) -> dict:
    """Exactly the CONTRACT.md "Project" shape. ``client_keys`` maps
    environment id -> plaintext key, only on create."""
    client_keys = client_keys or {}
    return {
        "id": str(project.id),
        "key": project.key,
        "name": project.name,
        "description": project.description,
        "flag_count": flag_count,
        "environments": [
            serialize_environment(env, client_keys.get(env.id))
            for env in sorted(environments, key=lambda e: (e.position, e.key))
        ],
        "created_at": iso(project.created_at),
        "updated_at": iso(project.updated_at),
    }


def serialize_state(state) -> dict:
    return {
        "enabled": state.enabled,
        "value": state.value,
        "rollout_percent": state.rollout_percent,
        "updated_at": iso(state.updated_at),
    }


def serialize_flag(flag, environments: list, states: dict) -> dict:
    """Exactly the CONTRACT.md "Flag" shape.

    ``states`` maps environment id -> FlagState. Every environment of the
    project appears under its key; a missing row (should not happen, every
    environment/flag creation seeds one) falls back to the default state.
    """
    out_states = {}
    for env in sorted(environments, key=lambda e: (e.position, e.key)):
        state = states.get(env.id)
        if state is None:
            out_states[env.key] = {**default_state(), "updated_at": None}
        else:
            out_states[env.key] = serialize_state(state)
    return {
        "id": str(flag.id),
        "project_id": str(flag.project_id),
        "key": flag.key,
        "name": flag.name,
        "description": flag.description,
        "kind": flag.kind,
        "default_value": flag.default_value,
        "tags": list(flag.tags or []),
        "archived": flag.archived,
        "states": out_states,
        "created_at": iso(flag.created_at),
        "updated_at": iso(flag.updated_at),
    }


def serialize_api_key(api_key) -> dict:
    """Never includes the secret — only the non-sensitive prefix."""
    return {
        "id": str(api_key.id),
        "name": api_key.name,
        "prefix": api_key.prefix,
        "role": api_key.role,
        "last_used_at": iso(api_key.last_used_at),
        "created_at": iso(api_key.created_at),
    }


def serialize_usage(counter, limits: dict, counts: dict) -> dict:
    return {
        "period_start": counter.period_start.isoformat(),
        "period_end": counter.period_end.isoformat(),
        "evaluations": counter.evaluations,
        "counts": counts,
        "limits": limits,
    }


def serialize_audit_event(event) -> dict:
    return {
        "id": str(event.id),
        "ts": iso(event.ts),
        "actor_type": event.actor_type,
        "actor_id": str(event.actor_id) if event.actor_id else None,
        "actor_label": event.actor_label,
        "action": event.action,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "outcome": event.outcome,
        "meta": event.meta or {},
    }
