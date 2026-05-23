from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..db import get_supabase
from ..schemas import CreatePlanReq, PlanDayOut, PlanOut, RenamePlanReq
from ..services.plan_gen import generate_plan_days

router = APIRouter(prefix="/plans", tags=["plans"])


def _plan_row_to_out(plan_row: dict, day_rows: list[dict]) -> PlanOut:
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
        target_date=plan_row["target_date"],
        audience_info=plan_row["audience_info"],
        created_at=plan_row["created_at"],
        days=days,
    )


@router.post("", response_model=PlanOut)
def create_plan(req: CreatePlanReq) -> PlanOut:
    try:
        days = generate_plan_days(req.prep_for, req.target_date, req.audience_info)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"plan-gen failed: {e}")

    sb = get_supabase()
    plan_ins = (
        sb.table("plans")
        .insert(
            {
                "device_id": req.device_id,
                "prep_for": req.prep_for,
                "target_date": req.target_date.isoformat(),
                "audience_info": req.audience_info,
            }
        )
        .execute()
    )
    plan_row = plan_ins.data[0]

    day_rows_in = [{"plan_id": plan_row["id"], **d} for d in days]
    days_ins = sb.table("plan_days").insert(day_rows_in).execute()
    return _plan_row_to_out(plan_row, days_ins.data)


@router.get("/current", response_model=PlanOut | None)
def get_current_plan(device_id: str = Query(min_length=1)) -> PlanOut | None:
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
    return _plan_row_to_out(plan_row, days_q.data)


@router.get("", response_model=list[PlanOut])
def list_plans(device_id: str = Query(min_length=1)) -> list[PlanOut]:
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
    return [_plan_row_to_out(p, by_plan.get(p["id"], [])) for p in plans_q.data]


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: UUID, device_id: str = Query(min_length=1)) -> PlanOut:
    sb = get_supabase()
    plan_q = sb.table("plans").select("*").eq("id", str(plan_id)).limit(1).execute()
    if not plan_q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    plan_row = plan_q.data[0]
    if plan_row["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")
    days_q = sb.table("plan_days").select("*").eq("plan_id", plan_row["id"]).execute()
    return _plan_row_to_out(plan_row, days_q.data)


@router.patch("/{plan_id}", response_model=PlanOut)
def rename_plan(plan_id: UUID, req: RenamePlanReq) -> PlanOut:
    sb = get_supabase()
    plan_q = sb.table("plans").select("*").eq("id", str(plan_id)).limit(1).execute()
    if not plan_q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    if plan_q.data[0]["device_id"] != req.device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")
    upd = (
        sb.table("plans")
        .update({"prep_for": req.prep_for.strip()})
        .eq("id", str(plan_id))
        .execute()
    )
    plan_row = upd.data[0]
    days_q = sb.table("plan_days").select("*").eq("plan_id", plan_row["id"]).execute()
    return _plan_row_to_out(plan_row, days_q.data)


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, device_id: str = Query(min_length=1)) -> Response:
    sb = get_supabase()
    plan_q = sb.table("plans").select("id, device_id").eq("id", str(plan_id)).limit(1).execute()
    if not plan_q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    if plan_q.data[0]["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")
    sb.table("plans").delete().eq("id", str(plan_id)).execute()
    return Response(status_code=204)
