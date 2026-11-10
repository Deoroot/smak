// Faults of the command line and the viewer, mended in 0.7.1: each case is one that failed before.
// A wrong argument is answered with one sentence and exit code 1, never with a stack trace; the arguments
// are looked at before any work is done; and nothing a request holds stops a server.
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  test,
  testAsync,
  sure,
  tmp,
  runSmak,
  runRefused,
  quietly,
  SMAK_CLI,
  knife,
} from "./helper.mjs";

// the folder of this area's files: the knife, files that are not what they are named, and a project
const folder = join(tmp, "tool-faults");
const modelFile = join(folder, "knife.mdl");
mkdirSync(join(folder, "a-folder"), { recursive: true });
writeFileSync(modelFile, knife.mdl);
writeFileSync(join(folder, "not-a-model.mdl"), "this is not a model\n");
writeFileSync(join(folder, "not-a-picture.png"), "this is not a picture\n");
writeFileSync(join(folder, "not-json.json"), "{ not json");
writeFileSync(join(folder, "no-frames.json"), "{}");
writeFileSync(join(folder, "not-a-module.mjs"), "export const layers = 5 +;\n");
writeFileSync(join(folder, "a-file"), "x");
const inFolder = (name) => join(folder, name);

/**
 * One wrong command line: it has to end with exit code 1 and one sentence that `says` matches, with no stack
 * trace under it.
 */
const refused = (cli, args, says) => {
  const run = runRefused(cli, ...args);
  const asked = `smak ${args.join(" ")}`;
  sure(run.code === 1, `${asked}: exit code ${run.code}, and it printed ${run.out.slice(0, 80)}`);
  sure(!/\n\s+at /.test(run.err), `${asked}: a stack trace: ${run.err.slice(0, 200)}`);
  sure(says.test(run.err), `${asked}: it said ${run.err.slice(0, 200)}`);
  sure(run.err.trim().split("\n").length === 1, `${asked}: more than a sentence: ${run.err.slice(0, 200)}`);
};

test("every command that takes --seq takes `rest`", () => {
  const countIn = (printed) => Number(/^(\d+) (pieces|islands)/m.exec(printed)[1]);
  // the knife rests as its first animation stands it: the lists are the same
  sure(
    countIn(runSmak("islands", modelFile, "--seq", "rest")) === countIn(runSmak("islands", modelFile)),
    "islands --seq rest",
  );
  sure(
    countIn(runSmak("pieces", modelFile, "--seq", "rest")) === countIn(runSmak("pieces", modelFile)),
    "pieces --seq rest",
  );
  sure(
    /stands at rest/.test(runSmak("layers", modelFile, "bright=lum>0.5", "--texture", "0", "--seq", "rest")),
    "layers --seq rest",
  );
  runSmak("render", modelFile, "--seq", "rest", "-o", inFolder("rest.png"));
});

test("a command that needs -o says so before it does its work", () => {
  // each has something else wrong that the work would trip over: -o is what is said
  for (const command of ["render", "sheet", "strip"])
    refused(SMAK_CLI, [command, modelFile, "--seq", "no-such-animation"], /^\w+: -o out\.png/);
  refused(SMAK_CLI, ["retexture", modelFile, "no-such-texture", inFolder("nothing.png")], /-o out\.mdl/);
  refused(SMAK_CLI, ["sequence", modelFile, "no-such-animation"], /-o seq\.json/);
  refused(SMAK_CLI, ["sequence-set", modelFile, "wave", inFolder("nothing.json")], /-o out\.mdl/);
  refused(SMAK_CLI, ["sequence-add", modelFile, inFolder("nothing.json")], /-o out\.mdl/);
  refused(SMAK_CLI, ["inline", modelFile], /-o out\.mdl/);
});

test("smak answers a wrong argument with a sentence and exit code 1", () => {
  const out = inFolder("out.png");
  const cases = [
    // a file that is not there, is a folder, or is not what it is named
    [["info", inFolder("nothing.mdl")], /no such file/],
    [["info", inFolder("a-folder")], /a-folder is a folder, not a file/],
    [["info", inFolder("not-a-model.mdl")], /^info: not a studio model/],
    [["obj", inFolder("a-folder"), "-o", inFolder("x.mdl")], /is a folder, not a file/],
    [["obj", inFolder("not-a-model.mdl"), "-o", inFolder("x.mdl")], /^obj: readObj: no faces/],
    [["retexture", modelFile, "0", inFolder("nothing.png"), "-o", inFolder("x.mdl")], /no such file/],
    [["retexture", modelFile, "0", inFolder("not-a-picture.png"), "-o", inFolder("x.mdl")], /not a PNG/],
    [["sequence-set", modelFile, "wave", inFolder("nothing.json"), "-o", inFolder("x.mdl")], /no such file/],
    [["sequence-set", modelFile, "wave", inFolder("not-json.json"), "-o", inFolder("x.mdl")], /is not JSON/],
    [["sequence-set", modelFile, "wave", inFolder("no-frames.json"), "-o", inFolder("x.mdl")], /no frames/],
    [["sequence-add", modelFile, inFolder("no-frames.json"), "-o", inFolder("x.mdl")], /no frames/],
    [["layers", modelFile, inFolder("nothing.mjs")], /no such file/],
    [["layers", modelFile, inFolder("not-a-module.mjs")], /cannot be loaded/],
    // where the result goes: a file is where a folder would have to be
    [["render", modelFile, "-o", join(inFolder("a-file"), "r.png")], /a file of that name is in the way/],
    [["textures", modelFile, "-o", inFolder("a-file")], /a file of that name is in the way/],
    // an animation, a texture that the model has not
    [["render", modelFile, "-o", out, "--seq", "leap"], /^render: no animation leap: it has idle, wave/],
    [["strip", modelFile, "-o", out, "--seq", "9"], /^strip: no animation 9/],
    [["islands", modelFile, "--seq", "leap"], /^islands: no animation leap/],
    [["pieces", modelFile, "--seq", "leap"], /^pieces: no animation leap/],
    [["sequence", modelFile, "leap", "-o", inFolder("x.json")], /^sequence: no animation leap/],
    [["uv", modelFile, "-o", folder, "--texture", "skin.bmp"], /^uv: no texture skin\.bmp/],
    [["islands", modelFile, "--texture", "9"], /^islands: no texture 9/],
    [["layers", modelFile, "a=lum>0.5", "--texture", "skin.bmp"], /^layers: no texture skin\.bmp/],
    [["retexture", modelFile, "skin.bmp", out, "-o", inFolder("x.mdl")], /no texture skin\.bmp/],
    // a word where a number is wanted, and a word that is not one of the few
    [["render", modelFile, "-o", out, "--frame", "last"], /--frame: a number, not last/],
    [["render", modelFile, "-o", out, "--body", "knife"], /--body: a number, not knife/],
    [["render", modelFile, "-o", out, "--width", "wide"], /--width: a number, not wide/],
    [["sheet", modelFile, "-o", out, "--size", "big"], /--size: a number, not big/],
    [["strip", modelFile, "-o", out, "--count", "many"], /--count: a number, not many/],
    [["strip", modelFile, "-o", out, "--count", "0"], /--count: a whole number from 1, not 0/],
    [["islands", modelFile, "--min", "few"], /--min: a number, not few/],
    [["pieces", modelFile, "--body", "knife"], /--body: a number, not knife/],
    [
      ["render", modelFile, "-o", out, "--view", "sideways"],
      /--view: orbit or first or side or front or top, not sideways/,
    ],
    [["check", modelFile, "--engine", "quake"], /--engine: goldsrc or xash or source, not quake/],
    // a flag with nothing after it
    [["render", modelFile, "-o"], /-o needs a file or a folder after it/],
    [["render", modelFile, "-o", out, "--seq"], /--seq needs a value after it/],
    [["uv", modelFile, "-o", folder, "--texture"], /--texture needs a value after it/],
    [["check", modelFile, "--engine"], /--engine needs a value after it/],
    // a layer that is not JavaScript, or names what is not there
    [["layers", modelFile, "a=(", "--texture", "0"], /^layers: a=\( cannot be read as JavaScript/],
    [["layers", modelFile, "a=nothing>1", "--texture", "0"], /^layers: nothing is not defined/],
  ];
  for (const [args, says] of cases) refused(SMAK_CLI, args, says);
});

/** A request that is given up after four seconds: a server that has stopped answering fails the case. */
const ask = (address) => fetch(address, { signal: AbortSignal.timeout(4000) });

await testAsync(
  "an address that cannot be read is answered, and the viewer goes on",
  "addresses that cannot be read",
  async () => {
    const { view } = await import("../cli/viewer/serve.mjs");
    const viewer = await quietly(() => view([folder], 0));
    try {
      const viewerAddress = `http://127.0.0.1:${viewer.address().port}`;
      sure((await ask(`${viewerAddress}//`)).status === 400, "the viewer, asked for //");
      sure((await ask(`${viewerAddress}/%E0%A4%A`)).status === 404, "the viewer, asked for /%E0%A4%A");
      sure((await ask(`${viewerAddress}/api/models`)).status === 200, "the viewer stopped answering");
    } finally {
      viewer.close();
    }
  },
);
await testAsync(
  "a port that is taken is said, by the servers and by smak",
  "a port that is taken",
  async () => {
    const { view } = await import("../cli/viewer/serve.mjs");
    const taken = createServer();
    await new Promise((listening) => taken.listen(0, "127.0.0.1", listening));
    const port = taken.address().port;
    const realLog = console.log;
    try {
      // each rejects, where it once threw from inside Node with nobody to catch it
      for (const start of [
        () => view([folder], port),
      ]) {
        let code = "";
        try {
          (await quietly(start)).close();
        } catch (error) {
          code = error.code;
        }
        sure(code === "EADDRINUSE", `a server on a taken port: ${code || "it started"}`);
      }
      // and printing is as it was after a server that did not start
      sure(console.log === realLog, "console.log was not given back");
      refused(SMAK_CLI, ["view", folder, "--port", String(port)], new RegExp(`^view: port ${port} is taken`));
    } finally {
      taken.close();
    }
  },
);
