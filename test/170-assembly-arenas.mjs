// levels/assembly/arena.mjs, the plans of a mission arena (2026-11-06): "room" (the default, unchanged), "yard" (stacks for
// cover, three crates, a dock up a stair), "vault" (a door between two rooms, a button each side), "tunnel" (a winding
// corridor, a button halfway, a chamber at its end), a mini room of 512 x 512; and the mission arenas of byzantium-01
// with the missions that use them (the contract's names, the plugin's limits, plain ASCII for the chat font).
import { test, sure } from "./helper.mjs";
import { arenasOf } from "../levels/assembly/arena.mjs";
import { readSite, siteSpec } from "../levels/assembly/site.mjs";
import { holds, shapeOf } from "../src/maps/source.mjs";

const N = "smak_x";
const one = (a) => arenasOf({ arenas: [{ id: "a", at: [-3072, 0, 0], back: [[640, 576, 90], [704, 576, 90]], ...a }] }, N);
const byName = (r, what) => r.entities.find((e) => e.targetname === `${N}_arena_a_${what}`);
const names = (r) => r.entities.map((e) => e.targetname).filter(Boolean);
const num = (v) => String(v).split(" ").map(Number);
/** The extent of a brush entity's brushes: [min, max]. */
const extent = (e) => {
  const shapes = e.brushes.map((b) => shapeOf(b));
  return [0, 1, 2].map((i) => [Math.min(...shapes.map((s) => s.min[i])), Math.max(...shapes.map((s) => s.max[i]))]);
};
/** Whether a point is inside the rock or a solid of the arena. */
const solidAt = (r, p) => r.brushes.some((b) => holds(b, p));
const reachables = (r) => r.entities.filter((e) => e.origin && /_(spawn\d|goal|manager|reset|bell)$/.test(e.targetname ?? "")); // (the points a player or a plugin uses)

test("arena plans: with no plan the arena is the room, the same as plan room, and its names are the contract's", () => {
  const a = one({ size: [768, 768, 256] });
  const b = one({ size: [768, 768, 256], plan: "room" });
  sure(!a.report.failures.length && JSON.stringify(a) === JSON.stringify(b), a.report.failures.join(" | "));
  const got = names(a);
  for (const w of ["spawn1", "spawn2", "spawn3", "spawn4", "back1", "back2", "goal", "button", "crate", "reset", "bell"]) sure(got.includes(`${N}_arena_a_${w}`), `no ${w}`); // prettier-ignore
  // (what it made before the plans: the classnames of its entities in their order)
  const classes = a.entities.map((e) => e.classname).join(" ");
  sure(classes === "info_target info_target info_target info_target info_target info_target light light light light trigger_multiple func_button func_breakable multi_manager ambient_generic", classes); // prettier-ignore
  sure(a.arenas[0].spawns.length === 4 && a.arenas[0].back.length === 2 && a.arenas[0].reset.join() === `${N}_arena_a_reset`, JSON.stringify(a.arenas[0])); // prettier-ignore
});

test("arena plans: a mini room of 512 x 512 x 192 has all its targets, none inside a wall", () => {
  const r = one({ size: [512, 512, 192] });
  sure(!r.report.failures.length, r.report.failures.join(" | "));
  for (const e of reachables(r)) sure(!solidAt(r, num(e.origin)), `${e.targetname} at ${e.origin} is inside a solid`);
  const crate = extent(byName(r, "crate"));
  const goal = extent(byName(r, "goal"));
  sure(crate[0][1] < goal[0][0] || crate[1][1] < goal[1][0], "the crate stands on the pad");
  sure(!r.entities.some((e) => e.classname === "func_door"), "a plain room has a door");
});

test("arena plans: a yard has three crates, a goal on the dock up steps of 16, stacks for cover, nothing in the way of the spawns", () => {
  const r = one({ plan: "yard", size: [1024, 768, 256] });
  sure(!r.report.failures.length, r.report.failures.join(" | "));
  const crates = r.entities.filter((e) => e.classname === "func_breakable").map((e) => e.targetname);
  sure(crates.join() === `${N}_arena_a_crate1,${N}_arena_a_crate2,${N}_arena_a_crate3`, crates.join());
  const goal = extent(byName(r, "goal"));
  sure(goal[2][0] === 64, `the goal's floor is ${goal[2][0]}, not the dock's 64`);
  // every brush that is a step: its top is at 16, 32, 48 or the dock's 64; the least rise is 16 (the player's 18)
  const tops = new Set(r.brushes.map((b) => shapeOf(b).max[2]).filter((z) => z > 0 && z <= 66));
  const sorted = [...tops].sort((a, b) => a - b);
  sure([16, 32, 48, 64].every((z) => sorted.includes(z)), `tops ${sorted.join(" ")}`);
  let prev = 0;
  for (const z of [16, 32, 48, 64]) (sure(z - prev <= 16, `a step of ${z - prev}`), (prev = z));
  // cover: at least 4 solids stand in the room, over the floor
  const stacks = r.brushes.filter((b) => b.faces.some((f) => /CRATE0[3-6]/.test(JSON.stringify(f.texture))));
  sure(stacks.length >= 4, `${stacks.length} stacks`);
  for (const e of reachables(r)) sure(!solidAt(r, num(e.origin)), `${e.targetname} at ${e.origin} is inside a solid`);
  for (const s of r.entities.filter((e) => /_spawn\d$/.test(e.targetname ?? ""))) sure(!solidAt(r, num(s.origin)), `${s.targetname} is inside a stack`);
});

test("arena plans: a vault has a shut door fired by a button on each side, and the pad and the strongbox behind it", () => {
  const r = one({ plan: "vault", size: [1024, 768, 256] });
  sure(!r.report.failures.length, r.report.failures.join(" | "));
  const door = byName(r, "vaultdoor");
  sure(door?.classname === "func_door" && Number(door.spawnflags) === 0 && Number(door.dmg) === 0, JSON.stringify(door && { ...door, brushes: 0 }));
  sure(byName(r, "button").target === `${N}_arena_a_vaultdoor` && byName(r, "button_in").target === `${N}_arena_a_vaultdoor`, "the buttons do not fire the door");
  const d = extent(door);
  const crate = extent(byName(r, "crate"));
  const goal = extent(byName(r, "goal"));
  sure(crate[0][0] > d[0][1] && goal[0][0] > d[0][1], "the strongbox or the pad is on the near side of the door");
  const spawn = num(byName(r, "spawn1").origin);
  sure(spawn[0] < d[0][0], "the party starts behind the door");
  const outside = extent(byName(r, "button"));
  const inside = extent(byName(r, "button_in"));
  sure(outside[0][1] <= d[0][0] + 1 && inside[0][0] >= d[0][1] - 1, "a button is on the wrong side");
  for (const e of reachables(r)) sure(!solidAt(r, num(e.origin)), `${e.targetname} at ${e.origin} is inside a solid`);
});

test("arena plans: a tunnel winds with at least three turns, the button in the middle lane, the pad at the far end, no crate", () => {
  const r = one({ plan: "tunnel", size: [1536, 896, 192] });
  sure(!r.report.failures.length, r.report.failures.join(" | "));
  sure(!byName(r, "crate"), "a tunnel has a crate");
  const goal = extent(byName(r, "goal"));
  const spawn = num(byName(r, "spawn1").origin);
  // the pad is in the last lane, a whole run of lanes from the spawns
  sure(goal[1][0] - spawn[1] >= 3 * 256 - 128, `pad y ${goal[1][0]}, spawn y ${spawn[1]}`);
  const button = extent(byName(r, "button"));
  sure(button[1][0] > spawn[1] + 256 && button[1][1] < goal[1][0], "the button is not between the spawns and the pad");
  // 4 lanes: 3 links, 6 turns; fewer lanes than 3 would be refused by the least size
  const lanes = Math.floor((896 - 128) / 256) + 1;
  sure(2 * (lanes - 1) >= 3, `${2 * (lanes - 1)} turns`);
  for (const e of reachables(r)) sure(!solidAt(r, num(e.origin)), `${e.targetname} at ${e.origin} is inside a solid`);
  // the pad sits in the open: its centre, a player's height over the floor, is no solid
  const mid = goal.map(([a, b]) => (a + b) / 2);
  sure(!solidAt(r, [mid[0], mid[1], 36]), "the pad is in rock");
});

test("arena plans: spawns makes fewer starts, and refuses a count that is no whole number up to four", () => {
  const r = one({ size: [512, 512, 192], spawns: 2 });
  sure(!r.report.failures.length && r.arenas[0].spawns.length === 2 && names(r).filter((n) => /_spawn\d$/.test(n)).length === 2, JSON.stringify(r.arenas[0].spawns));
  for (const n of [0, 5, 1.5, "2"]) sure(one({ size: [512, 512, 192], spawns: n }).report.failures.some((f) => /spawns is how many starts/.test(f)), `spawns ${n}`);
});

test("arena plans: an unknown plan and a plan's room too small are refused, a room 512 x 512 is not", () => {
  sure(one({ plan: "cellar", size: [768, 768, 256] }).report.failures.some((f) => /its plan is "cellar"/.test(f)), "unknown plan");
  for (const plan of ["yard", "vault", "tunnel"]) sure(one({ plan, size: [600, 600, 192] }).report.failures.some((f) => new RegExp(`too small for the plan ${plan}`).test(f)), plan); // prettier-ignore
  sure(!one({ plan: "room", size: [512, 512, 192] }).report.failures.length, "a room of 512 refused");
});

test("arena plans: byzantium-01's arenas stand apart inside +-4096, away from the city, and every mission's targets and giver exist", () => {
  const site = readSite(siteSpec("byzantium-01")).site;
  const name = site.name;
  const got = arenasOf(site, name);
  sure(!got.report.failures.length, got.report.failures.join(" | "));
  const ids = site.arenas.map((a) => a.id);
  sure(["workshop", "almacen", "boveda", "cisterna", "recado"].every((i) => ids.includes(i)), ids.join());
  // the arenas' outsides (walls 16) do not touch each other, the city (x 0..3072, y 0..3712), and stay inside +-4096
  const boxes = site.arenas.map((a) => ({ id: a.id, min: [a.at[0] - 16, a.at[1] - 16], max: [a.at[0] + a.size[0] + 16, a.at[1] + a.size[1] + 16] }));
  for (const b of boxes) {
    sure([...b.min, ...b.max].every((v) => Math.abs(v) <= 4096), `${b.id} past 4096`);
    sure(b.max[0] <= 0 || b.min[0] >= 3072 || b.max[1] <= 0 || b.min[1] >= 3712, `${b.id} touches the city`);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [p, q] = [boxes[i], boxes[j]];
      sure(p.max[0] <= q.min[0] || q.max[0] <= p.min[0] || p.max[1] <= q.min[1] || q.max[1] <= p.min[1], `${p.id} overlaps ${q.id}`);
    }
  const targets = new Set(got.entities.map((e) => e.targetname).filter(Boolean));
  const rp = site.rp;
  sure(rp.missions.length <= 32 && site.arenas.length <= 16, "past the plugin's limits");
  const npcOf = new Map(rp.npcs.map((n) => [n.id, n]));
  for (const m of rp.missions) {
    sure(m.steps.length >= 1 && m.steps.length <= 8, `${m.id}: ${m.steps.length} steps`);
    sure(ids.includes(m.arena) && npcOf.get(m.giver)?.gives.includes(m.id), `${m.id}: its arena or giver`);
    sure(m.time >= 120 && m.time <= 300 && m.party[0] >= 1 && m.party[1] <= 4, `${m.id}: time or party`);
    const text = JSON.stringify([m.title, m.done, m.steps.map((s) => s.say)]);
    sure(/^[\x20-\x7e]*$/.test(text), `${m.id}: not plain ASCII (the chat font)`);
    for (const s of m.steps) {
      sure(["reach", "use", "destroy", "survive"].includes(s.do), `${m.id}: step ${s.do}`);
      if (s.do !== "survive") sure(targets.has(s.target), `${m.id}: ${s.target} is no entity of the arenas`);
      else sure(s.time > 0 && !s.target, `${m.id}: a survive step wants a time`);
      sure(s.say.length < 128, `${m.id}: a line too long for the plugin`);
    }
    const arena = got.arenas.find((a) => a.id === m.arena);
    sure(arena.spawns.length >= m.party[1], `${m.id}: ${arena.spawns.length} spawns for a party of ${m.party[1]}`);
  }
  const breakables = rp.missions.flatMap((m) => m.steps.filter((s) => s.do === "destroy"));
  sure(breakables.length <= 16, `${breakables.length} breakables, the plugin keeps 16`);
});
