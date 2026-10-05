"""Setup diagnostics.

Exists because "sync is broken" has too many possible causes to debug from the
outside: wrong project, schema never applied, bad service_role key, CORS. Each
one produces a 4xx that reads the same in the UI. This turns that guessing into
one URL to open.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..deps import get_rest
from ..supabase import ALLOWED_TABLES, SupabaseREST

router = APIRouter(prefix="/api", tags=["setup"])

# A table that's missing means the schema hasn't been applied, which is the single
# most common setup failure and the easiest to state exactly.
_MISSING = "missing — run supabase-schema.sql"


@router.get("/diagnose")
async def diagnose(
    user: User = Depends(current_user),
    rest: SupabaseREST = Depends(get_rest),
) -> dict[str, Any]:
    """Report, per table, whether this server can actually reach it.

    Auth-required like everything else, but it reads nothing of the caller's data:
    each probe asks for a single row and discards it.
    """
    names = sorted(ALLOWED_TABLES)
    results = await asyncio.gather(*(rest.table_exists(name) for name in names))
    tables = {name: ("ok" if exists else _MISSING) for name, exists in zip(names, results)}

    missing = sorted(name for name, state in tables.items() if state != "ok")

    return {
        "ok": not missing,
        "supabase_project": rest.project_ref,
        "authenticated_as": user.id,
        "tables": tables,
        "missing": missing,
        "next_step": (
            None
            if not missing
            else "Run supabase-schema.sql once in Supabase → SQL Editor, then hit Sync now."
        ),
    }