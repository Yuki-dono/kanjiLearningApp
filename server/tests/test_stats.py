"""Recomputed stats — the numbers that used to be reported by the client."""

from __future__ import annotations

from datetime import date, timedelta

from app.stats import build_profile, current_streak, longest_streak, studied_days

BASE = date(2026, 10, 5)


def day(offset: int) -> str:
    return (BASE + timedelta(days=offset)).isoformat()


def graded(offset: int, character: str = "字") -> dict:
    return {"day": day(offset), "new_chars": [character], "graded": {character: "good"}}


def test_a_day_with_no_grades_is_not_a_studied_day() -> None:
    """App boots write an empty row every day; counting those would be wrong."""
    rows = [
        {"day": day(0), "new_chars": ["字"], "graded": {"字": "good"}},
        {"day": day(1), "new_chars": ["字"], "graded": {}},
        {"day": day(2), "graded": None},
        {"day": day(3)},
    ]
    assert studied_days(rows) == [BASE]


def test_streak_counts_a_consecutive_run() -> None:
    days = [BASE - timedelta(days=n) for n in range(3)]
    assert current_streak(days) == 3


def test_streak_stops_at_a_gap() -> None:
    days = [BASE - timedelta(days=n) for n in (0, 1, 3, 4)]
    assert current_streak(days) == 2


def test_streak_survives_a_day_you_havent_studied_yet() -> None:
    """It must not read 0 every morning before you've done anything.

    The client grows the streak when a card is graded and doesn't decay just
    because a day passed, so the number ending at the last studied day is the
    one to show.
    """
    days = [BASE - timedelta(days=n) for n in (1, 2, 3)]
    assert current_streak(days) == 3


def test_streak_of_one_day() -> None:
    assert current_streak([BASE]) == 1


def test_streak_of_nothing() -> None:
    assert current_streak([]) == 0
    assert longest_streak([]) == 0


def test_streaks_do_not_depend_on_input_order() -> None:
    """Out-of-order input must not quietly produce a wrong streak."""
    # Sorted: Sep 30, Oct 1, Oct 2, Oct 5 — a 3-day run ending 3 days ago.
    days = [BASE - timedelta(days=n) for n in (0, 3, 4, 5)]
    for ordering in (days, list(reversed(days)), sorted(days)):
        assert current_streak(ordering) == 1
        assert longest_streak(ordering) == 3


def test_longest_streak_finds_an_earlier_longer_run() -> None:
    days = [
        BASE - timedelta(days=n) for n in (0, 4, 5, 6, 7, 8, 12)
    ]
    assert longest_streak(days) == 5
    assert current_streak(days) == 1


def test_longest_streak_across_a_full_history() -> None:
    days = [BASE - timedelta(days=n) for n in range(10)]
    assert longest_streak(days) == 10
    assert current_streak(days) == 10


def test_unparseable_day_is_skipped_not_fatal() -> None:
    rows = [graded(0), {"day": "not-a-date", "graded": {"字": "good"}}]
    assert studied_days(rows) == [BASE]


# --------------------------------------------------------------------------
# the whole profile row
# --------------------------------------------------------------------------


def test_xp_matches_the_formula_the_client_always_used() -> None:
    profile = build_profile(
        user_id="u1",
        email="a@example.com",
        level="N4",
        card_rows=[{"reps": 3}, {"reps": 0}, {"reps": 7}],
        day_rows=[graded(0), graded(1)],
    )
    assert profile["xp"] == 3 * 50 + 10 * 10
    assert profile["kanji_graded"] == 3
    assert profile["days_active"] == 2
    assert profile["streak"] == 2


def test_days_active_ignores_app_boot_rows() -> None:
    profile = build_profile(
        user_id="u1",
        email=None,
        level="N4",
        card_rows=[],
        day_rows=[
            {"day": day(0), "graded": {"字": "good"}},
            {"day": day(1), "graded": {}},
            {"day": day(2), "graded": {}},
        ],
    )
    assert profile["days_active"] == 1


def test_last_active_is_the_most_recent_studied_day() -> None:
    profile = build_profile(
        user_id="u1",
        email=None,
        level="N4",
        card_rows=[],
        day_rows=[graded(0), graded(-2)],
    )
    assert profile["last_active"] == day(0)


def test_empty_account_reports_zeroes_not_errors() -> None:
    profile = build_profile(
        user_id="u1", email=None, level=None, card_rows=[], day_rows=[]
    )
    assert profile["xp"] == 0
    assert profile["streak"] == 0
    assert profile["kanji_graded"] == 0
    assert profile["days_active"] == 0
    assert profile["last_active"] is None
    assert profile["level"] == "N4"


def test_level_comes_from_settings() -> None:
    profile = build_profile(
        user_id="u1", email=None, level="N3", card_rows=[], day_rows=[]
    )
    assert profile["level"] == "N3"