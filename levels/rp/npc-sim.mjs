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

export const KEEPER_KINDS = { shop: "shopkeeper", bar: "barman", clinic: "medic", workshop: "mechanic" };
const SAFE_PROPS = new Set(["shop", "public"]);

/**
 * The ids smak_npc.sma gives its people (smak_npc_find, the entity's targetname): a keeper is <role>_<place id>, workers
 * worker_01.., citizens citizen_01.., in the order the plugin makes them. Same inputs, same ids: no random call decides
 * them. A keeper whose place or home has no node is left out, as the plugin leaves it out.
 */
export function npcIds(rp, { cap = 24, workers = 6 } = {}) {
  const r = analyse(JSON.parse(JSON.stringify(rp)), { cap, workers });
  return (r.npcs ?? []).filter((n) => n.home && (n.role === "citizen" || n.work !== undefined)).map((n) => n.id);
}

export function analyse(rp, { cap = 24, workers = 6, verbose = false } = {}) {
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
    edges.push([a, b, len, prop]);
    if (!l.oneWay) edges.push([b, a, len, prop]);
  }
  out.edges = edges.length;
  out.skipped = skipped;
  if (edges.length > 4096) err(`${edges.length} directed edges: the plugin holds 4096`);
  const adj = nodes.map(() => []);
  for (const e of edges) adj[e[0]].push(e);

  // can this NPC pass edge e? (own = set of property indexes it may enter beyond shop/public)
  const passable = (e, own) => e[3] < 0 || SAFE_PROPS.has(rp.properties[e[3]].kind) || own.has(e[3]);
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
  for (const w of r.warns) console.log("WARN: " + w);
  if (verbose) for (const s of r.info) console.log("  " + s);
  for (const e of r.errors) console.log("  " + e);
  if (r.errors.length) {
    console.log(`FAIL: ${r.errors.length} problem(s) for the NPC plugin`);
    process.exit(1);
  }
  console.log(`PASS: ${r.npcs.length} NPCs, ${r.routes} routes, all on walk/stair/plain-door links`);
}
