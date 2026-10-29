"""Atlas storage estimate for adding (and later removing) a vector field on every chunk.

Vectors are stored as BSON arrays of 8-byte doubles, and every element also stores its index as a
text key ("0", "1", ...), so a 384-d vector takes about 4.9 KB and a 1024-d one about 13.2 KB.
The size is measured with the real BSON encoder, not guessed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import bson
from pymongo.database import Database

FREE_TIER_MB = 512.0
WARN_SHARE = 0.9  # warn when a step would fill more than 90% of the free tier
MB = 1_000_000  # Atlas shows sizes in decimal MB


def vector_field_bytes(field_name: str, dim: int) -> int:
    """Bytes one stored vector adds to a document (field name + array of doubles)."""
    return len(bson.encode({field_name: [0.0] * dim})) - len(bson.encode({}))


@dataclass(frozen=True)
class DbSize:
    chunks: int
    with_old: int  # chunks that still have the old (backup) vectors
    missing_new: int  # chunks without the new vectors yet
    db_bytes: int  # data + indexes of this database (dbStats totalSize)


def read_db_size(db: Database, old_field: str, new_field: str) -> DbSize:
    """Read-only: counts and dbStats. Changes nothing."""
    stats = db.command("dbStats")
    total = stats.get("totalSize") or stats.get("storageSize", 0) + stats.get("indexSize", 0)
    return DbSize(
        chunks=db.chunks.count_documents({}),
        with_old=db.chunks.count_documents({old_field: {"$exists": True}}),
        missing_new=db.chunks.count_documents({new_field: {"$exists": False}}),
        db_bytes=int(total),
    )


@dataclass
class StoragePlan:
    rows: list[tuple[str, float]] = field(default_factory=list)  # (step, MB used)
    warnings: list[str] = field(default_factory=list)
    exceeds_limit: bool = False

    def lines(self, limit_mb: float = FREE_TIER_MB) -> list[str]:
        out = [f"  {label:<46} {mb:7.1f} MB  ({mb / limit_mb:5.1%} of {limit_mb:.0f} MB)" for label, mb in self.rows]
        return out + [f"  WARNING: {w}" for w in self.warnings]


def plan_storage(size: DbSize, old_field: str, old_dim: int, new_field: str, new_dim: int,
                 cluster_used_mb: Optional[float] = None, limit_mb: float = FREE_TIER_MB) -> StoragePlan:
    """Storage now, after the re-embed (both vectors kept), and after the old vectors are removed.

    Atlas shows the whole cluster's usage, which this database cannot see, so pass it as
    cluster_used_mb (e.g. 154). Without it the numbers cover this database only."""
    base_mb = cluster_used_mb if cluster_used_mb is not None else size.db_bytes / MB
    scope = "cluster" if cluster_used_mb is not None else "this database only"
    add_mb = size.missing_new * vector_field_bytes(new_field, new_dim) / MB
    drop_mb = size.with_old * vector_field_bytes(old_field, old_dim) / MB

    plan = StoragePlan()
    plan.rows.append((f"Now ({scope})", base_mb))
    plan.rows.append((f"After re-embed: +{size.missing_new} x {new_dim}-d vectors", base_mb + add_mb))
    plan.rows.append((f"After removing {size.with_old} old {old_dim}-d vectors", base_mb + add_mb - drop_mb))
    peak = base_mb + add_mb
    if peak > limit_mb:
        plan.exceeds_limit = True
        plan.warnings.append(f"the re-embed would need {peak:.1f} MB, more than the {limit_mb:.0f} MB free tier. "
                             "Remove the old vectors first or free space in Atlas.")
    elif peak > WARN_SHARE * limit_mb:
        plan.warnings.append(f"the re-embed would use {peak / limit_mb:.0%} of the {limit_mb:.0f} MB free tier.")
    if cluster_used_mb is None:
        plan.warnings.append("cluster total unknown: pass --used-mb with the size Atlas shows (e.g. --used-mb 154).")
    return plan
