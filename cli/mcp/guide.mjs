// The kit's own writing, handed out a section at a time. An agent with a shell reads AGENTS.md, an index, and
// the one guide its task needs; a client of this server asks for the list of the guide's sections first and
// then for the two or three its task needs. Nothing of the guide is copied here: the files are read when
// they are asked for and cut at their headings, so that what the guide says tomorrow is what this hands out
// tomorrow.
//
//   the documents   "guide": AGENTS.md and the guides its briefing was moved to (the command line, models,
//                   re-skins, shapes, what is wrong), read as one; docs/API.md ("api"),
//                   docs/ENGINES.md ("engines"), docs/MAPS.md ("maps"), docs/MAPS-MAKING.md ("maps-making"),
//                   every other guide of docs/ by its name in small letters ("play", "sounds"), and every
//                   example and kit by its path ("examples/01-new-model.mjs", "kits/swordkit.mjs")
//   a section       a heading of a document and what is under it, up to the next heading of any depth
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The kit's folder: this file is in its `cli/mcp`. */
export const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The guide: AGENTS.md, then the guides that hold what it held before it was made an index (0.27). */
const GUIDE = ["AGENTS.md", ...["COMMANDS", "MODELS", "RESKIN", "SHAPES", "TROUBLE"].map((name) => `docs/${name}.md`)];
/** The written documents, by the short name a client asks for them with: a file, or files read as one. */
const DOCUMENTS = {
  guide: GUIDE,
  api: "docs/API.md",
  engines: "docs/ENGINES.md",
  maps: "docs/MAPS.md",
  "maps-making": "docs/MAPS-MAKING.md",
  // and the rest of docs/, each by its name: "play" for docs/PLAY.md
  ...Object.fromEntries(
    readdirSync(join(KIT, "docs"))
      .filter((name) => /\.md$/.test(name) && !["API", "ENGINES", "MAPS", "MAPS-MAKING"].includes(name.slice(0, -3)))
      .sort()
      .map((name) => [name.slice(0, -3).toLowerCase(), `docs/${name}`]),
  ),
};
/** The folders whose modules are documents too, each by its path. */
const CODE_FOLDERS = ["examples", "kits"];
/** The section of the guide whose table goes with the list of sections: what the kit can and cannot do. */
const CAN_AND_CANNOT = /can and cannot/i;
/** The topic that asks for the whole of a module, where its opening comment is not enough. */
const WHOLE_MODULE = "code";
/** A section's line in the list is cut to this many characters, and a line found by `find` to this many. */
const SUMMARY_MOST = 120;
const FOUND_LINE_MOST = 200;
/** `find` gives no more lines than this. */
const FOUND_MOST = 40;

const isCode = (file) => /\.mjs$/.test(file);
/** A count of characters as the lists print it: "9.1k". */
const sizeText = (characters) => (characters < 1000 ? `${characters}` : `${(characters / 1000).toFixed(1)}k`);

/** The modules that can be asked for by their path: ["examples/01-new-model.mjs", ...]. */
const codeDocuments = () =>
  CODE_FOLDERS.flatMap((folder) =>
    readdirSync(join(KIT, folder))
      .filter(isCode)
      .sort()
      .map((name) => `${folder}/${name}`),
  );

/** The files a document's name stands for (paths under the kit's folder); it throws for a name it has not. */
function filesOf(name = "guide") {
  if (Object.hasOwn(DOCUMENTS, name)) return [DOCUMENTS[name]].flat();
  if (codeDocuments().includes(name)) return [name];
  throw new Error(
    `no document ${name}: there are ${[...Object.keys(DOCUMENTS), ...codeDocuments()].join(", ")}`,
  );
}
/** A document's text: its files one after another. */
const writtenOf = (files) => files.map((file) => readFileSync(join(KIT, file), "utf8").trim()).join("\n\n");

/** What opens an item of a list: "- " or "1. ". */
const LIST_MARK = /^(- |\d+\. )/;

/**
 * What a section's line in the list says of it: the first sentence of its prose (or of its first list item),
 * cut short. Code, tables and the lines an item goes on over are passed by.
 */
function summaryOf(body) {
  let fenced = false;
  for (const [at, line] of body.entries()) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !/^[A-Za-z*`]/.test(line.replace(LIST_MARK, ""))) continue;
    // the paragraph the line opens, up to the end of its first sentence
    const paragraph = body.slice(at).join(" ").replace(LIST_MARK, "");
    const sentence = /^(.*?[.:])(\s|$)/.exec(paragraph)?.[1] ?? line;
    return sentence.length > SUMMARY_MOST ? `${sentence.slice(0, SUMMARY_MOST - 1)}…` : sentence;
  }
  return "";
}

/**
 * A Markdown text cut at its headings: [{ number (from 1), level (1 for #, 2 for ##...), title, text (the
 * heading and all under it, up to the next heading), summary }]. A line that begins with # inside a fenced
 * block of code is not a heading.
 */
export function sectionsOf(markdown) {
  const sections = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) sections.push({ level: heading[1].length, title: heading[2].trim(), lines: [line] });
    else if (sections.length) sections.at(-1).lines.push(line);
  }
  return sections.map(({ level, title, lines }, i) => ({
    number: i + 1,
    level,
    title,
    text: lines.join("\n").trim(),
    summary: summaryOf(lines.slice(1)),
  }));
}

/** The comment a module opens with, without its slashes. */
const openingComment = (code) => {
  const lines = code.split(/\r?\n/);
  const first = lines.findIndex((line) => line.startsWith("//"));
  const after = lines.findIndex((line, i) => i > first && !line.startsWith("//"));
  return lines
    .slice(first, after)
    .map((line) => line.replace(/^\/\/ ?/, ""))
    .join("\n");
};

/** The list of a document's sections: a line each, with its number, its size and what it opens with. */
function listOf(name, sections) {
  const lines = sections.map(
    (section) =>
      `${"  ".repeat(Math.max(0, section.level - 2))}${section.number} ${section.title} (${sizeText(section.text.length)})${section.summary ? `: ${section.summary}` : ""}`,
  );
  const head = `${filesOf(name).join(" + ")}: ${sections.length} sections. Ask for one or more by number (topic: "12" or "12,17") or by words of its title.`;
  if (name !== "guide") return [head, ...lines].join("\n");
  // with the guide's own list: what the kit can and cannot do, and what else can be asked for
  const table = sections.find((section) => CAN_AND_CANNOT.test(section.title));
  const others = [
    ...Object.keys(DOCUMENTS).filter((other) => other !== "guide"),
    ...codeDocuments().map((path) => `${path} (${sizeText(readFileSync(join(KIT, path)).length)})`),
  ];
  return [
    head,
    ...lines,
    "",
    `Other documents (doc: "api" lists every function by area): ${others.join(", ")}. A module gives its opening comment; topic: "${WHOLE_MODULE}" gives all of it.`,
    ...(table ? ["", table.text] : []),
  ].join("\n");
}

/** The sections a topic asks for: numbers ("12", "12,17"), or the words of one title. */
function chosen(sections, topic) {
  const asked = String(topic).trim();
  if (/^\d+(\s*,\s*\d+)*$/.test(asked))
    return asked.split(",").map((number) => {
      const section = sections[Number(number) - 1];
      if (!section) throw new Error(`no section ${number.trim()}: there are 1 to ${sections.length}`);
      return section;
    });
  const wanted = asked.toLowerCase();
  const exact = sections.filter((section) => section.title.toLowerCase() === wanted);
  const holding = exact.length ? exact : sections.filter((s) => s.title.toLowerCase().includes(wanted));
  if (holding.length === 1) return holding;
  const which = holding.length ? holding : sections;
  throw new Error(
    `${holding.length ? "several sections" : "no section"} with "${asked}" in the title. ${holding.length ? "They are" : "There are"}: ${which.map((s) => `${s.number} ${s.title}`).join("; ")}`,
  );
}

/** The lines of a document that hold `words`, each with the number and title of its section. */
function found(sections, words) {
  const wanted = String(words).toLowerCase();
  const lines = sections.flatMap((section) =>
    section.text
      .split("\n")
      .filter((line) => line.toLowerCase().includes(wanted))
      .map((line) => `${section.number} ${section.title}: ${line.trim().slice(0, FOUND_LINE_MOST)}`),
  );
  if (!lines.length) return `"${words}" is nowhere in it`;
  const more = lines.length > FOUND_MOST ? [`and ${lines.length - FOUND_MOST} more lines`] : [];
  return [...lines.slice(0, FOUND_MOST), ...more].join("\n");
}

/**
 * What the tool `guide` answers with, as text.
 *   doc    which document: "guide" (AGENTS.md and the guides it sends to, unless told), "api", "engines",
 *          "maps", "maps-making", another guide of docs/ by its name ("play"), or a module's path
 *   topic  the sections wanted, by number or by title; without it, the list of the document's sections
 *          (for a module: its opening comment; with "code", all of it)
 *   find   instead of a topic: the lines that hold these words, each with its section
 */
export function guide({ doc, topic, find } = {}) {
  const name = doc ?? "guide";
  const files = filesOf(name);
  const written = writtenOf(files);
  const [file] = files;
  if (isCode(file)) {
    const sections = [{ number: 1, title: file, text: written }];
    if (find) return found(sections, find);
    return topic === WHOLE_MODULE ? written : openingComment(written);
  }
  const sections = sectionsOf(written);
  if (find) return found(sections, find);
  if (topic === undefined || topic === "") return listOf(name, sections);
  return chosen(sections, topic)
    .map((section) => section.text)
    .join("\n\n");
}
