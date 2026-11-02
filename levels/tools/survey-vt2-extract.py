"""Vermintide 2's level data, extracted for the survey (local only: everything goes to levels/vt2/out/, which is
not committed). Read-only on the game; imports anim/vt2's readers unchanged.

    anim/vt2/env/Scripts/python.exe levels/tools/survey-vt2-extract.py [lua|level|navdata|names|all]

  lua      every Lua resource into out/lua/<name hash>, and every path-like string found in them, hashed back to
           names (out/names.tsv: hash, path), so levels and navdata can be named
  level    every .level resource into out/level/<name hash>.level
  navdata  every .navdata resource into out/navdata/<name hash>.navdata
  names    out/lua_names.tsv and out/names.tsv again from what is extracted
"""
import os, re, sys, collections

sys.dont_write_bytecode = True  # nothing written beside the scripts or into anim/
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "anim", "vt2"))
from bundle import GAME  # noqa: E402
from vt2index import murmur64, dctx  # noqa: E402
from files import files  # noqa: E402

OUT = os.path.join(REPO, "levels", "vt2", "out")
INDEX = os.path.join(REPO, "anim", "vt2", "index.tsv")


def by_type(tname):
    """{name hash: bundle file} for one resource type, from anim/vt2's index."""
    t, out = murmur64(tname), {}
    for line in open(INDEX):
        tt, nm, f, sz = line.split()
        if int(tt, 16) == t:
            out.setdefault(int(nm, 16), f)
    return out


def extract(tname, ext):
    want = by_type(tname)
    t = murmur64(tname)
    d = os.path.join(OUT, tname)
    os.makedirs(d, exist_ok=True)
    bundles = collections.defaultdict(set)
    for nm, f in want.items():
        bundles[f].add(nm)
    n = 0
    for k, (f, names) in enumerate(sorted(bundles.items())):
        for tt, nm, vs in files(os.path.join(GAME, f)):
            if tt == t and nm in names:
                data = vs[0][1]
                open(os.path.join(d, f"{nm:016x}{ext}"), "wb").write(data)
                n += 1
        if k % 100 == 0:
            print(tname, k, "of", len(bundles), "bundles", n, "files", file=sys.stderr)
    print(tname, n, "files")


def lua_names():
    """Each Lua resource's source path, from its bytecode's chunk name: out/lua_names.tsv (hash, path)."""
    d = os.path.join(OUT, "lua")
    with open(os.path.join(OUT, "lua_names.tsv"), "w", encoding="utf-8") as fo:
        for fn in sorted(os.listdir(d)):
            m = re.search(rb"@([A-Za-z0-9_/.\-]+?\.lua)", open(os.path.join(d, fn), "rb").read(600))
            fo.write(fn + "\t" + (m.group(1).decode() if m else "") + "\n")


def names():
    """Path-like strings from the Lua and the levels, hashed: out/names.tsv."""
    paths = set()
    for sub in ("lua", "level"):
        d = os.path.join(OUT, sub)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            data = open(os.path.join(d, fn), "rb").read()
            for s in re.findall(rb"[a-z0-9_/\.\-]{4,}", data):
                s = s.decode()
                if "/" in s:
                    paths.add(s.strip("/."))
                    paths.add(s.rsplit(".", 1)[0])
    # sublevel and world paths: every prefix that ends a directory, with the usual leaf names
    extra = set()
    for p in paths:
        parts = p.split("/")
        for i in range(1, len(parts) + 1):
            base = "/".join(parts[:i])
            extra.add(base)
            for leaf in ("world", "world_spawn_zones", "spawn_zones", "navmesh"):
                extra.add(base + "/" + leaf)
    paths |= extra
    with open(os.path.join(OUT, "names.tsv"), "w", encoding="utf-8") as fo:
        for p in sorted(paths):
            fo.write(f"{murmur64(p):016x}\t{p}\n")
    print(len(paths), "names")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("lua", "all"):
        extract("lua", "")
    if what in ("level", "all"):
        extract("level", ".level")
    if what in ("navdata", "all"):
        extract("navdata", ".navdata")
    if what in ("lua", "level", "names", "all"):
        lua_names()
        names()
