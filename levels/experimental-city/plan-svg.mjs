// Floor plans drawn: one SVG a building, its storeys side by side, north up. Rooms filled by zone and labelled,
// walls at their thickness, doors as a gap with the leaf's quarter circle (openings dashed), windows, stair flights
// with their treads and the way up, courts and terraces hatched, the street side marked.

const ZONE_FILL = { public: "#f6e3b4", staff: "#d9e4f0", home: "#e3efd6", private: "#f3d6d6", secure: "#cfc6e0", circulation: "#eeeeee", outdoor: "#cfe8c4" }; // prettier-ignore
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const f1 = (v) => Math.round(v * 10) / 10;

/** The SVG pictures of a plans artifact: [{ file, svg }]. `zones`: room kind -> zone (from the rulebook). */
export function planSvgs(plansDoc, { scale = 14, zones = null } = {}) {
  const out = [];
  for (const b of plansDoc.buildings) out.push({ file: `${b.id}.svg`, svg: buildingSvg(b, { scale, zones }) });
  return out;
}

export function buildingSvg(b, { scale = 14, zones = null } = {}) {
  const [W, D] = b.frame.size_m;
  const pad = 30;
  const gap = 40;
  const head = 46;
  const n = b.storeys.length;
  const pw = W * scale;
  const ph = D * scale;
  const width = pad * 2 + n * pw + (n - 1) * gap;
  const height = head + pad * 2 + ph + 20;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f1(width)}" height="${f1(height)}" viewBox="0 0 ${f1(width)} ${f1(height)}" font-family="Segoe UI, Arial, sans-serif">`); // prettier-ignore
  parts.push(`<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#9ab" stroke-width="1.5"/></pattern></defs>`); // prettier-ignore
  parts.push(`<rect width="100%" height="100%" fill="#fff"/>`);
  parts.push(`<text x="${pad}" y="22" font-size="16" font-weight="600">${esc(b.id)} (${esc(b.type)}, ${esc(b.variant)})</text>`);
  parts.push(`<text x="${pad}" y="40" font-size="11" fill="#555">${b.rooms.length} rooms, ${b.doors.length} doors, ${b.windows.length} windows, ${b.stairs.length} flights pairs; ${W.toFixed(1)} x ${D.toFixed(1)} m; street on the ${b.frame.front}</text>`); // prettier-ignore
  for (let s = 0; s < n; s++) {
    const ox = pad + s * (pw + gap);
    const oy = head + pad;
    const X = (x) => f1(ox + x * scale);
    const Y = (y) => f1(oy + (D - y) * scale); // north up
    const g = [];
    g.push(`<text x="${X(0)}" y="${f1(oy - 8)}" font-size="12" font-weight="600">storey ${s}</text>`);
    // lot and its exterior band
    g.push(`<rect x="${X(0)}" y="${Y(D)}" width="${f1(W * scale)}" height="${f1(D * scale)}" fill="none" stroke="#bbb" stroke-dasharray="4 3"/>`);
    // street marker
    const fr = b.frame.front;
    const sm = 10;
    if (fr === "s") g.push(`<line x1="${X(0)}" y1="${f1(Y(0) + sm)}" x2="${X(W)}" y2="${f1(Y(0) + sm)}" stroke="#c84" stroke-width="3"/>`);
    if (fr === "n") g.push(`<line x1="${X(0)}" y1="${f1(Y(D) - sm)}" x2="${X(W)}" y2="${f1(Y(D) - sm)}" stroke="#c84" stroke-width="3"/>`);
    if (fr === "w") g.push(`<line x1="${f1(X(0) - sm)}" y1="${Y(0)}" x2="${f1(X(0) - sm)}" y2="${Y(D)}" stroke="#c84" stroke-width="3"/>`);
    if (fr === "e") g.push(`<line x1="${f1(X(W) + sm)}" y1="${Y(0)}" x2="${f1(X(W) + sm)}" y2="${Y(D)}" stroke="#c84" stroke-width="3"/>`);
    // voids
    for (const v of b.voids.filter((x) => x.storey === s))
      for (const q of v.rects) {
        g.push(`<rect x="${X(q.x)}" y="${Y(q.y + q.d)}" width="${f1(q.w * scale)}" height="${f1(q.d * scale)}" fill="url(#hatch)" stroke="#9ab"/>`);
        g.push(`<text x="${f1(X(q.x + q.w / 2))}" y="${f1(Y(q.y + q.d / 2))}" font-size="10" text-anchor="middle" fill="#567">${esc(v.kind)}</text>`);
      }
    // rooms
    for (const r of b.rooms.filter((x) => x.storey === s)) {
      const zone = zones?.[r.kind] ?? (r.kind === "corridor" || r.kind === "stairwell" ? "circulation" : null);
      const fill = r.hidden ? "#c9b48a" : ZONE_FILL[zone] ?? "#f0f0f0";
      for (const q of r.rects) g.push(`<rect x="${X(q.x)}" y="${Y(q.y + q.d)}" width="${f1(q.w * scale)}" height="${f1(q.d * scale)}" fill="${fill}" stroke="none"/>`);
      const main = r.rects.reduce((m, q) => (q.w * q.d > m.w * m.d ? q : m), r.rects[0]);
      const cx = X(main.x + main.w / 2);
      const cy = Y(main.y + main.d / 2);
      const short = r.id.split(".").slice(-2).join(".");
      const fs = Math.max(7, Math.min(11, Math.min(main.w, main.d) * scale * 0.18));
      g.push(`<text x="${cx}" y="${f1(cy - 2)}" font-size="${f1(fs)}" text-anchor="middle" font-weight="600">${esc(r.kind)}</text>`);
      g.push(`<text x="${cx}" y="${f1(cy + fs)}" font-size="${f1(fs * 0.8)}" text-anchor="middle" fill="#555">${esc(short === r.kind ? "" : short)} ${r.area_m2}m²</text>`); // prettier-ignore
    }
    // walls
    for (const w of b.walls.filter((x) => x.storey === s)) {
      const t = w.thickness_m * scale;
      const vertical = w.a[0] === w.b[0];
      const len = vertical ? w.b[1] - w.a[1] : w.b[0] - w.a[0];
      const holes = w.holes.map((h) => [h.along_m - h.width / 2, h.along_m + h.width / 2, h.kind]).sort((p, q) => p[0] - q[0]);
      let t0 = 0;
      const spans = [];
      for (const [h0, h1, k] of holes) {
        if (k !== "door") continue;
        if (h0 > t0) spans.push([t0, h0]);
        t0 = Math.max(t0, h1);
      }
      if (len > t0) spans.push([t0, len]);
      const off = w.kind === "exterior" ? exteriorOffset(b, w) : 0;
      for (const [p0, p1] of spans) {
        if (vertical) {
          const x = w.a[0] + off;
          g.push(`<line x1="${X(x)}" y1="${Y(w.a[1] + p0)}" x2="${X(x)}" y2="${Y(w.a[1] + p1)}" stroke="#222" stroke-width="${f1(t)}" stroke-linecap="butt"/>`);
        } else {
          const y = w.a[1] + off;
          g.push(`<line x1="${X(w.a[0] + p0)}" y1="${Y(y)}" x2="${X(w.a[0] + p1)}" y2="${Y(y)}" stroke="#222" stroke-width="${f1(t)}" stroke-linecap="butt"/>`);
        }
      }
    }
    // parapets round terraces
    for (const p of (b.parapets ?? []).filter((x) => x.storey === s)) g.push(`<line x1="${X(p.a[0])}" y1="${Y(p.a[1])}" x2="${X(p.b[0])}" y2="${Y(p.b[1])}" stroke="#776" stroke-width="${f1(Math.max(2, p.thickness_m * scale))}" stroke-dasharray="6 2"/>`); // prettier-ignore
    // windows
    for (const w of b.windows.filter((x) => x.storey === s)) {
      const [fx, fy] = w.facing;
      const ux = -fy;
      const uy = fx;
      const h = w.width / 2;
      g.push(`<line x1="${X(w.at[0] - ux * h)}" y1="${Y(w.at[1] - uy * h)}" x2="${X(w.at[0] + ux * h)}" y2="${Y(w.at[1] + uy * h)}" stroke="${w.street ? "#2a7bd0" : "#7ab"}" stroke-width="3"/>`); // prettier-ignore
    }
    // doors
    for (const d of b.doors.filter((x) => x.storey === s)) {
      const [fx, fy] = d.facing;
      const ux = -fy;
      const uy = fx;
      const h = d.width / 2;
      const p0 = [d.at[0] - ux * h, d.at[1] - uy * h];
      const p1 = [d.at[0] + ux * h, d.at[1] + uy * h];
      const col = d.street ? "#c84" : d.kind === "secret" ? "#a60" : d.kind === "cell" ? "#649" : "#06c";
      if (d.swing === "none") {
        g.push(`<line x1="${X(p0[0])}" y1="${Y(p0[1])}" x2="${X(p1[0])}" y2="${Y(p1[1])}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 2"/>`);
      } else {
        const hinge = d.hinge === "low" ? p0 : p1;
        const free = d.hinge === "low" ? p1 : p0;
        const tip = [hinge[0] + fx * d.width, hinge[1] + fy * d.width];
        // the leaf open (perpendicular to the wall) and the arc its edge sweeps
        g.push(`<line x1="${X(hinge[0])}" y1="${Y(hinge[1])}" x2="${X(tip[0])}" y2="${Y(tip[1])}" stroke="${col}" stroke-width="1.8"/>`);
        const r = d.width * scale;
        const cross = (tip[0] - hinge[0]) * (free[1] - hinge[1]) - (tip[1] - hinge[1]) * (free[0] - hinge[0]);
        const sweep = cross > 0 ? 1 : 0; // y is flipped on screen
        g.push(`<path d="M ${X(tip[0])} ${Y(tip[1])} A ${f1(r)} ${f1(r)} 0 0 ${sweep} ${X(free[0])} ${Y(free[1])}" fill="none" stroke="${col}" stroke-width="0.8" stroke-dasharray="2 2"/>`); // prettier-ignore
      }
      if (d.name) g.push(`<text x="${X(d.at[0])}" y="${f1(Y(d.at[1]) - 3)}" font-size="7" text-anchor="middle" fill="${col}">${esc(d.name)}</text>`);
    }
    // stairs
    for (const st of b.stairs.filter((x) => x.storey === s)) {
      for (const f of st.flights) {
        const [fx, fy] = f.facing;
        const ux = -fy;
        const uy = fx;
        const h = f.width / 2;
        const corners = [
          [f.at[0] - ux * h, f.at[1] - uy * h],
          [f.at[0] + ux * h, f.at[1] + uy * h],
          [f.at[0] + ux * h + fx * f.run, f.at[1] + uy * h + fy * f.run],
          [f.at[0] - ux * h + fx * f.run, f.at[1] - uy * h + fy * f.run],
        ];
        g.push(`<polygon points="${corners.map((c) => `${X(c[0])},${Y(c[1])}`).join(" ")}" fill="#fff" stroke="#444" stroke-width="1"/>`);
        const treads = Math.max(1, f.risers - 1);
        for (let k = 1; k < treads; k++) {
          const t = (f.run * k) / treads;
          g.push(`<line x1="${X(corners[0][0] + fx * t)}" y1="${Y(corners[0][1] + fy * t)}" x2="${X(corners[1][0] + fx * t)}" y2="${Y(corners[1][1] + fy * t)}" stroke="#999" stroke-width="0.6"/>`); // prettier-ignore
        }
        const a0 = [f.at[0] + fx * 0.3, f.at[1] + fy * 0.3];
        const a1 = [f.at[0] + fx * (f.run - 0.3), f.at[1] + fy * (f.run - 0.3)];
        g.push(`<line x1="${X(a0[0])}" y1="${Y(a0[1])}" x2="${X(a1[0])}" y2="${Y(a1[1])}" stroke="#c00" stroke-width="1"/><circle cx="${X(a1[0])}" cy="${Y(a1[1])}" r="2" fill="#c00"/>`); // prettier-ignore
      }
    }
    parts.push(`<g>${g.join("")}</g>`);
  }
  parts.push("</svg>");
  return parts.join("\n");
}

function exteriorOffset(b, w) {
  const t = w.thickness_m;
  const room = b.rooms.find((r) => w.rooms.includes(r.id) && r.storey === w.storey);
  if (!room) return 0;
  const q = room.rects[0];
  const vertical = w.a[0] === w.b[0];
  const c = vertical ? w.a[0] : w.a[1];
  const mid = vertical ? q.x + q.w / 2 : q.y + q.d / 2;
  return mid > c ? -t / 2 : t / 2;
}
