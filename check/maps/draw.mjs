// Pictures of a map, with nothing but arithmetic: no browser, no GPU. A compile that passes can still be dark
// or have a door in the wrong wall, and only a picture shows it.
//
//   drawMap(bsp, options)        a view from a point inside a compiled map, textured and lit by its lightmaps
//   planOf(bsp, options)         the map from above: floors, walls, every entity marked, a scale and north
//   viewsOf(bsp, options)        several views in one picture: from the places to start, and from the largest rooms
//   compareOf(maps, options)     several maps from above at ONE scale in one picture, each with its name and size
//   drawSource(map, options)     a view of brush source (what `writeMap` takes), before any compile
//   planOfSource(map, options)   its plan: a cut through the brushes at a height
//   viewFrom(bspOrMap, which)    where an entity stands and the way it looks, for a view from it
//   sectionOf(bspOrMap, options) a side section: an upright cut along a line, with the heights of its floors
//   storeysOf(bspOrMap, options) the storeys side by side: one plan for each, cut at its own height
//   openingViews(bspOrMap, ...)  a view through each gate and doorway the walk test found
//
// Each gives `{ width, height, rgba, facts }`: a picture as `render` gives one (`png(width, height, rgba)`
// writes it), and what was drawn in numbers and sentences. Axes are the game's: +x east, +y north, +z up.
//
// The light of a compiled map is its own: each face's lightmap, made brighter by one number that stands in
// for what the engine does to it. Textures come from the map itself, from textures handed over, or from the .wad
// files of the game's folders; one that is found nowhere is drawn in a flat colour of its own and named in
// `facts.missing`. A point entity that stands (a place to start, a monster, an NPC) is drawn as the box it
// moves with, at its true size; with `models`, as its model where one is named (figures.mjs), textured.
// With the game's folders a sprite is drawn as its first frame (sprites.mjs) and the sky as its own picture
// (sky.mjs).
import { sub, dot, cross, unit } from "../../core/vec.mjs";
import { label, tile } from "../../make/render.mjs";
import { drawLine } from "../../core/pixels.mjs";
import {
  CONTENTS,
  LUXEL,
  contentsAt,
  contentsName,
  leafAt,
  floorUnder,
  worldBounds,
  facePolygon,
  faceNormal,
  faceLightmap,
  visibleFrom,
  embeddedTexture,
  modelFaces,
  faceTexture,
} from "../../core/maps/bsp.mjs";
import { textureKind, HOLE } from "../../core/maps/miptex.mjs";
import { texturesFor } from "../../core/maps/wad.mjs";
import { valueOf, numberOf, originOf, anglesOf, brushModelOf } from "../../core/maps/entities.mjs";
import { shapeOf } from "../../make/maps/source.mjs";
import { spaceOf, BODIES } from "../../make/maps/space.mjs";
import { reachOf, storeyCuts } from "./reach.mjs";
import { figuresOf } from "../../make/maps/figures.mjs";
import { stylesCounted } from "./light.mjs";
import { withMod } from "../../make/maps/mod.mjs";
import { spritesOf, boardOf } from "../../make/maps/sprites.mjs";
import { skyOf, skyColour } from "../../make/maps/sky.mjs";
import { lampsOf } from "./dressing.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** A view's size and how wide it looks, in degrees across, unless told. */
const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 480;
const VIEW_FOV = 90;
/** A picture's side may be this many pixels at the least and at the most. */
const SIDE_LEAST = 16;
const SIDE_MOST = 4096;
/** What is nearer the eye than this many units is cut off. */
const NEAR = 2;
/** A face whose plane passes this near the eye (units) is seen edge on and not drawn. */
const EDGE_ON = 0.01;
/** A standing player's eyes are this far over its origin (which is 36 over the floor: eyes at 64). */
const EYE_OVER_ORIGIN = 28;
/** The eyes over a floor, for a view from the middle of a room. */
const EYE_OVER_FLOOR = 64;
/** The colours of what has no picture: the sky, a view's ground where nothing is, and a plan's. */
const SKY_COLOUR = [118, 164, 214];
const NOTHING = [14, 14, 18];
/**
 * The colours of a plan. `solid` is what a cut finds filled; `rock` what the plan from above finds no floor
 * in; `water` and `sky` tint what a cut finds of them.
 */
export const PLAN_COLOURS = {
  solid: [112, 74, 58],
  rock: [26, 28, 34],
  water: [52, 96, 168],
  sky: [150, 186, 226],
  wall: [236, 236, 240],
  ink: [235, 235, 235],
};
/** The colours of the marks, by what an entity is. */
export const MARK_COLOURS = {
  start: [70, 230, 90],
  light: [255, 226, 70],
  monster: [255, 80, 70],
  other: [90, 220, 235],
  brush: [255, 150, 40],
  trigger: [225, 90, 230],
};
/** What tells the kinds of entities apart, by classname. */
const KIND_PATTERNS = {
  start: /^(info_player_|ms_player_)/,
  light: /^light/,
  monster: /^(monster_|msmonster_|ms_npc|msnpc_|npc_)/,
};
/** Brush entities that the game never draws, whatever they wear. */
const NEVER_DRAWN = /^(trigger_|func_ladder$|func_monsterclip$|func_buyzone$|func_bomb_target$|msarea_)/;
/** The render modes of an entity in which `renderamt` says how solid it looks (0: not at all). */
const FADING_MODES = [1, 2, 3, 5];
const ADDITIVE_MODE = 5;
const HOLES_MODE = 4;
const FULL_AMOUNT = 255;
/**
 * A model in a lit map takes the light of the floor under it, as the game's does, and is shaded plainly by
 * the way each triangle looks: it keeps `MODEL_AMBIENT` of that light whichever way it looks, and up to
 * `MODEL_DIRECT` more as it turns to the lamp. The floor is looked for this far under it (units).
 */
const MODEL_AMBIENT = 0.6;
const MODEL_DIRECT = 0.4;
const LIGHT_REACH = 2048;
/** A glow is hidden when what the picture shows at its middle is more than this nearer the eye (units). */
const GLOW_CLEAR = 8;
/** The arms of the cross a sprite is marked by on a plan (pixels). */
const SPRITE_ARM = 5;
/** How solid a liquid of the world is drawn: what is under it shows through. */
const LIQUID_ALPHA = 0.62;
/**
 * What a light sample is multiplied by before it multiplies the texture: the game shows a map brighter
 * than the bytes its compiler stored. Measured against the game's own screenshots of one map (Xash in the
 * browser, its defaults): a straight 1.55 came within 10 levels in 255 a channel, with no tint; a curve
 * (a gamma) fitted worse and tinted the picture. 1 is the samples as stored.
 * What the engine does, read since in its source (Xash3D FWGS, ref/gl/gl_rsurf.c R_BuildLightMap and
 * engine/client/gamma.c, 2026-10): a sample is run through a table that, with the engine's defaults (gamma
 * and lightgamma 2.5, brightness 0), is a straight line, and the lightmap is then laid on the texture
 * twice over (gl_overbright 1: the blend is destination x source x 2), cut off at white; the texture
 * itself is lifted by texgamma (its colours to the power 0.8). So the game's own word is texture x sample
 * x 2 (x 1.34 where it draws from vertex buffers: the samples are then scaled by 171 / 256 first), and
 * 1.55 is a fit to pictures of a browser build, between the two. Either way it is a straight
 * multiply of what hlrad stored, bounces and all: a view is as true as the map's lightmaps are, and of a
 * draft (hlrad -fast: no bounces) it shows the draft's light.
 * A VIEW'S BRIGHTNESS IS NOT A ROOM'S. `facts.brightness` is the mean of one picture: walls, ceiling and
 * floor together, as that camera has them. A lamp high in a room makes a bright picture of a room whose
 * floor is dim, and the game lights what stands in a room by its floor. `lightReport` (light.mjs) says
 * the floor's light room by room, and is what to judge a room's light by.
 */
const BRIGHTNESS = 1.55;
/**
 * The light styles a picture adds up, by its `light`: a test of a style. Style 0 is always on; 1 to 31 are
 * the game's own patterns (a torch that flickers), which are on by themselves and drawn at their full; from
 * 32 up are the lights a switch turns on and off, which are on when the map starts unless made to start
 * dark (`stylesAtStart` of light.mjs).
 */
const stylesOf = (bsp, light) =>
  light === "steady"
    ? (style) => style === 0
    : stylesCounted(bsp, light === "all" ? "on" : light === "off" ? "off" : "start");
const AS_IT_STARTS =
  "lightmaps: the light as the map starts (the steady light, the flickering styles, and the switched lights not made to start dark)";
const LIGHT_WORDS = {
  true: AS_IT_STARTS,
  start: AS_IT_STARTS,
  off: "lightmaps: the steady light and the flickering styles (0 to 31), every switched light off",
  steady: "lightmaps: the steady light alone (style 0)",
  all: "lightmaps: every style, the switched lights as if on",
};
/** A plan with more marks than this labels only the places to start, unless told to label all. */
const LABELS_MOST = 60;
/**
 * A view of source draws each face's edges darker, the face's colour times this; an edge is drawn where
 * what the picture shows there is no nearer than this share of the edge's own distance, and is walked in no
 * more steps than the last.
 */
const OUTLINE_SHARE = 0.55;
const OUTLINE_NEARER = 0.985;
const OUTLINE_STEPS_MOST = 8192;
/** Without lightmaps: every face gets `AMBIENT`, and up to `DIRECT` more as it turns to the lamp. */
const AMBIENT = 0.5;
const DIRECT = 0.5;
const LAMP = unit([0.35, 0.5, 0.8]);
/** A smaller size of a texture is used once a pixel covers this many of its texels. */
const TEXELS_A_PIXEL = 1.4;
/** On a plan a floor keeps this much of its colour in no light at all, so that a dark room is still read. */
const PLAN_AMBIENT = 0.4;
/** And every floor of a plan is lifted this far towards white, so that the darkest is lighter than the rock. */
const PLAN_LIFT = 40;
/** A view whose mean brightness is under this (of 255) is said to be dark, with what to do about it. */
const DARK_VIEW = 24;
/** A plan's side unless told, its margin, and the band under it for the scale and the legend (pixels). */
const PLAN_SIDE = 1024;
const PLAN_MARGIN = 24;
const PLAN_FOOT = 46;
/** A face that looks this much upwards is a floor on a plan; one that looks this little, a wall. */
const FLOOR_LEAST = 0.3;
const WALL_MOST = 0.3;
/** A wall's line on a plan is hidden by a floor more than this many units above its top. */
const LINE_COVER = 2;
/** The lengths a plan's scale bar may have (units), and the pixels it may take at most. */
const BAR_LENGTHS = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const BAR_MOST = 180;
/** A mark on a plan: the dot's radius, and the length of the line that shows which way it faces (pixels). */
const DOT_RADIUS = 3;
const FACING_LENGTH = 9;
/** The side of the box a point entity is marked by in a view (units). */
const MARK_SIDE = 16;
/** `viewsOf`: its cells unless told, their size, and how many go in a row. */
const VIEWS_COUNT = 8;
const CELL_WIDTH = 320;
const CELL_HEIGHT = 240;
const VIEWS_COLUMNS = 4;
/** The four ways a room is looked at from its middle (yaw, degrees). */
const FOUR_WAYS = [0, 90, 180, 270];
/**
 * `viewsOf`: places to start that stand within this many units of another are one group, and one view is
 * taken for them all. A map a player arrives in from several others has a place for each arrival, and a map
 * for many players a row of them, a body's width apart: a view from each is the same picture over and over.
 */
const STARTS_TOGETHER = 256;
/**
 * A view is nearly one colour, and shows nothing of the map, when this share of its pixels is within
 * `ONE_COLOUR_NEAR` levels a channel of its commonest colour: the eye a hand's width from a wall, or
 * behind the box of a thing that stands before it. A dark view is not judged by this: it is the map's
 * light, and has its own sentence.
 */
const ONE_COLOUR_SHARE = 0.9;
const ONE_COLOUR_NEAR = 12;
/** The rooms `viewsOf` keeps beside those it shows, to take the place of a view that was left out. */
const ROOMS_SPARE = 4;
/**
 * `compareOf`: the picture all the plans are fitted into unless a scale is told, the band over each plan
 * for its name and its size, and the gap between two plans (pixels).
 */
const COMPARE_WIDE = 1920;
const COMPARE_HIGH = 1080;
const COMPARE_HEAD = 38;
const COMPARE_GAP = 8;
/** A leaf under this height or width is no room to stand in. */
const ROOM_LEAST = 64;
/**
 * What the walk test's findings are tinted on a plan: floor that was walked, floor that was not, floor that
 * only a jump reaches, and the floor of a one-way place.
 */
export const REACH_COLOURS = {
  walked: [60, 220, 110],
  unwalked: [240, 70, 60],
  jumped: [70, 190, 255],
  trapped: [255, 176, 0],
  route: [255, 255, 255],
};
const REACH_SHARE = 0.38;
const REACH_STRONG = 0.6;
/** The colour a floor's height is written in, on a plan and on a section. */
const HEIGHT_INK = [255, 214, 120];
/** A floor of a plan smaller than this many pixels does not get its height written on it. */
const HEIGHT_AREA_LEAST = 500;
/** The list of entities beside a plan: its width, and the height of one of its lines (pixels). */
const LEGEND_WIDE = 300;
const LEGEND_LINE = 8;
/** A side section: its longer side unless told, the room left of it for the heights, and its margins. */
const SECTION_SIDE = 1024;
const SECTION_LEFT = 44;
const SECTION_MARGIN = 16;
/** Entities this near the line of a section are drawn on it, unless told (units). */
const SECTION_NEAR = 64;
/** The steps a section's heights are ticked at (units), and the least pixels between two ticks. */
const TICK_STEPS = [8, 16, 32, 64, 128, 256, 512, 1024];
const TICK_APART = 22;
/** A floor of a section gets its height written when it runs this many pixels at the least. */
const FLOOR_RUN_LEAST = 30;
/** `storeysOf`: one plan's side unless told; `openingViews`: its cells at the most unless told. */
const STOREY_SIDE = 640;
const OPENINGS_MOST = 12;
/** A letter of the kit's labels is this wide and high at size 1 (pixels), with its gap. */
const LETTER_WIDE = 4;
const LETTER_HIGH = 6;

const DEGREES = Math.PI / 180;

// ── small arithmetic ────────────────────────────────────────────────────────
/** `a + b * k`, for points. */
const plus = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** Three numbers from a value of a map: `[x, y, z]`, `"x y z"`, or null. */
function vectorFrom(value) {
  if (Array.isArray(value)) return value.length === 3 ? value.map(Number) : null;
  if (typeof value !== "string") return null;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : null;
}
/** A colour for a name, the same every time: for a texture whose picture is not to be had. */
function colourOfName(name) {
  let hash = 7;
  for (const letter of name.toLowerCase()) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  const hue = (hash % 360) / 60;
  const band = Math.floor(hue);
  const rise = hue - band;
  const low = 112;
  const high = 178;
  const up = Math.round(low + (high - low) * rise);
  const down = Math.round(high - (high - low) * rise);
  return [
    [high, up, low],
    [down, high, low],
    [low, high, up],
    [low, down, high],
    [up, low, high],
    [high, low, down],
  ][band];
}
/** A picture's side as asked for, or a refusal in words. */
function sideOf(value, otherwise, what) {
  const side = value ?? otherwise;
  if (!Number.isInteger(side) || side < SIDE_LEAST || side > SIDE_MOST)
    throw new Error(`${what}: a whole number from ${SIDE_LEAST} to ${SIDE_MOST}, not ${side}`);
  return side;
}
/** A point as a label writes it: whole numbers. */
const pointText = (point) => point.map((value) => Math.round(value)).join(" ");

// ── the picture being drawn ─────────────────────────────────────────────────
/**
 * A picture of one colour, with how near what each pixel shows is (nothing yet: Infinity) and what it shows
 * (`shows`: 0 nothing, 1 a face, 2 the sky), and the texture it shows (`named`: an index into `names`, 0 none;
 * a model's as `models/x.mdl#texture`).
 */
function newCanvas(width, height, colour) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) rgba.set([...colour, 255], pixel * 4);
  return { width, height, rgba, nearness: new Float32Array(width * height).fill(Infinity), shows: new Uint8Array(width * height), named: new Uint16Array(width * height), names: [""], nameAt: new Map() }; // prettier-ignore
}
/** The number a texture's name has in a canvas's `names`. */
function nameIndex(canvas, name = "") {
  let index = canvas.nameAt.get(name);
  if (index === undefined) {
    index = canvas.names.length;
    canvas.names.push(name);
    canvas.nameAt.set(name, index);
  }
  return index;
}
/** The picture as the kit hands pictures on. */
const pictureOf = (canvas) => ({
  width: canvas.width,
  height: canvas.height,
  rgba: new Uint8Array(canvas.rgba.buffer),
});
/** The share of a picture's pixels that show something, to a thousandth. */
function shareDrawn(canvas) {
  let drawn = 0;
  for (const near of canvas.nearness) if (near !== Infinity) drawn++;
  return Math.round((drawn / canvas.nearness.length) * 1000) / 1000;
}
/** The mean brightness of a picture, 0 to 255. */
function meanBrightness(canvas) {
  let sum = 0;
  for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++)
    sum +=
      0.3 * canvas.rgba[pixel * 4] + 0.59 * canvas.rgba[pixel * 4 + 1] + 0.11 * canvas.rgba[pixel * 4 + 2];
  return sum / (canvas.width * canvas.height);
}
/**
 * The table that turns a light sample (a byte) into what the texture is multiplied by: the sample as a share
 * of 255, times `brightness`. Over 1 it brightens the texture, as far as white.
 */
function lightTable(brightness) {
  const table = new Float32Array(256);
  for (let sample = 0; sample < 256; sample++) table[sample] = (sample / 255) * brightness;
  return table;
}

// ── textures made ready ─────────────────────────────────────────────────────
/** The mean colour of a texture's smallest size, its holes left out. */
function meanColour(pixels, palette, holes) {
  const sum = [0, 0, 0];
  let counted = 0;
  for (const index of pixels) {
    if (holes && index === HOLE) continue;
    for (let channel = 0; channel < 3; channel++) sum[channel] += palette[index * 3 + channel];
    counted++;
  }
  return sum.map((value) => (counted ? Math.round(value / counted) : 0));
}
/**
 * A smaller size of a texture with holes, from its largest: each pixel a hole where half its block is, else
 * the block's first pixel that is not one.
 */
export function shrunkWithHoles(pixels, width, height, level) {
  const size = 1 << level;
  const [w, h] = [width >> level, height >> level];
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let holes = 0;
      let kept = HOLE;
      for (let dy = 0; dy < size; dy++)
        for (let dx = 0; dx < size; dx++) {
          const index = pixels[(y * size + dy) * width + x * size + dx];
          if (index === HOLE) holes++;
          else if (kept === HOLE) kept = index;
        }
      out[y * w + x] = holes * 2 >= size * size ? HOLE : kept;
    }
  return out;
}
/** A map texture (miptex.mjs) as the drawing reads it: its sizes, its palette, its mean colour. */
function readyTexture(texture) {
  const holes = texture.holes ?? textureKind(texture.name).holes;
  let sizes = texture.mips ?? [texture.pixels];
  // some of the game's textures with holes have smaller sizes made without them (MSC's {ms_tree04 to 08): the
  // engine makes its own from the largest, and so does the drawing, or a far tree is a box
  if (holes && sizes.length > 1 && sizes[0].includes(HOLE) && sizes.slice(1).some((pixels) => !pixels.includes(HOLE)))
    sizes = sizes.map((pixels, level) => (level ? shrunkWithHoles(sizes[0], texture.width, texture.height, level) : pixels));
  const levels = sizes.map((pixels, level) => ({
    width: texture.width >> level,
    height: texture.height >> level,
    pixels,
  }));
  return {
    name: texture.name,
    levels,
    palette: texture.palette,
    holes,
    flat: null,
    mean: meanColour(levels.at(-1).pixels, texture.palette, holes),
  };
}
/** A stand-in for a texture with no picture: one colour. */
const flatTexture = (name, colour) => ({
  name,
  levels: null,
  palette: null,
  holes: false,
  flat: colour,
  mean: colour,
});

// ── a face made ready, and filled ───────────────────────────────────────────
/**
 * What a face is drawn as, whatever it came from: `{ polygon, normal, dist, sAxis, tAxis, texture, light,
 * shade, kind }`. `normal` and `dist` are its plane as seen from its front; the axes give a point's place on
 * the texture (`axis . p + axis[3]`); `light` is `{ width, height, originS, originT, rgb }` or null, and
 * `shade` what the texture is multiplied by when there is none. `kind`: "face", "sky" or "liquid".
 */
const NO_AXIS = [0, 0, 0, 0];
/** The stand-in shade of a face from the way it looks. */
const shadeOf = (normal) => AMBIENT + DIRECT * Math.max(0, dot(normal, LAMP));

/**
 * The camera of a view: where it stands, its three axes in the world, and the pixels a unit takes at one
 * unit from the eye. `yaw` turns anticlockwise from +x, seen from above; `pitch` over 0 looks up.
 */
export function cameraOf({ from, to, yaw = 0, pitch = 0, fov = VIEW_FOV }, width, height) {
  if (!vectorFrom(from)) throw new Error(`from: where the eye is, [x, y, z], not ${JSON.stringify(from)}`);
  if (!(fov > 1 && fov < 179)) throw new Error(`fov: degrees across, between 1 and 179, not ${fov}`);
  let forward = [
    Math.cos(pitch * DEGREES) * Math.cos(yaw * DEGREES),
    Math.cos(pitch * DEGREES) * Math.sin(yaw * DEGREES),
    Math.sin(pitch * DEGREES),
  ];
  if (to) {
    if (!vectorFrom(to)) throw new Error(`to: the point looked at, [x, y, z], not ${JSON.stringify(to)}`);
    const way = sub(to, from);
    if (!Math.hypot(...way)) throw new Error("to: the point looked at is the eye itself");
    forward = unit(way);
  }
  const level = Math.hypot(forward[0], forward[1]);
  // looking straight up or down, "right" is taken from the yaw
  const right =
    level > 1e-6 ? unit(cross(forward, [0, 0, 1])) : [Math.sin(yaw * DEGREES), -Math.cos(yaw * DEGREES), 0];
  const up = cross(right, forward);
  return {
    perspective: true,
    eye: [...from],
    right,
    up,
    forward,
    focal: width / 2 / Math.tan((fov * DEGREES) / 2),
    centreX: width / 2,
    centreY: height / 2,
    least: 0,
    yaw: Math.round(Math.atan2(forward[1], forward[0]) / DEGREES),
    pitch: Math.round(Math.asin(forward[2]) / DEGREES),
    fov,
  };
}

/** A polygon in the camera's space with what is nearer than `NEAR` cut off. */
function cutNear(polygon) {
  const kept = [];
  polygon.forEach((here, index) => {
    const next = polygon[(index + 1) % polygon.length];
    if (here[2] >= NEAR) kept.push(here);
    if (here[2] >= NEAR !== next[2] >= NEAR) {
      const share = (NEAR - here[2]) / (next[2] - here[2]);
      kept.push(here.map((value, axis) => value + (next[axis] - value) * share));
    }
  });
  return kept;
}

/**
 * Where a surface falls on the picture and how a pixel finds its place on it: `{ corners, depth: [a, b, c],
 * s: [a, b, c, d], t: [a, b, c, d] }`, or null when it is not seen (behind the eye, seen from behind, edge
 * on). For a pixel at (x, y): with perspective, `reach = 1 / (a x + b y + c)` of `depth` is how far it is,
 * and its place on the texture `reach * (a x + b y + c) + d`; on a plan `depth` gives minus its height and
 * the place on the texture is `a x + b y + c`. `shift` is where the surface's entity stands.
 */
function placed(view, surface, shift, twoSided) {
  const { normal, dist, sAxis, tAxis } = surface;
  if (!view.perspective) {
    if (normal[2] < FLOOR_LEAST) return null;
    const left = view.x0 - shift[0];
    const top = view.y0 - shift[1];
    const corners = surface.polygon.map((point) => [
      (point[0] - left) * view.scale,
      (top - point[1]) * view.scale,
    ]);
    // the height of the plane under a pixel: an affine sum of its column and its row
    const heightX = -normal[0] / (normal[2] * view.scale);
    const heightY = normal[1] / (normal[2] * view.scale);
    const heightAt0 = (dist - normal[0] * left - normal[1] * top) / normal[2];
    const along = (axis) => [
      axis[0] / view.scale + axis[2] * heightX,
      -axis[1] / view.scale + axis[2] * heightY,
      axis[0] * left + axis[1] * top + axis[2] * heightAt0 + axis[3],
      0,
    ];
    return {
      corners,
      depth: [-heightX, -heightY, -(heightAt0 + shift[2])],
      s: along(sAxis),
      t: along(tAxis),
    };
  }
  const eye = sub(view.eye, shift);
  const behind = dist - dot(normal, eye);
  if (twoSided ? Math.abs(behind) < EDGE_ON : behind > -EDGE_ON) return null;
  const inCamera = surface.polygon.map((point) => {
    const offset = sub(point, eye);
    return [dot(offset, view.right), dot(offset, view.up), dot(offset, view.forward)];
  });
  const cut = cutNear(inCamera);
  if (cut.length < 3) return null;
  const corners = cut.map(([x, y, z]) => [
    view.centreX + (x * view.focal) / z,
    view.centreY - (y * view.focal) / z,
  ]);
  // a pixel's ray is forward + right * (x - centreX) / focal - up * (y - centreY) / focal
  const overRay = (vector) => {
    const across = dot(vector, view.right) / view.focal;
    const down = -dot(vector, view.up) / view.focal;
    return [across, down, dot(vector, view.forward) - across * view.centreX - down * view.centreY];
  };
  const along = (axis) => [...overRay(axis), dot(axis, eye) + axis[3]];
  return {
    corners,
    depth: overRay(normal).map((value) => value / behind),
    s: along(sAxis),
    t: along(tAxis),
  };
}

/**
 * Fills one surface into the picture. `paint`: `{ alpha (1), additive, stipple (every other pixel left
 * open), twoSided, mean (the texture's mean colour in place of its picture), ambient (the share of its
 * colour a surface keeps in no light), outline (its edges drawn darker: the share of the colour kept), lit
 * (a light of its own, `[r, g, b]`, for a surface with no lightmap), tint (a colour laid over it, each of
 * the three from 0 to 1), overAll (drawn over what is nearer too: a glow), holes (false: a texture's holes
 * are filled with its last colour) }`. A pixel is drawn where the
 * surface is nearer than what is there; one that is not opaque hides nothing after it. A texture with
 * `sky` (the six sides of a sky) is asked by the way each pixel looks.
 */
function fill(canvas, view, surface, shift, paint, table) {
  const place = placed(view, surface, shift, paint.twoSided);
  if (!place) return 0;
  const named = canvas.named ? nameIndex(canvas, paint.name ?? surface.texture?.name) : 0;
  const { corners } = place;
  const [depthA, depthB, depthC] = place.depth;
  const [sA, sB, sC, sD] = place.s;
  const [tA, tB, tC, tD] = place.t;
  const { width, height, rgba, nearness } = canvas;
  const { perspective, least } = view;
  const texture = surface.texture;
  const flat = paint.mean || !texture.levels ? texture.mean : null;
  const holes = !flat && texture.holes && paint.holes !== false;
  const cover = flat ? null : (texture.cover ?? null);
  const palette = texture.palette;
  const light = surface.light;
  const ambient = paint.ambient ?? 0;
  const lightShare = 1 - ambient;
  const shade = ambient + lightShare * (surface.shade ?? 1);
  // the three colours' own shades: the surface's one, a light of its own (`lit`), a colour laid over it
  const tint = paint.tint ?? null;
  const [shadeRed, shadeGreen, shadeBlue] = (paint.lit ?? [shade, shade, shade]).map(
    (value, channel) => value * (tint?.[channel] ?? 1),
  );
  const lift = paint.lift ?? 0;
  const kept = 1 - lift / 255;
  const alpha = paint.alpha ?? 1;
  const opaque = alpha >= 1 && !paint.additive && !cover;
  const overAll = Boolean(paint.overAll);
  // the sky's picture is asked by the way each pixel looks, not by a place on the face
  const sky = perspective && !paint.mean ? (texture.sky ?? null) : null;
  const skyOut = [0, 0, 0];
  // how far a pixel has to be for each smaller size of the texture
  const texelsAUnit = Math.hypot(surface.sAxis[0], surface.sAxis[1], surface.sAxis[2]) || 1;
  const firstSmaller = perspective ? (TEXELS_A_PIXEL * view.focal) / texelsAUnit : Infinity;
  const mostLevel = flat ? 0 : texture.levels.length - 1;

  let top = Infinity;
  let bottom = -Infinity;
  for (const corner of corners) {
    top = Math.min(top, corner[1]);
    bottom = Math.max(bottom, corner[1]);
  }
  const firstRow = Math.max(0, Math.ceil(top - 0.5));
  const lastRow = Math.min(height - 1, Math.floor(bottom - 0.5));
  let drawn = 0;
  for (let row = firstRow; row <= lastRow; row++) {
    const y = row + 0.5;
    // the stretch of the row inside the polygon, which is convex: between its two crossings
    let left = Infinity;
    let right = -Infinity;
    for (let index = 0; index < corners.length; index++) {
      const here = corners[index];
      const next = corners[(index + 1) % corners.length];
      if (here[1] <= y === next[1] <= y) continue;
      const x = here[0] + ((y - here[1]) * (next[0] - here[0])) / (next[1] - here[1]);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    const firstColumn = Math.max(0, Math.ceil(left - 0.5));
    const lastColumn = Math.min(width - 1, Math.floor(right - 0.5));
    for (let column = firstColumn; column <= lastColumn; column++) {
      const x = column + 0.5;
      const at = row * width + column;
      let reach = 1;
      let near = depthA * x + depthB * y + depthC;
      if (perspective) {
        if (near <= 0) continue;
        reach = 1 / near;
        near = reach;
      }
      if (near < least || (near >= nearness[at] && !overAll)) continue;
      if (paint.stipple && (row + column) & 1) continue;
      if (sky) {
        const across = (x - view.centreX) / view.focal;
        const down = (y - view.centreY) / view.focal;
        skyColour(
          sky,
          view.forward[0] + view.right[0] * across - view.up[0] * down,
          view.forward[1] + view.right[1] * across - view.up[1] * down,
          view.forward[2] + view.right[2] * across - view.up[2] * down,
          skyOut,
        );
        rgba[at * 4] = skyOut[0];
        rgba[at * 4 + 1] = skyOut[1];
        rgba[at * 4 + 2] = skyOut[2];
        nearness[at] = near;
        canvas.shows[at] = 2;
        drawn++;
        continue;
      }
      const s = reach * (sA * x + sB * y + sC) + sD;
      const t = reach * (tA * x + tB * y + tC) + tD;

      let red;
      let green;
      let blue;
      let solid = alpha;
      if (flat) {
        red = flat[0];
        green = flat[1];
        blue = flat[2];
      } else {
        let level = 0;
        if (reach >= firstSmaller)
          level = reach >= firstSmaller * 2 ? (reach >= firstSmaller * 4 ? 3 : 2) : 1;
        if (level > mostLevel) level = mostLevel;
        const size = texture.levels[level];
        let texelX = (Math.floor(s) >> level) % size.width;
        let texelY = (Math.floor(t) >> level) % size.height;
        if (texelX < 0) texelX += size.width;
        if (texelY < 0) texelY += size.height;
        const index = size.pixels[texelY * size.width + texelX];
        if (holes && index === HOLE) continue;
        if (cover) solid = alpha * cover[index];
        red = palette[index * 3];
        green = palette[index * 3 + 1];
        blue = palette[index * 3 + 2];
      }

      if (light) {
        // the four samples about the point, mixed by how near each is
        const across = Math.min(Math.max((s - light.originS) / LUXEL, 0), light.width - 1);
        const down = Math.min(Math.max((t - light.originT) / LUXEL, 0), light.height - 1);
        const column0 = Math.min(Math.floor(across), Math.max(0, light.width - 2));
        const row0 = Math.min(Math.floor(down), Math.max(0, light.height - 2));
        const column1 = Math.min(column0 + 1, light.width - 1);
        const row1 = Math.min(row0 + 1, light.height - 1);
        const shareX = across - column0;
        const shareY = down - row0;
        const a = (row0 * light.width + column0) * 3;
        const b = (row0 * light.width + column1) * 3;
        const c = (row1 * light.width + column0) * 3;
        const d = (row1 * light.width + column1) * 3;
        const samples = light.rgb;
        const mixed = (channel) => {
          const upper = samples[a + channel] + (samples[b + channel] - samples[a + channel]) * shareX;
          const lower = samples[c + channel] + (samples[d + channel] - samples[c + channel]) * shareX;
          return table[Math.min(255, Math.round(upper + (lower - upper) * shareY))];
        };
        red *= ambient + lightShare * mixed(0);
        green *= ambient + lightShare * mixed(1);
        blue *= ambient + lightShare * mixed(2);
      } else {
        red *= shadeRed;
        green *= shadeGreen;
        blue *= shadeBlue;
      }

      if (lift) {
        red = lift + Math.min(255, red) * kept;
        green = lift + Math.min(255, green) * kept;
        blue = lift + Math.min(255, blue) * kept;
      }
      const o = at * 4;
      if (opaque) {
        rgba[o] = red;
        rgba[o + 1] = green;
        rgba[o + 2] = blue;
        nearness[at] = near;
        canvas.shows[at] = surface.kind === "sky" ? 2 : 1;
        if (canvas.named) canvas.named[at] = named;
      } else if (paint.additive) {
        rgba[o] += red * solid;
        rgba[o + 1] += green * solid;
        rgba[o + 2] += blue * solid;
      } else {
        rgba[o] += (red - rgba[o]) * solid;
        rgba[o + 1] += (green - rgba[o + 1]) * solid;
        rgba[o + 2] += (blue - rgba[o + 2]) * solid;
      }
      drawn++;
    }
  }
  if (drawn && paint.outline) outline(canvas, view, place, paint.outline);
  return drawn;
}

/**
 * The edges of a surface that was just filled, drawn darker where the surface itself is what the picture
 * shows: faces of one flat colour are told apart by their edges. `share`: how much of the colour is kept.
 */
function outline(canvas, view, place, share) {
  const { width, height, rgba, nearness } = canvas;
  const [depthA, depthB, depthC] = place.depth;
  place.corners.forEach((from, index) => {
    const to = place.corners[(index + 1) % place.corners.length];
    const steps = Math.min(
      OUTLINE_STEPS_MOST,
      Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))),
    );
    for (let step = 0; step <= steps; step++) {
      const x = from[0] + ((to[0] - from[0]) * step) / Math.max(1, steps);
      const y = from[1] + ((to[1] - from[1]) * step) / Math.max(1, steps);
      const column = Math.floor(x);
      const row = Math.floor(y);
      if (column < 0 || row < 0 || column >= width || row >= height) continue;
      const depth = depthA * x + depthB * y + depthC;
      const near = view.perspective ? 1 / depth : depth;
      const at = row * width + column;
      // drawn where nothing nearer than this edge was drawn (a little is forgiven: the edge is the face's own)
      if (!(near > 0) || nearness[at] < near * OUTLINE_NEARER) continue;
      for (let channel = 0; channel < 3; channel++) rgba[at * 4 + channel] *= share;
    }
  });
}

/** The six faces of a box of one colour, as surfaces: a mark in a view. */
function boxSurfaces(min, max, colour) {
  const texture = flatTexture("mark", colour);
  const corner = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
  const sides = [
    {
      normal: [1, 0, 0],
      dist: max[0],
      of: [corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1)],
    },
    {
      normal: [-1, 0, 0],
      dist: -min[0],
      of: [corner(0, 0, 0), corner(0, 1, 0), corner(0, 1, 1), corner(0, 0, 1)],
    },
    {
      normal: [0, 1, 0],
      dist: max[1],
      of: [corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1)],
    },
    {
      normal: [0, -1, 0],
      dist: -min[1],
      of: [corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)],
    },
    {
      normal: [0, 0, 1],
      dist: max[2],
      of: [corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)],
    },
    {
      normal: [0, 0, -1],
      dist: -min[2],
      of: [corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0)],
    },
  ];
  return sides.map((side) => ({
    polygon: side.of,
    normal: side.normal,
    dist: side.dist,
    sAxis: NO_AXIS,
    tAxis: NO_AXIS,
    texture,
    light: null,
    shade: shadeOf(side.normal),
    kind: "face",
  }));
}

// ── what is in a map, in one form for compiled maps and for source ──────────
/** What an entity is, for its mark's colour: "start", "light", "monster", "trigger", "brush" or "other". */
function kindOf(classname, isBrush) {
  if (isBrush) return NEVER_DRAWN.test(classname) ? "trigger" : "brush";
  for (const [kind, pattern] of Object.entries(KIND_PATTERNS)) if (pattern.test(classname)) return kind;
  return "other";
}
/** Whether an entity names a model or a sprite of the game's, or is a monster: marked in a view by a box. */
const hasBody = (thing) => thing.kind === "monster" || /\.(mdl|spr)$/i.test(thing.modelFile ?? "");

/**
 * How a brush entity is drawn, from its keys: `{ hidden, alpha, additive, holes }`. Hidden: a class the game
 * never draws, one faded to nothing, or one the compiler was told to leave unseen (`zhlt_invisible`).
 * `holes`: its `{` textures have their holes, which the game gives them in one render mode only (4,
 * "Solid"); in any other, and on the world itself, it draws the holes filled with the texture's last colour.
 */
function lookOf(classname, rendermode, renderamt, invisible) {
  const holes = rendermode === HOLES_MODE;
  if (invisible || NEVER_DRAWN.test(classname)) return { hidden: true, alpha: 0, additive: false, holes };
  if (!FADING_MODES.includes(rendermode)) return { hidden: false, alpha: 1, additive: false, holes };
  const alpha = Math.min(1, Math.max(0, renderamt / FULL_AMOUNT));
  return { hidden: alpha <= 0, alpha, additive: rendermode === ADDITIVE_MODE, holes };
}

/**
 * The keys by which an entity's model or sprite is shown, as they stand in the map: `{ body, skin, sequence,
 * frame, scale }`, each undefined when the entity does not give it. `key` reads one of the entity's keys.
 */
const poseOf = (key) => ({
  body: key("body"),
  skin: key("skin"),
  sequence: key("sequence"),
  frame: key("frame"),
  scale: key("scale"),
});
/** An entity's render keys as numbers: `{ mode, amount, colour: [r, g, b], fx }`. */
const renderOf = (key) => ({
  mode: Number(key("rendermode") ?? 0) || 0,
  amount: Number(key("renderamt") ?? 0) || 0,
  colour: vectorFrom(String(key("rendercolor") ?? "")) ?? [0, 0, 0],
  fx: Number(key("renderfx") ?? 0) || 0,
});

/** The entities of a compiled map as the drawing reads them. */
function thingsOfBsp(bsp) {
  return bsp.entities.map((entity, number) => {
    const classname = valueOf(entity, "classname") ?? "";
    const model = number === 0 ? 0 : brushModelOf(entity);
    const angles = anglesOf(entity);
    return {
      number,
      classname,
      origin: originOf(entity),
      yaw: angles[1],
      pitch: -angles[0],
      turned: valueOf(entity, "angles") !== undefined || valueOf(entity, "angle") !== undefined,
      model,
      modelFile: model === null ? valueOf(entity, "model") : undefined,
      targetname: valueOf(entity, "targetname"),
      script: valueOf(entity, "scriptfile"),
      angles,
      pose: poseOf((key) => valueOf(entity, key)),
      render: renderOf((key) => valueOf(entity, key)),
      flags: numberOf(entity, "spawnflags", 0),
      kind: kindOf(classname, model !== null),
      look: lookOf(
        classname,
        numberOf(entity, "rendermode", 0),
        numberOf(entity, "renderamt", 0),
        valueOf(entity, "zhlt_invisible") === "1",
      ),
    };
  });
}

/** The entities of brush source as the drawing reads them: the world is 0, the others follow from 1. */
function thingsOfSource(map) {
  return (map.entities ?? []).map((entity, index) => {
    const classname = String(entity.classname ?? "");
    const isBrush = Boolean(entity.brushes?.length);
    const angles = vectorFrom(entity.angles) ?? [0, Number(entity.angle ?? 0) || 0, 0];
    return {
      number: index + 1,
      classname,
      origin: vectorFrom(entity.origin),
      yaw: angles[1],
      pitch: -angles[0],
      turned: entity.angles !== undefined || entity.angle !== undefined,
      model: isBrush ? index + 1 : null,
      modelFile: isBrush ? undefined : entity.model,
      targetname: entity.targetname,
      script: entity.scriptfile,
      angles,
      pose: poseOf((key) => entity[key]),
      render: renderOf((key) => entity[key]),
      flags: Number(entity.spawnflags ?? 0) || 0,
      brushes: entity.brushes ?? [],
      kind: kindOf(classname, isBrush),
      look: lookOf(
        classname,
        Number(entity.rendermode ?? 0),
        Number(entity.renderamt ?? 0),
        String(entity.zhlt_invisible ?? "") === "1",
      ),
    };
  });
}

/**
 * The entities of a map as the drawing reads them, a compiled map's or brush source's: `[{ number,
 * classname, targetname, origin, yaw, pitch, angles, model, modelFile, script, pose, render, flags, kind,
 * look }]` (in source, `brushes` too). For a picture or a scene of one's own (scene3d.mjs).
 */
export const thingsOf = (map) => (isCompiled(map) ? thingsOfBsp(map) : thingsOfSource(map));

/** Whether this is a compiled map (what `readBsp` gives) and not brush source. */
const isCompiled = (map) => Array.isArray(map?.faces) && Array.isArray(map?.leaves);

/**
 * Where an entity stands and the way it looks, for a view from it: `{ from, yaw, pitch, name, number }`.
 * `which`: its number, or a classname (the first of that class). A place to start is looked from at the
 * height of a player's eyes; anything else from its origin. `map`: a compiled map or brush source.
 */
export function viewFrom(map, which) {
  const things = isCompiled(map) ? thingsOfBsp(map) : thingsOfSource(map);
  const byNumber = typeof which === "number" || /^\d+$/.test(String(which));
  const thing = byNumber
    ? things.find((each) => each.number === Number(which))
    : things.find((each) => each.classname === which);
  if (!thing)
    throw new Error(
      byNumber
        ? `no entity ${which}: they are numbered from 0 to ${things.at(-1)?.number ?? 0}`
        : `no entity of the class ${which}`,
    );
  if (!thing.origin || thing.model !== null)
    throw new Error(
      `entity ${thing.number} (${thing.classname}) has no place of its own to look from: give a point`,
    );
  const from = thing.kind === "start" ? plus(thing.origin, [0, 0, 1], EYE_OVER_ORIGIN) : [...thing.origin];
  return {
    from,
    yaw: thing.yaw,
    pitch: thing.kind === "start" ? 0 : thing.pitch,
    name: `${thing.number} ${thing.classname}`,
    number: thing.number,
  };
}

// ── a compiled map made ready ───────────────────────────────────────────────
const scenes = new WeakMap();

const textureIds = new WeakMap();
let textureCount = 0;
/** A texture object's own number, the same for the same object every time it is asked. */
function textureIdentity(texture) {
  if (!texture || typeof texture !== "object") return String(texture);
  if (!textureIds.has(texture)) textureIds.set(texture, ++textureCount);
  return `${texture.name}#${textureIds.get(texture)}`;
}

/**
 * A compiled map with what the drawing needs worked out once: its textures (found where they can be), its
 * entities, and its faces as surfaces, each made the first time it is drawn. Kept for the map and these
 * options, so that the second picture of a map does not look for its textures again.
 */
function sceneOf(bsp, { textures, folders, light = true, sky = true, wearing }) {
  // textures are told apart by the very objects given, not their names: two sets under the same names (a
  // game's and their replacements) are two scenes
  const key = JSON.stringify([folders ?? [], (textures ?? []).map(textureIdentity), light, sky]);
  const kept = scenes.get(bsp);
  if (kept?.key === key) return kept;
  // the sky: a colour that was asked for, or the picture the map names where the folders have it
  const skyNotes = [];
  const skyName = valueOf(bsp.entities[0] ?? [], "skyname");
  const skyColourAsked = Array.isArray(sky) ? sky : SKY_COLOUR;
  let skyPicture = null;
  if (sky === true && skyName && folders?.length) {
    const found = skyOf(skyName, folders);
    if (found.sides) skyPicture = found;
    else
      skyNotes.push(
        `the sky's picture (skyname ${skyName}) is not drawn: ${found.why}; the sky is a flat colour`,
      );
  }
  const given = new Map((textures ?? []).map((texture) => [texture.name.toLowerCase(), texture]));
  let fromWads = null;
  const ready = new Map();
  const missing = new Set();
  /** The texture of the map's directory at `index`, found or stood in for. */
  const textureAt = (index) => {
    if (ready.has(index)) return ready.get(index);
    const entry = bsp.textures[index];
    const name = entry?.name ?? "";
    // given textures stand before the map's own where `wearing` is "given" (a texture lifted off a view is told
    // texel by texel by drawing the place in pictures of the kit's own, even in a map that carries its textures)
    let found = wearing === "given" ? given.get(name.toLowerCase()) ?? null : null;
    found ??= entry && !entry.absent && entry.embedded ? embeddedTexture(bsp, index) : null;
    found ??= given.get(name.toLowerCase());
    if (!found && folders?.length) {
      fromWads ??= new Map(
        texturesFor(bsp, folders, { pixels: true }).textures.map((each) => [
          each.name.toLowerCase(),
          each.texture,
        ]),
      );
      found = fromWads.get(name.toLowerCase());
    }
    const made = found ? readyTexture(found) : flatTexture(name, colourOfName(name));
    if (!found && !textureKind(name).sky && !textureKind(name).tool) missing.add(name);
    ready.set(index, made);
    return made;
  };
  const lit = light !== false && bsp.lumps.lighting.length > 0;
  const counted = lit ? stylesOf(bsp, light) : null;
  const skyTexture = { ...flatTexture("sky", skyColourAsked), sky: skyPicture };
  const surfaces = new Array(bsp.faces.length);
  /** The face `index` as a surface; null for one that is never drawn (a tool's texture). */
  const surfaceAt = (index) => {
    if (surfaces[index] !== undefined) return surfaces[index];
    const face = bsp.faces[index];
    const texinfo = bsp.texinfo[face.texinfo];
    const name = bsp.textures[texinfo.texture]?.name ?? "";
    const kind = textureKind(name);
    let surface = null;
    if (!kind.tool) {
      const normal = faceNormal(bsp, face);
      const plane = bsp.planes[face.plane];
      const special = kind.sky || kind.water;
      surface = {
        polygon: facePolygon(bsp, face),
        normal,
        dist: face.side ? -plane.dist : plane.dist,
        sAxis: texinfo.s,
        tAxis: texinfo.t,
        texture: kind.sky ? skyTexture : textureAt(texinfo.texture),
        light: null,
        // a face the compiler left without light is black where the map has light, as in the game
        shade: special || light === false ? 1 : lit ? 0 : shadeOf(normal),
        kind: kind.sky ? "sky" : kind.water ? "liquid" : "face",
      };
      if (lit && !special) surface.light = lightOf(bsp, face, counted);
      if (surface.light) surface.shade = 1;
    }
    surfaces[index] = surface;
    return surface;
  };
  const lights = new Map();
  /** The light that falls on a thing standing at a point: `[r, g, b]` samples, or null (`lightUnder`). */
  const lightAt = (point) => {
    const at = point.join(" ");
    if (!lights.has(at)) lights.set(at, lit ? lightUnder(bsp, point, counted) : null);
    return lights.get(at);
  };
  const scene = {
    key,
    bsp,
    things: thingsOfBsp(bsp),
    surfaceAt,
    missing,
    lit,
    light,
    lightAt,
    sky: skyPicture,
    skyNotes,
    figured: new Map(),
  };
  scenes.set(bsp, scene);
  return scene;
}

/**
 * The light of the floor under a point, as the engine finds it for a model that stands there: the world's
 * tree is walked along the upright line down from the point, and at the first face the line passes through
 * that has light, the sample there is taken. `[r, g, b]`, the samples as stored (the styles `counted`
 * added up); null when the line meets no lit face within `LIGHT_REACH`. The floors of brush entities are
 * not asked.
 */
function lightUnder(bsp, point, counted) {
  const [x, y] = point;
  const walk = (at, top, bottom) => {
    if (at < 0) return null;
    const node = bsp.nodes[at];
    const plane = bsp.planes[node.plane];
    const flat = plane.normal[0] * x + plane.normal[1] * y - plane.dist;
    const over = flat + plane.normal[2] * top;
    const under = flat + plane.normal[2] * bottom;
    if (over >= 0 === under >= 0) return walk(node.children[over >= 0 ? 0 : 1], top, bottom);
    const cut = top + ((bottom - top) * over) / (over - under);
    const before = walk(node.children[over >= 0 ? 0 : 1], top, cut);
    if (before) return before;
    for (let nth = 0; nth < node.faceCount; nth++) {
      const face = bsp.faces[node.firstFace + nth];
      const light = face ? lightOf(bsp, face, counted) : null;
      if (!light) continue;
      const { s, t } = bsp.texinfo[face.texinfo];
      const across = Math.round((s[0] * x + s[1] * y + s[2] * cut + s[3] - light.originS) / LUXEL);
      const down = Math.round((t[0] * x + t[1] * y + t[2] * cut + t[3] - light.originT) / LUXEL);
      if (across < 0 || down < 0 || across >= light.width || down >= light.height) continue;
      const sample = (down * light.width + across) * 3;
      return [light.rgb[sample], light.rgb[sample + 1], light.rgb[sample + 2]];
    }
    return walk(node.children[over >= 0 ? 1 : 0], cut, bottom);
  };
  return walk(bsp.models[0].headNodes[0], point[2], point[2] - LIGHT_REACH);
}

/**
 * A face's light as the drawing reads it: the styles `counted` added up (one alone is the map's own
 * bytes, not a copy); null for a face with none of them.
 */
function lightOf(bsp, face, counted) {
  const lightmap = faceLightmap(bsp, face);
  if (!lightmap) return null;
  const wanted = lightmap.styles.filter((each) => counted(each.style));
  if (!wanted.length) return null;
  let rgb = wanted[0].rgb;
  if (wanted.length > 1) {
    rgb = new Uint8ClampedArray(rgb.length);
    for (const each of wanted) for (let at = 0; at < rgb.length; at++) rgb[at] += each.rgb[at];
  }
  return {
    width: lightmap.width,
    height: lightmap.height,
    originS: lightmap.originS,
    originT: lightmap.originT,
    rgb,
  };
}

/** The numbers of the world's faces that can be seen from a leaf: all of them when the map does not say. */
function facesSeenFrom(bsp, leaf) {
  const world = bsp.models[0];
  const seen = leaf > 0 ? visibleFrom(bsp, leaf) : null;
  if (!seen)
    return {
      faces: Array.from({ length: world.faceCount }, (_, nth) => world.firstFace + nth),
      byVisibility: false,
    };
  const marked = new Uint8Array(bsp.faces.length);
  const faces = [];
  for (const other of seen) {
    const { firstMarkSurface, markSurfaceCount } = bsp.leaves[other];
    for (let nth = 0; nth < markSurfaceCount; nth++) {
      const face = bsp.marksurfaces[firstMarkSurface + nth];
      if (marked[face]) continue;
      marked[face] = 1;
      faces.push(face);
    }
  }
  return { faces, byVisibility: true };
}

/** The numbers of the faces of one of the map's models. */
const facesOfModel = (bsp, model) =>
  Array.from({ length: bsp.models[model].faceCount }, (_, nth) => bsp.models[model].firstFace + nth);

/** The first place to start of a map's entities, or undefined. */
const firstStart = (things) => things.find((thing) => thing.kind === "start" && thing.origin);

// ── marks in a view ─────────────────────────────────────────────────────────
/**
 * The point entities a view marks: those with a body (`"models"`), every one (`"all"`), only those drawn
 * as the game shows them, by their model or their sprite (`"game"`: no box stands in for anything), or none.
 * `unmarked`: the numbers of entities that are left out whatever they are.
 */
function markedThings(things, entities, figures, sprites, unmarked) {
  if (entities === false || entities === "none") return [];
  const points = things.filter(
    (thing) => thing.model === null && thing.origin && !unmarked?.includes(thing.number),
  );
  if (entities === "game")
    return points.filter((thing) => figures.get(thing.number)?.surfaces || sprites?.has(thing.number));
  return entities === "all" ? points : points.filter((thing) => hasBody(thing) || figures.has(thing.number));
}

/** A box in space as words: "32 x 32 x 72". */
const sizeText = (min, max) => max.map((value, axis) => Math.round(value - min[axis])).join(" x ");

/** Where nothing is shifted: a point entity's model and a sprite are already where they stand. */
const NO_SHIFT = [0, 0, 0];

/**
 * Draws a point entity's model: each triangle with its texture, seen from its front as the game draws it.
 * A masked texture's holes are left open; an additive one, and a model its entity fades (`rendermode`,
 * `renderamt`), is kept in `later` for after everything opaque. `sample`: the light of the floor under it
 * (`[r, g, b]`, as the map stores it), or null: then it is shaded plainly by the way each triangle looks.
 */
function drawModel(canvas, view, thing, figure, table, sample, later) {
  const middle = figure.min.map((value, axis) => (value + figure.max[axis]) / 2);
  const reach = Math.hypot(...sub(figure.max, figure.min)) / 2;
  // wholly behind the eye: nothing of it is seen
  if (dot(sub(middle, view.eye), view.forward) < -reach) return;
  const look = thing.look ?? { alpha: 1, additive: false };
  for (const surface of figure.surfaces) {
    const { texture, normal } = surface;
    let lit;
    if (texture.fullbright) lit = [1, 1, 1];
    else if (sample) {
      const turned = MODEL_AMBIENT + MODEL_DIRECT * Math.max(0, dot(normal, LAMP));
      lit = sample.map((value) => table[value] * turned);
    } else lit = [1, 1, 1].fill(shadeOf(normal));
    // named by its model too (`models/props/cart.mdl#wood`): what a view shows is told by what stands there
    const paint = { lit, alpha: look.alpha, additive: look.additive || texture.additive, name: `${thing.modelFile ?? "model"}#${texture.name}` }; // prettier-ignore
    if (paint.alpha < 1 || paint.additive) later.push({ surface, shift: NO_SHIFT, paint });
    else fill(canvas, view, surface, NO_SHIFT, paint, table);
  }
}

/**
 * Whether a glow is hidden: its middle is off the picture, or what the picture shows there is nearer the
 * eye than the glow by more than a little. (The engine asks a line from the eye to it; the picture is asked
 * instead.)
 */
function glowHidden(canvas, view, point) {
  const offset = sub(point, view.eye);
  const depth = dot(offset, view.forward);
  if (depth < NEAR) return true;
  const x = Math.floor(view.centreX + (dot(offset, view.right) * view.focal) / depth);
  const y = Math.floor(view.centreY - (dot(offset, view.up) * view.focal) / depth);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return true;
  return depth - canvas.nearness[y * canvas.width + x] > GLOW_CLEAR;
}

/** Fills what was kept for after everything opaque: glass, liquids, additive textures, sprites. */
function drawLater(canvas, view, later, table) {
  let drawn = 0;
  for (const { surface, shift, paint, glowAt } of later) {
    if (glowAt && glowHidden(canvas, view, glowAt)) continue;
    if (fill(canvas, view, surface, shift, paint, table)) drawn++;
  }
  return drawn;
}

/**
 * Labels written where there is room: `wanted` is `[{ at: [x, y], words, short, order }]`, the most telling
 * first by `order`. Each is tried to the right of its point, to its left, over it and under it, whole; then
 * `short` (the entity's number alone) the same way; one that fits nowhere is left out. `clear` is how far
 * from the point the words begin. Returns `{ written, shortened, left }`: how many of each.
 */
function writeLabels(canvas, wanted, { clear = DOT_RADIUS + 3, bottom = canvas.height, size = 1 } = {}) {
  const taken = [];
  const count = { written: 0, shortened: 0, left: 0 };
  const boxFor = (at, words, side) => {
    const wide = words.length * LETTER_WIDE * size + 2;
    const high = LETTER_HIGH * size + 2;
    if (side === 0) return [at[0] + clear, at[1] - 3, wide, high];
    if (side === 1) return [at[0] - clear - wide, at[1] - 3, wide, high];
    if (side === 2) return [at[0] - Math.round(wide / 2), at[1] - clear - high, wide, high];
    return [at[0] - Math.round(wide / 2), at[1] + clear, wide, high];
  };
  const free = (box) =>
    box[0] >= 0 &&
    box[1] >= 0 &&
    box[0] + box[2] <= canvas.width &&
    box[1] + box[3] <= bottom &&
    !taken.some(
      (other) =>
        box[0] < other[0] + other[2] &&
        other[0] < box[0] + box[2] &&
        box[1] < other[1] + other[3] &&
        other[1] < box[1] + box[3],
    );
  for (const each of [...wanted].sort((a, b) => a.order - b.order)) {
    let put = null;
    for (const words of [each.words, each.short]) {
      if (!words || put) continue;
      for (let side = 0; side < 4 && !put; side++) {
        const box = boxFor(each.at, words, side);
        if (free(box)) put = { box, words };
      }
    }
    if (!put) {
      count.left++;
      continue;
    }
    taken.push(put.box);
    label(canvas, put.words, put.box[0] + 1, put.box[1] + 1, size, each.colour);
    count.written++;
    if (put.words !== each.words) count.shortened++;
  }
  return count;
}

/**
 * Draws each marked entity: its model, or its sprite, or the box it moves with, or (a thing with none of
 * them) a small box; and, where it is seen, its number and class over it. `with`: `{ labels, figures,
 * sprites, lightAt (the light at a point, for a model; without it models are shaded plainly), later (the
 * list that what is not opaque is kept in, for the caller to draw last) }`. Returns `[{ number, classname,
 * at: [x, y], drawn ("model", "sprite", "box" or "mark"), size }]` for those seen.
 */
function drawMarks(canvas, view, marked, table, { labels, figures, sprites, lightAt, later }) {
  const half = MARK_SIDE / 2;
  const shapes = marked.map((thing) => {
    const figure = figures.get(thing.number);
    const sprite = figure ? undefined : sprites?.get(thing.number);
    const reach = sprite ? Math.max(...sprite.size) / 2 : half;
    const min = figure?.min ?? plus(thing.origin, [1, 1, 1], -reach);
    const max = figure?.max ?? plus(thing.origin, [1, 1, 1], reach);
    const drawn = figure?.surfaces ? "model" : figure ? "box" : sprite ? "sprite" : "mark";
    return { thing, figure, sprite, min, max, drawn };
  });
  const boards = [];
  for (const { thing, figure, sprite, min, max } of shapes) {
    if (figure?.surfaces) {
      if (!thing.look?.hidden)
        drawModel(canvas, view, thing, figure, table, lightAt?.(plus(thing.origin, [0, 0, 1], LUXEL)), later);
      continue;
    }
    if (sprite) {
      const board = boardOf(sprite, view);
      if (board) boards.push({ ...board, glowAt: sprite.mode === "glow" ? sprite.origin : null });
      continue;
    }
    for (const surface of boxSurfaces(min, max, MARK_COLOURS[thing.kind]))
      fill(canvas, view, surface, NO_SHIFT, figure ? { outline: OUTLINE_SHARE } : {}, table);
  }
  // the sprites, the farthest first: one that is whole is drawn now, the others after everything opaque
  for (const { surface, paint, glowAt } of boards.sort((a, b) => b.far - a.far)) {
    if (paint.alpha >= 1 && !paint.additive && !surface.texture.cover)
      fill(canvas, view, surface, NO_SHIFT, paint, table);
    else later.push({ surface, shift: NO_SHIFT, paint, glowAt });
  }
  const seen = [];
  const wanted = [];
  for (const { thing, min, max, drawn } of shapes) {
    const middle = min.map((value, axis) => (value + max[axis]) / 2);
    const offset = sub(middle, view.eye);
    const depth = dot(offset, view.forward);
    if (depth < NEAR) continue;
    const x = Math.round(view.centreX + (dot(offset, view.right) * view.focal) / depth);
    const y = Math.round(view.centreY - (dot(offset, view.up) * view.focal) / depth);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
    // seen when nothing is nearer than its own front
    const reach = Math.hypot(...sub(max, min)) / 2;
    if (canvas.nearness[y * canvas.width + x] < depth - reach - 1) continue;
    seen.push({
      number: thing.number,
      classname: thing.classname,
      at: [x, y],
      drawn,
      size: sizeText(min, max),
    });
    // the words over it: above its top as the picture shows it
    const above = Math.round((((max[2] - min[2]) / 2) * view.focal) / depth);
    wanted.push({
      at: [x, y - above],
      words: `${thing.number} ${thing.classname}`,
      short: String(thing.number),
      order: depth,
    });
  }
  if (labels !== false) writeLabels(canvas, wanted, { clear: 4 });
  return seen;
}

/** What a view says of how its point entities were drawn, in one sentence; nothing when none was. */
function marksNote(marked) {
  if (!marked.length) return [];
  const counted = (drawn) => marked.filter((mark) => mark.drawn === drawn).length;
  const parts = [];
  if (counted("model")) parts.push(`${counted("model")} as their model, with its textures`);
  if (counted("sprite")) parts.push(`${counted("sprite")} as their sprite's first frame`);
  if (counted("box")) parts.push(`${counted("box")} as the box they move with, at its true size`);
  if (counted("mark")) parts.push(`${counted("mark")} as a small box`);
  const models = counted("model")
    ? ""
    : " (`models` and the game's `folders` draw the models that are named)";
  return [`${marked.length} point entities are drawn: ${parts.join(", ")}${models}`];
}

// ── a view of a compiled map ────────────────────────────────────────────────
/**
 * A view from a point inside a compiled map (`bsp`: what `readBsp` gave), as a player would see it:
 * textured, and lit by the map's own lightmaps; with the game's `folders`, under the sky's own picture,
 * with its sprites, and (`models`) with its models.
 *
 *   from          where the eye is, [x, y, z]. Without it: the first place to start, at eye height, looking
 *                 the way it faces; a map with none is looked at from the middle of its largest room
 *   to            the point looked at; or
 *   yaw, pitch    degrees: yaw 0 looks along +x and turns anticlockwise seen from above (90: +y); pitch over
 *                 0 looks up
 *   fov           degrees across (90)
 *   width, height the picture (640 x 480)
 *   light         true (or "start"): the lightmaps as the map starts: the light that is always on (style
 *                 0), the game's flickering styles (1 to 31: a torch) at their full, and the switched
 *                 lights (32 and up) not made to start dark. "off": every switched light off. "steady":
 *                 style 0 alone. "all": every switched light on. false: the textures as they are
 *   brightness    what the light is multiplied by (1.55: about what the game shows; 1: the samples as the
 *                 compiler stored them; more, to look into a dark map)
 *   textures      map textures to wear by name where the map has no pixels of its own: `readWad(...).textures`
 *   folders       the game's folders (the mod's own, then `valve`): their .wad files are looked in, and
 *                 the sky's picture, the sprites and the models are read from them
 *   entities      "models" (unless told): each point entity that stands (a place to start, a monster, an
 *                 NPC) is drawn as the box it moves with, at its true size, and one that names a .mdl or a
 *                 .spr as a small box, each with its number and class; "all": every point entity; "game":
 *                 only what is drawn as the game shows it, by its model or its sprite, and no box for
 *                 anything else (with `labels: false`, a picture to lay beside a screenshot); false: none.
 *                 `labels: false` leaves the words out
 *   unmarked      a list of entity numbers that are not drawn whatever `entities` says: a view from one
 *                 of several places to start that stand together leaves out the others' boxes, which a
 *                 body's width before the eye would be all the picture shows
 *   bodies        `{ name: "large" | "standing" | "crouching" | { half, height, feet } }`: the box a thing
 *                 moves with, by classname or targetname, where its class does not say (`bodyFor`)
 *   models        true: an entity whose `model` key names a .mdl is drawn as that model, read from
 *                 `folders`, with its textures (a masked one's holes left open), in the `body`, `skin`,
 *                 `sequence` and `scale` its entity gives and turned by its `angles`.
 *                 `{ name: "models/x.mdl" }`: these too, by targetname, `scriptfile` or classname.
 *                 `modelScale: false`: each at its own size, whatever its entity's `scale` says
 *   sprites       false: no sprite is drawn. Unless told, an entity that names a .spr found in `folders` is
 *                 drawn as that sprite's first frame, turned to the eye, at its `scale`, by its render mode
 *   sky           true (unless told): the picture the map's `skyname` names (`gfx/env/<name>rt.tga` and
 *                 its five like, of `folders`), and a flat colour where it is not found. `[r, g, b]`: that
 *                 colour, and no picture
 *
 * What is drawn: the world's faces the eye's leaf can see (all of them when the eye is in solid or the map
 * has no visibility), and every brush entity where its `origin` puts it, but those the game never shows
 * (triggers, ladders, entities faded to nothing, faces wearing aaatrigger, clip, null, origin, hint, skip).
 * A `{` texture has its holes on a brush entity whose render mode is 4 (Solid), as in the game, and is
 * filled anywhere else; a liquid of the world lets what is under it show. A model takes the light of
 * the floor under it. NOT drawn: the models nothing names (a monster's comes from its script: `models`
 * names it), a sprite's or a model's animation (one frame is drawn), decals, a brush entity's turn
 * (`angles`), and what a script does when the game runs.
 *
 * Returns `{ width, height, rgba, facts }`. `facts`: `{ from, yaw, pitch, fov, leaf, contents, faces
 * (drawn), pixels (the share of the picture that shows something), light, brightness (the picture's mean,
 * 0 to 255: a number for "too dark"), missing (texture names found
 * nowhere, drawn flat), sky (the name of the sky drawn, or null for a flat colour), marked ([{ number,
 * classname, at, drawn ("model", "sprite", "box" or "mark"), size }]), notes (sentences) }`.
 */
export function drawMap(bsp, options = {}) {
  options = withMod(options, bsp); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const width = sideOf(options.width, VIEW_WIDTH, "width");
  const height = sideOf(options.height, VIEW_HEIGHT, "height");
  const scene = sceneOf(bsp, options);
  const notes = [];
  let stand = options;
  if (!options.from) {
    const start = firstStart(scene.things);
    if (start) stand = { ...options, ...viewFrom(bsp, start.number), ...definedOnly(options) };
    else {
      const [room] = largestRooms(bsp, 1, scene.things.filter((thing) => thing.origin).map((thing) => thing.origin));
      if (!room) throw new Error("drawMap: the map has no place to start and no open room: give `from`");
      stand = { ...options, from: room.at };
      notes.push("the map has no place to start: looked at from the middle of its largest room");
    }
  }
  const view = cameraOf(stand, width, height);
  const canvas = newCanvas(width, height, NOTHING);
  const table = lightTable(options.brightness ?? BRIGHTNESS);
  const leaf = leafAt(bsp, view.eye);
  const contents = contentsAt(bsp, view.eye);
  const seen = facesSeenFrom(bsp, leaf);
  if (contents === CONTENTS.SOLID)
    notes.push(
      "the eye is in solid (inside a wall or outside the map): every face is drawn, from behind where it looks away, but the sky's",
    );
  else if (!seen.byVisibility)
    notes.push("the map keeps no visibility for the eye's leaf: every face is drawn");
  if (!scene.lit && options.light !== false)
    notes.push(
      "the map has no light data (not passed through hlrad): shaded plainly by the way each face looks",
    );

  let faces = 0;
  const later = [];
  /** Draws a surface now when it is opaque, or keeps it for after the rest. */
  let filled = 0;
  const draw = (surface, shift, look) => {
    if (!surface) return;
    const paint = { alpha: look.alpha, additive: look.additive, holes: Boolean(look.holes) };
    if (surface.texture.holes && !look.holes) filled++;
    if (surface.kind === "liquid" && look.alpha >= 1) paint.alpha = LIQUID_ALPHA;
    if (surface.kind === "liquid") paint.twoSided = true;
    if (paint.alpha < 1 || paint.additive) {
      later.push({ surface, shift, paint });
      return;
    }
    if (fill(canvas, view, surface, shift, paint, table)) faces++;
  };
  const plain = { alpha: 1, additive: false, holes: false };
  // from outside the map the sky is not drawn: the game never draws a sky face from behind, and from over a map
  // its lid hid all of it (a video's flyover saw a blue box)
  const outside = contents === CONTENTS.SOLID;
  for (const face of seen.faces) {
    const surface = scene.surfaceAt(face);
    if (!(outside && surface?.kind === "sky")) draw(surface, [0, 0, 0], plain);
  }
  for (const thing of scene.things) {
    if (!thing.model || thing.look.hidden || !bsp.models[thing.model]) continue;
    for (const face of facesOfModel(bsp, thing.model))
      draw(scene.surfaceAt(face), thing.origin ?? [0, 0, 0], thing.look);
  }
  const figured = figuredFor(scene, options);
  const marked = drawMarks(
    canvas,
    view,
    markedThings(
      scene.things,
      options.entities ?? "models",
      figured.figures,
      figured.sprites,
      options.unmarked,
    ),
    table,
    {
      labels: options.labels,
      figures: figured.figures,
      sprites: figured.sprites,
      lightAt: options.light === false ? null : scene.lightAt,
      later,
    },
  );
  faces += drawLater(canvas, view, later, table);
  notes.push(...scene.skyNotes, ...figured.notes);
  if (filled)
    notes.push(
      `${filled} faces wear a \`{\` texture on the world or on an entity whose render mode is not 4 (Solid): the game draws their holes filled with the texture's last colour (blue as a rule), and so are they here`,
    );

  if (scene.missing.size)
    notes.push(
      `${scene.missing.size} textures were found nowhere and are drawn in a flat colour each: ${[...scene.missing].sort().slice(0, 12).join(", ")}${scene.missing.size > 12 ? "..." : ""}`,
    );
  notes.push(...marksNote(marked));
  const brightness = Math.round(meanBrightness(canvas));
  if (scene.lit && options.light !== false && brightness < DARK_VIEW)
    notes.push(
      `the picture is dark (${brightness} of 255 on average): so is the map there, as the game shows it. \`brightness: 4\` looks into it, \`light: false\` shows the textures alone. (A picture's brightness is of this view's walls, ceiling and floor together; \`lightReport\` says how lit each room's floor is, which is what a player and every monster stand in)`,
    );
  const facts = {
    from: view.eye,
    yaw: view.yaw,
    pitch: view.pitch,
    fov: view.fov,
    leaf,
    contents: contentsName(contents),
    faces,
    pixels: shareDrawn(canvas),
    light: scene.lit
      ? `${LIGHT_WORDS[scene.light] ?? LIGHT_WORDS.true}; each sample times ${options.brightness ?? BRIGHTNESS} on its texture, as the compiler stored it (of a draft, hlrad -fast, that is light with no bounces)`
      : "none",
    brightness,
    missing: [...scene.missing].sort(),
    sky: scene.sky?.name ?? null,
    marked,
    notes,
  };
  // how far each pixel's surface is along the view and what it is (0 nothing, 1 a face, 2 sky): for measures
  // of what a player sees (a skyline, layers of distance)
  return { ...pictureOf(canvas), facts, depth: canvas.nearness, shows: canvas.shows, named: canvas.named, names: canvas.names }; // prettier-ignore
}

/**
 * What a compiled map's point entities are drawn as, kept for the map and these options: `{ figures, sprites,
 * notes }` (`figuresOf`, `spritesOf`). The second view of a map does not read its models again.
 */
function figuredFor(scene, options) {
  const key = JSON.stringify([
    options.bodies ?? {},
    options.models ?? false,
    options.modelsBy ?? {},
    options.folders ?? [],
    options.modelScale ?? true,
    options.sprites ?? true,
  ]);
  if (!scene.figured.has(key)) {
    const made = figuresOf(scene.things, options);
    const drawn = spritesOf(scene.things, options);
    scene.figured.set(key, {
      figures: made.figures,
      sprites: drawn.sprites,
      notes: [...made.notes, ...drawn.notes],
    });
  }
  return scene.figured.get(key);
}

/** The camera's own options of a call that were given: they win over where an entity looks. */
function definedOnly({ to, yaw, pitch, fov }) {
  const given = {};
  if (to !== undefined) given.to = to;
  if (yaw !== undefined) given.yaw = yaw;
  if (pitch !== undefined) given.pitch = pitch;
  if (fov !== undefined) given.fov = fov;
  return given;
}

// ── the largest rooms ───────────────────────────────────────────────────────
/**
 * The middles of a map's largest open places, to look from: `[{ at, leaf, size, things }]`, no two of them
 * in sight of one another while such are to be had. A "room" is an empty leaf of the world's tree by the size
 * of its box; the eye is put 64 over the floor under its middle. `points`: where the map's entities stand.
 * A room with some of them in it comes before a larger one with none, and one with a floor under it before
 * one with none: the largest empty leaves of a large map are as a rule the space under its sky or a void
 * between its parts (a city's: the air over the roofs, black or all sky), which shows nothing of it.
 */
function largestRooms(bsp, count, points = []) {
  const world = bsp.models[0];
  const candidates = [];
  for (let leaf = 1; leaf <= world.visLeaves && leaf < bsp.leaves.length; leaf++) {
    const { contents, mins, maxs } = bsp.leaves[leaf];
    if (contents !== CONTENTS.EMPTY) continue;
    const size = sub(maxs, mins);
    if (Math.min(...size) < ROOM_LEAST) continue;
    const middle = mins.map((value, axis) => (value + maxs[axis]) / 2);
    if (leafAt(bsp, middle) !== leaf) continue;
    const floor = floorUnder(bsp, middle);
    const eye = floor === null ? middle[2] : Math.min(floor + EYE_OVER_FLOOR, maxs[2] - NEAR * 2);
    const at = [middle[0], middle[1], eye];
    if (contentsAt(bsp, at) !== CONTENTS.EMPTY) continue;
    const things = points.filter((point) => point.every((value, axis) => value >= mins[axis] && value <= maxs[axis])).length; // prettier-ignore
    candidates.push({ at: at.map(Math.round), leaf: leafAt(bsp, at), size: size[0] * size[1] * size[2], things, floored: floor !== null }); // prettier-ignore
  }
  candidates.sort((a, b) => (b.things > 0) - (a.things > 0) || b.floored - a.floored || b.size - a.size);
  const chosen = [];
  // first those that no chosen room sees; then, when the map is all one open place, those far from the chosen
  for (const room of candidates) {
    if (chosen.length >= count) break;
    const inSight = chosen.some((other) => visibleFrom(bsp, other.leaf)?.includes(room.leaf) ?? true);
    if (!inSight) chosen.push(room);
  }
  const bounds = worldBounds(bsp);
  const apart = Math.hypot(...sub(bounds.maxs, bounds.mins)) / 6;
  for (const room of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((other) => Math.hypot(...sub(other.at, room.at)) > apart)) chosen.push(room);
  }
  return chosen;
}

// ── views aimed at what a map has ───────────────────────────────────────────
/** How far, at the least, a view's way must be open before it: one closer faces a wall. */
const VIEW_OPEN_LEAST = 256;
/** The distances a camera aimed at a feature is tried at, nearest the first that suits. */
const AIM_DISTANCES = [320, 256, 416, 192, 512];

/** How far a line from `from` along `way` (a unit vector) goes before something solid (at most `most`). */
function openAhead(bsp, from, way, most = 1024) {
  for (let d = 8; d <= most; d += 8) {
    const c = contentsAt(bsp, from.map((v, k) => v + way[k] * d));
    if (c === CONTENTS.SOLID || c === CONTENTS.SKY) return d;
  }
  return most;
}

/** Whether nothing solid stands on the line between two points (liquid is no wall). */
function clearBetween(bsp, a, b) {
  const length = Math.hypot(...sub(b, a));
  for (let d = 8; d < length - 8; d += 8) {
    const c = contentsAt(bsp, a.map((v, k) => v + ((b[k] - v) * d) / length));
    if (c === CONTENTS.SOLID || c === CONTENTS.SKY) return false;
  }
  return true;
}

/**
 * A place to look at `target` from: a player's eye over a floor, `AIM_DISTANCES` away about it, in open air,
 * the line to the target clear. Null when none suits.
 */
function standFor(bsp, target, name) {
  for (const distance of AIM_DISTANCES)
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      let over = [target[0] + Math.cos(a) * distance, target[1] + Math.sin(a) * distance, target[2] + 64];
      // under a low ceiling (a landmark aimed at over its top, near the ceiling) the floor is looked for from the
      // target's own height
      if (contentsAt(bsp, over) === CONTENTS.SOLID) over = [over[0], over[1], target[2]];
      if (contentsAt(bsp, over) === CONTENTS.SOLID) continue;
      const floor = floorUnder(bsp, over);
      if (floor === null || over[2] - floor > 512) continue;
      const eye = [over[0], over[1], floor + EYE_OVER_FLOOR];
      if (contentsAt(bsp, eye) !== CONTENTS.EMPTY || !clearBetween(bsp, eye, target)) continue;
      // a landmark is aimed at over its top: its body, lower, must be seen too, or a rail before it hides it (the
      // pump hall's pumps, low in their pool, behind a catwalk's rail): a line to 48 under the aim, stopping 48 short
      if (/^landmark/.test(name)) {
        const body = [target[0], target[1], target[2] - 48];
        const length = Math.hypot(...sub(body, eye));
        const short = eye.map((v, k) => v + ((body[k] - v) * Math.max(0, length - 48)) / length);
        if (!clearBetween(bsp, eye, short)) continue;
      }
      return { from: eye.map(Math.round), to: target.map(Math.round), name };
    }
  return null;
}

/**
 * What a map has to be seen, each a point to aim a view at: the landmark asked for (an entity's number,
 * targetname or classname), its largest water, its largest brush entity that stands (no trigger, ladder or
 * clip), its largest cluster of lamps (faces wearing a lamp's texture), its largest cluster of monsters and
 * items, and a room on each storey but the first. Argon's consult (2026-10-17) found the pump hall's catwalks,
 * bridge and water in no judged view: the views were the starts' and the largest room's, four ways level.
 */
function featureTargets(bsp, { landmark } = {}) {
  const targets = [];
  const ents = bsp.entities.map((pairs, number) => ({ number, keys: Object.fromEntries(pairs) }));
  // a map spec's focus leaves an info_target named "landmark" at its landmark: aimed at unless another is asked
  if (landmark === undefined && ents.some((e) => e.keys.targetname === "landmark")) landmark = "landmark";
  const centreOf = (e) => {
    const model = e.keys.model?.startsWith("*") ? bsp.models[Number(e.keys.model.slice(1))] : null;
    const origin = (e.keys.origin ?? "0 0 0").split(/\s+/).map(Number);
    return model ? model.mins.map((v, k) => (v + model.maxs[k]) / 2 + origin[k]) : origin;
  };
  if (landmark !== undefined) {
    const e = ents.find((x) => x.number === Number(landmark) || x.keys.targetname === landmark || x.keys.classname === landmark);
    if (e) targets.push({ at: centreOf(e), name: `landmark ${e.keys.targetname ?? e.keys.classname}` });
  }
  // the largest water, its top
  let water = null;
  for (let leaf = 1; leaf < bsp.leaves.length; leaf++) {
    const { contents, mins, maxs } = bsp.leaves[leaf];
    if (![CONTENTS.WATER, CONTENTS.SLIME, CONTENTS.LAVA].includes(contents)) continue;
    const size = (maxs[0] - mins[0]) * (maxs[1] - mins[1]);
    if (!water || size > water.size) water = { size, at: [(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, maxs[2]] };
  }
  if (water) targets.push({ at: water.at, name: "water" });
  // the largest brush entity that stands in the world
  const standing = ents.filter((e) => e.keys.model?.startsWith("*") && !/^(trigger_|func_ladder|func_clip|func_monsterclip|func_illusionary|env_|info_)/.test(e.keys.classname ?? ""));
  const volume = (e) => {
    const m = bsp.models[Number(e.keys.model.slice(1))];
    return m ? (m.maxs[0] - m.mins[0]) * (m.maxs[1] - m.mins[1]) * (m.maxs[2] - m.mins[2]) : 0;
  };
  const big = standing.sort((a, b) => volume(b) - volume(a))[0];
  if (big && volume(big) > 64 * 64 * 64) targets.push({ at: centreOf(big), name: `${big.keys.classname} ${big.number}` });
  // clusters on a grid of 256: the cell holding most
  const cluster = (points) => {
    const cells = new Map();
    for (const p of points) {
      const key = `${Math.floor(p[0] / 256)},${Math.floor(p[1] / 256)},${Math.floor(p[2] / 256)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)).push(p);
    }
    const most = [...cells.values()].sort((a, b) => b.length - a.length)[0];
    return most && most.length >= 2 ? [0, 1, 2].map((k) => most.reduce((s, p) => s + p[k], 0) / most.length) : null;
  };
  const lamps = [];
  const isLamp = lampsOf(bsp);
  for (let m = 0; m < bsp.models.length; m++)
    for (const face of modelFaces(bsp, m))
      if (isLamp(faceTexture(bsp, face)?.name ?? "")) {
        const polygon = facePolygon(bsp, face);
        lamps.push([0, 1, 2].map((k) => polygon.reduce((s, p) => s + p[k], 0) / polygon.length));
      }
  const lit = cluster(lamps);
  if (lit) targets.push({ at: lit, name: "lamps" });
  const things = ents.filter((e) => /^(monster_|weapon_|item_|ammo_)/.test(e.keys.classname ?? "") && e.keys.origin).map((e) => e.keys.origin.split(/\s+/).map(Number));
  const met = cluster(things);
  if (met) targets.push({ at: met, name: "monsters and items" });
  // a room on each storey but the lowest
  let cuts = [];
  try {
    cuts = storeyCuts(bsp);
  } catch {
    // a map the walk cannot read keeps its other targets
  }
  if (cuts.length > 1) {
    const rooms = largestRooms(bsp, 24);
    for (const cut of cuts.slice(0, -1)) {
      const room = rooms.find((r) => r.at[2] - EYE_OVER_FLOOR >= cut.floors[0] - 1 && r.at[2] - EYE_OVER_FLOOR <= cut.floors[1] + 1);
      if (room) targets.push({ at: room.at, name: `storey at z ${Math.round(cut.z)}` });
    }
  }
  return targets;
}

/** The views aimed at a map's features (`featureTargets`), each from where it is seen: [{ from, to, name }]. */
export function aimedStands(bsp, options = {}) {
  const stands = [];
  for (const target of featureTargets(bsp, options)) {
    if (stands.some((s) => Math.hypot(...sub(s.to, target.at)) < 192)) continue;
    const stand = standFor(bsp, target.at, target.name);
    if (stand) stands.push(stand);
  }
  return stands;
}

// ── several views in one picture ────────────────────────────────────────────
/**
 * The places to start gathered: each group is the starts that stand within `STARTS_TOGETHER` units of
 * another of the group (so a row of them is one group, however long). `[[thing, ...]]`, the groups in the
 * order of their first entity, and each group's entities in the map's order.
 */
function startGroups(starts) {
  const group = starts.map((_, nth) => nth);
  const of = (nth) => (group[nth] === nth ? nth : (group[nth] = of(group[nth])));
  for (let one = 0; one < starts.length; one++)
    for (let other = one + 1; other < starts.length; other++)
      if (Math.hypot(...sub(starts[one].origin, starts[other].origin)) <= STARTS_TOGETHER)
        group[Math.max(of(one), of(other))] = Math.min(of(one), of(other));
  const groups = new Map();
  starts.forEach((start, nth) => {
    if (!groups.has(of(nth))) groups.set(of(nth), []);
    groups.get(of(nth)).push(start);
  });
  return [...groups.values()];
}

/**
 * Whether a picture is nearly one colour: `{ share, colour }` when `ONE_COLOUR_SHARE` of its pixels or
 * more are within `ONE_COLOUR_NEAR` levels a channel of its commonest colour, else null. The commonest
 * colour is looked for with each channel cut to 32 steps.
 */
function oneColourOf(picture) {
  const pixels = picture.width * picture.height;
  const counts = new Map();
  let commonest = 0;
  let most = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const key =
      ((picture.rgba[pixel * 4] >> 3) << 10) |
      ((picture.rgba[pixel * 4 + 1] >> 3) << 5) |
      (picture.rgba[pixel * 4 + 2] >> 3);
    const counted = (counts.get(key) ?? 0) + 1;
    counts.set(key, counted);
    if (counted > most) [commonest, most] = [key, counted];
  }
  const colour = [(commonest >> 10) & 31, (commonest >> 5) & 31, commonest & 31].map((step) => step * 8 + 4);
  let near = 0;
  for (let pixel = 0; pixel < pixels; pixel++)
    if (
      colour.every((value, channel) => Math.abs(picture.rgba[pixel * 4 + channel] - value) <= ONE_COLOUR_NEAR)
    )
      near++;
  const share = Math.round((near / pixels) * 100) / 100;
  return share >= ONE_COLOUR_SHARE ? { share, colour } : null;
}

/**
 * Several views of a compiled map in one picture, each named in its corner with where it was taken from: an
 * overview in one call.
 *
 *   count          how many cells (8): from the places to start, looking the way each faces (half the cells
 *                  at the most), then from the middle of the largest rooms, each looked at four ways.
 *                  Places to start that stand together (each within 256 units of another) are one group and
 *                  get ONE view, from the first of them (named `1 info_player_start +5`: five more stand
 *                  with it), with the others' boxes left out of it: a body's width before the eye, the
 *                  box of the next place to start is all a view would show
 *   at             instead: the places yourself, `[{ from, yaw, pitch, to, name }]`, an entity's number or a
 *                  classname in place of any of them. These are drawn as asked, whatever they show
 *   width, height  one cell (320 x 240); `cols` cells in a row (4)
 *   and what `drawMap` takes (light, brightness, textures, folders, entities, fov).
 *
 * A view that is nearly one colour (nine tenths of it within a few levels of its commonest colour, and not
 * for want of light: the eye against a wall, or behind the box of a thing that stands before it) shows
 * nothing of the map. It is left out, the next largest room is looked at in its place, and `facts.dropped`
 * says so; where the map has no room left to show instead, it stays, and a note says what it is.
 *
 * Returns `{ width, height, rgba, facts }`; `facts.views` is `[{ name, from, yaw, pitch, faces, pixels }]`,
 * `facts.starts` `[{ view (its name), numbers (the entities of the group) }]` for the views from places
 * to start, `facts.dropped` `[{ name, from, yaw, share, colour, replacedBy }]` for the views left out,
 * `facts.missing` and `facts.notes` as `drawMap` gives.
 */
export function viewsOf(bsp, options = {}) {
  options = withMod(options, bsp); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const count = options.count ?? VIEWS_COUNT;
  if (!Number.isInteger(count) || count < 1) throw new Error(`count: a whole number from 1, not ${count}`);
  const width = sideOf(options.width, CELL_WIDTH, "width");
  const height = sideOf(options.height, CELL_HEIGHT, "height");
  const scene = sceneOf(bsp, options);
  const own = [];
  let stands;
  let spare = [];
  if (options.at) {
    const asked = Array.isArray(options.at) ? options.at : [options.at];
    stands = asked.map((each) => (typeof each === "object" ? each : viewFrom(bsp, each)));
  } else {
    const groups = startGroups(scene.things.filter((thing) => thing.kind === "start" && thing.origin));
    const most = Math.max(1, Math.floor(count / 2));
    const fromStarts = groups.slice(0, most).map((group) => ({
      ...viewFrom(bsp, group[0].number),
      unmarked: group.slice(1).map((thing) => thing.number),
      group: group.map((thing) => thing.number),
    }));
    const together = groups.filter((group) => group.length > 1);
    if (together.length)
      own.push(
        `places to start stand together (each within ${STARTS_TOGETHER} units of another): ${together.map((group) => `${group.length} about ${pointText(group[0].origin)} (entities ${group.map((thing) => thing.number).join(", ")})`).join("; ")}. One view is taken for each such group, from its first (its name says how many more stand with it: +5 for five), with the others' boxes left out of it`,
      );
    if (groups.length > most)
      own.push(
        `${groups.length - most} more places to start (or groups of them) have no view: \`count\` gives them half its cells at the most`,
      );
    // aimed (`aim`): the features' views next, then the rooms' level views, the most open first (a view facing a
    // wall within VIEW_OPEN_LEAST only when no other is left)
    const aimed = options.aim ? aimedStands(bsp, { landmark: options.landmark }).slice(0, Math.max(0, count - fromStarts.length)) : [];
    const wanted = Math.max(1, Math.floor((count - fromStarts.length) / FOUR_WAYS.length));
    const points = scene.things.filter((thing) => thing.origin).map((thing) => thing.origin);
    const rooms = largestRooms(bsp, options.aim ? count + ROOMS_SPARE : wanted + ROOMS_SPARE, points);
    const waysOf = (room) => FOUR_WAYS.map((yaw) => ({ from: room.at, yaw, pitch: 0, name: `room ${pointText(room.at)}` }));
    const radians = (deg) => (deg * Math.PI) / 180;
    const openOf = (stand) => openAhead(bsp, stand.from, [Math.cos(radians(stand.yaw)), Math.sin(radians(stand.yaw)), 0], VIEW_OPEN_LEAST);
    if (options.aim) {
      const all = rooms.flatMap(waysOf).map((stand) => ({ stand, open: openOf(stand) }));
      const ways = [...all.filter((w) => w.open >= VIEW_OPEN_LEAST), ...all.filter((w) => w.open < VIEW_OPEN_LEAST).sort((x, y) => y.open - x.open)].map((w) => w.stand);
      const room = Math.max(0, count - fromStarts.length - aimed.length);
      stands = [...fromStarts, ...aimed, ...ways.slice(0, room)].slice(0, Math.max(count, 1));
      spare = ways.slice(room);
    } else {
      stands = [...fromStarts, ...rooms.slice(0, wanted).flatMap(waysOf)].slice(0, Math.max(count, 1));
      spare = rooms.slice(wanted).flatMap(waysOf);
    }
  }
  if (!stands.length) throw new Error("viewsOf: the map has no place to start and no open room: give `at`");
  const draw = (stand) => drawMap(bsp, { ...options, ...stand, to: stand.to, width, height });
  const nameOf = (stand, picture) =>
    `${stand.name ?? `at ${pointText(stand.from)}`}${stand.group?.length > 1 ? ` +${stand.group.length - 1}` : ""} yaw ${picture.facts.yaw}`;
  /** What makes a view show nothing of the map: nearly one colour, and not because the map is dark there. */
  const flatOf = (picture) =>
    scene.lit && options.light !== false && picture.facts.brightness < DARK_VIEW
      ? null
      : oneColourOf(picture);
  const shown = [];
  const dropped = [];
  for (const stand of stands) {
    const picture = draw(stand);
    const flat = options.at ? null : flatOf(picture);
    if (!flat) {
      shown.push({ stand, picture });
      continue;
    }
    // the next room that shows something takes its place; with none left, the view stays and is said
    let instead = null;
    while (spare.length && !instead) {
      const next = spare.shift();
      const other = draw(next);
      if (!flatOf(other)) instead = { stand: next, picture: other };
    }
    const told = `${nameOf(stand, picture)} (${Math.round(flat.share * 100)} in 100 of it about the colour ${flat.colour.join(" ")})`;
    if (!instead) {
      shown.push({ stand, picture });
      own.push(
        `the view ${told} is nearly one colour, and the map has no other room to show in its place: it is drawn all the same`,
      );
      continue;
    }
    shown.push(instead);
    dropped.push({
      name: nameOf(stand, picture),
      from: picture.facts.from,
      yaw: picture.facts.yaw,
      share: flat.share,
      colour: flat.colour,
      replacedBy: nameOf(instead.stand, instead.picture),
      told,
    });
  }
  if (dropped.length)
    own.push(
      `${dropped.length} views were nearly one colour and are left out, each with the next largest room in its place: ${dropped.map((each) => `${each.told}, replaced by ${each.replacedBy}`).join("; ")}. Such a view is taken with the eye against a wall, or behind the box of a thing that stands before it`,
    );
  const drawn = shown.map((each) => each.picture);
  const names = shown.map((each) => nameOf(each.stand, each.picture));
  const columns = options.cols ?? Math.min(VIEWS_COLUMNS, shown.length);
  const picture = tile(drawn, columns, names);
  const facts = {
    views: drawn.map((each, nth) => ({
      name: names[nth],
      from: each.facts.from,
      yaw: each.facts.yaw,
      pitch: each.facts.pitch,
      faces: each.facts.faces,
      pixels: each.facts.pixels,
    })),
    starts: shown
      .map((each, nth) => ({ view: names[nth], numbers: each.stand.group }))
      .filter((each) => each.numbers),
    dropped: dropped.map(({ told: _told, ...each }) => each),
    light: drawn[0].facts.light,
    missing: drawn[0].facts.missing,
    notes: [...viewsNotes(drawn.map((each) => each.facts)), ...own],
  };
  return { ...picture, facts };
}

/**
 * What several views have to say, each thing once: the notes that are the same for all, and one line each
 * for how many are dark and how many entities are marked, which every view words with its own numbers.
 */
function viewsNotes(facts) {
  const ofOneView = /^(the picture is dark|\d+ point entities are drawn)/;
  const shared = new Set(facts.flatMap((each) => each.notes.filter((note) => !ofOneView.test(note))));
  const dark = facts.filter((each) => each.light !== "none" && each.brightness < DARK_VIEW).length;
  const notes = [...shared];
  if (facts.some((each) => each.marked.length))
    notes.push(
      "point entities are drawn at their true size: as the box each moves with, as its sprite, or (with `models`) as its model",
    );
  if (dark)
    notes.push(
      `${dark} of the ${facts.length} views are dark (under ${DARK_VIEW} of 255 on average): so is the map there, as the game shows it. \`brightness: 4\` looks into it`,
    );
  return notes;
}

// ── plans ───────────────────────────────────────────────────────────────────
/**
 * How a plan lies on its picture: `{ x0, y0, scale, width, height }`. `x0`, `y0`: the world's x at the
 * picture's left edge and its y at the top edge; `scale`: pixels a unit. A point (x, y) of the world is at
 * pixel ((x - x0) * scale, (y0 - y) * scale).
 */
function planFrame(min, max, { scale, width, height, area }) {
  const low = area?.min ?? min;
  const high = area?.max ?? max;
  const wide = high[0] - low[0];
  const deep = high[1] - low[1];
  if (!(wide > 0 && deep > 0)) throw new Error("area: `min` [x, y] must be under `max` [x, y] on both axes");
  if (scale !== undefined && !(scale > 0)) throw new Error(`scale: pixels a unit, over 0, not ${scale}`);
  const most = [sideOf(width, PLAN_SIDE, "width"), sideOf(height, PLAN_SIDE, "height")];
  const fitting = Math.min(
    (most[0] - 2 * PLAN_MARGIN) / wide,
    (most[1] - 2 * PLAN_MARGIN - PLAN_FOOT) / deep,
  );
  const perUnit = scale ?? fitting;
  const made = [
    width ?? Math.ceil(wide * perUnit + 2 * PLAN_MARGIN),
    height ?? Math.ceil(deep * perUnit + 2 * PLAN_MARGIN + PLAN_FOOT),
  ];
  return {
    perspective: false,
    x0: low[0] - PLAN_MARGIN / perUnit,
    y0: high[1] + PLAN_MARGIN / perUnit,
    scale: perUnit,
    width: sideOf(Math.min(made[0], SIDE_MOST), undefined, "the plan's width"),
    height: sideOf(Math.min(made[1], SIDE_MOST), undefined, "the plan's height"),
  };
}
/** The pixel of a plan a point of the world is at. */
const planPixel = (frame, point) => [
  Math.round((point[0] - frame.x0) * frame.scale),
  Math.round((frame.y0 - point[1]) * frame.scale),
];

/** A filled dot with a dark rim. */
function drawDot(canvas, [x, y], radius, colour) {
  for (let down = -radius - 1; down <= radius + 1; down++)
    for (let across = -radius - 1; across <= radius + 1; across++) {
      const far = Math.hypot(across, down);
      const column = x + across;
      const row = y + down;
      if (far > radius + 1 || column < 0 || row < 0 || column >= canvas.width || row >= canvas.height)
        continue;
      canvas.rgba.set(far <= radius ? [...colour, 255] : [0, 0, 0, 255], (row * canvas.width + column) * 4);
    }
}
/** The colour of a line a caller asks a plan for, unless it says. */
const LINE_COLOUR = [255, 64, 160];
/** A line on the canvas. */
const line = (canvas, from, to, colour) =>
  drawLine(canvas.rgba, canvas.width, canvas.height, from, to, [...colour, 255]);

/**
 * The rim of a shape seen from above, from its faces' corners: the edges that only one of its faces that
 * look one way along z has (an edge two share is inside the shape: a floor of many triangles is drawn as one
 * outline). Its top or its underside, whichever it has: on a plan they are one outline. A shape with
 * neither gives every edge. `[[from, to]]`, points of the world.
 */
function rimOf(polygons) {
  /** The faces whose corners turn one way seen from above, and that are not walls. */
  const turning = (sign) =>
    polygons.filter((polygon) => {
      const normal = cross(sub(polygon[1], polygon[0]), sub(polygon[2], polygon[0]));
      return normal[2] * sign > FLOOR_LEAST * Math.hypot(...normal);
    });
  const oneWay = turning(-1);
  const lookingUp = oneWay.length ? oneWay : turning(1);
  const edges = new Map();
  for (const polygon of lookingUp.length ? lookingUp : polygons)
    polygon.forEach((corner, index) => {
      const next = polygon[(index + 1) % polygon.length];
      const ends = [corner, next].map((point) => `${Math.round(point[0])} ${Math.round(point[1])}`).sort();
      if (ends[0] === ends[1]) return;
      const key = ends.join("|");
      edges.set(key, { ends: [corner, next], count: (edges.get(key)?.count ?? 0) + 1 });
    });
  const once = [...edges.values()].filter((edge) => edge.count === 1 || !lookingUp.length);
  return once.map((edge) => edge.ends);
}

/**
 * The marks of a plan: each brush entity's outline (handed over as lists of corners in the world), then each
 * point entity as a dot in the colour of its kind, with a short line the way it faces and, for one that
 * stands, the outline of the box it moves with (or of its model) at its true size; and their labels where
 * there is room. An entity that names a sprite has a small cross through its dot. `only`: a list of entity
 * numbers, and no other is marked. Returns `{ marks: [{ number, classname, name, kind, origin, at: [x, y],
 * size, sprite }], labels }`.
 */
function drawPlanMarks(canvas, frame, things, outlineOf, { labels, only, figures, sprites }) {
  const marks = [];
  const wanted = [];
  const chosen = (thing) => !only || only.includes(thing.number);
  for (const thing of things) {
    if (thing.model === null || thing.number === 0 || !chosen(thing)) continue;
    const outline = outlineOf(thing);
    if (!outline.length) continue;
    const colour = MARK_COLOURS[thing.kind];
    let sum = [0, 0];
    let counted = 0;
    for (const [from, to] of rimOf(outline)) {
      line(canvas, planPixel(frame, from), planPixel(frame, to), colour);
      sum = [sum[0] + from[0], sum[1] + from[1]];
      counted++;
    }
    const middle = [sum[0] / counted, sum[1] / counted];
    const at = planPixel(frame, middle);
    marks.push({
      number: thing.number,
      classname: thing.classname,
      name: thing.targetname,
      kind: thing.kind,
      origin: middle.map(Math.round),
      at,
    });
    wanted.push({
      at,
      words: `${thing.number} ${thing.classname}`,
      short: String(thing.number),
      order: thing.kind === "trigger" ? 3 : 2,
    });
  }
  for (const thing of things) {
    if (thing.model !== null || !thing.origin || !chosen(thing)) continue;
    const at = planPixel(frame, thing.origin);
    const colour = MARK_COLOURS[thing.kind];
    const figure = figures.get(thing.number);
    if (figure) {
      // its true size: the box it moves with is square to the axes; a model's is turned the way it faces
      const corners = figure.corners ?? [
        [figure.min[0], figure.min[1]],
        [figure.max[0], figure.min[1]],
        [figure.max[0], figure.max[1]],
        [figure.min[0], figure.max[1]],
      ];
      corners.forEach((corner, index) =>
        line(
          canvas,
          planPixel(frame, corner),
          planPixel(frame, corners[(index + 1) % corners.length]),
          colour,
        ),
      );
    }
    if (thing.turned && thing.kind !== "light") {
      const way = [Math.cos(thing.yaw * DEGREES), -Math.sin(thing.yaw * DEGREES)];
      line(canvas, at, [at[0] + way[0] * FACING_LENGTH, at[1] + way[1] * FACING_LENGTH], colour);
    }
    const isSprite = !figure && /\.spr$/i.test(thing.modelFile ?? "");
    const sprite = isSprite ? sprites?.get(thing.number) : undefined;
    if (isSprite)
      for (const way of [1, -1])
        line(
          canvas,
          [at[0] - SPRITE_ARM, at[1] - SPRITE_ARM * way],
          [at[0] + SPRITE_ARM, at[1] + SPRITE_ARM * way],
          colour,
        );
    drawDot(canvas, at, DOT_RADIUS, colour);
    marks.push({
      number: thing.number,
      classname: thing.classname,
      name: thing.targetname,
      kind: thing.kind,
      origin: thing.origin,
      at,
      ...(figure ? { size: sizeText(figure.min, figure.max) } : {}),
      ...(isSprite ? { sprite: thing.modelFile } : {}),
      ...(sprite ? { size: sprite.size.map(Math.round).join(" x ") } : {}),
    });
    const order = { start: 0, monster: 1, other: 4, light: 5 }[thing.kind];
    wanted.push({ at, words: `${thing.number} ${thing.classname}`, short: String(thing.number), order });
  }
  if (labels === false) return { marks, labels: { written: 0, shortened: 0, left: 0 } };
  // the labels: the kinds that matter most first, none over one already written; a crowded one is its
  // number alone, which the list of entities explains
  const few = labels === true || wanted.length <= LABELS_MOST;
  const written = writeLabels(
    canvas,
    wanted.filter((each) => few || each.order === 0),
    { bottom: canvas.height - PLAN_FOOT },
  );
  return { marks, labels: written };
}

/** What a plan says of its labels that are a number alone, or left out; nothing when all are whole. */
function labelsNote(labels) {
  if (!labels.shortened && !labels.left) return [];
  return [
    `${labels.shortened} labels are the entity's number alone and ${labels.left} were left out, for want of room: \`legend: true\` lists every number with its class beside the plan, and \`facts.marks\` has them all`,
  ];
}

/**
 * A plan with the list of its entities beside it: each class once, with the numbers of its entities (and a
 * targetname after its number). Returns the wider picture.
 */
function withLegend(picture, marks) {
  const byClass = new Map();
  for (const mark of marks) {
    if (!byClass.has(mark.classname)) byClass.set(mark.classname, { kind: mark.kind, entries: [] });
    byClass.get(mark.classname).entries.push(mark.name ? `${mark.number}=${mark.name}` : String(mark.number));
  }
  const most = Math.floor((LEGEND_WIDE - 16) / LETTER_WIDE);
  const lines = [];
  for (const [classname, { kind, entries }] of byClass) {
    lines.push({ words: `${classname} (${entries.length})`, colour: MARK_COLOURS[kind] });
    let row = " ";
    for (const entry of entries) {
      if (row.length + entry.length + 1 > most) {
        lines.push({ words: row, colour: PLAN_COLOURS.ink });
        row = " ";
      }
      row += ` ${entry}`;
    }
    lines.push({ words: row, colour: PLAN_COLOURS.ink });
  }
  const width = picture.width + LEGEND_WIDE;
  const rgba = new Uint8Array(width * picture.height * 4);
  for (let pixel = 0; pixel < width * picture.height; pixel++) rgba.set([20, 22, 26, 255], pixel * 4);
  for (let row = 0; row < picture.height; row++)
    rgba.set(picture.rgba.subarray(row * picture.width * 4, (row + 1) * picture.width * 4), row * width * 4);
  const wider = { width, height: picture.height, rgba };
  const room = Math.floor((picture.height - 16) / LEGEND_LINE);
  lines.slice(0, room).forEach(({ words, colour }, index) => {
    const cut =
      index === room - 1 && lines.length > room ? `... and ${lines.length - room} lines more` : words;
    label(wider, cut, picture.width + 8, 8 + index * LEGEND_LINE, 1, colour);
  });
  return wider;
}

/**
 * The heights of a plan's floors, to be written on them: the picture keeps the height of the floor under
 * every pixel, and each patch of one height that is large enough gets `z` and its height where it is
 * widest. `cut` marks the pixels that are not floor (solid at the cut). Returns `[{ at, words, z }]`.
 */
function floorHeights(canvas, bottom, cut) {
  const { width, nearness } = canvas;
  const seen = new Uint8Array(width * bottom);
  const heightAt = (at) => (cut[at] || nearness[at] === Infinity ? null : Math.round(-nearness[at]));
  const found = [];
  const stack = [];
  for (let begin = 0; begin < width * bottom; begin++) {
    if (seen[begin]) continue;
    seen[begin] = 1;
    const height = heightAt(begin);
    if (height === null) continue;
    // the patch of this height, and the widest stretch of one row of it
    let area = 0;
    let best = { length: 0, row: 0, left: 0 };
    stack.push(begin);
    while (stack.length) {
      const at = stack.pop();
      area++;
      const column = at % width;
      const row = (at - column) / width;
      if (column === 0 || heightAt(at - 1) !== height) {
        let length = 1;
        while (column + length < width && heightAt(at + length) === height) length++;
        if (length > best.length) best = { length, row, left: column };
      }
      for (const [other, inside] of [
        [at - 1, column > 0],
        [at + 1, column < width - 1],
        [at - width, row > 0],
        [at + width, row < bottom - 1],
      ]) {
        if (!inside || seen[other] || heightAt(other) !== height) continue;
        seen[other] = 1;
        stack.push(other);
      }
    }
    const words = `z ${height}`;
    if (area >= HEIGHT_AREA_LEAST && best.length >= words.length * LETTER_WIDE + 6)
      found.push({ at: [best.left + Math.round(best.length / 2), best.row], words, z: height, area });
  }
  return found.sort((a, b) => b.area - a.area);
}

/** Writes the heights `floorHeights` found, each centred on its point, none over another. */
/**
 * A grid over a plan: a faint line every `step` units, each with its coordinate written at the plan's top (x)
 * and left (y), so a place is read off the picture in units, not measured against the scale bar.
 */
function drawGrid(canvas, frame, step, foot) {
  const high = canvas.height - foot;
  const blend = (i) => {
    for (let k = 0; k < 3; k++) canvas.rgba[i + k] = Math.round(canvas.rgba[i + k] * 0.6 + GRID_INK[k] * 0.4);
  };
  const x0 = frame.x0;
  const x1 = frame.x0 + canvas.width / frame.scale;
  const y1 = frame.y0;
  const y0 = frame.y0 - high / frame.scale;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    const px = Math.round((x - x0) * frame.scale);
    if (px < 0 || px >= canvas.width) continue;
    for (let py = 0; py < high; py++) blend((py * canvas.width + px) * 4);
    label(canvas, String(x), px + 2, 2, 1, GRID_INK);
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const py = Math.round((y1 - y) * frame.scale);
    if (py < 0 || py >= high) continue;
    for (let px = 0; px < canvas.width; px++) blend((py * canvas.width + px) * 4);
    label(canvas, String(y), 2, py + 2, 1, GRID_INK);
  }
}
/** The grid's colour on a plan. */
const GRID_INK = [150, 170, 200];

function writeHeights(canvas, heights) {
  const taken = [];
  for (const { at, words } of heights) {
    const wide = words.length * LETTER_WIDE + 2;
    const box = [at[0] - Math.round(wide / 2), at[1] - 3, wide, LETTER_HIGH + 2];
    if (
      taken.some(
        (other) =>
          box[0] < other[0] + other[2] && other[0] < box[0] + box[2] && Math.abs(box[1] - other[1]) < box[3],
      )
    )
      continue;
    taken.push(box);
    label(canvas, words, box[0] + 1, box[1] + 1, 1, HEIGHT_INK);
  }
}

/**
 * What the walk test found, on a plan: every floor turned grey, then the floor that was walked tinted in
 * one colour, floor a player would fit on and did not get to in another, floor only a jump reaches in a
 * third and the floor of a one-way place in a fourth, the ways asked for as lines, each opening with its
 * number.
 * `cut`: the height of the plan's cut (undefined: seen from above), and the pixels that are solid there.
 */
function drawReach(canvas, frame, reach, cutHeight, cut) {
  const bottom = canvas.height - PLAN_FOOT;
  for (let row = 0; row < bottom; row++)
    for (let column = 0; column < frame.width; column++) {
      const at = row * frame.width + column;
      if (cut[at] || canvas.nearness[at] === Infinity) continue;
      const x = frame.x0 + (column + 0.5) / frame.scale;
      const y = frame.y0 - (row + 0.5) / frame.scale;
      // the floor goes grey first, so that the tint is told from a floor's own colour
      const grey =
        0.3 * canvas.rgba[at * 4] + 0.59 * canvas.rgba[at * 4 + 1] + 0.11 * canvas.rgba[at * 4 + 2];
      canvas.rgba.set([grey, grey, grey], at * 4);
      // a one-way place is told from everything else; then what only a jump reaches from what is walked
      const walked = reach.walked(x, y, cutHeight);
      if (walked !== null) {
        const colour =
          reach.trapped?.(x, y, cutHeight) === walked
            ? REACH_COLOURS.trapped
            : reach.jumped?.(x, y, cutHeight) === walked
              ? REACH_COLOURS.jumped
              : REACH_COLOURS.walked;
        tint(canvas, at, colour, colour === REACH_COLOURS.walked ? REACH_SHARE : REACH_STRONG);
      } else if (reach.stands(x, y, cutHeight) !== null)
        tint(canvas, at, REACH_COLOURS.unwalked, REACH_SHARE);
    }
  for (const route of reach.routes ?? [])
    for (let index = 0; index + 1 < route.points.length; index++)
      line(
        canvas,
        planPixel(frame, route.points[index]),
        planPixel(frame, route.points[index + 1]),
        REACH_COLOURS.route,
      );
  for (const opening of reach.openings ?? []) {
    if (cutHeight !== undefined && opening.at[2] > cutHeight) continue;
    const at = planPixel(frame, opening.at);
    label(canvas, `o${opening.number}`, at[0] - 4, at[1] - 3, 1, REACH_COLOURS.route);
  }
}

/** The walk test a plan is to show: the one handed over, or (`reach: true`) one made now, with the profile's lists. */
const reachFor = (map, options) =>
  options.reach === true ? reachOf(map, { bodies: options.bodies, mod: options.mod }) : (options.reach ?? null);
const REACH_NOTE =
  "the walk test is tinted on it: the floors are grey, green where a player walks to from the places to start, red where there is room to stand and no way was found, blue where only a jump leads, amber where a player gets in and not out again (a one-way place); o1, o2 ... are the openings";

/** The band under a plan: the kinds' colours, the scale bar, and which way is north. */
function drawPlanFoot(canvas, frame, kinds, words) {
  const top = canvas.height - PLAN_FOOT;
  for (let row = top; row < canvas.height; row++)
    for (let column = 0; column < canvas.width; column++)
      canvas.rgba.set([20, 22, 26, 255], (row * canvas.width + column) * 4);
  // the legend: a dot and a word for each kind of mark there is
  let x = PLAN_MARGIN;
  for (const kind of kinds) {
    drawDot(canvas, [x, top + 10], DOT_RADIUS, MARK_COLOURS[kind]);
    label(canvas, kind === "brush" ? "brush entity" : kind, x + 8, top + 8, 1, PLAN_COLOURS.ink);
    x += (kind === "brush" ? 12 : kind.length) * LETTER_WIDE + 22;
  }
  // the scale: the longest round length that fits
  const length = BAR_LENGTHS.filter((units) => units * frame.scale <= BAR_MOST).at(-1) ?? BAR_LENGTHS[0];
  const barY = top + 30;
  const barEnd = PLAN_MARGIN + Math.round(length * frame.scale);
  line(canvas, [PLAN_MARGIN, barY], [barEnd, barY], PLAN_COLOURS.ink);
  line(canvas, [PLAN_MARGIN, barY - 4], [PLAN_MARGIN, barY + 4], PLAN_COLOURS.ink);
  line(canvas, [barEnd, barY - 4], [barEnd, barY + 4], PLAN_COLOURS.ink);
  label(canvas, `${length} units  ${words}`, barEnd + 10, barY - 5, 2, PLAN_COLOURS.ink);
  // north: an arrow up the picture, in its top right corner
  const arrowX = canvas.width - PLAN_MARGIN;
  line(canvas, [arrowX, 8], [arrowX, 34], PLAN_COLOURS.ink);
  line(canvas, [arrowX, 8], [arrowX - 5, 16], PLAN_COLOURS.ink);
  line(canvas, [arrowX, 8], [arrowX + 5, 16], PLAN_COLOURS.ink);
  label(canvas, "+y", arrowX - 22, 6, 2, PLAN_COLOURS.ink);
  label(canvas, "+y up  +x right", 6, 6, 1, PLAN_COLOURS.ink);
  return length;
}

/** Tints a pixel of the canvas towards a colour. */
function tint(canvas, at, colour, share) {
  for (let channel = 0; channel < 3; channel++)
    canvas.rgba[at * 4 + channel] += (colour[channel] - canvas.rgba[at * 4 + channel]) * share;
}

/** What a plan's facts say of how it lies: the numbers a pixel is worked out from. */
const frameFacts = (frame) => ({
  scale: frame.scale,
  x0: frame.x0,
  y0: frame.y0,
  pixel: "a point (x, y) is at pixel ((x - x0) * scale, (y0 - y) * scale)",
});

/**
 * A compiled map seen from straight above: the picture that shows where a door or an entity IS. North (+y)
 * is up the picture and east (+x) to its right, as its corner says.
 *
 *   z              a height to cut at: what is above it is left out, and what is solid AT it (asked of the
 *                  world's tree, pixel by pixel) is filled in one colour: a floor plan of that storey, with
 *                  its doorways open. Without it the map is seen from above everything: each floor (the
 *                  highest wins: a roof hides its house), with the walls as lines
 *   slice          false: with `z`, no solid is filled; the walls are lines, as without it
 *   scale          pixels a unit; without it the map is fitted into `width` x `height` (1024 x 1024 at most)
 *   area           `{ min: [x, y], max: [x, y] }`: this part of the map only (a closer look)
 *   entities       false leaves the marks out. Each point entity is a dot: places to start in one colour,
 *                  lights in another, monsters and NPCs in a third, the rest in a fourth, with a short line
 *                  the way it faces; one that stands (a start, a monster, an NPC) has the outline of the box
 *                  it moves with about it, at its true size (`bodies`, `models`, `folders`: as `drawMap`
 *                  takes them); each brush entity is outlined (triggers in a colour of their own)
 *   labels         false leaves the words out. A label is an entity's number and class; where it would lie
 *                  over another it is tried on the dot's other sides, then as the number alone, and only
 *                  then left out (lights last). A map of more than 60 marks labels only its places to start
 *                  unless `labels` is true: `facts.marks` has them all, and `area` gives a closer look
 *   legend         true: the list of the entities beside the plan, 300 pixels wider: each class with the
 *                  numbers of its entities (`12=keeper`: one with a targetname)
 *   heights        true: each floor's height is written on it (`z 64`), where the floor is large enough
 *   grid           a length (256): a faint line every so many units, its x written along the top and its y down
 *                  the left, so a place is read off the plan in units
 *   reach          what `reachOf` gave for this map (or true: it is run now): the floors are drawn grey,
 *                  tinted green where they were walked and red where there is room to stand and no way
 *                  was found; the ways asked for
 *                  (`to`) are lines, and each opening has its number (`o3`)
 *   only           a list of entity numbers: no other entity is marked
 *   lines          `[{ from: [x, y], to: [x, y], colour: [r, g, b] }]`: lines of one's own over the plan
 *                  (`smak map-spawns`: from where a player stands in a trigger to each monster seen from it)
 *   and `light`, `brightness`, `textures`, `folders` as `drawMap` takes them: a floor is its texture's mean
 *   colour under the map's own light, so a dark room is dark on the plan.
 *
 * Returns `{ width, height, rgba, facts }`. `facts`: `{ scale, x0, y0, pixel (how a point finds its pixel),
 * z, bar (the scale bar's length in units), marks: [{ number, classname, name, kind, origin, at: [x, y],
 * size }], heights: [{ z, at }], missing, notes }`.
 */
export function planOf(bsp, options = {}) {
  options = withMod(options, bsp); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const scene = sceneOf(bsp, options);
  const bounds = worldBounds(bsp);
  const frame = planFrame(bounds.mins, bounds.maxs, options);
  const cut = options.z;
  if (cut !== undefined && !Number.isFinite(cut)) throw new Error(`z: a height in units, not ${cut}`);
  const view = { ...frame, least: cut === undefined ? -Infinity : -cut };
  const canvas = newCanvas(frame.width, frame.height, PLAN_COLOURS.rock);
  const table = lightTable(options.brightness ?? BRIGHTNESS);
  const shown = scene.things.filter((thing) => thing.model && !thing.look.hidden && bsp.models[thing.model]);
  // the floors, the highest first in sight; liquids over them
  const liquids = [];
  const floor = (face, shift) => {
    const surface = scene.surfaceAt(face);
    if (!surface || surface.kind === "sky") return;
    if (surface.kind === "liquid") liquids.push({ surface, shift });
    else fill(canvas, view, surface, shift, { mean: true, ambient: PLAN_AMBIENT, lift: PLAN_LIFT }, table);
  };
  for (const face of facesOfModel(bsp, 0)) floor(face, [0, 0, 0]);
  for (const thing of shown)
    for (const face of facesOfModel(bsp, thing.model)) floor(face, thing.origin ?? [0, 0, 0]);
  for (const { surface, shift } of liquids)
    fill(canvas, view, surface, shift, { mean: true, alpha: LIQUID_ALPHA }, table);

  const sliced = cut !== undefined && options.slice !== false;
  const cutMask = new Uint8Array(frame.width * frame.height);
  const reach = reachFor(bsp, options);
  if (reach) drawReach(canvas, frame, reach, cut, cutMask);
  if (sliced) {
    for (let row = 0; row < frame.height - PLAN_FOOT; row++)
      for (let column = 0; column < frame.width; column++) {
        const point = [frame.x0 + (column + 0.5) / frame.scale, frame.y0 - (row + 0.5) / frame.scale, cut];
        const contents = contentsAt(bsp, point);
        const at = row * frame.width + column;
        if (contents === CONTENTS.SOLID || contents === CONTENTS.SKY) cutMask[at] = 1;
        if (contents === CONTENTS.SOLID) canvas.rgba.set(PLAN_COLOURS.solid, at * 4);
        else if (contents === CONTENTS.SKY) canvas.rgba.set(PLAN_COLOURS.sky, at * 4);
        else if (contents !== CONTENTS.EMPTY) tint(canvas, at, PLAN_COLOURS.water, 0.5);
      }
  } else {
    // the walls as lines: each wall face's top edge, where no floor above hides it
    for (const face of facesOfModel(bsp, 0)) {
      const surface = scene.surfaceAt(face);
      if (!surface || surface.kind !== "face" || Math.abs(surface.normal[2]) > WALL_MOST) continue;
      const heights = surface.polygon.map((corner) => corner[2]);
      if (cut !== undefined && Math.min(...heights) > cut) continue;
      const top = Math.min(Math.max(...heights), cut ?? Infinity);
      surface.polygon.forEach((corner, index) => {
        const next = surface.polygon[(index + 1) % surface.polygon.length];
        wallLine(canvas, planPixel(frame, corner), planPixel(frame, next), top);
      });
    }
  }

  const outlineOf = (thing) =>
    bsp.models[thing.model]
      ? facesOfModel(bsp, thing.model).map((face) =>
          facePolygon(bsp, face).map((corner) => plus(corner, thing.origin ?? [0, 0, 0])),
        )
      : [];
  const heights = options.heights ? floorHeights(canvas, frame.height - PLAN_FOOT, cutMask) : [];
  if (options.grid) drawGrid(canvas, frame, options.grid, PLAN_FOOT);
  writeHeights(canvas, heights);
  const figured = figuredFor(scene, options);
  const { marks, labels } =
    options.entities === false
      ? { marks: [], labels: { shortened: 0, left: 0 } }
      : drawPlanMarks(canvas, frame, scene.things, outlineOf, {
          ...options,
          figures: figured.figures,
          sprites: figured.sprites,
        });
  // lines of the caller's own (a trigger to the monster seen from it), over everything
  for (const each of options.lines ?? []) {
    if (!Array.isArray(each?.from) || !Array.isArray(each?.to))
      throw new Error("lines: [{ from: [x, y], to: [x, y], colour: [r, g, b] }]");
    line(canvas, planPixel(frame, each.from), planPixel(frame, each.to), each.colour ?? LINE_COLOUR);
  }
  const kinds = Object.keys(MARK_COLOURS).filter((kind) => marks.some((mark) => mark.kind === kind));
  const words = cut === undefined ? "seen from above" : `cut at z ${cut}`;
  const bar = drawPlanFoot(canvas, frame, kinds, words);
  const notes = [...figured.notes, ...labelsNote(labels)];
  if (reach) notes.push(REACH_NOTE);
  if (scene.missing.size)
    notes.push(`${scene.missing.size} textures were found nowhere: their floors are a flat colour each`);
  if (!scene.lit) notes.push("the map has no light data: floors are shaded plainly");
  if (marks.length > LABELS_MOST && options.labels === undefined && !options.legend)
    notes.push(
      `${marks.length} entities are marked, too many to label: only the places to start are. \`area\` gives a closer look, and \`labels: true\` labels all that fit`,
    );
  const facts = {
    ...frameFacts(frame),
    z: cut ?? null,
    bar,
    marks,
    heights: heights.map(({ at, z }) => ({ z, at })),
    missing: [...scene.missing].sort(),
    notes,
  };
  const picture = pictureOf(canvas);
  return { ...(options.legend ? withLegend(picture, marks) : picture), facts };
}

/** A wall's line on a plan: drawn where no floor is more than a little above the wall's top. */
function wallLine(canvas, from, to, top) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))));
  for (let step = 0; step <= steps; step++) {
    const column = Math.round(from[0] + ((to[0] - from[0]) * step) / steps);
    const row = Math.round(from[1] + ((to[1] - from[1]) * step) / steps);
    if (column < 0 || row < 0 || column >= canvas.width || row >= canvas.height - PLAN_FOOT) continue;
    const at = row * canvas.width + column;
    // a pixel's nearness on a plan is minus the height of the floor drawn there
    if (-canvas.nearness[at] > top + LINE_COVER) continue;
    canvas.rgba.set(PLAN_COLOURS.wall, at * 4);
  }
}

// ── brush source ────────────────────────────────────────────────────────────
/** A brush's faces as surfaces of one colour each, by the name of the texture; the tools' faces left out. */
function sourceSurfaces(brush, sky) {
  const surfaces = [];
  for (const face of shapeOf(brush).faces) {
    if (!face.normal || !(face.area > 0)) continue;
    const kind = textureKind(face.texture);
    if (kind.tool) continue;
    surfaces.push({
      polygon: face.polygon,
      normal: face.normal,
      dist: face.dist,
      sAxis: NO_AXIS,
      tAxis: NO_AXIS,
      texture: flatTexture(
        face.texture,
        kind.sky ? sky : kind.water ? PLAN_COLOURS.water : colourOfName(face.texture),
      ),
      light: null,
      shade: kind.sky ? 1 : shadeOf(face.normal),
      kind: kind.sky ? "sky" : kind.water ? "liquid" : "face",
      holes: kind.holes,
    });
  }
  return surfaces;
}

/** Brush source made ready: its entities, the world's surfaces, and each drawn brush entity's. */
function sourceScene(map, sky = SKY_COLOUR) {
  if (!map || !Array.isArray(map.brushes))
    throw new Error(
      "the map's source is { worldspawn, brushes, entities }: what `writeMap` takes and `readMap` gives",
    );
  const things = thingsOfSource(map);
  const world = map.brushes.flat().flatMap((brush) => sourceSurfaces(brush, sky));
  const others = things
    .filter((thing) => thing.model !== null && !thing.look.hidden)
    .map((thing) => ({ thing, surfaces: thing.brushes.flatMap((brush) => sourceSurfaces(brush, sky)) }));
  return { things, world, others };
}

/**
 * A view of a map that is only SOURCE: brushes and entities as `writeMap` takes them (or `readMap` gives),
 * with no compile. Each face is one flat colour, chosen by its texture's name and shaded by the way it
 * looks, with its edges drawn darker: the shapes, the openings and where things stand are true; the textures' pictures and the light are
 * not there yet. A `{` texture on a brush entity whose render mode is 4 is drawn as a mesh that lets what is behind it show; sky is the sky's colour;
 * the compilers' own textures (clip, origin, hint, null, aaatrigger) are left out, and so are triggers.
 *
 *   from, to, yaw, pitch, fov, width, height, entities, labels, bodies, models, folders, sky   as `drawMap`
 *   takes them; without `from`, the first place to start. `entities` is "all" unless told: every point
 *   entity is drawn, those that stand as the box they move with, the others as a small box.
 *
 * Returns `{ width, height, rgba, facts }`: `facts` has `from`, `yaw`, `pitch`, `fov`, `faces`, `pixels`,
 * `textures` (the names and the colour each was drawn in), `marked` and `notes`.
 */
export function drawSource(map, options = {}) {
  options = withMod(options, map); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const width = sideOf(options.width, VIEW_WIDTH, "width");
  const height = sideOf(options.height, VIEW_HEIGHT, "height");
  const scene = sourceScene(map, options.sky);
  let stand = options;
  if (!options.from) {
    const start = firstStart(scene.things);
    if (!start) throw new Error("drawSource: the map has no place to start: give `from`");
    stand = { ...options, ...viewFrom(map, start.number), ...definedOnly(options) };
  }
  const view = cameraOf(stand, width, height);
  const canvas = newCanvas(width, height, NOTHING);
  const table = lightTable(BRIGHTNESS);
  let faces = 0;
  const later = [];
  const draw = (surface, look) => {
    const paint = {
      alpha: look.alpha,
      additive: look.additive,
      stipple: surface.holes && Boolean(look.holes),
      outline: OUTLINE_SHARE,
    };
    if (surface.kind === "liquid") paint.alpha = Math.min(paint.alpha, LIQUID_ALPHA);
    if (paint.alpha < 1 || paint.additive) {
      later.push({ surface, shift: NO_SHIFT, paint });
      return;
    }
    if (fill(canvas, view, surface, NO_SHIFT, paint, table)) faces++;
  };
  const plain = { alpha: 1, additive: false, holes: false };
  for (const surface of scene.world) draw(surface, plain);
  for (const { thing, surfaces } of scene.others) for (const surface of surfaces) draw(surface, thing.look);
  const figured = figuresOf(scene.things, options);
  const sprited = spritesOf(scene.things, options);
  const marked = drawMarks(
    canvas,
    view,
    markedThings(scene.things, options.entities ?? "all", figured.figures, sprited.sprites),
    table,
    { labels: options.labels, figures: figured.figures, sprites: sprited.sprites, lightAt: null, later },
  );
  faces += drawLater(canvas, view, later, table);
  const names = [
    ...new Set(
      [...scene.world, ...scene.others.flatMap((each) => each.surfaces)].map(
        (surface) => surface.texture.name,
      ),
    ),
  ];
  const facts = {
    from: view.eye,
    yaw: view.yaw,
    pitch: view.pitch,
    fov: view.fov,
    faces,
    pixels: shareDrawn(canvas),
    light: "none",
    textures: names.sort().map((name) => ({ name, colour: colourOfName(name) })),
    marked,
    notes: [
      "source, not compiled: each face is one flat colour by its texture's name, shaded by the way it looks; no texture's picture and no light",
      ...marksNote(marked),
      ...figured.notes,
      ...sprited.notes,
    ],
  };
  return { ...pictureOf(canvas), facts };
}

/** The height a source plan is cut at unless told: a place to start's, or the middle of the brushes. */
function cutHeightOf(things, min, max) {
  const start = firstStart(things);
  if (start) return start.origin[2];
  return (min[2] + max[2]) / 2;
}

/**
 * The plan of a map that is only SOURCE: a cut through its brushes at a height, seen from above, with the
 * floors under the cut in a colour for each texture name, and the entities marked as `planOf` marks them.
 * A brush of the world is solid where it is cut (liquids and sky in colours of their own; the compilers'
 * clip, hint and origin brushes are nothing); a brush entity is outlined, not filled.
 *
 *   z              the height of the cut. Without it: that of the first place to start (a player's middle,
 *                  36 over its floor), so that doorways are open and steps are not walls
 *   scale, width, height, area, entities, labels, legend, heights, reach, only, bodies, models,
 *   folders        as `planOf` takes them
 *
 * Returns `{ width, height, rgba, facts }`, `facts` as `planOf` gives (no `missing`).
 */
export function planOfSource(map, options = {}) {
  options = withMod(options, map); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const scene = sourceScene(map);
  const shapes = map.brushes.flat().map((brush) => ({ brush, shape: shapeOf(brush) }));
  const sound = shapes.filter(({ shape }) => shape.corners.length && Number.isFinite(shape.volume));
  if (!sound.length) throw new Error("planOfSource: the map has no brush of the world to draw");
  const min = [0, 1, 2].map((axis) => Math.min(...sound.map(({ shape }) => shape.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...sound.map(({ shape }) => shape.max[axis])));
  const frame = planFrame(min, max, options);
  const cut = options.z ?? cutHeightOf(scene.things, min, max);
  if (!Number.isFinite(cut)) throw new Error(`z: a height in units, not ${cut}`);
  const view = { ...frame, least: -cut };
  const canvas = newCanvas(frame.width, frame.height, PLAN_COLOURS.rock);
  const table = lightTable(BRIGHTNESS);
  for (const surface of scene.world)
    if (surface.kind === "face") fill(canvas, view, surface, [0, 0, 0], {}, table);
  for (const { surfaces } of scene.others)
    for (const surface of surfaces)
      if (surface.kind === "face" && !surface.holes) fill(canvas, view, surface, [0, 0, 0], {}, table);

  const cutMask = new Uint8Array(frame.width * frame.height);
  const reach = reachFor(map, options);
  // the cut: each brush of the world fills the pixels whose point at the cut's height is inside it
  for (const { brush, shape } of sound) {
    if (shape.min[2] > cut || shape.max[2] < cut) continue;
    const kind = textureKind(brush.faces[0].texture);
    if (kind.tool && brush.faces[0].texture.toLowerCase() !== "null") continue;
    const planes = shape.faces.filter((face) => face.normal);
    const [left, top] = planPixel(frame, [shape.min[0], shape.max[1]]);
    const [right, bottom] = planPixel(frame, [shape.max[0], shape.min[1]]);
    for (let row = Math.max(0, top - 1); row <= Math.min(frame.height - PLAN_FOOT - 1, bottom + 1); row++)
      for (let column = Math.max(0, left - 1); column <= Math.min(frame.width - 1, right + 1); column++) {
        const point = [frame.x0 + (column + 0.5) / frame.scale, frame.y0 - (row + 0.5) / frame.scale, cut];
        if (!planes.every((plane) => dot(plane.normal, point) <= plane.dist)) continue;
        const at = row * frame.width + column;
        if (!kind.water) cutMask[at] = 1;
        if (kind.sky) canvas.rgba.set(PLAN_COLOURS.sky, at * 4);
        else if (kind.water) tint(canvas, at, PLAN_COLOURS.water, 0.5);
        else canvas.rgba.set(PLAN_COLOURS.solid, at * 4);
      }
  }
  if (reach) drawReach(canvas, frame, reach, cut, cutMask);
  const heights = options.heights ? floorHeights(canvas, frame.height - PLAN_FOOT, cutMask) : [];
  if (options.grid) drawGrid(canvas, frame, options.grid, PLAN_FOOT);
  writeHeights(canvas, heights);

  const outlineOf = (thing) =>
    thing.brushes.flatMap((brush) =>
      shapeOf(brush)
        .faces.map((face) => face.polygon)
        .filter((polygon) => polygon.length >= 3),
    );
  const figured = figuresOf(scene.things, options);
  const sprited = spritesOf(scene.things, options);
  const { marks, labels } =
    options.entities === false
      ? { marks: [], labels: { shortened: 0, left: 0 } }
      : drawPlanMarks(canvas, frame, scene.things, outlineOf, {
          ...options,
          figures: figured.figures,
          sprites: sprited.sprites,
        });
  for (const each of options.lines ?? []) {
    if (!Array.isArray(each?.from) || !Array.isArray(each?.to))
      throw new Error("lines: [{ from: [x, y], to: [x, y], colour: [r, g, b] }]");
    line(canvas, planPixel(frame, each.from), planPixel(frame, each.to), each.colour ?? LINE_COLOUR);
  }
  const kinds = Object.keys(MARK_COLOURS).filter((kind) => marks.some((mark) => mark.kind === kind));
  const bar = drawPlanFoot(canvas, frame, kinds, `source  cut at z ${cut}`);
  const facts = {
    ...frameFacts(frame),
    z: cut,
    bar,
    marks,
    heights: heights.map(({ at, z }) => ({ z, at })),
    notes: [
      "source, not compiled: floors are a flat colour by texture name; no light",
      ...figured.notes,
      ...sprited.notes,
      ...labelsNote(labels),
      ...(reach ? [REACH_NOTE] : []),
    ],
  };
  const picture = pictureOf(canvas);
  return { ...(options.legend ? withLegend(picture, marks) : picture), facts };
}

// ── several maps at one scale ───────────────────────────────────────────────
/** The box of a map's world, `{ min, max }`: a compiled map's own, or that of the source's sound brushes. */
function worldBoxOf(map) {
  if (isCompiled(map)) {
    const bounds = worldBounds(map);
    return { min: bounds.mins, max: bounds.maxs };
  }
  const shapes = (map.brushes ?? [])
    .flat()
    .map((brush) => shapeOf(brush))
    .filter((shape) => shape.corners.length && Number.isFinite(shape.volume));
  if (!shapes.length) return null;
  return {
    min: [0, 1, 2].map((axis) => Math.min(...shapes.map((shape) => shape.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...shapes.map((shape) => shape.max[axis]))),
  };
}

/**
 * Several maps from above in ONE picture and at ONE scale, side by side: the picture that shows whether a
 * new map is the size of one the game has, which two plans each fitted to its own picture never do. Over
 * each plan stand its name and the size of its world; under them all, one scale bar.
 *
 *   list      the maps, each a compiled map or brush source, or `{ map, name, z, slice, area, only,
 *             heights, reach }` with what its own plan takes: `z` above all, the height ITS plan is cut at
 *             (a map under one roof is cut under it, a map whose rooms have no roof over them is seen
 *             from above). A name stands over its plan (`map 1`, `map 2` ... without one)
 *   scale     pixels a unit, for all of them. Without it: the largest at which they all fit a picture
 *             1920 by 1080 (`width`, `height`: another)
 *   cols      how many plans in a row (all of them, unless told)
 *   entities  false (unless told): no entity is marked, since a plan this small is read for its shape.
 *             `"models"`, `"all"` and `labels` as `planOf` takes them
 *   and `light`, `brightness`, `textures`, `folders`, `mod`, `bodies` as `planOf` takes them, for every map.
 *
 * Returns `{ width, height, rgba, facts }`. `facts`: `{ scale, bar (the scale bar's length in units), maps:
 * [{ name, size: [x, y, z] (its world, in units), z (its cut, or null), left, top, width, height (where its
 * plan lies in the picture, in pixels), x0, y0 }], notes }`. A point (x, y) of a map is at pixel
 * (left + (x - x0) * scale, top + (y0 - y) * scale).
 */
export function compareOf(list, options = {}) {
  if (!Array.isArray(list) || !list.length)
    throw new Error("compareOf: a list of maps, each a compiled map, brush source or `{ map, name, z }`");
  const isMap = (map) => isCompiled(map) || Array.isArray(map?.brushes);
  const entries = list.map((each, nth) => {
    const entry = isMap(each) ? { map: each } : each;
    if (!isMap(entry?.map))
      throw new Error(
        `compareOf: entry ${nth + 1} is no map: a compiled map (what \`readBsp\` gives), brush source, or \`{ map, name, z }\` with one of them`,
      );
    const box = worldBoxOf(entry.map);
    if (!box) throw new Error(`compareOf: entry ${nth + 1} has no brush of the world to draw`);
    const { map, name = `map ${nth + 1}`, ...own } = entry;
    // what its plan shows: the part asked for, or all of its world
    const shown = own.area ?? box;
    const size = box.max.map((value, axis) => Math.round(value - box.min[axis]));
    // the words over its plan take room too: a plan narrower than they are is given their width
    const letters = Math.max(String(name).length, `${size.join(" x ")}  seen from above  source`.length);
    return {
      map,
      name: String(name),
      own,
      box,
      size,
      wide: shown.max[0] - shown.min[0],
      deep: shown.max[1] - shown.min[1],
      words: letters * LETTER_WIDE * 2 + 12,
    };
  });
  const { scale: asked, cols, width, height, legend: _legend, ...shared } = options;
  if (asked !== undefined && !(asked > 0)) throw new Error(`scale: pixels a unit, over 0, not ${asked}`);
  const columns = cols ?? entries.length;
  if (!Number.isInteger(columns) || columns < 1) throw new Error(`cols: a whole number from 1, not ${cols}`);
  const rows = [];
  for (let nth = 0; nth < entries.length; nth += columns) rows.push(entries.slice(nth, nth + columns));
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  // the largest scale at which every row fits across and the rows fit down
  const around = 2 * PLAN_MARGIN;
  const most = [sideOf(width, COMPARE_WIDE, "width"), sideOf(height, COMPARE_HIGH, "height")];
  const fitting = Math.min(
    ...rows.map(
      (row) =>
        (most[0] - row.length * around - (row.length - 1) * COMPARE_GAP) / sum(row.map((each) => each.wide)),
    ),
    (most[1] - PLAN_FOOT - rows.length * (around + COMPARE_HEAD)) /
      sum(rows.map((row) => Math.max(...row.map((each) => each.deep)))),
  );
  /** How wide the picture comes out at a scale: its widest row, each plan no narrower than its words. */
  const wideAt = (perUnit) =>
    Math.max(
      ...rows.map(
        (row) =>
          sum(row.map((each) => Math.max(each.wide * perUnit + around, each.words))) +
          (row.length - 1) * COMPARE_GAP,
      ),
    );
  let scale = asked ?? fitting;
  // where the words are wider than the plans, a smaller scale still, as far as that helps
  for (let tries = 0; asked === undefined && tries < 60 && scale > 0 && wideAt(scale) > most[0]; tries++)
    scale *= 0.96;
  if (!(scale > 0))
    throw new Error(
      `compareOf: ${entries.length} maps do not fit a picture ${most[0]} by ${most[1]}: a larger \`width\` and \`height\`, more \`cols\`, or a \`scale\``,
    );
  for (const each of entries)
    for (const [side, units] of [["wide", each.wide], ["deep", each.deep]]) // prettier-ignore
      if (units * scale + around + PLAN_FOOT > SIDE_MOST)
        throw new Error(
          `scale: at ${scale} pixels a unit ${each.name} (${Math.round(units)} units ${side}) would be ${Math.ceil(units * scale + around)} pixels, and a plan's side is ${SIDE_MOST} at the most: a smaller scale`,
        );

  // each plan at that scale, its own foot cut off: one bar under them all says the scale. With no entity
  // marked, no sprite is read for a mark either
  const unmarked = (shared.entities ?? false) === false ? { entities: false, sprites: false } : {};
  const plans = entries.map((each) => {
    const plan = (isCompiled(each.map) ? planOf : planOfSource)(each.map, {
      labels: false,
      ...shared,
      ...unmarked,
      ...each.own,
      scale,
      width: undefined,
      height: undefined,
      legend: false,
    });
    const cut = plan.facts.z === null ? "seen from above" : `cut at z ${plan.facts.z}`;
    const words = `${each.size.join(" x ")}  ${cut}${isCompiled(each.map) ? "" : "  source"}`;
    return {
      ...each,
      plan,
      words,
      high: plan.height - PLAN_FOOT,
      // a plan narrower than its own words is given their width
      cell: Math.max(plan.width, Math.max(each.name.length, words.length) * LETTER_WIDE * 2 + 12),
    };
  });
  const laid = [];
  let top = 0;
  let wide = 0;
  for (let nth = 0; nth < plans.length; nth += columns) {
    const row = plans.slice(nth, nth + columns);
    let left = 0;
    for (const each of row) {
      laid.push({ ...each, left, top: top + COMPARE_HEAD });
      left += each.cell + COMPARE_GAP;
    }
    wide = Math.max(wide, left - COMPARE_GAP);
    top += COMPARE_HEAD + Math.max(...row.map((each) => each.high)) + COMPARE_GAP;
  }
  const canvas = newCanvas(
    Math.max(wide, 2 * PLAN_MARGIN + BAR_MOST),
    top - COMPARE_GAP + PLAN_FOOT,
    [20, 22, 26],
  );
  for (const each of laid) {
    for (let row = 0; row < each.high; row++)
      canvas.rgba.set(
        each.plan.rgba.subarray(row * each.plan.width * 4, (row + 1) * each.plan.width * 4),
        ((each.top + row) * canvas.width + each.left) * 4,
      );
    label(canvas, each.name, each.left + 6, each.top - COMPARE_HEAD + 4, 2, PLAN_COLOURS.ink);
    label(canvas, each.words, each.left + 6, each.top - COMPARE_HEAD + 20, 2, HEIGHT_INK);
  }
  // the one scale: the longest round length that fits
  const bar = BAR_LENGTHS.filter((units) => units * scale <= BAR_MOST).at(-1) ?? BAR_LENGTHS[0];
  const barY = canvas.height - PLAN_FOOT + 24;
  const barEnd = PLAN_MARGIN + Math.round(bar * scale);
  line(canvas, [PLAN_MARGIN, barY], [barEnd, barY], PLAN_COLOURS.ink);
  line(canvas, [PLAN_MARGIN, barY - 4], [PLAN_MARGIN, barY + 4], PLAN_COLOURS.ink);
  line(canvas, [barEnd, barY - 4], [barEnd, barY + 4], PLAN_COLOURS.ink);
  label(
    canvas,
    `${bar} units  every map at ${Math.round(scale * 1000) / 1000} pixels a unit`,
    barEnd + 10,
    barY - 5,
    2,
    PLAN_COLOURS.ink,
  );
  const facts = {
    scale,
    bar,
    maps: laid.map((each) => ({
      name: each.name,
      size: each.size,
      z: each.plan.facts.z,
      left: each.left,
      top: each.top,
      width: each.plan.width,
      height: each.high,
      x0: each.plan.facts.x0,
      y0: each.plan.facts.y0,
    })),
    notes: [...new Set(laid.flatMap((each) => each.plan.facts.notes ?? []))],
  };
  return { ...pictureOf(canvas), facts };
}

// ── a side section ──────────────────────────────────────────────────────────
/** The stretch of a line (from `from`, along the unit `way`, `length` long) that is inside a box in plan. */
function alongInBox(from, way, length, min, max) {
  let enters = 0;
  let leaves = length;
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(way[axis]) < 1e-9) {
      if (from[axis] < min[axis] || from[axis] > max[axis]) return null;
      continue;
    }
    const a = (min[axis] - from[axis]) / way[axis];
    const b = (max[axis] - from[axis]) / way[axis];
    enters = Math.max(enters, Math.min(a, b));
    leaves = Math.min(leaves, Math.max(a, b));
  }
  return leaves > enters ? [enters, leaves] : null;
}

/** The solid pieces of a cut put in order, those that overlap or touch made one: `[[from, to]]`, upwards. */
function solidRuns(pieces) {
  const stops = pieces
    .filter((piece) => piece[2] !== "liquid")
    .map((piece) => [piece[0], piece[1]])
    .sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const stop of stops) {
    const last = runs.at(-1);
    if (last && stop[0] <= last[1] + 0.5) last[1] = Math.max(last[1], stop[1]);
    else runs.push(stop);
  }
  return runs;
}

/**
 * A side section of a map, brush source or compiled: an upright cut along the line from one point of the
 * plan to another, seen from its right-hand side going from `from` to `to` (a line running east is seen
 * looking north). What a plan cannot show is here: a cellar under a terrace, a stair's steps, a ceiling's
 * height, an entity that hangs or is sunk in the floor.
 *
 *   from, to       the two ends of the line, `[x, y]` (a third number is passed over)
 *   scale          pixels a unit; without it the line is fitted into `width` (1024)
 *   z              `[low, high]`: the heights shown; without it, from under the lowest open space the line
 *                  passes through to over the highest
 *   near           entities this near the line are drawn on it (64 units); false: none
 *   labels         false leaves the words out; `heights: false` the heights of the floors
 *   bodies         as `drawMap` takes it: an entity that stands is the outline of the box it moves with
 *   doors, open, shut   as `spaceOf` takes them
 *
 * Drawn: what is solid in one colour, sky and liquids in theirs, open space dark; a light line on every
 * floor, and its height (`z 64`) written under it where it runs far enough; the heights ticked down the
 * left edge; each brush entity the line passes through as the outline of its box; each point entity near
 * the line as a dot, and one that stands as its box at its true size.
 *
 * Returns `{ width, height, rgba, facts }`. `facts`: `{ from, to, length, looking (the yaw the cut is seen
 * along), scale, left, top, zTop, pixel (how a point finds its pixel), z: [low, high], floors: [{ z, from,
 * to }] (each floor's height and the stretch of the line it runs for), marks: [{ number, classname, kind,
 * along, z, at }], notes }`.
 */
export function sectionOf(map, options = {}) {
  options = withMod(options, map); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const ends = [options.from, options.to].map((end) =>
    Array.isArray(end) && end.length >= 2 && end.slice(0, 2).every(Number.isFinite) ? end.slice(0, 2) : null,
  );
  if (!ends[0] || !ends[1])
    throw new Error("sectionOf: `from` and `to`, the two ends of the line, [x, y] each");
  const [from, to] = ends;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(length > 0)) throw new Error("sectionOf: `from` and `to` are one point: a line has two ends");
  const way = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const space = spaceOf(map, options);
  const most = sideOf(options.width, SECTION_SIDE, "width");
  if (options.scale !== undefined && !(options.scale > 0))
    throw new Error(`scale: pixels a unit, over 0, not ${options.scale}`);
  let scale = options.scale ?? (most - SECTION_LEFT - SECTION_MARGIN) / length;
  const pointAt = (along) => [from[0] + way[0] * along, from[1] + way[1] * along];

  // the heights shown: from under the lowest open space on the line to over the highest
  let range = options.z;
  if (range !== undefined && !(Array.isArray(range) && range[1] > range[0]))
    throw new Error("z: [low, high], the heights shown, the second over the first");
  if (!range) {
    let low = Infinity;
    let high = -Infinity;
    for (let step = 0; step <= 256; step++) {
      const stops = solidRuns(space.cut(...pointAt((length * step) / 256)));
      for (let index = 0; index + 1 < stops.length; index++) {
        low = Math.min(low, stops[index][1]);
        high = Math.max(high, stops[index + 1][0]);
      }
    }
    range = low < high ? [low - 48, high + 32] : [space.min[2], space.max[2]];
  }
  const tall = range[1] - range[0];
  scale = Math.min(
    scale,
    (SIDE_MOST - SECTION_MARGIN - PLAN_FOOT) / tall,
    (SIDE_MOST - SECTION_LEFT - SECTION_MARGIN) / length,
  );
  const wide = Math.ceil(length * scale);
  const width = sideOf(SECTION_LEFT + wide + SECTION_MARGIN, undefined, "the section's width");
  const height = sideOf(
    SECTION_MARGIN + Math.ceil(tall * scale) + PLAN_FOOT,
    undefined,
    "the section's height",
  );
  const canvas = newCanvas(width, height, NOTHING);
  const bottom = height - PLAN_FOOT;
  const rowOf = (z) => SECTION_MARGIN + (range[1] - z) * scale;
  const columnOf = (along) => SECTION_LEFT + along * scale;
  const colours = { solid: PLAN_COLOURS.solid, sky: PLAN_COLOURS.sky, liquid: PLAN_COLOURS.water };

  // the cut, column by column; a floor is the top of something solid with room over it
  const floorsAt = [];
  for (let column = 0; column < wide; column++) {
    const pieces = space.cut(...pointAt((column + 0.5) / scale));
    const stops = solidRuns(pieces);
    for (const [low, high, kind] of pieces) {
      const first = Math.max(SECTION_MARGIN, Math.round(rowOf(high)));
      const last = Math.min(bottom, Math.round(rowOf(low)));
      for (let row = first; row < last; row++)
        canvas.rgba.set(colours[kind], (row * width + SECTION_LEFT + column) * 4);
    }
    const floors = [];
    stops.forEach((piece, index) => {
      const above = stops[index + 1];
      // the top of the world has no room over it: it is the outside
      if (!above || above[0] - piece[1] < BODIES.crouching.height) return;
      if (piece[1] <= range[0] || piece[1] >= range[1]) return;
      floors.push(piece[1]);
      const row = Math.round(rowOf(piece[1]));
      if (row >= SECTION_MARGIN && row < bottom)
        canvas.rgba.set(PLAN_COLOURS.wall, (row * width + SECTION_LEFT + column) * 4);
    });
    floorsAt.push(floors);
  }
  // each floor's stretch of the line, and its height written under it
  const floors = [];
  const open = new Map();
  for (let column = 0; column <= wide; column++) {
    const here = new Set((floorsAt[column] ?? []).map((z) => Math.round(z)));
    for (const [z, begin] of open) {
      if (here.has(z)) continue;
      open.delete(z);
      floors.push({
        z,
        from: Math.round(begin / scale),
        to: Math.round(column / scale),
        pixels: [begin, column],
      });
    }
    for (const z of here) if (!open.has(z)) open.set(z, column);
  }
  floors.sort((a, b) => a.from - b.from || b.z - a.z);
  if (options.heights !== false)
    writeHeights(
      canvas,
      floors
        .filter((floor) => floor.pixels[1] - floor.pixels[0] >= FLOOR_RUN_LEAST)
        .sort((a, b) => b.pixels[1] - b.pixels[0] - (a.pixels[1] - a.pixels[0]))
        .map((floor) => ({
          at: [
            SECTION_LEFT + Math.round((floor.pixels[0] + floor.pixels[1]) / 2),
            Math.round(rowOf(floor.z)) + 8,
          ],
          words: `z ${floor.z}`,
        }))
        .filter((each) => each.at[1] < bottom - 6),
    );

  // the heights down the left edge
  const step = TICK_STEPS.find((each) => each * scale >= TICK_APART) ?? TICK_STEPS.at(-1);
  for (let z = Math.ceil(range[0] / step) * step; z <= range[1]; z += step) {
    const row = Math.round(rowOf(z));
    if (row < SECTION_MARGIN || row >= bottom) continue;
    line(canvas, [SECTION_LEFT - 5, row], [SECTION_LEFT - 1, row], PLAN_COLOURS.ink);
    label(canvas, String(z), 2, row - 3, 1, PLAN_COLOURS.ink);
  }

  // the entities: brush entities the line passes through, point entities near it
  const things = isCompiled(map) ? thingsOfBsp(map) : thingsOfSource(map);
  const { figures } = figuresOf(things, { bodies: options.bodies });
  const near = options.near === false ? -1 : (options.near ?? SECTION_NEAR);
  const marks = [];
  const wanted = [];
  const rectangle = (alongs, heights, colour) => {
    const [left, right] = alongs.map((along) => Math.round(columnOf(along)));
    const [down, up] = heights.map((z) => Math.round(rowOf(z)));
    for (const [
      a,
      b,
    ] of [
      [[left, up], [right, up]],
      [[right, up], [right, down]],
      [[right, down], [left, down]],
      [[left, down], [left, up]],
    ]) // prettier-ignore
      line(canvas, a, b, colour);
  };
  const inPicture = (at) =>
    at[0] >= SECTION_LEFT && at[0] < width && at[1] >= SECTION_MARGIN && at[1] < bottom;
  if (near >= 0) {
    for (const area of space.areas) {
      const thing = things.find((each) => each.number === area.number);
      const inside = alongInBox(from, way, length, area.min, area.max);
      if (!thing || !inside || area.max[2] < range[0] || area.min[2] > range[1]) continue;
      rectangle(inside, [area.min[2], area.max[2]], MARK_COLOURS[thing.kind]);
      const along = (inside[0] + inside[1]) / 2;
      const z = (area.min[2] + area.max[2]) / 2;
      const at = [Math.round(columnOf(along)), Math.round(rowOf(z))];
      marks.push({
        number: thing.number,
        classname: thing.classname,
        kind: thing.kind,
        along: Math.round(along),
        z: Math.round(z),
        at,
      });
      wanted.push({ at, words: `${thing.number} ${thing.classname}`, short: String(thing.number), order: 2 });
    }
    for (const thing of things) {
      if (thing.model !== null || !thing.origin) continue;
      const offset = [thing.origin[0] - from[0], thing.origin[1] - from[1]];
      const along = offset[0] * way[0] + offset[1] * way[1];
      const aside = Math.abs(offset[0] * way[1] - offset[1] * way[0]);
      if (aside > near || along < 0 || along > length) continue;
      const at = [Math.round(columnOf(along)), Math.round(rowOf(thing.origin[2]))];
      if (!inPicture(at)) continue;
      const figure = figures.get(thing.number);
      if (figure) {
        const half = (figure.max[0] - figure.min[0]) / 2;
        rectangle([along - half, along + half], [figure.min[2], figure.max[2]], MARK_COLOURS[thing.kind]);
      }
      drawDot(canvas, at, DOT_RADIUS, MARK_COLOURS[thing.kind]);
      marks.push({
        number: thing.number,
        classname: thing.classname,
        kind: thing.kind,
        along: Math.round(along),
        z: thing.origin[2],
        at,
      });
      const order = { start: 0, monster: 1, other: 4, light: 5 }[thing.kind] ?? 3;
      wanted.push({ at, words: `${thing.number} ${thing.classname}`, short: String(thing.number), order });
    }
  }
  const labels =
    options.labels === false ? { shortened: 0, left: 0 } : writeLabels(canvas, wanted, { bottom });

  // the foot: the scale, and what the cut is
  for (let row = bottom; row < height; row++)
    for (let column = 0; column < width; column++)
      canvas.rgba.set([20, 22, 26, 255], (row * width + column) * 4);
  const bar = BAR_LENGTHS.filter((units) => units * scale <= BAR_MOST).at(-1) ?? BAR_LENGTHS[0];
  const barY = bottom + 30;
  const barEnd = SECTION_LEFT + Math.round(bar * scale);
  line(canvas, [SECTION_LEFT, barY], [barEnd, barY], PLAN_COLOURS.ink);
  line(canvas, [SECTION_LEFT, barY - 4], [SECTION_LEFT, barY + 4], PLAN_COLOURS.ink);
  line(canvas, [barEnd, barY - 4], [barEnd, barY + 4], PLAN_COLOURS.ink);
  const looking = Math.round(Math.atan2(way[0], -way[1]) / DEGREES);
  label(
    canvas,
    `${bar} units  section  seen looking yaw ${looking}`,
    barEnd + 10,
    barY - 5,
    2,
    PLAN_COLOURS.ink,
  );
  label(
    canvas,
    `from ${pointText(from)} (left) to ${pointText(to)} (right)  +z up  heights at the left edge`,
    SECTION_LEFT,
    bottom + 8,
    1,
    PLAN_COLOURS.ink,
  );
  const facts = {
    from,
    to,
    length: Math.round(length),
    looking,
    scale,
    left: SECTION_LEFT,
    top: SECTION_MARGIN,
    zTop: range[1],
    pixel:
      "a point `along` the line at height z is at pixel (left + along * scale, top + (zTop - z) * scale)",
    z: range,
    bar,
    floors: floors.map(({ z, from: begin, to: end }) => ({ z, from: begin, to: end })),
    marks,
    notes: [
      "a side section: solid in one colour, open space dark, a light line on each floor with its height under it",
      ...labelsNote(labels),
    ],
  };
  return { ...pictureOf(canvas), facts };
}

// ── the storeys side by side ────────────────────────────────────────────────
/**
 * The storeys of a map side by side, brush source or compiled: one plan for each, cut at its own height,
 * with every floor's height written on it. A map with a cellar under a terrace is one picture.
 *
 *   z              the heights to cut at, a list; without it they are found (`storeyCuts`): the fewest cuts
 *                  that show every floor a player fits on, each 36 over the highest floor it is made for
 *   width, height  one plan (640 x 640 at the most); `cols`: plans in a row (3 at the most)
 *   and what `planOf` and `planOfSource` take (`area`, `labels`, `reach`, `bodies`, `folders` ...).
 *
 * An entity is marked on the plan of the storey it is in: the highest cut that the open space over (or
 * under) it reaches; one that is in no storey's space is marked on the nearest.
 *
 * Returns `{ width, height, rgba, facts }`. `facts`: `{ storeys: [{ z, floors: [lowest, highest], area,
 * left, top (where its plan begins in the picture), scale, x0, y0, marks }], notes }`.
 */
export function storeysOf(map, options = {}) {
  options = withMod(options, map); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const compiled = isCompiled(map);
  const asked = options.z === undefined ? null : Array.isArray(options.z) ? options.z : [options.z];
  if (asked && !asked.every(Number.isFinite))
    throw new Error(`z: heights to cut at, a list of numbers, not ${options.z}`);
  const cuts = asked
    ? [...asked].sort((a, b) => b - a).map((z) => ({ z, floors: null, area: null }))
    : storeyCuts(map, { doors: options.doors });
  if (!cuts.length)
    throw new Error("storeysOf: no floor a player fits on was found: give `z`, the heights to cut at");
  // which storey each entity is in: the highest cut that open space joins it to
  const space = spaceOf(map, options);
  const things = compiled ? thingsOfBsp(map) : thingsOfSource(map);
  const areas = new Map(space.areas.map((area) => [area.number, area]));
  const storeyOf = (thing) => {
    const area = areas.get(thing.number);
    const at = area ? area.min.map((value, axis) => (value + area.max[axis]) / 2) : thing.origin;
    if (!at) return -1;
    const joined = cuts.findIndex((cut) => space.sees(at, [at[0], at[1], cut.z]));
    if (joined >= 0) return joined;
    return cuts.reduce(
      (best, cut, index) => (Math.abs(cut.z - at[2]) < Math.abs(cuts[best].z - at[2]) ? index : best),
      0,
    );
  };
  const inStorey = cuts.map(() => []);
  for (const thing of things) {
    const storey = thing.number === 0 ? -1 : storeyOf(thing);
    if (storey >= 0) inStorey[storey].push(thing.number);
  }
  const side = { width: options.width ?? STOREY_SIDE, height: options.height ?? STOREY_SIDE };
  const plans = cuts.map((cut, index) => {
    const each = { heights: true, ...options, ...side, z: cut.z, only: inStorey[index], legend: false };
    return compiled ? planOf(map, each) : planOfSource(map, each);
  });
  const names = cuts.map((cut) =>
    cut.floors ? `z ${cut.z}  floors ${cut.floors[0]} to ${cut.floors[1]}` : `z ${cut.z}`,
  );
  const columns = options.cols ?? Math.min(3, plans.length);
  if (!Number.isInteger(columns) || columns < 1)
    throw new Error(`cols: a whole number from 1, not ${columns}`);
  const picture = tile(plans, columns, names);
  const facts = {
    storeys: cuts.map((cut, index) => ({
      z: cut.z,
      floors: cut.floors,
      area: cut.area,
      left: (index % columns) * plans[0].width,
      top: Math.floor(index / columns) * plans[0].height,
      scale: plans[index].facts.scale,
      x0: plans[index].facts.x0,
      y0: plans[index].facts.y0,
      marks: plans[index].facts.marks,
    })),
    notes: [
      `${cuts.length} storeys, the highest first: each plan is cut at its own height and marks the entities of its own storey; a point finds its pixel in a plan as on \`planOf\`, counted from the plan's \`left\` and \`top\``,
      ...new Set(plans.flatMap((plan) => plan.facts.notes)),
    ],
  };
  return { ...picture, facts };
}

// ── a view through each opening ─────────────────────────────────────────────
/**
 * A view through each gate and doorway of a map, in one picture: the walk test finds the openings
 * (`reachOf`), and each is looked through from the floor before it, at the height of a player's eyes,
 * towards the floor behind it. Brush source or a compiled map.
 *
 *   reach          what `reachOf` gave for this map; without it, it is run now (with `bodies` and `doors`)
 *   count          how many openings at the most (12), the nearest the places to start first
 *   both           true: each opening from both its sides
 *   width, height  one cell (320 x 240); `cols` cells in a row (4)
 *   and what `drawMap` or `drawSource` takes (light, brightness, folders, entities, fov ...).
 *
 * Returns `{ width, height, rgba, facts }`; `facts.views` is `[{ name, opening, wide, high, from, to, yaw,
 * faces }]`. It throws, in words, when the walked floor has no opening.
 */
export function openingViews(map, options = {}) {
  options = withMod(options, map); // a mod's profile: its folders, its classes' boxes (mod.mjs)
  const compiled = isCompiled(map);
  const reach = options.reach && options.reach !== true ? options.reach : reachOf(map, options);
  const count = options.count ?? OPENINGS_MOST;
  if (!Number.isInteger(count) || count < 1) throw new Error(`count: a whole number from 1, not ${count}`);
  const openings = reach.openings.slice(0, count);
  if (!openings.length)
    throw new Error(
      "openingViews: the walk test found no opening on the walked floor (a narrow place between two roomier ones): nothing to look through",
    );
  const width = sideOf(options.width, CELL_WIDTH, "width");
  const height = sideOf(options.height, CELL_HEIGHT, "height");
  const eyes = (point) => [point[0], point[1], point[2] + EYE_OVER_FLOOR];
  const stands = openings.flatMap((opening) => {
    const size = `${opening.width}x${opening.height ?? "open"}`;
    const ways = options.both ? [[0, 1], [1, 0]] : [[0, 1]]; // prettier-ignore
    return ways.map(([before, behind]) => ({
      opening,
      from: eyes(opening.sides[before]),
      to: eyes(opening.sides[behind]),
      name: `o${opening.number} ${size} from ${pointText(opening.sides[before])}`,
    }));
  });
  const drawn = stands.map((stand) => {
    const each = { ...options, reach: undefined, from: stand.from, to: stand.to, width, height };
    return compiled ? drawMap(map, each) : drawSource(map, each);
  });
  const columns = options.cols ?? Math.min(VIEWS_COLUMNS, stands.length);
  const picture = tile(
    drawn,
    columns,
    stands.map((stand) => stand.name),
  );
  const facts = {
    views: stands.map((stand, index) => ({
      name: stand.name,
      opening: stand.opening.number,
      wide: stand.opening.width,
      high: stand.opening.height,
      from: stand.from,
      to: stand.to,
      yaw: drawn[index].facts.yaw,
      faces: drawn[index].facts.faces,
    })),
    notes: [
      `${openings.length} of the ${reach.openings.length} openings the walk test found, each looked through from the floor before it at a player's eyes`,
      ...(compiled ? viewsNotes(drawn.map((each) => each.facts)) : []),
    ],
  };
  return { ...picture, facts };
}
