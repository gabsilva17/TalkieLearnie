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
- `POST /ask/transcribe` — multipart `audio` + form field `device_id`. Whisper
  (`whisper-1`, language `pt`) transcribes the clip and returns `{text}`.
  Powers the microphone affordance on the "Perguntar" composer; the audio is
  **not** persisted (no `data/audio/` write, no Supabase row) since this is
  one-shot dictation, not a coached session.
- `POST /motivation` — `{device_id, plan_id}`. Returns `{message}` with a
  single pt-PT motivational sentence from Haiku, personalized using the plan's
  `prep_for`. Verifies the plan belongs to `device_id` (403 otherwise). On any
  Anthropic error it returns a pt-PT fallback line. Powers cena 3 da
  coreografia pós-gravação (ver `session/[dayId]/index.tsx` → `CelebrationFlow`)
  e é chamado em paralelo com `POST /sessions` para não somar latência.
- `GET /health`.

Stored audio lives on the backend filesystem (`backend/data/audio/`, gitignored),
not Supabase Storage — it's the simpler hackathon path. URLs are built with
`request.url_for` so they resolve to whatever host the mobile client used
(LAN IP for Expo Go).

Mobile screen tree (`mobile/app/`):
- `index.tsx` — boot router. Always routes to `/plans` when any plans exist,
  otherwise to `/onboarding`. We deliberately do NOT auto-resume into the
  last-visited plan: the plans home is the canonical entry point so users
  always see their full plan list on launch. `lastPlanId` is still written
  by other screens (used elsewhere for back-navigation), just not consulted
  at boot.
- `onboarding.tsx` — 3-field form (prep_for, target_date, audience_info). On
  success persists `lastPlanId` and routes to `/plan/[newPlanId]`.

Navigation model: there are only two foreground routes (`/plans` and
`/plan/{id}`). Chat and profile are full-screen overlays launched from a
shared **`BottomNav`** (not tabs in the routing sense — there's no
expo-router `Tabs` group). The bottom bar has three slots: **Planos**
(left, label + icon, navigates to `/plans`), **Perguntar** (center,
raised primary-blue FAB), and **Perfil** (right, label + icon). The
center Ask button is the prominent CTA: a 64px circle in
`palette.primary[500]` with a 4px white ring and a soft shadow,
absolutely positioned and lifted ~26px above the bar's top edge so it
protrudes. Tapping Perguntar or Perfil measures the button's on-screen
center via `measureInWindow` and pushes an entry into the reveal queue;
the root-level `RevealOverlay` animates a Revolut-style circular reveal
from that exact origin, with the overlay content (`AskOverlay` /
`ProfileOverlay`) sitting inside the expanding circle. Closing the
overlay (X button or Android hardware back) reverses the same animation
back into the trigger origin, then dismisses the queue head so the
overlay unmounts. The TopBar is back to being a plain title + subtitle
header (with an optional left back arrow) — no right-side affordances.
Wiring lives in:
  - `mobile/components/ui/TopBar.tsx` — title + subtitle header (and
    optional back arrow). No reveal triggers.
  - `mobile/components/ui/BottomNav.tsx` — three-slot bar with the
    raised Ask FAB. Plans pushes `/plans` via expo-router; Ask + Profile
    call `openReveal({kind, originX, originY})`. Owns its own bottom
    safe-area inset. Exports `BAR_HEIGHT` so `Screen` can size the
    reserved padding.
  - `mobile/components/ui/Screen.tsx` — wraps screens, exposes `header`
    slot and a `reserveBottomNav` boolean. When `reserveBottomNav` is set,
    the scroll/non-scroll body's `paddingBottom` grows to
    `BAR_HEIGHT + insets.bottom + spacing.huge` so content doesn't slip
    behind the persistent bar. The bar itself is NOT rendered by Screen.
  - `mobile/app/_layout.tsx` → `PersistentBottomNav` — mounts a single
    `<BottomNav>` as an absolutely-positioned sibling of `<Stack>` (and
    below the celebration / reveal overlays). Gated by `usePathname()`
    so it only renders on `/plans` and `/plan/{id}`. Living **outside**
    the Stack is what keeps the bar stable across the `/plans` ↔
    `/plan/[id]` fade transition — only the screen content fades, the
    bar doesn't. Don't move it back into Screen.
  - `mobile/components/ui/RevealOverlay.tsx` — animation wrapper mounted
    once at the root layout, sibling to `<Stack>` and the celebration
    overlays. Renders nothing while the queue is empty.
  - `mobile/lib/revealOverlay.ts` — queue + subscribe helpers
    (`openReveal`, `peekReveal`, `dismissReveal`, `subscribeReveal`).
  The BottomNav only appears on `/plans` and `/plan/{id}` — focused
  flows (`onboarding`, `session/[dayId]`, `session/[dayId]/result`) do
  NOT mount it.
- `plans.tsx` — home: list of all plans for the device, each shown as
  a card (left-side `done/total` indicator, eyebrow target label, plan name,
  trailing chevron). Tap enters the plan (`/plan/[id]`); **long-press** opens
  an action sheet with "Mudar o nome" (rename via `PATCH /plans/{id}`) or
  "Apagar plano" (confirm Alert → `DELETE /plans/{id}`). The "Novo plano"
  button is inline at the end of the list so it follows the content down.
  Pins a `TopBar` (no back arrow — this is the root) above the scroll body
  via `Screen`'s `header` slot. Plans whose days are all completed are
  **archived** automatically (no DB column — derived as
  `days.every(d => d.completed_at)`) and split into a collapsed
  `▸ Concluídos (N)` accordion below the "Novo plano" button. Archived
  cards reuse the same card with muted colors (neutral-50 fill, neutral-500
  title, neutral-300 chevron) and an "Concluído" eyebrow in place of the
  date label. The header subtitle counts only active plans ("X planos a
  treinar"); it switches to "Concluíste tudo. Cria um novo plano." when
  the user has plans but they're all archived. Long-press still works on
  archived cards (rename / delete remain available).
- `components/screens/AskOverlay.tsx` — pt-PT chat with Claude Haiku via
  `POST /ask`, presented as a reveal overlay launched from the TopBar
  chat icon (no longer a tab). Pulls the active `lastPlanId`
  (best-effort) so the backend can inject plan context. Conversation
  history is component state only — refresh button or closing the
  overlay resets it. Welcome screen shows 4 starter prompts. Composer
  is a single rounded **pill** holding the TextInput, the mic button,
  and the send button (ChatGPT-style). When the text input is empty,
  the mic button shows next to send; tapping it records via `expo-audio`
  (`useAudioRecorder`, same preset as the session screen) and on stop
  posts the clip to `POST /ask/transcribe`, dropping the Whisper text
  back into the input so the user can review/edit before sending. The
  transition is a simple **opacity crossfade morph**: the idle pill sits
  in normal flow, the recording pill overlays it absolutely with the
  same footprint, and a single shared value (`composerMode` state →
  `withTiming` ease-in-out quad over 320ms) drives `opacity: 1 → 0` on
  one and `0 → 1` on the other. `pointerEvents` flips with the mode so
  touches always hit the visible layer. The recording overlay is a
  primary-blue pill containing a 28-bar metering-driven waveform that
  fills the bar, a `mm:ss` timer (cap 120s), and a circular **stop pill**
  containing a square white stop shape (per the spec). A small "Cancelar"
  link below the pill discards the take without transcribing.
  **Assistant messages render markdown** via `react-native-markdown-display`
  (bold, italics, headings, bullet / ordered lists, inline + fenced code,
  blockquotes, links). They sit full-width with no chat bubble; only user
  messages keep the right-aligned blue bubble. Every text-emitting
  markdown rule sets `fontFamily` explicitly (Nunito SemiBold body,
  ExtraBold strong, Bold headings/list bullets). Without that, Android
  falls back to system "bold" and the Nunito look breaks.
- `components/screens/ProfileOverlay.tsx` — derived profile screen,
  presented as a reveal overlay launched from the TopBar profile icon
  (no longer a tab). Reads from `GET /profile` (passes
  `tz_offset_minutes = -getTimezoneOffset()` so streak day boundaries
  match the device's local midnight). Layout (top to bottom):
  - "Olá, {name}" greeting with a pencil icon — tap to edit; the name lives
    in AsyncStorage under `user_name` (default "Gabriel"), helpers in
    `mobile/lib/userName.ts`.
  - Streak hero (the only large card up top).
  - "Últimos 7 dias" — horizontal strip of 7 day cells with weekday + day
    number; tap any cell or "Ver tudo" to open the activity modal. The modal
    is a **paged month calendar** (one month per page, swipe horizontally
    between months or use the prev/next arrows in the header), driven by
    `activity_365` — buckets the 365 days into YYYY-MM pages, paints each
    day cell with the `heatmapColor` shade, highlights today with a
    primary-700 outline. No horizontal scrolling of the whole grid — the
    pager snaps one month at a time so the layout never feels broken.
  - Stats grid — 2×2 plain text values, **no card**.
  - WPM bar chart over the last 14 active days (flat, no card).
  - Achievements — collapsed to a single summary row ("X / Y desbloqueadas"
    with trophy icon + "Ver mais" CTA). Tap opens a `pageSheet` modal with
    the full sorted grid of `AchievementCard`s. Don't put the inline grid
    back into the main scroll - it crowded the screen and the user wanted
    profile to lead with the most personal stats.
- `plan/[planId]/index.tsx` — single-plan detail: day rail. Pins a
  `TopBar` with a left-side back arrow that routes to `/plans`
  (`router.push`, not `router.back` — we want a deterministic destination
  in case the user hot-linked into the plan or arrived from a deep-link).
  The same TopBar carries the chat + profile reveal triggers, so the
  overlays are reachable from inside a plan too. Writes `lastPlanId` on
  focus so a relaunch resumes here. **Only the day whose `day_date`
  equals the device's local today is interactive (`current`); every other
  not-yet-completed day is `locked`** — strict daily ritual, no catch-up
  on past days, no skipping ahead. Completed days remain tappable to view
  results.
- `session/[dayId]/index.tsx` — record screen (5-min cap, `expo-audio`).
  Walks **all** of the device's plans to find the day, since a `dayId` is no
  longer guaranteed to live in the most-recent plan. Redirects back to the
  plan if the day's `day_date` isn't today (deep-link safety net for the
  "today only" rule). `localTodayISO()` lives in `mobile/lib/dayDate.ts`.
  After "TERMINADO" the screen renders **`CelebrationFlow`** instead of a
  loading bar: 4 cenas encadeadas com crossfade lento (1 "Boa!" + confetti,
  2 mini day-rail com o dia actual a transitar de `current` para `done` com
  bounce + check, 3 frase motivacional do Haiku via `POST /motivation` com
  pulsação até `pendingResult` chegar, 4 transcript + botão "VER FEEDBACK").
  `POST /sessions` e `POST /motivation` são disparados em paralelo no
  `stopAndUpload` para que o vídeo total da coreografia (~9s mínimo) absorva
  a latência da pipeline. Não toques em "loading bar" aqui: o ponto é nunca
  parecer um loading screen.
- `session/[dayId]/result.tsx` — rating + metrics + pt-PT feedback, plus a
  replay block: `expo-audio` `useAudioPlayer` plays the stored answer, and
  tappable filler-word chips call `player.seekTo(start)` + `play()` to jump.
  "Voltar ao plano" navigates to `/`, letting the boot router resume the last
  visited plan.

Achievement unlock celebration:
- `mobile/lib/achievementsQueue.ts` — mirrors `planCompletionQueue.ts`:
  a `pending` buffer + a live `queue` + subscribers. `enqueueAchievements`
  pushes into pending (silent, no notify). `flushPendingAchievements`
  promotes pending → live and notifies; called from
  `session/[dayId]/result.tsx`'s unmount cleanup. Why not a "suppress on
  result mount" flag (the previous design): the diff lands during the
  upload-side CelebrationFlow, which runs **before** result.tsx has even
  mounted, so a flag toggled in `useEffect` had a race window where the
  celebration card painted during the choreography. Pending buffer has no
  flag and no race.
- `mobile/lib/earnedAchievements.ts` — persistent AsyncStorage baseline of
  earned achievement IDs (`earned_achievement_ids_v1`). This is what
  `submitSession` diffs against, **not** the volatile profile cache — the
  cache could be empty on cold start or mid-refresh from pre-warm, which
  previously meant the diff returned `[]` and nothing was celebrated.
  Updated on every successful `getProfile` call inside `submitSession` and
  seeded once by the pre-warm in `_layout.tsx`. Don't switch back to a
  cache-based snapshot — it silently broke unlocks on first launch.
- `mobile/components/ui/AchievementUnlockedOverlay.tsx` — full-screen
  `useSyncExternalStore`-backed overlay mounted once in `_layout.tsx` (sibling
  of `<Stack>`). While there is a head entry it renders a dimmed scrim, a
  primary-blue confetti shower, a bouncing trophy with pulsing glow, the
  "Conquista desbloqueada" eyebrow, the achievement label + description, a
  pt-PT motivational line (hash-picked from a static list of 7), and a
  "CONTINUAR" `DuoButton` that pops the queue. Multi-unlock sessions show
  each in sequence. Disables the CTA until the entrance animation finishes
  (~520ms) so users can't dismiss before the celebration plays.
- Wiring lives in `api.ts` → `submitSession`: reads the persisted earned-ID
  set, awaits the background `getProfile` refresh, filters fresh achievements
  for `earned && !prevIds.has(id)`, writes the new baseline, then
  `enqueueAchievements(newly)` (into the pending buffer — does **not**
  surface yet). The result screen's unmount-time flush is what makes them
  visible.
- **Baseline-drift detection** (same IIFE): the persisted earned-IDs set is
  monotonic-grow only, so an external data wipe (admin console "delete db
  data" during demos / dev) would silently lock out every re-earnable
  achievement — the diff would always return `[]`. Signal: any ID in the
  persisted baseline that's no longer present in the server's current earned
  set. When drift is detected, treat the baseline as empty for this diff so
  re-earned achievements resurface, AND null out `prevStreakDate` so today's
  `last_streak_celebration_date_v2` gate doesn't block the streak unlock from
  re-firing either. The same signal covers both gates because any DB wipe
  affects achievements and streak in lockstep.

Plan-completion celebration:
- Triggered when a session closes the **last remaining day** of a plan
  (derived from the cache; no plan-level `completed_at` column). The full
  flow: Sessão → Coreografia → Resultado → tap "VOLTAR AO PLANO" →
  full-screen "Plano completo!" takeover → /plans.
- `mobile/lib/planCompletionQueue.ts` — same shape as
  `achievementsQueue.ts` but with a **pending slot** instead of suppression.
  `submitSession` diffs the cached plan against the day it just closed; if
  this was the final missing day, it `setPendingPlanCompleted(event)`
  rather than enqueuing directly. The result screen's unmount cleanup
  calls `flushPendingPlanCompleted()`, which promotes the parked event
  into the live queue and notifies subscribers. This keeps the takeover
  off-screen during the CelebrationFlow choreography AND during the rating
  reveal, then releases it exactly as the user transitions back to /plans.
  In-memory only — no AsyncStorage persistence, so killing the app between
  TERMINADO and VOLTAR AO PLANO swallows the celebration. Acceptable for
  the demo; revisit if the moment ever needs to survive a relaunch.
- `mobile/components/ui/PlanCompletedOverlay.tsx` — sibling of the
  achievement overlay in `_layout.tsx`, **mounted after it** so it paints
  on top (RN sibling order, no z-index). Full-bleed primary-500 background
  (not a card), denser 48-piece confetti shower (white + primary-100/200
  tints that pop against the blue), bouncing `Medal` icon with pulsing
  ring, "Plano completo!" black headline, plan's `prep_for`, days count,
  pt-PT motivational line (hash-picked from a static list of 7), and a
  secondary "FECHAR" `DuoButton`. CTA is disabled for ~700ms after mount
  so the user can't dismiss before the entrance plays.

Streak activation celebration:
- Triggered when the user records the **first session of a new local day**,
  i.e. when `profile.streak_active_today` flips from false → true after a
  submit. Choreography: Sessão → Coreografia → Resultado → tap "VOLTAR AO
  PLANO" → full-screen "Streak ativado!" takeover with the fire "turning
  on" → /plans.
- `mobile/lib/streakCelebration.ts` — same shape as
  `planCompletionQueue.ts` (pending slot + live queue + subscribers) plus
  an AsyncStorage gate. The gate stores `last_streak_celebration_date_v2`
  (local ISO date). The trigger fires only when stored !== today; without
  this gate, every same-day submit would re-celebrate because
  `streak_active_today` stays true all day. **The gate is written from the
  overlay's CONTINUAR handler**, not from `submitSession`. Earlier code
  wrote it pre-emptively at park time and that silently locked users out of
  the day's celebration whenever the overlay failed to surface (the
  race-fix scenario, an app kill between submit and dismiss, or a prior
  buggy version). Writing on dismiss is the only path that survives those
  failure modes — a missed celebration just retries on the next session.
  Key bumped v1 → v2 to give pre-existing installs a fresh slate after the
  fix landed.
- **Race-fix flag** (`setStreakResultScreenActive` /
  `setAchievementsResultScreenActive`): streak + achievement parking
  happens inside `submitSession`'s post-upload **async IIFE** (it has to
  `await api.getProfile` to get the fresh server-truth). That IIFE can
  resolve AFTER the user has already tapped "VOLTAR AO PLANO" — in which
  case `result.tsx`'s unmount-time flush has already run with an empty
  pending, and the late-landing event would sit in pending forever (no
  one left to flush it, so the celebration silently never fires). The
  fix: `result.tsx` flips a `resultScreenActive` boolean on
  mount/unmount; `setPendingStreakUnlock` / `enqueueAchievements` check
  it — if the result screen is NOT active, they promote to the live
  queue immediately instead of staying in pending. Plan completion
  doesn't need this — it's parked **synchronously** inside
  `submitSession` before result.tsx ever mounts.
- The `_layout.tsx` pre-warm **does not** seed the gate, even though
  `streak_active_today` may already be true on app boot. An earlier
  version did seed (to defend against AsyncStorage-empty + streak-active
  edge cases), but that seed silently locked out the celebration the very
  first time a user opened the app on a day where they had already
  recorded a session under the old code. Removed. The remaining failure
  mode — one spurious celebration when AsyncStorage is cleared while the
  streak is already lit — is harmless (celebratory, not destructive). The
  overlay's CONTINUAR handler is the single writer of the gate; that
  write is the only source of truth.
- `mobile/components/ui/StreakUnlockedOverlay.tsx` — sibling in
  `_layout.tsx`, **mounted between** `AchievementUnlockedOverlay` and
  `PlanCompletedOverlay` so dismissal order is PlanCompleted → Streak →
  Achievement → /plans on a session that triggers all three. **Tactical
  break from the strict primary-blue palette**: this overlay uses a dark
  navy background (`#0B1220`) with warm fire tints (`#FB923C`, `#FBBF24`,
  `#FCD34D`) for the flame, glow, and sparks. Duolingo also breaks brand
  color for the streak moment — the metaphor only reads as fire if the
  colors are warm. Warm tints are confined to this file; `theme.ts` stays
  strict.
- Ignition choreography: background fade → three sparks flicker → Phosphor
  `Flame` icon scales up from 0 with a rotation wobble → warm radial glow
  starts breathing under the flame indefinitely → copy slides up from
  below → 36-piece confetti shower (white + warm tints) drifts down. CTA
  disabled for ~1100ms so users can't dismiss before the ignition lands.
- Copy: "Streak ativado" eyebrow, "Estás em chamas!" headline, big streak
  count + "dias seguidos" unit, optional "Novo recorde pessoal" badge
  when `streak_current === streak_best && streak_current >= 2`, pt-PT
  motivational sentence (hash-picked from 7).

AsyncStorage keys (`mobile/lib/`):
- `device_id` (`lib/deviceId.ts`) — anonymous UUID, generated on first launch.
- `last_plan_id` (`lib/lastPlan.ts`) — most-recently visited plan; the boot
  router uses it to resume directly into that plan. Cleared on delete or when
  the plan is no longer found server-side.
- `user_name` (`lib/userName.ts`) — display name shown on the profile
  greeting. Defaults to "Gabriel". Editable from the profile screen via the
  pencil affordance next to the name.
- `earned_achievement_ids_v1` (`lib/earnedAchievements.ts`) — persisted set
  of achievement IDs the device has already earned; `submitSession` diffs
  against this baseline before the post-submit profile refresh.
- `last_streak_celebration_date_v2` (`lib/streakCelebration.ts`) — local
  ISO date of the last streak-activation celebration. Prevents
  re-celebrating subsequent same-day sessions and stale celebrations
  after a relaunch. Written only from the overlay's CONTINUAR handler.
  Key bumped from v1 → v2 with the same-commit fix that moved the writer
  out of `submitSession`; v1 entries are ignored so users locked out by
  the old code path get a fresh slate.
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

  Every refresh in the app (pull-to-refresh and `useFocusEffect` on
  `/plans`, `/plan/{id}`, Profile) routes through **`syncAllCaches(deviceId)`**
  in `lib/api.ts` instead of fetching a single key. It fetches plans + profile
  in parallel, writes through the list + every `plan:{id}` (the response
  carries `days` inline so it's free), prunes orphan `plan:*` entries and
  invalidates every `session:*` entry. Motivation: per-screen refreshes only
  touched one cache key, so DB resets / external deletes left stale data on
  other screens until the user happened to revisit them. Cost is one extra
  network call per refresh, acceptable for the demo. If you add a new
  cache-backed surface, fold it into `syncAllCaches` rather than bolting on
  a separate refresh path.

Screen transitions: the root Stack uses `animation: "fade"`, no
slide_from_right. The chat + profile overlays don't go through the Stack
at all (they're driven by the reveal queue), so the circular reveal owns
their transition. Don't change either without asking; the user explicitly
wants smooth fade in/out everywhere.

**Mobile session uploads use `FileSystem.uploadAsync` from
`expo-file-system/legacy`**, NOT `fetch + FormData`. RN's `fetch + FormData` is
flaky on Android + New Architecture and gave us "Network request failed". Don't
revert this.

**`useCached` in `mobile/lib/cache.ts` is backed by `useSyncExternalStore`,
not `useState` + `useEffect(subscribe)`.** The naive pattern had a
render→effect race: if `setCached` fired in the window between the component
rendering with the key and the subscribe effect running, the `notify` call
hit zero subscribers, the subscription went up late, and **the consumer
never re-rendered** even though the new data was already in `memCache`. That
made pull-to-refresh look broken (server returned the fresh list, the cache
held the fresh list, the screen kept showing the old list) and stranded the
Perfil screen on its ActivityIndicator. `useSyncExternalStore` reconciles the
snapshot across subscribe boundaries, so a write that lands mid-mount still
propagates. Don't revert to the `useState` + `useEffect` pattern.

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
