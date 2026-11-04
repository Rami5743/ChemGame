#!/usr/bin/env python3
"""Takes the photographs out of the printed sheet about the cards.

The sheet stores each picture as a colour image and a soft mask beside it, so
the two are put back together and written out with their transparency. Needs
pdfimages, from poppler. Run after changing the sheet:

    python3 tools/extract-facts-art.py
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "materials/facts/facts2_1.pdf"
OUT = ROOT / "assets/facts"

# In the order the sheet stores them.
NAMES = [
    "atoms-row",
    "fusion",
    "rutherford",
    "oil",
    "ammonia",
    "acetone",
    "vodka",
    "cooking-gas",
    "grapes",
    "glycine-crystals",
    "hydrazine",
    "vinegar",
    "soda",
    "water",
    "oxygen",
    "gas-rig",
    "liquid-nitrogen",
    "methanol",
    "potty",
    "glycine-model",
    "hindenburg",
]

MAX_SIDE = 520


def main():
    if not shutil.which("pdfimages"):
        raise SystemExit("pdfimages is missing; install poppler-utils")
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdfimages", "-png", "-p", str(SRC), f"{tmp}/im"], check=True)
        files = sorted(Path(tmp).glob("im-*.png"))
        pairs = list(zip(files[::2], files[1::2]))
        if len(pairs) != len(NAMES):
            raise SystemExit(f"the sheet holds {len(pairs)} pictures, not {len(NAMES)}")
        total = 0
        for (colour, mask), name in zip(pairs, NAMES):
            im = Image.open(colour).convert("RGB")
            m = Image.open(mask).convert("L")
            if m.size != im.size:
                m = m.resize(im.size, Image.LANCZOS)
            im.putalpha(m)
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
            path = OUT / f"{name}.webp"
            im.save(path, "WEBP", quality=86, method=6)
            total += path.stat().st_size
        print(f"{len(NAMES)} pictures, {total // 1024} KiB")


if __name__ == "__main__":
    main()
