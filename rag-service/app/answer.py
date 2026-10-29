"""POST /answer logic: retrieve -> (out of scope: stop) -> numbered context -> LLM -> checked citations.

- Out of scope (relevant = false) never calls the LLM: there is nothing to ground an answer in.
- Only textbook chunks go to the LLM (syllabus lines name topics and past-paper MCQs ask questions;
  neither explains), at most MAX_CONTEXT_CHUNKS, each trimmed to about CONTEXT_CHARS.
- The model must answer only from the context and cite with [n]. Any [n] that is not one of the
  numbered chunks is removed, so every citation the student sees points to a real page.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable, Optional

from bson import ObjectId

from app.llm import LLMError, LLMNotConfiguredError, LLMProvider
from app.relevance import Retrieval
from app.snippets import best_snippet, claims_by_citation
from retrieval import SearchHit

log = logging.getLogger(__name__)

OUT_OF_SCOPE = "I couldn't find this in the syllabus material. Try rephrasing, or pick a subject."
SEARCH_K = 8  # candidates fetched; the textbook ones among them become the context
MAX_CONTEXT_CHUNKS = 4
CONTEXT_CHARS = 800
NO_ANSWER = "The syllabus material I found does not answer this question."

SYSTEM_PROMPT = (
    "You are MedPrep AI, a tutor for Pakistan's MDCAT exam (Biology, Chemistry, Physics).\n"
    "Answer the student's question using ONLY the numbered context passages from their textbooks.\n"
    "Rules:\n"
    "- After every fact, cite the passage it comes from as [n], e.g. [1] or [2][3].\n"
    "- Do not use any knowledge that is not in the passages. Do not invent passage numbers.\n"
    "- Answer only what was asked. Leave out facts about other topics, even if a passage mentions them.\n"
    "- If the passages answer only part of the question, give that part and say plainly which part "
    "the material does not cover.\n"
    f"- If the passages do not contain the answer at all, reply exactly: \"{NO_ANSWER}\"\n"
    "- Write plain text: no LaTeX, no Markdown, no $ signs. Write formulas inline, e.g. CnH2n+2 or F = ma.\n"
    "- Be clear and short: 3 to 6 sentences, simple English. The passages come from OCR and may "
    "contain broken words; ignore that noise."
)

CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def trim(text: str, limit: int = CONTEXT_CHARS) -> str:
    """Whitespace collapsed, cut at a sentence end (or word) before `limit` characters."""
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    cut = flat[:limit]
    sentence_end = cut.rfind(". ")
    if sentence_end >= limit // 2:
        return cut[:sentence_end + 1]
    return cut[:cut.rfind(" ")].rstrip() + " ..."


def build_prompt(question: str, context: list[SearchHit]) -> str:
    passages = "\n\n".join(f"[{n}] ({hit.source}, page {hit.page})\n{trim(hit.text)}" for n, hit in enumerate(context, 1))
    return f"Context passages:\n\n{passages}\n\nStudent's question: {question}\n\nAnswer (cite with [n]):"


def clean_citations(answer: str, count: int) -> tuple[str, list[int]]:
    """Keep only [n] with 1 <= n <= count. Returns the cleaned text and the numbers it cites."""
    used: set[int] = set()

    def keep_valid(match: re.Match[str]) -> str:
        valid = [n for n in (int(x) for x in re.split(r"\s*,\s*", match.group(1))) if 1 <= n <= count]
        used.update(valid)
        return "[" + ", ".join(str(n) for n in valid) + "]" if valid else ""

    text = CITATION.sub(keep_valid, answer)
    text = re.sub(r"[ \t]+([.,;:!?])", r"\1", text)  # "speeds up [7]." -> "speeds up."
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    return text, sorted(used)


def out_of_scope() -> dict[str, Any]:
    return {"status": "out_of_scope", "answer": OUT_OF_SCOPE, "citations": []}


# Machine-readable reason for status "error", so the backend can tell a missing key from an outage
LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
LLM_UNAVAILABLE = "LLM_UNAVAILABLE"


def error(message: str, code: str = LLM_UNAVAILABLE) -> dict[str, Any]:
    return {"status": "error", "code": code, "answer": message, "citations": []}


def answer_question(question: str, retrieve: Callable[..., Retrieval], get_llm: Callable[[], LLMProvider],
                    subject_id: Optional[ObjectId] = None, topic_id: Optional[ObjectId] = None) -> dict[str, Any]:
    found = retrieve(question, k=SEARCH_K, subject_id=subject_id, topic_id=topic_id)
    context = [h for h in found.chunks if h.source_type == "textbook"][:MAX_CONTEXT_CHUNKS]
    if not found.relevant or not context:
        log.info("Out of scope (best score %s); the LLM was not called", found.best_score)
        return out_of_scope()

    try:
        llm = get_llm()  # GROQ_API_KEY missing -> LLMNotConfiguredError, with a clear message
        raw = llm.complete(SYSTEM_PROMPT, build_prompt(question, context))
    except LLMNotConfiguredError as exc:
        return error(str(exc), LLM_NOT_CONFIGURED)
    except LLMError as exc:
        return error(str(exc))

    answer, cited = clean_citations(raw, len(context))
    claims = claims_by_citation(answer)
    citations = [{"n": n, "chunkId": str(context[n - 1].chunk_id), "source": context[n - 1].source,
                  "page": context[n - 1].page,
                  # the part of the chunk closest to the claim it supports, not just its first 200 characters
                  "snippet": best_snippet(context[n - 1].text, question, claims.get(n, ""))} for n in cited]
    return {"status": "ok", "answer": answer, "citations": citations}
