"""Stitch each body's pose stills into one sheet: blender -b -P blender/sheet.py"""
import os
import bpy

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stills")
NAMES = ["idle", "walk", "attack", "cast", "hit", "die"]
bodies = sorted({f.rsplit("_", 1)[0] for f in os.listdir(HERE) if f.endswith(".png") and not f.endswith("_sheet.png")})
for body in bodies:
    imgs = [bpy.data.images.load(os.path.join(HERE, f"{body}_{n}.png")) for n in NAMES]
    w, h = imgs[0].size
    out = bpy.data.images.new(f"{body}_sheet", w * 3, h * 2)
    px = [0.0] * (w * 3 * h * 2 * 4)
    for i, im in enumerate(imgs):
        src = list(im.pixels)
        cx, cy = (i % 3) * w, (1 - i // 3) * h
        for y in range(h):
            o = ((cy + y) * w * 3 + cx) * 4
            px[o : o + w * 4] = src[y * w * 4 : (y + 1) * w * 4]
    out.pixels = px
    out.filepath_raw = os.path.join(HERE, f"{body}_sheet.png")
    out.file_format = "PNG"
    out.save()
