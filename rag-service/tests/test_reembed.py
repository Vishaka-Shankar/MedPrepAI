"""scripts/reembed_chunks.py on a LOCAL test database with the fake embedder and a mocked psutil:
resume after a crash or stop, no duplicates, the old vectors untouched, the dimension check,
and the low-memory pause / clean stop."""

import json
import logging
from pathlib import Path
from typing import Any, Callable, Optional

import pytest
from bson import ObjectId
from pymongo.database import Database

from config import Settings
from ingestion.dimensions import DimensionMismatchError
from ingestion.memory import LowMemoryError, MemoryGuard
from scripts.reembed_chunks import Reembedder, ReembedState, RefusedError, write_vectors
from tests.fakes import FakeEmbedder
from tests.test_memory import fake_free_ram

MakeSettings = Callable[..., Settings]
CHUNKS = 450  # 3 pages of 200 (the last one partial), 57 batches of 8


def seed(db: Database, n: int = CHUNKS) -> list[ObjectId]:
    """Chunks as the first ingestion stored them: text + a 1024-d BGE-M3 vector in `embedding`."""
    rows = [{"text": f"Chunk {i}: enzymes lower the activation energy.", "contentHash": f"hash-{i}",
             "page": 1 + i // 3, "subjectId": ObjectId(), "embedding": [i / 1000.0] * 1024} for i in range(n)]
    return list(db.chunks.insert_many(rows).inserted_ids)


class Loader:
    """Stands in for embedding.load_embedder: hands out the given fake, counts the loads."""

    def __init__(self, embedder: FakeEmbedder) -> None:
        self.embedder = embedder
        self.loads = 0

    def __call__(self, _settings: Settings) -> FakeEmbedder:
        self.loads += 1
        return self.embedder


@pytest.fixture
def settings(make_settings: MakeSettings) -> Settings:
    return make_settings(EMBED_BATCH="8")


@pytest.fixture
def plenty_of_ram(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_free_ram(monkeypatch, [8.0])


def make(settings: Settings, db: Database, tmp_path: Path, embedder: FakeEmbedder,
         sleeps: Optional[list[float]] = None, **kwargs: Any) -> tuple[Reembedder, Loader]:
    loader = Loader(embedder)
    guard = MemoryGuard(sleep=(sleeps if sleeps is not None else []).append)
    return Reembedder(settings, db, loader, guard=guard, state_path=tmp_path / "state.json",
                      stop_file=tmp_path / "STOP_REEMBED", **kwargs), loader


def old_vectors(db: Database) -> dict[ObjectId, list[float]]:
    return {c["_id"]: c["embedding"] for c in db.chunks.find({}, {"embedding": 1})}


def assert_all_done(db: Database) -> None:
    fake = FakeEmbedder()
    for c in db.chunks.find({}, {"text": 1, "embedding384": 1}):
        assert c["embedding384"] == pytest.approx(fake.vector(c["text"]))


@pytest.mark.usefixtures("plenty_of_ram")
class TestRun:
    def test_embeds_every_chunk_once_and_keeps_the_old_vectors(self, settings: Settings, test_db: Database,
                                                               tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
        caplog.set_level(logging.INFO, logger="reembed")
        seed(test_db)
        before = old_vectors(test_db)
        embedder = FakeEmbedder()
        reembedder, loader = make(settings, test_db, tmp_path, embedder)

        result = reembedder.run()

        assert (result.embedded, result.remaining, result.write_conflicts, loader.loads) == (CHUNKS, 0, 0, 1)
        assert sorted(embedder.texts) == sorted(c["text"] for c in test_db.chunks.find())  # each text once
        assert embedder.batches == 57  # batches of 8
        assert_all_done(test_db)
        assert old_vectors(test_db) == before  # the 1024-d backup is untouched
        assert test_db.chunks.count_documents({}) == CHUNKS  # nothing inserted
        state = json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))
        assert state["done"] == CHUNKS and state["model"] == "BAAI/bge-small-en-v1.5" and state["field"] == "embedding384"
        # progress: speed, time left and memory after each 200
        assert "chunks/min" in caplog.text and "left ~" in caplog.text and "peak" in caplog.text

    def test_resumes_after_a_crash_without_redoing_saved_work(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        ids = seed(test_db)
        crashing = FakeEmbedder(crash_on_batch=30)  # after 29 batches = 232 chunks, in the 2nd page of 200
        first, _ = make(settings, test_db, tmp_path, crashing)
        with pytest.raises(RuntimeError, match="simulated crash"):
            first.run()

        assert test_db.chunks.count_documents({"embedding384": {"$exists": True}}) == 232
        marker = json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))
        assert marker["done"] == 232 and marker["last_id"] == str(ids[231])

        second_embedder = FakeEmbedder()
        second, _ = make(settings, test_db, tmp_path, second_embedder)
        result = second.run()

        assert (result.embedded, result.remaining) == (CHUNKS - 232, 0)
        assert set(crashing.texts).isdisjoint(second_embedder.texts)  # nothing saved was embedded again
        assert len(crashing.texts) + len(second_embedder.texts) == CHUNKS
        assert json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))["done"] == CHUNKS
        assert_all_done(test_db)

    def test_stop_file_stops_cleanly_and_the_next_run_continues(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        seed(test_db)

        class StopsAfterFive(FakeEmbedder):
            def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
                out = super().get_text_embedding_batch(texts)
                if self.batches == 5:
                    (tmp_path / "STOP_REEMBED").touch()  # like `reembed_chunks.py --stop`
                return out

        first, _ = make(settings, test_db, tmp_path, StopsAfterFive())
        result = first.run()
        assert result.stopped and result.embedded == 40 and result.remaining == CHUNKS - 40
        assert not (tmp_path / "STOP_REEMBED").exists()  # removed, so the next run is not stopped

        assert make(settings, test_db, tmp_path, FakeEmbedder())[0].run().embedded == CHUNKS - 40
        assert_all_done(test_db)

    def test_second_run_finds_nothing_to_do(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        seed(test_db, 20)
        make(settings, test_db, tmp_path, FakeEmbedder())[0].run()
        again, loader = make(settings, test_db, tmp_path, FakeEmbedder())
        result = again.run()
        assert (result.embedded, loader.loads) == (0, 0)  # the model is not even loaded
        assert test_db.chunks.count_documents({}) == 20

    def test_a_chunk_that_already_has_the_vector_is_never_overwritten(self, settings: Settings, test_db: Database) -> None:
        ids = seed(test_db, 2)
        assert write_vectors(test_db, "embedding384", [(ids[0], [0.1] * 384)]) == 1
        assert write_vectors(test_db, "embedding384", [(ids[0], [0.9] * 384), (ids[1], [0.2] * 384)]) == 1
        assert test_db.chunks.find_one({"_id": ids[0]})["embedding384"][0] == 0.1  # type: ignore[index]

    def test_counts_chunks_longer_than_the_model_reads(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        seed(test_db, 10)
        test_db.chunks.update_one({"contentHash": "hash-3"}, {"$set": {"text": "LONG chunk"}})
        reembedder, _ = make(settings, test_db, tmp_path, FakeEmbedder(),
                             count_tokens=lambda t: 600 if t.startswith("LONG") else 100)
        reembedder.run()
        assert json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))["truncated"] == 1


@pytest.mark.usefixtures("plenty_of_ram")
class TestRefusals:
    def test_never_writes_into_the_backup_field(self, make_settings: MakeSettings, test_db: Database, tmp_path: Path) -> None:
        seed(test_db, 5)
        reembedder, loader = make(make_settings(EMBED_MODEL_NAME="BAAI/bge-m3"), test_db, tmp_path, FakeEmbedder(1024))
        with pytest.raises(RefusedError, match="writes to 'embedding', the backup field"):
            reembedder.run()
        assert loader.loads == 0

    def test_marker_from_another_model_is_refused(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        seed(test_db, 5)
        ReembedState(model="BAAI/bge-m3", dim=1024, field="embedding").save(tmp_path / "state.json")
        with pytest.raises(RefusedError, match="belongs to a run with BAAI/bge-m3"):
            make(settings, test_db, tmp_path, FakeEmbedder())[0].run()

    def test_dimension_check_fires_before_anything_is_written(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        seed(test_db, 5)
        with pytest.raises(DimensionMismatchError, match="loaded model has 383 dimensions"):
            make(settings, test_db, tmp_path, FakeEmbedder(dim=383))[0].run()
        assert test_db.chunks.count_documents({"embedding384": {"$exists": True}}) == 0

    def test_stored_vectors_of_another_size_stop_the_run(self, settings: Settings, test_db: Database, tmp_path: Path) -> None:
        ids = seed(test_db, 5)
        test_db.chunks.update_one({"_id": ids[0]}, {"$set": {"embedding384": [0.1] * 100}})
        reembedder, loader = make(settings, test_db, tmp_path, FakeEmbedder())
        with pytest.raises(DimensionMismatchError, match="has 100 dimensions"):
            reembedder.run()
        assert loader.loads == 0


class TestLowMemory:
    def test_pauses_when_ram_is_low_then_continues(self, settings: Settings, test_db: Database, tmp_path: Path,
                                                   monkeypatch: pytest.MonkeyPatch) -> None:
        seed(test_db)
        # model load: OK; first 200: OK; second 200: low once, then OK
        fake_free_ram(monkeypatch, [4.0, 4.0, 1.2, 4.0])
        sleeps: list[float] = []
        result = make(settings, test_db, tmp_path, FakeEmbedder(), sleeps)[0].run()
        assert sleeps == [30.0]
        assert (result.embedded, result.remaining) == (CHUNKS, 0)

    def test_stops_cleanly_if_ram_stays_low_and_keeps_the_progress(self, settings: Settings, test_db: Database,
                                                                   tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        seed(test_db)
        fake_free_ram(monkeypatch, [4.0, 4.0, 0.8])  # low from the second page on
        sleeps: list[float] = []
        with pytest.raises(LowMemoryError, match="progress is saved"):
            make(settings, test_db, tmp_path, FakeEmbedder(), sleeps)[0].run()
        assert sleeps == [30.0] * 10
        assert test_db.chunks.count_documents({"embedding384": {"$exists": True}}) == 200
        assert json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))["done"] == 200

        fake_free_ram(monkeypatch, [8.0])  # later, with RAM free again
        assert make(settings, test_db, tmp_path, FakeEmbedder())[0].run().embedded == CHUNKS - 200
        assert_all_done(test_db)

    def test_low_ram_before_loading_means_the_model_is_never_loaded(self, settings: Settings, test_db: Database,
                                                                    tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        seed(test_db, 5)
        fake_free_ram(monkeypatch, [1.0])
        reembedder, loader = make(settings, test_db, tmp_path, FakeEmbedder())
        with pytest.raises(LowMemoryError, match="before loading the model"):
            reembedder.run()
        assert loader.loads == 0

