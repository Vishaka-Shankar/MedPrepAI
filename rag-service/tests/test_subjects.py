from ingestion.chunking import PageText, chunk_pages, make_splitter
from ingestion.cleaning import fix_broken_lines
from ingestion.pipeline import infer_source_type, keep_in_scope
from ingestion.subjects import heading_subject, split_by_subject


def page(n: int, text: str) -> PageText:
    return PageText(page=n, text=text)


class TestHeadingSubject:
    def test_recognises_heading_styles(self) -> None:
        assert heading_subject("BIOLOGY") == "biology"
        assert heading_subject("1. BIOLOGY") == "biology"
        assert heading_subject("2. CHEMISTRY") == "chemistry"
        assert heading_subject("SECTION 3: PHYSICS") == "physics"
        assert heading_subject("  4. ENGLISH  ") == "english"
        assert heading_subject("5. LOGICAL REASONING") == "logical_reasoning"

    def test_ignores_subject_words_in_normal_text(self) -> None:
        assert heading_subject("Chemistry") is None  # not capitals
        assert heading_subject("Biology is the study of life.") is None
        assert heading_subject("14. CHEMISTRY OF HYDROCARBONS") is None  # a topic, not a section
        assert heading_subject("16- NUCLEAR PHYSICS") is None
        assert heading_subject("") is None


class TestSplitBySubject:
    def test_subject_carries_over_to_following_pages(self) -> None:
        pages = [page(1, "BIOLOGY\nQ1 cells"), page(2, "Q2 enzymes"), page(3, "CHEMISTRY\nQ3 bonds"), page(4, "Q4 acids")]
        result = [(s.page, s.subject, s.text) for s in split_by_subject(pages)]
        assert result == [(1, "biology", "Q1 cells"), (2, "biology", "Q2 enzymes"),
                          (3, "chemistry", "Q3 bonds"), (4, "chemistry", "Q4 acids")]

    def test_heading_in_middle_of_page_splits_it(self) -> None:
        pages = [page(1, "BIOLOGY\nQ1 cells"), page(15, "Q68 last biology question\nCHEMISTRY\nQ69 first chemistry question")]
        result = [(s.page, s.subject, s.text) for s in split_by_subject(pages)]
        assert result == [(1, "biology", "Q1 cells"),
                          (15, "biology", "Q68 last biology question"),
                          (15, "chemistry", "Q69 first chemistry question")]

    def test_text_before_first_heading_has_no_subject(self) -> None:
        segments = split_by_subject([page(1, "MDCAT GUIDE\nPreamble text"), page(2, "1. BIOLOGY\nViruses")])
        assert [(s.page, s.subject) for s in segments] == [(1, None), (2, "biology")]

    def test_table_of_contents_does_not_change_subject(self) -> None:
        toc = "SECTION 1: BIOLOGY\nSECTION 2: CHEMISTRY\nSECTION 3: PHYSICS\nSECTION 4: ENGLISH"
        pages = [page(1, "1. BIOLOGY\nViruses"), page(2, toc), page(3, "Bioenergetics")]
        segments = split_by_subject(pages)
        assert [(s.page, s.subject) for s in segments] == [(1, "biology"), (2, None), (3, "biology")]

    def test_repeated_label_at_page_top_is_dropped(self) -> None:
        segments = split_by_subject([page(5, "1. BIOLOGY\nViruses"), page(6, "1. BIOLOGY\nEnzymes")])
        assert [(s.page, s.text) for s in segments] == [(5, "Viruses"), (6, "Enzymes")]

    def test_current_subject_word_mid_page_is_kept_as_text(self) -> None:
        text = "1. INTRODUCTION OF FUNDAMENTALS CONCEPT OF\nCHEMISTRY\nMole concept"
        segments = split_by_subject([page(9, "2. CHEMISTRY\nUnits"), page(10, text)])
        assert [(s.page, s.subject) for s in segments] == [(9, "chemistry"), (10, "chemistry")]
        assert segments[1].text == text

    def test_keeps_page_numbers_and_ocr_flag(self) -> None:
        segments = split_by_subject([PageText(page=7, text="PHYSICS\nForce", ocr=True)])
        assert segments[0].page == 7 and segments[0].ocr is True


class TestKeepInScope:
    def test_skips_english_and_reasoning_and_counts_pages(self) -> None:
        pages = [
            page(1, "Cover page"),
            page(2, "PHYSICS\nNewton"),
            page(3, "Q90 last physics\nENGLISH\nQ91 grammar"),  # mixed page: kept for its physics part
            page(4, "Q92 vocabulary"),
            page(5, "LOGICAL REASONING\nQ95 series"),
        ]
        kept, out_of_scope, no_subject = keep_in_scope(pages)
        assert [(s.page, s.subject) for s in kept] == [(2, "physics"), (3, "physics")]
        assert out_of_scope == 2  # pages 4 and 5 (page 3 still has physics)
        assert no_subject == 1  # page 1


def test_chunks_carry_their_section_subject() -> None:
    segments = split_by_subject([page(1, "BIOLOGY\nCells divide."), page(2, "CHEMISTRY\nAtoms bond.")])
    chunks = chunk_pages(segments, make_splitter(100, 10, str.split), {"source": "paper.pdf"})
    assert [(c.page, c.subject, c.text) for c in chunks] == [(1, "biology", "Cells divide."), (2, "chemistry", "Atoms bond.")]


def test_caps_heading_is_not_glued_to_previous_line() -> None:
    # In the paper, "CHEMISTRY" follows an answer option that has no full stop
    assert fix_broken_lines("D. Waxes\nCHEMISTRY\n69. Which gas").splitlines()[1] == "CHEMISTRY"


def test_source_type_from_file_name() -> None:
    assert infer_source_type("PMDC_MDCAT_Curriculum_2025_Final.pdf") == "syllabus"
    assert infer_source_type("SZABMU_MDCAT_2024_Paper_Blue.pdf") == "past_paper"
    assert infer_source_type("STBB_Biology_XI.pdf") == "textbook"
