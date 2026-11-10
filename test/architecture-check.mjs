// The architecture check (ARCHITECTURE.md 2.1 to 2.4), as a function of a tree: `layers.json` at the root maps every
// .mjs file to a layer; the imports of every file are parsed; an edge that points up is a failure. With its gates armed
// (P3), a kit module no root reaches is a failure, and so is a line of the kit that names a game. 00-architecture.mjs
// runs it on this repository, and test/broken/architecture.mjs on small trees with one fault each.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

/** The layers from the lowest: an import may point at the same layer or a lower one. `example` imports anything. */
export const ORDER = ["core", "make", "check", "cli", "example"];
const RANK = Object.fromEntries(ORDER.map((layer, at) => [layer, at]));
/** The layers whose lines count in the kit's budget (ARCHITECTURE.md 2.3). */
export const KIT = ["core", "make", "check", "cli"];
/** The folders whose .mjs files the manifest must cover. */
export const FOLDERS = ["src", "bin", "kits", "mcp", "viewer", "profiles", "examples", "scripts"];
/** The kit's budget in lines (2.3). */
export const BUDGET = 60000;
/** Names of a game the kit must not hold (2.1): case-insensitive, at the start of a word (h9 holds H9XASH and h9-maps). */
export const GAME_NAMES = ["h9", "havoc", "byzant", "newbyzant", "kowloon", "mese"];
/**
 * Where the names are looked for: every .mjs, .md and .html file of the folders checked, of `docs/` and `test/`, and the
 * .md files at the root. History may keep them: `docs/history/`, CHANGELOG.md and ARCHITECTURE.md say what was, and this
 * file lists the names.
 */
export const NAMES_IN = ["docs", "test"];
export const NAMES_EXEMPT = ["docs/history", "CHANGELOG.md", "ARCHITECTURE.md", "test/architecture-check.mjs"];
/**
 * Where the walk for orphans starts (3.3): the command line, the MCP server, the scripts, the viewer, the kits, the examples,
 * and the mods' profiles (a command loads one by its name or path with --mod, not by an import).
 */
export const ROOTS = ["bin/smak.mjs", "mcp/*", "scripts/*", "viewer/*", "kits/*", "profiles/*", "examples/*"];

const slash = (path) => path.split(sep).join("/");

/** Every file of the given endings (.mjs) under the folders of the tree, as paths relative to its root with `/`. */
export function mjsFiles(root, folders = FOLDERS, endings = [".mjs"]) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (endings.some((ending) => entry.name.endsWith(ending))) found.push(path);
    }
  };
  for (const folder of folders) if (existsSync(join(root, folder)) && statSync(join(root, folder)).isDirectory()) walk(folder); // prettier-ignore
  return found.sort();
}

/** The code of a file without block comments and whole-line comments, which may name imports that are not there. */
const stripped = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The specifiers a file imports (static, `export ... from` and `import("...")`), and how many dynamic imports build their path. */
export function importsIn(text) {
  const code = stripped(text);
  const specs = [];
  for (const match of code.matchAll(/\b(?:import|export)\s+(?:[^"'`;()]*?\s+from\s+)?["']([^"']+)["']/g)) specs.push(match[1]);
  for (const match of code.matchAll(/\bimport\s*\(\s*(["'])([^"'$]*?)\1\s*\)/g)) specs.push(match[2]);
  let opaque = 0;
  for (const _ of code.matchAll(/\bimport\s*\(\s*(?!["'][^"'$]*["']\s*\))/g)) opaque++;
  return { specs, opaque };
}

/** The layer of a path by the most specific rule (the longest path that is the file or a folder above it), or undefined. */
export function layerOf(rules, path) {
  let best;
  for (const rule of rules) {
    const at = rule.path.replace(/\/$/, "");
    if ((path === at || path.startsWith(`${at}/`)) && (!best || at.length > best.at.length)) best = { at, layer: rule.layer };
  }
  return best?.layer;
}

const lineCount = (text) => (text.length ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);

/**
 * The whole check of a tree. Returns { fails, notes, counts, orphans, hits, files, layers, allowedCount }: `fails` are
 * the lines for `FAIL:`; the orphans and the game names are among them when their gate is armed (`armed`, P3), and the
 * counts are measures (the budget is a NOTE, see 00-architecture.mjs).
 */
export function checkArchitecture(root, { manifest = "layers.json", folders = FOLDERS, roots = ROOTS, armed = { orphans: true, names: true } } = {}) {
  const fails = [];
  const notes = [];
  const file = join(root, manifest);
  if (!existsSync(file)) return { fails: [`${manifest} is missing`], notes, counts: {}, orphans: [], hits: [], files: [], allowedCount: 0 };
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const rules = spec.rules ?? [];
  for (const rule of rules) if (!rule.path || !RANK.hasOwnProperty(rule.layer)) fails.push(`${manifest}: rule ${JSON.stringify(rule)} has no known layer or path`); // prettier-ignore
  const allowed = spec.allowed ?? [];
  for (const each of allowed) if (!each.from || !each.to || !each.why || !["P2", "P3"].includes(each.until)) fails.push(`${manifest}: allowed ${JSON.stringify(each)} needs from, to, why and until (P2 or P3)`); // prettier-ignore

  const files = mjsFiles(root, folders);
  const layers = new Map();
  for (const path of files) {
    const layer = layerOf(rules, path);
    if (layer) layers.set(path, layer);
    else fails.push(`${path} is in no layer of ${manifest}`);
  }
  const used = new Set();
  const edges = new Map();
  let opaque = 0;
  for (const from of files) {
    const found = importsIn(readFileSync(join(root, from), "utf8"));
    opaque += found.opaque;
    const targets = [];
    for (const target of found.specs) {
      if (!target.startsWith(".")) continue;
      const to = slash(relative(root, resolve(root, dirname(from), target)));
      if (!to.endsWith(".mjs")) continue;
      if (!existsSync(join(root, to))) {
        fails.push(`${from} imports ${to}, which is not there`);
        continue;
      }
      targets.push(to);
      const a = layers.get(from);
      const b = layerOf(rules, to);
      if (!b) {
        fails.push(`${from} imports ${to}, which is in no layer of ${manifest}`);
        continue;
      }
      if (a && RANK[b] > RANK[a] && a !== "example") {
        const hit = allowed.findIndex((each) => each.from === from && each.to === to);
        if (hit >= 0) used.add(hit);
        else fails.push(`${from} (${a}) imports ${to} (${b})`);
      }
    }
    edges.set(from, [...new Set(targets)]);
  }
  allowed.forEach((each, at) => {
    if (!used.has(at)) fails.push(`${manifest}: allowed ${each.from} -> ${each.to} is not an upward import: remove it`);
  });
  if (opaque) notes.push(`${opaque} dynamic imports with a built path were not followed`);

  // orphans: modules of core, make and check that no root reaches (3.3 rule 1)
  const isRoot = (path) => roots.some((r) => (r.endsWith("/*") ? dirname(path) === r.slice(0, -2) : path === r));
  const reached = new Set();
  const queue = files.filter(isRoot);
  while (queue.length) {
    const path = queue.pop();
    if (reached.has(path)) continue;
    reached.add(path);
    queue.push(...(edges.get(path) ?? []));
  }
  const orphans = files.filter((path) => ["core", "make", "check"].includes(layers.get(path)) && !reached.has(path));
  if (armed.orphans) for (const path of orphans) fails.push(`${path} (${layers.get(path)}) is reached from no command, kit, MCP server, script, viewer, profile or example: it goes dormant`); // prettier-ignore

  // lines of each layer (2.3)
  const counts = Object.fromEntries(ORDER.map((layer) => [layer, 0]));
  for (const path of files) if (layers.get(path)) counts[layers.get(path)] += lineCount(readFileSync(join(root, path), "utf8"));
  // the ratchet (2.3): the kit's lines may not go over the number written in the manifest; a commit that adds
  // deletes as much, or raises the number in the same commit and says why there
  const kitLines = KIT.reduce((sum, layer) => sum + (counts[layer] ?? 0), 0);
  const ratchet = spec.ratchet?.lines;
  if (ratchet != null && kitLines > ratchet) fails.push(`ratchet: the kit is ${kitLines} lines, over the ${ratchet} written in ${manifest}: delete as much as you add, or raise the number in the same commit and say why`); // prettier-ignore

  // game names in the kit (2.1): its code, its tests and its guides; history may keep them
  const names = new RegExp(`(?<![A-Za-z0-9])(?:${GAME_NAMES.join("|")})`, "i");
  const hits = [];
  const exempt = (path) => NAMES_EXEMPT.some((at) => path === at || path.startsWith(`${at}/`));
  const atRoot = readdirSync(root).filter((name) => name.endsWith(".md") && statSync(join(root, name)).isFile());
  const texts = [...new Set([...atRoot, ...mjsFiles(root, [...folders, ...NAMES_IN], [".mjs", ".md", ".html"])])];
  for (const path of texts.filter((path) => !exempt(path)).sort()) {
    readFileSync(join(root, path), "utf8").split("\n").forEach((line, at) => {
      const found = names.exec(line);
      if (found) hits.push({ path, line: at + 1, name: found[0], text: line.trim().slice(0, 100) });
    });
  }
  if (armed.names) for (const hit of hits) fails.push(`${hit.path}:${hit.line} names a game (${hit.name}): ${hit.text}`);
  return { fails, notes, counts, kitLines, ratchet, orphans, hits, files, layers, allowedCount: allowed.length };
}
