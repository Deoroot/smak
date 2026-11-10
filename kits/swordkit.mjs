// swordkit: a sword made from a description. You say what the blade, the guard, the grip and the pommel are
// like (a few numbers each, and a choice of material) and the kit builds the triangles and paints the
// texture.
// Every blade made with it looks as if it came from the same hand.
//
//   import { sword, taper } from "../kits/swordkit.mjs";
//   const piece = sword({ seed, tall, blade, guard, grip, pommel, collar, extra });   // -> { tris, image }
//
// What comes back is a "piece": `tris` (the triangles, each corner with its place in the texture) and `image`
// (the texture, 1024 pixels wide, as { width, height, rgb }). Hand it to swapMesh or buildMdl
// (src/index.mjs); examples/02-swap-mesh.mjs does so from start to end. There is nothing to run in this file
// itself.
//
// The sword lies along x, from the end of the pommel to the tip. The blade's width is along y and its
// thickness along z. All sizes are in the game's units.
//
//   blade:  { x0, x1 (where it starts and ends),
//             half(k) (half its width) or edges(k) -> [lo, hi] (its two edges, about the centreline),
//               k being 0 at the guard and 1 at the tip,
//             curve(k) (how far the centreline bends in y),
//             section: "diamond" | "single" (one edge, on +y) | "fuller" (a groove down the middle),
//             thick, rust, tint ([r, g, b] or a function of the point), fullerTo, bevel, stations,
//             paint(q) (your own paint), raw (leave the paint as it is: no ground edges),
//             px (pixels a unit, 36 unless told: a short blade can be painted finer),
//             glow (drawn additively in the game: ice),
//             bright (solid, but the room's light does not dim it: fire),
//             flames(q) (fire standing off the blade, painted on black: a skin over the blade that reaches
//               `flameOut` past each edge and `flameOn` of its length past the tip, and the same again across
//               the blade, `flameCross` as wide; it glows and moves in the game.
//               q: x, t, k (past 1 beyond the tip), lo, hi, mid, out, past (0..1 beyond the tip), side,
//               seed),
//             flameStations (how many cross-sections the skin of flames has along it: 28 unless told) }
//   guard:  { x, sections: [[y, half length, half thickness], ...], sweep(y), metal, gem: colour, paint(q) }
//           or { x, disc: radius, thick, flatten, metal } for a round one
//   grip:   { profile: [[x, radius], ...], flatten, sides,
//             wrap: "leather" | "cord" | "ivory" | "lattice" | "ribbed", colour, paint(q),
//             mottle (for "lattice" only: see below) }
//           "cord" is a flat braid of `colour` (near black unless told) over ray skin, which shows pale in
//           small diamonds between the strands whatever `colour` is.
//           "lattice" is leather of `colour` (a dark red unless told) under black straps. The leather is
//           mottled towards `mottle`: a colour, [0.5, 0.12, 0.09] unless told. That is a red, which suits
//           the leather's own colour and no other: with a `colour` of your own give `mottle: "own"`, and it
//           is mottled towards `colour` 1.4 times as bright.
//           (axekit's `wrap` paints a haft with the same five words, a little differently: its cord has no
//           ray skin, and its lattice is always mottled towards its own colour and takes a `strap` colour.)
//   pommel: { profile, flatten, sides, metal }
//   collar: the same as the pommel: a band between grip and blade
//   tall:   a taller texture (1024x384; 1024x1024 with flames, which are drawn in its lower half). The guard
//           is painted three times as fine in the band below, and `extra({ M, S, zone, seed })` may add parts
//           of its own in what is left of it (M: the shape being built, S: the sheet being painted)
//   extra:  needs `tall: true` (or flames): the 1024x256 texture has no room left, and the zone `extra` is
//           handed lies below it. An `extra` that builds a part there is refused in words.
//
// Metals: "steel", "gunmetal", "black", "brass", "bone", or a function (a, b, light, seed) -> colour, where
// a and b say where the point is on the part and `light` how brightly it is lit (1 = plainly).
//
// Words used below. A "zone" is a rectangle of the texture. A "station" is one cross-section of a part, at
// one place along it. `u`, `v` are always pixels inside a zone; colours are [r, g, b] from 0 to 1.
import {
  sheet,
  shape,
  steel,
  iron,
  leatherWrap,
  cylinderLight,
  times,
  mix,
  bell,
  step,
  fbm,
  noise,
} from "../make/workshop.mjs";

const WIDTH = 1024;
/** The leather of a "lattice" grip when no `colour` is given, and what it is mottled towards. */
const LATTICE_LEATHER = [0.36, 0.07, 0.06];
const LATTICE_MOTTLE = [0.5, 0.12, 0.09];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** The part of a number after its point: what makes a pattern repeat. */
const fract = (value) => value - Math.floor(value);

// ── metals ─────────────────────────────────────────────────────────────────
// Each takes where the point is on the part (a, b), how brightly it is lit, and a seed for its noise.
export const METALS = {
  steel: (a, b, light, seed) => times(iron(a, b, light, seed, -0.15), 1.7),
  gunmetal: (a, b, light, seed) => times(iron(a, b, light, seed, -0.3), 1.25),
  black: (a, b, light, seed) => times(iron(a, b, light, seed, -0.3), 0.72),
  brass: (a, b, light, seed) => {
    let colour = mix(
      [0.34, 0.23, 0.07],
      [0.8, 0.63, 0.26],
      clamp(0.5 * light - 0.05 + 0.3 * (fbm(a * 2, b * 2, seed, 3) - 0.5), 0, 1),
    );
    // tarnish in broad patches, then small dark pits
    colour = mix(colour, [0.2, 0.21, 0.12], 0.5 * step(0.55, 0.75, fbm(a * 1.2, b * 1.2, seed + 9, 3)));
    return times(colour, 1 - 0.3 * step(0.64, 0.76, fbm(a * 20, b * 20, seed + 13, 2)));
  },
  bone: (a, b, light, seed) =>
    times(
      mix([0.5, 0.45, 0.33], [0.84, 0.79, 0.64], fbm(a * 1.5, b * 4, seed, 3)),
      light * (1 - 0.25 * step(0.6, 0.72, fbm(a * 9, b * 3, seed + 5, 2))),
    ),
};

/** A metal as a function: the one named, steel when none is, or the caller's own function as it is. */
const metalOf = (metal) => (typeof metal === "function" ? metal : METALS[metal ?? "steel"]);

/**
 * Carved ivory: pale, with scrollwork cut into it and blackened, and a row of scales here and there.
 * `x` along the part, `q` around it (0..1).
 */
export function carved(x, q, light, seed) {
  const ivory = times(mix([0.62, 0.57, 0.42], [0.9, 0.86, 0.7], fbm(x * 1.2, q * 5, seed, 3)), light);
  // the scrollwork: lines where a wandering number crosses a half
  const wander = 2.6 * fbm(x * 0.55, q * 2.2, seed + 3, 2) + 0.6 * x;
  const scroll = Math.abs(fract(wander * 1.7) - 0.5);
  // where scales are cut in place of scrolls (0 or 1, soft between)
  const scales = step(0.52, 0.6, fbm(x * 0.4 + 5, q * 1.5, seed + 7, 2));
  // the scales: twelve rows around, every other row shifted by half a scale
  const row = Math.floor(q * 12);
  const arc = Math.hypot(fract(x * 2.6 + 0.5 * (row % 2)) - 0.5, fract(q * 12) - 0.9);
  const cut = Math.max(bell(scroll, 0.07) * (1 - scales), bell(arc - 0.5, 0.09) * scales);
  return mix(ivory, [0.09, 0.08, 0.06], 0.9 * cut);
}

export function sword(spec) {
  // The texture and the shape. Flames need the tall texture and a black ground (they are drawn additively).
  const flamed = Boolean(spec.blade.flames);
  const tall = spec.tall || flamed;
  const HEIGHT = flamed ? 1024 : tall ? 384 : 256;
  const canvas = sheet(WIDTH, HEIGHT, flamed ? [0, 0, 0] : undefined);
  const mesh = shape(WIDTH, HEIGHT);
  const seed = spec.seed ?? 1;

  // Where each part is painted in the texture. The blade's two faces lie side by side along the top
  // (`yc` is the row its centreline is on); the small parts are stacked at the right.
  const zones = {
    bladeA: { x: 8, yc: 64 },
    bladeB: { x: 8, yc: 192 },
    grip: { x: 848, y: 8, w: 168, h: 70 },
    pommel: { x: 848, y: 88, w: 100, h: 56 },
    butt: { x: 960, y: 92, w: 48, h: 48 },
    discA: { x: 848, y: 154, w: 44, h: 44 },
    discB: { x: 900, y: 154, w: 44, h: 44 },
    discRim: { x: 952, y: 156, w: 60, h: 40 },
    // the guard: two strips beside the pommel, or the band below when the texture is tall
    guard: tall
      ? { A: { x: 8, yc: 320 }, B: { x: 424, yc: 320 }, up: 60, wide: 404, fine: 60 }
      : { A: { x: 848, yc: 176 }, B: { x: 848, yc: 224 }, up: 20, wide: 164, fine: 30 },
    collar: tall ? { x: 848, y: 156, w: 90, h: 60 } : { x: 848, y: 206, w: 60, h: 40 },
    extra: { x: 840, y: 262, w: 176, h: 116 },
  };

  // ── the blade ──
  const blade = spec.blade;
  const bladeLength = blade.x1 - blade.x0;
  /** How far along the blade a place on x is: 0 at the guard, 1 at the tip. */
  const alongBlade = (x) => clamp((x - blade.x0) / bladeLength, 0, 1);
  /** The blade's two edges [lo, hi] at `along`; never closer than 0.03, so that the tip keeps a face. */
  const edgesAt = (along) => {
    const [lo, hi] = blade.edges ? blade.edges(along) : [-blade.half(along), blade.half(along)];
    return hi - lo < 0.03 ? [(lo + hi) / 2 - 0.015, (lo + hi) / 2 + 0.015] : [lo, hi];
  };
  const curve = blade.curve ?? (() => 0);
  const section = blade.section ?? "diamond";
  const twoEdged = section !== "single";

  // Measure the blade: how far from the centreline it reaches and how wide it is at its widest.
  let reach = 0;
  let widest = 0;
  for (let i = 0; i <= 40; i++) {
    const edges = edgesAt(i / 40);
    reach = Math.max(reach, ...edges.map(Math.abs));
    widest = Math.max(widest, edges[1] - edges[0]);
  }
  // Pixels a unit: as fine as asked, but the blade must fit its strip (832 pixels long, 56 each side).
  const bladePx = Math.min(blade.px ?? 36, 832 / bladeLength, 56 / reach);

  // The cross-section at each station: points [across, half thickness] from one edge to the other.
  // The blade thins where it narrows, so that the point is not a slab.
  const stations = (
    blade.stations ?? [0, 0.04, 0.1, 0.2, 0.32, 0.44, 0.56, 0.68, 0.78, 0.86, 0.92, 0.96, 0.985, 1]
  ).map((along) => {
    const [lo, hi] = edgesAt(along);
    const width = hi - lo;
    const halfThick = (blade.thick ?? 0.24) * Math.min(1, width / (0.6 * widest));
    const mid = (lo + hi) / 2;
    const pts =
      section === "diamond"
        ? [
            // a ridge down the middle
            [lo, 0],
            [(lo + mid) / 2, halfThick * 0.62],
            [mid, halfThick],
            [(mid + hi) / 2, halfThick * 0.62],
            [hi, 0],
          ]
        : section === "single"
          ? [
              // a thick back on `lo`, flat as far as the bevel, then ground down to the edge on `hi`
              [lo, 0],
              [lo + 0.1 * width, halfThick],
              [lo + (blade.bevel ?? 0.6) * width, halfThick],
              [hi, 0],
            ]
          : [
              // "fuller": flat in the middle (the groove is only painted), an edge each side
              [lo, 0],
              [lo + 0.28 * width, halfThick],
              [hi - 0.28 * width, halfThick],
              [hi, 0],
            ];
    return { s: blade.x0 + along * bladeLength, pts };
  });

  // Build it, bending it by `curve`, and mark its triangles when the blade glows or stays bright.
  const beforeBlade = mesh.tris.length;
  mesh.plate(stations, zones.bladeA, zones.bladeB, {
    px: bladePx,
    s0: blade.x0,
    at: (s, across, height) => [s, across + curve(alongBlade(s)), height],
    ends: true,
  });
  if (blade.glow) for (const triangle of mesh.tris.slice(beforeBlade)) triangle.glow = true;
  if (blade.bright) for (const triangle of mesh.tris.slice(beforeBlade)) triangle.bright = true;

  // Paint its two faces. `side` is 1 for the face that looks to +z and -1 for the other: the light falls
  // from one side, so what is bright on one face is dark on the other.
  for (const [zone, side] of [
    [zones.bladeA, 1],
    [zones.bladeB, -1],
  ]) {
    canvas.zone(
      { x: zone.x, y: zone.yc - 58, w: Math.ceil(bladeLength * bladePx), h: 116 },
      (u, v) => {
        // where this pixel is on the blade: x along the sword, `across` the blade, `rel` 0..1 edge to edge
        const x = blade.x0 + u / bladePx;
        const along = alongBlade(x);
        const [lo, hi] = edgesAt(along);
        const across = clamp((58 - v) / bladePx, lo, hi);
        const rel = (across - lo) / (hi - lo);
        const faceSeed = seed + (side > 0 ? 13 : 37);

        // the painted volume, by the blade's section
        let light = 1;
        if (section === "diamond")
          // one slope lit, the other in shade, and a bright line on the ridge
          light =
            1 +
            0.13 * side * Math.sign(rel - 0.5) * step(0.02, 0.1, Math.abs(rel - 0.5)) +
            0.16 * bell(rel - 0.5, 0.035);
        else if (section === "single") {
          // the flat darker, the bevel brighter, a bright line where they meet and a dark back
          const bevel = blade.bevel ?? 0.6;
          light =
            (rel < bevel ? 0.93 + 0.04 * side : 1.12) +
            0.2 * bell(rel - bevel, 0.02) -
            0.25 * bell(rel, 0.06);
        } else {
          // the groove narrows to nothing where it ends
          const grooveEnd = blade.fullerTo ?? 0.65;
          const grooveHalf = 0.2 * step(grooveEnd, grooveEnd - 0.14, along) * step(0.01, 0.05, along);
          const grooveLo = 0.5 - grooveHalf;
          const grooveHi = 0.5 + grooveHalf;
          const inGroove = grooveHalf > 0.01 && rel > grooveLo && rel < grooveHi;
          const acrossGroove = (rel - grooveLo) / (grooveHi - grooveLo || 1);
          // inside it, shaded from one wall to the other; outside, the two flats; a bright line on each lip
          light = inGroove
            ? 0.8 + 0.34 * (side > 0 ? acrossGroove : 1 - acrossGroove)
            : 1.03 + 0.06 * side * Math.sign(rel - 0.5);
          if (grooveHalf > 0.01)
            light += 0.14 * bell(rel - grooveLo, 0.02) + 0.14 * bell(rel - grooveHi, 0.02);
        }
        light -= 0.1 * step(0.9, 0, x - blade.x0); // in the shadow of the guard

        // the colour: the caller's paint or steel, then the tint
        const point = { x, t: across, k: along, rel, light, side, seed: faceSeed, lo, hi };
        let colour = blade.paint
          ? blade.paint(point)
          : times(
              steel(x * 0.9, across * 1.2, light, faceSeed, blade.rust ?? -0.38),
              1 + 0.06 * (fbm(x * 2.4, across * 0.6, faceSeed + 50, 2) - 0.5),
            );
        const tint = typeof blade.tint === "function" ? blade.tint(point) : blade.tint;
        if (tint) colour = [colour[0] * tint[0], colour[1] * tint[1], colour[2] * tint[2]];
        if (blade.raw) return colour;

        // the edges, ground bright, with a thin dark line where the grinding stops
        const toEdge = Math.min(hi - across, twoEdged ? across - lo : Infinity);
        const edgeWidth = Math.min(0.2, (hi - lo) * 0.16);
        colour = mix(colour, times(colour, 1.38), step(edgeWidth, edgeWidth * 0.4, toEdge) * 0.8);
        return times(colour, 1 - 0.25 * bell(toEdge - edgeWidth * 1.05, edgeWidth * 0.15));
      },
      0,
    );
  }

  // ── its flames: a skin just over the blade, wider than it and longer, drawn 512 pixels lower ──
  if (flamed) {
    const flameOut = blade.flameOut ?? 0.8; // how far past each edge
    const flameOn = blade.flameOn ?? 0.12; // how far past the tip, as a share of the blade's length
    const lift = 0.04; // how far the skin stands off the steel
    const flameStationCount = blade.flameStations ?? 28;
    // pixels a unit, so that the longer and wider skin fits the same strip
    const flamePx = Math.min(bladePx, 832 / (bladeLength * (1 + flameOn)), 56 / (reach + flameOut));

    // The skin's stations: the blade's outline pushed out, closing to nothing beyond the tip.
    const skin = Array.from({ length: flameStationCount + 1 }, (_, i) => {
      const along = ((1 + flameOn) * i) / flameStationCount;
      const [lo, hi] = edgesAt(Math.min(1, along));
      const past = clamp((along - 1) / flameOn, 0, 1);
      const overhang = flameOut * (1 - past);
      const halfThick = (blade.thick ?? 0.24) * (1 - past) + lift;
      const mid = (lo + hi) / 2;
      return {
        s: blade.x0 + along * bladeLength,
        pts: [
          [lo - overhang, 0],
          [lo - 0.04, halfThick],
          [mid, halfThick],
          [hi + 0.04, halfThick],
          [hi + overhang, 0],
        ],
      };
    });
    const beforeFlames = mesh.tris.length;
    const flameZoneA = { x: zones.bladeA.x, yc: zones.bladeA.yc + 512 };
    const flameZoneB = { x: zones.bladeB.x, yc: zones.bladeB.yc + 512 };
    mesh.plate(skin, flameZoneA, flameZoneB, {
      px: flamePx,
      s0: blade.x0,
      at: (s, across, height) => [s, across + curve(alongBlade(s)), height],
    });
    // and the same again across the blade, so that it is fire from its edge too (a knife is held edge-on
    // to the eye)
    const flameCross = blade.flameCross ?? 0.7;
    if (flameCross)
      mesh.plate(
        skin.map((station) => ({
          s: station.s,
          pts: station.pts.map(([across, height]) => [across, height ? lift : 0]),
        })),
        flameZoneA,
        flameZoneB,
        {
          px: flamePx,
          s0: blade.x0,
          at: (s, across, height) => [s, curve(alongBlade(s)) + height, across * flameCross],
        },
      );
    // glow: drawn additively; flow: its texture moves; loose: not part of the outline the piece is laid by
    for (const triangle of mesh.tris.slice(beforeFlames))
      triangle.glow = triangle.flow = triangle.loose = true;

    // Paint the fire: all of it is the caller's `flames`, told where each pixel is about the blade.
    for (const [zone, side] of [
      [flameZoneA, 1],
      [flameZoneB, -1],
    ])
      canvas.zone(
        { x: zone.x, y: zone.yc - 60, w: Math.ceil(bladeLength * (1 + flameOn) * flamePx), h: 120 },
        (u, v) => {
          const x = blade.x0 + u / flamePx;
          const along = (x - blade.x0) / bladeLength;
          const [lo, hi] = edgesAt(clamp(along, 0, 1));
          return blade.flames({
            x,
            t: (60 - v) / flamePx,
            k: along,
            lo,
            hi,
            mid: (lo + hi) / 2,
            out: flameOut,
            past: clamp((along - 1) / flameOn, 0, 1),
            side,
            seed: seed + (side > 0 ? 113 : 137),
          });
        },
        0,
      );
  }

  // ── the guard ──
  const guard = spec.guard;
  if (guard?.disc) {
    // A round guard: a thin disc turned about the sword's axis, its two flat faces painted apart.
    const metal = metalOf(guard.metal ?? "black");
    const thick = guard.thick ?? 0.24;
    mesh.lathe(
      [
        [guard.x - thick / 2, guard.disc * 0.94],
        [guard.x, guard.disc],
        [guard.x + thick / 2, guard.disc * 0.94],
      ],
      zones.discRim,
      { sides: 12, flatten: guard.flatten ?? 1, px: 60, caps: [zones.discA, zones.discB] },
    );
    // each face: a rim, a ring of cut-outs and the seat of the blade
    for (const zone of [zones.discA, zones.discB])
      canvas.zone(zone, (u, v) => {
        // from the middle of the face: -1..1 each way, the distance (1 on the rim) and the angle
        const dx = (u - 22) / 22;
        const dy = (v - 22) / 22;
        const fromCentre = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const hole = bell(fromCentre - 0.62, 0.1) * step(0.5, 0.8, Math.cos(angle * 4));
        return times(
          metal(
            dx * 2,
            dy * 2,
            1.05 - 0.2 * fromCentre + 0.3 * bell(fromCentre - 0.92, 0.06) - 0.3 * bell(fromCentre - 0.3, 0.1),
            seed + 81,
          ),
          1 - 0.8 * hole,
        );
      });
    canvas.zone(zones.discRim, (u, v) =>
      metal(u / 10, v / 10, cylinderLight(v / zones.discRim.h, 0.5), seed + 83),
    );
  } else if (guard) {
    // A bar across the sword: a plate that runs along y, each section giving its half length (along the
    // sword) and its half thickness there.
    const metal = metalOf(guard.metal);
    const guardZones = zones.guard;
    const firstY = guard.sections[0][0];
    const spanY = guard.sections.at(-1)[0] - firstY;
    const longest = Math.max(...guard.sections.map((row) => row[1]));
    // pixels a unit: as fine as the strip allows, whichever way the guard is biggest
    const guardPx = Math.min(guardZones.fine, guardZones.wide / spanY, (guardZones.up - 1) / longest);
    const sweep = guard.sweep ?? (() => 0);
    mesh.plate(
      guard.sections.map(([y, halfLength, halfThick]) => ({
        s: y,
        pts: [
          [-halfLength, 0],
          [-halfLength * 0.5, halfThick],
          [halfLength * 0.5, halfThick],
          [halfLength, 0],
        ],
      })),
      guardZones.A,
      guardZones.B,
      { px: guardPx, s0: firstY, at: (s, across, height) => [guard.x + across + sweep(s), s, height], ends: true },
    );
    for (const [zone, side] of [
      [guardZones.A, 1],
      [guardZones.B, -1],
    ]) {
      canvas.zone(
        { x: zone.x, y: zone.yc - guardZones.up, w: Math.ceil(spanY * guardPx), h: 2 * guardZones.up },
        (u, v) => {
          // y: along the guard; `across`: along the sword, from the guard's middle
          const y = firstY + u / guardPx;
          const across = (guardZones.up - v) / guardPx;
          const faceSeed = seed + (side > 0 ? 81 : 87);
          // lit from one side, brighter in the middle, with a dark line each side of where the blade sits
          const light =
            1.0 +
            (0.2 * side * across) / longest +
            0.12 * bell(y, spanY * 0.17) -
            0.3 * bell(Math.abs(y) - 0.6, 0.08);
          let colour = guard.paint
            ? guard.paint({ y, t: across, light, side, seed: faceSeed, metal })
            : metal(y * 1.1, across * 1.1, light, faceSeed);
          if (guard.gem) {
            // a six-sided stone set in the middle: `fromGem` is 1 on its outline
            const fromGem = Math.max(Math.abs(across), Math.abs(across) * 0.5 + Math.abs(y) * 0.866) / 0.46;
            if (fromGem < 1)
              colour = times(
                mix(times(guard.gem, 0.45), guard.gem, 0.5 + (0.5 * side * (across - y)) / 0.6),
                1 + 0.9 * bell(Math.hypot(y + 0.14, across - 0.16), 0.1),
              );
            else colour = times(colour, 1 - 0.7 * bell(fromGem - 1.08, 0.1)); // its setting, dark
          }
          return colour;
        },
        0,
      );
    }
  }

  // ── the grip, the pommel and the collar ──
  /**
   * A part turned about the sword's axis (if it was asked for), built and painted in `zone`.
   * `paint(x, around, run)`: x along its skin from where it starts, `around` it 0..1, `run` its whole length.
   * `cap`: a zone for the flat end it starts with (the pommel's butt).
   */
  const lathed = (part, zone, cap, paint) => {
    if (!part) return;
    // the length of its skin, which is what the texture is stretched along
    let run = 0;
    part.profile.forEach(([x, radius], i) => {
      if (i) run += Math.hypot(x - part.profile[i - 1][0], radius - part.profile[i - 1][1]);
    });
    const pixelsPerUnit = Math.min(30, (zone.w - 2) / run);
    mesh.lathe(part.profile, zone, {
      sides: part.sides ?? 8,
      flatten: part.flatten ?? 1,
      px: pixelsPerUnit,
      // both ends closed: an end that goes into the guard or the pommel is hidden there only while the part
      // is thinner than what it goes into, and is a hole where it is not
      caps: [cap ?? true, true],
      twist: part.sides === 4 ? Math.PI / 4 : 0, // a square part stands on a face, not on an edge
    });
    canvas.zone(zone, (u, v) => paint(u / pixelsPerUnit, v / zone.h, run));
  };

  const grip = spec.grip;
  lathed(grip, zones.grip, null, (x, around, run) => {
    // round, and darker at both ends, where the guard and the pommel shade it
    const light = cylinderLight(around) * (1 - 0.4 * bell(x, 0.15) - 0.4 * bell(x - run, 0.15));
    if (grip.paint) return grip.paint({ x, q: around, light, run, seed });
    if (grip.wrap === "cord") {
      // flat braid crossed over ray skin, which shows in small diamonds
      const strandA = fract(x * 1.5 + around * 2);
      const strandB = fract(x * 1.5 - around * 2);
      const fromGap = Math.abs(strandA - 0.5) + Math.abs(strandB - 0.5);
      if (fromGap < 0.2)
        return times(
          mix([0.4, 0.38, 0.3], [0.58, 0.56, 0.46], noise(x * 30, around * 60, seed + 55)),
          light * (0.7 + 1.2 * fromGap),
        );
      // the braid: whichever strand lies on top here, with a sheen across it
      const over = strandA < 0.5 ? strandA : strandB;
      const sheen = 0.65 + 0.75 * Math.sin(Math.PI * fract(over * 2)) ** 2;
      return times(
        grip.colour ?? [0.06, 0.06, 0.08],
        light * sheen * (0.85 + 0.3 * noise(x * 40, around * 80, seed + 57)),
      );
    }
    if (grip.wrap === "ivory") return carved(x, around, light * 1.15, seed + 61);
    if (grip.wrap === "lattice") {
      // leather under black straps crossed over it
      const strapA = Math.abs(fract(x * 0.55 + around) - 0.5);
      const strapB = Math.abs(fract(x * 0.55 - around) - 0.5);
      const strap = Math.min(strapA, strapB);
      // what the leather is mottled towards: a red unless told, or its own colour made brighter
      const leather = grip.colour ?? LATTICE_LEATHER;
      const mottle = grip.mottle === "own" ? times(leather, 1.4) : (grip.mottle ?? LATTICE_MOTTLE);
      const under = times(
        mix(leather, mottle, fbm(x * 2, around * 6, seed + 51, 3)),
        light * 1.2 * (1 - 0.5 * bell(strap - 0.13, 0.03)),
      );
      return strap < 0.1 ? times([0.07, 0.06, 0.06], light * (0.8 + 1.2 * (1 - strap / 0.1) ** 0.5)) : under;
    }
    if (grip.wrap === "ribbed") {
      // cloth bound down by dark rings, one every 1.05 units
      const inRepeat = fract(x / 1.05);
      const ring = inRepeat < 0.24;
      return ring
        ? times([0.07, 0.07, 0.06], light * (0.8 + 0.8 * Math.sin((Math.PI * inRepeat) / 0.24)))
        : times(
            mix(
              grip.colour ?? [0.3, 0.31, 0.18],
              times(grip.colour ?? [0.3, 0.31, 0.18], 1.45),
              fbm(x * 3, around * 8, seed + 53, 3),
            ),
            light * 1.15 * (0.78 + 0.3 * Math.sin((Math.PI * (inRepeat - 0.24)) / 0.76)),
          );
    }
    // "leather", and anything else
    return times(leatherWrap(x, around, seed + 51, grip.colour ?? [0.22, 0.12, 0.07]), light * 1.25);
  });

  // the pommel, and the flat end it closes with
  const pommel = spec.pommel;
  const pommelMetal = metalOf(pommel?.metal);
  lathed(pommel, zones.pommel, zones.butt, (x, around) =>
    pommelMetal(x * 3.3, around * 4, cylinderLight(around, 0.5), seed + 71),
  );
  if (pommel)
    canvas.zone(zones.butt, (u, v) => {
      const fromCentre = Math.hypot(u - 24, v - 24) / 24;
      return pommelMetal(u / 9, v / 9, 1.05 - 0.35 * fromCentre, seed + 73);
    });

  // the collar: brass unless told, brightest round its middle
  const collar = spec.collar;
  const collarMetal = metalOf(collar?.metal ?? "brass");
  lathed(collar, zones.collar, null, (x, around, run) =>
    collarMetal(
      x * 3,
      around * 4,
      cylinderLight(around, 0.5) * (1 + 0.25 * bell(x - run / 2, run / 5)),
      seed + 91,
    ),
  );

  // whatever the caller adds of its own. Its zone is in the band the tall texture adds: on the short one
  // it lies below the picture, and a part built there would wear whatever is 256 rows higher.
  if (spec.extra) {
    const beforeExtra = mesh.tris.length;
    spec.extra({ M: mesh, S: canvas, zone: zones.extra, seed });
    const belowPicture = (triangle) => triangle.some((corner) => corner.uv[1] > 1);
    if (!tall && mesh.tris.slice(beforeExtra).some(belowPicture))
      throw new Error(
        "swordkit: `extra` needs `tall: true`: the 1024x256 texture has no room for its parts (they were put below the picture)",
      );
  }
  return { tris: mesh.tris, image: canvas.image() };
}

/**
 * A straight blade's half width, for `blade.half`: `w0` at the guard, `w1` where the point starts (at
 * `from`, 0..1 along the blade), then closing to the tip. `power` below 1 rounds the point, above 1 hollows
 * it.
 */
export const taper =
  (w0, w1, from = 0.86, power = 0.8) =>
  (k) =>
    k < from ? w0 + ((w1 - w0) * k) / from : w1 * Math.max(0, 1 - (k - from) / (1 - from)) ** power;
