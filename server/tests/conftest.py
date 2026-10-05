"""Test harness.

Two things are faked, and the rest is real:

* **PostgREST** — a small in-memory stand-in mounted as an httpx MockTransport, so
  `SupabaseREST` builds real URLs, sets real headers and parses real responses.
  Every call is recorded, which is what lets `test_isolation.py` assert on what
  actually went over the wire.
* **The JWKS endpoint** — swapped for a stub handing back the same in-process
  public key. Tokens are genuinely signed and genuinely verified; only the
  network fetch is skipped.

Nothing here stubs `jwt.decode`, so the signature, audience, issuer and expiry
checks all run for real.
"""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

# Import the app with the real .env present so settings resolve; PostgREST is
# mocked below, so the key value never leaves the process.
os.environ.setdefault("SUPABASE_URL", "https://project-test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app import auth, main  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.supabase import SupabaseREST  # noqa: E402

KID = "test-kid"
ISSUER = "https://project-test.supabase.co/auth/v1"
AUDIENCE = "authenticated"

USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"

# Primary keys, so the fake can reproduce PostgREST's upsert semantics.
COMPOSITE_KEYS = {
    "profiles": ("id",),
    "study_settings": ("user_id",),
    "srs_cards": ("user_id", "character"),
    "study_days": ("user_id", "day"),
    "custom_words": ("user_id", "word"),
    "quiz_scores": (),  # identity column — every insert is a new row
}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
def signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def token_factory(signing_key: ec.EllipticCurvePrivateKey):
    def make(sub: str = USER_A, **overrides: Any) -> str:
        now = datetime.now(timezone.utc)
        claims: dict[str, Any] = {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": sub,
            "role": "authenticated",
            "email": f"user-{sub[:4]}@example.com",
            "iat": now,
            "exp": now + timedelta(hours=1),
        }
        claims.update(overrides)
        return jwt.encode(claims, signing_key, algorithm="ES256", headers={"kid": KID})

    return make


@pytest.fixture
def auth_header(token_factory) -> dict[str, dict[str, str]]:
    def build(sub: str = USER_A, **overrides: Any) -> dict[str, str]:
        return {"Authorization": f"Bearer {token_factory(sub, **overrides)}"}

    return build


class _SigningKey:
    def __init__(self, key: Any) -> None:
        self.key = key


class StubJWKSClient:
    """Stands in for jwt.PyJWKClient, returning the test public key."""

    def __init__(self, private_key: ec.EllipticCurvePrivateKey) -> None:
        self._public = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

    def get_signing_key_from_jwt(self, token: str) -> _SigningKey:
        if jwt.get_unverified_header(token).get("kid") != KID:
            raise jwt.PyJWKClientError("no key matches the token's kid")
        return _SigningKey(self._public)

    def get_jwk_set(self) -> None:
        return None


class FakePostgREST:
    """In-memory PostgREST. Understands only what SupabaseREST actually sends."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.tables: dict[str, dict[tuple, dict[str, Any]]] = defaultdict(dict)
        self.identity = 0
        # Tables the "database" claims not to have, to reproduce PGRST205.
        self.missing_tables: set[str] = set()

    # -- helpers used by tests -------------------------------------------
    def rows(self, table: str) -> list[dict[str, Any]]:
        return list(self.tables[table].values())

    def seed(self, table: str, row: dict[str, Any]) -> None:
        self.tables[table][self._key(table, row)] = row

    def requests_for(self, table: str) -> list[httpx.Request]:
        return [c for c in self.calls if c.url.path.endswith(f"/{table}")]

    @staticmethod
    def _key(table: str, row: dict[str, Any]) -> tuple:
        columns = COMPOSITE_KEYS[table]
        if not columns:
            # quiz_scores has an identity column: every insert is its own row.
            return (row.get("id"),)
        return tuple(row.get(column) for column in columns)

    # -- the transport handler -------------------------------------------
    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        table = request.url.path.rsplit("/", 1)[-1]
        if table in self.missing_tables:
            return httpx.Response(
                404,
                json={
                    "code": "PGRST205",
                    "message": f"Could not find the table 'public.{table}' in the schema cache",
                },
            )
        method = request.method
        owner_filter = {
            key: value[3:]
            for key, value in request.url.params.items()
            if isinstance(value, str) and value.startswith("eq.")
        }

        def owned() -> list[dict[str, Any]]:
            out = []
            for row in self.tables[table].values():
                if all(str(row.get(k)) == v for k, v in owner_filter.items()):
                    out.append(row)
            return out

        if method == "GET":
            matched = owned()
            limit = request.url.params.get("limit")
            if limit:
                matched = matched[: int(limit)]
            return httpx.Response(
                200,
                json=matched,
                headers={"Content-Range": f"0-{max(len(matched) - 1, 0)}/{len(matched)}"},
            )

        if method == "HEAD":
            total = len(owned())
            return httpx.Response(200, headers={"Content-Range": f"0-0/{total}"})

        if method == "POST":
            payload = json_body(request)
            rows = payload if isinstance(payload, list) else [payload]
            for row in rows:
                if table == "quiz_scores":
                    self.identity += 1
                    row = {"id": self.identity, **row}
                self.tables[table][self._key(table, row)] = row
            return httpx.Response(201, headers={"Content-Range": "*"})

        if method == "PATCH":
            for row in owned():
                row.update(json_body(request))
            return httpx.Response(204)

        if method == "DELETE":
            for key, row in list(self.tables[table].items()):
                if all(str(row.get(k)) == v for k, v in owner_filter.items()):
                    del self.tables[table][key]
            return httpx.Response(204)

        return httpx.Response(405)


def json_body(request: httpx.Request) -> Any:
    import json

    return json.loads(request.content or b"null")


@pytest.fixture
def fake_postgrest() -> FakePostgREST:
    return FakePostgREST()


@pytest.fixture
def app(monkeypatch, signing_key):
    # Skip the startup JWKS fetch; current_user uses the stub below instead.
    monkeypatch.setattr(main, "warm_jwks", lambda: True)
    monkeypatch.setattr(auth, "_jwks_client", lambda: StubJWKSClient(signing_key))
    return main.create_app()


@pytest.fixture
async def client(app, fake_postgrest):
    async with app.router.lifespan_context(app):
        await app.state.http.aclose()
        app.state.http = httpx.AsyncClient(
            transport=httpx.MockTransport(fake_postgrest.handler)
        )
        app.state.rest = SupabaseREST(get_settings(), app.state.http)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http_client:
            yield http_client


@pytest.fixture
def repo_root() -> Path:
    return get_settings().repo_root