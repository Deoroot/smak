// A view model's arms fitted toward a reference game's (anim/corpus/arms-<game>.json, lib/arms.mjs): the same
// file with its arms' proportions moved into the reference's bands and the roll bones the reference has, every
// animation kept. What the judge finds out of the bands for a rig's reasons (its forearm short, no twist spread
// along the limb) the fitter mends; what is the mesh's own (how thick, how fine) it leaves, and says so.
//
//   fitArms(src, bands, { sides, steps, rollShare, split }) -> { mdl, did: [lines], factors }
//
// PROPORTIONS. Each ratio of the skeleton (forearm over upper arm, hand over forearm, finger and thumb over hand,
// the palm's width) out of its band is moved to the band's nearer edge, by reproportion (src/reproportion.mjs):
// a bone's length multiplies the places of the bones hanging from it, in every frame of every animation, with
// no animation written again. The arm keeps its reach (upper arm and forearm together as long as before), so the
// weapon in the hand ends where it did as near as a bent arm allows. GoldSrc keeps each vertex in its bone's
// space, so the pieces are stretched with their bones: a vertex's place in its bone's axes times the bone's
// factor (and its normal by the inverse, as a stretched surface turns), and the forearm's wrist end meets the
// hand again.
//
// ROLL BONES. A forearm's roll (pronation) on the hand bone alone wrings the wrist's rigid seam whole. The
// reference spreads it: Vermintide 2's skin blends across the wrist and has a roll bone half-way down the
// forearm. GoldSrc has no weights, but a triangle whose corners are on two bones is stretched between them,
// which is a blend as wide as the triangle. So a roll bone is put where the reference has one (at its foreRollAt
// of the way to the wrist), the forearm's vertices past `split` of the way moved onto it, and in every frame of
// every animation it turns about the forearm's length by `rollShare` of the hand's roll from its rest: the wrist's
// seam wrings by the rest, the forearm's middle (round, where a twist shows least) by the share. The upper arm's
// roll bone, at the reference's upperRollAt, takes the shoulder half of the upper arm and turns back against the
// upper arm's own twist by the same share, so the shoulder's seam wrings by half too. Both rest with their
// parent's axes, so a vertex moved onto one is its place less the bone's, and its normal is as it was.
import { readMdl, readTris, bones as bonesOf, sequences as sequencesOf, readSequence, replaceSequence, addBones, insertBones } from "../../src/mdl.mjs";
import { reproportion } from "../../src/reproportion.mjs";
import { qmul, qconj, qunit, qabout, qofAngles, anglesOf } from "../../src/animate.mjs";
import { armBones } from "./corpus.mjs";
import { fingersOf } from "./judge.mjs";
import { armOfModel, armMeasures, ARM_MEASURES } from "./arms.mjs";

const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => a.map((x) => x / (len(a) || 1));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** studio.h's mstudiomodel_t: where a submodel keeps its vertices and normals and the bone of each (bytes). */
const MODEL = { numverts: 80, vertinfoindex: 84, vertindex: 88, numnorms: 92, norminfoindex: 96, normindex: 100 };
/** The share of the hand's roll the forearm's roll bone takes (and the upper arm's takes back of its own twist). */
const ROLL_SHARE = 0.5;
/** The forearm's vertices this far from the elbow to the wrist and on go to its roll bone; the upper arm's up to this far from the shoulder go to its. */
const SPLIT = 0.5;
/** Where a roll bone sits when the reference does not say (Vermintide 2's: lib/arms.mjs). */
const ROLL_AT = { fore: 0.55, upper: 0.49 };
/** Where a palm bone sits from the wrist to its finger's first knuckle when the reference does not say (Vermintide 2's). */
const PALM_AT = 0.31;

/** A value's band widened by the measure's tolerance, and where it should go: itself when inside, else the nearer edge. */
function toward(value, band, key) {
  if (value === undefined || !band) return value;
  const tol = ARM_MEASURES[key]?.tol ?? 0;
  if (value >= band.low - tol && value <= band.high + tol) return value;
  return value < band.low ? band.low : band.high;
}

/** The axis (0, 1, 2) a bone's place in its parent's space lies most along. */
const mainAxis = (p) => [0, 1, 2].reduce((best, a) => (Math.abs(p[a]) > Math.abs(p[best]) ? a : best), 0);
/** A factor on one axis of a bone's own, 1 on the others. */
const onAxis = (axis, f, other) => [0, 1, 2].map((a) => (a === axis ? f : other?.[a] ?? 1));

/**
 * The factors that bring one side's proportions into the bands: { bone number: [x, y, z] }, and lines saying why.
 * `m` is the side's measures, `list` the bones, `arm` armBones' side.
 */
function proportionFactors(m, bands, list, arm, fingers) {
  const out = {};
  const did = [];
  const r0 = m["prop.foreOverUpper"];
  const r = toward(r0, bands["prop.foreOverUpper"], "prop.foreOverUpper");
  // the reach kept: U' + F' = U + F, F' / U' = r
  const fU = (1 + r0) / (1 + r);
  const fF = (r * (1 + r0)) / (r0 * (1 + r));
  if (r !== r0) did.push(`forearm over upper arm ${r0} -> ${r} (upper arm x${fU.toFixed(3)}, forearm x${fF.toFixed(3)}, reach kept)`);
  const h0 = m["prop.handOverFore"];
  const h = toward(h0, bands["prop.handOverFore"], "prop.handOverFore");
  const fH = h0 ? (h / h0) * fF : 1;
  if (h !== h0) did.push(`hand over forearm ${h0} -> ${h} (hand x${fH.toFixed(3)})`);
  const p0 = m["prop.palmOverHand"];
  const p = toward(p0, bands["prop.palmOverHand"], "prop.palmOverHand");
  const fW = p0 ? (p / p0) * fH : 1;
  if (p !== p0) did.push(`palm's width over hand ${p0} -> ${p} (across the palm x${fW.toFixed(3)})`);
  const g0 = m["prop.fingerOverHand"];
  const g = toward(g0, bands["prop.fingerOverHand"], "prop.fingerOverHand");
  const fG = g0 ? (g / g0) * fH : 1;
  if (g !== g0) did.push(`finger over hand ${g0} -> ${g} (fingers x${fG.toFixed(3)})`);
  const t0 = m["prop.thumbOverHand"];
  const t = toward(t0, bands["prop.thumbOverHand"], "prop.thumbOverHand");
  const fT = t0 ? (t / t0) * fH : 1;
  if (t !== t0) did.push(`thumb over hand ${t0} -> ${t} (thumb x${fT.toFixed(3)})`);

  const along = (b) => {
    const kids = list.map((x, i) => i).filter((i) => list[i].parent === b);
    const child = kids.find((i) => len(list[i].pos) > 1e-6);
    return child === undefined ? 0 : mainAxis(list[child].pos);
  };
  const put = (b, f) => {
    if (b !== undefined && b >= 0 && Math.abs(f - 1) > 1e-4) out[b] = onAxis(along(b), f);
  };
  put(arm.shoulder, fU);
  put(arm.elbow, fF);
  // the hand: its length along the middle knuckle's way, its width along the index-to-pinky way
  if (Math.abs(fH - 1) > 1e-4 || Math.abs(fW - 1) > 1e-4) {
    const knuckle = (f) => (fingers[f] ? list[fingers[f].at(-3) ?? fingers[f][0]].pos : null);
    const mid = knuckle("middle") ?? knuckle("index");
    const a = mid ? mainAxis(mid) : along(arm.hand);
    const ip = knuckle("index") && knuckle("pinky") ? knuckle("index").map((x, i) => x - knuckle("pinky")[i]) : null;
    const w = ip ? [0, 1, 2].filter((i) => i !== a).reduce((best, i) => (Math.abs(ip[i]) > Math.abs(ip[best]) ? i : best)) : -1;
    out[arm.hand] = [0, 1, 2].map((i) => (i === a ? fH : i === w ? fW : 1));
  }
  // a finger's own bones (the last three of its chain), each its length; the last's points stretched too
  for (const [name, chain] of Object.entries(fingers)) {
    const f = name === "thumb" ? fT : fG;
    for (const b of chain.slice(-3)) put(b, f);
  }
  return { factors: out, did };
}

/** Each submodel of the file: { at, verts, vertBones, norms, normBones, corners: [[vertex, normal]] } (offsets, for writing). */
function submodels(buf) {
  const out = [];
  for (const bp of readMdl(buf).bodyparts)
    for (const model of bp.models) {
      const i32 = (k) => buf.readInt32LE(model.at + k);
      const corners = [];
      for (const mesh of model.meshes) for (const tri of readTris(buf, mesh.triindex).tris) for (const [v, n] of tri) corners.push([v, n]);
      out.push({ numverts: i32(MODEL.numverts), numnorms: i32(MODEL.numnorms), verts: i32(MODEL.vertindex), vertBones: i32(MODEL.vertinfoindex), norms: i32(MODEL.normindex), normBones: i32(MODEL.norminfoindex), corners });
    }
  return out;
}
const vecAt = (buf, at, i) => [0, 1, 2].map((k) => buf.readFloatLE(at + 12 * i + 4 * k));
const putVec = (buf, at, i, v) => v.forEach((x, k) => buf.writeFloatLE(x, at + 12 * i + 4 * k));

/** The vertices (and normals) on each bone with a factor stretched with it, in place on a copy. */
function stretchPoints(src, factors) {
  const out = Buffer.from(src);
  for (const s of submodels(out)) {
    for (let i = 0; i < s.numverts; i++) {
      const f = factors[out[s.vertBones + i]];
      if (f) putVec(out, s.verts, i, vecAt(out, s.verts, i).map((x, k) => x * f[k]));
    }
    for (let i = 0; i < s.numnorms; i++) {
      const f = factors[out[s.normBones + i]];
      if (f) putVec(out, s.norms, i, unit(vecAt(out, s.norms, i).map((x, k) => x / f[k])));
    }
  }
  return out;
}

/**
 * Vertices moved from one bone onto bones that hang from it with its axes: `choose(p)` (the vertex's place in the
 * first bone's space) gives { to, at } (the bone, and where it rests in the first's space) or nothing; a vertex
 * moved is its place less `at`. The normals of their corners go with them (a normal goes where most of its corners'
 * vertices went). In place on a copy; how many moved onto each bone ({ bone: count }).
 */
function movePoints(src, from, choose) {
  const out = Buffer.from(src);
  const moved = {};
  for (const s of submodels(out)) {
    const went = new Int16Array(s.numverts).fill(-1);
    for (let i = 0; i < s.numverts; i++) {
      if (out[s.vertBones + i] !== from) continue;
      const p = vecAt(out, s.verts, i);
      const c = choose(p);
      if (!c) continue;
      putVec(out, s.verts, i, p.map((x, k) => x - c.at[k]));
      out[s.vertBones + i] = c.to;
      went[i] = c.to;
      moved[c.to] = (moved[c.to] ?? 0) + 1;
    }
    const votes = new Map();
    for (const [v, n] of s.corners) {
      if (out[s.normBones + n] !== from) continue;
      const tally = votes.get(n) ?? new Map();
      tally.set(went[v], (tally.get(went[v]) ?? 0) + 1);
      votes.set(n, tally);
    }
    for (const [n, tally] of votes) {
      const [best, count] = [...tally].sort((a, b) => b[1] - a[1])[0];
      const all = [...tally.values()].reduce((x, y) => x + y, 0);
      if (best >= 0 && 2 * count > all) out[s.normBones + n] = best;
    }
  }
  return { mdl: out, moved };
}

/** A turn's twist about a unit axis, in radians (-PI to PI): the part of it that turns about that axis. */
function twistAbout(q, u) {
  let t = 2 * Math.atan2(q[1] * u[0] + q[2] * u[1] + q[3] * u[2], q[0]);
  if (t > Math.PI) t -= 2 * Math.PI;
  if (t < -Math.PI) t += 2 * Math.PI;
  return t;
}

/**
 * Returns the model with its arms fitted (see the top of this file). `bands`: the reference's (arms-vt2.json's).
 *   sides      ["R", "L"]: the arms fitted (those the model has)
 *   steps      { proportions: true, palm: true, roll: true }
 *   rollShare  ROLL_SHARE; split SPLIT
 * -> { mdl, did: [lines], factors: { bone name: [x, y, z] }, palms: [{ name, moved }], rolls: [{ name, parent, moved }] }
 */
export function fitArms(src, bands, { sides = ["R", "L"], steps = {}, rollShare = ROLL_SHARE, split = SPLIT } = {}) {
  const want = { proportions: true, palm: true, roll: true, ...steps };
  let mdl = Buffer.from(src);
  const did = [];
  let arms = armBones(mdl);
  const present = sides.filter((s) => arms[s]?.hand !== undefined && arms[s].elbow !== undefined && arms[s].shoulder !== undefined);
  if (!present.length) throw new Error("fitArms: the model has no arm with a shoulder, an elbow and a hand");
  const named = {};

  // ── proportions ──
  if (want.proportions) {
    const list = bonesOf(mdl);
    const all = {};
    for (const side of present) {
      const m = armMeasures(armOfModel(mdl, side, "fit"));
      const { factors, did: why } = proportionFactors(m, bands, list, arms[side], fingersOf(list, arms[side].hand));
      Object.assign(all, factors);
      did.push(...why.map((w) => `${side}: ${w}`));
    }
    if (Object.keys(all).length) {
      const byName = Object.fromEntries(Object.entries(all).map(([b, f]) => [list[b].name, f]));
      mdl = reproportion(mdl, byName, { mirror: false, ground: false, stride: 1 }).mdl;
      mdl = stretchPoints(mdl, all);
      Object.assign(named, byName);
    }
  }

  // ── palm bones ──
  const palms = [];
  if (want.palm) {
    const at = bands["rig.palmAt"]?.median ?? PALM_AT;
    for (const side of present) {
      // one finger at a time: each bone put in moves the numbers of those after it
      const made = [];
      for (;;) {
        const list = bonesOf(mdl);
        const { hand } = armBones(mdl)[side];
        const bare = Object.entries(fingersOf(list, hand)).find(([, chain]) => chain.length <= 3 && list[chain[0]].parent === hand);
        if (!bare) break;
        const [finger, chain] = bare;
        const name = `${list[hand].name.replace(/hands*$/i, "").trim()} Palm${finger[0].toUpperCase()}${finger.slice(1)}`.replace(/s+/g, " ").slice(0, 31);
        const pos = list[chain[0]].pos.map((x) => x * at);
        mdl = insertBones(mdl, [{ name, parent: hand, pos, rot: [0, 0, 0], at: chain[0], adopt: [chain[0]] }]);
        made.push({ name, finger });
      }
      if (!made.length) continue;
      // the hand's skin past the palm bones (toward the knuckles) onto the palm bone of the nearest finger
      const list = bonesOf(mdl);
      const { hand } = armBones(mdl)[side];
      const lines = made.map(({ name }) => {
        const bone = list.findIndex((b) => b.name === name);
        const knuckle = list.findIndex((b) => b.parent === bone);
        return { bone, from: list[bone].pos, to: list[bone].pos.map((x, k) => x + list[knuckle].pos[k]) };
      });
      const mid = lines.find((l, i) => made[i].finger === "middle") ?? lines[0];
      const way = unit(mid.to);
      const reach = len(mid.to);
      const away = (p, l) => {
        const d = l.to.map((x, k) => x - l.from[k]);
        const t = Math.max(0, Math.min(1, dot(p.map((x, k) => x - l.from[k]), d) / (dot(d, d) || 1)));
        return len(p.map((x, k) => x - l.from[k] - t * d[k]));
      };
      const { mdl: next, moved } = movePoints(mdl, hand, (p) => {
        if (dot(p, way) < at * reach) return null;
        const l = lines.reduce((best, l) => (away(p, l) < away(p, best) ? l : best));
        return { to: l.bone, at: l.from };
      });
      mdl = next;
      for (const l of lines) palms.push({ name: list[l.bone].name, moved: moved[l.bone] ?? 0 });
      did.push(`${side}: ${made.length} palm bones (${made.map((m) => m.finger).join(", ")}) at ${at} of the way to the knuckles, each finger hung from its own; ${Object.values(moved).reduce((x, y) => x + y, 0)} of the hand's vertices onto them`);
    }
    arms = armBones(mdl);
  }

  // ── roll bones ──
  const rolls = [];
  if (want.roll) {
    const list = bonesOf(mdl);
    const at = (k) => bands[`rig.${k}RollAt`]?.median ?? ROLL_AT[k];
    const has = (b, re) => list.some((x) => x.parent === b && re.test(x.name));
    const adding = [];
    for (const side of present) {
      const { shoulder, elbow, hand } = arms[side];
      const stem = list[elbow].name.replace(/\s*fore\s*arm$/i, "");
      if (!has(elbow, /roll|twist/i))
        adding.push({ side, kind: "fore", parent: elbow, turner: hand, toward: hand, name: `${stem} ForeTwist`.slice(0, 31), pos: list[hand].pos.map((x) => x * at("fore")) });
      if (!has(shoulder, /roll|twist/i))
        adding.push({ side, kind: "upper", parent: shoulder, turner: shoulder, toward: elbow, name: `${stem} UpArmTwist`.slice(0, 31), pos: list[elbow].pos.map((x) => x * at("upper")) });
    }
    if (adding.length) {
      const had = list.length;
      mdl = addBones(mdl, adding.map((r) => ({ name: r.name, parent: r.parent, pos: r.pos, rot: [0, 0, 0] })));
      adding.forEach((r, k) => (r.bone = had + k));
      // the pieces: the forearm's wrist end and the upper arm's shoulder half onto their roll bones
      for (const r of adding) {
        const child = list[r.toward].pos;
        const u = unit(child);
        const L = len(child);
        const pick = r.kind === "fore" ? (p) => dot(p, u) >= split * L : (p) => dot(p, u) <= split * L;
        const { mdl: next, moved: counts } = movePoints(mdl, r.parent, (p) => (pick(p) ? { to: r.bone, at: r.pos } : null));
        const moved = counts[r.bone] ?? 0;
        mdl = next;
        rolls.push({ name: r.name, parent: list[r.parent].name, moved });
        did.push(`${r.side}: ${r.name} on ${list[r.parent].name} at ${r.kind === "fore" ? at("fore") : at("upper")} of its length, ${moved} vertices onto it`);
      }
      mdl = animateRolls(mdl, adding, rollShare);
      did.push(`roll bones turned in every frame of ${sequencesOf(mdl).length} animations by ${rollShare} of the roll`);
    }
  }
  return { mdl, did, factors: named, palms, rolls };
}

/**
 * The arms' roll bones: [{ side, kind ("fore" | "upper"), bone, parent, turner (the bone whose twist it shares: the hand,
 * or the upper arm itself), toward (the bone its limb's line runs to), pos }], those hanging from an upper arm or a
 * forearm named roll or twist. `list`: the bones (bones() of mdl.mjs); `arms`: armBones'.
 */
export function rollBonesOf(list, arms) {
  const out = [];
  for (const [side, { shoulder, elbow, hand }] of Object.entries(arms)) {
    if (shoulder === undefined || elbow === undefined || hand === undefined) continue;
    const of = (parent) => list.findIndex((b) => b.parent === parent && /roll|twist/i.test(b.name));
    const fore = of(elbow);
    const upper = of(shoulder);
    if (fore >= 0) out.push({ side, kind: "fore", bone: fore, parent: elbow, turner: hand, toward: hand, pos: list[fore].pos });
    if (upper >= 0) out.push({ side, kind: "upper", bone: upper, parent: shoulder, turner: shoulder, toward: elbow, pos: list[upper].pos });
  }
  return out;
}

/**
 * Each roll bone's turn in frames (each bone's six numbers, changed in place): the forearm's about its length by
 * `share` of the hand's roll from its rest; the upper arm's about its own by `share` of the upper arm's twist from
 * its rest, back. `list`: the bones, their rests. A twist is followed from frame to frame past half a turn (a hand
 * rolled 140 deg from its rest goes on to 190, not back to -170), so a share never jumps by half a turn.
 */
export function turnRolls(list, rolls, frames, share = ROLL_SHARE) {
  const restQ = (b) => qofAngles(list[b].rot);
  const last = new Map();
  const follow = (r, t) => {
    if (last.has(r)) t += 2 * Math.PI * Math.round((last.get(r) - t) / (2 * Math.PI));
    last.set(r, t);
    return t;
  };
  for (const values of frames)
    for (const r of rolls) {
      // the turner's turn from its rest, in its parent's axes, and its twist about the limb's line
      const now = qofAngles(values[r.turner].slice(3));
      const rel = qunit(qmul(now, qconj(restQ(r.turner))));
      // the limb's line in the roll bone's axes (its parent's): to the bone it was placed toward
      const line = unit(list[r.toward].pos);
      let turn;
      if (r.kind === "fore") turn = qabout(line, share * follow(r, twistAbout(rel, line)));
      else {
        // the upper arm's twist is about that line as its parent sees it at rest: the line turned by its rest
        const seen = qmul(qmul(restQ(r.turner), [0, ...line]), qconj(restQ(r.turner))).slice(1);
        turn = qabout(line, -share * follow(r, twistAbout(rel, seen)));
      }
      values[r.bone] = [...r.pos, ...anglesOf(qunit(turn))];
    }
  return frames;
}

/** The roll bones turned in every frame of every blend of every animation (turnRolls). */
function animateRolls(src, rolls, share) {
  let mdl = src;
  const list = bonesOf(mdl);
  for (const [q, seq] of sequencesOf(mdl).entries()) {
    const blends = Array.from({ length: Math.max(1, seq.blends) }, (_, blend) => readSequence(mdl, q, blend).frames);
    for (const frames of blends) turnRolls(list, rolls, frames, share);
    mdl = replaceSequence(mdl, q, { blends });
  }
  return mdl;
}
