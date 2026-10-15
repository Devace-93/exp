"""Flags blueprint, mounted at ``/projects/<project_id>/flags``.

A flag is a definition (key, kind, default value, tags) plus one state per
environment (enabled, value override, rollout percentage). Both live here:
CRUD on the definition, ``PUT .../states/<envKey>`` on a state, ``copy`` to
clone definitions (and optionally states) into a sibling project, and
``evaluate`` as an unmetered preview of what the SDK endpoints would answer.

``<flag>`` in a URL is the flag UUID *or* its key (a lowercase UUID is also a
valid key, so the id is tried first). ``copy`` and ``evaluate`` are reserved
keys (400 ``reserved_key``): werkzeug always matches the static ``/copy`` and
``/evaluate`` rules before ``/<flag>``, so such a flag could never be reached. Mutations are audited in the same
transaction; the copy is a single transaction with the plan limit checked up
front so a 402 never leaves a half-copied project behind.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from dbcore import audit
from dbcore.db import session_scope
from dbcore.evaluate import KINDS, default_state, evaluate_flag, value_matches_kind
from dbcore.models import Account, Environment, Flag, FlagState, Project
from dbcore.plans import effective_plan_limits, is_unlimited, within_limit
from dbcore.slugs import is_reserved_flag_key, is_valid_flag_key

from ..auth_utils import actor, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..features import require_feature
from ..serializers import iso, json_body, serialize_flag
from .projects import get_owned_project, limit_reached, public_limit

bp = Blueprint("flags", __name__)


# --------------------------------------------------------------------------- #
# Validation helpers
# --------------------------------------------------------------------------- #
def _parse_kind(value, default: str = "boolean") -> str:
    kind = (value or default)
    if not isinstance(kind, str) or kind not in KINDS:
        raise ApiError(400, "invalid_kind", f"kind must be one of: {', '.join(KINDS)}.")
    return kind


def _parse_default_value(kind: str, value):
    """Boolean flags always default to ``true``; other kinds accept ``null``
    (no default) or a value of the right JSON type."""
    if kind == "boolean":
        return True
    if value is None:
        return None
    if not value_matches_kind(kind, value):
        raise ApiError(400, "invalid_value", f"default_value must be a {kind}.")
    return value


def _parse_tags(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(t, str) for t in value):
        raise ApiError(400, "invalid_tags", "tags must be a list of strings.")
    out: list[str] = []
    for tag in value:
        tag = tag.strip()
        if tag and tag not in out:
            out.append(tag)
    return out


def _parse_state_patch(kind: str, patch) -> dict:
    """Validate a ``StatePatch`` (``enabled?``, ``value?``, ``rollout_percent?``)
    against the flag kind. Returns only the fields present."""
    if not isinstance(patch, dict):
        raise ApiError(400, "invalid_state", "A state must be an object.")
    out: dict = {}
    if "enabled" in patch:
        if not isinstance(patch["enabled"], bool):
            raise ApiError(400, "invalid_state", "enabled must be a boolean.")
        out["enabled"] = patch["enabled"]
    if "value" in patch:
        value = patch["value"]
        if value is not None and not value_matches_kind(kind, value):
            raise ApiError(400, "invalid_value", f"value must be a {kind} or null.")
        out["value"] = value
    if "rollout_percent" in patch:
        pct = patch["rollout_percent"]
        if isinstance(pct, bool) or not isinstance(pct, int) or not 0 <= pct <= 100:
            raise ApiError(400, "invalid_rollout", "rollout_percent must be an integer between 0 and 100.")
        out["rollout_percent"] = pct
    return out


# --------------------------------------------------------------------------- #
# Query helpers
# --------------------------------------------------------------------------- #
def get_owned_flag(session, project: Project, ref: str) -> Flag:
    """Flag by UUID or key within ``project``, or 404."""
    flag = None
    try:
        flag_id = uuid.UUID(str(ref))
    except (ValueError, AttributeError):
        flag_id = None
    if flag_id is not None:
        flag = session.scalar(select(Flag).where(Flag.id == flag_id, Flag.project_id == project.id))
    if flag is None:
        flag = session.scalar(select(Flag).where(Flag.project_id == project.id, Flag.key == str(ref)))
    if flag is None:
        raise ApiError(404, "not_found", "Flag not found.")
    return flag


def load_states(session, flag_ids: list) -> dict:
    """``{flag_id: {environment_id: FlagState}}`` for many flags in one query."""
    out: dict = {fid: {} for fid in flag_ids}
    if flag_ids:
        for st in session.scalars(select(FlagState).where(FlagState.flag_id.in_(flag_ids))):
            out.setdefault(st.flag_id, {})[st.environment_id] = st
    return out


def flag_body(session, project: Project, flag: Flag) -> dict:
    session.flush()
    session.refresh(flag)
    return serialize_flag(flag, project.environments, load_states(session, [flag.id])[flag.id])


def evaluate_environment(session, project: Project, environment: Environment, distinct_id: str | None) -> dict:
    """The CONTRACT.md ``Evaluation`` object for every non-archived flag of
    ``project`` in ``environment``. Shared by the SDK endpoints and the
    dashboard preview; the only difference between them is metering."""
    flags = session.scalars(
        select(Flag).where(Flag.project_id == project.id, Flag.archived.is_(False)).order_by(Flag.key)
    ).all()
    states = {}
    if flags:
        for st in session.scalars(
            select(FlagState).where(
                FlagState.environment_id == environment.id, FlagState.flag_id.in_([f.id for f in flags])
            )
        ):
            states[st.flag_id] = st
    out = {}
    for flag in flags:
        st = states.get(flag.id)
        state = (
            {"enabled": st.enabled, "value": st.value, "rollout_percent": st.rollout_percent}
            if st is not None else default_state()
        )
        out[flag.key] = evaluate_flag(flag.key, flag.kind, flag.default_value, distinct_id=distinct_id, **state)
    return {
        "project": {"id": str(project.id), "key": project.key},
        "environment": {"id": str(environment.id), "key": environment.key},
        "distinct_id": distinct_id,
        "evaluated_at": iso(datetime.now(timezone.utc)),
        "flags": out,
    }


# --------------------------------------------------------------------------- #
# List + create
# --------------------------------------------------------------------------- #
@bp.get("")
@public_limit
@require_auth_or_api_key
@require_scope("flags:read")
def list_flags(project_id):
    try:
        page = max(int(request.args.get("page", 1)), 1)
        per_page = min(max(int(request.args.get("per_page", 50)), 1), 200)
    except ValueError:
        raise ApiError(400, "invalid_pagination", "page and per_page must be integers.")
    q = (request.args.get("q") or "").strip()
    include_archived = (request.args.get("include_archived") or "false").lower() in {"1", "true", "yes"}

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        stmt = select(Flag).where(Flag.project_id == project.id)
        count_stmt = select(func.count(Flag.id)).where(Flag.project_id == project.id)
        if not include_archived:
            stmt = stmt.where(Flag.archived.is_(False))
            count_stmt = count_stmt.where(Flag.archived.is_(False))
        if q:
            like = f"%{q}%"
            cond = or_(Flag.key.ilike(like), Flag.name.ilike(like), Flag.description.ilike(like))
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        total = session.scalar(count_stmt) or 0
        flags = session.scalars(stmt.order_by(Flag.key).offset((page - 1) * per_page).limit(per_page)).all()
        states = load_states(session, [f.id for f in flags])
        items = [serialize_flag(f, project.environments, states[f.id]) for f in flags]
    return jsonify({"items": items, "page": page, "per_page": per_page, "total": total})


@bp.post("")
@public_limit
@require_auth_or_api_key
@require_scope("flags:write")
def create_flag(project_id):
    data = json_body()
    key = (data.get("key") or "").strip()
    if not is_valid_flag_key(key):
        raise ApiError(400, "invalid_key", "key must match ^[a-z0-9][a-z0-9_-]{0,98}$.")
    if is_reserved_flag_key(key):
        raise ApiError(400, "reserved_key", f"'{key}' is a reserved flag key.")
    name = (data.get("name") or "").strip() or key
    description = (data.get("description") or "").strip() or None
    kind = _parse_kind(data.get("kind"))
    default_value = _parse_default_value(kind, data.get("default_value"))
    tags = _parse_tags(data.get("tags"))
    states_in = data.get("states") or {}
    if not isinstance(states_in, dict):
        raise ApiError(400, "invalid_state", "states must be an object keyed by environment key.")
    patches = {env_key: _parse_state_patch(kind, patch) for env_key, patch in states_in.items()}

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(Flag.id)).where(Flag.project_id == project.id)) or 0
        if not within_limit(used, limits["flags_per_project"]):
            raise limit_reached(account, "flags", "Flag limit reached for this project.")
        taken = session.scalar(select(Flag.id).where(Flag.project_id == project.id, Flag.key == key))
        if taken:
            raise ApiError(409, "key_taken", f"A flag with key '{key}' already exists.")
        env_keys = {e.key for e in project.environments}
        unknown = sorted(set(patches) - env_keys)
        if unknown:
            raise ApiError(400, "unknown_environment", f"Unknown environment(s): {', '.join(unknown)}.")

        flag = Flag(
            project_id=project.id, key=key, name=name, description=description,
            kind=kind, default_value=default_value, tags=tags, archived=False,
        )
        session.add(flag)
        session.flush()
        for env in project.environments:
            session.add(FlagState(flag_id=flag.id, environment_id=env.id, **{**default_state(), **patches.get(env.key, {})}))
        audit.record(
            session,
            account_id=g.account_id,
            action="flag.create",
            target_type="flag",
            target_id=str(flag.id),
            meta={"project_id": str(project.id), "key": key, "kind": kind, "states": sorted(patches)},
            **actor(),
        )
        body = flag_body(session, project, flag)
    return jsonify(body), 201


# --------------------------------------------------------------------------- #
# Copy + evaluate (static routes; declared before /<flag> for clarity)
# --------------------------------------------------------------------------- #
@bp.post("/copy")
@public_limit
@require_auth_or_api_key
@require_scope("flags:write")
@require_feature("flag-copy")
def copy_flags(project_id):
    data = json_body()
    target_id = data.get("target_project_id")
    if not target_id:
        raise ApiError(400, "missing_target", "target_project_id is required.")
    flag_keys = data.get("flag_keys")
    if flag_keys is not None and (not isinstance(flag_keys, list) or not all(isinstance(k, str) for k in flag_keys)):
        raise ApiError(400, "invalid_flag_keys", "flag_keys must be a list of strings.")
    include_states = data.get("include_states", True)
    if not isinstance(include_states, bool):
        raise ApiError(400, "invalid_body", "include_states must be a boolean.")
    on_conflict = data.get("on_conflict") or "skip"
    if on_conflict not in ("skip", "overwrite"):
        raise ApiError(400, "invalid_on_conflict", "on_conflict must be 'skip' or 'overwrite'.")

    with session_scope() as session:
        source = get_owned_project(session, project_id)
        target = get_owned_project(session, target_id)  # other account -> 404
        if source.id == target.id:
            raise ApiError(400, "same_project", "Source and target project must differ.")

        stmt = select(Flag).where(Flag.project_id == source.id)
        if flag_keys is None:
            stmt = stmt.where(Flag.archived.is_(False))
        else:
            stmt = stmt.where(Flag.key.in_(flag_keys))
        source_flags = session.scalars(stmt.order_by(Flag.key)).all()
        if flag_keys is not None:
            missing = sorted(set(flag_keys) - {f.key for f in source_flags})
            if missing:
                raise ApiError(404, "not_found", f"Unknown flag key(s): {', '.join(missing)}.")

        target_flags = {f.key: f for f in session.scalars(select(Flag).where(Flag.project_id == target.id))}
        new_keys = [f.key for f in source_flags if f.key not in target_flags]

        # Limit check up front: all or nothing.
        account = session.get(Account, g.account_id)
        limit = effective_plan_limits(account.plan, str(account.id))["flags_per_project"]
        if not is_unlimited(limit) and len(target_flags) + len(new_keys) > limit:
            raise limit_reached(account, "flags", "Copying would exceed the flag limit of the target project.")

        source_env_by_id = {e.id: e for e in source.environments}
        target_envs = list(target.environments)
        source_states = load_states(session, [f.id for f in source_flags])
        target_states = load_states(session, [f.id for f in target_flags.values()])

        copied, overwritten, skipped = [], [], []
        for sf in source_flags:
            tf = target_flags.get(sf.key)
            if tf is not None:
                if on_conflict == "skip":
                    skipped.append(sf.key)
                    continue
                kind_changed = tf.kind != sf.kind
                tf.name, tf.description, tf.kind = sf.name, sf.description, sf.kind
                tf.default_value, tf.tags, tf.archived = sf.default_value, list(sf.tags or []), sf.archived
                states = target_states.get(tf.id, {})
                if kind_changed:
                    for st in states.values():
                        st.value = None
                overwritten.append(sf.key)
            else:
                tf = Flag(
                    project_id=target.id, key=sf.key, name=sf.name, description=sf.description,
                    kind=sf.kind, default_value=sf.default_value, tags=list(sf.tags or []), archived=sf.archived,
                )
                session.add(tf)
                session.flush()
                states = {}
                for env in target_envs:
                    st = FlagState(flag_id=tf.id, environment_id=env.id, **default_state())
                    session.add(st)
                    states[env.id] = st
                copied.append(sf.key)

            if include_states:
                # Match environments by key; target environments without a
                # source twin keep what they have (the default for new flags).
                by_key = {source_env_by_id[eid].key: st for eid, st in source_states.get(sf.id, {}).items() if eid in source_env_by_id}
                for env in target_envs:
                    src = by_key.get(env.key)
                    dst = states.get(env.id)
                    if src is None or dst is None:
                        continue
                    dst.enabled, dst.value, dst.rollout_percent = src.enabled, src.value, src.rollout_percent

        audit.record(
            session,
            account_id=g.account_id,
            action="flag.copy",
            target_type="project",
            target_id=str(target.id),
            meta={
                "source_project_id": str(source.id),
                "copied": copied, "overwritten": overwritten, "skipped": skipped,
                "include_states": include_states, "on_conflict": on_conflict,
            },
            **actor(),
        )
        body = {"target_project_id": str(target.id), "copied": copied, "overwritten": overwritten, "skipped": skipped}
    return jsonify(body)


@bp.get("/evaluate")
@public_limit
@require_auth_or_api_key
@require_scope("flags:read")
def evaluate_preview(project_id):
    """What the evaluation API would answer for ``?environment=<key>`` and an
    optional ``distinct_id``. Not metered, management rate limit only."""
    env_key = (request.args.get("environment") or "").strip()
    if not env_key:
        raise ApiError(400, "missing_environment", "environment (key) is required.")
    distinct_id = (request.args.get("distinct_id") or "").strip() or None
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        env = next((e for e in project.environments if e.key == env_key), None)
        if env is None:
            raise ApiError(404, "not_found", "Environment not found.")
        body = evaluate_environment(session, project, env, distinct_id)
    return jsonify(body)


# --------------------------------------------------------------------------- #
# Get / patch / delete one flag; put one state
# --------------------------------------------------------------------------- #
@bp.get("/<flag_ref>")
@public_limit
@require_auth_or_api_key
@require_scope("flags:read")
def get_flag(project_id, flag_ref):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        flag = get_owned_flag(session, project, flag_ref)
        body = serialize_flag(flag, project.environments, load_states(session, [flag.id])[flag.id])
    return jsonify(body)


@bp.patch("/<flag_ref>")
@public_limit
@require_auth_or_api_key
@require_scope("flags:write")
def patch_flag(project_id, flag_ref):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        flag = get_owned_flag(session, project, flag_ref)
        fields = []
        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name:
                raise ApiError(400, "missing_name", "name cannot be empty.")
            flag.name = name
            fields.append("name")
        if "description" in data:
            flag.description = (data.get("description") or "").strip() or None
            fields.append("description")
        if "tags" in data:
            flag.tags = _parse_tags(data.get("tags"))
            fields.append("tags")
        if "archived" in data:
            if not isinstance(data["archived"], bool):
                raise ApiError(400, "invalid_body", "archived must be a boolean.")
            flag.archived = data["archived"]
            fields.append("archived")
        kind_changed = False
        if "kind" in data:
            new_kind = _parse_kind(data.get("kind"), flag.kind)
            if new_kind != flag.kind:
                kind_changed = True
                flag.kind = new_kind
                # The old default no longer fits the new kind unless replaced below.
                flag.default_value = True if new_kind == "boolean" else None
            fields.append("kind")
        if "default_value" in data or kind_changed:
            if "default_value" in data:
                flag.default_value = _parse_default_value(flag.kind, data.get("default_value"))
                fields.append("default_value")
            else:
                flag.default_value = _parse_default_value(flag.kind, None)
        if kind_changed:
            # Per-environment overrides were typed for the old kind: reset them.
            for st in load_states(session, [flag.id])[flag.id].values():
                st.value = None
        audit.record(
            session,
            account_id=g.account_id,
            action="flag.update",
            target_type="flag",
            target_id=str(flag.id),
            meta={"project_id": str(project.id), "key": flag.key, "fields": sorted(set(fields)), "kind_changed": kind_changed},
            **actor(),
        )
        body = flag_body(session, project, flag)
    return jsonify(body)


@bp.put("/<flag_ref>/states/<env_key>")
@public_limit
@require_auth_or_api_key
@require_scope("flags:write")
def put_state(project_id, flag_ref, env_key):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        flag = get_owned_flag(session, project, flag_ref)
        env = next((e for e in project.environments if e.key == env_key), None)
        if env is None:
            raise ApiError(404, "not_found", "Environment not found.")
        patch = _parse_state_patch(flag.kind, data)
        state = session.scalar(
            select(FlagState).where(FlagState.flag_id == flag.id, FlagState.environment_id == env.id)
        )
        if state is None:
            state = FlagState(flag_id=flag.id, environment_id=env.id, **default_state())
            session.add(state)
        for field, value in patch.items():
            setattr(state, field, value)
        if not patch:
            # PUT with nothing to change still touches the row's timestamp.
            state.updated_at = datetime.now(timezone.utc)
        audit.record(
            session,
            account_id=g.account_id,
            action="flag_state.update",
            target_type="flag",
            target_id=str(flag.id),
            meta={"project_id": str(project.id), "key": flag.key, "environment": env.key,
                  "fields": sorted(patch), "state": {**patch}},
            **actor(),
        )
        body = flag_body(session, project, flag)
    return jsonify(body)


@bp.delete("/<flag_ref>")
@public_limit
@require_auth_or_api_key
@require_scope("flags:delete")
def delete_flag(project_id, flag_ref):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        flag = get_owned_flag(session, project, flag_ref)
        audit.record(
            session,
            account_id=g.account_id,
            action="flag.delete",
            target_type="flag",
            target_id=str(flag.id),
            meta={"project_id": str(project.id), "key": flag.key, "kind": flag.kind},
            **actor(),
        )
        session.delete(flag)  # states cascade
    return "", 204
