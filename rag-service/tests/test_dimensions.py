"""The startup dimension check: model, stored vectors and Atlas index must match config."""

from pathlib import Path
from typing import Any, Callable

import pytest
from bson import ObjectId
from pymongo.database import Database

from config import Settings
from ingestion import dimensions
from ingestion.chunking import ChunkDraft
from ingestion.dimensions import DimensionMismatchError
from ingestion.memory import MemoryGuard
from ingestion.pipeline import FilePlan, Pipeline
from ingestion.progress import Progress
from tests.fakes import FakeEmbedder

MakeSettings = Callable[..., Settings]


class FakeChunks:
    """Just enough of a collection for index_dimension()."""

    def __init__(self, index_fields: list[dict[str, Any]]) -> None:
        self.index_fields = index_fields

    def list_search_indexes(self, name: str) -> list[dict[str, Any]]:
        return [{"name": name, "latestDefinition": {"fields": self.index_fields}}]


def test_matching_or_unknown_sizes_pass(make_settings: MakeSettings) -> None:
    s = make_settings()
    dimensions.check_dimension(s, "x", 384)
    dimensions.check_dimension(s, "x", None)  # nothing stored yet


def test_mismatch_names_both_sizes(make_settings: MakeSettings) -> None:
    with pytest.raises(DimensionMismatchError, match=r"The loaded model has 383 dimensions.*bge-small-en-v1.5 makes 384"):
        dimensions.check_dimension(make_settings(), "The loaded model", dimensions.embedder_dimension(FakeEmbedder(dim=383)))


def test_index_with_another_size_is_refused(make_settings: MakeSettings) -> None:
    s = make_settings()
    chunks = FakeChunks([{"type": "vector", "path": "embedding384", "numDimensions": 1024, "similarity": "cosine"}])
    assert dimensions.index_dimension(chunks, s.vector_index, s.embed_field) == 1024  # type: ignore[arg-type]
    with pytest.raises(DimensionMismatchError, match="Atlas index 'chunk_vector_index_384' has 1024"):
        dimensions.check_dimension(s, f"Atlas index {s.vector_index!r}",
                                   dimensions.index_dimension(chunks, s.vector_index, s.embed_field))  # type: ignore[arg-type]


def test_index_without_the_field_is_refused(make_settings: MakeSettings) -> None:
    chunks = FakeChunks([{"type": "vector", "path": "embedding", "numDimensions": 1024}])
    with pytest.raises(DimensionMismatchError, match="has no vector field 'embedding384'"):
        dimensions.index_dimension(chunks, "chunk_vector_index_384", "embedding384")  # type: ignore[arg-type]


def test_stored_vectors_of_another_size_are_refused(make_settings: MakeSettings, test_db: Database) -> None:
    test_db.chunks.insert_one({"text": "a", "embedding384": [0.1] * 100})
    with pytest.raises(DimensionMismatchError, match=r"Stored chunks \(field 'embedding384'\) has 100"):
        dimensions.check_database(make_settings(), test_db)


def test_empty_local_database_passes(make_settings: MakeSettings, test_db: Database) -> None:
    # A local MongoDB has no search indexes: the index part is skipped, not an error
    dimensions.check_database(make_settings(), test_db)


def test_ingestion_writes_the_configured_field(make_settings: MakeSettings, test_db: Database, tmp_path: Path) -> None:
    """New chunks from ingest.py go into embedding384 (bge-small), not the old `embedding` field."""
    pipeline = Pipeline.__new__(Pipeline)  # skip __init__ (it looks for Tesseract)
    pipeline.settings, pipeline.db = make_settings(), test_db
    pipeline._embedder = FakeEmbedder()  # type: ignore[assignment]
    pipeline.guard = MemoryGuard(min_free_gb=0)  # this test is not about memory
    pipeline.subject_ids, pipeline.topics = {"biology": ObjectId()}, {"biology": []}
    drafts = [ChunkDraft(text=f"Enzymes {i}", page=1, content_hash=f"h{i}", subject="biology") for i in range(3)]
    plan = FilePlan(pdf=Path("bio.pdf"), subject="biology", first=1, last=1)

    created = pipeline._embed_and_store(drafts, ObjectId(), False, plan, Progress(1, 1, tmp_path / "STOP"))

    assert created == 3
    row = test_db.chunks.find_one({"contentHash": "h0"})
    assert row is not None and len(row["embedding384"]) == 384 and "embedding" not in row
