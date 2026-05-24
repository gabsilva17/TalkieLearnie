from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from ..db import get_supabase

router = APIRouter(prefix="/admin", tags=["admin"])

# Any UUID that will never exist — used to satisfy supabase-py's required filter on delete.
_NEVER_ID = "00000000-0000-0000-0000-000000000000"


@router.get("", response_class=HTMLResponse)
def admin_page() -> str:
    return _ADMIN_HTML


@router.get("/data")
def admin_data() -> dict:
    sb = get_supabase()
    plans = (
        sb.table("plans").select("*").order("created_at", desc=True).execute().data
    )
    plan_days = (
        sb.table("plan_days").select("*").order("day_index", desc=False).execute().data
    )
    sessions = (
        sb.table("sessions").select("*").order("created_at", desc=True).execute().data
    )
    pending_pushes = (
        sb.table("pending_pushes").select("*").order("created_at", desc=True).execute().data
    )
    return {
        "counts": {
            "plans": len(plans),
            "plan_days": len(plan_days),
            "sessions": len(sessions),
            "pending_pushes": len(pending_pushes),
        },
        "plans": plans,
        "plan_days": plan_days,
        "sessions": sessions,
        "pending_pushes": pending_pushes,
    }


@router.post("/reset")
def admin_reset() -> dict:
    sb = get_supabase()
    # Order matters even with ON DELETE CASCADE because we delete explicitly.
    sb.table("sessions").delete().neq("id", _NEVER_ID).execute()
    sb.table("plan_days").delete().neq("id", _NEVER_ID).execute()
    sb.table("plans").delete().neq("id", _NEVER_ID).execute()
    return {"ok": True}


class PushReq(BaseModel):
    device_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)


@router.post("/push")
def admin_push(req: PushReq) -> dict:
    # Enqueue a local notification; the mobile app polls /push/pending while
    # foregrounded and fires it via scheduleNotificationAsync. Works under
    # Expo Go (no remote push needed).
    sb = get_supabase()
    inserted = (
        sb.table("pending_pushes")
        .insert(
            {"device_id": req.device_id, "title": req.title, "body": req.body}
        )
        .execute()
        .data
    )
    return {"ok": True, "queued": inserted[0] if inserted else None}


_ADMIN_HTML = """<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8" />
<title>Talkie · Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: #0f1115;
    --panel: #171a21;
    --panel-2: #1f232c;
    --border: #2a2f3a;
    --text: #e6e8ee;
    --muted: #8b93a7;
    --accent: #7c9cff;
    --danger: #ff6b6b;
    --ok: #4ade80;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header {
    padding: 20px 24px; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    background: var(--panel);
  }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header .sub { color: var(--muted); font-size: 13px; }
  main { padding: 20px 24px; display: grid; gap: 20px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    padding: 8px 14px; border-radius: 6px; cursor: pointer; font: inherit;
  }
  button:hover { border-color: var(--accent); }
  button.danger { border-color: #6b2030; color: var(--danger); }
  button.danger:hover { background: #2a151a; }
  .counts { display: flex; gap: 12px; flex-wrap: wrap; }
  .count {
    background: var(--panel); border: 1px solid var(--border); padding: 8px 12px;
    border-radius: 6px;
  }
  .count b { color: var(--accent); font-weight: 600; margin-right: 6px; }
  section {
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    overflow: hidden;
  }
  section h2 {
    margin: 0; padding: 12px 16px; font-size: 13px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted);
    border-bottom: 1px solid var(--border); background: var(--panel-2);
  }
  .table-wrap { overflow-x: auto; max-height: 420px; overflow-y: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td {
    text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border);
    white-space: nowrap; vertical-align: top;
  }
  th {
    position: sticky; top: 0; background: var(--panel-2); color: var(--muted);
    font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  td.json { max-width: 360px; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); }
  td.id { font-family: ui-monospace, monospace; color: var(--muted); }
  .empty { padding: 24px 16px; color: var(--muted); }
  .push-form { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 16px; }
  .push-form input, .push-form select {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    padding: 8px 10px; border-radius: 6px; font: inherit; min-width: 180px;
  }
  .status { font-size: 13px; color: var(--muted); }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--danger); }
</style>
</head>
<body>
<header>
  <div>
    <h1>Talkie · Admin</h1>
    <div class="sub" id="updatedAt">-</div>
  </div>
  <div class="row">
    <button onclick="loadData()">↻ Refresh</button>
    <button class="danger" onclick="resetDb()">Reset DB</button>
  </div>
</header>
<main>
  <div class="counts" id="counts"></div>

  <section>
    <h2>Send push</h2>
    <form class="push-form" onsubmit="sendPush(event)">
      <select name="device_id" id="pushDevice" required></select>
      <input name="title" id="pushTitle" placeholder="Title" required />
      <input name="body" id="pushBody" placeholder="Body" required style="flex:1; min-width:240px" />
      <button type="submit">Send</button>
      <button type="button" onclick="sendDailyReminder()">🦜 Send daily reminder</button>
      <span class="status" id="pushStatus"></span>
    </form>
  </section>

  <section>
    <h2>pending_pushes (queued, not yet delivered)</h2>
    <div class="table-wrap" id="pending_pushes"></div>
  </section>

  <section>
    <h2>plans</h2>
    <div class="table-wrap" id="plans"></div>
  </section>

  <section>
    <h2>plan_days</h2>
    <div class="table-wrap" id="plan_days"></div>
  </section>

  <section>
    <h2>sessions</h2>
    <div class="table-wrap" id="sessions"></div>
  </section>
</main>

<script>
const PLAN_COLS = ["id", "device_id", "prep_for", "target_date", "audience_info", "created_at"];
const DAY_COLS = ["id", "plan_id", "day_index", "day_date", "theme", "question", "completed_at"];
const SESSION_COLS = [
  "id", "plan_day_id", "audio_duration_s", "wpm", "filler_count", "top_filler",
  "pacing_variation", "rating", "transcript", "feedback_json", "created_at"
];
const PENDING_PUSH_COLS = ["id", "device_id", "title", "body", "created_at"];

// Pre-fill copy for the Duolingo-style daily reminder button — pt-PT, on brand.
const DAILY_REMINDER_PRESETS = [
  { title: "🦜 Hora de praticar!", body: "A tua sessão de hoje está à espera. Não percas o teu streak, bastam 2 minutos." },
  { title: "🔥 Não deixes o streak cair", body: "Faltam só uns minutos para concluíres o treino de hoje. Vamos lá?" },
  { title: "🎙️ O microfone chama por ti", body: "A prática diária faz a diferença. Carrega para gravar a tua resposta de hoje." },
  { title: "🦜 Plim! Lembrete diário", body: "5 minutos de prática hoje = uma comunicação mais clara amanhã." },
];

function shortId(v) {
  if (typeof v !== "string") return v;
  if (v.length >= 36 && v.includes("-")) return v.slice(0, 8) + "…";
  return v;
}
function fmtCell(col, val) {
  if (val === null || val === undefined) return "-";
  if (col === "feedback_json" || (typeof val === "object")) {
    const s = JSON.stringify(val);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  }
  if (col === "transcript" && typeof val === "string" && val.length > 120) {
    return val.slice(0, 120) + "…";
  }
  if (col.endsWith("_id") || col === "id") return shortId(val);
  return String(val);
}
function renderTable(containerId, cols, rows) {
  const el = document.getElementById(containerId);
  if (!rows.length) { el.innerHTML = '<div class="empty">No rows.</div>'; return; }
  const head = cols.map(c => `<th>${c}</th>`).join("");
  const body = rows.map(r => {
    return "<tr>" + cols.map(c => {
      const v = fmtCell(c, r[c]);
      const cls = (c === "id" || c.endsWith("_id")) ? "id"
                : (c === "feedback_json" || c === "transcript") ? "json" : "";
      const title = (r[c] === null || r[c] === undefined) ? "" :
                    (typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c]));
      return `<td class="${cls}" title="${title.replace(/"/g, "&quot;")}">${v}</td>`;
    }).join("") + "</tr>";
  }).join("");
  el.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function renderCounts(counts) {
  document.getElementById("counts").innerHTML =
    Object.entries(counts).map(([k, v]) => `<div class="count"><b>${v}</b>${k}</div>`).join("");
}

function renderDeviceSelect(plans) {
  // Dropdown is populated from `plans` — that's every device that's onboarded.
  // Mobile must be foregrounded for the poll loop to pick the push up.
  const devices = Array.from(new Set(plans.map(p => p.device_id)));
  const sel = document.getElementById("pushDevice");
  const prev = sel.value;
  const opts = devices.map(d => `<option value="${d}">${shortId(d)}</option>`);
  sel.innerHTML = opts.length ? opts.join("") : `<option value="">(no devices yet)</option>`;
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

async function loadData() {
  try {
    const r = await fetch("/admin/data");
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    renderCounts(d.counts);
    renderDeviceSelect(d.plans);
    renderTable("plans", PLAN_COLS, d.plans);
    renderTable("plan_days", DAY_COLS, d.plan_days);
    renderTable("sessions", SESSION_COLS, d.sessions);
    renderTable("pending_pushes", PENDING_PUSH_COLS, d.pending_pushes || []);
    document.getElementById("updatedAt").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById("updatedAt").textContent = "Error: " + e.message;
  }
}

async function resetDb() {
  if (!confirm("Delete ALL plans, plan_days and sessions? This cannot be undone.")) return;
  if (!confirm("Really? Last chance.")) return;
  try {
    const r = await fetch("/admin/reset", { method: "POST" });
    if (!r.ok) throw new Error(await r.text());
    await loadData();
  } catch (e) {
    alert("Reset failed: " + e.message);
  }
}

async function postPush(payload) {
  const status = document.getElementById("pushStatus");
  status.className = "status";
  status.textContent = "sending…";
  try {
    const r = await fetch("/admin/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    if (r.ok) {
      status.className = "status ok";
      status.textContent = "queued (appears on device once it polls, ≤5s if foregrounded)";
      // Reload so the operator sees the row in pending_pushes, then watches it disappear after ack.
      loadData();
    } else {
      status.className = "status err";
      let msg = txt;
      try {
        const parsed = JSON.parse(txt).detail;
        msg = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      } catch {}
      status.textContent = msg;
    }
  } catch (e) {
    status.className = "status err";
    status.textContent = e.message;
  }
}

async function sendPush(ev) {
  ev.preventDefault();
  const f = ev.target;
  await postPush({
    device_id: f.device_id.value,
    title: f.title.value,
    body: f.body.value,
  });
}

async function sendDailyReminder() {
  const device_id = document.getElementById("pushDevice").value;
  if (!device_id) {
    const status = document.getElementById("pushStatus");
    status.className = "status err";
    status.textContent = "pick a device first";
    return;
  }
  // Rotate through presets so demo sends don't feel repetitive.
  const preset = DAILY_REMINDER_PRESETS[Math.floor(Math.random() * DAILY_REMINDER_PRESETS.length)];
  document.getElementById("pushTitle").value = preset.title;
  document.getElementById("pushBody").value = preset.body;
  await postPush({ device_id, ...preset });
}

loadData();
</script>
</body>
</html>
"""
