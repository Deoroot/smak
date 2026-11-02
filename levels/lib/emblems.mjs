// New Byzantium's emblems as vector art written here: the Middle Sea Republic's mark (three variants, each an
// inverted triangle with the letters MSR, echoing Alexandria's `{ax_msr` and redrawn as our own with an eagle), the
// Insurgents' answer (two sprayed marks), a display alphabet drawn as strokes (no font file), and the kit's banners,
// plaque, six posters and their defaced copies. Every shape is computed here; nothing is traced or copied.
// Chosen 2026-11-02: MSR b (Ascendant) the main emblem, a (Bicephalus) the formal one, c (Foundry) the seal;
// Insurgent 3 (Claw) the main mark, 1 (Upturned) the stencilled one (2, a snapped chain, dropped).
//
//   geometry      orient inset mirrorX strokeOf arc dpath transformPolys
//   lettering     GLYPHS textPolys textWidth (cap height 10 units, y down; thick and thin strokes, wedge serifs)
//   designs       MSR_VARIANTS INSURGENT_VARIANTS msrEmblem(id) insurgentMark(id)  -> { size, items }
//   mock-ups      bannerDesign(emblem, { torn }) plaqueDesign posterDesign POSTERS DEFACED defacedDesign tornCorner
//   SVG           designSvg(design, palette, opts) sprayItems(design, seed)
//   palettes      msrColours(hue) PALETTES
//
// A design is `{ size: [w, h], items: [{ role, polys, cuts?, rule?, blur?, opacity? }] }`: shapes by role (gold,
// field, ink, paint...), painted in order; `cuts` are holes through that item (an SVG luminance mask). A palette maps
// each role to a colour or to null (not drawn), so one design gives the gold-on-dark sign, its single-colour stencil
// and its height map for the emboss. Deterministic: the same arguments give the same SVG text.
import { hash01 } from "../../src/maps/texture-recipe.mjs";

// ── geometry ───────────────────────────────────────────────────────────────
/** Shoelace area, positive for clockwise on screen (y down). */
export const area = (p) =>
  p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;
/** The polygon wound clockwise on screen, so overlapping shapes union under the nonzero rule. */
export const orient = (p) => (area(p) < 0 ? [...p].reverse() : p);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const perp = ([x, y]) => [-y, x];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const rad = (d) => (d * Math.PI) / 180;
const dir = (deg) => [Math.cos(rad(deg)), Math.sin(rad(deg))];
/** Points on an ellipse from `a0` to `a1` degrees (0 right, 90 down). */
export const arc = (cx, cy, rx, ry, a0, a1, n = 18) =>
  Array.from({ length: n + 1 }, (_, i) => [
    cx + rx * Math.cos(rad(a0 + ((a1 - a0) * i) / n)),
    cy + ry * Math.sin(rad(a0 + ((a1 - a0) * i) / n)),
  ]);
const circle = (cx, cy, r, n = 28) => arc(cx, cy, r, r, 0, 360, n).slice(0, n);
/** A polygon (simple, no edge collapsing) moved inward by `d` (outward when negative): each side offset, corners met. */
export function inset(poly, d) {
  const p = orient(poly);
  const n = p.length;
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n];
    const nrm = mul(unit(perp(sub(b, a))), 1); // clockwise on screen: perp points inward
    return [add(a, mul(nrm, d)), sub(b, a)];
  });
  return lines.map((l, i) => {
    const [p1, d1] = lines[(i + n - 1) % n];
    const [p2, d2] = l;
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) return p2;
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return add(p1, mul(d1, t));
  });
}
/** Polygons mirrored about x = cx. */
export const mirrorX = (polys, cx) => polys.map((p) => p.map(([x, y]) => [2 * cx - x, y]).reverse());
/** Polygons scaled by `s` about the origin, turned by `rot` degrees, then moved by (dx, dy). */
export const transformPolys = (polys, { s = 1, sy, rot = 0, dx = 0, dy = 0 } = {}) => {
  const [c, si] = [Math.cos(rad(rot)), Math.sin(rad(rot))];
  return polys.map((p) =>
    p.map(([x, y]) => {
      const [X, Y] = [x * s, y * (sy ?? s)];
      return [X * c - Y * si + dx, X * si + Y * c + dy];
    }),
  );
};
/**
 * A polyline as filled polygons: a quad per segment (each end its own half-width, `w` a number or one per point),
 * bevel joints, ends square across the line or, where an end lies on one of `flatY`, cut level with it (a letter's
 * stem standing on the baseline). `cap` "round" puts a disc on each end. `closed` joins the last point to the first.
 */
export function strokeOf(pts, w, { closed = false, cap = "butt", flatY = [] } = {}) {
  const P = closed ? [...pts, pts[0]] : pts;
  const W = (i) => (Array.isArray(w) ? w[i % w.length] : w) / 2;
  const out = [];
  const flatAt = (p) => flatY.some((y) => Math.abs(p[1] - y) < 1e-6);
  for (let i = 0; i + 1 < P.length; i++) {
    const [a, b] = [P[i], P[i + 1]];
    const d = sub(b, a);
    if (len(d) < 1e-9) continue;
    const n = unit(perp(d));
    const end = (p, h, isEnd) => {
      if (isEnd && flatAt(p) && Math.abs(d[1]) > 1e-6 && Math.abs(n[0]) > 1e-6) {
        const hx = h / Math.abs(n[0]);
        return n[0] > 0 ? [add(p, [hx, 0]), sub(p, [hx, 0])] : [sub(p, [hx, 0]), add(p, [hx, 0])];
      }
      return [add(p, mul(n, h)), sub(p, mul(n, h))];
    };
    const [a1, a2] = end(a, W(i), !closed && i === 0);
    const [b1, b2] = end(b, W(i + 1), !closed && i + 2 === P.length);
    out.push([a1, b1, b2, a2]);
    if (i + 2 < P.length || closed) {
      const c = P[i + 2] ?? P[1];
      const n2 = unit(perp(sub(c, b)));
      const h = W(i + 1);
      out.push([b, add(b, mul(n, h)), add(b, mul(n2, h))], [b, sub(b, mul(n, h)), sub(b, mul(n2, h))]);
    }
  }
  if (cap === "round" && !closed)
    for (const i of [0, P.length - 1]) out.push(circle(P[i][0], P[i][1], W(i), 16));
  return out.filter((p) => Math.abs(area(p)) > 1e-6).map(orient);
}
const r2 = (v) => (Math.round(v * 100) / 100).toString();
/** Polygons as SVG path data, each wound clockwise (union under nonzero). */
export const dpath = (polys) =>
  polys
    .map(
      (p) =>
        "M" +
        orient(p)
          .map(([x, y]) => `${r2(x)} ${r2(y)}`)
          .join("L") +
        "Z",
    )
    .join("");
const bbox = (polys) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys)
    for (const [x, y] of p)
      [b[0], b[1], b[2], b[3]] = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
};

// ── lettering ──────────────────────────────────────────────────────────────
// A display capital drawn for New Byzantium: cap height 10 units, thick (T) and thin (t) strokes as an engraver
// cuts them, wedge serifs on the cap and base lines, an A with a dipped bar, a splayed M whose V stops short of the
// line, a pointed (lozenge) O, a lozenge for the stop between words: the flavour of a Byzantine inscription, made
// to read on a texture at 7 px a capital and up.
const CAP = 10;
const S = (p, w, serif = [true, true]) => ({ p, w, serif });
const NO = [false, false];
const pointedO = (w) => {
  const R = (25 + (w / 2 - 0.4) ** 2) / (2 * (w / 2 - 0.4));
  const cxr = w - 0.4 - R;
  const a = (Math.atan2(-5, w / 2 - cxr) * 180) / Math.PI;
  const right = arc(cxr, 5, R, R, a, -a, 16);
  const left = arc(w - cxr, 5, R, R, 180 + a, 180 - a, 16);
  return [...right, ...left.slice(1, -1)];
};
export const GLYPHS = {
  A: [
    8,
    [
      S(
        [
          [0.4, 10],
          [4, 0],
        ],
        "t",
        [true, false],
      ),
      S(
        [
          [4, 0],
          [7.6, 10],
        ],
        "T",
        [false, true],
      ),
      S(
        [
          [1.9, 6.3],
          [4, 7.6],
          [6.1, 6.3],
        ],
        "t",
        NO,
      ),
    ],
  ],
  B: [
    6.9,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S([[1, 0], [3.7, 0], ...arc(3.7, 2.45, 2.4, 2.45, -90, 90, 14).slice(1), [1, 4.9]], "m", NO),
      S([[1, 4.9], [4, 4.9], ...arc(4, 7.45, 2.65, 2.55, -90, 90, 14).slice(1), [1, 10]], "m", NO),
    ],
  ],
  C: [
    7.2,
    [
      S(arc(4.1, 5, 3.5, 5, -42, -318, 28), "m", NO),
      S(
        [
          [6.75, 0.5],
          [6.75, 3.1],
        ],
        "t",
        NO,
      ),
    ],
  ],
  D: [
    7.7,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S([[1, 0], [3, 0], ...arc(3, 5, 3.9, 5, -90, 90, 20).slice(1), [1, 10]], "m", NO),
    ],
  ],
  E: [
    6.3,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S(
        [
          [1, 0],
          [5.9, 0],
        ],
        "t",
        NO,
      ),
      S(
        [
          [1, 4.9],
          [4.7, 4.9],
        ],
        "t",
        NO,
      ),
      S(
        [
          [1, 10],
          [6.1, 10],
        ],
        "t",
        NO,
      ),
      S(
        [
          [5.9, 0],
          [5.9, 2.1],
        ],
        "t",
        NO,
      ),
      S(
        [
          [6.1, 10],
          [6.1, 7.9],
        ],
        "t",
        NO,
      ),
      S(
        [
          [4.7, 3.9],
          [4.7, 5.9],
        ],
        "t",
        NO,
      ),
    ],
  ],
  F: [
    6,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S(
        [
          [1, 0],
          [5.8, 0],
        ],
        "t",
        NO,
      ),
      S(
        [
          [1, 4.9],
          [4.6, 4.9],
        ],
        "t",
        NO,
      ),
      S(
        [
          [5.8, 0],
          [5.8, 2.1],
        ],
        "t",
        NO,
      ),
      S(
        [
          [4.6, 3.9],
          [4.6, 5.9],
        ],
        "t",
        NO,
      ),
    ],
  ],
  G: [
    7.7,
    [
      S(arc(4.1, 5, 3.5, 5, -42, -340, 28), "m", NO),
      S(
        [
          [6.75, 0.5],
          [6.75, 3.1],
        ],
        "t",
        NO,
      ),
      S(
        [
          [4.8, 6],
          [7.6, 6],
        ],
        "t",
        NO,
      ),
      S(
        [
          [7.4, 6],
          [7.4, 9.7],
        ],
        "T",
        NO,
      ),
    ],
  ],
  H: [
    7.6,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S(
        [
          [6.6, 0],
          [6.6, 10],
        ],
        "T",
      ),
      S(
        [
          [1, 5],
          [6.6, 5],
        ],
        "t",
        NO,
      ),
    ],
  ],
  I: [
    2,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
    ],
  ],
  J: [5, [S([[3.8, 0], [3.8, 7], ...arc(2.2, 7, 1.6, 3, 0, 150, 12).slice(1)], "m", [true, false])]],
  K: [
    7.2,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S(
        [
          [6.6, 0],
          [1.2, 6],
        ],
        "t",
        [true, false],
      ),
      S(
        [
          [3.2, 3.9],
          [6.9, 10],
        ],
        "T",
        [false, true],
      ),
    ],
  ],
  L: [
    6,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
        [true, false],
      ),
      S(
        [
          [1, 10],
          [5.8, 10],
        ],
        "t",
        NO,
      ),
      S(
        [
          [5.8, 10],
          [5.8, 7.9],
        ],
        "t",
        NO,
      ),
    ],
  ],
  M: [
    9.8,
    [
      S(
        [
          [0.5, 10],
          [1.5, 0],
        ],
        "t",
        [true, false],
      ),
      S(
        [
          [1.5, 0],
          [4.9, 8.4],
        ],
        "T",
        NO,
      ),
      S(
        [
          [4.9, 8.4],
          [8.3, 0],
        ],
        "t",
        NO,
      ),
      S(
        [
          [8.3, 0],
          [9.3, 10],
        ],
        "T",
        [false, true],
      ),
    ],
  ],
  N: [
    7.8,
    [
      S(
        [
          [1, 10],
          [1, 0],
        ],
        "t",
        [true, false],
      ),
      S(
        [
          [1, 0],
          [6.8, 10],
        ],
        "T",
        NO,
      ),
      S(
        [
          [6.8, 10],
          [6.8, 0],
        ],
        "t",
        [false, true],
      ),
    ],
  ],
  O: [8.2, [{ p: pointedO(8.2), w: "m", serif: NO, closed: true }]],
  P: [
    6.8,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S([[1, 0], [3.6, 0], ...arc(3.6, 2.75, 2.7, 2.75, -90, 90, 14).slice(1), [1, 5.5]], "m", NO),
    ],
  ],
  Q: [
    8.2,
    [
      { p: pointedO(8.2), w: "m", serif: NO, closed: true },
      S(
        [
          [4.8, 8.4],
          [7.6, 11],
        ],
        "T",
        NO,
      ),
    ],
  ],
  R: [
    7,
    [
      S(
        [
          [1, 0],
          [1, 10],
        ],
        "T",
      ),
      S([[1, 0], [3.6, 0], ...arc(3.6, 2.75, 2.7, 2.75, -90, 90, 14).slice(1), [1, 5.5]], "m", NO),
      S(
        [
          [3.3, 5.5],
          [6.8, 10],
        ],
        "T",
        [false, true],
      ),
    ],
  ],
  S: [
    6.4,
    [
      S(
        [...arc(3.2, 2.6, 2.6, 2.6, -25, -268, 20), ...arc(3.2, 7.4, 2.8, 2.6, -88, 152, 20).slice(1)],
        "s",
        NO,
      ),
      S(
        [
          [5.55, 0.4],
          [5.55, 2.6],
        ],
        "t",
        NO,
      ),
    ],
  ],
  T: [
    7.2,
    [
      S(
        [
          [0.3, 0],
          [6.9, 0],
        ],
        "t",
        NO,
      ),
      S(
        [
          [0.3, 0],
          [0.3, 2.1],
        ],
        "t",
        NO,
      ),
      S(
        [
          [6.9, 0],
          [6.9, 2.1],
        ],
        "t",
        NO,
      ),
      S(
        [
          [3.6, 0],
          [3.6, 10],
        ],
        "T",
        [false, true],
      ),
    ],
  ],
  U: [
    7.6,
    [
      S([[1, 0], [1, 6.6], ...arc(3.8, 6.6, 2.8, 3.4, 180, 90, 10).slice(1)], "m", [true, false]),
      S([...arc(3.8, 6.6, 2.8, 3.4, 90, 0, 10), [6.6, 0]], "t", [false, true]),
    ],
  ],
  V: [
    7.8,
    [
      S(
        [
          [0.3, 0],
          [3.9, 10],
        ],
        "T",
        [true, false],
      ),
      S(
        [
          [3.9, 10],
          [7.5, 0],
        ],
        "t",
        [false, true],
      ),
    ],
  ],
  W: [
    11.6,
    [
      S(
        [
          [0.3, 0],
          [3.1, 10],
        ],
        "T",
        [true, false],
      ),
      S(
        [
          [3.1, 10],
          [5.8, 0.6],
        ],
        "t",
        NO,
      ),
      S(
        [
          [5.8, 0.6],
          [8.5, 10],
        ],
        "T",
        NO,
      ),
      S(
        [
          [8.5, 10],
          [11.3, 0],
        ],
        "t",
        [false, true],
      ),
    ],
  ],
  X: [
    7.4,
    [
      S(
        [
          [0.4, 0],
          [7, 10],
        ],
        "T",
      ),
      S(
        [
          [7, 0],
          [0.4, 10],
        ],
        "t",
      ),
    ],
  ],
  Y: [
    7.4,
    [
      S(
        [
          [0.3, 0],
          [3.7, 5.3],
        ],
        "T",
        [true, false],
      ),
      S(
        [
          [7.1, 0],
          [3.7, 5.3],
        ],
        "t",
        [true, false],
      ),
      S(
        [
          [3.7, 5.3],
          [3.7, 10],
        ],
        "T",
        [false, true],
      ),
    ],
  ],
  Z: [
    6.6,
    [
      S(
        [
          [0.6, 0],
          [6.1, 0],
        ],
        "t",
        NO,
      ),
      S(
        [
          [0.6, 0],
          [0.6, 2.1],
        ],
        "t",
        NO,
      ),
      S(
        [
          [6.1, 0],
          [0.5, 10],
        ],
        "T",
        NO,
      ),
      S(
        [
          [0.5, 10],
          [6.2, 10],
        ],
        "t",
        NO,
      ),
      S(
        [
          [6.2, 10],
          [6.2, 7.9],
        ],
        "t",
        NO,
      ),
    ],
  ],
  "·": [
    2.8,
    [
      {
        poly: [
          [1.4, 3.6],
          [2.6, 5],
          [1.4, 6.4],
          [0.2, 5],
        ],
      },
    ],
  ],
  "-": [
    4,
    [
      S(
        [
          [0.4, 5.2],
          [3.6, 5.2],
        ],
        "t",
        NO,
      ),
    ],
  ],
  " ": [3.6, []],
};
const TRACK = 1.1;
/** A line of text's width in units of cap height 10 (before scaling). */
export const textWidth = (text, tracking = TRACK) => {
  const cs = [...String(text).toUpperCase()].filter((c) => GLYPHS[c]);
  return cs.reduce((s, c) => s + GLYPHS[c][0], 0) + Math.max(0, cs.length - 1) * tracking;
};
/**
 * A line of text as polygons: cap height `size` px, its baseline at `y`, `x` the left, centre or right as `align`
 * says; `maxWidth` shrinks it to fit. `weight` { T, t } the thick and thin strokes in units (default 1.85 and 0.8);
 * `serifs` false for a plain letter. Returns `{ polys, width, size }`. A character not in GLYPHS is refused by name.
 */
export function textPolys(
  text,
  { x = 0, y = 10, size = 10, align = "left", tracking = TRACK, maxWidth, weight = {}, serifs = true } = {},
) {
  const chars = [...String(text).toUpperCase()];
  for (const c of chars)
    if (!GLYPHS[c]) throw new Error(`the letter ${JSON.stringify(c)} is not drawn in the alphabet`);
  const units = textWidth(text, tracking);
  const k = Math.min(size, maxWidth ? (maxWidth / units) * CAP : Infinity) / CAP;
  const T = weight.T ?? 1.85;
  const t = weight.t ?? 0.8;
  const left = align === "middle" ? x - (units * k) / 2 : align === "right" ? x - units * k : x;
  const top = y - CAP * k;
  const polys = [];
  let pen = 0;
  for (const c of chars) {
    const [w, strokes] = GLYPHS[c];
    for (const s of strokes) {
      if (s.poly) {
        polys.push(s.poly.map(([px, py]) => [px + pen, py]));
        continue;
      }
      const pts = s.p.map(([px, py]) => [px + pen, py]);
      let widths;
      if (s.w === "T" || s.w === "t") widths = s.w === "T" ? T : t;
      else {
        // modulated: thick where the stroke runs up and down, thin across (an engraver's vertical stress)
        const [lo, hi] = s.w === "s" ? [t + (T - t) * 0.45, T] : [t, T];
        const n = pts.length;
        widths = pts.map((_, i) => {
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(n - 1, i + 1)];
          const d = unit(sub(b, a));
          return lo + (hi - lo) * Math.abs(d[1]) ** 1.5;
        });
        if (s.closed) widths = widths.map((v, i) => (i === 0 || i === n - 1 ? lo : v));
      }
      polys.push(...strokeOf(pts, widths, { closed: !!s.closed, flatY: [0, CAP] }));
      if (!serifs) continue;
      [0, pts.length - 1].forEach((i, e) => {
        if (!s.serif[e]) return;
        const p = pts[i];
        if (p[1] !== 0 && p[1] !== CAP) return;
        const h = (typeof widths === "number" ? widths : widths[i]) / 2;
        const into = p[1] === 0 ? 1 : -1;
        const ext = 0.55 + t * 0.6;
        const deep = 1.15 + t * 0.4;
        polys.push([
          [p[0] - h - ext, p[1]],
          [p[0] + h + ext, p[1]],
          [p[0] + h, p[1] + into * deep],
          [p[0] - h, p[1] + into * deep],
        ]);
      });
    }
    pen += w + tracking;
  }
  return { polys: transformPolys(polys, { s: k, dx: left, dy: top }), width: units * k, size: CAP * k };
}

// ── colours ────────────────────────────────────────────────────────────────
const hex = (rgb) =>
  "#" +
  rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const hslHex = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return hex([0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
};
/** The MSR's colours for a hue (msrHue: 270 purple, about 215 for H9's blue). */
export const msrColours = (hue = 270) => ({
  gold: "#b09a64",
  goldDark: "#6e5a30",
  field: hslHex(hue, 0.34, 0.2),
  fieldLight: hslHex(hue, 0.3, 0.3),
  dark: "#17141b",
  ink: "#d9d2bf",
  paper: "#d3c7a6",
  red: "#a3201b",
});
/** Role -> colour maps over the MSR colours: the sign, the stencil, the height for the emboss. */
export const PALETTES = {
  sign: (c) => ({ gold: c.gold, field: c.field, dark: c.dark, line: c.goldDark }),
  stencil: (c) => ({ gold: c.ink, field: null, dark: null, line: null }),
  height: () => ({ gold: "#ffffff", field: "#4d4d4d", dark: "#000000", line: "#9a9a9a" }),
};

// ── the SVG ────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * The design as an SVG document: each item a <path> in its role's colour (roles mapped to null are left out),
 * its cuts as a luminance mask, a blur as a feGaussianBlur filter. `background` a colour under everything.
 */
export function designSvg(design, palette, { title = "", background = null, note = "" } = {}) {
  const [w, h] = design.size;
  const defs = [];
  const body = [];
  if (background) body.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${background}"/>`);
  design.items.forEach((it, i) => {
    const fill = it.colour ?? palette[it.role];
    if (!fill || !it.polys.length) return;
    const attrs = [`d="${dpath(it.polys)}"`, `fill="${fill}"`];
    if (it.rule === "evenodd") attrs.push('fill-rule="evenodd"');
    if (it.opacity !== undefined && it.opacity < 1) attrs.push(`fill-opacity="${r2(it.opacity)}"`);
    const wrap = [];
    if (it.cuts?.length) {
      defs.push(
        `<mask id="cut${i}"><rect x="-1" y="-1" width="${w + 2}" height="${h + 2}" fill="#ffffff"/><path d="${dpath(it.cuts)}" fill="#000000"/></mask>`,
      );
      wrap.push(`mask="url(#cut${i})"`);
    }
    if (it.blur) {
      defs.push(
        `<filter id="soft${i}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${r2(it.blur)}"/></filter>`,
      );
      wrap.push(`filter="url(#soft${i})"`);
    }
    const path = `<path ${attrs.join(" ")}/>`;
    body.push(wrap.length ? `<g ${wrap.join(" ")}>${path}</g>` : path);
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<title>${esc(title)}</title>`,
    `<!-- ${esc(note || "New Byzantium art kit: our own vector art, drawn by levels/lib/emblems.mjs (SMAK). Nothing traced or copied.")} -->`,
    defs.length ? `<defs>${defs.join("")}</defs>` : "",
    ...body,
    "</svg>",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
/** The design scaled by `s` and moved by (dx, dy), items and cuts alike (to place one design inside another). */
export const placeDesign = (design, opts) =>
  design.items.map((it) => ({
    ...it,
    polys: transformPolys(it.polys, opts),
    cuts: it.cuts && transformPolys(it.cuts, opts),
    blur: it.blur && it.blur * (opts.s ?? 1),
  }));

/** The design scaled and centred so its shapes fill its box less `margin` on every side. */
export function fitDesign(design, margin = 8) {
  const [w, h] = design.size;
  const b = bbox(design.items.flatMap((it) => it.polys));
  const s = Math.min((w - 2 * margin) / (b[2] - b[0]), (h - 2 * margin) / (b[3] - b[1]));
  const dx = w / 2 - ((b[0] + b[2]) / 2) * s;
  const dy = h / 2 - ((b[1] + b[3]) / 2) * s;
  return { ...design, items: placeDesign(design, { s, dx, dy }) };
}

// ── the MSR's emblem: three variants ───────────────────────────────────────
const C = 128;
const HEAVY = { T: 2.5, t: 1.45 };
/** The MSR letters inside a triangle's top: cap height `size`, baseline `y`. */
const msrLetters = (y, size, weight = HEAVY) =>
  textPolys("MSR", { x: C, y, size, align: "middle", weight, tracking: 1.4 }).polys;
/** A feather: a pointed blade from `root` along `deg`, `len` long, `w` wide at the root. */
const blade = (root, deg, L, w, lean = 0.25) => {
  const d = dir(deg);
  const n = perp(d);
  return [
    add(root, mul(n, w / 2)),
    add(add(root, mul(d, L * 0.72)), mul(n, w * lean)),
    add(root, mul(d, L)),
    add(add(root, mul(d, L * 0.6)), mul(n, -w * 0.5)),
    add(root, mul(n, -w / 2)),
  ];
};
/** A head in profile facing left: skull, hooked beak, crest; its eye a cut. `k` scales it, (x, y) the skull's centre. */
const eagleHead = (x, y, k = 1) => {
  const at = (px, py) => [x + px * k, y + py * k];
  const skull = arc(x, y, 13 * k, 12 * k, -200, 140, 22);
  const beak = [
    at(-8, -8),
    at(-20, -8.5),
    at(-28, -5),
    at(-33, 2),
    at(-31, 10),
    at(-27, 5),
    at(-20, 7),
    at(-8, 10),
  ];
  const crest = [at(8, -9), at(22, -14), at(16, -6), at(25, -4), at(11, 3)];
  return {
    polys: [skull, beak, crest],
    eye: [circle(x - 4 * k, y - 2.5 * k, 2.6 * k, 12)],
    mouth: [[at(-27, 1.6), at(-13, 2.2), at(-13, 3.8), at(-26, 3.2)]],
  };
};

/** A: the double-headed eagle over the triangle, wings displayed, heads turned out (the Byzantine tradition). */
function emblemBicephalus() {
  const tri = [
    [58, 104],
    [198, 104],
    [128, 228],
  ];
  const innerTri = inset(tri, 10);
  const gold = [];
  const cuts = [];
  // the left wing (mirrored for the right): an arm rising from behind the triangle's corner, five broad primaries
  const arm = [
    [100, 106],
    [72, 80],
    [44, 60],
    [16, 50],
  ];
  const wing = [...strokeOf(arm, [30, 26, 20, 13])];
  const roots = [
    [90, 104],
    [74, 90],
    [58, 76],
    [42, 64],
    [27, 56],
  ];
  const angles = [100, 114, 128, 142, 156];
  const lengths = [44, 50, 54, 54, 46];
  roots.forEach((r, i) => wing.push(blade(r, angles[i], lengths[i], 17 - i, 0.12)));
  // coverts: short cuts along the arm, the wing's upper feathers
  const covert = [];
  [
    [84, 92],
    [68, 78],
    [52, 66],
  ].forEach(([x, y]) => covert.push(blade([x, y], 126, 15, 5.5, 0.1)));
  gold.push(...wing, ...mirrorX(wing, C));
  cuts.push(...covert, ...mirrorX(covert, C));
  // necks and heads, turned outward
  const neck = strokeOf(
    [
      [120, 108],
      [114, 88],
      [106, 70],
      [101, 58],
    ],
    [20, 17, 15, 14],
  );
  const head = eagleHead(99, 45, 1.15);
  gold.push(...neck, ...mirrorX(neck, C), ...head.polys, ...mirrorX(head.polys, C));
  cuts.push(...head.eye, ...mirrorX(head.eye, C), ...head.mouth, ...mirrorX(head.mouth, C));
  // the tail fanned under the apex
  gold.push(
    blade([128, 206], 90, 46, 17, 0),
    blade([123, 204], 114, 38, 13, 0),
    blade([133, 204], 66, 38, 13, 0),
  );
  // a lozenge between the heads (the Republic's star of state, ours)
  gold.push([
    [128, 48],
    [137, 62],
    [128, 76],
    [119, 62],
  ]);
  return {
    size: [256, 256],
    items: [
      { role: "gold", polys: [...gold, tri], cuts: [innerTri, ...cuts] },
      { role: "field", polys: [innerTri] },
      {
        role: "gold",
        polys: [
          ...msrLetters(148, 27),
          [
            [128, 165],
            [137, 179],
            [128, 193],
            [119, 179],
          ],
        ],
      },
    ],
  };
}

/** B: the eagle as the triangle: raised wings of stacked slats form its sides, a lintel its top, the head above. */
function emblemAscendant() {
  const apex = [128, 246];
  const xo = (y) => 128 - (114 * (246 - y)) / 196; // the wing's outer line, apex to the tip
  const xi = (y) => 128 - (64 * (188 - y)) / 116; // the field's side
  const gold = [];
  const cuts = [];
  const slats = 5;
  const yTop = 72;
  const yBot = 188;
  const wingL = [];
  for (let k = 0; k < slats; k++) {
    const y0 = yTop + ((yBot - yTop) * k) / slats + (k ? 2.2 : 0);
    const y1 = yTop + ((yBot - yTop) * (k + 1)) / slats - 2.2;
    const reach = 22 - k * 3.4; // upper feathers reach further out
    wingL.push([
      [xi(y0), y0],
      [xo(y0) - reach, y0 - reach * 0.45],
      [xo(y1), y1],
      [xi(y1), y1],
    ]);
  }
  gold.push(...wingL, ...mirrorX(wingL, C));
  // the tail: the triangle's foot below the field, two chevrons cut in it
  const yt = yBot + 2.2;
  gold.push([[xo(yt), yt], [256 - xo(yt), yt], apex]);
  const vee = (y, w2, t) => [
    [128 - w2, y],
    [128, y + w2 * 0.85],
    [128 + w2, y],
    [128 + w2 - t, y],
    [128, y + w2 * 0.85 - t * 1.3],
    [128 - w2 + t, y],
  ];
  cuts.push(vee(200, 30, 5), vee(216, 16, 4.5));
  // the lintel: the triangle's top, from wing tip to wing tip
  gold.push([
    [10, 50],
    [246, 50],
    [236, 69],
    [20, 69],
  ]);
  // the head above the lintel, severe: straight cuts, a hooked beak
  const head = [
    [114, 52],
    [111, 32],
    [118, 16],
    [134, 10],
    [148, 16],
    [154, 30],
    [148, 52],
  ];
  const beak = [
    [121, 15],
    [100, 20],
    [86, 32],
    [88, 40],
    [97, 31],
    [116, 33],
  ];
  gold.push(head, beak);
  cuts.push(
    circle(127, 24, 3.4, 12),
    [
      [110, 28],
      [94, 32],
      [95, 34.5],
      [111, 31.5],
    ],
    [
      [124, 42],
      [140, 42],
      [140, 46],
      [124, 46],
    ],
  );
  const field = [
    [xi(yTop - 3), yTop - 3],
    [256 - xi(yTop - 3), yTop - 3],
    [128, yBot],
  ];
  return {
    size: [256, 256],
    items: [
      { role: "field", polys: [field] },
      { role: "gold", polys: gold, cuts },
      {
        role: "gold",
        polys: [
          ...msrLetters(122, 28, { T: 2.7, t: 1.6 }),
          [
            [128, 140],
            [136, 152],
            [128, 164],
            [120, 152],
          ],
        ],
      },
    ],
  };
}

/** C: the triangle in a toothed wheel, the eagle rising from it, laurel under: the industrial-imperial seal. */
function emblemFoundry() {
  const cx = 128;
  const cy = 120;
  const gold = [];
  const cuts = [];
  // the wheel: a ring with sixteen teeth
  const teeth = 16;
  const ro = 104;
  const ri = 92;
  const ring = [];
  for (let k = 0; k < teeth; k++) {
    const a = (360 / teeth) * k - 90;
    const s = 360 / teeth;
    ring.push(
      ...arc(cx, cy, ri, ri, a - s / 2, a - s * 0.22, 3),
      ...arc(cx, cy, ro, ro, a - s * 0.15, a + s * 0.15, 3),
      ...arc(cx, cy, ri, ri, a + s * 0.22, a + s / 2, 3).slice(0, -1),
    );
  }
  const bore = circle(cx, cy, 78, 64);
  // the inverted triangle within the bore, solid gold, MSR cut through it
  const tri = [
    [cx - 66, cy - 18],
    [cx + 66, cy - 18],
    [cx, cy + 72],
  ];
  // the eagle: wings raised in a V behind the head, the head in profile over the triangle's top
  const arm = [
    [cx - 12, cy - 18],
    [cx - 36, cy - 34],
    [cx - 58, cy - 50],
  ];
  const wingL = [...strokeOf(arm, [18, 15, 10])];
  [
    [cx - 22, cy - 30],
    [cx - 34, cy - 38],
    [cx - 46, cy - 46],
    [cx - 57, cy - 53],
  ].forEach((r, i) => wingL.push(blade(r, -100 - i * 13, 30 + i * 2, 12, 0.1)));
  const head = eagleHead(cx + 6, cy - 54, 1.3);
  const neck = strokeOf(
    [
      [cx, cy - 16],
      [cx + 3, cy - 34],
      [cx + 5, cy - 46],
    ],
    [24, 20, 18],
  );
  gold.push(...wingL, ...mirrorX(wingL, cx), ...neck, ...head.polys, tri);
  cuts.push(...head.eye, ...head.mouth, ...msrLetters(cy + 16, 28, { T: 2.7, t: 1.6 }));
  // laurel: two sprigs under the wheel, leaves in pairs along an arc
  const sprig = [];
  const stem = arc(cx, cy, 120, 118, 96, 170, 12);
  sprig.push(...strokeOf(stem, 4));
  stem.forEach((p, i) => {
    if (i < 1 || i > 11) return;
    const t = sub(stem[Math.min(stem.length - 1, i + 1)], stem[i - 1]);
    const a = (Math.atan2(t[1], t[0]) * 180) / Math.PI;
    sprig.push(blade(p, a - 42, 22, 10, 0.05), blade(p, a + 42, 20, 9, 0.05));
  });
  return {
    size: [256, 256],
    items: [
      { role: "gold", polys: [ring], cuts: [bore] },
      { role: "field", polys: [bore] },
      { role: "gold", polys: [...gold, ...sprig, ...mirrorX(sprig, cx)], cuts },
    ],
  };
}

export const MSR_VARIANTS = {
  a: {
    name: "Bicephalus",
    line: "a double-headed eagle displayed over the inverted triangle, heads turned out, MSR on a purple field",
    make: emblemBicephalus,
  },
  b: {
    name: "Ascendant",
    line: "the eagle is the triangle: raised stepped wings as its sides, a lintel, the head above, MSR and three tail chevrons inside",
    make: emblemAscendant,
  },
  c: {
    name: "Foundry",
    line: "a solid triangle with MSR cut through, inside a toothed wheel, the eagle rising from it, laurel under",
    make: emblemFoundry,
  },
};
/** One MSR emblem variant's design (256 x 256). */
export function msrEmblem(id) {
  const v = MSR_VARIANTS[id];
  if (!v) throw new Error(`MSR emblem ${id} is not one of ${Object.keys(MSR_VARIANTS).join(", ")}`);
  return fitDesign(v.make(), 8);
}

// ── the Insurgents' marks ──────────────────────────────────────────────────
/** 1: the Upturned: the regime's triangle stood the right way up, its base a row of cog teeth, split by a crack. */
function markUpturned() {
  const tri = [
    [128, 22],
    [232, 200],
    [24, 200],
  ];
  const hole = inset(tri, 27);
  const teeth = [];
  for (let k = 0; k < 5; k++) {
    const x = 50 + k * 39;
    teeth.push([
      [x - 12, 198],
      [x + 12, 198],
      [x + 9, 226],
      [x - 9, 226],
    ]);
  }
  // a jagged crack from the apex to the base, and the stencil's bridges at the sides
  const crack = [
    [
      [123, 8],
      [135, 8],
      [128, 66],
      [143, 96],
      [121, 140],
      [140, 178],
      [127, 240],
      [118, 240],
      [129, 178],
      [110, 140],
      [131, 96],
      [117, 66],
    ],
  ];
  const bridges = [
    ...strokeOf(
      [
        [62, 126],
        [92, 142],
      ],
      6,
    ),
    ...strokeOf(
      [
        [194, 126],
        [164, 142],
      ],
      6,
    ),
  ];
  return {
    size: [256, 256],
    items: [{ role: "paint", polys: [tri, ...teeth], cuts: [hole, ...crack, ...bridges] }],
    style: "stencil",
  };
}

/** 3: the Claw: the regime's triangle sprayed solid by hand and torn through by three claw gashes (the mutants' mark). */
function markClaw() {
  // the triangle filled freehand: its sides wander a little, as a can held at arm's length
  const corners = [
    [30, 50],
    [226, 46],
    [128, 226],
  ];
  const tri = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 3];
    for (let k = 0; k < 9; k++) {
      const t = k / 9;
      const nrm = unit(perp(sub(b, a)));
      const j = (hash01(31, i, k) - 0.5) * 7;
      tri.push(add(lerp(a, b, t), mul(nrm, j)));
    }
  });
  // three gashes raking down from the upper right, each a crescent tapered at both ends
  const gash = (x0, y0, x1, y1, w, seed) => {
    const n = 14;
    const d = unit(sub([x1, y1], [x0, y0]));
    const nrm = perp(d);
    const left = [];
    const right = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bow = Math.sin(t * Math.PI) * 10;
      const half = (w / 2) * Math.sin(Math.min(1, 0.04 + t) * Math.PI) ** 0.8 + 0.4;
      const c = add(lerp([x0, y0], [x1, y1], t), mul(nrm, bow + (hash01(seed, i) - 0.5) * 1.5));
      left.push(add(c, mul(nrm, half)));
      right.push(sub(c, mul(nrm, half)));
    }
    return [...left, ...right.reverse()];
  };
  const gashes = [
    gash(150, 20, 58, 170, 17, 21),
    gash(196, 28, 100, 200, 19, 22),
    gash(236, 40, 140, 214, 17, 23),
  ];
  return {
    size: [256, 256],
    items: [{ role: "paint", polys: [tri], cuts: gashes }],
    style: "freehand",
  };
}

export const INSURGENT_VARIANTS = {
  1: {
    name: "Upturned",
    line: "the regime's triangle turned point-up on a cog-toothed base, split by a jagged crack; cut stencil with bridges",
    make: markUpturned,
  },
  3: {
    name: "Claw",
    line: "the regime's triangle sprayed solid by hand and torn through by three claw gashes; heavy drips",
    make: markClaw,
  },
};
/** One Insurgent mark's design (256 x 256), with its overspray and drips (`seed`). */
export function insurgentMark(id, seed = 1) {
  const v = INSURGENT_VARIANTS[id];
  if (!v) throw new Error(`Insurgent mark ${id} is not one of ${Object.keys(INSURGENT_VARIANTS).join(", ")}`);
  return sprayItems(fitDesign(v.make(), 14), seed + Number(id) * 101);
}

/**
 * Spray paint over a design's paint: its edges softened (blur), overspray dots scattered just outside the edges,
 * drips running down from the edges that face down. Where each lands is a hash of `seed`, the edge and the place
 * along it: the same seed, the same drips.
 */
export function sprayItems(design, seed = 1) {
  const freehand = design.style === "freehand";
  const dots = [];
  const drips = [];
  const paint = design.items.filter((it) => it.role === "paint");
  const solid = paint.flatMap((it) => it.polys);
  let n = 0;
  const lastDrip = [];
  for (const poly of solid) {
    const p = orient(poly);
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const L = len(sub(b, a));
      const nrm = unit([b[1] - a[1], -(b[0] - a[0])]); // outward for a clockwise polygon on screen
      for (let s = 0; s < L; s += 2.6) {
        n++;
        const q = lerp(a, b, s / L);
        const h = hash01(seed, n, 7);
        if (h < (freehand ? 0.55 : 0.32)) {
          const off = 1.5 + hash01(seed, n, 8) ** 2 * (freehand ? 12 : 7);
          const r = 1.1 + hash01(seed, n, 9) * (freehand ? 1.8 : 1.3);
          dots.push(circle(q[0] + nrm[0] * off, q[1] + nrm[1] * off, r, 8));
        }
        if (
          nrm[1] > (freehand ? 0.45 : 0.75) &&
          hash01(seed, n, 10) < (freehand ? 0.07 : 0.035) &&
          !lastDrip.some(([x, y]) => Math.abs(x - q[0]) < 12 && Math.abs(y - q[1]) < 30)
        ) {
          lastDrip.push(q);
          const w = 3.2 + hash01(seed, n, 12) * 2.4;
          const room = design.size[1] - 4 - w - q[1]; // a drip stops inside the texture
          const L2 = Math.min(room, 12 + hash01(seed, n, 11) ** 1.5 * (freehand ? 70 : 46));
          if (L2 < 6) continue;
          const top = [q[0], q[1] - 3];
          const end = [q[0] + (hash01(seed, n, 13) - 0.5) * 2, q[1] + L2];
          drips.push(
            ...strokeOf([top, lerp(top, end, 0.5), end], [w, w * 0.8, w * 0.62]),
            circle(end[0], end[1] + 1, w * 0.62, 12),
          );
        }
      }
    }
  }
  return {
    ...design,
    items: [
      ...design.items.map((it) => (it.role === "paint" ? { ...it, blur: freehand ? 1.6 : 0.9 } : it)),
      { role: "paint", polys: drips, blur: 0.7 },
      { role: "paint", polys: dots, blur: 0.45 },
    ],
  };
}

// ── mock-ups ───────────────────────────────────────────────────────────────
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; // prettier-ignore
const lozenge = (x, y, r) => [[x, y - r], [x + r, y], [x, y + r], [x - r, y]]; // prettier-ignore
/** A ragged hole round (cx, cy): its radius wanders by a hash of `seed`. */
const raggedHole = (cx, cy, r, seed, n = 11) =>
  Array.from({ length: n }, (_, k) =>
    add([cx, cy], mul(dir((360 / n) * k), r * (0.55 + 0.7 * hash01(seed, k)))),
  );
/**
 * A hanging banner, 128 x 256: purple cloth, gold border, swallowtail foot, the emblem; folds as soft bands.
 * `torn`: the same banner after years at a lower layer's checkpoint: the foot ripped away raggedly, a slit, holes
 * through the cloth, soot and grime over it (holes are holes: the texture is masked).
 */
export function bannerDesign(emblem, { torn = false, seed = 7 } = {}) {
  const shape = [[0, 10], [128, 10], [128, 250], [64, 214], [0, 250]]; // prettier-ignore
  const border = inset(shape, 5);
  const borderIn = inset(shape, 10);
  const folds = [18, 50, 84, 112].map((x, i) =>
    rect(x - 5, 12, x + 5, 250).map(([px, py]) => [px + (i % 2 ? 1 : -1) * (py - 12) * 0.012, py]),
  );
  const lights = [32, 66, 98].map((x) => rect(x - 4, 12, x + 4, 250));
  const rings = [10, 40, 74, 108].map((x) => rect(x, 2, x + 10, 14));
  const tassels = [[[0, 250], [6, 244], [8, 256], [2, 256]], [[128, 250], [122, 244], [120, 256], [126, 256]], lozenge(64, 223, 7)]; // prettier-ignore
  const items = [
    { role: "field", polys: [shape] },
    { role: "shade", polys: folds, colour: "#000000", opacity: 0.32, blur: 4 },
    { role: "shade", polys: lights, colour: "#ffffff", opacity: 0.09, blur: 4 },
    { role: "gold", polys: [border, borderIn], rule: "evenodd" },
    ...placeDesign(emblem, { s: 0.44, dx: 64 - 128 * 0.44, dy: 96 - 128 * 0.44 }),
    { role: "gold", polys: [44, 64, 84].map((x) => lozenge(x, 193, 7)).concat(tassels) },
    { role: "metal", polys: [rect(0, 0, 128, 10), ...rings], colour: "#3a3a40" },
  ];
  if (!torn) return { size: [128, 256], items };
  // the foot ripped away along a ragged line, deeper on the right; a slit up from it; holes through the cloth
  const rag = [];
  for (let k = 0; k <= 18; k++) {
    const x = -4 + (136 * k) / 18;
    rag.push([x, 198 - (x / 128) * 24 + 26 * hash01(seed, k, 1) + (k % 2 ? 6 : 0)]);
  }
  const cuts = [
    [...rag, [140, 270], [-12, 270]],
    [[36, 270], [47, 270], [44, 168], [41, 160]], // prettier-ignore
    raggedHole(98, 132, 8, seed + 1),
    raggedHole(24, 164, 5, seed + 2),
    raggedHole(86, 34, 4, seed + 3),
  ];
  const soot = [raggedHole(98, 132, 15, seed + 4), raggedHole(24, 164, 10, seed + 5), rect(0, 150, 128, 230)];
  return {
    size: [128, 256],
    items: [
      ...items,
      { role: "shade", polys: soot, colour: "#0c0a08", opacity: 0.42, blur: 6 },
      { role: "shade", polys: [rect(0, 10, 128, 60)], colour: "#3b3428", opacity: 0.2, blur: 10 },
    ].map((it) => ({ ...it, cuts: [...(it.cuts ?? []), ...cuts] })),
  };
}
/** A wall plaque, 128 x 64: a brass plate, the emblem at the left, one or two engraved lines at the right. */
export function plaqueDesign(emblem, lines) {
  const text = [];
  const ys = lines.length === 1 ? [38] : [28, 47];
  lines.forEach((l, i) =>
    text.push(
      ...textPolys(l, {
        x: 91,
        y: ys[i],
        size: 11,
        align: "middle",
        maxWidth: 60,
        weight: { T: 2.1, t: 1.0 },
      }).polys,
    ),
  );
  const screws = [[10, 10], [118, 10], [10, 54], [118, 54]].map(([x, y]) => circle(x, y, 2.2, 10)); // prettier-ignore
  return {
    size: [128, 64],
    items: [
      { role: "plate", polys: [rect(0, 0, 128, 64)] },
      { role: "line", polys: [rect(3, 3, 125, 61), rect(6, 6, 122, 58)], rule: "evenodd" },
      { role: "engrave", polys: [...text, ...screws] },
      ...placeDesign(emblem, { s: 0.215, dx: 34 - 128 * 0.215, dy: 32 - 128 * 0.215 }).map((it) => ({
        ...it,
        role: it.role === "field" ? "engrave" : "relief",
      })),
    ],
  };
}
/** The poster block's background behind the emblem: a pattern in the lighter purple, clipped to the block. */
function posterPattern(kind) {
  const polys = [];
  if (kind === "rays" || kind === "rays24") {
    const n = kind === "rays" ? 16 : 24;
    for (let k = 0; k < n; k += 2)
      polys.push([[64, 64], ...arc(64, 64, 120, 120, (360 / n) * k - 90, (360 / n) * (k + 1) - 90, 3)]);
  } else if (kind === "bands") for (let y = 7; y < 118; y += 14) polys.push(rect(0, y, 128, y + 7));
  else if (kind === "rings")
    for (let r = 18; r < 100; r += 16) polys.push(circle(64, 64, r + 8, 48), circle(64, 64, r, 48));
  else if (kind === "diagonal")
    for (let x = -120; x < 128; x += 18) polys.push([[x, 0], [x + 9, 0], [x + 129, 120], [x + 120, 120]]); // prettier-ignore
  else throw new Error(`poster pattern ${kind} is not rays, rays24, bands, rings or diagonal`);
  return { polys, rule: kind === "rings" ? "evenodd" : undefined };
}
/**
 * A propaganda poster, 128 x 192: cream paper, the emblem in a purple block over a pattern, a slogan of two lines in
 * the drawn capitals, gold rules, and MSR between lozenges at the foot.
 */
export function posterDesign(emblem, [l1, l2], { pattern = "rays" } = {}) {
  const p = posterPattern(pattern);
  const outside = [
    rect(-1, -1, 129, 7),
    rect(-1, 118, 129, 193),
    rect(-1, -1, 7, 193),
    rect(121, -1, 129, 193),
  ];
  const t1 = textPolys(l1, {
    x: 64,
    y: 146,
    size: 19,
    align: "middle",
    maxWidth: 110,
    weight: { T: 2.2, t: 1.05 },
  }).polys;
  const t2 = textPolys(l2, {
    x: 64,
    y: 168,
    size: 14,
    align: "middle",
    maxWidth: 108,
    weight: { T: 2.3, t: 1.1 },
  }).polys;
  const foot = textPolys("MSR", {
    x: 64,
    y: 187,
    size: 9,
    align: "middle",
    weight: { T: 2.4, t: 1.3 },
    tracking: 2,
  }).polys;
  return {
    size: [128, 192],
    items: [
      { role: "paper", polys: [rect(0, 0, 128, 192)] },
      { role: "field", polys: [rect(7, 7, 121, 118)] },
      { role: "ray", polys: p.polys, rule: p.rule, cuts: outside },
      ...placeDesign(emblem, { s: 0.42, dx: 64 - 128 * 0.42, dy: 64 - 128 * 0.42 }),
      { role: "gold", polys: [rect(14, 123, 114, 125), lozenge(9, 124, 3), lozenge(119, 124, 3), rect(14, 172, 114, 174), rect(18, 181, 46, 182.5), rect(82, 181, 110, 182.5), lozenge(50, 182, 2.5), lozenge(78, 182, 2.5)] }, // prettier-ignore
      { role: "slogan", polys: [...t1, ...t2, ...foot] },
    ],
  };
}
/** The six posters: the emblem (an MSR variant), the slogan's two lines, the block's pattern. Fictional, in the regime's voice. */
export const POSTERS = {
  1: { emblem: "a", lines: ["ORDER", "IS PEACE"], pattern: "rays" },
  2: { emblem: "b", lines: ["REPORT", "DISSENT"], pattern: "bands" },
  3: { emblem: "c", lines: ["WORK", "BINDS US"], pattern: "rays" },
  4: { emblem: "b", lines: ["THE REPUBLIC", "PROVIDES"], pattern: "rings" },
  5: { emblem: "b", lines: ["OBEY THE", "CURFEW"], pattern: "rays24" },
  6: { emblem: "a", lines: ["THE DECK", "SHELTERS ALL"], pattern: "diagonal" },
};
/** Each poster defaced: the mark sprayed over it (3 the Claw, 1 the Upturned), where and how turned, the corner torn away. */
export const DEFACED = {
  1: { poster: 1, mark: 3, at: [62, 96], rot: -9, s: 0.5, corner: "tr" },
  2: { poster: 2, mark: 1, at: [66, 72], rot: 6, s: 0.46, corner: "bl" },
  3: { poster: 3, mark: 3, at: [60, 88], rot: -4, s: 0.52, corner: "tl" },
  4: { poster: 4, mark: 1, at: [70, 108], rot: 9, s: 0.44, corner: "br" },
  5: { poster: 5, mark: 3, at: [64, 76], rot: -13, s: 0.5, corner: "tr" },
  6: { poster: 6, mark: 1, at: [58, 100], rot: 4, s: 0.5, corner: "bl" },
};
/** A corner of a w x h sheet torn away: `{ line, poly }`, the ragged tear from one edge to the other (hash of `seed`). */
export function tornCorner(corner, seed, w = 128, h = 192) {
  const along = 30 + 16 * hash01(seed, 1);
  const down = 38 + 26 * hash01(seed, 2);
  const [cx, cy] = [corner.includes("r") ? w : 0, corner.includes("b") ? h : 0];
  const sx = cx ? -1 : 1;
  const sy = cy ? -1 : 1;
  const a = [cx + sx * along, cy];
  const b = [cx, cy + sy * down];
  const line = [a];
  for (let k = 1; k < 9; k++) {
    const t = k / 9;
    const p = lerp(a, b, t);
    const bulge = Math.sin(t * Math.PI) * 8 + (hash01(seed, k, 3) - 0.5) * 7;
    line.push([p[0] + sx * bulge, p[1] + sy * bulge]);
  }
  line.push(b);
  const out = ([x, y]) => [x + (x === 0 ? -2 : x === w ? 2 : 0), y + (y === 0 ? -2 : y === h ? 2 : 0)];
  return { line, poly: [out([cx, cy]), out(a), ...line.slice(1, -1), out(b)] };
}
/**
 * A defaced poster: the poster, the Insurgents' mark sprayed over it, a corner torn away with the paper's light
 * fibrous edge along the tear. `torn` is the hole, for the tool to fill with the wall's photo. `{ design, torn }`.
 */
export function defacedDesign(id, emblems, paint) {
  const d = DEFACED[id];
  if (!d) throw new Error(`defaced poster ${id} is not one of ${Object.keys(DEFACED).join(", ")}`);
  const P = POSTERS[d.poster];
  const poster = posterDesign(emblems[P.emblem], P.lines, P);
  const { line, poly } = tornCorner(d.corner, 40 + Number(id));
  const mark = insurgentMark(d.mark, Number(id));
  const sprayed = placeDesign(
    { items: placeDesign(mark, { dx: -128, dy: -128 }) },
    { s: d.s, rot: d.rot, dx: d.at[0], dy: d.at[1] },
  );
  return {
    design: {
      size: [128, 192],
      items: [
        ...poster.items,
        ...sprayed.map((it) => ({ ...it, colour: paint })),
        { role: "wall", polys: [poly], colour: "#56524c" },
        { role: "edge", polys: strokeOf(line, 2.4), colour: "#ece4cf" },
      ],
    },
    torn: [poly],
  };
}
/** The plaque's two lines (a base for the building plaques: their own words go here). */
export const PLAQUE_LINES = ["MINISTRY", "OF ORDER"];
export { bbox };
