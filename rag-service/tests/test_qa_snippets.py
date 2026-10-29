"""Citation snippets: the part of the chunk that supports the claim, not noise or a heading."""

from app.snippets import SNIPPET_CHARS, best_snippet, candidates, claims_by_citation, content_terms, is_noisy

# Real chunk text (STBB_Biology_XI.pdf p.233, as stored): it starts with OCR noise
OSMOSIS_P233 = (
    ". . ae Sai SS 7 __. Forms and Functions in Pian} eee oe lee ~ ™ @Silet eee ie . a Sere ee ) PR ha WP wh =x ~. "
    "from the solution of lower osmotic tic potential when the two solution -) temperature and pressure, water moves e "
    "membrane. It is represented by g be ‘ potential to the solution of higher osmo | are separated by a differentially "
    "permeabl | s or solute potential. a \"rae Another term used in relation to water potential is pressure potential, which "
    "is defined as the hydrostatic pressure in excess of atmosphere | pressure. | water relations of Plant Cell: | For "
    "practical purposes 4 plant cell can be divided into three parts: (i) ) Cell Wall: This is non-living, permeable, outer "
    "most boundary of cell made /up of cellulose."
)
# Real chunk text (STBB_Biology_XI.pdf p.37): a heading first, the mechanism after
ENZYME_P37 = (
    "2.2 MECHANISM OF ENZYME ACTION: As we have discussed that all metabolic reactions are catalyzed by enzymes. During "
    "these reactions the substrate bind to active site of the enzyme and form enzyme substrate complex (ES) that substrate "
    "convert into product but remain attached with enzyme and form e ae ceteeraice ie (EP) and then product release from "
    "active site of enzyme. The quantity and shape of enzyme remain same before and after chemical reaction. fg E + Ss ES "
    "EP E + P if Enzyme ==> substrate o—a Enzyme == Enzymee—=_ Enzyme o— Product = Substrate Product complex"
)


class TestNoise:
    def test_ocr_noise_and_headings_are_skipped(self) -> None:
        assert is_noisy("ae Sai SS 7 __. Forms and Functions in Pian} eee oe lee ~ ™ @Silet eee ie")
        assert is_noisy("2.2 MECHANISM OF ENZYME ACTION")  # heading: too short and all capitals
        assert is_noisy("10.4 WATER AND MINERALS UPTAKE BY ROOT")
        assert is_noisy("E + Ss ES EP E + P if Enzyme ==> substrate o-a Enzyme == Enzymee")

    def test_real_sentences_are_kept(self) -> None:
        assert not is_noisy("The quantity and shape of enzyme remain same before and after chemical reaction.")
        assert not is_noisy("Newton's second law states that acceleration is proportional to the net force (F = ma).")


class TestBestSnippet:
    def test_skips_the_noisy_start_of_a_real_chunk(self) -> None:
        snippet = best_snippet(OSMOSIS_P233, "What is osmosis?",
                               "Osmosis is the process by which water moves from a solution of lower osmotic potential "
                               "to a solution of higher osmotic potential.")
        assert not snippet.startswith((". . ae", "ae Sai")) and "Sai SS" not in snippet
        assert "osmotic" in snippet and len(snippet) <= SNIPPET_CHARS

    def test_picks_the_sentence_that_supports_the_claim(self) -> None:
        unchanged = best_snippet(ENZYME_P37, "How do enzymes work?", "The quantity and shape of the enzyme remain unchanged.")
        assert unchanged == "The quantity and shape of enzyme remain same before and after chemical reaction."
        complex_ = best_snippet(ENZYME_P37, "How do enzymes work?",
                                "The substrate binds to the active site to form an enzyme-substrate complex.")
        assert complex_.startswith("During these reactions the substrate bind to active site")

    def test_without_a_claim_the_question_decides(self) -> None:
        text = ("Plants absorb water through root hairs in the soil. Osmosis is the movement of water across a "
                "differentially permeable membrane from a dilute to a concentrated solution.")
        assert best_snippet(text, "What is osmosis?").startswith("Osmosis is the movement of water")

    def test_never_longer_than_the_limit_and_cut_at_a_word(self) -> None:
        long_sentence = "Enzymes " + " ".join(["catalyse metabolic reactions inside living cells quickly"] * 12) + "."
        snippet = best_snippet(long_sentence, "How do enzymes work?")
        assert len(snippet) <= SNIPPET_CHARS and snippet.endswith(" ...")
        assert not snippet[:-4].endswith(("cataly", "metabol"))  # whole words only

    def test_all_noise_falls_back_to_the_start(self) -> None:
        noise = "ae Sai SS 7 __. eee oe lee ~ @Silet eee ie . a Sere ee ) PR ha WP wh =x ~."
        assert best_snippet(noise, "What is osmosis?") == " ".join(noise.split())[:SNIPPET_CHARS]


def test_candidates_split_on_sentences_and_ocr_bullets() -> None:
    parts = candidates("First Law: an object stays at rest. @> Second Law: F = ma. > Third Law: action and reaction.")
    assert parts == ["First Law: an object stays at rest.", "Second Law: F = ma.", "Third Law: action and reaction."]


def test_claims_by_citation() -> None:
    answer = "Enzymes lower activation energy [1][2]. They are proteins [2]. F = ma [1, 3]."
    claims = claims_by_citation(answer)
    assert claims[1].strip() == "Enzymes lower activation energy . F = ma ." or "activation energy" in claims[1]
    assert "proteins" in claims[2] and "activation" in claims[2] and "F = ma" in claims[3]
    assert "[" not in claims[1]


def test_content_terms_ignore_stopwords_and_plural() -> None:
    assert content_terms("How do the enzymes work?") == content_terms("enzyme works") == {"enzym", "work"}
