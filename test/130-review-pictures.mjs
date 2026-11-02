// The R1 review drawn from the generator's artifacts (levels/lib/review-picture.mjs, levels/tools/review.mjs): New
// Byzantium's Core run through the stages, then drawn per layer, in section through the spine and per building; the
// same artifacts give the same bytes; every enterable building, connector, checkpoint and spawn shown by its id;
// review.json holding each picture's sha256 and the artifacts' hashes; an approval refused once an artifact changed,
// recorded while they match; the marks for a narrow room and a prop in a doorway.
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { testAsync, test, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator } from "../levels/gen/runner.mjs";
import { readArtifacts, reviewPictures, approveReview, REVIEW_FORMAT } from "../levels/lib/review-picture.mjs";
import { sha256 } from "../levels/lib/plan-picture.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const TOOL = join(HERE, "../levels/tools/review.mjs");
const GEN = join(tmp, "review-core");
const labelled = (svg, id) => svg.includes(`>${id}</text>`);
const copyDir = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter((x) => x.endsWith(".json"))) copyFileSync(join(from, f), join(to, f));
};
let made = false;

await testAsync("review pictures: the Core's artifacts made (stages 0 to 7, as far as they run)", "review core", async () => {
  const res = await runGenerator({ desc: JSON.parse(readFileSync(SPEC, "utf8")), out: GEN, tile: "c1_r1", until: 7 });
  for (const f of ["01-site.json", "02-lots.json", "04-network.json", "05-plans.json"]) sure(existsSync(join(GEN, f)), `no ${f}: ${res.refused ?? JSON.stringify(res.stopped)}`); // prettier-ignore
  made = true;
});

test("review pictures: per layer, per section and per building, the same bytes twice", () => {
  sure(made, "no artifacts");
  const arts = readArtifacts(GEN);
  const a = reviewPictures(arts);
  const b = reviewPictures(readArtifacts(GEN));
  sure(a.pictures.length === b.pictures.length && a.pictures.every((p, i) => p.file === b.pictures[i].file && p.svg === b.pictures[i].svg), "the same artifacts drew different bytes"); // prettier-ignore
  const files = new Set(a.pictures.map((p) => p.file));
  const site = arts["01-site.json"].artifact;
  for (const L of site.layers) sure(files.has(`plan-c1_r1-${L.id}.svg`), `no plan of ${L.id}`);
  sure(files.has("section-c1_r1-ns.svg") && files.has("section-c1_r1-ew.svg"), "no section through the spine");
  for (const bp of arts["05-plans.json"].artifact.buildings) sure(files.has(`building-${bp.id}.svg`), `no sheet of ${bp.id}`);
  sure(files.has(`wiring-c1_r1-L2.svg`) === !!arts["07-wiring.json"], "the wiring pictures drawn without 07, or missing with it");
  for (const p of a.pictures) {
    sure(p.svg.startsWith('<?xml version="1.0"') || p.svg.startsWith("<svg"), `${p.file} is not an SVG`);
    sure(p.svg.trimEnd().endsWith("</svg>"), `${p.file} is not a whole SVG`);
    if (p.kind !== "building") sure(p.svg.includes(arts["02-lots.json"].hash.slice(0, 8)), `${p.file} does not carry the artifacts' hashes`); // prettier-ignore
  }
  const ns = a.pictures.find((p) => p.file === "section-c1_r1-ns.svg");
  sure(/spine/.test(ns.svg) && ns.shows.layers.length === site.layers.length, `the section cut ${ns.shows.layers} through ${ns.svg.match(/through (\S+)/)?.[1]}`); // prettier-ignore
});

test("review pictures: every enterable building, connector, checkpoint and spawn shown by its id on its layer", () => {
  sure(made, "no artifacts");
  const arts = readArtifacts(GEN);
  const { pictures } = reviewPictures(arts);
  const plan = (L) => pictures.find((p) => p.file === `plan-c1_r1-${L}.svg`).svg;
  for (const l of arts["02-lots.json"].artifact.lots.filter((x) => x.kind === "enterable")) sure(labelled(plan(l.layer), l.building), `${l.building} not labelled on ${l.layer}`); // prettier-ignore
  const net = arts["04-network.json"].artifact;
  for (const c of net.connectors) {
    const layers = [...new Set((c.exits ?? []).map((e) => e.layer))];
    sure(layers.length, `${c.id} has no exit`);
    for (const L of layers) sure(labelled(plan(L), c.id), `${c.id} not labelled on ${L}`);
  }
  for (const cp of net.checkpoints) sure(labelled(plan(cp.layer), cp.id), `${cp.id} not labelled on ${cp.layer}`);
  for (const s of net.spawns) sure(labelled(plan(s.layer), s.id), `${s.id} not labelled on ${s.layer}`);
  for (const p of net.posts) sure(labelled(plan(p.layer), p.id), `${p.id} not labelled on ${p.layer}`);
  for (const p of arts["01-site.json"].artifact.portals)
    for (const L of p.layer ? [p.layer] : arts["01-site.json"].artifact.layers.map((x) => x.id)) sure(labelled(plan(L), p.id), `${p.id} not labelled on ${L}`); // prettier-ignore
});

test("review pictures: review.json's hashes, an approval refused on a changed artifact and recorded on the same", () => {
  sure(made, "no artifacts");
  const src = join(tmp, "review-src");
  const out = join(tmp, "review-out");
  copyDir(GEN, src);
  const r = spawnSync(process.execPath, [TOOL, src, "--out", out], { encoding: "utf8" });
  sure(r.status === 0, `the tool said ${r.status}: ${r.stderr || r.stdout}`);
  const rec = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
  sure(rec.format === REVIEW_FORMAT && rec.stop === "R1" && rec.approval === null, `${rec.format} ${rec.stop} ${JSON.stringify(rec.approval)}`); // prettier-ignore
  const arts = readArtifacts(src);
  for (const [f, h] of Object.entries(rec.artifacts.files)) sure(arts[f]?.hash === h, `review.json's ${f} ${h.slice(0, 12)}`);
  for (const p of rec.pictures) {
    sure(sha256(readFileSync(join(out, p.file), "utf8")) === p.sha256, `${p.file}'s sha256 is not the file's`);
    sure(Object.keys(p.from).length && Object.entries(p.from).every(([f, h]) => rec.artifacts.files[f] === h), `${p.file} drawn from ${JSON.stringify(p.from)}`); // prettier-ignore
  }
  // no name, no approval
  sure(spawnSync(process.execPath, [TOOL, "--approve", out], { encoding: "utf8" }).status === 2, "an approval without --by was taken");
  // an artifact changed after the pictures: refused, naming it
  const f2 = join(src, "02-lots.json");
  const keep = readFileSync(f2, "utf8");
  writeFileSync(f2, keep.replace('"scrap"', '"scrap" ').replace(/\n$/, "\n\n"));
  const no = spawnSync(process.execPath, [TOOL, "--approve", out, "--by", "tester"], { encoding: "utf8" });
  sure(no.status === 1 && /REFUSED/.test(no.stdout) && no.stdout.includes("02-lots.json changed"), `a stale artifact was approved: ${no.status} ${no.stdout}`); // prettier-ignore
  sure(JSON.parse(readFileSync(join(out, "review.json"), "utf8")).approval === null, "a refused approval was written");
  // a picture edited by hand: refused
  writeFileSync(f2, keep);
  const pic = join(out, rec.pictures[0].file);
  const pk = readFileSync(pic, "utf8");
  writeFileSync(pic, pk.replace("</svg>", "<!-- --></svg>"));
  const res2 = approveReview(out, { by: "tester" });
  sure(!res2.ok && res2.reason.includes(rec.pictures[0].file), `an edited picture was approved: ${res2.reason}`);
  writeFileSync(pic, pk);
  // the same artifacts: recorded
  const yes = spawnSync(process.execPath, [TOOL, "--approve", out, "--by", "tester", "--note", "the Core reads"], { encoding: "utf8" }); // prettier-ignore
  sure(yes.status === 0 && /APPROVED/.test(yes.stdout), `${yes.status} ${yes.stdout}`);
  const done = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
  sure(done.approval?.by === "tester" && done.approval.note === "the Core reads" && done.approval.artifacts["02-lots.json"] === rec.artifacts.files["02-lots.json"], JSON.stringify(done.approval)); // prettier-ignore
});

test("review pictures: a room under 1.5 m and a prop in a doorway marked by number", () => {
  sure(made, "no artifacts");
  const arts = readArtifacts(GEN);
  const plans = arts["05-plans.json"].artifact;
  const b = plans.buildings.find((x) => x.rooms.some((r) => r.storey === 0 && r.kind !== "corridor"));
  const room = b.rooms.find((r) => r.storey === 0 && r.kind !== "corridor");
  room.narrow_m = 1.2;
  const door = b.doors.find((d) => d.street);
  const props = { format: "smak-gen/1", stage: "dressing", n: 8, inputs: {}, params: {}, props: [{ id: "prop_test_crate", kind: "crate", layer: b.layer, at: door.cells }], gate: { pass: true, failures: [], notes: [] } }; // prettier-ignore
  const broken = { ...arts, "05-plans.json": { ...arts["05-plans.json"], artifact: plans }, "08-dressing.json": { file: "08-dressing.json", n: 8, text: "", hash: sha256(JSON.stringify(props)), artifact: props } }; // prettier-ignore
  const res = reviewPictures(broken);
  const narrow = res.looks.find((l) => l.kind === "narrow-room" && l.text.startsWith(room.id));
  sure(narrow, `no mark for ${room.id} at 1.2 m: ${res.looks.map((l) => l.kind).join(", ")}`);
  const prop = res.looks.find((l) => l.kind === "prop-at-door" && l.text.includes("prop_test_crate") && l.text.includes(door.id));
  sure(prop, `no mark for the crate in ${door.id}'s doorway`);
  const plan = res.pictures.find((p) => p.file === `plan-c1_r1-${b.layer}.svg`);
  const sheet = res.pictures.find((p) => p.file === `building-${b.id}.svg`);
  for (const lk of [narrow, prop]) sure(plan.looks.includes(lk.n) && sheet.looks.includes(lk.n), `mark ${lk.n} not on ${plan.file} and ${sheet.file}`); // prettier-ignore
  sure(plan.svg.includes(`${narrow.n}. ${room.id}`), "the mark's words not in the plan's legend");
});
