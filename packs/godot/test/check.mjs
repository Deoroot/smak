// A project folder read back with no Godot: is every file there, are the two .glb glTF, is main.gd whole (every
// value filled in, indented with tabs as GDScript wants), and what the values are, as numbers:
//
//   checkProject(folder)   { errors: [sentence], values: { START, START_YAW, AMBIENT, BACKGROUND, TONEMAP, PROBE_AT,
//                            PROBE_SIZE, PROBE_FROM, SHOTS: [{ name, from, yaw, pitch, fov }], LAMPS, CELLS,
//                            ROLES: { role: factor }, FINISH: [[name, tone, roughness]], SSR, FOG: [10 numbers],
//                            SIZE: [w, h] (project.godot's) } }
//
// It says nothing of what Godot draws: that is the `shots` command and looking at the pictures (docs/GODOT.md).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FILES = ["baked.glb", "lit.glb", "project.godot", "main.tscn", "main.gd", "run.bat", "run.sh"];
const VALUES = ["START", "START_YAW", "AMBIENT", "BACKGROUND", "TONEMAP", "PROBE_AT", "PROBE_SIZE", "PROBE_FROM", "SHOTS"];
const LOOK = ["LAMPS", "CELLS", "ROLES", "FINISH", "SSR", "FOG"]; // the lit way's look: each a value JSON reads
const numbers = (text) => (text.replace(/^\w+\(/, "").match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

export function checkProject(folder) {
  const errors = [];
  const values = {};
  for (const file of FILES) if (!existsSync(join(folder, file))) errors.push(`${file} is not in ${folder}: write the project again (node packs/godot/bin.mjs project)`); // prettier-ignore
  if (errors.length) return { errors, values };
  for (const file of FILES.slice(0, 2)) {
    const glb = readFileSync(join(folder, file));
    if (glb.length < 20 || glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(8) !== glb.length) errors.push(`${file} is not a whole .glb (${glb.length} bytes): write the project again`); // prettier-ignore
  }
  const text = Object.fromEntries(FILES.slice(2).map((file) => [file, readFileSync(join(folder, file), "utf8")]));
  for (const [file, body] of Object.entries(text)) {
    const left = body.match(/\{\{\w+\}\}/);
    if (left) errors.push(`${file}: ${left[0]} was not filled in`);
  }
  if (!/^run\/main_scene="res:\/\/main\.tscn"$/m.test(text["project.godot"])) errors.push("project.godot does not start res://main.tscn"); // prettier-ignore
  if (!/path="res:\/\/main\.gd"/.test(text["main.tscn"])) errors.push("main.tscn does not run res://main.gd");
  const spaced = text["main.gd"].split("\n").findIndex((line) => /^\t* +\S/.test(line));
  if (spaced >= 0) errors.push(`main.gd line ${spaced + 1} is indented with spaces: GDScript refuses tabs and spaces mixed`);
  for (const name of VALUES) {
    const found = text["main.gd"].match(new RegExp(`^const ${name} := (.*?)(\\s+#.*)?$`, "m"));
    if (!found) errors.push(`main.gd has no const ${name}: the walker's values are gone`);
    else if (name === "TONEMAP") values[name] = found[1].replace("Environment.", "");
    else if (name === "SHOTS") values[name] = [...found[1].matchAll(/\["([^"]+)", Vector3\(([^)]*)\), ([^\]]*)\]/g)].map(([, shot, from, rest]) => ({ name: shot, from: numbers(from), yaw: numbers(rest)[0], pitch: numbers(rest)[1], fov: numbers(rest)[2] })); // prettier-ignore
    else values[name] = name === "START_YAW" ? numbers(found[1])[0] : numbers(found[1]);
    const wants = { START: 3, AMBIENT: 3, BACKGROUND: 3, PROBE_AT: 3, PROBE_SIZE: 3, PROBE_FROM: 3 }[name];
    if (found && wants && values[name].length !== wants) errors.push(`main.gd: const ${name} is ${found[1]}, not ${wants} numbers`);
  }
  for (const name of LOOK) {
    const found = text["main.gd"].match(new RegExp(`^const ${name} := (.*)$`, "m"));
    try {
      values[name] = JSON.parse(found[1]);
    } catch {
      errors.push(`main.gd has no const ${name} that reads: the lit way's look is gone`);
    }
  }
  values.SIZE = ["width", "height"].map((side) => Number(text["project.godot"].match(new RegExp(`^window/size/viewport_${side}=(\\d+)$`, "m"))?.[1])); // prettier-ignore
  if (!values.SIZE.every((v) => v > 0)) errors.push("project.godot has no window size: the shots would be Godot's default");
  if (values.SHOTS && !values.SHOTS.length) errors.push("main.gd: SHOTS has no camera: --shots would write no picture");
  if (values.PROBE_SIZE?.some((v) => !(v > 0))) errors.push(`main.gd: the probe's box is ${values.PROBE_SIZE.join(" ")}: a size of nothing reflects nothing`); // prettier-ignore
  return { errors, values };
}
