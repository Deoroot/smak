// The Mese's porticoes given their columns (2026-11-02): stage 1 lays a way's colonnade as it lays a square's, a
// column line each side on the portico's inner line (set back by the kerb, so the shaft stands clear of the
// carriageway), a column every rulebook pitch, the runs cut at the seams (clear of the portal's mouth) and short of
// a plaza, none in a side way's mouth; stage 4 leaves out a column standing in front of a door under the portico;
// the description's estimate counts the columns and the vault where they stand; the review's plan draws them and
// the section shows the portico. Each gate fails a copy broken in one way, by its sentence.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, testAsync, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator, regate } from "../levels/gen/runner.mjs";
import { wayPorticoCost, porticoCost, tileEstimateOf } from "../levels/lib/city-checks.mjs";
import { measureCity } from "../levels/lib/city-description.mjs";
import { KERB, PORTAL_DEPTH } from "../levels/gen/dressing.mjs";
import { readArtifacts, reviewPictures } from "../levels/lib/review-picture.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const TEXT = readFileSync(SPEC, "utf8");
const fresh = () => JSON.parse(TEXT);
const copy = (v) => JSON.parse(JSON.stringify(v));
const OUT = join(tmp, "gen-mese");
const MESE = ["s3_ministry", "s3_north"];
let site = null;
let net = null;

await testAsync("mese: stage 1 lays the Mese's column lines in the Core, stage 4 keeps them clear of the barracks' door", "gen mese", async () => {
  const res = await runGenerator({ desc: fresh(), out: OUT, tile: "c1_r1", until: 4 });
  sure(res.ok, `stopped: ${res.refused ?? JSON.stringify(res.stopped)}`);
  site = JSON.parse(readFileSync(join(OUT, "01-site.json"), "utf8"));
  net = JSON.parse(readFileSync(join(OUT, "04-network.json"), "utf8"));
  const cell = site.grid.cell;
  for (const id of MESE) {
    const w = site.ways.find((x) => x.id === id);
    const C = w.colonnade;
    sure(C && C.columns.length > 10, `${id}: ${JSON.stringify(C && C.columns.length)}`);
    // on the inner line, set back by the kerb and half a shaft; a column every cell at most; the square's vault
    sure(Math.abs(C.offset - (w.carriageway / 2 + KERB / cell + C.column / 2)) < 0.002 && C.pitch <= 1 && C.height === 2.25, JSON.stringify(C)); // prettier-ignore
    for (const c of C.columns) {
      sure(Math.abs(Math.abs(c.at[0] - 60) - C.offset) < 0.002, `${id}'s column off its line: ${c.at}`);
      sure(c.at[1] > 40 && c.at[1] < 80, `${id}'s column outside the tile: ${c.at}`);
      // clear of the portal's mouth at the seam
      sure(Math.min(c.at[1] - 40, 80 - c.at[1]) >= PORTAL_DEPTH / cell + C.column / 2, `${id}'s column in the portal's mouth: ${c.at}`);
    }
    for (const side of ["w", "e"]) {
      const ys = C.columns.filter((c) => c.side === side).map((c) => c.at[1]).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) sure(ys[i] - ys[i - 1] <= C.pitch + 1e-3, `${id} ${side}: a bay of ${ys[i] - ys[i - 1]}`);
    }
  }
  // the barracks' door on the Mese: its column left out, the bay wider there
  const col = net.colonnades.find((c) => c.way === "s3_ministry");
  sure(col && col.ref === "s3_ministry" && col.dropped.length === 1 && /msr_barracks's door/.test(col.dropped[0].why), JSON.stringify(col?.dropped)); // prettier-ignore
  sure(net.colonnades.find((c) => c.way === "s3_north")?.columns.length === site.ways.find((w) => w.id === "s3_north").colonnade.columns.length, "s3_north lost a column"); // prettier-ignore
  // the forum's colonnade as before, its record named as a way's is (ref)
  const forum = net.colonnades.find((c) => c.plaza === "n3_nexus");
  sure(forum.ref === "n3_nexus" && forum.way === null && forum.columns.length + forum.dropped.length === 64, JSON.stringify([forum.ref, forum.columns.length]));
});

test("mese: the estimate counts the porticoes' columns and vaults where they stand, as stage 1 lays them", () => {
  sure(site, "no stage 1 run");
  const d = fresh();
  const m = measureCity(d);
  let core = 0;
  for (const id of MESE) {
    const c = wayPorticoCost(m.segments.get(id), m);
    const here = c.byTile.filter((p) => p.tile === "c1_r1");
    const cols = here.reduce((t, p) => t + p.columns, 0);
    sure(cols === site.ways.find((w) => w.id === id).colonnade.columns.length, `${id}: the estimate's ${cols} columns, stage 1's ${site.ways.find((w) => w.id === id).colonnade.columns.length}`); // prettier-ignore
    core += here.reduce((t, p) => t + p.brushes, 0);
    // the rest of the way in the next tile (each seam a run of its own)
    sure(c.byTile.some((p) => p.tile !== "c1_r1" && p.columns > 0), `${id}: ${JSON.stringify(c.byTile)}`);
  }
  // the Core: 34 columns and 4 vault slabs
  sure(core === 38 && tileEstimateOf(d, "c1_r1").porticoes === core, `${core} ${JSON.stringify(tileEstimateOf(d, "c1_r1"))}`);
  // a way with no portico costs nothing; the Mese inside the forum is cut to nothing; a square's cost unchanged
  sure(wayPorticoCost(m.segments.get("s3_forum_n"), m).columns === 0, "the Mese inside the forum");
  const plain = [...m.segments.values()].find((s) => !(s.portico > 0) && s.class !== "service");
  sure(wayPorticoCost(plain, m).brushes === 0, plain.id);
  sure(porticoCost(m.nodes.get("n3_nexus"), m).columns === 63, "the forum's cost");
  // without the porticoes the Core is 38 brushes lighter
  const without = fresh();
  for (const s of without.streets.segments) if (MESE.includes(s.id)) delete s.portico;
  const [a, b] = [tileEstimateOf(d, "c1_r1"), tileEstimateOf(without, "c1_r1")];
  sure(a.brushes - b.brushes === 38 && b.porticoes === 0, `${a.brushes} - ${b.brushes}`);
});

await testAsync("mese: stage 1's and stage 4's gates fail a column in the carriageway, a missing column, a column in a mouth, a column before a door", "gen mese gates", async () => {
  sure(site && net, "no run");
  const inputs = Object.fromEntries(["00-description.json", "01-site.json", "02-lots.json"].map((f) => [f, JSON.parse(readFileSync(join(OUT, f), "utf8"))])); // prettier-ignore
  const says = async (stage, base, what, change, ...words) => {
    const a = copy(base);
    change(a);
    const v = await regate(stage, a, { inputs });
    sure(v.failures.some((f) => words.every((w) => f.includes(w))), `${what}: ${v.failures.slice(0, 3).join(" | ") || "PASS"}`);
  };
  const v0 = await regate("site", site, { inputs });
  sure(!v0.failures.some((f) => f.startsWith("colonnade")), v0.failures.join(" | "));
  const mese = (a) => a.ways.find((w) => w.id === "s3_ministry").colonnade;
  await says("site", site, "a column in the carriageway", (a) => (mese(a).columns[3].at[0] = 61), "colonnade: s3_ministry's column at [61,", "in its carriageway or kerb"); // prettier-ignore
  await says("site", site, "a column past the portico", (a) => (mese(a).columns[3].at[0] = 63.95), "colonnade: s3_ministry's column at [63.95,", "past its portico"); // prettier-ignore
  await says("site", site, "a column taken out", (a) => mese(a).columns.splice(3, 1), "colonnade: s3_ministry's columns at", "cells apart on its e side, at most 1"); // prettier-ignore
  await says("site", site, "a column in a side way's mouth", (a) => a.ways.find((w) => w.id === "s3_north").colonnade.columns.push({ at: [57.754, 83], side: "w" }), "colonnade: s3_north's column at [57.754,83] stands in", "'s mouth at n3_north"); // prettier-ignore
  const col = (a) => a.colonnades.find((c) => c.way === "s3_ministry");
  await says("network", net, "a column before the barracks' door", (a) => col(a).columns.push(col(a).dropped[0]), "colonnade: s3_ministry's column at", "msr_barracks's door"); // prettier-ignore
});

test("mese: the review's plan draws the Mese's columns as the forum's, its section the colonnade beyond", () => {
  sure(net, "no run");
  const r = reviewPictures(readArtifacts(OUT));
  const plan = r.pictures.find((p) => p.file === "plan-c1_r1-L3.svg").svg;
  const kept = net.colonnades.reduce((t, c) => t + c.columns.length, 0);
  const squares = (plan.match(/<rect[^>]*fill="#6b5a3a"/g) ?? []).length;
  sure(squares >= kept, `${squares} column marks for ${kept} columns`);
  // the left-out column a hollow ring
  sure((plan.match(/<circle[^>]*fill="none" stroke="#6b5a3a"/g) ?? []).length >= net.colonnades.reduce((t, c) => t + c.dropped.length, 0), "the left-out columns");
  const ns = r.pictures.find((p) => p.file === "section-c1_r1-ns.svg").svg;
  sure(/s3_(ministry|north)'s colonnade (beyond|cut), vault at 2\.25/.test(ns), "the section shows no Mese portico");
});
