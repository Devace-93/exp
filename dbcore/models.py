"""SQLAlchemy models — the canonical data model for exp.

Tenancy: an Account is the billing entity. Users join accounts via Memberships.
Product hierarchy: Account -> Project -> (Environment, Flag) -> FlagState, one
state per (flag, environment). Deleting a project cascades everything under it
(Postgres ``ON DELETE CASCADE``), so the API never has to clean up by hand.

Secrets (API keys, environment client keys, refresh tokens) are stored as
sha256 hashes plus a short non-sensitive prefix; the plaintext is shown once.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)


# --------------------------------------------------------------------------- #
# Tenancy / auth
# --------------------------------------------------------------------------- #
class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # current effective plan: free | pro | team | enterprise | selfhost
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    memberships: Mapped[list["Membership"]] = relationship(back_populates="account")
    projects: Mapped[list["Project"]] = relationship(back_populates="account")


class User(Base):
    """A local mirror of an identity from accounts.3m4.net.

    Identity (password, OAuth, e-mail verification, avatar) lives in the
    accounts service; this row is created the first time a session's ``sub``
    shows up (just-in-time provisioning in ``api.auth_utils``) and its
    profile columns are refreshed from the JWT claims on every request.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    # ``sub`` of the accounts JWT: the one identifier shared by every 3m4 app.
    identity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    handle: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    memberships: Mapped[list["Membership"]] = relationship(back_populates="user")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("account_id", "user_id", name="uq_membership"),)

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="owner")  # owner|admin|member
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[Account] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), unique=True, index=True
    )
    rc_app_user_id: Mapped[str | None] = mapped_column(String(255), index=True)
    entitlement: Mapped[str | None] = mapped_column(String(20))   # pro | team
    product_id: Mapped[str | None] = mapped_column(String(120))
    period: Mapped[str | None] = mapped_column(String(12))        # monthly | annual
    status: Mapped[str | None] = mapped_column(String(30))        # active | expired | ...
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    will_renew: Mapped[bool] = mapped_column(Boolean, default=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# --------------------------------------------------------------------------- #
# Product: projects, environments, flags, states
# --------------------------------------------------------------------------- #
class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("account_id", "key", name="uq_project_account_key"),
        Index("ix_projects_account_created", "account_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(63), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    account: Mapped[Account] = relationship(back_populates="projects")
    environments: Mapped[list["Environment"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True,
        order_by="Environment.position",
    )
    flags: Mapped[list["Flag"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True,
    )


class Environment(Base):
    __tablename__ = "environments"
    __table_args__ = (UniqueConstraint("project_id", "key", name="uq_environment_project_key"),)

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(63), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # SDK client key at rest: sha256 hash + the first chars for display
    # (``exp_env_AbCd``). The plaintext is returned once on create / rotate.
    client_key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    client_key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="environments")
    states: Mapped[list["FlagState"]] = relationship(
        back_populates="environment", cascade="all, delete-orphan", passive_deletes=True
    )


class Flag(Base):
    __tablename__ = "flags"
    __table_args__ = (UniqueConstraint("project_id", "key", name="uq_flag_project_key"),)

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(99), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="boolean")  # boolean|string|number|json
    # JSON value matching `kind`; always `true` for boolean flags.
    default_value: Mapped[object] = mapped_column(JSONB, nullable=True)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="flags")
    states: Mapped[list["FlagState"]] = relationship(
        back_populates="flag", cascade="all, delete-orphan", passive_deletes=True
    )


class FlagState(Base):
    """One row per (flag, environment): the switch an SDK actually reads."""

    __tablename__ = "flag_states"
    __table_args__ = (
        UniqueConstraint("flag_id", "environment_id", name="uq_flag_state"),
        Index("ix_flag_states_environment", "environment_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    flag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("flags.id", ondelete="CASCADE"), nullable=False)
    environment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("environments.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Per-environment override of the flag's default_value (null = use default).
    value: Mapped[object] = mapped_column(JSONB, nullable=True)
    rollout_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    flag: Mapped[Flag] = relationship(back_populates="states")
    environment: Mapped[Environment] = relationship(back_populates="states")


# --------------------------------------------------------------------------- #
# Metering, keys, billing, audit
# --------------------------------------------------------------------------- #
class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("account_id", "period_start", name="uq_usage_period"),)

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    evaluations: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # set once when the evaluations limit is first hit in a period (for one-shot PostHog event)
    evaluations_limit_notified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # RBAC role: viewer | editor | admin (see packages/shared/api_key_roles.json).
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="editor", server_default="editor")
    prefix: Mapped[str] = mapped_column(String(16), index=True)        # shown in UI, e.g. exp_live_AbCd
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[uuid.UUID] = _pk()
    provider: Mapped[str] = mapped_column(String(40), default="revenuecat")
    event_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    type: Mapped[str | None] = mapped_column(String(60))
    payload: Mapped[dict | None] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEvent(Base):
    """Append-only audit trail (see dbcore/audit.py). Never updated or deleted
    by application code; retention is an ops concern."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_account_ts", "account_id", "ts"),)

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False)     # user | api_key | system
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # user id or api key id
    actor_label: Mapped[str | None] = mapped_column(String(120))            # e.g. key prefix
    action: Mapped[str] = mapped_column(String(60), nullable=False)         # flag.create, auth.denied, ...
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(20), nullable=False, default="ok", server_default="ok")  # ok | denied | error
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
