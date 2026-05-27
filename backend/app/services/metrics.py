import statistics
from typing import Literal

from .fillers import count_fillers, count_fillers_from_words

Language = Literal["pt", "en"]

WINDOW_S = 10.0
STEP_S = 2.0
MIN_WORDS_PER_WINDOW = 3


def compute_wpm(word_count: int, duration_s: float) -> float:
    if duration_s <= 0:
        return 0.0
    return round(word_count / duration_s * 60.0, 2)


def compute_pacing_variation(words: list[dict], duration_s: float) -> float:
    """Coefficient of variation of words/sec across 10s sliding windows (step 2s)."""
    if duration_s < WINDOW_S or not words:
        return 0.0
    starts = [float(w["start"]) for w in words if "start" in w]
    rates: list[float] = []
    t = 0.0
    while t + WINDOW_S <= duration_s:
        n = sum(1 for s in starts if t <= s < t + WINDOW_S)
        if n >= MIN_WORDS_PER_WINDOW:
            rates.append(n / WINDOW_S)
        t += STEP_S
    if len(rates) < 2:
        return 0.0
    mean = statistics.mean(rates)
    if mean == 0:
        return 0.0
    return round(statistics.pstdev(rates) / mean, 3)


def compute_metrics(
    transcript: str,
    words: list[dict],
    duration_s: float,
    lang: Language = "pt",
) -> dict:
    word_count = len(words) if words else len(transcript.split())
    wpm = compute_wpm(word_count, duration_s)
    if words:
        filler_count, top_filler, filler_breakdown, filler_timestamps = (
            count_fillers_from_words(words, lang=lang)
        )
    else:
        filler_count, top_filler, filler_breakdown = count_fillers(
            transcript, lang=lang
        )
        filler_timestamps = []
    pacing = compute_pacing_variation(words, duration_s)
    return {
        "wpm": wpm,
        "word_count": word_count,
        "filler_count": filler_count,
        "top_filler": top_filler,
        "filler_breakdown": filler_breakdown,
        "filler_timestamps": filler_timestamps,
        "pacing_variation": pacing,
    }
