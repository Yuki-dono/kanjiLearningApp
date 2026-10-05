"""Turns a Supabase access token into a user id — and into nothing else.

This module is the security boundary for the whole API. The service_role key
bypasses row-level security, so `current_user` is the only thing standing
between one account's rows and another account's rows.

The rule that makes the rest of the codebase safe: every route takes its user id
from `current_user` and never from a request body, query string, or header.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from threading import Lock

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .config import get_settings

log = logging.getLogger(__name__)

# Supabase signs user access tokens with the project's ES256 key, published at
# the JWKS endpoint. Pinning the algorithm is not optional: it rejects
# `alg: none` and blocks the RSA->HMAC confusion trick, where an attacker signs a
# token using the *public* key as an HMAC secret.
ALGORITHMS = ["ES256"]

_bearer = HTTPBearer(auto_error=False)

_jwks: PyJWKClient | None = None
_jwks_url: str | None = None
_jwks_lock = Lock()


@dataclass(frozen=True)
class User:
    """An authenticated caller.

    `id` is the Supabase auth user id — the JWT `sub` claim, and the same value
    stored as `profiles.id` and `*.user_id` in Postgres.
    """

    id: str
    email: str | None


def _jwks_client() -> PyJWKClient:
    """Cached across requests; PyJWKClient refetches the key set when it expires."""
    global _jwks, _jwks_url
    url = get_settings().jwks_url
    with _jwks_lock:
        if _jwks is None or _jwks_url != url:
            # lifespan=300s matches the 10-minute cache Supabase's edge keeps, so
            # a rotated key never sits in our cache for long.
            _jwks = PyJWKClient(url, cache_jwk_set=True, lifespan=300)
            _jwks_url = url
        return _jwks


def warm_jwks() -> bool:
    """Fetch the key set at startup so the first real request isn't the slow one."""
    try:
        _jwks_client().get_jwk_set()
        return True
    except Exception as exc:
        log.warning("could not prefetch Supabase JWKS: %s", exc)
        return False


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    """Verify the bearer token and return the caller.

    Deliberately a sync `def`: PyJWKClient does blocking I/O, and FastAPI runs
    sync dependencies in a threadpool so this never stalls the event loop.

    Fails closed. An unreachable key set or a malformed token is a 401, never a
    request that proceeds without a verified identity.
    """
    if creds is None or not creds.credentials:
        raise _unauthorized("Sign in to continue.")

    settings = get_settings()
    token = creds.credentials

    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
    except jwt.PyJWTError:
        raise _unauthorized("Your session expired. Sign in again.") from None
    except Exception:
        # Key set unreachable: offline, DNS, Supabase hiccup. Fail closed.
        log.warning("JWKS lookup failed", exc_info=True)
        raise _unauthorized("Can't reach the sign-in service. Try again.") from None

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            audience=settings.jwt_audience,
            issuer=settings.auth_issuer,
            options={"require": ["exp", "sub", "role"]},
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session expired. Sign in again.") from None
    except jwt.PyJWTError:
        # Bad signature, wrong audience, wrong issuer, missing claim. Never say
        # which one — that just helps someone probe for a valid token.
        raise _unauthorized("Sign in again.") from None

    # The anon and service_role keys are HS256-signed and already fail the
    # ES256 check above. Checking the role keeps the intent explicit.
    if claims.get("role") != "authenticated":
        raise _unauthorized("Sign in again.")

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise _unauthorized("Sign in again.")

    email = claims.get("email")
    return User(id=sub, email=email if isinstance(email, str) else None)