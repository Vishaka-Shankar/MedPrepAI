"""The startup dimension check: the model, the stored vectors and the Atlas index must all have the
size config.py says (384 for bge-small, 1024 for BGE-M3). A mismatch stops with one clear message
instead of storing vectors no index can search, or searching an index with the wrong-size query."""

from __future__ import annotations

import logging
from typing import Any, Optional, Protocol

from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import OperationFailure

from config import Settings

log = logging.getLogger(__name__)


class DimensionMismatchError(Exception):
    pass


class TextEmbedder(Protocol):
    def get_text_embedding(self, text: str) -> list[float]: ...


def check_dimension(settings: Settings, what: str, actual: Optional[int]) -> None:
    """`actual` is None when there is nothing to compare yet (no vectors stored, no index)."""
    if actual is not None and actual != settings.embed_dim:
        raise DimensionMismatchError(
            f"{what} has {actual} dimensions, but EMBED_MODEL_NAME={settings.embed_model_name} "
            f"makes {settings.embed_dim}. Check EMBED_MODEL_NAME and EMBED_MODEL_DIR in .env."
        )


def embedder_dimension(embedder: TextEmbedder) -> int:
    return len(embedder.get_text_embedding("dimension check"))


def stored_dimension(chunks: Collection, field: str) -> Optional[int]:
    """Length of one stored vector in `field` (measured in the database, so no vector is downloaded)."""
    rows = list(chunks.aggregate([
        {"$match": {field: {"$exists": True}}},
        {"$limit": 1},
        {"$project": {"_id": 0, "n": {"$size": f"${field}"}}},
    ]))
    return rows[0]["n"] if rows else None


def index_dimension(chunks: Collection, index_name: str, field: str) -> Optional[int]:
    """numDimensions of `field` in the Atlas index; None if the index does not exist yet, or the
    database is not Atlas (a local MongoDB has no search indexes)."""
    try:
        infos: list[dict[str, Any]] = list(chunks.list_search_indexes(index_name))
    except OperationFailure:
        return None
    if not infos:
        log.warning("Atlas index %r does not exist yet (see README: Atlas Vector Search index).", index_name)
        return None
    definition = infos[0].get("latestDefinition") or infos[0].get("definition") or {}
    for f in definition.get("fields", []):
        if f.get("type") == "vector" and f.get("path") == field:
            return int(f["numDimensions"])
    raise DimensionMismatchError(f"Atlas index {index_name!r} has no vector field {field!r}. Recreate it from atlas_index.json.")


def check_database(settings: Settings, db: Database) -> None:
    """Stored vectors in the configured field and the configured Atlas index must match the model."""
    chunks = db.chunks
    check_dimension(settings, f"Stored chunks (field {settings.embed_field!r})", stored_dimension(chunks, settings.embed_field))
    check_dimension(settings, f"Atlas index {settings.vector_index!r}",
                    index_dimension(chunks, settings.vector_index, settings.embed_field))
