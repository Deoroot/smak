// A house as the game's towns build one (deralia, edana, helena; maps/natural/tools/pieces.mjs measured them):
// a stone footing, a ground storey of brick, an upper storey of timber and plaster that juts out over the
// street, its windows painted on the wall's picture (lit or shuttered, as the game's are), a pitched roof of
// the kind's slope with eaves, a gable, a ridge, sometimes a chimney, and a door of the kind's size with its
// lintel and its steps. The walls' pictures are fitted to the walls: a storey is one half of a 256 texel
// facade, a wall's length a whole number of window bays (128), so no window is cut.
import { box, prism, turned, moved, textureAxes } from "./source.mjs";
import { roof } from "./forms.mjs";
import { SIZES } from "./sizes.mjs";

/**
 * The textures of a house: the half-timbered set of the game's towns (daragoth.wad, edana.wad: MSC's own).
 * `upper` is a list (a face takes one by the seed: lit windows or shuttered), each a 256 facade whose top
 * half is the upper storey; `lower` a facade whose bottom half is the ground storey.
 */
export const HOUSE_SET = {
  footing: ["pi_outwall4", "wall_927a", "pi_outwall4"],
  lower: "pk_dodwall02b",
  upper: ["pk_dodwall02b", "pk_dodwall02blg", "pk_dodwall02b"],
  side: "pk_dodwall03a",
  gable: "pk_dodwall03k",
  cottage: ["pk_dodwall03l", "pk_dodwall03m"],
  roof: ["roof", "roof_01", "pk_dodroof01b", "tel_roof-01", "roof"],
  wood: "wood_073",
  door: { name: "door_36", size: [96, 128] },
  steps: "pk_dodkerb04b",
  chimney: "pi_outwall2t",
  // a house one goes into (`inside`): its walls within, its floorboards, the beams under its roof
  within: "pk_dodwall03a",
  boards: "ms_wood04",
};

/** The size of a bay (one window and its wall) and of a storey on the facade textures (texels, scale 1). */
export const BAY = 128;
const STOREY = 128;
const FACADE = 256;

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
}

/**
 * A wall picture fitted to a face: its texels' column 0 at the face's least corner along the picture's
 * columns (so a wall a whole number of bays long shows whole windows), its row `row` at height `top`.
 * `min` is the brush's least corner; `scale` [x, y] units a texel.
 */
function fitted(name, normal, { min, top, row = 0, scale = [1, 1] }) {
  const { u, v } = textureAxes(normal);
  const dotted = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // along the columns: from the least corner (the faces' u is the world's x or y)
  const offsetU = -dotted(min, u) / scale[0];
  // down the rows: v is -z on an upright face, so a row is (top - z) / scale + row
  const offsetV =
    Math.abs(v[2]) > 0.5 ? row + (v[2] < 0 ? top : -top) / scale[1] : -dotted(min, v) / scale[1];
  return { name, offset: [offsetU, offsetV], scale };
}

/**
 * A house standing at `at` [x, y], `size` [wide, deep] (each rounded to whole bays: 128), its front (the
 * door, the eaves) facing `turn` degrees. `groundAt(x, y)` the ground's height: the footing goes down below
 * its lowest under the house and the floor is a little over its highest; steps go down from the door to the
 * ground in front.
 *   storeys   1 (a cottage: plaster and windows, a low wall) or 2 (brick under, timber over)
 *   kind      whose sizes it takes (SIZES): the door's, the roof's slope
 *   jetty     how far the upper storey stands out over the front and the back (8)
 *   eaves     how far the roof comes out past the walls (24 at the front and back, 16 at the gables)
 *   pitch     the roof's slope, degrees (the kind's, varied within its middle half by the seed)
 *   chimney   true, false, or by the seed (one house in two)
 *   set       the textures (HOUSE_SET, or any of its keys changed)
 *   inside    true: a house one goes into, its storeys one room up to the roof (its walls 16 thick, plaster
 *             within, boards underfoot, tie beams under the attic), its door open and its leaf swung in
 *   doorAt    where along the front the door's middle stands, from the front's middle (by the seed if not given)
 * Returns `{ brushes, box, door, floor, spots, lamp, room }`: the brushes (all of them for a func_detail: a house
 * is solid unless `inside`), the box it stands in on the plan (to keep strewn things off), the point before its door
 * on the ground (where a way should come to), the floor's height, places by its walls (`[{ at, yaw, where }]`,
 * where: front, side, back) for things a house has about it, and where a lamp over its door goes ([x, y, z]).
 * `room` (an `inside` house): `{ min, max, floor, ceiling, door, toMap, turn }`, its floor's box in the house's
 * own frame (x out of the front), the door's middle on the inner face [x, y], and `toMap(x, y)` into the map.
 */
export function house({
  at,
  size = [256, 256],
  turn = 0,
  groundAt = () => 0,
  storeys = 2,
  kind = "settlement",
  jetty = 8,
  eaves = 24,
  pitch,
  chimney,
  set = {},
  seed = 1,
  inside = false,
  doorAt,
}) {
  const rand = rng(seed);
  const pick = (list) => (Array.isArray(list) ? list[Math.floor(rand() * list.length)] : list);
  // a house wears one of each list: its roof, its footing
  const t = { ...HOUSE_SET, ...set };
  t.footing = pick(t.footing);
  t.roof = pick(t.roof);
  const sizes = SIZES[kind] ?? SIZES.settlement;
  const [wide, deep] = size.map((n) => Math.max(BAY, Math.round(n / BAY) * BAY));
  // the house's own frame: x out of its front, y along it; turned and moved last
  const a = (turn * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const toMap = (x, y) => [at[0] + x * c - y * s, at[1] + x * s + y * c];
  const groundIn = (x, y) => groundAt(...toMap(x, y));
  const [hd, hw] = [deep / 2, wide / 2];
  const under = [];
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) under.push(groundIn(-hd + (deep * i) / 4, -hw + (wide * j) / 4));
  const low = Math.floor(Math.min(...under));
  const high = Math.ceil(Math.max(...under));
  const floor = high + 8;
  const brushes = [];
  const wood = t.wood;

  // the footing: stone, a little wider than the walls, from under the lowest ground to the floor
  brushes.push(box([-hd - 4, -hw - 4, low - 24], [hd + 4, hw + 4, floor], inside ? (n) => (n[2] > 0.5 ? t.boards : t.footing) : t.footing)); // prettier-ignore
  // the storeys' bodies: whole boxes, or for a house one goes into their walls, laid once the door is placed
  const bodies = [];

  let eave; // the walls' top, where the roof sits
  let outer; // how far the top storey's front and back stand from the middle
  if (storeys >= 2) {
    // the ground storey: the facade's bottom half (brick) on every side
    const min = [-hd, -hw, floor];
    const top = floor + STOREY;
    const lower = (n) =>
      Math.abs(n[2]) > 0.5 ? wood : fitted(t.lower, n, { min, top: floor + FACADE, row: 0 });
    bodies.push([min, [hd, hw, top], lower]);
    // the upper storey, out over the front and the back by the jetty; its sides plain timber and plaster
    outer = hd + jetty;
    const umin = [-outer, -hw, top];
    const front = pick(t.upper), back = pick(t.upper); // prettier-ignore
    const upper = (n) => {
      if (n[2] < -0.5) return wood; // under the jetty: the floor's boards
      if (n[2] > 0.5) return wood;
      if (Math.abs(n[0]) > 0.5) return fitted(n[0] > 0 ? front : back, n, { min: umin, top: top + STOREY });
      return fitted(t.side, n, { min: umin, top: top + STOREY });
    };
    bodies.push([umin, [outer, hw, top + STOREY], upper]);
    // the jetty's beam along the front and the back, under the overhang
    for (const sign of [1, -1]) brushes.push(box(sign > 0 ? [hd, -hw, top - 8] : [-outer, -hw, top - 8], sign > 0 ? [outer, hw, top] : [-hd, hw, top], wood)); // prettier-ignore
    eave = top + STOREY;
  } else {
    // a cottage: one storey of plaster, its windows the facade's top
    const min = [-hd, -hw, floor];
    const top = floor + 160;
    const face = pick(t.cottage);
    const wall = (n) => (Math.abs(n[2]) > 0.5 ? wood : fitted(Math.abs(n[0]) > 0.5 ? face : t.side, n, { min, top })); // prettier-ignore
    bodies.push([min, [hd, hw, top], wall]);
    outer = hd;
    eave = top;
  }

  // the roof: two slabs from the ridge (along y) down past the walls, the kind's slope
  const [p0, p1, p2] = sizes.roof;
  const slope = ((pitch ?? p0 + (p2 - p0) * (0.25 + rand() * 0.5)) * Math.PI) / 180;
  const tan = Math.tan(slope);
  const rise = outer * tan; // the ridge over the eaves
  const ridge = eave + rise;
  const thick = 8;
  const thickZ = thick / Math.cos(slope);
  const gableOut = 16;
  const reach = outer + eaves; // the roof's foot, out past the wall
  const roofTex = (n) => (Math.abs(n[2]) > 0.2 && n[2] > 0 ? t.roof : wood);
  // two slabs from the ridge (along y) down past the walls, the gable ends 16 out
  brushes.push(...roof([[-outer, -hw], [outer, -hw], [outer, hw], [-outer, hw]], { kind: "gable", ridge: "second", pitch: (slope * 180) / Math.PI, overhang: { eaves, gable: gableOut }, thick, z: eave, texture: roofTex })); // prettier-ignore
  // the attic: the gable's triangle the width of the house, its ends timber and plaster
  const gable = (n) =>
    Math.abs(n[1]) > 0.5 ? fitted(t.gable, n, { min: [-outer, -hw, eave], top: ridge }) : wood;
  brushes.push(
    prism(
      "y",
      [
        [-outer, eave],
        [outer, eave],
        [0, ridge],
      ],
      -hw,
      hw,
      gable,
    ),
  );
  // the ridge's beam
  brushes.push(prism("y", [[-6, ridge + thickZ - 2], [0, ridge + thickZ + 6], [6, ridge + thickZ - 2]], -hw - gableOut, hw + gableOut, wood)); // prettier-ignore

  // a chimney through the back of the roof, at one gable
  if (chimney ?? rand() < 0.5) {
    const y = (rand() < 0.5 ? -1 : 1) * (hw - 40);
    const x = -outer * (0.3 + rand() * 0.25);
    const z0 = eave;
    const z1 = ridge + 40;
    brushes.push(box([x - 20, y - 20, z0], [x + 20, y + 20, z1], t.chimney));
    brushes.push(box([x - 24, y - 24, z1], [x + 24, y + 24, z1 + 8], t.chimney));
  }

  // the door: its leaf a little out of the front wall, the kind's size, the picture fitted to it whole
  const [dw, dh] = [sizes.door.wide[1], sizes.door.high[1]];
  // a cottage's door between its windows (a facade's windows stand either side of its middle); a ground
  // storey of brick has none, so its door may stand anywhere along it
  const bays = Math.floor(wide / FACADE);
  const seeded =
    storeys >= 2 || bays < 1
      ? (rand() - 0.5) * Math.max(0, wide - BAY - dw) * 0.8
      : -hw + FACADE * Math.floor(rand() * bays) + FACADE / 2;
  const dy = doorAt ?? seeded;
  const leaf = (n) => (n[0] > 0.5 ? { ...doorFit(dy, dw, dh, floor, t.door.size), name: t.door.name } : wood);
  const WALL = 16;
  const [ix, iy] = [hd - WALL, hw - WALL]; // the room's half sizes, within the walls
  if (!inside) {
    for (const [min, max, tex] of bodies) brushes.push(box(min, max, tex));
    brushes.push(box([hd, dy - dw / 2, floor], [hd + 4, dy + dw / 2, floor + dh], leaf));
  } else {
    // each storey's four walls round the room, plaster within; the door's way through the lowest one's front
    const within = (tex, toward) => (n) => (n[0] * toward[0] + n[1] * toward[1] > 0.5 ? t.within : tex(n));
    for (const [k, [min, max, tex]] of bodies.entries()) {
      const [z0, z1] = [min[2], max[2]];
      const front = (y0, y1, za, zb) => brushes.push(box([ix, y0, za], [max[0], y1, zb], within(tex, [-1, 0])));
      if (k === 0) {
        const jamb = (n) => (Math.abs(n[1]) > 0.5 ? wood : within(tex, [-1, 0])(n));
        brushes.push(box([ix, min[1], z0], [max[0], dy - dw / 2, z1], jamb));
        brushes.push(box([ix, dy + dw / 2, z0], [max[0], max[1], z1], jamb));
        brushes.push(box([ix, dy - dw / 2, floor + dh], [max[0], dy + dw / 2, z1], (n) => (n[2] < -0.5 ? wood : within(tex, [-1, 0])(n)))); // prettier-ignore
      } else front(min[1], max[1], z0, z1);
      brushes.push(box([min[0], min[1], z0], [-ix, max[1], z1], within(tex, [1, 0])));
      brushes.push(box([-ix, min[1], z0], [ix, -iy, z1], within(tex, [0, 1])));
      brushes.push(box([-ix, iy, z0], [ix, max[1], z1], within(tex, [0, -1])));
    }
    // the leaf swung in against the wall, by the door's side
    const swung = (n) => (Math.abs(n[1]) > 0.5 ? { ...fitted(t.door.name, n, { min: [ix - dw, dy + dw / 2, floor], top: floor + dh, scale: [dw / t.door.size[0], dh / t.door.size[1]] }) } : wood); // prettier-ignore
    brushes.push(box([ix - dw, dy + dw / 2, floor], [ix, dy + dw / 2 + 4, floor + dh], swung));
    // tie beams across the room under the attic, a bay apart
    for (let y = -hw + BAY; y < hw; y += BAY) brushes.push(box([-ix, y - 6, eave - 12], [ix, y + 6, eave], wood));
  }
  // its frame: posts and a lintel
  brushes.push(box([hd, dy - dw / 2 - 8, floor], [hd + 6, dy - dw / 2, floor + dh + 8], wood));
  brushes.push(box([hd, dy + dw / 2, floor], [hd + 6, dy + dw / 2 + 8, floor + dh + 8], wood));
  brushes.push(box([hd, dy - dw / 2 - 12, floor + dh], [hd + 8, dy + dw / 2 + 12, floor + dh + 10], wood));
  // steps down to the ground before it, 16 a step, 24 a tread (the kind's)
  const tread = sizes.step.tread[1];
  const before = groundIn(hd + 4 + tread, dy);
  const count = Math.max(1, Math.ceil((floor - before) / 16));
  for (let k = 0; k < count; k++) {
    const z = floor - k * 16;
    const x0 = hd + 4;
    brushes.push(box([x0, dy - dw / 2 - 16, Math.min(low, before) - 16], [x0 + tread * (k + 1), dy + dw / 2 + 16, z], t.steps)); // prettier-ignore
  }

  // into the map: turned to face `turn`, moved to `at`
  const placed = moved(turned(brushes, turn, [0, 0, 0]), [at[0], at[1], 0]);
  const reachOut = reach + 8;
  const corners = [[-reachOut, -hw - gableOut], [reachOut + tread * count, -hw - gableOut], [reachOut + tread * count, hw + gableOut], [-reachOut, hw + gableOut]].map(([x, y]) => toMap(x, y)); // prettier-ignore
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]); // prettier-ignore
  const door = toMap(hd + 4 + tread * count + 32, dy).map(Math.round);
  // places by its walls for what a house has about it (a barrel, a cart, hay), facing out: by the front either
  // side of the door, along each side, along the back
  const spots = [];
  const spot = (x, y, yaw, where) => spots.push({ at: toMap(x, y).map(Math.round), yaw: Math.round((((turn + yaw) % 360) + 360) % 360), where }); // prettier-ignore
  const out = 36;
  for (const y of [-hw + 40, hw - 40]) if (Math.abs(y - dy) > dw / 2 + 56) spot(hd + out, y, 0, "front");
  for (const sign of [1, -1])
    for (const x of [-hd / 2, hd / 3]) spot(x, sign * (hw + gableOut + out), sign * 90, "side");
  for (const y of [-hw / 2, hw / 2]) spot(-reach - out, y, 180, "back");
  // a lamp over the door, as the towns light theirs (about 100 over the floor, warm)
  const lamp = [...toMap(hd + 20, dy + dw / 2 + 28).map(Math.round), floor + 100];
  const room = inside ? { min: [-ix, -iy], max: [ix, iy], floor, ceiling: eave - 12, door: [ix, Math.round(dy)], toMap: (x, y) => toMap(x, y).map(Math.round), turn } : undefined; // prettier-ignore
  return {
    room,
    brushes: placed,
    box: {
      min: [Math.min(...xs) - 32, Math.min(...ys) - 32],
      max: [Math.max(...xs) + 32, Math.max(...ys) + 32],
    },
    door,
    floor,
    spots,
    lamp,
  };
}

/**
 * A fence of wood along `points` ([[x, y], ...]): posts every `post` units (64) and two rails, `height` (48)
 * high, standing on `groundAt`, the posts sunk 16 into it. Returns a list of brushes (for a func_detail).
 */
export function fence({
  points,
  height = 48,
  post = 64,
  groundAt = () => 0,
  texture = "wood_073",
  seed = 1,
}) {
  const rand = rng(seed);
  const brushes = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 16) continue;
    const yaw = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const count = Math.max(1, Math.round(length / post));
    const step = length / count;
    const ground = (k) => groundAt(a[0] + ((b[0] - a[0]) * k * step) / length, a[1] + ((b[1] - a[1]) * k * step) / length); // prettier-ignore
    const local = [];
    for (let k = 0; k <= count; k++) {
      if (i > 0 && k === 0) continue; // the corner's post is the last side's
      const g = Math.round(ground(k));
      const lean = Math.round((rand() - 0.5) * 6);
      local.push(box([k * step - 3, -3, g - 16], [k * step + 3, 3, g + height + lean], texture));
    }
    // the rails: from post to post, at a third and at the top, following the ground
    for (let k = 0; k < count; k++) {
      const [g0, g1] = [Math.round(ground(k)), Math.round(ground(k + 1))];
      for (const at of [height * 0.4, height * 0.85]) {
        const [z0, z1] = [g0 + at, g1 + at];
        local.push(prism("y", [[k * step, z0], [(k + 1) * step, z1], [(k + 1) * step, z1 + 4], [k * step, z0 + 4]], -2, 2, texture)); // prettier-ignore
      }
    }
    brushes.push(...moved(turned(local, yaw, [0, 0, 0]), [a[0], a[1], 0]));
  }
  return brushes;
}

/** The door's picture whole on its leaf: scaled to the leaf, its top at the leaf's top, its left at its side. */
function doorFit(dy, dw, dh, floor, [tw, th]) {
  const scale = [dw / tw, dh / th];
  return fitted("x", [1, 0, 0], { min: [0, dy - dw / 2, floor], top: floor + dh, scale });
}
