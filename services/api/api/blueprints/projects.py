"""Projects blueprint: CRUD + export.

These endpoints accept EITHER a dashboard JWT OR a management API key.
Everything is scoped to ``g.account_id`` so one account can never see
another's projects (a foreign project is a 404, never a 403), and each
endpoint declares the RBAC scope it needs. Mutations are written to the audit
log in the same transaction as the change.

Creating a project seeds three environments (production / staging /
development) and returns their one-time client keys; the helpers that do that
(``get_owned_project``, ``create_environment``) are shared with the
environments and flags blueprints.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.evaluate import default_state
from dbcore.models import Account, Environment, Flag, FlagState, Project
from dbcore.plans import effective_plan_limits, within_limit
from dbcore.posthog_client import capture
from dbcore.slugs import is_valid_project_key, slugify

from ..auth_utils import ENV_KEY_PREFIX, actor, generate_secret_key, hash_token, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import iso, json_body, serialize_project

bp = Blueprint("projects", __name__)

# Public-API budget applies on top of the global default limit.
public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)

# Seeded on project creation, in this order (position 0, 1, 2).
DEFAULT_ENVIRONMENTS = (("production", "Production"), ("staging", "Staging"), ("development", "Development"))


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def get_owned_project(session, project_id_str: str) -> Project:
    """Fetch a project by id, scoped to the current account, or 404."""
    try:
        project_id = uuid.UUID(str(project_id_str))
    except (ValueError, AttributeError):
        raise ApiError(404, "not_found", "Project not found.")
    project = session.scalar(
        select(Project).where(Project.id == project_id, Project.account_id == g.account_id)
    )
    if project is None:
        raise ApiError(404, "not_found", "Project not found.")
    return project


def flag_counts(session, project_ids: list) -> dict:
    """``{project_id: flag_count}`` in one query (archived flags included)."""
    if not project_ids:
        return {}
    rows = session.execute(
        select(Flag.project_id, func.count(Flag.id))
        .where(Flag.project_id.in_(project_ids))
        .group_by(Flag.project_id)
    ).all()
    return {pid: n for pid, n in rows}


def create_environment(session, project: Project, key: str, name: str, position: int) -> tuple[Environment, str]:
    """Add an environment with a fresh client key and a default state for
    every existing flag of the project. Returns ``(env, plaintext_key)``."""
    full_key, prefix = generate_secret_key(ENV_KEY_PREFIX)
    env = Environment(
        project_id=project.id,
        key=key,
        name=name,
        client_key_hash=hash_token(full_key),
        client_key_prefix=prefix,
        position=position,
    )
    session.add(env)
    session.flush()
    for flag_id in session.scalars(select(Flag.id).where(Flag.project_id == project.id)):
        session.add(FlagState(flag_id=flag_id, environment_id=env.id, **default_state()))
    return env, full_key


def limit_reached(account: Account, which: str, message: str) -> ApiError:
    """Emit the funnel event and build the 402 the contract expects."""
    capture(
        str(account.id),
        "limit_reached",
        {"which": which, "plan": account.plan},
        groups={"account": str(account.id)},
    )
    return ApiError(402, "limit_reached", message, extra={"which": which})


# --------------------------------------------------------------------------- #
# List + create
# --------------------------------------------------------------------------- #
@bp.get("")
@public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def list_projects():
    q = (request.args.get("q") or "").strip()
    with session_scope() as session:
        stmt = select(Project).where(Project.account_id == g.account_id)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(Project.name.ilike(like), Project.key.ilike(like)))
        projects = session.scalars(stmt.order_by(Project.created_at.desc(), Project.id)).all()
        ids = [p.id for p in projects]
        counts = flag_counts(session, ids)
        envs: dict = {pid: [] for pid in ids}
        if ids:
            for env in session.scalars(select(Environment).where(Environment.project_id.in_(ids))):
                envs[env.project_id].append(env)
        items = [serialize_project(p, envs[p.id], counts.get(p.id, 0)) for p in projects]
    return jsonify({"items": items, "total": len(items)})


@bp.post("")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def create_project():
    data = json_body()
    name = (data.get("name") or "").strip()
    if not name:
        raise ApiError(400, "missing_name", "name is required.")
    key = (data.get("key") or "").strip().lower() or slugify(name)
    if not is_valid_project_key(key):
        raise ApiError(400, "invalid_key", "key must match ^[a-z0-9][a-z0-9-]{0,62}$.")
    description = (data.get("description") or "").strip() or None

    with session_scope() as session:
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(Project.id)).where(Project.account_id == account.id)) or 0
        if not within_limit(used, limits["projects"]):
            raise limit_reached(account, "projects", "Project limit reached for your plan.")

        taken = session.scalar(
            select(Project.id).where(Project.account_id == account.id, Project.key == key)
        )
        if taken:
            raise ApiError(409, "key_taken", f"A project with key '{key}' already exists.")

        project = Project(account_id=account.id, key=key, name=name, description=description)
        session.add(project)
        session.flush()

        environments, client_keys = [], {}
        for position, (env_key, env_name) in enumerate(DEFAULT_ENVIRONMENTS):
            env, plaintext = create_environment(session, project, env_key, env_name, position)
            environments.append(env)
            client_keys[env.id] = plaintext

        audit.record(
            session,
            account_id=account.id,
            action="project.create",
            target_type="project",
            target_id=str(project.id),
            meta={"key": key, "name": name, "environments": [e.key for e in environments]},
            **actor(),
        )
        session.flush()
        body = serialize_project(project, environments, 0, client_keys)

    capture(str(g.account_id), "project_created", {"plan": account.plan}, groups={"account": str(g.account_id)})
    return jsonify(body), 201


# --------------------------------------------------------------------------- #
# Get / patch / delete
# --------------------------------------------------------------------------- #
@bp.get("/<project_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def get_project(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        body = serialize_project(project, project.environments, flag_counts(session, [project.id]).get(project.id, 0))
    return jsonify(body)


@bp.patch("/<project_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def patch_project(project_id):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name:
                raise ApiError(400, "missing_name", "name cannot be empty.")
            project.name = name
        if "description" in data:
            project.description = (data.get("description") or "").strip() or None
        audit.record(
            session,
            account_id=g.account_id,
            action="project.update",
            target_type="project",
            target_id=str(project.id),
            meta={"key": project.key, "fields": sorted(k for k in data if k in ("name", "description"))},
            **actor(),
        )
        session.flush()
        session.refresh(project)
        body = serialize_project(project, project.environments, flag_counts(session, [project.id]).get(project.id, 0))
    return jsonify(body)


@bp.delete("/<project_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:delete")
def delete_project(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        audit.record(
            session,
            account_id=g.account_id,
            action="project.delete",
            target_type="project",
            target_id=str(project.id),
            meta={"key": project.key, "name": project.name},
            **actor(),
        )
        # ON DELETE CASCADE takes environments, flags and states with it.
        session.delete(project)
    return "", 204


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
@bp.get("/<project_id>/export")
@public_limit
@require_auth_or_api_key
@require_scope("flags:read")
def export_project(project_id):
    """Portable snapshot of a project (format ``exp.project.v1``). Client keys
    are never exported; secrets stay in the database."""
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        environments = sorted(project.environments, key=lambda e: (e.position, e.key))
        env_key_by_id = {e.id: e.key for e in environments}
        flags = session.scalars(
            select(Flag).where(Flag.project_id == project.id).order_by(Flag.key)
        ).all()
        states_by_flag: dict = {}
        if flags:
            for st in session.scalars(select(FlagState).where(FlagState.flag_id.in_([f.id for f in flags]))):
                states_by_flag.setdefault(st.flag_id, {})[st.environment_id] = st
        out_flags = []
        for flag in flags:
            states = {}
            for env in environments:
                st = states_by_flag.get(flag.id, {}).get(env.id)
                states[env.key] = (
                    {"enabled": st.enabled, "value": st.value, "rollout_percent": st.rollout_percent}
                    if st is not None else default_state()
                )
            out_flags.append(
                {
                    "key": flag.key,
                    "name": flag.name,
                    "description": flag.description,
                    "kind": flag.kind,
                    "default_value": flag.default_value,
                    "tags": list(flag.tags or []),
                    "archived": flag.archived,
                    "states": states,
                }
            )
        body = {
            "format": "exp.project.v1",
            "exported_at": iso(datetime.now(timezone.utc)),
            "project": {"key": project.key, "name": project.name, "description": project.description},
            "environments": [{"key": e.key, "name": e.name, "position": e.position} for e in environments],
            "flags": out_flags,
        }
    return jsonify(body)
