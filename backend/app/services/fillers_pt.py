import re
import unicodedata
from collections import Counter

UNIGRAM_FILLERS = {
    # Hesitation sounds / vocalised pauses. Include variants Whisper actually
    # emits for pt-PT recordings (multiple m/h spellings) so the counter
    # doesn't silently drop a near-miss spelling.
    "ah", "ahh", "ahhh", "ahn", "ahnn", "ahm",
    "eh", "ehh", "ehhh", "ehm", "ehmm", "ehnn",
    "uh", "uhh", "uhhh", "uhm", "uhmm", "umm",
    "ham", "hum", "humm", "hummm", "hmm", "hmmm", "hmmmm",
    "mm", "mmm", "mmmm", "mhm",
    "ahem",
    # pt-PT discourse markers / verbal tics
    "tipo", "pronto", "prontos", "entao", "epa", "ya", "yah", "yap",
    "bem", "sabes", "percebes", "entendes", "vês", "ves",
    "digamos", "basicamente", "tas", "ta", "tah",
    "ok", "okay", "olha", "olhe", "ora", "fixe", "porra",
    "portanto", "enfim", "afinal", "alias",
    "imagina", "imagine", "pois",
    # Adverbial intensifiers commonly overused as fillers
    "obviamente", "claramente", "literalmente", "praticamente",
    "realmente", "efetivamente", "supostamente", "essencialmente",
    "honestamente", "sinceramente", "francamente",
    "absolutamente", "totalmente", "completamente",
}

BIGRAM_FILLERS = {
    ("quer", "dizer"),
    ("quero", "dizer"),
    ("ou", "seja"),
    ("no", "fundo"),
    ("la", "esta"),
    ("la", "estao"),
    ("tas", "a"),
    ("estas", "a"),
    # "tipo" combos
    ("tipo", "assim"),
    ("tipo", "que"),
    ("tipo", "isto"),
    ("tipo", "isso"),
    ("tipo", "tipo"),
    # hedges / vagueness
    ("se", "calhar"),
    ("digamos", "assim"),
    ("sabes", "como"),
    ("por", "assim"),
    ("a", "serio"),
    ("de", "facto"),
    ("por", "acaso"),
    ("se", "quiseres"),
    ("mais", "ou"),
    ("ou", "menos"),
    ("ou", "assim"),
    ("ou", "qualquer"),
    ("sei", "la"),
    ("imagina", "la"),
    ("imagine", "que"),
    ("tipo", "coisa"),
    # closers
    ("no", "final"),
    ("ao", "fim"),
}

_TOKEN_RE = re.compile(r"[a-zà-ÿ]+", re.IGNORECASE)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _normalize_token(t: str) -> str:
    return _strip_accents(t.lower())


def tokenize(text: str) -> list[str]:
    return [_normalize_token(m.group(0)) for m in _TOKEN_RE.finditer(text)]


def count_fillers(text: str) -> tuple[int, str | None, dict[str, int]]:
    tokens = tokenize(text)
    counts: Counter[str] = Counter()

    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens) and (tokens[i], tokens[i + 1]) in BIGRAM_FILLERS:
            counts[f"{tokens[i]} {tokens[i + 1]}"] += 1
            i += 2
            continue
        if tokens[i] in UNIGRAM_FILLERS:
            counts[tokens[i]] += 1
        i += 1

    total = int(sum(counts.values()))
    top = counts.most_common(1)[0][0] if counts else None
    return total, top, dict(counts)


def count_fillers_from_words(
    words: list[dict],
) -> tuple[int, str | None, dict[str, int], list[dict]]:
    """Same as count_fillers but uses Whisper word-level data so we can return
    the start timestamp of every filler occurrence.

    Each item in `words` is `{word, start, end}` (verbose_json word granularity).
    Returns: (total, top, breakdown, occurrences) where occurrences is a list of
    `{token, start}` in transcript order.
    """
    norm = [_normalize_token(w.get("word", "")) for w in words]
    starts = [float(w.get("start") or 0.0) for w in words]

    counts: Counter[str] = Counter()
    occurrences: list[dict] = []

    i = 0
    while i < len(norm):
        if not norm[i]:
            i += 1
            continue
        if i + 1 < len(norm) and (norm[i], norm[i + 1]) in BIGRAM_FILLERS:
            token = f"{norm[i]} {norm[i + 1]}"
            counts[token] += 1
            occurrences.append({"token": token, "start": round(starts[i], 2)})
            i += 2
            continue
        if norm[i] in UNIGRAM_FILLERS:
            counts[norm[i]] += 1
            occurrences.append({"token": norm[i], "start": round(starts[i], 2)})
        i += 1

    total = int(sum(counts.values()))
    top = counts.most_common(1)[0][0] if counts else None
    return total, top, dict(counts), occurrences
