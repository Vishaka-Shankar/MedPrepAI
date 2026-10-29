"""Threshold and margin filtering, the junk safety net, and the filters passed to search."""

from typing import Callable

import pytest
from bson import ObjectId

from app.relevance import Retriever, apply_relevance
from app.settings import load_qa_settings
from config import ConfigError, Settings
from tests.fakes import FakeEmbedder
from tests.qa_helpers import FakeSearch, hit


def test_below_threshold_is_not_relevant_and_returns_no_chunks() -> None:
    found = apply_relevance([hit(0.763), hit(0.755)], threshold=0.80, margin=0.05)  # the cricket question
    assert (found.relevant, found.chunks, found.best_score) == (False, [], 0.763)


def test_margin_keeps_only_chunks_close_to_the_best() -> None:
    hits = [hit(0.902), hit(0.877), hit(0.852), hit(0.851), hit(0.830)]
    found = apply_relevance(hits, threshold=0.80, margin=0.05)
    assert found.relevant and found.best_score == 0.902
    assert [h.score for h in found.chunks] == [0.902, 0.877, 0.852]  # >= 0.852 (best - margin)


def test_threshold_is_the_floor_even_inside_the_margin() -> None:
    found = apply_relevance([hit(0.82), hit(0.79)], threshold=0.80, margin=0.05)
    assert [h.score for h in found.chunks] == [0.82]  # 0.79 is within the margin but under the threshold


def test_order_from_search_is_kept() -> None:
    # Re-ranking may put a 0.884 syllabus chunk after a 0.875 textbook chunk: keep that order
    hits = [hit(0.889), hit(0.875), hit(0.884, source_type="syllabus")]
    assert [h.score for h in apply_relevance(hits, 0.80, 0.05).chunks] == [0.889, 0.875, 0.884]


def test_junk_hits_are_dropped_as_a_safety_net() -> None:
    found = apply_relevance([hit(0.95, text="SIINDERMEXTIBOOKEBOARDRPAMSEORO"), hit(0.85)], 0.80, 0.05)
    assert [h.score for h in found.chunks] == [0.85] and found.best_score == 0.85


def test_nothing_found_is_not_relevant() -> None:
    assert apply_relevance([], 0.80, 0.05).relevant is False


def test_retriever_passes_subject_and_topic_filters(make_settings: Callable[..., Settings]) -> None:
    search = FakeSearch([hit(0.9)])
    subject, topic = ObjectId(), ObjectId()
    retriever = Retriever(lambda: None, FakeEmbedder, make_settings(), 0.80, 0.05, search)  # type: ignore[arg-type]
    retriever("What is osmosis?", k=8, subject_id=subject, topic_id=topic)
    assert search.calls == [{"question": "What is osmosis?", "limit": 8, "subject_id": subject, "topic_id": topic}]


class TestSettings:
    def test_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for name in ("SIMILARITY_THRESHOLD", "RETRIEVAL_MARGIN", "LLM_PROVIDER", "BACKEND_ORIGIN", "PORT"):
            monkeypatch.delenv(name, raising=False)
        qa = load_qa_settings()
        assert (qa.similarity_threshold, qa.retrieval_margin, qa.llm_provider) == (0.80, 0.05, "groq")
        assert qa.backend_origin == "http://localhost:3000" and qa.llm_timeout_seconds == 20.0
        assert qa.model_min_free_gb == 1.0

    def test_values_from_env_are_checked(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SIMILARITY_THRESHOLD", "0.75")
        monkeypatch.setenv("RETRIEVAL_MARGIN", "0.03")
        monkeypatch.setenv("LLM_PROVIDER", "Ollama")
        qa = load_qa_settings()
        assert (qa.similarity_threshold, qa.retrieval_margin, qa.llm_provider) == (0.75, 0.03, "ollama")
        monkeypatch.setenv("SIMILARITY_THRESHOLD", "1.5")
        with pytest.raises(ConfigError, match="SIMILARITY_THRESHOLD must be between 0.0 and 1.0"):
            load_qa_settings()
        monkeypatch.setenv("SIMILARITY_THRESHOLD", "0.8")
        monkeypatch.setenv("LLM_PROVIDER", "mock")  # the mock can never be chosen from .env
        with pytest.raises(ConfigError, match="LLM_PROVIDER must be one of groq, ollama"):
            load_qa_settings()

    def test_the_key_is_never_printed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GROQ_API_KEY", "gsk_very_secret")
        qa = load_qa_settings()
        assert qa.groq_api_key == "gsk_very_secret" and "gsk_very_secret" not in repr(qa)
