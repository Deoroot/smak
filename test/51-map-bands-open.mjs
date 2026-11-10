// A place of a spawn area left empty in one band on purpose: the map says so on the place's templates (a key the
// bands rule names as `open`), and the check then names only the true faults.
import * as maps from "../check/maps/index.mjs";
import { test, sure } from "./helper.mjs";

const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const ROOM = { min: [0, 0, 0], max: [640, 320, 160] };
const room = (entities) => ({
  worldspawn: {},
  brushes: maps.carve([ROOM], 16, WEARS),
  entities: [maps.playerStart([96, 128, 0], 0), maps.light([320, 160, 140]), ...entities],
});
const BEASTS = ["smak_beast"];
const mod = {
  name: "smakgame",
  classes: { smak_den: { keys: { targetname: {} } }, smak_beast: { keys: { den: {}, strength: {} } } },
  rules: [
    {
      rule: "bands",
      classes: BEASTS,
      key: "strength",
      open: "strength_none",
      among: ["den", "origin"],
      whole: true,
      why: "one beast for each strength of party",
    },
  ],
};
const told = (entities) => maps.checkEntities(room(entities), { mod });
const den = maps.pointEntity("smak_den", [480, 128, 80], { targetname: "lair" });
/** Beasts at one place: `ranges` their strengths, `none` the bands said to be left empty on each. */
const place = (ranges, none, at = [480, 128, 16]) =>
  ranges.map((strength) => maps.pointEntity("smak_beast", at, { den: "lair", strength, ...(none ? { strength_none: none } : {}) })); // prettier-ignore
const bandsSaid = (report) => report.warnings.filter((each) => /ranges that do not meet|no range|strength_none/.test(each)); // prettier-ignore

test("a band left empty on purpose is no fault, and the check still names the true ones", () => {
  // the middle band left empty: without the key a gap, with it nothing
  const plain = bandsSaid(told([den, ...place(["0;150", "500"])]));
  sure(plain.length === 1 && /nothing has 150 to 500, between 0;150 and 500/.test(plain[0]), plain.join(" | "));
  const open = told([den, ...place(["0;150", "500"], "150;500")]);
  sure(!bandsSaid(open).length, `said empty, it is no fault: ${bandsSaid(open).join(" | ")}`);
  sure(!/strength_none/.test(open.warnings.join()), "and the key is the rule's: no key its class does not define");
  // two bands left empty, said with a comma; the place has one beast and is still looked at
  sure(!bandsSaid(told([den, ...place(["500"], "0;150,150;500")])).length, "two empty bands, one beast");

  // a band said to be empty that a beast has: a fault, named
  const both = bandsSaid(told([den, ...place(["0;150", "150;500", "500"], "150;500")]));
  sure(both.length === 1 && /150;500 and 150;500 \(left empty\) overlap|150;500 \(left empty\) and 150;500 overlap/.test(both[0]), both.join(" | ")); // prettier-ignore
  // a gap the key does not cover is still a gap
  const other = bandsSaid(told([den, ...place(["0;150", "600"], "150;500")]));
  sure(other.length === 1 && /nothing has 500 to 600, between 150;500 \(left empty\) and 600/.test(other[0]), other.join(" | ")); // prettier-ignore
  // an empty band that is no range
  const wrong = bandsSaid(told([den, ...place(["0;150", "500"], "middle")]));
  sure(wrong.some((each) => /entities give a strength_none that is no range \(from;to, or from\).*strength_none "middle"/.test(each)), wrong.join(" | ")); // prettier-ignore
  // without the rule's `open` the key is any other: a key the class does not define, and the gap a gap
  const noOpen = { ...mod, rules: [{ ...mod.rules[0], open: undefined }] };
  const unread = maps.checkEntities(room([den, ...place(["0;150", "500"], "150;500")]), { mod: noOpen });
  sure(/nothing has 150 to 500/.test(unread.warnings.join()), "the gap, when the rule reads no key for it");
});
