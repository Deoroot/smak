// A minimal SVG rasterizer, no dependencies: enough of SVG 1.1 for flat vector art (emblems, marks, lettering)
// drawn as filled shapes, read back to pixels for a texture.
//
//   parseSvg(text)                                   -> { tag, attrs, children } (the document's root element)
//   rasterizeSvg(text, { width, height, supersample }) -> { width, height, rgba, skipped }
//   pathPolygons(d, tolerance)                       -> [[[x, y], ...], ...] (a path's subpaths, curves flattened)
//
// Drawn: <svg> (width, height, viewBox; scaled to the asked size, aspect kept and centred as preserveAspectRatio's
// default), <g>, <path> (M L H V C S Q T Z, absolute and relative; no arcs), <rect> (no rounded corners), <circle>,
// <ellipse>, <polygon>, <use> (href to an element by id, x, y), <defs>, <mask> (luminance, user space of the masked
// element), <filter> holding one <feGaussianBlur>. Attributes: fill (#rgb, #rrggbb, rgb(), none, a few names),
// fill-opacity, fill-rule (nonzero, evenodd), opacity, transform (matrix, translate, scale, rotate, skewX, skewY),
// mask, filter, and the same in a style attribute. fill, fill-opacity and fill-rule are inherited.
// Not drawn, and named in `skipped`: strokes, text, gradients, images, arcs in a path, other filters.
// Pixels are composited in sRGB as browsers do; coverage is exact along each row's span, sampled `supersample`
// times a pixel down the rows. Everything is deterministic.

// ── the document ───────────────────────────────────────────────────────────
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
/** The element tree of an SVG document (XML subset: elements and attributes; text, comments, prolog dropped). */
export function parseSvg(text) {
  const root = { tag: "#document", attrs: {}, children: [] };
  const stack = [root];
  const re =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    const [, close, tag, attrText, self] = m;
    if (close) {
      if (stack.length < 2 || stack[stack.length - 1].tag !== tag)
        throw new Error(`</${tag}> closes nothing open`);
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[a[1]] = unescape(a[2] ?? a[3]);
    const el = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].tag}> is never closed`);
  const svg = root.children.find((c) => c.tag === "svg");
  if (!svg) throw new Error("the document has no <svg> element");
  return svg;
}

// ── numbers, colours, transforms ───────────────────────────────────────────
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const numbers = (s) => (String(s ?? "").match(NUMBER) ?? []).map(Number);
const NAMED = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  blue: [0, 0, 255],
  transparent: null,
};
/** A paint as [r, g, b] 0..255, or null for none. */
export function colourOf(v) {
  const s = String(v).trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  if (s in NAMED) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgb\(([^)]*)\)$/.exec(s);
  if (m)
    return numbers(m[1])
      .slice(0, 3)
      .map((n) => Math.max(0, Math.min(255, Math.round(n))));
  throw new Error(`fill ${v} is not a colour this rasterizer reads`);
}
const IDENTITY = [1, 0, 0, 1, 0, 0];
/** a·b as SVG matrices [a b c d e f] (b applied first). */
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
/** A transform attribute as one matrix. */
export function transformOf(text) {
  let m = IDENTITY;
  for (const [, fn, args] of String(text ?? "").matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g,
  )) {
    const n = numbers(args);
    let t;
    if (fn === "matrix") t = n.slice(0, 6);
    else if (fn === "translate") t = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (fn === "scale") t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const a = ((n[0] ?? 0) * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      t = [c, s, -s, c, 0, 0];
      if (n.length >= 3) t = multiply(multiply([1, 0, 0, 1, n[1], n[2]], t), [1, 0, 0, 1, -n[1], -n[2]]);
    } else if (fn === "skewX") t = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else t = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ── paths ──────────────────────────────────────────────────────────────────
/** A path's `d` as subpaths of points, curves cut into straight runs no further than `tolerance` from them. */
export function pathPolygons(d, tolerance = 0.25) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqTtZzAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = null;
  let lastCtrl = null; // the last curve's second control point, for S and T
  let i = 0;
  const num = () => {
    if (i >= tokens.length || /[a-z]/i.test(tokens[i]))
      throw new Error(`the path's ${cmd} wants more numbers`);
    return Number(tokens[i++]);
  };
  const start = (px, py) => {
    cur = [[px, py]];
    out.push(cur);
    sx = px;
    sy = py;
  };
  const line = (px, py) => {
    if (!cur) start(x, y);
    cur.push([px, py]);
  };
  const steps = (len) => Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tolerance))));
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2));
    const [x0, y0] = [x, y];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      line(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
  };
  const quad = (x1, y1, x2, y2) => {
    const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1));
    const [x0, y0] = [x, y];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      line(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
  };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error("the path does not start with a command");
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": {
        x = ox + num();
        y = oy + num();
        start(x, y);
        cmd = rel ? "l" : "L"; // further pairs are lines
        lastCtrl = null;
        break;
      }
      case "L":
        x = ox + num();
        y = oy + num();
        line(x, y);
        lastCtrl = null;
        break;
      case "H":
        x = ox + num();
        line(x, y);
        lastCtrl = null;
        break;
      case "V":
        y = oy + num();
        line(x, y);
        lastCtrl = null;
        break;
      case "C": {
        const p = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
        cubic(...p);
        [x, y] = [p[4], p[5]];
        lastCtrl = ["C", p[2], p[3]];
        break;
      }
      case "S": {
        const r = lastCtrl?.[0] === "C" ? [2 * x - lastCtrl[1], 2 * y - lastCtrl[2]] : [x, y];
        const p = [ox + num(), oy + num(), ox + num(), oy + num()];
        cubic(r[0], r[1], ...p);
        [x, y] = [p[2], p[3]];
        lastCtrl = ["C", p[0], p[1]];
        break;
      }
      case "Q": {
        const p = [ox + num(), oy + num(), ox + num(), oy + num()];
        quad(...p);
        [x, y] = [p[2], p[3]];
        lastCtrl = ["Q", p[0], p[1]];
        break;
      }
      case "T": {
        const r = lastCtrl?.[0] === "Q" ? [2 * x - lastCtrl[1], 2 * y - lastCtrl[2]] : [x, y];
        const p = [ox + num(), oy + num()];
        quad(r[0], r[1], ...p);
        [x, y] = p;
        lastCtrl = ["Q", r[0], r[1]];
        break;
      }
      case "Z":
        if (cur) {
          x = sx;
          y = sy;
          cur = null; // the next drawing command starts a new subpath at the start point
        }
        lastCtrl = null;
        break;
      case "A":
        throw new Error("arcs (A) in a path are not drawn by this rasterizer: flatten them first");
    }
  }
  return out.filter((p) => p.length >= 3);
}

// ── coverage and compositing ───────────────────────────────────────────────
/** A layer: premultiplied rgba as floats 0..1. */
const layer = (w, h) => new Float32Array(w * h * 4);
/**
 * Fills polygons (device pixels) into `dst` with `rgb` 0..1 and `alpha`: coverage exact along each sub-row's span,
 * `ss` sub-rows a pixel.
 */
function fillPolygons(dst, w, h, polys, rule, rgb, alpha, ss) {
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polys)
    for (let k = 0; k < p.length; k++) {
      const [x0, y0] = p[k];
      const [x1, y1] = p[(k + 1) % p.length];
      if (y0 === y1) continue;
      const dir = y1 > y0 ? 1 : -1;
      const [ax, ay, bx, by] = dir > 0 ? [x0, y0, x1, y1] : [x1, y1, x0, y0];
      edges.push({ ay, by, ax, slope: (bx - ax) / (by - ay), dir });
      minY = Math.min(minY, ay);
      maxY = Math.max(maxY, by);
    }
  if (!edges.length) return;
  edges.sort((a, b) => a.ay - b.ay);
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h, Math.ceil(maxY));
  const row = new Float32Array(w + 1);
  const evenodd = rule === "evenodd";
  let next = 0;
  let active = [];
  const xs = [];
  for (let py = y0; py < y1; py++) {
    row.fill(0);
    let touched = false;
    for (let s = 0; s < ss; s++) {
      const sy = py + (s + 0.5) / ss;
      while (next < edges.length && edges[next].ay <= sy) active.push(edges[next++]);
      active = active.filter((e) => e.by > sy);
      xs.length = 0;
      for (const e of active) if (e.ay <= sy) xs.push([e.ax + (sy - e.ay) * e.slope, e.dir]);
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        const inside = evenodd ? wind % 2 !== 0 : wind !== 0;
        if (!inside) continue;
        const xa = Math.max(0, xs[k][0]);
        const xb = Math.min(w, xs[k + 1][0]);
        if (xb <= xa) continue;
        touched = true;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        const f = 1 / ss;
        if (ia === ib) row[ia] += (xb - xa) * f;
        else {
          row[ia] += (ia + 1 - xa) * f;
          for (let q = ia + 1; q < ib; q++) row[q] += f;
          if (ib < w) row[ib] += (xb - ib) * f;
        }
      }
    }
    if (!touched) continue;
    for (let px = 0; px < w; px++) {
      const c = Math.min(1, row[px]) * alpha;
      if (c <= 0) continue;
      const o = (py * w + px) * 4;
      const keep = 1 - c;
      dst[o] = rgb[0] * c + dst[o] * keep;
      dst[o + 1] = rgb[1] * c + dst[o + 1] * keep;
      dst[o + 2] = rgb[2] * c + dst[o + 2] * keep;
      dst[o + 3] = c + dst[o + 3] * keep;
    }
  }
}
/** src over dst, src scaled by `alpha` (both premultiplied). */
function composite(dst, src, alpha = 1) {
  for (let o = 0; o < dst.length; o += 4) {
    const a = src[o + 3] * alpha;
    if (a <= 0) continue;
    const keep = 1 - a;
    for (let c = 0; c < 3; c++) dst[o + c] = src[o + c] * alpha + dst[o + c] * keep;
    dst[o + 3] = a + dst[o + 3] * keep;
  }
}
/** A Gaussian blur of `sigma` pixels, as three box blurs each way (all four channels: premultiplied). */
function blur(buf, w, h, sigma) {
  if (!(sigma > 0.2)) return;
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  const tmp = new Float32Array(buf.length);
  const pass = (src, dst, horizontal) => {
    const [n, lines] = horizontal ? [w, h] : [h, w];
    for (let l = 0; l < lines; l++)
      for (let c = 0; c < 4; c++) {
        const at = (k) => (horizontal ? (l * w + k) * 4 + c : (k * w + l) * 4 + c);
        let sum = 0;
        for (let k = -r; k <= r; k++) if (k >= 0 && k < n) sum += src[at(k)];
        for (let k = 0; k < n; k++) {
          dst[at(k)] = sum / (2 * r + 1);
          const add = k + r + 1;
          const drop = k - r;
          if (add < n) sum += src[at(add)];
          if (drop >= 0) sum -= src[at(drop)];
        }
      }
  };
  for (let k = 0; k < 3; k++) {
    pass(buf, tmp, true);
    pass(tmp, buf, false);
  }
}

// ── drawing the tree ───────────────────────────────────────────────────────
const INHERITED = ["fill", "fill-opacity", "fill-rule"];
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon"]);
const QUIET = new Set(["title", "desc", "metadata", "defs", "mask", "filter", "style"]);
/** An element's attributes with its style's declarations over them. */
function attrsOf(el) {
  const a = { ...el.attrs };
  for (const decl of String(el.attrs.style ?? "").split(";")) {
    const [k, v] = decl.split(":").map((s) => s?.trim());
    if (k && v) a[k] = v;
  }
  return a;
}
function shapePolygons(tag, a, tolerance) {
  const n = (k, d = 0) => (a[k] === undefined ? d : Number.parseFloat(a[k]));
  if (tag === "path") return pathPolygons(a.d ?? "", tolerance);
  if (tag === "rect") {
    const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
    return w > 0 && h > 0
      ? [
          [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ],
        ]
      : [];
  }
  if (tag === "polygon") {
    const v = numbers(a.points);
    const pts = [];
    for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    return pts.length >= 3 ? [pts] : [];
  }
  const [cx, cy] = [n("cx"), n("cy")];
  const [rx, ry] = tag === "circle" ? [n("r"), n("r")] : [n("rx"), n("ry")];
  if (!(rx > 0 && ry > 0)) return [];
  const k = Math.max(12, Math.min(256, Math.ceil(2 * Math.PI * Math.sqrt(Math.max(rx, ry) / tolerance))));
  return [
    Array.from({ length: k }, (_, i) => [
      cx + rx * Math.cos((2 * Math.PI * i) / k),
      cy + ry * Math.sin((2 * Math.PI * i) / k),
    ]),
  ];
}
/**
 * The SVG drawn to `width` x `height` pixels (default: its own width and height): `{ width, height, rgba, skipped }`,
 * rgba straight (not premultiplied) 0..255, `skipped` the things in it this rasterizer does not draw, in words.
 */
export function rasterizeSvg(text, { width, height, supersample = 4 } = {}) {
  const svg = parseSvg(text);
  const ids = new Map();
  const index = (el) => {
    if (el.attrs.id) ids.set(el.attrs.id, el);
    el.children.forEach(index);
  };
  index(svg);
  const vb = numbers(svg.attrs.viewBox);
  const [vx, vy, vw, vh] =
    vb.length === 4 ? vb : [0, 0, Number.parseFloat(svg.attrs.width), Number.parseFloat(svg.attrs.height)];
  if (!(vw > 0 && vh > 0)) throw new Error("the <svg> has neither a viewBox nor a width and height");
  const W = Math.round(width ?? Number.parseFloat(svg.attrs.width ?? vw));
  const H = Math.round(height ?? Number.parseFloat(svg.attrs.height ?? vh));
  const k = Math.min(W / vw, H / vh);
  const root = [k, 0, 0, k, (W - vw * k) / 2 - vx * k, (H - vh * k) / 2 - vy * k];
  const skipped = new Set();
  const ss = Math.max(1, Math.round(supersample));
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

  const refOf = (v) => /url\(\s*#([^)\s]+)\s*\)/.exec(String(v ?? ""))?.[1];
  const draw = (el, dst, ctm, inherited, depth) => {
    if (depth > 64) throw new Error("the SVG nests deeper than 64 (a <use> loop?)");
    const a = attrsOf(el);
    const tag = el.tag.replace(/^svg:/, "");
    if (QUIET.has(tag)) return;
    const style = { ...inherited };
    for (const p of INHERITED) if (a[p] !== undefined && a[p] !== "inherit") style[p] = a[p];
    if (a.stroke && a.stroke !== "none") skipped.add(`stroke on <${tag}>`);
    let m = multiply(ctm, transformOf(a.transform));
    const opacity = a.opacity === undefined ? 1 : Number.parseFloat(a.opacity);
    const maskId = refOf(a.mask);
    const filterId = refOf(a.filter);
    let filterSigma = 0;
    if (filterId) {
      const f = ids.get(filterId);
      const fx = f?.children ?? [];
      if (!f || fx.length !== 1 || fx[0].tag !== "feGaussianBlur")
        skipped.add(`filter #${filterId} (only one feGaussianBlur is drawn)`);
      else filterSigma = numbers(fx[0].attrs.stdDeviation)[0] * scaleOf(m);
    }
    const own = maskId || filterSigma || opacity < 1;
    const target = own ? layer(W, H) : dst;
    if (tag === "svg" || tag === "g" || tag === "a")
      for (const c of el.children) draw(c, target, m, style, depth + 1);
    else if (tag === "use") {
      const ref = ids.get(String(a.href ?? a["xlink:href"] ?? "").replace(/^#/, ""));
      if (!ref) skipped.add(`<use> of a missing element ${a.href ?? a["xlink:href"]}`);
      else
        draw(
          ref,
          target,
          multiply(m, [1, 0, 0, 1, Number.parseFloat(a.x ?? 0), Number.parseFloat(a.y ?? 0)]),
          style,
          depth + 1,
        );
    } else if (SHAPES.has(tag)) {
      const fill = colourOf(style.fill ?? "black");
      if (fill) {
        const polys = shapePolygons(tag, a, 0.25 / Math.max(1e-6, scaleOf(m) * ss)).map((p) =>
          p.map((q) => apply(m, q)),
        );
        const fo = style["fill-opacity"] === undefined ? 1 : Number.parseFloat(style["fill-opacity"]);
        fillPolygons(
          target,
          W,
          H,
          polys,
          style["fill-rule"],
          fill.map((v) => v / 255),
          fo,
          ss,
        );
      }
    } else skipped.add(`<${tag}>`);
    if (!own) return;
    if (filterSigma) blur(target, W, H, filterSigma);
    if (maskId) {
      const mk = ids.get(maskId);
      if (!mk || mk.tag !== "mask") skipped.add(`mask #${maskId} (missing)`);
      else {
        const ml = layer(W, H);
        for (const c of mk.children) draw(c, ml, m, {}, depth + 1);
        for (let o = 0; o < target.length; o += 4) {
          const lum = 0.2125 * ml[o] + 0.7154 * ml[o + 1] + 0.0721 * ml[o + 2]; // premultiplied: luminance x alpha
          for (let c = 0; c < 4; c++) target[o + c] *= lum;
        }
      }
    }
    composite(dst, target, opacity);
  };
  const out = layer(W, H);
  draw(svg, out, root, {}, 0);
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const al = out[i * 4 + 3];
    for (let c = 0; c < 3; c++)
      rgba[i * 4 + c] = al > 1e-6 ? Math.round(Math.min(1, out[i * 4 + c] / al) * 255) : 0;
    rgba[i * 4 + 3] = Math.round(Math.min(1, al) * 255);
  }
  return { width: W, height: H, rgba, skipped: [...skipped] };
}
