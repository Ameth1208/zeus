#!/usr/bin/env python3
"""Normalise the Zeus mascot frames so they survive the island.

The source frames in assets/zeus/ are 1122x1402 illustrations: lots of empty
padding, inconsistent framing between states, and a near-black body that
disappears against the island's #000 body. Dropped into a 58 px slot they turn
into an unreadable blob.

This script does three things, in order:

  1. crops to the head (the only part that reads at island scale), with a
     per-state override for poses where a top slice catches nothing
  2. normalises framing so every state sits at the same scale and position
  3. lifts the body off pure black and punches the blue rim light, so the
     silhouette separates from the island

Usage:  python tools/normalize_zeus_frames.py
Outputs 256x256 RGBA into the desktop public/ dir and the mobile assets dir.
"""

from __future__ import annotations

import os
from PIL import Image
import numpy as np

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

OUT_NAME = {
    "idle.png": "idle.png",
    "working.png": "working.png",
    "thinking.png": "thinking.png",
    "look_left.png": "look_left.png",
    "look_right.png": "look_right.png",
    "sleep.png": "sleep.png",
    "error.png": "error.png",
    "blink.png": "blink.png",
    "waiting_aproval.png": "waiting_aproval.png",
}

SIZE = 256

# States whose pose does not put the head in the top slice.
# (top fraction, side fraction) — 1.0 means "keep the whole frame".
CROP: dict[str, tuple[float, float]] = {
    "sleep.png": (1.0, 1.0),
}


def crop_for(name: str) -> Image.Image:
    im = Image.open(os.path.join(SRC, name)).convert("RGBA")
    im = im.crop(im.getbbox())
    top_frac, _ = CROP.get(name, (0.62, 0.90))
    if top_frac >= 1.0:
        return im
    w, h = im.size
    head_h = int(h * top_frac)
    head_w = min(w, int(head_h * 1.30))
    x0 = (w - head_w) // 2
    y0 = int(h * 0.01)
    return im.crop((x0, y0, x0 + head_w, min(y0 + head_h, h)))


def flatten(im: Image.Image) -> Image.Image:
    """Square-pad, resize, and re-tone for legibility on a #000 island."""
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    a = np.array(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3:4] / 255.0

    # Lift the body off pure black and add headroom.
    rgb = np.clip((rgb - 14.0) * 1.34 + 46.0, 0, 255)

    # Punch saturation so the blue rim light survives downscaling.
    mx = rgb.max(axis=2, keepdims=True)
    mn = rgb.min(axis=2, keepdims=True)
    spread = mx - mn
    rgb = np.clip(rgb + (spread * 1.55 - spread) * 0.5, 0, 255)

    return Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA")


def main() -> None:
    for dest in (DESKTOP_OUT, MOBILE_OUT):
        os.makedirs(dest, exist_ok=True)
    for name in FRAMES:
        out = flatten(crop_for(name))
        for dest in (DESKTOP_OUT, MOBILE_OUT):
            out.save(os.path.join(dest, OUT_NAME[name]))
        print(f"  {name:22} -> {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()
