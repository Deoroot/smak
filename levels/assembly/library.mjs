// levels/assembly, part P: the piece library read, a piece found for a slot, and a piece placed in the world.
//
//   loadLibrary(folder)                     -> { folder, format, game, wad, palette, texlights, pieces: Map(id -> entry) }
//                                              each entry is library.json's, with `map` (readMap of its .map; an
//                                              empty map for a piece with no file, "wall-open") and `palette`
//   pieceFor(library, slot, which)          -> the entry, or null. `which`: a kind ("door", "exterior", "rail"...),
//                                              a corner's mask (4 bits N E S W: N 8, E 4, S 2, W 1), or
//                                              `{ kind, mask }` (a corner where only rails meet: { mask, kind: "rail" })
//   placed(piece, { at, turn, world, outside, open }) -> { brushes, entities }
//                                              the piece turned `turn` degrees (0, 90, 180, 270, anticlockwise seen
//                                              from above) about its frame's origin, then moved to `at`. Texture
//                                              lock is kept; a face that was laid on the world's grid in the frame
//                                              (walls, floors: offset 0, scale 1, the world's axes) is laid on the
//                                              world's grid again where it lands (`world: false` keeps the lock on
//                                              those too), so neighbouring pieces line up whatever their turn.
//                                              Point entities' origins (and their `angles` yaw, `angle`) turn with
//                                              it; a brush entity's keys are left (a turning door's `angles` is its
//                                              start, not its place). `outside`: world ways ("north", "east",
//                                              "south", "west") whose faces wearing the palette's wall take its
//                                              brick: a corner post on the building's outline. `open`: a piece
//                                              with a leaf (`open` in its entry) has the leaf as a world brush
//                                              at its open position (`open.box`) in place of its door entity:
//                                              the variant the walk tests are run on
//   doorwayOf(piece, { want })              -> { width, height, span, leaf, failures }: a doorway piece's clear
//                                              opening measured from its brushes in its frame, with its leaf open
//                                              (the walls, casings and the open leaf's box; the closed leaf and
//                                              the origin brush left out), a sentence for each want it misses
//                                              (`want` [64, 112] unless told)
//   footprintOf(piece, { at, turn })        -> [[x0, y0], [x1, y1]] the plan box the piece's declared footprint covers
//   connectorsOf(piece, { at, turn })       -> the piece's connectors where it is placed
//   checkTextures(library, names, wadName)  -> { used, failures }: every texture a piece names held against a .wad's
//                                              names (wadTextureNames), a sentence for each one it lacks
//
// The pieces and their frames are in `pieces/hl/library.json`, made by `pieces/make-hl.mjs`.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readMap, moved, turned, planeOf, textureAxes, box, shapeOf } from "../../src/maps/source.mjs";

const SLOTS = ["edge", "corner", "floor", "ceiling", "stair", "rail", "lamp"];
const WAYS = { east: [1, 0, 0], north: [0, 1, 0], west: [-1, 0, 0], south: [0, -1, 0] };

/** The library in `folder` (its library.json and each piece's .map), every entry checked to name a slot and a file that is there. */
export function loadLibrary(folder) {
  const index = join(folder, "library.json");
  if (!existsSync(index)) throw new Error(`loadLibrary: there is no library.json in ${folder}`);
  const json = JSON.parse(readFileSync(index, "utf8"));
  const entries = Array.isArray(json) ? json : json.pieces;
  if (!Array.isArray(entries)) throw new Error(`loadLibrary: ${index} lists no pieces`);
  const pieces = new Map();
  for (const entry of entries) {
    if (!entry.id) throw new Error(`loadLibrary: a piece of ${index} has no id`);
    if (pieces.has(entry.id)) throw new Error(`loadLibrary: the piece ${entry.id} is listed twice`);
    if (!SLOTS.includes(entry.slot)) throw new Error(`loadLibrary: the piece ${entry.id} is in the slot ${entry.slot}, which is none of ${SLOTS.join(", ")}`);
    let map = { worldspawn: {}, brushes: [], entities: [] };
    if (entry.file) {
      const file = join(folder, entry.file);
      if (!existsSync(file)) throw new Error(`loadLibrary: the piece ${entry.id} names ${entry.file}, which is not in ${folder}`);
      map = readMap(readFileSync(file, "utf8"));
    }
    pieces.set(entry.id, { ...entry, map, palette: json.palette ?? {} });
  }
  return { folder, format: json.format, game: json.game, wad: json.wad, palette: json.palette ?? {}, texlights: json.texlights ?? {}, pieces };
}

/** The piece for a slot: by kind, by a corner's mask, or both. Null when the library has none. */
export function pieceFor(library, slot, which) {
  const want = typeof which === "object" && which !== null ? which : typeof which === "number" ? { mask: which } : { kind: which };
  const all = [...library.pieces.values()];
  // a rail is its own slot, and an edge too: an edge of kind "rail" finds it
  const slots = slot === "edge" && want.kind === "rail" ? ["rail", "edge"] : [slot];
  const fits = (p) =>
    slots.includes(p.slot) &&
    (want.mask === undefined || (p.masks ?? []).includes(want.mask)) &&
    (want.kind === undefined || (p.kinds ?? []).includes(want.kind));
  let found = all.filter(fits);
  // a corner asked for by its mask alone is a wall's corner
  if (slot === "corner" && want.kind === undefined) found = found.filter((p) => (p.kinds ?? ["wall"]).includes("wall"));
  return found[0] ?? null;
}

const QUARTERS = [0, 90, 180, 270];
const tidy = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : Math.round(v * 1e6) / 1e6);
const turnPoint = ([x, y, z], degrees) => {
  const a = (degrees * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e12) / 1e12;
  const s = Math.round(Math.sin(a) * 1e12) / 1e12;
  return [tidy(x * c - y * s), tidy(x * s + y * c), z];
};
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

/** Whether a face was laid on the world's grid as a new brush would be: the world's axes, no offset, no turn, scale 1. */
function onWorldGrid(face) {
  const plane = planeOf(face.points);
  if (!plane) return false;
  const axes = textureAxes(plane.normal);
  return (
    same(face.u.slice(0, 3), axes.u) && same(face.v.slice(0, 3), axes.v) &&
    face.u[3] === 0 && face.v[3] === 0 && (face.rotation ?? 0) === 0 && face.scale[0] === 1 && face.scale[1] === 1
  );
}

/** One brush placed: turned and moved with its pictures, those that were on the world's grid put on it again. */
function placeBrush(brush, at, turn, world) {
  const grid = brush.faces.map(onWorldGrid);
  const done = moved(turned(brush, turn, [0, 0, 0]), at);
  if (!world) return done;
  return {
    faces: done.faces.map((face, i) => {
      if (!grid[i]) return face;
      const axes = textureAxes(planeOf(face.points).normal);
      return { ...face, u: [...axes.u, 0], v: [...axes.v, 0] };
    }),
  };
}

/** A point entity's keys placed: its origin turned and moved, its yaw turned. */
function placeKeys(keys, at, turn) {
  const out = { ...keys };
  if (typeof keys.origin === "string") {
    const o = keys.origin.trim().split(/\s+/).map(Number);
    const p = turnPoint(o, turn);
    out.origin = [p[0] + at[0], p[1] + at[1], p[2] + at[2]].map(tidy).join(" ");
  }
  if (typeof keys.angles === "string") {
    const [pitch, yaw, roll] = keys.angles.trim().split(/\s+/).map(Number);
    out.angles = [pitch, tidy((((yaw + turn) % 360) + 360) % 360), roll].join(" ");
  }
  if (keys.angle !== undefined && Number(keys.angle) >= 0) out.angle = String(tidy((((Number(keys.angle) + turn) % 360) + 360) % 360));
  return out;
}

/** Faces looking one of `ways` (world) and wearing the palette's wall, given its brick. */
function paintOutside(brushes, ways, palette) {
  if (!ways?.length) return brushes;
  if (!palette.wall || !palette.brick) throw new Error("placed: `outside` needs the palette's wall and brick");
  const looks = ways.map((w) => {
    if (!WAYS[w]) throw new Error(`placed: a way outside is north, east, south or west, not ${w}`);
    return WAYS[w];
  });
  return brushes.map((brush) => ({
    faces: brush.faces.map((face) => {
      if (face.texture.toUpperCase() !== palette.wall.toUpperCase()) return face;
      const n = planeOf(face.points).normal;
      return looks.some((w) => n[0] * w[0] + n[1] * w[1] > 0.99) ? { ...face, texture: palette.brick } : face;
    }),
  }));
}

/** A piece placed in the world: `{ brushes, entities }` (world brushes, then the entities with theirs). */
export function placed(piece, { at = [0, 0, 0], turn = 0, world = true, outside, open = false } = {}) {
  if (!piece?.map) throw new Error("placed: a piece from loadLibrary (it has its map)");
  const t = ((turn % 360) + 360) % 360;
  if (!QUARTERS.includes(t)) throw new Error(`placed: a piece turns by 0, 90, 180 or 270 degrees, not ${turn}`);
  if (!(Array.isArray(at) && at.length === 3 && at.every(Number.isFinite))) throw new Error(`placed: at is [x, y, z], not ${JSON.stringify(at)}`);
  const palette = piece.palette ?? {};
  let mine = piece.map.brushes;
  let ents = piece.map.entities;
  if (open && piece.open) {
    const leaf = ents.find((e) => e.classname === piece.open.entity);
    if (!leaf) throw new Error(`placed: the piece ${piece.id} has no ${piece.open.entity} to open`);
    mine = [...mine, box(piece.open.box[0], piece.open.box[1], leafTexture(leaf))];
    ents = ents.filter((e) => e !== leaf);
  }
  const brushes = paintOutside(mine.map((b) => placeBrush(b, at, t, world)), outside, palette);
  const entities = ents.map(({ brushes: own, ...keys }) =>
    own?.length
      ? { ...keys, brushes: paintOutside(own.map((b) => placeBrush(b, at, t, world)), outside, palette) }
      : placeKeys(keys, at, t),
  );
  return { brushes, entities };
}

/** The compilers' own textures (their zhlt.wad), which a game's .wad does not hold. */
const COMPILER_TEXTURES = new Set(["CLIP", "ORIGIN", "NULL", "SKIP", "HINT", "AAATRIGGER", "BEVEL", "SOLIDHINT", "BOUNDINGBOX", "CONTENTWATER", "SPLITFACE"]);

/**
 * Every texture the library's pieces name, held against a .wad's names (`wadTextureNames(bytes)`):
 * `{ used, failures }`, a sentence for each piece and name the .wad does not have.
 */
export function checkTextures(library, names, wadName = "halflife.wad") {
  const have = new Set([...names].map((n) => n.toUpperCase()));
  const used = new Set();
  const failures = [];
  for (const [id, piece] of library.pieces) {
    const own = new Set();
    for (const brush of [...piece.map.brushes, ...piece.map.entities.flatMap((e) => e.brushes ?? [])])
      for (const face of brush.faces) own.add(face.texture.toUpperCase());
    for (const name of [...own].sort()) {
      if (COMPILER_TEXTURES.has(name)) continue;
      used.add(name);
      if (!have.has(name)) failures.push(`the piece ${id} names the texture ${name}, which is not among the ${have.size} textures of ${wadName}`);
    }
  }
  return { used: [...used].sort(), failures };
}

/** A piece's connectors where it is placed: `[{ type, at, facing }]` in the world. */
export function connectorsOf(piece, { at = [0, 0, 0], turn = 0 } = {}) {
  return (piece.connectors ?? []).map((c) => {
    const p = turnPoint(c.at, turn);
    const f = turnPoint(c.facing, turn);
    return { ...c, at: [p[0] + at[0], p[1] + at[1], p[2] + at[2]].map(tidy), facing: f.map((v) => tidy(v) + 0) };
  });
}

/** The plan box a piece's declared footprint covers once placed. */
export function footprintOf(piece, { at = [0, 0, 0], turn = 0 } = {}) {
  const [[x0, y0], [x1, y1]] = piece.footprint;
  const corners = [[x0, y0, 0], [x1, y0, 0], [x0, y1, 0], [x1, y1, 0]].map((p) => turnPoint(p, turn));
  const xs = corners.map((p) => p[0] + at[0]);
  const ys = corners.map((p) => p[1] + at[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

const isOrigin = (b) => b.faces.every((f) => f.texture.toUpperCase() === "ORIGIN");
/** The texture a leaf wears most (its origin brush left out). */
function leafTexture(entity) {
  const count = new Map();
  for (const b of entity.brushes ?? []) if (!isOrigin(b)) for (const f of b.faces) count.set(f.texture, (count.get(f.texture) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NULL";
}

/**
 * A doorway piece's clear opening in its frame, with its leaf open: the widest run along x round the connector,
 * between y -32 and the open leaf's far end, from just over the floor to a standing player's 72, that no solid
 * brush (world, func_detail, CLIP, the open leaf's box) stands in; and the height over the connector's middle
 * 32 within the wall's thickness. `{ width, height, span: [x0, x1], leaf: [x0, x1], failures }`.
 */
export function doorwayOf(piece, { want = [64, 112] } = {}) {
  const c = piece.connectors?.find((k) => k.type.startsWith("doorway")) ?? piece.connectors?.[0];
  if (!c) throw new Error(`doorwayOf: the piece ${piece.id} has no connector`);
  if (!piece.open) throw new Error(`doorwayOf: the piece ${piece.id} has no "open" entry for its leaf`);
  const solid = [
    ...piece.map.brushes,
    ...piece.map.entities.filter((e) => e.classname !== piece.open.entity).flatMap((e) => e.brushes ?? []),
  ].filter((b) => !isOrigin(b)).map((b) => { const s = shapeOf(b); return { min: s.min, max: s.max, leaf: false }; });
  solid.push({ min: piece.open.box[0], max: piece.open.box[1], leaf: true });
  const [cx, , cz] = c.at;
  const over = (b, axis, lo, hi) => b.max[axis] > lo + 1e-6 && b.min[axis] < hi - 1e-6;
  const yFar = Math.max(32, piece.open.box[1][1] + 8);
  const band = solid.filter((b) => over(b, 1, -32, yFar) && over(b, 2, cz, cz + 72));
  let lo = -Infinity;
  let hi = Infinity;
  let loLeaf = false;
  let hiLeaf = false;
  for (const b of band) {
    if (b.max[0] <= cx + 1e-6) { if (b.max[0] > lo) { lo = b.max[0]; loLeaf = b.leaf; } }
    else if (b.min[0] >= cx - 1e-6) { if (b.min[0] < hi) { hi = b.min[0]; hiLeaf = b.leaf; } }
    else { lo = hi = cx; loLeaf = hiLeaf = b.leaf; }
  }
  const width = hi - lo;
  const above = solid.filter((b) => !b.leaf && over(b, 0, cx - 16, cx + 16) && over(b, 1, -8, 8) && b.max[2] > cz + 1e-6);
  const height = Math.min(...above.map((b) => b.min[2])) - cz;
  const failures = [];
  const name = `the piece ${piece.id}`;
  if (!(width >= want[0])) {
    const leaf = loLeaf || hiLeaf ? `: its open leaf (x ${piece.open.box[0][0]}..${piece.open.box[1][0]}) stands in the opening` : "";
    failures.push(`${name}'s doorway is ${width} wide with its leaf open (x ${lo}..${hi}), ${want[0]} wanted${leaf}`);
  }
  if (!(height >= want[1])) failures.push(`${name}'s doorway is ${height} high over its floor, ${want[1]} wanted`);
  return { width, height, span: [lo, hi], leaf: [piece.open.box[0][0], piece.open.box[1][0]], failures };
}
