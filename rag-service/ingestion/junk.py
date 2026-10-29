"""Chunks not worth storing or searching: OCR scraps and the books' front matter.

Measured on the 723 chunks stored on 2026-10-29 (retrieval check): copyright pages and prefaces
came back as the "best" match for an off-syllabus question, and scraps under 100 characters
(cover text, stray figure labels) carry no answer. The rules are deliberately conservative:
a chunk that might hold real content is kept, and every skipped chunk is logged with its text.

There is NO "too few letters" rule: in the full ingestion (2026-10-29) a 70%-letters rule also
dropped real physics and chemistry (logic gates, collision equations, worked examples), whose
equations and numbers are not letters.
"""

from __future__ import annotations

from typing import Optional

MIN_CHARS = 100  # shorter = a scrap: cover text, a stray figure label, one OCR line
# Phrases that only appear on the STBB books' copyright page and preface
FRONT_MATTER_PHRASES = (
    "all rights are reserved",
    "the era we are living in",
    "reviewed by directorate of curriculum",
)


def junk_reason(text: str) -> Optional[str]:
    """Why this chunk should not be stored, or None if it should be kept."""
    stripped = text.strip()
    if len(stripped) < MIN_CHARS:
        return f"shorter than {MIN_CHARS} characters"
    flat = " ".join(stripped.lower().split())  # OCR line breaks must not hide a phrase
    for phrase in FRONT_MATTER_PHRASES:
        if phrase in flat:
            return f"front matter ({phrase!r})"
    return None
