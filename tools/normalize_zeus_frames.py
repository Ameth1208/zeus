#!/usr/bin/env python3
"""Normalise the Zeus mascot frames for crisp rendering across desktop and mobile.

The source frames in assets/zeus/ are 1122x1402 illustrations:
- idle.png: Sitting puppy with bright blue eyes & collar
- working.png: Puppy typing on a glowing laptop
- thinking.png: Puppy with paw on chin looking up
- look_left.png: Eyes looking left
- look_right.png: Eyes looking right
- sleep.png: Curled up asleep
- error.png: Sad drooping puppy eyes
- blink.png: Smiling closed happy eyes
- waiting_aproval.png: Alert attentive pose

This pipeline:
  1. Computes the collective bounding box across all frames so all states
     share identical scale, horizon and grounding.
  2. Places each frame centered with gentle padding on a square canvas.
  3. Preserves the deep rich jet-black fur and brilliant neon cyan/blue rim light.
  4. Exports crisp 512x512 RGBA PNGs to the desktop public/ and mobile assets dirs.
"""

from __future__ import annotations

import os
from PIL import Image

SRC = os.path.join("assets", "zeus")
DESKTOP_OUT = os.path.join("apps", "desktop-windows", "public")
MOBILE_OUT = os.path.join("apps", "mobile", "assets", "images")

FRAMES = [
    "idle.png",
    "working.png",
    "thinking.png",
    "look_left.png",
    "look_right.png",
    "sleep.png",
    "error.png",
    "blink.png",
    "waiting_aproval.png",
]

SIZE = 512


def main() -> None:
    for dest in (DESKTOP_OUT, MOBILE_OUT):
        os.makedirs(dest, exist_ok=True)

    # 1. Measure collective bounding box of the illustration set
    min_x, min_y, max_x, max_y = 9999, 9999, 0, 0
    images: dict[str, Image.Image] = {}

    for name in FRAMES:
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        images[name] = im
        bx = im.getbbox()
        if bx:
            min_x = min(min_x, bx[0])
            min_y = min(min_y, bx[1])
            max_x = max(max_x, bx[2])
            max_y = max(max_y, bx[3])

    content_w = max_x - min_x
    content_h = max_y - min_y
    max_dim = max(content_w, content_h)

    # Add 5% breathing room so rim lighting and ears don't touch edges
    canvas_dim = int(max_dim * 1.05)

    x_offset = (canvas_dim - content_w) // 2 - min_x
    y_offset = (canvas_dim - content_h) // 2 - min_y

    print(f"Normalizing {len(images)} frames (content: {content_w}x{content_h} -> {SIZE}x{SIZE})...")

    for name, im in images.items():
        sq = Image.new("RGBA", (canvas_dim, canvas_dim), (0, 0, 0, 0))
        sq.paste(im, (x_offset, y_offset), im)
        out = sq.resize((SIZE, SIZE), Image.LANCZOS)

        for dest in (DESKTOP_OUT, MOBILE_OUT):
            out.save(os.path.join(dest, name), optimize=True)
        print(f"  {name:22} -> {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()

