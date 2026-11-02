// Checks on a level description (levels/lib/description.mjs) with no geometry: the graph of its spaces and links,
// walked with the keys a player holds. What must hold for any level (every space reachable, the goal reachable
// without a secret, every key before its gate, no one-way drop that strands the player), and the measures a
// style bands (route length, area, loops, branches, dead ends and their rewards, the share off the path, the
// pacing curve), each held to a bands object given as input.
//
// A bands object: { name?, metrics: { <metric>: { p5?, q1?, median?, q3?, p95?, min?, max?, source?, note? } } }
// (or the metrics map itself). A value below min (else p5) or above max (else p95) fails; one inside the band but
// outside q1..q3 passes with a note. Metrics a bands object does not name are measured and not held.
import { measureDescription, validateDescription } from "./description.mjs";

/**
 * PROVISIONAL bands for MSR-style exploration, until levels/styles/ gives the real ones. "measured" metrics come
 * from levels/corpus/levels-msr.json, banded over its 31 interior maps (open-sky share under 0.15: catacombs,
 * crypts, sewers, caves, keeps) except loops (all 84 maps; tile cycles at 512 units, about a room, are the
 * nearest the corpus has to a graph's loops). Those are walked-floor measures of real maps, compared here with
 * a graph's estimates: the corpus's crossing (the longest walk between two ways out, no key fetched) against the
 * description's direct length (start to goal, every gate open, a sum of the spaces' walks); the area a sum of
 * footprints; storeys a count of the storeys used against the corpus's most floors stacked at one place. The
 * critical walk (keys fetched) is held only by `backtrack`, its ratio to the direct one. "judged" metrics have no
 * corpus behind them yet (the survey measures no rooms, branches or rewards): they say what MSR's exploration
 * is, from playing it, and wait for a measure.
 */
export const MSR_EXPLORATION_PROVISIONAL = {
  name: "msr-exploration (provisional)",
  kind: "rpg-exploration",
  provisional: true,
  metrics: {
    directLength: { p5: 8, q1: 26, median: 75, q3: 193, p95: 409, unit: "m", source: "measured", note: "crossing walk (no key fetched), interior maps" }, // prettier-ignore
    area: { p5: 84, q1: 352, median: 1519, q3: 6022, p95: 16666, unit: "m2", source: "measured", note: "walked area, interior maps" }, // prettier-ignore
    loops: { p5: 0, q1: 0, median: 0, q3: 2, p95: 7, source: "measured", note: "cycles of 512-unit tiles, all maps; 45% of maps have one" }, // prettier-ignore
    storeys: { p5: 1, q1: 1, median: 2, q3: 2.5, p95: 5.5, source: "measured", note: "most floors stacked, interior maps" }, // prettier-ignore
    spaces: { min: 8, max: 60, source: "judged" },
    hubs: { min: 1, source: "judged" },
    branches: { min: 2, source: "judged" },
    deadEnds: { min: 2, source: "judged" },
    rewardedDeadEndShare: { min: 0.75, source: "judged", note: "a dead end pays for the walk" },
    offPathShare: { min: 0.2, max: 0.65, source: "judged", note: "area off the critical walk" },
    fightShare: { min: 0.15, max: 0.6, source: "judged" },
    maxFightRun: { max: 3, source: "judged" },
    backtrack: {
      min: 1,
      max: 2.5,
      source: "judged",
      note: "critical walk over direct walk: fetching keys walks back",
    },
    peakAt: { min: 0.6, source: "judged", note: "the heaviest fight in the later part of the route" },
  },
};

/** Breadth-first over (space, keys held) states. */
function explore(m, { secrets = true, closedKey = null, from = m.start, mask = null } = {}) {
  const keyBit = new Map(m.keys.map((k, i) => [k, 1 << i]));
  const gain = (id) => m.spaces.get(id).keys.reduce((acc, k) => acc | keyBit.get(k), 0);
  const out = new Map();
  for (const mv of m.moves) (out.get(mv.from) ?? out.set(mv.from, []).get(mv.from)).push(mv);
  const startMask = (mask ?? 0) | gain(from);
  const seen = new Set([`${from}|${startMask}`]);
  const edges = new Map();
  const queue = [[from, startMask]];
  const reached = new Set([from]);
  while (queue.length) {
    const [id, held] = queue.shift();
    const here = `${id}|${held}`;
    const next = [];
    for (const mv of out.get(id) ?? []) {
      if (mv.secret && !secrets) continue;
      if (mv.key && (mv.key === closedKey || !(held & keyBit.get(mv.key)))) continue;
      const nextMask = held | gain(mv.to);
      const state = `${mv.to}|${nextMask}`;
      next.push(state);
      reached.add(mv.to);
      if (!seen.has(state)) seen.add(state), queue.push([mv.to, nextMask]);
    }
    edges.set(here, next);
  }
  return { reached, states: seen, edges, keyBit };
}

/** The shortest walk from start to goal (Dijkstra over states), with its length in metres. */
function shortestWalk(m, { secrets = false, allKeys = false } = {}) {
  const { keyBit } = explore(m, { secrets: false });
  const gain = (id) => m.spaces.get(id).keys.reduce((acc, k) => acc | keyBit.get(k), 0);
  const all = (1 << m.keys.length) - 1;
  const half = (id) => m.spaces.get(id).traverse / 2;
  const startMask = allKeys ? all : gain(m.start);
  const startState = `${m.start}|${startMask}`;
  const dist = new Map([[startState, 0]]);
  const prev = new Map();
  const open = new Map([[startState, [m.start, startMask]]]);
  const done = new Set();
  let end = null;
  while (open.size) {
    let best = null;
    for (const [s] of open) if (best === null || dist.get(s) < dist.get(best)) best = s;
    const [id, held] = open.get(best);
    open.delete(best);
    done.add(best);
    if (id === m.goal) {
      end = best;
      break;
    }
    for (const mv of m.moves) {
      if (mv.from !== id || (mv.secret && !secrets)) continue;
      if (mv.key && !(held & keyBit.get(mv.key))) continue;
      const nextMask = held | gain(mv.to);
      const state = `${mv.to}|${nextMask}`;
      if (done.has(state)) continue;
      const d = dist.get(best) + half(id) + half(mv.to);
      if (!dist.has(state) || d < dist.get(state)) {
        dist.set(state, d);
        prev.set(state, best);
        open.set(state, [mv.to, nextMask]);
      }
    }
  }
  if (!end) return null;
  const states = [];
  for (let s = end; s; s = prev.get(s)) states.unshift(s);
  const walk = states.map((s) => s.slice(0, s.lastIndexOf("|")));
  const at = states.map((s) => dist.get(s));
  const length = dist.get(end) + half(m.start) + half(m.goal);
  return { walk, at: at.map((d) => d + half(m.start)), length };
}

/**
 * Everything the checks measure on a description: reach, keys, stranding, the critical walk, the graph's shape
 * and the pacing curve. `metrics` holds the numbers a bands object may name.
 */
export function analyseDescription(desc) {
  const m = measureDescription(desc);
  const ids = [...m.spaces.keys()];
  const sp = (id) => m.spaces.get(id);

  // reach, with and without secrets
  const all = explore(m, { secrets: true });
  const plain = explore(m, { secrets: false });
  const unreached = ids.filter((id) => !all.reached.has(id));
  const secretOnly = ids.filter((id) => all.reached.has(id) && !plain.reached.has(id));

  // every key before its gate: its space reached with the gates it opens shut
  const keyBehindGate = [];
  for (const key of m.keys) {
    const gated = m.links.some((l) => l.type === "gate" && l.key === key);
    if (!gated) continue;
    const holder = ids.find((id) => sp(id).keys.includes(key));
    if (!explore(m, { secrets: true, closedKey: key }).reached.has(holder))
      keyBehindGate.push({ key, holder });
  }

  // stranding: a state the player can reach from which the goal cannot be
  const canFinish = new Set();
  const back = new Map();
  for (const [state, next] of all.edges)
    for (const n of next) (back.get(n) ?? back.set(n, []).get(n)).push(state);
  const queue = [...all.states].filter((s) => s.startsWith(`${m.goal}|`));
  for (const s of queue) canFinish.add(s);
  while (queue.length) for (const p of back.get(queue.shift()) ?? []) if (!canFinish.has(p)) canFinish.add(p), queue.push(p); // prettier-ignore
  const strandedAt = new Map();
  if (all.reached.has(m.goal))
    for (const s of all.states) {
      if (canFinish.has(s)) continue;
      const id = s.slice(0, s.lastIndexOf("|"));
      const mask = Number(s.slice(s.lastIndexOf("|") + 1));
      const held = m.keys.filter((_, i) => mask & (1 << i));
      if (!strandedAt.has(id)) strandedAt.set(id, held);
    }
  const stranded = [...strandedAt].map(([id, keys]) => ({ id, keys }));

  // the critical walk (keys fetched, no secrets) and the direct one (every gate open)
  const route = shortestWalk(m, { secrets: false });
  const direct = shortestWalk(m, { secrets: false, allKeys: true });
  const goalWithSecrets = all.reached.has(m.goal);

  // the graph's shape: distinct neighbours, loops (edges - vertices + components). `loops` counts only links
  // walked both ways, as the corpus's floods do (they walk no drop); a cycle a drop or a one-way link closes is
  // `oneWayLoops`.
  const neighbours = new Map(ids.map((id) => [id, new Set()]));
  for (const l of m.links) neighbours.get(l.from).add(l.to), neighbours.get(l.to).add(l.from);
  const pairOf = (l) => [l.from, l.to].sort().join("\u0000");
  const pairs = new Set(m.links.map(pairOf));
  const cycles = (set) => {
    const parent = new Map(ids.map((id) => [id, id]));
    const root = (id) => (parent.get(id) === id ? id : root(parent.get(id)));
    for (const p of set) {
      const [a, b] = p.split("\u0000");
      parent.set(root(a), root(b));
    }
    return set.size - ids.length + new Set(ids.map(root)).size;
  };
  const loops = cycles(new Set(m.links.filter((l) => l.type !== "drop" && l.oneWay !== true).map(pairOf)));
  const oneWayLoops = cycles(pairs) - loops;
  const degree = (id) => neighbours.get(id).size;
  const hubs = ids.filter((id) => degree(id) >= 3);
  const weakHubs = m.hubs.filter((id) => degree(id) < 3).map((id) => ({ id, links: degree(id) }));
  const deadEnds = ids.filter((id) => degree(id) === 1 && id !== m.start && id !== m.goal);
  const rewarded = deadEnds.filter((id) => sp(id).rewards.length);

  // on and off the path
  const onRoute = new Set(route ? route.walk : []);
  const offPath = ids.filter((id) => !onRoute.has(id));
  const area = ids.reduce((a, id) => a + sp(id).area, 0);
  const offArea = offPath.reduce((a, id) => a + sp(id).area, 0);
  let branches = 0;
  for (const p of pairs) {
    const [a, b] = p.split("\u0000");
    if (onRoute.has(a) !== onRoute.has(b)) branches++;
  }

  // pacing along the critical walk: each space at its first visit, as a fraction of the walk
  const curve = [];
  const firstVisits = [];
  if (route) {
    const seen = new Set();
    route.walk.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      const at = route.at[i] / route.length;
      firstVisits.push({ id, at, pacing: sp(id).pacing, weight: sp(id).weight });
      if (sp(id).weight > 0)
        curve.push({ id, at: round(at, 3), weight: sp(id).weight, pacing: sp(id).pacing });
    });
  }
  const fights = firstVisits.filter((v) => v.pacing === "fight");
  let run = 0;
  let maxFightRun = 0;
  for (const v of firstVisits)
    (run = v.pacing === "fight" ? run + 1 : 0), (maxFightRun = Math.max(maxFightRun, run));
  const routeWeight = curve.reduce((a, c) => a + c.weight, 0);
  const peak = curve.reduce((best, c) => (!best || c.weight >= best.weight ? c : best), null);
  const restBeforePeak = peak ? firstVisits.some((v) => v.pacing === "rest" && v.at < peak.at && v.at >= peak.at - 0.35) : false; // prettier-ignore
  const storeys = new Set(ids.flatMap((id) => range(...sp(id).storeys))).size;
  const encounters = ids.reduce((a, id) => a + sp(id).encounters.reduce((n, e) => n + (e.count ?? 1), 0), 0);

  const metrics = {
    spaces: ids.length,
    area: round(area, 1),
    storeys,
    routeLength: route ? round(route.length, 1) : null,
    directLength: direct ? round(direct.length, 1) : null,
    backtrack: route && direct ? round(route.length / direct.length, 3) : null,
    loops,
    oneWayLoops,
    hubs: hubs.length,
    branches,
    deadEnds: deadEnds.length,
    rewardedDeadEndShare: deadEnds.length ? round(rewarded.length / deadEnds.length, 3) : null,
    offPathShare: area ? round(offArea / area, 3) : 0,
    offPathSpaces: offPath.length,
    encounters,
    fightShare: firstVisits.length ? round(fights.length / firstVisits.length, 3) : 0,
    firstFightAt: fights.length ? round(fights[0].at, 3) : null,
    lastFightAt: fights.length ? round(fights[fights.length - 1].at, 3) : null,
    peakAt: peak ? peak.at : null,
    lastThirdShare: routeWeight ? round(curve.filter((c) => c.at >= 2 / 3).reduce((a, c) => a + c.weight, 0) / routeWeight, 3) : null, // prettier-ignore
    maxFightRun,
    restBeforePeak: restBeforePeak ? 1 : 0,
    keys: m.keys.length,
    gates: m.links.filter((l) => l.type === "gate").length,
    drops: m.links.filter((l) => l.type === "drop").length,
    secrets: m.links.filter((l) => l.type === "secret").length,
  };
  return {
    name: m.name,
    metrics,
    reach: { unreached, secretOnly, goal: goalWithSecrets, goalWithoutSecrets: Boolean(route), keyBehindGate, stranded }, // prettier-ignore
    route: route ? { walk: route.walk, length: round(route.length, 1) } : null,
    hubs,
    weakHubs,
    deadEnds: deadEnds.map((id) => ({ id, rewards: sp(id).rewards.map((r) => r.kind) })),
    offPath,
    curve,
  };
}

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/**
 * Bands from a style file of levels/styles/ (its `bands`: { <measure>: { unit, band: { median, p10, p90 } | null } }),
 * as a bands object for checkDescription: each measure a description can estimate, under the description's name
 * for it. The style's are walked-floor measures of real maps; a description's are estimates from its graph
 * (crossing against the direct length, walked area against the footprints). Measures with no band are left out.
 */
export function bandsFromStyle(style, { name = style?.style ?? style?.kind } = {}) {
  const NAMES = { crossing: "directLength", walkedArea: "area", loops: "loops", branches: "branches", offPathShare: "offPathShare" }; // prettier-ignore
  const metrics = {};
  for (const [measure, metric] of Object.entries(NAMES)) {
    const band = style?.bands?.[measure]?.band;
    if (band)
      metrics[metric] = { ...band, unit: style.bands[measure].unit, source: `style ${name}: ${measure}` };
  }
  return { name: `style ${name}`, kind: style?.kind, metrics };
}

/** One metric held to its band: "ok", "edge" (inside the band, outside q1..q3) or "fail". */
export function holdToBand(value, band) {
  if (value === null || value === undefined) return { verdict: "skip", say: "not measured" };
  const lo = band.min ?? band.p5 ?? band.p10;
  const hi = band.max ?? band.p95 ?? band.p90;
  const span = `${lo ?? "-"}..${hi ?? "-"}`;
  if (lo !== undefined && value < lo) return { verdict: "fail", say: `${value} below ${span}` };
  if (hi !== undefined && value > hi) return { verdict: "fail", say: `${value} above ${span}` };
  if ((band.q1 !== undefined && value < band.q1) || (band.q3 !== undefined && value > band.q3))
    return {
      verdict: "edge",
      say: `${value} inside ${span} but outside the middle half ${band.q1}..${band.q3}`,
    };
  return { verdict: "ok", say: `${value} in ${span}` };
}

/**
 * Checks a description: valid, then the graph checks every level must pass, then each metric `bands` names.
 * Returns { pass, failures, notes, results, analysis }; `failures` and `notes` are sentences.
 */
export function checkDescription(desc, bands = null) {
  const { errors, warnings } = validateDescription(desc);
  if (errors.length) return { pass: false, failures: errors.map((e) => `invalid: ${e}`), notes: warnings, results: [], analysis: null }; // prettier-ignore
  const a = analyseDescription(desc);
  const failures = [];
  const notes = [...warnings];
  const { reach } = a;
  if (reach.unreached.length) failures.push(`unreached: ${reach.unreached.join(", ")} cannot be reached from the start`); // prettier-ignore
  if (!reach.goal) failures.push(`goal: ${desc.route.goal} cannot be reached from ${desc.route.start}`);
  else if (!reach.goalWithoutSecrets)
    failures.push(`goal: ${desc.route.goal} is reached only through a secret`);
  for (const k of reach.keyBehindGate)
    failures.push(`keys: key "${k.key}" (in ${k.holder}) lies behind its own gate`);
  for (const s of reach.stranded) failures.push(`stranded: a player in ${s.id}${s.keys.length ? ` holding ${s.keys.join(", ")}` : ""} can no longer reach the goal`); // prettier-ignore
  for (const h of a.weakHubs) failures.push(`hubs: ${h.id} is named a hub but has ${h.links} neighbour${h.links === 1 ? "" : "s"} (a hub wants 3)`); // prettier-ignore
  if (reach.secretOnly.length)
    notes.push(`hidden: ${reach.secretOnly.join(", ")} reached only through a secret`);

  const results = [];
  const metrics = bands ? (bands.metrics ?? bands) : {};
  for (const [metric, band] of Object.entries(metrics)) {
    if (!band || typeof band !== "object") continue;
    const value = a.metrics[metric];
    const held = holdToBand(value, band);
    results.push({ metric, value, band, ...held });
    if (held.verdict === "fail")
      failures.push(`${metric}: ${held.say}${band.source ? ` (${band.source})` : ""}`);
    else if (held.verdict === "edge") notes.push(`${metric}: ${held.say}`);
    else if (held.verdict === "skip") notes.push(`${metric}: not measured on this description`);
  }
  return { pass: failures.length === 0, failures, notes, results, analysis: a };
}

/** The answer in text: one line when it passes (plus notes only when asked), the reasons when it fails. */
export function describeCheck(result, { name = "description", bandsName = null, verbose = false } = {}) {
  const a = result.analysis;
  const m = a?.metrics;
  const head = m
    ? `${name}: ${m.spaces} spaces, ${m.area} m2 on ${m.storeys} storey${m.storeys === 1 ? "" : "s"}, route ${m.routeLength ?? "none"} m, ${m.loops} loop${m.loops === 1 ? "" : "s"}, ${m.deadEnds} dead ends (${Math.round((m.rewardedDeadEndShare ?? 0) * 100)}% rewarded), ${Math.round(m.offPathShare * 100)}% off the path${bandsName ? ` [${bandsName}]` : ""}` // prettier-ignore
    : name;
  const lines = [`${result.pass ? "PASS" : "FAIL"}  ${head}`];
  for (const f of result.failures) lines.push(`  - ${f}`);
  if (verbose || !result.pass) {
    if (a?.curve.length)
      lines.push(`  pacing: ${a.curve.map((c) => `${c.id}@${c.at}(${c.weight})`).join(" ")}`);
    for (const n of result.notes) lines.push(`  note: ${n}`);
  }
  return lines.join("\n");
}
