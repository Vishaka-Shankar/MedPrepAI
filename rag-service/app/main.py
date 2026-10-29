"""The Q&A service (FastAPI). Start it with:

    .venv\\Scripts\\python.exe -m uvicorn app.main:create_app --factory --port 8000

GET  /health    model loaded?, database reachable?, index dimension, LLM configured? (loads nothing)
POST /retrieve  {question, subjectId?, topicId?, k?} -> {relevant, bestScore, chunks}
POST /answer    {question, subjectId?, topicId?}     -> {status, answer, citations}

Startup loads NO model and opens no database connection: the embedding model (bge-small, about
0.6 GB) is loaded on the first /retrieve or /answer, after checking that 1 GB of RAM is free,
and then kept. CORS allows only the NestJS backend (BACKEND_ORIGIN, default http://localhost:PORT).
"""

from __future__ import annotations

import logging
import threading
from typing import Annotated, Any, Callable, Optional

from bson import ObjectId
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import PyMongoError

import retrieval
from app import answer as answer_module
from app.llm import LLMProvider, make_provider
from app.relevance import Retriever
from app.settings import QASettings, load_qa_settings
from config import Settings, load_settings
from ingestion import dimensions, embedding
from ingestion.memory import LowMemoryError, MemoryGuard

log = logging.getLogger("app")

DB_DOWN = "The syllabus database cannot be reached right now. Please try again in a minute."
LOW_MEMORY = "The server does not have enough free memory to load the search model. Please try again shortly."

Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
ObjectIdText = Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{24}$")]


class AnswerRequest(BaseModel):
    question: Question
    subjectId: Optional[ObjectIdText] = None
    topicId: Optional[ObjectIdText] = None


class RetrieveRequest(AnswerRequest):
    k: int = Field(default=5, ge=1, le=10)


class Services:
    """What the endpoints need, created lazily. Tests pass fakes (database, model loader, search, LLM)."""

    def __init__(self, settings: Settings, qa: QASettings, get_db: Callable[[], Database],
                 load_embedder: Callable[[Settings], Any] = lambda s: embedding.load_embedder(s),
                 search_fn: Callable[..., list[retrieval.SearchHit]] = retrieval.search,
                 make_llm: Callable[[QASettings], LLMProvider] = make_provider,
                 guard: Optional[MemoryGuard] = None) -> None:
        self.settings = settings
        self.qa = qa
        self._get_db = get_db
        self._load_embedder = load_embedder
        self._make_llm = make_llm
        # No pausing inside a web request: either 1 GB is free now, or the request gets a 503
        self.guard = guard or MemoryGuard(min_free_gb=qa.model_min_free_gb, max_pauses=0)
        self._embedder: Any = None
        self._llm: Optional[LLMProvider] = None
        self._lock = threading.Lock()  # two first requests at once must not load the model twice
        self.retriever = Retriever(lambda: self.db().chunks, self.embedder, settings,
                                   qa.similarity_threshold, qa.retrieval_margin, search_fn)

    def db(self) -> Database:
        return self._get_db()

    @property
    def model_loaded(self) -> bool:
        return self._embedder is not None

    def embedder(self) -> Any:
        if self._embedder is None:
            with self._lock:
                if self._embedder is None:
                    self.guard.wait_until_enough("loading the embedding model")
                    log.info("Loading %s (first request)...", self.settings.embed_model_name)
                    model = self._load_embedder(self.settings)
                    dimensions.check_dimension(self.settings, "The loaded model", dimensions.embedder_dimension(model))
                    self._embedder = model
        return self._embedder

    def llm(self) -> LLMProvider:
        # Not cached when it fails, so adding GROQ_API_KEY + restarting is all it takes
        if self._llm is None:
            self._llm = self._make_llm(self.qa)
        return self._llm


def default_services() -> Services:
    settings, qa = load_settings(), load_qa_settings()
    client: Optional[MongoClient] = None

    def get_db() -> Database:
        nonlocal client
        if client is None:  # created on first use, so the service starts even when Atlas is down
            client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
        return client.get_default_database()

    return Services(settings, qa, get_db)


def create_app(services: Optional[Services] = None) -> FastAPI:
    services = services or default_services()
    app = FastAPI(title="MedPrep AI Q&A service", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=[services.qa.backend_origin],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    def ids(body: AnswerRequest) -> tuple[Optional[ObjectId], Optional[ObjectId]]:
        return (ObjectId(body.subjectId) if body.subjectId else None,
                ObjectId(body.topicId) if body.topicId else None)

    def guarded(work: Callable[[], Any]) -> Any:
        """Database and memory problems -> 503 with a sentence the frontend can show."""
        try:
            return work()
        except LowMemoryError:
            raise HTTPException(status_code=503, detail=LOW_MEMORY) from None
        except PyMongoError as exc:
            log.error("Database error: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail=DB_DOWN) from None

    @app.get("/health")
    def health() -> dict[str, Any]:
        db_ok, index_dim = False, None
        try:
            db = services.db()
            db.command("ping")
            db_ok = True
            index_dim = dimensions.index_dimension(db.chunks, services.settings.vector_index, services.settings.embed_field)
        except (PyMongoError, dimensions.DimensionMismatchError) as exc:
            log.warning("Health check: %s", type(exc).__name__)
        return {
            "status": "ok" if db_ok else "degraded",
            "modelLoaded": services.model_loaded,
            "embeddingModel": services.settings.embed_model_name,
            "expectedDimension": services.settings.embed_dim,
            "indexDimension": index_dim,
            "dbReachable": db_ok,
            "llmProvider": services.qa.llm_provider,
            "llmConfigured": services.qa.llm_configured,
        }

    @app.post("/retrieve")
    def retrieve(body: RetrieveRequest) -> dict[str, Any]:
        subject_id, topic_id = ids(body)
        found = guarded(lambda: services.retriever(body.question, k=body.k, subject_id=subject_id, topic_id=topic_id))
        return {
            "relevant": found.relevant,
            "bestScore": found.best_score,
            "chunks": [{"chunkId": str(h.chunk_id), "source": h.source, "sourceType": h.source_type,
                        "page": h.page, "score": round(h.score, 4), "text": h.text} for h in found.chunks],
        }

    @app.post("/answer")
    def answer(body: AnswerRequest) -> dict[str, Any]:
        subject_id, topic_id = ids(body)
        return guarded(lambda: answer_module.answer_question(
            body.question, services.retriever, services.llm, subject_id=subject_id, topic_id=topic_id))

    return app
