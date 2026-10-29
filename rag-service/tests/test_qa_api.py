"""The FastAPI app with injected fakes: local MongoDB, fake embedder, fake search, mock LLM."""

from types import SimpleNamespace
from typing import Any, Callable

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.database import Database
from pymongo.errors import ServerSelectionTimeoutError

from app.answer import OUT_OF_SCOPE
from app.llm import NOT_CONFIGURED, LLMNotConfiguredError, MockLLMProvider
from app.main import DB_DOWN, LOW_MEMORY, Services, create_app
from config import Settings
from ingestion.memory import GB, MemoryGuard
from tests.fakes import FakeEmbedder
from tests.qa_helpers import FakeSearch, hit, qa_settings
from tests.test_memory import fake_free_ram


class Loader:
    def __init__(self) -> None:
        self.loads = 0

    def __call__(self, _settings: Settings) -> FakeEmbedder:
        self.loads += 1
        return FakeEmbedder()


@pytest.fixture
def plenty_of_ram(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_free_ram(monkeypatch, [4.0])


def build(make_settings: Callable[..., Settings], db: Any, hits: list, llm: Any = None, **qa: Any
          ) -> tuple[TestClient, Services, Loader, FakeSearch, MockLLMProvider]:
    loader, search = Loader(), FakeSearch(hits)
    mock = llm if llm is not None else MockLLMProvider("Enzymes lower the activation energy [1].")

    def make_llm(_qa: Any) -> MockLLMProvider:
        if isinstance(mock, Exception):
            raise mock
        return mock

    db = db if db is not None else SimpleNamespace(chunks="chunks")  # the fake search never touches it
    services = Services(make_settings(), qa_settings(**qa), lambda: db, loader, search, make_llm)
    return TestClient(create_app(services)), services, loader, search, mock


@pytest.mark.usefixtures("plenty_of_ram")
class TestEndpoints:
    def test_health_works_without_loading_the_model(self, make_settings: Callable[..., Settings], test_db: Database) -> None:
        client, services, loader, _, _ = build(make_settings, test_db, [])
        body = client.get("/health").json()
        assert body["modelLoaded"] is False and loader.loads == 0  # starting + health load nothing
        assert body["dbReachable"] is True and body["status"] == "ok"
        assert body["expectedDimension"] == 384 and body["indexDimension"] is None  # local MongoDB: no Atlas index
        assert body["llmProvider"] == "groq" and body["llmConfigured"] is True
        assert "gsk_test_secret_123" not in str(body)

    def test_model_loads_on_the_first_request_and_stays_loaded(self, make_settings: Callable[..., Settings],
                                                               test_db: Database) -> None:
        client, services, loader, _, _ = build(make_settings, test_db, [hit(0.9)])
        for _ in range(3):
            assert client.post("/retrieve", json={"question": "What is osmosis?"}).status_code == 200
        assert loader.loads == 1 and services.model_loaded
        assert client.get("/health").json()["modelLoaded"] is True

    def test_retrieve_returns_relevant_chunks_with_source_and_page(self, make_settings: Callable[..., Settings]) -> None:
        hits = [hit(0.902, page=62), hit(0.877, page=61), hit(0.83, page=74)]
        client, _, _, search, _ = build(make_settings, None, hits)
        subject = str(ObjectId())
        body = client.post("/retrieve", json={"question": "  Newton's laws  ", "subjectId": subject, "k": 3}).json()
        assert body["relevant"] is True and body["bestScore"] == 0.902
        assert [(c["page"], c["score"], c["source"], c["sourceType"]) for c in body["chunks"]] == [
            (62, 0.902, "STBB_Biology_XI.pdf", "textbook"), (61, 0.877, "STBB_Biology_XI.pdf", "textbook")]
        assert search.calls[0]["question"] == "Newton's laws" and str(search.calls[0]["subject_id"]) == subject
        assert search.calls[0]["limit"] == 3

    def test_retrieve_out_of_scope(self, make_settings: Callable[..., Settings]) -> None:
        client, *_ = build(make_settings, None, [hit(0.763)])
        assert client.post("/retrieve", json={"question": "cricket world cup"}).json() == {
            "relevant": False, "bestScore": 0.763, "chunks": []}

    def test_answer_ok(self, make_settings: Callable[..., Settings]) -> None:
        hits = [hit(0.88, page=37)]
        client, _, _, search, llm = build(make_settings, None, hits)
        topic = str(ObjectId())
        body = client.post("/answer", json={"question": "How do enzymes work?", "topicId": topic}).json()
        assert body["status"] == "ok" and body["answer"] == "Enzymes lower the activation energy [1]."
        assert body["citations"][0]["chunkId"] == str(hits[0].chunk_id) and body["citations"][0]["page"] == 37
        assert str(search.calls[0]["topic_id"]) == topic and len(llm.calls) == 1

    def test_answer_out_of_scope_never_calls_the_llm(self, make_settings: Callable[..., Settings]) -> None:
        client, _, _, _, llm = build(make_settings, None, [hit(0.763)])
        body = client.post("/answer", json={"question": "Who won the cricket world cup?"}).json()
        assert body == {"status": "out_of_scope", "answer": OUT_OF_SCOPE, "citations": []}
        assert llm.calls == []

    def test_answer_without_groq_key_is_a_clear_error(self, make_settings: Callable[..., Settings],
                                                      test_db: Database) -> None:
        client, *_ = build(make_settings, test_db, [hit(0.88)], llm=LLMNotConfiguredError(NOT_CONFIGURED), groq_api_key="")
        body = client.post("/answer", json={"question": "How do enzymes work?"}).json()
        assert body["status"] == "error" and "GROQ_API_KEY is empty" in body["answer"]
        assert client.get("/health").json()["llmConfigured"] is False

    @pytest.mark.parametrize("payload", [
        {"question": "   "},
        {"question": "x" * 1001},
        {"question": "ok", "subjectId": "biology"},
        {"question": "ok", "k": 50},
        {},
    ])
    def test_invalid_requests_are_rejected(self, make_settings: Callable[..., Settings], payload: dict) -> None:
        client, _, loader, _, _ = build(make_settings, None, [])
        assert client.post("/retrieve", json=payload).status_code == 422
        assert loader.loads == 0

    def test_cors_allows_only_the_backend(self, make_settings: Callable[..., Settings]) -> None:
        client, *_ = build(make_settings, None, [])
        ok = client.options("/answer", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
        assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
        other = client.options("/answer", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
        assert "access-control-allow-origin" not in other.headers

    def test_database_down_is_a_friendly_503(self, make_settings: Callable[..., Settings]) -> None:
        def down(*_a: Any, **_k: Any) -> list:
            raise ServerSelectionTimeoutError("no servers")

        client, services, *_ = build(make_settings, None, [])
        services.retriever.search_fn = down
        response = client.post("/answer", json={"question": "How do enzymes work?"})
        assert response.status_code == 503 and response.json()["detail"] == DB_DOWN


def test_low_ram_refuses_to_load_the_model(make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch) -> None:
    fake_free_ram(monkeypatch, [0.8])  # under the 1 GB the service needs
    client, services, loader, _, _ = build(make_settings, None, [hit(0.9)])
    response = client.post("/retrieve", json={"question": "What is osmosis?"})
    assert response.status_code == 503 and response.json()["detail"] == LOW_MEMORY
    assert loader.loads == 0 and services.model_loaded is False
    assert services.guard.min_free_gb == 1.0 and services.guard.max_pauses == 0


def test_one_gb_free_is_enough(make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch) -> None:
    fake_free_ram(monkeypatch, [1.05])
    client, _, loader, _, _ = build(make_settings, None, [hit(0.9)])
    assert client.post("/retrieve", json={"question": "What is osmosis?"}).status_code == 200
    assert loader.loads == 1
    assert isinstance(MemoryGuard(min_free_gb=1.0), MemoryGuard) and GB > 0
