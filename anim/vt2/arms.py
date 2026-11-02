"""Each hero's first-person arms, read from its mesh unit (units/beings/player/<hero>/first_person_base/
chr_first_person_mesh), for SMAK's arms survey (anim/lib/arms.mjs). Writes out/arms.json (local only: it holds the
mesh, as the rest of out/ does; what SMAK keeps of it are measures and bands).

The unit, as read here (version 189, one geometry):
  u32 version, u32 geometries, u32 streams; per stream u32 bytes, its data, then u32 semantic, u32 set, u32 count,
  u32 stride (the semantic here is always 0: the channel table says what each stream holds);
  u32 channels, each 17 bytes: u32 semantic (0 position, 1 normal, 2 tangent, 3 binormal, 4 uv, 5 colour,
  6 bone indices, 7 bone weights), u32 type (17 half x 4, 15 half x 2, 19 u8 x 4, 18 colour), u32 set, u32 stream,
  u8 instance;
  u32 0, u32 index format (0: u16), u32 0, u32 indices, u32 bytes, the indices (triangle list);
  u32 batches, each u32 id, u32 first triangle, u32 triangles, u32 bone set (which of the skin's sets its
  vertices' bone indices are in: the dwarf's arms have two).
  The skin, found by its shape further on: u32 1, u32 bones, bones x 4x4 inverse bind matrices (row vectors, p' =
  [x y z 1] M), u32 bones, their scene graph nodes (u32 each), u32 sets, each u32 count and the skin bones a
  vertex's bone index stands for (a vertex's bone is nodes[set[index]]; these meshes have one set).
  The scene graph, found by its shape (weapons.py's scene()): u32 nodes, 60 bytes each of local transform, 64 of
  world matrix, 4 of parent (u16 kind, u16 parent), then each node's name (murmur32), named here from the first-
  person skeleton's bones resource.
The bind pose is the skin's: each bone's world matrix is its inverse bind matrix inverted, in the vertices' space.

    python getres.py unit units/beings/player/<hero>/first_person_base/chr_first_person_mesh   (each hero)
    python getres.py bones units/beings/player/first_person_base/chr_first_person_base
    python arms.py
"""
import os, json, struct, glob

here = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(here, "out", "res")
HEROES = ["empire_soldier", "dwarf_ranger", "witch_hunter", "bright_wizard", "wood_elf"]


def bone_names():
    bn = open(os.path.join(RES, "units~beings~player~first_person_base~chr_first_person_base.bones"), "rb").read()
    n, lods = struct.unpack_from("<II", bn, 0)
    hashes = struct.unpack_from(f"<{n}I", bn, 8)
    names = [x.decode() for x in bn[8 + 4 * n + 4 * lods:].split(b"\0")][:n]
    return dict(zip(hashes, names))


def streams(u):
    ver, ngeo, ns = struct.unpack_from("<3I", u, 0)
    if ver != 189 or ngeo != 1: raise ValueError(f"unit version {ver}, {ngeo} geometries: not read here")
    o, data = 12, []
    for _ in range(ns):
        (size,) = struct.unpack_from("<I", u, o)
        sem, st, count, stride = struct.unpack_from("<4I", u, o + 4 + size)
        data.append((o + 4, count, stride))
        o += 4 + size + 16
    (nc,) = struct.unpack_from("<I", u, o)
    channels = {}
    for i in range(nc):
        sem, typ, st, stream, inst = struct.unpack_from("<4IB", u, o + 4 + 17 * i)
        if st == 0: channels[sem] = (typ, data[stream])
    o += 4 + 17 * nc
    _, fmt, _, count, size = struct.unpack_from("<5I", u, o)
    if fmt != 0 or size != 2 * count: raise ValueError("index buffer not u16")
    indices = struct.unpack_from(f"<{count}H", u, o + 20)
    o += 20 + size
    (nb,) = struct.unpack_from("<I", u, o)
    batches = [struct.unpack_from("<4I", u, o + 4 + 16 * i) for i in range(nb)]
    return channels, indices, batches, o + 4 + 16 * nb


def skin(u, start):
    """The skin: (inverse binds, nodes, sets), the first place after the index buffer where its shape holds."""
    for o in range(start, len(u) - 8):
        one, nb = struct.unpack_from("<II", u, o)
        if one != 1 or not 0 < nb <= 256: continue
        m = struct.unpack_from("<16f", u, o + 8)
        if abs(m[15] - 1) > 1e-4 or abs(m[3]) + abs(m[7]) + abs(m[11]) > 1e-4: continue
        at = o + 8 + 64 * nb
        if at + 4 > len(u) or struct.unpack_from("<I", u, at)[0] != nb: continue
        binds = [struct.unpack_from("<16f", u, o + 8 + 64 * i) for i in range(nb)]
        nodes = struct.unpack_from(f"<{nb}I", u, at + 4)
        at += 4 + 4 * nb
        (ns,) = struct.unpack_from("<I", u, at)
        at += 4
        sets = []
        for _ in range(ns):
            (c,) = struct.unpack_from("<I", u, at)
            sets.append(struct.unpack_from(f"<{c}I", u, at + 4))
            at += 4 + 4 * c
        return binds, nodes, sets, at
    raise ValueError("no skin")


def graph(u, start, names):
    """The scene graph: (parents, node names), where most node names are the skeleton's."""
    for o in range(start, len(u) - 4):
        (n,) = struct.unpack_from("<I", u, o)
        if not 2 <= n <= 512: continue
        worlds = o + 4 + 60 * n
        if worlds + 72 * n > len(u): continue
        if abs(struct.unpack_from("<f", u, worlds + 60)[0] - 1) > 1e-5: continue
        hashes = struct.unpack_from(f"<{n}I", u, worlds + 68 * n)
        if sum(h in names for h in hashes) < 0.7 * n: continue
        parents = [struct.unpack_from("<HH", u, worlds + 64 * n + 4 * i)[1] for i in range(n)]
        return parents, [names.get(h, f"#{h:08x}") for h in hashes]
    raise ValueError("no scene graph")


def invert(m):
    """A rigid 4x4 (row vectors) inverted: rotation transposed, translation turned back."""
    R = [[m[4 * r + c] for c in range(3)] for r in range(3)]
    t = m[12:15]
    Rt = [[R[c][r] for c in range(3)] for r in range(3)]
    ti = [-sum(t[k] * Rt[k][c] for k in range(3)) for c in range(3)]
    return Rt, ti


def read(path, names):
    u = open(path, "rb").read()
    channels, indices, batches, after = streams(u)
    def values(sem, fmt, k):
        typ, (at, count, stride) = channels[sem]
        return [struct.unpack_from(fmt, u, at + stride * i)[:k] for i in range(count)]
    P = values(0, "<4e", 3)
    W = values(7, "<4e", 4)
    I = values(6, "<4B", 4)
    binds, nodes, sets, after = skin(u, after)
    # each vertex's bone set: the set of the batch whose triangles use it
    set_of = [0] * len(P)
    for _, first, count, which in batches:
        if which >= len(sets): raise ValueError(f"batch's bone set {which} of {len(sets)}")
        for i in indices[3 * first : 3 * (first + count)]: set_of[i] = which
    parents, node_names = graph(u, after, names)
    bones = {}
    for b, node in enumerate(nodes):
        R, t = invert(binds[b])
        p = node_names[parents[node]] if parents[node] != node else None
        bones[node_names[node]] = {"p": [round(x, 5) for x in t], "x": [round(x, 5) for x in R[0]], "parent": p}
    # the parents named: a skin bone's parent may be a node the skin does not use (it keeps its name)
    # one vertex per position (the mesh splits them by normal and uv): weights summed by bone
    key, verts, remap = {}, [], []
    for i, p in enumerate(P):
        k = tuple(round(x, 4) for x in p)
        if k not in key:
            w = {}
            for wt, ix in zip(W[i], I[i]):
                if wt > 1e-3:
                    b = node_names[nodes[sets[set_of[i]][ix]]]
                    w[b] = w.get(b, 0) + wt
            key[k] = len(verts)
            verts.append([[round(x, 5) for x in p], {b: round(x, 4) for b, x in w.items()}])
        remap.append(key[k])
    tris = [[remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]] for i in range(0, len(indices) - 2, 3)]
    tris = [t for t in tris if len(set(t)) == 3]
    return {"bones": bones, "verts": verts, "tris": tris}


if __name__ == "__main__":
    names = bone_names()
    out = {}
    for hero in HEROES:
        path = os.path.join(RES, f"units~beings~player~{hero}~first_person_base~chr_first_person_mesh.unit")
        if not os.path.exists(path): continue
        out[hero] = read(path, names)
        a = out[hero]
        print(f"{hero:16} bones {len(a['bones']):3}  verts {len(a['verts']):6}  tris {len(a['tris']):6}")
    json.dump(out, open(os.path.join(here, "out", "arms.json"), "w"))
