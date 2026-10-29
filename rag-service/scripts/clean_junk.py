"""List (and, with --apply, delete) stored chunks that ingestion/junk.py now calls junk.

    python scripts/clean_junk.py           # dry run: list them, change nothing
    python scripts/clean_junk.py --apply   # delete exactly those chunks (and any citations of them)

New ingestion already leaves junk out; this is for chunks stored before the rule existed.
Exit codes: 0 = done, 1 = could not start.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from pymongo.database import Database  # noqa: E402
from pymongo.errors import ConfigurationError as PyMongoConfigError  # noqa: E402
from pymongo.errors import ServerSelectionTimeoutError  # noqa: E402

from config import ConfigError, load_settings  # noqa: E402
from ingestion import store  # noqa: E402
from ingestion.junk import junk_reason  # noqa: E402


def find_junk(db: Database) -> list[dict]:
    """Every stored chunk the junk rule rejects, with its reason and source file."""
    sources = {d["_id"]: d.get("source", "?") for d in db.source_documents.find({}, {"source": 1})}
    found = []
    for c in db.chunks.find({}, {"text": 1, "docId": 1, "page": 1}).sort("_id", 1):
        reason = junk_reason(c["text"])
        if reason:
            found.append({"_id": c["_id"], "source": sources.get(c["docId"], "?"), "page": c.get("page"),
                          "reason": reason, "text": " ".join(c["text"].split())[:100]})
    return found


def delete_junk(db: Database, ids: list) -> tuple[int, int]:
    """Citations first, then the chunks (same order as account deletion: nothing points at a missing chunk)."""
    citations = db.citations.delete_many({"chunkId": {"$in": ids}}).deleted_count
    return db.chunks.delete_many({"_id": {"$in": ids}}).deleted_count, citations


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="List or delete stored junk chunks.")
    parser.add_argument("--apply", action="store_true", help="delete the listed chunks (default: dry run)")
    args = parser.parse_args(argv)
    try:
        settings = load_settings()
        client, db = store.connect(settings.mongodb_uri)
    except ConfigError as exc:
        print(f"Config error: {exc}")
        return 1
    except (ServerSelectionTimeoutError, PyMongoConfigError):
        print("Cannot reach MongoDB Atlas. Check your internet and Atlas > Network Access.")
        return 1
    with client:
        junk = find_junk(db)
        total = db.chunks.count_documents({})
        for j in junk:
            print(f"  {j['source']:40} p.{j['page']!s:<4} {j['reason']:45} {j['text']!r}")
        print(f"{len(junk)} junk chunk(s) of {total}.")
        if not args.apply:
            print("Dry run: nothing changed. Run with --apply to delete exactly these.")
            return 0
        chunks, citations = delete_junk(db, [j["_id"] for j in junk])
        print(f"Deleted {chunks} chunk(s) and {citations} citation(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
