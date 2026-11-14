// Props on the floor of a map: the points a model stands on, the floor under each, and the height that stands a
// prop on a compiled map's floor (a terrain compiled first, its props grounded, their entities written after).
//
//   footOf(figure)                                 the points of its foot, where the floor is looked for under it
//   floorsUnder(solid, points, bottom, top)         the floor's z under each point, or null: none within reach
//   groundProps(bsp, entities, options)            each prop's origin z on the floor, and those it could not place
import { contentsAt, CONTENTS } from "../../core/maps/bsp.mjs";
import { valueOf } from "../../core/maps/entities.mjs";
import { figuresOf } from "./figures.mjs";

/** Scenery: a model put there to be looked at (a lamp, a rock, a banner), no place a player goes to. */
export const SCENERY = /^(ts_model|cycler|cycler_sprite|env_model)$/;
/** The box about a studio model whose file is not found (no game folders given): a small prop's, its origin its foot. */
export const MODEL_BOX = [[-16, -16, 0], [16, 16, 32]];
/** How far under a prop's foot the floor is looked for (units). */
export const FLOOR_REACH = 128;
/** A model's points this near its lowest one are its foot: what stands on the floor (units). */
const FOOT = 8;
/** The ways a foot's outermost points are taken in: its footprint's corners and sides, whatever way it is turned. */
const WAYS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * The points in plan, `[[x, y]]`, the floor is looked for under: of a model drawn with its triangles (`figuresOf`), the
 * outermost of its points within 8 of its lowest, each of eight ways (a banner's two posts, a tree's trunk and not its
 * crown); else nine over its box's footprint (its corners, turned as it is, when it has them), inset a tenth.
 */
export function footOf(figure) {
  const foot = figure.triangles?.flatMap((triangle) => triangle.points).filter((point) => point[2] <= figure.min[2] + FOOT);
  if (foot?.length) return [...new Set(WAYS.map(([dx, dy]) => foot.reduce((best, p) => (p[0] * dx + p[1] * dy > best[0] * dx + best[1] * dy ? p : best))))].map((p) => [p[0], p[1]]); // prettier-ignore
  const [a, b, c, d] = figure.corners ?? [[figure.min[0], figure.min[1]], [figure.max[0], figure.min[1]], [figure.max[0], figure.max[1]], [figure.min[0], figure.max[1]]]; // prettier-ignore
  const along = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  return [0.1, 0.5, 0.9].flatMap((u) => [0.1, 0.5, 0.9].map((v) => along(along(a, b, u), along(d, c, u), v)));
}

/**
 * The floor under each point, going down from the prop's foot (`bottom`): its z; null when there is none within
 * `reach` under the foot; Infinity where it is solid from the foot to `reach` over its top (in a wall, past the map's
 * edge). Where the foot is in solid the floor is looked for from higher (a prop sunk in a dune: the floor is over it). `solid([x, y, z])` says what is solid: a compiled map's world
 * (`solidOf`), or brush source's.
 */
export function floorsUnder(solid, points, bottom, top, reach = FLOOR_REACH) {
  return points.map(([x, y]) => {
    const from = [bottom + 1, (bottom + top) / 2, top, top + reach].find((z) => !solid([x, y, z]));
    if (from === undefined) return Infinity;
    for (let z = from; z >= bottom - reach; z -= 1) {
      if (!solid([x, y, z - 1])) continue;
      // the floor closed in on by halves between the last open height and the first solid one, to a 16th
      let [open, hard] = [z, z - 1];
      for (let halving = 0; halving < 8; halving++) solid([x, y, (open + hard) / 2]) ? (hard = (open + hard) / 2) : (open = (open + hard) / 2); // prettier-ignore
      return Math.round(open * 16) / 16 + 0;
    }
    return null;
  });
}

/** What is solid in a compiled map's world (hull 0, as the engine draws it): its sky too, the walls round an outdoor map. */
export const solidOf = (bsp) => (point) => [CONTENTS.SOLID, CONTENTS.SKY].includes(contentsAt(bsp, point));

/** A value given per call or per prop: a number, or `{ [model's name without .mdl, or class]: n, "*": n }`. */
const perProp = (value, keys, otherwise) => (value !== null && typeof value === "object" ? keys.map((key) => value[key]).find((n) => n !== undefined) ?? value["*"] ?? otherwise : value ?? otherwise); // prettier-ignore

/**
 * Each prop of a compiled map stood on its floor: `{ placed, unplaced }`. `entities`: the map's own (`bsp.entities`,
 * as pairs) or those about to be written (objects, `pointEntity`'s), numbered by their place in the list. A prop is a
 * point entity of a class of `classes` (scenery unless told) whose `model` is a .mdl; its box and foot are its model's,
 * read from `folders` (the game's), else `MODEL_BOX` with its origin as its foot. Its foot is looked for the floor under
 * at several points (`footOf`), and its origin's z made what stands its lowest point on the lowest floor found less a
 * `sink`; a prop is not placed (`unplaced`, with `why` and that z) where some of its foot has no floor within `reach`
 * (an edge), none has (no floor), or the floor under it rises more than `tolerance` across it (too steep).
 *   sink        units into the floor (0 unless told), or "origin": as deep as its model reaches under its origin (a
 *               model made with a base to bury); per prop as `{ rock1: 10, ts_model: 3, "*": 0 }`
 *   tolerance   the most the floor may rise across its foot (32 unless told); per prop as `sink`
 * Each is `{ number, classname, model, origin, z, low, high, points, why? }`: `low` and `high` the floor under its foot.
 */
export function groundProps(bsp, entities = bsp.entities, { folders = [], classes = SCENERY, sink = 0, tolerance = 32, reach = FLOOR_REACH } = {}) {
  const things = entities.map((entity, number) => {
    const key = (name) => (Array.isArray(entity) ? valueOf(entity, name) : entity[name]);
    const vector = (name) => (key(name) === undefined ? null : (Array.isArray(key(name)) ? key(name) : String(key(name)).trim().split(/\s+/)).map(Number)); // prettier-ignore
    const angles = vector("angles") ?? [0, Number(key("angle") ?? 0) || 0, 0];
    return { number, classname: String(key("classname") ?? ""), origin: vector("origin"), angles, yaw: angles[1], model: null, modelFile: key("model"), targetname: key("targetname"), pose: { body: key("body"), skin: key("skin"), sequence: key("sequence"), frame: key("frame"), scale: key("scale") } }; // prettier-ignore
  }).filter((thing) => classes.test(thing.classname) && /\.mdl$/i.test(thing.modelFile ?? "") && thing.origin?.length === 3 && thing.origin.every(Number.isFinite)); // prettier-ignore
  const { figures } = figuresOf(things, { models: true, folders });
  const solid = solidOf(bsp);
  const placed = [];
  const unplaced = [];
  for (const thing of things) {
    const figure = figures.get(thing.number) ?? { min: thing.origin.map((v, k) => v + MODEL_BOX[0][k]), max: thing.origin.map((v, k) => v + MODEL_BOX[1][k]) }; // prettier-ignore
    const points = footOf(figure);
    const floors = floorsUnder(solid, points, figure.min[2], figure.max[2], reach);
    const found = floors.filter(Number.isFinite);
    const name = thing.modelFile.replace(/^.*[\\/]/, "").replace(/\.mdl$/i, "");
    const keys = [name, thing.classname];
    const prop = { number: thing.number, classname: thing.classname, model: thing.modelFile, origin: thing.origin, points: points.length };
    if (!found.length) {
      unplaced.push({ ...prop, z: null, low: null, high: null, why: floors.includes(null) ? `no floor within ${reach} under its foot` : "its foot is in solid (a wall, or past the map's edge)" }); // prettier-ignore
      continue;
    }
    const [low, high] = [Math.min(...found), Math.max(...found)];
    const sunk = perProp(sink, keys, 0) === "origin" ? Math.max(0, thing.origin[2] - figure.min[2]) : perProp(sink, keys, 0);
    const z = Math.round((thing.origin[2] + low - sunk - figure.min[2]) * 10) / 10;
    const steep = perProp(tolerance, keys, 32);
    const why = floors.includes(null) ? `${floors.filter((floor) => floor === null).length} of ${floors.length} points of its foot have no floor within ${reach} (an edge)` : high - low > steep ? `the floor rises ${Math.round(high - low)} across its foot, over the ${steep} it may (too steep)` : null; // prettier-ignore
    (why ? unplaced : placed).push({ ...prop, z, low, high, ...(why ? { why } : {}) });
  }
  return { placed, unplaced };
}
