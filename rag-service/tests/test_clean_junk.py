"""scripts/clean_junk.py on a local test database."""

from bson import ObjectId
from pymongo.database import Database

from scripts.clean_junk import delete_junk, find_junk

GOOD = ("2.2 MECHANISM OF ENZYME ACTION: As we have discussed that all metabolic reactions are catalyzed by "
        "enzymes. During these reactions the substrate binds to the active site.")


def test_finds_and_deletes_only_junk_and_its_citations(test_db: Database) -> None:
    doc = test_db.source_documents.insert_one({"source": "STBB_Biology_XI.pdf"}).inserted_id
    good, scrap = ObjectId(), ObjectId()
    test_db.chunks.insert_many([{"_id": good, "docId": doc, "page": 36, "text": GOOD},
                                {"_id": scrap, "docId": doc, "page": 1, "text": "SIINDERMEXTIBOOKEBOARDRPAMSEORO"}])
    test_db.citations.insert_many([{"chunkId": scrap}, {"chunkId": good}])

    junk = find_junk(test_db)
    assert [(j["_id"], j["source"], j["page"]) for j in junk] == [(scrap, "STBB_Biology_XI.pdf", 1)]
    assert test_db.chunks.count_documents({}) == 2  # finding changes nothing

    assert delete_junk(test_db, [j["_id"] for j in junk]) == (1, 1)
    assert [c["_id"] for c in test_db.chunks.find()] == [good]
    assert [c["chunkId"] for c in test_db.citations.find()] == [good]
