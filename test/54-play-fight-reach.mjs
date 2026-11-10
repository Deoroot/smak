// A fight and an enemy it cannot get at: found out by the time spent on him for nothing (`stuck`), and passed
// over, stopped at, gone to or shot at; a ranged weapon drawn, aimed (higher for its fall) and put back; a fight
// that ends by its quiet without its line, which fails unless told; a census of what is left, by itself in a
// failure's sentence and as a step; a walk that moves nobody; a goto put a little over its place.
//
// No browser and no game: fixture-game.mjs's enemies, with a fence the player cannot walk through, an answer to
// `nearest` that names each enemy's number and passes over those it was told to skip, a bow that hits whom it
// is aimed at however far, and a census.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import masterSword from "../profiles/mastersword.mjs";
import { aimOf, censusOf, censusTable, leftOf, progressOf } from "../cli/play-fight.mjs";
import { test, testAsync, sure, tmp } from "./helper.mjs";
import { GAME, GAME_SAYS, gameDriver, refusalOf } from "./fixture-game.mjs";

const { play, playOf, playPartOf, fightLine } = smak.play;
const folder = join(tmp, "play-fight-reach");
mkdirSync(folder, { recursive: true });
const refusal = (run) => {
  try {
    run();
  } catch (e) {
    return e.message;
  }
  return "";
};

/** The made-up game with the parts a fight that cannot get at an enemy reads: a nearest that names the enemy's
 * number and can pass over one, a census, a bow drawn and put back, and a goto 4 over its place. */
const REACH = {
  ...GAME,
  play: {
    ...GAME.play,
    lift: 4,
    target: {
      ...GAME.play.target,
      answer: "^nearest (?<id>\\d+) (?<name>\\w+) hp (?<hp>\\d+) at (?<x>\\S+) (?<y>\\S+) (?<z>\\S+) far (?<far>\\S+) count (?<count>\\d+) close (?<close>\\d+)$", // prettier-ignore
      skip: ["skip {id}"],
    },
    census: { commands: ["census {radius}"], count: "^census (?<count>\\d+) within", one: "^census one (?<name>\\w+) hp (?<hp>\\S+) at \\((?<x>[-\\d.]+),(?<y>[-\\d.]+),(?<z>[-\\d.]+)\\) relate (?<relate>\\w+)$" }, // prettier-ignore
    ranged: {
      ...{ draw: ["draw {item} {slot}"], back: ["back"], hold: 600, drawn: 300, button: "attack" },
      ...{ held: { commands: ["hands {item}"], answer: "^hands \\S+ (?<held>[01])$" }, speeds: { bow: 1500 }, gravity: 0 },
    },
  },
};

/**
 * fixture-game's driver, and more: `fence` an x the player cannot walk past (from the side he stands on), the
 * answer to `nearest` with each enemy's number, passing over those told by `skip <n>`; `census`; a bow drawn by
 * `draw <item> <slot>` (unless `drawsNot`), whose `+attack` held `hold` ms and let go hits the enemy the view is
 * on (yaw and pitch within 3 degrees) however far; `frozen`: a walk moves nobody.
 */
function reachDriver({ enemies, fence = null, hold = 600, drawsNot = false, frozen = false }) {
  const driver = gameDriver(GAME_SAYS, { enemies });
  const { command, wait, look } = driver;
  // the fixture's view is its own: read by view(), and set by its look (whose call is not one of the run's)
  const origin = () => driver.view().origin;
  const set = (fields) => {
    look(fields);
    driver.calls.pop();
  };
  const skipped = new Set();
  let drawn = null;
  let pressed = null;
  const alive = () => driver.foes.map((foe, id) => ({ foe, id })).filter(({ foe }) => foe.hp > 0);
  const far = (foe) => Math.hypot(...foe.at.map((value, axis) => value - origin()[axis]));
  driver.command = (text) => {
    const nearest = /^nearest (\d+)$/.exec(text);
    if (nearest) {
      driver.calls.push(`command ${text}`);
      const near = alive().filter(({ foe }) => far(foe) <= Number(nearest[1])).sort((a, b) => far(a.foe) - far(b.foe));
      const left = near.filter(({ id }) => !skipped.has(id));
      const liked = driver.player.prefer && left.find(({ foe }) => foe.name.includes(driver.player.prefer));
      const { foe, id } = liked || left[0] || {};
      return void driver.say(foe ? `nearest ${id} ${foe.name} hp ${foe.hp} at ${foe.at.join(" ")} far ${Math.round(far(foe))} count ${near.length} close ${near.filter(({ foe: each }) => far(each) <= 96).length}` : "nearest none"); // prettier-ignore
    }
    const skip = /^skip (\d+)$/.exec(text);
    if (skip) skipped.add(Number(skip[1]));
    const census = /^census (\d+)$/.exec(text);
    if (census) {
      const near = alive().filter(({ foe }) => far(foe) <= Number(census[1]));
      driver.say(`census ${near.length} within ${census[1]}`);
      for (const { foe } of near) driver.say(`census one ${foe.name} hp ${foe.hp} at (${foe.at.join(",")}) relate enemy`);
    }
    const draw = /^draw (\w+) (\d+)$/.exec(text);
    if (draw && !drawsNot) drawn = draw[1];
    if (text === "back") drawn = null;
    const hands = /^hands (\w+)$/.exec(text);
    if (hands) driver.say(`hands ${hands[1]} ${drawn === hands[1] ? 1 : 0}`);
    if (text === "+attack") pressed = driver.clock();
    if (text === "-attack" && pressed !== null) {
      const held = driver.clock() - pressed;
      pressed = null;
      const { yaw, pitch, origin: at } = driver.view();
      const eyes = [at[0], at[1], at[2] + 28];
      const struck = drawn && held >= hold && alive().find(({ foe }) => {
        const { view } = aimOf(eyes, foe.at);
        const turned = Math.abs(((view.yaw ?? yaw) - yaw + 540) % 360 - 180);
        return turned <= 3 && Math.abs(view.pitch - pitch) <= 3;
      }); // prettier-ignore
      if (!struck) driver.say("you miss");
      else {
        struck.foe.hp = Math.max(0, struck.foe.hp - 10);
        driver.say(`you hit ${struck.foe.name} for 10`);
        if (struck.foe.hp === 0) driver.say(`you killed ${struck.foe.name}`);
        if (!alive().length) driver.say("all is quiet");
      }
    }
    return command(text);
  };
  driver.wait = (ms) => {
    const was = origin();
    if (frozen) set({ moving: {} });
    wait(ms);
    // a fence: walked up to, never through (a goto may put him beyond it)
    const now = origin();
    if (fence !== null && was[0] <= fence && now[0] > fence - 16) set({ origin: [fence - 16, now[1], now[2]] });
  };
  return driver;
}
const fought = async (name, driver, steps, mod = REACH) => {
  let run = null;
  const failure = await refusalOf(async () => {
    run = await play({ driver, map: "yard", out: join(folder, name), mod, pause: 0, steps });
  });
  return { run, failure, driver };
};
/** A wolf in a pen: 300 off, past a fence at 200, with 30 of health; it strikes nobody. */
const penned = () => [{ name: "wolf", hp: 30, at: [300, 0, 36], hits: 0 }];

test("a fight's stuck, ranged and quietEnds are checked; a profile's census, ranged, skip and lift are read", () => {
  const [plain, shooting, told] = playOf(
    [
      { fight: { chase: 60 }, for: 1000 },
      { fight: { chase: 60, ranged: "bow" }, for: 1000 },
      { fight: { quiet: 500, quietEnds: true, stuck: { after: 5000, then: "goto" }, ranged: { item: "bow", slot: 3, when: ["flying", "always"], hold: 900, near: 150, above: 80, speed: 900 } }, until: "x" }, // prettier-ignore
    ],
    { mod: REACH },
  );
  sure(plain.stuck.after === 30000 && plain.stuck.then === "skip" && plain.ranged === null && plain.quietEnds === false, `unless told: ${JSON.stringify(plain.stuck)}`); // prettier-ignore
  sure(shooting.stuck.then === "ranged" && shooting.ranged.near === 60 && shooting.ranged.hold === 600 && shooting.ranged.speed === 1500, "with a ranged weapon, the unreachable are shot at, from beyond the chase"); // prettier-ignore
  sure(shooting.ranged.draws.join() === "draw bow 1" && shooting.ranged.backs.join() === "back" && shooting.ranged.asks.join() === "hands bow", JSON.stringify(shooting.ranged)); // prettier-ignore
  sure(told.stuck.then === "goto" && told.quietEnds && told.ranged.slot === 3 && told.ranged.when.join() === "flying,always" && told.ranged.near === 150 && told.ranged.above === 80 && told.ranged.speed === 900 && told.ranged.hold === 900, JSON.stringify(told.ranged)); // prettier-ignore
  sure(told.goesTo([1, 2, 3]).join() === "put me at 1 2 7" && plainGoto().join() === "put me at 5 6 11", "a goto is put 4 over its place (the profile's lift)"); // prettier-ignore
  sure(playOf([{ census: true }], { mod: REACH })[0].radius === 6000 && playOf([{ census: 900 }], { mod: REACH })[0].radius === 900, "a census step: 6000 round unless told"); // prettier-ignore

  const wrong = [
    [{ fight: { stuck: { after: 100, then: "flee" } }, for: 9 }, /does "flee" with an enemy it cannot get at: skip, fail, goto, ranged/],
    [{ fight: { stuck: { then: "ranged" } }, for: 9 }, /\(stuck: "ranged"\), and has no ranged: \{ item \}/],
    [{ fight: { stuck: { when: 1 } }, for: 9 }, /is stuck with when, which stuck has not: after, then/],
    [{ fight: { stuck: 5 }, for: 9 }, /is stuck 5: stuck is false, or \{ after, then \}/],
    [{ fight: { ranged: { item: "a bow" } }, for: 9 }, /shoots with the item "a bow": the name of the ranged weapon/],
    [{ fight: { ranged: { item: "bow", when: "dark" } }, for: 9 }, /shoots when "dark": unreachable, flying, always/],
    [{ fight: { ranged: { item: "bow", arrows: 3 } }, for: 9 }, /shoots with arrows, which ranged has not/],
    [{ fight: { ranged: { item: "bow", slot: 0 } }, for: 9 }, /keeps its ranged weapon in the slot 0: a whole number over 0/],
    [{ fight: { quietEnds: true }, until: "x" }, /has quietEnds, which says what a fight with until does when it ends by its quiet: give both/],
    [{ census: -5 }, /counts within -5: a distance in the map's units over 0, or true \(6000\)/],
  ]; // prettier-ignore
  for (const [step, sentence] of wrong) {
    const said = refusal(() => playOf([step], { mod: REACH }));
    sure(sentence.test(said), `${JSON.stringify(step)} was ${said ? `refused with: ${said}` : "not refused"}`);
  }
  const noGoto = { play: { ...REACH.play, goto: null } };
  sure(/\(stuck: "goto"\), and the profile names no command that puts the player at a place/.test(refusal(() => playOf([{ fight: { stuck: { then: "goto" } }, for: 9 }], { mod: noGoto }))), "a goto the profile cannot give"); // prettier-ignore
  sure(/shoots, and the profile names no way to draw a ranged weapon \(play\.ranged\)/.test(refusal(() => playOf([{ fight: { ranged: "bow" }, for: 9 }], { mod: GAME }))), "a bow the profile cannot draw"); // prettier-ignore
  sure(/counts the monsters, and the profile names no way to ask the game \(play\.census\)/.test(refusal(() => playOf([{ census: true }], { mod: GAME }))), "a census the profile cannot ask"); // prettier-ignore
  const profile = [
    [{ census: { commands: ["c"], count: "(\\d+)", one: "(?<x>.)(?<y>.)(?<z>.)" } }, /mod: play\.census\.count names the number in the group \(\?<count>\.\.\.\)/],
    [{ census: { commands: ["c"], count: "(?<count>\\d+)", one: "(?<x>.)" } }, /mod: play\.census\.one names the place in the groups/],
    [{ ranged: { draw: ["d"] } }, /mod: play\.ranged is \{ draw, back, \.\.\. \}/],
    [{ ranged: { draw: ["d"], back: ["b"], held: { commands: ["h"], answer: "(\\d)" } } }, /mod: play\.ranged\.held\.answer names the answer in the group \(\?<held>\.\.\.\)/],
    [{ ranged: { draw: ["d"], back: ["b"], speeds: { bow: -1 } } }, /mod: play\.ranged\.speeds gives each item's shot in units a second/],
    [{ lift: -4 }, /mod: play\.lift is units a goto puts the player over the place asked/],
    [{ target: { ...GAME.play.target, skip: "skip" } }, /mod: play\.target\.skip is a list of console commands with \{id\} in them/],
  ]; // prettier-ignore
  for (const [part, sentence] of profile) {
    const said = refusal(() => playPartOf({ play: { ...GAME.play, ...part } }));
    sure(sentence.test(said), `${JSON.stringify(part)} was ${said ? `refused with: ${said}` : "not refused"}`);
  }
  // Master Sword's: the helper's census and hands, the quickslots a bow is drawn by, +attack held
  const ms = playPartOf(masterSword({ folders: [tmp] }));
  const one = ms.census.one.exec("TRIAL census one Wolf hp 114.37 at (779.94,1321.98,0.03) relate enemy").groups;
  sure(one.name === "Wolf" && one.hp === "114.37" && one.x === "779.94" && one.relate === "enemy" && ms.census.count.exec("TRIAL census 2 within 6000").groups.count === "2", "Master Sword's census read"); // prettier-ignore
  const [msFight] = playOf([{ fight: { ranged: "bows_thornbow" }, for: 9 }], { mod: masterSword({ folders: [tmp] }) });
  sure(msFight.ranged.draws.join("; ") === "cmd quickslot create 9 current; +quickslot 1; -quickslot 1" && msFight.ranged.backs.join("; ") === "+quickslot 10; -quickslot 10", `a bow by its quickslot: ${msFight.ranged.draws}`); // prettier-ignore
  sure(msFight.ranged.button === "attack" && msFight.ranged.speed === 1700 && ms.ranged.held.answer.exec("TRIAL hands bows_thornbow 1").groups.held === "1" && ms.lift === 4 && ms.target.skip.join() === "trial skip {id}", "held by +attack, its speed, the hands asked, a goto 4 over, a skip"); // prettier-ignore
  const [spell] = playOf([{ fight: { ranged: "magic_hand_fire_dart" }, for: 9 }], { mod: masterSword({ folders: [tmp] }) });
  sure(spell.ranged.draws.join("; ") === "cmd quickslot create 9 current; cmd prep magic_hand_fire_dart", `a spell is prepared: ${spell.ranged.draws}`); // prettier-ignore
});
function plainGoto() {
  return playOf([{ goto: [5, 6, 7] }], { mod: REACH })[0].commands;
}

test("a shot's aim, an enemy's progress, a census and what is left, said", () => {
  const level = aimOf([0, 0, 0], [1000, 0, 0]);
  sure(level.view.yaw === 0 && level.view.pitch === 0 && level.far === 1000, JSON.stringify(level));
  // 1000 off at 1000 a second under 800: tan(pitch) = (v² - sqrt(v⁴ - g²d²)) / (g d) = (1 - sqrt(1 - 0.64)) / 0.8
  const fall = aimOf([0, 0, 0], [1000, 0, 0], { speed: 1000, gravity: 800 });
  const want = (Math.atan((1 - Math.sqrt(0.36)) / 0.8) * 180) / Math.PI;
  sure(Math.abs(fall.view.pitch - want) < 1e-9 && fall.view.pitch > 26, `aimed higher for the fall: ${fall.view.pitch} (${want})`);
  sure(aimOf([0, 0, 0], [5000, 0, 0], { speed: 100, gravity: 800 }).view.pitch === 45, "beyond its reach: 45 degrees, the farthest");
  sure(aimOf([0, 0, 0], [0, 0, 100]).view.yaw === undefined && aimOf([0, 0, 0], [0, 0, 100]).view.pitch === 89, "straight over: no yaw");

  const progress = progressOf();
  let now = 0;
  const round = (key, far, hp, hits = 0) => {
    progress.settle(now, hits);
    const track = progress.seen(key, { name: key, far, hp, origin: [0, 0, 0] }, now, hits);
    now += 2000;
    return track;
  };
  let wolf = null;
  for (let n = 0; n < 4; n++) wolf = round("wolf", 300, 30);
  progress.settle(now, 0);
  sure(wolf.idle === 8000 && wolf.idleRounds === 4 && wolf.rounds === 4, `time spent for nothing: ${JSON.stringify(wolf)}`);
  sure(progress.stuck(wolf, 8000) && !progress.stuck(wolf, 8001), "stuck past its time, with four rounds");
  round("wolf", 250, 30);
  sure(wolf.idle === 0 && wolf.best === 250, "nearer by more than 16: getting on");
  round("wolf", 250, 20);
  sure(wolf.idle === 0 && wolf.hp === 20, "his health down: getting on");
  round("wolf", 250, 20, 0);
  progress.settle(now, 1);
  sure(wolf.idle === 0 && wolf.landed === 1, "a blow of the player's landed in his round: getting on");
  sure(round("rat", 50, 5).rounds === 1 && progress.tracks.size === 2, "each enemy his own");

  const census = censusOf(["census 2 within 6000", "census one Wolf hp 114.37 at (779.94,1321.98,0.03) relate enemy", "census one Wilmot hp 25 at (440,648,0) relate ally"], REACH_CENSUS()); // prettier-ignore
  sure(census.count === 2 && census.ones.length === 2 && census.ones[1].relate === "ally", JSON.stringify(census));
  sure(leftOf(census) === "left: Wolf 114 hp at (780,1322,0), 1 of 1", leftOf(census));
  sure(leftOf({ count: 1, ones: [census.ones[1]] }) === "left: no enemy (1 monster counted)" && leftOf(null) === "left: the census was not answered", "nobody left; no answer"); // prettier-ignore
  const table = censusTable(census, "step 3", 6000);
  sure(table[0] === "census (step 3): 2 within 6000, 1 an enemy" && /^ {2}Wolf {4}\s+114 hp {2}at \(780,1322,0\)\s+enemy$/.test(table[1]), table.join(" | ")); // prettier-ignore
});
function REACH_CENSUS() {
  return playPartOf(REACH).census;
}

await testAsync(
  "an enemy that cannot be got at is found out, said with his place, and passed over; what is left is said when the run stops",
  "play: an unreachable enemy",
  async () => {
    const { failure, driver } = await fought("skip", reachDriver({ enemies: penned(), fence: 200 }), [{ fight: { chase: 60, stuck: { after: 4000 } }, until: "all is quiet", within: 30000 }]); // prettier-ignore
    sure(/^play: the game never said \/all is quiet\/ in the 30 seconds its fight was given .* left: wolf 30 hp at \(300,0,36\), 1 of 1\. \(at step 1\)$/.test(failure), `the run stops, and says who is left: ${failure}`); // prettier-ignore
    sure(driver.calls.includes("command skip 0"), "the game told to pass him over");
    sure(driver.calls.filter((call) => /^command census/.test(call)).length === 1, "one census, done by itself");
    const { run, failure: stopped } = await fought("fail", reachDriver({ enemies: penned(), fence: 200 }), [{ fight: { chase: 60, stuck: { after: 4000, then: "fail" } }, until: "all is quiet", within: 30000 }]); // prettier-ignore
    sure(run === null && /^play: \d+ rounds on an unreachable wolf at \(300,0,36\), [\d.]+ s with no blow of the player's landing and not coming nearer: the fight stops \(stuck: "fail"\)\. left: wolf 30 hp at \(300,0,36\), 1 of 1\. \(at step 1\)$/.test(stopped), `stopped at once: ${stopped}`); // prettier-ignore

    // the same pen fought by a run that goes on: the line of the log, and the fight's own
    const kept = await fought("said", reachDriver({ enemies: [...penned(), { name: "rat", hp: 10, at: [-60, 0, 36], hits: 0 }], fence: 200 }), [{ fight: { chase: 60, stuck: { after: 4000 } }, for: 20000 }]); // prettier-ignore
    const fight = kept.run.fights[0];
    sure(kept.run.lines.some((each) => each.kind === "fight" && /^step 1: \d+ rounds on an unreachable wolf at \(300,0,36\) \([\d.]+ s with no blow landing and no nearer\): passed over from now on$/.test(each.text)), "the log says it, as a line a step may expect"); // prettier-ignore
    sure(fight.unreachable.length === 1 && fight.unreachable[0].then === "skip" && fight.slain.join() === "rat", JSON.stringify(fight.unreachable)); // prettier-ignore
    sure(/; unreachable: wolf at \(300,0,36\) after \d+ rounds \(passed over\)$/.test(fightLine(fight)), fightLine(fight));
    // a game that cannot be told to skip: its answers of him are taken for none, and the quiet ends the fight
    const noSkip = { play: { ...REACH.play, target: { ...REACH.play.target, skip: null } } };
    const deaf = await fought("deaf", reachDriver({ enemies: penned(), fence: 200 }), [{ fight: { chase: 60, quiet: 3000, stuck: { after: 4000 } }, for: 40000 }], noSkip); // prettier-ignore
    sure(deaf.run.fights[0].ended === "quiet" && !deaf.driver.calls.some((call) => /skip/.test(call)), `over by its quiet: ${fightLine(deaf.run.fights[0])}`); // prettier-ignore
    // stuck: false, and he is struck at to the end
    const blind = await fought("blind", reachDriver({ enemies: penned(), fence: 200 }), [{ fight: { chase: 60, stuck: false }, for: 20000 }]); // prettier-ignore
    sure(blind.run.fights[0].unreachable === undefined && !blind.driver.calls.includes("command skip 0"), "stuck: false finds nobody out");
  },
);

await testAsync(
  "an enemy that cannot be got at is gone to: the player put beside him, a little over",
  "play: gone to",
  async () => {
    const { run, driver } = await fought("goto", reachDriver({ enemies: penned(), fence: 200 }), [{ fight: { chase: 60, stuck: { after: 4000, then: "goto" } }, until: "all is quiet", within: 60000 }]); // prettier-ignore
    // 40 off him on the player's side (where his sidesteps left him), 36 over his middle and 4 more
    const put = driver.calls.map((call) => /^command put me at (\S+) (\S+) (\S+)$/.exec(call)).find(Boolean)?.slice(1).map(Number); // prettier-ignore
    sure(put && Math.abs(Math.hypot(put[0] - 300, put[1]) - 40) < 0.2 && put[0] < 300 && put[2] === 76 && run.fights[0].slain.join() === "wolf", `put 40 off him, 36 and 4 over: ${put}`); // prettier-ignore
    sure(run.lines.some((each) => each.kind === "fight" && /^step 1: put beside wolf: asked \S+ \S+ 72, at \S+ \S+ 76$/.test(each.text)), "and the log says where he is"); // prettier-ignore
  },
);

await testAsync(
  "a ranged weapon: drawn for an enemy that cannot be got at, aimed, held and let go, and put back for the blows",
  "play: a fight at range",
  async () => {
    const { run, driver } = await fought("shot", reachDriver({ enemies: penned(), fence: 200 }), [{ fight: { chase: 60, ranged: "bow", stuck: { after: 4000 } }, until: "all is quiet", within: 60000 }]); // prettier-ignore
    const fight = run.fights[0];
    sure(fight.slain.join() === "wolf" && fight.ranged.hits === 3 && fight.ranged.shots >= 3 && fight.ranged.draws === 1, `shot dead: ${fightLine(fight)}`); // prettier-ignore
    sure(fight.unreachable[0].then === "ranged" && /; ranged \(bow\): \d+ shots, 3 hits, drawn 1 time; unreachable: wolf at \(300,0,36\) after \d+ rounds \(shot at\)$/.test(fightLine(fight)), fightLine(fight)); // prettier-ignore
    const calls = driver.calls.join("|");
    sure(/command draw bow 1\|.*command hands bow\|.*command \+attack\|.*command -attack/.test(calls) && driver.calls.at(-2) === "command back", "drawn, asked after, held and let go; put back at the end"); // prettier-ignore
    sure(run.lines.some((each) => each.kind === "fight" && each.text === "step 1: drew bow"), "the log says when it was drawn");

    // one near and one far, the far preferred: shot first, then the bow put back and the near one struck
    const pair = [{ name: "archer", hp: 20, at: [500, 0, 36], hits: 0 }, { name: "rat", hp: 20, at: [60, 0, 36], hits: 0 }];
    const both = await fought("both", reachDriver({ enemies: pair }), [{ fight: { prefer: "archer", ranged: { item: "bow", when: "always", near: 100 } }, until: "all is quiet", within: 60000 }]); // prettier-ignore
    const order = both.driver.calls.join("|");
    sure(both.run.fights[0].slain.join() === "archer,rat" && /-attack\|.*command back\|.*mouseUp left/.test(order), `the far one shot, the near one struck: ${both.run.fights[0].slain}`); // prettier-ignore
    sure(both.run.lines.some((each) => each.text === "step 1: put bow back, for the blows"), "the log says it was put back");

    // one high over the player flies: shot at with when "flying"; a weapon that is not drawn stops the run
    const bat = await fought("bat", reachDriver({ enemies: [{ name: "bat", hp: 10, at: [150, 0, 260], hits: 0 }] }), [{ fight: { chase: 60, ranged: { item: "bow", when: "flying" } }, until: "all is quiet", within: 30000 }]); // prettier-ignore
    sure(bat.run.fights[0].slain.join() === "bat" && bat.run.fights[0].ranged.hits === 1 && !bat.run.fights[0].unreachable.length, `a flyer shot down at once: ${fightLine(bat.run.fights[0])}`); // prettier-ignore
    const empty = await fought("empty", reachDriver({ enemies: penned(), drawsNot: true }), [{ fight: { ranged: { item: "bow", when: "always" } }, until: "all is quiet", within: 30000 }]); // prettier-ignore
    sure(/^play: step 1 drew bow \(draw bow 1\) twice, and it is not in the player's hands: "hands bow 0"\. Does the character carry it where the profile's play\.ranged\.draw takes it from \(slot 1\)\?/.test(empty.failure), empty.failure); // prettier-ignore
  },
);

await testAsync(
  "a fight that ends by its quiet without its line fails, and says what is left; with quietEnds it is over, and says so",
  "play: a quiet without its line",
  async () => {
    const rat = () => [{ name: "rat", hp: 10, at: [60, 0, 36], hits: 0 }];
    const { failure, run } = await fought("unended", reachDriver({ enemies: rat() }), [{ fight: { quiet: 1000 }, until: "the yard is quiet", within: 60000 }, { where: "never" }]); // prettier-ignore
    sure(run === null && /^play: step 1: the fight ended by its quiet \(no enemy found for 1 s\), and the game never said \/the yard is quiet\/: the area did not end as the steps thought \(quietEnds: true takes the quiet for its end\)\. left: no enemy \(0 monsters counted\)\. \(at step 1\)$/.test(failure), failure); // prettier-ignore
    const told = await fought("quietEnds", reachDriver({ enemies: rat() }), [{ fight: { quiet: 1000, quietEnds: true }, until: "the yard is quiet", within: 60000 }]); // prettier-ignore
    const fight = told.run.fights[0];
    sure(told.run.passed && fight.unended === "/the yard is quiet/" && /ended by no enemy being left, WITHOUT its line;/.test(fightLine(fight)), fightLine(fight)); // prettier-ignore
    sure(told.run.lines.some((each) => each.kind === "fight" && /^NOTE step 1: the fight ended by its quiet \(no enemy found for 1 s\), and the game never said its line: taken for its end \(quietEnds\)\. left: no enemy/.test(each.text)), "said loudly, without the pattern a later until would stop at"); // prettier-ignore
    const plain = await fought("noUntil", reachDriver({ enemies: rat() }), [{ fight: { quiet: 1000 } }]);
    sure(plain.run.passed && plain.run.fights[0].unended === undefined, "a fight with no until that ends by its quiet is over");
  },
);

await testAsync(
  "a census step prints a table; an until that never came says what is left; a walk that moves nobody stops the run",
  "play: a census, a stuck player",
  async () => {
    const two = () => [{ name: "rat", hp: 10, at: [60, 0, 36], hits: 0 }, { name: "wolf", hp: 30, at: [1500, 0, 36], hits: 0 }]; // prettier-ignore
    const { run } = await fought("census", reachDriver({ enemies: two() }), [{ census: 1000 }, { census: true }]);
    const tables = run.lines.filter((each) => each.kind === "census").map((each) => each.text);
    sure(tables[0] === "census (step 1): 1 within 1000, 1 an enemy" && /^ {2}rat .*10 hp {2}at \(60,0,36\)\s+enemy$/.test(tables[1]) && tables[2] === "census (step 2): 2 within 6000, 2 enemies", tables.join(" | ")); // prettier-ignore
    const waited = await fought("until", reachDriver({ enemies: two() }), [{ command: "noclip", until: "never", within: 1000 }]); // prettier-ignore
    sure(/^play: the game never said \/never\/ in the 1 seconds it was given\. .* left: rat 10 hp at \(60,0,36\), wolf 30 hp at \(1500,0,36\), 2 of 2\. \(at step 1\)$/.test(waited.failure), waited.failure); // prettier-ignore
    const stuck = await fought("solid", reachDriver({ enemies: two(), frozen: true }), [{ goto: [10, 0, 36] }, { walk: 500 }, { where: "never" }]); // prettier-ignore
    sure(/^play: did not move after walk 500 ms: in solid\? \(origin 10 0 40\) \(at step 2\)$/.test(stuck.failure), stuck.failure);
    const walked = await fought("walked", reachDriver({ enemies: two() }), [{ walk: 500, to: "back" }, { where: "there" }]);
    sure(walked.run.passed && walked.run.lines.some((each) => /^where there: origin -100 0 36/.test(each.text)), "a walk that moves him passes");
  },
);
