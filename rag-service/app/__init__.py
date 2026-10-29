"""The Q&A service (M4): FastAPI app, answer pipeline, LLM providers and the search CLI.

It reuses what ingestion built: config.py (model, field, index), retrieval.py (Atlas Vector
Search + re-ranking), ingestion/embedding.py (bge-small) and ingestion/junk.py (junk rules).
"""
