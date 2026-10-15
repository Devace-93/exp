"""Environments blueprint, mounted at ``/projects/<project_id>/environments``.

Every environment owns one client key (``exp_env_…``): the credential SDKs use
against the evaluation API. The key is shown once, on create and on rotate,
and stored hashed. Creating an environment seeds the default state for every
existing flag of the project so "one state per (flag, environment)" always
holds. The last environment of a project cannot be deleted.
"""
from __future__ import annotations

import uuid

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from dbcore import audit
from dbcore.db import session_scope
from dbcore.models import Account, Environment
from dbcore.plans import effective_plan_limits, within_limit
from dbcore.slugs import is_valid_environment_key

from ..auth_utils import ENV_KEY_PREFIX, actor, generate_secret_key, hash_token, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..serializers import json_body, serialize_environment
from .projects import create_environment, get_owned_project, limit_reached, public_limit

bp = Blueprint("environments", __name__)


def get_owned_environment(session, project, env_id_str: str) -> Environment:
    try:
        env_id = uuid.UUID(str(env_id_str))
    except (ValueError, AttributeError):
        raise ApiError(404, "not_found", "Environment not found.")
    env = session.scalar(
        select(Environment).where(Environment.id == env_id, Environment.project_id == project.id)
    )
    if env is None:
        raise ApiError(404, "not_found", "Environment not found.")
    return env


@bp.get("")
@public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def list_environments(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        body = [serialize_environment(e) for e in sorted(project.environments, key=lambda e: (e.position, e.key))]
    return jsonify(body)


@bp.post("")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def create_env(project_id):
    data = json_body()
    key = (data.get("key") or "").strip().lower()
    if not is_valid_environment_key(key):
        raise ApiError(400, "invalid_key", "key must match ^[a-z0-9][a-z0-9-]{0,62}$.")
    name = (data.get("name") or "").strip() or key.capitalize()

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(Environment.id)).where(Environment.project_id == project.id)) or 0
        if not within_limit(used, limits["environments_per_project"]):
            raise limit_reached(account, "environments", "Environment limit reached for this project.")
        taken = session.scalar(
            select(Environment.id).where(Environment.project_id == project.id, Environment.key == key)
        )
        if taken:
            raise ApiError(409, "key_taken", f"An environment with key '{key}' already exists.")
        position = session.scalar(
            select(func.coalesce(func.max(Environment.position), -1)).where(Environment.project_id == project.id)
        ) + 1
        env, plaintext = create_environment(session, project, key, name, position)
        audit.record(
            session,
            account_id=g.account_id,
            action="environment.create",
            target_type="environment",
            target_id=str(env.id),
            meta={"project_id": str(project.id), "key": key, "name": name},
            **actor(),
        )
        session.flush()
        session.refresh(env)
        body = serialize_environment(env, plaintext)
    return jsonify(body), 201


@bp.patch("/<env_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def patch_env(project_id, env_id):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        env = get_owned_environment(session, project, env_id)
        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name:
                raise ApiError(400, "missing_name", "name cannot be empty.")
            env.name = name
        audit.record(
            session,
            account_id=g.account_id,
            action="environment.update",
            target_type="environment",
            target_id=str(env.id),
            meta={"project_id": str(project.id), "key": env.key, "fields": sorted(k for k in data if k == "name")},
            **actor(),
        )
        body = serialize_environment(env)
    return jsonify(body)


@bp.delete("/<env_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:delete")
def delete_env(project_id, env_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        env = get_owned_environment(session, project, env_id)
        remaining = session.scalar(select(func.count(Environment.id)).where(Environment.project_id == project.id)) or 0
        if remaining <= 1:
            raise ApiError(400, "last_environment", "A project must keep at least one environment.")
        audit.record(
            session,
            account_id=g.account_id,
            action="environment.delete",
            target_type="environment",
            target_id=str(env.id),
            meta={"project_id": str(project.id), "key": env.key},
            **actor(),
        )
        session.delete(env)  # states cascade
    return "", 204


@bp.post("/<env_id>/rotate-key")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def rotate_key(project_id, env_id):
    """Replace the client key. The old key stops working immediately (the hash
    is overwritten in the same transaction)."""
    full_key, prefix = generate_secret_key(ENV_KEY_PREFIX)
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        env = get_owned_environment(session, project, env_id)
        old_prefix = env.client_key_prefix
        env.client_key_hash = hash_token(full_key)
        env.client_key_prefix = prefix
        audit.record(
            session,
            account_id=g.account_id,
            action="environment.rotate_key",
            target_type="environment",
            target_id=str(env.id),
            meta={"project_id": str(project.id), "key": env.key, "old_prefix": old_prefix, "new_prefix": prefix},
            **actor(),
        )
    return jsonify({"client_key": full_key, "client_key_prefix": prefix})
