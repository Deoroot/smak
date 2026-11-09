// levels/assembly/massing.mjs: the form of a site's shells (rule 9 of AGENTS.md): a corbelled cornice, a hipped roof, a round
// corner tower and a battered foot as convex brushes of whole-number corners that stand where they are meant to and are off the axes,
// and `fitBands`, which puts the picture of a band on its brush's edge. The site's own use of them is held through the build
// of byzantium-02-spine (`map-dressing`: off the axes 7.8% against 2%), which takes minutes and is run by hand.
import { test, sure } from "./helper.mjs";
import { corniceBrushes, hipRoof, cornerTower, talusBrushes, fitBands, CORNICE, TALUS, TOWER } from "../levels/assembly/massing.mjs";
import { shapeOf, box } from "../src/maps/source.mjs";

const b = { at: [2, 3], size: [8, 6] };
const whole = (brush) => brush.faces.every((f) => f.points.every((p) => p.every(Number.isInteger)));
const offAxes = (brush) => {
  const s = shapeOf(brush);
  return s.faces.filter((f) => Math.max(...f.normal.map(Math.abs)) < 0.999).reduce((t, f) => t + f.area, 0);
};
const sound = (brush, what) => {
  const s = shapeOf(brush);
  sure(s.volume > 0 && s.volume !== Infinity, `${what}: not a solid`);
  sure(whole(brush), `${what}: a corner off the whole numbers`);
  sure(s.faces.length >= 4, `${what}: ${s.faces.length} faces`);
};

test("massing: a cornice runs along each street front it is given, off the axes, standing over the roof's edge", () => {
  const open = { south: new Set([0, 1, 2]), north: new Set(), west: new Set([0]), east: new Set([4, 5]) };
  const got = corniceBrushes(b, open, [384], { sides: "muro7" });
  sure(got.length === 3 * CORNICE.length, `${got.length} brushes for 3 runs (south 0..2, west 0, east 4..5) of ${CORNICE.length} steps each`);
  for (const c of got) {
    sound(c, "cornice");
    sure(offAxes(c) > 0, "a cornice with a face off the axes");
    const { min, max } = shapeOf(c);
    sure(max[2] === 384 && min[2] === 384 + Math.min(...CORNICE.flat().map((p) => p[1])) || min[2] > 384 + Math.min(...CORNICE.flat().map((p) => p[1])), `a cornice from ${min[2]} to ${max[2]}`);
  }
  const south = shapeOf(got[0]);
  sure(south.min[1] < b.at[1] * 64 && south.min[0] === b.at[0] * 64 && south.max[0] === (b.at[0] + 3) * 64, "the south cornice lies out of the south front, along its three cells");
  sure(corniceBrushes(b, open, [192, 384], { sides: "muro7" }).length === 2 * got.length, "a string course at each height asked for");
});

test("massing: a hipped roof rises inside the parapet to a ridge, and is left off a roof too small to rise", () => {
  const roof = hipRoof(b, 384, { sides: "sintilesplain" });
  sound(roof, "hipped roof");
  const { min, max } = shapeOf(roof);
  sure(min[2] === 384 && max[2] > 384 + 80, `a roof from ${min[2]} to ${max[2]}`);
  sure(min[0] > b.at[0] * 64 && max[0] < (b.at[0] + 8) * 64, "inside the parapets");
  const footprint = (8 * 64 - 24) * (6 * 64 - 24);
  sure(Math.abs(offAxes(roof) - footprint / Math.cos(Math.atan(1))) > 0 && offAxes(roof) > 1.2 * footprint, `the slopes are over the footprint's area: ${offAxes(roof)} against ${footprint}`);
  sure(hipRoof({ at: [0, 0], size: [2, 6] }, 384, { sides: "x" }) === null, "a roof two cells across is flat");
});

test("massing: a corner tower is eight faces turned off every wall, on its corner", () => {
  const t = cornerTower(128, 192, -16, 384, "sinbrickwall");
  sound(t, "tower");
  const s = shapeOf(t);
  sure(s.faces.length === TOWER.sides + 2, `${s.faces.length} faces`);
  const upright = s.faces.filter((f) => Math.abs(f.normal[2]) < 0.5);
  sure(upright.length === TOWER.sides && upright.every((f) => Math.max(...f.normal.map(Math.abs)) < 0.999), "each upright face off the axes");
  sure(Math.abs((s.min[0] + s.max[0]) / 2 - 128) <= 1 && Math.abs((s.min[1] + s.max[1]) / 2 - 192) <= 1, "centred on the corner");
});

test("massing: a battered foot leans out of the wall over the cells given", () => {
  const got = talusBrushes(b, { south: new Set([1, 2]), north: new Set(), west: new Set(), east: new Set() }, 0, "sinbrickwall");
  sure(got.length === 1, `${got.length} feet`);
  sound(got[0], "foot");
  const s = shapeOf(got[0]);
  sure(s.min[1] === b.at[1] * 64 - Math.max(...TALUS.map((p) => p[0])) && s.max[2] === Math.max(...TALUS.map((p) => p[1])), "out of the south front, to its height");
  sure(offAxes(got[0]) > 0, "a leaning face");
});

test("massing: fitBands puts a band's picture on its brush, and leaves a tall wall on the grid", () => {
  const band = box([0, 0, 80], [64, 16, 96], "muro7");
  const wall = box([0, 0, 0], [64, 16, 192], "sinbrickwall");
  const before = JSON.stringify([band, wall]);
  const n = fitBands([band, wall]);
  sure(n === 4, `${n} faces fitted: the four upright faces of the band`);
  for (const f of band.faces.filter((q) => Math.abs(q.points[0][2] - q.points[1][2]) < 1e-9 || q.points.some((p) => p[2] !== q.points[0][2]))) {
    if (Math.abs(f.v[2]) < 0.999) continue;
    // the picture's top (v = 0) on the face's top (z 96)
    sure(Math.abs(f.v[2] * 96 + f.v[3]) < 1e-9, `the band's picture starts at its top: ${f.v}`);
  }
  sure(JSON.stringify(wall) === JSON.stringify(JSON.parse(before)[1]), "a tall wall is left as it was");
  sure(fitBands([band, wall]) === n, "fitting twice is fitting once");
});
