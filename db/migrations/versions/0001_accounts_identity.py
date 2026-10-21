"""Move identity to accounts.3m4.net: users become identity mirrors.

Revision ID: 0001_accounts_identity
Revises: (none: exp bootstrapped with create_all)

DESTRUCTIVE BY DECISION (2026-10-16, no real users yet): every account, user
and everything hanging off them (memberships, projects, environments, flags, usage
counters, API keys, audit events, subscriptions) is deleted, the
``refresh_tokens`` table is dropped, and ``users`` loses ``password_hash`` in
favour of the columns mirrored from the accounts JWT (``identity_id``,
``handle``, ``name``, ``avatar_url``, ``updated_at``).

Idempotent: fresh installs get the final schema from ``create_all`` before
this runs, so every step checks the live schema first and the data wipe only
happens on a database that still has the old ``password_hash`` column.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_accounts_identity"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "refresh_tokens" in tables:
        op.drop_table("refresh_tokens")

    if "users" not in tables:
        return  # create_all will build the final schema
    cols = {c["name"] for c in insp.get_columns("users")}
    if "identity_id" in cols and "password_hash" not in cols:
        return  # already migrated (or created fresh)

    # --- the cut: wipe tenants before changing the shape of users -----------
    # ON DELETE CASCADE takes care of memberships, projects -> environments /
    # flags, usage_counters, api_keys, audit_events and subscriptions.
    op.execute("DELETE FROM accounts")
    op.execute("DELETE FROM users")

    if "password_hash" in cols:
        op.drop_column("users", "password_hash")
    if "identity_id" not in cols:
        op.add_column("users", sa.Column("identity_id", postgresql.UUID(as_uuid=True), nullable=False))
        op.create_index("ix_users_identity_id", "users", ["identity_id"], unique=True)
    if "handle" not in cols:
        op.add_column("users", sa.Column("handle", sa.String(32), nullable=False))
    if "name" not in cols:
        op.add_column("users", sa.Column("name", sa.String(80)))
    if "avatar_url" not in cols:
        op.add_column("users", sa.Column("avatar_url", sa.String(500)))
    if "updated_at" not in cols:
        op.add_column(
            "users",
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    # The old password-based schema cannot be restored meaningfully (the data
    # is gone by design). Recreate the columns so the old code can at least boot.
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=False, server_default=""))
    op.drop_index("ix_users_identity_id", table_name="users")
    for col in ("identity_id", "handle", "name", "avatar_url", "updated_at"):
        op.drop_column("users", col)
    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="CASCADE")),
        sa.Column("token_hash", sa.String(128), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
