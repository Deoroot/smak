// What a place sounds like, and how its surfaces look up close: the two things the game's outdoor maps all have
// and a map made from nothing lacks (maps/natural/, 2026-10-18: its wild maps have 0.65 to 11.55 sounds to each
// 1000 player-heights squared of floor, wind, crickets, birds, leaves; and a `<map>_detail.txt` naming a
// detail texture for each of their textures).
//
// `ambience` strews looping sounds (ambient_generic) over spaces; `learnDetails` reads the game's own detail
// files for what detail each texture is given, and `detailText` writes a map's file from that.
import { pointEntity } from "./source.mjs";
import { spaceAt } from "./ground.mjs";

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
}
function toSegment([px, py], [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** ambient_generic's spawnflags for how far a sound is heard; `everywhere` the whole map. */
export const HEARD = { everywhere: 1, small: 2, medium: 4, large: 8 };
/** How far apart two of one sound stand at least, by how far it is heard (units). */
const SPACING = { everywhere: Infinity, small: 384, medium: 768, large: 1536 };

/**
 * Looping sounds over spaces. `places`: `[{ space, sides, groundAt }]` (as `scatter` takes them); `sounds`:
 * `[{ file, weight, volume: [low, high] (0 to 10), heard: "small" | "medium" | "large" | "everywhere",
 * byWall (0 to 1: how much it keeps to the rock, a forest's birds), spacing, least (so many of it at least,
 * over all the places: the wind that every outdoor map has) }]`; `density` sounds to each
 * 1000 player-heights squared of floor (one at least to a place); `player` the player's height.
 * Returns `{ entities, facts }`.
 */
export function ambience({ places, sounds, density = 4, player = 72, seed = 1 }) {
  const rand = rng(seed);
  const total = sounds.reduce((s, each) => s + (each.weight ?? 1), 0);
  const entities = [];
  const placed = [];
  for (const { space, sides = [], groundAt } of places) {
    const corners = space.areas.flat(2);
    const lo = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1]))];
    const hi = [Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
    const step = 64;
    const inside = [];
    for (let x = lo[0] + step / 2; x < hi[0]; x += step)
      for (let y = lo[1] + step / 2; y < hi[1]; y += step)
        if (spaceAt([space], [x, y, space.floor + 1]) >= 0 || spaceAt([space], [x, y, space.ceiling - 1]) >= 0) inside.push([x, y]); // prettier-ignore
    if (!inside.length) continue;
    const want = Math.max(1, Math.round((density * inside.length * step * step) / (player * player) / 1000));
    for (let n = 0, tries = 0; n < want && tries < want * 40; tries++) {
      let q = rand() * total;
      const owed = sounds.find(
        (each) => (each.least ?? 0) > placed.filter((p) => p.file === each.file).length,
      );
      const sound = owed ?? sounds.find((each) => (q -= each.weight ?? 1) <= 0) ?? sounds[0];
      const p = inside[Math.floor(rand() * inside.length)];
      const rock = Math.min(Infinity, ...sides.map(({ from, to }) => toSegment(p, from, to)));
      if (sound.byWall && rock > 3 * player && rand() < sound.byWall) continue;
      const heard = sound.heard ?? "medium";
      const apart = sound.spacing ?? SPACING[heard];
      if (placed.some((each) => each.file === sound.file && Math.hypot(each.p[0] - p[0], each.p[1] - p[1]) < apart)) continue; // prettier-ignore
      const [v0, v1] = sound.volume ?? [5, 5];
      const g = groundAt?.(...p) ?? space.floor;
      entities.push(pointEntity("ambient_generic", [Math.round(p[0]), Math.round(p[1]), Math.round(g + 48)], { message: sound.file, health: Math.round((v0 + rand() * (v1 - v0)) * 10) / 10, spawnflags: HEARD[heard] })); // prettier-ignore
      placed.push({ file: sound.file, p });
      n++;
    }
  }
  return {
    entities,
    facts: { sounds: entities.length, files: [...new Set(placed.map((each) => each.file))] },
  };
}

/**
 * What detail texture the game gives each texture, from the text of its maps' `_detail.txt` files (lines of
 * `texture detail/name scaleX scaleY`): `Map(texture in lower case → { detail, scale: [x, y], uses })`, the
 * most used where its maps differ.
 */
export function learnDetails(texts) {
  const seen = new Map();
  for (const text of texts)
    for (const line of text.split(/\r?\n/)) {
      const words = line.trim().split(/\s+/);
      if (words.length < 2 || line.trim().startsWith("//")) continue;
      const [name, detail, sx = "1", sy = sx] = words;
      const key = name.toLowerCase();
      const choice = `${detail.toLowerCase()} ${Number(sx)} ${Number(sy)}`;
      const counts = seen.get(key) ?? seen.set(key, new Map()).get(key);
      counts.set(choice, (counts.get(choice) ?? 0) + 1);
    }
  const table = new Map();
  for (const [name, counts] of seen) {
    const [choice, uses] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const [detail, sx, sy] = choice.split(" ");
    table.set(name, { detail, scale: [Number(sx), Number(sy)], uses });
  }
  return table;
}

/**
 * A map's `_detail.txt`: a line for each of `names` (the textures it uses) that `table` (`learnDetails`)
 * knows, or that `fallback(name)` gives `{ detail, scale }` for. Returns `{ text, given, left }`.
 */
export function detailText(names, table, { fallback } = {}) {
  const lines = [];
  const left = [];
  for (const name of [...new Set(names)]) {
    const found = table.get(name.toLowerCase()) ?? fallback?.(name);
    if (!found) {
      left.push(name);
      continue;
    }
    lines.push(`${name} ${found.detail} ${found.scale[0].toFixed(1)} ${found.scale[1].toFixed(1)}`);
  }
  return { text: lines.join("\n") + (lines.length ? "\n" : ""), given: lines.length, left };
}
