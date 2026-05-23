from fastapi import APIRouter, Query

from ..db import get_supabase

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/pending")
def get_pending(device_id: str = Query(min_length=1)) -> list[dict]:
    sb = get_supabase()
    rows = (
        sb.table("pending_pushes")
        .select("*")
        .eq("device_id", device_id)
        .order("created_at", desc=False)
        .execute()
        .data
    )
    return rows


@router.post("/pending/{push_id}/ack")
def ack_pending(push_id: str) -> dict:
    # Idempotent: deleting an already-deleted row is a no-op.
    sb = get_supabase()
    sb.table("pending_pushes").delete().eq("id", push_id).execute()
    return {"ok": True}
