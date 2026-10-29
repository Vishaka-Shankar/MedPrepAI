# rag-service: content ingestion (M2) and Q&A service (M4)

Turns MDCAT PDFs into searchable chunks in MongoDB Atlas:

```
data/raw/<subject>/*.pdf
  -> text per page (PDF text layer; Tesseract OCR for scanned pages)   ingestion/pdf_extract.py
  -> cleaning (headers, footers, page numbers, broken lines)          ingestion/cleaning.py
  -> ~500-token chunks with 75-token overlap (LlamaIndex)              ingestion/chunking.py
  -> embeddings: bge-small-en-v1.5, 384 dims (default) or BGE-M3     ingestion/embedding.py
  -> Atlas: source_documents + chunks (+ ingestion_runs)               ingestion/store.py
```

`retrieval.py` searches the chunks (Atlas Vector Search):
- It fetches 2 × `limit` hits, looks up each chunk's source file and type, and keeps the best `limit`.
- **Syllabus chunks get 0.02 subtracted for ranking only**, because the syllabus topic lists name a topic without explaining it, yet scored as high as the textbook pages that do. The returned score is still Atlas's own.
- Each hit carries its source file and page for the citation.

The FastAPI Q&A service (`app/`, section 10) uses it; NestJS will call it at `RAG_SERVICE_URL`.

**What is stored (2026-10-29):** all 8 files are fully ingested, 2,428 chunks:

| Subject | Chunks | Files |
|---|---|---|
| Biology | 936 | Biology XI and XII |
| Chemistry | 671 | Chemistry XI and XII |
| Physics | 821 | Physics XI and XII |

The counts include each subject's sections of the PMDC syllabus and the SZABMU 2024 paper. The run took 92 minutes, 1,596 pages needed OCR, and every chunk has a 384-d bge-small vector.

**Embedding model:** one setting, `EMBED_MODEL_NAME`, picks the model, and `config.py` derives everything else from it (section 9). **Why bge-small and not the proposal's BGE-M3:** section 11.
The default since 2026-10-29 is `BAAI/bge-small-en-v1.5`: it needs far less RAM, which this laptop's faulty memory requires.

## 1. One-time setup (Windows)

| Need | How | Check |
|---|---|---|
| Python 3.12 | `py install 3.12` (Python install manager) | `py -V:3.12 --version` |
| Tesseract OCR | `winget install UB-Mannheim.TesseractOCR` | `"C:\Program Files\Tesseract-OCR\tesseract.exe" --version` |

```powershell
cd rag-service
py -V:3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe download_model.py     # the configured model, once (bge-small ~130 MB; BGE-M3 ~2.3 GB)
.venv\Scripts\python.exe setup_vector_index.py # create/verify the Atlas vector index
```

- **Python 3.12, not 3.14:** this is the version in the proposal, and the one the ML libraries are tested on.
- **Tesseract path:** the path goes in `TESSERACT_CMD` in the root `.env`. If Tesseract is missing, the pipeline still runs; it warns and skips scanned pages.
- **The model download** prints the model and destination first. It fetches only the files sentence-transformers needs (no ONNX copies). If the download breaks, run the command again and it resumes. Files go to `rag-service/models/<model>`, which is git-ignored. The pipeline never downloads by itself; without the model it says *"Run: python download_model.py"*.

## 2. Usage

Put PDFs in `data/raw/biology/`, `data/raw/chemistry/` or `data/raw/physics/`, then:

```powershell
.venv\Scripts\python.exe ingest.py --subject biology   # one subject
.venv\Scripts\python.exe ingest.py --mixed             # data/raw/mdcat/: syllabus + past papers (subject per section)
.venv\Scripts\python.exe ingest.py --all               # all three subjects + mixed
.venv\Scripts\python.exe ingest.py --all --force       # re-check files already ingested
.venv\Scripts\python.exe ingest.py --file ..\data\raw\physics\STBB_Physics_XI.pdf --pages 1-40   # test one book's first pages
.venv\Scripts\python.exe check_db.py --show 3          # counts, duplicate check, 3 sample chunks
.venv\Scripts\python.exe ingest.py --delete-sample     # remove SAMPLE_*.pdf data from the DB
```

The log shows progress per file and per batch. It ends with a summary of documents (ingested, skipped, failed), pages, OCR pages, chunks created, chunks already stored, and time taken.
A corrupt, encrypted or empty PDF is **skipped with a clear message**, and the run continues. A single unreadable page is skipped; the rest of its document is kept.

### Long runs: background, progress, safe stop, resume

The full run takes about 3.5–4 hours on a laptop CPU. Start it in the background from PowerShell:

```powershell
cd D:\MedPrep-AI\rag-service
Start-Process .venv\Scripts\python.exe -ArgumentList "ingest.py --all" -WindowStyle Minimized
Get-Content logs\ingest.log -Wait -Tail 20      # watch progress; Ctrl+C here only stops watching
.venv\Scripts\python.exe ingest.py --stop       # stop safely (within about a minute)
.venv\Scripts\python.exe ingest.py --all --min-free-gb 1.2   # pause below 1.2 GB free RAM instead of 1.5
```

**The log** (`logs/ingest.log`) has one line per page and per embedding batch:
```
... STBB_Physics_XII.pdf page 47/306 OCR 2.6s | elapsed 0h 41m | left ~2h 58m
... STBB_Physics_XII.pdf embedded 24/310 chunks | elapsed 0h 52m | left ~2h 47m
```

**Resuming:** run the same command again and it continues where it stopped.
- **Finished files** are skipped: `ingestedAt` is set in `source_documents`.
- **Pages already read** come from the page cache in `data/processed/*.pages.jsonl`. Each page is written to disk the moment it is read, so a crash loses at most one page. The cache name includes the PDF's hash and the OCR settings; if either changes, the pages are read fresh.
- **Chunks already stored** are not embedded again (`contentHash`).

**What can stop a run, and what happens:**

| Event | What happens |
|---|---|
| `ingest.py --stop` | Creates a `STOP` file. The run finishes its current page or batch and exits with code 3 |
| Ctrl+C, closing the window, a crash, a power cut | The run dies. Everything up to the last page or batch is already saved |
| One book crashes, e.g. a bad page or a RAM error | The full traceback goes to the log, the book is marked failed, and the run continues with the next book |
| Internet or Atlas drops | Each database call retries for about 5 minutes (10 × 30 s) before giving up |
| Windows sleep timer | Blocked while the run is going. Closing the lid may still sleep the laptop, depending on its power settings |

**Sample data:** `python make_sample_data.py` creates a tiny `SAMPLE_*.pdf` set when a subject folder has no real PDFs. It includes:
- one page that is only an image, to test OCR
- one deliberately corrupt file, to test that bad files are skipped

Sample rows are stored with `isSample: true`.

## 3. How each step works (for the defence)

**Extraction** (`pdf_extract.py`). PyMuPDF reads each page's text layer, and `pick_page_text` decides where the page's text comes from:
- **Text layer with at least `TEXT_LAYER_MIN_LETTERS` (800) letters:** used as is. It is exact and fast; the PMDC syllabus and the past paper work like this.
- **Fewer letters:** the page is OCR'd, and the OCR text is used if it has more than 1.2× the letters. This matters because the STBB books are scans whose text layer often holds only the footer or figure labels. Physics XI p.27 was stored as just "Position (m) Time (s) 0 5 10…"; with OCR, the whole page is kept.

**OCR settings,** chosen by testing 7 variants on 4 hard pages:
- **Rendering:** each page is rendered as if it were A4 at `OCR_DPI` (300), whatever page size the PDF claims. Phone-scanner apps store pixels as points, which made one book render at 80 megapixels per page (14.6 s per page, 4× slower).
- **Preprocessing:** grayscale plus a contrast stretch.
- **Page mode:** Tesseract page mode `OCR_PSM` = 4 (one column of text). This read curved phone photos and tables best, and was faster than the default.

**Known OCR limits:**
- Superscripts and subscripts are lost: 6.02 × 10²³ becomes "6.02 x 1073", and CaCl₂ becomes "CaCl,".
- Greek letters and tables come out garbled.
- English Tesseract cannot read these, whatever the settings. Prose reads well.

Page numbers (1-based) are kept all the way to the database for citations.

**Cleaning** (`cleaning.py`, pure functions):
- **Running headers and footers:** a line in the top or bottom 3 lines that repeats on at least half the pages is removed. It must have at least 4 letters: in an MCQ paper almost every page ends with the line `D.`, and that is content. The comparison ignores digits ("Page 3" = "Page 14") and letters OCR often confuses ("AI" = "Al").
- **Page numbers** such as `7`, `Page 7`, `- 7 -` or `7 of 120` are removed. This only happens at the top and bottom of a page, so numbers in the body are safe.
- **Broken lines:** a word hyphenated across lines is rejoined ("photo-\nsynthesis" becomes "photosynthesis"). Lines split mid-sentence are joined. Paragraph breaks, list items and headings are kept.
- **Characters:** ligatures (ﬁ → fi) and soft hyphens are fixed. NFKC normalisation is not used, because it would turn m/s² into m/s2.

**Chunking** (`chunking.py`). LlamaIndex `SentenceSplitter` makes chunks of `CHUNK_SIZE` = 500 tokens with `CHUNK_OVERLAP` = 75. Tokens are counted with the embedding model's own tokenizer, and `config.py` checks that `CHUNK_SIZE` + 2 fits in what the model reads (512 tokens for bge-small).
- Each page is one LlamaIndex `Document`, so a chunk never crosses a page boundary and its page number is exact.
- Each chunk's metadata is subject, topic, source file and page.

**Mixed files** (`subjects.py`). The MDCAT syllabus and past papers in `data/raw/mdcat/` cover every subject in one file, so the subject is detected while reading the pages in order:
- An ALL-CAPS heading (`1. BIOLOGY`, `SECTION 2: CHEMISTRY`, or a bare `PHYSICS`) starts a section, even in the middle of a page. That page is then cut into two segments with the same page number.
- A page that lists 3 or more subject headings is a table of contents and does not change the subject.
- English and Logical Reasoning sections are out of FYP-I scope, so they are skipped. Cover and guide pages (no subject) are skipped too. The run log reports how many pages were skipped for each reason.
- The source document gets `subjectId: null`, and each chunk stores its own subject.

**Re-processing a changed file** (`--force`). If the cleaning rules change, re-processing produces new chunk text. The file's old chunks that are no longer produced are deleted, so outdated text never stays next to the new version.

**Topic detection** (`detect_topic`). The chunk takes the topic whose name appears most often in its text, as whole words in any case. If no name appears, the topic is `null`. The `topics` collection is still empty (topics and their MDCAT weightage come with the quiz/diagnostic milestone), so all chunks currently have `topicId: null`.

**Embedding** (`embedding.py`). The configured model runs through LlamaIndex's `HuggingFaceEmbedding` on CPU:
- `EMBED_BATCH` = 8 chunks at a time on `EMBED_THREADS` = 2 CPU threads.
- Vectors are normalised for cosine similarity and stored in the model's own field (`embedding384` for bge-small).
- Each batch is stored as soon as it is embedded, so an interrupted run keeps its progress.
- Before loading, the folder's `config.json` is checked: pointing `EMBED_MODEL_DIR` at the wrong model fails before 2 GB land in RAM.

**Junk chunks** (`junk.py`) are left out before storing, and each one is logged as `junk chunk skipped (p.N, reason): 'text'`. There are two rules, both deliberately conservative:
- **Shorter than 100 characters:** covers, "CONCEPT MAP" headings, stray figure captions.
- **The STBB copyright page or preface:** "all rights are reserved", "the era we are living in", "reviewed by directorate of curriculum".

A third rule ("less than 70% letters") was tried and **removed**: in the full run it also dropped real physics and chemistry (logic gates, collision equations, worked examples).
When a file is re-processed, junk it stored earlier is removed by the stale-chunk cleanup. `scripts/clean_junk.py` lists junk stored before the rule existed (a dry run by default); `--apply` deletes exactly those chunks.

**Memory guard** (`memory.py`):
- Before every page and every embedding batch, ingestion checks free RAM (`--min-free-gb`, default 1.5).
- If RAM is low, it pauses 30 s, up to 10 times.
- If RAM is still low, it stops the whole run cleanly with exit code 4. Run the same command again to continue.
- On 2026-10-29 the full run needed `--min-free-gb 1.2`, with VS Code open using about 1.8 GB.

**No duplicates, ever:**
1. `source_documents.fileHash` (SHA-256 of the PDF) is unique. A file that was fully ingested before is skipped instantly.
2. `chunks.contentHash` (SHA-256 of the chunk text) is unique. Chunks already in the database are not embedded again.
3. The unique indexes are the final guard: a duplicate insert is rejected by MongoDB and counted, not stored.

## 4. Stored data (ERD names)

| Collection | Fields written |
|---|---|
| `subjects` | code (`BIO`/`CHEM`/`PHY`), name, weightShare (0.34/0.27/0.27, proposal Figure 1); created if missing |
| `ingestion_runs` | startedAt, finishedAt, counts (documents, pages, ocrPages, chunks, seconds) |
| `source_documents` | subjectId, ingestionRunId, type (from the file name: `syllabus` / `past_paper` / `textbook`), source (file name), board, **fileHash** (UK), pages, ocrPages, ingestedAt, isSample |
| `chunks` | docId, **subjectId**, topicId (or null), page, text, **embedding384**[384] (bge-small, current), embedding[1024] (BGE-M3, backup), contentHash (UK), isSample |

`chunks.subjectId` is copied from the source document because Atlas Vector Search can only filter on fields stored on the chunk itself.

## 5. Atlas Vector Search index

Each model has its own field and index, so the old and new vectors never mix:

| Model | Field | Index | Dims |
|---|---|---|---|
| `BAAI/bge-small-en-v1.5` (default) | `embedding384` | `chunk_vector_index_384` | 384 |
| `BAAI/bge-m3` (backup, other machines) | `embedding` | `chunk_vector_index` | 1024 |

`atlas_index.json` is the index for the default model. It is generated from `config.py` with `python setup_vector_index.py --write-json`, and a test fails if they ever disagree. `npm run db:setup` in the backend reads the same file.

```json
{
  "name": "chunk_vector_index_384",
  "type": "vectorSearch",
  "definition": { "fields": [
    { "type": "vector", "path": "embedding384", "numDimensions": 384, "similarity": "cosine" },
    { "type": "filter", "path": "subjectId" },
    { "type": "filter", "path": "topicId" }
  ]}
}
```

**Create it in the Atlas UI:**
1. Atlas → your cluster → **Atlas Search** tab (in newer UIs: **Search & Vector Search**) → **Create Search Index**.
2. Choose **Atlas Vector Search → JSON Editor**, then **Next**.
3. Database `medprep`, collection `chunks`, index name **`chunk_vector_index_384`**.
4. Paste only the `definition` part of `atlas_index.json` (the object that starts with `"fields"`), then **Next → Create Search Index**.
5. Wait until the status is **READY**. The old `chunk_vector_index` stays as it is; the free tier allows 3 search indexes.

**Or by script:** `python setup_vector_index.py` creates or updates the configured model's index, waits for **READY**, and runs a real `$vectorSearch` with a subject filter (a stored chunk must find itself first, score about 1.0). It refuses if the stored vectors have another size, and never changes other indexes.

## 6. Settings (root `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `TESSERACT_CMD` | `tesseract` | Full path to `tesseract.exe` |
| `OCR_LANG`, `OCR_DPI`, `OCR_PSM` | `eng`, `300`, `4` | OCR language, render resolution (as A4), and Tesseract page mode |
| `TEXT_LAYER_MIN_LETTERS` | `800` | A page whose text layer has fewer letters is also OCR'd |
| `DATA_RAW_DIR` | `data/raw` | Input folder (relative to the repo root) |
| `EMBED_MODEL_NAME` | `BAAI/bge-small-en-v1.5` | The model; its dims, field, index and folder follow from it (`config.py`). `BAAI/bge-m3` selects the old one |
| `EMBED_MODEL_DIR` | `models/<model>` | Local model folder (empty = the default) |
| `EMBED_DIM` | (from the model) | Optional cross-check: must equal the model's size (384 or 1024) |
| `EMBED_BATCH`, `EMBED_THREADS` | `8`, `2` | Chunks per batch and CPU threads (lower them if RAM is tight). The old name `EMBED_BATCH_SIZE` is still read |
| `EMBED_MAX_LENGTH` | model maximum (512 / 1024) | Tokens the model reads per chunk; it can't be more than the model maximum |
| `CHUNK_SIZE`, `CHUNK_OVERLAP` | `500`, `75` | Chunk size and overlap in tokens |

## 7. Tests

```powershell
.venv\Scripts\python.exe -m pytest      # 196 tests
```

- **Ingestion:** cleaning, chunking, topic and subject detection, page choice/OCR, page cache, progress, stop.
- **Embedding config:** bge-small default, BGE-M3 by env, `EMBED_DIM`/length/chunk-size checks, `atlas_index.json` = config.
- **Dimension check:** model, stored vectors and index; a wrong model folder is caught before loading.
- **Retrieval:** field, index, subject filter, query embedding, input checks, syllabus re-ranking (on the local MongoDB).
- **Junk filter:** real covers, prefaces and scraps are junk; equations, tables and unit openers are kept. The pipeline drops junk before storing. `clean_junk.py` deletes only junk and its citations. A low-memory stop ends the whole run.
- **Re-embed:** crash and resume, STOP file, no duplicates, backup untouched, refusals, low-memory pause and clean stop (psutil mocked).
- **Storage estimate.**

**No real model is ever loaded:** `conftest.py` makes `load_embedder` and `load_token_counter` fail the test, and a fake embedder makes deterministic vectors from a hash of the text.

**Database tests** use a local, throw-away MongoDB, never Atlas. It is the `mongod` that the backend's mongodb-memory-server already downloaded into `backend/node_modules/.cache`, started with a 0.25 GB cache. Without it those tests are skipped; set `MONGOD_PATH` to use another binary.

## 8. Performance and limits (measured on this laptop)

The laptop has an Intel i7-8550U CPU, 8 GB RAM and no GPU.
- **Model (BGE-M3):** loading takes about 15–30 s, once per run, and about 2.3 GB of RAM. bge-small (about 130 MB on disk) is much lighter, but it has not been timed on this laptop yet; the re-embed prints its real speed.
- **Embedding (BGE-M3):** about 1.5 s per 500-token chunk. A 400-page textbook (roughly 800 chunks) takes about 20 minutes.
- **OCR:** about 1–2 s per scanned page.
- **Atlas free tier (M0, 512 MB):** a chunk with its 1024-d vector is about 14.7 KB (measured 2026-10-29). A 384-d vector adds about 4.9 KB; dropping the 1024-d one later frees about 13.2 KB per chunk.

## 9. Switching to bge-small: re-embedding the stored chunks

The first 723 chunks were embedded with BGE-M3, whose 2.3 GB in RAM crashed this laptop. `scripts/reembed_chunks.py` gives every stored chunk a bge-small vector in the **new** field `embedding384`, from the text already in Atlas: **no PDF reading and no OCR**. The old `embedding` field is never touched, so it stays as a backup until its removal is approved.

```powershell
.venv\Scripts\python.exe scripts\reembed_chunks.py --estimate --used-mb 154   # storage numbers only; writes nothing, loads no model
.venv\Scripts\python.exe scripts\reembed_chunks.py --used-mb 154              # run it (stop and restart at any point)
.venv\Scripts\python.exe scripts\reembed_chunks.py --stop                     # stop safely after the current batch
Get-Content logs\reembed.log -Wait -Tail 20                                    # watch progress
```

`--used-mb` is the cluster size Atlas shows (Atlas → cluster → Metrics or the "Data Size" bar). The database alone cannot see the whole cluster.

**How it works:**
- 200 chunks are read at a time, only `_id` and `text`, so the old vectors are never downloaded. They are embedded 8 at a time on 2 CPU threads, and each batch of 8 is saved at once.
- **Resume:** `logs/reembed_state.json` (model, dims, field, last `_id` done, counts) is saved after every batch; it is written to a temp file and renamed, so a crash cannot leave half a file. Only chunks **without** `embedding384` are picked, and each update only applies while the field is still missing, so a chunk is never written twice.
- **Startup dimension check:** the loaded model, any stored `embedding384` vectors and the `chunk_vector_index_384` index (if it exists) must all be 384. A marker from another model is refused.
- **Refusals:** the script refuses to write into `embedding` (the backup), and refuses to start if the estimate says the free tier would be exceeded.
- **Memory guard** (`ingestion/memory.py`, psutil):
  - Free RAM is checked before the model loads and before every 200 chunks.
  - Under 1.5 GB (`--min-free-gb`), it pauses 30 s, up to 10 times.
  - If RAM is still low, it stops with exit code 2 and the message "Close other programs ... run the same command again"; the progress is kept.
  - `gc.collect()` runs after every 200 chunks.
- **Progress line** after every 200: done/total, chunks per minute (pauses excluded), time left, process memory now and at its peak, free RAM, and chunks longer than the model reads (`truncated`; the end of such a chunk is not embedded).
- **Exit codes:** 0 done, 1 could not start, 2 low memory, 3 stopped on request (`--stop` or Ctrl+C).

**Storage** (measured 2026-10-29, read-only): the `medprep` database is 12.4 MB (723 chunks × 14.7 KB).

| Step | Cluster (154 MB now) |
|---|---|
| After the re-embed (+723 × 4.9 KB) | about 157.5 MB |
| After removing the old 1024-d vectors (−723 × 13.2 KB), only when approved | about 148 MB |

Both are far below 512 MB. The script warns above 90% of 512 MB and refuses above 100%.

**Order of steps:**
1. Change `.env` to the bge-small settings.
2. Download the model: `python download_model.py`.
3. Run `--estimate`, then the re-embed.
4. Create `chunk_vector_index_384` (section 5).
5. `retrieval.py` then searches `embedding384`.

Removing the old vectors and the old index is a separate step, done only after approval.

## 10. Q&A service (`app/`, M4)

FastAPI on top of what ingestion built. It reuses:
- `retrieval.py`: Atlas search on `embedding384`, syllabus re-ranking, and now a `topicId` filter too
- `ingestion/embedding.py`: bge-small
- `ingestion/junk.py`

| File | Role |
|---|---|
| `app/settings.py` | `SIMILARITY_THRESHOLD` (0.80), `RETRIEVAL_MARGIN` (0.05), `LLM_PROVIDER`, `GROQ_*`, `OLLAMA_*`, `BACKEND_ORIGIN` |
| `app/relevance.py` | The relevance rules below |
| `app/llm.py` | The LLM providers below |
| `app/answer.py` | Retrieve, out-of-scope stop, numbered context, LLM, citation check |
| `app/main.py` | FastAPI: `/health`, `/retrieve`, `/answer`; lazy model loading |
| `app/search.py` | Command-line search |

**Relevance rules** (`app/relevance.py`):
1. Drop any chunk the junk rules reject (a safety net).
2. The question counts as relevant only if the best score is at least the threshold.
3. Keep only chunks scoring at least `max(threshold, best − margin)`, in ranked order.

**LLM providers** (`app/llm.py`), chosen by `LLM_PROVIDER`:
- **Groq** (default, `GROQ_API_KEY` + `GROQ_MODEL`) or **Ollama** (local, created only when selected).
- 20 s timeout and **one** retry on a timeout, a network error, HTTP 429 or a 5xx. A rejected key is not retried.
- The API key is never logged or shown.
- `MockLLMProvider` exists for tests only and can't be chosen in `.env`. An empty `GROQ_API_KEY` gives a clear error, never a fake answer.

The 0.80 threshold comes from the retrieval check: the best in-syllabus hits scored 0.853–0.902, and "Who won the cricket world cup?" scored 0.763.

**Run it:**
```powershell
cd D:\MedPrep-AI\rag-service
.venv\Scripts\python.exe -m pip install -r requirements.txt                    # once: adds fastapi, uvicorn
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8000  # the service (RAG_SERVICE_URL)
.venv\Scripts\python.exe -m app.search "What is osmosis?" --subject biology --k 5   # command-line search
```

**Startup is light:** about 70 MB, with no model loaded and no database connection opened. The first `/retrieve` or `/answer` checks that **1 GB of RAM is free**, loads bge-small (about 0.6 GB) and keeps it. If less than 1 GB is free, that request gets a 503 ("not enough free memory"); the service never waits inside a request. Use one worker: each worker would load its own model.

**Endpoints** (CORS allows only `BACKEND_ORIGIN`, i.e. the NestJS backend):

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/health` | | `{status, modelLoaded, embeddingModel, expectedDimension, indexDimension, dbReachable, llmProvider, llmConfigured}`. Loads nothing |
| POST | `/retrieve` | `{question, subjectId?, topicId?, k? (1-10, default 5)}` | `{relevant, bestScore, chunks: [{chunkId, source, sourceType, page, score, text}]}` |
| POST | `/answer` | `{question, subjectId?, topicId?}` | `{status, answer, citations: [{n, chunkId, source, page, snippet}]}` |

- **Input checks:** the question is 1–1000 characters after trimming. `subjectId` and `topicId` must be 24-character ObjectIds. Anything else gets a 422.
- **Database or memory problems** get a 503 with a sentence the frontend can show.

**How `/answer` works** (`app/answer.py`):
1. **Retrieve** 8 candidates with the subject/topic filter.
2. **Out of scope:** if the question is not relevant, or no *textbook* chunk is left, the LLM is **not called**. The reply is `{status: "out_of_scope", answer: "I couldn't find this in the syllabus material. Try rephrasing, or pick a subject.", citations: []}`.
3. **Context:** up to **4 textbook chunks**, each trimmed to about **800 characters** at a sentence end and numbered `[1]`..`[4]` with their file and page. Syllabus lines and past-paper MCQs are left out, because they name or test a topic without explaining it.
4. **The system prompt** tells the model to answer **only** from the passages, to cite each fact as `[n]`, and to reply "The syllabus material I found does not answer this question." when the passages don't contain the answer.
5. **Citation check:** any `[n]` that isn't one of the numbered passages is **removed** (e.g. `[7]`, or the 3 in `[3, 2]`). `citations` lists exactly the passages the answer cites, each with a **snippet**:
   - `app/snippets.py` picks the sentence or short window that best supports the claim (the answer sentence with that `[n]`, weighted ×2) and the question, by shared content words. It needs no extra model.
   - It skips OCR noise (fewer than 60% real words) and heading-only fragments (under 6 words or mostly CAPITALS), and keeps the snippet to 200 characters or less, cut at a word.
   - Before this, the snippet was the chunk's first 200 characters, e.g. ". . ae Sai SS 7 __. Forms and Functions in Pian}…" for osmosis.
6. **LLM failure:** a timeout, an outage or a missing key gives `{status: "error", code: "LLM_NOT_CONFIGURED" | "LLM_UNAVAILABLE", answer: "<friendly sentence>", citations: []}`.

**Tests** (51 for the Q&A service, plus 1 for the topic filter in `test_retrieval.py`). They use the fake embedder, `MockLLMProvider`, `httpx.MockTransport` for Groq and Ollama, and the local mongod; never the real model or Atlas. They cover:
- a normal answer with citations
- out of scope, with the LLM provably not called
- the threshold, the margin and the junk safety net
- the subject and topic filters
- Groq retry and timeout, a rejected key, an empty `GROQ_API_KEY`
- invalid `[n]` stripped, textbook-only context of at most 4 trimmed chunks
- `/health` without loading the model, the model loaded once, 503 below 1 GB of free RAM, CORS, 422 on bad input

**Not yet:** the NestJS `/chat` endpoint that calls this service, and saving `chat_messages` and `citations`.

## 11. Why bge-small and not BGE-M3 (a deviation from the proposal)

The proposal names **BGE-M3** (1024 dimensions). The pipeline now uses **BAAI/bge-small-en-v1.5** (384 dimensions) by default. The reason is the hardware the project is built on, not the model's quality.

**Why we switched (2026-10-29):**
- **The laptop:** an Intel i7-8550U with 8 GB RAM and no GPU, and its RAM is faulty. During the BGE-M3 ingestion runs it crashed with 9 blue screens (`MEMORY_CORRUPTION_ONE_BIT`); the last one stopped the run at Biology XII page 306.
- **BGE-M3** needs about 2.3 GB of RAM just for the model, and embeds about 1.5 s per chunk on this CPU.
- **bge-small** is about 130 MB on disk.
  - The re-embed of the 723 chunks stored at the time peaked at 713 MB of process memory and ran at about 187 chunks per minute.
  - Ingesting the other five books then took 92 minutes, about 1 GB at peak, with no crash.
  - A search loads it in about 16 s, and a question then takes under a second.

**What we give up:**
- **Benchmark quality:** BGE-M3 is the stronger model on public benchmarks. It's multilingual, has 1024-dimension vectors and reads up to 8192 tokens; bge-small is English-only, 384 dimensions and reads at most 512 tokens.
  - **We have not measured the difference on our own data yet.**
- **Why the other limits matter little here:** the textbooks are in English. Our chunks are 500 tokens and are cut with bge-small's own tokenizer, so none is longer than it can read.
- **What we have observed with bge-small:**
  - For 7 syllabus questions in Biology, Chemistry and Physics, the top hits came from the right textbook pages.
  - "Who won the cricket world cup?" scored 0.763, while the best in-syllabus hits scored 0.853–0.902.
- Search also needs a question prefix ("Represent this sentence for searching relevant passages: "), which `config.py` adds automatically.

**Kept for comparison:**
- **621 chunks** still have their BGE-M3 vectors in `embedding`, next to `embedding384`: 478 from Biology XI, plus parts of the other books, the syllabus and the past paper.
- Their Atlas index `chunk_vector_index` (1024 dimensions) is still READY.
- So the two models can be compared on the same chunks with the proposal's measures (Recall@k, MRR), without re-embedding anything.

**How to switch back to BGE-M3**, e.g. on a machine with 16 GB of working RAM:
1. In `.env`:
   - Set `EMBED_MODEL_NAME=BAAI/bge-m3`.
   - Set `EMBED_MODEL_DIR=models/bge-m3`, or leave it empty.
   - Set `EMBED_DIM=1024`, or remove it.
   - Leave `EMBED_MAX_LENGTH` empty.

   Then `config.py` switches everything else: the field `embedding`, the index `chunk_vector_index`, 1024 dimensions and no query prefix. Ingestion, search and the dimension checks follow.
2. `python download_model.py` (about 2.3 GB).
3. Give every chunk a BGE-M3 vector. Today only the 621 kept chunks have one.
   - `scripts/reembed_chunks.py` does this job, but it refuses to write the `embedding` field on purpose, to protect the backup. Allowing it, when `EMBED_MODEL_NAME` is BGE-M3, is a small change; it only fills chunks that don't have the field yet.
   - Expect about 1,800 chunks × 1.5 s ≈ 45 minutes.
4. `python setup_vector_index.py` checks the index and runs a test search.
