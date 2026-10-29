"""Shared helpers for the Q&A tests: search hits and Q&A settings without .env."""

from __future__ import annotations

from typing import Any, Optional

from bson import ObjectId

from app.settings import QASettings
from retrieval import SearchHit

ENZYME_TEXT = ("2.2 MECHANISM OF ENZYME ACTION: As we have discussed that all metabolic reactions are catalyzed by "
               "enzymes. During these reactions the substrate binds to the active site of the enzyme and forms an "
               "enzyme-substrate complex, which lowers the activation energy of the reaction.")


def hit(score: float, text: str = ENZYME_TEXT, source: str = "STBB_Biology_XI.pdf", source_type: str = "textbook",
        page: int = 37, subject_id: Optional[ObjectId] = None) -> SearchHit:
    return SearchHit(chunk_id=ObjectId(), doc_id=ObjectId(), subject_id=subject_id or ObjectId(), page=page,
                     text=text, score=score, source=source, source_type=source_type)


def qa_settings(**overrides: Any) -> QASettings:
    values: dict[str, Any] = dict(
        similarity_threshold=0.80, retrieval_margin=0.05, llm_provider="groq", groq_api_key="gsk_test_secret_123",
        groq_model="llama-3.1-8b-instant", ollama_base_url="http://localhost:11434", ollama_model="llama3.1",
        backend_origin="http://localhost:3000",
    )
    values.update(overrides)
    return QASettings(**values)


class FakeSearch:
    """Stands in for retrieval.search (a local MongoDB has no $vectorSearch). Records the calls."""

    def __init__(self, hits: list[SearchHit]) -> None:
        self.hits = hits
        self.calls: list[dict[str, Any]] = []

    def __call__(self, chunks: Any, embedder: Any, settings: Any, question: str, limit: int = 5,
                 subject_id: Optional[ObjectId] = None, topic_id: Optional[ObjectId] = None) -> list[SearchHit]:
        self.calls.append({"question": question, "limit": limit, "subject_id": subject_id, "topic_id": topic_id})
        return self.hits[:limit]
