from ingestion.chunking import PageText, TopicRef, chunk_pages, content_hash, detect_topic, make_splitter


# A whitespace "tokenizer" keeps the tests fast and independent of the 2 GB model
def words(text: str) -> list[str]:
    return text.split()


def long_text(n_sentences: int, prefix: str = "Sentence") -> str:
    return " ".join(f"{prefix} number {i} talks about enzymes and cells." for i in range(n_sentences))


META = {"subject": "biology", "source": "book.pdf"}


class TestContentHash:
    def test_same_text_same_hash(self) -> None:
        assert content_hash("Enzymes are proteins.") == content_hash("Enzymes are proteins.")

    def test_whitespace_differences_ignored(self) -> None:
        assert content_hash("Enzymes  are\nproteins. ") == content_hash("Enzymes are proteins.")

    def test_different_text_different_hash(self) -> None:
        assert content_hash("Enzymes are proteins.") != content_hash("Enzymes are lipids.")

    def test_is_sha256_hex(self) -> None:
        digest = content_hash("x")
        assert len(digest) == 64 and all(c in "0123456789abcdef" for c in digest)


class TestChunkPages:
    def test_short_page_is_one_chunk_with_page_number(self) -> None:
        chunks = chunk_pages([PageText(page=4, text="Enzymes are proteins.")], make_splitter(100, 10, words), META)
        assert len(chunks) == 1
        assert chunks[0].page == 4
        assert chunks[0].text == "Enzymes are proteins."
        assert chunks[0].content_hash == content_hash("Enzymes are proteins.")

    def test_long_page_is_split_within_size_limit(self) -> None:
        chunks = chunk_pages([PageText(page=1, text=long_text(60))], make_splitter(100, 20, words), META)
        assert len(chunks) > 1
        assert all(len(words(c.text)) <= 100 for c in chunks)

    def test_neighbouring_chunks_overlap(self) -> None:
        chunks = chunk_pages([PageText(page=1, text=long_text(60))], make_splitter(100, 30, words), META)
        first_tail = set(words(chunks[0].text)[-15:])
        second_head = set(words(chunks[1].text)[:40])
        assert first_tail & second_head - {"number", "talks", "about", "enzymes", "and", "cells."}

    def test_chunks_never_cross_pages(self) -> None:
        pages = [PageText(page=1, text=long_text(30, "Alpha")), PageText(page=2, text=long_text(30, "Beta"))]
        chunks = chunk_pages(pages, make_splitter(100, 20, words), META)
        assert {c.page for c in chunks} == {1, 2}
        for c in chunks:
            assert ("Alpha" in c.text) != ("Beta" in c.text)
            assert ("Alpha" in c.text) == (c.page == 1)

    def test_empty_pages_are_skipped(self) -> None:
        pages = [PageText(page=1, text=""), PageText(page=2, text="   "), PageText(page=3, text="Real text.")]
        chunks = chunk_pages(pages, make_splitter(100, 10, words), META)
        assert [c.page for c in chunks] == [3]

    def test_duplicate_text_in_one_document_kept_once(self) -> None:
        pages = [PageText(page=1, text="Same paragraph."), PageText(page=2, text="Same paragraph.")]
        chunks = chunk_pages(pages, make_splitter(100, 10, words), META)
        assert len(chunks) == 1 and chunks[0].page == 1

    def test_metadata_is_not_embedded_in_text(self) -> None:
        chunks = chunk_pages([PageText(page=1, text="Enzymes.")], make_splitter(100, 10, words), META)
        assert "book.pdf" not in chunks[0].text and "biology" not in chunks[0].text


class TestDetectTopic:
    TOPICS = [TopicRef(id=1, name="Enzymes"), TopicRef(id=2, name="Cell Membrane"), TopicRef(id=3, name="Cell")]

    def test_picks_most_mentioned_topic(self) -> None:
        topic = detect_topic("Enzymes speed reactions. Enzymes have an active site. The cell needs them.", self.TOPICS)
        assert topic is not None and topic.name == "Enzymes"

    def test_case_insensitive_whole_words(self) -> None:
        assert detect_topic("ENZYMES matter", self.TOPICS).name == "Enzymes"  # type: ignore[union-attr]
        assert detect_topic("cellular respiration", self.TOPICS) is None  # "cell" inside "cellular" doesn't count

    def test_tie_prefers_more_specific_name(self) -> None:
        topic = detect_topic("The cell membrane is a bilayer.", self.TOPICS)
        assert topic is not None and topic.name == "Cell Membrane"

    def test_no_match_returns_none(self) -> None:
        assert detect_topic("Newton's laws of motion", self.TOPICS) is None

    def test_no_topics_returns_none(self) -> None:
        assert detect_topic("Enzymes", []) is None
