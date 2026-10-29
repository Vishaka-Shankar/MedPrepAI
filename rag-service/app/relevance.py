"""Decide whether retrieved chunks are relevant enough to answer from.

retrieval.search() always returns the k closest chunks, even for "Who won the cricket world cup?"
(best score 0.763 on our data). So on top of it:
  1. drop any hit the junk rules reject (a safety net; junk is normally never stored)
  2. relevant only if the best score >= SIMILARITY_THRESHOLD
  3. keep hits scoring >= max(threshold, best - RETRIEVAL_MARGIN), in search (re-ranked) order
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from bson import ObjectId
from pymongo.collection import Collection

import retrieval
from config import Settings
from ingestion.junk import junk_reason
from retrieval import SearchHit


@dataclass(frozen=True)
class Retrieval:
    relevant: bool
    chunks: list[SearchHit] = field(default_factory=list)
    best_score: Optional[float] = None  # None when nothing usable came back


def apply_relevance(hits: list[SearchHit], threshold: float, margin: float) -> Retrieval:
    usable = [h for h in hits if junk_reason(h.text) is None]
    if not usable:
        return Retrieval(relevant=False)
    best = max(h.score for h in usable)
    if best < threshold:
        return Retrieval(relevant=False, best_score=best)
    floor = max(threshold, best - margin)
    return Retrieval(relevant=True, chunks=[h for h in usable if h.score >= floor], best_score=best)


class Retriever:
    """search + relevance in one call: retriever(question, k, subject_id, topic_id) -> Retrieval."""

    def __init__(self, get_chunks: Callable[[], Collection], get_embedder: Callable[[], Any], settings: Settings,
                 threshold: float, margin: float, search_fn: Callable[..., list[SearchHit]] = retrieval.search) -> None:
        self.get_chunks = get_chunks
        self.get_embedder = get_embedder  # loads the model on first use
        self.settings = settings
        self.threshold = threshold
        self.margin = margin
        self.search_fn = search_fn  # tests pass a fake: a local MongoDB has no $vectorSearch

    def __call__(self, question: str, k: int = 5, subject_id: Optional[ObjectId] = None,
                 topic_id: Optional[ObjectId] = None) -> Retrieval:
        hits = self.search_fn(self.get_chunks(), self.get_embedder(), self.settings, question,
                              limit=k, subject_id=subject_id, topic_id=topic_id)
        return apply_relevance(hits, self.threshold, self.margin)
