"""LLM providers, chosen by LLM_PROVIDER: Groq (hosted, default) or Ollama (local).

Both are called over HTTP with httpx: a 20 s timeout and one retry on a timeout, a network error,
HTTP 429 or a 5xx. Errors become LLMError with a sentence a student can read; the API key is
never logged or put in a message. MockLLMProvider is for tests only: it can't be chosen in .env,
so a missing GROQ_API_KEY gives a clear error, never a silent fake answer.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable, Optional, Protocol, Union

import httpx

from app.settings import QASettings

log = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
TEMPERATURE = 0.2  # low: stick to the context instead of being creative
MAX_ANSWER_TOKENS = 500

NOT_CONFIGURED = ("The AI tutor is not set up yet: GROQ_API_KEY is empty in the .env file. "
                  "Please ask the administrator to add it.")
TIMED_OUT = "The AI tutor took too long to answer. Please try again in a moment."
UNAVAILABLE = "The AI tutor is not available right now. Please try again in a moment."
REJECTED_KEY = "The AI tutor could not sign in to its provider (the API key was rejected). Please tell the administrator."
BAD_REPLY = "The AI tutor sent an answer we could not read. Please try again."


# Qwen3 models (GROQ_MODEL=qwen/qwen3.8-27b since 2026-10-29) may write their reasoning first
THINKING = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_reasoning(text: str) -> str:
    """Only the final answer reaches the student, never the model's thinking."""
    return THINKING.sub("", text).strip()


class LLMError(Exception):
    """str(exc) is a friendly sentence that can be shown to the student."""


class LLMNotConfiguredError(LLMError):
    pass


class LLMProvider(Protocol):
    name: str

    def complete(self, system: str, user: str) -> str: ...


def _post_with_retry(client: httpx.Client, url: str, body: dict[str, Any], service: str, retries: int) -> dict[str, Any]:
    """POST once, and again (up to `retries` times) only for errors that may pass: a timeout,
    no connection, 429 (rate limit) or 5xx. A rejected key or a bad request is not retried."""
    problem = UNAVAILABLE
    for attempt in range(1, retries + 2):
        try:
            response = client.post(url, json=body)
        except httpx.TimeoutException:
            problem = TIMED_OUT
            log.warning("%s timed out (attempt %d of %d)", service, attempt, retries + 1)
            continue
        except httpx.TransportError as exc:
            problem = UNAVAILABLE
            log.warning("%s unreachable: %s (attempt %d of %d)", service, type(exc).__name__, attempt, retries + 1)
            continue
        if response.status_code == 429 or response.status_code >= 500:
            problem = UNAVAILABLE
            log.warning("%s answered HTTP %d (attempt %d of %d)", service, response.status_code, attempt, retries + 1)
            continue
        if response.status_code in (401, 403):
            log.error("%s rejected the API key (HTTP %d)", service, response.status_code)
            raise LLMError(REJECTED_KEY)
        if response.status_code == 404:
            # Seen 2026-10-29: Groq retired llama-3.1-8b-instant; the student still gets the friendly sentence
            log.error("%s answered HTTP 404: the model does not exist (check GROQ_MODEL / OLLAMA_MODEL)", service)
            raise LLMError(UNAVAILABLE)
        if response.status_code != 200:
            log.error("%s answered HTTP %d", service, response.status_code)
            raise LLMError(UNAVAILABLE)
        try:
            data = response.json()
        except ValueError:
            raise LLMError(BAD_REPLY) from None
        if not isinstance(data, dict):
            raise LLMError(BAD_REPLY)
        return data
    raise LLMError(problem)


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, model: str, timeout: float = 20.0, retries: int = 1,
                 transport: Optional[httpx.BaseTransport] = None) -> None:
        if not api_key.strip():
            raise LLMNotConfiguredError(NOT_CONFIGURED)
        self.model = model
        self.retries = retries
        # transport: tests pass httpx.MockTransport, so no request ever leaves the machine
        self._client = httpx.Client(timeout=timeout, transport=transport,
                                    headers={"Authorization": f"Bearer {api_key.strip()}"})

    def complete(self, system: str, user: str) -> str:
        body = {"model": self.model, "temperature": TEMPERATURE, "max_tokens": MAX_ANSWER_TOKENS,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        data = _post_with_retry(self._client, GROQ_URL, body, "Groq", self.retries)
        try:
            return strip_reasoning(str(data["choices"][0]["message"]["content"]))
        except (KeyError, IndexError, TypeError):
            raise LLMError(BAD_REPLY) from None


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float = 20.0, retries: int = 1,
                 transport: Optional[httpx.BaseTransport] = None) -> None:
        self.url = f"{base_url.rstrip('/')}/api/chat"
        self.model = model
        self.retries = retries
        self._client = httpx.Client(timeout=timeout, transport=transport)

    def complete(self, system: str, user: str) -> str:
        body = {"model": self.model, "stream": False, "options": {"temperature": TEMPERATURE},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        data = _post_with_retry(self._client, self.url, body, "Ollama", self.retries)
        try:
            return strip_reasoning(str(data["message"]["content"]))
        except (KeyError, TypeError):
            raise LLMError(BAD_REPLY) from None


class MockLLMProvider:
    """For tests only. Records every call; replies with a fixed text, a function of the prompt,
    or raises the given error."""

    name = "mock"

    def __init__(self, reply: Union[str, Callable[[str], str]] = "Enzymes speed up reactions [1].",
                 error: Optional[Exception] = None) -> None:
        self.reply = reply
        self.error = error
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str) -> str:
        self.calls.append((system, user))
        if self.error is not None:
            raise self.error
        return self.reply(user) if callable(self.reply) else self.reply


def make_provider(qa: QASettings) -> LLMProvider:
    """Only the selected provider is created (Ollama is never touched when Groq is chosen)."""
    if qa.llm_provider == "groq":
        return GroqProvider(qa.groq_api_key, qa.groq_model, timeout=qa.llm_timeout_seconds)
    return OllamaProvider(qa.ollama_base_url, qa.ollama_model, timeout=qa.llm_timeout_seconds)
