// What a player sees of the sky through a gap: rays from the eyes over the walked floor, and the thin openings they
// thread to reach the sky. Made after the owner's walk of a plaza (2026-11-10): from a gallery under its roof the sky
// box and a skybox mountain showed through a slit at the roof's edge, and no check had said so. The same walk, in the
// open, found slivers of sky at the top corners of arches standing against a rock wall, and a notch where a dome's
// base and the ring under it do not meet: so every eye asks, not only those under a roof, and the open sky is told
// from a gap by the solid round the ray. A window or an arch shows the sky too, and is told apart by its width: a
// gap is thinner than a player.
import { readBsp, CONTENTS } from "../../core/maps/bsp.mjs";
import { floorSpots } from "./pvs.mjs";
import { valueOf } from "../../core/maps/entities.mjs";
import { dot, sub, cross, unit } from "../../core/vec.mjs";

/** A standing player's eye over the floor, and over an info_player_* origin (the body's middle). */
const EYE = 64;
const SPAWN_EYE = 28;
/** How far a ray is followed (the engine's own range), and how far up a roof is looked for. */
const FAR = 8192;
const ROOF = 1024;
/** Rays from each eye: a slit 2 wide through a sheet 4 thick, seen from 12 units off, needs 1000 to be hit (the fixture); 2000 from the 257 eyes of a plaza take six seconds. */
const RAYS = 2000;
/** An opening narrower than this (units) is a gap: under a player's width (32), nothing is meant to show through it. */
const THIN = 24;
/** The cone round a ray (degrees): a ray is through an opening when two of the cone's rays opposite each other meet solid; the open sky, and a cornice's edge against it, have solid on one side at most. */
const CONE = 5;
/** Along a ray: the step of the search for the opening, the finer step round the narrowest place, and how far the opening's sides are looked for. */
const STEP = 8;
const FINE = 2;
const PROBE = 64;
/** Gaps within this of each other (units) are one. */
const NEAR = 64;
const DEGREES = Math.PI / 180;

const along = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
const place = (p) => p.map((v) => Math.round(v)).join(" ");

/** The first solid or sky the segment meets, walking a tree from `node` (a model's head node): `{ contents, at }`, or null for clear air. */
export function traceSolid(bsp, node, a, b) {
  if (node < 0) {
    const { contents } = bsp.leaves[-1 - node];
    return contents === CONTENTS.SOLID || contents === CONTENTS.SKY ? { contents, at: a } : null;
  }
  const { plane: index, children } = bsp.nodes[node];
  const plane = bsp.planes[index];
  const da = dot(plane.normal, a) - plane.dist;
  const db = dot(plane.normal, b) - plane.dist;
  if (da >= 0 && db >= 0) return traceSolid(bsp, children[0], a, b);
  if (da < 0 && db < 0) return traceSolid(bsp, children[1], a, b);
  const mid = along(a, sub(b, a), da / (da - db));
  const near = da >= 0 ? 0 : 1;
  return traceSolid(bsp, children[near], a, mid) ?? traceSolid(bsp, children[1 - near], mid, b);
}

/** `count` directions spread evenly over the upper half of the sky, none quite level. */
function hemisphere(count) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const z = (i + 0.5) / count;
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(i * golden), r * Math.sin(i * golden), z];
  });
}

/** Eight directions across a ray's, 45 degrees apart; the one at k + 4 is the opposite of the one at k. */
function across(d) {
  const e1 = unit(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const e2 = cross(d, e1);
  return Array.from({ length: 8 }, (_, k) => {
    const a = k * 45 * DEGREES;
    return [0, 1, 2].map((i) => e1[i] * Math.cos(a) + e2[i] * Math.sin(a));
  });
}

/**
 * Sky seen through a gap, in a compiled map (`bsp`: `readBsp`'s result or the bytes).
 *
 * The eyes: every `info_player_*` (28 over its origin) and the walked floor every `step` units (128) at a standing
 * player's eye (64), as `checkPvs` takes them; or `eyes`, a list of `[x, y, z]` eye points, instead. Every eye is
 * asked (`roof: "any"`); `roof: "under"` asks only the eyes under a roof (something solid, not sky, within 1024
 * straight up), as the check first did, which saves time and misses the slivers seen from the open. From each eye
 * `rays` (2000) rays go out evenly over the upper half of the sky. A ray that reaches a sky leaf went through an
 * opening, or through nothing: eight rays round it 5 degrees off tell which, and a ray is through an opening only
 * when two of them opposite each other meet solid (the open sky meets none; a cornice's edge against the sky meets
 * it on one side). The opening is near where those two met solid, and is measured across there (four lines 45
 * degrees apart, the room both ways along each up to 64, the second narrowest taken: a window's corner cuts one
 * short): under `thin` (24) units it is a gap, else a window, an arch or an open side, which is no fault. Gaps
 * within 64 units of each other are one. `ignore` (`[{ min, max }]` boxes) names places whose gaps are meant: a
 * dome's eye, a louvre. `reach`: what `reachOf` gave, when the caller has walked the map already.
 *
 * Returns `{ passed, said, warnings, facts, gaps, eyes }`: `gaps` is `[{ at, width, eye, yaw, pitch, rays, eyes }]`,
 * the narrowest place of each, `eyes` is `{ count, roofed, open }`. A warning for each gap says the eye, the way it
 * looked (yaw anticlockwise from +x, pitch up, as `map-view` takes them) and where the gap is.
 */
export function skyGaps(input, options = {}) {
  const { step = 128, rays = RAYS, roof = "any", thin = THIN, eyes: given, ignore = [] } = options;
  if (roof !== "any" && roof !== "under") throw new Error(`skyGaps: roof is "any" (every eye) or "under" (the eyes under a roof only), not ${roof}`);
  const bsp = Buffer.isBuffer(input) || input instanceof Uint8Array ? readBsp(input) : input;
  const facts = [];
  const notes = [];
  let eyes;
  if (given) eyes = given.map((eye) => [...eye]);
  else {
    const spawns = bsp.entities
      .filter((entity) => /^info_player_/.test(valueOf(entity, "classname") ?? ""))
      .map((entity) => (valueOf(entity, "origin") ?? "").split(/\s+/).map(Number))
      .filter((origin) => origin.length === 3 && origin.every(Number.isFinite))
      .map((origin) => along(origin, [0, 0, 1], SPAWN_EYE));
    const floor = floorSpots(bsp, { step, walk: true, eye: EYE, notes, reach: options.reach });
    eyes = [...spawns, ...floor.spots.map((spot) => spot.eye)];
    facts.push(`${eyes.length} eyes: ${spawns.length} at the spawns and ${floor.spots.length} over the ${floor.walked ? "walked" : "standable"} floor every ${step} units, at a standing player's eye`); // prettier-ignore
  }
  facts.push(...notes);
  const head = bsp.models[0].headNodes[0];
  const hit = (a, b) => traceSolid(bsp, head, a, b);
  /** Whether a point has a roof: something solid, not sky, within ROOF straight up. */
  const underRoof = (p) => hit(p, along(p, [0, 0, 1], ROOF))?.contents === CONTENTS.SOLID;
  /** The room from a point one way, up to `most`: a sky brush is the sky, not a wall. */
  const roomAlong = (p, d, most) => {
    const found = hit(p, along(p, d, most));
    return found?.contents === CONTENTS.SOLID ? Math.hypot(...sub(found.at, p)) : most;
  };
  /**
   * How wide the opening is at a point of the ray: the room both ways along each of four lines across the ray, and
   * the second narrowest of them. The narrowest can be a chord that cuts a window's corner (short both ways near a
   * corner); the next line is across the opening, within a half of its width.
   */
  const widthAt = (p, ways) => [0, 1, 2, 3].map((k) => roomAlong(p, ways[k], PROBE) + roomAlong(p, ways[k + 4], PROBE)).sort((a, b) => a - b)[1]; // prettier-ignore
  const directions = hemisphere(rays);
  const lean = Math.tan(CONE * DEGREES);
  const found = [];
  let roofed = 0;
  let toSky = 0;
  let wide = 0;
  for (const eye of eyes) {
    const covered = underRoof(eye);
    if (covered) roofed++;
    if (roof === "under" && !covered) continue;
    for (const d of directions) {
      const sky = hit(eye, along(eye, d, FAR));
      if (!sky || sky.contents !== CONTENTS.SKY) continue;
      toSky++;
      const ways = across(d);
      // the cone's rays by opposite pairs: where both of a pair met solid is where the opening is
      const sides = [];
      for (let k = 0; k < 4; k++) {
        const pair = [k, k + 4].map((j) => hit(eye, along(eye, unit(along(d, ways[j], lean)), FAR)));
        if (pair.every((found) => found?.contents === CONTENTS.SOLID)) sides.push(...pair.map((found) => Math.hypot(...sub(found.at, eye))));
      }
      if (!sides.length) {
        wide++;
        continue;
      }
      // the narrowest place from a step before each side to a probe's reach past it (a ray that leaves a slab's edge
      // below it enters the slit a little further on), each place measured once
      const length = Math.hypot(...sub(sky.at, eye));
      const places = new Set();
      for (const side of sides) for (let t = Math.max(FINE, side - STEP); t < Math.min(length, side + PROBE); t += FINE) places.add(Math.round(t / FINE) * FINE); // prettier-ignore
      let best = { t: 0, width: Infinity };
      for (const t of places) {
        const width = widthAt(along(eye, d, t), ways);
        if (width < best.width) best = { t, width };
      }
      if (best.width >= thin) {
        wide++;
        continue;
      }
      found.push({ at: along(eye, d, best.t), width: best.width, eye, d });
    }
  }
  const inside = (p, box) => [0, 1, 2].every((i) => p[i] >= box.min[i] && p[i] <= box.max[i]);
  const kept = found.filter((gap) => !ignore.some((box) => inside(gap.at, box)));
  const groups = [];
  for (const gap of kept) {
    const group = groups.find((g) => Math.hypot(...sub(g.at, gap.at)) <= NEAR);
    if (!group) groups.push({ ...gap, rays: 1, seen: new Set([gap.eye.join()]) });
    else {
      group.rays++;
      group.seen.add(gap.eye.join());
      if (gap.width < group.width) Object.assign(group, { at: gap.at, width: gap.width, eye: gap.eye, d: gap.d });
    }
  }
  const gaps = groups.map(({ at, width, eye, d, rays: count, seen }) => ({
    at, width: Math.round(width * 10) / 10, eye, rays: count, eyes: seen.size,
    yaw: Math.round((Math.atan2(d[1], d[0]) / DEGREES + 360) % 360),
    pitch: Math.round(Math.asin(d[2]) / DEGREES),
  })); // prettier-ignore
  const warnings = gaps.map(
    (gap) => `sky seen from ${place(gap.eye)} looking yaw ${gap.yaw} pitch ${gap.pitch}: a gap ${gap.width} units wide at ${place(gap.at)} (${gap.rays} rays from ${gap.eyes} eyes reach the sky through it); close it, or it is meant to be a window: ignore it`,
  );
  const open = eyes.length - roofed;
  facts.push(`${roofed} of ${eyes.length} eyes are under a roof (something solid within ${ROOF} straight up) and ${open} in the open${roof === "under" ? ", not asked" : ""}; ${rays} rays each over the upper half of the sky, ${toSky} of them reached the sky, ${wide} through nothing or an opening ${thin} units wide or more (the open sky, a window, an arch, an open side)`); // prettier-ignore
  if (found.length > kept.length) facts.push(`${found.length - kept.length} rays reached the sky through gaps inside the places ignored`);
  const narrowest = gaps.length ? Math.min(...gaps.map((gap) => gap.width)) : null;
  const asked = `${roofed} eyes under a roof, ${open} in the open${roof === "under" ? " not asked" : ""}`;
  const said = gaps.length
    ? `${gaps.length} gaps show the sky through an opening under ${thin} units wide, the narrowest ${narrowest} (${asked}); close them, or name the ones meant (windows) to ignore`
    : `no gap shows the sky (${asked}, ${rays} rays each)`;
  return { passed: !gaps.length, said, warnings, facts, gaps, eyes: { count: eyes.length, roofed, open } };
}
