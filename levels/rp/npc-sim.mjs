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
export const MAX_NPC = 64; // the plugin's hard cap, guards included (smak_npc_max is 24 by default)
export const MAX_GUARDS = 12;
// the plugin's other caps (smak_npc.sma, "limits"): a JSON over one is cut and the plugin logs a CAP line
export const CAPS = { nodes: 2048, edges: 8192, props: 192, places: 128, doors: 320, roam: 256, ways: 96 };
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
  if (nodes.length > CAPS.nodes) err(`${nodes.length} nodes: the plugin holds ${CAPS.nodes}`);
  const roamCount = nodes.filter((n) => n.roam !== undefined).length;
  if (roamCount > CAPS.roam) err(`${roamCount} roam spots: the plugin holds ${CAPS.roam}`);
  if ((rp.places ?? []).length > CAPS.places) err(`${rp.places.length} places: the plugin holds ${CAPS.places}`);
  if ((rp.properties ?? []).length > CAPS.props) err(`${rp.properties.length} properties: the plugin holds ${CAPS.props}`);
  const doorNames = new Set((rp.properties ?? []).flatMap((p) => p.doors ?? []));
  if (doorNames.size > CAPS.doors) err(`${doorNames.size} door names: the plugin holds ${CAPS.doors}`);

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
  if (edges.length > CAPS.edges) err(`${edges.length} directed edges: the plugin holds ${CAPS.edges}`);
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
  out.ctx = { nodes, homes, reachable, usedHome, quotas: rp.quotas ?? null, placeQuota: rp.places.filter((p) => p.quota > 0).map((p) => ({ node: placeNode.get(p.id), quota: p.quota })) };
  return out;
}


// ---- streaming (smak_npc.sma "streaming"): live citizens follow the players -------------------------------------------------
// The plugin makes smak_npc_max people; the JSON's "quotas" ({district: n}, and a place's "quota" added to its district's) is the
// virtual roster. Every smak_npc_stream_sec seconds one citizen no player is near moves from the district with more than its share
// to the one with fewer, to a roam spot it can reach from a free home there, at least smak_npc_spawn_min from every player.
// This repeats that choice (the same weights, the same 0.9 margin, the same two passes over the spots) on a graph and players
// you give it. It has no line of sight (a donor is "not seen" when it is beyond smak_npc_near; a spot only has to be 600 u away): the plugin also traces from the players' eyes.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs the plugin's streaming for `steps` moves' worth of time with fixed players (points [x,y,z], or node ids as strings).
 * Returns { on, moves, before, after, citizens, districts, quotas, minSpawn } where before/after count the citizens within
 * `near` x 2 of any player, and `closest` is the nearest any move put a citizen to a player.
 */
export function streamSim(rp, { cap = 24, workers = 6, players, quotas, steps = 120, every = 3, near = 1500, minSpawn = 600, seed = 1, guards = 0 } = {}) {
  const copy = JSON.parse(JSON.stringify(rp));
  if (quotas) copy.quotas = quotas;
  const r = analyse(copy, { cap, workers, guards });
  const { nodes, homes, reachable } = r.ctx;
  const users = new Map();
  for (const n of r.npcs) if (n.home) users.set(n.home.prop, (users.get(n.home.prop) ?? 0) + 1);
  const rng = mulberry32(seed);
  const ri = (n) => Math.floor(rng() * n);
  const dist = nodes.map((n) => n.district ?? null);
  const names = [];
  for (const d of dist) if (d && !names.includes(d)) names.push(d);
  const quota = names.map((d) => Number((copy.quotas ?? {})[d]) || 0);
  for (const pq of r.ctx.placeQuota) {
    const d = pq.node !== undefined ? names.indexOf(dist[pq.node]) : -1;
    if (d >= 0) quota[d] += pq.quota;
  }
  const sum = quota.reduce((a, b) => a + b, 0);
  const pts = players.map((p) => (typeof p === "string" ? nodes[nodes.findIndex((n) => n.id === p)].at : p));
  const roam = nodes.map((n, i) => i).filter((i) => nodes[i].roam !== undefined);
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const cits = r.npcs.filter((n) => n.role === "citizen" && n.home).map((n) => {
    const own = new Set([n.home.prop]);
    const reach = reachable(n.home.node, own);
    const spots = roam.filter((k) => reach[k]);
    return { id: n.id, home: n.home, cur: spots.length ? spots[ri(spots.length)] : n.home.node };
  });
  const nearCount = (limit) => cits.filter((c) => pts.some((p) => D(nodes[c.cur].at, p) < limit)).length;
  const out = { on: false, moves: 0, citizens: cits.length, districts: names, quotas: Object.fromEntries(names.map((d, i) => [d, quota[i]])), minSpawn, closest: Infinity, before: nearCount(near * 2), after: 0, perDistrict: {} }; // prettier-ignore
  if (sum <= 0 || cits.length < 2 || names.length === 0) {
    out.after = out.before;
    return out; // no quotas: nothing moves, as before
  }
  out.on = true;
  for (let t = 0; t < steps; t++) {
    // ---- stream_step ----
    const live = names.map(() => 0);
    for (const c of cits) { const d = names.indexOf(dist[c.cur]); if (d >= 0) live[d]++; }
    const dp = names.map(() => Infinity);
    for (const n of roam) {
      const d = names.indexOf(dist[n]);
      if (d < 0) continue;
      for (const p of pts) dp[d] = Math.min(dp[d], D(nodes[n].at, p));
    }
    const w = names.map((_, d) => {
      let x = quota[d];
      if (!isFinite(dp[d])) return 0;
      if (dp[d] > near * 4) x *= 0.05;
      else if (dp[d] > near * 2) x *= 0.35;
      return x;
    });
    const wsum = w.reduce((a, b) => a + b, 0);
    if (wsum <= 0) continue;
    const tgt = w.map((x) => (cits.length * x) / wsum);
    let want = -1, from = -1, bestLack = 0.9, bestExtra = 0.9;
    for (let d = 0; d < names.length; d++) {
      const lack = tgt[d] - live[d];
      if (lack >= bestLack && isFinite(dp[d])) { bestLack = lack; want = d; }
      const extra = live[d] - tgt[d];
      if (extra >= bestExtra) { bestExtra = extra; from = d; }
    }
    if (process.env.SIMDBG && t < 2) console.log({ live, tgt, dp, want, from });
    if (want < 0 || from < 0 || want === from) continue;
    const start = ri(cits.length);
    for (let k = 0; k < cits.length; k++) {
      const c = cits[(start + k) % cits.length];
      if (names.indexOf(dist[c.cur]) !== from) continue;
      if (pts.some((p) => D(nodes[c.cur].at, p) < near)) continue;
      // stream_move: up to 3 free homes of the district, in a random order from `hs`
      // free ones first, then shared ones (a district with fewer homes than its quota)
      const free = [];
      const hs = ri(homes.length);
      for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q < homes.length && free.length < 3; q++) {
          const h = homes[(hs + q) % homes.length];
          if (dist[h.node] !== names[want] || h.prop === c.home.prop || ((users.get(h.prop) ?? 0) > 0) !== (pass === 1)) continue;
          free.push(h);
        }
      }
      let moved = false;
      for (const h of free) {
        const reach = reachable(h.node, new Set([h.prop]));
        const spots = roam.filter((n) => reach[n]);
        if (!spots.length) continue;
        const s0 = ri(spots.length);
        let spot = -1;
        for (let pass = 0; pass < 2 && spot < 0; pass++) {
          for (let q = 0; q < spots.length && spot < 0; q++) {
            const n = spots[(s0 + q) % spots.length];
            if (dist[n] !== names[want]) continue;
            const nd = Math.min(...pts.map((p) => D(nodes[n].at, p)));
            if (nd < minSpawn) continue;
            if (pass === 0 && nd > near * 2) continue;
            spot = n;
          }
        }
        if (spot < 0) continue;
        users.set(c.home.prop, Math.max(0, (users.get(c.home.prop) ?? 0) - 1));
        users.set(h.prop, (users.get(h.prop) ?? 0) + 1);
        c.home = h;
        c.cur = spot;
        out.closest = Math.min(out.closest, Math.min(...pts.map((p) => D(nodes[spot].at, p))));
        out.moves++;
        moved = true;
        break;
      }
      void moved;
      break;
    }
    void every;
  }
  out.after = nearCount(near * 2);
  for (const c of cits) { const d = dist[c.cur] ?? "-"; out.perDistrict[d] = (out.perDistrict[d] || 0) + 1; }
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
  const CAP = Math.min(opt("cap", 24), MAX_NPC);
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
  // --stream <nodeId,nodeId> [--quotas market=8,hollow=6]: the streaming sim on those players
  const si = args.indexOf("--stream");
  if (si >= 0) {
    const qi = args.indexOf("--quotas");
    const quotas = qi >= 0 ? Object.fromEntries(args[qi + 1].split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)])) : undefined;
    const st = streamSim(rp, { cap: CAP, workers: WORKERS, players: args[si + 1].split(","), quotas, guards: 0, near: opt("near", 1500) });
    console.log(st.on ? `streaming: ${st.moves} move(s), citizens within twice smak_npc_near of a player ${st.before} -> ${st.after} of ${st.citizens}; nearest a move put one ${Math.round(st.closest)}; by district ${JSON.stringify(st.perDistrict)}` : "streaming: no quotas, nothing moves");
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
