// The metro car of the H9 maps (levels/assembly/metro.mjs, ride.mjs) as studio models made by SMAK: nothing of any game's is in it,
// the textures are painted here.
//
//   node levels/art/h9-metro-car.mjs [out folder, default levels/art/h9/models]
//
// writes metro_cab.mdl, metro_cab_m.mdl (the same car with its platform side on the other hand: mirrored) and metro_mid.mdl,
// metro_mid_m.mdl (no cab: a car in the middle of a train of three), and, with `--sheet <folder>`, pictures of them.
// Install as <H9>/ts/models/h9/metro_cab.mdl and the others (a ts_model names it: metro.mjs `carModel`).
//
// THE REFERENCE FORM (what a metro or tram car is, and what this one takes of it)
//   cross-section  not a rectangle: a skirt under the floor in a chamfer, sides that lean in by 1.5 over their height, and over the
//                  eave a roof that is an ellipse's quarter (12 segments each side): 114 wide at the floor, 100 high at the crown.
//   side           a dark window band (the glass sits in rounded openings, 8 deep so a reveal shows), silver panels over and under it,
//                  gold pinstripes and brass mouldings along the flank, a dark skirt with the wheels showing under it; two doorways a side, 52 wide, each with its
//                  frame (on the platform side they are open: the map's door leaves slide in front of them; on the track side the
//                  doors are shut panels, recessed), a window between and a narrow one at each end.
//   end            a cab: the section loft that narrows and lowers over 22 units into a raked windscreen and a flat front with
//                  headlights and tail lamps; or the other end, a gangway: a rubber bellows (ribbed) round a door, a coupler under it.
//   under          two bogies: axles, wheels (chamfered) on the rails 32 apart, side frames, springs; equipment boxes under the floor.
//   inside         a ribbed floor, a lining that follows the roof's arc, light strips in the crown (the lamp texture on the underside
//                  only), a bench along the track-side wall under the windows (seats of cushions), poles and a handrail, the end walls.
// Size: 384 long, 114 wide at the floor (the map's brushes keep 120: a door leaf, 3 thick, stands in the 3 between), the floor at z 0,
// the crown at 100 (the map's roof was 96). x forward (the cab's way), y left, the platform side at -y.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildMdl, indexed, check, png, render, workshop } from "../../src/index.mjs";

const { fbm, noise, rand, step, mix, times } = workshop;
const OUT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "levels/art/h9/models";
const SHEET = process.argv.includes("--sheet") ? process.argv[process.argv.indexOf("--sheet") + 1] : null;

// ── vectors ────────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => a + (b - a) * t;

// ── the sections ───────────────────────────────────────────────────────────
const HALF = 192; // half the length
const WALL_IN = 4.5; // the skin's thickness
const SKIRT = -14;
/** The outer profile of one side, from the skirt's lower edge up the flank and over the roof to the crown: [{ y, z }]. */
const yOut = (z) => 57 - (1.5 * (z + 11)) / 89; // the flank: a plane leaning in 1.5 over its height
const yIn = (z) => yOut(z) - WALL_IN;
const B0 = -11; // the flank runs from here
const B1 = 78; // to here, the eave
const ARC = 12;
const outerA = [{ y: 54, z: SKIRT }, { y: 57, z: B0 }];
const outerC = Array.from({ length: ARC }, (_, k) => {
  const a = (Math.PI / 2) * ((k + 1) / ARC);
  return { y: yOut(B1) * Math.cos(a), z: B1 + 22 * Math.sin(a) };
});
const innerC = Array.from({ length: ARC }, (_, k) => {
  const a = (Math.PI / 2) * ((k + 1) / ARC);
  return { y: yIn(B1) * Math.cos(a), z: B1 + 17.5 * Math.sin(a) };
});
const OUTER = [...outerA, { y: yOut(B1), z: B1 }, ...outerC];
const INNER = [{ y: 54 - WALL_IN, z: SKIRT }, { y: yIn(B0), z: B0 }, { y: yIn(B1), z: B1 }, ...innerC];
/** Arc length along a profile to each point, and a point's z as a number of rows. */
const arcOf = (P) => {
  const s = [0];
  for (let i = 1; i < P.length; i++) s.push(s[i - 1] + Math.hypot(P[i].y - P[i - 1].y, P[i].z - P[i - 1].z));
  return s;
};
const S_OUT = arcOf(OUTER);
const S_IN = arcOf(INNER);
/** The row of a z on a profile (z grows along it). */
const rowOf = (P, S, z) => {
  for (let i = 1; i < P.length; i++) if (z <= P[i].z + 1e-9) return lerp(S[i - 1], S[i], (z - P[i - 1].z) / (P[i].z - P[i - 1].z || 1));
  return S.at(-1);
};
const zOfRow = (P, S, row) => {
  for (let i = 1; i < P.length; i++) if (row <= S[i] + 1e-9) return lerp(P[i - 1].z, P[i].z, (row - S[i - 1]) / (S[i] - S[i - 1] || 1));
  return P.at(-1).z;
};

// ── the textures (painted here) ────────────────────────────────────────────
const canvas = (W, H, fn) => {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = fn(x, y);
      for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k] * 255)));
    }
  return { width: W, height: H, rgb };
};
// The livery of the city's cars (levels/notes-h9.md, section 6: "Byzantine regal"): a bottle-green lacquer body with gold pinstripes and
// brass mouldings, an emblem on each flank, dark wood inside, brass poles, red velvet benches, warm lamps.
const LACQ = [0.035, 0.125, 0.085]; // bottle green
const OXB = [0.2, 0.035, 0.05]; // oxblood
const GOLD = [0.8, 0.6, 0.2];
const BRASS = [0.72, 0.52, 0.17];
const WOOD = [0.2, 0.1, 0.055];
const VELVET = [0.36, 0.045, 0.075];
const ux = (x) => 1 + ((x + HALF) / (2 * HALF)) * 510;
const xOfU = (u) => ((u - 1) / 510) * 2 * HALF - HALF;

const REG = {
  hull: { door: { x: 0, y: 160, w: 256, h: 96 }, end: { x: 256, y: 160, w: 256, h: 32 }, trim: { x: 256, y: 192, w: 256, h: 16 }, screen: { x: 256, y: 208, w: 256, h: 16 }, roof: { x: 256, y: 224, w: 256, h: 32 } },
  inner: { floor: { x: 0, y: 156, w: 512, h: 16 }, seat: { x: 0, y: 172, w: 256, h: 12 }, back: { x: 256, y: 172, w: 256, h: 12 }, steel: { x: 0, y: 184, w: 256, h: 8 }, vinyl: { x: 256, y: 184, w: 256, h: 8 }, end: { x: 0, y: 192, w: 512, h: 64 } },
  gear: { wheel: { x: 0, y: 0, w: 128, h: 32 }, frame: { x: 0, y: 32, w: 128, h: 32 }, rubber: { x: 0, y: 64, w: 128, h: 32 }, equip: { x: 0, y: 96, w: 128, h: 32 } },
  lamp: { white: { x: 0, y: 0, w: 32, h: 32 }, red: { x: 32, y: 0, w: 32, h: 32 } },
};
/** Brass across a turn: u (0..1) round a tube, a highlight at one side. */
const brassAt = (u, g = 0) => times(BRASS, 0.75 + 0.5 * Math.pow(Math.max(0, Math.sin(Math.PI * ((u * 4) % 1))), 1.5) + g);

/** The emblem of the city, at (cx, cz) in the flank's own units: a gold ring, an oxblood disc, an eight-pointed star in it. Returns a colour or null. */
function emblem(x, z, cx, cz, R) {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d > R + 1.2) return null;
  const a = Math.atan2(dz, dx);
  if (d > R) return times(GOLD, 0.6); // a shadow edge
  if (d > R - 1.5) return GOLD;
  if (d > R - 2.6) return times(LACQ, 0.8);
  // the star: eight points, long on the axes, short on the diagonals
  const k = 0.5 + 0.5 * Math.cos(4 * a);
  const reach = (R - 3.5) * (0.5 + 0.5 * Math.pow(k, 1.4));
  if (d < reach && d > 1.8) return mix(GOLD, times(GOLD, 0.8), d / reach);
  if (d <= 1.8) return times(OXB, 1.5);
  return OXB;
}

/** The lacquer of a flank at height z: sheen, scuffs. */
function lacquer(px, py, z, x) {
  const sheen = 0.02 * (1 - Math.abs(z - 40) / 50) + 0.03 * Math.max(0, 1 - Math.abs(z - 57) / 5); // a light along the shoulder
  const mottle = 0.025 * (fbm(px * 0.05, py * 0.2, 4) - 0.5) + 0.02 * (noise(px * 0.12, py * 1.4, 1) - 0.5);
  let c = times(LACQ, 1 + mottle * 6);
  c = [c[0] + sheen * 0.6, c[1] + sheen * 1.2, c[2] + sheen];
  // scuffs: worn paint near the doors, lighter and greyer
  const doorNear = Math.max(0, 1 - Math.min(...[-102, 102].map((d) => Math.abs(x - d))) / 40);
  const scuff = Math.max(0, noise(px * 0.5, py * 0.9, 21) - 0.7) * (0.4 + doorNear);
  return mix(c, [0.2, 0.22, 0.2], Math.min(0.5, scuff * 1.4));
}

function hullPaint(px, py) {
  if (py >= 160) {
    const r = (reg) => px >= reg.x && px < reg.x + reg.w && py >= reg.y && py < reg.y + reg.h;
    const g = fbm(px * 0.2, py * 0.2, 3) * 0.08;
    if (r(REG.hull.door)) {
      // a shut door: two leaves in lacquer with a brass frame, a seam down the middle, dark glass over the top half
      const u = (px - REG.hull.door.x) / 256;
      const v = (py - REG.hull.door.y) / 96;
      let c = times(LACQ, 1 + g * 2 + 0.2 * noise(px * 0.9, py * 0.05, 5));
      if (v > 0.1 && v < 0.55 && Math.abs(u - 0.5) > 0.035 && u > 0.1 && u < 0.9) c = mix([0.03, 0.05, 0.05], [0.13, 0.17, 0.19], step(0.1, 0.55, v) * 0.6 + 0.2 * Math.max(0, 1 - Math.abs(u + v - 0.9) * 8));
      if (Math.abs(u - 0.5) < 0.035) c = times(BRASS, 0.55);
      const edge = Math.min(u, 1 - u, v, 1 - v);
      if (edge < 0.05) c = times(BRASS, 0.7 + g * 2);
      if (v > 0.1 && v < 0.55 && u > 0.1 && u < 0.9 && (Math.abs(v - 0.1) < 0.02 || Math.abs(v - 0.55) < 0.02 || Math.abs(u - 0.1) < 0.012 || Math.abs(u - 0.9) < 0.012)) c = times(GOLD, 0.8);
      if (v > 0.82 && v < 0.84) c = times(c, 0.7);
      return c;
    }
    if (r(REG.hull.end)) {
      // an end: lacquer, gold bands, a dark skirt
      const u = (px - 256) / 256;
      const v = (py - 160) / 32;
      let c = times(LACQ, 1 + g);
      if ((v > 0.5 && v < 0.56) || (v > 0.66 && v < 0.7)) c = GOLD;
      if (v > 0.8) c = mix(c, [0.05, 0.05, 0.05], 0.85);
      if (Math.abs(((u * 8) % 1) - 0.5) > 0.47) c = times(c, 0.8);
      return c;
    }
    if (r(REG.hull.trim)) {
      // brass, shaded across (u) only: it is wound round tubes and laid as reveals
      const u = (px - 256) / 256;
      return brassAt(u, g * 1.5);
    }
    if (r(REG.hull.screen)) {
      // the cab's glass in a brass frame (v: top to bottom of a pane; u: along the front)
      const u = (px - 256) / 256;
      const v = (py - 208) / 16;
      let c = mix([0.03, 0.04, 0.05], [0.17, 0.22, 0.27], 0.33 * step(0, 1, 1 - v) + 0.36 * Math.max(0, 1 - Math.abs(u * 1.6 - v * 0.9 - 0.45) * 6));
      if (v < 0.14 || v > 0.86) c = times(BRASS, 0.8 + g * 2);
      else if (v < 0.2 || v > 0.8) c = times(GOLD, 0.55);
      if (u < 0.02 || u > 0.98) c = times(BRASS, 0.8);
      return c;
    }
    if (r(REG.hull.roof)) {
      const u = (px - 256) / 256;
      const v = (py - 224) / 32;
      let c = times([0.14, 0.11, 0.07], 1 + g * 2);
      if (Math.abs(((v * 6) % 1) - 0.5) > 0.44) c = times(BRASS, 0.35); // louvres
      if (u < 0.04 || u > 0.96) c = times(BRASS, 0.5);
      return c;
    }
    return [0.2, 0.2, 0.2];
  }
  // the livery: u along the car, v the arc up its profile
  const x = xOfU(px);
  const z = zOfRow(OUTER, S_OUT, py);
  const line = (z0, w) => Math.abs(z - z0) < w / 2;
  let c;
  if (z < -0.3) {
    // the skirt, near black with a gold line along its lower edge
    c = times([0.05, 0.05, 0.05], 1 + 0.4 * noise(px * 0.12, py * 1.4, 1));
    if (z < SKIRT + 3 && z > SKIRT + 1.6) c = times(GOLD, 0.8);
  } else if (z < 78.2) {
    c = lacquer(px, py, z, x);
    // the stripes: a band at 11 and one at 35 are the mouldings (tubes in the model), a pinstripe pair by each, a thin line at 2 and at 75
    if (line(2.5, 1.2) || line(75, 1.2)) c = GOLD;
    if (line(8.2, 0.9) || line(13.8, 0.9) || line(32.2, 0.9) || line(37.8, 0.9)) c = times(GOLD, 0.9);
    if (line(11, 3) || line(35, 3)) c = times(BRASS, 0.8);
    if (z > 76 && z <= 78.2) c = times(BRASS, 0.55);
    const em = emblem(x, z, 0, 23, 10);
    if (em) c = em;
  } else {
    // the roof: a dark green-black, seams across every 96, a gold line where it meets the eave
    const t = step(78, 100, z);
    c = times(mix([0.07, 0.11, 0.09], [0.05, 0.075, 0.065], t), 1 + 0.5 * (noise(px * 0.12, py * 1.4, 1) - 0.5) + 0.3 * (fbm(px * 0.03, py * 0.15, 4) - 0.5));
    if (Math.abs(((x + 192) % 96) - 48) > 47.2 || Math.abs(((x + 192) % 96) - 48) < 0.5) c = times(c, 0.6);
    if (line(81, 1)) c = times(GOLD, 0.7);
  }
  // wear: grime thickening to the skirt, rain streaks below the window band
  const low = step(34, -12, z);
  const streak = Math.max(0, noise(px * 0.9, 3, 9) - 0.55) * step(70, 37, z);
  c = mix(c, [0.15, 0.13, 0.1], Math.min(0.55, 0.3 * low + 0.9 * streak * 0.35 + 0.15 * (fbm(px * 0.1, py * 0.1, 11) - 0.5)));
  return c;
}

function innerPaint(px, py) {
  const r = (reg) => px >= reg.x && px < reg.x + reg.w && py >= reg.y && py < reg.y + reg.h;
  const g = fbm(px * 0.25, py * 0.25, 7) * 0.06;
  /** Dark wood, grain along the car. */
  const wood = (k = 1) => times(WOOD, k * (0.85 + g * 3 + 0.35 * (noise(px * 0.05, py * 1.6, 31) - 0.5)));
  if (py >= 156) {
    if (r(REG.inner.floor)) {
      const v = (py - 156) / 16;
      let c = wood(0.8);
      if (Math.floor(py / 2) % 4 === 0 || py % 4 === 0) c = times(c, 0.7); // planks along the car
      if (v < 0.12 || v > 0.88) c = times(BRASS, 0.75); // a brass strip at the threshold and along the walls
      return c;
    }
    if (r(REG.inner.seat) || r(REG.inner.back)) {
      // red velvet, buttoned: a pile that varies, a button and a crease every 16 px
      const bx = (px % 16) - 8;
      const by = (py % 12) - 6;
      let c = times(VELVET, 0.8 + g * 3 + 0.35 * noise(px * 0.8, py * 0.8, 2));
      const d = Math.hypot(bx, by * 1.3);
      if (r(REG.inner.back)) c = times(c, 1.1);
      if (d < 1.4) c = times(BRASS, 0.8);
      else if (Math.abs(Math.abs(bx) - Math.abs(by) * 1.3) < 0.7 && d < 8) c = times(c, 0.65);
      return c;
    }
    if (r(REG.inner.steel)) {
      // brass for poles and handles: across (u) only
      const u = (px - REG.inner.steel.x) / 256;
      return brassAt(u, g);
    }
    if (r(REG.inner.vinyl)) return wood(0.7);
    if (r(REG.inner.end)) {
      const u = (px - 0) / 512;
      const v = (py - 192) / 64;
      let c = wood();
      if (v < 0.25) c = times([0.55, 0.5, 0.38], 0.8 + g); // the ceiling's colour above
      if (Math.abs(((u * 12) % 1) - 0.5) > 0.46 && v > 0.25) c = times(c, 0.6); // panel grooves
      if (u > 0.36 && u < 0.64 && v > 0.3 && v < 1) c = wood(1.25);
      if (u > 0.36 && u < 0.64 && v > 0.45 && v < 0.78) c = [0.05, 0.06, 0.05];
      if (u > 0.355 && u < 0.645 && v > 0.3 && (Math.abs(u - 0.36) < 0.01 || Math.abs(u - 0.64) < 0.01 || Math.abs(v - 0.3) < 0.02 || Math.abs(v - 0.45) < 0.012 || Math.abs(v - 0.78) < 0.012)) c = times(BRASS, 0.8);
      if (Math.abs(u - 0.5) < 0.01) c = times(BRASS, 0.4);
      return c;
    }
    return [0.2, 0.2, 0.2];
  }
  const x = xOfU(px);
  const z = zOfRow(INNER, S_IN, py);
  let c;
  if (z < 0) c = [0.06, 0.04, 0.03];
  else if (z < 11) {
    // the wainscot, a darker wood with a panel every 40
    c = wood(0.75);
    if (Math.abs(((x + 192) % 40) - 20) > 18.6 || z > 9.2) c = times(c, 0.65);
  } else if (z < 12.2) c = times(BRASS, 0.75);
  else if (z < 78.5) {
    c = wood(1.05);
    // wood panels with grooves between
    if (Math.abs(((x + 192) % 32) - 16) > 15.2) c = times(c, 0.55);
    // a door's shut panel at each door (the track side wears them; the platform side's are doorways), a window's frame line
    for (const [a, b] of [[-128, -76], [76, 128]])
      if (x > a && x < b && z < 76) {
        c = wood(1.3);
        if (Math.abs(x - (a + b) / 2) < 1.2) c = times(BRASS, 0.4);
        if (z > 34 && z < 70 && Math.abs(x - (a + b) / 2) > 2.5 && x > a + 4 && x < b - 4) c = [0.04, 0.05, 0.05];
        if (x < a + 2.5 || x > b - 2.5 || z > 73.5) c = times(BRASS, 0.7);
      }
    if (z > 75 && z < 78.5) c = times(BRASS, 0.8);
  } else {
    // the lining: a pale warm ivory with a gilt line every 64 and a gold border
    const t = step(78, 96, z);
    c = times(mix([0.66, 0.6, 0.45], [0.74, 0.69, 0.54], t), 1 + 0.12 * (noise(px * 0.1, py * 0.3, 5) - 0.5) + g);
    if (Math.abs(((x + 192) % 64) - 32) > 31.4) c = times(GOLD, 0.8);
    if (z < 79.6) c = times(GOLD, 0.8);
  }
  return c;
}

function gearPaint(px, py) {
  const g = fbm(px * 0.3, py * 0.3, 9) * 0.07;
  const v = py % 32;
  if (py < 32) {
    // a wheel: dark steel, a lighter worn tread band, rust at the flange
    return times([0.3, 0.3, 0.32], 0.7 + g * 3 + 0.4 * step(8, 16, v) * step(26, 16, v) + 0.2 * (noise(px * 0.4, py * 0.4, 8) - 0.5));
  }
  if (py < 64) return times([0.1, 0.1, 0.1], 1 + g * 2 + 0.3 * step(0.4, 0.7, noise(px * 0.2, py * 0.3, 12)) * 0.2);
  if (py < 96) return times([0.06, 0.06, 0.065], 1 + g + 0.5 * (Math.sin(px * 0.9) > 0.5 ? 0.35 : 0));
  // equipment box: grey, louvres
  let c = times([0.1, 0.17, 0.13], 0.9 + g * 2);
  if (v > 8 && v < 24 && (Math.floor(py / 2) % 2 === 0)) c = times(c, 0.6);
  if (px % 32 < 2 || v < 2) c = times(c, 0.55);
  return c;
}

function lampPaint(px, py) {
  const left = px < 32;
  const d = Math.hypot((px % 32) - 15.5, py - 15.5) / 16;
  if (left) return mix([1, 0.86, 0.52], [0.9, 0.66, 0.3], Math.min(1, d * d)); // warm
  return mix([0.95, 0.12, 0.08], [0.55, 0.05, 0.04], Math.min(1, d * d));
}

function glassPaint(px, py) {
  // additive: black is nothing; a faint cool tint and two bright slanting streaks, as a pane's reflection
  const u = px / 64;
  const v = py / 64;
  const tint = 0.035 + 0.05 * (1 - v);
  const streak = (c, w) => Math.max(0, 1 - Math.abs(u * 0.9 + v * 0.35 - c) / w);
  const s = 0.34 * streak(0.55, 0.05) + 0.2 * streak(0.7, 0.03) + 0.12 * streak(0.25, 0.08);
  return [tint * 0.7 + s * 0.8, tint + s * 0.9, tint * 1.5 + s];
}

const TEX = {
  hull: indexed(canvas(512, 256, hullPaint), "mc_hull.bmp"),
  inner: indexed(canvas(512, 256, innerPaint), "mc_inner.bmp"),
  gear: indexed(canvas(128, 128, gearPaint), "mc_gear.bmp"),
  lamp: { ...indexed(canvas(64, 32, lampPaint), "mc_lamp.bmp"), flags: 4 },
  glass: { ...indexed(canvas(64, 64, glassPaint), "mc_glass.bmp"), flags: 32 },
};

// ── the mesh builder ───────────────────────────────────────────────────────
/** Triangles by part (a bodypart) and texture, each facing along `out` (a vector: the way it looks out of the solid). */
class Mesh {
  constructor() {
    this.parts = {};
    this.mirror = false;
  }
  list(part, tex) {
    const p = (this.parts[part] ??= {});
    return (p[tex] ??= []);
  }
  /** pts: three points, uvs: three [pixel x, pixel y] in the texture `tex` */
  tri(part, tex, pts, uvs, out, group) {
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (Math.hypot(...n) < 1e-7) return;
    const W = TEX[tex].width;
    const H = TEX[tex].height;
    const flip = dot(n, out) < 0;
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    this.list(part, tex).push(order.map((k) => ({ p: pts[k], uv: [uvs[k][0] / W, uvs[k][1] / H], group })));
  }
  poly(part, tex, pts, uvs, out, group) {
    const tris = earcut(pts, out);
    for (const [a, b, c] of tris) this.tri(part, tex, [pts[a], pts[b], pts[c]], [uvs[a], uvs[b], uvs[c]], out, group);
  }
  quad(part, tex, pts, uvs, out, group) {
    this.tri(part, tex, [pts[0], pts[1], pts[2]], [uvs[0], uvs[1], uvs[2]], out, group);
    this.tri(part, tex, [pts[0], pts[2], pts[3]], [uvs[0], uvs[2], uvs[3]], out, group);
  }
}

/** Ear clipping of a simple planar polygon (3D points in one plane, `out` its normal's side): [[i, j, k]]. */
function earcut(pts, out) {
  // work in a plane's two axes: drop the axis `out` is most along
  const ax = [0, 1, 2].sort((a, b) => Math.abs(out[b]) - Math.abs(out[a]))[0];
  const [i0, i1] = [0, 1, 2].filter((k) => k !== ax);
  let P = pts.map((p, i) => ({ x: p[i0], y: p[i1], i }));
  const area = P.reduce((s, p, i) => s + (p.x * P[(i + 1) % P.length].y - P[(i + 1) % P.length].x * p.y), 0);
  if (area < 0) P.reverse();
  const out3 = [];
  const cr = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (a, b, c, p) => cr(a, b, p) >= -1e-9 && cr(b, c, p) >= -1e-9 && cr(c, a, p) >= -1e-9;
  let guard = P.length * P.length + 10;
  while (P.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < P.length; k++) {
      const a = P[(k + P.length - 1) % P.length];
      const b = P[k];
      const c = P[(k + 1) % P.length];
      if (cr(a, b, c) <= 1e-9) continue;
      if (P.some((p) => p !== a && p !== b && p !== c && inside(a, b, c, p) && !((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y) || (p.x === c.x && p.y === c.y)))) continue;
      out3.push([a.i, b.i, c.i]);
      P.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // a degenerate (collinear) vertex: drop one
      const k = P.findIndex((_, k) => Math.abs(cr(P[(k + P.length - 1) % P.length], P[k], P[(k + 1) % P.length])) <= 1e-9);
      if (k < 0) break;
      P.splice(k, 1);
    }
  }
  if (P.length === 3) out3.push([P[0].i, P[1].i, P[2].i]);
  return out3;
}

/** A pixel in a region, from fractions (a, b) of it (a across, b down). */
const inReg = (reg, a, b) => [reg.x + 0.5 + a * (reg.w - 1), reg.y + 0.5 + b * (reg.h - 1)];

/**
 * A chamfered box from lo to hi: its faces cut `c` at every edge and corner. Each face wears `reg` of `tex`, laid by its dominant axis over the box's extent.
 * `faces`: { "+z": [tex, reg], ... } overrides a face's material (and its chamfers' which are the face's).
 */
function cbox(M, part, tex, reg, lo, hi, c = 0, faces = {}) {
  const h = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
  const m = [(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2];
  c = Math.min(c, Math.min(...h) * 0.9);
  const sg = [-1, 1];
  const P = (sx, sy, sz, face) => {
    const k = [0, 1, 2];
    const hh = k.map((a) => h[a] - (a === face || c === 0 ? 0 : c));
    const s = [sx, sy, sz];
    return k.map((a) => m[a] + s[a] * hh[a]);
  };
  const uvOf = (p, axis, material) => {
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    const a = (p[u] - lo[u]) / (hi[u] - lo[u] || 1);
    const b = 1 - (p[v] - lo[v]) / (hi[v] - lo[v] || 1);
    return inReg(material[1], Math.min(1, Math.max(0, a)), Math.min(1, Math.max(0, b)));
  };
  const mat = (axis, sign) => faces[`${sign > 0 ? "+" : "-"}${"xyz"[axis]}`] ?? [tex, reg];
  const put = (pts, normal, axis, sign) => {
    const material = mat(axis, sign);
    M.quad(part, material[0], pts, pts.map((p) => uvOf(p, axis, material)), normal);
  };
  for (let axis = 0; axis < 3; axis++)
    for (const sign of sg) {
      const o = [0, 1, 2].filter((a) => a !== axis);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const s = [0, 0, 0];
        s[axis] = sign;
        s[o[0]] = a;
        s[o[1]] = b;
        return P(...s, axis);
      });
      const n = [0, 0, 0];
      n[axis] = sign;
      put(pts, n, axis, sign);
    }
  if (c === 0) return;
  // the chamfers along each edge: between face a (sign sa) and face b (sign sb)
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) {
      const k = 3 - a - b; // the axis along the edge
      for (const sa of sg)
        for (const sb of sg) {
          const pts = [-1, 1].flatMap((t) => {
            const sA = [0, 0, 0];
            sA[a] = sa;
            sA[b] = sb;
            sA[k] = t;
            return [P(...sA, a), P(...sA, b)];
          });
          // pts: [A at -1, B at -1, A at +1, B at +1]
          const n = [0, 0, 0];
          n[a] = sa;
          n[b] = sb;
          const material = mat(a, sa);
          M.quad(part, material[0], [pts[0], pts[2], pts[3], pts[1]], [pts[0], pts[2], pts[3], pts[1]].map((p) => uvOf(p, a, material)), n);
        }
    }
  for (const sx of sg)
    for (const sy of sg)
      for (const sz of sg) {
        const pts = [P(sx, sy, sz, 0), P(sx, sy, sz, 1), P(sx, sy, sz, 2)];
        const material = mat(2, sz);
        M.tri(part, material[0], pts, pts.map((p) => uvOf(p, 2, material)), [sx, sy, sz]);
      }
}

/** A surface of revolution about the line from `p0` along `axis` (unit): `profile` [[t along, r]], n sides, caps at both ends when their r > 0. Wears `reg`: the turn across it, the length down it. */
function lathe(M, part, tex, reg, p0, axis, profile, n = 12) {
  const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = cross(axis, ref);
  const l1 = Math.hypot(...e1);
  const E1 = e1.map((v) => v / l1);
  const E2 = cross(axis, E1);
  const at = (t, r, k) => {
    const a = (2 * Math.PI * k) / n;
    return [0, 1, 2].map((i) => p0[i] + axis[i] * t + E1[i] * r * Math.cos(a) + E2[i] * r * Math.sin(a));
  };
  const total = profile.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - profile[i - 1][0], q[1] - profile[i - 1][1]) : 0), 0) || 1;
  let run = 0;
  for (let i = 0; i + 1 < profile.length; i++) {
    const [t0, r0] = profile[i];
    const [t1, r1] = profile[i + 1];
    const d = Math.hypot(t1 - t0, r1 - r0);
    for (let k = 0; k < n; k++) {
      const pts = [at(t0, r0, k), at(t0, r0, k + 1), at(t1, r1, k + 1), at(t1, r1, k)];
      const mid = [0, 1, 2].map((a) => (pts[0][a] + pts[1][a] + pts[2][a] + pts[3][a]) / 4);
      const centre = [0, 1, 2].map((a) => p0[a] + axis[a] * (t0 + t1) / 2);
      const out = sub(mid, centre);
      const uv = [
        inReg(reg, k / n, run / total),
        inReg(reg, (k + 1) / n, run / total),
        inReg(reg, (k + 1) / n, (run + d) / total),
        inReg(reg, k / n, (run + d) / total),
      ];
      if (Math.hypot(...out) < 1e-9) out.splice(0, 3, ...axis.map((v) => v * Math.sign(t1 - t0 || 1)));
      M.quad(part, tex, pts, uv, Math.hypot(...out) < 1e-9 ? axis : out);
    }
    run += d;
  }
  for (const [end, sign] of [[0, -1], [profile.length - 1, 1]]) {
    const [t, r] = profile[end];
    if (r <= 0.01) continue;
    const ring = Array.from({ length: n }, (_, k) => at(t, r, k));
    M.poly(part, tex, ring, ring.map((_, k) => inReg(reg, 0.5 + 0.5 * Math.cos((2 * Math.PI * k) / n), 0.5 + 0.5 * Math.sin((2 * Math.PI * k) / n))), axis.map((v) => v * sign));
  }
}

/** A tube from a to b, r wide, n sides. */
function tube(M, part, tex, reg, a, b, r, n = 6) {
  const d = sub(b, a);
  const L = Math.hypot(...d);
  lathe(M, part, tex, reg, a, d.map((v) => v / L), [[0, r], [L, r]], n);
}

// ── the shell ──────────────────────────────────────────────────────────────
const pointOut = (sg, x, z) => [x, sg * yOut(z), z];
const pointIn = (sg, x, z) => [x, sg * yIn(z), z];

/** A rounded rectangle of an opening, counter-clockwise (x right, z up), corner radii r1 below and r2 above with k steps: { poly, br, tr, tl, bl } (each corner's points in order). */
function roundRect(x1, x2, z1, z2, r1, r2, k = 3) {
  const corner = (cx, cz, r, a0) => {
    if (r < 0.01) return [{ x: cx, z: cz }];
    return Array.from({ length: k + 1 }, (_, i) => {
      const a = a0 + ((Math.PI / 2) * i) / k;
      return { x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) };
    });
  };
  const br = corner(x2 - r1, z1 + r1, r1, -Math.PI / 2);
  const tr = corner(x2 - r2, z2 - r2, r2, 0);
  const tl = corner(x1 + r2, z2 - r2, r2, Math.PI / 2);
  const bl = corner(x1 + r1, z1 + r1, r1, Math.PI);
  return { poly: [...br, ...tr, ...tl, ...bl], br, tr, tl, bl };
}

const DOORS = [[-128, -76], [76, 128]];
const OPENINGS = {
  // [kind: "through" (open to the inside) | "recess" (a shut door), x1, x2, z1, z2, radius bottom, radius top]
  platform: [
    ["through", -128, -76, 0, 76, 0, 7],
    ["through", 76, 128, 0, 76, 0, 7],
    ["through", -62, 62, 38, 70, 7, 7],
    ["through", -178, -140, 38, 70, 6, 6],
    ["through", 140, 178, 38, 70, 6, 6],
  ],
  track: [
    ["recess", -128, -76, 0, 76, 0, 7],
    ["recess", 76, 128, 0, 76, 0, 7],
    ["through", -62, 62, 38, 70, 7, 7],
    ["through", -178, -140, 38, 70, 6, 6],
    ["through", 140, 178, 38, 70, 6, 6],
  ],
};

function hull(M, nose, side) {
  // the flank of each side, as a plane (x, z) with its openings
  for (const sg of [-1, 1]) {
    const holes = (sg < 0 ? OPENINGS.platform : OPENINGS.track).map(([kind, x1, x2, z1, z2, r1, r2]) => ({ kind, x1, x2, z1, z2, ...roundRect(x1, x2, z1, z2, r1, r2) }));
    for (const face of ["outer", "inner"]) {
      const pt = face === "outer" ? (x, z) => pointOut(sg, x, z) : (x, z) => pointIn(sg, x, z);
      const out = face === "outer" ? [0, sg, 0] : [0, -sg, 0];
      const uvO = (x, z) => [ux(x), 0.5 + rowOf(OUTER, S_OUT, z)];
      const uvI = (x, z) => [ux(x), 0.5 + rowOf(INNER, S_IN, z)];
      const uv = face === "outer" ? uvO : uvI;
      const tex = face === "outer" ? "hull" : "inner";
      const part = face === "outer" ? "shell" : "inside";
      const flat = (poly) => M.poly(part, tex, poly.map((q) => pt(q.x, q.z)), poly.map((q) => uv(q.x, q.z)), out, 1);
      const bottom = face === "outer" ? B0 : B0;
      // the strip's columns: between openings full height, through an opening the part under it and the part over it
      const cut = holes.filter((h) => face === "outer" || h.kind === "through").sort((a, b) => a.x1 - b.x1);
      let at = -HALF;
      for (const h of cut) {
        flat([{ x: at, z: bottom }, { x: h.x1, z: bottom }, { x: h.x1, z: B1 }, { x: at, z: B1 }]);
        if (h.z1 > bottom + 0.01) flat([{ x: h.x1, z: bottom }, { x: h.x2, z: bottom }, ...h.br.slice().reverse(), ...h.bl.slice().reverse()]);
        flat([...h.tr, ...h.tl, { x: h.x1, z: B1 }, { x: h.x2, z: B1 }]);
        at = h.x2;
      }
      flat([{ x: at, z: bottom }, { x: HALF, z: bottom }, { x: HALF, z: B1 }, { x: at, z: B1 }]);
    }
    // the reveals, the panels behind a shut door, the glass
    for (const h of holes) {
      const n = h.poly.length;
      const cen = [0, sg * 40, (h.z1 + h.z2) / 2];
      if (h.kind === "through") {
        for (let i = 0; i < n; i++) {
          const a = h.poly[i];
          const b = h.poly[(i + 1) % n];
          if (a.z === 0 && b.z === 0 && a.x === b.x) continue;
          const pts = [pointOut(sg, a.x, a.z), pointOut(sg, b.x, b.z), pointIn(sg, b.x, b.z), pointIn(sg, a.x, a.z)];
          const mid = [(a.x + b.x) / 2, 0, (a.z + b.z) / 2];
          const towards = [(h.x1 + h.x2) / 2 - mid[0], 0, (h.z1 + h.z2) / 2 - mid[2]];
          const bottomEdge = Math.abs(a.z - b.z) < 1e-6 && a.z < (h.z1 + h.z2) / 2;
          const uvs = pts.map((p, k) => inReg(REG.hull.trim, k === 0 || k === 3 ? 0.1 : 0.9, k < 2 ? 0.2 : 0.8));
          M.quad("shell", "hull", pts, uvs, towards);
          void bottomEdge;
        }
        if (h.z1 >= 30) {
          // the glass, in the middle of the wall, both ways
          const g = (z) => (yOut(z) + yIn(z)) / 2;
          const pts = h.poly.map((q) => [q.x, sg * g(q.z), q.z]);
          const uvs = h.poly.map((q) => [2 + ((q.x - h.x1) / (h.x2 - h.x1)) * 60, 2 + ((q.z - h.z1) / (h.z2 - h.z1)) * 60]);
          for (const o of [[0, 1, 0], [0, -1, 0]]) M.poly("shell", "glass", pts, uvs, o, 3);
        }
      } else {
        // a shut door: a panel 2.5 back, its reveal round it
        const d = 2.5;
        const back = (q) => [q.x, sg * (yOut(q.z) - d), q.z];
        const backpts = h.poly.map(back);
        for (let i = 0; i < n; i++) {
          const a = h.poly[i];
          const b = h.poly[(i + 1) % n];
          if (a.z === 0 && b.z === 0) continue;
          const pts = [pointOut(sg, a.x, a.z), pointOut(sg, b.x, b.z), back(b), back(a)];
          const towards = [(h.x1 + h.x2) / 2 - (a.x + b.x) / 2, 0, (h.z1 + h.z2) / 2 - (a.z + b.z) / 2];
          M.quad("shell", "hull", pts, pts.map((p, k) => inReg(REG.hull.trim, k % 3 === 0 ? 0.2 : 0.8, k < 2 ? 0.2 : 0.8)), towards);
        }
        M.poly("shell", "hull", backpts, h.poly.map((q) => inReg(REG.hull.door, (q.x - h.x1) / (h.x2 - h.x1), 1 - (q.z - h.z1) / (h.z2 - h.z1))), [0, sg, 0], 2);
      }
      void cen;
    }
  }
  // the skin's lower edge (the skirt's underside) and the eave's drip rail
  for (const sg of [-1, 1]) {
    const a = [-HALF, sg * 54, SKIRT];
    const b = [HALF, sg * 54, SKIRT];
    const c = [HALF, sg * (54 - WALL_IN), SKIRT];
    const d = [-HALF, sg * (54 - WALL_IN), SKIRT];
    M.quad("shell", "hull", [a, b, c, d], [a, b, c, d].map((p) => inReg(REG.hull.trim, 0.5, 0.5)), [0, 0, -1]);
    // the chamfer between skirt edge and flank (outer) and its inner twin
    for (const [P, S, tex, part] of [[OUTER, S_OUT, "hull", "shell"], [INNER, S_IN, "inner", "inside"]]) {
      const pa = P[0];
      const pb = P[1];
      const pts = [[-HALF, sg * pa.y, pa.z], [HALF, sg * pa.y, pa.z], [HALF, sg * pb.y, pb.z], [-HALF, sg * pb.y, pb.z]];
      const out = tex === "hull" ? [0, sg, -1] : [0, -sg, 1];
      M.quad(part, tex, pts, [[1, 0.5 + S[0]], [255, 0.5 + S[0]], [255, 0.5 + S[1]], [1, 0.5 + S[1]]], out, 1);
    }
    // the roof: the ellipse in 12 strips, each the length of the car (outer), and the lining under it (inner)
    for (const [P, C, S, tex, part, sgn] of [[OUTER, outerC, S_OUT, "hull", "shell", 1], [INNER, innerC, S_IN, "inner", "inside", -1]]) {
      const prev = tex === "hull" ? { y: yOut(B1), z: B1 } : { y: yIn(B1), z: B1 };
      const list = [prev, ...C];
      const s0 = tex === "hull" ? S[2] : S[2];
      let run = s0;
      for (let i = 0; i + 1 < list.length; i++) {
        const A = list[i];
        const Bp = list[i + 1];
        const d = Math.hypot(Bp.y - A.y, Bp.z - A.z);
        const pts = [[-HALF, sg * A.y, A.z], [HALF, sg * A.y, A.z], [HALF, sg * Bp.y, Bp.z], [-HALF, sg * Bp.y, Bp.z]];
        const mid = [0, sg * (A.y + Bp.y) / 2, (A.z + Bp.z) / 2];
        const centre = [0, 0, 78];
        const out = sub(mid, centre).map((v) => v * sgn);
        M.quad(part, tex, pts, [[1, 0.5 + run], [255, 0.5 + run], [255, 0.5 + run + d], [1, 0.5 + run + d]], out, 1);
        run += d;
      }
    }
  }
  // the two ends
  for (const e of [-1, 1]) {
    const cab = nose && e === 1;
    const sec = sectionPoly();
    const x = e * HALF;
    if (!cab) {
      M.poly("shell", "hull", sec.map((p) => [x, p.y, p.z]), sec.map((p) => inReg(REG.hull.end, 0.5 + p.y / 120, 1 - (p.z - SKIRT) / 114)), [e, 0, 0], 4);
      bellows(M, e);
    }
    // the inside face of the end wall, a little in from the end
    const ins = innerSectionPoly();
    M.poly("inside", "inner", ins.map((p) => [e * (HALF - 6), p.y, p.z]), ins.map((p) => inReg(REG.inner.end, 0.5 + p.y / 106, 1 - p.z / 96)), [-e, 0, 0], 5);
  }
  if (nose) cab(M);
}
/** The outer section as a closed polygon (both sides, the skirt's bottom closing it): [{ y, z }]. */
function sectionPoly() {
  const right = OUTER.map((p) => ({ y: p.y, z: p.z }));
  const left = [...OUTER].reverse().slice(1).map((p) => ({ y: -p.y, z: p.z }));
  // starting at the skirt's lower right, over the crown, to the lower left
  return [...right, ...left].filter((p, i, a) => i === 0 || Math.hypot(p.y - a[i - 1].y, p.z - a[i - 1].z) > 1e-6);
}
function innerSectionPoly() {
  const right = [{ y: yIn(0), z: 0 }, { y: yIn(B1), z: B1 }, ...innerC];
  const left = [...right].reverse().slice(1).map((p) => ({ y: -p.y, z: p.z }));
  return [...right, ...left].filter((p, i, a) => i === 0 || Math.hypot(p.y - a[i - 1].y, p.z - a[i - 1].z) > 1e-6);
}

/** The bellows of a gangway end and the coupler under it. */
function bellows(M, e) {
  const rr = roundRect(-22, 22, 4, 76, 8, 8, 3).poly.map((q) => ({ y: q.x, z: q.z }));
  const ribs = [0, 1.4, 2.8, 4.2, 5.6, 7, 8];
  const scale = [1, 1, 0.94, 1, 0.94, 1, 0.96];
  const cz = 40;
  const ring = (k) => rr.map((p) => [e * (HALF + ribs[k]), p.y * scale[k], cz + (p.z - cz) * scale[k]]);
  for (let k = 0; k + 1 < ribs.length; k++) {
    const A = ring(k);
    const B = ring(k + 1);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const mid = [0, (A[i][1] + A[j][1]) / 2, (A[i][2] + A[j][2]) / 2 - cz];
      M.quad("gear", "gear", [A[i], A[j], B[j], B[i]], [[2, 64 + 4 + k * 4], [126, 64 + 4 + k * 4], [126, 64 + 8 + k * 4], [2, 64 + 8 + k * 4]].map((p, q) => [REG.gear.rubber.x + 2 + (q % 3 === 0 ? 0 : 120), REG.gear.rubber.y + 2 + (q < 2 ? 0 : 6) + k * 3]), [e * 0.35, mid[1], mid[2]], 6);
    }
  }
  const last = ring(ribs.length - 1);
  M.poly("gear", "gear", last, last.map((p, i) => inReg(REG.gear.rubber, 0.2 + 0.6 * ((i * 7) % 5) / 4, 0.2 + 0.6 * ((i * 3) % 4) / 3)), [e, 0, 0], 7);
  // the coupler under it: a bar and a head
  cbox(M, "gear", "gear", REG.gear.frame, [e < 0 ? -HALF - 8 : HALF - 6, -4.5, -17], [e < 0 ? -HALF + 6 : HALF + 8, 4.5, -9.5], 1.2);
  cbox(M, "gear", "gear", REG.gear.equip, [e < 0 ? -HALF - 10 : HALF + 5, -7, -19], [e < 0 ? -HALF - 5 : HALF + 10, 7, -7.5], 1.4);
}

/** The cab: the section lofted to the front, a windscreen, a flat front with its lamps. */
function cab(M) {
  const sec = sectionPoly();
  const rings = [[HALF, 1, 1], [HALF + 7, 0.97, 0.97], [HALF + 15, 0.88, 0.86], [HALF + 22, 0.74, 0.74]];
  const at = (r, p) => [r[0], p.y * r[1], SKIRT + (p.z - SKIRT) * r[2]];
  const R = rings.map((r) => sec.map((p) => at(r, p)));
  const n = sec.length;
  for (let k = 0; k + 1 < R.length; k++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pts = [R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]];
      const a = sub(pts[1], pts[0]);
      const b = sub(pts[3], pts[0]);
      let nm = cross(a, b);
      const mid = [0, 1, 2].map((q) => (pts[0][q] + pts[1][q] + pts[2][q] + pts[3][q]) / 4);
      if (dot(nm, [0, mid[1], mid[2] - 40]) < 0) nm = nm.map((v) => -v);
      const len = Math.hypot(...nm) || 1;
      const nx = nm[0] / len;
      const glass = k === 2 && nx > 0.6 && mid[2] > 34 && Math.abs(mid[1]) < 34;
      const u0 = i / n;
      const u1 = (i + 1) / n;
      if (glass) {
        const reg = REG.hull.screen;
        M.quad("shell", "hull", pts, [inReg(reg, u0, 0), inReg(reg, u1, 0), inReg(reg, u1, 1), inReg(reg, u0, 1)], nm, 8);
      } else {
        const hullRow = (z) => 0.5 + rowOf(OUTER, S_OUT, Math.max(SKIRT, Math.min(100, z)));
        M.quad("shell", "hull", pts, pts.map((p, q) => [ux(-60 + (q === 1 || q === 2 ? 20 : 0) + k * 10), hullRow(p[2])]), nm, 9);
      }
    }
  // the front: the lower body, the upper glass
  const front = R.at(-1);
  const zc = 24;
  const lower = [];
  const upper = [];
  for (let i = 0; i < n; i++) {
    const p = front[i];
    const q = front[(i + 1) % n];
    const pin = p[2] <= zc;
    const qin = q[2] <= zc;
    (pin ? lower : upper).push(p);
    if (pin !== qin) {
      const t = (zc - p[2]) / (q[2] - p[2]);
      const m = [p[0], lerp(p[1], q[1], t), zc];
      lower.push(m);
      upper.push(m);
    }
  }
  // (the polygon's lower part is one chain and its upper another; each closed along z = zc)
  const ordered = (pts) => {
    const c = pts.reduce((s, p) => [s[0] + p[1] / pts.length, s[1] + p[2] / pts.length], [0, 0]);
    return pts.slice().sort((a, b) => Math.atan2(a[2] - c[1], a[1] - c[0]) - Math.atan2(b[2] - c[1], b[1] - c[0]));
  };
  const lo = ordered(lower.filter((p, i, a) => a.findIndex((r) => r[1] === p[1] && r[2] === p[2]) === i));
  const up = ordered(upper.filter((p, i, a) => a.findIndex((r) => r[1] === p[1] && r[2] === p[2]) === i));
  M.poly("shell", "hull", lo, lo.map((p) => inReg(REG.hull.end, 0.5 + p[1] / 90, 1 - (p[2] - SKIRT) / 60)), [1, 0, 0], 10);
  M.poly("shell", "hull", up, up.map((p) => inReg(REG.hull.screen, 0.5 + p[1] / 90, 1 - (p[2] - zc) / 44)), [1, 0, 0], 11);
  const X = HALF + 22;
  // lamps: two headlamps and two tail lamps, plates in the front, the lamp texture on their faces only; a destination board over the screen
  for (const sg of [-1, 1]) {
    cbox(M, "shell", "hull", REG.hull.trim, [X - 0.5, sg * 30 - 6.5, 6], [X + 1.5, sg * 30 + 6.5, 17], 1, { "+x": ["lamp", REG.lamp.white] });
    cbox(M, "shell", "hull", REG.hull.trim, [X - 0.5, sg * 30 - 5, -6], [X + 1.2, sg * 30 + 5, 1], 0.8, { "+x": ["lamp", REG.lamp.red] });
  }
  // a crest on the front: a brass disc, domed, over the lamps' middle, and a brass hoop round the screen's foot
  lathe(M, "shell", "hull", REG.hull.trim, [X - 0.2, 0, 15], [1, 0, 0], [[0, 8.5], [0.6, 9], [1.2, 8.2], [1.6, 6.4], [2.6, 4], [3.2, 0]], 16);
  lathe(M, "shell", "hull", REG.hull.end, [X + 1.4, 0, 15], [1, 0, 0], [[0, 6.3], [0.5, 0]], 16);
  // a bumper bar under the front
  cbox(M, "shell", "gear", REG.gear.frame, [X - 6, -34, -14], [X + 3, 34, -8.5], 1.5);
}

// ── the inside ─────────────────────────────────────────────────────────────
function inside(M) {
  // the floor: a slab under the walls' lower edge, its top ribbed
  cbox(M, "inside", "inner", REG.inner.floor, [-HALF + 6, -yIn(0), -8], [HALF - 6, yIn(0), 0], 0, { "-z": ["gear", REG.gear.rubber], "+x": ["inner", REG.inner.vinyl], "-x": ["inner", REG.inner.vinyl], "+y": ["inner", REG.inner.vinyl], "-y": ["inner", REG.inner.vinyl] });
  // the bench along the track-side wall, in two lengths (the map's collision is 20 deep, 18 high, 14..176 from each end), seats of cushions
  for (const [x1, x2] of [[-178, -16], [16, 178]]) {
    const n = 4;
    const w = (x2 - x1) / n;
    const y0 = yIn(18) - 20;
    cbox(M, "inside", "inner", REG.inner.vinyl, [x1, y0 + 2, 0], [x2, y0 + 19, 11], 0.8); // the box under
    for (let i = 0; i < n; i++) {
      const a = x1 + i * w + 0.8;
      const b = x1 + (i + 1) * w - 0.8;
      cbox(M, "inside", "inner", REG.inner.seat, [a, y0 + 0.5, 11], [b, y0 + 19.5, 17.5], 2.2); // the cushion
      // the back: leaning on the wall, a cushion tilted by the wall's own lean (stepped in two pieces to keep it convex)
      cbox(M, "inside", "inner", REG.inner.back, [a + 0.4, yIn(26) - 3.8, 16], [b - 0.4, yIn(26) - 0.6, 35], 1.4);
    }
  }
  // the poles at the doors and a handrail along the crown's side
  for (const x of [-64, 64]) {
    for (const y of [-32, 22]) tube(M, "inside", "inner", REG.inner.steel, [x, y, 0], [x, y, 92], 1.6, 8);
  }
  for (const y of [-32, 22]) tube(M, "inside", "inner", REG.inner.steel, [-150, y, 85], [150, y, 85], 1.3, 6);
  for (const x of [-150, 150]) for (const y of [-32, 22]) tube(M, "inside", "inner", REG.inner.steel, [x, y, 85], [x, y, 93], 1.1, 6);
  // light strips in the crown (their underside the lamp, the rest the lining's)
  for (const cx of [-80, 80]) {
    cbox(M, "inside", "inner", REG.inner.end, [cx - 56, -8, 94.3], [cx + 56, 8, 95.6], 0.6, { "-z": ["lamp", REG.lamp.white] });
  }
  // ventilation grilles in the lining over the doors
  for (const [a, b] of DOORS) cbox(M, "inside", "inner", REG.inner.vinyl, [a + 8, -5, 94.8], [b - 8, 5, 95.9], 0.4);
  // a handle at each door's side, a bar on the end walls
  for (const e of [-1, 1]) cbox(M, "inside", "inner", REG.inner.steel, [e * (HALF - 6) - (e < 0 ? -3.4 : 0), -18, 40], [e * (HALF - 6) + (e < 0 ? 0 : -3.4), 18, 41.6], 0.5);
}

// ── under and on ───────────────────────────────────────────────────────────
function under(M) {
  for (const bx of [-130, 130]) {
    for (const ax of [bx - 18, bx + 18]) {
      for (const sg of [-16, 16]) {
        // a wheel: the tread, the chamfered rim, the flange; its axis along y
        const y0 = sg - 2.6;
        lathe(M, "gear", "gear", REG.gear.wheel, [ax, y0, -21.5], [0, 1, 0], [[0, 8.5], [0.6, 12], [1.2, 12.9], [1.9, 12], [4.4, 12], [5.2, 12.9], [5.2, 8.5]], 14);
      }
      tube(M, "gear", "gear", REG.gear.frame, [ax, -20, -21.5], [ax, 20, -21.5], 2.6, 8);
    }
    // the side frames (inside the wheels), a cross bolster, the springs on the axle boxes
    for (const sg of [-9.5, 9.5]) {
      cbox(M, "gear", "gear", REG.gear.frame, [bx - 28, sg - 3, -19], [bx + 28, sg + 3, -13], 1.2);
      for (const dx of [-18, 18]) lathe(M, "gear", "gear", REG.gear.rubber, [bx + dx, sg, -13], [0, 0, 1], [[0, 3], [5, 3]], 6);
    }
    cbox(M, "gear", "gear", REG.gear.frame, [bx - 5, -12, -17], [bx + 5, 12, -10], 1.2);
    cbox(M, "gear", "gear", REG.gear.equip, [bx - 10, -24, -13.5], [bx + 10, -14, -8.2], 1); // a motor's housing
    cbox(M, "gear", "gear", REG.gear.equip, [bx - 10, 14, -13.5], [bx + 10, 24, -8.2], 1);
  }
  // the boxes under the floor between the bogies, and the air tank
  cbox(M, "gear", "gear", REG.gear.equip, [-75, -34, -22], [-18, -4, -8], 1.6);
  cbox(M, "gear", "gear", REG.gear.equip, [20, 4, -22], [78, 34, -8], 1.6);
  cbox(M, "gear", "gear", REG.gear.equip, [-70, 8, -18], [-30, 30, -8], 1.2);
  lathe(M, "gear", "gear", REG.gear.frame, [-12, -22, -15], [1, 0, 0], [[0, 0], [1.5, 5.5], [20, 5.5], [21.5, 0]], 10);
  // brass mouldings along the flanks at 11 and 35 (broken at the doorways), over the lacquer's painted bands
  for (const sg of [-1, 1])
    for (const z of [11, 35])
      for (const [a, b] of [[-HALF + 3, -131], [-73, 73], [131, HALF - 3]]) tube(M, "shell", "hull", REG.hull.trim, [a, sg * (yOut(z) + 0.5), z], [b, sg * (yOut(z) + 0.5), z], 1.3, 8);
  // a roof: the vents (two grilles and a raised housing), the gutters' lines
  for (const x of [-120, -20, 70]) cbox(M, "shell", "hull", REG.hull.roof, [x - 24, -14, 96.5], [x + 24, 14, 103], 2);
  for (const sg of [-1, 1]) tube(M, "shell", "hull", REG.hull.trim, [-HALF + 4, sg * 55.2, 78.6], [HALF - 4, sg * 55.2, 78.6], 1.4, 6);
}

// ── the model ──────────────────────────────────────────────────────────────
function build(name, { nose, mirror }) {
  const M = new Mesh();
  hull(M, nose);
  inside(M);
  under(M);
  const flipY = mirror ? -1 : 1;
  const bodyparts = ["shell", "inside", "gear"].map((part) => ({
    name: part,
    models: [
      {
        name: part,
        meshes: Object.entries(M.parts[part] ?? {}).map(([tex, tris]) => ({
          tris: tris.map((t) => (mirror ? [t[0], t[2], t[1]] : t).map((c) => ({ ...c, p: [c.p[0], c.p[1] * flipY, c.p[2]] }))),
          texture: TEX[tex],
        })),
      },
    ],
  }));
  const mdl = buildMdl({ name, bodyparts, bbmin: [-HALF - 12, -62, -36], bbmax: [HALF + 24, 62, 104], min: [-HALF - 12, -62, -36], max: [HALF + 24, 62, 104] });
  return { mdl, M };
}

function counts(M) {
  return Object.fromEntries(Object.entries(M.parts).map(([part, texes]) => [part, Object.values(texes).reduce((s, t) => s + t.length, 0)]));
}

mkdirSync(OUT, { recursive: true });
if (SHEET) mkdirSync(SHEET, { recursive: true });
let failed = false;
const FILES = { "metro_cab.mdl": { nose: true, mirror: false }, "metro_cab_m.mdl": { nose: true, mirror: true }, "metro_mid.mdl": { nose: false, mirror: false }, "metro_mid_m.mdl": { nose: false, mirror: true } };
for (const [file, o] of Object.entries(FILES)) {
  const { mdl, M } = build(file, o);
  const report = check(mdl, "goldsrc");
  console.log(`${file}: ${mdl.length} bytes; triangles ${JSON.stringify(counts(M))}`);
  for (const line of report.facts) console.log(`  ${line}`);
  for (const w of report.warnings) console.log(`  WARN ${w}`);
  for (const e of report.errors) {
    console.log(`  ERROR ${e}`);
    failed = true;
  }
  writeFileSync(join(OUT, file), mdl);
  if (SHEET && (file === "metro_cab.mdl")) {
    const shots = {
      side: { yaw: 90, pitch: 4 },
      side_far: { yaw: 270, pitch: 4 },
      three: { yaw: 35, pitch: 18 },
      three_back: { yaw: 215, pitch: 16 },
      front: { yaw: 0, pitch: 6 },
      top: { yaw: 90, pitch: 70 },
      under: { yaw: 60, pitch: -35 },
    };
    for (const [k, v] of Object.entries(shots)) {
      const img = render(mdl, { ...v, width: 1000, height: 560, zoom: 1.0 });
      writeFileSync(join(SHEET, `${k}.png`), png(img.width, img.height, img.rgba));
    }
    // from inside: the camera 50 up, at the middle, looking along the car, and across to the track side
    for (const [k, v] of Object.entries({ in_along: { target: [-120, 0, 52], yaw: 0, pitch: -3, dist: 60 }, in_cross: { target: [0, 0, 50], yaw: 90, pitch: 4, dist: 30 }, in_end: { target: [140, -10, 50], yaw: 180, pitch: 0, dist: 50 }, in_door: { target: [-102, -20, 45], yaw: 250, pitch: 0, dist: 40 } })) {
      const img = render(mdl, { ...v, width: 1000, height: 560, fov: 90 });
      writeFileSync(join(SHEET, `${k}.png`), png(img.width, img.height, img.rgba));
    }
  }
}
if (failed) process.exit(1);
console.log("PASS: the cars are written");
