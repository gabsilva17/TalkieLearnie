import re
from datetime import date as _date
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response

from ..db import get_supabase
from ..schemas import PlanDayOut, PlanOut, RenamePlanReq
from ..services.plan_gen import generate_plan_days

router = APIRouter(prefix="/plans", tags=["plans"])

EXTRAS_DIR = Path(__file__).resolve().parents[2] / "data" / "extras"
_EXTRAS_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+\.pdf$")

# Mirror the Anthropic platform limit so a too-big PDF fails fast on the
# backend with a clean error rather than blowing up later inside the SDK.
MAX_PDF_BYTES = 32 * 1024 * 1024

FocusMode = Literal["communication", "technical", "both"]


def _extras_url(request: Request | None, filename: str | None) -> str | None:
    if not filename:
        return None
    if request is None:
        return f"/plans/extras/{filename}"
    return str(request.url_for("get_plan_extra", filename=filename))


def _plan_row_to_out(
    plan_row: dict,
    day_rows: list[dict],
    request: Request | None = None,
) -> PlanOut:
    days = [
        PlanDayOut(
            id=d["id"],
            day_index=d["day_index"],
            day_date=d["day_date"],
            theme=d["theme"],
            question=d["question"],
            completed_at=d.get("completed_at"),
        )
        for d in sorted(day_rows, key=lambda d: d["day_index"])
    ]
    return PlanOut(
        id=plan_row["id"],
        prep_for=plan_row["prep_for"],
        name=plan_row.get("name"),
        target_date=plan_row["target_date"],
        audience_info=plan_row["audience_info"],
        extra_text=plan_row.get("extra_text"),
        extra_pdf_url=_extras_url(request, plan_row.get("extra_pdf_filename")),
        focus_mode=plan_row.get("focus_mode"),
        created_at=plan_row["created_at"],
        days=days,
    )


@router.post("", response_model=PlanOut)
def create_plan(
    request: Request,
    device_id: str = Form(min_length=1),
    prep_for: str = Form(min_length=1),
    target_date: _date = Form(...),
    audience_info: str = Form(min_length=1),
    extra_text: str | None = Form(default=None),
    focus_mode: str | None = Form(default=None),
    pdf: UploadFile | None = File(default=None),
) -> PlanOut:
    # Normalize blank-string form values (the mobile client just sends "" when
    # the user skipped the optional step).
    extra_text = (extra_text or "").strip() or None
    focus_mode = (focus_mode or "").strip() or None
    if focus_mode is not None and focus_mode not in ("communication", "technical", "both"):
        raise HTTPException(status_code=400, detail="invalid focus_mode")

    pdf_bytes: bytes | None = None
    pdf_original_name: str | None = None
    if pdf is not None and pdf.filename:
        try:
            pdf_bytes = pdf.file.read()
        finally:
            pdf.file.close()
        if not pdf_bytes:
            pdf_bytes = None
        else:
            if len(pdf_bytes) > MAX_PDF_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"PDF maior do que {MAX_PDF_BYTES // (1024 * 1024)} MB",
                )
            ctype = (pdf.content_type or "").lower()
            if ctype and ctype != "application/pdf":
                raise HTTPException(status_code=400, detail="o ficheiro tem de ser PDF")
            pdf_original_name = pdf.filename

    try:
        gen = generate_plan_days(
            prep_for,
            target_date,
            audience_info,
            extra_text=extra_text,
            pdf_bytes=pdf_bytes,
            focus_mode=focus_mode,  # type: ignore[arg-type]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"plan-gen failed: {e}")
    days = gen["days"]
    plan_name = gen["name"]

    # Persist the PDF only after generation succeeds. Best-effort: a write
    # failure must not block the plan being saved.
    pdf_filename: str | None = None
    if pdf_bytes:
        try:
            EXTRAS_DIR.mkdir(parents=True, exist_ok=True)
            pdf_filename = f"{uuid4().hex}.pdf"
            (EXTRAS_DIR / pdf_filename).write_bytes(pdf_bytes)
        except Exception as e:
            print(f"warning: failed to persist plan PDF ({pdf_original_name}): {e}")
            pdf_filename = None

    sb = get_supabase()
    plan_ins = (
        sb.table("plans")
        .insert(
            {
                "device_id": device_id,
                "prep_for": prep_for,
                "name": plan_name,
                "target_date": target_date.isoformat(),
                "audience_info": audience_info,
                "extra_text": extra_text,
                "extra_pdf_filename": pdf_filename,
                "focus_mode": focus_mode,
            }
        )
        .execute()
    )
    plan_row = plan_ins.data[0]

    day_rows_in = [{"plan_id": plan_row["id"], **d} for d in days]
    days_ins = sb.table("plan_days").insert(day_rows_in).execute()
    return _plan_row_to_out(plan_row, days_ins.data, request)


@router.get("/current", response_model=PlanOut | None)
def get_current_plan(
    request: Request, device_id: str = Query(min_length=1)
) -> PlanOut | None:
    sb = get_supabase()
    plan_q = (
        sb.table("plans")
        .select("*")
        .eq("device_id", device_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not plan_q.data:
        return None
    plan_row = plan_q.data[0]
    days_q = sb.table("plan_days").select("*").eq("plan_id", plan_row["id"]).execute()
    return _plan_row_to_out(plan_row, days_q.data, request)


@router.get("", response_model=list[PlanOut])
def list_plans(request: Request, device_id: str = Query(min_length=1)) -> list[PlanOut]:
    sb = get_supabase()
    plans_q = (
        sb.table("plans")
        .select("*")
        .eq("device_id", device_id)
        .order("created_at", desc=True)
        .execute()
    )
    if not plans_q.data:
        return []
    plan_ids = [p["id"] for p in plans_q.data]
    days_q = sb.table("plan_days").select("*").in_("plan_id", plan_ids).execute()
    by_plan: dict[str, list[dict]] = {}
    for d in days_q.data:
        by_plan.setdefault(d["plan_id"], []).append(d)
    return [_plan_row_to_out(p, by_plan.get(p["id"], []), request) for p in plans_q.data]


@router.get("/extras/{filename}", name="get_plan_extra")
def get_plan_extra(filename: str):
    if not _EXTRAS_NAME_RE.fullmatch(filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = EXTRAS_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="pdf not found")
    return FileResponse(path, media_type="application/pdf", filename=filename)


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(
    plan_id: UUID, request: Request, device_id: str = Query(min_length=1)
) -> PlanOut:
    sb = get_supabase()
    plan_q = sb.table("plans").select("*").eq("id", str(plan_id)).limit(1).execute()
    if not plan_q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    plan_row = plan_q.data[0]
    if plan_row["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")
    days_q = sb.table("plan_days").select("*").eq("plan_id", plan_row["id"]).execute()
    return _plan_row_to_out(plan_row, days_q.data, request)


@router.patch("/{plan_id}", response_model=PlanOut)
def rename_plan(plan_id: UUID, req: RenamePlanReq, request: Request) -> PlanOut:
    sb = get_supabase()
    plan_q = sb.table("plans").select("*").eq("id", str(plan_id)).limit(1).execute()
    if not plan_q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    if plan_q.data[0]["device_id"] != req.device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")
    upd = (
        sb.table("plans")
        .update({"name": req.name.strip()})
        .eq("id", str(plan_id))
        .execute()
    )
    plan_row = upd.data[0]
    days_q = sb.table("plan_days").select("*").eq("plan_id", plan_row["id"]).execute()
    return _plan_row_to_out(plan_row, days_q.data, request)


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, device_id: str = Query(min_length=1)) -> Response:
    sb = get_supabase()
    plan_q = (
        sb.table("plans")
        .select("id, device_id, extra_pdf_filename")
        .eq("id", str(plan_id))
        .limit(1)
        .execute()
    )
    if not plan_q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    if plan_q.data[0]["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")
    pdf_name = plan_q.data[0].get("extra_pdf_filename")
    sb.table("plans").delete().eq("id", str(plan_id)).execute()
    # Best-effort: clean up the attached PDF too. Ignore errors so a missing
    # file on disk never blocks the delete response.
    if pdf_name and _EXTRAS_NAME_RE.fullmatch(pdf_name):
        try:
            (EXTRAS_DIR / pdf_name).unlink(missing_ok=True)
        except Exception:
            pass
    return Response(status_code=204)
