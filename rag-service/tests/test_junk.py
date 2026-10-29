"""Junk-chunk rules, on real texts from the 2026-10-29 retrieval check, and the pipeline's use of them."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from ingestion.chunking import ChunkDraft
from ingestion.junk import junk_reason
from ingestion.memory import GB, LowMemoryError, MemoryGuard
from ingestion.pipeline import Pipeline, RunSummary
from ingestion.progress import Progress

REAL_TEXT = ("2.2 MECHANISM OF ENZYME ACTION: As we have discussed that all metabolic reactions are catalyzed by "
             "enzymes. During these reactions the substrate binds to the active site of the enzyme.")


@pytest.mark.parametrize("text", [
    "SIINDERMEXTIBOOKEBOARDRPAMSEORO",  # Biology XII cover
    "Society, Technology and Science Activity Sindh Textbook Board Jamshoro",
    "we. OK, BOARD ES ; a * sg “ . a - Mad i # % TRE, ’ =",
])
def test_scraps_are_junk(text: str) -> None:
    assert junk_reason(text) == "shorter than 100 characters"


@pytest.mark.parametrize("text", [
    # Real chunks the old 70%-letters rule wrongly skipped in the full ingestion (2026-10-29)
    "Unit-23 Digital Electronics 4, NAND Gate: Similarly, a NAND gate is an AND gate followed by a NOT gate. "
    "Y = AB A B Y 0 0 1 0 1 1 1 0 1 1 1 0",
    "Unit 3: Dynamics According to the law of conservation of momentum: m1v1 + m2v2 = m1u1 + m2u2 (3.10) "
    "KE of the system after collision = 1/2 m1v1^2 + 1/2 m2v2^2",
])
def test_equations_and_tables_are_kept(text: str) -> None:
    assert junk_reason(text) is None


@pytest.mark.parametrize("text", [
    "All rights are reserved with the SINDH TEXTBOOK BOARD, JAMSHORO. Prepared by SINDH TEXTBOOK BOARD JAMSHORO. "
    "Reviewed by Directorate of Curriculum Assessment and Research Sindh.",
    "| The era we are living in, is the era of science and technology wherein biology along with its connected "
    "disciplines play a pivotal role in the development of society.",
    "Prepared by the board and REVIEWED\nBY DIRECTORATE OF\nCURRICULUM Assessment and Research, Sindh, Jamshoro, 2024.",
])
def test_front_matter_is_junk(text: str) -> None:
    assert (junk_reason(text) or "").startswith("front matter")


@pytest.mark.parametrize("text", [
    REAL_TEXT,
    # A worked example is mostly letters even with numbers in it
    "Example 1.2 Calculate the mass of 3.25 moles of water (H2O). Data: Given No. of moles of water = 3.25, "
    "molar mass of water = 18 g/mol. Mass = moles x molar mass = 3.25 x 18 = 58.5 g of water.",
    # A unit opener names the unit's topics: kept
    "HOMEOSTASIS Chapter Major Concept In this Unit you will learn: Homeostasis, Osmoregulation, Excretion, "
    "Urinary system of man, Disorders of the urinary tract",
])
def test_real_content_is_kept(text: str) -> None:
    assert junk_reason(text) is None


def test_pipeline_drops_junk_before_storing(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO")
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.summary = RunSummary()
    drafts = [ChunkDraft(text=REAL_TEXT, page=36, content_hash="a"),
              ChunkDraft(text="Sindh Textbook Board, Jamshoro Published by", page=2, content_hash="b")]
    kept = pipeline._drop_junk(drafts)
    assert [d.content_hash for d in kept] == ["a"]
    assert pipeline.summary.chunks_skipped_junk == 1
    assert pipeline.summary.counts()["chunksSkippedJunk"] == 1
    assert "junk chunk skipped (p.2, shorter than 100 characters): 'Sindh Textbook Board" in caplog.text


def test_low_ram_stops_the_whole_run_not_just_one_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The pipeline catches unexpected errors per file and moves on; a low-memory stop must not be swallowed."""
    monkeypatch.setattr("ingestion.memory.psutil.virtual_memory", lambda: SimpleNamespace(available=int(0.5 * GB)))
    pipeline = Pipeline.__new__(Pipeline)
    pipeline.summary = RunSummary()
    pipeline.guard = MemoryGuard(sleep=lambda _s: None, max_pauses=1)

    def read_one_page(plan: object, run_id: object, progress: Progress) -> None:
        pipeline.guard.wait_until_enough("reading page 1")

    pipeline._ingest_file = read_one_page  # type: ignore[method-assign]
    plan = SimpleNamespace(error="", finished=False, pdf=tmp_path / "book.pdf")
    with pytest.raises(LowMemoryError):
        pipeline._run_one(plan, None, Progress(1, 1, tmp_path / "STOP"))  # type: ignore[arg-type]
    assert pipeline.summary.documents_failed == 0
