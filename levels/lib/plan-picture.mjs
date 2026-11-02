// Plan pictures for the generator's first review stop (PLAN.md Phase 3, "Review stops", R1): top-down plans drawn
// from a description before any geometry exists, so a person can see a building in the wrong place or a missing
// connection before the generator builds on it. Written as SVG text, no dependencies.
//
// A city description (`smak-city-description/1`, levels/specs/CITY.md) gives one picture per layer, one per tile and
// layer (full labels), and a whole-city overview. Each shows the tile grid and the seam portals; districts tinted by
// wealth (colour) and wear (dots), named; streets by class with their widths to scale; plazas; blocks with their
// lots hatched as facades and the enterable buildings outlined and labelled (id, type, homes) with their door toward
// their frontage; connectors at their stops by type (grand-stair, stair, ramp, lift, shaft, secret dashed), the run
// of a stair or ramp to its other stop; checkpoints, required places, spawns when placed; a scale bar in metres and
// cells, a north arrow, a legend, and a title with the description's name and its hash. Things a person should
// look at (a building over a street or outside its district, a door far from its street, a seam crossed with no
// portal) are numbered in red: these are aids for the eye, the checks stay in city-checks.mjs.
//
// A level description (`smak-level-description/1`, levels/specs/README.md) gives a schematic per storey and one of
// all storeys: the format places no space, so spaces stand in columns by their distance from the start and in bands
// by storey, sized to scale; links by type, the critical route numbered, loops, dead ends, hubs, gates and keys.
//
// A description that does not validate is refused with the validator's sentence. The same description gives the
// same bytes: nothing here reads the clock or the order of a hash map.

import { createHash } from "node:crypto";
import { measureCity, FORMAT as CITY_FORMAT } from "./city-description.mjs";
import { measureDescription, FORMAT as LEVEL_FORMAT } from "./description.mjs";
import { analyseDescription } from "./description-checks.mjs";

export const REVIEW_FORMAT = "smak-plan-review/1";

// ── numbers, text, hashes ──

const f = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? f(v) : esc(v)}"`)
    .join("");
const el = (tag, a = {}, inner) => (inner === undefined ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`); // prettier-ignore
const text = (x, y, s, a = {}) => el("text", { x, y, ...a }, esc(s));
/** A rough width of a line of Arial at `size` px: enough to keep labels apart. */
const textW = (s, size, bold) => String(s).length * size * (bold ? 0.61 : 0.56);

/** JSON with the keys of every object sorted: the same description gives the same text whatever its key order. */
export const canonicalJson = (v) =>
  Array.isArray(v)
    ? `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .filter((k) => v[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
/** The description's hash: sha256 of its canonical JSON (formatting and key order do not change it). */
export const descriptionHash = (desc) => sha256(canonicalJson(desc));

const wrap = (s, maxChars) => {
  const out = [];
  let line = "";
  for (const w of String(s).split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > maxChars) out.push(line), (line = w);
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
};

// ── geometry (cells) ──

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rectOf = (at, [w, d]) => [at[0] - w / 2, at[1] - d / 2, at[0] + w / 2, at[1] + d / 2];
const rectsMeet = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const rectClip = (a, b) => {
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
};
const overlapDepth = (a, b) => Math.min(a[2] - b[0], b[2] - a[0], a[3] - b[1], b[3] - a[1]);
const pointRectDist = (p, r) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - r[2]), Math.max(r[1] - p[1], 0, p[1] - r[3])); // prettier-ignore
const rectRectDist = (a, b) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3])); // prettier-ignore
const nearestOnSeg = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
};
const segHitsRect = (a, b, r) => {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r[0]], [dx, r[2] - a[0]], [-dy, a[1] - r[1]], [dy, r[3] - a[1]]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
};
const segRectDist = (a, b, r) => {
  if (segHitsRect(a, b, r)) return 0;
  const corners = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  return Math.min(pointRectDist(a, r), pointRectDist(b, r), ...corners.map((c) => dist(c, nearestOnSeg(c, a, b))));
};
const lineRectDist = (pts, r) => Math.min(...pts.slice(1).map((p, i) => segRectDist(pts[i], p, r)));
const nearestOnLine = (p, pts) => {
  let best = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const q = nearestOnSeg(p, pts[i - 1], pts[i]);
    if (dist(p, q) < dist(p, best)) best = q;
  }
  return best;
};
/** Where the way from `p` (inside `r`) toward `q` leaves the rectangle `r` (q itself when q is inside). */
const exitPoint = (p, q, r) => {
  let t = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  if (dx > 0) t = Math.min(t, (r[2] - p[0]) / dx);
  else if (dx < 0) t = Math.min(t, (r[0] - p[0]) / dx);
  if (dy > 0) t = Math.min(t, (r[3] - p[1]) / dy);
  else if (dy < 0) t = Math.min(t, (r[1] - p[1]) / dy);
  return [p[0] + dx * t, p[1] + dy * t];
};
const lineLength = (pts) => pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0);
/** A winding way drawn as a zigzag between its ends whose length is the way's `length` (schematic bends). */
const zigzag = (a, b, length) => {
  const D = dist(a, b);
  if (!(length > D * 1.01) || D < 1e-6) return [a, b];
  const k = Math.max(2, Math.round(D / 6));
  const [ux, uy] = [(b[0] - a[0]) / D, (b[1] - a[1]) / D];
  const pts = (amp) => {
    const out = [a];
    for (let i = 1; i < k; i++) {
      const o = i % 2 ? amp : -amp;
      out.push([a[0] + ux * (D * i) / k - uy * o, a[1] + uy * (D * i) / k + ux * o]);
    }
    out.push(b);
    return out;
  };
  let [lo, hi] = [0, length];
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lineLength(pts(mid)) < length) lo = mid;
    else hi = mid;
  }
  return pts((lo + hi) / 2);
};

// ── the look of things ──

const WEALTH_FILL = { slum: "#bfae95", low: "#dccfa8", mid: "#cddcb4", high: "#bcd3e6", elite: "#ddc8ea" };
const STREET_LOOK = {
  avenue: { band: "#d6d0c2", way: "#fcfbf7", centre: "#9b9486" },
  street: { band: "#d6d0c2", way: "#ffffff", centre: "#b3ad9f" },
  alley: { band: "#ece3cf", way: "#ece3cf" },
  canal: { band: "#c7bca9", way: "#73aadd" },
  catwalk: { band: "#f0b860", way: "#f0b860", ties: "#7a5520" },
  service: { band: "#c0392b", way: "#c0392b" },
};
const OTHER_LOOK = { band: "#e0dccf", way: "#f6f3ea" };
const CASING = "#3f3a33";
const BUILDING_FILL = { home: "#fff0c4", business: "#ffffff", msr: "#f6cfc9", insurgent: "#e2d2f2" };
const INK = { public: "#151515", msr: "#b3261e", insurgent: "#6a2c91", private: "#4b4b4b" };
const SECRET = "#7b3fa0";
const PORTAL = "#0b7d8c";
const WARN = "#c8141c";
const SPACE_FILL = { room: "#f3ead7", corridor: "#e4e4e4", hall: "#efd8b0", cave: "#d8cdbd", yard: "#d6e9cc", stair: "#cdd8ea" }; // prettier-ignore
const PACING_INK = { quiet: "#9a9a9a", tension: "#e3a21a", fight: "#c8141c", rest: "#2e9e4f" };

const STYLE = [
  "text{font-family:Arial,Helvetica,sans-serif;fill:#1b1b1b}",
  ".h{paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}",
  ".b{font-weight:bold}",
  ".i{font-style:italic}",
  ".d{fill:#555}",
  ".w{fill:#c8141c;font-weight:bold}",
  ".s{fill:#7b3fa0}",
].join("");

const DEFS = [
  '<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#ece6da"/><line x1="0" y1="0" x2="0" y2="6" stroke="#a09583" stroke-width="1.5"/></pattern>', // prettier-ignore
  '<pattern id="wear1" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1" fill="#3d2f20" fill-opacity=".4"/></pattern>', // prettier-ignore
  '<pattern id="wear2" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="#3d2f20" fill-opacity=".45"/><circle cx="9" cy="8" r="0.9" fill="#3d2f20" fill-opacity=".45"/></pattern>', // prettier-ignore
  '<pattern id="wear3" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#3d2f20" fill-opacity=".5"/><circle cx="6.5" cy="5" r="1" fill="#3d2f20" fill-opacity=".5"/><circle cx="3" cy="7.5" r="0.8" fill="#3d2f20" fill-opacity=".5"/></pattern>', // prettier-ignore
  '<pattern id="nofloor" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#d4d4d4"/><line x1="0" y1="0" x2="0" y2="10" stroke="#bcbcbc" stroke-width="3"/></pattern>', // prettier-ignore
  '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#d0461b"/></marker>', // prettier-ignore
  '<marker id="arrowk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#222"/></marker>', // prettier-ignore
].join("");

function svgDoc(width, height, title, meta, body) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${f(height)}" viewBox="0 0 ${f(width)} ${f(height)}">`, // prettier-ignore
    el("title", {}, esc(title)),
    el("metadata", {}, esc(canonicalJson(meta))),
    el("style", {}, STYLE),
    el("defs", {}, DEFS),
    el("rect", { width, height, fill: "#ffffff" }),
    body,
    "</svg>",
    "",
  ].join("\n");
}

/** The glyph of a connector type at (cx, cy), `r` px: what the legend shows beside its name. */
function glyph(type, cx, cy, r, access = "public") {
  const ink = INK[access] ?? INK.public;
  const sq = (k, fill = "#fff", extra = {}) =>
    el("rect", { x: cx - k * r, y: cy - k * r, width: 2 * k * r, height: 2 * k * r, fill, stroke: ink, "stroke-width": r > 5 ? 1.8 : 1.2, ...extra }); // prettier-ignore
  const ln = (x1, y1, x2, y2, w = 1.2, colour = ink) => el("line", { x1, y1, x2, y2, stroke: colour, "stroke-width": w }); // prettier-ignore
  const out = [];
  if (type === "grand-stair") {
    out.push(sq(1.15));
    for (let i = 1; i < 6; i++) out.push(ln(cx - 1.15 * r, cy - 1.15 * r + (2.3 * r * i) / 6, cx + 1.15 * r, cy - 1.15 * r + (2.3 * r * i) / 6)); // prettier-ignore
    out.push(el("rect", { x: cx - 1.35 * r, y: cy - 1.35 * r, width: 2.7 * r, height: 2.7 * r, fill: "none", stroke: ink, "stroke-width": 1 })); // prettier-ignore
  } else if (type === "stair") {
    out.push(sq(0.95));
    for (let i = 1; i < 4; i++) out.push(ln(cx - 0.95 * r, cy - 0.95 * r + (1.9 * r * i) / 4, cx + 0.95 * r, cy - 0.95 * r + (1.9 * r * i) / 4)); // prettier-ignore
  } else if (type === "ramp") {
    out.push(sq(0.95));
    out.push(el("path", { d: `M${f(cx - 0.6 * r)},${f(cy + 0.35 * r)}L${f(cx)},${f(cy - 0.45 * r)}L${f(cx + 0.6 * r)},${f(cy + 0.35 * r)}`, fill: "none", stroke: ink, "stroke-width": 1.6 })); // prettier-ignore
  } else if (type === "lift") {
    out.push(sq(0.95));
    out.push(ln(cx - 0.95 * r, cy - 0.95 * r, cx + 0.95 * r, cy + 0.95 * r), ln(cx + 0.95 * r, cy - 0.95 * r, cx - 0.95 * r, cy + 0.95 * r)); // prettier-ignore
  } else if (type === "ladder-shaft") {
    out.push(el("circle", { cx, cy, r, fill: "#fff", stroke: ink, "stroke-width": r > 5 ? 1.8 : 1.2 }));
    out.push(ln(cx - 0.35 * r, cy - 0.75 * r, cx - 0.35 * r, cy + 0.75 * r), ln(cx + 0.35 * r, cy - 0.75 * r, cx + 0.35 * r, cy + 0.75 * r)); // prettier-ignore
    for (const k of [-0.4, 0, 0.4]) out.push(ln(cx - 0.35 * r, cy + k * r, cx + 0.35 * r, cy + k * r));
  } else {
    // secret (or a type this picture does not know): a dashed diamond
    out.push(el("path", { d: `M${f(cx)},${f(cy - 1.2 * r)}L${f(cx + 1.2 * r)},${f(cy)}L${f(cx)},${f(cy + 1.2 * r)}L${f(cx - 1.2 * r)},${f(cy)}z`, fill: "#f3e9fa", stroke: SECRET, "stroke-width": 1.5, "stroke-dasharray": "3 2" })); // prettier-ignore
    out.push(el("text", { x: cx, y: cy + 0.4 * r, "font-size": r * 1.1, "text-anchor": "middle", class: "b s" }, "S"));
  }
  return out.join("");
}
const checkpointGlyph = (cx, cy, r) => {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
  });
  return el("polygon", { points: pts.join(" "), fill: WARN, stroke: "#fff", "stroke-width": 1 }) + el("text", { x: cx, y: cy + r * 0.33, "font-size": r * 0.85, "text-anchor": "middle", fill: "#fff", style: "fill:#fff", class: "b" }, "CP"); // prettier-ignore
};
const starGlyph = (cx, cy, r) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 ? r * 0.45 : r;
    return `${f(cx + k * Math.cos(a))},${f(cy + k * Math.sin(a))}`;
  });
  return el("polygon", { points: pts.join(" "), fill: "#f2b705", stroke: "#6b4e00", "stroke-width": 1 });
};
const portalGlyph = (cx, cy, r) =>
  el("path", { d: `M${f(cx)},${f(cy - r)}L${f(cx + r)},${f(cy)}L${f(cx)},${f(cy + r)}L${f(cx - r)},${f(cy)}z`, fill: PORTAL, stroke: "#fff", "stroke-width": 1 }); // prettier-ignore
const lookGlyph = (cx, cy, r, n) =>
  el("circle", { cx, cy, r, fill: WARN, stroke: "#fff", "stroke-width": 1.2 }) + el("text", { x: cx, y: cy + r * 0.38, "font-size": r * 1.05, "text-anchor": "middle", style: "fill:#fff", class: "b" }, String(n)); // prettier-ignore
const spawnGlyph = (cx, cy, r) =>
  el("path", { d: `M${f(cx)},${f(cy - r)}L${f(cx + r * 0.9)},${f(cy + r * 0.7)}L${f(cx - r * 0.9)},${f(cy + r * 0.7)}z`, fill: "#2e9e4f", stroke: "#fff", "stroke-width": 1 }); // prettier-ignore

// ── labels that keep out of each other's way ──

/**
 * Labels placed in priority order: each tries its candidate spots and takes the first that is inside the map and
 * clear of every label, glyph and footprint placed before; `force` puts it at its first spot anyway (a tile's
 * picture carries every label), otherwise it is left off and counted.
 */
class Labels {
  constructor(bounds) {
    this.bounds = bounds;
    this.boxes = [];
    this.svg = [];
    this.omitted = 0;
  }
  block(box) {
    this.boxes.push(box);
  }
  free(b, ignore) {
    const [X0, Y0, X1, Y1] = this.bounds;
    if (b[0] < X0 || b[1] < Y0 || b[2] > X1 || b[3] > Y1) return false;
    return !this.boxes.some((o) => o !== ignore && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  }
  /** lines: strings or { text, size, cls }; candidates: [x, y, ax, ay] (the box's anchor at fractions ax, ay). */
  place(lines, cands, { force = false, leader = null, ignore = null, size = 10, fade = false } = {}) {
    const ls = lines.filter(Boolean).map((l) => (typeof l === "string" ? { text: l } : l));
    if (!ls.length) return null;
    const sz = (l) => l.size ?? size;
    const w = Math.max(...ls.map((l) => textW(l.text, sz(l), /\bb\b/.test(l.cls ?? "")))) + 3;
    const h = ls.reduce((a, l) => a + sz(l) * 1.2, 0);
    const boxOf = ([x, y, ax = 0, ay = 0]) => [x - ax * w, y - ay * h, x - ax * w + w, y - ay * h + h];
    let box = cands.map(boxOf).find((b) => this.free(b, ignore)) ?? null;
    if (!box && force && cands.length) {
      const [X0b, Y0b, X1b, Y1b] = this.bounds;
      const crowd = (b) => (b[0] < X0b || b[1] < Y0b || b[2] > X1b || b[3] > Y1b ? 1e9 : 0) + this.boxes.reduce((a, o) => (o === ignore ? a : a + Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1]))), 0); // prettier-ignore
      const b = cands.map(boxOf).reduce((best, c) => (crowd(c) < crowd(best) ? c : best));
      const [X0, Y0, X1, Y1] = this.bounds;
      const dx = Math.max(X0 - b[0], 0) - Math.max(b[2] - X1, 0);
      const dy = Math.max(Y0 - b[1], 0) - Math.max(b[3] - Y1, 0);
      box = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    }
    if (!box) {
      this.omitted++;
      return null;
    }
    this.boxes.push(box);
    const out = [];
    if (leader && pointRectDist(leader, box) > 4) {
      const q = [clamp(leader[0], box[0], box[2]), clamp(leader[1], box[1], box[3])];
      out.push(el("line", { x1: leader[0], y1: leader[1], x2: q[0], y2: q[1], stroke: "#555", "stroke-width": 0.8 })); // prettier-ignore
    }
    let y = box[1];
    for (const l of ls) {
      y += sz(l) * 1.2;
      out.push(text(box[0] + 1.5, y - sz(l) * 0.27, l.text, { "font-size": sz(l), class: `h ${l.cls ?? ""}`.trim() })); // prettier-ignore
    }
    this.svg.push(fade ? el("g", { opacity: 0.35 }, out.join("")) : out.join(""));
    return box;
  }
}
const around = (x, y, d, rings = [1]) =>
  rings.flatMap((k) => [
    [x + d * k, y, 0, 0.5],
    [x - d * k, y, 1, 0.5],
    [x, y - d * k, 0.5, 1],
    [x, y + d * k, 0.5, 0],
    [x + d * k, y - d * k, 0, 1],
    [x - d * k, y - d * k, 1, 1],
    [x + d * k, y + d * k, 0, 0],
    [x - d * k, y + d * k, 1, 0],
  ]);

// ── a legend column ──

class Column {
  constructor(x, y, width) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.svg = [];
  }
  heading(s) {
    this.y += 20;
    this.svg.push(text(this.x, this.y, s, { "font-size": 12.5, class: "b" }));
    this.y += 4;
  }
  line(s, { size = 10.5, cls, indent = 0 } = {}) {
    for (const l of wrap(s, Math.floor((this.width - indent) / (size * 0.53)))) {
      this.y += size * 1.3;
      this.svg.push(text(this.x + indent, this.y, l, { "font-size": size, class: cls }));
    }
  }
  /** A swatch drawn by `draw(x, y, w, h)` (its box, 30 x 14 px) beside its words. */
  row(draw, s, opts = {}) {
    const top = this.y + 4;
    this.svg.push(draw(this.x, top, 30, 14));
    const lines = wrap(s, Math.floor((this.width - 38) / (10.5 * 0.53)));
    lines.forEach((l, i) => this.svg.push(text(this.x + 38, top + 11 + i * 13, l, { "font-size": 10.5, class: opts.cls })));
    this.y = top + Math.max(16, lines.length * 13 + 3);
  }
}

// ── the city ──

const tileIdOf = (c, r) => `c${c}_r${r}`;

/** What every city picture shares: the measured city, its tiles, blocks, doors, portals and the look-here marks. */
function cityContext(desc) {
  const m = measureCity(desc); // throws with the validator's sentence when the description is not valid
  const hash = descriptionHash(desc);
  const T = desc.tiles;
  const [tw, td] = T.size;
  const [ox, oy] = T.origin ?? [0, 0];
  const tiles = [];
  for (let r = 0; r < T.rows; r++)
    for (let c = 0; c < T.cols; c++) {
      const id = tileIdOf(c, r);
      tiles.push({ id, c, r, name: T.names?.[id] ?? null, rect: [ox + c * tw, oy + r * td, ox + (c + 1) * tw, oy + (r + 1) * td] }); // prettier-ignore
    }
  const tileAt = (p) => tileIdOf(clamp(Math.floor((p[0] - ox) / tw), 0, T.cols - 1), clamp(Math.floor((p[1] - oy) / td), 0, T.rows - 1)); // prettier-ignore
  const layers = [...m.layers.values()].sort((a, b) => a.level - b.level);
  const blocks = new Map((desc.blocks ?? []).map((b) => [b.id, b]));
  const plazaRect = (n) => (n && n.size ? rectOf(n.at, n.size) : null);

  // streets as polylines in cells: ends at a plaza (or a sized gate) cut at its edge, winding ways as zigzags
  const geom = new Map();
  for (const s of m.segments.values()) {
    const A = m.nodes.get(s.from);
    const B = m.nodes.get(s.to);
    let [a, b] = [A.at, B.at];
    if (plazaRect(A)) a = exitPoint(A.at, B.at, plazaRect(A));
    if (plazaRect(B)) b = exitPoint(B.at, A.at, plazaRect(B));
    const cut = s.straight > 0 ? dist(a, b) / s.straight : 1;
    const pts = s.winding || s.length > s.straight * 1.01 ? zigzag(a, b, s.length * cut) : [a, b];
    geom.set(s.id, { seg: s, pts, winding: pts.length > 2 });
  }
  const incident = new Map();
  for (const s of m.segments.values())
    for (const id of [s.from, s.to]) (incident.get(id) ?? incident.set(id, []).get(id)).push(s);
  const nodeHalfWidth = (id) => Math.max(0, ...(incident.get(id) ?? []).filter((s) => s.class !== "service").map((s) => s.width / 2)); // prettier-ignore

  const buildings = [...m.buildings.values()];
  const fpRect = (b) => rectOf(b.at, b.footprint);
  const blockRect = (b) => {
    const bl = blocks.get(b.block);
    return bl ? rectOf(b.at, bl.size) : null;
  };
  const category = (b) =>
    b.owner === "msr" || b.type === "msr" ? "msr" : b.owner === "insurgents" || b.type === "insurgent" ? "insurgent" : b.residential ? "home" : "business"; // prettier-ignore
  const homesOf = (b) => Object.entries(b.homes ?? {}).filter(([, n]) => n > 0);
  const homesCount = (b) => homesOf(b).reduce((a, [, n]) => a + n, 0);
  const secretDoors = new Map();
  for (const s of desc.secrets ?? []) if (s.kind === "door") secretDoors.set(s.in, (secretDoors.get(s.in) ?? 0) + 1);

  /** The door: the point of the footprint nearest its frontage, the frontage point, the gap to the street's edge. */
  const doorOf = (b) => {
    const fp = fpRect(b);
    const g = geom.get(b.frontage);
    let target;
    let gap;
    if (g) {
      target = nearestOnLine(b.at, g.pts);
      gap = lineRectDist(g.pts, fp) - g.seg.width / 2;
    } else {
      const n = m.nodes.get(b.frontage);
      const pr = plazaRect(n);
      if (pr) {
        target = [clamp(b.at[0], pr[0], pr[2]), clamp(b.at[1], pr[1], pr[3])];
        gap = rectRectDist(fp, pr);
      } else {
        target = n.at;
        gap = pointRectDist(n.at, fp) - nodeHalfWidth(n.id);
      }
    }
    const at = [clamp(target[0], fp[0], fp[2]), clamp(target[1], fp[1], fp[3])];
    const e = 1e-6;
    const normal =
      Math.abs(at[0] - fp[0]) < e ? [-1, 0] : Math.abs(at[0] - fp[2]) < e ? [1, 0] : Math.abs(at[1] - fp[1]) < e ? [0, -1] : Math.abs(at[1] - fp[3]) < e ? [0, 1] : null; // prettier-ignore
    return { at, target, gap: Math.max(0, gap), normal };
  };

  // portals: where each stands and on which layers it is drawn
  const portals = [];
  const seamPoint = (seam, p, q) => {
    const [ta, tb] = String(seam).split("|").map((s) => tiles.find((t) => t.id === s));
    if (!ta || !tb || !p || !q) return p && q ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] : null;
    const bx = ta.c !== tb.c ? ox + Math.max(ta.c, tb.c) * tw : null;
    const by = ta.r !== tb.r ? oy + Math.max(ta.r, tb.r) * td : null;
    if (bx !== null && by !== null) return [bx, by];
    if (bx !== null) {
      const t = q[0] !== p[0] ? (bx - p[0]) / (q[0] - p[0]) : 0.5;
      return [bx, p[1] + (q[1] - p[1]) * clamp(t, 0, 1)];
    }
    const t = q[1] !== p[1] ? (by - p[1]) / (q[1] - p[1]) : 0.5;
    return [p[0] + (q[0] - p[0]) * clamp(t, 0, 1), by];
  };
  for (const p of T.portals ?? []) {
    let layersOf = [];
    let ends = null;
    if (p.segment && m.segments.has(p.segment)) {
      const s = m.segments.get(p.segment);
      layersOf = [s.layer];
      ends = [m.nodes.get(s.from).at, m.nodes.get(s.to).at];
    } else if (p.connector) {
      const c = m.connectors.find((x) => x.id === p.connector);
      if (c) {
        layersOf = [...new Set(c.stops.map((s) => m.layerOf(s)))];
        ends = [m.posOf(c.stops[0]), m.posOf(c.stops[c.stops.length - 1])];
      }
    } else if (p.secret) {
      const s = (desc.secrets ?? []).find((x) => x.id === p.secret);
      if (s && s.kind === "passage") (layersOf = [m.layerOf(s.from)]), (ends = [m.posOf(s.from), m.posOf(s.to)]);
    } else if (p.passage) {
      const [from, to] = String(p.passage).split(">");
      if (m.buildings.has(from)) (layersOf = [m.buildings.get(from).layer]), (ends = [m.posOf(from), m.posOf(to)]);
    }
    const at = Array.isArray(p.at) ? p.at : ends ? seamPoint(p.seam, ends[0], ends[1]) : null;
    if (at) portals.push({ ...p, at, layers: layersOf.filter(Boolean) });
  }

  // look-here marks: what a person should look at, numbered per layer
  const looks = new Map(layers.map((L) => [L.id, []]));
  const look = (layer, at, words, ids) => looks.get(layer)?.push({ at, words, ids });
  for (const L of layers) {
    const bs = buildings.filter((b) => b.layer === L.id);
    const segs = [...geom.values()].filter((g) => g.seg.layer === L.id && g.seg.class !== "service" && !g.winding);
    for (const b of bs) {
      const fp = fpRect(b);
      for (const g of segs) {
        const depth = g.seg.width / 2 - lineRectDist(g.pts, fp);
        if (depth > 0.25) look(L.id, b.at, `${b.id} stands ${f(depth)} cells into ${g.seg.class} ${g.seg.id}`, [b.id, g.seg.id]); // prettier-ignore
      }
      for (const n of m.nodes.values()) {
        const pr = n.layer === L.id && n.id !== b.frontage ? plazaRect(n) : null;
        if (pr && rectsMeet(fp, pr) && overlapDepth(fp, pr) > 0.25) look(L.id, b.at, `${b.id} stands ${f(overlapDepth(fp, pr))} cells into ${n.kind} ${n.id}`, [b.id, n.id]); // prettier-ignore
      }
      const d = m.districts.get(b.district);
      const out = Math.max(d.area[0] - fp[0], d.area[1] - fp[1], fp[2] - d.area[2], fp[3] - d.area[3]);
      if (out > 0.01) look(L.id, b.at, `${b.id} reaches ${f(out)} cells outside its district ${d.id}`, [b.id, d.id]);
      const e = 0.001;
      const ts = new Set([[fp[0] + e, fp[1] + e], [fp[2] - e, fp[1] + e], [fp[0] + e, fp[3] - e], [fp[2] - e, fp[3] - e]].map(tileAt)); // prettier-ignore
      if (ts.size > 1) look(L.id, b.at, `${b.id} straddles the seam of ${[...ts].sort().join(", ")}`, [b.id]);
      const door = doorOf(b);
      if (door.gap > 1) look(L.id, door.at, `${b.id}'s door is ${f(door.gap)} cells from its frontage ${b.frontage}`, [b.id, b.frontage]); // prettier-ignore
    }
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const [a, b] = [fpRect(bs[i]), fpRect(bs[j])];
        if (rectsMeet(a, b) && overlapDepth(a, b) > 0.01) look(L.id, [(Math.max(a[0], b[0]) + Math.min(a[2], b[2])) / 2, (Math.max(a[1], b[1]) + Math.min(a[3], b[3])) / 2], `${bs[i].id} and ${bs[j].id} overlap`, [bs[i].id, bs[j].id]); // prettier-ignore
      }
    for (const g of [...geom.values()].filter((x) => x.seg.layer === L.id)) {
      const s = g.seg;
      const [A, B] = [m.nodes.get(s.from).at, m.nodes.get(s.to).at];
      if (tileAt(A) === tileAt(B)) continue;
      if (portals.some((p) => p.segment === s.id)) continue;
      look(L.id, seamPoint(`${tileAt(A)}|${tileAt(B)}`, A, B), `${s.id} crosses from ${tileAt(A)} to ${tileAt(B)} with no portal`, [s.id]); // prettier-ignore
    }
  }

  // required places: where each is marked
  const required = [];
  for (const r of desc.required ?? []) {
    if (r.building && m.buildings.has(r.building)) required.push({ id: r.id, layer: m.buildings.get(r.building).layer, at: m.buildings.get(r.building).at }); // prettier-ignore
    else if (r.node && m.nodes.has(r.node)) required.push({ id: r.id, layer: m.nodes.get(r.node).layer, at: m.nodes.get(r.node).at }); // prettier-ignore
    else if (r.type) for (const b of buildings) if (b.type === r.type && (!r.district || b.district === r.district)) required.push({ id: r.id, layer: b.layer, at: b.at }); // prettier-ignore
  }
  const spawnPoints = (Array.isArray(desc.spawns?.points) ? desc.spawns.points : []).filter((p) => p && Array.isArray(p.at)); // prettier-ignore

  return { desc, m, hash, tiles, tileAt, layers, blocks, geom, plazaRect, nodeHalfWidth, buildings, fpRect, blockRect, category, homesOf, homesCount, secretDoors, doorOf, portals, looks, required, spawnPoints }; // prettier-ignore
}

const homesText = (C, b) => {
  const hs = C.homesOf(b);
  if (!hs.length) return "";
  const n = hs.reduce((a, [, k]) => a + k, 0);
  return `${n} home${n === 1 ? "" : "s"} (${hs.map(([c, k]) => `${k} ${c}`).join(", ")})`;
};

/** Numbers of one layer for the legend and the overview. */
function layerNumbers(C, L) {
  const { m, desc } = C;
  const bs = C.buildings.filter((b) => b.layer === L.id);
  const enterable = bs.filter((b) => b.interior);
  const lots = (desc.blocks ?? []).filter((bl) => m.districts.get(bl.district)?.layer === L.id).reduce((a, bl) => a + bl.lots, 0); // prettier-ignore
  const homes = {};
  for (const b of bs) for (const [c, n] of C.homesOf(b)) homes[c] = (homes[c] ?? 0) + n;
  const pairs = new Map();
  for (const c of m.connectors)
    for (const k of c.links) {
      if (m.layerOf(k.lo) !== L.id && m.layerOf(k.hi) !== L.id) continue;
      const key = `${m.layerOf(k.lo)}-${m.layerOf(k.hi)}`;
      const row = pairs.get(key) ?? pairs.set(key, { pair: key, items: [] }).get(key);
      row.items.push(c);
    }
  return {
    districts: [...m.districts.values()].filter((d) => d.layer === L.id),
    enterable: enterable.length,
    cap: desc.rules?.buildings?.maxEnterablePerLayer ?? null,
    lots,
    homes,
    homesTotal: Object.values(homes).reduce((a, n) => a + n, 0),
    plazas: [...m.nodes.values()].filter((n) => n.layer === L.id && n.kind === "plaza").length,
    pairs: [...pairs.values()],
    checkpoints: m.checkpoints.filter((k) => m.nodes.get(k.node)?.layer === L.id).length,
    secrets: m.secrets.filter((s) => s.layer === L.id).length,
  };
}
const pairText = (row) => {
  const by = {};
  for (const c of row.items) {
    const k = c.access === "public" ? c.type : `${c.type} (${c.access})`;
    by[k] = (by[k] ?? 0) + 1;
  }
  return `${row.pair}: ${row.items.length} (${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ")})`;
};

const PAD = 16;
const HEADER = 62;
const LEGEND_W = 310;

/** One plan of a city layer over a window of cells: the whole layer, or one tile with full labels. */
function cityView(C, { kind, L, win, s, tile = null }) {
  const { m, desc } = C;
  const full = kind === "tile";
  const [x0, y0, x1, y1] = win;
  const mapW = (x1 - x0) * s;
  const mapH = (y1 - y0) * s;
  const MX = PAD;
  const MY = HEADER;
  const X = (x) => MX + (x - x0) * s;
  const Y = (y) => MY + (y1 - y) * s;
  const P = (p) => `${f(X(p[0]))},${f(Y(p[1]))}`;
  const R = (r) => ({ x: X(r[0]), y: Y(r[3]), width: (r[2] - r[0]) * s, height: (r[3] - r[1]) * s });
  const box = (r) => [X(r[0]), Y(r[3]), X(r[2]), Y(r[1])];
  const path = (pts) => `M${pts.map(P).join("L")}`;
  const inWin = (p, pad = 0) => p[0] >= x0 - pad && p[0] <= x1 + pad && p[1] >= y0 - pad && p[1] <= y1 + pad;
  const rectIn = (r) => rectsMeet(r, win);
  const gr = full ? 9 : 5.5; // glyph radius, px
  const G = { bg: [], dist: [], blocks: [], streets: [], plazas: [], bldg: [], over: [], grid: [], glyph: [], look: [] }; // prettier-ignore
  const labels = new Labels([MX + 2, MY + 2, MX + mapW - 2, MY + mapH - 2]);
  const shows = { buildings: [], connectors: [], checkpoints: [], portals: [], required: [], looks: [] };

  // ground: no floor outside the layer's bounds
  G.bg.push(el("rect", { ...R(win), fill: "url(#nofloor)" }));
  const lb = rectClip(L.bounds, win);
  if (lb) G.bg.push(el("rect", { ...R(lb), fill: "#f7f5ef" }));
  const districts = [...m.districts.values()].filter((d) => d.layer === L.id && rectIn(d.area));
  for (const d of districts) {
    const r = R(d.area);
    G.dist.push(el("rect", { ...r, fill: WEALTH_FILL[d.wealth] ?? "#ddd" }));
    if (d.wear > 0) G.dist.push(el("rect", { ...r, fill: `url(#wear${Math.min(3, d.wear)})` }));
    G.dist.push(el("rect", { ...r, fill: "none", stroke: "#6d6150", "stroke-width": 1.2 }));
  }

  // blocks: the block's size about its building, cut into its lots; facades hatched
  const bs = C.buildings.filter((b) => b.layer === L.id && rectIn(C.blockRect(b) ?? C.fpRect(b)));
  for (const b of bs) {
    const br = C.blockRect(b);
    if (!br) continue;
    const bl = C.blocks.get(b.block);
    G.blocks.push(el("rect", { ...R(br), fill: "url(#hatch)", stroke: "#7a6e5e", "stroke-width": 1 }));
    const along = br[2] - br[0] >= br[3] - br[1] ? 0 : 1;
    for (let i = 1; i < bl.lots; i++) {
      const t = i / bl.lots;
      const [a, c] = along === 0 ? [[br[0] + (br[2] - br[0]) * t, br[1]], [br[0] + (br[2] - br[0]) * t, br[3]]] : [[br[0], br[1] + (br[3] - br[1]) * t], [br[2], br[1] + (br[3] - br[1]) * t]]; // prettier-ignore
      G.blocks.push(el("path", { d: path([a, c]), stroke: "#7a6e5e", "stroke-width": 0.8, "stroke-dasharray": "3 2" }));
    }
  }

  // streets: casing, sidewalk or quay band, carriageway or water, lane line; junctions as discs
  const geoms = [...C.geom.values()].filter((g) => g.seg.layer === L.id);
  const ways = geoms.filter((g) => g.seg.class !== "service");
  const look = (cls) => STREET_LOOK[cls] ?? OTHER_LOOK;
  const edgeOf = (sg) => Math.max(sg.sidewalk ?? 0, sg.portico ?? 0); // carriageway = width - 2 x max(sidewalk, portico)
  const discs = [];
  for (const n of m.nodes.values()) {
    if (n.layer !== L.id || C.plazaRect(n)) continue;
    const inc = ways.filter((g) => g.seg.from === n.id || g.seg.to === n.id).map((g) => g.seg);
    if (!inc.length) continue;
    const widest = inc.reduce((a, b) => (b.width > a.width ? b : a));
    discs.push({ at: n.at, seg: widest });
  }
  const pass = (stroke, widthOf) => {
    for (const g of ways) {
      const w = widthOf(g.seg);
      if (w > 0) G.streets.push(el("path", { d: path(g.pts), fill: "none", stroke: stroke(g.seg), "stroke-width": w, "stroke-linejoin": "round" })); // prettier-ignore
    }
    for (const d of discs) {
      const w = widthOf(d.seg);
      if (w > 0) G.streets.push(el("circle", { cx: X(d.at[0]), cy: Y(d.at[1]), r: w / 2, fill: stroke(d.seg) }));
    }
  };
  pass(() => CASING, (sg) => sg.width * s + 2);
  pass((sg) => look(sg.class).band, (sg) => sg.width * s);
  pass((sg) => look(sg.class).way, (sg) => (edgeOf(sg) > 0 ? (sg.width - 2 * edgeOf(sg)) * s : 0));
  // porticoes: a colonnade along both sides, at the line between the portico and the carriageway
  for (const g of ways) {
    const pt = g.seg.portico ?? 0;
    if (!(pt > 0)) continue;
    const off = g.seg.width / 2 - pt;
    const step = full ? 1 : 1.5;
    for (let i = 1; i < g.pts.length; i++) {
      const [a, b] = [g.pts[i - 1], g.pts[i]];
      const D = dist(a, b);
      if (D < 1e-6) continue;
      const [ux, uy] = [(b[0] - a[0]) / D, (b[1] - a[1]) / D];
      for (let t = step / 2; t < D; t += step)
        for (const side of [-1, 1]) {
          const q = [a[0] + ux * t - uy * off * side, a[1] + uy * t + ux * off * side];
          G.streets.push(el("circle", { cx: X(q[0]), cy: Y(q[1]), r: Math.max(1.2, s * 0.14), fill: "#6b5a3a" }));
        }
    }
  }
  for (const g of ways) {
    const lk = look(g.seg.class);
    if (lk.centre && g.seg.lanes >= 2 && g.seg.width * s > 14) G.streets.push(el("path", { d: path(g.pts), fill: "none", stroke: lk.centre, "stroke-width": 1, "stroke-dasharray": "6 5" })); // prettier-ignore
    if (lk.ties) G.streets.push(el("path", { d: path(g.pts), fill: "none", stroke: lk.ties, "stroke-width": g.seg.width * s * 0.8, "stroke-dasharray": "1.2 4" })); // prettier-ignore
    if (g.seg.access && g.seg.access !== "public") G.streets.push(el("path", { d: path(g.pts), fill: "none", stroke: INK[g.seg.access] ?? INK.private, "stroke-width": 1.5, "stroke-dasharray": "2 3" })); // prettier-ignore
  }
  // plazas and the gate
  for (const n of m.nodes.values()) {
    const pr = n.layer === L.id ? C.plazaRect(n) : null;
    if (!pr || !rectIn(pr)) continue;
    const rx = n.cornerRadius ? n.cornerRadius * s : 0;
    G.plazas.push(el("rect", { ...R(pr), rx, fill: n.kind === "gate" ? "#e6d199" : "#f2ead6", stroke: CASING, "stroke-width": n.kind === "gate" ? 3 : 1.4 })); // prettier-ignore
    if (n.kind === "gate") G.plazas.push(el("rect", { ...R(pr), fill: "none", stroke: CASING, "stroke-width": 1, "stroke-dasharray": "4 3", transform: `translate(0 0)` })); // prettier-ignore
  }
  // the MSR's service hallways: translucent red bands
  for (const g of geoms.filter((x) => x.seg.class === "service")) {
    G.over.push(el("path", { d: path(g.pts), fill: "none", stroke: look("service").band, "stroke-opacity": 0.3, "stroke-width": g.seg.width * s, "stroke-linejoin": "round" })); // prettier-ignore
    G.over.push(el("path", { d: path(g.pts), fill: "none", stroke: "#8e1f15", "stroke-width": 1, "stroke-dasharray": "4 3" })); // prettier-ignore
  }

  // buildings: footprint by kind, the door toward its frontage, a red line when the door falls short of it
  const fpBoxes = new Map();
  for (const b of bs) {
    const fp = C.fpRect(b);
    const ink = "#111";
    const parts = [el("title", {}, esc(`${b.id}: ${b.type} (${b.variant}), ${b.storeys} storeys, ${b.footprint.join(" x ")} cells${homesText(C, b) ? `, ${homesText(C, b)}` : ""}, front ${b.frontage}`))]; // prettier-ignore
    parts.push(el("rect", { ...R(fp), fill: b.interior ? BUILDING_FILL[C.category(b)] : "url(#hatch)", stroke: ink, "stroke-width": full ? 2.2 : 1.6 })); // prettier-ignore
    const door = C.doorOf(b);
    if (door.normal) {
      const [px, py] = [X(door.at[0]), Y(door.at[1])];
      const [nx, ny] = [door.normal[0], -door.normal[1]];
      const k = full ? 7 : 4.5;
      parts.push(el("path", { d: `M${f(px - ny * k)},${f(py + nx * k)}L${f(px + nx * k * 1.2)},${f(py + ny * k * 1.2)}L${f(px + ny * k)},${f(py - nx * k)}z`, fill: ink })); // prettier-ignore
    }
    if (door.gap > 0.5) parts.push(el("path", { d: path([door.at, door.target]), stroke: WARN, "stroke-width": 1.5, "stroke-dasharray": "4 3" })); // prettier-ignore
    G.bldg.push(el("g", { id: `b-${b.id}` }, parts.join("")));
    fpBoxes.set(b.id, box(fp));
  }

  // passages from buildings (the MSR's to its hallways, the insurgents' to their plaza) and secret passages
  for (const b of C.buildings.filter((x) => x.layer === L.id))
    for (const ps of b.passages ?? []) {
      const q = m.posOf(ps.to);
      if (!q || (!inWin(b.at) && !inWin(q))) continue;
      const acc = ps.access ?? "public";
      G.over.push(el("path", { d: path([b.at, q]), stroke: ps.type === "secret" ? SECRET : (INK[acc] ?? INK.private), "stroke-width": 1.6, "stroke-dasharray": ps.type === "secret" ? "1.5 3" : "6 3", fill: "none" })); // prettier-ignore
    }
  for (const sc of desc.secrets ?? []) {
    if (sc.kind !== "passage" || m.layerOf(sc.from) !== L.id) continue;
    const [a, b] = [m.posOf(sc.from), m.posOf(sc.to)];
    if (!inWin(a) && !inWin(b)) continue;
    const pts = sc.winding || sc.length > dist(a, b) * 1.01 ? zigzag(a, b, sc.length) : [a, b];
    G.over.push(el("g", {}, el("title", {}, esc(`secret passage ${sc.id}: ${sc.from} to ${sc.to}, ${sc.length} cells`)) + el("path", { d: path(pts), fill: "none", stroke: SECRET, "stroke-width": full ? 2.4 : 1.6, "stroke-dasharray": "1.5 3", "stroke-linecap": "round" }))); // prettier-ignore
  }

  // tile seams on top of the ground; portals on them
  for (const t of C.tiles) {
    if (!rectIn(t.rect)) continue;
    for (const [a, b] of [[[t.rect[0], t.rect[1]], [t.rect[0], t.rect[3]]], [[t.rect[0], t.rect[1]], [t.rect[2], t.rect[1]]]]) // prettier-ignore
      G.grid.push(el("path", { d: path([a, b]), stroke: "#1a5c8a", "stroke-width": 1.6, "stroke-dasharray": "9 5", fill: "none" })); // prettier-ignore
  }
  const portalsHere = C.portals.filter((p) => p.layers.includes(L.id) && inWin(p.at));
  for (const p of portalsHere) {
    G.grid.push(portalGlyph(X(p.at[0]), Y(p.at[1]), full ? 6 : 3.8));
    labels.block([X(p.at[0]) - 4, Y(p.at[1]) - 4, X(p.at[0]) + 4, Y(p.at[1]) + 4]);
    shows.portals.push(p.id);
  }

  // connectors at their stops: a glyph each (side by side when several share a stop), the run to the next stop
  const atStop = new Map();
  for (const c of m.connectors)
    c.stops.forEach((stop, i) => {
      if (m.layerOf(stop) !== L.id) return;
      const p = m.posOf(stop);
      if (!inWin(p)) return;
      (atStop.get(stop) ?? atStop.set(stop, []).get(stop)).push({ c, i, p });
    });
  const connLabels = [];
  for (const list of atStop.values())
    list.forEach(({ c, i, p }, k) => {
      const [cx, cy] = [X(p[0]) + (k - (list.length - 1) / 2) * gr * 2.9, Y(p[1])];
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= c.stops.length) continue;
        const q = m.posOf(c.stops[j]);
        if (dist(p, q) < 0.5) continue;
        G.over.push(el("path", { d: `M${f(cx)},${f(cy)}L${P(q)}`, stroke: c.type === "secret" ? SECRET : (INK[c.access] ?? INK.public), "stroke-width": 1.2, "stroke-dasharray": "5 3", fill: "none" })); // prettier-ignore
        G.over.push(el("circle", { cx: X(q[0]), cy: Y(q[1]), r: gr * 0.45, fill: "none", stroke: INK[c.access] ?? INK.public, "stroke-width": 1 })); // prettier-ignore
      }
      const up = i < c.stops.length - 1 ? m.layerOf(c.stops[i + 1]) : null;
      const down = i > 0 ? m.layerOf(c.stops[i - 1]) : null;
      const way = [up ? `up to ${up}` : "", down ? `down to ${down}` : ""].filter(Boolean).join(", ");
      G.glyph.push(el("g", { id: `c-${c.id}-${i}` }, el("title", {}, esc(`${c.id} ${c.name ? `(${c.name}) ` : ""}${c.type}, ${c.access}: ${c.stops.join(" > ")}`)) + glyph(c.type, cx, cy, gr, c.access))); // prettier-ignore
      labels.block([cx - gr * 1.4, cy - gr * 1.4, cx + gr * 1.4, cy + gr * 1.4]);
      connLabels.push({ c, cx, cy, way, i });
      if (!shows.connectors.includes(c.id)) shows.connectors.push(c.id);
    });
  // checkpoints (up and left of their node), required places (up and right)
  const cpLabels = [];
  for (const k of m.checkpoints) {
    const n = m.nodes.get(k.node);
    if (!n || n.layer !== L.id || !inWin(n.at)) continue;
    const [cx, cy] = [X(n.at[0]) - gr * 2.4, Y(n.at[1]) - gr * 2.4];
    G.glyph.push(el("g", {}, el("title", {}, esc(`${k.id}: controls ${(k.controls ?? []).join(", ")}; ${k.reason ?? ""}`)) + checkpointGlyph(cx, cy, gr * 1.05))); // prettier-ignore
    labels.block([cx - gr * 1.1, cy - gr * 1.1, cx + gr * 1.1, cy + gr * 1.1]);
    cpLabels.push({ k, cx, cy });
    shows.checkpoints.push(k.id);
  }
  const reqLabels = [];
  for (const r of C.required) {
    if (r.layer !== L.id || !inWin(r.at)) continue;
    const [cx, cy] = [X(r.at[0]) + gr * 2.4, Y(r.at[1]) - gr * 2.4];
    G.glyph.push(starGlyph(cx, cy, gr * 1.15));
    labels.block([cx - gr * 1.1, cy - gr * 1.1, cx + gr * 1.1, cy + gr * 1.1]);
    reqLabels.push({ r, cx, cy });
    if (!shows.required.includes(r.id)) shows.required.push(r.id);
  }
  for (const sp of C.spawnPoints)
    if ((sp.layer ?? L.id) === L.id && inWin(sp.at)) G.glyph.push(spawnGlyph(X(sp.at[0]), Y(sp.at[1]), full ? 5 : 3));
  // look-here marks, numbered across the layer (the same numbers in its tiles)
  const looksHere = C.looks.get(L.id).map((lk, i) => ({ ...lk, n: i + 1 })).filter((lk) => inWin(lk.at));
  for (const lk of looksHere) {
    const [cx, cy] = [X(lk.at[0]) + gr * 1.2, Y(lk.at[1]) + gr * 1.2];
    G.look.push(lookGlyph(cx, cy, full ? 8 : 6, lk.n));
    labels.block([cx - 8, cy - 8, cx + 8, cy + 8]);
    shows.looks.push(lk.n);
  }

  // labels, most important first; the scale bar's and the north arrow's corners kept clear
  labels.block([MX, MY + mapH - 48, MX + Math.max(230, 0), MY + mapH]);
  labels.block([MX + mapW - 44, MY, MX + mapW, MY + 52]);
  for (const bx of fpBoxes.values()) labels.block(bx);
  for (const d of districts) {
    const r = rectClip(d.area, win);
    const [bx0, by0, bx1, by1] = box(r);
    const lines = [{ text: d.name, size: full ? 15 : 13, cls: "b" }, { text: `${d.id} · ${d.wealth} · wear ${d.wear} · ${d.density}`, size: full ? 10 : 9, cls: "d" }]; // prettier-ignore
    labels.place(lines, [[bx0 + 5, by0 + 4, 0, 0], [bx1 - 5, by0 + 4, 1, 0], [bx0 + 5, by1 - 4, 0, 1], [bx1 - 5, by1 - 4, 1, 1], [bx0 + 5, (by0 + by1) / 2, 0, 0.5]], { force: true }); // prettier-ignore
  }
  for (const b of bs) {
    if (!rectIn(C.fpRect(b))) continue;
    const bx = fpBoxes.get(b.id);
    const [cx, cy] = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
    const lines = full
      ? [
          { text: b.id, size: 11.5, cls: "b" },
          { text: `${b.type}, ${b.storeys} storey${b.storeys === 1 ? "" : "s"}, ${b.footprint.join("x")}`, size: 9.5 },
          homesText(C, b) ? { text: homesText(C, b), size: 9.5 } : null,
          C.secretDoors.get(b.id) ? { text: `${C.secretDoors.get(b.id)} secret door${C.secretDoors.get(b.id) === 1 ? "" : "s"}`, size: 9.5, cls: "s" } : null, // prettier-ignore
        ]
      : [{ text: b.id, size: 9, cls: "b" }, C.homesCount(b) ? { text: `${b.type} · ${C.homesCount(b)} homes`, size: 8 } : { text: b.type, size: 8 }]; // prettier-ignore
    const g = 3;
    const cands = [[cx, cy, 0.5, 0.5], [cx, bx[1] - g, 0.5, 1], [cx, bx[3] + g, 0.5, 0], [bx[2] + g, cy, 0, 0.5], [bx[0] - g, cy, 1, 0.5], [bx[2] + g, bx[1] - g, 0, 1], [bx[0] - g, bx[1] - g, 1, 1], [bx[2] + g, bx[3] + g, 0, 0], [bx[0] - g, bx[3] + g, 1, 0], ...around(cx, cy, Math.max(bx[2] - bx[0], bx[3] - bx[1]) * 0.5 + 18, [1, 1.6, 2.4])]; // prettier-ignore
    const placed = labels.place(lines, cands, { force: full, leader: [cx, cy], ignore: bx });
    if (!placed && !full) labels.place([{ text: b.id, size: 9, cls: "b" }], cands, { leader: [cx, cy], ignore: bx });
    shows.buildings.push(b.id);
  }
  for (const { c, cx, cy, way } of connLabels) {
    const lines = full
      ? [{ text: c.id, size: 11, cls: "b" }, { text: `${c.type}${c.name ? `, ${c.name}` : ""}`, size: 9.5 }, { text: `${way}${c.access !== "public" ? ` (${c.access})` : ""}`, size: 9.5, cls: c.access !== "public" ? "w" : "d" }] // prettier-ignore
      : [{ text: c.id, size: 9, cls: c.type === "secret" ? "b s" : "b" }];
    labels.place(lines, around(cx, cy, gr * 1.6 + 2, full ? [1, 2, 3.2, 4.5] : [1, 1.8]), { force: full, leader: [cx, cy] }); // prettier-ignore
  }
  for (const { k, cx, cy } of cpLabels)
    labels.place(full ? [{ text: k.id, size: 10.5, cls: "w" }, { text: `controls ${(k.controls ?? []).join(", ")}`, size: 9 }] : [{ text: k.id, size: 8.5, cls: "w" }], around(cx, cy, gr * 1.3 + 2, full ? [1, 2, 3.2] : [1, 1.8]), { force: full, leader: [cx, cy] }); // prettier-ignore
  for (const { r, cx, cy } of reqLabels)
    labels.place([{ text: `required: ${r.id}`, size: full ? 10 : 8.5, cls: "b" }], around(cx, cy, gr * 1.3 + 2, full ? [1, 2, 3.2] : [1, 1.8]), { force: full, leader: [cx, cy] }); // prettier-ignore
  for (const n of m.nodes.values()) {
    const pr = n.layer === L.id ? C.plazaRect(n) : null;
    if (!pr || !rectIn(pr) || !n.name) continue;
    const bx = box(pr);
    const [cx, cy] = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
    labels.place([{ text: n.kind === "gate" ? `${n.name} (gate${n.outside ? ", to outside" : ""})` : n.name, size: full ? 11 : 9, cls: n.kind === "gate" ? "b" : "i" }], [[cx, cy, 0.5, 0.5], [cx, bx[1] + 3, 0.5, 0], [cx, bx[3] - 3, 0.5, 1], ...around(cx, cy, (bx[2] - bx[0]) / 2 + 6)], { force: n.kind === "gate" }); // prettier-ignore
  }
  if (full) {
    for (const p of portalsHere) labels.place([{ text: p.id, size: 8.5, cls: "d" }], around(X(p.at[0]), Y(p.at[1]), 6, [1, 2, 3]), { force: true, leader: [X(p.at[0]), Y(p.at[1])] }); // prettier-ignore
    for (const n of m.nodes.values()) {
      if (n.layer !== L.id || !inWin(n.at) || C.plazaRect(n)) continue;
      labels.place([{ text: n.id, size: 8.5, cls: "d" }], around(X(n.at[0]), Y(n.at[1]), C.nodeHalfWidth(n.id) * s + 4, [1, 1.6]), { leader: [X(n.at[0]), Y(n.at[1])] }); // prettier-ignore
    }
    for (const g of geoms) {
      const mid = g.pts[Math.floor((g.pts.length - 1) / 2)];
      const nxt = g.pts[Math.floor((g.pts.length - 1) / 2) + 1];
      const at = [(mid[0] + nxt[0]) / 2, (mid[1] + nxt[1]) / 2];
      if (!inWin(at)) continue;
      labels.place([{ text: `${g.seg.id} (${g.seg.class} ${f(g.seg.width)}${g.seg.portico ? `, portico ${f(g.seg.portico)}` : ""})`, size: 8.5, cls: g.seg.class === "service" ? "w" : "d" }], around(X(at[0]), Y(at[1]), g.seg.width * s * 0.5 + 3, [1, 1.5]), { leader: [X(at[0]), Y(at[1])] }); // prettier-ignore
    }
  }
  for (const t of C.tiles) {
    const r = rectClip(t.rect, win);
    if (!r) continue;
    const [bx0, , , by1] = box(r);
    labels.place([{ text: `${t.id}${t.name ? ` ${t.name}` : ""}`, size: full ? 11 : 10, cls: "b" }], [[bx0 + 4, by1 - 4, 0, 1], [bx0 + 4, by1 - 22, 0, 1]], {}); // prettier-ignore
  }

  // scale bar and north arrow, in the map's corners
  const nice = [1, 2, 4, 5, 10, 20, 40].find((n) => n * s >= 70) ?? 40;
  const sb = { x: MX + 10, y: MY + mapH - 40, w: Math.max(nice * s + 20, 210), h: 32 };
  const cell = desc.grid.cell;
  const scale = [el("rect", { x: sb.x, y: sb.y, width: sb.w, height: sb.h, fill: "#fff", "fill-opacity": 0.9, stroke: "#555", "stroke-width": 0.8 })]; // prettier-ignore
  for (let i = 0; i < 4; i++) scale.push(el("rect", { x: sb.x + 10 + (i * nice * s) / 4, y: sb.y + 6, width: (nice * s) / 4, height: 6, fill: i % 2 ? "#fff" : "#111", stroke: "#111", "stroke-width": 0.8 })); // prettier-ignore
  scale.push(text(sb.x + 10, sb.y + 25, `${nice} cell${nice === 1 ? "" : "s"} = ${f(nice * cell)} m = ${f(nice * desc.grid.cellUnits)} units`, { "font-size": 10 })); // prettier-ignore
  labels.block([sb.x, sb.y, sb.x + sb.w, sb.y + sb.h]);
  const na = { x: MX + mapW - 26, y: MY + 12 };
  const north = el("path", { d: `M${f(na.x)},${f(na.y)}L${f(na.x + 8)},${f(na.y + 22)}L${f(na.x)},${f(na.y + 17)}L${f(na.x - 8)},${f(na.y + 22)}z`, fill: "#111", stroke: "#fff", "stroke-width": 1 }) + text(na.x, na.y + 34, "N", { "font-size": 12, "text-anchor": "middle", class: "h b" }); // prettier-ignore

  // the legend
  const col = new Column(MX + mapW + PAD, MY - 14, LEGEND_W);
  const nums = layerNumbers(C, L);
  col.heading(full ? `Tile ${tile.id}${tile.name ? ` (${tile.name})` : ""} on ${L.id}` : `${L.id} ${L.name ?? ""}`);
  col.line(`level ${L.level}, z ${L.z[0]} to ${L.z[1]} cells (${f(L.z[0] * cell)} to ${f(L.z[1] * cell)} m), ceiling ${L.ceiling}, ${L.wealth}`); // prettier-ignore
  col.line(`enterable buildings ${nums.enterable}${nums.cap ? ` of ${nums.cap} allowed` : ""}, lots ${nums.lots}; homes ${nums.homesTotal}${nums.homesTotal ? ` (${Object.entries(nums.homes).map(([c, n]) => `${n} ${c}`).join(", ")})` : ""}; plazas ${nums.plazas}; checkpoints ${nums.checkpoints}; secrets ${nums.secrets}`); // prettier-ignore
  for (const row of nums.pairs) col.line(`connectors ${pairText(row)}`, { indent: 6 });
  if (!C.spawnPoints.length && desc.spawns?.count) col.line(`spawns: ${desc.spawns.count} wanted, none placed yet (stage 4 places them)`, { cls: "d" }); // prettier-ignore
  col.heading("Districts: tint is wealth, dots are wear");
  for (const d of nums.districts)
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: WEALTH_FILL[d.wealth], stroke: "#6d6150" }) + (d.wear ? el("rect", { x, y, width: w, height: h, fill: `url(#wear${Math.min(3, d.wear)})` }) : ""), `${d.name}: ${d.wealth}, wear ${d.wear}, ${d.density}`); // prettier-ignore
  col.row((x, y, w, h) => ["slum", "low", "mid", "high", "elite"].map((k, i) => el("rect", { x: x + (i * w) / 5, y, width: w / 5, height: h, fill: WEALTH_FILL[k] })).join(""), "wealth: slum, low, mid, high, elite"); // prettier-ignore
  col.heading("Streets, widths to scale");
  const used = new Set(geoms.map((g) => g.seg.class));
  for (const [cls, k] of Object.entries(m.classes)) {
    if (!used.has(cls) && !full) continue;
    const lk = look(cls);
    col.row((x, y, w, h) => (cls === "service" ? el("rect", { x, y: y + 3, width: w, height: h - 6, fill: lk.band, "fill-opacity": 0.45 }) : el("rect", { x, y, width: w, height: h, fill: lk.band, stroke: CASING }) + (k.sidewalk ? el("rect", { x, y: y + 3, width: w, height: h - 6, fill: lk.way }) : "")), `${cls}: ${f(k.width)} cells (${f(k.width * cell)} m)${k.sidewalk ? `, ${cls === "canal" ? "quays" : "sidewalks"} ${f(k.sidewalk)}` : ""}${k.access && k.access !== "public" ? `, ${k.access} only` : ""}`); // prettier-ignore
  }
  if (geoms.some((g) => g.seg.portico > 0) || full) col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: STREET_LOOK.avenue.band, stroke: CASING }) + el("rect", { x, y: y + 4, width: w, height: h - 8, fill: STREET_LOOK.avenue.way }) + [3, 9, 15, 21, 27].map((cx) => el("circle", { cx: x + cx, cy: y + 4, r: 1.3, fill: "#6b5a3a" }) + el("circle", { cx: x + cx, cy: y + h - 4, r: 1.3, fill: "#6b5a3a" })).join(""), "portico: a colonnade each side; the carriageway is the width less twice the portico"); // prettier-ignore
  col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#f2ead6", stroke: CASING }), "plaza (its size), the gate in gold"); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}l6,-5l6,10l6,-10l6,10l6,-5`, fill: "none", stroke: "#888", "stroke-width": 2 }), "winding way: its length drawn as schematic bends"); // prettier-ignore
  col.heading("Buildings");
  col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "url(#hatch)", stroke: "#7a6e5e" }), "block (its size about its building), lots dashed; hatched lots are facades, not enterable"); // prettier-ignore
  for (const [k, words] of [["home", "enterable: homes"], ["business", "enterable: shop, bar, workshop, public"], ["msr", "enterable: the MSR"], ["insurgent", "enterable: the insurgents"]]) // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: BUILDING_FILL[k], stroke: "#111", "stroke-width": 1.6 }), words); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x + 8},${y + 2}L${x + 18},${y + h / 2}L${x + 8},${y + h - 2}z`, fill: "#111" }) + el("path", { d: `M${x + 18},${y + h / 2}h12`, stroke: WARN, "stroke-dasharray": "4 3", "stroke-width": 1.5 }), "door toward its frontage; red dashes when it falls short of the street"); // prettier-ignore
  col.heading("Between layers and across tiles");
  for (const [type, words] of [["grand-stair", "grand stair"], ["stair", "stair"], ["ramp", "ramp"], ["lift", "lift"], ["ladder-shaft", "ladder shaft"], ["secret", "secret connector"]]) // prettier-ignore
    col.row((x, y, w, h) => glyph(type, x + 15, y + h / 2, 5.5), words);
  col.row((x, y, w, h) => glyph("lift", x + 15, y + h / 2, 5.5, "msr"), "red: the MSR's own (not public)");
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h24`, stroke: "#151515", "stroke-dasharray": "5 3" }) + el("circle", { cx: x + 26, cy: y + h / 2, r: 3, fill: "none", stroke: "#151515" }), "run of a stair or ramp to its next stop (ring)"); // prettier-ignore
  col.row((x, y, w, h) => checkpointGlyph(x + 15, y + h / 2, 7), "checkpoint (beside the stop it controls)");
  col.row((x, y, w, h) => starGlyph(x + 15, y + h / 2, 7), "required place");
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h30`, stroke: SECRET, "stroke-width": 2, "stroke-dasharray": "1.5 3" }), "secret passage"); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h30`, stroke: INK.msr, "stroke-width": 1.6, "stroke-dasharray": "6 3" }), "building passage (MSR red, insurgents purple)"); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h30`, stroke: "#1a5c8a", "stroke-width": 1.6, "stroke-dasharray": "9 5" }) + portalGlyph(x + 15, y + h / 2, 4.5), "tile seam and a portal on it"); // prettier-ignore
  if (C.spawnPoints.length) col.row((x, y, w, h) => spawnGlyph(x + 15, y + h / 2, 5), "spawn point");
  const looksAll = C.looks.get(L.id).map((lk, i) => ({ ...lk, n: i + 1 }));
  const listed = full ? looksHere : looksAll;
  col.heading(`Look here (${listed.length}${full ? " in this tile" : ""})`);
  col.row((x, y, w, h) => lookGlyph(x + 15, y + h / 2, 7, 1), "an aid for the eye, not a check: check-city judges");
  if (!listed.length) col.line("nothing marked", { cls: "d" });
  for (const lk of listed.slice(0, 40)) col.line(`${lk.n}. ${lk.words}`, { size: 10, cls: "w" });
  if (listed.length > 40) col.line(`... and ${listed.length - 40} more`, { size: 10, cls: "w" });
  if (full) {
    const here = bs.filter((b) => C.tileAt(b.at) === tile.id);
    col.heading(`In this tile: ${here.length} building${here.length === 1 ? "" : "s"}`);
    for (const b of here) col.line(`${b.id}: ${b.type} ${b.variant}, ${b.storeys} st, ${b.footprint.join("x")}${homesText(C, b) ? `, ${homesText(C, b)}` : ""}, front ${b.frontage}`, { size: 10 }); // prettier-ignore
    const cs = shows.connectors;
    if (cs.length) col.heading(`Connectors with a stop here: ${cs.length}`);
    for (const id of cs) {
      const c = m.connectors.find((x) => x.id === id);
      col.line(`${c.id}: ${c.type}${c.access !== "public" ? ` (${c.access})` : ""}, ${c.stops.join(" > ")}`, { size: 10 }); // prettier-ignore
    }
  }
  if (labels.omitted) {
    col.heading("Labels");
    col.line(`${labels.omitted} label${labels.omitted === 1 ? "" : "s"} left off at this zoom; each tile's picture carries them all.`, { cls: "d" }); // prettier-ignore
  }

  const width = MX + mapW + PAD + LEGEND_W + PAD;
  const height = Math.max(MY + mapH + PAD, col.y + PAD + 10);
  const titleText = `${desc.title ?? desc.name}: ${L.id} ${L.name ?? ""}${full ? `, tile ${tile.id}${tile.name ? ` (${tile.name})` : ""}` : ""}`; // prettier-ignore
  const head = [
    text(PAD, 24, titleText, { "font-size": 19, class: "b" }),
    text(PAD, 42, `${desc.name} · ${desc.format} · R1 plan review, ${full ? "tile" : "layer"} picture · 1 cell = ${f(cell)} m = ${desc.grid.cellUnits} units · window x ${f(x0)} to ${f(x1)}, y ${f(y0)} to ${f(y1)} cells`, { "font-size": 11, class: "d" }), // prettier-ignore
    text(PAD, 55, `description sha256 ${C.hash}`, { "font-size": 10, class: "d" }),
  ].join("");
  const clip = el("clipPath", { id: "map" }, el("rect", { x: MX, y: MY, width: mapW, height: mapH }));
  const body = [
    head,
    clip,
    el("g", { "clip-path": "url(#map)" }, [G.bg, G.dist, G.blocks, G.streets, G.plazas, G.bldg, G.over, G.grid, G.glyph, G.look].map((x) => x.join("")).join("\n")), // prettier-ignore
    el("rect", { x: MX, y: MY, width: mapW, height: mapH, fill: "none", stroke: "#222", "stroke-width": 1.2 }),
    el("g", { id: "labels", "clip-path": "url(#map)" }, labels.svg.join("")),
    scale.join(""),
    north,
    el("g", { id: "legend" }, col.svg.join("")),
  ].join("\n");
  const meta = { review: "R1", description: desc.name, sha256: C.hash, picture: full ? "tile" : "layer", layer: L.id, tile: tile?.id ?? null, window: win }; // prettier-ignore
  return { svg: svgDoc(width, height, titleText, meta, body), shows, omitted: labels.omitted };
}

/** The whole city: every layer side by side, small, with the numbers per layer under them. */
function cityOverview(C) {
  const { m, desc } = C;
  const xs = C.layers.flatMap((L) => [L.bounds[0], L.bounds[2]]).concat(C.tiles.flatMap((t) => [t.rect[0], t.rect[2]])); // prettier-ignore
  const ys = C.layers.flatMap((L) => [L.bounds[1], L.bounds[3]]).concat(C.tiles.flatMap((t) => [t.rect[1], t.rect[3]])); // prettier-ignore
  const win = [Math.min(0, ...xs), Math.min(0, ...ys), Math.max(desc.extent.x, ...xs), Math.max(desc.extent.y, ...ys)];
  const s = Math.max(2, Math.min(5, 460 / Math.max(win[2] - win[0], win[3] - win[1])));
  const pw = (win[2] - win[0]) * s;
  const ph = (win[3] - win[1]) * s;
  const top = HEADER + 22;
  const parts = [];
  const shows = { buildings: [], connectors: [], checkpoints: [], portals: [], required: [], looks: [] };
  C.layers.forEach((L, li) => {
    const MX = PAD + li * (pw + PAD * 2);
    const X = (x) => MX + (x - win[0]) * s;
    const Y = (y) => top + (win[3] - y) * s;
    const P = (p) => `${f(X(p[0]))},${f(Y(p[1]))}`;
    const R = (r) => ({ x: X(r[0]), y: Y(r[3]), width: (r[2] - r[0]) * s, height: (r[3] - r[1]) * s });
    const labels = new Labels([MX, top, MX + pw, top + ph]);
    const g = [];
    g.push(el("rect", { ...R(win), fill: "url(#nofloor)" }), el("rect", { ...R(L.bounds), fill: "#f7f5ef" }));
    for (const d of m.districts.values()) {
      if (d.layer !== L.id) continue;
      g.push(el("rect", { ...R(d.area), fill: WEALTH_FILL[d.wealth], stroke: "#6d6150", "stroke-width": 0.8 }));
      if (d.wear) g.push(el("rect", { ...R(d.area), fill: `url(#wear${Math.min(3, d.wear)})` }));
    }
    for (const gm of C.geom.values()) {
      if (gm.seg.layer !== L.id) continue;
      const lk = STREET_LOOK[gm.seg.class] ?? OTHER_LOOK;
      const svc = gm.seg.class === "service";
      g.push(el("path", { d: `M${gm.pts.map(P).join("L")}`, fill: "none", stroke: svc ? lk.band : gm.seg.class === "canal" ? lk.way : "#fdfcf8", "stroke-opacity": svc ? 0.6 : 1, "stroke-width": Math.max(1, gm.seg.width * s), "stroke-linejoin": "round" })); // prettier-ignore
      if (!svc && gm.seg.class !== "canal") g.push(el("path", { d: `M${gm.pts.map(P).join("L")}`, fill: "none", stroke: "#8b8478", "stroke-width": 0.5 })); // prettier-ignore
    }
    for (const n of m.nodes.values()) {
      const pr = n.layer === L.id ? C.plazaRect(n) : null;
      if (pr) g.push(el("rect", { ...R(pr), fill: n.kind === "gate" ? "#e6d199" : "#f2ead6", stroke: CASING, "stroke-width": 0.8 })); // prettier-ignore
    }
    for (const b of C.buildings) {
      if (b.layer !== L.id) continue;
      const br = C.blockRect(b);
      if (br) g.push(el("rect", { ...R(br), fill: "url(#hatch)", stroke: "#7a6e5e", "stroke-width": 0.5 }));
      g.push(el("rect", { ...R(C.fpRect(b)), fill: BUILDING_FILL[C.category(b)], stroke: "#111", "stroke-width": 1 }, el("title", {}, esc(b.id)))); // prettier-ignore
      shows.buildings.push(b.id);
    }
    for (const t of C.tiles) g.push(el("rect", { ...R(t.rect), fill: "none", stroke: "#1a5c8a", "stroke-width": 1, "stroke-dasharray": "6 4" })); // prettier-ignore
    for (const p of C.portals) if (p.layers.includes(L.id)) g.push(portalGlyph(X(p.at[0]), Y(p.at[1]), 2.4));
    for (const c of m.connectors)
      c.stops.forEach((stop, i) => {
        if (m.layerOf(stop) !== L.id) return;
        const p = m.posOf(stop);
        g.push(glyph(c.type, X(p[0]), Y(p[1]), 3.4, c.access));
        labels.block([X(p[0]) - 5, Y(p[1]) - 5, X(p[0]) + 5, Y(p[1]) + 5]);
        if (!shows.connectors.includes(c.id)) shows.connectors.push(c.id);
        void i;
      });
    for (const k of m.checkpoints) {
      const n = m.nodes.get(k.node);
      if (n?.layer === L.id) g.push(checkpointGlyph(X(n.at[0]) - 7, Y(n.at[1]) - 7, 4.5)), shows.checkpoints.push(k.id);
    }
    const nLooks = C.looks.get(L.id).length;
    C.looks.get(L.id).forEach((lk, i) => g.push(lookGlyph(X(lk.at[0]) + 5, Y(lk.at[1]) + 5, 5, i + 1)));
    for (const d of m.districts.values()) {
      if (d.layer !== L.id) continue;
      const r = R(d.area);
      labels.place([{ text: d.name, size: 10, cls: "b" }], [[r.x + 3, r.y + 3, 0, 0], [r.x + r.width - 3, r.y + 3, 1, 0], [r.x + 3, r.y + r.height - 3, 0, 1], [r.x + r.width / 2, r.y + r.height / 2, 0.5, 0.5]], {}); // prettier-ignore
    }
    for (const t of C.tiles) {
      const r = R(t.rect);
      labels.place([{ text: `${t.id}${t.name ? ` ${t.name}` : ""}`, size: 8.5, cls: "d" }], [[r.x + 2, r.y + r.height - 2, 0, 1], [r.x + r.width - 2, r.y + r.height - 2, 1, 1]], {}); // prettier-ignore
    }
    parts.push(el("clipPath", { id: `p${li}` }, el("rect", { x: MX, y: top, width: pw, height: ph })));
    parts.push(el("g", { "clip-path": `url(#p${li})` }, g.join("")));
    parts.push(el("rect", { x: MX, y: top, width: pw, height: ph, fill: "none", stroke: "#222", "stroke-width": 1.2 }));
    parts.push(labels.svg.join(""));
    parts.push(text(MX, top - 8, `${L.id} ${L.name ?? ""}: z ${L.z[0]} to ${L.z[1]}, ${L.ceiling}, ${L.wealth}${nLooks ? ` (${nLooks} marked)` : ""}`, { "font-size": 12.5, class: "b" })); // prettier-ignore
  });
  // numbers per layer, and the key to the marks
  const tableTop = top + ph + 30;
  const col = new Column(PAD, tableTop - 20, pw * C.layers.length + PAD * 2 * (C.layers.length - 1));
  col.heading("Per layer (top-down plans in layer-*.svg, full labels in tile-*.svg)");
  for (const L of [...C.layers].reverse()) {
    const nums = layerNumbers(C, L);
    col.line(`${L.id} ${L.name ?? ""}: ${nums.districts.length} districts (${nums.districts.map((d) => d.name).join(", ")}); enterable ${nums.enterable}${nums.cap ? ` of ${nums.cap}` : ""}, lots ${nums.lots}; homes ${nums.homesTotal}${nums.homesTotal ? ` (${Object.entries(nums.homes).map(([c, n]) => `${n} ${c}`).join(", ")})` : ""}; plazas ${nums.plazas}; checkpoints ${nums.checkpoints}; secrets ${nums.secrets}`, { size: 11 }); // prettier-ignore
  }
  const seen = new Set();
  for (const L of C.layers)
    for (const row of layerNumbers(C, L).pairs) if (!seen.has(row.pair)) seen.add(row.pair), col.line(`connectors ${pairText(row)}`, { size: 11, indent: 8 }); // prettier-ignore
  col.line(`${C.tiles.length} tiles of ${desc.tiles.size.join(" x ")} cells, ${C.portals.length} portals; ${desc.spawns?.count ? `spawns ${desc.spawns.count} wanted${C.spawnPoints.length ? `, ${C.spawnPoints.length} placed` : ", none placed yet"}` : "no spawns"}.`, { size: 11 }); // prettier-ignore
  col.line("Key: districts tinted by wealth with dots for wear; streets white, canals blue, the MSR's hallways red; buildings by kind on their hatched blocks; connector glyphs as in the layer pictures; CP a checkpoint; red numbers are things to look at, listed in each layer picture.", { size: 10.5, cls: "d" }); // prettier-ignore
  const width = PAD + C.layers.length * pw + (C.layers.length - 1) * PAD * 2 + PAD;
  const height = col.y + PAD + 10;
  const titleText = `${desc.title ?? desc.name}: the whole city`;
  const head = [
    text(PAD, 24, titleText, { "font-size": 19, class: "b" }),
    text(PAD, 42, `${desc.name} · ${desc.format} · R1 plan review, overview · ${desc.extent.x} x ${desc.extent.y} cells (${f(desc.extent.x * desc.grid.cell)} m square) · north up`, { "font-size": 11, class: "d" }), // prettier-ignore
    text(PAD, 55, `description sha256 ${C.hash}`, { "font-size": 10, class: "d" }),
  ].join("");
  const meta = { review: "R1", description: desc.name, sha256: C.hash, picture: "overview" };
  return { svg: svgDoc(width, height, titleText, meta, head + "\n" + parts.join("\n") + el("g", { id: "legend" }, col.svg.join(""))), shows, omitted: 0 }; // prettier-ignore
}

function cityPictures(desc, { layer = null, tile = null } = {}) {
  const C = cityContext(desc);
  if (layer !== null && !C.layers.some((L) => L.id === layer)) throw new Error(`layer: "${layer}" is no layer of ${desc.name} (${C.layers.map((L) => L.id).join(", ")})`); // prettier-ignore
  if (tile !== null && !C.tiles.some((t) => t.id === tile)) throw new Error(`tile: "${tile}" is no tile of ${desc.name} (${C.tiles.map((t) => t.id).join(", ")})`); // prettier-ignore
  const pictures = [];
  const add = (file, kind, L, t, r) => pictures.push({ file, kind, layer: L?.id ?? null, tile: t?.id ?? null, svg: r.svg, shows: r.shows, omitted: r.omitted }); // prettier-ignore
  if (layer === null && tile === null) add("overview.svg", "overview", null, null, cityOverview(C));
  for (const L of C.layers) {
    if (layer !== null && L.id !== layer) continue;
    if (tile === null) {
      const win = [Math.min(L.bounds[0], ...C.tiles.map((t) => t.rect[0])), Math.min(L.bounds[1], ...C.tiles.map((t) => t.rect[1])), Math.max(L.bounds[2], ...C.tiles.map((t) => t.rect[2])), Math.max(L.bounds[3], ...C.tiles.map((t) => t.rect[3]))]; // prettier-ignore
      const s = Math.max(4, Math.min(12, 1000 / Math.max(win[2] - win[0], win[3] - win[1])));
      add(`layer-${L.id}.svg`, "layer", L, null, cityView(C, { kind: "layer", L, win, s }));
    }
    for (const t of C.tiles) {
      if (tile !== null && t.id !== tile) continue;
      if (!rectClip(L.bounds, t.rect)) continue;
      const margin = 3;
      const win = [t.rect[0] - margin, t.rect[1] - margin, t.rect[2] + margin, t.rect[3] + margin];
      const s = Math.max(10, Math.min(28, 940 / Math.max(win[2] - win[0], win[3] - win[1])));
      add(`tile-${t.id}-${L.id}.svg`, "tile", L, t, cityView(C, { kind: "tile", L, win, s, tile: t }));
    }
  }
  return { kind: "city", name: desc.name, title: desc.title ?? desc.name, format: desc.format, hash: C.hash, pictures }; // prettier-ignore
}

// ── the dungeon (a level description) ──

const storeyName = (n) => (n < 0 ? `m${-n}` : String(n));

/** Bridges of an undirected multigraph (links by index): the links no cycle goes through. */
function bridges(ids, links) {
  const adj = new Map(ids.map((id) => [id, []]));
  for (const { from, to, index } of links) adj.get(from).push([to, index]), adj.get(to).push([from, index]);
  const disc = new Map();
  const low = new Map();
  const out = new Set();
  let time = 0;
  const visit = (u, viaEdge) => {
    disc.set(u, time), low.set(u, time), time++;
    for (const [v, e] of adj.get(u)) {
      if (e === viaEdge) continue;
      if (!disc.has(v)) {
        visit(v, e);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (low.get(v) > disc.get(u)) out.add(e);
      } else low.set(u, Math.min(low.get(u), disc.get(v)));
    }
  };
  for (const id of ids) if (!disc.has(id)) visit(id, -1);
  return out;
}

function dungeonLayout(desc, m) {
  const ids = desc.spaces.map((s) => s.id);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const l of desc.links) adj.get(l.from).push(l.to), adj.get(l.to).push(l.from);
  const depth = new Map([[m.start, 0]]);
  const order = [m.start];
  for (let i = 0; i < order.length; i++)
    for (const n of adj.get(order[i])) if (!depth.has(n)) depth.set(n, depth.get(order[i]) + 1), order.push(n);
  const deepest = Math.max(...depth.values());
  for (const id of ids) if (!depth.has(id)) depth.set(id, deepest + 1), order.push(id);
  const S = 16; // px per cell
  const LABEL = 68;
  const COLGAP = 96;
  const BANDPAD = 30;
  const dims = (id) => {
    const sp = m.spaces.get(id);
    const [w, d] = sp.cells;
    return sp.type === "corridor" || sp.type === "stair" ? [d * S, w * S] : [w * S, d * S];
  };
  const lo = Math.min(...ids.map((id) => m.spaces.get(id).storeys[0]));
  const hi = Math.max(...ids.map((id) => m.spaces.get(id).storeys[1]));
  const storeys = [];
  for (let n = hi; n >= lo; n--) storeys.push(n);
  const cols = Math.max(...depth.values()) + 1;
  const colW = Array.from({ length: cols }, (_, c) => Math.max(60, ...order.filter((id) => depth.get(id) === c).map((id) => Math.max(dims(id)[0], textW(id, 11, true))))); // prettier-ignore
  const colX = [];
  let x = 0;
  for (let c = 0; c < cols; c++) colX.push(x), (x += colW[c] + COLGAP);
  const stacks = new Map();
  for (const n of storeys)
    for (let c = 0; c < cols; c++) {
      const here = order.filter((id) => depth.get(id) === c && m.spaces.get(id).storeys[0] <= n && m.spaces.get(id).storeys[1] >= n); // prettier-ignore
      const tall = (id) => m.spaces.get(id).storeys[0] !== m.spaces.get(id).storeys[1];
      const top = here.filter((id) => tall(id) && m.spaces.get(id).storeys[1] === n);
      const bottom = here.filter((id) => tall(id) && m.spaces.get(id).storeys[0] === n);
      const rest = here.filter((id) => !top.includes(id) && !bottom.includes(id));
      stacks.set(`${n}|${c}`, [...bottom.filter((id) => !top.includes(id)), ...rest, ...top]);
    }
  const bandH = new Map();
  for (const n of storeys) {
    let h = 130;
    for (let c = 0; c < cols; c++) h = Math.max(h, stacks.get(`${n}|${c}`).reduce((a, id) => a + dims(id)[1] + LABEL, 0) + BANDPAD); // prettier-ignore
    bandH.set(n, h);
  }
  const bandY = new Map();
  let y = 0;
  for (const n of storeys) bandY.set(n, y), (y += bandH.get(n));
  const slots = new Map();
  for (const n of storeys)
    for (let c = 0; c < cols; c++) {
      let yy = bandY.get(n) + BANDPAD;
      for (const id of stacks.get(`${n}|${c}`)) {
        const [w, h] = dims(id);
        const sp = m.spaces.get(id);
        const isTopOfTall = sp.storeys[0] !== sp.storeys[1] && sp.storeys[1] === n;
        const sy = isTopOfTall ? bandY.get(n) + bandH.get(n) - h - 6 : yy;
        (slots.get(id) ?? slots.set(id, []).get(id)).push({ n, x: colX[c], y: sy, w, h });
        if (!isTopOfTall) yy += h + LABEL;
      }
    }
  const rects = new Map();
  for (const id of ids) {
    const ss = slots.get(id);
    const first = ss[0];
    const last = ss[ss.length - 1];
    rects.set(id, { x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y });
  }
  return { rects, storeys, bandY, bandH, width: x - COLGAP, height: y, S };
}

function dungeonView(desc, m, a, L, hash, focus) {
  const MX = PAD + 80;
  const MY = HEADER + 10;
  const W = L.width;
  const loopsTwoWay = (() => {
    const two = desc.links.map((l, index) => ({ ...l, index })).filter((l) => l.type !== "drop" && l.oneWay !== true);
    const br = bridges(desc.spaces.map((s) => s.id), two);
    return new Set(two.filter((l) => !br.has(l.index)).map((l) => l.index));
  })();
  const loopsAny = (() => {
    const all = desc.links.map((l, index) => ({ ...l, index }));
    const br = bridges(desc.spaces.map((s) => s.id), all);
    return new Set(all.filter((l) => !br.has(l.index)).map((l) => l.index));
  })();
  const R = new Map([...L.rects].map(([id, r]) => [id, { x: MX + r.x, y: MY + r.y, w: r.w, h: r.h }]));
  const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  const onFocus = (id) => focus === null || (m.spaces.get(id).storeys[0] <= focus && m.spaces.get(id).storeys[1] >= focus);
  const exit = (r, from, to) => {
    const rr = [r.x, r.y, r.x + r.w, r.y + r.h];
    return exitPoint(from, to, rr);
  };
  // a link's geometry: straight between the two rectangles, bowed when the straight line crosses another space
  const geomOf = (l) => {
    const [ra, rb] = [R.get(l.from), R.get(l.to)];
    const [ca, cb] = [centre(ra), centre(rb)];
    const hit = [...R].some(([id, r]) => id !== l.from && id !== l.to && segHitsRect(ca, cb, [r.x - 4, r.y - 4, r.x + r.w + 4, r.y + r.h + 4])); // prettier-ignore
    if (!hit) {
      const [p, q] = [exit(ra, ca, cb), exit(rb, cb, ca)];
      return { d: `M${f(p[0])},${f(p[1])}L${f(q[0])},${f(q[1])}`, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] };
    }
    const D = dist(ca, cb);
    const [nx, ny] = [-(cb[1] - ca[1]) / D, (cb[0] - ca[0]) / D];
    const bow = Math.max(60, D * 0.32);
    const c = [(ca[0] + cb[0]) / 2 + nx * bow, (ca[1] + cb[1]) / 2 + ny * bow];
    const [p, q] = [exit(ra, ca, c), exit(rb, cb, c)];
    const mid = [0.25 * p[0] + 0.5 * c[0] + 0.25 * q[0], 0.25 * p[1] + 0.5 * c[1] + 0.25 * q[1]];
    return { d: `M${f(p[0])},${f(p[1])}Q${f(c[0])},${f(c[1])} ${f(q[0])},${f(q[1])}`, mid };
  };
  const geoms = desc.links.map(geomOf);
  const fade = (on, svg) => (on ? svg : el("g", { opacity: 0.25 }, svg));
  const G = { bands: [], route: [], halo: [], links: [], spaces: [], marks: [] };
  const labels = new Labels([MX - 70, MY - 6, MX + W + 200, MY + L.height + 6]);

  L.storeys.forEach((n, i) => {
    const y = MY + L.bandY.get(n);
    const h = L.bandH.get(n);
    G.bands.push(el("rect", { x: MX - 80, y, width: W + 290, height: h, fill: focus === n ? "#fff6dc" : i % 2 ? "#f4f4f1" : "#fbfbf9", stroke: "#d6d6d0" })); // prettier-ignore
    G.bands.push(text(MX - 74, y + 18, `storey ${n}`, { "font-size": 13, class: "b" }));
    G.bands.push(text(MX - 74, y + 32, `${f(n * desc.grid.storey)} m`, { "font-size": 10, class: "d" }));
  });
  // the critical route under everything: thick gold along the links it walks
  const walk = a.route?.walk ?? [];
  const visits = new Map();
  walk.forEach((id, i) => (visits.get(id) ?? visits.set(id, []).get(id)).push(i + 1));
  for (let i = 1; i < walk.length; i++) {
    const k = desc.links.findIndex((l) => (l.from === walk[i - 1] && l.to === walk[i]) || (l.to === walk[i - 1] && l.from === walk[i])); // prettier-ignore
    if (k >= 0) G.route.push(el("path", { d: geoms[k].d, fill: "none", stroke: "#f2b705", "stroke-opacity": 0.55, "stroke-width": 12, "stroke-linecap": "round" })); // prettier-ignore
  }
  desc.links.forEach((l, k) => {
    const on = onFocus(l.from) || onFocus(l.to);
    if (loopsTwoWay.has(k)) G.halo.push(fade(on, el("path", { d: geoms[k].d, fill: "none", stroke: "#2f6fdb", "stroke-opacity": 0.35, "stroke-width": 7 }))); // prettier-ignore
    else if (loopsAny.has(k)) G.halo.push(fade(on, el("path", { d: geoms[k].d, fill: "none", stroke: "#2f6fdb", "stroke-opacity": 0.4, "stroke-width": 7, "stroke-dasharray": "8 5" }))); // prettier-ignore
    const style = {
      door: { stroke: "#222", "stroke-width": 2 },
      open: { stroke: "#8f9a9a", "stroke-width": 4 },
      stair: { stroke: "#2d4a7a", "stroke-width": 5, "stroke-dasharray": "2 2" },
      drop: { stroke: "#d0461b", "stroke-width": 2.2, "stroke-dasharray": "7 4", "marker-end": "url(#arrow)" },
      gate: { stroke: "#8a6100", "stroke-width": 4 },
      secret: { stroke: SECRET, "stroke-width": 2.2, "stroke-dasharray": "1.5 3.5", "stroke-linecap": "round" },
    }[l.type];
    const extra = l.oneWay && l.type !== "drop" ? { "marker-end": "url(#arrowk)" } : {};
    const parts = [el("title", {}, esc(`${l.from} to ${l.to}: ${l.type}${l.key ? ` (key ${l.key})` : ""}${l.oneWay ? ", one way" : ""}`)), el("path", { d: geoms[k].d, fill: "none", ...style, ...extra })]; // prettier-ignore
    const [mx, my] = geoms[k].mid;
    if (l.type === "door") parts.push(el("rect", { x: mx - 4, y: my - 4, width: 8, height: 8, fill: "#fff", stroke: "#222", "stroke-width": 1.5 })); // prettier-ignore
    if (l.type === "gate") {
      parts.push(el("rect", { x: mx - 6, y: my - 3, width: 12, height: 10, rx: 1.5, fill: "#f2b705", stroke: "#6b4e00", "stroke-width": 1.2 })); // prettier-ignore
      parts.push(el("path", { d: `M${f(mx - 3.5)},${f(my - 3)}v-3a3.5,3.5 0 0 1 7,0v3`, fill: "none", stroke: "#6b4e00", "stroke-width": 1.6 })); // prettier-ignore
      labels.block([mx - 8, my - 10, mx + 8, my + 9]);
    }
    G.links.push(fade(on, el("g", {}, parts.join(""))));
  });
  // spaces
  const hubs = new Set(a.hubs);
  const dead = new Map(a.deadEnds.map((d) => [d.id, d]));
  const secretOnly = new Set(a.reach.secretOnly);
  for (const sp of desc.spaces) {
    const r = R.get(sp.id);
    const M = m.spaces.get(sp.id);
    const parts = [el("title", {}, esc(`${sp.id}: ${sp.type} ${sp.size ?? M.cells.join("x")}, ${M.cells.join(" x ")} cells (${f(M.metres[0])} x ${f(M.metres[1])} m), storey ${M.storeys[0] === M.storeys[1] ? M.storeys[0] : M.storeys.join(" to ")}, ${M.pacing}`))]; // prettier-ignore
    parts.push(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: SPACE_FILL[sp.type] ?? "#eee", stroke: "#222", "stroke-width": hubs.has(sp.id) ? 3.2 : 1.4, "stroke-dasharray": sp.side ? "6 3" : secretOnly.has(sp.id) ? "2 3" : null })); // prettier-ignore
    parts.push(el("rect", { x: r.x, y: r.y, width: 5, height: r.h, fill: PACING_INK[M.pacing] }));
    if (sp.type === "stair") for (let yy = r.y + 6; yy < r.y + r.h - 2; yy += 6) parts.push(el("line", { x1: r.x + 6, y1: yy, x2: r.x + r.w, y2: yy, stroke: "#8ea0bf", "stroke-width": 0.8 })); // prettier-ignore
    G.spaces.push(fade(onFocus(sp.id), el("g", { id: `s-${sp.id}` }, parts.join(""))));
    labels.block([r.x, r.y, r.x + r.w, r.y + r.h]);
    // marks: start, goal, hub, dead end, visit numbers, keys
    const marks = [];
    let mx = r.x;
    const tag = (words, fill, ink = "#fff") => {
      const w = textW(words, 9, true) + 8;
      marks.push(el("rect", { x: mx, y: r.y - 15, width: w, height: 13, rx: 3, fill }), text(mx + 4, r.y - 5.5, words, { "font-size": 9, class: "b", style: `fill:${ink}` })); // prettier-ignore
      labels.block([mx, r.y - 15, mx + w, r.y - 2]);
      mx += w + 3;
    };
    if (visits.has(sp.id)) tag(`route ${visits.get(sp.id).join(", ")}`, "#f2b705", "#3b2c00");
    if (sp.id === m.start) tag("START", "#2e9e4f");
    if (sp.id === m.goal) tag("GOAL", "#8b1a1a");
    if (hubs.has(sp.id)) tag(m.hubs.includes(sp.id) ? "HUB" : "hub (3+ ways)", "#333");
    if (dead.has(sp.id)) tag("DEAD END", "#7a4a12");
    G.marks.push(fade(onFocus(sp.id), marks.join("")));
  }
  for (const sp of desc.spaces) {
    const r = R.get(sp.id);
    const M = m.spaces.get(sp.id);
    const enc = M.encounters.map((e) => `${e.count ?? 1} ${e.size}`).join(" + ");
    const lines = [
      { text: sp.id, size: 11, cls: "b" },
      { text: `${sp.type} ${sp.size ?? ""} ${M.cells.join("x")}${M.storeys[0] !== M.storeys[1] ? `, storeys ${M.storeys.join(" to ")}` : ""} · ${M.pacing}`.replace(/\s+/g, " "), size: 9.5, cls: "d" }, // prettier-ignore
      enc ? { text: `fight: ${enc} (weight ${M.weight})`, size: 9.5, cls: "w" } : null,
      M.keys.length ? { text: `key: ${M.keys.join(", ")}`, size: 9.5, cls: "b" } : null,
      M.rewards.filter((x) => x.kind !== "key").length ? { text: `reward: ${M.rewards.filter((x) => x.kind !== "key").map((x) => x.kind).join(", ")}`, size: 9.5 } : null, // prettier-ignore
      secretOnly.has(sp.id) ? { text: "behind a secret", size: 9.5, cls: "s" } : null,
    ];
    labels.place(lines, [[r.x, r.y + r.h + 3, 0, 0], [r.x + r.w + 4, r.y, 0, 0], [r.x + r.w + 4, r.y + r.h, 0, 1], [r.x - 4, r.y, 1, 0], [r.x, r.y + r.h + 18, 0, 0], [r.x + r.w / 2, r.y + r.h / 2, 0.5, 0.5]], { force: true, fade: !onFocus(sp.id) }); // prettier-ignore
  }
  desc.links.forEach((l, k) => {
    if (l.type !== "gate" && l.type !== "drop" && l.type !== "secret" && l.type !== "stair") return;
    const [mx, my] = geoms[k].mid;
    const words = l.type === "gate" ? `gate: ${l.key}` : l.type;
    labels.place([{ text: words, size: 9.5, cls: l.type === "gate" ? "b" : l.type === "secret" ? "s" : "d" }], around(mx, my, 10, [1, 2, 3]), { force: l.type === "gate", fade: !(onFocus(l.from) || onFocus(l.to)) }); // prettier-ignore
  });

  // scale bar
  const sbY = MY + L.height + 16;
  const nice = 4;
  const scale = [];
  for (let i = 0; i < 4; i++) scale.push(el("rect", { x: MX + (i * nice * L.S) / 4, y: sbY, width: (nice * L.S) / 4, height: 6, fill: i % 2 ? "#fff" : "#111", stroke: "#111", "stroke-width": 0.8 })); // prettier-ignore
  scale.push(text(MX, sbY + 20, `${nice} cells = ${f(nice * desc.grid.cell)} m (sizes to scale; positions schematic, no north: stage 1 solves them on the kit grid)`, { "font-size": 10.5 })); // prettier-ignore

  // legend
  const col = new Column(MX + W + 230, MY - 14, LEGEND_W);
  const mm = a.metrics;
  col.heading(focus === null ? "All storeys" : `Storey ${focus} (others faded)`);
  col.line(`${mm.spaces} spaces, ${mm.area} m2 on ${mm.storeys} storeys; route ${mm.routeLength ?? "none"} m (direct ${mm.directLength ?? "none"} m, backtrack ${mm.backtrack ?? "-"}); loops ${mm.loops} (+${mm.oneWayLoops} one way); hubs ${mm.hubs}; dead ends ${mm.deadEnds} (${Math.round((mm.rewardedDeadEndShare ?? 0) * 100)} % rewarded); off the path ${Math.round(mm.offPathShare * 100)} %; keys ${mm.keys}, gates ${mm.gates}, drops ${mm.drops}, secrets ${mm.secrets}`); // prettier-ignore
  col.heading("Spaces (fill by type, stripe by pacing)");
  for (const [t, fill] of Object.entries(SPACE_FILL)) col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill, stroke: "#222" }), t); // prettier-ignore
  col.row((x, y, w, h) => Object.values(PACING_INK).map((c, i) => el("rect", { x: x + i * 7.5, y, width: 7.5, height: h, fill: c })).join(""), "pacing: quiet, tension, fight, rest"); // prettier-ignore
  col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#fff", stroke: "#222", "stroke-width": 3 }), "hub: thick border"); // prettier-ignore
  col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#fff", stroke: "#222", "stroke-dasharray": "6 3" }), "side area (co-op style): dashed"); // prettier-ignore
  col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#fff", stroke: "#222", "stroke-dasharray": "2 3" }), "reached only through a secret: dotted"); // prettier-ignore
  col.heading("Links");
  for (const [t, st, words] of [["door", { stroke: "#222", "stroke-width": 2 }, "door"], ["open", { stroke: "#8f9a9a", "stroke-width": 4 }, "open"], ["stair", { stroke: "#2d4a7a", "stroke-width": 5, "stroke-dasharray": "2 2" }, "stair"], ["drop", { stroke: "#d0461b", "stroke-width": 2.2, "stroke-dasharray": "7 4", "marker-end": "url(#arrow)" }, "drop (one way)"], ["gate", { stroke: "#8a6100", "stroke-width": 4 }, "gate, with the key that opens it"], ["secret", { stroke: SECRET, "stroke-width": 2.2, "stroke-dasharray": "1.5 3.5" }, "secret"]]) // prettier-ignore
    col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h${w - 4}`, fill: "none", ...st }), words); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h${w}`, stroke: "#f2b705", "stroke-opacity": 0.55, "stroke-width": 12 }), "the critical route (keys fetched, no secrets); tags give each visit's number"); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h${w}`, stroke: "#2f6fdb", "stroke-opacity": 0.35, "stroke-width": 7 }), "on a loop (walked both ways)"); // prettier-ignore
  col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h${w}`, stroke: "#2f6fdb", "stroke-opacity": 0.4, "stroke-width": 7, "stroke-dasharray": "8 5" }), "on a loop a drop or one-way link closes"); // prettier-ignore
  if (walk.length) {
    col.heading("The route");
    col.line(walk.join(" > "), { size: 10 });
  }
  const width = MX + W + 230 + LEGEND_W + PAD;
  const height = Math.max(sbY + 40, col.y + PAD + 10);
  const titleText = `${desc.title ?? desc.name}: ${focus === null ? "all storeys" : `storey ${focus}`}`;
  const head = [
    text(PAD, 24, titleText, { "font-size": 19, class: "b" }),
    text(PAD, 42, `${desc.name} · ${desc.format} · R1 plan review, ${focus === null ? "overview" : "storey picture"} · 1 cell = ${f(desc.grid.cell)} m, a storey ${f(desc.grid.storey)} m`, { "font-size": 11, class: "d" }), // prettier-ignore
    text(PAD, 55, `description sha256 ${hash}`, { "font-size": 10, class: "d" }),
  ].join("");
  const body = [head, ...[G.bands, G.route, G.halo, G.links, G.spaces, G.marks].map((x) => x.join("")), el("g", { id: "labels" }, labels.svg.join("")), scale.join(""), el("g", { id: "legend" }, col.svg.join(""))].join("\n"); // prettier-ignore
  const shows = { spaces: desc.spaces.filter((s) => onFocus(s.id)).map((s) => s.id), links: desc.links.filter((l) => onFocus(l.from) || onFocus(l.to)).map((l) => `${l.from}>${l.to}`) }; // prettier-ignore
  const meta = { review: "R1", description: desc.name, sha256: hash, picture: focus === null ? "overview" : "storey", storey: focus }; // prettier-ignore
  return { svg: svgDoc(width, height, titleText, meta, body), shows, omitted: labels.omitted };
}

function dungeonPictures(desc, { layer = null, tile = null } = {}) {
  const m = measureDescription(desc); // throws with the validator's sentence when the description is not valid
  if (tile !== null) throw new Error(`tile: a level description has no tiles (asked for "${tile}")`);
  const a = analyseDescription(desc);
  const hash = descriptionHash(desc);
  const L = dungeonLayout(desc, m);
  const wanted = layer === null ? null : String(layer).replace(/^m/, "-");
  if (wanted !== null && !L.storeys.some((n) => String(n) === wanted)) throw new Error(`layer: "${layer}" is no storey of ${desc.name} (${L.storeys.join(", ")})`); // prettier-ignore
  const pictures = [];
  if (wanted === null) {
    const r = dungeonView(desc, m, a, L, hash, null);
    pictures.push({ file: "overview.svg", kind: "overview", layer: null, tile: null, svg: r.svg, shows: r.shows, omitted: r.omitted }); // prettier-ignore
  }
  for (const n of L.storeys) {
    if (wanted !== null && String(n) !== wanted) continue;
    const r = dungeonView(desc, m, a, L, hash, n);
    pictures.push({ file: `storey-${storeyName(n)}.svg`, kind: "storey", layer: String(n), tile: null, svg: r.svg, shows: r.shows, omitted: r.omitted }); // prettier-ignore
  }
  return { kind: "dungeon", name: desc.name, title: desc.title ?? desc.name, format: desc.format, hash, pictures };
}

/**
 * The plan pictures of a description for the R1 review: { kind: "city" | "dungeon", name, title, format, hash,
 * pictures: [{ file, kind, layer, tile, svg, shows, omitted }] }. `layer` keeps one layer (a city's id, or a
 * storey's number for a level, "m1" for -1); `tile` keeps one tile of a city and drops the layer-wide pictures.
 * Throws with the validator's sentence when the description is not valid.
 */
export function planPictures(desc, { layer = null, tile = null } = {}) {
  if (desc && typeof desc === "object" && desc.format === LEVEL_FORMAT) return dungeonPictures(desc, { layer, tile });
  if (desc && typeof desc === "object" && desc.format === CITY_FORMAT) return cityPictures(desc, { layer, tile });
  throw new Error(`the description is not valid: format: wanted "${CITY_FORMAT}" or "${LEVEL_FORMAT}", got ${JSON.stringify(desc?.format)}`); // prettier-ignore
}

/** The review record of a set of pictures: what an approval will reference (each picture's sha256, the description's). */
export function reviewRecord(result, { file = null, fileSha256 = null } = {}) {
  return {
    format: REVIEW_FORMAT,
    stop: "R1",
    description: { file, name: result.name, title: result.title, format: result.format, kind: result.kind, sha256: result.hash, fileSha256 }, // prettier-ignore
    renderer: "levels/lib/plan-picture.mjs",
    pictures: result.pictures.map((p) => ({ file: p.file, kind: p.kind, layer: p.layer, tile: p.tile, sha256: sha256(p.svg), bytes: Buffer.byteLength(p.svg), labelsLeftOff: p.omitted, shows: p.shows })), // prettier-ignore
    approval: null,
  };
}

// The drawing kit shared with the review of the generator's artifacts (review-picture.mjs): one look for both stops.
export { f as fmt, esc, el, text, textW, wrap, Labels, Column, around, STYLE, DEFS, glyph, checkpointGlyph, portalGlyph, lookGlyph, spawnGlyph }; // prettier-ignore
export { WEALTH_FILL, STREET_LOOK, OTHER_LOOK, CASING, BUILDING_FILL, INK, SECRET, PORTAL, WARN };
