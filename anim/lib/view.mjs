// A first-person file seen as the player sees it, and from beside and above: where the weapon's tip goes, how
// far it reaches, and whether it gets to what it is meant to hit.
//
//   camera(options)              the eye's camera: field of view, screen, near plane      -> { project, ... }
//   weaponOf(src, options)       the weapon's submodel, the bone that holds it, the hand, its tip
//   track(src, seq, options)     the tip, the hand and the grip in every frame of a sequence
//   eyeView(src, seq, frame, o)  one frame from the eye, the tip's trail drawn over it     -> picture
//   eyeStrip(src, seq, o)        every n-th frame of that, in one picture
//   plans(src, seq, o)           a side view and a top view: eye, frustum, paths, target  -> picture
//   ink, disc, ring, line, cross, border, INK   the pens the pictures are drawn with (anims/lib/draw.mjs too)
//
// The eye: GoldSrc draws a view model with its origin at the eye (vieworg) and its angles the view's, so in the
// model's space the eye is [0, 0, 0] looking along +x, +y is the player's left and +z is up (the arms of
// v_1hswords come forward along +x, the right hand at -y, below the eye). One unit is about an inch.
import {
  readMdl,
  readMesh,
  restPose,
  poseAt,
  sequences,
  sequenceAt,
  bodyOf,
  boneParents,
  bones as bonesOf,
  apply34,
} from "../../src/mdl.mjs";
import { render, tile, label } from "../../src/render.mjs";

/** The game's default field of view, degrees across a 4:3 screen (default_fov). */
export const FOV = 90;
/** GoldSrc's near plane (gl_znear): a view model's arm nearer the eye than this is cut away. */
export const NEAR = 4;
/** MSR's usual MELEE_RANGE, and the half width of a man: the target stands there. */
export const RANGE = 60;
export const TARGET_RADIUS = 16;
const ASPECTS = { "4:3": 4 / 3, "16:9": 16 / 9, "16:10": 16 / 10 };
const DEGREES = Math.PI / 180;

export const INK = {
  trail: [255, 220, 60],
  path: [150, 150, 150],
  hand: [90, 230, 120],
  hit: [255, 60, 60],
  target: [80, 180, 255],
  frustum: [200, 200, 200],
  blade: [255, 220, 60],
  cross: [235, 235, 235],
};

/**
 * The eye's camera. { fov: degrees across a 4:3 screen as the game's default_fov is (a wider screen sees more
 * to the sides, as GoldSrc has since 2013: Hor+), aspect: "4:3", "16:9", "16:10" or a number, width in
 * pixels, near: the near plane }. `project(p)`: a point of the model to [x, y] on the screen, null behind the
 * near plane. `hfov`, `vfov`: the degrees it sees across and up.
 */
export function camera({ fov = FOV, aspect = "4:3", width = 400, near = NEAR } = {}) {
  const ratio = typeof aspect === "number" ? aspect : ASPECTS[aspect];
  if (!ratio) throw new Error(`aspect ${aspect}: one of ${Object.keys(ASPECTS).join(", ")} or a number`);
  const height = Math.round(width / ratio);
  const half = Math.atan(Math.tan((fov * DEGREES) / 2) * (ratio / (4 / 3)));
  const scale = width / 2 / Math.tan(half);
  const vhalf = Math.atan((height / 2) / scale);
  /** In the camera's space: to the right, up, ahead. */
  const toCamera = (p) => [-p[1], p[2], p[0]];
  const onScreen = ([x, y, z]) => [width / 2 + (x * scale) / z, height / 2 - (y * scale) / z];
  return {
    width,
    height,
    near,
    scale,
    hfov: (2 * half) / DEGREES,
    vfov: (2 * vhalf) / DEGREES,
    fov43: fov,
    toCamera,
    project: (p) => {
      const c = toCamera(p);
      return c[2] < near ? null : onScreen(c);
    },
    /** A segment on the screen, the part behind the near plane cut away; null when all of it is. */
    segment(a, b) {
      let [p, q] = [toCamera(a), toCamera(b)];
      if (p[2] < near && q[2] < near) return null;
      const cut = (u, v) => u.map((x, i) => x + ((v[i] - x) * (near - u[2])) / (v[2] - u[2]));
      if (p[2] < near) p = cut(p, q);
      if (q[2] < near) q = cut(q, p);
      return [onScreen(p), onScreen(q)];
    },
  };
}

/**
 * The body number that shows these submodels: { bodypart (number or name): submodel }, the others at their
 * first.
 */
export function bodyFor(src, chosen = {}) {
  const parts = readMdl(src).bodyparts;
  let body = 0;
  for (const [key, index] of Object.entries(chosen)) {
    const i = /^\d+$/.test(key) ? Number(key) : parts.findIndex((p) => p.name.toLowerCase() === key.toLowerCase());
    if (!parts[i]) throw new Error(`no bodypart ${key}: it has ${parts.map((p) => p.name).join(", ")}`);
    if (!(index < parts[i].models.length)) throw new Error(`bodypart ${parts[i].name} has ${parts[i].models.length} submodels`);
    body += index * parts[i].base;
  }
  return body;
}

/**
 * The weapon of a first-person file as `body` shows it: its bodypart (`bodypart`, else the one with the most
 * submodels, where a shared file keeps its weapons), the submodel shown, the bone that holds it (the one
 * most of its own corners hang on: corners on bones the other bodyparts also use are the arms copied into
 * it), the hand (that bone's nearest forebear named "hand") and the tip: the corner farthest from the hand at
 * rest, kept as its bone and its place on that bone, so that any pose carries it.
 */
export function weaponOf(src, { body = 0, bodypart } = {}) {
  const info = readMdl(src);
  const shown = bodyOf(src, body);
  const part =
    bodypart ?? info.bodyparts.reduce((best, p, i, all) => (p.models.length > all[best].models.length ? i : best), 0);
  const model = info.bodyparts[part].models[shown[part]];
  const corners = model.meshes.flatMap((mesh) => (mesh.numtris ? readMesh(src, model, mesh).flat() : []));
  if (!corners.length) throw new Error(`the submodel ${model.name} is empty: no weapon to follow`);

  // the bones the other bodyparts hang their corners on: the arms
  const armBones = new Set();
  info.bodyparts.forEach((p, i) => {
    if (i === part) return;
    const m = p.models[shown[i]];
    m?.meshes.forEach((mesh) => mesh.numtris && readMesh(src, m, mesh).flat().forEach((c) => armBones.add(c.bone)));
  });
  const own = corners.filter((c) => !armBones.has(c.bone));
  const weapon = own.length ? own : corners;
  const count = new Map();
  weapon.forEach((c) => count.set(c.bone, (count.get(c.bone) ?? 0) + 1));
  const hold = [...count].sort((a, b) => b[1] - a[1])[0][0];

  const parents = boneParents(src);
  const names = bonesOf(src).map((b) => b.name);
  let hand = parents[hold];
  for (let b = hold; b >= 0; b = parents[b])
    if (/hand/i.test(names[b])) {
      hand = b;
      break;
    }

  const rest = restPose(src);
  const handAt = rest[hand].map((r) => r[3]);
  let tip = weapon[0];
  let far = -1;
  for (const c of weapon) {
    const d = Math.hypot(...apply34(rest[c.bone], c.p).map((v, a) => v - handAt[a]));
    if (d > far) [tip, far] = [c, d];
  }
  return {
    bodypart: part,
    submodel: shown[part],
    name: model.name,
    hold,
    hand,
    holdName: names[hold],
    handName: names[hand],
    tip: { bone: tip.bone, at: tip.p },
    length: far,
  };
}

/**
 * The weapon followed through a sequence: [{ frame, time, tip, hand, grip }] (points in the eye's space; hand
 * is the hand bone's origin, the wrist; grip the holding bone's origin), with `seq` (what sequences() tells),
 * `weapon` (weaponOf) and `fastest` (the frame the tip moves most into).
 */
export function track(src, seq, { body = 0, weapon = weaponOf(src, { body }) } = {}) {
  const number = sequenceAt(src, seq);
  if (number < 0) throw new Error(`no sequence ${seq}: it has ${sequences(src).map((s) => s.name).join(", ")}`);
  const info = sequences(src)[number];
  const frames = Array.from({ length: info.frames }, (_, frame) => {
    const pose = poseAt(src, number, frame);
    return {
      frame,
      time: frame / info.fps,
      tip: apply34(pose[weapon.tip.bone], weapon.tip.at),
      hand: pose[weapon.hand].map((r) => r[3]),
      grip: pose[weapon.hold].map((r) => r[3]),
    };
  });
  let fastest = 0;
  let most = -1;
  frames.forEach((f, i) => {
    if (!i) return;
    const d = Math.hypot(...f.tip.map((v, a) => v - frames[i - 1].tip[a]));
    if (d > most) [fastest, most] = [i, d];
  });
  return { seq: { ...info, index: number }, weapon, frames, fastest };
}

// ── drawing over a picture ─────────────────────────────────────────────────

/** One pixel mixed toward `rgb` by `a`. */
export function ink(img, x, y, rgb, a = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  for (let k = 0; k < 3; k++) img.rgba[o + k] = Math.round(img.rgba[o + k] * (1 - a) + rgb[k] * a);
}
/** A filled disc. */
export function disc(img, [x, y], r, rgb, a = 1) {
  for (let j = Math.floor(-r); j <= r; j++)
    for (let i = Math.floor(-r); i <= r; i++) if (i * i + j * j <= r * r) ink(img, x + i, y + j, rgb, a);
}
/** A circle's edge, `w` pixels thick. */
export function ring(img, [x, y], r, rgb, a = 1, w = 1) {
  const steps = Math.max(16, Math.ceil(r * 8));
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * 2 * Math.PI;
    disc(img, [x + r * Math.cos(t), y + r * Math.sin(t)], w / 2, rgb, a);
  }
}
/** A line `w` pixels thick; `dash`: drawn this many pixels, then as many left out. */
export function line(img, p, q, rgb, { a = 1, w = 1, dash = 0 } = {}) {
  const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
  // a pixel stamped twice would be inked twice: mark what one line has inked
  const seen = new Set();
  const r = Math.max(0, (w - 1) / 2);
  for (let s = 0; s <= steps; s++) {
    if (dash && Math.floor(s / dash) % 2) continue;
    const x = p[0] + ((q[0] - p[0]) * s) / steps;
    const y = p[1] + ((q[1] - p[1]) * s) / steps;
    for (let j = Math.floor(-r); j <= Math.ceil(r); j++)
      for (let i = Math.floor(-r); i <= Math.ceil(r); i++) {
        if (i * i + j * j > r * r + 0.5) continue;
        const key = `${Math.round(x + i)},${Math.round(y + j)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ink(img, x + i, y + j, rgb, a);
      }
  }
}
/** A cross of arms `r` long. */
export function cross(img, [x, y], r, rgb, a = 1) {
  line(img, [x - r, y], [x + r, y], rgb, { a });
  line(img, [x, y - r], [x, y + r], rgb, { a });
}
/** A frame about the whole picture. */
export function border(img, rgb, w = 3) {
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (x < w || y < w || x >= img.width - w || y >= img.height - w) ink(img, x, y, rgb);
}

/**
 * The frame meant as the hit: told, else the one the tip comes nearest the contact point (`range` straight
 * ahead) in; the item script's MELEE_DMG_DELAY is the true one, when known.
 */
function hitOf(tracked, hit, range = RANGE) {
  if (hit !== undefined && hit !== null) return Math.max(0, Math.min(tracked.frames.length - 1, hit));
  const off = (p) => Math.hypot(p[0] - range, p[1], p[2]);
  return tracked.frames.reduce((best, f, i) => (off(f.tip) < off(tracked.frames[best].tip) ? i : best), 0);
}

// ── from the eye ───────────────────────────────────────────────────────────

/**
 * One frame as the player sees it, with the target at `range` (its near side; a ring the size of a man's
 * width), the cross at the middle of the screen, the tip's whole path faint, its trail up to this frame bright
 * and fading with age, and the tip at the hit frame a red ring. The hit frame itself has a red frame about it.
 * { body, cam (camera options or one made), tracked (track), hit, range, radius, trail (frames kept bright) }.
 */
export function eyeView(src, seq, frame, opts = {}) {
  const cam = opts.cam?.project ? opts.cam : camera(opts.cam);
  const tracked = opts.tracked ?? track(src, seq, { body: opts.body });
  const { range = RANGE, radius = TARGET_RADIUS } = opts;
  const hit = hitOf(tracked, opts.hit, range);
  const trail = opts.trail ?? Math.max(4, Math.round(tracked.frames.length / 3));
  const img = render(src, {
    view: "first",
    seq: tracked.seq.index,
    frame,
    body: opts.body ?? 0,
    fov: cam.hfov,
    near: cam.near,
    width: cam.width,
    height: cam.height,
  });

  // the target: a man's width at the range, seen past the cross
  const middle = [cam.width / 2, cam.height / 2];
  ring(img, middle, (radius * cam.scale) / (range + radius), INK.target, 0.55);
  cross(img, middle, 5, INK.cross, 0.8);

  const tips = tracked.frames.map((f) => f.tip);
  for (let i = 1; i < tips.length; i++) {
    const s = cam.segment(tips[i - 1], tips[i]);
    if (!s) continue;
    const age = frame - i;
    if (age < 0 || age >= trail) line(img, s[0], s[1], INK.path, { a: 0.35 });
    else line(img, s[0], s[1], INK.trail, { a: 1 - (0.85 * age) / trail, w: 3 });
  }
  const hitAt = cam.project(tips[hit]);
  if (hitAt) ring(img, hitAt, 6, INK.hit, 1, 2);
  const now = cam.project(tips[frame]);
  const colour = frame === hit ? INK.hit : INK.trail;
  if (now && now[0] >= 0 && now[1] >= 0 && now[0] < cam.width && now[1] < cam.height) disc(img, now, 3.5, colour);
  else if (now) {
    // off the screen: a ring on its edge, toward the tip
    const [cx, cy] = middle;
    const k = Math.min((cam.width / 2 - 6) / Math.abs(now[0] - cx || 1e-9), (cam.height / 2 - 6) / Math.abs(now[1] - cy || 1e-9));
    ring(img, [cx + (now[0] - cx) * k, cy + (now[1] - cy) * k], 4, colour, 1, 2);
  }
  if (frame === hit) border(img, INK.hit);
  return img;
}

/**
 * Every `every`-th frame from the eye in one picture (the last and the hit frame always among them), each
 * named by its frame and its time; the hit frame's name says HIT. { cols, ...eyeView's options }.
 */
export function eyeStrip(src, seq, opts = {}) {
  const cam = opts.cam?.project ? opts.cam : camera(opts.cam);
  const tracked = opts.tracked ?? track(src, seq, { body: opts.body });
  const count = tracked.frames.length;
  const hit = hitOf(tracked, opts.hit, opts.range);
  const every = opts.every ?? Math.max(1, Math.ceil(count / 16));
  const chosen = new Set([hit, count - 1]);
  for (let f = 0; f < count; f += every) chosen.add(f);
  const frames = [...chosen].sort((a, b) => a - b);
  const pictures = frames.map((f) => eyeView(src, seq, f, { ...opts, cam, tracked, hit }));
  const names = frames.map(
    (f) => `${tracked.seq.name} ${f}/${count - 1} ${tracked.frames[f].time.toFixed(2)}S${f === hit ? " HIT" : ""}`,
  );
  return { picture: tile(pictures, opts.cols ?? 4, names), frames, hit, cam };
}

// ── from beside and from above ─────────────────────────────────────────────

/** The orbit views that look across the eye's space with ahead (+x) to the picture's right. */
const PLANS = {
  // from the player's right: up is up
  side: { yaw: 270, pitch: 0, right: [1, 0, 0], up: [0, 0, 1], name: "SIDE, FROM THE RIGHT" },
  // from above: the player's left is up
  top: { yaw: 270, pitch: 90, right: [1, 0, 0], up: [0, 1, 0], name: "TOP, LEFT IS UP" },
};

/**
 * One plan: the model at the hit frame, faint; the eye; the frustum's edges and the near plane; the target
 * (a ring at the range's far side of the contact point, the contact point a cross); the blade (grip to tip)
 * at every frame, faint; the hand's path; the tip's path, its colour from dark early to bright late; the hit
 * frame's tip, hand and blade in red.
 */
function plan(src, tracked, which, { cam, body = 0, range, radius, hit, width, height }) {
  const { yaw, pitch, right, up } = PLANS[which];
  const at = (p) => [p[0] * right[0] + p[1] * right[1] + p[2] * right[2], p[0] * up[0] + p[1] * up[1] + p[2] * up[2]];
  const points = tracked.frames.flatMap((f) => [f.tip, f.hand].map(at));
  // what must be in the picture: the eye, the paths and the target
  const xs = [0, ...points.map((p) => p[0]), range + 2 * radius];
  const ys = [0, ...points.map((p) => p[1]), -radius, radius];
  const [x0, x1] = [Math.min(...xs) - 8, Math.max(...xs) + 8];
  const [y0, y1] = [Math.min(...ys) - 8, Math.max(...ys) + 8];
  const scale = Math.min(width / (x1 - x0), (height - 40) / (y1 - y0));
  const mid2 = [(x0 + x1) / 2, (y0 + y1) / 2];
  const mid = [0, 1, 2].map((a) => right[a] * mid2[0] + up[a] * mid2[1]);
  const toPicture = (p) => {
    const [x, y] = at(p);
    return [width / 2 + (x - mid2[0]) * scale, height / 2 - (y - mid2[1]) * scale];
  };

  // the model, by render's own orbit framing made to match ours: its scale is min(w, h) * 0.46 / far
  const img = render(src, {
    view: "orbit",
    yaw,
    pitch,
    seq: tracked.seq.index,
    frame: hit,
    body,
    width,
    height,
    within: { mid, far: (Math.min(width, height) * 0.46) / scale },
  });
  // faint, so that the lines over it are read first
  for (let i = 0; i < img.rgba.length; i += 4)
    for (let k = 0; k < 3; k++) img.rgba[i + k] = Math.round(img.rgba[i + k] * 0.45 + 30 * 0.55);

  // the frustum: across in the top view, up and down in the side view
  const half = ((which === "top" ? cam.hfov : cam.vfov) / 2) * DEGREES;
  const reachOut = x1 - 0;
  const eye = toPicture([0, 0, 0]);
  for (const s of [-1, 1]) {
    const edge = [0, 1, 2].map((a) => right[a] * reachOut + up[a] * s * reachOut * Math.tan(half));
    line(img, eye, toPicture(edge), INK.frustum, { a: 0.6, dash: 4 });
  }
  const nearEdge = (s) => [0, 1, 2].map((a) => right[a] * cam.near + up[a] * s * cam.near * Math.tan(half));
  line(img, toPicture(nearEdge(-1)), toPicture(nearEdge(1)), INK.frustum, { a: 0.9 });
  // straight ahead to the target
  line(img, eye, toPicture([range + 2 * radius, 0, 0]), INK.target, { a: 0.4, dash: 2 });
  ring(img, toPicture([range + radius, 0, 0]), radius * scale, INK.target, 0.8, 2);
  cross(img, toPicture([range, 0, 0]), 6, INK.target);
  disc(img, eye, 4, INK.cross);

  const f = tracked.frames;
  f.forEach((g) => line(img, toPicture(g.grip), toPicture(g.tip), INK.blade, { a: 0.12 }));
  for (let i = 1; i < f.length; i++) {
    line(img, toPicture(f[i - 1].hand), toPicture(f[i].hand), INK.hand, { a: 0.9, w: 2 });
    // early dark, late bright: which way it goes
    const t = 0.3 + (0.7 * i) / (f.length - 1);
    line(img, toPicture(f[i - 1].tip), toPicture(f[i].tip), INK.trail.map((v) => v * t), { w: 2 });
  }
  disc(img, toPicture(f[0].tip), 3, [255, 255, 255]);
  line(img, toPicture(f[hit].grip), toPicture(f[hit].tip), INK.hit, { w: 2 });
  disc(img, toPicture(f[hit].tip), 4, INK.hit);
  disc(img, toPicture(f[hit].hand), 3, INK.hit);

  // a scale bar of ten units
  const bar = [10, height - 14];
  line(img, bar, [bar[0] + 10 * scale, bar[1]], INK.cross, { w: 2 });
  label(img, "10", Math.round(bar[0] + 10 * scale + 6), bar[1] - 4, 2);
  label(img, PLANS[which].name, 6, 6, 2);
  return img;
}

/** The band under the plans for the line that says how the tip stands to the target. */
const FOOT = 24;
/** Two pictures one under the other, and a dark band of `foot` pixels under them for a line of text. */
function stack(a, b, foot = 0) {
  const width = Math.max(a.width, b.width);
  const height = a.height + b.height + foot;
  const out = { width, height, rgba: new Uint8Array(width * height * 4) };
  for (let i = 0; i < width * height; i++) out.rgba.set([20, 22, 26, 255], i * 4);
  [a, b].forEach((img, n) => {
    const top = n ? a.height : 0;
    for (let y = 0; y < img.height; y++)
      out.rgba.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), (top + y) * width * 4);
  });
  return out;
}

/**
 * How the tip stands to the target: at the hit frame its depth ahead of the eye (`ahead`), right, up and its
 * distance from the contact point (`miss`); over the sequence the frame it comes nearest the contact point
 * and how near, and the farthest it reaches ahead.
 */
export function reachOf(tracked, { range = RANGE, hit } = {}) {
  const h = hitOf(tracked, hit, range);
  const contact = [range, 0, 0];
  const off = (p) => Math.hypot(...p.map((v, a) => v - contact[a]));
  const tip = tracked.frames[h].tip;
  let nearest = 0;
  tracked.frames.forEach((f, i) => off(f.tip) < off(tracked.frames[nearest].tip) && (nearest = i));
  return {
    hit: h,
    ahead: tip[0],
    right: -tip[1],
    up: tip[2],
    miss: off(tip),
    nearest,
    nearestMiss: off(tracked.frames[nearest].tip),
    farthest: Math.max(...tracked.frames.map((f) => f.tip[0])),
  };
}

/**
 * The side view and the top view of a sequence, one under the other, with a line of what the tip does at the
 * hit frame. { body, cam, tracked, hit, range, radius, width (720), height (420 each) }.
 */
export function plans(src, seq, opts = {}) {
  const cam = opts.cam?.project ? opts.cam : camera(opts.cam);
  const tracked = opts.tracked ?? track(src, seq, { body: opts.body });
  const { range = RANGE, radius = TARGET_RADIUS, width = 720, height = 420 } = opts;
  const hit = hitOf(tracked, opts.hit, range);
  const o = { cam, body: opts.body, range, radius, hit, width, height };
  const picture = stack(plan(src, tracked, "side", o), plan(src, tracked, "top", o), FOOT);
  const r = reachOf(tracked, { range, hit });
  const say = (v) => v.toFixed(0);
  label(
    picture,
    `${tracked.seq.name} HIT ${hit}: TIP AHEAD ${say(r.ahead)} RIGHT ${say(r.right)} UP ${say(r.up)} MISS ${say(r.miss)} RANGE ${range}`,
    6,
    picture.height - FOOT + 6,
    2,
  );
  return { picture, reach: r };
}
