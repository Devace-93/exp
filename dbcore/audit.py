"""Append-only audit trail for account-level actions.

Every mutating API call (and every authorization denial) writes one row to
``audit_events``: who (user or API key), what (``flag.create`` ...), on which
target, and the outcome. Rows are never updated or deleted by application code.

Two entry points:

* :func:`record` — inside an existing transaction (the view's ``session_scope``),
  so the audit row commits atomically with the change it describes.
* :func:`record_standalone` — its own short transaction, for denials raised
  before any view transaction exists.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .db import session_scope
from .models import AuditEvent


def _jsonable(value: Any) -> Any:
    """Coerce UUIDs (and nested containers) into JSON-safe values."""
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    return value


def record(
    session: Session,
    *,
    account_id,
    action: str,
    actor_type: str,
    actor_id=None,
    actor_label: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    outcome: str = "ok",
    meta: dict | None = None,
) -> AuditEvent:
    event = AuditEvent(
        account_id=account_id,
        action=action,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_label=actor_label,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        outcome=outcome,
        meta=_jsonable(meta or {}),
    )
    session.add(event)
    return event


def record_standalone(**kwargs) -> None:
    """Same as :func:`record` but in its own transaction. Never raises: an audit
    failure must not turn a 403 into a 500."""
    try:
        with session_scope() as session:
            record(session, **kwargs)
    except Exception:  # pragma: no cover - best effort
        pass
