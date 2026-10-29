"""Search the syllabus from the command line (read-only; loads the embedding model once).

    python -m app.search "What is osmosis?" --subject biology --k 5

Prints whether the question counts as relevant (SIMILARITY_THRESHOLD, RETRIEVAL_MARGIN) and the
chunks kept, with score, source, page and the start of the text. --all shows every hit, also
those below the threshold or margin.
Exit codes: 0 = relevant, 1 = could not run, 2 = not relevant (out of scope).
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from bson import ObjectId
from pymongo.errors import ConfigurationError as PyMongoConfigError
from pymongo.errors import ServerSelectionTimeoutError

import retrieval
from app.relevance import apply_relevance
from app.settings import load_qa_settings
from config import SUBJECTS, ConfigError, load_settings
from ingestion import dimensions, embedding, store
from ingestion.memory import MB, LowMemoryError, MemoryGuard, MemoryMeter


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m app.search", description="Search the syllabus chunks.")
    parser.add_argument("question")
    parser.add_argument("--subject", choices=sorted(SUBJECTS), help="only this subject")
    parser.add_argument("--k", type=int, default=5, choices=range(1, 21), metavar="1-20", help="chunks to fetch (default 5)")
    parser.add_argument("--all", action="store_true", help="also show hits below the threshold/margin")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        settings, qa = load_settings(), load_qa_settings()
        client, db = store.connect(settings.mongodb_uri)
    except ConfigError as exc:
        print(f"Config error: {exc}")
        return 1
    except (ServerSelectionTimeoutError, PyMongoConfigError):
        print("Cannot reach MongoDB Atlas. Check your internet and Atlas > Network Access.")
        return 1

    with client:
        subject_id: Optional[ObjectId] = None
        if args.subject:
            code = SUBJECTS[args.subject][0]
            row = db.subjects.find_one({"code": code}, {"_id": 1})
            if row is None:
                print(f"Subject {code} is not in the database yet (run ingest.py first).")
                return 1
            subject_id = row["_id"]
        meter = MemoryMeter()
        try:
            MemoryGuard(min_free_gb=qa.model_min_free_gb, max_pauses=0).wait_until_enough("loading the embedding model")
            model = embedding.load_embedder(settings)
            dimensions.check_dimension(settings, "The loaded model", dimensions.embedder_dimension(model))
        except (LowMemoryError, embedding.ModelNotDownloadedError, dimensions.DimensionMismatchError) as exc:
            print(exc)
            return 1

        hits = retrieval.search(db.chunks, model, settings, args.question, limit=args.k, subject_id=subject_id)
        found = apply_relevance(hits, qa.similarity_threshold, qa.retrieval_margin)
        best = f"{found.best_score:.4f}" if found.best_score is not None else "-"
        print(f"Question: {args.question!r}  subject: {args.subject or 'all'}  k={args.k}")
        print(f"Relevant: {'yes' if found.relevant else 'NO (out of scope)'}  best score {best}  "
              f"(threshold {qa.similarity_threshold}, margin {qa.retrieval_margin}); kept {len(found.chunks)} of {len(hits)}")
        kept = {h.chunk_id for h in found.chunks}
        for rank, h in enumerate(hits if args.all else found.chunks, 1):
            mark = "" if h.chunk_id in kept else "  (dropped)"
            print(f"\n{rank}. score {h.score:.4f}  {h.source} ({h.source_type})  page {h.page}{mark}")
            print("   " + " ".join(h.text.split())[:150])
        print(f"\nPeak memory: {meter.sample()[1] / MB:.0f} MB")
        return 0 if found.relevant else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
