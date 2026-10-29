"""MongoDB Atlas access for ingestion. Field names follow the ERD and the Mongoose schemas in
backend/src/schemas (subjects, ingestion_runs, source_documents, chunks).

Duplicate protection:
  - source_documents.fileHash is unique: the same PDF file is never registered twice
  - chunks.contentHash is unique: the same chunk text is never stored twice
"""

from __future__ import annotations

import functools
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional, TypeVar

from bson import ObjectId
from pymongo import ASCENDING, MongoClient
from pymongo.database import Database
from pymongo.errors import BulkWriteError, ConfigurationError, ConnectionFailure

from ingestion.chunking import TopicRef

log = logging.getLogger(__name__)
DUPLICATE_KEY = 11000
RETRY_ATTEMPTS = 10
RETRY_WAIT_SECONDS = 30  # 10 x 30 s: survives an internet drop of about 5 minutes

T = TypeVar("T")


def retry_on_network(func: Callable[..., T]) -> Callable[..., T]:
    """Retry a database call when the connection to Atlas drops (Wi-Fi, sleep, router).
    ConnectionFailure covers timeouts and lost connections; ConfigurationError is what pymongo
    raises when the Atlas address can't be looked up (no DNS)."""

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> T:
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                return func(*args, **kwargs)
            except (ConnectionFailure, ConfigurationError) as exc:
                if attempt == RETRY_ATTEMPTS:
                    raise
                log.warning("Atlas unreachable (%s). Retrying in %d s (attempt %d/%d)...",
                            type(exc).__name__, RETRY_WAIT_SECONDS, attempt, RETRY_ATTEMPTS)
                time.sleep(RETRY_WAIT_SECONDS)
        raise AssertionError("unreachable")

    return wrapper


def now() -> datetime:
    return datetime.now(timezone.utc)


def connect(uri: str) -> tuple[MongoClient, Database]:
    """Connect and ping. The database name comes from the URI (.../medprep?...)."""
    client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=15000, tz_aware=True)
    client.admin.command("ping")
    return client, client.get_default_database()


@retry_on_network
def ensure_indexes(db: Database) -> None:
    """The unique keys that make re-runs safe. Same definitions as the Mongoose schemas,
    so `npm run db:setup` and this script never fight over them."""
    db.chunks.create_index([("contentHash", ASCENDING)], unique=True, name="contentHash_1")
    db.source_documents.create_index([("fileHash", ASCENDING)], unique=True, name="fileHash_1")


@retry_on_network
def ensure_subject(db: Database, code: str, name: str, weight_share: float) -> ObjectId:
    """Find the subject by code, creating it the first time."""
    doc = db.subjects.find_one_and_update(
        {"code": code},
        {"$setOnInsert": {"code": code, "name": name, "weightShare": weight_share, "createdAt": now(), "updatedAt": now()}},
        upsert=True,
        return_document=True,
    )
    return doc["_id"]


@retry_on_network
def load_topics(db: Database, subject_id: ObjectId) -> list[TopicRef]:
    return [TopicRef(id=t["_id"], name=t["name"]) for t in db.topics.find({"subjectId": subject_id}, {"name": 1})]


@retry_on_network
def start_run(db: Database) -> ObjectId:
    started = now()
    return db.ingestion_runs.insert_one({"startedAt": started, "counts": {}, "createdAt": started, "updatedAt": started}).inserted_id


@retry_on_network
def finish_run(db: Database, run_id: ObjectId, counts: dict[str, int]) -> None:
    db.ingestion_runs.update_one({"_id": run_id}, {"$set": {"finishedAt": now(), "counts": counts, "updatedAt": now()}})


@retry_on_network
def find_document(db: Database, file_hash: str) -> Optional[dict[str, Any]]:
    return db.source_documents.find_one({"fileHash": file_hash})


@retry_on_network
def create_document(db: Database, fields: dict[str, Any]) -> ObjectId:
    stamp = now()
    return db.source_documents.insert_one({**fields, "createdAt": stamp, "updatedAt": stamp}).inserted_id


@retry_on_network
def mark_document_complete(db: Database, doc_id: ObjectId, pages: int, ocr_pages: int) -> None:
    db.source_documents.update_one(
        {"_id": doc_id},
        {"$set": {"pages": pages, "ocrPages": ocr_pages, "ingestedAt": now(), "updatedAt": now()}},
    )


@retry_on_network
def existing_hashes(db: Database, hashes: Iterable[str]) -> set[str]:
    hashes = list(hashes)
    if not hashes:
        return set()
    return {d["contentHash"] for d in db.chunks.find({"contentHash": {"$in": hashes}}, {"contentHash": 1})}


@retry_on_network
def delete_stale_chunks(db: Database, doc_id: ObjectId, current_hashes: set[str], pages: list[int]) -> int:
    """When a file is re-processed (e.g. after a cleaning fix), remove its chunks that the
    pipeline no longer produces, so old versions of the text don't linger next to the new ones.
    Only chunks on `pages` (the pages just processed) are considered."""
    return db.chunks.delete_many({
        "docId": doc_id,
        "page": {"$in": pages},
        "contentHash": {"$nin": list(current_hashes)},
    }).deleted_count


@retry_on_network
def insert_chunks(db: Database, chunks: list[dict[str, Any]]) -> tuple[int, int]:
    """Insert chunks; returns (inserted, duplicates). Duplicates are skipped, not errors:
    the unique contentHash index is the final guard even if two runs overlap."""
    if not chunks:
        return 0, 0
    stamp = now()
    for c in chunks:
        c.setdefault("createdAt", stamp)
        c.setdefault("updatedAt", stamp)
    try:
        result = db.chunks.insert_many(chunks, ordered=False)
        return len(result.inserted_ids), 0
    except BulkWriteError as exc:
        errors = exc.details.get("writeErrors", [])
        if any(e.get("code") != DUPLICATE_KEY for e in errors):
            raise
        return exc.details.get("nInserted", 0), len(errors)
