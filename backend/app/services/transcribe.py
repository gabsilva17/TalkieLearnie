from typing import Literal

from openai import OpenAI

from ..config import get_settings

Language = Literal["pt", "en"]

# Whisper aggressively normalises hesitation sounds ("uh", "uhh", "hum", "ehm"
# etc.) out of transcripts, which made the filler-detection metric look much
# better than reality. The fix that actually works in practice (per OpenAI's
# Whisper prompting guide + the openai/whisper#1174 disfluency thread): feed
# a *long, natural-sounding* sample of speech full of the disfluencies we
# want preserved. Short keyword lists don't steer Whisper reliably; prose
# does. Keep this under ~224 tokens (the prompt window) and language-only.
PT_PT_FILLER_PROMPT = (
    "Hum... então, ah, eu acho que, tipo, é assim. Ehm, imagina, "
    "imagina lá, sabes? Ahn, hummm, pronto, basicamente, no fundo, quer dizer. "
    "Tipo, sei lá, eh, percebes? Ahh, ou seja, pois, olha, epá, hmm. "
    "Tipo coisa, tás a ver, é tipo, ya, ahn, hum. Uhh, uhm, ehm, pronto."
)

EN_FILLER_PROMPT = (
    "Um... so, uh, I think, like, you know, it's kind of, basically, I mean, "
    "honestly. Erm, hmm, sort of, you know what I mean? Right, uh-huh, "
    "totally, literally, actually. Ah, uhm, well, anyway, anyways. "
    "I guess, you see, kinda, sorta, ok, okay. Mmm, umm, erm, hmm."
)


def transcribe(
    audio_bytes: bytes, filename: str, content_type: str, lang: Language = "pt"
) -> dict:
    """Returns {text, language, duration, words: [{word, start, end}]}.

    `lang` selects the Whisper `language=` code and the filler-priming prompt
    (so hesitation sounds aren't auto-normalised out of the transcript).
    """
    prompt = EN_FILLER_PROMPT if lang == "en" else PT_PT_FILLER_PROMPT
    iso = "en" if lang == "en" else "pt"

    client = OpenAI(api_key=get_settings().openai_api_key, timeout=120.0)
    resp = client.audio.transcriptions.create(
        file=(filename, audio_bytes, content_type),
        model="whisper-1",
        language=iso,
        response_format="verbose_json",
        timestamp_granularities=["word"],
        temperature=0,
        prompt=prompt,
    )
    return resp.model_dump()


# Backwards-compatible alias. Older imports of `transcribe_pt` still work and
# default to pt-PT.
def transcribe_pt(audio_bytes: bytes, filename: str, content_type: str) -> dict:
    return transcribe(audio_bytes, filename, content_type, lang="pt")
