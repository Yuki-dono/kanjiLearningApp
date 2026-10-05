"""Sync: push study data up, pull it back down.

Every handler scopes its work to the caller's verified user id. Nothing here
reads a user id from the request.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..deps import get_rest
from ..schemas import PushBody
from ..stats import build_profile
from ..supabase import MAX_ROWS, SupabaseREST

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync", tags=["sync"])

# scan bounds when rebuilding the profile
_SCAN_LIMIT = MAX_ROWS


async def _rebuild_profile(
    rest: SupabaseREST, user: User, level: str | None = None
) -> dict[str, Any]:
    """Recompute the caller's `profiles` row from the rows that were just written.

    Reads back only the columns the totals need — `reps` from every card and
    `day,graded` from every day. At 2211 kanji that is a couple of small queries,
    which is why there is no aggregate endpoint here; if the deck ever grows a lot
    past that, this is the place to move to a SQL function.
    """
    cards, days = await asyncio.gather(
        rest.select_owned("srs_cards", user.id, columns="reps", limit=_SCAN_LIMIT),
        rest.select_owned("study_days", user.id, columns="day,graded", limit=_SCAN_LIMIT),
    )
    if level is None:
        rows = await rest.select_owned(
            "study_settings", user.id, columns="level", limit=1
        )
        level = rows[0].get("level") if rows else None

    profile = build_profile(
        user_id=user.id,
        email=user.email,
        level=level,
        card_rows=cards,
        day_rows=days,
        last_seen_at=datetime.now(timezone.utc).isoformat(),
    )
    await rest.upsert_owned("profiles", user.id, [profile], on_conflict="id")
    return profile


@router.post("/push")
async def push(
    body: PushBody,
    # `user` is declared first on purpose: FastAPI resolves dependencies in
    # order, so auth runs before anything reaches for app state or the database.
    user: User = Depends(current_user),
    rest: SupabaseREST = Depends(get_rest),
) -> dict[str, Any]:
    """Write the caller's study data, then refresh their derived stats.

    `full` is informational: it records that the client shipped everything rather
    than just what changed. Correctness comes from the upserts being idempotent,
    so the same row arriving twice is harmless either way.
    """
    written = 0

    if body.settings is not None:
        s = body.settings
        await rest.upsert_owned(
            "study_settings",
            user.id,
            [
                {
                    "level": s.level,
                    "goal": s.goal,
                    "scope": s.scope,
                    # Client-supplied on purpose — see schemas.SettingsIn.updated_at.
                    "updated_at": s.updated_at.isoformat(),
                }
            ],
            on_conflict="user_id",
        )
        written += 1

    if body.srs:
        now = datetime.now(timezone.utc).isoformat()
        written += await rest.upsert_owned(
            "srs_cards",
            user.id,
            [
                {
                    "character": card.character,
                    "level": card.level,
                    "reps": card.reps,
                    "lapses": card.lapses,
                    "ease": card.ease,
                    "interval": card.interval,
                    "due": card.due.isoformat(),
                    "updated_at": now,
                }
                for card in body.srs
            ],
            on_conflict="user_id,character",
        )

    if body.days:
        now = datetime.now(timezone.utc).isoformat()
        written += await rest.upsert_owned(
            "study_days",
            user.id,
            [
                {
                    "day": day.day.isoformat(),
                    "new_chars": list(day.new_chars),
                    "graded": dict(day.graded),
                    "updated_at": now,
                }
                for day in body.days
            ],
            on_conflict="user_id,day",
        )

    if body.custom_words:
        written += await rest.upsert_owned(
            "custom_words",
            user.id,
            [
                {
                    "word": word.word,
                    "reading": word.reading,
                    "meaning": word.meaning,
                    "parts": word.parts or "",
                }
                for word in body.custom_words
            ],
            on_conflict="user_id,word",
        )

    if body.quiz_scores:
        # Insert-only: quiz history is a log, and re-pushing an attempt should
        # add a row rather than overwrite one.
        written += await rest.insert_owned(
            "quiz_scores",
            user.id,
            [
                {
                    "mode": q.mode,
                    "scope": list(q.scope),
                    "learned": q.learned,
                    "score": q.score,
                    "total": q.total,
                    "pct": q.pct,
                }
                for q in body.quiz_scores
            ],
        )

    profile = await _rebuild_profile(rest, user)

    return {
        "ok": True,
        "written": written,
        "full": body.full,
        "stats": {
            "xp": profile["xp"],
            "streak": profile["streak"],
            "longest_streak": profile["longest_streak"],
            "kanji_graded": profile["kanji_graded"],
            "days_active": profile["days_active"],
            "last_active": profile["last_active"],
        },
    }


@router.get("/pull")
async def pull(
    user: User = Depends(current_user),
    rest: SupabaseREST = Depends(get_rest),
) -> dict[str, Any]:
    """Everything the caller has stored, for merging into local state."""
    uid = user.id
    settings, cards, days, words, recent, quiz_total, profile = await asyncio.gather(
        rest.select_owned("study_settings", uid, columns="level,goal,scope,updated_at", limit=1),
        rest.select_owned(
            "srs_cards", uid, columns="character,level,reps,lapses,ease,interval,due", limit=_SCAN_LIMIT
        ),
        rest.select_owned("study_days", uid, columns="day,new_chars,graded", limit=_SCAN_LIMIT),
        rest.select_owned("custom_words", uid, columns="word,reading,meaning,parts", limit=_SCAN_LIMIT),
        rest.select_owned(
            "quiz_scores",
            uid,
            columns="mode,scope,learned,score,total,pct",
            order="created_at.desc",
            limit=1,
        ),
        rest.count_owned("quiz_scores", uid),
        rest.select_owned(
            "profiles",
            uid,
            # The full stats set, so a pull alone can repaint the account panel
            # with server-computed numbers.
            columns="streak,longest_streak,last_active,xp,kanji_graded,days_active",
            limit=1,
        ),
    )

    return {
        "settings": settings[0] if settings else None,
        "srs": cards,
        "days": days,
        "custom_words": words,
        "recent_quiz": recent[0] if recent else None,
        "quiz_total": quiz_total,
        "profile": profile[0] if profile else None,
    }


@router.post("/wipe")
async def wipe(
    user: User = Depends(current_user),
    rest: SupabaseREST = Depends(get_rest),
) -> dict[str, Any]:
    """Delete the caller's study data and zero their counters.

    Matches "reset all progress": the stored copy goes too, so a second device
    can't resurrect what was just erased. `study_settings` is left alone, as it
    was before — resetting your history shouldn't reset your course.
    """
    await asyncio.gather(
        rest.delete_owned("srs_cards", user.id),
        rest.delete_owned("study_days", user.id),
        rest.delete_owned("quiz_scores", user.id),
        rest.delete_owned("custom_words", user.id),
    )
    await rest.update_owned(
        "profiles",
        user.id,
        {
            "xp": 0,
            "streak": 0,
            "longest_streak": 0,
            "kanji_graded": 0,
            "days_active": 0,
            "last_active": None,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"ok": True}