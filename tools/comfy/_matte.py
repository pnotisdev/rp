"""Background matte for sprite generation: cut a solid-colour backdrop to transparency with
clean edges. Called by make-sprites.mjs.

    python _matte.py <in.png> <out.png> [model]

Steps: BiRefNet (or another rembg model) mask -> erode the alpha ~1px -> decontaminate, i.e.
remove the known background colour's contribution from every semi-transparent edge pixel
(F = (C - (1-a)*bg) / a). The backdrop colour is sampled from the image's own border, so this
works whether the sprite was rendered on grey, green, white, anything.
"""
import sys, io
import numpy as np
from PIL import Image, ImageFilter
from rembg import remove, new_session

inp, outp = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else "birefnet-general"

raw = open(inp, "rb").read()
src = np.asarray(Image.open(inp).convert("RGB"))
ring = np.concatenate([
    src[:6].reshape(-1, 3), src[-6:].reshape(-1, 3),
    src[:, :6].reshape(-1, 3), src[:, -6:].reshape(-1, 3),
])
bg = np.median(ring, axis=0).astype(np.float32)

rgba = Image.open(io.BytesIO(remove(raw, session=new_session(model), post_process_mask=True))).convert("RGBA")
a = np.asarray(rgba.split()[3]).astype(np.float32) / 255.0
rgb = np.asarray(rgba.convert("RGB")).astype(np.float32)

# erode ~1px (MinFilter 3) then nudge partial edges toward 0 so the outermost blended ring drops out
am = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))
a = np.clip(np.asarray(am).astype(np.float32) / 255.0 - 5.0 / 255.0, 0.0, 1.0)

a3 = a[..., None]
with np.errstate(divide="ignore", invalid="ignore"):
    fg = np.where(a3 > 0.004, (rgb - (1.0 - a3) * bg) / np.maximum(a3, 1e-4), rgb)
out = np.dstack([np.clip(fg, 0, 255), a * 255]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(outp)
