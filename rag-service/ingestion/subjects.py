"""Subject detection for files that cover several subjects (the MDCAT syllabus and past papers).

These files are split into sections by ALL-CAPS subject headings, e.g. "1. BIOLOGY",
"SECTION 2: CHEMISTRY" or just "PHYSICS". We read the pages in order and keep a
"current subject" that changes whenever such a heading appears, even in the middle of
a page. Each page is cut into segments, one per subject, so every chunk gets the right
subject and keeps its page number.
"""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Optional

from ingestion.chunking import PageText

# Heading text -> subject key. English and Logical Reasoning are detected so they can be skipped.
HEADING_SUBJECTS = {
    "BIOLOGY": "biology",
    "CHEMISTRY": "chemistry",
    "PHYSICS": "physics",
    "ENGLISH": "english",
    "LOGICAL REASONING": "logical_reasoning",
}
IN_SCOPE = {"biology", "chemistry", "physics"}  # FYP-I covers the three science subjects

# Optional "SECTION" and number in front ("1. ", "SECTION 2: "), then the subject name alone on the line
_HEADING_RE = re.compile(
    r"^(?:section\s*)?(?:\d{1,2}\s*[.:)\-]?\s*)?(biology|chemistry|physics|english|logical\s+reasoning)\s*:?$",
    re.IGNORECASE,
)
# A page naming this many different subjects as headings is a table of contents, not a section
TOC_MIN_SUBJECTS = 3


def heading_subject(line: str) -> Optional[str]:
    """The subject a heading line starts, or None if the line is not a subject heading.
    The subject name must be in CAPITALS: "CHEMISTRY" is a heading, "Chemistry" in a sentence is not."""
    match = _HEADING_RE.match(line.strip())
    if not match or not match.group(1).isupper():
        return None
    return HEADING_SUBJECTS[re.sub(r"\s+", " ", match.group(1))]


def split_by_subject(pages: list[PageText]) -> list[PageText]:
    """Cut pages into per-subject segments (same page number, `subject` set).

    - Text before the first heading (cover, guide) gets subject None.
    - A table-of-contents page gets subject None and does not change the current subject.
    - Heading lines that start a section, or repeat it at the top of a page, are dropped
      (labels, not content). The current subject's name in the middle of a page is kept as text.
    """
    segments: list[PageText] = []
    current: Optional[str] = None
    for page in pages:
        lines = page.text.splitlines()
        found = {s for s in map(heading_subject, lines) if s}
        if len(found) >= TOC_MIN_SUBJECTS:
            segments.append(replace(page, subject=None))
            continue

        buffer: list[str] = []
        for line in lines:
            subject = heading_subject(line)
            if subject == current and any(ln.strip() for ln in buffer):
                # Same subject again in the middle of a page is ordinary text,
                # e.g. a topic title wrapped as "CONCEPT OF" / "CHEMISTRY"
                subject = None
            if subject is None:
                buffer.append(line)
                continue
            _flush(segments, page, buffer, current)
            buffer = []
            current = subject
        _flush(segments, page, buffer, current)
    return segments


def _flush(segments: list[PageText], page: PageText, lines: list[str], subject: Optional[str]) -> None:
    text = "\n".join(lines).strip()
    if text:
        segments.append(replace(page, text=text, subject=subject))
