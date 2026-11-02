"""Each weapon unit's tip and butt, from its mesh: the unit resource begins with its first geometry's vertex
positions (u32 version, u32 geometries, u32 streams, u32 bytes, then x, y, z, 1 as half floats), in its node's
space, placed in the unit's (the hand's weapon attach bone's, AttachmentNodeLinking) by that node's world matrix
(scene()). The weapon's length runs along its
longest extent; the tip is the end farther from the attach point (the hand holds the handle), the butt the other; for a
weapon held in both hands anim/lib/vt2.mjs turns it round when the off hand is nearer that end (an axe held high
on its haft).
Writes out/weapons.json: {unit: {tip, butt, length, axis, verts}} (local only).

    python weapons.py
"""
import os, json, struct, collections
from bundle import GAME
from vt2index import murmur64
from files import files

here = os.path.dirname(os.path.abspath(__file__))
UNIT = murmur64("unit")
where = {}
for line in open(os.path.join(here, "index.tsv")):
    t, nm, f, sz = line.split()
    if int(t, 16) == UNIT: where.setdefault(int(nm, 16), f)


def positions(u):
    ver, ngeo, nstreams, size = struct.unpack_from("<4I", u, 0)
    if size % 8 or not 0 < size < len(u): return None
    P = [struct.unpack_from("<4e", u, 16 + 8 * i) for i in range(size // 8)]
    if not all(abs(p[3] - 1) < 1e-3 for p in P): return None
    return [p[:3] for p in P]


def geometries(u):
    """Every geometry's positions: the first's as positions() reads them, the others' found by their shape (a u32
    byte count, then x, y, z, 1 half floats), as many as the unit says it has (a ghost scythe: blade, staff, ...)."""
    first = positions(u)
    if not first: return []
    ngeo = struct.unpack_from("<I", u, 4)[0]
    out = [first]
    o = 16 + len(first) * 8
    while len(out) < ngeo and o < len(u) - 12:
        (sz,) = struct.unpack_from("<I", u, o)
        if 64 <= sz and sz % 8 == 0 and o + 4 + sz <= len(u):
            P = [struct.unpack_from("<4e", u, o + 4 + 8 * i) for i in range(sz // 8)]
            if all(abs(p[3] - 1) < 1e-3 for p in P):
                out.append([p[:3] for p in P])
                o += 4 + sz
                continue
        o += 1
    return out


def scene(u, P):
    """The world matrix (4x4, row vectors: p' = [x y z 1] M) of the node the geometry hangs on, or None.

    Near the end of the unit: u32 nodes, then per node its local transform (3x3 rotation, position, scale: 60
    bytes), then per node its world 4x4 (64 bytes), per node its parent (u16 kind, u16 parent), per node its name
    (murmur32); then u32 meshes, each u32 name, u32 node, 2 x u32, u32 flags, then its bounding box in the node's
    space (min xyz, max xyz, radius). The geometry's node is the mesh whose box is the positions' bounds. Not
    4-aligned in the file: found by its shape.
    """
    lo = [min(p[k] for p in P) for k in range(3)]
    hi = [max(p[k] for p in P) for k in range(3)]
    for o in range(len(u) - 8, 16, -1):
        (n,) = struct.unpack_from("<I", u, o)
        if not 0 < n <= 256: continue
        worlds = o + 4 + 60 * n
        meshes = worlds + 72 * n
        if meshes + 4 > len(u): continue
        W = [struct.unpack_from("<16f", u, worlds + 64 * i) for i in range(n)]
        if not all(abs(m[15] - 1) < 1e-4 and abs(m[3]) + abs(m[7]) + abs(m[11]) < 1e-4 for m in W): continue
        # a node may be scaled (the dwarf 2h axe's, to 0.64 x 0.71): its rows need only be finite and not none
        if not all(all(math.isfinite(x) and abs(x) < 1e3 for x in m) and 0.01 < sum(x * x for x in m[0:3]) < 100 for m in W): continue
        # mesh records are not of one length (batches and materials follow the box): look for the box
        for at in range(meshes + 4, len(u) - 52):
            box = struct.unpack_from("<6f", u, at + 20)
            if all(abs(box[k] - lo[k]) < 2e-3 and abs(box[3 + k] - hi[k]) < 2e-3 for k in range(3)):
                (node,) = struct.unpack_from("<I", u, at + 4)
                if node < n: return [W[node][4 * r : 4 * r + 4] for r in range(4)]
                break
    return None


def place(P, M):
    return [[p[0] * M[0][c] + p[1] * M[1][c] + p[2] * M[2][c] + M[3][c] for c in range(3)] for p in P]


def ends(P):
    lo = [min(p[k] for p in P) for k in range(3)]
    hi = [max(p[k] for p in P) for k in range(3)]
    k = max(range(3), key=lambda i: hi[i] - lo[i])
    length = hi[k] - lo[k]
    far, near = (hi[k], lo[k]) if abs(hi[k]) >= abs(lo[k]) else (lo[k], hi[k])
    def end(at):  # the middle of the vertices within 3% of the length of that end
        S = [p for p in P if abs(p[k] - at) <= 0.03 * length]
        c = [sum(p[i] for p in S) / len(S) for i in range(3)]
        c[k] = at
        return [round(x, 4) for x in c]
    step = max(1, len(P) // 400)  # a thinned point cloud, for pictures (local only, as the rest)
    return dict(tip=end(far), butt=end(near), length=round(length, 4), axis=k, verts=len(P),
                points=[[round(x, 3) for x in p] for p in P[::step]])


def items():
    """{template: [(right unit, left unit)]} from every ItemMasterList the Lua builds."""
    import luajit
    out = collections.defaultdict(list)
    d = os.path.join(here, "out", "lua")
    for f in sorted(os.listdir(d)):
        b = open(os.path.join(d, f), "rb").read()
        if b"ItemMasterList" not in b: continue
        try:
            G, _ = luajit.run(luajit.read(b)[1][-1])
        except Exception:
            continue
        for v in (G.get("ItemMasterList") or {}).values():
            if isinstance(v, dict) and isinstance(v.get("template"), str):
                pair = tuple(v.get(f"{h}_hand_unit") if isinstance(v.get(f"{h}_hand_unit"), str) else None for h in ("right", "left"))
                if any(pair) and pair not in out[v["template"]]: out[v["template"]].append(pair)
    return out


def held(m, slack=0.06):
    """Does the weapon's long axis pass through the hand (the attach point), within its length?"""
    t, b = m["tip"], m["butt"]
    ax = [t[i] - b[i] for i in range(3)]
    L2 = sum(x * x for x in ax) or 1
    k = -sum(b[i] * ax[i] for i in range(3)) / L2
    off = math.dist([b[i] + k * ax[i] for i in range(3)], [0, 0, 0])
    # a mesh whose node was not found and is centred on the attach point is likely offset by that node (a
    # greatsword's grip at its middle): left out; the hand may be anywhere else along the weapon
    centred = not m.get("placed") and abs(sum(t[i] + b[i] for i in range(3) if abs(ax[i]) == max(abs(x) for x in ax)) / 2) < 0.05 * math.sqrt(L2)
    return off <= slack and -0.05 <= k <= 1.05 and not centred


import math
pairs = items()
units = sorted({u for ps in pairs.values() for pair in ps for u in pair if u})
by_bundle = collections.defaultdict(list)
for u in units:
    f = where.get(murmur64(u))
    if f: by_bundle[f].append(u)
measured, bad = {}, []
for f, us in by_bundle.items():
    got = {(t, n): vs for t, n, vs in files(os.path.join(GAME, f))}
    for u in us:
        data = got[(UNIT, murmur64(u))][0][1]
        G = geometries(data)
        if not G:
            bad.append(u); continue
        # each geometry placed by its node; one whose node is not found is left as it is
        Ms = [scene(data, P) for P in G]
        P = [q for P, M in zip(G, Ms) for q in (place(P, M) if M else P)]
        measured[u] = dict(ends(P), placed=all(M is not None for M in Ms), geometries=len(G))
out = {}
for tpl, ps in sorted(pairs.items()):
    for side, i in (("right", 0), ("left", 1)):
        ok = [p[i] for p in ps if p[i] in measured and held(measured[p[i]])]
        if ok:
            out.setdefault(tpl, {})[side] = dict(unit=ok[0], **measured[ok[0]], candidates=len({p[i] for p in ps if p[i]}))
json.dump(out, open(os.path.join(here, "out", "weapons.json"), "w"), indent=1)
print(f"{len(units)} weapon units: {len(measured)} measured ({sum(m['placed'] for m in measured.values())} placed by their node), {len(bad)} not read; {len(measured) - sum(held(m) for m in measured.values())} fail the hand check")
print(f"{len(pairs)} templates with items, {len(out)} with a weapon passing the check")
for t in ["one_handed_swords_template_1", "two_handed_swords_template_1", "fencing_sword_template_1", "two_handed_heavy_spears_template", "one_handed_daggers_template_1", "two_handed_hammers_template_1", "one_handed_flail_template_1"]:
    for side, m in out.get(t, {}).items(): print(f"  {t:36} {side:5} {m['unit'].split('/')[-1]:34} {m['length']:.2f} m tip {m['tip']} butt {m['butt']}")
