# MedPrep AI: project guide for Claude

## Goal
Final-year project (SZABIST, FYP-I): an MDCAT prep platform for **Biology, Chemistry and Physics**.
Students get (1) syllabus-grounded Q&A with citations (RAG), (2) past-paper and AI-generated practice quizzes,
(3) a dashboard ranking weak topics by MDCAT weightage.
Source of truth: `docs/proposal.pdf`. The database design comes from the ERD in `docs/erd.jpg` (SRS Figure 7).
**Priority: fewer features that fully work.** Build only what the current prompt asks for.

## Tools (from the approved proposal; do NOT substitute without asking)
- Backend: NestJS, TypeScript, Mongoose
- Frontend: React (web), built with Vite
- Database + vector store: MongoDB Atlas with Atlas Vector Search
- RAG: LlamaIndex, Tesseract OCR, and BGE embeddings:
  - **bge-small-en-v1.5 (384 dims)** is the default since 2026-10-29: the user approved it because BGE-M3's RAM crashed the laptop.
  - BGE-M3 (1024 dims) can still be selected with `EMBED_MODEL_NAME` on other machines.
  - Why: the 8 GB laptop's RAM is faulty, and BGE-M3 (~2.3 GB) caused 9 blue screens. bge-small peaked at ~0.7–1 GB with no crash.
  - Trade-off: English-only, 384 dims, 512 tokens; weaker on benchmarks. Not yet measured on our data.
  - 621 chunks keep BGE-M3 vectors and `chunk_vector_index` for a Recall@k/MRR comparison.
  - Switch back: rag-service/README.md section 11 (reembed_chunks.py must be allowed to fill `embedding`).
- LLM: Groq hosted (Llama 3.1 / Qwen2.5) or Ollama locally, chosen by `LLM_PROVIDER` in .env.
  Groq retired Llama 3.1 8B (2026-10-29), so the user chose `qwen/qwen3.8-27b` (the Qwen family).
- Evaluation: RAGAs, BM25 baseline, Recall@k, MRR
- Architecture: NestJS is the app; Python FastAPI `/rag-service` does ingestion and RAG; NestJS calls it over HTTP
- External: YouTube Data API (video recommendations, M5)

## Layout
```
backend/      NestJS API (src/auth, src/users, src/schemas, scripts/db-setup.ts, test/)
frontend/     React + Vite (src/api, src/auth, src/components/{ui,layout,chat}, src/pages, src/styles, src/lib, src/types, src/hooks, src/mocks)
              Quiz/Dashboard use typed mocks (src/mocks) via one data hook per page (src/hooks); swap the loader for the API later
              Plain CSS: tokens in src/styles/tokens.css + CSS modules; no UI library/Tailwind. Design: docs/design/*.png
rag-service/  Python 3.12: ingestion pipeline (ingest.py, ingestion/, tests/); Q&A service app/ (FastAPI, M4)
data/         raw + processed documents (git-ignored)
docs/         proposal, ERD, design mockups (docs/design: chat, quiz, dashboard)
.env          single env file at repo root, shared by all services (git-ignored)
```

## Commands
- Backend: `cd backend` → `npm run start:dev` | `npm test` | `npm run typecheck` | `npm run db:setup`
- Frontend: `cd frontend` → `npm run dev` | `npm test` | `npm run typecheck`
- rag-service: `cd rag-service` → `.venv\Scripts\python.exe ingest.py --all` | `--mixed` | `--file PATH --pages 1-40` | `--stop` | `-m pytest` | `check_db.py --show 3` | `setup_vector_index.py` | `download_model.py`
  (resumable: page cache in `data/processed/*.pages.jsonl`, progress in `rag-service/logs/ingest.log`; long runs start with
  `Start-Process .venv\Scripts\python.exe -ArgumentList "ingest.py --all" -WindowStyle Minimized`)
  (venv is Python 3.12; models live in `rag-service/models/<name>`, git-ignored; Tesseract at `TESSERACT_CMD`)
  Re-embed stored chunks: `scripts\reembed_chunks.py --estimate --used-mb 154` | `scripts\reembed_chunks.py` | `--stop`
  (resume marker `logs/reembed_state.json`, log `logs/reembed.log`, psutil RAM guard; never writes the old `embedding` field).
  Ingestion: RAM guard per page/batch (`--min-free-gb`, default 1.5; exit code 4 when it stays low; 1.2 was needed with VS Code open).
  Junk filter `ingestion/junk.py`: < 100 chars or STBB copyright/preface phrases. NO letter-share rule: it dropped real equations.
  `scripts\clean_junk.py` = dry run; `--apply` deletes listed junk + their citations. Retrieval re-ranks: syllabus chunks -0.02.
- Q&A service `rag-service/app/`:
  - Start: `python -m uvicorn app.main:create_app --factory --port 8000` (factory: importing it opens nothing). CLI: `python -m app.search "q" --subject biology --k 5`.
  - `relevance.py`: best score >= SIMILARITY_THRESHOLD (0.80), keep >= max(threshold, best - RETRIEVAL_MARGIN 0.05), junk safety net.
  - `answer.py`: not relevant or no textbook chunk -> out_of_scope, LLM NOT called. Otherwise <= 4 textbook chunks of ~800 chars as [1]..[n]; invalid [n] stripped.
  - `snippets.py`: citation snippet = the sentence/window sharing most content words with the claim (x2) and question; skips OCR noise/headings; <= 200 chars.
  - `llm.py`: Groq/Ollama over httpx, 20 s timeout, 1 retry. MockLLMProvider is tests-only; an empty GROQ_API_KEY is an error, never a silent mock.
  - `main.py`: lazy model load after a 1 GB free-RAM check (no waiting: 503), CORS = BACKEND_ORIGIN only, DB/RAM problems -> 503. About 70 MB before the model loads.
  - Tests inject `Services(...)` fakes (tests/qa_helpers.py FakeSearch, MockLLMProvider, httpx.MockTransport).
- Embedding model: ONE source, `rag-service/config.py` `EMBED_MODELS`. Each model has a name, dims, field, index, max tokens, folder,
  query prefix and files. `atlas_index.json` is generated from it (`setup_vector_index.py --write-json`; a test checks they match),
  and backend `db:setup` reads that JSON. Startup dimension check: `ingestion/dimensions.py`. Search: `rag-service/retrieval.py`.
  rag tests never load a real model (conftest blocks it; `tests/fakes.py` FakeEmbedder). DB tests use the local mongod from
  `backend/node_modules/.cache/mongodb-memory-server`, never Atlas.
- Windows PowerShell 5.1 re-encodes files with Get-Content/Set-Content (mojibake + BOM). Edit files with the Edit tool,
  keep Python sources ASCII (use `\uXXXX` escapes), and never let `.env` get a BOM.

## ERD collections (17), in `backend/src/schemas/`
Conventions: every primary key is Mongo `_id`; foreign keys are camelCase ObjectIds
(the ERD's `doc_id` → `docId`, `chunk_id` → `_id`). Every collection has `createdAt`/`updatedAt`.

| Collection | Fields (FK → target) | Unique / indexes |
|---|---|---|
| users | name, email, passwordHash (select:false), role (`student`/`instructor`/`admin`), emailVerified (default false), tokenVersion (default 0) | email UK |
| subjects | code, name, weightShare (0-1) | code UK |
| topics | subjectId→subjects, name, weightage w_t (0-1) | (subjectId, name) UK |
| ingestion_runs | startedAt, finishedAt, counts | |
| source_documents | subjectId→subjects (null for mixed MDCAT files in data/raw/mdcat), ingestionRunId→ingestion_runs, type (`syllabus`/`past_paper`/`textbook`), source, board; +fileHash, pages, ocrPages, ingestedAt, isSample (ingestion bookkeeping) | fileHash UK |
| chunks | docId→source_documents, subjectId→subjects (copied for vector filtering), topicId→topics (or null), page, text, embedding384[384] (bge-small, current), embedding[1024] (BGE-M3, backup until removal approved), contentHash, isSample | contentHash UK; Atlas vector indexes `chunk_vector_index_384` on embedding384 (current) and `chunk_vector_index` on embedding (old); cosine, filters subjectId + topicId |
| citations | chatMessageId→chat_messages, chunkId→chunks, page, snippet | chatMessageId |
| questions | topicId→topics, sourceChunkIds[]→chunks, year, stem, options[], answerKey (0-based), aiGenerated | topicId |
| video_resources | topicId→topics, youtubeId, title, status (`active`/`hidden`) | youtubeId UK |
| quiz_sessions | userId→users, topicId→topics, mode (`topic`/`adaptive`), timeLimit (s), status (`in_progress`/`completed`), score | (userId, createdAt) |
| attempts | userId→users, questionId→questions, quizSessionId→quiz_sessions, selectedOption (0-based), correct, timestamp | (userId, timestamp), quizSessionId |
| topic_mastery | userId→users, topicId→topics, mastery M_t (default 0.5), attemptCount | (userId, topicId) UK |
| review_items *(FYP-II)* | userId→users, questionId→questions, dueAt, intervalDays | (userId, questionId) UK, (userId, dueAt) |
| chat_messages | userId→users, question, inputMode (`text`/`voice`), answer, status (`pending`/`answered`/`failed`); +subjectId→subjects (null = all), outOfScope (not in ERD; chat page needs them) | (userId, createdAt) |
| pilot_feedback *(M7)* | userId→users, consentAt, susScore (0-100), usefulness (1-5) | userId UK |
| cohorts *(FYP-II)* | instructorId→users, name, joinCode | joinCode UK |
| cohort_members *(FYP-II)* | cohortId→cohorts, userId→users, consentAt | (cohortId, userId) UK |
| otp_codes *(auth, not in ERD)* | userId→users, email, purpose (`verify_email`/`reset_password`/`change_email`), codeHash (bcrypt), expiresAt, attempts, usedAt | TTL on expiresAt; (userId, purpose, createdAt) |

Indexes are created by `npm run db:setup` (`autoIndex` is off in the app).
Enum fields typed as a union (`'a' | 'b'`) MUST declare `type: String` in `@Prop`, or the schema crashes under
per-file compilation (dev server and Jest). `schemas.spec.ts` checks this.

## Diagnostic model (proposal 5.1)
`M_t ← (1 − α)·M_t + α·c` (α = 0.3, M_t starts at 0.5); `P_t = w_t·(1 − M_t)`; rank by P_t; fewer than 5 attempts = "insufficient data".

## Auth + users (done)
- `POST /auth/register` → 201 `{ message, email }` + emails a 6-digit OTP (no token). `POST /auth/verify-otp {email, code}` → `{ accessToken, user }`.
  `POST /auth/resend-otp {email}` → always the same message (60 s cooldown). `POST /auth/login` → `{ accessToken, user }`, generic 401, or 403 `EMAIL_NOT_VERIFIED` (+ fresh code).
  `GET /auth/me` (JWT). `GET /health` is public. verify/resend are throttled (@nestjs/throttler; off in tests unless THROTTLE_IN_TESTS=true).
- OTP: crypto.randomInt, bcrypt-hashed in `otp_codes`, 10 min expiry (TTL index), max 5 attempts, single use; never logged. MailService = nodemailer (SMTP_* in .env),
  JSON transport + in-memory `outbox` when NODE_ENV=test. Send failure → 503 EMAIL_SEND_FAILED and the new account is rolled back.
- A global `JwtAuthGuard` (APP_GUARD) protects every route; mark public routes with `@Public()`.
- bcrypt cost 10; registration always creates `student`; login gives the same 401 message for an unknown email and a wrong password (real reason only in the server log).
- DB unreachable → 503 (DatabaseUnavailableFilter, serverSelectionTimeoutMS 5000, bufferCommands false). Startup logs DB name/host, CORS origin and mail mode (never secrets).
- Real-DB tests use mongodb-memory-server (`test/auth.db.e2e.spec.ts`). `npm run db:mark-verified` was run once on Atlas (2026-10-29: 4 users).
- The frontend stores the JWT in localStorage (simple; XSS trade-off noted in README).
- Users (`src/users`): UsersService = DB access only; AccountService = rules; UsersController = `/users/me*` (any user) and
  `/users`, `/users/:id`, `/users/:id/role`, `DELETE /users/:id` (`@Roles('admin')`, global `RolesGuard` after JwtAuthGuard).
  Admins can't change their own role or delete themselves via `:id`. Wrong current password = 403 `WRONG_PASSWORD` (not 401).
  First admin: `npm run db:seed-admin` (ADMIN_NAME/EMAIL/PASSWORD in .env; an existing account is promoted, password kept).
- Sessions: JWT carries `tv` = user.tokenVersion; JwtStrategy refuses a mismatch. Password change/reset does `$inc tokenVersion`.
- Password reset: `POST /auth/forgot-password` (always the same answer, even if mail fails) and `/auth/reset-password` (same OTP rules; deletes all the user's codes).
  Change email: `/users/me/change-email` sends a `change_email` code to the NEW address (stored on the OTP row); `/verify` applies it.
- Account delete = ordered deletes (citations -> chat_messages -> otp_codes -> user last), no transaction (test Mongo is standalone).
- OtpService lives in `OtpModule` (shared by AuthModule and AccountModule); password/email/code rules in `src/auth/dto/validators.ts`.
- Frontend account screens: `/forgot-password` (guest), `/profile` (sidebar above Log out), `/admin/users` (`RequireRole role="admin"`;
  Admin nav link only for admins; own row locked). API clients: `api/users.ts` (one function per /users route). Shared: `TextField`,
  `ConfirmDialog`, `Button variant="danger"`, `lib/validation.ts`, `lib/otpErrors.ts`, `hooks/useApiError.ts` (401 -> logout),
  `AuthContext.updateSession`. Logout + navigate together must be wrapped in `startTransition` (React Router navigations are transitions).
- Frontend: Register -> `/verify-otp` (email in router state); login 403 `EMAIL_NOT_VERIFIED` -> `/verify-otp`. `OtpInput` (6 boxes), resend 60 s countdown (`useCountdown`), `getErrorMessage` maps 429 and keeps 503 sentences.

## Chat (done)
- `src/chat`: `POST /chat/ask {question, subjectId?: biology|chemistry|physics|null}` (JWT, 10/min) and `GET /chat/history` (own answered messages, newest 50, oldest first).
- Flow: save `pending` -> RagClient POST `${RAG_SERVICE_URL}/answer` (fetch, 55 s timeout) -> citations rows -> `answered` (+`outOfScope`).
  rag down -> 503 `RAG_UNAVAILABLE`; rag `status:error` -> 503 `AI_NOT_CONFIGURED` / `AI_UNAVAILABLE`; the message is kept as `failed`.
- `renumber.ts`: the frontend links `[n]` to citations[n-1], so `[3][4]` -> `[1][2]`, `[1, 2]` -> `[1][2]`. Sources via chunk -> source_document.
- Tests: `test/chat.db.e2e.spec.ts` overrides `RagClient` with a fake. The chat page shows a coded 503's own sentence.
- Groq retired `llama-3.1-8b-instant` (404, 2026-10-29); the user chose `GROQ_MODEL=qwen/qwen3.8-27b`.

## Rules
- TypeScript `strict` everywhere. No `any` unless unavoidable and commented.
- Secrets live only in the root `.env` (git-ignored). Keep `.env.example` in sync. Never commit `data/`.
- Validate all input: DTOs with class-validator; global ValidationPipe (`whitelist`, `forbidNonWhitelisted`, `transform`).
- Proper error handling: throw Nest HTTP exceptions with clear messages; never leak stack traces or password hashes.
- Keep code simple enough for the students to explain in their defence. Prefer clarity over cleverness; short comments explaining *why*.
- Write unit tests for new logic and run them before saying something works.
- Add or update a README section for each part.
- Do not start features beyond the current prompt.
