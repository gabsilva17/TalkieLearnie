from openai import OpenAI

from ..config import get_settings

PT_PT_FILLER_PROMPT = "Ah, hum, tipo, pronto, então, epá, sabes, basicamente, quer dizer, ou seja."


def transcribe_pt(audio_bytes: bytes, filename: str, content_type: str) -> dict:
    """Returns {text, language, duration, words: [{word, start, end}]}."""
    client = OpenAI(api_key=get_settings().openai_api_key, timeout=120.0)
    resp = client.audio.transcriptions.create(
        file=(filename, audio_bytes, content_type),
        model="whisper-1",
        language="pt",
        response_format="verbose_json",
        timestamp_granularities=["word"],
        temperature=0,
        prompt=PT_PT_FILLER_PROMPT,
    )
    return resp.model_dump()
