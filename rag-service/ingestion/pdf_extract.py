"""Per-page text extraction: the PDF's own text layer when it holds the page's text,
Tesseract OCR otherwise.

PyMuPDF reads the text layer and also renders a page to an image for OCR,
so no extra tool (like Poppler) has to be installed.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import pymupdf
import pytesseract
from PIL import Image, ImageOps

from ingestion.chunking import PageText

log = logging.getLogger(__name__)

A4_WIDTH_INCHES = 8.27
# OCR text replaces the text layer only if it holds clearly more text (20% more letters)
OCR_MUST_BEAT_TEXT_LAYER = 1.2

# Upside-down and sideways scans. Physics IX has 92 pages scanned upside-down; OCR read them as
# "palqo ue Jo 3}e}s ay}..." ("...the state of an object", backwards). Normal OCR'd prose has about
# 0.3 of its words in COMMON_WORDS, those pages about 0.02. Below LOOKS_ENGLISH we ask Tesseract's
# orientation detector (OSD) how the page is turned, turn it upright and read it again.
COMMON_WORDS = frozenset("the of and to in is a that for are as be by with this it on from or which an".split())
LOOKS_ENGLISH = 0.10
MIN_OSD_CONFIDENCE = 2.0  # below this OSD is guessing (e.g. a page that is mostly a diagram)


class PdfReadError(Exception):
    """The file cannot be read as a PDF (corrupt, encrypted or empty). The pipeline skips it."""


@dataclass
class OcrEngine:
    """Wraps Tesseract. `available` is False when the executable is missing; OCR is then skipped."""

    cmd: str
    lang: str = "eng"
    dpi: int = 300
    # Tesseract page segmentation mode. 4 = "one column of text of variable sizes": in our tests it
    # read curved phone-photo pages and tables better than the default (3 = automatic layout).
    psm: int = 4
    available: bool = field(init=False, default=False)
    version: str = field(init=False, default="")

    def __post_init__(self) -> None:
        pytesseract.pytesseract.tesseract_cmd = self.cmd
        try:
            self.version = str(pytesseract.get_tesseract_version())
            self.available = True
        except (pytesseract.TesseractNotFoundError, OSError):
            self.available = False

    def render(self, page: pymupdf.Page) -> Image.Image:
        """Render the page as if it were A4 at `dpi` (2480 px wide at 300 dpi).
        We can't trust the page size in the PDF: phone-scanner apps save a photo's pixels as
        points, so a page "64 cm wide" would become an 80-megapixel image at 300 dpi."""
        zoom = (A4_WIDTH_INCHES * self.dpi) / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

    def ocr(self, image: Image.Image) -> str:
        return pytesseract.image_to_string(image, lang=self.lang, config=f"--psm {self.psm}")

    def detect_rotation(self, image: Image.Image) -> int:
        """Degrees (0, 90, 180, 270) the page must be turned clockwise to be upright, or 0 if unsure."""
        try:
            osd = pytesseract.image_to_osd(image, config="--psm 0")
        except pytesseract.TesseractError:  # too little text to tell, or osd.traineddata missing
            return 0
        return rotation_from_osd(osd)

    def read_page(self, page: pymupdf.Page) -> str:
        image = preprocess(self.render(page))
        text = self.ocr(image)
        if english_ratio(text) >= LOOKS_ENGLISH:
            return text  # normal upright page: no extra work
        angle = self.detect_rotation(image)
        if angle == 0:
            return text  # upright but not prose (a diagram or a table)
        # PIL turns counter-clockwise, so a clockwise turn is a negative angle
        turned = self.ocr(image.rotate(-angle, expand=True))
        log.info("  page was turned %d degrees; read it again upright", angle)
        return better_text(text, turned)


def english_ratio(text: str) -> float:
    """Share of the words that are very common English words (0.0 for no words)."""
    words = re.findall(r"[a-z]+", text.lower())
    return sum(w in COMMON_WORDS for w in words) / len(words) if words else 0.0


def rotation_from_osd(osd: str, min_confidence: float = MIN_OSD_CONFIDENCE) -> int:
    """Read "Rotate: 180" and "Orientation confidence: 22.1" from Tesseract's OSD output."""
    rotate = re.search(r"Rotate: (\d+)", osd)
    confidence = re.search(r"Orientation confidence: ([\d.]+)", osd)
    if not rotate or not confidence or float(confidence.group(1)) < min_confidence:
        return 0
    return int(rotate.group(1)) % 360


def better_text(original: str, turned: str) -> str:
    """Keep the turned page's text only if it reads more like English (OSD can be wrong)."""
    return turned if english_ratio(turned) > english_ratio(original) else original


def preprocess(image: Image.Image) -> Image.Image:
    """Grayscale + stretch the contrast (ignoring the 1% darkest/brightest pixels).
    Phone photos have grey paper and uneven light; this makes the text darker against the page."""
    return ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=1)


def letter_count(text: str) -> int:
    return sum(ch.isalnum() for ch in text)


def pick_page_text(text_layer: str, run_ocr: Optional[Callable[[], str]], min_letters: int) -> tuple[str, bool]:
    """Decide where a page's text comes from. Returns (text, came_from_ocr).

    - A text layer with at least `min_letters` letters is the real text: use it (exact and fast).
    - Otherwise the page may be a scan whose text layer holds only a footer or figure labels,
      so we OCR it and use the OCR text if it has clearly more letters.
    - `run_ocr` is None when Tesseract is not installed: the text layer is all we have.
    """
    native = letter_count(text_layer)
    if native >= min_letters or run_ocr is None:
        return text_layer, False
    ocr_text = run_ocr()
    if letter_count(ocr_text) > native * OCR_MUST_BEAT_TEXT_LAYER:
        return ocr_text, True
    return text_layer, False


def open_pdf(path: Path) -> pymupdf.Document:
    """Open a PDF, or raise PdfReadError with a clear reason. Use it with `with`."""
    try:
        doc = pymupdf.open(path)
    except Exception as exc:  # PyMuPDF raises several error types for broken files
        raise PdfReadError("the file is damaged or is not a real PDF") from exc
    if doc.needs_pass:
        doc.close()
        raise PdfReadError("the PDF is password-protected")
    if doc.page_count == 0:
        doc.close()
        raise PdfReadError("the PDF has no pages")
    return doc


class PageReadError(Exception):
    """One page could not be read even after a retry (e.g. Tesseract crashed)."""


def extract_page(doc: pymupdf.Document, number: int, ocr: OcrEngine, min_letters: int, attempts: int = 2) -> PageText:
    """Text of one page (1-based). If reading fails (Tesseract can crash, for example on a
    machine with faulty RAM) it is tried once more; then PageReadError is raised so the caller
    can skip the page for now WITHOUT caching it, and a later run tries it again."""
    for attempt in range(1, attempts + 1):
        try:
            page = doc.load_page(number - 1)
            run_ocr = (lambda: ocr.read_page(page)) if ocr.available else None
            text, from_ocr = pick_page_text(page.get_text("text"), run_ocr, min_letters)
            if run_ocr is None and letter_count(text) < min_letters:
                log.warning("  page %d may be scanned but Tesseract is not available", number)
            return PageText(page=number, text=text, ocr=from_ocr)
        except Exception as exc:  # one damaged page must not stop the whole document
            log.warning("  page %d could not be read (attempt %d/%d): %s", number, attempt, attempts, exc)
    raise PageReadError(f"page {number} could not be read")


def extract_pages(path: Path, ocr: OcrEngine, min_letters: int, first: int = 1, last: Optional[int] = None) -> list[PageText]:
    """Return one PageText per page from `first` to `last` (1-based, inclusive; default: all pages)."""
    with open_pdf(path) as doc:
        end = doc.page_count if last is None else min(last, doc.page_count)
        pages = []
        for n in range(first, end + 1):
            try:
                pages.append(extract_page(doc, n, ocr, min_letters))
            except PageReadError:
                pages.append(PageText(page=n, text="", ocr=False))
        return pages
