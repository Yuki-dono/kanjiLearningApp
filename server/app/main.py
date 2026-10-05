"""KanjiLearn API — the static site plus the JSON API that fronts Supabase.

Run from inside server/:

    pip install -r requirements.txt
    python -m uvicorn app.main:app --reload --port 8000

Then open http://localhost:8000. That single origin is deliberate: it avoids CORS
in development and matches how the site will be deployed.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .auth import warm_jwks
from .config import get_settings
from .routers import content, me, setup, sync
from .supabase import SupabaseError, SupabaseREST

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kanji")

# Named explicitly rather than mounting the repo root: a root mount would also
# serve .gitignore and anything else that lands in the working tree.
SITE_FILES = {
    "api.js": "text/javascript; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "config.js": "text/javascript; charset=utf-8",
    "architecture.html": "text/html; charset=utf-8",
    "index.html": "text/html; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.http = httpx.AsyncClient(
        headers={"User-Agent": "kanjilearn-api/1.0"},
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    app.state.rest = SupabaseREST(settings, app.state.http)
    if warm_jwks():
        log.info("Supabase signing keys loaded")
    else:
        log.warning("JWKS unreachable at startup — sign-in will fail until it can be fetched")
    try:
        yield
    finally:
        await app.state.http.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="KanjiLearn API", version="1.0.0", lifespan=lifespan)

    # Off unless the site is hosted on a different origin than the API. Same-origin
    # needs no CORS, and this keeps the common case from having a permissive header
    # it doesn't need.
    origins = settings.origin_list
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.exception_handler(SupabaseError)
    async def _database_error(_request: Request, exc: SupabaseError) -> JSONResponse:
        # `exc.public` is written for callers; the schema detail stays in the log.
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.public})

    app.include_router(sync.router)
    app.include_router(me.router)
    app.include_router(content.router)
    app.include_router(setup.router)

    @app.get("/api/health", tags=["meta"])
    async def health(request: Request) -> dict[str, object]:
        # The project ref is not a secret — it's in the public URL the browser
        # already uses — and it's the quickest way to catch the one failure that
        # looks like every other failure: the server pointed at a different
        # Supabase project than the one the client signs in against.
        ref = ""
        try:
            ref = request.app.state.rest.project_ref
        except AttributeError:  # lifespan hasn't run
            pass
        return {"ok": True, "supabase_project": ref}

    # After the routers, so /api/* always wins over these.
    for _name, _media_type in SITE_FILES.items():

        def _make(filename: str, media_type: str):
            async def handler() -> FileResponse:
                path = settings.repo_root / filename
                if not path.is_file():
                    raise HTTPException(404, "Not found")
                # FileResponse sets ETag/Last-Modified and answers 304 on its own.
                return FileResponse(path, media_type=media_type)

            return handler

        app.get(f"/{_name}", include_in_schema=False)(_make(_name, _media_type))

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        path = settings.repo_root / "index.html"
        if not path.is_file():
            raise HTTPException(404, "Not found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    # Still served statically: it is the offline fallback if the API is down.
    data_dir = settings.repo_root / "data"
    if data_dir.is_dir():
        app.mount("/data", StaticFiles(directory=data_dir), name="data")

    return app


app = create_app()