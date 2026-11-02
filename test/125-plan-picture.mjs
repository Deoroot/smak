// The R1 review's plan pictures (levels/lib/plan-picture.mjs, levels/tools/plan-picture.mjs): New Byzantium drawn
// per layer, per tile and whole, the Sunken Abbey per storey and whole; the same description gives the same bytes;
// every layer and tile drawn; every enterable building and connector (every space) shown with its id; review.json
// holding each picture's sha256 and the description's hash; a broken description refused with the validator's sentence.
import { join } from "node:path";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, HERE, tmp } from "./helper.mjs";
import { planPictures, descriptionHash, sha256 } from "../levels/lib/plan-picture.mjs";
import { validateCity } from "../levels/lib/city-description.mjs";
import { validateDescription } from "../levels/lib/description.mjs";

const CITY = join(HERE, "../levels/specs/newbyzantium.json");
const DUNGEON = join(HERE, "../levels/specs/rpg-dungeon-01.json");
const TOOL = join(HERE, "../levels/tools/plan-picture.mjs");
const city = () => JSON.parse(readFileSync(CITY, "utf8"));
const dungeon = () => JSON.parse(readFileSync(DUNGEON, "utf8"));
/** A label: the id as the whole text of a <text> element. */
const labelled = (svg, id) => svg.includes(`>${id}</text>`);
const refusal = (desc) => {
  try {
    planPictures(desc);
  } catch (e) {
    return e.message;
  }
  return "drawn";
};

test("plan pictures: a city drawn whole, per layer and per tile, the same bytes twice", () => {
  const d = city();
  const a = planPictures(d);
  const b = planPictures(city());
  sure(a.pictures.length === b.pictures.length && a.pictures.every((p, i) => p.svg === b.pictures[i].svg), "the same description drew different bytes"); // prettier-ignore
  sure(a.hash === descriptionHash(d) && /^[0-9a-f]{64}$/.test(a.hash), `hash ${a.hash}`);
  const files = new Set(a.pictures.map((p) => p.file));
  sure(files.has("overview.svg"), "no overview");
  const tiles = [];
  for (let r = 0; r < d.tiles.rows; r++) for (let c = 0; c < d.tiles.cols; c++) tiles.push(`c${c}_r${r}`);
  for (const L of d.layers) {
    sure(files.has(`layer-${L.id}.svg`), `no picture of layer ${L.id}`);
    for (const t of tiles) {
      const [c, r] = t.slice(1).split("_r").map(Number);
      const [x0, y0] = [c * d.tiles.size[0], r * d.tiles.size[1]];
      const meets = L.bounds[0] < x0 + d.tiles.size[0] && L.bounds[2] > x0 && L.bounds[1] < y0 + d.tiles.size[1] && L.bounds[3] > y0; // prettier-ignore
      sure(files.has(`tile-${t}-${L.id}.svg`) === meets, `tile ${t} on ${L.id}: drawn ${files.has(`tile-${t}-${L.id}.svg`)}, meets ${meets}`); // prettier-ignore
    }
  }
  for (const p of a.pictures) {
    sure(p.svg.startsWith('<?xml version="1.0"') && p.svg.trimEnd().endsWith("</svg>"), `${p.file} is not a whole SVG`); // prettier-ignore
    sure(p.svg.includes(a.hash), `${p.file} does not carry the description's hash`);
    sure(p.svg.includes(d.title), `${p.file} does not carry the description's title`);
  }
});

test("plan pictures: every enterable building and every connector shown with its id on its layer", () => {
  const d = city();
  const { pictures } = planPictures(d);
  const layerOfDistrict = new Map(d.districts.map((x) => [x.id, x.layer]));
  const layerOfNode = new Map(d.streets.nodes.map((n) => [n.id, n.layer]));
  const layerOf = (id) => layerOfNode.get(id) ?? layerOfDistrict.get(d.buildings.find((b) => b.id === id)?.district);
  const tilesOf = (L) => pictures.filter((p) => p.kind === "tile" && p.layer === L);
  for (const b of d.buildings.filter((x) => x.interior)) {
    const L = layerOfDistrict.get(b.district);
    sure(tilesOf(L).some((p) => labelled(p.svg, b.id)), `building ${b.id} labelled in no tile picture of ${L}`);
    sure(pictures.find((p) => p.file === `layer-${L}.svg`).svg.includes(`id="b-${b.id}"`), `building ${b.id} not drawn on layer-${L}`); // prettier-ignore
  }
  for (const c of d.connectors)
    for (const L of new Set(c.stops.map(layerOf))) {
      sure(tilesOf(L).some((p) => labelled(p.svg, c.id)), `connector ${c.id} labelled in no tile picture of ${L}`);
      sure(pictures.find((p) => p.file === `layer-${L}.svg`).shows.connectors.includes(c.id), `connector ${c.id} not on layer-${L}`); // prettier-ignore
    }
  for (const k of d.checkpoints) sure(pictures.some((p) => p.kind === "tile" && labelled(p.svg, k.id)), `checkpoint ${k.id} unlabelled`); // prettier-ignore
});

test("plan pictures: a dungeon drawn per storey and whole, every space with its id, the same bytes twice", () => {
  const a = planPictures(dungeon());
  const b = planPictures(dungeon());
  sure(a.kind === "dungeon" && a.pictures.every((p, i) => p.svg === b.pictures[i].svg), "the same description drew different bytes"); // prettier-ignore
  const files = a.pictures.map((p) => p.file).join(", ");
  sure(files === "overview.svg, storey-0.svg, storey-m1.svg, storey-m2.svg", files);
  for (const p of a.pictures) for (const s of dungeon().spaces) sure(labelled(p.svg, s.id), `${p.file}: space ${s.id} unlabelled`); // prettier-ignore
  const over = a.pictures[0].svg;
  for (const words of ["START", "GOAL", "DEAD END", "gate: iron-key", "gate: crypt-seal", "drop"]) sure(over.includes(words), `overview lacks "${words}"`); // prettier-ignore
  const one = planPictures(dungeon(), { layer: "-1" });
  sure(one.pictures.length === 1 && one.pictures[0].file === "storey-m1.svg", "--layer -1 drew more or other than storey -1"); // prettier-ignore
});

test("plan pictures: a broken description is refused with the validator's sentence", () => {
  const c = city();
  delete c.grid.cellUnits;
  c.buildings[0].frontage = "nowhere";
  const said = refusal(c);
  sure(said.includes(validateCity(c).errors[0]), `city refused with: ${said}`);
  const d = dungeon();
  d.links[0].to = "nowhere";
  const said2 = refusal(d);
  sure(said2.includes(validateDescription(d).errors[0]), `dungeon refused with: ${said2}`);
  sure(refusal({ format: "nothing" }).includes("format: wanted"), "an unknown format is not refused by its format");
  sure(refusal({ ...city(), layers: city().layers }) === "drawn", "a whole city refused");
  let threw = "";
  try {
    planPictures(city(), { tile: "c9_r9" });
  } catch (e) {
    threw = e.message;
  }
  sure(threw.includes('"c9_r9" is no tile'), `unknown tile: ${threw}`);
});

test("plan-picture tool: pictures and review.json with each picture's sha256; a broken file refused", () => {
  const out = join(tmp, "plans-l2");
  const run = (...a) => spawnSync(process.execPath, [TOOL, ...a], { encoding: "utf8" });
  const r = run(CITY, "--out", out, "--layer", "L2");
  sure(r.status === 0, `tool failed: ${r.stderr}`);
  const review = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
  sure(review.format === "smak-plan-review/1" && review.stop === "R1" && review.approval === null, "review.json's head");
  sure(review.description.sha256 === descriptionHash(city()), "description hash");
  sure(review.description.fileSha256 === sha256(readFileSync(CITY)), "file hash");
  const svgs = readdirSync(out).filter((x) => x.endsWith(".svg")).sort();
  sure(svgs.length === 10 && svgs.includes("layer-L2.svg") && svgs.every((x) => x === "layer-L2.svg" || /^tile-c\d_r\d-L2\.svg$/.test(x)), svgs.join(", ")); // prettier-ignore
  sure(review.pictures.length === svgs.length, "review lists every picture");
  for (const p of review.pictures) sure(p.sha256 === sha256(readFileSync(join(out, p.file))), `${p.file}: sha256 differs from its bytes`); // prettier-ignore
  const again = join(tmp, "plans-l2-again");
  run(CITY, "--out", again, "--layer", "L2");
  sure(readFileSync(join(again, "review.json"), "utf8") === readFileSync(join(out, "review.json"), "utf8"), "a second run wrote other bytes"); // prettier-ignore
  const one = join(tmp, "plans-tile");
  sure(run(CITY, "--out", one, "--layer", "L3", "--tile", "c1_r1").status === 0, "one tile");
  sure(readdirSync(one).sort().join(",") === "review.json,tile-c1_r1-L3.svg", readdirSync(one).join(","));
  const broken = city();
  broken.layers[0].ceiling = "cloud";
  const bad = join(tmp, "broken-city.json");
  writeFileSync(bad, JSON.stringify(broken));
  const f = run(bad, "--out", join(tmp, "plans-broken"));
  sure(f.status === 1 && f.stderr.includes(validateCity(broken).errors[0]), `broken: ${f.status} ${f.stderr}`);
  sure(run(CITY).status === 2, "no --out is a wrong argument");
});
