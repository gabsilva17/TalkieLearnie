# Backend

FastAPI service for the AI Communication Coach.

## Setup

```bash
cp .env.example .env
uv sync
```

## Run

```bash
uv run uvicorn app.main:app --reload
```

Server listens on http://localhost:8000. Health check at `/health`.
