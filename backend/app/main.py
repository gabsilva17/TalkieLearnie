from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from .routes import admin, ask, motivation, plans, profile, push, sessions  # noqa: E402

app = FastAPI(title="AI Communication Coach")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plans.router)
app.include_router(sessions.router)
app.include_router(profile.router)
app.include_router(push.router)
app.include_router(admin.router)
app.include_router(ask.router)
app.include_router(motivation.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
