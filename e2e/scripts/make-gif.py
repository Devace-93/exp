"""Assemble demo frames (from record-demo.ts) into an optimized GIF.

    uv run --with pillow e2e/scripts/make-gif.py e2e/demo-frames docs/demo.gif
"""
import json
import sys
from pathlib import Path

from PIL import Image

frames_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
width = int(sys.argv[3]) if len(sys.argv) > 3 else 960

meta = json.loads((frames_dir / "frames.json").read_text())
images, durations = [], []
for f in meta:
    img = Image.open(f["file"]).convert("RGB")
    h = round(img.height * width / img.width)
    img = img.resize((width, h), Image.LANCZOS)
    images.append(img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations.append(int(f["hold"]))

out.parent.mkdir(parents=True, exist_ok=True)
images[0].save(out, save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"{out}: {len(images)} frames, {out.stat().st_size / 1024:.0f} KiB")
