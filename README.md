# AI Communication Coach

"Duolingo for spoken communication." Pick a goal (job interview, investor pitch,
difficult conversation), record short voice answers to AI-generated questions,
get a scorecard with feedback. Daily ritual, streaks, mascot.

48-hour hackathon MVP. Theme: *digital essential*.

## Layout

```
/mobile      Expo SDK 54 + TypeScript app (expo-router)
/backend     FastAPI app (uv)
```

## Run locally

Two terminals.

### Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload
```

Serves on http://localhost:8000. Health check: `GET /health` → `{"status": "ok"}`.

### Mobile

```bash
cd mobile
cp .env.example .env
npm install
npx expo start
```

Open in Expo Go (scan QR), iOS simulator (`i`), or Android emulator (`a`).

### Connecting the two

The home screen pings `${EXPO_PUBLIC_API_URL}/health`. Defaults to
`http://localhost:8000`, which works for the iOS simulator. For a physical
device via Expo Go, set `EXPO_PUBLIC_API_URL` to your machine's LAN IP
(`http://192.168.x.x:8000`). For the Android emulator, use `http://10.0.2.2:8000`.

## Acceptance

1. Backend starts on port 8000 via `uv run uvicorn app.main:app --reload`.
2. `npx expo start` launches the app in Expo Go.
3. Tapping **Ping backend** on the home screen shows `ok`.
