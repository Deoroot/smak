// A map from a drawing: a plan a person sketches (in Inkscape as an SVG, or in Paint as a PNG of flat
// colours) read as spaces with floors and ceilings, and carved as ground.mjs carves them.
//
// What each shape is comes from three places, the later winning:
//   the legend's `colours`   by the shape's colour: { "#c0c0c0": { floor: 0, ceiling: 256 } }
//   the legend's `names`     by the first word of its label: { "plaza": { floor: 0, ceiling: "sky" } }
//   its label                words such as "hall floor=0 ceiling=256 light=200" (in Inkscape the object's
//                            label, or its id); a group's or a layer's label is given to all in it, so a
//                            layer named "floor=128 height=192" is a storey
// The keys: `floor`, `ceiling` (a height, or "sky": open to the sky, the highest ceiling's height and a
// little over), `height` (the ceiling over the floor), `texture` ({ floor, ceiling, wall } or one name),
// `light` (a lamp's brightness in the space's middle) and `kind`: "space" (the default), "start" (a place
// for players to start, at the shape's middle, with `yaw`), "light" (a lamp at the shape's middle at
// `z`), "pool" (sunk in the floor of the space it is drawn in, with water), or "skip" (a shape drawn for the
// person: notes, arrows).
//
// In an SVG a filled shape is a space of its outline (a path with holes keeps them); a line or a path with
// no fill and a stroke is a corridor of the stroke's width along it. One unit of the drawing is one unit
// of the map unless `scale` says otherwise; +y of the map is up the drawing.
//
// In a PNG each colour of the legend is a space (every patch of it); white, black and colours the legend
// does not name are rock. Paint's outlines (a black line between two rooms) are walls. One pixel is
// `scale` units (8 unless told: a picture 512 wide is a map 4096 wide).
import { unpng } from "../image.mjs";
import { carvePlan, convexPieces, path, pointIn, planSpace, spaceAt, slopePlane } from "./ground.mjs";
import { spiralStairs, bridge, rockWall, cliffWall, mergeMaps } from "./pieces.mjs";
import { light, playerStart, sunLight, brushEntity, prism, STEP_HEIGHT } from "./source.mjs";
import { reliefOf } from "./relief.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** Points a curve of a drawing is cut into, for each curve. */
const CURVE_PIECES = 8;
/** Corners a drawn circle or ellipse is given. */
const CIRCLE_SIDES = 16;
/** How far a traced outline may stray from the pixels' edge, in pixels, when it is made straight. */
const TRACE_TOLERANCE = 1.5;
/** How near a pixel's colour is to a legend's colour to be it (the largest of the three differences). */
const COLOUR_NEAR = 24;
/** A ceiling of "sky" is this far over the highest floor or ceiling given. */
const SKY_OVER = 128;
/** A spiral stair's shaft is this high over its top, and its steps reach this far into the shaft's wall (no gap). */
const SPIRAL_HEADROOM = 128;
const SPIRAL_INTO = 8;
/** A spiral's top lands on a door or a floor at its height this far beyond the shaft at most, by a bridge this wide. */
const LANDING_REACH = 64;
const LANDING_WIDTH = 64;
/** A pool is this deep unless told; its water stops this far under the floor; its kerb is this wide. */
const POOL_DEPTH = 48;
const WATER_UNDER = 8;
const RIM_WIDTH = 16;
/** A space under the sky this many times longer than wide is a street, whose ends are to open somewhere. */
const STREET_RATIO = 3;
/** Rough rock is laid along a side this long or longer, in stretches of this. */
const ROUGH_LEAST = 16;
/** A lamp hangs this far under its ceiling. */
const LAMP_UNDER = 24;

// ── what a shape is ─────────────────────────────────────────────────────────
/** The words of a label as `{ name, ...keys }`: "hall floor=0 ceiling=256" → { name: "hall", floor: 0, ceiling: 256 }. */
export function labelKeys(label) {
  const keys = {};
  for (const word of String(label ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const at = word.indexOf("=");
    if (at < 0) {
      keys.name ??= word;
      continue;
    }
    const key = word.slice(0, at);
    const text = word.slice(at + 1);
    keys[key] = text !== "" && Number.isFinite(Number(text)) ? Number(text) : text;
  }
  return keys;
}

/** A colour as "#rrggbb", from "#rgb", "#rrggbb", "rgb(r, g, b)" or [r, g, b]; null for none. */
export function colourText(colour) {
  if (colour === undefined || colour === null) return null;
  if (Array.isArray(colour))
    return "#" + colour.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
  const text = String(colour).trim().toLowerCase();
  if (!text || text === "none" || text === "transparent") return null;
  let match = text.match(/^#([0-9a-f]{3})$/);
  if (match) return "#" + [...match[1]].map((c) => c + c).join("");
  match = text.match(/^#([0-9a-f]{6})$/);
  if (match) return text;
  match = text.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (match) return colourText(match.slice(1, 4).map(Number));
  const named = { black: "#000000", white: "#ffffff", red: "#ff0000", lime: "#00ff00", blue: "#0000ff", gray: "#808080", grey: "#808080" }; // prettier-ignore
  return named[text] ?? null;
}

// ── SVG ─────────────────────────────────────────────────────────────────────
/** The attributes of a tag's text. */
function attributesOf(text) {
  const found = {};
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    found[match[1]] = match[2] ?? match[3];
  return found;
}

/** An SVG transform as a matrix [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f). */
const IDENTITY = [1, 0, 0, 1, 0, 0];
const times = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function transformOf(text) {
  let matrix = IDENTITY;
  for (const match of String(text ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = match[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const radians = ((n[0] ?? 0) * Math.PI) / 180;
    let step;
    switch (match[1]) {
      case "matrix":
        step = n.slice(0, 6);
        break;
      case "translate":
        step = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
        break;
      case "scale":
        step = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
        break;
      case "rotate": {
        const turn = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
        const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
        step = times(times([1, 0, 0, 1, cx, cy], turn), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        step = [1, 0, Math.tan(radians), 1, 0, 0];
        break;
      case "skewY":
        step = [1, Math.tan(radians), 0, 1, 0, 0];
        break;
      default:
        throw new Error(`a transform the sketch does not know: ${match[1]}`);
    }
    matrix = times(matrix, step);
  }
  return matrix;
}

/** The points of an arc of an SVG path (its endpoint form), after its start. */
function arcPoints(from, rx, ry, turnDegrees, large, sweep, to) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [to];
  const phi = (turnDegrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const top = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const bottom = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / bottom));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (u, v) => Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  const start = angle([1, 0], [(x1 - cx1) / rx, (y1 - cy1) / ry]);
  let span = angle([(x1 - cx1) / rx, (y1 - cy1) / ry], [(-x1 - cx1) / rx, (-y1 - cy1) / ry]);
  if (!sweep && span > 0) span -= 2 * Math.PI;
  if (sweep && span < 0) span += 2 * Math.PI;
  const count = Math.max(2, Math.ceil((Math.abs(span) / (Math.PI / 2)) * (CIRCLE_SIDES / 4)));
  const points = [];
  for (let i = 1; i <= count; i++) {
    const t = start + (span * i) / count;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    points.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  points[points.length - 1] = [...to];
  return points;
}

/** An SVG path's `d` as its pieces: [{ points, closed }]. */
function pathPieces(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const pieces = [];
  let current = null;
  let at = [0, 0];
  let start = [0, 0];
  let lastControl = null;
  let command = null;
  let i = 0;
  const number = () => {
    const value = Number(tokens[i++]);
    if (!Number.isFinite(value)) throw new Error(`a path's numbers run short after "${command}"`);
    return value;
  };
  const begin = (point) => {
    current = { points: [point], closed: false };
    pieces.push(current);
  };
  const lineTo = (point) => {
    if (!current) begin(at);
    current.points.push(point);
  };
  const bezier = (controls, to) => {
    const all = [at, ...controls, to];
    for (let step = 1; step <= CURVE_PIECES; step++) {
      const t = step / CURVE_PIECES;
      let row = all;
      while (row.length > 1)
        row = row
          .slice(1)
          .map((point, k) => [
            row[k][0] + (point[0] - row[k][0]) * t,
            row[k][1] + (point[1] - row[k][1]) * t,
          ]);
      lineTo(row[0]);
    }
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    else if (!command) throw new Error("a path that does not start with a command");
    const relative = command === command.toLowerCase() && command.toLowerCase() !== "z";
    const base = relative ? at : [0, 0];
    const point = () => {
      const x = number();
      const y = number();
      return [base[0] + x, base[1] + y];
    };
    switch (command.toLowerCase()) {
      case "m":
        at = point();
        start = at;
        begin(at);
        command = relative ? "l" : "L";
        lastControl = null;
        break;
      case "l":
        at = point();
        lineTo(at);
        lastControl = null;
        break;
      case "h":
        at = [(relative ? at[0] : 0) + number(), at[1]];
        lineTo(at);
        lastControl = null;
        break;
      case "v":
        at = [at[0], (relative ? at[1] : 0) + number()];
        lineTo(at);
        lastControl = null;
        break;
      case "c": {
        const c1 = point();
        const c2 = point();
        const to = point();
        bezier([c1, c2], to);
        at = to;
        lastControl = c2;
        break;
      }
      case "s": {
        const c1 = lastControl ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]] : at;
        const c2 = point();
        const to = point();
        bezier([c1, c2], to);
        at = to;
        lastControl = c2;
        break;
      }
      case "q": {
        const c = point();
        const to = point();
        bezier([c], to);
        at = to;
        lastControl = c;
        break;
      }
      case "t": {
        const c = lastControl ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]] : at;
        const to = point();
        bezier([c], to);
        at = to;
        lastControl = c;
        break;
      }
      case "a": {
        const rx = number();
        const ry = number();
        const turn = number();
        const large = number() ? 1 : 0;
        const sweep = number() ? 1 : 0;
        const to = point();
        for (const p of arcPoints(at, rx, ry, turn, large, sweep, to)) lineTo(p);
        at = to;
        lastControl = null;
        break;
      }
      case "z":
        if (current) current.closed = true;
        at = start;
        current = null;
        lastControl = null;
        break;
      default:
        throw new Error(`a path command the sketch does not know: ${command}`);
    }
  }
  return pieces.filter((piece) => piece.points.length >= 2);
}

/** A style's value: from `style="fill:#fff"` first, then the attribute. */
function styleOf(attributes, name) {
  const inline = String(attributes.style ?? "").match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));
  return inline ? inline[1].trim() : attributes[name];
}

/** An ellipse's outline in the drawing's units. */
const ellipseRing = (cx, cy, rx, ry) =>
  Array.from({ length: CIRCLE_SIDES }, (_, i) => {
    const t = (2 * Math.PI * i) / CIRCLE_SIDES;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  });

/**
 * The shapes of an SVG drawing: `[{ label, keys, colour, areas | outlines, from }]` in map units (+y up),
 * where `keys` are its label's and its groups' words (labelKeys), `colour` its fill (or, for a corridor, its
 * stroke), and either `areas` (a filled shape) or `outlines` (a corridor's pieces). `scale`: map units for
 * one unit of the drawing; every point is rounded to `grid` (1: whole units, so that the walls' planes are
 * written through whole points).
 */
export function readSvgSketch(text, { scale = 1, grid = 1 } = {}) {
  const round = (value) => (grid ? Math.round(value / grid) * grid + 0 : value);
  const shapes = [];
  const stack = [
    { matrix: IDENTITY, keys: {}, fill: "#000000", stroke: null, width: 1, hidden: false, defs: false },
  ];
  for (const match of String(text).matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, rest, selfClosing] = match;
    if (tag.startsWith("!") || tag.startsWith("?")) continue;
    if (closing) {
      if (stack.length > 1 && ["g", "svg", "defs", "symbol", "clipPath", "mask", "a"].includes(tag))
        stack.pop();
      continue;
    }
    const attributes = attributesOf(rest);
    const outer = stack[stack.length - 1];
    const label = attributes["inkscape:label"] ?? attributes.id;
    const own = attributes["inkscape:label"] !== undefined ? labelKeys(label) : {};
    // an id Inkscape makes up (path123, g45, rect7) names nothing
    if (
      attributes["inkscape:label"] === undefined &&
      attributes.id &&
      !/^[a-z]+\d+(-\d+)?$/i.test(attributes.id)
    )
      Object.assign(own, labelKeys(attributes.id));
    const fill = styleOf(attributes, "fill");
    const stroke = styleOf(attributes, "stroke");
    const width = styleOf(attributes, "stroke-width");
    const display = styleOf(attributes, "display");
    const here = {
      matrix: times(outer.matrix, transformOf(attributes.transform)),
      keys: { ...outer.keys, ...own },
      fill: fill === undefined ? outer.fill : fill,
      stroke: stroke === undefined ? outer.stroke : stroke,
      width: width === undefined ? outer.width : parseFloat(width),
      hidden: outer.hidden || display === "none" || attributes.visibility === "hidden",
      defs: outer.defs || ["defs", "symbol", "clipPath", "mask"].includes(tag),
    };
    // a group's name is not the name of each thing in it: only its keys pass down
    if (["g", "svg", "defs", "symbol", "clipPath", "mask", "a"].includes(tag)) {
      if (own.name) delete here.keys.name;
      if (!selfClosing) stack.push(here);
      continue;
    }
    if (here.hidden || here.defs) continue;
    const n = (name) => parseFloat(attributes[name] ?? 0);
    let pieces = null;
    let line = false;
    switch (tag) {
      case "rect": {
        const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
        pieces = [
          {
            points: [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ],
            closed: true,
          },
        ];
        break;
      }
      case "circle":
        pieces = [{ points: ellipseRing(n("cx"), n("cy"), n("r"), n("r")), closed: true }];
        break;
      case "ellipse":
        pieces = [{ points: ellipseRing(n("cx"), n("cy"), n("rx"), n("ry")), closed: true }];
        break;
      case "polygon":
      case "polyline": {
        const values = String(attributes.points ?? "")
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
        const points = [];
        for (let k = 0; k + 1 < values.length; k += 2) points.push([values[k], values[k + 1]]);
        pieces = [{ points, closed: tag === "polygon" }];
        break;
      }
      case "line":
        pieces = [
          {
            points: [
              [n("x1"), n("y1")],
              [n("x2"), n("y2")],
            ],
            closed: false,
          },
        ];
        line = true;
        break;
      case "path":
        pieces = pathPieces(attributes.d ?? "");
        break;
      default:
        continue;
    }
    if (!pieces?.length) continue;
    // the matrix's own scale, for a stroke's width
    const widthScale = Math.sqrt(Math.abs(here.matrix[0] * here.matrix[3] - here.matrix[1] * here.matrix[2]));
    const toMap = (point) => {
      const [x, y] = apply(here.matrix, point);
      return [round(x * scale), round(-y * scale)];
    };
    const keys = { ...here.keys };
    const filled = !line && colourText(here.fill) !== null;
    const shape = { label: label ?? "", keys, from: tag };
    if (filled) {
      shape.colour = colourText(here.fill);
      shape.areas = [
        pieces.filter((piece) => piece.points.length >= 3).map((piece) => piece.points.map(toMap)),
      ];
      if (!shape.areas[0].length) continue;
    } else if (colourText(here.stroke) !== null) {
      shape.colour = colourText(here.stroke);
      const wide = (Number.isFinite(here.width) ? here.width : 1) * widthScale * scale;
      shape.width = wide;
      shape.lines = pieces.map((piece) => {
        const points = piece.points.map(toMap);
        if (piece.closed) points.push(points[0]);
        return points;
      });
      shape.outlines = shape.lines.flatMap((points) => path(points, wide, { snap: grid }));
    } else continue;
    shapes.push(shape);
  }
  return shapes;
}

// ── PNG ─────────────────────────────────────────────────────────────────────
/** The edge of the pixels of a mask as closed rings of pixel corners (x right, y down). */
function traceMask(mask, width, height) {
  const at = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  // each edge between a pixel in and one out, the inside on its left; keyed by where it starts
  const from = new Map();
  const add = (a, b) => {
    const key = a[0] * (height + 2) + a[1];
    if (!from.has(key)) from.set(key, []);
    from.get(key).push(b);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add([x + 1, y], [x, y]);
      if (!at(x, y + 1)) add([x, y + 1], [x + 1, y + 1]);
      if (!at(x - 1, y)) add([x, y], [x, y + 1]);
      if (!at(x + 1, y)) add([x + 1, y + 1], [x + 1, y]);
    }
  const rings = [];
  for (const [key, list] of from) {
    while (list.length) {
      const first = [Math.floor(key / (height + 2)), key % (height + 2)];
      const ring = [first];
      let next = list.pop();
      while (!(next[0] === first[0] && next[1] === first[1])) {
        ring.push(next);
        const onward = from.get(next[0] * (height + 2) + next[1]);
        next = onward.pop();
      }
      rings.push(ring);
    }
  }
  return rings;
}

/** A closed ring made straight where it strays less than `tolerance` from a line (Douglas and Peucker). */
function straightened(ring, tolerance) {
  if (ring.length <= 4) return ring;
  const away = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / length;
  };
  const simplify = (points) => {
    let far = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = away(points[i], points[0], points[points.length - 1]);
      if (d > far) [far, index] = [d, i];
    }
    if (far <= tolerance) return [points[0], points[points.length - 1]];
    const left = simplify(points.slice(0, index + 1));
    return [...left.slice(0, -1), ...simplify(points.slice(index))];
  };
  // cut the ring at its two points furthest apart, and straighten each half
  let split = 0;
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) [best, split] = [d, i];
  }
  const one = simplify(ring.slice(0, split + 1));
  const two = simplify([...ring.slice(split), ring[0]]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

/**
 * The shapes of a PNG painted in flat colours: one for each colour of `legend.colours` the picture has,
 * `{ label, keys, colour, areas }` in map units (+y up, the picture's bottom left at 0, 0), one pixel
 * `scale` units. A pixel is a colour when no channel is more than `near` from it. Each colour's patches are
 * grown `grow` pixels over the legend's other colours beside them, so that spaces painted side by side
 * overlap (they join) rather than leave a sliver of rock between their straightened edges; over white,
 * black and unnamed colours they do not grow.
 */
export function readPngSketch(
  buffer,
  {
    colours = {},
    scale = 8,
    near = COLOUR_NEAR,
    tolerance = TRACE_TOLERANCE,
    grow = Math.ceil(TRACE_TOLERANCE) + 1,
  } = {},
) {
  const { width, height, rgba } = unpng(buffer);
  const wanted = Object.keys(colours).map((key) => {
    const text = colourText(key);
    if (!text) throw new Error(`readPngSketch: the legend's colour "${key}" is no colour (#rrggbb)`);
    return { key, text, rgb: [1, 3, 5].map((k) => parseInt(text.slice(k, k + 2), 16)) };
  });
  // each pixel's colour of the legend (its number), -1 for none
  const of = new Int16Array(width * height).fill(-1);
  for (let i = 0; i < width * height; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    wanted.forEach((colour, nth) => {
      if (of[i] >= 0) return;
      if (Math.max(...colour.rgb.map((c, k) => Math.abs(c - rgba[i * 4 + k]))) <= near) of[i] = nth;
    });
  }
  const shapes = [];
  for (const [nth, colour] of wanted.entries()) {
    const mask = new Uint8Array(width * height);
    let count = 0;
    for (let i = 0; i < width * height; i++)
      if (of[i] === nth) {
        mask[i] = 1;
        count++;
      }
    if (!count) continue;
    // grown into the colours beside it by more than straightening moves an edge, so that two spaces
    // painted side by side overlap and no sliver of rock is left between their straightened edges
    for (let step = 0; step < grow; step++) {
      const before = mask.slice();
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (before[i] || of[i] < 0) continue;
          if (
            (x > 0 && before[i - 1]) ||
            (x + 1 < width && before[i + 1]) ||
            (y > 0 && before[i - width]) ||
            (y + 1 < height && before[i + width])
          )
            mask[i] = 1;
        }
    }
    const rings = traceMask(mask, width, height)
      .map((ring) => straightened(ring, tolerance))
      .filter((ring) => ring.length >= 3)
      .map((ring) => ring.map(([x, y]) => [x * scale, (height - y) * scale]));
    if (rings.length)
      shapes.push({ label: colour.key, keys: {}, colour: colour.text, areas: [rings], pixels: count });
  }
  return shapes;
}

// ── shapes to spaces ────────────────────────────────────────────────────────
/**
 * What the shapes of a sketch are, by the legend and their labels: `{ spaces, starts, lights, pieces, skipped,
 * warnings }`. `spaces` are what `carvePlan` takes (with their `light`, if any); `starts` `{ at: [x, y, z],
 * yaw }`; `lights` `{ at: [x, y, z], brightness, color }`; `skipped` `{ label, why }` for each shape left
 * out, so that the person can be told; `warnings` what is drawn but will not play (a street under the sky,
 * three times as long as wide, whose end meets no other space: a blind wall; `dead=ok` on it says it is meant).
 */
export function sketchSpaces(shapes, legend = {}) {
  const byColour = {};
  for (const [key, value] of Object.entries(legend.colours ?? {})) byColour[colourText(key) ?? key] = value;
  const byName = legend.names ?? {};
  const found = [];
  const skipped = [];
  for (const shape of shapes) {
    const keys = {
      ...(shape.colour ? byColour[shape.colour] : undefined),
      ...(shape.keys.name ? byName[shape.keys.name] : undefined),
      ...shape.keys,
    };
    const kind = keys.kind ?? "space";
    const label = keys.name ?? shape.label ?? shape.colour ?? "";
    if (kind === "skip") continue;
    if (!["space", "start", "light", "spiral", "bridge", "pool"].includes(kind)) {
      skipped.push({ label, why: `a kind the sketch does not know: ${kind}` });
      continue;
    }
    found.push({ shape, keys, kind, label });
  }
  // "sky": over every height given, a cliff's top, and what a space asks room for under it (`sky`: trees)
  const heights = found.flatMap(({ keys }) =>
    [
      keys.floor,
      keys.ceiling,
      keys.floor + (keys.height ?? 0),
      keys.floor + (keys.horizon ?? 0) + (keys.cliff ?? 0),
      keys.floor + (keys.sky ?? 0),
    ].filter(Number.isFinite),
  );
  const sky = (heights.length ? Math.max(...heights) : 0) + SKY_OVER;
  const spaces = [];
  const starts = [];
  const lights = [];
  const pieces = [];
  const pools = [];
  const streets = [];
  for (const { shape, keys, kind, label } of found) {
    const outline = shape.areas ? { areas: shape.areas } : { outlines: shape.outlines };
    const middle = () => pointIn({ ...outline, floor: 0, ceiling: 1 });
    if (kind === "pool") {
      pools.push({ keys, label, outline });
      continue;
    }
    if (kind === "start") {
      if (!Number.isFinite(keys.floor)) {
        skipped.push({ label, why: "a start with no floor= (the height it stands on)" });
        continue;
      }
      starts.push({ at: [...middle(), keys.floor], yaw: keys.yaw ?? 0 });
      continue;
    }
    if (kind === "light") {
      if (!Number.isFinite(keys.z)) {
        skipped.push({ label, why: "a light with no z= (the height it hangs at)" });
        continue;
      }
      lights.push({
        at: [...middle(), keys.z],
        brightness: keys.light ?? keys.brightness ?? 200,
        color: keys.color,
      });
      continue;
    }
    if (kind === "bridge") {
      const line = shape.lines?.[0];
      if (!line || !Number.isFinite(keys.z)) {
        skipped.push({ label, why: "a bridge is a line with a stroke, with z= (its deck's height)" });
        continue;
      }
      pieces.push({ kind, from: line[0], to: line[line.length - 1], z: keys.z, width: keys.width ?? shape.width, texture: keys.texture, piers: keys.piers ?? 0, ground: keys.ground }); // prettier-ignore
      continue;
    }
    if (kind === "spiral") {
      if (!Number.isFinite(keys.floor) || !Number.isFinite(keys.to)) {
        skipped.push({ label, why: "a spiral stair with no floor= (its foot) and to= (its top)" });
        continue;
      }
      keys.ceiling ??= keys.to + SPIRAL_HEADROOM;
    }
    const floor = keys.floor;
    let ceiling = keys.ceiling === "sky" ? sky : keys.ceiling;
    if (ceiling === undefined && Number.isFinite(keys.height)) ceiling = floor + keys.height;
    if (!Number.isFinite(floor) || !Number.isFinite(ceiling)) {
      skipped.push({
        label,
        why: "no floor= and ceiling= (or height=) by its label, its colour or its name",
      });
      continue;
    }
    let texture = keys.texture;
    if (typeof texture === "string" && texture.includes(",")) {
      const [f, c, w] = texture.split(",");
      texture = { floor: f, ceiling: c, wall: w ?? c };
    }
    if (keys.ceiling === "sky") {
      const worn = texture ?? legend.texture;
      texture =
        worn && typeof worn === "object" && !worn.name
          ? { ...worn, ceiling: "sky" }
          : { floor: worn, wall: worn, ceiling: "sky" };
      if (!texture.floor) delete texture.floor;
      if (!texture.wall) delete texture.wall;
    }
    const space = planSpace(
      { ...outline, floor, ceiling, name: label, ...(texture === undefined ? {} : { texture }) },
      spaces.length,
    );
    if (Number.isFinite(keys.slope)) space.slope = { rise: keys.slope, toward: towardOf(keys.toward) };
    if (Number.isFinite(keys.horizon)) space.horizon = keys.horizon;
    if (Number.isFinite(keys.rough))
      space.rough = { depth: keys.rough, cell: keys.cell ?? 48, seed: spaces.length + 1 };
    if (keys.cliff > 0) space.cliff = { rise: keys.cliff, foot: keys.foot ?? 96, seed: spaces.length + 1 };
    const patch = keys.patch
      ? []
          .concat(keys.patch)
          .flatMap((name) => String(name).split(","))
          .filter(Boolean)
      : [];
    if (keys.relief > 0 || keys.bank > 0 || patch.length)
      space.relief = { amp: keys.relief ?? 0, bank: keys.bank ?? 0, wide: keys.bumps ?? 640, seed: spaces.length + 1, patches: patch.map((texture) => ({ texture, share: (keys.patchShare ?? 0.15) / patch.length })) }; // prettier-ignore
    if (kind === "spiral") {
      const corners = space.areas.flat(2);
      const [x0, x1] = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))];
      const [y0, y1] = [Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[1]))];
      const outer = Math.min(x1 - x0, y1 - y0) / 2 + SPIRAL_INTO;
      pieces.push({ kind, centre: [(x0 + x1) / 2, (y0 + y1) / 2], outer, inner: keys.inner ?? Math.min(32, outer / 4), from: floor, to: keys.to, start: keys.start, rise: keys.rise, turn: keys.turn ?? 1, texture: keys.steps ?? partOf(space.texture, "floor"), columnTexture: partOf(space.texture, "wall") }); // prettier-ignore
    }
    if (keys.ceiling === "sky" && keys.dead !== "ok") streets.push({ shape, space, label });
    if (Number.isFinite(keys.light)) {
      const at = pointIn(space);
      lights.push({
        at: [...at, Math.max(floor + 8, ceiling - LAMP_UNDER)],
        brightness: keys.light,
        color: keys.color,
      });
    }
    spaces.push(space);
  }
  // a pool: a space of its own sunk `depth` in the floor of the space it is drawn in (the lowest where storeys are
  // stacked, or the one whose floor its floor= names); sketchMap fills it with water
  for (const { keys, label, outline } of pools) {
    const at = pointIn({ ...outline, floor: 0, ceiling: 1 });
    const homes = spaces.filter((space) => !space.pool && spaceAt([space], [...at, space.floor]) >= 0 && (keys.floor === undefined || keys.floor === space.floor)); // prettier-ignore
    if (!homes.length) {
      skipped.push({ label, why: "a pool in no space (it is sunk in the floor of the space it is drawn in)" });
      continue;
    }
    const home = homes.reduce((a, b) => (b.floor < a.floor ? b : a));
    const worn = keys.texture === undefined ? partOf(home.texture, "floor") : String(keys.texture).split(",")[0];
    const texture = worn === undefined ? {} : { texture: { floor: worn, ceiling: worn, wall: worn } };
    spaces.push(planSpace({ ...outline, floor: home.floor - (keys.depth ?? POOL_DEPTH), ceiling: home.floor, name: label, ...texture, pool: { water: keys.water ?? legend.water ?? "!water1", rim: keys.rim ?? 0 } }, spaces.length)); // prettier-ignore
  }
  const warnings = streets.flatMap(({ shape, space, label }) =>
    blindEnds(shape, space, spaces).map(
      (end) => `the street ${label} ends in a blind wall at its ${end} end: give it a door, a gate or another space there, or make it a yard`, // prettier-ignore
    ),
  );
  return { spaces, starts, lights, pieces, skipped, warnings };
}

const unit = (to, from) => {
  const far = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [(to[0] - from[0]) / far, (to[1] - from[1]) / far];
};

/**
 * The ends of a street that meet no other space, each as "east", "north", "west" or "south": a street is a
 * corridor drawn as a line, or a space `STREET_RATIO` times as long (along its longest side) as wide. A space
 * just beyond an end, across its width, at a step up (18) or any way down, opens it.
 */
function blindEnds(shape, space, spaces) {
  let ends, length, width;
  if (shape.lines) {
    const line = shape.lines[0];
    length = line.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);
    width = shape.width;
    ends = [[line[0], line[1]], [line[line.length - 1], line[line.length - 2]]].map(([at, from]) => ({ at, way: unit(at, from) })); // prettier-ignore
  } else {
    const ring = space.areas[0][0];
    const edges = ring.map((a, i) => [a, ring[(i + 1) % ring.length]]);
    const far = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [a, b] = edges.reduce((best, edge) => (far(edge) > far(best) ? edge : best));
    const u = unit(b, a);
    const v = [-u[1], u[0]];
    const along = ring.map((p) => p[0] * u[0] + p[1] * u[1]);
    const across = ring.map((p) => p[0] * v[0] + p[1] * v[1]);
    length = Math.max(...along) - Math.min(...along);
    width = Math.max(...across) - Math.min(...across);
    const mid = (Math.max(...across) + Math.min(...across)) / 2;
    ends = [[Math.min(...along), -1], [Math.max(...along), 1]].map(([d, sign]) => ({ at: [u[0] * d + v[0] * mid, u[1] * d + v[1] * mid], way: [u[0] * sign, u[1] * sign] })); // prettier-ignore
  }
  if (length < STREET_RATIO * width) return [];
  const others = spaces.filter((other) => other !== space);
  const z = space.floor + STEP_HEIGHT + 1;
  return ends
    .filter(({ at, way }) => [-0.4, -0.2, 0, 0.2, 0.4].every((k) => spaceAt(others, [at[0] + way[0] * 2 - way[1] * k * width, at[1] + way[1] * 2 + way[0] * k * width, z]) < 0)) // prettier-ignore
    .map(({ way }) => (Math.abs(way[0]) >= Math.abs(way[1]) ? (way[0] > 0 ? "east" : "west") : way[1] > 0 ? "north" : "south")); // prettier-ignore
}

/**
 * Where a spiral stair's top is walked off to: the nearest edge of a space whose floor is at its top (within a
 * step) standing beside its shaft, not over it, within `LANDING_REACH` of the shaft: `{ end, landing }` for
 * spiralStairs (the stair turned to face it, a bridge out to it), or nothing when there is none.
 */
function sillFor({ centre, outer, to }, spaces) {
  let best = null;
  for (const space of spaces) {
    if (Math.abs(space.floor - to) > STEP_HEIGHT || spaceAt([space], [...centre, space.floor]) >= 0) continue;
    for (const ring of space.areas.flat())
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const d = [b[0] - a[0], b[1] - a[1]];
        const length2 = d[0] * d[0] + d[1] * d[1] || 1;
        const t = Math.max(0, Math.min(1, ((centre[0] - a[0]) * d[0] + (centre[1] - a[1]) * d[1]) / length2));
        const at = [a[0] + d[0] * t, a[1] + d[1] * t];
        const away = Math.hypot(at[0] - centre[0], at[1] - centre[1]);
        if (away <= outer + LANDING_REACH && (!best || away < best.away))
          best = { at, away, width: Math.min(LANDING_WIDTH, Math.sqrt(length2)) };
      });
  }
  if (!best) return {};
  const end = (Math.atan2(best.at[1] - centre[1], best.at[0] - centre[0]) * 180) / Math.PI;
  return { end, landing: { to: best.at, width: best.width } };
}

/** One part of a space's texture (`floor`, `ceiling`, `wall`): undefined when it names none. */
const partOf = (texture, part) =>
  texture && typeof texture === "object" && !texture.name ? texture[part] : texture;

/** A way as degrees: a number, or east, north, west, south. */
function towardOf(toward) {
  if (toward === undefined) return 0;
  const named = { east: 0, north: 90, west: 180, south: 270 }[String(toward).toLowerCase()];
  if (named !== undefined) return named;
  if (!Number.isFinite(Number(toward)))
    throw new Error(`a way is degrees or east, north, west, south, not ${toward}`);
  return Number(toward);
}

/** Where a space's rock stands to: outdoors the rock stands to the horizon, and sky is over it. */
const rockTop = (space) =>
  space.horizon > 0 ? Math.min(space.ceiling, space.floor + space.horizon) : space.ceiling;

/**
 * The stretches of a space's sides with rock behind them, each `{ from, to }` with the space to the LEFT of
 * from → to: not where a side opens into another space (a doorway, the mouth of a cave, a terrace's edge).
 */
function rockSides(space, others) {
  const z = (space.floor + rockTop(space)) / 2;
  const stretches = [];
  for (const ring of space.areas.flat())
    for (let i = 0; i < ring.length; i++) {
      let a = ring[i];
      let b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < ROUGH_LEAST) continue;
      // the space is to the left of a → b
      let left = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      const middle = [(a[0] + b[0]) / 2 + left[0] * 2, (a[1] + b[1]) / 2 + left[1] * 2];
      if (spaceAt([space], [...middle, z]) < 0) {
        [a, b] = [b, a];
        left = [-left[0], -left[1]];
      }
      const count = Math.max(1, Math.round(length / ROUGH_LEAST));
      const solidAt = (t) => {
        const p = [a[0] + (b[0] - a[0]) * t - left[0] * 4, a[1] + (b[1] - a[1]) * t - left[1] * 4];
        return spaceAt(others, [...p, z]) < 0;
      };
      let from = null;
      for (let k = 0; k <= count; k++) {
        const t = k / count;
        const closed = k < count && solidAt((k + 0.5) / count);
        if (closed && from === null) from = t;
        if (!closed && from !== null) {
          const p = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
          if ((t - from) * length >= ROUGH_LEAST) stretches.push({ from: p(from), to: p(t) });
          from = null;
        }
      }
    }
  return stretches;
}

/** The faces of rough rock along a space's walls, inside it, where rock is behind them. */
function roughWalls(space, others, texture) {
  const { depth, cell, seed } = space.rough;
  const top = rockTop(space);
  return rockSides(space, others).flatMap(({ from, to }, nth) =>
    rockWall({ from, to, bottom: space.floor, top, depth, cell, seed: seed * 101 + nth, texture }),
  );
}

/**
 * The cliffs along a space's walls, inside it, where rock is behind them: leaning faces from the floor up to
 * the rock's top and up to `rise` over it (`cliffWall`), their feet kept out of `clear`.
 */
function cliffWalls(space, others, texture, clear) {
  const { rise, foot, seed } = space.cliff;
  const top = rockTop(space);
  return rockSides(space, others).flatMap(({ from, to }, nth) =>
    cliffWall({ from, to, bottom: space.floor, top, rise, foot, seed: seed * 131 + nth, texture, clear }),
  );
}

/** A colour of a light from a word "255,200,150" or a list; white when none. */
const lightColour = (color) =>
  Array.isArray(color) ? color : typeof color === "string" ? color.split(",").map(Number) : [255, 255, 255];

/**
 * A map's source (what `writeMap` takes) from a sketch's spaces: the spaces carved (`carvePlan`, rock
 * `wall` thick, worn `texture` where a space brings none), a start for each `starts` (or one in the first
 * space when there are none), a lamp for each `lights`, and the sun when `sun` says (`{ yaw, pitch,
 * brightness, color }`) or any space is open to the sky. A space with `cliff` has leaning cliffs along its
 * rock (`cliffWall`), their feet kept out of the `clear` boxes (`[{ min: [x, y], max: [x, y] }]`: houses,
 * doorways, whatever the map will put by a wall).
 */
export function sketchMap(
  { spaces, starts = [], lights = [], pieces = [] },
  { wall = 16, texture = "rock", sun, worldspawn = {}, hand, clear = [] } = {},
) {
  if (!spaces?.length)
    throw new Error("sketchMap: the sketch has no spaces (none with a floor and a ceiling)");
  const brushes = carvePlan(spaces, wall, texture);
  const entities = [];
  const fallback = typeof texture === "object" && !texture.name ? texture : { floor: texture, wall: texture };
  const wallOf = (space) => (typeof space.texture === "object" && !space.texture?.name ? space.texture.wall : space.texture) ?? fallback.wall ?? fallback.floor; // prettier-ignore
  const floorOf = (space) => (typeof space.texture === "object" && !space.texture?.name ? space.texture.floor : space.texture) ?? fallback.floor ?? fallback.wall; // prettier-ignore
  const rough = spaces.filter((space) => space.rough).flatMap((space) => roughWalls(space, spaces.filter((other) => other !== space), wallOf(space))); // prettier-ignore
  if (rough.length) entities.push(brushEntity("func_detail", rough, { zhlt_detaillevel: 1 }));
  const cliffs = spaces.filter((space) => space.cliff).flatMap((space) => cliffWalls(space, spaces.filter((other) => other !== space), wallOf(space), clear)); // prettier-ignore
  if (cliffs.length) entities.push(brushEntity("func_detail", cliffs, { zhlt_detaillevel: 1 }));
  // ground that rises and falls (relief.mjs): hummocks, and banks against the rock
  const grounds = new Map();
  for (const space of spaces.filter((each) => each.relief)) {
    const others = spaces.filter((other) => other !== space);
    const made = reliefOf({
      space,
      others,
      sides: rockSides(space, others),
      ...space.relief,
      texture: floorOf(space),
      clear,
    });
    grounds.set(space, made);
    if (made.brushes.length) entities.push(brushEntity("func_detail", made.brushes, { zhlt_detaillevel: 1 }));
  }
  for (const piece of pieces) {
    const home = spaces.find((space) => spaceAt([space], [...(piece.centre ?? piece.from), (piece.from ?? piece.z) + 1]) >= 0) ?? spaces[0]; // prettier-ignore
    if (piece.kind === "spiral")
      brushes.push(...spiralStairs({ ...piece, ...sillFor(piece, spaces), texture: piece.texture ?? floorOf(home), columnTexture: piece.columnTexture ?? wallOf(home) }).brushes); // prettier-ignore
    else if (piece.kind === "bridge")
      brushes.push(...bridge({ ...piece, texture: piece.texture ?? floorOf(home) }));
  }
  // a pool's water: a func_water filling it to a little under the floor; its kerb, when it has one, astride its edge
  for (const space of spaces.filter((each) => each.pool)) {
    const { water, rim } = space.pool;
    entities.push(brushEntity("func_water", convexPieces(space).map((ring) => prism("z", ring, space.floor, space.ceiling - WATER_UNDER, water)), { skin: -3 })); // prettier-ignore
    if (rim > 0)
      for (const ring of space.areas.flat())
        ring.forEach((a, i) => {
          const b = ring[(i + 1) % ring.length];
          const [dx, dy] = unit(b, a).map((v) => (v * RIM_WIDTH) / 2);
          const kerb = [[a[0] - dx + dy, a[1] - dy - dx], [b[0] + dx + dy, b[1] + dy - dx], [b[0] + dx - dy, b[1] + dy + dx], [a[0] - dx - dy, a[1] - dy + dx]]; // prettier-ignore
          brushes.push(prism("z", kerb.map((p) => p.map(Math.round)), space.ceiling, space.ceiling + rim, wallOf(space)));
        });
  }
  const placed = starts.length ? starts : [{ at: [...pointIn(spaces[0]), spaces[0].floor], yaw: 0 }];
  for (const start of placed) entities.push(playerStart(start.at, start.yaw));
  for (const lamp of lights)
    entities.push(light(lamp.at, { brightness: lamp.brightness, color: lightColour(lamp.color) }));
  const open = spaces.find((space) => JSON.stringify(space.texture ?? "").includes('"sky"'));
  if (sun || open) {
    const where = open ?? spaces[0];
    const at = [...pointIn(where), where.ceiling - 8];
    const { yaw = 45, pitch = -50, brightness = 220, color = [255, 244, 224] } = sun ?? {};
    entities.push(sunLight(at, { yaw, pitch, brightness, color: lightColour(color) }));
  }
  const made = { worldspawn, brushes, entities };
  const out = hand ? mergeMaps(made, hand) : made;
  /**
   * The ground's height at a place (x, y), near the height z (the floor of the space there that is nearest
   * under it): its relief where it has one, the floor or its slope where not; null outside every space.
   */
  // each space with its rock and its ground, for what is strewn over it (scatter.mjs)
  Object.defineProperty(out, "places", {
    enumerable: false,
    value: spaces.map((space) => {
      const others = spaces.filter((other) => other !== space);
      const relief = grounds.get(space);
      const level = space.slope ? slopePlane(space).at : () => space.floor;
      return {
        space,
        name: space.name,
        sides: rockSides(space, others),
        groundAt: relief ? relief.heightAt : level,
      };
    }),
  });
  Object.defineProperty(out, "groundAt", {
    enumerable: false,
    value: (x, y, z = Infinity) => {
      const here = spaces.filter(
        (space) => space.floor <= z && spaceAt([space], [x, y, space.floor + 1]) >= 0,
      );
      if (!here.length) return null;
      const space = here.reduce((a, b) => (b.floor > a.floor ? b : a));
      if (grounds.has(space)) return grounds.get(space).heightAt(x, y);
      return space.slope ? slopePlane(space).at(x, y) : space.floor;
    },
  });
  return out;
}
