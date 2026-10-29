"""One config source for the embedding model: defaults, BGE-M3 by env, cross-checks, atlas_index.json."""

import json
from pathlib import Path
from typing import Callable

import pytest

from config import BGE_M3, BGE_SMALL, DEFAULT_EMBED_MODEL, EMBED_MODELS, ConfigError, Settings, vector_index_definition
from ingestion.dimensions import DimensionMismatchError
from ingestion.embedding import ModelNotDownloadedError, embedder_kwargs
from setup_vector_index import ATLAS_INDEX_FILE, write_atlas_index_json

MakeSettings = Callable[..., Settings]


class TestDefaults:
    def test_bge_small_is_the_default(self, make_settings: MakeSettings) -> None:
        s = make_settings()
        assert DEFAULT_EMBED_MODEL == "BAAI/bge-small-en-v1.5"
        assert (s.embed_model_name, s.embed_dim, s.embed_field, s.vector_index) == (
            "BAAI/bge-small-en-v1.5", 384, "embedding384", "chunk_vector_index_384")
        assert s.embed_model_dir.parts[-2:] == ("models", "bge-small-en-v1.5")
        assert (s.embed_batch_size, s.embed_threads, s.embed_max_length) == (8, 2, 512)

    def test_bge_m3_is_still_selectable_by_env(self, make_settings: MakeSettings) -> None:
        s = make_settings(EMBED_MODEL_NAME="BAAI/bge-m3")
        assert (s.embed_dim, s.embed_field, s.vector_index) == (1024, "embedding", "chunk_vector_index")
        assert s.embed_model_dir.parts[-2:] == ("models", "bge-m3")
        assert s.embed_max_length == 1024

    def test_empty_values_mean_the_default(self, make_settings: MakeSettings) -> None:
        # .env.example leaves EMBED_MODEL_DIR and EMBED_MAX_LENGTH empty
        s = make_settings(EMBED_MODEL_NAME="", EMBED_MODEL_DIR="", EMBED_MAX_LENGTH="", EMBED_DIM="")
        assert (s.embed_dim, s.embed_max_length) == (384, 512)
        assert s.embed_model_dir.name == "bge-small-en-v1.5"

    def test_batch_reads_the_new_name_first_then_the_old_one(self, make_settings: MakeSettings) -> None:
        assert make_settings(EMBED_BATCH_SIZE="4").embed_batch_size == 4  # older .env files keep working
        assert make_settings(EMBED_BATCH="8", EMBED_BATCH_SIZE="4").embed_batch_size == 8


class TestCrossChecks:
    def test_embed_dim_must_match_the_model(self, make_settings: MakeSettings) -> None:
        assert make_settings(EMBED_DIM="384").embed_dim == 384
        with pytest.raises(ConfigError, match="EMBED_DIM=1024 does not match BAAI/bge-small-en-v1.5.*384"):
            make_settings(EMBED_DIM="1024")

    def test_unknown_model_lists_the_supported_ones(self, make_settings: MakeSettings) -> None:
        with pytest.raises(ConfigError, match="not supported.*bge-small-en-v1.5.*bge-m3"):
            make_settings(EMBED_MODEL_NAME="BAAI/bge-large-en")

    def test_max_length_cannot_exceed_what_the_model_reads(self, make_settings: MakeSettings) -> None:
        with pytest.raises(ConfigError, match="EMBED_MAX_LENGTH=1024 is more than BAAI/bge-small-en-v1.5"):
            make_settings(EMBED_MAX_LENGTH="1024")  # the old .env value

    def test_chunks_must_fit_in_the_model(self, make_settings: MakeSettings) -> None:
        with pytest.raises(ConfigError, match="CHUNK_SIZE=600 does not fit"):
            make_settings(CHUNK_SIZE="600")


class TestAtlasIndexJson:
    def test_file_matches_config_for_the_default_model(self) -> None:
        on_disk = json.loads(ATLAS_INDEX_FILE.read_text(encoding="utf-8"))
        assert on_disk == vector_index_definition(EMBED_MODELS[DEFAULT_EMBED_MODEL])
        vector, *filters = on_disk["definition"]["fields"]
        assert on_disk["name"] == "chunk_vector_index_384"
        assert vector == {"type": "vector", "path": "embedding384", "numDimensions": 384, "similarity": "cosine"}
        assert filters == [{"type": "filter", "path": "subjectId"}, {"type": "filter", "path": "topicId"}]

    def test_write_json_produces_the_same_file(self, tmp_path: Path) -> None:
        write_atlas_index_json(tmp_path / "atlas_index.json")
        assert (tmp_path / "atlas_index.json").read_text(encoding="utf-8") == ATLAS_INDEX_FILE.read_text(encoding="utf-8")

    def test_each_model_has_its_own_field_and_index(self) -> None:
        assert len({m.field for m in EMBED_MODELS.values()}) == len({m.index for m in EMBED_MODELS.values()}) == 2


class TestEmbedder:
    def test_query_prefix_only_for_bge_small(self, make_settings: MakeSettings) -> None:
        small = embedder_kwargs(make_settings())
        assert small["query_instruction"] == BGE_SMALL.query_prefix
        assert small["max_length"] == 512 and small["embed_batch_size"] == 8 and small["normalize"] is True
        assert embedder_kwargs(make_settings(EMBED_MODEL_NAME="BAAI/bge-m3"))["query_instruction"] is None

    def test_missing_model_files_are_reported(self, make_settings: MakeSettings, tmp_path: Path,
                                               real_load_embedder: Callable[[Settings], object]) -> None:
        with pytest.raises(ModelNotDownloadedError, match="bge-small-en-v1.5 is not downloaded yet"):
            real_load_embedder(make_settings(EMBED_MODEL_DIR=str(tmp_path)))

    def test_wrong_model_folder_is_caught_before_loading(self, make_settings: MakeSettings, tmp_path: Path,
                                                          real_load_embedder: Callable[[Settings], object]) -> None:
        # All files present, but config.json says 1024: the BGE-M3 folder with bge-small configured
        for name in BGE_SMALL.files:
            (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
            (tmp_path / name).write_text("{}", encoding="utf-8")
        (tmp_path / "config.json").write_text(json.dumps({"hidden_size": BGE_M3.dim}), encoding="utf-8")
        with pytest.raises(DimensionMismatchError, match="makes 1024-dimension vectors.*needs 384"):
            real_load_embedder(make_settings(EMBED_MODEL_DIR=str(tmp_path)))
