"""Q&A settings from the shared root .env (config.py loads it). Kept apart from config.Settings,
which ingestion uses, so adding the Q&A service changes nothing for ingestion."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import config  # noqa: F401  (importing it loads the root .env)
from config import ConfigError

LLM_PROVIDERS = ("groq", "ollama")


@dataclass(frozen=True)
class QASettings:
    # A question is "in the syllabus" only if the best chunk scores at least this (Atlas score 0..1).
    # 0.80 from the retrieval check: in-syllabus best hits scored 0.853-0.902, "cricket" 0.763.
    similarity_threshold: float
    # Keep only chunks within this much of the best score, so weak extras don't reach the LLM
    retrieval_margin: float
    llm_provider: str
    groq_api_key: str = field(repr=False)  # repr=False: never printed, even when the settings are
    groq_model: str
    ollama_base_url: str
    ollama_model: str
    backend_origin: str  # the only origin CORS allows (the NestJS backend)
    llm_timeout_seconds: float = 20.0
    model_min_free_gb: float = 1.0  # free RAM needed before loading the embedding model

    @property
    def llm_configured(self) -> bool:
        return self.llm_provider != "groq" or bool(self.groq_api_key)


def _float(name: str, default: float, low: float, high: float) -> float:
    raw = os.getenv(name, "").strip() or str(default)
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc
    if not low <= value <= high:
        raise ConfigError(f"{name} must be between {low} and {high}, got {value}")
    return value


def load_qa_settings() -> QASettings:
    provider = (os.getenv("LLM_PROVIDER", "").strip() or "groq").lower()
    if provider not in LLM_PROVIDERS:
        raise ConfigError(f"LLM_PROVIDER must be one of {', '.join(LLM_PROVIDERS)}, got {provider!r}")
    port = os.getenv("PORT", "").strip() or "3000"
    return QASettings(
        similarity_threshold=_float("SIMILARITY_THRESHOLD", 0.80, 0.0, 1.0),
        retrieval_margin=_float("RETRIEVAL_MARGIN", 0.05, 0.0, 1.0),
        llm_provider=provider,
        groq_api_key=os.getenv("GROQ_API_KEY", "").strip(),
        groq_model=os.getenv("GROQ_MODEL", "").strip() or "llama-3.1-8b-instant",
        ollama_base_url=(os.getenv("OLLAMA_BASE_URL", "").strip() or "http://localhost:11434").rstrip("/"),
        ollama_model=os.getenv("OLLAMA_MODEL", "").strip() or "llama3.1",
        backend_origin=(os.getenv("BACKEND_ORIGIN", "").strip() or f"http://localhost:{port}").rstrip("/"),
    )
