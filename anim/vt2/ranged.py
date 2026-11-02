"""Ranged clips checked: the shot's kick against fire_time, the off hand against the weapon (held still on it while
shooting, moving when reloading), and the weapon's parts the clip moves. Local only."""
import json, math, collections, statistics as st
from anim import read_clip, world
sk = json.load(open("out/fp_skeleton.json")); names, parents = sk["names"], sk["parents"]
B = {n: i for i, n in enumerate(names)}
def inv(m, p):
    d = [p[i] - m[i][3] for i in range(3)]
    return [sum(m[r][c] * d[r] for r in range(3)) for c in range(3)]
pos = lambda W, b: [W[B[b]][i][3] for i in range(3)]
FPS = 60
seen, out = set(), collections.defaultdict(list)
for r in json.load(open("out/attacks.json")):
    if r["family"] != "ranged" or r["template"].endswith("_vs") or r["melee"] or not r["states"]: continue
    side = "right" if "right" in r["units"] else "left"
    other = "left" if side == "right" else "right"
    for s in r["states"]:
        clip = s["clips"][0]
        if (clip, side) in seen: continue
        seen.add((clip, side))
        c = read_clip(open("out/anim/" + clip, "rb").read())
        n = int(c["length"] * FPS) + 1
        off, att, comps = [], [], collections.defaultdict(list)
        for k in range(n):
            W = world(c, parents, k / FPS)
            A = W[B[f"j_{side}weaponattach"]]
            off.append(inv(A, pos(W, f"j_{other}hand")))          # the off hand in the weapon's space
            att.append(inv(W[B["camera_node"]], pos(W, f"j_{side}weaponattach")))
            for j in range(1, 41):
                comps[j].append(inv(A, pos(W, f"j_{side}weaponcomponent{j}")))
        med = [st.median(x[i] for x in off) for i in range(3)]
        offspread = max(math.dist(p, med) for p in off)
        moving = sum(1 for j, ps in comps.items() if max(math.dist(p, ps[0]) for p in ps) > 0.01)
        sp = [math.dist(a, b) * FPS for a, b in zip(att, att[1:])]
        kick = (max(range(len(sp)), key=sp.__getitem__) + 0.5) / FPS if sp else None
        what = "reload" if "reload" in r["anim_event"] else ("shot" if "shoot" in r["anim_event"] else r["kind"])
        out[what].append(dict(t=r["template"].split(".")[-1], ev=r["anim_event"], fire=r["fire_time"], kick=kick,
                              off=offspread, parts=moving, side=side, length=c["length"]))
for what in ("shot", "reload"):
    rows = out[what]
    print(f"{what}: {len(rows)} clips; off hand's most move against the weapon (m): median {st.median(x['off'] for x in rows):.3f};"
          f" weapon parts moved: median {st.median(x['parts'] for x in rows)}, clips with any {sum(x['parts']>0 for x in rows)}")
    for x in rows[:12]:
        print(f"   {x['t'][:30]:30} {x['ev'][:24]:24} {x['side'][0]} fire {x['fire']} kick {x['kick']:.2f}s off {x['off']:.3f} m parts {x['parts']}")
shots = [x for x in out["shot"] if isinstance(x["fire"], (int, float))]
near = sum(1 for x in shots if abs(x["kick"] - x["fire"]) <= 0.1)
print(f"kick within 0.1 s of fire_time: {near} of {len(shots)}")
