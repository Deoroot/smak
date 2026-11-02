// Pictures of Vermintide 2 blows from the local cache (anim/lib/vt2.mjs): the arms as sticks, the weapon's mesh as
// points, the tip the judge follows (red) and the butt (blue), from the side (ahead to the right, up) and from
// above (ahead up, left to the left), frame by frame. For looking at what the numbers say. Local only: the
// pictures go to build/anim/vt2/ (not committed).
//
//   node anim/tools/vt2view.mjs <template> [<event>] [--frames 0,10,20 | --every 4] [--idle]
//
// <template> is a weapon template's name or part of it ("two_handed_axes_template_2"); <event> one of its attack
// events (all of them unless told). --idle draws the idle's first frame only.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { png } from "../../src/image.mjs";
import { vt2Blows, VT2_CACHE } from "../lib/vt2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const loose = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--idle"].includes(args[i - 1])));
const flag = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const [want, event] = loose;
if (!want) {
  console.error("node anim/tools/vt2view.mjs <template> [<event>] [--frames a,b,c | --every n] [--idle]");
  process.exit(1);
}
const weapons = JSON.parse(readFileSync(VT2_CACHE + "weapons.json", "utf8"));

const W = 360; // one view's side, pixels
const ap = (m, p) => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]);
const at = (m) => [m[0][3], m[1][3], m[2][3]];

function picture(model, seq, frames, wpn, opts) {
  const views = [
    { name: "side", u: (p) => p[0], v: (p) => p[2] }, // ahead right, up
    { name: "top", u: (p) => -p[1], v: (p) => p[0] }, // left to the left (+y left: -y right), ahead up
  ];
  const cols = frames.length;
  const width = W * cols;
  const height = W * views.length;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([18, 18, 22, 255], i * 4);
  const dot = (x, y, rgb, r = 1) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const X = Math.round(x + dx);
        const Y = Math.round(y + dy);
        if (X >= 0 && Y >= 0 && X < width && Y < height) rgba.set([...rgb, 255], (Y * width + X) * 4);
      }
  };
  const line = (a, b, rgb) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
    for (let i = 0; i <= n; i++) dot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, rgb, 0);
  };
  const B = (n) => model.bones.findIndex((b) => b.name === n);
  const attach = B(opts.weapon.boneName);
  const S = W / 2.2; // pixels a metre: 2.2 m across a view
  frames.forEach((f, c) => {
    const P = model.pose(seq, f);
    views.forEach((view, r) => {
      const ox = c * W + W * (view.name === "side" ? 0.25 : 0.5);
      const oy = r * W + W * (view.name === "side" ? 0.55 : 0.8);
      const to = (p) => [ox + view.u(p) * S, oy - (view.v(p) - (view.name === "side" ? 1 : 0)) * S];
      // the eye, and the view's frame
      dot(...to([0, 0, 1]), [255, 255, 255], 2);
      for (const p of wpn.points ?? []) dot(...to(ap(P[attach], p)), [170, 170, 170], 1);
      for (const side of ["right", "left"]) {
        const chain = ["arm", "forearm", "hand"].map((x) => at(P[B(`j_${side}${x}`)]));
        const rgb = side === "right" ? [120, 220, 120] : [220, 200, 90];
        line(to(chain[0]), to(chain[1]), rgb);
        line(to(chain[1]), to(chain[2]), rgb);
        dot(...to(chain[2]), rgb, 2);
      }
      dot(...to(ap(P[attach], opts.weapon.butt.p)), [80, 140, 255], 3);
      dot(...to(ap(P[attach], opts.weapon.tip.p)), [255, 70, 70], 3);
    });
  });
  return { width, height, rgba };
}

let drawn = 0;
for (const b of vt2Blows()) {
  if (!b.info.template.includes(want) || (event && b.seq !== event)) continue;
  const wpn = weapons[b.info.template]?.[b.opts.hand === "L" ? "left" : "right"] ?? {};
  const n = b.model.sequences[0].frames;
  let seq = 0;
  let frames;
  if (args.includes("--idle")) [seq, frames] = [1, [0]];
  else if (flag("--frames")) frames = flag("--frames").split(",").map(Number).filter((f) => f < n);
  else {
    const every = Number(flag("--every") ?? Math.max(1, Math.round(n / 8)));
    frames = [];
    for (let f = 0; f < n; f += every) frames.push(f);
  }
  const img = picture(b.model, seq, frames, wpn, b.opts);
  const out = join(ROOT, "build", "anim", "vt2", b.info.template);
  mkdirSync(out, { recursive: true });
  const file = join(out, `${args.includes("--idle") ? "idle" : b.seq}.png`);
  writeFileSync(file, png(img.width, img.height, img.rgba));
  console.log(`${file}  (${b.info.unit.split("/").pop()}${b.info.turned ? ", turned" : ""}; frames ${frames.join(" ")})`);
  if (++drawn >= 12 || args.includes("--idle")) break;
}
if (!drawn) console.log(`no blow of a template matching "${want}"${event ? ` with event ${event}` : ""}`);
