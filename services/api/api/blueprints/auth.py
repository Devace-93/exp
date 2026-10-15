"""Auth blueprint: register, login, refresh, logout, me.

Tenancy model: an Account is the billing unit. Registering creates a User, an
Account, and an owner Membership linking them. Access is a JWT; refresh is an
opaque token stored hashed in ``refresh_tokens``.
"""
from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from dbcore.db import session_scope
from dbcore.feature_flags import resolve_all
from dbcore.models import Account, ApiKey, Membership, Project, RefreshToken, User
from dbcore.plans import effective_plan_limits
from dbcore.posthog_client import capture, group_identify
from dbcore.usage import get_or_create_counter

from ..auth_utils import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    refresh_token_expiry,
    require_auth,
    verify_password,
)
from ..errors import ApiError
from ..features import require_feature
from ..serializers import json_body, serialize_account, serialize_usage, serialize_user

bp = Blueprint("auth", __name__)


def _issue_tokens(session, user, account) -> tuple[str, str]:
    """Create an access token and a persisted (hashed) refresh token.

    Returns the access token and the *plaintext* refresh token (shown to the
    client once; only its hash is stored).
    """
    access = create_access_token(user.id, account.id)
    refresh_plain = generate_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            account_id=account.id,
            token_hash=hash_token(refresh_plain),
            expires_at=refresh_token_expiry(),
        )
    )
    return access, refresh_plain


def account_counts(session, account_id) -> dict:
    """``{projects, api_keys}`` for the usage object and ``/auth/me``."""
    projects = session.scalar(select(func.count(Project.id)).where(Project.account_id == account_id)) or 0
    api_keys = session.scalar(
        select(func.count(ApiKey.id)).where(ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None))
    ) or 0
    return {"projects": projects, "api_keys": api_keys}


@bp.post("/register")
@require_feature("signups")
def register():
    data = json_body()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    account_name = (data.get("account_name") or "").strip()

    if not email or "@" not in email:
        raise ApiError(400, "invalid_email", "A valid email is required.")
    if len(password) < 8:
        raise ApiError(400, "weak_password", "Password must be at least 8 characters.")

    with session_scope() as session:
        exists = session.scalar(select(User.id).where(User.email == email))
        if exists:
            raise ApiError(409, "email_taken", "An account with that email already exists.")

        user = User(email=email, password_hash=hash_password(password))
        session.add(user)

        account = Account(name=account_name or f"{email}'s workspace", plan="free")
        session.add(account)
        session.flush()  # assign ids

        session.add(Membership(account_id=account.id, user_id=user.id, role="owner"))

        access, refresh_plain = _issue_tokens(session, user, account)

        body = {
            "user": serialize_user(user),
            "account": serialize_account(account),
            "access_token": access,
            "refresh_token": refresh_plain,
        }

    # Analytics (outside the txn; never blocks the response).
    capture(str(account.id), "signup", {"plan": "free"}, groups={"account": str(account.id)})
    group_identify("account", str(account.id), {"plan": "free", "name": account.name})
    return jsonify(body), 201


@bp.post("/login")
def login():
    data = json_body()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None or not verify_password(user.password_hash, password):
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")

        # Pick the user's primary account (first membership). Multi-account
        # switching is a later phase.
        membership = session.scalar(
            select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
        )
        if membership is None:
            raise ApiError(403, "no_account", "User is not attached to an account.")
        account = session.get(Account, membership.account_id)

        access, refresh_plain = _issue_tokens(session, user, account)
        body = {
            "user": serialize_user(user),
            "account": serialize_account(account),
            "access_token": access,
            "refresh_token": refresh_plain,
        }
    return jsonify(body)


@bp.post("/refresh")
def refresh():
    data = json_body()
    refresh_plain = data.get("refresh_token") or ""
    if not refresh_plain:
        raise ApiError(400, "missing_token", "refresh_token is required.")

    token_hash = hash_token(refresh_plain)
    with session_scope() as session:
        row = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        now = datetime.now(timezone.utc)
        if row is None or row.revoked or row.expires_at <= now:
            raise ApiError(401, "invalid_refresh", "Refresh token is invalid or expired.")
        access = create_access_token(row.user_id, row.account_id)
    return jsonify({"access_token": access})


@bp.post("/logout")
def logout():
    data = json_body()
    refresh_plain = data.get("refresh_token") or ""
    if refresh_plain:
        token_hash = hash_token(refresh_plain)
        with session_scope() as session:
            row = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
            if row is not None:
                row.revoked = True
    return "", 204


@bp.get("/me")
@require_auth
def me():
    with session_scope() as session:
        user = session.get(User, g.user_id)
        account = session.get(Account, g.account_id)
        if user is None or account is None:
            raise ApiError(404, "not_found", "User or account not found.")
        limits = effective_plan_limits(account.plan, str(account.id))
        counter = get_or_create_counter(session, account.id)
        counts = account_counts(session, account.id)
        body = {
            "user": serialize_user(user),
            "account": serialize_account(account),
            "plan": account.plan,
            "limits": limits,
            "usage": serialize_usage(counter, limits, counts),
            "counts": {"projects": counts["projects"]},
            "features": resolve_all(str(account.id)),
        }
    return jsonify(body)
