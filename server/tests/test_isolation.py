"""Cross-account isolation.

The service_role key bypasses row-level security, so nothing but this code stops
one account from reading or overwriting another's rows. These tests are the
regression net for that, and they assert on what actually went over the wire —
not just on what the endpoint returned.
"""

from __future__ import annotations

import json

import pytest
from conftest import COMPOSITE_KEYS, USER_A, USER_B

from app.supabase import SupabaseREST

pytestmark = pytest.mark.anyio

PUSH_BODY = {
    "full": False,
    "srs": [{"character": "字", "level": "N4", "reps": 3, "lapses": 0, "ease": 2.5, "interval": 2, "due": "2026-10-05"}],
    "days": [{"day": "2026-10-05", "new_chars": ["字"], "graded": {"字": "good"}}],
    "custom_words": [{"word": "文字", "reading": "もじ", "meaning": "characters", "parts": ""}],
    "settings": {"level": "N4", "goal": 5, "scope": ["N5", "N4"], "updated_at": "2026-10-05T00:00:00Z"},
}


def owner_of(table: str) -> str:
    return "id" if table == "profiles" else "user_id"


def assert_every_request_scoped(fake, user_id: str) -> None:
    """No request may touch a table without being pinned to `user_id`."""
    assert fake.calls, "expected the request to reach PostgREST"
    for request in fake.calls:
        table = request.url.path.rsplit("/", 1)[-1]
        label = f"{request.method} {table}"

        if request.method in ("GET", "HEAD", "DELETE"):
            filters = [v for v in request.url.params.values() if str(v).startswith("eq.")]
            assert f"eq.{user_id}" in filters, f"{label} was not filtered to the caller"

        if request.method in ("POST", "PATCH"):
            body = json.loads(request.content or b"null")
            rows = body if isinstance(body, list) else [body]
            column = owner_of(table)
            for row in rows:
                assert row.get(column) == user_id, f"{label} wrote a row owned by {row.get(column)!r}"


# --------------------------------------------------------------------------
# writes
# --------------------------------------------------------------------------


async def test_push_stores_rows_under_the_caller(client, auth_header, fake_postgrest):
    response = await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))
    assert response.status_code == 200

    cards = fake_postgrest.rows("srs_cards")
    assert len(cards) == 1
    assert cards[0]["user_id"] == USER_A
    assert_every_request_scoped(fake_postgrest, USER_A)


async def test_forged_user_id_in_the_body_is_refused(client, auth_header, fake_postgrest):
    """`extra="forbid"` rejects it at the edge."""
    body = dict(PUSH_BODY, srs=[dict(PUSH_BODY["srs"][0], user_id=USER_B)])
    response = await client.post("/api/sync/push", json=body, headers=auth_header(USER_A))
    assert response.status_code == 422
    assert fake_postgrest.requests_for("srs_cards") == []


def test_stamp_owner_overwrites_any_claimed_owner() -> None:
    """The backstop behind `extra="forbid"`, if a row ever gets that far."""
    stamped = SupabaseREST._stamp_owner("srs_cards", [{"character": "字", "user_id": USER_B}], USER_A)
    assert stamped == [{"character": "字", "user_id": USER_A}]

    profiles = SupabaseREST._stamp_owner("profiles", [{"id": USER_B, "xp": 9999}], USER_A)
    assert profiles == [{"id": USER_A, "xp": 9999}]


async def test_unknown_table_is_refused_before_any_request():
    """The allow-list is not advisory, and it runs before any I/O."""
    import httpx

    from app.config import get_settings

    rest = SupabaseREST(get_settings(), httpx.AsyncClient())
    with pytest.raises(ValueError, match="unknown table"):
        rest._url("profiles; DROP TABLE srs_cards")
    with pytest.raises(ValueError, match="unknown table"):
        rest._url("auth.users")


# --------------------------------------------------------------------------
# reads
# --------------------------------------------------------------------------


async def test_pull_returns_only_the_callers_rows(client, auth_header, fake_postgrest):
    fake_postgrest.seed("srs_cards", {"user_id": USER_A, "character": "字", "reps": 3})
    fake_postgrest.seed("srs_cards", {"user_id": USER_B, "character": "漢", "reps": 9})

    response = await client.get("/api/sync/pull", headers=auth_header(USER_A))
    assert response.status_code == 200
    body = response.json()

    assert [row["character"] for row in body["srs"]] == ["字"]
    assert all(row["user_id"] != USER_B for row in body["srs"])


async def test_pull_as_b_never_sees_user_a(client, auth_header, fake_postgrest):
    fake_postgrest.seed("study_days", {"user_id": USER_A, "day": "2026-10-05", "graded": {"字": "good"}})
    fake_postgrest.seed("custom_words", {"user_id": USER_A, "word": "文字", "reading": "もじ"})

    body = (await client.get("/api/sync/pull", headers=auth_header(USER_B))).json()

    assert body["days"] == []
    assert body["custom_words"] == []


async def test_quiz_count_is_scoped(client, auth_header, fake_postgrest):
    fake_postgrest.seed("quiz_scores", {"id": 1, "user_id": USER_A, "mode": "kanji", "score": 1, "total": 1, "pct": 100})
    body = (await client.get("/api/sync/pull", headers=auth_header(USER_B))).json()
    assert body["quiz_total"] == 0


# --------------------------------------------------------------------------
# collisions and deletes
# --------------------------------------------------------------------------


async def test_two_accounts_can_hold_the_same_character(client, auth_header, fake_postgrest):
    """Same kanji, two users, two rows — an upsert must not collide across users."""
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_B))

    rows = fake_postgrest.rows("srs_cards")
    assert len(rows) == 2
    assert {row["user_id"] for row in rows} == {USER_A, USER_B}
    assert {row["character"] for row in rows} == {"字"}


async def test_repeated_push_does_not_duplicate(client, auth_header, fake_postgrest):
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))

    assert len(fake_postgrest.rows("srs_cards")) == 1
    assert len(fake_postgrest.rows("study_days")) == 1
    assert len(fake_postgrest.rows("profiles")) == 1


async def test_wipe_leaves_the_other_account_alone(client, auth_header, fake_postgrest):
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_B))

    response = await client.post("/api/sync/wipe", headers=auth_header(USER_A))
    assert response.status_code == 200

    assert [row["user_id"] for row in fake_postgrest.rows("srs_cards")] == [USER_B]
    assert [row["user_id"] for row in fake_postgrest.rows("study_days")] == [USER_B]
    assert [row["user_id"] for row in fake_postgrest.rows("custom_words")] == [USER_B]
    assert [row["id"] for row in fake_postgrest.rows("profiles")] == [USER_A, USER_B]


async def test_wipe_keeps_study_settings(client, auth_header, fake_postgrest):
    """Resetting history shouldn't reset someone's course."""
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))
    await client.post("/api/sync/wipe", headers=auth_header(USER_A))
    assert fake_postgrest.rows("study_settings")


# --------------------------------------------------------------------------
# credentials on the wire
# --------------------------------------------------------------------------


async def test_outbound_requests_use_the_service_role_key(client, auth_header, fake_postgrest):
    from app.config import get_settings

    settings = get_settings()
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))

    assert fake_postgrest.calls
    for request in fake_postgrest.calls:
        assert request.headers["apikey"] == settings.supabase_service_role_key
        assert request.headers["authorization"] == f"Bearer {settings.supabase_service_role_key}"


async def test_the_callers_token_is_never_forwarded(client, auth_header, fake_postgrest, token_factory):
    """A user token reaching PostgREST would be RLS's job to reject; we don't want it there at all."""
    token = token_factory(USER_A)
    await client.post("/api/sync/push", json=PUSH_BODY, headers=auth_header(USER_A))

    for request in fake_postgrest.calls:
        assert token not in request.headers.get("authorization", "")
        assert USER_A not in request.headers.get("authorization", "")


def test_primary_keys_match_the_sql_schema() -> None:
    """Guards the fake itself: if these drift, the isolation tests quietly weaken."""
    assert COMPOSITE_KEYS["profiles"] == ("id",)
    assert COMPOSITE_KEYS["srs_cards"] == ("user_id", "character")
    assert COMPOSITE_KEYS["study_days"] == ("user_id", "day")
    assert COMPOSITE_KEYS["custom_words"] == ("user_id", "word")