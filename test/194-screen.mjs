// The game's eye (make/render.mjs gameEye, check/screen.mjs): a view model drawn on the player's screen (its shape, Hor+
// from a 4:3 fov, the near plane at 4), every frame of an animation with its time, an onion skin, one model beside
// another, a GIF at the game's rate; and the screen measured (screenOf, judgeScreen) on a forearm made from nothing
// (test/fixture-viewmodel.mjs), with smak motion's WARN lines and its JSON. The spoiled cases are in broken/screen.mjs.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test, sure, near, tmp, HERE } from "./helper.mjs";
import * as smak from "../src/index.mjs";
import { viewModel } from "./fixture-viewmodel.mjs";

const clean = viewModel().mdl;
const swing = { seq: "swing", view: "first", screen: "16:9" };

test("gameEye: 90 on a 4:3 base is 106.26 across a 16:9 screen, 73.74 up it, the near plane at 4", () => {
  const eye = smak.gameEye({ screen: "16:9", fov: 90 });
  near(eye.fov, 106.26, 0.01, "across 16:9");
  near(eye.vfov, 73.74, 0.01, "up it");
  sure(eye.width === 640 && eye.height === 360 && eye.near === 4, JSON.stringify(eye));
  near(smak.gameEye({ screen: "4:3" }).fov, 90, 1e-9, "4:3 is the base");
  near(smak.aspectOf("21:9"), 21 / 9, 1e-9, "w:h");
  let said = "";
  try {
    smak.aspectOf("wide");
  } catch (error) {
    said = error.message;
  }
  sure(/16:9, 4:3, 16:10 or w:h, not wide/.test(said), said);
  const picture = smak.render(clean, { ...swing, width: 320 });
  sure(picture.width === 320 && picture.height === 180, `the picture is the screen's shape: ${picture.width}x${picture.height}`);
});

test("strip: every frame with its time, beside another model's same frames; onion skin; a GIF at the game's rate", () => {
  const every = smak.strip(clean, { ...swing, every: true, width: 160 });
  sure(every.width === 160 * 6 && every.height === 90 * 2, `7 frames, 6 to a row: ${every.width}x${every.height}`);
  const beside = smak.strip(clean, { ...swing, every: true, width: 160, beside: { mdl: viewModel("near").mdl, name: "near" }, name: "clean" });
  sure(beside.width === 160 * 6 && beside.height === 90 * 4, `a row of the other under each row: ${beside.width}x${beside.height}`);
  const skin = smak.onion(clean, { ...swing, width: 320, bones: ["forearm"] });
  sure(skin.width === 320 && skin.height === 180, "the onion skin is one picture the screen's shape");
  const g = smak.animationGif(clean, { ...swing, width: 160, beside: { mdl: viewModel("open").mdl } });
  sure(g.width === 160 && g.height === 180 && g.frames === 7 && g.fps === 30, JSON.stringify({ ...g, bytes: g.bytes.length }));
  // 30 a second in a GIF's hundredths: 3, 4, 3 ..., ten in every three frames
  const delays = [...g.bytes.toString("latin1").matchAll(/\x21\xf9\x04\x00(.)/gs)].map((m) => m[1].charCodeAt(0));
  sure(delays.length === 7 && delays.slice(0, 6).reduce((a, b) => a + b) === 20, `the delays: ${delays.join()}`);
  sure(smak.bonesUnder(clean, ["root"]).size === 2 && smak.bonesUnder(clean, null) === null, "a bone with those under it");
});

test("screenOf: the clean forearm covers little and shows no inside; judgeScreen says nothing of it", () => {
  const m = smak.screenOf(clean, { seq: "swing" });
  sure(m.frames.length === 7 && m.most.cover < 0.05, JSON.stringify(m.most));
  sure(m.frames.every((f) => f.cuts.every((c) => c.share < smak.SCREEN_LIMITS.OPEN)), "no inside seen");
  sure(!smak.judgeScreen(m).faults.length, smak.judgeScreen(m).faults.join(" | "));
  const near4 = smak.screenOf(viewModel("near").mdl, { seq: "swing" }).frames[3].cuts[0];
  sure(near4.kind === "near" && near4.bone === "forearm" && near4.share > 0.1, JSON.stringify(near4));
  sure(smak.placeOnScreen(0.9, 0.9) === "lower right" && smak.placeOnScreen(0.5, 0.5) === "middle", "where on the screen, in words");
});

test("smak motion: a view model's screen faults are WARN lines, in its JSON too; strip --every --onion --beside", () => {
  const file = join(tmp, "v_open.mdl");
  writeFileSync(file, viewModel("open").mdl);
  const run = (...args) => spawnSync(process.execPath, [join(HERE, "..", "bin", "smak.mjs"), ...args], { encoding: "utf8" });
  const said = run("motion", file, "--seq", "swing");
  sure(/WARN  screen: swing: frames? .*the player sees into forearm's mesh through its open end/.test(said.stdout), said.stdout + said.stderr);
  sure(/, 1 warning of what the screen shows$/m.test(said.stdout), said.stdout);
  const json = JSON.parse(run("motion", file, "--seq", "swing", "--json").stdout);
  sure(json.animations[0].screen.warnings.length === 1 && json.animations[0].screen.cover.length === 7, JSON.stringify(json.animations[0].screen));
  for (const extra of [["--every"], ["--onion", "--bones", "forearm"], ["--every", "--beside", file]]) {
    const out = run("strip", file, "--seq", "swing", "--view", "first", "--screen", "16:9", "--width", "160", ...extra, "-o", join(tmp, "eye.png"));
    sure(out.status === 0, `${extra.join(" ")}: ${out.stderr}`);
  }
  const wrong = run("strip", file, "--view", "side", "--screen", "16:9", "-o", join(tmp, "x.png"));
  sure(wrong.status === 1 && /--screen is the game's eye of a view model/.test(wrong.stderr), wrong.stderr);
});

test("screenOf's sweep: the forearm's mesh over the frames asked, one union (the fan)", () => {
  const one = smak.screenOf(clean, { seq: "swing", sweep: { bones: ["forearm"], from: 2, to: 2 } });
  const all = smak.screenOf(clean, { seq: "swing", sweep: { bones: ["forearm"], from: 0, to: 6 } });
  near(one.sweep, one.frames[2].cover, 1e-9, "one frame's sweep is its cover");
  sure(all.sweep > one.sweep && all.sweep < 0.05 && smak.screenOf(clean, { seq: "swing" }).sweep === undefined, `${one.sweep} ${all.sweep}`);
});
