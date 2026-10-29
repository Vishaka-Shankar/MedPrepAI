"""Pick the snippet shown with a citation: the part of the chunk that best supports the answer.

The first 200 characters of a chunk are often OCR noise or a heading ("ae Sai SS 7 __. Forms and
Functions in Pian} ..."), even when the chunk itself is the right source. So instead:
  1. split the chunk into sentences (long sentences into ~200-character word windows)
  2. skip noisy fragments (too few real words) and heading-only ones (too short or ALL CAPS)
  3. score the rest by the content words they share with the CLAIM the citation supports
     (the answer sentence with [n], counted twice) and with the QUESTION
  4. return the best one, cut to at most SNIPPET_CHARS at a word boundary
Word overlap needs no extra model, is fast, and is easy to explain.
"""

from __future__ import annotations

import re

SNIPPET_CHARS = 200
MIN_WORDS = 6  # fewer = a heading or a label, not a sentence
MIN_REAL_WORD_SHARE = 0.6  # OCR noise: "ae Sai SS 7 __. Pian} eee oe lee"
MAX_CAPS_SHARE = 0.6  # "2.2 MECHANISM OF ENZYME ACTION" alone is a heading

STOPWORDS = frozenset(
    "a an the and or but of to in on at by for with from as is are was were be been being it its this that "
    "these those which who what when where why how do does did can could will would should may might must "
    "has have had not no so than then there their they them we you your our us he she his her into about "
    "also such each other more most some any all very only both while if because called known".split()
)

# Any ". " ends a sentence: OCR often continues in lowercase ("...reaction. fg E + Ss"), and
# keeping that noise in the same fragment would hide the good sentence before it
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
BULLETS = re.compile(r"\s(?:>|»|•|@>|\|)\s")  # list markers OCR left inside a chunk


def _stem(word: str) -> str:
    """Crude stem so 'enzymes' meets 'enzyme', 'moves' meets 'move' and 'binding' meets 'binds'."""
    word = word.lower()
    for suffix in ("ally", "ing", "ed", "ly"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    if len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    if len(word) > 4 and word.endswith("e"):
        word = word[:-1]
    return word


def content_terms(text: str) -> set[str]:
    return {_stem(w) for w in re.findall(r"[A-Za-z][A-Za-z\-]+", text) if w.lower() not in STOPWORDS and len(w) > 2}


def is_noisy(fragment: str) -> bool:
    tokens = fragment.split()
    if len(tokens) < MIN_WORDS:
        return True
    # A "real word" has 3+ letters including a vowel, with at most one stray character around it
    real = sum(1 for t in tokens if re.fullmatch(r"\W?[A-Za-z]*[aeiouyAEIOUY][A-Za-z\-']{1,}\W?\W?", t) and len(t) >= 3)
    if real / len(tokens) < MIN_REAL_WORD_SHARE:
        return True
    letters = [c for c in fragment if c.isalpha()]
    return bool(letters) and sum(c.isupper() for c in letters) / len(letters) > MAX_CAPS_SHARE


def candidates(text: str) -> list[str]:
    """Sentences, with long ones cut into overlapping word windows of about SNIPPET_CHARS."""
    flat = " ".join(text.split())
    sentences = [s for piece in BULLETS.split(flat) for s in SENTENCE_END.split(piece)]
    out: list[str] = []
    for sentence in sentences:
        sentence = sentence.strip(" |").lstrip(". ")  # keep the full stop at the end
        if len(sentence) <= SNIPPET_CHARS:
            out.append(sentence)
            continue
        words = sentence.split()
        step = 5  # small steps, so a clean stretch inside a noisy OCR run is found
        for start in range(0, len(words), step):
            window = _fit(" ".join(words[start:]))
            out.append(window)
            if start + step >= len(words) or len(" ".join(words[start:])) <= SNIPPET_CHARS:
                break
    return [c for c in out if c]


def _fit(text: str, limit: int = SNIPPET_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text[: limit - 4]
    return cut[: cut.rfind(" ")].rstrip(" ,;:") + " ..."


def best_snippet(chunk_text: str, question: str, claim: str = "") -> str:
    """The fragment of `chunk_text` that best supports `claim` (the answer sentence citing it)
    and `question`; at most SNIPPET_CHARS characters."""
    question_terms, claim_terms = content_terms(question), content_terms(claim)
    best, best_score = "", -1.0
    for position, fragment in enumerate(candidates(chunk_text)):
        if is_noisy(fragment):
            continue
        terms = content_terms(fragment)
        score = 2 * len(terms & claim_terms) + len(terms & question_terms)
        score -= position * 0.001  # on a tie, the earlier fragment
        if score > best_score:
            best, best_score = fragment, score
    if not best:  # everything was noise: fall back to the start of the chunk
        best = " ".join(chunk_text.split())
    return _fit(best)


def claims_by_citation(answer: str) -> dict[int, str]:
    """n -> the answer sentence(s) that cite [n] (citation marks removed)."""
    claims: dict[int, list[str]] = {}
    for sentence in re.split(r"(?<=[.!?])\s+", answer):
        for n in {int(x) for group in re.findall(r"\[(\d+(?:\s*,\s*\d+)*)\]", sentence) for x in re.split(r"\s*,\s*", group)}:
            claims.setdefault(n, []).append(re.sub(r"\[[\d,\s]+\]", "", sentence))
    return {n: " ".join(parts) for n, parts in claims.items()}
