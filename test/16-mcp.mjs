// The MCP server (cli/mcp/server.mjs), started as a client starts it and spoken to as a client speaks: one JSON
// message a line on its stdin, its answers read from its stdout. The models folder holds the knife; the work
// folder is where the scripts sent to `run` write.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { testAsync, sure, tmp, HERE, knife } from "./helper.mjs";

const SERVER = join(HERE, "../cli/mcp/server.mjs");
const modelsFolder = join(tmp, "mcp-models");
const workFolder = join(tmp, "mcp-work");
mkdirSync(modelsFolder);
mkdirSync(workFolder);
writeFileSync(join(modelsFolder, "knife.mdl"), knife.mdl);

/**
 * The server started with `flags` after its two folders. Returns what a case speaks to it with:
 *   request(method, params)  sends a request and resolves to the whole answer ({ id, result } or { id, error })
 *   tool(name, args)         calls a tool and resolves to its result ({ content, isError })
 *   notify(method, params)   sends a message that is not answered
 *   raw(line)                sends a line as it is, and resolves to the next answer that has no id
 *   close()                  closes its stdin and resolves to its exit code
 */
function startServer(...flags) {
  const child = spawn(process.execPath, [SERVER, "--models", modelsFolder, "--work", workFolder, ...flags], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const waiting = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const answer = JSON.parse(line);
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  });
  const write = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (method, params) =>
    new Promise((answered) => {
      const id = nextId++;
      waiting.set(id, answered);
      write({ id, method, params });
    });
  return {
    request,
    tool: async (name, args = {}) => (await request("tools/call", { name, arguments: args })).result,
    notify: (method, params) => write({ method, params }),
    raw: (line) =>
      new Promise((answered) => {
        waiting.set(null, answered);
        child.stdin.write(`${line}\n`);
      }),
    lastId: () => nextId - 1,
    close: () =>
      new Promise((closed) => {
        child.on("close", closed);
        child.stdin.end();
      }),
  };
}

/** The words of a tool's result, and its pictures read back from their base64. */
const wordsOf = (result) =>
  result.content
    .filter((piece) => piece.type === "text")
    .map((piece) => piece.text)
    .join("\n");
const picturesOf = (result) =>
  result.content
    .filter((piece) => piece.type === "image" && piece.mimeType === "image/png")
    .map((piece) => smak.unpng(Buffer.from(piece.data, "base64")));

const server = startServer();

await testAsync(
  "the MCP server says hello, lists its tools, and hides run when told",
  "mcp: hello",
  async () => {
    const hello = await server.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "selftest", version: "0" },
    });
    sure(
      hello.result.protocolVersion === "2025-03-26" &&
        hello.result.serverInfo.name === "smak" &&
        typeof hello.result.capabilities.tools === "object",
      "the version asked for, the server's name and that it has tools",
    );
    server.notify("notifications/initialized");
    sure(Object.keys((await server.request("ping")).result).length === 0, "ping is answered with nothing");

    const listed = (await server.request("tools/list")).result.tools;
    sure(
      listed.map((tool) => tool.name).join() === "guide,models,info,check,render,run" &&
        listed.every((tool) => tool.description && tool.inputSchema.type === "object"),
      `the tools are ${listed.map((tool) => tool.name).join()}`,
    );

    // a version this server does not speak is answered with its newest; --no-run leaves `run` out
    const reader = startServer("--no-run");
    const helloReader = await reader.request("initialize", { protocolVersion: "1999-01-01" });
    const listedReader = (await reader.request("tools/list")).result.tools;
    const refused = await reader.request("tools/call", { name: "run", arguments: { script: "1" } });
    sure(helloReader.result.protocolVersion === "2025-06-18", "an unknown version gets the newest");
    sure(
      listedReader.length === listed.length - 1 && !listedReader.some((tool) => tool.name === "run"),
      "--no-run still lists run",
    );
    sure(refused.error?.code === -32602, "--no-run still runs");
    sure((await reader.close()) === 0, "the server did not end cleanly when its input closed");
  },
);

await testAsync("guide lists the guide's sections and hands one out", "mcp: guide", async () => {
  // the guide: AGENTS.md, an index, and the guides its briefing was moved to, read as one
  const agentsGuide = ["AGENTS.md", "docs/COMMANDS.md", "docs/MODELS.md", "docs/RESKIN.md", "docs/SHAPES.md", "docs/TROUBLE.md"] // prettier-ignore
    .map((file) => readFileSync(join(HERE, "..", file), "utf8").replace(/\r\n/g, "\n"))
    .join("\n\n");
  const list = wordsOf(await server.tool("guide"));
  sure(
    /Making a shape/.test(list) &&
      /\| It can \| It cannot \|/.test(list) &&
      /examples\/01-new-model\.mjs/.test(list),
    "the list has the sections, the table of what it can and cannot do, and the other documents",
  );
  sure(
    list.length < agentsGuide.length / 4,
    `the list is ${list.length} characters of ${agentsGuide.length}`,
  );

  // a section by the number the list gives it, and the same by its title
  const number = /^\s*(\d+) The loop/m.exec(list)[1];
  const byNumber = wordsOf(await server.tool("guide", { topic: number }));
  const byTitle = wordsOf(await server.tool("guide", { topic: "the loop" }));
  sure(
    byNumber === byTitle && byNumber.startsWith("## The loop") && agentsGuide.includes(byNumber),
    "a section is the guide's own text",
  );
  sure(!/## The command line/.test(byNumber), "a section ran on into the next");

  const several = await server.tool("guide", { topic: "shape" });
  sure(several.isError && /several sections/.test(wordsOf(several)), "a title that fits several is said so");
  sure(
    /turn\(/.test(wordsOf(await server.tool("guide", { doc: "api", find: "M.turn" }))),
    "find, in the API",
  );
  sure(
    /sword/.test(wordsOf(await server.tool("guide", { doc: "kits/swordkit.mjs" }))),
    "a kit's opening comment",
  );
  // every guide of docs/ by its name, and the guide's sections that came from them
  sure(/^## A fight/.test(wordsOf(await server.tool("guide", { doc: "play", topic: "a fight" }))), "docs/PLAY.md by name");
  sure(/docs\/MAPS-SKETCH\.md: \d+ sections/.test(wordsOf(await server.tool("guide", { doc: "maps-sketch" }))), "docs/MAPS-SKETCH.md");
  sure(/^## A re-skin by rules/.test(wordsOf(await server.tool("guide", { topic: "a re-skin by rules" }))), "a recipe moved to docs/RESKIN.md is in the guide still"); // prettier-ignore
});

await testAsync("models, info and check read the knife", "mcp: info", async () => {
  const listed = wordsOf(await server.tool("models"));
  sure(new RegExp(`knife\\.mdl ${knife.mdl.length}`).test(listed), "the knife with its size");

  const told = wordsOf(await server.tool("info", { model: "knife.mdl" }));
  sure(
    /BONES \(2\)/.test(told) &&
      /0 arm, 1 hand<0/.test(told) &&
      new RegExp(`body 0 knife: .* ${knife.piece.tris.length} on knife\\.bmp`).test(told) &&
      /0 knife\.bmp 256x64/.test(told) &&
      /1 wave: 12 frames at 24 fps/.test(told),
    `info said:\n${told}`,
  );
  sure(
    /1 hand<0 at 8\.00 0\.00 0\.00/.test(
      wordsOf(await server.tool("info", { model: "knife.mdl", full: true })),
    ),
    "full",
  );

  const fit = await server.tool("check", { model: "models:knife.mdl", engine: "xash" });
  sure(!fit.isError && /fit for xash/.test(wordsOf(fit)), wordsOf(fit));
  writeFileSync(join(workFolder, "cut.mdl"), knife.mdl.subarray(0, knife.mdl.length - 40));
  sure(
    /ERROR [^]*\d errors: not fit for goldsrc/.test(
      wordsOf(await server.tool("check", { model: "cut.mdl" })),
    ),
    "a cut file",
  );
});

await testAsync("render answers with a PNG of the size asked for", "mcp: render", async () => {
  const view = await server.tool("render", { model: "knife.mdl", side: "left", size: 200 });
  const [picture] = picturesOf(view);
  sure(
    picture.width === 200 && picture.height === 200,
    `a view of 200 came out ${picture.width}x${picture.height}`,
  );
  sure(/knife\.mdl view: body 0, animation 0 frame 0; 200x200/.test(wordsOf(view)), wordsOf(view));
  // something is drawn on it: not every pixel is the first one's colour
  const first = picture.rgba.subarray(0, 3).join();
  let drawn = 0;
  for (let i = 0; i < picture.width * picture.height; i++)
    if (picture.rgba.subarray(i * 4, i * 4 + 3).join() !== first) drawn++;
  sure(drawn > 200, "the picture is empty");

  const [sheet] = picturesOf(await server.tool("render", { model: "knife.mdl", kind: "sheet", size: 300 }));
  const [strip] = picturesOf(
    await server.tool("render", { model: "knife.mdl", kind: "strip", seq: "wave", count: 6, size: 400 }),
  );
  const [map] = picturesOf(await server.tool("render", { model: "knife.mdl", kind: "uv", size: 512 }));
  sure(sheet.width === 300 && sheet.height === 200, `a sheet of 300 came out ${sheet.width}x${sheet.height}`);
  sure(strip.width === 400 && strip.height === 200, `a strip of 400 came out ${strip.width}x${strip.height}`);
  sure(
    map.width === 512 && map.height === 128,
    `a 256x64 texture in 512 came out ${map.width}x${map.height}`,
  );
  sure(
    (await server.tool("render", { model: "knife.mdl", seq: "dance" })).isError,
    "an animation it has not",
  );
});

// what the next case sends: a pot turned in the workshop, written as a model and drawn
const POT_SCRIPT = `
import { writeFileSync } from "node:fs";
import { buildMdl, indexed, check, render, png, readMdl } from "smak";
import * as workshop from "smak/workshop";
import { taper } from "smak/kits/swordkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shape = workshop.shape(64, 64);
const canvas = workshop.sheet(64, 64);
const WALL = { x: 0, y: 0, w: 64, h: 40 };
shape.turn([[0, 3], [5, 4], [6, 3]], WALL, { name: "pot", sides: 8, caps: [true, true] });
canvas.zone(WALL, () => [0.6, 0.4, 0.2]);
const texture = indexed(canvas.image(), "pot.bmp");
const mdl = buildMdl({ name: "pot.mdl", bodyparts: [{ name: "body", models: [{ name: "pot", meshes: [{ tris: shape.tris, texture }] }] }] });
writeFileSync("pot.mdl", mdl);
const picture = render(mdl, { width: 96, height: 80 });
writeFileSync("pot.png", png(picture.width, picture.height, picture.rgba));
const knife = readMdl(readFileSync(join(process.env.SMAK_MODELS, "knife.mdl")));
console.log(check(mdl).errors.length + " errors, " + shape.tris.length + " triangles, " + typeof taper + ", knife " + knife.bones.length);
`;

await testAsync(
  "run builds a model in the workshop, lists what it wrote and shows it",
  "mcp: run",
  async () => {
    const made = await server.tool("run", { script: POT_SCRIPT, show: ["pot.png"] });
    const said = wordsOf(made);
    sure(!made.isError, said);
    sure(/^it ran, in /.test(said) && /0 errors, \d+ triangles, function, knife 2/.test(said), said);
    sure(/written: pot\.mdl \(\d+ bytes\), pot\.png \(\d+ bytes\)/.test(said), `the files written: ${said}`);
    const [picture] = picturesOf(made);
    sure(picture.width === 96 && picture.height === 80, "the picture it was asked to show");
    sure(
      existsSync(join(workFolder, "pot.mdl")) && !existsSync(join(modelsFolder, "pot.mdl")),
      "written to work",
    );
    sure(
      /fit for goldsrc/.test(wordsOf(await server.tool("check", { model: "pot.mdl" }))),
      "the pot checked",
    );
    sure(!/smak-run/.test(wordsOf(await server.tool("models"))), "the script's file was left behind");

    // a script kept by name is there for the next to import; a picture over the cap is shrunk to fit
    const kept = await server.tool("run", { name: "sizes", script: "export const WIDE = 3200;" });
    const wide = await server.tool("run", {
      script: `import { writeFileSync } from "node:fs"; import { png } from "smak"; import { WIDE } from "./sizes.mjs";
writeFileSync("wide.png", png(WIDE, 8, new Uint8Array(WIDE * 8 * 4).fill(200)));`,
      show: ["wide.png", "none.png", "../knife.png"],
    });
    sure(/no file written/.test(wordsOf(kept)) && existsSync(join(workFolder, "sizes.mjs")), wordsOf(kept));
    sure(/written: wide\.png/.test(wordsOf(wide)), wordsOf(wide));
    // a kept script changed in place and run again, without its text being sent a second time
    await server.tool("run", { name: "count", script: 'console.log("pots:", 3);' });
    const changed = await server.tool("run", { name: "count", edits: [{ old: "3", new: "4" }] });
    sure(/pots: 4/.test(wordsOf(changed)), `an edit of a kept script: ${wordsOf(changed)}`);
    const again = await server.tool("run", { name: "count" });
    sure(/pots: 4/.test(wordsOf(again)), `a kept script run again: ${wordsOf(again)}`);
    const twice = await server.tool("run", { name: "count", edits: [{ old: "o", new: "0" }] });
    sure(twice.isError && /times, not once/.test(wordsOf(twice)), `an edit found twice: ${wordsOf(twice)}`);
    const none = await server.tool("run", { name: "never", edits: [{ old: "a", new: "b" }] });
    sure(none.isError && /no script is kept as never\.mjs/.test(wordsOf(none)), wordsOf(none));
    sure(
      picturesOf(wide)[0]?.width === 800,
      `a picture 3200 wide came back ${picturesOf(wide)[0]?.width} wide`,
    );
    sure(/not shown: no such file: work:none\.png/.test(wordsOf(wide)), "a picture that is not there");
    sure(
      /not shown: work:\.\.\/knife\.png is outside/.test(wordsOf(wide)),
      "a picture outside the work folder",
    );
  },
);

await testAsync("run says what a script threw, and stops one that never ends", "mcp: run fails", async () => {
  const thrown = await server.tool("run", {
    script: `console.log("before");\nthrow new Error("the pot is cracked");`,
  });
  const said = wordsOf(thrown);
  sure(thrown.isError && /Error: the pot is cracked/.test(said) && /before/.test(said), said);
  sure(/exit code 1/.test(said) && !/node:internal/.test(said) && !/file:\/\//.test(said), `tidied: ${said}`);

  const endless = await server.tool("run", { script: "for (;;) {}", timeout: 1 });
  sure(endless.isError && /ran over its 1 seconds and was stopped/.test(wordsOf(endless)), wordsOf(endless));

  const much = await server.tool("run", { script: `console.log("x".repeat(20000) + "end")` });
  sure(
    wordsOf(much).length < 7000 && /characters cut here/.test(wordsOf(much)) && /xend/.test(wordsOf(much)),
    "cut",
  );

  // a call the client takes back: its script is stopped, it is not answered, and the next call is
  const takenBack = server.request("tools/call", {
    name: "run",
    arguments: { script: "for (;;) {}", timeout: 60 },
  });
  const id = server.lastId();
  let answered = false;
  takenBack.then(() => {
    answered = true;
  });
  await new Promise((later) => setTimeout(later, 300));
  server.notify("notifications/cancelled", { requestId: id });
  const after = await server.tool("models");
  sure(!after.isError && !answered, "a call taken back was answered, or held the next one up");
});

await testAsync(
  "what is outside the folders, unknown or malformed is refused, and it goes on",
  "mcp: refusals",
  async () => {
    for (const outside of ["../../secret.mdl", join(HERE, "helper.mjs"), "models:../mcp-work/pot.mdl"]) {
      const refused = await server.tool("info", { model: outside });
      sure(refused.isError && /outside/.test(wordsOf(refused)), `${outside}: ${wordsOf(refused)}`);
    }
    const missing = await server.tool("info", { model: "nothing.mdl" });
    sure(missing.isError && /no such file/.test(wordsOf(missing)), "a model that is not there");
    sure((await server.tool("render", {})).isError, "render with no model");

    const noTool = await server.request("tools/call", { name: "explode", arguments: {} });
    const noMethod = await server.request("resources/list");
    sure(noTool.error?.code === -32602 && /no tool explode/.test(noTool.error.message), "an unknown tool");
    sure(noMethod.error?.code === -32601, "an unknown method");

    const malformed = await server.raw('{"jsonrpc": "2.0", "id": 1, "method": ');
    const notRpc = await server.raw('{"hello": "there"}');
    sure(malformed.error?.code === -32700 && malformed.id === null, "a line that is not JSON");
    sure(notRpc.error?.code === -32600, "JSON that is not a request");
    sure(/knife\.mdl/.test(wordsOf(await server.tool("models"))), "it answers no more after a bad line");
    sure((await server.close()) === 0, "the server did not end cleanly");
  },
);
