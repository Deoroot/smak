// The arms a view model draws, read as measures: how long each part is against the others, which roll bones the
// rig has and whether the skin uses them, how far the skin's weights blend across the elbow and the wrist, how thick
// the limb is, how dense the mesh is at the joints. The same measures of any rig, so that a game's arms (Vermintide
// 2's, anim/vt2/arms.py) say what ours should be, as bands: the arms, as the judge is to the blows.
//
//   armOfVt2(hero, side)            a Vermintide 2 hero's arm from anim/vt2/out/arms.json (local only)
//   armOfModel(buf, side)           a GoldSrc view model's arm, at its idle's first frame
//   armMeasures(arm)                { name: value } (ARM_MEASURES says what each is)
//
// An arm: { bones: { upper, fore, hand, upperRoll?, foreRoll? }: [x, y, z] (each bone's origin: the shoulder, the
// elbow, the wrist, ...), fingers: { name: [[x, y, z], ...] } (each joint, knuckle first), palms: { name: [x, y, z] }
// (a finger's palm bone, where the rig has one), verts: [{ p, w: { part:
// weight } }] (parts: upper, upperRoll, fore, foreRoll, hand, finger: the bones above and the hand's below it; a
// vertex of none is left out), tris: [[i, j, k]], rollBones: [names] }. Units are the rig's: measures are ratios.
import { readFileSync, existsSync } from "node:fs";
import { asModel } from "./model.mjs";
import { armBones } from "./corpus.mjs";
import { fingersOf } from "./judge.mjs";
import { VT2_CACHE } from "./vt2.mjs";
import { apply34 } from "../../src/mdl.mjs";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];

// ── the arms read ────────────────────────────────────────────────────────

let vt2Arms = null;
/** The heroes anim/vt2/arms.py read (empty without the cache). */
export function vt2Heroes(cache = VT2_CACHE) {
  if (!vt2Arms) vt2Arms = existsSync(cache + "arms.json") ? JSON.parse(readFileSync(cache + "arms.json", "utf8")) : {};
  return Object.keys(vt2Arms);
}

/** A Vermintide 2 hero's arm ("R" or "L"): its bones by name (j_rightarm, j_rightarmroll, ...), its skin as read. */
export function armOfVt2(hero, side = "R", cache = VT2_CACHE) {
  vt2Heroes(cache);
  const a = vt2Arms[hero];
  if (!a) throw new Error(`no Vermintide 2 arms for ${hero}`);
  const s = side === "R" ? "right" : "left";
  const at = (n) => a.bones[n]?.p;
  const bones = { upper: at(`j_${s}arm`), fore: at(`j_${s}forearm`), hand: at(`j_${s}hand`), upperRoll: at(`j_${s}armroll`), foreRoll: at(`j_${s}forearmroll`) };
  const fingers = {};
  const palms = {};
  for (const f of FINGERS) {
    const joints = [1, 2, 3].map((k) => at(`j_${s}hand${f}${k}`)).filter(Boolean);
    if (joints.length >= 2) fingers[f] = joints;
    if (at(`j_${s}inhand${f}`)) palms[f] = at(`j_${s}inhand${f}`);
  }
  const partOf = (n) =>
    n === `j_${s}arm` ? "upper" : n === `j_${s}armroll` ? "upperRoll" : n === `j_${s}forearm` ? "fore" : n === `j_${s}forearmroll` ? "foreRoll" : n === `j_${s}hand` ? "hand" : n.startsWith(`j_${s}hand`) || n.startsWith(`j_${s}inhand`) ? "finger" : null;
  const keep = new Map();
  const verts = [];
  a.verts.forEach(([p, w], i) => {
    const parts = {};
    let total = 0;
    for (const [n, x] of Object.entries(w)) {
      const part = partOf(n);
      total += x;
      if (part) parts[part] = (parts[part] ?? 0) + x;
    }
    // a vertex mostly of this arm (not the other's, nor the shoulder's)
    const mine = Object.values(parts).reduce((x, y) => x + y, 0);
    if (mine < 0.5 * total) return;
    keep.set(i, verts.length);
    verts.push({ p, w: Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, x / mine])) });
  });
  const tris = a.tris.filter((t) => t.every((i) => keep.has(i))).map((t) => t.map((i) => keep.get(i)));
  const rollBones = Object.keys(a.bones).filter((n) => n.startsWith(`j_${s}`) && /roll$/.test(n));
  const palmBones = Object.keys(a.bones).filter((n) => n.startsWith(`j_${s}inhand`));
  return { name: `vt2 ${hero}`, bones, fingers, palms, verts, tris, rollBones, palmBones };
}

/**
 * A view model's arm at its idle's first frame: each vertex wholly its one bone's (GoldSrc has no weights) or as its
 * skin weights it (Source's). `arms`: the side's bones ({ shoulder, elbow, hand }: numbers or names) where armBones
 * cannot find them by name (The Specialists' unnamed skeleton); a shoulder not told is the elbow's parent.
 */
export function armOfModel(buf, side = "R", name = asModel(buf).name, told) {
  const info = asModel(buf);
  const list = info.bones;
  const numberOf = (b) => (typeof b === "string" ? list.findIndex((x) => x.name === b) : b);
  const arms = told ? Object.fromEntries(Object.entries(told).map(([k, b]) => [k, numberOf(b)])) : armBones(buf)[side];
  if (told && arms.shoulder === undefined && arms.elbow >= 0) arms.shoulder = list[arms.elbow].parent;
  if (arms?.hand === undefined || arms.elbow === undefined || arms.shoulder === undefined) throw new Error(`no ${side} arm in ${info.name}`);
  const idle = Math.max(0, info.sequences.findIndex((s) => /idle/i.test(s.name)));
  const rest = info.pose(idle, 0);
  const o = (b) => rest[b].map((r) => r[3]);
  const below = (b, top) => {
    for (let x = b; x >= 0; x = list[x].parent) if (x === top) return true;
    return false;
  };
  // the roll (twist) bones hanging from the upper arm or the forearm: the skin they carry turns with the limb
  const rollsOf = (top) => list.map((bn, i) => i).filter((i) => list[i].parent === top && ROLL.test(list[i].name));
  const upperRolls = rollsOf(arms.shoulder);
  const foreRolls = rollsOf(arms.elbow);
  const partOf = (b) =>
    b === arms.shoulder ? "upper" : b === arms.elbow ? "fore" : b === arms.hand ? "hand" : upperRolls.includes(b) ? "upperRoll" : foreRolls.includes(b) ? "foreRoll" : below(b, arms.hand) ? "finger" : null;
  const fingers = {};
  const palms = {};
  const palmBones = [];
  for (const [name, chain] of Object.entries(fingersOf(list, arms.hand))) {
    // the bones between the hand and a finger's own three (a palm that bends: none in Biped's hands)
    palmBones.push(...chain.slice(0, -3).map((b) => list[b].name));
    if (chain.length > 3) palms[name] = o(chain.at(-4));
    // the joints past the palm's (a finger's own bones: the last three, or as many as it has)
    const joints = chain.slice(-3).map(o);
    if (joints.length >= 2) fingers[name] = joints;
  }
  const keyOf = new Map();
  const verts = [];
  const tris = [];
  const idOf = (v) => {
    // the skin's weights by part where the model has them (Source's), else the vertex wholly its bone's (GoldSrc's)
    const w = {};
    let total = 0;
    for (const [bone, x] of v.w ?? [[v.bone, 1]]) {
      total += x;
      const part = partOf(bone);
      if (part) w[part] = (w[part] ?? 0) + x;
    }
    const mine = Object.values(w).reduce((x, y) => x + y, 0);
    // a vertex mostly of this arm (not the other's, nor the shoulder's)
    if (!mine || mine < 0.5 * total) return -1;
    for (const k of Object.keys(w)) w[k] /= mine;
    const p = apply34(rest[v.bone], v.p);
    const k = p.map((x) => x.toFixed(3)).join(",");
    if (!keyOf.has(k)) {
      keyOf.set(k, verts.length);
      verts.push({ p, w });
    }
    return keyOf.get(k);
  };
  info.bodyparts.forEach((bp, b) => {
    if (!bp.models[0]) return;
    for (const t of info.tris(b, 0)) {
      const ids = t.map(idOf);
      if (ids.every((i) => i >= 0) && new Set(ids).size === 3) tris.push(ids);
    }
  });
  const rollBones = [...upperRolls, ...foreRolls].map((b) => list[b].name);
  // a palm's bone beside the fingers' own (Source's thumbroot: the thumb's base, skinned, the finger hanging from the hand)
  palmBones.push(...list.filter((bn) => bn.parent === arms.hand && PALM.test(bn.name)).map((bn) => bn.name));
  const bones = { upper: o(arms.shoulder), fore: o(arms.elbow), hand: o(arms.hand) };
  if (upperRolls.length) bones.upperRoll = o(upperRolls[0]);
  if (foreRolls.length) bones.foreRoll = o(foreRolls[0]);
  return { name, bones, fingers, palms, verts, tris, rollBones, palmBones: [...new Set(palmBones)] };
}

// ── the measures ─────────────────────────────────────────────────────────

/** A roll bone's name: Biped's twists, Vermintide's rolls, Source's driven forearm and ulna (turned by the engine). */
const ROLL = /roll|twist|ulna|driven/i;
/** A palm's bone hanging from the hand beside the fingers: Source's thumbroot, a metacarpal. */
const PALM = /root|palm|metacarpal/i;

/** The parts that turn with the forearm and below (across the elbow), and with the hand and below (the wrist). */
const PAST_ELBOW = ["fore", "foreRoll", "hand", "finger"];
const PAST_WRIST = ["hand", "finger"];
/** Weights are averaged in slices of the limb this long (forearms) to find where a blend begins and ends. */
const SLICE = 0.04;
/** A blend is where the share past the joint goes from BLEND_FROM to BLEND_TO (of a slice's mean). */
const BLEND_FROM = 0.1;
const BLEND_TO = 0.9;
/** The joints' meshes are looked at within this much (forearms) of the joint. */
const NEAR_JOINT = 0.15;

/** Where a point lies along a segment from a to b: { t (0 at a, 1 at b), r (its distance from the line), out (the way out of the line) }. */
function along(p, a, b) {
  const ab = sub(b, a);
  const L = len(ab);
  const q = sub(p, a);
  const t = dot(q, ab) / (L * L);
  const out = sub(q, scale(ab, t));
  return { t, r: len(out), out };
}

/**
 * Where a blend between two parts runs, in forearms either side of the joint: the slices of the limb across it
 * (by the distance along the limb from the joint, `s`), each slice's mean share past the joint, and the span from
 * where that first reaches BLEND_FROM to where it first reaches BLEND_TO. A rigid skin's blend is one slice wide.
 */
function blendSpan(samples) {
  // no vertex shared between the parts: a seam, whatever pieces overlap there (a rigid skin's sleeve over its hand)
  if (samples.length && !samples.some(({ share }) => share > 0.02 && share < 0.98)) return SLICE;
  const slices = new Map();
  for (const { s, share } of samples) {
    const k = Math.floor(s / SLICE);
    const v = slices.get(k) ?? { sum: 0, n: 0 };
    v.sum += share;
    v.n++;
    slices.set(k, v);
  }
  const keys = [...slices.keys()].filter((k) => slices.get(k).n >= 3).sort((a, b) => a - b);
  const mean = (k) => slices.get(k).sum / slices.get(k).n;
  // from the far side of the joint inward: where the share first passes each mark (a slice's mean rises past the joint)
  const first = (mark) => keys.find((k) => mean(k) >= mark && keys.filter((j) => j > k).every((j) => mean(j) >= mark * 0.5));
  const a = first(BLEND_FROM);
  const b = first(BLEND_TO);
  if (a === undefined || b === undefined) return null;
  return Math.max(SLICE, (b - a + 1) * SLICE);
}

/** A cross-section's width over its thickness: its points' ways out of the limb's line (axis), widest spread over narrowest. */
function flatness(outs, axis) {
  if (outs.length < 6) return null;
  const n1 = unit(Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0]));
  const n2 = cross(axis, n1);
  let [xx, xy, yy] = [0, 0, 0];
  for (const o of outs) {
    const [x, y] = [dot(o, n1), dot(o, n2)];
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const tr = xx + yy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (xx * yy - xy * xy)));
  const [big, small] = [tr / 2 + disc, tr / 2 - disc];
  return small > 1e-12 ? Math.sqrt(big / small) : null;
}

/** An arm's measures (ARM_MEASURES). */
export function armMeasures(arm) {
  const { upper, fore, hand } = arm.bones;
  const F = len(sub(hand, fore));
  const U = len(sub(fore, upper));
  const out = {};
  const put = (k, v) => {
    if (v !== null && v !== undefined && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
  };

  // ── proportions: the skeleton ──
  put("prop.foreOverUpper", F / U);
  const knuckle = arm.fingers.middle?.[0] ?? arm.fingers.index?.[0];
  const H = knuckle ? len(sub(knuckle, hand)) : null;
  if (H) put("prop.handOverFore", H / F);
  // a finger's length: knuckle to its end (the farthest vertex of the finger's own along its last segment's way)
  const fingerLength = (f) => {
    const j = arm.fingers[f];
    if (!j) return null;
    let L = 0;
    for (let i = 1; i < j.length; i++) L += len(sub(j[i], j[i - 1]));
    const way = unit(sub(j.at(-1), j.at(-2)));
    let past = 0;
    for (const v of arm.verts) {
      if (!(v.w.finger > 0.5)) continue;
      const d = sub(v.p, j.at(-1));
      const t = dot(d, way);
      // within the finger's width of its line
      if (t > 0 && len(sub(d, scale(way, t))) < 0.5 * len(sub(j.at(-1), j.at(-2)))) past = Math.max(past, t);
    }
    return L + past;
  };
  if (H) {
    put("prop.fingerOverHand", fingerLength("middle") / H);
    put("prop.thumbOverHand", fingerLength("thumb") / H);
    if (arm.fingers.index && arm.fingers.pinky) put("prop.palmOverHand", len(sub(arm.fingers.index[0], arm.fingers.pinky[0])) / H);
  }

  // ── roll bones: the rig's, and whether the skin follows them ──
  const skinned = (part) => arm.verts.filter((v) => (v.w[part] ?? 0) > 0.1).length;
  put("rig.rollBones", arm.rollBones.length);
  put("rig.palmBones", arm.palmBones?.length ?? 0);
  put("rig.rollSkinned", ["upperRoll", "foreRoll"].filter((p) => arm.bones[p] && skinned(p) > 0).length);
  if (arm.bones.foreRoll) put("rig.foreRollAt", along(arm.bones.foreRoll, fore, hand).t);
  if (arm.bones.upperRoll) put("rig.upperRollAt", along(arm.bones.upperRoll, upper, fore).t);
  // a palm bone's place from the wrist to its finger's first knuckle, the median of the fingers'
  put("rig.palmAt", median(Object.entries(arm.palms ?? {}).filter(([f]) => arm.fingers[f]).map(([f, p]) => len(sub(p, hand)) / len(sub(arm.fingers[f][0], hand)))));

  // ── the skin across the joints ──
  // each vertex of the limb by where it lies: on the upper arm or the forearm, its distance along the limb from
  // the elbow and from the wrist (forearms)
  const limb = [];
  for (const v of arm.verts) {
    const a = along(v.p, upper, fore);
    const b = along(v.p, fore, hand);
    // nearest the upper arm's segment or the forearm's (or past the wrist, the hand's)
    const onUpper = a.t <= 1 && (b.t < 0 || a.r < b.r);
    const sElbow = onUpper ? (a.t - 1) * (U / F) : b.t;
    const r = onUpper ? a.r : b.r;
    limb.push({ v, onUpper, sElbow, sWrist: b.t - 1, r, out: onUpper ? a.out : b.out });
  }
  const share = (v, parts) => parts.reduce((x, p) => x + (v.w[p] ?? 0), 0);
  // the elbow: vertices within half a forearm of it, either side; the wrist: from half a forearm up the forearm to
  // the knuckles (no fingers: a finger's skin is its own)
  const elbow = limb.filter((l) => Math.abs(l.sElbow) < 0.5 && !l.v.w.finger).map((l) => ({ s: l.sElbow, share: share(l.v, PAST_ELBOW) }));
  // (the palm's vertices too: a rig with palm bones keeps them there, and they turn with the hand)
  const wrist = limb.filter((l) => !l.onUpper && l.sWrist > -0.5 && (!H || l.sWrist * F < 0.6 * H)).map((l) => ({ s: l.sWrist, share: share(l.v, PAST_WRIST) }));
  put("skin.elbowBlend", blendSpan(elbow));
  put("skin.wristBlend", blendSpan(wrist));
  // how many bones a vertex of the limb (above the knuckles) follows, on average
  const bodyVerts = limb.filter((l) => !(l.v.w.finger > 0.5) && (l.onUpper || l.sWrist < 0));
  put("skin.influences", bodyVerts.length ? bodyVerts.reduce((x, l) => x + Object.values(l.v.w).filter((w) => w > 0.05).length, 0) / bodyVerts.length : null);
  // the forearm's twist as the skin spreads it: a forearm roll bone's share of the forearm's vertices (0: none)
  const foreVerts = limb.filter((l) => !l.onUpper && l.sElbow > 0.2 && l.sWrist < -0.2);
  put("skin.foreRollShare", foreVerts.length ? foreVerts.reduce((x, l) => x + (l.v.w.foreRoll ?? 0), 0) / foreVerts.length : null);

  // ── the limb's shape: how thick, how flat at the wrist ──
  const radiusAt = (pick) => median(limb.filter(pick).map((l) => l.r)) ?? NaN;
  put("shape.upperThick", radiusAt((l) => l.onUpper && Math.abs(l.sElbow * (F / U) + 0.5) < 0.1) / F);
  put("shape.elbowThick", radiusAt((l) => !l.onUpper && Math.abs(l.sElbow - 0.1) < 0.06) / F);
  put("shape.foreThick", radiusAt((l) => !l.onUpper && Math.abs(l.sElbow - 0.5) < 0.06) / F);
  put("shape.wristThick", radiusAt((l) => !l.onUpper && Math.abs(l.sWrist + 0.08) < 0.05) / F);
  put("shape.wristFlat", flatness(limb.filter((l) => !l.onUpper && Math.abs(l.sWrist + 0.08) < 0.05).map((l) => l.out), unit(sub(hand, fore))));

  // ── the mesh at the joints: its edges' length there (forearms; shorter is denser), and against mid-forearm's ──
  const edgesNear = (pick) => {
    const ls = [];
    for (const t of arm.tris)
      for (let i = 0; i < 3; i++) {
        const [a, b] = [t[i], t[(i + 1) % 3]];
        if (a < b && pick(limb[a]) && pick(limb[b])) ls.push(len(sub(arm.verts[a].p, arm.verts[b].p)) / F);
      }
    return median(ls);
  };
  const mid = edgesNear((l) => !l.onUpper && Math.abs(l.sElbow - 0.5) < 0.15 && !l.v.w.finger);
  const atElbow = edgesNear((l) => Math.abs(l.sElbow) < NEAR_JOINT && !l.v.w.finger);
  const atWrist = edgesNear((l) => !l.onUpper && Math.abs(l.sWrist) < NEAR_JOINT && !(l.v.w.finger > 0.5));
  const atKnuckles = edgesNear((l) => (l.v.w.finger ?? 0) > 0.5);
  put("mesh.foreEdge", mid);
  put("mesh.elbowEdge", atElbow);
  put("mesh.wristEdge", atWrist);
  put("mesh.fingerEdge", atKnuckles);
  if (mid && atWrist) put("mesh.wristDense", mid / atWrist);
  if (mid && atElbow) put("mesh.elbowDense", mid / atElbow);
  put("mesh.tris", arm.tris.length);
  return out;
}

/**
 * What each measure is (units: x a ratio, forearms, count). `tol`: what a band is widened by either side; `least`: only
 * fewer than the band is out (a rig with more bones than the reference's can still move as it does).
 */
export const ARM_MEASURES = {
  "prop.foreOverUpper": { unit: "x", what: "forearm over upper arm (elbow to wrist, shoulder to elbow)", tol: 0.05 },
  "prop.handOverFore": { unit: "x", what: "hand (wrist to the middle knuckle) over forearm", tol: 0.04 },
  "prop.fingerOverHand": { unit: "x", what: "middle finger (knuckle to its end) over hand", tol: 0.08 },
  "prop.thumbOverHand": { unit: "x", what: "thumb (its first joint to its end) over hand", tol: 0.08 },
  "prop.palmOverHand": { unit: "x", what: "palm's width (index knuckle to pinky knuckle) over hand", tol: 0.06 },
  "rig.rollBones": { unit: "count", what: "roll bones of the arm (upper arm, forearm): a twist spread along the limb", tol: 0, least: true },
  "rig.palmBones": { unit: "count", what: "palm bones between the hand and the fingers (a palm that cups round a handle)", tol: 0, least: true },
  "rig.palmAt": { unit: "x", what: "where the palm bones sit, wrist (0) to their finger's first knuckle (1): the median finger's", tol: 0.05, info: true },
  "rig.rollSkinned": { unit: "count", what: "roll bones the skin uses", tol: 0, info: true },
  "rig.foreRollAt": { unit: "x", what: "where the forearm's roll bone sits, elbow (0) to wrist (1)", tol: 0.05, info: true },
  "rig.upperRollAt": { unit: "x", what: "where the upper arm's roll bone sits, shoulder (0) to elbow (1)", tol: 0.05, info: true },
  "skin.elbowBlend": { unit: "forearms", what: "how far the skin blends upper arm into forearm across the elbow (10% to 90%)", tol: 0.04 },
  "skin.wristBlend": { unit: "forearms", what: "how far the skin blends forearm into hand across the wrist (10% to 90%): the wrist's twist and bend spread", tol: 0.04 },
  "skin.influences": { unit: "x", what: "bones a vertex of the arm follows, on average", tol: 0.1 },
  "skin.foreRollShare": { unit: "x", what: "the forearm roll bone's mean weight on the forearm's middle", tol: 0.05, info: true },
  "shape.upperThick": { unit: "forearms", what: "upper arm's radius at its middle", tol: 0.02 },
  "shape.elbowThick": { unit: "forearms", what: "forearm's radius by the elbow", tol: 0.02 },
  "shape.foreThick": { unit: "forearms", what: "forearm's radius at its middle", tol: 0.02 },
  "shape.wristThick": { unit: "forearms", what: "radius by the wrist", tol: 0.02 },
  "shape.wristFlat": { unit: "x", what: "the wrist's width over its thickness", tol: 0.1 },
  "mesh.foreEdge": { unit: "forearms", what: "edge length mid-forearm", tol: 0.01, info: true },
  "mesh.elbowEdge": { unit: "forearms", what: "edge length at the elbow (shorter: more rings to bend)", tol: 0.01 },
  "mesh.wristEdge": { unit: "forearms", what: "edge length at the wrist (shorter: more rings to bend and twist)", tol: 0.01 },
  "mesh.fingerEdge": { unit: "forearms", what: "edge length on the fingers", tol: 0.005 },
  // (Vermintide 2's joints are no denser than its forearm's middle, 0.3 to 1.3: its meshes are fine all over)
  "mesh.wristDense": { unit: "x", what: "how much denser the wrist's mesh is than mid-forearm's", tol: 0.1, info: true },
  "mesh.elbowDense": { unit: "x", what: "how much denser the elbow's mesh is than mid-forearm's", tol: 0.1, info: true },
  "mesh.tris": { unit: "count", what: "triangles of the arm (its own budget: shown, not judged)", tol: 0, info: true },
};
