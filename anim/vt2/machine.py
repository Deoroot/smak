"""A state machine's clips: the animation hashes found in its bytes, each with the bundle that holds it and its size.
Extracts the machine, its clips and the first-person skeleton into out/ (local only).

    python machine.py units/beings/player/first_person_base/state_machines/melee/1h_sword
"""
import os, sys, struct, collections
from bundle import GAME
from vt2index import index, murmur64, dctx, NAMES
from files import files

here = os.path.dirname(os.path.abspath(__file__))
ANIM, SM, BONES = murmur64("animation"), murmur64("state_machine"), murmur64("bones")
name = sys.argv[1]
d = dctx()
# every bundle's index once (cached)
cache = os.path.join(here, "index.tsv")
if not os.path.exists(cache):
    with open(cache, "w") as out:
        for f in sorted(os.listdir(GAME)):
            if len(f) == 16:
                for t, nm, sz in index(os.path.join(GAME, f), d):
                    out.write(f"{t:016x}\t{nm:016x}\t{f}\t{sz}\n")
where = collections.defaultdict(list)
for line in open(cache):
    t, nm, f, sz = line.split()
    where[(int(t, 16), int(nm, 16))].append((f, int(sz)))
anims = {nm for (t, nm) in where if t == ANIM}


def get(t, nm):
    f, _ = where[(t, nm)][0]
    for tt, n, vs in files(os.path.join(GAME, f)):
        if tt == t and n == nm:
            return vs
    raise KeyError(nm)


sm = get(SM, murmur64(name))[0][1]
os.makedirs(os.path.join(here, "out", "sm"), exist_ok=True)
open(os.path.join(here, "out", "sm", name.replace("/", "~")), "wb").write(sm)
found = []
for at in range(0, len(sm) - 7):
    (v,) = struct.unpack_from("<Q", sm, at)
    if v in anims:
        found.append((at, v))
clips = list(dict.fromkeys(v for _, v in found))
print(f"{name}: {len(sm)} bytes, {len(found)} references to {len(clips)} clips; first offsets {[a for a, _ in found[:12]]}")
os.makedirs(os.path.join(here, "out", "anim"), exist_ok=True)
for v in clips[:400]:
    for lang, data, ssize in get(ANIM, v)[:1]:
        open(os.path.join(here, "out", "anim", f"{v:016x}"), "wb").write(data)
sizes = [where[(ANIM, v)][0][1] for v in clips]
print("clip sizes:", min(sizes), "to", max(sizes), "median", sorted(sizes)[len(sizes) // 2])
