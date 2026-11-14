// A texture file (.wad) checked as the engine and the compilers will meet it: each name, each size, the four sizes of
// each picture, the key colour of a masked texture and the sets of an animation. Made after a wad of a map's textures
// was found wrong only on writing (a name of sixteen letters) and by the game (a texture the engine stretched).
//   checkWad(bytes, engine)  -> { errors, warnings, facts }
import { wadEntries } from "../../core/maps/wad.mjs";
import { miptexHeader, readMiptex, hasHoles, textureKind, LONGEST_NAME, TEXTURE_GRID, HOLE, MIP_LEVELS } from "../../core/maps/miptex.mjs";
import { LIMITS } from "../check.mjs";

/** The key colour of a masked texture: the one the engine skips at the last palette index, blue by the tools' habit. */
const KEY = [0, 0, 255];
const some = (list) => `${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}`;

/** A .wad's bytes held to `engine`'s limits (goldsrc, xash, source): errors the engine or the compilers refuse, warnings, facts. */
export function checkWad(bytes, engine = "goldsrc") {
  const limits = LIMITS[engine];
  if (!limits) throw new Error(`engine: ${Object.keys(LIMITS).join(", ")}, not ${engine}`);
  const [errors, warnings, facts, seen] = [[], [], [], new Map()];
  const entries = wadEntries(bytes);
  const textures = entries.filter((entry) => entry.kind === "texture");
  const others = entries.filter((entry) => entry.kind !== "texture");
  facts.push(`${textures.length} textures${others.length ? `, ${others.length} other entries (${some(others.map((e) => `${e.name} ${e.kind}`))}) not checked` : ""}`);
  for (const { name, at } of textures) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) errors.push(`${name}: given twice${seen.get(lower) === name ? "" : ` (as ${seen.get(lower)})`}: the engine would only ever find the first`);
    else seen.set(lower, name);
    if (!name || name.length > LONGEST_NAME) errors.push(`${JSON.stringify(name)}: ${name.length} letters, the name holds ${LONGEST_NAME}`);
    if (/[^\x21-\x7e]/.test(name)) errors.push(`${JSON.stringify(name)}: spaces or letters outside plain ASCII (the compilers and the engine split or cut them)`);
    else if (name !== lower) warnings.push(`${name}: not in lower case (the engine matches either; the compilers and tools differ)`);
    try {
      const { width, height, offsets } = miptexHeader(bytes, at);
      if (!width || !height || width % TEXTURE_GRID || height % TEXTURE_GRID) throw new Error(`${width}x${height}, both sides must be multiples of ${TEXTURE_GRID}: the engine refuses the map`);
      if (width > limits.texture || height > limits.texture) warnings.push(`${name}: ${width}x${height} is over ${limits.texture}, the most ${engine} draws (it shrinks it)`);
      const present = offsets.filter((offset) => offset > 0).length;
      if (present < MIP_LEVELS) throw new Error(`${present} of its ${MIP_LEVELS} sizes (mips) are in the file${present ? "" : ": the pixels are meant to come from another wad"}`);
      const texture = readMiptex(bytes, at);
      if (!hasHoles(name)) continue;
      const key = [...texture.palette.subarray(HOLE * 3, HOLE * 3 + 3)];
      if (texture.colours < 256) errors.push(`${name}: masked, but its palette has ${texture.colours} colours: the key colour's place, index ${HOLE}, is not in it`);
      else if (key.join() !== KEY.join()) warnings.push(`${name}: masked, its key colour (palette index ${HOLE}) is ${key.join(" ")}, not blue ${KEY.join(" ")}: tools that do not know the mask show it as a colour`);
      if (!texture.pixels.includes(HOLE)) warnings.push(`${name}: masked, but no pixel is the key colour: it has no holes`);
    } catch (error) {
      errors.push(`${name}: ${error.message.replace(/^the texture \S+ /, "")}`);
    }
  }
  // an animated set +0name..+9name, its toggled one +aname..+jname: each from its first, with no frame missing
  const sets = new Map();
  for (const lower of seen.keys()) {
    const kind = textureKind(lower);
    if (!kind.animated) continue;
    const set = sets.get(lower.slice(2)) ?? { base: [], alt: [] };
    set[/[0-9]/.test(kind.frame) ? "base" : "alt"].push(parseInt(kind.frame, 20));
    sets.set(lower.slice(2), set);
  }
  for (const [rest, { base, alt }] of sets) {
    for (const [list, first, label] of [[base, 0, "+0"], [alt, 10, "+a"]]) {
      const gone = list.length ? Array.from({ length: Math.max(...list) - first + 1 }, (_, i) => first + i).filter((i) => !list.includes(i)) : [];
      if (gone.length) errors.push(`${label}${rest}: the animated set has no ${gone.map((i) => `+${i.toString(20)}${rest}`).join(", ")}: the engine refuses the map ("missing frames")`);
    }
    if (alt.length && !base.length) errors.push(`+a${rest}: a toggled set with no +0${rest} to toggle from`);
  }
  if (sets.size) facts.push(`${sets.size} animated sets`);
  return { errors, warnings, facts };
}
