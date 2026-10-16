#!/usr/bin/env python3
"""Check shipped otter cutouts have alpha, safe padding, and balanced framing."""
import pathlib
import struct
import subprocess

ASSETS = pathlib.Path(__file__).parents[1] / "src/assets/otter"
panels = []
for name in ("A1", "A2", "B1", "B2", "C1", "C2"):
    path = ASSETS / f"{name}.png"
    data = path.read_bytes()
    width, height = struct.unpack_from(">II", data, 16)
    rgba = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgba", "-"
    ])
    alpha = rgba[3::4]
    assert len(alpha) == width * height, f"{name}: invalid decoded dimensions"
    xs = [i % width for i, a in enumerate(alpha) if a > 127]
    ys = [i // width for i, a in enumerate(alpha) if a > 127]
    assert min(alpha) == 0, f"{name}: no transparent pixels"
    bounds = min(xs), min(ys), max(xs), max(ys)
    assert bounds[0] > 0 and bounds[1] > 0 and bounds[2] < width - 1 and bounds[3] < height - 1, f"{name}: subject touches canvas edge"
    cx = (bounds[0] + bounds[2] + 1) / (2 * width)
    cy = (bounds[1] + bounds[3] + 1) / (2 * height)
    panels.append((name, cx, cy, (bounds[2] - bounds[0] + 1) / width, (bounds[3] - bounds[1] + 1) / height))
assert all(abs(cx - .5) < .015 and abs(cy - .5) < .015 for _, cx, cy, _, _ in panels), panels
assert max(p[3] for p in panels) - min(p[3] for p in panels) < .08, panels
assert max(p[4] for p in panels) - min(p[4] for p in panels) < .08, panels
print("PASS: six alpha cutouts have transparent padding and centered, consistent bounds")
for panel in panels:
    print(panel)
