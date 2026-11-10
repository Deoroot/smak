// What a compiled map holds, as data and as lines of text: the one description `smak map-info` and
// `smak map-entities` print and the MCP server's `info` answers with.
//
//   describeMap(bsp, bytes, file)            -> version, title, bounds, lumps, entities by class, textures and
//                                               which are wanted from .wad files, light, visibility
//   entityParts(entity, number)              -> { number, classname, place, keys }: one entity, as a line shows it
//   textureAreas(bsp)                        -> each texture's share of the world's faces, and where it mostly is
//   mapInfoLines(bsp, data, { compact, full, name, most })
//                                            -> the lines: the command line's, or compact for a client's context
//                                               (every entity in a line, `most` of them unless `full`)
import { worldBounds, wantedTextures, hasLightmap, entrySizesOf, faceTexture, facePolygon, faceNormal } from "../../core/maps/bsp.mjs";
import { LUMP_NAMES } from "../../core/maps/lumps.mjs";
import { valueOf, brushModelOf, originOf } from "../../core/maps/entities.mjs";

/** A point as the commands print it: to a hundredth of a unit. */
const placeText = (point) => point.map((value) => Math.round(value * 100) / 100).join(" ");
/** The keys of an object that are not undefined. */
const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

/** Everything `map-info` tells of a compiled map, as data (what `smak map-info --json` prints). */
export function describeMap(bsp, bytes, file) {
  const classes = {};
  for (const entity of bsp.entities) {
    const classname = valueOf(entity, "classname") ?? "(no classname)";
    classes[classname] = (classes[classname] ?? 0) + 1;
  }
  const styles = new Set();
  for (const face of bsp.faces) if (hasLightmap(bsp, face)) for (const style of face.styles) if (style !== 255) styles.add(style);
  const world0 = bsp.entities[0] ?? [];
  return {
    file,
    bytes: bytes.length,
    version: bsp.format === "bsp2" ? "BSP2" : bsp.version, // Xash's BSP2: its header's letters
    title: valueOf(world0, "maptitle") ?? valueOf(world0, "message") ?? "",
    bounds: worldBounds(bsp),
    lumps: Object.fromEntries(
      LUMP_NAMES.map((name) => {
        const size = entrySizesOf(bsp.format)[name];
        return [name, defined({ bytes: bsp.lumps[name].length, entries: size ? bsp.lumps[name].length / size : undefined })];
      }),
    ),
    entities: bsp.entities.length,
    brushEntities: bsp.models.length - 1,
    classes,
    textures: bsp.textures.map((texture) => ({ name: texture.name, width: texture.width, height: texture.height, inside: Boolean(texture.embedded) })),
    wads: wantedTextures(bsp).wads,
    light: { bytes: bsp.lumps.lighting.length, styles: [...styles].sort((a, b) => a - b) },
    visibility: bsp.lumps.visibility.length,
  };
}

/**
 * One entity as a line shows it: its class, where it is (its brushes, *n, for a brush entity other than the
 * world; else its origin) and its other keys as key=value, quoted when they hold a space.
 */
export function entityParts(entity, number) {
  const model = brushModelOf(entity);
  const origin = originOf(entity);
  return {
    number,
    classname: valueOf(entity, "classname") ?? "(no classname)",
    place: model !== null && number ? `brushes *${model}` : origin ? `at ${placeText(origin)}` : "",
    keys: entity.filter(([key]) => !["classname", "origin"].includes(key) && !(key === "model" && model !== null)).map(([key, value]) => `${key}=${/\s/.test(value) ? `"${value}"` : value}`),
  };
}

/** Each texture's share of the world's faces by area, the most first, and whether it is mostly walls, floors or ceilings. */
export function textureAreas(bsp) {
  const area = new Map();
  const world = bsp.models[0];
  for (let f = world.firstFace; f < world.firstFace + world.faceCount; f++) {
    const name = faceTexture(bsp, f).name;
    const corners = facePolygon(bsp, f);
    let a = [0, 0, 0];
    for (let i = 1; i + 1 < corners.length; i++) {
      const u = corners[i].map((v, k) => v - corners[0][k]);
      const w = corners[i + 1].map((v, k) => v - corners[0][k]);
      a = a.map((s, k) => s + [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]][k] / 2);
    }
    const size = Math.hypot(...a);
    const n = faceNormal(bsp, f);
    const facing = Math.abs(n[2]) > 0.7 ? (n[2] > 0 ? "floors" : "ceilings") : "walls";
    const entry = area.get(name) ?? { total: 0, walls: 0, floors: 0, ceilings: 0 };
    entry.total += size;
    entry[facing] += size;
    area.set(name, entry);
  }
  const all = [...area.values()].reduce((s, e) => s + e.total, 0) || 1;
  return [...area].sort((a, b) => b[1].total - a[1].total).map(([name, e]) => ({ name, share: (100 * e.total) / all, where: ["walls", "floors", "ceilings"].filter((k) => e[k] / e.total > 0.25) }));
}

/**
 * The lines `map-info` says of a compiled map: the command line's (lumps, every class, every texture, light), or
 * `compact` for a client's context: the world, every entity in a line (the first `most` unless `full`, which adds
 * their keys and each texture's share of the world's faces). `name`: the file as it is shown.
 */
export function mapInfoLines(bsp, data, { compact = false, full = false, name = data.file, most = 40 } = {}) {
  const { mins, maxs } = data.bounds;
  const wanted = data.textures.filter((texture) => !texture.inside);
  if (compact) {
    const shown = full ? bsp.entities : bsp.entities.slice(0, most);
    const lines = [
      `${name}: a GoldSrc map (version ${data.version}), ${data.bytes} bytes${data.title ? `, "${data.title}"` : ""}; the world from ${placeText(mins)} to ${placeText(maxs)} (+z up)`,
      `${bsp.faces.length} faces, ${bsp.leaves.length} leaves, ${data.brushEntities} brush entities; light ${data.light.bytes} bytes${data.light.styles.length ? ` (styles ${data.light.styles.join(" ")})` : ""}, visibility ${data.visibility} bytes`,
      `ENTITIES (${data.entities}): ${Object.entries(data.classes).sort((a, b) => b[1] - a[1]).map(([classname, count]) => `${classname} ${count}`).join(", ")}`,
      ...shown.map((entity, number) => {
        const e = entityParts(entity, number);
        return `  ${number} ${e.classname} ${e.place}${full && e.keys.length ? ` ${e.keys.join(" ")}` : ""}`;
      }),
    ];
    if (shown.length < bsp.entities.length) lines.push(`  and ${bsp.entities.length - shown.length} more: \`full\` lists all, with their keys`);
    lines.push(`TEXTURES (${data.textures.length}): ${data.textures.map((t) => `${t.name} ${t.width}x${t.height}${t.inside ? "" : " WANTED"}`).join(", ")}`);
    if (full) lines.push(`TEXTURES BY AREA of the world's faces: ${textureAreas(bsp).map((t) => `${t.name} ${t.share.toFixed(1)}% (${t.where.join(" and ")})`).join(", ")}`);
    if (wanted.length) lines.push(`${wanted.length} are WANTED from .wad files: ${data.wads.join(", ") || "none listed"}`);
    return lines;
  }
  const pad = (value, width) => String(value).padStart(width);
  const size = maxs.map((value, axis) => Math.round(value - mins[axis])).join(" x ");
  const lines = [`${name}: a GoldSrc map (version ${data.version}), ${data.bytes} bytes${data.title ? `, "${data.title}"` : ""}`, `the world: from ${placeText(mins)} to ${placeText(maxs)} (${size} units; +z is up)`, "", "LUMPS"];
  for (const [lump, entry] of Object.entries(data.lumps)) lines.push(`  ${lump.padEnd(14)} ${pad(entry.bytes, 9)} bytes${entry.entries === undefined ? "" : ` ${pad(entry.entries, 7)}`}`);
  lines.push("", `ENTITIES (${data.entities}): ${data.brushEntities} of them made of brushes   map-entities lists them, each with its number`);
  for (const [classname, count] of Object.entries(data.classes).sort((a, b) => b[1] - a[1])) lines.push(`  ${pad(count, 5)} ${classname}`);
  lines.push("", `TEXTURES (${data.textures.length}): ${data.textures.length - wanted.length} with their pixels inside the map, ${wanted.length} wanted from .wad files`);
  for (const texture of data.textures) lines.push(`  ${texture.name.padEnd(16)} ${`${texture.width}x${texture.height}`.padEnd(9)} ${texture.inside ? "inside" : "WANTED from a .wad"}`);
  if (data.wads.length) lines.push(`  the worldspawn lists: ${data.wads.join(", ")}`);
  lines.push(data.light.bytes ? `\nLIGHT  ${data.light.bytes} bytes, baked; styles ${data.light.styles.join(" ")}   (0 always on, 1 to 31 flicker, 32 and up are switched)` : "\nLIGHT  none: the map was not passed through hlrad, and is drawn fully bright");
  lines.push(data.visibility ? `VISIBILITY  ${data.visibility} bytes` : "VISIBILITY  none: the whole map is drawn from everywhere (a leak, or no hlvis)");
  return lines;
}
