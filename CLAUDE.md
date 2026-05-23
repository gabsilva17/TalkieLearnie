# CLAUDE.md

Project guidance for Claude Code agents working on this repo.

## What this is

**AI Communication Coach** — a "Duolingo for spoken communication" mobile app.
User picks a goal (job interview, investor pitch, difficult conversation, etc.),
records short voice answers to AI-generated questions, and receives a scorecard
with feedback. Daily ritual, streaks, mascot.

Built as a **48-hour hackathon MVP**. Theme: *digital essential*. Bias toward
shipping a working demo over architectural polish.

## Layout

```
/mobile      Expo (managed) + TypeScript + expo-router
/backend     FastAPI (Python 3.11+) managed with uv
```

The two apps are independent — no shared package, no monorepo tooling. They
talk over HTTP.

## Stack choices (locked in)

- **Mobile**: Expo SDK 54 (managed), TypeScript, expo-router (file-based,
  routes in `mobile/app/`). Scaffolded with `npx create-expo-app@latest --template default@sdk-54`.
  SDK 54 is supported by Expo Go on physical Android — no dev-client build needed.
  Authoritative version reference: https://docs.expo.dev/versions/v54.0.0/
- **Backend**: FastAPI, Python 3.11+, `uv` for dep management (`uv sync`, `uv run`).
- **LLMs**: Anthropic Claude — Haiku 4.5 (`claude-haiku-4-5-20251001`) for plan
  generation, Sonnet 4.6 (`claude-sonnet-4-6`) for speech analysis. Structured
  output via forced tool use (Anthropic has no native json_mode).
- **Speech-to-text**: OpenAI Whisper (`whisper-1`) — only OpenAI STT model with
  word-level timestamps, which we need for pacing-variation metric. **Always use
  the official `openai` Python SDK**, never raw httpx/requests multipart — the
  SDK handles `timestamp_granularities=["word"]` and file-tuple encoding
  correctly; doing it by hand triggers obscure multipart errors.
- **Persistence**: Supabase Postgres. Anonymous `device_id` UUID (generated on
  first launch, stored in AsyncStorage) is sent in every request body — no auth,
  no user table. RLS off for the demo. Schema in `backend/schema.sql`.

## What's built — use case 1

First end-to-end loop is shipped: onboarding → AI-generated daily plan → voice
mini-simulation per day → Whisper transcribe → deterministic metrics
(WPM, fillers, pacing variation) → Sonnet 4.6 judge → result screen.

Backend endpoints (`backend/app/routes/`):
- `POST /plans` — Haiku generates 1–7 days of theme+question (pt-PT).
- `GET /plans?device_id=…` — all plans for the device (newest first), each with
  their days. Used by the plans home screen.
- `GET /plans/{plan_id}?device_id=…` — a specific plan with its days. 403 if
  the plan doesn't belong to `device_id`.
- `DELETE /plans/{plan_id}?device_id=…` — deletes the plan; cascade removes
  its days and sessions. 403 on device mismatch.
- `PATCH /plans/{plan_id}` — body `{device_id, prep_for}`; renames the plan's
  `prep_for` field (the user-visible plan name). 403 on device mismatch.
  Used by the long-press action sheet on the plans home screen.
- `GET /plans/current?device_id=…` — latest plan for the device, or `null`.
  Kept for back-compat; new code should use `GET /plans` or `GET /plans/{id}`.
- `POST /sessions` — multipart audio + form fields `device_id`, `plan_day_id`.
  Pipeline: Whisper → metrics (incl. filler timestamps) → Sonnet 4.6 forced-tool
  analysis → audio persisted to `backend/data/audio/<uuid>.m4a` → Supabase insert.
  Rejects with 403 if `plan_day.day_date != date.today()` on the server —
  enforces the "today only" rule (matches the mobile UI lock).
- `GET /sessions?plan_day_id=…|device_id=…` — history. Each row includes
  `audio_url` (absolute, host-aware) and `filler_timestamps` so the result
  screen can replay audio and jump to each filler.
- `GET /sessions/audio/{filename}` — streams a stored answer file. Filename is
  validated (alnum + `_-` + extension only) to prevent path traversal.
- `GET /profile?device_id=…&tz_offset_minutes=…` — fully derived profile:
  `streak_current` / `streak_best` / `streak_active_today` (rule: 1+ session
  per **local** day, where "local" is the client's offset; streak survives
  until today is skipped, so a user who hasn't recorded today still keeps the
  count anchored at yesterday), totals (`total_sessions`, `total_minutes`,
  `avg_wpm`, `best_rating`, `avg_rating`, `top_filler`, `plans_count`),
  `activity_365` (heatmap: last 365 local days — profile shows the last 7
  inline and a 12-month GitHub-style grid in a modal), `wpm_trend` / `rating_trend`
  (last 14 active days, daily averages), and `achievements` (12-item static
  catalog, derived). All values are computed on the fly in
  `backend/app/services/profile.py` — **no extra tables**.
- `GET /push/pending?device_id=…` / `POST /push/pending/{id}/ack` — queue +
  ack endpoints used by the mobile poll loop. The admin "Send" button inserts
  into `pending_pushes`; the mobile app polls every 5s while foregrounded
  (`mobile/lib/push.ts` → `startPushPolling`) and presents each row as a
  **local** notification via `Notifications.scheduleNotificationAsync({ trigger: null })`,
  then acks it. This is deliberate — Expo Go SDK 53+ dropped remote push, so
  we can't hit Expo's Push API until we cut a dev build. Pattern works in
  Expo Go but only while the app is foregrounded.
- `POST /admin/push` — `{device_id, title, body}`. Enqueues a row in
  `pending_pushes`. Driven by the "Send daily reminder" button on `GET /admin`
  (rotates through pt-PT Duolingo-style presets).
- `POST /ask` — Claude Haiku 4.5 chat helper backing the "Perguntar" tab.
  Body: `{device_id, plan_id?, messages: [{role: "user"|"assistant", content}]}`.
  Last message must be `role=user`. When `plan_id` is provided it's verified to
  belong to `device_id` (403 otherwise) and `prep_for`/`target_date`/
  `audience_info` are injected into the pt-PT system prompt so answers stay
  relevant to the user's current goal. No persistence — history is held in the
  mobile screen state only. Logic in `backend/app/services/ask.py`.
- `GET /health`.

Stored audio lives on the backend filesystem (`backend/data/audio/`, gitignored),
not Supabase Storage — it's the simpler hackathon path. URLs are built with
`request.url_for` so they resolve to whatever host the mobile client used
(LAN IP for Expo Go).

Mobile screen tree (`mobile/app/`):
- `index.tsx` — boot router. Reads `lastPlanId` from AsyncStorage and tries to
  resume that plan. Falls back to `/plans` if any plans exist, otherwise to
  `/onboarding`.
- `onboarding.tsx` — 3-field form (prep_for, target_date, audience_info). On
  success persists `lastPlanId` and routes to `/plan/[newPlanId]`.
- `(tabs)/_layout.tsx` — bottom-tab navigator (Planos / Perguntar / Perfil).
  This group hosts the three main tabs **plus the plan detail screen**
  (registered with `href: null` so it has no tab button but inherits the tab
  bar). Onboarding, session record, and session result remain above it in the
  root Stack and hide the tab bar. The URLs don't include `(tabs)`, so
  `/plans`, `/profile`, and `/plan/{id}` still resolve directly. Tab bar
  height adapts to the device's bottom safe-area inset via
  `useSafeAreaInsets()` so it doesn't sit under the OS gesture bar.
- `(tabs)/plans.tsx` — home: list of all plans for the device, each shown as
  a card (left-side `done/total` indicator, eyebrow target label, plan name,
  trailing chevron). Tap enters the plan (`/plan/[id]`); **long-press** opens
  an action sheet with "Mudar o nome" (rename via `PATCH /plans/{id}`) or
  "Apagar plano" (confirm Alert → `DELETE /plans/{id}`). The "Novo plano"
  button is inline at the end of the list so it follows the content down.
- `(tabs)/ask.tsx` — pt-PT chat with Claude Haiku via `POST /ask`. Pulls the
  active `lastPlanId` (best-effort) so the backend can inject plan context.
  Conversation history is component state only — refresh button or tab switch
  resets it. Welcome screen shows 4 starter prompts.
- `(tabs)/profile.tsx` — derived profile screen. Reads from `GET /profile`
  (passes `tz_offset_minutes = -getTimezoneOffset()` so streak day boundaries
  match the device's local midnight). Layout (top to bottom):
  - "Olá, {name}" greeting with a pencil icon — tap to edit; the name lives
    in AsyncStorage under `user_name` (default "Gabriel"), helpers in
    `mobile/lib/userName.ts`.
  - Streak hero (the only large card up top).
  - "Últimos 7 dias" — horizontal strip of 7 day cells with weekday + day
    number; tap any cell or "Ver tudo" to open a 12-month GitHub-style
    heatmap modal (driven by `activity_365`).
  - Stats grid — 2×2 plain text values, **no card**.
  - WPM bar chart over the last 14 active days (flat, no card).
  - Achievements catalog (kept as cards in a 2-column grid).
- `(tabs)/plan/[planId]/index.tsx` — single-plan detail: day rail. Lives
  inside the tabs group so the bottom tab bar stays visible; navigation back
  to the list happens via the Planos tab. Writes `lastPlanId` on focus so a
  relaunch resumes here. **Only the day whose
  `day_date` equals the device's local today is interactive (`current`);
  every other not-yet-completed day is `locked`** — strict daily ritual,
  no catch-up on past days, no skipping ahead. Completed days remain
  tappable to view results.
- `session/[dayId]/index.tsx` — record screen (5-min cap, `expo-audio`).
  Walks **all** of the device's plans to find the day, since a `dayId` is no
  longer guaranteed to live in the most-recent plan. Redirects back to the
  plan if the day's `day_date` isn't today (deep-link safety net for the
  "today only" rule). `localTodayISO()` lives in `mobile/lib/dayDate.ts`.
- `session/[dayId]/result.tsx` — rating + metrics + pt-PT feedback, plus a
  replay block: `expo-audio` `useAudioPlayer` plays the stored answer, and
  tappable filler-word chips call `player.seekTo(start)` + `play()` to jump.
  "Voltar ao plano" navigates to `/`, letting the boot router resume the last
  visited plan.

AsyncStorage keys (`mobile/lib/`):
- `device_id` (`lib/deviceId.ts`) — anonymous UUID, generated on first launch.
- `last_plan_id` (`lib/lastPlan.ts`) — most-recently visited plan; the boot
  router uses it to resume directly into that plan. Cleared on delete or when
  the plan is no longer found server-side.
- `user_name` (`lib/userName.ts`) — display name shown on the profile
  greeting. Defaults to "Gabriel". Editable from the profile screen via the
  pencil affordance next to the name.
- `swr:*` (`lib/cache.ts`) — stale-while-revalidate cache for plans + profile.
  Lives in memory; key keys (`plan:{id}`, `plans:{deviceId}`, `profile:{deviceId}`)
  are also mirrored to AsyncStorage under the `swr:` prefix so cold boots can
  render the last-seen plan/profile **instantly** while a background refetch
  runs. Screens read via `useCached` (subscribes to writes) and write via
  `setCached` after fetches; mutations in `api.ts` (`createPlan`,
  `renamePlan`, `deletePlan`, `submitSession`) update the cache directly so
  the home list / detail / profile reflect changes without any spinner. The
  boot router (`app/index.tsx`) checks the hydrated cache first and routes
  immediately if `lastPlanId` is known. **Don't bypass this** — adding a
  `fetch` + `setLoading(true)` pattern back into a screen will re-introduce
  the spinner flicker between tabs that the cache exists to prevent.

Screen transitions: the root Stack uses `animation: "fade"` and the bottom
Tabs use `animation: "fade"` too — no slide_from_right. Don't change this
without asking; the user explicitly wants smooth fade in/out everywhere.

**Mobile session uploads use `FileSystem.uploadAsync` from
`expo-file-system/legacy`**, NOT `fetch + FormData`. RN's `fetch + FormData` is
flaky on Android + New Architecture and gave us "Network request failed". Don't
revert this.

## Running locally

Backend:
```bash
cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0   # :8000 (LAN-reachable for Expo Go)
```

Required env in `backend/.env` (copy from `.env.example`):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` (anon key).

Before the first request: run `backend/schema.sql` in the Supabase SQL editor.
Four tables: `plans`, `plan_days`, `sessions`, `pending_pushes`. If you
already have older tables, run the `alter table … add column if not exists …`
and `create table if not exists pending_pushes …` statements at the bottom of
`schema.sql` (those also drop the obsolete `push_tokens` table from the
earlier Expo Push API attempt).

Mobile:
```bash
cd mobile && npx expo start          # add -c to clear cache (needed after .env changes)
```

The mobile app reads `EXPO_PUBLIC_API_URL` (see `mobile/.env`). For Expo Go on
a physical device, this must be your machine's LAN IP, not `localhost`. **Every
time the laptop switches WiFi networks, its LAN IP can change** — update
`mobile/.env` and restart Expo with `-c` so the new value is baked into the
bundle (`EXPO_PUBLIC_*` is inlined at bundle time, a reload alone is not
enough). On Windows: `Get-NetIPAddress -AddressFamily IPv4` (filter out
`127.*`, `169.254.*`) finds the current LAN IP.

## Conventions

- Keep `.env.example` files up-to-date when adding new env vars.
- Backend: routes in `backend/app/routes/`, business logic in
  `backend/app/services/`, Pydantic models in `backend/app/schemas.py`.
- Mobile: screens/layouts in `mobile/app/` (expo-router file-based).
  Shared utilities in `mobile/lib/`. Path alias `@/*` → repo root.
- All LLM prompts AND user-facing copy are **European Portuguese (pt-PT)**,
  never pt-BR. Anthropic system prompts explicitly forbid gerundios brasileiros
  ("estou falando" → "estou a falar"; "você" → "tu"). The pt-PT filler list
  lives in `backend/app/services/fillers_pt.py`.
- **No em dashes (`—`) anywhere the user sees them.** This applies to LLM
  output (every system prompt forbids `—`; use periods, commas, colons, or
  parentheses instead) AND to hardcoded UI strings / placeholders (use a
  regular hyphen `-` for null/empty slots). Em dashes are the AI-text "tell"
  we want to avoid. Code comments in source files are fine; only user-visible
  text is gated.
- **Eyebrows / captions are Nunito Bold/SemiBold, sentence case, primary
  blue.** Nunito is the only font in the project. Labels like "Resultado",
  "Velocidade", "Passo 2 de 3" render via `type.eyebrow` / `type.caption` in
  `mobile/lib/theme.ts` (Nunito Bold 13px, no `letterSpacing`, `palette.primary[600]`).
  Sentence case at the call site, no programmatic `.toUpperCase()`. The
  tracked-uppercase ExtraBold treatment was the AI-landing-page "tell" we
  removed. Buttons keep Nunito + uppercase ("CONTINUAR", "GUARDAR") - that's
  the intentional Duolingo CTA pattern.
- Don't add lint configs, CI, or testing infra until there's a real reason —
  this is a 48-hour build.
- **Keep this CLAUDE.md current** as the app grows: when an endpoint, screen,
  dependency, or external-service constraint changes, update the relevant
  section in the same commit. Stale CLAUDE.md is worse than no CLAUDE.md.

## Stay current — don't trust training data

The model's knowledge has a cutoff, and this repo pins libraries (Expo SDK,
React Native, FastAPI, etc.) that move fast. **Before making decisions about
versions, APIs, syntax, install commands, or recommended patterns, look it up
on the internet** — use WebSearch / WebFetch, or the Context7 MCP for library
docs. Verify against the current official source rather than recalling from
memory.

Examples of when to look it up before acting:
- Choosing a package version or a peer-dependency range.
- Writing config for a tool (Expo, Metro, Babel, FastAPI, uv, Supabase SDK).
- Using an API surface from any third-party library — confirm the current
  signature, not the one you remember.
- Picking between two approaches where the "best practice" may have shifted.

If a search would slow things down materially and the call is low-stakes, say
so explicitly ("going from memory here, verify before shipping") rather than
silently guessing.

## What NOT to do

- Don't introduce a monorepo tool (turborepo, nx, pnpm workspaces) — two
  independent apps is the point.
- Don't add Redux / Zustand / a state library before there's actual shared
  state to manage. `useState` is fine for the MVP.
- Don't wire up the LLM / Supabase keys until the feature that needs them
  is being built.
