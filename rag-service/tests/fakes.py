"""Test doubles shared by several test files (no real model is ever loaded)."""

from __future__ import annotations

import hashlib
import math
import random
from typing import Optional


class FakeEmbedder:
    """Deterministic unit vectors made from a hash of the text: same text -> same vector.
    Records every text it embedded; can be told to crash on its Nth batch."""

    def __init__(self, dim: int = 384, crash_on_batch: Optional[int] = None) -> None:
        self.dim = dim
        self.crash_on_batch = crash_on_batch
        self.batches = 0
        self.texts: list[str] = []  # stored-chunk texts (get_text_embedding_batch)
        self.queries: list[str] = []

    def vector(self, text: str) -> list[float]:
        rng = random.Random(hashlib.sha256(text.encode("utf-8")).digest())
        values = [rng.gauss(0, 1) for _ in range(self.dim)]
        norm = math.sqrt(sum(v * v for v in values))
        return [v / norm for v in values]

    def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
        self.batches += 1
        if self.crash_on_batch is not None and self.batches == self.crash_on_batch:
            raise RuntimeError("simulated crash (blue screen) in the middle of the run")
        self.texts.extend(texts)
        return [self.vector(t) for t in texts]

    def get_text_embedding(self, text: str) -> list[float]:
        return self.vector(text)  # used for the dimension check; not recorded

    def get_query_embedding(self, query: str) -> list[float]:
        self.queries.append(query)
        return self.vector(query)
