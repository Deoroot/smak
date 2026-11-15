// Two libraries of photographed and scanned materials, both CC0 and both open with no key (README.md, "The
// terms"): ambientCG (api/v3/assets; a set is a zip of JPEGs) and Poly Haven (its textures, through the client of
// packs/assets). Searched together, and one material's set downloaded once into a cache outside any repository.
//
//   materialList(source, { cache, ask })        every material of a library, kept a week: { list, from }
//   searchMaterials(lists, words)               the materials that hold every word, best first, of both
//   materialLine(found)                         one line of a search: id, name, tags, the real size a tile covers, maps
//   downloadSet(source, id, { cache, ask })     the set at 1K into cache/<source>/<id>: colour, normal, roughness...
//   unzip(bytes, wanted)                        the files of a zip whose names `wanted` takes (stored or deflated)
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { API as PH_API, askNetwork, assetList, searchAssets } from "../assets/polyhaven.mjs";

export const ACG_API = "https://ambientcg.com/api/v3/assets";
export const USER_AGENT = "SMAK-materials-pack/1.3 (+https://github.com/Deoroot/smak)";
/** What is printed wherever the live APIs' content is shown (Poly Haven's ToS 2.5; ambientCG asks a credit, gladly). */
export const CREDITS = {
  ambientcg: "Materials from ambientCG.com, CC0 1.0",
  polyhaven: "Powered by Poly Haven (polyhaven.com): textures CC0",
};
export const SOURCES = Object.keys(CREDITS);
/** Where the lists and the sets are kept unless told: the system's temp folder, never a repository. */
export const DEFAULT_CACHE = join(tmpdir(), "smak", "materials");
const LIST_KEPT_MS = 7 * 24 * 3600 * 1000;
/** ambientCG's API gives at most 500 a page (docs.ambientcg.com/api/v3/assets). */
const PAGE = 500;
const ask0 = (url) => askNetwork(url, USER_AGENT);
const json = async (ask, url) => JSON.parse((await ask(url)).toString("utf8"));

/**
 * Every material of `source` as { id: { type: 1, name, tags, categories, metres, maps, made, zip } }, kept in
 * cache/<source>.json for a week. ambientCG's `dimensions` are centimetres (its page for MetalPlates013 says
 * "ca. 1.6 m x 1.6 m" where the API says 160), 0 when not measured; Poly Haven's are millimetres. `made`: ambientCG's
 * technique (surface-photogrammetry, surface-approximated: from photographs; surface-fully-procedural: drawn by a
 * program, which the owner has turned down as "AI textures"); Poly Haven's textures are all scanned.
 */
export async function materialList(source, { cache = DEFAULT_CACHE, ask = ask0 } = {}) {
  if (source === "polyhaven") {
    const { list, from } = await assetList({ cache, ask, kind: "textures" });
    for (const asset of Object.values(list)) asset.metres = asset.dimensions?.length === 2 ? asset.dimensions.map((mm) => mm / 1000) : null; // prettier-ignore
    return { list, from };
  }
  if (source !== "ambientcg") throw new Error(`--source ambientcg or polyhaven, not ${source}`);
  const kept = join(cache, "ambientcg.json");
  if (existsSync(kept) && Date.now() - statSync(kept).mtimeMs < LIST_KEPT_MS)
    return { list: JSON.parse(readFileSync(kept, "utf8")), from: kept };
  const list = {};
  for (let offset = 0, total = 1; offset < total; offset += PAGE) {
    const page = await json(ask, `${ACG_API}?type=material&sort=popular&limit=${PAGE}&offset=${offset}&include=title,tags,dimensions,maps,downloads,technique`); // prettier-ignore
    total = page.totalResults ?? 0;
    for (const a of page.assets ?? []) {
      const zip = (a.downloads ?? []).find((d) => d.attributes === "1K-JPG");
      const cm = [a.dimensions?.width, a.dimensions?.height];
      list[a.id] = { type: 1, name: a.title ?? a.id, tags: a.tags ?? [], categories: [], maps: a.maps ?? [], made: a.technique ?? null, metres: cm[0] > 0 && cm[1] > 0 ? cm.map((v) => v / 100) : null, zip: zip && { url: zip.url, size: zip.size } }; // prettier-ignore
    }
    if (!page.assets?.length) break;
  }
  mkdirSync(cache, { recursive: true });
  writeFileSync(kept, JSON.stringify(list));
  return { list, from: `${ACG_API}?type=material (kept in ${kept})` };
}

/** The materials of `lists` ({ source: list }) holding every one of `words`, best first: [{ source, id, asset, score }]. */
export function searchMaterials(lists, words) {
  const found = Object.entries(lists).flatMap(([source, list]) => searchAssets(list, words, { type: 1 }).map((f) => ({ source, ...f }))); // prettier-ignore
  return found.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** One line of a search: the library, the id, the name, the tags, the real size a tile covers, the maps of the set. */
export function materialLine({ source, id, asset }) {
  const size = asset.metres ? `a tile ${asset.metres.map((m) => m.toFixed(2)).join(" x ")} m (${asset.metres.map((m) => Math.round(m * 39.37)).join(" x ")} units)` : "size not given"; // prettier-ignore
  const maps = asset.maps?.length ? asset.maps.join(", ") : "color, normal, roughness, ambient-occlusion (and metal where it is one), said by /files on download"; // prettier-ignore
  return [`${source}:${id}`, `"${asset.name ?? id}"`, ...(asset.made ? [`made by ${asset.made}`] : []), `tags: ${(asset.tags ?? []).map((t) => t.trim()).join(", ")}`, size, `maps: ${maps}`].join("  "); // prettier-ignore
}

// ── a zip, read as far as a library's set needs (stored or deflated; no zip64, no encryption) ──
const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** The files of a zip whose names `wanted(name)` takes: { name: bytes }. Throws, in words, for what it cannot read. */
export function unzip(bytes, wanted = () => true) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff) && end < 0; at--) if (bytes.readUInt32LE(at) === END) end = at; // prettier-ignore
  if (end < 0) throw new Error("not a zip file: it has no end of central directory");
  const files = {};
  for (let k = 0, at = bytes.readUInt32LE(end + 16); k < bytes.readUInt16LE(end + 10); k++) {
    if (bytes.readUInt32LE(at) !== CENTRAL) throw new Error("the zip's central directory is broken");
    const [method, flags, size, local] = [bytes.readUInt16LE(at + 10), bytes.readUInt16LE(at + 8), bytes.readUInt32LE(at + 20), bytes.readUInt32LE(at + 42)]; // prettier-ignore
    const name = bytes.toString("utf8", at + 46, at + 46 + bytes.readUInt16LE(at + 28));
    at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    if (!wanted(name)) continue;
    if (flags & 1) throw new Error(`${name} is encrypted in the zip`);
    if (bytes.readUInt32LE(local) !== LOCAL) throw new Error(`the zip's entry for ${name} is broken`);
    const from = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(from, from + size);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = inflateRawSync(data);
    else throw new Error(`${name} is packed by method ${method}: only stored (0) and deflated (8) are read`);
  }
  return files;
}

/** The maps a set may have, as each library names its files at 1K: the part of the name after the id. */
const MAPS = {
  ambientcg: { color: "Color", normal: "NormalGL", normalDX: "NormalDX", roughness: "Roughness", metalness: "Metalness", occlusion: "AmbientOcclusion", opacity: "Opacity" }, // prettier-ignore
  polyhaven: { color: "Diffuse", normal: "nor_gl", normalDX: "nor_dx", roughness: "Rough", metalness: "Metal", occlusion: "AO", opacity: "opacity" }, // prettier-ignore
};

/**
 * One material's set at 1K into cache/<source>/<id>: { source, id, name, url, metres, authors, files: { color,
 * normal, roughness, metalness, occlusion, opacity: path }, normalFrom: "opengl" | "directx", fetched, kept }.
 * OpenGL's normal is taken where the library ships it (both do, beside DirectX's); DirectX's only when it is
 * alone (material.mjs turns it). A file already in the cache at its size is not asked again.
 */
export async function downloadSet(source, id, { cache = DEFAULT_CACHE, ask = ask0, list } = {}) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(`${id} is not a material's id (letters, digits, _ and -): search for one`); // prettier-ignore
  const { list: all } = list ? { list } : await materialList(source, { cache, ask });
  const asset = all[id];
  if (!asset) throw new Error(`${source} has no material ${id}: search for one (node packs/materials/bin.mjs search <words>)`); // prettier-ignore
  const folder = join(cache, source, id);
  mkdirSync(folder, { recursive: true });
  const [fetched, kept, files] = [[], [], {}];
  const get = async (url, to, size) => {
    if (existsSync(to) && (size === undefined || statSync(to).size === size)) return kept.push(to);
    writeFileSync(to, await ask(url));
    fetched.push(to);
  };
  let authors = {};
  if (source === "ambientcg") {
    if (!asset.zip) throw new Error(`ambientCG has no 1K-JPG zip for ${id}`);
    const zip = join(folder, `${id}_1K-JPG.zip`);
    await get(asset.zip.url, zip, asset.zip.size);
    const want = Object.values(MAPS.ambientcg);
    const named = (name) => want.find((map) => new RegExp(`^${id}_1K(-JPG)?_${map}\\.(jpg|png)$`).test(name.split("/").pop()));
    for (const [name, bytes] of Object.entries(unzip(readFileSync(zip), named))) {
      const to = join(folder, name.split("/").pop());
      if (!existsSync(to)) writeFileSync(to, bytes);
      files[Object.keys(MAPS.ambientcg).find((k) => MAPS.ambientcg[k] === named(name))] = to;
    }
  } else {
    const listed = await json(ask, `${PH_API}/files/${id}`);
    authors = (await json(ask, `${PH_API}/info/${id}`)).authors ?? {};
    for (const [key, map] of Object.entries(MAPS.polyhaven)) {
      const at = listed[map]?.["1k"];
      const file = at?.jpg ?? at?.png;
      if (!file) continue;
      const to = join(folder, `${id}_${map}_1k.${at.jpg ? "jpg" : "png"}`);
      await get(file.url, to, file.size);
      files[key] = to;
    }
  }
  if (!files.color) throw new Error(`${source}:${id} has no colour map at 1K`);
  const normalFrom = files.normal ? "opengl" : files.normalDX ? "directx" : null;
  if (!files.normal && files.normalDX) files.normal = files.normalDX;
  delete files.normalDX;
  const url = source === "ambientcg" ? `https://ambientcg.com/a/${id}` : `https://polyhaven.com/a/${id}`;
  return { source, id, name: asset.name ?? id, url, metres: asset.metres ?? null, made: asset.made ?? null, authors, files, normalFrom, fetched, kept }; // prettier-ignore
}
