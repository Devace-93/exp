"""Role-based access control for API keys.

Source of truth: ``packages/shared/api_key_roles.json``. A *role* is a named
bundle of *scopes*; endpoints declare the scope they need with
``@require_scope("flags:write")`` and never reason about roles directly. That
keeps the policy data-driven: adding a role is a JSON edit, not a code change.

Dashboard users (JWT) are account owners and get every scope. API keys get the
scopes of the role chosen when the key was created.
"""
from __future__ import annotations

from ._shared import load_shared


def _data() -> dict:
    return load_shared("api_key_roles.json")


def all_roles() -> dict:
    """``{role: {label, description, scopes}}``."""
    return _data()["roles"]


def default_role() -> str:
    return _data()["default_role"]


def is_valid_role(role: str | None) -> bool:
    return bool(role) and role in all_roles()


def scopes_for(role: str | None) -> frozenset[str]:
    """Scopes granted by ``role``; unknown roles grant nothing (fail closed)."""
    roles = all_roles()
    if role not in roles:
        return frozenset()
    return frozenset(roles[role]["scopes"])


def all_scopes() -> frozenset[str]:
    return frozenset(_data()["scopes"].keys())
