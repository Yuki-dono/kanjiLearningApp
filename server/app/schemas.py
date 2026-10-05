"""Request bodies.

The bounds here are not decoration — they cap what one request can push into the
database, and their lengths mirror the columns in supabase-schema.sql.

`extra="forbid"` throughout: a field we don't expect is a client bug, and
failing loudly beats silently dropping study data on someone's only good sync
of the day.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

LEVELS = ("N5", "N4", "N3", "N2", "N1")
GRADES = ("again", "good", "easy")

MAX_SRS_ROWS = 5000
MAX_DAY_ROWS = 400
MAX_CUSTOM_ROWS = 2000
MAX_QUIZ_ROWS = 200
MAX_CHARS_PER_DAY = 400


class SrsCardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    character: str = Field(min_length=1, max_length=8)
    level: str | None = Field(default=None, max_length=4)
    reps: int = Field(default=0, ge=0, le=1_000_000)
    lapses: int = Field(default=0, ge=0, le=1_000_000)
    ease: float = Field(default=2.5, ge=0, le=10)
    interval: int = Field(default=0, ge=0, le=100_000)
    due: date


class StudyDayIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: date
    new_chars: list[str] = Field(default_factory=list, max_length=MAX_CHARS_PER_DAY)
    # jsonb: one kanji -> the grade it got that day.
    graded: dict[str, str] = Field(default_factory=dict)

    @field_validator("graded")
    @classmethod
    def _check_graded(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > MAX_CHARS_PER_DAY:
            raise ValueError("too many graded characters for one day")
        for character, grade in value.items():
            if not character or len(character) > 8:
                raise ValueError("character must be 1-8 characters")
            if grade not in GRADES:
                raise ValueError(f"unknown grade {grade!r}")
        return value

    @field_validator("new_chars")
    @classmethod
    def _check_chars(cls, value: list[str]) -> list[str]:
        if any(not ch or len(ch) > 8 for ch in value):
            raise ValueError("character must be 1-8 characters")
        return value


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # No length bound on level: _check_level maps anything unrecognised to "N4"
    # anyway, so there is nothing long enough to be worth storing.
    level: str = "N4"
    goal: int = 0
    scope: list[str] = Field(default_factory=list, max_length=len(LEVELS))
    # Last-write-wins marker. Supplied by the client on purpose: pull compares it
    # against a client-side timestamp, so stamping it server-side would put two
    # different clocks in that comparison. The stakes are low — a user who lies
    # about it only wins their own settings merge.
    updated_at: datetime

    @field_validator("level")
    @classmethod
    def _check_level(cls, value: str) -> str:
        # Coerced rather than rejected, and so are goal/scope below: this data
        # can come from an old localStorage, and a learner with one odd setting
        # should not lose an entire progress push over it. The client sanitises
        # the same way on read.
        return value if value in LEVELS else "N4"

    @field_validator("goal")
    @classmethod
    def _clamp_goal(cls, value: int) -> int:
        return min(20, max(3, value or 5))

    @field_validator("scope")
    @classmethod
    def _filter_scope(cls, value: list[str]) -> list[str]:
        return [level for level in value if level in LEVELS]


class CustomWordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str = Field(min_length=1, max_length=100)
    # Frequently empty: 163 of the 662 N5 vocab entries in data/ have no reading.
    # A min_length here would reject a quarter of the dictionary.
    reading: str = Field(default="", max_length=200)
    meaning: str = Field(default="", max_length=500)
    parts: str | None = Field(default="", max_length=500)


class QuizScoreIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = Field(min_length=1, max_length=32)
    scope: list[str] = Field(default_factory=list, max_length=len(LEVELS))
    learned: bool = False
    score: int = Field(ge=0, le=100_000)
    total: int = Field(ge=0, le=100_000)
    pct: int = Field(default=0, ge=0, le=100)

    @field_validator("scope")
    @classmethod
    def _filter_scope(cls, value: list[str]) -> list[str]:
        return [level for level in value if level in LEVELS]


class PushBody(BaseModel):
    """One sync push. Mirrors what `pushRows` used to send to six tables."""

    model_config = ConfigDict(extra="forbid")

    # The client's own forceFull flag: ship everything, not just what changed.
    full: bool = False
    settings: SettingsIn | None = None
    srs: list[SrsCardIn] = Field(default_factory=list, max_length=MAX_SRS_ROWS)
    days: list[StudyDayIn] = Field(default_factory=list, max_length=MAX_DAY_ROWS)
    custom_words: list[CustomWordIn] = Field(default_factory=list, max_length=MAX_CUSTOM_ROWS)
    quiz_scores: list[QuizScoreIn] = Field(default_factory=list, max_length=MAX_QUIZ_ROWS)