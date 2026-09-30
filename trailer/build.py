"""
Skart 2 — the 3D teaser, built from nothing.

    blender -b --factory-startup -P build.py            # writes skart_teaser.blend
    blender -b skart_teaser.blend -a                    # renders frames/f_####.png
    blender -b --factory-startup -P encode.py           # frames -> skart_teaser.mp4

A Pék hídja: grass and a light wood, a river across the arcvonal that swallows
the two outer front tiles on each side (the card's szakadék), and a wooden
bridge between the middle ones. Two weaklings land in the back ranks, Felix
steps out of a portal, Umbradog arrives, its Belépő kills everything else on
the field, and Felix dives out through a portal at his side.

Everything is procedural and flat-shaded, so the look is the look the stage
plan (SkartCF/docs/stage-3d.md) is aiming at: primitives, palette, light.
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 24
END = 790  # 32.9 s
RES = (1280, 720)
random.seed(7)

# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Teaser"
coll = scene.collection
scene.frame_start, scene.frame_end = 1, END
scene.render.fps = FPS
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 16
scene.render.filepath = os.path.join(HERE, "frames", "f_")
scene.render.image_settings.file_format = "PNG"
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
except Exception as e:  # colour management is optional polish
    print("colour management:", e)


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

MATS = {}


def mat(name, color, rough=0.85, emit=None, strength=0.0, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = srgb(emit)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


def emission_key(m, value, frame):
    s = m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
    s.default_value = value
    s.keyframe_insert("default_value", frame=frame)


# ---------------------------------------------------------------------------
# Geometry helpers: every piece is a primitive, transformed, painted with one
# material slot. Several pieces go into one mesh when they move together.
# ---------------------------------------------------------------------------


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return (
        Matrix.Translation(Vector(loc))
        @ Euler(rot).to_matrix().to_4x4()
        @ Matrix.Diagonal((*scale, 1.0))
    )


class Build:
    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _slot(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _finish(self, verts, m, matrix):
        bmesh.ops.transform(self.bm, matrix=matrix, verts=verts)
        i = self._slot(m)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = i
        return self

    def cone(self, m, r1, r2, h, seg=6, **t):
        r = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h
        )
        return self._finish(r["verts"], m, M(**t))

    def ico(self, m, r, sub=1, **t):
        v = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r)["verts"]
        return self._finish(v, m, M(**t))

    def box(self, m, **t):
        v = bmesh.ops.create_cube(self.bm, size=1.0)["verts"]
        return self._finish(v, m, M(**t))

    def obj(self, name, parent=None, loc=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.location = loc
        ob.parent = parent
        return ob


def empty(name, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    coll.objects.link(ob)
    ob.location = loc
    ob.parent = parent
    return ob


def key(ob, path, value, frame):
    setattr(ob, path, value)
    ob.keyframe_insert(path, frame=frame)


def shown_from(ob, frame, until=None):
    """Hidden before `frame` (and after `until`), in the render and the viewport."""
    for f, hide in ((1, True), (frame, False)) + (((until, True),) if until else ()):
        ob.hide_render = hide
        ob.hide_viewport = hide
        ob.keyframe_insert("hide_render", frame=f)
        ob.keyframe_insert("hide_viewport", frame=f)
    for child in ob.children:
        shown_from(child, frame, until)


def hide_from(ob, frame):
    for f, hide in ((frame - 1, False), (frame, True)):
        ob.hide_render = hide
        ob.hide_viewport = hide
        ob.keyframe_insert("hide_render", frame=f)
        ob.keyframe_insert("hide_viewport", frame=f)
    for child in ob.children:
        hide_from(child, frame)


def linear_keys(on=True):
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR" if on else "BEZIER"


# ---------------------------------------------------------------------------
# The land
# ---------------------------------------------------------------------------

COLX = {1: -2.4, 2: 0.0, 3: 2.4}
RANKY = {"F": 2.6, "B": 4.9}


def tile_xy(player, slot):
    rank, col = slot[0], int(slot[1])
    y = RANKY[rank] * (-1 if player == "p1" else 1)
    return COLX[col], y


def river_center(x):
    return 0.35 * math.sin(x * 0.22)


def river_half(x):
    ax = abs(x)
    return 1.15 + 2.35 * sstep(0.9, 2.6, ax) - 1.6 * sstep(4.6, 7.8, ax)


def land_height(x, y):
    far = max(abs(x) / 1.0, abs(y) / 1.1)
    amp = 0.12 + 3.2 * sstep(8, 20, far)
    n = 0.5 + 0.5 * noise.noise(Vector((x * 0.11, y * 0.11, 0.37)))
    jitter = 0.05 * noise.noise(Vector((x * 0.9, y * 0.9, 2.1)))
    board = max(sstep(3.7, 5.2, abs(x)), sstep(6.3, 7.8, abs(y)))
    return lerp(0.0, amp * n, board) + jitter


def height(x, y):
    d = abs(y - river_center(x)) - river_half(x)
    t = sstep(-0.95, 0.3, d)
    return lerp(-0.95, land_height(x, y), t), d


GRASS = [srgb(h) for h in ("#6fae4a", "#78b84f", "#63a444", "#86c05a", "#72b04c")]
SAND, BED, HILL = srgb("#cdb77e"), srgb("#6f6450"), srgb("#8fbf55")


def build_terrain():
    size, step = 64.0, 0.5
    n = int(size / step) + 1
    bm = bmesh.new()
    grid = []
    for j in range(n):
        row = []
        for i in range(n):
            x, y = -size / 2 + i * step, -size / 2 + j * step
            # A little horizontal wobble keeps the triangles from reading as a grid.
            x += 0.18 * noise.noise(Vector((x * 1.7, y * 1.7, 5.0)))
            y += 0.18 * noise.noise(Vector((x * 1.7, y * 1.7, 9.0)))
            row.append(bm.verts.new((x, y, height(x, y)[0])))
        grid.append(row)
    for j in range(n - 1):
        for i in range(n - 1):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            if (i + j) % 2:
                bm.faces.new((a, b, c))
                bm.faces.new((a, c, d))
            else:
                bm.faces.new((a, b, d))
                bm.faces.new((b, c, d))
    me = bpy.data.meshes.new("terrain")
    bm.to_mesh(me)
    bm.free()
    col = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
    for p in me.polygons:
        cx, cy, cz = p.center
        d = abs(cy - river_center(cx)) - river_half(cx)
        if cz < -0.3:
            c = BED
        elif d < 0.55 and cz < 0.14:
            c = SAND
        elif cz > 1.2:
            c = tuple(lerp(a, b, 0.5) for a, b in zip(random.choice(GRASS), HILL))
        else:
            c = random.choice(GRASS)
        for li in p.loop_indices:
            col.data[li].color = c
    m = bpy.data.materials.new("ground")
    nt = m.node_tree
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "col"
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.95
    nt.links.new(attr.outputs["Color"], b.inputs["Base Color"])
    me.materials.append(m)
    ob = bpy.data.objects.new("terrain", me)
    coll.objects.link(ob)


def build_water():
    me = bpy.data.meshes.new("water")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=32)
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new("water")
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb("#3d95b8")
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Emission Color"].default_value = srgb("#2f7fa6")
    b.inputs["Emission Strength"].default_value = 0.15
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.6
    nz.inputs["Detail"].default_value = 3.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    # The river runs along x; slide the ripples downstream.
    linear_keys(True)
    loc = mp.inputs["Location"]
    loc.default_value = (0, 0, 0)
    loc.keyframe_insert("default_value", frame=1)
    loc.default_value = (-9, 0, 0)
    loc.keyframe_insert("default_value", frame=END)
    linear_keys(False)
    me.materials.append(m)
    ob = bpy.data.objects.new("water", me)
    ob.location = (0, 0, -0.32)
    coll.objects.link(ob)


def build_tiles():
    stone = [mat(f"stone{i}", c, 0.9) for i, c in enumerate(("#bdb19a", "#b3a78f", "#c4b9a3"))]
    rims = {
        "p1": mat("rim_p1", "#e8c25a", 0.4, "#ffcf5a", 1.6),
        "p2": mat("rim_p2", "#c8453a", 0.4, "#ff4a3a", 1.6),
    }
    for player in ("p1", "p2"):
        for slot in ("F2", "B1", "B2", "B3"):
            x, y = tile_xy(player, slot)
            b = Build().box(random.choice(stone), loc=(0, 0, 0.06), scale=(2.0, 2.0, 0.24))
            rim = rims[player]
            for sx, sy, px, py in ((2.0, 0.07, 0, 0.97), (2.0, 0.07, 0, -0.97), (0.07, 2.0, 0.97, 0), (0.07, 2.0, -0.97, 0)):
                b.box(rim, loc=(px, py, 0.19), scale=(sx, sy, 0.03))
            ob = b.obj(f"tile_{player}_{slot}", loc=(x, y, 0))
            ob.rotation_euler.z = random.uniform(-0.02, 0.02)
            bev = ob.modifiers.new("bevel", "BEVEL")
            bev.width, bev.segments = 0.05, 1
    # The szakadék: F1 and F3 are river. What was there is broken and half drowned.
    for player in ("p1", "p2"):
        for slot in ("F1", "F3"):
            x, y = tile_xy(player, slot)
            for k in range(2):
                Build().box(
                    random.choice(stone),
                    rot=(random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.uniform(0, 3)),
                    scale=(random.uniform(0.6, 1.1), random.uniform(0.5, 0.9), 0.2),
                ).obj(f"wreck_{player}_{slot}_{k}", loc=(x + random.uniform(-0.5, 0.5), y + random.uniform(-0.4, 0.4), -0.35))
    return rims


def build_bridge():
    wood = mat("wood", "#8d5c34", 0.9)
    dark = mat("wood_dark", "#5f3d22", 0.9)
    half, width = 1.95, 1.3
    b = Build()

    def deck_z(y):
        return 0.14 + 0.38 * (1 - (y / half) ** 2)

    planks = 13
    for k in range(planks):
        y = -half + (k + 0.5) * (2 * half / planks)
        slope = math.atan(-2 * 0.38 * y / half**2)
        b.box(
            wood if k % 3 else dark,
            loc=(random.uniform(-0.03, 0.03), y, deck_z(y)),
            rot=(slope, 0, random.uniform(-0.03, 0.03)),
            scale=(width * random.uniform(0.95, 1.02), 2 * half / planks * 0.9, 0.08),
        )
    for x in (-0.55, 0.55):  # stringers under the deck
        for k in range(6):
            y0, y1 = -half + k * (2 * half / 6), -half + (k + 1) * (2 * half / 6)
            ym = (y0 + y1) / 2
            b.box(dark, loc=(x, ym, deck_z(ym) - 0.1), rot=(math.atan(-2 * 0.38 * ym / half**2), 0, 0), scale=(0.12, y1 - y0 + 0.02, 0.12))
    posts = [-1.85, -0.95, 0.0, 0.95, 1.85]
    for x in (-0.66, 0.66):
        for y in posts:
            b.box(dark, loc=(x, y, deck_z(y) + 0.3), scale=(0.1, 0.1, 0.62))
        for y0, y1 in zip(posts, posts[1:]):
            ym = (y0 + y1) / 2
            z0, z1 = deck_z(y0) + 0.56, deck_z(y1) + 0.56
            b.box(wood, loc=(x, ym, (z0 + z1) / 2), rot=(math.atan2(z1 - z0, y1 - y0), 0, 0), scale=(0.07, y1 - y0 + 0.08, 0.07))
    for y in (-0.9, 0.9):  # piles in the river
        for x in (-0.55, 0.55):
            b.cone(dark, 0.09, 0.09, 1.2, seg=6, loc=(x, y, -0.35))
    b.obj("bridge")


# ---------------------------------------------------------------------------
# Trees, rocks, flowers
# ---------------------------------------------------------------------------


def tree_meshes():
    trunk = mat("trunk", "#6b4a2e")
    pine = mat("pine", "#2f6b3e")
    leaf = [mat("leaf_a", "#5c9e3c"), mat("leaf_b", "#6fb046"), mat("leaf_c", "#4f8f38")]
    gold = mat("leaf_gold", "#d2a53c")
    out = []
    b = Build().cone(trunk, 0.13, 0.1, 0.7, loc=(0, 0, 0.35))
    for i, (r, z) in enumerate(((0.95, 0.95), (0.75, 1.55), (0.5, 2.1))):
        b.cone(pine, r, 0.0, 1.0, seg=7, loc=(0, 0, z), rot=(0, 0, i * 0.4))
    out.append(("pine", b.obj("tpl_pine")))
    for k, lm in enumerate(leaf + [gold]):
        b = Build().cone(trunk, 0.14, 0.09, 1.1, loc=(0, 0, 0.55))
        b.ico(lm, 0.85, loc=(0, 0, 1.55), scale=(1, 1, 0.85))
        b.ico(lm, 0.5, loc=(0.45, 0.2, 1.3), scale=(1, 1, 0.8))
        out.append(("round", b.obj(f"tpl_round{k}")))
    rock = mat("rock", "#8e8a82", 0.95)
    for k in range(3):
        b = Build().ico(rock, 0.5, sub=1, scale=(1.0, 0.8, 0.55))
        ob = b.obj(f"tpl_rock{k}")
        for v in ob.data.vertices:
            v.co += Vector([random.uniform(-0.08, 0.08) for _ in range(3)])
        out.append(("rock", ob))
    for ob in (o for _, o in out):
        ob.location = (0, 0, -100)
    return out


def scatter():
    tpls = tree_meshes()
    trees = [o for k, o in tpls if k != "rock"]
    rocks = [o for k, o in tpls if k == "rock"]
    placed = []

    def free(x, y, r):
        if abs(x) < 4.4 and abs(y) < 6.7:
            return False
        if abs(x) < 6.5 and -18 < y < -6.0:  # the game camera looks through here
            return False
        if abs(x) < 3.8 and 6.0 < y < 12.5:  # keep the sky clear behind Umbradog
            return False
        if abs(y - river_center(x)) < river_half(x) + 0.7:
            return False
        return all((x - px) ** 2 + (y - py) ** 2 > (r + pr) ** 2 for px, py, pr in placed)

    tries = 0
    while len(placed) < 95 and tries < 6000:
        tries += 1
        x, y = random.uniform(-30, 30), random.uniform(-30, 30)
        dist = math.hypot(x, y * 0.9)
        # Light woodland: a few trees near the board to frame it, thicker further out.
        if random.random() > 0.25 + 0.6 * sstep(6, 18, dist):
            continue
        s = random.uniform(0.8, 1.45)
        if not free(x, y, 1.1 * s):
            continue
        placed.append((x, y, 1.1 * s))
        tpl = random.choice(trees[:1] * 2 + trees[1:4] * 2 + trees[4:])
        ob = tpl.copy()
        coll.objects.link(ob)
        ob.location = (x, y, height(x, y)[0] - 0.05)
        ob.rotation_euler.z = random.uniform(0, 6.28)
        ob.scale = (s, s, s * random.uniform(0.9, 1.15))
    for _ in range(40):
        x, y = random.uniform(-22, 22), random.uniform(-22, 22)
        if abs(x) < 3.8 and abs(y) < 6.3:
            continue
        ob = random.choice(rocks).copy()
        coll.objects.link(ob)
        h, d = height(x, y)
        ob.location = (x, y, h - 0.1)
        s = random.uniform(0.4, 1.3) * (1.4 if d < 0.6 else 1)
        ob.scale = (s, s, s)
        ob.rotation_euler.z = random.uniform(0, 6.28)
    flower = [mat("fl_w", "#f4efe2"), mat("fl_y", "#f1cf4b"), mat("fl_p", "#c889d8")]
    b = Build()
    for _ in range(260):
        x, y = random.uniform(-14, 14), random.uniform(-14, 14)
        if (abs(x) < 3.5 and abs(y) < 6.1) or abs(y - river_center(x)) < river_half(x) + 0.4:
            continue
        b.ico(random.choice(flower), 0.06, sub=0, loc=(x, y, height(x, y)[0] + 0.05))
        b.cone(MATS["leaf_c"], 0.1, 0.0, 0.25, seg=3, loc=(x + 0.12, y, height(x, y)[0] + 0.1))
    b.obj("meadow")


# ---------------------------------------------------------------------------
# Units. Each is facing +y; the far side is turned round.
# ---------------------------------------------------------------------------

SKIN = "#f0c8a2"


def humanoid_base(b, tunic, legs, arms=None, height=1.0):
    skin = mat("skin", SKIN, 0.7)
    eye = mat("eye", "#1b1b1f", 0.4)
    arms = arms or tunic
    b.cone(legs, 0.09, 0.08, 0.55, loc=(-0.12, 0, 0.28))
    b.cone(legs, 0.09, 0.08, 0.55, loc=(0.12, 0, 0.28))
    b.ico(legs, 0.1, sub=0, loc=(-0.12, 0.05, 0.03), scale=(1, 1.4, 0.5))
    b.ico(legs, 0.1, sub=0, loc=(0.12, 0.05, 0.03), scale=(1, 1.4, 0.5))
    b.cone(tunic, 0.3, 0.23, 0.6, seg=8, loc=(0, 0, 0.82))
    b.ico(tunic, 0.24, loc=(0, 0, 1.1), scale=(1.15, 0.8, 0.5))
    for s in (-1, 1):
        b.cone(arms, 0.08, 0.065, 0.5, loc=(s * 0.33, 0.02, 0.86), rot=(0, s * 0.18, 0))
        b.ico(skin, 0.07, sub=1, loc=(s * 0.38, 0.03, 0.6))
    b.ico(skin, 0.19, sub=1, loc=(0, 0, 1.38))
    for s in (-1, 1):
        b.ico(eye, 0.025, sub=0, loc=(s * 0.065, 0.17, 1.4))
    return b


def peasant(parent):
    b = Build()
    humanoid_base(b, mat("tunic_green", "#4e8a3a"), mat("breeches", "#6b4a30"))
    straw = mat("straw", "#dcbd5f")
    b.cone(straw, 0.34, 0.06, 0.16, seg=8, loc=(0, 0, 1.55))
    b.cone(mat("belt", "#4a3322"), 0.25, 0.25, 0.05, seg=8, loc=(0, 0, 0.72))
    pole = mat("pole", "#8a6a45")
    iron = mat("iron", "#7c7f86", 0.4, metal=0.8)
    b.cone(pole, 0.025, 0.025, 1.5, loc=(-0.4, 0.08, 0.85))
    b.box(iron, loc=(-0.4, 0.08, 1.6), scale=(0.24, 0.03, 0.03))
    for dx in (-0.1, 0, 0.1):
        b.cone(iron, 0.015, 0.0, 0.22, seg=4, loc=(-0.4 + dx, 0.08, 1.72))
    return b.obj("peasant_mesh", parent)


def bandit(parent):
    b = Build()
    cloth = mat("bandit_red", "#7c2433")
    humanoid_base(b, cloth, mat("bandit_dark", "#2c2a30"))
    b.cone(cloth, 0.25, 0.02, 0.55, seg=7, loc=(0, -0.03, 1.5))  # hood
    b.box(mat("mask", "#262428"), loc=(0, 0.14, 1.32), scale=(0.3, 0.1, 0.12))
    b.cone(mat("cloak", "#3a2a2e"), 0.4, 0.2, 0.95, seg=7, loc=(0, -0.08, 0.62), scale=(1, 0.7, 1))
    steel = mat("steel", "#c7ccd4", 0.25, metal=0.9)
    b.cone(steel, 0.04, 0.0, 0.3, seg=4, loc=(0.38, 0.12, 0.72), rot=(0.4, 0, 0))
    return b.obj("bandit_mesh", parent)


def felix(parent):
    robe = mat("felix_robe", "#2e50a6", 0.8)
    gold = mat("gold", "#e4b53d", 0.35, metal=0.7)
    hair = mat("hair", "#f3d46a", 0.75)
    b = Build()
    humanoid_base(b, robe, robe)
    b.cone(robe, 0.43, 0.2, 1.0, seg=8, loc=(0, 0, 0.52))  # the robe over the legs
    b.cone(gold, 0.45, 0.44, 0.07, seg=8, loc=(0, 0, 0.05))
    b.cone(gold, 0.245, 0.245, 0.06, seg=8, loc=(0, 0, 0.93))
    b.cone(mat("cape", "#243f86"), 0.36, 0.22, 1.05, seg=6, loc=(0, -0.13, 0.66), scale=(1, 0.5, 1))
    # Blond and wavy: a cap of hair and a ring of curls round the back and sides.
    b.ico(hair, 0.215, loc=(0, -0.05, 1.5), scale=(1.04, 1.0, 0.7))
    for ang in range(-100, 101, 40):
        a = math.radians(ang + 90)
        for k, z in enumerate((1.4, 1.28)):
            r = 0.2 + 0.02 * k
            b.ico(hair, 0.085 - 0.01 * k, loc=(math.cos(a) * r, -math.sin(a) * r - 0.04, z + 0.02 * math.sin(ang)))
    for dx in (-0.1, 0.0, 0.1):
        b.ico(hair, 0.07, loc=(dx, 0.12, 1.55 + 0.02 * (dx == 0)))
    b.ico(hair, 0.07, loc=(0.05, 0.02, 1.6))
    staff = mat("staff", "#7a5534", 0.8)
    b.cone(staff, 0.035, 0.03, 1.7, loc=(0.42, 0.06, 0.85))
    b.cone(gold, 0.06, 0.03, 0.1, loc=(0.42, 0.06, 1.72))
    body = b.obj("felix_mesh", parent)
    crystal_mat = mat("crystal", "#9ef0ff", 0.2, "#6fe7ff", 6.0)
    c = Build().ico(crystal_mat, 0.11, sub=0, scale=(0.8, 0.8, 1.35))
    crystal = c.obj("felix_crystal", parent, loc=(0.42, 0.06, 1.88))
    light = bpy.data.lights.new("crystal_light", "POINT")
    light.color = srgb("#6fe7ff")[:3]
    light.energy = 18
    light.shadow_soft_size = 0.1
    lo = bpy.data.objects.new("crystal_light", light)
    coll.objects.link(lo)
    lo.parent = crystal
    return body, crystal, crystal_mat


def umbradog(parent):
    fur = mat("fur", "#15151b", 0.75)
    fur2 = mat("fur_hi", "#26252f", 0.8)
    b = Build()
    b.ico(fur, 1.0, loc=(0, -0.25, 1.25), scale=(0.6, 1.25, 0.58))
    b.ico(fur, 0.72, loc=(0, 0.72, 1.42), scale=(1.0, 0.95, 1.05))
    b.cone(fur, 0.46, 0.36, 0.8, seg=7, loc=(0, 1.2, 1.78), rot=(-0.85, 0, 0))
    for s in (-1, 1):
        b.cone(fur, 0.12, 0.2, 1.15, seg=6, loc=(s * 0.36, 0.85, 0.58))
        b.ico(fur2, 0.16, loc=(s * 0.36, 0.95, 0.07), scale=(1, 1.35, 0.55))
        b.ico(fur, 0.36, loc=(s * 0.34, -1.0, 1.05), scale=(0.6, 0.95, 1.0))
        b.cone(fur, 0.11, 0.17, 1.0, seg=6, loc=(s * 0.36, -1.2, 0.5), rot=(-0.15, 0, 0))
        b.ico(fur2, 0.16, loc=(s * 0.36, -1.08, 0.07), scale=(1, 1.35, 0.55))
    b.cone(fur, 0.17, 0.02, 1.2, seg=5, loc=(0, -1.85, 1.2), rot=(-2.2, 0, 0))
    # The ridge: spikes of fur from the head down the spine.
    for k in range(9):
        y = 1.45 - k * 0.3
        z = 2.05 - 0.09 * k if k < 3 else 1.85 - 0.05 * (k - 3)
        b.cone(fur2, 0.16, 0.0, 0.5 - 0.02 * k, seg=4, loc=(0, y, z), rot=(-0.7, 0, k * 0.5))
    body = b.obj("umbra_body", parent)

    head = empty("umbra_head", loc=(0, 1.5, 2.02), parent=parent)
    eyes = mat("umbra_eyes", "#ff2a1a", 0.3, "#ff1a0a", 0.0)
    bone = mat("fang", "#efe6d2", 0.5)
    h = Build()
    h.ico(fur, 0.42, loc=(0, 0.28, 0.05), scale=(0.9, 1.1, 0.85))
    h.cone(fur, 0.24, 0.12, 0.6, seg=6, loc=(0, 0.78, -0.07), rot=(-math.pi / 2, 0, 0))
    h.ico(mat("nose", "#050507", 0.3), 0.07, sub=0, loc=(0, 1.08, -0.03))
    h.box(fur2, loc=(0, 0.62, -0.25), scale=(0.3, 0.5, 0.1))
    for s in (-1, 1):
        h.cone(fur, 0.13, 0.0, 0.42, seg=4, loc=(s * 0.21, 0.12, 0.42), rot=(-0.25, s * 0.35, 0))
        h.ico(eyes, 0.065, sub=1, loc=(s * 0.17, 0.6, 0.12), scale=(1.2, 0.6, 0.7))
        h.cone(bone, 0.03, 0.0, 0.14, seg=4, loc=(s * 0.08, 0.92, -0.2), rot=(math.pi, 0, 0))
    h.obj("umbra_head_mesh", head)
    light = bpy.data.lights.new("eye_light", "POINT")
    light.color = srgb("#ff2a1a")[:3]
    light.energy = 0
    light.shadow_soft_size = 0.2
    lo = bpy.data.objects.new("eye_light", light)
    coll.objects.link(lo)
    lo.parent = head
    lo.location = (0, 1.0, 0.15)
    return body, head, eyes, light


# ---------------------------------------------------------------------------
# Effects
# ---------------------------------------------------------------------------


def puffs(center, frame, color, count=8, spread=0.9, rise=0.6, size=0.35, life=16, name="puff", emit=None):
    m = mat(f"puff_{color}", color, 1.0, emit, 0.9 if emit else 0.0)
    for k in range(count):
        a = k / count * 6.283 + random.uniform(-0.3, 0.3)
        ob = Build().ico(m, 1.0, sub=1).obj(f"{name}_{frame}_{k}")
        start = Vector(center) + Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.1))
        end = Vector(center) + Vector((math.cos(a) * spread, math.sin(a) * spread, rise * random.uniform(0.5, 1.2)))
        s = size * random.uniform(0.7, 1.3)
        key(ob, "location", start, frame)
        key(ob, "scale", (0.01, 0.01, 0.01), frame)
        key(ob, "scale", (s, s, s), frame + life // 3)
        key(ob, "location", end, frame + life)
        key(ob, "scale", (0.01, 0.01, 0.01), frame + life)
        shown_from(ob, frame, frame + life + 1)


def portal(name, loc, rot_z, open_at, close_at, flash_at=None):
    """`rot_z` turns the face of the portal away from +y; 0 faces +y, pi/2 faces -x."""
    root = empty(name, loc=loc)
    root.rotation_euler.z = rot_z
    facing = Vector((-math.sin(rot_z), math.cos(rot_z), 0))
    tilt = empty(f"{name}_tilt", parent=root)
    tilt.rotation_euler.x = math.pi / 2
    ring_m = mat("portal_ring", "#b58cff", 0.3, "#9b6bff", 9.0)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.78, minor_radius=0.07, major_segments=28, minor_segments=6)
    ring = bpy.context.active_object
    ring.name = f"{name}_ring"
    ring.data.materials.append(ring_m)
    for c in ring.users_collection:
        c.objects.unlink(ring)
    coll.objects.link(ring)
    ring.parent = tilt
    disc_m = bpy.data.materials.get("portal_disc")
    if not disc_m:
        disc_m = bpy.data.materials.new("portal_disc")
        nt = disc_m.node_tree
        nt.nodes.remove(nt.nodes["Principled BSDF"])
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Strength"].default_value = 4.0
        tc = nt.nodes.new("ShaderNodeTexCoord")
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.wave_type = "RINGS"
        wave.inputs["Scale"].default_value = 2.4
        wave.inputs["Distortion"].default_value = 6.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = srgb("#3b1f8f")
        ramp.color_ramp.elements[1].color = srgb("#8ff4ff")
        nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
        nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    d = Build()
    bmesh.ops.create_circle(d.bm, cap_ends=True, segments=28, radius=0.74)
    for f in d.bm.faces:
        f.material_index = 0
    d.mats.append(disc_m)
    disc = d.obj(f"{name}_disc", tilt)
    linear_keys(True)
    key(disc, "rotation_euler", (0, 0, 0), open_at)
    key(disc, "rotation_euler", (0, 0, -0.35 * (close_at - open_at)), close_at + 12)
    linear_keys(False)
    key(root, "scale", (0.01, 0.01, 0.01), open_at)
    key(root, "scale", (1.15, 1.15, 1.15), open_at + 9)
    key(root, "scale", (1.0, 1.0, 1.0), open_at + 13)
    key(root, "scale", (1.0, 1.0, 1.0), close_at)
    key(root, "scale", (1.2, 1.2, 1.2), close_at + 4)
    key(root, "scale", (0.01, 0.01, 0.01), close_at + 12)
    shown_from(root, open_at, close_at + 13)
    fl = bpy.data.lights.new(f"{name}_flash", "POINT")
    fl.color = srgb("#a98bff")[:3]
    fl.shadow_soft_size = 0.5
    flo = bpy.data.objects.new(f"{name}_flash", fl)
    coll.objects.link(flo)
    flo.location = Vector(loc) + 0.3 * facing
    for f, e in ((open_at - 1, 0), (open_at + 6, 350), (open_at + 20, 60), (close_at, 60), (close_at + 5, 450), (close_at + 16, 0)):
        fl.energy = e
        fl.keyframe_insert("energy", frame=f)
    if flash_at:
        fl.energy = 500
        fl.keyframe_insert("energy", frame=flash_at)
    return root


def dog_lights(frame, fade_from, fade_to):
    """A cold key from the near bank and a red rim behind, so black fur still has a shape."""
    for name, kind, color, loc, peak in (
        ("dog_key", "AREA", "#b9a8ff", (3.5, -1.5, 4.5), 500),
        ("dog_rim", "POINT", "#ff3a2a", (0.5, 7.0, 3.2), 900),
    ):
        ld = bpy.data.lights.new(name, kind)
        ld.color = srgb(color)[:3]
        if kind == "AREA":
            ld.size = 3
        lo = bpy.data.objects.new(name, ld)
        coll.objects.link(lo)
        lo.location = loc
        track = lo.constraints.new("TRACK_TO")
        track.target = bpy.data.objects["umbradog"]
        track.track_axis = "TRACK_NEGATIVE_Z"
        track.up_axis = "UP_Y"
        for f, e in ((frame - 2, 0), (frame + 6, peak), (fade_from, peak), (fade_to, 0)):
            ld.energy = e
            ld.keyframe_insert("energy", frame=f)


def land(unit, xy, rot_z, frame, beam="#ffd66a", rim=None, dust="#c9b690"):
    """A summon: a pillar of light, the unit twirling down inside it, a thump."""
    x, y = xy
    bm_ = mat(f"beam_{beam}", beam, 0.5, beam, 3.0)
    bm_.surface_render_method = "BLENDED"
    bm_.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.28
    pillar = Build().cone(bm_, 0.75, 0.75, 8.0, seg=12).obj(f"pillar_{unit.name}", loc=(x, y, 4.0))
    key(pillar, "scale", (0.01, 0.01, 1), frame - 32)
    key(pillar, "scale", (1, 1, 1), frame - 24)
    key(pillar, "scale", (1, 1, 1), frame + 2)
    key(pillar, "scale", (0.01, 0.01, 1), frame + 14)
    shown_from(pillar, frame - 32, frame + 15)
    key(unit, "location", (x, y, 3.4), frame - 24)
    key(unit, "rotation_euler", (0, 0, rot_z + 2 * math.pi), frame - 24)
    key(unit, "location", (x, y, 0.18), frame)
    key(unit, "rotation_euler", (0, 0, rot_z), frame)
    key(unit, "scale", (0.9, 0.9, 1.12), frame - 1)
    key(unit, "scale", (1.18, 1.18, 0.78), frame + 2)
    key(unit, "scale", (0.95, 0.95, 1.06), frame + 6)
    key(unit, "scale", (1, 1, 1), frame + 10)
    shown_from(unit, frame - 24)
    puffs((x, y, 0.2), frame, dust, count=10, spread=1.2, rise=0.35, size=0.22, life=18)
    if rim:
        emission_key(rim, 1.6, frame - 1)
        emission_key(rim, 7.0, frame + 2)
        emission_key(rim, 1.6, frame + 16)


def die(unit, frame, xy, away, mats):
    """Hit, thrown up and back, a flash, and the unit bursts into its own colours."""
    x, y = xy
    away = Vector((*away, 0)).normalized()
    rz = unit.rotation_euler.z
    up = Vector((x, y, 0.9)) + away * 0.45
    key(unit, "location", (x, y, 0.18), frame)
    key(unit, "scale", (1, 1, 1), frame)
    key(unit, "rotation_euler", (0, 0, rz), frame)
    key(unit, "scale", (1.3, 1.3, 0.72), frame + 2)
    key(unit, "location", (up.x, up.y, 0.75), frame + 6)
    key(unit, "scale", (0.85, 0.85, 1.25), frame + 6)
    key(unit, "rotation_euler", (-0.7, 0, rz), frame + 6)
    hide_from(unit, frame + 7)

    flash_m = mat("death_flash", "#ffe0b0", 0.5, "#ffb070", 30.0)
    flash = Build().ico(flash_m, 1.0, sub=1).obj(f"flash_{unit.name}")
    flash.location = up
    key(flash, "scale", (0.05, 0.05, 0.05), frame + 6)
    key(flash, "scale", (0.6, 0.6, 0.6), frame + 9)
    key(flash, "scale", (0.02, 0.02, 0.02), frame + 15)
    shown_from(flash, frame + 6, frame + 16)
    ld = bpy.data.lights.new(f"flash_{unit.name}", "POINT")
    ld.color = srgb("#ff7a3a")[:3]
    lo = bpy.data.objects.new(f"flashlight_{unit.name}", ld)
    coll.objects.link(lo)
    lo.location = up + Vector((0, 0, 0.3))
    for f, e in ((frame + 5, 0), (frame + 7, 1800), (frame + 18, 0)):
        ld.energy = e
        ld.keyframe_insert("energy", frame=f)

    for k in range(18):
        m = mats[k % len(mats)]
        shard = Build().ico(m, 1.0, sub=0).obj(f"shard_{unit.name}_{k}")
        a = math.atan2(away.y, away.x) + random.uniform(-1.6, 1.6)
        d = Vector((math.cos(a), math.sin(a), 0)) * random.uniform(1.0, 2.6)
        s = random.uniform(0.07, 0.14)
        lift = random.uniform(0.6, 1.5)
        key(shard, "location", up, frame + 6)
        key(shard, "scale", (s, s, s), frame + 6)
        key(shard, "rotation_euler", (0, 0, 0), frame + 6)
        key(shard, "location", up + d * 0.45 + Vector((0, 0, lift)), frame + 12)
        key(shard, "location", Vector((x, y, 0.3)) + d * 0.85, frame + 20)
        key(shard, "location", Vector((x, y, 0.12)) + d, frame + 24)
        key(shard, "rotation_euler", [random.uniform(-7, 7) for _ in range(3)], frame + 24)
        key(shard, "scale", (s, s, s), frame + 28)
        key(shard, "scale", (0.01, 0.01, 0.01), frame + 38)
        shown_from(shard, frame + 6, frame + 39)
    puffs((up.x, up.y, 0.6), frame + 7, "#2b1a3a", count=7, spread=0.9, rise=1.8, size=0.13, life=24, emit="#8a2a4a")


# ---------------------------------------------------------------------------
# The story
# ---------------------------------------------------------------------------


def world_and_sun():
    w = bpy.data.worlds.new("sky")
    scene.world = w
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.14
    ramp.color_ramp.elements[0].color = srgb("#f6e4c4")
    ramp.color_ramp.elements[1].position = 0.42
    ramp.color_ramp.elements[1].color = srgb("#78b3e4")
    mapr = nt.nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = -0.2
    mapr.inputs["From Max"].default_value = 1.0
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mapr.inputs["Value"])
    nt.links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    sun = bpy.data.lights.new("sun", "SUN")
    sun.color = srgb("#fff0d6")[:3]
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("sun", sun)
    coll.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(8), math.radians(35))
    # Day, then Umbradog's dusk, then dark.
    for f, strength, sky, tint in (
        (1, 1.0, None, "#fff0d6"),
        (364, 1.0, None, "#fff0d6"),
        (405, 0.45, None, "#d88a9a"),
        (640, 0.42, None, "#d88a9a"),
        (675, 0.0, None, "#d88a9a"),
    ):
        bg.inputs["Strength"].default_value = strength
        bg.inputs["Strength"].keyframe_insert("default_value", frame=f)
        sun.energy = 3.6 * (strength if strength < 1 else 1) * (1.0 if strength == 1.0 else 0.9)
        sun.keyframe_insert("energy", frame=f)
        sun.color = srgb(tint)[:3]
        sun.keyframe_insert("color", frame=f)
    return sun


def camera_rig():
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 32
    cam_data.clip_end = 200
    cam = bpy.data.objects.new("cam", cam_data)
    coll.objects.link(cam)
    scene.camera = cam
    target = empty("cam_target")
    tt = cam.constraints.new("TRACK_TO")
    tt.target = target
    tt.track_axis = "TRACK_NEGATIVE_Z"
    tt.up_axis = "UP_Y"
    return cam, target


def shot(cam, target, frame, pos, look, cut=False):
    """A camera key. `cut` holds the previous pose until the frame before."""
    if cut:
        for ob in (cam, target):
            ob.keyframe_insert("location", frame=frame - 1)
    key(cam, "location", pos, frame)
    key(target, "location", look, frame)


def constant_before(ob, frames):
    """Make the camera cuts hard: constant interpolation into the cut frame."""
    ad = ob.animation_data
    if not ad or not ad.action:
        return
    for fc in iter_fcurves(ad.action):
        if fc.data_path != "location":
            continue
        for kp in fc.keyframe_points:
            if int(round(kp.co.x)) + 1 in frames:
                kp.interpolation = "CONSTANT"


def iter_fcurves(action):
    if hasattr(action, "layers") and action.layers:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    yield from bag.fcurves
    elif hasattr(action, "fcurves"):
        yield from action.fcurves


def story():
    sun = world_and_sun()
    build_terrain()
    build_water()
    rims = build_tiles()
    build_bridge()
    scatter()
    cam, target = camera_rig()

    # --- Camera ------------------------------------------------------------
    cuts = [270, 364, 432, 488, 520, 579]
    shot(cam, target, 1, (-24, 0.8, 3.2), (0, 0, 0.9))
    shot(cam, target, 70, (-10, -6.5, 5.5), (0, 0, 0.4))
    shot(cam, target, 125, (0, -13.5, 9.5), (0, -0.6, 0))
    shot(cam, target, 172, (-0.4, -13.3, 9.3), (-0.5, -1.2, 0))  # lean to each summon
    shot(cam, target, 232, (0.6, -13.2, 9.2), (0.5, -0.2, 0))
    shot(cam, target, 269, (1.2, -13.0, 9.0), (0.1, -0.6, 0))
    shot(cam, target, 270, (-2.9, 1.2, 1.85), (0, -2.9, 1.05), cut=True)  # Felix
    shot(cam, target, 363, (-2.1, 0.3, 1.62), (0, -2.9, 1.1))
    shot(cam, target, 364, (-1.9, -6.2, 2.9), (0, 3.2, 1.3), cut=True)  # over his shoulder
    shot(cam, target, 417, (-1.6, -5.8, 2.7), (0, 3.3, 1.6))
    for k, f in enumerate(range(418, 430)):  # the landing shakes the lens
        a = 0.18 * (1 - k / 12)
        key(target, "location", (random.uniform(-a, a), 3.3 + random.uniform(-a, a), 1.6 + random.uniform(-a, a)), f)
    shot(cam, target, 432, (3.0, -1.5, 0.85), (0, 3.0, 1.85), cut=True)  # Umbradog, from below
    shot(cam, target, 487, (2.45, -0.8, 0.8), (0, 3.0, 2.05))
    shot(cam, target, 488, (0, -15, 13), (0, -0.4, 0), cut=True)  # the Belépő, wide
    shot(cam, target, 519, (0, -15.4, 13.4), (0, -0.5, 0))
    shot(cam, target, 520, (0.9, -10.2, 1.25), (0.7, -2.6, 1.0), cut=True)  # level with Felix
    shot(cam, target, 541, (0.8, -10.0, 1.25), (0.7, -2.6, 1.0))
    shot(cam, target, 550, (-0.6, -9.0, 1.3), (-2.4, -4.9, 0.8))  # whip to the polgár
    shot(cam, target, 578, (-0.8, -9.3, 1.4), (-2.3, -4.8, 0.85))
    shot(cam, target, 579, (1.5, -12.0, 8.0), (0, 1.5, 0.8), cut=True)  # alone on the field
    shot(cam, target, 650, (2.6, -8.8, 5.6), (0, 2.3, 1.5))
    shot(cam, target, END, (2.9, -8.2, 5.4), (0, 2.3, 1.6))
    constant_before(cam, cuts)
    constant_before(target, cuts)

    # --- The two weaklings, one at a time -----------------------------------
    p1_back = tile_xy("p1", "B1")
    p2_back = tile_xy("p2", "B3")
    pz = empty("peasant")
    peasant(pz)
    land(pz, p1_back, 0.0, 172, beam="#ffd66a", rim=rims["p1"])
    bz = empty("bandit")
    bandit(bz)
    land(bz, p2_back, math.pi, 232, beam="#ff6a55", rim=rims["p2"])

    # --- Felix, a Hajnali Utas ----------------------------------------------
    fx, fy = tile_xy("p1", "F2")
    fz = empty("felix")
    _, crystal, crystal_mat = felix(fz)
    portal("portal_in", (fx, fy - 0.75, 1.0), 0, 278, 336)
    key(fz, "location", (fx, fy - 0.8, 0.9), 292)
    key(fz, "scale", (0.15, 0.15, 0.15), 292)
    key(fz, "location", (fx, fy - 0.25, 0.4), 303)
    key(fz, "scale", (1.05, 1.05, 1.05), 303)
    key(fz, "location", (fx, fy, 0.18), 311)
    key(fz, "scale", (1, 1, 1), 313)
    shown_from(fz, 292, 531)
    emission_key(crystal_mat, 6, 318)
    emission_key(crystal_mat, 28, 326)
    emission_key(crystal_mat, 8, 346)
    rest = crystal.location.copy()
    key(crystal, "location", rest, 316)
    key(crystal, "location", rest + Vector((0, 0, 0.12)), 326)
    key(crystal, "location", rest, 346)

    # --- Umbradog -----------------------------------------------------------
    ux, uy = tile_xy("p2", "F2")
    uz = empty("umbradog")
    uy += 1.3  # it stands over F2 and B2; the head reaches the bridge
    _, head, eye_mat, eye_light = umbradog(uz)
    uz.rotation_euler.z = math.pi
    for k in range(5):  # the shadow gathers before anything lands
        puffs((ux + random.uniform(-0.6, 0.6), uy + random.uniform(-0.6, 0.6), 0.3), 370 + k * 7, "#2b1a3a", count=9, spread=1.5, rise=1.8, size=0.26, life=26, name="gloom", emit="#6a2a8a")
    key(uz, "location", (ux, uy, 7.5), 404)
    key(uz, "location", (ux, uy, 0.12), 418)
    key(uz, "scale", (0.92, 0.92, 1.12), 417)
    key(uz, "scale", (1.12, 1.12, 0.84), 420)
    key(uz, "scale", (1.0, 1.0, 1.0), 426)
    dog_lights(418, 645, 675)
    shown_from(uz, 404)
    puffs((ux, uy - 0.6, 0.2), 418, "#2b1a3a", count=16, spread=2.6, rise=0.8, size=0.3, life=24, name="slam", emit="#6a2a8a")
    emission_key(eye_mat, 0, 438)
    emission_key(eye_mat, 30, 448)
    emission_key(eye_mat, 22, 660)
    emission_key(eye_mat, 0, 680)
    for f, e in ((438, 0), (448, 70), (660, 50), (680, 0)):
        eye_light.energy = e
        eye_light.keyframe_insert("energy", frame=f)
    key(head, "rotation_euler", (0, 0, 0), 452)
    key(head, "rotation_euler", (0.62, 0, 0), 464)
    key(head, "rotation_euler", (0.66, 0, 0), 478)
    key(head, "rotation_euler", (-0.25, 0, 0), 486)
    key(head, "rotation_euler", (0, 0, 0), 500)

    # --- The Belépő: everything else on the field dies ----------------------
    WAVE_AT, SPEED = 490, 0.135  # tiles per frame; slow enough to watch it come
    centre = Vector((ux, uy - 0.7))
    wave_m = mat("wave", "#3a0a12", 0.5, "#ff2a2a", 4.5)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.05, major_segments=72, minor_segments=4)
    wave = bpy.context.active_object
    wave.name = "wave"
    wave.data.materials.append(wave_m)
    wave.location = (centre.x, centre.y, 0.35)
    linear_keys(True)
    key(wave, "scale", (0.05, 0.05, 6), WAVE_AT)
    key(wave, "scale", (16, 16, 6), WAVE_AT + int(16 / SPEED))
    linear_keys(False)
    emission_key(wave_m, 4.5, 580)
    emission_key(wave_m, 0, 600)
    shown_from(wave, WAVE_AT, WAVE_AT + int(16 / SPEED) + 1)

    def hit(xy):
        return WAVE_AT + int((Vector(xy) - centre).length / SPEED)

    def away(xy):
        return tuple(Vector(xy) - centre)

    die(bz, hit(p2_back), p2_back, away(p2_back), [MATS[n] for n in ("bandit_red", "cloak", "bandit_dark", "steel")])
    die(pz, hit(p1_back), p1_back, away(p1_back), [MATS[n] for n in ("tunic_green", "straw", "breeches", "skin")])

    # Felix does not wait for it: a portal at his side, a dive, and the ring
    # passes over the place he was standing.
    portal("portal_out", (fx + 1.45, fy, 1.0), math.pi / 2, 500, 531)
    key(fz, "location", (fx, fy, 0.18), 504)
    key(fz, "scale", (1, 1, 1), 512)
    key(fz, "rotation_euler", (0, 0, 0), 504)
    key(fz, "rotation_euler", (0, 0, -math.pi / 2), 511)
    key(fz, "scale", (1.1, 1.1, 0.78), 519)
    key(fz, "location", (fx, fy, 0.18), 520)
    key(fz, "rotation_euler", (0, 0, -math.pi / 2), 520)
    key(fz, "location", (fx + 0.75, fy, 1.05), 525)
    key(fz, "scale", (0.95, 0.95, 1.05), 525)
    key(fz, "location", (fx + 1.45, fy, 0.95), 530)
    key(fz, "scale", (0.06, 0.06, 0.06), 530)
    key(fz, "rotation_euler", (-0.9, 0, -math.pi / 2), 530)
    print("HITS bandit", hit(p2_back), "felix", hit((fx, fy)), "polgar", hit(p1_back))

    # --- Night falls; the rims go out with the day, the eyes last -----------
    for m in rims.values():
        emission_key(m, 1.6, 400)
        emission_key(m, 0.6, 420)
        emission_key(m, 0.6, 640)
        emission_key(m, 0.0, 672)
    water = bpy.data.materials["water"]
    emission_key(water, 0.15, 640)
    emission_key(water, 0.0, 672)

    # --- Title --------------------------------------------------------------
    black = Build().box(mat("void", "#000000", 1.0), scale=(60, 60, 0.01)).obj("void", cam, loc=(0, 0, -9))
    shown_from(black, 682)
    font_title = bpy.data.fonts.load(r"C:\Windows\Fonts\GARABD.TTF")
    font_sub = bpy.data.fonts.load(r"C:\Windows\Fonts\GARAIT.TTF")
    gold_m = mat("title_gold", "#f1c860", 0.3, "#ffcf6a", 0.0, metal=0.3)
    sub_m = mat("title_sub", "#e9dcc0", 0.5, "#f4e6c4", 0.0)

    def text(name, body, font, size, y, m, spacing=1.0):
        cu = bpy.data.curves.new(name, "FONT")
        cu.body = body
        cu.font = font
        cu.size = size
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        cu.extrude = 0.03
        cu.space_character = spacing
        cu.materials.append(m)
        ob = bpy.data.objects.new(name, cu)
        coll.objects.link(ob)
        ob.parent = cam
        ob.location = (0, y, -5)
        return ob

    title = text("title", "SKART", font_title, 1.25, 0.32, gold_m, spacing=1.18)
    sub = text("subtitle", "Harc Felindorért", font_sub, 0.42, -0.62, sub_m)
    shown_from(title, 690)
    shown_from(sub, 712)
    emission_key(gold_m, 0.0, 690)
    emission_key(gold_m, 4.0, 712)
    emission_key(gold_m, 3.2, END)
    key(title, "scale", (0.9, 0.9, 0.9), 690)
    key(title, "scale", (1.0, 1.0, 1.0), END)
    emission_key(sub_m, 0.0, 712)
    emission_key(sub_m, 2.2, 734)


def compositor():
    try:
        tree = bpy.data.node_groups.new("Comp", "CompositorNodeTree")
        scene.compositing_node_group = tree
        rl = tree.nodes.new("CompositorNodeRLayers")
        glare = tree.nodes.new("CompositorNodeGlare")
        try:
            glare.inputs["Type"].default_value = "Bloom"
        except Exception as e:
            print("glare type:", e)
        glare.inputs["Threshold"].default_value = 0.9
        glare.inputs["Strength"].default_value = 0.6
        glare.inputs["Size"].default_value = 0.6
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = tree.nodes.new("NodeGroupOutput")
        tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], out.inputs[0])
    except Exception as e:
        print("compositor skipped:", e)


story()
compositor()
bpy.context.preferences.edit.keyframe_new_interpolation_type = "BEZIER"
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "skart_teaser.blend"))
print("BUILT", os.path.join(HERE, "skart_teaser.blend"))
