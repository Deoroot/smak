// What a `fight` step does beyond striking the nearest enemy (cli/play.mjs has the fight itself): an enemy it
// cannot get at found out and dealt with (`stuck`), a weapon that reaches far drawn for one (`ranged`), and what
// is left in an area counted (`census`). Kept apart from play.mjs, whose fight calls these.
//
// UNREACHABLE. A test's fight that cannot get at an enemy goes on striking the air until its time runs out: a
// wolf in a fenced pen took 900 s of a run, a spider 60 to 190 units off was sidestepped for six minutes, a
// fleeing Lantern-bearer ate a fight of 400 s. So the fight keeps, for each enemy it turned to, the time it spent
// on him with no blow of the player's landing and without coming nearer by GAINED: past `stuck.after` (and
// STUCK_ROUNDS rounds) he is unreachable, for every fight of the run, and the fight skips him (the profile's
// `play.target.skip`), stops the run naming him, goes to him (the profile's `play.goto`), or shoots at him.
//
// RANGED. A ranged weapon in a GoldSrc game is a button held to draw (or charge) and let go to loose: the fight
// draws the weapon the character carries (the profile's `play.ranged.draw`), aims at the enemy (yaw and pitch, the
// pitch raised for the fall of the shot when the profile gives its speed and the game's gravity), holds the
// button for the draw's time, lets go, and again; when the enemy comes within `near` it puts the weapon back
// (`play.ranged.back`) and strikes.

/** Milliseconds a fight spends on an enemy with no blow landing and no step nearer before he is unreachable, and
 * the rounds it must have turned to him in that time; units nearer a round must bring him to be getting on (as
 * a chase's GAINED in play.mjs). */
export const STUCK_AFTER = 30000;
export const STUCK_ROUNDS = 4;
/** Shots that may all miss before an enemy shot at is given up too: a shot misses more often than a blow (a
 * dummy 520 off took 12 to 17 of 19). */
export const STUCK_SHOTS = 8;
const GAINED = 16;
/** What a fight does with an enemy it cannot get at. */
export const STUCK_THEN = ["skip", "fail", "goto", "ranged"];
/** When a fight shoots: at an enemy found unreachable, at one high over the player's eyes, at any farther than `near`. */
export const RANGED_WHEN = ["unreachable", "flying", "always"];
const RANGED = ["item", "slot", "when", "hold", "near", "above", "speed"];
/** Unless told: an enemy within this of the eyes is struck, not shot (a fight with chase: its chase); one whose
 * middle is this much over the player's eyes flies; milliseconds waited after the draw and after a shot. */
const RANGED_NEAR = 96;
const RANGED_ABOVE = 64;
const DRAWN = 1000;
export const LOOSED = 400;
/** Units over (and under) the enemy's middle each shot is aimed at, in turn. A game may leave a shot stuck in its
 * target for a while (Master Sword: ten seconds, items/proj_arrow_wooden's ARROW_STICK_DURATION), and the next
 * one loosed along the same line strikes that and not him: at a dummy 300 off, the same aim landed every second
 * shot, these six of eight. */
export const ASIDE = [0, 10, -10, 5, -5, 14, -14];
/** How far round the player a census counts unless told, and how many of what is left a failure names. */
export const CENSUS_RADIUS = 6000;
const LEFT_MOST = 6;
/** How far beside an unreachable enemy a `goto` puts the player, and how much over his middle. */
const BESIDE = 40;
const OVER = 36;

const shown = (value) => (value === undefined ? "nothing" : JSON.stringify(value));
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isCount = (value) => isNumber(value) && value >= 0;
const rounded = (value) => Math.round(value * 10) / 10;
/** A place as a failure names it: whole units, `(780,1322,0)`. */
export const placeOf = (origin) => `(${origin.map((value) => Math.round(value)).join(",")})`;

// ── the profile's part ──────────────────────────────────────────────────────
/**
 * The profile's parts a fight's `stuck`, `ranged` and `census` read, checked and made whole on `part` (as
 * `playPartOf` gives it): `lift`, `census`, `ranged`, and `target.skip` (of `given`, the profile's own
 * `play.target`, whose other fields playPartOf has made whole already). `helpers` are play.mjs's
 * `{ patternOf, commands }` (`commands(value)`: a list of console commands or a function).
 *   lift     units a `goto` puts the player over the place asked (0): over a path brush two units high he drops
 *            onto it, where at its height he is set into it and sticks
 *   census   `{ commands, count, one, within }`: the console commands that count the living monsters within
 *            `{radius}`, the pattern of the line that says how many (`(?<count>\d+)`) and of each one's line
 *            (`(?<x>)`, `(?<y>)`, `(?<z>)`, and `name`, `hp`, `relate` where the game says them); null where the
 *            game cannot
 *   ranged   `{ draw, back, held, hold, speeds, gravity, button, drawn }`: the console commands that put the
 *            ranged weapon `{item}` (kept in `{slot}`) into the hands, and those that put back what was held
 *            before (lists, or functions of `{ item, slot }`); `held` `{ commands, answer }` asks whether `{item}`
 *            is in the hands (the answer's group `held`: 1 or 0); `hold` the milliseconds the button is held to
 *            draw; `speeds` each item's shot in units a second, and `gravity` what pulls it down (units a second
 *            a second), by which a far shot is aimed higher; `button` the button held: the mouse's (left, right,
 *            middle) or a game's, by the console (`attack`: +attack, -attack); `drawn` the milliseconds the hands
 *            take (1000). Null where the game has no such way
 */
export function fightPartOf(part, given, { patternOf, commands }) {
  part.lift ??= 0;
  if (!isCount(part.lift)) throw new Error(`mod: play.lift is units a goto puts the player over the place asked, 0 or more, not ${shown(part.lift)}`); // prettier-ignore
  if (part.target && typeof part.target !== "function") {
    if (given?.skip != null && !commands(given.skip))
      throw new Error(`mod: play.target.skip is a list of console commands with {id} in them (the enemy the answers pass over from then on), or a function, not ${shown(given.skip)}`); // prettier-ignore
    part.target.skip = given?.skip ?? null;
  }
  part.census ??= null;
  if (part.census !== null) {
    const asked = part.census;
    if (typeof asked !== "object" || Array.isArray(asked) || !commands(asked.commands) || asked.count === undefined || asked.one === undefined) // prettier-ignore
      throw new Error(`mod: play.census is { commands, count, one } (console commands with {radius} in them, and the patterns of the line that counts and of each one's line), not ${shown(asked)}`); // prettier-ignore
    const count = patternOf(asked.count, "mod: play.census.count");
    const one = patternOf(asked.one, "mod: play.census.one");
    if (!count.source.includes("(?<count>"))
      throw new Error(`mod: play.census.count names the number in the group (?<count>...), which ${count} does not`);
    if (!["x", "y", "z"].every((name) => one.source.includes(`(?<${name}>`)))
      throw new Error(`mod: play.census.one names the place in the groups (?<x>...), (?<y>...) and (?<z>...), which ${one} does not`); // prettier-ignore
    if (asked.within !== undefined && !(isCount(asked.within) && asked.within > 0))
      throw new Error(`mod: play.census.within is a number of milliseconds over 0, not ${shown(asked.within)}`);
    part.census = { commands: asked.commands, count, one, within: asked.within ?? 3000 };
  }
  part.ranged ??= null;
  if (part.ranged !== null) {
    const asked = part.ranged;
    if (typeof asked !== "object" || Array.isArray(asked) || !commands(asked.draw) || !commands(asked.back))
      throw new Error(`mod: play.ranged is { draw, back, ... }: the console commands that put a ranged weapon ({item}, kept in {slot}) into the hands and those that put back what was held, not ${shown(asked)}`); // prettier-ignore
    let held = null;
    if (asked.held != null) {
      if (typeof asked.held !== "object" || !commands(asked.held.commands) || asked.held.answer === undefined)
        throw new Error(`mod: play.ranged.held is { commands, answer }: the commands that ask whether {item} is in the hands and the pattern of the answer, its group (?<held>...) 1 or 0, not ${shown(asked.held)}`); // prettier-ignore
      const answer = patternOf(asked.held.answer, "mod: play.ranged.held.answer");
      if (!answer.source.includes("(?<held>"))
        throw new Error(`mod: play.ranged.held.answer names the answer in the group (?<held>...), which ${answer} does not`); // prettier-ignore
      held = { commands: asked.held.commands, answer };
    }
    for (const name of ["hold", "drawn"])
      if (asked[name] !== undefined && !(isCount(asked[name]) && asked[name] > 0))
        throw new Error(`mod: play.ranged.${name} is a number of milliseconds over 0, not ${shown(asked[name])}`);
    if (asked.gravity !== undefined && !isCount(asked.gravity))
      throw new Error(`mod: play.ranged.gravity is units a second a second, 0 or more, not ${shown(asked.gravity)}`);
    const speeds = asked.speeds ?? {};
    if (typeof speeds !== "object" || Array.isArray(speeds) || !Object.values(speeds).every((value) => isNumber(value) && value > 0))
      throw new Error(`mod: play.ranged.speeds gives each item's shot in units a second, over 0, not ${shown(asked.speeds)}`); // prettier-ignore
    part.ranged = {
      ...{ draw: asked.draw, back: asked.back, held, hold: asked.hold ?? 1400, drawn: asked.drawn ?? DRAWN },
      ...{ speeds, gravity: asked.gravity ?? 0, button: asked.button ?? "left" },
    };
  }
  return part;
}

// ── a fight's own ───────────────────────────────────────────────────────────
/**
 * A fight step's `stuck`, `ranged` and `quietEnds`, checked and put on its action. `helpers`: play.mjs's
 * `{ refuse, held, far, commandsOf, until }` (a sentence that refuses the step; a number of milliseconds checked,
 * a distance checked; the commands of a profile's list for the words put in; whether the step has an `until`).
 *   ranged     an item's name, or `{ item, slot, when, hold, near, above, speed }`: the ranged weapon the character
 *              carries (in the profile's `slot`, 1), shot `when` ("unreachable": at an enemy found unreachable;
 *              "flying": at one whose middle is `above` (64) over the eyes; "always": at any; or a list), the
 *              button held `hold` ms (the profile's), never at one within `near` (the chase, or 96: he is struck);
 *              `speed` the shot's in units a second (the profile's for the item), by which a far one is aimed higher
 *   stuck      false, or `{ after, then }`: an enemy the fight spent `after` ms on (30000), with no blow landing and
 *              not coming nearer, is unreachable, and then "skip" (passed over from then on, by the profile's
 *              `play.target.skip`), "fail" (the run stops, naming him and his place), "goto" (the player put
 *              beside him, once; then skipped) or "ranged" (shot at; skipped when that does not get on either).
 *              Unless told: "ranged" with a `ranged` that shoots the unreachable, "skip" otherwise
 *   quietEnds  true: a fight with `until` that ends by its `quiet` (no enemy left) without the line has ended
 *              all the same, and says so; unless told it FAILS, for the area did not end as the test thought
 */
export function fightOptionsOf(asked, action, part, { refuse, held, far, commandsOf, until }) {
  if (asked.quietEnds !== undefined && typeof asked.quietEnds !== "boolean")
    refuse(`ends by quiet ${shown(asked.quietEnds)}: quietEnds is true or false`);
  if (asked.quietEnds !== undefined && (action.quiet === null || !until))
    refuse("has quietEnds, which says what a fight with until does when it ends by its quiet: give both");
  action.quietEnds = asked.quietEnds === true;

  action.ranged = null;
  if (asked.ranged !== undefined) {
    const given = typeof asked.ranged === "string" ? { item: asked.ranged } : asked.ranged;
    if (!given || typeof given !== "object" || Array.isArray(given))
      refuse(`shoots with ${shown(asked.ranged)}: ranged is an item's name, or { item, slot, when, hold, near, above, speed }`); // prettier-ignore
    const strange = Object.keys(given).filter((key) => !RANGED.includes(key));
    if (strange.length) refuse(`shoots with ${strange.join(", ")}, which ranged has not: ${RANGED.join(", ")}`);
    if (!(typeof given.item === "string" && /^[A-Za-z0-9_]+$/.test(given.item)))
      refuse(`shoots with the item ${shown(given.item)}: the name of the ranged weapon the character carries, such as "bows_thornbow"`); // prettier-ignore
    if (!part.ranged) refuse("shoots, and the profile names no way to draw a ranged weapon (play.ranged)");
    const slot = given.slot ?? 1;
    if (!(Number.isInteger(slot) && slot > 0)) refuse(`keeps its ranged weapon in the slot ${shown(slot)}: a whole number over 0`);
    const when = [given.when ?? "unreachable"].flat();
    if (!when.length || !when.every((each) => RANGED_WHEN.includes(each)))
      refuse(`shoots when ${shown(given.when)}: ${RANGED_WHEN.join(", ")}, or a list of them`);
    if (given.above !== undefined && !isNumber(given.above)) refuse(`takes an enemy to fly ${shown(given.above)} over the eyes: a distance`);
    if (given.speed !== undefined && !(isNumber(given.speed) && given.speed > 0)) refuse(`shoots at ${shown(given.speed)} units a second: a number over 0`); // prettier-ignore
    const words = { item: given.item, slot };
    action.ranged = {
      ...{ item: given.item, slot, when, hold: held(given.hold ?? part.ranged.hold, "draws for") },
      ...{ near: far(given.near ?? action.chase ?? RANGED_NEAR, "shoots at an enemy farther than"), above: given.above ?? RANGED_ABOVE }, // prettier-ignore
      ...{ speed: given.speed ?? part.ranged.speeds[given.item] ?? null, gravity: part.ranged.gravity, button: part.ranged.button, drawn: part.ranged.drawn }, // prettier-ignore
      draws: commandsOf(part.ranged.draw, words, [words], "play.ranged.draw"),
      backs: commandsOf(part.ranged.back, words, [words], "play.ranged.back"),
      asks: part.ranged.held ? commandsOf(part.ranged.held.commands, words, [words], "play.ranged.held") : null,
      answer: part.ranged.held?.answer ?? null,
    };
  }

  if (asked.stuck === false) action.stuck = null;
  else {
    const given = asked.stuck ?? {};
    if (!given || typeof given !== "object" || Array.isArray(given))
      refuse(`is stuck ${shown(asked.stuck)}: stuck is false, or { after, then }`);
    const strange = Object.keys(given).filter((key) => key !== "after" && key !== "then");
    if (strange.length) refuse(`is stuck with ${strange.join(", ")}, which stuck has not: after, then`);
    const shoots = action.ranged?.when.includes("unreachable");
    const then = given.then ?? (shoots ? "ranged" : "skip");
    if (!STUCK_THEN.includes(then)) refuse(`does ${shown(given.then)} with an enemy it cannot get at: ${STUCK_THEN.join(", ")}`);
    if (then === "goto" && !part.goto) refuse('goes to an enemy it cannot get at (stuck: "goto"), and the profile names no command that puts the player at a place (play.goto)'); // prettier-ignore
    if (then === "ranged" && !action.ranged) refuse('shoots at an enemy it cannot get at (stuck: "ranged"), and has no ranged: { item }');
    action.stuck = { after: held(given.after ?? STUCK_AFTER, "is stuck after"), then };
    // passed over by the game from then on, where it can be told; else its answers of him are taken for none
    action.skips = part.target?.skip ? (id) => commandsOf(part.target.skip, { id }, [id], "play.target.skip") : null;
  }
}

/**
 * The view that sends a shot from `eyes` to `to`: yaw, pitch (degrees, over 0 up) and how far. With the shot's
 * `speed` and a `gravity`, the pitch is the lower of the two that land it there (the drop over the way); past the
 * farthest it can reach, 45 degrees.
 */
export function aimOf(eyes, to, { speed = null, gravity = 0 } = {}) {
  const [dx, dy, dz] = [to[0] - eyes[0], to[1] - eyes[1], to[2] - eyes[2]];
  const flat = Math.hypot(dx, dy);
  let pitch = Math.atan2(dz, flat);
  if (speed && gravity > 0 && flat > 1) {
    const v2 = speed * speed;
    const under = v2 * v2 - gravity * (gravity * flat * flat + 2 * dz * v2);
    pitch = under >= 0 ? Math.atan((v2 - Math.sqrt(under)) / (gravity * flat)) : Math.PI / 4;
  }
  const degrees = (radians) => (radians * 180) / Math.PI;
  const view = { pitch: Math.max(-89, Math.min(89, degrees(pitch))) };
  if (flat > 0.01) view.yaw = degrees(Math.atan2(dy, dx));
  return { view, far: Math.hypot(flat, dz) };
}

/**
 * What a fight keeps of each enemy it turned to: rounds, the time spent on him with no blow landing and no step
 * nearer, the nearest he came and the least health he had. `settle(now, hits)` at each round's beginning gives
 * the round before its due (a blow of the player's landed in it, or it was time spent for nothing); `seen` takes
 * the enemy of this round; `stuck` says whether he has been spent on for `after` ms and STUCK_ROUNDS rounds
 * (STUCK_SHOTS, once he is shot at).
 */
export function progressOf() {
  const tracks = new Map();
  let last = null;
  const fresh = (track) => Object.assign(track, { idle: 0, idleRounds: 0 });
  return {
    tracks,
    settle(now, hits) {
      if (!last) return;
      const track = tracks.get(last.key);
      if (hits > last.hits) fresh(track).landed += hits - last.hits;
      else {
        track.idle += now - last.at;
        track.idleRounds++;
      }
      last = null;
    },
    seen(key, { name, far, hp, origin }, now, hits) {
      let track = tracks.get(key);
      if (!track) {
        track = fresh({ key, name, rounds: 0, best: far, hp: hp ?? null, landed: 0, origin, shots: 0 });
        tracks.set(key, track);
      }
      track.rounds++;
      track.origin = origin;
      track.name = name ?? track.name;
      if (far < track.best - GAINED) fresh(track).best = far;
      if (isNumber(hp) && track.hp !== null && hp < track.hp - 0.01) fresh(track);
      if (isNumber(hp)) track.hp = track.hp === null ? hp : Math.min(track.hp, hp);
      last = { key, at: now, hits };
      return track;
    },
    stuck: (track, after) => track.idle >= after && track.idleRounds >= (track.shot ? STUCK_SHOTS : STUCK_ROUNDS),
    again: (track) => Object.assign(fresh(track), { best: Infinity }),
  };
}

/** Where a `goto` puts the player beside an enemy he cannot get at: BESIDE units off him on the player's side, over his middle. */
export function besideOf(enemy, origin) {
  const [dx, dy] = [origin[0] - enemy[0], origin[1] - enemy[1]];
  const flat = Math.hypot(dx, dy) || 1;
  return [enemy[0] + (dx / flat) * BESIDE, enemy[1] + (dy / flat) * BESIDE, enemy[2] + OVER].map(rounded);
}

// ── a census ────────────────────────────────────────────────────────────────
/** A census's lines read: `{ count, ones: [{ name, hp, origin, relate }] }`, from the line that counts on. */
export function censusOf(texts, census) {
  const head = texts.findIndex((text) => census.count.test(text));
  if (head < 0) return null;
  const count = Number(census.count.exec(texts[head]).groups.count);
  const ones = [];
  for (const text of texts.slice(head + 1)) {
    const got = census.one.exec(text)?.groups;
    if (!got) continue;
    const hp = Number(got.hp);
    ones.push({ name: got.name ?? "?", hp: Number.isFinite(hp) ? hp : null, origin: [got.x, got.y, got.z].map(Number), relate: got.relate ?? null }); // prettier-ignore
    if (ones.length >= count) break;
  }
  return { count, ones };
}

/** The enemies a census found (all it found, where the game does not say who is an enemy). */
const enemiesOf = ({ ones }) => (ones.some((one) => one.relate) ? ones.filter((one) => one.relate === "enemy") : ones);

/** What is left, as a failure says it: "left: Wolf 114 hp at (780,1322,0), 1 of 1"; "left: no enemy (2 monsters)". */
export function leftOf(census) {
  if (!census) return "left: the census was not answered";
  const enemies = enemiesOf(census);
  if (!enemies.length) return `left: no enemy (${census.count} ${census.count === 1 ? "monster" : "monsters"} counted)`;
  const named = enemies.slice(0, LEFT_MOST).map((one) => `${one.name} ${one.hp === null ? "?" : Math.round(one.hp)} hp at ${placeOf(one.origin)}`); // prettier-ignore
  return `left: ${named.join(", ")}, ${named.length} of ${enemies.length}`;
}

/** A census as the lines of a table: one that heads it, then one a monster. */
export function censusTable(census, where, radius) {
  if (!census) return [`census (${where}): the game did not answer within ${radius}`];
  const enemies = enemiesOf(census).length;
  const width = Math.max(4, ...census.ones.map((one) => one.name.length));
  return [
    `census (${where}): ${census.count} within ${radius}, ${enemies} ${enemies === 1 ? "an enemy" : "enemies"}`,
    ...census.ones.map((one) => `  ${one.name.padEnd(width)}  ${String(one.hp === null ? "?" : Math.round(one.hp)).padStart(6)} hp  at ${placeOf(one.origin).padEnd(20)}${one.relate ? `  ${one.relate}` : ""}`), // prettier-ignore
  ];
}
