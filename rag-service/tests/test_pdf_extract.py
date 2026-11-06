import pytest
from PIL import Image

from ingestion.pdf_extract import (
    OcrEngine,
    PageReadError,
    better_text,
    english_ratio,
    extract_page,
    pick_page_text,
    preprocess,
    rotation_from_osd,
)


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

# ---------------------------------------------------------------- upside-down and sideways scans

UPRIGHT = "Force is an agent which tends to change the state of rest or of motion of a body."
# What OCR made of the same sentence on an upside-down Physics IX page
UPSIDE_DOWN = "\u2018palqo ue Jo 3}e}s ay} asULYD 0} spud} YoryM yuase ue SI ad10F"
OSD_180 = "Page number: 0\nOrientation in degrees: 180\nRotate: 180\nOrientation confidence: 22.08\nScript: Latin"


def test_english_ratio_tells_upright_text_from_upside_down_text() -> None:
    assert english_ratio(UPRIGHT) > 0.25
    assert english_ratio(UPSIDE_DOWN) < 0.10
    assert english_ratio("") == 0.0


def test_rotation_is_read_from_osd_output() -> None:
    assert rotation_from_osd(OSD_180) == 180
    assert rotation_from_osd(OSD_180.replace("22.08", "0.9")) == 0  # too unsure: leave the page as it is
    assert rotation_from_osd("garbage") == 0


def test_turned_text_is_kept_only_if_it_reads_better() -> None:
    assert better_text(UPSIDE_DOWN, UPRIGHT) == UPRIGHT
    assert better_text(UPRIGHT, UPSIDE_DOWN) == UPRIGHT  # OSD was wrong: keep the first reading


class FakeOcr(OcrEngine):
    """OcrEngine without Tesseract: 'reads' upright text only from an upright image."""

    def __init__(self, rotation: int, upright_size: tuple[int, int]) -> None:
        super().__init__("missing-tesseract")
        self.rotation, self.upright_size, self.ocr_calls = rotation, upright_size, 0

    def render(self, page):  # type: ignore[override]
        return page  # the tests pass an image as the "page"

    def ocr(self, image: Image.Image) -> str:
        self.ocr_calls += 1
        upright = image.size == self.upright_size and image.getpixel((0, 0)) < 128
        return UPRIGHT if upright else UPSIDE_DOWN

    def detect_rotation(self, image: Image.Image) -> int:
        return self.rotation


def scanned(width: int, height: int, mark: tuple[int, int]) -> Image.Image:
    """A white page with a black 4x4 mark; the mark's corner shows which way the page is turned."""
    image = Image.new("RGB", (width, height), (255, 255, 255))
    x0 = 0 if mark[0] == 0 else width - 4
    y0 = 0 if mark[1] == 0 else height - 4
    for x in range(x0, x0 + 4):
        for y in range(y0, y0 + 4):
            image.putpixel((x, y), (0, 0, 0))
    return image


def test_upside_down_page_is_turned_and_read_again() -> None:
    engine = FakeOcr(rotation=180, upright_size=(30, 40))
    assert engine.read_page(scanned(30, 40, (1, 1))) == UPRIGHT  # type: ignore[arg-type]  # mark bottom-right
    assert engine.ocr_calls == 2


def test_sideways_page_is_turned_clockwise() -> None:
    # An upright 30x40 page (mark top-left) turned 90 degrees counter-clockwise: 40x30, mark bottom-left
    engine = FakeOcr(rotation=90, upright_size=(30, 40))
    assert engine.read_page(scanned(40, 30, (0, 1))) == UPRIGHT  # type: ignore[arg-type]


def test_upright_page_is_read_once() -> None:
    engine = FakeOcr(rotation=180, upright_size=(30, 40))
    assert engine.read_page(scanned(30, 40, (0, 0))) == UPRIGHT  # type: ignore[arg-type]
    assert engine.ocr_calls == 1  # no orientation check and no second OCR for normal pages
