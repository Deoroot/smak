// Where each script of one's own stands against the scripts a game ships: for a game whose maps and scripts
// name scripts by path (a monster's `scriptfile`, an `#include`), and which lays a mod's scripts over its
// own pack. A script of ours at a path the pack has takes that script's place; one at a new path does
// something only if something names it. A file put at a path nothing names is laid over nothing and run by
// nobody, and no check of a map can see it: this one can.
//
// Nothing here knows a game. How scripts are named is the mod's, as a profile's `scriptPack`:
//   {
//     shipped(folder)   the scripts the game ships, a Map from each one's name to its text: read from the
//                       game's own pack, or from `folder` when one is given (the pack unpacked)
//     loose(folder)     the scripts of a folder of one's own: a Map from name to { text, file }
//     ofEntity(keys)    the names of the scripts a map's entity names by its keys
//     words(text)       the words of a script's text that may be a script's name (comments left out); unless
//                       given, every run of letters that are not blank, a quote, a bracket, a comma or a `;`
//     aliases(name)     other words a script is named by (an item's name without its folder): a list
//     started(name, { maps })   a sentence when the game itself runs or lists the script, whoever names it
//                       ("the game runs it when the map orchard starts"); null when it does not.
//                       `maps`: the names of the maps there are
//     mapOf(name, { maps })   the map a script belongs to, or null for one of no map's: unless given, the
//                       first folder of its name when a map of that name is known (`orchard/keeper` is the
//                       orchard's), which is how a GoldSrc mod that names scripts by path keeps a map's own
//     lint(name, text)  sentences of what the game would cut or refuse in a script's own lines (an item's
//                       description too long for it): each a warning, under the script's name
//   }
// A script's name is its path as the game compares it (the profile's to say: lower case, `/`, no ending).

/** What stands between two words of a script: blanks, quotes, brackets, commas and `;`. */
const BETWEEN_WORDS = /[\s"'()[\]{},;]+/;
/** A line's comment, in the scripts of the GoldSrc mods that have them. */
const COMMENT = /\/\/.*$/gm;
/** How many of one list a sentence names before it counts the rest. */
const LISTED = 12;

const some = (list, most = LISTED) =>
  `${list.slice(0, most).join(", ")}${list.length > most ? ` and ${list.length - most} more` : ""}`;
/** The words of a text, comments left out, in lower case. */
const wordsOf = (text) => text.replace(COMMENT, "").toLowerCase().split(BETWEEN_WORDS).filter(Boolean);

/**
 * Each script of ours, placed.
 *   ours      a Map from a script's name to { text, file } (later folders already laid over earlier ones)
 *   shipped   a Map from the name of each script the game ships to its text
 *   maps      [{ name, entities: [keys, ...] }]: the maps whose entities may name a script, each entity as
 *             a plain object of its keys
 *   rules     the mod's (above): ofEntity, words, aliases, started, mapOf
 *   mapNames  the names of every map there is (unless told: those of `maps`), for `started` and `mapOf`
 *   only      the names of the maps being looked at, when not all of them are: a script named by nothing is
 *             warned of only when it is one of theirs (`mapOf`), or named by one of theirs that nothing names
 *             either; the rest are counted in a fact. Every script is placed all the same
 * A script is LIVE when the game has a reason to read it: every script the game ships (ours in its place,
 * where we replace one); a new one that a map's entity names, that the game itself runs or lists, or that
 * a live script's text names. The rest of ours are named by nothing.
 * Returns {
 *   scripts   [{ name, file, state, by }] in the order given: `state` is "replaces" (the pack has a script
 *             of that name), "named" (new, and something names it: `by`, a list of sentences) or "unnamed"
 *             (new, named by nothing live; `by` then lists the scripts that name it and are unnamed too)
 *   warnings, facts   sentences
 * }
 * What it cannot see: a name put together while the game runs (two words joined, a name in a variable set
 * by a map's parameter). A script reached only so is said to be named by nothing: a warning, not an error.
 */
export function scriptsPlaced({ ours, shipped, maps = [], rules = {}, mapNames, only }) {
  const words = rules.words ?? wordsOf;
  const aliasesOf = (name) => [name, ...(rules.aliases?.(name) ?? [])];
  const fresh = [...ours.keys()].filter((name) => !shipped.has(name));
  // the words that name a new script, each to the scripts it may mean
  const meant = new Map();
  for (const name of fresh)
    for (const word of aliasesOf(name)) (meant.get(word) ?? meant.set(word, []).get(word)).push(name);
  const by = new Map(fresh.map((name) => [name, []]));
  const live = new Set();
  const waiting = [];
  const liven = (name, why) => {
    by.get(name).push(why);
    if (live.has(name)) return;
    live.add(name);
    waiting.push(name);
  };

  // named by a map's entity
  const names = mapNames ?? maps.map((map) => map.name);
  for (const map of maps)
    map.entities.forEach((keys, number) => {
      for (const said of rules.ofEntity?.(keys) ?? [])
        if (by.has(said))
          liven(said, `the map ${map.name} (entity ${number} ${keys.classname ?? ""}${keys.targetname ? ` "${keys.targetname}"` : ""})`); // prettier-ignore
    });
  // named by a live script: the game's own (ours where we replace one), then every new one made live
  /** the new scripts a text names, but for itself */
  const namedIn = (text, self) => {
    const found = new Set();
    for (const word of words(text)) for (const name of meant.get(word) ?? []) if (name !== self) found.add(name); // prettier-ignore
    return found;
  };
  if (fresh.length)
    for (const [name, text] of shipped) {
      const read = ours.get(name)?.text ?? text;
      for (const said of namedIn(read, name))
        liven(said, `the script ${name}${ours.has(name) ? " (ours, in the game's place)" : " (the game's)"}`);
    }
  const spread = () => {
    while (waiting.length) {
      const name = waiting.pop();
      for (const said of namedIn(ours.get(name).text, name)) liven(said, `the script ${name} (ours, new)`);
    }
  };
  spread();
  // and what the game runs or lists by itself, of those no map and no script has named
  for (const name of fresh) {
    const why = live.has(name) ? null : rules.started?.(name, { maps: names });
    if (why) liven(name, why);
  }
  spread();
  // what is left: named by nothing live; by which of its like, if any
  const dead = fresh.filter((name) => !live.has(name));
  for (const name of dead)
    for (const said of namedIn(ours.get(name).text, name))
      if (!live.has(said)) by.get(said).push(`${name}, which nothing names either`);

  const scripts = [...ours].map(([name, { file }]) => ({
    name,
    file,
    state: shipped.has(name) ? "replaces" : live.has(name) ? "named" : "unnamed",
    by: by.get(name) ?? [],
  }));
  const count = (state) => scripts.filter((script) => script.state === state).length;
  const facts = [
    `${scripts.length} scripts of ours against the ${shipped.size} the game ships: ${count("replaces")} take a game script's place, ${count("named")} are new and named, ${count("unnamed")} are new and named by nothing`,
  ];
  const warnings = [];
  // looking at some maps only: the dead scripts that are theirs, and those that only theirs name
  const known = new Set(names.map((name) => String(name).toLowerCase()));
  const mapOf = rules.mapOf ?? ((name) => (name.includes("/") && known.has(name.split("/")[0]) ? name.split("/")[0] : null)); // prettier-ignore
  const looked = only ? new Set([only].flat().map((name) => String(name).toLowerCase())) : null;
  const theirs = (name) => looked.has(String(mapOf(name, { maps: names }) ?? "").toLowerCase());
  const warned = looked ? dead.filter((name) => theirs(name) || dead.some((other) => theirs(other) && namedIn(ours.get(other).text, other).has(name))) : dead; // prettier-ignore
  if (looked && warned.length < dead.length)
    facts.push(
      `${dead.length - warned.length} more scripts are new and named by nothing, and are no part of ${[...looked].join(", ")}: not warned of here (all of them are when every map is looked at)`,
    );
  if (warned.length)
    warnings.push(
      `${warned.length} scripts are new (the game ships none of that name) and nothing names them: no map's entity, no script the game reads, and the game runs none of that name by itself. Laid over the game's pack they replace nothing and are never read: ${some(warned.map((name) => `${name}${ours.get(name).file ? ` (${ours.get(name).file})` : ""}${by.get(name).length ? `, named only by ${by.get(name).join("; ")}` : ""}`))}. A script meant to replace one of the game's is to have that one's path; a name made while the game runs is not seen here`,
    );
  // what the game would cut in our own lines (the mod's `lint`): of the maps looked at only, when some are
  for (const [name, { text, file }] of ours)
    if (!looked || theirs(name))
      for (const said of rules.lint?.(name, text) ?? []) warnings.push(`${name}${file ? ` (${file})` : ""}: ${said}`);
  return { scripts, warnings, facts };
}
