"""frames/f_####.png -> skart_teaser.mp4, with Blender's own FFmpeg (no system ffmpeg needed)."""
import os, sys
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = os.path.join(HERE, args[0] if args else "frames")
out = os.path.join(HERE, args[1] if len(args) > 1 else "skart_teaser.mp4")
files = sorted(f for f in os.listdir(src) if f.endswith(".png"))

bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
s.render.fps = 24
s.render.resolution_x, s.render.resolution_y = 1280, 720
s.render.resolution_percentage = 100
se = s.sequence_editor_create()
strips = se.strips if hasattr(se, "strips") else se.sequences
strip = strips.new_image("frames", os.path.join(src, files[0]), 1, 1)
for f in files[1:]:
    strip.elements.append(f)
s.frame_start, s.frame_end = 1, len(files)
im = s.render.image_settings
im.media_type = "VIDEO"
im.file_format = "FFMPEG"
s.render.ffmpeg.format = "MPEG4"
s.render.ffmpeg.codec = "H264"
s.render.ffmpeg.constant_rate_factor = "HIGH"
s.render.ffmpeg.ffmpeg_preset = "GOOD"
s.render.use_sequencer = True
s.render.filepath = out
bpy.ops.render.render(animation=True)
print("ENCODED", out, len(files), "frames")
