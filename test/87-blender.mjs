// Blender where the machine has it (src/blender.mjs): found by the variable, by its usual places, or not at
// all; a float picture read back the right way up; a job's round trip (JSON in, a result and files out), a
// script's fail() and its uncaught exception thrown as Errors with their messages, a too new minVersion refused
// before Blender runs; a cube's bake, its answer known: each face's colour, its normal, and the occlusion a
// floor under it casts on its bottom and not its top; and a small rigged .glb inspected: its bones, their
// parents, its action's frames. The Blender cases run only where Blender is found (SMAK_BLENDER, or where it is
// usually installed); without it, each is said to be skipped.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, near, tmp } from "./helper.mjs";
import { gltfBuilder, CUBE_POINTS, CUBE_FACES } from "./fixture-import.mjs";

const folder = join(tmp, "blender");
mkdirSync(folder, { recursive: true });

test("findBlender: the program named first, null where there is none, every place it looks said", () => {
  const fake = join(folder, "my-blender.exe");
  writeFileSync(fake, "");
  sure(smak.findBlender({ blender: fake }) === fake, "the program given is taken first");
  const places = smak.blenderPlaces({ blender: fake });
  sure(places[0] === fake && places.length > 1, `places: ${places.slice(0, 3)}`);
  const saved = { variable: process.env.SMAK_BLENDER, path: process.env.PATH };
  process.env.SMAK_BLENDER = join(folder, "nowhere.exe");
  sure(
    smak.blenderPlaces()[0] === process.env.SMAK_BLENDER,
    "the variable is looked at first when none is given",
  );
  if (saved.variable === undefined) delete process.env.SMAK_BLENDER;
  else process.env.SMAK_BLENDER = saved.variable;
});

test("readFloatMap: Blender's rows from the bottom read from the top", () => {
  const file = join(folder, "two");
  const floats = new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]); // a 1 by 2 picture: the bottom row black, the top white
  writeFileSync(file, Buffer.from(floats.buffer));
  writeFileSync(file + ".json", JSON.stringify({ width: 1, height: 2 }));
  const map = smak.readFloatMap(file);
  sure(map.width === 1 && map.height === 2 && map.data[0] === 1 && map.data[4] === 0, `${[...map.data]}`);
});

const blender = smak.findBlender();
const withBlender = (name, run) => {
  if (blender) test(name, run);
  else console.log(`skip  ${name}\n      skipped: no Blender (set SMAK_BLENDER to its program to run it)`);
};

withBlender(
  "bakeMaps: a cube baked onto a cube, each face's colour, normal and occlusion as they are",
  () => {
    const S = smak.solids;
    const low = S.trisOf(S.box(S.place([0, 0, 0], [0, 0, 1], [1, 0, 0]), 4, 4, 4)).map((t) =>
      t.map((c) => c.p),
    );
    const high = low.map((t) => t.map((p) => p.map((v) => v * 1.01)));
    // each face in a 32 pixel cell of a 96 by 64 picture, 4 pixels in from its edges
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; // prettier-ignore
    const colours = [[0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8], [0.8, 0.8, 0.1], [0.1, 0.8, 0.8], [0.8, 0.1, 0.8]]; // prettier-ignore
    const faceOf = (t) => {
      const n = S.unit(S.cross(S.sub(t[1], t[0]), S.sub(t[2], t[0])));
      return faces.findIndex((f) => S.dot(f, n) > 0.99);
    };
    const cell = (f) => [(f % 3) * 32, Math.floor(f / 3) * 32];
    const uv = low.map((t) => {
      const f = faceOf(t);
      const axes = [0, 1, 2].filter((a) => !faces[f][a]);
      const [x0, y0] = cell(f);
      return t.map((p) => [x0 + 4 + ((p[axes[0]] + 2) / 4) * 24, y0 + 4 + ((2 - p[axes[1]]) / 4) * 24]);
    });
    // a floor a little under the cube, to shade its bottom
    const floor = [[[-20, -20, -2.6], [20, -20, -2.6], [20, 20, -2.6]], [[-20, -20, -2.6], [20, 20, -2.6], [-20, 20, -2.6]]]; // prettier-ignore
    const out = smak.bakeMaps(
      [{ low: { tris: low, uv }, high: { tris: high, colours: high.map((t) => colours[faceOf(t)]) } }],
      { width: 96, height: 64, outDir: join(folder, "cube"), ao: 3, occluders: floor, samples: 32 },
    );
    const at = (map, f) => {
      const [x0, y0] = cell(f);
      const i = ((y0 + 16) * 96 + x0 + 16) * 4;
      return [map.data[i], map.data[i + 1], map.data[i + 2]];
    };
    faces.forEach((n, f) => {
      const a = at(out.albedo, f);
      a.forEach((v, k) => near(v, colours[f][k], 0.02, `face ${f}'s colour, channel ${k}`));
      const nn = at(out.normal, f);
      nn.forEach((v, k) => near(v, (n[k] + 1) / 2, 0.03, `face ${f}'s normal, channel ${k}`));
    });
    const top = at(out.ao, 4)[0];
    const bottom = at(out.ao, 5)[0];
    sure(top > 0.9, `the top is open to the sky: ${top}`);
    sure(bottom < 0.6, `the bottom is shaded by the floor: ${bottom}`);
  },
);

/** A job script written for the tests, with the helper's read_job, write_result, fail, out_path and say. */
const script = (name, lines) => {
  const file = join(folder, name);
  writeFileSync(file, ["from blender_job import read_job, write_result, fail, out_path, say", ...lines, ""].join("\n"));
  return file;
};

/** The Error a call throws, or null. */
const thrown = (run) => {
  try {
    run();
  } catch (e) {
    return e;
  }
  return null;
};

withBlender("runBlenderJob: a job in as JSON, its result and a file back, Blender's version with them", () => {
  const echo = script("echo.py", [
    "import bpy",
    "job = read_job()",
    "open(out_path('notes/said.txt'), 'w', encoding='utf8').write(job['text'].upper())",
    "say('summed', len(job['numbers']))",
    "write_result({'sum': sum(job['numbers']), 'text': job['text'], 'bpy': list(bpy.app.version)})",
  ]);
  const out = join(folder, "echo");
  const run = smak.runBlenderJob(echo, { numbers: [1, 2, 3.5], text: "über" }, { out, minVersion: "2.80" });
  sure(run.result.sum === 6.5 && run.result.text === "über", JSON.stringify(run.result));
  sure(run.files.join() === "notes/said.txt", `files: ${run.files}`);
  sure(readFileSync(join(out, "notes/said.txt"), "utf8") === "ÜBER", "the file the script wrote");
  sure(run.lines.includes("summed 3"), `lines: ${run.lines}`);
  const version = smak.blenderVersion();
  sure(version.length === 3 && version.every(Number.isInteger), `version ${version}`);
  sure(run.version.join() === version.join(), `the job's ${run.version}, asked ${version}`);
  // Blender's own word inside the job agrees with `blender --version`
  sure(run.result.bpy.slice(0, 2).join() === version.slice(0, 2).join(), `bpy.app.version ${run.result.bpy}`);
});

withBlender("runBlenderJob: a script's fail() and its uncaught exception come back as Errors with their messages", () => {
  const no = script("no.py", ["job = read_job()", "fail('the job says no: %d' % job['n'])", "write_result(1)"]);
  let said = thrown(() => smak.runBlenderJob(no, { n: 42 }));
  sure(said && /the job says no: 42$/.test(said.message), `fail(): ${said?.message}`);
  const broken = script("broken.py", ["job = read_job()", "raise ValueError('a value the job cannot use')"]);
  said = thrown(() => smak.runBlenderJob(broken, {}));
  sure(said && /ValueError: a value the job cannot use$/.test(said.message), `uncaught: ${said?.message}`);
  sure(/Traceback/.test(said.traceback ?? ""), "its traceback kept beside the message");
});

withBlender("runBlenderJob: a Blender older than minVersion refused, before the script runs", () => {
  const out = join(folder, "too-old");
  const marker = script("marker.py", ["open(out_path('ran.txt'), 'w').write('ran')", "write_result(1)"]);
  const said = thrown(() => smak.runBlenderJob(marker, {}, { out, minVersion: "999.1" }));
  sure(said && /older than 999\.1\.0, which this job needs/.test(said.message), `${said?.message}`);
  sure(!existsSync(join(out, "ran.txt")), "the script was not run");
});

/** A .glb of a cube skinned to two bones, `root` and `tip` 1 above it, and an action "bend" a second long. */
function rigGlb() {
  const g = gltfBuilder();
  const POSITION = g.accessor(CUBE_POINTS.flat(), "VEC3");
  const JOINTS_0 = g.accessor(CUBE_POINTS.flatMap((p) => (p[1] < 0 ? [0, 0, 0, 0] : [1, 0, 0, 0])), "VEC4", 5121);
  const WEIGHTS_0 = g.accessor(CUBE_POINTS.flatMap(() => [1, 0, 0, 0]), "VEC4");
  const index = g.accessor(CUBE_FACES.flatMap((f) => [f[0], f[1], f[2], f[0], f[2], f[3]]), "SCALAR", 5123);
  const moved = (y) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, y, 0, 1];
  const binds = g.accessor([...moved(0), ...moved(-1)], "MAT4");
  const times = g.accessor([0, 1], "SCALAR");
  const s = Math.SQRT1_2;
  const turns = g.accessor([0, 0, 0, 1, 0, 0, s, s], "VEC4");
  Object.assign(g.json, {
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: "root", children: [1] },
      { name: "tip", translation: [0, 1, 0] },
      { name: "body", mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0, 1], inverseBindMatrices: binds }],
    meshes: [{ primitives: [{ attributes: { POSITION, JOINTS_0, WEIGHTS_0 }, indices: index }] }],
    animations: [
      {
        name: "bend",
        samplers: [{ input: times, output: turns }],
        channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
      },
    ],
  });
  return g.glb();
}

withBlender("blenderInspect: a rigged .glb's armature, its bones under their parents, its action's frames", () => {
  const file = join(folder, "rig.glb");
  writeFileSync(file, rigGlb());
  const seen = smak.blenderInspect(file);
  sure(seen.armatures.length === 1, `armatures: ${JSON.stringify(seen.armatures)}`);
  const [arm] = seen.armatures;
  const parent = Object.fromEntries(arm.bones.map((b) => [b.name, b.parent]));
  sure(parent.root === null && parent.tip === "root", `bones: ${JSON.stringify(arm.bones)}`);
  const bend = seen.actions.find((a) => /bend/.test(a.name));
  sure(bend && arm.actions.includes(bend.name), `actions: ${JSON.stringify(seen.actions)}`);
  // a second at the scene's frames a second
  near(bend.frames[1] - bend.frames[0], seen.fps, 1e-6, "a second's frames");
  near(bend.seconds, 1, 1e-6, "a second long");
  sure(bend.bones.includes("tip"), `the bones it moves: ${bend.bones}`);
  const body = seen.meshes.find((m) => m.armature === arm.name);
  sure(body && body.triangles === 12, `meshes: ${JSON.stringify(seen.meshes)}`);
  sure(seen.version.length === 3, `version ${seen.version}`);
  const said = thrown(() => smak.blenderInspect(join(folder, "nowhere.glb")));
  sure(said && /no such file: .*nowhere\.glb$/.test(said.message), `a missing file: ${said?.message}`);
});
