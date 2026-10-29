"""The embedding model (bge-small by default, BGE-M3 by choice) through LlamaIndex, loaded from the
local model folder (never downloaded here). Which model, its dimensions and its folder all come
from config.py (EMBED_MODEL_NAME)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Optional

from config import EmbedModel, Settings
from ingestion.dimensions import DimensionMismatchError

if TYPE_CHECKING:  # imported only for type hints: the real import pulls in torch
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding


class ModelNotDownloadedError(Exception):
    pass


def missing_model_files(model: EmbedModel, model_dir: Path) -> list[str]:
    return [f for f in model.files if not (model_dir / f).is_file()]


def config_dimension(model_dir: Path) -> Optional[int]:
    """The vector size written in the model's config.json (hidden_size). Read BEFORE loading, so a
    wrong EMBED_MODEL_DIR (e.g. the 2.3 GB BGE-M3 folder while bge-small is configured) is caught
    without putting the wrong model in RAM."""
    try:
        size = json.loads((model_dir / "config.json").read_text(encoding="utf-8")).get("hidden_size")
    except (OSError, ValueError):
        return None
    return size if isinstance(size, int) else None


def embedder_kwargs(settings: Settings) -> dict[str, Any]:
    """Arguments for HuggingFaceEmbedding (a plain dict, so tests can check them without a model)."""
    return {
        "model_name": str(settings.embed_model_dir),
        "max_length": settings.embed_max_length,
        "normalize": True,  # unit vectors, so cosine similarity in Atlas is well-behaved
        "embed_batch_size": settings.embed_batch_size,
        # Added to questions only (get_query_embedding), never to stored chunks
        "query_instruction": settings.embed_model.query_prefix or None,
        "device": "cpu",
    }


def load_embedder(settings: Settings) -> HuggingFaceEmbedding:
    model, model_dir = settings.embed_model, settings.embed_model_dir
    missing = missing_model_files(model, model_dir)
    if missing:
        raise ModelNotDownloadedError(
            f"{model.name} is not downloaded yet (expected in {model_dir}; missing {', '.join(missing[:3])}). "
            "Run: python download_model.py"
        )
    size = config_dimension(model_dir)
    if size is not None and size != model.dim:
        raise DimensionMismatchError(
            f"The model in {model_dir} makes {size}-dimension vectors, but EMBED_MODEL_NAME={model.name} "
            f"needs {model.dim}. Check EMBED_MODEL_DIR in .env."
        )

    import torch  # heavy: imported only when a model is really loaded
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding

    # Fewer CPU threads = less RAM and heat; EMBED_THREADS=2 suits a laptop
    torch.set_num_threads(settings.embed_threads)
    return HuggingFaceEmbedding(**embedder_kwargs(settings))


def load_token_counter(settings: Settings) -> Callable[[str], list[int]]:
    """The model's own tokenizer, so "500 tokens" in CHUNK_SIZE means 500 tokens the model actually sees."""
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(settings.embed_model_dir))
    # We only count tokens of whole pages here, so silence the "longer than N tokens" warning
    tokenizer.model_max_length = 10**9
    return lambda text: tokenizer.encode(text, add_special_tokens=False)
