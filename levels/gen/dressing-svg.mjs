// Stage 8's pictures: each building's storeys (05's plan, levels/gen/plan-svg.mjs) with its props drawn over them
// (a box a prop, its front edge thick, its use strip dashed) and the keep-clear volumes faint (door swings and
// approaches red, windows' fronts blue, stairs grey, switch and light spots violet); and each layer's streets in
// the tile: the public floor, carriageways and walking lanes, the zones kept clear, the props.
import { buildingSvg } from "./plan-svg.mjs";
import { CATALOGUE, footOf, storeyBoxes, spotsOf, fittingsOf, streetWorld, streetZones, streetSigns, streetEntries } from "./dressing.mjs"; // prettier-ignore

const f1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FILL = { brush: "#8a6a4a", model: "#4a6a8a" };
const STREET_FILL = { "lamp-post": "#e0b000", "street-bench": "#8a6a4a", bin: "#555", "market-stall": "#c0603a", "planter-large": "#3a8a3a", crate: "#a07040", "crate-stack": "#805020", barrel: "#6a4a2a", rubble: "#777", "trash-scatter": "#9a9a6a" }; // prettier-ignore

/** One building's storeys with its props: the SVG text. */
export function dressedBuildingSvg(b, artifact, { rules, inputs, scale = 16, zones = null, keepClear = true } = {}) {
  const base = buildingSvg(b, { scale, zones });
  const [, D] = b.frame.size_m;
  const pad = 30;
  const gap = 40;
  const head = 46;
  const pw = b.frame.size_m[0] * scale;
  const fit = fittingsOf(inputs);
  const net = inputs["04-network.json"];
  const lifts = new Map(net.connectors.filter((c) => c.type === "lift").map((c) => [c.id, { id: c.id, car: c.dims.car_m ?? [2.4, 2.4, 3] }]));
  const liftOf = (g) => g.split("+").map((id) => lifts.get(id)).find(Boolean) ?? null;
  const { spots } = spotsOf(b, fit, rules, inputs["01-site.json"].grid.cell);
  const g = [];
  b.storeys.forEach((st, s) => {
    const ox = pad + s * (pw + gap);
    const oy = head + pad;
    const X = (x) => f1(ox + x * scale);
    const Y = (y) => f1(oy + (D - y) * scale);
    const rect = (f, attrs) => `<rect x="${X(f[0])}" y="${Y(f[3])}" width="${f1((f[2] - f[0]) * scale)}" height="${f1((f[3] - f[1]) * scale)}" ${attrs}/>`;
    if (keepClear)
      for (const bx of storeyBoxes(b, st.storey, rules, { liftOf, reserved: spots.get(st.storey) ?? [] })) {
        if (bx.hole) continue;
        const w = bx.what;
        const col = /swing/.test(w) ? "#e04040" : /approach/.test(w) && /door|opening/.test(w) ? "#f08080" : /window/.test(w) ? "#4080e0" : /stair|landing|flight/.test(w) ? "#808080" : /lift/.test(w) ? "#e08000" : "#9040c0"; // prettier-ignore
        // a window's front only matters for a tall prop: drawn faint
        g.push(rect([bx.min[0], bx.min[1], bx.max[0], bx.max[1]], `fill="${col}" fill-opacity="${/window/.test(w) ? 0.12 : 0.14}" stroke="${col}" stroke-opacity="0.5" stroke-width="0.5"`)); // prettier-ignore
      }
    for (const p of artifact.props) {
      if (p.place !== "room" || p.building !== b.id || p.storey !== st.storey) continue;
      const f = footOf(p.at_m, p.size_m);
      const c = CATALOGUE[p.kind];
      if (p.use) {
        const [fx, fy] = p.facing;
        const d = p.use.depth;
        const strip = fx === 1 ? [f[2], f[1], f[2] + d, f[3]] : fx === -1 ? [f[0] - d, f[1], f[0], f[3]] : fy === 1 ? [f[0], f[3], f[2], f[3] + d] : [f[0], f[1] - d, f[2], f[1]]; // prettier-ignore
        g.push(rect(strip, `fill="none" stroke="#2a8a2a" stroke-width="0.6" stroke-dasharray="2 2"`));
      }
      g.push(rect(f, `fill="${FILL[c?.build] ?? "#888"}" fill-opacity="${p.collision ? 0.85 : 0.35}" stroke="#222" stroke-width="0.6"`));
      // the front edge
      const [fx, fy] = p.facing;
      const e = fx === 1 ? [f[2], f[1], f[2], f[3]] : fx === -1 ? [f[0], f[1], f[0], f[3]] : fy === 1 ? [f[0], f[3], f[2], f[3]] : [f[0], f[1], f[2], f[1]];
      g.push(`<line x1="${X(e[0])}" y1="${Y(e[1])}" x2="${X(e[2])}" y2="${Y(e[3])}" stroke="#ffd040" stroke-width="2"/>`);
      const short = p.kind.replace(/-(single|double)$/, "").slice(0, 10);
      const fs = Math.max(5, Math.min(8, Math.min(f[2] - f[0], f[3] - f[1]) * scale * 0.45));
      g.push(`<text x="${f1((X(f[0]) + X(f[2])) / 2)}" y="${f1((Y(f[1]) + Y(f[3])) / 2 + fs / 3)}" font-size="${f1(fs)}" text-anchor="middle" fill="#fff">${esc(short)}</text>`); // prettier-ignore
    }
  });
  const legend = `<g font-size="10" transform="translate(${pad}, ${f1(head + pad + D * scale + 14)})"><rect width="10" height="8" fill="#8a6a4a"/><text x="14" y="8">brush prop</text><rect x="80" width="10" height="8" fill="#4a6a8a"/><text x="94" y="8">model prop</text><line x1="160" y1="4" x2="172" y2="4" stroke="#ffd040" stroke-width="2"/><text x="176" y="8">front</text><rect x="215" width="10" height="8" fill="none" stroke="#2a8a2a" stroke-dasharray="2 2"/><text x="229" y="8">use strip</text><rect x="290" width="10" height="8" fill="#e04040" fill-opacity="0.3"/><text x="304" y="8">door swing / approach</text><rect x="420" width="10" height="8" fill="#4080e0" fill-opacity="0.3"/><text x="434" y="8">window front (sill-head)</text><rect x="560" width="10" height="8" fill="#808080" fill-opacity="0.3"/><text x="574" y="8">stair</text><rect x="610" width="10" height="8" fill="#9040c0" fill-opacity="0.3"/><text x="624" y="8">switch / light / 07 switch</text></g>`; // prettier-ignore
  const out = base.replace(/<\/svg>\s*$/, `<g>${g.join("")}</g>${legend}</svg>`);
  // room for the legend
  return out.replace(/height="([\d.]+)" viewBox="0 0 ([\d.]+) ([\d.]+)"/, (m0, h, w, h2) => `height="${f1(+h + 24)}" viewBox="0 0 ${w} ${f1(+h2 + 24)}"`);
}

/** One layer's streets in the tile: the SVG text. `px` pixels a metre. */
export function streetSvg(layer, artifact, { desc, rules, inputs, px = 6 } = {}) {
  const site = inputs["01-site.json"];
  const W = streetWorld({ desc, inputs, layer });
  const fit = fittingsOf(inputs);
  const signs = streetSigns(inputs, layer, rules);
  const Z = streetZones({ desc, rules, inputs, layer, W, fit, signs });
  const ent = streetEntries({ inputs, layer, W });
  const cell = site.grid.cell;
  const tb = site.tile.box.map((v) => v * cell);
  const Wd = (tb[2] - tb[0]) * px;
  const Hd = (tb[3] - tb[1]) * px;
  const X = (x) => f1((x - tb[0]) * px);
  const Y = (y) => f1((tb[3] - y) * px);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${f1(Wd)}" height="${f1(Hd + 40)}" viewBox="0 0 ${f1(Wd)} ${f1(Hd + 40)}" font-family="Segoe UI, Arial, sans-serif"><rect width="100%" height="100%" fill="#3a3a3a"/>`]; // prettier-ignore
  // the floor, run by run per row (at a coarser step for size)
  const g = W.grid;
  const step = 2;
  for (let j = 0; j < g.ny; j += step) {
    let i0 = null;
    for (let i = 0; i <= g.nx; i += step) {
      const on = i < g.nx && g.floor[j * g.nx + i];
      if (on && i0 === null) i0 = i;
      if (!on && i0 !== null) {
        const x0 = g.x0 + i0 * 0.2032;
        const x1 = g.x0 + i * 0.2032;
        const y0 = g.y0 + j * 0.2032;
        parts.push(`<rect x="${X(x0)}" y="${Y(y0 + step * 0.2032)}" width="${f1((x1 - x0) * px)}" height="${f1(step * 0.2032 * px + 0.3)}" fill="#e8e2d4"/>`); // prettier-ignore
        i0 = null;
      }
    }
  }
  const poly = (pts, attrs) => `<polygon points="${pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ")}" ${attrs}/>`;
  const ZC = { carriageway: "#9a9a9a", lane: "#b8d0e8", mouth: "#d0b8e8", portal: "#e8b8d0", exit: "#e8d070", gate: "#e07070" };
  for (const z of Z.zones) parts.push(poly(z.poly, `fill="${ZC[z.kind] ?? "#ccc"}" fill-opacity="${z.kind === "carriageway" ? 0.9 : 0.55}" stroke="none"`));
  for (const bx of Z.boxes) {
    const col = /spawn/.test(bx.what) ? "#40c040" : /sign/.test(bx.what) ? "#c040c0" : /light/.test(bx.what) ? "#e0c000" : "#e04040";
    parts.push(`<rect x="${X(bx.min[0])}" y="${Y(bx.max[1])}" width="${f1((bx.max[0] - bx.min[0]) * px)}" height="${f1((bx.max[1] - bx.min[1]) * px)}" fill="${col}" fill-opacity="0.3" stroke="${col}" stroke-width="0.6"/>`); // prettier-ignore
  }
  for (const s of W.solidsBoxes) parts.push(`<rect x="${X(s.box[0])}" y="${Y(s.box[3])}" width="${f1((s.box[2] - s.box[0]) * px)}" height="${f1((s.box[3] - s.box[1]) * px)}" fill="#6a6a6a" fill-opacity="0.5" stroke="#222" stroke-width="0.5"/>`); // prettier-ignore
  for (const p of artifact.props) {
    if (p.place !== "street" || p.layer !== layer) continue;
    const f = footOf(p.at_m ?? [p.at[0] * cell, p.at[1] * cell], p.size_m);
    parts.push(`<rect x="${X(f[0])}" y="${Y(f[3])}" width="${f1((f[2] - f[0]) * px)}" height="${f1((f[3] - f[1]) * px)}" fill="${STREET_FILL[p.kind] ?? "#888"}" fill-opacity="${p.collision ? 1 : 0.5}" stroke="#111" stroke-width="0.6"/>`); // prettier-ignore
  }
  for (const e of ent) parts.push(`<circle cx="${X(e.p[0])}" cy="${Y(e.p[1])}" r="3" fill="#00a0ff" stroke="#fff" stroke-width="0.8"/>`);
  const keys = [["carriageway", ZC.carriageway], ["walking lane", ZC.lane], ["mouth", ZC.mouth], ["portal", ZC.portal], ["exit approach", ZC.exit], ["gate", ZC.gate], ["door approach/swing", "#e04040"], ["spawn", "#40c040"], ["sign", "#c040c0"], ["lamp", "#e0b000"], ["stall", "#c0603a"], ["bench", "#8a6a4a"], ["walk entry", "#00a0ff"]]; // prettier-ignore
  parts.push(`<g font-size="11" fill="#fff" transform="translate(6, ${f1(Hd + 14)})">${keys.map(([k, c], i) => `<rect x="${i * 92}" y="-9" width="10" height="10" fill="${c}"/><text x="${i * 92 + 14}" y="0">${esc(k)}</text>`).join("")}<text x="0" y="20">${esc(`${layer} in ${site.tile.id}: ${artifact.props.filter((p) => p.place === "street" && p.layer === layer).length} street props`)}</text></g>`); // prettier-ignore
  parts.push("</svg>");
  return parts.join("\n");
}
