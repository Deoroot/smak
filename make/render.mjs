// A model drawn into a picture, with nothing but arithmetic: no browser, no GPU. This is how whoever works on
// a model (an agent above all) sees what it has made before the game does.
//
//   render(src, options)  one view              -> { width, height, rgba }
//   sheet(src, options)   six views, labelled   -> the same
//   strip(src, options)   an animation, frame by frame
//   uvMap(src, which)     a texture with every triangle that wears it drawn over it
//
// The light is a plain stand-in for the engine's: shapes, proportions, seams, textures and poses are true,
// the brightness is not. A model faces +x; +y is its left, +z is up. One unit is about an inch.
import {
  readMdl,
  readMesh,
  restPose,
  poseAt,
  poseBetween,
  sequences,
  sequenceAt,
  skinFamilies,
  bodyOf,
  apply34,
  bones as bonesOf,
  events as eventsOf,
} from "../core/mdl.mjs";
import { sub, dot, cross, unit } from "../core/vec.mjs";
import { FRONT } from "./mesh.mjs";
import { bytesOf, mapScaleOf, drawLine } from "../core/pixels.mjs";

/** The flags of a texture that change how its mesh is drawn. */
export const TEXTURE = { flat: 1, chrome: 2, fullbright: 4, additive: 32, masked: 64 };

/** In a masked texture, the palette index that is a hole. */
const HOLE_INDEX = 255;
/** Each pixel of a picture is drawn as this many dots each way, and their mean taken: smooth edges. */
const SUPERSAMPLE = 2;
/** The colour a picture starts as, and the colour of a mesh that has no texture. */
const BACKGROUND = [58, 62, 70];
const NO_TEXTURE = [150, 150, 150];
/** At zoom 1 the model's reach fills this share of the picture's shorter side, from its middle. */
const FIT = 0.46;
/**
 * A camera looking this nearly straight up or down (the sine of its pitch) takes its "right" from its yaw.
 */
const NEARLY_UPRIGHT = 0.999;
/** The stand-in light: every face gets `AMBIENT`, and up to `DIRECT` more as it turns to the lamp. */
const AMBIENT = 0.38;
const DIRECT = 0.62;
/** Where the lamp is, seen from the camera: behind it, above it and to its left. */
const LAMP = { back: 0.7, up: 0.6, left: 0.35 };
/**
 * What is nearer the eye than this is cut off: in first person a unit; with `dist`, a fiftieth of it (0.5
 * least).
 */
const NEAR_FIRST = 1;
const NEAR_SHARE = 50;
const NEAR_LEAST = 0.5;
/** A triangle of less than this on the screen (twice its area, in dots) is not drawn. */
const FLAT_ON_SCREEN = 1e-9;
/** The least reach a model is framed by, so that a model of one point is not divided by nothing. */
const LEAST_REACH = 1e-6;
/**
 * The views that have a name beside "orbit" and "first": where the camera of an orbit view stands for each.
 * "side" is the model's left side, so its front (+x) is to the picture's left.
 */
export const NAMED_VIEWS = {
  side: { yaw: 90, pitch: 0 },
  front: { yaw: 0, pitch: 0 },
  top: { yaw: 0, pitch: 90 },
};
/** The colour of the ground's line. */
const GROUND = [240, 200, 70];
/** The base a first-person fov is given on (GoldSrc's 4:3), and the shapes `screen` knows by name. */
const BASE_ASPECT = 4 / 3;
const SCREENS = { "16:9": 16 / 9, "4:3": 4 / 3, "16:10": 16 / 10 };
/** The game's eye cuts what is nearer than this (GoldSrc's and Xash's near plane, 4 units). */
export const GAME_NEAR = 4;
/** The game's eye's picture is this wide unless told (the height follows the screen's shape). */
const GAME_WIDTH = 640;

/** A screen's shape as width over height: "16:9", "4:3", "16:10" or "w:h". */
export function aspectOf(screen) {
  if (SCREENS[screen]) return SCREENS[screen];
  const [w, h] = String(screen).split(":").map(Number);
  if (!(w > 0 && h > 0)) throw new Error(`screen: 16:9, 4:3, 16:10 or w:h, not ${screen}`);
  return w / h;
}

/**
 * The game's eye on a screen of the shape `screen` names, the fov given on a 4:3 base and widened Hor+ (as Xash with
 * r_adjust_fov 1: the vertical kept, 90 on 4:3 is 106.26 across 16:9): { width, height, fov (across), vfov, near }.
 */
export function gameEye({ screen = "16:9", fov = 90, width = GAME_WIDTH } = {}) {
  const aspect = aspectOf(screen);
  const half = Math.tan((fov * Math.PI) / 360);
  const across = (Math.atan((half * aspect) / BASE_ASPECT) * 360) / Math.PI;
  const vfov = (Math.atan(half / BASE_ASPECT) * 360) / Math.PI;
  return { width, height: Math.round(width / aspect), fov: across, vfov, near: GAME_NEAR };
}

/** `opts` with a first-person `screen` made the game's eye's size, fov and near plane; others as they are. */
const withScreen = (opts) => {
  if (opts.view !== "first" || !opts.screen) return opts;
  const eye = gameEye({ ...opts, width: opts.width ?? GAME_WIDTH });
  return { ...opts, width: eye.width, height: eye.height, fov: eye.fov, near: opts.near ?? eye.near };
};

/**
 * The bones `list` names (names or numbers) and every bone under them, as a Set of numbers; null for no list (every
 * bone). For the meshes of an arm by its forearm.
 */
export function bonesUnder(src, list) {
  if (!list?.length) return null;
  const all = bonesOf(src);
  const asked = list.map((b) => (typeof b === "number" || /^\d+$/.test(b) ? Number(b) : all.findIndex((x) => x.name.toLowerCase() === String(b).toLowerCase())));
  const missing = list.filter((_, i) => !(asked[i] >= 0 && asked[i] < all.length));
  if (missing.length) throw new Error(`no bone ${missing.join(", ")}: it has ${all.map((b) => b.name).join(", ")}`);
  const set = new Set(asked);
  for (let b = 0; b < all.length; b++) if (set.has(all[b].parent)) set.add(b);
  return set;
}
/** The triangles of `tris` on the bones of `set` (a triangle is its first corner's bone's); all of them for no set. */
export const trisOn = (tris, set) => (set ? tris.filter((t) => set.has(t.c[0].bone)) : tris);

/**
 * The model's triangles as it is shown: { seq (a name or a number; null: the bones at rest), frame (may fall
 * between two), pose (matrices of its own, instead), body, skin, groups (the files of animations kept beside
 * the model, as sequenceFilesOf reads them: without them such an animation is shown at rest) }. Each triangle:
 * { tex, where, tri, c: [{ p, n, u, v, bone }] } in model space, u and v in pixels; `where` is its mesh
 * ({ bodypart, model, mesh }), `tri` its number in that mesh (as readMesh lists them), `bone` a bone's number.
 */
export function posed(src, { seq = 0, frame = 0, pose, body = 0, skin = 0, groups } = {}) {
  const info = readMdl(src);
  const list = sequences(src);
  const number = seq === null ? -1 : sequenceAt(src, seq);
  if (seq !== null && number < 0 && list.length)
    throw new Error(`no animation ${seq}: it has ${list.map((s) => s.name).join(", ")}`);

  // the bones' matrices: given, or of a frame of the animation (a whole one, or between two), or at rest
  let matrices = pose;
  if (!matrices) {
    const animated = number >= 0 && (!list[number].group || Boolean(groups?.[list[number].group]));
    if (!animated) matrices = restPose(src);
    else if (Number.isInteger(frame))
      matrices = poseAt(src, number, Math.max(0, Math.min(frame, list[number].frames - 1)), 0, groups);
    else matrices = poseBetween(src, number, frame, list[number].loops, groups);
  }

  const families = skinFamilies(src);
  const family = families[skin] ?? families[0] ?? [];
  const shown = bodyOf(src, body);
  const tris = [];
  info.bodyparts.forEach((bodypart, i) => {
    const model = bodypart.models[shown[i]];
    if (!model) return;
    model.meshes.forEach((mesh, k) => {
      if (!mesh.numtris) return;
      const tex = info.textures[family[mesh.skinref]] ?? mesh.texture ?? null;
      const where = { bodypart: i, model: shown[i], mesh: k };
      readMesh(src, model, mesh).forEach((corners, tri) =>
        tris.push({
          tex,
          where,
          tri,
          c: corners.map((c) => ({
            p: apply34(matrices[c.bone], c.p),
            n: matrices[c.bone].map((row) => row[0] * c.n[0] + row[1] * c.n[1] + row[2] * c.n[2]),
            u: c.s,
            v: c.t,
            bone: c.bone,
          })),
        }),
      );
    });
  });
  return { info, tris, pose: matrices };
}

/** Every corner's point of a list of triangles (as `posed` gives them). */
const pointsOf = (tris) => tris.flatMap((t) => t.c.map((c) => c.p));
/** The middle of the box about some points. */
function middleOf(points) {
  const mn = [0, 1, 2].map((a) => points.reduce((v, p) => Math.min(v, p[a]), Infinity));
  const mx = [0, 1, 2].map((a) => points.reduce((v, p) => Math.max(v, p[a]), -Infinity));
  return mn.map((v, a) => (v + mx[a]) / 2);
}
/** How far the farthest of some points is from `mid`. */
const reachOf = (points, mid) =>
  points.reduce((v, p) => Math.max(v, Math.hypot(...sub(p, mid))), LEAST_REACH);

/**
 * The middle and the reach of the model over several poses ([options as posed takes them]): what `within`
 * takes, so that they are all drawn to one scale.
 */
export function framing(src, list) {
  const points = list.flatMap((options) => pointsOf(options.tris ?? posed(src, options).tris));
  if (!points.length) return { mid: [0, 0, 0], far: 1 };
  const mid = middleOf(points);
  return { mid, far: reachOf(points, mid) };
}

/**
 * The camera of a view: `right`, `up` and `forward` in model space, where it stands (`eye`, with perspective)
 * or what it looks at (`mid`, without), and `scale`, the dots a unit takes (at one unit from the eye, with
 * perspective).
 * `wide`, `high`: the picture in dots.
 */
function cameraOf(opts, points, wide, high) {
  const { yaw = 30, pitch = 15, fov = 90, zoom = 1 } = opts;
  const degrees = Math.PI / 180;
  const perspectiveScale = wide / 2 / Math.tan((fov * degrees) / 2);
  if (opts.view === "first")
    return {
      right: [0, -1, 0],
      up: [0, 0, 1],
      forward: [1, 0, 0],
      eye: [0, 0, 0],
      mid: [0, 0, 0],
      scale: perspectiveScale,
    };

  // from the point looked at to the camera
  const back = [
    Math.cos(pitch * degrees) * Math.cos(yaw * degrees),
    Math.cos(pitch * degrees) * Math.sin(yaw * degrees),
    Math.sin(pitch * degrees),
  ];
  const forward = back.map((v) => -v);
  const right = unit(
    Math.abs(back[2]) > NEARLY_UPRIGHT
      ? [-Math.sin(yaw * degrees), Math.cos(yaw * degrees), 0]
      : cross(forward, [0, 0, 1]),
  );
  const up = cross(right, forward);

  // what it looks at and how far the model reaches from there: this pose's own, unless told
  let mid = [0, 0, 0];
  if (points.length) mid = middleOf(points);
  let far = reachOf(points, mid);
  if (opts.within) {
    mid = opts.within.mid;
    far = opts.within.far;
  }
  if (opts.target) mid = opts.target;

  if (opts.dist > 0)
    return {
      right,
      up,
      forward,
      eye: mid.map((v, a) => v + back[a] * opts.dist),
      mid,
      scale: perspectiveScale,
    };
  return { right, up, forward, eye: [0, 0, 0], mid, scale: ((Math.min(wide, high) * FIT) / far) * zoom };
}

/**
 * Where a point of the model lands in a picture `render` would draw with the same options (an orbit view with no
 * perspective): `(p) -> [x, y]` in pixels from the top left, and the bones' matrices of that pose (`pose`). For a
 * picture drawn over a render, such as the skeleton a pose-guided drawing follows.
 */
export function placeIn(src, opts = {}) {
  if (NAMED_VIEWS[opts.view]) opts = { ...opts, yaw: NAMED_VIEWS[opts.view].yaw + (opts.yaw ?? 0), pitch: NAMED_VIEWS[opts.view].pitch + (opts.pitch ?? 0), view: "orbit" };
  if (opts.view === "first" || opts.dist > 0) throw new Error("placeIn: an orbit view with no perspective only");
  const { width = 512, height = 512 } = opts;
  const { tris, pose } = posed(src, opts);
  const { right, up, mid, scale } = cameraOf(opts, pointsOf(tris), width, height);
  return { pose, at: (p) => [width / 2 + dot(sub(p, mid), right) * scale, height / 2 - dot(sub(p, mid), up) * scale] };
}

/**
 * A polygon ([[x, y, z, ...], ...] in the camera's space) with what is nearer the eye than `near` cut off at
 * that plane.
 */
function cutNear(polygon, near) {
  const cut = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if (a[2] >= near) cut.push(a);
    if (a[2] >= near !== b[2] >= near) {
      const k = (near - a[2]) / (b[2] - a[2]);
      cut.push(a.map((v, j) => v + (b[j] - v) * k));
    }
  });
  return cut;
}

/**
 * One view of the model.
 *   view        "orbit" (from outside, no perspective: sizes can be compared) or "first" (as the player sees
 *               a view model: the eye at the model's origin looking along +x, `fov` degrees across)
 *   yaw, pitch  orbit: where the camera stands, in degrees. yaw 0 looks at the model's front, 90 at its left
 *               side, 180 at its back; pitch 90 looks straight down on it
 *   zoom, target  orbit: closer or farther (1 fits the model), and the point looked at (the middle of the
 *               model unless told)
 *   dist        orbit: the eye stands this many units from the point looked at and the picture has
 *               perspective, `fov` degrees across, as the editor's page looks at a model; `zoom` and `within`
 *               then say nothing
 *   within      orbit: { mid, far } to frame the picture by instead of this pose's own size (see framing):
 *               several pictures to one scale
 *               "side", "front" or "top": an orbit view from there (NAMED_VIEWS). A `yaw` or `pitch` given with
               one turns the camera on from there: "front" with yaw 205 looks from 205, "side" with yaw 30 from
               120 (the left side, turned 30 further round), "top" with yaw 90 has the model's left at the top
 *   ground      true: a line across the picture where z = 0 is, the floor a thing stands on, drawn over the
 *               model so that a foot under it is seen crossed. Only a level orbit view has such a line
 *               (pitch 0: "side", "front"); any other is refused
 *   near        with perspective: what is nearer the eye than this is cut off (GoldSrc cuts at 4: gl_znear)
 *   width, height, background [r, g, b], light (false: the texture as it is), cull (false: both sides of
 *   every triangle; "solid": both sides of every triangle but a masked one's, whose holes show its far side
 *   on purpose: a net)
 *   seq, frame, pose, body, skin, groups   as in posed
 *   parts       only these bodyparts are drawn (their numbers), and the picture is framed by them alone: the
 *               weapon of a first-person file without the arms that hold it
 *   screen      first person: the game's eye on a screen of this shape ("16:9", "4:3", "16:10", "w:h"): the
 *               picture's height follows it, `fov` (90 unless told) is the 4:3 base widened Hor+ and the near
 *               plane is the game's 4 (gameEye)
 *   depth       true: the answer has the depth of every dot too ({ depth, dots, at, near }), for a measure
 *   inside      with depth: every triangle drawn from both sides, and `inside` says of each dot the bone (+ 1) of the
 *               mesh whose inside is the nearest thing there (0: an outside, or nothing): where the screen shows into
 *               a mesh, through its open end or a cut of the near plane
 * A triangle seen from behind is not drawn, as in the game: a hole in the picture is a triangle the wrong way
 * round.
 */
export function render(src, opts = {}) {
  if (NAMED_VIEWS[opts.view]) {
    const named = NAMED_VIEWS[opts.view];
    opts = { ...opts, yaw: named.yaw + (opts.yaw ?? 0), pitch: named.pitch + (opts.pitch ?? 0), view: "orbit" };
  }
  opts = withScreen(opts);
  const first = opts.view === "first";
  const perspective = first || opts.dist > 0;
  const {
    width = first ? 640 : 512,
    height = first ? 480 : 512,
    background = BACKGROUND,
    light = true,
    cull = true,
  } = opts;
  // `tris`: triangles of another kind of model, as posed gives them (a Source model's, source/draw.mjs), each
  // `tex` with its own `rgba`; `src` is then not read
  const all = opts.tris ?? posed(src, opts).tris;
  const tris = opts.parts ? all.filter((t) => opts.parts.includes(t.where.bodypart)) : all;

  // the picture in dots, several to a pixel: each dot's colour, and how far from the camera what it shows is
  const wide = width * SUPERSAMPLE;
  const high = height * SUPERSAMPLE;
  const colour = new Float32Array(wide * high * 3);
  const depth = new Float32Array(wide * high).fill(Infinity);
  // with `inside`: each dot's nearest triangle's bone + 1 when it is seen from behind (the inside of a mesh), else 0
  const inside = opts.inside ? new Int16Array(wide * high) : null;
  for (let i = 0; i < wide * high; i++) colour.set(background, i * 3);

  const { right, up, forward, eye, mid, scale } = cameraOf(opts, pointsOf(tris), wide, high);
  /** A point of the model in the camera's space: to its right, above it, in front of it. */
  const toCamera = (p) => {
    const d = sub(p, perspective ? eye : mid);
    return [dot(d, right), dot(d, up), dot(d, forward)];
  };
  const lamp = unit([0, 1, 2].map((a) => -forward[a] * LAMP.back + up[a] * LAMP.up - right[a] * LAMP.left));
  const near = opts.near ?? (first || !perspective ? NEAR_FIRST : Math.max(NEAR_LEAST, opts.dist / NEAR_SHARE));

  const pictures = new Map();
  const pictureOf = (texture) => {
    if (!pictures.has(texture)) pictures.set(texture, texture.rgba ? texture : bytesOf(src, texture));
    return pictures.get(texture);
  };

  /** Draws one triangle; `added`: its colour is added to what is there, and it hides nothing (a glow). */
  const draw = (t, added) => {
    const tex = t.tex;
    const flags = tex?.flags ?? 0;
    const picture = tex ? pictureOf(tex) : null;
    // seen from behind?
    const facing = cross(sub(t.c[1].p, t.c[0].p), sub(t.c[2].p, t.c[0].p)).map((v) => v * FRONT);
    const behind = dot(facing, perspective ? sub(eye, t.c[0].p) : forward.map((v) => -v)) <= 0;
    if (behind && !inside && (cull === true || (cull === "solid" && flags & 64))) return;

    // each corner in the camera's space, with its place in the texture and its light: [x, y, z, u, v, light]
    const unlit = !light || flags & (TEXTURE.fullbright | TEXTURE.additive);
    let polygon = t.c.map((c) => {
      const [x, y, z] = toCamera(c.p);
      const lit = unlit ? 1 : AMBIENT + DIRECT * (0.5 + 0.5 * dot(unit(c.n), lamp));
      // chrome takes its place in the texture from the way the surface faces the camera
      const [u, v] =
        flags & TEXTURE.chrome && tex
          ? [(0.5 + 0.5 * dot(c.n, right)) * tex.width, (0.5 - 0.5 * dot(c.n, up)) * tex.height]
          : [c.u, c.v];
      return [x, y, z, u, v, lit];
    });
    if (perspective) {
      // what is behind the eye is cut off at a plane just in front of it
      polygon = cutNear(polygon, near);
      if (polygon.length < 3) return;
    }

    // on the screen; with perspective everything is divided by the distance (`w` is 1 / z), to be mixed truly
    const corners = polygon.map(([x, y, z, u, v, lit]) => {
      const w = perspective ? 1 / z : 1;
      return {
        x: wide / 2 + x * scale * w,
        y: high / 2 - y * scale * w,
        z,
        w,
        u: u * w,
        v: v * w,
        l: lit * w,
      };
    });
    for (let i = 1; i + 1 < corners.length; i++) {
      const a = corners[0];
      const b = corners[i];
      const c = corners[i + 1];
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (Math.abs(area) < FLAT_ON_SCREEN) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
      const x1 = Math.min(wide - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
      const y1 = Math.min(high - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          // the dot's middle as the three corners weighed
          const px = x + 0.5;
          const py = y + 0.5;
          const wa = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / area;
          const wb = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / area;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const w = wa * a.w + wb * b.w + wc * c.w;
          const z = perspective ? 1 / w : wa * a.z + wb * b.z + wc * c.z;
          const dotAt = y * wide + x;
          if (z >= depth[dotAt]) continue;
          let rgb = NO_TEXTURE;
          if (picture) {
            const u = Math.floor((wa * a.u + wb * b.u + wc * c.u) / w);
            const v = Math.floor((wa * a.v + wb * b.v + wc * c.v) / w);
            // the texture repeats past its edges
            const texel =
              (((v % tex.height) + tex.height) % tex.height) * tex.width + (((u % tex.width) + tex.width) % tex.width);
            if (picture.rgba) {
              // a picture of its own colours (a Source model's): a hole is where its alpha is under half
              if (flags & TEXTURE.masked && picture.rgba[texel * 4 + 3] < 128) continue;
              rgb = [picture.rgba[texel * 4], picture.rgba[texel * 4 + 1], picture.rgba[texel * 4 + 2]];
            } else {
              const index = picture.pixels[texel];
              if (flags & TEXTURE.masked && index === HOLE_INDEX) continue;
              rgb = [
                picture.palette[index * 3],
                picture.palette[index * 3 + 1],
                picture.palette[index * 3 + 2],
              ];
            }
          }
          const lit = (wa * a.l + wb * b.l + wc * c.l) / w;
          if (added) for (let k = 0; k < 3; k++) colour[dotAt * 3 + k] += rgb[k];
          else {
            depth[dotAt] = z;
            if (inside) inside[dotAt] = behind ? t.c[0].bone + 1 : 0;
            for (let k = 0; k < 3; k++) colour[dotAt * 3 + k] = rgb[k] * lit;
          }
        }
    }
  };
  // what is drawn additively (a glow) is added over the rest, and hides nothing
  const glows = (t) => (t.tex?.flags ?? 0) & TEXTURE.additive;
  for (const t of tris) if (!glows(t)) draw(t, false);
  for (const t of tris) if (glows(t)) draw(t, true);

  if (opts.ground) {
    if (perspective || Math.abs(up[2]) < NEARLY_UPRIGHT)
      throw new Error(
        'ground: the line of z = 0 is drawn in a level view with no perspective (pitch 0: view "side" or "front"); seen from above or below the ground is not a line',
      );
    // a point at z = 0 is mid[2] below what the camera looks at, whatever its x and y: one row of the
    // picture, and the whole of that row's dots, so that the line is one pixel of its own colour
    const row = Math.floor((high / 2 + mid[2] * scale) / SUPERSAMPLE) * SUPERSAMPLE;
    for (let y = Math.max(0, row); y < Math.min(high, row + SUPERSAMPLE); y++)
      for (let x = 0; x < wide; x++) colour.set(GROUND, (y * wide + x) * 3);
  }

  // each pixel the mean of its dots
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let j = 0; j < SUPERSAMPLE; j++)
          for (let i = 0; i < SUPERSAMPLE; i++)
            sum += Math.min(255, colour[((y * SUPERSAMPLE + j) * wide + x * SUPERSAMPLE + i) * 3 + k]);
        rgba[o + k] = Math.round(sum / (SUPERSAMPLE * SUPERSAMPLE));
      }
      rgba[o + 3] = 255;
    }
  if (!opts.depth) return { width, height, rgba };
  // with `depth`: how far from the eye each dot shows something (Infinity: nothing), `dots` to a pixel each way, and
  // where a point of the model lands among those dots ([x, y, z], z its distance; null nearer than the cut)
  const at = (p) => {
    const [x, y, z] = toCamera(p);
    if (perspective && z < near) return null;
    const w = perspective ? 1 / z : 1;
    return [wide / 2 + x * scale * w, high / 2 - y * scale * w, z];
  };
  return { width, height, rgba, depth, inside, dots: SUPERSAMPLE, at, near };
}

// ── several pictures in one, with their names ──────────────────────────────
// Letters of 3 by 5 dots, a row to three bits, the top row first.
const GLYPHS = {
  0: [7, 5, 5, 5, 7],
  1: [2, 6, 2, 2, 7],
  2: [7, 1, 7, 4, 7],
  3: [7, 1, 7, 1, 7],
  4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7],
  6: [7, 4, 7, 5, 7],
  7: [7, 1, 1, 1, 1],
  8: [7, 5, 7, 5, 7],
  9: [7, 5, 7, 1, 7],
  A: [7, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [7, 4, 4, 4, 7],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 7, 4, 7],
  F: [7, 4, 7, 4, 4],
  G: [7, 4, 5, 5, 7],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [1, 1, 1, 5, 7],
  K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  N: [6, 5, 5, 5, 5],
  O: [7, 5, 5, 5, 7],
  P: [7, 5, 7, 4, 4],
  Q: [7, 5, 5, 7, 1],
  R: [7, 5, 6, 5, 5],
  S: [7, 4, 7, 1, 7],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  "-": [0, 0, 7, 0, 0],
  ".": [0, 0, 0, 0, 2],
  _: [0, 0, 0, 0, 7],
  ":": [0, 2, 0, 2, 0],
  "/": [1, 1, 2, 4, 4],
  "=": [0, 7, 0, 7, 0],
  "+": [0, 2, 7, 2, 0],
  "(": [1, 2, 2, 2, 1],
  ")": [4, 2, 2, 2, 4],
  ",": [0, 0, 0, 2, 4],
};
/** A character the letters do not have is left blank. */
const NO_GLYPH = [0, 0, 0, 0, 0];
const GLYPH_WIDE = 3;
/** From one letter to the next, and the height of the dark band a line of them stands on (both in dots). */
const GLYPH_STEP = 4;
const BAND_HIGH = 6;
/** The dark band under a label, and the ground between tiled pictures. */
const DARK = [20, 22, 26];
/** Where a tile's name is written, from its corner. */
const NAME_AT = 6;

/** Writes `text` into a picture at (x, y), each dot `k` pixels, light on a dark band. */
/**
 * Text in the labels' letters as a mask: `{ width, height, at(x, y) }`, `at` true on a letter's dot, each dot
 * `k` pixels square. Capitals, digits and a few marks (others are blank); for painting a word on a picture.
 */
export function textMask(text, k = 1) {
  const letters = String(text).toUpperCase();
  const width = Math.max(1, (letters.length * GLYPH_STEP - 1) * k);
  const height = 5 * k;
  const at = (x, y) => {
    const n = Math.floor(x / k / GLYPH_STEP);
    const bit = Math.floor(x / k) - n * GLYPH_STEP;
    const row = Math.floor(y / k);
    if (n < 0 || n >= letters.length || bit >= GLYPH_WIDE || row < 0 || row >= 5) return false;
    return !!((GLYPHS[letters[n]] ?? NO_GLYPH)[row] & (4 >> bit));
  };
  return { width, height, at };
}

export function label(img, text, x, y, k = 2, colour = [235, 235, 235]) {
  const letters = String(text).toUpperCase();
  const put = (px, py, c) => {
    if (px >= 0 && py >= 0 && px < img.width && py < img.height)
      img.rgba.set([...c, 255], (py * img.width + px) * 4);
  };
  // the band: a dot of margin about the letters
  for (let j = -k; j < BAND_HIGH * k; j++)
    for (let i = -k; i < letters.length * GLYPH_STEP * k; i++) put(x + i, y + j, DARK);
  [...letters].forEach((letter, n) =>
    (GLYPHS[letter] ?? NO_GLYPH).forEach((row, r) => {
      for (let bit = 0; bit < GLYPH_WIDE; bit++)
        if (row & (4 >> bit))
          for (let j = 0; j < k; j++)
            for (let i = 0; i < k; i++) put(x + (n * GLYPH_STEP + bit) * k + i, y + r * k + j, colour);
    }),
  );
  return img;
}

/** Pictures of one size side by side, `cols` to a row, each with its name in its corner. */
export function tile(images, cols, names = []) {
  const w = images[0].width;
  const h = images[0].height;
  const rows = Math.ceil(images.length / cols);
  const out = { width: w * cols, height: h * rows, rgba: new Uint8Array(w * cols * h * rows * 4).fill(255) };
  for (let i = 0; i < out.width * out.height; i++) out.rgba.set([...DARK, 255], i * 4);
  images.forEach((img, n) => {
    const left = (n % cols) * w;
    const top = Math.floor(n / cols) * h;
    for (let y = 0; y < h; y++)
      out.rgba.set(img.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((top + y) * out.width + left) * 4);
    if (names[n] !== undefined) label(out, names[n], left + NAME_AT, top + NAME_AT);
  });
  return out;
}

/**
 * Several models side by side to one scale, each from the same sides, named: for before and after.
 * `list`: [[name, model], ...]; the first sets the scale.
 * { yaws ([20, 200]), pitch, zoom, width, height, cols, target, seq, frame, body, skin }.
 */
export function lineup(
  list,
  { yaws = [20, 200], pitch = 6, zoom = 1.25, width = 300, height = 520, cols = null, target, ...pose } = {},
) {
  const within = framing(list[0][1], [pose]);
  const shots = [];
  const names = [];
  for (const [name, mdl] of list)
    yaws.forEach((yaw, i) => {
      shots.push(render(mdl, { ...pose, yaw, pitch, width, height, zoom, within, target }));
      // a model's name on the first of its pictures only
      names.push(i ? "" : name);
    });
  return tile(shots, cols ?? Math.min(shots.length, yaws.length * 4), names);
}

/** The six views of `sheet`: [name, yaw, pitch]. */
const SIX_VIEWS = [
  ["front", 0, 0],
  ["left side", 90, 0],
  ["back", 180, 0],
  ["right side", 270, 0],
  ["top", 0, 90],
  ["three quarter", 35, 20],
];

/**
 * Six views of the model in one picture: front, left side, back, right side, from above, and three quarters.
 */
export function sheet(src, opts = {}) {
  const size = opts.size ?? 384;
  const within = opts.within ?? framing(src, [opts]);
  return tile(
    SIX_VIEWS.map(([, yaw, pitch]) =>
      render(src, { ...opts, view: "orbit", within, yaw, pitch, width: size, height: size }),
    ),
    3,
    SIX_VIEWS.map((view) => view[0]),
  );
}

/** A colour along time, from cold (0, blue) to warm (1, red), through cyan, green and yellow. */
export function inkAlong(t) {
  const h = (1 - Math.max(0, Math.min(1, t))) * 4; // 4 blue .. 0 red, by the hue's sixths
  const k = h - Math.floor(h);
  const stops = [[255, 40, 30], [255, 220, 30], [60, 230, 60], [40, 220, 255], [60, 90, 255]];
  const a = stops[Math.min(4, Math.floor(h))];
  const b = stops[Math.min(4, Math.floor(h) + 1)];
  return a.map((v, i) => Math.round(v + (b[i] - v) * k));
}
/** A silhouette's dots are those this bright or more in a mask drawn grey on black (half NO_TEXTURE: a dot half covered). */
const MASK_LEAST = 75;
/** An onion skin's fill: each frame's silhouette tints the picture this much of its colour. */
const ONION_FILL = 0.1;
const MARK_INK = [255, 255, 255];

/**
 * The dots a set of triangles covers when drawn by the same eye as `opts` (render's): a Uint8Array of the picture's
 * pixels, 1 where they show. For a silhouette and for how much of the screen a mesh takes.
 */
export function silhouette(src, tris, opts) {
  const m = render(src, { ...opts, tris: tris.map((t) => ({ ...t, tex: null })), light: false, background: [0, 0, 0], depth: false });
  const mask = new Uint8Array(m.width * m.height);
  for (let i = 0; i < mask.length; i++) mask[i] = m.rgba[i * 4] >= MASK_LEAST ? 1 : 0;
  return { width: m.width, height: m.height, mask };
}

/**
 * An onion skin: one picture of an animation, its frame `base` (`from` unless told) drawn solid and, over it, the
 * outline of the chosen bones' mesh at every frame from `from` to `to` with a faint fill, coloured along time from
 * cold (the first) to warm (the last), a band of the colours with the frames' numbers along the foot; the frame
 * `mark` (the animation's first event unless told; none without) outlined in white and labelled. Where an arm jumps,
 * aims at the eye or sweeps in a fan is seen at once. { seq, bones (names or numbers: each with the bones under it;
 * every mesh unless told), from, to, base, mark, step (every frame: 1), view, screen, fov, width, ... as render }.
 */
export function onion(src, opts = {}) {
  const { number, sequence } = sequenceToDraw(src, opts, "onion");
  const from = opts.from ?? 0;
  const to = opts.to ?? sequence.frames - 1;
  const frames = [];
  for (let f = from; f <= to; f += Math.max(1, opts.step ?? 1)) frames.push(f);
  const first = opts.view === "first";
  const size = first && opts.screen ? { width: opts.width ?? 960 } : { width: opts.width ?? (first ? 640 : 512), height: opts.height ?? (first ? 480 : 512) }; // prettier-ignore
  const within = first ? undefined : framing(src, frames.map((frame) => ({ ...opts, seq: number, frame })));
  const eye = { ...opts, ...size, within, seq: number };
  const out = render(src, { ...eye, frame: opts.base ?? from });
  const set = bonesUnder(src, opts.bones);
  const mark = opts.mark ?? eventsOf(src, number).find((e) => e.frame >= from && e.frame <= to)?.frame ?? null;
  const { width, height } = out;
  const put = (i, c) => out.rgba.set([...c, 255], i * 4);
  const outlines = [];
  frames.forEach((frame, k) => {
    const ink = inkAlong(frames.length > 1 ? k / (frames.length - 1) : 0);
    const { mask } = silhouette(src, trisOn(posed(src, { ...eye, frame }).tris, set), { ...eye, frame });
    const edge = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        for (let c = 0; c < 3; c++) out.rgba[i * 4 + c] = Math.round(out.rgba[i * 4 + c] * (1 - ONION_FILL) + ink[c] * ONION_FILL);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) edge.push(i); // prettier-ignore
      }
    outlines.push({ frame, ink, edge });
  });
  // the outlines over every fill, the marked frame's last and thicker
  for (const o of outlines) if (o.frame !== mark) for (const i of o.edge) put(i, o.ink);
  const marked = outlines.find((o) => o.frame === mark);
  if (marked)
    for (const i of marked.edge)
      for (const d of [0, 1, -1, width, -width]) if (i + d >= 0 && i + d < width * height) put(i + d, MARK_INK);
  // the band of time along the foot, its frames' numbers over it
  const band = 10;
  for (let x = 0; x < width; x++) {
    const ink = inkAlong(x / Math.max(1, width - 1));
    for (let y = height - band; y < height; y++) put(y * width + x, ink);
  }
  const ticks = Math.min(frames.length, 12);
  for (let n = 0; n < ticks; n++) {
    const k = ticks > 1 ? Math.round((n * (frames.length - 1)) / (ticks - 1)) : 0;
    const x = Math.round((k / Math.max(1, frames.length - 1)) * (width - 1));
    label(out, String(frames[k]), Math.min(Math.max(2, x - 4), width - 20), height - band - 16);
  }
  label(out, `${sequence.name}: ${frames.length} frames, blue first, red last${marked ? `, white: frame ${mark}` : ""}`, NAME_AT, NAME_AT);
  return out;
}

/** The animation `opts.seq` of a model, checked drawable: { number, sequence }. */
function sequenceToDraw(src, opts, what = "strip") {
  const number = sequenceAt(src, opts.seq ?? 0);
  const all = sequences(src);
  const sequence = all[number];
  if (!all.length)
    throw new Error(`the model has no animations, and ${what} draws one frame by frame: render or sheet draws it as it rests`);
  if (!sequence) throw new Error(`no animation ${opts.seq}`);
  if (sequence.group && !opts.groups?.[sequence.group])
    throw new Error(
      `the animation ${sequence.name} is kept in another file: give groups, the files beside the model (sequenceFilesOf)`,
    );
  return { number, sequence };
}

/** A frame's label with its moment: "slash1 12 0.40s". */
const momentOf = (sequence, frame) => `${sequence.name} ${frame} ${(frame / (sequence.fps || 10)).toFixed(2)}s`;

/**
 * An animation in one picture: `count` moments of it from its first frame to its last (every frame, when it
 * has no more than that), each with its frame's number. { seq (a name or a number; the first unless told),
 * count (12), cols (4), from, to, view, ... as render }. It throws when the model has no animation, or none
 * of that name.
 *   every       true: every frame from `from` to `to`, each labelled with its frame and its time in seconds, in as
 *               many rows as it takes (6 to a row in first person on a `screen`, 8 otherwise)
 *   screen      first person: the game's eye (render's): each frame the shape of the screen, 320 wide unless told
 *   beside      { mdl, seq, name, groups }: another model's animation drawn by the same eye at the same frames
 *               (its last where it is shorter), a row of it under each row of this one; `name` names this one
 * Every frame is drawn by one camera at one scale, so a thing seen to move in the strip moves in the
 * animation. For a walk: { view: "side", ground: true }, the feet against the floor's line. (An animation
 * that travels has its travel taken out of its frames, as `movement`: it walks on the spot here.) An animation
 * kept in another file (<name>01.mdl) is read from `groups` (sequenceFilesOf); without them it throws.
 */
export function strip(src, opts = {}) {
  const { number, sequence } = sequenceToDraw(src, opts);
  const from = opts.from ?? 0;
  const to = opts.to ?? sequence.frames - 1;
  const count = opts.every ? to - from + 1 : Math.max(1, Math.min(opts.count ?? 12, to - from + 1));
  const first = opts.view === "first";
  const eye = first && opts.screen;
  const frames = Array.from({ length: count }, (_, i) =>
    Math.round(from + (count > 1 ? (i * (to - from)) / (count - 1) : 0)),
  );
  const size = eye
    ? { width: opts.width ?? 320 }
    : { width: opts.width ?? (first ? 400 : 320), height: opts.height ?? (first ? 300 : 320) };
  const other = opts.beside && { ...opts.beside, ...sequenceToDraw(opts.beside.mdl, { seq: opts.beside.seq ?? number, groups: opts.beside.groups }) }; // prettier-ignore
  const otherFrame = (frame) => Math.min(frame, other.sequence.frames - 1);
  // one scale for every frame (of both models); in first person the eye does not move, so there is nothing to fit
  const within = first
    ? undefined
    : framing(src, [
        ...frames.map((frame) => ({ ...opts, seq: number, frame })),
        ...(other ? frames.map((frame) => ({ tris: posed(other.mdl, { ...opts, groups: other.groups, seq: other.number, frame: otherFrame(frame) }).tris })) : []), // prettier-ignore
      ]);
  const cols = opts.cols ?? (opts.every ? (eye ? 6 : 8) : Math.min(4, count));
  const said = (s, frame) => (opts.every ? momentOf(s, frame) : `${s.name} ${frame}/${s.frames - 1}`);
  const mine = frames.map((frame) => render(src, { ...opts, ...size, within, seq: number, frame }));
  if (!other) return tile(mine, opts.every ? Math.min(cols, count) : cols, frames.map((frame) => said(sequence, frame)));
  // a row of this one, then the same frames of the other under it
  const images = [];
  const labels = [];
  for (let i = 0; i < frames.length; i += cols) {
    const row = frames.slice(i, i + cols);
    row.forEach((frame, k) => {
      images.push(mine[i + k]);
      labels.push(`${opts.name ?? "this"} ${said(sequence, frame)}`);
    });
    for (let k = row.length; k < cols && frames.length > cols; k++) images.push(blankLike(mine[0])), labels.push("");
    row.forEach((frame) => {
      images.push(render(other.mdl, { ...opts, ...size, within, groups: other.groups, seq: other.number, frame: otherFrame(frame) })); // prettier-ignore
      labels.push(`${other.name ?? "beside"} ${said(other.sequence, otherFrame(frame))}`);
    });
    for (let k = row.length; k < cols && frames.length > cols; k++) images.push(blankLike(mine[0])), labels.push("");
  }
  return tile(images, Math.min(cols, frames.length), labels);
}

/** A picture of the size of `img` in the dark of the ground between tiles. */
function blankLike(img) {
  const out = { width: img.width, height: img.height, rgba: new Uint8Array(img.width * img.height * 4) };
  for (let i = 0; i < img.width * img.height; i++) out.rgba.set([...DARK, 255], i * 4);
  return out;
}

/** The colours the meshes' triangles are drawn in on a `uvMap`, mesh after mesh. */
const UV_INKS = [
  [255, 230, 40, 255],
  [60, 230, 255, 255],
  [255, 110, 220, 255],
  [130, 255, 110, 255],
];

/**
 * One of the model's textures, enlarged, with every triangle that wears it drawn over it: where each part of
 * the shape takes its colour from. `which`: the texture's number or name. Returns the picture and `scale`
 * (pixels a texture pixel).
 */
export function uvMap(src, which, { scale } = {}) {
  const info = readMdl(src);
  const texture =
    typeof which === "number"
      ? info.textures[which]
      : info.textures.find((x) => x.name.toLowerCase() === String(which).toLowerCase());
  if (!texture) throw new Error(`no texture ${which}`);
  const enlarged = scale ?? mapScaleOf(texture);
  const width = texture.width * enlarged;
  const height = texture.height * enlarged;
  const rgba = new Uint8Array(width * height * 4);
  const { pixels, palette } = bytesOf(src, texture);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = pixels[Math.floor(y / enlarged) * texture.width + Math.floor(x / enlarged)];
      rgba.set([palette[p * 3], palette[p * 3 + 1], palette[p * 3 + 2], 255], (y * width + x) * 4);
    }

  let meshes = 0;
  let triangles = 0;
  for (const bodypart of info.bodyparts)
    for (const model of bodypart.models)
      for (const mesh of model.meshes) {
        if (mesh.texture !== texture || !mesh.numtris) continue;
        const ink = UV_INKS[meshes++ % UV_INKS.length];
        for (const corners of readMesh(src, model, mesh)) {
          triangles++;
          const [a, b, c] = corners.map((corner) => [corner.s * enlarged, corner.t * enlarged]);
          drawLine(rgba, width, height, a, b, ink);
          drawLine(rgba, width, height, b, c, ink);
          drawLine(rgba, width, height, c, a, ink);
        }
      }
  return { width, height, rgba, scale: enlarged, meshes, triangles, texture };
}
