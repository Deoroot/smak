// The art kit's texture pipeline, without the network: the kit manifest checked, textures made from their
// recipes (src/maps/texture-recipe.mjs: CC0 photos at the texture's density, relief, weathering, baked light),
// cut down to 256 colours, measured for programmer art, and written to a WAD3 with its four mip levels; a contact
// sheet.
//
//   the manifest       KIT_FORMAT validateKit nameProblems kitTextures pickTextures
//   a texture made     makeTexture (recipe -> picture -> palette -> mips, with its measures)
//   the WAD            buildKitWad (textures -> bytes, read back and checked)  verifyKitWad
//   pictures           contactSheet
//   zip files          zipDirectory zipEntryData (ambientCG ships its maps in a zip; the tool reads one entry)
//
// The manifest's format is in levels/art/README.md. Everything here is deterministic: the same manifest, the
// same base pictures and the same parameters give the same bytes.
import { inflateRawSync } from "node:zlib";
import { mipsOf, textureRgba, LONGEST_NAME, TEXTURE_GRID, HOLE, MIP_LEVELS, miptexSize } from "../../src/maps/miptex.mjs";
import { composeTexture, quantize, textureMeasures, recipeProblems, MASK_KEY } from "../../src/maps/texture-recipe.mjs";
// the general part (recipes, colours, the measure) lives in src/maps/texture-recipe.mjs; re-exported for the kit
export { composeTexture, quantize, textureMeasures, recipeProblems, photoFit, seamlessCrop, linearOf, withParams, hexColour, hash01, MASK_KEY, UNIT_METRES, RECIPE_OPS, PROGRAMMER_ART } from "../../src/maps/texture-recipe.mjs";
import { writeWad, readWad } from "../../src/maps/wad.mjs";
import { label } from "../../src/render.mjs";

export const KIT_FORMAT = "smak-art-kit/1";
const STATUSES = ["planned", "built", "approved", "dropped"];
const SOURCE_KINDS = ["cc0", "paint"];
const PROVIDERS = { ambientCG: "https://ambientcg.com/view?id=", PolyHaven: "https://polyhaven.com/a/" };
const LICENCES = ["CC0-1.0"];
/** The maps besides the colour a base may bring (ambientCG's names): normals, height and occlusion for the bake. */
const BASE_MAPS = ["NormalGL", "Displacement", "AmbientOcclusion", "Opacity"];
/** The first word of each of textureMeasures' flags: a texture may accept one, with its reason (bars repeat). */
export const LOOK_FLAGS = ["flat", "ruled", "repeats", "loud"];
/** A texture's measured flags less those its entry accepts. */
export const openFlags = (entry, measures) => measures.flags.filter((f) => !(entry.accept ?? {})[f.split(":")[0]]);
/** Sides the engine and the kit's budget take; 512 is allowed but flagged. */
const SIDE_MOST = 512;

// ── names ──────────────────────────────────────────────────────────────────
/**
 * What GoldSrc's rules say against a texture's name and size: a list of sentences, empty when it is fine.
 * Rules: 1-15 characters of [a-z0-9_-] after its prefix; `{` masked, `~` light-emitting (anywhere is legal, the
 * kit puts it first), `+0`..`+9` / `+a`..`+j` an animation frame, `!` a liquid; a liquid may not be masked or an
 * animation's frame; sides multiples of 16, at most 512.
 */
export function nameProblems(name, { width, height } = {}) {
  const out = [];
  if (typeof name !== "string" || !name) return ["a texture needs a name"];
  if (name.length > LONGEST_NAME) out.push(`${name} is ${name.length} characters: GoldSrc keeps ${LONGEST_NAME} at most`);
  if (name !== name.toLowerCase()) out.push(`${name} has capitals: the kit's names are lower case (the engine folds case, the tools may not)`);
  const m = /^(\{|!|~|\+[0-9a-j])?(.*)$/.exec(name);
  const body = m[2];
  if (!body) out.push(`${name} has a prefix and nothing after it`);
  else if (!/^[a-z0-9_~-]+$/i.test(body)) out.push(`${name} has a character other than letters, digits, _ - ~ after its prefix`);
  if (/^[{!~+]/.test(body)) out.push(`${name} has two prefixes: masked, liquid, lit and animated do not combine that way`);
  if (name.startsWith("+") && !/^\+[0-9a-j]/.test(name)) out.push(`${name} starts with + but not +0..+9 or +a..+j: not an animation frame`);
  if (name.startsWith("!") && name.length < 2) out.push(`${name} is a liquid with no name`);
  if (width !== undefined || height !== undefined) {
    for (const [side, v] of [["width", width], ["height", height]]) {
      if (!Number.isInteger(v) || v <= 0) out.push(`${name}'s ${side} ${v} is not a whole number of texels`);
      else if (v % TEXTURE_GRID) out.push(`${name}'s ${side} ${v} is not a multiple of ${TEXTURE_GRID}: the engine refuses it`);
      else if (v > SIDE_MOST) out.push(`${name}'s ${side} ${v} is over ${SIDE_MOST}`);
    }
  }
  return out;
}
/** What the name says the texture is: masked, lit, liquid, animated (its frame), or plain. */
export const nameKind = (name) => ({
  masked: name.startsWith("{"),
  lit: name.startsWith("~"),
  liquid: name.startsWith("!"),
  frame: /^\+[0-9a-j]/.test(name) ? name[1] : null,
});

// ── the manifest ───────────────────────────────────────────────────────────
/** Every texture of a kit, flattened, in the manifest's order. */
export const kitTextures = (kit) => kit.textures ?? [];
/** The kit's textures picked by `{ batch, names, status }` (each optional). */
export function pickTextures(kit, { batch, names, status } = {}) {
  return kitTextures(kit).filter(
    (t) =>
      (batch === undefined || String(t.batch) === String(batch)) &&
      (!names || names.includes(t.name)) &&
      (!status || t.status === status),
  );
}
/** The base keys a recipe reads, in order and each once. */
export function recipeBases(recipe = []) {
  const keys = [];
  const add = (k) => k && !keys.includes(k) && keys.push(k);
  for (const op of recipe) {
    add(op.photo);
    if (op.fill?.photo) add(op.fill.photo);
    for (const b of op.bands ?? []) if (b[2]?.photo) add(b[2].photo);
    if (op.op === "weather") {
      add(op.rustPhoto);
      add(op.noise);
    }
  }
  return keys;
}
/**
 * The manifest checked: `{ errors, warnings, counts }`. Errors: the format, a texture's name or size against the
 * engine's rules, a name given twice (whatever its case), a theme or status unknown, a source that is neither a
 * CC0 base with its provider, id, URL and licence, nor a painter's brief; a recipe's base not in `bases`; a
 * masked texture whose recipe never makes a hole. Warnings: a texture over 256 a side, a CC0 texture with no
 * recipe yet.
 */
export function validateKit(kit) {
  const errors = [];
  const warnings = [];
  if (!kit || kit.format !== KIT_FORMAT) errors.push(`the kit's format is ${kit?.format}, not ${KIT_FORMAT}`);
  const themes = kit?.themes ?? {};
  const bases = kit?.bases ?? {};
  for (const [key, b] of Object.entries(bases)) {
    if (!PROVIDERS[b.provider]) errors.push(`base ${key}: provider ${b.provider} is not one of ${Object.keys(PROVIDERS).join(", ")}`);
    if (!b.id) errors.push(`base ${key}: no asset id`);
    if (!LICENCES.includes(b.licence)) errors.push(`base ${key}: licence ${b.licence} is not ${LICENCES.join(" or ")}`);
    if (!b.url || (PROVIDERS[b.provider] && !String(b.url).startsWith(PROVIDERS[b.provider])))
      errors.push(`base ${key}: its URL ${b.url} is not the provider's page for it`);
    for (const m of b.maps ?? []) if (!BASE_MAPS.includes(m)) errors.push(`base ${key}: map ${m} is not one of ${BASE_MAPS.join(", ")}`);
    if (!Array.isArray(b.metres) || b.metres.length !== 2 || !b.metres.every((v) => v > 0))
      errors.push(`base ${key}: metres [w, h], the photo's size in the world, is missing`);
  }
  const seen = new Map();
  for (const t of kitTextures(kit)) {
    const where = `texture ${t.name}`;
    const [width, height] = Array.isArray(t.size) ? t.size : [];
    for (const p of nameProblems(t.name, { width, height })) errors.push(p);
    const low = String(t.name).toLowerCase();
    if (seen.has(low)) errors.push(`${where} is given twice (the engine only ever finds the first)`);
    seen.set(low, t);
    if (!themes[t.theme]) errors.push(`${where}: theme ${t.theme} is not one of the kit's themes`);
    if (!STATUSES.includes(t.status)) errors.push(`${where}: status ${t.status} is not one of ${STATUSES.join(", ")}`);
    if (!t.brief) errors.push(`${where} has no brief`);
    if (!Array.isArray(t.serves) || !t.serves.length) errors.push(`${where} serves no material or role`);
    const s = t.source ?? {};
    if (!SOURCE_KINDS.includes(s.kind)) errors.push(`${where}: source kind ${s.kind} is not cc0 or paint`);
    for (const k of s.bases ?? []) if (!bases[k]) errors.push(`${where}: base ${k} is not in the kit's bases`);
    if (s.kind === "cc0" && !(s.bases ?? []).length) {
      if (!(s.families ?? []).length) errors.push(`${where} is cc0 with no base`);
      else if (t.status !== "planned") errors.push(`${where} is cc0 with only a family (${s.families.join(", ")}): its base must be chosen before it is ${t.status}`);
    }
    if (s.kind === "paint" && !s.brief) errors.push(`${where} is to be painted with no painter's brief`);
    if (t.recipe) {
      for (const p of recipeProblems(t.recipe, where)) errors.push(p);
      for (const k of recipeBases(t.recipe)) {
        if (!bases[k]) errors.push(`${where}: its recipe reads base ${k}, not in the kit's bases`);
        else if (!(s.bases ?? []).includes(k)) errors.push(`${where}: its recipe reads base ${k}, not listed in its source`);
      }
      const holes = t.recipe.some((op) => op.op === "clear" || op.op === "alpha");
      if (t.name.startsWith("{") && !holes) errors.push(`${where} is masked ({) and its recipe never clears a hole`);
      if (!t.name.startsWith("{") && holes) errors.push(`${where} clears holes but its name does not begin with {`);
    } else if (s.kind === "cc0") warnings.push(`${where}: cc0 with no recipe yet`);
    if (t.status === "built" && !t.recipe) errors.push(`${where} is built with no recipe`);
    for (const [k, why] of Object.entries(t.accept ?? {})) {
      if (!LOOK_FLAGS.includes(k)) errors.push(`${where}: accept ${k} is not one of the measures' flags (${LOOK_FLAGS.join(", ")})`);
      if (typeof why !== "string" || !why) errors.push(`${where}: accepting ${k} needs a reason`);
    }
    if ((width ?? 0) > 256 || (height ?? 0) > 256) warnings.push(`${where} is over 256 a side`);
  }
  const counts = {};
  for (const t of kitTextures(kit)) counts[t.theme] = (counts[t.theme] ?? 0) + 1;
  return { errors, warnings, counts };
}
/** A recipe's values with `$param` strings replaced from `params` (the MSR's hue, for one). */
export function makeTexture(entry, { bases, params = {}, supersample = 4, dither } = {}) {
  const [width, height] = entry.size;
  const problems = nameProblems(entry.name, { width, height });
  if (problems.length) throw new Error(problems.join("; "));
  const picture = composeTexture(entry.recipe, { width, height, bases, params, supersample, seed: entry.name });
  const masked = entry.name.startsWith("{");
  const q = quantize(picture, { masked, dither: dither ?? entry.dither ?? 0 });
  const texture = { name: entry.name, width, height, pixels: q.pixels, palette: q.palette };
  const mips = mipsOf(texture, masked);
  let err = 0;
  let solid = 0;
  let bright = 0;
  for (let i = 0; i < width * height; i++) {
    if (masked && q.pixels[i] === HOLE) continue;
    solid++;
    for (let c = 0; c < 3; c++) err += Math.abs(picture.rgba[i * 4 + c] - q.palette[q.pixels[i] * 3 + c]);
    bright += 0.2126 * picture.rgba[i * 4] + 0.7152 * picture.rgba[i * 4 + 1] + 0.0722 * picture.rgba[i * 4 + 2];
  }
  // the measures are of what the WAD holds: the palette's colours, the holes see-through
  const shown = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    shown.set(q.palette.subarray(q.pixels[i] * 3, q.pixels[i] * 3 + 3), i * 4);
    shown[i * 4 + 3] = masked && q.pixels[i] === HOLE ? 0 : 255;
  }
  return {
    ...texture,
    pixels: mips[0],
    mips,
    holes: masked,
    picture,
    stats: {
      meanBrightness: +(bright / Math.max(1, solid)).toFixed(1),
      colours: q.colours,
      paletteError: +(err / Math.max(1, solid * 3)).toFixed(2),
      holeShare: +(1 - solid / (width * height)).toFixed(3),
      fits: picture.fits,
      measures: textureMeasures({ width, height, rgba: shown }),
    },
  };
}

// ── the WAD ────────────────────────────────────────────────────────────────
/**
 * The WAD's own check, read back with SMAK's reader: every texture by name and size, its four mips at a half,
 * a quarter and an eighth, the bytes per texture as miptexSize says, a masked texture's index 255 pure blue and
 * a plain texture holding no hole. Returns a list of sentences, empty when the file is right.
 */
export function verifyKitWad(bytes, expected) {
  const out = [];
  let wad;
  try {
    wad = readWad(bytes);
  } catch (e) {
    return [`the WAD does not read back: ${e.message}`];
  }
  if (wad.textures.length !== expected.length) out.push(`the WAD holds ${wad.textures.length} textures, not ${expected.length}`);
  for (const want of expected) {
    const got = wad.textures.find((t) => t.name.toLowerCase() === want.name.toLowerCase());
    if (!got) {
      out.push(`${want.name} is not in the WAD`);
      continue;
    }
    if (got.width !== want.width || got.height !== want.height) out.push(`${want.name} reads back ${got.width}x${got.height}, not ${want.width}x${want.height}`);
    if (got.mips.length !== MIP_LEVELS) out.push(`${want.name} has ${got.mips.length} mip levels, not ${MIP_LEVELS}`);
    got.mips.forEach((m, l) => {
      if (m.length !== (want.width >> l) * (want.height >> l)) out.push(`${want.name}'s mip ${l} has ${m.length} pixels, not ${(want.width >> l) * (want.height >> l)}`);
    });
    if (want.pixels && Buffer.compare(Buffer.from(got.pixels), Buffer.from(want.pixels)) !== 0) out.push(`${want.name}'s pixels read back changed`);
    const last = got.palette.subarray(HOLE * 3, HOLE * 3 + 3);
    const holes = got.pixels.some((p) => p === HOLE);
    if (want.name.startsWith("{")) {
      if (!(last[0] === 0 && last[1] === 0 && last[2] === 255)) out.push(`${want.name} is masked but its index 255 is ${[...last].join(",")}, not pure blue 0,0,255`);
      if (!holes) out.push(`${want.name} is masked and has no hole`);
    }
  }
  const size = expected.reduce((s, t) => s + miptexSize(t.width, t.height) + ((4 - (miptexSize(t.width, t.height) % 4)) % 4), 12 + 32 * expected.length);
  if (bytes.length !== size) out.push(`the WAD is ${bytes.length} bytes, not the ${size} its textures make`);
  return out;
}
/** The WAD of made textures, read back and verified: `{ bytes, problems }`. */
export function buildKitWad(textures) {
  const bytes = writeWad(textures.map(({ name, width, height, pixels, palette, mips }) => ({ name, width, height, pixels, palette, mips })));
  return { bytes, problems: verifyKitWad(bytes, textures) };
}

// ── the contact sheet ──────────────────────────────────────────────────────
const SHEET_CELL = 384;
const SHEET_GUTTER = 40;
const SHEET_BAND = 18;
/**
 * A contact sheet of a WAD's textures, at their game scale: each cell is SHEET_CELL x SHEET_CELL units of a
 * wall at texture scale 1, the texture tiled across it (so seams and density show), holes over a teal checker
 * of 32 units; in the gutter a player, 72 units high and 32 wide, at the same scale. Labelled with the name, the
 * size and the mean brightness. Returns `{ width, height, rgba }`.
 */
export function contactSheet(wadBytes, { cols = 4, notes = {} } = {}) {
  const { textures } = readWad(wadBytes);
  const cw = SHEET_CELL + SHEET_GUTTER;
  const ch = SHEET_CELL + SHEET_BAND;
  const rows = Math.ceil(textures.length / cols);
  const width = cols * cw + 8;
  const height = rows * ch + 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([24, 26, 30, 255], i * 4);
  const img = { width, height, rgba };
  textures.forEach((t, n) => {
    const pic = textureRgba(t, 0);
    const left = 4 + (n % cols) * cw;
    const top = 4 + Math.floor(n / cols) * ch;
    for (let y = 0; y < SHEET_CELL; y++)
      for (let x = 0; x < SHEET_CELL; x++) {
        const s = ((y % t.height) * t.width + (x % t.width)) * 4;
        const o = ((top + SHEET_BAND + y) * width + left + x) * 4;
        if (pic.rgba[s + 3] < 128) {
          // holes in a colour no texture of the kit has, so a bar is told from the gap behind it
          rgba.set(((x >> 5) + (y >> 5)) & 1 ? [36, 96, 112, 255] : [24, 70, 84, 255], o);
        } else rgba.set([pic.rgba[s], pic.rgba[s + 1], pic.rgba[s + 2], 255], o);
      }
    // the player for scale: 32 x 72 units, feet on the cell's bottom
    const px = left + SHEET_CELL + 4;
    const py = top + SHEET_BAND + SHEET_CELL - 72;
    for (let y = 0; y < 72; y++)
      for (let x = 0; x < 32; x++) {
        const head = y < 14 && (x < 9 || x > 22);
        if (!head) rgba.set([200, 170, 60, 255], ((py + y) * width + px + x) * 4);
      }
    const note = notes[t.name] ? ` ${notes[t.name]}` : "";
    label(img, `${t.name.replace(/[{~!+]/g, (c) => ({ "{": "(", "~": "-", "!": "/", "+": "+" })[c])} ${t.width}X${t.height}${note}`, left + 2, top + 4, 2);
  });
  return img;
}

// ── zip files (ambientCG's downloads) ──────────────────────────────────────
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/**
 * The entries of a zip from its last bytes: `tail` is the file's last `tail.length` bytes, `size` the whole file's.
 * Returns `[{ name, method, compressed, size, local }]` (`local`: where the entry's local header begins in the
 * file). Throws, in words, when the tail holds no end record or the directory does not fit in it.
 */
export function zipDirectory(tail, size) {
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  if (at < 0) throw new Error("not a zip file: no end-of-directory record in its last bytes");
  const count = tail.readUInt16LE(at + 10);
  const dirSize = tail.readUInt32LE(at + 12);
  const dirOffset = tail.readUInt32LE(at + 16);
  const tailStart = size - tail.length;
  let p = dirOffset - tailStart;
  if (p < 0 || p + dirSize > tail.length) throw new Error("the zip's directory is not in the bytes read: read more of its end");
  const out = [];
  for (let k = 0; k < count; k++) {
    if (tail.readUInt32LE(p) !== CENTRAL) throw new Error(`the zip's directory entry ${k} is broken`);
    const method = tail.readUInt16LE(p + 10);
    const compressed = tail.readUInt32LE(p + 20);
    const usize = tail.readUInt32LE(p + 24);
    const nameLen = tail.readUInt16LE(p + 28);
    const extra = tail.readUInt16LE(p + 30);
    const comment = tail.readUInt16LE(p + 32);
    const local = tail.readUInt32LE(p + 42);
    out.push({ name: tail.toString("utf8", p + 46, p + 46 + nameLen), method, compressed, size: usize, local });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
/** One entry's data from the bytes starting at its local header: stored or deflated, checked for its size. */
export function zipEntryData(bytes, entry) {
  if (bytes.readUInt32LE(0) !== LOCAL) throw new Error(`the zip entry ${entry.name} has no local header where its directory says`);
  const start = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  const raw = bytes.subarray(start, start + entry.compressed);
  if (raw.length < entry.compressed) throw new Error(`the zip entry ${entry.name} is cut short`);
  let data;
  if (entry.method === 0) data = Buffer.from(raw);
  else if (entry.method === 8) data = inflateRawSync(raw);
  else throw new Error(`the zip entry ${entry.name} is packed by method ${entry.method}: only stored (0) and deflate (8) are read`);
  if (data.length !== entry.size) throw new Error(`the zip entry ${entry.name} unpacks to ${data.length} bytes, not ${entry.size}`);
  return data;
}
