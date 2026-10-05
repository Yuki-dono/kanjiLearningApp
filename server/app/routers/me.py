"""The caller's own numbers, as the server sees them."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..deps import get_rest
from ..supabase import SupabaseREST

router = APIRouter(prefix="/api/me", tags=["me"])

_EMPTY = {
    "xp": 0,
    "streak": 0,
    "longest_streak": 0,
    "kanji_graded": 0,
    "days_active": 0,
    "last_active": None,
    "level": "N4",
    "email": None,
}


@router.get("/stats")
async def stats(
    user: User = Depends(current_user),
    rest: SupabaseREST = Depends(get_rest),
) -> dict[str, Any]:
    """Authoritative totals, recomputed on every push rather than reported by the client.

    Reads the stored profile instead of recalculating, because push already
    refreshes it. An account that has never synced has no row, which is zeros.
    """
    rows = await rest.select_owned(
        "profiles",
        user.id,
        columns="xp,streak,longest_streak,kanji_graded,days_active,last_active,level,email",
        limit=1,
    )
    if not rows:
        return dict(_EMPTY, email=user.email)
    return rows[0]