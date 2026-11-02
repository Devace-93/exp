"""Billing moves from RevenueCat to payments.3m4.net.

Revision ID: 0002_payments_portal
Revises: 0001_accounts_identity

``subscriptions.rc_app_user_id`` (RevenueCat's app_user_id, which was our own
account id) becomes ``stripe_subscription_id`` (payments' subscription id,
``data.subscription.id`` in its push events). The index follows the column.
``webhook_events.provider`` keeps its rows (they are an audit trail); new rows
default to ``payments`` in the model.

Idempotent: fresh installs get the final schema from ``create_all`` before
this runs, so every step checks the live schema first.
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_payments_portal"
down_revision: Union[str, None] = "0001_accounts_identity"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(table)}


def _indexes(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {i["name"] for i in insp.get_indexes(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "subscriptions" not in insp.get_table_names():
        return  # create_all will build the final schema
    cols = _columns("subscriptions")
    if "rc_app_user_id" in cols and "stripe_subscription_id" not in cols:
        # Old rows carried our account id there: not a subscription id, drop it.
        op.execute("UPDATE subscriptions SET rc_app_user_id = NULL")
        op.alter_column("subscriptions", "rc_app_user_id", new_column_name="stripe_subscription_id")
    elif "stripe_subscription_id" not in cols:
        op.add_column("subscriptions", sa.Column("stripe_subscription_id", sa.String(255), nullable=True))
    idx = _indexes("subscriptions")
    if "ix_subscriptions_rc_app_user_id" in idx:
        op.drop_index("ix_subscriptions_rc_app_user_id", table_name="subscriptions")
    if "ix_subscriptions_stripe_subscription_id" not in _indexes("subscriptions"):
        op.create_index(
            "ix_subscriptions_stripe_subscription_id", "subscriptions", ["stripe_subscription_id"], unique=False
        )


def downgrade() -> None:
    idx = _indexes("subscriptions")
    if "ix_subscriptions_stripe_subscription_id" in idx:
        op.drop_index("ix_subscriptions_stripe_subscription_id", table_name="subscriptions")
    if "stripe_subscription_id" in _columns("subscriptions"):
        op.alter_column("subscriptions", "stripe_subscription_id", new_column_name="rc_app_user_id")
        op.create_index("ix_subscriptions_rc_app_user_id", "subscriptions", ["rc_app_user_id"], unique=False)
