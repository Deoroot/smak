// What a broken case is: an input with exactly one thing wrong, the checker run on it, and the sentence it must
// say. A case fails when the checker passes the input (it says nothing at the level that fails), when it fails
// it for another reason than the one the case broke (a sentence that is not the one asked for), and when the
// same input whole (its twin, where one is cheap) does not pass. So a checker that always says PASS, or always
// says FAIL, or says FAIL for the wrong thing, is caught.
//
// Every case is counted by its checker's name; checkers.mjs lists the checkers, and the last case of the area
// holds the two lists against each other.
import { test, testAsync, sure } from "../helper.mjs";

/**
 * The fast suite (`npm test`) only registers the cases: every checker is counted, so 107-broken-cases.mjs can hold the
 * list of checkers against the list of cases, and the cases themselves run in `npm run test:slow` (and when
 * 107-broken-cases.mjs runs alone). The self-test sets SMAK_FAST=1 for the fast suite.
 */
const FAST = process.env.SMAK_FAST === "1";

/** How many broken cases each checker has, by its name. */
export const counted = new Map();
/** The cases of a checker found to pass a broken input it should fail, left to be fixed: { checker, defect, why }. */
export const known = [];

/** The sentences a run gave, as a flat list of strings. */
const linesOf = (said) => [said].flat(Infinity).filter((line) => line !== undefined && line !== null && line !== false).map(String); // prettier-ignore

/**
 * Holds what a checker said of the broken input and of its twin. `said`: the pattern of the one sentence the
 * defect must give; `others: true` lets the broken input give other sentences beside it (an input that cannot
 * be broken in one way only), which are then not held against it.
 */
function judged(checker, defect, { said, others = false }, broken, whole) {
  const got = linesOf(broken);
  sure(got.length > 0, `${checker} passed it: nothing was said of ${defect}`);
  sure(got.some((line) => said.test(line)), `${checker} failed it, and not for ${defect} (${said}): ${got.join(" | ")}`); // prettier-ignore
  const besides = got.filter((line) => !said.test(line));
  sure(others || !besides.length, `${checker} failed it for more than ${defect}: ${besides.join(" | ")}`);
  if (whole === undefined) return;
  const twin = linesOf(whole);
  sure(!twin.length, `${checker} fails the same input whole too: ${twin.join(" | ")}`);
}

const count = (checker) => counted.set(checker, (counted.get(checker) ?? 0) + 1);

/**
 * One broken case. `broken()` runs the checker on the input with the defect and returns the sentences at the
 * level that fails (its errors, its faults; its warnings for a checker that only warns); `whole()`, when given,
 * the same of the input without the defect, which must be none.
 */
export function broken(checker, defect, { said, others, broken: run, whole }) {
  count(checker);
  if (FAST) return;
  test(`${checker}: ${defect}`, () => judged(checker, defect, { said, others }, run(), whole?.()));
}

/** The same for a checker that waits (play). */
export async function brokenAsync(checker, defect, { said, others, broken: run, whole }) {
  count(checker);
  if (FAST) return;
  await testAsync(`${checker}: ${defect}`, `${checker}: ${defect}`, async () =>
    judged(checker, defect, { said, others }, await run(), whole ? await whole() : undefined),
  );
}

/**
 * A case whose checker is known to pass the broken input: written down, not run, and said as `skip` with the
 * reason, until the checker is fixed and the case made a `broken` one.
 */
export function knownBroken(checker, defect, why) {
  known.push({ checker, defect, why });
  console.log(`skip  ${checker}: ${defect}\n      ${why}`);
}
