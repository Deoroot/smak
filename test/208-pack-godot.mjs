// The Godot pack (packs/godot): the kit's two rooms written as a Godot 4 project and read back with no Godot
// (packs/godot/test/check.mjs): every file there, the two .glb packs/gltf's own to the byte, the start the map's
// info_player_start with the feet under it, the lit way's ambient the one the lit file says, the probe's box the
// world's, each option where it was asked, the refusals, own.gd kept and an old import removed when a .glb changes,
// the lit way's look (the lamps scaled, all, the texture lights' cells and by an entity's _role; a finish by a
// material's name; reflections, fog, the shots' size), what a script reaches (reachOf, `list`), the shots taken by a
// Godot that is not one (takeShots: what it runs, what it says when a picture is missing), and the command. What
// Godot draws of it is not held here: that is the `shots` command and looking (docs/GODOT.md).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { mapGlb } from "../packs/gltf/gltf.mjs";
import { validateGlb } from "../packs/gltf/test/validate.mjs";
import { godotProject, writeProject, reachOf, takeShots, fill, PLAYER, ATLAS_SHADOWS, ROLES } from "../packs/godot/godot.mjs";
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
  sure(/env\.ambient_light_color = ambient if lit else Color\.BLACK/.test(gd), "the baked way has no ambient");
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
  for (const said of [/^wrote .*godot-command in [\d.]+ s: baked\.glb, lit\.glb, project\.godot, main\.tscn, main\.gd, run\.bat, run\.sh$/m, /^ {2}the start: feet at 96 96 0, yaw 180; tonemap filmic$/m, /^ {2}the lit way: ambient [\d. ]+ \(linear, the export's\); a reflection probe 320 448 128 at 160 224 64 \(the world's box\), looking from 96 96 64$/m, /^ {2}shots \(1280 x 720\): door from 10 20 64 yaw 90 pitch -6 fov 90$/m, /pictures with no person: node packs\/godot\/bin\.mjs shots /]) sure(said.test(run.out), `${said} not in:\n${run.out}`); // prettier-ignore
  const none = runRefused(BIN, "project", TWOROOMS, "-o");
  sure(none.code === 1 && /^-o needs a value\nusage: node packs\/godot\/bin\.mjs project/.test(none.err), none.err);
  const short = runRefused(BIN, "project", TWOROOMS, "-o", where, "--shot", "door=1,2,3");
  sure(short.code === 1 && /^--shot door=1,2,3: 5 or 6 numbers with commas between/.test(short.err), short.err);
  const missing = runRefused(BIN, "project", join(tmp, "no-such.bsp"), "-o", where);
  sure(missing.code === 1 && /^project: .*no-such\.bsp cannot be read/.test(missing.err), missing.err);
  sure(runRefused(BIN, "walk").code === 1, "a command that is not project, shots or list");
});

// the two rooms with a fill and two floor pools: what a map says of its lights with _role
const roled = () => {
  let entities = maps.readBsp(tworooms).entities;
  for (const [role, at] of [["fill", [96, 200, 100]], ["pool", [200, 96, 40]], ["pool", [240, 96, 40]]]) entities = maps.addEntity(entities, "light", at, { _light: "255 255 255 80", _role: role }); // prettier-ignore
  return maps.withEntities(tworooms, entities);
};

test("the lit way's look: every lamp times lamps, a role's by its factor, a fill off with nothing said, the size, a finish, reflections and fog, in main.gd as they were asked; none asked is 1, no finish, no fog", () => {
  const plain = checkProject(folder).values;
  sure(plain.LAMPS === 1 && plain.CELLS === 1 && JSON.stringify(plain.ROLES) === JSON.stringify(ROLES) && !plain.FINISH.length && plain.SSR === false && plain.FOG.join() === "0,0,0,0,0,0,0,0,0,0" && plain.SIZE.join() === "1280,720", JSON.stringify(plain)); // prettier-ignore
  const asked = godotProject(roled(), { lamps: 0.8, cells: 0.375, roles: { pool: 0.5 }, finish: [{ name: "smakfloor", tone: 0.45, roughness: 0.16 }, { name: "wall", tone: 0.8 }], ssr: true, fog: [0.022, 0.35, 0.62, 0.72, 240, 852, 210, 560, 520, 420], size: [960, 540] }); // prettier-ignore
  const where = join(tmp, "godot-look");
  writeProject(where, asked);
  const { errors, values } = checkProject(where);
  sure(!errors.length, errors.join(" | "));
  sure(values.LAMPS === 0.8 && values.CELLS === 0.375 && JSON.stringify(values.ROLES) === '{"fill":0,"pool":0.5}' && values.SSR === true && values.SIZE.join() === "960,540", JSON.stringify(values)); // prettier-ignore
  sure(JSON.stringify(values.FINISH) === '[["smakfloor",0.45,0.16],["wall",0.8,-1]]' && values.FOG.join() === "0.022,0.35,0.62,0.72,240,852,210,560,520,420", JSON.stringify(values)); // prettier-ignore
  sure(Buffer.compare(asked.files["lit.glb"], mapGlb(roled(), { light: "lit" }).glb) === 0, "the look is the walker's: lit.glb is still packs/gltf's to the byte");
  const lamps = asked.facts.reach.lamps;
  sure(lamps.length === 5 && lamps.map((lamp) => lamp.role).join() === ",,fill,pool,pool" && lamps.map((lamp) => +lamp.factor.toFixed(4)).join() === "0.8,0.8,0,0.4,0.4", JSON.stringify(lamps)); // prettier-ignore
  sure(asked.facts.lamps.on === 4 && asked.facts.lamps.roles.fill === 1 && asked.facts.lamps.roles.pool === 2 && !asked.facts.notes.some((note) => note.startsWith("WARN:")), asked.facts.notes.join(" | ")); // prettier-ignore
  const gd = asked.files["main.gd"];
  for (const part of ["light.light_energy *= factor", "light.visible = factor > 0.0", "ROLES.get(role, 1.0)", "material.albedo_color *= Color(each[1], each[1], each[1])", "env.ssr_enabled = lit and SSR", "env.volumetric_fog_enabled = lit and FOG[0] > 0", "FogVolume.new()", "func set_ambient(color: Color)", "env.ambient_light_color = ambient if lit else Color.BLACK", 'light.has_meta("extras")']) sure(gd.includes(part), `main.gd has no ${part}`); // prettier-ignore
  sure(gd.indexOf("env.ambient_light_color = ambient if lit") < gd.indexOf("own.shown(n)"), "own.gd's shown(way) has the last word at each change of way");
  const refusal = (run) => { try { run(); } catch (error) { return error.message; } return "written"; }; // prettier-ignore
  sure(/^fog is \[density, r, g, b\]/.test(refusal(() => godotProject(tworooms, { fog: [0.02, 1, 1] }))) && /^a finish is \{ name/.test(refusal(() => godotProject(tworooms, { finish: [{ name: "smakfloor" }] }))), "a fog of three numbers, a finish with no tone"); // prettier-ignore
});

test("what a script reaches in the lit file: each lamp with its entity's number, _role and place, each material by its name; a role or a finish that names nothing there is a WARN", () => {
  const reach = reachOf(mapGlb(roled(), { light: "lit" }).glb);
  const spawn = maps.readBsp(roled()).entities.map((keys) => Object.fromEntries(keys));
  for (const lamp of reach.lamps) sure(spawn[lamp.number].classname === "light" && (spawn[lamp.number]._role ?? "") === lamp.role && same(lamp.origin, spawn[lamp.number].origin.split(" ").map(Number)) && lamp.candela > 0 && lamp.name === `${lamp.number} light`, JSON.stringify(lamp)); // prettier-ignore
  sure(reach.lamps[2].factor === 0 && reach.lamps[3].factor === 1, "a fill is off with nothing asked, a role with no factor is as it was");
  sure(reach.materials.map((material) => material.name).join() === "smakwall,smakfloor,{smakgrate masked" && reach.materials.every((material) => !material.set), JSON.stringify(reach.materials)); // prettier-ignore
  const warned = godotProject(roled(), { roles: { well: 0.4 }, finish: [{ name: "dd_floor", tone: 0.5 }] }).facts.notes.filter((note) => note.startsWith("WARN:")); // prettier-ignore
  sure(warned.length === 2 && warned[0] === "WARN: role well: no light of the map has _role well (the map's: fill, pool): nothing is scaled by it" && warned[1].startsWith("WARN: finish dd_floor: no material of the lit file has dd_floor in its name"), warned.join(" | ")); // prettier-ignore
});

test("the shots taken: Godot imports a folder with no .godot, runs it with --shots, and the pictures are named; a picture not written, a Godot that is nowhere and a folder that is no project are said", () => {
  const where = join(tmp, "godot-shots");
  writeProject(where, godotProject(tworooms, { shots: [{ name: "door", from: [10, 20, 64] }, { name: "far", from: [1, 2, 3] }], godot: "C:/Godot/godot.exe" })); // prettier-ignore
  writeFileSync(join(where, "shot-door-lit.png"), "an earlier run's");
  const calls = [];
  const godot = (writes) => (program, args) => {
    calls.push([program, ...args].join(" "));
    if (args.includes("--import")) mkdirSync(join(where, ".godot"), { recursive: true });
    else for (const name of writes) writeFileSync(join(where, name), "png");
    return { stdout: "wrote\n", stderr: 'WARNING: 7 RIDs of type "Texture" were leaked.\n   at: finalize\nSCRIPT ERROR: Invalid call in own.gd\n' };
  };
  const all = ["shot-door-baked.png", "shot-door-lit.png", "shot-far-baked.png", "shot-far-lit.png"];
  const before = process.env.GODOT;
  delete process.env.GODOT;
  const taken = takeShots(where, { run: godot(all), size: [960, 540] });
  sure(calls.length === 2 && /^C:\/Godot\/godot\.exe --headless --path .*godot-shots --import$/.test(calls[0]) && /^C:\/Godot\/godot\.exe --path .*godot-shots --resolution 960x540 -- --shots$/.test(calls[1]), calls.join(" | ")); // prettier-ignore
  sure(taken.files.map((file) => file.slice(where.length + 1)).join() === all.join() && taken.said.join() === "SCRIPT ERROR: Invalid call in own.gd", JSON.stringify(taken)); // prettier-ignore
  sure(readFileSync(join(where, "shot-door-lit.png"), "utf8") === "png", "an earlier run's picture is not left to be taken for this run's");
  const refusal = (run) => { try { run(); } catch (error) { return error.message; } return "taken"; }; // prettier-ignore
  const short = refusal(() => takeShots(where, { run: godot(all.slice(0, 3)), godot: "other" }));
  sure(calls.length === 3 && calls[2].startsWith("other --path ") && /^Godot wrote 3 of 4 pictures \(not .*shot-far-lit\.png\); it said: SCRIPT ERROR: Invalid call in own\.gd$/.test(short), short); // prettier-ignore
  sure(refusal(() => takeShots(where, { godot: join(tmp, "no-godot.exe") })) === `Godot is not at "${join(tmp, "no-godot.exe")}": say its program (--godot <program>, or the GODOT variable)`, "a Godot that is nowhere"); // prettier-ignore
  sure(/is not a project with shots \(no SHOTS in its main\.gd\)/.test(refusal(() => takeShots(join(tmp, "godot-none")))), "a folder with no project");
  if (before !== undefined) process.env.GODOT = before;
});

test("the commands: list says each lamp and material of a folder with its factors; project --list the same; shots with no Godot there is refused with the sentence; --role and --size as they are written", () => {
  const where = join(tmp, "godot-command-look");
  const bsp = join(tmp, "godot-roled.bsp");
  writeFileSync(bsp, roled());
  const run = runRefused(BIN, "project", bsp, "-o", where, "--lamps", "0.8", "--role", "pool=0.5", "--finish", "smakfloor=0.45,0.16", "--ssr", "--fog", "0.02,0.3,0.6,0.7", "--size", "960x540", "--list"); // prettier-ignore
  sure(run.code === 0 && !run.err, run.err);
  for (const said of [/^ {2}the lit way's lamps: 4 of 5 on; every one x 0\.8, the 0 texture lights' cells x 1 besides; 1 of _role fill x 0, 2 of _role pool x 0\.4$/m, /^ {2}shots \(960 x 540\): /m, /^ {2}5 lamps of the lit way /m, /^ {4}#\d+ light _role fill, point at 96 200 100, [\d.]+ cd: off$/m, /^ {4}#\d+ light _role pool, point at 200 96 40, [\d.]+ cd x 0\.4$/m, /^ {4}smakfloor, roughness 1, metallic 0$/m]) sure(said.test(run.out), `${said} not in:\n${run.out}`); // prettier-ignore
  const { errors, values } = checkProject(where);
  sure(!errors.length && values.ROLES.pool === 0.5 && values.SSR === true && values.FOG[0] === 0.02 && values.FINISH[0].join() === "smakfloor,0.45,0.16", JSON.stringify(values)); // prettier-ignore
  const listed = runRefused(BIN, "list", where);
  sure(listed.code === 0 && listed.out === run.out.slice(run.out.indexOf("  5 lamps of the lit way"), run.out.indexOf("  to walk it:")), listed.out + listed.err);
  const none = runRefused(BIN, "shots", where, "--godot", join(tmp, "no-godot.exe"));
  sure(none.code === 1 && /^shots: Godot is not at ".*no-godot\.exe": say its program/.test(none.err), none.err);
  const role = runRefused(BIN, "project", bsp, "-o", where, "--role", "pool");
  sure(role.code === 1 && /^--role pool: 1 numbers with commas between/.test(role.err), role.err);
});
