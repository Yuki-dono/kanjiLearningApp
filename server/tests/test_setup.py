"""The setup-diagnostic endpoint, and the missing-table error mapping.

The failure this exists for is specific: the schema was never applied, so every
PostgREST call 404s with PGRST205. Before this was handled explicitly it surfaced
as a generic "Not found." and cost a debugging round trip to identify.
"""

from __future__ import annotations

import httpx
import pytest
from conftest import USER_A

pytestmark = pytest.mark.anyio

TABLES = ["custom_words", "profiles", "quiz_scores", "srs_cards", "study_days", "study_settings"]


def pgrst205() -> httpx.Response:
    return httpx.Response(
        404,
        json={
            "code": "PGRST205",
            "details": None,
            "hint": None,
            "message": "Could not find the table 'public.srs_cards' in the schema cache",
        },
    )


def undefined_table() -> httpx.Response:
    return httpx.Response(
        404,
        json={"code": "42P01", "message": 'relation "public.srs_cards" does not exist'},
    )


# --------------------------------------------------------------------------
# error mapping
# --------------------------------------------------------------------------


def test_missing_table_says_the_actual_fix():
    """A generic 404 here sends people looking in the wrong place."""
    from app.supabase import _map_error

    for response in (pgrst205(), undefined_table()):
        error = _map_error(response)
        assert error.status_code == 404
        assert "supabase-schema.sql" in error.public
        assert "SQL Editor" in error.public


def test_an_ordinary_404_is_still_generic():
    from app.supabase import _map_error

    error = _map_error(httpx.Response(404, json={"code": "PGRST202", "message": "No rows found"}))
    assert error.status_code == 404
    assert "supabase-schema" not in error.public


def test_bad_credentials_are_reported_as_server_side():
    """A wrong service_role key is our misconfiguration, not the caller's fault."""
    from app.supabase import _map_error

    error = _map_error(httpx.Response(401, json={"message": "invalid JWT"}))
    assert error.status_code == 503
    assert "misconfigured" in error.public


def test_the_error_message_never_echoes_database_internals():
    from app.supabase import _map_error

    secret = "column srs_cards.user_id does not exist"
    error = _map_error(httpx.Response(400, json={"code": "42703", "message": secret}))
    assert secret not in error.public


# --------------------------------------------------------------------------
# diagnose endpoint
# --------------------------------------------------------------------------


async def test_diagnose_requires_a_token(client):
    assert (await client.get("/api/diagnose")).status_code == 401


async def test_diagnose_reports_every_table_as_ok_when_the_schema_is_applied(
    client, auth_header, fake_postgrest
):
    for table in TABLES:
        fake_postgrest.seed(table, {"user_id": USER_A, "id": 1})

    body = (await client.get("/api/diagnose", headers=auth_header())).json()

    assert body["ok"] is True
    assert body["missing"] == []
    assert sorted(body["tables"]) == TABLES
    assert all(state == "ok" for state in body["tables"].values())
    assert body["next_step"] is None


async def test_diagnose_names_the_missing_tables(client, auth_header, fake_postgrest):
    fake_postgrest.missing_tables = {"srs_cards", "study_days"}
    body = (await client.get("/api/diagnose", headers=auth_header())).json()

    assert body["ok"] is False
    assert body["missing"] == ["srs_cards", "study_days"]
    assert "supabase-schema.sql" in body["next_step"]
    assert body["tables"]["srs_cards"].startswith("missing")


async def test_diagnose_reports_which_project_it_is_pointed_at(client, auth_header):
    """The failure that looks identical to every other: wrong Supabase project."""
    body = (await client.get("/api/diagnose", headers=auth_header())).json()
    assert body["supabase_project"] == "project-test"


async def test_health_reports_the_project_ref(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["supabase_project"] == "project-test"


async def test_diagnose_does_not_return_any_user_data(client, auth_header, fake_postgrest):
    fake_postgrest.seed("srs_cards", {"user_id": USER_A, "character": "字", "reps": 3})
    body = (await client.get("/api/diagnose", headers=auth_header())).json()
    assert "字" not in str(body)
    assert "reps" not in str(body)