"""Progress reporting (file, page, elapsed, time left), safe stopping, and keeping Windows awake."""

from __future__ import annotations

import ctypes
import logging
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

# Until real timings exist in this run, estimate with what we measured on this laptop (Step B)
DEFAULT_READ_SECONDS_PER_PAGE = 2.8
DEFAULT_EMBED_SECONDS_PER_PAGE = 4.1
# A page or batch that "took" longer than this means the laptop slept in between;
# count at most this much, so one sleep doesn't blow up the time-left estimate
MAX_COUNTED_SECONDS = 120.0


class StopRequested(Exception):
    """The STOP file exists (python ingest.py --stop): stop cleanly at the next safe point."""


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    return f"{hours}h {rest // 60:02d}m" if hours else f"{rest // 60}m {rest % 60:02d}s"


def estimate_seconds_left(pages_to_read: int, read_avg: float, pages_to_embed: int, embed_avg: float) -> float:
    """Time left = pages still to read x seconds per read page + pages still to embed x seconds per embedded page."""
    return pages_to_read * read_avg + pages_to_embed * embed_avg


@dataclass
class Progress:
    """Counts the work of the whole run so every log line can say how much is left."""

    pages_to_read: int  # pages not yet in the page cache
    pages_to_embed: int  # pages of files not yet finished
    stop_file: Path
    started: float = field(default_factory=time.perf_counter)
    read_done: int = 0
    read_seconds: float = 0.0
    embed_done: float = 0.0  # a batch counts as its share of the file's pages
    embed_seconds: float = 0.0

    def check_stop(self) -> None:
        if self.stop_file.exists():
            raise StopRequested()

    def eta(self) -> str:
        read_avg = self.read_seconds / self.read_done if self.read_done else DEFAULT_READ_SECONDS_PER_PAGE
        embed_avg = self.embed_seconds / self.embed_done if self.embed_done else DEFAULT_EMBED_SECONDS_PER_PAGE
        left = estimate_seconds_left(self.pages_to_read - self.read_done, read_avg, self.pages_to_embed - self.embed_done, embed_avg)
        return format_duration(left)

    def elapsed(self) -> str:
        return format_duration(time.perf_counter() - self.started)

    def page_read(self, file_name: str, page: int, last_page: int, seconds: float, ocr: bool) -> None:
        self.read_done += 1
        self.read_seconds += min(seconds, MAX_COUNTED_SECONDS)
        log.info("  %s page %d/%d %s %.1fs | elapsed %s | left ~%s",
                 file_name, page, last_page, "OCR " if ocr else "text", seconds, self.elapsed(), self.eta())

    def pages_embedded(self, file_name: str, pages: float, seconds: float, done_chunks: int, total_chunks: int) -> None:
        """Called after each embedding batch; `pages` is this batch's share of the file's pages."""
        self.embed_done += pages
        self.embed_seconds += min(seconds, MAX_COUNTED_SECONDS)
        if total_chunks == 0:
            log.info("  %s: no new chunks to embed | elapsed %s | left ~%s", file_name, self.elapsed(), self.eta())
            return
        log.info("  %s embedded %d/%d chunks | elapsed %s | left ~%s",
                 file_name, done_chunks, total_chunks, self.elapsed(), self.eta())


class KeepAwake:
    """Ask Windows not to go to sleep while the run is going (released when it ends).
    Closing the laptop lid can still sleep it, depending on the power settings."""

    ES_CONTINUOUS = 0x80000000
    ES_SYSTEM_REQUIRED = 0x00000001

    def __enter__(self) -> "KeepAwake":
        if sys.platform == "win32":
            ctypes.windll.kernel32.SetThreadExecutionState(self.ES_CONTINUOUS | self.ES_SYSTEM_REQUIRED)
        return self

    def __exit__(self, *exc: object) -> None:
        if sys.platform == "win32":
            ctypes.windll.kernel32.SetThreadExecutionState(self.ES_CONTINUOUS)
