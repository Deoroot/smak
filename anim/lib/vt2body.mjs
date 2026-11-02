// Vermintide 2's third person: the body other players see, its one-handed sword blows measured. The clips come from
// anim/vt2/thirdperson.py's local cache (out/attacks3p.json: each event's third-person state and clip on the hero's
// machine; out/tp_skeleton_<hero>.json; the clips in out/anim/). Nothing of the game's is in the repository: these
// are measures, and the bands made from them (anim/corpus/body-vt2.json, tools/body.mjs).
//
// How the game plays them (anim/vt2/thirdperson.py): the hero's machine has a whole-body locomotion layer (idle,
// move, land, a set per weapon: the wield event to_1h_sword sends it to the sword's) and a weapon layer above it,
// whose sword idle is empty (nothing layered) and whose attack states hold one clip each. The attack clips key the
// whole body (hips and legs too) and end on the standing idle's own pose; which bones the weapon layer lets through
// over the locomotion is not read (no bone mask was found in the machine), so the lower body is measured as the clip
// has it and named apart (body.*), and everything above the hips is measured against the hips and the head.
//
// Space: the root's (root_point) at each frame: +x right, +y ahead (the toes point there), +z up, metres. Lengths in
// forearms (elbow to wrist at the standing idle, both arms' mean) or in body heights (the head joint above the root at
// the standing idle: about the eyes' height, not the crown's); angles in degrees; times in seconds as played (the
// clip's over anim_time_scale: the third-person machine has the attack_speed variable as the first person's has).
//
// The measures of a blow (keys of `values`):
//   time.length, time.blendIn         the clip as played; the crossfade into its state
//   time.windup, .strike, .follow     the tip's speed (root space, over SPEED_SPAN) as the judge's phases: wind-up to
//                                     the strike's start (40% of the peak), strike, follow-through (down to 15%)
//   time.settle                       from the follow-through's end until the tip stays within a twentieth of a reach
//                                     of where it ends; time.hold what is left of the clip after that
//   time.peakAt                       the tip's fastest moment; time.peakVsFp: it less the first person's damage
//                                     window's middle (both as played, the same event's); time.inFp 1 inside it
//   time.chainShown                   share of the clip played before the next attack may cut in (the first person's
//                                     chain point, the template's); time.settledByChain 1 if the tip has settled by then
//   speed.tip                         the tip's peak, in body heights a second (speed.tipFa in forearms)
//   hand.reachCock, .reachHit, .reachEnd, .reachMax   the weapon wrist from its shoulder (forearms) at the strike's start,
//                                     the peak, the follow-through's end; the most
//   hand.extendHit                    that over the arm's own length at rest (upper arm + forearm): 1 straight
//   tip.reachHit                      the tip from the shoulder at the peak (forearms)
//   arc.tip, arc.hand                 degrees swept about the shoulder from the strike's start to the follow-through's end
//   height.handCock, .handHit, .handEnd, .handMin, .handMax   the wrist's height between the frame's hips (0) and head (1)
//   height.tipCock, .tipHit           the same for the tip
//   strike.down                       the tip's way through the strike: its downward share (1 straight down, -1 up)
//   strike.across                     its sideways share (+1 left to right, -1 right to left); strike.ahead (+ forward)
//   trunk.hipsYaw/.spineYaw/.headYaw  each bone's turn from the standing idle's (+ to the left, seen from above) at the
//                                     strike's start (Cock), the peak (Hit) and the range over the clip after the
//                                     crossfade (Range); trunk.twistHit (spine less hips at the peak)
//   trunk.lean*, trunk.side*          the spine's forward lean (+ forward) and side lean (+ toward the right) from the
//                                     standing idle's, at Cock, Hit, and its Range; trunk.headPitchHit the head's (+ down)
//   body.hipsTravel                   the hips' most distance from where they start, across the ground (forearms)
//   body.hipsAhead                    the hips' forward move from the clip's start to the peak (forearms)
//   body.hipsDrop                     the hips' lowest against the standing idle's (body heights; + lower)
//   body.footTravel                   the foot (toe) that moves most, its most distance from where it starts (forearms)
//   body.steps                        feet lifted and set down (each foot's toe over a tenth of a forearm up, counted once)
//   body.stanceHit                    the feet apart at the peak (forearms)
//   body.rootTravel                   the root's own motion (root motion; forearms)
//   off.travel                        the off (left) wrist's path in the hips' space (forearms); off.reachMax its most
//                                     distance from where it starts; off.heightHit its height (hips 0, head 1) at the
//                                     peak; off.aheadHit ahead of the hips (forearms); off.counter its way through
//                                     the strike against the tip's (the cosine: -1 against, +1 with; none if it hardly moves)
//   end.fromIdle                      at the clip's last frame, the tip from the standing idle's (forearms);
//                                     end.poseFromIdle the joints' mean distance (forearms); start.fromIdle and
//                                     start.poseFromIdle the same at its first frame
//
// The ready pose (the sword's standing idle, measureIdle): ready.handReach, .elbow (degrees, 180 straight), .handHeight,
// .handAhead, .handSide (+ right of the hips), ready.tipHeight, ready.bladePitch (+ up), ready.bladeYaw (+ to the
// left of ahead), ready.stance (feet apart), ready.footStagger (the right foot ahead of the left), ready.knee (degrees,
// 180 straight), ready.hipsHeight (body heights), ready.lean (hips to neck off the vertical, + forward), ready.offHeight,
// ready.offAhead, ready.offSide, ready.crouchHips (the crouched idle's hips, body heights), and the rig's own
// rig.forearm, rig.upperArm, rig.height (metres).
import { readFileSync, existsSync } from "node:fs";
import { readClip, worldAt, VT2_CACHE, chainPoint } from "./vt2.mjs";
import { band, SPEED_SPAN, STRIKE, FOLLOW } from "./judge.mjs";

const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b) || 1)))) * DEG;
const unit = (a) => {
  const l = len(a) || 1;
  return a.map((x) => x / l);
};

export const TP_BONES = {
  root: "root_point",
  hips: "j_hips",
  spine: "j_spine",
  neck: "j_neck",
  head: "j_head",
  lUpleg: "j_leftupleg",
  rUpleg: "j_rightupleg",
  lKnee: "j_leftleg",
  rKnee: "j_rightleg",
  lFoot: "j_leftfoot",
  rFoot: "j_rightfoot",
  lToe: "j_lefttoebase",
  rToe: "j_righttoebase",
  lShoulder: "j_leftarm",
  rShoulder: "j_rightarm",
  lElbow: "j_leftforearm",
  rElbow: "j_rightforearm",
  lHand: "j_lefthand",
  rHand: "j_righthand",
  rAttach: "j_rightweaponattach",
};
/** The joints the pose distances average over. */
const POSE = ["hips", "spine", "head", "lShoulder", "rShoulder", "lElbow", "rElbow", "lHand", "rHand", "lKnee", "rKnee", "lFoot", "rFoot"];

/** A rigid matrix's inverse (3x4 rows). */
const invert = (m) => {
  const r = [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
  const t = [0, 1, 2].map((i) => -(r[i][0] * m[0][3] + r[i][1] * m[1][3] + r[i][2] * m[2][3]));
  return [0, 1, 2].map((i) => [...r[i], t[i]]);
};
const mul = (a, b) => [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + (j === 3 ? a[i][3] : 0)));
const apply = (m, p) => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]);
const origin = (m) => [m[0][3], m[1][3], m[2][3]];
/** A matrix's rotation, its columns made unit (bones may carry scale). */
const rotation = (m) => {
  const c = [0, 1, 2].map((j) => unit([m[0][j], m[1][j], m[2][j]]));
  return [0, 1, 2].map((i) => [c[0][i], c[1][i], c[2][i]]);
};
const rmul = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
const rT = (a) => [0, 1, 2].map((i) => [a[0][i], a[1][i], a[2][i]]);
const rapply = (r, v) => [0, 1, 2].map((i) => r[i][0] * v[0] + r[i][1] * v[1] + r[i][2] * v[2]);

/**
 * A clip sampled: frames of { p: { joint: position }, r: { joint: rotation } } in the root's space at each frame,
 * every joint of TP_BONES, and the weapon's tip where `tip` (its place in the attach bone) is given.
 */
export function sampleClip(clip, skeleton, { fps = 60, tip = null } = {}) {
  const at = Object.fromEntries(Object.entries(TP_BONES).map(([k, n]) => [k, skeleton.names.indexOf(n)]));
  for (const [k, i] of Object.entries(at)) if (i < 0) throw new Error(`third person: no ${TP_BONES[k]} in the skeleton`);
  const n = Math.max(2, Math.round(clip.length * fps) + 1);
  const frames = [];
  for (let f = 0; f < n; f++) {
    const W = worldAt(clip, skeleton.parents, Math.min(f / fps, clip.length));
    const R = W[at.root];
    const inv = invert(R);
    const p = {};
    const r = {};
    for (const [k, i] of Object.entries(at)) {
      const m = mul(inv, W[i]);
      p[k] = origin(m);
      r[k] = rotation(m);
      if (k === "rAttach" && tip) p.tip = apply(m, tip);
    }
    frames.push({ p, r, root: origin(R) });
  }
  return frames;
}

/** The rig's own lengths from a pose (a frame of sampleClip): forearm, upper arm (both arms' mean), height. */
export function rigOf(pose) {
  const p = pose.p;
  const forearm = (len(sub(p.lHand, p.lElbow)) + len(sub(p.rHand, p.rElbow))) / 2;
  const upperArm = (len(sub(p.lElbow, p.lShoulder)) + len(sub(p.rElbow, p.rShoulder))) / 2;
  return { forearm, upperArm, height: p.head[2] };
}

/** A bone's turn from a reference rotation: yaw (+ left, from above), lean (+ forward), side (+ toward the right). */
function turnOf(r, ref) {
  const rel = rmul(r, rT(ref));
  const f = rapply(rel, [0, 1, 0]);
  const s = rapply(rel, [1, 0, 0]);
  return { yaw: Math.atan2(-f[0], f[1]) * DEG, lean: -Math.asin(Math.max(-1, Math.min(1, f[2]))) * DEG, side: -Math.asin(Math.max(-1, Math.min(1, s[2]))) * DEG };
}

/** Height between the frame's hips (0) and head (1). */
const heightOf = (pose, q) => (q[2] - pose.p.hips[2]) / (pose.p.head[2] - pose.p.hips[2] || 1);

/** A point in the frame's hips space, turned only about the vertical (the hips' heading), so ahead stays ahead. */
function inHips(pose, q) {
  const f = rapply(pose.r.hips, [0, 1, 0]);
  const yaw = Math.atan2(-f[0], f[1]);
  const d = sub(q, pose.p.hips);
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  return [c * d[0] - s * d[1], s * d[0] + c * d[1], d[2]];
}

/**
 * One blow's measures: { values, info }. `frames` from sampleClip (with the tip), `idle` a frame of the standing
 * idle (also sampled with the tip), opts: fps (sampling, of the clip's time), scale (anim_time_scale), blendIn (s),
 * fpWindow ([start, end], the first person's damage window, clip seconds), chain (the first person's chain point,
 * seconds of the action as vt2.mjs takes it), weaponLength (wrist to tip, metres, for the reach a settle is held to).
 */
export function measureBlow(frames, idle, { fps = 60, scale = 1, blendIn = 0, fpWindow = null, chain = null } = {}) {
  const rig = rigOf(idle);
  const fa = rig.forearm;
  const H = rig.height;
  const n = frames.length;
  const dt = 1 / fps / scale; // played seconds a frame
  const v = {};
  const put = (k, x) => (v[k] = x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(4)));
  const tips = frames.map((f) => f.p.tip);
  // speeds over SPEED_SPAN of played time, as the judge's
  const half = Math.max(1, Math.round(SPEED_SPAN / dt / 2));
  const speeds = tips.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    return b > a ? len(sub(tips[b], tips[a])) / ((b - a) * dt) : 0;
  });
  // the crossfade's frames are mixed with the pose before: the peak is looked for after them
  const from = Math.min(n - 1, Math.round(blendIn / dt));
  let peak = from;
  for (let i = from; i < n; i++) if (speeds[i] > speeds[peak]) peak = i;
  const top = speeds[peak] || 1e-9;
  let a = peak;
  while (a > 0 && speeds[a - 1] >= STRIKE * top) a--;
  let b = peak;
  while (b < n - 1 && speeds[b + 1] >= STRIKE * top) b++;
  let c = b;
  while (c < n - 1 && speeds[c + 1] >= FOLLOW * top) c++;
  const reach = rig.upperArm + rig.forearm + len(sub(idle.p.tip, idle.p.rHand));
  let settled = n - 1;
  while (settled > c && len(sub(tips[settled - 1], tips[n - 1])) <= 0.05 * reach) settled--;
  put("time.length", (n - 1) * dt);
  put("time.blendIn", blendIn);
  put("time.windup", a * dt);
  put("time.strike", (b - a + 1) * dt);
  put("time.follow", (c - b) * dt);
  put("time.settle", (settled - c) * dt);
  put("time.hold", (n - 1 - settled) * dt);
  put("time.peakAt", peak * dt);
  if (fpWindow && fpWindow[0] !== null && fpWindow[1] !== null) {
    const mid = (fpWindow[0] + fpWindow[1]) / 2 / scale;
    put("time.peakVsFp", peak * dt - mid);
    put("time.inFp", peak * dt >= fpWindow[0] / scale - 1e-9 && peak * dt <= fpWindow[1] / scale + 1e-9 ? 1 : 0);
  }
  if (chain !== null) {
    const cut = chain / scale;
    put("time.chainShown", Math.min(1, cut / ((n - 1) * dt)));
    put("time.settledByChain", settled * dt <= cut ? 1 : 0);
  }
  put("speed.tip", top / H);
  put("speed.tipFa", top / fa);

  // ── the weapon hand's path ──
  const P = (i, k) => frames[i].p[k];
  const fromShoulder = (i) => len(sub(P(i, "rHand"), P(i, "rShoulder"))) / fa;
  put("hand.reachCock", fromShoulder(a));
  put("hand.reachHit", fromShoulder(peak));
  put("hand.reachEnd", fromShoulder(c));
  let most = 0;
  for (let i = from; i < n; i++) most = Math.max(most, fromShoulder(i));
  put("hand.reachMax", most);
  put("hand.extendHit", (fromShoulder(peak) * fa) / (rig.upperArm + rig.forearm));
  put("tip.reachHit", len(sub(P(peak, "tip"), P(peak, "rShoulder"))) / fa);
  const swept = (k) => {
    let s = 0;
    for (let i = a + 1; i <= c; i++) s += angle(sub(P(i - 1, k), P(i - 1, "rShoulder")), sub(P(i, k), P(i, "rShoulder")));
    return s;
  };
  put("arc.tip", swept("tip"));
  put("arc.hand", swept("rHand"));
  const h = (i, k) => heightOf(frames[i], P(i, k));
  put("height.handCock", h(a, "rHand"));
  put("height.handHit", h(peak, "rHand"));
  put("height.handEnd", h(c, "rHand"));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i < n; i++) (lo = Math.min(lo, h(i, "rHand"))), (hi = Math.max(hi, h(i, "rHand")));
  put("height.handMin", lo);
  put("height.handMax", hi);
  put("height.tipCock", h(a, "tip"));
  put("height.tipHit", h(peak, "tip"));
  const way = sub(P(b, "tip"), P(a, "tip"));
  const wl = len(way) || 1;
  put("strike.down", -way[2] / wl);
  put("strike.across", way[0] / wl);
  put("strike.ahead", way[1] / wl);

  // ── the trunk ──
  const turns = frames.map((f) => ({ hips: turnOf(f.r.hips, idle.r.hips), spine: turnOf(f.r.spine, idle.r.spine), head: turnOf(f.r.head, idle.r.head) }));
  const range = (get) => {
    let l = Infinity;
    let u = -Infinity;
    for (let i = from; i < n; i++) (l = Math.min(l, get(i))), (u = Math.max(u, get(i)));
    return u - l;
  };
  for (const k of ["hips", "spine", "head"]) {
    put(`trunk.${k}YawCock`, turns[a][k].yaw);
    put(`trunk.${k}YawHit`, turns[peak][k].yaw);
    put(`trunk.${k}YawRange`, range((i) => turns[i][k].yaw));
  }
  put("trunk.twistHit", turns[peak].spine.yaw - turns[peak].hips.yaw);
  put("trunk.leanCock", turns[a].spine.lean);
  put("trunk.leanHit", turns[peak].spine.lean);
  put("trunk.leanRange", range((i) => turns[i].spine.lean));
  put("trunk.sideCock", turns[a].spine.side);
  put("trunk.sideHit", turns[peak].spine.side);
  put("trunk.sideRange", range((i) => turns[i].spine.side));
  put("trunk.headPitchHit", turns[peak].head.lean);

  // ── the hips and legs, as the clip has them ──
  const flat = (q) => [q[0], q[1], 0];
  let hipsTravel = 0;
  let hipsLow = Infinity;
  let footTravel = 0;
  let rootTravel = 0;
  for (let i = 0; i < n; i++) {
    hipsTravel = Math.max(hipsTravel, len(sub(flat(P(i, "hips")), flat(P(0, "hips")))));
    if (i >= from) hipsLow = Math.min(hipsLow, P(i, "hips")[2]);
    footTravel = Math.max(footTravel, len(sub(P(i, "lToe"), P(0, "lToe"))), len(sub(P(i, "rToe"), P(0, "rToe"))));
    rootTravel = Math.max(rootTravel, len(sub(frames[i].root, frames[0].root)));
  }
  put("body.hipsTravel", hipsTravel / fa);
  put("body.hipsAhead", (P(peak, "hips")[1] - P(0, "hips")[1]) / fa);
  put("body.hipsDrop", (idle.p.hips[2] - hipsLow) / H);
  put("body.footTravel", footTravel / fa);
  let steps = 0;
  for (const toe of ["lToe", "rToe"]) {
    const ground = Math.min(...frames.map((f) => f.p[toe][2]));
    let up = false;
    for (let i = 0; i < n; i++) {
      const z = P(i, toe)[2] - ground;
      if (!up && z > 0.1 * fa) (up = true), steps++;
      else if (up && z < 0.03 * fa) up = false;
    }
  }
  put("body.steps", steps);
  put("body.stanceHit", len(sub(flat(P(peak, "lToe")), flat(P(peak, "rToe")))) / fa);
  put("body.rootTravel", rootTravel / fa);

  // ── the off arm, in the hips' space ──
  const off = frames.map((f) => inHips(f, f.p.lHand));
  let travel = 0;
  let offMost = 0;
  for (let i = from + 1; i < n; i++) travel += len(sub(off[i], off[i - 1]));
  for (let i = from; i < n; i++) offMost = Math.max(offMost, len(sub(off[i], off[from])));
  put("off.travel", travel / fa);
  put("off.reachMax", offMost / fa);
  put("off.heightHit", h(peak, "lHand"));
  put("off.aheadHit", off[peak][1] / fa);
  const tipWay = sub(P(b, "tip"), P(a, "tip"));
  const offWay = sub(P(b, "lHand"), P(a, "lHand"));
  put("off.counter", len(offWay) > 0.05 * fa && len(tipWay) > 1e-6 ? dot(offWay, tipWay) / (len(offWay) * len(tipWay)) : null);

  // ── how it starts and ends against the standing idle ──
  const poseFrom = (f) => POSE.reduce((s, k) => s + len(sub(f.p[k], idle.p[k])), 0) / POSE.length / fa;
  put("end.fromIdle", len(sub(tips[n - 1], idle.p.tip)) / fa);
  put("end.poseFromIdle", poseFrom(frames[n - 1]));
  put("start.fromIdle", len(sub(tips[0], idle.p.tip)) / fa);
  put("start.poseFromIdle", poseFrom(frames[0]));
  return { values: v, info: { frames: n, peak, a, b, c, settled } };
}

/** The sword's ready pose: the standing idle's first frame (and the crouched idle's hips). */
export function measureIdle(idle, crouch = null) {
  const rig = rigOf(idle);
  const fa = rig.forearm;
  const H = rig.height;
  const p = idle.p;
  const v = {};
  const put = (k, x) => (v[k] = x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(4)));
  put("rig.forearm", rig.forearm);
  put("rig.upperArm", rig.upperArm);
  put("rig.height", rig.height);
  put("ready.handReach", len(sub(p.rHand, p.rShoulder)) / fa);
  put("ready.elbow", angle(sub(p.rShoulder, p.rElbow), sub(p.rHand, p.rElbow)));
  put("ready.handHeight", heightOf(idle, p.rHand));
  const hand = inHips(idle, p.rHand);
  put("ready.handAhead", hand[1] / fa);
  put("ready.handSide", hand[0] / fa);
  put("ready.tipHeight", heightOf(idle, p.tip));
  const blade = sub(p.tip, p.rHand);
  put("ready.bladePitch", Math.asin(blade[2] / (len(blade) || 1)) * DEG);
  put("ready.bladeYaw", Math.atan2(-blade[0], blade[1]) * DEG);
  put("ready.stance", len(sub([p.lToe[0], p.lToe[1], 0], [p.rToe[0], p.rToe[1], 0])) / fa);
  put("ready.footStagger", (p.rFoot[1] - p.lFoot[1]) / fa);
  put("ready.knee", (angle(sub(p.lUpleg, p.lKnee), sub(p.lFoot, p.lKnee)) + angle(sub(p.rUpleg, p.rKnee), sub(p.rFoot, p.rKnee))) / 2);
  put("ready.hipsHeight", p.hips[2] / H);
  const trunk = sub(p.neck, p.hips);
  put("ready.lean", Math.atan2(trunk[1], trunk[2]) * DEG);
  const offHand = inHips(idle, p.lHand);
  put("ready.offHeight", heightOf(idle, p.lHand));
  put("ready.offAhead", offHand[1] / fa);
  put("ready.offSide", offHand[0] / fa);
  if (crouch) put("ready.crouchHips", crouch.p.hips[2] / H);
  return { values: v };
}

/** A sub-action's strength: light, heavy, push, charge (melee_start) or block. */
export function strengthOf(r) {
  if (r.kind === "melee_start") return "charge";
  if (r.kind === "block") return "block";
  if (r.kind === "push_stagger") return "push";
  return /heavy/.test(r.sub_action) ? "heavy" : "light";
}

/**
 * Vermintide 2's third-person one-handed sword blows, once per hero and clip: { hero, template, events, strength,
 * clip, values } for each, and { hero, values } for each hero's ready pose. From anim/vt2/out/attacks3p.json.
 */
export function vt2Body({ cache = VT2_CACHE, fps = 60, log = () => {} } = {}) {
  const need = ["attacks3p.json", "weapons.json"];
  if (!need.every((f) => existsSync(cache + f))) {
    log(`vt2 third person: no cache at ${cache} (run anim/vt2/thirdperson.py)`);
    return { blows: [], ready: [] };
  }
  const read = (f) => JSON.parse(readFileSync(cache + f, "utf8"));
  const data = read("attacks3p.json");
  const weapons = read("weapons.json");
  const clipOf = (c) => readClip(readFileSync(cache + "anim/" + c));
  const blows = [];
  const ready = [];
  for (const [hero, info] of Object.entries(data.heroes)) {
    const skeleton = read(info.skeleton);
    for (const [template, layers] of Object.entries(info.idle)) {
      const w = weapons[template]?.right;
      const tip = w ? w.tip : null;
      // the standing idle: of the locomotion layer's idle states the weapon sends it to, the one whose hips stand
      // highest (the other is the crouch)
      const idles = (layers["0"] ?? []).filter((s) => s.name === "idle" && s.clips.length);
      const poses = idles.map((s) => sampleClip(clipOf(s.clips[0]), skeleton, { fps: 2, tip })[0]);
      if (!poses.length) {
        log(`vt2 third person: ${hero} ${template}: no idle`);
        continue;
      }
      poses.sort((x, y) => y.p.hips[2] - x.p.hips[2]);
      const idle = poses[0];
      ready.push({ hero, template, values: measureIdle(idle, poses.length > 1 ? poses.at(-1) : null).values });
      const seen = new Map();
      for (const r of data.rows) {
        if (r.hero !== hero || r.template !== template || r.event_field !== "anim_event" || r.tp.length !== 1 || r.tp[0].clips.length !== 1) continue;
        const clip = r.tp[0].clips[0];
        if (seen.has(clip)) {
          seen.get(clip).events.push(r.anim_event);
          continue;
        }
        const scale = r.anim_time_scale || 1;
        const frames = sampleClip(clipOf(clip), skeleton, { fps, tip });
        const m = measureBlow(frames, idle, {
          fps,
          scale,
          blendIn: r.tp[0].blend_in.length ? Math.max(...r.tp[0].blend_in) : 0,
          fpWindow: r.kind === "sweep" ? r.damage_window : null,
          chain: r.kind === "sweep" ? chainPoint(r) : null,
        });
        const fpClip = r.fp[0]?.clips?.[0];
        if (fpClip && existsSync(cache + "anim/" + fpClip)) m.values["time.lengthVsFp"] = Number(((frames.length - 1) / fps - clipOf(fpClip).length).toFixed(4));
        const row = { hero, template, events: [r.anim_event], sub_action: r.sub_action, strength: strengthOf(r), clip, state: r.tp[0].name, values: m.values };
        seen.set(clip, row);
        blows.push(row);
      }
    }
  }
  log(`vt2 third person: ${blows.length} clips, ${ready.length} ready poses`);
  return { blows, ready };
}

/** Bands: overall, per strength; the ready pose's over the heroes. */
export function bodyBands({ blows, ready }) {
  const of = (list) => {
    const keys = [...new Set(list.flatMap((r) => Object.keys(r.values)))];
    return { n: list.length, ...Object.fromEntries(keys.map((k) => [k, band(list.map((r) => r.values[k] ?? null))]).filter(([, b]) => b)) };
  };
  const strengths = Object.fromEntries([...new Set(blows.map((r) => r.strength))].map((s) => [s, of(blows.filter((r) => r.strength === s))]));
  return { strengths, ready: of(ready) };
}
