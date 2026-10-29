"""The answer pipeline with a fake retriever and the mock LLM."""

from typing import Any, Optional

from bson import ObjectId

from app.answer import (CONTEXT_CHARS, MAX_CONTEXT_CHUNKS, NO_ANSWER, OUT_OF_SCOPE, SYSTEM_PROMPT, answer_question,
                        clean_citations, trim)
from app.llm import NOT_CONFIGURED, TIMED_OUT, LLMError, LLMNotConfiguredError, MockLLMProvider
from app.relevance import Retrieval, apply_relevance
from retrieval import SearchHit
from tests.qa_helpers import hit


class FakeRetrieve:
    def __init__(self, hits: list[SearchHit], threshold: float = 0.80, margin: float = 0.05) -> None:
        self.hits, self.threshold, self.margin = hits, threshold, margin
        self.calls: list[dict[str, Any]] = []

    def __call__(self, question: str, k: int = 5, subject_id: Optional[ObjectId] = None,
                 topic_id: Optional[ObjectId] = None) -> Retrieval:
        self.calls.append({"question": question, "k": k, "subject_id": subject_id, "topic_id": topic_id})
        return apply_relevance(self.hits[:k], self.threshold, self.margin)


def test_normal_answer_has_citations_that_point_to_real_pages() -> None:
    hits = [hit(0.88, page=37), hit(0.87, page=36, text="Enzymes are proteins that act as biological catalysts. " * 4)]
    llm = MockLLMProvider("Enzymes lower the activation energy [1]. They are proteins [2].")
    result = answer_question("How do enzymes work?", FakeRetrieve(hits), lambda: llm)

    assert result["status"] == "ok"
    assert result["answer"] == "Enzymes lower the activation energy [1]. They are proteins [2]."
    assert [(c["n"], c["chunkId"], c["source"], c["page"]) for c in result["citations"]] == [
        (1, str(hits[0].chunk_id), "STBB_Biology_XI.pdf", 37), (2, str(hits[1].chunk_id), "STBB_Biology_XI.pdf", 36)]
    # The snippet is the sentence that supports the claim, not the chunk's heading
    assert result["citations"][0]["snippet"] == ("During these reactions the substrate binds to the active site of the enzyme and "
                                                 "forms an enzyme-substrate complex, which lowers the activation energy of the reaction.")
    system, user = llm.calls[0]
    assert system == SYSTEM_PROMPT and "ONLY" in system and NO_ANSWER in system
    # Tightened after the live check (2026-10-29): stay on the question, plain text, partial answers
    assert "Answer only what was asked" in system and "no LaTeX" in system and "only part of the question" in system
    assert "[1] (STBB_Biology_XI.pdf, page 37)" in user and "[2] (STBB_Biology_XI.pdf, page 36)" in user
    assert "Student's question: How do enzymes work?" in user


def test_out_of_scope_never_calls_the_llm() -> None:
    llm = MockLLMProvider()
    result = answer_question("Who won the cricket world cup?", FakeRetrieve([hit(0.763), hit(0.75)]), lambda: llm)
    assert result == {"status": "out_of_scope", "answer": OUT_OF_SCOPE, "citations": []}
    assert llm.calls == []


def test_not_relevant_never_calls_the_llm_even_if_chunks_came_back() -> None:
    """The answer step checks `relevant` itself, not only that the chunk list is empty."""
    llm = MockLLMProvider()
    result = answer_question("cricket?", lambda *a, **k: Retrieval(relevant=False, chunks=[hit(0.79)]), lambda: llm)
    assert result["status"] == "out_of_scope" and llm.calls == []


def test_out_of_scope_does_not_even_need_a_configured_llm() -> None:
    def no_key() -> MockLLMProvider:
        raise LLMNotConfiguredError(NOT_CONFIGURED)

    assert answer_question("cricket?", FakeRetrieve([hit(0.7)]), no_key)["status"] == "out_of_scope"


def test_only_textbook_chunks_at_most_four_trimmed_go_to_the_llm() -> None:
    long_text = "Photosynthesis converts light energy into chemical energy. " * 40  # ~2,400 chars
    hits = [hit(0.90, text=long_text, page=p) for p in (81, 82, 83)] + [
        hit(0.895, text="1.1 Classify viruses on basis of their structure and number of strands, diseases and hosts.",
            source="PMDC.pdf", source_type="syllabus", page=5),
        hit(0.89, text=long_text, page=84), hit(0.89, text=long_text, page=85)]
    llm = MockLLMProvider("Light is captured by chlorophyll [1].")
    answer_question("What is photosynthesis?", FakeRetrieve(hits), lambda: llm)

    user = llm.calls[0][1]
    assert "PMDC.pdf" not in user  # syllabus line left out
    assert "[4] (STBB_Biology_XI.pdf, page 84)" in user and "[5]" not in user  # max 4
    assert len(trim(long_text)) <= CONTEXT_CHARS and MAX_CONTEXT_CHUNKS == 4


def test_relevant_but_no_textbook_chunk_is_out_of_scope() -> None:
    llm = MockLLMProvider()
    hits = [hit(0.85, source="PMDC.pdf", source_type="syllabus", text="14.1 Describe the nomenclature of Alkanes " * 4)]
    assert answer_question("alkanes?", FakeRetrieve(hits), lambda: llm)["status"] == "out_of_scope"
    assert llm.calls == []


def test_invalid_citation_numbers_are_removed() -> None:
    llm = MockLLMProvider("Osmosis moves water [1][7]. It needs a membrane [3, 2]. Also [9].")
    result = answer_question("What is osmosis?", FakeRetrieve([hit(0.86), hit(0.85)]), lambda: llm)
    assert result["answer"] == "Osmosis moves water [1]. It needs a membrane [2]. Also."
    assert [c["n"] for c in result["citations"]] == [1, 2]


def test_answer_without_citations_has_none() -> None:
    llm = MockLLMProvider(NO_ANSWER)
    result = answer_question("Why is the sky blue?", FakeRetrieve([hit(0.81)]), lambda: llm)
    assert result == {"status": "ok", "answer": NO_ANSWER, "citations": []}


def test_llm_timeout_gives_status_error_with_a_friendly_message() -> None:
    llm = MockLLMProvider(error=LLMError(TIMED_OUT))
    result = answer_question("How do enzymes work?", FakeRetrieve([hit(0.88)]), lambda: llm)
    assert result == {"status": "error", "code": "LLM_UNAVAILABLE", "answer": TIMED_OUT, "citations": []}


def test_empty_groq_key_gives_a_clear_error() -> None:
    def no_key() -> MockLLMProvider:
        raise LLMNotConfiguredError(NOT_CONFIGURED)

    result = answer_question("How do enzymes work?", FakeRetrieve([hit(0.88)]), no_key)
    assert result["status"] == "error" and "GROQ_API_KEY is empty" in result["answer"]
    assert result["code"] == "LLM_NOT_CONFIGURED"


def test_subject_and_topic_reach_the_retriever() -> None:
    retrieve = FakeRetrieve([hit(0.7)])
    subject, topic = ObjectId(), ObjectId()
    answer_question("q", retrieve, MockLLMProvider, subject_id=subject, topic_id=topic)
    assert retrieve.calls[0]["subject_id"] == subject and retrieve.calls[0]["topic_id"] == topic


def test_clean_citations_and_trim() -> None:
    assert clean_citations("A [0]. B [2]. C [1, 4].", 2) == ("A. B [2]. C [1].", [1, 2])
    assert trim("One. Two. Three.", 100) == "One. Two. Three."
    sentence = "Enzymes are catalysts. " * 60
    assert trim(sentence).endswith("catalysts.") and len(trim(sentence)) <= CONTEXT_CHARS
