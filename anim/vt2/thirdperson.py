"""The third person: what a weapon's events play on the body other players see. For each hero who can wield one of
the weapon templates (the item lists' can_wield), the hero's third-person state machine
(units/beings/player/<hero>/third_person_base/chr_third_person_base) and skeleton
(units/beings/player/third_person_base/<hero>/chr_third_person_base: bones and unit) are read; the template's
wield_anim (to_1h_sword) moves each layer to the weapon's states, and every event of the template's actions
(out/attacks.json) is followed from there, layer by layer, to the states and clips it plays, with their blend-in.
Writes out/attacks3p.json, out/tp_skeleton_<hero>.json, the machines and skeletons into out/res/ and the clips into
out/anim/ (all local only).

    python thirdperson.py [state machine suffix, default melee/1h_sword]

What was found (Kruber's machine; the others are laid out alike): layer 0, some 1,600 states, is the whole body's
locomotion (idle, move, land, per wielded weapon: to_1h_sword sends it to the sword's set); layer 2, 388 states, is
the weapon layer (to_1h_sword sends it to an empty idle: nothing is layered until an attack); the attacks are there.
Needs statemachine.read with a higher limit (the locomotion layer's transitions reach state 1,600) and split (the
weapon layer's first state is of a kind not read; the layers after it ran into each other).
"""
import os, sys, json, pickle, collections
from bundle import GAME
from vt2index import murmur64
from files import files
import luajit, statemachine, skeleton

here = os.path.dirname(os.path.abspath(__file__))
ANIM, SM, BONES, UNIT = (murmur64(t) for t in ("animation", "state_machine", "bones", "unit"))
# a career's prefix in can_wield, and the hero whose third-person machine it plays on
HERO = {"es": "empire_soldier", "bw": "bright_wizard", "we": "way_watcher", "wh": "witch_hunter", "dr": "dwarf_ranger"}
H = {}
for line in open(os.path.join(here, "ident_hashes.tsv")):
    h, s = line.rstrip("\n").split("\t"); H[int(h, 16)] = s
name = lambda h: H.get(h, f"{h:016x}")
where = collections.defaultdict(list)
for line in open(os.path.join(here, "index.tsv")):
    t, nm, f, sz = line.split()
    where[(int(t, 16), int(nm, 16))].append(f)
anims = {nm for (t, nm) in where if t == ANIM}
_bundle = {}


def get(t, nm):
    """One resource's bytes, the last bundle opened kept (they are large)."""
    f = where[(t, nm)][0]
    if f not in _bundle:
        _bundle.clear()
        _bundle[f] = {(tt, n): vs for tt, n, vs in files(os.path.join(GAME, f))}
    return _bundle[f][(t, nm)][0][1]


def res(t, path):
    """A resource by type and path, kept in out/res/."""
    out = os.path.join(here, "out", "res", path.replace("/", "~") + "." + {SM: "state_machine", BONES: "bones", UNIT: "unit"}[t])
    if not os.path.exists(out):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "wb").write(get(t, murmur64(path)))
    return out


def lua():
    """The weapon templates' wield_anim, and which careers can wield each template (every ItemMasterList)."""
    wield, careers = {}, collections.defaultdict(set)
    d = os.path.join(here, "out", "lua")
    for f in sorted(os.listdir(d)):
        b = open(os.path.join(d, f), "rb").read()
        if b"wield_anim" not in b and b"ItemMasterList" not in b: continue
        try:
            G, _ = luajit.run(luajit.read(b)[1][-1])
        except Exception:
            continue
        for gname, g in G.items():
            if not isinstance(g, dict): continue
            for k, v in g.items():
                if isinstance(v, dict) and isinstance(v.get("actions"), dict) and isinstance(v.get("wield_anim"), str):
                    wield.setdefault(k, v["wield_anim"])
        for v in (G.get("ItemMasterList") or {}).values():
            if isinstance(v, dict) and isinstance(v.get("template"), str):
                cw = v.get("can_wield")
                careers[v["template"]] |= {c for c in (cw.values() if isinstance(cw, dict) else []) if isinstance(c, str)}
    return wield, careers


def machine(hero):
    path = res(SM, f"units/beings/player/{hero}/third_person_base/chr_third_person_base")
    cache = path + ".layers.pkl"
    if os.path.exists(cache): return pickle.load(open(cache, "rb"))
    L = statemachine.read(open(path, "rb").read(), anims, 4096, True)
    pickle.dump(L, open(cache, "wb"))
    return L


def step(states, src, ev):
    """{target index: [(source state name, blend time)]} for an event from the source states."""
    hi = murmur64(ev) >> 32
    out = collections.defaultdict(list)
    for k in src:
        for h, t in states[k]["events"]:
            if h == hi and t < len(states[k]["trans"]) and states[k]["trans"][t][0] < len(states):
                tr = states[k]["trans"][t]
                out[tr[0]].append((name(states[k]["name"]), round(tr[1], 3)))
    return out


def follow(L, wield, events):
    """Per layer that hears the wield event: the weapon's own states (its targets) and each event's targets from
    every state the weapon's events can leave the player in (the closure from those)."""
    got = {}
    for li, layer in enumerate(L):
        if not layer["exact"]: continue
        st = layer["states"]
        home = step(st, range(len(st)), wield)
        if not home: continue
        reach, changed = set(home), True
        while changed:
            changed = False
            for ev in events:
                for k in step(st, reach, ev):
                    if k not in reach: reach.add(k); changed = True
        got[li] = (home, {ev: step(st, reach, ev) for ev in events})
    return got


def state(st, k, srcs):
    s = st[k]
    return dict(index=k, name=name(s["name"]), kind=s["kind"], clips=[f"{c:016x}" for c in s["clips"]],
                weights=[round(w, 4) for w in s["weights"]], from_states=sorted({a for a, _ in srcs}),
                blend_in=sorted({b for _, b in srcs}))


def extract(clips):
    want = {int(c, 16) for c in clips if not os.path.exists(os.path.join(here, "out", "anim", c))}
    by = collections.defaultdict(set)
    for c in want: by[where[(ANIM, c)][0]].add(c)
    for f, cs in by.items():
        for t, n, vs in files(os.path.join(GAME, f)):
            if t == ANIM and n in cs:
                open(os.path.join(here, "out", "anim", f"{n:016x}"), "wb").write(vs[0][1])


if __name__ == "__main__":
    suffix = sys.argv[1] if len(sys.argv) > 1 else "melee/1h_sword"
    rows = [r for r in json.load(open(os.path.join(here, "out", "attacks.json")))
            if r["state_machine"].endswith("/" + suffix) and not r["template"].endswith("_vs")]
    wield, careers = lua()
    by_tpl = collections.defaultdict(list)
    for r in rows: by_tpl[r["template"].split(".")[-1]].append(r)
    out = dict(suffix=suffix, heroes={}, rows=[])
    clips = set()
    for hero in sorted({HERO[c.split("_")[0]] for t in by_tpl for c in careers.get(t, ()) if c.split("_")[0] in HERO}):
        L = machine(hero)
        sk_path = f"units/beings/player/third_person_base/{hero}/chr_third_person_base"
        names, parents = skeleton.skeleton(res(UNIT, sk_path), res(BONES, sk_path))
        json.dump({"names": names, "parents": parents, "path": sk_path}, open(os.path.join(here, "out", f"tp_skeleton_{hero}.json"), "w"))
        info = dict(skeleton=f"tp_skeleton_{hero}.json", layers=[dict(states=len(x["states"]), exact=x["exact"]) for x in L], idle={})
        for tname, trows in by_tpl.items():
            if not any(HERO.get(c.split("_")[0]) == hero for c in careers.get(tname, ())): continue
            w = wield.get(tname)
            got = follow(L, w, sorted({r["anim_event"] for r in trows}))
            info["idle"][tname] = {str(li): [state(L[li]["states"], k, s) for k, s in sorted(home.items())] for li, (home, _) in got.items()}
            for li, (home, _) in got.items():
                clips |= {c for k in home for c in (f"{x:016x}" for x in L[li]["states"][k]["clips"])}
            for r in trows:
                tp = [dict(layer=li, **state(L[li]["states"], k, s)) for li, (_, evs) in got.items() for k, s in sorted(evs[r["anim_event"]].items())]
                clips |= {c for s in tp for c in s["clips"]}
                out["rows"].append(dict(hero=hero, template=tname, wield_anim=w, action=r["action"], sub_action=r["sub_action"], kind=r["kind"],
                                        event_field=r["event_field"], anim_event=r["anim_event"], damage_window=r["damage_window"],
                                        anim_time_scale=r["anim_time_scale"], total_time=r["total_time"], chains=r["chains"],
                                        fp=[dict(name=s["name"], clips=s["clips"], blend_in=s["blend_in"]) for s in r["states"]], tp=tp))
        out["heroes"][hero] = info
        print(hero, {t: len([x for x in out["rows"] if x["hero"] == hero and x["template"] == t]) for t in by_tpl}, file=sys.stderr)
    extract(clips)
    json.dump(out, open(os.path.join(here, "out", "attacks3p.json"), "w"), indent=1)
    one = sum(1 for r in out["rows"] if len(r["tp"]) == 1 and len(r["tp"][0]["clips"]) == 1)
    print(f"{len(out['heroes'])} heroes, {len(out['rows'])} events: {one} to one third-person clip, "
          f"{sum(1 for r in out['rows'] if not r['tp'])} to none; {len(clips)} clips")
