// levels/assembly/below.mjs on byzantium-01 (2026-11-06, after the person's walk of its sewer): the level below as the
// spec's own rules ask it (low tunnels, high halls, no long straight run, loops, a way down in every district and by every
// Hollow tower, ladders that step off onto public floor), and the den's way out: the flat that hides the den is the
// hideout's property, open to everybody (a player up the den's trapdoor and out by its secret door was shut in a home).
import { test, sure } from "./helper.mjs";
import { readSite, siteSpec, buildingOf, programOf, propertiesOf, doorNameOf } from "../levels/assembly/site.mjs";
import { planBelow, checkBelow, vaultOf, BELOW_RULES } from "../levels/assembly/below.mjs";
import { layoutOf } from "../levels/assembly/layout.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";

// The site's cells and districts as planSite lays them, without its buildings' layouts (they take minutes: the level below
// needs the layouts only to check a trapdoor's room, which test/107 and test/158 hold), and the level planned on them.
const { site } = readSite(siteSpec("byzantium-01"));
const [W, H] = site.size;
const cells = Array.from({ length: H }, () => new Array(W).fill("paving"));
const fill = (x0, y0, x1, y1, label) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cells[y][x] = label;
};
for (const a of site.areas) fill(...a.from, ...a.to, a.kind);
for (const a of site.areas) if (a.landmark) fill(a.landmark[0], a.landmark[1], a.landmark[0] + 3, a.landmark[1] + 3, "landmark");
for (const p of site.porticoes ?? []) fill(p.cells[0], p.rows[0], p.cells[1], p.rows[1], "portico");
for (const b of site.buildings) fill(b.at[0], b.at[1], b.at[0] + b.size[0], b.at[1] + b.size[1], `building ${b.id}`);
const districts = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => site.districts.find((d) => x >= d.from[0] && x < d.to[0] && y >= d.from[1] && y < d.to[1])?.id ?? null)); // prettier-ignore
const below = planBelow(site, cells, new Map());
const plan = { site, cells, districts, layouts: new Map(), below, failures: below.failures, warnings: below.warnings };

test("byzantium-01 below: planned with no failure, every rule of its own kept", () => {
  sure(plan.failures.length === 0, `plan failures: ${plan.failures.join(" | ")}`);
  const r = checkBelow(plan);
  sure(r.failures.length === 0, `checkBelow: ${r.failures.join(" | ")}`);
  const m = r.measures;
  sure(m.ways >= 10 && m.ways <= 12, `${m.ways} ways down`);
  sure(m.loops >= 3, `${m.loops} loops`);
  sure(m.run <= 12 && m.longest <= 12, `a straight run of ${m.run}, the longest tunnel ${m.longest}`);
  sure(m.vaults.length >= 5 && m.vaults[0] <= 144 && m.vaults.at(-1) >= 288, `ceilings ${m.vaults}`);
  sure(m.reached === m.cells, `${m.reached} of ${m.cells} cells reached from a way down`);
  // the kit's own rules would have found the old sewer wanting: the same plan under the tightest of them says so
  sure(checkBelow(plan, { ...BELOW_RULES, longest: 11 }).failures.some((f) => /wants 11 at the most|wants 12 at the most/.test(f)) === false, "the spec's own rules override the kit's"); // prettier-ignore
});

test("byzantium-01 below: tunnels are low, halls and the cistern are the high places", () => {
  for (const p of plan.below.parts) {
    if (p.kind === "tunnel") sure(vaultOf(p) >= 128 && vaultOf(p) <= 192, `${p.id} is ${vaultOf(p)} high`);
    if (p.kind === "hall") sure(vaultOf(p) >= 160, `${p.id} is only ${vaultOf(p)} high`);
  }
  sure(vaultOf(below.parts.find((p) => p.id === "cistern")) === 288, "the cistern is not the tallest room");
});

test("byzantium-01 below: a way down in every district and one at each Hollow tower, each ladder onto public floor", () => {
  const districts = new Set(below.ways.map((w) => plan.districts[w.at[1]][w.at[0]]));
  for (const d of ["nexus", "mese", "market", "hollow"]) sure(districts.has(d), `no way down in ${d}`);
  for (const id of ["t1", "t2", "t3", "t4"]) {
    const b = plan.site.buildings.find((q) => q.id === id);
    const near = below.ways.filter((w) => {
      const dx = Math.max(b.at[0] - w.at[0], 0, w.at[0] - (b.at[0] + b.size[0] - 1));
      const dy = Math.max(b.at[1] - w.at[1], 0, w.at[1] - (b.at[1] + b.size[1] - 1));
      return Math.max(dx, dy) <= 3;
    });
    sure(near.length >= 1, `no way down within 3 cells of ${id}`);
  }
  const public_ = new Set(["street", "plaza", "square", "alley", "paving", "portico"]);
  for (const w of below.ways.filter((q) => q.kind === "manhole" || q.kind === "drain")) {
    const s = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] }[w.wall];
    sure(public_.has(plan.cells[w.at[1]][w.at[0]]) && public_.has(plan.cells[w.at[1] + s[1]][w.at[0] + s[0]]), `${w.name}: its shaft or its step-off is not public floor`); // prettier-ignore
  }
});

test("byzantium-01 below: the den's front flat is the hideout's property, so nobody is shut in it", () => {
  const t4 = plan.site.buildings.find((b) => b.id === "t4");
  const style = loadStyle(plan.site.style);
  const program = programOf(plan.site, t4, style);
  const layout = layoutOf(buildingOf(plan.site, { ...t4, seed: t4.seed ?? 1, seeds: undefined }, style));
  const props = propertiesOf(layout, style, program.oneProperty);
  const name = doorNameOf(plan.site, t4, props, program, (r) => style.kinds[layout.rooms.find((q) => q.id === r)?.kind]?.zone === "circulation");
  const front = layout.doors.filter((d) => d.rooms.includes(program.secret[0]));
  sure(front.length >= 1, "the front flat has no door");
  for (const d of front) sure(name(d) === `${plan.site.name}_t4_hideout`, `a door of the front flat is ${name(d)}`);
  const secret = layout.doors.find((d) => d.rooms.includes("den"));
  sure(name(secret) === `${plan.site.name}_t4_hideout`, "the secret door is not the hideout's");
  // another flat of the same building is still a home of its own
  const other = layout.doors.find((d) => d.rooms.some((r) => /^room[2-5]$/.test(r)));
  sure(other && name(other) !== `${plan.site.name}_t4_hideout`, "every flat of t4 became the hideout's");
});
