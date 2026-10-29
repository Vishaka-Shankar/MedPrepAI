"""Text cleaning for extracted PDF pages.

All functions are pure (text in, text out) so they are easy to unit-test.
Order used by `clean_document`:
  1. normalise odd characters (ligatures, soft hyphens, non-breaking spaces)
  2. drop running headers/footers (lines repeated at the top/bottom of many pages)
  3. drop page numbers at the top/bottom of each page
  4. repair words hyphenated across lines and join lines broken mid-sentence
"""

from __future__ import annotations

import math
import re
from collections import Counter

# Only header/footer areas are inspected, so a number inside the body text is never removed
EDGE_LINES = 3
# A running header/footer needs at least this many letters ("Sindh Textbook Board" yes, "D." no);
# page numbers are handled separately by is_page_number
MIN_HEADER_LETTERS = 4

# Typographic ligatures from PDF fonts -> plain letters. (We do NOT use NFKC normalisation
# because it would also turn "m/s\u00b2" into "m/s2", which changes meaning in Physics.)
# Written as \u escapes so this file stays plain ASCII.
_CHAR_FIXES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\u00ad": "",  # soft hyphen
    "\u00a0": " ",  # non-breaking space
    "\t": " ",
    "\r": "",
}

# "7", "Page 7", "- 7 -", "(7)", "7 of 120", "Page 7 / 120"  (\u2013 and \u2014 are en/em dashes)
_PAGE_NUMBER_RE = re.compile(
    r"^(?:page\s*)?[-\u2013\u2014(\[]?\s*\d{1,4}\s*[-\u2013\u2014)\]]?\s*(?:(?:of|/)\s*\d{1,4})?$",
    re.IGNORECASE,
)

# A line starting like this begins a new item, so it is never glued to the previous line
# (\u2022 \u25cf \u25aa are bullet characters)
_LIST_ITEM_RE = re.compile(r"^(?:[\u2022\u25cf\u25aa\-*]\s|\d{1,2}[.)]\s|[a-z][.)]\s|\([a-z0-9ivx]{1,4}\)\s)", re.IGNORECASE)


def normalize_chars(text: str) -> str:
    for bad, good in _CHAR_FIXES.items():
        text = text.replace(bad, good)
    return text


# Letters that OCR often confuses with each other ("AI" is read as "Al"), mapped to one symbol
_OCR_CONFUSABLE = str.maketrans({"l": "i", "|": "i", "!": "i"})


def line_key(line: str) -> str:
    """A comparison key for header/footer lines: "Page 3" and "Page 14" get the same key,
    and so do "MedPrep AI" and its OCR reading "MedPrep Al".
    Digits become '#', case/spaces/punctuation are ignored, confusable letters are merged."""
    key = re.sub(r"\d+", "#", line.lower()).translate(_OCR_CONFUSABLE)
    return re.sub(r"[^a-z#]", "", key)


def _letters(key: str) -> int:
    return sum(ch.isalpha() for ch in key)


def _edge_lines(lines: list[str]) -> list[str]:
    non_empty = [ln for ln in lines if ln.strip()]
    return non_empty[:EDGE_LINES] + non_empty[-EDGE_LINES:]


def find_repeated_lines(pages: list[str], min_share: float = 0.5) -> set[str]:
    """Return the keys of lines that appear at the top/bottom of at least `min_share` of the pages.

    Needs at least 2 pages: with a single page nothing can be called "repeated".
    """
    if len(pages) < 2:
        return set()
    counts: Counter[str] = Counter()
    for page in pages:
        # A set, so a line counts once per page. Very short lines are never headers:
        # in an MCQ paper almost every page ends with the line "D.", which is content.
        counts.update({k for k in map(line_key, _edge_lines(page.splitlines())) if _letters(k) >= MIN_HEADER_LETTERS})
    threshold = max(2, math.ceil(min_share * len(pages)))
    return {key for key, n in counts.items() if n >= threshold}


def is_page_number(line: str) -> bool:
    return bool(_PAGE_NUMBER_RE.match(line.strip()))


def remove_headers_footers(page: str, repeated: set[str]) -> str:
    """Drop repeated header/footer lines and page numbers, only within the first/last EDGE_LINES lines."""
    lines = page.splitlines()
    content_idx = [i for i, ln in enumerate(lines) if ln.strip()]
    edge = set(content_idx[:EDGE_LINES] + content_idx[-EDGE_LINES:])
    kept = [
        ln
        for i, ln in enumerate(lines)
        if not (i in edge and (line_key(ln) in repeated or is_page_number(ln)))
    ]
    return "\n".join(kept)


def is_heading(line: str) -> bool:
    """A short line without sentence punctuation whose longer words are all capitalised,
    e.g. "Cell Membrane" or "CHAPTER 3: ENZYMES". "The site of" is not a heading."""
    line = line.strip()
    if not line or len(line) > 50 or line.endswith((".", "?", "!", ",", ";")):
        return False
    long_words = [w for w in re.findall(r"[A-Za-z]+", line) if len(w) >= 4]
    return bool(long_words) and all(w[0].isupper() for w in long_words)


def fix_broken_lines(text: str) -> str:
    """Rebuild paragraphs that the PDF split into short lines.

    - "photo-\\nsynthesis" -> "photosynthesis" (hyphen at line end + lowercase next line)
    - lines inside a paragraph are joined with a space
    - blank lines (paragraph breaks) and list items are kept
    """
    text = re.sub(r"(\w)-\n\s*([a-z])", r"\1\2", text)

    paragraphs: list[str] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [re.sub(r" {2,}", " ", ln).strip() for ln in block.splitlines()]
        lines = [ln for ln in lines if ln]
        if not lines:
            continue
        merged = [lines[0]]
        for prev_line, line in zip(lines, lines[1:]):
            # Keep a line break before list items, after headings, and before a heading
            # that follows a finished sentence. (Check the original previous line,
            # not the text merged so far.)
            # An ALL-CAPS heading always starts a new line (e.g. "CHEMISTRY" after an answer option)
            new_heading = is_heading(line) and (prev_line.endswith((".", "?", "!", ":")) or line.isupper())
            if _LIST_ITEM_RE.match(line) or is_heading(prev_line) or new_heading:
                merged.append(line)
            else:
                merged[-1] = f"{merged[-1]} {line}"
        paragraphs.append("\n".join(merged))
    return "\n\n".join(paragraphs)


def clean_document(pages: list[str]) -> list[str]:
    """Clean every page of one document. Returns one cleaned string per input page (same order)."""
    normalized = [normalize_chars(p) for p in pages]
    repeated = find_repeated_lines(normalized)
    return [fix_broken_lines(remove_headers_footers(p, repeated)).strip() for p in normalized]
