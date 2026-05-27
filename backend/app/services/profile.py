"""Profile aggregation: streaks, totals, trends, achievements.

All values are derived on the fly from `plans`, `plan_days`, and `sessions` —
no extra schema. Inputs are session rows (already filtered to a single device)
and a timezone offset (minutes from UTC) so "today" matches what the user sees
on their phone.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

Language = Literal["pt", "en"]


def _to_utc(dt_raw: Any) -> datetime:
    if isinstance(dt_raw, datetime):
        d = dt_raw
    else:
        s = str(dt_raw).replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _local_date(utc_dt: datetime, tz_offset_minutes: int) -> date:
    return (utc_dt + timedelta(minutes=tz_offset_minutes)).date()


def _current_streak(active_days: set[date], today_local: date) -> tuple[int, bool]:
    """Return (current_streak, active_today). Streak survives until 'today' is
    skipped — if the user hasn't recorded today yet but did yesterday, the
    streak still counts (anchored at yesterday)."""
    if not active_days:
        return 0, False
    active_today = today_local in active_days
    if active_today:
        anchor = today_local
    elif (today_local - timedelta(days=1)) in active_days:
        anchor = today_local - timedelta(days=1)
    else:
        return 0, False
    n = 0
    cur = anchor
    while cur in active_days:
        n += 1
        cur -= timedelta(days=1)
    return n, active_today


def _best_streak(active_days: set[date]) -> int:
    if not active_days:
        return 0
    days_sorted = sorted(active_days)
    best = 1
    run = 1
    for i in range(1, len(days_sorted)):
        if days_sorted[i] - days_sorted[i - 1] == timedelta(days=1):
            run += 1
            best = max(best, run)
        else:
            run = 1
    return best


_ACHIEVEMENT_CATALOG_PT: list[dict[str, str]] = [
    {"id": "first_session", "label": "Primeira sessão", "description": "Grava a tua primeira resposta."},
    {"id": "streak_3", "label": "3 dias seguidos", "description": "Mantém o streak por 3 dias."},
    {"id": "streak_7", "label": "Semana perfeita", "description": "7 dias seguidos a treinar."},
    {"id": "streak_14", "label": "Duas semanas a fio", "description": "14 dias seguidos. Resistência!"},
    {"id": "sessions_10", "label": "10 sessões", "description": "Completa 10 sessões no total."},
    {"id": "sessions_25", "label": "25 sessões", "description": "Completa 25 sessões. Veterano."},
    {"id": "minutes_10", "label": "10 minutos a falar", "description": "Soma 10 minutos de áudio."},
    {"id": "minutes_30", "label": "30 minutos a falar", "description": "Soma 30 minutos de áudio."},
    {"id": "rating_8", "label": "Avaliação 8+", "description": "Alcança uma avaliação de 8 ou mais."},
    {"id": "rating_9", "label": "Quase perfeito", "description": "Alcança uma avaliação de 9 ou mais."},
    {"id": "low_fillers", "label": "Discurso limpo", "description": "Menos de 3 fillers numa sessão."},
    {"id": "multi_plan", "label": "Dois planos", "description": "Cria mais do que um plano."},
]

_ACHIEVEMENT_CATALOG_EN: list[dict[str, str]] = [
    {"id": "first_session", "label": "First session", "description": "Record your first answer."},
    {"id": "streak_3", "label": "3 days in a row", "description": "Keep the streak for 3 days."},
    {"id": "streak_7", "label": "Perfect week", "description": "Train 7 days in a row."},
    {"id": "streak_14", "label": "Two weeks straight", "description": "14 days in a row. Endurance!"},
    {"id": "sessions_10", "label": "10 sessions", "description": "Complete 10 sessions total."},
    {"id": "sessions_25", "label": "25 sessions", "description": "Complete 25 sessions. Veteran."},
    {"id": "minutes_10", "label": "10 minutes spoken", "description": "Reach 10 minutes of audio."},
    {"id": "minutes_30", "label": "30 minutes spoken", "description": "Reach 30 minutes of audio."},
    {"id": "rating_8", "label": "Rating 8+", "description": "Reach a rating of 8 or higher."},
    {"id": "rating_9", "label": "Almost perfect", "description": "Reach a rating of 9 or higher."},
    {"id": "low_fillers", "label": "Clean speech", "description": "Fewer than 3 fillers in a session."},
    {"id": "multi_plan", "label": "Two plans", "description": "Create more than one plan."},
]


def _catalog(lang: Language) -> list[dict[str, str]]:
    return _ACHIEVEMENT_CATALOG_EN if lang == "en" else _ACHIEVEMENT_CATALOG_PT


def _compute_achievements(
    sessions: list[dict],
    plans_count: int,
    total_minutes: float,
    streak_best: int,
    lang: Language = "pt",
) -> list[dict]:
    earned: dict[str, datetime | None] = {}

    if sessions:
        earned["first_session"] = _to_utc(sessions[0]["created_at"])

    if streak_best >= 3:
        earned["streak_3"] = None
    if streak_best >= 7:
        earned["streak_7"] = None
    if streak_best >= 14:
        earned["streak_14"] = None

    if len(sessions) >= 10:
        earned["sessions_10"] = _to_utc(sessions[9]["created_at"])
    if len(sessions) >= 25:
        earned["sessions_25"] = _to_utc(sessions[24]["created_at"])

    if total_minutes >= 10:
        earned["minutes_10"] = None
    if total_minutes >= 30:
        earned["minutes_30"] = None

    if any(int(s["rating"]) >= 8 for s in sessions):
        earned["rating_8"] = None
    if any(int(s["rating"]) >= 9 for s in sessions):
        earned["rating_9"] = None

    if any(int(s["filler_count"]) < 3 for s in sessions):
        earned["low_fillers"] = None

    if plans_count >= 2:
        earned["multi_plan"] = None

    out: list[dict] = []
    for item in _catalog(lang):
        aid = item["id"]
        out.append(
            {
                "id": aid,
                "label": item["label"],
                "description": item["description"],
                "earned": aid in earned,
                "earned_at": earned.get(aid),
            }
        )
    return out


def build_profile(
    sessions: list[dict],
    plans_count: int,
    tz_offset_minutes: int,
    now_utc: datetime | None = None,
    lang: Language = "pt",
) -> dict:
    """Sessions are expected to be ordered oldest → newest."""
    sessions = sorted(sessions, key=lambda r: _to_utc(r["created_at"]))
    now = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    today_local = _local_date(now, tz_offset_minutes)

    sessions_by_day: dict[date, list[dict]] = defaultdict(list)
    for s in sessions:
        d = _local_date(_to_utc(s["created_at"]), tz_offset_minutes)
        sessions_by_day[d].append(s)
    active_days = set(sessions_by_day.keys())

    streak_current, active_today = _current_streak(active_days, today_local)
    streak_best = _best_streak(active_days)

    total_sessions = len(sessions)
    total_minutes = round(sum(float(s["audio_duration_s"]) for s in sessions) / 60.0, 1)
    avg_wpm = (
        round(sum(float(s["wpm"]) for s in sessions) / total_sessions, 1)
        if total_sessions
        else None
    )
    best_rating = max((int(s["rating"]) for s in sessions), default=None)
    avg_rating = (
        round(sum(int(s["rating"]) for s in sessions) / total_sessions, 1)
        if total_sessions
        else None
    )

    filler_counter: Counter[str] = Counter()
    for s in sessions:
        tf = s.get("top_filler")
        if tf:
            filler_counter[tf] += 1
    top_filler = filler_counter.most_common(1)[0][0] if filler_counter else None

    activity_365 = []
    for i in range(364, -1, -1):
        d = today_local - timedelta(days=i)
        activity_365.append({"date": d, "sessions": len(sessions_by_day.get(d, []))})

    wpm_trend = []
    rating_trend = []
    days_sorted = sorted(sessions_by_day.keys())
    for d in days_sorted[-14:]:
        day_rows = sessions_by_day[d]
        wpm_trend.append(
            {
                "date": d,
                "wpm": round(sum(float(r["wpm"]) for r in day_rows) / len(day_rows), 1),
            }
        )
        rating_trend.append(
            {
                "date": d,
                "rating": round(sum(int(r["rating"]) for r in day_rows) / len(day_rows), 1),
            }
        )

    achievements = _compute_achievements(
        sessions, plans_count, total_minutes, streak_best, lang=lang
    )

    return {
        "streak_current": streak_current,
        "streak_best": streak_best,
        "streak_active_today": active_today,
        "total_sessions": total_sessions,
        "total_minutes": total_minutes,
        "avg_wpm": avg_wpm,
        "best_rating": best_rating,
        "avg_rating": avg_rating,
        "top_filler": top_filler,
        "plans_count": plans_count,
        "activity_365": activity_365,
        "wpm_trend": wpm_trend,
        "rating_trend": rating_trend,
        "achievements": achievements,
    }
