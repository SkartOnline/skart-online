"""Validate actual GLB geometry against editable town scenes; render the kit sheet.

blender -b --factory-startup -P blender/town_review.py
"""
import bpy
import os
import json
import sys
import struct
from mathutils import Vector
from mathutils.kdtree import KDTree

HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(HERE,'town')
STAGE=os.path.join(HERE,'..','SkartCF','src','ui','stage')


def vertices(objects):
    return {tuple(v for v in ob.matrix_world @ vertex.co)
            for ob in objects if ob.type=='MESH' for vertex in ob.data.vertices}


results={}
for name in ['sikator','feketepiac','kikoto']:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,name+'.blend'))
    scene=bpy.context.scene
    scene.frame_set(1)
    bpy.context.view_layer.update()
    source=vertices(scene.collection.children[name+' assembled kit'].objects)
    with open(os.path.join(STAGE,'battlefields',name+'.glb'),'rb') as f:
        f.seek(12);length,kind=struct.unpack('<II',f.read(8))
        gltf=json.loads(f.read(length))
    assert len(gltf['scenes'])==1, 'Only the active battlefield may be exported'
    roots=gltf['scenes'][0]['nodes']
    reachable=set()
    def visit(index):
        reachable.add(index)
        for child in gltf['nodes'][index].get('children',[]): visit(child)
    for root in roots: visit(root)
    for animation in gltf.get('animations',[]):
        assert all(channel['target']['node'] in reachable for channel in animation['channels']), 'Orphaned animation target'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(STAGE,'battlefields',name+'.glb'))
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    target=vertices(bpy.context.scene.objects)
    tree=KDTree(len(target))
    for i,p in enumerate(target): tree.insert(p,i)
    tree.balance()
    errors=[tree.find(p)[2] for p in source]
    reverse=KDTree(len(source))
    for i,p in enumerate(source): reverse.insert(p,i)
    reverse.balance()
    errors.extend(reverse.find(p)[2] for p in target)
    results[name]={'unique_source_vertices':len(source),'unique_glb_vertices':len(target),'max_vertex_error':max(errors)}
    # Compare distances rather than rounded coordinates: float32 conversions
    # can land either side of a rounding boundary even when geometry agrees.
    assert max(errors)<.0001, (name,results[name])
    print('GEOMETRY VERIFIED',name,results[name],flush=True)
    if '--render-scenes' in sys.argv:
        # The scene keeps the lighting town.py gave it; card art is town.py --cards-only.
        bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,name+'.blend'))
        scene=bpy.context.scene
        scene.cycles.samples=16
        scene.render.filepath=os.path.join(OUT,'previews',name+'.png')
        bpy.ops.render.render(write_still=True)
with open(os.path.join(OUT,'validation.json'),'w') as f: json.dump(results,f,indent=2)
if '--verify-only' in sys.argv:
    print('TOWN REVIEW COMPLETE',flush=True)
    sys.exit(0)

bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,'kit.blend'))
scene=bpy.context.scene
for ob in scene.objects:
    if ob.parent is None:
        ob.location.x*=1.15
        ob.location.y*=1.3
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.world=bpy.data.worlds.new('studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.34,.36,.39,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
sun=bpy.data.objects.new('soft studio sun',bpy.data.lights.new('soft studio sun','SUN'))
scene.collection.objects.link(sun);sun.data.energy=2;sun.rotation_euler=(.3,-.5,-.4);sun.data.angle=.2
camera=bpy.data.objects.new('Kit camera',bpy.data.cameras.new('Kit camera'))
scene.collection.objects.link(camera);scene.camera=camera
camera.location=(6.9,-10.5,20);camera.rotation_euler=(Vector((6.9,7.5,.1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=24
labels=['Fal','Megerősített ajtó','Rácsos ablak','Tető','Kémény','Olajlámpa','Láda',
        'Hordó','Zsák','Üveg','Tőr','Ereklye','Kötél','Horgony',
        'Stand váza','Zöld ponyva','Barna ponyva','Szürke ponyva','Lila ponyva','Fegyvercégér','Patikacégér',
        'Italcégér','Ereklyecégér','Hajóscégér','Fogadócégér','Zászló','Kalózjel','Móló',
        'Hajótest','Árbóc és vitorla','Patkány','Palatető','Zsindelytető','Félnyeregtető',
        'Féltető','Kézikocsi','Halszárító','Csatornarács','Hirdetőtábla','Halászháló',
        'Kerítés','Farakás','Törmelék','Gaz','Fenyő','Lombos fa','Száraz fa',
        'Harangtorony','Rakodódaru','Világítótorony']
for i,label in enumerate(labels):
    data=bpy.data.curves.new(label,'FONT');data.body=label;data.size=.18;data.align_x='CENTER'
    ob=bpy.data.objects.new(label,data);scene.collection.objects.link(ob)
    ob.location=((i%7)*2.3,(i//7)*2.6-.98,.02)
    data.materials.append(bpy.data.materials['wood_dark'])
scene.view_settings.view_transform='AgX'
scene.view_settings.exposure=.7
scene.render.filepath=os.path.join(OUT,'previews','kit.png')
bpy.ops.render.render(write_still=True)
print('KIT SHEET COMPLETE',flush=True)
