#!/usr/bin/env node
// The art kit's textures: fetch the CC0 bases, build the WAD and its contact sheet, list what is left to paint.
//
//   node levels/tools/art-kit.mjs check  [--kit file]                     the manifest against GoldSrc's rules
//   node levels/tools/art-kit.mjs fetch  [--batch n] [--names a,b]        the CC0 bases into the cache
//   node levels/tools/art-kit.mjs build  [--batch n] [--names a,b] [--out dir] [--msr-hue deg] [--offline]
//   node levels/tools/art-kit.mjs bases  [--out dir]                      the cached bases side by side (choosing)
//   node levels/tools/art-kit.mjs paint                                   the paint list: what a painter makes
//
// The cache (`levels/art/cache/`, gitignored; `--cache dir` for another) holds each base's colour map as the
// provider gives it and `ledger.json`: provider, id, licence, page, download URL, sha256, bytes. Nothing from it
// is tracked; the manifest records each base's provider, id, URL and licence. ambientCG's maps come in a zip: only
// the colour map's entry is read from it, by HTTP ranges. Poly Haven's diffuse PNG is fetched alone.
// `build` writes newbyzantium.wad, newbyzantium-sheet.png, report.json, lights.rad and png/<name>.png to `--out`
// (default levels/art/out/, gitignored). The same manifest, bases and parameters give the same bytes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unpng, png } from "../../src/image.mjs";
import { textureRgba } from "../../src/maps/miptex.mjs";
import { readWad } from "../../src/maps/wad.mjs";
import {
  validateKit,
  pickTextures,
  recipeBases,
  makeTexture,
  buildKitWad,
  contactSheet,
  zipDirectory,
  zipEntryData,
  nameKind,
  openFlags,
} from "../lib/art-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = resolve(HERE, "../art");
const args = process.argv.slice(2);
const command = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const KIT_FILE = resolve(opt("kit", join(ART, "newbyzantium-kit.json")));
const CACHE = resolve(opt("cache", join(ART, "cache")));
const OUT = resolve(opt("out", join(ART, "out")));
const LEDGER = join(CACHE, "ledger.json");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const say = (s) => process.stdout.write(`${s}\n`);

function loadKit() {
  const kit = JSON.parse(readFileSync(KIT_FILE, "utf8"));
  const { errors, warnings, counts } = validateKit(kit);
  return { kit, errors, warnings, counts };
}
function picked(kit) {
  const names = opt("names")?.split(",");
  return pickTextures(kit, { batch: opt("batch"), names }).filter((t) => t.recipe);
}
const ledger = () => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {});
const baseFile = (key, base, map = "Color") => join(CACHE, base.provider, `${base.id}_${base.resolution ?? "1K"}_${map}.png`);
/** The maps a base brings: Color, and what its manifest entry lists (ambientCG's names: NormalGL, Displacement, AmbientOcclusion). */
const mapsOf = (base) => ["Color", ...(base.maps ?? []).filter((m) => m !== "Color")];

// ── fetching ───────────────────────────────────────────────────────────────
async function get(url, headers = {}) {
  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok && r.status !== 206) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
/** The maps asked for out of an ambientCG zip: the zip's end, then each entry by a range, nothing else. */
async function fetchAmbientCG(base, maps) {
  const res = base.resolution ?? "1K";
  const api = `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(base.id)}&include=downloadData`;
  const info = await (await get(api)).json();
  const asset = info.foundAssets?.find((a) => a.assetId === base.id);
  if (!asset) throw new Error(`ambientCG has no asset ${base.id}`);
  const downloads = Object.values(asset.downloadFolders ?? {}).flatMap((f) => Object.values(f.downloadFiletypeCategories ?? {}).flatMap((c) => c.downloads ?? []));
  const dl = downloads.find((d) => d.attribute === `${res}-PNG`);
  if (!dl) throw new Error(`ambientCG ${base.id} has no ${res}-PNG download`);
  const head = await fetch(dl.downloadLink, { method: "HEAD", redirect: "follow" });
  const size = Number(head.headers.get("content-length"));
  const file = head.url;
  const tailLength = Math.min(size, 65536);
  const tail = Buffer.from(await (await get(file, { Range: `bytes=${size - tailLength}-` })).arrayBuffer());
  const dir = zipDirectory(tail, size);
  const got = {};
  for (const map of maps) {
    const entry = dir.find((e) => e.name.toLowerCase().endsWith(`_${map.toLowerCase()}.png`));
    if (!entry) {
      if (map === "Color") throw new Error(`ambientCG ${base.id}'s zip has no *_Color.png`);
      got[map] = null; // not every material has every map (AO above all)
      continue;
    }
    const end = entry.local + 30 + entry.name.length + 1024 + entry.compressed;
    const local = Buffer.from(await (await get(file, { Range: `bytes=${entry.local}-${Math.min(size, end) - 1}` })).arrayBuffer());
    got[map] = { bytes: zipEntryData(local, entry), download: `${dl.downloadLink} (${entry.name})` };
  }
  return got;
}
/** Poly Haven's names for the maps. */
const POLYHAVEN_MAP = { Color: "Diffuse", NormalGL: "nor_gl", Displacement: "Displacement", AmbientOcclusion: "AO", Opacity: "Opacity" };
async function fetchPolyHaven(base, maps) {
  const res = (base.resolution ?? "1K").toLowerCase();
  const files = await (await get(`https://api.polyhaven.com/files/${encodeURIComponent(base.id)}`)).json();
  const got = {};
  for (const map of maps) {
    const url = files?.[POLYHAVEN_MAP[map]]?.[res]?.png?.url;
    if (!url) {
      if (map === "Color") throw new Error(`Poly Haven ${base.id} has no ${res} diffuse PNG`);
      got[map] = null;
      continue;
    }
    got[map] = { bytes: Buffer.from(await (await get(url)).arrayBuffer()), download: url };
  }
  return got;
}
/**
 * A base's maps from the cache, fetched first when missing: `{ Color: bytes, NormalGL: bytes | null, ... }`. A map
 * the provider does not have is kept in the ledger as null and not asked for again.
 */
async function ensureBase(key, base, { offline = false } = {}) {
  const l = ledger();
  const missing = mapsOf(base).filter((m) => !existsSync(baseFile(key, base, m)) && !(m !== "Color" && l[key]?.maps?.[m] === null));
  if (missing.length) {
    if (offline) throw new Error(`the base ${key} lacks ${missing.join(", ")} in the cache and --offline was given`);
    say(`fetch ${base.provider} ${base.id} ${missing.join(" ")} ...`);
    const got = base.provider === "ambientCG" ? await fetchAmbientCG(base, missing) : await fetchPolyHaven(base, missing);
    mkdirSync(join(CACHE, base.provider), { recursive: true });
    const rec = l[key] ?? { provider: base.provider, id: base.id, licence: base.licence, page: base.url };
    rec.maps = rec.maps ?? {};
    for (const [map, g] of Object.entries(got)) {
      if (!g) {
        rec.maps[map] = null;
        continue;
      }
      const file = baseFile(key, base, map);
      writeFileSync(file, g.bytes);
      const entry = { download: g.download, file: file.slice(CACHE.length + 1).split("\\").join("/"), sha256: sha256(g.bytes), bytes: g.bytes.length, fetched: new Date().toISOString().slice(0, 10) };
      if (map === "Color") Object.assign(rec, entry);
      else rec.maps[map] = entry;
    }
    l[key] = rec;
    writeFileSync(LEDGER, JSON.stringify(Object.fromEntries(Object.entries(l).sort()), null, 2) + "\n");
  }
  return Object.fromEntries(mapsOf(base).map((m) => [m, existsSync(baseFile(key, base, m)) ? readFileSync(baseFile(key, base, m)) : null]));
}

// ── commands ───────────────────────────────────────────────────────────────
async function main() {
  const { kit, errors, warnings, counts } = loadKit();
  if (command === "check" || !command) {
    for (const w of warnings) say(`warn  ${w}`);
    for (const e of errors) say(`FAIL  ${e}`);
    const total = kit.textures.length;
    const by = (k) => kit.textures.filter((t) => t.source?.kind === k).length;
    say(`${total} textures (${by("cc0")} from CC0 bases, ${by("paint")} to paint), ${Object.keys(kit.bases).length} bases; by theme: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    say(errors.length ? `FAIL (${errors.length})` : "PASS");
    process.exitCode = errors.length ? 1 : 0;
    return;
  }
  if (errors.length) {
    for (const e of errors) say(`FAIL  ${e}`);
    throw new Error("the manifest does not pass its check");
  }
  if (command === "paint") {
    const list = kit.textures.filter((t) => t.source.kind === "paint" && t.status !== "dropped");
    for (const t of list) say(`${t.name.padEnd(16)} ${`${t.size[0]}x${t.size[1]}`.padEnd(8)} ${t.theme.padEnd(10)} ${t.source.brief}${t.source.bases?.length ? `  [under: ${t.source.bases.join(", ")}]` : ""}`);
    say(`${list.length} to paint`);
    return;
  }
  if (command === "fetch") {
    const keys = opt("batch") || opt("names") ? [...new Set(picked(kit).flatMap((t) => recipeBases(t.recipe)))] : Object.keys(kit.bases);
    for (const k of keys) await ensureBase(k, kit.bases[k]);
    say(`${keys.length} bases in ${CACHE}`);
    return;
  }
  if (command === "bases") {
    // every cached base at 256 a side, named, for choosing
    const { tile } = await import("../../src/render.mjs");
    const pics = [];
    const names = [];
    for (const [k, b] of Object.entries(kit.bases)) {
      const f = baseFile(k, b, "Color");
      if (!existsSync(f)) continue;
      const p = unpng(readFileSync(f));
      const step = p.width / 256;
      const rgba = new Uint8Array(256 * 256 * 4);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) rgba.set(p.rgba.subarray(((Math.floor(y * step) * p.width) + Math.floor(x * step)) * 4, ((Math.floor(y * step) * p.width) + Math.floor(x * step)) * 4 + 4), (y * 256 + x) * 4);
      pics.push({ width: 256, height: 256, rgba });
      names.push(`${k} ${b.metres.join("X")}M`);
    }
    const sheet = tile(pics, 6, names);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "bases.png"), png(sheet.width, sheet.height, sheet.rgba));
    say(`${pics.length} bases drawn: ${join(OUT, "bases.png")}`);
    return;
  }
  if (command === "build") {
    const list = picked(kit);
    if (!list.length) throw new Error("no texture with a recipe is picked");
    const params = { ...kit.params };
    if (opt("msr-hue") !== undefined) params.msrHue = Number(opt("msr-hue"));
    const bases = {};
    for (const key of [...new Set(list.flatMap((t) => recipeBases(t.recipe)))]) {
      const b = kit.bases[key];
      const files = await ensureBase(key, b, { offline: flag("offline") });
      const maps = {};
      for (const [m, bytes] of Object.entries(files)) if (m !== "Color" && bytes) maps[m] = unpng(bytes);
      bases[key] = { picture: unpng(files.Color), metres: b.metres, maps };
    }
    const made = [];
    for (const t of list) {
      made.push(makeTexture(t, { bases, params }));
      const st = made.at(-1).stats;
      const m = st.measures;
      const open = openFlags(t, m);
      say(`made  ${t.name.padEnd(16)} ${t.size.join("x").padEnd(8)} brightness ${st.meanBrightness}  flat ${m.flatShare} straight ${m.straightEdges} repeat ${m.repeat} sat ${m.saturation}${open.length ? `  FLAG ${open.map((x) => x.split(":")[0]).join(",")}` : ""}${open.length < m.flags.length ? "  (accepted: " + Object.keys(t.accept).join(",") + ")" : ""}`);
    }
    const { bytes, problems } = buildKitWad(made);
    for (const p of problems) say(`FAIL  ${p}`);
    if (problems.length) throw new Error("the WAD does not read back as written");
    mkdirSync(join(OUT, "png"), { recursive: true });
    writeFileSync(join(OUT, "newbyzantium.wad"), bytes);
    const sheet = contactSheet(bytes, { notes: Object.fromEntries(made.map((t) => [t.name, `B${Math.round(t.stats.meanBrightness)}`])) });
    writeFileSync(join(OUT, "newbyzantium-sheet.png"), png(sheet.width, sheet.height, sheet.rgba));
    for (const t of readWad(bytes).textures) {
      const p = textureRgba(t, 0);
      writeFileSync(join(OUT, "png", `${t.name.replace(/[{~!+]/g, "_")}.png`), png(p.width, p.height, p.rgba));
    }
    // lights.rad: a lit texture's colour and strength, for the compiler (hlrad's texture lights)
    const rad = list.filter((t) => nameKind(t.name).lit && t.light).map((t) => `${t.name} ${t.light.join(" ")}`);
    writeFileSync(join(OUT, "lights.rad"), rad.join("\n") + (rad.length ? "\n" : ""));
    const l = ledger();
    const flagged = made.filter((t, i) => openFlags(list[i], t.stats.measures).length);
    say(`look: ${flagged.length ? `${flagged.length} read as programmer art: ${flagged.map((t) => t.name).join(", ")}` : "no texture flagged beyond what its entry accepts"}`);
    const report = {
      kit: KIT_FILE.slice(resolve(HERE, "../..").length + 1).replace(/\\/g, "/"),
      params,
      wad: { file: "newbyzantium.wad", bytes: bytes.length, sha256: sha256(bytes), textures: made.length },
      textures: made.map((t) => ({
        name: t.name,
        size: [t.width, t.height],
        ...t.stats,
        sources: recipeBases(list.find((e) => e.name === t.name).recipe).map((k) => ({ key: k, provider: kit.bases[k].provider, id: kit.bases[k].id, url: kit.bases[k].url, licence: kit.bases[k].licence, sha256: l[k]?.sha256 ?? null, maps: Object.fromEntries(Object.entries(l[k]?.maps ?? {}).map(([m, e]) => [m, e?.sha256 ?? null])) })),
      })),
    };
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
    say(`${made.length} textures, ${bytes.length} bytes: ${join(OUT, "newbyzantium.wad")}`);
    say(`contact sheet: ${join(OUT, "newbyzantium-sheet.png")}`);
    return;
  }
  throw new Error(`unknown command ${command}: check, fetch, build, bases or paint`);
}

main().catch((e) => {
  say(`art-kit: ${e.message}`);
  process.exitCode = 1;
});
