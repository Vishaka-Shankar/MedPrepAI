"""Retrieval uses the configured field and index (embedding384 / chunk_vector_index_384)."""

from typing import Any, Callable

import pytest
from bson import ObjectId
from pymongo.database import Database

from config import Settings
from ingestion.dimensions import DimensionMismatchError
from retrieval import SYLLABUS_PENALTY, build_search_pipeline, check_ready, rerank_stages, search
from tests.fakes import FakeEmbedder

MakeSettings = Callable[..., Settings]


class RecordingChunks:
    """Records the pipeline; returns canned rows (a local MongoDB has no $vectorSearch)."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.pipeline: list[dict[str, Any]] = []

    def aggregate(self, pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self.pipeline = pipeline
        return self.rows


def test_searches_the_384_field_and_index(make_settings: MakeSettings) -> None:
    pipeline = build_search_pipeline(make_settings(), [0.0] * 384, limit=5)
    vs, project = pipeline[0]["$vectorSearch"], pipeline[-1]["$project"]
    # Atlas returns 2 x 5 candidates, re-ranked down to 5
    assert (vs["index"], vs["path"], vs["limit"], vs["numCandidates"]) == ("chunk_vector_index_384", "embedding384", 10, 200)
    assert "filter" not in vs
    assert pipeline[-2] == {"$limit": 5}
    assert "embedding384" not in project and "embedding" not in project  # vectors stay in the DB


def test_bge_m3_searches_the_old_field(make_settings: MakeSettings) -> None:
    vs = build_search_pipeline(make_settings(EMBED_MODEL_NAME="BAAI/bge-m3"), [0.0] * 1024)[0]["$vectorSearch"]
    assert (vs["index"], vs["path"]) == ("chunk_vector_index", "embedding")


def test_subject_filter(make_settings: MakeSettings) -> None:
    subject = ObjectId()
    vs = build_search_pipeline(make_settings(), [0.0] * 384, subject_id=subject)[0]["$vectorSearch"]
    assert vs["filter"] == {"subjectId": {"$eq": subject}}


def test_subject_and_topic_filter(make_settings: MakeSettings) -> None:
    subject, topic = ObjectId(), ObjectId()
    vs = build_search_pipeline(make_settings(), [0.0] * 384, subject_id=subject, topic_id=topic)[0]["$vectorSearch"]
    assert vs["filter"] == {"$and": [{"subjectId": {"$eq": subject}}, {"topicId": {"$eq": topic}}]}
    only_topic = build_search_pipeline(make_settings(), [0.0] * 384, topic_id=topic)[0]["$vectorSearch"]
    assert only_topic["filter"] == {"topicId": {"$eq": topic}}


def test_rejects_a_wrong_size_vector_and_bad_limits(make_settings: MakeSettings) -> None:
    s = make_settings()
    with pytest.raises(DimensionMismatchError, match="question's vector has 1024 dimensions"):
        build_search_pipeline(s, [0.0] * 1024)
    for bad in (0, 21):
        with pytest.raises(ValueError, match="limit"):
            build_search_pipeline(s, [0.0] * 384, limit=bad)


def test_search_embeds_the_question_as_a_query_and_returns_hits(make_settings: MakeSettings) -> None:
    ids = ObjectId(), ObjectId(), ObjectId()
    chunks = RecordingChunks([{"_id": ids[0], "docId": ids[1], "subjectId": ids[2], "page": 12, "text": "Enzymes...",
                               "score": 0.91, "source": "STBB_Biology_XI.pdf", "sourceType": "textbook"}])
    embedder = FakeEmbedder()

    hits = search(chunks, embedder, make_settings(), "  What is an enzyme?  ", limit=3)  # type: ignore[arg-type]

    assert embedder.queries == ["What is an enzyme?"]  # query embedding: the model adds its prefix
    assert embedder.texts == []
    assert chunks.pipeline[0]["$vectorSearch"]["queryVector"] == embedder.vector("What is an enzyme?")
    assert len(hits) == 1 and hits[0].chunk_id == ids[0] and hits[0].page == 12 and hits[0].score == 0.91
    assert (hits[0].source, hits[0].source_type) == ("STBB_Biology_XI.pdf", "textbook")


def test_syllabus_topic_lists_rank_below_close_textbook_text(test_db: Database) -> None:
    """The re-ranking stages on a local MongoDB (scores set by hand: no $vectorSearch locally)."""
    book, syllabus = ObjectId(), ObjectId()
    test_db.source_documents.insert_many([{"_id": book, "type": "textbook", "source": "STBB_Biology_XI.pdf"},
                                          {"_id": syllabus, "type": "syllabus", "source": "PMDC.pdf"}])
    # The virus question from the retrieval check: syllabus list 0.884 between textbook 0.889 and 0.882
    test_db.chunks.insert_many([
        {"text": "bacteriophage structure", "docId": book, "score": 0.889, "embedding384": [0.1]},
        {"text": "1.1 Classify viruses", "docId": syllabus, "score": 0.884},
        {"text": "viruses discovery", "docId": book, "score": 0.882},
        {"text": "capsid", "docId": book, "score": 0.875},
        {"text": "unrelated", "docId": book, "score": 0.500},
    ])
    rows = list(test_db.chunks.aggregate(rerank_stages(limit=4)))

    # 0.884 - 0.02 = 0.864: below every textbook chunk within 0.02 of it, above the unrelated one
    assert [r["text"] for r in rows] == ["bacteriophage structure", "viruses discovery", "capsid", "1.1 Classify viruses"]
    assert rows[3]["score"] == 0.884  # the returned score is Atlas's own, not the penalised one
    assert rows[3]["sourceType"] == "syllabus" and rows[0]["source"] == "STBB_Biology_XI.pdf"
    assert "embedding384" not in rows[0]
    assert SYLLABUS_PENALTY == 0.02


def test_search_validates_the_question(make_settings: MakeSettings) -> None:
    for bad in ("   ", "x" * 1001):
        with pytest.raises(ValueError):
            search(RecordingChunks([]), FakeEmbedder(), make_settings(), bad)  # type: ignore[arg-type]


def test_startup_check_refuses_a_model_of_the_wrong_size(make_settings: MakeSettings) -> None:
    with pytest.raises(DimensionMismatchError, match="loaded model has 1024"):
        check_ready(make_settings(), None, FakeEmbedder(dim=1024))  # type: ignore[arg-type]
