// packs/godot: a ready-to-walk Godot 4 project for a compiled map (README.md, docs/GODOT.md).
//
//   godotProject(bytes, options)   the files of the project: packs/gltf's two ways of the map (baked.glb, lit.glb) and
//                                  project.godot, main.tscn, main.gd, run.bat, run.sh from template/, the map's values
//                                  filled in: the start, the lit way's ambient and the probe's box read from the lit file
//   writeProject(folder, made)     writes them; an old import of other .glb (the .godot folder) is removed
//   reachOf(glb, options)          what own.gd (and roles, finish) can reach in the lit file: each lamp with its
//                                  entity's number, _role and place, each material by its name
//   takeShots(folder, options)     runs Godot on a written project (the import first when there is none) with --shots
//
// The walker is template/main.gd, the same for every map but the constants under "filled in". What is a map's own
// (a finish by a texture's name, a lift, a lamp dimmed) is the author's own.gd in the folder, which nothing here writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mapGlb } from "../gltf/gltf.mjs";

const UNITS_A_METRE = 39.37;
/** The player, in the map's units: the start entity's origin is this far over the feet, the eye this far. */
export const PLAYER = { origin: 36, eye: 64 };
export const TONEMAPS = { linear: "TONE_MAPPER_LINEAR", filmic: "TONE_MAPPER_FILMIC", aces: "TONE_MAPPER_ACES" };
/** Godot's default positional shadow atlas holds 64 shadows in its largest quadrant (a room of 82 lamps was seen with shadows on some only). */
export const ATLAS_SHADOWS = 64;
/** A light whose `_role` is this lights the baked way only (a fill for the bounce, with no lamp seen): off in the lit way unless `roles` says otherwise. */
export const ROLES = { fill: 0 };
/** Under this the lit way's ambient is as good as black (linear): a wall no lamp reaches is black. */
export const DARK_AMBIENT = 0.01;
const TEMPLATES = ["project.godot", "main.tscn", "main.gd", "run.bat", "run.sh"];

const num = (value) => String(+(+value).toFixed(4));
const list = (values) => values.map(num).join(", ");
const jsonOf = (glb) => JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
/** glTF's (x, y, z) in metres as the map's (x, -z, y) in its units. */
const toMap = ([x, y, z]) => [x * UNITS_A_METRE, -z * UNITS_A_METRE, y * UNITS_A_METRE];

/** The box of the world's drawn faces, in the map's units, from the POSITION bounds the .glb already says. */
export function boundsOf(json) {
  const world = json.nodes.find((node) => node.extras?.classname === "worldspawn");
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const primitive of json.meshes[world?.mesh]?.primitives ?? []) {
    const { min, max } = json.accessors[primitive.attributes.POSITION];
    for (const corner of [toMap(min), toMap(max)]) corner.forEach((v, k) => ((box.min[k] = Math.min(box.min[k], v)), (box.max[k] = Math.max(box.max[k], v)))); // prettier-ignore
  }
  return box.min[0] <= box.max[0] ? box : null;
}

/**
 * What a script can reach in the lit file. `lamps`: { name, kind (point, spot, directional), candela, role ("cell":
 * a texture light's cell, with no entity; else the entity's `_role` key, "" with none), number, classname, origin (the
 * map's), factor (what `lamps`, `cells` and `roles` make of its energy) }. `materials`: { name (Godot's
 * resource_name), set (it has its relief and roughness maps), roughness, metallic }.
 */
export function reachOf(glb, { lamps = 1, cells = 1, roles = {} } = {}) {
  const json = jsonOf(glb);
  const lights = json.extensions?.KHR_lights_punctual?.lights ?? [];
  const found = json.nodes.filter((node) => node.extensions?.KHR_lights_punctual).map((node) => {
    const light = lights[node.extensions.KHR_lights_punctual.light];
    const role = node.extras ? String(node.extras.keys?._role ?? "") : "cell";
    const factor = lamps * (role === "cell" ? cells : ({ ...ROLES, ...roles }[role] ?? 1));
    return { name: node.name, kind: light.type, candela: light.intensity, role, number: node.extras?.number, classname: node.extras?.classname, origin: node.extras?.origin ?? toMap(node.matrix?.slice(12, 15) ?? [0, 0, 0]), factor }; // prettier-ignore
  });
  const materials = (json.materials ?? []).map((material) => ({ name: material.name, set: !!material.normalTexture, roughness: material.pbrMetallicRoughness?.roughnessFactor ?? 1, metallic: material.pbrMetallicRoughness?.metallicFactor ?? 1 })); // prettier-ignore
  return { lamps: found, materials };
}

/** `{{key}}` filled from values; a key with no value is a fault of the pack's, said. */
export const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => { if (!(key in values)) throw new Error(`template: no value for {{${key}}}`); return values[key]; }); // prettier-ignore

/**
 * The project's files for a compiled map. Options: `folders` (the game's, as mapGlb), `sets` (packs/materials'
 * folders, for the lit way), `name`, `start` [x, y, z, yaw?] (the feet; default the map's info_player_start),
 * `shots` [{ name, from, yaw, pitch, fov }], `tonemap` (a key of TONEMAPS), `probe` [x, y, z, sx, sy, sz] (default the
 * world's box), `ambient` and `background` [r, g, b] linear (default the export's, and black), `godot` (its program,
 * for run.bat and run.sh), `size` [w, h] of the window and the shots. The lit way's look: `lamps` (every lamp's
 * energy times this), `cells` (a texture light's cell lamps times this besides), `roles` { name: factor } (the lamps
 * whose entity has `_role` name, over ROLES), `finish` [{ name, tone, roughness? }] (the materials whose name holds
 * `name`: the colour times tone, the roughness set), `ssr` (screen-space reflections), `fog` [density, r, g, b] and
 * its box's [x, y, z, sx, sy, sz] after them for one space only. Returns { files: { name: Buffer | string }, facts }.
 */
export function godotProject(bytes, { folders = [], sets = [], name = null, start = null, shots = [], tonemap = "linear", probe = null, ambient = null, background = [0, 0, 0], godot = "godot", size = [1280, 720], lamps = 1, cells = 1, roles = {}, finish = [], ssr = false, fog = null } = {}) { // prettier-ignore
  if (!TONEMAPS[tonemap]) throw new Error(`tonemap ${tonemap}: one of ${Object.keys(TONEMAPS).join(", ")}`);
  const baked = mapGlb(bytes, { folders });
  const lit = mapGlb(bytes, { folders, light: "lit", sets });
  const json = jsonOf(lit.glb);
  const root = json.nodes[json.scenes[0].nodes[0]];
  const notes = [];
  const bounds = boundsOf(json);
  if (!bounds) throw new Error("the map draws no face of its world: nothing to walk");
  let yaw = 90;
  if (start) yaw = start[3] ?? yaw;
  else {
    const spawn = json.nodes.find((node) => node.extras?.classname === "info_player_start");
    if (!spawn) throw new Error("the map has no info_player_start: say where the feet stand (start: [x, y, z], --start x,y,z)"); // prettier-ignore
    const angles = String(spawn.extras.keys.angles ?? "").split(/\s+/).map(Number);
    yaw = Number.isFinite(angles[1]) ? angles[1] : Number(spawn.extras.keys.angle) || 0;
    start = [spawn.extras.origin[0], spawn.extras.origin[1], spawn.extras.origin[2] - PLAYER.origin];
  }
  const feet = start.slice(0, 3);
  const eye = [feet[0], feet[1], feet[2] + PLAYER.eye];
  if (!ambient && !root.extras?.ambient) notes.push("the map has no compiled light: the lit way's ambient is black (ambient: [r, g, b], --ambient r,g,b)"); // prettier-ignore
  const exported = !ambient && !!root.extras?.ambient;
  ambient ??= root.extras?.ambient ?? [0, 0, 0];
  const boxSize = probe ? probe.slice(3) : bounds.max.map((v, k) => v - bounds.min[k]);
  const middle = probe ? probe.slice(0, 3) : bounds.max.map((v, k) => (v + bounds.min[k]) / 2);
  // the probe looks from the start's eye when that is in its box (the middle of a map's box may be in rock), else from its middle
  const from = eye.every((v, k) => Math.abs(v - middle[k]) < boxSize[k] / 2) && !probe ? eye : middle;
  if (!shots.length) shots = [{ name: "start", from: eye, yaw, pitch: 0, fov: 90 }];
  for (const shot of shots) if (!/^[\w.-]+$/.test(shot.name ?? "") || shot.from?.length !== 3) throw new Error(`a shot is { name (letters, digits, - _ .), from: [x, y, z], yaw, pitch, fov }: ${JSON.stringify(shot)}`); // prettier-ignore
  if (fog && ![4, 10].includes(fog.length)) throw new Error(`fog is [density, r, g, b] and, for one space, its box's [x, y, z, sx, sy, sz] after them: ${JSON.stringify(fog)}`); // prettier-ignore
  for (const each of finish) if (!each.name || !(each.tone >= 0)) throw new Error(`a finish is { name (a part of a material's), tone (its colour times this), roughness? }: ${JSON.stringify(each)}`); // prettier-ignore
  roles = { ...ROLES, ...roles };
  const reach = reachOf(lit.glb, { lamps, cells, roles });
  const count = (role) => reach.lamps.filter((lamp) => lamp.role === role).length;
  const on = reach.lamps.filter((lamp) => lamp.factor > 0).length;
  const said = [...new Set(reach.lamps.map((lamp) => lamp.role))].filter((role) => role && role !== "cell");
  for (const role of Object.keys(roles)) if (!(role in ROLES) && !count(role)) notes.push(`WARN: role ${role}: no light of the map has _role ${role} (${said.length ? `the map's: ${said.join(", ")}` : "none of its lights has a _role key"}): nothing is scaled by it`); // prettier-ignore
  for (const each of finish) if (!reach.materials.some((material) => material.name.includes(each.name))) notes.push(`WARN: finish ${each.name}: no material of the lit file has ${each.name} in its name: nothing is changed by it (the names: node packs/godot/bin.mjs list)`); // prettier-ignore
  if (exported && Math.max(...ambient) < DARK_AMBIENT) notes.push(`the lit way's ambient is as good as black (${ambient.join(" ")}): a place lit in pools, where a wall no lamp reaches is black; the lamps' bounce is not in the lit way: lift it if the walls are lost (--ambient r,g,b; a dark district took 0.03,0.04,0.055)`); // prettier-ignore
  if (on > ATLAS_SHADOWS) notes.push(`WARN: ${on} lamps in the lit way: Godot's default shadow atlas (${ATLAS_SHADOWS} in its largest quadrant) gives a shadow to some of them only, and a lamp with none shines through walls; raise rendering/lights_and_shadows/positional_shadow/atlas_* in project.godot, or turn lamps off in own.gd`); // prettier-ignore
  const values = {
    name: name ?? root.name ?? "A map",
    title: `SMAK ${name ?? root.name ?? "map"}`.replace(/["\\\r\n]/g, " "),
    start: list(feet),
    yaw: num(yaw),
    ambient: list(ambient),
    background: list(background),
    tonemap: TONEMAPS[tonemap],
    probeAt: list(middle),
    probeSize: list(boxSize),
    probeFrom: list(from),
    shots: shots.map((shot) => `["${shot.name}", Vector3(${list(shot.from)}), ${num(shot.yaw ?? 0)}, ${num(shot.pitch ?? 0)}, ${num(shot.fov ?? 90)}]`).join(", "), // prettier-ignore
    godot,
    width: num(size[0]),
    height: num(size[1]),
    lamps: num(lamps),
    cells: num(cells),
    roles: `{${Object.entries(roles).map(([role, factor]) => `${JSON.stringify(role)}: ${num(factor)}`).join(", ")}}`,
    finish: finish.map((each) => `[${JSON.stringify(each.name)}, ${num(each.tone)}, ${num(each.roughness ?? -1)}]`).join(", "),
    ssr: String(!!ssr),
    fog: list([...(fog ?? []), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 10)),
  };
  values.name = values.name.replace(/[\r\n]/g, " ");
  const files = { "baked.glb": baked.glb, "lit.glb": lit.glb };
  for (const file of TEMPLATES) {
    const text = fill(readFileSync(new URL(`./template/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"), values);
    files[file] = file.endsWith(".bat") ? text.replace(/\n/g, "\r\n") : text;
  }
  const facts = { baked: baked.facts, lit: lit.facts, start: feet, yaw, eye, ambient, background, tonemap, bounds, probe: { middle, size: boxSize, from }, shots, size, reach, lamps: { on, cells: count("cell"), roles: Object.fromEntries(Object.keys(roles).map((role) => [role, count(role)])) }, notes: [...new Set([...baked.facts.notes, ...lit.facts.notes, ...notes])] }; // prettier-ignore
  return { files, facts };
}

/** Writes the project into `folder`; own.gd and anything else there is left. Returns what it wrote and whether an old import was removed. */
export function writeProject(folder, made) {
  mkdirSync(folder, { recursive: true });
  const same = (file) => existsSync(join(folder, file)) && Buffer.compare(readFileSync(join(folder, file)), made.files[file]) === 0;
  // Godot runs what it imported: a .glb that changed is read again only when its old import is gone
  const stale = existsSync(join(folder, ".godot")) && !(same("baked.glb") && same("lit.glb"));
  if (stale) rmSync(join(folder, ".godot"), { recursive: true, force: true });
  for (const [file, content] of Object.entries(made.files)) writeFileSync(join(folder, file), content, file === "run.sh" ? { mode: 0o755 } : {}); // prettier-ignore
  return { written: Object.keys(made.files), stale };
}

/**
 * Takes the shots of a written project: Godot imports it when it has no .godot folder, then runs it with --shots.
 * `godot`: its program (default the GODOT variable, else the one run.bat was written with). `size` [w, h] for this
 * run only; `timeout` seconds for each of the two. Returns { files: the pictures written, said: Godot's ERROR and
 * WARNING lines but its leak at exit }.
 */
export function takeShots(folder, { godot = null, size = null, timeout = 900, run = spawnSync } = {}) {
  const read = (file) => (existsSync(join(folder, file)) ? readFileSync(join(folder, file), "utf8") : "");
  const names = [...(read("main.gd").match(/^const SHOTS := .*$/m)?.[0] ?? "").matchAll(/\["([\w.-]+)", Vector3/g)].map((found) => found[1]);
  if (!names.length) throw new Error(`${folder} is not a project with shots (no SHOTS in its main.gd): write it first (node packs/godot/bin.mjs project)`); // prettier-ignore
  godot ??= process.env.GODOT ?? read("run.bat").match(/set "GODOT=([^"]*)"/)?.[1] ?? "godot";
  const files = names.flatMap((name) => ["baked", "lit"].map((way) => resolve(folder, `shot-${name}-${way}.png`)));
  for (const file of files) rmSync(file, { force: true }); // a picture of an earlier run is not this run's
  let late = false;
  const call = (args) => {
    const ran = run(godot, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28, timeout: timeout * 1000 });
    if (ran.error?.code === "ENOENT") throw new Error(`Godot is not at "${godot}": say its program (--godot <program>, or the GODOT variable)`); // prettier-ignore
    late ||= ran.error?.code === "ETIMEDOUT";
    return `${ran.stdout ?? ""}
${ran.stderr ?? ""}`;
  };
  if (!existsSync(join(folder, ".godot"))) call(["--headless", "--path", resolve(folder), "--import"]);
  const log = call(["--path", resolve(folder), ...(size ? ["--resolution", size.join("x")] : []), "--", "--shots"]);
  const said = log.split(/\r?\n/).filter((line) => /^\s*(SCRIPT ERROR|ERROR|WARNING):/.test(line) && !/RIDs of type .* were leaked/.test(line)).map((line) => line.trim()); // prettier-ignore
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length) throw new Error(`${late ? `Godot did not end in ${timeout} s (a script that does not load leaves its window open) and` : "Godot"} wrote ${files.length - missing.length} of ${files.length} pictures (not ${missing[0]})${said.length ? `; it said: ${said.slice(0, 6).join(" | ")}` : ""}`); // prettier-ignore
  return { files, said };
}
