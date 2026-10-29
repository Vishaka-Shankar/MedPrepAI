"""Create a tiny, clearly labelled SAMPLE dataset to test the pipeline when data/raw/<subject> is empty.

    python make_sample_data.py

- Files are named SAMPLE_*.pdf; the pipeline stores them with isSample = true,
  and `python ingest.py --delete-sample` removes them from the database.
- Each page has a running header and a page-number footer (to test the cleaning step).
- The Physics file has one image-only "scanned" page (to test the OCR fallback).
- SAMPLE_corrupt.pdf in chemistry is deliberately broken (to test that bad files are skipped).
The notes are short original summaries written for testing, not real study material.
"""

from __future__ import annotations

from pathlib import Path

import pymupdf

from config import load_settings

HEADER = "SAMPLE DATA - MedPrep AI pipeline test - not real study material"

NOTES: dict[str, list[tuple[str, str]]] = {
    "biology": [
        ("Enzymes",
         "Enzymes are biological catalysts, mostly proteins, that speed up chemical reactions in cells "
         "without being used up. Each enzyme has an active site whose shape fits a particular substrate. "
         "In the lock and key model the active site is a rigid shape that matches the substrate exactly, "
         "while the induced fit model says the active site changes shape slightly as the substrate binds.\n\n"
         "Enzymes work by lowering the activation energy of a reaction. Their activity depends on temperature, "
         "pH, substrate concentration and enzyme concentration. Above the optimum temperature the enzyme is "
         "denatured: hydrogen bonds break, the active site loses its shape and activity falls sharply. Pepsin "
         "works best near pH 2 in the stomach, while trypsin works best near pH 8 in the small intestine.\n\n"
         "Inhibitors reduce enzyme activity. A competitive inhibitor resembles the substrate and competes for "
         "the active site, so its effect can be overcome by adding more substrate. A non-competitive inhibitor "
         "binds elsewhere on the enzyme and changes the shape of the active site."),
        ("Cell Membrane",
         "The cell membrane is described by the fluid mosaic model. It is a phospholipid bilayer in which "
         "proteins float. The hydrophilic phosphate heads face the watery cytoplasm and tissue fluid, and the "
         "hydrophobic fatty acid tails face inwards. Cholesterol between the phospholipids keeps the membrane "
         "stable over a range of temperatures.\n\n"
         "Small non-polar molecules such as oxygen and carbon dioxide cross by simple diffusion. Glucose and ions "
         "need carrier or channel proteins (facilitated diffusion). Active transport moves substances against "
         "a concentration gradient and uses ATP, for example the sodium-potassium pump, which moves three sodium "
         "ions out of the cell and two potassium ions in for every ATP used."),
    ],
    "chemistry": [
        ("Chemical Bonding",
         "An ionic bond forms when electrons are transferred from a metal to a non-metal, producing oppositely "
         "charged ions held together by electrostatic attraction. Sodium chloride is a typical example. Ionic "
         "compounds have high melting points and conduct electricity when molten or dissolved in water.\n\n"
         "A covalent bond is a shared pair of electrons between two non-metal atoms. When the atoms have different "
         "electronegativities the bond is polar, as in the O-H bonds of water. A coordinate covalent (dative) bond "
         "forms when both shared electrons come from the same atom, as in the ammonium ion.\n\n"
         "VSEPR theory predicts shapes from electron pairs around the central atom. Methane is tetrahedral with a "
         "bond angle of 109.5 degrees, ammonia is pyramidal at about 107 degrees, and water is bent at about "
         "104.5 degrees because lone pairs repel more strongly than bonding pairs."),
        ("Chemical Equilibrium",
         "A reversible reaction reaches dynamic equilibrium in a closed system when the forward and reverse "
         "reactions go at the same rate, so concentrations stay constant. The equilibrium constant Kc is the "
         "product of the concentrations of products divided by that of reactants, each raised to the power of "
         "its coefficient in the balanced equation.\n\n"
         "Le Chatelier's principle states that if a system at equilibrium is disturbed, it shifts to oppose the "
         "change. Increasing pressure favours the side with fewer gas molecules. For the exothermic Haber process "
         "a higher temperature lowers the yield of ammonia but increases the rate, so a compromise of about 450 "
         "degrees Celsius and an iron catalyst is used. A catalyst does not change the position of equilibrium."),
    ],
    "physics": [
        ("Motion and Force",
         "Displacement is the shortest distance between two points in a given direction, and velocity is the rate "
         "of change of displacement. Acceleration is the rate of change of velocity and is measured in metres per "
         "second squared. For uniform acceleration the equations of motion are v = u + at, s = ut + 0.5at^2 and "
         "v^2 = u^2 + 2as.\n\n"
         "Newton's first law says a body stays at rest or in uniform motion unless a net force acts on it. The "
         "second law says the net force equals the rate of change of momentum, F = ma for constant mass. The third "
         "law says that action and reaction forces are equal in size, opposite in direction and act on different "
         "bodies. Momentum is conserved in every collision when no external force acts."),
        ("Work and Energy",
         "Work is done when a force moves its point of application in the direction of the force: W = Fd cos(theta). "
         "Its unit is the joule. Power is the rate of doing work, P = W/t, measured in watts.\n\n"
         "Kinetic energy is 0.5mv^2 and gravitational potential energy near the Earth is mgh. The law of "
         "conservation of energy states that energy cannot be created or destroyed, only changed from one form "
         "to another. Efficiency is the useful output energy divided by the total input energy, times 100 percent."),
    ],
}

# This page of Physics is stored as an image only, like a scanned book page
SCANNED_PAGE = ("physics", 2)


def _write_text_page(doc: pymupdf.Document, title: str, body: str, number: int) -> None:
    page = doc.new_page(width=595, height=842)  # A4
    page.insert_text((50, 40), HEADER, fontsize=8)
    page.insert_textbox(pymupdf.Rect(50, 70, 545, 110), title, fontsize=16)
    page.insert_textbox(pymupdf.Rect(50, 110, 545, 790), body, fontsize=11)
    page.insert_text((285, 815), f"Page {number}", fontsize=9)


def _as_scanned(doc: pymupdf.Document, index: int) -> None:
    """Replace a page with a picture of itself: the text layer disappears, like a scan."""
    pix = doc[index].get_pixmap(dpi=200)
    doc.delete_page(index)
    page = doc.new_page(pno=index, width=595, height=842)
    page.insert_image(page.rect, pixmap=pix)


def main() -> None:
    raw = load_settings().data_raw_dir
    for subject, pages in NOTES.items():
        folder = raw / subject
        folder.mkdir(parents=True, exist_ok=True)
        if any(p for p in folder.glob("*.pdf") if not p.name.startswith("SAMPLE_")):
            print(f"{folder}: real PDFs present, no sample created")
            continue
        doc = pymupdf.open()
        for number, (title, body) in enumerate(pages, start=1):
            _write_text_page(doc, title, body, number)
        if SCANNED_PAGE[0] == subject:
            _as_scanned(doc, SCANNED_PAGE[1] - 1)
        out = folder / f"SAMPLE_{subject}_notes.pdf"
        doc.save(out)
        print(f"wrote {out} ({len(pages)} pages)")

        if subject == "chemistry":
            corrupt = folder / "SAMPLE_corrupt.pdf"
            corrupt.write_bytes(b"%PDF-1.7\nthis file is deliberately broken to test error handling\n")
            print(f"wrote {corrupt} (deliberately corrupt)")


if __name__ == "__main__":
    main()
