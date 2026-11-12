// The architecture check (test/00-architecture.mjs) on small trees, each broken in one way: an import that points up,
// a file in no layer, a rule that puts a file of a layer's folder in another layer, an exception written down that no
// import needs any more, the kit over its ratchet, a kit module no root reaches, a line that names a game. The twin is
// the same tree whole.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkArchitecture } from "../architecture-check.mjs";
import { tmp } from "../helper.mjs";
import { broken } from "./case.mjs";

let made = 0;
/** A tree of three files (a core one, a make one over it, a cli one over both) and its manifest; `change` edits the files before the check. */
const tree = (change = {}, manifest = {}) => {
  const root = join(tmp, `broken-architecture${made++}`);
  mkdirSync(join(root, "src"), { recursive: true });
  const files = {
    "src/a.mjs": "export const a = 1;\n",
    "src/b.mjs": 'import { a } from "./a.mjs";\nexport const b = a + 1;\n',
    "src/c.mjs": 'import { a } from "./a.mjs";\nimport { b } from "./b.mjs";\nexport const c = a + b;\n',
    "layers.json": JSON.stringify({ rules: [{ path: "src/a.mjs", layer: "core" }, { path: "src/b.mjs", layer: "make" }, { path: "src/c.mjs", layer: "cli" }], allowed: [], ...manifest }), // prettier-ignore
    ...change,
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return () => checkArchitecture(root, { folders: ["src"], roots: ["src/c.mjs"] }).fails;
};

const whole = tree();

broken("architecture", "a core file imports a make file", {
  said: /^src\/a\.mjs \(core\) imports src\/b\.mjs \(make\)$/,
  broken: tree({ "src/a.mjs": 'import { b } from "./b.mjs";\nexport const a = b;\n' }),
  whole,
});
broken("architecture", "an import with await import() that points up", {
  said: /^src\/b\.mjs \(make\) imports src\/c\.mjs \(cli\)$/,
  broken: tree({ "src/b.mjs": 'import { a } from "./a.mjs";\nconst { c } = await import("./c.mjs");\nexport const b = a + c;\n' }),
  whole,
});
broken("architecture", "a file in no layer", {
  said: /^src\/d\.mjs is in no layer of layers\.json$/,
  broken: tree({ "src/d.mjs": "export const d = 1;\n" }),
  whole,
});
broken("architecture", "an exception written down that no import needs", {
  said: /^layers\.json: allowed src\/b\.mjs -> src\/a\.mjs is not an upward import: remove it$/,
  broken: tree({}, { allowed: [{ from: "src/b.mjs", to: "src/a.mjs", why: "a debt", until: "P2" }] }),
  whole,
});
broken("architecture", "the kit over the ratchet written in layers.json", {
  said: /^ratchet: the kit is 6 lines, over the 2 written in layers\.json: delete as much as you add, or raise the number in the same commit and say why$/,
  broken: tree({}, { ratchet: { lines: 2, why: "a test" } }),
  whole,
});
broken("architecture", "a kit module no command, kit or tool reaches", {
  said: /^src\/d\.mjs \(make\) is reached from no command, kit, MCP server, script, viewer, profile or example: it goes dormant$/,
  broken: tree({ "src/d.mjs": "export const d = 1;\n" }, { rules: [{ path: "src", layer: "make" }, { path: "src/a.mjs", layer: "core" }, { path: "src/c.mjs", layer: "cli" }] }), // prettier-ignore
  whole,
});
// the name is put together here, so that this file does not name it
const GAME = ["Hav", "oc9"].join("");
broken("architecture", "a line of the kit that names a game", {
  said: new RegExp(`^src/a\\.mjs:1 names a game \\(${GAME.slice(0, 5)}\\): // the doors of ${GAME}'s cities$`),
  broken: tree({ "src/a.mjs": `// the doors of ${GAME}'s cities\nexport const a = 1;\n` }),
  whole,
});
broken("architecture", "a rule that puts a file of a layer's folder in another layer", {
  said: /^layers\.json: rule core\/a\.mjs says make, but it is in the folder core\/: the folder is the layer$/,
  broken: () => {
    const root = join(tmp, `broken-architecture${made++}`);
    mkdirSync(join(root, "core"), { recursive: true });
    writeFileSync(join(root, "core/a.mjs"), "export const a = 1;\n");
    writeFileSync(join(root, "layers.json"), JSON.stringify({ rules: [{ path: "core", layer: "core" }, { path: "core/a.mjs", layer: "make" }], allowed: [] })); // prettier-ignore
    return checkArchitecture(root, { folders: ["core"], roots: ["core/a.mjs"] }).fails;
  },
  whole,
});
