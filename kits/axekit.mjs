// axekit: an axe made from a description. You say what the haft is like, what the bits of its head are
// (a "bit" is one blade of an axe's head) and what turned fittings sit on it, and the kit builds the
// triangles and paints the texture. Every axe made with it (a scythe too) looks as if it came from one hand.
//
//   import { axe, crescent, flared, bolts } from "../kits/axekit.mjs";
//   const piece = axe({ seed, haft, bits, turned, rings, extra });   // -> { tris, image, haft: true }
//
// What comes back is a "piece": `tris` (the triangles), `image` (the texture) and `haft: true`, which tells
// make/fit.mjs that the piece is held by a haft. Hand it to swapMesh or buildMdl (src/index.mjs), as
// examples/02-swap-mesh.mjs does with a sword. There is nothing to run in this file itself.
//
// The haft runs along x from the butt (y = z = 0 is its middle: make/fit.mjs lays that line on the
// original's handle); the bits spread in y, their thickness is z.
//
//   haft:   { profile: [[x, radius], ...], flatten, sides, tone: [dark, light] (wood), paint(q),
//             caps: [start, end] (its flat ends: both closed unless told), at(s, a, b) (where it stands:
//               along x unless told), twist (as a turned part's),
//             parts: [{ from, to, kind: "leather" | "cord" | "ribbed" | "lattice" | "metal", colour,
//                       metal, strap (for "lattice": the colour of its straps, [0.07, 0.06, 0.06] unless
//                       told) }] }
//           An axe may have no haft: the head alone, for a haft made otherwise or as a turned part.
//   bits:   [{ x0, x1 (where it starts and ends along the haft),
//             edges(k) -> [lo, hi] (k: 0 at x0, 1 at x1; `hi` is the cutting edge, `lo` the side towards
//               the haft: inside it, or free where the bit hangs past its neck),
//             side: 1 | -1, mirror (both sides, one drawing), thick, thin, eye, bevel, metal,
//             edgeMetal, rust, tint, paint(q), veins(q) (what glows in the game, on black),
//             at(s, t, g, side) (to place it otherwise: the scythe's blade),
//             stations (where its cross-sections are, 0..1 along it: those of `edges.stations` when the
//               edges come with some, as `crescent`'s and `flared`'s do, and fourteen spread along it
//               otherwise; more of them follow a curved edge more closely) }]
//           `crescent` and `flared` below make an `edges` from a few measures. There has to be one bit at
//           least: a haft with turned parts alone is bluntkit's.
//   turned: [{ profile, sides, flatten, metal, paint(q), caps, at,        sockets, collars, spikes, gems
//             twist (how far it is turned about its own axis, in radians: 0 unless told, and a quarter of
//               pi for a part of 4 sides, which then stands on a face),
//             px (pixels a unit along its skin: 40 unless told, and fewer when its skin is longer than its
//               row of the texture, which is 298 pixels) }]
//   rings:  [{ x, y, radius, tube, sides, metal, flatten }]              a ring lying flat, at the butt
//           x, y: its middle (y: 0 unless told); radius: from its middle to the middle of its tube; tube:
//           the tube's radius (0.25); sides: corners round the ring (6 here; bluntkit's rings have 8);
//           flatten: the tube's thickness (z) as a share of its width (1: round); metal: steel.
//   extra({ M, S, zone, seed })                                          parts of the piece's own
//                                                                        (M: the shape, S: the sheet)
//
// Metals as in swordkit.mjs. The texture is 1024x512, or 1024x1024 when a bit has veins: what glows is
// drawn again in the lower half, on a skin just over the metal. Each turned part and each ring takes a row
// of it, and there are ten rows (twenty-one in the taller texture): more are refused in words. `extra` gets
// the rows they leave.
//
// Words used below. A "zone" is a rectangle of the texture. A "station" is one cross-section of a part, at
// one place along it. `u`, `v` are always pixels inside a zone; colours are [r, g, b] from 0 to 1.
import {
  sheet,
  shape,
  steel,
  wood,
  leatherWrap,
  cylinderLight,
  times,
  mix,
  bell,
  step,
  fbm,
  noise,
} from "../make/workshop.mjs";
import { METALS } from "./swordkit.mjs";

const WIDTH = 1024;
/** How far the glowing skin stands off the metal under it. */
const SKIN = 0.06;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** The part of a number after its point: what makes a pattern repeat. */
const fract = (value) => value - Math.floor(value);
/** A metal as a function: the one named, steel when none is, or the caller's own function as it is. */
const metalOf = (metal) => (typeof metal === "function" ? metal : METALS[metal ?? "steel"]);

/**
 * The colour of a bound stretch of a haft. `part`: the stretch ({ kind, colour, metal }); `x` along it
 * from where it starts, `around` it (0..1), `light` how brightly it is lit there.
 */
export function wrap(part, x, around, light, seed) {
  if (part.kind === "metal")
    return metalOf(part.metal ?? "gunmetal")(x * 3, around * 4, light * 1.1, seed + 3);
  if (part.kind === "cord") {
    // flat braid, two strands crossing: whichever lies on top here, with a sheen across it
    const strandA = fract(x * 1.5 + around * 2);
    const strandB = fract(x * 1.5 - around * 2);
    const over = strandA < 0.5 ? strandA : strandB;
    return times(
      part.colour ?? [0.06, 0.06, 0.08],
      light *
        (0.65 + 0.75 * Math.sin(Math.PI * fract(over * 2)) ** 2) *
        (0.85 + 0.3 * noise(x * 40, around * 80, seed + 57)),
    );
  }
  if (part.kind === "lattice") {
    // leather under dark straps crossed over it
    const strapA = Math.abs(fract(x * 0.55 + around) - 0.5);
    const strapB = Math.abs(fract(x * 0.55 - around) - 0.5);
    const strap = Math.min(strapA, strapB);
    const base = part.colour ?? [0.36, 0.07, 0.06];
    const under = times(
      mix(base, times(base, 1.4), fbm(x * 2, around * 6, seed + 51, 3)),
      light * 1.2 * (1 - 0.5 * bell(strap - 0.13, 0.03)),
    );
    return strap < 0.1
      ? times(part.strap ?? [0.07, 0.06, 0.06], light * (0.8 + 1.2 * (1 - strap / 0.1) ** 0.5))
      : under;
  }
  if (part.kind === "ribbed") {
    // cloth bound down by dark rings, one every 1.05 units
    const inRepeat = fract(x / 1.05);
    const base = part.colour ?? [0.3, 0.31, 0.18];
    return inRepeat < 0.24
      ? times([0.07, 0.07, 0.06], light * (0.8 + 0.8 * Math.sin((Math.PI * inRepeat) / 0.24)))
      : times(
          mix(base, times(base, 1.45), fbm(x * 3, around * 8, seed + 53, 3)),
          light * 1.15 * (0.78 + 0.3 * Math.sin((Math.PI * (inRepeat - 0.24)) / 0.76)),
        );
  }
  // "leather", and anything else
  return times(leatherWrap(x, around, seed + 51, part.colour ?? [0.22, 0.12, 0.07]), light * 1.25);
}

export function axe(spec) {
  if (!spec.bits?.length)
    throw new Error(
      "axekit: an axe needs one bit at least in `bits` (a haft with turned parts alone is bluntkit's)",
    );
  // The texture and the shape. Veins need the taller texture and a black ground (they are drawn additively).
  const veined = spec.bits.some((bit) => bit.veins);
  const HEIGHT = veined ? 1024 : 512;
  const canvas = sheet(WIDTH, HEIGHT, veined ? [0, 0, 0] : undefined);
  const mesh = shape(WIDTH, HEIGHT);
  const seed = spec.seed ?? 1;

  /**
   * A turned part, built and painted in `zone`. `paint(x, around)` is told where the pixel is along x (not
   * along the part's skin, which is what the texture is stretched along) and around the part (0..1).
   */
  const lathed = (part, zone, paint) => {
    const profile = part.profile;
    // the length of the skin up to each point of the profile, and in all
    let run = 0;
    const runAt = profile.map(([x, radius], i) =>
      i ? (run += Math.hypot(x - profile[i - 1][0], radius - profile[i - 1][1])) : 0,
    );
    const pixelsPerUnit = Math.min(part.px ?? 40, (zone.w - 2) / run);
    /** The x of the point that is `along` units along the skin. */
    const xAtRun = (along) => {
      let i = 1;
      while (i < runAt.length - 1 && runAt[i] < along) i++;
      return (
        profile[i - 1][0] +
        (profile[i][0] - profile[i - 1][0]) *
          clamp((along - runAt[i - 1]) / (runAt[i] - runAt[i - 1] || 1), 0, 1)
      );
    };
    mesh.lathe(profile, zone, {
      sides: part.sides ?? 8,
      flatten: part.flatten ?? 1,
      px: pixelsPerUnit,
      caps: part.caps ?? [false, false],
      twist: part.twist ?? (part.sides === 4 ? Math.PI / 4 : 0), // a square part stands on a face
      at: part.at,
    });
    canvas.zone(zone, (u, v) => paint(xAtRun(clamp(u / pixelsPerUnit, 0, run)), clamp(v / zone.h, 0, 1)));
  };

  // ── the haft ──
  // One long strip across the top of the texture: wood (or the caller's paint), with the bound stretches
  // painted over it and a shadow on the wood at each end of a stretch. An axe may have none: its head alone.
  const haft = spec.haft;
  const bound = haft?.parts ?? [];
  if (haft)
    lathed({ caps: [true, true], ...haft, px: 24 }, { x: 8, y: 8, w: 1008, h: 56 }, (x, around) => {
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

  // ── the bits ──
  // First measure each: its length along the haft, how near the haft and how far out it reaches (`lowest`,
  // `highest`) and how wide it is at its widest.
  const measured = spec.bits.map((bit) => {
    const length = bit.x1 - bit.x0;
    /** The bit's two edges [lo, hi] at `along`; never closer than 0.03, so that a tip keeps a face. */
    const edgesAt = (along) => {
      const [lo, hi] = bit.edges(along);
      return hi - lo < 0.03 ? [(lo + hi) / 2 - 0.015, (lo + hi) / 2 + 0.015] : [lo, hi];
    };
    let lowest = Infinity;
    let highest = -Infinity;
    let widest = 0;
    for (let i = 0; i <= 60; i++) {
      const [lo, hi] = edgesAt(i / 60);
      lowest = Math.min(lowest, lo);
      highest = Math.max(highest, hi);
      widest = Math.max(widest, hi - lo);
    }
    return { bit, length, edgesAt, lowest, highest, widest };
  });

  // every face of every bit gets the same room: the layout that leaves them the most pixels
  const room = { x: 8, y: 76, w: 696, h: 428 };
  const faces = measured.length * 2;
  const longest = Math.max(...measured.map((one) => one.length));
  const tallest = Math.max(...measured.map((one) => one.highest - one.lowest));
  let layout = null;
  for (let cols = 1; cols <= faces; cols++) {
    const rows = Math.ceil(faces / cols);
    const px = Math.min((room.w / cols - 10) / longest, (room.h / rows - 10) / tallest);
    if (!layout || px > layout.px) layout = { cols, rows, px };
  }
  const bitPx = Math.min(40, layout.px); // pixels a unit, for every bit

  measured.forEach(({ bit, length, edgesAt, lowest, highest, widest }, bitIndex) => {
    const eye = bit.eye ?? 0.8; // how far from the haft's middle the bit is at its full thickness
    const bevel = bit.bevel ?? 1.2; // how wide the ground strip along the cutting edge is
    const thick = bit.thick ?? 0.5; // half its thickness at the eye
    const thin = bit.thin ?? 0.4; // what share of that is left where the bevel starts

    // Where its two faces are painted: cells `faceIndex` and `faceIndex + 1` of the layout. `yc` is the
    // row of the texture on which y = 0 (the haft's middle) falls.
    const cell = (faceIndex) => ({
      x: room.x + ((faceIndex % layout.cols) * room.w) / layout.cols + 4,
      y: room.y + (Math.floor(faceIndex / layout.cols) * room.h) / layout.rows + 4,
    });
    const faceZones = [0, 1].map((face) => {
      const corner = cell(bitIndex * 2 + face);
      return { x: Math.round(corner.x), yc: Math.round(corner.y) + 1 + highest * bitPx };
    });

    // the section: full at the eye, thinning towards the edge, ground to nothing in the bevel
    const thicknessAt = (across) => thick * (1 - (1 - thin) * step(eye, highest - bevel, across));
    const stations = (
      bit.stations ??
      bit.edges.stations ?? [0, 0.03, 0.08, 0.16, 0.26, 0.36, 0.46, 0.54, 0.64, 0.74, 0.84, 0.92, 0.97, 1]
    ).map((along) => {
      const [lo, hi] = edgesAt(along);
      const width = hi - lo;
      const free = lo > eye + 0.05; // here the bit hangs clear of the haft: its inner side closes too
      const closing = Math.min(1, width / (0.25 * widest)); // thinner where the bit is narrow
      // five points across, as shares of the width; the fourth is where the bevel starts
      const shares = [0, free ? 0.12 : 0.2, 0.5, Math.max(0.6, 1 - bevel / width), 1];
      return {
        s: bit.x0 + along * length,
        pts: shares.map((share, i) => {
          const across = lo + share * width;
          return [
            across,
            i === 4 || (free && i === 0)
              ? 0
              : thicknessAt(across) * closing * (i === 3 && bevel / width > 0.4 ? 0.8 : 1),
          ];
        }),
      };
    });

    // Build it: once on its side of the haft, or once on each when it is mirrored (both wear the same
    // drawing). Veins are a second copy, a little thicker, that takes its picture 512 pixels lower.
    const sides = bit.mirror ? [1, -1] : [bit.side ?? 1];
    for (const sign of sides) {
      const at = bit.at
        ? (s, across, height) => bit.at(s, across, height, sign)
        : (s, across, height) => [s, sign * across, height];
      mesh.plate(stations, faceZones[0], faceZones[1], { px: bitPx, s0: bit.x0, at });
      if (bit.veins) {
        const beforeSkin = mesh.tris.length;
        const skin = stations.map((station) => ({
          s: station.s,
          pts: station.pts.map(([across, height]) => [across, height > 0 ? height + SKIN : height]),
        }));
        mesh.plate(
          skin,
          { ...faceZones[0], yc: faceZones[0].yc + 512 },
          { ...faceZones[1], yc: faceZones[1].yc + 512 },
          { px: bitPx, s0: bit.x0, at },
        );
        // glow: drawn additively; flow: its texture moves
        for (const triangle of mesh.tris.slice(beforeSkin)) triangle.glow = triangle.flow = true;
      }
    }

    // Paint its two faces. The light falls from one side, so `side` is 1 on one face and -1 on the other.
    faceZones.forEach((zone, face) => {
      const side = face ? -1 : 1;
      const faceSeed = seed + bitIndex * 20 + (face ? 37 : 13);
      const bodyMetal = metalOf(bit.metal ?? "gunmetal");
      // the edge's metal: the one asked for, or steel with a little rust
      const edgeMetal = bit.edgeMetal
        ? metalOf(bit.edgeMetal)
        : (a, b, light, edgeSeed) => steel(a * 0.9, b * 1.2, light, edgeSeed, bit.rust ?? -0.45);

      /** Where a pixel of the face is on the bit: what `paint`, `tint` and `veins` are told (their `q`). */
      const pointAt = (u, v) => {
        const s = bit.x0 + u / bitPx; // along the haft
        const along = clamp((s - bit.x0) / length, 0, 1); // the same, 0..1 along the bit
        const [lo, hi] = edgesAt(along);
        const across = clamp(highest - v / bitPx, lo, hi); // out from the haft's middle
        return {
          s,
          k: along,
          lo,
          hi,
          t: across,
          rel: (across - lo) / (hi - lo),
          toEdge: hi - across,
          side,
          seed: faceSeed,
          bevel,
          eye,
        };
      };
      const rect = {
        x: zone.x,
        y: Math.round(zone.yc - highest * bitPx),
        w: Math.ceil(length * bitPx),
        h: Math.ceil((highest - lowest) * bitPx),
      };
      canvas.zone(
        rect,
        (u, v) => {
          const point = pointAt(u, v);
          const { s, t: across, lo, toEdge } = point;
          // 1 on the ground strip along the cutting edge, 0 on the cheek behind it
          const ground = step(bevel * 1.05, bevel * 0.92, toEdge);
          // the cheek's light: a soft hollow over the eye, a bright line where the grinding starts, a
          // dark one behind it, and a line cut along the edge further in
          point.light =
            (0.94 + 0.05 * side) * (1 - 0.16 * bell(across - eye, 0.5)) +
            0.2 * bell(toEdge - bevel, 0.07) -
            0.16 * bell(toEdge - bevel * 1.18, 0.1) -
            0.2 * bell(toEdge - bevel * 1.55, 0.045) +
            0.1 * bell(toEdge - bevel * 1.55 - 0.09, 0.04); // a line cut along the edge
          const cheek = times(
            bodyMetal(s * 1.0, across * 1.0, point.light, faceSeed),
            1 + 0.16 * (fbm(s * 1.7, across * 1.7, faceSeed + 7, 2) - 0.5),
          );
          // the ground strip: brighter metal, brightest on the very edge
          const edge = times(
            edgeMetal(s, across, 1.16 + 0.1 * side * (toEdge / bevel - 0.5), faceSeed + 3),
            1 + 0.3 * step(0.22, 0.05, toEdge),
          );
          // the kit's own colour goes to the caller's paint as `c`, with `ground` and `light`
          point.c = mix(cheek, edge, ground);
          point.ground = ground;
          let colour = bit.paint ? bit.paint(point) : point.c;
          const tint = typeof bit.tint === "function" ? bit.tint(point) : bit.tint;
          if (tint) colour = [colour[0] * tint[0], colour[1] * tint[1], colour[2] * tint[2]];
          // the free side catches a little light
          return lo > eye + 0.05 ? times(colour, 1 + 0.25 * bell(across - lo, 0.07)) : colour;
        },
        3,
      );
      if (bit.veins) canvas.zone({ ...rect, y: rect.y + 512 }, (u, v) => bit.veins(pointAt(u, v)), 3);
    });
  });

  // ── the fittings ──
  // Each turned part and each ring gets a row of its own, 44 pixels apart, at the right of the texture.
  const turned = spec.turned ?? [];
  const rings = spec.rings ?? [];
  const used = turned.length + rings.length;
  const fittingZone = (row) => ({ x: 716, y: 76 + row * 44, w: 300, h: 38 });
  // a row that runs off the texture's foot would have its part wear whatever is at the top of the picture
  let rows = 0;
  while (fittingZone(rows).y + fittingZone(rows).h <= HEIGHT) rows++;
  if (used > rows)
    throw new Error(
      `axekit: the fittings do not fit in the texture (${used} turned parts and rings, and it has rows for ${rows})`,
    );
  turned.forEach((part, i) => {
    const metal = metalOf(part.metal);
    const partSeed = seed + 100 + i * 7;
    lathed(part, fittingZone(i), (x, around) =>
      part.paint
        ? part.paint({ x, q: around, light: cylinderLight(around, 0.5), seed: partSeed, metal })
        : metal(x * 3, around * 4, cylinderLight(around, 0.5), partSeed),
    );
  });

  // A ring is a tube bent round into a circle that lies flat (in the plane of x and y).
  rings.forEach((ring, i) => {
    const zone = fittingZone(turned.length + i);
    const ringSides = ring.sides ?? 6; // corners round the ring
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

  // whatever the caller adds of its own, in the rows the fittings left. Ten fittings leave none: a part
  // built in a zone of no height, below the picture, is refused.
  if (spec.extra) {
    const zone = { x: 716, y: 76 + used * 44, w: 300, h: 504 - (76 + used * 44) };
    const beforeExtra = mesh.tris.length;
    spec.extra({ M: mesh, S: canvas, zone, seed });
    const belowPicture = (triangle) => triangle.some((corner) => corner.uv[1] > 1);
    if (zone.h <= 0 && mesh.tris.slice(beforeExtra).some(belowPicture))
      throw new Error(
        `axekit: the fittings leave \`extra\` no room in the texture (${used} turned parts and rings; its parts were put below the picture)`,
      );
  }
  return { tris: mesh.tris, image: canvas.image(), haft: true };
}

/**
 * Lightning running through a metal, for a bit's `veins` or `paint`: 0 away from a bolt, 1 on its core.
 * The bolts are the lines where a cloud of noise crosses its middle, `width` units wide (the cloud's slope
 * tells how far off the line a point is, so that they do not pool where the cloud is flat); finer ones
 * branch off.
 */
export function bolts(x, y, seed, scale = 0.2, width = 0.12) {
  /** How much on the line where `cloud` crosses 0.5 this point is, the line being `lineWidth` wide. */
  const line = (cloud, lineWidth) => {
    const nudge = 0.06; // how far aside the cloud is read to find its slope
    const here = cloud(x, y);
    const distance =
      Math.abs(here - 0.5) /
      (Math.hypot(cloud(x + nudge, y) - here, cloud(x, y + nudge) - here) / nudge + 0.02);
    return step(lineWidth, lineWidth * 0.25, distance);
  };
  return Math.max(
    line((px, py) => fbm(px * scale, py * scale, seed, 4), width),
    0.55 * line((px, py) => fbm(px * scale * 2.4 + 9, py * scale * 2.4, seed + 31, 3), width * 0.7),
  );
}

/**
 * The edges of a crescent bit, for a bit's `edges`: a round edge that reaches `reach` at `mid` and comes
 * back towards the haft at both ends, down to `tip0` (at `x0`) and `tip1` (at `x1`); a neck on the haft
 * from `n0` to `n1`, and between the neck and each tip a hollow, `hollow0` and `hollow1` deep.
 */
export function crescent({
  x0,
  x1,
  n0,
  n1,
  mid = (n0 + n1) / 2,
  reach,
  tip0,
  tip1,
  hollow0,
  hollow1,
  root = 0.3,
  neck = 1.3,
  round = 0.55,
}) {
  const edges = (k) => {
    const x = x0 + k * (x1 - x0);
    // the cutting edge: an arc from the tip on this side of `mid` up to `reach`
    const beforeMid = x < mid;
    const tip = beforeMid ? tip0 : tip1;
    const fromMid = beforeMid ? (mid - x) / (mid - x0) : (x - mid) / (x1 - mid);
    const hi = tip + (reach - tip) * Math.max(0, 1 - fromMid * fromMid) ** round;
    // on the neck the bit goes into the haft
    if (x >= n0 && x <= n1) return [root, hi];
    // past the neck its inner side is free: from the neck out to just under the tip, hollowed between
    const fromNeck = beforeMid ? (n0 - x) / (n0 - x0) : (x - n1) / (x1 - n1);
    const lo =
      neck +
      (tip - 0.08 - neck) * fromNeck +
      (beforeMid ? hollow0 : hollow1) * Math.sin(Math.PI * fromNeck) ** 0.8;
    return [Math.min(lo, hi), hi];
  };
  // Where the stations go (0..1 along the bit): one each side of where the neck starts and ends, so that
  // the hollows start sharp, and the rest spread evenly between.
  const neckStart = (n0 - x0) / (x1 - x0);
  const neckEnd = (n1 - x0) / (x1 - x0);
  const between = (from, to, count) =>
    Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 1)) / (count + 1));
  edges.stations = [
    0,
    0.012,
    ...between(0.012, neckStart, 6),
    neckStart - 0.004,
    neckStart + 0.004,
    ...between(neckStart, neckEnd, 2),
    neckEnd - 0.004,
    neckEnd + 0.004,
    ...between(neckEnd, 0.988, 5),
    0.988,
    1,
  ];
  return edges;
}

/**
 * The edges of a flared bit, for a bit's `edges`: a neck on the haft from `n0` to `n1`, spreading to an
 * edge from `x0` to `x1` that reaches `reach` (bulging by `bulge` in the middle). `lower`, `upper`: how the
 * two horns sweep (smaller = more hollow).
 */
export function flared({
  x0,
  x1,
  n0,
  n1,
  reach,
  bulge = 1,
  root = 0.3,
  neck = 1.0,
  lower = 0.6,
  upper = 0.6,
}) {
  const mid = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  /** The cutting edge at x: `reach` in the middle, `bulge` less at each end. */
  const edgeAt = (x) => reach - bulge * ((x - mid) / half) ** 2;
  const tip0 = edgeAt(x0) - 0.1;
  const tip1 = edgeAt(x1) - 0.1;
  const edges = (k) => {
    const x = x0 + k * (x1 - x0);
    const hi = edgeAt(x);
    // the inner side: in the haft on the neck, sweeping out to just under each tip beyond it
    const lo =
      x < n0
        ? neck + (tip0 - neck) * ((n0 - x) / (n0 - x0)) ** lower
        : x > n1
          ? neck + (tip1 - neck) * ((x - n1) / (x1 - n1)) ** upper
          : root;
    return [Math.min(lo, hi), hi];
  };
  // a station each side of where the neck ends, so that the horns start sharp
  const neckStart = (n0 - x0) / (x1 - x0);
  const neckEnd = (n1 - x0) / (x1 - x0);
  const between = (from, to, count) =>
    Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 1)) / (count + 1));
  edges.stations = [
    0,
    ...between(0, neckStart, 4),
    neckStart - 0.004,
    neckStart + 0.004,
    ...between(neckStart, neckEnd, 2),
    neckEnd - 0.004,
    neckEnd + 0.004,
    ...between(neckEnd, 1, 4),
    1,
  ]
    .filter((k) => k >= 0 && k <= 1)
    .sort((first, second) => first - second);
  return edges;
}
