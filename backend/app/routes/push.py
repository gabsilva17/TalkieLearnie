import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import get_supabase

router = APIRouter(prefix="/push", tags=["push"])

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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


class RegisterTokenReq(BaseModel):
    device_id: str = Field(min_length=1)
    token: str = Field(min_length=1)
    platform: str | None = None


@router.post("/register")
def register_token(req: RegisterTokenReq) -> dict:
    # Upsert: a given device may rotate its token (Expo can re-issue). Latest
    # write wins. Absence of a row means "no remote push, use pending_pushes".
    sb = get_supabase()
    sb.table("expo_push_tokens").upsert(
        {
            "device_id": req.device_id,
            "token": req.token,
            "platform": req.platform,
            "updated_at": "now()",
        },
        on_conflict="device_id",
    ).execute()
    return {"ok": True}


@router.delete("/register")
def unregister_token(device_id: str = Query(min_length=1)) -> dict:
    sb = get_supabase()
    sb.table("expo_push_tokens").delete().eq("device_id", device_id).execute()
    return {"ok": True}


def send_via_expo(token: str, title: str, body: str) -> dict:
    """Send a single push via Expo Push API. Returns the Expo response payload.

    Caller must catch HTTP errors; we surface them so the admin endpoint can
    decide whether to fall back to the polling queue.
    """
    payload = {
        "to": token,
        "title": title,
        "body": body,
        "sound": "default",
        "priority": "high",
        "channelId": "default",
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(
            EXPO_PUSH_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            },
        )
        resp.raise_for_status()
        return resp.json()


def get_token_for(device_id: str) -> str | None:
    sb = get_supabase()
    rows = (
        sb.table("expo_push_tokens")
        .select("token")
        .eq("device_id", device_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return None
    return rows[0]["token"]
