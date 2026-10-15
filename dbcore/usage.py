"""Monthly usage metering.

One metered metric per account per calendar month: ``evaluations``, the number
of evaluation-API requests. It is a SOFT limit: the evaluation API keeps
answering past the plan cap (never break a running app); the overage shows up
in the dashboard and a single PostHog ``limit_reached {which: "evaluations"}``
event fires per period (``evaluations_limit_notified`` makes it one-shot).

Period = calendar month [first day, first day of next month).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import UsageCounter
from .plans import is_unlimited


def _today() -> date:
    return datetime.now(timezone.utc).date()


def period_bounds(on: date | None = None) -> tuple[date, date]:
    on = on or _today()
    start = on.replace(day=1)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def get_or_create_counter(session: Session, account_id, on: date | None = None) -> UsageCounter:
    start, end = period_bounds(on)
    stmt = select(UsageCounter).where(
        UsageCounter.account_id == account_id,
        UsageCounter.period_start == start,
    )
    counter = session.scalar(stmt)
    if counter is None:
        # Two workers may race on the first request of a month; the unique
        # constraint settles it and the loser simply re-reads the winner's row.
        try:
            with session.begin_nested():
                counter = UsageCounter(
                    account_id=account_id, period_start=start, period_end=end,
                    evaluations=0, evaluations_limit_notified=False,
                )
                session.add(counter)
                session.flush()
        except IntegrityError:
            counter = session.scalar(stmt)
    return counter


def meter_evaluation(session: Session, account_id, limit: int) -> bool:
    """Count one evaluation request. Returns True exactly once per period, the
    first time the counter reaches ``limit`` — the caller fires the PostHog
    event. Never blocks: the soft limit is reported, not enforced."""
    counter = get_or_create_counter(session, account_id)
    # Atomic SQL increment: evaluation traffic is concurrent by nature and a
    # read-modify-write in Python would lose counts across workers.
    total = session.scalar(
        update(UsageCounter)
        .where(UsageCounter.id == counter.id)
        .values(evaluations=UsageCounter.evaluations + 1)
        .returning(UsageCounter.evaluations)
    )
    if is_unlimited(limit) or total < limit:
        return False
    # Only the request that flips the flag gets to notify (one-shot).
    flipped = session.scalar(
        update(UsageCounter)
        .where(UsageCounter.id == counter.id, UsageCounter.evaluations_limit_notified.is_(False))
        .values(evaluations_limit_notified=True)
        .returning(UsageCounter.id)
    )
    return flipped is not None
