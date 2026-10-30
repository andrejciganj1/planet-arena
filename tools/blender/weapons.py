# The six weapons, each its own shape with an accent in its pickup's colour. Built from code (no hand
# modelling), so a rebuild gives the same file.
#
#   blender -b -P tools/blender/weapons.py -- --out assets/models/weapons.glb
#
# Built in game axes (the grip at the origin, up +y, the barrel along -z) at the size the gun has in first person
# (the page scales it up in an alien's hand), and turned into Blender's axes at the end; the glTF exporter turns
# them back. Nodes: one per weapon, named by it, each with `<weapon>_muzzle` at the barrel's tip (where the flash
# goes); the minigun's barrels are `minigun_spin`, turning about its axis. Materials: casing, metal, grip and
# bore are shared; `<weapon>_accent` is that weapon's colour (LOOK.weapons.colors in src/tuning.js, checked by
# tests/look.test.mjs), and glows in the page.
import argparse
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="assets/models/weapons.glb")
args = ap.parse_args(argv)

COLORS = {"pistol": 0x8fa1b8, "shotgun": 0xc98a4b, "rocket": 0x5f8f4e, "minigun": 0x9a9fa8, "sniper": 0x4b7bc9, "railgun": 0x3fe0d0}

# ---- parts: each is built in its own bmesh, then kept as (verts, faces, smooth per face, material) ----------


def take(bm, mat, smooth):
    """The bmesh's geometry as plain lists; smooth(face normal) says which faces shade smooth."""
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    flags = [smooth(f.normal) for f in bm.faces]
    bm.free()
    return (verts, faces, flags, mat)


def place(bm, at=(0, 0, 0), rx=0.0, ry=0.0):
    m = Matrix.Translation(Vector(at)) @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)


def box(at, size, mat, bevel=0.004, rx=0.0, ry=0.0):
    """A box with chamfered edges, centred at `at`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=min(bevel, 0.45 * min(size)), segments=1,
                        affect="EDGES", profile=0.5)
    place(bm, at, rx, ry)
    return take(bm, mat, lambda n: False)


def tube(z0, z1, r0, mat, x=0.0, y=0.0, r1=None, seg=16, rx=0.0):
    """A capped cylinder (or cone, r0 at z0 to r1 at z1) along z: sides smooth, caps flat."""
    bm = bmesh.new()
    r1 = r0 if r1 is None else r1
    # create_cone puts radius1 at -depth/2.
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=abs(z1 - z0),
                          matrix=Matrix.Identity(4))
    if z1 < z0:
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi, 4, "X"), verts=bm.verts)
    place(bm, (x, y, (z0 + z1) / 2), rx)
    return take(bm, mat, lambda n: abs(n.z) < 0.9)


def ring(z, major, minor, mat, x=0.0, y=0.0, seg=20, sides=8):
    """A torus round the z axis."""
    bm = bmesh.new()
    vs = []
    for j in range(seg):
        ph = 2 * math.pi * j / seg
        for k in range(sides):
            th = 2 * math.pi * k / sides
            rr = major + minor * math.cos(th)
            vs.append(bm.verts.new((x + rr * math.cos(ph), y + rr * math.sin(ph), z + minor * math.sin(th))))
    for j in range(seg):
        for k in range(sides):
            a, b = j * sides + k, ((j + 1) % seg) * sides + k
            c, d = ((j + 1) % seg) * sides + (k + 1) % sides, j * sides + (k + 1) % sides
            bm.faces.new((vs[a], vs[b], vs[c], vs[d]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return take(bm, mat, lambda n: True)


def grip(mat="grip", z=0.012, tilt=0.28, h=0.1):
    """The handle the hand holds, raked back."""
    return box((0, -h / 2 + 0.01, z), (0.032, h, 0.04), mat, bevel=0.008, rx=tilt)


# ---- the guns: parts, the muzzle (x, y, z), child nodes and a scale for the whole gun ----------------------

GUNS = {}

# Pistol: a stubby blaster, a slide with an accent stripe, a ringed muzzle and a glowing cell at the back.
Y = 0.045
GUNS["pistol"] = dict(
    parts=[
        box((0, Y, -0.045), (0.044, 0.05, 0.17), "casing", bevel=0.009),
        box((0, Y + 0.027, -0.05), (0.026, 0.008, 0.13), "pistol_accent", bevel=0.003),
        box((0, Y - 0.004, -0.045), (0.05, 0.016, 0.12), "metal", bevel=0.004),
        tube(-0.13, -0.175, 0.013, "metal", y=Y),
        tube(-0.16, -0.185, 0.019, "pistol_accent", y=Y),
        tube(-0.184, -0.1855, 0.009, "bore", y=Y, seg=12),
        tube(0.04, 0.055, 0.015, "pistol_accent", y=Y + 0.004, seg=12),
        box((0, 0.002, -0.05), (0.01, 0.01, 0.045), "metal", bevel=0.003),
        grip(),
    ],
    muzzle=(0, Y, -0.1855),
    scale=1.25,  # a pistol drawn to size is lost in an alien's hand
)

# Shotgun: two barrels side by side, a pump and a stock in its colour, shells on the side.
Y = 0.05
GUNS["shotgun"] = dict(
    parts=[
        tube(-0.06, -0.55, 0.016, "metal", x=-0.017, y=Y),
        tube(-0.06, -0.55, 0.016, "metal", x=0.017, y=Y),
        tube(-0.548, -0.551, 0.011, "bore", x=-0.017, y=Y, seg=12),
        tube(-0.548, -0.551, 0.011, "bore", x=0.017, y=Y, seg=12),
        box((0, Y, -0.47), (0.074, 0.04, 0.03), "metal", bevel=0.006),
        box((0, Y - 0.03, -0.3), (0.062, 0.036, 0.16), "shotgun_accent", bevel=0.01),
        box((0, Y - 0.005, -0.01), (0.062, 0.075, 0.15), "casing", bevel=0.01),
        box((0, Y - 0.02, 0.15), (0.048, 0.07, 0.2), "shotgun_accent", bevel=0.012, rx=-0.12),
        box((0, Y - 0.03, 0.255), (0.05, 0.095, 0.02), "grip", bevel=0.006, rx=-0.12),
        tube(-0.06, -0.02, 0.009, "shotgun_accent", x=0.036, y=Y - 0.01, seg=10),
        tube(-0.02, 0.02, 0.009, "shotgun_accent", x=0.036, y=Y - 0.01, seg=10),
        tube(0.02, 0.06, 0.009, "shotgun_accent", x=0.036, y=Y - 0.01, seg=10),
        grip(z=0.03),
    ],
    muzzle=(0, Y, -0.551),
)

# Rocket launcher: a fat tube in its colour on the shoulder, a flared mouth with a warhead inside, a sight.
Y = 0.075
GUNS["rocket"] = dict(
    parts=[
        tube(0.2, -0.42, 0.062, "rocket_accent", y=Y, seg=20),
        tube(-0.42, -0.5, 0.062, "metal", y=Y, r1=0.085, seg=20),
        tube(-0.497, -0.5, 0.078, "bore", y=Y, seg=20),
        tube(-0.44, -0.5, 0.03, "warhead", y=Y, r1=0.004, seg=12),
        tube(0.2, 0.26, 0.062, "metal", y=Y, r1=0.078, seg=20),
        tube(0.257, 0.26, 0.072, "bore", y=Y, seg=20),
        tube(-0.33, -0.3, 0.067, "metal", y=Y, seg=20),
        tube(0.03, 0.06, 0.067, "metal", y=Y, seg=20),
        box((-0.075, Y + 0.035, -0.12), (0.03, 0.05, 0.11), "casing", bevel=0.008),
        tube(-0.176, -0.18, 0.015, "rocket_accent", x=-0.075, y=Y + 0.04, seg=12),
        box((0, Y - 0.07, -0.05), (0.04, 0.03, 0.18), "casing", bevel=0.008),
        box((0, -0.03, -0.25), (0.03, 0.08, 0.035), "grip", bevel=0.008, rx=0.15),
        grip(z=0.0),
    ],
    muzzle=(0, Y, -0.5),
)

# Minigun: six barrels round a turning spindle with two clamps, a boxy body, a carry handle and an ammo box.
Y = 0.055
GUNS["minigun"] = dict(
    parts=[
        box((0, Y, 0.0), (0.12, 0.12, 0.2), "casing", bevel=0.014),
        box((0, Y + 0.002, -0.03), (0.125, 0.02, 0.17), "minigun_accent", bevel=0.004),
        tube(0.1, 0.17, 0.048, "casing", y=Y, seg=20),
        ring(0.135, 0.048, 0.006, "minigun_accent", y=Y, seg=20, sides=6),
        tube(-0.1, -0.13, 0.05, "metal", y=Y, seg=20),
        box((0.09, Y - 0.02, 0.01), (0.05, 0.1, 0.13), "minigun_accent", bevel=0.01),
        box((0, Y + 0.075, -0.06), (0.018, 0.035, 0.018), "metal", bevel=0.004),
        box((0, Y + 0.075, 0.07), (0.018, 0.035, 0.018), "metal", bevel=0.004),
        box((0, Y + 0.095, 0.005), (0.02, 0.014, 0.16), "grip", bevel=0.005),
        grip(z=0.04),
    ],
    muzzle=(0, Y, -0.5),
    children={
        # Built round its own axis (the node sits on it), so turning it spins the barrels.
        "minigun_spin": dict(at=(0, Y, 0), parts=(
            [tube(-0.12, -0.5, 0.011, "metal", x=0.034 * math.cos(a), y=0.034 * math.sin(a), seg=10)
             for a in [k * math.pi / 3 for k in range(6)]]
            + [tube(-0.497, -0.5, 0.007, "bore", x=0.034 * math.cos(a), y=0.034 * math.sin(a), seg=8)
               for a in [k * math.pi / 3 for k in range(6)]]
            + [tube(-0.12, -0.49, 0.012, "metal", seg=10),
               tube(-0.22, -0.24, 0.052, "metal", seg=6),
               tube(-0.43, -0.45, 0.052, "metal", seg=6),
               ring(-0.33, 0.034, 0.016, "minigun_accent", seg=18, sides=6)])),
    },
)

# Sniper rifle: long and thin, a big scope with a glinting lens, a braked muzzle and a long stock.
Y = 0.04
GUNS["sniper"] = dict(
    parts=[
        tube(-0.12, -0.78, 0.011, "metal", y=Y),
        box((0, Y, -0.79), (0.034, 0.026, 0.05), "metal", bevel=0.005),
        box((0, Y, -0.8148), (0.02, 0.012, 0.002), "bore", bevel=0),
        box((0, Y - 0.006, -0.24), (0.042, 0.042, 0.24), "sniper_accent", bevel=0.01),
        box((0, Y, -0.01), (0.044, 0.052, 0.16), "casing", bevel=0.01),
        tube(-0.2, 0.04, 0.019, "metal", y=Y + 0.065),
        tube(-0.2, -0.26, 0.019, "metal", y=Y + 0.065, r1=0.03),
        tube(-0.257, -0.261, 0.026, "lens", y=Y + 0.065),
        tube(0.04, 0.08, 0.019, "metal", y=Y + 0.065, r1=0.024),
        ring(-0.05, 0.021, 0.004, "sniper_accent", y=Y + 0.065, seg=16, sides=6),
        box((0, Y + 0.038, -0.12), (0.014, 0.03, 0.02), "metal", bevel=0.003),
        box((0, Y + 0.038, 0.0), (0.014, 0.03, 0.02), "metal", bevel=0.003),
        box((0, Y - 0.025, 0.17), (0.038, 0.065, 0.2), "sniper_accent", bevel=0.01, rx=-0.08),
        box((0, Y + 0.012, 0.15), (0.032, 0.018, 0.12), "casing", bevel=0.006),
        box((0, Y - 0.04, 0.275), (0.04, 0.085, 0.018), "grip", bevel=0.005, rx=-0.08),
        grip(z=0.035),
    ],
    muzzle=(0, Y, -0.815),
)

# Railgun: two flat rails with a glowing core and coils between them, a boxy back with a power window.
Y = 0.045
GUNS["railgun"] = dict(
    parts=[
        box((0, Y, 0.03), (0.08, 0.085, 0.2), "casing", bevel=0.014),
        box((0, Y + 0.046, -0.29), (0.05, 0.014, 0.44), "metal", bevel=0.004),
        box((0, Y - 0.046, -0.29), (0.05, 0.014, 0.44), "metal", bevel=0.004),
        box((0, Y + 0.046, -0.29), (0.02, 0.016, 0.4), "railgun_accent", bevel=0.002),
        box((0, Y - 0.046, -0.29), (0.02, 0.016, 0.4), "railgun_accent", bevel=0.002),
        tube(-0.06, -0.5, 0.01, "railgun_accent", y=Y, seg=12),
        box((-0.03, Y, -0.1), (0.008, 0.1, 0.05), "metal", bevel=0.002),
        box((0.03, Y, -0.1), (0.008, 0.1, 0.05), "metal", bevel=0.002),
        box((-0.03, Y, -0.49), (0.008, 0.1, 0.02), "metal", bevel=0.002),
        box((0.03, Y, -0.49), (0.008, 0.1, 0.02), "metal", bevel=0.002),
        *[ring(z, 0.026, 0.007, "railgun_accent", y=Y) for z in (-0.17, -0.25, -0.33, -0.41)],
        box((0, Y + 0.05, 0.06), (0.05, 0.02, 0.09), "railgun_accent", bevel=0.004),
        grip(z=0.04),
    ],
    muzzle=(0, Y, -0.51),
)

# ---- into Blender -----------------------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
to_b = lambda p: (p[0], -p[2], p[1])  # game (x, y, z) -> Blender (x, y, z); the exporter maps it back


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_linear(h):
    return tuple(srgb_to_linear(((h >> s) & 255) / 255) for s in (16, 8, 0))


def material(name, colour, rough, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


MATS = {
    "casing": material("casing", hex_linear(0xd4d8de), 0.45),
    "metal": material("metal", hex_linear(0x3a3f48), 0.35, metal=0.3),
    "grip": material("grip", hex_linear(0x22252b), 0.8),
    "bore": material("bore", (0.004, 0.004, 0.005), 0.9),
    "warhead": material("warhead", hex_linear(0xd8402e), 0.4),
    "lens": material("lens", hex_linear(0x9fd8ff), 0.1, emit=hex_linear(0x3c7aa8)),
}
for name, h in COLORS.items():
    MATS[f"{name}_accent"] = material(f"{name}_accent", hex_linear(h), 0.4, emit=hex_linear(h))


def mesh_object(name, parts, k=1.0):
    verts, faces, smooth, mat_of_face, mat_names = [], [], [], [], []
    for pv, pf, flags, mname in parts:
        if mname not in mat_names:
            mat_names.append(mname)
        base = len(verts)
        verts += [to_b((k * x, k * y, k * z)) for (x, y, z) in pv]
        faces += [tuple(base + i for i in f) for f in pf]
        smooth += flags
        mat_of_face += [mat_names.index(mname)] * len(pf)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for mname in mat_names:
        mesh.materials.append(MATS[mname])
    for poly, mi, sm in zip(mesh.polygons, mat_of_face, smooth):
        poly.material_index = mi
        poly.use_smooth = sm
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


for name, gun in GUNS.items():
    k = gun.get("scale", 1.0)
    root = mesh_object(name, gun["parts"], k)
    for child, spec in gun.get("children", {}).items():
        obj = mesh_object(child, spec["parts"], k)
        obj.parent = root
        obj.location = to_b(tuple(k * c for c in spec["at"]))
    muzzle = bpy.data.objects.new(f"{name}_muzzle", None)
    bpy.context.scene.collection.objects.link(muzzle)
    muzzle.parent = root
    muzzle.location = to_b(tuple(k * c for c in gun["muzzle"]))

bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_yup=True, export_texcoords=False, export_normals=True,
    export_materials="EXPORT", export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_extras=False, use_selection=False,
)
print("weapons written to", args.out)
