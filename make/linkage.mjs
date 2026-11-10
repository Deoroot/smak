// Linkages across a joint whose halves are rigid on two bones: a telescopic piston, its cylinder on one bone and
// its rod on the other. Neither half can turn about its anchor (there is no bone to turn it), so the rod stays in
// the cylinder only where the two anchors keep their bearing to each other through the animations. A hinge's own
// axis is such a place: two anchors on it keep their bearing however far the hinge turns.
//
//   findPiston(src, { boneA, boneB, candidatesA, candidatesB, seqs, step, r, clearance, groups })
//     -> { found, cylinder, rod, report, skipped }
//
// Every pair of anchors offered is tried over the frames of the animations given (every one the file keeps by
// default), and the pair whose rod strays least off the cylinder's axis is kept; each half is aimed at the
// other's mean bearing in its own bone's space, and sized so that the rod is in the cylinder when the joint is
// at its widest and does not strike its floor at its narrowest. Animations kept in other files (`group` not 0)
// are posed from `groups` (the files beside the model, sequenceFilesOf); without their file they are left out,
// and named in `skipped`.
import { restPose, poseAt, sequences, sequenceAt, inverse34, apply34, readMdl } from "../core/mdl.mjs";
import { add, sub, mul, dot, len, unit, cyl, box, place } from "../core/solids.mjs";

/** A matrix's turn applied to a direction, and its transpose's (back into the bone's space). */
const turn = (m, v) => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
const turnBack = (m, v) => [0, 1, 2].map((c) => m[0][c] * v[0] + m[1][c] * v[1] + m[2][c] * v[2]);
/** How far a point lies off the line through o along the unit d. */
const off = (p, o, d) => {
  const v = sub(p, o);
  return len(sub(v, mul(d, dot(v, d))));
};
/** The shortest a cylinder, and a rod, may be to be worth one. */
const LEAST_CYLINDER = 1.5;
const LEAST_ROD = 1.0;
/** How much a longer piston is preferred, in units of stray a unit of length (it reads better). */
const LONGER = 0.02;

/** A bone given by name or number, as its number. */
function boneNumber(names, bone) {
  const n = typeof bone === "number" ? bone : names.indexOf(bone);
  if (names[n] === undefined) throw new Error(`findPiston: no bone ${bone}: it has ${names.join(", ")}`);
  return n;
}

/**
 * The poses a linkage is tried over: every `step`th frame of the animations named (all the file keeps when
 * `seqs` is not given), those kept in other files read from `groups` (sequenceFilesOf). Returns { poses, used,
 * skipped }: the names posed, and those left out and why.
 */
export function posesFor(src, { seqs, step = 2, groups } = {}) {
  const all = sequences(src);
  const names = seqs ?? all.map((s) => s.name);
  const poses = [];
  const used = [];
  const skipped = [];
  for (const name of names) {
    const n = sequenceAt(src, name);
    if (n < 0) skipped.push({ name, why: "not in the model" });
    else if (all[n].group && !groups?.[all[n].group])
      skipped.push({ name: all[n].name, why: "kept in another file" });
    else {
      used.push(all[n].name);
      for (let f = 0; f < all[n].frames; f += step) poses.push(poseAt(src, n, f, 0, groups));
    }
  }
  return { poses, used, skipped };
}

/**
 * A piston across a joint, between `boneA` (the cylinder's) and `boneB` (the rod's), names or numbers.
 *   candidatesA, candidatesB   points where its ends may be anchored, in model space with the bones at rest
 *   seqs       the animations it must work through, by name or number (all the file keeps)
 *   step       every how many frames a pose is taken (2)
 *   r          the cylinder's radius (0.4); the rod's is half of it
 *   clearance  how far short of the rod's eye the cylinder stops at the joint's narrowest (0.5)
 *   groups     the files of animations kept beside the model (sequenceFilesOf): those animations are tried too
 * Returns { found, cylinder, rod, report, skipped }: `cylinder` and `rod` lists of solids in model space at
 * rest (for `putRigid` with `space: "rest"`, the cylinder on boneA, the rod on boneB); `report` { anchorA,
 * anchorB, axisA, axisB (model space at rest), dmin, dmax (how near and far apart the anchors come), cylinder,
 * rod (their lengths), stray (the most the rod lies off the cylinder's axis inside it, in units), angleA,
 * angleB (the most each half's bearing turns in its bone, in degrees), bore, frames, sequences }. `found` is
 * false, and the rest null, when no pair leaves a cylinder and a rod long enough to be one.
 */
export function findPiston(
  src,
  { boneA, boneB, candidatesA, candidatesB, seqs, step = 2, r = 0.4, clearance = 0.5, groups },
) {
  const names = readMdl(src).bones;
  const A = boneNumber(names, boneA);
  const B = boneNumber(names, boneB);
  const rest = restPose(src);
  const { poses, used, skipped } = posesFor(src, { seqs, step, groups });
  if (!poses.length) throw new Error("findPiston: no frames to try it over");
  const invA = inverse34(rest[A]);
  const invB = inverse34(rest[B]);
  const As = candidatesA.map((p) => apply34(invA, p));
  const Bs = candidatesB.map((p) => apply34(invB, p));
  const frames = poses.map((pose) => ({ A: pose[A], B: pose[B], iA: inverse34(pose[A]) }));
  let best = null;
  for (const a of As)
    for (const b of Bs) {
      // the bearing of each anchor from the other, in each bone's own space, frame by frame
      const vA = [];
      const vB = [];
      const ds = [];
      for (const fr of frames) {
        const v = sub(apply34(fr.B, b), apply34(fr.A, a));
        ds.push(len(v));
        vA.push(unit(turnBack(fr.A, v)));
        vB.push(unit(turnBack(fr.B, mul(v, -1))));
      }
      const dmin = Math.min(...ds);
      const dmax = Math.max(...ds);
      // the lengths: the cylinder stops short of the rod's eye, the rod short of the cylinder's floor
      const Lc = dmin - clearance;
      const Lr = Math.min(dmin - 0.3, dmax + 0.7 - Lc);
      if (Lc < LEAST_CYLINDER || Lr < LEAST_ROD || Lc + Lr < dmax + 0.6) continue;
      const dirA = unit(vA.reduce(add, [0, 0, 0]));
      const dirB = unit(vB.reduce(add, [0, 0, 0]));
      // the stray: in A's space, the rod's inner end and the rod where it passes the cylinder's mouth, off its axis
      let stray = 0;
      let angA = 0;
      let angB = 0;
      frames.forEach((fr, i) => {
        angA = Math.max(angA, Math.acos(Math.min(1, dot(vA[i], dirA))));
        angB = Math.max(angB, Math.acos(Math.min(1, dot(vB[i], dirB))));
        const bInA = apply34(fr.iA, apply34(fr.B, b));
        const rodDir = unit(turnBack(fr.A, turn(fr.B, dirB)));
        const inner = add(bInA, mul(rodDir, Lr));
        const depth = dot(sub(bInA, a), dirA);
        const rate = dot(rodDir, dirA);
        const tMouth = Math.abs(rate) > 1e-3 ? Math.max(0, Math.min(Lr, (Lc - depth) / rate)) : 0;
        stray = Math.max(stray, off(inner, a, dirA), off(add(bInA, mul(rodDir, tMouth)), a, dirA));
      });
      const score = stray - LONGER * dmin;
      if (!best || score < best.score)
        best = { score, a, b, dirA, dirB, dmin, dmax, Lc, Lr, stray, angA, angB };
    }
  if (!best) return { found: false, cylinder: null, rod: null, report: null, skipped };
  const { a, b, dirA, dirB, Lc, Lr } = best;
  const wa = apply34(rest[A], a);
  const wb = apply34(rest[B], b);
  const da = unit(turn(rest[A], dirA));
  const db = unit(turn(rest[B], dirB));
  const rr = r * 0.5;
  const pa = place(wa, da);
  const pb = place(wb, db);
  const cylinder = [
    box(pa, r * 2.2, r * 2.2, r * 2.0, { mat: "dark", cut: r * 0.4 }),
    cyl(pa, r, r * 0.6, Lc - 0.35, { n: 6, mat: "dark", bevel: 0.06 }),
    cyl(pa, r * 1.3, Lc - 0.35, Lc, { n: 6, mat: "steel" }),
  ];
  const rod = [
    box(pb, rr * 3.4, rr * 3.4, rr * 3.0, { mat: "dark", cut: rr * 0.6 }),
    cyl(pb, rr, rr * 1.2, Lr, { n: 6, mat: "steel" }),
  ];
  const deg = (x) => Math.round((x * 180) / Math.PI);
  const round = (x) => +x.toFixed(2);
  return {
    found: true,
    cylinder,
    rod,
    report: {
      anchorA: wa,
      anchorB: wb,
      axisA: da,
      axisB: db,
      dmin: round(best.dmin),
      dmax: round(best.dmax),
      cylinder: round(Lc),
      rod: round(Lr),
      stray: round(best.stray),
      angleA: deg(best.angA),
      angleB: deg(best.angB),
      bore: round(r - rr),
      frames: frames.length,
      sequences: used,
    },
    skipped,
  };
}
