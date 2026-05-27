from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# pt-PT remains the default for any plan / call that doesn't specify a
# language. Legacy rows created before the column existed are treated as 'pt'
# at the SQL level (default 'pt' not null).
Language = Literal["pt", "en"]


class RenamePlanReq(BaseModel):
    device_id: str = Field(min_length=1)
    # Edits the short display title (plans.name), not the original prep_for
    # description (which stays as LLM context).
    name: str = Field(min_length=1, max_length=200)


class PlanDayOut(BaseModel):
    id: UUID
    day_index: int
    day_date: date
    theme: str
    question: str
    completed_at: datetime | None


class PlanOut(BaseModel):
    id: UUID
    prep_for: str
    # Short AI-generated display title (2-4 words) shown on the plan list card.
    # NULL on legacy rows created before this column existed — mobile falls
    # back to prep_for in that case.
    name: str | None = None
    target_date: date
    audience_info: str
    extra_text: str | None = None
    extra_pdf_url: str | None = None
    focus_mode: str | None = None
    # Language the plan was created in. Every downstream LLM call (analyze,
    # motivation, ask-with-plan-context, Whisper) must use this language, not
    # the device's current toggle, so a pt-PT plan keeps producing pt-PT
    # feedback even after the user flips the UI to English.
    language: Language = "pt"
    created_at: datetime
    days: list[PlanDayOut]


class FillerHit(BaseModel):
    token: str
    start: float


class AchievementOut(BaseModel):
    id: str
    label: str
    description: str
    earned: bool
    earned_at: datetime | None


class SessionCelebrations(BaseModel):
    """Snapshot of which transitions a single session triggered. Populated
    only by POST /sessions (it's the only endpoint that can compute the
    before → after diff in one transaction). GET /sessions leaves this null
    — there's no "just unlocked" semantics for historical rows.
    """

    newly_earned_achievements: list[AchievementOut]
    streak_just_activated: bool
    streak_current: int
    streak_best: int
    streak_is_new_best: bool
    plan_just_completed: bool
    plan_id: UUID | None = None
    plan_prep_for: str | None = None
    plan_total_days: int | None = None


class SessionOut(BaseModel):
    id: UUID
    plan_day_id: UUID
    audio_duration_s: float
    audio_url: str | None
    transcript: str
    wpm: float
    filler_count: int
    top_filler: str | None
    filler_timestamps: list[FillerHit]
    pacing_variation: float
    rating: int
    feedback: dict
    created_at: datetime
    celebrations: SessionCelebrations | None = None


class ActivityPoint(BaseModel):
    date: date
    sessions: int


class WpmPoint(BaseModel):
    date: date
    wpm: float


class RatingPoint(BaseModel):
    date: date
    rating: float


class ProfileOut(BaseModel):
    streak_current: int
    streak_best: int
    streak_active_today: bool
    total_sessions: int
    total_minutes: float
    avg_wpm: float | None
    best_rating: int | None
    avg_rating: float | None
    top_filler: str | None
    plans_count: int
    activity_365: list[ActivityPoint]
    wpm_trend: list[WpmPoint]
    rating_trend: list[RatingPoint]
    achievements: list[AchievementOut]


class AskMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class AskReq(BaseModel):
    device_id: str = Field(min_length=1)
    plan_id: UUID | None = None
    # Mobile default. When `plan_id` is provided the server overrides this
    # with the plan's persisted language so the assistant stays consistent
    # with the rest of that plan's content.
    lang: Language = "pt"
    messages: list[AskMessage] = Field(min_length=1, max_length=20)


class AskResp(BaseModel):
    reply: str


class AskTranscribeResp(BaseModel):
    text: str


class MotivationReq(BaseModel):
    device_id: str = Field(min_length=1)
    plan_id: UUID
    # Optional; the server falls back to the plan's stored language when
    # absent. The mobile client passes the plan's language so the celebration
    # always renders in the plan's language.
    lang: Language | None = None


class MotivationResp(BaseModel):
    message: str


class ReanalyzeSessionReq(BaseModel):
    device_id: str = Field(min_length=1)
    transcript: str = Field(min_length=1, max_length=8000)
