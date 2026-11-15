// The Godot pack (packs/godot): the kit's two rooms written as a Godot 4 project and read back with no Godot
// (packs/godot/test/check.mjs): every file there, the two .glb packs/gltf's own to the byte, the start the map's
// info_player_start with the feet under it, the lit way's ambient the one the lit file says, the probe's box the
// world's, each option where it was asked, the refusals, own.gd kept and an old import removed when a .glb changes,
// and the command. What Godot draws of it is not held here: that is `run.bat -- --shots` (docs/GODOT.md).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { mapGlb } from "../packs/gltf/gltf.mjs";
import { validateGlb } from "../packs/gltf/test/validate.mjs";
import { godotProject, writeProject, fill, PLAYER, ATLAS_SHADOWS } from "../packs/godot/godot.mjs";
import { checkProject } from "../packs/godot/test/check.mjs";
import { test, sure, tmp, HERE, runRefused } from "./helper.mjs";
import { writeLitSet, TWOROOMS } from "./fixture-gltf.mjs";

const BIN = join(HERE, "../packs/godot/bin.mjs");
const tworooms = readFileSync(TWOROOMS);
const same = (a, b) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < 1e-3);
const made = godotProject(tworooms);
const folder = join(tmp, "godot-tworooms");
writeProject(folder, made);

test("the two rooms as a project: every file, the two .glb packs/gltf's own to the byte and whole by the specification, nothing left to fill in", () => {
  sure(Object.keys(made.files).join() === "baked.glb,lit.glb,project.godot,main.tscn,main.gd,run.bat,run.sh", Object.keys(made.files).join());
  sure(Buffer.compare(made.files["baked.glb"], mapGlb(tworooms).glb) === 0, "baked.glb is not mapGlb's");
  sure(Buffer.compare(made.files["lit.glb"], mapGlb(tworooms, { light: "lit" }).glb) === 0, "lit.glb is not mapGlb's lit");
  for (const file of ["baked.glb", "lit.glb"]) sure(!validateGlb(made.files[file]).errors.length, `${file}: ${validateGlb(made.files[file]).errors.join(" | ")}`); // prettier-ignore
  const read = checkProject(folder);
  sure(!read.errors.length, read.errors.join(" | "));
  sure(/\r\n/.test(made.files["run.bat"]) && !/\r/.test(made.files["run.sh"]) && !/\r/.test(made.files["main.gd"]), "run.bat in CRLF, the rest in LF");
  sure(/^if not defined GODOT set "GODOT=godot"\r$/m.test(made.files["run.bat"]) && /--import/.test(made.files["run.bat"]) && /%\*/.test(made.files["run.bat"]), made.files["run.bat"]); // prettier-ignore
  sure(made.files["project.godot"].includes('config/name="SMAK SMAK\'s own two rooms"'), made.files["project.godot"]);
});

test("the values are the map's: the feet under info_player_start and its yaw, the lit file's ambient, the world's box for the probe, a shot from the start's eye", () => {
  const { values } = checkProject(folder);
  const spawn = maps.readBsp(tworooms).entities.map((keys) => Object.fromEntries(keys)).find((entity) => entity.classname === "info_player_start"); // prettier-ignore
  const [x, y, z] = spawn.origin.split(" ").map(Number);
  sure(same(values.START, [x, y, z - PLAYER.origin]) && values.START_YAW === Number(spawn.angles.split(" ")[1]), JSON.stringify(values));
  const lit = made.files["lit.glb"];
  const json = JSON.parse(lit.subarray(20, 20 + lit.readUInt32LE(12)).toString("utf8"));
  const ambient = json.nodes[json.scenes[0].nodes[0]].extras.ambient;
  sure(ambient.some((v) => v > 0) && same(values.AMBIENT, ambient), `${values.AMBIENT} against the file's ${ambient}`);
  // the world's box from the .bsp's own faces, not the pack's reading of the .glb
  const bsp = maps.readBsp(tworooms);
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const face of bsp.faces.slice(0, bsp.models[0].faceCount)) {
    const kind = maps.textureKind(bsp.textures[bsp.texinfo[face.texinfo].texture].name);
    if (kind.sky || kind.tool) continue;
    for (const point of maps.facePolygon(bsp, face)) point.forEach((v, k) => ((box.min[k] = Math.min(box.min[k], v)), (box.max[k] = Math.max(box.max[k], v)))); // prettier-ignore
  }
  sure(same(values.PROBE_SIZE, box.max.map((v, k) => v - box.min[k])) && same(values.PROBE_AT, box.max.map((v, k) => (v + box.min[k]) / 2)), `${values.PROBE_AT} ${values.PROBE_SIZE} against ${JSON.stringify(box)}`); // prettier-ignore
  const eye = [x, y, z - PLAYER.origin + PLAYER.eye];
  sure(same(values.PROBE_FROM, eye), `the probe looks from ${values.PROBE_FROM}`);
  sure(values.SHOTS.length === 1 && values.SHOTS[0].name === "start" && same(values.SHOTS[0].from, eye) && values.SHOTS[0].yaw === values.START_YAW && values.SHOTS[0].fov === 90, JSON.stringify(values.SHOTS)); // prettier-ignore
  sure(values.TONEMAP === "TONE_MAPPER_LINEAR" && same(values.BACKGROUND, [0, 0, 0]), JSON.stringify(values));
});

test("each option where it was asked: the start and its yaw, two shots, the tonemap, the probe's room, the ambient, the background, Godot's program, a set in the lit way only", () => {
  const sets = writeLitSet(join(tmp, "godot-sets"));
  const asked = godotProject(tworooms, { sets: [sets], name: 'a "hall"', start: [200, 300, 0, 45], shots: [{ name: "door", from: [10, 20, 64], yaw: 108.5, pitch: -6, fov: 75 }, { name: "far-2", from: [1, 2, 3] }], tonemap: "filmic", probe: [160, 100, 64, 300, 180, 120], ambient: [0.05, 0.05, 0.07], background: [0, 0.03, 0.08], godot: "C:/Godot/godot.exe" }); // prettier-ignore
  const where = join(tmp, "godot-asked");
  writeProject(where, asked);
  const { errors, values } = checkProject(where);
  sure(!errors.length, errors.join(" | "));
  sure(same(values.START, [200, 300, 0]) && values.START_YAW === 45 && values.TONEMAP === "TONE_MAPPER_FILMIC", JSON.stringify(values));
  sure(same(values.AMBIENT, [0.05, 0.05, 0.07]) && same(values.BACKGROUND, [0, 0.03, 0.08]), JSON.stringify(values));
  sure(same(values.PROBE_AT, [160, 100, 64]) && same(values.PROBE_SIZE, [300, 180, 120]) && same(values.PROBE_FROM, [160, 100, 64]), "a probe asked looks from its middle"); // prettier-ignore
  sure(JSON.stringify(values.SHOTS) === JSON.stringify([{ name: "door", from: [10, 20, 64], yaw: 108.5, pitch: -6, fov: 75 }, { name: "far-2", from: [1, 2, 3], yaw: 0, pitch: 0, fov: 90 }]), JSON.stringify(values.SHOTS)); // prettier-ignore
  sure(asked.files["run.bat"].includes('set "GODOT=C:/Godot/godot.exe"') && asked.files["run.sh"].includes('godot="${GODOT:-C:/Godot/godot.exe}"'), asked.files["run.sh"]); // prettier-ignore
  sure(asked.files["project.godot"].includes('config/name="SMAK a  hall "'), "a quote in the name would end the string");
  sure(asked.facts.lit.sets === 1 && Buffer.compare(asked.files["baked.glb"], made.files["baked.glb"]) === 0 && asked.files["lit.glb"].length > made.files["lit.glb"].length, "the set is in the lit file, the baked as before"); // prettier-ignore
});

test("the walker is the template's: the two ways by their files, the keys, the shots' names, own.gd asked for, tabs only; a value with no key is said", () => {
  const gd = made.files["main.gd"];
  for (const part of ['"res://baked.glb"', '"res://lit.glb"', "KEY_1: show_way(0)", "KEY_2: show_way(1)", "KEY_H:", '"--shots" in OS.get_cmdline_user_args()', '"res://shot-%s-%s.png"', 'ResourceLoader.exists("res://own.gd")', "create_trimesh_collision()", "probe.interior = true", "probe.box_projection = true", "1.0 / 39.37", "capsule.height = 72 * UNIT", "head.position.y = 64 * UNIT"]) sure(gd.includes(part), `main.gd has no ${part}`); // prettier-ignore
  sure(/env\.ambient_light_color = AMBIENT if lit else Color\.BLACK/.test(gd), "the baked way has no ambient");
  let said = "";
  try {
    fill("a {{known}} b {{unknown}}", { known: 1 });
  } catch (error) {
    said = error.message;
  }
  sure(said === "template: no value for {{unknown}}", said);
});

test("refused with a sentence: a map with no info_player_start and no start, a tonemap that is none, a shot with no place; with a start the same map is written", () => {
  const entities = maps.readBsp(tworooms).entities.filter((keys) => !keys.some(([key, value]) => key === "classname" && value === "info_player_start")); // prettier-ignore
  const nowhere = maps.withEntities(tworooms, entities);
  const refusal = (run) => { try { run(); } catch (error) { return error.message; } return "written"; }; // prettier-ignore
  sure(/^the map has no info_player_start: say where the feet stand \(start: \[x, y, z\], --start x,y,z\)$/.test(refusal(() => godotProject(nowhere))), refusal(() => godotProject(nowhere))); // prettier-ignore
  sure(godotProject(nowhere, { start: [96, 96, 0] }).facts.yaw === 90, "a start asked");
  sure(refusal(() => godotProject(tworooms, { tonemap: "sepia" })) === "tonemap sepia: one of linear, filmic, aces", refusal(() => godotProject(tworooms, { tonemap: "sepia" }))); // prettier-ignore
  sure(/^a shot is \{ name/.test(refusal(() => godotProject(tworooms, { shots: [{ name: "a b", from: [0, 0, 0] }] }))), "a shot's name with a space");
});

test(`more lamps than Godot's default atlas shadows (${ATLAS_SHADOWS}) is a WARN, said once; the two rooms' two lamps are not`, () => {
  let entities = maps.readBsp(tworooms).entities;
  for (let n = 0; n < ATLAS_SHADOWS; n++) entities = maps.addEntity(entities, "light", [32 + (n % 8) * 32, 32 + Math.floor(n / 8) * 32, 100], { _light: "255 255 255 50" }); // prettier-ignore
  const many = godotProject(maps.withEntities(tworooms, entities)).facts;
  const warned = many.notes.filter((note) => note.startsWith("WARN:"));
  sure(warned.length === 1 && warned[0].startsWith(`WARN: ${many.lit.lights} lamps in the lit way: Godot's default shadow atlas`) && many.lit.lights === ATLAS_SHADOWS + 2, many.notes.join(" | ")); // prettier-ignore
  sure(!made.facts.notes.some((note) => note.startsWith("WARN:")), made.facts.notes.join(" | "));
});

test("written again: own.gd and the author's files are left, the old import goes when a .glb changed and stays when none did", () => {
  const where = join(tmp, "godot-again");
  writeProject(where, made);
  mkdirSync(join(where, ".godot"));
  writeFileSync(join(where, "own.gd"), "extends Node\n");
  sure(writeProject(where, made).stale === false && existsSync(join(where, ".godot")), "the same .glb: the import is kept");
  const other = godotProject(tworooms, { sets: [writeLitSet(join(tmp, "godot-sets-again"))] });
  sure(writeProject(where, other).stale === true && !existsSync(join(where, ".godot")), "another lit.glb: the import is removed");
  sure(readFileSync(join(where, "own.gd"), "utf8") === "extends Node\n", "own.gd is the author's");
});

test("the command: writes the folder and says the start, the ambient, the probe and the shots; a flag with no value, a shot short of numbers and a missing map are refused", () => {
  const where = join(tmp, "godot-command");
  const run = runRefused(BIN, "project", TWOROOMS, "-o", where, "--tonemap", "filmic", "--shot", "door=10,20,64,90,-6", "--start", "96,96,0,180"); // prettier-ignore
  sure(run.code === 0 && !run.err, run.err);
  const { errors, values } = checkProject(where);
  sure(!errors.length && values.TONEMAP === "TONE_MAPPER_FILMIC" && values.START_YAW === 180 && values.SHOTS[0].name === "door" && values.SHOTS[0].fov === 90, JSON.stringify(values)); // prettier-ignore
  for (const said of [/^wrote .*godot-command in [\d.]+ s: baked\.glb, lit\.glb, project\.godot, main\.tscn, main\.gd, run\.bat, run\.sh$/m, /^ {2}the start: feet at 96 96 0, yaw 180; tonemap filmic$/m, /^ {2}the lit way: ambient [\d. ]+ \(linear, the export's\); a reflection probe 320 448 128 at 160 224 64 \(the world's box\), looking from 96 96 64$/m, /^ {2}shots: door from 10 20 64 yaw 90 pitch -6 fov 90$/m, /run\.bat -- --shots/]) sure(said.test(run.out), `${said} not in:\n${run.out}`); // prettier-ignore
  const none = runRefused(BIN, "project", TWOROOMS, "-o");
  sure(none.code === 1 && /^-o needs a value\nusage: node packs\/godot\/bin\.mjs project/.test(none.err), none.err);
  const short = runRefused(BIN, "project", TWOROOMS, "-o", where, "--shot", "door=1,2,3");
  sure(short.code === 1 && /^--shot door=1,2,3: 5 or 6 numbers with commas between/.test(short.err), short.err);
  const missing = runRefused(BIN, "project", join(tmp, "no-such.bsp"), "-o", where);
  sure(missing.code === 1 && /^project: .*no-such\.bsp cannot be read/.test(missing.err), missing.err);
  sure(runRefused(BIN, "walk").code === 1, "a command that is not project");
});
