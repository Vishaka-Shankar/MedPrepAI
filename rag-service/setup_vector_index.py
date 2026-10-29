"""Create or update the Atlas Vector Search index for the configured embedding model, then prove it answers queries.

    python setup_vector_index.py               # create/update the index on Atlas, wait, test it
    python setup_vector_index.py --write-json  # only rewrite atlas_index.json from config.py (no Atlas)

- the model comes from EMBED_MODEL_NAME (config.py): bge-small -> chunk_vector_index_384 on
  embedding384 (384 dims); BGE-M3 -> chunk_vector_index on embedding (1024 dims)
- cosine similarity; filter fields subjectId (search one subject) and topicId (search one topic)
- other indexes (e.g. the old 1024-d one) are never changed or deleted here
Safe to run many times. atlas_index.json (the default model's index) is what the Atlas UI steps
in the README and `npm run db:setup` in the backend use.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

from pymongo.collection import Collection
from pymongo.errors import OperationFailure, ServerSelectionTimeoutError

from config import DEFAULT_EMBED_MODEL, EMBED_MODELS, SERVICE_DIR, ConfigError, Settings, load_settings, vector_index_definition
from ingestion import dimensions, store

ATLAS_INDEX_FILE = SERVICE_DIR / "atlas_index.json"
WAIT_SECONDS = 300


def write_atlas_index_json(path: Path = ATLAS_INDEX_FILE) -> dict[str, Any]:
    """atlas_index.json always describes the DEFAULT model (bge-small), so the file in git
    never depends on one machine's .env. A test checks it still matches config.py."""
    index = vector_index_definition(EMBED_MODELS[DEFAULT_EMBED_MODEL])
    path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8", newline="\n")
    return index


def _normalise(definition: dict[str, Any]) -> list[tuple[Any, ...]]:
    """Compare definitions by their fields only (Atlas may add defaults or reorder)."""
    return sorted((f.get("type"), f.get("path"), f.get("numDimensions"), f.get("similarity")) for f in definition.get("fields", []))


def create_or_update(chunks: Collection, index: dict[str, Any]) -> None:
    name, definition = index["name"], index["definition"]
    existing = list(chunks.list_search_indexes(name))
    if not existing:
        chunks.create_search_index(index)
        print(f"Created vector index {name!r}.")
    elif _normalise(existing[0].get("latestDefinition", {})) != _normalise(definition):
        chunks.update_search_index(name, definition)
        print(f"Updated vector index {name!r} to the definition in config.py.")
    else:
        print(f"Vector index {name!r} already has the right definition.")


def wait_until_queryable(chunks: Collection, index: dict[str, Any]) -> dict[str, Any]:
    name, definition = index["name"], index["definition"]
    print("Waiting for Atlas to build the index", end="", flush=True)
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        info = next(iter(chunks.list_search_indexes(name)), None)
        # After an update Atlas keeps serving the old version; wait for the new one too
        if info and info.get("queryable") and info.get("status") == "READY" and _normalise(info.get("latestDefinition", {})) == _normalise(definition):
            print(" ready.")
            return info
        print(".", end="", flush=True)
        time.sleep(5)
    raise TimeoutError(f"index not ready after {WAIT_SECONDS} s")


def test_query(chunks: Collection, settings: Settings) -> None:
    """Search with a stored chunk's own vector: it must come back first with a score of ~1.0."""
    name, field = settings.vector_index, settings.embed_field
    sample = chunks.find_one({field: {"$exists": True}}, {field: 1, "subjectId": 1, "text": 1})
    if sample is None:
        vector = [random.random() for _ in range(settings.embed_dim)]
        results = list(chunks.aggregate([{"$vectorSearch": {"index": name, "path": field, "queryVector": vector, "numCandidates": 10, "limit": 1}}]))
        print(f"Test query ran OK, but no chunk has {field!r} yet ({len(results)} results). "
              "Run ingest.py or scripts/reembed_chunks.py, then this script again.")
        return

    pipeline = [
        {"$vectorSearch": {
            "index": name,
            "path": field,
            "queryVector": sample[field],
            "numCandidates": 50,
            "limit": 3,
            "filter": {"subjectId": sample["subjectId"]},  # proves the subject filter works
        }},
        {"$project": {"text": 1, "page": 1, "score": {"$meta": "vectorSearchScore"}}},
    ]
    results = list(chunks.aggregate(pipeline))
    print("Test query (a stored chunk's own vector, filtered by its subject):")
    for r in results:
        print(f"  score={r['score']:.4f}  page={r.get('page')}  {r['text'][:70]!r}")
    if not results or results[0]["_id"] != sample["_id"]:
        raise RuntimeError("the index answered, but the chunk did not find itself first")
    print("OK: the vector index is queryable and the subject filter works.")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Create the Atlas vector index for the configured model.")
    parser.add_argument("--write-json", action="store_true", help="only rewrite atlas_index.json (no Atlas)")
    if parser.parse_args(argv).write_json:
        index = write_atlas_index_json()
        print(f"Wrote {ATLAS_INDEX_FILE.name}: index {index['name']!r} on {index['definition']['fields'][0]['path']!r}.")
        return 0
    try:
        settings = load_settings()
        client, db = store.connect(settings.mongodb_uri)
    except ConfigError as exc:
        print(f"Config error: {exc}")
        return 1
    except ServerSelectionTimeoutError:
        print("Cannot reach MongoDB Atlas. Check your internet and Atlas > Network Access.")
        return 1

    with client:
        try:
            chunks = db.chunks
            index = vector_index_definition(settings.embed_model)
            print(f"Model {settings.embed_model_name}: index {index['name']!r} on {settings.embed_field!r} ({settings.embed_dim} dims)")
            # Refuse to index a field whose stored vectors have another size
            dimensions.check_dimension(settings, f"Stored chunks (field {settings.embed_field!r})",
                                       dimensions.stored_dimension(chunks, settings.embed_field))
            create_or_update(chunks, index)
            info = wait_until_queryable(chunks, index)
            print(f"Status: {info.get('status')}, queryable: {info.get('queryable')}")
            test_query(chunks, settings)
        except OperationFailure as exc:
            print(f"Atlas refused the request: {exc.details.get('errmsg') if exc.details else exc}")
            print("Vector Search needs an Atlas cluster (the free M0 tier works). See README for the manual UI steps.")
            return 1
        except (TimeoutError, RuntimeError, dimensions.DimensionMismatchError) as exc:
            print(f"\nFAILED: {exc}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
