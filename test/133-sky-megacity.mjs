// New Byzantium's rendered sky (levels/tools/sky.mjs, levels/lib/sky-megacity.mjs): the tool's arguments and
// their refusals, the six faces named as GoldSrc names them and turned as the engine's table turns them (each
// camera's three ways from `wayOfSide`, square and right-handed), the seam check passing a sky with no seam and
// catching a face turned a quarter, the contact sheet and panorama's sizes; and, where Blender is found, a tiny
// render end to end: 18 Targa files, a cross, a panorama, sky.json, no seam. Without Blender it is said to be skipped.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, sure, tmp } from "./helper.mjs";
import { findBlender } from "../src/blender.mjs";
import { makeSky, wayOfSide, readTga, SKY_SIDES } from "../src/maps/sky.mjs";
import { parseSkyArgs, SKY_FACES, skyFileNames, seamCheck, crossSheet, panorama, renderSky } from "../levels/lib/sky-megacity.mjs";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

test("sky's arguments: defaults, --quick, and each wrong one refused by its sentence", () => {
  const { options } = parseSkyArgs(["--out", "x"]);
  sure(options.render === 1024 && options.ship.join() === "1024,512,256" && options.name === "nbstorm" && options.seed === 1, JSON.stringify(options));
  const quick = parseSkyArgs(["--out", "x", "--quick"]).options;
  sure(quick.render === 256 && quick.samples === 8 && quick.ship.join() === "256", JSON.stringify(quick));
  const given = parseSkyArgs(["--out", "x", "--seed", "7", "--render", "512", "--ship", "512,256", "--name", "h9storm", "--eye", "30"]).options;
  sure(given.seed === 7 && given.render === 512 && given.ship.join() === "512,256" && given.name === "h9storm" && given.eye === 30, JSON.stringify(given));
  for (const [argv, said] of [
    [[], /--out <folder> is needed/],
    [["--out", "x", "--render", "1000"], /a power of two/],
    [["--out", "x", "--ship", "2048"], /no larger than --render/],
    [["--out", "x", "--name", "far-too-long-name"], /skyname/],
    [["--out", "x", "--seed", "1.5"], /a whole number/],
    [["--out", "x", "--size", "3"], /not an option/],
    [["--out", "x", "--seed"], /needs a value/],
    [["--out", "x", "--samples", "lots"], /takes a number/],
  ]) {
    const { error } = parseSkyArgs(argv);
    sure(error && said.test(error), `${argv.join(" ")}: ${error}`);
  }
});

test("the faces: GoldSrc's names, the engine's table, each camera square and right-handed", () => {
  sure(SKY_FACES.map((f) => f.suffix).join() === "rt,lf,bk,ft,up,dn", SKY_FACES.map((f) => f.suffix).join());
  const names = skyFileNames("nbstorm", [512, 256]);
  sure(names[512].join() === SKY_SIDES.map((s) => `512/nbstorm${s}.tga`).join() && names[256][4] === "256/nbstormup.tga", JSON.stringify(names));
  // the engine's orientation: rt looks along +x, lf -x, bk +y, ft -y, up +z, dn -z
  const looks = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; // prettier-ignore
  SKY_FACES.forEach((f, k) => {
    sure(f.forward.join() === looks[k].join(), `${f.suffix} looks along ${f.forward}`);
    sure(dot(f.forward, f.right) === 0 && dot(f.forward, f.up) === 0 && dot(f.right, f.up) === 0, `${f.suffix}'s ways are square`);
    // a camera with x to the right and y up looks along -z: right x up = -forward
    sure(cross(f.right, f.up).join() === f.forward.map((v) => -v || 0).join(), `${f.suffix}: right x up = ${cross(f.right, f.up)}`);
    // the picture's top right corner is the way the table gives for (1, 1)
    const corner = f.forward.map((v, i) => v + f.right[i] + f.up[i]);
    sure(corner.join() === wayOfSide(k, 1, 1).join(), `${f.suffix}'s corner ${corner} against ${wayOfSide(k, 1, 1)}`);
  });
  // the four upright faces turn right in the order rt, ft, lf, bk: each one's right edge is the next one's left
  const ring = ["rt", "ft", "lf", "bk"].map((s) => SKY_FACES.find((f) => f.suffix === s));
  ring.forEach((f, k) => {
    const next = ring[(k + 1) % 4];
    sure(f.right.join() === next.forward.join(), `${f.suffix}'s right is ${f.right}, ${next.suffix} looks along ${next.forward}`);
  });
});

test("the seam check: a sky with no seam passes, a face turned a quarter is caught", () => {
  const { sides } = makeSky({ size: 64, hills: { height: 8 }, clouds: { cover: 0.7 } });
  const good = seamCheck(sides);
  sure(good.ok && good.edges.length === 12, `ratio ${good.ratio.toFixed(2)}: ${good.edges.map((e) => `${e.edge} ${e.across.toFixed(1)}/${e.beside.toFixed(1)}`).join(", ")}`);
  // rt turned a quarter: its horizon stands upright
  const s = 64;
  const turned = sides.map((side) => ({ ...side, rgb: Uint8Array.from(side.rgb) }));
  for (let row = 0; row < s; row++)
    for (let col = 0; col < s; col++) turned[0].rgb.set(sides[0].rgb.subarray((col * s + (s - 1 - row)) * 3, (col * s + (s - 1 - row)) * 3 + 3), (row * s + col) * 3);
  const bad = seamCheck(turned);
  sure(!bad.ok && bad.ratio > good.ratio * 2, `turned: ratio ${bad.ratio.toFixed(2)} against ${good.ratio.toFixed(2)}`);
  const sheet = crossSheet(sides);
  const pano = panorama(sides, 128);
  sure(sheet.width === 4 * s && sheet.height === 3 * s && pano.width === 128 && pano.height === 64, `${sheet.width}x${sheet.height}, ${pano.width}x${pano.height}`);
});

const blender = findBlender();
const name = "a tiny megacity rendered in Blender: 18 Targa sides of three sizes, a cross, a panorama, its seams near its own pixels";
if (!blender) console.log(`skip  ${name}\n      skipped: no Blender (set SMAK_BLENDER to its program to run it)`);
else
  test(name, () => {
    const out = join(tmp, "sky-megacity");
    const { options } = parseSkyArgs(["--out", out, "--render", "64", "--ship", "64,32,16", "--samples", "2", "--density", "0.05", "--name", "t"]);
    const report = renderSky(options);
    sure(report.files.length === 18 && report.files.every(existsSync), report.files.join(", "));
    const side = readTga(readFileSync(join(out, "16", "tdn.tga")));
    sure(side.width === 16 && side.height === 16, `${side.width}x${side.height}`);
    sure(existsSync(report.cross) && existsSync(report.panorama) && existsSync(join(out, "sky.json")), "the cross, the panorama and sky.json");
    sure(report.city.towers > 0 && report.seams.edges.length === 12, JSON.stringify(report.city));
    // at 64 pixels and 2 samples a tower's edge on a seam weighs much: a turned face gives many times more
    sure(report.seams.ratio < 2.5, `seams: ratio ${report.seams.ratio.toFixed(2)}`);
  });
