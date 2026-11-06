// levels/assembly, the dressing (dress.mjs, levels/assembly/dress/h9-byzantium.json): the Mese's site dressed for the
// H9 client: accent glows on its roofs and its ends, ambient sounds by district, props in its rooms and along its
// street. Every prop named by the dress file, turned by a quarter, standing on its floor; every solid one with its
// CLIP brush, none over a cell beside a doorway; the sounds' files the dress names; the same dressing twice. The
// placement's other guarantee (a room's free cells kept in one piece for a standing player) is measured on the
// compiled map, not here; mese-01 names no districts, so of the sounds only the city's murmur is laid (README, "The dressing"). The broken case is in test/broken/levels.mjs.
import { join } from "node:path";
import { test, sure, sureEach, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { dressSite, loadDress, outsideOf } from "../levels/assembly/dress.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";

const plan = planSite(siteSpec("mese-01"));
const style = loadStyle("mese");
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const built = assembleSite(plan, library, { style });
const dress = loadDress("h9-byzantium");
const dressed = dressSite(plan, built, dress);
const of = (k) => dressed.entities.filter((e) => e.classname === k);

test("assembly dress: the Mese's site dressed with glows, sounds and props, with no failure", () => {
  sure(!dressed.report.failures.length, `dressed: ${dressed.report.failures.join(" | ")}`);
  const c = dressed.report.counts;
  sure(c.prop >= 20 && c.glow >= 10 && c.sound >= 1, `counts: ${JSON.stringify(c)}`);
  // the rule of the rooms' doorways (laneProblems, in the failures above): checked for every doorway of a dressed room
  sure(c["lane-checks"] >= 10, `lanes checked: ${c["lane-checks"]}`);
  sure(of("env_glow").every((e) => /^sprites\/.+\.spr$/.test(e.model) && [3, 5].includes(Number(e.rendermode))), "every glow a sprite in glow or additive mode");
  const files = new Set(dress.sounds.map((s) => s.file));
  sure(of("ambient_generic").every((e) => files.has(e.message) && !(Number(e.spawnflags) & 32)), "every sound a looped file of the dress");
});

test("assembly dress: every prop the dress's, turned by a quarter, on its floor; every solid one clipped, none by a doorway", () => {
  const byFile = new Map(Object.values(dress.models).map((m) => [m.file, m]));
  const props = of("ts_model");
  sureEach(props, "the props", (e) => {
    const m = byFile.get(e.model);
    sure(m, `a prop of a model the dress does not have: ${e.model}`);
    const [, yaw] = String(e.angles).split(" ").map(Number);
    sure(yaw % 90 === 0, `${e.model} turned ${yaw}`);
    const z = Number(String(e.origin).split(" ")[2]);
    if (m.place !== "hung" && m.place !== "ceiling") sure([0, 192].some((f) => Math.abs(z + m.min[2] - f) < 1), `${e.model} at z ${z} does not stand on a floor`); // prettier-ignore
  });
  const clips = dressed.brushes.filter((b) => b.faces.every((f) => f.texture === "CLIP"));
  sure(clips.length === dressed.report.counts["prop-clip"] && clips.length > 0, `clips ${clips.length}`);
  // no CLIP over a cell beside a doorway, on either side of it, on its storey (the cells of its 64 round its middle)
  const doorways = built.report.doorways.filter((q) => q.building);
  const beside = [];
  for (const d of doorways) {
    const z = (d.storey ?? 0) * 192;
    for (const [x, y] of [...outsideOf(d), ...outsideOf({ ...d, into: d.into.map((v) => -v) })]) beside.push([x * 64, y * 64, z]);
  }
  sure(doorways.length > 0 && beside.length === 4 * doorways.length, `the doorways' cells: ${beside.length} of ${doorways.length} doorways`);
  sureEach(clips, "the props' CLIP brushes", (brush) => {
    // a box's faces: each plane holds one axis at one value, its three points sharing it
    const planes = [[], [], []];
    for (const face of brush.faces) for (let i = 0; i < 3; i++) if (face.points.every((p) => p[i] === face.points[0][i])) planes[i].push(face.points[0][i]);
    sure(planes.every((p) => p.length === 2), "a CLIP that is not a box");
    const lo = planes.map((p) => Math.min(...p));
    const hi = planes.map((p) => Math.max(...p));
    for (const [x, y, z] of beside)
      sure(!(lo[0] < x + 64 && hi[0] > x && lo[1] < y + 64 && hi[1] > y && Math.abs(lo[2] - z) < 2), `a CLIP over a cell beside a doorway at ${x / 64},${y / 64}`); // prettier-ignore
  });
  // nor any prop standing on the floor, solid or not (a bench, a plant before a door: seen in H9, 2026-11-03)
  sureEach(props, "the props", (e) => {
    const m = byFile.get(e.model);
    if (m.place === "hung" || m.place === "ceiling") return;
    const [ox, oy, oz] = String(e.origin).split(" ").map(Number);
    const a = (Number(String(e.angles).split(" ")[1]) * Math.PI) / 180;
    const [c, s] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
    const xs = [];
    const ys = [];
    for (const x of [m.min[0], m.max[0]]) for (const y of [m.min[1], m.max[1]]) xs.push(ox + x * c - y * s), ys.push(oy + x * s + y * c);
    const floor = oz + m.min[2] > 150 ? 192 : 0;
    sureEach(beside, "the cells beside a doorway", ([x, y, z]) =>
      sure(!(z === floor && Math.min(...xs) < x + 63 && Math.max(...xs) > x + 1 && Math.min(...ys) < y + 63 && Math.max(...ys) > y + 1), `${e.model} over a cell beside a doorway at ${x / 64},${y / 64}`)); // prettier-ignore
  });
});

test("assembly dress: the same site dressed twice is dressed the same", () => {
  const again = dressSite(plan, built, dress);
  sure(JSON.stringify(again.entities) === JSON.stringify(dressed.entities) && JSON.stringify(again.brushes) === JSON.stringify(dressed.brushes), "two dressings differ"); // prettier-ignore
});
