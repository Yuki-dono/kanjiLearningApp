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


def test_api_address_is_derived_from_the_hostname(repo_root):
    """One committed config has to work on localhost and on the deployed site."""
    source = read(repo_root, "app.js")
    assert "LOCAL_HOSTS" in source
    assert "location.hostname" in source
    assert "CFG.API_URL" in source


def test_config_js_documents_the_split_hosting_trap(repo_root):
    """The 404-on-GitHub-Pages case cost a debugging round trip once."""
    config = read(repo_root, "config.js")
    assert "API_URL" in config
    assert "404" in config, "config.js should warn that the wrong origin 404s"


# --------------------------------------------------------------------------
# deploy config
# --------------------------------------------------------------------------


def test_deploy_files_never_carry_a_real_key(repo_root):
    """The service_role key belongs in the host's dashboard, never the repo."""
    for name in ("render.yaml",):
        text = read(repo_root, name)
        assert "sb_secret_" not in text, f"{name} contains a service_role key"
        assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in text, f"{name} contains a JWT"


def test_render_service_defers_the_secrets_to_the_dashboard(repo_root):
    """`sync: false` is what stops Render baking the key into the deploy."""
    text = read(repo_root, "render.yaml")
    for key in ("SUPABASE_SERVICE_ROLE_KEY", "CORS_ORIGINS"):
        assert re.search(rf"key:\s*{key}\s*\n\s*sync:\s*false", text), (
            f"{key} must be sync: false, not a committed value"
        )


def test_render_service_binds_everywhere_on_the_right_port(repo_root):
    """A container that binds localhost is unreachable from outside."""
    text = read(repo_root, "render.yaml")
    assert "--host 0.0.0.0" in text
    assert "$PORT" in text
    assert "/api/health" in text


def test_static_hosts_are_gone(repo_root):
    """One deployment on Render serves both the site and the API.

    The repo used to carry a netlify.toml for a separate static host. It was
    deleted, and a stale copy would only reassert a split deployment that no
    longer exists.
    """
    assert not (repo_root / "netlify.toml").exists(), "netlify.toml is dead: Render serves the site"


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


def test_missing_server_advice_covers_all_three_cases(repo_root):
    """The fix differs per situation, and the wrong one sends people sideways.

    Telling someone on a deployed site to "open localhost" makes them test a
    different origin, which looks like it works and hides the real problem.
    """
    source = read(repo_root, "app.js")
    assert "function noServerHelp()" in source

    help_text = source[source.index("function noServerHelp()") : source.index("function syncErrorText()")]
    assert "LOCAL_HOSTS.includes(location.hostname)" in help_text, "must detect a local run"
    assert "!API_BASE" in help_text, "must detect an unconfigured deployment"
    assert "CORS_ORIGINS" in help_text, "must mention CORS when an address is set but unreachable"
    assert help_text.count("return") == 3, "expected exactly three branches"


def test_advice_names_the_setting_people_actually_edit(repo_root):
    """API_BASE is the localhost escape hatch; API_URL is the deployed one."""
    source = read(repo_root, "app.js")
    help_text = source[source.index("function noServerHelp()") : source.index("function syncErrorText()")]

    assert "API_URL in config.js" in help_text
    assert "set API_BASE in config.js" not in help_text, "stale pointer to the old setting name"


def test_client_still_has_no_direct_table_access(repo_root):
    """Everything goes through the API now."""
    source = read(repo_root, "app.js")
    assert "client.from(" not in source
    assert ".eq(" not in source
    assert not re.search(r"user_id:\s*supaUser", source), "the client must not send a user id"