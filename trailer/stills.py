import bpy, sys, os
s = bpy.context.scene
s.render.resolution_percentage = 50
frames = [int(x) for x in sys.argv[sys.argv.index("--")+1:]]
for f in frames:
    s.frame_set(f)
    s.render.filepath = os.path.join(os.path.dirname(bpy.data.filepath), "stills", f"s_{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    print("STILL", f)
