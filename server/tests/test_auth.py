"""Token verification. Every case here should end in a 401."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from conftest import AUDIENCE, ISSUER, KID, USER_A

pytestmark = pytest.mark.anyio

PROTECTED = [("/api/sync/pull", "get"), ("/api/me/stats", "get"), ("/api/sync/wipe", "post")]


@pytest.mark.parametrize("path,method", PROTECTED)
async def test_missing_token_is_rejected(client, path, method):
    response = await getattr(client, method)(path)
    assert response.status_code == 401


async def test_garbage_token_is_rejected(client):
    response = await client.get("/api/sync/pull", headers={"Authorization": "Bearer not.a.jwt"})
    assert response.status_code == 401


async def test_valid_token_is_accepted(client, auth_header):
    response = await client.get("/api/sync/pull", headers=auth_header())
    assert response.status_code == 200


async def test_expired_token_is_rejected(client, token_factory):
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    token = token_factory(exp=past, iat=past)
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_wrong_audience_is_rejected(client, token_factory):
    token = token_factory(aud="some-other-service")
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_wrong_issuer_is_rejected(client, token_factory):
    """A valid token from someone else's Supabase project must not be accepted."""
    token = token_factory(iss="https://evil.example.com/auth/v1")
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_unsigned_token_is_rejected(client):
    """`alg: none` must never be honoured."""
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": USER_A,
            "role": "authenticated",
            "exp": now + timedelta(hours=1),
        },
        key="",
        algorithm="none",
    )
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_token_signed_with_another_key_is_rejected(client, token_factory, signing_key):
    from cryptography.hazmat.primitives.asymmetric import ec

    other = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    forged = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": USER_A,
            "role": "authenticated",
            "email": "attacker@example.com",
            "exp": now + timedelta(hours=1),
        },
        other,
        algorithm="ES256",
        headers={"kid": KID},
    )
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401


async def test_non_authenticated_role_is_rejected(client, token_factory):
    """service_role is a real, valid token for this project — and must still be refused."""
    token = token_factory(role="service_role")
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_error_body_does_not_leak_token(client, token_factory):
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    token = token_factory(exp=past, iat=past)
    response = await client.get("/api/sync/pull", headers={"Authorization": f"Bearer {token}"})
    assert token not in response.text
    assert "SignatureVerificationError" not in response.text