"""Test fixtures: a real Postgres (``TEST_DATABASE_URL``), tables truncated
before every test, the rate limiter on ``memory://``, PostHog off, feature
switches at their self-host defaults, a throwaway Ed25519 JWKS so
:func:`session_cookie` can mint accounts sessions the API accepts, and the
payments secrets the billing tests sign with.

Environment must be set BEFORE ``dbcore`` is imported: its config is frozen
at import time.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
for p in (ROOT, ROOT / "services" / "api"):
    sys.path.insert(0, str(p))

_db_url = (
    os.environ.get("TEST_DATABASE_URL")
    or os.environ.get("DATABASE_URL")
    or "postgresql+psycopg://exp:exp@localhost:55434/exp_test"
)
os.environ["DATABASE_URL"] = _db_url
os.environ["REDIS_URL"] = "memory://"
os.environ["POSTHOG_API_KEY"] = ""
os.environ["POSTHOG_PERSONAL_API_KEY"] = ""
os.environ["FEATURE_FLAG_OVERRIDES"] = ""
os.environ["MAIL_ENABLED"] = "false"
os.environ["BILLING_ENABLED"] = "true"
os.environ.setdefault("ACCOUNTS_URL", "http://localhost:8085")
os.environ.setdefault("ACCOUNTS_INTERNAL_URL", "http://accounts-api-1:5000")
os.environ["PAYMENTS_URL"] = "http://localhost:8086"
os.environ["PAYMENTS_INTERNAL_URL"] = "http://payments-api-1:5000"
os.environ["PAYMENTS_SERVICE_KEY"] = "m4pay_sk_test_key"
os.environ["PAYMENTS_WEBHOOK_SECRET"] = "whsec_m4pay_test_secret"

import jwt
import pytest
from api.app import create_app
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import text

from dbcore import m4session, models  # noqa: F401
from dbcore.config import config
from dbcore.db import Base, engine

# Tenant roots: ON DELETE CASCADE takes everything hanging off them.
TABLES = ("webhook_events", "accounts", "users")

# --- fake accounts JWKS --------------------------------------------------- #
_PRIVATE = Ed25519PrivateKey.generate()
_PUBLIC = _PRIVATE.public_key()
KID = "test-kid"
JWKS_URL = f"{config.accounts_internal_url}/.well-known/jwks.json"
_PEM = _PRIVATE.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
)


def _install_jwks() -> None:
    """Pre-populate m4session's cache so it never fetches."""
    m4session._cache._keys[JWKS_URL] = {"fetched": time.time() + 10**9, "keys": {KID: _PUBLIC}}


def make_identity(**overrides) -> dict:
    sub = overrides.pop("sub", None) or str(uuid.uuid4())
    identity = {
        "sub": sub,
        "sid": str(uuid.uuid4()),
        "email": f"{sub[:8]}@example.com",
        "email_verified": True,
        "handle": f"user{sub[:6]}",
        "name": "Ana Test",
        "avatar_url": f"{config.accounts_url}/avatars/{sub}",
    }
    identity.update(overrides)
    return identity


def session_token(identity: dict, *, ttl: int = 900) -> str:
    now = int(time.time())
    claims = {**identity, "iat": now, "exp": now + ttl, "iss": config.accounts_url, "aud": "3m4"}
    return jwt.encode(claims, _PEM, algorithm="EdDSA", headers={"kid": KID})


def session_cookie(client, identity: dict) -> dict:
    """Set the ``3m4_session`` cookie on ``client`` and return the identity."""
    client.set_cookie(m4session.COOKIE_NAME, session_token(identity), domain="localhost")
    return identity


# --- fixtures ------------------------------------------------------------- #
@pytest.fixture(scope="session")
def app():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    _install_jwks()
    application = create_app()
    application.config["TESTING"] = True
    yield application


@pytest.fixture
def client(app):
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))
    return app.test_client()
