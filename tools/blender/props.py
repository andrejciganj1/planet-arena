# The props: the health, fuel and ammo pickups, the launch pad, four rough rocks and the grappling hook. Built from code (no hand
# modelling) and from a fixed noise seed, so a rebuild gives the same file.
#
#   blender -b -P tools/blender/props.py -- --out assets/models/props.glb
#
# Built in game axes (up +y) and turned into Blender's at the end; the glTF exporter turns them back. Nodes:
# `health`, `fuel`, `ammo` (each centred on its origin, within 0.6 m of it: they float 1 m over the ground),
# `pad` (a plate on the ground, its top at +y), `pad_arrow` (along +y from its base, turned by the page to the
# launch direction), `rock_0` to `rock_3` (unit sized: the farthest vertex 0.99 m out, the page scales them),
# and the grappling hook, `hook` and `hook_prong` (see below).
# Materials the page changes: `ammo_accent` takes the weapon's colour, `pad_light` the cue's; `cross`,
# `fuel_glow`, `ammo_accent` and `pad_light` glow (tests/look.test.mjs checks the names and sizes).
import argparse
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="assets/models/props.glb")
args = ap.parse_args(argv)

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


def box(at, size, mat, bevel=0.01, rx=0.0, ry=0.0, segments=1):
    """A box with chamfered edges, centred at `at`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=min(bevel, 0.45 * min(size)),
                        segments=segments, affect="EDGES", profile=0.5)
    place(bm, at, rx, ry)
    return take(bm, mat, lambda n: segments > 1)


def tube(y0, y1, r0, mat, x=0.0, z=0.0, r1=None, seg=24):
    """A capped cylinder (or cone, r0 at y0 to r1 at y1) along y: sides smooth, caps flat."""
    bm = bmesh.new()
    r1 = r0 if r1 is None else r1
    # create_cone builds along z with radius1 at -depth/2; turned to run along y.
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=abs(y1 - y0),
                          matrix=Matrix.Rotation(-math.pi / 2, 4, "X"))
    if y1 < y0:
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi, 4, "X"), verts=bm.verts)
    place(bm, (x, (y0 + y1) / 2, z))
    return take(bm, mat, lambda n: abs(n.y) < 0.9)


def ring(y, major, minor, mat, seg=32, sides=8, x=0.0, z=0.0, arc=2 * math.pi):
    """A torus round the y axis (or part of one, `arc` radians of it)."""
    bm = bmesh.new()
    closed = arc >= 2 * math.pi - 1e-6
    n = seg if closed else seg + 1
    vs = []
    for j in range(n):
        ph = arc * j / seg
        for k in range(sides):
            th = 2 * math.pi * k / sides
            rr = major + minor * math.cos(th)
            vs.append(bm.verts.new((rr * math.cos(ph), minor * math.sin(th), rr * math.sin(ph))))
    for j in range(seg):
        for k in range(sides):
            j1 = (j + 1) % n
            a, b = j * sides + k, j1 * sides + k
            c, d = j1 * sides + (k + 1) % sides, j * sides + (k + 1) % sides
            bm.faces.new((vs[a], vs[b], vs[c], vs[d]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    place(bm, (x, y, z))
    return take(bm, mat, lambda n: True)


# ---- the pickups --------------------------------------------------------------------------------------------

PROPS = {}

# Health: a white case with a red cross on both faces (it turns), rounded corners, a carry handle and latches.
W, H, D = 0.62, 0.42, 0.24
health = [
    box((0, 0, 0), (W, H, D), "case", bevel=0.05, segments=3),
    box((0, 0, 0), (W + 0.012, 0.035, D + 0.012), "trim", bevel=0.01),  # the seam round the middle
]
# The handle: a half torus, built lying in the xz plane, stood up over the lid.
hv, hf, hs, hm = ring(0, 0.1, 0.022, "trim", seg=12, sides=6, arc=math.pi)
health.append(([(x, z + H / 2, y) for (x, y, z) in hv], hf, hs, hm))
for sz in (-1, 1):
    health += [
        box((0, 0.012, sz * (D / 2 + 0.008)), (0.26, 0.08, 0.02), "cross", bevel=0.008),
        box((0, 0.012, sz * (D / 2 + 0.008)), (0.08, 0.26, 0.02), "cross", bevel=0.008),
    ]
    for sx in (-1, 1):
        health.append(box((sx * 0.2, H / 2 - 0.03, sz * (D / 2 + 0.004)), (0.06, 0.05, 0.016), "trim", bevel=0.006))
PROPS["health"] = health

# Fuel: an orange canister with dark bands, a glowing gauge window down two sides, a cap and a grip ring.
R, HH = 0.19, 0.29
PROPS["fuel"] = [
    tube(-HH, HH, R, "fuel"),
    tube(HH, HH + 0.05, R, "fuel", r1=R * 0.55),
    tube(-HH - 0.03, -HH, R * 0.9, "metal", r1=R),
    tube(-0.17, -0.12, R + 0.012, "metal"),
    tube(0.12, 0.17, R + 0.012, "metal"),
    tube(HH + 0.05, HH + 0.11, 0.055, "metal", seg=12),
    tube(HH + 0.11, HH + 0.13, 0.065, "fuel_glow", seg=12),
    ring(HH + 0.06, 0.15, 0.018, "metal", seg=20, sides=6),
    box((R - 0.01, 0, 0), (0.035, 0.2, 0.07), "fuel_glow", bevel=0.01),
    box((-R + 0.01, 0, 0), (0.035, 0.2, 0.07), "fuel_glow", bevel=0.01),
]

# Ammo: a dark crate with metal corners, a band in the weapon's colour round it and a glowing strip on the lid.
CW, CH, CD = 0.5, 0.32, 0.36
ammo = [
    box((0, 0, 0), (CW, CH, CD), "crate", bevel=0.025, segments=2),
    box((0, 0, 0), (CW + 0.014, 0.09, CD + 0.014), "ammo_accent", bevel=0.01),
    box((0, CH / 2 + 0.004, 0), (CW * 0.7, 0.02, 0.06), "ammo_accent", bevel=0.006),
    box((0, CH / 2 + 0.03, 0), (0.18, 0.025, 0.05), "metal", bevel=0.008),
]
for sx in (-1, 1):
    for sy in (-1, 1):
        for sz in (-1, 1):
            ammo.append(box((sx * (CW / 2 - 0.02), sy * (CH / 2 - 0.02), sz * (CD / 2 - 0.02)), (0.07, 0.07, 0.07),
                            "metal", bevel=0.012))
PROPS["ammo"] = ammo

# ---- the pad: a metal launch plate on the ground, its lights showing the cue -------------------------------

pad = [
    tube(-0.04, 0.12, 1.22, "pad_metal", r1=1.1, seg=40),
    tube(0.12, 0.15, 0.98, "pad_dark", seg=40),
    tube(0.15, 0.2, 0.42, "pad_metal", r1=0.36, seg=32),
    tube(0.2, 0.215, 0.3, "pad_light", seg=32),
    ring(0.13, 1.03, 0.025, "pad_light", seg=48, sides=6),
]
# Eight light bars round the plate, pointing out, and bolts between them.
for k in range(8):
    a = 2 * math.pi * k / 8
    pad.append(box((0.7 * math.cos(a), 0.16, 0.7 * math.sin(a)), (0.32, 0.03, 0.07), "pad_light", bevel=0.01, ry=-a))
    b = a + math.pi / 8
    pad.append(tube(0.12, 0.15, 0.035, "metal", x=1.12 * math.cos(b), z=1.12 * math.sin(b), seg=8))
PROPS["pad"] = pad

# The arrow over the pad, pointing the launch way: a shaft and a head.
PROPS["pad_arrow"] = [
    tube(0.0, 0.55, 0.07, "pad_light", seg=12),
    tube(0.55, 0.95, 0.22, "pad_light", r1=0.0, seg=16),
]

# ---- rocks: an icosphere pushed in and out by noise, stretched, and scaled to just inside 1 m ---------------


def rock(seed, stretch):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    off = Vector((seed * 17.3, seed * 5.1, seed * 11.7))
    for v in bm.verts:
        p = v.co.normalized()
        # Broad lumps, a little grit, and a few dents (craters) where a second noise is high.
        lump = noise.noise(p * 1.3 + off) * 0.18 + noise.noise(p * 3.1 + off) * 0.07
        dent = max(0.0, noise.noise(p * 2.2 - off) - 0.25) * 0.35
        v.co = Vector((p.x * stretch[0], p.y * stretch[1], p.z * stretch[2])) * (1.0 + lump - dent)
    far = max(v.co.length for v in bm.verts) / 0.99  # just inside 1, past float rounding
    for v in bm.verts:
        v.co /= far
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return take(bm, "rock", lambda n: True)


noise.seed_set(7)
ROCKS = [(1, (1.0, 0.85, 0.9)), (2, (1.0, 0.82, 0.86)), (3, (0.88, 0.92, 1.0)), (4, (1.0, 0.88, 0.8))]
for i, (seed, stretch) in enumerate(ROCKS):
    PROPS[f"rock_{i}"] = [rock(seed, stretch)]

# The grappling hook: `hook` is the nose, crown, shank and rope collar along +y (it flies nose first, the rope
# trailing from the collar); `hook_prong` one prong, pivoting at its origin, folded back along -y with its claw out
# along +z. The page sets three round the crown and swings them open on a catch.
PROPS["hook"] = [
    tube(0.0, 0.11, 0.034, "pad_metal", r1=0.006),
    tube(-0.035, 0.0, 0.04, "trim"),
    tube(-0.42, -0.035, 0.016, "pad_metal"),
    tube(-0.47, -0.42, 0.03, "trim"),
]
PROPS["hook_prong"] = [
    box((0, -0.14, 0.0), (0.024, 0.28, 0.024), "pad_metal", bevel=0.006),
    box((0, -0.275, 0.045), (0.022, 0.022, 0.1), "pad_metal", bevel=0.006),
    box((0, -0.25, 0.092), (0.018, 0.06, 0.018), "pad_metal", bevel=0.005),
]

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
    "case": material("case", hex_linear(0xf2f2ee), 0.4),
    "trim": material("trim", hex_linear(0x8d939c), 0.4, metal=0.3),
    "cross": material("cross", hex_linear(0xe0312b), 0.4, emit=hex_linear(0xe0312b)),
    "fuel": material("fuel", hex_linear(0xf0862a), 0.45),
    "fuel_glow": material("fuel_glow", hex_linear(0xffd25a), 0.3, emit=hex_linear(0xffc040)),
    "crate": material("crate", hex_linear(0x3a3f47), 0.6),
    # White, so the page's weapon colour shows true.
    "ammo_accent": material("ammo_accent", (1.0, 1.0, 1.0), 0.4, emit=(1.0, 1.0, 1.0)),
    "metal": material("metal", hex_linear(0x585e68), 0.35, metal=0.4),
    "pad_metal": material("pad_metal", hex_linear(0x9aa1ab), 0.35, metal=0.5),
    "pad_dark": material("pad_dark", hex_linear(0x2a2e35), 0.6, metal=0.3),
    "pad_light": material("pad_light", (1.0, 1.0, 1.0), 0.3, emit=(1.0, 1.0, 1.0)),
    "rock": material("rock", hex_linear(0x5a524c), 0.95),
}


def mesh_object(name, parts):
    verts, faces, smooth, mat_of_face, mat_names = [], [], [], [], []
    for pv, pf, flags, mname in parts:
        if mname not in mat_names:
            mat_names.append(mname)
        base = len(verts)
        verts += [to_b(p) for p in pv]
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


for name, parts in PROPS.items():
    mesh_object(name, parts)

bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", export_yup=True, export_texcoords=False, export_normals=True,
    export_materials="EXPORT", export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_extras=False, use_selection=False,
)
print("props written to", args.out)
