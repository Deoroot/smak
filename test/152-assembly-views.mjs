// levels/assembly part V, the diagnostic views (levels/assembly/views.mjs): on the views' own house of two storeys
// (sampleHouse, a source map: no compile, no game files) the plan puts each room's name in its own cell and crosses a
// door raised 48 over the floor with its sill measured; the floor's height rises up the stair in the table and a
// stair lifted 32 has a ledge at its foot that the good one has not; the cutaways are one picture a storey, three
// corners wide; the eye shots stand at each door's two sides, the stair's foot, side and top and each room, named so,
// each with its question. On the kit's compiled two rooms (test/fixtures/tworooms.bsp) every view of a compiled map
// is drawn at its size, the light map from its lightmaps, and the command ends in its PASS line. On the house
// compiled here (when VHLT is named in VHLT_DIR, with a .wad of the kit's own): the room left with no light is dark
// on the light map and the others are not, and the command passes the good house and fails the broken one by name.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as maps from "../src/maps/index.mjs";
import { test, sure, tmp, HERE } from "./helper.mjs";
import { sampleHouse, storeyPlan, falseColourHeight, storeyCutaways, eyeShots, darkMap, storeysOf } from "../levels/assembly/views.mjs"; // prettier-ignore

const folder = join(tmp, "views");
mkdirSync(folder, { recursive: true });
const CLI = join(HERE, "../levels/tools/views.mjs");
const FIXTURE = join(HERE, "fixtures", "tworooms.bsp");
/** The size a PNG says it is, from its header. */
const pngSize = (file) => {
  const bytes = readFileSync(file);
  sure(bytes.subarray(1, 4).toString("latin1") === "PNG", `${file} is not a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
/** The command's last line (it exits 1 on FAIL: its output is still read). */
const lastLine = (args) => {
  let out;
  try {
    out = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  } catch (e) {
    out = e.stdout ?? "";
  }
  return out.trim().split("\n").at(-1);
};

const good = sampleHouse();
const broken = sampleHouse({ liftStair: 32, liftDoor: 48, darkRoom: "kitchen" });

test("views: the plan puts each room's name in its own cell, and crosses a door raised 48 with its sill", () => {
  const plan = storeyPlan(good.map, { layout: good.layout, storey: 0, out: folder });
  const [w, h] = pngSize(plan.facts.file);
  sure(w === plan.width && h === plan.height && w > 400 && h > 300, `a plan of ${w} x ${h}`);
  sure(plan.facts.rooms.map((r) => r.id).join() === "hall,kitchen", JSON.stringify(plan.facts.rooms));
  for (const room of plan.facts.rooms) {
    const [i, j] = room.cell;
    sure(good.layout.storeyPlans[0].cells[j][i] === room.id, `${room.id}'s label is in cell ${i},${j}, which is ${good.layout.storeyPlans[0].cells[j][i]}`); // prettier-ignore
    // the cell's pixels on the plan, from its facts: the label's middle inside them, and white letters there
    const { x0, y0, scale } = plan.facts;
    const left = (i * 64 - x0) * scale;
    const top = (y0 - (j + 1) * 64) * scale;
    const [x, y] = room.at;
    sure(x > left && x < left + 64 * scale && y > top && y < top + 64 * scale, `${room.id} at pixel ${x},${y}, its cell from ${left},${top}`); // prettier-ignore
    let white = 0;
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -30; dx <= 30; dx++) {
        const at = ((y + dy) * plan.width + x + dx) * 4;
        if (plan.rgba[at] === 255 && plan.rgba[at + 1] === 255 && plan.rgba[at + 2] === 255) white++;
      }
    sure(white > 20, `${room.id}: ${white} pixels of its white letters about ${x},${y}`);
  }
  sure(!plan.facts.mismatches.length, plan.facts.mismatches.join(" | "));
  const raised = storeyPlan(broken.map, { layout: broken.layout, storey: 0 });
  sure(raised.facts.mismatches.length === 1 && /edge 4,2-4,3 \(door, storey 0\): the doorway is open from 48 to 160 over the floor/.test(raised.facts.mismatches[0]), raised.facts.mismatches.join(" | ")); // prettier-ignore
  const upper = storeyPlan(broken.map, { layout: broken.layout, storey: 1 });
  sure(!upper.facts.mismatches.length && upper.facts.rooms.map((r) => r.id).join() === "landing,bed", `${upper.facts.mismatches.join(" | ")} ${JSON.stringify(upper.facts.rooms)}`); // prettier-ignore
});

test("views: the floor's height rises up the stair, and a stair lifted 32 has a ledge at its foot", () => {
  const heights = falseColourHeight(good.map, { layout: good.layout, storey: 0, out: folder });
  const [w, h] = pngSize(heights.facts.file);
  sure(w === heights.width && h === heights.height, `${w} x ${h}`);
  const at = (facts, i, j) => facts.cells.find((c) => c.cell[0] === i && c.cell[1] === j)?.z;
  // flight 1 up +y on column 0: 32 at row 1, 80 at row 2, the landing 96 at row 3; the hall's floor 0
  sure(at(heights.facts, 0, 1) === 32 && at(heights.facts, 0, 2) === 80 && at(heights.facts, 0, 3) === 96 && at(heights.facts, 3, 3) === 0, heights.facts.text); // prettier-ignore
  sure(/storey 0: the floor at each cell's middle/.test(heights.facts.text), heights.facts.text);
  const foot = (facts) => facts.ledges.filter((l) => l.at[1] === 48 && l.at[0] >= 8 && l.at[0] < 64);
  sure(!foot(heights.facts).length, `the good stair's foot has ledges: ${JSON.stringify(foot(heights.facts))}`);
  const lifted = falseColourHeight(broken.map, { layout: broken.layout, storey: 0 });
  sure(foot(lifted.facts).length && foot(lifted.facts).every((l) => l.from === 0 && l.to === 48), `the lifted stair's foot: ${JSON.stringify(foot(lifted.facts))}`); // prettier-ignore
  sure(at(lifted.facts, 0, 1) === 64, lifted.facts.text);
});

test("views: the cutaways are one picture a storey, three corners wide; storeys from the layout or counted", () => {
  const list = storeyCutaways(good.map, { layout: good.layout, out: folder, width: 240, height: 200 });
  sure(list.length === 2, `${list.length} cutaways`);
  list.forEach((picture, k) => {
    const [w, h] = pngSize(picture.facts.file);
    sure(w === 720 && h === 200 && picture.facts.storey === k && picture.facts.faces > 20, `${w} x ${h}, ${JSON.stringify(picture.facts.storey)} ${picture.facts.faces}`); // prettier-ignore
    sure(!picture.facts.lit && picture.facts.cut === (k + 1) * 192 - 18, JSON.stringify(picture.facts));
  });
  const counted = storeysOf(good.map, { storeys: 2, base: 0 });
  sure(counted.map((s) => s.floor).join() === "0,192", JSON.stringify(counted));
});

test("views: the eye shots stand at each door's sides, the stair's foot, side and top, and each room", () => {
  const shots = eyeShots(good.map, good.layout, { out: folder, width: 160, height: 120 });
  const names = shots.map((s) => s.facts.name);
  const wanted = ["s0-door-hall-kitchen-from-hall", "s0-door-hall-kitchen-from-kitchen", "s1-door-landing-bed-from-landing", "s1-door-landing-bed-from-bed", "s0-stair-foot-looking-up", "s0-stair-side-from-hall", "s1-stair-top-looking-down", "s0-room-hall", "s0-room-kitchen", "s1-room-landing", "s1-room-bed"]; // prettier-ignore
  sure(wanted.every((n) => names.includes(n)) && names.length === wanted.length, names.join(", "));
  for (const shot of shots) {
    const [w, h] = pngSize(shot.facts.file);
    sure(w === 160 && h === 120 && shot.facts.question.endsWith("?") && !shot.facts.inSolid, `${shot.facts.name}: ${w} x ${h}, in solid ${shot.facts.inSolid}`); // prettier-ignore
  }
  const door = shots.find((s) => s.facts.name === "s0-door-hall-kitchen-from-hall");
  sure(door.facts.from[2] === 64 && door.facts.from[0] < 256, JSON.stringify(door.facts.from)); // at eye height, on the hall's side
  const index = JSON.parse(readFileSync(join(folder, "eye-shots.json"), "utf8"));
  sure(index.length === shots.length && index[0].file.startsWith("eye-"), JSON.stringify(index[0]));
});

test("views: every view of the kit's compiled two rooms, at its size; the light map from its lightmaps", () => {
  const bsp = maps.readBsp(readFileSync(FIXTURE));
  const out = join(folder, "tworooms");
  const [cutaway] = storeyCutaways(bsp, { out, width: 200, height: 160 });
  sure(cutaway.facts.lit && pngSize(cutaway.facts.file).join() === "600,160", JSON.stringify(cutaway.facts));
  const heights = falseColourHeight(bsp, { out });
  sure(heights.facts.cells.some((c) => c.z === 0) && heights.facts.cells.some((c) => c.solid), heights.facts.text);
  const light = darkMap(bsp, { out });
  sure(light.facts.lit && light.facts.mean > 0 && pngSize(light.facts.file).join() === `${light.width},${light.height}`, JSON.stringify(light.facts)); // prettier-ignore
  const plan = storeyPlan(bsp, { out });
  sure(pngSize(plan.facts.file).join() === `${plan.width},${plan.height}` && plan.facts.z === 36, JSON.stringify(plan.facts.z));
  const line = lastLine([FIXTURE, "--out", join(folder, "tworooms-cli")]);
  sure(line === `PASS: 5 views written in ${join(folder, "tworooms-cli")}`, line);
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found)
  console.log(`skip  the views of the house compiled\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run them)`); // prettier-ignore
else {
  const names = { floor: "VFLOOR", wall: "VWALL", ceiling: "VCEIL", stair: "VSTAIR", door: "VDOOR", rail: "VRAIL" };
  const wad = join(folder, "views.wad");
  const plain = (grey) => ({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(grey) });
  writeFileSync(wad, maps.writeWad(Object.values(names).map((name, k) => ({ name, image: plain(100 + k * 20) }))));
  const built = {};
  for (const [variant, options] of Object.entries({ good: {}, broken: { liftStair: 32, liftDoor: 48, darkRoom: "kitchen" } })) {
    const { map, layout } = sampleHouse({ ...options, textures: names, wad: [wad] });
    const file = join(folder, `house-${variant}.map`);
    writeFileSync(file, maps.writeMap(map));
    writeFileSync(join(folder, `house-${variant}.json`), JSON.stringify(layout));
    const made = maps.compileMap(file, { fast: true, compilers, wads: [wad] });
    built[variant] = made.bsp ? { bsp: maps.readBsp(readFileSync(made.bsp)), file: made.bsp, layout } : made.errors.join("; ");
  }
  const of = (variant) => {
    sure(typeof built[variant] !== "string", `the ${variant} house did not compile: ${built[variant]}`);
    return built[variant];
  };

  test("views: the house compiled: the room left unlit is dark on the light map, the others not", () => {
    const g = of("good");
    const b = of("broken");
    const lit = darkMap(g.bsp, { layout: g.layout, storey: 0 });
    sure(lit.facts.rooms.length === 2 && lit.facts.rooms.every((r) => !r.dark), JSON.stringify(lit.facts.rooms));
    const dark = darkMap(b.bsp, { layout: b.layout, storey: 0 });
    sure(dark.facts.rooms.find((r) => r.name === "kitchen")?.dark && !dark.facts.rooms.find((r) => r.name === "hall")?.dark, JSON.stringify(dark.facts.rooms)); // prettier-ignore
    const shots = eyeShots(b.bsp, b.layout, { width: 160, height: 120 });
    sure(shots.length === 11 && shots.every((s) => !s.facts.inSolid), shots.map((s) => s.facts.name).join());
  });

  test("views: the command passes the good house and fails the broken one, naming the door and the dark room", () => {
    const g = of("good");
    const b = of("broken");
    const goodOut = join(folder, "good-views");
    const line = lastLine([g.file, "--layout", join(folder, "house-good.json"), "--out", goodOut]);
    sure(line === `PASS: 21 views written in ${goodOut}`, line);
    const bad = lastLine([b.file, "--layout", join(folder, "house-broken.json"), "--out", join(folder, "broken-views")]);
    sure(/^FAIL: 21 views written in .*1 edges of the layout are not as built.*1 rooms have a dark floor.*kitchen \(storey 0\)/.test(bad), bad); // prettier-ignore
  });
}
