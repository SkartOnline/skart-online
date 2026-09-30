"""
Skart 2 — the main menu's backdrop: A Pék hídja at dusk.

    blender -b --factory-startup -P trailer/build.py         # once, if skart_teaser.blend is missing
    blender -b trailer/skart_teaser.blend -P blender/backdrop.py

Takes the teaser's valley (river, bridge, light woodland), empties it of units
and effects, turns the light to evening — a low amber sun, a violet sky, the
tile rims glowing like lamps — and renders one wide still to
`SkartCF/src/ui/menu-valley.webp`, which `menu.css` lays behind the title.
"""

import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "SkartCF", "src", "ui", "menu-valley.webp"))


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


scene = bpy.context.scene
# At frame 1 every unit, portal, puff and title in the teaser is keyed hidden
# and every story light is at zero. Evaluate it there and drop the animation,
# and what is left is the land.
scene.frame_set(1)
for ob in scene.objects:
    if ob.animation_data:
        ob.animation_data_clear()

# Evening: the sky from violet overhead to amber at the horizon.
world = scene.world
nt = world.node_tree
if world.animation_data:
    world.animation_data_clear()
if nt.animation_data:
    nt.animation_data_clear()
ramp = next(n for n in nt.nodes if n.type == "VALTORGB")
ramp.color_ramp.elements[0].position = 0.16
ramp.color_ramp.elements[0].color = srgb("#f2a466")
ramp.color_ramp.elements[1].position = 0.27
ramp.color_ramp.elements[1].color = srgb("#3b3f72")
mid = ramp.color_ramp.elements.new(0.205)
mid.color = srgb("#b87a8e")  # the rose between the lamp and the night
nt.nodes["Background"].inputs["Strength"].default_value = 0.75

sun = bpy.data.objects["sun"]
sun.data.animation_data_clear()
sun.data.energy = 1.6
sun.data.color = srgb("#ffb27a")[:3]
sun.rotation_euler = (math.radians(78), 0, math.radians(-65))

# The rims on the tiles become the lamps of the scene.
for m in bpy.data.materials:
    if m.node_tree and m.node_tree.animation_data:
        m.node_tree.animation_data_clear()
for name, strength in (("rim_p1", 5.0), ("rim_p2", 4.0), ("water", 0.12)):
    m = bpy.data.materials.get(name)
    if m:
        m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = strength

cam = bpy.data.objects["cam"]
cam.animation_data_clear()
cam.constraints.clear()
# Over the river, which the scatter keeps clear of trees, looking along it
# to the bridge and the lit tiles.
cam.location = Vector((-17.0, 1.2, 3.1))
target = Vector((0.0, -0.4, 1.2))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 26

scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.resolution_percentage = 100
scene.eevee.taa_render_samples = 32
scene.render.image_settings.media_type = "IMAGE"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.quality = 82
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("BACKDROP", OUT, os.path.getsize(OUT))
