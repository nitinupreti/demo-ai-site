"""Parse AfterSchoolHome.pdf: extract page dimensions, text runs with fonts/colors/positions,
vector shapes with fills, and embedded images."""
import fitz
import json
import os
import sys

PDF = os.path.join(os.path.dirname(__file__), "..", "AfterSchoolHome.pdf")
OUT = os.path.dirname(__file__)
IMG_DIR = os.path.join(OUT, "images")
os.makedirs(IMG_DIR, exist_ok=True)

doc = fitz.open(PDF)
summary = {"page_count": doc.page_count, "pages": []}

for pno, page in enumerate(doc):
    rect = page.rect
    page_info = {
        "page": pno + 1,
        "width_pt": rect.width,
        "height_pt": rect.height,
        "text_runs": [],
        "drawings": [],
        "images": [],
    }
    # Text runs
    d = page.get_text("dict")
    for block in d.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                color_int = span.get("color", 0)
                r = (color_int >> 16) & 255
                g = (color_int >> 8) & 255
                b = color_int & 255
                page_info["text_runs"].append({
                    "text": span.get("text", ""),
                    "font": span.get("font", ""),
                    "size": round(span.get("size", 0), 2),
                    "flags": span.get("flags"),
                    "color": f"#{r:02x}{g:02x}{b:02x}",
                    "bbox": [round(v, 2) for v in span.get("bbox", [])],
                })
    # Drawings (vectors)
    try:
        drawings = page.get_drawings()
        for dr in drawings:
            item = {
                "type": dr.get("type"),
                "fill": dr.get("fill"),
                "stroke": dr.get("color"),
                "width": dr.get("width"),
                "rect": [round(v, 2) for v in dr.get("rect", fitz.Rect())] if dr.get("rect") else None,
                "items_count": len(dr.get("items", [])),
            }
            page_info["drawings"].append(item)
    except Exception as e:
        page_info["drawings_error"] = str(e)
    # Images
    imgs = page.get_images(full=True)
    for idx, img in enumerate(imgs):
        xref = img[0]
        try:
            pix = fitz.Pixmap(doc, xref)
            if pix.n - pix.alpha >= 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            name = f"page{pno+1:02d}_img{idx+1:02d}.png"
            pix.save(os.path.join(IMG_DIR, name))
            page_info["images"].append({"file": name, "width": pix.width, "height": pix.height, "xref": xref})
            pix = None
        except Exception as e:
            page_info["images"].append({"xref": xref, "error": str(e)})
    # Render page thumbnail for visual reference (150 dpi)
    try:
        mat = fitz.Matrix(150 / 72, 150 / 72)
        pix = page.get_pixmap(matrix=mat)
        pix.save(os.path.join(IMG_DIR, f"page{pno+1:02d}_full.png"))
    except Exception as e:
        page_info["render_error"] = str(e)
    summary["pages"].append(page_info)

with open(os.path.join(OUT, "parsed.json"), "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2, ensure_ascii=False)

# Compact summary print
print(f"Pages: {summary['page_count']}")
for p in summary["pages"]:
    print(f"  Page {p['page']}: {p['width_pt']}x{p['height_pt']} pt | text_runs={len(p['text_runs'])} drawings={len(p['drawings'])} images={len(p['images'])}")
