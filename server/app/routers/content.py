"""Serve the kanji and vocabulary data.

Response shapes are byte-for-byte what `data/*.json` already contained, so the
client's `loadData()` needs a different URL and nothing else — the parser, the
quiz generator and the distractors are untouched.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import get_settings

router = APIRouter(prefix="/api/content", tags=["content"])

# Both path segments end up in a filename, so the joined value is matched against
# this before any path is built. Nothing a caller sends reaches the filesystem
# unvalidated.
_SAFE_NAME = re.compile(r"^(?:kanji|vocab)-(?:n5|n4|n3|n2|n1)$")


@router.get("/{kind}/{level}")
async def content(kind: str, level: str) -> FileResponse:
    name = f"{kind.lower()}-{level.lower()}"
    if not _SAFE_NAME.match(name):
        raise HTTPException(404, "No such content.")

    path = get_settings().repo_root / "data" / f"{name}.json"
    if not path.is_file():
        raise HTTPException(404, "No such content.")

    stat = path.stat()
    return FileResponse(
        path,
        media_type="application/json; charset=utf-8",
        headers={
            "ETag": f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"',
            # These files only change when the site is redeployed, so a long cache
            # is correct and keeps 3.8MB of JSON out of repeat visits.
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )