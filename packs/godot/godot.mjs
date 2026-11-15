// packs/godot: a ready-to-walk Godot 4 project for a compiled map (README.md, docs/GODOT.md).
//
//   godotProject(bytes, options)   the files of the project: packs/gltf's two ways of the map (baked.glb, lit.glb) and
//                                  project.godot, main.tscn, main.gd, run.bat, run.sh from template/, the map's values
//                                  filled in: the start, the lit way's ambient and the probe's box read from the lit file
//   writeProject(folder, made)     writes them; an old import of other .glb (the .godot folder) is removed
//
// The walker is template/main.gd, the same for every map but the constants under "filled in". What is a map's own
// (a finish by a texture's name, a lift, a lamp dimmed) is the author's own.gd in the folder, which nothing here writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mapGlb } from "../gltf/gltf.mjs";

const UNITS_A_METRE = 39.37;
/** The player, in the map's units: the start entity's origin is this far over the feet, the eye this far. */
export const PLAYER = { origin: 36, eye: 64 };
export const TONEMAPS = { linear: "TONE_MAPPER_LINEAR", filmic: "TONE_MAPPER_FILMIC", aces: "TONE_MAPPER_ACES" };
/** Godot's default positional shadow atlas holds 64 shadows in its largest quadrant (a room of 82 lamps was seen with shadows on some only). */
export const ATLAS_SHADOWS = 64;
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

/** `{{key}}` filled from values; a key with no value is a fault of the pack's, said. */
export const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => { if (!(key in values)) throw new Error(`template: no value for {{${key}}}`); return values[key]; }); // prettier-ignore

/**
 * The project's files for a compiled map. Options: `folders` (the game's, as mapGlb), `sets` (packs/materials'
 * folders, for the lit way), `name`, `start` [x, y, z, yaw?] (the feet; default the map's info_player_start),
 * `shots` [{ name, from, yaw, pitch, fov }], `tonemap` (a key of TONEMAPS), `probe` [x, y, z, sx, sy, sz] (default the
 * world's box), `ambient` and `background` [r, g, b] linear (default the export's, and black), `godot` (its program,
 * for run.bat and run.sh). Returns { files: { name: Buffer | string }, facts }.
 */
export function godotProject(bytes, { folders = [], sets = [], name = null, start = null, shots = [], tonemap = "linear", probe = null, ambient = null, background = [0, 0, 0], godot = "godot" } = {}) { // prettier-ignore
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
  ambient ??= root.extras?.ambient ?? [0, 0, 0];
  const size = probe ? probe.slice(3) : bounds.max.map((v, k) => v - bounds.min[k]);
  const middle = probe ? probe.slice(0, 3) : bounds.max.map((v, k) => (v + bounds.min[k]) / 2);
  // the probe looks from the start's eye when that is in its box (the middle of a map's box may be in rock), else from its middle
  const from = eye.every((v, k) => Math.abs(v - middle[k]) < size[k] / 2) && !probe ? eye : middle;
  if (!shots.length) shots = [{ name: "start", from: eye, yaw, pitch: 0, fov: 90 }];
  for (const shot of shots) if (!/^[\w.-]+$/.test(shot.name ?? "") || shot.from?.length !== 3) throw new Error(`a shot is { name (letters, digits, - _ .), from: [x, y, z], yaw, pitch, fov }: ${JSON.stringify(shot)}`); // prettier-ignore
  if (lit.facts.lights > ATLAS_SHADOWS) notes.push(`WARN: ${lit.facts.lights} lamps in the lit way: Godot's default shadow atlas (${ATLAS_SHADOWS} in its largest quadrant) gives a shadow to some of them only, and a lamp with none shines through walls; raise rendering/lights_and_shadows/positional_shadow/atlas_* in project.godot, or turn lamps off in own.gd`); // prettier-ignore
  const values = {
    name: name ?? root.name ?? "A map",
    title: `SMAK ${name ?? root.name ?? "map"}`.replace(/["\\\r\n]/g, " "),
    start: list(feet),
    yaw: num(yaw),
    ambient: list(ambient),
    background: list(background),
    tonemap: TONEMAPS[tonemap],
    probeAt: list(middle),
    probeSize: list(size),
    probeFrom: list(from),
    shots: shots.map((shot) => `["${shot.name}", Vector3(${list(shot.from)}), ${num(shot.yaw ?? 0)}, ${num(shot.pitch ?? 0)}, ${num(shot.fov ?? 90)}]`).join(", "), // prettier-ignore
    godot,
  };
  values.name = values.name.replace(/[\r\n]/g, " ");
  const files = { "baked.glb": baked.glb, "lit.glb": lit.glb };
  for (const file of TEMPLATES) {
    const text = fill(readFileSync(new URL(`./template/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"), values);
    files[file] = file.endsWith(".bat") ? text.replace(/\n/g, "\r\n") : text;
  }
  const facts = { baked: baked.facts, lit: lit.facts, start: feet, yaw, eye, ambient, background, tonemap, bounds, probe: { middle, size, from }, shots, notes: [...new Set([...baked.facts.notes, ...lit.facts.notes, ...notes])] }; // prettier-ignore
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
