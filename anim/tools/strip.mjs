// A first-person sequence drawn so that a blow can be judged: from the eye, every n-th frame with the tip's
// trail, and from beside and above with the target at range.
//
//   node anims/tools/strip.mjs <mdl> <sequence> [--submodel group=index ...] [--hit frame] [--range 60]
//        [--radius 16] [--every n] [--fov 90] [--aspect 4:3] [--near 4] [--width 400] [--cols 4] [--out dir]
//
// Writes <out>/eye.png and <out>/plans.png; out is build/anims/<model>/<sequence>/ unless told. Without
// --hit, the hit is the frame the tip comes nearest the contact point in.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { png } from "../../src/image.mjs";
import { camera, bodyFor, weaponOf, track, eyeStrip, plans } from "../lib/view.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
const loose = [];
const opts = { submodel: {} };
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) {
    loose.push(args[i]);
    continue;
  }
  const key = args[i].slice(2);
  const value = args[++i];
  if (value === undefined) throw new Error(`--${key} wants a value`);
  if (key === "submodel") {
    const [group, index] = value.split("=");
    opts.submodel[group] = Number(index);
  } else opts[key] = key === "aspect" || key === "out" ? value : Number(value);
}
const [file, seq] = loose;
if (!file || !seq) {
  console.error("node anims/tools/strip.mjs <mdl> <sequence> [--submodel group=index] [--hit frame] [--range 60] [--every n] [--out dir]");
  process.exit(1);
}

const src = readFileSync(file);
const body = bodyFor(src, opts.submodel);
const cam = camera({ fov: opts.fov, aspect: opts.aspect, width: opts.width, near: opts.near });
const weapon = weaponOf(src, { body });
const tracked = track(src, seq, { body, weapon });
const shared = { body, cam, tracked, hit: opts.hit, range: opts.range, radius: opts.radius };

const out = opts.out ?? join(ROOT, "build", "anim", basename(file, ".mdl"), tracked.seq.name);
mkdirSync(out, { recursive: true });
const eye = eyeStrip(src, seq, { ...shared, every: opts.every, cols: opts.cols });
writeFileSync(join(out, "eye.png"), png(eye.picture.width, eye.picture.height, eye.picture.rgba));
const side = plans(src, seq, shared);
writeFileSync(join(out, "plans.png"), png(side.picture.width, side.picture.height, side.picture.rgba));

const r = side.reach;
const n = (v) => v.toFixed(1);
console.log(
  [
    `${basename(file)} ${tracked.seq.name}: ${tracked.frames.length} frames at ${tracked.seq.fps} fps (${n(tracked.frames.length / tracked.seq.fps)} s), body ${body}`,
    `camera: ${n(cam.hfov)} x ${n(cam.vfov)} degrees, ${cam.width} x ${cam.height}, near ${cam.near}`,
    `weapon: ${weapon.name} on ${weapon.holdName}, hand ${weapon.handName}, tip ${n(weapon.length)} from the hand`,
    `hit frame ${r.hit} (${n(tracked.frames[r.hit].time)} s${opts.hit === undefined ? ", nearest the contact point" : ""}; fastest tip ${tracked.fastest}): tip ${n(r.ahead)} ahead, ${n(r.right)} right, ${n(r.up)} up; ${n(r.miss)} from the contact point at ${opts.range ?? 60}`,
    `nearest the contact point: frame ${r.nearest}, ${n(r.nearestMiss)}; farthest ahead ${n(r.farthest)}`,
    `wrote ${join(out, "eye.png")} and plans.png (frames ${eye.frames.join(" ")})`,
  ].join("\n"),
);
