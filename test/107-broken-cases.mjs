// Every checker failing an input broken in exactly one way, with the sentence it must give; and the same input
// whole passing, where that is cheap. A checker that always says PASS, or fails for the wrong thing, is caught
// here. The cases are in test/broken/ by kind (case.mjs says what a case is); checkers.mjs lists every checker
// of the kit, and the last case holds that list against the cases: a new checker comes with its broken cases,
// or with the reason it has none.
import { test, sure } from "./helper.mjs";
import { counted, known } from "./broken/case.mjs";
import { CHECKERS } from "./broken/checkers.mjs";

for (const kind of ["models", "maps", "specs", "sounds-sprites", "figures", "play", "commands", "publish", "source", "sbox", "levels", "rp", "rp-items", "rp-script", "rp-law", "rp-implants", "rp-jobs", "rp-doors"]) await import(`./broken/${kind}.mjs`);

test("every checker of the kit has a broken case, or the reason it has none written beside it", () => {
  const listed = new Set(CHECKERS.map((checker) => checker.name));
  const unlisted = [...counted.keys(), ...known.map((each) => each.checker)].filter((name) => !listed.has(name));
  sure(!unlisted.length, `cases for checkers checkers.mjs does not list: ${[...new Set(unlisted)].join(", ")}`);
  const bare = CHECKERS.filter((checker) => !counted.get(checker.name) && !checker.none);
  sure(!bare.length, `checkers with no broken case and no reason: ${bare.map((checker) => `${checker.name} (${checker.at})`).join(", ")}`); // prettier-ignore
  const both = CHECKERS.filter((checker) => counted.get(checker.name) && checker.none);
  sure(!both.length, `checkers said to have no case that have one: ${both.map((checker) => checker.name).join(", ")}`);
});
