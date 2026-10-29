"""Show what ingestion stored and prove there are no duplicates.

    python check_db.py            # counts + duplicate check
    python check_db.py --show 3   # also print 3 stored chunks (text, subject, source, page)
"""

from __future__ import annotations

import argparse
import sys

from config import load_settings
from ingestion import store


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show", type=int, default=0, help="print this many stored chunks")
    args = parser.parse_args(argv)

    settings = load_settings()
    client, db = store.connect(settings.mongodb_uri)
    with client:
        print(f"source_documents: {db.source_documents.count_documents({})} "
              f"(sample: {db.source_documents.count_documents({'isSample': True})})")
        print(f"chunks:           {db.chunks.count_documents({})} "
              f"(sample: {db.chunks.count_documents({'isSample': True})})")
        print(f"ingestion_runs:   {db.ingestion_runs.count_documents({})}")
        print(f"vectors in {settings.embed_field!r} ({settings.embed_model_name}): "
              f"{db.chunks.count_documents({settings.embed_field: {'$exists': True}})}")

        # Any contentHash or fileHash that occurs more than once is a duplicate
        dup_chunks = list(db.chunks.aggregate([
            {"$group": {"_id": "$contentHash", "n": {"$sum": 1}}}, {"$match": {"n": {"$gt": 1}}}]))
        dup_text = list(db.chunks.aggregate([
            {"$group": {"_id": "$text", "n": {"$sum": 1}}}, {"$match": {"n": {"$gt": 1}}}]))
        dup_docs = list(db.source_documents.aggregate([
            {"$group": {"_id": "$fileHash", "n": {"$sum": 1}}}, {"$match": {"n": {"$gt": 1}}}]))
        print(f"duplicate chunk hashes: {len(dup_chunks)}, duplicate chunk texts: {len(dup_text)}, "
              f"duplicate files: {len(dup_docs)}")

        if args.show:
            pipeline = [
                {"$sample": {"size": args.show}},
                {"$lookup": {"from": "source_documents", "localField": "docId", "foreignField": "_id", "as": "doc"}},
                {"$lookup": {"from": "subjects", "localField": "subjectId", "foreignField": "_id", "as": "subject"}},
            ]
            for c in db.chunks.aggregate(pipeline):
                doc, subject = c["doc"][0], c["subject"][0]
                print("\n" + "-" * 78)
                print(f"subject: {subject['name']} | source: {doc['source']} ({doc['type']}) | page: {c['page']} "
                      f"| topic: {c.get('topicId')} | sample: {c.get('isSample')} | dims: {len(c.get(settings.embed_field) or [])}")
                print(c["text"])
        return 1 if dup_chunks or dup_text or dup_docs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
