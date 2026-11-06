"""The ingestion pipeline.

For each PDF in data/raw/<subject>/ (one subject per file) or data/raw/mdcat/ (mixed files):
  1. hash the file; skip it if this exact file was already fully ingested
  2. extract text page by page (text layer or OCR), saving each page
     to the page cache so an interrupted run never redoes OCR       -> pdf_extract.py, page_cache.py
  3. clean headers/footers/page numbers/broken lines                 -> cleaning.py
  4. mixed files only: split pages into per-subject sections and
     drop English / Logical Reasoning (out of FYP-I scope)           -> subjects.py
  5. split into ~500-token chunks with overlap (LlamaIndex)           -> chunking.py
     and drop junk chunks (scraps, symbol soup, front matter)        -> junk.py
  6. skip chunks whose contentHash is already in the database
  7. embed the new chunks with the configured model (bge-small by
     default) in small batches, into its own field (embedding384)    -> embedding.py
  8. store source_documents + chunks in Atlas                         -> store.py

Resuming: finished files are skipped (ingestedAt), cached pages are not read again, and stored
chunks are not embedded again. So re-running the same command continues where it stopped.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Optional

from bson import ObjectId
from llama_index.core.node_parser import SentenceSplitter
from pymongo.database import Database

from config import MIXED_FOLDER, SERVICE_DIR, SUBJECTS, Settings
from ingestion import store
from ingestion.chunking import ChunkDraft, PageText, TopicRef, chunk_pages, detect_topic, make_splitter
from ingestion.cleaning import clean_document
from ingestion import dimensions
from ingestion.embedding import load_embedder, load_token_counter
from ingestion.junk import junk_reason
from ingestion.memory import LowMemoryError, MemoryGuard
from ingestion.page_cache import PageCache
from ingestion.pdf_extract import OcrEngine, PageReadError, PdfReadError, extract_page, open_pdf
from ingestion.progress import KeepAwake, Progress, StopRequested
from ingestion.subjects import IN_SCOPE, split_by_subject

if TYPE_CHECKING:  # the real import pulls in torch
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding

log = logging.getLogger(__name__)

# Files named SAMPLE_*.pdf are test data; they are flagged isSample so they can be deleted later
SAMPLE_PREFIX = "SAMPLE_"
# Target name for the mixed-subject folder (used by ingest.py --mixed)
MIXED = "mixed"
# `python ingest.py --stop` creates this file; the run stops cleanly at the next page or batch
STOP_FILE = SERVICE_DIR / "STOP"


@dataclass
class RunSummary:
    documents_ingested: int = 0
    documents_skipped: int = 0  # already ingested in an earlier run
    documents_failed: int = 0
    pages: int = 0
    ocr_pages: int = 0
    pages_from_cache: int = 0  # read in an earlier (interrupted) run, not read again
    pages_out_of_scope: int = 0  # mixed files: English / Logical Reasoning pages
    pages_no_subject: int = 0  # mixed files: cover, guide, table of contents
    chunks_created: int = 0
    chunks_already_stored: int = 0
    chunks_skipped_junk: int = 0  # not stored: see junk.py
    seconds: float = 0.0
    extract_seconds: float = 0.0  # reading + OCR
    embed_seconds: float = 0.0  # embedding model + storing
    stopped: bool = False  # stopped early by --stop or Ctrl+C
    low_memory: bool = False  # stopped because free RAM stayed too low
    failures: list[tuple[str, str]] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "documentsIngested": self.documents_ingested,
            "documentsSkipped": self.documents_skipped,
            "documentsFailed": self.documents_failed,
            "pages": self.pages,
            "ocrPages": self.ocr_pages,
            "pagesFromCache": self.pages_from_cache,
            "pagesOutOfScope": self.pages_out_of_scope,
            "pagesNoSubject": self.pages_no_subject,
            "chunksCreated": self.chunks_created,
            "chunksAlreadyStored": self.chunks_already_stored,
            "chunksSkippedJunk": self.chunks_skipped_junk,
            "stopped": int(self.stopped),
        }


@dataclass
class FilePlan:
    """What is left to do for one PDF, worked out before the run starts."""

    pdf: Path
    subject: Optional[str]  # None = mixed file
    file_hash: str = ""
    existing: Optional[dict[str, Any]] = None  # its source_documents row, if any
    finished: bool = False  # fully ingested in an earlier run
    first: int = 1
    last: int = 0
    cache: Optional[PageCache] = None
    cached: dict[int, PageText] = field(default_factory=dict)
    error: str = ""  # the file can't be opened

    @property
    def pages_total(self) -> int:
        return max(0, self.last - self.first + 1)

    @property
    def pages_to_read(self) -> int:
        return sum(1 for n in range(self.first, self.last + 1) if n not in self.cached)


def infer_source_type(filename: str) -> str:
    """ERD source_documents.type, guessed from the file name."""
    name = filename.lower()
    if "syllabus" in name or "curriculum" in name:
        return "syllabus"
    if "past" in name or "paper" in name or "mdcat" in name:
        return "past_paper"
    return "textbook"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def keep_in_scope(pages: list[PageText]) -> tuple[list[PageText], int, int]:
    """Mixed files: split into subject sections and keep Biology/Chemistry/Physics only.
    Returns (kept segments, pages skipped as out of scope, pages skipped for having no subject).
    A page counts as skipped only if none of its sections is kept."""
    segments = split_by_subject(pages)
    kept = [s for s in segments if s.subject in IN_SCOPE]
    kept_pages = {s.page for s in kept}
    out_of_scope = {s.page for s in segments if s.subject and s.subject not in IN_SCOPE} - kept_pages
    no_subject = {s.page for s in segments if s.subject is None} - kept_pages - out_of_scope
    return kept, len(out_of_scope), len(no_subject)


class FileLocationError(Exception):
    """--file points outside data/raw/<subject>/, so its subject is unknown."""


def subject_for_file(path: Path, settings: Settings) -> Optional[str]:
    """--file mode: the subject comes from the folder (data/raw/biology/... -> "biology");
    data/raw/mdcat/... -> None (mixed). Any other folder is an error."""
    folder = path.resolve().parent
    if folder.parent != settings.data_raw_dir.resolve() or folder.name not in (*SUBJECTS, MIXED_FOLDER):
        raise FileLocationError(f"{path} must be inside {settings.data_raw_dir}\\<biology|chemistry|physics|{MIXED_FOLDER}>")
    return None if folder.name == MIXED_FOLDER else folder.name


class Pipeline:
    def __init__(self, settings: Settings, db: Database, force: bool = False,
                 page_range: Optional[tuple[int, int]] = None, guard: Optional[MemoryGuard] = None) -> None:
        self.settings = settings
        # Free RAM is checked before every page and every embedding batch (faulty-RAM laptop)
        self.guard = guard or MemoryGuard()
        self.db = db
        self.force = force
        # --pages 1-40: only these pages are processed and the file is NOT marked as finished,
        # so a later full run still processes the rest
        self.page_range = page_range
        self.ocr = OcrEngine(cmd=settings.tesseract_cmd, lang=settings.ocr_lang, dpi=settings.ocr_dpi, psm=settings.ocr_psm)
        self.cache_dir = settings.data_raw_dir.parent / "processed"
        # The model is loaded only when there is something new to embed
        self._embedder: Optional[HuggingFaceEmbedding] = None
        self._splitter: Optional[SentenceSplitter] = None
        # subject key ("biology") -> its _id and topics, filled at the start of run()
        self.subject_ids: dict[str, ObjectId] = {}
        self.topics: dict[str, list[TopicRef]] = {}
        self.summary = RunSummary()

    @property
    def splitter(self) -> SentenceSplitter:
        if self._splitter is None:
            counter: Callable[[str], list[int]] = load_token_counter(self.settings)
            self._splitter = make_splitter(self.settings.chunk_size, self.settings.chunk_overlap, counter)
        return self._splitter

    @property
    def embedder(self) -> HuggingFaceEmbedding:
        if self._embedder is None:
            log.info("Loading %s from %s...", self.settings.embed_model_name, self.settings.embed_model_dir)
            embedder = load_embedder(self.settings)
            # Startup dimension check, part 2: the loaded model really makes embed_dim vectors
            dimensions.check_dimension(self.settings, "The loaded model", dimensions.embedder_dimension(embedder))
            self._embedder = embedder
        return self._embedder

    def settings_signature(self) -> str:
        """Everything that changes the text of a page. A different signature = a fresh page cache.
        orient=1: upside-down and sideways scans are turned upright (pdf_extract.read_page)."""
        s = self.settings
        return f"tesseract={self.ocr.version};lang={s.ocr_lang};dpi={s.ocr_dpi};psm={s.ocr_psm};min={s.text_layer_min_letters};orient=1"

    # ---------------------------------------------------------------- run

    def run(self, targets: list[str], files: Optional[list[Path]] = None) -> RunSummary:
        """`targets` are subject keys ("biology", ...) and/or MIXED; `files` are single PDFs (--file)."""
        started = time.perf_counter()
        if STOP_FILE.exists():
            STOP_FILE.unlink()
            log.info("Removed an old STOP file from a previous run.")
        if self.ocr.available:
            log.info("Tesseract %s found (%s)", self.ocr.version, self.settings.tesseract_cmd)
        else:
            log.warning("Tesseract NOT found at %r: scanned pages will be skipped. Set TESSERACT_CMD in .env.", self.settings.tesseract_cmd)

        store.ensure_indexes(self.db)
        # Startup dimension check, part 1: stored vectors and the Atlas index match the model
        dimensions.check_database(self.settings, self.db)
        self._load_subjects()
        plans = [self._plan(pdf, subject) for pdf, subject in self._collect(targets, files or [])]
        todo = [p for p in plans if not p.finished and not p.error]
        progress = Progress(
            pages_to_read=sum(p.pages_to_read for p in todo),
            pages_to_embed=sum(p.pages_total for p in todo),
            stop_file=STOP_FILE,
        )
        log.info("Plan: %d file(s), %d already finished, %d page(s) to read (%d already cached), estimated time ~%s",
                 len(plans), sum(p.finished for p in plans), progress.pages_to_read,
                 sum(p.pages_total - p.pages_to_read for p in todo), progress.eta())

        run_id = store.start_run(self.db)
        try:
            with KeepAwake():
                for i, plan in enumerate(plans, start=1):
                    log.info("[%d/%d] %s", i, len(plans), plan.pdf.name)
                    self._run_one(plan, run_id, progress)
        except (StopRequested, KeyboardInterrupt):
            self.summary.stopped = True
            log.warning("Stopped safely. Everything finished so far is saved; run the same command again to continue.")
        except LowMemoryError as exc:
            self.summary.stopped = self.summary.low_memory = True
            log.error("%s", exc)
        finally:
            self.summary.seconds = time.perf_counter() - started
            store.finish_run(self.db, run_id, {**self.summary.counts(), "seconds": round(self.summary.seconds)})
        return self.summary

    def _run_one(self, plan: FilePlan, run_id: ObjectId, progress: Progress) -> None:
        if plan.error:
            self._fail(plan.pdf, plan.error)
            return
        if plan.finished:
            log.info("  already ingested (same file hash); skipped. Use --force to re-check it.")
            self.summary.documents_skipped += 1
            return
        progress.check_stop()
        try:
            self._ingest_file(plan, run_id, progress)
        except (PdfReadError, PageReadError) as exc:
            self._fail(plan.pdf, str(exc))
        except (StopRequested, KeyboardInterrupt, LowMemoryError):
            raise  # stop the whole run, not just this file
        except Exception as exc:  # e.g. a crash caused by faulty RAM: log it fully, go on with the next file
            log.exception("  UNEXPECTED ERROR in %s; continuing with the next file", plan.pdf.name)
            self._fail(plan.pdf, f"{type(exc).__name__}: {exc} (re-run to retry; finished pages are kept)")

    def _collect(self, targets: list[str], files: list[Path]) -> list[tuple[Path, Optional[str]]]:
        jobs: list[tuple[Path, Optional[str]]] = []
        for target in targets:
            subject = None if target == MIXED else target
            folder = self.settings.data_raw_dir / (MIXED_FOLDER if target == MIXED else target)
            pdfs = sorted(folder.glob("*.pdf")) if folder.is_dir() else []
            if not pdfs:
                log.warning("No PDFs found in %s; nothing to do.", folder)
            jobs += [(pdf, subject) for pdf in pdfs]
        jobs += [(pdf, subject_for_file(pdf, self.settings)) for pdf in files]
        return jobs

    def _plan(self, pdf: Path, subject: Optional[str]) -> FilePlan:
        plan = FilePlan(pdf=pdf, subject=subject, file_hash=file_sha256(pdf))
        plan.existing = store.find_document(self.db, plan.file_hash)
        if plan.existing and plan.existing.get("ingestedAt") and not self.force:
            plan.finished = True
            return plan
        try:
            with open_pdf(pdf) as doc:
                page_count = doc.page_count
        except PdfReadError as exc:
            plan.error = str(exc)
            return plan
        plan.first, plan.last = self.page_range or (1, page_count)
        plan.last = min(plan.last, page_count)
        plan.cache = PageCache.for_file(self.cache_dir, pdf.name, plan.file_hash, self.settings_signature())
        plan.cached = plan.cache.load()
        return plan

    def _load_subjects(self) -> None:
        for key, (code, name, share) in SUBJECTS.items():
            self.subject_ids[key] = store.ensure_subject(self.db, code, name, share)
            self.topics[key] = store.load_topics(self.db, self.subject_ids[key])
        if not any(self.topics.values()):
            log.info("No topics in the database yet, so chunks are stored with topic = null.")

    def _fail(self, pdf: Path, reason: str) -> None:
        log.error("  SKIPPED %s: %s", pdf.name, reason)
        self.summary.documents_failed += 1
        self.summary.failures.append((pdf.name, reason))

    # ---------------------------------------------------------------- one file

    def _read_pages(self, plan: FilePlan, progress: Progress) -> list[PageText]:
        """Read every page in the plan's range, using the cache for pages read before."""
        assert plan.cache is not None
        from_cache = plan.pages_total - plan.pages_to_read
        if from_cache:
            log.info("  %d page(s) already in the page cache from an earlier run", from_cache)
            self.summary.pages_from_cache += from_cache
        started = time.perf_counter()
        unreadable: list[int] = []
        with open_pdf(plan.pdf) as doc:
            for number in range(plan.first, plan.last + 1):
                if number in plan.cached:
                    continue
                progress.check_stop()
                self.guard.wait_until_enough(f"reading page {number}")
                t = time.perf_counter()
                try:
                    page = extract_page(doc, number, self.ocr, self.settings.text_layer_min_letters)
                except PageReadError:
                    unreadable.append(number)  # NOT cached, so the next run tries it again
                    continue
                plan.cache.append(page)  # saved before moving on: a crash now loses at most this page
                plan.cached[number] = page
                progress.page_read(plan.pdf.name, number, plan.last, time.perf_counter() - t, page.ocr)
        self.summary.extract_seconds += time.perf_counter() - started
        if unreadable:
            # Finishing the file now would mark it done with these pages missing
            raise PageReadError(f"{len(unreadable)} page(s) could not be read: {unreadable}. "
                                "The other pages are cached; re-run to retry these")
        return [plan.cached[n] for n in range(plan.first, plan.last + 1)]

    def _ingest_file(self, plan: FilePlan, run_id: ObjectId, progress: Progress) -> None:
        pdf, subject = plan.pdf, plan.subject
        raw_pages = self._read_pages(plan, progress)
        cleaned = clean_document([p.text for p in raw_pages])
        pages = [PageText(page=p.page, text=text, ocr=p.ocr, subject=subject) for p, text in zip(raw_pages, cleaned)]
        ocr_pages = sum(p.ocr for p in pages)
        if not any(p.text for p in pages):
            raise PdfReadError("no text could be extracted from any page")
        log.info("  %d page(s) ready, %d via OCR", len(pages), ocr_pages)

        if subject is None:
            pages, out_of_scope, no_subject = keep_in_scope(pages)
            log.info("  skipped %d page(s) of English/Logical Reasoning (out of scope) and %d page(s) with no subject (cover, guide, contents)",
                     out_of_scope, no_subject)
            self.summary.pages_out_of_scope += out_of_scope
            self.summary.pages_no_subject += no_subject

        is_sample = pdf.name.startswith(SAMPLE_PREFIX)
        doc_id = plan.existing["_id"] if plan.existing else store.create_document(self.db, {
            # A mixed file has no single subject; each of its chunks carries its own subjectId
            "subjectId": self.subject_ids[subject] if subject else None,
            "ingestionRunId": run_id,
            "type": infer_source_type(pdf.name),
            "source": pdf.name,
            "board": None,
            "fileHash": plan.file_hash,
            "isSample": is_sample,
        })

        drafts = self._drop_junk(chunk_pages(pages, self.splitter, {"source": pdf.name}))
        if plan.existing:
            processed = [p.page for p in raw_pages]
            stale = store.delete_stale_chunks(self.db, doc_id, {d.content_hash for d in drafts}, processed)
            if stale:
                log.info("  removed %d outdated chunk(s) from an earlier version of this file", stale)
        already = store.existing_hashes(self.db, (d.content_hash for d in drafts))
        new = [d for d in drafts if d.content_hash not in already]
        log.info("  %d chunk(s): %d new, %d already stored", len(drafts), len(new), len(already))

        started = time.perf_counter()
        created = self._embed_and_store(new, doc_id, is_sample, plan, progress)
        self.summary.embed_seconds += time.perf_counter() - started
        if self.page_range is None:
            store.mark_document_complete(self.db, doc_id, pages=len(raw_pages), ocr_pages=ocr_pages)
            log.info("  finished %s", pdf.name)
        else:
            log.info("  pages %d-%d only: file NOT marked as finished", raw_pages[0].page, raw_pages[-1].page)

        self.summary.documents_ingested += 1
        self.summary.pages += len(raw_pages)
        self.summary.ocr_pages += ocr_pages
        self.summary.chunks_created += created
        self.summary.chunks_already_stored += len(drafts) - created

    def _drop_junk(self, drafts: list[ChunkDraft]) -> list[ChunkDraft]:
        """Leave out junk chunks (junk.py). Done before the stale-chunk cleanup, so junk stored by an
        earlier run of a re-processed file is removed too. Each one is logged for review."""
        kept = []
        for d in drafts:
            reason = junk_reason(d.text)
            if reason is None:
                kept.append(d)
                continue
            self.summary.chunks_skipped_junk += 1
            log.info("    junk chunk skipped (p.%d, %s): %r", d.page, reason, " ".join(d.text.split())[:100])
        return kept

    def _embed_and_store(self, drafts: list[ChunkDraft], doc_id: ObjectId, is_sample: bool,
                         plan: FilePlan, progress: Progress) -> int:
        """Embed and insert in small batches: low memory use, and an interrupted run keeps what it saved."""
        if not drafts:
            progress.pages_embedded(plan.pdf.name, plan.pages_total, 0.0, 0, 0)
            return 0
        size = self.settings.embed_batch_size
        dim, vector_field = self.settings.embed_dim, self.settings.embed_field
        created = 0
        for start in range(0, len(drafts), size):
            progress.check_stop()
            self.guard.wait_until_enough("the next embedding batch")
            t = time.perf_counter()
            batch = drafts[start : start + size]
            vectors = self.embedder.get_text_embedding_batch([d.text for d in batch])
            rows: list[dict[str, Any]] = []
            for draft, vector in zip(batch, vectors):
                if len(vector) != dim:
                    raise dimensions.DimensionMismatchError(f"Expected {dim}-d embeddings, got {len(vector)}")
                if draft.subject not in self.subject_ids:
                    raise RuntimeError(f"chunk on page {draft.page} has no valid subject ({draft.subject!r})")
                topic = detect_topic(draft.text, self.topics[draft.subject])
                rows.append({
                    "docId": doc_id,
                    "subjectId": self.subject_ids[draft.subject],
                    "topicId": topic.id if topic else None,
                    "page": draft.page,
                    "text": draft.text,
                    vector_field: vector,  # embedding384 for bge-small, embedding for BGE-M3
                    "contentHash": draft.content_hash,
                    "isSample": is_sample,
                })
            inserted, _duplicates = store.insert_chunks(self.db, rows)
            created += inserted
            # This batch's share of the file's pages, so the time-left estimate moves smoothly
            share = plan.pages_total * len(batch) / len(drafts)
            progress.pages_embedded(plan.pdf.name, share, time.perf_counter() - t, start + len(batch), len(drafts))
        return created
