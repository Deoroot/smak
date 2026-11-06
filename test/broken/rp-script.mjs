// The script check (levels/rp/script.mjs checkScript, checkRp) broken in one way each: an unknown NPC, an unknown
// action or condition, a line too long, a menu of eight options or three deep, a repeated rule id, a bad flag name,
// a file of another map, and the warnings (money that can be farmed, a rule that never runs, a flag nothing tests,
// accents). The test map's script is the whole twin.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { checkScript, checkRp } from "../../levels/rp/script.mjs";

const script = JSON.parse(readFileSync(join(HERE, "../levels/rp/scripts/smak_rp_mtest.script.json"), "utf8"));
const rp = { format: "smak-rp/1", map: "smak_rp_mtest", npcs: [{ id: "fixer", name: "Marco the Fixer", at: [-2592, 256, 0] }] };
const copy = (o) => JSON.parse(JSON.stringify(o));
/** The errors checkScript gives the script after `change` is made to a copy of it. */
const errors = (change, options = { rp }) => {
  const s = copy(script);
  change?.(s);
  return checkScript(s, options).errors;
};
/** The same, for the warnings. */
const warnings = (change) => {
  const s = copy(script);
  change?.(s);
  return checkScript(s, { rp }).warnings;
};
const whole = () => errors();
const wholeWarnings = () => warnings();
const rule = (s, id) => s.rules.find((r) => r.id === id);

broken("checkScript", "a rule for an NPC the map does not have", {
  said: /rule fixer_first: the NPC "ghost" is not in the rp\.json \(it has: fixer\)/,
  broken: () => errors((s) => (rule(s, "fixer_first").npc = "ghost")),
  whole,
});
broken("checkScript", "an action that is not in the list", {
  said: /rule fixer_first: unknown action "teleport_all"/,
  broken: () => errors((s) => rule(s, "fixer_first").do.push({ teleport_all: 1 })),
  whole,
});
broken("checkScript", "a condition that is not in the list", {
  said: /rule say_hello: unknown condition "mood"/,
  broken: () => errors((s) => (rule(s, "say_hello").if = [{ mood: 3 }])),
});
broken("checkScript", "a say line over the chat's limit", {
  said: /rule say_hello: a say line is 201 bytes, at most 150/,
  broken: () => errors((s) => (rule(s, "say_hello").do[0].say = "x".repeat(201))),
});
broken("checkScript", "a menu with eight options", {
  said: /rule fixer_first > menu: a menu has 1 to 7 options/,
  broken: () =>
    errors((s) => {
      const m = rule(s, "fixer_first").do[1].open_menu;
      while (m.options.length < 8) m.options.push({ text: `Opcion ${m.options.length}`, do: [{ say: "Si." }] });
    }),
});
broken("checkScript", "menus three deep", {
  said: /menus inside menus go 2 deep at most/,
  broken: () =>
    errors((s) => {
      const inner = { open_menu: { title: "c", options: [{ text: "x", do: [{ say: "Si." }] }] } };
      const mid = { open_menu: { title: "b", options: [{ text: "y", do: [inner] }] } };
      rule(s, "fixer_first").do[1].open_menu.options[1].do = [mid];
    }),
});
broken("checkScript", "a rule id used twice", {
  said: /rule fixer_first: the id is used twice/,
  broken: () => errors((s) => (rule(s, "fixer_back").id = "fixer_first")),
});
broken("checkScript", "a flag name in capitals", {
  said: /rule fixer_first > menu option 1: set_flag must be 1 to 24 characters of a-z 0-9 _, not "Asked"/,
  broken: () => errors((s) => (rule(s, "fixer_first").do[1].open_menu.options[0].do[1].set_flag = "Asked")),
});
broken("checkScript", "a file for another map", {
  said: /the file is for map other_map, the rp\.json is for smak_rp_mtest/,
  broken: () => errors((s) => (s.map = "other_map")),
});
broken("checkScript", "a format that is not smak-script/1", {
  said: /format is "smak-script\/2", expected "smak-script\/1"/,
  broken: () => errors((s) => (s.format = "smak-script/2")),
});
broken("checkScript", "a rule key that is not in the format", {
  said: /rule noon_line: unknown key "when"/,
  broken: () => errors((s) => (rule(s, "noon_line").when = 12)),
});
broken("checkScript", "an hour rule with no hour", {
  said: /rule noon_line: an hour rule needs "hour"/,
  broken: () => errors((s) => delete rule(s, "noon_line").hour),
  whole,
});
broken("checkScript", "a say rule with no words", {
  said: /rule say_hello: a say rule needs "words"/,
  broken: () => errors((s) => delete rule(s, "say_hello").words),
});
broken("checkScript", "a use rule naming an NPC and an entity", {
  said: /rule fixer_first: a use rule names exactly one of "npc" and "entity"/,
  broken: () => errors((s) => (rule(s, "fixer_first").entity = "some_button")),
});
broken("checkScript", "money over what one line may give", {
  said: /give_money must be an integer from 1 to 100000/,
  broken: () => errors((s) => (rule(s, "say_money").do[1].give_money = 100001)),
});
broken("checkScript", "an action list of thirteen", {
  said: /rule say_hello: an action list has 13 entries, from 1 to 12 are allowed/,
  broken: () => errors((s) => (rule(s, "say_hello").do = Array.from({ length: 13 }, () => ({ say: "Si." })))),
});
broken("checkScript", "a shop the items file does not have", {
  said: /open_shop nada: no such shop/,
  broken: () => errors((s) => rule(s, "fixer_first").do.unshift({ open_shop: "nada" }), { rp, refs: { shops: new Set(["marco"]) } }),
});
broken("checkScript", "money that can be asked for again and again (a warning)", {
  said: /rule say_money: gives money and nothing stops it being repeated/,
  broken: () => warnings((s) => (rule(s, "say_money").if = [{ flag: "asked_work" }])),
  whole: wholeWarnings,
});
broken("checkScript", "a rule an earlier one always answers first (a warning)", {
  said: /rule fixer_back: can never run, rule x_all comes first/,
  broken: () => warnings((s) => s.rules.splice(0, 0, { id: "x_all", on: "use", npc: "fixer", duck: true, do: [{ say: "Si." }] })),
  others: true,
});
broken("checkScript", "a flag nothing tests (a warning)", {
  said: /flag lonely is set \(rule fixer_first\) but no condition ever tests it/,
  broken: () => warnings((s) => rule(s, "fixer_first").do.unshift({ set_flag: "lonely" })),
});
broken("checkScript", "a line with accents (a warning)", {
  said: /rule say_hello: the line .* has accents or non-ASCII characters/,
  broken: () => warnings((s) => (rule(s, "say_hello").do[0].say = "Buenas, ¿qué tal?")),
});

const good = { ...rp, properties: [], places: [], arenas: [{ id: "yard" }], missions: [{ id: "m", giver: "fixer", arena: "yard", done: { reward: { money: 50 } } }] };
const rpErrors = (change) => {
  const c = copy(good);
  change?.(c);
  return checkRp(c).errors;
};
broken("checkRp", "a mission whose giver is not an NPC", {
  said: /mission m: the giver "nobody" is not an npc/,
  broken: () => rpErrors((c) => (c.missions[0].giver = "nobody")),
  whole: () => rpErrors(),
});
broken("checkRp", "a reward over what a mission may pay", {
  said: /mission m: reward\.money must be an integer from 0 to 100000/,
  broken: () => rpErrors((c) => (c.missions[0].done.reward.money = 100001)),
});
broken("checkRp", "a format that is not smak-rp/1", {
  said: /format is "smak-rp\/2", expected "smak-rp\/1"/,
  broken: () => rpErrors((c) => (c.format = "smak-rp/2")),
});
