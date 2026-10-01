"""
Skart 2 — the stage's starter models, built, rigged, animated and exported.

    blender -b --factory-startup -P blender/models.py              # every body
    blender -b --factory-startup -P blender/models.py -- caster    # just one
    blender -b --factory-startup -P blender/models.py -- --stills  # plus a pose sheet per body

Writes `SkartCF/src/ui/stage/models/<body>.glb`, one per body in
`SkartCF/src/ui/stage/looks.ts`. These are the same primitive bodies the stage
draws when a model is missing (`models.tsx`), turned into the asset the stage
actually wants: a rig, the standard clips, and materials named by role so the
game can dress one model as many cards. They are starting points to open in
Blender and remodel — the contract below is what a hand-made model must keep,
nothing else.

THE ASSET CONTRACT  (docs/stage-3d.md §4 says the same)

- One `.glb` per body (`caster.glb`) or per card (`felix.glb`, which wins).
- Blender: Z up, the model faces -Y, feet on the origin. A person is about
  1.6 tall, and the whole model fits in a circle of radius ~0.5 around the
  origin; the game scales it onto the tile, so the size of a unit on the board
  is a game setting, not a property of the file.
- One armature, one action per clip, named exactly: idle (loops), walk
  (loops), land, hit, attack, cast, die (ends lying still). A missing clip is
  skipped; a missing model falls back to the primitive body.
- Materials are named by role and recoloured per card by the game: cloth,
  trim, skin, hair, metal, glow (emissive), legs. Any other name keeps its
  own colour (wood, dark, straw, bone…).
- Flat shading, low poly: a few hundred to ~1500 triangles.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "SkartCF", "src", "ui", "stage", "models"))
STILLS = os.path.join(HERE, "stills")
FPS = 24

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
WANT_STILLS = "--stills" in ARGS
ONLY = [a for a in ARGS if not a.startswith("--")]

# Default colours per role. The game repaints the role materials per card, so
# these only matter in Blender and in a model viewer.
ROLE = {
    "cloth": "#8a7a66",
    "trim": "#c9c2b0",
    "skin": "#f0c8a2",
    "hair": "#8a5a2e",
    "metal": "#b9c0c8",
    "glow": "#6fe7ff",
    "legs": "#4a3a2c",
    "dark": "#1b1b1f",
    "wood": "#7a5534",
    "straw": "#dcbd5f",
    "mask": "#262428",
    "bone": "#efe6d2",
    "stone": "#b8b09a",
}


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


# ---------------------------------------------------------------------------
# Parts, written in the stage's own coordinates (three.js: x, y up, z towards
# the front) so they read line for line against `models.tsx`, and converted
# here: three (x, y, z) is Blender (x, -z, y).
# ---------------------------------------------------------------------------

PI = math.pi


def part(bone, kind, dims, role, p=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    if isinstance(s, (int, float)):
        s = (s, s, s)
    return dict(bone=bone, kind=kind, dims=dims, role=role, p=p, r=r, s=s)


def cyl(top, bottom, h, seg=6):
    return ("cyl", (top, bottom, h, seg))


def cone(r, h, seg=6):
    return ("cyl", (0.0, r, h, seg))


def ico(r, detail=1):
    return ("ico", (r, detail))


BOX = ("box", ())


def P(bone, shape, role, p=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    return part(bone, shape[0], shape[1], role, p, r, s)


def side(s):
    """The character faces +z, so its left hand is at +x."""
    return "L" if s > 0 else "R"


def person(legs="legs"):
    out = []
    for s in (-1, 1):
        out += [
            P(f"leg.{side(s)}", cyl(0.08, 0.09, 0.55), legs, (s * 0.12, 0.28, 0)),
            P(f"leg.{side(s)}", ico(0.1, 0), legs, (s * 0.12, 0.03, 0.05), s=(1, 0.5, 1.4)),
            P(f"arm.{side(s)}", cyl(0.065, 0.08, 0.5), "cloth", (s * 0.33, 0.86, 0.02), (0, 0, s * 0.18)),
            P(f"arm.{side(s)}", ico(0.07), "skin", (s * 0.38, 0.6, 0.03)),
            P("head", ico(0.025, 0), "dark", (s * 0.065, 1.4, 0.17)),
        ]
    out += [
        P("body", cyl(0.23, 0.3, 0.6, 8), "cloth", (0, 0.82, 0)),
        P("body", ico(0.24), "cloth", (0, 1.1, 0), s=(1.15, 0.5, 0.8)),
        P("head", ico(0.19), "skin", (0, 1.38, 0)),
    ]
    return out


def commoner():
    return person() + [
        P("head", cyl(0.06, 0.26, 0.16, 8), "straw", (0, 1.55, 0)),
        P("body", cyl(0.25, 0.25, 0.05, 8), "trim", (0, 0.72, 0)),
        P("arm.R", cyl(0.025, 0.025, 1.5, 5), "wood", (-0.4, 0.85, 0.08)),
        P("arm.R", BOX, "metal", (-0.4, 1.6, 0.08), s=(0.24, 0.03, 0.03)),
    ] + [P("arm.R", cone(0.015, 0.22, 4), "metal", (-0.4 + dx, 1.72, 0.08)) for dx in (-0.1, 0, 0.1)]


def soldier():
    return person() + [
        P("head", ico(0.21), "metal", (0, 1.45, 0), s=(1, 0.85, 1)),
        P("body", cyl(0.25, 0.25, 0.05, 8), "trim", (0, 0.72, 0)),
        P("arm.R", cyl(0.26, 0.26, 0.05, 8), "trim", (-0.42, 0.85, 0.12), (PI / 2, 0, 0)),
        P("arm.R", ico(0.06, 0), "metal", (-0.42, 0.85, 0.16)),
        P("arm.L", BOX, "metal", (0.42, 1.05, 0.12), s=(0.05, 0.62, 0.02)),
        P("arm.L", BOX, "trim", (0.42, 0.72, 0.12), s=(0.16, 0.03, 0.04)),
    ]


def rogue():
    return person("dark") + [
        P("head", cone(0.25, 0.55, 7), "cloth", (0, 1.5, -0.03)),
        P("head", BOX, "mask", (0, 1.32, 0.14), s=(0.3, 0.12, 0.1)),
        P("body", cyl(0.2, 0.4, 0.95, 7), "trim", (0, 0.62, -0.1), s=(1, 1, 0.6)),
        P("arm.L", cone(0.04, 0.3, 4), "metal", (0.38, 0.72, 0.12), (PI - 0.4, 0, 0)),
    ]


def caster():
    return person() + [
        P("body", cyl(0.2, 0.43, 1.0, 8), "cloth", (0, 0.52, 0)),
        P("body", cyl(0.44, 0.45, 0.07, 8), "trim", (0, 0.05, 0)),
        P("body", cyl(0.245, 0.245, 0.06, 8), "trim", (0, 0.93, 0)),
        P("head", cyl(0.27, 0.27, 0.03, 10), "cloth", (0, 1.52, 0)),
        P("head", cone(0.24, 0.5, 8), "cloth", (0, 1.78, -0.04), (-0.2, 0, 0)),
        P("arm.L", cyl(0.035, 0.03, 1.7, 5), "wood", (0.42, 0.85, 0.06)),
        P("arm.L", ico(0.11, 0), "glow", (0.42, 1.8, 0.06), s=(0.8, 1.35, 0.8)),
    ]


def eastern():
    return person() + [
        P("head", ico(0.2), "hair", (0, 1.44, -0.03), s=(1.03, 0.8, 1.03)),
        P("head", cone(0.32, 0.18, 10), "straw", (0, 1.6, 0)),
        P("body", cyl(0.25, 0.25, 0.06, 8), "trim", (0, 0.74, 0)),
        P("arm.L", cyl(0.025, 0.025, 1.9, 5), "wood", (0.42, 0.95, 0.08)),
        P("arm.L", cone(0.05, 0.2, 4), "metal", (0.42, 1.98, 0.08)),
    ]


def construct():
    out = []
    for s in (-1, 1):
        out += [
            P(f"leg.{side(s)}", BOX, "cloth", (s * 0.16, 0.25, 0), s=(0.22, 0.5, 0.24)),
            P(f"arm.{side(s)}", BOX, "cloth", (s * 0.5, 0.82, 0), (0, 0, s * 0.1), (0.18, 0.62, 0.2)),
            P("head", BOX, "glow", (s * 0.08, 1.37, 0.18), s=(0.07, 0.04, 0.02)),
        ]
    return out + [
        P("body", BOX, "cloth", (0, 0.85, 0), s=(0.7, 0.6, 0.45)),
        P("body", BOX, "trim", (0, 0.85, 0.23), s=(0.3, 0.3, 0.02)),
        P("head", BOX, "cloth", (0, 1.35, 0), s=(0.36, 0.32, 0.34)),
    ]


def beast():
    head = (0, 0.8, 0.58)
    h = lambda x, y, z: (head[0] + x, head[1] + y, head[2] + z)
    out = [
        P("body", ico(1), "cloth", (0, 0.55, 0), s=(0.3, 0.28, 0.55)),
        P("body", ico(0.28), "cloth", (0, 0.62, 0.32)),
        P("tail", cone(0.08, 0.55, 5), "cloth", (0, 0.72, -0.62), (-0.9, 0, 0)),
        P("head", ico(0.2), "cloth", h(0, 0, 0), s=(0.9, 0.85, 1.1)),
        P("head", cyl(0.06, 0.12, 0.3), "cloth", h(0, -0.04, 0.24), (PI / 2, 0, 0)),
        P("head", ico(0.04, 0), "dark", h(0, -0.02, 0.4)),
    ]
    for s in (-1, 1):
        for f, end in ((1, "F"), (-1, "B")):
            out.append(P(f"leg.{end}{side(s)}", cyl(0.05, 0.07, 0.5), "cloth", (s * 0.16, 0.25, f * 0.32)))
        out += [
            P("head", cone(0.07, 0.18, 4), "cloth", h(s * 0.1, 0.18, 0.02)),
            P("head", ico(0.03, 0), "dark", h(s * 0.08, 0.05, 0.17)),
        ]
    return out


def brute(wings=False):
    head = (0, 2.02, 1.5)
    h = lambda x, y, z: (head[0] + x, head[1] + y, head[2] + z)
    out = [
        P("body", ico(1), "cloth", (0, 1.25, -0.25), s=(0.6, 0.58, 1.25)),
        P("body", ico(0.72), "cloth", (0, 1.42, 0.72), s=(1, 1.05, 0.95)),
        P("body", cyl(0.36, 0.46, 0.8, 7), "cloth", (0, 1.78, 1.2), (0.85, 0, 0)),
        P("tail", cone(0.17, 1.2, 5), "cloth", (0, 1.2, -1.85), (-2.2, 0, 0)),
        P("head", ico(0.42), "cloth", h(0, 0.05, 0.28), s=(0.9, 0.85, 1.1)),
        P("head", cyl(0.12, 0.24, 0.6), "cloth", h(0, -0.07, 0.78), (PI / 2, 0, 0)),
        P("head", ico(0.07, 0), "dark", h(0, -0.03, 1.08)),
        P("head", BOX, "trim", h(0, -0.25, 0.62), s=(0.3, 0.1, 0.5)),
    ]
    for k in range(9):
        y = 2.05 - 0.09 * k if k < 3 else 1.85 - 0.05 * (k - 3)
        out.append(P("body", cone(0.16, 0.5 - 0.02 * k, 4), "trim", (0, y, 1.45 - k * 0.3), (-0.7, k * 0.5, 0)))
    for s in (-1, 1):
        out += [
            P(f"leg.F{side(s)}", cyl(0.12, 0.2, 1.15), "cloth", (s * 0.36, 0.58, 0.85)),
            P(f"leg.F{side(s)}", ico(0.16), "trim", (s * 0.36, 0.07, 0.95), s=(1, 0.55, 1.35)),
            P(f"leg.B{side(s)}", ico(0.36), "cloth", (s * 0.34, 1.05, -1.0), s=(0.6, 1, 0.95)),
            P(f"leg.B{side(s)}", cyl(0.11, 0.17, 1.0), "cloth", (s * 0.36, 0.5, -1.2), (0.15, 0, 0)),
            P(f"leg.B{side(s)}", ico(0.16), "trim", (s * 0.36, 0.07, -1.08), s=(1, 0.55, 1.35)),
            P("head", cone(0.13, 0.42, 4), "cloth", h(s * 0.21, 0.42, 0.12), (-0.25, 0, -s * 0.35)),
            P("head", ico(0.065), "glow", h(s * 0.17, 0.12, 0.6), s=(1.2, 0.7, 0.6)),
            P("head", cone(0.03, 0.14, 4), "bone", h(s * 0.08, -0.2, 0.92), (PI, 0, 0)),
        ]
        if wings:
            out += [
                P(f"wing.{side(s)}", cone(0.9, 1.7, 3), "trim", (s * 0.85, 2.1, -0.2), (0.3, 0, -s * 1.05), (1, 1, 0.12)),
                P("head", cone(0.07, 0.45, 4), "bone", h(s * 0.18, 0.5, 0.0), (-0.6, 0, -s * 0.3)),
            ]
    return out


def veiled():
    return [
        P("body", cyl(0.1, 0.4, 1.25, 7), "cloth", (0, 0.62, 0)),
        P("body", cyl(0.41, 0.42, 0.05, 7), "trim", (0, 0.03, 0)),
        P("head", ico(0.22), "cloth", (0, 1.32, -0.02), s=(1, 1.1, 1)),
        P("head", ico(0.16, 0), "dark", (0, 1.3, 0.08)),
    ]


# Bones, as (head, tail, parent) in the same stage coordinates. Every bone
# stands upright except the limbs, which hang: that keeps the rotation
# conventions to two, and the clips below rely on them — for an upright bone +X
# leans it forward, for a hanging one -X swings it forward.
def biped(arm_x=0.33, hand_x=0.38):
    b = {
        "root": ((0, 0, 0), (0, 0.3, 0), None),
        "body": ((0, 0.58, 0), (0, 1.15, 0), "root"),
        "head": ((0, 1.2, 0), (0, 1.6, 0), "body"),
    }
    for s in (-1, 1):
        b[f"arm.{side(s)}"] = ((s * arm_x, 1.12, 0), (s * hand_x, 0.6, 0), "body")
        b[f"leg.{side(s)}"] = ((s * 0.12, 0.56, 0), (s * 0.12, 0.05, 0), "root")
    return b


def quadruped(body_y, body_top, head, tail, legs, wing=None):
    b = {
        "root": ((0, 0, 0), (0, 0.3, 0), None),
        "body": ((0, body_y, 0), (0, body_top, 0), "root"),
        "head": (head, (head[0], head[1] + 0.3, head[2]), "body"),
        "tail": (tail, (tail[0], tail[1] + 0.3, tail[2]), "body"),
    }
    for s in (-1, 1):
        for f, end in ((1, "F"), (-1, "B")):
            x, top, z = legs[end]
            b[f"leg.{end}{side(s)}"] = ((s * x, top, z), (s * x, 0.05, z), "root")
        if wing:
            b[f"wing.{side(s)}"] = ((s * wing[0], wing[1], wing[2]), (s * wing[0], wing[1] + 0.6, wing[2]), "body")
    return b


BODIES = {
    "commoner": (commoner, biped(), 1.0),
    "soldier": (soldier, biped(), 1.0),
    "rogue": (rogue, biped(), 1.0),
    "caster": (caster, biped(), 1.0),
    "eastern": (eastern, biped(), 1.0),
    "construct": (construct, biped(0.5, 0.5), 1.0),
    "beast": (
        beast,
        quadruped(0.4, 0.75, (0, 0.78, 0.55), (0, 0.7, -0.55), {"F": (0.16, 0.5, 0.32), "B": (0.16, 0.5, -0.32)}),
        0.95,
    ),
    "brute": (
        brute,
        quadruped(1.0, 1.9, (0, 2.0, 1.45), (0, 1.3, -1.75), {"F": (0.36, 1.15, 0.88), "B": (0.36, 1.1, -1.1)}),
        0.36,
    ),
    "dragon": (
        lambda: brute(True),
        quadruped(
            1.0, 1.9, (0, 2.0, 1.45), (0, 1.3, -1.75), {"F": (0.36, 1.15, 0.88), "B": (0.36, 1.1, -1.1)}, (0.55, 1.95, -0.2)
        ),
        0.36,
    ),
    "veiled": (veiled, {"root": ((0, 0, 0), (0, 0.3, 0), None), "body": ((0, 0.3, 0), (0, 1.1, 0), "root"), "head": ((0, 1.15, 0), (0, 1.5, 0), "body")}, 1.0),
}


def to_blender(p, k=1.0):
    x, y, z = p
    return Vector((x * k, -z * k, y * k))


def rot_blender(r):
    a, b, c = r
    return Matrix.Rotation(a, 4, "X") @ Matrix.Rotation(b, 4, "Z") @ Matrix.Rotation(-c, 4, "Y")


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------


def material(role):
    m = bpy.data.materials.get(role)
    if m:
        return m
    m = bpy.data.materials.new(role)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = srgb(ROLE.get(role, "#888888"))
    b.inputs["Roughness"].default_value = 0.35 if role == "metal" else 0.85
    if role == "metal":
        b.inputs["Metallic"].default_value = 0.6
    if role == "glow":
        b.inputs["Emission Color"].default_value = srgb(ROLE["glow"])
        b.inputs["Emission Strength"].default_value = 2.5
    return m


def add_shape(bm, kind, dims):
    if kind == "cyl":
        top, bottom, h, seg = dims
        return bmesh.ops.create_cone(
            bm, cap_ends=True, cap_tris=False, segments=seg, radius1=bottom, radius2=top, depth=h
        )["verts"]
    if kind == "ico":
        r, detail = dims
        return bmesh.ops.create_icosphere(bm, subdivisions=detail + 1, radius=r)["verts"]
    return bmesh.ops.create_cube(bm, size=1.0)["verts"]


def build(name):
    make, bones, k = BODIES[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    coll = scene.collection

    arm_data = bpy.data.armatures.new(f"{name}_rig")
    arm = bpy.data.objects.new(f"{name}_rig", arm_data)
    coll.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bone, (head, tail, parent) in bones.items():
        eb = arm_data.edit_bones.new(bone)
        eb.head = to_blender(head, k)
        eb.tail = to_blender(tail, k)
        eb.roll = 0.0
    for bone, (_, _, parent) in bones.items():
        if parent:
            arm_data.edit_bones[bone].parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    # One mesh per bone, with a material slot per role it uses.
    by_bone = {}
    for pt in make():
        by_bone.setdefault(pt["bone"], []).append(pt)
    for bone, parts in by_bone.items():
        bm = bmesh.new()
        roles = []
        for pt in parts:
            verts = add_shape(bm, pt["kind"], pt["dims"])
            sx, sy, sz = pt["s"]
            m = (
                Matrix.Translation(to_blender(pt["p"], k))
                @ rot_blender(pt["r"])
                @ Matrix.Diagonal((sx * k, sz * k, sy * k, 1))
            )
            bmesh.ops.transform(bm, matrix=m, verts=verts)
            if pt["role"] not in roles:
                roles.append(pt["role"])
            idx = roles.index(pt["role"])
            for f in {f for v in verts for f in v.link_faces}:
                f.material_index = idx
                f.smooth = False
        me = bpy.data.meshes.new(f"{name}_{bone}")
        bm.to_mesh(me)
        bm.free()
        for role in roles:
            me.materials.append(material(role))
        ob = bpy.data.objects.new(f"{name}_{bone}", me)
        coll.objects.link(ob)
        world = ob.matrix_world.copy()
        ob.parent = arm
        ob.parent_type = "BONE"
        ob.parent_bone = bone
        ob.matrix_world = world

    clips(arm, set(bones), name)
    return arm


# ---------------------------------------------------------------------------
# Clips. Degrees, in each bone's own axes (see the note on `biped`).
# ---------------------------------------------------------------------------


def key(arm, bone, frame, rot=None, loc=None, scale=None):
    pb = arm.pose.bones.get(bone)
    if not pb:
        return
    pb.rotation_mode = "XYZ"
    if rot is not None:
        pb.rotation_euler = [math.radians(v) for v in rot]
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=frame)


def rest(arm, frame):
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
        pb.keyframe_insert("rotation_euler", frame=frame)
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def clip(arm, name, length, fill, loop=False):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    rest(arm, 1)
    fill()
    if loop:
        rest(arm, length + 1)
    act.frame_range = (1, length + 1)
    return act


def clips(arm, bones, body):
    quad = "leg.FL" in bones
    k = lambda *a, **kw: key(arm, *a, **kw)
    legs = [b for b in bones if b.startswith("leg.")]

    def idle():
        k("body", 25, rot=(2, 0, 0))
        k("head", 17, rot=(3 if quad else 0, 0, 4))
        k("head", 33, rot=(0, 0, -4))
        if "tail" in bones:
            k("tail", 13, rot=(0, 0, 15))
            k("tail", 37, rot=(0, 0, -15))
        for s in ("L", "R"):
            k(f"arm.{s}", 25, rot=(-3, 0, 0))
            k(f"wing.{s}", 25, rot=(0, 0, 8 if s == "L" else -8))

    def walk():
        swing = 25
        for f, sign in ((1, 1), (9, -1), (17, 1)):
            if quad:
                for leg, phase in (("leg.FL", 1), ("leg.BR", 1), ("leg.FR", -1), ("leg.BL", -1)):
                    k(leg, f, rot=(-swing * sign * phase, 0, 0))
            else:
                k("leg.L", f, rot=(-swing * sign, 0, 0))
                k("leg.R", f, rot=(swing * sign, 0, 0))
                k("arm.L", f, rot=(20 * sign, 0, 0))
                k("arm.R", f, rot=(-20 * sign, 0, 0))
        for f, up in ((1, 0), (5, 0.03), (9, 0), (13, 0.03), (17, 0)):
            k("body", f, loc=(0, up, 0))

    def land():
        k("root", 2, scale=(1.14, 0.78, 1.14))
        k("root", 5, scale=(0.95, 1.08, 0.95))
        k("root", 9, scale=(1, 1, 1))

    def hit():
        k("body", 4, rot=(-18, 0, 0))
        k("head", 4, rot=(-12, 0, 0))
        k("body", 9, rot=(5, 0, 0))
        k("body", 13, rot=(0, 0, 0))
        k("head", 13, rot=(0, 0, 0))

    def attack():
        if quad:
            k("body", 7, loc=(0, 0, 0.25))
            k("head", 7, rot=(20, 0, 0))
            k("body", 15, loc=(0, 0, 0))
            k("head", 15, rot=(0, 0, 0))
        else:
            k("body", 4, rot=(-8, 0, 0))
            k("arm.L", 5, rot=(-140, 0, 0))
            k("body", 8, rot=(18, 0, 0))
            k("arm.L", 9, rot=(-20, 0, 0))
            k("body", 15, rot=(0, 0, 0))
            k("arm.L", 15, rot=(0, 0, 0))

    def cast():
        if quad:
            # A beast's spell is a howl: nose to the sky.
            k("head", 7, rot=(-35, 0, 0))
            k("body", 7, rot=(-8, 0, 0))
            k("head", 15, rot=(-38, 0, 0))
            k("head", 19, rot=(0, 0, 0))
            k("body", 19, rot=(0, 0, 0))
        else:
            # The staff levelled at the target, not waved over the head: the
            # staff hangs from the hand, so raising the arm past the shoulder
            # turns it crystal-down.
            k("arm.L", 7, rot=(-72, 0, 0))
            k("body", 7, rot=(-6, 0, 0))
            k("head", 7, rot=(-10, 0, 0))
            k("arm.L", 13, rot=(-78, 0, 0))
            k("arm.L", 19, rot=(0, 0, 0))
            k("body", 19, rot=(0, 0, 0))
            k("head", 19, rot=(0, 0, 0))

    def die():
        if quad:
            k("root", 5, loc=(0, 0.12, 0))
            k("root", 13, rot=(0, 0, 88), loc=(0, 0, 0))
            k("root", 17, rot=(0, 0, 82))
            k("root", 21, rot=(0, 0, 88))
            for leg in legs:
                k(leg, 13, rot=(-25, 0, 0))
        else:
            k("root", 5, loc=(0, 0.15, 0))
            k("root", 13, rot=(-88, 0, 0), loc=(0, 0, 0))
            k("root", 17, rot=(-82, 0, 0))
            k("root", 21, rot=(-88, 0, 0))
            for s in ("L", "R"):
                k(f"arm.{s}", 13, rot=(-40, 0, 0))

    clip(arm, "idle", 48, idle, loop=True)
    clip(arm, "walk", 16, walk, loop=True)
    clip(arm, "land", 8, land)
    clip(arm, "hit", 12, hit)
    clip(arm, "attack", 14, attack)
    clip(arm, "cast", 18, cast)
    clip(arm, "die", 20, die)
    arm.animation_data.action = bpy.data.actions["idle"]


# ---------------------------------------------------------------------------
# Export, and a pose sheet to check the clips by eye
# ---------------------------------------------------------------------------


def export(name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_materials="EXPORT",
    )
    print("EXPORTED", path, os.path.getsize(path), "bytes")


def pose_sheet(arm, name):
    os.makedirs(STILLS, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 8
    scene.render.resolution_x, scene.render.resolution_y = 360, 360
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.node_tree.nodes["Background"].inputs["Color"].default_value = srgb("#a9cde6")
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Three-quarter view from the front-left, so forward and sideways both read.
    cam.location = (-2.6, -3.2, 1.9)
    target = Vector((0, 0, 0.7))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    for clip_name, frame in (("idle", 1), ("walk", 5), ("attack", 8), ("cast", 10), ("hit", 4), ("die", 21)):
        arm.animation_data.action = bpy.data.actions[clip_name]
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(STILLS, f"{name}_{clip_name}.png")
        bpy.ops.render.render(write_still=True)


for body in ONLY or list(BODIES):
    rig = build(body)
    export(body)
    if WANT_STILLS:
        pose_sheet(rig, body)
