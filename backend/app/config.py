import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    openai_api_key: str
    supabase_url: str
    supabase_key: str


def get_settings() -> Settings:
    missing = [
        name for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY")
        if not os.environ.get(name)
    ]
    if missing:
        raise RuntimeError(f"Missing env vars: {', '.join(missing)}. See backend/.env.example.")
    return Settings(
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
        openai_api_key=os.environ["OPENAI_API_KEY"],
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_KEY"],
    )
