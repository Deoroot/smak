"""Extract one resource by type and path into out/res/ (local only)."""
import os, sys, collections
from bundle import GAME
from vt2index import murmur64
from files import files
here = os.path.dirname(os.path.abspath(__file__))
t, name = murmur64(sys.argv[1]), murmur64(sys.argv[2])
for line in open(os.path.join(here, "index.tsv")):
    tt, nm, f, sz = line.split()
    if int(tt, 16) == t and int(nm, 16) == name:
        for a, b, vs in files(os.path.join(GAME, f)):
            if a == t and b == name:
                os.makedirs(os.path.join(here, "out", "res"), exist_ok=True)
                out = os.path.join(here, "out", "res", sys.argv[2].replace("/", "~") + "." + sys.argv[1])
                open(out, "wb").write(vs[0][1]); print(out, len(vs[0][1]), "stream", vs[0][2]); raise SystemExit
print("not found")
