// Marks laid on a material: what the mess hall's helper drew over its photographs (the owner's map project, its photos.mjs:
// plate seams, rivet rows, grime, rust streaks, wet streaks), made general and laid the same on the colour, the
// normal and the roughness, at any resolution. A mark is placed in the GoldSrc texture's texels (a seam every 64 of
// a 256 texture is four plates a tile) and drawn wherever that texel falls: on the 256 texture and on the 1K set alike.
//
//   parseMarks("seams:every=64;rivets:step=8;grime:amount=0.4,low=0.6")   [{ kind, ...options }]
//   layMarks({ color, normal, roughness }, marks, { width, height })        changes the layers in place
//
// A seam is a groove (dark, a lit lip under it, sunk in the normal, rough); a rivet a dome (lit up and to the left,
// its shadow down and to the right, raised in the normal); grime darkens where a tiling noise is high and towards
// the bottom (`low`) and the seams (`edges`), and is rough; a streak runs down in rust's colour and is rough; wet
// is lighter and smooth. Nothing else: the mess hall used these.
export const MARKS = {
  seams: { every: 64, x: 0, y: 0, dark: 0.45, lit: 1.25, width: 1 },
  rivets: { every: 64, step: 8, inset: 4, r: 1.5, rows: "both" },
  grime: { amount: 0.4, cell: 32, low: 0, edges: 0, seed: 1 },
  streaks: { count: 8, amount: 0.3, length: 0.5, width: 2, colour: [70, 46, 30], seed: 7 },
  wet: { amount: 0.25, count: 3, seed: 9, colour: [200, 225, 235] },
};

/** `kind:key=value,key=value;kind...`: the marks in the order they are laid. A colour is r/g/b. Refused in words. */
export function parseMarks(text) {
  return String(text).split(";").filter((s) => s.trim()).map((item) => {
    const [kind, rest = ""] = item.trim().split(":");
    if (!MARKS[kind]) throw new Error(`--marks: ${kind} is not a mark (${Object.keys(MARKS).join(", ")})`);
    const mark = { kind, ...structuredClone(MARKS[kind]) };
    for (const pair of rest.split(",").filter(Boolean)) {
      const [key, value] = pair.split("=");
      if (!(key in MARKS[kind])) throw new Error(`--marks: ${kind} has no ${key} (${Object.keys(MARKS[kind]).join(", ")})`); // prettier-ignore
      const read = key === "colour" ? value.split("/").map(Number) : key === "rows" ? value : Number(value);
      if ((key === "colour" && (read.length !== 3 || read.some((v) => !(v >= 0 && v <= 255)))) || (key === "rows" && !["x", "y", "both"].includes(read)) || (typeof read === "number" && !Number.isFinite(read))) // prettier-ignore
        throw new Error(`--marks: ${kind}'s ${key} is ${value}, not ${key === "colour" ? "r/g/b of 0 to 255" : key === "rows" ? "x, y or both" : "a number"}`); // prettier-ignore
      mark[key] = read;
    }
    if (kind === "seams" && !mark.x && !mark.y) mark.x = mark.y = mark.every;
    return mark;
  });
}

const wrap = (v, n) => ((v % n) + n) % n;
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }; // prettier-ignore
/** A value noise over [0, 1) x [0, 1) that tiles, `cells` a side. */
function noise(u, v, cells, seed) {
  const [x, y] = [u * cells, v * cells];
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [sx, sy] = [x - x0, y - y0].map((f) => f * f * (3 - 2 * f));
  const at = (i, j) => hash(wrap(i, cells), wrap(j, cells), seed);
  return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy; // prettier-ignore
}
const random = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }; // prettier-ignore

/** A mark as a function of a texel (u, v, floats): { mul, add, tint, t, height, rough } to lay on that place. */
function markAt(mark, T, H, marks) {
  if (mark.kind === "seams") {
    const groove = (d, every) => (d < mark.width ? [mark.dark, -1] : d < mark.width + 1 ? [mark.lit, 0] : d >= every - 1 ? [0.8, 0] : [1, 0]); // prettier-ignore
    return (u, v) => {
      const [a, b] = [mark.x ? groove(wrap(u, mark.x), mark.x) : [1, 0], mark.y ? groove(wrap(v, mark.y), mark.y) : [1, 0]]; // prettier-ignore
      const mul = Math.min(a[0], b[0]) < 1 ? Math.min(a[0], b[0]) : Math.max(a[0], b[0]);
      return { mul, height: Math.min(a[1], b[1]), rough: a[1] || b[1] ? 0.1 : 0 };
    };
  }
  if (mark.kind === "rivets") {
    const { every, step, inset, r } = mark;
    const near = (along, across, size, other) => {
      const row = Math.round((across - inset) / every) * every + inset;
      const c = Math.round((along - step / 2) / step) * step + step / 2;
      return [wrap(along - c + size / 2, size) - size / 2, wrap(across - row + other / 2, other) - other / 2];
    };
    return (u, v) => {
      const options = [mark.rows !== "y" ? near(u, v, T, H) : null, mark.rows !== "x" ? near(v, u, H, T).reverse() : null].filter(Boolean); // prettier-ignore
      const [i, j] = options.sort((p, q) => Math.hypot(...p) - Math.hypot(...q))[0];
      const d = Math.hypot(i, j);
      if (d <= r) return { mul: 1.1 + (0.45 * (-i - j)) / (r * 2), add: 10, height: Math.sqrt(r * r - d * d), rough: -0.1 }; // prettier-ignore
      return d <= r + 1 && i + j > 0 ? { mul: 0.55 } : {};
    };
  }
  if (mark.kind === "grime") {
    const seams = marks.find((m) => m.kind === "seams");
    return (u, v) => {
      const n = noise(u / T, v / H, Math.max(1, Math.round(T / mark.cell)), mark.seed) * 0.7 + noise(u / T, v / H, Math.max(1, Math.round((3 * T) / mark.cell)), mark.seed + 5) * 0.3; // prettier-ignore
      const edge = seams && mark.edges ? Math.max(0, 1 - Math.min(seams.x ? Math.min(wrap(u, seams.x), seams.x - wrap(u, seams.x)) : Infinity, seams.y ? Math.min(wrap(v, seams.y), seams.y - wrap(v, seams.y)) : Infinity) / mark.edges) : 0; // prettier-ignore
      const k = Math.max(0, 1 - mark.amount * Math.max(0, n - 0.45) * 2 - mark.low * (v / H) * 0.4 - mark.amount * edge * 0.5); // prettier-ignore
      return { mul: k, rough: 0.3 * (1 - k) };
    };
  }
  const rnd = random(mark.seed);
  if (mark.kind === "streaks") {
    const runs = Array.from({ length: mark.count }, () => ({ x: Math.floor(rnd() * T), y: Math.floor(rnd() * H), len: Math.max(1, Math.floor(H * mark.length * (0.4 + rnd() * 0.6))), w: Math.max(1, Math.round(mark.width * (0.5 + rnd()))) })); // prettier-ignore
    return (u, v) => {
      let t = 0;
      runs.forEach((run, k) => {
        const [i, j] = [wrap(Math.floor(u) - run.x, T), wrap(Math.floor(v) - run.y, H)];
        if (i < run.w && j < run.len) t = Math.max(t, mark.amount * (1 - j / run.len) * (0.6 + 0.4 * noise(u / T, v / H, Math.max(1, Math.round(T / 4)), mark.seed + k))); // prettier-ignore
      });
      return t ? { tint: mark.colour, t, rough: 0.5 * t } : {};
    };
  }
  const bands = Array.from({ length: mark.count }, () => ({ x: rnd() * T, w: 3 + rnd() * 8, a: mark.amount * (0.5 + rnd() * 0.5) })); // prettier-ignore
  return (u, v) => {
    let t = 0;
    for (const b of bands) { const d = Math.min(wrap(u - b.x, T), wrap(b.x - u, T)); t += b.a * Math.max(0, 1 - d / b.w) * (0.55 + 0.45 * noise(u / T, v / H, Math.max(1, Math.round(T / 16)), mark.seed + 2)); } // prettier-ignore
    return t ? { tint: mark.colour, t: Math.min(0.8, t), rough: -Math.min(0.8, t) } : {};
  };
}

/**
 * The marks laid on a material's layers, each { width, height, data } of floats 0..255 (colour and normal three a
 * pixel, roughness one), any of them at any resolution: `size` is the GoldSrc texture's { width, height }, the
 * texels the marks are placed in. The normal is OpenGL's (+Y up): a height's slope tilts it.
 */
export function layMarks(layers, marks, { width: T, height: H }) {
  const fields = marks.map((mark) => markAt(mark, T, H, marks));
  for (const [name, layer] of Object.entries(layers)) {
    if (!layer) continue;
    const { width, height, data } = layer;
    const [su, sv] = [T / width, H / height];
    const heights = name === "normal" ? new Float32Array(width * height) : null;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const [u, v, at] = [(x + 0.5) * su, (y + 0.5) * sv, y * width + x];
        for (const field of fields) {
          const e = field(u, v);
          if (heights) heights[at] += e.height ?? 0;
          else if (name === "roughness") data[at] = Math.max(0, Math.min(255, data[at] + 255 * (e.rough ?? 0)));
          else for (let c = 0; c < 3; c++) {
            let value = data[at * 3 + c] * (e.mul ?? 1) + (e.add ?? 0);
            if (e.tint) value = value * (1 - e.t) + e.tint[c] * e.t;
            data[at * 3 + c] = Math.max(0, Math.min(255, value));
          }
        }
      }
    if (!heights) continue;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const h = (i, j) => heights[wrap(j, height) * width + wrap(i, width)];
        const [du, dv] = [(h(x + 1, y) - h(x - 1, y)) / (2 * su), (h(x, y + 1) - h(x, y - 1)) / (2 * sv)];
        if (!du && !dv) continue;
        const at = (y * width + x) * 3;
        const n = [data[at] / 127.5 - 1 - du, data[at + 1] / 127.5 - 1 + dv, data[at + 2] / 127.5 - 1];
        const len = Math.hypot(...n) || 1;
        for (let c = 0; c < 3; c++) data[at + c] = Math.max(0, Math.min(255, (n[c] / len + 1) * 127.5));
      }
  }
  return layers;
}
