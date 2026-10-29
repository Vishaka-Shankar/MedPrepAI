"""Memory guard with a mocked psutil: pause when RAM is low, stop cleanly if it stays low."""

from types import SimpleNamespace

import pytest

from ingestion import memory
from ingestion.memory import GB, LowMemoryError, MemoryGuard


def fake_free_ram(monkeypatch: pytest.MonkeyPatch, readings_gb: list[float]) -> list[float]:
    """psutil.virtual_memory() returns these free-RAM readings in order (the last one repeats)."""
    readings = list(readings_gb)

    def virtual_memory() -> SimpleNamespace:
        value = readings.pop(0) if len(readings) > 1 else readings[0]
        return SimpleNamespace(available=int(value * GB))

    monkeypatch.setattr(memory.psutil, "virtual_memory", virtual_memory)
    return readings


def test_enough_ram_does_not_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_free_ram(monkeypatch, [4.0])
    sleeps: list[float] = []
    MemoryGuard(sleep=sleeps.append).wait_until_enough("the next 200 chunks")
    assert sleeps == []


def test_low_ram_pauses_30_seconds_then_continues(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    fake_free_ram(monkeypatch, [1.2, 1.4, 2.0])
    sleeps: list[float] = []
    guard = MemoryGuard(sleep=sleeps.append)
    guard.wait_until_enough("the next 200 chunks")
    assert sleeps == [30.0, 30.0]
    assert guard.paused_seconds == 60.0
    assert "Only 1.20 GB RAM free before the next 200 chunks (need 1.5 GB). Pausing 30 s (1/10)" in caplog.text


def test_ram_that_stays_low_stops_with_a_clear_message(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_free_ram(monkeypatch, [0.9])
    sleeps: list[float] = []
    with pytest.raises(LowMemoryError, match=r"stayed below 1.5 GB \(now 0.90 GB\) before loading the model.*progress is saved"):
        MemoryGuard(sleep=sleeps.append).wait_until_enough("loading the model")
    assert sleeps == [30.0] * 10  # 5 minutes of waiting, then a clean stop


def test_meter_tracks_the_peak() -> None:
    meter = memory.MemoryMeter()
    now, peak = meter.sample()
    assert 0 < now <= peak
    assert meter.sample()[1] >= peak
