"""A skeleton: bone names (bones resource) and parents (the unit's scene graph, matched by name hash). The first
person's (default), or a third person's:

    python skeleton.py                                   # units/beings/player/first_person_base/chr_first_person_base
    python skeleton.py units/beings/player/third_person_base/empire_soldier/chr_third_person_base tp_skeleton.json

(getres.py bones|unit <path> first.)"""
import struct, json, os
here = os.path.dirname(os.path.abspath(__file__))
def skeleton(unit_path, bones_path, table_at=None):
    bn = open(bones_path, "rb").read()
    n, lods = struct.unpack_from("<II", bn, 0)
    hashes = list(struct.unpack_from(f"<{n}I", bn, 8))
    names = [x.decode() for x in bn[8 + 4 * n + 4 * lods:].split(b"\0")][:n]
    u = open(unit_path, "rb").read()
    # the scene graph's parent table: (u16 kind, u16 parent) per node, root (0, 0) first, then its name hashes
    best = None
    for at in range(0, len(u) - 8):  # not always 2-aligned (the third person's)
        if struct.unpack_from("<HH", u, at) != (0, 0): continue
        rec = []
        while at + 4 * len(rec) + 4 <= len(u):
            a, p = struct.unpack_from("<HH", u, at + 4 * len(rec))
            if a > 3 or (rec and p >= len(rec)): break
            rec.append((a, p))
        if len(rec) < n: continue
        node_hash = list(struct.unpack_from(f"<{len(rec)}I", u, at + 4 * len(rec)))
        if all(h in node_hash for h in hashes):
            best = (at, rec, node_hash); break
    at, rec, node_hash = best
    node_of = {h: i for i, h in enumerate(node_hash)}
    bone_of_node = {node_of[h]: j for j, h in enumerate(hashes)}
    parents = []
    for j, h in enumerate(hashes):
        k = rec[node_of[h]][1] if node_of[h] else None
        while k is not None and k not in bone_of_node: k = rec[k][1] if k else None
        parents.append(bone_of_node[k] if k is not None and k != node_of[h] else -1)
    return names, parents
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2:
        base = os.path.join(here, "out", "res", sys.argv[1].replace("/", "~"))
        names, parents = skeleton(base + ".unit", base + ".bones")
        json.dump({"names": names, "parents": parents, "path": sys.argv[1]}, open(os.path.join(here, "out", sys.argv[2]), "w"))
        for j, (a, q) in enumerate(zip(names, parents)): print(f"{j:4} {a:30} -> {names[q] if q >= 0 else '-'}")
        raise SystemExit
    base = os.path.join(here, "out", "res", "units~beings~player~first_person_base~chr_first_person_base")
    names, parents = skeleton(base + ".unit", base + ".bones")
    json.dump({"names": names, "parents": parents}, open(os.path.join(here, "out", "fp_skeleton.json"), "w"))
    for j in (1, 2, 7, 8, 10, 12, 13, 15, 17, 19, 25, 31, 32, 37, 78, 140): print(f"{names[j]:26} -> {names[parents[j]] if parents[j] >= 0 else '-'}")
