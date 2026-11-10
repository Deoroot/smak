// Where a file of the game is, among the folders given: a model, a sprite, a side of the sky. Internal to
// the map drawing: nothing here is part of what `index.mjs` hands out.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** A folder's entries by their names in lower case, read once a folder. */
const listings = new Map();
function listingOf(folder) {
  if (!listings.has(folder)) {
    let names = [];
    try {
      names = readdirSync(folder);
    } catch {
      // no such folder: it has nothing
    }
    listings.set(folder, new Map(names.map((name) => [name.toLowerCase(), name])));
  }
  return listings.get(folder);
}

/**
 * The first of the game's folders that has a file, as its path; null when none has. `name` is the path an
 * entity gives (`models/props/cart.mdl`), with either slash. The game finds a file whatever the case of its
 * letters, and so does this, on a disk that tells them apart too.
 */
export function inFolders(folders, name) {
  const parts = String(name).split(/[\/]+/).filter(Boolean);
  for (const folder of folders) {
    const straight = join(folder, ...parts);
    if (existsSync(straight)) return straight;
    let at = folder;
    for (const part of parts) {
      const found = at === null ? undefined : listingOf(at).get(part.toLowerCase());
      at = found === undefined ? null : join(at, found);
    }
    if (at !== null && parts.length) return at;
  }
  return null;
}
