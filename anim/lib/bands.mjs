// The reference profiles a blow is held to: one game's bands per file, anim/corpus/bands-<game>.json, each
// measure's spread over that game's blows and per weapon family (anim/tools/judge.mjs survey --game <game>).
// Vermintide 2's is the default: the reference SMAK's animations aim at. Only measures are kept, nothing of a game's.
//
//   loadBands()          the default reference's bands
//   loadBands("msr")     another game's
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CORPUS = fileURLToPath(new URL("../corpus/", import.meta.url));
/** The reference a blow is held to unless told. */
export const REFERENCE = "vt2";
/** Each profile's name in words. */
export const REFERENCES = { vt2: "Vermintide 2", msr: "MSR" };

export const bandsPath = (game = REFERENCE) => `${CORPUS}bands-${game}.json`;

/** A game's bands: { reference, game, overall, families, noise, ... }. */
export function loadBands(game = REFERENCE) {
  const path = bandsPath(game);
  if (!existsSync(path)) throw new Error(`no bands for ${game} at ${path} (node anim/tools/judge.mjs survey --game ${game})`);
  return JSON.parse(readFileSync(path, "utf8"));
}
