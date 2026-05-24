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
- `POST /plans` — **multipart** endpoint (form fields + optional file). Required
  fields: `device_id`, `prep_for`, `target_date`, `audience_info`. Optional:
  `extra_text` (free-form context), `focus_mode` (`communication` | `technical`
  | `both`), and a `pdf` file (max 32 MB, `application/pdf` only). Haiku 4.5
  generates 1–7 days of theme+question **plus a short `plan_name`** (2-4
  words, pt-PT) in a single tool call. The name is persisted on `plans.name`
  and surfaced as `plan.name` on `PlanOut`; mobile uses it as the card title
  in the plan list (falling back to `prep_for` when null on legacy rows).
  `prep_for` itself is no longer the display name — it stays as the original
  user description and continues to be passed to every downstream LLM call
  (plan_gen, analyze, ask, motivation) as goal context. When a PDF is
  provided it rides along as a base64 `document` content block in the
  Anthropic call (the model uses it for grounded, specific questions).
  `focus_mode` rewrites a paragraph of the user message to bias the plan
  towards comm / tech / mixed training. PDFs are persisted to
  `backend/data/extras/<uuid>.pdf` and surfaced as `plan.extra_pdf_url` on
  `PlanOut`; `DELETE /plans/{id}` also best-effort unlinks the file.
- `GET /plans/extras/{filename}` — streams a stored PDF. Filename is
  validated against `^[A-Za-z0-9_\-]+\.pdf$` to prevent path traversal.
- `GET /plans?device_id=…` — all plans for the device (newest first), each with
  their days. Used by the plans home screen.
- `GET /plans/{plan_id}?device_id=…` — a specific plan with its days. 403 if
  the plan doesn't belong to `device_id`.
- `DELETE /plans/{plan_id}?device_id=…` — deletes the plan; cascade removes
  its days and sessions. 403 on device mismatch.
- `PATCH /plans/{plan_id}` — body `{device_id, name}`; updates the plan's
  short display title (`plans.name`). The original `prep_for` description
  stays put as LLM context. 403 on device mismatch. Used by the long-press
  action sheet on the plans home screen.
- `GET /plans/current?device_id=…` — latest plan for the device, or `null`.
  Kept for back-compat; new code should use `GET /plans` or `GET /plans/{id}`.
- `POST /sessions` — multipart audio + form fields `device_id`, `plan_day_id`,
  and `tz_offset_minutes`. Pipeline: Whisper → **junk filter (422 if empty
  transcript or `duration_s < 5s`, see `MIN_SESSION_DURATION_S`)** → metrics
  (incl. filler timestamps) → Sonnet 4.6 forced-tool analysis → audio
  persisted to `backend/data/audio/<uuid>.m4a` → Supabase insert. The junk
  filter runs right after Whisper so we never spend Sonnet tokens or write a
  session row for a 2-second mistap or a silent take; the mobile screen
  catches the 422 (via `Error.tooShort` on `submitSession`), parks the pt-PT
  explanation in `tooShort` state, and renders `TooShortStep` (mic-slash
  icon + "REPETIR" CTA that drops the user back at the question step).
  Rejects with 403 if `plan_day.day_date != date.today()` on the server
  (enforces the "today only" rule, matches the mobile UI lock). Also computes the celebration
  diff and returns it on `session.celebrations`:
  `newly_earned_achievements` (full `AchievementOut` objects),
  `streak_just_activated`/`streak_current`/`streak_best`/`streak_is_new_best`,
  and `plan_just_completed` + plan details when this session closed the
  last incomplete day. `tz_offset_minutes` is required for the streak diff
  (the boundary is the user's local day). **Retry support:** if a session
  row already exists for `plan_day_id` (the user tapped "REPETIR PARA
  MELHORAR" on the result screen), the endpoint UPDATES that row in place
  instead of returning 409: best-effort delete the previous audio file,
  write the new one, recompute everything (Whisper → metrics → Sonnet),
  overwrite the row. `plan_days.completed_at` is left as-is. `celebrations`
  is `null` on retries — every transition (achievements, streak, plan
  completion) already fired on the first session of the day, so the diff
  is intentionally skipped (no BEFORE-snapshot query either).
- `GET /sessions?plan_day_id=…|device_id=…` — history. Each row includes
  `audio_url` (absolute, host-aware) and `filler_timestamps` so the result
  screen can replay audio and jump to each filler.
- `POST /sessions/{session_id}/reanalyze` — body `{device_id, transcript}`.
  Used when the user edits the Whisper transcript on the celebration flow's
  cena 4: recomputes the text-derived metrics (`wpm`, `filler_count`,
  `top_filler`) against the corrected text and re-runs the Sonnet 4.6 judge,
  then updates the existing session row in-place. **Audio-derived signals
  (`pacing_variation`, `filler_timestamps`) are preserved** because we have
  no word-level timestamps for the edited text. 403 on device mismatch, 404
  if the session doesn't exist. Returns the same `SessionOut` shape as
  `POST /sessions` but with `celebrations=null` (it's not a fresh insert,
  no diff to compute).
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
- `onboarding.tsx` — 4-step form (prep_for, target_date, audience_info, and
  an optional **context step** that accepts free-text notes + a PDF
  attachment + a focus toggle). On submit, computes
  `n_days = min(7, daysUntilLocalMidnight(target_date))` on
  the client (mirroring the server cap), fires `startPendingPlan(...)` (which
  kicks off `POST /plans` in the background) and immediately
  `router.replace("/plan/pending")`. We do NOT await the network here — the
  pending screen owns the optimistic UI. `lastPlanId` is set later by
  `/plan/[id]`'s focus effect, no longer here. The three text fields
  (`prep_for`, `audience_info`, and the Step 4 extra-context textarea) host a
  **hold-to-talk** mic icon anchored inside the textarea (bottom-right).
  Same `onPressIn` / `onPressOut` pattern as the Ask composer: hold to
  record, release to transcribe via `POST /ask/transcribe` and append to the
  field; <400ms presses are silent no-ops. The recording pill morph overlays
  the entire input with a waveform, mm:ss timer, and a non-interactive
  primary mic indicator in the same bottom-right slot the user's finger is
  already on.

  **Step 4 (extra context)** is optional and always tappable through —
  `canContinue` is true even when both inputs are empty so the user can skip
  with one tap. The textarea takes free-form notes (briefing, FAQ, numbers).
  The PDF picker uses `expo-document-picker.getDocumentAsync({ type:
  "application/pdf", copyToCacheDirectory: true })`; size is capped at 32 MB
  client-side (mirrors the backend cap). The **focus toggle** (Comunicação /
  Domínio técnico / Ambos) only renders when there's text or a PDF
  attached — its value is sent on the upload to bias Haiku toward general
  communication training, deep-technical questions, or an alternation of
  both. When the user skips entirely, `focus_mode` is sent as null and the
  plan generator runs with the same prompt it always had.
- `plan/pending.tsx` — optimistic plan-creation screen. Subscribes to
  `mobile/lib/pendingPlan.ts` (an in-memory store seeded by onboarding) and
  renders the same layout as `/plan/[id]` with N skeleton `DayCardSkeleton`s
  (`mobile/components/ui/DayCardSkeleton.tsx`). Two independent waves drive
  the choreography:
  - Wave A ("generating frontier") advances every 700ms regardless of API
    status — card 1 flips from `idle` (dim placeholder bars) to `generating`
    (primary border, animated typing dots) at t=0, card 2 at t=700ms, etc.
  - Wave B ("reveal count") only ticks once `POST /plans` resolves. From
    that moment, one more skeleton is replaced by a real `DayCard` every
    480ms. Once all N are revealed, the screen waits 320ms and calls
    `router.replace("/plan/{id}")`.
  The hand-off avoids a spinner flash: `/plan/[id]` calls
  `consumePendingPlan(planId)` as its `useState` initializer, drains the
  warm plan out of the store, and mounts already populated. If the API
  errors out the pending screen shows a pt-PT retry CTA back to
  `/onboarding` instead of the skeletons. Deep-linking to `/plan/pending`
  with no active job bounces to `/plans` (the store is in-memory only, so
  a kill-and-relaunch drops the context). **Don't await `createPlan` in
  onboarding and don't reintroduce a loading screen here** — the whole
  point is that the user sees cards filling in immediately.

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
  The BottomNav only appears on `/plans`, `/plan/pending`, and `/plan/{id}` — focused
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
  chat icon (no longer a tab). Loads every **active** plan (those still
  with incomplete days) on open via `api.getPlans`, defaults the context
  to `lastPlanId` when it matches one of them and falls back to the first
  active plan otherwise. A full-width pill above the chat ("Contexto:
  {plan_name}") shows which plan the assistant is anchored to. When 2+
  active plans exist, the pill becomes a tappable dropdown (CaretDown
  chevron on the right) that opens a modal picker letting the user switch
  context mid-conversation; with a single plan the pill is static and
  iconless. Selection is component state only, so closing the overlay
  resets back to the `lastPlanId` default. Conversation history is also
  component state only — refresh button or closing the overlay resets it.
  Welcome screen shows 4 starter prompts. Composer
  is a single rounded **pill** holding the TextInput, the mic button,
  and the send button (ChatGPT-style). When the text input is empty,
  the mic button shows next to send. **Hold-to-talk, Instagram-style**:
  `onPressIn` starts recording via `expo-audio` (`useAudioRecorder`, same
  preset as the session screen) and `onPressOut` commits — stops, posts
  the clip to `POST /ask/transcribe`, drops the Whisper text into the
  input so the user can review/edit before sending. Anything held for
  less than 400ms is treated as an accidental tap (no transcription, no
  error toast — the `Solta para enviar` hint below the recording pill
  teaches the pattern). The transition is a simple **opacity crossfade
  morph**: the idle pill sits in normal flow, the recording pill overlays
  it absolutely with the same footprint, and a single shared value
  (`composerMode` state → `withTiming` ease-in-out quad over 320ms)
  drives `opacity: 1 → 0` on one and `0 → 1` on the other. The idle
  pill's `pointerEvents` stays `"auto"` across the morph so the
  in-flight touch responder isn't dropped mid-hold. The recording
  overlay is a primary-blue pill containing a 28-bar metering-driven
  waveform, a `mm:ss` timer (cap 120s), and a non-interactive primary
  circle with a white mic icon anchored where the user's finger sits.
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
  **Retry mode** (`?retry=1`, set by the result screen's "REPETIR PARA
  MELHORAR" button): bypasses the `completed_at` → `/result` redirect so
  the user can re-record an already-finished day, and fetches the previous
  session via `api.getSessionForDay` to extract a focus tip
  (`feedback.suggestions[0]` → fallback `weaknesses[0]`). The IntroStep
  swaps its pill to "Nova tentativa" (ArrowClockwise icon), changes the
  subtitle to "Aplica o feedback que recebeste e tenta de novo.", and
  inserts a primary-50 "Foco desta tentativa" card with the tip text.
  The day_date guard still applies (retries are today-only). Submission
  goes through the same `submitSession` path — the backend detects the
  existing row, UPSERTs in place, and returns `celebrations=null`, so the
  achievement / streak / plan-completion queues stay empty on retries.
  After "TERMINADO" the screen renders **`CelebrationFlow`** instead of a
  loading bar: 4 cenas obrigatórias + 2 cenas condicionais (só com edição
  da transcrição), todas encadeadas com crossfade lento. **Pre-gate local:**
  `stopAndUpload` rejeita gravações curtas (`elapsed < 5`) ANTES de fazer
  upload e renderiza `TooShortStep` diretamente, por isso o "Boa!" nunca
  aparece para o caso óbvio (utilizador toca em TERMINADO depois de 1-2
  segundos). O 422 do backend continua a existir como safety net para o
  caso raro de `elapsed >= 5` com transcrição vazia (5s de silêncio
  ininteligível) - se isso acontecer, o parent troca `CelebrationFlow` por
  `TooShortStep` a meio do "Boa!". As 4 cenas obrigatórias: 1 "Boa!" +
  confetti, 2 mini day-rail com o dia actual a transitar de `current` para
  `done` com bounce + check, 3 frase motivacional do Haiku via
  `POST /motivation` com pulsação até `pendingResult` chegar, 4 transcript
  editável + botão "VER FEEDBACK".
  O cartão da cena 4 é um **`TextInput` multiline editável** (não um `Text`
  read-only): o utilizador pode corrigir erros de transcrição do Whisper
  antes de ver o feedback. Quando o texto foi alterado (`text.trim() !==
  original.trim()`), tap em "VER FEEDBACK":
    1. Dispara `POST /sessions/{id}/reanalyze` com o texto corrigido. O
       backend recomputa `wpm` / `filler_count` / `top_filler` a partir do
       novo texto e re-corre o Sonnet judge; `pacing_variation` e
       `filler_timestamps` ficam como estavam (são acústicos, não temos
       timestamps para o texto novo). A linha em `sessions` é actualizada
       in-place.
    2. **Cena 5 ("thanks")**, dwell fixo de 2.5s: Heart + "Obrigado pela
       correção!" + "Vamos usar as tuas alterações para treinar o modelo".
       Não tem gate de rede, é só uma batida emocional antes do loader.
    3. **Cena 6 ("reformulating")**, dwell mínimo 1.8s **+** espera por
       `reanalyzeReady` antes de avançar: `CircleNotch` a rodar +
       "A reformular o feedback inicial" + "Estamos a aplicar as tuas
       correções à análise." É aqui que vive a espera real pelo Sonnet —
       se a reanalysis demorar mais que 1.8s, ficamos no loader até chegar;
       se vier em <1s, ainda assim aguentamos 1.8s para o texto ler. Quando
       o gate destrava, `onContinueRef.current()` navega para `/result` com
       o `pendingResult` já actualizado.
  Se a reanalysis falhar (timeout / 502), `reanalyzeReady` é posto a `true`
  na mesma (no `finally`) e seguimos com o resultado original — é melhor
  do que ficar preso no loader. Se o texto não foi tocado, salta directo
  para `/result` como antes (sem reanalysis, sem thanks, sem reformulating).
  `POST /sessions` e `POST /motivation` são disparados em paralelo no
  `stopAndUpload` para que o vídeo total da coreografia (~9s mínimo) absorva
  a latência da pipeline. Não toques em "loading bar" aqui: o ponto é nunca
  parecer um loading screen.
- `session/[dayId]/result.tsx` — rating + metrics + pt-PT feedback, plus a
  replay block: `expo-audio` `useAudioPlayer` plays the stored answer, and
  tappable filler-word chips call `player.seekTo(start)` + `play()` to jump.
  Two-button footer on the landed view: "VOLTAR AO PLANO" (primary →
  navigates to `/`, letting the boot router resume the last visited plan)
  and "REPETIR PARA MELHORAR" (secondary → `router.replace('/session/[dayId]?retry=1')`
  to re-enter the record flow with the prior feedback surfaced as a focus
  tip; see retry mode notes on the session screen above).

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
- `mobile/components/ui/AchievementUnlockedOverlay.tsx` — full-screen
  `useSyncExternalStore`-backed overlay mounted once in `_layout.tsx` (sibling
  of `<Stack>`). While there is a head entry it renders a dimmed scrim, a
  primary-blue confetti shower, a bouncing trophy with pulsing glow, the
  "Conquista desbloqueada" eyebrow, the achievement label + description, a
  pt-PT motivational line (hash-picked from a static list of 7), and a
  "CONTINUAR" `DuoButton` that pops the queue. Multi-unlock sessions show
  each in sequence. Disables the CTA until the entrance animation finishes
  (~520ms) so users can't dismiss before the celebration plays.
- Detection lives in the **backend**. `POST /sessions` runs `build_profile`
  twice (with the pre-insert sessions list and with the post-insert list),
  diffs the two earned-achievement sets, and returns the deltas in a
  `celebrations` object on the response. Mobile `submitSession` just reads
  `session.celebrations.newly_earned_achievements` and pushes them into the
  achievements queue. **No client-side diff, no pre-submit `getProfile`
  call, no baseline.** This is what removed the entire class of
  "celebration silently doesn't fire" bugs caused by stale baselines /
  cache drift / race windows between submit and the post-submit profile
  fetch. The tz offset has to ride along on the upload (form field
  `tz_offset_minutes`) so the server can compute streak transitions
  relative to the user's local day.

Plan-completion celebration:
- Triggered when a session closes the **last remaining day** of a plan
  (no plan-level `completed_at` column — derived). The full flow:
  Sessão → Coreografia → Resultado → tap "VOLTAR AO PLANO" →
  full-screen "Plano completo!" takeover → /plans.
- `mobile/lib/planCompletionQueue.ts` — same shape as
  `achievementsQueue.ts` but with a **pending slot** instead of suppression.
  The backend computes "did this session close the last incomplete day"
  inside `POST /sessions` (same transaction as the insert) and returns
  `celebrations.plan_just_completed` + `plan_id` + `plan_prep_for` +
  `plan_total_days`. Mobile `submitSession` calls
  `setPendingPlanCompleted(...)` when the flag is true. The result screen's
  unmount cleanup calls `flushPendingPlanCompleted()`, which promotes the
  parked event into the live queue and notifies subscribers. This keeps
  the takeover off-screen during the CelebrationFlow choreography AND
  during the rating reveal, then releases it exactly as the user transitions
  back to /plans. In-memory only — no AsyncStorage persistence, so killing
  the app between TERMINADO and VOLTAR AO PLANO swallows the celebration.
  Acceptable for the demo; revisit if the moment ever needs to survive a
  relaunch.
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
  `planCompletionQueue.ts` (pending slot + live queue + subscribers). **No
  AsyncStorage gate**. The transition is computed on the backend: `POST
  /sessions` returns `celebrations.streak_just_activated` = true only on
  the false → true edge (i.e. the user's first session of the local day).
  Subsequent same-day submits return false and silently skip.
- **Race-fix flag** (`setStreakResultScreenActive` /
  `setAchievementsResultScreenActive`): streak + achievement parking
  happens inside `submitSession` synchronously after the upload returns.
  The result screen's mount/unmount drives the gate via `result.tsx`'s
  `useEffect`. The gate is closed before the parking so a fast user
  navigating from the celebration flow into the result screen doesn't
  cause cards to paint on top of the rating reveal; it's opened on
  result.tsx unmount, which promotes pending. Plan completion uses the
  same pattern (also parked synchronously inside `submitSession`).
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
- `last_plan_id` (`lib/lastPlan.ts`) — most-recently visited plan; back-nav
  from a plan detail uses it. Cleared on delete or when the plan is no
  longer found server-side.
- `user_name` (`lib/userName.ts`) — display name shown on the profile
  greeting. Defaults to "Gabriel". Editable from the profile screen via the
  pencil affordance next to the name.

**That's it.** AsyncStorage stores only things that don't live in the
database. Earlier builds also persisted (a) a stale-while-revalidate cache
under `swr:*`, (b) an earned-achievement baseline
(`earned_achievement_ids_v1`), and (c) a streak celebration gate
(`last_streak_celebration_date_v2`). All three were corrupting
achievement / streak celebrations (stale baselines / mid-flight cache
writes / silent lockouts when the AsyncStorage write missed the celebration
moment) and were removed. The boot block in `_layout.tsx` does a one-time
`AsyncStorage.multiRemove` of any leftover entries.

**No client-side cache, no derived-state persistence.** Screens read from
the server on focus via plain `useState` + `useFocusEffect`; mutations
(`createPlan`, `renamePlan`, `deletePlan`) update local state inline so the
list reflects the change without a refetch. Celebrations (newly-earned
achievements, streak activation, plan completion) are computed on the
**backend** in the same transaction as the session insert and returned
on `session.celebrations`; the client just parks them into the queues.
Trade-off: killing the app between submit and the celebration overlay
swallows that one celebration. Acceptable for the demo. **Don't
reintroduce a cache layer, an AsyncStorage-backed baseline, or
client-side celebration diffing** — every prior attempt had a stale-state
failure mode that silently broke the popups.

Screen transitions: the root Stack uses `animation: "fade"`, no
slide_from_right. The chat + profile overlays don't go through the Stack
at all (they're driven by the reveal queue), so the circular reveal owns
their transition. Don't change either without asking; the user explicitly
wants smooth fade in/out everywhere.

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
earlier Expo Push API attempt, add the `plans.extra_text`,
`plans.extra_pdf_filename`, `plans.focus_mode` columns added for the
optional onboarding context step, and the `plans.name` column for the
AI-generated short display title shown on the plans list card).

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
