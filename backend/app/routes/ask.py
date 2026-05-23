from fastapi import APIRouter, HTTPException

from ..db import get_supabase
from ..schemas import AskReq, AskResp
from ..services.ask import answer

router = APIRouter(prefix="/ask", tags=["ask"])


@router.post("", response_model=AskResp)
def ask(req: AskReq) -> AskResp:
    if req.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="last message must be from the user")

    plan_ctx: dict | None = None
    if req.plan_id is not None:
        sb = get_supabase()
        q = (
            sb.table("plans")
            .select("device_id, prep_for, target_date, audience_info")
            .eq("id", str(req.plan_id))
            .limit(1)
            .execute()
        )
        if not q.data:
            raise HTTPException(status_code=404, detail="plan not found")
        row = q.data[0]
        if row["device_id"] != req.device_id:
            raise HTTPException(status_code=403, detail="plan does not belong to device_id")
        plan_ctx = {
            "prep_for": row["prep_for"],
            "target_date": row["target_date"],
            "audience_info": row["audience_info"],
        }

    try:
        reply = answer(
            [{"role": m.role, "content": m.content} for m in req.messages],
            plan_ctx=plan_ctx,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ask failed: {e}")

    if not reply:
        raise HTTPException(status_code=502, detail="empty reply from model")
    return AskResp(reply=reply)
