"""Names back from hashes: every path-like string of names.txt hashed, matched against every bundle's index.
Writes known.tsv (type, name hash, path, bundle) and prints how many of each type are named.

    python resolve.py
"""
import os, re, collections
from bundle import GAME
from vt2index import index, murmur64, dctx, NAMES

here = os.path.dirname(os.path.abspath(__file__))
ROOTS = r"(?:units|animations|scripts|resource_packages|content|core|levels|materials|particles|wwise|gui|textures|environment|fx|foliage|dialogues|cutscene)"
paths = set()
for line in open(os.path.join(here, "names.txt"), encoding="utf-8"):
    for m in re.finditer(ROOTS + r"/[a-z0-9_/\.\-]+", line):
        p = m.group(0).rstrip("/.")
        paths.add(p)
        # a path with an extension written in: try it without
        if "." in p.rsplit("/", 1)[-1]:
            paths.add(p.rsplit(".", 1)[0])
print(len(paths), "path-like strings")
by_hash = {murmur64(p): p for p in paths}

d = dctx()
named, total = collections.Counter(), collections.Counter()
rows = []
for f in sorted(os.listdir(GAME)):
    if len(f) != 16:
        continue
    for t, nm, sz in index(os.path.join(GAME, f), d):
        total[t] += 1
        if nm in by_hash:
            named[t] += 1
            rows.append(f"{NAMES.get(t, hex(t))}\t{nm:016x}\t{by_hash[nm]}\t{f}\t{sz}")
open(os.path.join(here, "known.tsv"), "w", encoding="utf-8").write("\n".join(rows))
for t, n in total.most_common(16):
    print(f"{NAMES.get(t, hex(t)):22} {named[t]:7} of {n:7} named")
