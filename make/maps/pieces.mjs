// Pieces a mapper builds again and again, made to measure: a spiral stair, a bridge, a railing, a balcony, a
// broken wall, a face of rough rock; and a map a person added to by hand, kept when the kit builds it again.
//
// Each returns a list of brushes (world brushes, or put them in an entity: `brushEntity("func_detail", ...)`
// for what only decorates, so that it does not cut the world for hlvis). Lines and points are in plan,
// [x, y]; heights are z. Every piece is checked against a player's numbers where it is walked: a step of 18 at
// the most, a tread a player's width can stand on, a head's room under the turn above.
import { prism, solid, terrain, turned, moved, cylinder, cone, box, STEP_HEIGHT, planesOf, readMap, shapeOf, withScale } from "./source.mjs";
import { path } from "./ground.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** A standing player's height, and the room a head wants over a step (units). */
const PLAYER_HEIGHT = 72;
/** The narrowest tread a player is sure to stand on at a stair's middle (units). */
const LEAST_TREAD = 16;
/** A brush's planes, as `pieceKey` compares them: normals to this, distances to this. */
const NORMAL_GRAIN = 1e3;
const DIST_GRAIN = 1e1;

// ── small arithmetic in plan ────────────────────────────────────────────────
const round = (value, grid = 1) => (grid ? Math.round(value / grid) * grid + 0 : value);
const lengthOf = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** The unit vector from a to b, and the one to its left. */
function frameOf(a, b, who) {
  const length = lengthOf(a, b);
  if (!(length > 0)) throw new Error(`${who}: its two ends are one point`);
  const along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  return { length, along, left: [-along[1], along[0]] };
}
const at = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
/** A seeded random number of 0 to 1 for whole numbers i, j (the same each run). */
function hashed(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth noise of 0 to 1 over the plane, from whole-number corners (bilinear, eased). */
function smoothNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const ease = (t) => t * t * (3 - 2 * t);
  const fx = ease(x - xi);
  const fy = ease(y - yi);
  const a = hashed(xi, yi, seed);
  const b = hashed(xi + 1, yi, seed);
  const c = hashed(xi, yi + 1, seed);
  const d = hashed(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// ── a spiral stair ──────────────────────────────────────────────────────────
/**
 * A spiral stair round `centre`: steps from `from` up to `to`, each a wedge between `inner` and `outer`
 * radius, starting at `start` degrees (0 east, 90 north) and turning anticlockwise as it climbs (`turn: -1`:
 * clockwise). `rise` (16) is the most a step climbs; `tread` (32) is a step's depth at the middle of its
 * width. A column fills the middle when `inner` is over 0 (`column: false`: none). `thick`: each step's
 * slab, one rise unless told, so that each wedge's underside is the top of the one before and the risers
 * stand as one surface (a slab thicker than the rise hangs under the step before it: blocks, not steps).
 * `end` degrees, in place of `start`, is where the last step's middle is: the stair is turned so that its top
 * faces a door. `landing`: `{ to: [x, y], width }` adds a bridge at the top, from the last wedge out to the
 * point `to` (a door's sill, a floor's edge), `width` wide, so the top is walked off to it. The corners are
 * on whole units (two steps share theirs, so no sliver is cut between them). A stair whose turn above comes
 * nearer than a player's height over a step is refused, as is a tread under 16 at its middle or a step over
 * 18. It returns `{ brushes, top: [x, y, z] }`: where the last step's middle is, to go on from.
 */
export function spiralStairs({
  centre,
  inner = 32,
  outer,
  from,
  to,
  start = 0,
  end,
  turn = 1,
  rise = 16,
  tread = 32,
  thick = rise,
  column = true,
  landing,
  texture,
  columnTexture = texture,
}) {
  const who = "spiralStairs";
  if (!(outer > inner && inner >= 0))
    throw new Error(`${who}: outer (${outer}) beyond inner (${inner}), neither under 0`);
  if (!(to > from)) throw new Error(`${who}: it climbs: to (${to}) over from (${from})`);
  const steps = Math.ceil((to - from) / rise);
  const climb = (to - from) / steps;
  if (climb > STEP_HEIGHT)
    throw new Error(`${who}: a step of ${climb} is more than a player walks up (${STEP_HEIGHT})`);
  if (!(tread >= LEAST_TREAD))
    throw new Error(
      `${who}: a tread of ${tread} at its middle is too narrow to stand on (${LEAST_TREAD} at least)`,
    );
  const middle = (inner + outer) / 2;
  const sweep = tread / middle;
  if (sweep >= Math.PI)
    throw new Error(
      `${who}: a tread of ${tread} turns more than half round at radius ${middle}: make it wider or the tread shorter`,
    );
  // a full turn climbs this much: the step above a player's head is that far over the step under them
  const perTurn = ((2 * Math.PI) / sweep) * climb;
  if (steps * sweep > 2 * Math.PI && perTurn - thick < PLAYER_HEIGHT)
    throw new Error(
      `${who}: one turn climbs ${Math.round(perTurn)}, which leaves ${Math.round(perTurn - thick)} under the step above, less than a player's ${PLAYER_HEIGHT}: a longer tread, or a wider stair`,
    );
  const point = (radius, angle) => [
    round(centre[0] + radius * Math.cos(angle)),
    round(centre[1] + radius * Math.sin(angle)),
  ];
  const first =
    end === undefined ? (start * Math.PI) / 180 : (end * Math.PI) / 180 - turn * (steps - 0.5) * sweep;
  const brushes = [];
  for (let k = 0; k < steps; k++) {
    const a0 = first + turn * k * sweep;
    const a1 = a0 + turn * sweep;
    const ring =
      inner > 0
        ? [point(inner, a0), point(outer, a0), point(outer, a1), point(inner, a1)]
        : [[...centre], point(outer, a0), point(outer, a1)];
    const top = from + climb * (k + 1);
    brushes.push(prism("z", ring, Math.max(from, top - thick), top, texture));
  }
  // the landing: a bridge from inside the last wedge's outer edge to the sill it is walked off to
  if (landing) {
    const way = [landing.to[0] - centre[0], landing.to[1] - centre[1]];
    const far = Math.hypot(...way) || 1;
    const half = [(-way[1] / far) * (landing.width / 2), (way[0] / far) * (landing.width / 2)];
    const foot = (outer * Math.cos(sweep / 2) - 8) / far;
    const at = (p, k) => [Math.round(p[0] + half[0] * k), Math.round(p[1] + half[1] * k)];
    const near = [centre[0] + way[0] * foot, centre[1] + way[1] * foot];
    const deck = [at(near, -1), at(landing.to, -1), at(landing.to, 1), at(near, 1)];
    brushes.push(prism("z", deck, to - thick, to, texture));
  }
  if (column && inner > 0)
    brushes.push(cylinder("z", centre, inner, from, to + PLAYER_HEIGHT + 16, columnTexture, { sides: 12, snap: 1 })); // prettier-ignore
  return { brushes, top: [...point(middle, first + turn * (steps - 0.5) * sweep), to] };
}

// ── lamps built as fixtures: a wall's sconce, a chandelier ──────────────────
/**
 * A wall sconce: a shade of glass standing out from a wall, on a plate, its glass a light's texture (one the map's
 * texture lights name, `textureLights` or a mod's lamps), so the lamp is seen and lights as Valve's and The
 * Specialists' lamps do (a light entity in mid-air lights a wall with nothing shining on it). `at` is the point
 * on the wall's face at the shade's foot, `facing` the way out of the wall in degrees (0 east, 90 north: any
 * angle), `width` across the wall (24), `height` the glass's (32), `depth` how far it stands out (12); `glass`
 * the light's texture, `metal` the plate's and the caps' (`plate: false`, the shade alone). `shape`: "fan" (faceted, opening upward, the period's),
 * "drum" (half a cylinder) or "box". → `{ brushes, light }`: `light` the point in front of the glass where a
 * `light` entity of its own goes, if one is wanted.
 */
export function sconce({ at: foot, facing = 0, width = 24, height = 32, depth = 12, glass, metal, shape = "fan", plate = true }) {
  if (!Array.isArray(foot) || foot.length !== 3) throw new Error("sconce: at is [x, y, z], the foot of its shade on the wall's face");
  if (!glass || !metal) throw new Error("sconce: its glass (a light's texture) and its metal");
  if (!(width >= 8 && height >= 8 && depth >= 4)) throw new Error(`sconce: width and height 8 or more, depth 4 or more (${width}, ${height}, ${depth})`);
  if (!["fan", "drum", "box"].includes(shape)) throw new Error(`sconce: shape is fan, drum or box, not ${shape}`);
  const half = width / 2;
  const [z0, z1] = [foot[2], foot[2] + height];
  const r = (v) => Math.round(v * 100) / 100;
  // built facing +x at the origin, its back on x = 0; then turned and moved
  // its plate on the wall (`plate: false`: none, the shade alone: fewer faces where many hang in one view)
  const made = plate ? [box([-2, -half - 3, z0 - 6], [0, half + 3, z1 + 6], metal)] : [];
  const caps = { top: metal, bottom: metal, sides: glass };
  if (shape === "box") made.push(box([0, -half, z0], [depth, half, z1], caps));
  else if (shape === "drum") {
    const sides = 8;
    const outline = Array.from({ length: sides + 1 }, (_, k) => {
      const a = -Math.PI / 2 + (Math.PI * k) / sides;
      return [r(depth * Math.cos(a)), r(half * Math.sin(a))];
    });
    made.push(prism("z", outline, z0, z1, caps));
  } else {
    // a fan: narrow at its foot, opening upward, faceted (half an octagon in plan that grows with its height)
    const ring = (k) => [[0, -half * k], [depth * 0.55 * k, -half * 0.8 * k], [depth * k, -half * 0.3 * k], [depth * k, half * 0.3 * k], [depth * 0.55 * k, half * 0.8 * k], [0, half * k]];
    const low = ring(0.55).map(([x, y]) => [r(x), r(y), z0]);
    const high = ring(1).map(([x, y]) => [r(x), r(y), z1]);
    made.push(solid([...low, ...high], (n) => (Math.abs(n[2]) > 0.9 ? metal : glass)));
    made.push(box([0, r(-half * 1.05), z1], [r(depth * 1.05), r(half * 1.05), z1 + 2], metal));
  }
  const brushes = moved(turned(made, facing, [0, 0, 0]), [foot[0], foot[1], 0]);
  const a = (facing * Math.PI) / 180;
  const light = [foot[0] + Math.cos(a) * (depth + 12), foot[1] + Math.sin(a) * (depth + 12), (z0 + z1) / 2];
  return { brushes, light: light.map((v) => Math.round(v)) };
}

/**
 * A chandelier hung from a ceiling: a canopy on the ceiling at `top`, a rod down `drop` units, and tiers of glass
 * under it, each a drum of `sides` (8) narrower than the one over it (`radius` the widest, 32; `tiers` 3; each
 * `tier` high, 10, a ring of metal between), ending in a cone of glass. Its glass wears `glass` (a light's
 * texture), the rest `metal`. → `{ brushes, light, low }`: `light` its middle (a light entity's place, if one is
 * wanted), `low` the height of its lowest point (keep it over a head where a player walks: 72 over the floor, more).
 * `lens`: "drums" (the default) wraps each drum in glass; "under" gives the drums metal sides and glass only on
 * their undersides and the cone, and puts `light` 12 under the lowest point. A light's texture on every side of
 * a drum, with a light entity in its middle, lights itself to white in Xash and reads from the side and from
 * afar as a glowing block hanging in the air: "under" shows gold rings from the side and lit glass from below.
 */
export function chandelier({ centre, top, drop = 64, radius = 32, tiers = 3, tier = 10, sides = 8, glass, metal, lens = "drums" }) {
  if (lens !== "drums" && lens !== "under") throw new Error(`chandelier: lens is "drums" or "under", not ${JSON.stringify(lens)}`);
  if (!Array.isArray(centre) || centre.length !== 2) throw new Error("chandelier: centre is [x, y]");
  if (!glass || !metal) throw new Error("chandelier: its glass (a light's texture) and its metal");
  if (!(radius >= 8 && tiers >= 1 && tier >= 4 && drop >= 4)) throw new Error("chandelier: radius 8 or more, a tier at least, each 4 high or more, a drop of 4 or more");
  const [x, y] = centre;
  const brushes = [cylinder("z", centre, Math.max(6, radius / 4), top - 4, top, metal, { sides })];
  brushes.push(box([x - 1, y - 1, top - 4 - drop], [x + 1, y + 1, top - 4], metal));
  let z = top - 4 - drop;
  const caps = lens === "under" ? { top: metal, bottom: glass, sides: metal } : { top: metal, bottom: metal, sides: glass };
  for (let k = 0; k < tiers; k++) {
    const r = Math.max(4, Math.round(radius * (1 - (0.6 * k) / Math.max(1, tiers))));
    brushes.push(cylinder("z", centre, r + 2, z - 2, z, metal, { sides }));
    brushes.push(cylinder("z", centre, r, z - 2 - tier, z - 2, caps, { sides }));
    z -= tier + 2;
  }
  const last = Math.max(4, Math.round(radius * 0.4));
  brushes.push(cone("z", centre, last, z, z - Math.max(6, last), glass, { sides }));
  const low = z - Math.max(6, last);
  const light = lens === "under" ? [x, y, low - 12] : [x, y, Math.round((top - 4 - drop + low) / 2)];
  return { brushes, light, low };
}

// ── a bridge, a railing, a balcony ──────────────────────────────────────────
/**
 * A railing along a line of points at floor height `z`, `height` high (40). `kind`:
 *   "slab"   (the default) a bar `thick` wide (8) and `height` high on each stretch, a post at each corner: a
 *            parapet. In the game a slab 40 high in a metal's or a gold's picture reads as a wall of it
 *   "bars"   a handrail `rail` square (6) on top, a bottom rail the same 4 over the floor, posts `post` square
 *            (rail + 2) at the ends, the corners and every `spacing` (96) along a stretch, and balusters `bar`
 *            square (3) every `gap` (16) between the rails; every corner a whole unit. A stretch of 1536 at a gap
 *            of 16 is some 90 brushes: a bars railing goes in a `func_detail` or a `func_wall`, not in the world
 *   "panel"  the handrail and the posts of "bars", and in place of the balusters a slab `thick` thick from 4 over
 *            the floor to under the handrail: a parapet with a rail
 * `scale` is the picture's scale on every face (a number or [x, y]). It returns a list of brushes.
 */
export function railing(points, { z, height = 40, thick = 8, kind = "slab", rail = 6, bar = 3, post = rail + 2, spacing = 96, gap = 16, texture, scale }) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("railing: two points at least");
  if (!["slab", "bars", "panel"].includes(kind)) throw new Error(`railing: kind is slab, bars or panel, not ${kind}`);
  texture = withScale(texture, scale);
  const brushes = [];
  if (kind === "slab") {
    for (let i = 0; i + 1 < points.length; i++)
      for (const outline of path([points[i], points[i + 1]], thick, { snap: 0 }))
        brushes.push(prism("z", outline, z, z + height, texture));
    for (const corner of points.slice(1, -1)) {
      const half = thick * 0.75;
      brushes.push(prism("z", [[corner[0] - half, corner[1] - half], [corner[0] + half, corner[1] - half], [corner[0] + half, corner[1] + half], [corner[0] - half, corner[1] + half]], z, z + height + 4, texture)); // prettier-ignore
    }
    return brushes;
  }
  if (!(height > 2 * rail + 5)) throw new Error(`railing: ${height} high leaves no room between a bottom rail 4 over the floor and a handrail ${rail} high`);
  const top = z + height;
  /** An upright `side` square standing on a point, its corners whole units. */
  const upright = (p, side, from, to) => {
    const min = [round(p[0] - side / 2), round(p[1] - side / 2)];
    return box([min[0], min[1], from], [min[0] + side, min[1] + side, to], texture);
  };
  /** A member `wide` across along a stretch, between two heights. */
  const member = (a, b, wide, from, to) => prism("z", path([a, b], wide, { snap: 1 })[0], from, to, texture);
  for (const corner of points) brushes.push(upright(corner, post, z, top));
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const { length, along } = frameOf(a, b, "railing");
    brushes.push(member(a, b, rail, top - rail, top));
    const bays = Math.max(1, Math.ceil(length / spacing));
    const bay = length / bays;
    for (let k = 1; k < bays; k++) brushes.push(upright(at(a, along, bay * k), post, z, top - rail));
    if (kind === "panel") {
      brushes.push(member(a, b, thick, z + 4, top - rail));
      continue;
    }
    brushes.push(member(a, b, rail, z + 4, z + 4 + rail));
    const count = Math.max(1, Math.round(bay / gap));
    for (let k = 0; k < bays; k++)
      for (let j = 1; j < count; j++) brushes.push(upright(at(a, along, bay * k + (bay * j) / count), bar, z + 4 + rail, top - rail));
  }
  return brushes;
}

/**
 * A bridge from `from` to `to` (points in plan) at any angle: a deck `width` wide whose top is at `z`,
 * `thick` thick, with a railing `rails` high on both sides (0: none) and `piers` piers under it down to
 * `ground`. It returns a list of brushes.
 */
export function bridge({
  from,
  to,
  z,
  width = 128,
  thick = 16,
  rails = 40,
  rail = 8,
  piers = 0,
  ground,
  pier = 32,
  texture,
  railTexture = texture,
  pierTexture = texture,
}) {
  const { length, along, left } = frameOf(from, to, "bridge");
  const brushes = path([from, to], width, { snap: 0 }).map((outline) =>
    prism("z", outline, z - thick, z, texture),
  );
  if (rails > 0)
    for (const side of [1, -1]) {
      const edge = (width / 2 - rail / 2) * side;
      brushes.push(
        ...railing([at(from, left, edge), at(to, left, edge)], {
          z,
          height: rails,
          thick: rail,
          texture: railTexture,
        }),
      );
    }
  if (piers > 0) {
    if (!Number.isFinite(ground) || !(ground < z - thick))
      throw new Error("bridge: piers stand on the ground: give `ground` under the deck");
    for (let k = 1; k <= piers; k++) {
      const middle = at(from, along, (length * k) / (piers + 1));
      for (const outline of path(
        [at(middle, along, -pier / 2), at(middle, along, pier / 2)],
        width - 2 * rail,
        { snap: 0 },
      ))
        brushes.push(prism("z", outline, ground, z - thick, pierTexture));
    }
  }
  return brushes;
}

/**
 * A balcony on a wall: `wall` is the line [a, b] of the wall's face, and the balcony stands out `depth`
 * from it to the LEFT of a → b (walking from a to b, the open air is on the left). Its floor's top is at `z`,
 * `thick` thick, with a railing `rails` high round its three open sides. It returns a list of brushes.
 */
export function balcony({
  wall: [a, b],
  depth = 64,
  z,
  thick = 8,
  rails = 40,
  rail = 6,
  texture,
  railTexture = texture,
}) {
  const { left } = frameOf(a, b, "balcony");
  const outA = at(a, left, depth);
  const outB = at(b, left, depth);
  const brushes = [prism("z", [a, b, outB, outA], z - thick, z, texture)];
  if (rails > 0) {
    const inset = rail / 2;
    const { along } = frameOf(a, b, "balcony");
    const p = (point, k1, k2) => at(at(point, left, k1), along, k2);
    brushes.push(...railing([p(a, inset, inset), p(outA, -inset, inset), p(outB, -inset, -inset), p(b, inset, -inset)], { z, height: rails, thick: rail, texture: railTexture })); // prettier-ignore
  }
  return brushes;
}

// ── ruins and rock ──────────────────────────────────────────────────────────
/**
 * A broken wall from `from` to `to`, `thick` thick, standing on `bottom`: cut in `pieces` lengths whose tops
 * slope between heights from `low` to `top`, chosen by `seed`, so that its top is jagged; `gaps` (0 to 1)
 * is the share of the lengths fallen down to `bottom + rubble`. It returns a list of brushes.
 */
export function brokenWall({
  from,
  to,
  thick = 16,
  bottom,
  top,
  low,
  pieces = 6,
  gaps = 0,
  rubble = 8,
  seed = 1,
  texture,
}) {
  const { length, along, left } = frameOf(from, to, "brokenWall");
  if (!(top > bottom)) throw new Error("brokenWall: top over bottom");
  low ??= bottom + (top - bottom) * 0.35;
  const heights = Array.from({ length: pieces + 1 }, (_, i) => round(low + (top - low) * hashed(i, 0, seed)));
  const brushes = [];
  for (let i = 0; i < pieces; i++) {
    const fallen = hashed(i, 1, seed) < gaps;
    const h0 = fallen ? bottom + rubble : heights[i];
    const h1 = fallen ? bottom + rubble : heights[i + 1];
    const a = at(from, along, (length * i) / pieces);
    const b = at(from, along, (length * (i + 1)) / pieces);
    // three corners rounded, the fourth from them: rounded alone, a sloped top's corners fall out of one plane
    const [ar, br, al] = [at(a, left, -thick / 2), at(b, left, -thick / 2), at(a, left, thick / 2)].map(([x, y]) => [round(x, 0.001), round(y, 0.001)]); // prettier-ignore
    const corners = [ar, br, [br[0] + al[0] - ar[0], br[1] + al[1] - ar[1]], al];
    const tops = [h0, h1, h1, h0];
    brushes.push(
      solid(
        [...corners.map(([x, y]) => [x, y, bottom]), ...corners.map(([x, y], k) => [x, y, tops[k]])],
        texture,
        {
          faces: [[0, 1, 2], [4, 5, 6], [0, 1, 4], [1, 2, 5], [2, 3, 6], [3, 0, 7]], // prettier-ignore
        },
      ),
    );
  }
  return brushes;
}

/**
 * A face of rough rock standing along the line `from` → `to`, from `bottom` to `top`: its back on the line,
 * its face standing out to the LEFT of the line by `depth` at most (a quarter of it at least), bumped by
 * noise of `cell` units (`seed`). Lined along a straight wall, the wall reads as a cave's or a cliff's. Its
 * ends come back to a quarter of the depth, so that faces along the sides of an outline meet at its corners.
 * It returns a list of brushes (put them in a func_detail: they only decorate).
 */
export function rockWall({ from, to, bottom, top, depth = 24, cell = 48, seed = 1, texture }) {
  const { length, along } = frameOf(from, to, "rockWall");
  if (!(top > bottom)) throw new Error("rockWall: top over bottom");
  if (!(depth >= 4)) throw new Error(`rockWall: a depth of 4 at least, not ${depth}`);
  const steps = [Math.max(1, Math.round(length / cell)), Math.max(1, Math.round((top - bottom) / cell))];
  const step = [length / steps[0], (top - bottom) / steps[1]];
  const least = depth / 4;
  const out = (u, v) => {
    const ends = Math.min(u, length - u) / Math.max(cell, 1);
    const fade = Math.min(1, ends);
    const bump =
      0.65 * smoothNoise(u / cell, v / cell, seed) +
      0.35 * smoothNoise((u * 2.3) / cell, (v * 2.3) / cell, seed + 7);
    return least + (depth - least) * bump * fade;
  };
  const rock = terrain({ min: [0, bottom], max: [length, top], step, base: 0, height: (u, v) => out(u, v), texture, axis: "y", grid: 1 }); // prettier-ignore
  const angle = (Math.atan2(along[1], along[0]) * 180) / Math.PI;
  return moved(turned(rock, angle, [0, 0, 0]), [from[0], from[1], 0]);
}

/**
 * A cliff standing along the line `from` → `to`, its back on the line and its face out to the LEFT of it:
 * pieces 96 to 224 along (by `seed`), each a face leaning back at an angle of its own, from a foot `foot`
 * units out at most (a third of it at least) up to a top of `top` and up to `rise` more, the tops changing
 * from one joint to the next: a skyline that is not a line. Some pieces have a scree at their foot, lower and
 * further out. A piece's foot keeps out of the `clear` boxes (`[{ min: [x, y], max: [x, y] }]`: a doorway, a
 * house): there it stands near upright. The pieces overlap a little, so that no gap shows between them.
 * Its tops are never under `top`: stood in front of a plumb wall that height, it hides it. It returns a list
 * of brushes (put them in a func_detail).
 */
export function cliffWall({ from, to, bottom, top, rise = 96, foot = 96, seed = 1, texture, clear = [] }) {
  const { length, along, left } = frameOf(from, to, "cliffWall");
  if (!(top > bottom)) throw new Error("cliffWall: top over bottom");
  if (!(foot >= 8)) throw new Error(`cliffWall: a foot of 8 at least, not ${foot}`);
  const OVERLAP = 6;
  // the joints along the line: pieces of 96 to 224, the last one stretched or shrunk to fit
  const joints = [0];
  for (let k = 0; joints.at(-1) < length; k++)
    joints.push(joints.at(-1) + 96 + Math.round(hashed(k, 1, seed) * 128));
  if (joints.length > 2 && length - joints.at(-2) < 64) joints.splice(joints.length - 2, 1);
  joints[joints.length - 1] = length;
  // a joint's top: the same for the two pieces that meet there, so the skyline is unbroken but jagged
  // lower towards the stretch's ends, where it meets a doorway or another stretch round a corner
  const topAt = (k) => {
    const ends = Math.min(1, 0.35 + Math.min(joints[k], length - joints[k]) / 320);
    return round(
      top +
        rise *
          ends *
          (0.1 + 0.9 * (0.15 * hashed(k, 2, seed) + 0.85 * smoothNoise(joints[k] / 420, 0.5, seed))),
    );
  };
  const kept = (p) =>
    !clear.some(
      ({ min, max }) => p[0] > min[0] - 8 && p[0] < max[0] + 8 && p[1] > min[1] - 8 && p[1] < max[1] + 8,
    );
  const point = (u, out, z) => [...at(at(from, along, u), left, out).map((v) => round(v)), z];
  const brushes = [];
  for (let k = 0; k + 1 < joints.length; k++) {
    const u0 = Math.max(0, joints[k] - OVERLAP);
    const u1 = Math.min(length, joints[k + 1] + OVERLAP);
    if (u1 - u0 < 16) continue;
    const [t0, t1] = [topAt(k), topAt(k + 1)];
    // how far its foot stands out, and its top: the face leans back from one to the other
    const ends = Math.min(u0, length - u1) / 96;
    let out = foot * (0.35 + 0.65 * hashed(k, 3, seed)) * Math.min(1, 0.3 + ends);
    const brow = Math.round(Math.min(out * 0.5, 4 + 14 * hashed(k, 4, seed)));
    const clearHere = (o) => kept(point(u0, o, bottom).slice(0, 2)) && kept(point(u1, o, bottom).slice(0, 2)) && kept(point((u0 + u1) / 2, o, bottom).slice(0, 2)); // prettier-ignore
    while (out > 10 && !clearHere(out)) out *= 0.6;
    out = Math.max(Math.round(out), brow + 4);
    // the face is two facets meeting in a ridge somewhere along it, which stands out further (a buttress's
    // edge): each facet leans back at its own angle. Some pieces bend half way up, the lower part steeper
    const um = u0 + (u1 - u0) * (0.3 + 0.4 * hashed(k, 10, seed));
    const ridge = Math.round(out * (1.15 + 0.35 * hashed(k, 11, seed)));
    const tm = Math.round(Math.max(t0, t1) + rise * 0.08 * hashed(k, 12, seed));
    const z0 = bottom - 8;
    const facet = (ua, ub, ta, tb, outA, outB) => {
      const bend = hashed(k + Math.round(ua), 5, seed) < 0.45;
      const half = Math.round(bottom + (Math.min(ta, tb) - bottom) * (0.35 + 0.25 * hashed(k, 6, seed)));
      const rows = bend
        ? [
            [z0, z0, outA, outB],
            [half, half, Math.round(outA * 0.7), Math.round(outB * 0.7)],
            [ta, tb, brow, brow],
          ]
        : [
            [z0, z0, outA, outB],
            [ta, tb, brow, brow],
          ];
      for (let r = 0; r + 1 < rows.length; r++) {
        const [la, lb, oa, ob] = rows[r];
        const [ha, hb, pa, pb] = rows[r + 1];
        brushes.push(solid([point(ua, 0, la), point(ub, 0, lb), point(ua, oa, la), point(ub, ob, lb), point(ua, 0, ha), point(ub, 0, hb), point(ua, pa, ha), point(ub, pb, hb)], texture)); // prettier-ignore
      }
    };
    facet(u0, um, t0, tm, out, ridge);
    facet(um, u1, tm, t1, ridge, out);
    // a scree at the foot of some: low, further out, its own slope
    if (hashed(k, 7, seed) < 0.4 && u1 - u0 > 80) {
      const far = Math.round(out + 24 + 40 * hashed(k, 8, seed));
      const tall = Math.round(24 + 40 * hashed(k, 9, seed));
      const [s0, s1] = [u0 + (u1 - u0) * 0.15, u1 - (u1 - u0) * 0.2];
      if (kept(point(s0, far, bottom).slice(0, 2)) && kept(point(s1, far, bottom).slice(0, 2)))
        brushes.push(solid([point(s0, out - 4, z0), point(s1, out - 4, z0), point(s0 + 16, far, z0), point(s1 - 16, far, z0), point(s0, out - 4, bottom + tall), point(s1, out - 4, Math.round(bottom + tall * 0.7))], texture)); // prettier-ignore
    }
  }
  return brushes;
}

// ── a map added to by hand ──────────────────────────────────────────────────
/** A brush as its planes, rounded: two brushes of one shape have one key, however their points were written. */
export function pieceKey(brush) {
  return planesOf(brush)
    .map((plane) =>
      plane
        ? [
            ...plane.normal.map((n) => Math.round(n * NORMAL_GRAIN) + 0),
            Math.round(plane.dist * DIST_GRAIN) + 0,
          ].join(",")
        : "-",
    )
    .sort()
    .join(";");
}
/** An entity's key for `additions`: its classname, its origin and its brushes. */
const entityKey = ({ brushes = [], ...keys }) =>
  [keys.classname, String(keys.origin ?? "").split(/\s+/).filter(Boolean).map((n) => Math.round(Number(n))).join(","), ...brushes.map(pieceKey).sort()].join("|"); // prettier-ignore

/**
 * What a person added to a map the kit made: the brushes and entities of `edited` (the map as they saved
 * it, from J.A.C.K. or any editor) that are not in `made` (the map as the kit wrote it). A brush is the same
 * when its planes are, however the editor wrote its points and numbers. What they took away of the kit's is
 * not told: the kit makes it again. It returns `{ brushes, entities }`.
 */
export function additions(edited, made) {
  const madeBrushes = new Set((made.brushes ?? []).map(pieceKey));
  const madeEntities = new Set((made.entities ?? []).map(entityKey));
  return {
    brushes: (edited.brushes ?? []).filter((brush) => !madeBrushes.has(pieceKey(brush))),
    entities: (edited.entities ?? []).filter((entity) => !madeEntities.has(entityKey(entity))),
  };
}

/**
 * Maps as one: the first one's worldspawn (with every map's `wad` list joined), and every map's brushes and
 * entities. For a map built by the kit with what a person made by hand added: `mergeMaps(made, hand)`.
 */
export function mergeMaps(...maps) {
  const list = maps.map((map) => (typeof map === "string" ? readMap(map) : map));
  const wads = [];
  for (const map of list) {
    const wad = map.worldspawn?.wad;
    for (const file of Array.isArray(wad) ? wad : String(wad ?? "").split(";"))
      if (file && !wads.includes(file)) wads.push(file);
  }
  return {
    worldspawn: { ...(list[0]?.worldspawn ?? {}), ...(wads.length ? { wad: wads } : {}) },
    brushes: list.flatMap((map) => map.brushes ?? []),
    entities: list.flatMap((map) => map.entities ?? []),
  };
}

/**
 * What stands inside a box of a map, moved by `by`: the world's brushes wholly in it, and the entities whose
 * origin is in it or whose brushes all are. For a building a map spec stood in its open room, taken out to be
 * put in another map (`mergeMaps`): the open room's rock, sky and floor are outside the box and are left
 * behind, and so are its places to start (`starts`: the classes of them, Half-Life's two unless told), the
 * worldspawn and its sun (`light_environment`: the other map has its own). Returns `{ brushes, entities }`.
 */
/** The entities of a map as a whole, which `standingIn` leaves behind. */
const WHOLE_MAP = ["worldspawn", "light_environment"];
export function standingIn(map, { min, max }, { by = [0, 0, 0], starts = ["info_player_start", "info_player_deathmatch"] } = {}) {
  const inBox = (p) => p.every((v, k) => v >= min[k] - 0.5 && v <= max[k] + 0.5);
  const within = (brush) => shapeOf(brush).faces.every((face) => face.polygon.every(inBox));
  const shift = (entity) => {
    const out = { ...entity };
    if (entity.origin !== undefined) out.origin = String(entity.origin).trim().split(/\s+/).map((v, k) => Number(v) + by[k]).join(" ");
    if (entity.brushes) out.brushes = moved(entity.brushes, by);
    return out;
  };
  const entities = (map.entities ?? []).filter((entity) => {
    if (WHOLE_MAP.includes(entity.classname) || starts.includes(entity.classname)) return false;
    if (entity.brushes?.length) return entity.brushes.every(within);
    return entity.origin !== undefined && inBox(String(entity.origin).trim().split(/\s+/).map(Number));
  });
  return { brushes: moved((map.brushes ?? []).filter(within), by), entities: entities.map(shift) };
}
