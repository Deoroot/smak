import os, json, math
from anim import read_clip, world
sk = json.load(open("out/fp_skeleton.json")); names, parents = sk["names"], sk["parents"]
B = {n: i for i, n in enumerate(names)}
def inv_apply(m, p):
    d = [p[i] - m[i][3] for i in range(3)]
    return [sum(m[r][c] * d[r] for r in range(3)) for c in range(3)]
rows = []
for f in sorted(os.listdir("out/anim")):
    c = read_clip(open("out/anim/" + f, "rb").read())
    if c["length"] < 0.3: continue
    n = max(2, int(c["length"] * 30) + 1)
    hand = []
    for k in range(n):
        W = world(c, parents, c["length"] * k / (n - 1))
        cam = W[B["camera_node"]]
        hand.append(inv_apply(cam, [W[B["j_rightweaponattach"]][i][3] for i in range(3)]))
    sp = [math.dist(a, b) * 30 for a, b in zip(hand, hand[1:])]
    rows.append((max(sp), c["length"], f, len(c["events"]), sum(math.dist(a, b) for a, b in zip(hand, hand[1:]))))
rows.sort(reverse=True)
print("peak hand speed (m/s, in the camera's space), length, clip, events, path (m)")
for r in rows[:25]: print(f"{r[0]:6.2f} {r[1]:5.2f}s {r[2]} ev{r[3]} path {r[4]:.2f}")
