from openai import OpenAI

from ..config import get_settings

# Whisper aggressively normalises hesitation sounds ("uh", "uhh", "hum", "ehm"
# etc.) out of transcripts, which made the filler-detection metric look much
# better than reality. The fix that actually works in practice (per OpenAI's
# Whisper prompting guide + the openai/whisper#1174 disfluency thread): feed
# a *long, natural-sounding* sample of pt-PT speech full of the disfluencies
# we want preserved. Short keyword lists don't steer Whisper reliably; prose
# does. Keep this under ~224 tokens (the prompt window) and pt-PT only.
PT_PT_FILLER_PROMPT = (
    "Hum... então, ah, eu acho que, tipo, é assim. Ehm, imagina, "
    "imagina lá, sabes? Ahn, hummm, pronto, basicamente, no fundo, quer dizer. "
    "Tipo, sei lá, eh, percebes? Ahh, ou seja, pois, olha, epá, hmm. "
    "Tipo coisa, tás a ver, é tipo, ya, ahn, hum. Uhh, uhm, ehm, pronto."
)


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
