// bluntkit: a blunt weapon made from a description: a haft and the turned parts on it (a head, its spikes,
// collars, caps). Maces, hammers, mauls, clubs, bats. A "turned" part is one made as on a lathe: a profile
// spun about an axis.
//
//   import { blunt, toward } from "../kits/bluntkit.mjs";
//   const piece = blunt({ seed, haft, parts, rings });   // -> { tris, image, haft: true }
//
// What comes back is a "piece": `tris` (the triangles), `image` (the texture) and `haft: true`, which tells
// make/fit.mjs that the piece is held by a haft. Hand it to swapMesh or buildMdl (src/index.mjs), as
// examples/02-swap-mesh.mjs does with a sword. There is nothing to run in this file itself.
//
// The haft runs along x from the butt (y = z = 0 is its middle: make/fit.mjs lays that line on the
// original's handle).
//
//   haft:  as in axekit.mjs: { profile, flatten, sides, tone, paint(q), parts: [bound stretches],
//            caps: [start, end] (its flat ends: both closed unless told),
//            at(s, a, b) (where it stands, as a part's `at`: along x unless told) }
//          A blunt may have no haft: its parts alone.
//   parts: [{ profile: [[s, radius], ...], sides, flatten, twist, caps: [start, end] (flat ends),
//             at(s, a, b) (where it stands: along x unless told; `toward` makes one),
//             copies: [at, ...] (the same part several times, one drawing: spikes, studs),
//             metal, paint(q), cap(q) (its flat ends), veins(q) (what glows in the game, on black;
//             `still`: it glows without moving), px (pixels a unit: 12 unless told), h (pixels round it),
//             capPx (pixels a unit on its flat ends: 1.3 times `px` unless told),
//             faceted (true: each face has a light of its own and bright edges; false: lit as a round
//               thing; unless told, a part of six sides or fewer is faceted and one of more is not) }]
//          `q` of paint: { x (along its axis), q (round it, 0..1), a, b (the same two in units: `a` is `x`
//          again, `b` is how far round it at its widest), r, face, f (across the face, 0..1), edge (1 on
//          the edge between two faces), light, seed, metal }
//          `q` of cap:   { u, v (-1..1 across the end), d (0 in its middle, 1 on its rim), end, r, light
//          (always 1: a flat end is lit evenly, and the shade towards its rim is yours to paint from `d`),
//          seed, metal }
//   rings: [{ x, y, radius, tube, sides, metal, flatten }]     a ring lying flat, at the butt
//          x, y: its middle (y: 0 unless told); radius: from its middle to the middle of its tube; tube:
//          the tube's radius (0.25); sides: corners round the ring (8 here; axekit's rings have 6);
//          flatten: the tube's thickness (z) as a share of its width (1: round); metal: steel.
//
// The texture is 1024x512, or 1024x1024 when a part has veins: what glows is drawn again in the lower
// half, on a skin just over the part. The parts find their own room in it.
//
// Words used below. A "zone" is a rectangle of the texture. `u`, `v` are always pixels inside a zone;
// colours are [r, g, b] from 0 to 1. The "run" of a profile is the length of its skin: the texture is
// stretched along that, not along the axis.
import { sheet, shape, wood, cylinderLight, bell } from "../make/workshop.mjs";
import { METALS } from "./swordkit.mjs";
import { wrap } from "./axekit.mjs";

const WIDTH = 1024;
/** How far the glowing skin stands off the part under it. */
const SKIN = 0.06;
/** Pixels left between two parts in the texture. */
const GAP = 9;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** A metal as a function: the one named, steel when none is, or the caller's own function as it is. */
const metalOf = (metal) => (typeof metal === "function" ? metal : METALS[metal ?? "steel"]);
/** The vector at right angles to two others. */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A vector made one unit long. */
const unit = (vector) => {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
};

/**
 * Where a part stands when its axis starts at `origin` and runs towards `direction`: an `at` for it.
 * The function it returns takes a point of the part (s along its axis, a and b across it) to x, y, z.
 */
export function toward(origin, direction) {
  // three directions at right angles: the axis, and two across it
  const axis = unit(direction);
  const acrossA = unit(cross(Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], axis));
  const acrossB = cross(axis, acrossA);
  return (s, a, b) => [0, 1, 2].map((k) => origin[k] + axis[k] * s + acrossA[k] * a + acrossB[k] * b);
}

export function blunt(spec) {
  // The texture and the shape. Veins need the taller texture and a black ground (they are drawn additively).
  const parts = spec.parts ?? [];
  const rings = spec.rings ?? [];
  const veined = parts.some((part) => part.veins);
  const HEIGHT = veined ? 1024 : 512;
  const canvas = sheet(WIDTH, HEIGHT, veined ? [0, 0, 0] : undefined);
  const mesh = shape(WIDTH, HEIGHT);
  const seed = spec.seed ?? 1;

  /** The length of a profile's skin: in all (`run`) and up to each of its points (`runAt`). */
  const runOf = (profile) => {
    let run = 0;
    const runAt = profile.map(([x, radius], i) =>
      i ? (run += Math.hypot(x - profile[i - 1][0], radius - profile[i - 1][1])) : 0,
    );
    return { run, runAt };
  };
  /**
   * Where a point of the strip is on the profile, `along` being how far along the skin it is: its place
   * along the axis and the radius there.
   */
  const onProfile = (profile, runAt, along) => {
    let i = 1;
    while (i < runAt.length - 1 && runAt[i] < along) i++;
    const share = clamp((along - runAt[i - 1]) / (runAt[i] - runAt[i - 1] || 1), 0, 1);
    return [
      profile[i - 1][0] + (profile[i][0] - profile[i - 1][0]) * share,
      profile[i - 1][1] + (profile[i][1] - profile[i - 1][1]) * share,
    ];
  };

  // ── the haft ──
  // One long strip across the top of the texture: wood (or the caller's paint), with the bound stretches
  // painted over it and a shadow on the wood at each end of a stretch.
  const haft = spec.haft;
  if (haft) {
    const bound = haft.parts ?? [];
    const { run, runAt } = runOf(haft.profile);
    const zone = { x: 8, y: 8, w: 1008, h: 56 };
    const pixelsPerUnit = Math.min(24, (zone.w - 2) / run);
    mesh.lathe(haft.profile, zone, {
      sides: haft.sides ?? 8,
      flatten: haft.flatten ?? 1,
      px: pixelsPerUnit,
      caps: haft.caps ?? [true, true],
      at: haft.at,
    });
    canvas.zone(zone, (u, v) => {
      const [x] = onProfile(haft.profile, runAt, clamp(u / pixelsPerUnit, 0, run));
      const around = clamp(v / zone.h, 0, 1);
      const light = cylinderLight(around);
      const stretch = bound.find((candidate) => x >= candidate.from && x <= candidate.to);
      if (stretch)
        return wrap(
          stretch,
          x - stretch.from,
          around,
          light * (1 - 0.35 * bell(x - stretch.from, 0.12) - 0.35 * bell(x - stretch.to, 0.12)),
          seed + 60 + bound.indexOf(stretch) * 5,
        );
      let shade = 1;
      for (const other of bound) shade -= 0.3 * (bell(x - other.from, 0.18) + bell(x - other.to, 0.18));
      return haft.paint
        ? haft.paint({ x, q: around, light: light * shade, seed })
        : wood(x, around * 3.2, light * shade * 1.15, seed + 41, haft.tone);
    });
  }

  // ── the room each part asks for in the texture, and where it gets it ──
  // `asks` collects every rectangle wanted ({ w, h }); the packing below gives each its x and y.
  const asks = [];
  const measured = parts.map((part, partIndex) => {
    const profile = part.profile;
    const { run, runAt } = runOf(profile);
    const widestRadius = Math.max(...profile.map((point) => point[1]));
    const pixelsPerUnit = part.px ?? 12;
    const sides = part.sides ?? 8;
    // how far it is round the part at its widest (a flattened part is less far round)
    const girth = (2 * Math.PI * widestRadius * (1 + (part.flatten ?? 1))) / 2;
    const measure = {
      part,
      profile,
      run,
      runAt,
      pixelsPerUnit,
      sides,
      girth,
      twist: part.twist ?? (sides === 4 ? Math.PI / 4 : 0), // a square part stands on a face
      // its strip: as long as its skin, and as high as its girth asks (between 20 and 150 pixels)
      zone: {
        w: Math.ceil(run * pixelsPerUnit) + 2,
        h: part.h ?? Math.round(clamp(girth * pixelsPerUnit * 0.55, 20, 150)),
      },
      caps: [null, null],
      seed: seed + 100 + partIndex * 7,
    };
    asks.push(measure.zone);
    // a square for each flat end that was asked for, as wide as the end
    (part.caps ?? [false, false]).forEach((wanted, end) => {
      if (!wanted) return;
      const side = Math.ceil(
        2 * profile[end ? profile.length - 1 : 0][1] * (part.capPx ?? pixelsPerUnit * 1.3),
      );
      asks.push((measure.caps[end] = { w: side, h: Math.max(8, Math.round(side * (part.flatten ?? 1))) }));
    });
    return measure;
  });
  const ringZones = rings.map(() => {
    const zone = { w: 150, h: 34 };
    asks.push(zone);
    return zone;
  });

  // Pack them on shelves under the haft's strip: the tallest first, left to right, and a new shelf when
  // the row is full.
  let nextX = 8;
  let shelfY = 76;
  let shelfHeight = 0;
  for (const zone of [...asks].sort((first, second) => second.h - first.h)) {
    if (nextX + zone.w > WIDTH - 8) {
      nextX = 8;
      shelfY += shelfHeight + GAP;
      shelfHeight = 0;
    }
    if (shelfY + zone.h > 504)
      throw new Error("bluntkit: the parts do not fit in the texture (lower some `px`)");
    zone.x = nextX;
    zone.y = shelfY;
    nextX += zone.w + GAP;
    shelfHeight = Math.max(shelfHeight, zone.h);
  }

  // ── the parts ──
  for (const measure of measured) {
    const { part, profile, run, runAt, pixelsPerUnit, sides, girth, twist, zone, caps } = measure;
    const partSeed = measure.seed;
    const metal = metalOf(part.metal);
    const faceted = part.faceted ?? sides <= 6;
    const flatten = part.flatten ?? 1;

    // Build it, once for each place it stands in (all the copies wear the same drawing). Veins are a
    // second copy, a little fatter, that takes its picture 512 pixels lower.
    for (const at of part.copies ?? [part.at]) {
      mesh.lathe(profile, zone, {
        sides,
        flatten,
        px: pixelsPerUnit,
        twist,
        at,
        caps: caps.map((cap) => cap ?? false),
      });
      if (part.veins) {
        const beforeSkin = mesh.tris.length;
        mesh.lathe(
          profile.map(([s, radius]) => [s, radius > 0 ? radius + SKIN : radius]),
          { ...zone, y: zone.y + 512 },
          { sides, flatten, px: pixelsPerUnit, twist, at },
        );
        // glow: drawn additively; flow: its texture moves (unless the part is `still`)
        for (const triangle of mesh.tris.slice(beforeSkin)) {
          triangle.glow = true;
          if (!part.still) triangle.flow = true;
        }
      }
    }

    /** Where a pixel of the part's strip is on the part: what `paint` and `veins` are told (their `q`). */
    const pointAt = (u, v) => {
      const [x, radius] = onProfile(profile, runAt, clamp(u / pixelsPerUnit, 0, run));
      const around = clamp(v / zone.h, 0, 1);
      // which face it is on, and how far across that face (0..1)
      const inFaces = around * sides;
      const face = Math.min(sides - 1, Math.floor(inFaces));
      const acrossFace = inFaces - face;
      // a faceted part: each face lit as it faces, and a bright line on the edge between two
      const edge = faceted ? bell(Math.min(acrossFace, 1 - acrossFace), 0.07) : 0;
      const light = faceted
        ? 0.8 + 0.2 * Math.cos((2 * Math.PI * (face + 0.5)) / sides + twist - 1.0) + 0.28 * edge
        : cylinderLight(around, 0.5);
      return {
        x,
        q: around,
        a: x,
        b: around * girth,
        r: radius,
        face,
        f: acrossFace,
        edge,
        light,
        seed: partSeed,
        metal,
      };
    };
    canvas.zone(zone, (u, v) => {
      const point = pointAt(u, v);
      return part.paint ? part.paint(point) : metal(point.a * 1.5, point.b * 1.5, point.light, partSeed);
    });
    if (part.veins) canvas.zone({ ...zone, y: zone.y + 512 }, (u, v) => part.veins(pointAt(u, v)), 3);

    // its flat ends
    caps.forEach((capZone, end) => {
      if (!capZone) return;
      const radius = profile[end ? profile.length - 1 : 0][1];
      // a polygon's flat is nearer its middle than its corners are: this brings `d` to 1 on the rim
      const flatShare = Math.cos(Math.PI / sides);
      canvas.zone(capZone, (u, v) => {
        // from the middle of the end: -1..1 each way
        const acrossU = (u - capZone.w / 2) / (capZone.w / 2);
        const acrossV = (v - capZone.h / 2) / (capZone.h / 2);
        const point = {
          u: acrossU / flatShare,
          v: acrossV / flatShare,
          d:
            sides === 4
              ? Math.max(Math.abs(acrossU), Math.abs(acrossV)) / flatShare
              : Math.hypot(acrossU, acrossV) / flatShare,
          end,
          r: radius,
          light: 1,
          seed: partSeed + 3 + end,
          metal,
        };
        return part.cap
          ? part.cap(point)
          : metal(
              point.u * radius * 1.5,
              point.v * radius * 1.5,
              1.05 - 0.3 * bell(point.d - 1, 0.2),
              point.seed,
            );
      });
    });
  }

  // ── the rings ──
  // A ring is a tube bent round into a circle that lies flat (in the plane of x and y).
  rings.forEach((ring, i) => {
    const zone = ringZones[i];
    const ringSides = ring.sides ?? 8; // corners round the ring
    const tubeSides = 6; // corners round the tube
    const tube = ring.tube ?? 0.25; // the tube's radius
    const metal = metalOf(ring.metal);
    const centreY = ring.y ?? 0;
    /** The corner at step `ringStep` round the ring and `tubeStep` round the tube. */
    const corner = (ringStep, tubeStep) => {
      const ringAngle = (2 * Math.PI * ringStep) / ringSides + Math.PI / ringSides;
      const tubeAngle = (2 * Math.PI * tubeStep) / tubeSides;
      const fromCentre = ring.radius + tube * Math.cos(tubeAngle);
      return mesh.V(
        [
          ring.x + fromCentre * Math.cos(ringAngle),
          centreY + fromCentre * Math.sin(ringAngle),
          tube * (ring.flatten ?? 1) * Math.sin(tubeAngle),
        ],
        [zone.x + (zone.w * ringStep) / ringSides, zone.y + (zone.h * tubeStep) / tubeSides],
      );
    };
    for (let ringStep = 0; ringStep < ringSides; ringStep++)
      for (let tubeStep = 0; tubeStep < tubeSides; tubeStep++) {
        // the last argument is a point inside the tube: the face is turned to look away from it
        const ringAngle = (2 * Math.PI * (ringStep + 0.5)) / ringSides + Math.PI / ringSides;
        mesh.quad(
          corner(ringStep, tubeStep),
          corner(ringStep + 1, tubeStep),
          corner(ringStep + 1, tubeStep + 1),
          corner(ringStep, tubeStep + 1),
          [ring.x + ring.radius * Math.cos(ringAngle), centreY + ring.radius * Math.sin(ringAngle), 0],
        );
      }
    canvas.zone(zone, (u, v) =>
      metal(u / 12, v / 12, 0.8 + 0.4 * Math.cos(2 * Math.PI * (v / zone.h - 0.2)), seed + 150 + i * 7),
    );
  });
  return { tris: mesh.tris, image: canvas.image(), haft: true };
}
