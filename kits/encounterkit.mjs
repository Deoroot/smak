// encounterkit: the wiring of a map's encounters, as recipes: the entities that bring monsters in out of
// sight, as a reply to the player, in waves, with a reward where the fight was won. Each recipe is what the
// game's own good maps do (docs/MAPS-DESIGN.md has where each is from) and returns plain entities for
// `writeMap`'s `entities`. Nothing here places a monster for you: you say where, the recipe wires it.
//
//   import * as maps from "../check/maps/index.mjs";
//   import masterSword from "../profiles/mastersword.mjs";
//   import { recipesOf } from "../kits/encounterkit.mjs";
//   const kit = recipesOf(masterSword({ game }));
//   entities.push(...kit.fillAhead({ name: "t2", at, trigger: [min, max] }));
//   entities.push(kit.monster("t2", "msmonster_boar", [x, y, z], { script: "monsters/boar", band: "0;150" }));
//
// What a recipe needs of the mod is its profile's `spawns` (encounters.mjs: the classes of a spawn area and
// a template, and their keys) and its `recipes`:
//   text      the class of a line of text fired by name ("game_text"; Master Sword's "ms_text")
//   chance    { class, key }: a relay that fires its target only so many times in a hundred, or null
//   oneOf     { class, key }: a multi_manager that fires one of its targets at random, or null
//   counter   "brush" or "point": how the mod's maps write a trigger_counter (Master Sword's: a brush)
// A profile with no `spawns` has no spawn areas, and the recipes that make one are refused in a sentence.
import { pointEntity, brushEntity, box } from "../make/maps/source.mjs";

/** The texture of a trigger's brush, which the compilers keep out of sight. */
const TRIGGER = "AAATRIGGER";
/** How far apart the recipe's own small entities stand (units), so that none sits in another. */
const APART = 16;

/** The recipes for one mod, from its profile. */
export function recipesOf(mod) {
  const spawns = mod?.spawns ?? null;
  const recipes = { text: "game_text", chance: null, oneOf: null, counter: "brush", ...mod?.recipes };
  const needSpawns = (what) => {
    if (!spawns) throw new Error(`${what}: the profile has no \`spawns\` (encounters.mjs): the mod has no spawn areas this kit knows`);
    return spawns;
  };
  const firstOf = (list) => (Array.isArray(list) ? list[0] : list);
  const below = (at, n) => [at[0], at[1] + APART * n, at[2]];

  /** A spawn area named `name` at `at`, waiting to be fired unless `waits` is false. `cleared`: what it fires when all are dead. */
  const area = (name, at, { waits = true, cleared, keys = {} } = {}) => {
    const s = needSpawns("area");
    if (s.cleared === null && cleared) throw new Error("area: the profile's spawn areas fire nothing when cleared (`spawns.cleared`)");
    return pointEntity(firstOf(s.areas), at, {
      targetname: name,
      ...(waits && s.waits ? { [s.waits.key]: s.waits.value } : {}),
      ...(cleared ? { [s.cleared]: cleared } : {}),
      ...keys,
    });
  };

  /**
   * A monster of the area `name`: `classname` at `at` (its feet), with `script`, `lives` (1: it does not come
   * back), `delay` [low, high] seconds, `band` ("0;150"), `yaw`, `dies` (what it fires as it dies), `keys`.
   */
  const monster = (name, classname, at, { script, lives = 1, delay = [1, 2], band, yaw = 0, dies, keys = {} } = {}) => {
    const s = needSpawns("monster");
    const [low, high] = s.delay ?? [];
    return pointEntity(classname, at, {
      [s.area]: name,
      ...(script ? { [s.scriptKey ?? "scriptfile"]: script } : {}),
      ...(s.lives ? { [s.lives]: lives } : {}),
      ...(low ? { [low]: delay[0] } : {}),
      ...(high ? { [high]: delay[1] } : {}),
      ...(band !== undefined && s.band ? { [s.band.key]: band } : {}),
      ...(dies ? { [firstOf(s.dies)]: dies } : {}),
      angles: [0, yaw, 0],
      ...keys,
    });
  };

  /** A trigger a player walks into, firing `target` once. */
  const trigger = ([min, max], target, keys = {}) =>
    brushEntity("trigger_once", [box(min, max, TRIGGER)], { target, ...keys });

  /** A line of text fired by `name`. */
  const line = (name, message, at, keys = {}) =>
    pointEntity(recipes.text, at, { targetname: name, message, ...keys });

  return {
    area,
    monster,
    trigger,
    line,

    /**
     * FILL AHEAD: an area fired from a trigger the player crosses before the area's ground can be seen (a
     * gate, the stair of the terrace below, the bend of a tunnel). Its monsters are there when the player
     * looks. The recipe only wires it: `smak map-spawns` says whether the trigger truly cannot see them.
     * `{ name, at, trigger: [min, max], cleared }`.
     */
    fillAhead({ name, at, trigger: where, cleared, keys }) {
      return [area(name, at, { cleared, keys }), trigger(where, name)];
    },

    /**
     * ON ARRIVAL: areas filled as the first player comes into the world (the game's own name for it, the
     * profile's `spawns.arrival`), one `apart` seconds after another, as challs fills its nine halls. Their
     * band is the strength of the players there at that moment: the first one alone, when a party loads one
     * by one. `{ names, at, apart = 1 }`: the areas themselves are made apart (`area(name, at, ...)`).
     */
    onArrival({ names, at, apart = 1 }) {
      const s = needSpawns("onArrival");
      const arrival = firstOf(s.arrival);
      if (!arrival) throw new Error("onArrival: the profile names nothing the game fires as a player arrives (`spawns.arrival`)");
      const manager = `${names[0]}_arrival`;
      return [
        // fires once and is gone (spawnflags 1): a second player's arrival does not fill them again
        pointEntity("trigger_relay", at, { targetname: arrival, target: manager, spawnflags: 1 }),
        pointEntity("multi_manager", below(at, 1), { targetname: manager, ...Object.fromEntries(names.map((name, n) => [name, n * apart])) }), // prettier-ignore
      ];
    },

    /**
     * A SURPRISE: a breakable (a crate, a web, a barrel, a rotten board) that brings an area when broken,
     * thornlands' and gatecity's way: the monster appears because the player did something.
     * `{ name, at, brushes, keys, breakable }`: `brushes` the breakable's, `breakable` its own keys
     * (`material`, `health`).
     */
    surprise({ name, at, brushes, keys, breakable = {} }) {
      return [brushEntity("func_breakable", brushes, { target: name, health: 20, ...breakable }), area(name, at, { keys })];
    },

    /**
     * WAVES at one place: each area fired when the one before is cleared, the last firing `then`. The
     * player is standing there fighting: a wave appearing is the event (kfortress, isle, thornlands' spider
     * trap). `{ names, at, then }`: the first waits to be fired by you.
     */
    waves({ names, at, then }) {
      return names.map((name, n) => area(name, below(at, n), { cleared: names[n + 1] ?? then }));
    },

    /**
     * COUNTED: `count` things done (`from`: the names fired when each is done, say each area's `cleared`)
     * open `target` once. Each is counted once (a relay that fires once, spawnflags 1), whatever else uses
     * its name; a line for each when `lines` gives them. kfortress's key in three pieces; the orchard's
     * three terraces opening the cellar.
     */
    counted({ name, from, target, at, lines = [] }) {
      const made = [];
      from.forEach((each, n) => {
        made.push(pointEntity("trigger_relay", below(at, n + 1), { targetname: each, target: name, triggerstate: 1, spawnflags: 1 }));
        if (lines[n]) made.push(line(each, lines[n], [at[0] + APART, at[1] + APART * (n + 1), at[2]]));
      });
      const keys = { targetname: name, target, count: from.length };
      made.push(
        recipes.counter === "point"
          ? pointEntity("trigger_counter", at, keys)
          : brushEntity("trigger_counter", [box([at[0] - 8, at[1] - 8, at[2] + 200], [at[0] + 8, at[1] + 8, at[2] + 216], TRIGGER)], keys),
      );
      return made;
    },

    /**
     * A REWARD WHERE IT WAS WON: an area of one chest, fired by the boss's death (give the boss `dies:
     * name`). Put `at` at his feet or in the vault his death opens on the way out: the game's own chests
     * appear within 267 units of the dying monster in half the cases, and the rest in such a vault.
     * `{ name, at, classname, script, yaw }`.
     */
    rewardOnDeath({ name, at, classname, script, yaw = 0, keys }) {
      return [area(name, [at[0], at[1], at[2] + 72]), monster(name, classname, at, { script, yaw, keys })];
    },

    /** A CHANCE: `target` fired only `percent` times in a hundred when `name` is fired (thornlands' orc raid, 5). */
    chance({ name, target, percent, at }) {
      if (!recipes.chance) throw new Error("chance: the profile has no relay that fires by chance (`recipes.chance`)");
      return pointEntity(recipes.chance.class, at, { targetname: name, target, [recipes.chance.key]: percent, triggerstate: 2 });
    },

    /** ONE OF: one of `targets` fired at random when `name` is fired (orc_for's ambushes: one pouncer of two). */
    oneOf({ name, targets, at }) {
      if (!recipes.oneOf) throw new Error("oneOf: the profile has no multi_manager that fires one target at random (`recipes.oneOf`)");
      return pointEntity(recipes.oneOf.class, at, { targetname: name, [recipes.oneOf.key]: 1, ...Object.fromEntries(targets.map((each) => [each, 0])) }); // prettier-ignore
    },
  };
}
