// The play driver: steps checked and made actions, a map played through a driver, the profile's part in it,
// and the command line's refusals.
//
// No browser and no game: the driver here is a fake one that writes down every call and waits no time, so
// what is tested is the order of the calls, the names of the pictures and the sentences of the refusals.
// That the real driver enters a real game is not tested here (it needs Playwright and a build of the engine).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, testAsync, sure, tmp, runRefused, SMAK_CLI } from "./helper.mjs";

const { play, playOf, playPartOf, playwrightFrom, browserDriver } = smak.play;
const folder = join(tmp, "play");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);

/** A driver that writes its calls down as words (`command noclip`, `wait 1000`) and prints two console lines. */
const fakeDriver = (faults = {}) => {
  const calls = [];
  const note =
    (name) =>
    (...given) => {
      calls.push([name, ...given].join(" "));
      if (faults[name]?.(...given)) throw new Error(`the fake driver's ${name} failed`);
    };
  const driver = { calls, log: () => ["the console's first line", "its second"] };
  for (const name of ["ready", "command", "keyDown", "keyUp", "press", "click", "wait", "close"])
    driver[name] = note(name);
  driver.shot = (file) => {
    calls.push(`shot ${file}`);
    writeFileSync(file, "a picture");
  };
  return driver;
};
/** The sentence a call refuses with, or "" when it does not refuse. */
const refusal = (run) => {
  try {
    run();
  } catch (e) {
    return e.message;
  }
  return "";
};
const refusalOf = async (run) => {
  try {
    await run();
  } catch (e) {
    return e.message;
  }
  return "";
};
// a made-up game: a menu to click through, and speech that takes two commands
const GAME = {
  name: "smakgame",
  play: { enter: [{ click: [100, 200], wait: 50 }, { press: "Enter", wait: 70 }], say: ["aloud", "say {text}"], loads: 400 }, // prettier-ignore
};

// ── steps into actions ──

test("playOf makes each kind of step a plain action, with its wait and its picture", () => {
  const actions = playOf([
    { command: "noclip" },
    { command: ["sv_cheats 1", "god"], wait: 0 },
    { walk: 2000 },
    { walk: 500, to: "left", shot: "aside" },
    { button: "jump", ms: 200 },
    { hold: "w", ms: 300 },
    { hold: "s" },
    { press: "e" },
    { click: [512, 330] },
    { wait: 5000 },
    { shot: "here" },
  ]);
  const plain = actions.map(({ step: _step, ...rest }) => rest);
  const expected = [
    { kind: "command", commands: ["noclip"], wait: 1000, shot: null },
    { kind: "command", commands: ["sv_cheats 1", "god"], wait: 0, shot: null },
    { kind: "button", button: "forward", ms: 2000, wait: 1000, shot: null },
    { kind: "button", button: "moveleft", ms: 500, wait: 1000, shot: "aside" },
    { kind: "button", button: "jump", ms: 200, wait: 1000, shot: null },
    { kind: "hold", key: "w", ms: 300, wait: 1000, shot: null },
    { kind: "hold", key: "s", ms: 1000, wait: 1000, shot: null },
    { kind: "press", key: "e", wait: 1000, shot: null },
    { kind: "click", x: 512, y: 330, wait: 1000, shot: null },
    { kind: "wait", wait: 5000, shot: null },
    { kind: "wait", wait: 0, shot: "here" },
  ];
  expected.forEach((action, index) =>
    sure(
      JSON.stringify(plain[index]) === JSON.stringify(action),
      `step ${index + 1} became ${JSON.stringify(plain[index])}`,
    ),
  );
  sure(actions[3].step.to === "left", "an action keeps the step it was made from");
  sure(
    playOf([{ command: "noclip" }], { pause: 250 })[0].wait === 250,
    "pause is the wait of a step that gives none",
  );
});

test("a turn is a button held for the time cl_yawspeed takes, and the profile says the speed", () => {
  const [left, right] = playOf([{ turn: 90 }, { turn: -210 }]);
  sure(
    left.button === "left" && left.ms === 429,
    `90 degrees at 210 a second is 429 ms to the left, not ${left.button} ${left.ms}`,
  );
  sure(
    right.button === "right" && right.ms === 1000,
    `-210 degrees is a second to the right, not ${right.button} ${right.ms}`,
  );
  const [slow] = playOf([{ turn: 90 }], { mod: { play: { yawspeed: 90 } } });
  sure(slow.ms === 1000, `at a profile's 90 a second a quarter turn is a second, not ${slow.ms}`);
});

test("say is the profile's: one command in Half-Life, the game's own where a profile gives them", () => {
  sure(
    playOf([{ say: "hello there" }])[0].commands.join("|") === "say hello there",
    "with no profile a thing is said with say",
  );
  sure(
    playOf([{ say: "hail" }], { mod: GAME })[0].commands.join("|") === "aloud|say hail",
    "the profile's list, with the words in it",
  );
  const shouted = { play: { say: (text) => [`shout ${text.toUpperCase()}`] } };
  sure(
    playOf([{ say: "hail" }], { mod: shouted })[0].commands.join("|") === "shout HAIL",
    "a profile's say may be a function",
  );
  const part = playPartOf({ play: { loads: 9 } });
  sure(
    part.loads === 9 && part.say[0] === "say {text}" && part.enter.length === 0,
    "a play field left out is GOLDSRC's",
  );
  sure(playPartOf(smak.maps.GOLDSRC).yawspeed === 210, "GOLDSRC turns at the SDK's 210 degrees a second");
});

test("a wrong step is refused in a sentence that names it", () => {
  const wrong = [
    [["noclip"], /step 1 is "noclip": a step is an object/],
    [
      [{ walk: 100 }, { cmd: "noclip" }],
      /step 2 has cmd, which no step has: a step is one of command, say, walk/,
    ],
    [[{ walk: 100, say: "hail" }], /step 1 has say and walk: one thing a step/],
    [[{}], /step 1 does nothing/],
    [[{ walk: "far" }], /step 1 walks for "far": a number of milliseconds over 0/],
    [[{ walk: 100, to: "north" }], /walks to "north": forward, back, left, right/],
    [[{ turn: 0 }], /step 1 turns 0: degrees/],
    [[{ click: [10] }], /step 1 clicks \[10\]: \[x, y\]/],
    [[{ command: "" }], /step 1 gives the command "": a console command/],
    [[{ say: "hail; quit" }], /step 1: say is the words to say, with no ;/],
    [[{ button: "+jump", ms: 100 }], /holds the button "\+jump": a button's name without its \+/],
    [[{ button: "jump" }], /holds its button for nothing: a number of milliseconds over 0/],
    [[{ press: "e", ms: 100 }], /has ms, which goes with hold or button only/],
    [[{ walk: 100, wait: -1 }], /step 1 waits -1: wait is a number of milliseconds/],
    [[{ walk: 100, shot: "a/b" }], /names its picture "a\/b": letters, digits, _ and -/],
    [{ walk: 100 }, /the steps are a list/],
  ];
  for (const [steps, sentence] of wrong) {
    const said = refusal(() => playOf(steps));
    sure(
      sentence.test(said),
      `${JSON.stringify(steps)} was ${said ? `refused with: ${said}` : "not refused"}`,
    );
  }
  sure(/mod: play.say is a list of console commands/.test(refusal(() => playOf([], { mod: { play: { say: "say" } } }))), "a profile's say that is a word is refused"); // prettier-ignore
  sure(/mod: play.enter is a list of steps/.test(refusal(() => playPartOf({ play: { enter: "click" } }))), "a profile's enter that is no list is refused"); // prettier-ignore
});

// ── a map played through a driver ──

await testAsync(
  "play waits for the engine, loads the map, enters as the profile says and does the steps, in that order",
  "play: the order of the calls",
  async () => {
    const driver = fakeDriver();
    const out = inFolder("run");
    const told = [];
    const run = await play({
      ...{ driver, map: "orchard", out, mod: GAME, tell: (line) => told.push(line) },
      steps: [
        { walk: 3000, shot: "walked" },
        { say: "hail", wait: 0 },
        { hold: "w", ms: 20, wait: 0 },
        { shot: "last" },
      ],
    });
    const shot = (name) => `shot ${join(out, name)}`;
    const expected = [
      "ready",
      ...["command map orchard", "wait 400", shot("00_loaded.png")],
      ...["click 100 200", "wait 50", "press Enter", "wait 70", shot("01_entered.png")],
      ...["command +forward", "wait 3000", "command -forward", "wait 1000", shot("02_walked.png")],
      ...["command aloud", "wait 150", "command say hail"],
      ...["keyDown w", "wait 20", "keyUp w"],
      shot("03_last.png"),
      "close",
    ];
    expected.forEach((call, index) =>
      sure(
        driver.calls[index] === call,
        `call ${index + 1} was ${driver.calls[index]}, where ${call} was expected`,
      ),
    );
    sure(
      driver.calls.length === expected.length,
      `${driver.calls.length} calls, where ${expected.length} were expected`,
    );

    const names = run.pictures.map((file) => file.slice(out.length + 1));
    sure(
      names.join(" ") === "00_loaded.png 01_entered.png 02_walked.png 03_last.png",
      `the pictures were ${names.join(" ")}`,
    );
    sure(
      run.pictures.every((file) => existsSync(file)),
      "every picture named is a file",
    );
    sure(run.log.join("|") === "the console's first line|its second", "the console's lines come back");
    sure(
      readFileSync(run.logFile, "utf8") === "the console's first line\nits second",
      "and are written to log.txt",
    );
    const parts = run.steps.map((entry) => `${entry.part}:${entry.kind}`).join(" ");
    sure(
      parts ===
        "load:ready load:command enter:click enter:press enter:wait steps:button steps:command steps:hold steps:wait",
      `what was done came back as ${parts}`,
    );
    sure(
      run.steps.every((entry) => entry.at >= 0 && entry.took >= 0),
      "each with its time",
    );
    sure(
      run.steps[5].picture === run.pictures[2] && run.steps[6].picture === null,
      "and its picture, when it took one",
    );
    sure(
      told.length === run.steps.length && /"walk":3000.*02_walked\.png/.test(told[5]),
      "tell is handed a line a thing done",
    );
  },
);

await testAsync(
  "with no profile nothing is clicked, and no picture is taken of an entering that did not happen",
  "play: no profile",
  async () => {
    const driver = fakeDriver();
    const run = await play({
      driver,
      map: "c1a0",
      out: inFolder("plain"),
      loads: 0,
      steps: [{ turn: 90, wait: 0 }],
    });
    sure(
      driver.calls.slice(0, 6).join("|") ===
        `ready|command map c1a0|shot ${join(inFolder("plain"), "00_loaded.png")}|command +left|wait 429|command -left`,
      `the calls were ${driver.calls.join("|")}`,
    );
    sure(run.pictures.length === 1, "one picture: the map loaded");
  },
);

await testAsync(
  "what is wrong is refused before the driver is touched; a driver that fails is closed and its log kept",
  "play: refusals",
  async () => {
    const untouched = fakeDriver();
    const given = { driver: untouched, map: "orchard", out: inFolder("refused") };
    const wrong = [
      [{ ...given, steps: [{ walk: 100 }, { jump: 1 }] }, /step 2 has jump, which no step has/],
      [
        { ...given, mod: { play: { enter: [{ click: "card" }] } } },
        /the profile's enter step 1 clicks "card"/,
      ],
      [{ ...given, map: "orchard; quit" }, /map is the map's name/],
      [{ ...given, out: undefined }, /out is the folder the pictures and the log go to/],
      [
        { ...given, driver: { ready() {} } },
        /driver is an object with ready, command.*this one has no command, keyDown/,
      ],
      [{ ...given, driver: undefined }, /driver is an object with ready, command/],
    ];
    for (const [options, sentence] of wrong) {
      const said = await refusalOf(() => play(options));
      sure(sentence.test(said), said ? `it was refused with: ${said}` : `${sentence} was not refused`);
    }
    sure(
      untouched.calls.length === 0,
      `the driver was called before the refusal: ${untouched.calls.join(", ")}`,
    );

    // the page dies in the middle of a walk
    const broken = fakeDriver({ wait: (ms) => ms === 100 });
    let failure = null;
    try {
      await play({
        driver: broken,
        map: "orchard",
        out: inFolder("broken"),
        loads: 0,
        steps: [{ walk: 100 }],
      });
    } catch (e) {
      failure = e;
    }
    sure(
      /^play: the fake driver's wait failed \(at step 1\)$/.test(failure?.message ?? ""),
      `it said: ${failure?.message}`,
    );
    sure(broken.calls.at(-1) === "close", "the driver is closed after a failure");
    sure(broken.calls.includes("command -forward"), "and the button that was pressed is let go");
    sure(
      existsSync(failure.logFile) && failure.pictures.length === 1,
      "the log and the pictures taken so far are named",
    );
  },
);

// ── Playwright, which is the caller's ──

test("Playwright is looked for in the folder named and nowhere else, and its absence is said", () => {
  const empty = inFolder("no-playwright");
  mkdirSync(empty, { recursive: true });
  sure(/there is no Playwright in .*no-playwright.*npm install playwright/.test(refusal(() => playwrightFrom(empty))), "an empty folder"); // prettier-ignore
  sure(/Playwright is not part of this kit.*--playwright <folder>/.test(refusal(() => playwrightFrom(undefined))), "no folder at all"); // prettier-ignore
  sure(/there is no Playwright in/.test(refusal(() => browserDriver({ url: "http://127.0.0.1:1/", playwright: empty }))), "browserDriver, of a folder without it"); // prettier-ignore
  sure(/url is the address of the page/.test(refusal(() => browserDriver({ url: "orchard.bsp", playwright: {} }))), "browserDriver, of no address"); // prettier-ignore
  sure(/playwright is the Playwright module/.test(refusal(() => browserDriver({ url: "http://127.0.0.1:1/", playwright: {} }))), "browserDriver, of a module that is not it"); // prettier-ignore

  // a module handed in is taken as it is, and nothing is launched until ready()
  let launched = 0;
  const driver = browserDriver({
    url: "http://127.0.0.1:1/",
    playwright: { chromium: { launch: () => launched++ } },
  });
  sure(
    launched === 0 && typeof driver.ready === "function" && driver.log().length === 0,
    "a driver is made without a browser",
  );
});

test("smak play refuses in a sentence: no map, wrong steps, no Playwright, no address", () => {
  const empty = inFolder("no-playwright");
  const steps = inFolder("steps.json");
  writeFileSync(steps, JSON.stringify([{ walk: 3000, shot: "walked" }, { say: "hail" }]));
  const wrongSteps = inFolder("wrong.json");
  writeFileSync(wrongSteps, JSON.stringify([{ walk: 3000 }, { fly: 1 }]));
  const URL = "http://127.0.0.1:1/";
  const cases = [
    [
      [URL, "--map", "orchard", "--steps", steps, "--playwright", empty],
      /^play: there is no Playwright in .*no-playwright/,
    ],
    [
      [URL, "--map", "orchard", "--steps", wrongSteps, "--playwright", empty],
      /^play: step 2 has fly, which no step has/,
    ],
    [[URL, "--steps", steps, "--playwright", empty], /^play: --map <name>/],
    [
      [URL, "--map", "orchard", "--steps", wrongSteps.replace("wrong", "absent")],
      /^no such file: .*absent\.json/,
    ],
    [["orchard.bsp", "--map", "orchard"], /^play: the address of the page that runs the game comes first/],
  ];
  for (const [args, sentence] of cases) {
    const run = runRefused(SMAK_CLI, "play", ...args);
    sure(
      run.code === 1 && sentence.test(run.err),
      `smak play ${args.join(" ")} ended with ${run.code}: ${run.err}`,
    );
    sure(!/\n\s+at /.test(run.err), "no stack trace");
  }
});

// ── clips and pans (0.26.0) ──

test("record starts a clip by its name and record: false ends it; a pan is a look with ms", () => {
  const [start, end, pan] = playOf([{ record: "plaza" }, { record: false }, { face: 270, look: -10, ms: 3000 }]);
  sure(start.kind === "record" && start.clip === "plaza", `record "plaza" made ${JSON.stringify(start)}`);
  sure(end.kind === "record" && end.clip === null, `record false made ${JSON.stringify(end)}`);
  sure(start.wait === 0 && end.wait === 0, "a clip's start and end wait no time: they do nothing to the game");
  sure(pan.kind === "look" && pan.yaw === 270 && pan.pitch === -10 && pan.ms === 3000, `the pan made ${JSON.stringify(pan)}`); // prettier-ignore
  sure(/records "a b": a clip's name/.test(refusal(() => playOf([{ record: "a b" }]))), "a clip's name with a space is refused"); // prettier-ignore
  sure(/has ms, which goes with/.test(refusal(() => playOf([{ walk: 100, ms: 5 }]))), "ms on a walk is still refused");
});

await testAsync("a pan sets the view in steps, eased to where it was told, by the shorter way round", "play: a pan", async () => {
  const driver = fakeDriver();
  let view = { yaw: 170, pitch: 0, origin: [0, 0, 0] };
  const looks = [];
  driver.view = async () => ({ ...view });
  driver.look = async (to) => {
    looks.push(to);
    view = { ...view, ...to };
    return { ...view };
  };
  driver.wait = (ms) => new Promise((done) => setTimeout(done, Math.min(ms, 2)));
  await play({ driver, map: "orchard", out: inFolder("pan"), mod: GAME, steps: [{ face: -170, look: 20, ms: 60 }] });
  sure(looks.length > 2, `the pan set the view ${looks.length} times`);
  const last = looks[looks.length - 1];
  sure(Math.abs(last.yaw - 190) < 1e-6 && Math.abs(last.pitch - 20) < 1e-6, `it ended at ${JSON.stringify(last)}: 190 (the same as -170) and 20`); // prettier-ignore
  sure(looks.every((to) => to.yaw >= 170 - 1e-6 && to.yaw <= 190 + 1e-6), "it went the 20 degrees across 180, not the 340 the other way"); // prettier-ignore
});

const { hasFfmpeg, encodeTimed } = await import("../check/video.mjs");
if (hasFfmpeg()) {
  const { spawnSync } = await import("node:child_process");
  const jpeg = (colour) => spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=${colour}:s=64x48`, "-frames:v", "1", "-f", "mjpeg", "-"]).stdout; // prettier-ignore
  const frames = [{ at: 1000, jpeg: jpeg("red") }, { at: 1500, jpeg: jpeg("blue") }, { at: 2000, jpeg: jpeg("green") }];

  await testAsync("encodeTimed holds each picture until the next was drawn, at a steady rate", "video: a timed clip", async () => {
    const mp4 = await encodeTimed(frames, { fps: 10 });
    sure(mp4.length > 200 && mp4.includes(Buffer.from("ftyp")), "an MP4 came back");
    const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", "-"], { input: mp4 }); // prettier-ignore
    const count = Number(String(probe.stdout).trim());
    sure(count === 11, `a second at 10 a second, its ends included, is 11 frames: it had ${count}`);
  });

  await testAsync("a clip is filmed through the driver and written NN_name.mp4; one left open ends with the run", "play: clips", async () => { // prettier-ignore
    const driver = fakeDriver();
    driver.recordStart = async () => driver.calls.push("recordStart");
    driver.recordStop = async () => (driver.calls.push("recordStop"), frames);
    const out = inFolder("clips");
    const run = await play({ driver, map: "orchard", out, mod: GAME, steps: [{ record: "gate" }, { wait: 5 }, { record: false }, { shot: "after" }, { record: "open" }] }); // prettier-ignore
    sure(run.passed !== false, `the run failed: ${run.failure?.message}`);
    sure(existsSync(join(out, "02_gate.mp4")), "the first clip is 02_gate.mp4, numbered after the two pictures of the entry");
    sure(existsSync(join(out, "04_open.mp4")), "the clip still open at the end is written as 04_open.mp4");
    sure(driver.calls.filter((call) => call === "recordStop").length === 2, "each clip was ended once");
  });
}

await testAsync("a clip on a driver that cannot film stops the run and says so", "play: no clip", async () => {
  const said = await play({ driver: fakeDriver(), map: "orchard", out: inFolder("noclip"), mod: GAME, steps: [{ record: "x" }] }).then( // prettier-ignore
    (run) => run.failure?.message ?? "",
    (error) => error.message,
  );
  sure(/this driver cannot film a clip/.test(said), `the run said ${said}`);
});
