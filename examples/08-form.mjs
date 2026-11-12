// Example 8: the same things the old way (boxes) and the new way (a profile), measured and drawn. A park bench, a
// lamp post and a tram car as models; a bench and a cornice as map brushes. It needs no game files:
//
//   node examples/08-form.mjs [output folder, default out]
//
// It writes, for each model, <name>-boxes.mdl and <name>-profile.mdl with their sheets (<name>-boxes.png ...), the
// two maps' brushes drawn from above and from the side (map-profile.png), and prints the form of each: the share
// of the surface on the axes, of the creases that are bare 80-degree edges, the silhouette's corners, the boxiness.
//
// The rule it shows (AGENTS.md, "Rules"): no bare box for anything a player looks at. Start a form from a
// reference (a photo, a section, a silhouette) and compare the picture with that; chamfer the edges people look
// at; give a long thing a profile and sweep it; a vehicle or a curved prop is a model, not brushes.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildMdl, check, sheet, png, solids as S, formOfMdl, formOfBrushes, judgeForm, kindOfName, maps } from "../src/index.mjs";

const OUT = process.argv[2] ?? "out";
mkdirSync(OUT, { recursive: true });

// ── a model from triangles: one bone, one flat-coloured texture, planar texture coordinates ──
const flat = (name, rgb) => {
  const palette = new Uint8Array(768);
  palette.set(rgb, 3);
  return { name, width: 16, height: 16, pixels: new Uint8Array(256).fill(1), palette, flags: 0 };
};
function modelOf(name, tris) {
  const pts = tris.flat().map((c) => c.p);
  const lo = [0, 1, 2].map((a) => Math.min(...pts.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])));
  const corners = tris.map((tri) =>
    tri.map(({ p }) => ({ p, uv: [((p[0] - lo[0]) / (hi[0] - lo[0] || 1)) * 15, ((p[1] - lo[1]) / (hi[1] - lo[1] || 1)) * 15], bone: "root" })),
  );
  return buildMdl({
    name: `${name}.mdl`,
    bones: [{ name: "root", parent: -1, pos: [0, 0, 0] }],
    bodyparts: [{ name: "body", models: [{ name, meshes: [{ tris: corners, texture: flat(`${name}.bmp`, [150, 140, 120]) }] }] }],
    sequences: [{ name: "idle", fps: 10, loops: true, frames: [[[0, 0, 0, 0, 0, 0]]] }],
  });
}
const FLOOR = S.place([0, 0, 0], [0, 0, 1], [1, 0, 0]);
const at = (x, y, z) => S.place([x, y, z], [0, 0, 1], [1, 0, 0]);
const boxAt = (c, sx, sy, sz, o) => S.trisOf(S.box(at(...c), sx, sy, sz, o));

// ── a park bench, 60 long, 22 deep, 32 tall ──
const benchBoxes = [
  boxAt([0, 0, 17], 60, 18, 2), // seat
  boxAt([0, -9, 26], 60, 2, 14), // back
  ...[-26, 26].flatMap((x) => [boxAt([x, 0, 8], 3, 18, 16), boxAt([x, -9, 22], 3, 3, 12)]),
].flat();
// the new way: end frames cut from a profile (a cast side with a curved back and a scrolled foot), swept across;
// the seat and back are slats with their edges chamfered
const side = [[-9, 0], [-6, 0], [-5, 9], [9, 12], [9, 17], [-7, 17], [-9, 26], [-11, 30], [-9, 32], [-12, 32], [-12, 24], [-10, 14]]; // prettier-ignore
const frame = (x) => S.sweepTris(side.map(([y, z]) => [-y, z]), [[x, 0, 0], [x + 3, 0, 0]], { up: [0, 0, 1] });
const slats = [-6, -2, 2, 6].map((y) => boxAt([0, y, 17.5], 58, 3.4, 2, { bevel: 0.5 }));
const back = [0, 1, 2].map((i) => S.trisOf(S.box(S.place([0, -9.5 - i * 0.6, 22 + i * 4.5], [0, -0.3, 1], [1, 0, 0]), 58, 1.8, 3.6, { bevel: 0.5 })));
const benchProfile = [...frame(-29), ...frame(26), ...slats.flat(), ...back.flat()];

// ── a lamp post, 120 tall: a hexagonal pole and a lantern, against a turned post with a fluted base and a lantern ──
const post = (c, w, h) => boxAt([c[0], c[1], h / 2], w, w, h);
const lampBoxes = [post([0, 0], 10, 4), post([0, 0], 5, 100), boxAt([0, 0, 106], 14, 14, 12), boxAt([0, 0, 116], 18, 18, 3)].flat();
const turned = S.lathe(FLOOR, [[9, 0], [9, 3], [6, 6], [3.2, 12], [2.4, 40], [2.8, 80], [4, 88], [2.4, 92], [2.4, 96]], { n: 10 });
const lantern = S.lathe(S.place([0, 0, 96], [0, 0, 1]), [[2.4, 0], [6.5, 4], [7.5, 11], [7, 15], [8.5, 17], [0.5, 22]], { n: 10 });
const lampProfile = [turned, lantern].flatMap(S.trisOf);

// ── a tram car, 300 long, 60 wide, 78 tall ──
const tramBoxes = [
  boxAt([0, 0, 42], 300, 60, 56),
  boxAt([0, 0, 74], 296, 56, 5),
  ...[-110, 110].flatMap((x) => [-26, 26].map((y) => boxAt([x, y, 8], 40, 6, 16))),
  boxAt([154, 0, 40], 8, 40, 24),
].flat();
// a section of the body (floor, waist, belt line, curved roof) swept along its length; the ends tapered by a loft
const roof = [];
for (let i = 0; i <= 6; i++) {
  const a = (Math.PI * i) / 6;
  roof.push([30 * Math.cos(a) * 0.93, 62 + 14 * Math.sin(a)]);
}
const bodyOutline = [[-26, 12], [26, 12], [31, 22], [30, 40], [28, 60], ...roof, [-28, 60], [-30, 40], [-31, 22]];
const tramBody = S.sweepTris(bodyOutline.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]), [[-135, 0, 0], [135, 0, 0]], { up: [0, 0, 1] }); // prettier-ignore
const nose = (sign) => {
  const s = sign;
  const ring = (x, k, z0) => bodyOutline.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]).map(([y, z]) => [x, y * k, z0 + (z - z0) * k]);
  const a = ring(s * 135, 1, 14);
  const b = ring(s * 150, 0.82, 22);
  const m = a.length;
  const tris = [];
  for (let j = 0; j < m; j++) {
    const j2 = (j + 1) % m;
    tris.push([{ p: a[j], k: j }, { p: a[j2], k: j2 }, { p: b[j2], k: j2 }], [{ p: a[j], k: j }, { p: b[j2], k: j2 }, { p: b[j], k: j }]);
  }
  for (let j = 1; j + 1 < m; j++) tris.push([{ p: b[0], k: 0 }, { p: b[j], k: j }, { p: b[j + 1], k: j + 1 }]);
  // facing out: away from the car's middle
  return tris.map((t) => {
    const n = S.cross(S.sub(t[1].p, t[0].p), S.sub(t[2].p, t[0].p));
    const mid = S.mul(S.add(t[0].p, S.add(t[1].p, t[2].p)), 1 / 3);
    return S.dot(n, S.sub(mid, [0, 0, 40])) < 0 ? [t[0], t[2], t[1]] : t;
  });
};
const wheels = [-100, 100].flatMap((x) => [-26, 26].map((y) => S.trisOf(S.cyl(S.place([x, y, 9], [0, 1, 0], [0, 0, 1]), 9, -3, 3, { n: 12, bevel: 1 })))).flat();
// a pantograph on the roof (rods), a skirt over the bogies, a lamp pod on the nose
const rods = [[[-20, 0, 78], [0, 0, 100]], [[20, 0, 78], [0, 0, 100]], [[-6, 0, 100], [6, 0, 100]]].flatMap(([a, b]) => S.trisOf(S.tube(a, b, 1.2, { n: 6 })));
const skirt = [-100, 100].flatMap((x) => S.trisOf(S.box(S.place([x, 0, 12], [0, 0, 1], [1, 0, 0]), 76, 66, 8, { bevel: 2, cut: 5 })));
const pod = S.trisOf(S.lathe(S.place([152, 0, 38], [1, 0, 0], [0, 0, 1]), [[0.5, 0], [8, 2], [9, 5], [6, 9], [0.5, 10]], { n: 10 }));
const tramProfile = [...tramBody, ...nose(1), ...nose(-1), ...wheels, ...rods, ...skirt, ...pod];

// ── the models: written, checked, measured, drawn ──
console.log("model".padEnd(18), "axes   bare edges  corners  boxiness  (kind) WARN");
for (const [name, boxes, profile] of [["bench", benchBoxes, benchProfile], ["lamp", lampBoxes, lampProfile], ["tram", tramBoxes, tramProfile]]) {
  for (const [way, tris] of [["boxes", boxes], ["profile", profile]]) {
    const mdl = modelOf(`${name}-${way}`, tris);
    writeFileSync(join(OUT, `${name}-${way}.mdl`), mdl);
    const view = sheet(mdl, { size: 256 });
    writeFileSync(join(OUT, `${name}-${way}.png`), png(view.width, view.height, view.rgba));
    const m = formOfMdl(mdl).measures;
    const kind = kindOfName(name);
    const said = judgeForm(m, kind).warnings;
    const report = check(mdl, "goldsrc", { name: `${name}.mdl` });
    console.log(`${name}-${way}`.padEnd(18), String(m.axisAligned).padEnd(6), String(m.sharpEdges).padEnd(11), String(m.outline).padEnd(8), String(m.boxiness).padEnd(9), `(${kind}) ${said.length ? "WARN" : "ok"}${report.errors.length ? ` ERRORS ${report.errors.join("; ")}` : ""}`); // prettier-ignore
  }
}

// ── brushes: a bench as boxes and as chamfered / profile brushes, and a cornice swept along a wall ──
const tex = "WOOD";
const benchOld = [
  maps.box([-30, -9, 16], [30, 9, 18], tex),
  maps.box([-30, -11, 18], [30, -9, 32], tex),
  ...[-28, 26].map((x) => maps.box([x, -9, 0], [x + 3, 9, 16], tex)),
];
// (the map's frame is drawn coarser: a brush has no face under 4 square units)
const mapSide = [[-9, 0], [-5, 0], [-5, 10], [9, 12], [9, 17], [-7, 17], [-10, 30], [-12, 30], [-12, 17]];
const benchNew = [
  ...[-6, -2, 2, 6].map((y) => maps.box([-29, y - 1.8, 15], [29, y + 1.8, 18], tex, { bevel: 1, edges: "top+vertical" })),
  ...[0, 1, 2].map((i) => maps.box([-29, -12 - i * 1, 22 + i * 4], [29, -9 - i * 1, 25.5 + i * 4], tex, { bevel: 1 })),
  ...[-29, 26].flatMap((x) => maps.extrudeProfile(mapSide, x, x + 3, tex, { axis: "x" })),
];
// a cornice: a profile with a cove and a drip, swept along the top of a wall run of 4 sides
const cornice = [[0, 0], [16, 0], [16, 6], [12, 8], [6, 16], [0, 20]];
const corniceBrushes = maps.sweepProfile(cornice, [[0, 0, 160], [256, 0, 160], [256, 256, 160]], "WALL");
const oldCornice = [maps.box([0, -16, 160], [256, 8, 170], "WALL"), maps.box([248, 0, 160], [272, 256, 170], "WALL")];
for (const [name, list] of [["bench boxes", benchOld], ["bench profile", benchNew], ["cornice boxes", oldCornice], ["cornice swept", corniceBrushes]]) {
  const m = formOfBrushes(list);
  console.log(`${name.padEnd(18)} brushes ${String(list.length).padEnd(3)} bare boxes ${String(Math.round(m.bare / m.count * 100) + "%").padEnd(5)} on the axes ${String(Math.round(m.axisAligned * 100) + "%").padEnd(5)} bare edges ${Math.round(m.sharpEdges * 100)}%`); // prettier-ignore
}
// the brushes drawn: the source as a map (a floor and the wall the cornice runs along), to look at with
//   node bin/smak.mjs map-view map-profile.map -o map-profile.png --from 60,-230,80 --yaw 90 --pitch -8
const room = [maps.box([-200, -300, -8], [400, 300, 0], "FLOOR"), maps.box([0, 0, 0], [256, 8, 160], "WALL"), maps.box([248, 0, 0], [256, 256, 160], "WALL")];
const start = [maps.pointEntity("info_player_start", [60, -230, 36])];
const put = (list) => maps.moved(list, [100, -100, 0]);
// the furniture and the cornice are detail (func_detail): what a player looks at, and what the form measures
const text = (made) => maps.writeMap({ worldspawn: { wad: "" }, brushes: room, entities: [...start, maps.brushEntity("func_detail", made)] });
writeFileSync(join(OUT, "map-profile.map"), text([...put(benchNew), ...corniceBrushes]));
writeFileSync(join(OUT, "map-boxes.map"), text([...put(benchOld), ...oldCornice]));

// ── the make layer's builders, hand-written into one composition: a bench turned and placed by a frame ──
//   node bin/smak.mjs map-view map-forms.map -o map-forms.png --from 0,-460,420 --yaw 90 --pitch -30
const forms = [];
const formEntities = [];
{
  const frameAt = maps.frame({ at: [-120, -80, 0], yaw: 30 });
  const placed = frameAt.place({ brushes: benchNew, entities: [maps.pointEntity("light", [0, 0, 60], { _light: "255 240 200 200" })] });
  forms.push(...placed.brushes);
  formEntities.push(...placed.entities);
  console.log(`bench placed by a frame at ${frameAt.at} turned ${frameAt.yaw}: its light at ${placed.entities[0].origin}`);
}
const world = [];
// a roof of each kind over a plain shell, a dome with an eye on a drum, and an arcade along a bent line
{
  const wall = (min, max) => maps.box(min, max, "WALL");
  const rooftex = (n) => (n[2] > 0.2 ? "ROOF" : "WALL");
  // gable: walls 256 x 160, 128 tall, the ridge along the longer side
  world.push(wall([200, -300, 0], [456, -140, 128]));
  world.push(...maps.roof([[200, -300], [456, -300], [456, -140], [200, -140]], { kind: "gable", pitch: 35, overhang: 20, z: 128, texture: rooftex }));
  // hip over a second shell
  world.push(wall([200, -60, 0], [456, 100, 128]));
  world.push(...maps.roof([[200, -60], [456, -60], [456, 100], [200, 100]], { kind: "hip", pitch: 30, overhang: 16, z: 128, texture: "ROOF" }));
  // shed against a long low wall
  world.push(wall([-420, 200, 0], [-100, 360, 96]));
  world.push(...maps.roof([[-420, 200], [-100, 200], [-100, 360], [-420, 360]], { kind: "shed", pitch: 12, overhang: 12, z: 96, texture: "ROOF" }));
  // a dome with an eye on a round drum
  const drum = maps.cylinder("z", [-250, -200], 128, 0, 112, "WALL", { sides: 16, snap: 1 });
  world.push(drum);
  world.push(...maps.dome([-250, -200, 112], 128, { rings: 4, segments: 16, thick: 16, open: 40, texture: "DOME" }));
  // an arcade of five bays along a bent line (two runs, the second turned 40 degrees)
  world.push(...maps.arcade([-380, 60, 0], [-80, 60, 0], { bays: 3, height: 112, depth: 32, texture: "ARCADE" }));
  world.push(...maps.arcade([40, 330, 0], [300, 470, 0], { bays: 3, height: 112, depth: 32, texture: "ARCADE" }));
}
const formRoom = [maps.box([-600, -500, -8], [600, 600, 0], "FLOOR")];
const formsText = () => maps.writeMap({ worldspawn: { wad: "" }, brushes: [...formRoom, ...world], entities: [maps.playerStart([0, -400, 0], 90), ...formEntities, maps.brushEntity("func_detail", forms)] });
writeFileSync(join(OUT, "map-forms.map"), formsText());
console.log(`written to ${OUT}`);
