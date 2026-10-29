"""Ingest MDCAT PDFs into MongoDB Atlas.

    python ingest.py --subject biology       # one subject: data/raw/biology/*.pdf
    python ingest.py --mixed                 # data/raw/mdcat/*.pdf (syllabus, past papers; subject per section)
    python ingest.py --all                   # biology, chemistry, physics and mixed
    python ingest.py --all --force           # re-check files that were already ingested
    python ingest.py --file PATH --pages 1-40   # one PDF, only some pages (testing)
    python ingest.py --stop                  # ask a running ingestion to stop safely
    python ingest.py --delete-sample         # remove everything that came from SAMPLE_*.pdf

Safe to run many times and safe to interrupt: running the same command again continues where
it stopped (finished files are skipped, OCR'd pages come from the page cache, stored chunks
are not embedded again). Progress is written to logs/ingest.log.

Exit codes: 0 = done, 1 = could not start, 2 = finished but some files failed, 3 = stopped early,
4 = stopped because free RAM stayed below --min-free-gb (progress is kept; run again later).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from pymongo.database import Database
from pymongo.errors import ConfigurationError as PyMongoConfigError
from pymongo.errors import OperationFailure, ServerSelectionTimeoutError

from config import MIXED_FOLDER, SERVICE_DIR, SUBJECTS, ConfigError, load_settings
from ingestion import store
from ingestion.dimensions import DimensionMismatchError
from ingestion.embedding import ModelNotDownloadedError
from ingestion.memory import MemoryGuard
from ingestion.pipeline import MIXED, STOP_FILE, FileLocationError, Pipeline, RunSummary

log = logging.getLogger("ingest")
LOG_FILE = SERVICE_DIR / "logs" / "ingest.log"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest MDCAT PDFs into MongoDB Atlas.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--subject", choices=sorted(SUBJECTS), help="ingest one subject")
    target.add_argument("--mixed", action="store_true", help=f"ingest data/raw/{MIXED_FOLDER}/ (subject detected per section)")
    target.add_argument("--all", action="store_true", help="ingest all three subjects and the mixed files")
    target.add_argument("--file", type=Path, help="ingest one PDF (its folder decides the subject)")
    target.add_argument("--stop", action="store_true", help="ask a running ingestion to stop at the next safe point")
    target.add_argument("--delete-sample", action="store_true", help="delete all sample documents and chunks")
    parser.add_argument("--force", action="store_true", help="re-process files even if already ingested")
    parser.add_argument("--pages", type=page_range, metavar="FIRST-LAST",
                        help="only process these pages, e.g. 1-40 (for testing; the file is not marked as finished)")
    parser.add_argument("--min-free-gb", type=float, default=1.5,
                        help="pause when free RAM is below this many GB, stop if it stays low (default 1.5)")
    return parser.parse_args(argv)


def page_range(text: str) -> tuple[int, int]:
    """"1-40" -> (1, 40). argparse shows the error message if the text is invalid."""
    try:
        first, last = (int(part) for part in text.split("-"))
    except ValueError:
        raise argparse.ArgumentTypeError("use FIRST-LAST, e.g. 1-40") from None
    if not 1 <= first <= last:
        raise argparse.ArgumentTypeError("pages start at 1 and FIRST must not be greater than LAST")
    return first, last


def setup_logging() -> None:
    """Log to the console and append to logs/ingest.log (so a background run can be followed)."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    to_file = logging.FileHandler(LOG_FILE, encoding="utf-8")
    to_file.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[console, to_file])
    # Libraries are chatty at INFO level; keep the log about our pipeline
    for noisy in ("httpx", "sentence_transformers", "transformers", "huggingface_hub", "pymongo"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def print_summary(summary: RunSummary) -> None:
    minutes, seconds = divmod(round(summary.seconds), 60)
    log.info("")
    log.info("========== SUMMARY%s ==========", " (STOPPED EARLY)" if summary.stopped else "")
    log.info("Documents ingested : %d", summary.documents_ingested)
    log.info("Documents skipped  : %d (already ingested)", summary.documents_skipped)
    log.info("Documents failed   : %d", summary.documents_failed)
    for name, reason in summary.failures:
        log.info("    - %s: %s", name, reason)
    log.info("Pages processed    : %d (%d needed OCR, %d taken from the page cache)",
             summary.pages, summary.ocr_pages, summary.pages_from_cache)
    if summary.pages_out_of_scope or summary.pages_no_subject:
        log.info("Pages skipped      : %d English/Logical Reasoning (out of scope), %d with no subject",
                 summary.pages_out_of_scope, summary.pages_no_subject)
    log.info("Chunks created     : %d", summary.chunks_created)
    log.info("Chunks already in DB: %d (not duplicated)", summary.chunks_already_stored)
    log.info("Junk chunks skipped: %d (each one is listed above as 'junk chunk skipped')", summary.chunks_skipped_junk)
    log.info("Time               : %dm %02ds (reading/OCR %.0f s, embedding/storing %.0f s)",
             minutes, seconds, summary.extract_seconds, summary.embed_seconds)
    if summary.stopped:
        log.info("To continue: run the same command again.")


def delete_sample(db: Database) -> None:
    sample_docs = [d["_id"] for d in db.source_documents.find({"isSample": True}, {"_id": 1})]
    chunks = db.chunks.delete_many({"$or": [{"isSample": True}, {"docId": {"$in": sample_docs}}]}).deleted_count
    docs = db.source_documents.delete_many({"_id": {"$in": sample_docs}}).deleted_count
    log.info("Deleted %d sample document(s) and %d sample chunk(s).", docs, chunks)


def main(argv: list[str]) -> int:
    setup_logging()
    args = parse_args(argv)
    if args.stop:
        STOP_FILE.touch()
        log.info("Stop requested (%s created). The running ingestion stops after its current page or batch "
                 "(usually within a minute). Run the same ingest command again later to continue.", STOP_FILE.name)
        return 0

    try:
        settings = load_settings()
        client, db = store.connect(settings.mongodb_uri)
    except ConfigError as exc:
        log.error("Config error: %s", exc)
        return 1
    except (ServerSelectionTimeoutError, PyMongoConfigError):
        # PyMongoConfigError is what pymongo raises when the Atlas address can't be looked up (no internet/DNS)
        log.error("Cannot reach MongoDB Atlas. Check your internet and Atlas > Network Access (IP allow-list).")
        return 1
    except OperationFailure as exc:
        log.error("MongoDB refused the login (%s). Check the user/password in MONGODB_URI.", exc.details.get("errmsg", exc) if exc.details else exc)
        return 1

    with client:
        log.info("Connected to Atlas database %r. Command: ingest.py %s", db.name, " ".join(argv))
        log.info("Embedding model: %s (%d dims, field %r, index %r)", settings.embed_model_name,
                 settings.embed_dim, settings.embed_field, settings.vector_index)
        if args.delete_sample:
            delete_sample(db)
            return 0

        files: list[Path] = []
        if args.all:
            targets = [*sorted(SUBJECTS), MIXED]
        elif args.mixed:
            targets = [MIXED]
        elif args.file:
            targets, files = [], [args.file]
            if not args.file.is_file():
                log.error("File not found: %s", args.file)
                return 1
        else:
            targets = [args.subject]
        pipeline = Pipeline(settings, db, force=args.force, page_range=args.pages,
                            guard=MemoryGuard(min_free_gb=args.min_free_gb))
        try:
            summary = pipeline.run(targets, files)
        except (ModelNotDownloadedError, FileLocationError, DimensionMismatchError) as exc:
            log.error("%s", exc)
            return 1
        print_summary(summary)
        if summary.low_memory:
            return 4
        if summary.stopped:
            return 3
        return 2 if summary.documents_failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
