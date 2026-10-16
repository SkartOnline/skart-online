"""Reusable low-poly waterfront kit and three assembled battlefields.

blender -b --factory-startup -P blender/town.py
blender -b --factory-startup -P blender/town.py -- --render

Editable sources: blender/town/{kit,sikator,feketepiac,kikoto}.blend.
Individual components: blender/town/parts/*.glb. Runtime scenes: stage/battlefields.
All components face -Y in Blender; +Y leads away from the home camera.
Assemblies use linked mesh data, not repeated modeling. Flag cloth and emblems
are separate, with flag_cloth / flag_emblem materials for future recoloring.
Runtime exports batch only static meshes by material; editable sources retain
the complete named hierarchy. Ground tops stay below the game's 0.06 tile tops.
"""
import bpy
import bmesh
import math
import os
import sys
import json
import random
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'town')
STAGE = os.path.join(HERE, '..', 'SkartCF', 'src', 'ui', 'stage')
RENDER = '--render' in sys.argv
CARDS = '--cards' in sys.argv
ART = os.path.join(HERE, '..', 'SkartCF', 'src', 'ui', 'art')
CARD_SIZE = (800, 600)
for folder in (OUT, os.path.join(OUT, 'parts'), os.path.join(OUT, 'previews'), os.path.join(STAGE, 'battlefields')):
    os.makedirs(folder, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(17)
MATS = {}
KIT = {}
CURRENT = None
LANES = []  # (a, b, width) so background blocks keep the streets open
PAVED = []  # (x0, x1, y0, y1) squares laid with the same stones as the streets
REACH = 21  # streets and backdrop houses stop here; the fog has closed long before
SHADOW_REACH = 7.5  # beyond this the stage's shadow camera sees nothing anyway
EARTH = []  # (x, y, r) of every earth patch laid so far
SCENE = ''  # the battlefield being built, for the sea test in pave()
PI = math.pi


def mat(name, color, emission=0, metal=0, rough=.84):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    rgb = [int(color[i:i+2], 16)/255 for i in (1, 3, 5)]
    rgba = tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in rgb)+(1,)
    m.diffuse_color = rgba
    node = m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = rgba
    node.inputs['Roughness'].default_value = rough
    node.inputs['Metallic'].default_value = metal
    if emission:
        node.inputs['Emission Color'].default_value = rgba
        node.inputs['Emission Strength'].default_value = emission
    MATS[name] = m
    return m


for args in [
    ('plaster', '#81766a'), ('patch', '#9b8c79'), ('stone', '#69655f'),
    ('stone_light', '#827b6f'), ('stone_dark', '#595652'), ('mortar', '#4d4943'),
    ('wood', '#68503d'), ('wood_light', '#8d7353'), ('wood_dark', '#40352e'),
    ('roof', '#625d57'), ('roof_patch', '#807266'), ('iron', '#353a38'),
    ('brass', '#ad8948'), ('linen', '#bcab89'), ('awning_green', '#657063'),
    ('awning_russet', '#986b51'), ('awning_grey', '#797c77'), ('awning_plum', '#756775'),
    ('glass_green', '#648679'), ('glass_amber', '#a77939'), ('glass_violet', '#8176a0'),
    ('steel', '#a7aba5', 0, 0, .45), ('water', '#427c86', 0, 0, .3), ('water_light', '#64989b', 0, 0, .3),
    ('water_dark', '#386974', 0, 0, .3), ('rope', '#a29170'), ('flag_cloth', '#302e30'),
    ('flag_emblem', '#dfd2b4'), ('rat_fur', '#655951'), ('rat_skin', '#b28675'),
    ('rat_eye', '#151719'), ('lamp_glass', '#ffc06c', 3), ('magic', '#9acbc0', .4),
    ('plaster_chalk', '#afa28a'), ('plaster_soot', '#706c63'), ('plaster_ochre', '#a08665'),
    ('brick', '#806450'), ('slate_blue', '#555f61'), ('slate_faded', '#7b8280'),
    ('roof_rust', '#83634e'), ('roof_umber', '#594b41'), ('moss', '#525e43'),
    # Low roughness lets standing water pick up the oil lamps after dark.
    ('puddle', '#3f5354', 0, 0, .12), ('canvas_patch', '#8c917c'), ('cloth_wash', '#a59888'),
    ('paper', '#c3b596'), ('shutter_blue', '#577774'),
    ('earth', '#766e60'), ('mud', '#5b554b'), ('dust', '#918470'),
    # Ground cover and trees, inside the bible's palette (hill tones kept for other fields).
    ('hill', '#6a6455'), ('hill_far', '#77705f'), ('scrub', '#5f6447'),
    ('leaf', '#56603f'), ('leaf_dark', '#434c36'), ('bark', '#4a3d33'),
    ('weed', '#6b7150'), ('string_bulb', '#ffbf70', 1.3),
]:
    mat(*args)


def coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def mesh(name, verts, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(MATS[material])
    ob = bpy.data.objects.new(name, me)
    CURRENT.objects.link(ob)
    return ob


def primitive(name, kind, pos, scale, material, rot=(0, 0, 0), sides=8):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1)
    elif kind in ('ico', 'puff'):
        # A puff is rounder, so smoke doesn't read as a flying die.
        bmesh.ops.create_icosphere(bm, subdivisions=2 if kind == 'puff' else 1, radius=1)
    else:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides,
                              radius1=1, radius2=1 if kind == 'cyl' else 0, depth=1)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[material])
    ob = bpy.data.objects.new(name, me)
    CURRENT.objects.link(ob)
    ob.location, ob.scale, ob.rotation_euler = pos, scale, rot
    return ob


def frustum(name, pos, r1, r2, h, material, sides=8):
    ring = [(math.cos(i*2*PI/sides), math.sin(i*2*PI/sides)) for i in range(sides)]
    verts = [(pos[0]+c*r, pos[1]+s*r, pos[2]+z) for z, r in [(0, r1), (h, r2)] for c, s in ring]
    faces = [tuple(range(sides-1, -1, -1)), tuple(range(sides, 2*sides))]
    faces += [(i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides)]
    return mesh(name, verts, faces, material)


def box(name, pos, size, material, rot=(0, 0, 0)):
    return primitive(name, 'box', pos, size, material, rot)


def rod(name, a, b, radius, material, sides=6):
    a, b = Vector(a), Vector(b)
    ob = primitive(name, 'cyl', (a+b)/2, (radius, radius, (b-a).length), material, sides=sides)
    ob.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return ob


def empty(name, pos=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    CURRENT.objects.link(ob)
    ob.location = pos
    return ob


def begin(name):
    global CURRENT
    CURRENT = coll(name)
    KIT[name] = CURRENT


def instance(asset, name, pos=(0, 0, 0), turn=0, scale=1):
    root = empty(name, pos)
    root.rotation_euler.z = turn
    root.scale = (scale,)*3 if isinstance(scale, (int, float)) else scale
    for src in KIT[asset].objects:
        ob = src.copy()
        ob.name = name + '/' + src.name
        CURRENT.objects.link(ob)
        ob.parent = root
    return root


def build_kit():
    begin('wall')
    box('plaster panel', (0, 0, .45), (1.12, .075, .9), 'plaster')
    for x in [-.53, .53]:
        box('upright timber', (x, -.05, .45), (.065, .07, .9), 'wood_dark')
    for z in [.07, .84]:
        box('cross timber', (0, -.05, z), (1.17, .075, .07), 'wood')
    for x,z,w in [(-.35,.18,.25),(.32,.43,.19),(-.12,.73,.32)]:
        box('weathered plaster repair', (x, -.041, z), (w,.008,.13), 'patch')
    for x in [-.4, -.1, .22, .45]:
        box('foundation stones', (x, -.025, .045), (.24,.13,.09), 'stone')

    begin('door_reinforced')
    box('recess', (0, .018, .30), (.40,.04,.61), 'wood_dark')
    for i in range(5):
        box('door plank', ((i-2)*.068, -.016, .29), (.064,.035,.55), 'wood')
    for z in [.14,.43]:
        box('iron strap', (0, -.04, z), (.34,.025,.035), 'iron')
        for x in [-.14,.14]:
            primitive('iron nail', 'ico', (x,-.059,z), (.012,.009,.012), 'steel')
    for x in [-.21,.21]:
        box('jamb', (x,-.02,.32), (.055,.09,.65), 'wood_dark')
    box('lintel', (0,-.03,.65), (.48,.11,.06), 'wood_dark')
    primitive('door ring', 'cyl', (.1,-.066,.29), (.028,.028,.018), 'brass', (PI/2,0,0))
    box('threshold', (0,-.065,.014), (.48,.20,.028), 'stone_light')

    begin('window_barred')
    box('dark window recess', (0,.006,0), (.30,.04,.29), 'wood_dark')
    box('warm window pane', (0,-.02,0), (.25,.008,.24), 'glass_amber')
    for x in [-.17,.17]:
        box('window frame', (x,-.047,0), (.04,.08,.37), 'wood')
    for z in [-.16,.16]:
        box('window frame', (0,-.047,z), (.37,.08,.04), 'wood')
    for x in [-.08,0,.08]:
        box('window iron bar', (x,-.08,0), (.018,.018,.29), 'iron')
    box('cross bar', (0,-.09,0), (.30,.018,.018), 'iron')
    box('patched shutter', (.26,0,0), (.13,.035,.30), 'wood_light', (0,0,-.15))
    box('shutter strap', (.26,-.024,.09), (.14,.014,.025), 'iron')

    begin('roof')
    mesh('sagging pitched roof', [(-.67,-.68,0),(.67,-.68,0),(0,-.68,.34),
         (-.67,.68,0),(.67,.68,0),(0,.68,.34)], [(0,1,2),(3,5,4),(0,2,5,3),(2,1,4,5)], 'roof')
    for side in [-1,1]:
        for row in range(3):
            for col in range(6):
                x=side*(.12+row*.215)
                z=.34-abs(x)*.51+.015
                box('overlapping roof shingle', (x,-.565+col*.226,z), (.23,.215,.025),
                    'roof_patch' if (row+col)%5==0 else 'roof', (0,side*.47,0))
    rod('ridge cap', (0,-.72,.36),(0,.72,.36), .033,'wood_dark')

    begin('chimney')
    box('chimney stack', (0,0,.19), (.16,.18,.38), 'stone')
    for z in [.08,.19,.30]:
        box('mortar course', (0,-.095,z), (.165,.008,.018), 'mortar')
    box('chimney cap', (0,0,.40), (.23,.24,.06), 'stone_dark')
    box('soot opening', (0,0,.434), (.12,.13,.004), 'iron')

    begin('lamp_oil')
    box('wall bracket', (0,.04,.08), (.07,.06,.24), 'iron')
    rod('lamp hanger', (0,0,.18),(0,-.21,.18),.014,'iron')
    primitive('lamp glass', 'cyl', (0,-.2,.02), (.055,.055,.13), 'lamp_glass', sides=6)
    for z in [-.065,.103]:
        primitive('lamp cap', 'cone', (0,-.2,z), (.082,.082,.055), 'iron', sides=6)
    for x in [-.052,.052]:
        rod('lamp frame',(x,-.2,-.06),(x,-.2,.10),.008,'iron')
    light = bpy.data.lights.new('oil flame', 'POINT')
    light.energy = 7
    light.color = (1,.49,.16)
    light.shadow_soft_size=.16
    ob = bpy.data.objects.new('oil flame',light)
    CURRENT.objects.link(ob)
    ob.location=(0,-.24,.02)

    begin('crate')
    box('cargo core', (0,0,.19), (.38,.34,.38),'wood')
    for side in [-1,1]:
        for x in [-.13,0,.13]:
            box('face plank', (x,side*.178,.19), (.12,.026,.35),'wood_light')
        for z in [.035,.34]:
            box('cargo binding', (0,side*.194,z), (.42,.025,.038),'wood_dark')
        box('diagonal brace', (0,side*.21,.19), (.40,.028,.04),'wood', (0,-.67,0))
    for x in [-.13,.13]:
        box('top binding', (x,0,.39), (.035,.38,.025),'wood_dark')

    begin('barrel')
    rings=[(-.20,.13),(-.13,.165),(.13,.165),(.20,.13)]
    verts=[(r*math.cos(i*PI/5),r*math.sin(i*PI/5),z+.20) for z,r in rings for i in range(10)]
    faces=[tuple(range(9,-1,-1)),tuple(range(30,40))]
    faces += [(j*10+i,j*10+(i+1)%10,(j+1)*10+(i+1)%10,(j+1)*10+i) for j in range(3) for i in range(10)]
    mesh('barrel staves',verts,faces,'wood_light')
    for z in [.075,.32]:
        primitive('barrel hoop','cyl',(0,0,z),(.168,.168,.029),'iron',sides=10)
    primitive('barrel lid','cyl',(0,0,.405),(.131,.131,.012),'wood',sides=10)

    begin('sack')
    primitive('canvas sack','ico',(0,0,.17),(.19,.14,.22),'linen')
    primitive('tied neck','cyl',(0,0,.37),(.042,.042,.06),'rope',sides=6)

    begin('bottle')
    primitive('bottle body','cyl',(0,0,.082),(.045,.045,.14),'glass_green',sides=6)
    primitive('bottle shoulder','cone',(0,0,.167),(.045,.045,.03),'glass_green',sides=6)
    primitive('bottle neck','cyl',(0,0,.195),(.019,.019,.06),'glass_green',sides=6)
    primitive('cork','cyl',(0,0,.231),(.021,.021,.02),'wood_light',sides=6)
    box('plain paper label',(0,-.045,.085),(.056,.006,.048),'linen')

    begin('dagger')
    mesh('dagger blade',[(-.024,0,.08),(.024,0,.08),(0,0,.28),(0,-.014,.12),(0,.014,.12)],
         [(0,3,2),(3,1,2),(1,4,2),(4,0,2),(0,4,1,3)],'steel')
    box('dagger guard',(0,0,.085),(.13,.038,.025),'brass')
    primitive('leather grip','cyl',(0,0,.036),(.017,.017,.075),'wood_dark',sides=6)

    begin('artifact')
    primitive('display plinth','cyl',(0,0,.022),(.105,.105,.044),'wood_dark',sides=8)
    primitive('faceted crystal','ico',(0,0,.13),(.065,.065,.115),'magic')
    for x in [-.07,.07]:
        rod('brass claw',(x,0,.02),(x*.7,0,.11),.009,'brass')

    begin('rope_coil')
    for r in [.075,.10,.125]:
        for i in range(12):
            a=i*PI/6;b=(i+1)*PI/6
            rod('coiled rope',(r*math.cos(a),r*math.sin(a),.018),(r*math.cos(b),r*math.sin(b),.018),.012,'rope',4)

    begin('anchor')
    rod('anchor shank',(0,0,.03),(0,0,.34),.023,'iron')
    rod('anchor stock',(-.12,0,.23),(.12,0,.23),.02,'iron')
    for s in [-1,1]:
        rod('anchor arm',(0,0,.03),(s*.14,0,.10),.025,'iron')
        mesh('anchor fluke',[(s*.14,0,.08),(s*.15,0,.17),(s*.065,0,.125)],[(0,1,2)],'iron')

    begin('stall_frame')
    for x in [-.48,.48]:
        for y in [-.27,.27]:
            box('stall post',(x,y,.52),(.044,.044,1.04),'wood_dark')
    for i in range(7):
        box('counter plank',((i-3)*.145,-.03,.43),(.139,.64,.055),'wood_light')
    for i in range(7):
        box('stall apron',((i-3)*.143,-.295,.25),(.135,.035,.33),'wood')
    rod('canopy rail',(-.54,-.29,1.05),(.54,-.29,1.05),.027,'wood_dark')
    rod('canopy rail',(-.54,.30,1.11),(.54,.30,1.11),.027,'wood_dark')

    for material in ['awning_green','awning_russet','awning_grey','awning_plum']:
        begin(material)
        for i in range(8):
            x=-.57+i*.1425
            sag=.055*math.sin((i+.5)*PI/8)
            tint='linen' if i in [1,6] else material
            mesh('sun-faded canvas',[(x,-.39,.94-sag),(x+.1425,-.39,.94-sag),(x+.1425,.04,1.15-sag),
                 (x,.04,1.15-sag),(x,.4,1.09),(x+.1425,.4,1.09)],[(0,1,2,3),(3,2,5,4)],tint)
            edge=.83+random.uniform(-.025,.025)-sag
            mesh('frayed valance',[(x,-.39,.941-sag),(x+.1425,-.39,.941-sag),(x+.12,-.39,edge),(x+.025,-.39,edge+.018)],[(0,1,2,3)],tint)
        box('stitched canvas patch',(.2,-.16,1.009),(.20,.23,.006),'canvas_patch',(.40,0,.1))

    # One pictogram per sign, legible without text or lurid contraband.
    for kind in ['weapons','apothecary','liquor','relics','sailor','inn']:
        begin('sign_'+kind)
        box('signboard',(0,0,0),(.34,.04,.27),'wood_dark')
        for x in [-.12,.12]:
            rod('sign chain',(x,0,.13),(x,0,.23),.008,'iron')
        if kind=='weapons':
            rod('blade mark',(-.08,-.027,-.07),(.075,-.027,.08),.014,'linen')
            rod('guard mark',(-.07,-.027,.015),(0,-.027,-.055),.014,'linen')
        elif kind in ['apothecary','liquor']:
            box('bottle mark',(0,-.028,-.022),(.105,.008,.12),'linen')
            box('bottle neck mark',(0,-.029,.065),(.04,.009,.065),'linen')
            if kind=='apothecary':
                box('herbal cross',(0,-.035,-.02),(.062,.007,.019),'awning_green')
                box('herbal cross',(0,-.035,-.02),(.019,.007,.062),'awning_green')
        elif kind=='relics':
            mesh('diamond mark',[(0,-.026,.10),(.07,-.026,0),(0,-.026,-.10),(-.07,-.026,0)],[(0,1,2,3)],'linen')
        elif kind=='inn':
            box('mug mark',(-.018,-.029,0),(.12,.012,.15),'linen')
            for z in [-.04,.04]:
                rod('mug handle',(.04,-.03,z),(.10,-.03,z),.012,'linen')
            rod('mug handle',(.10,-.03,-.04),(.10,-.03,.04),.012,'linen')
        else:
            rod('anchor mark',(0,-.026,.09),(0,-.026,-.08),.011,'linen')
            for s in [-1,1]:
                rod('anchor mark',(0,-.026,-.08),(s*.075,-.026,-.025),.012,'linen')
            rod('anchor stock',(-.06,-.026,.045),(.06,-.026,.045),.01,'linen')

    begin('flag')
    rod('flag pole',(0,0,0),(0,0,.85),.014,'wood_dark')
    verts=[]
    for j in range(2):
        for i in range(6):
            verts.append((i*.09,math.sin(i*1.4)*.038,.78-j*.25-i*.014))
    mesh('recolorable flag cloth',verts,[(i,i+1,i+7,i+6) for i in range(5)],'flag_cloth')
    begin('pirate_emblem')
    primitive('skull','ico',(.22,-.038,.64),(.052,.012,.046),'flag_emblem')
    box('skull jaw',(.22,-.044,.60),(.054,.012,.026),'flag_emblem')
    for x in [.202,.238]:
        primitive('skull eye','ico',(x,-.052,.645),(.011,.006,.012),'flag_cloth')
    for s in [-1,1]:
        rod('crossbones',(.15,-.05,.55+s*.03),(.29,-.05,.55-s*.03),.009,'flag_emblem')

    begin('dock')
    for i in range(15):
        box('dock plank',(0,(i-7)*.13,.015),(1.5,.122,.08),'wood_light' if i%4 else 'wood')
    for x in [-.6,.6]:
        for y in [-.82,.82]:
            primitive('dock piling','cyl',(x,y,-.18),(.075,.075,.65),'wood_dark',sides=7)
            primitive('mooring collar','cyl',(x,y,.12),(.083,.083,.035),'rope',sides=7)

    begin('ship_hull')
    outline=[(0,-1.25),(.37,-.88),(.46,-.35),(.46,.55),(.30,1.03),(0,1.23),(-.30,1.03),(-.46,.55),(-.46,-.35),(-.37,-.88)]
    verts=[(x*.5,y*.85,-.30) for x,y in outline]+[(x,y,.05) for x,y in outline]+[(x*1.03,y,.22) for x,y in outline]
    mesh('faceted wooden hull',verts,[(i,(i+1)%10,(i+1)%10+10,i+10) for i in range(10)]+[(i+10,(i+1)%10+10,(i+1)%10+20,i+20) for i in range(10)]+[tuple(range(9,-1,-1))],'wood_dark')
    mesh('ship deck',[(x*.96,y*.96,.08) for x,y in outline],[tuple(range(10))],'wood_light')
    for i in range(10):
        a=outline[i];b=outline[(i+1)%10]
        rod('gunwale',(a[0],a[1],.23),(b[0],b[1],.23),.035,'wood')
    for x in [-.3,-.15,0,.15,.3]:
        rod('deck seams',(x,-.8,.09),(x,.78,.09),.005,'wood')
    box('aft cabin',(0,.62,.25),(.57,.51,.34),'wood')
    box('cabin roof',(0,.62,.44),(.65,.59,.055),'wood_dark')

    begin('mast_sail')
    rod('mast',(0,0,.08),(0,0,1.65),.035,'wood_dark')
    rod('yard',(-.57,0,1.40),(.57,0,1.40),.026,'wood')
    mesh('billowed canvas sail',[(-.53,.015,1.38),(.53,.015,1.38),(-.45,.015,.63),(.45,.015,.63),(0,-.17,1.04)],[(0,1,4),(1,3,4),(3,2,4),(2,0,4)],'linen')
    for x in [-.42,.42]:
        rod('standing rigging',(0,0,1.59),(x,.66,.14),.008,'rope',4)
        rod('standing rigging',(0,0,1.59),(x,-.80,.14),.008,'rope',4)

    begin('patkany')
    primitive('rat body','ico',(0,.03,.22),(.19,.32,.20),'rat_fur')
    primitive('rat head','ico',(0,-.26,.20),(.14,.17,.13),'rat_fur')
    primitive('pointed muzzle','ico',(0,-.415,.16),(.065,.10,.06),'rat_skin')
    for s in [-1,1]:
        primitive('round ear','ico',(s*.105,-.22,.33),(.075,.035,.085),'rat_skin')
        primitive('beady eye','ico',(s*.095,-.343,.24),(.024,.018,.025),'rat_eye')
        for y in [-.15,.23]:
            primitive('rat paw','ico',(s*.145,y,.04),(.055,.09,.038),'rat_skin')
    tail=[(0,.28,.15),(.07,.44,.09),(.16,.61,.06),(.11,.79,.04),(.20,.90,.03)]
    for i in range(4):
        rod('tapered tail',tail[i],tail[i+1],.026-i*.005,'rat_skin',5)

    # Hand-built roof families share their footprint, but not a silhouette.
    for variant, ridge, height, color in [('roof_slate',-.14,.48,'slate_blue'),
                                         ('roof_shingles',.11,.42,'roof_umber'),
                                         ('roof_shed',-.57,.29,'roof_rust')]:
        begin(variant)
        for side in [-1,1]:
            edge=side*.68
            mesh('crooked roof underlay',[(edge,-.72,-.065),(ridge,-.70,height-.065),
                 (ridge,.70,height-.10),(edge,.72,-.04)],[(0,1,2,3)],color)
            for r in range(4):
                for c in range(7):
                    a=r/4;b=(r+1.15)/4
                    x0=ridge+(edge-ridge)*a;x1=ridge+(edge-ridge)*b
                    y=-.73+c*.209+random.uniform(-.015,.015)
                    def height_at(x,y):
                        t=abs((x-ridge)/(edge-ridge))
                        return height*(1-t)-.045*(1-(y/.8)**2)+.018
                    vv=[(x0,y,height_at(x0,y)),(x1,y-.016,height_at(x1,y)),
                        (x1,y+.206,height_at(x1,y+.206)),(x0,y+.218,height_at(x0,y+.218))]
                    tint=random.choice([color,color,color,'slate_faded' if variant=='roof_slate' else 'roof_rust'])
                    mesh('uneven overlapping shingles',vv,[(0,1,2,3)],tint)
            rod('bowed eave',(edge,-.74,.005),(edge,.74,.025),.028,'wood_dark')
        for y in [-.665,.665]:
            mesh('weatherboard gable',[(-.58,y,-.02),(.58,y,-.02),(ridge,y,height-.03)],[(0,1,2)],'wood')
        rod('patched ridge',(ridge,-.76,height+.02),(ridge,.74,height-.025),.035,'wood_dark')

    begin('lean_to')
    for x in [-.50,.50]:
        rod('leaning support',(x,-.46,0),(x+.035,-.44,.65),.025,'wood')
    mesh('scrap roof',[(-.6,-.56,.61),(.6,-.56,.65),(.6,.15,.85),(-.6,.15,.82)],[(0,1,2,3)],'wood_dark')
    for i in range(8):
        box('uneven roof boards',(-.52+i*.15,-.18,.745),(.143,.8,.025),'wood_light' if i%3==0 else 'wood',(0.27,0,.012*(i%2)))
    box('cloth roof repair',(.2,-.19,.772),(.42,.40,.012),'canvas_patch',(.27,0,.05))

    begin('handcart')
    box('cart bed',(0,0,.22),(.43,.60,.06),'wood')
    for x in [-.24,.24]:
        for z in [.30,.39]: box('cart side',(x,0,z),(.035,.61,.067),'wood_light')
        rod('cart shaft',(x,-.2,.19),(x,-.94,.23),.02,'wood_dark')
        primitive('cart wheel','cyl',(x*1.25,.07,.17),(.16,.16,.045),'wood_dark',(0,PI/2,0),sides=10)
        for angle in [0,PI/3,PI*2/3]:
            rod('wheel spoke',(x*1.26,.07+math.cos(angle)*.13,.17+math.sin(angle)*.13),
                (x*1.26,.07-math.cos(angle)*.13,.17-math.sin(angle)*.13),.014,'wood_light')

    begin('fish_rack')
    for x in [-.34,.34]: rod('drying rack post',(x,0,0),(x,0,.82),.025,'wood_dark')
    rod('drying beam',(-.4,0,.78),(.4,0,.78),.03,'wood')
    for i in range(5):
        x=(i-2)*.12
        rod('fish tie',(x,0,.78),(x,0,.65),.006,'rope')
        primitive('salted fish','ico',(x,0,.52),(.028,.025,.12),'stone_light')
        mesh('fish tail',[(x,0,.63),(x-.035,0,.68),(x+.035,0,.68)],[(0,1,2)],'stone_dark')

    begin('drain_grate')
    box('drain recess',(0,0,.003),(.28,.39,.015),'wood_dark')
    for i in range(6): box('iron grating',(0,(i-2.5)*.06,.014),(.29,.014,.014),'iron')

    begin('notice_board')
    box('old notice board',(0,0,0),(.26,.032,.32),'wood_dark')
    for x,z,a in [(-.06,.07,.10),(.055,-.04,-.12)]:
        box('torn handbill',(x,-.02,z),(.13,.006,.17),'paper',(0,a,0))
        for d in [-.035,0,.035]: box('ink strokes',(x,-.024,z+d),(.072,.002,.005),'wood',(0,a,0))

    begin('net_bundle')
    for i in range(9):
        x=(i-4)*.055
        rod('net cord',(x,-.22,.025+abs(x)*.1),(x,.22,.06),.004,'rope',4)
        rod('net cord',(-.22,x,.05),(.22,x,.045),.004,'rope',4)
    for x in [-.19,0,.19]: primitive('net float','ico',(x,-.23,.04),(.035,.035,.04),'wood_light')

    # Third pass: what fills the yards between houses, and the far skyline.
    begin('fence')
    for i in range(7):
        h=.52+random.uniform(-.07,.05)
        box('mismatched fence board',(-.45+i*.15,0,h/2),(.13,.025,h),
            random.choice(['wood','wood','wood_light','wood_dark']),(0,random.uniform(-.06,.06),0))
    for z in [.14,.40]: box('fence rail',(0,.03,z),(1.0,.03,.05),'wood_dark',(0,.02,0))

    begin('woodpile')
    for row,count in enumerate([4,3,2]):
        for i in range(count):
            x=(i-(count-1)/2)*.11
            rod('split log',(x,-.2,.05+row*.095),(x+random.uniform(-.02,.02),.2,.05+row*.095),.05,
                random.choice(['wood_light','wood']),6)
    rod('chopping block',(.32,-.05,0),(.32,-.05,.16),.09,'wood_dark',7)

    begin('rubble')
    for x,y,s in [(0,0,.11),(.12,.06,.08),(-.1,.08,.07),(.05,-.1,.06),(.18,-.06,.05)]:
        primitive('broken masonry','ico',(x,y,s*.6),(s,s*.85,s*.7),random.choice(['stone','stone_light','brick']))
    box('fallen plank',(-.05,-.03,.03),(.42,.07,.025),'wood_light',(0,0,.5))

    begin('weeds')
    for i in range(3):
        a=i*2.1;r=.03+.025*i
        primitive('weed blade','cone',(math.cos(a)*r,math.sin(a)*r,.07+.01*i),(.035,.035,.14+.04*(i%3)),
                  'weed' if i%2 else 'scrub',(random.uniform(-.25,.25),random.uniform(-.25,.25),0),sides=4)

    begin('tree_pine')
    rod('pine trunk',(0,0,0),(0,0,.5),.07,'bark',5)
    for z,r,h in [(.42,.42,.62),(.78,.32,.52),(1.1,.2,.42)]:
        primitive('pine tier','cone',(0,0,z+h/2),(r,r,h),'leaf_dark',sides=6)

    begin('tree_round')
    rod('crooked trunk',(0,0,0),(.06,.03,.62),.075,'bark',5)
    for x,y,z,s in [(.05,0,.86,.36),(-.17,.07,.72,.24),(.24,-.06,.74,.22),(.04,.12,1.07,.2)]:
        primitive('leaf clump','ico',(x,y,z),(s,s,s*.85),'leaf' if s>.23 else 'leaf_dark')

    begin('tree_dead')
    rod('dead trunk',(0,0,0),(.04,0,.8),.055,'bark',5)
    for a,b in [((.03,0,.45),(-.28,.05,.78)),((.04,0,.62),(.3,-.04,.95)),((-.15,.03,.62),(-.2,.15,.9)),
                ((.04,0,.78),(.07,.1,1.08)),((.18,-.02,.8),(.36,.06,.88))]:
        rod('bare branch',a,b,.022,'bark',4)

    # One tall landmark that reads above the roofline behind every board.
    begin('bell_tower')
    box('tower shaft',(0,0,1.6),(.9,.9,3.2),'stone')
    for z in [.8,1.6,2.4]: box('string course',(0,0,z),(.96,.96,.07),'stone_dark')
    box('belfry floor',(0,0,3.25),(1.04,1.04,.1),'stone_dark')
    for x in [-.42,.42]:
        for y in [-.42,.42]: box('belfry pier',(x,y,3.62),(.16,.16,.66),'stone_light')
    primitive('hanging bell','cone',(0,0,3.6),(.2,.2,.3),'brass',sides=8)
    mesh('steep spire',[(-.6,-.6,3.95),(.6,-.6,3.95),(.6,.6,3.95),(-.6,.6,3.95),(.04,0,5.3)],
         [(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)],'slate_blue')
    for z in [1.2,2.0]: box('narrow lancet',(0,-.455,z),(.13,.02,.34),'wood_dark')
    instance('lamp_oil','belfry lantern',(0,-.6,3.1),scale=1.1)

    begin('jib_crane')
    rod('crane post',(0,0,0),(0,0,2.1),.07,'wood_dark',6)
    rod('crane jib',(0,0,.7),(0,-1.25,2.05),.05,'wood',6)
    rod('jib tie',(0,0,2.05),(0,-1.25,2.05),.03,'wood_dark',5)
    rod('hoist rope',(0,-1.2,2.0),(0,-1.2,.85),.008,'rope',4)
    instance('crate','hoisted cargo',(0,-1.2,.55),scale=.75)
    for a in range(4):
        rod('post strut',(0,0,.5),(math.cos(a*PI/2)*.45,math.sin(a*PI/2)*.45,0),.035,'wood_dark',5)

    begin('lighthouse')
    frustum('lighthouse tower',(0,0,0),.55,.3,2.1,'plaster_chalk')
    primitive('lighthouse base','cyl',(0,0,.15),(.62,.62,.3),'stone_dark',sides=8)
    primitive('lamp gallery','cyl',(0,0,2.08),(.42,.42,.08),'wood_dark',sides=8)
    primitive('lantern room','cyl',(0,0,2.3),(.24,.24,.36),'lamp_glass',sides=8)
    primitive('lantern roof','cone',(0,0,2.62),(.32,.32,.3),'roof_rust',sides=8)
    for z in [.7,1.4]: frustum('red band',(0,0,z),.565-z*.119,.565-(z+.16)*.119,.16,'roof_rust')


def house(name, x,y,turn=0,scale=1,inn=False,style='patched'):
    start=set(CURRENT.objects)
    plaster={'patched':'plaster_chalk','shack':'plaster_soot','inn':'plaster_ochre','shop':'plaster'}[style]
    height={'patched':.83,'shack':.67,'inn':.94,'shop':.79}[style]
    for side in [-1,1]:
        for root in [instance('wall',name+' facade',(0,side*.59,0),0 if side<0 else PI, (1,1,height/.9)),
                     instance('wall',name+' side',(side*.56,0,0),side*PI/2, (1.05,1,height/.9))]:
            for ob in root.children:
                if ob.type=='MESH':
                    for slot in ob.material_slots:
                        if slot.material.name=='plaster': slot.link='OBJECT';slot.material=MATS[plaster]
    roof={'patched':'roof_slate','shack':'roof_shed','inn':'roof_shingles','shop':'roof_slate'}[style]
    instance(roof,name+' repaired roof',(0,0,height-.035))
    chimney=instance('chimney',name+' crooked chimney',(.32,.28,height+.12),scale=.72)
    chimney.rotation_euler.y=.075 if style=='shack' else -.035
    # Weeds where wall meets ground, so no house stands on a swept floor.
    for wx,wy in random.sample([(-.58,-.62),(.58,-.62),(.6,.58),(-.6,.6),(.05,.63)],3):
        instance('weeds',name+' foundation weeds',(wx,wy,0),random.uniform(0,PI),random.uniform(.8,1.3))
    doorx=-.18 if style!='shack' else .12
    instance('door_reinforced',name+' door',(doorx,-.65,.015),scale=.9 if style=='shack' else 1)
    instance('window_barred',name+' window',(.32 if doorx<0 else -.32,-.65,height*.60),scale=.66)
    instance('window_barred',name+' side window',(-.61,.12,height*.6),-PI/2,scale=.7)
    instance('lamp_oil',name+' lamp',(-.44,-.66,height*.79),scale=.75)
    # Repairs tell a story: exposed brick, a braced wall, a shutter mended with
    # the wrong wood, and a threshold worn into the lane.
    for r in range(3):
        for i in range(3-r):
            box('exposed brick',(.20+i*.10-r*.03,-.646,.10+r*.062),(.094,.025,.052),'brick')
    rod('wall brace',(-.48,-.70,.09),(-.33,-.68,height*.8),.023,'wood_light')
    if style in ['shack','patched']:
        box('boarded shutter',(.33,-.726,height*.6),(.25,.025,.045),'wood_light',(0,-.24,0))
    instance('notice_board',name+' notices',(-.46,-.695,.33),scale=.65)
    instance('sack',name+' threshold sack',(.45,-.81,0),scale=.52)
    if style in ['inn','shop']:
        instance('lean_to',name+' porch',(0,-.60,0),scale=(.85,.6,1))
    if inn:
        rod('inn sign bracket',(.42,-.64,.87),(.42,-1.04,.87),.018,'iron')
        instance('sign_inn',name+' inn sign',(.42,-1.01,.62),scale=.9)
        instance('barrel',name+' rain barrel',(-.60,-.65,0),scale=.65)
    if style=='shack':
        for i in range(4):
            box('leaning scrap timber',(.72+i*.035,.12,.27),(.045,.09,.62),'wood_light',(0,-.32,0))
    if style in ['patched','inn']:
        # A later timber addition breaks the cottage box and joins the next
        # property. It is built from the same lean-to, not another house mesh.
        instance('lean_to',name+' attached scullery',(.88,.09,0),-.08, (.76,1.12,.73))
        for i in range(6):
            box('scullery weatherboards',(1.30,-.23+i*.105,.21),(.034,.098,.40),'wood' if i%2 else 'wood_dark')
        instance('barrel',name+' scullery tub',(1.03,-.29,0),scale=.51)
    roots=[ob for ob in set(CURRENT.objects)-start if ob.parent is None]
    root=empty(name,(x,y,0));root.rotation_euler.z=turn
    root.scale=(scale,)*3 if isinstance(scale,(int,float)) else scale
    for ob in roots: ob.parent=root
    return root


def stall(name,x,y,turn,kind,scale=1):
    start=set(CURRENT.objects)
    instance('stall_frame',name+' frame')
    awning={'weapons':'awning_grey','apothecary':'awning_green','liquor':'awning_russet','relics':'awning_plum','sailor':'awning_grey'}[kind]
    instance(awning,name+' canopy')
    instance('sign_'+kind,name+' trade sign',(0,-.415,.71),scale=.75)
    items={'weapons':['dagger','dagger','crate'],'apothecary':['bottle']*3,'liquor':['bottle','barrel','bottle'],'relics':['artifact','artifact','bottle'],'sailor':['rope_coil','anchor','bottle']}[kind]
    for i,asset in enumerate(items):
        ob=instance(asset,name+' wares '+str(i),(-.28+i*.28,-.04,.46),scale=.60 if asset in ['barrel','crate'] else 1)
        if asset=='dagger': ob.rotation_euler=(PI/2,0,.5)
    instance('crate',name+' stock',(.61,.10,0),scale=.65)
    instance('lamp_oil',name+' hanging oil lamp',(-.45,-.24,.84),scale=.58)
    if kind=='apothecary':
        for xx in [-.32,-.16,.05]:
            rod('herb string',(xx,.13,1.03),(xx,.13,.82),.005,'rope')
            for d in [-.03,0,.03]: primitive('drying herbs','ico',(xx+d,.13,.77),(.025,.024,.085),'moss')
        box('bottle shelf',(.67,.07,.46),(.26,.43,.035),'wood_dark')
        for yy in [-.07,.08]: instance('bottle','tonic on shelf',(.67,yy,.48),scale=.7)
    elif kind=='weapons':
        rod('weapon rack',(.62,.12,.05),(.62,.12,.75),.025,'wood_dark')
        rod('weapon rack rail',(.47,.12,.68),(.83,.12,.68),.02,'wood')
        for xx in [.52,.70]: instance('dagger','display blade',(xx,.10,.4),scale=1.15)
        instance('barrel','grinding barrel',(-.66,.14,0),scale=.65)
    elif kind=='liquor':
        instance('barrel','tapped ale cask',(-.73,-.1,0),scale=1.0)
        instance('barrel','wine barrel',(.77,.08,0),scale=.8)
        rod('wooden tap',(-.73,-.25,.22),(-.73,-.34,.22),.018,'wood_light')
    elif kind=='relics':
        mesh('counter drape',[(-.46,-.345,.46),(.46,-.345,.46),(.43,-.37,.19),(.12,-.385,.15),(-.46,-.36,.23)],[(0,1,2,3,4)],'awning_plum')
        for xx in [-.33,.0,.33]: primitive('brass talisman','cyl',(xx,.07,.81),(.042,.042,.01),'brass',(PI/2,0,0),sides=6)
    else:
        instance('net_bundle','folded fishing net',(.72,-.12,.02),scale=1.3)
    roots=[ob for ob in set(CURRENT.objects)-start if ob.parent is None]
    proportions={'weapons':(1.2,.9,.87),'apothecary':(.98,1,1.04),'liquor':(1.1,1.0,.90),'relics':(.94,1.05,1.08),'sailor':(1.1,1,.95)}[kind]
    root=empty(name,(x,y,0));root.rotation_euler.z=turn;root.scale=tuple(v*scale for v in proportions)
    for ob in roots: ob.parent=root
    return root


def ship(name,x,y,pirate=False,scale=1):
    start=set(CURRENT.objects)
    instance('ship_hull',name+' hull')
    instance('mast_sail',name+' sail')
    flag=instance('flag',name+' flag',(0,0,1.48),scale=.55)
    if not pirate:
        for ob in flag.children:
            if ob.type=='MESH':
                for slot in ob.material_slots:
                    if slot.material.name=='flag_cloth':
                        slot.link='OBJECT';slot.material=MATS['linen']
    if pirate: instance('pirate_emblem',name+' pirate emblem',(0,0,1.48),scale=.55)
    instance('barrel',name+' provisions',(.17,-.65,.1),scale=.48)
    roots=[ob for ob in set(CURRENT.objects)-start if ob.parent is None]
    root=empty(name,(x,y,-.10));root.scale=(scale,)*3
    for ob in roots: ob.parent=root


def cobbles(x0,x1,y0,y1,step=None):
    """Mark a square for paving; `pave()` lays every square and street at once."""
    PAVED.append((x0,x1,y0,y1))


def paved(x,y):
    if any(x0<=x<=x1 and y0<=y<=y1 for x0,x1,y0,y1 in PAVED): return True
    p=Vector((x,y,0))
    for a,b,w in LANES:
        if w>=3: continue  # a reserved footprint, not a street
        ab=b-a;t=max(0,min(1,(p-a).dot(ab)/ab.length_squared))
        if (a+ab*t-p).length<w/2: return True
    return False


def pave(step=.27,reach=13):
    """The same worn stone on the square and in the streets, in one layer.

    Overlapping street surfaces at nearly the same height flicker against each
    other at a distance, so nothing is laid twice: one staggered grid, each
    stone placed once wherever any street or square wants one. Stones are
    batched into a handful of meshes here rather than thousands of objects,
    split at the shadow radius so the far ones can skip the shadow pass.
    """
    groups={}
    rows=int(2*reach/step)
    for j in range(rows):
        y=-reach+(j+.5)*step
        for i in range(rows):
            x=-reach+(i+.5)*step+(j%2)*step*.5
            if math.hypot(x,y)>reach or not paved(x,y): continue
            # A street running to the quay stops at the quay wall, not in the water.
            if any(at_sea(SCENE,x+dx,y) for dx in (-.25,0,.25)): continue
            # The edge of a street frays: some border stones are missing.
            d=step*.75
            if not all(paved(x+dx,y+dy) for dx,dy in [(d,0),(-d,0),(0,d),(0,-d)]) and random.random()<.3: continue
            # Worn, hand-laid stones: chamfered corners, uneven courses, no
            # continuous straight grout lines masquerading as a tiled patio.
            cx=x+random.uniform(-.013,.013);cy=y+random.uniform(-.013,.013)
            w=step*random.uniform(.46,.51);h=step*random.uniform(.44,.50)
            outline=[(-w*.72,-h),(w*.63,-h),(w,-h*.56),(w,h*.58),(w*.62,h),(-w*.72,h),(-w,h*.48),(-w,-h*.52)]
            top=.016+random.uniform(-.005,.005)
            material=random.choice(['stone','stone','stone_light','stone_dark'])
            far=math.hypot(x,y)>SHADOW_REACH
            # Far stones go in 6-unit chunks, so each chunk's centre is far too
            # and export() files it with the shadowless batches.
            cell=(math.floor(x/6),math.floor(y/6)) if far else None
            verts,faces=groups.setdefault((material,cell),([],[]))
            base=len(verts)
            if far:
                # From across the square a stone is its top: the sides are a
                # sliver of a pixel, so far stones keep only the face you see.
                verts.extend((cx+dx,cy+dy,top) for dx,dy in outline)
                faces.append(tuple(base+k for k in range(8)))
                continue
            verts.extend((cx+dx,cy+dy,z) for z in [-.019,top] for dx,dy in outline)
            # No underside: nothing ever sees it.
            faces.append(tuple(base+k for k in range(8,16)))
            faces.extend((base+k,base+(k+1)%8,base+(k+1)%8+8,base+k+8) for k in range(8))
    for (material,cell),(verts,faces) in sorted(groups.items(),key=lambda kv:(kv[0][0],kv[0][1] or (0,0))):
        mesh(('far ' if cell else '')+'worn cobbles',verts,faces,material)


def earth_patch(x,y,r,materials,squash=.55):
    """A rubbed-in patch of ground. Patches never overlap one another, and each
    sits on one of four levels well apart, so none can flicker against another."""
    for px,py,pr in EARTH:
        if math.hypot(x-px,y-py)<r*1.3+pr*1.3: return None
    EARTH.append((x,y,r))
    z=-.0235+.003*(len(EARTH)%4)
    verts=[(x+math.cos(j*PI/4)*r*random.uniform(.7,1.3),y+math.sin(j*PI/4)*r*squash,z) for j in range(8)]
    patch=mesh('weathered earth',verts,[tuple(range(8))],random.choice(materials))
    # A surface stain should not cast a detached shadow onto its own ground.
    patch.visible_shadow=False
    return patch


def street_wear(x,y,r=.3,wet=False):
    points=[(x+math.cos(i*PI/4)*r*random.uniform(.7,1.1),
             y+math.sin(i*PI/4)*r*.45*random.uniform(.8,1.2),.026) for i in range(8)]
    mesh('rain puddle' if wet else 'dirt and moss',points,[tuple(range(8))],'puddle' if wet else 'moss')
    for i in range(3):
        primitive('broken stone chip','ico',(x+random.uniform(-r,r),y+random.uniform(-r/2,r/2),.032),(.038,.025,.015),'stone_dark')


def washing_line(name,a,b):
    a=Vector(a);b=Vector(b)
    for p in [a,b]: rod(name+' pole',(p.x,p.y,0),p,.018,'wood_dark')
    points=[a.lerp(b,i/8)+Vector((0,0,-.16*math.sin(i*PI/8))) for i in range(9)]
    for i in range(8): rod(name+' sagging line',points[i],points[i+1],.006,'rope',4)
    for i in [2,4,6]:
        p=points[i];w=.17;h=random.uniform(.25,.39)
        mesh(name+' mended laundry',[(p.x-w,p.y,p.z),(p.x+w,p.y,p.z),
             (p.x+w*.85,p.y+.04,p.z-h),(p.x+.025,p.y-.025,p.z-h-.025),
             (p.x-w*.88,p.y+.01,p.z-h+.025)],[(0,1,2,3,4)],'cloth_wash' if i!=4 else 'canvas_patch')


def sea(x0,x1,y0,y1,step=.85):
    verts=[]; faces=[]
    nx=int((x1-x0)/step)+1;ny=int((y1-y0)/step)+1
    for j in range(ny+1):
        for i in range(nx+1):
            verts.append((x0+(x1-x0)*i/nx,y0+(y1-y0)*j/ny,-.20+random.uniform(-.018,.018)))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i;b=a+nx+1
            faces.extend([(a,a+1,b+1),(a,b+1,b)])
    ob=mesh('faceted harbor water',verts,faces,'water')
    for m in ['water_light','water_dark']: ob.data.materials.append(MATS[m])
    for p in ob.data.polygons: p.material_index=random.choices([0,1,2],[8,1,2])[0]
    for i in range(28):
        x=random.uniform(x0+.2,x1-.2);y=random.uniform(y0,y1)
        box('water glint',(x,y,-.165),(random.uniform(.1,.4),.012,.006),'water_light')


def lane(name,a,b,width=1.6):
    """A street: its course for `pave()`, a dark bed under the stones, gutters.

    Every bed sits at the same height in the same material, so where streets
    cross, the overlap is invisible rather than a flicker."""
    a,b=Vector(a),Vector(b)
    for p in (a,b):
        p.x=max(-REACH,min(REACH,p.x));p.y=max(-REACH,min(REACH,p.y))
    LANES.append((a.copy(),b.copy(),width))
    mid=(a+b)/2
    angle=math.atan2(b.y-a.y,b.x-a.x)
    normal=Vector((-math.sin(angle),math.cos(angle),0))
    corners=[a-normal*width/2,b-normal*width/2,b+normal*width/2,a+normal*width/2]
    bed=mesh(name+' roadbed',[(p.x,p.y,-.012) for p in corners],[(0,1,2,3)],'stone_dark')
    bed.visible_shadow=False
    for side in [-1,1]:
        p=mid+normal*side*(width/2+.035)
        box(name+' gutter',(p.x,p.y,-.008),((b-a).length,.065,.014),'stone_dark',(0,0,angle))


def roofline_house(name,x,y,width,depth,height,turn=0):
    """Distant buildings reuse the kit roof silhouette with a cheap solid shell."""
    start=set(CURRENT.objects)
    box(name+' plaster shell',(0,0,height/2),(1.13,1.18,height),random.choice(['plaster','plaster_soot','plaster_ochre']))
    instance(random.choice(['roof_slate','roof_shingles','roof_shed']),name+' roof',(0,0,height-.035))
    if random.random()<.6:
        instance('chimney',name+' chimney',(.28,.25,height+.1),scale=.7)
    # A tenement gets a window per storey, not one row stretched up a blank wall.
    for z in ([.3,.68] if height>2 else [.62]):
        for xx in [-.33,.29]:
            box(name+' dark window',(xx,-.596,height*z),(.16,.016,.24),'wood_dark')
    if height>2:
        box(name+' storey band',(0,-.592,height*.5),(1.14,.02,.05),'wood_dark')
    roots=[ob for ob in set(CURRENT.objects)-start if ob.parent is None]
    root=empty(name,(x,y,0));root.scale=(width,depth,1);root.rotation_euler.z=turn
    for ob in roots: ob.parent=root
    return root


def on_lane(x,y,r):
    p=Vector((x,y,0))
    for a,b,w in LANES:
        ab=b-a;t=max(0,min(1,(p-a).dot(ab)/ab.length_squared))
        if (a+ab*t-p).length<w/2+r: return True
    return False


def at_sea(name,x,y):
    return (name=='kikoto' and x<-2.9) or (name=='sikator' and x<-2.7 and y>4.4)


def clear(name,x,y,r,arena=False):
    """Room for scenery: off the streets, out of the water, and off the board."""
    # The whole footprint must be on dry land, not just its centre.
    if any(at_sea(name,x+dx,y+dy) for dx,dy in [(0,0),(r,0),(-r,0),(0,r),(0,-r)]) or on_lane(x,y,r): return False
    return not (arena and abs(x)<(.75 if name=='sikator' else 1.95)+r and abs(y)<2.75+r)


def backyard(x,y,turn,size):
    """A fenced yard behind a house: what a street-facing facade hides."""
    back=Vector((-math.sin(turn),math.cos(turn),0));side=Vector((math.cos(turn),math.sin(turn),0))
    depth=.59*size[1]
    for k in [-1,0,1]:
        if random.random()<.25: continue  # a missing panel, long since burned
        p=Vector((x,y,0))+back*(depth+.85)+side*(k*1.0+random.uniform(-.05,.05))
        fence=instance('fence','yard fence',p,turn+random.uniform(-.06,.06))
        fence.rotation_euler.y=random.uniform(-.08,.08)
    p=Vector((x,y,0))+back*(depth+.4)+side*random.uniform(-.6,.6)
    instance(random.choice(['woodpile','rubble','woodpile','tree_dead']),'yard clutter',p,turn+random.uniform(-.4,.4),
             random.uniform(.9,1.2))
    if random.random()<.45:
        p=Vector((x,y,0))+back*(depth+1.6)+side*random.uniform(-1,1)
        instance(random.choice(['tree_round','tree_round','tree_dead']),'yard tree',p,random.uniform(0,PI),random.uniform(1.1,1.6))


def grove(x,y,n,spread,scale=1.4):
    for i in range(n):
        instance(random.choice(['tree_round','tree_round','tree_pine','tree_dead']),'district tree',
                 (x+random.uniform(-spread,spread),y+random.uniform(-spread,spread),0),
                 random.uniform(0,PI),scale*random.uniform(.8,1.25))


def backdrop_house(name,x,y,width,depth,height,turn=0):
    """The town past where the camera can go: a plain shell under a plain roof.

    A dozen faces where a kit house has hundreds. From the board these are
    roofs going into the fog, which is all they need to be."""
    wall=random.choice(['plaster','plaster_soot','plaster_ochre','plaster_chalk'])
    roof=random.choice(['slate_blue','roof_umber','roof_rust','roof_umber','slate_faded'])
    c,sn=math.cos(turn),math.sin(turn)
    def at(lx,ly,z): return (x+lx*c-ly*sn,y+lx*sn+ly*c,z)
    w,d=width/2,depth/2
    base=[at(-w,-d,0),at(w,-d,0),at(w,d,0),at(-w,d,0)]
    top=[at(-w,-d,height),at(w,-d,height),at(w,d,height),at(-w,d,height)]
    mesh(name+' shell',base+top,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],wall)
    # A pitched roof along the house's width, eaves overhanging a little.
    ridge=height+depth*random.uniform(.32,.45);e=.08
    mesh(name+' roof',[at(-w-e,-d-e,height-.04),at(w+e,-d-e,height-.04),at(w+e,0,ridge),at(-w-e,0,ridge),
                       at(w+e,d+e,height-.04),at(-w-e,d+e,height-.04)],
         [(0,1,2,3),(3,2,4,5)],roof)
    mesh(name+' gables',[at(-w,-d,height),at(-w,d,height),at(-w,0,ridge-.03),at(w,d,height),at(w,-d,height),at(w,0,ridge-.03)],
         [(1,0,2),(4,3,5)],wall)
    if random.random()<.55:
        box(name+' chimney',at(w*.5,d*.3,ridge-.05),(.18,.2,.42),'stone',(0,0,turn))
    for k in range(2 if width>2 else 1):
        lx=(-.25 if k==0 else .25)*width if width>2 else 0
        box(name+' window',at(lx,-d-.005,height*.55),(.18,.012,.24),'wood_dark',(0,0,turn))


def string_lights(name,a,b,poles=True):
    """Glowing bulbs on a sagging cord: light without a shader light."""
    a=Vector(a);b=Vector(b)
    if poles:
        for p in [a,b]: rod(name+' pole',(p.x,p.y,0),(p.x,p.y,p.z+.05),.025,'wood_dark')
    points=[a.lerp(b,i/10)+Vector((0,0,-.22*math.sin(i*PI/10))) for i in range(11)]
    for i in range(10):
        rod(name+' cord',points[i],points[i+1],.006,'rope',4)
        m=(points[i]+points[i+1])/2-Vector((0,0,.05))
        primitive(name+' bulb','ico',m,(.028,.028,.034),'string_bulb')


def surroundings(name):
    """A street plan around the arena, then economical skyline masses to the fog."""
    # A separate seed keeps background additions from reshuffling foreground props.
    saved=random.getstate();random.seed({'sikator':113,'feketepiac':227,'kikoto':349}[name])
    if name=='sikator':
        lane('alley continuation',(0,-32,0),(0,28,0),1.55)
        lane('southern cross street',(-35,-6.8,0),(35,-6.8,0),2.2)
        lane('market approach',(.8,7.7,0),(35,7.7,0),2.0)
        cobbles(-.75,.75,-9,-5.5,.32)
        cobbles(-.75,.75,5,10,.32)
        cobbles(-6.7,7.5,-7.55,-6.1,.34)
        # The harbor and market miniatures now share real approaches with the alley.
        lane('harbor approach',(-7,3.9,0),(-.8,3.9,0),1.0)
        lane('market side lane',(1.5,4,0),(1.5,12,0),1.0)
        near=[(-5.6,y,PI/2) for y in [-4.2,-1.5,1.5]]
        near += [(6.9,y,-PI/2) for y in [-4.4,-1.2,2.2,5.0]]
        near += [(x,-9,PI) for x in [-8.6,-5,-2.3,2.7,6.1,9.5]]
        near += [(x,10.3,0) for x in [3.6,7.1,10.5]]
    elif name=='feketepiac':
        for y in [-5.1,7.2]: lane('market cross street',(-38,y,0),(38,y,0),2.0)
        lane('market high street',(0,-35,0),(0,35,0),2.0)
        cobbles(-.9,.9,-8,-3.25,.32)
        cobbles(-.9,.9,4.7,8.2,.32)
        for x in [-6.8,6.8]: lane('back court lane',(x,-14,0),(x,16,0),1.15)
        near=[(x,y,-math.copysign(PI/2,x)) for x in [-8.5,8.5] for y in [-3.5,0,3.4,6.8]]
        near += [(x,y,0 if y>0 else PI) for y in [-8.2,10] for x in [-9.8,-6.2,-2.8,3,6.4,10]]
    else:
        lane('quayside promenade',(-1.8,-36,0),(-1.8,36,0),1.75)
        lane('warehouse lane',(6.8,-36,0),(6.8,36,0),1.6)
        for y in [-6.2,8]: lane('harbor cross street',(-2.7,y,0),(38,y,0),1.8)
        cobbles(-2.75,3.6,-8,-4.5,.36)
        cobbles(-2.75,3.6,5.1,9,.36)
        # A stone quay continues beyond the close scene instead of ending as a slab.
        box('continuous quay wall',(-2.96,0,-.13),(.14,40,.38),'stone_dark')
        box('quay coping',(-2.91,0,.015),(.22,40,.08),'stone')
        for y in range(-15,16,3):
            if abs(y)<4: continue
            primitive('mooring bollard','cyl',(-2.75,y,.14),(.09,.09,.27),'wood_dark')
        box('outer harbor breakwater',(-7.7,13,-.12),(9.4,.65,.42),'stone_dark')
        box('breakwater cap',(-7.7,13,.11),(9.6,.76,.08),'stone')
        instance('lighthouse','breakwater lighthouse',(-11.9,13,.15),0,1.25)
        for y in [7.0,11.2]:
            instance('jib_crane','quay crane',(-2.5,y,0),-PI/2,1.0)
        for x,y,pirate,sc in [(-9.5,-6.5,False,.9),(-14,3.5,True,1.0),(-8.4,9.2,False,.8)]:
            ship('ship at anchor',x,y,pirate,sc)
        near=[(9.1,y,-PI/2) for y in [-9.5,-5.7,-1.5,2.7,6.4,10.4]]
        near += [(x,y,0 if y>0 else PI) for y in [-10,11] for x in [.2,3.7]]
        for x,y in [(4.9,-7.2),(5,8.9),(11.2,-3)]:
            instance('lean_to','warehouse loading shelter',(x,y,0),scale=(1.7,1.2,1.2))
            instance('handcart','freight cart',(x-.8,y-1.1,0),.6)
            for j in range(3): instance('crate','warehouse stock',(x+j*.46-.5,y,.05),.07, .9)
            instance('net_bundle','warehouse net',(x+.6,y-1.1,.02),scale=2)
    landmark={'sikator':(3.6,13.4,-.2),'feketepiac':(-4.4,12.9,.25),'kikoto':(3.2,13.2,.1)}[name]
    instance('bell_tower','old bell tower',landmark[:2]+(0,),landmark[2],1.15)
    tower=Vector(landmark[:2]+(0,));LANES.append((tower,tower+Vector((.01,0,0)),3.2))
    grove(landmark[0]+2.2,landmark[1]+.6,3,.8)
    for i,(x,y,t) in enumerate(near):
        sty=['shack','patched','shop','inn'][i%4]
        turn=t+random.uniform(-.12,.12)
        size=(random.uniform(1.3,1.8),random.uniform(.95,1.3),random.uniform(.80,1.03))
        house('outer '+name+' '+str(i),x,y,turn,size,sty=='inn',sty)
        # Clutter belongs at doorways and courts, not scattered over the arena.
        instance('barrel','courtyard rain barrel',(x+.8,y+.85,0),scale=.8)
        if i%3==0:
            instance('handcart','court handcart',(x-1.1,y+.9,0),.7, .7)
            washing_line('court washing',(x-.8,y+.9,1.2),(x+.75,y+1.05,1.25))
        backyard(x,y,turn,size)
    # Inward-facing blocks leave the streets open. There are no human
    # spectators, and no tall new object enters the playable footprint.
    count=0
    # Past the houses with yards, the town goes on in two cheaper tiers: kit
    # roofs over plain shells, then plain shells under plain roofs into the fog.
    candidates=[(x,y,0 if y>0 else PI) for y in [-13.2,13.2]
                for x in [v*3.4 for v in range(-4,5)]]
    candidates+=[(x,y,-math.copysign(PI/2,x)) for x in [-13.2,13.2]
                 for y in [v*3.4 for v in range(-3,4)]]
    for x,y,t in candidates:
        x+=random.uniform(-.7,.7);y+=random.uniform(-.7,.7)
        if math.hypot(x,y)>15 or not clear(name,x,y,1.5): continue
        if random.random()<.16:
            grove(x,y,random.randint(2,4),1.3)
            continue
        tall=random.random()<.18
        roofline_house('skyline '+str(count),x,y,random.uniform(1.8,3.0),random.uniform(1.6,2.4),
                       random.uniform(2.1,2.8) if tall else random.uniform(1.0,1.8),t+random.uniform(-.14,.14))
        count+=1
    for gy in [v*2.9 for v in range(-7,8)]:
        for gx in [v*2.9 for v in range(-7,8)]:
            x=gx+random.uniform(-.5,.5);y=gy+random.uniform(-.5,.5)
            if max(abs(x),abs(y))<14.3 or math.hypot(x,y)>REACH or not clear(name,x,y,1.3): continue
            if random.random()<.12: continue  # a yard, a gap, a burned-out lot
            # Face the nearer axis, as streets of a town laid out round its square.
            t=(0 if y>0 else PI) if abs(y)>abs(x) else -math.copysign(PI/2,x)
            backdrop_house('backdrop '+str(count),x,y,random.uniform(1.7,2.6),random.uniform(1.5,2.1),
                           random.uniform(1.6,2.4) if random.random()<.2 else random.uniform(.8,1.5),
                           t+random.uniform(-.12,.12))
            count+=1
    # Weeds and rubbed-in earth over the whole district, not just the arena.
    for i in range(140):
        x=random.uniform(-11,11);y=random.uniform(-11,11)
        if not clear(name,x,y,.15,arena=True): continue
        instance('weeds','district weeds',(x,y,0),random.uniform(0,PI),random.uniform(.8,1.5))
    for i in range(90):
        x=random.uniform(-13,13);y=random.uniform(-13,13)
        r=random.uniform(.5,1.4)
        # The whole patch, not only its centre, has to be on dry land.
        if abs(x)<6 and abs(y)<7 or not clear(name,x,y,r*1.3+.1): continue
        earth_patch(x,y,r,['mud','dust','scrub'],.6)
    random.setstate(saved)


def scene_ground(name):
    # Each scene starts its own street plan: one scene's lanes must not pave
    # or block the next one built in the same Blender session.
    LANES.clear();PAVED.clear();EARTH.clear()
    global SCENE
    SCENE=name
    if name=='kikoto':
        box('earthen district',(18.5,0,-.055),(43,80,.06),'earth')
    elif name=='sikator':
        box('earthen district',(0,-17.75,-.055),(80,44.5,.06),'earth')
        box('distant market ground',(18.65,22.25,-.055),(42.7,35.5,.06),'earth')
    else:
        box('earthen district',(0,0,-.055),(80,80,.06),'earth')
    # Broad rubbed-in earth patches tie buildings to a shared place. They sit
    # below the paving, never over a playable tile or over water.
    for i in range(50):
        x=random.uniform(-5.7,5.7);y=random.uniform(-5.8,6.8)
        r=random.uniform(.22,.65)
        if any(at_sea(name,x+dx,y+dy) for dx,dy in [(0,0),(r*1.3,0),(-r*1.3,0),(0,r),(0,-r)]): continue
        earth_patch(x,y,r,['mud','dust','earth'])
    if name=='sikator':
        cobbles(-.78,.78,-5.5,5.0)
        for x in [-.82,.82]:
            box('alley drainage channel',(x,0,-.006),(.06,10.5,.02),'stone_dark')
        for side in [-1,1]:
            # Joined stretches and gaps make a street that grew piecemeal.
            layout=([(-3.35,1.85,(1.6,1.03,.95),'shack'),(-.55,1.72,(1.45,1,.96),'patched'),
                     (2.45,1.98,(1.9,1.10,1),'inn')] if side<0 else
                    [(-3.45,1.84,(1.35,1.12,.87),'patched'),(-1.05,1.90,(1.2,1.15,.95),'shack'),
                     (1.3,1.75,(1.5,.93,1),'shop'),(3.9,2.12,(1.25,1.18,.93),'shack')])
            for i,(y,offset,size,style) in enumerate(layout):
                house('alley '+style,side*offset,y+(side*.12),-side*PI/2+random.uniform(-.045,.045),size,inn=style=='inn',style=style)
            for y in [-2.8,.95,2.7]:
                instance('barrel','alley barrel',(side*.94,y,0),scale=.62)
                instance('sack','alley sack',(side*1.01,y+.3,0),scale=.55)
                street_wear(side*.79,y-.25,.17,wet=True)
        instance('handcart','abandoned cart',(-2.05,-2.04,0),.48,.72)
        instance('drain_grate','alley drain',(.68,.12,.017),scale=.5)
        washing_line('alley laundry',(-1.15,3.45,1.45),(1.25,3.68,1.53))
        # A timber gate where the alley meets the market street: slim, so it
        # frames the far end without walling it off.
        for x in [-.9,.9]:
            box('alley gate post',(x,5.05,.52),(.12,.14,1.04),'wood_dark',(0,x*.03,0))
            box('post footing stone',(x,5.05,.05),(.2,.2,.1),'stone_dark')
            rod('gate knee brace',(x,5.05,.78),(x*.62,5.05,1.02),.03,'wood_dark',5)
        box('alley gate beam',(0,5.05,1.07),(2.0,.13,.11),'wood_dark',(0,.025,0))
        instance('lamp_oil','gate lamp',(0,4.97,.93),0,.75)
        instance('sign_inn','gate tavern sign',(.5,4.93,.84),0,.6)
        instance('rubble','alley rubble',(-.55,-3.85,0),.4,.8)
        instance('weeds','alley weeds',(.66,-1.6,0),0,.8)
        instance('weeds','alley weeds',(-.7,1.5,0),1.2,.9)
        for side,ys in [(-1,[-2.0,1.05]),(1,[-2.05,.10,2.85])]:
            for y in ys:
                instance('wall','shared courtyard wall',(side*1.08,y,0),-side*PI/2,(.8,1,.57))
                instance('door_reinforced','yard gate',(side*1.02,y,.01),-side*PI/2,.65)
        house('back courtyard workshop',-3.35,1.7,.2,(1.6,1.0,.82),False,'shack')
        house('back courtyard lodging',3.65,3.15,-.25,(1.4,1.1,.84),False,'patched')
        # Distant districts, intentionally miniature but composed from the same kit.
        sea(-40,-2.7,4.5,40,2.5)
        for x in [-6.8,-5.9,-5,-4.1,-3.2]:
            box('distant harbor retaining wall',(x,4.52,-.035),(.89,.16,.23),'stone_dark')
        instance('dock','distant quay',(-3.5,5.6,-.08),PI/2,.65)
        ship('distant pirate',-4.4,5.5,True,.67)
        ship('distant trader',-6,6.1,False,.55)
        for i,k in enumerate(['weapons','apothecary','liquor','relics']):
            stall('distant market',2.65+(i%2)*1.25,4.5+(i//2)*1.4,0,k,.76)
        for x,sty in [(-2,'shack'),(1.7,'inn'),(4.9,'patched')]: house('distant tenement',x,6.4,-.08,(1.2,1,.8),sty=='inn',sty)
    elif name=='feketepiac':
        cobbles(-3.4,3.4,-3.25,4.7)
        for x,y,t,k in [(-2.75,-1.85,1.32,'weapons'),(-2.70,1.5,1.75,'apothecary'),(2.85,-1.2,-1.76,'liquor'),(2.55,2.0,-1.37,'relics')]:
            stall(k,x,y,t,k)
        for x,y,t,size,sty in [(-3.8,4.7,.18,(1.6,1.1,.93),'patched'),(-1.7,5.35,-.08,(1.2,.9,.9),'shack'),
                (.75,4.95,-.13,(1.8,1.25,1.05),'inn'),(3.45,5.55,.12,(1.15,1,.83),'shack'),
                (-4.45,-2.9,1.45,(1.55,1.05,.9),'shop'),(-4.4,.4,1.68,(1.25,1.2,1),'patched'),
                (4.6,-2.8,-1.45,(1.35,.97,.85),'shack'),(4.45,.30,-1.75,(1.7,1.2,.96),'shop')]:
            house('market '+sty,x,y,t,size,inn=sty=='inn',style=sty)
        washing_line('back-court washing',(-2.1,4.2,1.35),(-.45,4.4,1.42))
        string_lights('market lights back',(-3.25,3.15,1.6),(3.3,3.05,1.65))
        string_lights('market lights west',(-3.25,-2.75,1.5),(-3.25,3.15,1.6))
        string_lights('market lights east',(3.3,-2.6,1.55),(3.3,3.05,1.65))
        instance('handcart','provision cart',(1.85,4.15,0),-.42,.87)
        for x,y in [(-2.1,3.0),(2.1,-3.0),(-3.25,-.2),(3.35,1.4)]: street_wear(x,y,.34,wet=x<0)
        for x,y in [(-3.55,-2.6),(3.6,-.2),(-3.5,2.9),(3.6,3.7)]:
            instance('crate','market cargo',(x,y,0),.12)
            instance('barrel','market barrel',(x+.38,y+.23,0),scale=.8)
    else:
        # Sea to the left in the initial game view; an open sunny plaza to the right.
        sea(-40,-3.0,-40,40,2.5)
        cobbles(-2.8,3.6,-4.5,5.1)
        for y in [-2.0,2.0]:
            instance('dock','wooden finger pier',(-3.72,y,-.025),PI/2)
        ship('pirate ship',-5.05,-2,True,1.1)
        ship('merchant ship',-5.05,2.05,False,1.05)
        for y in [-2,2]:
            for off in [-.7,.7]:
                rod('mooring rope',(-4.1,y+off,.08),(-4.66,y+off,.11),.016,'rope',5)
        house('weathered waterside inn',.7,5.25,-.12,(2.2,1.3,1.03),True,'inn')
        house('inn kitchen extension',2.45,5.5,.10,(1.1,1.15,.78),False,'shack')
        house('rope maker',4.8,1.8,-1.72,(1.8,1.15,.92),False,'shop')
        house('boatwright shed',4.65,-2.4,-1.45,(1.6,1.1,.80),False,'shack')
        house('old harbor store',-1.65,5.9,.06,(1.5,1.0,.91),False,'patched')
        instance('lean_to','sail mending shelter',(3.1,-3.95,0),-.18,1.15)
        instance('fish_rack','drying catch',(-2.45,4.3,0),.2)
        instance('handcart','quayside cart',(3.05,1.5,0),.25,.8)
        for x,y in [(-3.4,-1.6),(-3.4,2.4),(3.3,-3.75)]: instance('net_bundle','mending net',(x,y,.055),.4,1.5)
        for x,y in [(-2.75,-3.65),(-2.77,.6),(-2.7,3.8),(3.3,-2.1)]: street_wear(x,y,.25)
        stall('sailor outfitter',2.65,2.9,-PI/2,'sailor')
        stall('ships provisions',.3,4.05,0,'liquor')
        for i,(x,y) in enumerate([(-2.47,-3.0),(-2.35,.05),(-2.45,3.3),(2.9,-2.6),(3.1,.1)]):
            instance('crate','dock cargo',(x,y,0),.06)
            instance('crate','dock cargo',(x+.42,y+.04,0),-.1,.82)
            instance('crate','stacked cargo',(x+.05,y,.4),.08,.70)
            instance('barrel','dock barrel',(x,y+.49,0),scale=.9)
            instance('rope_coil','dock rope',(x+.46,y+.48,0))
    surroundings(name)
    pave()


# One poor harbour town at three times of day (docs/art-bible.md §4): the quay
# in late afternoon, the market at dusk, the alley at night. The key light comes
# from the upper left of the home view, as the stage's sun does.
LIGHT={
    'kikoto':dict(sun=(1,.78,.52),energy=3.6,elevation=30,sky=(.30,.48,.72),strength=.8,
                  lamp=5,fog=(.36,.50,.68),mist=(18,60),exposure=.66),
    'feketepiac':dict(sun=(1,.62,.36),energy=2.4,elevation=13,sky=(.19,.13,.15),strength=.55,
                      lamp=14,fog=(.17,.115,.12),mist=(12,46),exposure=.85),
    'sikator':dict(sun=(.56,.67,1),energy=.6,elevation=50,sky=(.03,.04,.08),strength=.9,
                   lamp=20,fog=(.03,.04,.075),mist=(7,26),exposure=.6),
}
# Card cameras: perspective, a little above a unit's eye, looking into the place
# at its focal subject (location, target, lens in mm).
CARD={
    'sikator':((.3,-5.0,1.95),(-.05,2.2,-.15),26),
    'feketepiac':((-.4,-5.0,1.9),(.35,2.6,.3),26),
    'kikoto':((-7.4,-5.6,1.9),(-2.4,1.6,.75),30),
}


def staged(name,make):
    """Lights and cameras live outside the exported collection; reuse them on reopen."""
    scene=bpy.context.scene
    name=scene.name+' '+name
    ob=bpy.data.objects.get(name)
    if ob is None:
        ob=bpy.data.objects.new(name,make())
        holder=bpy.data.collections.get(scene.name+' lighting and cameras')
        if holder is None:
            holder=bpy.data.collections.new(scene.name+' lighting and cameras')
            scene.collection.children.link(holder)
        holder.objects.link(ob)
    return ob


def light(name):
    scene=bpy.context.scene
    look=LIGHT[name]
    scene.render.engine='CYCLES'
    scene.cycles.use_denoising=True
    scene.world=bpy.data.worlds.get(name+' sky') or bpy.data.worlds.new(name+' sky')
    scene.world.use_nodes=True
    node=scene.world.node_tree.nodes.get('Background')
    node.inputs['Color'].default_value=look['sky']+(1,)
    node.inputs['Strength'].default_value=look['strength']
    sun=staged('sun',lambda:bpy.data.lights.new('sun','SUN'))
    sun.data.energy=look['energy'];sun.data.color=look['sun'];sun.data.angle=.1
    e=math.radians(look['elevation']);h=Vector((-3.5,-4.5,0)).normalized()
    toward=-(h*math.cos(e)+Vector((0,0,math.sin(e))))
    sun.rotation_euler=toward.to_track_quat('-Z','Y').to_euler()
    for data in bpy.data.lights:
        if data.type=='POINT': data.energy=look['lamp']
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=look['exposure']
    scene.render.fps=24;scene.frame_start=1;scene.frame_end=145
    scene.frame_set(1)


def setup_preview(name):
    scene=bpy.context.scene
    light(name)
    scene.cycles.samples=16
    scene.render.resolution_x=1400;scene.render.resolution_y=1100
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    cam=staged('preview camera',lambda:bpy.data.cameras.new('Camera'))
    cam.location=(-5.8,-10.5,9.5) if name!='kikoto' else (-7.0,-11.5,10.0)
    target=Vector((-.8 if name=='kikoto' else 0,1.1,.2))
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=15.4 if name=='kikoto' else 14.6
    scene.camera=cam
    staged('card camera',lambda:bpy.data.cameras.new('Card camera'))
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.shading.type='MATERIAL'


def mist(scene,look):
    """Distance fades into the sky colour, so a card has no hard horizon."""
    scene.view_layers[0].use_pass_mist=True
    scene.world.mist_settings.start,scene.world.mist_settings.depth=look['mist']
    scene.world.mist_settings.falloff='QUADRATIC'
    tree=bpy.data.node_groups.get('card mist') or bpy.data.node_groups.new('card mist','CompositorNodeTree')
    tree.nodes.clear()
    if not tree.interface.items_tree:
        tree.interface.new_socket('Image',in_out='OUTPUT',socket_type='NodeSocketColor')
    layers=tree.nodes.new('CompositorNodeRLayers')
    blend=tree.nodes.new('ShaderNodeMix');blend.data_type='RGBA'
    out=tree.nodes.new('NodeGroupOutput')
    tree.links.new(layers.outputs['Mist'],blend.inputs[0])
    tree.links.new(layers.outputs['Image'],blend.inputs[6])
    blend.inputs[7].default_value=look['fog']+(1,)
    tree.links.new(blend.outputs[2],out.inputs[0])
    scene.compositing_node_group=tree


def render_card(name):
    scene=bpy.context.scene
    light(name)
    look=LIGHT[name]
    cam=staged('card camera',lambda:bpy.data.cameras.new('Card camera'))
    where,target,lens=CARD[name]
    cam.location=where
    cam.rotation_euler=(Vector(target)-Vector(where)).to_track_quat('-Z','Y').to_euler()
    cam.data.type='PERSP';cam.data.lens=lens;cam.data.clip_end=200
    previous=scene.camera;scene.camera=cam
    mist(scene,look)
    scene.cycles.samples=int(os.environ.get('CARD_SAMPLES','64'))
    scene.render.resolution_x,scene.render.resolution_y=CARD_SIZE
    scene.render.image_settings.file_format='WEBP'
    scene.render.image_settings.quality=90
    scene.render.filepath=os.path.join(ART,name+'.webp')
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group=None
    scene.camera=previous
    print('CARD',name,flush=True)


def export(path, objects, animate=False, batch=False):
    bpy.ops.object.select_all(action='DESELECT')
    # Read the graph once, without adding objects while evaluating thousands of
    # stones. Aggregate world-space geometry directly, rather than copying every
    # object and repeatedly invoking join (which updates the entire scene).
    depsgraph=bpy.context.evaluated_depsgraph_get() if batch else None
    groups={}; keep=[]; generated=[]
    for ob in objects:
        if ob.type not in ['MESH','LIGHT','EMPTY']: continue
        if ob.type=='LIGHT' and ob.data.type!='POINT': continue
        ancestor=ob
        moving=False
        while ancestor:
            if ancestor.animation_data: moving=True
            ancestor=ancestor.parent
        if batch and ob.type=='MESH' and not moving:
            evaluated=ob.evaluated_get(depsgraph)
            mesh=evaluated.to_mesh()
            try:
                world=evaluated.matrix_world.copy()
                positions=[tuple(world @ vertex.co) for vertex in mesh.vertices]
                mirrored=world.to_3x3().determinant()<0
                # Far scenery goes in its own batches, which the stage keeps out
                # of the shadow pass (Battlefield.tsx reads the batch_far_ name).
                if positions:
                    cx=sum(p[0] for p in positions)/len(positions);cy=sum(p[1] for p in positions)/len(positions)
                    far=math.hypot(cx,cy)>SHADOW_REACH
                else: far=False
                # Object-linked material overrides must win over the mesh's slots.
                materials=[slot.material for slot in evaluated.material_slots]
                local_maps={}
                for polygon in mesh.polygons:
                    material=materials[polygon.material_index] if polygon.material_index<len(materials) else None
                    vertices,faces,smooth=groups.setdefault((material,far),([],[],[]))
                    remap=local_maps.setdefault((material,far),{})
                    face=[]
                    for index in polygon.vertices:
                        if index not in remap:
                            remap[index]=len(vertices)
                            vertices.append(positions[index])
                        face.append(remap[index])
                    # Applying a reflection to vertices reverses the winding.
                    if mirrored: face.reverse()
                    faces.append(face)
                    smooth.append(polygon.use_smooth)
            finally:
                evaluated.to_mesh_clear()
        elif not batch or ob.type in ['LIGHT'] or moving:
            keep.append(ob)
    try:
        for (material,far),(vertices,faces,smooth) in groups.items():
            name=('batch_far_' if far else 'batch_')+(material.name if material else 'unpainted')
            mesh=bpy.data.meshes.new(name)
            ob=bpy.data.objects.new(name,mesh)
            generated.append((ob,mesh))
            mesh.from_pydata(vertices,[],faces)
            if material: mesh.materials.append(material)
            mesh.polygons.foreach_set('use_smooth',smooth)
            mesh.update()
            CURRENT.objects.link(ob)
            keep.append(ob)
        # Animated rats retain their complete original hierarchy. Only the new
        # batches, moving objects and lamps are selected, never static sources.
        for ob in keep: ob.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,use_active_scene=True,
            export_animations=animate,export_animation_mode='SCENE',export_frame_range=True,
            export_force_sampling=True,export_lights=True,export_cameras=False,export_extras=True,
            # Battlefields are flat-shaded by three.js when normals are absent, and
            # without per-face normals every shared corner is one vertex, not six.
            export_normals=not batch,export_texcoords=not batch)
    finally:
        for ob,mesh in generated:
            bpy.data.objects.remove(ob,do_unlink=True)
            bpy.data.meshes.remove(mesh)
    print('EXPORTED',path,os.path.getsize(path),flush=True)


def guides(slots):
    """The playable spaces, for the preview only: the game draws real tile slabs."""
    global CURRENT
    held=CURRENT
    CURRENT=coll('Playable spaces — preview only')
    CURRENT.hide_render=True
    for x,y in slots:
        box('playable space',(x,y,.039),(.99,.99,.034),'stone_light')
        for dx,dy,w,h in [(0,-.485,.97,.018),(0,.485,.97,.018),(-.485,0,.018,.97),(.485,0,.018,.97)]:
            box('preview edge',(x+dx,y+dy,.058),(w,h,.004),'brass' if y<0 else 'wood_dark')
    CURRENT=held


def main():
    global CURRENT
    if '--cards-only' in sys.argv:
        # Re-light and re-render the card art from the saved scenes, without a rebuild.
        only=[a for a in sys.argv[sys.argv.index('--')+1:] if not a.startswith('--')] if '--' in sys.argv else []
        for name in only or ['sikator','feketepiac','kikoto']:
            bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,name+'.blend'))
            render_card(name)
        sys.exit(0)

    if '--export-existing' in sys.argv:
        for name in ['sikator','feketepiac','kikoto']:
            bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT,name+'.blend'))
            CURRENT=bpy.context.scene.collection.children[name+' assembled kit']
            bpy.context.scene.frame_set(1)
            bpy.context.view_layer.update()
            export(os.path.join(STAGE,'battlefields',name+'.glb'),list(CURRENT.objects),True,True)
        print('TOWN REEXPORTED',flush=True)
        sys.exit(0)

    build_kit()
    # Each item is a named Blender asset collection with its own local origin.
    for name,c in KIT.items():
        c.asset_mark()
        c.asset_data.description='Skart reusable town component: '+name
        export(os.path.join(OUT,'parts',name+'.glb'),list(c.objects))
    # Library has exploded display instances in its own scene; templates are unlinked.
    library_scene=bpy.context.scene
    library_scene.name='Town component library'
    CURRENT=coll('Component display')
    for i,name in enumerate(KIT):
        instance(name,name+' display',((i%7)*2,(i//7)*2,0))
    for c in KIT.values(): library_scene.collection.children.unlink(c)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'kit.blend'))

    # A dedicated card model, with exactly the same geometry as the small ambient rats.
    CURRENT=coll('Patkány export')
    instance('patkany','Patkány')
    export(os.path.join(STAGE,'models','patkany.glb'),list(CURRENT.objects))
    library_scene.collection.children.unlink(CURRENT)

    manifest={'components':list(KIT),'battlefields':{}}
    for name in ['sikator','feketepiac','kikoto']:
        scene=bpy.data.scenes.new(name)
        bpy.context.window.scene=scene
        CURRENT=coll(name+' assembled kit')
        scene_ground(name)
        setup_preview(name)
        bpy.context.view_layer.update()
        runtime_objects=list(CURRENT.objects)
        guides([(0,y) for y in [-1.98,-.86,.86,1.98]] if name=='sikator' else
               [(x,y) for x in [-1.12,0,1.12] for y in [-1.98,-.86,.86,1.98]])
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,name+'.blend'))
        export(os.path.join(STAGE,'battlefields',name+'.glb'),runtime_objects,True,True)
        manifest['battlefields'][name]={'source':name+'.blend','playable_slots':4 if name=='sikator' else 12}
        if RENDER:
            scene.render.filepath=os.path.join(OUT,'previews',name+'.png')
            bpy.ops.render.render(write_still=True)
            print('RENDERED',name,flush=True)
        if CARDS:
            render_card(name)
    with open(os.path.join(OUT,'manifest.json'),'w',encoding='utf-8') as f:
        json.dump(manifest,f,ensure_ascii=False,indent=2)
    print('TOWN COMPLETE',flush=True)


# blender/realms.py imports this file for its kit and pipeline without building the town.
if __name__=='__main__':
    main()
