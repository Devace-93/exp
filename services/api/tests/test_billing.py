"""Billing through payments.3m4.net: signed push webhooks flip ``account.plan``
(idempotently, never 4xx for a verified event), the nightly reconcile pulls the
same snapshots through ``M4PayClient``, and ``GET /billing/status`` serves the
dashboard. The signature is computed exactly like ``m4pay.verify_webhook``
expects (``v1=hmac_sha256(secret, f"{ts}.{body}")``).
"""
from __future__ import annotations

import json
import time
import uuid

import pytest
from sqlalchemy import select

from dbcore import worker
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.m4pay import sign
from dbcore.models import Account, Subscription, User, WebhookEvent

from conftest import make_identity, session_cookie

PRO_SUB = {
    "id": "0d3f3c88-5b3a-4f0b-9d1b-3c5e8f7a1b2c",
    "entitlement": "pro",
    "status": "active",
    "current_period_end": "2026-12-01T10:00:00Z",
    "cancel_at_period_end": False,
    "label": "Pro",
}


def event(identity_id, *, type="subscription.updated", entitlements=("pro",), subscription=PRO_SUB, app="exp", **extra):
    return {
        "id": str(uuid.uuid4()),
        "type": type,
        "created": "2026-11-01T10:00:00Z",
        "app": app,
        "identity_id": identity_id,
        "email": "ana@example.com",
        "data": {
            "entitlements": list(entitlements),
            "subscription": subscription,
            "payment": None,
            "updated_at": "2026-11-01T10:00:00Z",
            **extra,
        },
    }


def signed(payload: dict, *, secret: str | None = None, timestamp: int | None = None) -> tuple[bytes, dict]:
    """``(body, headers)`` signed like the payments worker does (CONTRACT.md §6)."""
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = timestamp or int(time.time())
    return body, {
        "Content-Type": "application/json",
        "X-M4Pay-Event-Id": payload["id"],
        "X-M4Pay-Timestamp": str(ts),
        "X-M4Pay-Signature": sign(secret or config.payments_webhook_secret, ts, body),
    }


def post_event(client, payload: dict, **kwargs):
    body, headers = signed(payload, **kwargs)
    return client.post("/api/billing/webhook", data=body, headers=headers)


def provision(client) -> dict:
    """Sign in once so the identity has an exp account (JIT provisioning)."""
    identity = session_cookie(client, make_identity())
    res = client.get("/api/auth/me")
    assert res.status_code == 200, res.get_json()
    return identity


def account_of(identity: dict) -> tuple[str, Subscription | None]:
    with session_scope() as session:
        user = session.scalar(select(User).where(User.identity_id == uuid.UUID(identity["sub"])))
        account = session.scalar(select(Account).join(Account.memberships).where(Account.memberships.any(user_id=user.id)))
        sub = session.scalar(select(Subscription).where(Subscription.account_id == account.id))
        if sub is not None:
            session.expunge(sub)
        return account.plan, sub


# --- push ----------------------------------------------------------------- #
def test_subscription_updated_flips_plan_to_pro(client):
    identity = provision(client)
    assert account_of(identity)[0] == "free"

    res = post_event(client, event(identity["sub"]))
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok", "plan": "pro"}

    plan, sub = account_of(identity)
    assert plan == "pro"
    assert sub.stripe_subscription_id == PRO_SUB["id"]
    assert sub.entitlement == "pro" and sub.status == "active" and sub.will_renew is True
    assert sub.current_period_end.isoformat().startswith("2026-12-01T10:00:00")
    assert sub.product_id == "Pro" and sub.period == "monthly"
    with session_scope() as session:
        row = session.scalar(select(WebhookEvent))
        assert row.provider == "payments" and row.type == "subscription.updated" and row.processed_at is not None


def test_team_outranks_pro_and_annual_period(client):
    identity = provision(client)
    sub = dict(PRO_SUB, entitlement="team", label="Team (annual)")
    res = post_event(client, event(identity["sub"], entitlements=("pro", "team"), subscription=sub))
    assert res.get_json()["plan"] == "team"
    plan, row = account_of(identity)
    assert plan == "team" and row.period == "annual"


def test_cancel_at_period_end_keeps_plan_but_will_not_renew(client):
    identity = provision(client)
    post_event(client, event(identity["sub"]))
    sub = dict(PRO_SUB, cancel_at_period_end=True)
    post_event(client, event(identity["sub"], subscription=sub))
    plan, row = account_of(identity)
    assert plan == "pro" and row.will_renew is False


def test_null_subscription_downgrades_to_free(client):
    identity = provision(client)
    post_event(client, event(identity["sub"]))
    assert account_of(identity)[0] == "pro"

    res = post_event(client, event(identity["sub"], entitlements=(), subscription=None))
    assert res.status_code == 200 and res.get_json()["plan"] == "free"
    plan, sub = account_of(identity)
    assert plan == "free"
    assert sub.status == "none" and sub.entitlement is None and sub.will_renew is False


def test_canceled_status_with_no_entitlements_downgrades(client):
    identity = provision(client)
    post_event(client, event(identity["sub"]))
    canceled = dict(PRO_SUB, status="canceled")
    post_event(client, event(identity["sub"], entitlements=(), subscription=canceled))
    plan, sub = account_of(identity)
    assert plan == "free" and sub.status == "canceled" and sub.will_renew is False


def test_duplicate_event_id_is_acknowledged_once(client):
    identity = provision(client)
    payload = event(identity["sub"])
    assert post_event(client, payload).get_json()["status"] == "ok"

    # Same id again, even with different content: ignored.
    payload["data"]["entitlements"] = []
    payload["data"]["subscription"] = None
    res = post_event(client, payload)
    assert res.status_code == 200 and res.get_json() == {"status": "duplicate"}
    assert account_of(identity)[0] == "pro"
    with session_scope() as session:
        assert len(session.scalars(select(WebhookEvent)).all()) == 1


def test_unknown_identity_is_acknowledged_with_200(client):
    res = post_event(client, event(str(uuid.uuid4())))
    assert res.status_code == 200 and res.get_json() == {"status": "unknown_identity"}
    # Recorded for audit (and so a retry is a duplicate).
    with session_scope() as session:
        assert session.scalar(select(WebhookEvent)) is not None


def test_guest_payment_has_no_identity(client):
    res = post_event(client, event(None, type="payment.succeeded", entitlements=(), subscription=None))
    assert res.status_code == 200 and res.get_json()["status"] == "unknown_identity"


def test_other_app_is_ignored(client):
    identity = provision(client)
    res = post_event(client, event(identity["sub"], app="retro"))
    assert res.status_code == 200 and res.get_json()["status"] == "ignored"
    assert account_of(identity)[0] == "free"


def test_bad_signature_stale_timestamp_and_bad_body_are_400(client):
    identity = provision(client)
    payload = event(identity["sub"])
    assert post_event(client, payload, secret="whsec_other").status_code == 400
    assert post_event(client, payload, timestamp=int(time.time()) - 1000).status_code == 400
    body, headers = signed(payload)
    assert client.post("/api/billing/webhook", data=body + b" ", headers=headers).status_code == 400
    assert client.post("/api/billing/webhook", data=body, headers={"Content-Type": "application/json"}).status_code == 400
    assert account_of(identity)[0] == "free"
    with session_scope() as session:
        assert session.scalar(select(WebhookEvent)) is None


def test_lowercase_headers_are_accepted(client):
    identity = provision(client)
    body, headers = signed(event(identity["sub"]))
    lower = {k.lower(): v for k, v in headers.items()}
    assert client.post("/api/billing/webhook", data=body, headers=lower).status_code == 200
    assert account_of(identity)[0] == "pro"


def test_webhook_is_not_feature_gated(client, monkeypatch):
    import api.features as features

    monkeypatch.setattr(features, "is_enabled", lambda key, distinct_id="anonymous": False)
    identity = provision(client)
    assert post_event(client, event(identity["sub"])).status_code == 200
    assert account_of(identity)[0] == "pro"


# --- pull ----------------------------------------------------------------- #
class FakeClient:
    """Stands in for ``M4PayClient``: records the query, serves canned rows."""

    def __init__(self, rows):
        self.rows = rows
        self.calls: list[str | None] = []

    def subscriptions(self, updated_since=None):
        self.calls.append(updated_since)
        yield from self.rows


def reconcile_row(identity_id: str, **overrides) -> dict:
    row = {
        "id": PRO_SUB["id"],
        "app": "exp",
        "identity_id": identity_id,
        "email": "ana@example.com",
        "entitlement": "pro",
        "status": "active",
        "current_period_end": "2026-12-01T10:00:00Z",
        "cancel_at_period_end": False,
        "label": "Pro",
        "entitlements": ["pro"],
        "updated_at": "2026-11-01T10:00:00Z",
    }
    row.update(overrides)
    return row


def test_reconcile_applies_rows_and_counts(client, monkeypatch):
    identity = provision(client)
    other = provision(client)  # second identity on the same test client
    fake = FakeClient(
        [
            reconcile_row(identity["sub"]),
            reconcile_row(other["sub"], entitlement=None, status="canceled", entitlements=[]),
            reconcile_row(str(uuid.uuid4())),  # never signed in to exp
        ]
    )
    monkeypatch.setattr(worker, "payments_client", lambda: fake)

    counts = worker.reconcile_billing()
    assert counts == {"applied": 2, "changed": 1, "unknown": 1}
    assert fake.calls and fake.calls[0].endswith("Z")
    assert account_of(identity)[0] == "pro"
    plan, sub = account_of(other)
    assert plan == "free" and sub.status == "canceled"

    # Idempotent: a second run changes nothing.
    assert worker.reconcile_billing(client=fake) == {"applied": 2, "changed": 0, "unknown": 1}


def test_reconcile_skips_without_service_key(client, monkeypatch):
    monkeypatch.setattr(worker, "payments_client", lambda: None)
    assert worker.reconcile_billing() == {"skipped": 1}


def test_reconcile_survives_payments_outage(client, monkeypatch):
    from dbcore.m4pay import M4PayError

    class Down:
        def subscriptions(self, updated_since=None):
            raise M4PayError(503, "unavailable", "down")
            yield  # pragma: no cover

    assert worker.reconcile_billing(client=Down()) == {"error": 1}


def test_m4pay_client_is_built_from_config(monkeypatch):
    c = worker.payments_client()
    assert c is not None
    assert c.base_url == "http://payments-api-1:5000" and c.app == "exp"


# --- status --------------------------------------------------------------- #
def test_status_requires_session_and_reports_subscription(client):
    assert client.get("/api/billing/status").status_code == 401
    identity = provision(client)
    res = client.get("/api/billing/status")
    assert res.status_code == 200
    body = res.get_json()
    assert body["plan"] == "free" and body["subscription"] is None
    assert body["payments_url"] == "http://localhost:8086" and body["app"] == "exp"
    assert body["price_keys"]["pro"] == {"monthly": "pro_monthly", "annual": "pro_annual"}

    post_event(client, event(identity["sub"]))
    body = client.get("/api/billing/status").get_json()
    assert body["plan"] == "pro" and body["label"] == "Pro / Supporter"
    sub = body["subscription"]
    assert sub["active"] is True and sub["status"] == "active" and sub["period"] == "monthly"
    assert sub["id"] == PRO_SUB["id"] and sub["current_period_end"] == "2026-12-01T10:00:00Z"
    assert sub["will_renew"] is True

    post_event(client, event(identity["sub"], entitlements=(), subscription=None))
    assert client.get("/api/billing/status").get_json()["subscription"] is None


@pytest.mark.parametrize("entitlements,expected", [([], "free"), (["pro"], "pro"), (["team"], "team"), (["pro", "team"], "team"), (["other"], "free")])
def test_resolve_plan(entitlements, expected):
    from dbcore.plans import resolve_plan_from_entitlements

    assert resolve_plan_from_entitlements(entitlements) == expected
