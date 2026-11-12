// Every checker failing an input broken in exactly one way, with the sentence it must give; and the same input
// whole passing, where that is cheap. A checker that always says PASS, or fails for the wrong thing, is caught
// here. The cases are in test/broken/ by kind (case.mjs says what a case is); checkers.mjs lists every checker
// of the kit, and the last case holds that list against the cases: a new checker comes with its broken cases,
// or with the reason it has none.
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { counted, known } from "./broken/case.mjs";
import { CHECKERS } from "./broken/checkers.mjs";

const KINDS = ["models", "motion", "maps", "sounds-sprites", "play", "commands", "publish", "architecture"];

// The checkers the case files name, found by reading them: the fast suite (SMAK_FAST=1) holds the registry against these
// and does not run the cases (importing the files builds the sites the cases are made on, 40 s). The slow suite imports
// the files, runs the cases, and holds what they registered against what reading found.
const named = (pattern) => KINDS.flatMap((kind) => [...readFileSync(`${HERE}/broken/${kind}.mjs`, "utf8").matchAll(pattern)].map((m) => m[1])); // prettier-ignore
const NAMES = {
  counted: new Set(named(/\b(?:broken|brokenAsync)\(\s*"([^"]+)"/g)),
  known: new Set(named(/\bknownBroken\(\s*"([^"]+)"/g)),
};
const fast = process.env.SMAK_FAST === "1";
if (!fast) for (const kind of KINDS) await import(`./broken/${kind}.mjs`);
const registered = fast ? NAMES.counted : new Set(counted.keys());
const registeredKnown = fast ? [...NAMES.known] : known.map((each) => each.checker);

if (!fast)
  test("the case files name their checkers by a literal, as the fast suite reads them", () => {
    const missed = [...counted.keys()].filter((name) => !NAMES.counted.has(name));
    sure(!missed.length, `checkers whose cases the fast suite cannot see (a case with a name that is not a string literal): ${missed.join(", ")}`); // prettier-ignore
    const extra = [...NAMES.counted].filter((name) => !counted.has(name));
    sure(!extra.length, `checkers named in a case file that registered no case: ${extra.join(", ")}`);
  });

test("every checker of the kit has a broken case, or the reason it has none written beside it", () => {
  const listed = new Set(CHECKERS.map((checker) => checker.name));
  const unlisted = [...registered, ...registeredKnown].filter((name) => !listed.has(name));
  sure(!unlisted.length, `cases for checkers checkers.mjs does not list: ${[...new Set(unlisted)].join(", ")}`);
  const bare = CHECKERS.filter((checker) => !registered.has(checker.name) && !checker.none);
  sure(!bare.length, `checkers with no broken case and no reason: ${bare.map((checker) => `${checker.name} (${checker.at})`).join(", ")}`); // prettier-ignore
  const both = CHECKERS.filter((checker) => registered.has(checker.name) && checker.none);
  sure(!both.length, `checkers said to have no case that have one: ${both.map((checker) => checker.name).join(", ")}`);
});
