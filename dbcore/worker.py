"""Billing worker: reconciles exp's subscriptions with payments.3m4.net once a
day (the "pull" half of CONTRACT.md "Billing"; the push half is the signed
webhook in ``services/api/api/blueprints/billing.py``).

    python -m dbcore.worker              # loop forever (compose `worker` service)
    python -m dbcore.worker --reconcile  # pull every subscription changed in the
                                         # last RECONCILE_WINDOW from payments, exit

exp has no outbox (no mail, no outgoing webhooks), so this process does nothing
else; it exists so a missed or late push webhook cannot leave ``account.plan``
stale for more than a day.
"""
from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timedelta, timezone

from . import models  # noqa: F401  (register models)
from .billing_sync import account_for_identity, apply_entitlements
from .config import config
from .db import session_scope
from .m4pay import M4PayClient, M4PayError

log = logging.getLogger("exp.worker")

# Billing reconcile: pull the subscriptions payments changed in the last
# window, once per interval. The window overlaps the interval so a missed run
# or a late push is covered by the next one (snapshots are idempotent).
RECONCILE_INTERVAL_SECONDS = 24 * 60 * 60
RECONCILE_WINDOW = timedelta(days=2)
POLL_SECONDS = 60.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Billing reconcile (pull from payments.3m4.net)
# --------------------------------------------------------------------------- #
def payments_client() -> M4PayClient | None:
    """The service-key client, or None when billing / the key is not configured."""
    if not config.billing_enabled or not config.payments_service_key:
        return None
    return M4PayClient(config.payments_internal_url, app=config.payments_app, service_key=config.payments_service_key)


def reconcile_billing(updated_since: datetime | None = None, client: M4PayClient | None = None) -> dict:
    """Pull every subscription of the app changed since ``updated_since``
    (default: the last ``RECONCILE_WINDOW``) and apply each snapshot with the
    same code path as the push webhook. Returns counts: ``applied`` (rows
    matched to an exp account), ``changed`` (plan flips), ``unknown`` (identities
    that never signed in here), ``skipped`` (not configured) and ``error``.
    """
    client = client or payments_client()
    if client is None:
        log.info("billing reconcile skipped: PAYMENTS_SERVICE_KEY not configured")
        return {"skipped": 1}
    since = (updated_since or (_now() - RECONCILE_WINDOW)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    counts = {"applied": 0, "changed": 0, "unknown": 0}
    try:
        rows = list(client.subscriptions(updated_since=since))
    except (M4PayError, OSError) as err:  # requests exceptions are OSError subclasses
        log.warning("billing reconcile failed: %s", err)
        return {"error": 1}
    for row in rows:
        with session_scope() as session:
            account = account_for_identity(session, row.get("identity_id"))
            if account is None:
                counts["unknown"] += 1
                continue
            result = apply_entitlements(session, account, row)
            counts["applied"] += 1
            if result["plan"] != result["previous_plan"]:
                counts["changed"] += 1
                log.info("billing reconcile: account %s %s -> %s", account.id, result["previous_plan"], result["plan"])
    log.info("billing reconcile since %s: %s", since, counts)
    return counts


# --------------------------------------------------------------------------- #
# Entrypoint
# --------------------------------------------------------------------------- #
def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log.info("exp worker starting (billing %s)", "on" if payments_client() else "off")
    if "--reconcile" in argv:
        counts = reconcile_billing()
        log.info("reconciled: %s", counts)
        return 0 if "error" not in counts else 1
    last_reconcile = 0.0
    while True:
        try:
            if time.time() - last_reconcile > RECONCILE_INTERVAL_SECONDS:
                reconcile_billing()
                last_reconcile = time.time()
        except Exception:  # pragma: no cover - keep the loop alive
            log.exception("worker loop error")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
