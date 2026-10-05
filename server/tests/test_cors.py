"""CORS — only exercised once the site and the API are on different hosts.

That is the production setup (Netlify + Render), and it is entirely dependent on
this working. A browser will refuse the response outright without these headers,
and the symptom looks exactly like "sync is broken" with nothing in the console
worth reading.
"""

from __future__ import annotations

import httpx
import pytest
from conftest import StubJWKSClient, USER_A
from app import auth, main
from app.config import Settings, get_settings
from app.supabase import SupabaseREST

pytestmark = pytest.mark.anyio

SITE = "https://kanji.netlify.app"
PREFLIGHT_HEADERS = {
    "Origin": SITE,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
}


def build_app(monkeypatch, signing_key, cors_origins: str):
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: Settings(
            supabase_url="https://project-test.supabase.co",
            supabase_service_role_key="test-service-role-key",
            cors_origins=cors_origins,
        ),
    )
    monkeypatch.setattr(main, "warm_jwks", lambda: True)
    monkeypatch.setattr(auth, "_jwks_client", lambda: StubJWKSClient(signing_key))
    return main.create_app()


async def client_for(app, fake_postgrest):
    async with app.router.lifespan_context(app):
        await app.state.http.aclose()
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(fake_postgrest.handler))
        app.state.rest = SupabaseREST(get_settings(), app.state.http)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://api.example.com"
        ) as http_client:
            yield http_client


@pytest.fixture
async def cors_client(monkeypatch, signing_key, fake_postgrest):
    app = build_app(monkeypatch, signing_key, SITE)
    async for client in client_for(app, fake_postgrest):
        yield client


@pytest.fixture
async def nocsr_client(monkeypatch, signing_key, fake_postgrest):
    app = build_app(monkeypatch, signing_key, "")
    async for client in client_for(app, fake_postgrest):
        yield client


# --------------------------------------------------------------------------
# configured
# --------------------------------------------------------------------------


async def test_preflight_is_allowed_for_the_configured_site(cors_client):
    response = await cors_client.options("/api/sync/push", headers=PREFLIGHT_HEADERS)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == SITE
    assert "POST" in response.headers["access-control-allow-methods"]


async def test_preflight_allows_the_authorization_header(cors_client):
    """Without this the browser strips the bearer token and every call 401s."""
    response = await cors_client.options("/api/sync/push", headers=PREFLIGHT_HEADERS)
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed
    assert "content-type" in allowed


async def test_actual_request_carries_the_origin_header(cors_client, auth_header):
    response = await cors_client.get("/api/sync/pull", headers={**auth_header(), "Origin": SITE})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == SITE


async def test_content_endpoint_is_reachable_cross_origin(cors_client):
    """Public dictionaries, so this one needs no token — only a header."""
    response = await cors_client.get("/api/content/kanji/n5", headers={"Origin": SITE})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == SITE


async def test_health_probe_is_reachable_cross_origin(cors_client):
    """The client checks this before anything else, so it must not be blocked."""
    response = await cors_client.get("/api/health", headers={"Origin": SITE})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == SITE


async def test_a_different_site_is_not_allowed(cors_client):
    response = await cors_client.options(
        "/api/sync/push",
        headers={**PREFLIGHT_HEADERS, "Origin": "https://someone-else.example"},
    )
    assert "access-control-allow-origin" not in response.headers


# --------------------------------------------------------------------------
# not configured — same-origin deployments
# --------------------------------------------------------------------------


async def test_no_cors_headers_when_unconfigured(nocsr_client):
    """Default posture: no permissive header unless one was asked for."""
    response = await nocsr_client.get("/api/content/kanji/n5", headers={"Origin": SITE})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


async def test_credentials_are_not_allowed_even_when_origin_is(nocsr_client, cors_client):
    """The bearer token is sent by fetch, not cookies, so cookies stay off."""
    response = await cors_client.options("/api/sync/push", headers=PREFLIGHT_HEADERS)
    assert response.headers.get("access-control-allow-credentials") is None