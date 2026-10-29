import pytest
from PIL import Image

from ingestion.pdf_extract import OcrEngine, PageReadError, extract_page, pick_page_text, preprocess


class CrashingDoc:
    """A PDF whose page always crashes when read (like Tesseract dying on faulty RAM)."""

    def __init__(self) -> None:
        self.calls = 0

    def load_page(self, index: int) -> None:
        self.calls += 1
        raise OSError("Tesseract crashed (3221225477)")


def test_crashing_page_is_retried_then_reported() -> None:
    doc = CrashingDoc()
    with pytest.raises(PageReadError):
        extract_page(doc, 37, OcrEngine("missing-tesseract"), 800)  # type: ignore[arg-type]
    assert doc.calls == 2  # tried twice, then reported (so it is not cached as an empty page)

FULL_PAGE = "Heat flows from a region of higher temperature to one of lower temperature. " * 15  # ~900 letters
FOOTER_ONLY = "Sindh Textbook Board Jamshoro 18"


def fake_ocr(text: str):
    calls = []

    def run() -> str:
        calls.append(1)
        return text

    return run, calls


class TestPickPageText:
    def test_full_text_layer_is_used_without_ocr(self) -> None:
        run, calls = fake_ocr("OCR text")
        assert pick_page_text(FULL_PAGE, run, 800) == (FULL_PAGE, False)
        assert calls == []  # OCR is slow, so it must not even run

    def test_scanned_page_with_only_a_footer_uses_ocr(self) -> None:
        run, _ = fake_ocr(FULL_PAGE)
        assert pick_page_text(FOOTER_ONLY, run, 800) == (FULL_PAGE, True)

    def test_page_with_figure_labels_but_body_as_image_uses_ocr(self) -> None:
        # Physics XII p.22: the text layer had only labels like "State 1 (initial)"
        labels = "Self-Assessment Questions: State 1 (initial) State 2 (initial) W = -PdV"
        run, _ = fake_ocr(labels + " " + FULL_PAGE)
        text, from_ocr = pick_page_text(labels, run, 800)
        assert from_ocr and "Heat flows" in text

    def test_short_real_page_keeps_exact_text_layer(self) -> None:
        # A short born-digital page: OCR finds about the same text, so the exact text layer wins
        short = "Copyright June 2025 Pakistan Medical and Dental Council"
        run, calls = fake_ocr("Copyright June 2025 Pakistan Medica! and Denta! Council")
        assert pick_page_text(short, run, 800) == (short, False)
        assert calls == [1]

    def test_without_tesseract_the_text_layer_is_used(self) -> None:
        assert pick_page_text(FOOTER_ONLY, None, 800) == (FOOTER_ONLY, False)


def test_preprocess_makes_a_contrasty_grayscale_image() -> None:
    # A grey-on-grey "photo": text pixels 100, paper pixels 160
    image = Image.new("RGB", (20, 20), (160, 160, 160))
    for x in range(5, 15):
        image.putpixel((x, 10), (100, 100, 100))
    out = preprocess(image)
    assert out.mode == "L"
    assert out.getpixel((10, 10)) == 0 and out.getpixel((0, 0)) == 255  # stretched to black/white
