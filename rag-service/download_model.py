"""Download the configured embedding model once into EMBED_MODEL_DIR.

    python download_model.py

Which model comes from EMBED_MODEL_NAME (config.py): bge-small-en-v1.5 (default, about 130 MB)
or BGE-M3 (about 2.3 GB). Only the files sentence-transformers needs are fetched (the ONNX copies
and images in the repos are skipped). Re-running resumes a broken download and does nothing if
the model is already complete. Downloading does not load the model into RAM.
"""

from __future__ import annotations

import shutil
import sys

from huggingface_hub import snapshot_download

from config import ConfigError, load_settings
from ingestion.embedding import missing_model_files

# Free disk space needed before starting, by model (the files plus some room)
REQUIRED_FREE_GB = {"BAAI/bge-m3": 3.0}
DEFAULT_REQUIRED_FREE_GB = 0.5


def main() -> int:
    try:
        settings = load_settings()
    except ConfigError as exc:
        print(f"Config error: {exc}")
        return 1

    model, target = settings.embed_model, settings.embed_model_dir
    if not missing_model_files(model, target):
        print(f"{model.name} is already downloaded in {target}")
        return 0

    target.mkdir(parents=True, exist_ok=True)
    need_gb = REQUIRED_FREE_GB.get(model.name, DEFAULT_REQUIRED_FREE_GB)
    free_gb = shutil.disk_usage(target).free / 1e9
    print(f"This downloads {model.name} ({model.dim}-d vectors) from Hugging Face.")
    print(f"Destination: {target} (free space: {free_gb:.1f} GB)")
    if free_gb < need_gb:
        print(f"Not enough disk space: need at least {need_gb} GB free.")
        return 1

    try:
        snapshot_download(
            repo_id=model.name,
            local_dir=target,
            allow_patterns=list(model.files),
        )
    except KeyboardInterrupt:
        print("\nDownload stopped. Run the same command again to resume.")
        return 1
    except Exception as exc:  # network errors come in many types; all get the same advice
        print(f"\nDownload FAILED: {exc}")
        print("Check your internet connection and run `python download_model.py` again;")
        print("finished files are kept, so it resumes where it stopped.")
        return 1

    missing = missing_model_files(model, target)
    if missing:
        print(f"Download finished but these files are missing: {', '.join(missing)}. Run the command again.")
        return 1
    print(f"Done. {model.name} saved in {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
