#!/usr/bin/env python3
"""Lifts the two illustrations of the printed booklet off their gradient.

The cover's glycine model and the closing page's atom sit on the same yellow
to pale blue wash that the rules page itself uses, so they are cut out and the
wash behind them is made transparent, row by row, from the colour at the edges
of that row. Run after changing the booklet art:

    python3 tools/extract-booklet-art.py
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "materials/booklet/Instructions_for_gamecrafter3"
OUT = ROOT / "assets/booklet"

# page, crop box, name
JOBS = [
    ("page01_1.png", (100, 650, 1085, 1460), "glycine.webp"),
    ("page12_1.png", (95, 145, 1035, 1215), "atom.webp"),
]

NEAR = 20   # closer than this to the wash: fully transparent
FAR = 46    # further than this: fully opaque


def lift(im):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        edge = [px[x, y][:3] for x in list(range(4)) + list(range(w - 4, w))]
        bg = tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if d <= NEAR:
                px[x, y] = (r, g, b, 0)
            elif d < FAR:
                px[x, y] = (r, g, b, int(255 * (d - NEAR) / (FAR - NEAR)))
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for page, box, name in JOBS:
        im = Image.open(SRC / page).crop(box)
        im = lift(im)
        im.thumbnail((620, 620), Image.LANCZOS)
        im.save(OUT / name, "WEBP", quality=88, method=6)
        print(name, im.size, (OUT / name).stat().st_size // 1024, "KiB")


if __name__ == "__main__":
    main()
