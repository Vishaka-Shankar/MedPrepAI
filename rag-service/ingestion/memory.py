"""Memory guards for long embedding runs on a laptop with little (or faulty) RAM.

Before the model is loaded and before every batch, free RAM is checked. When it is low the run
pauses (other programs may finish), and if it stays low it stops cleanly; the work done so far
is saved, so running the same command again continues.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable

import psutil

log = logging.getLogger(__name__)
GB = 1024**3
MB = 1024**2


class LowMemoryError(Exception):
    """Free RAM stayed below the limit after all pauses: stop the run cleanly."""


@dataclass
class MemoryGuard:
    min_free_gb: float = 1.5
    pause_seconds: float = 30.0
    max_pauses: int = 10  # 10 x 30 s = 5 minutes of waiting before giving up
    sleep: Callable[[float], None] = time.sleep
    paused_seconds: float = field(default=0.0, init=False)  # left out of the speed calculation
    last_free_gb: float = field(default=0.0, init=False)  # the latest reading, for progress lines

    @staticmethod
    def free_gb() -> float:
        # "available" = what Windows Task Manager shows as Available: free + reusable cache
        return psutil.virtual_memory().available / GB

    def wait_until_enough(self, before: str) -> None:
        """Return when at least min_free_gb is free; raise LowMemoryError if it never is."""
        for pause in range(self.max_pauses + 1):
            free = self.last_free_gb = self.free_gb()
            if free >= self.min_free_gb:
                return
            if pause == self.max_pauses:
                break
            log.warning("Only %.2f GB RAM free before %s (need %.1f GB). Pausing %d s (%d/%d)...",
                        free, before, self.min_free_gb, self.pause_seconds, pause + 1, self.max_pauses)
            self.sleep(self.pause_seconds)
            self.paused_seconds += self.pause_seconds
        raise LowMemoryError(
            f"Free RAM stayed below {self.min_free_gb:.1f} GB (now {free:.2f} GB) before {before}, "
            f"after waiting {self.max_pauses * self.pause_seconds:.0f} s. Stopped safely; the progress is saved. "
            "Close other programs (browser tabs, VS Code windows) and run the same command again."
        )


class MemoryMeter:
    """This process's memory now and at its peak (Windows reports the true peak as peak_wset)."""

    def __init__(self) -> None:
        self._process = psutil.Process()
        self.peak_bytes = 0

    def sample(self) -> tuple[int, int]:
        info = self._process.memory_info()
        self.peak_bytes = max(self.peak_bytes, info.rss, getattr(info, "peak_wset", 0))
        return info.rss, self.peak_bytes
