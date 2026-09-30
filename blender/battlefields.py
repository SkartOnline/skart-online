"""
Skart 2 — battlefield card art, rendered from the stage's own grounds.

    cd SkartCF && npm run looks                                          # refresh blender/grounds.json
    blender -b --factory-startup -P blender/battlefields.py              # every battlefield without art
    blender -b --factory-startup -P blender/battlefields.py -- kodret    # just these
    blender -b --factory-startup -P blender/battlefields.py -- --force   # overwrite what is there

Writes `SkartCF/src/ui/art/<locationId>.webp`. Each is a small vignette of the
battlefield as the 3D board draws it — its faceted ground palette, its sky and
sun, its props where `ground.ts` scatters them — around two slabs and the strip
of beaten earth between them, so the card and the board are the same place.
Nothing here decides a battlefield's look: `grounds.json` comes from
`src/ui/stage/ground.ts`. Hand-made art is never overwritten without --force.
"""

import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.normpath(os.path.join(HERE, "..", "SkartCF", "src", "ui", "art"))
SIZE = (480, 360)

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
FORCE = "--force" in ARGS
ONLY = [a for a in ARGS if not a.startswith("--")]


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


MATS = {}


def mat(color, glow=0.0, rough=0.85):
    key = (color, glow, rough)
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(f"m{len(MATS)}")
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(color)
    b.inputs["Roughness"].default_value = rough
    if glow:
        b.inputs["Emission Color"].default_value = srgb(color)
        b.inputs["Emission Strength"].default_value = glow
    MATS[key] = m
    return m


def part(kind, dims, m, loc, rot=(0, 0, 0), scale=(1, 1, 1)):
    """A primitive in Blender coordinates (Z up)."""
    bm = bmesh.new()
    if kind == "cyl":
        top, bottom, h, seg = dims
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=bottom, radius2=top, depth=h)
    elif kind == "ico":
        bmesh.ops.create_icosphere(bm, subdivisions=dims[1] + 1, radius=dims[0])
    else:
        bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new("p")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    ob = bpy.data.objects.new("p", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = scale
    return ob


def prop(kind, x, y, z, s, turn, leaf, stone):
    """The props of `models.tsx`, in the same proportions."""
    at = lambda dz: (x, y, z + dz * s)
    sc = lambda *v: tuple(c * s for c in v)
    trunk = mat("#6b4a2e")
    if kind == "pine":
        part("cyl", (0.06, 0.08, 0.35, 5), trunk, at(0.17), scale=sc(1, 1, 1))
        for dz, r, h in ((0.55, 0.45, 0.55), (0.85, 0.35, 0.45), (1.1, 0.24, 0.4)):
            part("cyl", (0.0, r, h, 7), mat("#2f6b3e"), at(dz), (0, 0, turn), sc(1, 1, 1))
    elif kind == "round":
        part("cyl", (0.06, 0.08, 0.6, 5), trunk, at(0.3), scale=sc(1, 1, 1))
        part("ico", (0.45, 1), mat(leaf), at(0.85), (0, 0, turn), sc(1, 1, 0.85))
        part("ico", (0.26, 1), mat(leaf), (x + 0.22 * s, y - 0.1 * s, z + 0.7 * s), scale=sc(1, 1, 1))
    elif kind == "dead":
        wood = mat("#4a3a2e")
        part("cyl", (0.04, 0.08, 0.9, 5), wood, at(0.45), scale=sc(1, 1, 1))
        part("cyl", (0.02, 0.04, 0.4, 4), wood, (x + 0.12 * s, y, z + 0.72 * s), (0, 0.8, turn), sc(1, 1, 1))
        part("cyl", (0.02, 0.035, 0.34, 4), wood, (x - 0.1 * s, y, z + 0.58 * s), (0.2, -0.9, turn), sc(1, 1, 1))
    elif kind == "rock":
        part("ico", (0.3, 0), mat(stone, rough=0.95), at(0.08), (0, 0, turn), sc(1, 0.85, 0.6))
    elif kind == "crate":
        part("box", (), mat("#8d6a44"), at(0.175), (0, 0, turn), sc(0.35, 0.35, 0.35))
        part("box", (), mat("#6a4c30"), at(0.175), (0, 0, turn), sc(0.37, 0.37, 0.06))
    elif kind == "column":
        part("cyl", (0.12, 0.14, 0.9, 6), mat(stone, rough=0.9), at(0.45), scale=sc(1, 1, 1))
        part("box", (), mat(stone, rough=0.9), at(0.92), (0, 0, turn), sc(0.32, 0.32, 0.08))


def render(entry):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 24
    scene.render.resolution_x, scene.render.resolution_y = SIZE
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 88
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    g = entry["ground"]
    rnd = random.Random(entry["id"])

    # Sky: the ground's own sky at the horizon, deepening overhead.
    w = bpy.data.worlds.new("sky")
    scene.world = w
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[0].color = srgb(g["sky"])
    top = tuple(c * 0.72 for c in srgb(g["sky"])[:3]) + (1.0,)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = top
    nt.links.new(tc.outputs["Window"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Y"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    # No world volume for the foggy fields: in EEVEE it reaches to infinity
    # and swallows the sky whole. Their palettes (pale Ködrét, dark Kesergő and
    # Umbra) already carry the gloom.

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = g["sunIntensity"] * 1.4
    sun.data.color = srgb(g["sun"])[:3]
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-38))
    scene.collection.objects.link(sun)

    # The ground: faceted, flat in the clearing, rolling away from it.
    size, n = 16.0, 22
    bm = bmesh.new()
    grid = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            x = -size / 2 + i * size / n
            y = -size / 2 + j * size / n
            x += rnd.uniform(-0.18, 0.18)
            y += rnd.uniform(-0.18, 0.18)
            d = max(0.0, math.hypot(x * 0.8, y) - 2.2)
            z = min(1.0, d / 5) ** 2 * 1.1 * (0.5 + 0.5 * noise.noise(Vector((x * 0.35, y * 0.35, 0.5))))
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(n):
        for i in range(n):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            bm.faces.new((a, b, c))
            bm.faces.new((a, c, d))
    me = bpy.data.meshes.new("ground")
    bm.to_mesh(me)
    bm.free()
    col = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
    for p in me.polygons:
        c = srgb(rnd.choice(g["grass"]))
        for li in p.loop_indices:
            col.data[li].color = c
    gm = bpy.data.materials.new("ground")
    attr = gm.node_tree.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "col"
    gb = gm.node_tree.nodes["Principled BSDF"]
    gb.inputs["Roughness"].default_value = 1.0
    gm.node_tree.links.new(attr.outputs["Color"], gb.inputs["Base Color"])
    me.materials.append(gm)
    ground = bpy.data.objects.new("ground", me)
    scene.collection.objects.link(ground)

    # The clearing: the strip of the arcvonal and a slab for each side.
    part("box", (), mat(g["path"], rough=1.0), (0, 0, 0.01), scale=(4.2, 0.55, 0.02))
    for y, rim in ((-0.95, "#e8c25a"), (0.95, "#c8453a")):
        part("cyl", (0.62, 0.68, 0.1, 4), mat("#bdb19a", rough=0.9), (0, y, 0.05), (0, 0, math.radians(45)))
        for dx, dy, sx, sy in ((0, 0.43, 0.86, 0.04), (0, -0.43, 0.86, 0.04), (0.43, 0, 0.04, 0.86), (-0.43, 0, 0.04, 0.86)):
            part("box", (), mat(rim, glow=0.6, rough=0.5), (dx, y + dy, 0.105), scale=(sx, sy, 0.012))

    for pl in entry["placed"]:
        # The stage scatters for a whole board; a card is a much smaller window,
        # so the same layout is drawn in closer around the clearing.
        x, y = pl["x"] * 0.55, -pl["z"] * 0.55
        if abs(x) > 5 or abs(y) > 5 or (abs(x) < 1.6 and abs(y) < 1.6):
            continue
        leaf = g["leaf"][pl["tint"] % len(g["leaf"])]
        prop(pl["kind"], x, y, 0.0, pl["scale"], pl["turn"], leaf, g["stone"])

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 30
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (1.7, -5.0, 2.5)
    target = Vector((0, 0.9, 0.35))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

    os.makedirs(ART, exist_ok=True)
    scene.render.filepath = os.path.join(ART, f"{entry['id']}.webp")
    bpy.ops.render.render(write_still=True)
    print("BATTLEFIELD", entry["id"])


for entry in json.load(open(os.path.join(HERE, "grounds.json"), encoding="utf-8")):
    if ONLY and entry["id"] not in ONLY:
        continue
    if os.path.exists(os.path.join(ART, f"{entry['id']}.webp")) and not FORCE:
        print("SKIP (has art)", entry["id"])
        continue
    render(entry)
