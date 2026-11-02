"""Every printable string of the game's Lua (and other text-bearing types), deduplicated, into names.txt, and the
Lua files themselves into out/lua/<hash>. Local only: for recovering names, never shared.

    python strings.py
"""
import os, re, sys
from bundle import GAME
from vt2index import index, murmur64, dctx
from files import files

LUA = murmur64("lua")
WANT = {LUA, murmur64("package"), murmur64("state_machine"), murmur64("unit"), murmur64("flow")}
here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, "out", "lua"), exist_ok=True)
d = dctx()
seen_files, strings = set(), set()
bundles = [f for f in sorted(os.listdir(GAME)) if len(f) == 16]
for k, f in enumerate(bundles):
    p = os.path.join(GAME, f)
    if not any(t in WANT for t, _, _ in index(p, d)):
        continue
    for t, nm, vs in files(p):
        if t not in WANT or (t, nm) in seen_files:
            continue
        seen_files.add((t, nm))
        data = vs[0][1]
        if t == LUA:
            open(os.path.join(here, "out", "lua", f"{nm:016x}"), "wb").write(data)
        for s in re.findall(rb"[\x20-\x7e]{4,}", data):
            strings.add(s.decode())
    if k % 500 == 0:
        print(k, len(seen_files), len(strings), file=sys.stderr)
open(os.path.join(here, "names.txt"), "w", encoding="utf-8").write("\n".join(sorted(strings)))
print(len(seen_files), "files read,", len(strings), "strings")
