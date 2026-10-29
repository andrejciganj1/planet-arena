# The alien every player is: a big round head with big black eyes inside a clear bubble helmet, on a small
# white space suit. Built from code (no hand modelling), so a rebuild gives the same file.
#
#   blender -b -P tools/blender/alien.py -- --body 0.4 0.4 --head 1.25 0.55 --out assets/models/alien.glb
#
# --body and --head are PLAYER.hit's spheres (metres along up from the feet, then the radius): the helmet is
# exactly the head sphere and everything else at rest stays inside the body sphere (tests/look.test.mjs).
# Built in game axes (feet at the origin, up +y, facing -z) and turned into Blender's at the end; the glTF
# exporter turns them back. Nodes: head (pivot at the helmet's centre, so it turns in place) with eyes and
# helmet under it; body; armL and armR pivoting at the shoulders, with `hand` under armR where the gun goes
# (its -z along the arm); legL and legR pivoting at the hips. Materials: skin and trim are tinted per player
# in the page; suit, eye, glass and shine are the same for everyone.
import argparse
import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--body", nargs=2, type=float, default=[0.4, 0.4])
ap.add_argument("--head", nargs=2, type=float, default=[1.25, 0.55])
ap.add_argument("--out", default="assets/models/alien.glb")
args = ap.parse_args(argv)
B, RB = args.body
H, RH = args.head
U = RB / 0.4  # everything below the head is drawn for a body sphere of 0.4 m and scaled to the real one

# ---- geometry in game axes: each part is (vertices, faces, material) -------------------------------------


def rot_x(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c)


def rot_y(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c)


def rot_z(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def sphere(seg, rings, warp):
    """A unit UV sphere (poles on y) passed through warp(p) -> p."""
    verts = [warp((0.0, 1.0, 0.0))]
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            verts.append(warp((math.sin(th) * math.sin(ph), math.cos(th), math.sin(th) * math.cos(ph))))
    verts.append(warp((0.0, -1.0, 0.0)))
    faces, last = [], len(verts) - 1
    ring = lambda i, j: 1 + (i - 1) * seg + (j % seg)
    for j in range(seg):
        faces.append((0, ring(1, j), ring(1, j + 1)))
        faces.append((last, ring(rings - 1, j + 1), ring(rings - 1, j)))
    for i in range(1, rings - 1):
        for j in range(seg):
            faces.append((ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j + 1)))
    return verts, faces


def ellipsoid(centre, radii, seg=16, rings=10, turn=(0.0, 0.0, 0.0)):
    def warp(p):
        q = (p[0] * radii[0], p[1] * radii[1], p[2] * radii[2])
        q = rot_y(rot_x(rot_z(q, turn[2]), turn[0]), turn[1])
        return (q[0] + centre[0], q[1] + centre[1], q[2] + centre[2])
    return sphere(seg, rings, warp)


def capsule(a, b, r, seg=12, rings=8):
    """A rounded tube from a to b (both on the same x, in the y-z plane is enough here)."""
    dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    tilt_x = math.atan2(-dz, -dy) if length else 0.0  # from straight down (-y) towards the b-a direction
    tilt_z = math.asin(dx / length) if length else 0.0

    def warp(p):
        q = (p[0] * r, p[1] * r + (length / 2 if p[1] > 0 else -length / 2), p[2] * r)
        q = rot_x(rot_z(q, tilt_z), -tilt_x)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
        return (q[0] + mid[0], q[1] + mid[1], q[2] + mid[2])
    return sphere(seg, rings, warp)


def torus(centre, major, minor, seg=24, sides=8, squash=1.0):
    """A ring round the y axis."""
    verts, faces = [], []
    for j in range(seg):
        ph = 2 * math.pi * j / seg
        for k in range(sides):
            th = 2 * math.pi * k / sides
            rr = major + minor * math.cos(th)
            verts.append((centre[0] + rr * math.sin(ph), centre[1] + minor * squash * math.sin(th), centre[2] + rr * math.cos(ph)))
    for j in range(seg):
        for k in range(sides):
            a, b = j * sides + k, ((j + 1) % seg) * sides + k
            c, d = ((j + 1) % seg) * sides + (k + 1) % sides, j * sides + (k + 1) % sides
            faces.append((a, d, c, b))
    return verts, faces


# ---- the parts ---------------------------------------------------------------------------------------------

u = lambda *p: tuple(x * U for x in p)  # body-scale point, with the body sphere's centre as y = 0.4 * U
parts = {name: [] for name in ["head", "eyes", "helmet", "body", "armL", "armR", "legL", "legR"]}

# Helmet: the head sphere itself.
parts["helmet"].append((*ellipsoid((0, H, 0), (RH, RH, RH), seg=32, rings=18), "glass"))

# Head: a big cranium tapering to a small chin, filling most of the bubble.
HR = 0.76 * RH
HC = (0.0, H + 0.06 * RH, -0.02 * RH)


def skull(p):
    x, y, z = p[0] * 1.06, p[1] * 0.98, p[2] * 0.96
    if y < 0:  # narrower towards the chin, and a little longer
        k = 1 - 0.42 * (-y) ** 1.4
        x, z, y = x * k, z * (0.75 + 0.25 * k), y * 1.08
    return (HC[0] + x * HR, HC[1] + y * HR, HC[2] + z * HR)


parts["head"].append((*sphere(24, 16, skull), "skin"))
# A thin neck down into the suit's collar.
parts["head"].append((*capsule((0, H - 0.5 * RH, 0), (0, H - 0.78 * RH, 0), 0.1 * RH, seg=10, rings=6), "skin"))

# Eyes: big black almonds, tilted up at the outer corner and wrapped round the face, each with a catchlight.
for sx in (-1, 1):
    ex, ey = sx * 0.37 * HR, HC[1] - 0.12 * HR
    ez = HC[2] - 0.86 * HR
    yaw = -sx * 0.42
    parts["eyes"].append((*ellipsoid((ex, ey, ez), (0.3 * HR, 0.17 * HR, 0.1 * HR), seg=16, rings=10,
                                     turn=(0.12, yaw, sx * 0.42)), "eye"))
    parts["eyes"].append((*ellipsoid((ex + sx * 0.08 * HR, ey + 0.06 * HR, ez - 0.1 * HR), (0.045 * HR,) * 3, seg=8, rings=5), "shine"))
# A small smile.
parts["eyes"].append((*torus((0, HC[1] - 0.5 * HR, HC[2] - 0.83 * HR), 0.07 * HR, 0.016 * HR, seg=12, sides=6), "eye"))
mouth = parts["eyes"][-1]
# Keep the lower half of the ring only, tipped to face forward.
mv, mf = mouth[0], []
for f in mouth[1]:
    if all(mv[i][2] >= HC[2] - 0.83 * HR for i in f):
        mf.append(f)
cy, cz = HC[1] - 0.5 * HR, HC[2] - 0.83 * HR
mv = [rot_x((x, y - cy, z - cz), math.pi / 2) for (x, y, z) in mv]
mv = [(x, y + cy, z + cz) for (x, y, z) in mv]
parts["eyes"][-1] = (mv, mf, "eye")

# Body: an egg of a suit, a collar ring holding the bubble, a glowing belt and chest light, a small booster pack.
parts["body"].append((*ellipsoid(u(0, 0.5, 0), u(0.235, 0.29, 0.21), seg=20, rings=12), "suit"))
neck_y = H - math.sqrt(RH ** 2 - (0.18 * U) ** 2)  # where a 0.18 m ring meets the helmet
parts["body"].append((*torus((0, neck_y, 0), 0.18 * U, 0.034 * U, seg=24, sides=8, squash=0.8), "suit"))
parts["body"].append((*torus((0, neck_y - 0.03 * U, 0), 0.188 * U, 0.014 * U, seg=24, sides=6), "trim"))
parts["body"].append((*torus(u(0, 0.39, 0), 0.226 * U, 0.02 * U, seg=24, sides=6), "trim"))
parts["body"].append((*ellipsoid(u(0, 0.56, -0.2), u(0.05, 0.05, 0.02), seg=10, rings=6), "trim"))
parts["body"].append((*ellipsoid(u(0, 0.52, 0.2), u(0.13, 0.15, 0.07), seg=12, rings=8), "suit"))
for sx in (-1, 1):
    parts["body"].append((*ellipsoid(u(sx * 0.06, 0.37, 0.22), u(0.035, 0.03, 0.035), seg=8, rings=5), "trim"))

# Legs: short and stubby, round boots with a glowing cuff.
HIP = (0.1 * U, 0.3 * U, 0.0)
for name, sx in (("legL", -1), ("legR", 1)):
    hip = (sx * HIP[0], HIP[1], HIP[2])
    parts[name].append((*capsule(hip, u(sx * 0.082, 0.12, 0), 0.072 * U), "suit"))
    parts[name].append((*ellipsoid(u(sx * 0.078, 0.062, -0.03), u(0.072, 0.062, 0.1), seg=12, rings=8), "suit"))
    parts[name].append((*torus(u(sx * 0.081, 0.12, -0.005), 0.072 * U, 0.016 * U, seg=16, sides=6), "trim"))

# Arms: hanging at the sides at rest, skin-coloured hands so the player's colour shows twice.
SHOULDER = (0.245 * U, 0.6 * U, 0.0)
HAND = (0.262 * U, 0.33 * U, 0.0)
for name, sx in (("armL", -1), ("armR", 1)):
    sh = (sx * SHOULDER[0], SHOULDER[1], SHOULDER[2])
    parts[name].append((*capsule(sh, (sx * HAND[0], HAND[1] + 0.05 * U, HAND[2]), 0.058 * U, seg=10, rings=6), "suit"))
    parts[name].append((*torus((sx * (HAND[0] - 0.003 * U), HAND[1] + 0.07 * U, 0), 0.056 * U, 0.014 * U, seg=12, sides=6), "trim"))
    parts[name].append((*ellipsoid((sx * HAND[0], HAND[1], HAND[2]), u(0.066, 0.068, 0.066), seg=10, rings=7), "skin"))

PIVOTS = {
    "head": (0.0, H, 0.0), "eyes": (0.0, H, 0.0), "helmet": (0.0, H, 0.0), "body": (0.0, B, 0.0),
    "legL": (-HIP[0], HIP[1], 0.0), "legR": (HIP[0], HIP[1], 0.0),
    "armL": (-SHOULDER[0], SHOULDER[1], 0.0), "armR": (SHOULDER[0], SHOULDER[1], 0.0),
}
PARENT = {"eyes": "head", "helmet": "head"}

# ---- into Blender -----------------------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
to_b = lambda p: (p[0], -p[2], p[1])  # game (x, y, z) -> Blender (x, y, z); the exporter maps it back


def material(name, colour, rough, metal=0.0, emit=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


MATS = {
    "skin": material("skin", (0.8, 0.8, 0.8), 0.5),
    "suit": material("suit", (0.82, 0.84, 0.88), 0.55),
    "trim": material("trim", (0.25, 0.25, 0.25), 0.4, emit=(1.0, 1.0, 1.0)),
    "eye": material("eye", (0.01, 0.012, 0.02), 0.12),
    "glass": material("glass", (0.85, 0.92, 1.0), 0.05, alpha=0.16),
    "shine": material("shine", (1.0, 1.0, 1.0), 0.5, emit=(1.0, 1.0, 1.0)),
}

objects = {}
for name, plist in parts.items():
    pivot = PIVOTS[name]
    verts, faces, mat_of_face, mat_names = [], [], [], []
    for pv, pf, mname in plist:
        if mname not in mat_names:
            mat_names.append(mname)
        base = len(verts)
        verts += [to_b((x - pivot[0], y - pivot[1], z - pivot[2])) for (x, y, z) in pv]
        faces += [tuple(base + i for i in f) for f in pf]
        mat_of_face += [mat_names.index(mname)] * len(pf)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for mname in mat_names:
        mesh.materials.append(MATS[mname])
    for poly, mi in zip(mesh.polygons, mat_of_face):
        poly.material_index = mi
        poly.use_smooth = True
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    objects[name] = obj

for name, obj in objects.items():
    pivot = PIVOTS[name]
    if name in PARENT:
        parent = PIVOTS[PARENT[name]]
        obj.parent = objects[PARENT[name]]
        obj.location = to_b((pivot[0] - parent[0], pivot[1] - parent[1], pivot[2] - parent[2]))
    else:
        obj.location = to_b(pivot)

# The gun's place: in the right hand, its -z (the barrel) along the arm, so an arm turned forward aims it.
hand = bpy.data.objects.new("hand", None)
bpy.context.scene.collection.objects.link(hand)
hand.parent = objects["armR"]
hand.location = to_b((HAND[0] - SHOULDER[0], HAND[1] - SHOULDER[1], 0.0))
hand.rotation_euler = (-math.pi / 2, 0.0, 0.0)

bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_yup=True, export_texcoords=False, export_normals=True,
    export_materials="EXPORT", export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_extras=False, use_selection=False,
)
print("alien written to", args.out)
