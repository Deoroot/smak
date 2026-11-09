// The RP contract of a site (CONTRACT.md, smak-rp/1): what a built site gives an RP plugin, written beside its map.
// Its properties from the doorways' names, its places (where a job works) from its rooms, the points its roaming
// citizens walk to from its public floor and from the walkways of its level below, when it has one. Its npcs, arenas and missions come from the site spec's `rp` when it has one
// (none yet in byzantium-01: they wait for the plugin to be tried on the test map), else they are empty. Its `paths`
// (paths.mjs): the graph a citizen or a bot walks, from the plan and, with the compiled map, held against it.
import { createHash } from "node:crypto";
import { PUBLIC, programOf, propertiesOf, propertyKindOf, sweptCells, spawnsOf } from "../assembly/site.mjs";
import { loadStyle } from "../assembly/style.mjs";
import { roofsContract, roofGround } from "../assembly/roofs.mjs";
import { readBsp } from "../../src/maps/bsp.mjs";
import { pathsOf, pruneByMap, cutOff, groundOf, nearStart, START_CLEAR, NEAR_SPOT } from "./paths.mjs";
import { deepSpots } from "./deep.mjs";
import { unshiftBsp } from "../assembly/recentre.mjs";

export const RP_FORMAT = "smak-rp/1";
/** The most a mission's `done.reward.money` may be (smak_core's own ceiling is a thousand million). */
export const MAX_REWARD_MONEY = 100000;

/**
 * What is wrong with the missions' rewards: `done.reward.money`, when given, is an integer from 0 to 100000, and
 * `done.reward.frags`, when given, an integer >= 0. `[]` when nothing is.
 */
export function checkRewards(missions) {
  const out = [];
  for (const m of missions ?? []) {
    const r = m.done?.reward;
    if (r === undefined) continue;
    if (r === null || typeof r !== "object" || Array.isArray(r)) { out.push(`mission ${m.id}: reward is not an object`); continue; } // prettier-ignore
    const { money, frags } = r;
    if (money !== undefined && !(Number.isInteger(money) && money >= 0 && money <= MAX_REWARD_MONEY))
      out.push(`mission ${m.id}: reward.money must be an integer from 0 to ${MAX_REWARD_MONEY}, not ${JSON.stringify(money)}`);
    if (frags !== undefined && !(Number.isInteger(frags) && frags >= 0))
      out.push(`mission ${m.id}: reward.frags must be an integer >= 0, not ${JSON.stringify(frags)}`);
  }
  return out;
}
const GRID = 64;
const STOREY = 192;
/** The player starts of a site (info_player_deathmatch), as floor points: `[{ at: [x, y, floor z], yaw }]`. */
export function startsOf(plan) {
  const GR = groundOf(plan);
  return spawnsOf(plan).map((s) => {
    const x = s.at[0] * GRID, y = s.at[1] * GRID;
    return { at: [x, y, GR ? (GR.floor(x, y) ?? 0) : 0], yaw: s.yaw };
  });
}
/** The room kinds that are a job's place, as the plugin and an admin know them. */
const PLACE_KINDS = new Set(["shop", "bar", "clinic", "workshop", "booking", "guard", "cell", "armory", "office", "warroom", "lobby", "counter", "den"]); // prettier-ignore
/** One roaming point every this many cells each way of public floor. */
const ROAM_EVERY = 4;
/** Below the streets, roaming points at least this many cells apart each way. */
const ROAM_BELOW = 4;

/**
 * Where the regime's guards start: for each building whose program has a control room (the Nexus, a post), up to 3
 * cells of that room spread apart (floor points, `role` "guard", `id` <building>_spawn<n>) and 2 on the public floor
 * outside its entrance. A cell's middle; the plugin lifts the point as it does a place's.
 */
function guardSpawnsOf(plan, built, style) {
  const out = [];
  const GR = groundOf(plan);
  for (const b of plan.site.buildings) {
    const layout = plan.layouts.get(b.id);
    const program = layout?.rooms && programOf(plan.site, b, style);
    if (!program?.control) continue;
    const room = layout.rooms.find((r) => r.id === program.control);
    const cells = [];
    layout.storeyPlans[room.storey].cells.forEach((row, y) => row.forEach((v, x) => v === room.id && cells.push([x, y])));
    const pick = [];
    for (const c of cells) if (pick.every((p) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) >= 2) && pick.length < 3) pick.push(c);
    const point = ([x, y]) => [(b.at[0] + x + 0.5) * GRID, (b.at[1] + y + 0.5) * GRID, room.storey * STOREY + (b.groundZ ?? 0)];
    const here = pick.map(point);
    // outside the street door: the two cells beyond the entrance's two edges (the street's, its leaf swings inside)
    const [w, h] = layout.size;
    for (const e of (layout.entrances ?? [])[0]?.edges ?? []) {
      const horizontal = e.from[1] === e.to[1];
      const [x, y] = [Math.min(e.from[0], e.to[0]), Math.min(e.from[1], e.to[1])];
      const c = horizontal ? [x, y === 0 ? -1 : h] : [x === 0 ? -1 : w, y];
      here.push([(b.at[0] + c[0] + 0.5) * GRID, (b.at[1] + c[1] + 0.5) * GRID, GR ? (GR.floor((b.at[0] + c[0] + 0.5) * GRID, (b.at[1] + c[1] + 0.5) * GRID) ?? 0) : 0]);
    }
    here.forEach((at, i) => out.push({ id: `${b.id}_spawn${i + 1}`, role: "guard", building: b.id, district: b.district ?? null, at }));
  }
  return out;
}

/** The middle cell of a room, as a floor point of the world. */
function middleOf(b, layout, room) {
  const cells = [];
  layout.storeyPlans[room.storey].cells.forEach((row, y) => row.forEach((v, x) => v === room.id && cells.push([x, y])));
  if (!cells.length) return null;
  const [x, y] = cells[Math.floor(cells.length / 2)];
  return [(b.at[0] + x + 0.5) * GRID, (b.at[1] + y + 0.5) * GRID, room.storey * STOREY + (b.groundZ ?? 0)];
}

/**
 * The contract of a planned and assembled site: `{ format, map, build, properties, places, npcs, arenas, missions,
 * breakables, roam, paths }`. `bsp`: the compiled map's bytes, whose sha1 is `build` (null when not given); the graph is then held
 * against the map (paths.mjs pruneByMap) and `contract.paths.pruned` says how much went. The roaming spots are those on a
 * node of the graph that the rest reaches.
 */
export function rpContract(plan, built, { bsp = null, shift = null, style = loadStyle(plan.site.style), counters = [] } = {}) {
  const site = plan.site;
  const properties = new Map();
  for (const b of site.buildings) {
    const layout = plan.layouts.get(b.id);
    if (!layout?.rooms) continue;
    const program = programOf(site, b, style);
    const props = propertiesOf(layout, style, program.oneProperty);
    const roomKind = new Map(layout.rooms.map((r) => [r.id, r.kind]));
    for (const d of built.report.doorways.filter((q) => q.building === b.id && q.targetname)) {
      const id = d.targetname.slice(`${site.name}_`.length);
      const own = d.targetname.slice(`${site.name}_${b.id}_`.length);
      if (!properties.has(id)) {
        const kind = own === "hideout" ? "hideout" : propertyKindOf(roomKind.get(own), program.oneProperty);
        const rooms = [...props].filter(([, q]) => q === own).map(([r]) => r);
        properties.set(id, { id, kind, doors: [], building: b.id, rooms, district: b.district ?? null });
      }
      const p = properties.get(id);
      if (!p.doors.includes(d.targetname)) p.doors.push(d.targetname);
    }
  }
  // the gates in the walls: the regime's, opened by its checkpoints
  for (const d of built.report.doorways.filter((q) => !q.building && q.targetname)) {
    const id = d.targetname.slice(`${site.name}_`.length);
    properties.set(id, { id, kind: "gate", doors: [d.targetname], building: null, rooms: [], district: plan.districts[d.at[1]]?.[d.at[0]] ?? null }); // prettier-ignore
  }
  const places = [];
  for (const b of site.buildings) {
    const layout = plan.layouts.get(b.id);
    for (const room of layout?.rooms ?? []) {
      if (!PLACE_KINDS.has(room.kind)) continue;
      const at = middleOf(b, layout, room);
      if (at) places.push({ id: `${b.id}_${room.id}`, kind: room.kind, at, building: b.id, district: b.district ?? null });
    }
  }
  // a shop, bar or clinic with a counter (the dressing's: assembly/counter.mjs): its place is the keeper's post behind it, the counter's
  // box, the customers' spot in front of it (`front`: where the shop's circle is) and the way the keeper faces (`yaw`, to the street door) are its own
  for (const c of counters) {
    const p = places.find((q) => q.id === c.place);
    if (!p) continue;
    Object.assign(p, { at: c.post, yaw: c.yaw, counter: c.counter, front: c.front, pass: c.pass, clear: c.clear, frontFree: c.frontFree });
  }
  // places the plan's own rp lists besides the rooms' (a stall in the open: `{ id, kind, at: [x, y, floor z], district }`); a node on the street graph
  for (const p of site.rp?.places ?? []) places.push({ building: null, district: null, ...p, street: true });
  const swept = new Set([...sweptCells(plan), ...roofGround(plan)]); // (and where a roof's stair, crates or ladder stand: nobody idles on them)
  const roam = [];
  const GR = groundOf(plan); // null on a site of one height
  plan.cells.forEach((row, y) =>
    row.forEach((v, x) => {
      const bridge = GR && v === "water" && GR.bridgeAt(x, y);
      if (x % ROAM_EVERY !== 2 || y % ROAM_EVERY !== 2 || !(PUBLIC.has(v) || bridge) || v === "landmark" || swept.has(`${x},${y}`)) return;
      let z = 0;
      if (GR) {
        if (GR.joinAt(x, y)?.join.kind === "stair") return; // nobody idles on a stair
        z = GR.floor((x + 0.5) * GRID, (y + 0.5) * GRID);
        if (z === null) return;
      }
      roam.push({ district: plan.districts[y]?.[x] ?? null, at: [(x + 0.5) * GRID, (y + 0.5) * GRID, z] });
    }),
  );
  // the level below the streets (levels/assembly/below.mjs): its walkways roamed too, spots ROAM_BELOW cells apart or
  // more, never in the channel, the basin or a way down's cells (the roambots keep off the ladders); a part that is a
  // place (the den's cellar) a place at its middle walk cell
  const below = plan.below;
  const spotFailures = [];
  if (below) {
    const picked = [];
    const clear = new Set([...(built.report.below?.keepClear ?? []), ...(built.report.below?.holes ?? []).map((h) => h.join(","))]);
    for (const part of below.parts) {
      const walk = [...below.cells].filter(([k, c]) => c.part === part.id && c.kind === "walk").map(([k]) => k.split(",").map(Number));
      const long = part.to[0] - part.from[0] >= part.to[1] - part.from[1] ? 0 : 1;
      walk.sort((a, b) => a[long] - b[long] || a[1 - long] - b[1 - long]);
      const at = ([x, y]) => [(x + 0.5) * GRID, (y + 0.5) * GRID, below.floor];
      if (part.place) {
        const middle = walk[Math.floor(walk.length / 2)];
        if (middle) places.push({ id: `below_${part.id}`, kind: part.place, at: at(middle), building: null, district: "below" });
      }
      if (part.kind === "room") continue;
      for (const c of walk.slice(1)) {
        if (clear.has(c.join(",")) || picked.some((q) => Math.max(Math.abs(q[0] - c[0]), Math.abs(q[1] - c[1])) < ROAM_BELOW)) continue;
        picked.push(c);
        roam.push({ district: "below", at: at(c) });
      }
    }
    // the sewers on several levels: the places and roaming spots of the description, and a spot in every hall and along every tunnel
    if (below.deep) {
      const got = deepSpots(below.deep, site.below, { kinds: PLACE_KINDS });
      places.push(...got.places);
      roam.push(...got.roam);
      spotFailures.push(...got.failures);
    }
  }
  const rp = site.rp ?? {};
  // the guards' spawn points (a building with a control room, the regime's posts): cells of the guard room, and two
  // outside its street door, as floor points; `spawns` of the JSON, role "guard" (a plugin that does not know them ignores them)
  const starts = startsOf(plan);
  const guardAll = guardSpawnsOf(plan, built, style);
  // a guard spawned next to where players appear would stand in them: those points are left out
  const spawns = guardAll.filter((g) => !nearStart(starts, g.at));
  const roamAll = roam.length;
  for (let i = roam.length - 1; i >= 0; i--) if (nearStart(starts, roam[i].at)) roam.splice(i, 1); // nobody idles where players appear
  // a keeper's post or a giver's spot there is the spec's to move (the contract does not guess where)
  for (const p of places) if (nearStart(starts, p.at)) spotFailures.push(`place ${p.id} at ${p.at.join(" ")} is within ${START_CLEAR} of a player start: a keeper would stand in the players who appear`); // prettier-ignore
  for (const n of rp.npcs ?? []) if (n.at && nearStart(starts, n.at)) spotFailures.push(`npc ${n.id} at ${n.at.join(" ")} is within ${START_CLEAR} of a player start: a giver would stand in the players who appear`); // prettier-ignore
  // and no two NPC points share a spot: a roaming spot beside a street stall's post or a giver goes
  const fixed = [...places.map((p) => p.at), ...(rp.npcs ?? []).map((n) => n.at)].filter(Boolean);
  for (let i = roam.length - 1; i >= 0; i--) if (fixed.some((f) => Math.hypot(f[0] - roam[i].at[0], f[1] - roam[i].at[1]) < NEAR_SPOT && Math.abs(f[2] - roam[i].at[2]) <= 80)) roam.splice(i, 1);
  console.log(`rp: ${roamAll - roam.length} roaming spots and ${guardAll.length - spawns.length} guard spawns within ${START_CLEAR} of a player start left out`);
  // the walking graph; the roaming spots kept are those on its nodes (not in a prop's cell, not behind bars)
  // (a recentred site's compiled map is moved by `shift`: held against the map in the site's own frame, which the contract keeps)
  const map = bsp ? (shift ? unshiftBsp(readBsp(bsp), shift) : readBsp(bsp)) : null;
  const made = pathsOf(plan, built, { places, roam, map });
  const paths = made.paths;
  if (spotFailures.length) paths.failures = [...(paths.failures ?? []), ...spotFailures];
  let pruned = [];
  if (map) {
    const held = pruneByMap(paths, map);
    pruned = held.dropped;
    Object.assign(paths, held.paths);
    const cut = cutOff(paths);
    if (cut) pruned.push(`${cut} nodes cut off from the rest by those (rooms behind a doorway the dressing blocks)`);
  }
  const alive = new Set(paths.nodes.filter((n) => n.roam !== undefined).map((n) => n.roam));
  const renumber = new Map();
  const kept = roam.filter((r, i) => alive.has(i) && (renumber.set(i, renumber.size), true));
  for (const n of paths.nodes) if (n.roam !== undefined) n.roam = renumber.get(n.roam);
  const lost = roam.filter((r, i) => !alive.has(i));
  if (lost.length) paths.warnings.push(`${lost.length} roaming spots are on no node of the graph (a prop's cell, behind bars, off the map's floor), left out: ${lost.slice(0, 8).map((r) => `${r.district ?? "city"} ${r.at.join(" ")}`).join("; ")}${lost.length > 8 ? "; ..." : ""}`); // prettier-ignore
  paths.pruned = pruned.length;
  paths.notes = pruned.slice(0, 40);
  paths.measures = { nodes: paths.nodes.length, links: paths.links.length, ways: paths.ways.length, pruned: pruned.length };
  // the teleport doors (site.doors "teleport"): each door's two spots, which the plugins read by name, and (with the compiled map) that the map has them
  const teleDoors = (built.report.doorways ?? []).filter((d) => d.spots && d.targetname).map((d) => ({ door: d.targetname, n: d.spots.n, building: d.building ?? null, spots: [d.spots.a, d.spots.b] }));
  if (map && teleDoors.length) {
    const named = new Set(map.entities.map((e) => e.find(([k]) => k === "targetname")?.[1]).filter(Boolean));
    for (const t of teleDoors) for (const sp of t.spots) if (!named.has(sp.name)) paths.failures = [...(paths.failures ?? []), `the spot ${sp.name} of the door ${t.door} is not an entity of the compiled map`];
  }
  const badRewards = checkRewards(rp.missions);
  if (badRewards.length) throw new Error(badRewards.join("; "));
  return {
    format: RP_FORMAT,
    map: site.name,
    build: bsp ? createHash("sha1").update(bsp).digest("hex") : null,
    properties: [...properties.values()],
    ...(teleDoors.length ? { doorMode: "teleport", teleDoors } : {}),
    places,
    spawns,
    starts,
    npcs: rp.npcs ?? [],
    arenas: [...(built.report.arenas ?? []), ...(rp.arenas ?? [])],
    missions: rp.missions ?? [],
    breakables: map ? breakablesOf(rp.missions ?? [], map.entities) : [],
    roam: kept,
    ...(rp.quotas ? { quotas: rp.quotas } : {}),
    ...(counters.length ? { counters: { kinds: [...new Set(counters.map((c) => c.kind))], front: 96, side: 32 } } : {}), // (the rule the check holds the places to: paths.mjs badCounters)
    ...(plan.roofs ? { roofs: roofsContract(plan) } : {}), // the routes over the roofs, for players (levels/assembly/roofs.mjs)
    paths,
  };
}

/**
 * The keys of every entity a `destroy` step names, as the compiled map holds them (`model` is then its `*N`), for the
 * plugin to spawn a broken one again: `[{ name, keys: { classname, model, ... } }]`, in the missions' order. `entities`
 * is a read map's `entities` (a list of entities, each a list of [key, value] pairs). A target the map lacks is an error.
 */
export function breakablesOf(missions, entities) {
  const names = [...new Set(missions.flatMap((m) => m.steps.filter((s) => s.do === "destroy").map((s) => s.target)))];
  return names.map((name) => {
    const ent = entities.find((e) => e.some(([k, v]) => k === "targetname" && v === name));
    if (!ent) throw new Error(`destroy target ${name} is not an entity of the compiled map`);
    return { name, keys: Object.fromEntries(ent.map(([k, v]) => [k, String(v)])) };
  });
}

/** The roaming citizens' spots for tsrp_roambots, `roamspot <district> x y z` a line, its feet lifted to the origin. */
export const roamspotsCfg = (contract) =>
  `// ${contract.map}: tsrp_roambots spots, from its smak-rp contract\n${contract.roam.map((r) => `roamspot ${r.district ?? "city"} ${r.at[0]} ${r.at[1]} ${r.at[2] + 36}`).join("\n")}\n`; // prettier-ignore
