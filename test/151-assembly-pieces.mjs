// levels/assembly, part P: the Half-Life piece library (levels/assembly/pieces/hl, made by pieces/make-hl.mjs) and
// levels/assembly/library.mjs. Every piece loads and its bounds are its declared size, approved only while its .map is
// what the person approved (approvals.json's sha1); every texture is in
// halflife.wad (when the game is on the machine); pieceFor finds each slot's piece; placed turns and moves a piece
// at the four turns and back to where it was, its pictures locked and the world's grid kept, a turned door's
// opening where its connector says; the stair rises 12 even risers from z 0 to the upper landing's top at 192
// with its two connectors; the door and the entrance span two edges (128) with a clear opening of 64 x 112 measured
// from their brushes with the leaf open, the leaf's open box its closed one turned about its hinge; the window's glass
// breaks (a func_breakable of glass) and leaves 40 to climb through; a door whose open leaf stands in its opening, and a
// piece naming a texture the .wad lacks, are told in a sentence.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test, sure, HERE } from "./helper.mjs";
import { loadLibrary, pieceFor, placed, connectorsOf, footprintOf, checkTextures, doorwayOf } from "../levels/assembly/library.mjs";
import { shapeOf, planeOf } from "../src/maps/source.mjs";
import { wadTextureNames } from "../src/maps/plan.mjs";

const FOLDER = join(HERE, "../levels/assembly/pieces/hl");
const WAD = process.env.HL_WAD ?? "C:/Juegos/Steam/steamapps/common/Half-Life/valve/halflife.wad";
const lib = loadLibrary(FOLDER);
const all = (made) => [...made.brushes, ...made.entities.flatMap((e) => e.brushes ?? [])];
const boundsOf = (brushes) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of brushes) {
    const s = shapeOf(b);
    sure(!s.faults.length, `a brush is unsound: ${s.faults.join("; ")}`);
    for (let i = 0; i < 3; i++) [min[i], max[i]] = [Math.min(min[i], s.min[i]), Math.max(max[i], s.max[i])];
  }
  return { min: min.map((v) => Math.round(v * 100) / 100), max: max.map((v) => Math.round(v * 100) / 100) };
};
const near = (a, b, e = 0.01) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= e);

test("assembly pieces: every piece loads, its bounds are its declared size, approved only while its .map is the one approved", () => {
  sure(lib.pieces.size >= 17, `the library has ${lib.pieces.size} pieces, 17 at least were made`);
  for (const id of ["wall", "wall-exterior", "wall-door", "wall-entrance", "wall-window", "wall-open", "rail", "corner-L", "corner-T", "corner-cross", "corner-straight", "corner-end", "corner-rail", "floor", "ceiling-roof", "stair-u", "lamp-ceiling", "lamp-wall"])
    sure(lib.pieces.has(id), `the library has no ${id}`);
  const approvals = existsSync(join(FOLDER, "approvals.json")) ? JSON.parse(readFileSync(join(FOLDER, "approvals.json"), "utf8")) : {};
  for (const [id, p] of lib.pieces) {
    const text = p.file ? readFileSync(join(FOLDER, p.file), "utf8") : "";
    const seen = approvals[id]?.sha1 === createHash("sha1").update(text).digest("hex");
    sure(p.approved === seen, `${id} is ${p.approved ? "" : "not "}approved, but its .map is ${seen ? "" : "not "}the one the person approved`);
    if (!p.file) continue;
    const { min, max } = boundsOf(all(p.map));
    sure(near(min, p.bounds[0]) && near(max, p.bounds[1]), `${id}: its brushes run ${min} .. ${max}, its entry says ${p.bounds[0]} .. ${p.bounds[1]}`);
    sure(near(max.map((v, i) => v - min[i]), p.size), `${id}: its size is ${max.map((v, i) => v - min[i])}, its entry says ${p.size}`);
  }
  // the frames: a wall's edge 0..64 centred on y = 0, a floor's cell, a post round its vertex
  sure(near(lib.pieces.get("wall").bounds.flat(), [0, -8, 0, 64, 8, 176]), `wall: ${lib.pieces.get("wall").bounds}`);
  sure(near(lib.pieces.get("floor").bounds.flat(), [0, 0, -16, 64, 64, 0]), `floor: ${lib.pieces.get("floor").bounds}`);
  sure(near(lib.pieces.get("corner-L").bounds.flat(), [-8, -8, 0, 8, 8, 192]), `corner-L: ${lib.pieces.get("corner-L").bounds}`);
});

test("assembly pieces: every texture a piece names is in halflife.wad", () => {
  if (!existsSync(WAD)) {
    console.log(`      (skipped: no halflife.wad at ${WAD}; HL_WAD names it)`);
    return;
  }
  const check = checkTextures(lib, wadTextureNames(readFileSync(WAD)));
  sure(!check.failures.length, check.failures.join("; "));
  sure(check.used.length >= 10, `only ${check.used.length} textures used`);
});

test("assembly pieces: a piece naming a texture the .wad lacks is told in a sentence", () => {
  const broken = { ...lib, pieces: new Map(lib.pieces) };
  const wall = lib.pieces.get("wall");
  const faces = wall.map.brushes[0].faces.map((f, i) => (i === 0 ? { ...f, texture: "NO_SUCH_TEX" } : f));
  broken.pieces.set("wall", { ...wall, map: { ...wall.map, brushes: [{ faces }] } });
  const names = existsSync(WAD) ? wadTextureNames(readFileSync(WAD)) : checkTextures(lib, []).used;
  const check = checkTextures(broken, names);
  const want = "the piece wall names the texture NO_SUCH_TEX, which is not among the";
  sure(check.failures.length === 1 && check.failures[0].startsWith(want) && check.failures[0].endsWith("textures of halflife.wad"), check.failures.join("; ") || "nothing was told");
});

test("assembly pieces: pieceFor finds each slot's piece by kind and by a corner's mask", () => {
  const id = (slot, which) => pieceFor(lib, slot, which)?.id ?? null;
  sure(id("edge", "door") === "wall-door", id("edge", "door"));
  sure(id("edge", "exterior") === "wall-exterior" && id("edge", "interior") === "wall", `${id("edge", "exterior")} ${id("edge", "interior")}`);
  sure(id("edge", "entrance") === "wall-entrance" && id("edge", "window") === "wall-window", "entrance, window");
  sure(id("edge", "rail") === "rail" && id("rail", "rail") === "rail", "rail");
  sure(id("edge", "open") === "wall-open" && !pieceFor(lib, "edge", "open").map.brushes.length, "an open edge has nothing");
  for (const [mask, want] of [[12, "corner-L"], [6, "corner-L"], [14, "corner-T"], [15, "corner-cross"], [10, "corner-straight"], [5, "corner-straight"], [8, "corner-end"]])
    sure(id("corner", mask) === want, `mask ${mask}: ${id("corner", mask)}, not ${want}`);
  sure(id("corner", { mask: 5, kind: "rail" }) === "corner-rail", "a rail's newel");
  sure(id("corner", 0) === null, "no corner where no wall meets");
  sure(id("floor", "floor") === "floor" && id("ceiling", "roof") === "ceiling-roof" && id("stair", "u-turn") === "stair-u", "floor, roof, stair");
  sure(id("lamp", "ceiling") === "lamp-ceiling" && id("lamp", "wall") === "lamp-wall", "lamps");
});

test("assembly pieces: placed turns a piece at the four turns and back, pictures locked, the world's grid kept", () => {
  const door = lib.pieces.get("wall-door");
  // four quarter turns about the frame's origin are where it began, face for face and picture for picture
  for (const id of ["wall-door", "stair-u", "lamp-wall", "wall-window"]) {
    const piece = lib.pieces.get(id);
    let made = { brushes: piece.map.brushes, entities: piece.map.entities };
    for (let k = 0; k < 4; k++) made = placed({ ...piece, map: { ...piece.map, ...made } }, { turn: 90 });
    const a = all(piece.map).flatMap((b) => b.faces);
    const b = all(made).flatMap((x) => x.faces);
    sure(a.length === b.length, `${id}: ${a.length} faces, ${b.length} after four turns`);
    a.forEach((f, i) => {
      sure(f.points.flat().every((v, j) => Math.abs(v - b[i].points.flat()[j]) < 1e-6), `${id}: face ${i} moved after four turns`);
      sure(near(f.u, b[i].u, 1e-6) && near(f.v, b[i].v, 1e-6) && f.texture === b[i].texture, `${id}: face ${i}'s picture moved after four turns`);
    });
  }
  // a turned door: its leaf where its connector says, its picture locked to it
  for (const turn of [0, 90, 180, 270]) {
    const at = [256, 128, 192];
    const made = placed(door, { at, turn });
    const [c] = connectorsOf(door, { at, turn });
    const rad = (turn * Math.PI) / 180;
    const want = [at[0] + Math.round(64 * Math.cos(rad)), at[1] + Math.round(64 * Math.sin(rad)), at[2]];
    sure(near(c.at, want), `turn ${turn}: the doorway is at ${c.at}, not ${want}`);
    sure(near(c.facing, [Math.round(-Math.sin(rad)), Math.round(Math.cos(rad)), 0]), `turn ${turn}: the door opens towards ${c.facing}`);
    const leaf = made.entities.find((e) => e.classname === "func_door_rotating");
    const { min, max } = boundsOf(leaf.brushes.filter((b) => b.faces.every((f) => f.texture !== "ORIGIN")));
    const mid = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    sure(Math.hypot(mid[0] - want[0], mid[1] - want[1]) < 14, `turn ${turn}: the leaf's middle is at ${mid}, the doorway at ${want}`);
    sure(near([min[2], max[2]], [at[2] + 1, at[2] + 111]), `turn ${turn}: the leaf runs z ${min[2]}..${max[2]}`);
    // locked: a corner of the leaf's face wears the same texel as before
    const before = door.map.entities.find((e) => e.classname === "func_door_rotating").brushes[0].faces;
    const after = leaf.brushes[0].faces;
    before.forEach((f, i) => {
      if (f.texture !== "FIFTIES_DR1K") return;
      const s = (face, p) => [0, 1].map((k) => { const ax = k ? face.v : face.u; return (p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]) / face.scale[k] + ax[3]; });
      const p0 = f.points[0];
      sure(near(s(f, p0), s(after[i], after[i].points[0]), 1e-4), `turn ${turn}: the door's picture slid on face ${i}`);
    });
    // the wall's faces are on the world's grid where they land: neighbours line up whatever their turn
    for (const brush of made.brushes)
      for (const f of brush.faces) {
        if (f.texture !== "FIFTIES_WALL14A") continue;
        sure(f.u[3] === 0 && f.v[3] === 0, `turn ${turn}: a wall face's picture is off the world's grid (${f.u[3]}, ${f.v[3]})`);
      }
  }
  // a point entity turns with it, a brush entity's keys do not
  const lamp = placed(lib.pieces.get("lamp-wall"), { at: [64, 0, 0], turn: 90 });
  const l = lamp.entities.find((e) => e.classname === "light");
  const o = l.origin.split(" ").map(Number);
  sure(o[0] < 64 && Math.abs(o[1] - 32) < 1, `the sconce's light is at ${o}: before the wall's face, turned`);
  sure(near(footprintOf(lib.pieces.get("stair-u"), { at: [0, 0, 0], turn: 90 }).flat(), [-256, 0, 0, 128]), "the stair's footprint turned");
  // outside: a post's faces looking south take the brick
  const post = placed(lib.pieces.get("corner-L"), { outside: ["south"] });
  const south = post.brushes[0].faces.filter((f) => planeOf(f.points).normal[1] < -0.99);
  sure(south.length === 1 && south[0].texture === lib.palette.brick, "a post's south face in brick");
});

test("assembly pieces: the stair rises 12 even risers from z 0 to the upper landing at 192, its connectors at foot and top", () => {
  const stair = lib.pieces.get("stair-u");
  const solid = stair.map.brushes.filter((b) => b.faces.every((f) => f.texture !== "CLIP"));
  // the treads: brushes with a level top (the spine's top slopes)
  const shapes = solid.map(shapeOf).filter((s) => s.corners.filter((c) => Math.abs(c[2] - s.max[2]) < 0.01).length >= 4);
  const tops = [...new Set(shapes.map((s) => Math.round(s.max[2])))].sort((a, b) => a - b);
  for (let z = 16; z <= 192; z += 16) sure(tops.includes(z), `no tread at z ${z}: the tops are ${tops}`);
  sure(Math.max(...tops) === 192, `the highest tread is at ${Math.max(...tops)}, not 192`);
  // the upper landing's top is 192 over the cells y 0..64; the first step stands on z 0
  const landing = shapes.find((s) => s.max[2] === 192 && s.min[1] === 0 && s.max[1] === 64);
  sure(landing && landing.min[0] === 0 && landing.max[0] === 128, "the upper landing covers x 0..128, y 0..64 at z 192");
  const first = shapes.find((s) => s.max[2] === 16);
  sure(first && first.min[2] === 0 && first.min[1] === 64, `the first step stands on z 0 at y 64: ${first?.min}`);
  // nothing floats: every step and the landing at 96 stand on z 0 or on something solid under them
  for (const s of shapes.filter((x) => x.min[2] > 0 && x.max[2] < 176))
    sure(shapes.some((u) => u !== s && Math.abs(u.max[2] - s.min[2]) < 0.01 && u.min[0] <= s.min[0] && u.max[0] >= s.max[0] && u.min[1] <= s.min[1] && u.max[1] >= s.max[1]), `a step at ${s.min}..${s.max} stands on nothing`);
  // each tread is 24 deep and each riser 16: the steps of flight 1 by their fronts
  const flight1 = shapes.filter((s) => s.max[0] <= 64 && s.max[2] <= 80 && s.min[1] >= 64).sort((a, b) => a.min[1] - b.min[1]);
  flight1.forEach((s, i) => sure(s.min[1] === 64 + 24 * i && s.max[2] === 16 * (i + 1), `flight 1 step ${i + 1}: front ${s.min[1]}, top ${s.max[2]}`));
  sure(stair.map.brushes.filter((b) => b.faces.every((f) => f.texture === "CLIP")).length >= 2, "a CLIP ramp over each flight");
  const types = stair.connectors.map((c) => c.type);
  sure(types.includes("stair-foot") && types.includes("stair-top"), `connectors: ${types}`);
  const foot = stair.connectors.find((c) => c.type === "stair-foot");
  const top = stair.connectors.find((c) => c.type === "stair-top");
  sure(foot.at[2] === 0 && top.at[2] === 192 && foot.at[1] === 0 && top.at[1] === 0, `the foot at ${foot.at}, the top at ${top.at}: both at the short end y 0`);
  sure(near(stair.footprint.flat(), [0, 0, 128, 256]), "the stairwell is 128 x 256");
});

const leafOf = (piece) => piece.map.entities.find((e) => e.classname === "func_door_rotating");
const solidOf = (entity) => entity.brushes.filter((b) => b.faces.every((f) => f.texture !== "ORIGIN"));

test("assembly pieces: the door and the entrance span two edges, clear 64 x 112 with the leaf open, the leaf turning 90 into +y beside the opening", () => {
  for (const id of ["wall-door", "wall-entrance"]) {
    const p = lib.pieces.get(id);
    sure(p.edges === 2, `${id} spans ${p.edges} edges, two wanted`);
    sure(p.bounds[0][0] === 0 && p.bounds[1][0] === 128, `${id} runs x ${p.bounds[0][0]}..${p.bounds[1][0]}, 0..128 wanted (it covers the middle vertex)`);
    const c = p.connectors[0];
    sure(c.type === "doorway-64x112" && near(c.at, [64, 0, 0]) && near(c.facing, [0, 1, 0]), `${id}'s connector: ${JSON.stringify(c)}`);
    sure(p.bounds[1][2] === (id === "wall-door" ? 176 : 192), `${id} stands to ${p.bounds[1][2]}`);
    // the open data: the closed box is the leaf's brush, the open box the closed one turned +90 about the hinge
    const o = p.open;
    sure(o && o.entity === "func_door_rotating" && o.angle === 90, `${id}'s open: ${JSON.stringify(o)}`);
    const leaf = leafOf(p);
    sure(leaf && Number(leaf.distance) === o.angle && Number(leaf.spawnflags) === 16, `${id}'s leaf turns ${leaf?.distance}, one way (16): ${leaf?.spawnflags}`);
    const lb = boundsOf(solidOf(leaf));
    sure(near(lb.min, o.closed[0]) && near(lb.max, o.closed[1]), `${id}: the leaf's brush runs ${lb.min}..${lb.max}, its open entry says closed ${o.closed}`);
    sure(near(lb.max.map((v, i) => v - lb.min[i]), [64, 4, 110]), `${id}: the leaf is ${lb.max.map((v, i) => v - lb.min[i])}, 64 x 4 x 110 wanted`);
    const origin = boundsOf(leaf.brushes.filter((b) => b.faces.every((f) => f.texture === "ORIGIN")));
    sure(near([(origin.min[0] + origin.max[0]) / 2, (origin.min[1] + origin.max[1]) / 2], o.hinge.slice(0, 2)), `${id}: the origin brush is not at the hinge ${o.hinge}`);
    const turn = ([x, y]) => [o.hinge[0] - (y - o.hinge[1]), o.hinge[1] + (x - o.hinge[0])];
    const [a, b] = [turn(o.closed[0]), turn(o.closed[1])];
    sure(near([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], [o.box[0][0], o.box[0][1], o.box[1][0], o.box[1][1]]), `${id}: the open box ${o.box} is not the closed leaf turned 90 about ${o.hinge}`);
    // nothing solid in the leaf's sweep (the quarter disc from the hinge into +y, over the leaf's heights): it reaches its 90
    const reach = Math.hypot(o.closed[1][0] - o.hinge[0], o.closed[1][1] - o.hinge[1]);
    const others = [...p.map.brushes, ...p.map.entities.filter((e) => e !== leaf).flatMap((e) => e.brushes ?? [])].map(shapeOf);
    for (const s of others) {
      if (!(s.max[2] > o.closed[0][2] && s.min[2] < o.closed[1][2])) continue;
      // the sweep lies in x box[0][0]..hinge+reach, y hinge..hinge+reach; a brush overlapping that box is held against the disc
      if (!(s.max[0] > o.box[0][0] + 1e-6 && s.min[0] < o.hinge[0] + reach - 1e-6 && s.max[1] > o.hinge[1] + 1e-6 && s.min[1] < o.hinge[1] + reach - 1e-6)) continue;
      const nx = Math.max(s.min[0], Math.min(o.hinge[0], s.max[0]));
      const ny = Math.max(s.min[1], Math.min(o.hinge[1], s.max[1]));
      sure(Math.hypot(nx - o.hinge[0], ny - o.hinge[1]) >= reach - 1e-6, `${id}: a brush at ${s.min}..${s.max} stands in the leaf's sweep and stops it short of 90`);
    }
    // the clear opening, measured from the brushes with the leaf open
    const d = doorwayOf(p);
    sure(!d.failures.length, d.failures.join("; "));
    sure(d.width >= 64 && d.height >= 112, `${id}: clear ${d.width} x ${d.height} with the leaf open, 64 x 112 wanted`);
    sure(d.leaf[1] <= d.span[0] || d.leaf[0] >= d.span[1], `${id}: the open leaf (x ${d.leaf}) stands in the opening (x ${d.span})`);
    sure(near([o.clear.width, o.clear.height], [d.width, d.height]), `${id}: library.json says clear ${o.clear.width} x ${o.clear.height}, the brushes ${d.width} x ${d.height}`);
    // the open variant: the leaf a world brush at its open box, no door entity left
    const opened = placed(p, { open: true });
    sure(!opened.entities.some((e) => e.classname === "func_door_rotating"), `${id}: the open variant keeps its door entity`);
    const extra = boundsOf([opened.brushes.at(-1)]);
    sure(near(extra.min, o.box[0]) && near(extra.max, o.box[1]), `${id}: the open variant's leaf runs ${extra.min}..${extra.max}, not ${o.box}`);
  }
});

test("assembly pieces: a door whose open leaf stands in its opening is told in a sentence", () => {
  const door = lib.pieces.get("wall-door");
  // the leaf hinged 4 further in: open, it stands at x 32..36, in the opening
  const broken = { ...door, open: { ...door.open, box: [[32, 10, 1], [36, 74, 111]] } };
  const d = doorwayOf(broken);
  const want = "the piece wall-door's doorway is 60 wide with its leaf open (x 36..96), 64 wanted: its open leaf (x 32..36) stands in the opening";
  sure(d.failures.length === 1 && d.failures[0] === want, d.failures.join("; ") || "nothing was told");
});

test("assembly pieces: the window's glass is a func_breakable of glass, and the opening it leaves is 40 wide at least", () => {
  const w = lib.pieces.get("wall-window");
  const glass = w.map.entities.filter((e) => e.classname === "func_breakable");
  sure(glass.length === 1, `the window has ${glass.length} func_breakable`);
  const g = glass[0];
  sure(Number(g.material) === 0 && Number(g.health) > 0 && Number(g.rendermode) === 2, `the glass: material ${g.material} (0 wanted), health ${g.health}, rendermode ${g.rendermode}`);
  sure(!w.map.entities.some((e) => e.classname === "func_wall"), "the window keeps a func_wall");
  sure(g.brushes.every((b) => b.faces.every((f) => /GLASS/i.test(f.texture))), "the pane wears a glass texture");
  // the opening between the frame's inner faces: every solid brush but the glass, round the pane's middle
  const pane = boundsOf(g.brushes);
  const mid = [(pane.min[0] + pane.max[0]) / 2, (pane.min[2] + pane.max[2]) / 2];
  const solid = [...w.map.brushes, ...w.map.entities.filter((e) => e !== g).flatMap((e) => e.brushes ?? [])].map(shapeOf)
    .filter((s) => s.max[1] > -8 && s.min[1] < 8);
  const across = (axis, at, other, lo, hi) => {
    let a = -Infinity;
    let b = Infinity;
    for (const s of solid) {
      if (!(s.max[other] > lo && s.min[other] < hi)) continue;
      if (s.max[axis] <= at) a = Math.max(a, s.max[axis]);
      else if (s.min[axis] >= at) b = Math.min(b, s.min[axis]);
      else a = b = at;
    }
    return [a, b];
  };
  const [x0, x1] = across(0, mid[0], 2, mid[1] - 8, mid[1] + 8);
  const [z0, z1] = across(2, mid[1], 0, mid[0] - 8, mid[0] + 8);
  sure(x1 - x0 >= 40, `the window's opening is ${x1 - x0} wide (x ${x0}..${x1}), 40 wanted for a crouching player`);
  sure(z1 - z0 >= 36, `the window's opening is ${z1 - z0} high (z ${z0}..${z1}), 36 wanted for a crouching player`);
  sure(near(w.glass.clear.flat(), [x0, z0, x1, z1]), `library.json's glass.clear ${w.glass.clear} is not the opening ${[x0, z0, x1, z1]}`);
});
