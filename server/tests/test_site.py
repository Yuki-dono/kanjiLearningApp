"""The static site the API serves.

The server mounts the site by name, so a new file that index.html references can
be silently 404'd — which is how api.js went missing once already. These tests
read the actual markup and check every local reference resolves.
"""

from __future__ import annotations

import re

import pytest
from conftest import USER_A

pytestmark = pytest.mark.anyio

REFERENCE = re.compile(r'(?:src|href)\s*=\s*"([^"]+)"')
EXTERNAL = re.compile(r"^(?:https?:|data:|mailto:|#|//)")


def local_references(markup: str) -> list[str]:
    """Sorted and deduped — for "does every reference resolve"."""
    return sorted(set(raw_references(markup)))


def raw_references(markup: str) -> list[str]:
    """In document order — for "which script loads first"."""
    out = []
    for path in REFERENCE.findall(markup):
        if not EXTERNAL.match(path):
            out.append("/" + path.lstrip("./"))
    return out


async def test_every_file_index_html_references_is_served(client, repo_root):
    markup = (repo_root / "index.html").read_text(encoding="utf-8")
    references = local_references(markup)

    assert references, "found no local references in index.html — regex is probably wrong"
    for path in references:
        response = await client.get(path)
        assert response.status_code == 200, f"index.html references {path} but it 404s"


async def test_config_js_loads_before_app_js(client, repo_root):
    """app.js reads window.KANJI_CONFIG while it parses, so this order is load-bearing."""
    order = [p for p in raw_references((repo_root / "index.html").read_text(encoding="utf-8")) if p.endswith(".js")]

    assert "/config.js" in order and "/app.js" in order, f"unexpected script tags: {order}"
    assert order.index("/config.js") < order.index("/app.js"), (
        f"config.js must load before app.js, got {order}"
    )


async def test_server_does_not_expose_dotfiles(client):
    for path in ("/.gitignore", "/.env", "/../server/.env"):
        response = await client.get(path)
        assert response.status_code == 404, f"{path} is reachable"


async def test_api_paths_are_not_shadowed_by_static_files(client):
    """Routers are registered before the static routes, so /api wins."""
    assert (await client.get("/api/health")).status_code == 200
    assert (await client.get("/api/content/kanji/n5")).status_code == 200


async def test_content_and_static_fallback_agree(client):
    """fetchContent() falls back to the static path, so both must serve the same file."""
    via_api = await client.get("/api/content/kanji/n5")
    static = await client.get("/data/kanji-n5.json")

    assert via_api.status_code == static.status_code == 200
    assert via_api.json() == static.json()


async def test_content_is_cacheable(client):
    response = await client.get("/api/content/kanji/n5")
    assert response.headers.get("Cache-Control", "").startswith("public")
    assert response.headers.get("ETag", "").startswith('W/"')


async def test_protected_endpoints_reject_anonymous_callers(client):
    assert (await client.get("/api/me/stats")).status_code == 401
    assert (await client.post("/api/sync/push", json={})).status_code == 401
    assert (await client.post("/api/sync/wipe")).status_code == 401


async def test_content_needs_no_sign_in(client):
    """The dictionaries are public — only progress is behind the token."""
    assert (await client.get("/api/content/vocab/n1")).status_code == 200