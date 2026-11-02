# What Blender sees in a model file, run headless by src/blender.mjs (blenderInspect): a job of runBlenderJob.
#
# The job: { "file": a .glb, .gltf or .fbx }. The file is imported into an empty scene, and the result says
#   fps        the scene's frames a second, which the importer used to place the keys
#   armatures  [{ name, bones: [{ name, parent }], actions }]: each bone under its parent (null at the root),
#              and the actions the importer gave that armature (its own, and its NLA strips')
#   actions    [{ name, frames: [first, last], seconds, fps, bones }]: each action's frame range and length, and
#              the bones its curves move
#   meshes     [{ name, vertices, triangles, armature }]: the armature that deforms each (null when none)
import bpy, os, re
from blender_job import read_job, write_result, fail, say

job = read_job()
path = job.get("file")
if not path or not os.path.isfile(path):
    fail(f"no such file: {path}")

# the factory scene's cube, camera and light out of the way
bpy.data.batch_remove(list(bpy.data.objects))
ext = os.path.splitext(path)[1].lower()
try:
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        # Blender 5 has a built-in FBX importer (wm.fbx_import); earlier ones the add-on's
        if hasattr(bpy.ops.wm, "fbx_import"):
            bpy.ops.wm.fbx_import(filepath=path)
        else:
            bpy.ops.import_scene.fbx(filepath=path)
    else:
        fail(f"not a .glb, .gltf or .fbx: {path}")
except RuntimeError as e:
    fail(f"Blender could not import {path}: {str(e).strip()}")

scene = bpy.context.scene
fps = scene.render.fps / scene.render.fps_base
BONE = re.compile(r'pose\.bones\["(.+?)"\]')


def fcurves_of(action):
    """Every curve of an action: the layered ones (Blender 4.4 and after) and the old list."""
    curves = list(getattr(action, "fcurves", []) or [])
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                curves += list(bag.fcurves)
    return curves


def actions_of(ob):
    out = []
    ad = ob.animation_data
    if ad:
        if ad.action:
            out.append(ad.action.name)
        for track in ad.nla_tracks:
            for strip in track.strips:
                if strip.action and strip.action.name not in out:
                    out.append(strip.action.name)
    return out


armatures = [
    {
        "name": ob.name,
        "bones": [{"name": b.name, "parent": b.parent.name if b.parent else None} for b in ob.data.bones],
        "actions": actions_of(ob),
    }
    for ob in scene.objects
    if ob.type == "ARMATURE"
]
actions = []
for a in bpy.data.actions:
    start, end = (float(x) for x in a.frame_range)
    bones = []
    for c in fcurves_of(a):
        m = BONE.match(c.data_path)
        if m and m.group(1) not in bones:
            bones.append(m.group(1))
    actions.append(
        {"name": a.name, "frames": [start, end], "seconds": round((end - start) / fps, 6), "fps": fps, "bones": bones}
    )
meshes = []
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    arm = next((m.object.name for m in ob.modifiers if m.type == "ARMATURE" and m.object), None)
    me = ob.data
    me.calc_loop_triangles()
    meshes.append({"name": ob.name, "vertices": len(me.vertices), "triangles": len(me.loop_triangles), "armature": arm})

say("armatures", len(armatures), "actions", len(actions), "meshes", len(meshes))
write_result({"file": path, "fps": fps, "armatures": armatures, "actions": actions, "meshes": meshes})
