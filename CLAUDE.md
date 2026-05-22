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
- **Planned integrations** (env vars stubbed in `.env.example`, not yet wired):
  Anthropic API, OpenAI API, Supabase.

## Running locally

Backend:
```bash
cd backend && uv run uvicorn app.main:app --reload   # :8000
```

Mobile:
```bash
cd mobile && npx expo start
```

The mobile app reads `EXPO_PUBLIC_API_URL` (see `mobile/.env.example`). For
Expo Go on a physical device, this must be your machine's LAN IP, not `localhost`.

## Conventions

- Keep `.env.example` files up-to-date when adding new env vars.
- Backend: routes live in `backend/app/` — for now everything is in `main.py`,
  split into routers once there's more than a handful of endpoints.
- Mobile: screens/layouts live in `mobile/app/` (expo-router file-based).
  Shared components go in `mobile/components/` once they exist.
- Don't add lint configs, CI, or testing infra until there's a real reason —
  this is a 48-hour build.

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
