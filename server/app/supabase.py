"""Minimal async client for Supabase's PostgREST API.

Two rules are enforced here rather than trusted to callers, because getting
either wrong leaks another account's rows:

1. Table names are checked against an allow-list before they reach a URL.
2. Every write re-stamps the owning column with the caller-supplied user id, so
   a `user_id` in a request body is ignored no matter what it says.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from .config import Settings

log = logging.getLogger(__name__)

# PostgREST puts the table name straight into the path, so this allow-list is a
# security boundary: a table name must never come from a request.
ALLOWED_TABLES = frozenset(
    {
        "profiles",
        "study_settings",
        "srs_cards",
        "study_days",
        "quiz_scores",
        "custom_words",
    }
)

# `profiles` is keyed by `id` (1:1 with the auth user). Everything else is keyed
# by `user_id`.
OWNER_COLUMN = {table: "user_id" for table in ALLOWED_TABLES} | {"profiles": "id"}

# PostgREST's own default. Kept explicit so a bad limit is a visible constant
# rather than a library default that silently changes.
MAX_ROWS = 5000

# Anything a caller passes as a column list or filter key is server-controlled
# today, but this keeps it that way if someone later routes a parameter through.
_SAFE_IDENT = re.compile(r"^[A-Za-z0-9_.*,\s]+$")


class SupabaseError(Exception):
    """PostgREST refused the request.

    `public` is safe to hand back to a caller; anything detailed from the
    database stays in the logs. PostgREST error bodies name tables, columns and
    constraints, which is more schema than a client needs to see.
    """

    def __init__(self, status_code: int, public: str) -> None:
        super().__init__(public)
        self.status_code = status_code
        self.public = public


def _map_error(resp: httpx.Response) -> SupabaseError:
    try:
        body = resp.json()
        detail = body.get("message") or body.get("hint") or ""
        code = body.get("code", "")
    except Exception:
        detail, code = resp.text[:200], ""

    log.warning("postgrest %s %s", resp.status_code, f"{code} {detail}".strip())

    if resp.status_code == 404:
        return SupabaseError(404, "Not found.")
    if resp.status_code in (401, 403):
        # With a valid service_role key this means our key is wrong — a
        # server-side misconfiguration, not something to attribute to the caller.
        return SupabaseError(503, "The server's database credentials are misconfigured.")
    if resp.status_code == 409:
        return SupabaseError(409, "That conflicts with data already stored.")
    if resp.status_code in (413, 429):
        return SupabaseError(429, "That's a lot of data at once. Try a smaller sync.")
    return SupabaseError(502, "The database rejected that request.")


class SupabaseREST:
    """Async PostgREST wrapper bound to one Supabase project."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._s = settings
        self._http = client

    @property
    def _auth(self) -> dict[str, str]:
        return {
            "apikey": self._s.supabase_service_role_key,
            "Authorization": f"Bearer {self._s.supabase_service_role_key}",
        }

    def _url(self, table: str) -> str:
        if table not in ALLOWED_TABLES:
            raise ValueError(f"refusing to address unknown table {table!r}")
        return f"{self._s.rest_url}/{table}"

    async def request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        prefer: str | None = None,
        head: bool = False,
    ) -> httpx.Response:
        headers = dict(self._auth)
        if prefer:
            headers["Prefer"] = prefer
        try:
            resp = await self._http.request(
                method,
                self._url(table),
                params=params,
                json=json,
                headers=headers,
                timeout=self._s.postgrest_timeout,
                follow_redirects=False,
            )
        except httpx.HTTPError as exc:
            log.warning("postgrest transport error on %s: %s", table, exc)
            raise SupabaseError(503, "Couldn't reach the database. Try again in a moment.") from None
        if resp.status_code >= 400:
            raise _map_error(resp)
        return resp

    @staticmethod
    def _owner(table: str) -> str:
        return OWNER_COLUMN[table]

    @staticmethod
    def _stamp_owner(table: str, rows: list[dict[str, Any]], user_id: str) -> list[dict[str, Any]]:
        """Force every row's owning column to `user_id`.

        This is what stops a forged body from writing into someone else's rows,
        whatever it claims the owner is.
        """
        col = SupabaseREST._owner(table)
        stamped = []
        for row in rows:
            owned = {k: v for k, v in row.items() if k != col}
            owned[col] = user_id
            stamped.append(owned)
        return stamped

    async def select_owned(
        self,
        table: str,
        user_id: str,
        *,
        columns: str = "*",
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        if not _SAFE_IDENT.match(columns):
            raise ValueError(f"unsafe column list {columns!r}")
        params: dict[str, Any] = {"select": columns}
        params[self._owner(table)] = f"eq.{user_id}"
        for key, value in (filters or {}).items():
            if not _SAFE_IDENT.match(key):
                raise ValueError(f"unsafe filter key {key!r}")
            params[key] = value
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(min(limit, MAX_ROWS))
        resp = await self.request("GET", table, params=params, prefer="count=exact")
        body = resp.json()
        return body if isinstance(body, list) else []

    async def upsert_owned(
        self,
        table: str,
        user_id: str,
        rows: list[dict[str, Any]],
        *,
        on_conflict: str,
        chunk: int = 500,
    ) -> int:
        """Merge rows on `on_conflict`. Returns the number of rows sent."""
        if not rows:
            return 0
        if not _SAFE_IDENT.match(on_conflict):
            raise ValueError(f"unsafe conflict target {on_conflict!r}")
        stamped = self._stamp_owner(table, rows, user_id)
        sent = 0
        prefer = "resolution=merge-duplicates,return=minimal"
        for start in range(0, len(stamped), chunk):
            batch = stamped[start : start + chunk]
            await self.request(
                "POST",
                table,
                params={"on_conflict": on_conflict},
                json=batch,
                prefer=prefer,
            )
            sent += len(batch)
        return sent

    async def insert_owned(
        self, table: str, user_id: str, rows: list[dict[str, Any]]
    ) -> int:
        if not rows:
            return 0
        stamped = self._stamp_owner(table, rows, user_id)
        for start in range(0, len(stamped), 500):
            await self.request(
                "POST",
                table,
                json=stamped[start : start + 500],
                prefer="return=minimal",
            )
        return len(stamped)

    async def update_owned(
        self, table: str, user_id: str, values: dict[str, Any]
    ) -> None:
        """Update the caller's single owning row (used for `profiles`)."""
        col = self._owner(table)
        await self.request(
            "PATCH",
            table,
            params={col: f"eq.{user_id}"},
            json={k: v for k, v in values.items() if k != col},
            prefer="return=minimal",
        )

    async def delete_owned(self, table: str, user_id: str) -> None:
        await self.request(
            "DELETE",
            table,
            params={self._owner(table): f"eq.{user_id}"},
            prefer="return=minimal",
        )

    async def count_owned(self, table: str, user_id: str) -> int:
        resp = await self.request(
            "HEAD",
            table,
            params={"select": "id", self._owner(table): f"eq.{user_id}"},
            prefer="count=exact",
            head=True,
        )
        content_range = resp.headers.get("Content-Range", "")
        if "/" not in content_range:
            return 0
        tail = content_range.rsplit("/", 1)[1].strip()
        return int(tail) if tail.isdigit() else 0