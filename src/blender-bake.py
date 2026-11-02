# A selected-to-active bake in Blender, run headless by src/blender.mjs (bakeMaps):
#
#   a job of runBlenderJob (src/blender_job.py): read_job() gives it, the maps go to the output folder
#
# The job: the picture's size, and pairs of a low piece (its triangles and their corners' places on the
# picture, in pixels) and a high one (its triangles, each with a colour); occluders that only cast shadow. Every
# high piece is baked onto every low one, the high pieces joined as one object:
#   albedo   the high pieces' colours
#   ao       ambient occlusion of the high pieces and the occluders, `ao` units out (grey)
#   normal   the high pieces' normals in the world, 0 to 1 (object space: the low pieces are not moved)
# Each map is written to outdir as raw float32 RGBA, rows from the bottom as Blender keeps them, with a .json of
# its size. Lines the caller reads begin with [smak]; the result: each map's mean colour and the time it took.
import bpy, json, os, time
import numpy as np
from blender_job import read_job, write_result, out_dir, say

outdir = out_dir()
data = read_job()
W, H = data["width"], data["height"]
means = {}


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = data.get("samples", 16)
scene.cycles.use_denoising = False


def mesh_object(name, tris, uvs=None, colours=None):
    """Triangles as one object, their points shared; uvs in pixels, colours one a triangle."""
    verts, index, faces, keep = [], {}, [], []
    for n, t in enumerate(tris):
        f = []
        for p in t:
            key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
            if key not in index:
                index[key] = len(verts)
                verts.append(p)
            f.append(index[key])
        if len(set(f)) == 3:
            faces.append(f)
            keep.append(n)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs is not None:
        layer = me.uv_layers.new(name="UV")
        for poly, n in zip(me.polygons, keep):
            for li, corner in zip(poly.loop_indices, uvs[n]):
                layer.data[li].uv = (corner[0] / W, 1 - corner[1] / H)
    if colours is not None:
        col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        for poly, n in zip(me.polygons, keep):
            c = colours[n]
            for li in poly.loop_indices:
                col.data[li].color = (c[0], c[1], c[2], 1.0)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


low_tris, low_uvs, high_tris, high_cols = [], [], [], []
for pair in data["pairs"]:
    low_tris += pair["low"]["tris"]
    low_uvs += pair["low"]["uv"]
    high_tris += pair["high"]["tris"]
    cols = pair["high"].get("colours")
    high_cols += cols if cols else [[0.5, 0.5, 0.5]] * len(pair["high"]["tris"])
low = mesh_object("LOW", low_tris, uvs=low_uvs)
high = mesh_object("HIGH", high_tris, colours=high_cols)
occ = mesh_object("OCC", data["occluders"]) if data.get("occluders") else None
# the low pieces are not seen by the rays: only their places matter
for attr in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
    setattr(low, attr, False)
for ob in (high, occ):
    if ob is not None:
        for p in ob.data.polygons:
            p.use_smooth = False
say("low triangles", len(low_tris), "high triangles", len(high_tris))


def emission_material(name, build):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    build(nt, em.inputs["Color"])
    return m


def albedo_build(nt, socket):
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_name = "Col"
    nt.links.new(a.outputs["Color"], socket)


def ao_build(nt, socket):
    n = nt.nodes.new("ShaderNodeAmbientOcclusion")
    n.inputs["Distance"].default_value = data.get("ao", 1.0)
    n.samples = 32
    nt.links.new(n.outputs["AO"], socket)


m_albedo = emission_material("albedo", albedo_build)
m_ao = emission_material("ao", ao_build)
if occ:
    occ.data.materials.append(emission_material("plain", lambda nt, s: None))

m_low = bpy.data.materials.new("low")
if m_low.node_tree is None:
    m_low.use_nodes = True
tex = m_low.node_tree.nodes.new("ShaderNodeTexImage")
m_low.node_tree.nodes.active = tex
low.data.materials.append(m_low)

bake = scene.render.bake
bake.use_selected_to_active = True
bake.cage_extrusion = data.get("cage", 0.1)
bake.max_ray_distance = data.get("distance", 0.5)
bake.margin = data.get("margin", 2)
bake.target = "IMAGE_TEXTURES"
bake.use_clear = True


def run(kind, mat, name, **kw):
    if mat is not None:
        high.data.materials.clear()
        high.data.materials.append(mat)
    img = bpy.data.images.new(name, W, H, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    tex.image = img
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type=kind, **kw)
    arr = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr.tofile(os.path.join(outdir, name))
    json.dump({"width": W, "height": H}, open(os.path.join(outdir, name + ".json"), "w"))
    means[name] = [round(float(x), 3) for x in arr.reshape(-1, 4).mean(0)]
    say(name, "mean", means[name])


t0 = time.time()
maps = data.get("maps", ["albedo", "ao", "normal"])
if "albedo" in maps:
    run("EMIT", m_albedo, "albedo")
if "ao" in maps:
    run("EMIT", m_ao, "ao")
if "normal" in maps:
    run("NORMAL", None, "normal", normal_space="OBJECT")
say("baked in", round(time.time() - t0, 1), "s at", W, "x", H)
write_result({"means": means, "seconds": round(time.time() - t0, 1)})
