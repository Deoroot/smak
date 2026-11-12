// ONE MOD'S PROFILE, AND AN EXAMPLE OF ONE: Master Sword Classic (the game folder `msc`).
//
// This file is no part of the kit's core, and nothing in `core/` to `cli/` knows of it. It is here to be copied: a
// profile for another GoldSrc mod is written the same way, from that mod's FGD, its own maps and what its
// code is known to do (docs/MAPS-MAKING.md, "A mod's profile"). It holds no game content: the definitions
// are read from the installed game when the profile is made (the game's FGDs, its hundred maps, its script
// pack), so it needs the game.
//
//   import masterSword from "./smak/profiles/mastersword.mjs";
//   const mod = masterSword({ game: "C:/games/Half-Life" });               // or { folders: [msc, valve] }
//   maps.checkPlan(map, { mod });   maps.checkBsp(bytes, { mod });   maps.reachOf(map, { mod });
//
//   smak map-check orchard.bsp --mod smak/profiles/mastersword.mjs --game <Half-Life>/msc --game <Half-Life>/valve
//
// WHERE EACH FACT IS FROM. "The source" is the game's own C++ (MasterSwordRebirth, src/game); "the maps" are
// the 100 maps the game ships in msc/maps, counted with `learnEntities`; the FGD is msc/dev/ms1.4.fgd.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GOLDSRC, isNamed } from "../make/maps/mod.mjs";
import { definitionsOf } from "../make/maps/fgd.mjs";
import { entitiesOfFile } from "../make/maps/learn.mjs";

/** The mod's folder in a Half-Life folder, its script pack and its FGDs, as the game ships them. */
const MOD_FOLDER = "msc";
const SCRIPT_PACK = "dlls/sc.dll";
const FGDS = ["dev/halflife.fgd", "dev/ms1.4.fgd"];
/** The game's own program, as the `gamedll` line of msc/liblist.gam names it. */
const PROGRAM = "dlls/ms.dll";
/** How a script's file is named in the pack and in a folder of loose scripts. */
const SCRIPT_END = ".script";
/** The folder of the pack whose scripts are items: an item's name is its script's, without the folder. */
const ITEMS = "items/";
/** The pack's list of its items, one name a line, and the ending of a script of items/ that is no item. */
const ITEM_LIST = "items.txt";
const CLIENT_SIDE = /_cl$/;
/** The script the game runs for a map by itself, in the folder of the map's name. */
const MAP_STARTUP = /^([^/]+)\/map_startup$/;

// ── the script pack ─────────────────────────────────────────────────────────
// dlls/sc.dll is a data file despite its name: every script of the game, enciphered. The format and the
// cipher are in the source, src/game/shared/ms/groupfile.cpp and encrypt.cpp: the last four bytes are a
// checksum; before them, each byte i was swapped with the byte (i + 7) % n after (i * 4) % 128 was added to
// it. Unciphered it is a count, then for each script 256 bytes of name, an offset and a size.
const PACK = { name: 256, entry: 256 + 8, checksum: 4 };

/** A script's name as the game compares it: lower case, `/` between folders, no leading `/`, no `.script`. */
const scriptName = (name) =>
  name
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/\.script$/, "");

/** The names of the scripts in a pack's bytes, as `scriptName` writes them. */
export function packScriptNames(bytes) {
  const length = bytes.length - PACK.checksum;
  const plain = Buffer.from(bytes.subarray(0, length));
  for (let i = length - 1; i >= 0; i--) {
    const j = (i + 7) % length;
    const kept = plain[i];
    plain[i] = plain[j];
    plain[j] = kept;
  }
  // only the table of names is needed: the count, then each entry's name
  const byteAt = (at) => (plain[at] - ((at * 4) % 128)) & 0xff;
  const count = byteAt(0) | (byteAt(1) << 8) | (byteAt(2) << 16) | (byteAt(3) << 24);
  if (!(count > 0 && 4 + count * PACK.entry <= length))
    throw new Error("the script pack is not one this profile reads (its table of names runs past its end)");
  const names = [];
  for (let entry = 0; entry < count; entry++) {
    const at = 4 + entry * PACK.entry;
    let name = "";
    for (let i = 0; i < PACK.name; i++) {
      const letter = byteAt(at + i);
      if (!letter) break;
      name += String.fromCharCode(letter);
    }
    names.push(scriptName(name));
  }
  return names;
}

/** Every script of a pack's bytes: a Map from its name (`scriptName`) to its text. */
export function packScripts(bytes) {
  const length = bytes.length - PACK.checksum;
  const plain = Buffer.from(bytes.subarray(0, length));
  for (let i = length - 1; i >= 0; i--) {
    const j = (i + 7) % length;
    const kept = plain[i];
    plain[i] = plain[j];
    plain[j] = kept;
  }
  for (let at = 0; at < length; at++) plain[at] = (plain[at] - ((at * 4) % 128)) & 0xff;
  const count = plain.readInt32LE(0);
  if (!(count > 0 && 4 + count * PACK.entry <= length))
    throw new Error("the script pack is not one this profile reads (its table of names runs past its end)");
  const texts = new Map();
  for (let entry = 0; entry < count; entry++) {
    const at = 4 + entry * PACK.entry;
    const end = plain.indexOf(0, at);
    const name = plain.toString("latin1", at, Math.min(end < 0 ? at + PACK.name : end, at + PACK.name));
    const from = plain.readUInt32LE(at + PACK.name);
    const size = plain.readUInt32LE(at + PACK.name + 4);
    if (from + size <= length) texts.set(scriptName(name), plain.toString("latin1", from, from + size));
  }
  return texts;
}

/**
 * The pack unpacked into a folder (as tools write it out, one file a script): a Map from each script's name
 * to its text, with the list of items under its own name.
 */
function unpackedScripts(folder) {
  const texts = new Map();
  for (const [name, file] of looseScriptFiles(folder)) texts.set(name, readFileSync(file, "latin1"));
  if (existsSync(join(folder, ITEM_LIST))) texts.set(ITEM_LIST, readFileSync(join(folder, ITEM_LIST), "latin1")); // prettier-ignore
  return texts;
}

/** The loose scripts of a folder (and of its folders): a Map from each one's name to its file. */
function looseScriptFiles(folder, under = "", files = new Map()) {
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) looseScriptFiles(path, `${under}${name}/`, files);
    else if (name.toLowerCase().endsWith(SCRIPT_END)) files.set(scriptName(`${under}${name}`), path);
  }
  return files;
}

// ── the model a script gives its entity ─────────────────────────────────────
// A monster, an NPC or a chest names no model in the map: its script does, with `setmodel`, by a path under
// models/ ("setmodel monsters/skeleton.mdl"; the source, shared/script/scriptcmds.cpp, puts "models/" before
// it). Of the 900 `setmodel` lines of the game's scripts some 650 name the file there and the rest a word
// the script, or a script it includes, gives a value with `const` or `setvard` (MONSTER_MODEL, NPC_MODEL);
// a script with no `setmodel` of its own has it from a script it takes in with `#include`
// (monsters/skeleton_base). "none" is no model. What is NOT read: `setmodelbody` (which of the model's
// parts are shown) and a model chosen while the game runs, by a parameter or at random.
const MODELS = "models/";
/** How deep `#include` is followed: the game's own scripts go four deep. */
const INCLUDES_DEEP = 6;

/** The words of a script's lines that begin with a command, comments left out. */
function linesOf(text, command) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const words = line
      .replace(/\/\/.*$/, "")
      .trim()
      .split(/\s+/);
    if (words[0]?.toLowerCase() === command && words.length > 1) lines.push(words.slice(1));
  }
  return lines;
}

/** What the game keeps of an entity's description and of a name with its prefix: the source,
 * shared/ms/scriptcmds.cpp, ScriptCmd_Desc ("limited to 72 characters": cut to 72, with "WARNING: Description
 * too long") and ScriptCmd_Name (with a `|`, the prefix and the name together cut to 29: "WARNING: Name too
 * long"). A name with no `|` is not cut there. */
export const DESC_MOST = 72;
export const NAME_MOST = 29;

/**
 * What the game would cut in a script's own `desc` and `name` lines, as sentences (the script check's
 * warnings). A line's words are joined by one space each, as the game joins its parameters; a word in
 * quotes is one word. A value put together while the game runs (`$get(...)`) is measured as written.
 */
export function scriptLint(text) {
  const said = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, "");
    const got = /^\s*(desc|name)\s+(.*\S)\s*$/i.exec(line);
    if (!got) return;
    const value = (got[2].match(/"[^"]*"|\S+/g) ?? []).map((word) => word.replace(/^"(.*)"$/, "$1")).join(" ");
    const command = got[1].toLowerCase();
    if (command === "desc" && value.length > DESC_MOST)
      said.push(
        `line ${index + 1}: its desc is ${value.length} characters, and the game keeps ${DESC_MOST} of it (shared/ms/scriptcmds.cpp, ScriptCmd_Desc): "${value.slice(0, DESC_MOST)}" (cut: "${value.slice(DESC_MOST)}")`,
      );
    const bar = value.indexOf("|");
    if (command === "name" && bar >= 0 && value.length - 1 > NAME_MOST)
      said.push(
        `line ${index + 1}: its name "${value}" is ${value.length - 1} characters with its prefix, and the game keeps ${NAME_MOST} of the two (shared/ms/scriptcmds.cpp, ScriptCmd_Name): the name becomes "${value.slice(bar + 1, bar + 1 + NAME_MOST - bar)}"`,
      );
  });
  return said;
}

/**
 * The model a script gives its entity, as a path from the game's folder ("models/monsters/skeleton.mdl"),
 * or null where it names none that can be read. `textOf(name)` is a script's text, or undefined.
 */
export function scriptModel(script, textOf) {
  const taken = [];
  const take = (name, deep) => {
    const text = textOf(scriptName(name));
    if (text === undefined || deep > INCLUDES_DEEP || taken.some((each) => each.name === scriptName(name)))
      return;
    taken.push({ name: scriptName(name), text });
    // "#include [server] monsters/wolf_base": the script is the line's last word
    for (const words of linesOf(text, "#include")) take(words[words.length - 1], deep + 1);
  };
  take(script, 0);
  const valueOfWord = (word) => {
    for (const { text } of taken)
      for (const command of ["const", "setvard", "setvar"])
        for (const [name, value] of linesOf(text, command))
          if (name === word && value !== undefined) return value.replace(/^"|"$/g, "");
    return null;
  };
  for (const { text } of taken)
    for (const [word] of linesOf(text, "setmodel")) {
      const said = word.replace(/^"|"$/g, "");
      const file = /\.mdl$/i.test(said) ? said : valueOfWord(said);
      if (file && /\.mdl$/i.test(file)) return `${MODELS}${file.replace(/\\/g, "/").replace(/^\/+/, "")}`;
      if (said.toLowerCase() === "none") return null;
    }
  return null;
}

// ── races ───────────────────────────────────────────────────────────────────
// Who attacks whom is the pack's races.script: each race registered with its allies and its enemies
// (`reg.race.allies`, `reg.race.enemies`, "all" for every race). The source, server/stats/races.cpp,
// CRaceManager::Relationship: the allies are read first, then the enemies; neither, and the two leave each
// other alone. Only one side has to hate for a fight: a wolf (rogue) attacks a boar (wildanimal), and the
// boar answers.
/** The race table of races.script's text: `{ race: { allies: [...], enemies: [...] } }`. */
export function raceTable(text) {
  const races = {};
  for (const block of String(text ?? "").split(/\bregisterrace\b/)) {
    const field = (name) => new RegExp(`reg\\.race\\.${name}\\s+(\\S+)`).exec(block)?.[1];
    const name = field("name");
    if (!name) continue;
    const list = (value) => (value ?? "").split(";").map((each) => each.trim().toLowerCase()).filter(Boolean);
    races[name.toLowerCase()] = { allies: list(field("allies")), enemies: list(field("enemies")) };
  }
  return races;
}
/** What a monster of race `a` does to one of race `b`: "ally", "hates" or "none". */
export function raceRelation(races, a, b) {
  const own = races[a];
  if (!own || !races[b]) return "none";
  const holds = (list) => list.includes("all") || list.includes(b);
  return holds(own.allies) ? "ally" : holds(own.enemies) ? "hates" : "none";
}
/**
 * A monster script's race as it spawns: the first `race <name>` of the script itself (a later one is a
 * change of mind in an event: orc_base's `bo_zombie_mode` makes an orc undead), and else of the scripts it
 * takes in, in their order. A name that is no race of the table (a variable, MY_OWNER_RACE) is passed over.
 */
export function scriptRace(script, textOf, races, deep = 0, taken = new Set()) {
  const name = scriptName(script);
  const text = textOf(name);
  if (text === undefined || deep > INCLUDES_DEEP || taken.has(name)) return null;
  taken.add(name);
  for (const [word] of linesOf(text, "race")) if (races[word.toLowerCase()]) return word.toLowerCase();
  for (const words of linesOf(text, "#include")) {
    const race = scriptRace(words[words.length - 1], textOf, races, deep + 1, taken);
    if (race) return race;
  }
  return null;
}

/** The scripts of a folder of loose scripts (and of its folders), named as the pack names them. */
function looseScriptNames(folder, under = "") {
  const names = [];
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) names.push(...looseScriptNames(path, `${under}${name}/`));
    else if (name.toLowerCase().endsWith(SCRIPT_END)) names.push(scriptName(`${under}${name}`));
  }
  return names;
}

// ── the families of held items ──────────────────────────────────────────────
// How the game shows a weapon, read from its item scripts (the pack's items/base_weapon, blunt_base_onehanded,
// shields_base, bows_base and the items named below) and from its model files with `smak info`, 2026-10-13.
//
// In the hands (first person) a family shares ONE file: the arms, every weapon of the family as a submodel
// of the first bodypart, and the animations. An item says which with MODEL_VIEW_IDX, the submodel's number
// (items/base_weapon: `setviewmodelprop ent_me submodel ... MODEL_VIEW_IDX`, done only when it is over 0).
// On the body and on the floor a weapon is 3 or 4 submodels in a row of a `p_weapons` file's one bodypart,
// and an item names the first with MODEL_BODY_OFS: base_weapon shows OFS + 1 - hand (the hand's number is 1
// for the right and 0 for the left) when it is drawn, OFS + 2 when it falls, and shields_base and bows_base
// show OFS + 3 when it is worn on the back. The pose is the animation `<ANIM_PREFIX>_idle` (in a hand) and
// `<ANIM_PREFIX>_floor_idle` (on the floor) of that file, and a new item reuses the prefix of the weapon it
// is laid on: the hand holds it where it held that one.
//
// A family here is what `addItem` of the kit takes (make/items.mjs, docs/ITEMS.md): `like` is the game's own
// weapon each placement is laid on, `bone` the bone that weapon hangs from, `numbers` how the two
// constants follow from where the new submodels land, `constants` what else the item's script sets.
// `script` is the game's item to write the new one after. Files are named from the game's folder.
const VIEW_SHRINK = 2;
const WORLD_SHRINK = 4;
const NUMBERS = { MODEL_VIEW_IDX: "view", MODEL_BODY_OFS: "world" };
/** A row of world placements: `[[like, bone, ending, animation], ...]` in one bodypart of one file. */
const worldRow = (file, shrink, row, more = {}) =>
  row.map(([like, bone, ending, seq]) => ({
    group: "world",
    file,
    bodypart: 0,
    like,
    bone,
    name: `{name}_${ending}`,
    shrink,
    seq,
    ...more,
  }));

export const ITEM_FAMILIES = {
  // items/blunt_mace (41 lines) on items/blunt_base_onehanded. v_1hblunts.mdl: 5 bones, the nine weapons
  // each whole on `skullblade`, then the bodypart `arms`. The 200% charge is `special_02`
  blunt1h: {
    title: "a one-handed blunt weapon: a mace, a hammer, a club",
    script: "items/blunt_mace",
    constants: { MODEL_VIEW: "viewmodels/v_1hblunts.mdl", ANIM_PREFIX: "mace" },
    numbers: NUMBERS,
    placements: [
      {
        group: "view",
        file: "models/viewmodels/v_1hblunts.mdl",
        bodypart: 0,
        like: "mace_ref",
        bone: "skullblade",
        name: "{name}_ref",
        shrink: VIEW_SHRINK,
        view: "first",
        seq: "idle1",
      },
      ...worldRow("models/weapons/p_weapons1.mdl", WORLD_SHRINK, [
        ["mace_rhand", "Bip01 R Hand", "rhand", "mace_idle"],
        ["mace_lhand", "Bip01 L Hand", "lhand", "mace_idle"],
        ["mace_floor", "Bip01 Pelvis", "floor", "mace_floor_idle"],
      ]),
    ],
  },
  // items/shields_buckler on items/shields_base (which sets ANIM_PREFIX allshields and the three
  // p_weapons2 constants itself). v_shields.mdl: the shield on the bone `shield`, five of them, then the
  // bodypart `arm`. Of the game's shields the buckler is the one carried on both forearms (the iron, rune
  // and dark shields' left-hand submodel hangs from `Bip01 L Hand`), so it is the one laid on. A shield in
  // the world keeps half its picture where a weapon keeps a quarter: it fills more of the screen
  shield: {
    title: "a shield, strapped to the forearm",
    script: "items/shields_buckler",
    how: "shield",
    constants: { MODEL_VIEW: "viewmodels/v_shields.mdl" },
    numbers: NUMBERS,
    placements: [
      {
        group: "view",
        file: "models/viewmodels/v_shields.mdl",
        bodypart: 0,
        like: "buckler_ref",
        bone: "shield",
        name: "{name}_ref",
        shrink: 1,
        view: "first",
        seq: "idle1",
      },
      ...worldRow("models/weapons/p_weapons2.mdl", 2, [
        ["buckler_rhand", "Bip01 R Arm2", "rhand", "allshields_idle"],
        ["buckler_lhand", "Bip01 L Arm2", "lhand", "allshields_idle"],
        ["buckler_floor", "Bip01 Pelvis", "floor", "allshields_floor_idle"],
        ["buckler_sheath", "Bip01 Spine3", "sheath", "allshields_idle"],
      ]),
    ],
  },
  // items/bows_treebow on items/bows_base. v_bows.mdl: 55 bones. The Tree Bow's submodel is a stave rigid
  // on `Bone25`, the middle of its string on `Dummy01` (the bone the fingers draw), and its own nocked
  // arrow, three meshes on `smdimport`: every bow's submodel holds its arrow. So a new bow is rigid on
  // Bone25, the corners of its string's middle (which the kit's bow marks `part: 1`) go on Dummy01
  // (`bones`), and the Tree Bow's arrow is taken along as it is (`keep`). In the world a bow is rigid, and
  // is listed left hand first: 4 submodels, the last on the back. (tools/models/weapons.mjs binds the Tree
  // Bow it REPLACES "by the nearest bone", each corner to the bone of the old bow's nearest corner; tried
  // here on a new bow, that sent the stave's belly at the grip to Dummy01 with the string, so the string is
  // named and not guessed)
  bow: {
    title: "a bow: a rigid stave, a string that is drawn, the game's arrow on it",
    script: "items/bows_treebow",
    constants: {
      MODEL_VIEW: "viewmodels/v_bows.mdl",
      MODEL_HANDS: "weapons/p_weapons2.mdl",
      MODEL_WORLD: "weapons/p_weapons2.mdl",
      MODEL_WEAR: "weapons/p_weapons2.mdl",
      ANIM_PREFIX: "treebow",
    },
    numbers: NUMBERS,
    placements: [
      {
        group: "view",
        file: "models/viewmodels/v_bows.mdl",
        bodypart: 0,
        like: "treebow_ref",
        bone: "Bone25",
        name: "{name}_ref",
        shrink: VIEW_SHRINK,
        pick: /^treebow_/i,
        keep: /fletching|darksteel|^longbowdarkwood/i,
        rig: null,
        bones: [null, "Dummy01"],
        view: "first",
        seq: "stretch",
        frame: 40,
      },
      ...worldRow(
        "models/weapons/p_weapons2.mdl",
        WORLD_SHRINK,
        [
          ["treebow_lhand", "Bip01 L Hand", "lhand", "treebow_idle"],
          ["treebow_rhand", "Bip01 R Hand", "rhand", "treebow_idle"],
          ["treebow_floor", "Bip01 Pelvis", "floor", "treebow_floor_idle"],
          ["treebow_sheath", "Bip01 Spine3", "sheath", "treebow_idle"],
        ],
        { rig: null },
      ),
    ],
  },
  // The same bow laid on the Long Bow, whose limbs hang from six bones that bend them as the string is
  // drawn (Bone16, Bone28, Bone01, Bone27, Bone26 beside Bone25): each corner of the new stave takes the
  // bone of the Long Bow's nearest corner (`rig: "nearest"`) and bends as the Long Bow does; the string's
  // middle is named, as above. NOT tried in the game; a stave of another curve than the Long Bow's takes the
  // bones of whatever part of it is nearest, and may crease where two bones meet
  bow_bending: {
    title: "a bow whose limbs bend, bound to the Long Bow's bones (untried)",
    script: "items/bows_longbow",
    constants: {
      MODEL_VIEW: "viewmodels/v_bows.mdl",
      MODEL_HANDS: "weapons/p_weapons2.mdl",
      MODEL_WORLD: "weapons/p_weapons2.mdl",
      MODEL_WEAR: "weapons/p_weapons2.mdl",
      ANIM_PREFIX: "longbow",
    },
    numbers: NUMBERS,
    placements: [
      {
        group: "view",
        file: "models/viewmodels/v_bows.mdl",
        bodypart: 0,
        like: "longbow_ref",
        bone: "Bone25",
        name: "{name}_ref",
        shrink: VIEW_SHRINK,
        pick: /^longbow(string|h|wood)\./i,
        keep: /fletching|darksteel|darkwood/i,
        rig: "nearest",
        bones: [null, "Dummy01"],
        view: "first",
        seq: "stretch",
        frame: 40,
      },
      ...worldRow(
        "models/weapons/p_weapons2.mdl",
        WORLD_SHRINK,
        [
          ["longbow_lhand", "smdimport", "lhand", "longbow_idle"],
          ["longbow_rhand", "Bip01 R Hand", "rhand", "longbow_idle"],
          ["longbow_floor", "Bip01 Pelvis", "floor", "longbow_floor_idle"],
          ["longbow_sheath", "Bip01 Spine3", "sheath", "longbow_idle"],
        ],
        { rig: null },
      ),
    ],
  },
};

// ── playing it ──────────────────────────────────────────────────────────────
// PLAYING IT (cli/play.mjs). All of it seen in the game on 2026-10-13, in a local browser build with one
// saved character and a page of 1024 by 768.
//
// GETTING IN. A loaded map prints "Custom resource propagation complete." and shows the character cards a
// few seconds later; ONE click on the first card, at (512, 330), chooses the character and enters (a second
// click is a swing of the fist). The cards take no click until they are drawn, so the click is done again
// every second until the box "Welcome to Master Sword" comes: the game sends it, and then the player's
// health (the HP message), a tenth of a second after the click that was taken, and the player stands in
// the world. Measured: 8 s for the engine, 8 s for a small map (4 s the second time in one session), under
// a second to enter once the cards are drawn, where the clock was waited out for 65 s before.
//
// WHAT THE GAME SAYS. Nearly all of it goes to the player in the user message HUDInfoMsg (the source,
// server/Player/playershared.cpp: SendHUDMsg, SendHelpMsg, SendEventMsg; read by the client in
// client/MasterSword/vgui_hud.cpp, __MsgFunc_HUDInfoMsg), whose first byte is its kind:
//   0  a box: its title, its text                                (an ms_text, "has gained", a map's name)
//   1  a line of the event console: four bytes of colour, the text  ("HIT! 4.0 holy damage", a kill, a
//      script's playermessage)
//   2  a part of a help tip: its number, the text; 3 the tip's title, which shows the parts together
//   4  a line of speech: a byte for who hears (0 all, 1 near, 2 the party), the text
// The client prints a line of kind 1 to the console only when it scrolls off the HUD, a line at a time and
// seconds late, and never again once its ten places have each been printed from; a box is never printed.
// So the message itself is read. A script's `consolemsg` and the game's own notes are TextMsg, the SDK's.
// HP and MP are a short and a byte that is 1 for the most the player can have.
//
// THE "GRAPHICS TEST". The first time a player enters after the game has started, his script puts a picture
// over the middle of the screen for ten seconds ("We will now test your system for compatability with
// advanced OpenGL features": player/player_cl_effects_special, bloom_check, asked at post_first_join), and
// then sets the client's cvar ms_didbloomcheck to 1 so as not to show it again; a browser's game keeps no
// configuration, so every start shows it once. The cvar is set before the click that enters: no picture.
//
// SAYING. An NPC hears local speech only. `say <text>` speaks in the player's current way, which the
// command `setsay` moves on by one each time it is given (all, near, the party: client/MasterSword/
// HUDMisc.cpp, UserCmd_ChangeSayType), so "setsay, say" spoke near once and to the party the next time.
// The server's own `say_text <way> <text>` says it in the way named (server/client.cpp, ClientCommand2);
// the client has a command of that name that opens the chat line instead, so it is sent past the client
// with the engine's `cmd`. An NPC answered a say 9 to 27 seconds after it in a build drawn in software.
//
// GOING TO A PLACE. The game has no command for it; `trial goto` is the command of a helper script for the
// local game (trial/commands, in the repository this profile was written in: it also gives items and
// skills). A map without that script refuses a `goto` step in a sentence, since the place is read back.
//
// FIGHTING. The left button held CHARGES a blow and does not strike: a blow is the button pressed and let go
// (a tap), and a wall that breaks is broken by taps. Where an enemy is, the game tells nobody: `trial
// nearest` of the same helper script asks the player's own script for the living things that hold him for
// an enemy and answers with the nearest: the middle of its box, how far, how many there are within the
// radius asked and how many within 128 of him. Health is given back by `trial heal`. The lines a fight is
// counted by, as the game writes them (seen 2026-10-13):
//   You attack the Living Dead. (72/12) HIT! 8.9 slash damage.      You attack the Living Dead. (11/12) MISS!
//   The Enraged Skeleton attacks you. (62/30) HIT! 9.2 slash damage.
//   You've slain the Awakened Guardian          <the character> has fallen!          HP 313, MaxHP 318
// A fallen player rises where the map begins, by himself, his health whole.
const HUD = { box: 0, event: 1, tipPart: 2, tip: 3, speech: 4 };
const tipParts = [];
/** The strings of a message's bytes from `from` on, each ended by a 0. */
const stringsFrom = (bytes, from) =>
  String.fromCharCode(...bytes.slice(from))
    .split("\0")
    .map((text) => text.replace(/\|/g, "\n"));
/** A box, a tip: its title and its text on one line, the text's own lines parted by " | ". */
const boxLine = (title, text) => {
  const said = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" | "); // prettier-ignore
  // a box with no title (a map's ms_text has none) is its text alone
  return title.trim() ? `${title.trim()}: ${said}` : said;
};
/** HUDInfoMsg read: the lines the player is shown. */
export function hudInfoLines(bytes) {
  const kind = bytes[0];
  if (kind === HUD.box) {
    const [title = "", text = ""] = stringsFrom(bytes, 1);
    return boxLine(title, text);
  }
  if (kind === HUD.event) return stringsFrom(bytes, 5)[0]?.split(/\r?\n/) ?? null;
  if (kind === HUD.tipPart) {
    if (!bytes[1]) tipParts.length = 0;
    tipParts.push(stringsFrom(bytes, 2)[0] ?? "");
    return null;
  }
  if (kind === HUD.tip) return boxLine(stringsFrom(bytes, 1)[0] ?? "", tipParts.splice(0).join(""));
  if (kind === HUD.speech) return stringsFrom(bytes, 2)[0]?.split(/\r?\n/) ?? null;
  return null;
}
/** HP and MP read: "HP 210", and "MaxHP 234" for the most the player can have. */
const amountLine = (name) => (bytes) => `${bytes[2] ? "Max" : ""}${name} ${bytes[0] | (bytes[1] << 8)}`;
/** The way of speaking an NPC hears: near (the source, server/Monsters/MSMonster.h, SPEECH_LOCAL). */
const SPEECH_NEAR = 1;

const PLAY = {
  enter: [
    { command: "ms_didbloomcheck 1", wait: 0 },
    { click: [512, 330], every: 1000, until: "^Welcome to Master Sword", within: 60000 },
  ],
  say: [`cmd say_text ${SPEECH_NEAR} {text}`],
  loads: 90000,
  loaded: "Custom resource propagation complete",
  goto: ["trial goto {x} {y} {z}"],
  // put 4 over the place asked, he drops onto the floor: at its own height a path brush 2 high held him fast
  // (setorigin puts the box where it is told, and a box in a brush does not move: seen in the orchard, 2026-10-15)
  lift: 4,
  heal: ["trial heal"],
  // a way to another map (msarea_transition) asks "Press (enter) to continue": `accept` is the command the
  // key gives; the engine says "Spawn Server: <map>" as the next map's server starts (Xash3D FWGS, engine/server/sv_init.c, SV_SpawnServer)
  travel: { commands: ["accept"], spawned: /Spawn Server: (\S+)/ },
  target: {
    commands: ["trial nearest {radius}"],
    answer:
      /^TRIAL nearest (?<id>\S+) hp (?<hp>\S+) at \((?<x>[-\d.]+),(?<y>[-\d.]+),(?<z>[-\d.]+)\) far (?<far>\S+) count (?<count>\d+) close (?<close>\d+) name (?<name>.*)$/,
    none: /^TRIAL nearest none/,
    // `trial prefer <word>`: from then on `trial nearest` answers with the nearest whose name holds the word
    // (lowercase), the nearest of all when none does; `trial prefer none` undoes it. A fight's `prefer`
    prefer: ["trial prefer {word}"],
    unprefer: ["trial prefer none"],
    // `trial skip <index>`: from then on `trial nearest` passes over that monster (one a fight cannot get at)
    skip: ["trial skip {id}"],
  },
  // `trial census <radius>`: every living monster within it, the player's enemies and the rest
  census: {
    commands: ["trial census {radius}"],
    count: /^TRIAL census (?<count>\d+) within/,
    one: /^TRIAL census one (?<name>.*) hp (?<hp>\S+) at \((?<x>[-\d.]+),(?<y>[-\d.]+),(?<z>[-\d.]+)\) relate (?<relate>\S+)$/,
  },
  // A RANGED WEAPON. A bow is drawn while the left button is held and loosed when it is let go: base_ranged's
  // attack is "charge-throw-projectile" (scripts/items/base_ranged), drawn to the full between hold_min and
  // hold_max (bows_base: 1.1 and 1.3 s; msc/game/server/Weapons/giattack.cpp, ChargeThrowProj: the shot's speed
  // is RANGED_FORCE times the share of hold_max held), so 1.4 s. Arrows are a quiver's (or a pack's); with none
  // the game gives a blunt one free (UseAmmo: proj_arrow_generic, proj_bolt_generic). An arrow falls at
  // sv_gravity 800 times its own 0.7 to 0.75. A weapon goes into the hands by its quickslot: the server's
  // `quickslot create <n> current` (sent past the client, which has a command of that name) makes slot n+1
  // what is in the hands, and the client's `+quickslot <n>` let go within 2 s does `inv transfer <id> 0`
  // (client/MasterSword/vgui_QuickSlot.h, SlotPressed and ConfirmItem), which puts away what was held. So the
  // melee weapon held is made slot 10 as the bow is drawn, and slot 10 puts it back. The test characters keep
  // their bow in slot 1 (msr-web maps/trial/chars). A spell (magic_hand_*) is put into the hands by `prep`.
  // `trial hands <item>` says whether it is held. Seen 2026-10-16: a Thornbow drawn from the back, two arrows
  // into a dummy 400 off by a plain aim, the Short Sword back in the hands.
  ranged: {
    draw: ({ item, slot }) => ["cmd quickslot create 9 current", ...(/^magic_hand_/.test(item) ? [`cmd prep ${item}`] : [`+quickslot ${slot}`, `-quickslot ${slot}`])], // prettier-ignore
    back: ["+quickslot 10", "-quickslot 10"],
    held: { commands: ["trial hands {item}"], answer: /^TRIAL hands \S+ (?<held>[01])$/ },
    hold: 1400,
    drawn: 1000,
    // the console's +attack, which the left button is bound to: a press of the page's mouse started a draw half as
    // often (2026-10-16, a dummy 300 off: 8 of 24 by the mouse, 11 of 24 by +attack, the same aim each time)
    button: "attack",
    // RANGED_FORCE of each (scripts/items/bows_*): units a second at a full draw
    speeds: { bows_thornbow: 1700, bows_longbow: 2100, bows_shortbow: 1000, bows_orcbow: 900, bows_crossbow_light: 1000 },
    gravity: 580,
  },
  fight: {
    attack: [{ tap: "left", ms: 200, every: 700 }],
    dealt: /^You attack .*HIT! ([\d.]+)/,
    missed: /^You attack .*MISS!/,
    taken: / attacks you\..*HIT! ([\d.]+)/,
    slain: /^You've slain (.*)$/,
    died: / has fallen!$/,
    health: /^HP (\d+)$/,
    maxHealth: /^MaxHP (\d+)$/,
  },
  messages: {
    HUDInfoMsg: hudInfoLines,
    TextMsg: "textmsg",
    SayText: "saytext",
    HP: amountLine("HP"),
    MP: amountLine("MP"),
  },
  screen: [1024, 768],
};

// ── the profile ─────────────────────────────────────────────────────────────
/** The classes a monster's template is written as: every `msmonster_*`, the NPCs and the chests. */
const TEMPLATES = ["msmonster_*", "ms_npc", "msnpc_*", "msworlditem_treasure"];
const AREAS = ["ms_monsterspawn", "msarea_monsterspawn"];

/**
 * Master Sword Classic's profile, made from the installed game.
 *
 *   game      the Half-Life folder (the one that holds `msc` and `valve`); or
 *   folders   the game's folders themselves, the mod's first: `[<Half-Life>/msc, <Half-Life>/valve]`
 *   scripts   folders of loose scripts that are not in the game's pack yet (a new map's own), each laid out
 *             as the pack is: `<folder>/orchard/keeper.script` is the script `orchard/keeper`
 *   cache     a file to keep what the maps teach in (unless told: one in the system's temp folder)
 */
export default function masterSword({ game, folders, scripts = [], cache } = {}) {
  const home = folders?.length ? folders : game ? [join(game, MOD_FOLDER), join(game, "valve")] : null;
  if (!home || !existsSync(home[0]))
    throw new Error(
      `the Master Sword profile is made from the installed game: give { game: <the Half-Life folder> } or { folders: [<Half-Life>/msc, <Half-Life>/valve] }${home ? ` (${home[0]} is not there)` : ""}`,
    );
  const mod = home[0];
  const fgd = FGDS.map((file) => join(mod, file)).filter((file) => existsSync(file));

  // the scripts: the pack's, and the loose ones given
  const pack = join(mod, SCRIPT_PACK);
  const known = new Set(scripts.flatMap((folder) => looseScriptNames(folder)));
  if (existsSync(pack)) for (const name of packScriptNames(readFileSync(pack))) known.add(name);
  const haveScripts = known.size > 0;

  // the scripts' texts, read when a picture first asks for a model: the loose ones stand over the pack's,
  // as they do in a pack made from them
  let texts = null;
  const models = new Map();
  const textOf = (name) => {
    if (!texts) {
      texts = existsSync(pack) ? packScripts(readFileSync(pack)) : new Map();
      for (const folder of scripts)
        for (const [script, file] of looseScriptFiles(folder))
          texts.set(script, readFileSync(file, "latin1"));
    }
    return texts.get(name);
  };
  const items = new Set(
    [...known].filter((name) => name.startsWith(ITEMS)).map((name) => name.slice(ITEMS.length)),
  );
  // the race table and each script's race, read when first asked
  let races = null;
  const raceOf = new Map();

  // the FGD writes reqhp as a whole number ("Req. Total HP (min;max)" : 0), and the game reads "min;max":
  // the key is given its true kind on every class the FGD gives it to
  // and it draws a spawn area as brushes, where the game has one class under two names (the source,
  // server/msmapents.cpp: msarea_monsterspawn and ms_monsterspawn are both CAreaMonsterSpawn) and the maps
  // write either name as a point (67 of 1232 msarea_monsterspawn have no brush)
  const classes = {};
  if (fgd.length)
    for (const [name, defined] of Object.entries(definitionsOf(fgd).classes))
      if (defined.keys.reqhp) classes[name] = { keys: { reqhp: { type: "string" } } };
  for (const area of AREAS) classes[area] = { ...classes[area], kind: "either" };

  // the names players arrive by: every `desttrans` a transition of the game's maps sends them on with
  let arrivals = null;
  const arrivesBy = (name) => {
    if (!arrivals) {
      arrivals = new Set();
      const mapsFolder = join(mod, "maps");
      for (const file of existsSync(mapsFolder) ? readdirSync(mapsFolder) : [])
        if (/.bsp$/i.test(file))
          for (const entity of entitiesOfFile(join(mapsFolder, file)) ?? [])
            for (const [key, value] of entity) if (key === "desttrans") arrivals.add(value);
    }
    return arrivals.has(name);
  };

  return {
    name: "mastersword",
    title: "Master Sword Classic",
    folders: home,
    // the classes that exist are the ones the program exports: the FGD and the hundred maps both lack
    // msmonster_giantspider, which the source links (server/monsters/msmonsterserver.cpp) and ms.dll has
    dlls: [join(mod, PROGRAM)].filter((file) => existsSync(file)),
    fgd,
    // the maps beside the FGD: ms1.4.fgd says of itself that it is to be put together with halflife.fgd,
    // and forgets classes and keys the maps use daily (msmonster_random, ms_counter's keys, params...)
    learned: { maps: join(mod, "maps"), cache: cache ?? join(tmpdir(), "smak-mastersword-entities.json") },
    classes,

    // where a player comes into a map: a new character at an ms_player_begin, one who comes from another
    // map at an ms_player_spawn (the source, server/player/player.cpp: LINK_ENTITY_TO_CLASS of the two)
    starts: ["ms_player_begin", "ms_player_spawn"],
    // what walks: the FGD's ms_basenpc, `size(-16 -16 0, 16 16 72)`: a standing hull with its origin at the feet
    walkers: ["msmonster_*", "ms_npc", "msnpc_*"],
    origin: { starts: "middle", walkers: "feet" },

    // a player leaves a map by an msarea_transition (the source, server/msmapents.cpp, CAreaTransition);
    // one switched off (`disabled_msarea_transition`) is another class, and no way out
    exits: ["msarea_transition"],
    // what is fired by name and never gone to (the walk test's `wiring`). The source, server/msmapents.cpp:
    // ms_text is a game_text under another name (LINK_ENTITY_TO_CLASS(ms_text, CGameText)); a spawn area,
    // under either of its names and with a brush or without, is a CAreaInvisible (SOLID_NOT, no Touch) that
    // thinks or is fired (CAreaMonsterSpawn::Spawn sets a think or waits for ResetUse): where its own
    // origin is says nothing, its monsters are entities of their own; every mstrig_ is fired (mstrig_music,
    // mstrig_weather, mstrig_stopspawn; mstrig_multi is a multi_manager)
    wiring: ["ms_text", "ms_monsterspawn", "msarea_monsterspawn", "mstrig_*"],
    // a point a script puts something at (a chest at an info_target) is named by the map that has one, with
    // the walk test's `markers`: of the class alone it cannot be said, an info_target is as often a beam's end
    markers: [],

    // what a monster, an NPC or a chest looks like is in its script (`scriptModel`, above)
    modelOf: (keys) => {
      const script = keys.scriptfile ?? keys.defscriptfile;
      if (!script || !isNamed(TEMPLATES, keys.classname)) return null;
      if (!models.has(script)) models.set(script, scriptModel(script, textOf));
      return models.get(script);
    },

    // a classname the game does not have is an entity switched off, and the mappers do it on purpose:
    // the maps have 20 classes written `disabled_<class>`, 5 `disable_<class>` and 5 `<class>_disabled`;
    // and 28 entities in 9 maps are a mapper's note to the next, `remark_<name>`
    off: ["disabled_*", "disable_*", "*_disabled", "remark_*"],

    // the families of held items (above): what `smak item --family` and `addItem` take
    items: ITEM_FAMILIES,

    // How a script is named, for placing scripts of one's own against the pack's (scripts.mjs, `smak
    // scripts`). The pack is laid over by name: a file at a path the pack has takes that script's place,
    // and one at any other path is a new script, which is read only if something names it.
    //   by a map: `scriptfile` and `defscriptfile` (a script's path), and an msitem_spawn's `scriptfile`
    //     (an item's name: the script is items/<name>)
    //   by a script: its path as a word of any line (#include, createnpc, callexternal, clientevent,
    //     applyeffect, precachefile ... : the commands are too many to list and all write the path whole),
    //     and an item by its bare name
    //   by the game itself: <map>/map_startup, taken in by the pack's world.script with
    //     `#include [casual] $currentmapscript` (the source, shared/ms/script.cpp: the map's name and
    //     "/map_startup"); and an item, which the game knows by its name once the pack's items.txt lists
    //     it (server/weapons/genericitem.cpp reads that list and makes "items/<name>" of each line). The
    //     list of a pack one builds is not seen here: a new script of items/ that is not a player's-side
    //     one (`_cl`) is taken to be listed, as a builder that lists every such script does, and that is
    //     said in its line
    scriptPack: {
      shipped: (folder) =>
        folder ? unpackedScripts(folder) : existsSync(pack) ? packScripts(readFileSync(pack)) : new Map(),
      loose: (folder) =>
        new Map(
          [...looseScriptFiles(folder)].map(([name, file]) => [name, { text: readFileSync(file, "latin1"), file }]), // prettier-ignore
        ),
      ofEntity: (keys) =>
        [keys.scriptfile, keys.defscriptfile]
          .filter((value) => typeof value === "string" && value)
          .map((value) =>
            keys.classname === "msitem_spawn" ? `${ITEMS}${scriptName(value)}` : scriptName(value),
          ),
      aliases: (name) => (name.startsWith(ITEMS) ? [name.slice(ITEMS.length)] : []),
      // a desc over 72 characters, a name with its prefix over 29: what the game cuts (scriptLint)
      lint: (name, text) => scriptLint(text),
      started: (name, { maps }) => {
        const map = MAP_STARTUP.exec(name)?.[1];
        if (map)
          return maps.some((each) => each.toLowerCase() === map)
            ? `the game itself, when the map ${map} starts`
            : null;
        if (name.startsWith(ITEMS) && !name.slice(ITEMS.length).includes("/") && !CLIENT_SIDE.test(name))
          return "the list of items, if the pack's items.txt has its name (a builder that lists every new script of items/ puts it there)";
        return null;
      },
      // the maps the game has, by name: a map_startup is run for one of these, or for one given
      maps: () => {
        const folder = join(mod, "maps");
        return (existsSync(folder) ? readdirSync(folder) : [])
          .filter((file) => /\.bsp$/i.test(file))
          .map((file) => file.replace(/\.bsp$/i, ""));
      },
    },

    // playing it (cli/play.mjs): see PLAYING IT, above
    play: PLAY,

    // A map's character against the game's own (character.mjs, `smak map-character`): what is a prop, a
    // sound and music here, and the figures of 94 of the game's 100 maps (all but char_recover,
    // test_scripts, the three pvp_ maps and ms_soccer), [lower quartile, median, upper quartile], measured
    // with `learnCharacter` on 2026-10-16, the light again on 2026-10-17 with switched lights counted as the
    // maps start (47 of the 94 have them; the rest is as it was). The two maps of a gauntlet first made with this kit were under
    // them where a player said they looked plain: the Barrow Road, "all straight lines" (walls 6.9% off the
    // grid, no slope, 4 levels, 10 textures), and the Old Orchard, lit evenly (152 on its floor, 2% in shadow)
    character: {
      from: "the game's 94 maps",
      props: ["env_model"],
      sounds: ["ambient_generic", "env_sound"],
      music: ["msarea_music", "msarea_music_dynamic", "mstrig_music"],
      figures: {
        offGrid: [22, 34.4, 50.8],
        sloped: [8.2, 15.4, 30.8],
        levels: [7, 10, 13],
        heightSpread: [257, 406, 637],
        textures: [27, 44, 67],
        sounds: [1, 6, 20],
        shadow: [17, 38, 55],
        brightest: [188, 245, 250],
        lightMean: [29.9, 49.3, 78],
        props: [0, 13, 36],
        lights: [5, 24, 43],
        music: [1, 2, 5],
        floorArea: [9121724, 16127686, 25042429],
        faces: [7808, 10547, 13967],
      },
    },

    // How monsters come into a map (encounters.mjs, `spawnsOf`, `smak map-spawns`). The source,
    // server/msmapents.cpp, CAreaMonsterSpawn: an area fills 3 s after the map starts unless `spawnstart 1`,
    // then when it is fired (ResetUse); it fires `fireallperish` when every template has used up its lives.
    // A template (msmonsterserver.cpp) names its area by `spawnarea`; `lives` 0 or none is without end; it
    // comes back after delaylow-delayhigh seconds at its own origin; `reqhp` "min;max" its band;
    // `killtarget` and `perishtarget` fire as it dies; `scriptfile` stands over `defscriptfile`, and with
    // neither it is NPCs/default_human. The game fires game_playerspawn as a player enters the world
    // (server/player/player.cpp): challs fills its nine halls by a trigger_relay of that name. A script
    // fires a name by `usetrigger <name>`.
    spawns: {
      areas: AREAS,
      templates: TEMPLATES,
      area: "spawnarea",
      waits: { key: "spawnstart", value: "1" },
      cleared: "fireallperish",
      dies: ["killtarget", "perishtarget"],
      lives: "lives",
      endless: ["0", ""],
      delay: ["delaylow", "delayhigh"],
      band: { key: "reqhp", separator: ";" },
      script: (keys) => {
        const name = keys.scriptfile || keys.defscriptfile;
        return name ? scriptName(name) : keys.classname === "msworlditem_treasure" ? null : "npcs/default_human";
      },
      scriptKey: "scriptfile",
      race: (script) => {
        if (!races) races = raceTable(textOf("races"));
        if (!raceOf.has(script)) raceOf.set(script, scriptRace(script, textOf, races));
        return raceOf.get(script);
      },
      relation: (a, b) => {
        if (!races) races = raceTable(textOf("races"));
        return raceRelation(races, a, b);
      },
      // a chest: the class of one, or a script of chests/
      reward: (script, keys) => keys.classname === "msworlditem_treasure" || script.startsWith("chests/"),
      arrival: ["game_playerspawn", "game_playerjoin"],
      touches: ["trigger_once", "trigger_multiple"],
      fires: (script) => {
        const text = textOf(script);
        return text === undefined ? [] : linesOf(text, "usetrigger").map((words) => words[0]);
      },
    },

    targets: {
      // perishtarget: fired on a monster's last death (the source, server/monsters/msmonsterserver.cpp,
      // CMSMonster::KeyValue); fireallperish: fired by a spawn area when all its monsters have perished
      // (server/msmapents.cpp, CAreaMonsterSpawn::KeyValue)
      keys: [...GOLDSRC.targets.keys, "perishtarget", "fireallperish"],
      // mstrig_multi is multi_manager under another name (server/triggers.cpp links both to CMultiManager)
      others: [...GOLDSRC.targets.others, "mstrig_multi"],
    },

    // music: an msarea_music or an mstrig_music names its songs as KEYS, each with its length as the value
    // ("mschalls.mp3" "2:00"), or as `song`; the files are in msc/music (the maps: 291 msarea_music in 78
    // maps). "stop.mp3" stops the music and is no file
    files: [
      {
        classes: ["msarea_music", "mstrig_music", "msarea_music_dynamic"],
        key: "song",
        keys: "*.mp3",
        folders: ["music", ""],
        unless: ["stop.mp3", "none"],
        what: "music files",
      },
    ],

    rules: [
      // A player who has connected and not yet chosen his character is put at an ms_player_spec, or with
      // none at any ms_player_spawn; with neither the game finds him no place and drops him (the source,
      // server/player/player.cpp: SPAWN_SPECTATE, then SPAWN_GENERIC, then "No valid spots, kick player",
      // which on a listen server is a "disconnect"). A place to begin (ms_player_begin) does not count.
      // The maps: 38 of 100 have an ms_player_spec, and the rest an ms_player_spawn. Seen 2026-10-13: a yard
      // with a place to begin and neither of the two ended at "disconnected from server" every time, and
      // loaded once it was given an ms_player_spec.
      (live) =>
        live.some((entity) => entity.classname === "ms_player_spec" || entity.classname === "ms_player_spawn")
          ? []
          : [
              {
                level: "error",
                text: "the map has neither an ms_player_spec nor an ms_player_spawn: the game has nowhere to put a player who has connected and not yet chosen a character, and drops him at once (an ms_player_begin does not count)",
              },
            ],
      // A spawn area holds 32 monsters. The source, server/msmapents.cpp: class CAreaMonsterSpawn has
      // `monster_data_t mdSpawnMonster[32]`, and every monster that names the area by `spawnarea` takes
      // one place in it.
      {
        rule: "limit",
        key: "spawnarea",
        most: 32,
        to: AREAS,
        why: "a spawn area holds 32 monsters, mdSpawnMonster[32] in the game's msmapents.cpp: the rest never appear",
      },
      // `reqhp` is read only through a spawn area. The source: CMSMonster::KeyValue
      // (server/monsters/msmonsterserver.cpp) keeps it in m_HPReq_min and m_HPReq_max, and the only code
      // that looks at them is the spawn area's, which copies them into its own table when the monster
      // names it (msmapents.cpp, hpreq_min = pMonster->m_HPReq_min). A monster that stands in the map by
      // itself appears whatever the players' health. "0" asks for nothing, and the editors write it.
      {
        rule: "beside",
        classes: TEMPLATES,
        key: "reqhp",
        needs: "spawnarea",
        unless: ["", "0"],
        why: "the game reads reqhp only for a monster that names a spawn area: here it does nothing",
      },
      // `reqhp "min;max"`, or "min" alone for no upper end ("avg" after it has the players' average
      // counted and not their sum: msmonsterserver.cpp, the same function). Templates that stand at one
      // place of one area with different ranges are the same monster for different parties: the ranges are
      // to meet, so that someone appears whatever the health, and not to overlap, so that two do not.
      // The numbers are whole (atoi): "1;2000" and "2001" meet, as the game's own maps write them.
      // A place left empty in a band on purpose says so on its templates: `reqhp_none "150;500"` (ranges
      // parted by commas). The game reads no such key (it is ours, a note for this check), and the gap is
      // then no fault; a band said to be empty that a template has is one.
      {
        rule: "bands",
        classes: TEMPLATES,
        key: "reqhp",
        open: "reqhp_none",
        among: ["spawnarea", "origin"],
        separator: ";",
        words: ["avg"],
        whole: true,
        why: "one place of a spawn area, one monster for each strength of party",
      },
      // `fireallperish` fires when every monster of the area has used up its lives, and a monster with no
      // `lives`, or with 0, has them without end. The source: msmonsterserver.cpp, "if (!m_Lives) m_Lives
      // = -1; //zero == infinite lives", and the area's count in msmapents.cpp, which only ever counts down
      // a monster whose lives are over 0.
      {
        rule: "finite",
        classes: AREAS,
        when: "fireallperish",
        counted: "spawnarea",
        count: "lives",
        why: "fireallperish fires when every monster of the area has used up its lives; with no lives, or 0, a monster has them without end and it never fires",
      },
      // A player appears at an ms_player_spawn whose `message` is the name of the transition he came by.
      // The source, server/player/player.cpp: GetRandomSpawnSpot passes over every spot whose `message` is
      // not the player's transition, and that name is the `targetname` of the msarea_transition he last
      // touched in this map (msmapents.cpp, m_OldTransition) or the `desttrans` of the one that sent him
      // here from another. So `message` is to name a transition of this map, or a `desttrans` some map of
      // the game sends players on with; a spawn with no `message` is found by nobody but the fallbacks
      // (the maps: 769 of 852 ms_player_spawn give one). A transition that is switched off still names.
      {
        rule: "names",
        classes: ["ms_player_spawn"],
        key: "message",
        required: true,
        of: { classes: ["*msarea_transition*"] },
        among: (name) => arrivesBy(name),
        what: "the targetname of a transition (msarea_transition) of this map, nor a desttrans of any of the game's maps",
        why: "a player arrives at the ms_player_spawn whose message is the transition he came by",
      },
      // An msitem_spawn's `scriptfile` is an item's NAME, not a script's path: "item_key_rusty", never
      // "items/item_key_rusty". The source: shared/weapons/gispawn.cpp keeps it and hands it to the item
      // list, which knows items by name. The maps: 74 msitem_spawn, every `scriptfile` a bare name.
      {
        rule: "names",
        classes: ["msitem_spawn"],
        key: "scriptfile",
        required: true,
        among: (name) =>
          !haveScripts ||
          items.has(name.toLowerCase()) ||
          (known.has(scriptName(name))
            ? `an item is named without its folder: ${name.replace(/\\/g, "/").split("/").pop()}`
            : false),
        what: "an item's name (a script of the pack's items/ folder, without the folder)",
        why: "an msitem_spawn's scriptfile is an item's name",
      },
      // `scriptfile` and `defscriptfile` name a script of the pack, by its path without ".script":
      // "monsters/skeleton". The source: msmonsterserver.cpp takes either as m_ScriptName, and the scripts
      // are looked for in dlls/sc.dll (shared/ms/groupfile.cpp) and nowhere else in a released game.
      ...["scriptfile", "defscriptfile"].map((key) => ({
        rule: "names",
        classes: TEMPLATES,
        key,
        among: (name) => !haveScripts || known.has(scriptName(name)),
        what: `a script of the game's pack (${SCRIPT_PACK}) or of the script folders given`,
        why: "a monster with no script is nothing",
      })),
    ],
  };
}
