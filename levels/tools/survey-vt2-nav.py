"""Vermintide 2's navmeshes (Autodesk Gameware Navigation 2.17, the .navdata resource), decoded into triangles for
the survey's measures. Local only: reads levels/vt2/out/navdata/, writes levels/vt2/out/nav/<level>.bin.

    anim/vt2/env/Scripts/python.exe levels/tools/survey-vt2-nav.py [<level path> ...]

THE FORMAT, as read here (2.17.3 little-endian; some levels still carry 2016.1.14's, big-endian with every
the build string longer; an "array" is u32 count + u32 offset counted from the offset field itself):
  "BlobAggFile" header, the build string ("2.17.3 win64_mt ...": u32 length at 0x24; offsets below for a 32-byte one), then the NavData blob:
    0x5c  i32 x4  the cell grid's box (min x, min y, max x, max y, in cells)
    0x80  f32     the generation's entity radius (0.38), height (1.6), step (0.5), slope (60), ...
    0x94  f32     integer precision; a pixel is 128 of them (0.095 m: the radius / 4)
    0x98  u32     pixels per cell (32 or 63 seen: a cell 3.04 or 5.99 m)
    0xa0  array   the cells, each (u32 size, u32 offset) to a cell blob
  a cell:  i32 x, i32 y (in cells), an array, then an array of floors, each (u32 size, u32 offset) to a floor blob
  a floor: +0 array of triangle tags (u8), +8 array (nav tag), +16 array of half-edges (u32), +24 array of
           vertices (u8 x, u8 y, pixels within the cell), +32 array of altitudes (f32, metres, one per vertex),
           +40 f32 altitude min, max, +48 u8 x4 the floor's box in pixels
  a half-edge (u32): bits 0-13 its pair (an inner edge) or a link, bits 14-27 its start vertex, bits 29-31 its
           kind: 7 paired with a triangle of the same floor, 5 an obstacle (the edge of the walkable floor),
           0-3 on the cell's border (to the neighbouring cell). Three in a row are a triangle.
The output: u32 triangle count, then per triangle 9 f32 (x, y, z of its three corners, metres) and u8 x3 (each
edge's kind, in the order v0-v1, v1-v2, v2-v0), packed after the floats of all triangles.
"""
import os, re, struct, sys

sys.dont_write_bytecode = True  # nothing written beside the scripts or into anim/
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "anim", "vt2"))
from vt2index import murmur64  # noqa: E402

OUT = os.path.join(REPO, "levels", "vt2", "out")


def arr(b, o, e="<"):
    n, off = struct.unpack_from(e + "II", b, o)
    return n, o + 4 + off


def decode(b):
    assert b[:11] == b"BlobAggFile", "not a BlobAggFile"
    if b"2.17" in b[0x2c:0x50]:
        e = "<"  # 2.17.3, little-endian
    elif b"2016.1" in b[0x2c:0x50]:
        e = ">"  # 2016.1.14, big-endian; the blobs laid out the same
    else:
        raise AssertionError("another Navigation version")
    # the build string's length (at 0x24) moves every field after it: 32 bytes is the layout written above
    (slen,) = struct.unpack_from(e + "I", b, 0x24)
    s = (slen + 3) // 4 * 4 - 32
    radius, height = struct.unpack_from(e + "ff", b, 0x80 + s)
    (prec,) = struct.unpack_from(e + "f", b, 0x94 + s)
    (ppc,) = struct.unpack_from(e + "I", b, 0x98 + s)
    px = prec * 128
    cell = px * ppc
    tris, kinds = [], []
    n, base = arr(b, 0xa0 + s, e)
    for k in range(n):
        _, co = arr(b, base + 8 * k, e)
        cx, cy = struct.unpack_from(e + "ii", b, co)
        fn, fo = arr(b, co + 16, e)
        for j in range(fn):
            _, fl = arr(b, fo + 8 * j, e)
            ne, eo = arr(b, fl + 16, e)
            nv, vo = arr(b, fl + 24, e)
            na, ao = arr(b, fl + 32, e)
            assert na == nv and ne % 3 == 0, (k, j, ne, nv, na)
            vs = [(cx * cell + b[vo + 2 * i] * px, cy * cell + b[vo + 2 * i + 1] * px,
                   struct.unpack_from(e + "f", b, ao + 4 * i)[0]) for i in range(nv)]
            es = struct.unpack_from(f"{e}{ne}I", b, eo)
            for t in range(0, ne, 3):
                tri = []
                for h in es[t : t + 3]:
                    v = (h >> 14) & 0x3FFF
                    assert v < nv, (v, nv)
                    tri.append(vs[v])
                tris.append(tri)
                kinds.append(bytes((es[t] >> 29, es[t + 1] >> 29, es[t + 2] >> 29)))
    return {"radius": radius, "height": height, "pixel": px, "cell": cell}, tris, kinds


def write(path, tris, kinds):
    with open(path, "wb") as fo:
        fo.write(struct.pack("<I", len(tris)))
        for t in tris:
            fo.write(struct.pack("<9f", *t[0], *t[1], *t[2]))
        fo.write(b"".join(kinds))


if __name__ == "__main__":
    names = {}
    for line in open(os.path.join(OUT, "names.tsv"), encoding="utf-8"):
        h, p = line.rstrip("\n").split("\t", 1)
        names[h] = p
    want = sys.argv[1:]
    os.makedirs(os.path.join(OUT, "nav"), exist_ok=True)
    todo = [murmur64(w) for w in want] if want else None
    for fn in sorted(os.listdir(os.path.join(OUT, "navdata"))):
        h = fn.split(".")[0]
        if todo is not None and int(h, 16) not in todo:
            continue
        name = names.get(h, h)
        b = open(os.path.join(OUT, "navdata", fn), "rb").read()
        try:
            info, tris, kinds = decode(b)
        except Exception as e:
            print("skip", name, repr(e))
            continue
        safe = name.replace("levels/", "").replace("/world", "").replace("/", "~")
        write(os.path.join(OUT, "nav", safe + ".bin"), tris, kinds)
        area = sum(abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2 for t in tris)
        print(f"{name}\t{len(tris)} triangles\t{area:.0f} m2\tpixel {info['pixel']:.4f}")
