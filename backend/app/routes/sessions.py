import mimetypes
import re
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from ..db import get_supabase
from ..schemas import SessionOut
from ..services.analyze import analyze
from ..services.metrics import compute_metrics
from ..services.transcribe import transcribe_pt

router = APIRouter(prefix="/sessions", tags=["sessions"])

AUDIO_DIR = Path(__file__).resolve().parents[2] / "data" / "audio"
_AUDIO_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9]+$")


def _audio_url(request: Request | None, filename: str | None) -> str | None:
    if not filename:
        return None
    if request is None:
        return f"/sessions/audio/{filename}"
    return str(request.url_for("get_session_audio", filename=filename))


def _row_to_out(row: dict, request: Request | None = None) -> SessionOut:
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
    )


@router.post("", response_model=SessionOut)
def create_session(
    request: Request,
    plan_day_id: UUID = Form(...),
    device_id: str = Form(min_length=1),
    audio: UploadFile = File(...),
) -> SessionOut:
    sb = get_supabase()
    day_q = sb.table("plan_days").select("*, plans(*)").eq("id", str(plan_day_id)).execute()
    if not day_q.data:
        raise HTTPException(status_code=404, detail="plan_day not found")
    day = day_q.data[0]
    plan = day["plans"]
    if plan["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="plan_day does not belong to device_id")

    if str(day["day_date"]) != date.today().isoformat():
        raise HTTPException(status_code=403, detail="só podes gravar a sessão do dia de hoje")

    existing = (
        sb.table("sessions")
        .select("id")
        .eq("plan_day_id", str(plan_day_id))
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="session already exists for this plan_day")

    try:
        audio_bytes = audio.file.read()
    finally:
        audio.file.close()

    try:
        whisper = transcribe_pt(
            audio_bytes,
            filename=audio.filename or "answer.m4a",
            content_type=audio.content_type or "audio/m4a",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"transcribe failed: {e}")

    transcript = whisper.get("text", "").strip()
    duration_s = float(whisper.get("duration") or 0.0)
    words = whisper.get("words") or []

    metrics = compute_metrics(transcript, words, duration_s)

    try:
        feedback = analyze(
            transcript=transcript,
            metrics=metrics,
            duration_s=duration_s,
            prep_for=plan["prep_for"],
            audience_info=plan["audience_info"],
            theme=day["theme"],
            question=day["question"],
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

    sess_ins = (
        sb.table("sessions")
        .insert(
            {
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
        )
        .execute()
    )
    sb.table("plan_days").update({"completed_at": "now()"}).eq("id", str(plan_day_id)).execute()

    return _row_to_out(sess_ins.data[0], request)


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
