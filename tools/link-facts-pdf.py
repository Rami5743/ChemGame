#!/usr/bin/env python3
"""Adds links to the printed sheet about the cards, and nothing else.

The sheet is taken as it was supplied. Every term is found by its place on the
page, and a link annotation is laid over it with no border, so not one mark of
the page itself changes — only the ability to click a word. Needs pdftotext,
from poppler, and pypdf.

    python3 tools/link-facts-pdf.py
"""

import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import ArrayObject, NameObject, NumberObject

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "materials/facts/facts2_1.pdf"
OUT = ROOT / "facts.pdf"
WIKI = "https://he.wikipedia.org/wiki/"
NS = "{http://www.w3.org/1999/xhtml}"

# The term as the sheet spells it, with its spaces taken out, and the article
# it points at. The sheet's own spelling is kept; only the target is correct.
TERMS = [
    ("מימן", "מימן"),
    ("פחמן", "פחמן"),
    ("חנקן", "חנקן"),
    ("חמצן", "חמצן"),
    ("היתוךגרעיני", "היתוך גרעיני"),
    ("בסופרנובות", "סופרנובה"),
    ("במספרהאטומי", "מספר אטומי"),
    ("במספרהמסה", "מספר מסה"),
    ("מודלהאטוםשלבור", "מודל האטום של בוהר"),
    ("האלקטרונים", "אלקטרון"),
    ("לאורביטאלים", "אורביטל אטומי"),
    ("מפרוטונים", "פרוטון"),
    ("נפט", "נפט"),
    ("אמוניה", "אמוניה"),
    ("דשנים", "דשן"),
    ("אצטון", "אצטון"),
    ("כממס", "ממס"),
    ("חומרינפץ", "חומר נפץ"),
    ("חייםויצמן", "חיים ויצמן"),
    ("מלחמתהאולםהראשונה", "מלחמת העולם הראשונה"),
    ("הצהרתבלפור", "הצהרת בלפור"),
    ("אתנול", "אתנול"),
    ("אתאן", "אתאן"),
    ("גזטבעי", "גז טבעי"),
    ("בוטאן", "בוטאן"),
    ("זיקוק", "זיקוק"),
    ("גלוקוז", "גלוקוז"),
    ("פרוקטוז", "פרוקטוז"),
    ("פוטוסינתזה", "פוטוסינתזה"),
    ("גליצין", "גליצין"),
    ("חומצתהאמינו", "חומצת אמינו"),
    ("קשרפפטידי", "קשר פפטידי"),
    ("חלבון", "חלבון"),
    ("הידרזין", "הידרזין"),
    ("חומצהאצטית", "חומצה אצטית"),
    ("בחומץ", "חומץ"),
    ("מים", "מים"),
    ("כדורפורח", "כדור פורח"),
    ("מתאן", "מתאן"),
    ("מתנול", "מתנול"),
    ("הצפלין", "צפלין"),
    ("פחמןדו-חמצני", "פחמן דו-חמצני"),
    ("אפקטהחממה", "אפקט החממה"),
    ("פרופאן", "פרופאן"),
    ("שתנן", "שתנן"),
]


def read_lines(pdf):
    """Every line of the sheet, in reading order, with each word's box."""
    with tempfile.TemporaryDirectory() as tmp:
        xml = Path(tmp) / "boxes.xml"
        subprocess.run(["pdftotext", "-bbox-layout", str(pdf), str(xml)], check=True)
        tree = ET.parse(xml)
    out = []
    for number, page in enumerate(tree.getroot().iter(NS + "page")):
        height = float(page.get("height"))
        for line in page.iter(NS + "line"):
            words = [
                (
                    (w.text or "")[::-1],
                    (
                        float(w.get("xMin")),
                        float(w.get("yMin")),
                        float(w.get("xMax")),
                        float(w.get("yMax")),
                    ),
                )
                for w in line.iter(NS + "word")
            ]
            out.append((number, height, list(reversed(words))))
    return out


def find(lines, needle, taken):
    """The boxes of the first unclaimed run of words that spells the term."""
    for index, (page, height, words) in enumerate(lines):
        joined, owner = "", []
        for position, (text, _) in enumerate(words):
            joined += text
            owner += [position] * len(text)
        at = joined.find(needle)
        while at != -1:
            used = sorted(set(owner[at : at + len(needle)]))
            if (index, used[0]) not in taken:
                return page, height, [words[i][1] for i in used], (index, used[0])
            at = joined.find(needle, at + 1)
    return None


def main():
    lines = read_lines(SRC)
    reader = PdfReader(SRC)
    writer = PdfWriter(clone_from=SRC)

    taken, missing = set(), []
    for needle, article in TERMS:
        found = find(lines, needle, taken)
        if not found:
            missing.append(needle)
            continue
        page, height, boxes, claim = found
        taken.add(claim)
        x0 = min(b[0] for b in boxes) - 1
        x1 = max(b[2] for b in boxes) + 1
        y0 = min(b[1] for b in boxes) - 1
        y1 = max(b[3] for b in boxes) + 1
        link = Link(
            rect=(x0, height - y1, x1, height - y0),
            url=WIKI + article.replace(" ", "_"),
        )
        # No border, so the page looks exactly as it was printed.
        link[NameObject("/Border")] = ArrayObject(
            [NumberObject(0), NumberObject(0), NumberObject(0)]
        )
        writer.add_annotation(page_number=page, annotation=link)

    with open(OUT, "wb") as fh:
        writer.write(fh)
    print(f"{len(TERMS) - len(missing)} links over {len(reader.pages)} pages -> {OUT.name}")
    if missing:
        print("not found on the sheet:", ", ".join(missing))


if __name__ == "__main__":
    main()
