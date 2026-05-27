from typing import Literal

from fastapi import APIRouter, Query

from ..db import get_supabase
from ..schemas import ProfileOut
from ..services.profile import build_profile

router = APIRouter(prefix="/profile", tags=["profile"])

Language = Literal["pt", "en"]


@router.get("", response_model=ProfileOut)
def get_profile(
    device_id: str = Query(min_length=1),
    tz_offset_minutes: int = Query(default=0, ge=-14 * 60, le=14 * 60),
    lang: Language = Query(default="pt"),
) -> ProfileOut:
    sb = get_supabase()

    plans_q = sb.table("plans").select("id").eq("device_id", device_id).execute()
    plan_ids = [p["id"] for p in (plans_q.data or [])]
    plans_count = len(plan_ids)

    if not plan_ids:
        data = build_profile([], 0, tz_offset_minutes, lang=lang)
        return ProfileOut(**data)

    days_q = sb.table("plan_days").select("id").in_("plan_id", plan_ids).execute()
    day_ids = [d["id"] for d in (days_q.data or [])]
    if not day_ids:
        data = build_profile([], plans_count, tz_offset_minutes, lang=lang)
        return ProfileOut(**data)

    sessions_q = (
        sb.table("sessions")
        .select("created_at, audio_duration_s, wpm, filler_count, top_filler, rating")
        .in_("plan_day_id", day_ids)
        .execute()
    )
    sessions = sessions_q.data or []
    data = build_profile(sessions, plans_count, tz_offset_minutes, lang=lang)
    return ProfileOut(**data)
