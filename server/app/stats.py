"""Derive the numbers we are willing to trust from the rows themselves.

These totals used to be computed in the browser (`profileRow` in app.js) and
uploaded next to the study data, which meant anyone could edit localStorage and
post an arbitrary XP figure. Now the client sends study data and the arithmetic
happens here.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

log = logging.getLogger(__name__)


def studied_days(day_rows: Iterable[dict[str, Any]]) -> list[date]:
    """Days on which the learner actually graded something.

    A `study_days` row is written on every app boot — `buildTodaySet` in app.js
    creates today's row and saves it before anything is graded. So rows with an
    empty `graded` object are routine, and counting them would hand out streak
    credit for merely opening the app.
    """
    days: set[date] = set()
    for row in day_rows:
        if not row.get("graded"):
            continue
        raw = row.get("day")
        if not raw:
            continue
        try:
            days.add(date.fromisoformat(str(raw)[:10]))
        except ValueError:
            log.warning("skipping unparseable study_days.day %r", raw)
    return sorted(days)


def current_streak(days: list[date]) -> int:
    """Consecutive studied days ending at the most recent one.

    Deliberately *not* "the run ending today". The client's rule is incremental —
    the streak grows when a card is graded and does not decay just because a day
    passed without one — so this measures the run ending at the latest studied
    day. Measuring from today instead would show 0 every morning and make the
    number jump around for reasons the learner did not cause.

    Input order doesn't matter; it's sorted here so an out-of-order list can't
    quietly produce a wrong streak.
    """
    if not days:
        return 0
    ordered = sorted(days)
    day_set = set(ordered)
    run = 1
    cursor = ordered[-1]
    while cursor - timedelta(days=1) in day_set:
        cursor -= timedelta(days=1)
        run += 1
    return run


def longest_streak(days: list[date]) -> int:
    """The longest run anywhere in the history."""
    if not days:
        return 0
    ordered = sorted(days)
    best = run = 1
    for previous, current in zip(ordered, ordered[1:]):
        run = run + 1 if current - previous == timedelta(days=1) else 1
        best = max(best, run)
    return best


def build_profile(
    *,
    user_id: str,
    email: str | None,
    level: str | None,
    card_rows: list[dict[str, Any]],
    day_rows: list[dict[str, Any]],
    last_seen_at: str | None = None,
) -> dict[str, Any]:
    """Build the authoritative `profiles` row.

    XP keeps the formula the client has always used — 50 per kanji in memory, 10
    per review — because the study data feeding it is unchanged. The only thing
    that differs is that callers can no longer choose the inputs.
    """
    graded = len(card_rows)
    reviewed = sum(int(row.get("reps") or 0) for row in card_rows)
    days = studied_days(day_rows)

    return {
        "id": user_id,
        "email": email,
        "level": level or "N4",
        "xp": graded * 50 + reviewed * 10,
        "streak": current_streak(days),
        "longest_streak": longest_streak(days),
        "kanji_graded": graded,
        # Was `len(daily.days)` on the client, which counted every app boot.
        "days_active": len(days),
        "last_active": days[-1].isoformat() if days else None,
        "last_seen_at": last_seen_at or datetime.now(timezone.utc).isoformat(),
    }