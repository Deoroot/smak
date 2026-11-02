// The game's own first-person animations, read as measures: each view model's sequences, and for a weapon
// held in it the path of its grip and its tip, frame by frame, with both arms' joints.
//
// SPACE. Everything is in the view model's own space, which the engine sets at the eye: the client puts the
// view entity's origin at the player's eye (simorg + viewheight) and gives it the view's angles, so
//   +x  forward, away from the eye (the depth of a point)
//   +y  LEFT on screen (right is -y)
//   +z  up
// with the origin 1 unit below the eye (view.cpp's `view->origin[2] -= 1`); bob (0 standing still) and
// the idle sway move it a little more. A point's place from the eye is [x, y, z - 1].
//
//   const buf = readFileSync("v_1hswords.mdl");
//   sequenceList(buf)                                // [{ index, name, frames, fps, loops, events }]
//   const path = weaponPath(buf, { submodel: 0, seq: "attack1" });
//   path.frames[18].tip                              // [x, y, z] of the short sword's point at frame 18
//   blowOf(path, 0.6)                                // the hit frame of a 0.6 s delay, depth there, peaks
import { readdirSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readMdl,
  readMesh,
  bones as bonesOf,
  sequences,
  sequenceAt,
  events as eventsOf,
  poseAt,
  apply34,
} from "../../src/mdl.mjs";
import { asModel } from "./model.mjs";
import { familyOf, edgeOf, fingersOf } from "./judge.mjs";

/** anim/corpus: what the corpus tools write. */
const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");

/** Where the game keeps its view models (MSR's install). */
export const VIEWMODELS = "C:/Juegos/MSR/msr/models/viewmodels";
/** The view model sits this far below the eye (msc/game/client/view.cpp:705). */
export const EYE_ABOVE_ORIGIN = 1;

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(...a);
const round = (a, places = 2) => a.map((v) => Number(v.toFixed(places)));

/** The view models in a folder: [{ name, file }]. */
export const viewModelFiles = (dir = VIEWMODELS) =>
  readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".mdl"))
    .sort()
    .map((f) => ({ name: f.replace(/\.mdl$/i, ""), file: join(dir, f) }));

/**
 * A model's sequences as the engine plays them: frame n is shown at n / fps seconds (the client's
 * `(time - animtime) * framerate * fps`), so a sequence lasts (frames - 1) / fps before it holds or loops.
 * Events carry their frame and that frame's moment.
 */
export function sequenceList(buf) {
  const M = asModel(buf);
  return M.sequences.map((s, index) => ({
    index,
    name: s.name,
    frames: s.frames,
    fps: s.fps,
    loops: s.loops,
    seconds: Number(((s.frames - 1) / s.fps).toFixed(4)),
    activity: s.activity,
    events: M.events(index).map((e) => ({
      frame: e.frame,
      time: Number((e.frame / s.fps).toFixed(4)),
      event: e.event,
      options: e.options,
    })),
  }));
}

/** The model's bodyparts with their submodels' names and vertex counts. */
export const bodypartList = (buf) =>
  asModel(buf).bodyparts.map((bp, index) => ({
    index,
    name: bp.name,
    base: bp.base,
    submodels: bp.models.map((m, i) => ({ index: i, name: m.name, verts: m.numverts })),
  }));

/** Every distinct vertex of one submodel: [{ p (in its bone's space), bone }]. */
function vertsOf(buf, info, bodypart, submodel) {
  return asModel(buf).verts(bodypart, submodel);
}

// The arms' joints by name. View models come with three kinds of skeleton: 3ds Max's Biped ("Bip01 R
// Forearm", also under the prefixes "sBip01", "1 " and "Hands biped"), and the old Half-Life arms (RArm1
// the upper arm, RArm2 the forearm, RHand; Half-Life's v_crowbar names them "Bip01 R Arm1", "Bip01 R Arm2"). The
// elbow is the forearm's root, the shoulder the upper arm's.
// Source's ValveBiped joins them with underscores ("ValveBiped.Bip01_R_Forearm").
const ROLES = {
  hand: [/(?:^|\s)([RL]) Hand$/, /^([RL])Hand$/, /Bip01_([RL])_Hand$/],
  elbow: [/(?:^|\s)([RL]) Forearm$/, /^([RL]) ?Arm2$/, /\s([RL]) Arm2$/, /Bip01_([RL])_Forearm$/],
  shoulder: [/(?:^|\s)([RL]) UpperArm$/, /^([RL]) ?Arm1$/, /\s([RL]) Arm1$/, /Bip01_([RL])_UpperArm$/],
};

/**
 * The arms' bones: { R: { hand, elbow, shoulder }, L: {...} } (bone numbers, absent when the model has no
 * such arm). Where a model has two skeletons (v_2hblunts has Biped and the old arms, v_book a second "s"
 * Biped), the one wearing the most vertices is taken.
 */
export function armBones(buf, { bodypart = 0, submodel = 0 } = {}) {
  const info = asModel(buf);
  const list = info.bones;
  // vertices worn by each bone and below it, over every bodypart's first submodel and the weapon asked for
  const own = new Array(list.length).fill(0);
  info.bodyparts.forEach((bp, b) => {
    const m = b === bodypart ? submodel : 0;
    if (bp.models[m]) for (const v of vertsOf(buf, info, b, m)) own[v.bone]++;
  });
  const below = [...own];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].parent >= 0) below[list[i].parent] += below[i];
  const arms = { R: {}, L: {} };
  for (const [role, patterns] of Object.entries(ROLES))
    for (const side of ["R", "L"]) {
      let best = -1;
      list.forEach((bone, i) => {
        const hit = patterns.some((re) => re.exec(bone.name)?.[1] === side);
        if (hit && (best < 0 || below[i] > below[best])) best = i;
      });
      if (best >= 0) arms[side][role] = best;
    }
  return arms;
}

/** The body's own bones, Biped's and the old arms': what a weapon is not. */
const BODY = /bip01|biped|^\d [RL] |^(main|[RL](arm|hand|thumb|index|mid|fore|pinky)\d*)$/i;

/** Biped's head carries a dummy (Dummy08 > Bone02) that a few arm vertices are left on: body, not weapon. */
function hangsFromHead(list, bone) {
  for (let b = list[bone].parent; b >= 0; b = list[b].parent) if (/head/i.test(list[b].name)) return true;
  return false;
}

/** Is `bone` below `top` in the skeleton (or `top` itself)? */
function isBelow(list, bone, top) {
  for (let b = bone; b >= 0; b = list[b].parent) if (b === top) return true;
  return false;
}

/** The pose a weapon's tip is looked for in: the first frame of the first idle, else of the first sequence. */
const restSequence = (buf) => Math.max(0, asModel(buf).sequences.findIndex((s) => /idle/i.test(s.name)));

/**
 * A weapon submodel as it is held: the bone most of its vertices hang from (`bone`), the hand that holds it
 * (the hand above that bone, else the nearest at rest), its `tip` (the vertex farthest from the wrist, in its
 * own bone's space, so it is carried by that bone in every frame), its `butt` (the vertex farthest from the
 * tip) and its `grip` (the point of the butt-tip line nearest the wrist, carried by the tip's bone): where
 * the fist closes on the handle. `length` is butt to tip.
 */
export function weaponOf(buf, { bodypart = 0, submodel = 0, arms = armBones(buf, { bodypart, submodel }) } = {}) {
  const info = asModel(buf);
  const list = info.bones;
  const all = vertsOf(buf, info, bodypart, submodel);
  if (!all.length) return { bodypart, submodel, empty: true };
  // a weapon submodel often carries the arms too (v_1hswords' new_shortsword is arms and sword): the weapon
  // is what hangs from bones that are not the body's; a weapon worn on the body's bones (gauntlets) is all.
  // The body's bones are told by name, and on a skeleton without names (The Specialists' BoneNN) by the arms:
  // their bones and every bone above them
  const armRole = new Set(["R", "L"].flatMap((s) => ["hand", "elbow", "shoulder"].map((r) => arms[s]?.[r])).filter((b) => b !== undefined));
  const aboveArm = (b) => [...armRole].some((a) => isBelow(list, a, b));
  const bodily = (b) => BODY.test(list[b].name) || hangsFromHead(list, b) || aboveArm(b);
  let weaponish = all.filter((v) => !bodily(v.bone));
  const counts = new Map();
  for (const v of weaponish.length ? weaponish : all) counts.set(v.bone, (counts.get(v.bone) ?? 0) + 1);
  const bone = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  // below an arm, only the weapon's bone and what hangs from it are the weapon (not the fingers of either hand)
  weaponish = weaponish.filter((v) => isBelow(list, v.bone, bone) || ![...armRole].some((a) => isBelow(list, v.bone, a)));
  const verts = weaponish.length ? weaponish : all;
  const rest = info.pose(restSequence(buf), 0);
  const at = (v) => apply34(rest[v.bone], v.p);
  const centre = scale(verts.map(at).reduce(add), 1 / verts.length);
  // the holding hand: the one the weapon's bone hangs from, else the nearest to the weapon's middle
  const hands = ["R", "L"].filter((s) => arms[s].hand !== undefined);
  let side = hands.find((s) => isBelow(list, bone, arms[s].hand));
  if (!side && hands.length)
    side = hands.sort((a, b) => length(sub(rest[arms[a].hand].map((r) => r[3]), centre)) -
      length(sub(rest[arms[b].hand].map((r) => r[3]), centre)))[0];
  const wrist = side ? rest[arms[side].hand].map((r) => r[3]) : centre;
  const far = (from) => verts.reduce((best, v) => (length(sub(at(v), from)) > length(sub(at(best), from)) ? v : best));
  const tip = far(wrist);
  const butt = far(at(tip));
  const [t, b] = [at(tip), at(butt)];
  const axis = sub(t, b);
  const along = Math.max(0, Math.min(1, dot(sub(wrist, b), axis) / dot(axis, axis)));
  const grip = add(b, scale(axis, along));
  // the grip kept in the tip's bone so the three stay one rigid piece
  const inTip = toBone(rest[tip.bone], grip);
  return {
    bodypart,
    submodel,
    name: info.bodyparts[bodypart].models[submodel].name,
    verts: verts.length,
    withArms: weaponish.length > 0 && weaponish.length < all.length,
    bone,
    boneName: list[bone].name,
    bones: [...counts.keys()].map((i) => list[i].name),
    hand: side ?? null,
    tip: { bone: tip.bone, p: tip.p },
    butt: { bone: butt.bone, p: butt.p },
    grip: { bone: tip.bone, p: inTip },
    // which way its edge faces, in the tip's bone (judge.edgeOf), where its head is flat
    edge: edgeIn(rest[tip.bone], edgeOf(verts.map(at), t, b), tip.bone),
    length: Number(length(axis).toFixed(2)),
    gripFromButt: Number((along * length(axis)).toFixed(2)),
  };
}

/** The handle is cut across at the grip and this share of the weapon's length either side of it. */
const GRIP_SPAN = 0.04;

/**
 * The sizes a hand closes round, at rest, in the model's units: { handle: the weapon's radius about its line at the
 * grip (the median distance from the line of where its triangles' edges cross planes square to it at the grip and
 * GRIP_SPAN either side: a handle's vertices are often only at its ends), finger: a finger's
 * half-thickness (the median distance of the holding hand's finger vertices from their joint's line, joint to the
 * next) }, each null where the mesh has none. The fingers are looked for in the weapon's submodel, then in each
 * bodypart's first.
 */
export function handSizes(buf, { bodypart = 0, submodel = 0, arms = armBones(buf, { bodypart, submodel }), weapon = weaponOf(buf, { bodypart, submodel, arms }) } = {}) {
  const info = asModel(buf);
  const list = info.bones;
  const rest = info.pose(restSequence(buf), 0);
  const at = (v) => apply34(rest[v.bone], v.p);
  const o = (b) => rest[b].map((r) => r[3]);
  const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  let handle = null;
  if (!weapon.empty) {
    const pt = (q) => apply34(rest[q.bone], q.p);
    const [t, b, g] = [pt(weapon.tip), pt(weapon.butt), pt(weapon.grip)];
    const L = length(sub(t, b));
    const ax = scale(sub(t, b), 1 / L);
    const near = [];
    const ofWeapon = (v) => v.bone === weapon.bone || isBelow(list, v.bone, weapon.bone);
    for (const tri of info.tris(bodypart, submodel)) {
      if (!tri.every(ofWeapon)) continue;
      const ps = tri.map((v) => sub(at(v), g));
      const al = ps.map((p) => dot(p, ax));
      for (const cut of [-GRIP_SPAN * L, 0, GRIP_SPAN * L])
        for (let i = 0; i < 3; i++) {
          const [a, b] = [i, (i + 1) % 3];
          if ((al[a] - cut) * (al[b] - cut) >= 0 || al[a] === al[b]) continue;
          const u = (cut - al[a]) / (al[b] - al[a]);
          const p = add(ps[a], scale(sub(ps[b], ps[a]), u));
          near.push(length(sub(p, scale(ax, dot(p, ax)))));
        }
    }
    handle = median(near);
  }
  let finger = null;
  const hand = weapon.hand ? arms[weapon.hand]?.hand : undefined;
  if (hand !== undefined) {
    const joints = Object.values(fingersOf(list, hand)).flat();
    const lineOf = new Map();
    for (const j of joints) {
      const child = list.findIndex((bn) => bn.parent === j && joints.includes(list.indexOf(bn)));
      const from = o(j);
      const dir = child >= 0 ? sub(o(child), from) : sub(from, o(list[j].parent));
      if (length(dir) > 1e-6) lineOf.set(j, [from, scale(dir, 1 / length(dir))]);
    }
    const tries = [[bodypart, submodel], ...info.bodyparts.map((bp, i) => [i, 0])];
    for (const [bp, sm] of tries) {
      const d = [];
      for (const v of vertsOf(buf, info, bp, sm)) {
        const line = lineOf.get(v.bone);
        if (!line) continue;
        const q = sub(at(v), line[0]);
        d.push(length(sub(q, scale(line[1], dot(q, line[1])))));
      }
      if (d.length) {
        finger = median(d);
        break;
      }
    }
  }
  return { handle, finger };
}

/** A model-space direction in a bone's space: { bone, d } for the bone's index `bone`; null for none. */
function edgeIn(m, d, bone) {
  if (!d) return null;
  return { bone, d: [0, 1, 2].map((c) => m[0][c] * d[0] + m[1][c] * d[1] + m[2][c] * d[2]) };
}

/** A model-space point in a bone's space (the bone's matrix is rigid). */
function toBone(m, p) {
  const d = [p[0] - m[0][3], p[1] - m[1][3], p[2] - m[2][3]];
  return [0, 1, 2].map((c) => m[0][c] * d[0] + m[1][c] * d[1] + m[2][c] * d[2]);
}

/**
 * One sequence of a view model played with one weapon in it: for every frame the weapon's `tip`, `grip`,
 * `butt`, its bone's origin (`weaponBone`), and the arms' `hand` (wrist), `elbow` and `shoulder`, each side
 * R and L, all in the view model's space (see the top). `speed` is the tip's in units a second (the change
 * from the frame before to the one after), `depth` its x.
 */
export function weaponPath(buf, { bodypart = 0, submodel = 0, seq }) {
  const M = asModel(buf);
  const index = M.sequenceAt(seq);
  const s = M.sequences[index];
  if (!s) throw new Error(`no sequence ${seq}`);
  const arms = armBones(buf, { bodypart, submodel });
  const weapon = weaponOf(buf, { bodypart, submodel, arms });
  const origin = (m) => m.map((r) => r[3]);
  const frames = Array.from({ length: s.frames }, (_, frame) => {
    const pose = M.pose(index, frame);
    const joints = (role) =>
      Object.fromEntries(["R", "L"].filter((k) => arms[k][role] !== undefined).map((k) => [k, round(origin(pose[arms[k][role]]))]));
    const out = { frame, time: Number((frame / s.fps).toFixed(4)) };
    if (!weapon.empty) {
      out.tip = round(apply34(pose[weapon.tip.bone], weapon.tip.p));
      out.grip = round(apply34(pose[weapon.grip.bone], weapon.grip.p));
      out.butt = round(apply34(pose[weapon.butt.bone], weapon.butt.p));
      out.weaponBone = round(origin(pose[weapon.bone]));
    }
    out.hand = joints("hand");
    out.elbow = joints("elbow");
    out.shoulder = joints("shoulder");
    return out;
  });
  if (!weapon.empty)
    frames.forEach((f, i) => {
      const a = frames[Math.max(0, i - 1)].tip;
      const b = frames[Math.min(frames.length - 1, i + 1)].tip;
      const steps = Math.min(frames.length - 1, i + 1) - Math.max(0, i - 1);
      f.depth = f.tip[0];
      f.speed = steps ? Number(((length(sub(b, a)) / steps) * s.fps).toFixed(1)) : 0;
    });
  return { index, seq: s.name, fps: s.fps, count: s.frames, loops: s.loops, arms, weapon, frames };
}

/**
 * A blow measured against an item's timing: the frame its damage delay falls on (delay * fps, the engine's
 * frame at that moment), the tip's depth and reach (distance from the eye) there, the deepest the tip goes and
 * when, and the frame of its fastest. `delay` in seconds (MELEE_DMG_DELAY).
 */
export function blowOf(path, delay) {
  const { frames } = path;
  const at = (f) => frames[Math.min(frames.length - 1, Math.max(0, f))];
  const eye = (p) => length([p[0], p[1], p[2] - EYE_ABOVE_ORIGIN]);
  const exact = delay * path.fps;
  const hit = at(Math.round(exact));
  const deepest = frames.reduce((a, b) => (b.depth > a.depth ? b : a));
  const fastest = frames.reduce((a, b) => (b.speed > a.speed ? b : a));
  const farthest = frames.reduce((a, b) => (eye(b.tip) > eye(a.tip) ? b : a));
  return {
    seq: path.seq,
    fps: path.fps,
    frames: path.count,
    hitFrame: Number(exact.toFixed(2)),
    beyondEnd: exact > path.count - 1,
    tipDepthAtHit: hit.depth,
    tipReachAtHit: Number(eye(hit.tip).toFixed(2)),
    tipAtHit: hit.tip,
    maxDepth: deepest.depth,
    maxDepthFrame: deepest.frame,
    maxReach: Number(eye(farthest.tip).toFixed(2)),
    maxReachFrame: farthest.frame,
    peakSpeed: fastest.speed,
    peakSpeedFrame: fastest.frame,
  };
}

/** Read a view model by its name ("v_1hswords") or path. */
export const viewModel = (name, dir = VIEWMODELS) =>
  readFileSync(/[\\/]/.test(name) ? name : join(dir, name.endsWith(".mdl") ? name : `${name}.mdl`));

// ── MSR's blows ─────────────────────────────────────────────────────────────

/** The attacks that are blows: the plain swing, its charged twin, a polearm's pokes, the gauntlets'. */
const BLOWS = new Set(["melee", "special_01", "attack_poke1", "attack_poke2", "gaunt"]);
/** Sequences an attack plays that are not a blow (an idle played under a spell, a draw, a throw). */
const NOT_A_BLOW = /idle|draw|lift|warcry|throw|parry|wield|fireup|retract|sheath/i;

/** The corpus's blows, one per model, submodel and sequence: [{ model, bodypart, submodel, seq, delay, range, family, items }]. */
export function meleeBlows(modelsDir = VIEWMODELS) {
  const { items } = JSON.parse(readFileSync(join(CORPUS, "melee-items.json"), "utf8"));
  const found = new Map();
  for (const item of items) {
    if (item.base || !item.modelView) continue;
    const model = basename(item.modelView, ".mdl");
    const family = familyOf(model, item.meleeStat ?? "");
    if (!family) continue;
    for (const attack of item.attacks ?? []) {
      if (!BLOWS.has(attack.callback)) continue;
      for (const s of attack.sequences ?? []) {
        if (NOT_A_BLOW.test(s.name)) continue;
        const sub = Number(item.modelViewIdx) || 0;
        const key = `${model}|${sub}|${s.index}`;
        const entry = found.get(key) ?? { model, submodelName: item.submodel, submodel: sub, seq: s.index, seqName: s.name, family, delays: [], ranges: [], items: new Set() };
        const delay = Number(attack.delayStrike);
        const range = Number(attack.range);
        if (Number.isFinite(delay) && delay > 0) entry.delays.push(delay);
        if (Number.isFinite(range) && range > 0 && range < 1000) entry.ranges.push(range);
        entry.items.add(item.script.replace(/^items\//, "").replace(/\.script$/, ""));
        found.set(key, entry);
      }
    }
  }
  const mode = (list) => {
    if (!list.length) return null;
    const count = new Map();
    for (const x of list) count.set(x, (count.get(x) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  };
  const out = [...found.values()].map((e) => ({ ...e, delay: mode(e.delays), range: mode(e.ranges), items: [...e.items] }));
  // a model's sequence counts once however many weapons it is shown with: its submodels share its weight
  const shared = new Map();
  for (const e of out) shared.set(`${e.model}|${e.seq}`, (shared.get(`${e.model}|${e.seq}`) ?? 0) + 1);
  for (const e of out) e.weight = 1 / shared.get(`${e.model}|${e.seq}`);
  // the bodypart that holds the submodel the item names
  const parts = new Map();
  for (const e of out) {
    if (!parts.has(e.model)) parts.set(e.model, readMdl(viewModel(e.model, modelsDir)).bodyparts);
    const bps = parts.get(e.model);
    const named = bps.findIndex((bp) => bp.models[e.submodel]?.name.toLowerCase() === String(e.submodelName).toLowerCase());
    e.bodypart = named >= 0 ? named : bps.reduce((best, bp, i) => (bp.models.length > bps[best].models.length ? i : best), 0);
  }
  return out.sort((a, b) => (a.model + a.seqName + a.submodel).localeCompare(b.model + b.seqName + b.submodel));
}
