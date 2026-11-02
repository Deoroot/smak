// New Byzantium's emblems (levels/lib/emblems.mjs, levels/lib/svg-raster.mjs, levels/lib/emblem-texture.mjs): the
// minimal SVG rasterizer (coverage, fill rules, masks, blur, transforms, what it refuses and what it leaves out), the
// drawn alphabet, the five kept designs (the same SVG twice, inside their box, drawn whole, distinct silhouettes), a
// design made a masked GoldSrc texture in a WAD that reads back, the banners, plaque, six posters and their defaced
// copies, and the kit manifest's entries the emblem tool makes. No photos, no network. Each refusal by its sentence.
import { test, sure } from "./helper.mjs";
import { rasterizeSvg, pathPolygons, transformOf } from "../levels/lib/svg-raster.mjs";
import {
  MSR_VARIANTS,
  INSURGENT_VARIANTS,
  msrEmblem,
  insurgentMark,
  designSvg,
  msrColours,
  PALETTES,
  textPolys,
  textWidth,
  GLYPHS,
  inset,
  strokeOf,
  area,
  bannerDesign,
  posterDesign,
  plaqueDesign,
  defacedDesign,
  POSTERS,
  DEFACED,
  PLAQUE_LINES,
} from "../levels/lib/emblems.mjs";
import { svgPicture, finishPicture, paletteTexture } from "../levels/lib/emblem-texture.mjs";
import { buildKitWad } from "../levels/lib/art-kit.mjs";
import { readWad } from "../src/maps/wad.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "./helper.mjs";

const KIT = JSON.parse(readFileSync(join(HERE, "../levels/art/newbyzantium-kit.json"), "utf8"));

const svg = (body, w = 8, h = 8) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const alphaAt = (p, x, y) => p.rgba[(y * p.width + x) * 4 + 3];
const refusal = (run, words) => {
  let msg = "";
  try {
    run();
  } catch (e) {
    msg = e.message;
  }
  sure(msg.includes(words), `wanted "${words}", got: ${msg || "no error"}`);
};
const C = msrColours(270);
/** A design's silhouette at `s` px: solid where any role is drawn. */
const silhouette = (design, s) => {
  const roles = Object.fromEntries(design.items.map((it) => [it.role, "#ffffff"]));
  const p = rasterizeSvg(designSvg(design, roles), { width: s, height: s, supersample: 2 });
  return Uint8Array.from({ length: s * s }, (_, i) => (p.rgba[i * 4 + 3] >= 128 ? 1 : 0));
};
const iou = (a, b) => {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i];
    either += a[i] | b[i];
  }
  return both / Math.max(1, either);
};

test("emblems: the SVG rasterizer's coverage, fill rules, mask, blur and transforms, and what it refuses by its sentence", () => {
  // a rect over half a pixel column: exact coverage along the row
  const half = rasterizeSvg(svg('<rect x="2.5" y="0" width="3" height="8" fill="#ff0000"/>'));
  sure(
    alphaAt(half, 2, 4) === 128 && alphaAt(half, 3, 4) === 255 && alphaAt(half, 1, 4) === 0,
    `half-covered pixels: ${alphaAt(half, 1, 4)} ${alphaAt(half, 2, 4)} ${alphaAt(half, 3, 4)}`,
  );
  sure(half.rgba[(4 * 8 + 3) * 4] === 255 && half.rgba[(4 * 8 + 3) * 4 + 2] === 0, "the fill is red");
  // two squares, one inside the other: evenodd leaves the hole, nonzero (same winding) fills it
  const d = "M0 0L8 0L8 8L0 8Z M2 2L6 2L6 6L2 6Z";
  sure(
    alphaAt(rasterizeSvg(svg(`<path d="${d}" fill-rule="evenodd"/>`)), 4, 4) === 0,
    "evenodd: the inner square is a hole",
  );
  sure(alphaAt(rasterizeSvg(svg(`<path d="${d}"/>`)), 4, 4) === 255, "nonzero: the same winding fills");
  // a luminance mask cuts, a group's opacity and a blur spread
  const masked = rasterizeSvg(
    svg(
      '<defs><mask id="m"><rect x="0" y="0" width="8" height="8" fill="#fff"/><rect x="0" y="0" width="4" height="8" fill="#000"/></mask></defs><rect x="0" y="0" width="8" height="8" fill="#00ff00" mask="url(#m)"/>',
    ),
  );
  sure(alphaAt(masked, 1, 1) === 0 && alphaAt(masked, 6, 1) === 255, "the mask's black half is cut away");
  sure(
    alphaAt(rasterizeSvg(svg('<g opacity="0.5"><rect width="8" height="8"/></g>')), 3, 3) === 128,
    "a group at half opacity",
  );
  const blurred = rasterizeSvg(
    svg(
      '<defs><filter id="f"><feGaussianBlur stdDeviation="1"/></filter></defs><rect x="4" y="0" width="4" height="8" filter="url(#f)"/>',
    ),
  );
  sure(
    alphaAt(blurred, 3, 4) > 20 && alphaAt(blurred, 3, 4) < 200,
    `a blur spreads over the edge: ${alphaAt(blurred, 3, 4)}`,
  );
  // transforms and viewBox scaling; curves flattened near their line
  sure(
    alphaAt(rasterizeSvg(svg('<rect width="2" height="2" transform="translate(6 6)"/>')), 7, 7) === 255,
    "translate",
  );
  sure(
    alphaAt(rasterizeSvg(svg('<rect width="4" height="4"/>', 4, 4), { width: 16, height: 16 }), 15, 15) ===
      255,
    "the viewBox scaled to the asked size",
  );
  const m = transformOf("rotate(90 4 4)");
  sure(Math.abs(m[4] - 8) < 1e-9 && Math.abs(m[5]) < 1e-9, `rotate about a point: ${m}`);
  const q = pathPolygons("M0 0 Q 10 10 20 0 Z", 0.1)[0];
  sure(
    q.length > 8 && Math.max(...q.map((p) => p[1])) > 4.8 && Math.max(...q.map((p) => p[1])) <= 5.0001,
    "a quadratic flattened under its control point at half height",
  );
  // what it does not draw is named; what it cannot read is refused
  const skipped = rasterizeSvg(
    svg('<path d="M0 0L8 0L8 8Z" stroke="#000"/><text x="0" y="8">hi</text>'),
  ).skipped.join(" | ");
  sure(skipped.includes("stroke on <path>") && skipped.includes("<text>"), `skipped: ${skipped}`);
  refusal(() => pathPolygons("M0 0 A 4 4 0 0 1 8 8"), "arcs (A) in a path are not drawn");
  refusal(() => rasterizeSvg('<svg viewBox="0 0 8 8"><g></svg>'), "</svg> closes nothing open");
  refusal(() => rasterizeSvg("<g></g>"), "the document has no <svg> element");
  refusal(() => rasterizeSvg(svg('<rect width="8" height="8" fill="gold"/>')), "fill gold is not a colour");
});

test("emblems: the drawn alphabet: every letter inside its box, widths scale with size, an unknown letter refused by name", () => {
  for (const ch of "ABCDEFGHIJKLMNOPRSTUVWXYZ") {
    const t = textPolys(ch, { x: 0, y: 10, size: 10, serifs: false });
    sure(t.polys.length > 0, `${ch} draws something`);
    const xs = t.polys.flat().map((p) => p[0]);
    const ys = t.polys.flat().map((p) => p[1]);
    sure(
      Math.min(...ys) > -1.5 && Math.max(...ys) < 11.5,
      `${ch} stays near the cap and base lines: ${Math.min(...ys)}..${Math.max(...ys)}`,
    );
    sure(
      Math.min(...xs) > -1.5 && Math.max(...xs) < GLYPHS[ch][0] + 1.5,
      `${ch} stays in its width ${GLYPHS[ch][0]}`,
    );
  }
  const a = textPolys("ORDER IS PEACE", { size: 10 });
  const b = textPolys("ORDER IS PEACE", { size: 20 });
  sure(
    Math.abs(b.width - 2 * a.width) < 1e-6 && Math.abs(a.width - textWidth("ORDER IS PEACE")) < 1e-6,
    "width doubles with the size",
  );
  sure(
    textPolys("ORDER IS PEACE", { size: 20, maxWidth: 50 }).width <= 50 + 1e-6,
    "maxWidth shrinks the line to fit",
  );
  refusal(() => textPolys("PEACE!"), 'the letter "!" is not drawn');
  // the stroke and inset geometry the designs stand on
  sure(
    strokeOf(
      [
        [0, 0],
        [10, 0],
      ],
      2,
    ).every((p) => area(p) > 0),
    "a stroke's polygons are wound one way (they union)",
  );
  const inner = inset(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    2,
  );
  sure(Math.abs(area(inner) - 36) < 1e-6, `a 10 square inset by 2 is 6 square: ${area(inner)}`);
});

test("emblems: the five designs, the same SVG twice, inside their box, drawn whole; their silhouettes distinct at 64 px", () => {
  const all = [
    ...Object.keys(MSR_VARIANTS).map((id) => ["msr", id, msrEmblem(id)]),
    ...Object.keys(INSURGENT_VARIANTS).map((id) => ["ins", id, insurgentMark(id)]),
  ];
  sure(all.length === 5, `three MSR and two Insurgent designs (the chain dropped), got ${all.length}`);
  for (const [kind, id, d] of all) {
    const pal = kind === "msr" ? PALETTES.sign(C) : { paint: C.red };
    const text = designSvg(d, pal, { title: id });
    sure(text === designSvg(kind === "msr" ? msrEmblem(id) : insurgentMark(id), pal, { title: id }), `${kind} ${id}: the same SVG twice`); // prettier-ignore
    const p = rasterizeSvg(text, { width: 64, height: 64, supersample: 2 });
    sure(!p.skipped.length, `${kind} ${id} is drawn whole: ${p.skipped.join(", ")}`);
    let edge = 0;
    let solid = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const a = alphaAt(p, x, y);
        if (a >= 128) solid++;
        if ((x === 0 || y === 0 || x === 63 || y === 63) && a >= 128) edge++;
      }
    sure(edge === 0, `${kind} ${id} keeps off its box's edge (${edge} edge pixels)`);
    sure(solid > 64 * 64 * 0.15, `${kind} ${id} is a mark, not a speck: ${solid} solid pixels at 64`);
  }
  for (const group of [all.filter((a) => a[0] === "msr"), all.filter((a) => a[0] === "ins")])
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const o = iou(silhouette(group[i][2], 64), silhouette(group[j][2], 64));
        sure(
          o < 0.75,
          `${group[i][0]} ${group[i][1]} and ${group[j][1]} differ at 64 px (overlap ${o.toFixed(2)})`,
        );
      }
  // the stencil is one colour; the MSR hue changes the field and nothing else
  const sten = designSvg(msrEmblem("a"), PALETTES.stencil(C));
  const fills = new Set(
    sten.match(/fill="#[0-9a-f]{6}"/g).filter((f) => f !== 'fill="#ffffff"' && f !== 'fill="#000000"'),
  );
  sure(fills.size === 1, "the stencil is a single colour");
  sure(msrColours(215).field !== C.field && msrColours(215).gold === C.gold, "the hue moves the field only");
  refusal(() => msrEmblem("z"), "MSR emblem z is not one of a, b, c");
  refusal(() => insurgentMark(2), "Insurgent mark 2 is not one of 1, 3");
});

test("emblems: a design made a masked GoldSrc texture: holes index 255 blue, four mips, a WAD that reads back", () => {
  const d = msrEmblem("b");
  const pic = svgPicture(designSvg(d, PALETTES.sign(C)), 64, 64);
  const plain = finishPicture(pic, { masked: true });
  const lined = finishPicture(pic, { masked: true, keyline: { px: 2, colour: [10, 10, 10] } });
  const solid = (p) => p.rgba.filter((_, i) => i % 4 === 3 && p.rgba[i] === 255).length;
  sure(solid(lined) > solid(plain), "the keyline grows the solid part");
  const t = paletteTexture("{t_emblem", lined);
  sure(t.mips.length === 4 && t.mips[3].length === 8 * 8, "four mips down to an eighth");
  sure(
    t.palette[255 * 3] === 0 && t.palette[255 * 3 + 1] === 0 && t.palette[255 * 3 + 2] === 255,
    "index 255 is pure blue",
  );
  sure(t.pixels.includes(255) && t.stats.holeShare > 0.2, `a masked sign has holes: ${t.stats.holeShare}`);
  const under = { width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4).fill(40) };
  const { bytes, problems } = buildKitWad([t, paletteTexture("t_plate", finishPicture(pic, { under }))]);
  sure(!problems.length, `the WAD checks: ${problems.join("; ")}`);
  sure(
    readWad(bytes)
      .textures.map((x) => x.name)
      .join() === "{t_emblem,t_plate",
    "both textures read back by name",
  );
  refusal(() => paletteTexture("{nbi_emblem_far_too_long", lined), "characters: GoldSrc keeps 15 at most");
  refusal(
    () => svgPicture(svg('<text x="0" y="8">MSR</text>'), 8, 8),
    "the SVG holds what is not drawn: <text>",
  );
});

const MOCK = { ...PALETTES.sign(msrColours(270)), shade: "#000000", paper: "#d3c7a6", ray: "#553377", slogan: "#222222", plate: "#888888", line: "#555555", engrave: "#222222", relief: "#cccccc" }; // prettier-ignore
test("emblems: the kit's mock-ups: a torn banner holed, six posters and their defaced copies drawn whole, the torn corner off the paper", () => {
  const E = Object.fromEntries(Object.keys(MSR_VARIANTS).map((id) => [id, msrEmblem(id)]));
  const holes = (design, w, h) => svgPicture(designSvg(design, MOCK), w, h).rgba.filter((v, i) => i % 4 === 3 && v < 128).length; // prettier-ignore
  const whole = holes(bannerDesign(E.a), 128, 256);
  const torn = holes(bannerDesign(E.a, { torn: true }), 128, 256);
  sure(
    torn > whole + 1500,
    `the torn banner loses its foot and has holes: ${whole} -> ${torn} see-through texels`,
  );
  sure(holes(plaqueDesign(E.c, PLAQUE_LINES), 128, 64) === 0, "the plaque is solid");
  sure(
    Object.keys(POSTERS).length === 6 && Object.keys(DEFACED).length === 6,
    "six posters, six defaced copies",
  );
  for (const [id, P] of Object.entries(POSTERS)) {
    sure(MSR_VARIANTS[P.emblem], `poster ${id}'s emblem ${P.emblem} is one of the MSR's`);
    sure(holes(posterDesign(E[P.emblem], P.lines, P), 128, 192) === 0, `poster ${id} covers its sheet`);
  }
  for (const id of Object.keys(DEFACED)) {
    const { design, torn: hole } = defacedDesign(id, E, "#aa2222");
    sure(INSURGENT_VARIANTS[DEFACED[id].mark], `defaced ${id} is sprayed with a kept mark`);
    const p = svgPicture(designSvg(design, MOCK), 128, 192);
    sure(p.width === 128 && p.height === 192, `defaced ${id} at 128x192`);
    const xs = hole[0].map((q) => q[0]);
    const ys = hole[0].map((q) => q[1]);
    const corner = DEFACED[id].corner;
    sure((corner.includes("r") ? Math.max(...xs) >= 128 : Math.min(...xs) <= 0) && (corner.includes("b") ? Math.max(...ys) >= 192 : Math.min(...ys) <= 0), `defaced ${id}'s tear takes its ${corner} corner`); // prettier-ignore
  }
  refusal(() => posterDesign(E.b, ["A", "B"], { pattern: "plaid" }), "poster pattern plaid is not rays");
  refusal(() => defacedDesign(9, E, "#aa2222"), "defaced poster 9 is not one of 1, 2, 3, 4, 5, 6");
});

test("emblems: the kit manifest's entries made by the emblem tool name designs it draws, at their sizes, the choice kept", () => {
  const made = KIT.textures.filter((t) => t.source?.tool === "levels/tools/emblems.mjs");
  const tables = { emblem: MSR_VARIANTS, banner: MSR_VARIANTS, plaque: MSR_VARIANTS, poster: POSTERS, mark: INSURGENT_VARIANTS, defaced: DEFACED }; // prettier-ignore
  for (const t of made) {
    const [kind, arg, flag] = t.source.design.split(" ");
    sure(tables[kind] && arg in tables[kind], `${t.name}: design "${t.source.design}" is one the tool draws`);
    sure(
      !flag || (kind === "banner" && flag === "torn"),
      `${t.name}: "${flag}" is a banner's torn or nothing`,
    );
    sure(t.status === "approved" && t.source.kind === "paint" && t.source.brief, `${t.name} is approved, painted by the tool, with its brief`); // prettier-ignore
    sure(t.name.startsWith("{") === (["emblem", "banner", "mark"].includes(kind)), `${t.name}: masked exactly when its design has holes`); // prettier-ignore
  }
  const design = (n) => made.find((t) => t.name === n)?.source.design;
  sure(
    design("{nbi_eagle") === "emblem b" && design("{nbi_eaglesm") === "emblem b",
    "the main emblem is Ascendant",
  );
  sure(
    design("{nbi_banner1") === "banner a" && design("nbi_plaque") === "plaque c",
    "the formal eagle on banner 1, the Foundry seal on the plaque",
  );
  sure(
    design("{nbr_mark") === "mark 3" && design("{nbr_upturn") === "mark 1",
    "the Claw is the main mark, the Upturned the stencil",
  );
  for (let n = 1; n <= 6; n++) sure(design(`nbi_poster${n}`) === `poster ${n}` && design(`nbr_defaced${n}`) === `defaced ${n}`, `poster ${n} and its defaced copy`); // prettier-ignore
});
