"""Endpoint behaviour and the merge rules from architecture.html."""

from __future__ import annotations

import pytest
from conftest import USER_A, USER_B

pytestmark = pytest.mark.anyio

CARD = {"character": "字", "level": "N4", "reps": 3, "lapses": 0, "ease": 2.5, "interval": 2, "due": "2026-10-05"}
DAY = {"day": "2026-10-05", "new_chars": ["字"], "graded": {"字": "good"}}
SETTINGS = {"level": "N4", "goal": 5, "scope": ["N5", "N4"], "updated_at": "2026-10-05T00:00:00Z"}


async def push(client, headers, **body):
    return await client.post("/api/sync/push", json=body, headers=headers)


# --------------------------------------------------------------------------
# push
# --------------------------------------------------------------------------


async def test_push_reports_server_computed_stats(client, auth_header, fake_postgrest):
    response = await push(
        client, auth_header(), srs=[CARD], days=[DAY], settings=SETTINGS
    )
    assert response.status_code == 200
    stats = response.json()["stats"]

    assert stats["xp"] == 50 + 30           # one kanji, three reviews
    assert stats["kanji_graded"] == 1
    assert stats["days_active"] == 1
    assert stats["streak"] == 1
    assert stats["last_active"] == "2026-10-05"


async def test_push_ignores_client_reported_totals(client, auth_header):
    """The whole point: the client no longer gets a vote on the numbers.

    `extra="forbid"` means it can't even send them — this pins that down.
    """
    response = await push(
        client,
        auth_header(),
        srs=[CARD],
        days=[DAY],
        stats={"xp": 999_999, "streak": 3650},
    )
    assert response.status_code == 422


async def test_empty_push_is_still_valid(client, auth_header, fake_postgrest):
    response = await push(client, auth_header())
    assert response.status_code == 200
    assert response.json()["stats"]["xp"] == 0


async def test_srs_is_chunked_at_500(client, auth_header, fake_postgrest):
    cards = [dict(CARD, character=f"字{i:04d}") for i in range(1100)]
    response = await push(client, auth_header(), srs=cards)
    assert response.status_code == 200

    posts = [r for r in fake_postgrest.requests_for("srs_cards") if r.method == "POST"]
    assert len(posts) == 3           # 500 + 500 + 100
    assert sum(len(r.read()) for r in posts) > 0
    assert len(fake_postgrest.rows("srs_cards")) == 1100


async def test_quiz_scores_are_append_only(client, auth_header, fake_postgrest):
    """Quiz history is a log — re-pushing adds a row rather than overwriting."""
    attempt = {"mode": "kanji", "scope": ["N4"], "learned": False, "score": 8, "total": 10, "pct": 80}
    await push(client, auth_header(), quiz_scores=[attempt])
    await push(client, auth_header(), quiz_scores=[attempt])

    rows = fake_postgrest.rows("quiz_scores")
    assert len(rows) == 2
    assert len({row["id"] for row in rows}) == 2


async def test_full_flag_does_not_change_what_is_stored(client, auth_header, fake_postgrest):
    await push(client, auth_header(), full=True, srs=[CARD], days=[DAY])
    assert len(fake_postgrest.rows("srs_cards")) == 1
    assert len(fake_postgrest.rows("study_days")) == 1


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------


async def test_unknown_grade_is_rejected(client, auth_header):
    response = await push(client, auth_header(), days=[{"day": "2026-10-05", "graded": {"字": "excellent"}}])
    assert response.status_code == 422


async def test_vocabulary_without_a_reading_is_accepted(client, auth_header, fake_postgrest):
    """163 of the 662 N5 vocab entries in data/ have no reading."""
    response = await push(
        client, auth_header(), custom_words=[{"word": "明後日", "reading": "", "meaning": "day after tomorrow", "parts": ""}]
    )
    assert response.status_code == 200
    assert fake_postgrest.rows("custom_words")[0]["reading"] == ""


async def test_absurd_counts_are_rejected(client, auth_header):
    response = await push(client, auth_header(), srs=[dict(CARD, reps=10**9)])
    assert response.status_code == 422


async def test_too_many_rows_is_rejected(client, auth_header):
    response = await push(client, auth_header(), srs=[CARD] * 6000)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "settings,expected",
    [
        ({"level": "N3", "goal": 8, "scope": ["N3"]}, {"level": "N3", "goal": 8, "scope": ["N3"]}),
        # An old localStorage can hold nonsense; sync shouldn't fail over it.
        ({"level": "nonsense", "goal": 999, "scope": ["N5", "bogus"]}, {"level": "N4", "goal": 20, "scope": ["N5"]}),
        ({"level": "N4", "goal": 1, "scope": []}, {"level": "N4", "goal": 3, "scope": []}),
    ],
)
async def test_settings_are_coerced_not_rejected(client, auth_header, fake_postgrest, settings, expected):
    body = dict(settings, updated_at=SETTINGS["updated_at"])
    response = await push(client, auth_header(), settings=body)
    assert response.status_code == 200

    stored = fake_postgrest.rows("study_settings")[0]
    for field, value in expected.items():
        assert stored[field] == value


async def test_unknown_field_is_rejected(client, auth_header):
    response = await push(client, auth_header(), srs=[dict(CARD, surprise=1)])
    assert response.status_code == 422


# --------------------------------------------------------------------------
# pull
# --------------------------------------------------------------------------


async def test_pull_returns_everything_the_caller_stored(client, auth_header, fake_postgrest):
    await push(
        client,
        auth_header(),
        srs=[CARD],
        days=[DAY],
        custom_words=[{"word": "文字", "reading": "もじ", "meaning": "characters", "parts": ""}],
        quiz_scores=[{"mode": "kanji", "scope": ["N4"], "learned": False, "score": 8, "total": 10, "pct": 80}],
        settings=SETTINGS,
    )

    body = (await client.get("/api/sync/pull", headers=auth_header())).json()

    assert body["settings"]["level"] == "N4"
    assert body["srs"][0]["character"] == "字"
    assert body["days"][0]["graded"] == {"字": "good"}
    assert body["custom_words"][0]["word"] == "文字"
    assert body["recent_quiz"]["pct"] == 80
    assert body["quiz_total"] == 1
    assert body["profile"]["xp"] == 80


async def test_pull_carries_the_full_stats_set(client, auth_header):
    """A pull on its own has to be enough to repaint the account panel."""
    await push(client, auth_header(), srs=[CARD], days=[DAY])
    profile = (await client.get("/api/sync/pull", headers=auth_header())).json()["profile"]

    for field in ("xp", "streak", "longest_streak", "kanji_graded", "days_active", "last_active"):
        assert field in profile, f"pull omitted {field}"


async def test_pull_of_a_fresh_account_is_empty_not_an_error(client, auth_header):
    body = (await client.get("/api/sync/pull", headers=auth_header(USER_B))).json()
    assert body["srs"] == []
    assert body["settings"] is None
    assert body["profile"] is None


async def test_me_stats_reports_the_stored_row(client, auth_header):
    await push(client, auth_header(), srs=[CARD], days=[DAY])
    body = (await client.get("/api/me/stats", headers=auth_header())).json()
    assert body["xp"] == 80
    assert body["kanji_graded"] == 1
    assert body["streak"] == 1


async def test_me_stats_for_an_account_that_never_synced(client, auth_header):
    body = (await client.get("/api/me/stats", headers=auth_header(USER_B))).json()
    assert body["xp"] == 0
    assert body["streak"] == 0


# --------------------------------------------------------------------------
# wipe
# --------------------------------------------------------------------------


async def test_wipe_zeroes_the_profile(client, auth_header, fake_postgrest):
    await push(client, auth_header(), srs=[CARD], days=[DAY])
    await client.post("/api/sync/wipe", headers=auth_header())

    profile = fake_postgrest.rows("profiles")[0]
    assert profile["xp"] == 0
    assert profile["streak"] == 0
    assert profile["kanji_graded"] == 0
    assert profile["days_active"] == 0
    assert profile["last_active"] is None
    assert profile["id"] == USER_A       # the row survives, just zeroed