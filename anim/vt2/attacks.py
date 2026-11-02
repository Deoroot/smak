"""Every action of the melee and ranged weapon templates, with the clips it plays: template, action and sub-action,
kind, each animation event it can play (anim_event and its variants), damage window or fire time, total time and
time scale, the state machine, and the states and clips the events lead to, followed through the combo chains, with
their blend-in times. Writes out/attacks.json, out/templates.json (each template's
weapon layer and idle clips) and extracts the clips into out/anim/ (local only).

    python attacks.py [template-name-filter]
"""
import os, sys, json, collections
from bundle import GAME
from vt2index import murmur64, dctx
from files import files
import luajit, statemachine

here = os.path.dirname(os.path.abspath(__file__))
ANIM, SM, LUA = murmur64("animation"), murmur64("state_machine"), murmur64("lua")
where = collections.defaultdict(list)
for line in open(os.path.join(here, "index.tsv")):
    t, nm, f, sz = line.split()
    where[(int(t, 16), int(nm, 16))].append(f)
anims = {nm for (t, nm) in where if t == ANIM}
H64 = {}
for line in open(os.path.join(here, "ident_hashes.tsv")):
    h, s = line.rstrip("\n").split("\t"); H64[int(h, 16)] = s
_bundles = {}


def get(t, nm):
    f = where[(t, nm)][0]
    if f not in _bundles:
        _bundles[f] = {(tt, n): vs for tt, n, vs in files(os.path.join(GAME, f))}
        if len(_bundles) > 8: _bundles.pop(next(iter(_bundles)))
    return _bundles[f][(t, nm)][0][1]


def templates(G):
    """(name, template) for every table set into a global that has actions."""
    for gname, g in G.items():
        if not isinstance(g, dict): continue
        for k, v in g.items():
            if isinstance(v, dict) and isinstance(v.get("actions"), dict):
                yield f"{gname}.{k}", v


def walk(tpl, layers):
    """The states each action's events play, followed through the template's chains (allowed_chain_actions): an
    action's entry (its "default" sub-action) starts from the weapon layer's idle states; an event moves from each
    state the player can be in to its transition's target (the state named as the event if none of them takes it);
    an action chained to starts from the states the one before it played. Returns {(action, sub-action, event):
    (layer, [(layer, index, state, sources)])}."""
    subs = {(a, s): sub for a, act in tpl["actions"].items() if isinstance(act, dict)
            for s, sub in act.items() if isinstance(sub, dict) and "kind" in sub}
    events = lambda sub: [v for k, v in sub.items() if (k == "anim_event" or k.startswith("anim_event_")) and isinstance(v, str)]
    # the weapon layer: where most of the template's events are named states, past the first (locomotion)
    c = collections.Counter(i for sub in subs.values() for ev in events(sub)
                            for i, k, st, src in statemachine.resolve(layers, murmur64(ev)) if i > 0 and st["clips"])
    if not c: return {}
    L = c.most_common(1)[0][0]
    states = layers[L]["states"]
    idle = {k for k, st in enumerate(states) if st["name"] == murmur64("idle")} or set(range(len(states)))
    # the arms' idle pose: the weapon layer's idle states are empty (nothing layered), the locomotion layer's
    # (the first) hold the clip
    IDLES[id(tpl)] = (L, sorted({f"{c:016x}" for st in layers[0]["states"] if st["name"] == murmur64("idle") for c in st["clips"]}))
    ctx = {key: set() for key in subs}
    for (a, s) in subs:
        if s == "default": ctx[(a, s)] |= idle
    out, changed = {}, True
    while changed:
        changed = False
        for key, sub in subs.items():
            if not ctx[key]: continue
            after = set()
            for ev in events(sub):
                hi, h64 = murmur64(ev) >> 32, murmur64(ev)
                hits = {}
                for k in ctx[key]:
                    for h, t in states[k]["events"]:
                        if h == hi and states[k]["trans"][t][0] < len(states):
                            tr = states[k]["trans"][t]
                            hits.setdefault(tr[0], []).append((states[k]["name"], tr[1]))
                if not hits:
                    hits = {k: [] for k, st in enumerate(states) if st["name"] == h64}
                out[(key[0], key[1], ev)] = (L, [(L, k, states[k], src) for k, src in sorted(hits.items())])
                if ev == sub.get("anim_event"): after |= set(hits) or ctx[key]
            for ch in (sub.get("allowed_chain_actions") or {}).values():
                if isinstance(ch, dict) and (ch.get("action"), ch.get("sub_action")) in ctx:
                    nxt = ctx[(ch["action"], ch["sub_action"])]
                    if not after <= nxt:
                        nxt |= after; changed = True
    return out


IDLES = {}
MELEE = {"sweep", "push_stagger", "shield_slam", "lunge"}
FAMILY = {"/melee/": "melee", "/ranged/": "ranged"}
want = sys.argv[1] if len(sys.argv) > 1 else ""
machines, rows, seen, TEMPLATES = {}, [], set(), {}
lua_dir = os.path.join(here, "out", "lua")
for f in sorted(os.listdir(lua_dir)):
    b = open(os.path.join(lua_dir, f), "rb").read()
    if b"state_machine" not in b or b"actions" not in b: continue
    try:
        src, protos = luajit.read(b)
        G, _ = luajit.run(protos[-1])
    except Exception as e:
        print("skip", f, e, file=sys.stderr); continue
    for tname, tpl in templates(G):
        smname = tpl.get("state_machine")
        if want not in tname or not isinstance(smname, str) or tname in seen: continue
        family = next((v for k, v in FAMILY.items() if k in smname), None)
        if family is None: continue  # careers' skills, carried objects
        seen.add(tname)
        if smname not in machines:
            try:
                machines[smname] = statemachine.read(get(SM, murmur64(smname)), anims)
            except (KeyError, IndexError):
                machines[smname] = None
        layers = machines[smname]
        played = walk(tpl, layers) if layers else {}
        L, idles = IDLES.get(id(tpl), (None, []))
        TEMPLATES[tname] = dict(family=family, state_machine=smname, layer=L, idle_clips=idles,
                                units={h: tpl.get(f"{h}_hand_unit") for h in ("right", "left") if isinstance(tpl.get(f"{h}_hand_unit"), str)})
        for aname, action in tpl["actions"].items():
            if not isinstance(action, dict): continue
            for sname, sub in action.items():
                if not isinstance(sub, dict) or "kind" not in sub: continue
                # every event the action can play: anim_event, and its variants (last ammo, no ammo left, the
                # reload it plays after, ...)
                for field, ev in sub.items():
                    if not (field == "anim_event" or field.startswith("anim_event_")) or not isinstance(ev, str):
                        continue
                    ctx = played.get((aname, sname, ev))
                    hits = ctx[1] if ctx else (statemachine.resolve(layers, murmur64(ev)) if layers else [])
                    rows.append(dict(
                        template=tname, family=family, source=src, action=aname, sub_action=sname,
                        kind=sub["kind"], melee=sub["kind"] in MELEE, event_field=field, anim_event=ev,
                        damage_window=[sub.get("damage_window_start"), sub.get("damage_window_end")],
                        fire_time=sub.get("fire_time"), reload_time=sub.get("reload_time"),
                        total_time=sub.get("total_time"), anim_time_scale=sub.get("anim_time_scale"),
                        state_machine=smname, by_chain=bool(ctx),
                        # where the action may give way to another, and from when (seconds of the action)
                        chains=[dict(action=ch.get("action"), sub_action=ch.get("sub_action"), start_time=ch.get("start_time"),
                                     input=ch.get("input"))
                                for ch in (sub.get("allowed_chain_actions") or {}).values() if isinstance(ch, dict)],
                        units={h: tpl.get(f"{h}_hand_unit") for h in ("right", "left") if isinstance(tpl.get(f"{h}_hand_unit"), str)},
                        states=[dict(layer=i, index=k, name=H64.get(s["name"], f"{s['name']:016x}"), kind=s["kind"],
                                     clips=[f"{c:016x}" for c in s["clips"]], weights=list(s["weights"]),
                                     blend=len(s["clips"]) > 1,
                                     from_states=sorted({H64.get(x[0] if isinstance(x, tuple) else x, "?") for x in src}),
                                     # the crossfade into the state (s), as the transitions from those states set it
                                     blend_in=sorted({round(x[1], 3) for x in src if isinstance(x, tuple)}))
                                for i, k, s, src in hits]))
# keep the template's own layer: the layer most of its events lead to, leaving out the first (locomotion: run,
# walk, idle, whose states every event can also move). The states left are the action's variants.
home = {}
for t in {r["template"] for r in rows}:
    c = collections.Counter(s["layer"] for r in rows if r["template"] == t for s in r["states"] if s["layer"] > 0 and s["clips"])
    home[t] = c.most_common(1)[0][0] if c else None
for r in rows:
    r["states"] = [s for s in r["states"] if s["layer"] == home[r["template"]] and s["clips"]]
os.makedirs(os.path.join(here, "out", "anim"), exist_ok=True)
clips = {c for r in rows for s in r["states"] for c in s["clips"]} | {c for t in TEMPLATES.values() for c in t["idle_clips"]}
for c in sorted(clips):
    p = os.path.join(here, "out", "anim", c)
    if not os.path.exists(p):
        open(p, "wb").write(get(ANIM, int(c, 16)))
json.dump(rows, open(os.path.join(here, "out", "attacks.json"), "w"), indent=1)
json.dump(TEMPLATES, open(os.path.join(here, "out", "templates.json"), "w"), indent=1)
chained = sum(1 for r in rows if r["by_chain"])
one = sum(1 for r in rows if len(r["states"]) == 1 and len(r["states"][0]["clips"]) == 1)
none = sum(1 for r in rows if not r["states"])
blends = sum(1 for r in rows if any(s["blend"] for s in r["states"]))
print(f"{len(seen)} templates, {len(machines)} state machines ({sum(1 for m in machines.values() if m is None)} not found), "
      f"{len(rows)} actions' events: {one} to one clip, {none} unresolved, {len(rows) - one - none} to variants or blends ({blends} with a blend); {chained} followed through the chains; {len(clips)} clips")
