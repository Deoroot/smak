#!/usr/bin/env node
// generate: the map generator's stages on a city description, one tile at a time (PLAN.md Phase 3, "The map
// generator"). Each stage reads the artifacts it names, writes NN-<stage>.json to --out and runs its gate; the
// first failing gate stops the run with a sentence naming the thing. The same description, tile and seed give
// the same files, byte for byte. levels/experimental-city/ARTIFACTS.md documents every artifact.
//
//   node levels/tools/generate.mjs <description.json> [--tile c1_r1] [--until N] [--from N] [--seed S] [--kit] [--wads dir] --out <dir>
//
//   --tile   the tile to build (default: the one `tiles.names` calls Core)
//   --until  the last stage to run, in the runner's order (each stage after those it reads: 0 1 2 4 3 5 ...;
//            default: every registered stage)
//   --from   resume: the stages before N in that order are read back from --out, and refused when stale
//   --seed   the seed for the choices the description leaves (default 1)
//   --kit    stage 10 (geometry): wear the kit's own textures (levels/art: newbyzantium.wad) where it serves a
//            role, the WAD listed last; without it every texture is one the clients already have
//   --wads   stage 10: a folder of the clients' WAD files, whose directories the texture audit reads in place of
//            the record (levels/art/client-textures.json)
//
// Exit code 0 when every stage run passed, 1 on a failing gate or a refusal, 2 on wrong arguments.
import fs from "node:fs";
import { runGenerator, defaultTile } from "../experimental-city/runner.mjs";

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--kit") args.kit = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
  else args._.push(a);
}
const num = (v, d) => (v === undefined ? d : Number(v));
const file = args._[0];
const bad = !file || !args.out || ["until", "from", "seed"].some((k) => k in args && !Number.isInteger(num(args[k])));
if (bad) {
  console.error("usage: generate <description.json> [--tile c1_r1] [--until N] [--from N] [--seed S] --out <dir>");
  process.exit(2);
}
let desc;
try {
  desc = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`FAIL  ${file}: cannot read it as JSON (${e.message})`);
  process.exit(1);
}
const tile = args.tile ?? defaultTile(desc);
const res = await runGenerator({ desc, out: args.out, tile, seed: num(args.seed, 1), until: num(args.until, Infinity), from: num(args.from, 0), options: { kit: Boolean(args.kit), wads: args.wads ? fs.readdirSync(args.wads).filter((f) => /\.wad$/i.test(f)).map((f) => `${args.wads}/${f}`) : [] } }); // prettier-ignore
for (const r of res.results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  stage ${r.n} ${r.name}  ${r.file}${r.reused ? "  (read back, fresh)" : `  sha256 ${r.hash.slice(0, 16)}`}`); // prettier-ignore
  for (const f of r.failures) console.log(`  FAIL  ${f}`);
  for (const n of r.notes ?? []) console.log(`  note  ${n}`);
}
if (res.refused) console.log(`REFUSED  ${res.refused}`);
else if (res.stopped) console.log(`STOPPED at stage ${res.stopped.n} ${res.stopped.name}: ${res.stopped.failures[0]}`);
else console.log(`done: ${desc.name} tile ${tile}, ${res.results.length} stages, artifacts in ${args.out}`);
process.exit(res.ok ? 0 : 1);
