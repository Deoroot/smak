// A game's model in new colours, by rules, in one step; and a part of a picture that many places of the body
// wear made a picture of its own first, so that it can be painted alone.
//
//   ownPixels(src, { islands | body | mesh, tex })   those triangles moved into a texture of their own, a copy
//                                                    of the pixels they wore: a plate marked alone
//   reskin(src, rules, { body, own })               the textures recoloured, weathered by place and painted
//                                                    over by rules, with each changed texture before and after
//
// Both start from the game's own file and give a new one; nothing here reads the disk. `smak reskin` runs a
// file of rules from the command line.
import { readMdl, textureOf, bodyOf, skinFamilies, moveTriangles } from "../core/mdl.mjs";
import { rgbaOf, indexed, masked } from "../core/image.mjs";
import { check, LIMITS } from "./check.mjs";
import { paint } from "../make/paint.mjs";
import { tile } from "../make/render.mjs";
import { islandsOf } from "../make/place-shared.mjs";
import { fbm3, noise, step, mix, times } from "../make/workshop.mjs";

/** A texture's name is kept in 64 bytes, the last a zero. */
const TEXTURE_NAME_MOST = 63;
/** Pixels of the old picture kept about the triangles' box, so that the engine's smoothing finds no seam. */
const PAD = 2;
/** studio.h's STUDIO_NF_MASKED: index 255 is a hole, and is never mixed with its neighbours. */
const MASKED = 64;

// ── a part of a picture made a picture of its own ───────────────────────────
/** A texture's name ended `_tag.bmp`, cut to fit, and made unlike every name the file has. */
function freshName(info, wanted, stem, tag) {
  const taken = new Set(info.textures.map((t) => t.name.toLowerCase()));
  if (wanted) {
    if (taken.has(wanted.toLowerCase()))
      throw new Error(`ownPixels: the file has a texture called ${wanted} already: give another name`);
    if (wanted.length > TEXTURE_NAME_MOST)
      throw new Error(`ownPixels: ${wanted} is longer than the ${TEXTURE_NAME_MOST} letters a texture's name holds`);
    return wanted;
  }
  const plain = stem.replace(/\.bmp$/i, "");
  for (let nth = 1; ; nth++) {
    const ending = `_${tag}${nth > 1 ? nth : ""}.bmp`;
    const made = plain.slice(0, TEXTURE_NAME_MOST - ending.length) + ending;
    if (!taken.has(made.toLowerCase())) return made;
  }
}

/**
 * The pixels of `old` from (x0, y0), `w` by `h`, as a texture of `width` by `height`. A pixel outside the
 * triangles' own box (`inside`) repeats the nearest one inside it; a box that runs past the picture's edge
 * goes on from its other side, as a picture laid over and over does. At its own size the palette's
 * numbers are copied as they are; smaller, each pixel is the mean of those it covers, cut to 256 colours
 * again (a masked picture keeps its holes and takes the nearest instead).
 */
function cutOut(old, { x0, y0, w, h, inside }, width, height, name) {
  const at = (x, y) => {
    const cx = Math.min(inside[2], Math.max(inside[0], x));
    const cy = Math.min(inside[3], Math.max(inside[1], y));
    const wx = ((cx % old.width) + old.width) % old.width;
    const wy = ((cy % old.height) + old.height) % old.height;
    return old.pixels[wy * old.width + wx];
  };
  const holes = Boolean(old.flags & MASKED);
  if (width === w && height === h) {
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = at(x0 + x, y0 + y);
    return { name, width, height, pixels, palette: Uint8Array.from(old.palette), flags: old.flags };
  }
  const kx = w / width;
  const ky = h / height;
  if (holes) {
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) pixels[y * width + x] = at(x0 + Math.floor((x + 0.5) * kx), y0 + Math.floor((y + 0.5) * ky));
    return { name, width, height, pixels, palette: Uint8Array.from(old.palette), flags: old.flags };
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * ky); sy < Math.max(Math.floor(y * ky) + 1, Math.ceil((y + 1) * ky)); sy++)
        for (let sx = Math.floor(x * kx); sx < Math.max(Math.floor(x * kx) + 1, Math.ceil((x + 1) * kx)); sx++) {
          const index = at(x0 + sx, y0 + sy);
          for (let a = 0; a < 3; a++) sum[a] += old.palette[index * 3 + a];
          n++;
        }
      for (let a = 0; a < 3; a++) rgb[(y * width + x) * 3 + a] = Math.round(sum[a] / n);
    }
  return { ...indexed({ width, height, rgb }, name), flags: old.flags };
}

/**
 * Gives some triangles a picture of their own: they are moved into a new mesh (one for each mesh they were
 * in, in the same submodel) wearing a new texture that begins as a copy of the pixels they wore. What paints
 * that texture then paints them and nothing else: one plate of an armour whose one rust is laid over every
 * plate, one body of several that share a picture.
 *   islands  an island's id, or a list (`uvIslands`; `smak islands`): its triangles
 *   body     a body number: the triangles of the submodels it shows
 *   mesh     { bodypart, model, mesh }: that mesh's triangles
 *   tex      a texture's name or number: only the triangles that wear it
 * Those given are all asked for together (an island of that body); the triangles found must wear one texture.
 *   name     the new texture's (unless told, the old one's with `_own` before `.bmp`)
 *   most     the longest side the new texture may have (512, what GoldSrc draws at full size): a larger box of
 *            pixels is made smaller to fit, and the corners follow
 *   pad      pixels of the old picture kept about the triangles' box (2)
 * The box of pixels the triangles lie on is copied, wherever it is: one that runs past the picture's edge
 * (a picture laid over a plate several times) goes on from the other side. At its own size the palette's
 * numbers are copied as they are; made smaller, it is cut to 256 colours again. The new texture keeps the
 * old one's flags. Every mesh, submodel and body keeps its number; the islands of the pictures are numbered
 * again, the moved ones last: `islands` in the result are their new ids.
 * Returns { mdl, texture (its name), width, height, scale (new pixels for one old, 1 unless made smaller),
 * box: [x0, y0, x1, y1] (the old pixels copied), moved (triangles), meshes ([{ bodypart, model, mesh }]: the
 * new ones), islands, warnings }. It throws when the result would not load (`check`'s errors that the
 * original has not), and when nothing, or more than one texture, is asked for.
 */
export function ownPixels(src, { islands, body, mesh, tex, name, most = LIMITS.goldsrc.texture, pad = PAD } = {}) {
  if (islands === undefined && body === undefined && mesh === undefined)
    throw new Error("ownPixels: say which triangles: islands, body or mesh (and tex, to keep to one texture)");
  const found = islandsOf(src);
  const { info } = found;
  const islandSet = islands === undefined ? null : new Set([islands].flat());
  if (islandSet)
    for (const id of islandSet)
      if (!found.all.some((t) => t.island === id))
        throw new Error(`ownPixels: there is no island ${id}: \`smak islands\` lists them`);
  const shown = body === undefined ? null : bodyOf(src, body);
  const texName = tex === undefined ? null : textureOf(src, tex).name;
  const sameMesh = (where) =>
    !mesh || (where.bodypart === mesh.bodypart && where.model === mesh.model && where.mesh === mesh.mesh);
  const chosen = found.all.filter(
    (t) =>
      (!islandSet || islandSet.has(t.island)) &&
      (!shown || shown[t.where.bodypart] === t.where.model) &&
      sameMesh(t.where) &&
      (!texName || info.textures[t.tex].name === texName),
  );
  if (!chosen.length) throw new Error("ownPixels: no triangle is all of what was asked for");
  const worn = [...new Set(chosen.map((t) => info.textures[t.tex].name))];
  if (worn.length > 1)
    throw new Error(`ownPixels: those triangles wear ${worn.join(", ")}: one texture a call (give tex)`);
  const old = textureOf(src, worn[0]);

  // the box of pixels they lie on, with a margin; and the new picture's size
  const corners = chosen.flatMap((t) => t.c);
  const inside = [
    Math.floor(Math.min(...corners.map((c) => c.s))),
    Math.floor(Math.min(...corners.map((c) => c.t))),
    Math.ceil(Math.max(...corners.map((c) => c.s))) - 1,
    Math.ceil(Math.max(...corners.map((c) => c.t))) - 1,
  ];
  inside[2] = Math.max(inside[0], inside[2]);
  inside[3] = Math.max(inside[1], inside[3]);
  const x0 = inside[0] - pad;
  const y0 = inside[1] - pad;
  const w = inside[2] - inside[0] + 1 + 2 * pad;
  const h = inside[3] - inside[1] + 1 + 2 * pad;
  if (!(most >= 8)) throw new Error(`ownPixels: most is the longest side a texture may have, 8 or more, not ${most}`);
  const k = Math.min(1, most / Math.max(w, h));
  const width = Math.max(1, Math.round(w * k));
  const height = Math.max(1, Math.round(h * k));
  const texture = cutOut(old, { x0, y0, w, h, inside }, width, height, freshName(info, name, old.name, "own"));

  // the triangles moved, mesh by mesh, their corners laid on the new picture
  const byMesh = new Map();
  for (const t of chosen) {
    const key = `${t.where.bodypart}/${t.where.model}/${t.where.mesh}`;
    if (!byMesh.has(key)) byMesh.set(key, { where: t.where, tris: new Set() });
    byMesh.get(key).tris.add(t.tri);
  }
  const uvOf = (_, __, [s, t]) => [((s - x0) * width) / w, ((t - y0) * height) / h];
  let mdl = src;
  const meshes = [];
  for (const { where, tris } of byMesh.values()) {
    const made = moveTriangles(mdl, where, (i) => tris.has(i), texture, uvOf);
    mdl = made.mdl;
    meshes.push({ bodypart: where.bodypart, model: where.model, mesh: made.mesh });
  }

  // what it must not have broken, and where the moved triangles are now
  const before = new Set(check(src).errors);
  const broken = check(mdl).errors.filter((error) => !before.has(error));
  if (broken.length) throw new Error(`ownPixels: the model would not load: ${broken.join("; ")}`);
  const after = islandsOf(mdl);
  const number = after.info.textures.findIndex((t) => t.name === texture.name);
  const warnings = [];
  if (skinFamilies(src).length > 1)
    warnings.push(
      `the model has ${skinFamilies(src).length} skin families: the moved triangles wear ${texture.name} in every one of them`,
    );
  if (k < 1)
    warnings.push(
      `the triangles lie on ${w}x${h} pixels: copied at ${width}x${height}, to keep within ${most} a side`,
    );
  return {
    mdl,
    texture: texture.name,
    width,
    height,
    scale: +(width / w).toFixed(4),
    box: [x0, y0, x0 + w, y0 + h],
    moved: chosen.length,
    meshes,
    islands: [...new Set(after.all.filter((t) => t.tex === number).map((t) => t.island))].sort((a, b) => a - b),
    warnings,
  };
}

// ── the rules of a re-skin ──────────────────────────────────────────────────
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
/** A colour's hue in degrees (0 to 360) and its saturation (the span of its channels, 0 to 1). */
function hueOf([r, g, b]) {
  const most = Math.max(r, g, b);
  const span = most - Math.min(r, g, b);
  if (span < 1e-6) return 0;
  const h = most === r ? ((g - b) / span) % 6 : most === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (h * 60 + 360) % 360;
}
const satOf = (c) => Math.max(...c) - Math.min(...c);
const clamp01 = (c) => c.map((x) => Math.max(0, Math.min(1, x)));
/** Within [low, high]; a hue range whose low end is the larger goes round through 0 (red: [330, 20]). */
const within = (value, [low, high], round = false) =>
  round && low > high ? value >= low || value <= high : value >= low && value <= high;

/** The colours a weathering rule is made of unless told: those of the Barrow Road's re-skins. */
export const WEATHER = {
  rust: { dark: [0.17, 0.09, 0.05], mid: [0.33, 0.18, 0.09], light: [0.47, 0.27, 0.12] },
  moss: { dark: [0.12, 0.17, 0.07], light: [0.21, 0.26, 0.1] },
  dirt: { colour: [0.3, 0.24, 0.17] },
  verdigris: { colour: [0.22, 0.36, 0.3] },
};
const ACTIONS = ["recolour", "darken", "tint", "rust", "moss", "dirt", "verdigris", "paint"];
const FILTERS = ["only", "islands", "hue", "sat", "light", "box", "near", "above", "below", "facing", "when", "soft"];
const SETTINGS = ["amount", "scale", "seed", "up", "low", "height", "colours", "keep"];

/** A rule's mistakes, said before anything is painted. */
function checkRule(rule, n) {
  const what = `reskin: rule ${n}`;
  if (typeof rule === "function") return;
  if (!rule || typeof rule !== "object") throw new Error(`${what} is an object (or a function), not ${JSON.stringify(rule)}`);
  const actions = ACTIONS.filter((a) => a in rule);
  if (actions.length !== 1)
    throw new Error(`${what} does one thing of ${ACTIONS.join(", ")}; it has ${actions.length ? actions.join(" and ") : "none"}`);
  for (const key of Object.keys(rule))
    if (![...ACTIONS, ...FILTERS, ...SETTINGS, "name"].includes(key))
      throw new Error(`${what}: ${key} is not a word of a rule (${[...ACTIONS, ...FILTERS, ...SETTINGS].join(", ")})`);
  for (const key of ["hue", "sat", "light"])
    if (key in rule && !(Array.isArray(rule[key]) && rule[key].length === 2 && rule[key].every(Number.isFinite)))
      throw new Error(`${what}: ${key} is [low, high], not ${JSON.stringify(rule[key])}`);
  if ("box" in rule && !(Array.isArray(rule.box) && rule.box.length === 4))
    throw new Error(`${what}: box is [u0, v0, u1, v1] in pixels, not ${JSON.stringify(rule.box)}`);
  if ("near" in rule && !(Array.isArray(rule.near) && rule.near.length === 4))
    throw new Error(`${what}: near is [x, y, z, radius], not ${JSON.stringify(rule.near)}`);
  for (const colour of ["recolour", "paint"])
    if (colour in rule && typeof rule[colour] !== "function" && !(Array.isArray(rule[colour]) && rule[colour].length === 3))
      throw new Error(`${what}: ${colour} is a colour [r, g, b] from 0 to 1${colour === "paint" ? ", or a function" : ""}`);
}

/**
 * Whether the pixel `q` (what `paint` hands its function) is one the rule is for: by the picture as it was
 * (hue, sat, light, box) and by the place of the body (near, above, below, facing, when).
 */
function chosen(rule, q, original) {
  const o = original;
  if (rule.hue && !(satOf(o) > 0.02 && within(hueOf(o), rule.hue, true))) return false;
  if (rule.sat && !within(satOf(o), rule.sat)) return false;
  if (rule.light && !within(lum(o), rule.light)) return false;
  if (rule.box && !(q.u >= rule.box[0] && q.u < rule.box[2] && q.v >= rule.box[1] && q.v < rule.box[3])) return false;
  if (rule.near && Math.hypot(q.p[0] - rule.near[0], q.p[1] - rule.near[1], q.p[2] - rule.near[2]) > rule.near[3]) return false;
  if (rule.above !== undefined && !(q.p[2] >= rule.above)) return false;
  if (rule.below !== undefined && !(q.p[2] < rule.below)) return false;
  if (rule.facing) {
    const { dir, least = 0.5 } = Array.isArray(rule.facing) ? { dir: rule.facing } : rule.facing;
    const length = Math.hypot(...dir) || 1;
    if ((q.n[0] * dir[0] + q.n[1] * dir[1] + q.n[2] * dir[2]) / length < least) return false;
  }
  if (rule.when && !rule.when(q)) return false;
  return true;
}

/** The picture's own colours chosen by a rule's hue, sat, light and box: their mean brightness (0.5 when none). */
function meanLight(src, texName, rule) {
  const t = textureOf(src, texName);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < t.height; y++)
    for (let x = 0; x < t.width; x++) {
      if (rule.box && !(x + 0.5 >= rule.box[0] && x + 0.5 < rule.box[2] && y + 0.5 >= rule.box[1] && y + 0.5 < rule.box[3])) continue;
      const k = t.pixels[y * t.width + x] * 3;
      const c = [t.palette[k] / 255, t.palette[k + 1] / 255, t.palette[k + 2] / 255];
      if (rule.hue && !(satOf(c) > 0.02 && within(hueOf(c), rule.hue, true))) continue;
      if (rule.sat && !within(satOf(c), rule.sat)) continue;
      if (rule.light && !within(lum(c), rule.light)) continue;
      sum += lum(c);
      n++;
    }
  return n ? Math.max(1e-3, sum / n) : 0.5;
}

/** Weathering by place, as the Barrow Road's re-skins did it by hand: each gives the colour, or the one there. */
const weather = {
  /** Rust in patches by place, a bloom about each, streaks run down from them and pits. */
  rust(q, rgb, rule) {
    const { p } = q;
    const amount = rule.rust;
    const k = 1 / (rule.scale ?? 1);
    const s = rule.seed ?? 11;
    const c0 = { ...WEATHER.rust, ...rule.colours };
    const L = lum(rgb);
    const low = 0.72 - 0.4 * amount;
    const patch = fbm3(p, 0.32 * k, s) + 0.25 * (noise(p[0] * 0.9 * k + p[1] * 0.7 * k, p[2] * 0.08 * k, s + 2) - 0.5);
    const streak = fbm3([p[0] * 2.5, p[1] * 2.5, p[2] * 0.15], 0.5 * k, s + 8, 3);
    const r = Math.max(step(low, low + 0.1, patch), 0.8 * step(low + 0.12, low + 0.22, streak + 0.5 * (patch - low)));
    const tone = mix(mix(c0.dark, c0.mid, step(0.3, 0.7, fbm3(p, 0.6 * k, s + 4, 3))), c0.light, 0.6 * step(0.62, 0.8, fbm3(p, 1.6 * k, s + 6, 2)));
    let c = mix(rgb, times(tone, 0.55 + 0.75 * L), 0.88 * r);
    c = mix(c, times(c0.mid, 0.6 + 0.5 * L), 0.3 * step(low - 0.1, low, patch));
    return times(c, 1 - 0.4 * amount * step(0.66, 0.8, fbm3(p, 2.4 * k, s + 9, 2)));
  },
  /** Moss: on what faces up and low down where the earth lay, in patches; speckled. */
  moss(q, rgb, rule) {
    const { p, n } = q;
    const amount = rule.moss;
    const k = 1 / (rule.scale ?? 1);
    const s = rule.seed ?? 31;
    const c0 = { ...WEATHER.moss, ...rule.colours };
    const up = step(0.25, 0.75, n[2]);
    const lowZ = rule.low ?? 12;
    const low = step(lowZ, lowZ - 10, p[2]);
    const where = fbm3(p, 0.3 * k, s) + (rule.up ?? 0.3) * up + 0.22 * low;
    const lowest = 0.8 - 0.4 * amount;
    const m = step(lowest, lowest + 0.1, where);
    if (m <= 0) return rgb;
    const speck = fbm3(p, 3 * k, s + 2, 2);
    const moss = mix(c0.dark, c0.light, step(0.45, 0.75, speck));
    return mix(rgb, times(moss, 0.75 + 0.4 * fbm3(p, 1.2 * k, s + 4, 2)), m * (0.75 + 0.25 * speck));
  },
  /** Grave dirt rising from the ground, thinning upwards to `height`. */
  dirt(q, rgb, rule) {
    const { p } = q;
    const k = 1 / (rule.scale ?? 1);
    const colour = rule.colours?.colour ?? WEATHER.dirt.colour;
    const d = step(rule.height ?? 30, 2, p[2]) * (0.6 + 0.4 * fbm3(p, 0.5 * k, rule.seed ?? 13));
    return mix(rgb, colour, Math.min(1, 0.75 * d * rule.dirt * 2));
  },
  /** Brass gone green in patches, more in its dark hollows. */
  verdigris(q, rgb, rule) {
    const L = lum(rgb);
    const k = 1 / (rule.scale ?? 1);
    const colour = rule.colours?.colour ?? WEATHER.verdigris.colour;
    const lowest = 0.65 - 0.3 * rule.verdigris;
    return mix(rgb, times(colour, 0.6 + 0.6 * L), step(lowest, lowest + 0.17, fbm3(q.p, 0.8 * k, rule.seed ?? 51) + 0.25 * (0.5 - L)));
  },
};

/** A rule as a pass of `paint`. */
function passOf(src, rule) {
  if (typeof rule === "function") return { fn: (q) => { const c = rule(q); return c && clamp01(c); } };
  const lights = new Map();
  const reference = (tex) => {
    if (!lights.has(tex)) lights.set(tex, meanLight(src, tex, rule));
    return lights.get(tex);
  };
  const fn = (q) => {
    const original = q.orig();
    if (!chosen(rule, q, original)) return undefined;
    const rgb = q.rgb;
    let c;
    if (rule.recolour) {
      const target = typeof rule.recolour === "function" ? rule.recolour(q) : rule.recolour;
      // the new colour, its light and shade those of the picture's own: the mean of what the rule takes
      // becomes `target`, a lighter pixel lighter
      c = rule.keep === false ? target : times(target, lum(rgb) / reference(q.tex));
    } else if (rule.darken !== undefined) c = times(rgb, 1 - rule.darken);
    else if (rule.tint) c = mix(rgb, rule.tint[0], rule.tint[1]);
    else if (rule.paint) c = typeof rule.paint === "function" ? rule.paint(q) : rule.paint;
    else for (const kind of ["rust", "moss", "dirt", "verdigris"]) if (rule[kind] !== undefined) c = weather[kind](q, rgb, rule);
    return c && clamp01(c);
  };
  return { fn, only: rule.only, islands: rule.islands, soft: rule.soft };
}

/** Each changed texture before and after, side by side, named: `[{ name, image }]`. */
export function beforeAfter(was, now, names) {
  return names.map((name) => {
    const a = textureOf(was, name);
    const b = textureOf(now, name);
    const holes = Boolean(a.flags & MASKED);
    const image = tile(
      [
        { width: a.width, height: a.height, rgba: rgbaOf(a, holes) },
        { width: b.width, height: b.height, rgba: rgbaOf(b, holes) },
      ],
      2,
      ["before", "after"],
    );
    return { name, image };
  });
}

/**
 * A model re-skinned by rules in one call: its pictures recoloured, weathered by place and painted over,
 * everything else as it was (bones, bodies, animations, events, hit boxes), each texture at its own size and
 * cut to 256 colours once.
 *   rules   a list, applied in order, each seeing what the ones before left. A rule is an object that does ONE
 *           of these:
 *             recolour: [r, g, b]   the colour the pixels it takes become, their light and shade kept: the mean
 *                                   brightness of what it takes in the picture becomes that colour (keep: false:
 *                                   the colour flat). A function of the pixel instead, in a script
 *             darken: 0.4           that much darker; tint: [[r, g, b], 0.3] mixed that far towards a colour
 *             rust: 0.5, moss: 0.5, dirt: 0.5, verdigris: 0.5    weathered by place, that much (0 to 1): rust in
 *                                   patches with streaks and pits; moss on what faces up (`up`, its weight, 0.3)
 *                                   and below `low` (12); dirt rising from the ground to `height` (30); green in
 *                                   brass's hollows. `scale` (1: lumps about the size of the Barrow Road's),
 *                                   `seed`, `colours` ({ dark, mid, light } or { colour }) change them
 *             paint: [r, g, b]      that colour; or a function (q) => colour, given what `paint` gives its own
 *           and is kept to some pixels by any of these, all of which must hold:
 *             only: [texture names], islands: [ids]          as `paint`'s
 *             hue: [from, to] (degrees; [330, 20] goes round through red), sat: [low, high], light: [low,
 *                                   high]                     the colour the picture HAD there (0 to 1)
 *             box: [u0, v0, u1, v1]                           pixels of the texture
 *             near: [x, y, z, r], above: z, below: z          the place of the body, as it stands in `pose`
 *             facing: [x, y, z] or { dir, least: 0.5 }        the way the surface looks (up: [0, 0, 1])
 *             when: (q) => true                               anything else, in a script
 *             soft: 3                                         the edges of what it draws made soft
 *           A function in place of a rule is a pass of `paint` as it is.
 * Options:
 *   body    the body number whose triangles are painted (0): a texture the others share changes for them too
 *   pose    as `paint`'s ({ seq: 0, frame: 0, body })
 *   own     [ownPixels' options, ...]: parts of pictures made pictures of their own first, so that a rule can
 *           keep to one (`only: [the name it got]`: read it from `owned`)
 * Returns { mdl, changed (the names of the textures that changed), pictures ([{ name, image }]: each changed
 * texture before and after, side by side), shared (as `paint`'s), owned (what each `own` gave) }.
 */
export function reskin(src, rules, { body = 0, pose, own = [] } = {}) {
  if (!Array.isArray(rules) || !rules.length) throw new Error("reskin: rules is a list of one rule at the least");
  rules.forEach((rule, n) => checkRule(rule, n + 1));
  let base = src;
  const owned = [];
  for (const options of own) {
    const made = ownPixels(base, options);
    owned.push(made);
    base = made.mdl;
  }
  const standing = pose ?? { seq: 0, frame: 0, body };
  const { mdl, shared } = paint(base, rules.map((rule) => passOf(base, rule)), { pose: standing });
  const before = readMdl(base).textures;
  const changed = before
    .map((t) => t.name)
    .filter((name) => {
      const a = textureOf(base, name);
      const b = textureOf(mdl, name);
      return !Buffer.from(a.pixels).equals(Buffer.from(b.pixels)) || !Buffer.from(a.palette).equals(Buffer.from(b.palette));
    });
  return { mdl, changed, pictures: beforeAfter(base, mdl, changed), shared, owned };
}

/** A rules file's words, for the command line: every key a rule may have. */
export const RULE_WORDS = { actions: ACTIONS, filters: FILTERS, settings: SETTINGS };

/**
 * What a file of rules holds, as `smak reskin` reads it: a list of rules, or { rules, own, body, pose }.
 * Throws, in words, on anything else.
 */
export function rulesOf(value, from = "the rules") {
  const read = Array.isArray(value) ? { rules: value } : value;
  if (!read || !Array.isArray(read.rules))
    throw new Error(`${from}: a list of rules, or { rules: [...], own: [...], body }`);
  return { rules: read.rules, own: read.own ?? [], body: read.body, pose: read.pose };
}

/**
 * A colour as the rules measure it: { hue (degrees, 0 to 360), sat, light (0 to 1) }. For choosing a rule's
 * `hue`, `sat` and `light` from a pixel of the picture.
 */
export const colourOf = (c) => ({ hue: hueOf(c), sat: satOf(c), light: lum(c) });
