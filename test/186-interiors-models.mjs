// The interiors' models (levels/art/h9-interiors.mjs: shelves with goods, display tables, crates, sacks, barrel, beds, wardrobe, sideboard,
// stove, chair, pedestal table, rugs): each committed file is a model the kit passes for GoldSrc and does not warn of for form, and the
// dress file (levels/assembly/dress/h9-byzantium.json) holds each one's box as the generator measured it, with a place; the rooms and
// the counters name only models the dress has; the generator is deterministic; a flat's furniture set is its own dice's.
import { join } from "node:path";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, HERE, tmp } from "./helper.mjs";
import * as smak from "../src/index.mjs";
import { loadDress } from "../levels/assembly/dress.mjs";

const MODELS = join(HERE, "../levels/art/h9/models");
const manifest = JSON.parse(readFileSync(join(MODELS, "interiors.json"), "utf8"));
const dress = loadDress("h9-byzantium");

test("interiors: every model the generator wrote is a file that passes check for goldsrc, with no form warning", () => {
  const names = Object.keys(manifest);
  sure(names.length >= 25, `${names.length} models`);
  for (const name of names) {
    const file = join(MODELS, `${name}.mdl`);
    sure(existsSync(file), `${name}.mdl is not there: run node levels/art/h9-interiors.mjs`);
    const mdl = readFileSync(file);
    const r = smak.check(mdl, "goldsrc", { name: `${name}.mdl` });
    sure(!r.errors.length, `${name}: ${r.errors.join("; ")}`);
    sure(!r.warnings.some((w) => w.startsWith("form:")), `${name}: ${r.warnings.join("; ")}`);
    const m = smak.formOfMdl(mdl).measures;
    sure(m.axisAligned <= 0.737 && m.boxiness <= 0.854, `${name}: faces on the axes ${m.axisAligned}, boxiness ${m.boxiness}`);
  }
});

test("interiors: the dress file's model entries are the generator's boxes, each with a place, a rug unclipped and the rest clipped", () => {
  for (const [name, m] of Object.entries(manifest)) {
    const e = dress.models[name];
    sure(e, `the dress has no entry for ${name}`);
    sure(e.file === m.file, `${name}: file ${e.file}`);
    sure(JSON.stringify(e.min) === JSON.stringify(m.min) && JSON.stringify(e.max) === JSON.stringify(m.max), `${name}: the dress's box is stale: ${JSON.stringify(e.min)} ${JSON.stringify(e.max)} against ${JSON.stringify(m.min)} ${JSON.stringify(m.max)}`);
    sure(["wall", "corner", "free", "island", "rug"].includes(e.place), `${name}: place ${e.place}`);
    sure(e.clip === (e.place !== "rug"), `${name}: clip ${e.clip}`);
  }
});

test("interiors: every model a room, a set, a building or a counter names has an entry in the dress file", () => {
  const ids = new Set();
  for (const list of Object.values(dress.rooms)) {
    for (const e of [...(list.base ?? []), ...Object.values(list.variants ?? {}).flat(), ...Object.values(list.byBuilding ?? {}).flat(), ...(list.sets ?? []).flatMap((s) => s.items)]) ids.add(e.id);
  }
  const C = dress.counters.shelfModels;
  for (const id of [...Object.values(C.byBuilding), ...Object.values(C.byKind), C.default, C.low]) ids.add(id);
  for (const id of ids) sure(dress.models[id], `a room names ${id}, which the dress has no model entry for`);
  sure(dress.rooms.flat.sets.length >= 5 && new Set(dress.rooms.flat.sets.map((s) => s.name)).size === dress.rooms.flat.sets.length, "flats: five furniture sets or more, each its own name");
});

test("interiors: the generator is deterministic (a model written again is the committed file)", () => {
  const out = join(tmp, "interiors");
  mkdirSync(out, { recursive: true });
  const r = spawnSync(process.execPath, [join(HERE, "../levels/art/h9-interiors.mjs"), out, "--only", "shelf_pawn,rug_b,bed_c"], { encoding: "utf8" });
  sure(r.status === 0, r.stdout + r.stderr);
  for (const f of ["shelf_pawn.mdl", "rug_b.mdl", "bed_c.mdl"]) sure(readFileSync(join(out, f)).equals(readFileSync(join(MODELS, f))), `${f} is stale: run node levels/art/h9-interiors.mjs`);
});
