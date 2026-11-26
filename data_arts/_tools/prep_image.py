#!/usr/bin/env python3
"""Make an image web-ready for a Data Arts issue.

    python3 -I data_arts/_tools/prep_image.py SOURCE DEST [--max-width 1600]

- Applies the EXIF orientation, then drops ALL metadata (EXIF, GPS, XMP,
  ICC comments), so phone photos never publish where they were taken.
- Scales down to --max-width (never up).
- Photos (and anything saved as .jpg) become progressive JPEG, stepping the
  quality down until the file is under 450 KB. Graphics with transparency
  stay PNG (DEST must end in .png), quantized if needed to fit.
- Prints "WIDTHxHEIGHT BYTES" for the issue's width/height attributes.
"""

import argparse
import io
import sys

from PIL import Image, ImageOps

LIMIT = 450 * 1024


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("dest")
    ap.add_argument("--max-width", type=int, default=1600)
    args = ap.parse_args()

    img = Image.open(args.source)
    img = ImageOps.exif_transpose(img)
    if img.width > args.max_width:
        h = round(img.height * args.max_width / img.width)
        img = img.resize((args.max_width, h), Image.LANCZOS)

    # Rebuild from raw pixels so no metadata can ride along.
    if img.mode not in ("RGB", "RGBA", "L", "LA"):
        img = img.convert("RGBA" if "A" in img.getbands() or "transparency" in img.info else "RGB")
    clean = Image.frombytes(img.mode, img.size, img.tobytes())

    dest = args.dest.lower()
    if dest.endswith(".png"):
        data = save_png(clean)
    elif dest.endswith((".jpg", ".jpeg")):
        data = save_jpeg(clean)
    else:
        print("DEST must end in .jpg, .jpeg or .png", file=sys.stderr)
        return 2

    if len(data) > LIMIT:
        print(f"still {len(data) // 1024} KB after compression; try --max-width 1200", file=sys.stderr)
        return 1
    with open(args.dest, "wb") as f:
        f.write(data)
    print(f"{clean.width}x{clean.height} {len(data)}")
    return 0


def save_jpeg(img: Image.Image) -> bytes:
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (17, 19, 24))  # page background
        bg.paste(img, mask=img.convert("RGBA").split()[-1])
        img = bg
    data = b""
    for q in (86, 80, 74, 68, 62, 56):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        data = buf.getvalue()
        if len(data) <= LIMIT:
            break
    return data


def save_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    if len(data) > LIMIT:
        q = img.convert("RGBA").quantize(colors=256, method=Image.FASTOCTREE)
        buf = io.BytesIO()
        q.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
    return data


if __name__ == "__main__":
    sys.exit(main())
