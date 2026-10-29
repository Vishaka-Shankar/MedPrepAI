"""Shared test helpers.

- No real model is ever loaded: load_embedder/load_token_counter are replaced by functions that
  fail the test, and every test that needs vectors uses FakeEmbedder.
- Database tests use a LOCAL throw-away MongoDB (the mongod binary the backend tests already
  downloaded into backend/node_modules/.cache), never Atlas. Without the binary those tests are skipped with a message.
"""

from __future__ import annotations

import os
import socket
import subprocess
import time
import uuid
from pathlib import Path
from typing import Callable, Iterator, Optional

import pytest
from pymongo import MongoClient
from pymongo.database import Database

import config
from config import Settings
from ingestion import embedding

EMBED_ENV = ("EMBED_MODEL_NAME", "EMBED_MODEL_DIR", "EMBED_DIM", "EMBED_BATCH", "EMBED_BATCH_SIZE",
             "EMBED_THREADS", "EMBED_MAX_LENGTH", "CHUNK_SIZE", "CHUNK_OVERLAP")


# The real loader, kept for tests of its checks that run BEFORE any model is loaded
REAL_LOAD_EMBEDDER = embedding.load_embedder


@pytest.fixture
def real_load_embedder() -> Callable[[Settings], object]:
    return REAL_LOAD_EMBEDDER


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("tests must not load a real embedding model or tokenizer")

    monkeypatch.setattr(embedding, "load_embedder", refuse)
    monkeypatch.setattr(embedding, "load_token_counter", refuse)


@pytest.fixture
def make_settings(monkeypatch: pytest.MonkeyPatch) -> Callable[..., Settings]:
    """Settings from a clean environment (the developer's .env does not leak into tests),
    plus the given EMBED_* / CHUNK_* overrides, e.g. make_settings(EMBED_MODEL_NAME="BAAI/bge-m3")."""

    def make(**env: str) -> Settings:
        for name in EMBED_ENV:
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("MONGODB_URI", "mongodb://127.0.0.1:1/medprep_test")
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        return config.load_settings()

    return make


# ------------------------------------------------------------------ local MongoDB

def _find_mongod() -> Optional[Path]:
    explicit = os.getenv("MONGOD_PATH")
    if explicit:
        return Path(explicit) if Path(explicit).is_file() else None
    # Where the backend's mongodb-memory-server keeps its download (or its global cache)
    folders = [config.REPO_ROOT / "backend" / "node_modules" / ".cache" / "mongodb-memory-server",
               Path.home() / ".cache" / "mongodb-binaries"]
    found = sorted(p for folder in folders for p in folder.glob("mongod*"))
    return next((p for p in found if p.suffix in ("", ".exe") and p.is_file()), None)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="session")
def mongod_uri(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    binary = _find_mongod()
    if binary is None:
        pytest.skip("no local mongod binary: run the backend tests once (they download it) or set MONGOD_PATH")
    data_dir = tmp_path_factory.mktemp("mongod")
    port = _free_port()
    proc = subprocess.Popen(
        [str(binary), "--dbpath", str(data_dir), "--port", str(port), "--bind_ip", "127.0.0.1",
         "--wiredTigerCacheSizeGB", "0.25",  # keep this test database small in RAM
         "--logpath", str(data_dir / "mongod.log")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    uri = f"mongodb://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while True:
        try:
            MongoClient(uri, serverSelectionTimeoutMS=500).admin.command("ping")
            break
        except Exception:  # noqa: BLE001 - still starting
            if time.monotonic() > deadline or proc.poll() is not None:
                proc.kill()
                pytest.fail(f"local mongod did not start (log: {data_dir / 'mongod.log'})")
            time.sleep(0.3)
    yield uri
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture
def test_db(mongod_uri: str) -> Iterator[Database]:
    """A fresh, empty database per test on the local mongod; dropped afterwards."""
    client: MongoClient = MongoClient(mongod_uri, tz_aware=True)
    db = client[f"medprep_test_{uuid.uuid4().hex[:8]}"]
    yield db
    client.drop_database(db.name)
    client.close()
