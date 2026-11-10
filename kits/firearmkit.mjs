// firearmkit: a firearm made from a description: a receiver, a barrel, a grip, a trigger guard and trigger, a
// magazine, a stock, a forend (a shotgun's pump, a submachine gun's handguard) and sights, in one of a few
// finishes. Pistols, shotguns, submachine guns and rifles. Weapon makers built guns from boxes and cylinders by
// hand, and the judges docked them for a grip, a guard and a receiver that did not read as a gun's (2026-10-17):
// this is that shape, made as Valve made theirs.
//
//   import { firearm, FIREARM_PRESETS } from "../kits/firearmkit.mjs";
//   const piece = firearm({ seed, preset, finish, wear, receiver, frame, barrel, grip, guard, trigger,
//                           magazine, stock, forend, sights });   // -> { tris, image, parts }
//
// What comes back is a "piece": `tris` (the triangles), `image` (the texture, 1024x512) and `parts` (each part's
// name and its triangles). Hand it to swapMesh or buildMdl (src/index.mjs). There is nothing to run in this file itself.
//
// How it is made, as Half-Life's own guns are: most of a gun is flat on its sides, so each such part (the
// receiver, the frame, the grip, the stock, a straight or curved magazine, a handguard, the trigger, the
// sights) is its side's outline in x and z, given a width across y; its two sides wear ONE picture of that
// outline, mirrored (Valve's guns are painted from a side map the same way), and its rim a strip of its own.
// What is round (the barrel, a shotgun's magazine tube, its pump) is turned on a lathe. The trigger guard is a
// bar bent along a path. Edges, a port, serrations and checkering are painted, not built.
//
// The gun lies along +x, the muzzle at high x. The top of the grip's back edge is at the origin (x 0, z 0: where
// the web of the hand sits), the receiver over it, a stock behind it (low x). +z is up the gun as it is held
// upright; the width is along y. Sizes in the game's units, about an inch: build a gun at its real size.
//
//   preset:   "pistol" (a 9 mm handgun), "shotgun" (a pump shotgun), "smg" (a submachine gun), "rifle":
//             FIREARM_PRESETS, the description each starts from. Any part given is laid over the preset's
//             (field by field); a part given as `false` is left out.
//   length:   the whole gun's length in units: every part made in proportion until it is that long (a brief's
//             "about 10 long"); the preset's own real size unless told
//   finish:   the material of every part unless the part says: "blued", "parkerised", "polymer", "wood",
//             "steel", "gunmetal", "black", or a function (a, b, light, seed, edge) -> colour
//   wear:     0..1, how much bright metal shows on the edges (0.3)
//   receiver: { back (x of its rear), length, height, width, z (its bottom), top: "flat" | "round",
//               chamfer (the corners cut off its top, units), port: { at (x), length, height } | false (an
//               ejection port, painted on both sides), serrations: true (lines at its rear), material }
//   frame:    { back, length, height, width, material }: a part under the receiver (a pistol's frame and its
//             dust cover), from z 0 to its height; the receiver then stands on it
//   barrel:   { length (past the receiver's front), radius, z (its axis), inset (how far into the receiver it
//               starts), sides, shroud: { length, radius } | false, material }
//   grip:     { angle (degrees back from upright), length, depth (front to back at its top), width, x (its
//               top-back corner), checkering: true, material } | false (a long gun held by its stock's wrist)
//   guard:    { x (its back end: the grip's front unless told), length, depth, thick, width, material }
//   trigger:  { width, material } | false
//   magazine: { kind: "grip" (a base plate under the grip: a pistol's), "straight", "curved", "tube" (under
//               the barrel: a shotgun's), x, length, depth, width, angle (degrees it leans forward), curve
//               (how far a curved one bows forward, as a share of its length), radius, z (a tube's) } | false
//   stock:    { kind: "fixed" | "folding", length, drop (how far its top falls to the butt), butt (the butt's
//               height), wrist (how far the wrist hangs under the receiver), width, material } | false
//   forend:   { kind: "pump" (a sleeve round the tube or the barrel) | "slab" (a handguard), x, length,
//               radius (a pump's), z, height (a slab's, down from the barrel), width, ribs, material } | false
//   sights:   { front: { height } | false, rear: { height } | false }
//
// Words used below. A "zone" is a rectangle of the texture. A "slab" is a flat-sided part made from its side's
// outline. Colours are [r, g, b] from 0 to 1.
import { sheet, shape, allot, wood, iron, times, mix, bell, step, fbm, noise, cylinderLight, polyDist } from "../src/workshop.mjs";
import { METALS } from "./swordkit.mjs";

const WIDTH = 1024;
const HEIGHT = 512;
/** The fields of a part that are sizes: each over 0 where given. */
const SIZES = ["length", "height", "width", "depth", "radius", "thick", "butt"];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const radians = (degrees) => (degrees * Math.PI) / 180;

/** The finishes a part may be made of: (a, b) where on it in units, `light`, `seed`, `edge` 0..1 (1 on an edge). */
export const FINISHES = {
  ...Object.fromEntries(Object.entries(METALS).map(([name, metal]) => [name, (a, b, light, seed) => metal(a, b, light, seed)])),
  // blued steel: near black with a cold tint, a faint polish along the length
  blued: (a, b, light, seed) => {
    const v = (0.17 + 0.05 * (fbm(a * 0.8, b * 3, seed, 3) - 0.5) + 0.03 * (fbm(a * 8, b * 8, seed + 3, 2) - 0.5)) * light;
    return [v * 0.86, v * 0.92, v * 1.12];
  },
  // parkerised: a matte grey-green, finely mottled
  parkerised: (a, b, light, seed) => {
    const v = (0.24 + 0.06 * (fbm(a * 4, b * 4, seed, 3) - 0.5) + 0.05 * (noise(a * 30, b * 30, seed + 7) - 0.5)) * light;
    return [v * 0.97, v * 1.0, v * 0.92];
  },
  // polymer: dark and dull, a little grain
  polymer: (a, b, light, seed) => {
    const v = (0.13 + 0.025 * (fbm(a * 6, b * 6, seed, 2) - 0.5) + 0.02 * (noise(a * 40, b * 40, seed + 5) - 0.5)) * light;
    return [v, v, v * 1.02];
  },
  wood: (a, b, light, seed) => wood(a, b * 2.5, light * 1.1, seed),
};

/** The description each kind of gun starts from: real sizes, in inches. */
export const FIREARM_PRESETS = {
  // a 9 mm handgun of a polymer frame and a steel slide (Half-Life's is a Glock 17: 7.3 long, 5.4 high)
  pistol: {
    finish: "blued",
    receiver: { back: -0.8, length: 7.3, height: 1.05, width: 1.0, top: "flat", chamfer: 0.18, port: { at: 3.6, length: 1.25, height: 0.5 }, serrations: true },
    frame: { back: -0.5, length: 6.7, height: 0.5, width: 0.95, material: "polymer" },
    barrel: { length: 0.08, radius: 0.27, inset: 0.4, sides: 8, shroud: false },
    grip: { angle: 20, length: 3.55, depth: 1.3, width: 1.15, checkering: true, material: "polymer" },
    guard: { length: 2.0, depth: 1.05, thick: 0.17, width: 0.6, material: "polymer" },
    trigger: { width: 0.18 },
    magazine: { kind: "grip", width: 1.2 },
    stock: false,
    forend: false,
    sights: { front: { height: 0.2 }, rear: { height: 0.2 } },
  },
  // a pump shotgun: a long barrel over a magazine tube, a pump round the tube, a stock with a dropped butt
  shotgun: {
    finish: "blued",
    receiver: { back: -0.4, length: 8.6, height: 2.6, width: 1.35, top: "round", chamfer: 0.4, port: { at: 3.6, length: 2.6, height: 1.0 }, serrations: false },
    frame: false,
    barrel: { length: 19.5, radius: 0.42, inset: 0.6, sides: 8, shroud: false },
    grip: false,
    guard: { x: 1.2, length: 2.6, depth: 1.3, thick: 0.2, width: 0.55 },
    trigger: { width: 0.2 },
    magazine: { kind: "tube", length: 16.5, radius: 0.46 },
    stock: { kind: "fixed", length: 13.5, drop: 1.4, butt: 4.6, wrist: 1.2, width: 1.5, material: "wood" },
    forend: { kind: "pump", x: 12.5, length: 7.5, radius: 0.85, ribs: 9, material: "wood" },
    sights: { front: { height: 0.18 }, rear: false },
  },
  // a submachine gun (Half-Life's is an MP5): a long receiver, a short barrel, a handguard, a curved magazine
  // ahead of the guard, a pistol grip and a short fixed stock
  smg: {
    finish: "black",
    receiver: { back: -1.4, length: 12.6, height: 2.2, width: 1.25, top: "round", chamfer: 0.35, port: { at: 4.9, length: 1.8, height: 0.75 }, serrations: false },
    frame: false,
    barrel: { length: 2.4, radius: 0.36, inset: 0.4, sides: 8, shroud: { length: 0.9, radius: 0.48 } },
    grip: { angle: 16, length: 3.7, depth: 1.35, width: 1.2, checkering: true, material: "polymer" },
    guard: { length: 2.2, depth: 1.05, thick: 0.18, width: 0.55, material: "polymer" },
    trigger: { width: 0.18 },
    magazine: { kind: "curved", x: 4.4, length: 6.8, depth: 1.25, width: 0.9, angle: 6, curve: 0.12 },
    stock: { kind: "fixed", length: 8.6, drop: 0.4, butt: 2.7, wrist: -0.6, width: 1.2, material: "polymer" },
    forend: { kind: "slab", x: 8.2, length: 4.0, height: 1.9, width: 1.6, ribs: 5, material: "polymer" },
    sights: { front: { height: 0.55 }, rear: { height: 0.5 } },
  },
  // a rifle: a long barrel and handguard, a straight magazine, a pistol grip and a full stock
  rifle: {
    finish: "parkerised",
    receiver: { back: -1.6, length: 10.5, height: 2.4, width: 1.25, top: "flat", chamfer: 0.3, port: { at: 4.5, length: 2.2, height: 0.7 }, serrations: false },
    frame: false,
    barrel: { length: 12, radius: 0.36, inset: 0.4, sides: 8, shroud: { length: 1.6, radius: 0.5 } },
    grip: { angle: 18, length: 3.8, depth: 1.35, width: 1.2, checkering: true, material: "polymer" },
    guard: { length: 2.3, depth: 1.05, thick: 0.18, width: 0.55 },
    trigger: { width: 0.18 },
    magazine: { kind: "curved", x: 4.6, length: 6.5, depth: 1.5, width: 0.9, angle: 4, curve: 0.08 },
    stock: { kind: "fixed", length: 11, drop: 0.6, butt: 4.2, wrist: 0.4, width: 1.4, material: "polymer" },
    forend: { kind: "slab", x: 8.6, length: 9, height: 1.6, width: 1.7, ribs: 8, material: "polymer" },
    sights: { front: { height: 0.9 }, rear: { height: 0.6 } },
  },
};

/** A part of the description laid over the preset's: `false` leaves it out, an object is merged field by field. */
const partOf = (preset, given, name) => {
  if (given?.[name] === false) return false;
  if (given?.[name] === undefined) return preset[name] ?? false;
  return { ...(preset[name] || {}), ...given[name] };
};

/** Twice the signed area of a polygon [[x, z], ...]: over 0 when it runs anticlockwise. */
const areaOf = (poly) => poly.reduce((sum, [x, z], i) => {
  const [nx, nz] = poly[(i + 1) % poly.length];
  return sum + x * nz - nx * z;
}, 0);

/** Two edges of an outline that cross, as their numbers, or null: an outline that crosses itself has faces turned both ways. */
function crossingOf(poly) {
  const side = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const n = poly.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return [i, j];
    }
  return null;
}

/** A polygon cut into triangles by clipping its ears, concave or not: [[i, j, k], ...] (it runs anticlockwise). */
function earsOf(poly) {
  const left = poly.map((_, i) => i);
  const out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const insideTri = (p, a, b, c) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
  let guard = 0;
  while (left.length > 3 && guard++ < 1000) {
    let cut = false;
    for (let k = 0; k < left.length; k++) {
      const [i, j, l] = [left[(k + left.length - 1) % left.length], left[k], left[(k + 1) % left.length]];
      if (cross(poly[i], poly[j], poly[l]) <= 1e-9) continue;
      if (left.some((m) => m !== i && m !== j && m !== l && insideTri(poly[m], poly[i], poly[j], poly[l]))) continue;
      out.push([i, j, l]);
      left.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (left.length === 3) out.push([...left]);
  return out;
}

/** What a description may say: anything else is refused, never passed over (a maker's `size` was, 2026-10-17). */
const OPTIONS = ["seed", "preset", "finish", "wear", "length", "receiver", "frame", "barrel", "grip", "guard", "trigger", "magazine", "stock", "forend", "sights"];

export function firearm(spec = {}) {
  for (const key of Object.keys(spec))
    if (!OPTIONS.includes(key)) throw new Error(`firearm: no option "${key}": a description says ${OPTIONS.join(", ")}${key === "size" ? " (the whole gun's length is `length`)" : ""}`);
  if (spec.length !== undefined && !(typeof spec.length === "number" && spec.length > 0))
    throw new Error(`firearm: length: the whole gun's length in units, a number over 0, not ${JSON.stringify(spec.length)}`);
  const preset = FIREARM_PRESETS[spec.preset ?? "pistol"];
  if (!preset) throw new Error(`firearm: no preset "${spec.preset}": ${Object.keys(FIREARM_PRESETS).join(", ")}`);
  const seed = spec.seed ?? 1;
  const wear = spec.wear ?? 0.3;
  const finish = spec.finish ?? preset.finish;
  const finishOf = (name) => {
    const chosen = name ?? finish;
    if (typeof chosen === "function") return chosen;
    if (!FINISHES[chosen]) throw new Error(`firearm: no finish "${chosen}": ${Object.keys(FINISHES).join(", ")}`);
    return FINISHES[chosen];
  };
  const P = Object.fromEntries(["receiver", "frame", "barrel", "grip", "guard", "trigger", "magazine", "stock", "forend", "sights"].map((name) => [name, partOf(preset, spec, name)]));
  if (!P.receiver) throw new Error("firearm: a receiver is needed: it is what every other part is placed by");
  // a size under 0 turns an outline inside out, or folds it across itself: refused in words, by name
  for (const [name, part] of Object.entries(P))
    for (const key of SIZES)
      if (part && part[key] !== undefined && !(typeof part[key] === "number" && part[key] > 0))
        throw new Error(`firearm: ${name}.${key}: a size, a number over 0 (in units), not ${JSON.stringify(part[key])}`);

  // ── where each part is: outlines in x and z, lathes and bars, before any is built ──
  const slabs = [];
  const lathes = [];
  const bars = [];
  const frame = P.frame;
  const frameTop = frame ? frame.height : 0;
  const R = P.receiver;
  const rx0 = R.back;
  const rx1 = R.back + R.length;
  const rz0 = R.z ?? frameTop;
  const rz1 = rz0 + R.height;
  const c = Math.min(R.chamfer ?? 0.2, R.height / 2);
  const top =
    R.top === "round"
      ? [[rx1, rz1 - c], [rx1 - c * 0.3, rz1 - c * 0.3], [rx1 - c, rz1], [rx0 + c, rz1], [rx0 + c * 0.3, rz1 - c * 0.3], [rx0, rz1 - c]]
      : [[rx1, rz1 - c], [rx1 - c, rz1], [rx0 + c * 0.6, rz1], [rx0, rz1 - c * 0.6]];
  slabs.push({ name: "receiver", poly: [[rx0, rz0], [rx1, rz0], ...top], width: R.width, material: R.material, port: R.port, serrations: R.serrations });
  if (frame) {
    const fx0 = frame.back ?? rx0 + 0.3;
    const fx1 = fx0 + (frame.length ?? R.length - 0.6);
    slabs.push({ name: "frame", poly: [[fx0, -0.05], [fx1, -0.05], [fx1, frameTop + 0.05], [fx0, frameTop + 0.05]], width: frame.width ?? R.width * 0.95, material: frame.material });
  }
  const bottom = 0; // the line the grip, the guard and the magazine hang from: the frame's bottom, or the receiver's

  // the barrel, from inside the receiver's front out past it
  const B = P.barrel;
  const barrelZ = B ? (B.z ?? rz0 + R.height * (frame ? 0.55 : 0.68)) : 0;
  const muzzle = B ? rx1 + B.length : rx1;
  if (B) {
    lathes.push({ name: "barrel", x0: rx1 - (B.inset ?? 0.4), x1: muzzle, z: barrelZ, radius: B.radius, sides: B.sides ?? 8, material: B.material, bore: true });
    if (B.shroud) lathes.push({ name: "shroud", x0: muzzle - B.shroud.length, x1: muzzle + 0.02, z: barrelZ, radius: B.shroud.radius, sides: B.sides ?? 8, material: B.material, bore: true, ribs: 3 });
  }

  // the grip: its top on the bottom line, leaning back by its angle, a little bulge for the fingers in front
  const G = P.grip;
  let gripFront = rx0 + 1.0;
  let gripBottom = null;
  if (G) {
    const gx = G.x ?? 0;
    const lean = Math.tan(radians(G.angle ?? 18)) * G.length;
    const d = G.depth;
    gripFront = gx + d;
    gripBottom = [[gx - lean - 0.05, bottom - G.length], [gx + d - lean * 1.02, bottom - G.length]];
    slabs.push({
      name: "grip",
      poly: [
        [gx - 0.25, bottom + 0.12],
        [gx + d, bottom + 0.12],
        [gx + d - lean * 0.35 + 0.1, bottom - G.length * 0.35],
        [gx + d - lean * 0.7 + 0.04, bottom - G.length * 0.7],
        gripBottom[1],
        gripBottom[0],
        [gx - lean * 0.5 - 0.12, bottom - G.length * 0.5],
      ],
      width: G.width,
      material: G.material,
      checkering: G.checkering !== false,
    });
  }

  // the trigger guard: from the grip's front (or, with no grip, from the receiver) down, forward and up again
  const T = P.guard;
  let guardBox = null;
  if (T) {
    const gx = T.x ?? gripFront;
    const gl = T.length;
    const gd = T.depth;
    const path = G
      ? [[gx - 0.1, bottom - gd * 0.72], [gx + gl * 0.25, bottom - gd], [gx + gl * 0.8, bottom - gd * 0.97], [gx + gl, bottom - gd * 0.55], [gx + gl * 1.02, bottom + 0.08]]
      : [[gx, bottom + 0.08], [gx - 0.05, bottom - gd * 0.6], [gx + gl * 0.25, bottom - gd], [gx + gl * 0.8, bottom - gd * 0.97], [gx + gl, bottom - gd * 0.55], [gx + gl * 1.02, bottom + 0.08]];
    bars.push({ name: "guard", path, thick: T.thick ?? 0.18, width: T.width ?? 0.55, material: T.material });
    guardBox = { x0: gx, x1: gx + gl, depth: gd };
  }
  if (P.trigger && guardBox) {
    const tx = guardBox.x0 + (guardBox.x1 - guardBox.x0) * 0.32;
    const td = guardBox.depth * 0.68;
    slabs.push({ name: "trigger", poly: [[tx - 0.05, bottom + 0.05], [tx + 0.24, bottom + 0.05], [tx + 0.2, bottom - td * 0.45], [tx + 0.08, bottom - td], [tx - 0.04, bottom - td * 0.92], [tx + 0.06, bottom - td * 0.45]], width: P.trigger.width ?? 0.18, material: P.trigger.material ?? "steel" });
  }

  // the magazine
  const M = P.magazine;
  if (M && M.kind === "grip" && gripBottom) {
    const [[bx0, bz], [bx1]] = gripBottom;
    slabs.push({ name: "magazine", poly: [[bx0 - 0.08, bz + 0.12], [bx1 + 0.06, bz + 0.12], [bx1 + 0.08, bz - 0.24], [bx0 - 0.1, bz - 0.24]], width: M.width ?? G.width * 1.04, material: M.material });
  } else if (M && (M.kind === "straight" || M.kind === "curved")) {
    const mx = M.x ?? gripFront + (T ? T.length : 1) + 0.6;
    const lean = Math.tan(radians(M.angle ?? 0));
    const bow = M.kind === "curved" ? (M.curve ?? 0.12) * M.length : 0;
    const stations = 6;
    const centre = (t) => [mx + M.length * lean * t + bow * t * t, bottom + 0.3 - M.length * t];
    const normal = (t) => {
      const [ax, az] = centre(Math.max(0, t - 0.01));
      const [bx, bz] = centre(Math.min(1, t + 0.01));
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [-(bz - az) / len, (bx - ax) / len];
    };
    const front = [];
    const back = [];
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const [cx, cz] = centre(t);
      const [nx, nz] = normal(t);
      // the side towards +x is the front: the normal of a line running down points that way when negated
      front.push([cx - (nx * M.depth) / 2, cz - (nz * M.depth) / 2]);
      back.push([cx + (nx * M.depth) / 2, cz + (nz * M.depth) / 2]);
    }
    slabs.push({ name: "magazine", poly: [...front, ...back.reverse()], width: M.width ?? 0.9, material: M.material, ribs: true });
  } else if (M && M.kind === "tube") {
    const z = M.z ?? barrelZ - (B?.radius ?? 0.4) - (M.radius ?? 0.45) - 0.05;
    lathes.push({ name: "magazine", x0: rx1 - 0.6, x1: rx1 + (M.length ?? 15), z, radius: M.radius ?? 0.45, sides: 8, material: M.material, cap: true });
  }

  // the forend: a pump round the tube (or the barrel), or a handguard under the barrel
  const F = P.forend;
  if (F && F.kind === "pump") {
    const tube = lathes.find((l) => l.name === "magazine");
    const z = F.z ?? (tube ? tube.z : barrelZ);
    lathes.push({ name: "forend", x0: F.x, x1: F.x + F.length, z, radius: F.radius ?? 0.8, sides: 8, material: F.material, ribs: F.ribs ?? 8, cap: true, flatten: 1.15 });
  } else if (F && F.kind === "slab") {
    const x0 = F.x ?? rx1 - 4;
    const x1 = x0 + F.length;
    const zt = barrelZ + (B?.radius ?? 0.4) + 0.25;
    const zb = zt - (F.height ?? 1.8);
    slabs.push({ name: "forend", poly: [[x0, zb + 0.3], [x0 + 0.4, zb], [x1 - 0.5, zb], [x1, zb + 0.4], [x1, zt - 0.15], [x1 - 0.15, zt], [x0, zt]], width: F.width ?? R.width * 1.3, material: F.material, ribs: F.ribs ?? 0, ribsAlong: true });
  }

  // the stock: from the receiver's rear back to its butt, its top falling by `drop`, its wrist under the receiver
  const S = P.stock;
  if (S && S.kind === "fixed") {
    const zt = rz1 - 0.1;
    const butt = rx0 - S.length;
    const wristZ = bottom - (S.wrist ?? 1);
    slabs.push({
      name: "stock",
      // closed at the receiver from its wrist up: a wrist set over the receiver's bottom (a submachine gun's
      // stock, its underside rising to it) crossed the outline when it was closed at the receiver's bottom
      poly: [[rx0 + 0.3, zt], [butt + 0.4, zt - S.drop], [butt, zt - S.drop - 0.3], [butt, zt - S.drop - S.butt], [butt + S.length * 0.4, wristZ - 0.2], [rx0 - S.length * 0.12, wristZ], [rx0 + 0.3, Math.min(wristZ + 0.4, zt - 0.3)]],
      width: S.width ?? R.width,
      material: S.material,
      butt: butt,
    });
  } else if (S && S.kind === "folding") {
    const butt = rx0 - S.length;
    const zt = rz1 - 0.3;
    bars.push({ name: "stock", path: [[rx0 + 0.2, zt], [butt, zt - S.drop], [butt, zt - S.drop - S.butt], [rx0 + 0.2, rz0 + 0.3]], thick: 0.2, width: S.width ?? 1.2, material: S.material ?? "black", closed: false });
  }

  // the sights: a post at the front, two ears at the rear either side of the line of sight
  const D = P.sights;
  if (D?.front) {
    const onBarrel = B && B.length > 2;
    const fx = onBarrel ? muzzle - 0.7 : rx1 - 0.5;
    const fz = onBarrel ? barrelZ + B.radius * 0.8 : rz1 - 0.05;
    slabs.push({ name: "front sight", poly: [[fx - 0.2, fz], [fx + 0.2, fz], [fx + 0.12, fz + D.front.height], [fx - 0.08, fz + D.front.height]], width: 0.14, material: "black" });
  }
  if (D?.rear) {
    const sx = rx0 + 0.7;
    for (const y of [-0.17, 0.17])
      slabs.push({ name: "rear sight", poly: [[sx - 0.25, rz1 - 0.05], [sx + 0.2, rz1 - 0.05], [sx + 0.12, rz1 + D.rear.height], [sx - 0.18, rz1 + D.rear.height]], width: 0.12, y, material: "black" });
  }

  // ── the picture shared out: one zone a slab's side (both sides wear it), one its rim, one each lathe and bar ──
  for (const slab of slabs) {
    const crossing = crossingOf(slab.poly);
    if (crossing) throw new Error(`firearm: the ${slab.name}'s outline crosses itself (its edges ${crossing.join(" and ")}): its sizes do not go together`);
    if (areaOf(slab.poly) < 0) slab.poly.reverse();
    const xs = slab.poly.map((p) => p[0]);
    const zs = slab.poly.map((p) => p[1]);
    slab.box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    slab.perimeter = slab.poly.reduce((sum, p, i) => sum + Math.hypot(...[0, 1].map((k) => slab.poly[(i + 1) % slab.poly.length][k] - p[k])), 0);
  }
  for (const bar of bars) bar.length = bar.path.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - bar.path[i - 1][0], p[1] - bar.path[i - 1][1]) : 0), 0);
  const asks = {};
  // the sides of a slab are what a player looks at: weighed up against the rims and the undersides
  slabs.forEach((slab, i) => {
    asks[`s${i}`] = [slab.box.x1 - slab.box.x0, slab.box.z1 - slab.box.z0, 1.4];
    asks[`r${i}`] = [slab.perimeter, slab.width, 0.6];
  });
  lathes.forEach((lathe, i) => {
    asks[`l${i}`] = [lathe.x1 - lathe.x0, 2 * Math.PI * lathe.radius];
    if (lathe.bore || lathe.cap) asks[`c${i}`] = [2 * lathe.radius, 2 * lathe.radius];
  });
  bars.forEach((bar, i) => {
    asks[`b${i}`] = [bar.length, 2 * (bar.width + bar.thick) * 2];
  });
  const zones = allot(WIDTH, HEIGHT, asks, { gap: 4 });
  const px = zones.px;
  const canvas = sheet(WIDTH, HEIGHT, [0.08, 0.08, 0.09]);
  const mesh = shape(WIDTH, HEIGHT);
  const parts = [];
  const counted = (name, build) => {
    const before = mesh.tris.length;
    build();
    const entry = parts.find((p) => p.name === name);
    if (entry) entry.triangles += mesh.tris.length - before;
    else parts.push({ name, triangles: mesh.tris.length - before });
  };
  /** Bright metal where an edge is worn, on what is metal: `edge` 0..1. */
  const worn = (colour, edge, material) => (material === "wood" || material === "polymer" ? times(colour, 1 + 0.25 * edge) : mix(colour, [0.52, 0.53, 0.55], clamp(edge * wear * 1.6, 0, 0.7)));

  // ── the slabs ──
  slabs.forEach((slab, i) => {
    const side = zones[`s${i}`];
    const rim = zones[`r${i}`];
    const { poly, box } = slab;
    const half = slab.width / 2;
    const y0 = slab.y ?? 0;
    const material = slab.material ?? finish;
    const paint = finishOf(material);
    const partSeed = seed + 31 * (i + 1);
    const sideUv = ([x, z]) => [side.x + (x - box.x0) * px, side.y + (box.z1 - z) * px];
    counted(slab.name, () => {
      // its two sides, the same picture on each
      for (const [a, b, d] of earsOf(poly))
        for (const sign of [1, -1]) {
          const corners = [a, b, d].map((k) => mesh.V([poly[k][0], y0 + sign * half, poly[k][1]], sideUv(poly[k])));
          const inside = [(poly[a][0] + poly[b][0] + poly[d][0]) / 3, y0, (poly[a][1] + poly[b][1] + poly[d][1]) / 3];
          mesh.tri(...corners, inside);
        }
      // its rim, edge by edge along a strip
      let run = 0;
      slab.edges = [];
      poly.forEach((p, k) => {
        const q = poly[(k + 1) % poly.length];
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (length < 1e-6) return;
        const u0 = rim.x + run * px;
        const u1 = rim.x + (run + length) * px;
        // outwards from an anticlockwise outline is to the right of the edge
        const out = [(q[1] - p[1]) / length, -(q[0] - p[0]) / length];
        slab.edges.push({ u0: u0 - rim.x, u1: u1 - rim.x, up: out[1], length });
        const inside = [(p[0] + q[0]) / 2 - out[0] * 0.02, y0, (p[1] + q[1]) / 2 - out[1] * 0.02];
        mesh.quad(
          mesh.V([p[0], y0 + half, p[1]], [u0, rim.y]),
          mesh.V([q[0], y0 + half, q[1]], [u1, rim.y]),
          mesh.V([q[0], y0 - half, q[1]], [u1, rim.y + rim.h]),
          mesh.V([p[0], y0 - half, p[1]], [u0, rim.y + rim.h]),
          inside,
        );
        run += length;
      });
    });
    // the side's picture: lit from above, its edges bevelled bright with a dark line inside them
    canvas.zone(side, (u, v) => {
      const x = box.x0 + u / px;
      const z = box.z1 - v / px;
      const d = polyDist(x, z, poly);
      if (d < -0.05) return [0.08, 0.08, 0.09];
      const height = (z - box.z0) / Math.max(0.01, box.z1 - box.z0);
      let light = 0.82 + 0.22 * height + 0.32 * bell(d, 0.05) - 0.22 * bell(d - 0.13, 0.04);
      // checkering on a grip: a fine diamond lattice inside its border
      if (slab.checkering && d > 0.22) {
        const lattice = Math.min(Math.abs(((x + z) * 6) % 1 - 0.5), Math.abs(((x - z) * 6) % 1 - 0.5));
        light *= 0.78 + 0.35 * step(0.05, 0.2, lattice);
      }
      // serrations at a slide's rear: upright grooves over its upper part
      if (slab.serrations && x < box.x0 + 1.2 && x > box.x0 + 0.2 && z > box.z0 + (box.z1 - box.z0) * 0.25 && d > 0.08)
        light *= 0.72 + 0.3 * step(0.3, 0.6, Math.abs(((x * 7) % 1) - 0.5) * 2);
      // ribs across a magazine or along a handguard
      if (slab.ribs && d > 0.12) light *= slab.ribsAlong ? 0.85 + 0.2 * step(0.35, 0.6, Math.abs(((z * 3) % 1) - 0.5) * 2) : 0.88 + 0.16 * step(0.3, 0.6, Math.abs(((z * 1.6) % 1) - 0.5) * 2);
      let colour = paint(x, z, light, partSeed, d < 0.12 ? 1 - d / 0.12 : 0);
      colour = worn(colour, d < 0.1 ? 1 - d / 0.1 : 0, material);
      // an ejection port: a dark opening with a lit lower lip
      const port = slab.port;
      if (port) {
        const pz0 = box.z0 + (box.z1 - box.z0) * 0.42;
        const inPort = x > port.at && x < port.at + port.length && z > pz0 && z < pz0 + port.height;
        if (inPort) colour = times([0.05, 0.05, 0.05], 1 + 0.6 * bell(z - pz0, 0.06));
        else if (Math.abs(z - pz0) < 0.05 && x > port.at && x < port.at + port.length) colour = times(colour, 1.4);
      }
      // a butt plate: the stock's last half inch darker, a dark line where it meets the wood
      if (slab.butt !== undefined && x < slab.butt + 0.45) colour = x < slab.butt + 0.4 ? times(FINISHES.polymer(x, z, light, partSeed), 0.9) : [0.04, 0.03, 0.03];
      return colour;
    });
    // the rim's picture: each edge lit by which way it faces, darker underneath
    canvas.zone(rim, (u, v) => {
      const edge = slab.edges.find((e) => u >= e.u0 - 0.5 && u <= e.u1 + 0.5) ?? slab.edges.at(-1);
      const across = v / rim.h;
      const light = (0.72 + 0.32 * edge.up) * (0.9 + 0.2 * bell(across - 0.5, 0.4));
      const along = (u - edge.u0) / px;
      const nearSide = Math.min(across, 1 - across) * slab.width;
      return worn(paint(along, across * slab.width, light, partSeed + 5, 0), nearSide < 0.06 ? 1 : 0, material);
    });
  });

  // ── the lathes: along x at their height, their caps a disc of their own ──
  lathes.forEach((lathe, i) => {
    const zone = zones[`l${i}`];
    const cap = zones[`c${i}`];
    const material = lathe.material ?? finish;
    const paint = finishOf(material);
    const partSeed = seed + 300 + i * 17;
    const length = lathe.x1 - lathe.x0;
    counted(lathe.name, () => {
      mesh.lathe([[0, lathe.radius], [length, lathe.radius]], zone, {
        sides: lathe.sides,
        px,
        flatten: lathe.flatten ?? 1,
        at: (s, a, b) => [lathe.x0 + s, a, lathe.z + b],
        // both ends closed: one left open (a barrel's inside the receiver) is a hole the check finds
        caps: [true, cap ?? true],
      });
    });
    canvas.zone(zone, (u, v) => {
      const s = u / px;
      const around = clamp(v / zone.h, 0, 1);
      let light = cylinderLight(around, 0.5);
      if (lathe.ribs) light *= 0.8 + 0.25 * step(0.3, 0.55, Math.abs(((s / length) * lathe.ribs) % 1 - 0.5) * 2);
      const edge = Math.max(bell(s, 0.08), bell(s - length, 0.08));
      return worn(paint(s, around * 2 * Math.PI * lathe.radius, light, partSeed, edge), edge, material);
    });
    if (cap)
      canvas.zone(cap, (u, v) => {
        const r = Math.hypot(u - cap.w / 2, v - cap.h / 2) / (cap.w / 2);
        if (lathe.bore && r < 0.62) return times([0.03, 0.03, 0.03], 1 + 0.8 * bell(r - 0.62, 0.08));
        return worn(paint(u / px, v / px, 1 - 0.2 * r, partSeed + 3, r), bell(r - 1, 0.15), material);
      });
  });

  // ── the bars: a section of `thick` (in the outline's plane) by `width` (across), swept along a path ──
  bars.forEach((bar, i) => {
    const zone = zones[`b${i}`];
    const material = bar.material ?? finish;
    const paint = finishOf(material);
    const partSeed = seed + 500 + i * 13;
    const { path, thick, width } = bar;
    const t = thick / 2;
    const w = width / 2;
    // how far along the path each point is, and the way across it there (in the outline's plane)
    let run = 0;
    const along = path.map((p, k) => (k ? (run += Math.hypot(p[0] - path[k - 1][0], p[1] - path[k - 1][1])) : 0));
    const across = path.map((p, k) => {
      const a = path[Math.max(0, k - 1)];
      const b = path[Math.min(path.length - 1, k + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    });
    // the section's four sides, each a band of the zone: across +, side +y, across -, side -y
    const bands = [w * 2, t * 2, w * 2, t * 2];
    const total = bands.reduce((a, b) => a + b, 0);
    const bandY = bands.map((_, k) => zone.y + (zone.h * bands.slice(0, k).reduce((a, b) => a + b, 0)) / total);
    bandY.push(zone.y + zone.h);
    const corner = (k, c) => {
      const [x, z] = path[k];
      const [nx, nz] = across[k];
      const [ox, oy] = [[t, w], [t, -w], [-t, -w], [-t, w]][c];
      return [x + nx * ox, oy, z + nz * ox];
    };
    counted(bar.name, () => {
      for (let k = 0; k + 1 < path.length; k++) {
        const u0 = zone.x + along[k] * px;
        const u1 = zone.x + along[k + 1] * px;
        const middle = [(path[k][0] + path[k + 1][0]) / 2, 0, (path[k][1] + path[k + 1][1]) / 2];
        for (let c = 0; c < 4; c++) {
          const d = (c + 1) % 4;
          mesh.quad(
            mesh.V(corner(k, c), [u0, bandY[c]]),
            mesh.V(corner(k + 1, c), [u1, bandY[c]]),
            mesh.V(corner(k + 1, d), [u1, bandY[c + 1]]),
            mesh.V(corner(k, d), [u0, bandY[c + 1]]),
            middle,
          );
        }
      }
      // its two ends closed
      for (const k of [0, path.length - 1]) {
        const next = path[k === 0 ? 1 : k - 1];
        const inside = [path[k][0] + (next[0] - path[k][0]) * 0.05, 0, path[k][1] + (next[1] - path[k][1]) * 0.05];
        const end = [0, 1, 2, 3].map((c) => mesh.V(corner(k, c), [zone.x + along[k] * px, bandY[c]]));
        mesh.quad(end[0], end[1], end[2], end[3], inside);
      }
    });
    canvas.zone(zone, (u, v) => {
      const band = bandY.findIndex((y, k) => v + zone.y >= y && v + zone.y < bandY[k + 1]);
      const light = [1.05, 0.85, 0.7, 0.85][Math.max(0, band)];
      const edge = bell(((v + zone.y - bandY[Math.max(0, band)]) / Math.max(1, bandY[Math.max(0, band) + 1] - bandY[Math.max(0, band)])) - 0.5, 0.35) < 0.5 ? 1 : 0;
      return worn(paint(u / px, v / px, light, partSeed, edge), edge, material);
    });
  });

  // the views of a weapon's files each part is in, where it is not all three: Valve's first-person guns leave
  // their stock out (it is behind the camera), and a stock there is what the fit holds where the grip was
  const views = S && !S.firstPerson ? { stock: ["p", "w"] } : {};
  // `asDrawn`: a gun knows its up and its front, and is laid in a weapon's files as it is drawn
  // `length`: the whole gun made that long, every part in proportion, about the grip's top (the origin)
  let tris = mesh.tris;
  if (spec.length !== undefined) {
    const xs = tris.flatMap((t) => t.map((corner) => corner.p[0]));
    const k = spec.length / (Math.max(...xs) - Math.min(...xs));
    tris = tris.map((t) => t.map((corner) => ({ ...corner, p: corner.p.map((v) => v * k) })));
  }
  return { tris, image: canvas.image(), parts, views, asDrawn: true };
}
