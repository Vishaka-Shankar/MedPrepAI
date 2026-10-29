"""LLM providers with httpx.MockTransport: no request ever leaves the machine."""

import json
from typing import Callable

import httpx
import pytest

from app.llm import (GROQ_URL, NOT_CONFIGURED, REJECTED_KEY, TIMED_OUT, UNAVAILABLE, GroqProvider, LLMError,
                     LLMNotConfiguredError, MockLLMProvider, OllamaProvider, make_provider)
from tests.qa_helpers import qa_settings

KEY = "gsk_test_secret_123"


def groq_reply(text: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def transport(*responses: Callable[[httpx.Request], httpx.Response]) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    """Each request gets the next handler; the requests are recorded."""
    seen: list[httpx.Request] = []
    queue = list(responses)

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0)(request)

    return httpx.MockTransport(handle), seen


def timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("timed out", request=request)


class TestGroq:
    def test_sends_the_prompt_and_returns_the_answer(self) -> None:
        mock, seen = transport(lambda r: groq_reply("  Osmosis is ... [1]  "))
        provider = GroqProvider(KEY, "llama-3.1-8b-instant", transport=mock)
        assert provider.complete("system rules", "question") == "Osmosis is ... [1]"
        body = json.loads(seen[0].content)
        assert str(seen[0].url) == GROQ_URL and seen[0].headers["Authorization"] == f"Bearer {KEY}"
        assert body["model"] == "llama-3.1-8b-instant" and body["temperature"] == 0.2
        assert [m["role"] for m in body["messages"]] == ["system", "user"]

    def test_reasoning_block_is_removed(self) -> None:
        mock, _ = transport(lambda r: groq_reply("<think>\nThe passage says...\n</think>\n\nEnzymes lower activation energy [1]."))
        assert GroqProvider(KEY, "qwen/qwen3.8-27b", transport=mock).complete("s", "u") == "Enzymes lower activation energy [1]."

    def test_timeout_is_20_seconds(self) -> None:
        provider = make_provider(qa_settings())
        assert isinstance(provider, GroqProvider) and provider._client.timeout.read == 20.0

    def test_one_retry_after_a_timeout(self) -> None:
        mock, seen = transport(timeout, lambda r: groq_reply("Answer [1]"))
        assert GroqProvider(KEY, "m", transport=mock).complete("s", "u") == "Answer [1]"
        assert len(seen) == 2

    def test_two_timeouts_give_a_friendly_error(self, caplog: pytest.LogCaptureFixture) -> None:
        mock, seen = transport(timeout, timeout)
        with pytest.raises(LLMError) as exc:
            GroqProvider(KEY, "m", transport=mock).complete("s", "u")
        assert str(exc.value) == TIMED_OUT and len(seen) == 2  # one try + one retry, no more
        assert KEY not in caplog.text and KEY not in str(exc.value)

    def test_server_errors_are_retried_once(self) -> None:
        mock, seen = transport(lambda r: httpx.Response(503), lambda r: httpx.Response(429))
        with pytest.raises(LLMError, match="not available right now"):
            GroqProvider(KEY, "m", transport=mock).complete("s", "u")
        assert len(seen) == 2

    def test_rejected_key_is_not_retried_and_not_revealed(self, caplog: pytest.LogCaptureFixture) -> None:
        mock, seen = transport(lambda r: httpx.Response(401, json={"error": {"message": "Invalid API Key"}}))
        with pytest.raises(LLMError) as exc:
            GroqProvider(KEY, "m", transport=mock).complete("s", "u")
        assert str(exc.value) == REJECTED_KEY and len(seen) == 1
        assert KEY not in caplog.text and KEY not in str(exc.value)

    def test_unknown_model_is_logged_clearly_and_not_retried(self, caplog: pytest.LogCaptureFixture) -> None:
        mock, seen = transport(lambda r: httpx.Response(404, json={"error": {"message": "model not found"}}))
        with pytest.raises(LLMError, match="not available right now"):
            GroqProvider(KEY, "llama-3.1-8b-instant", transport=mock).complete("s", "u")
        assert len(seen) == 1 and "check GROQ_MODEL" in caplog.text and KEY not in caplog.text

    def test_unreadable_reply(self) -> None:
        mock, _ = transport(lambda r: httpx.Response(200, json={"unexpected": True}))
        with pytest.raises(LLMError, match="could not read"):
            GroqProvider(KEY, "m", transport=mock).complete("s", "u")


class TestNotConfigured:
    @pytest.mark.parametrize("key", ["", "   "])
    def test_empty_key_is_a_clear_error_not_a_mock(self, key: str) -> None:
        with pytest.raises(LLMNotConfiguredError) as exc:
            make_provider(qa_settings(groq_api_key=key))
        assert str(exc.value) == NOT_CONFIGURED and "GROQ_API_KEY is empty" in NOT_CONFIGURED
        assert qa_settings(groq_api_key="").llm_configured is False


class TestOllama:
    def test_is_created_only_when_selected(self) -> None:
        assert isinstance(make_provider(qa_settings()), GroqProvider)
        provider = make_provider(qa_settings(llm_provider="ollama", groq_api_key=""))  # no Groq key needed
        assert isinstance(provider, OllamaProvider) and provider.url == "http://localhost:11434/api/chat"

    def test_sends_the_prompt_and_returns_the_answer(self) -> None:
        mock, seen = transport(lambda r: httpx.Response(200, json={"message": {"content": "Velocity is ... [2]"}}))
        assert OllamaProvider("http://localhost:11434", "llama3.1", transport=mock).complete("s", "u") == "Velocity is ... [2]"
        body = json.loads(seen[0].content)
        assert body["model"] == "llama3.1" and body["stream"] is False

    def test_not_running_gives_a_friendly_error(self) -> None:
        def refused(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        mock, seen = transport(refused, refused)
        with pytest.raises(LLMError) as exc:
            OllamaProvider("http://localhost:11434", "llama3.1", transport=mock).complete("s", "u")
        assert str(exc.value) == UNAVAILABLE and len(seen) == 2


def test_mock_records_calls_and_can_fail() -> None:
    mock = MockLLMProvider(reply=lambda user: f"echo {len(user)}")
    assert mock.complete("s", "abc") == "echo 3" and mock.calls == [("s", "abc")]
    with pytest.raises(LLMError):
        MockLLMProvider(error=LLMError("boom")).complete("s", "u")
