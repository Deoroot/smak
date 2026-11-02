// The bad set: the short sword's own attacks, each spoiled by one known fault, for the physical judge to tell
// apart from the game's. Every bad sequence is made from a real one (`<fault>_<source>`) so that, the fault
// aside, it moves as the game's does; and every fault is measured on the written file, so the manifest says
// how big it came out, not only how big it was meant to be.
//
//   node anims/tools/badset.mjs [--src C:/Juegos/MSR/msr/models/viewmodels/v_1hswords.mdl] [--out build/anims/bad]
//
// Writes <out>/v_1hswords_bad.mdl (the model with the bad sequences after its own) and <out>/manifest.json:
// [{ seq, fault, source, how, intended, measured, sourceMeasured, unit, note }].
//
// The faults (each on attack1, attack2, attack3):
//   fan      clavicle, upper arm and forearm frozen as at the attack's first frame; the hand turned as the
//            game turns it, so the blade points every way it did, the sweep all in the wrist
//   short    the tip's depth squeezed above 10 so the deepest it goes is 20 (the wrist moved by IK, the hand
//            kept turned as it was)
//   far      the tip pushed ahead over the strike to 78 deep: the arm straightened by IK, the rest by
//            throwing the shoulder forward
//   hyper    the elbow bent as far the other way (past straight) over the strike, the upper arm turned so the
//            wrist is where it was: the blade's path is the game's, the elbow is not
//   twist    the forearm rolled about its own length, 0 to 220 degrees over the strike and back over the
//            recovery (the hand and blade carried round with it)
//   offgrip  the sword's bone slid out of the fist, square to the blade, 0 to 10 by the strike's end, back
//            by the last frame
//   late     the wind-up stretched so that the speed peak falls 10 frames after the hit frame (18)
//   early    the wind-up squeezed so that it falls 10 frames before
//   jitter   noise on the upper arm, forearm and hand (2.5 degrees each way, every frame)
//   teleport two frames of the wind-up with the upper arm swung so the tip jumps 16 across the view, and back
//   seam     the last 12 frames drawn towards the deepest pose, so the attack ends far from idle's first frame
//   flat     three keys only (first frame, deepest, last), joined linearly: no wind-up, no follow-through
//   noplane  the tip moved off its strike plane and back twice over the strike, 8 at most (by IK)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readSequence, addSequence, events as eventsOf } from "../../src/mdl.mjs";
import {
  rigOf,
  poseOfValues,
  worldOf,
  hold,
  turnedInPose,
  between,
  valuesOf,
  qmul,
  qconj,
  qturn,
  qabout,
  qarc,
  degreesOf,
} from "../../src/animate.mjs";
import { weaponPath, weaponOf, blowOf, EYE_ABOVE_ORIGIN } from "../lib/corpus.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (key, fallback) => {
  const at = args.indexOf(`--${key}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const SRC = opt("src", "C:/Juegos/MSR/msr/models/viewmodels/v_1hswords.mdl");
const OUT = resolve(opt("out", join(ROOT, "build", "anim", "bad")));

// the short sword (swords_shortsword.script): bodypart 0 submodel 0, MELEE_DMG_DELAY 0.6 at 30 fps
const SOURCES = ["attack1", "attack2", "attack3"];
const DELAY = 0.6;
const HIT = 18;
const IDLE = "idle1";

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => scale(a, 1 / (len(a) || 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (t) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const r2 = (v) => Number(v.toFixed(2));

const src = readFileSync(SRC);
const rig = rigOf(src);
const B = {
  clavicle: rig.index("Bip01 R Clavicle"),
  upper: rig.index("Bip01 R UpperArm"),
  fore: rig.index("Bip01 R Forearm"),
  hand: rig.index("Bip01 R Hand"),
  sword: rig.index("smdimport"), // the blade's bone, under Bone01 under the hand
};
// the weapon's point on its bone, as the corpus finds it
const TIP = weaponOf(src).tip.p;
const tipOf = (world) => add(world[B.sword].p, qturn(world[B.sword].q, TIP));
/** How far the tip jumps in the teleport's two frames. */
const JUMP = 16;
// the blade lies along the sword bone's z (tip at +25, butt at -5.6): x is square to it
const BLADE_ACROSS = [1, 0, 0];

// ── poses of a sequence, and frames between them ────────────────────────────
const posesOf = (seq) => readSequence(src, seq).frames.map((values) => poseOfValues(rig, values));
/** The pose at a fractional frame, each bone by its shortest turn between the two frames about it. */
const poseAtTime = (poses, t) => {
  const f = clamp(t, 0, poses.length - 1);
  const lo = Math.floor(f);
  return lo >= poses.length - 1 ? poses[poses.length - 1] : between(poses[lo], poses[lo + 1], f - lo);
};

/**
 * The window of the strike: the frames about the speed peak where the tip goes faster than 35% of it (the
 * wind-up of attack2 is itself a third of its peak, so a lower share would take the wind-up in).
 */
function strikeOf(path) {
  const speeds = path.frames.map((f) => f.speed);
  const peak = speeds.indexOf(Math.max(...speeds));
  const floor = 0.35 * speeds[peak];
  let from = peak;
  let to = peak;
  while (from > 0 && speeds[from - 1] > floor) from--;
  while (to < speeds.length - 1 && speeds[to + 1] > floor) to++;
  return { from, to, peak };
}
/** A weight that rises from 0 to 1 over `rise` frames before `from`, holds to `to`, and falls over `fall`. */
const plateau = (f, from, to, rise = 4, fall = 4) =>
  f < from ? smooth((f - (from - rise)) / rise) : f > to ? 1 - smooth((f - to) / fall) : 1;

// ── the arm moved by its wrist ─────────────────────────────────────────────
// Biped's elbow is a hinge about the forearm's own z (the game's frames turn it about nothing else: its
// angle about z is minus the bend), so the wrist is put at a place by bending that hinge to the distance and
// then turning the upper arm about the shoulder: the least change to the arm, its twist kept.
const hingeZ = (q) => 2 * Math.atan2(q[3], q[0]); // the forearm's angle about its z (a pure z turn)
const BEND_MOST = 150 * DEG;
const BEND_LEAST = 3 * DEG;

/**
 * The pose with the right wrist at `to` (the model's space) and the hand turned in the model as `keep` (a
 * quaternion; unless told, as it is now). What the arm cannot reach is made up by moving the clavicle, the
 * whole arm with it; `shifted` says by how much.
 */
function wristTo(pose, to, keep) {
  const w0 = worldOf(rig, pose);
  const handQ = keep ?? w0[B.hand].q;
  const a = len(pose.p[B.fore]);
  const b = len(pose.p[B.hand]);
  const shoulder = w0[B.upper].p;
  const bendFor = (d) => Math.PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  const want = clamp(bendFor(len(sub(to, shoulder))), BEND_LEAST, BEND_MOST);
  let made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
  const now = -hingeZ(made.q[B.fore]);
  made.q[B.fore] = qmul(made.q[B.fore], qabout([0, 0, 1], -(want - now)));
  // the upper arm turned about the shoulder so that the wrist lies along the line to `to`
  const w1 = worldOf(rig, made);
  const turn = qarc(sub(w1[B.hand].p, shoulder), sub(to, shoulder));
  made = hold(rig, made, B.upper, { q: qmul(turn, w1[B.upper].q) });
  made = hold(rig, made, B.hand, { q: handQ });
  const short = sub(to, worldOf(rig, made)[B.hand].p);
  if (len(short) > 1e-3) made = turnedInPose(rig, made, { [rig.names[B.clavicle]]: { move: short } });
  made.shifted = len(short);
  return made;
}
/** The pose with the weapon's tip moved by `delta`: the wrist moved as much, the hand turned as it was. */
const tipBy = (pose, delta) => wristTo(pose, add(worldOf(rig, pose)[B.hand].p, delta));

// ── the faults ─────────────────────────────────────────────────────────────
// Each takes the source's poses, its path (weaponPath) and its strike, and gives { poses, events? }.
const FAULTS = {
  fan(poses) {
    const rest = poses[0];
    return {
      poses: poses.map((pose) => {
        const keep = worldOf(rig, pose)[B.hand].q;
        const made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
        for (const i of [B.clavicle, B.upper, B.fore]) {
          made.q[i] = [...rest.q[i]];
          made.p[i] = [...rest.p[i]];
        }
        return hold(rig, made, B.hand, { q: keep });
      }),
    };
  },
  short(poses, path, strike) {
    // over the strike only: the rest pose already holds the tip 23 ahead, so a whole sequence squeezed to 20
    // would move the idle too
    const most = Math.max(...path.frames.map((f) => f.depth));
    const knee = 10;
    const squeeze = (20 - knee) / (most - knee);
    return {
      poses: poses.map((pose, f) => {
        const x = path.frames[f].depth;
        const w = plateau(f, strike.from, strike.to, 4, 6);
        return x <= knee || !w ? pose : tipBy(pose, [w * (knee + (x - knee) * squeeze - x), 0, 0]);
      }),
    };
  },
  far(poses, path, strike) {
    const deep = path.frames.reduce((a, b) => (b.depth > a.depth ? b : a)).frame;
    const push = 78 - path.frames[deep].depth;
    return {
      poses: poses.map((pose, f) => {
        const w = plateau(f, strike.from, Math.max(deep, strike.to), 5, 6);
        return w ? tipBy(pose, [push * w, 0, 0]) : pose;
      }),
    };
  },
  hyper(poses, path, strike) {
    return {
      poses: poses.map((pose, f) => {
        const w = plateau(f, strike.from, strike.to, 4, 4);
        if (!w) return pose;
        // the bend mirrored through straight: at w = 1 the wrist is as far from the shoulder as it was
        const world = worldOf(rig, pose);
        const z = hingeZ(pose.q[B.fore]);
        const made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
        made.q[B.fore] = qabout([0, 0, 1], z * (1 - 2 * w));
        const shoulder = world[B.upper].p;
        const w1 = worldOf(rig, made);
        const turn = qarc(sub(w1[B.hand].p, shoulder), sub(world[B.hand].p, shoulder));
        return hold(rig, hold(rig, made, B.upper, { q: qmul(turn, w1[B.upper].q) }), B.hand, { q: world[B.hand].q });
      }),
    };
  },
  twist(poses, path, strike) {
    const most = 220 * DEG;
    const last = poses.length - 1;
    return {
      poses: poses.map((pose, f) => {
        // up over the strike, down again over the rest of the recovery
        const w = f <= strike.to
          ? smooth((f - (strike.from - 3)) / (strike.to - strike.from + 3))
          : 1 - smooth((f - strike.to) / Math.max(1, last - strike.to));
        const made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
        made.q[B.fore] = qmul(pose.q[B.fore], qabout([1, 0, 0], most * w)); // about the forearm's length
        return made;
      }),
    };
  },
  offgrip(poses, path, strike) {
    const most = 10;
    const last = poses.length - 1;
    return {
      poses: poses.map((pose, f) => {
        const w = f <= strike.to ? smooth(f / strike.to) : 1 - smooth((f - strike.to) / Math.max(1, last - strike.to));
        const made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
        made.p[B.sword] = add(pose.p[B.sword], qturn(pose.q[B.sword], scale(BLADE_ACROSS, most * w)));
        return made;
      }),
    };
  },
  late: (poses, path, strike) => retimed(poses, strike.peak, HIT + 10),
  early: (poses, path, strike) => retimed(poses, strike.peak, HIT - 10),
  jitter(poses) {
    const random = noise(0x5eed);
    const sway = 2.5;
    return {
      poses: poses.map((pose) => {
        const turn = () => ({ x: random() * sway, y: random() * sway, z: random() * sway });
        return turnedInPose(rig, pose, { [rig.names[B.upper]]: { turn: turn() }, [rig.names[B.fore]]: { turn: turn() }, [rig.names[B.hand]]: { turn: turn() } });
      }),
    };
  },
  teleport(poses, path, strike) {
    // in the wind-up, where the arm moves slowly and a jump cannot pass for the blow's own speed
    const at = Math.max(2, strike.from - 6);
    return {
      poses: poses.map((pose, f) => {
        if (f !== at && f !== at + 1) return pose;
        // the upper arm turned about the line square to the shoulder-to-tip line and to the view, by as much as
        // moves the tip JUMP across the screen
        const world = worldOf(rig, pose);
        const arm = sub(tipOf(world), world[B.upper].p);
        const axis = unit(len(cross(arm, [1, 0, 0])) > 1 ? cross(arm, [1, 0, 0]) : cross(arm, [0, 0, 1]));
        const degrees = (2 * Math.asin(Math.min(1, JUMP / (2 * len(arm))))) / DEG;
        return turnedInPose(rig, pose, { [rig.names[B.upper]]: { turn: [[axis, degrees]] } });
      }),
      at,
    };
  },
  seam(poses, path) {
    const deep = poses[path.frames.reduce((a, b) => (b.depth > a.depth ? b : a)).frame];
    const last = poses.length - 1;
    const span = 12;
    return { poses: poses.map((pose, f) => (f <= last - span ? pose : between(pose, deep, smooth((f - (last - span)) / span)))) };
  },
  flat(poses, path) {
    const deep = path.frames.reduce((a, b) => (b.depth > a.depth ? b : a)).frame;
    const last = poses.length - 1;
    return {
      poses: poses.map((_, f) =>
        f <= deep ? between(poses[0], poses[deep], f / deep) : between(poses[deep], poses[last], (f - deep) / (last - deep)),
      ),
    };
  },
  noplane(poses, path, strike) {
    const normal = planeOf(path.frames.slice(strike.from, strike.to + 1).map((f) => f.tip)).normal;
    const most = 8;
    const span = strike.to - strike.from + 6;
    return {
      poses: poses.map((pose, f) => {
        const u = (f - (strike.from - 3)) / span;
        if (u <= 0 || u >= 1) return pose;
        // two whole waves, faded in and out so that the strike begins and ends where it did
        return tipBy(pose, scale(normal, most * Math.sin(4 * Math.PI * u) * Math.sin(Math.PI * u)));
      }),
    };
  },
};

/** The wind-up (frames 0 to `peak`) stretched or squeezed so that the peak falls at `to`; the rest kept. */
function retimed(poses, peak, to) {
  const count = poses.length + (to - peak);
  const back = (f) => (f <= to ? (f * peak) / to : f - (to - peak));
  return { poses: Array.from({ length: count }, (_, f) => poseAtTime(poses, back(f))), back };
}

/** A seeded noise from -1 to 1 (mulberry32): the same bad set every time. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** The plane nearest some points: { centre, normal } (the smallest axis of their spread, by Jacobi). */
function planeOf(points) {
  const centre = scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
  const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => points.reduce((s, p) => s + (p[r] - centre[r]) * (p[c] - centre[c]), 0)));
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++)
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(m[p][q]) < 1e-12) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const [a, b] = [m[k][p], m[k][q]];
        m[k][p] = c * a - s * b;
        m[k][q] = s * a + c * b;
      }
      for (let k = 0; k < 3; k++) {
        const [a, b] = [m[p][k], m[q][k]];
        m[p][k] = c * a - s * b;
        m[q][k] = s * a + c * b;
      }
      for (let k = 0; k < 3; k++) {
        const [a, b] = [v[k][p], v[k][q]];
        v[k][p] = c * a - s * b;
        v[k][q] = s * a + c * b;
      }
    }
  const least = [0, 1, 2].reduce((a, b) => (m[b][b] < m[a][a] ? b : a));
  return { centre, normal: unit([v[0][least], v[1][least], v[2][least]]) };
}

// ── measures, on the written file ─────────────────────────────────────────
// Each fault is measured by the one number that says it, the same way for the bad sequence and its source.
const pathLength = (points) => points.slice(1).reduce((s, p, i) => s + len(sub(p, points[i])), 0);
const eyeDistance = (p) => len([p[0], p[1], p[2] - EYE_ABOVE_ORIGIN]);
/** The roll of the hand against the upper arm about the forearm: what pronation and supination turn. */
const rollOf = (q) => 2 * Math.atan2(q[1], q[0]); // the twist part of a turn about x
function worldsOf(mdl, seq) {
  return readSequence(mdl, seq).frames.map((values) => {
    const pose = poseOfValues(rig, values);
    return { pose, world: worldOf(rig, pose) };
  });
}
const MEASURES = {
  fan: {
    unit: "the wrist's travel over the strike (units; the tip's is in the note)",
    of: ({ path, window }) => pathLength(path.frames.slice(window.from, window.to + 1).map((f) => f.hand.R)),
    intended: 0,
  },
  short: {
    unit: "deepest tip depth over the strike",
    of: ({ path, window }) => Math.max(...path.frames.slice(window.from, window.to + 1).map((f) => f.depth)),
    intended: 20,
  },
  far: { unit: "deepest tip depth", of: ({ blow }) => blow.maxDepth, intended: 78 },
  hyper: {
    unit: "degrees the elbow is bent past straight, at the most",
    of: ({ poses }) => Math.max(...poses.map(({ pose }) => hingeZ(pose.q[B.fore]) / DEG)),
    intended: "the source's bend over the strike, mirrored (25-75)",
  },
  twist: {
    unit: "degrees the forearm rolls over the sequence (largest less smallest)",
    of: ({ poses }) => {
      let before = 0;
      const rolls = poses.map(({ pose }) => {
        let r = rollOf(pose.q[B.fore]) + rollOf(pose.q[B.hand]);
        r -= 2 * Math.PI * Math.round((r - before) / (2 * Math.PI)); // unwound frame to frame
        before = r;
        return r / DEG;
      });
      return Math.max(...rolls) - Math.min(...rolls);
    },
    intended: 220,
  },
  offgrip: {
    unit: "farthest the grip strays from where it sits in the hand at rest",
    of: ({ poses }) => {
      const inHand = ({ world }) => qturn(qconj(world[B.hand].q), sub(world[B.sword].p, world[B.hand].p));
      const rest = inHand(poses[0]);
      return Math.max(...poses.map((p) => len(sub(inHand(p), rest))));
    },
    intended: 10,
  },
  late: { unit: "speed peak frame less the hit frame", of: ({ blow }) => blow.peakSpeedFrame - HIT, intended: 10 },
  early: { unit: "speed peak frame less the hit frame", of: ({ blow }) => blow.peakSpeedFrame - HIT, intended: -10 },
  jitter: {
    unit: "tip's jerk: root mean square of its third difference, units a frame cubed",
    of: ({ path }) => {
      const t = path.frames.map((f) => f.tip);
      // the third difference, p3 - 3 p2 + 3 p1 - p0: smooth motion has little, noise a lot
      const third = t.slice(3).map((p3, i) => len([0, 1, 2].map((k) => p3[k] - 3 * t[i + 2][k] + 3 * t[i + 1][k] - t[i][k])));
      return Math.sqrt(third.reduce((s, v) => s + v * v, 0) / third.length);
    },
    intended: "2.5 degrees of noise a bone",
  },
  teleport: {
    unit: "the tip's largest step in one frame outside the strike (units)",
    of: ({ path, window }) => {
      const steps = path.frames.slice(1).map((f, i) => (i + 1 >= window.from && i < window.to ? 0 : len(sub(f.tip, path.frames[i].tip))));
      return Math.max(...steps);
    },
    intended: 16,
  },
  seam: {
    unit: "the tip's distance from idle1's first frame at the last frame",
    of: ({ path, idle }) => len(sub(path.frames[path.frames.length - 1].tip, idle.frames[0].tip)),
    intended: "the deepest pose's distance (25-40)",
  },
  flat: {
    unit: "peak tip speed / its mean over the sequence",
    of: ({ path }) => {
      const s = path.frames.map((f) => f.speed);
      return Math.max(...s) / (s.reduce((a, b) => a + b, 0) / s.length);
    },
    intended: "near 1 in each leg (the source's 2.5-4)",
  },
  noplane: {
    unit: "the tip's farthest from its strike plane, over the strike (units)",
    of: ({ path, window }) => {
      const tips = path.frames.slice(window.from, window.to + 1).map((f) => f.tip);
      const plane = planeOf(tips);
      return Math.max(...tips.map((p) => Math.abs(dot(sub(p, plane.centre), plane.normal))));
    },
    intended: 8,
  },
};

/** How each fault was made, for the manifest. */
const HOW = {
  fan: "clavicle, upper arm and forearm held at the attack's first frame; the hand turned in the model as the source turns it",
  short: "tip depth above 10 squeezed so the deepest is 20; the wrist moved by as much (elbow hinge and upper arm), hand turned as the source",
  far: "the tip pushed ahead over the strike so the deepest is 78; the arm straightened, the rest by moving the clavicle",
  hyper: "over the strike the elbow's bend mirrored through straight, the upper arm turned so the wrist stays, the hand turned as the source",
  twist: "the forearm rolled about its own x (its length) 0 to 220 degrees over the strike, back to 0 by the last frame",
  offgrip: "the sword's bone moved square to the blade, 0 to 10 by the strike's end, back to 0 by the last frame",
  late: "frames 0 to the speed peak stretched so the peak falls at 28; the rest kept",
  early: "frames 0 to the speed peak squeezed so the peak falls at 8; the rest kept",
  jitter: "every frame the upper arm, forearm and hand turned by noise of up to 2.5 degrees about each axis",
  teleport: "two frames of the wind-up (6 before the strike) with the upper arm turned so the tip jumps 16 across the view, and back",
  seam: "the last 12 frames eased towards the deepest pose: the last frame is that pose",
  flat: "three keys (first frame, deepest, last) joined linearly",
  noplane: "the tip moved along the strike plane's normal, two waves of 8 at most over the strike (by IK)",
};

/** Everything a measure may want of one sequence of a file. */
function measured(mdl, seq) {
  const path = weaponPath(mdl, { seq });
  return { path, blow: blowOf(path, DELAY), strike: strikeOf(path), poses: worldsOf(mdl, seq) };
}

// ── the set ─────────────────────────────────────────────────────────────────
const idle = weaponPath(src, { seq: IDLE });
let out = src;
const made = [];
for (const source of SOURCES) {
  const poses = posesOf(source);
  const path = weaponPath(src, { seq: source });
  const strike = strikeOf(path);
  const fps = readSequence(src, source).fps;
  const carried = eventsOf(src, source);
  for (const fault of Object.keys(FAULTS)) {
    const result = FAULTS[fault](poses, path, strike);
    const frames = result.poses.map((pose) => valuesOf(rig, pose));
    unwind(frames);
    const name = `${fault}_${source}`;
    // the source's events (none on the short sword's attacks) kept on their frames, moved with a retiming
    const events = carried.map((e) => ({ ...e, frame: Math.min(frames.length - 1, Math.round(result.back ? inverse(result.back, e.frame, frames.length) : e.frame)) }));
    out = addSequence(out, { name, fps, frames, events });
    made.push({ seq: name, fault, source, strike, teleportAt: result.at });
  }
}

/** The frame a retiming sends a source frame to (the inverse of `back`, which is increasing). */
function inverse(back, frame, count) {
  for (let f = 0; f < count; f++) if (back(f) >= frame) return f;
  return count - 1;
}
/** An angle kept near the frame before's, a whole turn taken off where it leaps (as animate does). */
function unwind(frames) {
  for (let f = 1; f < frames.length; f++)
    frames[f].forEach((six, bone) => {
      for (let k = 3; k < 6; k++) six[k] -= 2 * Math.PI * Math.round((six[k] - frames[f - 1][bone][k]) / (2 * Math.PI));
    });
}

mkdirSync(OUT, { recursive: true });
const file = join(OUT, "v_1hswords_bad.mdl");
writeFileSync(file, out);

// measured again from the written file, beside the source measured the same way
const written = readFileSync(file);
const manifest = made.map(({ seq, fault, source, teleportAt }) => {
  const measure = MEASURES[fault];
  const bad = measured(written, seq);
  const good = measured(src, source);
  const context = { idle, window: good.strike };
  const entry = {
    seq,
    fault,
    source,
    how: HOW[fault],
    unit: measure.unit,
    intended: measure.intended,
    measured: r2(measure.of({ ...bad, ...context })),
    sourceMeasured: r2(measure.of({ ...good, ...context })),
    frames: bad.path.count,
    // what else moved: how far the tip's path strays from the source's, frame for frame (retimed ones aside)
    tipOffSource: bad.path.count === good.path.count
      ? r2(Math.max(...bad.path.frames.map((f, i) => len(sub(f.tip, good.path.frames[i].tip)))))
      : null,
    maxDepth: bad.blow.maxDepth,
    maxReach: bad.blow.maxReach,
    peakSpeedFrame: bad.blow.peakSpeedFrame,
    seamToIdle: r2(len(sub(bad.path.frames[bad.path.count - 1].tip, idle.frames[0].tip))),
  };
  const notes = [];
  if (fault === "fan") {
    const hand = bad.path.frames.map((f) => f.hand.R);
    notes.push(`wrist travel ${r2(pathLength(hand))} (source ${r2(pathLength(good.path.frames.map((f) => f.hand.R)))}), tip travel ${r2(pathLength(bad.path.frames.map((f) => f.tip)))} (source ${r2(pathLength(good.path.frames.map((f) => f.tip)))})`);
  }
  if (fault === "short" || fault === "far" || fault === "noplane") {
    const moved = Math.max(...bad.poses.map(({ world }, i) => len(sub(world[B.clavicle].p, good.poses[i].world[B.clavicle].p))));
    notes.push(`shoulder moved ${r2(moved)} to make up what the arm could not reach`);
  }
  if (fault === "hyper" || fault === "twist" || fault === "offgrip") notes.push(`elbow ${r2(Math.max(...bad.poses.map(({ world }, i) => len(sub(world[B.fore].p, good.poses[i].world[B.fore].p)))))} at most from the source's`);
  if (fault === "teleport") notes.push(`jump at frames ${teleportAt}-${teleportAt + 1}; the source's largest step is ${entry.sourceMeasured}`);
  if (fault === "late" || fault === "early") notes.push(`source peak at frame ${good.blow.peakSpeedFrame}; ${bad.path.count} frames against ${good.path.count}`);
  if (fault === "flat") notes.push(`wind-up (depth lost before the peak) ${r2(windup(bad.path))}, source ${r2(windup(good.path))}`);
  if (fault === "seam") notes.push(`largest bone turn from idle's first frame ${r2(seamTurn(written, seq))} degrees (source ${r2(seamTurn(src, source))})`);
  entry.note = notes.join("; ");
  return entry;
});

/** How much depth the tip gives up before its fastest frame: a wind-up draws the blade back. */
function windup(path) {
  const peak = path.frames.reduce((a, b) => (b.speed > a.speed ? b : a)).frame;
  return path.frames[0].depth - Math.min(...path.frames.slice(0, peak + 1).map((f) => f.depth));
}
/** The widest turn of any bone between a sequence's last frame and idle's first. */
function seamTurn(mdl, seq) {
  const last = readSequence(mdl, seq).frames.at(-1);
  const first = readSequence(src, IDLE).frames[0];
  const a = poseOfValues(rig, last).q;
  const b = poseOfValues(rig, first).q;
  return Math.max(...a.map((q, i) => degreesOf(qmul(qconj(b[i]), q))));
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ model: SRC, file, hitFrame: HIT, sequences: manifest }, null, 2));
for (const e of manifest)
  console.log(`${e.seq.padEnd(18)} ${String(e.measured).padStart(8)} (source ${String(e.sourceMeasured).padStart(7)})  ${e.unit}${e.note ? `  [${e.note}]` : ""}`);
console.log(`wrote ${file} (${made.length} bad sequences) and manifest.json`);
