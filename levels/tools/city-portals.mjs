#!/usr/bin/env node
// city-portals: regenerates the seam portals of a city description (levels/specs/*.json, smak-city-description/1)
// from its streets and its tile grid: every seam a segment crosses, at the crossing; every connector, secret passage
// and building passage whose ends stand in two tiles (`cityPortals` in levels/lib/city-checks.mjs). By default it
// prints what would change against the description's own `tiles.portals`; --write puts the new list in the file,
// touching nothing else in it (the rest of the file stays byte for byte). The same description gives the same
// portals, in the same order. `check-city` fails a missing or stale portal; this tool is how they are kept in step.
//
//   node levels/tools/city-portals.mjs <city.json> [--write] [--list]
//
//   --write  writes the regenerated portals into the file's `tiles.portals`
//   --list   prints every portal, not only the changes
//
// Exit code 0 when the portals are in step (or were written), 1 when they differ and were not written, 2 on wrong
// arguments or a description that is not valid.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cityPortals, diffPortals } from "../lib/city-checks.mjs";
import { validateCity } from "../lib/city-description.mjs";

/**
 * The text of a JSON document with `tiles.portals` replaced by `portals`, one portal a line, in the file's own
 * indentation and line ends; everything else as it was. Adds the key at the end of `tiles` when it is missing.
 */
export function splicePortals(text, portals) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // a small scanner: the [start, end) span of the value of `key` inside the object spanning [from, to)
  const valueSpan = (from, to, key) => {
    let depth = 0;
    for (let i = from; i < to; i++) {
      const ch = text[i];
      if (ch === '"') {
        let j = i + 1;
        while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
        const name = text.slice(i, j + 1);
        if (depth === 1 && name === JSON.stringify(key) && /^\s*:/.test(text.slice(j + 1, j + 40))) {
          let k = text.indexOf(":", j + 1) + 1;
          while (/\s/.test(text[k])) k++;
          return [i, k, endOf(k)];
        }
        i = j;
      } else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") depth--;
    }
    return null;
  };
  const endOf = (start) => {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        let j = i + 1;
        while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
        i = j;
        if (depth === 0) return i + 1;
      } else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return i + 1;
      } else if (depth === 0 && /[,}\]\s]/.test(text[i + 1] ?? ",")) return i + 1;
    }
    return text.length;
  };
  const indentAt = (i) => text.slice(text.lastIndexOf("\n", i) + 1, i).match(/^[ \t]*/)[0];
  const tiles = valueSpan(text.indexOf("{"), text.length, "tiles");
  if (!tiles) throw new Error("the description has no `tiles` object");
  const [, tStart, tEnd] = tiles;
  const found = valueSpan(tStart, tEnd, "portals");
  const block = (indent) => {
    if (!portals.length) return "[]";
    const inner = indent + (indent.includes("\t") ? "\t" : " ");
    return `[${eol}${portals.map((p) => inner + JSON.stringify(p)).join(`,${eol}`)}${eol}${indent}]`;
  };
  if (found) {
    const [keyAt, vStart, vEnd] = found;
    return text.slice(0, vStart) + block(indentAt(keyAt)) + text.slice(vEnd);
  }
  // no portals yet: a new last key of `tiles`, indented as its other keys
  const close = tEnd - 1;
  let last = close - 1;
  while (/\s/.test(text[last])) last--;
  const keyIndent = indentAt(text.indexOf('"', tStart));
  return `${text.slice(0, last + 1)},${eol}${keyIndent}"portals": ${block(keyIndent)}${text.slice(last + 1)}`;
}

/** The changes in a few lines: counts, then each portal added, removed or moved. */
export function describePortals(name, before, after, { list = false } = {}) {
  const d = diffPortals(before, after);
  const kinds = { segment: 0, connector: 0, secret: 0, passage: 0 };
  for (const p of after) for (const k of Object.keys(kinds)) if (p[k] !== undefined) kinds[k]++;
  const lines = [];
  const stale = d.added.length + d.removed.length + d.changed.length;
  // the same set in another order is a change too: the file is rewritten in the description's order
  const reordered = !stale && before.map((p) => p.id).join() !== after.map((p) => p.id).join();
  lines.push(`${stale || reordered ? "STALE" : "IN STEP"}  ${name}: ${after.length} portals (${kinds.segment} street crossings, ${kinds.connector} connectors, ${kinds.secret} secret passages, ${kinds.passage} building passages); the file has ${before.length}`); // prettier-ignore
  const show = (p) => `${p.id} ${p.segment ?? p.connector ?? p.secret ?? p.passage}${p.at ? ` at [${p.at}]` : ""} ${p.seam ?? ""}`.trim(); // prettier-ignore
  for (const p of d.added) lines.push(`  + ${show(p)}`);
  for (const p of d.removed) lines.push(`  - ${show(p)}`);
  for (const c of d.changed) lines.push(`  ~ ${show(c.from)}  ->  ${show(c.to)}`);
  if (reordered) lines.push("  (the same portals in another order)");
  if (list) for (const p of after) lines.push(`    ${show(p)}`);
  return { text: lines.join("\n"), stale: stale > 0 || reordered, diff: d };
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = { _: [] };
  for (const a of process.argv.slice(2)) {
    if (a === "--write") args.write = true;
    else if (a === "--list") args.list = true;
    else if (a.startsWith("--")) args.bad = a;
    else args._.push(a);
  }
  const file = args._[0];
  if (!file || args.bad || args._.length > 1) {
    console.error("usage: city-portals <city.json> [--write] [--list]");
    process.exit(2);
  }
  let text;
  let desc;
  try {
    text = fs.readFileSync(file, "utf8");
    desc = JSON.parse(text);
  } catch (e) {
    console.error(`city-portals: cannot read ${file} as JSON (${e.message})`);
    process.exit(2);
  }
  const { errors } = validateCity(desc);
  if (errors.length) {
    console.error(`city-portals: ${file} is not a valid city description: ${errors[0]}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`); // prettier-ignore
    process.exit(2);
  }
  const after = cityPortals(desc);
  const before = desc.tiles.portals ?? [];
  const said = describePortals(desc.name ?? file, before, after, { list: args.list });
  console.log(said.text);
  if (args.write && said.stale) {
    const out = splicePortals(text, after);
    const back = JSON.parse(out);
    if (JSON.stringify(back.tiles.portals) !== JSON.stringify(after)) throw new Error("the portals written do not read back");
    fs.writeFileSync(file, out);
    console.log(`  wrote ${after.length} portals to ${file}`);
  }
  process.exit(said.stale && !args.write ? 1 : 0);
}
