// Part V of levels/assembly (README.md): the diagnostic views. A compiled map that passes a thousand numeric
// checks can still have a stair standing loose, a door in the air or a room in the dark; these pictures are made
// so that such a thing is seen at a glance, by the person or by a vision model asked a plain question of each.
// They are cheap (arithmetic only, the kit's own renderer and plan) and exact (drawn from the map's own faces,
// lightmaps and tree, at its true sizes, against the layout's grid).
//
//   storeyCutaways(map, options)   each storey from above at three corners, all over its ceiling cut away
//   storeyPlan(map, options)       one storey from straight above on the 64 grid, the layout laid over it
//   falseColourHeight(map, opts)   one storey coloured by the height of the floor a player stands on
//   eyeShots(bsp, layout, opts)    at eye height through every door, up and down the stair, across each room
//   darkMap(bsp, options)          the light on one storey's floor as a heat map, the kit's dark line marked
//   sampleHouse(options)           a two-storey house with a stair and its layout: the views' own test map
//
// `map` is a compiled map (`readBsp`), a source map (`readMap`, or what `writeMap` takes), or a path to either.
// Each view returns a picture `{ width, height, rgba, facts }` (`storeyCutaways` and `eyeShots` a list of
// them); with `out` (a folder) each is also written there as a PNG, its file in `facts.file`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readBsp, modelFaces, facePolygon, faceNormal, faceLightmap, contentsAt, CONTENTS, worldBounds, embeddedTexture, LUXEL } from "../../src/maps/bsp.mjs"; // prettier-ignore
import { readMap, shapeOf, box, stairs, light, playerStart, brushEntity, originBrush } from "../../src/maps/source.mjs"; // prettier-ignore
import { planOf, planOfSource, drawMap, drawSource } from "../../src/maps/draw.mjs";
import { storeyCuts } from "../../src/maps/reach.mjs";
import { spaceOf } from "../../src/maps/space.mjs";
import { floorSamples, stylesCounted, lightReport, DARK_FLOOR } from "../../src/maps/light.mjs";
import { textureKind, textureRgba } from "../../src/maps/miptex.mjs";
import { texturesFor } from "../../src/maps/wad.mjs";
import { valueOf, brushModelOf, originOf } from "../../src/maps/entities.mjs";
import { render, label, tile } from "../../src/render.mjs";
import { drawLine } from "../../src/pixels.mjs";
import { png } from "../../src/image.mjs";

// ── the contract's numbers (README.md, "Units and the grid") ───────────────
const GRID = 64;
const STOREY = 192;
const SLAB = 16;
/** The eye over a floor's top, a standing player's. */
const EYE = 64;
/** The highest step a player walks up. */
const STEP = 18;
/** A cut-away view cuts this far under the next storey's floor: just under the slab, so the ceiling goes. */
const CUT_UNDER = SLAB + 2;
/** The plan pictures' margins, as `planOf` frames them (so every plan of one storey lies pixel on pixel). */
const MARGIN = 24;
const FOOT = 46;
/** What `drawMap` multiplies the light by (draw.mjs, BRIGHTNESS): the game's look. */
const BRIGHTNESS = 1.55;
/** Brush entities never drawn (draw.mjs's own list). */
const NEVER_DRAWN = /^(trigger_|func_ladder$|func_monsterclip$|func_buyzone$|func_bomb_target$|msarea_)/;

// ── small helpers ───────────────────────────────────────────────────────────
const isCompiled = (map) => Boolean(map?.faces && map?.lumps);
const round = (value) => Math.round(value * 10) / 10;
const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mix = (a, b, share) => a.map((value, k) => value + (b[k] - value) * share);

/** A map from what was given: a compiled map, a source map, or a path to a `.bsp` or a `.map`. */
export function mapOf(map) {
  if (typeof map === "string") {
    if (/\.bsp$/i.test(map)) return readBsp(readFileSync(map));
    if (/\.map$/i.test(map)) return readMap(readFileSync(map, "utf8"));
    throw new Error(`a map is a .bsp or a .map file, not ${map}`);
  }
  if (isCompiled(map) || Array.isArray(map?.brushes)) return map;
  throw new Error("a map: what readBsp or readMap gives, or a path to a .bsp or a .map");
}

/** Writes a picture as a PNG into `out` when a folder is given; its path goes in `facts.file`. */
function written(picture, out, name) {
  if (!out) return picture;
  mkdirSync(out, { recursive: true });
  const file = join(out, name);
  writeFileSync(file, png(picture.width, picture.height, picture.rgba));
  picture.facts.file = file;
  return picture;
}

/** A blank picture of one colour. */
function canvasOf(width, height, colour) {
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < width * height; at++) rgba.set([...colour, 255], at * 4);
  return { width, height, rgba };
}

/** Lays a colour over a pixel at a share (1: the colour). */
function blend(picture, x, y, colour, share = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return;
  const at = (y * picture.width + x) * 4;
  for (let k = 0; k < 3; k++) picture.rgba[at + k] = clamp255(picture.rgba[at + k] + (colour[k] - picture.rgba[at + k]) * share);
}

/** A rectangle of a colour, from (x0, y0) to (x1, y1) in pixels, at a share. */
function fillRect(picture, x0, y0, x1, y1, colour, share = 1) {
  for (let y = Math.floor(Math.min(y0, y1)); y < Math.ceil(Math.max(y0, y1)); y++)
    for (let x = Math.floor(Math.min(x0, x1)); x < Math.ceil(Math.max(x0, x1)); x++) blend(picture, x, y, colour, share);
}

/** A line `thick` pixels wide (a square brush along it). */
function thickLine(picture, a, b, colour, thick = 1, dash = 0) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const half = (thick - 1) / 2;
  for (let i = 0; i <= steps; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const x = a[0] + ((b[0] - a[0]) * i) / steps;
    const y = a[1] + ((b[1] - a[1]) * i) / steps;
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) blend(picture, x + dx, y + dy, colour);
  }
}

/** Text of the kit's labels: its width in pixels at size `k`. */
const textWidth = (text, k) => (String(text).length * 4 - 1) * k;

/** Words on a picture, centred on (x, y). */
function labelAt(picture, text, x, y, k = 2, colour = [235, 235, 235]) {
  label(picture, text, Math.round(x - textWidth(text, k) / 2), Math.round(y - (5 * k) / 2), k, colour);
}

/** A stable colour for a texture's name, when its picture is not to hand. */
function colourOfName(name) {
  let hash = 2166136261;
  for (const letter of name.toLowerCase()) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
  return [90 + (hash & 0x7f), 90 + ((hash >> 8) & 0x7f), 90 + ((hash >> 16) & 0x7f)];
}

// ── storeys, and where the building is ──────────────────────────────────────
/**
 * The storeys to draw: `[{ index, floor, cut, height }]`, the floor tops from the lowest. From a layout (its
 * `base`, `storeyHeight`, `storeys`); or `storeys` (a count, or a list of floor heights) with `base` (z, or
 * [x, y, z]) and `storeyHeight`; or, with none of these, the storeys the walk finds (`storeyCuts`).
 */
export function storeysOf(map, { layout, storeys, base, storeyHeight } = {}) {
  let floors;
  let height = storeyHeight ?? layout?.storeyHeight ?? STOREY;
  if (layout) floors = Array.from({ length: layout.storeys }, (_, k) => layout.base[2] + k * layout.storeyHeight);
  else if (Array.isArray(storeys)) floors = [...storeys].sort((a, b) => a - b);
  else if (Number.isInteger(storeys)) {
    const z = Array.isArray(base) ? base[2] : base ?? 0;
    floors = Array.from({ length: storeys }, (_, k) => z + k * height);
  } else {
    const cuts = storeyCuts(mapOf(map));
    floors = [...new Set(cuts.map((cut) => cut.floors[0]))].sort((a, b) => a - b);
    if (!floors.length) throw new Error("storeys: the walk found no floor a player stands on; give `storeys` and `base`");
    if (floors.length > 1 && storeyHeight === undefined) height = floors[1] - floors[0];
  }
  return floors.map((floor, index) => ({
    index,
    floor,
    height: (floors[index + 1] ?? floor + height) - floor,
    cut: (floors[index + 1] ?? floor + height) - CUT_UNDER,
  }));
}

/** The storey asked for: a number of the list, or the list's first. */
function storeyAsked(list, storey = 0) {
  const found = list[storey];
  if (!found) throw new Error(`storey: 0 to ${list.length - 1}, not ${storey}`);
  return found;
}

/** The box of a map in plan, `{ min: [x, y], max: [x, y] }`, and its heights. */
function boundsOf(map) {
  if (isCompiled(map)) {
    const { mins, maxs } = worldBounds(map);
    return { min: mins, max: maxs };
  }
  const shapes = allBrushes(map).map(({ brush }) => shapeOf(brush)).filter((shape) => shape.corners.length && Number.isFinite(shape.volume)); // prettier-ignore
  return {
    min: [0, 1, 2].map((k) => Math.min(...shapes.map((shape) => shape.min[k]))),
    max: [0, 1, 2].map((k) => Math.max(...shapes.map((shape) => shape.max[k]))),
  };
}

/** The area a plan shows: the layout's footprint with a margin, or the whole map. */
function areaOf(map, layout, margin = 32) {
  if (layout) {
    const [bx, by] = layout.base;
    const g = layout.grid ?? GRID;
    return { min: [bx - margin, by - margin], max: [bx + layout.size[0] * g + margin, by + layout.size[1] * g + margin] };
  }
  const bounds = boundsOf(map);
  return { min: [bounds.min[0], bounds.min[1]], max: [bounds.max[0], bounds.max[1]] };
}

/** A plan's frame as `planOf` makes it: pixels a unit, and the world point at the picture's top left. */
function frameOf(area, scale) {
  const wide = area.max[0] - area.min[0];
  const deep = area.max[1] - area.min[1];
  scale ??= Math.min(4, Math.max(0.25, Math.min((1024 - 2 * MARGIN) / wide, (1024 - 2 * MARGIN - FOOT) / deep)));
  return {
    scale,
    x0: area.min[0] - MARGIN / scale,
    y0: area.max[1] + MARGIN / scale,
    width: Math.ceil(wide * scale + 2 * MARGIN),
    height: Math.ceil(deep * scale + 2 * MARGIN + FOOT),
  };
}
const pixelOf = (frame, x, y) => [(x - frame.x0) * frame.scale, (frame.y0 - y) * frame.scale];

// ── the layout's cells and edges in the world ───────────────────────────────
/** A layout's grid vertex `[x, y]` as a world point in plan. */
const vertexAt = (layout, [x, y]) => [layout.base[0] + x * (layout.grid ?? GRID), layout.base[1] + y * (layout.grid ?? GRID)];
/** The middle of a cell `[x, y]` in the world. */
const cellMiddle = (layout, [x, y]) => vertexAt(layout, [x + 0.5, y + 0.5]);
/** What a storey's cell holds: a room's id, "stair", "void", or null (outside). */
const cellAt = (layout, storey, x, y) => layout.storeyPlans[storey]?.cells?.[y]?.[x] ?? null;
/** The cell a world point in plan is in. */
const cellOfPoint = (layout, [x, y]) => [Math.floor((x - layout.base[0]) / (layout.grid ?? GRID)), Math.floor((y - layout.base[1]) / (layout.grid ?? GRID))]; // prettier-ignore

/** The rooms of one storey: `[{ id, cells: [[x, y]], middle: [x, y] (the cell nearest the rooms' mean) }]`. */
function roomsOf(layout, storey) {
  const byId = new Map();
  (layout.storeyPlans[storey]?.cells ?? []).forEach((row, y) =>
    row.forEach((id, x) => {
      if (id === null || id === "void" || id === "stair") return;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push([x, y]);
    }),
  );
  return [...byId].map(([id, cells]) => {
    const mean = [0, 1].map((k) => cells.reduce((sum, cell) => sum + cell[k], 0) / cells.length);
    const middle = cells.reduce((best, cell) => (Math.hypot(cell[0] - mean[0], cell[1] - mean[1]) < Math.hypot(best[0] - mean[0], best[1] - mean[1]) ? cell : best)); // prettier-ignore
    return { id, cells, middle };
  });
}

// ── what is solid where: the kit's own space (space.mjs), for a compiled map and a source alike ─────────────
/** A map's space, kept: `cut(x, y)` gives the solid stretches of an upright line. */
const spaces = new WeakMap();
function spaceFor(map) {
  if (!spaces.has(map)) spaces.set(map, spaceOf(map));
  return spaces.get(map);
}
/** The solid stretches of the world on an upright line, `[[from, to]]`, upwards. */
const solidStretches = (map, x, y) =>
  spaceFor(map)
    .cut(x, y)
    .filter((stretch) => stretch[2] === "solid")
    .map(([from, to]) => [from, to]);
/** Whether a point is in the world's solid. */
function solidAt(map, point) {
  if (isCompiled(map)) return contentsAt(map, point) === CONTENTS.SOLID;
  return solidStretches(map, point[0], point[1]).some(([from, to]) => point[2] > from && point[2] < to);
}
/**
 * The floor of a storey on an upright line: `{ z, solid }`. `z` is the highest top of solid at or under `start`
 * (and not under `least`) with open air over it: under a low ceiling the floor under it, in a wall none. `solid`:
 * no such floor and `start` itself in solid (a wall). Both null and false: open down to `least` (a void).
 */
function floorIn(stretches, start, least = -Infinity) {
  const sorted = [...stretches].sort((a, b) => a[0] - b[0]);
  let z = null;
  sorted.forEach(([, to], k) => {
    const over = sorted[k + 1]?.[0] ?? Infinity;
    if (to <= start && to >= least && over > to + 1 && (z === null || to > z)) z = to;
  });
  return { z, solid: z === null && sorted.some(([from, to]) => start > from && start < to) };
}

// ── the faces of a map, as surfaces to draw ─────────────────────────────────
/** Every brush of a source map with the entity it belongs to (null: the world). */
function allBrushes(map) {
  const list = (map.brushes ?? []).map((brush) => ({ brush, entity: null }));
  for (const entity of map.entities ?? []) for (const brush of entity.brushes ?? []) list.push({ brush, entity });
  return list;
}

/** The colour each texture name is drawn in: its picture's mean where it is to hand, else a colour of its own. */
function textureColours(bsp, { textures, folders } = {}) {
  const pictures = new Map();
  for (const texture of textures ?? []) pictures.set(texture.name.toLowerCase(), texture);
  if (bsp && folders?.length)
    for (const found of texturesFor(bsp, folders, { pixels: true }).textures)
      if (found.texture) pictures.set(found.name.toLowerCase(), found.texture);
  const kept = new Map();
  return (name) => {
    const key = name.toLowerCase();
    if (kept.has(key)) return kept.get(key);
    let colour = colourOfName(name);
    let texture = pictures.get(key);
    if (!texture && bsp) {
      const entry = bsp.textures.find((each) => each.name.toLowerCase() === key);
      if (entry?.embedded && !entry.absent) {
        try {
          texture = { ...readBspTexture(bsp, entry) };
        } catch {
          texture = null;
        }
      }
    }
    if (texture) {
      const level = texture.mips ? Math.min(3, texture.mips.length - 1) : 0;
      const { rgba } = textureRgba(texture, level);
      const sum = [0, 0, 0];
      let count = 0;
      for (let at = 0; at < rgba.length; at += 4)
        if (rgba[at + 3] > 127) {
          sum[0] += rgba[at];
          sum[1] += rgba[at + 1];
          sum[2] += rgba[at + 2];
          count++;
        }
      if (count) colour = sum.map((value) => value / count);
    }
    kept.set(key, colour);
    return colour;
  };
}
/** An embedded texture of a compiled map (bsp.mjs's `embeddedTexture`, by its entry). */
const readBspTexture = (bsp, entry) => embeddedTexture(bsp, entry.name);

/**
 * The surfaces of a map to draw: `[{ polygon, normal, name, light, s, t }]`: the world's faces and those of
 * every brush entity the game draws (shifted to where its `origin` puts it), leaving out the compilers' tools
 * and sky. `light` is the face's lightmap (a compiled map's), `s` and `t` its texture's axes.
 */
function surfacesOf(map) {
  const surfaces = [];
  if (isCompiled(map)) {
    const add = (face, shift) => {
      const texinfo = map.texinfo[face.texinfo];
      const name = map.textures[texinfo.texture]?.name ?? "";
      const kind = textureKind(name);
      if (kind.tool || kind.sky) return;
      const polygon = facePolygon(map, face).map((p) => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]]);
      const s = [...texinfo.s];
      const t = [...texinfo.t];
      // a shifted face's texture point moves with it
      s[3] -= s[0] * shift[0] + s[1] * shift[1] + s[2] * shift[2];
      t[3] -= t[0] * shift[0] + t[1] * shift[1] + t[2] * shift[2];
      surfaces.push({ polygon, normal: faceNormal(map, face), name, light: faceLightmap(map, face), s, t });
    };
    for (const face of modelFaces(map, 0)) add(face, [0, 0, 0]);
    for (const entity of map.entities.slice(1)) {
      const model = brushModelOf(entity);
      if (!model || !map.models[model]) continue;
      if (NEVER_DRAWN.test(valueOf(entity, "classname") ?? "")) continue;
      const shift = originOf(entity) ?? [0, 0, 0];
      for (const face of modelFaces(map, model)) add(face, shift);
    }
    return surfaces;
  }
  for (const { brush, entity } of allBrushes(map)) {
    if (entity && NEVER_DRAWN.test(entity.classname ?? "")) continue;
    for (const face of shapeOf(brush).faces) {
      if (!face.normal || face.polygon.length < 3) continue;
      const name = String(face.texture?.name ?? face.texture ?? "");
      const kind = textureKind(name);
      if (kind.tool || kind.sky) continue;
      surfaces.push({ polygon: face.polygon, normal: face.normal, name, light: null });
    }
  }
  return surfaces;
}

/** A polygon with what is above `z` cut off (`below`: what is below it). */
function cutAbove(polygon, z, below = false) {
  const kept = [];
  const inside = (p) => (below ? p[2] >= z : p[2] <= z);
  polygon.forEach((here, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const hereIn = inside(here);
    if (hereIn) kept.push(here);
    if (hereIn !== inside(next)) {
      const share = (z - here[2]) / (next[2] - here[2]);
      kept.push(here.map((value, axis) => value + (next[axis] - value) * share));
    }
  });
  return kept;
}

// ── 1. the storeys cut away ─────────────────────────────────────────────────
/** The three corners a storey is looked at from, as yaws (the camera's place, anticlockwise from +x). */
const CORNERS = [
  { yaw: 225, name: "SW" },
  { yaw: 315, name: "SE" },
  { yaw: 45, name: "NE" },
];

/** The light styles on as the map starts, and the sum of a face's samples at one of them. */
function lightTexture(surface, colour, counted, brightness) {
  const light = surface.light;
  const on = light.styles.filter((style) => counted(style.style));
  const K = 4;
  const width = light.width * K;
  const height = light.height * K;
  const rgba = new Uint8Array(width * height * 4);
  const sample = (i, j, k) => {
    i = Math.max(0, Math.min(light.width - 1, i));
    j = Math.max(0, Math.min(light.height - 1, j));
    let sum = 0;
    for (const style of on) sum += style.rgb[(j * light.width + i) * 3 + k];
    return Math.min(255, sum);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const qx = (x + 0.5) / K - 0.5;
      const qy = (y + 0.5) / K - 0.5;
      const i = Math.floor(qx);
      const j = Math.floor(qy);
      const fx = qx - i;
      const fy = qy - j;
      for (let k = 0; k < 3; k++) {
        const value =
          sample(i, j, k) * (1 - fx) * (1 - fy) + sample(i + 1, j, k) * fx * (1 - fy) + sample(i, j + 1, k) * (1 - fx) * fy + sample(i + 1, j + 1, k) * fx * fy; // prettier-ignore
        rgba[(y * width + x) * 4 + k] = clamp255((colour[k] * value * brightness) / 255);
      }
      rgba[(y * width + x) * 4 + 3] = 255;
    }
  const uv = (p) => {
    const s = p[0] * surface.s[0] + p[1] * surface.s[1] + p[2] * surface.s[2] + surface.s[3];
    const t = p[0] * surface.t[0] + p[1] * surface.t[1] + p[2] * surface.t[2] + surface.t[3];
    return [((s - light.originS) / LUXEL + 0.5) * K, ((t - light.originT) / LUXEL + 0.5) * K];
  };
  return { tex: { name: surface.name, width, height, rgba, flags: 0 }, uv };
}

/** A texture of one colour. */
const flatTex = (colour) => ({ name: "flat", width: 1, height: 1, rgba: new Uint8Array([...colour.map(clamp255), 255]), flags: 0 }); // prettier-ignore

/** Triangles for `render` from a polygon, wound so that the side its normal looks to is the front. */
function trianglesOf(polygon, normal, tex, uv = () => [0, 0]) {
  const tris = [];
  for (let i = 1; i + 1 < polygon.length; i++) {
    let corners = [polygon[0], polygon[i], polygon[i + 1]];
    const a = corners[0];
    const b = corners[1];
    const c = corners[2];
    const cross = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    // render's FRONT is -1 (mesh.mjs): a triangle faces the way minus its corners' cross product points
    if (cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0) corners = [a, c, b];
    tris.push({ tex, where: { bodypart: 0, model: 0, mesh: 0 }, c: corners.map((p) => { const [u, v] = uv(p); return { p, n: normal, u, v }; }) }); // prettier-ignore
  }
  return tris;
}

/** A small box's triangles (a light's mark). */
function boxTriangles(middle, half, colour) {
  const tex = flatTex(colour);
  const lo = middle.map((v) => v - half);
  const hi = middle.map((v) => v + half);
  const faces = [
    [[1, 0, 0], [[hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]], [hi[0], lo[1], hi[2]]]],
    [[-1, 0, 0], [[lo[0], lo[1], lo[2]], [lo[0], lo[1], hi[2]], [lo[0], hi[1], hi[2]], [lo[0], hi[1], lo[2]]]],
    [[0, 1, 0], [[lo[0], hi[1], lo[2]], [lo[0], hi[1], hi[2]], [hi[0], hi[1], hi[2]], [hi[0], hi[1], lo[2]]]],
    [[0, -1, 0], [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [lo[0], lo[1], hi[2]]]],
    [[0, 0, 1], [[lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]]],
    [[0, 0, -1], [[lo[0], lo[1], lo[2]], [lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], lo[1], lo[2]]]],
  ]; // prettier-ignore
  return faces.flatMap(([normal, polygon]) => trianglesOf(polygon, normal, tex));
}

/** The lights of a map, as points: a compiled map's entities, or a source's. */
function lightsOf(map) {
  const list = isCompiled(map)
    ? map.entities.filter((entity) => /^light/.test(valueOf(entity, "classname") ?? "")).map((entity) => originOf(entity))
    : (map.entities ?? []).filter((entity) => /^light/.test(entity.classname ?? "")).map((entity) => String(entity.origin ?? "").split(/\s+/).map(Number)); // prettier-ignore
  return list.filter((point) => point && point.length === 3 && point.every(Number.isFinite));
}

/**
 * Each storey seen from above at three corners (south-west, south-east, north-east) with everything over its
 * ceiling cut away (WebitroHQ's `cut_y`): its floor, walls, stair and doors in one picture, with no
 * perspective, so heights and gaps can be compared across it. The walls nearest the eye are seen from their
 * back and left out (a doll's house), their cut tops drawn as red lines; a light is a small yellow box.
 *
 *   storeys, base, storeyHeight, layout   which storeys (see `storeysOf`): a layout's own unless told
 *   only          a storey's number: that one alone
 *   flat          true: each texture's mean colour shaded by the way a face looks, not the map's light (a
 *                 source map is always drawn so)
 *   brightness    what the light is multiplied by (1.55, the game's look; more to look into the dark)
 *   pitch         how steeply it looks down, degrees (50)
 *   width, height one corner's picture (480 x 400); the three side by side make a storey's picture
 *   textures, folders   where the textures' pictures are (`readWad(..).textures`; the game's folders)
 *   out           a folder: each storey written there as `cutaway-s<k>.png` (`cutaway-flat-s<k>.png` unlit)
 * Returns a list of pictures, one a storey; `facts`: `{ storey, floor, cut, corners, lit, faces, notes }`.
 */
export function storeyCutaways(map, options = {}) {
  map = mapOf(map);
  const compiled = isCompiled(map);
  const list = storeysOf(map, options);
  const chosen = options.only === undefined ? list : [storeyAsked(list, options.only)];
  const lit = compiled && !options.flat && map.lumps.lighting.length > 0;
  const colourOf = textureColours(compiled ? map : null, options);
  const counted = compiled ? stylesCounted(map, "start") : null;
  const brightness = options.brightness ?? BRIGHTNESS;
  const width = options.width ?? 480;
  const height = options.height ?? 400;
  const pitch = options.pitch ?? 50;
  const surfaces = surfacesOf(map);
  const bounds = boundsOf(map);
  const area = areaOf(map, options.layout, 16);
  const lights = lightsOf(map);
  const pictures = [];
  for (const storey of chosen) {
    const tris = [];
    // what stands on the storey's floor and over it: all that is drawn outside the floor's own outline, so
    // the storey under it shows only through the floor's holes (a stairwell's void), not round its edges
    const upper = [];
    const cutLines = [];
    let faces = 0;
    for (const surface of surfaces) {
      const top = Math.max(...surface.polygon.map((p) => p[2]));
      const bottom = Math.min(...surface.polygon.map((p) => p[2]));
      if (bottom > storey.cut || top < storey.floor - storey.height - SLAB) continue;
      const polygon = top > storey.cut ? cutAbove(surface.polygon, storey.cut) : surface.polygon;
      if (polygon.length < 3) continue;
      if (top > storey.cut) {
        const onCut = polygon.filter((p) => Math.abs(p[2] - storey.cut) < 1e-6);
        if (onCut.length >= 2) cutLines.push([onCut[0], onCut[onCut.length - 1]]);
      }
      const colour = colourOf(surface.name);
      let made;
      if (lit && surface.light) made = lightTexture(surface, colour, counted, brightness);
      else made = { tex: flatTex(lit ? colour.map((v) => v * 0.15) : colour) };
      tris.push(...trianglesOf(polygon, surface.normal, made.tex, made.uv));
      const over = top <= storey.floor - 1 ? [] : bottom >= storey.floor - 1 ? polygon : cutAbove(polygon, storey.floor - 1, true);
      if (over.length >= 3) upper.push(...trianglesOf(over, surface.normal, made.tex, made.uv));
      faces++;
    }
    for (const point of lights)
      if (point[2] >= storey.floor && point[2] <= storey.cut + SLAB) {
        tris.push(...boxTriangles(point, 6, [255, 226, 70]));
        upper.push(...boxTriangles(point, 6, [255, 226, 70]));
      }
    // the floor's outline: the layout's footprint (to the walls' outer faces) or the map's
    const outline = options.layout ? areaOf(map, options.layout, 8) : { min: bounds.min, max: bounds.max };
    // one frame for every corner: the storey's middle, and the reach of the building's plan
    const mid = [(area.min[0] + area.max[0]) / 2, (area.min[1] + area.max[1]) / 2, storey.floor + storey.height / 3];
    const far = Math.hypot(area.max[0] - area.min[0], area.max[1] - area.min[1], storey.height) / 2;
    const views = CORNERS.map((corner) => {
      const asked = { view: "orbit", yaw: corner.yaw, pitch, width, height, within: { mid, far }, light: !lit, cull: true, background: [24, 26, 32] }; // prettier-ignore
      const view = render(null, { ...asked, tris });
      const project = orbitProjection(corner.yaw, pitch, mid, far, width, height);
      // outside the floor's outline, only what stands on the floor
      if (storey.index > 0 || storey.floor > bounds.min[2] + SLAB) {
        const above = render(null, { ...asked, tris: upper.length ? upper : boxTriangles(mid, 0.01, [24, 26, 32]) });
        const corners = [
          [outline.min[0], outline.min[1]],
          [outline.max[0], outline.min[1]],
          [outline.max[0], outline.max[1]],
          [outline.min[0], outline.max[1]],
        ].map(([x, y]) => project([x, y, storey.floor]));
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++)
            if (!insideConvex(corners, x + 0.5, y + 0.5)) view.rgba.set(above.rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (y * width + x) * 4); // prettier-ignore
      }
      // the cut walls' tops, where they would be: red lines
      for (const [a, b] of cutLines) thickLine(view, project(a), project(b), [220, 40, 40], 1);
      label(view, `S${storey.index} FROM ${corner.name}`, 6, height - 16, 2);
      return view;
    });
    const picture = tile(views, views.length);
    label(picture, `STOREY ${storey.index}  FLOOR Z ${round(storey.floor)}  CUT AT Z ${round(storey.cut)}  ${lit ? "MAP LIGHT" : "FLAT SHADING"}`, 6, 6, 2); // prettier-ignore
    picture.facts = {
      storey: storey.index,
      floor: storey.floor,
      cut: storey.cut,
      corners: CORNERS.map((corner) => corner.name),
      lit,
      faces,
      bounds,
      notes: [
        compiled ? (lit ? "lit by the map's own lightmaps, as the map starts" : "flat: each texture's mean colour, shaded by the way a face looks") : "a source map: each texture's colour, shaded by the way a face looks; no light yet", // prettier-ignore
        "the walls nearest the eye are seen from behind and not drawn; red lines are where walls were cut",
      ],
    };
    pictures.push(written(picture, options.out, `cutaway-${lit ? "" : "flat-"}s${storey.index}.png`));
  }
  return pictures;
}

/** Whether a point is inside a convex polygon of the picture (either way round). */
function insideConvex(corners, x, y) {
  let sign = 0;
  for (let k = 0; k < corners.length; k++) {
    const [ax, ay] = corners[k];
    const [bx, by] = corners[(k + 1) % corners.length];
    const side = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (side === 0) continue;
    if (sign === 0) sign = Math.sign(side);
    else if (Math.sign(side) !== sign) return false;
  }
  return true;
}

/** Where `render` puts a point in an orbit view framed by `{ mid, far }`: (p) -> [x, y] in pixels. */
function orbitProjection(yaw, pitch, mid, far, width, height) {
  const d = Math.PI / 180;
  const back = [Math.cos(pitch * d) * Math.cos(yaw * d), Math.cos(pitch * d) * Math.sin(yaw * d), Math.sin(pitch * d)];
  const forward = back.map((v) => -v);
  const right = normalised([forward[1], -forward[0], 0]);
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const scale = (Math.min(width, height) * 0.46) / far; // render.mjs's FIT
  return (p) => {
    const q = [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]];
    return [width / 2 + (q[0] * right[0] + q[1] * right[1] + q[2] * right[2]) * scale, height / 2 - (q[0] * up[0] + q[1] * up[1] + q[2] * up[2]) * scale]; // prettier-ignore
  };
}
const normalised = (v) => {
  const length = Math.hypot(...v) || 1;
  return v.map((value) => value / length);
};

// ── 2. a storey's plan, the layout laid over it ─────────────────────────────
/** The colours of a layout's edges, by kind. */
export const EDGE_COLOURS = {
  exterior: [200, 80, 230],
  interior: [200, 80, 230],
  door: [60, 230, 90],
  entrance: [60, 220, 240],
  window: [80, 140, 255],
  rail: [255, 160, 40],
};
const MISMATCH = [255, 40, 40];

/**
 * What the built map has on a layout's edge, measured: for a door or an entrance, the sill (the lowest open
 * height over the floor at the edge's middle) and the head; for a wall, whether it is solid at the middle at
 * 36 and 100 over the floor; for a rail, whether something stands at 24 over the floor. `{ ok, says }`.
 */
function edgeMeasured(map, layout, storey, edge) {
  const a = vertexAt(layout, edge.from);
  const b = vertexAt(layout, edge.to);
  let middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // an edge of a doorway of two edges (128, its middle vertex `at`): measured 16 from `at`, inside its opening
  const sameEdge = (e) => [[e.from, e.to], [e.to, e.from]].some(([p, q]) => p.join() === edge.from.join() && q.join() === edge.to.join()); // prettier-ignore
  const doorway = [...(layout.doors ?? []), ...(layout.entrance ? [layout.entrance] : [])].find((d) => (d.storey ?? 0) === storey.index && d.at && d.edges?.some(sameEdge)); // prettier-ignore
  if (doorway && (edge.kind === "door" || edge.kind === "entrance")) {
    const m = vertexAt(layout, doorway.at);
    const far = doorway.at.join() === edge.from.join() ? b : a;
    middle = [m[0] + (far[0] - m[0]) / 4, m[1] + (far[1] - m[1]) / 4];
  }
  const floor = storey.floor;
  const solid = (z) => solidAt(map, [middle[0], middle[1], floor + z]);
  const where = `edge ${edge.from.join(",")}-${edge.to.join(",")} (${edge.kind}, storey ${storey.index})`;
  if (edge.kind === "door" || edge.kind === "entrance") {
    let sill = null;
    // asked half a unit over each whole height, so a face exactly on it is passed by a compiled map and a source alike
    for (let z = 0; z < storey.height - SLAB; z += 1) if (!solid(z + 0.5)) { sill = z; break; } // prettier-ignore
    if (sill === null) return { ok: false, says: `${where}: solid from the floor to the ceiling at its middle (${middle.map(Math.round).join(", ")}): no doorway was built` }; // prettier-ignore
    let head = sill;
    while (head < storey.height && !solid(head + 0.5)) head++;
    const ok = sill <= 1 && head - sill >= 72;
    return { ok, sill, head, says: ok ? `${where}: open from the floor to ${head}` : `${where}: the doorway is open from ${sill} to ${head} over the floor; a doorway is open from the floor (0) and at least 72 high` }; // prettier-ignore
  }
  if (edge.kind === "rail") {
    // a rail is balusters with gaps, and it may stand to one side of the edge's line (the stair piece's is on its
    // landing): something solid at 24 anywhere in the band 6 either side of the line, along its middle 48
    const along = normalised([b[0] - a[0], b[1] - a[1], 0]);
    const across = [along[1], -along[0]];
    let ok = false;
    for (let t = -24; t <= 24 && !ok; t += 2)
      for (let s = -6; s <= 6 && !ok; s += 2)
        ok = solidAt(map, [middle[0] + along[0] * t + across[0] * s, middle[1] + along[1] * t + across[1] * s, floor + 24]); // prettier-ignore
    return { ok, says: ok ? `${where}: a rail stands there` : `${where}: nothing stands 24 over the floor: no rail closes the void` };
  }
  if (edge.kind === "window") return { ok: true, says: `${where}: a window (not measured)` };
  const ok = solid(36) && solid(100);
  return { ok, says: ok ? `${where}: a wall stands there` : `${where}: open at ${solid(36) ? 100 : 36} over the floor at its middle: the layout wants a wall` }; // prettier-ignore
}

/**
 * One storey from straight above, cut at 36 over its floor (a player's middle: doorways open, steps not walls),
 * on the 64 grid, with the coordinates written every `every` cells along the top and the left (world units)
 * and the cells' numbers along the bottom and the right. With `layout`, its plan laid over the built one:
 * each room's name in its middle cell, the stair's cells hatched yellow and the void's red, and each edge in
 * its kind's colour (`EDGE_COLOURS`: walls dashed, doors and rails solid); each edge is also MEASURED in the
 * built map, and one that is not what the layout says is crossed in red and told in `facts.mismatches` (a
 * doorway whose sill is 48 over the floor, a wall that is not there).
 *
 *   storey, storeys, base, storeyHeight   which storey (see `storeysOf`)
 *   layout       a `smak-layout/1`
 *   scale        pixels a unit (fitted to 1024 unless told); `every` cells between labels (2)
 *   textures, folders, light   as `planOf` takes them (light false unless told)
 *   out          a folder: written as `plan-s<k>.png`
 * Returns a picture; `facts`: `{ storey, floor, z, scale, x0, y0, rooms: [{ id, cell, at }], edges,
 * mismatches, notes }`.
 */
export function storeyPlan(map, options = {}) {
  map = mapOf(map);
  const layout = options.layout;
  const storey = storeyAsked(storeysOf(map, options), options.storey ?? 0);
  const area = areaOf(map, layout, 64);
  const frame = frameOf(area, options.scale);
  const z = storey.floor + 36;
  const asked = { z, area, scale: frame.scale, light: options.light ?? false, textures: options.textures, folders: options.folders, labels: false }; // prettier-ignore
  const plan = isCompiled(map) ? planOf(map, asked) : planOfSource(map, asked);
  const picture = { width: plan.width, height: plan.height, rgba: plan.rgba };
  const at = (x, y) => [(x - plan.facts.x0) * plan.facts.scale, (plan.facts.y0 - y) * plan.facts.scale];
  const facts = { storey: storey.index, floor: storey.floor, z, scale: plan.facts.scale, x0: plan.facts.x0, y0: plan.facts.y0, rooms: [], edges: [], mismatches: [], notes: [] }; // prettier-ignore

  // the grid: a faint line every 64, a stronger one every `every`, the numbers
  const every = options.every ?? 2;
  const g = layout?.grid ?? GRID;
  const origin = layout ? layout.base : [0, 0];
  const first = (low) => Math.ceil((low - origin[0]) / g);
  const columns = [];
  for (let i = first(area.min[0]); origin[0] + i * g <= area.max[0]; i++) columns.push(i);
  const rows = [];
  for (let j = Math.ceil((area.min[1] - origin[1]) / g); origin[1] + j * g <= area.max[1]; j++) rows.push(j);
  const [, top] = at(0, area.max[1]);
  const [, bottom] = at(0, area.min[1]);
  const [left] = at(area.min[0], 0);
  const [right] = at(area.max[0], 0);
  for (const i of columns) {
    const [x] = at(origin[0] + i * g, 0);
    const strong = i % every === 0;
    for (let y = Math.round(top); y <= bottom; y++) blend(picture, x, y, [255, 255, 255], strong ? 0.35 : 0.15);
    if (strong) labelAt(picture, `${origin[0] + i * g}`, x, top - 8, 1);
    if (layout && i >= 0 && i < layout.size[0]) labelAt(picture, `${i}`, x + (g * frame.scale) / 2, bottom + 8, 1, [170, 170, 170]);
  }
  for (const j of rows) {
    const [, y] = at(0, origin[1] + j * g);
    const strong = j % every === 0;
    for (let x = Math.round(left); x <= right; x++) blend(picture, x, y, [255, 255, 255], strong ? 0.35 : 0.15);
    if (strong) label(picture, `${origin[1] + j * g}`, 2, Math.round(y - 3), 1);
    if (layout && j >= 0 && j < layout.size[1]) labelAt(picture, `${j}`, right + 8, y - (g * frame.scale) / 2, 1, [170, 170, 170]);
  }

  if (layout) {
    const plan = layout.storeyPlans[storey.index];
    // the stair's cells and the void's, hatched
    (plan?.cells ?? []).forEach((row, j) =>
      row.forEach((id, i) => {
        if (id !== "stair" && id !== "void") return;
        const [x0, y1] = at(...vertexAt(layout, [i, j]));
        const [x1, y0] = at(...vertexAt(layout, [i + 1, j + 1]));
        const colour = id === "stair" ? [255, 220, 60] : [255, 70, 70];
        for (let y = Math.ceil(y0); y < y1; y++)
          for (let x = Math.ceil(x0); x < x1; x++) if ((x + y) % 8 < 2) blend(picture, x, y, colour, 0.7);
        labelAt(picture, id === "stair" ? "ST" : "V", (x0 + x1) / 2, (y0 + y1) / 2, 1, colour);
      }),
    );
    // the edges, each measured
    for (const edge of plan?.edges ?? []) {
      const a = at(...vertexAt(layout, edge.from));
      const b = at(...vertexAt(layout, edge.to));
      const colour = EDGE_COLOURS[edge.kind] ?? [255, 255, 255];
      const measured = edgeMeasured(map, layout, storey, edge);
      facts.edges.push({ ...edge, ok: measured.ok, sill: measured.sill, head: measured.head });
      if (edge.kind === "exterior" || edge.kind === "interior") thickLine(picture, a, b, colour, 2, 4);
      else {
        // an opening: the middle 48 of the edge, thick
        const share = (1 - 48 / g) / 2;
        const p = mix(a, b, share);
        const q = mix(a, b, 1 - share);
        thickLine(picture, p, q, colour, 4);
        labelAt(picture, edge.kind === "door" ? "D" : edge.kind[0].toUpperCase(), (a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 8, 1, colour); // prettier-ignore
      }
      if (!measured.ok) {
        facts.mismatches.push(measured.says);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const r = 10;
        thickLine(picture, [m[0] - r, m[1] - r], [m[0] + r, m[1] + r], MISMATCH, 3);
        thickLine(picture, [m[0] - r, m[1] + r], [m[0] + r, m[1] - r], MISMATCH, 3);
        if (measured.sill !== undefined && measured.sill !== null) labelAt(picture, `SILL ${measured.sill}`, m[0], m[1] + r + 8, 1, MISMATCH);
      }
    }
    // the rooms' names, each in its middle cell
    for (const room of roomsOf(layout, storey.index)) {
      const [x, y] = at(...cellMiddle(layout, room.middle));
      const k = textWidth(room.id, 2) <= g * frame.scale - 4 ? 2 : 1;
      labelAt(picture, room.id.toUpperCase(), x, y, k, [255, 255, 255]);
      facts.rooms.push({ id: room.id, cell: room.middle, at: [Math.round(x), Math.round(y)] });
    }
    if (layout.stairwell && (layout.stairwell.from === storey.index || layout.stairwell.to === storey.index)) {
      const cells = layout.stairwell.cells;
      const lo = [0, 1].map((k) => Math.min(...cells.map((cell) => cell[k])));
      const hi = [0, 1].map((k) => Math.max(...cells.map((cell) => cell[k])) + 1);
      const foot = { south: [(lo[0] + hi[0]) / 2, lo[1]], north: [(lo[0] + hi[0]) / 2, hi[1]], west: [lo[0], (lo[1] + hi[1]) / 2], east: [hi[0], (lo[1] + hi[1]) / 2] }[layout.stairwell.foot]; // prettier-ignore
      if (foot) {
        const [x, y] = at(...vertexAt(layout, foot));
        labelAt(picture, "FOOT", x, y + (layout.stairwell.foot === "south" ? 10 : -10), 1, [255, 220, 60]);
      }
    }
  }
  label(picture, `STOREY ${storey.index}  FLOOR Z ${round(storey.floor)}  CUT AT Z ${round(z)}  GRID ${g}${facts.mismatches.length ? `  ${facts.mismatches.length} EDGES NOT AS THE LAYOUT SAYS` : ""}`, 6, 6, 2, facts.mismatches.length ? MISMATCH : [235, 235, 235]); // prettier-ignore
  facts.notes.push(
    "the built map cut at 36 over the floor: solid where walls are; the layout's edges over it (walls dashed purple, doors green, rails orange, windows blue), each measured in the map: a red cross is an edge that is not as the layout says",
  );
  picture.facts = facts;
  return written(picture, options.out, `plan-s${storey.index}.png`);
}

// ── 3. the floor's height in colour ─────────────────────────────────────────
/** The colour of a height over a storey's floor: the floor teal, rising through green and yellow to red at the
 *  next floor; under the floor blue; over the next floor pink. */
const HEIGHT_STOPS = [
  [0, [40, 120, 150]],
  [0.25, [60, 170, 90]],
  [0.5, [220, 210, 60]],
  [0.75, [240, 130, 40]],
  [1, [220, 40, 60]],
];
export function heightColour(rise, storeyHeight) {
  if (rise < -2) return mix([40, 60, 160], [10, 14, 40], Math.min(1, -rise / storeyHeight));
  if (rise > storeyHeight + 2) return [255, 150, 220];
  const share = Math.max(0, Math.min(1, rise / storeyHeight));
  for (let k = 1; k < HEIGHT_STOPS.length; k++)
    if (share <= HEIGHT_STOPS[k][0]) {
      const [a, ca] = HEIGHT_STOPS[k - 1];
      const [b, cb] = HEIGHT_STOPS[k];
      return mix(ca, cb, (share - a) / (b - a));
    }
  return HEIGHT_STOPS.at(-1)[1];
}

/**
 * One storey from straight above, each spot coloured by the height of the floor under it (the first solid
 * going down from just under the ceiling): the storey's floor teal, a stair rising through green and yellow to
 * red at the next floor, what is under the floor blue, solid (walls) light grey, no floor black. A step of
 * more than 18 between two spots (a ledge no player walks up) is a red line, so the foot of a stair that does
 * not meet its floor is crossed by one, and a stair that stops short of the floor over it shows a jump of colour.
 * A spot where a standing player does not fit (by a wall, under a low ceiling) is striped darker. Each cell's
 * floor height (at its middle) is written in it, and `facts.text` is the same as a table, north up.
 *
 *   storey, storeys, base, storeyHeight, layout   which storey (see `storeysOf`); the layout frames it
 *   step         units between spots (8); scale (as `storeyPlan`'s, so the two lie pixel on pixel)
 *   out          a folder: written as `heights-s<k>.png` (and `heights-s<k>.txt`)
 * Returns a picture; `facts`: `{ storey, floor, ledges: [{ at: [x, y], from, to }], cells: [{ cell, z, solid }], text,
 * notes }`.
 */
export function falseColourHeight(map, options = {}) {
  map = mapOf(map);
  const layout = options.layout;
  const storey = storeyAsked(storeysOf(map, options), options.storey ?? 0);
  const area = areaOf(map, layout, 64);
  const frame = frameOf(area, options.scale);
  const step = options.step ?? Math.max(4, Math.ceil(Math.max(area.max[0] - area.min[0], area.max[1] - area.min[1]) / 256 / 4) * 4); // prettier-ignore
  const picture = canvasOf(frame.width, frame.height, [16, 16, 20]);
  const start = storey.floor + storey.height - SLAB - 2;
  const least = storey.floor - storey.height;
  const space = spaceFor(map);
  const columns = Math.ceil((area.max[0] - area.min[0]) / step);
  const rows = Math.ceil((area.max[1] - area.min[1]) / step);
  const heights = new Float64Array(columns * rows).fill(NaN);
  const kinds = new Uint8Array(columns * rows); // 0 no floor, 1 floor, 2 solid
  const fits = new Uint8Array(columns * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const x = area.min[0] + (i + 0.5) * step;
      const y = area.min[1] + (j + 0.5) * step;
      const at = j * columns + i;
      const { z, solid } = floorIn(solidStretches(map, x, y), start, least);
      if (solid) kinds[at] = 2;
      if (z === null) continue;
      kinds[at] = 1;
      heights[at] = z;
      // a standing player fits where its feet can be on this floor: the top of a stretch it is kept out of
      fits[at] = space.blocked(x, y, "standing").some(([, to]) => Math.abs(to - z) <= 1) ? 1 : 0;
    }
  const ledges = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const at = j * columns + i;
      const x = area.min[0] + i * step;
      const y = area.min[1] + j * step;
      const [px, py] = pixelOf(frame, x, y + step);
      const [qx, qy] = pixelOf(frame, x + step, y);
      let colour = [16, 16, 20];
      if (kinds[at] === 2) colour = [190, 190, 196];
      else if (kinds[at] === 1) colour = heightColour(heights[at] - storey.floor, storey.height);
      for (let yy = Math.floor(py); yy < Math.ceil(qy); yy++)
        for (let xx = Math.floor(px); xx < Math.ceil(qx); xx++) {
          const stripe = kinds[at] === 1 && !fits[at] && (xx + yy) % 6 < 2;
          blend(picture, xx, yy, stripe ? colour.map((v) => v * 0.45) : colour);
        }
    }
  // the ledges: between two floor spots more than a step apart
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const at = j * columns + i;
      if (kinds[at] !== 1) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) { // prettier-ignore
        if (i + di >= columns || j + dj >= rows) continue;
        const other = (j + dj) * columns + i + di;
        if (kinds[other] !== 1 || Math.abs(heights[other] - heights[at]) <= STEP) continue;
        const x = area.min[0] + (i + di) * step;
        const y = area.min[1] + (j + dj) * step;
        const a = pixelOf(frame, x, y);
        const b = di ? pixelOf(frame, x, y + step) : pixelOf(frame, x + step, y);
        thickLine(picture, a, b, [255, 30, 30], 3);
        ledges.push({ at: [x, y], from: heights[at], to: heights[other] });
      }
    }
  // each cell's floor at its middle, written; a table of them
  const g = layout?.grid ?? GRID;
  const origin = layout ? layout.base : [Math.floor(area.min[0] / g) * g, Math.floor(area.min[1] / g) * g];
  const cells = [];
  const table = [];
  const across = Math.ceil((area.max[0] - origin[0]) / g);
  const down = Math.ceil((area.max[1] - origin[1]) / g);
  const lowCol = layout ? 0 : Math.floor((area.min[0] - origin[0]) / g);
  const lowRow = layout ? 0 : Math.floor((area.min[1] - origin[1]) / g);
  const lastCol = layout ? layout.size[0] : across;
  const lastRow = layout ? layout.size[1] : down;
  for (let j = lastRow - 1; j >= lowRow; j--) {
    const line = [];
    for (let i = lowCol; i < lastCol; i++) {
      const x = origin[0] + (i + 0.5) * g;
      const y = origin[1] + (j + 0.5) * g;
      const { z, solid: solidHere } = floorIn(solidStretches(map, x, y), start, least);
      cells.push({ cell: [i, j], z, solid: solidHere });
      line.push(solidHere ? "  ##" : z === null ? "   ." : String(Math.round(z - storey.floor)).padStart(4));
      if (z !== null && g * frame.scale >= 40) {
        const [px, py] = pixelOf(frame, x, y);
        labelAt(picture, `${Math.round(z - storey.floor)}`, px, py, 2, [255, 255, 255]);
      }
    }
    table.push(`${String(j).padStart(3)} |${line.join("")}`);
  }
  const header = `    |${Array.from({ length: lastCol - lowCol }, (_, k) => String(lowCol + k).padStart(4)).join("")}`;
  const text = [`storey ${storey.index}: the floor at each cell's middle, units over z ${storey.floor} (## solid, . no floor); north up`, header, ...table].join("\n"); // prettier-ignore
  // the legend: the colours of the heights
  const legendY = frame.height - FOOT + 14;
  const legendX = MARGIN;
  const legendW = Math.min(frame.width - 2 * MARGIN - 120, 360);
  for (let x = 0; x < legendW; x++) {
    const rise = -storey.height * 0.25 + (x / legendW) * storey.height * 1.5;
    fillRect(picture, legendX + x, legendY, legendX + x + 1, legendY + 10, heightColour(rise, storey.height));
  }
  for (const rise of [0, storey.height / 2, storey.height]) {
    const x = legendX + ((rise + storey.height * 0.25) / (storey.height * 1.5)) * legendW;
    thickLine(picture, [x, legendY - 2], [x, legendY + 12], [255, 255, 255], 1);
    labelAt(picture, `${Math.round(rise)}`, x, legendY + 20, 1);
  }
  label(picture, "RED LINE: A LEDGE OVER 18", legendX + legendW + 12, legendY, 1, [255, 80, 80]);
  label(picture, "STRIPED: NO ROOM TO STAND", legendX + legendW + 12, legendY + 12, 1);
  label(picture, `STOREY ${storey.index}  FLOOR HEIGHT OVER Z ${round(storey.floor)}`, 6, 6, 2);
  picture.facts = {
    storey: storey.index,
    floor: storey.floor,
    step,
    scale: frame.scale,
    x0: frame.x0,
    y0: frame.y0,
    ledges,
    cells,
    text,
    notes: ["each spot is the floor under it, measured in the map's own tree from just under the ceiling down; a red line is a rise of more than 18 between two spots a step apart"], // prettier-ignore
  };
  if (options.out) {
    mkdirSync(options.out, { recursive: true });
    writeFileSync(join(options.out, `heights-s${storey.index}.txt`), `${text}\n`);
  }
  return written(picture, options.out, `heights-s${storey.index}.png`);
}

// ── 4. at eye height ────────────────────────────────────────────────────────
/** The stands of the eye shots a layout asks for: `[{ name, from, to, storey, question, kind }]`. */
export function eyeStands(layout) {
  const g = layout.grid ?? GRID;
  const floorOf = (k) => layout.base[2] + k * layout.storeyHeight;
  const stands = [];
  // each door from each side: 96 back from the edge's middle, looking through it a little down at its sill
  // (a doorway of two edges, `edges` and `at`, from its first edge's start to its second's end; the entrance too)
  const entrance = layout.entrance ? [{ ...layout.entrance, storey: layout.entrance.storey ?? 0, rooms: [layout.entrance.room, "outside"], entrance: true }] : []; // prettier-ignore
  for (const door of [...(layout.doors ?? []), ...entrance]) {
    const first = door.edges?.[0] ?? door.edge;
    const last = door.edges?.[door.edges.length - 1] ?? door.edge;
    if (!first || !last) continue;
    const a = vertexAt(layout, first.from);
    const b = vertexAt(layout, last.to);
    const middle = door.at ? vertexAt(layout, door.at) : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const along = normalised([b[0] - a[0], b[1] - a[1], 0]);
    const across = [along[1], -along[0]];
    const floor = floorOf(door.storey);
    for (const side of [1, -1]) {
      const into = [middle[0] + across[0] * side * (g / 2), middle[1] + across[1] * side * (g / 2)];
      const [ci, cj] = cellOfPoint(layout, into);
      const room = cellAt(layout, door.storey, ci, cj) ?? "outside";
      const other = door.rooms.find((id) => id !== room) ?? "outside";
      stands.push({
        kind: "door",
        storey: door.storey,
        name: door.entrance ? `s${door.storey}-entrance-${door.rooms[0]}-from-${room}` : `s${door.storey}-door-${door.rooms.join("-")}-from-${room}`, // prettier-ignore
        from: [middle[0] + across[0] * side * 96, middle[1] + across[1] * side * 96, floor + EYE],
        to: [middle[0] - across[0] * side * 64, middle[1] - across[1] * side * 64, floor + 40],
        question: `Looking from ${room} into ${other} through the doorway: does its opening start at the floor on both sides (no sill, no step up), and does the door leaf stand on the floor?`, // prettier-ignore
      });
    }
  }
  // the stair: at its foot looking up it, from beside it, and from its top looking down
  const well = layout.stairwell;
  if (well?.cells?.length) {
    const lo = [0, 1].map((k) => Math.min(...well.cells.map((cell) => cell[k])));
    const hi = [0, 1].map((k) => Math.max(...well.cells.map((cell) => cell[k])) + 1);
    const [x0, y0] = vertexAt(layout, lo);
    const [x1, y1] = vertexAt(layout, hi);
    const centre = [(x0 + x1) / 2, (y0 + y1) / 2];
    const ways = { south: [0, 1], north: [0, -1], west: [1, 0], east: [-1, 0] };
    const up = ways[well.foot] ?? [0, 1];
    const half = Math.abs(up[1]) ? (y1 - y0) / 2 : (x1 - x0) / 2;
    const footEnd = [centre[0] - up[0] * (half - 24), centre[1] - up[1] * (half - 24)];
    const farEnd = [centre[0] + up[0] * half, centre[1] + up[1] * half];
    const bottom = floorOf(well.from);
    const top = floorOf(well.to);
    stands.push({
      kind: "stair-foot",
      storey: well.from,
      name: `s${well.from}-stair-foot-looking-up`,
      from: [footEnd[0], footEnd[1], bottom + EYE],
      to: [farEnd[0], farEnd[1], bottom + (top - bottom) * 0.55],
      question: "At the foot of the stair, looking up it: does the first step stand on this floor with no gap under it, and does each flight run on to the next?", // prettier-ignore
    });
    // beside it: from the room cell next to the middle of a long side
    const sideWays = Math.abs(up[1]) ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [sx, sy] of sideWays) {
      const edgeMiddle = [centre[0] + sx * (Math.abs(sx) ? (x1 - x0) / 2 : 0), centre[1] + sy * (Math.abs(sy) ? (y1 - y0) / 2 : 0)];
      const eye = [edgeMiddle[0] + sx * 96, edgeMiddle[1] + sy * 96];
      const [ci, cj] = cellOfPoint(layout, eye);
      const room = cellAt(layout, well.from, ci, cj);
      if (!room || room === "void" || room === "stair") continue;
      stands.push({
        kind: "stair-side",
        storey: well.from,
        name: `s${well.from}-stair-side-from-${room}`,
        from: [eye[0], eye[1], bottom + EYE],
        to: [centre[0], centre[1], bottom + 48],
        question: "The stair seen from beside it: does it rest on the floor along its whole length, with nothing floating and no gap under its first step?", // prettier-ignore
      });
      break;
    }
    const arrivals = well.cells.filter(([i, j]) => cellAt(layout, well.to, i, j) === "stair");
    const arrival = arrivals.length
      ? [0, 1].map((k) => arrivals.reduce((sum, cell) => sum + cell[k] + 0.5, 0) / arrivals.length)
      : null;
    const topAt = arrival ? vertexAt(layout, arrival) : footEnd;
    stands.push({
      kind: "stair-top",
      storey: well.to,
      name: `s${well.to}-stair-top-looking-down`,
      from: [topAt[0] - up[0] * 16, topAt[1] - up[1] * 16, top + EYE],
      to: [farEnd[0], farEnd[1], bottom + (top - bottom) * 0.4],
      question: "At the top of the stair, looking down it: does the last step meet this floor level with it (no step up or down onto the floor), and is the void beside it closed by a rail?", // prettier-ignore
    });
  }
  // each room's middle, looking along its longer way
  for (let k = 0; k < layout.storeys; k++)
    for (const room of roomsOf(layout, k)) {
      const [mx, my] = cellMiddle(layout, room.middle);
      const xs = room.cells.map((cell) => cell[0]);
      const ys = room.cells.map((cell) => cell[1]);
      const wide = Math.max(...xs) - Math.min(...xs);
      const deep = Math.max(...ys) - Math.min(...ys);
      let way;
      if (wide >= deep) way = Math.max(...xs) - room.middle[0] >= room.middle[0] - Math.min(...xs) ? [1, 0] : [-1, 0];
      else way = Math.max(...ys) - room.middle[1] >= room.middle[1] - Math.min(...ys) ? [0, 1] : [0, -1];
      const reach = Math.max(wide, deep) * g + g / 2;
      stands.push({
        kind: "room",
        storey: k,
        name: `s${k}-room-${room.id}`,
        from: [mx - way[0] * 24, my - way[1] * 24, floorOf(k) + EYE],
        to: [mx + way[0] * reach, my + way[1] * reach, floorOf(k) + 40],
        question: `Across ${room.id}: is it lit enough to make out its walls, floor and doorways; does anything float over the floor or sink into it?`, // prettier-ignore
      });
    }
  return stands;
}

/**
 * First-person shots at eye height (64 over the floor's top), lit by the map's own light, from the layout's
 * doors (each side, looking through), the stair (its foot looking up, from beside it, its top looking down)
 * and each room's middle (looking across it). Each picture has its name written in it, and the question a
 * person or a vision model is asked of it (`facts.question`: "does this stair touch a floor at both ends?").
 *
 *   out          a folder: each written as `eye-<name>.png`, and `eye-shots.json` listing them
 *   width, height, fov, brightness, textures, folders   as `drawMap` takes them (480 x 360, 100 degrees)
 * Returns the list of pictures; `facts`: `{ name, kind, storey, from, to, question, inSolid, brightness, file }`.
 */
export function eyeShots(bsp, layout, options = {}) {
  bsp = mapOf(bsp);
  if (!layout) throw new Error("eyeShots: a layout (smak-layout/1) says where its doors, stair and rooms are");
  const compiled = isCompiled(bsp);
  const width = options.width ?? 480;
  const height = options.height ?? 360;
  const shots = [];
  for (const stand of eyeStands(layout)) {
    const asked = { from: stand.from, to: stand.to, width, height, fov: options.fov ?? 100, textures: options.textures, folders: options.folders, brightness: options.brightness, entities: false }; // prettier-ignore
    const view = compiled ? drawMap(bsp, asked) : drawSource(bsp, asked);
    const inSolid = solidAt(bsp, stand.from);
    const picture = { width: view.width, height: view.height, rgba: view.rgba };
    label(picture, stand.name.toUpperCase(), 6, 6, 2);
    if (inSolid) label(picture, "THE EYE IS IN SOLID", 6, 22, 2, MISMATCH);
    picture.facts = { name: stand.name, kind: stand.kind, storey: stand.storey, from: stand.from.map(round), to: stand.to.map(round), question: stand.question, inSolid, brightness: view.facts.brightness ?? null, notes: view.facts.notes }; // prettier-ignore
    shots.push(written(picture, options.out, `eye-${stand.name}.png`));
  }
  if (options.out)
    writeFileSync(join(options.out, "eye-shots.json"), `${JSON.stringify(shots.map((shot) => ({ ...shot.facts, file: `eye-${shot.facts.name}.png`, notes: undefined })), null, 2)}\n`); // prettier-ignore
  return shots;
}

// ── 5. the light on the floor ───────────────────────────────────────────────
/** The colour of a floor's light, 0 to 255: under the dark line blue to purple; over it dark red up to white. */
export function lightColour(value, dark = DARK_FLOOR) {
  if (value < dark) return mix([40, 70, 255], [170, 70, 255], value / dark);
  const share = Math.min(1, (value - dark) / (200 - dark));
  if (share < 0.33) return mix([130, 20, 30], [220, 70, 20], share / 0.33);
  if (share < 0.66) return mix([220, 70, 20], [250, 200, 40], (share - 0.33) / 0.33);
  return mix([250, 200, 40], [255, 255, 230], (share - 0.66) / 0.34);
}

/**
 * The light on one storey's floor, from the map's lightmaps, as a heat map seen from above: each light sample
 * where it is, coloured by its brightness as the map starts (the styles that are on), the floor under the
 * kit's dark line (`DARK_FLOOR`, 24 of 255) blue and purple and striped, over it red through yellow to white;
 * walls light grey. With a layout each room's name and its floor's mean are written in its middle (red,
 * with DARK, when under the line), as `lightReport` measures them.
 *
 *   storey, storeys, base, storeyHeight, layout, scale   as `falseColourHeight` takes them
 *   dark         the line (24)
 *   out          a folder: written as `light-s<k>.png`
 * Returns a picture; `facts`: `{ storey, lit, mean, darkShare, rooms: [{ name, mean, dark }], notes }`.
 */
export function darkMap(bsp, options = {}) {
  bsp = mapOf(bsp);
  if (!isCompiled(bsp)) throw new Error("darkMap: a compiled map: a source map has no light yet");
  const layout = options.layout;
  const dark = options.dark ?? DARK_FLOOR;
  const storey = storeyAsked(storeysOf(bsp, options), options.storey ?? 0);
  const area = areaOf(bsp, layout, 64);
  const frame = frameOf(area, options.scale);
  const picture = canvasOf(frame.width, frame.height, [16, 16, 20]);
  const facts = { storey: storey.index, floor: storey.floor, lit: bsp.lumps.lighting.length > 0, mean: null, darkShare: null, rooms: [], notes: [] }; // prettier-ignore
  // the walls, cut at 48 over the floor
  const step = 8;
  for (let y = area.min[1]; y < area.max[1]; y += step)
    for (let x = area.min[0]; x < area.max[0]; x += step)
      if (solidAt(bsp, [x + step / 2, y + step / 2, storey.floor + 48])) {
        const [px, py] = pixelOf(frame, x, y + step);
        const [qx, qy] = pixelOf(frame, x + step, y);
        fillRect(picture, px, py, qx, qy, [190, 190, 196]);
      }
  if (!facts.lit) {
    labelAt(picture, "NO LIGHT DATA: COMPILED WITHOUT HLRAD", frame.width / 2, frame.height / 2, 2, MISMATCH);
    facts.notes.push("the map has no light data: the game draws it fully bright");
  } else {
    const samples = [];
    floorSamples(bsp, (point, brightness, area) => {
      if (point[2] < storey.floor - 4 || point[2] > storey.cut - EYE) return;
      samples.push({ point, brightness, area });
    }, stylesCounted(bsp, "start"));
    samples.sort((a, b) => a.point[2] - b.point[2]);
    let sum = 0;
    let all = 0;
    let darkArea = 0;
    for (const { point, brightness, area: share } of samples) {
      const [px, py] = pixelOf(frame, point[0] - LUXEL / 2, point[1] + LUXEL / 2);
      const [qx, qy] = pixelOf(frame, point[0] + LUXEL / 2, point[1] - LUXEL / 2);
      const colour = lightColour(brightness, dark);
      for (let yy = Math.floor(py); yy < Math.ceil(qy); yy++)
        for (let xx = Math.floor(px); xx < Math.ceil(qx); xx++)
          blend(picture, xx, yy, brightness < dark && (((xx - yy) % 8) + 8) % 8 < 3 ? [0, 0, 30] : colour);
      sum += brightness * share;
      all += share;
      if (brightness < dark) darkArea += share;
    }
    facts.mean = all ? round(sum / all) : null;
    facts.darkShare = all ? Math.round((darkArea / all) * 100) / 100 : null;
    if (layout) {
      const g = layout.grid ?? GRID;
      const rooms = {};
      for (const room of roomsOf(layout, storey.index)) {
        const xs = room.cells.map((cell) => cell[0]);
        const ys = room.cells.map((cell) => cell[1]);
        rooms[room.id] = {
          min: [layout.base[0] + Math.min(...xs) * g, layout.base[1] + Math.min(...ys) * g, storey.floor - 2],
          max: [layout.base[0] + (Math.max(...xs) + 1) * g, layout.base[1] + (Math.max(...ys) + 1) * g, storey.cut - EYE],
        };
      }
      const report = lightReport(bsp, { rooms, dark });
      for (const room of roomsOf(layout, storey.index)) {
        const told = report.rooms.find((each) => each.name === room.id);
        if (!told) continue;
        const [x, y] = pixelOf(frame, ...cellMiddle(layout, room.middle));
        const words = told.mean === null ? `${room.id.toUpperCase()} NO FLOOR` : `${room.id.toUpperCase()} ${Math.round(told.mean)}${told.dark ? " DARK" : ""}`; // prettier-ignore
        labelAt(picture, words, x, y, 2, told.dark ? [255, 90, 90] : [255, 255, 255]);
        facts.rooms.push({ name: room.id, mean: told.mean, darkShare: told.darkShare, dark: told.dark });
      }
    }
  }
  // the legend: the colours of the light, the dark line marked
  const legendY = frame.height - FOOT + 14;
  const legendX = MARGIN;
  const legendW = Math.min(frame.width - 2 * MARGIN - 140, 360);
  for (let x = 0; x < legendW; x++) fillRect(picture, legendX + x, legendY, legendX + x + 1, legendY + 10, lightColour((x / legendW) * 255, dark)); // prettier-ignore
  const darkX = legendX + (dark / 255) * legendW;
  thickLine(picture, [darkX, legendY - 4], [darkX, legendY + 14], [255, 255, 255], 2);
  labelAt(picture, `DARK UNDER ${dark}`, darkX + 30, legendY + 22, 1);
  for (const value of [0, 128, 255]) labelAt(picture, `${value}`, legendX + (value / 255) * legendW, legendY + 22, 1);
  label(picture, `STOREY ${storey.index}  FLOOR LIGHT${facts.mean === null ? "" : `  MEAN ${facts.mean}  ${Math.round((facts.darkShare ?? 0) * 100)} IN 100 DARK`}`, 6, 6, 2, (facts.darkShare ?? 0) > 0.25 ? [255, 90, 90] : [235, 235, 235]); // prettier-ignore
  facts.notes.push(`each light sample of the floor as the map starts (the samples as the compiler stored them, 0 to 255; under ${dark} is the kit's dark line, light.mjs)`); // prettier-ignore
  picture.facts = facts;
  return written(picture, options.out, `light-s${storey.index}.png`);
}

// ── all of them ─────────────────────────────────────────────────────────────
/**
 * Every view of a map into one folder: the cutaways, and for each storey its plan, its heights and (compiled)
 * its light; with a layout, the eye shots. Returns `{ files, mismatches, dark, notes, storeys }`.
 */
export function allViews(map, options = {}) {
  map = mapOf(map);
  const files = [];
  const notes = [];
  const mismatches = [];
  const dark = [];
  const list = storeysOf(map, options);
  for (const picture of storeyCutaways(map, options)) files.push(picture.facts.file);
  // the light hides shapes in the dark: the same unlit, for the shapes
  if (isCompiled(map) && !options.flat) for (const picture of storeyCutaways(map, { ...options, flat: true })) files.push(picture.facts.file);
  for (const storey of list) {
    const plan = storeyPlan(map, { ...options, storey: storey.index });
    files.push(plan.facts.file);
    mismatches.push(...plan.facts.mismatches);
    files.push(falseColourHeight(map, { ...options, storey: storey.index }).facts.file);
    if (isCompiled(map)) {
      const light = darkMap(map, { ...options, storey: storey.index });
      files.push(light.facts.file);
      for (const room of light.facts.rooms) if (room.dark) dark.push(`${room.name} (storey ${storey.index}) ${room.mean}`);
    }
  }
  if (options.layout) for (const shot of eyeShots(map, options.layout, options)) files.push(shot.facts.file);
  else notes.push("no layout: no eye shots (they stand at the layout's doors, stair and rooms)");
  return { files: files.filter(Boolean), mismatches, dark, notes, storeys: list };
}

// ── the views' own test map ─────────────────────────────────────────────────
/**
 * A house of two storeys on the contract's grid, 8 x 5 cells, with a U-turn stair in a 2 x 4 stairwell at its
 * west end (foot south), a wall across at x = 4 with a door in it on each storey, a light in each room and a
 * place to start: `{ map (what writeMap takes), layout (smak-layout/1) }`. For the views to be tried on, and
 * broken on purpose:
 *   liftStair   units the whole stair stands over its floor (0)
 *   liftDoor    units the ground floor's doorway and door stand over the floor (0)
 *   darkRoom    a room's id left with no light ("kitchen")
 *   textures    `{ floor, wall, ceiling, stair, door, rail }`: names (Half-Life's halflife.wad's unless told)
 *   wad         the worldspawn's wad key
 */
export function sampleHouse({ liftStair = 0, liftDoor = 0, darkRoom = null, textures = {}, wad } = {}) {
  const t = { floor: "C1A0_LABFLR", wall: "C1A0_LABW4", ceiling: "C1A0_C1", stair: "CRETE4_STP01", door: "C1A0B_DR1", rail: "GENERIC015", ...textures }; // prettier-ignore
  const [W, D] = [8, 5];
  const X = W * GRID;
  const Y = D * GRID;
  const H = STOREY;
  const slab = { top: t.floor, bottom: t.ceiling, sides: t.wall };
  const brushes = [];
  // the ground, the roof and the four outer walls (16 thick, centred on the footprint's edges)
  brushes.push(box([-8, -8, -SLAB], [X + 8, Y + 8, 0], slab));
  brushes.push(box([-8, -8, 2 * H - SLAB], [X + 8, Y + 8, 2 * H], slab));
  brushes.push(box([-8, -8, 0], [8, Y + 8, 2 * H - SLAB], t.wall));
  brushes.push(box([X - 8, -8, 0], [X + 8, Y + 8, 2 * H - SLAB], t.wall));
  brushes.push(box([8, -8, 0], [X - 8, 8, 2 * H - SLAB], t.wall));
  brushes.push(box([8, Y - 8, 0], [X - 8, Y + 8, 2 * H - SLAB], t.wall));
  // the storeys' cells: stairwell x 0..1, y 0..3; storey 1 has void over the flights and floor at (1, 0)
  const cells = [[], []];
  for (let y = 0; y < D; y++) {
    cells[0].push([]);
    cells[1].push([]);
    for (let x = 0; x < W; x++) {
      const well = x <= 1 && y <= 3;
      cells[0][y].push(well ? "stair" : x < 4 ? "hall" : "kitchen");
      cells[1][y].push(well ? (x === 1 && y === 0 ? "stair" : "void") : x < 4 ? "landing" : "bed");
    }
  }
  // the upper slab, cell by cell where storey 1 has floor
  for (let y = 0; y < D; y++)
    for (let x = 0; x < W; x++)
      if (cells[1][y][x] !== "void") brushes.push(box([x * GRID, y * GRID, H - SLAB], [(x + 1) * GRID, (y + 1) * GRID, H], slab)); // prettier-ignore
  // the wall across at x = 4 (256), a doorway on edge (4,2)-(4,3): 48 wide, 112 high, from the floor
  const doorY = [2 * GRID + 8, 3 * GRID - 8];
  for (let k = 0; k < 2; k++) {
    const floor = k * H;
    const sill = floor + (k === 0 ? liftDoor : 0);
    brushes.push(box([4 * GRID - 8, 8, floor], [4 * GRID + 8, doorY[0], floor + H - SLAB], t.wall));
    brushes.push(box([4 * GRID - 8, doorY[1], floor], [4 * GRID + 8, Y - 8, floor + H - SLAB], t.wall));
    if (sill > floor) brushes.push(box([4 * GRID - 8, doorY[0], floor], [4 * GRID + 8, doorY[1], sill], t.wall));
    if (sill + 112 < floor + H - SLAB) brushes.push(box([4 * GRID - 8, doorY[0], sill + 112], [4 * GRID + 8, doorY[1], floor + H - SLAB], t.wall)); // prettier-ignore
  }
  // the stair: flight 1 up +y on x 8..64, a landing at the north end, flight 2 up -y on x 64..128 over a solid
  // core; it arrives at (1, 0) on storey 1
  const s = liftStair;
  brushes.push(...stairs([8, 48, s], [64, 192, H / 2 + s], "+y", t.stair, { steps: 6 }));
  brushes.push(box([8, 192, s], [128, 4 * GRID, H / 2 + s], { top: t.stair, bottom: t.stair, sides: t.wall }));
  brushes.push(box([64, 48, s], [128, 192, H / 2 + s], t.wall));
  brushes.push(...stairs([64, 48, H / 2 + s], [128, 192, H + s], "-y", t.stair, { steps: 6 }));
  // rails round the void on storey 1, 8 thick and 40 high
  const rail = (a, b) => brushes.push(box([a[0], a[1], H], [b[0], b[1], H + 40], t.rail));
  rail([60, 8], [68, 64]); // (0,0) | (1,0)
  rail([124, GRID], [132, 4 * GRID - 4]); // x = 128, beside the void (none between (1, 0) and (1, 1): the way up)
  rail([8, 4 * GRID - 4], [124, 4 * GRID + 4]); // y = 256, north of the void
  // the doors: a func_door_rotating standing open into the room east of the doorway
  const entities = [];
  for (let k = 0; k < 2; k++) {
    const sill = k * H + (k === 0 ? liftDoor : 0);
    const hinge = [4 * GRID + 8, doorY[1]];
    entities.push(
      brushEntity("func_door_rotating", [box([hinge[0], hinge[1] - 4, sill], [hinge[0] + 48, hinge[1], sill + 112], t.door), originBrush([hinge[0] + 2, hinge[1] - 2, sill + 56], 4)], { speed: 100, distance: 90, angles: [0, 0, 0] }), // prettier-ignore
    );
  }
  // a light in each room, under its ceiling, and a place to start in the hall
  const lamps = { hall: [176, 288, 150], kitchen: [384, 160, 150], landing: [192, 160, H + 150], bed: [384, 160, H + 150] };
  for (const [room, at] of Object.entries(lamps)) if (room !== darkRoom) entities.push(light(at, { brightness: 260 }));
  entities.push(playerStart([192, 288, 0], 270));
  // the layout: its edges
  const edges = [[], []];
  for (let k = 0; k < 2; k++) {
    const add = (from, to, kind) => {
      const roomAt = (x, y) => cells[k][y]?.[x] ?? null;
      const horizontal = from[1] === to[1];
      const [x, y] = from;
      const rooms = horizontal ? [roomAt(x, y - 1), roomAt(x, y)] : [roomAt(x - 1, y), roomAt(x, y)];
      edges[k].push({ from, to, kind, rooms });
    };
    for (let x = 0; x < W; x++) add([x, 0], [x + 1, 0], "exterior");
    for (let x = 0; x < W; x++) add([x, D], [x + 1, D], "exterior");
    for (let y = 0; y < D; y++) add([0, y], [0, y + 1], "exterior");
    for (let y = 0; y < D; y++) add([W, y], [W, y + 1], "exterior");
    for (let y = 0; y < D; y++) add([4, y], [4, y + 1], y === 2 ? "door" : "interior");
    if (k === 1) {
      add([1, 0], [1, 1], "rail");
      for (let y = 1; y < 4; y++) add([2, y], [2, y + 1], "rail");
      for (let x = 0; x < 2; x++) add([x, 4], [x + 1, 4], "rail");
    }
  }
  const layout = {
    format: "smak-layout/1",
    building: "views-sample-house",
    seed: 1,
    grid: GRID,
    storeyHeight: H,
    base: [0, 0, 0],
    size: [W, D],
    storeys: 2,
    stairwell: { cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]], from: 0, to: 1, foot: "south" }, // prettier-ignore
    storeyPlans: [0, 1].map((k) => ({ cells: cells[k], edges: edges[k] })),
    rooms: [
      { id: "hall", storey: 0, kind: "hall", cells: 12 },
      { id: "kitchen", storey: 0, kind: "kitchen", cells: 20 },
      { id: "landing", storey: 1, kind: "hall", cells: 12 },
      { id: "bed", storey: 1, kind: "bedroom", cells: 20 },
    ],
    doors: [
      { rooms: ["hall", "kitchen"], storey: 0, edge: { from: [4, 2], to: [4, 3] } },
      { rooms: ["landing", "bed"], storey: 1, edge: { from: [4, 2], to: [4, 3] } },
    ],
    failures: [],
    warnings: [],
  };
  return { map: { worldspawn: wad ? { wad } : {}, brushes, entities }, layout };
}
