"""
Skart 2 — card art rendered from the stage's own models.

    cd SkartCF && npm run looks                                      # refresh blender/looks.json
    blender -b --factory-startup -P blender/portraits.py             # every unit without art
    blender -b --factory-startup -P blender/portraits.py -- felix    # just these
    blender -b --factory-startup -P blender/portraits.py -- --force  # overwrite what is there

Writes `SkartCF/src/ui/art/<cardId>.webp`, the slot every card face and board
tile already reads (`artFor` in `src/ui/card/model.ts`), so a card's art and
its figure on the board are the same model in the same colours. Existing art is
never overwritten without `--force`: a hand-made portrait wins.

Each unit is its body's `.glb` (or its own, when it has one), repainted from
`looks.json` — which `npm run looks` writes from `looks.ts`, so nothing here
decides what a card wears.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "SkartCF", "src", "ui"))
MODELS = os.path.join(ROOT, "stage", "models")
ART = os.path.join(ROOT, "art")
SIZE = (480, 360)

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
FORCE = "--force" in ARGS
ONLY = [a for a in ARGS if not a.startswith("--")]

ROLES = ("cloth", "trim", "skin", "hair", "metal", "glow", "legs")

# A pose per body, so a card shows what the unit does: casters levelling the
# staff, soldiers winding up, everything else at rest.
POSE = {
    "caster": ("cast", 13),
    "soldier": ("attack", 5),
    "eastern": ("attack", 5),
    "rogue": ("attack", 5),
    "dragon": ("cast", 10),
}


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def stage():
    bpy.ops.wm.read_factory_settings(use_empty=True)
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

    # A warm, soft sky: lo-fi and cosy rather than dramatic.
    w = bpy.data.worlds.new("sky")
    scene.world = w
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = srgb("#f6dfb8")
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = srgb("#9cc3dc")
    mapr = nt.nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = -1.0
    nt.links.new(tc.outputs["Window"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Y"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0

    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN"))
    key.data.energy = 3.2
    key.data.color = srgb("#fff0d6")[:3]
    key.data.angle = math.radians(4)
    key.rotation_euler = (math.radians(55), 0, math.radians(-35))
    scene.collection.objects.link(key)
    rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "SUN"))
    rim.data.energy = 1.6
    rim.data.color = srgb("#bcd8ff")[:3]
    rim.rotation_euler = (math.radians(60), 0, math.radians(160))
    scene.collection.objects.link(rim)

    # The slab it stands on, as on the board.
    bpy.ops.mesh.primitive_cylinder_add(vertices=4, radius=0.72, depth=0.1, location=(0, 0, -0.05))
    slab = bpy.context.active_object
    slab.rotation_euler.z = math.radians(45)
    m = bpy.data.materials.new("slab")
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = srgb("#bdb19a")
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    slab.data.materials.append(m)
    bpy.ops.mesh.primitive_cylinder_add(vertices=9, radius=3.0, depth=0.02, location=(0, 0, -0.1))
    grass = bpy.context.active_object
    g = bpy.data.materials.new("grass")
    g.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = srgb("#78b84f")
    g.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    grass.data.materials.append(g)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def portrait(unit):
    scene, cam = stage()
    path = os.path.join(MODELS, f"{unit['id']}.glb")
    if not os.path.exists(path):
        path = os.path.join(MODELS, f"{unit['body']}.glb")
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in scene.objects if o.select_get()]

    for o in imported:
        if o.type == "MESH":
            for slot in o.material_slots:
                mat = slot.material
                if not mat or mat.name.split(".")[0] not in ROLES:
                    continue
                role = mat.name.split(".")[0]
                copy = mat.copy()
                b = copy.node_tree.nodes.get("Principled BSDF")
                if b:
                    b.inputs["Base Color"].default_value = srgb(unit["paint"][role])
                    if role == "glow":
                        b.inputs["Emission Color"].default_value = srgb(unit["paint"][role])
                        b.inputs["Emission Strength"].default_value = 3.0
                slot.material = copy

    rig = next((o for o in imported if o.type == "ARMATURE"), None)
    clip, frame = POSE.get(unit["body"], ("idle", 1))
    if rig:
        if rig.animation_data is None:
            rig.animation_data_create()
        action = next((a for a in bpy.data.actions if a.name.split(".")[0].split("|")[-1] == clip), None) or next(
            (a for a in bpy.data.actions if clip in a.name), None
        )
        if action:
            rig.animation_data.action = action
            try:
                rig.animation_data.action_slot = action.slots[0]
            except Exception:
                pass
        scene.frame_set(frame)

    # Frame the figure: its bounds, seen from the front-left at shoulder height.
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in imported if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    size = max(hi.z - lo.z, (hi.x - lo.x) * 0.75, (hi.y - lo.y) * 0.75, 0.6)
    fov = 2 * math.atan(18 / cam.data.lens)  # 36 mm sensor, vertical in a 4:3 frame
    # Headroom over the hat or the ears: the card prints its name across the top of the art.
    dist = size * 0.8 / math.tan(fov / 2) + 0.4
    centre.z += size * 0.06
    view = Vector((-0.45, -1.0, 0.32)).normalized()
    cam.location = centre + view * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()

    os.makedirs(ART, exist_ok=True)
    scene.render.filepath = os.path.join(ART, f"{unit['id']}.webp")
    bpy.ops.render.render(write_still=True)
    print("PORTRAIT", unit["id"], unit["body"])


units = json.load(open(os.path.join(HERE, "looks.json"), encoding="utf-8"))
for unit in units:
    if ONLY and unit["id"] not in ONLY:
        continue
    target = os.path.join(ART, f"{unit['id']}.webp")
    if os.path.exists(target) and not FORCE:
        print("SKIP (has art)", unit["id"])
        continue
    portrait(unit)
