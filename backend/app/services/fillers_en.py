"""English filler word list. Mirror of fillers_pt.py.

Unigrams cover hesitation sounds (um/uh/er/etc.) and the common verbal-tic
discourse markers that English speakers overuse when nervous. Bigrams cover
two-word fillers like "you know" and "i mean".

Comparable to the pt-PT list: we intentionally exclude words whose dominant
meaning is *not* the verbal-tic sense (e.g. "well", "right", "okay") to avoid
flagging legitimate sentence flow.
"""
UNIGRAM_FILLERS = {
    # Hesitation sounds / vocalised pauses.
    "um", "umm", "ummm", "uh", "uhh", "uhhh", "uhm", "uhmm",
    "er", "err", "errr", "erm", "ermm",
    "ah", "ahh", "ahhh", "ahm",
    "eh", "ehh", "ehhh",
    "hm", "hmm", "hmmm", "hmmmm",
    "mm", "mmm", "mmmm",
    "ahem",
    # Verbal tics / hedges with strong filler dominance.
    "like", "basically", "literally", "actually", "honestly", "sincerely",
    "frankly", "obviously", "clearly", "essentially", "supposedly",
    "absolutely", "totally", "completely", "definitely",
    "kinda", "sorta", "kindof", "sortof",
    "anyway", "anyways", "whatever",
    "ok", "okay",
}

BIGRAM_FILLERS = {
    ("you", "know"),
    ("i", "mean"),
    ("i", "guess"),
    ("i", "dunno"),
    ("kind", "of"),
    ("sort", "of"),
    ("you", "see"),
    ("you", "got"),
    ("right", "so"),
    ("at", "least"),
    ("in", "fact"),
    ("of", "course"),
    ("more", "or"),
    ("or", "less"),
    ("or", "whatever"),
    ("or", "something"),
    ("and", "stuff"),
    ("kind", "a"),
    ("sort", "a"),
    ("like", "really"),
    ("like", "totally"),
    ("just", "like"),
}
