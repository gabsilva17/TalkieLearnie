"""Language-aware filler detection dispatcher.

Picks the right unigram/bigram sets per language and runs the same scan
logic that used to live in `fillers_pt.py`. The token normalization (strip
accents + lowercase) is shared; we only swap the vocabulary.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Literal

from . import fillers_en, fillers_pt

Language = Literal["pt", "en"]

_TOKEN_RE = re.compile(r"[a-zà-ÿ]+", re.IGNORECASE)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _normalize_token(t: str) -> str:
    return _strip_accents(t.lower())


def _sets(lang: Language):
    if lang == "en":
        return fillers_en.UNIGRAM_FILLERS, fillers_en.BIGRAM_FILLERS
    return fillers_pt.UNIGRAM_FILLERS, fillers_pt.BIGRAM_FILLERS


def tokenize(text: str) -> list[str]:
    return [_normalize_token(m.group(0)) for m in _TOKEN_RE.finditer(text)]


def count_fillers(
    text: str, lang: Language = "pt"
) -> tuple[int, str | None, dict[str, int]]:
    unigrams, bigrams = _sets(lang)
    tokens = tokenize(text)
    counts: Counter[str] = Counter()

    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens) and (tokens[i], tokens[i + 1]) in bigrams:
            counts[f"{tokens[i]} {tokens[i + 1]}"] += 1
            i += 2
            continue
        if tokens[i] in unigrams:
            counts[tokens[i]] += 1
        i += 1

    total = int(sum(counts.values()))
    top = counts.most_common(1)[0][0] if counts else None
    return total, top, dict(counts)


def count_fillers_from_words(
    words: list[dict], lang: Language = "pt"
) -> tuple[int, str | None, dict[str, int], list[dict]]:
    """Same as count_fillers but uses Whisper word-level data so we can return
    the start timestamp of every filler occurrence.

    Each item in `words` is `{word, start, end}` (verbose_json word granularity).
    Returns: (total, top, breakdown, occurrences) where occurrences is a list of
    `{token, start}` in transcript order.
    """
    unigrams, bigrams = _sets(lang)
    norm = [_normalize_token(w.get("word", "")) for w in words]
    starts = [float(w.get("start") or 0.0) for w in words]

    counts: Counter[str] = Counter()
    occurrences: list[dict] = []

    i = 0
    while i < len(norm):
        if not norm[i]:
            i += 1
            continue
        if i + 1 < len(norm) and (norm[i], norm[i + 1]) in bigrams:
            token = f"{norm[i]} {norm[i + 1]}"
            counts[token] += 1
            occurrences.append({"token": token, "start": round(starts[i], 2)})
            i += 2
            continue
        if norm[i] in unigrams:
            counts[norm[i]] += 1
            occurrences.append({"token": norm[i], "start": round(starts[i], 2)})
        i += 1

    total = int(sum(counts.values()))
    top = counts.most_common(1)[0][0] if counts else None
    return total, top, dict(counts), occurrences
