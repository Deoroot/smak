// Poly Haven's public API (https://api.polyhaven.com, no key): the list of its models searched, one asset's
// information, and its glTF at 1k downloaded into a cache folder outside any repository (README.md).
//
//   assetList({ cache, ask })          every model { id: asset }, cached in `cache` for a week
//   searchAssets(list, words)          the models whose id, name, tags or categories hold every word, best first
//   assetLine(id, asset)               one line of a search: id, name, categories, tags, size, polycount
//   assetInfo(id, { ask })             /info/<id>, refused with a sentence when it is not a model
//   downloadGltf(id, { cache, ask })   the .gltf at 1k, its .bin and its base colour pictures, into cache/<id>/1k
//
// The terms (github.com/Poly-Haven/Public-API, ToS.md 2.4 and 2.5): every call names this software in its
// User-Agent, and what is shown from the live API says it is Poly Haven's ("Powered by Poly Haven").
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

export const API = "https://api.polyhaven.com";
export const USER_AGENT = "SMAK-assets-pack/1.2 (+https://github.com/Deoroot/smak)";
export const CREDIT = "Powered by Poly Haven (polyhaven.com): models CC0";
/** Where the list and the downloads are kept unless told: the system's temp folder, never a repository. */
export const DEFAULT_CACHE = join(tmpdir(), "smak", "assets");
/** The list is asked again when the copy kept is older than this. */
const LIST_KEPT_MS = 7 * 24 * 3600 * 1000;
const RESOLUTION = "1k";

/** The network asked with a pack's own User-Agent (this one's unless told): the bytes, or an Error whose message is a sentence. */
export async function askNetwork(url, agent = USER_AGENT) {
  let answer;
  try {
    answer = await fetch(url, { headers: { "User-Agent": agent } });
  } catch (error) {
    throw new Error(
      `${new URL(url).host} could not be reached (${error.cause?.code ?? error.message}): is the machine online?`,
    );
  }
  if (answer.status === 404) throw Object.assign(new Error(`${url} is not there (404)`), { status: 404 });
  if (!answer.ok)
    throw new Error(`${new URL(url).host} answered ${answer.status} ${answer.statusText} for ${url}`);
  return Buffer.from(await answer.arrayBuffer());
}
const json = async (ask, path) => JSON.parse((await ask(`${API}${path}`)).toString("utf8"));

/** Every model on Poly Haven (or every one of `kind`: "textures" for packs/materials), { id: asset }: from `cache`/<kind>.json when it is under a week old. */
export async function assetList({ cache = DEFAULT_CACHE, ask = askNetwork, kind = "models" } = {}) {
  const kept = join(cache, `${kind}.json`);
  if (existsSync(kept) && Date.now() - statSync(kept).mtimeMs < LIST_KEPT_MS)
    return { list: JSON.parse(readFileSync(kept, "utf8")), from: kept };
  const list = await json(ask, `/assets?t=${kind}`);
  mkdirSync(cache, { recursive: true });
  writeFileSync(kept, JSON.stringify(list));
  return { list, from: `${API}/assets?t=${kind} (kept in ${kept})` };
}

/** The words a search is matched on, in small letters, and how much a word found in each weighs. */
const FIELDS = [
  [(id, a) => [id, a.name ?? ""], 3],
  [(id, a) => a.tags ?? [], 2],
  [(id, a) => [...(a.categories ?? []), a.category ?? ""], 1],
];
/**
 * The models of `list` that hold every one of `words` (in their id, name, tags or categories, as a part of a
 * word: "extinguish" finds the extinguisher), best first: [{ id, asset, score }]. `type`: 2 models, 1 textures.
 */
export function searchAssets(list, words, { type = 2 } = {}) {
  const wanted = words
    .flatMap((w) =>
      String(w)
        .toLowerCase()
        .split(/[\s,]+/),
    )
    .filter(Boolean);
  const found = [];
  for (const [id, asset] of Object.entries(list)) {
    if (asset.type !== undefined && asset.type !== type) continue;
    let score = 0;
    const every = wanted.every((word) => {
      const weights = FIELDS.map(([of, weight]) =>
        of(id, asset).some((text) => String(text).toLowerCase().includes(word)) ? weight : 0,
      );
      score += weights.reduce((a, b) => a + b, 0);
      return weights.some(Boolean);
    });
    if (every) found.push({ id, asset, score: score + (asset.download_count ?? 0) / 1e9 });
  }
  return found.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** An asset's real size: its `dimensions` (millimetres, x y z with z up), as metres and as units. */
export function realSize(asset) {
  const mm = asset.dimensions;
  if (!Array.isArray(mm) || mm.length !== 3) return null;
  return { metres: mm.map((v) => v / 1000), units: mm.map((v) => (v / 1000) * 39.37) };
}
/** One line of a search's answer. */
export function assetLine(id, asset) {
  const size = realSize(asset);
  return [
    id,
    `"${asset.name ?? id}"`,
    `[${(asset.categories ?? []).join(", ")}]`,
    `tags: ${(asset.tags ?? []).map((tag) => tag.trim()).join(", ")}`,
    size
      ? `size ${size.metres.map((v) => v.toFixed(2)).join(" x ")} m (${size.units.map((v) => Math.round(v)).join(" x ")} units)`
      : "size not given",
    asset.polycount ? `${asset.polycount} triangles` : "polycount not given",
  ].join("  ");
}

/** /info/<id>: the asset, refused with a sentence when there is none of that id or it is not a model. */
export async function assetInfo(id, { ask = askNetwork } = {}) {
  if (!/^[a-z0-9_-]+$/i.test(id))
    throw new Error(`${id} is not an asset's id (letters, digits, _ and -): search for one`);
  let info;
  try {
    info = await json(ask, `/info/${id}`);
  } catch (error) {
    if (error.status === 404)
      throw new Error(
        `Poly Haven has no asset ${id}: search for one (node packs/assets/bin.mjs search <words>)`,
      );
    throw error;
  }
  if (info.type !== 2)
    throw new Error(`${id} is Poly Haven's ${["HDRI", "texture"][info.type] ?? "asset"}, not a model`);
  return info;
}

/** The picture files a .gltf's materials wear as their base colour (their `uri`s), and the files of its buffers. */
export function gltfWants(gltf) {
  const colours = new Set();
  for (const material of gltf.materials ?? []) {
    const texture = material.pbrMetallicRoughness?.baseColorTexture;
    const image = gltf.images?.[gltf.textures?.[texture?.index]?.source];
    if (image?.uri) colours.add(decodeURIComponent(image.uri));
  }
  const buffers = (gltf.buffers ?? []).map((b) => b.uri).filter((uri) => uri && !uri.startsWith("data:"));
  const others = (gltf.images ?? [])
    .map((i) => i.uri && decodeURIComponent(i.uri))
    .filter((uri) => uri && !colours.has(uri));
  return { colours: [...colours], buffers, others };
}

/**
 * An asset's glTF at 1k into `cache`/<id>/1k: the .gltf, its buffers and the pictures its materials wear as base
 * colour (not the normal, roughness or metal maps, which a studio model has no use for). A file already there at
 * its size is not asked again. Returns { file, fetched, kept, skipped }: the .gltf's path, the files asked and the
 * ones found already, and the pictures left out.
 */
export async function downloadGltf(id, { cache = DEFAULT_CACHE, ask = askNetwork } = {}) {
  let files;
  try {
    files = await json(ask, `/files/${id}`);
  } catch (error) {
    if (error.status === 404) throw new Error(`Poly Haven has no files for ${id}`);
    throw error;
  }
  const entry = files.gltf?.[RESOLUTION]?.gltf;
  if (!entry)
    throw new Error(
      `${id} has no glTF at ${RESOLUTION} (it has ${Object.keys(files.gltf ?? {}).join(", ") || "no glTF"})`,
    );
  const folder = join(cache, id, RESOLUTION);
  const fetched = [];
  const kept = [];
  const get = async (url, to, size) => {
    if (existsSync(to) && (size === undefined || statSync(to).size === size)) return kept.push(to);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, await ask(url));
    fetched.push(to);
  };
  const file = join(folder, `${id}_${RESOLUTION}.gltf`);
  await get(entry.url, file, entry.size);
  const wants = gltfWants(JSON.parse(readFileSync(file, "utf8")));
  const include = entry.include ?? {};
  for (const name of [...wants.buffers, ...wants.colours]) {
    const given = include[name];
    if (!given) throw new Error(`${id}: the .gltf names ${name}, which Poly Haven's file list has not`);
    if (!/^[\w./-]+$/.test(name) || name.split("/").includes(".."))
      throw new Error(`${id}: the .gltf names ${name}, a path that leads out of its folder`);
    await get(given.url, join(folder, name), given.size);
    // a see-through part (a label, a grille) keeps its alpha in a map of its own the .gltf does not name: beside it
    const key = Object.keys(files).find((k) =>
      Object.values(files[k]?.[RESOLUTION] ?? {}).some((f) => f.url?.endsWith(`/${basename(name)}`)),
    );
    const prefix = key?.replace(/_?diff(use)?$/i, "");
    const opacity =
      key && [`${prefix}_opacity`, "opacity", "Opacity"].map((k) => files[k]?.[RESOLUTION]).find(Boolean);
    const kind = opacity && (opacity.png ? "png" : "jpg");
    if (kind)
      await get(
        opacity[kind].url,
        join(folder, name.replace(/diff_1k\.(jpg|png)$/i, `opacity_1k.${kind}`)),
        opacity[kind].size,
      );
  }
  return { file, fetched, kept, skipped: wants.others };
}
