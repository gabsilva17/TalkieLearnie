from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CreatePlanReq(BaseModel):
    device_id: str = Field(min_length=1)
    prep_for: str = Field(min_length=1)
    target_date: date
    audience_info: str = Field(min_length=1)


class RenamePlanReq(BaseModel):
    device_id: str = Field(min_length=1)
    prep_for: str = Field(min_length=1, max_length=200)


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
    target_date: date
    audience_info: str
    created_at: datetime
    days: list[PlanDayOut]


class FillerHit(BaseModel):
    token: str
    start: float


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


class ActivityPoint(BaseModel):
    date: date
    sessions: int


class WpmPoint(BaseModel):
    date: date
    wpm: float


class RatingPoint(BaseModel):
    date: date
    rating: float


class AchievementOut(BaseModel):
    id: str
    label: str
    description: str
    earned: bool
    earned_at: datetime | None


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
    messages: list[AskMessage] = Field(min_length=1, max_length=20)


class AskResp(BaseModel):
    reply: str


class AskTranscribeResp(BaseModel):
    text: str


class MotivationReq(BaseModel):
    device_id: str = Field(min_length=1)
    plan_id: UUID


class MotivationResp(BaseModel):
    message: str
