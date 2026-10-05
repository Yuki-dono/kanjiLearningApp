"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import Request

from .supabase import SupabaseREST


def get_rest(request: Request) -> SupabaseREST:
    """The PostgREST client, built once at startup and hung off app.state."""
    return request.app.state.rest