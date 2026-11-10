// The kitbash kit: 45 small hard-surface parts (bolts, brackets, clevises, hinges, vents, grilles, pistons,
// lamps, sensors, tanks, conduits...), each a few convex solids of core/solids.mjs, set on a surface by a place.
// Made for a robot of rigid pieces on a game's skeleton (the figures research's E1c): each part goes on one
// bone, `putRigid` puts them into the model, `motionOverlaps` tells which the animations drive into each other.
//
//   import { PARTS, SETS, kitbash, seeded } from "../kits/kitbash.mjs";
//   const pl = place(at, out, along);                  // on a surface: its Z out of it, its X along it
//   const parts = kitbash("clevis", pl, 1.2, 7);       // [solid]; PARTS.clevis(pl, 1.2, seeded(7)) the same
//   const tris = parts.flatMap(trisOf);                // [[{ p, k }]], in the space the place is in
//
//   PARTS    { name: (place, size, rnd) -> [solid] }: `size` about the part's length in units (1 to 3 suits a
//            man-sized figure), `rnd` a random maker from `seeded` for the parts that vary (how many bolts,
//            which end a bracket stands at). The same seed makes the same part.
//   SETS     the parts by what they suit: fitting (anywhere), mechanism (joints), gear (a trunk), sensor, armour
//   kitbash(name, place, size, seed)   one part
//   seeded(seed)  () -> 0..1, with .range(a, b), .pick(list), .chance(p), .int(a, b)
//
// Every part lies within `REACH.across * size + REACH.more` of its place across its surface (x and y), and from
// `-SINK - REACH.below * size` to `REACH.out * size + REACH.more` out of it: its foot sinks 0.08 into the
// surface, so that no seam of light shows under it (a cable's end a little more). Each solid is convex and closed; a part's solids may cross each other.
// The `mat` of each solid names its paint: olive, dark, black, steel, red, yellow, lamp.
import { at, shift, along, rect, outline, box, plate, cyl, tube, loft } from "../core/solids.mjs";
export * from "../core/solids.mjs";

/** A random maker that repeats for one seed: () -> 0..1, with range, pick, chance and int. */
export function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.pick = (list) => list[Math.floor(next() * list.length) % list.length];
  next.chance = (p) => next() < p;
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  return next;
}

/** How deep a part's foot sinks into the surface it stands on. */
export const SINK = 0.08;
/** How far a part reaches: across its surface and out of it, a share of its size and a little more. */
export const REACH = { across: 1.1, out: 2.6, below: 0.14, more: 0.6 };
const on = (pl, x, y) => shift(pl, x, y, -SINK);

export const PARTS = {
  /** A bolt head: a small square stud, bevelled. */
  bolt: (pl, s) => [box(on(pl, 0, 0), 0.45 * s, 0.45 * s, 0.3, { foot: true, bevel: 0.1, mat: "steel" })],
  /** Bolts in a row along X. */
  boltRow: (pl, s, rnd) => {
    const n = rnd.int(2, 4),
      step = (s * 1.4) / n;
    return Array.from({ length: n }, (_, i) =>
      box(on(pl, (i - (n - 1) / 2) * step, 0), 0.4, 0.4, 0.28, { foot: true, bevel: 0.1, mat: "steel" }),
    );
  },
  /** An L bracket: a foot on the surface and an arm standing up from one end of it. */
  bracket: (pl, s, rnd) => {
    const w = 0.5 * s + 0.3;
    return [
      box(on(pl, 0, 0), 1.2 * s, w, 0.3, { foot: true, mat: "dark" }),
      box(on(pl, (0.6 * s - 0.15) * (rnd.chance(0.5) ? 1 : -1), 0), 0.3, w, 0.9 * s, {
        foot: true,
        bevel: 0.1,
        mat: "dark",
      }),
    ];
  },
  /** A clevis: a base and two ears with a pin through them. */
  clevis: (pl, s) => {
    const e = 0.45 * s;
    return [
      box(on(pl, 0, 0), 1.2 * s, 1.1 * s, 0.35, { foot: true, bevel: 0.1, mat: "dark" }),
      plate(along(shift(pl, 0, e, 0.2), "Y"), rect(0.9 * s, 1.1 * s, 0.3 * s, 0, -0.5 * s), 0.25, {
        mat: "dark",
      }),
      plate(along(shift(pl, 0, -e - 0.25, 0.2), "Y"), rect(0.9 * s, 1.1 * s, 0.3 * s, 0, -0.5 * s), 0.25, {
        mat: "dark",
      }),
      cyl(along(shift(pl, 0, -e - 0.4, 0.75 * s), "Y"), 0.18 * s + 0.08, 0, 2 * e + 0.8, {
        n: 6,
        mat: "steel",
      }),
    ];
  },
  /** A hinge: a drum along X between two knuckle blocks. */
  hinge: (pl, s) => [
    cyl(along(shift(pl, -0.7 * s, 0, 0.35 * s), "X"), 0.35 * s, 0, 1.4 * s, { n: 6, mat: "steel" }),
    box(on(pl, -0.5 * s, 0), 0.4 * s, 0.9 * s, 0.4 * s, { foot: true, mat: "dark" }),
    box(on(pl, 0.5 * s, 0), 0.4 * s, 0.9 * s, 0.4 * s, { foot: true, mat: "dark" }),
  ],
  /** A vent: a low frame and three slats. */
  vent: (pl, s) => [
    box(on(pl, 0, 0), 1.6 * s, 1.0 * s, 0.25, { foot: true, bevel: 0.08, mat: "dark" }),
    ...[-1, 0, 1].map((i) =>
      box(on(pl, i * 0.42 * s, 0), 0.18 * s, 0.8 * s, 0.4, { foot: true, mat: "black" }),
    ),
  ],
  /** A grille: a plate with ribs along it. */
  grille: (pl, s, rnd) => {
    const n = rnd.int(3, 5);
    return [
      box(on(pl, 0, 0), 1.4 * s, 1.2 * s, 0.2, { foot: true, mat: "black" }),
      ...Array.from({ length: n }, (_, i) =>
        box(on(pl, 0, (i - (n - 1) / 2) * ((1.0 * s) / n)), 1.4 * s, 0.12 * s + 0.05, 0.38, {
          foot: true,
          mat: "dark",
        }),
      ),
    ];
  },
  /** A cable box: a box with two stubs of cable out of its side. */
  cableBox: (pl, s) => [
    box(on(pl, 0, 0), 1.1 * s, 0.8 * s, 0.7 * s, { foot: true, bevel: 0.12, mat: "dark" }),
    tube(at(pl, 0.55 * s, 0.2 * s, 0.25 * s), at(pl, 1.1 * s, 0.2 * s, 0.1), 0.13 * s + 0.05, {
      n: 4,
      mat: "black",
    }),
    tube(at(pl, 0.55 * s, -0.2 * s, 0.25 * s), at(pl, 1.0 * s, -0.25 * s, 0.1), 0.13 * s + 0.05, {
      n: 4,
      mat: "black",
    }),
  ],
  /** A connector: a plug and its collar. */
  connector: (pl, s) => [
    cyl(on(pl, 0, 0), 0.38 * s, 0, 0.25, { n: 6, mat: "dark" }),
    cyl(shift(pl, 0, 0, 0.17), 0.25 * s, 0, 0.45 * s, { n: 6, mat: "steel" }),
  ],
  /** An actuator: a housing, a rod out of it, an end block. */
  actuator: (pl, s) => {
    const h = along(shift(pl, -0.8 * s, 0, 0.3 * s), "X");
    return [
      cyl(h, 0.28 * s, 0, 0.9 * s, { n: 6, mat: "dark", bevel: 0.05 }),
      cyl(h, 0.13 * s, 0.9 * s, 1.5 * s, { n: 4, mat: "steel" }),
      box(on(pl, 0.75 * s, 0), 0.3 * s, 0.5 * s, 0.55 * s, { foot: true, mat: "dark" }),
    ];
  },
  /** A lamp: a housing and a lit lens. */
  lamp: (pl, s) => [
    box(on(pl, 0, 0), 0.8 * s, 0.6 * s, 0.4 * s, { foot: true, bevel: 0.08, mat: "dark" }),
    box(shift(pl, 0.05 * s, 0, 0.3 * s), 0.45 * s, 0.35 * s, 0.18, { foot: true, mat: "lamp" }),
  ],
  /** An antenna: a mast and its tip. */
  antenna: (pl, s) => [
    box(on(pl, 0, 0), 0.5, 0.5, 0.35, { foot: true, mat: "dark" }),
    cyl(shift(pl, 0, 0, 0.2), 0.09, 0, 2.6 * s, { n: 4, r1: 0.06, mat: "black" }),
    box(shift(pl, 0, 0, 2.6 * s), 0.18, 0.18, 0.25, { foot: true, mat: "red" }),
  ],
  /** A sensor pod: a block with a lens looking out along X. */
  sensorPod: (pl, s) => [
    box(on(pl, 0, 0), 1.1 * s, 0.9 * s, 0.8 * s, { foot: true, bevel: 0.12, cut: 0.15 * s, mat: "dark" }),
    cyl(along(shift(pl, 0.5 * s, 0, 0.42 * s), "X"), 0.25 * s, 0, 0.3, { n: 6, mat: "lamp" }),
  ],
  /** A canister along X on two saddles. */
  canister: (pl, s, rnd) => [
    cyl(along(shift(pl, -0.9 * s, 0, 0.45 * s), "X"), 0.4 * s, 0, 1.8 * s, {
      n: 8,
      mat: rnd.chance(0.3) ? "red" : "dark",
      bevel: 0.08,
    }),
    box(on(pl, -0.5 * s, 0), 0.25 * s, 0.9 * s, 0.3 * s, { foot: true, mat: "black" }),
    box(on(pl, 0.5 * s, 0), 0.25 * s, 0.9 * s, 0.3 * s, { foot: true, mat: "black" }),
  ],
  /** A handle: two posts and a grip between them. */
  handle: (pl, s) => [
    box(on(pl, -0.6 * s, 0), 0.22, 0.22, 0.45, { foot: true, mat: "dark" }),
    box(on(pl, 0.6 * s, 0), 0.22, 0.22, 0.45, { foot: true, mat: "dark" }),
    box(shift(pl, 0, 0, 0.32), 1.45 * s, 0.2, 0.2, { foot: true, mat: "steel" }),
  ],
  /** A rail on two stand-offs. */
  rail: (pl, s) => [
    box(shift(pl, 0, 0, 0.3), 2.2 * s, 0.25, 0.25, { foot: true, bevel: 0.05, mat: "steel" }),
    box(on(pl, -0.8 * s, 0), 0.25, 0.3, 0.42, { foot: true, mat: "dark" }),
    box(on(pl, 0.8 * s, 0), 0.25, 0.3, 0.42, { foot: true, mat: "dark" }),
  ],
  /** A conduit: a pipe run along the surface, up off it at both ends. */
  conduit: (pl, s) => {
    const a = at(pl, -1.1 * s, 0, 0),
      b = at(pl, -0.8 * s, 0, 0.35),
      c = at(pl, 0.8 * s, 0, 0.35),
      d = at(pl, 1.1 * s, 0, 0);
    const r = 0.14;
    return [
      tube(a, b, r, { n: 4, mat: "black", up: pl.Z }),
      tube(b, c, r, { n: 4, mat: "black", up: pl.Z }),
      tube(c, d, r, { n: 4, mat: "black", up: pl.Z }),
    ];
  },
  /** A heat sink: a base and fins. */
  heatSink: (pl, s, rnd) => {
    const n = rnd.int(3, 5);
    return [
      box(on(pl, 0, 0), 1.2 * s, 1.0 * s, 0.25, { foot: true, mat: "dark" }),
      ...Array.from({ length: n }, (_, i) =>
        box(shift(pl, (i - (n - 1) / 2) * ((1.0 * s) / n), 0, 0.15), 0.12, 0.95 * s, 0.5 * s, {
          foot: true,
          mat: "steel",
        }),
      ),
    ];
  },
  /** A junction box with plugs out of its top. */
  junction: (pl, s, rnd) => {
    const n = rnd.int(2, 3);
    return [
      box(on(pl, 0, 0), 1.2 * s, 0.9 * s, 0.55 * s, { foot: true, bevel: 0.1, mat: "dark" }),
      ...Array.from({ length: n }, (_, i) =>
        cyl(shift(pl, (i - (n - 1) / 2) * 0.4 * s, 0, 0.5 * s), 0.12 * s + 0.04, 0, 0.3, {
          n: 4,
          mat: "steel",
        }),
      ),
    ];
  },
  /** A valve: a stem and a hand wheel. */
  valve: (pl, s) => [
    cyl(on(pl, 0, 0), 0.18 * s + 0.05, 0, 0.6 * s, { n: 4, mat: "steel" }),
    cyl(shift(pl, 0, 0, 0.55 * s), 0.5 * s, 0, 0.14, { n: 8, mat: "red" }),
  ],
  /** A latch: a plate and its catch. */
  latch: (pl, s) => [
    box(on(pl, 0, 0), 0.9 * s, 0.6 * s, 0.18, { foot: true, mat: "steel" }),
    box(shift(pl, 0.2 * s, 0, 0.05), 0.35 * s, 0.4 * s, 0.32, { foot: true, bevel: 0.06, mat: "dark" }),
  ],
  /** A port: a raised frame with a black socket in it. */
  port: (pl, s) => [
    box(on(pl, 0, 0), 1.0 * s, 0.8 * s, 0.25, { foot: true, bevel: 0.08, mat: "dark" }),
    box(shift(pl, 0, 0, 0.05), 0.55 * s, 0.4 * s, 0.25, { foot: true, mat: "black" }),
  ],
  /** A hook: an arm out of the surface, its end turned along X. */
  hook: (pl, s) => [
    box(on(pl, 0, 0), 0.3, 0.3, 0.7 * s, { foot: true, mat: "dark" }),
    box(shift(pl, 0.2 * s, 0, 0.55 * s), 0.7 * s, 0.3, 0.25, { foot: true, mat: "dark" }),
  ],
  /** A light bar: a long lit strip in a frame. */
  lightBar: (pl, s) => [
    box(on(pl, 0, 0), 2.0 * s, 0.45, 0.25, { foot: true, mat: "dark" }),
    box(shift(pl, 0, 0, 0.1), 1.7 * s, 0.22, 0.22, { foot: true, mat: "lamp" }),
  ],
  /** A step plate: a thin plate with its corners cut. */
  stepPlate: (pl, s) => [
    plate(on(pl, 0, 0), rect(1.6 * s, 1.0 * s, 0.3 * s), 0.3, { bevel: 0.1, mat: "olive" }),
  ],
  /** A number plate: a thin plate standing a little off the surface on two pegs. */
  numberPlate: (pl, s) => [
    plate(shift(pl, 0, 0, 0.15), rect(1.3 * s, 0.7 * s, 0.12), 0.18, { mat: "olive" }),
    box(on(pl, -0.35 * s, 0), 0.2, 0.2, 0.25, { foot: true, mat: "black" }),
    box(on(pl, 0.35 * s, 0), 0.2, 0.2, 0.25, { foot: true, mat: "black" }),
  ],
  /** A stud: a low frustum. */
  stud: (pl, s) => [box(on(pl, 0, 0), 0.7 * s, 0.7 * s, 0.35 * s, { foot: true, taper: 0.6, mat: "dark" })],
  /** A strip of rivets along X on a band. */
  rivetStrip: (pl, s) => [
    box(on(pl, 0, 0), 2.2 * s, 0.4, 0.15, { foot: true, mat: "dark" }),
    ...[-1, 0, 1].map((i) =>
      box(shift(pl, i * 0.75 * s, 0, 0.05), 0.25, 0.25, 0.2, { foot: true, mat: "steel" }),
    ),
  ],
  /** A shock absorber along X: a body and a spring's turns. */
  shock: (pl, s) => {
    const h = along(shift(pl, -0.9 * s, 0, 0.35 * s), "X");
    return [
      cyl(h, 0.16 * s, 0, 1.8 * s, { n: 4, mat: "steel" }),
      ...[0.35, 0.75, 1.15].map((z) => cyl(h, 0.32 * s, z * s, z * s + 0.18, { n: 6, mat: "red" })),
      box(on(pl, -0.9 * s, 0), 0.3, 0.5, 0.45 * s, { foot: true, mat: "dark" }),
      box(on(pl, 0.9 * s, 0), 0.3, 0.5, 0.45 * s, { foot: true, mat: "dark" }),
    ];
  },
  /** A motor: a drum along X with its end caps, on a mount. */
  motor: (pl, s) => {
    const h = along(shift(pl, -0.7 * s, 0, 0.55 * s), "X");
    return [
      box(on(pl, 0, 0), 1.2 * s, 0.9 * s, 0.3 * s, { foot: true, mat: "black" }),
      cyl(h, 0.45 * s, 0, 1.4 * s, { n: 8, mat: "dark", bevel: 0.08 }),
      cyl(h, 0.2 * s, 1.4 * s, 1.65 * s, { n: 6, mat: "steel" }),
    ];
  },
  /** A gear: a flat octagon on a hub. */
  gear: (pl, s) => [
    cyl(on(pl, 0, 0), 0.6 * s, 0, 0.22, { n: 8, mat: "dark" }),
    cyl(shift(pl, 0, 0, 0.1), 0.22 * s, 0, 0.32, { n: 6, mat: "steel" }),
  ],
  /** A camera: a body, a lens, a hood. */
  camera: (pl, s) => [
    box(on(pl, 0, 0), 0.9 * s, 0.7 * s, 0.6 * s, { foot: true, bevel: 0.1, mat: "dark" }),
    cyl(along(shift(pl, 0.4 * s, 0, 0.3 * s), "X"), 0.2 * s, 0, 0.35, { n: 6, mat: "lamp" }),
    box(shift(pl, 0.1 * s, 0, 0.6 * s), 1.1 * s, 0.75 * s, 0.12, { foot: true, mat: "black" }),
  ],
  /** An armour tab: a small plate with one corner cut deep. */
  armourTab: (pl, s, rnd) => {
    const w = 1.2 * s,
      h = 0.9 * s,
      c = 0.45 * s;
    const sx = rnd.chance(0.5) ? 1 : -1;
    const poly = outline([
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2 - c].map((v, i) => (i === 0 ? v * sx : v)),
      [(w / 2 - c) * sx, h / 2],
      [(-w / 2) * sx, h / 2],
    ]);
    return [plate(on(pl, 0, 0), poly, 0.3, { bevel: 0.1, mat: "olive" })];
  },
  /** A pipe elbow: up out of the surface and along it. */
  pipeElbow: (pl, s) => {
    const a = at(pl, 0, 0, -SINK),
      b = at(pl, 0, 0, 0.6 * s),
      c = at(pl, 1.2 * s, 0, 0.6 * s);
    return [
      tube(a, b, 0.16, { n: 4, mat: "black", up: pl.X }),
      tube(b, c, 0.16, { n: 4, mat: "black", up: pl.Z }),
      box(on(pl, 0, 0), 0.5, 0.5, 0.2, { foot: true, mat: "steel" }),
    ];
  },
  /** A bumper: a block with its top edges cut deep. */
  bumper: (pl, s) => [
    box(on(pl, 0, 0), 1.4 * s, 0.7 * s, 0.5 * s, { foot: true, bevel: 0.2 * s, cut: 0.15 * s, mat: "dark" }),
  ],
  /** A clamp: a band across X and its screw block. */
  clamp: (pl, s) => [
    box(on(pl, 0, 0), 0.35 * s, 1.3 * s, 0.25, { foot: true, mat: "steel" }),
    box(shift(pl, 0, 0.5 * s, 0.1), 0.45 * s, 0.4 * s, 0.35, { foot: true, mat: "dark" }),
  ],
  /** A fuse box: a box and three fuses along X. */
  fuseBox: (pl, s) => [
    box(on(pl, 0, 0), 1.3 * s, 0.7 * s, 0.4 * s, { foot: true, bevel: 0.08, mat: "dark" }),
    ...[-1, 0, 1].map((i) =>
      cyl(shift(pl, i * 0.38 * s, 0, 0.38 * s), 0.12 * s + 0.03, 0, 0.22, {
        n: 4,
        mat: i ? "steel" : "yellow",
      }),
    ),
  ],
  /** A coupling: two rings of other sizes along X. */
  coupling: (pl, s) => {
    const h = along(shift(pl, -0.5 * s, 0, 0.35 * s), "X");
    return [
      cyl(h, 0.35 * s, 0, 0.45 * s, { n: 6, mat: "dark" }),
      cyl(h, 0.25 * s, 0.45 * s, 1.0 * s, { n: 6, mat: "steel" }),
    ];
  },
  /** A relay: blocks stacked, each smaller. */
  relay: (pl, s) => [
    box(on(pl, 0, 0), 1.0 * s, 0.8 * s, 0.35 * s, { foot: true, mat: "dark" }),
    box(shift(pl, 0.1 * s, 0, 0.25 * s), 0.6 * s, 0.55 * s, 0.35 * s, {
      foot: true,
      bevel: 0.06,
      mat: "black",
    }),
  ],
  /** A manifold: a bar with pipe stubs out of it. */
  manifold: (pl, s, rnd) => {
    const n = rnd.int(2, 4);
    return [
      box(on(pl, 0, 0), 1.6 * s, 0.5 * s, 0.5 * s, { foot: true, bevel: 0.08, mat: "dark" }),
      ...Array.from({ length: n }, (_, i) =>
        cyl(
          along(shift(pl, (i - (n - 1) / 2) * ((1.2 * s) / n), 0.2 * s, 0.25 * s), "Y"),
          0.1 + 0.05 * s,
          0,
          0.45 * s,
          { n: 4, mat: "black" },
        ),
      ),
    ];
  },
  /** A spike of armour: a tapered block. */
  fin: (pl, s) => [
    box(on(pl, 0, 0), 1.4 * s, 0.25, 0.8 * s, { foot: true, taper: 0.4, taperY: 1, mat: "olive" }),
  ],
  /** A plug of cable: a socket and a cable out along X. */
  plug: (pl, s) => [
    box(on(pl, 0, 0), 0.5 * s, 0.5 * s, 0.4 * s, { foot: true, mat: "steel" }),
    tube(at(pl, 0.2 * s, 0, 0.25 * s), at(pl, 1.2 * s, 0, 0.1), 0.12, { n: 4, mat: "black", up: pl.Z }),
  ],
  /** A wedge: a block sloped from its back edge to a sharp front, a ramp of armour. */
  wedge: (pl, s, rnd) => [
    loft(
      on(pl, 0, 0),
      [
        {
          z: 0,
          poly: [
            [-0.8 * s, -0.5 * s],
            [0.8 * s, -0.5 * s],
            [0.8 * s, 0.5 * s],
            [-0.8 * s, 0.5 * s],
          ],
        },
        {
          z: 0.6 * s,
          poly: [
            [-0.8 * s, 0.3 * s],
            [0.8 * s * rnd.range(0.5, 1), 0.3 * s],
            [0.8 * s * rnd.range(0.5, 1), 0.5 * s],
            [-0.8 * s, 0.5 * s],
          ],
        },
      ],
      rnd.chance(0.5) ? "dark" : "olive",
    ),
  ],
  /** A gusset: a triangular rib standing on the surface. */
  gusset: (pl, s) => [
    plate(
      along(shift(pl, 0, -0.12, -SINK), "Y"),
      [
        [-0.7 * s, 0],
        [0.7 * s, 0],
        [-0.5 * s, -0.9 * s],
      ],
      0.24,
      { mat: "dark" },
    ),
  ],
  /** A tank: an upright cylinder with a cap. */
  tank: (pl, s, rnd) => [
    cyl(on(pl, 0, 0), 0.45 * s, 0, 0.9 * s, { n: 8, mat: rnd.chance(0.25) ? "yellow" : "dark", bevel: 0.08 }),
    cyl(shift(pl, 0, 0, 0.85 * s), 0.2 * s, 0, 0.2, { n: 6, mat: "steel" }),
  ],
};

/** The parts by what they suit: small fittings for anywhere, mechanisms for joints, larger gear for the trunk. */
export const SETS = {
  fitting: [
    "bolt",
    "boltRow",
    "stud",
    "latch",
    "rivetStrip",
    "connector",
    "port",
    "clamp",
    "numberPlate",
    "armourTab",
    "plug",
    "wedge",
    "gusset",
  ],
  mechanism: [
    "bracket",
    "clevis",
    "hinge",
    "actuator",
    "shock",
    "coupling",
    "gear",
    "connector",
    "cableBox",
    "relay",
    "gusset",
    "wedge",
  ],
  gear: [
    "vent",
    "grille",
    "cableBox",
    "junction",
    "heatSink",
    "fuseBox",
    "manifold",
    "motor",
    "canister",
    "tank",
    "valve",
    "conduit",
    "pipeElbow",
    "handle",
    "rail",
  ],
  sensor: ["lamp", "sensorPod", "camera", "antenna", "lightBar"],
  armour: ["armourTab", "stepPlate", "bumper", "fin", "numberPlate", "wedge"],
};

/** One part by its name: its solids, the same for the same seed. */
export function kitbash(name, pl, size, seed = 1) {
  const make = PARTS[name];
  if (!make) throw new Error(`kitbash: no part ${name}: there are ${Object.keys(PARTS).join(", ")}`);
  return make(pl, size, seeded(seed));
}
