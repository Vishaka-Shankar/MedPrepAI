# MedPrep AI

An MDCAT preparation platform for Biology, Chemistry and Physics: syllabus-grounded Q&A with citations,
practice quizzes, and a weak-area dashboard ranked by MDCAT weightage.
Final Year Project, SZABIST Karachi (Vishaka Shankar Golani, Sonia Soofi; supervisor Sadia Aziz).

| Part | Tech | Status |
|---|---|---|
| `backend/` | NestJS, TypeScript, Mongoose | Auth + all ERD schemas ✅ |
| `frontend/` | React, Vite, TypeScript | Login/Register + email code verification, protected layout ✅ |
| `rag-service/` | Python 3.12, LlamaIndex, bge-small-en-v1.5 (BGE-M3 selectable), Tesseract, FastAPI, Groq/Ollama | Ingestion pipeline ✅, Q&A service ✅ (`/retrieve`, `/answer`) |
| Database | MongoDB Atlas + Atlas Vector Search | Schemas + indexes + vector index ✅ |

---

## 1. Prerequisites

- Node.js 20+ (tested on 22.17)
- Git
- A MongoDB Atlas cluster (free M0 is fine) with your IP allowed under **Network Access**
- For `rag-service`: Python 3.12 and Tesseract OCR (see `rag-service/README.md`)

## 2. Configuration (`.env`)

There is **one** `.env` file at the repo root, shared by all parts. It is git-ignored.

```bash
cp .env.example .env     # then fill in MONGODB_URI and JWT_SECRET
```

| Variable | Used by | Meaning |
|---|---|---|
| `MONGODB_URI` | backend | Atlas connection string, including the database name (`.../medprep?...`) |
| `JWT_SECRET` | backend | Signs login tokens. At least 32 random characters |
| `JWT_EXPIRES_IN` | backend | Token lifetime, e.g. `1d` |
| `PORT` | backend | API port (default 3000) |
| `FRONTEND_ORIGIN` | backend | The only browser origin allowed by CORS |
| `LOGIN_2FA` | backend | Two-step login: `true` (default) emails a 6-digit login code after the right password; `false` = password only |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | backend `npm run db:seed-admin` | The first admin account (see *Users, roles and password reset*) |
| `VITE_API_URL` | frontend | Where the React app finds the API |
| `MONGODB_URI`, `TESSERACT_CMD`, `OCR_*`, `DATA_RAW_DIR`, `EMBED_*`, `CHUNK_*` | rag-service | Ingestion pipeline settings (table in `rag-service/README.md`) |
| `RAG_SERVICE_URL`, `LLM_PROVIDER`, `GROQ_*`, `OLLAMA_*`, `SIMILARITY_THRESHOLD`, `RETRIEVAL_MARGIN`, `BACKEND_ORIGIN` | rag-service | Q&A service (`rag-service/README.md` section 10) |

The backend checks these at startup (`backend/src/config/env.ts`) and refuses to start with a clear message if one is missing or invalid.

## 3. Database (`backend/src/schemas`, `backend/scripts/db-setup.ts`)

All **17 collections from the ERD** have a Mongoose schema, one file each. See `CLAUDE.md` for the full field table.

- Primary keys are Mongo `_id`; foreign keys are ObjectIds named in camelCase (`subjectId`, `docId`, ...).
- Business rules are enforced in the schema: enums, min/max (e.g. `mastery` 0-1, `susScore` 0-100), and unique keys.
- `topic_mastery.mastery` starts at **0.5** and `topics.weightage` is w_t, matching the diagnostic model in proposal §5.1.
- review_items, cohorts and cohort_members are FYP-II features: schema only.

**Set up the database** (safe to run many times):

```bash
cd backend
npm run db:setup
```

This (1) connects and pings Atlas, (2) creates every collection and its indexes, and (3) creates the
**Atlas Vector Search index**: `db:setup` creates the index described in `rag-service/atlas_index.json`, which is generated from `rag-service/config.py`.
It is `chunk_vector_index_384` on `chunks.embedding384` (384 dimensions for bge-small-en-v1.5, cosine similarity, filterable by `subjectId` and `topicId`).
The old `chunk_vector_index` on `chunks.embedding` (1024-d BGE-M3) stays as a backup until its removal is approved.
`rag-service/setup_vector_index.py` creates the configured model's index, waits for it, and proves it is queryable. The Atlas UI steps are in `rag-service/README.md` section 5.
The app itself does not build indexes on start (`autoIndex: false`), so startup stays fast and predictable.

## 4. Backend: authentication (`backend/src/auth`)

```bash
cd backend
npm install
npm run start:dev        # http://localhost:3000
```

| Method | Route | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/health` | public | | `{ status: "ok" }` |
| POST | `/auth/register` | public | `{ name, email, password }` | 201 `{ message, email }` and an email with a 6-digit code (no token yet) |
| POST | `/auth/verify-otp` | public, 10/min per IP | `{ email, code }` | 200 `{ accessToken, user }` |
| POST | `/auth/resend-otp` | public, 3/min per IP | `{ email }` | 200 `{ message }` (always the same) |
| POST | `/auth/login` | public, 10/min per IP | `{ email, password }` | 200 `{ twoFactorRequired: true, email, message }` and an email with a login code (no token yet); with `LOGIN_2FA=false` 200 `{ accessToken, user }`; 401 generic; **403 `EMAIL_NOT_VERIFIED`** |
| POST | `/auth/login/verify` | public, 10/min per IP | `{ email, code }` | 200 `{ accessToken, user }` (step 2 of login) |
| POST | `/auth/login/resend` | public, 3/min per IP | `{ email }` | 200 `{ message }` (always the same) |
| GET | `/auth/me` | Bearer token | | 200 `{ id, name, email, role, emailVerified }` |

**How it works**
1. **Validation:** `RegisterDto`/`LoginDto` use class-validator. The global `ValidationPipe` trims and lowercases emails, and rejects bad input and unknown fields with **400** (so a user cannot send `role: "instructor"`).
2. **Register:** checks for a duplicate email (**409**), hashes the password with **bcrypt** (cost 10), saves the user as an **unverified** `student`, and emails a code (see *Email verification* below). There is no token until the email is verified.
3. **Login:** finds the user, compares with `bcrypt.compare`, then emails a login code (two-step login, see below); the JWT comes from `/auth/login/verify`. An unknown email and a wrong password give the *same* **401** message, so emails cannot be discovered.
4. **JWT:** payload `{ sub: userId, email, role, tv }`, signed with `JWT_SECRET`, expiring after `JWT_EXPIRES_IN`. `tv` is the user's `tokenVersion` (see *Sessions* below).
5. **Global guard:** `JwtAuthGuard` is registered as `APP_GUARD`, so **every route requires a token by default**. Routes opt out with `@Public()`. `JwtStrategy` verifies the token and loads the user (a deleted user's token stops working).
6. **No secrets leak:** `passwordHash` has `select: false` and is never returned; unknown errors become a generic 500.

**Try it with curl**
```bash
curl -X POST localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Ayesha","email":"ayesha@example.com","password":"secret123"}'
curl -X POST localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ayesha@example.com","password":"secret123"}'          # emails a login code
curl -X POST localhost:3000/auth/login/verify -H "Content-Type: application/json" \
  -d '{"email":"ayesha@example.com","code":"<code from the email>"}'  # returns the token
curl localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"
```

### Email verification (OTP)

**The flow:**
1. `register` emails a 6-digit code. The page then asks for it.
2. `verify-otp` checks it and returns `{ accessToken, user }`.
3. A user who logs in before verifying gets **403** `{ code: "EMAIL_NOT_VERIFIED", email }`, and a fresh code is sent.

**The rules** (`src/auth/otp.service.ts`; codes live in the `otp_codes` collection):
- **Generating codes:** made with `crypto.randomInt`, padded to 6 digits.
- **Storage:** only a **bcrypt hash** is stored, never the code. Codes are never logged either; a test checks every log line.
- **Expiry:** codes expire after **10 minutes**. A TTL index on `expiresAt` makes MongoDB delete them.
- **Attempts:** at most **5 wrong attempts**, then the code is locked (`OTP_LOCKED`). Each answer has a machine-readable `code`: `OTP_WRONG` (with `attemptsLeft`), `OTP_EXPIRED`, `OTP_LOCKED` or `OTP_INVALID`.
- **Single use:** a correct code is marked `usedAt` and never works again.
- **Resend:** has a **60-second cooldown**, and a new code replaces the older ones. It **always gives the same answer**, so it cannot reveal which emails are registered.
- **Rate limits:** `verify-otp` and `resend-otp` are limited per IP with `@nestjs/throttler`.
- **Mail failures:** if the email cannot be sent, the API answers **503** "Couldn't send the email, try again". The reason is logged, the half-created account is removed so registering again works, and the app keeps running.

### Two-step login (2FA, added 2026-11-11)

Logging in needs two things: the **password** (something you know) and a **code emailed to you** (proof you own the inbox).

1. `POST /auth/login` checks the password. If it is right, it emails a 6-digit code with purpose `login` and answers `{ twoFactorRequired: true, email, message }`. **No token yet.**
2. `POST /auth/login/verify { email, code }` checks the code and returns `{ accessToken, user }`.

- **Same code system** as email verification (`OtpService`, `otp_codes` collection): bcrypt-hashed, 10 minutes, 5 wrong attempts then locked, single use. `OTP_PURPOSES` now has `login`, so a verify-email or reset code can never be used to log in.
- **Pressing "Log in" twice** within 60 s keeps the code already sent instead of sending another email.
- **Resend** (`/auth/login/resend`) only sends a code while a login is waiting for one, which means only after the right password. It always gives the same answer. After 5 wrong codes, or after 10 minutes, the user must log in again with the password.
- **Mail failure:** login answers 503 and the unsent code is deleted, so the next try sends a fresh one.
- **Switch:** `LOGIN_2FA=false` in `.env` turns it off (the password alone gives the token, as before), e.g. if email stops working during a demo. Restart the backend after changing it.
- Code: `AuthService.login`, `verifyLogin`, `resendLogin` (`src/auth/auth.service.ts`), `OtpService.hasActive`, routes in `auth.controller.ts`.

**Accounts created before this feature:** run once:
```bash
cd backend
npm run db:mark-verified   # marks users without the emailVerified field as verified; safe to run again
npm run db:setup           # creates otp_codes and its TTL index
```

#### Email setup (SMTP)

Set these in the root `.env`. Without `SMTP_HOST` the app starts with a warning, and registration answers 503.

**Option A: Gmail** (real emails, fine for a demo or pilot):
1. Turn on **2-Step Verification** for the Google account (myaccount.google.com → Security).
2. Create an **App Password** (myaccount.google.com → Security → App passwords, or search "App passwords"). Name it "MedPrep AI" and copy the 16-character password.
3. Fill in `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your.address@gmail.com
   SMTP_PASS=the 16-character app password (no spaces)
   MAIL_FROM=MedPrep AI <your.address@gmail.com>
   ```
   Gmail only sends "from" the account itself, so leave `MAIL_FROM` empty to use `SMTP_USER`. Never use your normal Gmail password.

**Option B: Mailtrap or Ethereal** (development: emails are caught in a web inbox, never delivered):
- **Mailtrap:** sign up at mailtrap.io, open **Email Testing → Inboxes → SMTP Settings**, and copy the host (`sandbox.smtp.mailtrap.io`), port (`587` or `2525`), user and password into `.env`.
- **Ethereal:** open ethereal.email and click **Create Ethereal Account**. Use host `smtp.ethereal.email`, port `587`, and the generated user and password. Sent messages appear under **Messages** on the site.
  You can also create the account in code with nodemailer's `createTestAccount()`. With Ethereal, the backend logs
  `Ethereal preview (dev only): https://ethereal.email/message/...` after each email; open it to read the code.
  (Real servers like Gmail never produce this line.)

Mailtrap's user is a username, not an address, so with `MAIL_FROM` empty the sender becomes `MedPrep AI <no-reply@medprep.local>`.

If the mail server can't be reached, sending gives up after about 10-15 seconds (`SMTP_TIMEOUTS` in `mail.service.ts`) and the user gets the 503 "Couldn't send the email, try again" instead of a request that hangs for minutes.

On start the backend logs `Mail: sending through <host> as <masked sender>`. In tests (`NODE_ENV=test`) a mock transport keeps emails in memory, so tests never send real mail.

**Troubleshooting: "Invalid email or password" after registering, or "database is not reachable"**

Almost always the database, not the password. Read the backend log:
- `Database: medprep on <cluster>`: the startup log shows which database is used (never the password).
- `[Database] MongoDB connection error: ... tlsv1 alert internal error`, or `Could not connect to any servers in your MongoDB Atlas cluster`: **Atlas is refusing this computer's IP address.** In Atlas, go to **Network Access → + Add IP Address → Add Current IP Address → Confirm**, wait about 1 minute, and restart the backend. Your public IP changes when the router or network changes.
- `getaddrinfo ENOTFOUND ...mongodb.net`: there is no internet or DNS.
- `Login failed: no account for a***@example.com`: that email was never registered. For example, the registration happened while the database was unreachable.
- `Login failed: wrong password for user <id>`: the account exists and the password is wrong.

How the backend behaves when the database is unreachable:
- It answers **503 "The database is not reachable right now..."** within about 5 s (`serverSelectionTimeoutMS: 5000`, `bufferCommands: false`, `DatabaseUnavailableFilter`).
- The client never gets a generic 500, and never a misleading 401.
- Users still get one generic login message; the server log records which case it was.

`test/auth.db.e2e.spec.ts` checks the whole flow on a real throwaway MongoDB (`mongodb-memory-server`, no Atlas needed): register, row in `users` with a bcrypt hash, login, the same 401 for a wrong password and an unknown email, and 503 when the database is down.

### Users, roles and password reset (`src/users`, `src/auth`)

| Method | Route | Auth | Role | Body / query | Response |
|---|---|---|---|---|---|
| POST | `/auth/forgot-password` | public, 3/min per IP | | `{ email }` | 200 `{ message }` (always the same) |
| POST | `/auth/reset-password` | public, 10/min per IP | | `{ email, code, newPassword }` | 200 `{ message }` |
| GET | `/users/me` | token | any | | the caller's profile |
| PATCH | `/users/me` | token | any | `{ name }` | the updated profile |
| PATCH | `/users/me/password` | token | any | `{ currentPassword, newPassword }` | `{ message, accessToken }` |
| POST | `/users/me/change-email` | token, 3/min | any | `{ newEmail, password }` | 200 `{ message, email }`; code sent to the **new** address |
| POST | `/users/me/change-email/verify` | token, 10/min | any | `{ code }` | 200 `{ message, user }` |
| DELETE | `/users/me` | token | any | `{ password }` | `{ message }` |
| GET | `/users` | token | admin | `?page=1&limit=20&search=` (limit max 50) | `{ items, page, limit, total, totalPages }` |
| GET | `/users/:id` | token | admin | | a profile, or 404 |
| PATCH | `/users/:id/role` | token | admin | `{ role: "student" or "admin" }` | the updated profile |
| DELETE | `/users/:id` | token | admin | | `{ message }` |

**Roles.** `@Roles('admin')` on a route, checked by `RolesGuard`. It is registered globally right after `JwtAuthGuard`, so it always sees the logged-in user. A student gets **403**.
`request.user` is loaded from the database on every request, so a role change takes effect immediately.
An admin **cannot change their own role or delete themselves** through `/users/:id` (403). This also means the last admin can never demote themselves away.

**The first admin:**
1. Set `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the root `.env`. The password must be 8-72 characters with a letter and a number.
2. Run:
   ```bash
   cd backend
   npm run db:seed-admin   # creates the admin with emailVerified=true; safe to run again
   ```
   If an account with that email already exists, it is promoted to admin and **keeps its own password**. The script prints only the masked email.

**Password rules and errors.** Every new password (register, change, reset) is 8-72 characters with a letter and a number (`src/auth/dto/validators.ts`). It is hashed with bcrypt, cost 10.
- **Wrong current password:** `PATCH /users/me/password`, `change-email` and `DELETE /users/me` answer **403** `{ code: "WRONG_PASSWORD" }`. Not 401, because the user *is* logged in; a 401 would look like an expired session.
- **Reusing the current password:** 400.
- **Email already in use:** 409.
- **Unknown or malformed `:id`:** 404.
- **Login:** still gives the one generic 401 message.

**Sessions (token versions).**
- Every user has a `tokenVersion` (starts at 0), and every JWT carries it as `tv`. `JwtStrategy` refuses a token whose `tv` differs (**401** "Your session has ended...").
- Changing or resetting the password adds 1, which logs out **every** existing session.
- The change-password response includes a fresh `accessToken`, so the device that made the change stays logged in.
- Tokens made before this feature have no `tv` and count as version 0, so nobody was logged out by the upgrade.

**Change email** (two steps, like registration):
1. `change-email` checks the password, rejects an address already in use (409), and emails a code (purpose `change_email`) to the **new** address. The new address is stored with the code. The email is trimmed and lowercased.
2. `change-email/verify` applies the change. It checks again for 409, in case someone registered the address in the meantime.

The same OTP rules apply as for verification: 10 minutes, 5 attempts then locked, single use, and a 60 s cooldown (429).

**Password reset:**
- **`forgot-password`** always gives the same answer. If the email can't be sent, it still answers 200 (the reason is logged), because a 503 would reveal that the account exists.
- **`reset-password`** uses the same expiry, attempt and lock rules as `verify-otp`. On success it:
  - sets the new hash and adds 1 to `tokenVersion`
  - deletes **all** of the user's other codes
  - marks the email verified, since the code reached their inbox

**Deleting an account** (`DELETE /users/me`, or an admin's `DELETE /users/:id`) removes, in this order:
1. the citations of the user's chat messages
2. `chat_messages`
3. `otp_codes`
4. the user, **last**

These are **ordered deletes, not a transaction**. Atlas supports transactions, but the throwaway test MongoDB is a standalone server that doesn't. Deleting the user last means a failure halfway leaves the account in place, so simply retrying finishes the job, and nothing ever points to a deleted user.
Other collections that belong to a user (quiz sessions, attempts, mastery) are empty for now and are not deleted yet.

`test/users.db.e2e.spec.ts` covers every route on a throwaway MongoDB:
- success paths, 400/401/403/404/409/429
- students blocked from admin routes
- old sessions refused after a password change or reset
- the delete cascade, the admin seed, and that no code or password appears in the logs

### Chat (`src/chat`)

`POST /chat/ask` and `GET /chat/history` both need a JWT (global guard), and every user sees only their own messages. NestJS stores the chat; the rag-service (`RAG_SERVICE_URL`, default `http://localhost:8000`) answers.

**`POST /chat/ask { question, subjectId? }`**
- **Input:** `question` is 1–1000 characters after trimming. `subjectId` is `"biology"`, `"chemistry"`, `"physics"`, or null/missing for all subjects. Anything else gets a 400, and the rag-service is never called.
- **Rate limit:** 10 per minute (each question costs an LLM call).
- **Flow:**
  1. The question is saved to `chat_messages` as `pending`, with `inputMode: "text"`.
  2. The rag-service's `POST /answer` is called. The subject key becomes the subject's ObjectId (found by its code, e.g. `PHY`). The call times out after 55 s, below the frontend's 60 s.
  3. If the answer is ok, one `citations` row per source is saved (`chatMessageId`, `chunkId`, `page`, `snippet`) and the message becomes `answered`.
  4. If it's out of scope, the message becomes `answered` with `outOfScope: true` and no citations, and the response has `refused: true`.
- **Citation numbers:** the chat page links `[n]` to the n-th citation, so the backend renumbers what the rag-service returns. `[3][4]` becomes `[1][2]`, and `[1, 2]` becomes `[1][2]` (`renumber.ts`).
- **Errors:** the message is kept as `failed`, is never shown in the history, and the user gets a **503** with a `code` and a sentence. The chat page shows that sentence.

  | Problem | 503 `code` | Message |
  |---|---|---|
  | rag-service not running or timed out | `RAG_UNAVAILABLE` | "The question-answering service is not running or cannot be reached…" |
  | `GROQ_API_KEY` empty | `AI_NOT_CONFIGURED` | "The AI tutor is not set up yet: GROQ_API_KEY is empty…" |
  | LLM timeout or outage | `AI_UNAVAILABLE` | "The AI tutor took too long to answer…" |

**`GET /chat/history`** returns the user's 50 newest **answered** messages, oldest first. Each has its citations; the source file name is looked up through chunk → source_document, and a deleted chunk shows "Unknown source".

**Two fields beyond the ERD:** `chat_messages` gains `subjectId` (FK to subjects, null = all) and `outOfScope` (boolean). The chat page shows the subject and the refusal style in the history too. Deleting an account already removes its citations and chat messages.

**Running everything:**
```powershell
cd rag-service; .venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8000   # Q&A service
cd backend; npm run start:dev                                                                   # API on :3000
cd frontend; npm run dev                                                                        # http://localhost:5173
```

## 5. Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

- **Pages:**
  - Login, Register, Verify email and Forgot password (public)
  - **Profile** for everyone, and **Admin → Users** for admins (below)
  - **Chat** (below)
  - **Quiz** and **Dashboard**: built from the designs with typed mock data (see below); their real APIs come in M5 and M6
  - Videos and Feedback: "Coming soon" cards
- **`AuthLayout`** (`src/components/layout`, added 2026-11-06): the frame of Login, Register, Verify email and Forgot password. A navy brand panel on the left ("Your MDCAT prep, all in one place." and three FYP-I points from the SRS: REQ-PRQ-4 cited explanations, REQ-PRQ-1 past papers by subject/topic/year, 4.5 explainable priorities) and the form on the right. Login and Register have a **Log in / Sign up** switch; Login says "Welcome back" with "Forgot password?" next to the Password label, and Register's button is "Create account". Below 900 px only the logo stays above the form.
- **`AuthContext`:** holds the logged-in user. On page load it calls `/auth/me` with the saved token; an expired token is discarded.
- **`ProtectedRoute`:** logged-out users are sent to `/login`, and after logging in they return to the page they wanted (`/chat` by default). **`GuestOnlyRoute`** sends logged-in users away from Login, Register, Verify and Forgot password.
- **Email verification (`/verify-otp`, `pages/VerifyOtpPage.tsx`):**
  - Register no longer logs in: on success it opens `/verify-otp` with the email (React Router state).
  - Login answered with 403 `EMAIL_NOT_VERIFIED` also opens `/verify-otp` (the server has just emailed a code); after verifying, the user returns to the page they first asked for.
  - **Two-step login:** when `/auth/login` answers `{ twoFactorRequired: true }`, Login opens the same page with `purpose: 'login'`. It then says "Enter your login code", the button says "Log in", and it calls `/auth/login/verify` and `/auth/login/resend` (`AuthContext.verifyLogin`, `resendLogin`). A locked, expired or invalid login code says "Please log in again to get a new code", and the footer link goes back to Login.
  - `components/ui/OtpInput.tsx`: six digit boxes; typing moves to the next box, Backspace on an empty box goes back, pasting `123456` (or `123 456`) fills them all, and phone "one-time code" autofill works.
  - A "Resend code" button with a 60 s countdown (`hooks/useCountdown.ts`), and a hint that codes expire after 10 minutes.
  - Errors: `OTP_WRONG` shows the attempts left; `OTP_EXPIRED`, `OTP_LOCKED` and `OTP_INVALID` say to press "Resend code" (the boxes are emptied). A 503 or 429 keeps the digits, so pressing Verify again just works.
  - On success the token is saved and `GuestOnlyRoute` opens `/chat`.
- **Error messages (`api/client.ts` `getErrorMessage`):** 429 becomes "Too many attempts. Please wait a minute and try again."; a 503 shows the server's own sentence (e.g. "The database is not reachable right now. Please try again in a minute."); a bare 500 and timeouts get a friendly retry sentence instead of a crash.
- **Account screens** (typed clients: `api/users.ts` has one function per `/users` route; `api/auth.ts` adds `forgotPassword` and `resetPassword`):
  - **Forgot password** (`/forgot-password`, linked from Login as "Forgot password?"):
    1. Email: the server gives the same answer whether or not the account exists.
    2. Code (6 boxes) + new password + confirm, with "Send a new code" after 60 s.
    3. Success opens Login with the server's message and the email filled in.
  - **Profile** (`/profile`, in the sidebar above Log out; on phones in the top bar):
    - Shows name, email and role, with a form to edit the name.
    - **Change password:** saves the fresh token the server returns, so this tab stays logged in while other devices are logged out.
    - **Change email:** step 1 sends a code to the new address; step 2 is the code box. Nothing changes until the code is entered.
    - **Delete account:** a confirmation dialog that asks for the password. Success clears the token and opens Register with "Your account has been deleted."
  - **Admin** (`/admin/users`):
    - Only admins see the "Admin" link. `RequireRole` sends everyone else to `/chat`, and the backend refuses non-admins with 403 anyway.
    - A table with search (name or email), Previous/Next pagination (10 per page), a role dropdown (Student/Admin) and Delete with a confirmation dialog.
    - The admin's own row is locked (dropdown and Delete disabled, with a note why), matching the backend rule.
  - **Shared pieces:**
    - `components/ui/TextField.tsx`: label, hint and error tied to the input with `aria-describedby` and `aria-invalid`.
    - `components/ui/ConfirmDialog.tsx`: a modal with `role="dialog"`. Focus moves inside, Tab stays inside, Escape cancels, and focus returns to the button that opened it.
    - `lib/validation.ts`: the backend's password, email and name rules.
    - `lib/otpErrors.ts`: one wording for code errors on every code screen.
    - `hooks/useApiError.ts`: turns an error into a sentence; on 401 it logs out with the reason (e.g. the password was changed on another device).
  - **Errors:**
    - 409 says the email is used by another account (on the email field).
    - A wrong current password (403 `WRONG_PASSWORD`) shows on the password field.
    - 429 becomes "Too many attempts...". 503 shows the database sentence and the form keeps its input, so the user can retry.
    - Buttons are disabled while a request runs.
- **`AppLayout`** (`src/components/layout`): a fixed 232 px navy sidebar with the logo (`components/ui/Logo.tsx`), five sections (plus Admin for admins), and at the bottom the user's initial and name with **Profile · Log out**; the main area scrolls on its own, with a 1200 px max width. **Below 768 px** the sections become a bottom tab bar, and the wordmark, Profile and Log out move to a slim top bar.

### Design system (`src/styles`, `src/components/ui`)

The visual design is **direction A "Clinical"** (chosen 2026-11-06 from two directions drawn for every screen): the navy and teal of the first mockups in `docs/design/`, with thin card borders instead of shadows, 10 px buttons, a segmented subject switch, tables for data, and the Inter font (loaded in `index.html`; without internet the system font is used). Styling is plain CSS with no UI library and no Tailwind:
- **`styles/tokens.css`:** every colour, radius, shadow, font and spacing as a CSS variable. The colours were sampled from the mockup pixels.
- **`styles/global.css`:** base element styles, one visible focus ring for everything, and `.sr-only`.
- **`*.module.css`:** each component's own styles, scoped to that component (CSS modules).

| Token | Value | Used for |
|---|---|---|
| `--color-sidebar` / `--color-sidebar-active` | `#0B2545` / `#1B3A6B` | sidebar, selected item, question bubbles, active pill |
| `--color-bg` / `--color-surface` | `#F6F8FB` / `#FFFFFF` | page background / cards (14 px radius) |
| `--color-border-soft` / `--color-surface-muted` | `#E2E8F0` / `#EEF1F6` | card edges and dividers / segmented-switch track, table rows |
| `--color-primary` | `#0C7C7C` | buttons, progress, strong mastery |
| `--color-text` / `--color-text-muted` | `#0F1F3D` / `#55627A` | text / secondary text |
| `--color-amber-bg` / `-text` | `#FDE8C8` / `#6B3E00` | weak-topic tile |
| `--color-teal-soft-bg` / `-text` | `#D5EDEE` / `#0A4F52` | fair-topic tile |
| `--color-correct-*` | bg `#E3F4EA`, border `#2E8B57`, text `#14573A` | correct quiz answer |
| `--color-incorrect-*` | bg `#FDECEC`, border `#C0392B`, text `#7A1812` | incorrect quiz answer |

**Reusable components** (`src/components/ui`):
- `Button`: primary (teal) or outline (white, grey border); always a real `<button>`, `type="button"` by default. `buttonClass()` gives a `<Link>` the same look.
- `Pill`: default, active or outline. It becomes a toggle `<button aria-pressed>` when clickable.
- `Card`: white with a thin border, or navy (the dashboard's Next up).
- `Logo`: the teal book-and-plus mark with the wordmark, on navy or on white.
- `ProgressSegments`: segmented bars with `role="progressbar"`.
- `EmptyState`.

**Accessibility:**
- Every text/background pair is **at least 4.5:1** (checked by calculation; the lowest is 4.7:1).
- Focus rings are visible, and light teal on navy.
- Colour is never the only signal: quiz options say "Correct answer" or "Your answer (incorrect)", the quiz navigator buttons are named "Question 3, incorrect", and mastery bars show the % plus a screen-reader level (Weak, Fair, Strong).

### Quiz and Dashboard (mock data, ready for the API)

These pages follow direction A (above). They are **not backed by the API yet**, so each shows a small "Sample data" label.

**How the data flows** (so the mock can be swapped for the API without touching the pages):
```
src/types/quiz.ts, dashboard.ts       typed shapes (QuizData, DashboardData)
src/mocks/quiz.ts, dashboard.ts       typed mock data + loadMock...(): Promise<data>
src/hooks/useQuizData.ts              one data hook per page -> { data, loading, error, reload }
src/hooks/useDashboardData.ts         (built on useAsyncData)
```
To use the API later, change the loader inside `useQuizData` / `useDashboardData` to an API call returning the same type, and set `QUIZ_IS_SAMPLE` / `DASHBOARD_IS_SAMPLE` to false.

**Quiz** (`/quiz`):
- **Header card:** "Biology · Cell transport · Past paper (2024)", "Question n of 10", a timer (counts down from the mock data, display only) and a segmented progress bar (teal = done, navy = current, grey = remaining).
- **Options A to D:** letter badges; neutral until answered. After answering, the wrong choice is red with **"Your answer (incorrect)"** and the right one is green with **"Correct answer"**. The words are always shown, so colour is not the only signal.
- **Explanation card:** "Why C is correct" with the text and a source chip, plus **Watch to revise** (video title as a placeholder link, channel and duration).
- **Navigator** (right, below the question on phones): buttons 1 to 10 coloured by right, wrong or skipped, the current one outlined. You can jump to any question up to the furthest one reached; later ones are disabled.
- **Footer:** Previous, **Skip** and Next question. **Skip** (added 2026-11-06) is for a question the student does not know: it moves on without answering, so no attempt is recorded and the score is unaffected. The navigator marks it **skipped** (dashed amber) and the student can go back and answer it; "n of m correct · k skipped" sits above the navigator. Skipping the last question opens the results, which say how many were skipped and offer **Answer skipped questions**. Skip is disabled once a question is answered.
- **Keyboard:** **A to D** answer; **S** skips; **Enter** goes to the next question. Enter is ignored while a button has focus, because the browser already clicks that button.

**Dashboard** (`/dashboard`):
- **Header:** the "Sample data" label and "Good morning/afternoon/evening, <name>".
- **Summary cards:** Accuracy (64%, "82 of 128 answers correct"), Topics practised, **Weak topics** (mastery below 0.5) and **Strongest topic**.
- **Study priorities table:** every topic with enough data, ranked by **P = weightage × (1 − mastery)** (proposal 5.1), **computed from the data** in `src/lib/mastery.ts`. Each row: rank, topic with its subject and a one-line reason ("Heavily tested, mastery low"), a mastery bar (orange below 0.5, teal otherwise, the % always written), attempts and the score. 6 rows, then **Show all**. Topics with fewer than 5 attempts are never ranked; the table's footer names them.
- **Next up** (navy card): the top priority topic with its reason and "Start 10 questions" (links to `/quiz`); **Practise top 3 topics** at the top right links there too.
- **By subject:** average mastery of each subject's ranked topics (`subjectAverages()`).
- The colour rule is still **one helper**, `masteryTone()`: below 0.5 weak, 0.5 to below 0.7 fair, 0.7 or more strong, fewer than 5 attempts "Insufficient data".
- **API client (`src/api/client.ts`):** one axios instance that attaches `Authorization: Bearer <token>` and turns server errors into readable messages.
- The register form checks the same rules as the backend for instant feedback; the backend still validates everything.
- **Token storage:** the JWT is kept in `localStorage`. This is simple, but any XSS bug could read it. An httpOnly cookie is the stronger option for production.

### Chat page (`src/pages/ChatPage.tsx`)

Direction A (above). It calls the real backend through `src/api/chat.ts`.

**Layout:**
- **Header:** "Ask the syllabus" / "Answers come only from your MDCAT books, with page references." with the subject switch on the right (one segmented control; **All** is the default).
- **Your questions:** navy bubbles on the right, with the subject as a small teal tag above.
- **Answers:** white cards with a teal **"Grounded in N sources"** line and a **Copy answer** button (copies the answer and its sources as text).
- **Sources panel** (`components/chat/SourcesPanel.tsx`, 1100 px and wider): the sources of one answer next to the conversation, the newest cited answer by default. A `[n]` mark selects its answer (teal outline) and highlights that source; a source opens the citation panel. Narrower screens keep the list under each answer.
- **Input:** "Your question" box pinned to the bottom, in one bordered card with the Send button; the placeholder names the selected subject. **Enter** sends; **Shift+Enter** starts a new line. **Send** is disabled while the box is empty or an answer is loading.

**Citations:**
- Every `[n]` in the answer is a highlighted, clickable mark.
- Under the answer, rows show "**[n] Biology XI** · page 87" with the snippet underneath. File names become the names students know; see `sourceLabel`.
- Below 1100 px, a mark and its row open the **same citation panel** (`CitationPanel.tsx`): a **side panel** on desktop and a **bottom sheet** on phones, with source, page, file name and the full snippet.
- Keyboard: focus moves to Close, **Escape** closes the panel, and focus returns to the mark or row that opened it.

**Subject filter and suggested questions** (`src/lib/chatSubjects.ts`, added 2026-11-06):
- The pills filter the conversation too, not only the subject a new question is sent with. A question belongs to the subject it was asked with; a question asked under **All** belongs to the subjects of the textbooks its answer cites (Biology XII -> Biology). A refused question cites nothing, so it only shows under All. Nothing is filtered on the server: the history is loaded once and filtered in the page.
- Each pill has its own suggested questions (`src/lib/suggestions.ts`): a pool of 10 per subject, each answered by a page of the ingested books. Three are shown, picked at random each time the page opens (one seed per visit, so the chips don't jump while you use the page); **All** shows one per subject, and questions you already asked are left out. To add one, check it first with `python -m app.search "..." --subject <subject>`. With no questions for the selected subject, they show as cards ("No Physics questions yet"); otherwise as small chips above the question box. A click asks the question with the selected subject.
- `sourceLabel` names all four years of books: "STBB_Physics_IX.pdf" -> "Physics IX".

**Out of scope:** the API's text (e.g. "I couldn't find this in the syllabus material. Try rephrasing, or pick a subject.") is shown in a dashed light-grey bubble, with **no** "Grounded" pill and no citations.

**States:**
- **Loading:** a typing-indicator bubble (three dots).
- **Error or timeout:** a friendly error bubble with **Retry**, which resends the same question and subject. The question also stays in the input box.
- **Session expired (401):** you are sent to the login page with a notice.
- **History:** loaded on opening, then the page auto-scrolls to the newest message.
- **Reduced motion:** with prefers-reduced-motion, the scroll is instant and the dots and panel do not animate (`global.css` plus each component).

**API contract** (`src/api/chatTypes.ts`), served by the backend's ChatModule (section 4, Chat). A 503 with a `code` (e.g. `AI_NOT_CONFIGURED`) shows the backend's own sentence; other failures show the generic "can't reach the answer service" bubble.
```
GET  /chat/history                        -> ChatMessage[] (oldest first)
POST /chat/ask { question, subjectId }    -> ChatMessage      (timeout 60 s)
     subjectId: "biology" | "chemistry" | "physics", or null for All
ChatMessage = { id, question, subjectId, answer, refused, citations: [{ source, page, snippet }], createdAt }
```
The answer text refers to citations as `[1]`, `[2]`, ..., in list order. `refused: true` means out of scope.

**Mock mode (no backend chat, no rag-service needed).** Run `npm run dev:mock`, or set `VITE_USE_MOCK=true` and use `npm run dev`.
- `src/api/mockChat.ts` returns fake answers with `[n]` marks and citations. A small **"Dev: mock API"** tag shows next to the subtitle; the page never says "Sample data".
- The mock conversation survives a page reload (sessionStorage).
- **Demo triggers:**
  - "cricket" gives an out-of-scope answer.
  - "test error" simulates the service being down.
  - "test timeout" simulates a timeout.
  - "test expired" simulates an expired session.
- **Safety:** the mock only works on the dev server (`import.meta.env.DEV`). A production build never contains it.
- **Login is still real:** mock mode only replaces the chat API, so the backend must be running.

## 6. Tests

```bash
cd backend  && npm test     # 150 tests: two-step login (code emailed after the right password, no token until /auth/login/verify, wrong/locked code, resend only while a login waits, mail failure, LOGIN_2FA switch, hashed login codes on a real MongoDB), chat on a real MongoDB (auth required, saves message + citations renumbered [1]..[n], out of scope, rag down / AI key missing -> 503 + failed, validation, user isolation in history, 50 limit, Unknown source, account delete), RagClient (timeout, down, 503 sentence), renumbering, RAG_SERVICE_URL, atlas_index.json shape + 384-d index, + users CRUD, roles, change email, password reset, sessions, delete cascade, admin seed on a real MongoDB, + OTP on a real MongoDB (one email per sign-up, verify, attempts, lock, expiry, resend cooldown, 403 unverified, hashed codes, no codes in logs, throttling), + real-MongoDB auth e2e (register -> row -> login -> generic 401 -> 503 when DB down), env validation, DTO rules, guard, AuthService, schemas, full HTTP auth flow
cd frontend && npm test     # 154 tests: two-step login (Login -> code screen, /auth/login/verify, locked code -> log in again, resend), quiz Skip, auth layout copy + Log in/Sign up switch, chat Sources panel + Copy answer, dashboard table + summaries, quiz navigator, chat subject filter + random per-subject suggestions, coded 503 sentence on the chat page, forgot password (link, steps, validation tied to inputs, wrong/expired code, 503 retry, 429), profile (edit name, change password: fresh token, wrong current password on its field, reuse, 401 logout; change email 409 -> code -> done; delete dialog: focus, Cancel/Escape, wrong password, 503, success -> Register), admin (role guard, own row locked, role change, confirmed delete, search, pagination, 503 retry), OTP boxes (typing, paste, Backspace), resend countdown, verify errors (wrong/expired/locked/invalid, 503 retry), register -> verify -> chat, login 403 -> verify, 429/503 messages, mastery colours (0.5 / 0.7 boundaries), priorities, insufficient data, quiz keyboard, data hook, chat API requests (subjectId), citation panel, out of scope, retry/timeout, UI components, Quiz, Dashboard priorities (P = w(1-M)), navigation, routes and auth, form validation, Chat page (send, Enter/Shift+Enter, history,
                            #   citations, refusal style, service down, session expired, retry), mock API
cd rag-service && .venv\Scripts\python.exe -m pytest   # 196 tests: citation snippets (claim-matched, noise/heading skipped, <= 200 chars), Q&A service (answer + citations, out of scope without an LLM call, threshold/margin, Groq retry/timeout, empty key, API, CORS, lazy model), junk filter, syllabus re-ranking, cleaning, chunking, OCR page choice, subjects, page cache, progress, embedding config, dimension check, retrieval, re-embed (resume, no duplicates, low-memory pause; fake embedder, local mongod), storage estimate
```

Backend tests need **no database**: `test/in-memory-users.service.ts` replaces MongoDB with an array, while the real
controllers, ValidationPipe, global guard and JWT strategy run unchanged (`test/auth.http.spec.ts`).

## 7. rag-service (`rag-service/`)

**Content ingestion pipeline (M2):** PDFs in `data/raw/<biology|chemistry|physics>/` are processed as follows:
1. Text is extracted per page; scanned pages are read with Tesseract OCR.
2. The text is cleaned.
3. It is split into ~500-token LlamaIndex chunks.
4. Each chunk is embedded with the configured model: bge-small-en-v1.5 (384 dims) by default; BGE-M3 (1024 dims) can be selected with `EMBED_MODEL_NAME`.

   **A deviation from the proposal, on purpose:** the proposal names BGE-M3. This laptop has 8 GB of faulty RAM, and BGE-M3 (about 2.3 GB in RAM) caused repeated blue screens during ingestion. bge-small (about 130 MB) ingested all the books without a crash.
   - **Trade-off:** English-only, 384 instead of 1024 dimensions, and weaker than BGE-M3 on public benchmarks. We haven't measured the difference on our own data yet.
   - **For comparison:** 621 chunks keep their BGE-M3 vectors and their 1024-d index.
   - **Switching back is a config change** plus re-embedding. Details and steps: `rag-service/README.md` section 11.

5. Junk chunks (scraps under 100 characters, the books' copyright page and preface) are left out.
6. Chunks are stored in Atlas (`source_documents`, `chunks`). Re-running never creates duplicates, thanks to the `fileHash` and `contentHash` unique keys.

```powershell
cd rag-service
.venv\Scripts\python.exe ingest.py --all
.venv\Scripts\python.exe check_db.py --show 3
```

The 723 chunks already stored (BGE-M3) get bge-small vectors with `scripts/reembed_chunks.py`. It reads their stored text, so there is no OCR; it is resumable and RAM-guarded (`rag-service/README.md` section 9).

Setup, every step explained, the settings and the measured performance are in **`rag-service/README.md`**.

**Q&A service (M4):**
- Start it: `.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8000`.
- Endpoints: `GET /health`, `POST /retrieve`, `POST /answer` (grounded answer with `[n]` citations, or `out_of_scope` without calling the LLM).
- Command-line search: `python -m app.search "question" --subject biology`.
- A real answer needs `GROQ_API_KEY` in `.env`.
