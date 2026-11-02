// The judge's findings drawn where they happen: for an agent that reads pictures, so that it sees not only
// that a blow is wrong but in which frame, at which joint and how.
//
//   findingsOf(m, list)               the measures outside MSR's spread, each with the frame it shows best in
//   judgedPictures(src, m, list, v)   all of these, as { "eye.png": picture, ... }:
//     eyeJudged     every n-th frame from the eye and every frame a finding happens in; the tip's path in the
//                   colours of its phases, the arm's bones, each finding marked on its frame and written under it
//     plansJudged   from beside, from above and edge-on to the strike's plane: the paths by phase, the reach
//                   MSR's blades have, the hit, the fastest and the deepest, where the blade turns about
//     timeline      frame by frame: the phases, the tip's speed, and every finding's own curve against MSR's band
//     closeUps      each finding up close at its frame, seen from where it shows: a bend from across its
//                   hinge, a hand off its handle, a jump with the frame before, an arm through the near plane
//
// `m` is measure()'s, `list` verdicts()', `v` overall()'s (anims/lib/judge.mjs). Points are the view model's: the
// eye at the origin looking along +x, +y the left, +z up (the judge's distances are from 1 unit above, as the
// game's eye is; drawn here as the render's camera stands).
import { render, label } from "../../src/render.mjs";
import { MEASURES } from "./judge.mjs";
import { EYE_ABOVE_ORIGIN } from "./corpus.mjs";
import { camera, bodyFor, ink, disc, ring, line, cross, border, NEAR } from "./view.mjs";

const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};

/** The phases' colours: cold before the blow, hot in it, cooling after. */
export const PHASE_INK = {
  "wind-up": [90, 150, 255],
  strike: [255, 225, 60],
  "follow-through": [255, 140, 40],
  recovery: [150, 150, 150],
};
/** How bad a finding is: past a body's limit, more than an IQR outside MSR's spread, outside it, not counted. */
export const SEVERE_INK = { fault: [255, 50, 230], far: [255, 40, 40], out: [255, 150, 150], noise: [170, 170, 170], note: [200, 200, 200] };
const MARK = { hit: [255, 255, 255], peak: [60, 230, 230], deep: [120, 255, 120], arm: [90, 230, 120], other: [50, 140, 80], handle: [235, 235, 235], target: [80, 180, 255] };
const ORDER = { fault: 0, far: 1, out: 2, note: 3, noise: 4 };
/** Letters of the labels: 4 dots each, 2 pixels a dot. */
const CHAR = 8;
const LINE = 14;

const fmt = (x) => (x === null || x === undefined ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
/** The labels' letters have no apostrophe, no per cent and no brackets of other kinds. */
const plain = (s) => String(s).replace(/'/g, "").replace(/%/g, " PC").replace(/[<>]/g, (c) => (c === "<" ? "LOW" : "HIGH")).replace(/[\[\]]/g, "");
/** Text broken into lines of at most `chars` letters, at spaces. */
function wrap(text, chars) {
  const out = [];
  let lineNow = "";
  for (const word of plain(text).split(/\s+/)) {
    if (!word) continue;
    if (lineNow && lineNow.length + 1 + word.length > chars) {
      out.push(lineNow);
      lineNow = "";
    }
    let w = word;
    while (w.length > chars) {
      out.push(w.slice(0, chars));
      w = w.slice(chars);
    }
    lineNow = lineNow ? `${lineNow} ${w}` : w;
  }
  if (lineNow) out.push(lineNow);
  return out;
}

/** A dark picture to draw on. */
function blank(width, height, rgb = [20, 22, 26]) {
  const img = { width, height, rgba: new Uint8Array(width * height * 4) };
  for (let i = 0; i < width * height; i++) img.rgba.set([...rgb, 255], i * 4);
  return img;
}
/** Pictures one under the other, as wide as the widest. */
function column(images) {
  const width = Math.max(...images.map((i) => i.width));
  const out = blank(width, images.reduce((s, i) => s + i.height, 0));
  let top = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) out.rgba.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), (top + y) * width * 4);
    top += img.height;
  }
  return out;
}
/**
 * Pictures of one width side by side, `cols` to a row, each row as high as its highest, each with its name in
 * its corner: tile's, for pictures whose captions differ in length.
 */
function grid(images, cols, names = []) {
  const rows = [];
  for (let k = 0; k < images.length; k += cols) {
    const some = images.slice(k, k + cols);
    const high = Math.max(...some.map((i) => i.height));
    const row = blank(images[0].width * cols, high);
    some.forEach((img, c) => {
      for (let y = 0; y < img.height; y++) row.rgba.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), (y * row.width + c * img.width) * 4);
      if (names[k + c] !== undefined) label(row, plain(names[k + c]), c * img.width + 6, 6);
    });
    rows.push(row);
  }
  return column(rows);
}
/** A filled rectangle. */
function box(img, x0, y0, x1, y1, rgb, a = 1) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) ink(img, x, y, rgb, a);
}
/** A rectangle's edge, `w` pixels thick, dashed when told. */
function frameBox(img, x0, y0, x1, y1, rgb, { w = 3, dash = 0 } = {}) {
  for (let k = 0; k < w; k++) {
    line(img, [x0, y0 + k], [x1, y0 + k], rgb, { dash });
    line(img, [x0, y1 - k], [x1, y1 - k], rgb, { dash });
    line(img, [x0 + k, y0], [x0 + k, y1], rgb, { dash });
    line(img, [x1 - k, y0], [x1 - k, y1], rgb, { dash });
  }
}
/** A line with a head at `q`. */
function arrow(img, p, q, rgb, w = 3) {
  line(img, p, q, rgb, { w });
  const d = [q[0] - p[0], q[1] - p[1]];
  const l = Math.hypot(...d) || 1;
  const [ux, uy] = [d[0] / l, d[1] / l];
  for (const s of [-1, 1]) line(img, q, [q[0] - 10 * ux + s * 6 * uy, q[1] - 10 * uy - s * 6 * ux], rgb, { w });
}
/** A label kept inside the picture. */
function note(img, text, x, y, colour, k = 2) {
  const t = plain(text).toUpperCase();
  const wide = t.length * 4 * k;
  label(img, t, Math.round(Math.max(k, Math.min(img.width - wide - k, x))), Math.round(Math.max(k, Math.min(img.height - 6 * k, y))), k, colour);
}

// ── the findings ───────────────────────────────────────────────────────────

/** The phase a frame is in, by the measure's phases. */
export function phaseAt(info, f) {
  const p = info.phases;
  return f < p.strike[0] ? "wind-up" : f <= p.strike[1] ? "strike" : f <= p.follow[1] ? "follow-through" : "recovery";
}

/** The frames that are events, each its own (a jump, a cut by the near plane, the tip off the screen): the rest are spans. */
const EVENTS = new Set(["smooth.jumps", "frame.nearArms", "frame.nearWeapon", "frame.tipOnScreen"]);

/**
 * The measures outside MSR's spread (noise ones too, marked so), and the hit falling outside the strike:
 * [{ key, value, where, severity, mark ("!!", "<", ">", "~"), meaning (the measure's plain low or high), band,
 * limit, at (the frame it shows best in), frames, events (frames each a happening of its own), line (one line
 * of key, value, band and meaning) }], the worst first.
 */
export function findingsOf(m, list) {
  const out = [];
  for (const v of list) {
    if (!["fault", "low", "high"].includes(v.where)) continue;
    const meta = MEASURES[v.key];
    const w = m.info.where?.[v.key];
    if (!w) continue;
    const [hardLo, hardHi] = meta.hard ?? [null, null];
    const low = v.where === "low" || (v.where === "fault" && hardLo !== null && v.value < hardLo);
    const severity = v.where === "fault" ? "fault" : v.noise ? "noise" : v.far > 1 ? "far" : "out";
    const b = v.band;
    const limit = v.where === "fault" ? `LIMIT ${low ? hardLo : hardHi}` : null;
    const bandSay = b ? `MSR ${fmt(b.p5)} TO ${fmt(b.p95)}` : "";
    const meaning = (low ? meta.low : meta.high) || meta.what;
    const mark = v.where === "fault" ? "FAULT" : low ? "LOW" : "HIGH";
    out.push({
      key: v.key,
      value: v.value,
      unit: meta.unit,
      where: v.where,
      severity,
      mark,
      meaning,
      band: b,
      far: v.far,
      at: w.at,
      frames: w.frames,
      events: EVENTS.has(v.key) ? w.frames : [],
      line: `${mark} ${v.key} ${fmt(v.value)} ${meta.unit} (${limit ?? bandSay}${severity === "noise" ? ", NOT COUNTED" : ""}): ${meaning}`,
    });
  }
  const i = m.info;
  if (i.hitPhase && i.hitPhase !== "strike" && i.hitPhase !== "follow-through") {
    const hit = Math.round(i.hitFrame);
    out.push({ key: "hit", severity: "note", mark: "NOTE", at: hit, frames: [hit], events: [], meaning: `the damage lands in the ${i.hitPhase}, not while the blade sweeps through`, line: `NOTE: HIT IN THE ${i.hitPhase}: the damage lands before or after the blade sweeps through (MSR often does)` });
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.far ?? 0) - (a.far ?? 0));
}

/** The worst severity of some findings, or null. */
const worst = (list) => (list.length ? list.reduce((a, b) => (ORDER[b.severity] < ORDER[a.severity] ? b : a)).severity : null);
/** The findings a frame shows: those whose best frame it is, and the events that happen in it. */
const findingsAt = (findings, f) => findings.filter((x) => x.at === f || x.events.includes(f));

/** Which joint a measure is about: [side ("strike" or "other"), joint ("shoulder", "elbow", "wrist")], or null. */
function jointOf(key) {
  if (/^elbow\.|^speed\.elbow/.test(key)) return ["strike", "elbow"];
  if (/^shoulder\.|^speed\.shoulder/.test(key)) return ["strike", "shoulder"];
  if (/^wrist\.|^speed\.wrist/.test(key)) return ["strike", "wrist"];
  if (key === "arm.stretch") return ["strike", "elbow"];
  if (/^other\./.test(key)) return ["other", "elbow"];
  return null;
}

/** The arm's points at a frame: shoulder, elbow, wrist and knuckles (the knuckles when the hand has fingers). */
function chainAt(m, f, side = "strike") {
  const p = m.path;
  if (side === "other") {
    if (!p.other) return null;
    return { shoulder: p.other.shoulders[f], elbow: p.other.elbows[f], wrist: p.other.wrists[f], knuckle: p.other.joints[f].knuckle };
  }
  return { shoulder: p.shoulders[f], elbow: p.elbows[f], wrist: p.wrists[f], knuckle: p.joints[f].knuckle };
}

// ── from the eye ───────────────────────────────────────────────────────────

/** The point in the picture toward an off-screen point, on the picture's edge. */
function edgeToward(cam, at) {
  const [cx, cy] = [cam.width / 2, cam.height / 2];
  const k = Math.min((cam.width / 2 - 8) / Math.abs(at[0] - cx || 1e-9), (cam.height / 2 - 8) / Math.abs(at[1] - cy || 1e-9));
  return [cx + (at[0] - cx) * Math.min(1, k), cy + (at[1] - cy) * Math.min(1, k)];
}
const inside = (cam, q) => q && q[0] >= 0 && q[1] >= 0 && q[0] < cam.width && q[1] < cam.height;

/** A joint ringed from the eye: on it when it is seen, else an arrow at the screen's edge toward it. */
function ringFromEye(img, cam, p, rgb, text, nth = 0) {
  const q = cam.project(p);
  if (inside(cam, q)) {
    ring(img, q, 11, rgb, 1, 3);
    if (text) note(img, text, q[0] + 14, q[1] - 6, rgb);
    return;
  }
  // behind the near plane or off the screen: from the middle toward where it is
  const toward = q ?? (() => {
    const c = cam.toCamera(p);
    return [cam.width / 2 + c[0] * 1000, cam.height / 2 - c[1] * 1000];
  })();
  const e = edgeToward(cam, toward);
  const back = [e[0] + (cam.width / 2 - e[0]) * 0.12, e[1] + (cam.height / 2 - e[1]) * 0.12];
  arrow(img, back, e, rgb);
  if (text) note(img, `${text} (OFF SCREEN)`, back[0] - 40, back[1] - 18 - 16 * nth, rgb);
}

/**
 * One frame from the eye with what the judge found in it: the reach band's target (a man's width at MSR's
 * median deepest), the tip's whole path in its phases' colours and its last frames bright, the tip's depth
 * beside it, the hit's and the fastest's tip ringed, the striking arm's bones, and each finding of the frame
 * marked: its joint ringed, its jump drawn from the frame before, its handle's gap, the near plane's cut.
 */
function eyeTile(src, m, f, findings, { cam, body, depthBand }) {
  const i = m.info;
  const tips = m.path.tips;
  const img = render(src, { view: "first", seq: i.index, frame: f, body, fov: cam.hfov, near: cam.near, width: cam.width, height: cam.height });
  const middle = [cam.width / 2, cam.height / 2];

  // the target where MSR's blades reach: a man's width at the median of their deepest
  if (depthBand) {
    ring(img, middle, (16 * cam.scale) / (depthBand.median + 16), MARK.target, 0.5, 2);
    note(img, `MSR REACH ${fmt(depthBand.median)}`, middle[0] - 48, middle[1] + (16 * cam.scale) / (depthBand.median + 16) + 4, MARK.target, 1);
  }
  cross(img, middle, 5, [235, 235, 235], 0.8);

  // the tip's path, each step in its phase's colour; the last few frames up to this one bright and thick
  const trail = Math.max(4, Math.round(tips.length / 4));
  for (let k = 1; k < tips.length; k++) {
    const s = cam.segment(tips[k - 1], tips[k]);
    if (!s) continue;
    const age = f - k;
    const colour = PHASE_INK[phaseAt(i, k)];
    if (age < 0 || age >= trail) line(img, s[0], s[1], colour, { a: 0.45 });
    else line(img, s[0], s[1], colour, { a: 1 - (0.7 * age) / trail, w: 3 });
  }
  const hit = i.hitFrame === null ? null : Math.round(i.hitFrame);
  if (hit !== null) {
    const h = cam.project(tips[hit]);
    if (h) ring(img, h, 7, MARK.hit, 1, 2);
  }
  const pk = cam.project(tips[i.peakFrame]);
  if (pk) ring(img, pk, 5, MARK.peak, 1, 2);

  // the striking arm's bones: shoulder, elbow, wrist, knuckles
  const chain = chainAt(m, f);
  const joints = [chain.shoulder, chain.elbow, chain.wrist, chain.knuckle].filter(Boolean);
  for (let k = 1; k < joints.length; k++) {
    const s = cam.segment(joints[k - 1], joints[k]);
    if (s) line(img, s[0], s[1], MARK.arm, { a: 0.85, w: 2 });
  }
  joints.forEach((p) => {
    const q = cam.project(p);
    if (q) disc(img, q, 3, MARK.arm);
  });

  const here = findingsAt(findings, f);
  // each note off the screen a line above the one before
  let offs = 0;
  const ringFromEye2 = (...a) => ringFromEye(...a, offs++);
  for (const x of here) {
    const rgb = SEVERE_INK[x.severity];
    const j = jointOf(x.key);
    if (j) {
      const c = chainAt(m, f, j[0]);
      if (c) ringFromEye2(img, cam, c[j[1]], rgb, j[0] === "other" ? `OTHER ${j[1]}` : j[1]);
    } else if (x.key.startsWith("grip.") && m.path.grip) {
      // the handle's line and where the fist holds: the gap between them is the drift
      const g = m.path.grip[f];
      const s = cam.segment(g.butt, g.tip);
      if (s) line(img, s[0], s[1], MARK.handle, { w: 2 });
      const axis = unit(sub(g.tip, g.butt));
      const onLine = add(g.butt, scale(axis, dot(sub(g.held, g.butt), axis)));
      const gap = cam.segment(g.held, onLine);
      if (gap) {
        line(img, gap[0], gap[1], rgb, { w: 4 });
        ring(img, gap[0], 9, rgb, 1, 3);
        note(img, `FIST ${fmt(g.drift)} OFF THE HANDLE`, gap[0][0] + 14, gap[0][1] + 8, rgb);
      } else ringFromEye2(img, cam, g.held, rgb, `FIST ${fmt(g.drift)} OFF THE HANDLE`);
    } else if (x.key === "smooth.jumps" || x.key === "smooth.jumpRatio") {
      // each point that jumps into this frame: from where it was a frame before
      const points = { tip: m.path.tips, wrist: m.path.wrists, elbow: m.path.elbows };
      for (const jmp of (i.jumps ?? []).filter((y) => y.frame === f)) {
        const s = cam.segment(points[jmp.what][f - 1], points[jmp.what][f]);
        if (s) {
          arrow(img, s[0], s[1], rgb, 4);
          disc(img, s[0], 4, rgb);
          note(img, `${jmp.what} JUMPS ${fmt(jmp.step)}`, s[1][0] + 10, s[1][1] + 6, rgb);
        } else ringFromEye2(img, cam, points[jmp.what][f], rgb, `${jmp.what} JUMPS ${fmt(jmp.step)}`);
      }
    } else if (x.key === "frame.nearArms" || x.key === "frame.nearWeapon") {
      frameBox(img, 8, 8, cam.width - 9, cam.height - 9, rgb, { w: 3, dash: 6 });
      note(img, `${x.key === "frame.nearArms" ? "ARM" : "WEAPON"} CUT BY THE NEAR PLANE`, 14, cam.height - 40, rgb);
    } else if (x.key.startsWith("fan.")) {
      ringFromEye2(img, cam, chainAt(m, f)[i.pivotJoint === "beyond" ? "shoulder" : i.pivotJoint], rgb, `TURNS ABOUT THE ${i.pivotJoint}`);
    } else if (x.key.startsWith("reach.") || x.key === "frame.tipOnScreenAtHit" || x.key === "frame.tipOnScreen") {
      ringFromEye2(img, cam, tips[f], rgb, "TIP");
    } else if (x.key.startsWith("seam.")) {
      // where the idle has the tip: the attack should start or end there
      const r = cam.project(m.path.rest.tip);
      const t = cam.project(tips[f]);
      if (r && t) {
        arrow(img, r, t, rgb, 3);
        note(img, "FROM THE IDLE", r[0] + 8, r[1] + 8, rgb);
      } else ringFromEye2(img, cam, m.path.rest.tip, rgb, "IDLE TIP");
    }
  }

  // the tip now, its depth beside it
  const now = cam.project(tips[f]);
  const colour = PHASE_INK[phaseAt(i, f)];
  if (inside(cam, now)) {
    disc(img, now, 4, colour);
    note(img, `D${fmt(tips[f][0])}`, now[0] + 7, now[1] + 4, colour);
  } else if (now) ring(img, edgeToward(cam, now), 5, colour, 1, 2);

  // the phase along the foot; the worst finding's colour about it
  box(img, 0, cam.height - 8, cam.width, cam.height, colour);
  const w = worst(here.filter((x) => x.severity !== "noise" && x.severity !== "note"));
  if (w) border(img, SEVERE_INK[w], 5);
  else if (f === hit) border(img, MARK.hit, 2);
  return img;
}

/**
 * Every n-th frame from the eye and every frame a finding shows best in (the hit, the fastest and the deepest
 * always among them), each named by its frame, time, phase and what it is, and under it each finding of that
 * frame: its key, value, MSR's band or the body's limit, and what it means. { cam (camera or its options),
 * every, cols (4), most (frames at most: 24) }.
 */
export function eyeJudged(src, m, list, opts = {}) {
  const i = m.info;
  const cam = opts.cam?.project ? opts.cam : camera(opts.cam);
  const body = bodyFor(src, { [i.bodypart]: i.submodel });
  const findings = opts.findings ?? findingsOf(m, list);
  const n = i.frames;
  const hit = i.hitFrame === null ? null : Math.round(i.hitFrame);
  const marked = new Set([i.peakFrame, i.deepestFrame, ...(hit === null ? [] : [hit])]);
  for (const x of findings) {
    marked.add(x.at);
    // an event's first frames each (three at most of each kind)
    x.events.slice(0, 3).forEach((f) => marked.add(f));
  }
  const every = opts.every ?? Math.max(1, Math.ceil(n / 12));
  const chosen = new Set([...marked, n - 1]);
  for (let f = 0; f < n; f += every) chosen.add(f);
  // too many: the regular frames next to a marked one go first
  const most = opts.most ?? 24;
  let frames = [...chosen].sort((a, b) => a - b);
  if (frames.length > most) frames = frames.filter((f) => marked.has(f) || ![...marked].some((g) => Math.abs(g - f) <= 2));
  frames = frames.filter((f) => f >= 0 && f < n).slice(0, Math.max(most, marked.size));

  const depthBand = list.find((v) => v.key === "reach.maxDepth")?.band ?? null;
  const chars = Math.floor((cam.width - 12) / CHAR);
  const captions = frames.map((f) =>
    findingsAt(findings, f).flatMap((x) => wrap(x.line, chars).map((t, k) => ({ t: k ? `  ${t}` : t, rgb: SEVERE_INK[x.severity] }))),
  );
  const tiles = frames.map((f, k) => {
    const pic = eyeTile(src, m, f, findings, { cam, body, depthBand });
    const out = column([pic, blank(cam.width, captions[k].length * LINE + 8)]);
    captions[k].forEach((c, r) => label(out, c.t, 6, cam.height + 6 + r * LINE, 2, c.rgb));
    return out;
  });
  const names = frames.map((f) => {
    const what = [f === hit ? "HIT" : "", f === i.peakFrame ? "PEAK" : "", f === i.deepestFrame ? "DEEP" : ""].filter(Boolean).join(" ");
    return `${i.seq} ${f}/${n - 1} ${(f / i.fps).toFixed(2)}S ${phaseAt(i, f)}${what ? ` ${what}` : ""}`;
  });
  const cols = opts.cols ?? 4;
  const strip = grid(tiles, Math.min(cols, tiles.length), names);
  return { picture: column([header(m, opts.verdict, findings, strip.width), strip, legend(strip.width)]), frames };
}

/** The verdict across the top of a picture: the sequence, the word, the faults. */
function header(m, verdict, findings, width) {
  const i = m.info;
  const chars = Math.floor((width - 12) / CHAR);
  const word = verdict?.word ?? "";
  const rgb = word === "FAILS" ? SEVERE_INK.far : word === "DOUBTFUL" ? [255, 200, 80] : [120, 230, 120];
  const lines = [
    { t: `${i.seq}: ${word}  (HIT ${i.hitFrame === null ? "-" : fmt(i.hitFrame)} IN THE ${i.hitPhase ?? "-"}, PEAK ${i.peakFrame}, DEEPEST ${i.deepestFrame}, TURNS ABOUT THE ${i.pivotJoint})`, rgb },
    ...(verdict ? wrap(verdict.say, chars).map((t) => ({ t, rgb: [220, 220, 220] })) : []),
  ];
  const img = blank(width, lines.length * LINE + 10);
  lines.forEach((l, r) => label(img, l.t, 6, 6 + r * LINE, 2, l.rgb));
  return img;
}

/** What the colours mean, along the foot of a picture. */
function legend(width) {
  const items = [
    ["WIND-UP", PHASE_INK["wind-up"]],
    ["STRIKE", PHASE_INK.strike],
    ["FOLLOW-THROUGH", PHASE_INK["follow-through"]],
    ["RECOVERY", PHASE_INK.recovery],
    ["HIT RING", MARK.hit],
    ["PEAK RING", MARK.peak],
    ["ARM", MARK.arm],
    ["FAULT: PAST A BODY LIMIT", SEVERE_INK.fault],
    ["OUTSIDE MSR BY 1 IQR +", SEVERE_INK.far],
    ["OUTSIDE MSR", SEVERE_INK.out],
    ["NOT COUNTED OR NOTE", SEVERE_INK.noise],
    ["D: THE TIP DEPTH AHEAD OF THE EYE", [235, 235, 235]],
  ];
  const img = blank(width, 2 * LINE + 10);
  let x = 6;
  let y = 6;
  for (const [t, rgb] of items) {
    const w = 14 + t.length * CHAR + 14;
    if (x + w > width) {
      x = 6;
      y += LINE;
    }
    box(img, x, y, x + 10, y + 10, rgb);
    label(img, t, x + 14, y, 2, rgb);
    x += w;
  }
  return img;
}

// ── from beside, from above, edge-on ───────────────────────────────────────

/**
 * An orbit camera that looks along `-dir` (from `dir`'s side) at `mid`, `far` units from the middle to the
 * picture's nearer edge (as render frames it): render's options for it, and `at(p)`, a point to the picture.
 */
function orbitCamera(dir, mid, far, width, height, upright = 0) {
  const back = unit(dir);
  // straight down or up the yaw says only which way is right: `upright` then
  const yaw = Math.abs(back[2]) > 0.999 ? upright : Math.atan2(back[1], back[0]) * DEG;
  const pitch = Math.asin(Math.max(-1, Math.min(1, back[2]))) * DEG;
  const forward = scale(back, -1);
  const right = unit(Math.abs(back[2]) > 0.999 ? [-Math.sin(yaw / DEG), Math.cos(yaw / DEG), 0] : crossV(forward, [0, 0, 1]));
  const up = crossV(right, forward);
  const s = (Math.min(width, height) * 0.46) / far;
  return {
    opts: { view: "orbit", yaw, pitch, within: { mid, far }, width, height },
    right,
    up,
    scale: s,
    at: (p) => [width / 2 + dot(sub(p, mid), right) * s, height / 2 - dot(sub(p, mid), up) * s],
  };
}
/**
 * A camera for a close look: as orbitCamera frames it, but from a distance with a narrow lens, and what is
 * nearer it than `far` in front of `mid` cut away (the body that would stand between it and the joint).
 */
function closeCamera(dir, mid, far, width, height) {
  const o = orbitCamera(dir, mid, far, width, height);
  const dist = far * 6;
  const forward = crossV(o.up, o.right);
  const eye = sub(mid, scale(forward, dist));
  const lens = width / 2 / (o.scale * dist);
  return {
    opts: { view: "orbit", yaw: o.opts.yaw, pitch: o.opts.pitch, dist, target: mid, fov: (2 * Math.atan(lens) * DEG), near: dist - far, width, height },
    at: (p) => {
      const d = sub(p, eye);
      const z = Math.max(1e-3, dot(d, forward));
      return [width / 2 + (dot(d, o.right) * o.scale * dist) / z, height / 2 - (dot(d, o.up) * o.scale * dist) / z];
    },
  };
}
/** A picture's model made faint, so that the lines over it are read first. */
function faint(img, keep = 0.45) {
  for (let i = 0; i < img.rgba.length; i += 4) for (let k = 0; k < 3; k++) img.rgba[i + k] = Math.round(img.rgba[i + k] * keep + 30 * (1 - keep));
  return img;
}

/** The plans' views: the side from the player's right, the top with the left up. */
const VIEWS = {
  side: { dir: [0, -1, 0], name: "SIDE, FROM THE RIGHT, AHEAD TO THE RIGHT" },
  top: { dir: [0, 0, 1], yaw: -90, name: "TOP, AHEAD TO THE RIGHT, LEFT IS UP" },
};

/**
 * One plan with the judge's marks: the model faint at the worst finding's frame (else the hit's); the eye, the
 * frustum's edges and the near plane; MSR's reach band (its deepest's 5-95%, shaded) and the target at its
 * median; the tip's path in its phases' colours, the wrist's and the elbow's paths; the hit's, the fastest's
 * and the deepest's tips; the strike's centres of turn and the joint the blade turns about; each jump as an
 * arrow; the arm at the worst finding's frame in its colour.
 */
function planJudged(src, m, list, findings, which, { cam, body, width, height }) {
  const i = m.info;
  const p = m.path;
  const n = i.frames;
  const hit = i.hitFrame === null ? null : Math.round(i.hitFrame);
  const depthBand = list.find((v) => v.key === "reach.maxDepth")?.band ?? null;
  const counted = findings.filter((x) => x.severity !== "noise" && x.severity !== "note");
  const shown = counted[0]?.at ?? hit ?? i.peakFrame;

  // the view: across the strike's plane when asked, else from the side or above
  let dir;
  let name;
  let upright = 0;
  if (which === "plane") {
    // edge-on: look along the plane, square to the strike's way, so a cut that keeps its plane is a line
    const normal = i.plane.normal;
    const way = unit(sub(p.tips[i.phases.strike[1]], p.tips[i.phases.strike[0]]));
    dir = unit(crossV(normal, way));
    if (len(dir) < 0.5) dir = [0, -1, 0];
    name = `EDGE-ON TO THE STRIKE PLANE (TILT ${fmt(m.values["plane.tilt"])} DEG, OFF IT ${fmt(m.values["plane.residual"])} RMS)`;
  } else ({ dir, name, yaw: upright = 0 } = VIEWS[which]);
  const probe = orbitCamera(dir, [0, 0, 0], 1, width, height, upright);
  const flat = (q) => [dot(q, probe.right), dot(q, probe.up)];
  const points = [[0, 0, 0], ...p.tips, ...p.wrists, ...p.elbows, ...(which === "plane" ? [] : [[depthBand ? depthBand.p95 + 32 : 80, 0, 0]])];
  const xs = points.map((q) => flat(q)[0]);
  const ys = points.map((q) => flat(q)[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 8, Math.max(...xs) + 8, Math.min(...ys) - 8, Math.max(...ys) + 8];
  const s = Math.min(width / (x1 - x0), (height - 40) / (y1 - y0));
  const mid = add(scale(probe.right, (x0 + x1) / 2), scale(probe.up, (y0 + y1) / 2));
  const view = orbitCamera(dir, mid, (Math.min(width, height) * 0.46) / s, width, height, upright);
  const at = view.at;
  const img = faint(render(src, { ...view.opts, seq: i.index, frame: shown, body }));

  if (which !== "plane") {
    // the frustum and the near plane
    const half = ((which === "top" ? cam.hfov : cam.vfov) / 2) / DEG;
    const side = which === "top" ? [0, 1, 0] : [0, 0, 1];
    const reach = x1 + 20;
    for (const k of [-1, 1]) line(img, at([0, 0, 0]), at(add([reach, 0, 0], scale(side, k * reach * Math.tan(half)))), [200, 200, 200], { a: 0.6, dash: 4 });
    line(img, at(add([NEAR, 0, 0], scale(side, -NEAR * Math.tan(half)))), at(add([NEAR, 0, 0], scale(side, NEAR * Math.tan(half)))), [200, 200, 200], { a: 0.9, w: 2 });
    // MSR's reach: its blades' deepest, the middle 90% shaded, the target a man's width at its median
    if (depthBand) {
      const [a0, a1] = [at([depthBand.p5, 0, 0])[0], at([depthBand.p95, 0, 0])[0]];
      box(img, a0, 0, a1, height, MARK.target, 0.12);
      line(img, [a0, 0], [a0, height], MARK.target, { a: 0.5, dash: 3 });
      line(img, [a1, 0], [a1, height], MARK.target, { a: 0.5, dash: 3 });
      ring(img, at([depthBand.median + 16, 0, 0]), 16 * s, MARK.target, 0.8, 2);
      cross(img, at([depthBand.median, 0, 0]), 6, MARK.target);
      note(img, `MSR DEEPEST ${fmt(depthBand.p5)}-${fmt(depthBand.p95)}`, a0 + 4, 30, MARK.target);
    }
    disc(img, at([0, 0, 0]), 4, [235, 235, 235]);
    note(img, "EYE", at([0, 0, 0])[0] - 10, at([0, 0, 0])[1] + 8, [235, 235, 235]);
  } else {
    // the plane itself, seen edge-on: a line through the strike's middle
    const mean = i.plane.mean;
    const along = unit(crossV(dir, i.plane.normal));
    line(img, at(add(mean, scale(along, -200))), at(add(mean, scale(along, 200))), [200, 200, 200], { a: 0.7, dash: 5 });
  }

  // the elbow's and the wrist's paths, then the tip's by phase
  for (let k = 1; k < n; k++) {
    line(img, at(p.elbows[k - 1]), at(p.elbows[k]), MARK.other, { a: 0.8, w: 1 });
    line(img, at(p.wrists[k - 1]), at(p.wrists[k]), MARK.arm, { a: 0.9, w: 2 });
  }
  for (let k = 1; k < n; k++) line(img, at(p.tips[k - 1]), at(p.tips[k]), PHASE_INK[phaseAt(i, k)], { w: which === "plane" && k >= i.plane.frames[0] && k <= i.plane.frames[1] ? 3 : 2 });
  disc(img, at(p.tips[0]), 3, [255, 255, 255]);
  // the tip at the phases' first frames, numbered
  for (const f of [i.phases.strike[0], i.phases.strike[1], i.phases.follow[1]]) note(img, String(f), at(p.tips[f])[0] + 5, at(p.tips[f])[1] - 14, PHASE_INK[phaseAt(i, f)], 1);

  // where the blade turns about, frame by frame in the strike, and the joint it is nearest
  for (const q of i.pivots ?? []) if (q.centre) disc(img, at(q.centre), 2, [200, 120, 255], 0.9);
  const pj = i.pivotJoint === "beyond" ? null : i.pivotJoint;
  if (pj) {
    const c = chainAt(m, i.peakFrame)[pj];
    ring(img, at(c), 9, [200, 120, 255], 1, 2);
    note(img, `TURNS ABOUT THE ${pj}`, at(c)[0] + 12, at(c)[1] + 6, [200, 120, 255]);
  }

  // jumps: from the frame before
  const tracks = { tip: p.tips, wrist: p.wrists, elbow: p.elbows };
  for (const j of i.jumps ?? []) arrow(img, at(tracks[j.what][j.frame - 1]), at(tracks[j.what][j.frame]), SEVERE_INK.fault, 3);

  // the arm and blade at the frame shown, in the worst finding's colour
  const rgb = counted[0] ? SEVERE_INK[counted[0].severity] : MARK.hit;
  const c = chainAt(m, shown);
  const chain = [c.shoulder, c.elbow, c.wrist, c.knuckle].filter(Boolean);
  for (let k = 1; k < chain.length; k++) line(img, at(chain[k - 1]), at(chain[k]), rgb, { w: 2 });
  if (p.grip) line(img, at(p.grip[shown].butt), at(p.grip[shown].tip), rgb, { w: 2 });
  disc(img, at(p.tips[shown]), 4, rgb);
  const j = counted[0] && jointOf(counted[0].key);
  if (j) {
    const jc = chainAt(m, shown, j[0]);
    if (jc) ring(img, at(jc[j[1]]), 10, rgb, 1, 3);
  }

  // the hit, the fastest and the deepest
  if (hit !== null) {
    ring(img, at(p.tips[hit]), 7, MARK.hit, 1, 2);
    note(img, `HIT ${hit}`, at(p.tips[hit])[0] + 9, at(p.tips[hit])[1] + 2, MARK.hit);
  }
  ring(img, at(p.tips[i.peakFrame]), 6, MARK.peak, 1, 2);
  note(img, `PEAK ${i.peakFrame}`, at(p.tips[i.peakFrame])[0] + 9, at(p.tips[i.peakFrame])[1] - 16, MARK.peak);
  ring(img, at(p.tips[i.deepestFrame]), 5, MARK.deep, 1, 2);
  note(img, `DEEP ${i.deepestFrame}`, at(p.tips[i.deepestFrame])[0] + 9, at(p.tips[i.deepestFrame])[1] + 14, MARK.deep);

  // a scale bar of ten units, and the view's name and the frame the model is shown at
  const bar = [10, height - 14];
  line(img, bar, [bar[0] + 10 * s, bar[1]], [235, 235, 235], { w: 2 });
  label(img, "10", Math.round(bar[0] + 10 * s + 6), bar[1] - 4, 2);
  label(img, plain(name), 6, 6, 2);
  const why = counted[0] ? `${counted[0].key} AT ${shown}` : `HIT ${shown}`;
  note(img, `MODEL AND ARM AT FRAME ${shown} (${why})`, width - 8 - 50 * CHAR, height - 18, rgb);
  return img;
}

/**
 * The side view, the top view and the view edge-on to the strike's plane, one under the other, with the verdict
 * above them. { cam, width (900), height (440 each) }.
 */
export function plansJudged(src, m, list, opts = {}) {
  const i = m.info;
  const cam = opts.cam?.project ? opts.cam : camera(opts.cam);
  const body = bodyFor(src, { [i.bodypart]: i.submodel });
  const findings = opts.findings ?? findingsOf(m, list);
  const o = { cam, body, width: opts.width ?? 900, height: opts.height ?? 440 };
  const views = ["side", "top", "plane"].map((w) => planJudged(src, m, list, findings, w, o));
  return { picture: column([header(m, opts.verdict, findings, o.width), ...views, legend(o.width)]) };
}

// ── frame by frame ─────────────────────────────────────────────────────────

/** The eye's distance and the angle off the line of sight, as the judge takes them (from 1 above the origin). */
const fromEye = (q) => [q[0], q[1], q[2] - EYE_ABOVE_ORIGIN];

/**
 * A finding's curve over the frames, when it has one: { values, banded (true: the measure is this curve's
 * least, most or value at the hit, so MSR's band and the body's limit can be drawn across it), name }.
 */
function curveOf(m, key) {
  const p = m.path;
  const J = p.joints;
  const O = p.other?.joints;
  const steps = (track) => track.map((q, k) => (k ? len(sub(q, track[k - 1])) : 0));
  const table = {
    "elbow.min": [J.map((x) => x.flex), true, "ELBOW BEND"],
    "elbow.max": [J.map((x) => x.fold), true, "ELBOW FOLD"],
    "elbow.range": [J.map((x) => x.flex), false, "ELBOW BEND"],
    "elbow.offHinge": [J.map((x) => Math.abs(x.off)), true, "FOREARM OFF THE HINGE"],
    "shoulder.cone": [J.map((x) => x.cone), true, "UPPER ARM FROM REST"],
    "wrist.bend": [J.map((x) => x.bend), true, "WRIST BEND"],
    "wrist.angle": [J.map((x) => x.angle), true, "WRIST ANGLE"],
    "arm.stretch": [J.map((x) => x.stretch), true, "ARM LENGTH CHANGE"],
    "wrist.twist": [J.map((x) => Math.abs(x.twist)), true, "FOREARM TWIST"],
    "other.elbowMin": O && [O.map((x) => x.flex), true, "OTHER ELBOW BEND"],
    "other.offHinge": O && [O.map((x) => Math.abs(x.off)), true, "OTHER FOREARM OFF HINGE"],
    "other.stretch": O && [O.map((x) => x.stretch), true, "OTHER ARM LENGTH CHANGE"],
    "grip.drift": p.grip && [p.grip.map((x) => x.drift), true, "HANDLE OFF THE FIST"],
    "grip.slide": p.grip && [p.grip.map((x) => x.slide), true, "HANDLE SLID"],
    "grip.offhand": p.grip && [p.grip.map((x) => x.offhand), true, "OFF HAND FROM HANDLE"],
    // the faults: the striking arm's curve (the value is the worst held on screen, of either arm)
    "fault.hyperextension": [J.map((x) => -x.flex), false, "ELBOW PAST STRAIGHT"],
    "fault.elbowFold": [J.map((x) => x.fold), false, "ELBOW FOLD"],
    "fault.armStretch": [J.map((x) => x.stretch), false, "ARM LENGTH CHANGE"],
    "fault.wristFold": [J.map((x) => x.angle), true, "WRIST ANGLE"],
    "fault.gripLost": p.grip && [p.grip.map((x) => x.drift), true, "HANDLE OFF THE FIST"],
    "fault.offhandLost": p.grip && [p.grip.map((x) => x.offhand), true, "OFF HAND FROM HANDLE"],
    "reach.maxDepth": [p.tips.map((q) => q[0]), true, "TIP DEPTH"],
    "reach.hitDepth": [p.tips.map((q) => q[0]), true, "TIP DEPTH"],
    "reach.hitDistance": [p.tips.map((q) => len(fromEye(q))), true, "TIP FROM THE EYE"],
    "reach.deepDistance": [p.tips.map((q) => len(fromEye(q))), false, "TIP FROM THE EYE"],
    "reach.hitOverRange": [p.tips.map((q) => len(fromEye(q)) / (m.info.range || 60)), true, "TIP OVER RANGE"],
    "reach.hitAngle": [p.tips.map((q) => Math.atan2(Math.hypot(fromEye(q)[1], fromEye(q)[2]), q[0]) * DEG), true, "TIP OFF SIGHT"],
    "reach.deepAngle": [p.tips.map((q) => Math.atan2(Math.hypot(fromEye(q)[1], fromEye(q)[2]), q[0]) * DEG), false, "TIP OFF SIGHT"],
    "phase.peakSpeed": [p.speeds, true, "TIP SPEED"],
    "plane.residual": [p.planeOff, false, "TIP OFF THE PLANE"],
    "plane.flatness": [p.planeOff, false, "TIP OFF THE PLANE"],
    "smooth.jumps": [steps(p.tips).map((v, k) => Math.max(v, steps(p.wrists)[k], steps(p.elbows)[k])), false, "BIGGEST STEP"],
    "smooth.jumpRatio": [steps(p.tips).map((v, k) => Math.max(v, steps(p.wrists)[k], steps(p.elbows)[k])), false, "BIGGEST STEP"],
    "fan.travelRatio": [steps(p.tips), false, "TIP STEP", steps(p.wrists)],
    "fan.pivot": [steps(p.tips), false, "TIP STEP", steps(p.wrists)],
    "frame.tipOnScreen": [p.tipSeen.map((x) => (x ? 1 : 0)), false, "TIP ON SCREEN"],
    "frame.tipOnScreenAtHit": [p.tipSeen.map((x) => (x ? 1 : 0)), false, "TIP ON SCREEN"],
    "frame.nearArms": [Array.from({ length: m.info.frames }, (_, k) => (m.info.cutFrames.arms.includes(k) ? 1 : 0)), false, "ARM CUT"],
    "frame.nearWeapon": [Array.from({ length: m.info.frames }, (_, k) => (m.info.cutFrames.weapon.includes(k) ? 1 : 0)), false, "WEAPON CUT"],
    "speed.shoulder": p.turns && [p.turns.shoulder, true, "SHOULDER TURN SPEED"],
    "speed.elbow": p.turns && [p.turns.elbow, true, "ELBOW TURN SPEED"],
    "speed.wrist": p.turns && [p.turns.wrist, true, "WRIST TURN SPEED"],
    "flow.stall": p.fastestJoint && [p.fastestJoint, true, "FASTEST JOINT TURN"],
    "flow.lockstep": p.turns && [p.turns.shoulder, false, "SHOULDER TURN", p.turns.elbow, "SHOULDER TURN (WHITE), ELBOW TURN (GREEN)"],
    "seam.start": [p.tips.map((q) => len(sub(q, p.rest.tip))), false, "TIP FROM THE IDLE"],
    "seam.end": [p.tips.map((q) => len(sub(q, p.rest.tip))), false, "TIP FROM THE IDLE"],
  };
  const t = table[key];
  if (!t) return null;
  return { values: t[0], banded: t[1], name: t[2], second: t[3] ?? null, secondName: t[4] ?? null };
}

/**
 * The sequence frame by frame: across the top the phases and the frame numbers; the tip's speed; then a row
 * for each finding, its curve where it has one (MSR's 5-95% band and the body's limit across it when the curve
 * is what the measure takes its least, most or hit value of), the frames it is about shaded and the frame it
 * shows best in ringed; the hit's and the fastest's frames as lines down the whole picture. { width (1400) }.
 */
export function timeline(m, list, opts = {}) {
  const i = m.info;
  const n = i.frames;
  const findings = (opts.findings ?? findingsOf(m, list)).filter((x) => x.key !== "hit");
  const width = opts.width ?? 1400;
  const left = 470;
  const right = width - 20;
  const xAt = (f) => left + ((right - left) * f) / Math.max(1, n - 1);
  const hit = i.hitFrame === null ? null : i.hitFrame;

  const rows = [];
  // the phases, with frame numbers
  const top = blank(width, 46);
  for (let f = 0; f < n; f++) box(top, xAt(f - 0.5), 20, xAt(f + 0.5), 38, PHASE_INK[phaseAt(i, f)]);
  for (let f = 0; f < n; f += n > 40 ? 5 : 2) label(top, String(f), Math.round(xAt(f) - 4), 4, 2);
  label(top, "FRAME AND PHASE", 6, 22, 2);
  rows.push(top);

  /** One row: a name and a meaning at the left, a curve (or only the marks) at the right. */
  const row = (title, sayLines, rgb, curve, x) => {
    const high = Math.max(70, 14 + sayLines.length * LINE + 8);
    const img = blank(width, high, [28, 30, 36]);
    label(img, title, 6, 6, 2, rgb);
    sayLines.forEach((t, k) => label(img, t, 6, 6 + (k + 1) * LINE, 2, [200, 200, 200]));
    const [y0, y1] = [8, high - 8];
    if (x) for (const f of x.frames) box(img, xAt(f - 0.5), y0, xAt(f + 0.5), y1, rgb, 0.18);
    if (curve) {
      const vals = curve.values.filter((v) => v !== null && Number.isFinite(v));
      const b = x?.band;
      const lim = x && x.where === "fault" ? (MEASURES[x.key].hard ?? []).filter((h) => h !== null) : [];
      const extra = curve.banded && b ? [b.p5, b.p95] : [];
      let lo = Math.min(...vals, ...extra, ...lim, ...(curve.second ?? []));
      let hi = Math.max(...vals, ...extra, ...lim, ...(curve.second ?? []));
      if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
      const pad = (hi - lo) * 0.08;
      [lo, hi] = [lo - pad, hi + pad];
      const yAt = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
      if (curve.banded && b) {
        box(img, left, yAt(b.p95), right, yAt(b.p5), MARK.target, 0.15);
        line(img, [left, yAt(b.p5)], [right, yAt(b.p5)], MARK.target, { a: 0.6, dash: 4 });
        line(img, [left, yAt(b.p95)], [right, yAt(b.p95)], MARK.target, { a: 0.6, dash: 4 });
        label(img, `MSR ${fmt(b.p5)}-${fmt(b.p95)}`, right - 17 * CHAR, Math.round(Math.min(y1 - 12, yAt(b.p5) + 3)), 1, MARK.target);
      }
      for (const h of lim) {
        line(img, [left, yAt(h)], [right, yAt(h)], SEVERE_INK.fault, { w: 2, dash: 6 });
        label(img, `LIMIT ${h}`, left + 4, Math.round(yAt(h) + 3), 1, SEVERE_INK.fault);
      }
      if (curve.second)
        for (let f = 1; f < n; f++) line(img, [xAt(f - 1), yAt(curve.second[f - 1])], [xAt(f), yAt(curve.second[f])], MARK.arm, { w: 2 });
      for (let f = 1; f < n; f++) {
        const [a, c] = [curve.values[f - 1], curve.values[f]];
        if (a === null || c === null) continue;
        line(img, [xAt(f - 1), yAt(a)], [xAt(f), yAt(c)], x ? rgb : [235, 235, 235], { w: 2 });
      }
      label(img, `${fmt(Math.max(...vals))}`, left - 6 * CHAR, Math.round(y0), 1, [180, 180, 180]);
      label(img, `${fmt(Math.min(...vals))}`, left - 6 * CHAR, Math.round(y1 - 6), 1, [180, 180, 180]);
      if (x && curve.values[x.at] !== null && curve.values[x.at] !== undefined) {
        const q = [xAt(x.at), yAt(curve.values[x.at])];
        ring(img, q, 7, rgb, 1, 2);
        label(img, `${x.at}`, Math.round(q[0] + 9), Math.round(Math.max(y0, q[1] - 14)), 1, rgb);
      }
      if (curve.second) label(img, curve.secondName ?? "TIP STEP (RED), WRIST STEP (GREEN)", left + 4, y0, 1, [200, 200, 200]);
    } else if (x) {
      // no curve: the frame it is about marked
      line(img, [xAt(x.at), y0], [xAt(x.at), y1], rgb, { w: 3 });
      label(img, `FRAME ${x.at}`, Math.round(xAt(x.at) + 6), y0, 2, rgb);
    }
    return img;
  };

  // the tip's speed, the strike's threshold and the follow-through's
  const speed = row("TIP SPEED", [`PEAK ${fmt(m.values["phase.peakSpeed"])} FOREARMS/S AT ${i.peakFrame}`], [235, 235, 235], { values: m.path.speeds, banded: false }, null);
  rows.push(speed);
  const chars = Math.floor((left - 70) / CHAR);
  for (const x of findings) {
    const curve = curveOf(m, x.key);
    const lines = wrap(x.line, chars);
    rows.push(row(lines[0], lines.slice(1), SEVERE_INK[x.severity], curve, x));
  }
  if (!findings.length) {
    const img = blank(width, 30);
    label(img, "NO MEASURE OUTSIDE MSR S 5-95 PC SPREAD", 6, 8, 2, [120, 230, 120]);
    rows.push(img);
  }
  const body = column(rows);
  // the hit and the fastest, down the whole of it
  if (hit !== null) {
    line(body, [xAt(hit), 0], [xAt(hit), body.height], MARK.hit, { w: 2, dash: 5 });
    label(body, "HIT", Math.round(xAt(hit) + 4), 40, 1, MARK.hit);
  }
  line(body, [xAt(i.peakFrame), 0], [xAt(i.peakFrame), body.height], MARK.peak, { w: 1, dash: 3 });
  label(body, "PEAK", Math.round(xAt(i.peakFrame) + 4), 48, 1, MARK.peak);
  for (const f of new Set(i.jumpFrames)) line(body, [xAt(f), 0], [xAt(f), 40], SEVERE_INK.fault, { w: 3 });
  return { picture: column([header(m, opts.verdict, findings, width), body, legend(width)]) };
}

// ── up close ───────────────────────────────────────────────────────────────

/**
 * A finding up close at its frame, the model as it is (not faint) and seen from where the finding shows:
 * a bend from across the plane of the joint's bones (the straight line past the joint dashed, so a bend past
 * straight is seen past it), a hand from across the handle, a jump from beside with the frame before, a cut
 * by the near plane from beside with the near plane drawn, a fan across the strike's plane with the tip's and
 * the wrist's paths. Null when the finding has nothing to show up close (phases, timing).
 */
function closeUp(src, m, x, { body, width, height }) {
  const i = m.info;
  const p = m.path;
  const f = x.at;
  const rgb = SEVERE_INK[x.severity];
  const j = jointOf(x.key);
  let dir;
  let mid;
  let far;
  let draw;
  if (j) {
    const c = chainAt(m, f, j[0]);
    if (!c) return null;
    // the three points of the bend: shoulder-elbow-wrist, elbow-wrist-knuckles, or the upper arm now and at rest
    const [a, b, d] =
      j[1] === "wrist" ? [c.elbow, c.wrist, c.knuckle ?? add(c.wrist, sub(c.wrist, c.elbow))] : j[1] === "shoulder" ? [p.rest.elbow, c.shoulder, c.elbow] : [c.shoulder, c.elbow, c.wrist];
    dir = crossV(sub(a, b), sub(d, b));
    if (len(dir) < 1e-3) dir = [0, -1, 0];
    // look from the side the eye is on, so left and right read as the player's
    if (dot(dir, sub([0, 0, 0], b)) < 0) dir = scale(dir, -1);
    mid = b;
    far = Math.max(len(sub(a, b)), len(sub(d, b))) * 1.3;
    draw = (img, at) => {
      const chain = [c.shoulder, c.elbow, c.wrist, c.knuckle].filter(Boolean);
      for (let k = 1; k < chain.length; k++) line(img, at(chain[k - 1]), at(chain[k]), MARK.arm, { w: 3 });
      chain.forEach((q) => disc(img, at(q), 4, MARK.arm));
      // straight on from the bone before the joint: a bend past this line is past straight
      const before = j[1] === "shoulder" ? null : unit(sub(b, a));
      const reach = Math.max(len(sub(d, b)), far * 0.6);
      if (before) line(img, at(b), at(add(b, scale(before, reach))), [235, 235, 235], { w: 2, dash: 5 });
      if (j[1] === "shoulder") {
        line(img, at(c.shoulder), at(p.rest.elbow), [235, 235, 235], { w: 2, dash: 5 });
        note(img, "AT REST", at(p.rest.elbow)[0] + 6, at(p.rest.elbow)[1], [235, 235, 235]);
      }
      ring(img, at(b), 12, rgb, 1, 3);
      // the joint's own number at this frame, as the judge takes it
      const J = j[0] === "other" ? p.other.joints[f] : p.joints[f];
      const said = { elbow: `BEND ${fmt(J.flex)}${J.flex < 0 ? " (PAST STRAIGHT)" : ""}, FOLD ${fmt(J.fold)}, OFF ${fmt(J.off)}`, wrist: `ANGLE ${fmt(J.angle)}, BEND ${fmt(J.bend)}, TWIST ${fmt(J.twist)}`, shoulder: `FROM REST ${fmt(J.cone)}` }[j[1]];
      note(img, `${j[1]} ${said}`, 6, 26, rgb);
      if (before) note(img, "STRAIGHT ON", at(add(b, scale(before, reach)))[0] + 6, at(add(b, scale(before, reach)))[1], [235, 235, 235]);
    };
  } else if (x.key.startsWith("grip.") && p.grip) {
    const g = p.grip[f];
    const axis = unit(sub(g.tip, g.butt));
    const onLine = add(g.butt, scale(axis, dot(sub(g.held, g.butt), axis)));
    const gap = sub(g.held, onLine);
    dir = len(gap) > 1e-3 ? crossV(axis, gap) : crossV(axis, [0, 0, 1]);
    // from the side away from the shoulder, so that the body is not between the camera and the hand
    if (dot(dir, sub(g.held, p.shoulders[f])) < 0) dir = scale(dir, -1);
    mid = onLine;
    far = Math.max(12, len(gap) * 2.5);
    draw = (img, at) => {
      line(img, at(add(g.butt, scale(axis, -10))), at(g.tip), MARK.handle, { w: 2 });
      note(img, "HANDLE", at(g.butt)[0] + 6, at(g.butt)[1] + 6, MARK.handle);
      line(img, at(g.held), at(onLine), rgb, { w: 4 });
      ring(img, at(g.held), 9, rgb, 1, 3);
      note(img, `FIST, ${fmt(g.drift)} OFF THE HANDLE`, at(g.held)[0] - 60, at(g.held)[1] + 16, rgb);
    };
  } else if (x.key === "smooth.jumps" || x.key === "smooth.jumpRatio") {
    const tracks = { tip: p.tips, wrist: p.wrists, elbow: p.elbows };
    const here = (i.jumps ?? []).filter((y) => y.frame === f);
    if (!here.length) return null;
    const pts = here.flatMap((y) => [tracks[y.what][f - 1], tracks[y.what][f]]);
    mid = scale(pts.reduce(add), 1 / pts.length);
    far = Math.max(15, ...pts.map((q) => len(sub(q, mid)))) * 1.4;
    dir = [0, -1, 0];
    draw = (img, at) => {
      // the arm a frame before, grey; now, green
      for (const [g, colour] of [[f - 1, [150, 150, 150]], [f, MARK.arm]]) {
        const c = chainAt(m, g);
        const chain = [c.shoulder, c.elbow, c.wrist, c.knuckle].filter(Boolean);
        for (let k = 1; k < chain.length; k++) line(img, at(chain[k - 1]), at(chain[k]), colour, { w: 2 });
        line(img, at(p.wrists[g]), at(p.tips[g]), colour, { w: 1, dash: 3 });
      }
      for (const y of here) {
        arrow(img, at(tracks[y.what][f - 1]), at(tracks[y.what][f]), rgb, 4);
        note(img, `${y.what} ${fmt(y.step)} IN ONE FRAME`, at(tracks[y.what][f])[0] + 10, at(tracks[y.what][f])[1], rgb);
      }
      note(img, `GREY FRAME ${f - 1}, GREEN FRAME ${f}`, 6, height - 34, [235, 235, 235]);
    };
  } else if (x.key === "frame.nearArms" || x.key === "frame.nearWeapon") {
    dir = [0, -1, 0];
    mid = [NEAR + 4, 0, 0];
    far = 22;
    draw = (img, at) => {
      line(img, at([NEAR, 0, -40]), at([NEAR, 0, 40]), rgb, { w: 3, dash: 6 });
      note(img, "NEAR PLANE", at([NEAR, 0, 0])[0] + 6, 30, rgb);
      disc(img, at([0, 0, 0]), 4, [235, 235, 235]);
      note(img, "EYE", at([0, 0, 0])[0] - 30, at([0, 0, 0])[1] + 8, [235, 235, 235]);
      const c = chainAt(m, f);
      const chain = [c.shoulder, c.elbow, c.wrist, c.knuckle].filter(Boolean);
      for (let k = 1; k < chain.length; k++) line(img, at(chain[k - 1]), at(chain[k]), MARK.arm, { w: 2 });
      note(img, "WHAT IS LEFT OF THE LINE IS CUT AWAY", 6, height - 34, rgb);
    };
  } else if (x.key.startsWith("fan.") || x.key.startsWith("plane.") || x.key === "strike.arc" || x.key === "strike.turn") {
    const [lo, hi] = i.plane.frames;
    dir = i.plane.normal;
    if (dot(dir, sub([0, 0, 0], i.plane.mean)) < 0) dir = scale(dir, -1);
    const pts = [...p.tips.slice(lo, hi + 1), ...p.wrists.slice(lo, hi + 1)];
    mid = scale(pts.reduce(add), 1 / pts.length);
    far = Math.max(10, ...pts.map((q) => len(sub(q, mid)))) * 1.15;
    draw = (img, at) => {
      for (let k = lo + 1; k <= hi; k++) {
        line(img, at(p.tips[k - 1]), at(p.tips[k]), PHASE_INK.strike, { w: 3 });
        line(img, at(p.wrists[k - 1]), at(p.wrists[k]), MARK.arm, { w: 3 });
      }
      for (let k = lo; k <= hi; k++) line(img, at(p.wrists[k]), at(p.tips[k]), [235, 235, 235], { a: 0.35 });
      for (const q of i.pivots ?? []) if (q.centre) disc(img, at(q.centre), 3, [200, 120, 255]);
      note(img, `ACROSS THE STRIKE ${lo}-${hi}: TIP (YELLOW) AND WRIST (GREEN), BLADE EACH FRAME`, 6, height - 34, [235, 235, 235], 1);
      note(img, `TURNS ABOUT THE ${i.pivotJoint} (PURPLE DOTS)`, 6, height - 22, [200, 120, 255], 1);
    };
  } else if (x.key.startsWith("reach.") || x.key.startsWith("frame.tipOnScreen")) {
    dir = [0, -1, 0];
    mid = [30, 0, 0];
    far = 45;
    draw = (img, at) => {
      disc(img, at([0, 0, 0]), 4, [235, 235, 235]);
      note(img, "EYE", at([0, 0, 0])[0] - 30, at([0, 0, 0])[1] + 8, [235, 235, 235]);
      const b = x.band;
      if (b && /Depth|Distance/.test(x.key)) {
        for (const v of [b.p5, b.p95]) line(img, at([v, 0, -60]), at([v, 0, 60]), MARK.target, { dash: 4 });
        note(img, `MSR ${fmt(b.p5)}-${fmt(b.p95)}`, at([b.p5, 0, 0])[0] + 4, 30, MARK.target);
      }
      line(img, at([0, 0, EYE_ABOVE_ORIGIN]), at(p.tips[f]), rgb, { w: 2, dash: 4 });
      line(img, at(p.wrists[f]), at(p.tips[f]), rgb, { w: 3 });
      ring(img, at(p.tips[f]), 8, rgb, 1, 3);
      note(img, `TIP ${fmt(p.tips[f][0])} AHEAD`, at(p.tips[f])[0] + 10, at(p.tips[f])[1], rgb);
    };
  } else if (x.key.startsWith("seam.")) {
    dir = [0, -1, 0];
    mid = scale(add(p.tips[f], p.rest.tip), 0.5);
    far = Math.max(15, len(sub(p.tips[f], p.rest.tip)));
    draw = (img, at) => {
      arrow(img, at(p.rest.tip), at(p.tips[f]), rgb, 3);
      note(img, "IDLE TIP", at(p.rest.tip)[0] + 8, at(p.rest.tip)[1] + 8, [235, 235, 235]);
      note(img, `FRAME ${f} TIP`, at(p.tips[f])[0] + 8, at(p.tips[f])[1] - 8, rgb);
    };
  } else return null;

  const view = closeCamera(dir, mid, far, width, height);
  const img = render(src, { ...view.opts, seq: i.index, frame: f, body });
  draw(img, view.at);
  return img;
}

/**
 * Each finding up close (the counted ones first; one per measure kind and frame, `most` at most: 8), named by
 * its key and frame, its line under it. { width (420), height (340), cols (4), most }.
 */
export function closeUps(src, m, list, opts = {}) {
  const i = m.info;
  const body = bodyFor(src, { [i.bodypart]: i.submodel });
  const width = opts.width ?? 420;
  const height = opts.height ?? 340;
  const findings = (opts.findings ?? findingsOf(m, list)).filter((x) => x.key !== "hit");
  const seen = new Set();
  const chosen = [];
  for (const x of findings) {
    const kind = `${jointOf(x.key)?.join(".") ?? x.key.split(".")[0]}|${x.at}`;
    if (seen.has(kind)) continue;
    const img = closeUp(src, m, x, { body, width, height });
    if (!img) continue;
    seen.add(kind);
    chosen.push({ x, img });
    if (chosen.length >= (opts.most ?? 8)) break;
  }
  if (!chosen.length) return null;
  const chars = Math.floor((width - 12) / CHAR);
  const captions = chosen.map(({ x }) => wrap(x.line, chars));
  const rows = Math.max(...captions.map((c) => c.length));
  const tiles = chosen.map(({ x, img }, k) => {
    const out = column([img, blank(width, rows * LINE + 8)]);
    captions[k].forEach((t, r) => label(out, t, 6, height + 6 + r * LINE, 2, SEVERE_INK[x.severity]));
    if (x.severity !== "noise") border(out, SEVERE_INK[x.severity], 3);
    return out;
  });
  const names = chosen.map(({ x }) => `${x.key} FRAME ${x.at} ${phaseAt(i, x.at)}`);
  const strip = grid(tiles, Math.min(opts.cols ?? 4, tiles.length), names);
  return { picture: column([header(m, opts.verdict, findings, strip.width), strip]) };
}

/** All the pictures of one judged sequence: { "eye.png", "plans.png", "timeline.png", "closeups.png" (when any) }. */
export function judgedPictures(src, m, list, verdict, opts = {}) {
  const findings = findingsOf(m, list);
  const o = { ...opts, findings, verdict };
  const out = {
    "eye.png": eyeJudged(src, m, list, o).picture,
    "plans.png": plansJudged(src, m, list, o).picture,
    "timeline.png": timeline(m, list, o).picture,
  };
  const close = closeUps(src, m, list, o);
  if (close) out["closeups.png"] = close.picture;
  return { pictures: out, findings };
}
