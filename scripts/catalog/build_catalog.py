"""Builds data/catalog.json and apps/web/public/catalog/*.jpg from the HaTikvah Care PDF catalogue.

Usage:  pip install pymupdf pillow
        python scripts/catalog/build_catalog.py /path/to/Hotels-Catalog.pdf

Images are pulled from the PDF and matched to the product table in `catalog_table.py` by (page, position).
Prices are NOT in the PDF, so every product starts as "price on request" (price = null); the owner fills them in
from the admin panel.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf
from PIL import Image

from catalog_table import CATEGORIES, TABLE

ROOT = Path(__file__).resolve().parents[2]
OUT_IMG = ROOT / "apps/web/public/catalog"
SECTION_PAGES = [(5, 9), (11, 14), (16, 16), (18, 18), (20, 21), (23, 24), (26, 29), (31, 39)]


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70]


def page_images(doc, pn: int):
    pg = doc[pn - 1]
    seen, out = set(), []
    for im in pg.get_image_info(xrefs=True):
        b = im["bbox"]
        if b[2] - b[0] < 35 or b[3] - b[1] < 35 or im["xref"] == 0 or im["xref"] in seen:
            continue
        if b[3] < 90 and pn in (11, 12, 13, 14):  # Biotique header logo
            continue
        seen.add(im["xref"])
        out.append({"xref": im["xref"], "x": b[0], "y": b[1], "bbox": b, "w": im["width"]})
    # reading order: rows (60pt bands) top to bottom, then left to right
    return sorted(out, key=lambda i: (round(i["y"] / 60), i["x"]))


def save_jpeg(doc, pn: int, im: dict, path: Path, maxw: int = 700) -> None:
    """Plain RGB JPEGs are copied out as they are (clean, no neighbouring caption text). Anything with a soft mask or an
    unusual colour space is rendered from the page instead, which is always colour-correct."""
    info = doc.extract_image(im["xref"])
    if info.get("ext") == "jpeg" and info.get("colorspace") == 3 and not info.get("smask") and info.get("bpc") == 8:
        img = Image.open(__import__("io").BytesIO(info["image"])).convert("RGB")
        if img.width > maxw:
            img = img.resize((maxw, round(img.height * maxw / img.width)), Image.LANCZOS)
        img.save(path, "JPEG", quality=84, optimize=True)
        return
    rect = pymupdf.Rect(im["bbox"]) & doc[pn - 1].rect
    scale = min(im["w"], maxw) / max(rect.width, 1)
    pix = doc[pn - 1].get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=rect, alpha=False)
    Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(path, "JPEG", quality=84, optimize=True)


def main(pdf: str) -> None:
    doc = pymupdf.open(pdf)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    per_page: dict[int, list] = {}
    for a, b in SECTION_PAGES:
        for pn in range(a, b + 1):
            per_page[pn] = page_images(doc, pn)
    products, used_slugs = [], set()
    for n, row in enumerate(TABLE, start=1):
        page, idx, cat, coll, name, pack, variants, desc = row
        imgs = per_page[page]
        picks = [idx] if isinstance(idx, int) else list(idx)
        files = []
        for k in picks:
            fn = f"p{page:02d}-{k}.jpg"
            im = imgs[k - 1]
            save_jpeg(doc, page, im, OUT_IMG / fn)
            files.append(f"/catalog/{fn}")
        slug = slugify(name)
        while slug in used_slugs:
            slug += "-2"
        used_slugs.add(slug)
        products.append({
            "slug": slug, "sku": f"HC-{n:03d}", "name": name, "category": cat, "collection": coll, "pack": pack, "variants": variants,
            "description": desc, "images": files, "price": None, "priceUnit": "", "minOrder": "", "active": True, "featured": n in FEATURED_NUMBERS,
            "order": n,
        })
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/catalog.json").write_text(json.dumps({"categories": CATEGORIES, "products": products}, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(products)} products, {len(CATEGORIES)} categories")


FEATURED_NUMBERS = {1, 14, 41, 53, 60, 83, 99, 104, 116, 125}

if __name__ == "__main__":
    main(sys.argv[1])
