// levels/assembly, part P: the Mese's piece library for The Specialists (levels/assembly/pieces/mese, made by
// pieces/make-mese.mjs). Every piece loads within its frame at its declared size, approved only while its .map is the
// one the person approved; every texture is in the union of specialists.wad, halflife.wad and H9's
// alexandria_msr_b4v3_generated.wad (when they are on the machine); the door, the entrance and the shopfront span two
// edges with 64 x 112 clear with the leaf open, their leaves opened by use only (256) and named by the assembler;
// the shop window's glass is a func_breakable of glass leaving 40 to climb through; the column's top meets the
// architrave's bottom at 176 and the portico's slab is 176..192 as the architrave is; the stair rises 12 risers from
// 0 to 192; the landmark fits its 3 x 3 cells.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test, sure, HERE } from "./helper.mjs";
import { loadLibrary, pieceFor, placed, checkTextures, doorwayOf } from "../levels/assembly/library.mjs";
import { shapeOf } from "../src/maps/source.mjs";
import { wadTextureNames } from "../src/maps/plan.mjs";

const FOLDER = join(HERE, "../levels/assembly/pieces/mese");
const WADS = [
  process.env.TS_WAD ?? "C:/Juegos/Steam/steamapps/common/Half-Life/ts/specialists.wad",
  process.env.HL_WAD ?? "C:/Juegos/Steam/steamapps/common/Half-Life/valve/halflife.wad",
  process.env.MESE_WAD ?? "C:/Juegos/H9XASH/ts/alexandria_msr_b4v3_generated.wad",
];
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
const within = (b, lo, hi) => b.min.every((v, i) => v >= lo[i] - 0.01) && b.max.every((v, i) => v <= hi[i] + 0.01);

test("mese pieces: every piece loads within its frame at its declared size, approved only while its .map is the one approved", () => {
  sure(lib.game === "ts" && Array.isArray(lib.wad) && lib.wad.length === 3, `the library is for ${lib.game}, its wads ${lib.wad}`);
  const ids = ["wall", "wall-exterior", "facade", "wall-door", "wall-entrance", "shopfront", "wall-window", "shop-window", "wall-open", "rail", "corner-L", "corner-T", "corner-cross", "corner-straight", "corner-end", "corner-rail", "floor", "paving", "ceiling-roof", "stair-u", "lamp-ceiling", "lamp-wall", "column", "architrave", "portico", "landmark"];
  for (const id of ids) sure(lib.pieces.has(id), `the library has no ${id}`);
  const approvals = existsSync(join(FOLDER, "approvals.json")) ? JSON.parse(readFileSync(join(FOLDER, "approvals.json"), "utf8")) : {};
  for (const [id, p] of lib.pieces) {
    const text = p.file ? readFileSync(join(FOLDER, p.file), "utf8") : "";
    const seen = approvals[id]?.sha1 === createHash("sha1").update(text).digest("hex");
    sure(p.approved === seen, `${id} is ${p.approved ? "" : "not "}approved, but its .map is ${seen ? "" : "not "}the one the person approved`);
    if (!p.file) continue;
    const b = boundsOf(all(p.map));
    sure(near(b.min, p.bounds[0]) && near(b.max, p.bounds[1]), `${id}: its brushes run ${b.min} .. ${b.max}, its entry says ${p.bounds[0]} .. ${p.bounds[1]}`);
    // the frames: an edge's wall within y -8..8 (its casings, sills and sign a little out), x 0..64 a edge
    const frames = {
      edge: [[0, -20, -16], [64 * (p.edges ?? 1), 20, 192]], rail: [[0, -8, 0], [64, 8, 96]], corner: [[-8, -8, 0], [8, 8, 192]],
      floor: [[0, 0, -16], [64, 64, 0]], ceiling: [[0, 0, 176], [64, 64, 192]], stair: [[0, 0, 0], [128, 256, 288]], // 288: the CLIP over the upper landing's rail, 96 over 192, as the house's
      column: [[-20, -20, 0], [20, 20, 176]], architrave: [[0, -10, 176], [64, 10, 192]], portico: [[0, 0, 172], [64, 64, 192]], landmark: [[0, 0, 0], [192, 192, 512]],
    };
    const f = frames[p.slot];
    if (f) sure(within(b, f[0], f[1]), `${id} runs ${b.min} .. ${b.max}, outside its frame ${f[0]} .. ${f[1]}`);
  }
  sure(near(lib.pieces.get("wall").bounds.flat(), [0, -8, 0, 64, 8, 176]), `wall: ${lib.pieces.get("wall").bounds}`);
  sure(near(lib.pieces.get("wall-exterior").bounds.flat(), [0, -8, 0, 64, 8, 192]), `wall-exterior: ${lib.pieces.get("wall-exterior").bounds}`);
  sure(near(lib.pieces.get("paving").bounds.flat(), [0, 0, -16, 64, 64, 0]), `paving: ${lib.pieces.get("paving").bounds}`);
});

test("mese pieces: every texture a piece names is in specialists.wad, halflife.wad and the H9 wad together", () => {
  if (!WADS.every(existsSync)) {
    console.log(`      (skipped: the three wads are not all on this machine; TS_WAD, HL_WAD, MESE_WAD name them)`);
    return;
  }
  const names = WADS.flatMap((f) => wadTextureNames(readFileSync(f)));
  const check = checkTextures(lib, names, "the three wads");
  sure(!check.failures.length, check.failures.join("; "));
  sure(check.used.length >= 12, `only ${check.used.length} textures used`);
  // the palette's names are each in one of them, and the texture lights too
  const have = new Set(names.map((n) => n.toUpperCase()));
  for (const [role, name] of Object.entries(lib.palette)) sure(have.has(name.toUpperCase()), `the palette's ${role} is ${name}, in none of the three wads`);
  for (const name of Object.keys(lib.texlights)) sure(have.has(name.toUpperCase()), `the texture light ${name} is in none of the three wads`);
});

test("mese pieces: pieceFor finds the house's slots and the street's", () => {
  const id = (slot, which) => pieceFor(lib, slot, which)?.id ?? null;
  for (const [slot, which, want] of [
    ["edge", "door", "wall-door"], ["edge", "entrance", "wall-entrance"], ["edge", "interior", "wall"], ["edge", "exterior", "wall-exterior"],
    ["edge", "facade", "facade"], ["edge", "window", "wall-window"], ["edge", "shopfront", "shopfront"], ["edge", "shop-window", "shop-window"],
    ["edge", "rail", "rail"], ["floor", "floor", "floor"], ["floor", "paving", "paving"], ["ceiling", "roof", "ceiling-roof"], ["stair", "u-turn", "stair-u"],
    ["lamp", "ceiling", "lamp-ceiling"], ["lamp", "wall", "lamp-wall"], ["corner", 12, "corner-L"], ["corner", 15, "corner-cross"],
  ]) sure(id(slot, which) === want, `${slot} ${which}: ${id(slot, which)}, not ${want}`);
  for (const slot of ["column", "architrave", "portico", "landmark"]) sure(pieceFor(lib, slot, "portico") || pieceFor(lib, slot, "column"), `nothing in the slot ${slot}`);
});

const leafOf = (piece) => piece.map.entities.find((e) => e.classname === "func_door_rotating");

test("mese pieces: the door, the entrance and the shopfront: two edges, 64 x 112 clear with the leaf open, opened by use only, named by the assembler", () => {
  for (const id of ["wall-door", "wall-entrance", "shopfront"]) {
    const p = lib.pieces.get(id);
    sure(p.edges === 2 && p.bounds[0][0] === 0 && p.bounds[1][0] === 128, `${id} spans ${p.edges} edges, x ${p.bounds[0][0]}..${p.bounds[1][0]}; two (0..128) wanted`);
    const c = p.connectors[0];
    sure(c.type === "doorway-64x112" && near(c.at, [64, 0, 0]) && near(c.facing, [0, 1, 0]), `${id}'s connector: ${JSON.stringify(c)}`);
    const leaf = leafOf(p);
    const flags = Number(leaf?.spawnflags);
    sure(leaf && (flags & 256) === 256, `${id}'s leaf is opened by touch: spawnflags ${leaf?.spawnflags}, 256 (use only) wanted`);
    sure((flags & 16) === 16 && Number(leaf.distance) === 90, `${id}'s leaf turns ${leaf.distance} one way (16): spawnflags ${flags}`);
    sure(!leaf.targetname, `${id}'s leaf is named ${leaf.targetname} in the piece; the assembler names it`);
    sure(p.named?.key === "targetname" && p.named.entity === "func_door_rotating", `${id}'s entry does not say its leaf's targetname is to be filled: ${JSON.stringify(p.named)}`);
    const lb = boundsOf(leaf.brushes.filter((b) => b.faces.every((f) => f.texture !== "ORIGIN")));
    sure(near(lb.min, p.open.closed[0]) && near(lb.max, p.open.closed[1]), `${id}: the leaf runs ${lb.min}..${lb.max}, its open entry says ${p.open.closed}`);
    const d = doorwayOf(p);
    sure(!d.failures.length, d.failures.join("; "));
    sure(d.width >= 64 && d.height >= 112, `${id}: clear ${d.width} x ${d.height} with the leaf open, 64 x 112 wanted`);
    sure(d.leaf[1] <= d.span[0] || d.leaf[0] >= d.span[1], `${id}: the open leaf (x ${d.leaf}) stands in the opening (x ${d.span})`);
    sure(near([p.open.clear.width, p.open.clear.height], [d.width, d.height]), `${id}: library.json says clear ${p.open.clear.width} x ${p.open.clear.height}, the brushes ${d.width} x ${d.height}`);
    // the house's geometry: the same opening, hinge and open box as pieces/hl's
    sure(near(p.open.hinge, [32, 10, 0]) && near(p.open.box.flat(), [28, 10, 1, 32, 74, 111]), `${id}: hinge ${p.open.hinge}, open box ${p.open.box}; the house's (32, 10) and 28..32 x 10..74 wanted`);
    const opened = placed(p, { open: true });
    sure(!opened.entities.some((e) => e.classname === "func_door_rotating"), `${id}: the open variant keeps its door entity`);
  }
  // the shopfront's sign board stands over the opening, on the street side
  const sign = lib.pieces.get("shopfront").sign;
  sure(sign && sign.box[0][2] >= 112 && sign.box[1][1] <= -8, `the shopfront's sign ${JSON.stringify(sign?.box)} is not over the opening on the street side`);
});

test("mese pieces: the shop window's glass is a func_breakable of glass, sill 32 and head 144, leaving 40 to climb through", () => {
  const w = lib.pieces.get("shop-window");
  sure(w.edges === undefined && w.bounds[1][0] === 64, "the shop window is one edge");
  const glass = w.map.entities.filter((e) => e.classname === "func_breakable");
  sure(glass.length === 1 && Number(glass[0].material) === 0 && Number(glass[0].health) > 0, `the glass: ${glass.length} func_breakable, material ${glass[0]?.material} (0 wanted)`);
  sure(glass[0].brushes.every((b) => b.faces.every((f) => /GLASS/i.test(f.texture))), "the pane wears a glass texture");
  const g = glass[0];
  const pane = boundsOf(g.brushes);
  const mid = [(pane.min[0] + pane.max[0]) / 2, (pane.min[2] + pane.max[2]) / 2];
  const solid = [...w.map.brushes, ...w.map.entities.filter((e) => e !== g).flatMap((e) => e.brushes ?? [])].map(shapeOf).filter((s) => s.max[1] > -8 && s.min[1] < 8);
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
  sure(x1 - x0 >= 40, `the shop window's opening is ${x1 - x0} wide (x ${x0}..${x1}), 40 wanted`);
  sure(z0 <= 36 && z1 >= 140, `the shop window's clear opening is z ${z0}..${z1}, the sill at 32 and the head at 144 wanted (linings 4)`);
  // the wall's own opening: sill 32, head 144
  const wall = w.map.brushes.map(shapeOf);
  sure(wall.some((s) => s.max[2] === 32 && s.min[0] <= 8 && s.max[0] >= 56) && wall.some((s) => s.min[2] === 144 && s.min[0] <= 8 && s.max[0] >= 56), "the wall's opening is not sill 32, head 144");
  sure(near(w.glass.clear.flat(), [x0, z0, x1, z1]), `library.json's glass.clear ${w.glass.clear} is not the opening ${[x0, z0, x1, z1]}`);
});

test("mese pieces: the column's top meets the architrave's bottom at 176; the portico's slab is 176..192 with the architrave", () => {
  const column = lib.pieces.get("column");
  const architrave = lib.pieces.get("architrave");
  const portico = lib.pieces.get("portico");
  const cb = boundsOf(all(column.map));
  sure(cb.min[2] === 0 && cb.max[2] === 176, `the column stands z ${cb.min[2]}..${cb.max[2]}, 0..176 wanted`);
  sure(near([cb.min[0], cb.min[1], cb.max[0], cb.max[1]], [-20, -20, 20, 20]), `the column's base and capital are ${cb.max[0] - cb.min[0]} across, 40 wanted`);
  // the shaft: the narrowest of its parts, 24..28 across
  const widths = all(column.map).map(shapeOf).map((s) => s.max[0] - s.min[0]);
  sure(Math.min(...widths) >= 24 && Math.min(...widths) <= 28, `the shaft is ${Math.min(...widths)} across, 24..28 wanted`);
  const beam = architrave.map.brushes.map(shapeOf);
  sure(beam.length >= 1 && Math.min(...beam.map((s) => s.min[2])) === cb.max[2], `the architrave's beam begins at z ${Math.min(...beam.map((s) => s.min[2]))}, the column's top is ${cb.max[2]}`);
  sure(beam.every((s) => s.max[2] === 192 && s.min[0] === 0 && s.max[0] === 64 && s.min[1] === -8 && s.max[1] === 8), "the architrave's beam is x 0..64, y -8..8, to z 192");
  const slab = portico.map.brushes.map(shapeOf);
  sure(slab.length === 1 && near([...slab[0].min, ...slab[0].max], [0, 0, 176, 64, 64, 192]), `the portico's slab runs ${slab[0]?.min}..${slab[0]?.max}, the cell 0..64 at z 176..192 wanted`);
  // the capital is gold, the shaft not
  const tex = (s) => new Set(s.faces.map((f) => f.texture));
  const top = all(column.map).find((b) => shapeOf(b).max[2] === 176);
  sure(top && tex(top).has(lib.palette.trim), "the column's capital is not gold");
});

test("mese pieces: the stair rises 12 risers of 16 from 0 to the upper landing at 192", () => {
  const stair = lib.pieces.get("stair-u");
  const solid = stair.map.brushes.filter((b) => b.faces.every((f) => f.texture !== "CLIP"));
  const shapes = solid.map(shapeOf).filter((s) => s.corners.filter((c) => Math.abs(c[2] - s.max[2]) < 0.01).length >= 4);
  const tops = [...new Set(shapes.map((s) => Math.round(s.max[2])))].sort((a, b) => a - b);
  for (let z = 16; z <= 192; z += 16) sure(tops.includes(z), `no tread at z ${z}: the tops are ${tops}`);
  sure(Math.max(...tops) === 192 && Math.min(...shapes.map((s) => s.min[2])) === 0, `the stair runs ${Math.min(...shapes.map((s) => s.min[2]))}..${Math.max(...tops)}`);
  const landing = shapes.find((s) => s.max[2] === 192 && s.min[1] === 0 && s.max[1] === 64);
  sure(landing && landing.min[0] === 0 && landing.max[0] === 128, "the upper landing covers x 0..128, y 0..64 at z 192");
  const types = stair.connectors.map((c) => c.type);
  sure(types.includes("stair-foot") && types.includes("stair-top") && near(stair.footprint.flat(), [0, 0, 128, 256]), `connectors ${types}, footprint ${stair.footprint}`);
  // the house's stair, brush for brush in shape
  const house = loadLibrary(join(HERE, "../levels/assembly/pieces/hl")).pieces.get("stair-u");
  const shapesOf = (p) => all(p.map).map((b) => { const s = shapeOf(b); return [...s.min, ...s.max].map((v) => Math.round(v)).join(","); }).sort();
  sure(JSON.stringify(shapesOf(stair)) === JSON.stringify(shapesOf(house)), "the Mese's stair is not the house's in shape");
});

test("mese pieces: the landmark fits its 3 x 3 cells, centred, 448..512 high", () => {
  const p = lib.pieces.get("landmark");
  const b = boundsOf(all(p.map));
  sure(b.min[0] >= 0 && b.min[1] >= 0 && b.max[0] <= 192 && b.max[1] <= 192 && b.min[2] === 0, `the landmark runs ${b.min}..${b.max}, within (0,0,0)..(192,192) wanted`);
  sure(near([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2], [96, 96]), `the landmark's middle is ${(b.min[0] + b.max[0]) / 2}, ${(b.min[1] + b.max[1]) / 2}, 96, 96 wanted`);
  sure(b.max[2] >= 448 && b.max[2] <= 512, `the landmark is ${b.max[2]} high, 448..512 wanted`);
  sure(near(p.footprint.flat(), [0, 0, 192, 192]), `its footprint ${p.footprint}`);
  // the shaft is the dark stone, its top gold
  const shapes = all(p.map).map((x) => ({ s: shapeOf(x), tex: new Set(x.faces.map((f) => f.texture)) }));
  const tall = shapes.reduce((a, c) => (c.s.max[2] - c.s.min[2] > a.s.max[2] - a.s.min[2] ? c : a));
  sure(tall.tex.has(lib.palette.porphyry) && tall.s.max[2] - tall.s.min[2] >= 200, `the landmark's tallest part wears ${[...tall.tex]}, not the porphyry's ${lib.palette.porphyry}`);
  const highest = shapes.reduce((a, c) => (c.s.max[2] > a.s.max[2] ? c : a));
  sure(highest.tex.has(lib.palette.trim), "the landmark's top is not gold");
});
