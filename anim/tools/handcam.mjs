// A hand up close: the model's own mesh drawn about one hand, frame by frame and from several sides, to see how the
// fingers sit on the handle (through it, short of it, closed round it). No reference game's art is drawn: the
// fingers are judged by measures (judge.mjs's fingers.*), and this shows our own hand as it is.
//
//   node anim/tools/handcam.mjs <mdl> <seq> [--side R|L] [--frames 0,12,24] [--yaws 0,90,180,270] [--pitch 15]
//        [--dist 22] [--size 220] [--out <png>]
//        a sheet of pictures, a row a frame and a column a side, the camera --dist units from the hand's wrist
//        (the striking hand's unless --side), into build/anim/handcam/<model>-<seq>-<side>.png unless --out.
//        The frames are five spread over the sequence unless told.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { png } from "../../src/image.mjs";
import { render, tile } from "../../src/render.mjs";
import { asModel } from "../lib/model.mjs";
import { armBones, weaponOf, viewModel } from "../lib/corpus.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const loose = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) loose.push(args[i]);
  else opts[args[i].slice(2)] = args[++i];
}
const [file, seqName] = loose;
if (!file || !seqName) {
  console.log("node anim/tools/handcam.mjs <mdl> <seq> [--side R|L] [--frames 0,12,24] [--yaws 0,90,180,270] [--pitch 15] [--dist 22] [--size 220] [--out <png>]");
  process.exit(1);
}
const buf = viewModel(file);
const M = asModel(buf);
const seq = M.sequenceAt(seqName);
if (seq < 0 || !M.sequences[seq]) throw new Error(`no sequence ${seqName}`);
const arms = armBones(buf);
const side = opts.side ?? weaponOf(buf, { arms }).hand ?? "R";
const hand = arms[side]?.hand;
if (hand === undefined) throw new Error(`no ${side} hand`);
const n = M.sequences[seq].frames;
const frames = opts.frames ? opts.frames.split(",").map(Number) : [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(k * (n - 1)));
const yaws = (opts.yaws ?? "0,90,180,270").split(",").map(Number);
const pitch = Number(opts.pitch ?? 15);
const dist = Number(opts.dist ?? 22);
const size = Number(opts.size ?? 220);
const pictures = [];
const names = [];
for (const f of frames) {
  const m = M.pose(seq, f)[hand];
  const target = [m[0][3], m[1][3], m[2][3]];
  for (const yaw of yaws) {
    pictures.push(render(buf, { view: "orbit", seq, frame: f, target, dist, yaw, pitch, fov: 50, width: size, height: size }));
    names.push(`${f} yaw ${yaw}`);
  }
}
const sheet = tile(pictures, yaws.length, names);
const out = opts.out ?? join(ROOT, "build/anim/handcam", `${basename(file, ".mdl")}-${M.sequences[seq].name}-${side}.png`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png(sheet.width, sheet.height, sheet.rgba));
console.log(out);
