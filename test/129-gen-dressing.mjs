// The map generator's stage 8, dressing (levels/experimental-city/dressing.mjs, stage8-dressing.mjs): New Byzantium's Core tile
// dressed and passing its gate; the same inputs give the same bytes; the gate fails a broken copy by its sentence,
// naming the prop, the thing it breaks and by how much: a wardrobe in a door's swing, a crate across a doorway, a
// table cutting a room in two, a prop outside its room, two props overlapping, a use side covered, a room past its
// clutter cap, a bench on a carriageway and on a portal, too much street clutter, a kind no rule places.
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { testAsync, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator, regate } from "../levels/experimental-city/runner.mjs";
import { stage as stage8 } from "../levels/experimental-city/stage8-dressing.mjs";
import { metreRules } from "../levels/experimental-city/stage3-programs.mjs";
import { roomFloor, roomDoors, footOf } from "../levels/experimental-city/dressing.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const OUT = join(tmp, "gen-dressing");
const copy = (v) => JSON.parse(JSON.stringify(v));
let art = null;
let inputs = null;
let rules = null;

const gateSays = async (broken, ...words) => {
  const v = await regate("dressing", broken, { desc, inputs });
  const hit = v.failures.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `the dressing gate did not say ${JSON.stringify(words)}; it said: ${v.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
  return hit;
};
const planOf = (id) => inputs["05-plans.json"].buildings.find((b) => b.id === id);
const roomOf = (p) => planOf(p.building).rooms.find((r) => r.id === p.room);
/** A prop at a foot centre (lot frame) with a world size, in a room. */
const roomProp = (id, kind, room, b, at, size, facing = [0, 1], rule = "freestanding") => ({
  id, kind, model: `prop/${kind}`, build: "brush", place: "room", layer: b.layer, building: b.id, room: room.id, storey: room.storey, rule,
  at_m: [at[0], at[1], 0], size_m: size, facing, wall: false, collision: true, use: null,
}); // prettier-ignore

await testAsync("gen dressing: the Core dressed by rules passes stage 8's gate, the same bytes twice", "gen dressing", async () => {
  // stages 0-5 must pass; 6 and 7 are built apart: when they stop the run, stage 8 runs on 0-5 alone (it reads 06
  // and 07 only when they are there) and is gated the same way
  const res = await runGenerator({ desc, out: OUT, tile: "c1_r1", until: 8 });
  const upTo5 = res.results.filter((r) => r.n <= 5);
  sure(upTo5.length >= 6 && upTo5.every((r) => r.pass), `stages 0-5: ${res.refused ?? JSON.stringify(res.stopped)}`);
  rules = metreRules({ rulebook: JSON.parse(readFileSync(join(HERE, "../levels/rules/architecture.json"), "utf8")), description: desc });
  inputs = {};
  if (res.ok) {
    const r8 = res.results.find((r) => r.n === 8);
    sure(r8?.pass, `stage 8: ${r8?.failures?.slice(0, 3).join(" | ")}`);
    for (const f of readdirSync(OUT)) if (/^0[0-7]-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(OUT, f), "utf8"));
    art = JSON.parse(readFileSync(join(OUT, "08-dressing.json"), "utf8"));
  } else {
    for (const f of readdirSync(OUT)) if (/^0[0-5]-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(OUT, f), "utf8"));
    const ctx = { description: desc, rulebook: JSON.parse(readFileSync(join(HERE, "../levels/rules/architecture.json"), "utf8")), params: { tile: "c1_r1", seed: 1 }, inputs }; // prettier-ignore
    art = { params: ctx.params, ...stage8.run(ctx) };
    const v = stage8.gate(art, ctx);
    sure(v.failures.length === 0, `stage 8 (on 0-5): ${v.failures.slice(0, 3).join(" | ")}`);
  }
  // determinism: the stage run again on the same inputs gives the same body
  const ctx = { description: desc, rulebook: JSON.parse(readFileSync(join(HERE, "../levels/rules/architecture.json"), "utf8")), params: art.params, inputs }; // prettier-ignore
  const again = stage8.run(ctx);
  for (const k of ["props", "rooms", "streets", "reserved", "measures"]) sure(JSON.stringify(again[k]) === JSON.stringify(art[k]), `stage 8 gave a different ${k} the second time`);
  // what it holds
  const m = art.measures;
  sure(m.roomsDressed >= 100 && m.inRooms >= 400, `rooms dressed ${m.roomsDressed}, props in rooms ${m.inRooms}`);
  sure(m.inStreets >= 50, `street props ${m.inStreets}`);
  sure(art.props.every((p) => p.id && p.kind && p.layer && p.rect && p.model === `prop/${p.kind}`), "a prop without its id, kind, layer, rect or model");
  sure(new Set(art.props.map((p) => p.id)).size === art.props.length, "two props with one id");
  sure(art.props.some((p) => p.kind === "market-stall" && p.district === "d2_bazaar"), "no stall in the Bazaar");
  sure(art.rooms.filter((r) => ["corridor", "stairwell"].includes(r.kind)).every((r) => !r.dressed && r.props.length === 0), "a corridor or stairwell dressed");
  for (const a of art.streets) sure(a.per100 <= a.cap + 1e-9, `${a.layer} ${a.district}: ${a.per100} props per 100 m2 over ${a.cap}`);
  // models only where brushes cannot do, within the tile's cap; the brush budget counts the props
  const modelKinds = new Set(rules.placement.props.modelKinds);
  sure(art.props.filter((p) => p.build === "model").every((p) => modelKinds.has(p.kind)), "a model prop of a kind brushes could build");
  sure(m.models <= m.modelProps.cap, `${m.models} model props over the cap ${m.modelProps.cap}`);
  sure(m.brushBudget.props > 0 && (m.brushBudget.total === null || m.brushBudget.total <= m.brushBudget.limit), JSON.stringify(m.brushBudget));
  if (res.ok) sure((art.hungLamps ?? []).every((h) => h.deliberate), "a street lamp left hanging that 06 did not hang on purpose");
});

await testAsync("gen dressing: stage 8's gate fails a broken copy by its sentence", "gen dressing broken", async () => {
  sure(art, "no 08-dressing to break (the first case failed)");
  // a wardrobe in a door's swing
  const wardrobe = art.props.find((p) => p.kind === "wardrobe");
  const wb = planOf(wardrobe.building);
  const door = wb.doors.find((d) => d.storey === wardrobe.storey && d.swing === "front" && (d.swingInto === wardrobe.room));
  sure(door, "no door swinging into the wardrobe's room");
  let b = copy(art);
  let p = b.props.find((x) => x.id === wardrobe.id);
  p.at_m = [door.at[0] + door.facing[0] * (door.wall / 2 + door.width / 2), door.at[1] + door.facing[1] * (door.wall / 2 + door.width / 2), 0];
  p.size_m = door.facing[0] === 0 ? [1.2192, 0.6096, 2.1] : [0.6096, 1.2192, 2.1];
  await gateSays(b, `prop ${wardrobe.id} (wardrobe) enters door ${door.id}'s swing (front) by`, "wanted clear of it");
  // a crate across a doorway
  // (a crate in a room entered by a door with a leaf: an opening is said as one)
  const leafDoor = (x) => planOf(x.building).doors.find((d) => d.storey === x.storey && d.swing === "front" && (d.from === x.room || d.to === x.room)); // prettier-ignore
  const crate = art.props.find((x) => x.kind === "crate" && x.place === "room" && leafDoor(x));
  const cb = planOf(crate.building);
  const cdoor = leafDoor(crate);
  b = copy(art);
  p = b.props.find((x) => x.id === crate.id);
  // in the opening, its far half on the crate's own room's side (so it stands on that room's floor and across the door)
  const croom = cb.rooms.find((r) => r.id === crate.room);
  const into = [1, -1].find((s) => croom.rects.some((q) => { const x = cdoor.at[0] + s * cdoor.facing[0] * 0.4; const y = cdoor.at[1] + s * cdoor.facing[1] * 0.4; return x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.d; })) ?? 1; // prettier-ignore
  const half = Math.min(...(crate.size_m ?? [0.6, 0.6]).slice(0, 2)) / 2;
  p.at_m = [cdoor.at[0] + into * cdoor.facing[0] * (cdoor.wall / 2 + half * 0.5), cdoor.at[1] + into * cdoor.facing[1] * (cdoor.wall / 2 + half * 0.5), 0]; // prettier-ignore
  await gateSays(b, `prop ${crate.id} (crate) crosses door ${cdoor.id}'s opening by`, "never across an opening");
  // a table cutting a room in two: a room joined by a walk between two doors, a table wall to wall between them
  let cut = null;
  for (const r of art.rooms) {
    if (!r.dressed || !(r.walkPairs ?? []).length) continue;
    const plan = planOf(r.building);
    const room = plan.rooms.find((x) => x.id === r.room);
    if (room.clear.length !== 1) continue;
    const floor = roomFloor(room);
    const doors = roomDoors(plan, room, floor);
    const [a, c] = [doors.find((d) => d.door.id === r.walkPairs[0][0]), doors.find((d) => d.door.id === r.walkPairs[0][1])];
    const q = room.clear[0];
    const dx = Math.abs(a.p[0] - c.p[0]);
    const dy = Math.abs(a.p[1] - c.p[1]);
    if (Math.max(dx, dy) < 3) continue;
    const mid = [(a.p[0] + c.p[0]) / 2, (a.p[1] + c.p[1]) / 2];
    // across the axis that separates the doors, from wall to wall
    const at = dx >= dy ? [mid[0], q.y + q.d / 2] : [q.x + q.w / 2, mid[1]];
    const size = dx >= dy ? [0.9144, q.d, 0.75] : [q.w, 0.9144, 0.75];
    cut = { r, room, plan, at, size, pair: r.walkPairs[0] };
    break;
  }
  sure(cut, "no room with two doors a walk apart");
  b = copy(art);
  b.props.push(roomProp("test.table", "dining-table", cut.room, cut.plan, cut.at, cut.size));
  await gateSays(b, `room ${cut.room.id}: doors`, "are no longer joined by", "after dressing", "cut by prop test.table (dining-table)");
  // a prop outside its room, and two props overlapping
  const shelf = art.props.find((x) => x.kind === "shelving");
  b = copy(art);
  p = b.props.find((x) => x.id === shelf.id);
  p.at_m = [p.at_m[0] - p.facing[0] * 1.5, p.at_m[1] - p.facing[1] * 1.5, 0];
  await gateSays(b, `prop ${shelf.id} (shelving) stands`, `outside room ${shelf.room}'s floor`);
  b = copy(art);
  b.props.push({ ...copy(shelf), id: "test.twin" });
  await gateSays(b, `prop ${shelf.id} (shelving) overlaps prop test.twin (shelving) by`);
  // a use side covered: a crate standing in a wardrobe's front
  b = copy(art);
  const wf = footOf(wardrobe.at_m, wardrobe.size_m);
  const front = [(wf[0] + wf[2]) / 2 + wardrobe.facing[0] * (wardrobe.size_m[0] / 2 + 0.5), (wf[1] + wf[3]) / 2 + wardrobe.facing[1] * (wardrobe.size_m[1] / 2 + 0.5)];
  b.props.push(roomProp("test.crate", "crate", roomOf(wardrobe), wb, front, [0.8128, 0.8128, 1]));
  await gateSays(b, `prop ${wardrobe.id} (wardrobe): no use side`, "covered by prop test.crate (crate)");
  // a room past its clutter cap
  const store = art.rooms.find((r) => r.dressed && r.kind === "storeroom" && r.props.length);
  b = copy(art);
  const sp = b.props.find((x) => x.id === store.props[0]);
  const sroom = roomOf(sp);
  const big = sroom.clear.reduce((m, q) => (q.w * q.d > m.w * m.d ? q : m));
  sp.at_m = [big.x + big.w / 2, big.y + big.d / 2, 0];
  sp.size_m = [big.w * 0.95, big.d * 0.9, 1];
  await gateSays(b, `room ${store.room} (storeroom, storage): props cover`, "wanted 70 % or less");
  // street: a bench on a carriageway, a prop on a portal
  const site = inputs["01-site.json"];
  const cell = site.grid.cell;
  const bench = art.props.find((x) => x.place === "street" && x.kind === "street-bench" && x.layer === "L2");
  const av = site.ways.find((w) => w.id === "s2_av_hearth");
  const mid = av.parts[0].map((q) => [q[0] * cell, q[1] * cell]);
  b = copy(art);
  p = b.props.find((x) => x.id === bench.id);
  p.at_m = [(mid[0][0] + mid[1][0]) / 2, (mid[0][1] + mid[1][1]) / 2, p.at_m[2]];
  await gateSays(b, `prop ${bench.id} (street-bench) enters avenue s2_av_hearth's carriageway by`, "wanted clear of it");
  const cap = site.ways.find((w) => w.id === "s1_main").caps[0];
  const l1 = art.props.find((x) => x.place === "street" && x.layer === "L1" && x.size_m[0] < 1);
  b = copy(art);
  p = b.props.find((x) => x.id === l1.id);
  p.at_m = [cap.at[0] * cell, cap.at[1] * cell + 1.0, p.at_m[2]];
  await gateSays(b, `prop ${l1.id} (${l1.kind}) enters portal ${cap.portal} of s1_main by`);
  // too much street clutter: the Bazaar's props tripled (on copies standing where the others stand: their overlaps aside)
  b = copy(art);
  const bz = art.props.filter((x) => x.place === "street" && x.district === "d2_bazaar" && x.kind !== "lamp-post");
  for (const [i, x] of [...bz, ...bz].entries()) b.props.push({ ...copy(x), id: `test.more${i}` });
  await gateSays(b, "streets of d2_bazaar on L2:", "per 100 m2, wanted", "or less (STREET_CAP");
  // a kind no rule places
  b = copy(art);
  b.props.push({ ...copy(shelf), id: "test.piano", kind: "piano" });
  await gateSays(b, "prop test.piano (piano): no rule places a piano");
});
