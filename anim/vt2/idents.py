"""Every identifier-like string of names.txt hashed (MurmurHash64A), for naming states and events back:
idents.txt and ident_hashes.tsv (hash, string). Local only.

    python idents.py
"""
import os, re
from vt2index import murmur64

here = os.path.dirname(os.path.abspath(__file__))
ids = set()
for line in open(os.path.join(here, "names.txt"), encoding="utf-8"):
    for m in re.finditer(r"[a-z][a-z0-9_]{2,60}", line):
        ids.add(m.group(0))
# a LuaJIT string's length byte can read as a letter stuck to its front
cand = ids | {s[1:] for s in ids}
with open(os.path.join(here, "ident_hashes.tsv"), "w") as f:
    for s in sorted(cand):
        if len(s) >= 3:
            f.write(f"{murmur64(s):016x}\t{s}\n")
print(len(cand), "strings hashed")
