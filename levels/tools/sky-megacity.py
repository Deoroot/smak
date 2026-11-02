# New Byzantium's sky in Blender: a procedural megacity under a toxic red storm, rendered as the six faces of a
# GoldSrc sky. Run by levels/tools/sky.mjs through SMAK's runBlenderJob (src/blender.mjs); never by hand.
#
# Job (JSON): { seed, size, samples, eye, density, faces: [{ suffix, forward, right, up }] }. The faces' ways are
# GoldSrc's axes (x forward, y left, z up), which are Blender's too: a camera of 90 degrees per face, looking
# along `forward`, `right` to the picture's right, `up` to its top. Each face is written as face_<suffix>.png.
#
# Everything is made here, from the seed: no picture, no asset. Every surface is an emission whose colour is
# its own (lit windows from a grid in the shader, dark concrete, steel) mixed into one fog: an exponential
# height fog computed in each material from the eye's position, with the same colour of air the world shows,
# so the far city melts into the sky with no edge. Nothing depends on the screen (no bloom, no screen-space
# effect), so the six faces meet with no seam.
import math
import random

import bpy
from mathutils import Matrix, Vector

from blender_job import read_job, write_result, out_path, say

job = read_job()
SEED = int(job.get("seed", 1))
SIZE = int(job.get("size", 1024))
SAMPLES = int(job.get("samples", 32))
EYE = float(job.get("eye", 41.0))
DENSITY = float(job.get("density", 1.0))
CAM = Vector((0.0, 0.0, EYE))
rng = random.Random(SEED)

# the air: fog density at the ground (per metre) and how fast it thins with height (metres)
FOG_DENSITY = 0.00042
FOG_HEIGHT = 650.0
# and a thick haze in the streets, glowing with the city's light, thinning fast with height
HAZE_DENSITY = 0.004
HAZE_HEIGHT = 70.0
HAZE_GLOW = (0.34, 0.16, 0.075)
# the storm's underside: the cloud deck's height; the city above it is lost in the storm
STORM_BASE = 1700.0
# where the skylift stands: its yaw (degrees, from +x toward +y) and distance
LIFT_YAW = -62.0 + rng.uniform(-6, 6)
LIFT_DIST = 6500.0

# ── the scene ───────────────────────────────────────────────────────────────

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
ee = scene.eevee
for attr, value in (("taa_render_samples", SAMPLES), ("use_shadows", False), ("use_raytracing", False),
                    ("use_gtao", False), ("use_bloom", False), ("use_volumetric_shadows", False)):
    if hasattr(ee, attr):
        try:
            setattr(ee, attr, value)
        except Exception:
            pass
for wanted in ("AgX", "Filmic", "Standard"):
    try:
        scene.view_settings.view_transform = wanted
        break
    except TypeError:
        continue
try:
    scene.view_settings.look = "AgX - Medium High Contrast" if scene.view_settings.view_transform == "AgX" else "None"
except TypeError:
    pass
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0


# ── node helpers ────────────────────────────────────────────────────────────

class Tree:
    """A node tree with short ways to add nodes and links; values or sockets are taken alike."""

    def __init__(self, tree):
        self.t = tree
        self.n = tree.nodes
        self.l = tree.links

    def node(self, kind, **props):
        node = self.n.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def put(self, sock, value):
        if hasattr(value, "is_output") or hasattr(value, "links"):
            self.l.new(value, sock)
        else:
            if isinstance(value, (tuple, list, Vector)) and len(value) == 3:
                try:
                    if len(sock.default_value) == 4:
                        value = (*value, 1.0)
                except TypeError:
                    pass
            sock.default_value = value

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        node = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.put(node.inputs[0], a)
        self.put(node.inputs[1], b)
        if len(node.inputs) > 2:
            self.put(node.inputs[2], c)
        return node.outputs[0]

    def vmath(self, op, a, b=(0, 0, 0), scale=None):
        node = self.node("ShaderNodeVectorMath", operation=op)
        self.put(node.inputs[0], a)
        self.put(node.inputs[1], b)
        if scale is not None:
            self.put(node.inputs["Scale"], scale)
        out = node.outputs["Value"] if op in ("LENGTH", "DOT_PRODUCT", "DISTANCE") else node.outputs["Vector"]
        return out

    def mix(self, fac, a, b):
        node = self.node("ShaderNodeMix", data_type="RGBA")
        self.put(node.inputs["Factor"], fac)
        self.put(node.inputs[6], a)
        self.put(node.inputs[7], b)
        return node.outputs[2]

    def mixv(self, fac, a, b, blend="MIX"):
        node = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.put(node.inputs["Factor"], fac)
        self.put(node.inputs[6], a)
        self.put(node.inputs[7], b)
        return node.outputs[2]

    def sep(self, v):
        node = self.node("ShaderNodeSeparateXYZ")
        self.put(node.inputs[0], v)
        return node.outputs

    def comb(self, x, y, z):
        node = self.node("ShaderNodeCombineXYZ")
        self.put(node.inputs[0], x)
        self.put(node.inputs[1], y)
        self.put(node.inputs[2], z)
        return node.outputs[0]

    def ramp(self, fac, stops):
        node = self.node("ShaderNodeValToRGB")
        els = node.color_ramp.elements
        while len(els) > 1:
            els.remove(els[-1])
        els[0].position = stops[0][0]
        els[0].color = (*stops[0][1], 1.0)
        for pos, col in stops[1:]:
            e = els.new(pos)
            e.color = (*col, 1.0)
        self.put(node.inputs[0], fac)
        return node.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dims="3D", w=0.0):
        node = self.node("ShaderNodeTexNoise", noise_dimensions=dims)
        self.put(node.inputs["Vector"], vec)
        self.put(node.inputs["Scale"], scale)
        self.put(node.inputs["Detail"], detail)
        self.put(node.inputs["Roughness"], rough)
        if dims == "4D":
            self.put(node.inputs["W"], w)
        return node.outputs["Fac"]

    def white(self, vec, w, dims="4D"):
        node = self.node("ShaderNodeTexWhiteNoise", noise_dimensions=dims)
        self.put(node.inputs["Vector"], vec)
        if dims == "4D":
            self.put(node.inputs["W"], w)
        return node.outputs["Value"], node.outputs["Color"]


SEED_W = (SEED * 7.31) % 97.0
SEED_V = Vector((rng.uniform(0, 500), rng.uniform(0, 500), rng.uniform(0, 500)))


def air_colour(T, direction):
    """The colour of the air along a way out of the eye: dark down, a grey-orange glow at the horizon with fires
    showing through it in places, the red storm above. Shared by the world and every material's fog."""
    d = T.vmath("NORMALIZE", direction)
    x, y, z = T.sep(d)
    e = T.math("MULTIPLY_ADD", z, 0.5, 0.5)
    base = T.ramp(e, [
        (0.0, (0.004, 0.0025, 0.002)),
        (0.36, (0.012, 0.006, 0.004)),
        (0.47, (0.09, 0.04, 0.022)),
        (0.5, (0.30, 0.135, 0.062)),
        (0.525, (0.20, 0.075, 0.04)),
        (0.58, (0.085, 0.022, 0.014)),
        (0.72, (0.035, 0.007, 0.006)),
        (1.0, (0.012, 0.003, 0.003)),
    ])
    # fires far off: the horizon brighter and warmer where noise round the circle says so
    ring = T.comb(x, y, 0.0)
    fire = T.noise(T.vmath("ADD", T.vmath("SCALE", ring, scale=2.2), SEED_V), 1.0, 3.0, 0.5)
    fire = T.math("POWER", T.math("SUBTRACT", fire, 0.35, clamp=True), 1.6)
    near_h = T.math("EXPONENT", T.math("MULTIPLY", T.math("ABSOLUTE", T.math("SUBTRACT", z, 0.04)), -9.0))
    glow = T.math("MULTIPLY", T.math("MULTIPLY", fire, near_h), 4.0)
    return T.mixv(glow, base, (0.9, 0.32, 0.08), "ADD")


def fog_amount(T, pos, density=None, height=None):
    """How much of the air lies between the eye and `pos`, 0 to 1: an exponential height fog, its density
    falling with height, integrated along the line exactly."""
    density = FOG_DENSITY if density is None else density
    height = FOG_HEIGHT if height is None else height
    rel = T.vmath("SUBTRACT", pos, tuple(CAM))
    dist = T.vmath("LENGTH", rel)
    pz = T.math("MAXIMUM", T.sep(pos)[2], 0.0)
    a = T.math("DIVIDE", T.math("SUBTRACT", pz, EYE), height)
    up = T.math("MAXIMUM", a, 1e-4)
    down = T.math("MINIMUM", a, -1e-4)
    a = T.math("MULTIPLY_ADD", T.math("GREATER_THAN", a, 0.0), T.math("SUBTRACT", up, down), down)
    # the mean density along the line: exp(-z0/H) (1 - exp(-a)) / a
    g = T.math("DIVIDE", T.math("SUBTRACT", 1.0, T.math("EXPONENT", T.math("MULTIPLY", a, -1.0))), a)
    mean = T.math("MULTIPLY", g, density * math.exp(-EYE / height))
    return T.math("SUBTRACT", 1.0, T.math("EXPONENT", T.math("MULTIPLY", T.math("MULTIPLY", dist, mean), -1.0))), rel


def haze_colour(T, rel):
    """The street haze's colour: the city's glow, dark where the way looks steeply down (the down face)."""
    z = T.sep(T.vmath("NORMALIZE", rel))[2]
    lit = T.node("ShaderNodeMapRange", clamp=True)
    T.put(lit.inputs["Value"], z)
    T.put(lit.inputs["From Min"], -0.4)
    T.put(lit.inputs["From Max"], -0.03)
    # and dimmer as the way climbs: the glow lies low, over the streets
    up = T.node("ShaderNodeMapRange", clamp=True)
    T.put(up.inputs["Value"], z)
    T.put(up.inputs["From Min"], 0.04)
    T.put(up.inputs["From Max"], 0.45)
    glow = T.math("MULTIPLY", T.math("POWER", lit.outputs["Result"], 1.5),
                  T.math("SUBTRACT", 1.0, T.math("MULTIPLY", up.outputs["Result"], 0.85)))
    return T.mixv(glow, (0.006, 0.003, 0.0025), HAZE_GLOW, "MIX")


def fogged(T, surface, storm=0.97):
    """`surface` (a colour) seen through the street haze, then the air, between the eye and the shaded point."""
    geo = T.node("ShaderNodeNewGeometry")
    pos = geo.outputs["Position"]
    haze, rel = fog_amount(T, pos, HAZE_DENSITY, HAZE_HEIGHT)
    fog, _ = fog_amount(T, pos)
    c = T.mix(haze, surface, haze_colour(T, rel))
    lost = T.node("ShaderNodeMapRange", clamp=True, interpolation_type="SMOOTHSTEP")
    T.put(lost.inputs["Value"], T.sep(pos)[2])
    T.put(lost.inputs["From Min"], STORM_BASE * 0.55)
    T.put(lost.inputs["From Max"], STORM_BASE * 1.05)
    fog = T.math("MAXIMUM", fog, T.math("MULTIPLY", lost.outputs["Result"], storm))
    return T.mix(fog, c, air_colour(T, rel))


def material(name, build, method="DITHERED"):
    """A material whose node tree `build(T)` fills; it returns the shader socket to output."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    T = Tree(mat.node_tree)
    T.n.clear()
    out = T.node("ShaderNodeOutputMaterial")
    T.put(out.inputs["Surface"], build(T))
    try:
        mat.surface_render_method = method
    except Exception:
        pass
    return mat


def emission(T, colour, strength=1.0):
    node = T.node("ShaderNodeEmission")
    T.put(node.inputs["Color"], colour)
    T.put(node.inputs["Strength"], strength)
    return node.outputs[0]


def attr(T, name):
    node = T.node("ShaderNodeAttribute", attribute_name=name)
    try:
        node.attribute_type = "GEOMETRY"
    except Exception:
        pass
    return node.outputs["Fac"]


# ── materials ───────────────────────────────────────────────────────────────

def facade(T):
    """Dark concrete with a grid of windows, a share lit (amber, sodium, a few cold and red), floors dark in
    bands; the share, the pitch and the colours vary by building (`rnd`); roofs (`roof`) have no windows."""
    uv = T.node("ShaderNodeUVMap", uv_map="UVMap").outputs[0]
    u, v, _ = T.sep(uv)
    rnd = attr(T, "rnd")
    roof = attr(T, "roof")
    pitch_u = T.math("MULTIPLY_ADD", rnd, 1.4, 2.2)
    pitch_v = T.math("MULTIPLY_ADD", T.math("FRACT", T.math("MULTIPLY", rnd, 7.0)), 0.8, 3.1)
    cu = T.math("DIVIDE", u, pitch_u)
    cv = T.math("DIVIDE", v, pitch_v)
    iu = T.math("FLOOR", cu)
    iv = T.math("FLOOR", cv)
    fu = T.math("FRACT", cu)
    fv = T.math("FRACT", cv)
    win = T.math("MULTIPLY",
                 T.math("MULTIPLY", T.math("GREATER_THAN", fu, 0.18), T.math("LESS_THAN", fu, 0.82)),
                 T.math("MULTIPLY", T.math("GREATER_THAN", fv, 0.28), T.math("LESS_THAN", fv, 0.82)))
    cell = T.comb(iu, iv, T.math("MULTIPLY", rnd, 1000.0))
    val, col = T.white(cell, SEED_W)
    floor_val, _ = T.white(T.comb(0.0, iv, T.math("MULTIPLY", rnd, 1000.0)), SEED_W + 3.0)
    share = attr(T, "share")
    floor_on = T.math("GREATER_THAN", floor_val, 0.22)
    lit = T.math("MULTIPLY", T.math("LESS_THAN", val, share), floor_on)
    lit = T.math("MULTIPLY", T.math("MULTIPLY", lit, win), T.math("SUBTRACT", 1.0, roof))
    hue = T.sep(col)[0]
    tint = T.ramp(hue, [
        (0.0, (1.0, 0.42, 0.12)),
        (0.45, (1.0, 0.62, 0.25)),
        (0.78, (1.0, 0.78, 0.45)),
        (0.9, (0.55, 0.75, 1.0)),
        (0.96, (1.0, 0.15, 0.08)),
    ])
    bright = T.math("MULTIPLY_ADD", T.sep(col)[1], 2.6, 1.4)
    windows = T.vmath("SCALE", tint, scale=T.math("MULTIPLY", lit, bright))
    # the wall: near black, a red cast from the storm on the roofs, the haze's glow low down
    geo = T.node("ShaderNodeNewGeometry")
    nz = T.sep(geo.outputs["Normal"])[2]
    pz = T.sep(geo.outputs["Position"])[2]
    low = T.math("EXPONENT", T.math("DIVIDE", pz, -260.0))
    wall = T.mixv(T.math("MULTIPLY", low, 0.6), (0.010, 0.008, 0.008), (0.06, 0.03, 0.018), "MIX")
    wall = T.mixv(T.math("MULTIPLY", T.math("MAXIMUM", nz, 0.0), 0.7), wall, (0.07, 0.012, 0.01), "MIX")
    surface = T.vmath("ADD", wall, windows)
    return emission(T, fogged(T, surface))


def steel(T):
    """The mega-structure's frames: black steel with a red edge from the storm above and beacon-less."""
    geo = T.node("ShaderNodeNewGeometry")
    nz = T.sep(geo.outputs["Normal"])[2]
    s = T.mixv(T.math("MAXIMUM", nz, 0.0), (0.008, 0.006, 0.006), (0.09, 0.02, 0.014), "MIX")
    return emission(T, fogged(T, s))


def lamp(colour, strength):
    def build(T):
        return emission(T, fogged(T, tuple(c * strength for c in colour)))
    return build


def fire(T):
    """Burning: orange to yellow, broken by noise."""
    geo = T.node("ShaderNodeNewGeometry")
    n = T.noise(geo.outputs["Position"], 0.08, 5.0, 0.6)
    c = T.ramp(n, [(0.25, (0.5, 0.06, 0.0)), (0.5, (3.0, 0.8, 0.12)), (0.75, (6.0, 2.6, 0.6))])
    return emission(T, fogged(T, T.vmath("SCALE", c, scale=2.0)))


def additive(T, colour, alpha):
    """Light added to what is behind (beams, rain, glow): transparent plus an emission."""
    tr = T.node("ShaderNodeBsdfTransparent")
    em = emission(T, colour, alpha)
    add = T.node("ShaderNodeAddShader")
    T.put(add.inputs[0], tr.outputs[0])
    T.put(add.inputs[1], em)
    return add.outputs[0]


def blended(T, colour, alpha):
    """A see-through surface: `colour` over what is behind by `alpha`."""
    tr = T.node("ShaderNodeBsdfTransparent")
    em = emission(T, colour, 1.0)
    m = T.node("ShaderNodeMixShader")
    T.put(m.inputs[0], alpha)
    T.put(m.inputs[1], tr.outputs[0])
    T.put(m.inputs[2], em)
    return m.outputs[0]


def beam(T):
    """A searchlight's cone: brightest along its axis and near its foot, gone by its end."""
    tc = T.node("ShaderNodeTexCoord")
    gz = T.sep(tc.outputs["Generated"])[2]
    lw = T.node("ShaderNodeLayerWeight")
    T.put(lw.inputs["Blend"], 0.5)
    facing = T.math("POWER", T.math("SUBTRACT", 1.0, lw.outputs["Facing"]), 3.0)
    along = T.math("POWER", T.math("SUBTRACT", 1.0, gz, clamp=True), 2.2)
    a = T.math("MULTIPLY", T.math("MULTIPLY", facing, along), 0.35)
    geo = T.node("ShaderNodeNewGeometry")
    fog, _ = fog_amount(T, geo.outputs["Position"])
    a = T.math("MULTIPLY", a, T.math("SUBTRACT", 1.0, T.math("MULTIPLY", fog, 0.8)))
    return additive(T, (1.0, 0.8, 0.6), a)


def clouds(level, scale, cover, lit):
    """A storm deck: red cloud lit from below by the city, see-through between its masses, a flash here and
    there; fogged by its distance so the far deck melts into the horizon."""
    def build(T):
        geo = T.node("ShaderNodeNewGeometry")
        pos = geo.outputs["Position"]
        p = T.vmath("ADD", T.vmath("MULTIPLY", pos, (1.0, 1.0, 0.0)), tuple(SEED_V * (37 + level)))
        warp = T.noise(T.vmath("SCALE", p, scale=scale * 0.25), 1.0, 2.0, 0.5)
        p2 = T.vmath("ADD", p, T.comb(T.math("MULTIPLY", warp, 900.0), 0.0, 0.0))
        n = T.noise(T.vmath("SCALE", p2, scale=scale), 1.0, 8.0, 0.62)
        dense = T.math("MULTIPLY", T.math("SUBTRACT", n, 1.0 - cover, clamp=True), 3.5, clamp=True)
        dense = T.math("MINIMUM", dense, 1.0)
        shade = T.ramp(n, [(0.35, (0.012, 0.003, 0.003)), (0.55, (0.10, 0.018, 0.012)),
                           (0.7, (0.28 * lit, 0.06 * lit, 0.03 * lit)), (0.85, (0.55 * lit, 0.16 * lit, 0.06 * lit))])
        # flashes in the storm
        f = T.noise(T.vmath("SCALE", p, scale=scale * 0.6), 1.0, 1.0, 0.5, "4D", SEED_W + level)
        flash = T.math("POWER", T.math("MULTIPLY", T.math("SUBTRACT", f, 0.71, clamp=True), 8.0), 2.0)
        shade = T.mixv(T.math("MULTIPLY", flash, n), shade, (1.4, 0.55, 0.7), "ADD")
        # the fog over the deck, as for the city, but by distance alone (the deck is high)
        rel = T.vmath("SUBTRACT", pos, tuple(CAM))
        dist = T.vmath("LENGTH", rel)
        fog = T.math("SUBTRACT", 1.0, T.math("EXPONENT", T.math("MULTIPLY", dist, -0.000035)))
        c = T.mix(fog, shade, air_colour(T, rel))
        a = T.math("MAXIMUM", dense, T.math("MULTIPLY", fog, 0.85))
        return blended(T, c, T.math("MINIMUM", a, 1.0))
    return build


radius_low = 25.0


def rain(T):
    """Rain on a shell round the eye: thin slanting streaks, faint, added."""
    tc = T.node("ShaderNodeTexCoord")
    p = tc.outputs["Object"]
    x, y, z = T.sep(p)
    q = T.comb(T.math("MULTIPLY_ADD", z, 0.18, x), y, T.math("MULTIPLY", z, 0.006))
    n = T.noise(q, 2.5, 0.0, 0.5)
    w, _ = T.white(T.comb(T.math("FLOOR", T.math("MULTIPLY", x, 3.0)), T.math("FLOOR", T.math("MULTIPLY", y, 3.0)), 0.0), SEED_W + 9.0)
    streak = T.math("MULTIPLY", T.math("GREATER_THAN", n, 0.70), T.math("GREATER_THAN", w, 0.55))
    # seen against the glowing haze, not against the dark below
    band = T.node("ShaderNodeMapRange", clamp=True)
    T.put(band.inputs["Value"], z)
    T.put(band.inputs["From Min"], -radius_low)
    T.put(band.inputs["From Max"], 0.0)
    top = T.node("ShaderNodeMapRange", clamp=True)
    T.put(top.inputs["Value"], z)
    T.put(top.inputs["From Min"], radius_low * 2.0)
    T.put(top.inputs["From Max"], radius_low * 0.5)
    a = T.math("MULTIPLY", T.math("MULTIPLY", streak, 0.07), T.math("MULTIPLY", band.outputs["Result"], top.outputs["Result"]))
    return additive(T, (0.9, 0.62, 0.45), a)


def tether(T):
    """The skylift's cable: a pale line, beaded with lights, climbing out of the storm."""
    geo = T.node("ShaderNodeNewGeometry")
    pz = T.sep(geo.outputs["Position"])[2]
    beads = T.math("LESS_THAN", T.math("FRACT", T.math("DIVIDE", pz, 420.0)), 0.06)
    c = T.mixv(beads, (1.1, 0.9, 0.85), (6.0, 3.4, 2.4), "MIX")
    return emission(T, fogged(T, c, 0.3))


# ── geometry: boxes and prisms into one mesh ───────────────────────────────

class Boxes:
    """Boxes and prisms gathered into one mesh: corners, faces, a UV in metres on each face (u along the wall,
    v up), and three face attributes: `rnd` (the building's number, 0 to 1), `roof` (1 on top and bottom faces)
    and `share` (how many of its windows are lit)."""

    def __init__(self):
        self.verts, self.faces, self.uvs, self.rnd, self.roof, self.share = [], [], [], [], [], []

    def _face(self, idx, uvs, rnd, top, share):
        self.faces.append(tuple(idx))
        self.uvs += uvs
        self.rnd.append(rnd)
        self.roof.append(float(top))
        self.share.append(share)

    def box(self, centre, size, yaw=0.0, rnd=0.0, bottom=False, axes=None, share=0.2):
        cx, cy, cz = centre
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        if axes is None:
            c, s = math.cos(yaw), math.sin(yaw)
            axes = (Vector((c, s, 0)), Vector((-s, c, 0)), Vector((0, 0, 1)))
        ax, ay, az = axes
        o = Vector((cx, cy, cz))
        base = len(self.verts)
        for k in range(8):
            dx = sx if k & 1 else -sx
            dy = sy if k & 2 else -sy
            dz = sz if k & 4 else -sz
            self.verts.append(tuple(o + ax * dx + ay * dy + az * dz))
        u0 = rnd * 97.0
        z0 = cz - sz
        # (corner indices, u length, v length, is top)
        quads = [((0, 1, 5, 4), size[0], size[2], 0), ((1, 3, 7, 5), size[1], size[2], 0),
                 ((3, 2, 6, 7), size[0], size[2], 0), ((2, 0, 4, 6), size[1], size[2], 0),
                 ((4, 5, 7, 6), size[0], size[1], 1)]
        if bottom:
            quads.append(((0, 2, 3, 1), size[0], size[1], 1))
        for idx, ul, vl, top in quads:
            if top:
                uvs = [(0, 0), (ul, 0), (ul, vl), (0, vl)]
            else:
                uvs = [(u0, z0), (u0 + ul, z0), (u0 + ul, z0 + vl), (u0, z0 + vl)]
                u0 += ul
            self._face([base + i for i in idx], uvs, rnd, top, share)

    def prism(self, x, y, z0, h, rx, ry, sides, yaw=0.0, rnd=0.0, share=0.2, chamfer=None):
        """An upright prism: round (many sides), an octagon, or a box with its corners cut (`chamfer`, 0 to 0.5
        of the side). rx, ry: half its width and depth."""
        c, s = math.cos(yaw), math.sin(yaw)
        ring = []
        if chamfer is not None:
            k = chamfer
            for px, py in ((1, 1 - k), (1 - k, 1), (-(1 - k), 1), (-1, 1 - k), (-1, -(1 - k)), (-(1 - k), -1),
                           (1 - k, -1), (1, -(1 - k))):
                ring.append((px * rx, py * ry))
        else:
            for i in range(sides):
                a = 2 * math.pi * (i + 0.5) / sides
                ring.append((math.cos(a) * rx, math.sin(a) * ry))
        ring = [(x + px * c - py * s, y + px * s + py * c) for px, py in ring]
        n = len(ring)
        base = len(self.verts)
        for px, py in ring:
            self.verts.append((px, py, z0))
        for px, py in ring:
            self.verts.append((px, py, z0 + h))
        u = rnd * 97.0
        for i in range(n):
            j = (i + 1) % n
            seg = math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1])
            self._face([base + i, base + j, base + n + j, base + n + i],
                       [(u, z0), (u + seg, z0), (u + seg, z0 + h), (u, z0 + h)], rnd, 0, share)
            u += seg
        self._face([base + n + i for i in range(n)], [(px, py) for px, py in ring], rnd, 1, share)

    def object(self, name, mat):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        uv = mesh.uv_layers.new(name="UVMap")
        flat = [c for pair in self.uvs for c in pair]
        uv.data.foreach_set("uv", flat)
        for aname, values in (("rnd", self.rnd), ("roof", self.roof), ("share", self.share)):
            a = mesh.attributes.new(aname, "FLOAT", "FACE")
            a.data.foreach_set("value", values)
        mesh.materials.append(mat)
        ob = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(ob)
        return ob


def beam_box(boxes, a, b, thick, rnd=0.0):
    """A beam from point a to point b, `thick` square."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    az = d.normalized()
    ref = Vector((0, 0, 1)) if abs(az.z) < 0.9 else Vector((1, 0, 0))
    ax = az.cross(ref).normalized()
    ay = az.cross(ax).normalized()
    boxes.box(tuple((a + b) / 2), (thick, thick, length), rnd=rnd, axes=(ax, ay, az), bottom=True)


def truss(boxes, a, b, depth, thick, bays):
    """A flat upright truss from a to b: two chords `depth` apart, posts and diagonals in `bays` bays."""
    a, b = Vector(a), Vector(b)
    up = Vector((0, 0, depth))
    bot = [a + (b - a) * (i / bays) for i in range(bays + 1)]
    top = [p + up for p in bot]
    beam_box(boxes, bot[0], bot[-1], thick)
    beam_box(boxes, top[0], top[-1], thick)
    for i in range(bays + 1):
        beam_box(boxes, bot[i], top[i], thick * 0.7)
        if i < bays:
            beam_box(boxes, bot[i] if i % 2 == 0 else top[i], top[i + 1] if i % 2 == 0 else bot[i + 1], thick * 0.5)


# ── the city ────────────────────────────────────────────────────────────────
# The eye stands in a street of L3; round it, past the playable city (some 200 m out), the mega-structure:
# megablocks hundreds of metres to kilometres tall, the near ones rising past the top of the side faces and
# into the storm, lit walls behind them, haze beyond. A few avenues stay open (one toward the skylift), so the
# eye sees down them to the burning middle distance and the far city.

towers = Boxes()
frames = Boxes()
lamps_red = Boxes()
lamps_warm = Boxes()
fires = Boxes()
fire_spots = []
counts = {"towers": 0, "boxes": 0, "frames": 0, "fires": 0, "beams": 0, "bridges": 0}

LIFT = Vector((math.cos(math.radians(LIFT_YAW)) * LIFT_DIST, math.sin(math.radians(LIFT_YAW)) * LIFT_DIST, 0))
# the open avenues: their yaw (degrees) and half width (degrees); the first looks at the skylift
LANES = [(LIFT_YAW, 8.0)]
while len(LANES) < 4:
    y = rng.uniform(-180, 180)
    if all(abs((y - l + 180) % 360 - 180) > 50 for l, _ in LANES):
        LANES.append((y, rng.uniform(4.0, 6.0)))


def lane_off(a_deg):
    """How far (degrees) a way is from the nearest avenue's edge: below 0 inside one."""
    return min(abs((a_deg - l + 180) % 360 - 180) - w for l, w in LANES)


def district_yaw(x, y):
    """Each district's own grid: the yaw of its streets, from a coarse cell of the plan."""
    cell = (int(math.floor(x / 1500.0)), int(math.floor(y / 1500.0)))
    return random.Random(hash((SEED, cell)) & 0xFFFFFFFF).choice([0.0, 0.0, 0.26, -0.18, 0.52, 0.79])


def fire_at(x, y, z, size):
    """A fire: burning blocks, and a plume and a halo over them (made after the city)."""
    for _ in range(3):
        fires.box((x + rng.uniform(-0.5, 0.5) * size, y + rng.uniform(-0.5, 0.5) * size, z + rng.uniform(0, 0.2) * size),
                  (size * rng.uniform(0.3, 0.7), size * rng.uniform(0.3, 0.7), size * rng.uniform(0.1, 0.3)),
                  rng.uniform(0, 3), bottom=True)
    fire_spots.append((x, y, z, size))
    counts["fires"] += 1


def tower(x, y, w, d, h, yaw, rnd, share, burning=False):
    """A tower of one to four tiers set back as it rises, each a box, a chamfered box, an octagon or round;
    a crown or a mast; a red beacon on the tallest. Returns its top."""
    shape = rng.choices(["box", "chamfer", "oct", "round"], [0.5, 0.25, 0.12, 0.13])[0]
    tiers = 1 + (rng.random() < 0.6) + (rng.random() < 0.4) + (h > 300 and rng.random() < 0.6)
    z = 0.0
    cw, cd = w, d
    ox, oy = 0.0, 0.0
    c, s = math.cos(yaw), math.sin(yaw)
    for t in range(tiers):
        th = h * (0.45 if t == 0 and tiers > 1 else rng.uniform(0.18, 0.35)) if t < tiers - 1 else max(h - z, 8.0)
        cx, cy = x + ox * c - oy * s, y + ox * s + oy * c
        if shape == "box":
            towers.box((cx, cy, z + th / 2), (cw, cd, th), yaw, rnd, share=share)
        elif shape == "chamfer":
            towers.prism(cx, cy, z, th, cw / 2, cd / 2, 8, yaw, rnd, share, chamfer=0.25)
        elif shape == "oct":
            towers.prism(cx, cy, z, th, cw / 2, cw / 2, 8, yaw, rnd, share)
        else:
            towers.prism(cx, cy, z, th, cw / 2, cd / 2 if rng.random() < 0.4 else cw / 2, 20, yaw, rnd, share)
        counts["boxes"] += 1
        z += th
        if z >= h:
            break
        k = rng.uniform(0.6, 0.86)
        nw, nd = cw * k, cd * rng.uniform(0.6, 0.92)
        ox += rng.uniform(-1, 1) * (cw - nw) / 2
        oy += rng.uniform(-1, 1) * (cd - nd) / 2
        cw, cd = nw, nd
        if rng.random() < 0.25:  # a tier of another form
            shape = rng.choice(["box", "chamfer", "round"])
    cx, cy = x + ox * c - oy * s, y + ox * s + oy * c
    if rng.random() < 0.3:
        mh = h * rng.uniform(0.06, 0.2)
        frames.box((cx, cy, z + mh / 2), (max(1.5, cw * 0.05), max(1.5, cw * 0.05), mh), yaw, rnd)
        z += mh
    if h > 160 and rng.random() < 0.6:
        lamps_red.box((cx, cy, z + 2), (max(3.0, h * 0.008),) * 3, yaw, rnd)
    if burning:
        fire_at(x, y, rng.uniform(0, 0.3) * h, w * rng.uniform(0.5, 1.0))
    counts["towers"] += 1
    return z


placed = []  # (x, y, radius) of the near and middle towers, so they do not stand in each other


def scatter(r0, r1, n, hmin, hmax, wmin, wmax, share, slab=0.15, burn=0.01, lane_h=0.0):
    """`n` towers between radii r0 and r1, uniform over the ring, `hmin` to `hmax` tall (rising with distance);
    in an avenue a tower is `lane_h` of its height, or left out (at 0, and always nearer than 1,500 m)."""
    made = 0
    tries = 0
    while made < n and tries < n * 8:
        tries += 1
        r = math.sqrt(rng.uniform(r0 * r0, r1 * r1))
        a = rng.uniform(-math.pi, math.pi)
        x, y = r * math.cos(a), r * math.sin(a)
        if (Vector((x, y, 0)) - LIFT).length < 1600:
            continue
        t = (r - r0) / (r1 - r0)
        h = (hmin + (hmax - hmin) * t) * math.exp(rng.gauss(0, 0.4))
        w = rng.uniform(wmin, wmax)
        d = w * rng.uniform(0.55, 1.4)
        if rng.random() < slab:  # a megablock slab: wide and deep for its height
            w *= rng.uniform(2.0, 3.5)
            h *= rng.uniform(0.6, 1.0)
        half = math.degrees(math.atan2(max(w, d) * 0.6, r))
        if lane_off(math.degrees(a)) < half:
            if lane_h <= 0 or r < 1500:
                continue
            h *= lane_h
        rad = max(w, d) * 0.55
        if r < 3000:
            if any((x - px) ** 2 + (y - py) ** 2 < (rad + pr) ** 2 for px, py, pr in placed):
                continue
            placed.append((x, y, rad))
        tower(x, y, w, d, h, district_yaw(x, y) + rng.gauss(0, 0.03), rng.random(),
              rng.uniform(*share), rng.random() < burn)
        made += 1


def k(n):
    return max(1, int(n * DENSITY))


# near: colossal dark megablocks round the eye, few windows lit; then lit walls; then the far city; then giants
scatter(260, 900, k(80), 380, 900, 50, 140, (0.03, 0.12), slab=0.15, burn=0.0)
scatter(900, 3000, k(650), 300, 900, 50, 180, (0.12, 0.42), slab=0.22, burn=0.015, lane_h=0.25)
scatter(3000, 13000, k(2200), 350, 1400, 90, 340, (0.15, 0.4), slab=0.25, burn=0.006, lane_h=0.5)
for _ in range(k(50)):
    r = rng.uniform(9000, 24000)
    a = rng.uniform(-math.pi, math.pi)
    if lane_off(math.degrees(a)) < 2:
        continue
    tower(r * math.cos(a), r * math.sin(a), rng.uniform(600, 1800), rng.uniform(500, 1500),
          rng.uniform(2000, 4500), rng.uniform(-0.6, 0.6), rng.random(), rng.uniform(0.1, 0.3))

# bridges between near and middle towers, high over the streets
near = [p for p in placed if math.hypot(p[0], p[1]) < 1800]
for _ in range(k(40)):
    if len(near) < 2:
        break
    (x1, y1, _), (x2, y2, _) = rng.sample(near, 2)
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 150 or length > 1100:
        continue
    if lane_off(math.degrees(math.atan2(y1 + y2, x1 + x2))) < 6:
        continue
    z = rng.uniform(150, 650)
    yaw = math.atan2(y2 - y1, x2 - x1)
    w = rng.uniform(25, 90)
    th = rng.uniform(18, 60)
    towers.box(((x1 + x2) / 2, (y1 + y2) / 2, z), (length, w, th), yaw, rng.random(), bottom=True,
               share=rng.uniform(0.1, 0.35))
    c, s = math.cos(yaw), math.sin(yaw)
    for q in range(int(length // 45)):
        t = -length / 2 + 20 + q * 45
        lamps_warm.box(((x1 + x2) / 2 + c * t, (y1 + y2) / 2 + s * t, z - th / 2 - 3), (3, 3, 3), yaw)
    counts["bridges"] += 1

# colossal masses overhead: slabs of the mega-structure spanning the sky hundreds of metres up, and great
# trusses crossing over the eye into the storm
for _ in range(k(3)):
    a = rng.uniform(-math.pi, math.pi)
    off = rng.uniform(150, 900)
    cx, cy = off * math.cos(a), off * math.sin(a)
    yaw = rng.uniform(-math.pi, math.pi)
    z = rng.uniform(800, 1300)
    towers.box((cx, cy, z), (rng.uniform(2500, 5000), rng.uniform(120, 300), rng.uniform(80, 180)), yaw,
               rng.random(), bottom=True, share=0.05)
    counts["bridges"] += 1
for _ in range(k(3)):
    a = rng.uniform(-math.pi, math.pi)
    span = rng.uniform(3000, 6000)
    off = rng.uniform(-900, 900)
    dx, dy = math.cos(a), math.sin(a)
    px, py = -dy * off, dx * off
    z = rng.uniform(900, 1500)
    truss(frames, (px - dx * span / 2, py - dy * span / 2, z), (px + dx * span / 2, py + dy * span / 2, z),
          rng.uniform(120, 220), rng.uniform(18, 35), rng.randint(10, 18))
    counts["frames"] += 1

# giant frames standing in the middle distance
for f in range(k(8)):
    r = rng.uniform(1500, 6000)
    a = rng.uniform(-math.pi, math.pi)
    if lane_off(math.degrees(a)) < 12:
        continue
    cx, cy = r * math.cos(a), r * math.sin(a)
    yaw = a + math.pi / 2 + rng.uniform(-0.5, 0.5)
    span = rng.uniform(900, 2400)
    height = rng.uniform(1300, 2800)
    th = rng.uniform(40, 80)
    bays = rng.randint(3, 6)
    dx, dy = math.cos(yaw), math.sin(yaw)
    pts = [(cx + dx * (-span / 2 + span * i / bays), cy + dy * (-span / 2 + span * i / bays)) for i in range(bays + 1)]
    for i, (px, py) in enumerate(pts):
        beam_box(frames, (px, py, 0), (px, py, height), th * 1.5)
        for lvl in (0.33, 0.66, 1.0):
            if i < bays:
                qx, qy = pts[i + 1]
                beam_box(frames, (px, py, height * lvl), (qx, qy, height * lvl), th)
                if lvl < 1.0:
                    beam_box(frames, (px, py, height * (lvl - 0.33)), (qx, qy, height * lvl), th * 0.6)
        lamps_red.box((px, py, height + th * 0.6), (th * 0.3,) * 3)
    counts["frames"] += 1

# great fires down the open avenues, so they are seen between the towers; and a few more about
for lane, half in LANES[1:]:
    for _ in range(2):
        r = rng.uniform(1300, 4000)
        a = math.radians(lane + rng.uniform(-half, half) * 0.6)
        fire_at(r * math.cos(a), r * math.sin(a), 0.0, rng.uniform(140, 300))
for _ in range(k(4)):
    r = rng.uniform(1200, 3500)
    a = rng.uniform(-math.pi, math.pi)
    fire_at(r * math.cos(a), r * math.sin(a), rng.uniform(0, 200), rng.uniform(120, 260))

# the skylift: its anchor, a stepped mountain of structure at the avenue's end, and its cable going up
lx, ly = LIFT.x, LIFT.y
z = 0.0
for step, (w, h) in enumerate([(2400, 450), (1800, 550), (1250, 650), (800, 800), (420, 950), (170, 1200)]):
    towers.prism(lx, ly, z, h, w / 2, w * 0.45, 8, math.radians(LIFT_YAW), 0.31 + step * 0.07, 0.25, chamfer=0.3)
    for q in range(8):
        a = q * math.pi / 4
        lamps_red.box((lx + math.cos(a) * w * 0.5, ly + math.sin(a) * w * 0.45, z + h), (16, 16, 16))
    z += h
ANCHOR_TOP = z
cable = Boxes()
cable.box((lx, ly, ANCHOR_TOP + 30000), (40, 40, 60000), math.radians(LIFT_YAW))
cable.box((lx + 110, ly + 70, ANCHOR_TOP + 30000), (14, 14, 60000), math.radians(LIFT_YAW))
for c in range(6):  # climbers on the cable
    cz = ANCHOR_TOP + rng.uniform(200, 7000)
    lamps_warm.box((lx, ly, cz), (50, 50, 70))

# a glow along the cable, so the line reads through the haze
def sheath(T):
    lw = T.node("ShaderNodeLayerWeight")
    T.put(lw.inputs["Blend"], 0.5)
    soft = T.math("POWER", T.math("SUBTRACT", 1.0, lw.outputs["Facing"]), 3.0)
    return additive(T, (1.0, 0.75, 0.6), T.math("MULTIPLY", soft, 0.35))


bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=160.0, depth=60000, end_fill_type="NOTHING",
                                    location=(lx, ly, ANCHOR_TOP + 30000))
bpy.context.active_object.data.materials.append(material("sheath", sheath, "BLENDED"))

# ground: dark, under the fog
ground = Boxes()
ground.box((0, 0, -1), (90000, 90000, 2), rnd=0.5)

mat_facade = material("facade", facade)
mat_steel = material("steel", steel)
towers.object("towers", mat_facade)
frames.object("frames", mat_steel)
lamps_red.object("beacons", material("beacon", lamp((1.0, 0.06, 0.03), 9.0)))
lamps_warm.object("decklights", material("decklight", lamp((1.0, 0.55, 0.22), 6.0)))
fires.object("fires", material("fire", fire))
cable.object("skylift", material("tether", tether))
ground.object("ground", material("groundmat", lambda T: emission(T, fogged(T, (0.004, 0.003, 0.003)))))


def plane(name, z, half, mat):
    mesh = bpy.data.meshes.new(name)
    n = 24  # a grid, so the far deck is not one huge triangle
    verts = [(-half + 2 * half * i / n, -half + 2 * half * j / n, z) for j in range(n + 1) for i in range(n + 1)]
    faces = [(j * (n + 1) + i, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i + 1, (j + 1) * (n + 1) + i)
             for j in range(n) for i in range(n)]
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    return ob


plane("storm_low", STORM_BASE, 70000, material("storm_low", clouds(1, 0.00042, 0.62, 1.0), "BLENDED"))
plane("storm_high", STORM_BASE + 2600, 90000, material("storm_high", clouds(2, 0.00018, 0.55, 0.6), "BLENDED"))

# searchlights: cones from the tallest near and middle towers, sweeping the storm
mat_beam = material("beam", beam, "BLENDED")
for b in range(k(7)):
    r = rng.uniform(700, 5000)
    a = rng.uniform(-math.pi, math.pi)
    base = Vector((r * math.cos(a), r * math.sin(a), rng.uniform(120, 420)))
    length = 7000.0
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=8.0, radius2=length * math.tan(math.radians(rng.uniform(1.5, 2.8))),
                                    depth=length, end_fill_type="NOTHING")
    cone = bpy.context.active_object
    tilt = math.radians(rng.uniform(6, 28))
    turn = rng.uniform(-math.pi, math.pi)
    rot = Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(tilt, 4, "Y")
    cone.matrix_world = Matrix.Translation(base) @ rot @ Matrix.Translation((0, 0, length / 2))
    cone.data.materials.append(mat_beam)
    counts["beams"] += 1

# rain: two shells round the eye
mat_rain = material("rain", rain, "BLENDED")
for radius in (90.0, 240.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=radius, location=tuple(CAM))
    sph = bpy.context.active_object
    sph.data.materials.append(mat_rain)
    for p in sph.data.polygons:
        p.use_smooth = True

# smoke and glow over the fires: a leaning plume, lit orange from below, and a halo of light in the haze
def plume(T):
    tc = T.node("ShaderNodeTexCoord")
    gz = T.sep(tc.outputs["Generated"])[2]
    geo = T.node("ShaderNodeNewGeometry")
    n = T.noise(T.vmath("ADD", tc.outputs["Object"], SEED_V), 0.012, 6.0, 0.6)
    lw = T.node("ShaderNodeLayerWeight")
    T.put(lw.inputs["Blend"], 0.5)
    soft = T.math("POWER", T.math("SUBTRACT", 1.0, lw.outputs["Facing"]), 1.5)
    under = T.math("POWER", T.math("SUBTRACT", 1.0, gz, clamp=True), 4.0)
    colour = T.mixv(T.math("MULTIPLY", under, T.math("MULTIPLY_ADD", n, 0.8, 0.4)), (0.006, 0.003, 0.003),
                    (1.8, 0.45, 0.08), "MIX")
    a = T.math("MULTIPLY", T.math("MULTIPLY", T.math("SUBTRACT", n, 0.3, clamp=True), 4.0), soft)
    a = T.math("MULTIPLY", a, T.math("SUBTRACT", 1.0, T.math("POWER", gz, 2.0)))
    return blended(T, fogged(T, colour, 0.6), T.math("MINIMUM", a, 0.9))


def halo(T):
    lw = T.node("ShaderNodeLayerWeight")
    T.put(lw.inputs["Blend"], 0.5)
    soft = T.math("POWER", T.math("SUBTRACT", 1.0, lw.outputs["Facing"]), 4.0)
    geo = T.node("ShaderNodeNewGeometry")
    fog, _ = fog_amount(T, geo.outputs["Position"])
    a = T.math("MULTIPLY", soft, T.math("MULTIPLY_ADD", fog, -0.6, 0.75))
    return additive(T, (1.0, 0.36, 0.08), T.math("MULTIPLY", a, 1.3))


mat_plume = material("plume", plume, "BLENDED")
mat_halo = material("halo", halo, "BLENDED")
wind = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized()
for (fx, fy, fz, fw) in fire_spots:
    if Vector((fx, fy, 0)).length > 9000:
        continue
    tall = rng.uniform(900, 2200) * (1.6 if fw > 200 else 1.0)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=fw * 0.6, radius2=tall * rng.uniform(0.18, 0.3), depth=tall,
                                    end_fill_type="NOTHING")
    cone = bpy.context.active_object
    lean = wind * 0.5 + Vector((0, 0, 1))
    rot = Vector((0, 0, 1)).rotation_difference(lean.normalized()).to_matrix().to_4x4()
    cone.matrix_world = Matrix.Translation((fx, fy, fz)) @ rot @ Matrix.Translation((0, 0, tall / 2))
    cone.data.materials.append(mat_plume)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=min(1100.0, 0.18 * math.hypot(fx, fy), max(150.0, fw * 3.0)),
                                         location=(fx, fy, fz))
    sph = bpy.context.active_object
    sph.data.materials.append(mat_halo)
    counts["plumes"] = counts.get("plumes", 0) + 1

# the world: the same air
world = bpy.data.worlds.new("air")
scene.world = world
world.use_nodes = True
W = Tree(world.node_tree)
W.n.clear()
wout = W.node("ShaderNodeOutputWorld")
bg = W.node("ShaderNodeBackground")
tc = W.node("ShaderNodeTexCoord")
W.put(bg.inputs["Color"], air_colour(W, tc.outputs["Generated"]))
W.put(bg.inputs["Strength"], 1.0)
W.put(wout.inputs["Surface"], bg.outputs[0])

# ── the camera, a face at a time ────────────────────────────────────────────

cam_data = bpy.data.cameras.new("eye")
cam_data.type = "PERSP"
cam_data.sensor_fit = "HORIZONTAL"
cam_data.angle = math.pi / 2
cam_data.clip_start = 2.0
cam_data.clip_end = 150000.0
cam = bpy.data.objects.new("eye", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

for face in job["faces"]:
    f = Vector(face["forward"]).normalized()
    r = Vector(face["right"]).normalized()
    u = Vector(face["up"]).normalized()
    # a camera looks along its -z, its x to the right of the picture, its y to the top
    m = Matrix((r, u, -f)).transposed().to_4x4()
    m.translation = CAM
    cam.matrix_world = m
    scene.render.filepath = out_path("face_%s.png" % face["suffix"])
    bpy.ops.render.render(write_still=True)
    say("face", face["suffix"])

counts["lift_yaw"] = LIFT_YAW
counts["view_transform"] = scene.view_settings.view_transform
write_result(counts)
