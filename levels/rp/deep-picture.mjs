// The walking graph of the sewers on several levels drawn on each level's plan, to look at: the halls and tunnels (air) in
// grey, the pool basins and water channels in blue, the columns and ladder slabs in dark, the nodes (dots) and the links
// (lines: walk green, stair orange, ladder magenta), the places and roaming spots ringed. North is up.
//
//   deepGraphPng(deep, paths, levelId, path?)  -> the PNG's bytes (written to `path` when given)
import { writeFileSync } from "node:fs";
import { png } from "../../src/image.mjs";
import { textMask } from "../../src/render.mjs";
import { at, columnsOf, ledgesOf } from "../assembly/below-levels.mjs";

const SCALE = 0.5; // pixels to a unit
const MARGIN = 40;
const TOP = 30;

export function deepGraphPng(deep, paths, levelId, path = null) {
  const level = deep.levels.find((l) => l.id === levelId);
  const all = [...deep.halls.flatMap((h) => h.poly), ...deep.chains.flatMap((c) => c.pts.map((p) => [p.x, p.y]))];
  const x0 = Math.min(...all.map((p) => p[0])) - 64;
  const x1 = Math.max(...all.map((p) => p[0])) + 64;
  const y0 = Math.min(...all.map((p) => p[1])) - 64;
  const y1 = Math.max(...all.map((p) => p[1])) + 64;
  const W = Math.ceil((x1 - x0) * SCALE) + MARGIN * 2;
  const H = Math.ceil((y1 - y0) * SCALE) + MARGIN * 2 + TOP;
  const rgba = new Uint8Array(W * H * 4).fill(255);
  const px = (x) => MARGIN + (x - x0) * SCALE;
  const py = (y) => TOP + MARGIN + (y1 - y) * SCALE;
  const dot = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    rgba.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
  };
  const fill = (poly, c) => {
    const ys = poly.map((p) => py(p[1]));
    const xs = poly.map((p) => px(p[0]));
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        // convex, either winding
        const sgn = poly.map((a, i) => {
          const b = poly[(i + 1) % poly.length];
          return (px(b[0]) - px(a[0])) * (y - py(a[1])) - (py(b[1]) - py(a[1])) * (x - px(a[0]));
        });
        if (sgn.every((v) => v >= 0) || sgn.every((v) => v <= 0)) dot(x, y, c);
      }
  };
  const line = (a, b, c, thick = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(px(b[0]) - px(a[0]), py(b[1]) - py(a[1]))));
    for (let i = 0; i <= n; i++) {
      const x = px(a[0] + ((b[0] - a[0]) * i) / n);
      const y = py(a[1] + ((b[1] - a[1]) * i) / n);
      for (let dx = 0; dx < thick; dx++) for (let dy = 0; dy < thick; dy++) dot(x + dx, y + dy, c);
    }
  };
  const disc = (p, r, c) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) dot(px(p[0]) + dx, py(p[1]) + dy, c);
  };
  const ring = (p, r, c) => {
    for (let k = 0; k < 40; k++) dot(px(p[0]) + Math.cos((k * Math.PI) / 20) * r, py(p[1]) + Math.sin((k * Math.PI) / 20) * r, c);
  };
  const write = (text, x, y, k = 2, c = [20, 20, 20]) => {
    const m = textMask(text, k);
    for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) if (m.at(i, j)) dot(x + i, y + j, c);
  };

  // the air of the level: halls, tunnel segments
  for (const h of deep.halls) if ((h.shaft ? h.shaft.to : h.level) === levelId || (h.shaft && h.shaft.from === levelId)) fill(h.poly, h.shaft ? [196, 170, 210] : [214, 214, 218]);
  for (const c of deep.chains) {
    if (!c.segs || c.segs.length !== c.pts.length - 1) continue;
    const here = c.level === levelId || (c.kind === "stair" && c.pts.some((p) => Math.abs(p.z - level.floor) < 8));
    if (!here) continue;
    const a = c.width / 2;
    c.segs.forEach((s, i) => {
      const quad = [at(s, c.cuts[i], -a), at(s, c.cuts[i + 1], -a), at(s, c.cuts[i + 1], a), at(s, c.cuts[i], a)];
      fill(quad, c.kind === "stair" ? [236, 214, 190] : [226, 226, 230]);
      if (c.water) {
        const sx = c.water.strip >= 1 ? a : a * c.water.strip;
        fill([at(s, c.cuts[i], -sx), at(s, c.cuts[i + 1], -sx), at(s, c.cuts[i + 1], sx), at(s, c.cuts[i], sx)], [150, 190, 240]);
      }
    });
  }
  for (const h of deep.halls) {
    if ((h.shaft ? h.shaft.to : h.level) !== levelId) continue;
    if (h.pool) {
      const xs = h.poly.map((p) => p[0]);
      const ys = h.poly.map((p) => p[1]);
      const k = h.pool.inset ?? 64;
      fill([[Math.min(...xs) + k, Math.min(...ys) + k], [Math.max(...xs) - k, Math.min(...ys) + k], [Math.max(...xs) - k, Math.max(...ys) - k], [Math.min(...xs) + k, Math.max(...ys) - k]], [150, 190, 240]);
    }
    for (const c of columnsOf(h)) disc(c.p, Math.max(2, Math.round(c.r * SCALE)), [60, 60, 70]);
    for (const l of ledgesOf(h)) fill(l.quad, [120, 90, 140]);
  }
  // walls: the air's edges
  for (const h of deep.halls) if ((h.shaft ? h.shaft.to : h.level) === levelId) h.poly.forEach((p, i) => line(p, h.poly[(i + 1) % h.poly.length], [40, 40, 50], 1));
  // the graph
  const byId = new Map(paths.nodes.map((n) => [n.id, n]));
  const draw = (n) => n.district === "below" && n.level !== undefined;
  const levelOfNode = (n) => n.level;
  for (const l of paths.links) {
    const [a, b] = [byId.get(l.a), byId.get(l.b)];
    if (!a || !b || !draw(a) || !draw(b)) continue;
    if (levelOfNode(a) !== levelId && levelOfNode(b) !== levelId) continue;
    line(a.at, b.at, l.how === "ladder" ? [200, 30, 200] : l.how === "stair" ? [235, 130, 20] : [20, 150, 60], l.how === "walk" ? 1 : 2);
  }
  for (const n of paths.nodes) {
    if (!draw(n) || levelOfNode(n) !== levelId) continue;
    disc(n.at, 2, n.kind === "place" ? [200, 20, 20] : n.kind === "ladder" || n.kind === "hatch" ? [200, 30, 200] : n.kind === "stair" ? [235, 130, 20] : [10, 70, 30]);
    if (n.roam !== undefined) ring(n.at, 6, [30, 60, 220]);
    if (n.kind === "place") ring(n.at, 8, [200, 20, 20]);
  }
  write(`${deep.levels.length > 1 ? "level" : ""} ${levelId} floor ${level.floor}   green walk, orange stair, magenta ladder, blue ring roam, red ring place`, MARGIN, 8, 2);
  const bytes = png(W, H, rgba);
  if (path) writeFileSync(path, bytes);
  return bytes;
}
