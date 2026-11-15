// The pack's own stroke font: capitals, digits, common punctuation and four arrows, each a few strokes on a grid 8
// wide and 12 high (y down: 0 the top of a capital, c the line it stands on). Drawn here, from no font file. A stroke
// is its corners as pairs of digits (x then y, in base 16); `~` before it rounds its corners (the bowl of a B, an O);
// a stroke whose last corner is its first is closed. A letter is as wide as its strokes reach (an I is one stroke).
//
//   textPaths(text, x, y, height, gap)   { paths, width, missing }: the strokes' middle lines, the cap's top left at x, y
//   textWidth(text, height, gap)         how wide that is; `gap` between letters is a share of the height (0.2)
const GLYPHS = {
  A: "0c408c 1979", B: "000c ~005071755606 ~0666878b6c0c", C: "~826020020a2c6c8a", D: "000c ~004083894c0c", // prettier-ignore
  E: "80000c8c 0666", F: "80000c 0666", G: "~826020020a2c6c8a 8a8747", H: "000c 808c 0686", I: "000c", // prettier-ignore
  J: "~606a4c2c0a", K: "000c 80078c", L: "000c7c", M: "0c0057a0ac", N: "0c008c80", O: "~2060828a6c2c0a0220", // prettier-ignore
  P: "000c ~005082855707", Q: "~2060828a6c2c0a0220 698c", R: "000c ~005082855707 478c", S: "~82602002042666888a6c2c0a", // prettier-ignore
  T: "0080 404c", U: "~000a2c6c8a80", V: "004c80", W: "003c557ca0", X: "008c 800c", Y: "004680 464c", Z: "00800c8c", // prettier-ignore
  0: "~2050727a5c2c0a0220", 1: "02303c", 2: "~02206082850c 0c8c", 3: "~02206082846636 ~3666888a6c2c0a", 4: "6c600888", // prettier-ignore
  5: "800005 ~0555878a6c2c0a", 6: "~826020020a2c6c8a87652507", 7: "00803c", 8: "~206082846626040220 ~2666888a6c2c0a0826", // prettier-ignore
  9: "~0a2c6c8a8260200205276785", ".": "0c0c", ",": "1b0d", ":": "0404 0b0b", "!": "0008 0c0c", "?": "~02206082844749 4c4c", // prettier-ignore
  "'": "1003", '"': "0003 3033", "-": "0656", "+": "0666 3339", "/": "0c60", "(": "~3003093c", ")": "~0033393c", // prettier-ignore
  "=": "0464 0868", "<": "60066c", ">": "00660c", "%": "0c80 1111 7b7b", "→": "0686 42864a", "←": "8606 42064a", // prettier-ignore
  "↑": "4c40 044084", "↓": "404c 084c88", // prettier-ignore
};
const SPACE = 4;
/** A stroke's corners cut twice (each side's quarter and three quarters kept): a round bowl from eight corners; an open stroke keeps its ends. */
function rounded(points) {
  const closed = points.length > 2 && points[0].join() === points.at(-1).join();
  let list = closed ? points.slice(0, -1) : points;
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < list.length - (closed ? 0 : 1); i++) {
      const [p, q] = [list[i], list[(i + 1) % list.length]];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    list = closed ? out : [list[0], ...out, list.at(-1)];
  }
  return closed ? [...list, list[0]] : list;
}
const read = new Map();
/** A letter's strokes on the grid and its width; a small letter is its capital; `null` for one the font has not. */
function glyph(letter) {
  const key = GLYPHS[letter] ? letter : letter.toUpperCase();
  if (!GLYPHS[key]) return null;
  if (!read.has(key)) {
    const strokes = GLYPHS[key].split(" ").map((s) => {
      const points = (s.replace("~", "").match(/../g) ?? []).map((pair) => [parseInt(pair[0], 16), parseInt(pair[1], 16)]);
      return s[0] === "~" ? rounded(points) : points;
    });
    read.set(key, { strokes, width: Math.max(...strokes.flat().map((p) => p[0])) });
  }
  return read.get(key);
}
/** The strokes of one line of words, capitals `height` high, their top left at (x, y): { paths, width, missing }. */
export function textPaths(text, x, y, height, gap = 0.2) {
  const [unit, paths, missing] = [height / 12, [], []];
  let at = x;
  for (const letter of String(text)) {
    const g = letter === " " ? { strokes: [], width: SPACE } : glyph(letter);
    if (!g) { missing.push(letter); continue; } // prettier-ignore
    for (const stroke of g.strokes) paths.push(stroke.map(([u, v]) => [at + u * unit, y + v * unit]));
    at += g.width * unit + gap * height;
  }
  return { paths, width: Math.max(0, at - x - gap * height), missing };
}
export const textWidth = (text, height, gap) => textPaths(text, 0, 0, height, gap).width;
