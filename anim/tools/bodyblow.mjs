// Third-person blows for a body (anim/lib/bodyblow.mjs): made from a spec on a game's own skeleton, judged against
// Vermintide 2's third-person bands (anim/corpus/body-vt2.json), written as a keys file the game lays over its
// locomotion.
//
//   node anim/tools/bodyblow.mjs <spec.json> --rig <dump.json> [--grip <dump.json>] [--out <keys.json>]
//        [--only <name>] [--json] [--list]
//
// --rig the game's dump of its skeleton and armed idle (rpg_sbox: tools/cs/body_dump.cs; local, never committed);
// --grip a dump whose sword-hand fingers are closed (their locals become the grip); --out the keys file;
// --list every measure of every blow against its band; --json the results as JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { rigFromDump, calibrate, makeBlow, readyPose, judgeBlow, keysFile } from "../lib/bodyblow.mjs";
import { CORPUS } from "../lib/bands.mjs";

const args = process.argv.slice(2);
const opts = {};
const loose = [];
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) loose.push(args[i]);
  else if (args[i] === "--json" || args[i] === "--list") opts[args[i].slice(2)] = true;
  else opts[args[i].slice(2)] = args[++i];
}
if (!loose[0] || !opts.rig) {
  console.error("usage: node anim/tools/bodyblow.mjs <spec.json> --rig <dump.json> [--grip <dump.json>] [--out keys.json] [--only name] [--list] [--json]");
  process.exit(2);
}
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const spec = read(loose[0]);
const rig = calibrate(rigFromDump(read(opts.rig), { grip: opts.grip ? read(opts.grip) : null }));
const bands = read(`${CORPUS}body-vt2.json`);
const ready = readyPose(rig, spec);
const made = { ready: { ...makeBlow(rig, spec, { name: "ready", keys: [{ t: 0, at: "ready" }, { t: 1 / (spec.fps ?? 60), at: "ready" }] }), hold: true, blendIn: 0.2 } };
const results = [];
for (const blow of spec.blows) {
  if (opts.only && !blow.name.includes(opts.only)) continue;
  const m = makeBlow(rig, spec, blow);
  m.blendIn = blow.blendIn ?? 0.1;
  m.hold = !!blow.hold;
  made[blow.name] = m;
  const row = { name: blow.name, strength: blow.strength ?? null, info: { ...m.info, timing: blow._timing } };
  if (blow.strength) {
    const j = judgeBlow(rig, m, ready, bands, blow.strength);
    Object.assign(row, { values: j.values, measured: j.info, list: j.list, word: j.word });
  }
  results.push(row);
}
if (opts.out) {
  writeFileSync(opts.out, JSON.stringify(keysFile(rig, spec, made)));
  console.error(`wrote ${opts.out}`);
}
if (opts.json) {
  console.log(JSON.stringify(results.map(({ name, strength, info, values, word, list }) => ({ name, strength, info, values, word, out: list?.filter((v) => v.where === "low" || v.where === "high").map((v) => ({ key: v.key, value: v.value, where: v.where, far: v.far, design: v.noise })) })), null, 1));
  process.exit(0);
}
const f = (x) => (x === null || x === undefined ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
const SHOW = ["time.windup", "time.strike", "time.follow", "time.peakAt", "time.length", "hand.reachHit", "hand.extendHit", "tip.reachHit", "arc.tip", "height.handCock", "height.handHit", "strike.down", "strike.across", "trunk.spineYawRange", "trunk.leanHit", "trunk.headPitchHit", "off.heightHit", "off.aheadHit", "off.counter", "speed.tipFa"];
for (const r of results) {
  const i = r.info;
  console.log(`\n${r.name}${r.strength ? ` (${r.strength})` : ""}: ${r.word ? r.word.say : "(not judged)"}`);
  if (r.info.timing) console.log(`  timing: ${JSON.stringify(r.info.timing, (k, v) => (typeof v === "number" ? Number(v.toFixed(3)) : v))}`);
  console.log(`  arm: reach short by ${f(i.short)} fa at most, wrist bend ${f(i.wristMax)} deg, twist ${f(i.twistMax)} deg; the blade's least clearance from the trunk's axis ${f(i.clearMin)} fa (frame ${i.clearAt}), from the legs' ${f(i.legsMin)} fa (frame ${i.legsAt}); hit key at ${i.hitAt ?? "-"} s`);
  if (!r.list) continue;
  for (const v of r.list) {
    if (!opts.list && !SHOW.includes(v.key) && !(v.where === "low" || v.where === "high")) continue;
    const b = v.band;
    const mark = v.where === "low" || v.where === "high" ? (v.noise ? "~" : "!") : v.where === "edge" ? "." : " ";
    console.log(`  ${mark} ${v.key.padEnd(22)} ${f(v.value).padStart(7)}  ${b ? `${f(b.median)} [${f(b.q1)}, ${f(b.q3)}] 5-95% ${f(b.p5)}..${f(b.p95)}` : "no band"}  ${v.where}${v.far ? ` ${f(v.far)} IQR` : ""}${v.why ? ` (${v.why})` : ""}`);
  }
}
