from fastapi import APIRouter, HTTPException

from ..db import get_supabase
from ..schemas import MotivationReq, MotivationResp
from ..services.motivation import FALLBACK_EN, FALLBACK_PT, motivate

router = APIRouter(prefix="/motivation", tags=["motivation"])


@router.post("", response_model=MotivationResp)
def motivation(req: MotivationReq) -> MotivationResp:
    sb = get_supabase()
    q = (
        sb.table("plans")
        .select("device_id, prep_for, language")
        .eq("id", str(req.plan_id))
        .limit(1)
        .execute()
    )
    if not q.data:
        raise HTTPException(status_code=404, detail="plan not found")
    row = q.data[0]
    if row["device_id"] != req.device_id:
        raise HTTPException(status_code=403, detail="plan does not belong to device_id")

    # Prefer the request's language if set, otherwise the plan's stored
    # language. This lets the mobile client always be explicit but keeps
    # backward compatibility when the field is omitted.
    lang = req.lang or (row.get("language") or "pt")
    if lang not in ("pt", "en"):
        lang = "pt"
    fallback = FALLBACK_EN if lang == "en" else FALLBACK_PT

    message = motivate(row.get("prep_for") or "", lang=lang)
    return MotivationResp(message=message or fallback)
