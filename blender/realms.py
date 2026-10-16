"""The other realms: Umbra, Oppidium and Kesergő, built from town.py's pipeline.

blender -b --factory-startup -P blender/realms.py
blender -b --factory-startup -P blender/realms.py -- --render --cards
blender -b --factory-startup -P blender/realms.py -- --cards-only [umbra ...]

The town's kit, export, light and card camera are imported, not copied: a
realm is a scene built from town components (barrels, crates, woodpiles) and
its own (torch_blue, gold_tree, yurt...), exported the same way. Editable
sources: blender/realms/{kit,umbra,oppidium,kesergo}.blend. Runtime scenes:
stage/battlefields. Each is the ordinary 3 x 2 board per player; nothing above
the 0.06 tile top stands on it, nothing tall within half a tile of it.

Light is the point of all three (docs/art-bible.md §4): Umbra is a prison lit
by blue fire and green chains, Oppidium a forest of solid gold in pitch dark
that only its torches find, and Kesergő plain forest daylight on a camp.
"""
import bpy
import math
import os
import sys
import json
import random
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import town as T  # noqa: E402  (also resets the file and seeds the kit's random)
from town import mat, coll, mesh, primitive, frustum, box, rod, empty, begin, instance, MATS, KIT, PI  # noqa: E402

OUT = os.path.join(HERE, 'realms')
for folder in (OUT, os.path.join(OUT, 'parts'), os.path.join(OUT, 'previews')):
    os.makedirs(folder, exist_ok=True)
NAMES = ['umbra', 'oppidium', 'kesergo']
SLOTS = [(x, y) for x in [-1.12, 0, 1.12] for y in [-1.98, -.86, .86, 1.98]]
REALM_KIT = []  # the components this file adds; the town's own are only borrowed

for args in [
    # Umbra: drab, colourless stone ("seszínű kő"), blue fire, poison-green chains.
    ('u_stone', '#6b6a64'), ('u_stone_light', '#7c7a72'), ('u_stone_dark', '#55554f'),
    ('u_flag', '#605e58'), ('u_flag_light', '#6f6c65'), ('u_flag_dark', '#4c4b47'),
    ('u_rock', '#3a3b3f'), ('u_rock_top', '#2f3034'), ('void', '#2e2a26', 0, 0, 1),
    ('blue_fire', '#4f86ff', 3), ('blue_fire_core', '#8fb6ff', 3.5),
    ('chain_green', '#58c483', 1.6), ('rune_green', '#4fb87a', .9), ('ghost', '#a7c8c0', .7), ('ghost_eye', '#2e3436'),
    ('rag', '#d2cbb8'), ('rag_shadow', '#aca591'), ('mask', '#ddd6c2'), ('bone', '#bdb39c'),
    ('zombie_skin', '#7d896f'), ('zombie_rag', '#5b564c'), ('demon_skin', '#7a3d38'),
    ('demon_wing', '#4a2f33'), ('horn', '#b8ab90'), ('ember_eye', '#ff8a3c', 4),
    ('lich_robe', '#5c4f63'), ('lizard', '#6c7650'), ('portal', '#a59ad8', 2.2),
    ('portal_deep', '#5a5390', 1.0), ('slime', '#46523a', 0, 0, .15), ('straw', '#9a8a5e'),
    # Oppidium: everything is solid gold. Metalness stays low because the
    # stage has no environment map; the gold is its colour and its highlights.
    ('gold_deep', '#6e5524', 0, .3, .42), ('gold_dark', '#94722f', 0, .35, .36),
    ('gold', '#be9443', 0, .4, .32), ('gold_bright', '#d9b25c', 0, .4, .28),
    ('gold_pale', '#dfc67e', 0, .35, .28), ('gold_glint', '#ffd77a', 2.5),
    ('flame_core', '#ffe2a8', 5),
    # Kesergő: felt, forest and the Undan's red.
    ('felt', '#a39579'), ('felt_dark', '#877a64'), ('felt_light', '#b5a789'),
    ('tribal_red', '#9b4a3c'), ('tribal_dark', '#6e342c'), ('ochre', '#b0874a'),
    ('packed_earth', '#7a6c58'), ('forest_floor', '#4f553c'), ('litter', '#6b5e44'),
    ('fern', '#56713f'), ('leaf_green', '#4d6a3a'), ('leaf_deep', '#3c5230'),
    ('leaf_young', '#6a7f45'), ('pine_needle', '#3f5139'), ('birch_bark', '#b9b19d'),
    ('cliff', '#6d6a60'), ('cliff_dark', '#55524b'), ('pyrite', '#b89d55', 0, .55, .3),
    ('pyrite_dark', '#8c7840', 0, .55, .35), ('ember', '#ff8a3c', 2.5), ('ash', '#5d5853'),
    ('hide', '#9c7b5a'), ('hide_light', '#c2a988'), ('skull', '#d4c9ae'), ('mushroom', '#a86b4f'),
]:
    mat(*args)


# -- small helpers ---------------------------------------------------------------

def realm_part(name):
    begin(name)
    REALM_KIT.append(name)


def at(pos, turn, local, scale=1):
    """A point given in an instance's own frame, in the world."""
    c, s = math.cos(turn), math.sin(turn)
    x, y, z = (v*scale for v in local)
    return Vector((pos[0]+c*x-s*y, pos[1]+s*x+c*y, pos[2]+z))


def facing(dx, dy):
    """The turn that points a component's front (-Y) along (dx, dy)."""
    return math.atan2(dx, -dy)


def faces_of(ob, materials, pick):
    """Paint a mesh's faces from a list of palette names; pick(polygon) -> index."""
    for m in materials[1:]:
        ob.data.materials.append(MATS[m])
    for p in ob.data.polygons:
        p.material_index = pick(p)
    return ob


def chain(name, a, b, material, link=.05, sag=0.):
    """Alternating flat links, so a chain reads as a chain and not as a rod."""
    a, b = Vector(a), Vector(b)
    n = max(2, int((b-a).length/link))
    points = [a.lerp(b, i/n)-Vector((0, 0, sag*math.sin(PI*i/n))) for i in range(n+1)]
    for i in range(n):
        p, q = points[i], points[i+1]
        ob = box(name+' link', (p+q)/2, (.024 if i % 2 else .009, .009 if i % 2 else .024, (q-p).length*1.3), material)
        ob.rotation_euler = (q-p).to_track_quat('Z', 'Y').to_euler()


def adopt(name, pos, turn, before):
    """Parent everything made since `before` under one placed root."""
    root = empty(name, pos)
    root.rotation_euler.z = turn
    for ob in list(T.CURRENT.objects):
        if ob not in before and ob.parent is None and ob is not root:
            ob.parent = root
    return root


def slab(name, x0, x1, y0, y1, z0, z1, side, top):
    """A box with a separately coloured top and no bottom: rock, plinths, cliffs."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh(name, v, f, top)
    return faces_of(ob, [top, side], lambda p: 0 if p.index == 0 else 1)


def scatter(count, rmin, rmax, ok, spacing, centre=(0, 0)):
    pts = []
    for _ in range(count*60):
        if len(pts) >= count:
            break
        a = random.uniform(0, 2*PI)
        r = math.sqrt(random.uniform(rmin*rmin, rmax*rmax))
        x, y = centre[0]+math.cos(a)*r, centre[1]+math.sin(a)*r
        if not ok(x, y) or any((x-px)**2+(y-py)**2 < spacing*spacing for px, py in pts):
            continue
        pts.append((x, y))
    return pts


def arena_distance(x, y, hx=1.7, hy=2.55):
    """How far a point is from the playable rectangle (zero on it)."""
    return math.hypot(max(0, abs(x)-hx), max(0, abs(y)-hy))


RINGS = [.7, 1.4, 2.1, 2.8, 3.4, 4.0, 4.5, 5.0, 5.6, 6.2, 6.9, 7.6, 8.4, 9.3, 10.3, 11.4, 12.6, 14, 15.6, 17.5,
         19.7, 22.2, 25, 28.5, 32.5, 37, 42, 48, 55, 62]


def terrain(name, height, materials, paint, sides=96):
    """A faceted disc of ground: flat under the board (but still faceted, so it has
    no edge), whatever `height` says beyond.
    `paint(x, y)` picks each face's palette entry by its centre."""
    verts = [(math.cos(i*2*PI/sides)*RINGS[0], math.sin(i*2*PI/sides)*RINGS[0], -.02) for i in range(sides)]
    for j, r in enumerate(RINGS[1:], 1):
        for i in range(sides):
            a = (i+(j % 2)*.5)*2*PI/sides
            rr = r+random.uniform(-.06, .06)*r/4
            x, y = math.cos(a)*rr, math.sin(a)*rr
            verts.append((x, y, height(x, y)))
    faces = [tuple(range(sides))]
    for j in range(len(RINGS)-1):
        for i in range(sides):
            a = j*sides+i
            b = j*sides+(i+1) % sides
            faces += [(a, a+sides, b+sides), (a, b+sides, b)]
    ob = mesh(name, verts, faces, materials[0])
    return faces_of(ob, materials, lambda p: materials.index(paint(p.center.x, p.center.y)) if p.index else 0)


def patches(materials, count, rmin, rmax, ok, size=(.3, .9), z=-.012):
    """Rubbed-in ground colour: flat stains that never cast a shadow."""
    for x, y in scatter(count, rmin, rmax, ok, .2):
        r = random.uniform(*size)
        verts = [(x+math.cos(j*PI/4)*r*random.uniform(.7, 1.3), y+math.sin(j*PI/4)*r*random.uniform(.5, .8), z) for j in range(8)]
        stain = mesh('ground stain', verts, [tuple(range(8))], random.choice(materials))
        stain.visible_shadow = False


def boulder(name, pos, size, materials, turn=None, sub=1):
    m = random.choice(materials)
    ob = primitive(name, 'ico', pos, size, m,
                   (random.uniform(-.3, .3), random.uniform(-.3, .3), turn if turn is not None else random.uniform(0, PI)))
    if sub > 1:
        ob.data = boulder_mesh(sub, m)
    return ob


_BOULDERS = {}


def boulder_mesh(sub, material):
    """A rounder rock, shared between every big boulder of a material."""
    import bmesh
    key = (sub, material)
    if key not in _BOULDERS:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1)
        for v in bm.verts:
            v.co *= 1+noise.noise(v.co*1.7)*.18
        me = bpy.data.meshes.new('rough boulder')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(MATS[material])
        _BOULDERS[key] = me
    return _BOULDERS[key]


def top_of(x, y):
    """The highest surface at a point, for planting on rock that was piled up at random."""
    bpy.context.view_layer.update()
    hit, where, *_ = bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(), (x, y, 20), (0, 0, -1))
    return where.z if hit else 0.


# -- the kit -------------------------------------------------------------------

def build_umbra_kit():
    realm_part('torch_blue')
    box('sconce plate', (0, .03, 0), (.09, .04, .17), 'iron')
    box('sconce cup', (0, -.1, .1), (.075, .075, .045), 'iron')
    rod('sconce arm', (0, .02, -.04), (0, -.1, .08), .012, 'iron', 4)
    rod('torch shaft', (0, -.1, .02), (0, -.13, .2), .022, 'wood_dark', 5)
    primitive('pitch wrap', 'cyl', (0, -.13, .2), (.032, .032, .05), 'zombie_rag', sides=6)
    primitive('blue flame', 'cone', (0, -.135, .3), (.055, .055, .17), 'blue_fire', sides=5)
    primitive('flame core', 'cone', (0, -.135, .27), (.028, .028, .09), 'blue_fire_core', sides=4)
    light = bpy.data.lights.new('blue fire', 'POINT')
    light.energy = 7
    light.color = (.25, .48, 1)
    light.shadow_soft_size = .2
    ob = bpy.data.objects.new('blue fire', light)
    T.CURRENT.objects.link(ob)
    ob.location = (0, -.2, .3)

    realm_part('cell_bars')
    for i in range(11):
        x = -.65+i*.13
        rod('cell bar', (x, 0, 0), (x+random.uniform(-.01, .01), 0, 1.24), .014, 'iron', 5)
    for z in [.08, .62, 1.18]:
        box('bar band', (0, 0, z), (1.36, .035, .04), 'iron')
    box('lock plate', (.33, -.03, .62), (.09, .03, .12), 'iron')
    primitive('keyhole', 'cyl', (.33, -.047, .64), (.012, .012, .006), 'ghost_eye', (PI/2, 0, 0), 5)
    for z in [.2, 1.05]:
        primitive('hinge pin', 'cyl', (-.66, -.02, z), (.02, .02, .09), 'iron', sides=5)

    realm_part('zombie')
    rod('rotting leg', (-.05, .01, 0), (-.055, .02, .25), .03, 'zombie_rag', 5)
    rod('rotting leg', (.05, -.01, 0), (.065, .01, .25), .03, 'zombie_rag', 5)
    for x in [-.05, .06]:
        box('bare foot', (x, -.03, .015), (.05, .09, .03), 'zombie_skin')
    primitive('hunched torso', 'ico', (0, -.02, .35), (.11, .08, .14), 'zombie_rag', (.35, 0, 0))
    mesh('torn shirt tail', [(-.1, -.05, .25), (.1, -.06, .25), (.07, -.07, .17), (.02, -.06, .21), (-.04, -.07, .16)],
         [(0, 4, 3, 2, 1)], 'zombie_rag')
    primitive('pallid neck', 'cyl', (0, -.08, .46), (.03, .03, .06), 'zombie_skin', (.6, 0, 0), 5)
    primitive('sunken head', 'ico', (0, -.12, .51), (.07, .075, .08), 'zombie_skin')
    primitive('lank hair', 'ico', (0, -.1, .56), (.065, .065, .04), 'zombie_rag')
    for x in [-.026, .026]:
        box('hollow eye', (x, -.188, .52), (.022, .01, .017), 'ghost_eye')
    box('moaning mouth', (0, -.192, .475), (.034, .01, .02), 'ghost_eye')
    for x, hand in [(-.09, (-.07, -.37, .43)), (.09, (.06, -.35, .37))]:
        rod('reaching arm', (x, -.04, .41), hand, .022, 'zombie_skin', 5)
        primitive('clawing hand', 'ico', hand, (.032, .036, .02), 'zombie_skin')
        for k in [-1, 0, 1]:
            rod('clawing finger', hand, (hand[0]+k*.018, hand[1]-.05, hand[2]-.01), .006, 'zombie_skin', 4)

    realm_part('ghost')
    frustum('ghostly robe', (0, 0, .13), .17, .075, .37, 'ghost', 7)
    hem = []
    for i in range(14):
        a = i*2*PI/14
        r = .17 if i % 2 == 0 else .15
        hem.append((math.cos(a)*r, math.sin(a)*r, .13 if i % 2 == 0 else .03+random.uniform(0, .04)))
    for i in range(0, 14, 2):
        mesh('tattered hem', [hem[i], hem[(i+1) % 14], hem[(i+2) % 14]], [(0, 1, 2)], 'ghost')
    primitive('ghostly head', 'ico', (0, 0, .6), (.085, .08, .09), 'ghost')
    for x in [-.032, .032]:
        box('empty eye', (x, -.075, .62), (.026, .012, .032), 'ghost_eye')
    primitive('wailing mouth', 'ico', (0, -.075, .565), (.018, .01, .026), 'ghost_eye')
    for x in [-1, 1]:
        rod('drooping arm', (x*.07, 0, .46), (x*.15, -.07, .3), .022, 'ghost', 5)
        primitive('green shackle', 'cyl', (x*.15, -.07, .3), (.03, .03, .03), 'chain_green', sides=6)

    realm_part('treasure_heap')
    for x, y, s in [(0, 0, .3), (.2, .1, .18), (-.22, .05, .2), (.05, -.2, .16), (-.08, .2, .17)]:
        primitive('heap of coins', 'ico', (x, y, 0), (s, s, s*.5), random.choice(['gold', 'gold_bright']))
    for i in range(16):
        a = random.uniform(0, 2*PI)
        r = random.uniform(.25, .45)
        primitive('loose coin', 'cyl', (math.cos(a)*r, math.sin(a)*r, .006), (.03, .03, .008), 'gold_bright',
                  (random.uniform(-.2, .2), random.uniform(-.2, .2), 0), 7)
    box('chest body', (.3, .22, .09), (.24, .16, .16), 'wood')
    box('chest lid', (.3, .32, .24), (.24, .03, .17), 'wood', (-.5, 0, 0))
    for x in [.2, .4]:
        box('chest gilding', (x, .22, .09), (.025, .17, .17), 'gold')
    primitive('chest gold', 'ico', (.3, .22, .18), (.1, .07, .04), 'gold_bright')
    frustum('goblet foot', (-.3, -.16, 0), .035, .01, .07, 'gold', 6)
    frustum('goblet cup', (-.3, -.16, .07), .015, .04, .06, 'gold_bright', 6)
    primitive('crown jewel', 'ico', (-.12, -.25, .04), (.03, .03, .03), 'magic')

    for kind in ['lich', 'lizard_lich']:
        realm_part(kind)
        frustum('kingly robe', (0, .02, .02), .17, .085, .32, 'lich_robe' if kind == 'lich' else 'lizard', 8)
        box('robe front', (0, -.12, .15), (.16, .06, .28), 'lich_robe', (.25, 0, 0))
        box('ermine mantle', (0, 0, .33), (.26, .17, .06), 'rag_shadow')
        head = 'bone' if kind == 'lich' else 'lizard'
        primitive('crowned head', 'ico', (0, -.01, .43), (.07, .075, .08), head)
        if kind == 'lizard_lich':
            frustum('lizard snout', (0, -.05, .41), .045, .025, .1, 'lizard', 6).rotation_euler.x = -1.45
            for i in range(5):
                rod('lizard tail', (0, .1+i*.07, .05-i*.01), (math.sin(i)*.05, .17+i*.07, .04-i*.008), .03-i*.005, 'lizard', 5)
        else:
            box('bare jaw', (0, -.06, .385), (.07, .04, .03), 'bone')
        for x in [-.026, .026]:
            box('green eye', (x, -.075, .44), (.018, .012, .016), 'chain_green')
        for i in range(6):
            a = i*PI/3
            primitive('crown point', 'cone', (math.cos(a)*.055, -.01+math.sin(a)*.055, .51), (.018, .018, .05), 'gold_bright', sides=4)
        primitive('crown band', 'cyl', (0, -.01, .49), (.064, .064, .025), 'gold', sides=8)
        for x in [-1, 1]:
            rod('bony arm', (x*.1, 0, .32), (x*.13, -.12, .2), .018, 'bone' if kind == 'lich' else 'lizard', 5)
            primitive('bony hand', 'ico', (x*.13, -.13, .19), (.025, .025, .018), 'bone' if kind == 'lich' else 'lizard')
        rod('sceptre', (.13, -.13, .1), (.17, -.15, .55), .012, 'gold', 5)
        primitive('sceptre gem', 'ico', (.17, -.15, .58), (.028, .028, .035), 'magic')

    realm_part('ghost_horse')
    primitive('spectral barrel', 'ico', (0, 0, .4), (.1, .22, .11), 'ghost')
    rod('spectral neck', (0, -.15, .44), (0, -.25, .62), .05, 'ghost', 6)
    box('spectral head', (0, -.31, .62), (.07, .16, .08), 'ghost', (-.5, 0, 0))
    for x in [-.03, .03]:
        primitive('pricked ear', 'cone', (x, -.25, .7), (.015, .015, .05), 'ghost', sides=4)
        box('empty eye', (x*1.4, -.34, .65), (.012, .02, .016), 'ghost_eye')
    for x, y in [(-.06, -.15), (.06, -.15), (-.06, .15), (.06, .15)]:
        rod('spectral leg', (x, y, .35), (x*1.1, y+random.uniform(-.02, .02), 0), .02, 'ghost', 5)
    for i in range(4):
        mesh('ragged mane', [(0, -.16-i*.03, .5+i*.04), (0, -.19-i*.03, .53+i*.04), (.04, -.18-i*.03, .43+i*.04)], [(0, 1, 2)], 'ghost')
    mesh('wispy tail', [(0, .2, .45), (.02, .24, .45), (.05, .32, .15), (-.03, .3, .2)], [(0, 1, 2, 3)], 'ghost')

    realm_part('demon')
    for x in [-1, 1]:
        rod('goat thigh', (x*.05, 0, .32), (x*.06, -.05, .17), .03, 'demon_skin', 5)
        rod('goat shank', (x*.06, -.05, .17), (x*.06, .02, .03), .022, 'demon_skin', 5)
        box('cloven hoof', (x*.06, -.005, .015), (.04, .06, .03), 'ghost_eye')
    primitive('demon chest', 'ico', (0, 0, .44), (.12, .09, .14), 'demon_skin')
    box('loincloth', (0, -.02, .3), (.15, .12, .08), 'ghost_eye')
    primitive('demon head', 'ico', (0, -.02, .63), (.075, .07, .08), 'demon_skin')
    for x in [-1, 1]:
        a = (x*.045, -.01, .69)
        b = (x*.09, .0, .76)
        c = (x*.075, .04, .82)
        rod('curled horn', a, b, .016, 'horn', 5)
        rod('curled horn tip', b, c, .009, 'horn', 4)
        box('burning eye', (x*.027, -.088, .645), (.02, .01, .014), 'ember_eye')
        rod('gripping arm', (x*.1, 0, .52), (x*.12, -.14, .66), .025, 'demon_skin', 5)
        primitive('gripping hand', 'ico', (x*.12, -.15, .67), (.03, .028, .03), 'demon_skin')
        shoulder = Vector((x*.06, .07, .55))
        tips = [Vector((x*.36, .16, .82)), Vector((x*.42, .18, .58)), Vector((x*.32, .16, .38)), Vector((x*.16, .12, .36))]
        for i in range(len(tips)-1):
            mesh('bat wing membrane', [shoulder, tips[i], tips[i+1]], [(0, 1, 2)], 'demon_wing')
        for tip in tips[:3]:
            rod('wing bone', shoulder, tip, .009, 'ghost_eye', 4)
    for i in range(4):
        rod('tail', (0, .06+i*.06, .3-i*.06), (.03*math.sin(i), .12+i*.06, .24-i*.06), .014, 'demon_skin', 4)
    mesh('spade tail', [(.02, .3, .07), (-.04, .34, .03), (.06, .36, .02)], [(0, 1, 2)], 'demon_skin')

    realm_part('white_shepherd')
    frustum('ragged robe', (0, 0, 0), .21, .12, .78, 'rag', 9)
    for i in range(18):
        a = i*2*PI/18+random.uniform(-.1, .1)
        z = random.choice([.12, .3, .5])
        r = .2-z*.1
        w = random.uniform(.05, .08)
        p = (math.cos(a)*(r+.015), math.sin(a)*(r+.015))
        t = (-math.sin(a), math.cos(a))
        mesh('hanging rag', [(p[0]-t[0]*w, p[1]-t[1]*w, z+.16), (p[0]+t[0]*w, p[1]+t[1]*w, z+.16),
                             (p[0]+t[0]*w*.4, p[1]+t[1]*w*.4, z-random.uniform(.04, .1))], [(0, 1, 2)],
             random.choice(['rag', 'rag_shadow']))
    mesh('trailing cloak', [(-.17, .06, .86), (.17, .06, .86), (.24, .2, .02), (.05, .24, .06), (-.12, .23, .0), (-.25, .18, .05)],
         [(0, 5, 4, 3, 2, 1)], 'rag_shadow')
    primitive('rag shoulders', 'ico', (0, 0, .82), (.18, .12, .085), 'rag')
    primitive('deep hood', 'ico', (0, .01, 1.0), (.105, .1, .125), 'rag_shadow')
    primitive('hood peak', 'cone', (0, .04, 1.12), (.05, .05, .1), 'rag_shadow', (-.4, 0, 0), 5)
    primitive('white mask', 'ico', (0, -.075, .99), (.068, .032, .088), 'mask')
    for x in [-.026, .026]:
        box('mask eye', (x, -.105, 1.01), (.022, .008, .012), 'ghost_eye')
    box('mask crack', (.012, -.106, .955), (.004, .006, .05), 'rag_shadow', (0, .3, 0))
    rod('hanging arm', (-.15, 0, .8), (-.2, -.03, .5), .03, 'rag', 5)
    rod('outstretched arm', (.14, -.02, .8), (.17, -.3, .85), .032, 'rag', 5)
    primitive('clenched fist', 'ico', (.17, -.33, .85), (.035, .035, .035), 'mask')

    realm_part('pendulum')
    rod('pendulum string', (0, 0, 0), (0, 0, -.3), .004, 'iron', 4)
    primitive('pendulum bob', 'ico', (0, 0, -.33), (.028, .028, .045), 'brass')

    realm_part('scythe')
    rod('scythe snath', (0, 0, 0), (.02, 0, .8), .016, 'wood_dark', 5)
    rod('scythe snath', (.02, 0, .8), (0, 0, 1.4), .016, 'wood_dark', 5)
    for z in [.55, 1.0]:
        rod('scythe grip', (0, 0, z), (0, -.1, z+.02), .012, 'wood_dark', 4)
    arc = [(math.cos(a)*.42-.4, 0, 1.36+math.sin(a)*.12) for a in [i*PI/7 for i in range(8)]]
    inner = [(x*.9-.02, 0, z-.04*math.sin(i*PI/7)) for i, (x, _, z) in enumerate(arc)]
    for i in range(7):
        mesh('scythe blade', [arc[i], arc[i+1], inner[i+1], inner[i]], [(0, 1, 2, 3)], 'steel')

    realm_part('portal_gate')
    for x in [-.62, .62]:
        for i in range(5):
            w = .26 if i % 2 else .2
            box('portal quoin', (x+(0 if x < 0 else 0), 0, .14+i*.27), (w, .2, .25), random.choice(['u_stone_light', 'u_stone']))
    box('portal lintel', (0, 0, 1.47), (1.5, .22, .22), 'u_stone_light')
    box('keystone', (0, -.02, 1.47), (.22, .26, .3), 'u_stone')
    pts = [(math.cos(a)*.5, 0, .7+math.sin(a)*.66) for a in [k*2*PI/16 for k in range(16)]]
    mesh('portal depth', pts, [tuple(range(16))], 'portal_deep')
    # Three arms winding in to a bright eye: a vortex, not a target.
    for arm in range(3):
        prev = None
        for i in range(13):
            t = i/12
            a = arm*2*PI/3+t*3.6
            p = Vector((math.cos(a)*(.06+.4*t), -.015-.01*(1-t), .7+math.sin(a)*(.08+.53*t)))
            if prev:
                d = p-prev
                box('portal swirl', (p+prev)/2, (d.length*1.15, .006, .02+.05*t), 'portal', (0, -math.atan2(d.z, d.x), 0))
            prev = p
    primitive('portal eye', 'ico', (0, -.03, .7), (.06, .02, .08), 'blue_fire_core')
    box('portal step', (0, -.1, .02), (1.3, .4, .04), 'u_stone_dark')

    realm_part('key_ring')
    rod('wall hook', (0, .03, .5), (0, -.08, .52), .012, 'iron', 4)
    ring = [(math.cos(a)*.11, -.08, .41+math.sin(a)*.11) for a in [i*2*PI/12 for i in range(12)]]
    for i in range(12):
        rod('key ring', ring[i], ring[(i+1) % 12], .008, 'iron', 4)
    for i in range(15):
        a = PI+.2+i*(PI-.4)/14
        top = Vector((math.cos(a)*.11, -.08, .41+math.sin(a)*.11))
        swing_ = random.uniform(-.25, .25)
        tip = top+Vector((math.sin(swing_)*.13, random.uniform(-.02, .02), -math.cos(swing_)*.13))
        m = random.choice(['iron', 'iron', 'brass'])
        rod('hanging key', top, tip, .006, m, 4)
        box('key bit', tip+Vector((.012, 0, .01)), (.025, .006, .02), m)
    rod('coiled whip handle', (.18, -.05, .12), (.2, -.06, .38), .018, 'wood_dark', 5)
    for i in range(10):
        a = i*PI/4
        b = (i+1)*PI/4
        r1 = .05+i*.006
        r2 = .05+(i+1)*.006
        rod('whip lash', (.2+math.cos(a)*r1, -.06, .2+math.sin(a)*r1*1.8), (.2+math.cos(b)*r2, -.06, .2+math.sin(b)*r2*1.8),
            .007, 'wood_dark', 4)

    realm_part('wall_shackles')
    for x in [-.25, .25]:
        primitive('wall ring', 'cyl', (x, -.02, .95), (.035, .035, .015), 'iron', (PI/2, 0, 0), 6)
        chain('wall chain', (x, -.04, .93), (x*.8, -.12, .45), 'iron', .045)
        primitive('open cuff', 'cyl', (x*.8, -.12, .42), (.04, .04, .03), 'iron', sides=6)

    realm_part('skull')
    primitive('cranium', 'ico', (0, 0, .055), (.05, .055, .045), 'bone')
    box('jaw', (0, -.035, .022), (.05, .04, .025), 'bone')
    for x in [-.019, .019]:
        box('socket', (x, -.05, .058), (.018, .01, .016), 'ghost_eye')

    realm_part('straw_bed')
    for x, y, s in [(0, 0, .22), (.18, .08, .15), (-.15, .1, .13)]:
        primitive('matted straw', 'ico', (x, y, 0), (s, s*.8, .05), 'straw')
    for i in range(10):
        a = random.uniform(0, PI)
        box('loose straw', (random.uniform(-.3, .3), random.uniform(-.2, .25), .01), (.12, .008, .006), 'straw', (0, 0, a))

    realm_part('bucket')
    frustum('slop bucket', (0, 0, 0), .07, .085, .15, 'wood', 8)
    primitive('bucket hoop', 'cyl', (0, 0, .1), (.083, .083, .012), 'iron', sides=8)
    rod('bucket handle', (-.08, 0, .15), (0, 0, .23), .006, 'iron', 4)
    rod('bucket handle', (0, 0, .23), (.08, 0, .15), .006, 'iron', 4)

    realm_part('pillar')
    box('pillar plinth', (0, 0, .1), (.72, .72, .2), 'u_stone_dark')
    box('pillar base', (0, 0, .26), (.6, .6, .12), 'u_stone')
    frustum('pillar shaft', (0, 0, .3), .27, .23, 1.4, 'u_stone_light', 8)
    for z in [.62, 1.02, 1.42]:
        frustum('shaft course', (0, 0, z-.012), .266-z*.03, .262-z*.03, .024, 'u_stone_dark', 8)
    box('pillar capital', (0, 0, 1.77), (.58, .58, .14), 'u_stone')
    box('pillar abacus', (0, 0, 1.9), (.7, .7, .12), 'u_stone_dark')


def build_oppidium_kit():
    gilt = ['gold', 'gold_bright', 'gold_pale', 'gold', 'gold_dark']
    realm_part('gold_oak')
    rod('gilded trunk', (0, 0, -.05), (.05, .02, .8), .075, 'gold_dark', 6)
    for a, b in [((.03, .01, .5), (-.32, .06, .95)), ((.05, .02, .65), (.34, -.05, 1.05)), ((.04, .02, .78), (.04, .22, 1.18))]:
        rod('gilded bough', a, b, .032, 'gold_dark', 5)
    for x, y, z, s in [(.05, 0, 1.15, .4), (-.32, .06, 1.0, .3), (.34, -.05, 1.08, .3), (.04, .24, 1.25, .26),
                       (-.12, -.2, 1.22, .24), (.2, .18, 1.36, .22)]:
        primitive('golden leaves', 'ico', (x, y, z), (s, s, s*.8), random.choice(gilt))
    realm_part('gold_pine')
    rod('gilded trunk', (0, 0, -.05), (0, 0, .5), .07, 'gold_dark', 5)
    for z, r, h in [(.38, .5, .62), (.75, .4, .55), (1.08, .3, .48), (1.36, .18, .38)]:
        primitive('golden needles', 'cone', (0, 0, z+h/2), (r, r, h), random.choice(['gold_dark', 'gold', 'gold_deep']), sides=6)
    realm_part('gold_birch')
    rod('gilded trunk', (0, 0, -.05), (-.04, .02, 1.25), .045, 'gold_pale', 5)
    for z in [.3, .55, .8, 1.0]:
        box('bark mark', (-.01, -.042, z), (.05, .01, .02), 'gold_deep', (0, .2, 0))
    for x, y, z, s in [(-.04, 0, 1.3, .22), (.12, .05, 1.08, .17), (-.18, -.04, 1.0, .16), (-.04, .1, 1.5, .15)]:
        primitive('golden leaves', 'ico', (x, y, z), (s*.8, s*.8, s*1.2), random.choice(gilt))
    realm_part('gold_bush')
    for x, y, s in [(0, 0, .2), (.16, .05, .14), (-.14, .07, .13), (.03, -.12, .12)]:
        primitive('golden shrub', 'ico', (x, y, s*.7), (s, s, s*.8), random.choice(gilt))
    realm_part('gold_tuft')
    for i in range(4):
        a = i*1.7
        primitive('golden blade', 'cone', (math.cos(a)*.03, math.sin(a)*.03, .06), (.025, .025, .13+.03*(i % 2)),
                  random.choice(['gold_bright', 'gold']), (random.uniform(-.3, .3), random.uniform(-.3, .3), 0), 4)

    realm_part('gold_deer')
    primitive('golden flank', 'ico', (0, 0, .42), (.09, .2, .1), 'gold')
    rod('golden neck', (0, -.14, .45), (0, -.22, .62), .045, 'gold', 6)
    primitive('golden head', 'ico', (0, -.27, .64), (.045, .08, .05), 'gold')
    for x in [-1, 1]:
        primitive('golden ear', 'cone', (x*.05, -.23, .69), (.02, .012, .05), 'gold', (0, x*.9, 0), 4)
        rod('antler', (x*.025, -.24, .68), (x*.1, -.2, .86), .01, 'gold_bright', 4)
        rod('antler tine', (x*.06, -.22, .77), (x*.04, -.3, .86), .008, 'gold_bright', 4)
        rod('antler tine', (x*.09, -.21, .83), (x*.16, -.17, .9), .008, 'gold_bright', 4)
    box('golden eye', (.042, -.29, .655), (.006, .014, .012), 'gold_pale')
    for x, y in [(-.05, -.14), (.05, -.14), (-.05, .15), (.05, .15)]:
        rod('slender leg', (x, y, .38), (x, y+random.uniform(-.02, .02), 0), .016, 'gold', 5)
    primitive('white tail', 'cone', (0, .2, .46), (.025, .025, .06), 'gold_pale', (-1.0, 0, 0), 4)

    realm_part('gold_fox')
    primitive('golden body', 'ico', (0, 0, .14), (.055, .13, .055), 'gold_bright')
    primitive('golden head', 'ico', (0, -.14, .19), (.045, .05, .04), 'gold_bright')
    primitive('golden snout', 'cone', (0, -.2, .18), (.022, .022, .07), 'gold_bright', (PI/2, 0, 0), 4)
    for x in [-1, 1]:
        primitive('pointed ear', 'cone', (x*.025, -.14, .245), (.017, .012, .04), 'gold_bright', sides=4)
    for x, y in [(-.03, -.08), (.03, -.08), (-.03, .08), (.03, .08)]:
        rod('fox leg', (x, y, .12), (x, y, 0), .011, 'gold', 4)
    rod('brush tail', (0, .12, .14), (0, .27, .1), .04, 'gold', 6)
    primitive('tail tip', 'ico', (0, .29, .1), (.03, .035, .03), 'gold_pale')

    realm_part('gold_boar')
    primitive('golden bristles', 'ico', (0, 0, .2), (.11, .19, .11), 'gold_dark')
    frustum('golden snout', (0, -.17, .18), .07, .04, .12, 'gold_dark', 6).rotation_euler.x = PI/2
    primitive('snout disc', 'cyl', (0, -.3, .18), (.042, .042, .01), 'gold', (PI/2, 0, 0), 6)
    for x in [-1, 1]:
        primitive('tusk', 'cone', (x*.04, -.27, .15), (.01, .01, .06), 'gold_pale', (-.6, 0, 0), 4)
        primitive('boar ear', 'cone', (x*.05, -.12, .29), (.025, .015, .045), 'gold_dark', (0, x*.5, 0), 4)
    for x, y in [(-.06, -.1), (.06, -.1), (-.06, .11), (.06, .11)]:
        rod('stubby leg', (x, y, .14), (x, y, 0), .022, 'gold_dark', 5)
    for i in range(5):
        box('bristle ridge', (0, -.1+i*.05, .3), (.02, .04, .03), 'gold_deep')

    realm_part('gold_bird')
    primitive('golden breast', 'ico', (0, 0, .05), (.035, .05, .035), 'gold_bright')
    primitive('golden head', 'ico', (0, -.045, .085), (.023, .023, .023), 'gold_bright')
    primitive('beak', 'cone', (0, -.07, .085), (.008, .008, .025), 'gold_pale', (PI/2, 0, 0), 4)
    box('tail feathers', (0, .06, .06), (.03, .05, .006), 'gold', (.4, 0, 0))
    for x in [-.012, .012]:
        rod('bird leg', (x, 0, .02), (x, 0, 0), .003, 'gold_dark', 4)

    realm_part('gold_outcrop')
    for x, y, z, s in [(0, 0, .14, (.32, .28, .24)), (.22, .1, .08, (.2, .18, .15)), (-.2, .12, .08, (.18, .2, .14)),
                       (.08, -.2, .05, (.16, .14, .1)), (-.12, -.14, .06, (.14, .15, .12))]:
        primitive('gilded crag', 'ico', (x, y, z), s, random.choice(['gold_dark', 'gold_deep', 'gold']),
                  (random.uniform(-.2, .2), random.uniform(-.2, .2), random.uniform(0, PI)))
    box('worn seat', (0, 0, .33), (.34, .3, .06), 'gold_dark', (0, 0, .2))

    # Seated cross-legged, hands in the lap. Heads are separate so they can turn.
    for kind in ['statue_lady', 'statue_man']:
        realm_part(kind)
        for x in [-1, 1]:
            rod('crossed leg', (x*.11, -.06, .04), (-x*.04, -.1, .05), .045, 'gold', 6)
            primitive('knee', 'ico', (x*.12, -.06, .05), (.05, .05, .045), 'gold')
        if kind == 'statue_lady':
            frustum('spread gown', (0, 0, 0), .2, .12, .1, 'gold', 9)
            frustum('golden bodice', (0, 0, .1), .085, .07, .2, 'gold_bright', 8)
            box('lace collar', (0, -.02, .29), (.14, .1, .025), 'gold_pale')
        else:
            frustum('golden doublet', (0, 0, .04), .1, .085, .25, 'gold_bright', 8)
            box('sword belt', (0, -.005, .12), (.19, .17, .03), 'gold_dark')
            mesh('short cape', [(-.1, .06, .29), (.1, .06, .29), (.13, .12, .05), (-.13, .12, .05)], [(0, 3, 2, 1)], 'gold_dark')
            box('rapier', (.14, .05, .08), (.012, .32, .012), 'gold_pale', (.3, 0, .3))
        primitive('shoulders', 'ico', (0, 0, .29), (.11, .07, .045), 'gold_bright')
        for x in [-1, 1]:
            rod('resting arm', (x*.1, 0, .28), (x*.09, -.07, .14), .022, 'gold_bright', 5)
            primitive('folded hand', 'ico', (x*.04, -.09, .13), (.025, .025, .02), 'gold_pale')
        primitive('neck', 'cyl', (0, 0, .33), (.025, .025, .04), 'gold_bright', sides=6)

    realm_part('statue_lady_head')
    primitive('golden face', 'ico', (0, 0, .065), (.052, .056, .062), 'gold_pale')
    primitive('coiled hair', 'ico', (0, .01, .09), (.056, .056, .05), 'gold')
    primitive('hair bun', 'ico', (0, .045, .125), (.032, .032, .03), 'gold')
    for x in [-.02, .02]:
        box('closed eye', (x, -.052, .07), (.016, .004, .004), 'gold_deep')
    primitive('nose', 'cone', (0, -.058, .055), (.008, .008, .016), 'gold_pale', (PI/2, 0, 0), 4)

    realm_part('statue_man_head')
    primitive('golden face', 'ico', (0, 0, .065), (.05, .054, .062), 'gold_pale')
    for x in [-.02, .02]:
        box('closed eye', (x, -.05, .07), (.016, .004, .004), 'gold_deep')
    box('moustache', (0, -.052, .045), (.04, .008, .008), 'gold', (0, 0, 0))
    primitive('hat brim', 'cyl', (0, 0, .115), (.09, .09, .01), 'gold_dark', (.08, 0, 0), 9)
    frustum('hat crown', (0, 0, .115), .052, .045, .05, 'gold_dark', 8)
    mesh('plume', [(.04, .02, .16), (.05, .04, .17), (.12, .1, .2), (.13, .11, .16)], [(0, 1, 2, 3)], 'gold_pale')

    realm_part('gold_torch')
    rod('golden stake', (0, 0, -.05), (.01, 0, .62), .02, 'gold_dark', 5)
    frustum('pitch wrap', (.01, 0, .6), .03, .042, .08, 'gold_deep', 6)
    primitive('torch flame', 'cone', (.01, 0, .76), (.05, .05, .17), 'lamp_glass', sides=5)
    primitive('flame core', 'cone', (.01, 0, .72), (.026, .026, .09), 'flame_core', sides=4)
    light = bpy.data.lights.new('torch fire', 'POINT')
    light.energy = 7
    light.color = (1, .58, .22)
    light.shadow_soft_size = .15
    ob = bpy.data.objects.new('torch fire', light)
    T.CURRENT.objects.link(ob)
    ob.location = (.01, 0, .78)

    realm_part('mine_entrance')
    box('mine dark', (0, .8, .55), (1.3, 1.5, 1.1), 'void')
    for y in [-.05, .45, .95]:
        for x in [-.58, .58]:
            box('golden prop', (x, y, .53), (.11, .11, 1.06), 'gold_dark', (0, x*.03, 0))
        box('golden cap', (0, y, 1.11), (1.42, .14, .12), 'gold', (0, .02, 0))
        for x in [-1, 1]:
            rod('corner brace', (x*.58, y, .86), (x*.36, y, 1.06), .028, 'gold_dark', 4)
    for i in range(6):
        box('roof lagging', (-.5+i*.2, .45, 1.2), (.17, 1.2, .04), random.choice(['gold_dark', 'gold']))
    box('name board', (0, -.13, 1.28), (.6, .04, .16), 'gold_bright', (0, .03, 0))
    rod('lantern hook', (.66, -.05, .85), (.66, -.2, .85), .01, 'gold_dark', 4)
    primitive('mine lantern', 'cyl', (.66, -.2, .74), (.045, .045, .1), 'lamp_glass', sides=6)
    for z in [.68, .8]:
        primitive('lantern cap', 'cone', (.66, -.2, z), (.065, .065, .045), 'gold_dark', sides=6)
    light = bpy.data.lights.new('mine lantern', 'POINT')
    light.energy = 7
    light.color = (1, .62, .28)
    ob = bpy.data.objects.new('mine lantern', light)
    T.CURRENT.objects.link(ob)
    ob.location = (.66, -.27, .72)

    realm_part('rail_track')
    for i in range(5):
        box('golden sleeper', (0, -.4+i*.2, .012), (.5, .08, .024), random.choice(['gold_dark', 'gold_deep']))
    for x in [-.17, .17]:
        box('golden rail', (x, 0, .038), (.03, 1.0, .03), 'gold_pale')

    realm_part('minecart')
    mesh('cart tub', [(-.2, -.26, .1), (.2, -.26, .1), (.2, .26, .1), (-.2, .26, .1),
                      (-.25, -.31, .36), (.25, -.31, .36), (.25, .31, .36), (-.25, .31, .36)],
         [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'gold')
    for z in [.2, .35]:
        box('cart band', (0, -.3, z), (.5, .02, .03), 'gold_dark')
        box('cart band', (0, .3, z), (.5, .02, .03), 'gold_dark')
    for x in [-.2, .2]:
        for y in [-.17, .17]:
            primitive('cart wheel', 'cyl', (x*1.05, y, .08), (.075, .075, .03), 'gold_deep', (0, PI/2, 0), 8)
    for i in range(9):
        primitive('gold ore', 'ico', (random.uniform(-.17, .17), random.uniform(-.22, .22), .36+random.uniform(0, .07)),
                  (.06, .06, .05), random.choice(['gold_bright', 'gold_pale', 'gold']))

    realm_part('ore_pile')
    for i in range(12):
        a = random.uniform(0, 2*PI)
        r = random.uniform(0, .25)
        s = random.uniform(.05, .1)
        primitive('gold nugget', 'ico', (math.cos(a)*r, math.sin(a)*r, s*.5+(.25-r)*.4), (s, s, s*.8),
                  random.choice(['gold_bright', 'gold_pale', 'gold']))

    realm_part('pickaxe')
    rod('pick haft', (0, 0, 0), (0, .05, .5), .014, 'gold_dark', 5)
    rod('pick head', (-.15, .04, .48), (0, .05, .52), .016, 'gold_pale', 4)
    rod('pick head', (0, .05, .52), (.15, .04, .48), .016, 'gold_pale', 4)

    realm_part('coin_pile')
    for i in range(7):
        x, y = random.uniform(-.2, .2), random.uniform(-.15, .15)
        for k in range(random.randint(2, 8)):
            primitive('Kien coin', 'cyl', (x+random.uniform(-.006, .006), y+random.uniform(-.006, .006), .006+k*.013),
                      (.042, .042, .012), random.choice(['gold_bright', 'gold_pale']), sides=8)
    for i in range(14):
        a = random.uniform(0, 2*PI)
        r = random.uniform(.22, .45)
        primitive('spilled Kien', 'cyl', (math.cos(a)*r, math.sin(a)*r, .006), (.042, .042, .012), 'gold_bright',
                  (random.uniform(-.15, .15), random.uniform(-.15, .15), 0), 8)
    primitive('coin sack', 'ico', (.25, .2, .15), (.13, .11, .16), 'gold')
    primitive('sack neck', 'cyl', (.25, .2, .3), (.035, .035, .05), 'gold_dark', sides=6)

    realm_part('key_niche')
    box('niche back', (0, .22, .32), (.7, .16, .64), 'gold')
    box('niche base', (0, -.05, .1), (.7, .4, .2), 'gold_dark')
    box('niche lid', (0, -.05, .55), (.7, .4, .18), 'gold_dark')
    for x in [-.27, .27]:
        box('niche side', (x, -.05, .32), (.16, .4, .3), 'gold')
    box('emptied niche', (0, .1, .32), (.38, .1, .28), 'void')

    realm_part('gold_glint')
    for r in [(0, 0, 0), (0, 0, PI/2), (PI/2, 0, PI/4)]:
        box('glint', (0, 0, 0), (.05, .006, .006), 'gold_glint', r)

    realm_part('mine_winch')
    for x in [-.25, .25]:
        box('winch post', (x, 0, .25), (.07, .07, .5), 'gold_dark')
    primitive('winch drum', 'cyl', (0, 0, .42), (.09, .09, .44), 'gold', (0, PI/2, 0), 8)
    rod('winch crank', (.29, 0, .42), (.36, 0, .32), .012, 'gold_pale', 4)
    for i in range(5):
        primitive('rope turn', 'cyl', (-.15+i*.075, 0, .42), (.095, .095, .02), 'gold_pale', (0, PI/2, 0), 8)


def build_kesergo_kit():
    for kind, felt, roof in [('yurt', 'felt', 'felt_dark'), ('yurt_old', 'felt_dark', 'felt')]:
        realm_part(kind)
        frustum('felt wall', (0, 0, 0), .86, .84, .53, felt, 14)
        zig = []
        for i in range(28):
            a0 = i*2*PI/28
            a1 = (i+1)*2*PI/28
            am = (a0+a1)/2
            r = .865
            mesh('painted zigzag', [(math.cos(a0)*r, math.sin(a0)*r, .22), (math.cos(a1)*r, math.sin(a1)*r, .22),
                                    (math.cos(am)*r, math.sin(am)*r, .34)], [(0, 1, 2)], 'tribal_red')
        frustum('painted band', (0, 0, .19), .866, .866, .03, 'tribal_dark', 14)
        for z in [.08, .46]:
            frustum('girth rope', (0, 0, z), .87, .87, .018, 'rope', 14)
        # The roof: every seventh panel painted, so the red reads from above.
        sides = 28
        verts = [(math.cos(i*2*PI/sides)*.93, math.sin(i*2*PI/sides)*.93, .5) for i in range(sides)]
        verts += [(math.cos(i*2*PI/sides)*.16, math.sin(i*2*PI/sides)*.16, 1.02) for i in range(sides)]
        roof_ob = mesh('felt roof', verts, [(i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides)], roof)
        faces_of(roof_ob, [roof, 'tribal_red'], lambda p: 1 if p.index % 7 == 0 else 0)
        frustum('painted crown band', (0, 0, .935), .3, .245, .05, 'tribal_red', 14)
        frustum('roof crown', (0, 0, 1.0), .17, .15, .06, 'wood_dark', 10)
        primitive('smoke hole', 'cyl', (0, 0, 1.055), (.14, .14, .01), 'void', sides=10)
        box('door frame', (0, -.86, .25), (.42, .06, .5), 'wood_dark')
        box('painted door', (0, -.885, .23), (.32, .03, .42), 'wood')
        for z in [.12, .3]:
            box('door diamond', (0, -.903, z), (.08, .01, .08), 'tribal_red', (0, PI/4, 0))
        for x in [-.11, .11]:
            box('door diamond', (x, -.903, .21), (.05, .01, .05), 'ochre', (0, PI/4, 0))
        box('door step', (0, -.95, .02), (.4, .14, .04), 'wood_light')
        for a in [PI/4, 3*PI/4, 5*PI/4, 7*PI/4]:
            rod('guy rope', (math.cos(a)*.9, math.sin(a)*.9, .5), (math.cos(a)*1.25, math.sin(a)*1.25, 0), .007, 'rope', 4)
            primitive('tent peg', 'cone', (math.cos(a)*1.25, math.sin(a)*1.25, .03), (.02, .02, .07), 'wood_dark', sides=4)
        if kind == 'yurt_old':
            for i in range(5):
                a = random.uniform(.6, 2*PI-.6)
                box('felt patch', (math.cos(a)*.868, math.sin(a)*.868, random.uniform(.06, .45)), (.18, .012, .13),
                    random.choice(['felt_light', 'hide']), (0, 0, a+PI/2))

    realm_part('campfire')
    for i in range(10):
        a = i*2*PI/10
        primitive('hearth stone', 'ico', (math.cos(a)*.27, math.sin(a)*.27, .03), (.07, .06, .05),
                  random.choice(['cliff', 'cliff_dark', 'stone']), (0, 0, a))
    primitive('ash bed', 'cyl', (0, 0, .004), (.24, .24, .008), 'ash', sides=10)
    for a in [0, 2.1, 4.2]:
        rod('burning log', (math.cos(a)*.22, math.sin(a)*.22, .03), (math.cos(a)*.02, math.sin(a)*.02, .1), .035, 'wood_dark', 6)
    for i in range(6):
        primitive('ember', 'ico', (random.uniform(-.12, .12), random.uniform(-.12, .12), .02), (.022, .022, .015), 'ember')
    light = bpy.data.lights.new('campfire', 'POINT')
    light.energy = 7
    light.color = (1, .55, .2)
    ob = bpy.data.objects.new('campfire', light)
    T.CURRENT.objects.link(ob)
    ob.location = (0, 0, .3)

    realm_part('fire_flames')
    for x, y, s in [(0, 0, 1), (.06, .04, .7), (-.06, .03, .65), (.01, -.06, .6)]:
        primitive('flame tongue', 'cone', (x, y, .15*s), (.08*s, .08*s, .3*s), 'lamp_glass', (0, 0, x*9), 5)
    primitive('flame heart', 'cone', (0, 0, .09), (.045, .045, .16), 'flame_core', sides=4)

    realm_part('fox_totem')
    for x, y in [(-.1, -.06), (.1, -.05), (0, .11), (-.08, .09), (.09, .08)]:
        primitive('base stone', 'ico', (x, y, .03), (.07, .06, .05), random.choice(['cliff', 'cliff_dark']))
    rod('totem pole', (0, 0, 0), (0, 0, 1.25), .05, 'wood_dark', 6)
    for z, m in [(.3, 'tribal_red'), (.42, 'ochre'), (.6, 'tribal_red'), (.88, 'tribal_red'), (1.0, 'ochre')]:
        frustum('painted ring', (0, 0, z), .054, .054, .05, m, 6)
    for z in [.48, .74]:
        box('carved eye', (0, -.05, z), (.06, .012, .025), 'tribal_dark')
    rod('crossbar', (-.22, 0, 1.05), (.22, 0, 1.08), .018, 'wood', 5)
    for x in [-.2, -.1, .1, .2]:
        rod('hanging cord', (x, 0, 1.06), (x+random.uniform(-.02, .02), -.01, .82), .004, 'linen', 4)
        box('feather', (x, -.01, .78), (.02, .006, .08), random.choice(['hide_light', 'tribal_red', 'ash']))
        primitive('bead', 'ico', (x, -.01, .88), (.012, .012, .012), random.choice(['ochre', 'tribal_red']))
    # The fox skull, facing out over the pyrite.
    primitive('fox cranium', 'ico', (0, .01, 1.31), (.06, .07, .05), 'skull')
    frustum('fox muzzle', (0, -.04, 1.29), .035, .016, .11, 'skull', 6).rotation_euler.x = -1.5
    for x in [-.026, .026]:
        box('eye socket', (x, -.05, 1.32), (.022, .02, .018), 'void')
        primitive('ear ridge', 'cone', (x*1.4, .03, 1.36), (.015, .012, .03), 'skull', sides=4)
    box('nasal hole', (0, -.15, 1.3), (.012, .01, .01), 'void')
    for x in [-.012, .012]:
        primitive('fang', 'cone', (x, -.13, 1.275), (.005, .005, .016), 'skull', (PI, 0, 0), 4)

    realm_part('totem')
    for i, (r, m) in enumerate([(.11, 'wood'), (.1, 'wood_light'), (.1, 'wood'), (.09, 'wood_light')]):
        z = i*.3
        frustum('carved drum', (0, 0, z), r, r*.94, .28, m, 7)
        frustum('painted rim', (0, 0, z+.26), r*.97, r*.97, .03, 'tribal_red', 7)
        for x in [-.04, .04]:
            box('painted eye', (x, -r*.95, z+.18), (.035, .012, .025), 'tribal_dark' if i % 2 else 'ochre')
        primitive('carved beak' if i % 2 else 'carved nose', 'cone', (0, -r-.03, z+.11), (.025, .025, .07),
                  'tribal_red' if i % 2 else 'wood_dark', (PI/2, 0, 0), 4)
    for x in [-1, 1]:
        mesh('totem wing', [(x*.08, 0, 1.12), (x*.36, .02, 1.22), (x*.32, .02, 1.08), (x*.08, 0, 1.0)], [(0, 1, 2, 3)],
             'tribal_red')
    primitive('totem crest', 'cone', (0, 0, 1.25), (.07, .07, .14), 'ochre', sides=6)

    realm_part('pyrite')
    for i in range(6):
        s = random.uniform(.05, .11)
        box('pyrite cube', (random.uniform(-.05, .05), random.uniform(-.05, .05), s*.45+random.uniform(0, .03)), (s, s, s),
            random.choice(['pyrite', 'pyrite', 'pyrite_dark']),
            (random.uniform(-.5, .5), random.uniform(-.5, .5), random.uniform(0, PI)))

    realm_part('log_bench')
    for x in [-.35, .35]:
        frustum('stump leg', (x, 0, 0), .08, .07, .16, 'bark', 7)
    rod('split log seat', (-.5, 0, .2), (.5, 0, .2), .075, 'bark', 7)
    box('worn seat face', (0, 0, .265), (.98, .1, .02), 'wood_light')

    realm_part('drying_rack')
    for x in [-.45, .45]:
        rod('forked post', (x, 0, 0), (x, 0, .78), .025, 'wood_dark', 5)
        rod('fork', (x, 0, .7), (x+.05, 0, .82), .015, 'wood_dark', 4)
    rod('cross pole', (-.5, 0, .79), (.5, 0, .8), .02, 'wood', 5)
    for x, m, h in [(-.22, 'hide', .42), (.18, 'hide_light', .36)]:
        mesh('stretched hide', [(x-.17, 0, .78), (x+.17, 0, .78), (x+.2, .01, .78-h*.6), (x+.1, .01, .78-h),
                                (x-.12, .01, .78-h*.95), (x-.19, .01, .78-h*.5)], [(0, 5, 4, 3, 2, 1)], m)
        for k in range(3):
            primitive('painted dot', 'cyl', (x-.07+k*.07, -.006, .78-h*.45), (.018, .018, .004), 'tribal_red', (PI/2, 0, 0), 6)
    for x in [-.42, .42]:
        rod('herb bundle', (x*.8, 0, .78), (x*.8, -.01, .6), .025, 'fern', 5)

    realm_part('tripod_pot')
    for a in [0, 2.1, 4.2]:
        rod('tripod leg', (math.cos(a)*.32, math.sin(a)*.32, 0), (0, 0, .78), .016, 'wood_dark', 4)
    rod('pot chain', (0, 0, .76), (0, 0, .46), .005, 'iron', 4)
    frustum('cooking pot', (0, 0, .28), .1, .13, .17, 'iron', 9)
    primitive('stew', 'cyl', (0, 0, .44), (.12, .12, .01), 'hide', sides=9)

    realm_part('drum')
    frustum('drum body', (0, 0, 0), .16, .19, .26, 'wood', 10)
    primitive('drum skin', 'cyl', (0, 0, .265), (.19, .19, .012), 'hide_light', sides=10)
    for i in range(10):
        a0 = i*2*PI/10
        a1 = (i+1)*2*PI/10
        mesh('drum zigzag', [(math.cos(a0)*.181, math.sin(a0)*.181, .2), (math.cos(a1)*.181, math.sin(a1)*.181, .2),
                             (math.cos((a0+a1)/2)*.17, math.sin((a0+a1)/2)*.17, .08)], [(0, 1, 2)], 'tribal_red')
    rod('drum stick', (.12, -.18, .28), (-.05, -.24, .3), .008, 'wood_light', 4)

    realm_part('basket')
    frustum('woven basket', (0, 0, 0), .11, .14, .16, 'ochre', 9)
    frustum('basket rim', (0, 0, .15), .145, .145, .025, 'wood_dark', 9)
    for i in range(4):
        primitive('gathered root', 'ico', (random.uniform(-.06, .06), random.uniform(-.06, .06), .17), (.04, .03, .03), 'mushroom')

    realm_part('spear_rack')
    for x in [-.35, .35]:
        rod('rack leg', (x, -.1, 0), (x, .02, .55), .02, 'wood_dark', 4)
        rod('rack leg', (x, .14, 0), (x, .02, .55), .02, 'wood_dark', 4)
    rod('rack bar', (-.38, .02, .5), (.38, .02, .5), .015, 'wood', 4)
    for x in [-.22, -.05, .14, .27]:
        rod('spear', (x, .14, 0), (x+.02, -.06, 1.0), .012, 'wood_light', 4)
        primitive('flint head', 'cone', (x+.022, -.075, 1.06), (.022, .01, .08), 'cliff_dark', (-.2, 0, 0), 4)
        box('red binding', (x+.019, -.05, .97), (.03, .03, .03), 'tribal_red')

    realm_part('banner_pole')
    rod('banner pole', (0, 0, 0), (0, 0, 1.45), .022, 'wood_dark', 5)
    rod('banner arm', (0, 0, 1.38), (.3, 0, 1.38), .012, 'wood_dark', 4)
    mesh('red banner', [(.02, 0, 1.37), (.29, 0, 1.37), (.27, .02, .82), (.15, .03, .74), (.04, .02, .84)],
         [(0, 4, 3, 2, 1)], 'tribal_red')
    for z in [1.2, 1.0]:
        mesh('banner triangle', [(.08, -.004, z+.1), (.22, -.004, z+.1), (.15, -.004, z-.02)], [(0, 1, 2)], 'ochre')
    for i in range(3):
        box('pole feather', (.0, -.025, 1.3-i*.07), (.015, .005, .07), 'hide_light', (0, .4, 0))

    realm_part('forest_pine')
    rod('pine trunk', (0, 0, -.05), (0, 0, .8), .08, 'bark', 6)
    for z, r, h in [(.45, .55, .7), (.85, .46, .62), (1.22, .36, .55), (1.55, .26, .48), (1.85, .15, .38)]:
        primitive('needled tier', 'cone', (0, 0, z+h/2), (r, r, h), random.choice(['pine_needle', 'leaf_deep', 'pine_needle']), sides=7)
    realm_part('forest_oak')
    rod('oak trunk', (0, 0, -.05), (.06, .03, .85), .09, 'bark', 6)
    for a, b in [((.04, .02, .55), (-.38, .06, 1.05)), ((.06, .02, .7), (.38, -.08, 1.12))]:
        rod('oak bough', a, b, .04, 'bark', 5)
    for x, y, z, s in [(.06, 0, 1.25, .48), (-.4, .08, 1.08, .34), (.4, -.08, 1.15, .36), (.0, .3, 1.32, .3),
                       (-.15, -.28, 1.3, .3), (.22, .2, 1.5, .28), (-.2, .1, 1.55, .26)]:
        primitive('oak leaves', 'ico', (x, y, z), (s, s, s*.8), random.choice(['leaf_green', 'leaf_deep', 'leaf_young', 'leaf_green']))
    realm_part('forest_birch')
    rod('birch trunk', (0, 0, -.05), (-.03, .02, 1.45), .05, 'birch_bark', 5)
    for z in [.25, .5, .72, .95, 1.2]:
        box('birch mark', (-.01, -.045, z), (.055, .012, .02), 'ghost_eye', (0, random.uniform(-.3, .3), 0))
    for x, y, z, s in [(-.03, 0, 1.5, .26), (.14, .05, 1.25, .2), (-.18, -.04, 1.18, .18), (-.02, .1, 1.72, .17)]:
        primitive('birch leaves', 'ico', (x, y, z), (s*.8, s*.8, s*1.2), random.choice(['leaf_young', 'leaf_green']))
    realm_part('fern')
    for i in range(7):
        a = i*2*PI/7+random.uniform(-.2, .2)
        l = random.uniform(.18, .28)
        tip = (math.cos(a)*l, math.sin(a)*l, random.uniform(.06, .12))
        side = (-math.sin(a)*.04, math.cos(a)*.04)
        mid = (math.cos(a)*l*.5, math.sin(a)*l*.5, .13)
        mesh('fern frond', [(0, 0, .02), (mid[0]+side[0], mid[1]+side[1], mid[2]), tip, (mid[0]-side[0], mid[1]-side[1], mid[2])],
             [(0, 1, 2, 3)], random.choice(['fern', 'fern', 'leaf_young']))
    realm_part('bush')
    for x, y, s in [(0, 0, .22), (.17, .05, .16), (-.15, .08, .15), (.04, -.14, .13)]:
        primitive('undergrowth', 'ico', (x, y, s*.7), (s, s, s*.8), random.choice(['leaf_deep', 'leaf_green', 'fern']))
    realm_part('fallen_log')
    rod('fallen trunk', (-.7, 0, .09), (.7, .05, .1), .1, 'bark', 7)
    for x in [-.7, .7]:
        primitive('cut end', 'cyl', (x, x*.035, .095), (.095, .095, .01), 'wood_light', (0, PI/2, 0), 7)
    for x in [-.3, .25]:
        primitive('moss on log', 'ico', (x, .02, .17), (.14, .07, .05), 'moss')
    rod('broken branch', (.1, .02, .15), (.22, -.2, .32), .02, 'bark', 4)
    realm_part('stump')
    frustum('old stump', (0, 0, 0), .16, .13, .2, 'bark', 7)
    primitive('stump rings', 'cyl', (0, 0, .2), (.125, .125, .01), 'wood_light', sides=7)
    primitive('stump moss', 'ico', (.1, .05, .08), (.07, .06, .06), 'moss')
    realm_part('mushrooms')
    for x, y, s in [(0, 0, 1), (.06, .04, .7), (-.05, .05, .6)]:
        primitive('pale stem', 'cyl', (x, y, .03*s), (.012*s, .012*s, .06*s), 'linen', sides=5)
        primitive('brown cap', 'cone', (x, y, .07*s), (.04*s, .04*s, .035*s), 'mushroom', sides=6)


# -- Umbra: a crossroads hall of the prison, cells down every corridor -----------

H = 1.75     # wall height; low enough that the lowest camera still clears it
CW = 1.1     # half a corridor's width
ROOM = (4.6, 6.4)


def masonry(a, b, normal, z0=0., z1=H, depth=.09, mats=('u_stone', 'u_stone', 'u_stone_light', 'u_stone_dark')):
    """Coursed blocks proud of a rock face: the face itself shows as mortar."""
    a = Vector((a[0], a[1], 0))
    b = Vector((b[0], b[1], 0))
    d = b-a
    length = d.length
    if length < .05:
        return
    d /= length
    n = Vector((normal[0], normal[1], 0))
    turn = math.atan2(d.y, d.x)
    z = z0
    row = 0
    while z < z1-.04:
        h = min(random.uniform(.21, .29), z1-z)
        t = -random.uniform(0, .3) if row % 2 else 0
        while t < length-.02:
            w = random.uniform(.3, .62)
            lo, hi = max(t, 0), min(t+w, length)
            if hi-lo > .06:
                c = a+d*((lo+hi)/2)+n*(depth/2-.03)
                box('worn wall block', (c.x, c.y, z+h/2), (hi-lo-.035, depth*random.uniform(.85, 1.15), h-.035),
                    random.choice(mats), (random.uniform(-.02, .02), 0, turn+random.uniform(-.015, .015)))
            t += w
        z += h
        row += 1


def flagstones(x0, x1, y0, y1, step=.48, mats=('u_flag', 'u_flag', 'u_flag_light', 'u_flag_dark')):
    """Big worn slabs in running courses, chamfered, never quite level."""
    y = y0
    while y < y1-.05:
        h = min(step*random.uniform(.8, 1.15), y1-y)
        x = x0-random.uniform(0, step*.6)
        while x < x1-.05:
            w = step*random.uniform(.8, 1.6)
            lo, hi = max(x, x0), min(x+w, x1)
            if hi-lo > .1:
                cx, cy = (lo+hi)/2, y+h/2
                hw, hh = (hi-lo)/2-.02, h/2-.02
                c = .035
                outline = [(-hw+c, -hh), (hw-c, -hh), (hw, -hh+c), (hw, hh-c), (hw-c, hh), (-hw+c, hh), (-hw, hh-c), (-hw, -hh+c)]
                top = .012+random.uniform(-.006, .006)
                verts = [(cx+dx, cy+dy, z) for z in [-.02, top] for dx, dy in outline]
                mesh('worn flagstone', verts, [tuple(range(8, 16))]+[(i, (i+1) % 8, (i+1) % 8+8, i+8) for i in range(8)],
                     random.choice(mats))
            x += w
        y += h


def rock(open_rects, bound=46):
    """Solid rock everywhere the hall, corridors and cells are not: the open
    rectangles are cut out by compressing coordinates and merging the rest."""
    xs = sorted({-bound, bound, *[min(max(v, -bound), bound) for r in open_rects for v in (r[0], r[1])]})
    ys = sorted({-bound, bound, *[min(max(v, -bound), bound) for r in open_rects for v in (r[2], r[3])]})

    def solid(i, j):
        cx, cy = (xs[i]+xs[i+1])/2, (ys[j]+ys[j+1])/2
        return not any(r[0] < cx < r[1] and r[2] < cy < r[3] for r in open_rects)
    runs = {}
    for j in range(len(ys)-1):
        i = 0
        while i < len(xs)-1:
            if solid(i, j):
                k = i
                while k+1 < len(xs)-1 and solid(k+1, j):
                    k += 1
                runs.setdefault((i, k), []).append(j)
                i = k+1
            else:
                i += 1
    for (i, k), rows in runs.items():
        start = rows[0]
        for a, b in zip(rows, rows[1:]+[None]):
            if b != a+1:
                slab('living rock', xs[i], xs[k+1], ys[start], ys[a+1], -.05, H, 'u_rock', 'u_rock_top')
                start = b


def corridor_rects(pos, turn, length=40):
    """The corridor and its cells as world rectangles, for `rock`."""
    rects = [(-CW, CW, 0, length)]
    for k, s in [(k, s) for k in range(9) for s in [-1, 1]]:
        c0 = .6+k*2.05
        depth = 3.6 if k < 6 else 1.32
        rects.append((min(s*CW, s*depth), max(s*CW, s*depth), c0, c0+1.7))
    out = []
    for x0, x1, y0, y1 in rects:
        corners = [at(pos, turn, (x, y, 0)) for x in (x0, x1) for y in (y0, y1)]
        # Rounded, or float32 leaves a sliver of rock between 6.4 and 6.4000001.
        out.append(tuple(round(v, 3) for v in (min(p.x for p in corners), max(p.x for p in corners),
                                               min(p.y for p in corners), max(p.y for p in corners))))
    return out


OCCUPANTS = ['zombie', 'zombie', 'zombie', 'ghost', 'ghost', 'demon', 'demon', 'lich', 'empty']


def corridor(name, pos, turn, specials):
    """Built in its own frame, mouth at the origin, running away along +Y."""
    before = set(T.CURRENT.objects)
    flagstones(-CW, CW, 0, 22)
    masonry((-CW, 18.7), (-CW, 24), (1, 0))
    masonry((CW, 24), (CW, 18.7), (-1, 0))
    for k in range(9):
        c0 = .6+k*2.05
        real = k < 6
        prev = .6+(k-1)*2.05+1.7 if k else 0
        for s in [-1, 1]:
            # The pillar of wall before this cell, and the lintel over its bars.
            masonry((s*CW, prev), (s*CW, c0), (-s, 0))
            box('bar lintel', (s*(CW+.25), c0+.85, (1.3+H)/2), (.5, 1.72, H-1.3), 'u_stone_dark')
            masonry((s*CW, c0), (s*CW, c0+1.7), (-s, 0), 1.3, H)
            depth = 3.6 if real else 1.32
            instance('cell_bars', 'cell bars', (s*(1.35 if real else 1.2), c0+.85, 0), -s*PI/2)
            box('cell floor', (s*(CW+depth)/2, c0+.85, -.02), (depth-CW, 1.7, .03), 'u_flag_dark')
            if not real:
                box('dark beyond the bars', (s*(depth-.02), c0+.85, H/2), (.04, 1.7, H), 'void')
                continue
            who = specials.get((k, s)) or random.choice(OCCUPANTS)
            face = -s*PI/2
            cy = c0+.85
            if random.random() < .7:
                instance('straw_bed', 'straw bed', (s*3.05, cy+random.uniform(-.4, .4), 0), random.uniform(0, PI))
            if random.random() < .5:
                instance('bucket', 'slop bucket', (s*3.3, c0+.3, 0), random.uniform(0, PI), .9)
            if random.random() < .5:
                instance('wall_shackles', 'cell shackles', (s*3.58, cy, 0), facing(-s, 0))
            if random.random() < .25:
                instance('skull', 'old skull', (s*2.6, c0+1.4, 0), face+random.uniform(-.8, .8), .9)
            if who == 'zombie':
                for j in range(random.randint(1, 3)):
                    instance('zombie', 'begging undead', (s*(1.62+j*.12), cy+(j-1)*.42+random.uniform(-.06, .06), 0),
                             face+random.uniform(-.25, .25), random.uniform(.9, 1.05))
            elif who == 'ghost':
                g = Vector((s*2.5, cy, .06))
                instance('ghost', 'chained ghost', g, face, 1.15)
                for wx in [-1, 1]:
                    wrist = at(g, face, (wx*.15, -.07, .3), 1.15)
                    floor = at(g, face, (wx*.42, .25, 0), 1.15)
                    primitive('floor ring', 'cyl', floor, (.04, .04, .012), 'iron', sides=6)
                    chain('poison-green chain', floor, wrist, 'chain_green', .05)
            elif who == 'demon':
                instance('demon', 'caged demon', (s*1.58, cy+random.uniform(-.3, .3), 0), face, 1.05)
            elif who in ['lich', 'lizard_lich', 'lich_horse']:
                instance('treasure_heap', 'hoarded treasure', (s*2.95, cy, 0), face+random.uniform(-.3, .3), 1.2)
                instance('lizard_lich' if who == 'lizard_lich' else 'lich', 'imprisoned king', (s*2.95, cy, .2), face, 1.15)
                for i in range(6):
                    primitive('loose coin', 'cyl', (s*random.uniform(1.8, 2.5), cy+random.uniform(-.7, .7), .005),
                              (.03, .03, .008), 'gold_bright', sides=7)
                if who == 'lich_horse':
                    instance('ghost_horse', 'spectral steed', (s*2.1, cy+.35, 0), face+s*.6, 1.1)
    # Blue fire on every other pillar, and farther down, into the dark.
    for k in range(10):
        y = .6+k*2.05-.175 if k < 9 else 21.0
        s = 1 if k % 2 else -1
        instance('torch_blue', 'corridor torch', (s*(CW-.07), y, 1.05), facing(-s, 0))
    for i, y in enumerate([25, 29.5, 34]):
        s = 1 if i % 2 else -1
        instance('torch_blue', 'far corridor torch', (s*(CW-.02), y, 1.05), facing(-s, 0))
    return adopt('corridor '+name, pos, turn, before)


def umbra():
    rx, ry = ROOM
    flagstones(-rx, rx, -ry, ry, .52)
    box('prison floor', (0, 0, -.045), (92, 92, .04), 'u_flag_dark')
    corridors = [('north', (0, ry, 0), 0), ('south', (0, -ry, 0), PI), ('east', (rx, 0, 0), -PI/2), ('west', (-rx, 0, 0), PI/2)]
    specials = {
        'north': {(1, 1): 'lich_horse', (0, -1): 'ghost', (2, -1): 'demon'},
        'east': {(0, -1): 'lizard_lich', (1, 1): 'ghost'},
        'west': {(0, 1): 'demon', (2, 1): 'lich', (1, -1): 'ghost'},
        'south': {},
    }
    opens = [(-rx, rx, -ry, ry)]
    for name, pos, turn in corridors:
        opens += corridor_rects(pos, turn)
        corridor(name, pos, turn, specials[name])
    rock(opens)
    # The hall's own walls, around the four mouths.
    for y, n in [(ry, -1), (-ry, 1)]:
        masonry((-rx, y), (-CW, y), (0, n))
        masonry((CW, y), (rx, y), (0, n))
    for x, n in [(rx, -1), (-rx, 1)]:
        masonry((x, -ry), (x, -CW), (n, 0))
        masonry((x, CW), (x, ry), (n, 0))
    for x, y in [(-3.1, -3.9), (3.1, -3.9), (-3.1, 3.9), (3.1, 3.9)]:
        instance('pillar', 'hall pillar', (x, y, 0), random.uniform(-.05, .05))
        d = Vector((-x, -y, 0)).normalized()
        instance('torch_blue', 'pillar torch', (x+d.x*.27, y+d.y*.27, 1.12), facing(d.x, d.y))
    # Blue fire either side of each corridor mouth.
    for name, pos, turn in corridors:
        for side in [-1, 1]:
            p = at(pos, turn, (side*1.55, -.07, 1.12))
            instance('torch_blue', 'mouth torch', p, turn)
    # The White Shepherd on his slab in the north-west corner, timing the gate.
    slab('shepherd slab', -4.55, -3.05, 4.95, 6.35, -.02, .26, 'u_stone_dark', 'u_stone_light')
    sx, sy = -3.85, 5.6
    turn = facing(.9, -1)
    instance('white_shepherd', 'Fehér Pásztor', (sx, sy, .26), turn, 1.05)
    instance('torch_blue', 'shepherd torch', (-rx+.08, 4.45, 1.15), facing(1, 0))
    pend = instance('pendulum', 'shepherd pendulum', at((sx, sy, .26), turn, (.17, -.33, .82), 1.05), turn)
    pend.rotation_euler.y = .28  # caught at the top of its swing
    scythe = instance('scythe', 'leaning scythe', (-3.25, 6.1, .26), PI*.95)
    scythe.rotation_euler.x = .12
    # The gate the Whisperers came through, still open in the north wall.
    instance('portal_gate', 'world gate', (2.85, ry-.12, 0), 0)
    # The jailer's keys and whip, the stinking barrels, the rest of a prison.
    instance('key_ring', "jailer's keys", (rx-.08, 2.45, .55), facing(-1, 0))
    for x, y, t in [(3.95, -5.6, .2), (4.15, -5.05, 1.1), (3.45, -5.85, 2.0)]:
        instance('barrel', 'stinking barrel', (x, y, 0), t, .95)
    puddle = [(3.4+math.cos(i*PI/4)*.55*random.uniform(.7, 1.2), -5.25+math.sin(i*PI/4)*.3*random.uniform(.7, 1.2), .02) for i in range(8)]
    mesh('foul seep', puddle, [tuple(range(8))], 'slime')
    for x, y, t in [(-3.95, -5.7, .1), (-3.5, -5.85, .5)]:
        instance('crate', 'prison stores', (x, y, 0), t)
    instance('crate', 'prison stores', (-3.8, -5.75, .38), .3, .8)
    instance('bucket', 'water bucket', (-4.15, -5.15, 0), 0)
    for x, y, t in [(-rx+.08, 2.4, facing(1, 0)), (-rx+.08, -2.6, facing(1, 0)), (rx-.08, -2.7, facing(-1, 0))]:
        instance('wall_shackles', 'hall shackles', (x, y, 0), t)
    for x, y in [(4.1, 5.8), (-4.2, -2.0), (4.2, -3.2), (-2.2, -6.0), (1.9, 6.0)]:
        instance('rubble', 'fallen masonry', (x, y, 0), random.uniform(0, PI), .9)
    for x, y in [(-4.3, -4.6), (4.3, 4.6), (-4.1, 4.3)]:
        instance('skull', 'skull', (x, y, 0), random.uniform(0, PI))
    # A warding circle inlaid round the board, glowing the colour of the chains.
    n = 72
    for a, b in [(2.4, 3.25), (2.62, 3.47)]:
        ring = [(math.cos(i*2*PI/n)*a, math.sin(i*2*PI/n)*b) for i in range(n)]
        for i in range(n):
            (ax, ay), (bx, by) = ring[i], ring[(i+1) % n]
            box('warding line', ((ax+bx)/2, (ay+by)/2, .022), (math.hypot(bx-ax, by-ay)*1.02, .018, .008), 'rune_green',
                (0, 0, math.atan2(by-ay, bx-ax)))
    for i in range(0, n, 6):
        t = i*2*PI/n
        x, y = math.cos(t)*2.51, math.sin(t)*3.36
        turn = math.atan2(math.cos(t)*3.36, -math.sin(t)*2.51)
        glyph = [((0, 0, turn), .14), ((0, 0, turn+PI/2), .08)] if i % 12 else [((0, 0, turn+PI/4), .1), ((0, 0, turn-PI/4), .1)]
        for r, length in glyph:
            box('warding rune', (x, y, .022), (length, .018, .008), 'rune_green', r)
    for i in range(4):
        x, y = random.choice([(-3.6, -1.6), (3.7, 1.0), (-1.9, 5.6), (2.0, -5.7)])
        pts = [(x+math.cos(j*PI/4)*.3*random.uniform(.7, 1.2), y+math.sin(j*PI/4)*.18*random.uniform(.7, 1.2), .018) for j in range(8)]
        mesh('foul seep', pts, [tuple(range(8))], 'slime')


# -- Oppidium: the golden forest, the mine, and the people on their rocks ------

def oppidium_height(x, y):
    d = arena_distance(x, y, 1.9, 2.9)
    h = -.02+min(1, max(0, d-.4)/2.5)*(.18+.14*noise.noise(Vector((x*.25, y*.25, 4.0))))
    r = math.hypot(x, y)
    if r > 16:
        h += (r-16)*.16*(.7+.6*(noise.noise(Vector((x*.06, y*.06, 9)))+.5))
    if y > 7.6 and abs(x) < 9:
        h += (y-7.6)*.45  # the hillside the mine is cut into
    if abs(x+7.3) < .5 and -7 < y < 7:
        h -= .32*(1-abs(x+7.3)/.5)  # the ditch: the guide went no further
    return h


PATH = [(-.6, -14), (-1.2, -8.5), (-2.7, -5.5), (-3.9, -1.6), (-4.0, 1.8), (-5.6, 4.6), (-7.0, 6.2), (-6.9, 9.0)]


def near_path(x, y, width=.55):
    for (ax, ay), (bx, by) in zip(PATH, PATH[1:]):
        dx, dy = bx-ax, by-ay
        t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
        if math.hypot(x-ax-dx*t, y-ay-dy*t) < width:
            return True
    return False


def oppidium():
    def paint(x, y):
        if near_path(x, y):
            return 'gold_deep'
        n = noise.noise(Vector((x*.4, y*.4, 2.0)))
        return 'gold' if n > .4 else ('gold_dark' if n > -.15 else 'gold_deep')
    terrain('golden ground', oppidium_height, ['gold_dark', 'gold', 'gold_deep'], paint)
    # The hillside and its mine, at the head of the clearing.
    mx, my = 1.4, 7.5
    for x in [v*.95 for v in range(-11, 12)]:
        if abs(x-mx) < 1.3:
            continue
        for y, s in [(my+.6, 1.25), (my+1.9, 1.8), (my+3.5, 2.4)]:
            z = oppidium_height(x, y)
            boulder('gilded crag', (x+random.uniform(-.3, .3), y+random.uniform(-.3, .3), z+s*.3),
                    (s*random.uniform(.55, .8), s*random.uniform(.5, .7), s*random.uniform(.6, .9)), ['gold_deep', 'gold_dark'], sub=2)
    for dx, dz, s in [(0, 1.9, (1.2, .9, .7)), (-.9, 2.3, (.8, .8, .9)), (1.0, 2.2, (.8, .9, .8))]:
        boulder('crag over the adit', (mx+dx, my+.8, oppidium_height(mx, my+.8)+dz), s, ['gold_deep', 'gold_dark'], sub=2)
    instance('mine_entrance', 'abandoned mine', (mx, my, oppidium_height(mx, my)), 0)
    for i in range(4):
        y = my-.7-i
        instance('rail_track', 'golden rails', (mx, y, -.02), 0)
    box('buffer stop', (mx, my-4.15, .1), (.5, .12, .2), 'gold_dark')
    instance('minecart', 'loaded minecart', (mx, my-2.0, .02), 0)
    tipped = instance('minecart', 'overturned minecart', (3.35, 4.65, .2), .7)
    tipped.rotation_euler.y = 1.5
    instance('ore_pile', 'spilled ore', (2.95, 4.25, 0), .3)
    for x, y, s in [(2.9, 6.4, 1.6), (-.5, 6.6, 1.4), (-1.9, 7.2, 1.2), (4.2, 6.9, 1.3)]:
        instance('ore_pile', 'spoil heap', (x, y, oppidium_height(x, y)), random.uniform(0, PI), s)
    instance('mine_winch', 'winch', (-.15, 6.9, oppidium_height(-.15, 6.9)), .1)
    for x, t in [(.55, .2), (2.35, -.3)]:
        p = instance('pickaxe', 'leaning pickaxe', (x, my-.25, 0), t)
        p.rotation_euler.x = .35
    instance('coin_pile', 'Kien from the mint', (-1.75, 4.55, 0), .4)
    instance('coin_pile', 'Kien from the mint', (-2.6, 5.4, 0), 2.2, .8)
    instance('treasure_heap', 'golden hoard', (4.3, 5.6, 0), -.5, .8)
    # The people turned to gold, cross-legged on their crags along the path.
    seated = [(-3.55, -2.6, 'lady', False), (-5.2, .7, 'man', True), (-4.6, 3.6, 'lady', False),
              (-6.5, -4.7, 'man', False), (4.6, -3.5, 'lady', True), (5.3, 1.1, 'man', False),
              (-8.4, -1.9, 'lady', False), (6.6, -6.3, 'man', False), (-6.8, 7.3, 'man', False), (5.6, 3.6, 'lady', False)]
    for i, (x, y, kind, turning) in enumerate(seated):
        z = oppidium_height(x, y)
        t = facing(-x, -y)+random.uniform(-.4, .4)
        s = random.uniform(.95, 1.1)
        instance('gold_outcrop', 'golden crag', (x, y, z), random.uniform(0, PI), s)
        seat = z+.36*s
        instance('statue_'+kind, 'golden '+('lady' if kind == 'lady' else 'gallant'), (x, y, seat), t)
        # A few have turned their heads since the key was taken.
        instance('statue_'+kind+'_head', 'golden head', (x, y, seat+.35), t+(.6 if turning else 0))
    # Torches: the only light there is.
    for x, y in [(-3.0, -2.05), (2.95, -1.0), (2.85, 3.1), (-2.85, 2.35), (-6.6, 1.5), (4.9, -5.4)]:
        instance('gold_torch', 'golden torch', (x, y, oppidium_height(x, y)), random.uniform(0, PI))
    instance('key_niche', 'the emptied niche', (-8.4, 2.4, oppidium_height(-8.4, 2.4)), facing(1, 0))
    # Animals, gilded where they stood.
    for kind, x, y, t, s in [('gold_deer', 4.45, 4.0, 2.4, 1.05), ('gold_deer', -6.4, 5.9, 2.0, 1.1), ('gold_deer', 7.5, -2.0, -2.0, 1.0),
                             ('gold_fox', -2.7, -4.7, 1.0, 1.2), ('gold_fox', 3.3, -4.1, -1.8, 1.1),
                             ('gold_boar', 4.4, -6.0, -1.1, 1.1), ('gold_boar', -7.4, -3.4, .7, 1.0),
                             ('gold_bird', -2.5, 4.3, .4, 1.3), ('gold_bird', 3.1, -2.6, -2.0, 1.3), ('gold_bird', 2.3, 3.6, 3.0, 1.3)]:
        instance(kind, kind.replace('_', ' '), (x, y, oppidium_height(x, y)), t, s)

    def clear(x, y):
        if abs(x) < 3.1 and abs(y) < 3.7:
            return False
        if near_path(x, y, 1.0) or (abs(x-1.4) < 4.2 and 3.4 < y < 9.5) or (abs(x) < 3.6 and -9.5 < y < -3):
            return False
        if abs(x+7.3) < .8 and -7 < y < 7:
            return False
        return all((x-sx)**2+(y-sy)**2 > 1.0 for sx, sy, _, _ in seated)
    for x, y in scatter(90, 3.1, 9, clear, .7)+scatter(300, 9, 30, clear, .85):
        r = math.hypot(x, y)
        kind = random.choices(['gold_oak', 'gold_pine', 'gold_birch', 'gold_bush'], [5, 3, 3, 2 if r < 12 else 0])[0]
        instance(kind, 'golden tree', (x, y, oppidium_height(x, y)-.03), random.uniform(0, 2*PI), random.uniform(1.0, 1.5)*(1+max(0, r-10)*.02))
    for x, y in scatter(160, 2.6, 14, lambda x, y: not near_path(x, y) and arena_distance(x, y) > .5, .35):
        instance('gold_tuft', 'golden grass', (x, y, oppidium_height(x, y)), random.uniform(0, PI), random.uniform(.8, 1.4))
    for x, y in scatter(70, 2.4, 9, lambda x, y: arena_distance(x, y) > .3, .4):
        instance('gold_glint', 'glint', (x, y, oppidium_height(x, y)+random.uniform(.02, .5)), random.uniform(0, PI), random.uniform(.6, 1.2))


# -- Kesergő: the Undan camp in the forest, and the cave of the fox ------------

CAVE = (6.7, .6)


def kesergo_height(x, y):
    d = arena_distance(x, y, 1.9, 2.9)
    h = -.02+min(1, max(0, d-1.6)/3)*(.12+.2*(noise.noise(Vector((x*.3, y*.3, 6.0)))+.5))
    r = math.hypot(x, y)
    if r > 15:
        h += (r-15)*.13*(.7+.6*(noise.noise(Vector((x*.07, y*.07, 3)))+.5))
    return h


def camp_ground(x, y):
    """The trampled clearing, and the track west out of it."""
    wobble = .25*noise.noise(Vector((x*.4, y*.4, 8.0)))
    return arena_distance(x, y, 1.9, 2.9) < 2.6+wobble or (-30 < x < -3 and abs(y-.2+wobble) < .9)


def kesergo():
    def paint(x, y):
        n = noise.noise(Vector((x*.35, y*.35, 5.0)))
        if camp_ground(x, y):
            return 'packed_earth' if n > -.25 else 'litter'
        return 'moss' if n > .3 else ('litter' if n < -.25 else 'forest_floor')
    terrain('forest floor', kesergo_height, ['packed_earth', 'litter', 'forest_floor', 'moss'], paint)
    patches(['litter', 'dust'], 24, 0, 4.5, lambda x, y: True, (.3, .7))
    # The cliff on the east side, and the cave in it.
    cx, cy = CAVE
    for y in [v*.9 for v in range(-9, 10)]:
        for x, s, mats in [(cx+.7, 1.7, ['cliff', 'cliff_dark']), (cx+2.0, 2.4, ['cliff', 'cliff_dark', 'moss']),
                           (cx+3.6, 3.0, ['cliff_dark', 'moss'])]:
            if x < cx+2.6 and abs(y-cy) < 1.1:
                continue
            boulder('cliff rock', (x+random.uniform(-.3, .3), y+random.uniform(-.25, .25), s*.35+kesergo_height(x, y)),
                    (s*random.uniform(.5, .75), s*random.uniform(.5, .7), s*random.uniform(.65, .95)), mats, sub=2)
    for dy, dz, s in [(0, 2.05, (1.15, 1.35, .7)), (-1.3, 1.0, (.65, .55, 1.05)), (1.3, 1.05, (.65, .55, 1.1)),
                      (0, 2.7, (1.3, 1.5, .8))]:
        boulder('cave mouth rock', (cx+.75 if dz > 2.5 else cx+.55, cy+dy, dz), s, ['cliff', 'cliff_dark'], turn=0, sub=2)
    box('cave dark', (cx+1.15, cy, .7), (1.1, 1.6, 1.4), 'void')
    # A ring of paler stones outlines the mouth against the shadow under the overhang.
    for i in range(9):
        a = PI*i/8
        boulder('mouth stone', (cx+.42, cy+math.cos(a)*.9, .08+math.sin(a)*1.34), (.3, .26, .22), ['cliff', 'stone_light'])
    # The fox skull on its pole before the cave, and the pyrite laid in a triangle.
    instance('fox_totem', 'fox skull totem', (cx-1.0, cy+1.05, 0), facing(-1, -.2), 1.35)
    px, py = cx-1.55, cy
    for i in range(3):
        a = PI+i*2*PI/3
        instance('pyrite', 'pyrite chunk', (px+math.cos(a)*.38, py+math.sin(a)*.38, 0), random.uniform(0, PI), 1.5)
    # Yurts round the camp, doors to the fire.
    yurts = [(-3.75, -1.75, 1.0), (-3.95, 2.05, 1.1), (-2.45, 5.0, .95), (.95, 5.45, 1.05), (3.6, 4.6, .9),
             (-3.4, -4.95, .95), (3.65, -4.75, 1.0), (-6.6, -.3, .9), (-6.1, 4.0, .85), (-6.0, -4.0, .9)]
    for i, (x, y, s) in enumerate(yurts):
        instance('yurt' if i % 3 else 'yurt_old', 'Undan yurt', (x, y, kesergo_height(x, y)), facing(-x, -y)+random.uniform(-.25, .25), s)
    fires = [(-2.9, .15), (2.95, -2.9), (.6, 3.85)]
    for i, (x, y) in enumerate(fires):
        instance('campfire', 'campfire', (x, y, 0), random.uniform(0, PI))
        instance('fire_flames', 'campfire flames', (x, y, .03), random.uniform(0, PI))
        for a in [random.uniform(0, PI)+k*2*PI/3 for k in range(2)]:
            instance('log_bench', 'log bench', (x+math.cos(a)*.75, y+math.sin(a)*.75, 0), a+PI/2)
    instance('tripod_pot', 'cooking pot', (-2.9, .15, 0), .3)
    for kind, x, y, t, s in [
        ('drying_rack', -4.7, -3.3, .4, 1.0), ('drying_rack', 2.0, 5.9, 0, 1.0), ('drying_rack', -5.3, 2.7, 1.2, .9),
        ('woodpile', -2.6, 3.7, .6, 1.2), ('woodpile', 4.9, -3.4, 1.4, 1.1), ('woodpile', -4.95, -.2, 1.6, 1.0),
        ('drum', -2.95, -2.95, 0, 1.0), ('drum', -2.55, -3.2, .5, .8), ('basket', -2.4, 2.2, 0, 1.0),
        ('basket', 2.65, 4.2, 0, 1.1), ('basket', -4.5, 1.0, 0, .9), ('spear_rack', -1.5, -4.4, .1, 1.0),
        ('spear_rack', 4.85, 3.0, -1.2, 1.0), ('totem', -4.95, -2.55, facing(1, .5), 1.0), ('totem', -1.0, 5.55, facing(.2, -1), 1.1),
        ('totem', 3.2, -5.6, facing(-.3, 1), 1.0), ('banner_pole', -3.1, 3.45, 0, 1.0), ('banner_pole', 2.4, -4.1, 2.0, 1.0),
        ('banner_pole', -5.4, -1.0, 1.0, 1.0), ('sack', -2.15, 3.05, 0, .8), ('sack', 3.4, 3.4, 1.0, .75),
    ]:
        instance(kind, kind.replace('_', ' '), (x, y, kesergo_height(x, y)), t, s)

    def forest(x, y):
        if camp_ground(x, y) or arena_distance(x, y, 1.9, 2.9) < 3.2:
            return False
        if x > cx-1.6 and abs(y) < 9:
            return False
        return all((x-a)**2+(y-b)**2 > 1.6 for a, b, _ in yurts)
    for x, y in scatter(380, 4.5, 30, forest, .8):
        r = math.hypot(x, y)
        kind = random.choices(['forest_pine', 'forest_oak', 'forest_birch', 'tree_dead'], [5, 4, 2, 1])[0]
        instance(kind, 'forest tree', (x, y, kesergo_height(x, y)-.03), random.uniform(0, 2*PI),
                 random.uniform(1.05, 1.6)*(1+max(0, r-10)*.025))
    for x, y in scatter(28, cx+1.2, cx+5, lambda x, y: abs(y) < 8 and x > cx+1.3, 1.0, (0, 0)):
        top = top_of(x, y)
        if top > .5:
            instance(random.choice(['forest_pine', 'forest_oak']), 'tree on the cliff', (x, y, top-.08), random.uniform(0, 2*PI),
                     random.uniform(1.0, 1.4))
    undergrowth = lambda x, y: (not camp_ground(x, y) and arena_distance(x, y) > 2.4 and not (x > cx-.2 and abs(y) < 9)
                                and not (x > cx-3.2 and abs(y-cy) < 2.6))
    for x, y in scatter(170, 4, 16, undergrowth, .45):
        instance(random.choices(['fern', 'bush', 'mushrooms', 'stump', 'weeds'], [6, 4, 2, 1, 3])[0], 'undergrowth',
                 (x, y, kesergo_height(x, y)), random.uniform(0, 2*PI), random.uniform(.9, 1.5))
    for x, y in scatter(10, 5, 14, undergrowth, 2.0):
        instance('fallen_log', 'fallen log', (x, y, kesergo_height(x, y)), random.uniform(0, PI), random.uniform(.9, 1.3))
    for x, y in scatter(30, 2.4, 6, lambda x, y: arena_distance(x, y) > .5 and not (x > cx-2.2 and abs(y-cy) < 1.2), .5):
        instance('weeds', 'trampled weeds', (x, y, 0), random.uniform(0, PI), random.uniform(.8, 1.2))


# -- light, cards and the build ---------------------------------------------------

T.LIGHT.update({
    'umbra': dict(sun=(.55, .66, 1), energy=.35, elevation=58, sky=(.003, .004, .009), strength=1.0,
                  lamp=16, fog=(.003, .004, .009), mist=(7, 30), exposure=1.0),
    'oppidium': dict(sun=(1, .72, .38), energy=1.0, elevation=32, sky=(.035, .024, .01), strength=1.0,
                     lamp=22, fog=(.02, .014, .006), mist=(6, 26), exposure=1.1),
    'kesergo': dict(sun=(1, .89, .7), energy=3.4, elevation=40, sky=(.30, .42, .40), strength=.85,
                    lamp=6, fog=(.33, .44, .41), mist=(12, 52), exposure=.62),
})
T.CARD.update({
    'umbra': ((2.2, -1.2, 1.9), (-1.0, 7.0, -.3), 26),
    'oppidium': ((-1.3, -4.7, .8), (-3.5, -2.5, .55), 34),
    'kesergo': ((2.4, -1.7, .95), (6.6, .8, .8), 30),
})
BUILD = {'umbra': umbra, 'oppidium': oppidium, 'kesergo': kesergo}
SEED = {'umbra': 401, 'oppidium': 503, 'kesergo': 607}


def chosen():
    only = [a for a in sys.argv[sys.argv.index('--')+1:] if not a.startswith('--')] if '--' in sys.argv else []
    return [n for n in NAMES if not only or n in only]


def main():
    if '--cards-only' in sys.argv:
        for name in chosen():
            bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, name+'.blend'))
            T.render_card(name)
        sys.exit(0)
    if '--export-existing' in sys.argv:
        for name in chosen():
            bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, name+'.blend'))
            T.CURRENT = bpy.context.scene.collection.children[name+' assembled kit']
            bpy.context.scene.frame_set(1)
            bpy.context.view_layer.update()
            T.export(os.path.join(T.STAGE, 'battlefields', name+'.glb'), list(T.CURRENT.objects), True, True)
        print('REALMS REEXPORTED', flush=True)
        sys.exit(0)

    T.build_kit()
    build_umbra_kit()
    build_oppidium_kit()
    build_kesergo_kit()
    library_scene = bpy.context.scene
    library_scene.name = 'Realm component library'
    for name in REALM_KIT:
        KIT[name].asset_mark()
        KIT[name].asset_data.description = 'Skart reusable realm component: '+name
        T.export(os.path.join(OUT, 'parts', name+'.glb'), list(KIT[name].objects))
    T.CURRENT = coll('Component display')
    for i, name in enumerate(REALM_KIT):
        instance(name, name+' display', ((i % 8)*2, (i//8)*2, 0))
    for c in KIT.values():
        library_scene.collection.children.unlink(c)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'kit.blend'))

    manifest = {'components': REALM_KIT, 'battlefields': {}}
    for name in chosen():
        random.seed(SEED[name])
        scene = bpy.data.scenes.new(name)
        bpy.context.window.scene = scene
        T.CURRENT = coll(name+' assembled kit')
        BUILD[name]()
        T.setup_preview(name)
        bpy.context.view_layer.update()
        runtime = list(T.CURRENT.objects)
        T.guides(SLOTS)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, name+'.blend'))
        T.export(os.path.join(T.STAGE, 'battlefields', name+'.glb'), runtime, False, True)
        # Nothing moves: ambient clips cost the board a redraw every frame.
        manifest['battlefields'][name] = {'source': name+'.blend', 'playable_slots': len(SLOTS)}
        if T.RENDER:
            scene.render.filepath = os.path.join(OUT, 'previews', name+'.png')
            bpy.ops.render.render(write_still=True)
            print('RENDERED', name, flush=True)
        if T.CARDS:
            T.render_card(name)
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('REALMS COMPLETE', flush=True)


if __name__ == '__main__':
    main()
