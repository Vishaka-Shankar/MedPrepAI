from pathlib import Path

import pytest

from ingestion.chunking import PageText
from ingestion.page_cache import PageCache
from ingestion.progress import Progress, StopRequested, estimate_seconds_left, format_duration


class TestPageCache:
    def test_saved_pages_come_back(self, tmp_path: Path) -> None:
        cache = PageCache(tmp_path / "book.pages.jsonl")
        cache.append(PageText(page=1, text="Enzymes are proteins.", ocr=True))
        cache.append(PageText(page=2, text="Unicode survives: 10²³ ΔH", ocr=False))
        loaded = PageCache(cache.path).load()  # a new object, like a new run
        assert loaded == {1: PageText(page=1, text="Enzymes are proteins.", ocr=True),
                          2: PageText(page=2, text="Unicode survives: 10²³ ΔH", ocr=False)}

    def test_missing_cache_is_empty(self, tmp_path: Path) -> None:
        assert PageCache(tmp_path / "none.jsonl").load() == {}

    def test_line_cut_off_by_a_crash_is_ignored(self, tmp_path: Path) -> None:
        cache = PageCache(tmp_path / "book.pages.jsonl")
        cache.append(PageText(page=1, text="Complete page."))
        with cache.path.open("a", encoding="utf-8") as fh:
            fh.write('{"page": 2, "text": "half writ')  # power cut in the middle of page 2
        assert list(cache.load()) == [1]  # page 2 will simply be read again

    def test_changed_file_or_settings_use_a_new_cache(self, tmp_path: Path) -> None:
        a = PageCache.for_file(tmp_path, "Bio.pdf", "a" * 64, "dpi=300;psm=4")
        b = PageCache.for_file(tmp_path, "Bio.pdf", "a" * 64, "dpi=300;psm=6")  # OCR setting changed
        c = PageCache.for_file(tmp_path, "Bio.pdf", "b" * 64, "dpi=300;psm=4")  # PDF changed
        assert len({a.path, b.path, c.path}) == 3
        assert a.path == PageCache.for_file(tmp_path, "Bio.pdf", "a" * 64, "dpi=300;psm=4").path


class TestProgress:
    def test_time_left_adds_reading_and_embedding(self) -> None:
        assert estimate_seconds_left(10, 3.0, 20, 4.0) == 110.0

    def test_format_duration(self) -> None:
        assert format_duration(75) == "1m 15s"
        assert format_duration(3 * 3600 + 25 * 60) == "3h 25m"
        assert format_duration(-5) == "0m 00s"

    def test_eta_uses_measured_speed(self, tmp_path: Path) -> None:
        progress = Progress(pages_to_read=100, pages_to_embed=100, stop_file=tmp_path / "STOP")
        progress.page_read("book.pdf", 1, 100, seconds=2.0, ocr=True)
        progress.pages_embedded("book.pdf", 1, seconds=5.0, done_chunks=1, total_chunks=100)
        # 99 pages x 2 s + 99 pages x 5 s = 693 s
        assert progress.eta() == format_duration(693)

    def test_laptop_sleep_does_not_blow_up_the_estimate(self, tmp_path: Path) -> None:
        progress = Progress(pages_to_read=3, pages_to_embed=0, stop_file=tmp_path / "STOP")
        progress.page_read("book.pdf", 1, 3, seconds=2.0, ocr=True)
        progress.page_read("book.pdf", 2, 3, seconds=10804.9, ocr=True)  # the laptop slept 3 hours
        # counted as 120 s, not 3 hours: (2 + 120) / 2 = 61 s per page, 1 page left
        assert progress.eta() == format_duration(61)

    def test_stop_file_stops_the_run(self, tmp_path: Path) -> None:
        progress = Progress(pages_to_read=1, pages_to_embed=1, stop_file=tmp_path / "STOP")
        progress.check_stop()  # no file: nothing happens
        (tmp_path / "STOP").touch()
        with pytest.raises(StopRequested):
            progress.check_stop()
