"""Vermintide 2's campaign levels, read for the survey: each level's main path, zones, patrol and boss routes,
smart objects (ledges, jumps) and scripted events, from the game's own Lua (the AI director's baked data). Local
only: reads levels/vt2/out/ (survey-vt2-extract.py, survey-vt2-nav.py first) and writes
levels/vt2/out/levels/<level>.json and levels/vt2/out/corpus.json (the list of levels), which hold level data and
stay there. survey-vt2-measure.mjs turns them into measures.

    anim/vt2/env/Scripts/python.exe levels/tools/survey-vt2.py

WHAT IS READ, per level (paths under levels/<level>/):
  world_spawn_zones.lua    the director's baked data: main_paths (the path from start to end in segments, each
                           its nodes and length), zones (one every 10 m of the path: travel_dist, the area of its
                           sub-zones in m2; "island" zones off the path, with their parent zone), path_markers (where
                           the designer broke the path, and which roaming set holds from there), crossroads
                           (the path's alternative routes), position_lookup (a spawn point per navmesh triangle:
                           used only to check the navmesh decode)
  world_patrol_waypoints   boss, patrol and event routes, each with its travel_dist along the main path
  world_smartobjects       ledges (a drop or climb: its top and bottom), jumps (their flat distance)
  scripts/settings/terror_events/terror_events_<level>.lua   the level's scripted events, step by step
The corpus: every LevelSettings entry with an act, but Versus (act_versus), Weaves (act_scorpion), the prologue
and the hubs; Chaos Wastes (morris) has no act and is left out. 34 levels on this install.
"""
import os, sys, json, struct, importlib.util

sys.dont_write_bytecode = True  # nothing written beside the scripts or into anim/
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "anim", "vt2"))
import luajit  # noqa: E402
from vt2index import murmur64  # noqa: E402

OUT = os.path.join(REPO, "levels", "vt2", "out")
spec = importlib.util.spec_from_file_location("nav", os.path.join(HERE, "survey-vt2-nav.py"))
nav = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nav)

LUA = {}
for line in open(os.path.join(OUT, "lua_names.tsv"), encoding="utf-8"):
    h, n = line.rstrip("\n").split("\t")
    if n:
        LUA[n] = h


def run(path):
    """A Lua file's main chunk, run for its tables: its globals (and '<return>')."""
    h = LUA.get(path)
    if not h:
        return None
    _, protos = luajit.read(open(os.path.join(OUT, "lua", h), "rb").read())
    return luajit.run(protos[-1])[0]


def vec(v):
    return [float(v[1]), float(v[2]), float(v[3])] if isinstance(v, dict) and 1 in v else None


def seq(d):
    """A Lua array (a dict keyed 1..n, the keys sometimes floats) as a list, in order."""
    if not isinstance(d, dict):
        return []
    return [d[k] for k in sorted((k for k in d if isinstance(k, (int, float))), key=float)]


def corpus():
    out = []
    for path in sorted(LUA):
        if "level_settings" not in path:
            continue
        try:
            G = run(path)
        except Exception:
            continue
        for key, s in (G.get("LevelSettings") or {}).items():
            if not isinstance(s, dict) or not isinstance(s.get("level_name"), str):
                continue
            act = s.get("act")
            if not isinstance(act, str) or act in ("act_versus", "act_scorpion", "prologue") or s.get("hub_level"):
                continue
            if s.get("game_mode") not in (None, "adventure") or "/debug/" in s["level_name"]:
                continue
            out.append({"key": key, "level": s["level_name"], "act": act, "display": s.get("display_name"),
                        "boss_level": bool(s.get("boss_level"))})
    seen, uniq = set(), []
    for c in out:
        if c["level"] not in seen:
            seen.add(c["level"])
            uniq.append(c)
    return uniq


def routes(R):
    """Boss, patrol and event routes: (kind, id, travel_dist, one way, number of waypoints)."""
    found = []

    def walk(v, kind):
        if isinstance(v, dict):
            if "travel_dist" in v and "waypoints" in v:
                td = v["travel_dist"]
                found.append({"kind": kind, "id": v.get("id"), "travel_dist": td if isinstance(td, (int, float)) else None,
                              "one_way": bool(v.get("one_directional")), "waypoints": len(v["waypoints"]) if isinstance(v["waypoints"], dict) else 0})
                return
            for x in v.values():
                walk(x, kind)

    for kind in ("boss_waypoints", "patrol_waypoints", "event_waypoints"):
        walk(R.get(kind), kind.split("_")[0])
    return found


def events(G):
    """A terror-event file's events: name, its steps' kinds."""
    R = (G or {}).get("<return>")
    out = {}

    def walk(v):
        if isinstance(v, dict):
            for name, steps in v.items():
                if isinstance(steps, dict) and steps and all(isinstance(k, (int, float)) for k in steps) and                         all(isinstance(s, dict) and isinstance(s.get(1), str) for s in steps.values()):
                    out[name] = [s[1] for s in seq(steps)]
                else:
                    walk(steps)

    walk(R)
    return out


def level(c):
    lev = c["level"]
    base = lev.rsplit("/", 1)[0]
    res = {"level": lev, "key": c["key"], "act": c["act"], "display": c["display"], "boss_level": c["boss_level"]}
    # the navmesh's header: the AI's size it was built for
    nd = os.path.join(OUT, "navdata", f"{murmur64(lev):016x}.navdata")
    if os.path.exists(nd):
        b = open(nd, "rb").read()
        e = "<" if b"2.17" in b[0x2c:0x50] else ">"
        (slen,) = struct.unpack_from(e + "I", b, 0x24)
        s = (slen + 3) // 4 * 4 - 32
        r, h, step, slope = struct.unpack_from(e + "ffff", b, 0x80 + s)
        res["nav"] = {"radius": r, "height": h, "step": step, "slope": slope,
                      "bin": lev.replace("levels/", "").replace("/world", "").replace("/", "~") + ".bin"}
    G = run(base + "/world_spawn_zones.lua")
    if G:
        R = G["<return>"]
        segs = []
        for s in seq(R["main_paths"]):
            segs.append({"length": float(s["path_length"]), "nodes": [vec(n) for n in seq(s["nodes"])],
                         "travel": [float(x) for x in seq(s.get("travel_dist", {}))]})
        zones = []
        for z in R["zones"].values():
            areas = [float(a) for a in seq(z.get("sub_areas", {}))]
            zones.append({"id": z.get("unique_zone_id"), "travel": z.get("travel_dist"), "parent": z.get("parent_zone_id"),
                          "island": z.get("type") == "island", "roof": bool(z.get("on_roof")), "areas": areas,
                          "roaming": z.get("roaming_set")})
        markers = [{"type": m.get("marker_type"), "kind": m.get("kind"), "segment": m.get("main_path_index"),
                    "order": m.get("order"), "pos": vec(m.get("pos")), "roaming": m.get("roaming_set"),
                    "crossroads": m.get("crossroads") or ""} for m in seq(R.get("path_markers", {}))]
        cross = R.get("crossroads") or {}
        res.update({"total_length": R.get("total_main_path_length"), "segments": segs, "zones": zones, "markers": markers,
                    "crossroads": {str(k): (list(v.keys()) if isinstance(v, dict) else v) for k, v in cross.items()},
                    "cover_points": len(R.get("cover_points") or {}) // 5, "spawns": R.get("number_of_spawns")})
    G = run(base + "/world_patrol_waypoints.lua")
    if G:
        res["routes"] = routes(G["<return>"])
    G = run(base + "/world_smartobjects.lua")
    if G:
        so = []
        for lst in (G["<return>"].get("smart_objects") or {}).values():
            for o in lst.values():
                t, p1, p2 = o.get("smart_object_type"), vec(o.get("pos1")), vec(o.get("pos2"))
                d = o.get("data") or {}
                so.append({"type": t, "pos1": p1, "pos2": p2, "jump": d.get("flat_jump_distance"),
                           "fence": bool(d.get("is_on_small_fence")), "two_way": bool(d.get("is_bidirectional"))})
        res["smart_objects"] = so
    name = base.split("/")[-1]
    for cand in (c["key"], name, "dlc_" + name):
        G = run(f"scripts/settings/terror_events/terror_events_{cand}.lua")
        if G:
            res["terror_events"] = events(G)
            res["terror_file"] = cand
            break
    return res


if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "levels"), exist_ok=True)
    cs = corpus()
    json.dump(cs, open(os.path.join(OUT, "corpus.json"), "w"), indent=1)
    for c in cs:
        r = level(c)
        safe = c["level"].replace("levels/", "").replace("/world", "").replace("/", "~")
        json.dump(r, open(os.path.join(OUT, "levels", safe + ".json"), "w"))
        print(f"{c['key']:24} {c['act']:20} segs {len(r.get('segments', [])):3} zones {len(r.get('zones', [])):4} "
              f"routes {len(r.get('routes', [])):3} so {len(r.get('smart_objects', [])):5} events {len(r.get('terror_events', {})):3} "
              f"nav {'yes' if 'nav' in r else 'NO'} {r.get('terror_file', '-')}")
    print(len(cs), "levels")
