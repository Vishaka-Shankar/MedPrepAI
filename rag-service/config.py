"""All rag-service settings, read once from the shared root .env file.

Every value has a sensible default except MONGODB_URI, so the pipeline fails
fast with a clear message when the database is not configured.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent

load_dotenv(REPO_ROOT / ".env")

# The three MDCAT subjects: folder name -> (subject code, display name, share of the 200 MCQs).
# Weight shares come from proposal Figure 1 (Biology 68, Chemistry 54, Physics 54 of 200).
SUBJECTS: dict[str, tuple[str, str, float]] = {
    "biology": ("BIO", "Biology", 0.34),
    "chemistry": ("CHEM", "Chemistry", 0.27),
    "physics": ("PHY", "Physics", 0.27),
}

# data/raw/<MIXED_FOLDER>/ holds files covering all subjects (MDCAT syllabus, past papers);
# the subject is detected per page section instead of taken from the folder name.
MIXED_FOLDER = "mdcat"


class ConfigError(Exception):
    """Raised when a required setting is missing or invalid."""


@dataclass(frozen=True)
class EmbedModel:
    """Everything that depends on the embedding model, in ONE place. Ingestion, the re-embed
    script, retrieval, atlas_index.json and the dimension checks all read it from here."""

    name: str  # Hugging Face id, the value of EMBED_MODEL_NAME
    dim: int  # length of every vector the model makes
    field: str  # chunks field that holds this model's vectors
    index: str  # Atlas Vector Search index on that field
    max_tokens: int  # longest input the model reads; the rest of a longer chunk is cut off
    default_dir: str  # where download_model.py saves it (relative to rag-service/)
    query_prefix: str  # put in front of questions (never chunks) when searching
    files: tuple[str, ...]  # what download_model.py fetches and load_embedder() checks


# The files sentence-transformers needs (the ONNX copies and images in the repos are skipped)
_ST_FILES = ("config.json", "config_sentence_transformers.json", "modules.json",
             "sentence_bert_config.json", "1_Pooling/config.json",
             "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json")

# Default since 2026-10-29: small enough (about 130 MB) for a laptop with little or faulty RAM.
# English only, which fits our English textbooks.
BGE_SMALL = EmbedModel(
    name="BAAI/bge-small-en-v1.5",
    dim=384,
    field="embedding384",
    index="chunk_vector_index_384",
    max_tokens=512,
    default_dir="models/bge-small-en-v1.5",
    query_prefix="Represent this sentence for searching relevant passages: ",
    files=_ST_FILES + ("model.safetensors", "vocab.txt"),
)
# The first model (about 2.3 GB in RAM): still selectable with EMBED_MODEL_NAME on a stronger machine.
# Its vectors live in the original `embedding` field and index.
BGE_M3 = EmbedModel(
    name="BAAI/bge-m3",
    dim=1024,
    field="embedding",
    index="chunk_vector_index",
    max_tokens=1024,  # BGE-M3 reads up to 8192; 1024 keeps RAM low and our chunks are ~500
    default_dir="models/bge-m3",
    query_prefix="",  # BGE-M3 needs no prefix
    files=_ST_FILES + ("pytorch_model.bin", "sentencepiece.bpe.model"),
)
EMBED_MODELS: dict[str, EmbedModel] = {m.name: m for m in (BGE_SMALL, BGE_M3)}
DEFAULT_EMBED_MODEL = BGE_SMALL.name


def vector_index_definition(model: EmbedModel) -> dict[str, Any]:
    """The Atlas Vector Search index for `model`: cosine similarity, plus filters so a search
    can be limited to one subject or one topic. Written to atlas_index.json for the Atlas UI
    and `npm run db:setup`, and used by setup_vector_index.py."""
    return {
        "name": model.index,
        "type": "vectorSearch",
        "definition": {
            "fields": [
                {"type": "vector", "path": model.field, "numDimensions": model.dim, "similarity": "cosine"},
                {"type": "filter", "path": "subjectId"},
                {"type": "filter", "path": "topicId"},
            ]
        },
    }


def _path(value: str, base: Path) -> Path:
    """Relative paths in .env are resolved against `base`, so the CLI works from any folder."""
    p = Path(value)
    return p if p.is_absolute() else (base / p).resolve()


def _int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name, "").strip() or str(default)  # empty in .env = use the default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a whole number, got {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be at least {minimum}, got {value}")
    return value


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str
    tesseract_cmd: str
    ocr_lang: str
    ocr_dpi: int
    ocr_psm: int
    text_layer_min_letters: int
    data_raw_dir: Path
    embed_model: EmbedModel
    embed_model_dir: Path
    embed_batch_size: int
    embed_threads: int
    embed_max_length: int
    chunk_size: int
    chunk_overlap: int

    # Short names for the model facts used everywhere
    @property
    def embed_model_name(self) -> str:
        return self.embed_model.name

    @property
    def embed_dim(self) -> int:
        return self.embed_model.dim

    @property
    def embed_field(self) -> str:
        return self.embed_model.field

    @property
    def vector_index(self) -> str:
        return self.embed_model.index


def _embed_model() -> EmbedModel:
    name = os.getenv("EMBED_MODEL_NAME", "").strip() or DEFAULT_EMBED_MODEL
    model = EMBED_MODELS.get(name)
    if model is None:
        raise ConfigError(f"EMBED_MODEL_NAME={name!r} is not supported. Use one of: {', '.join(EMBED_MODELS)}")
    # EMBED_DIM is optional; when set it must agree with the model (a typo should not reach Atlas)
    if os.getenv("EMBED_DIM", "").strip() and _int("EMBED_DIM", model.dim) != model.dim:
        raise ConfigError(f"EMBED_DIM={os.getenv('EMBED_DIM')} does not match {name}, which makes "
                          f"{model.dim}-dimension vectors. Fix EMBED_DIM or remove it from .env.")
    return model


def load_settings() -> Settings:
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        raise ConfigError("MONGODB_URI is missing or invalid in the root .env file")

    chunk_size = _int("CHUNK_SIZE", 500, minimum=50)
    chunk_overlap = _int("CHUNK_OVERLAP", 75, minimum=0)
    if chunk_overlap >= chunk_size:
        raise ConfigError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")

    model = _embed_model()
    max_length = _int("EMBED_MAX_LENGTH", model.max_tokens, minimum=64)
    if max_length > model.max_tokens:
        raise ConfigError(f"EMBED_MAX_LENGTH={max_length} is more than {model.name} can read "
                          f"({model.max_tokens} tokens). Lower it or remove it from .env.")
    # +2 for the start/end tokens the model adds to every chunk
    if chunk_size + 2 > max_length:
        raise ConfigError(f"CHUNK_SIZE={chunk_size} does not fit in EMBED_MAX_LENGTH={max_length} "
                          f"(chunks would be cut off). Use CHUNK_SIZE of at most {max_length - 2}.")
    # EMBED_BATCH is the current name; EMBED_BATCH_SIZE is still read so older .env files work
    batch_name = "EMBED_BATCH" if os.getenv("EMBED_BATCH", "").strip() else "EMBED_BATCH_SIZE"

    return Settings(
        mongodb_uri=uri,
        tesseract_cmd=os.getenv("TESSERACT_CMD", "").strip() or "tesseract",
        ocr_lang=os.getenv("OCR_LANG", "eng"),
        ocr_dpi=_int("OCR_DPI", 300, minimum=72),
        ocr_psm=_int("OCR_PSM", 4, minimum=0),
        # A text layer with fewer letters than this may be only a footer or figure labels on a
        # scanned page, so the page is also OCR'd (and the OCR text kept if it has more text)
        text_layer_min_letters=_int("TEXT_LAYER_MIN_LETTERS", 800, minimum=0),
        data_raw_dir=_path(os.getenv("DATA_RAW_DIR", "data/raw"), REPO_ROOT),
        embed_model=model,
        embed_model_dir=_path(os.getenv("EMBED_MODEL_DIR", "").strip() or model.default_dir, SERVICE_DIR),
        # Small batches and few CPU threads keep peak RAM and heat low on a laptop
        embed_batch_size=_int(batch_name, 8),
        embed_threads=_int("EMBED_THREADS", 2),
        embed_max_length=max_length,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
