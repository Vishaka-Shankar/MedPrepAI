"""Re-embed the chunks already in the database with the configured model (bge-small, 384-d)
into a NEW field (embedding384), from their stored text: no PDF reading, no OCR.

    python scripts/reembed_chunks.py --estimate --used-mb 154   # storage numbers only (reads, writes nothing)
    python scripts/reembed_chunks.py --used-mb 154              # run it (stop and restart at any point)
    python scripts/reembed_chunks.py --stop                     # ask a running re-embed to stop safely

- The old 1024-d `embedding` field is never changed: it stays as a backup until you approve
  removing it. The script refuses to run if the target field is `embedding`.
- 200 chunks are read at a time (only _id and text, never the old vectors), embedded EMBED_BATCH
  (8) at a time on EMBED_THREADS (2) CPU threads, and each batch is saved at once.
- Resume: logs/reembed_state.json records the last chunk done; only chunks WITHOUT embedding384
  are ever picked, and each update only applies if the field is still missing, so a chunk is
  never embedded into the database twice.
- Memory: free RAM is checked before the model loads and before every 200 chunks; under 1.5 GB
  the run pauses 30 s (up to 10 times), then stops cleanly with a message.

Exit codes: 0 = done, 1 = could not start, 2 = stopped: low memory, 3 = stopped on request.
"""

from __future__ import annotations

import argparse
import gc
import json
import logging
import math
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:  # `python scripts/reembed_chunks.py` from rag-service/
    sys.path.insert(0, str(SERVICE_DIR))

from bson import ObjectId  # noqa: E402
from pymongo import UpdateOne  # noqa: E402
from pymongo.database import Database  # noqa: E402
from pymongo.errors import ConfigurationError as PyMongoConfigError  # noqa: E402
from pymongo.errors import OperationFailure, ServerSelectionTimeoutError  # noqa: E402

from config import BGE_M3, ConfigError, Settings, load_settings  # noqa: E402
from ingestion import dimensions, store  # noqa: E402
from ingestion.memory import MB, LowMemoryError, MemoryGuard, MemoryMeter  # noqa: E402
from ingestion.progress import format_duration  # noqa: E402
from ingestion.storage import plan_storage, read_db_size  # noqa: E402

log = logging.getLogger("reembed")
PAGE_SIZE = 200
BACKUP_FIELD = BGE_M3.field  # "embedding": the first ingestion's BGE-M3 vectors, kept as a backup
STATE_FILE = SERVICE_DIR / "logs" / "reembed_state.json"
STOP_FILE = SERVICE_DIR / "STOP_REEMBED"
LOG_FILE = SERVICE_DIR / "logs" / "reembed.log"


class Embedder(Protocol):
    def get_text_embedding(self, text: str) -> list[float]: ...

    def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]: ...


class RefusedError(Exception):
    """The run would be unsafe (overwrite the backup, wrong marker, not enough storage)."""


class StopRequested(Exception):
    """The STOP_REEMBED file exists (--stop)."""


@dataclass
class ReembedState:
    """The resume marker. Saved after every batch, so a crash loses at most one batch of work."""

    model: str
    dim: int
    field: str
    last_id: Optional[str] = None  # every chunk up to this _id (in _id order) is done
    done: int = 0  # chunks written over all runs
    truncated: int = 0  # chunks longer than the model reads (the end was not embedded)
    started_at: str = ""
    updated_at: str = ""

    @classmethod
    def load(cls, path: Path, settings: Settings) -> "ReembedState":
        fresh = cls(model=settings.embed_model_name, dim=settings.embed_dim, field=settings.embed_field,
                    started_at=_now())
        if not path.is_file():
            return fresh
        try:
            state = cls(**json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, TypeError) as exc:
            raise RefusedError(f"{path} is damaged ({exc}). Delete it and run again: chunks already "
                               "done are still skipped, because they have the new field.") from None
        if (state.model, state.dim, state.field) != (fresh.model, fresh.dim, fresh.field):
            raise RefusedError(
                f"{path} belongs to a run with {state.model} ({state.dim} dims, field {state.field!r}), "
                f"but .env now selects {fresh.model} ({fresh.dim} dims, field {fresh.field!r}). "
                "Fix EMBED_MODEL_NAME, or delete the file to start a new re-embed."
            )
        return state

    def save(self, path: Path) -> None:
        """Write to a temporary file, then rename: a crash mid-write can't leave half a marker."""
        self.updated_at = _now()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        os.replace(tmp, path)


@dataclass
class RunResult:
    embedded: int = 0  # written in this run
    remaining: int = 0  # still without the new field at the end
    stopped: bool = False
    elapsed_seconds: float = 0.0
    peak_bytes: int = 0
    write_conflicts: int = 0  # chunk already had the field (another run wrote it first): skipped


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Database calls, each retried when the Atlas connection drops (same rule as ingestion)
@store.retry_on_network
def count_missing(db: Database, vector_field: str) -> int:
    return db.chunks.count_documents({vector_field: {"$exists": False}})


@store.retry_on_network
def fetch_page(db: Database, vector_field: str, after: Optional[ObjectId], size: int) -> list[dict[str, Any]]:
    query: dict[str, Any] = {vector_field: {"$exists": False}}
    if after is not None:
        query["_id"] = {"$gt": after}
    # Only _id and text: the old 1024-d vectors are never downloaded
    return list(db.chunks.find(query, {"text": 1}).sort("_id", 1).limit(size))


@store.retry_on_network
def write_vectors(db: Database, vector_field: str, rows: list[tuple[ObjectId, list[float]]]) -> int:
    stamp = store.now()
    # "$exists: False" in the filter: a chunk that already has the field is never written again
    ops = [UpdateOne({"_id": _id, vector_field: {"$exists": False}}, {"$set": {vector_field: vec, "updatedAt": stamp}})
           for _id, vec in rows]
    return db.chunks.bulk_write(ops, ordered=False).modified_count


def check_vector(vector: list[float], dim: int) -> list[float]:
    if len(vector) != dim:
        raise dimensions.DimensionMismatchError(f"the model returned a {len(vector)}-d vector, expected {dim}")
    values = [float(v) for v in vector]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("the model returned a vector with NaN or infinity")
    return values


@dataclass
class Reembedder:
    settings: Settings
    db: Database
    load_embedder: Callable[[Settings], Embedder]
    count_tokens: Optional[Callable[[str], int]] = None  # None = don't count truncated chunks
    guard: MemoryGuard = field(default_factory=MemoryGuard)
    meter: MemoryMeter = field(default_factory=MemoryMeter)
    state_path: Path = STATE_FILE
    stop_file: Path = STOP_FILE
    page_size: int = PAGE_SIZE
    clock: Callable[[], float] = time.monotonic

    def run(self) -> RunResult:
        s = self.settings
        if s.embed_field == BACKUP_FIELD:
            raise RefusedError(f"EMBED_MODEL_NAME={s.embed_model_name} writes to {BACKUP_FIELD!r}, the backup "
                               "field. Re-embedding is for a model with its own field (bge-small: embedding384).")
        state = ReembedState.load(self.state_path, s)
        result = RunResult()
        started = self.clock()
        total_missing = count_missing(self.db, s.embed_field)
        if total_missing == 0:
            log.info("Nothing to do: every chunk already has %r.", s.embed_field)
            return result
        log.info("%d chunk(s) need %r (%s, %d dims). Already done in earlier runs: %d.",
                 total_missing, s.embed_field, s.embed_model_name, s.embed_dim, state.done)
        dimensions.check_database(s, self.db)  # stored embedding384 + the new index, if they exist

        self.guard.wait_until_enough("loading the model")
        log.info("Loading %s (%d CPU threads, batches of %d)...", s.embed_model_name, s.embed_threads, s.embed_batch_size)
        embedder = self.load_embedder(s)
        dimensions.check_dimension(s, "The loaded model", dimensions.embedder_dimension(embedder))
        self._log_memory("model loaded")

        after = ObjectId(state.last_id) if state.last_id else None
        swept = after is None  # after the marker, sweep once from the start for anything skipped
        try:
            while True:
                self._check_stop()
                self.guard.wait_until_enough(f"the next {self.page_size} chunks")
                page = fetch_page(self.db, s.embed_field, after, self.page_size)
                if not page:
                    if swept:
                        break
                    after, swept = None, True
                    continue
                for start in range(0, len(page), s.embed_batch_size):
                    self._check_stop()
                    batch = page[start:start + s.embed_batch_size]
                    texts = [c["text"] for c in batch]
                    vectors = embedder.get_text_embedding_batch(texts)
                    rows = [(c["_id"], check_vector(v, s.embed_dim)) for c, v in zip(batch, vectors)]
                    written = write_vectors(self.db, s.embed_field, rows)
                    result.embedded += written
                    result.write_conflicts += len(rows) - written
                    state.done += written
                    state.truncated += self._count_truncated(texts)
                    state.last_id = str(batch[-1]["_id"])
                    after = batch[-1]["_id"]
                    state.save(self.state_path)
                del page
                gc.collect()  # free the batch's tensors before the next 200
                self._log_progress(result, total_missing, started, state)
        except StopRequested:
            result.stopped = True
            log.info("Stopped on request. Run the same command again to continue.")
        finally:
            if self.stop_file.exists():
                self.stop_file.unlink()

        result.remaining = count_missing(self.db, s.embed_field)
        result.elapsed_seconds = self.clock() - started
        result.peak_bytes = self.meter.sample()[1]
        return result

    def _check_stop(self) -> None:
        if self.stop_file.exists():
            raise StopRequested()

    def _count_truncated(self, texts: list[str]) -> int:
        if self.count_tokens is None:
            return 0
        room = self.settings.embed_max_length - 2  # the model adds a start and an end token
        return sum(self.count_tokens(t) > room for t in texts)

    def _log_memory(self, when: str) -> None:
        now, peak = self.meter.sample()
        log.info("Memory %s: process %.0f MB (peak %.0f MB), %.2f GB RAM free",
                 when, now / MB, peak / MB, self.guard.last_free_gb)

    def _log_progress(self, result: RunResult, total: int, started: float, state: ReembedState) -> None:
        # Time spent pausing for memory is left out of the speed
        minutes = max(self.clock() - started - self.guard.paused_seconds, 1e-6) / 60
        rate = result.embedded / minutes
        left = (total - result.embedded) / rate * 60 if rate else 0.0
        now, peak = self.meter.sample()
        log.info("  %d/%d chunks | %.1f chunks/min | left ~%s | process %.0f MB (peak %.0f MB) | "
                 "%.2f GB RAM free | truncated so far: %d",
                 result.embedded, total, rate, format_duration(left), now / MB, peak / MB,
                 self.guard.last_free_gb, state.truncated)


def setup_logging() -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    handlers: list[logging.Handler] = [logging.StreamHandler(), logging.FileHandler(LOG_FILE, encoding="utf-8")]
    for h in handlers:
        h.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=handlers)
    for noisy in ("httpx", "sentence_transformers", "transformers", "huggingface_hub", "pymongo"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Re-embed stored chunks into a new vector field.")
    parser.add_argument("--estimate", action="store_true", help="only print the storage estimate (writes nothing)")
    parser.add_argument("--stop", action="store_true", help="ask a running re-embed to stop after its current batch")
    parser.add_argument("--used-mb", type=float, help="the cluster size Atlas shows now, in MB (e.g. 154)")
    parser.add_argument("--min-free-gb", type=float, default=1.5, help="pause when free RAM is below this (default 1.5)")
    return parser.parse_args(argv)


def print_estimate(db: Database, settings: Settings, used_mb: Optional[float]) -> bool:
    """Print the storage table; returns False if the re-embed would not fit in the free tier."""
    size = read_db_size(db, BACKUP_FIELD, settings.embed_field)
    plan = plan_storage(size, BACKUP_FIELD, BGE_M3.dim, settings.embed_field, settings.embed_dim, used_mb)
    log.info("Storage estimate (%d chunks; %d have the old vectors, %d need %r):",
             size.chunks, size.with_old, size.missing_new, settings.embed_field)
    for line in plan.lines():
        log.info("%s", line)
    return not plan.exceeds_limit


def main(argv: list[str]) -> int:
    setup_logging()
    args = parse_args(argv)
    if args.stop:
        STOP_FILE.touch()
        log.info("Stop requested: the re-embed stops after its current batch. Run it again later to continue.")
        return 0
    try:
        settings = load_settings()
        client, db = store.connect(settings.mongodb_uri)
    except ConfigError as exc:
        log.error("Config error: %s", exc)
        return 1
    except (ServerSelectionTimeoutError, PyMongoConfigError):
        log.error("Cannot reach MongoDB Atlas. Check your internet and Atlas > Network Access (IP allow-list).")
        return 1
    except OperationFailure as exc:
        log.error("MongoDB refused the login (%s). Check MONGODB_URI.", exc.details.get("errmsg", exc) if exc.details else exc)
        return 1

    with client:
        log.info("Connected to database %r. Model %s -> field %r (%d dims), index %r.", db.name,
                 settings.embed_model_name, settings.embed_field, settings.embed_dim, settings.vector_index)
        fits = print_estimate(db, settings, args.used_mb)
        if args.estimate:
            return 0 if fits else 1
        if not fits:
            log.error("Not started: it would not fit in the Atlas free tier (see the estimate above).")
            return 1

        from ingestion import embedding  # heavy imports (torch) only for a real run

        def count_tokens_factory() -> Callable[[str], int]:
            counter = embedding.load_token_counter(settings)
            return lambda text: len(counter(text))

        guard = MemoryGuard(min_free_gb=args.min_free_gb)
        try:
            guard.wait_until_enough("loading the tokenizer")
            reembedder = Reembedder(settings, db, embedding.load_embedder, count_tokens_factory(), guard)
            result = reembedder.run()
        except LowMemoryError as exc:
            log.error("%s", exc)
            return 2
        except KeyboardInterrupt:
            log.info("Stopped with Ctrl+C. The progress is saved; run the same command again to continue.")
            return 3
        except (RefusedError, dimensions.DimensionMismatchError, embedding.ModelNotDownloadedError) as exc:
            log.error("%s", exc)
            return 1

    log.info("Written this run: %d | still missing: %d | time %s | peak memory %.0f MB",
             result.embedded, result.remaining, format_duration(result.elapsed_seconds), result.peak_bytes / MB)
    if result.stopped:
        return 3
    if result.remaining == 0:
        log.info("Done: every chunk has %r. Next: create the index %r (README: Atlas Vector Search index).",
                 settings.embed_field, settings.vector_index)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
