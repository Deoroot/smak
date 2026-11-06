// Pictures of a layout (smak-layout/1, layout.mjs), one storey at a time: a character map to read in text, and a
// plan in a PNG for the person. Both are drawn from the layout alone, north up.
//
// The character map: (2 x cellsX + 1) columns by (2 x cellsY + 1) rows. Cells stand at odd places, edges between
// them, vertices at even places:
//   cells     a room's letter (lower case, given in the legend under the map), ^ stair, . void (open floor over the
//             flights), blank outside
//   edges     - | a wall (outside or inside), D door, E entrance, W window, R rail; blank: no wall
//   vertices  + where a wall ends or meets another, blank elsewhere; a doorway's middle vertex carries its mark,
//             so a door (two edges) reads DDD across, or D three times down
// The plan: the grid with each cell's coordinates on the axes, rooms tinted and named with their cell count, the
// stairwell hatched (the void cross-hatched, "UP" at the first flight's foot), walls black (outside) and grey
// (inside), doors green, the entrance red, windows blue, rails magenta. A doorway is drawn as one opening across its
// two edges, with a tick at its middle vertex.
import { writeFileSync } from "node:fs";
import { png } from "../../src/image.mjs";
import { textMask } from "../../src/render.mjs";

const isRoom = (v) => typeof v === "string" && v !== "stair" && v !== "void";
/** The doorways of a storey (doors and the entrance), each { kind, edges, at }. */
const doorwaysOf = (layout, storey) => [
  ...(layout.doors ?? []).filter((d) => d.storey === storey && d.edges).map((d) => ({ kind: "door", edges: d.edges, at: d.at })), // prettier-ignore
  ...(layout.entrances ?? (layout.entrance ? [layout.entrance] : [])).filter((en) => (en.storey ?? 0) === storey && en.edges).map((en) => ({ kind: "entrance", ...en })), // prettier-ignore
];
const keyOf = (e) => `${e.from[0]},${e.from[1]}-${e.to[0]},${e.to[1]}`;

/** One letter for each room of a storey: its first letter not yet taken, else any free letter. */
function lettersOf(layout, storey) {
  const out = new Map();
  const taken = new Set();
  for (const r of layout.rooms.filter((r) => r.storey === storey)) {
    const id = r.id.toLowerCase();
    const choice = [...id, ..."abcdefghijklmnopqrstuvwxyz"].find((c) => /[a-z]/.test(c) && !taken.has(c)) ?? "?";
    taken.add(choice);
    out.set(r.id, choice);
  }
  return out;
}

/** The character map of storey `storey`, with a title line above and a legend below. */
export function layoutText(layout, storey = 0) {
  const plan = layout.storeyPlans[storey];
  if (!plan) return `storey ${storey}: the layout has no plan of it\n`;
  const [w, h] = layout.size;
  const letters = lettersOf(layout, storey);
  const rows = Array.from({ length: 2 * h + 1 }, () => new Array(2 * w + 1).fill(" "));
  // row 0 of the text is the north edge: grid y = h
  const put = (gx, gy, c) => (rows[2 * h - gy][gx] = c);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = plan.cells[y][x];
      put(2 * x + 1, 2 * y + 1, v === null ? " " : v === "stair" ? "^" : v === "void" ? "." : letters.get(v) ?? "?");
    }
  const mark = { door: "D", entrance: "E", window: "W", rail: "R" };
  for (const e of plan.edges) {
    const flat = e.from[1] === e.to[1];
    const gx = e.from[0] * 2 + (flat ? 1 : 0);
    const gy = e.from[1] * 2 + (flat ? 0 : 1);
    put(gx, gy, mark[e.kind] ?? (flat ? "-" : "|"));
    put(e.from[0] * 2, e.from[1] * 2, "+");
    put(e.to[0] * 2, e.to[1] * 2, "+");
  }
  // a doorway's middle vertex: no post, its mark across both edges
  for (const d of doorwaysOf(layout, storey)) if (Array.isArray(d.at)) put(d.at[0] * 2, d.at[1] * 2, mark[d.kind]);
  const counts = new Map(layout.rooms.map((r) => [r.id, r.cells]));
  const legend = [...letters].map(([id, c]) => `${c} ${id} (${counts.get(id)})`).join("  ");
  const well = layout.stairwell;
  const stairNote = well && (storey === well.from || storey === well.to) ? `  ^ stair (foot ${well.foot})` : "";
  const head = `${layout.building} storey ${storey}, seed ${layout.seed}: ${w} x ${h} cells of ${layout.grid}, north up`;
  return [head, ...rows.map((r) => r.join("").replace(/\s+$/, "")), legend + stairNote, ""].join("\n");
}

// ── the plan in pixels ──

const CELL = 56;
const MARGIN = 44;
const TOP = 40;
const TINTS = [
  [246, 214, 160],
  [176, 214, 240],
  [196, 230, 180],
  [236, 190, 210],
  [214, 200, 240],
  [240, 232, 170],
  [180, 228, 222],
  [232, 200, 176],
];
const INK = [24, 24, 28];
const LOOK = {
  exterior: { colour: [20, 20, 24], thick: 6 },
  interior: { colour: [96, 96, 104], thick: 4 },
  door: { colour: [30, 160, 60], thick: 6 },
  entrance: { colour: [220, 40, 40], thick: 8 },
  window: { colour: [40, 110, 230], thick: 6 },
  rail: { colour: [200, 40, 200], thick: 4 },
};

/** The plan of storey `storey` as a PNG's bytes; written to `path` when one is given. */
export function layoutPng(layout, storey = 0, path = null) {
  const plan = layout.storeyPlans[storey];
  const [w, h] = layout.size;
  const width = MARGIN * 2 + w * CELL;
  const height = TOP + MARGIN * 2 + h * CELL;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  const dot = (x, y, c) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    rgba.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(Math.min(y0, y1)); y < Math.round(Math.max(y0, y1)); y++)
      for (let x = Math.round(Math.min(x0, x1)); x < Math.round(Math.max(x0, x1)); x++) dot(x, y, c);
  };
  const write = (text, x, y, k = 2, c = INK, centred = false) => {
    const m = textMask(text, k);
    const x0 = Math.round(centred ? x - m.width / 2 : x);
    const y0 = Math.round(centred ? y - m.height / 2 : y);
    for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) if (m.at(i, j)) dot(x0 + i, y0 + j, c);
  };
  // grid vertex (gx, gy) to pixels, north up
  const px = (gx) => MARGIN + gx * CELL;
  const py = (gy) => TOP + MARGIN + (h - gy) * CELL;

  write(`${layout.building} storey ${storey} seed ${layout.seed}`, MARGIN, 12, 3);
  if (!plan) {
    write("no plan", MARGIN, TOP + MARGIN, 3);
    return finish();
  }
  const tint = new Map(layout.rooms.filter((r) => r.storey === storey).map((r, i) => [r.id, TINTS[i % TINTS.length]]));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = plan.cells[y][x];
      const [x0, y0, x1, y1] = [px(x), py(y + 1), px(x + 1), py(y)];
      if (isRoom(v)) rect(x0, y0, x1, y1, tint.get(v) ?? [220, 220, 220]);
      else if (v === "stair" || v === "void") {
        rect(x0, y0, x1, y1, v === "void" ? [200, 200, 204] : [232, 232, 232]);
        // hatched: lines one way; the void both ways
        for (let j = 0; j < CELL; j++)
          for (let i = 0; i < CELL; i++)
            if ((i + j) % 10 === 0 || (v === "void" && (i - j + CELL) % 10 === 0)) dot(x0 + i, y0 + j, [120, 120, 128]);
      }
    }
  // the grid and its coordinates
  for (let gx = 0; gx <= w; gx++) for (let y = py(h); y <= py(0); y++) dot(px(gx), y, [205, 205, 210]);
  for (let gy = 0; gy <= h; gy++) for (let x = px(0); x <= px(w); x++) dot(x, py(gy), [205, 205, 210]);
  for (let x = 0; x < w; x++) {
    write(String(x), px(x) + CELL / 2, py(0) + 16, 2, [110, 110, 120], true);
    write(String(x), px(x) + CELL / 2, py(h) - 14, 2, [110, 110, 120], true);
  }
  for (let y = 0; y < h; y++) {
    write(String(y), px(0) - 18, py(y) - CELL / 2, 2, [110, 110, 120], true);
    write(String(y), px(w) + 18, py(y) - CELL / 2, 2, [110, 110, 120], true);
  }
  // the edges: plain walls first, then what opens them, drawn over
  const ways = doorwaysOf(layout, storey).filter((d) => d.edges.length === 2);
  const inWay = new Set(ways.flatMap((d) => d.edges.map(keyOf)));
  const order = ["exterior", "interior", "rail", "window", "door", "entrance"];
  for (const kind of order)
    for (const e of plan.edges.filter((e) => e.kind === kind && !inWay.has(keyOf(e)))) {
      const look = LOOK[kind];
      const t = look.thick / 2;
      const [ax, ay, bx, by] = [px(e.from[0]), py(e.from[1]), px(e.to[0]), py(e.to[1])];
      if (kind === "door" || kind === "entrance" || kind === "window") {
        // the wall's ends either side of the opening, the opening in its colour
        const wall = LOOK[kind === "door" ? "interior" : "exterior"];
        const wt = wall.thick / 2;
        rect(Math.min(ax, bx) - wt, Math.min(ay, by) - wt, Math.max(ax, bx) + wt + 1, Math.max(ay, by) + wt + 1, wall.colour); // prettier-ignore
        const inset = CELL / 8;
        if (ay === by) rect(ax + inset, ay - t, bx - inset, ay + t + 1, kind === "window" ? look.colour : [255, 255, 255]);
        else rect(ax - t, by + inset, ax + t + 1, ay - inset, kind === "window" ? look.colour : [255, 255, 255]);
        if (kind !== "window") {
          // a doorway: a bar of its colour across the opening's middle
          if (ay === by) rect(ax + inset, ay - 2, bx - inset, ay + 3, look.colour);
          else rect(ax - 2, by + inset, ax + 3, ay - inset, look.colour);
          if (ay === by) rect((ax + bx) / 2 - 2, ay - t - 6, (ax + bx) / 2 + 3, ay + t + 7, look.colour);
          else rect(ax - t - 6, (ay + by) / 2 - 2, ax + t + 7, (ay + by) / 2 + 3, look.colour);
        }
      } else rect(Math.min(ax, bx) - t, Math.min(ay, by) - t, Math.max(ax, bx) + t + 1, Math.max(ay, by) + t + 1, look.colour); // prettier-ignore
    }
  // the doorways: one opening across both edges, the wall's stubs at its ends, a bar along it and a tick at the
  // middle vertex (where no post stands)
  for (const d of ways) {
    const look = LOOK[d.kind];
    const wall = LOOK[d.kind === "door" ? "interior" : "exterior"];
    const t = look.thick / 2;
    const wt = wall.thick / 2;
    const vs = d.edges.flatMap((e) => [e.from, e.to]);
    const flat = d.edges[0].from[1] === d.edges[0].to[1];
    const along = (v) => (flat ? v[0] : v[1]);
    const lo = vs.reduce((m, v) => (along(v) < along(m) ? v : m));
    const hi = vs.reduce((m, v) => (along(v) > along(m) ? v : m));
    const [ax, ay, bx, by] = [px(lo[0]), py(lo[1]), px(hi[0]), py(hi[1])];
    rect(Math.min(ax, bx) - wt, Math.min(ay, by) - wt, Math.max(ax, bx) + wt + 1, Math.max(ay, by) + wt + 1, wall.colour); // prettier-ignore
    const inset = CELL / 2; // the 64 clear in the middle of the 128
    if (flat) {
      rect(ax + inset, ay - t, bx - inset, ay + t + 1, [255, 255, 255]);
      rect(ax + inset, ay - 2, bx - inset, ay + 3, look.colour);
    } else {
      rect(ax - t, by + inset, ax + t + 1, ay - inset, [255, 255, 255]);
      rect(ax - 2, by + inset, ax + 3, ay - inset, look.colour);
    }
    const [mx, my] = [px(d.at[0]), py(d.at[1])];
    if (flat) rect(mx - 2, my - t - 6, mx + 3, my + t + 7, look.colour);
    else rect(mx - t - 6, my - 2, mx + t + 7, my + 3, look.colour);
  }
  // room names at the cell nearest each room's middle, with their cell count
  for (const r of layout.rooms.filter((r) => r.storey === storey)) {
    const mine = [];
    plan.cells.forEach((row, y) => row.forEach((v, x) => v === r.id && mine.push([x, y])));
    if (!mine.length) continue;
    const cx = mine.reduce((a, c) => a + c[0], 0) / mine.length;
    const cy = mine.reduce((a, c) => a + c[1], 0) / mine.length;
    const [bx, by] = mine.reduce((a, c) => ((c[0] - cx) ** 2 + (c[1] - cy) ** 2 < (a[0] - cx) ** 2 + (a[1] - cy) ** 2 ? c : a)); // prettier-ignore
    write(r.id, px(bx) + CELL / 2, py(by) - CELL / 2 - 6, 2, INK, true);
    write(`${r.cells}`, px(bx) + CELL / 2, py(by) - CELL / 2 + 8, 2, [90, 90, 96], true);
  }
  const well = layout.stairwell;
  if (well && storey === well.from) write("UP", px(well.bottom[0]) + CELL / 2, py(well.bottom[1]) - CELL / 2, 3, [180, 30, 30], true); // prettier-ignore
  if (well && storey === well.to) write("TOP", px(well.top[0]) + CELL / 2, py(well.top[1]) - CELL / 2, 2, [180, 30, 30], true); // prettier-ignore
  write("N", width - 20, 12, 3, INK);
  return finish();

  function finish() {
    const bytes = png(width, height, rgba);
    if (path) writeFileSync(path, bytes);
    return bytes;
  }
}
