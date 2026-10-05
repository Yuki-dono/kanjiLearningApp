"""The client can't be exercised in a browser here, so these cover the two things
that broke in practice: the server not being where the page came from, and the
UI claiming success when a sync actually failed.
"""

from __future__ import annotations

import re

import pytest
from conftest import USER_A

pytestmark = pytest.mark.anyio

REPO_FILES = ("app.js", "api.js", "config.js")


def read(repo_root, name: str) -> str:
    return (repo_root / name).read_text(encoding="utf-8")


def combined(repo_root) -> str:
    return "\n".join(read(repo_root, name) for name in REPO_FILES)


# --------------------------------------------------------------------------
# server detection
# --------------------------------------------------------------------------


async def test_health_endpoint_needs_no_token(client):
    """The probe runs before anyone signs in, so it can't require a token."""
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


async def test_client_probes_health_before_syncing(repo_root):
    source = combined(repo_root)
    assert "apiHealth" in source, "client no longer checks whether the API is reachable"

    # The probe has to happen before the first sync attempt, not after.
    assert re.search(r"await apiHealth\(\)", source), "apiHealth is never awaited"


async def test_unreachable_api_is_not_reported_as_an_ordinary_error(repo_root):
    """It gets its own status so the UI can say something useful."""
    source = read(repo_root, "app.js")
    assert "nobackend" in source
    assert re.search(r'"nobackend"|\bnobackend\b', source)


def test_api_base_defaults_to_same_origin(repo_root):
    assert re.search(r'API_BASE:\s*""', read(repo_root, "config.js"))


def test_config_js_documents_the_split_hosting_trap(repo_root):
    """The 404-on-GitHub-Pages case cost a debugging round trip once."""
    config = read(repo_root, "config.js")
    assert "API_BASE" in config
    assert "404" in config, "config.js should warn that the wrong origin 404s"


# --------------------------------------------------------------------------
# honesty about failures
# --------------------------------------------------------------------------


def test_sign_in_does_not_unconditionally_report_success(repo_root):
    """Signing in succeeding says nothing about the sync that follows."""
    source = read(repo_root, "app.js")
    assert "setSync(ok ? \"ready\" : syncFailedStatus());" in source


def test_sync_now_uses_the_derived_failure_status(repo_root):
    source = read(repo_root, "app.js")
    assert "setSync(syncFailedStatus())" in source
    # The old unconditional version is what let a 404 read as success.
    assert "setSync(SYNC.dirty ? \"error\" : \"ready\")" not in source


def test_a_missing_server_is_named_in_the_error_text(repo_root):
    source = read(repo_root, "app.js")
    assert "NO_SERVER_HELP" in source
    assert "localhost:8000" in source, "the message should point at the API server"


def test_client_still_has_no_direct_table_access(repo_root):
    """Everything goes through the API now."""
    source = read(repo_root, "app.js")
    assert "client.from(" not in source
    assert ".eq(" not in source
    assert not re.search(r"user_id:\s*supaUser", source), "the client must not send a user id"