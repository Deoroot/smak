#!/usr/bin/env node
// New Byzantium's emblems: the source of the art kit's MSR identity and Insurgent textures whose manifest entry says
// `"source": { "kind": "paint", "tool": "levels/tools/emblems.mjs", "design": "<what>" }`. Each is drawn as SVG
// (levels/lib/emblems.mjs), rasterized by SMAK's own rasterizer, finished and cut to a GoldSrc texture
// (levels/lib/emblem-texture.mjs), written to a WAD, and laid out with the emblem family on one review sheet.
//
//   node levels/tools/emblems.mjs [--out dir] [--svg dir] [--sheet file] [--msr-hue deg] [--offline] [--cache dir]
//
// Designs an entry may name: `emblem a|b|c`, `banner a|b|c [torn]`, `plaque a|b|c`, `poster 1..6`, `mark 1|3`,
// `defaced 1..6`. The entry gives the name and the size.
// --svg    where the SVG sources go (default levels/art/emblems/: our own vector art, tracked)
// --out    the WAD (emblems.wad), png/<name>.png, report.json (default levels/art/out/emblems/, gitignored)
// --sheet  the review sheet (default <out>/emblems-sheet.png)
// --msr-hue  the MSR's hue (default the kit's params.msrHue: 270 purple; about 215 for H9's blue)
// Photos for grain and walls come from the art kit's cache (levels/art/cache/, `node levels/tools/art-kit.mjs
// fetch`); --offline, or a photo missing, draws without them (flat paint, named in the report and on the sheet).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unpng, png } from "../../src/image.mjs";
import { label } from "../../src/render.mjs";
import { textureRgba } from "../../src/maps/miptex.mjs";
import { composeTexture } from "../../src/maps/texture-recipe.mjs";
import { buildKitWad, openFlags, validateKit } from "../lib/art-kit.mjs";
import {
  MSR_VARIANTS,
  INSURGENT_VARIANTS,
  msrEmblem,
  insurgentMark,
  designSvg,
  msrColours,
  PALETTES,
  bannerDesign,
  plaqueDesign,
  posterDesign,
  defacedDesign,
  POSTERS,
  PLAQUE_LINES,
} from "../lib/emblems.mjs";
import { svgPicture, grainOf, finishPicture, paletteTexture } from "../lib/emblem-texture.mjs";

export const TOOL = "levels/tools/emblems.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const ART = resolve(HERE, "../art");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const KIT = JSON.parse(readFileSync(join(ART, "newbyzantium-kit.json"), "utf8"));
const kitProblems = validateKit(KIT).errors;
if (kitProblems.length) throw new Error(`the kit does not check: ${kitProblems.join("; ")}`);
const ENTRIES = KIT.textures.filter((t) => t.source?.tool === TOOL && t.status !== "dropped");
if (!ENTRIES.length) throw new Error(`no texture in the kit names ${TOOL} as its source`);
const HUE = Number(opt("msr-hue", KIT.params?.msrHue ?? 270));
const SVG_DIR = resolve(opt("svg", join(ART, "emblems")));
const OUT = resolve(opt("out", join(ART, "out", "emblems")));
const SHEET = resolve(opt("sheet", join(OUT, "emblems-sheet.png")));
const CACHE = resolve(opt("cache", join(ART, "cache")));
const OFFLINE = args.includes("--offline");
for (const d of [SVG_DIR, OUT, join(OUT, "png"), dirname(SHEET)]) mkdirSync(d, { recursive: true });

// ── photos: grain and walls ────────────────────────────────────────────────
const missing = new Set();
const photoAt = (key, width, height, mean) => {
  const file = join(CACHE, "ambientCG", `${key}_1K_Color.png`);
  if (OFFLINE || !existsSync(file)) {
    missing.add(key);
    return null;
  }
  const base = { picture: unpng(readFileSync(file)), metres: KIT.bases?.[key]?.metres ?? [2, 2] };
  return composeTexture([{ op: "photo", photo: key, ...(mean ? { grade: { mean } } : {}) }], {
    width,
    height,
    bases: { [key]: base },
    supersample: 1,
  });
};
const flat = (width, height, rgb) => ({
  width,
  height,
  rgba: new Uint8Array(width * height * 4).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])),
});
const grain = (key, w, h) => {
  const p = photoAt(key, w, h);
  return p ? grainOf(p) : null;
};
const wall = (key, w, h, mean, fallback) => photoAt(key, w, h, mean) ?? flat(w, h, fallback);

// ── designs and how each is finished ───────────────────────────────────────
const colours = msrColours(HUE);
const sign = PALETTES.sign(colours);
const heightPal = PALETTES.height();
const KEYLINE = { colour: [20, 17, 24] };
const emblems = Object.fromEntries(Object.keys(MSR_VARIANTS).map((id) => [id, msrEmblem(id)]));
const plaquePal = { plate: "#8f7a52", line: "#594a2c", engrave: "#2a2017", relief: "#b8a16a" };
const posterPal = {
  ...sign,
  paper: colours.paper,
  ray: colours.fieldLight,
  slogan: "#2a1c30",
  shade: "#000000",
};
const paperRelief = {
  paper: "#dddddd",
  field: "#dddddd",
  ray: "#dddddd",
  slogan: "#dddddd",
  gold: "#ffffff",
};
/** Measured flags a texture means to have, with the reason (the art kit's accept), besides its entry's own. */
const ACCEPT = { emblem: { loud: "the MSR's gold and purple sign: a hero mark, sparing in the city" }, banner: { loud: "the MSR's purple and gold cloth: a hero piece" }, mark: { loud: "the Insurgents' red spray paint is meant to shout against the regime's marble" }, defaced: { loud: "red spray over the poster, by design" } }; // prettier-ignore
/**
 * What an entry's `design` draws: `{ design, palette, finish, torn? }` for its size. Refuses a design the tool does
 * not know, by its words.
 */
function plan(designKey, [w, h]) {
  const [kind, arg, flag] = String(designKey).trim().split(/\s+/);
  const need = (table, what) => {
    if (!(arg in table))
      throw new Error(`design "${designKey}": ${what} ${arg} is not one of ${Object.keys(table).join(", ")}`);
  };
  if (kind === "emblem" || kind === "stencil" || kind === "plate") {
    need(emblems, "MSR emblem");
    if (kind === "stencil")
      return { design: emblems[arg], palette: PALETTES.stencil(colours), finish: { masked: true, spray: true, grain: { low: grain("Concrete033", w, h), amount: 0.3 } } }; // prettier-ignore
    return {
      design: emblems[arg],
      palette: sign,
      finish: {
        masked: kind === "emblem",
        keyline: { ...KEYLINE, px: w / 128 },
        relief: {},
        emboss: 0.9,
        grain: { high: grain("Metal042B", w, h), low: grain("Marble016", w, h), amount: 0.35 },
        under: kind === "plate" ? wall("Marble006", w, h, 0.07, [24, 22, 28]) : undefined,
      },
    };
  }
  if (kind === "banner") {
    need(emblems, "MSR emblem");
    if (flag && flag !== "torn")
      throw new Error(`design "${designKey}": a banner is plain or torn, not ${flag}`);
    return {
      design: bannerDesign(emblems[arg], { torn: flag === "torn" }),
      palette: { ...sign, shade: "#000000" },
      finish: { masked: true, relief: { field: "#3a3a3a", shade: null, metal: "#bbbbbb" }, emboss: 0.7, grain: { high: grain("Metal042B", w, h), low: grain("Concrete028", w, h), amount: 0.3 } }, // prettier-ignore
    };
  }
  if (kind === "plaque") {
    need(emblems, "MSR emblem");
    return {
      design: plaqueDesign(emblems[arg], PLAQUE_LINES),
      palette: plaquePal,
      finish: { relief: { plate: "#bdbdbd", line: "#8a8a8a", engrave: "#202020", relief: "#ffffff" }, emboss: 1.0, grain: { high: grain("Metal042B", w, h), low: grain("Metal042B", w, h), amount: 0.4 } }, // prettier-ignore
    };
  }
  if (kind === "poster") {
    need(POSTERS, "poster");
    const P = POSTERS[arg];
    return {
      design: posterDesign(emblems[P.emblem], P.lines, P),
      palette: posterPal,
      finish: { relief: paperRelief, emboss: 0.15, grain: { high: grain("Concrete045", w, h), low: grain("Concrete045", w, h), amount: 0.22 } }, // prettier-ignore
    };
  }
  if (kind === "mark") {
    need(INSURGENT_VARIANTS, "Insurgent mark");
    return { design: insurgentMark(arg), palette: { paint: colours.red }, finish: { masked: true, spray: true, threshold: 0.4, grain: { low: grain("Concrete033", w, h), amount: 0.35 } } }; // prettier-ignore
  }
  if (kind === "defaced") {
    const { design, torn } = defacedDesign(arg, emblems, colours.red);
    return {
      design,
      torn,
      palette: posterPal,
      finish: { grain: { low: grain("Concrete045", w, h), amount: 0.25 } },
    };
  }
  throw new Error(
    `design "${designKey}" is not one the tool draws: emblem, stencil, plate, banner, plaque, poster, mark, defaced`,
  );
}
const svgs = {};
const svgFile = (name) => `${name.replace(/^[{~!]/, "")}.svg`;
/** A texture from a design: rasterized in its palette, the relief from the height palette, finished, palettized. */
function make(name, designKey, size, { keepSvg = true } = {}) {
  const [w, h] = size;
  const p = plan(designKey, size);
  const svg = designSvg(p.design, p.palette, { title: `${name}: ${designKey}` });
  if (keepSvg) svgs[svgFile(name)] = svg;
  let pic = svgPicture(svg, w, h);
  if (p.torn) {
    // the torn corner shows the wall behind the poster: the wall's photo laid in through the tear's coverage
    const hole = svgPicture(
      designSvg({ size: p.design.size, items: [{ role: "hole", polys: p.torn }] }, { hole: "#ffffff" }),
      w,
      h,
    );
    const back = wall("Concrete033", w, h, 0.3, [96, 92, 86]);
    const rgba = Uint8Array.from(pic.rgba);
    for (let i = 0; i < w * h; i++) {
      const a = hole.rgba[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++)
        rgba[i * 4 + c] = Math.round(rgba[i * 4 + c] * (1 - a) + back.rgba[i * 4 + c] * a * 0.82);
    }
    pic = { width: w, height: h, rgba };
  }
  const heightPic = p.finish.relief
    ? svgPicture(designSvg(p.design, { ...heightPal, ...p.finish.relief }), w, h)
    : undefined;
  return paletteTexture(name, finishPicture(pic, { ...p.finish, height: heightPic }));
}

// ── the kit's textures ─────────────────────────────────────────────────────
const textures = ENTRIES.map((e) => ({ entry: e, texture: make(e.name, e.source.design, e.size) }));
// the family, for the review sheet only (not in the WAD): every emblem as vector art and as a stencil, the main one on a plate
for (const id of Object.keys(MSR_VARIANTS)) svgs[`msr-${id}.svg`] = designSvg(emblems[id], sign, { title: `MSR emblem ${id}: ${MSR_VARIANTS[id].name}` }); // prettier-ignore
for (const id of Object.keys(INSURGENT_VARIANTS)) svgs[`insurgent-${id}.svg`] = designSvg(insurgentMark(id), { paint: colours.red }, { title: `Insurgent mark ${id}: ${INSURGENT_VARIANTS[id].name}` }); // prettier-ignore
const extras = Object.fromEntries([
  ...Object.keys(MSR_VARIANTS).map((id) => [
    `stencil ${id}`,
    make(`{x_sten_${id}`, `stencil ${id}`, [128, 128], { keepSvg: false }),
  ]),
  ["plate b", make("x_plate_b", "plate b", [128, 128], { keepSvg: false })],
]);
svgs["msr-b-stencil.svg"] = designSvg(emblems.b, PALETTES.stencil(colours), {
  title: "MSR emblem b, stencil",
});

// ── the WAD, the SVGs, the PNGs, the report ────────────────────────────────
const { bytes, problems } = buildKitWad(textures.map((t) => t.texture));
if (problems.length) throw new Error(`the WAD does not check: ${problems.join("; ")}`);
writeFileSync(join(OUT, "emblems.wad"), bytes);
for (const f of readdirSync(SVG_DIR)) if (f.endsWith(".svg") && !(f in svgs)) unlinkSync(join(SVG_DIR, f)); // the tool's own folder: stale designs go
for (const [f, text] of Object.entries(svgs)) writeFileSync(join(SVG_DIR, f), text);
const shown = (t, level = 0) => textureRgba(t, level);
for (const { texture: t } of textures) {
  const p = shown(t);
  writeFileSync(join(OUT, "png", `${t.name.replace(/[{~!+]/g, "_")}.png`), png(p.width, p.height, p.rgba));
}
const acceptOf = (entry) => ({
  ...(ACCEPT[entry.source.design.split(" ")[0]] ?? {}),
  ...(entry.accept ?? {}),
});
const report = {
  msrHue: HUE,
  photosMissing: [...missing].sort(),
  textures: textures.map(({ entry, texture: t }) => ({
    name: t.name,
    design: entry.source.design,
    size: [t.width, t.height],
    colours: t.stats.colours,
    holeShare: t.stats.holeShare,
    flags: t.stats.measures.flags,
    accept: acceptOf(entry),
    open: openFlags({ accept: acceptOf(entry) }, t.stats.measures),
  })),
  svg: Object.keys(svgs).sort(),
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");

// ── the review sheet ───────────────────────────────────────────────────────
const byDesign = new Map(textures.map(({ entry, texture }) => [entry.source.design, texture]));
const byName = new Map(textures.map(({ texture }) => [texture.name, texture]));
const TILE = 256;
const GAP = 12;
const HEAD = 22;
const marble = wall("Marble016", TILE, TILE, 0.16, [40, 38, 44]);
const crete = wall("Concrete033", TILE, TILE, 0.3, [96, 92, 86]);
/** A picture shown `k` times by nearest texel, centred in a cell `h` high over a background (holes see through). */
const cell = (pic, k, bg, h = TILE) => {
  const out = { width: TILE, height: h, rgba: new Uint8Array(TILE * h * 4) };
  const ox = Math.floor((TILE - pic.width * k) / 2);
  const oy = Math.floor((h - pic.height * k) / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < TILE; x++) {
      const o = (y * TILE + x) * 4;
      const b = ((y % TILE) * TILE + x) * 4;
      out.rgba.set(bg ? bg.rgba.subarray(b, b + 4) : [34, 32, 38, 255], o);
      const sx = Math.floor((x - ox) / k);
      const sy = Math.floor((y - oy) / k);
      if (sx < 0 || sy < 0 || sx >= pic.width || sy >= pic.height) continue;
      const s = (sy * pic.width + sx) * 4;
      const a = pic.rgba[s + 3] / 255;
      for (let c = 0; c < 3; c++)
        out.rgba[o + c] = Math.round(pic.rgba[s + c] * a + out.rgba[o + c] * (1 - a));
    }
  return out;
};
const named = (key) => byDesign.get(key) ?? byName.get(key);
const caption = (key) => `${named(key).name.replace(/[{~!]/g, (c) => ({ "{": "(", "~": "-", "!": "/" })[c])}`;
const rows = [];
const row = (title, cells, height = TILE) => rows.push({ title, cells: cells.filter(Boolean), height });
row("MSR FAMILY: B ASCENDANT MAIN, A BICEPHALUS FORMAL, C FOUNDRY SEAL", [
  ...Object.keys(MSR_VARIANTS).map((id) => [`${id.toUpperCase()} ${MSR_VARIANTS[id].name} VECTOR`, cell(svgPicture(svgs[`msr-${id}.svg`], TILE, TILE), 1, null)]), // prettier-ignore
  ...Object.keys(MSR_VARIANTS).map((id) => [
    `${id.toUpperCase()} STENCIL 128 X2`,
    cell(shown(extras[`stencil ${id}`]), 2, crete),
  ]),
]);
const eagle = ENTRIES.filter((e) => e.source.design.startsWith("emblem")).map((e) => byName.get(e.name));
row("THE EMBLEM IN THE KIT", [
  ...eagle.flatMap((t) =>
    t.width >= 256
      ? [[`${caption(t.name)} ON MARBLE`, cell(shown(t), 1, marble)]]
      : [
          [`${caption(t.name)} X2`, cell(shown(t), 2, marble)],
          ["ITS 64 MIP X4", cell(shown(t, 1), 4, marble)],
          ["ITS 32 MIP X4", cell(shown(t, 2), 4, marble)],
        ],
  ),
  ["GOLD ON DARK 128 X2 (EXTRA)", cell(shown(extras["plate b"]), 2, null)],
]);
const of = (prefix) =>
  ENTRIES.filter((e) => e.source.design.startsWith(prefix)).map((e) => byName.get(e.name));
row("BANNERS AND PLAQUE X2", [
  ...of("banner").map((t) => [caption(t.name), cell(shown(t), 2, marble, 520)]),
  ...of("plaque").map((t) => [caption(t.name), cell(shown(t), 2, marble, 520)]),
  ...of("plaque").map((t) => [`${caption(t.name)} 1:1`, cell(shown(t), 1, marble, 520)]),
], 520); // prettier-ignore
row(
  "POSTERS X2",
  of("poster").map((t) => [caption(t.name), cell(shown(t), 2, crete, 392)]),
  392,
);
row(
  "DEFACED X2",
  of("defaced").map((t) => [caption(t.name), cell(shown(t), 2, crete, 392)]),
  392,
);
row("POSTERS AND DEFACED AT 1:1", [...of("poster"), ...of("defaced")].map((t) => [caption(t.name), cell(shown(t), 1, crete, 200)]).slice(0, 12), 200); // prettier-ignore
row("INSURGENTS: 3 CLAW MAIN, 1 UPTURNED STENCIL", [
  ...of("mark").flatMap((t) =>
    t.width >= 128
      ? [
          [`${caption(t.name)} X2 CONCRETE`, cell(shown(t), 2, crete)],
          [`${caption(t.name)} X2 MARBLE`, cell(shown(t), 2, marble)],
        ]
      : [
          [`${caption(t.name)} X4`, cell(shown(t), 4, crete)],
          ["ITS 32 MIP X4", cell(shown(t, 1), 4, crete)],
        ],
  ),
]);
// a long row is broken into rows of at most COLS cells
const COLS = 6;
const laid = rows.flatMap((r) =>
  Array.from({ length: Math.ceil(r.cells.length / COLS) }, (_, k) => ({ ...r, title: k ? `${r.title} (CONT.)` : r.title, cells: r.cells.slice(k * COLS, (k + 1) * COLS) })),
); // prettier-ignore
const W = COLS * (TILE + GAP) + GAP;
const H = laid.reduce((s, r) => s + r.height + HEAD * 2 + GAP, GAP + 40);
const sheet = { width: W, height: H, rgba: new Uint8Array(W * H * 4) };
for (let i = 0; i < W * H; i++) sheet.rgba.set([18, 18, 22, 255], i * 4);
label(sheet, `NEW BYZANTIUM EMBLEMS  MSR HUE ${HUE}  ${textures.length} KIT TEXTURES${missing.size ? "  NO PHOTOS: " + [...missing].join(" ") : ""}`, GAP, 12, 3); // prettier-ignore
let y = 40 + GAP;
for (const r of laid) {
  label(sheet, r.title.toUpperCase(), GAP, y + 2, 3);
  r.cells.forEach(([cap, pic], i) => {
    const x = GAP + i * (TILE + GAP);
    label(sheet, cap.toUpperCase(), x, y + HEAD + 4, 2);
    for (let j = 0; j < pic.height; j++)
      sheet.rgba.set(
        pic.rgba.subarray(j * pic.width * 4, (j + 1) * pic.width * 4),
        ((y + HEAD * 2 + j) * W + x) * 4,
      );
  });
  y += r.height + HEAD * 2 + GAP;
}
writeFileSync(SHEET, png(W, H, sheet.rgba));
console.log(`${textures.length} kit textures, ${bytes.length} bytes -> ${join(OUT, "emblems.wad")}`);
console.log(`${Object.keys(svgs).length} SVG -> ${SVG_DIR}`);
console.log(`sheet -> ${SHEET}`);
if (missing.size)
  console.log(
    `no photo for ${[...missing].join(", ")}: drawn flat (fetch with node levels/tools/art-kit.mjs fetch)`,
  );
for (const r of report.textures) if (r.open.length) console.log(`  ${r.name}: ${r.open.join("; ")}`);
