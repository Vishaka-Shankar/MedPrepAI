"""Atlas storage estimate for the re-embed."""

import bson
from pymongo.database import Database

from ingestion.storage import DbSize, plan_storage, read_db_size, vector_field_bytes


def test_vector_sizes_match_real_bson() -> None:
    assert 4800 < vector_field_bytes("embedding384", 384) < 5000  # about 4.9 KB
    assert 13000 < vector_field_bytes("embedding", 1024) < 13400  # about 13.2 KB (measured on Atlas: 14.7 KB per chunk incl. text)
    with_vector = len(bson.encode({"text": "x", "embedding384": [0.5] * 384}))
    assert with_vector - len(bson.encode({"text": "x"})) == vector_field_bytes("embedding384", 384)


def test_plan_for_our_atlas_numbers() -> None:
    size = DbSize(chunks=723, with_old=723, missing_new=723, db_bytes=12_440_000)
    plan = plan_storage(size, "embedding", 1024, "embedding384", 384, cluster_used_mb=154)
    (now_label, now), (_, after), (_, dropped) = plan.rows
    assert now_label == "Now (cluster)" and now == 154
    assert round(after - now, 1) == 3.5  # 723 x 4.9 KB
    assert round(after - dropped, 1) == 9.6  # 723 x 13.2 KB freed later
    assert plan.warnings == [] and not plan.exceeds_limit


def test_warns_near_the_limit_and_refuses_over_it() -> None:
    size = DbSize(chunks=723, with_old=723, missing_new=723, db_bytes=0)
    near = plan_storage(size, "embedding", 1024, "embedding384", 384, cluster_used_mb=470)
    assert not near.exceeds_limit and "92% of the 512 MB" in near.warnings[0]
    over = plan_storage(size, "embedding", 1024, "embedding384", 384, cluster_used_mb=510)
    assert over.exceeds_limit and "more than the 512 MB free tier" in over.warnings[0]


def test_without_cluster_size_it_says_so() -> None:
    plan = plan_storage(DbSize(1, 1, 1, 2_000_000), "embedding", 1024, "embedding384", 384)
    assert plan.rows[0] == ("Now (this database only)", 2.0)
    assert any("--used-mb" in w for w in plan.warnings)


def test_reads_sizes_from_a_local_database(test_db: Database) -> None:
    test_db.chunks.insert_many([{"text": "a", "embedding": [0.1] * 8}, {"text": "b", "embedding": [0.2] * 8, "embedding384": [0.3]}])
    size = read_db_size(test_db, "embedding", "embedding384")
    assert (size.chunks, size.with_old, size.missing_new) == (2, 2, 1)
    assert size.db_bytes > 0
