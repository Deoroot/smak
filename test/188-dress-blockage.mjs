// levels/assembly, the dressing's blockage check (dress.mjs blockageProblems): what the props of a dressed site stand in
// the way of. A prop within 16 of a stair's, a ramp's or a roof way's footprint (the open floor's props; the rooms' own keep
// to their stair's cells), a prop in a door's front, its open leaf or on one of its two spots, and the props a player walks
// into (over a step high) that have no CLIP brush; every sentence names the model and the place. The broken cases are in
// test/broken/levels.mjs. The site's own props are held by the build of byzantium-02-spine, by hand: its failures list.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { dressSite, loadDress, blockageProblems, BLOCK_MARGIN, DOOR_FRONT } from "../levels/assembly/dress.mjs";
import { roofFootprints } from "../levels/assembly/roofs.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";

const prop = (over = {}) => ({ id: "crate_closed", file: "models/h9/crate.mdl", mode: "wall", lo: [400, 400, 0], hi: [440, 440, 40], clip: true, floor: 0, open: true, ...over });
const kinds = (r) => r.map((q) => q.kind);

test("blockage: a prop within the margin of a ramp or stair is said once with its model and place; one on another height is not", () => {
  const ramp = [{ for: "open", what: 'the ramp "the ramp"', lo: [128, 128, 0], hi: [256, 256, 72] }];
  const near = blockageProblems({ props: [prop({ lo: [256 + BLOCK_MARGIN - 1, 150, 0], hi: [300, 190, 40] })], obstacles: ramp });
  sure(near.length === 1 && near[0].kind === "stair" && /crate_closed \(models\/h9\/crate\.mdl\) at 271,150,0 to 300,190,40 stands in the ramp "the ramp"/.test(near[0].say), JSON.stringify(near));
  sure(!blockageProblems({ props: [prop({ lo: [256 + BLOCK_MARGIN, 150, 0], hi: [300, 190, 40] })], obstacles: ramp }).length, "16 off is clear");
  sure(!blockageProblems({ props: [prop({ lo: [150, 150, -200], hi: [190, 190, -160], floor: -200 })], obstacles: ramp }).length, "a prop on the level below is not on the ramp");
});

test("blockage: a room's prop is held to its stair's cells (no margin through a wall); the open floor's to the margin", () => {
  const inside = [{ for: "room", margin: 0, what: "the stair of building b (storey 0) at cell 2,2", lo: [128, 128, 0], hi: [192, 192, 192] }];
  sure(!blockageProblems({ props: [prop({ open: false, lo: [100, 130, 0], hi: [126, 190, 40] })], obstacles: inside }).length, "a prop 2 off the stair's cell, across a wall, is clear");
  sure(kinds(blockageProblems({ props: [prop({ open: false, lo: [100, 130, 0], hi: [140, 190, 40] })], obstacles: inside })).join() === "stair", "a prop over the cell blocks it");
  sure(!blockageProblems({ props: [prop({ open: true, lo: [100, 130, 0], hi: [140, 190, 40] })], obstacles: inside }).length, "an open-floor prop is not tested against a room's stair");
});

test("blockage: a door's front, its open leaf and its spots are kept clear; a rug, a picture and a low thing are not blocks", () => {
  const door = { name: "d", targetname: "shop_door", middle: [128, 128], into: [0, 1], along: [1, 0], floor: 0, leaf: null, spots: { n: 1, a: { name: "shop_door_1_a", at: [128, 80, 2] }, b: { name: "shop_door_1_b", at: [128, 232, 2] } } };
  const say = (p, d = door) => blockageProblems({ props: [prop(p)], doors: [d] }).map((q) => q.say).join("|");
  sure(/in the front of the door shop_door \(1\) at 128,128 \(64 each side of its line\)/.test(say({ lo: [100, 60, 0], hi: [140, 100, 40] })), "the front, the near side");
  sure(DOOR_FRONT === 64 && /in the front/.test(say({ lo: [150, 180, 0], hi: [170, 190, 40] })), "the front, the far side, a hull off the opening");
  sure(/in the open leaf/.test(say({ lo: [300, 130, 0], hi: [320, 150, 40] }, { ...door, spots: null, leaf: [[290, 120, 0], [330, 160, 80]] })), "the leaf's swing");
  sure(say({ lo: [300, 60, 0], hi: [340, 100, 40] }) === "", "a prop well beside the door is clear");
  sure(say({ lo: [100, 60, 0], hi: [140, 100, 2], mode: "rug", clip: false }) === "", "a rug lies on the front");
  sure(say({ lo: [100, 60, 96], hi: [140, 100, 120], mode: "hung", clip: false }) === "", "a picture hangs by the door");
  sure(say({ lo: [100, 60, 0], hi: [140, 100, 10], clip: false }) === "", "a thing under a step with no clip is walked over");
  sure(/stands on shop_door_1_b/.test(say({ lo: [128, 200, 0], hi: [150, 222, 40], mode: "wall" })), "a spot, beyond the front, is a spot");
});

test("blockage: a prop with no CLIP is said in one sentence with the count and the first ten; rugs, pictures, lanterns and low things are not counted", () => {
  const bare = (i, over = {}) => prop({ id: `plant_${i}`, file: `models/p${i}.mdl`, clip: false, lo: [i * 50, 0, 0], hi: [i * 50 + 20, 20, 60], ...over });
  const props = [...Array.from({ length: 12 }, (_, i) => bare(i)), prop({ mode: "rug", clip: false, hi: [440, 440, 2] }), bare(20, { mode: "hung", lo: [0, 0, 96], hi: [4, 40, 130] }), bare(21, { hi: [20, 20, 12] }), prop()];
  const got = blockageProblems({ props });
  sure(got.length === 1 && got[0].kind === "clip" && got[0].count === 12, JSON.stringify(got));
  sure(/^12 props a player walks into .* have no CLIP brush; the first 10: plant_0 \(models\/p0\.mdl\) at 0,0,0, 60 high; plant_1/.test(got[0].say) && !/plant_10/.test(got[0].say), got[0].say);
});

test("blockage: the roofs' ladders, stairs, crates, planks and bridges have footprints on the ground by their wall (planks and bridges at their roof's height)", () => {
  const plan = planSite(JSON.parse(readFileSync(join(HERE, "../levels/specs/roofs-test.json"), "utf8")));
  const feet = roofFootprints(plan);
  const kindsOf = new Set(feet.map((f) => f.kind));
  sure(["ladder", "stair", "crates", "plank", "bridge"].every((k) => kindsOf.has(k)), `the footprints: ${[...kindsOf]}`);
  for (const f of feet) sure(f.lo.every((v, i) => v < f.hi[i]), `${f.name}: ${f.lo} to ${f.hi}`);
  for (const f of feet.filter((q) => ["plank", "bridge"].includes(q.kind))) sure(f.lo[2] > 64, `${f.name} is over the street: ${f.lo[2]}`);
});

test("blockage: a dressed site's report holds its props and the sentences, which are in its failures", () => {
  const plan = planSite(siteSpec("mese-01"));
  const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
  const built = assembleSite(plan, library, { style: loadStyle("mese") });
  const r = dressSite(plan, built, loadDress("h9-byzantium")).report;
  const c = r.counts;
  sure(r.props.length === c.prop + (c["counter-shelf-model"] ?? 0) / 2 + (c["street-lamp-post"] ?? 0), `${r.props.length} props logged of ${c.prop} + a shelf pair to a counter + lamps`);
  sure(r.props.filter((p) => p.mode === "rug").length === c["prop-rug"], "every rug logged as a rug");
  sure(r.props.filter((p) => p.clip).length === c["prop-clip"], `${r.props.filter((p) => p.clip).length} logged with a clip against ${c["prop-clip"]} clips made`);
  for (const b of r.blockage) sure(r.failures.includes(b.say), `a blockage sentence not in the failures: ${b.say}`);
  sure((c["blockage-stair"] ?? 0) + (c["blockage-door"] ?? 0) === r.blockage.filter((b) => b.kind !== "clip").length, "the counts are the sentences'");
  sure(!r.blockage.length && !r.failures.length, `mese-01 dressed blocks nothing: ${r.blockage.map((b) => b.say).join(" | ")} ${r.failures.join(" | ")}`);
});

test("blockage: the dressed roofs' and terrain test plans (ramps, stairs, roof ways) have nothing the props block, and no failure", () => {
  const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
  const dress = loadDress("h9-byzantium");
  const got = (plan) => dressSite(plan, assembleSite(plan, library, { style: loadStyle("mese") }), dress).report;
  for (const name of ["roofs-test", "terrain-test"]) {
    const r = got(planSite(JSON.parse(readFileSync(join(HERE, `../levels/specs/${name}.json`), "utf8"))));
    sure(!r.blockage.length && !r.failures.length, `${name}: ${r.blockage.map((b) => b.say).join(" | ")} ${r.failures.join(" | ")}`);
  }
});
