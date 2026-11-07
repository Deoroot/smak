// npc-sim.mjs: an offline check of what plugin/smak_npc.sma assumes of a map's smak-rp/1 JSON.
//
//   node levels/rp/npc-sim.mjs <map>.rp.json [--cap 24] [--workers 6] [--verbose]
//
// It repeats, in Node, the plugin's reading of the JSON (the same rules, written twice on purpose: a change to
// one without the other shows here):
//   - the NPC graph: only `walk` and `stair` links; a link with a gate is let through only when the gate is a
//     plain `door` whose property is a shop or a public door (anyone's), or the NPC's own home / own shop.
//     Gates (checkpoints), lids, grates, secret doors, trapdoors, ladders and jump-downs are never taken.
//   - the roles and their counts (keepers from the places' kinds, workers, citizens, up to the cap)
//   - for each NPC: its home and work nodes exist, and a route exists home -> work -> evening spot -> home.
// Answers PASS / FAIL on the last line; every failure above it says which NPC and which pair.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { badStops, STOP_CLEAR } from "./paths.mjs";

export const KEEPER_KINDS = { shop: "shopkeeper", bar: "barman", clinic: "medic", workshop: "mechanic" };
const SAFE_PROPS = new Set(["shop", "public"]);
export const GUARDS_DEFAULT = 4; // smak_guard_count
export const MAX_NPC = 40; // the plugin's hard cap, guards included
export const MAX_GUARDS = 8;
export const MAX_WP = 24;
const GUARD_PATROL_PROPS = new Set(["shop", "public", "police"]); // what a patrolling guard may enter
const WALK_SPEED = 100; // smak_npc_walk

/**
 * The ids smak_npc.sma gives its people (smak_npc_find, the entity's targetname): a keeper is <role>_<place id>, workers
 * worker_01.., citizens citizen_01.., in the order the plugin makes them. Same inputs, same ids: no random call decides
 * them. A keeper whose place or home has no node is left out, as the plugin leaves it out.
 */
export function npcIds(rp, { cap = 24, workers = 6, guards = GUARDS_DEFAULT } = {}) {
  const r = analyse(JSON.parse(JSON.stringify(rp)), { cap, workers, guards });
  const people = (r.npcs ?? []).filter((n) => n.home && (n.role === "citizen" || n.work !== undefined)).map((n) => n.id);
  return people.concat(r.guards?.ids ?? []);
}

export function analyse(rp, { cap = 24, workers = 6, verbose = false, guards: guardCount = GUARDS_DEFAULT } = {}) {
  const out = { errors: [], warns: [], info: [] };
  const err = (s) => out.errors.push(s);
  const warn = (s) => out.warns.push(s);
  if (rp.format !== "smak-rp/1") err(`format is ${rp.format}, not smak-rp/1`);
  const paths = rp.paths;
  if (!paths || !paths.nodes || !paths.links) {
    err("the JSON has no paths graph");
    return out;
  }
  const nodes = paths.nodes;
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const MAXN = 1024;
  if (nodes.length > MAXN) err(`${nodes.length} nodes: the plugin holds ${MAXN}`);

  // properties by door name
  const prefix = rp.map + "_";
  const propOfDoor = new Map();
  rp.properties.forEach((p, i) => p.doors.forEach((d) => propOfDoor.set(d, i)));

  // edges: [a, b, len, propIndex or -1]; directed
  const edges = [];
  let skipped = {};
  const skip = (why) => (skipped[why] = (skipped[why] || 0) + 1);
  for (const l of paths.links) {
    const a = byId.get(l.a), b = byId.get(l.b);
    if (a === undefined || b === undefined) { err(`link ${l.a} - ${l.b} names a missing node`); continue; }
    if (l.how !== "walk" && l.how !== "stair") { skip("how " + l.how); continue; }
    let prop = -1;
    if (l.gate) {
      if (l.gate !== "door") { skip("gate " + l.gate); continue; }
      prop = propOfDoor.has(l.via) ? propOfDoor.get(l.via) : -2;
      if (prop === -2) { skip("door of no property"); continue; }
    }
    const A = nodes[a].at, B = nodes[b].at;
    const len = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    const way = l.way ? 1 : 0; // a way down's stair: civilians never take it (smak_npc.sma edge_ok), a guard only hunting
    edges.push([a, b, len, prop, way]);
    if (!l.oneWay) edges.push([b, a, len, prop, way]);
  }
  out.edges = edges.length;
  out.skipped = skipped;
  if (edges.length > 4096) err(`${edges.length} directed edges: the plugin holds 4096`);
  const adj = nodes.map(() => []);
  for (const e of edges) adj[e[0]].push(e);

  // can this NPC pass edge e? (own = set of property indexes it may enter beyond shop/public)
  const passable = (e, own) => !e[4] && (e[3] < 0 || SAFE_PROPS.has(rp.properties[e[3]].kind) || own.has(e[3]));
  function route(from, to, own) {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const done = new Uint8Array(nodes.length);
    dist[from] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const e of adj[u]) {
        if (!passable(e, own)) continue;
        const nd = dist[u] + e[2] + (e[3] >= 0 ? 40 : 0);
        if (nd < dist[e[1]]) dist[e[1]] = nd;
      }
    }
    return dist[to];
  }
  function reachable(from, own) {
    const seen = new Uint8Array(nodes.length);
    const st = [from];
    seen[from] = 1;
    while (st.length) {
      const u = st.pop();
      for (const e of adj[u]) if (!seen[e[1]] && passable(e, own)) { seen[e[1]] = 1; st.push(e[1]); }
    }
    return seen;
  }

  // places -> nodes; homes -> nodes
  const placeNode = new Map();
  nodes.forEach((n, i) => { if (n.kind === "place" && n.place) placeNode.set(n.place, i); });
  const homeNodeOf = (p) => {
    for (const room of p.rooms || []) {
      const part = `${p.building}.${room}`;
      let i = nodes.findIndex((n) => n.part === part && n.kind === "room");
      if (i < 0) i = nodes.findIndex((n) => n.part === part && n.kind === "place");
      if (i < 0) i = nodes.findIndex((n) => n.part === part && n.kind === "door" && n.approach);
      if (i >= 0) return i;
    }
    return -1;
  };
  const homes = [];
  rp.properties.forEach((p, i) => {
    if (p.kind !== "home") return;
    const n = homeNodeOf(p);
    if (n < 0) warn(`home ${p.id} has no node (rooms ${(p.rooms || []).join(",")})`);
    else homes.push({ prop: i, id: p.id, building: p.building, district: p.district, node: n });
  });

  // ---- the guards (smak_npc.sma "guards"): waypoints, the graph they walk, what they reach -------------------------
  // Waypoints: the nodes of places of a police kind (police, guard, post, booking); failing those, of police properties;
  // then both sides of each checkpoint gate. A guard walks through every gate; a patrol enters shops, public halls and
  // police rooms; a hunt goes everywhere through the doors that are not locked; a hunt at 3 stars also through locked ones.
  const wp = [];
  const wpAdd = (i) => { if (i !== undefined && i >= 0 && wp.length < MAX_WP && !wp.includes(i)) { wp.push(i); return true; } return false; };
  let wpSrc = "none";
  for (const pl of rp.places) {
    const k = String(pl.kind || "").toLowerCase();
    if ((k.includes("police") || k.includes("guard") || k === "post" || k === "booking") && wpAdd(placeNode.get(pl.id))) wpSrc = "places";
  }
  if (!wp.length) {
    for (const p of rp.properties) if (p.kind === "police" && wpAdd(homeNodeOf(p))) wpSrc = "police properties";
  }
  const posts = wp.length;
  for (const l of paths.links) {
    if (l.gate !== "gate" || (l.how !== "walk" && l.how !== "stair")) continue;
    for (const end of [l.a, l.b]) {
      const i = byId.get(end);
      if (i !== undefined && nodes[i].kind !== "door" && wpAdd(i) && wpSrc === "none") wpSrc = "gates";
    }
  }
  // the guards' directed edges: gates always, doors by their property's kind and whether the door is locked
  const gEdges = nodes.map(() => []);
  for (const l of paths.links) {
    const a = byId.get(l.a), b = byId.get(l.b);
    if (a === undefined || b === undefined || (l.how !== "walk" && l.how !== "stair")) continue;
    let prop = -1;
    if (l.gate === "door") {
      prop = propOfDoor.has(l.via) ? propOfDoor.get(l.via) : -2;
      if (prop === -2) continue;
    } else if (l.gate && l.gate !== "gate") continue;
    const A = nodes[a].at, B = nodes[b].at;
    const len = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    const way = l.way ? 1 : 0;
    gEdges[a].push([b, len, prop, way]);
    if (!l.oneWay) gEdges[b].push([a, len, prop, way]);
  }
  // mode: "patrol", "hunt" (doors the model locks are shut: every home door, when lockedHomes), "breach" (every door opens)
  const gOk = (e, mode, lockedHomes) => {
    if (e[3] && mode === "patrol") return false; // a way down's stair: only while chasing
    if (e[2] < 0) return true; // no door, or a gate
    const kind = rp.properties[e[2]].kind;
    if (mode === "patrol") return GUARD_PATROL_PROPS.has(kind);
    if (mode === "hunt" && lockedHomes && kind === "home") return false;
    return true;
  };
  const gReach = (from, mode, lockedHomes) => {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    dist[from] = 0;
    const todo = [from];
    // plain Dijkstra by repeated scan is enough for a graph of a thousand nodes
    const done = new Uint8Array(nodes.length);
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const e of gEdges[u]) if (gOk(e, mode, lockedHomes) && dist[u] + e[1] < dist[e[0]]) dist[e[0]] = dist[u] + e[1];
    }
    void todo;
    return dist;
  };
  const nGuards = wp.length ? Math.max(0, Math.min(guardCount, MAX_GUARDS)) : 0;
  cap = Math.min(cap, MAX_NPC - nGuards);

  // roles
  const npcs = [];
  const usedHome = new Set();
  const takeHome = (pred) => {
    let h = homes.find((x) => !usedHome.has(x.prop) && pred(x));
    if (!h) h = homes.find((x) => pred(x));
    if (h) usedHome.add(h.prop);
    return h;
  };
  const bar = rp.places.find((p) => p.kind === "bar");
  const workshop = rp.places.find((p) => p.kind === "workshop");
  for (const pl of rp.places) {
    const role = KEEPER_KINDS[pl.kind];
    if (!role) continue;
    const h = takeHome((x) => x.building === pl.building) || takeHome((x) => x.district === pl.district);
    npcs.push({ role, id: `${role}_${pl.id}`.slice(0, 31), place: pl.id, home: h, work: placeNode.get(pl.id), evening: null });
  }
  const keepers = npcs.length;
  if (!workshop) warn("no workshop place: no workers");
  if (!bar) warn("no bar place: workers and citizens have no evening spot");
  const room = Math.max(0, cap - npcs.length);
  const nWorkers = workshop ? Math.min(workers, room) : 0;
  for (let k = 0; k < nWorkers; k++) {
    const h = takeHome((x) => x.district === "hollow") || takeHome(() => true);
    npcs.push({ role: "worker", id: `worker_${String(k + 1).padStart(2, "0")}`, place: workshop.id, home: h, work: placeNode.get(workshop.id), evening: bar ? placeNode.get(bar.id) : null });
  }
  const nCit = Math.max(0, cap - npcs.length);
  for (let k = 0; k < nCit; k++) {
    const h = takeHome((x) => x.district !== "hollow") || takeHome(() => true);
    npcs.push({ role: "citizen", id: `citizen_${String(k + 1).padStart(2, "0")}`, place: null, home: h, work: null, evening: bar ? placeNode.get(bar.id) : null });
  }
  out.npcs = npcs;
  out.counts = {};
  for (const n of npcs) out.counts[n.role] = (out.counts[n.role] || 0) + 1;
  out.keepers = keepers;

  // the guards' answer: ids, patrol loops, reach of the graph
  const usable = nodes.map((n, i) => i).filter((i) => nodes[i].kind !== "ladder" && nodes[i].kind !== "hatch");
  out.guards = { count: nGuards, ids: [], waypoints: wp.map((i) => nodes[i].id), posts, src: wpSrc, patrol: [], reach: null };
  for (let k = 0; k < nGuards; k++) out.guards.ids.push(`guard_${String(k + 1).padStart(2, "0")}`);
  if (wp.length) {
    const pct = (d) => usable.filter((i) => isFinite(d[i])).length;
    const dP = gReach(wp[0], "patrol");
    const dH = gReach(wp[0], "hunt", true);
    const dB = gReach(wp[0], "breach");
    out.guards.reach = { nodes: usable.length, patrol: pct(dP), huntLockedHomes: pct(dH), breach: pct(dB) };
    out.guards.unreachedByBreach = usable.filter((i) => !isFinite(dB[i])).map((i) => nodes[i].id);
    // the loop each guard walks: its waypoint to the next, round, by the patrol rules, at smak_npc_walk
    for (let k = 0; k < nGuards; k++) {
      let units = 0, ok = true;
      for (let j = 0; j < wp.length; j++) {
        const a = wp[(k + j) % wp.length], b = wp[(k + j + 1) % wp.length];
        const d = gReach(a, "patrol")[b];
        if (!isFinite(d)) { ok = false; err(`guard_${String(k + 1).padStart(2, "0")}: no patrol route ${nodes[a].id} -> ${nodes[b].id}`); break; }
        units += d;
      }
      out.guards.patrol.push({ id: out.guards.ids[k], start: nodes[wp[k % wp.length]].id, units: Math.round(units), seconds: Math.round(units / WALK_SPEED), ok });
    }
    if (out.guards.reach.patrol < usable.length * 0.5) warn(`guards on patrol reach only ${out.guards.reach.patrol} of ${usable.length} nodes`);
    if (out.guards.reach.breach < usable.length) warn(`even with doors breached the guards cannot reach ${usable.length - out.guards.reach.breach} of ${usable.length} nodes (${out.guards.unreachedByBreach.slice(0, 6).join(", ")}...)`);
    if (wpSrc === "gates") warn("the map has no police place or police property: the guards patrol the gates only");
  } else if (guardCount > 0) {
    warn("no police place, police property or checkpoint gate in the graph: no guards");
  }

  // checks
  let routes = 0, bad = 0, noBar = 0;
  const shops = rp.places.filter((p) => p.kind === "shop").map((p) => placeNode.get(p.id));
  npcs.forEach((n, i) => {
    const tag = `#${i} ${n.role}${n.place ? " @" + n.place : ""}`;
    if (!n.home) { err(`${tag}: no home to give`); bad++; return; }
    const own = new Set([n.home.prop]);
    if (n.place) {
      const pi = rp.properties.findIndex((p) => p.id === n.place);
      if (pi >= 0) own.add(pi);
    }
    if (n.role !== "citizen" && n.work === undefined) { err(`${tag}: its place has no node`); bad++; return; }
    if (n.role === "citizen" && n.evening != null) {
      // a citizen whose district has no way to the bar (the checkpoints are gates) spends the evening on its streets
      if (!isFinite(route(n.home.node, n.evening, own))) { noBar++; n.evening = null; }
    }
    const pairs = [];
    if (n.work !== null && n.work !== undefined) { pairs.push(["home->work", n.home.node, n.work]); pairs.push(["work->home", n.work, n.home.node]); }
    if (n.evening != null) { pairs.push(["home->evening", n.home.node, n.evening]); pairs.push(["evening->home", n.evening, n.home.node]); }
    if (n.work != null && n.evening != null) pairs.push(["work->evening", n.work, n.evening]);
    for (const [name, a, b] of pairs) {
      routes++;
      const d = route(a, b, own);
      if (!isFinite(d)) { err(`${tag} (home ${n.home.id}): no route ${name} (${nodes[a].id} -> ${nodes[b].id})`); bad++; }
      else if (verbose) out.info.push(`${tag} ${name}: ${Math.round(d)} units`);
    }
    if (n.role === "citizen") {
      const seen = reachable(n.home.node, own);
      const roam = nodes.filter((x, k) => x.roam !== undefined && seen[k]).length;
      const roamAll = nodes.filter((x) => x.roam !== undefined).length;
      const sh = shops.filter((s) => s !== undefined && seen[s]).length;
      if (roam < 5) { err(`${tag} (home ${n.home.id}): only ${roam} of ${roamAll} roam spots reachable`); bad++; }
      if (verbose) out.info.push(`${tag}: ${roam}/${roamAll} roam spots, ${sh}/${shops.length} shops reachable`);
    }
  });
  // stop points: a roaming spot, a place and a home are where somebody idles; none within STOP_CLEAR (64) of a door's middle or a way down
  // (the generator leaves such roaming spots out; the plugin steps a home or a place's keeper aside when it finds one there)
  const stops = badStops(paths, { homes: npcs.filter((n) => n.home).map((n) => nodes[n.home.node].id) });
  out.badStops = stops;
  for (const b of stops) {
    if (b.kind === "roam") err(b.say);
    else warn(b.say + " (the plugin steps it aside)");
  }
  out.noBar = noBar;
  if (noBar) warn(`${noBar} citizen(s) cannot reach the bar without a checkpoint gate: they spend the evening on their own streets`);
  out.routes = routes;
  out.bad = bad;
  return out;
}

// run as a command
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const file = args.find((a, k) => !a.startsWith("--") && !(k > 0 && args[k - 1].startsWith("--")));
  const opt = (name, def) => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? Number(args[i + 1]) : def;
  };
  const verbose = args.includes("--verbose");
  if (!file) {
    console.log("FAIL: usage: node npc-sim.mjs <map>.rp.json [--cap 24] [--workers 6] [--verbose]");
    process.exit(1);
  }
  const CAP = Math.min(opt("cap", 24), 40);
  const WORKERS = opt("workers", 6);
  const rp = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = analyse(rp, { cap: CAP, workers: WORKERS, verbose });
  const g = rp.paths;
  console.log(`map ${rp.map}: ${g.nodes.length} nodes, ${g.links.length} links -> ${r.edges} directed edges for NPCs`);
  console.log("links left out: " + Object.entries(r.skipped).map(([k, v]) => `${k} x${v}`).join(", "));
  console.log(`NPCs: ${r.npcs.length} (cap ${CAP}): ` + Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log(`routes checked: ${r.routes}`);
  const G = r.guards;
  if (G && G.count) {
    console.log(`guards: ${G.count} (${G.ids[0]}..${G.ids.at(-1)}), ${G.waypoints.length} waypoints (${G.posts} posts, from ${G.src}): ${G.waypoints.join(" ")}`);
    console.log(`guard reach of ${G.reach.nodes} walkable nodes: patrol ${G.reach.patrol} (${Math.round((100 * G.reach.patrol) / G.reach.nodes)}%), hunt with every home door locked ${G.reach.huntLockedHomes} (${Math.round((100 * G.reach.huntLockedHomes) / G.reach.nodes)}%), hunt with breach ${G.reach.breach} (${Math.round((100 * G.reach.breach) / G.reach.nodes)}%)`);
    for (const p of G.patrol) console.log(`  ${p.id}: starts at ${p.start}, a full round is ${p.units} units, about ${p.seconds} s at smak_npc_walk${p.ok ? "" : " (BROKEN)"}`);
  }
  for (const w of r.warns) console.log("WARN: " + w);
  if (verbose) for (const s of r.info) console.log("  " + s);
  for (const e of r.errors) console.log("  " + e);
  if (r.errors.length) {
    console.log(`FAIL: ${r.errors.length} problem(s) for the NPC plugin`);
    process.exit(1);
  }
  console.log(`PASS: ${r.npcs.length} NPCs, ${r.routes} routes, all on walk/stair/plain-door links`);
}
