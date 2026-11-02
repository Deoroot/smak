"""Each melee sweep's peak hand speed against its damage window (clip time, and action time x time scale):
a check that template, state, clip and decoder line up. Local only."""
import json, math, collections
from anim import read_clip, world
sk = json.load(open("out/fp_skeleton.json")); names, parents = sk["names"], sk["parents"]
B = {n: i for i, n in enumerate(names)}
def inv_apply(m, p):
    d = [p[i] - m[i][3] for i in range(3)]
    return [sum(m[r][c] * d[r] for r in range(3)) for c in range(3)]
FPS, SLACK = 60, 0.05
cache, res = {}, collections.Counter()
miss = []
for r in json.load(open("out/attacks.json")):
    if "/melee/" not in r["state_machine"] or r["kind"] != "sweep" or len(r["states"]) != 1 or len(r["states"][0]["clips"]) != 1:
        continue
    clip = r["states"][0]["clips"][0]
    if clip not in cache:
        c = read_clip(open("out/anim/" + clip, "rb").read())
        hand = []
        for k in range(int(c["length"] * FPS) + 1):
            W = world(c, parents, k / FPS)
            hand.append(inv_apply(W[B["camera_node"]], [W[B["j_rightweaponattach"]][i][3] for i in range(3)]))
        sp = [math.dist(a, b) * FPS for a, b in zip(hand, hand[1:])]
        k = max(range(len(sp)), key=sp.__getitem__)
        cache[clip] = ((k + 0.5) / FPS, sp[k])
    tp, v = cache[clip]
    a, b = r["damage_window"]; s = r["anim_time_scale"] or 1
    inc = a - SLACK <= tp <= b + SLACK
    ina = a * s - SLACK <= tp <= b * s + SLACK
    res["sweeps"] += 1; res["in (clip time)"] += inc; res["in (action time)"] += ina
    if not (inc or ina): miss.append((r["template"].split(".")[-1], r["sub_action"], round(tp, 2), [a, b], round(v, 1)))
print(dict(res))
for m in miss[:25]: print(m)
