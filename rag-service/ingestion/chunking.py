"""Chunking (LlamaIndex SentenceSplitter), content hashing and topic detection.

Each page becomes one LlamaIndex `Document`, so every chunk keeps an exact page number
for citations. Chunks never cross a page boundary.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Callable, Optional

from llama_index.core import Document
from llama_index.core.node_parser import SentenceSplitter

Tokenizer = Callable[[str], list]


@dataclass(frozen=True)
class PageText:
    page: int  # 1-based page number in the PDF
    text: str
    ocr: bool = False  # True when the text came from Tesseract
    # Set for files that mix subjects (see subjects.py); None means "use the file's subject"
    subject: Optional[str] = None


@dataclass(frozen=True)
class ChunkDraft:
    text: str
    page: int
    content_hash: str
    subject: Optional[str] = None


@dataclass(frozen=True)
class TopicRef:
    id: object  # ObjectId from MongoDB (kept generic so tests need no database)
    name: str


def content_hash(text: str) -> str:
    """SHA-256 of the text with whitespace normalised, so the same content always gets the same hash."""
    normalized = re.sub(r"\s+", " ", text).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def make_splitter(chunk_size: int, chunk_overlap: int, tokenizer: Optional[Tokenizer] = None) -> SentenceSplitter:
    """A sentence-aware splitter: chunks of about `chunk_size` tokens that end on sentence boundaries
    where possible, with `chunk_overlap` tokens repeated between neighbours so context isn't lost."""
    return SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        tokenizer=tokenizer,
        paragraph_separator="\n\n",
        include_prev_next_rel=False,
    )


def chunk_pages(pages: list[PageText], splitter: SentenceSplitter, metadata: dict[str, str]) -> list[ChunkDraft]:
    """Split cleaned pages into chunks. Empty pages produce no chunks.
    Identical chunks inside one document are kept only once.
    A page's own `subject` (mixed files) overrides metadata["subject"]."""
    keys = [*metadata, "page", "subject"]
    documents = [
        Document(
            text=p.text,
            metadata={**metadata, "page": p.page, "subject": p.subject or metadata.get("subject")},
            # Metadata is stored in MongoDB, not mixed into the embedded text
            excluded_embed_metadata_keys=keys,
            excluded_llm_metadata_keys=keys,
        )
        for p in pages
        if p.text.strip()
    ]
    chunks: list[ChunkDraft] = []
    seen: set[str] = set()
    for node in splitter.get_nodes_from_documents(documents):
        text = node.get_content().strip()
        digest = content_hash(text)
        if text and digest not in seen:
            seen.add(digest)
            chunks.append(ChunkDraft(
                text=text,
                page=int(node.metadata["page"]),
                content_hash=digest,
                subject=node.metadata.get("subject"),
            ))
    return chunks


def detect_topic(text: str, topics: list[TopicRef]) -> Optional[TopicRef]:
    """Pick the topic whose name appears most often in the text (whole words, any case).
    Returns None when no topic name appears, so the chunk is stored with topic = null."""
    best: Optional[TopicRef] = None
    best_count = 0
    lowered = text.lower()
    for topic in topics:
        pattern = r"\b" + re.escape(topic.name.lower()) + r"\b"
        count = len(re.findall(pattern, lowered))
        # On a tie the longer (more specific) name wins, e.g. "Cell Division" over "Cell"
        if count > best_count or (count == best_count and count > 0 and best and len(topic.name) > len(best.name)):
            best, best_count = topic, count
    return best
