import mimetypes
import re
from datetime import date
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from ..db import get_supabase
from ..schemas import ReanalyzeSessionReq, SessionCelebrations, SessionOut
from ..services.analyze import analyze
from ..services.metrics import compute_metrics
from ..services.profile import build_profile
from ..services.transcribe import transcribe

router = APIRouter(prefix="/sessions", tags=["sessions"])

Language = Literal["pt", "en"]

AUDIO_DIR = Path(__file__).resolve().parents[2] / "data" / "audio"
_AUDIO_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9]+$")

# Minimum recording length we'll grade. Below this we have too little speech
# for the pacing / filler / WPM metrics to mean anything, and Sonnet ends up
# inventing feedback. Bounce the user back to re-record instead.
MIN_SESSION_DURATION_S = 5.0

# Localised user-visible error messages emitted by POST /sessions. Same
# pattern as plans: inline tiny dicts per language instead of pulling in the
# mobile i18n layer.
_ERR_DAY_NOT_TODAY = {
    "pt": "só podes gravar a sessão do dia de hoje",
    "en": "you can only record today's session",
}
_ERR_NO_SPEECH = {
    "pt": (
        "Não percebi nada do que disseste. Confirma que o microfone "
        "está activo, fala para o microfone e tenta de novo."
    ),
    "en": (
        "I couldn't make out anything. Check that the microphone is on, "
        "speak into it, and try again."
    ),
}
_ERR_TOO_SHORT = {
    "pt": (
        "A tua gravação foi demasiado curta. Precisamos de pelo menos "
        "5 segundos para te darmos um feedback útil. Responde com um "
        "pouco mais de detalhe e tenta de novo."
    ),
    "en": (
        "Your recording was too short. We need at least 5 seconds to give "
        "you useful feedback. Add a bit more detail and try again."
    ),
}


def _audio_url(request: Request | None, filename: str | None) -> str | None:
    if not filename:
        return None
    if request is None:
        return f"/sessions/audio/{filename}"
    return str(request.url_for("get_session_audio", filename=filename))


def _row_to_out(
    row: dict,
    request: Request | None = None,
    celebrations: SessionCelebrations | None = None,
) -> SessionOut:
    return SessionOut(
        id=row["id"],
        plan_day_id=row["plan_day_id"],
        audio_duration_s=float(row["audio_duration_s"]),
        audio_url=_audio_url(request, row.get("audio_filename")),
        transcript=row["transcript"],
        wpm=float(row["wpm"]),
        filler_count=int(row["filler_count"]),
        top_filler=row.get("top_filler"),
        filler_timestamps=row.get("filler_timestamps") or [],
        pacing_variation=float(row["pacing_variation"]),
        rating=int(row["rating"]),
        feedback=row["feedback_json"],
        created_at=row["created_at"],
        celebrations=celebrations,
    )


@router.post("", response_model=SessionOut)
def create_session(
    request: Request,
    plan_day_id: UUID = Form(...),
    device_id: str = Form(min_length=1),
    audio: UploadFile = File(...),
    tz_offset_minutes: int = Form(default=0, ge=-14 * 60, le=14 * 60),
) -> SessionOut:
    sb = get_supabase()
    day_q = sb.table("plan_days").select("*, plans(*)").eq("id", str(plan_day_id)).execute()
    if not day_q.data:
        raise HTTPException(status_code=404, detail="plan_day not found")
    day = day_q.data[0]
    plan = day["plans"]
    if plan["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="plan_day does not belong to device_id")

    # Plan-scoped language: every downstream LLM call uses the language the
    # plan was created in, regardless of the device's current UI toggle.
    raw_lang = plan.get("language") or "pt"
    lang: Language = "en" if raw_lang == "en" else "pt"

    if str(day["day_date"]) != date.today().isoformat():
        raise HTTPException(status_code=403, detail=_ERR_DAY_NOT_TODAY[lang])

    existing = (
        sb.table("sessions")
        .select("id, audio_filename")
        .eq("plan_day_id", str(plan_day_id))
        .limit(1)
        .execute()
    )
    existing_row = existing.data[0] if existing.data else None
    is_retry = existing_row is not None

    # Snapshot the BEFORE state for celebration detection. Skip entirely on
    # retries — celebrations fire only once per plan_day_id and were already
    # delivered on the first session of the day. Pull every existing session
    # row for this device — these are what the next-state diff is measured
    # against. Cheap (one query per table) and runs while the audio is being
    # read; the upload latency dominates anyway.
    before_sessions: list[dict] = []
    before_plans_count = 0
    before_profile = None
    if not is_retry:
        plan_ids_q = sb.table("plans").select("id").eq("device_id", device_id).execute()
        before_plan_ids = [p["id"] for p in (plan_ids_q.data or [])]
        before_plans_count = len(before_plan_ids)
        before_day_ids: list[str] = []
        if before_plan_ids:
            days_q = (
                sb.table("plan_days")
                .select("id")
                .in_("plan_id", before_plan_ids)
                .execute()
            )
            before_day_ids = [d["id"] for d in (days_q.data or [])]
        if before_day_ids:
            sess_q = (
                sb.table("sessions")
                .select(
                    "created_at, audio_duration_s, wpm, filler_count, top_filler, rating"
                )
                .in_("plan_day_id", before_day_ids)
                .execute()
            )
            before_sessions = sess_q.data or []
        before_profile = build_profile(
            before_sessions, before_plans_count, tz_offset_minutes, lang=lang
        )

    try:
        audio_bytes = audio.file.read()
    finally:
        audio.file.close()

    try:
        whisper = transcribe(
            audio_bytes,
            filename=audio.filename or "answer.m4a",
            content_type=audio.content_type or "audio/m4a",
            lang=lang,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"transcribe failed: {e}")

    transcript = whisper.get("text", "").strip()
    duration_s = float(whisper.get("duration") or 0.0)
    words = whisper.get("words") or []

    # Filter junk recordings (silence, accidental taps, 2-second tests) before
    # we spend Sonnet tokens and write to the DB. Two distinct messages so the
    # user knows what to fix on the retry.
    if not transcript:
        raise HTTPException(status_code=422, detail=_ERR_NO_SPEECH[lang])
    if duration_s < MIN_SESSION_DURATION_S:
        raise HTTPException(status_code=422, detail=_ERR_TOO_SHORT[lang])

    metrics = compute_metrics(transcript, words, duration_s, lang=lang)

    try:
        feedback = analyze(
            transcript=transcript,
            metrics=metrics,
            duration_s=duration_s,
            prep_for=plan["prep_for"],
            audience_info=plan["audience_info"],
            theme=day["theme"],
            question=day["question"],
            lang=lang,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"analyze failed: {e}")

    # Persist the audio to disk so the user can replay it on the result screen.
    # Best-effort: a write failure must not block the session being saved.
    audio_filename: str | None = None
    try:
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        ext = Path(audio.filename or "").suffix.lower() or ".m4a"
        if not re.fullmatch(r"\.[A-Za-z0-9]{1,8}", ext):
            ext = ".m4a"
        audio_filename = f"{uuid4().hex}{ext}"
        (AUDIO_DIR / audio_filename).write_bytes(audio_bytes)
    except Exception as e:
        print(f"warning: failed to persist audio file: {e}")
        audio_filename = None

    session_payload = {
        "plan_day_id": str(plan_day_id),
        "audio_duration_s": duration_s,
        "audio_filename": audio_filename,
        "transcript": transcript,
        "wpm": metrics["wpm"],
        "filler_count": metrics["filler_count"],
        "top_filler": metrics["top_filler"],
        "filler_timestamps": metrics["filler_timestamps"],
        "pacing_variation": metrics["pacing_variation"],
        "rating": int(feedback["rating"]),
        "feedback_json": feedback,
    }

    if is_retry:
        # Overwrite the existing row in place. completed_at on plan_days
        # stays as-is — the day was already closed by the first session.
        # Best-effort clean up the previous audio file to avoid orphans.
        prev_audio = existing_row.get("audio_filename") if existing_row else None
        if prev_audio and _AUDIO_NAME_RE.fullmatch(prev_audio):
            try:
                (AUDIO_DIR / prev_audio).unlink(missing_ok=True)
            except Exception as e:
                print(f"warning: failed to delete previous audio file: {e}")
        upd = (
            sb.table("sessions")
            .update(session_payload)
            .eq("id", existing_row["id"])
            .execute()
        )
        if not upd.data:
            raise HTTPException(status_code=500, detail="failed to update session")
        # No celebration diff on retries — they all fired on the first
        # session of the day. Returning None matches the GET /sessions
        # contract for historical rows.
        return _row_to_out(upd.data[0], request, celebrations=None)

    sess_ins = sb.table("sessions").insert(session_payload).execute()
    new_session_row = sess_ins.data[0]
    sb.table("plan_days").update({"completed_at": "now()"}).eq("id", str(plan_day_id)).execute()

    # Compute the AFTER profile by appending the just-inserted session in
    # memory. Avoids re-querying the sessions table (and any read-your-write
    # latency that might bring).
    after_sessions = list(before_sessions) + [
        {
            "created_at": new_session_row["created_at"],
            "audio_duration_s": duration_s,
            "wpm": metrics["wpm"],
            "filler_count": metrics["filler_count"],
            "top_filler": metrics["top_filler"],
            "rating": int(feedback["rating"]),
        }
    ]
    after_profile = build_profile(
        after_sessions, before_plans_count, tz_offset_minutes, lang=lang
    )

    before_earned = {
        a["id"] for a in before_profile["achievements"] if a["earned"]
    }
    newly_earned = [
        a for a in after_profile["achievements"] if a["earned"] and a["id"] not in before_earned
    ]

    streak_just_activated = (
        not before_profile["streak_active_today"]
        and after_profile["streak_active_today"]
    )
    streak_is_new_best = (
        after_profile["streak_current"] >= 2
        and after_profile["streak_current"] == after_profile["streak_best"]
    )

    # Plan completion: did this session close the last incomplete day in the
    # plan? Re-query plan_days to include the row we just marked completed.
    plan_days_q = (
        sb.table("plan_days")
        .select("id, completed_at")
        .eq("plan_id", plan["id"])
        .execute()
    )
    plan_days_rows = plan_days_q.data or []
    plan_total_days = len(plan_days_rows)
    plan_just_completed = (
        plan_total_days > 0 and all(d.get("completed_at") for d in plan_days_rows)
    )

    celebrations = SessionCelebrations(
        newly_earned_achievements=newly_earned,
        streak_just_activated=streak_just_activated,
        streak_current=after_profile["streak_current"],
        streak_best=after_profile["streak_best"],
        streak_is_new_best=streak_is_new_best,
        plan_just_completed=plan_just_completed,
        plan_id=plan["id"] if plan_just_completed else None,
        plan_prep_for=plan["prep_for"] if plan_just_completed else None,
        plan_total_days=plan_total_days if plan_just_completed else None,
    )

    return _row_to_out(new_session_row, request, celebrations=celebrations)


@router.post("/{session_id}/reanalyze", response_model=SessionOut)
def reanalyze_session(
    request: Request,
    session_id: UUID,
    body: ReanalyzeSessionReq,
) -> SessionOut:
    """Re-run Sonnet (and the text-derived metrics) against a user-corrected
    transcript. Audio-derived signals — pacing_variation and the original
    filler_timestamps — are preserved because we don't have word-level
    timings for the edited text.
    """
    sb = get_supabase()
    sess_q = (
        sb.table("sessions")
        .select("*, plan_days(*, plans(*))")
        .eq("id", str(session_id))
        .execute()
    )
    if not sess_q.data:
        raise HTTPException(status_code=404, detail="session not found")
    row = sess_q.data[0]
    plan_day = row["plan_days"]
    plan = plan_day["plans"]
    if plan["device_id"] != body.device_id:
        raise HTTPException(
            status_code=403, detail="session does not belong to device_id"
        )

    new_transcript = body.transcript.strip()
    if not new_transcript:
        raise HTTPException(status_code=400, detail="transcript cannot be empty")

    duration_s = float(row["audio_duration_s"])

    raw_lang = plan.get("language") or "pt"
    lang: Language = "en" if raw_lang == "en" else "pt"

    # Recompute the text-derived metrics from the edited transcript. We have
    # no word-level timestamps for the new text, so pacing_variation and the
    # filler_timestamps array carry over from the original (audio-derived)
    # values.
    text_metrics = compute_metrics(new_transcript, [], duration_s, lang=lang)
    metrics_for_judge = {
        **text_metrics,
        "pacing_variation": float(row["pacing_variation"]),
    }

    try:
        feedback = analyze(
            transcript=new_transcript,
            metrics=metrics_for_judge,
            duration_s=duration_s,
            prep_for=plan["prep_for"],
            audience_info=plan["audience_info"],
            theme=plan_day["theme"],
            question=plan_day["question"],
            lang=lang,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"analyze failed: {e}")

    upd = (
        sb.table("sessions")
        .update(
            {
                "transcript": new_transcript,
                "wpm": text_metrics["wpm"],
                "filler_count": text_metrics["filler_count"],
                "top_filler": text_metrics["top_filler"],
                "rating": int(feedback["rating"]),
                "feedback_json": feedback,
            }
        )
        .eq("id", str(session_id))
        .execute()
    )
    if not upd.data:
        raise HTTPException(status_code=500, detail="failed to update session")
    return _row_to_out(upd.data[0], request)


@router.get("/audio/{filename}", name="get_session_audio")
def get_session_audio(filename: str):
    if not _AUDIO_NAME_RE.fullmatch(filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = AUDIO_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="audio not found")
    media_type = mimetypes.guess_type(filename)[0] or "audio/m4a"
    return FileResponse(path, media_type=media_type, filename=filename)


@router.get("", response_model=list[SessionOut])
def list_sessions(
    request: Request,
    plan_day_id: UUID | None = Query(default=None),
    device_id: str | None = Query(default=None, min_length=1),
) -> list[SessionOut]:
    if not plan_day_id and not device_id:
        raise HTTPException(status_code=400, detail="provide plan_day_id or device_id")
    sb = get_supabase()
    if plan_day_id:
        q = (
            sb.table("sessions")
            .select("*")
            .eq("plan_day_id", str(plan_day_id))
            .order("created_at", desc=True)
            .execute()
        )
        return [_row_to_out(r, request) for r in q.data]

    plans_q = sb.table("plans").select("id").eq("device_id", device_id).execute()
    plan_ids = [p["id"] for p in plans_q.data]
    if not plan_ids:
        return []
    days_q = sb.table("plan_days").select("id").in_("plan_id", plan_ids).execute()
    day_ids = [d["id"] for d in days_q.data]
    if not day_ids:
        return []
    q = (
        sb.table("sessions")
        .select("*")
        .in_("plan_day_id", day_ids)
        .order("created_at", desc=True)
        .execute()
    )
    return [_row_to_out(r, request) for r in q.data]
