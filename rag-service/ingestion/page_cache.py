"""A per-file cache of extracted page text, so an interrupted run never redoes OCR.

Each PDF gets one file in data/processed/: one JSON line per finished page, appended and
flushed to disk right away. If the run stops in the middle of writing a line, that last
broken line is ignored and the page is simply read again.

The file name includes the PDF's hash and the OCR settings, so a changed PDF or changed
OCR settings automatically start a fresh cache.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from ingestion.chunking import PageText


class PageCache:
    def __init__(self, path: Path) -> None:
        self.path = path

    @classmethod
    def for_file(cls, folder: Path, pdf_name: str, file_hash: str, settings_signature: str) -> "PageCache":
        stem = Path(pdf_name).stem
        sig = hashlib.sha256(settings_signature.encode("utf-8")).hexdigest()[:8]
        return cls(folder / f"{stem}_{file_hash[:12]}_{sig}.pages.jsonl")

    def load(self) -> dict[int, PageText]:
        """All pages saved so far (page number -> PageText)."""
        pages: dict[int, PageText] = {}
        if not self.path.is_file():
            return pages
        with self.path.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                    pages[int(row["page"])] = PageText(page=int(row["page"]), text=row["text"], ocr=bool(row["ocr"]))
                except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                    continue  # a line cut off by a crash: that page will be read again
        return pages

    def append(self, page: PageText) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"page": page.page, "text": page.text, "ocr": page.ocr}, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())  # really on disk, even if the laptop loses power next
