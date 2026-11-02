// Left 4 Dead 2's director scripts (VScript, Squirrel), read for what they ask of the director: whether a
// script started by a map is an event (a crescendo, an onslaught, a gauntlet) or only sets a mood. The game
// ships them as `.nuc` (lib/ice.mjs decrypts those). Nothing of a script is written anywhere.
//
//   scriptSays(text)   { event, mobEvery }: an event when the script asks for a panic (PanicForever,
//                      STAGE_PANIC, ScriptedPanic, PanicEvent), spawns a mob itself (ZSpawn of type 10) or
//                      sets mobs coming every 10 seconds or less (MobSpawnMinTime); the game's ambient and
//                      cooldown scripts set 20 to 90, its mood scripts (no bosses, wanderers, fog) none
const EVENT_SCRIPT = /PanicForever|STAGE_PANIC|ScriptedPanic|PanicEvent|ZSpawn\(\s*\{\s*type\s*=\s*10\b/;
export const EVENT_CODE = /PanicEvent|ScriptedPanic|ZSpawn\(\s*\{\s*type\s*=\s*10\b/i;
export const MOB_EVENT_EVERY = 10;

export function scriptSays(text) {
  const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const mobEvery = /MobSpawnMinTime\s*(?:<-|=)\s*([\d.]+)/.exec(code);
  const every = mobEvery ? Number(mobEvery[1]) : null;
  return { event: EVENT_SCRIPT.test(code) || (every !== null && every <= MOB_EVENT_EVERY), mobEvery: every };
}
