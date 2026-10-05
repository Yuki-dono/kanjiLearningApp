"""Settings, loaded from server/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Admin key: bypasses row-level security. Server-side only, never shipped to
    # a browser. Rotating it in the Supabase dashboard is the only way it leaks,
    # so it lives in a gitignored .env.
    supabase_url: str
    supabase_service_role_key: str

    # Supabase issues `aud: authenticated` and `role: authenticated` to signed-in
    # users. We verify both, so a token minted for a different audience is refused.
    jwt_audience: str = "authenticated"

    # Empty means same-origin, which is the default: this server also serves the
    # static site. Only set this when the site is hosted separately.
    cors_origins: str = ""

    postgrest_timeout: float = 15.0

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def auth_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"

    @property
    def rest_url(self) -> str:
        return f"{self.supabase_url}/rest/v1"

    @property
    def repo_root(self) -> Path:
        """server/app/config.py -> server/app -> server -> <repo root>"""
        return Path(__file__).resolve().parents[2]

    @property
    def origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()