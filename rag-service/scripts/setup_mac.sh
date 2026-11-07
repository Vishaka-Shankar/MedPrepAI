#!/usr/bin/env bash
# One-time macOS setup for rag-service ingestion, plus moving the 9th/10th books into data/raw.
# Safe to run again: every step checks whether it is already done.
#
#   cd ~/Downloads/MedPrepAI-main
#   bash rag-service/scripts/setup_mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."                  # rag-service/
SERVICE="$PWD"
ROOT="$(dirname "$SERVICE")"
say() { printf '\n== %s\n' "$*"; }

say "Free disk space"
free_gb=$(df -g "$ROOT" | awk 'NR==2 {print $4}')
echo "${free_gb} GB free"
if [ "$free_gb" -lt 3 ]; then
  echo "At least 3 GB must be free (Python packages ~1.5 GB, model ~130 MB, OCR page cache). Free some space and run again."
  exit 1
fi

say "Homebrew tools (Tesseract OCR, Python 3.12)"
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed. Install it from https://brew.sh, then run this script again."
  exit 1
fi
BREW="$(brew --prefix)"
[ -x "$BREW/bin/tesseract" ] || brew install tesseract
[ -x "$BREW/bin/python3.12" ] || brew install python@3.12
"$BREW/bin/tesseract" --version | head -1

say "Python environment (rag-service/.venv)"
[ -x .venv/bin/python ] || "$BREW/bin/python3.12" -m venv .venv
# requirements.txt pins the Windows CPU build (torch==...+cpu) from the PyTorch CPU index.
# macOS uses the normal PyPI build of the same version, so that line is swapped here.
TORCH="$(grep -E '^torch==' requirements.txt | sed -E 's/\+cpu//; s/[[:space:]].*//')"
grep -vE '^torch==|^--extra-index-url' requirements.txt > .venv/requirements-mac.txt
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install "$TORCH" -r .venv/requirements-mac.txt

say "Root .env"
ENV_FILE="$ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  echo "Created .env from .env.example."
fi
if grep -q '^TESSERACT_CMD=' "$ENV_FILE"; then
  sed -i '' "s|^TESSERACT_CMD=.*|TESSERACT_CMD=$BREW/bin/tesseract|" "$ENV_FILE"
else
  printf '\nTESSERACT_CMD=%s\n' "$BREW/bin/tesseract" >> "$ENV_FILE"
fi
echo "TESSERACT_CMD=$BREW/bin/tesseract"

say "Textbooks (9th and 10th) -> data/raw/<subject>/"
RAW="$ROOT/data/raw"
mkdir -p "$RAW/biology" "$RAW/chemistry" "$RAW/physics"
move_book() {
  src="$HOME/Downloads/$1"; dst="$RAW/$2"
  if [ -f "$dst" ]; then echo "already in place: data/raw/$2"
  elif [ -f "$src" ]; then mv "$src" "$dst"; echo "moved: $1 -> data/raw/$2"
  else echo "NOT FOUND: ~/Downloads/$1 (skipped)"; fi
}
move_book "Biology IX.pdf"   biology/STBB_Biology_IX.pdf
move_book "Biology X.pdf"    biology/STBB_Biology_X.pdf
move_book "Chemsitry IX.pdf" chemistry/STBB_Chemistry_IX.pdf
move_book "Chemsitry X.pdf"  chemistry/STBB_Chemistry_X.pdf
move_book "Physics IX.pdf"   physics/STBB_Physics_IX.pdf
move_book "Physics X.pdf"    physics/STBB_Physics_X.pdf

if grep -q '^MONGODB_URI=.*<user>' "$ENV_FILE"; then
  say "One manual step left"
  echo "Open $ENV_FILE and replace the placeholder values with the ones from your partner's .env"
  echo "(at least MONGODB_URI; keep EMBED_MODEL_NAME=BAAI/bge-small-en-v1.5 and the TESSERACT_CMD line above)."
  echo "Then run this script again to download the embedding model."
  exit 0
fi

say "Embedding model"
.venv/bin/python download_model.py

say "Setup complete. Next:"
cat <<NEXT
  cd "$SERVICE" && source .venv/bin/activate
  python ingest.py --file ../data/raw/biology/STBB_Biology_IX.pdf --pages 1-20   # quick test
  caffeinate -i python ingest.py --all                                           # all books (1-2 h)
  python check_db.py --show 3
NEXT
