"""Retrieval: find the chunks closest to a question with Atlas Vector Search.

The field and index come from config.py, so with the default model the search runs on
`embedding384` with `chunk_vector_index_384` (384 dims). The question is embedded with
get_query_embedding(), which adds the model's query prefix ("Represent this sentence for
searching relevant passages: " for bge-small); stored chunks were embedded without it.

Ranking: syllabus chunks are topic lists ("1.1 Classify viruses...") that name a topic without
explaining it, yet they scored as high as the textbook pages that do explain it (retrieval check,
2026-10-29). So for ranking only, syllabus chunks get SYLLABUS_PENALTY subtracted; the score
returned is still Atlas's own. To have something to re-rank, Atlas returns twice `limit` first.

The Q&A service (app/relevance.py, used by POST /retrieve and /answer) calls search().
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Protocol

from bson import ObjectId
from pymongo.collection import Collection
from pymongo.database import Database

from config import Settings
from ingestion import dimensions

DEFAULT_LIMIT = 5
MAX_LIMIT = 20
# Atlas looks at numCandidates nearest neighbours and returns the best `limit`;
# 20x the limit is Atlas's suggested balance of accuracy and speed
CANDIDATES_PER_RESULT = 20
FETCH_FACTOR = 2  # Atlas returns 2 x limit, re-ranked down to `limit`
SYLLABUS_PENALTY = 0.02  # enough to put a topic list below textbook text that scored within 0.02
MAX_QUESTION_CHARS = 1000


class QueryEmbedder(Protocol):
    def get_query_embedding(self, query: str) -> list[float]: ...

    def get_text_embedding(self, text: str) -> list[float]: ...


@dataclass(frozen=True)
class SearchHit:
    chunk_id: ObjectId
    doc_id: ObjectId
    subject_id: ObjectId
    page: Optional[int]
    text: str
    score: float  # cosine similarity scaled by Atlas to 0..1 (higher = closer)
    source: str  # file name, for the citation
    source_type: str  # textbook / syllabus / past_paper


def build_search_pipeline(settings: Settings, query_vector: list[float], limit: int = DEFAULT_LIMIT,
                          subject_id: Optional[ObjectId] = None,
                          topic_id: Optional[ObjectId] = None) -> list[dict[str, Any]]:
    """The aggregation pipeline for one search. The vector size is checked here, because Atlas
    gives an unclear error for a query vector of the wrong size."""
    dimensions.check_dimension(settings, "The question's vector", len(query_vector))
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_LIMIT}")
    fetch = limit * FETCH_FACTOR
    vector_search: dict[str, Any] = {
        "index": settings.vector_index,
        "path": settings.embed_field,
        "queryVector": query_vector,
        "numCandidates": fetch * CANDIDATES_PER_RESULT,
        "limit": fetch,
    }
    # Scores bunch together across subjects, so the subject filter matters (audit 2026-10-29).
    # Both fields are filter fields in the Atlas index (atlas_index.json).
    conditions = [{field: {"$eq": value}} for field, value in (("subjectId", subject_id), ("topicId", topic_id))
                  if value is not None]
    if len(conditions) == 1:
        vector_search["filter"] = conditions[0]
    elif conditions:
        vector_search["filter"] = {"$and": conditions}
    return [
        {"$vectorSearch": vector_search},
        {"$addFields": {"score": {"$meta": "vectorSearchScore"}}},
        *rerank_stages(limit),
    ]


def rerank_stages(limit: int) -> list[dict[str, Any]]:
    """Add the source file and its type, push syllabus chunks down by SYLLABUS_PENALTY, keep `limit`.
    Separate from the $vectorSearch stage so it can be tested on a local MongoDB."""
    return [
        {"$lookup": {"from": "source_documents", "localField": "docId", "foreignField": "_id", "as": "doc"}},
        {"$set": {"source": {"$first": "$doc.source"}, "sourceType": {"$first": "$doc.type"}}},
        {"$set": {"rankScore": {"$cond": [{"$eq": ["$sourceType", "syllabus"]},
                                          {"$subtract": ["$score", SYLLABUS_PENALTY]}, "$score"]}}},
        {"$sort": {"rankScore": -1, "_id": 1}},
        {"$limit": limit},
        # Return the text, never the vectors (they are large and not needed)
        {"$project": {"docId": 1, "subjectId": 1, "page": 1, "text": 1, "score": 1, "source": 1, "sourceType": 1}},
    ]


def search(chunks: Collection, embedder: QueryEmbedder, settings: Settings, question: str,
           limit: int = DEFAULT_LIMIT, subject_id: Optional[ObjectId] = None,
           topic_id: Optional[ObjectId] = None) -> list[SearchHit]:
    question = question.strip()
    if not question:
        raise ValueError("question must not be empty")
    if len(question) > MAX_QUESTION_CHARS:
        raise ValueError(f"question must be at most {MAX_QUESTION_CHARS} characters")
    vector = embedder.get_query_embedding(question)
    pipeline = build_search_pipeline(settings, vector, limit, subject_id, topic_id)
    return [
        SearchHit(chunk_id=r["_id"], doc_id=r["docId"], subject_id=r["subjectId"], page=r.get("page"),
                  text=r["text"], score=float(r["score"]), source=r.get("source") or "?",
                  source_type=r.get("sourceType") or "?")
        for r in chunks.aggregate(pipeline)
    ]


def check_ready(settings: Settings, db: Database, embedder: QueryEmbedder) -> None:
    """Startup dimension check for the search service: the model, the stored vectors and the
    Atlas index must all have settings.embed_dim dimensions. Raises DimensionMismatchError."""
    dimensions.check_dimension(settings, "The loaded model", dimensions.embedder_dimension(embedder))
    dimensions.check_database(settings, db)
