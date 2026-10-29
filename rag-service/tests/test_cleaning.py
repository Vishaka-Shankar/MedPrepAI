from ingestion.cleaning import (
    clean_document,
    find_repeated_lines,
    fix_broken_lines,
    is_heading,
    is_page_number,
    line_key,
    normalize_chars,
    remove_headers_footers,
)


def make_page(n: int, body: str) -> str:
    return f"Sindh Textbook Board - Biology XI\nChapter 3\n{body}\nPage {n}"


# Real body text differs from page to page; only headers/footers repeat
BODIES = ["Enzymes are proteins.", "Membranes are bilayers.", "Ribosomes make proteins.", "Mitochondria release energy."]


class TestPageNumbers:
    def test_recognises_common_formats(self) -> None:
        for line in ["7", "Page 7", "page 12", "- 7 -", "(7)", "7 of 120", "Page 7 / 120", "  42  "]:
            assert is_page_number(line), line

    def test_does_not_flag_real_text(self) -> None:
        for line in ["2.5 m/s", "Page 7 shows the heart", "Chapter 3", "1. Enzymes", "x = 7y"]:
            assert not is_page_number(line), line


class TestHeadersFooters:
    def test_finds_lines_repeated_on_most_pages(self) -> None:
        pages = [make_page(n, body) for n, body in enumerate(BODIES, start=1)]
        repeated = find_repeated_lines(pages)
        assert repeated == {line_key("Sindh Textbook Board - Biology XI"), line_key("Chapter 3"), line_key("Page 1")}

    def test_line_key_ignores_page_digits_and_ocr_confusions(self) -> None:
        assert line_key("Page 3") == line_key("page 14")
        assert line_key("MedPrep AI notes") == line_key("MedPrep Al notes")  # OCR reads "I" as "l"
        assert line_key("Biology") != line_key("Chemistry")

    def test_header_removed_when_one_page_was_ocrd(self) -> None:
        pages = ["MedPrep AI notes\nEnzymes are proteins.\nPage 1", "MedPrep Al notes\nMembranes are bilayers.\nPage 2"]
        assert clean_document(pages) == ["Enzymes are proteins.", "Membranes are bilayers."]

    def test_mcq_option_letters_are_not_footers(self) -> None:
        # Every page of an MCQ paper ends with option "D."; it must survive cleaning
        questions = [("Which valve controls entry to the colon?", "hepatic", "pyloric"),
                     ("Key point of Darwinism?", "Endosymbiosis", "descent with modification"),
                     ("First electron acceptor from FADH2?", "ubiquinone", "oxygen"),
                     ("A diode is a device of which kind?", "insulating", "semiconducting")]
        pages = [f"PAPER-2024-BLUE\n{n}. {q}\nA.\n{a}\nD.\n{d}" for n, (q, a, d) in enumerate(questions, 1)]
        cleaned = clean_document(pages)
        assert [p.endswith(f"D. {d}") for p, (_, _, d) in zip(cleaned, questions)] == [True] * 4
        assert all("PAPER" not in p for p in cleaned)

    def test_single_page_has_no_repeated_lines(self) -> None:
        assert find_repeated_lines([make_page(1, "Only page.")]) == set()

    def test_removes_header_footer_but_keeps_body(self) -> None:
        pages = [make_page(n, body) for n, body in enumerate(BODIES, start=1)]
        repeated = find_repeated_lines(pages)
        for page, body in zip(pages, BODIES):
            assert remove_headers_footers(page, repeated).strip() == body

    def test_number_inside_body_is_kept(self) -> None:
        page = "Title\nIntro line\nMore intro\n42\nmiddle text\nmore middle\nend one\nend two\nend three"
        assert "42" in remove_headers_footers(page, set())

    def test_page_number_at_edge_is_removed(self) -> None:
        assert remove_headers_footers("Some text here.\n- 12 -", set()) == "Some text here."


class TestBrokenLines:
    def test_joins_lines_split_mid_sentence(self) -> None:
        text = "Enzymes lower the activation\nenergy of a reaction and\nare not used up."
        assert fix_broken_lines(text) == "Enzymes lower the activation energy of a reaction and are not used up."

    def test_repairs_hyphenated_words(self) -> None:
        assert fix_broken_lines("Plants carry out photo-\nsynthesis in light.") == "Plants carry out photosynthesis in light."

    def test_keeps_paragraph_breaks(self) -> None:
        assert fix_broken_lines("First paragraph.\n\nSecond paragraph.") == "First paragraph.\n\nSecond paragraph."

    def test_keeps_list_items_on_their_own_lines(self) -> None:
        text = "Factors affecting enzymes:\n• temperature\n• pH\n1. substrate concentration"
        assert fix_broken_lines(text).splitlines() == [
            "Factors affecting enzymes:",
            "• temperature",
            "• pH",
            "1. substrate concentration",
        ]

    def test_keeps_heading_separate(self) -> None:
        assert fix_broken_lines("Cell Membrane\nThe membrane is a bilayer.") == "Cell Membrane\nThe membrane is a bilayer."

    def test_heading_not_glued_after_a_joined_line(self) -> None:
        text = "An intro sentence that wraps\nonto a second line.\nMotion and Force\nDisplacement is a vector."
        assert fix_broken_lines(text).splitlines() == [
            "An intro sentence that wraps onto a second line.",
            "Motion and Force",
            "Displacement is a vector.",
        ]

    def test_heading_detection(self) -> None:
        assert is_heading("Cell Membrane")
        assert is_heading("CHAPTER 3: ENZYMES")
        assert not is_heading("The site of")
        assert not is_heading("This is a full sentence.")

    def test_collapses_extra_spaces(self) -> None:
        assert fix_broken_lines("too    many   spaces") == "too many spaces"


class TestCharacters:
    def test_fixes_ligatures_and_soft_hyphens(self) -> None:
        assert normalize_chars("eﬃcient ﬁsh co­operate") == "efficient fish cooperate"

    def test_keeps_scientific_symbols(self) -> None:
        assert normalize_chars("a = 9.8 m/s², H₂O, ΔH") == "a = 9.8 m/s², H₂O, ΔH"


def test_clean_document_end_to_end() -> None:
    pages = [
        make_page(1, "Enzymes are biological\ncatalysts that speed up\nreactions."),
        make_page(2, "The active site binds the sub-\nstrate."),
        make_page(3, "Inhibitors reduce activity."),
    ]
    cleaned = clean_document(pages)
    assert cleaned == [
        "Enzymes are biological catalysts that speed up reactions.",
        "The active site binds the substrate.",
        "Inhibitors reduce activity.",
    ]


def test_clean_document_keeps_page_count_even_for_blank_pages() -> None:
    assert len(clean_document(["Text.", "", "More."])) == 3
