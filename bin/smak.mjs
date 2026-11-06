#!/usr/bin/env node
// SMAK from the command line: look at a model, check it, draw it, and take its textures out and put them
// back; and the same for a map: what is in it, its plan and views, its entities changed, its textures, a
// compile. Anything finer (a new mesh, a new animation, a map's brushes) is a short script over
// src/index.mjs: see AGENTS.md and examples/.
//
// How this file is laid out: the arguments are read in one place (parseArgs), each command is a function that
// is handed { command, file, rest, flags, src }, and COMMANDS, after them, maps a command's name to its
// function and to its lines of the help.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import * as smak from "../src/index.mjs";
import { heightPlanOf } from "../src/maps/heightplan.mjs";

// the ports the two pages listen on unless told with --port
const VIEWER_PORT = 8098;
const EDITOR_PORT = 8097;
// a studio model's header: its length in bytes, and where in it the number of textures is written. A model
// with none there keeps them in <name>t.mdl beside it
const HEADER_BYTES = 184;
const TEXTURE_COUNT_AT = 180;
// the name the model gives itself: 64 bytes of the header, from byte 8
const NAME_AT = 8;
const NAME_END = 72;
// where the model sees from (eyeposition), three floats; its four boxes follow
const HDR_EYES_AT = 76;
// pieces, islands and regions smaller than this are counted and not listed, unless told with --min
const PIECES_MIN_TRIANGLES = 6;
const ISLANDS_MIN_TRIANGLES = 1;
const LAYERS_MIN_PIXELS = 30;
// how many bodies and bones a line of `islands` names before "and n more"
const BODIES_LISTED = 6;
const BONES_LISTED = 4;
// the flags that are followed by a value: one given with nothing after it is said, not guessed at
const VALUE_FLAGS = [
  "password",
  "allow",
  "seed",
  "show",
  "map",
  "gamemode",
  "players",
  "host",
  "wait",
  "reference",
  "against",
  "landmark",
  "plan",
  "views",
  "wall",
  "seq",
  "frame",
  "body",
  "skin",
  "view",
  "yaw",
  "pitch",
  "zoom",
  "fov",
  "width",
  "height",
  "size",
  "count",
  "cols",
  "from",
  "to",
  "texture",
  "min",
  "engine",
  "flags",
  "scale",
  "up",
  "turn",
  "name",
  "max-texture",
  "port",
  "work",
  "class",
  "game",
  "wad",
  "z",
  "area",
  "at",
  "brightness",
  "entity",
  "add",
  "remove",
  "move",
  "unset",
  "vhlt",
  "body",
  "model",
  "start",
  "goal",
  "open",
  "shut",
  "doors",
  "cell",
  "near",
  "mod",
  "fgd",
  "learned",
  "cache",
  "scripts",
  "exit",
  "speed",
  "gravity",
  "sky",
  "map",
  "steps",
  "playwright",
  "loads",
  "expect",
  "expect-not",
  "put",
  "over",
  "family",
  "base",
  "shipped",
  "timeout",
  "dark",
  "rooms",
  "grid",
  "bands",
  "sight",
  "eye",
  "precision",
  "names",
  "fit",
  "origin",
  "axis",
  "grip",
  "as",
  "only",
  "save-pictures",
  "fps",
  "frames",
  "source",
  "stride",
  "library",
  "kind",
  "judges",
  "judge",
  "box",
  "reference-box",
  "reference-scale",
  "reference-picture",
  "mask",
  "pose",
  "sheet",
  "weights",
  "cfg",
  "report",
  "folder",
  "collision",
  "studiomdl",
  "gmod",
  "addon",
  "surfaceprop",
  "mass",
];
// the flags of the map commands that may be given more than once: each time adds to a list
const LISTED_FLAGS = [
  "game",
  "ours",
  "focus",
  "dll",
  "wad",
  "body",
  "model",
  "start",
  "goal",
  "open",
  "shut",
  "fgd",
  "learned",
  "scripts",
  "exit",
  "map",
  "steps",
  "expect",
  "expect-not",
  "put",
  "over",
  "reference",
  "reference-picture",
];
// `map-entities` and `map-plan` print no more lines than this of one list unless told all of it is wanted
const MARKS_PRINTED = 40;
// a play run that stopped prints this many of the last steps it did (all of them are in its told.txt)
const STOPPED_STEPS = 4;
// how many times smaller (each way) `play` writes the pictures it takes, unless --full-pictures
const PLAY_SHRINK = 3;
const LIGHTS = ["start", "off", "steady", "all"];
const MARKED = ["all", "models", "game", "none"];
const DOORS = ["open", "closed"];
const VIEWS = ["orbit", "first", ...Object.keys(smak.NAMED_VIEWS)];
// the engines --engine names: check holds a model to goldsrc, xash or source; a model spec is built for goldsrc or source
const ENGINES = ["goldsrc", "xash", "source"];
// the engines a GoldSrc file is held to wherever it may be played: an item is checked for both
const GAME_ENGINES = ["goldsrc", "xash"];

// ── the arguments ──────────────────────────────────────────────────────────
/**
 * The command line read: { flags, args }. `-o x` is flags.o; `--name value` is flags.name; `--name` with
 * nothing after it (or with another flag after it) is true; `--no-name` is flags.name = false; the rest are
 * `args`, in order. A flag of LISTED_FLAGS given several times keeps every value, in `listed`.
 */
function parseArgs(argv) {
  const flags = {};
  const listed = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    const next = argv[i + 1];
    if (word === "-o") flags.o = argv[++i];
    else if (word.startsWith("--no-")) flags[word.slice(5)] = false;
    else if (word.startsWith("--")) {
      const bare = next === undefined || next.startsWith("--") || next === "-o";
      flags[word.slice(2)] = bare ? true : argv[++i];
      if (!bare && LISTED_FLAGS.includes(word.slice(2))) (listed[word.slice(2)] ??= []).push(argv[i]);
    } else args.push(word);
  }
  return { flags, args, listed };
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
/**
 * The flags looked over before anything is done: one that needs a value and has none, and a view or an
 * engine that is not one, are said and the command stopped.
 */
function checkFlags(flags) {
  if ("o" in flags && (flags.o === undefined || flags.o.startsWith("--")))
    fail("-o needs a file or a folder after it");
  for (const name of VALUE_FLAGS) if (flags[name] === true) fail(`--${name} needs a value after it`);
  if (flags.view !== undefined && !VIEWS.includes(flags.view))
    fail(`--view: ${VIEWS.join(" or ")}, not ${flags.view}`);
  if (flags.engine !== undefined && !ENGINES.includes(flags.engine))
    fail(`--engine: ${ENGINES.join(" or ")}, not ${flags.engine}`);
}
/** A flag's value as a number; undefined for a flag not given. One that is no number stops the command. */
function numberOf(flags, name) {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (value === "" || Number.isNaN(Number(value))) fail(`--${name}: a number, not ${value}`);
  return Number(value);
}
/** A texture or an animation named on the command line: its number when it is all digits, else its name. */
const nameOrNumber = (value) => (/^\d+$/.test(String(value)) ? Number(value) : value);
/** An object without the entries that are undefined. */
const defined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
/** A texture's name as a file's: no extension, nothing a file system minds. */
const fileNameOf = (name) => name.replace(/\.(bmp|png|tga)$/i, "").replace(/[^A-Za-z0-9_.-]/g, "_");
function save(to, data) {
  mkdirSync(dirname(to) || ".", { recursive: true });
  writeFileSync(to, data);
}
/** `value`, or the command stopped with what it lacks. */
const need = (command, value, what) => value ?? fail(`${command}: ${what}`);
/** A file a command reads, or the command stopped: one that is not there, or that is a folder. */
function existing(file) {
  if (!existsSync(file)) fail(`no such file: ${file}`);
  if (statSync(file).isDirectory()) fail(`${file} is a folder, not a file`);
  return file;
}
/** What went wrong, as a sentence: a file that could not be read or written, or a port that is taken, named. */
function sayOf(error) {
  if (error.code === "ENOENT") return `no such file: ${error.path}`;
  if (error.code === "EEXIST" || error.code === "ENOTDIR")
    return `${error.path} cannot be made: a file of that name is in the way`;
  if (error.code === "EISDIR") return `${error.path ?? "that"} is a folder, where a file is wanted`;
  if (error.code === "EADDRINUSE")
    return `port ${error.port} is taken (a page left running?): stop that, or give another with --port`;
  return error.message;
}
/** The animation a model is posed in when none is asked for: its first, or its rest pose when it has none. */
const firstSeq = (src) => (smak.sequences(src).length ? 0 : null);
/**
 * The animation --seq asks for, the same for every command that takes it: a name, a number, or `rest` for
 * the rest pose (null); undefined when the flag is not given.
 */
function seqAsked(flags) {
  if (flags.seq === undefined) return undefined;
  return flags.seq === "rest" ? null : nameOrNumber(flags.seq);
}
/** The same, with the model's first animation when the flag is not given. */
const seqOf = (src, flags) => (flags.seq === undefined ? firstSeq(src) : seqAsked(flags));
/** The file that holds a model's textures when they are not inside it. */
const textureFileOf = (file) => file.replace(/\.mdl$/i, "t.mdl");
/** A box in pixels as the lists print it. */
const boxText = (box) => `${box[0]},${box[1]} to ${box[2]},${box[3]}`;

/**
 * The model read; one whose textures are in the file beside it is read with them (but for `inline`, which
 * does that).
 */
function readModel(file, command) {
  let src = readFileSync(file);
  const textureFile = textureFileOf(file);
  const hasNone = src.length > HEADER_BYTES && !src.readInt32LE(TEXTURE_COUNT_AT);
  if (command !== "inline" && hasNone && existsSync(textureFile)) {
    src = smak.withTextures(src, readFileSync(textureFile));
    console.error(`(textures read from ${basename(textureFile)})`);
  }
  return src;
}
/** The files of animations kept beside a model (<name>01.mdl ...), when it has any: undefined when it has none. */
const groupsOf = (file, src) => (file && smak.sequenceGroups(src).length > 1 ? smak.sequenceFilesOf(file, src) : undefined);
/** What render, sheet and strip are asked for, from the flags. */
function viewOptions(src, flags) {
  return {
    view: flags.view,
    seq: seqOf(src, flags),
    frame: numberOf(flags, "frame") ?? 0,
    body: numberOf(flags, "body") ?? 0,
    skin: numberOf(flags, "skin") ?? 0,
    yaw: numberOf(flags, "yaw"),
    pitch: numberOf(flags, "pitch"),
    zoom: numberOf(flags, "zoom"),
    fov: numberOf(flags, "fov"),
    width: numberOf(flags, "width"),
    height: numberOf(flags, "height"),
    size: numberOf(flags, "size"),
    count: numberOf(flags, "count"),
    cols: numberOf(flags, "cols"),
    from: numberOf(flags, "from"),
    to: numberOf(flags, "to"),
    light: flags.light !== false,
    cull: flags.cull !== false,
    ground: flags.ground ? true : undefined,
  };
}

// ── info ───────────────────────────────────────────────────────────────────
/** Everything `info` tells of a model, as `--json` prints it. */
function describe(src, file) {
  const mdl = smak.readMdl(src);
  const bones = smak.bones(src);
  const boneName = (number) => bones[number]?.name ?? number;
  const boxes = smak.hitboxes(src);
  // studiohdr_t's eyeposition and its four boxes (min and max: the box it moves with; bbmin and bbmax: the
  // box it is clipped by), which follow its name and length: floats from byte 76 (studio.h)
  const floats = (at) => [0, 1, 2].map((axis) => round2(src.readFloatLE(at + axis * 4)));
  const header = {
    eyes: floats(HDR_EYES_AT),
    box: {
      min: floats(HDR_EYES_AT + 12),
      max: floats(HDR_EYES_AT + 24),
      bbmin: floats(HDR_EYES_AT + 36),
      bbmax: floats(HDR_EYES_AT + 48),
    },
  };
  return {
    file,
    bytes: src.length,
    name: src.toString("latin1", NAME_AT, NAME_END).replace(/\0.*$/s, ""),
    bones: bones.map((bone, i) => ({
      i,
      name: bone.name,
      parent: bone.parent,
      pos: bone.pos.map((v) => +v.toFixed(3)),
      rot: bone.rot.map((v) => +v.toFixed(4)),
    })),
    bodyparts: mdl.bodyparts.map((bodypart) => ({
      name: bodypart.name,
      base: bodypart.base,
      models: bodypart.models.map((model, k) => ({
        body: k * bodypart.base,
        name: model.name,
        verts: model.numverts,
        meshes: model.meshes.map((mesh) => ({ tris: mesh.numtris, texture: mesh.texture?.name ?? null })),
      })),
    })),
    textures: mdl.textures.map((texture, i) => ({
      i,
      name: texture.name,
      width: texture.width,
      height: texture.height,
      flags: texture.flags,
    })),
    skinFamilies: smak.skinFamilies(src).length,
    eyes: header.eyes,
    box: header.box,
    sequences: smak.sequences(src).map((seq, i) => ({
      i,
      name: seq.name,
      frames: seq.frames,
      fps: seq.fps,
      loops: seq.loops,
      blends: seq.blends,
      external: Boolean(seq.group),
      activity: seq.activity,
      activityName: smak.ACTIVITY[seq.activity] ?? null,
      actweight: seq.actweight,
      movement: seq.movement.map(round2),
      speed: round2(seq.speed),
      motiontype: seq.motiontype,
      bbmin: seq.bbmin.map(round2),
      bbmax: seq.bbmax.map(round2),
      events: smak.events(src, i),
    })),
    attachments: smak.attachments(src).map((a) => ({ ...a, bone: boneName(a.bone) })),
    hitboxes: boxes.length,
    hitboxList: boxes.map((box, i) => ({
      i,
      bone: boneName(box.bone),
      group: box.group,
      groupName: HITGROUP_NAMES[box.group] ?? null,
      min: box.min.map(round2),
      max: box.max.map(round2),
      size: box.max.map((v, axis) => round2(v - box.min[axis])),
    })),
    boneControllers: smak.boneControllers(src).map((c) => ({ ...c, bone: boneName(c.bone) })),
  };
}
/** A length as `info` prints it: to a hundredth of a unit. */
const round2 = (v) => +v.toFixed(2);
/** The names of the hit groups, by their numbers. */
const HITGROUP_NAMES = Object.fromEntries(
  Object.entries(smak.HITGROUP).map(([name, group]) => [group, name]),
);
/** The names of the bits of a motion type, joined with +. */
const motionNames = (motiontype) =>
  Object.entries(smak.MOTION)
    .filter(([, bit]) => motiontype & bit)
    .map(([name]) => name)
    .join("+");
/** The names of a texture's flags, joined with +. */
const flagNames = (flags) =>
  Object.entries(smak.TEXTURE)
    .filter(([, bit]) => flags & bit)
    .map(([name]) => name)
    .join("+");
function info({ file, src, flags }) {
  const data = describe(src, file);
  if (flags.json) {
    console.log(JSON.stringify(data, null, 1));
    return;
  }
  const pad = (value, width) => String(value).padStart(width);
  console.log(`${file}: "${data.name}", ${src.length} bytes`);

  console.log(`\nBONES (${data.bones.length})`);
  // the places as the file has them, not as --json rounds them
  smak
    .bones(src)
    .forEach((bone, i) =>
      console.log(
        `  ${pad(i, 3)} ${bone.name.padEnd(28)} parent ${pad(bone.parent, 3)}  at ${bone.pos.map((v) => v.toFixed(2)).join(" ")}`,
      ),
    );

  console.log(
    `\nBODYPARTS (${data.bodyparts.length})   a body number is the sum of one "body" from each part`,
  );
  for (const bodypart of data.bodyparts) {
    console.log(`  ${bodypart.name}`);
    for (const model of bodypart.models) {
      const meshes = model.meshes.map((mesh) => `${mesh.tris} on ${mesh.texture}`).join(", ") || "(empty)";
      console.log(
        `    body ${pad(model.body, 4)}  ${model.name.padEnd(28)} ${pad(model.verts, 5)} points  ${meshes}`,
      );
    }
  }

  const families = data.skinFamilies > 1 ? `, ${data.skinFamilies} skin families` : "";
  console.log(`\nTEXTURES (${data.textures.length}${families})`);
  for (const texture of data.textures) {
    const flagText = texture.flags ? `  ${flagNames(texture.flags) || ""} (flags ${texture.flags})` : "";
    console.log(
      `  ${pad(texture.i, 3)} ${texture.name.padEnd(32)} ${texture.width}x${texture.height}${flagText}`,
    );
  }

  console.log(`\nANIMATIONS (${data.sequences.length})   the game asks for them by number: keep their order`);
  for (const seq of data.sequences) {
    const activity = seq.activity
      ? `, activity ${seq.activity}${seq.activityName ? ` ${seq.activityName}` : ""}${seq.actweight !== 1 ? ` (weight ${seq.actweight})` : ""}`
      : "";
    const travel = seq.movement.some((v) => v)
      ? `, moves ${seq.movement.join(" ")} (${motionNames(seq.motiontype) || "no motion type"}): ${seq.speed} units a second`
      : "";
    const notes = `${seq.loops ? ", loops" : ""}${seq.blends > 1 ? `, ${seq.blends} blends` : ""}${activity}${travel}${seq.external ? ", KEPT IN ANOTHER FILE" : ""}`;
    console.log(
      `  ${pad(seq.i, 3)} ${seq.name.padEnd(28)} ${pad(seq.frames, 4)} frames at ${seq.fps} fps${notes}`,
    );
    if (flags.boxes) console.log(`        box ${seq.bbmin.join(" ")} to ${seq.bbmax.join(" ")}`);
    for (const event of seq.events)
      console.log(
        `        frame ${event.frame}: event ${event.event}${event.options ? ` "${event.options}"` : ""}`,
      );
  }

  if (data.attachments.length) {
    console.log(`\nATTACHMENTS (${data.attachments.length})`);
    data.attachments.forEach((a, i) =>
      console.log(
        `  ${i}${a.name ? ` "${a.name}"` : ""} on ${a.bone} at ${a.pos.map((v) => v.toFixed(2)).join(" ")}`,
      ),
    );
  }
  if (data.boneControllers.length) {
    console.log(`\nBONE CONTROLLERS (${data.boneControllers.length})`);
    data.boneControllers.forEach((c, i) =>
      console.log(
        `  ${i} turns ${c.bone} on ${motionNames(c.type) || c.type} from ${c.start} to ${c.end}, the entity's controller ${c.index}`,
      ),
    );
  }
  if (data.eyes.some((v) => v)) console.log(`\nEYES at ${data.eyes.join(" ")}`);

  // the hit boxes: how many, on how many bones and in which groups; each one with --hitboxes
  const groups = [...new Set(data.hitboxList.map((box) => box.group))].sort((a, b) => a - b);
  const inGroups = groups
    .map((group) => `${group}${HITGROUP_NAMES[group] ? ` ${HITGROUP_NAMES[group]}` : ""}`)
    .join(", ");
  const summary = data.hitboxes
    ? ` on ${new Set(data.hitboxList.map((box) => box.bone)).size} bones, in the groups ${inGroups}${flags.hitboxes ? "" : "   (--hitboxes lists them)"}`
    : "";
  console.log(`\n${data.hitboxes} hit boxes${summary}`);
  if (flags.hitboxes)
    for (const box of data.hitboxList)
      console.log(
        `  ${pad(box.i, 3)} ${String(box.bone).padEnd(28)} group ${box.group}${box.groupName ? ` ${box.groupName}` : ""}  ${box.size.join(" x ")}  from ${box.min.join(" ")} to ${box.max.join(" ")}`,
      );
}

// ── a check's answer, text first ───────────────────────────────────────────
// how many lines of what a check found a pass prints before the rest are left to its file
const SHOWN_ON_PASS = 2;
/**
 * Where a checking command writes its detail: --report <file>, or a file named after the command and what it
 * read, in smak/ under the system's temp folder (nothing is written beside a game's files).
 */
function reportFile(command, file, flags) {
  if (typeof flags.report === "string") return flags.report;
  return join(tmpdir(), "smak", `${command}-${basename(String(file)).replace(/[^A-Za-z0-9_.-]/g, "_")}.txt`);
}
/**
 * A checking command's answer. The detail (every line it printed before 0.27) goes to its report file; the
 * terminal gets what decides: on a pass the first SHOWN_ON_PASS of `shown`, the file and the PASS line (five
 * lines at most); on a fail all of `shown` (the errors and warnings, or the findings), the file and the FAIL
 * line. `look` says which picture to look at, or that none is needed. --verbose prints the detail as before.
 * The last line is always `PASS: <said>` or `FAIL: <said>`.
 */
function answered(command, file, flags, { detail, passed, said, shown = [], look }) {
  const to = reportFile(command, file, flags);
  const last = `${passed ? "PASS" : "FAIL"}: ${said}`;
  save(to, `${[...detail, ...(look ? [look] : []), last].join("\n")}\n`);
  if (flags.verbose) for (const line of detail) console.log(line);
  else {
    const top = passed ? shown.slice(0, SHOWN_ON_PASS) : shown;
    for (const line of top) console.log(line);
    const more = shown.length - top.length;
    console.log(`the detail: ${to}${more ? ` (${more} more lines like these)` : ""}`);
  }
  if (look) console.log(look);
  console.log(last);
}

// ── check ──────────────────────────────────────────────────────────────────
function check({ file, src, flags }) {
  const engine = flags.engine ?? "goldsrc";
  // --source: the file it was made from; what that has too is said as inherited
  const source = flags.source === undefined ? undefined : readModel(existing(flags.source), "check");
  const report = smak.check(src, engine, { source });
  const warnings = report.warnings.map((warning) => `WARN  ${warning}`);
  const errors = report.errors.map((error) => `ERROR ${error}`);
  const inherited = report.inherited ? ` (${report.inherited} inherited from ${flags.source})` : "";
  const warned = report.warnings.length ? `, with ${report.warnings.length} warnings${inherited}` : "";
  answered("check", file, flags, {
    detail: [...report.facts.map((fact) => `      ${fact}`), ...warnings, ...errors],
    passed: !report.errors.length,
    said: report.errors.length ? `${report.errors.length} errors: not fit for ${engine}` : `fit for ${engine}${warned}`,
    shown: [...errors, ...warnings],
  });
  process.exit(report.errors.length ? 1 : 0);
}

/**
 * check --publish: a folder about to be shared, held against the game's files (--game, else the Half-Life
 * folder Steam has) for what is not the person's to share (src/publish.mjs).
 */
function checkPublish({ file, flags, listed }) {
  if (!statSync(file).isDirectory()) fail(`check --publish: ${file} is a file: give the folder that is to be shared`);
  const game = listed.game?.[0] ?? maps.findHalfLife();
  const report = smak.publishCheck(file, { game: game ?? undefined, ours: listed.ours ?? [] });
  const errors = report.errors.map((error) => `ERROR ${error}`);
  const warnings = report.warnings.map((warning) => `WARN  ${warning}`);
  const unheld = game ? "" : " (no game's folder was found: its files and textures were not held against; --game <folder>)";
  answered("check-publish", file, flags, {
    detail: [...report.facts.map((fact) => `      ${fact}`), ...errors, ...warnings],
    passed: !errors.length,
    said: errors.length ? `${errors.length} ${errors.length === 1 ? "thing" : "things"} not to share${unheld}` : `fit to share${warnings.length ? `, with ${warnings.length} warnings` : ""}${unheld}`, // prettier-ignore
    shown: [...errors, ...warnings],
    look: "no picture to look at: the files decided",
  });
  process.exit(errors.length ? 1 : 0);
}

// ── pictures of the model ──────────────────────────────────────────────────
/** render, sheet and strip: one function, the picture drawn by the kit's function of the command's name. */
function draw({ command, src, flags, file }) {
  // the arguments first: a picture is not drawn to find that it has nowhere to go
  const to = need(command, flags.o, "-o out.png");
  const options = defined({ ...viewOptions(src, flags), groups: groupsOf(file, src) });
  // the ground is a line only in a level view: said before anything is drawn
  const level = smak.NAMED_VIEWS[options.view]
    ? smak.NAMED_VIEWS[options.view].pitch + (options.pitch ?? 0) === 0
    : options.view !== "first" && options.pitch === 0;
  if (options.ground && (command === "sheet" || !level))
    fail(
      "--ground draws the line of z = 0 across a level view of render or strip: give --view side or --view front (or --pitch 0)",
    );
  for (const name of ["count", "cols"])
    if (name in options && !(Number.isInteger(options[name]) && options[name] >= 1))
      fail(`--${name}: a whole number from 1, not ${options[name]}`);
  if (!smak.posed(src, options).tris.length) {
    const bodies = smak
      .readMdl(src)
      .bodyparts.map(
        (bodypart) =>
          `  ${bodypart.name}: ${bodypart.models.map((model, k) => `${k * bodypart.base}=${model.name}`).join(" ")}`,
      )
      .join("\n");
    fail(`body ${options.body} shows no triangles. Its body numbers:\n${bodies}`);
  }
  const picture = smak[command](src, options);
  save(to, smak.png(picture.width, picture.height, picture.rgba));
  console.log(`${to}  ${picture.width}x${picture.height}`);
}

// ── an animation as a GIF ──────────────────────────────────────────────────
/** One animation, or every one (--seq all, -o a folder), as looping GIFs, each frame labelled. */
function gifs({ command, src, flags, file }) {
  const to = need(command, flags.o, "-o out.gif (or a folder, with --seq all)");
  const options = defined({ ...viewOptions(src, flags), groups: groupsOf(file, src) });
  const stem = basename(file).replace(/\.mdl$/i, "");
  if (String(flags.seq) === "all") {
    for (const g of smak.animationGifs(src, { ...options, seq: undefined })) {
      const made = join(to, `${stem}-${String(g.number).padStart(2, "0")}-${g.name}.gif`);
      save(made, g.bytes);
      console.log(`${made}  ${g.width}x${g.height}, ${g.frames} frames at ${g.fps.toFixed(1)} a second`);
    }
    return;
  }
  if (!/\.gif$/i.test(to)) fail("-o: a .gif file (or a folder with --seq all)");
  const g = smak.animationGif(src, options);
  save(to, g.bytes);
  console.log(`${to}  ${g.name}, ${g.width}x${g.height}, ${g.frames} frames at ${g.fps.toFixed(1)} a second`);
}

// ── textures ───────────────────────────────────────────────────────────────
function textures({ command, src, flags }) {
  const dir = need(command, flags.o, "-o <folder>");
  smak.readMdl(src).textures.forEach((_, i) => {
    const texture = smak.textureOf(src, i);
    const name = `${String(i).padStart(2, "0")}_${fileNameOf(texture.name)}.${flags.bmp ? "bmp" : "png"}`;
    const to = join(dir, name);
    const holes = Boolean(texture.flags & smak.TEXTURE.masked);
    save(
      to,
      flags.bmp ? smak.bmp(texture) : smak.png(texture.width, texture.height, smak.rgbaOf(texture, holes)),
    );
    console.log(`${to}  ${texture.width}x${texture.height}${texture.flags ? ` flags ${texture.flags}` : ""}`);
  });
}
function uv({ command, src, flags }) {
  const dir = need(command, flags.o, "-o <folder>");
  const all = smak.readMdl(src).textures.map((_, i) => i);
  const wanted = flags.texture === undefined ? all : [nameOrNumber(flags.texture)];
  for (const which of wanted) {
    const map = smak.uvMap(src, which);
    const to = join(dir, `uv_${fileNameOf(map.texture.name)}.png`);
    save(to, smak.png(map.width, map.height, map.rgba));
    console.log(
      `${to}  ${map.texture.width}x${map.texture.height} x${map.scale}, ${map.triangles} triangles of ${map.meshes} meshes`,
    );
  }
}
function retexture({ command, src, rest, flags }) {
  const [which, pictureFile] = rest;
  need(command, pictureFile, "<texture name|n> <picture.png|.bmp>");
  const to = need(command, flags.o, "-o out.mdl");
  const old = smak.textureOf(src, nameOrNumber(which));
  const texture = smak.textureFrom(readFileSync(existing(pictureFile)), old.name, {
    holes: Boolean(flags.holes) || Boolean(old.flags & smak.TEXTURE.masked),
  });
  const out = smak.replaceTexture(src, nameOrNumber(which), {
    ...texture,
    flags: numberOf(flags, "flags") ?? old.flags,
  });
  save(to, out);
  console.log(`${to}: ${old.name} ${old.width}x${old.height} -> ${texture.width}x${texture.height}`);
}
function inline({ command, file, src, flags }) {
  const to = need(command, flags.o, "-o out.mdl");
  const textureFile = textureFileOf(file);
  if (!existsSync(textureFile)) fail(`no ${textureFile} beside it`);
  const out = smak.withTextures(src, readFileSync(textureFile));
  save(to, out);
  console.log(`${to}: ${smak.readMdl(out).textures.length} textures inside`);
}

// ── animations ─────────────────────────────────────────────────────────────
function sequence({ command, src, rest, flags }) {
  const which = nameOrNumber(need(command, rest[0], "<animation name|n>"));
  const to = need(command, flags.o, "-o seq.json");
  const seq = smak.readSequence(src, which);
  save(
    to,
    JSON.stringify({
      name: seq.name,
      index: seq.index,
      fps: seq.fps,
      loops: seq.loops,
      bones: smak.bones(src).map((bone) => bone.name),
      frames: seq.frames.map((frame) => frame.map((values) => values.map((v) => +v.toFixed(5)))),
    }),
  );
  console.log(
    `${to}: ${seq.name}, ${seq.frames.length} frames of ${seq.frames[0]?.length ?? 0} bones at ${seq.fps} fps`,
  );
}
/**
 * The animation a file of numbers holds, as `sequence` writes it; the command stopped when the file is not
 * JSON, has no frames, or (to be added as a new animation) no name.
 */
function animationIn(command, jsonFile, named) {
  const text = readFileSync(existing(jsonFile), "utf8");
  const shape = "it is { name, fps, loops, frames }, as `smak sequence` writes it";
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    fail(`${command}: ${jsonFile} is not JSON (${error.message}): ${shape}`);
  }
  if (!Array.isArray(json?.frames) || !json.frames.length)
    fail(`${command}: ${jsonFile} has no frames: ${shape}`);
  if (named && typeof json.name !== "string") fail(`${command}: ${jsonFile} has no name: ${shape}`);
  return json;
}
/**
 * sequence-set and sequence-add: an animation from a file of numbers, in the place of one or after the last.
 */
function sequenceFromFile({ command, src, rest, flags }) {
  const adding = command === "sequence-add";
  if (adding && flags.from !== undefined) return sequenceFromFrames({ command, src, flags });
  const jsonFile = need(command, adding ? rest[0] : rest[1], "seq.json");
  const to = need(command, flags.o, "-o out.mdl");
  const json = animationIn(command, jsonFile, adding);
  const out = adding
    ? smak.addSequence(src, json)
    : smak.replaceSequence(src, nameOrNumber(rest[0]), {
        frames: json.frames,
        fps: json.fps,
        loops: json.loops,
      });
  save(to, out);
  const said = adding
    ? `${json.name} added as animation ${smak.sequences(out).length - 1}`
    : `animation ${rest[0]} now ${json.frames.length} frames`;
  console.log(`${to}: ${said}`);
}

/**
 * sequence-add --from: a new animation made of frames of one the model has, in the order --frames gives
 * ("80-57": backwards).
 */
function sequenceFromFrames({ command, src, flags }) {
  const to = need(command, flags.o, "-o out.mdl");
  const name = need(command, flags.name, "--name <the new animation's name>");
  const frames = need(command, flags.frames, '--frames <"80-57", "57,58,57">');
  const from = nameOrNumber(flags.from);
  const out = smak.addSequenceFrom(src, {
    from,
    frames,
    name: String(name),
    fps: numberOf(flags, "fps"),
    loops: Boolean(flags.loop),
    events: Boolean(flags.events),
  });
  save(to, out);
  const made = smak.sequences(out).at(-1);
  console.log(
    `${to}: ${made.name} added as animation ${smak.sequences(out).length - 1}: ${made.frames} frames of ${smak.readSequence(src, from).name} (${frames}) at ${made.fps} fps${made.loops ? ", looping" : ""}`,
  );
}

// ── proportions ────────────────────────────────────────────────────────────
/**
 * reproportion: bones made longer or shorter ("Bip01 L Thigh=1.2", "Bip01 Spine=1,1,1.05"), every animation
 * kept, the feet on the ground and the strides as long as the legs; the files of animations beside the model
 * (<name>01.mdl) are read for their boxes and left as they are.
 */
function reproportioned({ command, file, src, rest, flags }) {
  const to = need(command, flags.o, "-o out.mdl");
  if (!rest.length) fail(`${command}: give at least one bone=factor ("Bip01 L Thigh=1.2", "Bip01 Spine=1,1,1.05")`);
  const factors = {};
  for (const word of rest) {
    const said = /^(.+?)=([-+0-9.eE]+(?:,[-+0-9.eE]+,[-+0-9.eE]+)?)$/.exec(word);
    if (!said) fail(`${command}: bone=factor or bone=x,y,z, not ${word}`);
    const numbers = said[2].split(",").map(Number);
    factors[said[1]] = numbers.length === 1 ? numbers[0] : numbers;
  }
  let ground;
  if (flags.ground === false) ground = false;
  else if (typeof flags.reference === "string") {
    const [seq, frame] = flags.reference.split(":");
    ground = seq === "rest" ? { seq: null } : { seq: nameOrNumber(seq), frame: frame === undefined ? 0 : Number(frame) };
  }
  const groups = smak.sequenceFilesOf(file, src);
  const made = smak.reproportion(src, factors, {
    mirror: flags.mirror !== false,
    ground,
    stride: numberOf(flags, "stride"),
    body: numberOf(flags, "body") ?? 0,
    groups,
    hitboxes: flags.hitboxes === undefined ? "along" : String(flags.hitboxes),
  });
  save(to, made.mdl);
  const three = (f) => (f.every((v) => v === f[0]) ? `${f[0]}` : f.join(","));
  for (const [name, f] of Object.entries(made.factors))
    console.log(`  ${name.padEnd(24)} x${three(f)}${made.mirrored.includes(name) ? "   (its other side's)" : ""}`);
  console.log(`  stride x${made.stride.toFixed(4)}: the roots' x and y and every animation's travel`);
  if (made.ground)
    console.log(
      `  ground: the roots' height x${made.ground.slope.toFixed(4)} ${made.lift < 0 ? "-" : "+"} ${Math.abs(made.lift).toFixed(3)}, fitted over ${made.ground.frames} frames standing (${made.ground.seq ?? "rest"} frame ${made.ground.frame}: lowest ${made.ground.low} on ${made.ground.bone})`,
    );
  const missing = groups.flatMap((g, i) => (i && !g ? [smak.sequenceFileOf(file, i)] : []));
  if (missing.length) console.log(`  not found beside it (their animations' boxes carried, not measured): ${missing.join(", ")}`);
  console.log(`${to}: ${made.boxes.measured} animations' boxes measured, ${made.boxes.carried.length} carried`);
}

// ── the figure judges ──────────────────────────────────────────────────────
const F = smak.figures;
/** The library the figure commands read and write: --library, else SMAK_FIGURES, else ~/.smak/figures.json. */
const libraryAsked = (flags) => (typeof flags.library === "string" ? flags.library : F.libraryFile());
/** The figure style --mod (and --kind) asks for: a profile's name or file; the plain one without. */
const styleAsked = async (flags) => F.figureStyleOf(typeof flags.mod === "string" ? flags.mod : undefined, { kind: flags.kind });
/**
 * The corpora a figure is judged against: --against (names with commas), else the profile's corpus; each
 * must be in the library for that judge, or the command says how to survey it.
 */
function corporaAsked(command, flags, style, library, judge) {
  const names = typeof flags.against === "string" ? flags.against.split(",") : style.corpus ? [style.corpus.name] : null;
  if (!names) fail(`${command}: whose figures to judge against: --mod <profile> (msc, ts, halflife ...) or --against <corpus,...>`);
  const held = F.corporaOf(library[judge]);
  const missing = names.filter((name) => !held.includes(name));
  if (missing.length)
    fail(`${command}: the library (${libraryAsked(flags)}) has no ${judge} measures of ${missing.join(", ")}${held.length ? ` (it has ${held.join(", ")})` : ""}: survey the game first, smak figure-survey <Half-Life folder> --mod ${flags.mod ?? "<profile>"}`); // prettier-ignore
  return names;
}
/** The models of a folder, or the one model given: a reference of several figures. */
const modelsOf = (path) =>
  statSync(path).isDirectory() ? readdirSync(path).filter((name) => /\.mdl$/i.test(name) && !/(t|\d\d)\.mdl$/i.test(name)).map((name) => join(path, name)) : [path]; // prettier-ignore
/** A mask from a PNG: white (over half) is the figure. */
function maskOfPng(file) {
  const img = smak.unpng(readFileSync(existing(file)));
  const data = new Uint8Array(img.width * img.height);
  for (let k = 0; k < data.length; k++) data[k] = img.rgba[k * 4] > 127 ? 1 : 0;
  return { width: img.width, height: img.height, data };
}
/** `view=file` pairs of a listed flag: { view: file }. */
function viewFiles(command, listed, name) {
  const out = {};
  for (const each of listed[name] ?? []) {
    const said = /^([A-Za-z0-9_]+)=(.+)$/.exec(each);
    if (!said) fail(`${command}: --${name} <view>=<file.png> (front=mask_front.png), not ${each}`);
    out[said[1]] = said[2];
  }
  return out;
}

/**
 * figure-survey: every figure of a game's models measured into the library, as its corpus: the profile's
 * (--mod, its folder found under the folder given), or --as <name>.
 */
async function figureSurvey({ command, file, flags }) {
  const style = await styleAsked(flags);
  const corpus = typeof flags.as === "string" ? flags.as : style.corpus?.name;
  if (!corpus) fail(`${command}: which corpus these figures are: --mod <profile> (msc, ts, halflife ...) or --as <name>`);
  if (!statSync(file).isDirectory()) fail(`${command}: ${file} is a file: give the Half-Life folder, the game's or its models folder`);
  const folder = F.modelsFolderOf(file, style.corpus?.folders?.[0] ?? corpus);
  const judges = typeof flags.judges === "string" ? flags.judges.split(",") : style.judges;
  const to = libraryAsked(flags);
  const library = F.readLibrary(to);
  F.surveyFigures(folder, { corpus, judges, library, log: (line) => console.log(line) });
  F.writeLibrary(library, to);
  const held = F.libraryCorpora(library);
  console.log(`${to}: ${Object.entries(held).map(([name, c]) => `${name} ${c.style || c.texture || c.shape} figures`).join(", ")}`);
  console.log("(measures of the game's own figures, on this machine: keep the file out of any repository you share)");
}

// a judge's finding this many of the corpus' middle halves out is "far": a figure with one fails
const FAR = 1.5;
/** What a finding measures: its words before the value (`triangles: 216 ...` is "triangles"). */
const measureOf = (said) => /^(.*?): [-\d]/.exec(said)?.[1] ?? said.split("; ")[0];
/** Far findings as the reasons of a FAIL: what each measures, the first three. */
const farText = (far) =>
  `${far.length} measures far out of the corpus' middle half: ${far.slice(0, 3).map((finding) => measureOf(finding.said)).join("; ")}${far.length > 3 ? "; ..." : ""}`; // prettier-ignore
/**
 * The texture and shape judges' answer: a pass when no measure is far out of the corpus' middle half. Their
 * sheet (--sheet) is looked at on a fail, where the measures far out are drawn; on a pass the text decides.
 */
function judgedBy(command, file, flags, { told, fit, findings }) {
  const far = findings.filter((finding) => finding.distance >= FAR);
  const sheet = typeof flags.sheet === "string" ? flags.sheet : null;
  const head = told.findIndex((line) => / of 100$/.test(line));
  answered(command, file, flags, {
    detail: told,
    passed: !far.length,
    said: far.length ? farText(far) : `measures one at a time ${fit} of 100, none far out of the corpus' middle half`,
    shown: far.length ? told : told.slice(Math.max(0, head), head + 1),
    look: sheet ? (far.length ? `look at ${sheet}: the measures far out are drawn there` : "no picture to look at: the measures decide") : undefined, // prettier-ignore
  });
}

/** figure-judge: the style judge, a model against the corpus of its game's profile (or --against). */
async function figureJudge({ command, file, flags }) {
  if (!/\.mdl$/i.test(file)) fail(`${command}: a model (.mdl)`);
  const style = await styleAsked(flags);
  const library = F.readLibrary(libraryAsked(flags));
  const games = corporaAsked(command, flags, style, library, "style");
  const data = library.style;
  const weights = flags.weights === "library" || flags.weights === "even" ? flags.weights : F.weightsFor(style, "style");
  const { weights: w } = F.styleSetup(data, { weights, groups: style.groups, least: style.least });
  const f = F.figureFacts(file);
  if (f.skip) fail(`${command}: ${file} is not judged: ${f.skip}`);
  const { measures, by } = F.styleMeasures(f);
  const prep = F.prepareStyle(F.styleCorpus(data, games), w);
  const verdict = F.judgeStyle(measures, prep, { hash: f.hash, textures: by.textures, parts: by.parts });
  const own = Object.values(F.styleLeaveOneOut(prep)).map((v) => v.score);
  verdict.among = F.rangeOf(own);
  if (flags.json) return console.log(JSON.stringify({ file, corpus: games, profile: style.name, measures, ...verdict }, null, 1));
  const told = F.styleTold(basename(file), verdict, games, { most: flags.all ? 99 : 12 }).split("\n");
  if (style.name && weights !== "library") told.push(`  (weighed as ${style.title}: the profile's weights)`);
  // it passes where the game's own figures do: at or over the lower quarter of their scores against the rest
  const floor = [...own].sort((a, b) => a - b)[Math.floor(own.length / 4)];
  const passed = verdict.score >= floor;
  const far = verdict.findings.filter((finding) => finding.distance >= FAR && !finding.told);
  answered(command, file, flags, {
    detail: told,
    passed,
    said: passed
      ? `${verdict.score} of 100, at or over the lower quarter of the game's own figures (${floor})`
      : `${verdict.score} of 100, under the lower quarter of the game's own figures (${floor})${far.length ? `: ${farText(far)}` : ""}`,
    shown: passed ? told.slice(0, 1) : told,
    look: passed ? undefined : `look: draw it beside the nearest of the game's (${verdict.nearest[0]?.figure ?? "none"}) with render and tile, for the owner's eye`, // prettier-ignore
  });
}

/** A texture's measures from a file: a model's textures, or a picture of an atlas (its box, its pixels a texel). */
function textureOfFile(file, { box, scale }) {
  if (/\.mdl$/i.test(file)) return F.textureOfModel(file);
  if (/\.png$/i.test(file)) return F.textureOfPicture(smak.unpng(readFileSync(existing(file))), { box, scale });
  fail(`figure-texture: a model (.mdl) or a picture of an atlas (.png), not ${file}`);
}

/** figure-texture: the texture judge, a model's textures or an atlas' picture against a corpus and a reference. */
async function figureTexture({ command, file, flags }) {
  const style = await styleAsked(flags);
  const library = F.readLibrary(libraryAsked(flags));
  const games = corporaAsked(command, flags, style, library, "texture");
  const own = textureOfFile(file, { box: numbersOf(flags, "box", 4, "x0,y0,x1,y1 in pixels"), scale: numberOf(flags, "scale") });
  let ref = null,
    refName = "the reference";
  if (typeof flags.reference === "string") {
    const at = flags.reference;
    if (!existsSync(at)) fail(`no such file: ${at}`);
    refName = basename(at).replace(/\.\w+$/, "");
    if (/\.png$/i.test(at)) ref = textureOfFile(at, { box: numbersOf(flags, "reference-box", 4, "x0,y0,x1,y1 in pixels"), scale: numberOf(flags, "reference-scale") }); // prettier-ignore
    else {
      const list = modelsOf(at).map((model) => F.textureOfModel(model));
      ref = { measures: F.referenceOfMeasures(list.map((x) => x.measures)), atlases: list[0].atlases };
    }
  }
  const v = F.judgeTexture(own.measures, library.texture, games, ref?.measures, { refName });
  if (flags.sheet) {
    const items = [{ name: basename(file).replace(/\.\w+$/, ""), ...own }, ...(ref ? [{ name: refName, ...ref }] : [])];
    const img = F.textureSheet(items, library.texture, { scale: flags["full-pictures"] === true ? 3 : 2 });
    save(flags.sheet, smak.png(img.width, img.height, img.rgba));
  }
  if (flags.json) return console.log(JSON.stringify({ file, corpus: games, reference: ref ? refName : null, scale: own.scale, measures: own.measures, ...v }, null, 1)); // prettier-ignore
  const told = [
    ...(flags.sheet ? [`${flags.sheet}: the atlases side by side, every measure over the library's spread`] : []),
    ...(own.scale && own.scale !== 1 ? [`(the picture read at ${own.scale.toFixed(2)} pixels a texel)`] : []),
    ...F.textureTold(basename(file), v, games, refName).split("\n"),
  ];
  judgedBy(command, file, flags, { told, fit: v.fit, findings: v.findings });
}

/**
 * A reference's shape for figure-shape: models (a folder or one, each measured, the medians), or masks by
 * view (`--reference front=mask.png`, with `--reference-picture front=shot.png` for the inside's edges).
 */
function shapeReference(command, flags, listed) {
  const given = listed.reference ?? (typeof flags.reference === "string" ? [flags.reference] : []);
  if (!given.length) return null;
  if (given.every((each) => /^[A-Za-z0-9_]+=/.test(each))) {
    const pictures = viewFiles(command, listed, "reference-picture");
    const masks = {};
    for (const [view, maskFile] of Object.entries(viewFiles(command, listed, "reference")))
      masks[view] = { mask: maskOfPng(maskFile), img: pictures[view] ? smak.unpng(readFileSync(existing(pictures[view]))) : null };
    return { name: "the reference", masks, ...F.shapeOfReference(masks) };
  }
  if (given.length > 1) fail(`${command}: --reference is a folder of models, a model, or masks by view (front=mask.png ...)`);
  const at = given[0];
  if (!existsSync(at)) fail(`no such file: ${at}`);
  const list = modelsOf(at).map((model) => F.shapeOfModel(model));
  const bands = {};
  for (const [band] of F.BANDS)
    bands[band] = Object.fromEntries(["holes", "fine", "notches"].map((k) => [k, F.medianOf(list.map((x) => x.bands[band]?.[k]))]));
  return { name: basename(at).replace(/\.\w+$/, ""), measures: F.referenceOfMeasures(list.map((x) => x.measures)), bands };
}

/** figure-shape: the shape judge, a model's (or a picture's, with its mask) shape against a corpus and a reference. */
async function figureShape({ command, file, flags, listed }) {
  const style = await styleAsked(flags);
  const library = F.readLibrary(libraryAsked(flags));
  const games = corporaAsked(command, flags, style, library, "shape");
  const ref = shapeReference(command, flags, listed);
  let x;
  if (/\.mdl$/i.test(file)) {
    let masks;
    if (typeof flags.pose === "string") {
      // the model drawn in the reference's pose and from its views: a module giving the pose and the cameras
      if (!ref?.masks) fail(`${command}: --pose draws the model as the reference's masks see it: give them, --reference front=mask.png ...`);
      const posing = await import(pathToFileURL(resolve(existing(flags.pose))).href);
      const poseOf = posing.pose ?? posing.default;
      if (typeof poseOf !== "function") fail(`${command}: ${flags.pose} exports pose(src) (or a default function): the bones' matrices`);
      const src = readModel(file, command);
      const cameras = posing.views ?? {};
      const views = Object.fromEntries(Object.entries(ref.masks).map(([view, { mask }]) => [view, { ...cameras[view], mask }]));
      masks = F.masksLikeReference(src, { pose: await poseOf(src), views, background: posing.background });
    }
    x = F.shapeOfModel(file, { masks, keep: Boolean(flags.sheet) });
  } else if (/\.png$/i.test(file)) {
    if (typeof flags.mask !== "string") fail(`${command}: a picture needs its mask, --mask m.png (white figure on black)`);
    const masks = { picture: { mask: maskOfPng(flags.mask), img: smak.unpng(readFileSync(file)) } };
    x = { ...F.shapeOfReference(masks, { keep: Boolean(flags.sheet) }) };
  } else fail(`${command}: a model (.mdl), or a picture (.png) with --mask`);
  const refName = ref?.name ?? "the reference";
  const v = F.judgeShape(x, library.shape, games, ref, refName);
  if (flags.sheet) {
    const items = Object.entries(x.pictures ?? {}).map(([view, p]) => ({ name: `${basename(file).replace(/\.\w+$/, "")} ${view}`, at: p.at, note: `HOLES ${(100 * x.views[view].measures.holes).toFixed(1)}PC` })); // prettier-ignore
    const img = F.shapeSheet(items, { scale: flags["full-pictures"] === true ? 0.75 : 0.5 });
    save(flags.sheet, smak.png(img.width, img.height, img.rgba));
  }
  if (flags.json) return console.log(JSON.stringify({ file, corpus: games, reference: ref ? refName : null, measures: x.measures, bands: x.bands, ...v }, null, 1)); // prettier-ignore
  const told = [
    ...(flags.sheet ? [`${flags.sheet}: the silhouettes as measured`] : []),
    ...F.shapeTold(basename(file), v, games, refName).split("\n"),
  ];
  judgedBy(command, file, flags, { told, fit: v.fit, findings: v.findings });
}

/** figure-validate: does each judge tell the library's corpora apart (AUC, confusion), with each one's own weights or the library's. */
async function figureValidate({ command, file, flags }) {
  const library = F.readLibrary(file);
  const judge = typeof flags.judge === "string" ? flags.judge : "style";
  if (!F.JUDGES.includes(judge)) fail(`${command}: --judge ${F.JUDGES.join(" | ")}, not ${judge}`);
  const data = library[judge];
  const games = F.corporaOf(data);
  if (games.length < 2) fail(`${command}: the library has ${games.length} corpus with ${judge} measures: the judges are validated between two or more`);
  let out;
  if (judge === "style") {
    const { weights, sep } = F.styleSetup(data, { weights: flags.weights === "even" ? "even" : "library" });
    let weightsFor;
    if (flags.weights === "profiles") {
      const floors = F.styleFloors(data);
      const own = {};
      for (const game of games) {
        if (!F.FIGURE_PROFILES[game]) continue;
        const style = await F.figureStyleOf(game);
        own[game] = { ...F.styleWeightsOf(style.weights.style, { groups: style.groups, least: style.least }), __floor: floors };
      }
      weightsFor = (game) => own[game] ?? weights;
    }
    out = F.validateStyle(data, { weights, sep, weightsFor });
  } else if (judge === "texture") out = F.validateTexture(data);
  else out = F.validateShape(data);
  if (flags.json) return console.log(JSON.stringify(out.report, null, 1));
  console.log(out.text);
}

// ── re-skin by rules ───────────────────────────────────────────────────────
/** reskin: a file of rules (.json, or .mjs exporting `rules`) applied to the model, its textures before and after. */
async function reskin({ command, src, rest, flags }) {
  const rulesFile = existing(need(command, rest[0], "<rules.json|rules.mjs>"));
  const to = need(command, flags.o, "-o out.mdl");
  if (flags.pictures === true) fail(`${command}: --pictures needs a folder after it`);
  const read = /\.m?js$/i.test(rulesFile)
    ? await import(pathToFileURL(resolve(rulesFile)).href)
    : JSON.parse(readFileSync(rulesFile, "utf8"));
  const given = smak.rulesOf(read.default ?? read, rulesFile);
  const body = numberOf(flags, "body") ?? given.body ?? 0;
  const made = smak.reskin(src, given.rules, { body, pose: given.pose, own: given.own });
  save(to, made.mdl);
  for (const own of made.owned)
    console.log(`  own pixels: ${own.moved} triangles now wear ${own.texture} (${own.width}x${own.height}), islands ${own.islands.join(", ")}`);
  console.log(`${to}: body ${body}; ${made.changed.length} textures changed: ${made.changed.join(", ") || "none"}`);
  const shared = Object.entries(made.shared).filter(([, share]) => share > 0);
  if (shared.length)
    console.log(`  worn by two places of the body (a mark on one shows on the other): ${shared.map(([n, v]) => `${n} ${v}`).join(", ")}`);
  if (typeof flags.pictures === "string")
    for (const { name, image } of made.pictures) {
      const file = join(flags.pictures, `${fileNameOf(name)}_before_after.png`);
      save(file, smak.png(image.width, image.height, image.rgba));
      console.log(`  ${file}`);
    }
  const report = smak.check(made.mdl, "goldsrc", { source: src });
  for (const error of report.errors) console.log(`ERROR ${error}`);
  for (const warning of report.warnings) console.log(`WARN  ${warning}`);
}

// ── pieces, islands, layers ────────────────────────────────────────────────
function pieces({ src, flags }) {
  const min = numberOf(flags, "min") ?? PIECES_MIN_TRIANGLES;
  const body = numberOf(flags, "body");
  // with --body: the submodel of each bodypart that body number shows
  const shown = body === undefined ? null : smak.bodyOf(src, body);
  const seq = seqOf(src, flags);
  const list = smak
    .pieces(src, { seq })
    .list.filter((piece) => !shown || shown[piece.where.bodypart] === piece.where.model);
  console.log("  id  texture                 tris   middle (x y z)        size (x y z)");
  for (const piece of list.filter((p) => p.tris >= min)) {
    const size = piece.mx.map((v, axis) => (v - piece.mn[axis]).toFixed(1)).join(" ");
    console.log(
      `${String(piece.id).padStart(4)}  ${String(piece.tex).padEnd(22)} ${String(piece.tris).padStart(5)}   ${piece.mid.join(" ").padEnd(20)}  ${size}`,
    );
  }
  const small = list.filter((p) => p.tris < min).length;
  console.log(
    `${list.length} pieces${shown ? ` of body ${body}` : ""}, ${small} of them under ${min} triangles and not listed`,
  );
}
function islands({ src, flags }) {
  const min = numberOf(flags, "min") ?? ISLANDS_MIN_TRIANGLES;
  const body = numberOf(flags, "body");
  const shown = body === undefined ? null : smak.bodyOf(src, body);
  const mdl = smak.readMdl(src);
  const onlyTexture =
    flags.texture === undefined ? null : smak.textureOf(src, nameOrNumber(flags.texture)).name;
  const seq = seqOf(src, flags);
  const usedByBody = (island) => island.uses.some((use) => shown[use.bodypart] === use.model);
  const list = smak
    .uvIslands(src, { seq })
    .list.filter((island) => (!onlyTexture || island.tex === onlyTexture) && (!shown || usedByBody(island)));
  // an island's triangles: with --body, that body's own only
  const trisOf = (island) =>
    shown
      ? island.uses.reduce((sum, use) => sum + (shown[use.bodypart] === use.model ? use.tris : 0), 0)
      : island.tris;
  const wide = Math.max(7, ...list.map((island) => island.tex.length));
  const few = (items, most) =>
    `${items.slice(0, most).join(", ")}${items.length > most ? ` and ${items.length - most} more` : ""}`;
  console.log(
    `  id  ${"texture".padEnd(wide)}  tris  box in pixels        border (open)  middle (x y z)        faces (x y z)      bodies; bones`,
  );
  for (const island of list.filter((x) => trisOf(x) >= min)) {
    const bodies = [...new Set(island.uses.map((use) => use.body))];
    console.log(
      `${String(island.id).padStart(4)}  ${island.tex.padEnd(wide)} ${String(trisOf(island)).padStart(5)}  ${boxText(island.box).padEnd(20)} ${`${island.border} (${island.open})`.padEnd(14)} ${island.mid.join(" ").padEnd(20)}  ${island.n.join(" ").padEnd(18)} ${few(bodies, BODIES_LISTED)}; ${few(island.bones, BONES_LISTED)}`,
    );
  }
  const small = list.filter((x) => trisOf(x) < min).length;
  const total = list.reduce((sum, island) => sum + trisOf(island), 0);
  const counted = shown
    ? " of that body"
    : list.some((island) => island.bodies.length > 1)
      ? " over every body that uses them (an island two bodies share counts for both: --body n counts one)"
      : "";
  console.log(
    `${list.length} islands${shown ? ` of body ${body}` : ""}, ${small} of them under ${min} triangles and not listed; ${total} triangles${counted}`,
  );
  if (!flags.o) return;
  const textureNumbers = new Set(
    list.map((island) => mdl.textures.findIndex((texture) => texture.name === island.tex)),
  );
  for (const number of textureNumbers) {
    const map = smak.islandMap(src, number, { body });
    const to = join(flags.o, `islands_${fileNameOf(map.texture.name)}.png`);
    save(to, smak.png(map.width, map.height, map.rgba));
    console.log(
      `${to}  ${map.texture.width}x${map.texture.height} x${map.scale}, islands ${map.islands.join(" ")}; an open border is white, a seam in the island's colour`,
    );
  }
}
const luminance = (rgb) => 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
const saturation = (rgb) => Math.max(...rgb) - Math.min(...rgb);
/** A layer's line of JavaScript as a function; one that cannot be read stops the command, with why. */
function ruleOf(word, expression) {
  try {
    return new Function("place", "W", "lum", "sat", `with (place) return (${expression});`);
  } catch (error) {
    return fail(`layers: ${word} cannot be read as JavaScript: ${error.message}`);
  }
}
/** A module of layers loaded; one that cannot be stops the command, with why. */
async function layersModule(moduleFile) {
  try {
    return await import(pathToFileURL(resolve(existing(moduleFile))).href);
  } catch (error) {
    return fail(`layers: ${moduleFile} cannot be loaded: ${error.message}`);
  }
}
/**
 * The layers `layers` is asked for: those a module exports, and each `name=expression` as a layer whose
 * function is that line of JavaScript over what paint hands its function, with `lum`, `sat` and `W` beside.
 */
function layerDeclarations(rest, moduleFile, module) {
  const declarations = { ...(module.layers ?? module.default ?? {}) };
  for (const word of rest) {
    if (word === moduleFile) continue;
    const equals = word.indexOf("=");
    if (equals < 1) fail(`layers: ${word} is neither a module nor name=expression`);
    const rule = ruleOf(word, word.slice(equals + 1));
    declarations[word.slice(0, equals)] = (place) =>
      rule(place, smak.workshop, luminance(place.rgb), saturation(place.rgb));
  }
  if (!Object.keys(declarations).length)
    fail("layers: give a module that exports `layers`, or name=expression");
  return declarations;
}
/** One layer's pixels counted and its regions listed, but for those under `min` pixels. */
function printLayer(layer, min) {
  const point = (p) => p.map((v) => v.toFixed(1)).join(" ");
  let on = 0;
  for (const value of layer.value) if (value >= 0.5) on++;
  const small = layer.regions.filter((region) => region.size < min).length;
  console.log(
    `\n${layer.name}: ${on} pixels in ${layer.regions.length} regions${small ? `, ${small} of them under ${min} pixels and not listed` : ""}`,
  );
  if (small < layer.regions.length)
    console.log(
      "    id   size  box in pixels        centre        from (x y z)        to (x y z)          islands",
    );
  for (const region of layer.regions.filter((r) => r.size >= min)) {
    const centre = region.centre.map((v) => v.toFixed(1)).join(",");
    const from = region.mn ? point(region.mn) : "-";
    const to = region.mx ? point(region.mx) : "-";
    console.log(
      `  ${String(region.id).padStart(4)} ${String(region.size).padStart(6)}  ${boxText(region.box).padEnd(20)} ${centre.padEnd(13)} ${from.padEnd(19)} ${to.padEnd(19)} ${region.islands.join(" ")}`,
    );
  }
}
async function layers({ src, rest, flags }) {
  const moduleFile = rest.find((word) => /\.m?js$/i.test(word));
  const module = moduleFile ? await layersModule(moduleFile) : {};
  const declarations = layerDeclarations(rest, moduleFile, module);
  const min = numberOf(flags, "min") ?? LAYERS_MIN_PIXELS;
  // the pose: the model's first animation, then what the module says, then what the flags say
  const pose = {
    seq: firstSeq(src),
    ...(module.pose ?? {}),
    ...defined({ seq: seqAsked(flags), body: numberOf(flags, "body") }),
  };
  const tex =
    flags.texture === undefined ? module.tex : smak.textureOf(src, nameOrNumber(flags.texture)).name;
  const made = smak.layersOf(src, declarations, { pose, tex });
  const all = Object.values(made);
  if (!all.length) fail("layers: none of them is for this texture");
  const first = all[0];
  console.log(
    `${first.tex} ${first.width}x${first.height}, as body ${pose.body ?? 0} stands ${pose.seq === null ? "at rest" : `in animation ${pose.seq}`}`,
  );
  for (const layer of all) printLayer(layer, min);
  if (!flags.o) return;
  const map = smak.layerMap(src, first.tex, made, { min });
  const to = /\.png$/i.test(flags.o) ? flags.o : join(flags.o, `layers_${fileNameOf(first.tex)}.png`);
  save(to, smak.png(map.width, map.height, map.rgba));
  console.log(
    `\n${to}  ${first.width}x${first.height} x${map.scale}: ${all.map((layer) => layer.name).join(", ")}, each in the colour its name is written in; regions of ${min} pixels and more numbered`,
  );
}

// ── a model from an .obj file ──────────────────────────────────────────────
/** The file a material's picture is in: as the .mtl names it from the .obj's folder, or by its name alone. */
function pictureFileOf(folder, named) {
  // a file written on Windows may name it with backslashes
  const withSlashes = named.replaceAll("\\", "/");
  const asWritten = resolve(folder, withSlashes);
  const beside = join(folder, basename(withSlashes));
  return [asWritten, beside].find((candidate) => existsSync(candidate));
}
/**
 * obj: an .obj file made into a model. The .mtl files it names and the pictures those name are looked for
 * beside it; what is not found, or is not a PNG or a BMP, is said and the material wears its flat colour.
 */
function obj({ command, file, flags }) {
  const to = need(command, flags.o, "-o out.mdl");
  const folder = dirname(file);
  const notes = [];
  const text = readFileSync(file, "utf8");
  // the materials: of every .mtl the file names that is there
  const materials = [];
  for (const library of smak.readObj(text).libraries) {
    const libraryFile = pictureFileOf(folder, library);
    if (libraryFile) materials.push(...smak.readMtl(readFileSync(libraryFile, "utf8")));
    else notes.push(`${library}, which the file names for its materials, is not beside it`);
  }
  // their pictures
  const textures = {};
  for (const material of materials) {
    if (!material.picture) continue;
    const pictureFile = pictureFileOf(folder, material.picture);
    if (!pictureFile) notes.push(`${material.picture} is not beside the .obj`);
    else if (!/\.(png|bmp)$/i.test(pictureFile))
      notes.push(
        `${material.picture} is not a PNG or a BMP, the pictures that are read: save it as one and name that in the .mtl`,
      );
    else textures[material.name] = readFileSync(pictureFile);
  }
  const made = smak.objModel(smak.readObj(text, { mtl: materials }), {
    name: flags.name === undefined ? basename(to) : String(flags.name),
    textures,
    ...defined({
      scale: numberOf(flags, "scale"),
      up: flags.up,
      turn: numberOf(flags, "turn"),
      maxTextureSize: numberOf(flags, "max-texture"),
    }),
    ground: Boolean(flags.ground),
    centre: Boolean(flags.centre),
  });
  save(to, made.mdl);

  const { report } = made;
  const size = report.box.mx.map((v, axis) => (v - report.box.mn[axis]).toFixed(1)).join(" x ");
  const parts = report.bodyparts > 1 ? ` in ${report.bodyparts} bodyparts` : "";
  console.log(
    `${to}: "${report.name}", ${made.mdl.length} bytes, ${report.triangles} triangles on ${report.points} points${parts}`,
  );
  console.log(
    `  ${size} units (x y z), from ${report.box.mn.map((v) => v.toFixed(1)).join(" ")} to ${report.box.mx.map((v) => v.toFixed(1)).join(" ")}; one bone (root), one animation (idle)`,
  );
  for (const texture of report.textures)
    console.log(
      `  ${texture.name.padEnd(24)} ${texture.width}x${texture.height}  ${texture.material ? `material ${texture.material}` : "the faces without a material"}: ${texture.from}`,
    );
  for (const note of [...notes, ...made.warnings]) console.log(`WARN  ${note}`);
  // what each engine makes of it: the same sentence is printed once
  const told = new Set();
  let errors = 0;
  for (const engine of ["goldsrc", "xash"]) {
    const checked = smak.check(made.mdl, engine);
    errors += checked.errors.length;
    for (const line of [
      ...checked.warnings.map((warning) => `WARN  ${warning}`),
      ...checked.errors.map((error) => `ERROR ${error}`),
    ]) {
      if (!told.has(line)) console.log(line);
      told.add(line);
    }
  }
  console.log(errors ? `${errors} errors: not fit for the game` : "fit for goldsrc and xash");
  process.exit(errors ? 1 : 0);
}

// ── a model from another tool's file ───────────────────────────────────────
/** What `import` and `item` hand the readers and the makers, from the flags. */
const importAsked = (flags) =>
  defined({
    up: flags.up,
    scale: numberOf(flags, "scale"),
    fit: numberOf(flags, "fit"),
    origin: flags.origin,
    turn: numberOf(flags, "turn"),
    maxTextureSize: numberOf(flags, "max-texture"),
    triangles: numberOf(flags, "triangles"),
  });
/** The pictures a file carries inside it, written out as the files they are: for one that is not read (a JPEG). */
function savePictures(read, folder) {
  read.images.forEach((image, i) => {
    const ending = /png/i.test(image.mime) ? "png" : /jpe?g/i.test(image.mime) ? "jpg" : "bin";
    const to = join(folder, `${String(i).padStart(2, "0")}_${fileNameOf(basename(image.name || "picture"))}.${ending}`);
    save(to, image.bytes);
    console.log(`  ${to}  ${image.bytes.length} bytes`);
  });
  if (!read.images.length) console.log("  the file carries no pictures inside it");
}
/** One line of the table `import` prints of a folder. */
const importRow = (row) =>
  row.error
    ? `FAIL  ${row.file}: ${row.error}`
    : `${String(row.triangles).padStart(9)} ${String(row.points).padStart(6)} ${String(row.meshes).padStart(6)} ${`${row.pictures}/${row.materials}`.padStart(8)}  ${row.size.join(" x ").padEnd(24)} ${row.file}${row.bones ? `  [${row.bones} bones, ${row.animations} animations: not in a prop]` : ""}${row.heavy ? "  HEAVY" : ""}`;
/** The lines `import` and `obj` end with: what each engine makes of a model. Returns how many errors. */
function sayChecks(mdl) {
  const told = new Set();
  let errors = 0;
  for (const engine of GAME_ENGINES) {
    const checked = smak.check(mdl, engine);
    errors += checked.errors.length;
    for (const line of [
      ...checked.warnings.map((warning) => `WARN  ${warning}`),
      ...checked.errors.map((error) => `ERROR ${error}`),
    ]) {
      if (!told.has(line)) console.log(line);
      told.add(line);
    }
  }
  return errors;
}
/**
 * import: a model file of another tool (.fbx, .glb, .gltf, .obj) looked into and, with -o, made into a prop;
 * a folder of them, with -o a folder, made into props with a contact sheet and a table.
 */
function imported({ command, file, flags }) {
  const asked = importAsked(flags);
  if (statSync(file).isDirectory()) {
    const to = need(command, flags.o, "-o <folder>: where the models of a folder go");
    console.log("triangles points meshes pictures  size (units, x y z)      file");
    const done = smak.importFolder(file, to, {
      ...asked,
      texture: flags.texture,
      size: numberOf(flags, "size"),
      only: flags.only ? String(flags.only).toLowerCase().split(",") : null,
      said: (row) => console.log(importRow(row)),
    });
    const made = done.rows.filter((row) => !row.error);
    // a picture made smaller is what nearly every bought picture needs: counted, not said file by file
    const routine = /larger than \d+: made \d+x\d+$/;
    for (const row of made)
      for (const warning of row.warnings) if (!routine.test(warning)) console.log(`WARN  ${row.file}: ${warning}`);
    const smaller = made.filter((row) => row.warnings.some((warning) => routine.test(warning))).length;
    if (smaller) console.log(`${smaller} models have a picture larger than the engine draws, made smaller (import.json says which)`);
    for (const row of made) if (row.heavy) console.log(`HEAVY ${row.file}: ${row.heavy}`);
    save(join(to, "import.json"), JSON.stringify(done.rows, null, 1));
    console.log(
      `${made.length} models in ${to}, ${made.reduce((sum, row) => sum + row.triangles, 0)} triangles; ${made.filter((row) => row.missing).length} with a material that found no picture; ${made.filter((row) => row.heavy).length} heavy; ${done.failed} failed`,
    );
    for (const sheet of done.sheets) console.log(`${sheet}: the models drawn from three quarters, with their textures`);
    console.log(`${join(to, "import.json")}: the table`);
    process.exit(done.failed ? 1 : 0);
  }
  const read = smak.readModelFile(file, asked);
  const summary = smak.importSummary(read);
  if (flags.json && !flags.o) {
    console.log(JSON.stringify({ file, format: read.format, version: read.version, axes: read.axes, unit: read.unit, ...summary.totals, meshes: read.meshes, materials: read.materials.map(({ name, colour, picture, image }) => ({ name, colour, picture, inside: image !== undefined })), nodes: read.nodes.map(({ name, parent, kind }) => ({ name, parent, kind })), joints: read.joints, animations: read.animations.map(({ name, duration, nodes }) => ({ name, duration, nodes: nodes.length })), warnings: read.warnings }, null, 1)); // prettier-ignore
    return;
  }
  console.log(`${file}:`);
  for (const line of summary.lines) console.log(/^WARN/.test(line) ? line : `  ${line}`);
  const found = smak.picturesOf(file, read, { texture: flags.texture });
  console.log("pictures:");
  for (const line of found.lines) console.log(`  ${line}`);
  if (flags["save-pictures"]) savePictures(read, flags["save-pictures"]);
  if (!flags.o) {
    if (summary.totals.triangles) console.log(`as a prop (-o out.mdl): ${smak.importScale(read, asked).said}`);
    return;
  }
  const to = flags.o;
  const name = flags.name === undefined ? basename(to) : String(flags.name);
  const made = flags.anim
    ? smak.importRigged(read, {
        ...asked,
        name,
        pictures: found.pictures,
        animations: flags.anim === true ? undefined : String(flags.anim).split(","),
        fps: numberOf(flags, "fps"),
      })
    : smak.importModel(read, { ...asked, name, pictures: found.pictures });
  save(to, made.mdl);
  const { report } = made;
  const size = report.box.mx.map((v, axis) => (v - report.box.mn[axis]).toFixed(1)).join(" x ");
  console.log(
    `${to}: "${report.name}", ${made.mdl.length} bytes, ${report.triangles} triangles on ${report.points} points${report.bodyparts > 1 ? ` in ${report.bodyparts} bodyparts` : ""}`,
  );
  console.log(`  size: ${report.scale.said}`);
  if (report.fewer) console.log(`  fewer triangles: ${report.fewer}`);
  console.log(
    `  ${size} units (x y z), from ${report.box.mn.map((v) => v.toFixed(1)).join(" ")} to ${report.box.mx.map((v) => v.toFixed(1)).join(" ")}; ${report.bones ? `${report.bones.length} bones` : "one bone (root), one animation (idle)"}`,
  );
  for (const texture of report.textures)
    console.log(
      `  ${texture.name.padEnd(24)} ${texture.width}x${texture.height}  ${texture.material ? `material ${texture.material}` : "the faces without a material"}: ${texture.from}`,
    );
  for (const sequence of report.sequences ?? [])
    console.log(`  animation ${sequence.name}: ${sequence.frames} frames at ${sequence.fps} a second`);
  if (report.kin) console.log(`  feet at z ${report.feet} as its first animation begins; ${report.kin}`);
  for (const warning of made.warnings) console.log(`WARN  ${warning}`);
  if (report.heavy) console.log(`WARN  ${report.heavy}`);
  const errors = sayChecks(made.mdl);
  if (flags.pictures) {
    const picture = smak.sheet(made.mdl, defined({ size: numberOf(flags, "size") }));
    const sheetFile = `${to.replace(/\.mdl$/i, "")}.png`;
    save(sheetFile, smak.png(picture.width, picture.height, picture.rgba));
    console.log(`  ${sheetFile}: six views of it`);
  }
  console.log(errors ? `${errors} errors: not fit for the game` : "fit for goldsrc and xash");
  process.exit(errors ? 1 : 0);
}
/**
 * A bought model as the piece `item` adds: read, its pictures found, laid along the axes a piece is drawn
 * in (`importPiece`), with what was taken for granted printed. Returns { piece, texture }.
 */
function boughtPiece({ command, file, flags, family, name }) {
  const read = smak.readModelFile(file, importAsked(flags));
  // for a bought model --texture is the file of its picture, not the name it has in the game's files
  const given = flags.texture === undefined ? undefined : existing(String(flags.texture));
  const found = smak.picturesOf(file, read, { texture: given });
  const piece = smak.importPiece(read, {
    pictures: found.pictures,
    as: flags.as ?? (family.how === "shield" ? "shield" : "auto"),
    ...defined({ axis: flags.axis, grip: flags.grip }),
    flip: Boolean(flags.flip),
    ...defined({ triangles: numberOf(flags, "triangles") }),
  });
  console.log(
    `${command}: ${basename(file)}: ${piece.tris.length} triangles, a picture of ${piece.image.width}x${piece.image.height}, held as ${piece.as}`,
  );
  for (const line of found.lines) console.log(`      ${line}`);
  for (const line of piece.assumed) console.log(`      assumed: ${line}`);
  return { piece, texture: smak.pieceTexture(piece, `${name}.bmp`) };
}

// ── an item added to a family of a mod's models ────────────────────────────
/**
 * item: a piece, made by a module, added as new submodels to every file a family of the mod's profile shows
 * its kind of item from (`addItem`): the files are looked for in --base and then in the game's folders, the
 * thing each placement is laid on is measured in the game's own, and what comes of it is checked and written
 * under -o by the same paths. A file that holds the item already is left as it is.
 */
async function item({ command, file, flags, listed }) {
  const mod = (await profileOf(flags, listed)) ?? fail(`${command}: --mod <profile>: the families are a profile's \`items\``); // prettier-ignore
  const families = mod.items ?? {};
  const known = Object.keys(families).join(", ") || "the profile has none";
  const family = families[need(command, flags.family, `--family <name>: ${known}`)];
  if (!family) fail(`${command}: the profile has no family ${flags.family}: ${known}`);
  const to = need(command, flags.o, "-o <folder>");
  const name = need(command, flags.name, "--name <the word its submodels are named with>");
  // a bought model (.fbx, .glb, .gltf, .obj) is its own piece; anything else is a module that makes one
  const bought = smak.MODEL_FILE.test(file) ? boughtPiece({ command, file, flags, family, name }) : null;
  const module = bought ? { piece: bought.piece } : await import(pathToFileURL(resolve(existing(file))).href);
  const maker = module.default ?? module.piece;
  const piece = typeof maker === "function" ? await maker() : maker;
  if (!piece?.tris && typeof piece?.shield !== "function")
    fail(
      `${command}: ${basename(file)} is to export a piece ({ tris, image }, as the kits make one), or a function that makes it, as its default`,
    );
  /** a file of the game as installed: the first of its folders that has it */
  const own = (path) => {
    const folder = mod.folders.find((each) => existsSync(join(each, path)));
    return folder ? readFileSync(join(folder, path)) : fail(`${command}: ${path} is in none of the game's folders (--game <the mod's folder>)`); // prettier-ignore
  };
  const read = (path) =>
    flags.base && existsSync(join(flags.base, path)) ? readFileSync(join(flags.base, path)) : own(path);
  const began = new Map();
  const result = smak.addItem(
    (path) => began.get(path) ?? began.set(path, read(path)).get(path),
    { name, piece, texture: bought?.texture ?? flags.texture ?? `${name}.bmp` },
    family,
    { reference: own, existing: "same" },
  );
  let wrong = 0;
  for (const place of result.placed)
    console.log(
      `${place.kept ? "kept " : "added"} ${place.file} ${place.name}: submodel ${place.model}, on ${place.report.bones.join(" + ")} as ${place.report.like}, ${place.report.tris} triangles, ${place.report.turn}, box off by ${round2(place.report.boxOff)}`,
    );
  for (const [path, mdl] of result.files) {
    for (const line of smak.keptWhole(began.get(path), mdl).lines) {
      if (!line.ok) wrong++;
      console.log(`${line.ok ? "ok   " : "FAIL "} ${path}: ${line.text}`);
    }
    for (const engine of GAME_ENGINES) {
      const report = smak.check(mdl, engine);
      wrong += report.errors.length;
      for (const error of report.errors) console.log(`ERROR ${path} (${engine}): ${error}`);
      for (const warning of report.warnings) console.log(`WARN  ${path} (${engine}): ${warning}`);
    }
    save(join(to, path), mdl);
    console.log(`      ${join(to, path)}: ${mdl.length} bytes`);
    if (flags.pictures) {
      const sheet = smak.itemSheet(mdl, result.placed.filter((place) => place.file === path)); // prettier-ignore
      const picture = join(to, "pictures", `${name}_${basename(path).replace(/\.mdl$/i, "")}.png`);
      save(picture, smak.png(sheet.width, sheet.height, sheet.rgba));
      console.log(`      ${picture}: each new submodel beside the one it was laid on`);
    }
  }
  console.log(`its script${family.script ? ` (after ${family.script})` : ""}:`);
  for (const line of smak.itemConstants(result)) console.log(`  ${line}`);
  // the last line says what decides, as a checking command's does; the pictures are what the checks cannot see
  console.log(
    flags.pictures
      ? `look at ${join(to, "pictures")}: the checks cannot tell whether it is the shape asked for`
      : "no pictures: --pictures draws each new submodel beside the one it was laid on, to look at",
  );
  console.log(
    wrong
      ? `FAIL: ${wrong} faults in ${name} (above)`
      : `PASS: ${name} added to ${result.files.size} files; each checks for ${GAME_ENGINES.join(" and ")} and keeps what it had`,
  );
  process.exit(wrong ? 1 : 0);
}

// ── scripts of one's own against the game's ────────────────────────────────
/** A map's name and its entities, each a plain object of its keys: of a .bsp or of brush source. */
function mapForScripts(file) {
  const name = basename(file).replace(/\.(bsp|map)$/i, "");
  if (isSource(file))
    return { name, entities: maps.readMap(readFileSync(file, "utf8")).entities.map((entity) => ({ ...entity })) }; // prettier-ignore
  return { name, entities: readCompiled(file).bsp.entities.map((entity) => Object.fromEntries(entity)) };
}
/**
 * What `scriptsPlaced` found, printed: every script with its place, or only what is wrong. Returns how many
 * warnings there were.
 */
function sayScripts(placed, { all = true } = {}) {
  if (all) {
    for (const fact of placed.facts) console.log(`      ${fact}`);
    for (const script of placed.scripts)
      console.log(
        script.state === "replaces"
          ? `replaces  ${script.name}`
          : script.state === "named"
            ? `new       ${script.name}: named by ${script.by[0]}${script.by.length > 1 ? ` and ${script.by.length - 1} more` : ""}`
            : `UNNAMED   ${script.name}`,
      );
  }
  for (const warning of placed.warnings) console.log(`WARN  ${warning}`);
  return placed.warnings.length;
}
/**
 * The scripts of some folders placed against a profile's pack, with the maps that may name them; `only`:
 * the maps looked at, when a script named by nothing is to be warned of only when it is theirs.
 */
function placeScripts(mod, folders, mapFiles, shippedFolder, only) {
  const pack = mod.scriptPack;
  const ours = new Map();
  for (const folder of folders) for (const [name, script] of pack.loose(folder)) ours.set(name, script);
  const given = mapFiles.map(mapForScripts);
  return maps.scriptsPlaced({
    ours,
    shipped: pack.shipped(shippedFolder),
    maps: given,
    rules: pack,
    mapNames: [...(pack.maps?.() ?? []), ...given.map((map) => map.name)],
    ...(only ? { only } : {}),
  });
}
/**
 * scripts: folders of scripts of one's own against the scripts the game ships: which take a game script's
 * place, which are new and named by a map or a script, which are named by nothing. The rest of the words
 * are more folders, and maps (.bsp or .map) whose entities may name a script.
 */
async function scripts({ command, file, rest, flags, listed }) {
  const mod = (await profileOf(flags, listed)) ?? fail(`${command}: --mod <profile>: how a game names its scripts is its profile's`); // prettier-ignore
  if (!mod.scriptPack) fail(`${command}: the profile ${mod.name} has no \`scriptPack\`: it says nothing of scripts`);
  const words = [file, ...rest];
  const mapFiles = words.filter((word) => /\.(bsp|map)$/i.test(word)).map(existing);
  const folders = words.filter((word) => !/\.(bsp|map)$/i.test(word));
  for (const folder of folders)
    if (!existsSync(folder) || !statSync(folder).isDirectory()) fail(`${command}: no such folder: ${folder}`);
  const shipped = flags.shipped === undefined ? undefined : existingFolder(flags.shipped);
  const placed = placeScripts(mod, folders, mapFiles, shipped);
  if (flags.json) console.log(JSON.stringify(placed, null, 2));
  else {
    const warned = sayScripts(placed);
    console.log(warned ? `${warned} warnings` : "every script of ours replaces one of the game's or is named");
  }
  process.exit(0);
}

// ── the two pages ──────────────────────────────────────────────────────────
// Both keep running until the process is stopped.
const forever = () => new Promise(() => {});
async function view({ file, rest, flags }) {
  const { view: startViewer } = await import("../viewer/serve.mjs");
  for (const root of rest) if (!existsSync(root)) fail(`no such file: ${root}`);
  await startViewer([file, ...rest], numberOf(flags, "port") || VIEWER_PORT);
  await forever();
}
async function edit({ file, flags }) {
  const { serve } = await import("../editor/serve.mjs");
  await serve(file, {
    port: numberOf(flags, "port") || EDITOR_PORT,
    work: flags.work,
    engine: flags.engine,
  });
  await forever();
}

// ── the MCP server ─────────────────────────────────────────────────────────
/** mcp: the kit as an MCP server on stdin and stdout, until the client closes stdin (see mcp/README.md). */
async function mcp({ flags }) {
  const { start } = await import("../mcp/server.mjs");
  try {
    await start({ models: flags.models, work: flags.work, run: flags.run !== false });
  } catch (error) {
    fail(`mcp: ${error.message}`);
  }
  process.exit(0);
}

// ── maps ───────────────────────────────────────────────────────────────────
// A map command reads its own file: a compiled map (.bsp), brush source (.map) or a texture file (.wad).
const { maps } = smak;

/** A flag's value as `count` numbers with commas between (`--from 96,96,40`); undefined when not given. */
function numbersOf(flags, name, count, what) {
  const value = flags[name];
  if (value === undefined) return undefined;
  const numbers = String(value)
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (numbers.length !== count || !numbers.every(Number.isFinite)) fail(`--${name}: ${what}, not ${value}`);
  return numbers;
}
/** Whether a file is brush source (a .map) and not a compiled map. */
const isSource = (file) => /\.map$/i.test(file);
/** A compiled map read: `{ bytes, bsp }`. */
function readCompiled(file) {
  const bytes = readFileSync(file);
  return { bytes, bsp: maps.readBsp(bytes) };
}
/** A folder a flag names, or the command stopped. */
function existingFolder(folder) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) fail(`--game: no such folder: ${folder}`);
  return folder;
}
/**
 * Where a map's .wad files are looked for: the folders given with --game (the mod's own, then valve), then
 * the map's own folder.
 */
const gameFolders = (file, listed) => [...(listed.game ?? []).map(existingFolder), ...maps.mapOwnFolders(file)];
/** The textures of the .wad files given with --wad. */
const wadTextures = (listed) =>
  (listed.wad ?? []).flatMap((wad) => maps.readWad(readFileSync(existing(wad))).textures);
/** A texture's name as a file's: itself, but for what a file system refuses. */
const pictureNameOf = (name) => name.replace(/[\\/:*?"<>|]/g, "_");
/** A point as the lists print it. */
const placeText = (point) => point.map((value) => Math.round(value * 100) / 100).join(" ");

/** What the map pictures are asked for, from the flags; a wrong one stops the command. */
function pictureOptions(file, flags, listed) {
  if (flags.light !== undefined && flags.light !== false && !LIGHTS.includes(flags.light))
    fail(`--light: ${LIGHTS.join(" or ")} (or --no-light), not ${flags.light}`);
  if (flags.entities !== undefined && flags.entities !== false && !MARKED.includes(flags.entities))
    fail(`--entities: ${MARKED.join(", ")} (or --no-entities), not ${flags.entities}`);
  const options = defined({
    folders: gameFolders(file, listed),
    textures: wadTextures(listed),
    width: numberOf(flags, "width"),
    height: numberOf(flags, "height"),
    brightness: numberOf(flags, "brightness"),
    light: flags.light,
    entities: flags.entities === "none" ? false : flags.entities,
    labels: flags.labels,
    // the sky's picture and the sprites are drawn where the --game folders have them, unless told not to
    sky: flags.sky === false ? false : numbersOf(flags, "sky", 3, "three numbers r,g,b"),
    sprites: flags.sprites === false ? false : undefined,
    modelScale: flags["model-scale"] === false ? false : undefined,
  });
  for (const name of ["width", "height"])
    if (name in options && !(Number.isInteger(options[name]) && options[name] >= 16 && options[name] <= 4096))
      fail(`--${name}: a whole number from 16 to 4096, not ${options[name]}`);
  if ("brightness" in options && !(options.brightness > 0))
    fail(`--brightness: a number over 0, not ${options.brightness}`);
  return options;
}
/** An entity as a flag names it: its number, or a classname or a targetname. */
const entityName = (word) => (/^\d+$/.test(word) ? Number(word) : word);
/** `name=value` flags given several times, as one object; one that is not `name=value` stops the command. */
function namedValues(listed, flag, what) {
  const values = {};
  for (const word of listed[flag] ?? []) {
    const equals = word.indexOf("=");
    if (equals < 1 || equals === word.length - 1) fail(`--${flag}: ${what}, not ${word}`);
    values[word.slice(0, equals)] = word.slice(equals + 1);
  }
  return values;
}
/**
 * How point entities are drawn at their true size, from the flags: `--body name=large` (the box a class or
 * a targetname moves with), `--models` (the models that are named are drawn, from the --game folders) and
 * `--model name=models/x.mdl` (the model of a class, a targetname or a scriptfile).
 */
function figureOptions(flags, listed) {
  const bodies = namedValues(listed, "body", "name=standing|large|crouching");
  for (const [name, body] of Object.entries(bodies))
    if (!Object.hasOwn(maps.BODIES, body) || body === "point")
      fail(`--body ${name}=${body}: standing, large or crouching`);
  const named = namedValues(listed, "model", "name=models/file.mdl");
  const models = Object.keys(named).length ? named : flags.models === true ? true : undefined;
  return defined({ bodies: Object.keys(bodies).length ? bodies : undefined, models });
}
/** What the walk test is asked for, from the flags; a wrong one stops the command. */
function reachOptions(flags, listed) {
  if (flags.doors !== undefined && !DOORS.includes(flags.doors))
    fail(`--doors: ${DOORS.join(" or ")}, not ${flags.doors}`);
  const jump = flags.jump === undefined || flags.jump === true ? flags.jump : numberOf(flags, "jump");
  const cell = numberOf(flags, "cell");
  if (cell !== undefined && !(cell >= 1)) fail(`--cell: the grid in units, 1 at the least, not ${cell}`);
  const { bodies } = figureOptions(flags, listed);
  const speed = numberOf(flags, "speed");
  const gravity = numberOf(flags, "gravity");
  for (const [name, value] of Object.entries({ speed, gravity }))
    if (value !== undefined && !(value > 0)) fail(`--${name}: a number over 0, not ${value}`);
  if (flags.walls !== undefined && flags.walls !== "standing" && flags.walls !== "gone")
    fail(`--walls: standing or gone, not ${flags.walls}`);
  return defined({
    bodies,
    from: listed.start?.map(entityName),
    to: listed.goal?.map(entityName),
    open: listed.open?.map(entityName),
    shut: listed.shut?.map(entityName),
    exits: listed.exit?.map(entityName),
    doors: flags.doors,
    walls: flags.walls,
    parts: flags.parts === false ? false : undefined,
    jump,
    speed,
    gravity,
    slopes: flags.slopes === false ? false : undefined,
    cell,
  });
}
/** A map read for a picture or a test: brush source from a .map, a compiled map from anything else. */
const readEither = (file) =>
  isSource(file) ? maps.readMap(readFileSync(file, "utf8")) : readCompiled(file).bsp;
/** A picture saved, and its line printed with what it shows; then its notes, a line each. */
function savePicture(to, picture, shows) {
  save(to, smak.png(picture.width, picture.height, picture.rgba));
  console.log(`${to}  ${picture.width}x${picture.height}  ${shows}`);
  for (const note of picture.facts.notes ?? []) console.log(`      ${note}`);
}

// ── map-info, map-check ────────────────────────────────────────────────────
/** Everything `map-info` tells of a map, as `--json` prints it. */
function describeMap(file, bytes, bsp) {
  const world = maps.worldBounds(bsp);
  const wanted = maps.wantedTextures(bsp);
  const classes = {};
  for (const entity of bsp.entities) {
    const classname = maps.valueOf(entity, "classname") ?? "(no classname)";
    classes[classname] = (classes[classname] ?? 0) + 1;
  }
  const styles = new Set();
  for (const face of bsp.faces)
    if (maps.hasLightmap(bsp, face)) for (const style of face.styles) if (style !== 255) styles.add(style);
  const world0 = bsp.entities[0] ?? [];
  return {
    file,
    bytes: bytes.length,
    version: bsp.format === "bsp2" ? "BSP2" : bsp.version, // Xash's BSP2: its header's letters
    title: maps.valueOf(world0, "maptitle") ?? maps.valueOf(world0, "message") ?? "",
    bounds: world,
    lumps: Object.fromEntries(
      maps.LUMP_NAMES.map((name) => {
        const size = maps.entrySizesOf(bsp.format)[name];
        const entries = size ? bsp.lumps[name].length / size : undefined;
        return [name, defined({ bytes: bsp.lumps[name].length, entries })];
      }),
    ),
    entities: bsp.entities.length,
    brushEntities: bsp.models.length - 1,
    classes,
    textures: bsp.textures.map((texture) => ({
      name: texture.name,
      width: texture.width,
      height: texture.height,
      inside: Boolean(texture.embedded),
    })),
    wads: wanted.wads,
    light: { bytes: bsp.lumps.lighting.length, styles: [...styles].sort((a, b) => a - b) },
    visibility: bsp.lumps.visibility.length,
  };
}
function mapInfo({ file, flags }) {
  const { bytes, bsp } = readCompiled(file);
  const data = describeMap(file, bytes, bsp);
  if (flags.json) {
    console.log(JSON.stringify(data, null, 1));
    return;
  }
  const pad = (value, width) => String(value).padStart(width);
  const { mins, maxs } = data.bounds;
  const size = maxs.map((value, axis) => Math.round(value - mins[axis])).join(" x ");
  console.log(
    `${file}: a GoldSrc map (version ${data.version}), ${data.bytes} bytes${data.title ? `, "${data.title}"` : ""}`,
  );
  console.log(`the world: from ${placeText(mins)} to ${placeText(maxs)} (${size} units; +z is up)`);

  console.log("\nLUMPS");
  for (const [name, lump] of Object.entries(data.lumps))
    console.log(
      `  ${name.padEnd(14)} ${pad(lump.bytes, 9)} bytes${lump.entries === undefined ? "" : ` ${pad(lump.entries, 7)}`}`,
    );

  console.log(
    `\nENTITIES (${data.entities}): ${data.brushEntities} of them made of brushes   map-entities lists them, each with its number`,
  );
  const commonest = Object.entries(data.classes).sort((a, b) => b[1] - a[1]);
  for (const [classname, count] of commonest) console.log(`  ${pad(count, 5)} ${classname}`);

  const inside = data.textures.filter((texture) => texture.inside).length;
  console.log(
    `\nTEXTURES (${data.textures.length}): ${inside} with their pixels inside the map, ${data.textures.length - inside} wanted from .wad files`,
  );
  for (const texture of data.textures)
    console.log(
      `  ${texture.name.padEnd(16)} ${`${texture.width}x${texture.height}`.padEnd(9)} ${texture.inside ? "inside" : "WANTED from a .wad"}`,
    );
  if (data.wads.length) console.log(`  the worldspawn lists: ${data.wads.join(", ")}`);

  console.log(
    data.light.bytes
      ? `\nLIGHT  ${data.light.bytes} bytes, baked; styles ${data.light.styles.join(" ")}   (0 always on, 1 to 31 flicker, 32 and up are switched)`
      : "\nLIGHT  none: the map was not passed through hlrad, and is drawn fully bright",
  );
  console.log(
    data.visibility
      ? `VISIBILITY  ${data.visibility} bytes`
      : "VISIBILITY  none: the whole map is drawn from everywhere (a leak, or no hlvis)",
  );
}
/**
 * The mod's profile a command is given with --mod: `goldsrc` for the kit's own, or a profile's file (.mjs or
 * .json), which is handed the --game folders, the --cache file and the --scripts folders. Undefined without
 * the flag.
 */
async function profileOf(flags, listed) {
  if (flags.mod === undefined) return undefined;
  const folders = (listed.game ?? []).map(existingFolder);
  if (flags.mod === "goldsrc") return { ...maps.GOLDSRC, folders };
  // one of the kit's profiles by name (ts, msc), or a profile's file
  const named = maps.mapProfileOf(flags.mod);
  const file = named?.file ?? (existsSync(flags.mod) || !/^[\w-]+$/.test(flags.mod) ? existing(flags.mod) : fail(`--mod: a profile's file, goldsrc, or one of the kit's: ${Object.keys(maps.MAP_PROFILES).join(", ")}; not ${flags.mod}`)); // prettier-ignore
  const given = defined({ folders: folders.length ? folders : undefined, kind: flags.kind, cache: flags.cache, scripts: listed.scripts }); // prettier-ignore
  let mod;
  try {
    mod = await maps.loadMod(file, given);
  } catch (error) {
    // a profile made from the installed game, with no --game: the Half-Life folder found on this machine
    // (SMAK_HALF_LIFE, or Steam's libraries), or what the profile said
    const game = folders.length ? null : maps.findHalfLife({ mod: named?.folder });
    if (!game) throw error;
    mod = await maps.loadMod(file, { ...given, game });
  }
  return !mod.folders.length && folders.length ? { ...mod, folders } : mod;
}
/** The entity definitions given by name: .fgd files (--fgd) and what map-learn wrote (--learned). */
function definitionsGiven(listed) {
  const given = [
    ...(listed.fgd ?? []).map(existing),
    ...(listed.learned ?? []).map((file) => JSON.parse(readFileSync(existing(file), "utf8"))),
  ];
  return given.length ? given : undefined;
}
/**
 * map-check: a compiled map against an engine, or brush source before a compile; with a mod's profile or
 * entity definitions, its entities against the mod too.
 */
async function mapCheck({ file, flags, listed }) {
  const engine = flags.engine ?? "goldsrc";
  const folders = listed.game ? gameFolders(file, listed) : undefined;
  const against = defined({ mod: await profileOf(flags, listed), definitions: definitionsGiven(listed) });
  const source = isSource(file);
  const textures = listed.wad?.flatMap((wad) => maps.wadTextureNames(readFileSync(existing(wad))));
  const report = source
    ? maps.checkPlan(maps.readMap(readFileSync(file, "utf8")), defined({ ...against, folders, textures }))
    : maps.checkBsp(readFileSync(file), { engine, folders, ...against });
  const facts = report.facts.map((fact) => `      ${fact}`);
  const warnings = report.warnings.map((warning) => `WARN  ${warning}`);
  const errors = report.errors.map((error) => `ERROR ${error}`);
  // the script folders given, against the game's pack: one of ours that replaces nothing and is named by
  // nothing is laid over the pack for no one (`smak scripts` lists them all). Of this map's own only, unless
  // --all: a script of another map is named by that map, which is not looked at here
  const scripted = [];
  if (listed.scripts?.length && against.mod?.scriptPack) {
    const only = flags.all === true ? undefined : [mapForScripts(file).name];
    const placed = placeScripts(against.mod, listed.scripts, [file], flags.shipped && existingFolder(flags.shipped), only); // prettier-ignore
    scripted.push(...placed.facts.slice(1).map((fact) => `      ${fact}`), ...placed.warnings.map((warning) => `WARN  ${warning}`)); // prettier-ignore
  }
  const unnamed = scripted.filter((line) => line.startsWith("WARN")).length;
  const warned = report.warnings.length + unnamed ? `, with ${report.warnings.length + unnamed} warnings` : "";
  const fitFor = source ? "to compile" : `for ${engine}`;
  answered("map-check", file, flags, {
    detail: [...facts, ...warnings, ...errors, ...scripted],
    passed: !report.errors.length,
    said: report.errors.length ? `${report.errors.length} errors: not fit ${fitFor}` : `fit ${fitFor}${warned}`,
    shown: [...errors, ...warnings, ...scripted.filter((line) => line.startsWith("WARN"))],
  });
  process.exit(report.errors.length ? 1 : 0);
}
/**
 * map-learn: what a mod's own maps say of its entities, written to a file that --learned and a profile's
 * `definitions` take. --class prints one class's keys.
 */
function mapLearn({ command, file, flags }) {
  if (!statSync(file).isDirectory())
    fail(`${command}: the folder of a mod's .bsp files (<mod>/maps), not a file`);
  const to = need(command, flags.o, "-o learned.json");
  const started = Date.now();
  const learned = maps.learnEntities(file);
  if (!learned.maps) fail(`${command}: no GoldSrc map (.bsp) in ${file}`);
  save(to, JSON.stringify(learned));
  const classes = Object.entries(learned.classes).sort((a, b) => b[1].seen - a[1].seen);
  console.log(
    `${to}  ${learned.maps} maps, ${classes.length} classes, read in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  for (const name of learned.skipped) console.log(`      ${name} is not a GoldSrc map: passed over`);
  const one = typeof flags.class === "string" ? learned.classes[flags.class] : null;
  if (typeof flags.class === "string" && !one)
    fail(`${command}: no ${flags.class} in any of the ${learned.maps} maps`);
  if (one) {
    console.log(
      `${flags.class}: ${one.seen} in ${one.maps} maps (${one.in.join(", ")}...), ${one.point} as a point and ${one.solid} of brushes`,
    );
    if (one.always.length) console.log(`      every one gives: ${one.always.join(", ")}`);
    for (const group of one.together) console.log(`      always together: ${group.join(", ")}`);
    for (const [key, has] of Object.entries(one.keys).sort((a, b) => b[1].seen - a[1].seen))
      console.log(
        `${String(has.seen).padStart(6)}  ${key.padEnd(18)} ${has.values.map(([value, times]) => `"${value}" x${times}`).join("  ")}${has.more ? "  ..." : ""}`,
      );
    return;
  }
  const kindOf = (has) =>
    has.kind === "either"
      ? `${has.point} points, ${has.solid} of brushes`
      : has.kind === "solid"
        ? "of brushes"
        : "a point";
  for (const [name, has] of classes.slice(0, flags.all ? classes.length : MARKS_PRINTED))
    console.log(
      `${String(has.seen).padStart(6)}  ${name.padEnd(28)} in ${String(has.maps).padStart(3)} maps  ${kindOf(has)}`,
    );
  if (!flags.all && classes.length > MARKS_PRINTED)
    console.log(
      `      and ${classes.length - MARKS_PRINTED} more (--all); --class <name> lists one class's keys`,
    );
}

// ── map-entities, map-set ──────────────────────────────────────────────────
function mapEntities({ file, flags }) {
  const { bsp } = readCompiled(file);
  const numbered = bsp.entities.map((entity, number) => ({ number, entity }));
  const wanted = numbered.filter(
    ({ entity }) => flags.class === undefined || maps.valueOf(entity, "classname") === flags.class,
  );
  if (flags.json) {
    const list = wanted.map(({ number, entity }) => ({
      number,
      classname: maps.valueOf(entity, "classname") ?? null,
      origin: maps.originOf(entity),
      model: maps.brushModelOf(entity),
      pairs: entity,
    }));
    console.log(JSON.stringify(list, null, 1));
    return;
  }
  const wide = Math.max(9, ...wanted.map(({ entity }) => (maps.valueOf(entity, "classname") ?? "").length));
  for (const { number, entity } of wanted) {
    const classname = maps.valueOf(entity, "classname") ?? "(no classname)";
    const origin = maps.originOf(entity);
    const model = maps.brushModelOf(entity);
    const place = model !== null && number ? `brushes *${model}` : origin ? `at ${placeText(origin)}` : "";
    const others = entity
      .filter(
        ([key]) => !["classname", "origin", "model"].includes(key) || (key === "model" && model === null),
      )
      .map(([key, value]) => `${key}=${/\s/.test(value) ? `"${value}"` : value}`)
      .join(" ");
    console.log(`${String(number).padStart(4)}  ${classname.padEnd(wide)}  ${place.padEnd(22)} ${others}`);
  }
  const ofClass = flags.class === undefined ? "" : ` of the class ${flags.class}`;
  console.log(`${wanted.length} entities${ofClass}, of ${bsp.entities.length} in the map`);
}
/** The number of the entity a flag names: a number, or a class that one entity alone has. */
function entityNumber(flag, value, entities) {
  if (/^\d+$/.test(String(value))) {
    if (Number(value) >= entities.length)
      fail(`--${flag}: no entity ${value}: the map has ${entities.length}, numbered from 0`);
    return Number(value);
  }
  const ofClass = entities
    .map((entity, number) => ({ number, classname: maps.valueOf(entity, "classname") }))
    .filter((each) => each.classname === value);
  if (ofClass.length !== 1)
    fail(
      ofClass.length
        ? `--${flag} ${value}: the map has ${ofClass.length} of that class (${ofClass.map((each) => each.number).join(", ")}): give the number`
        : `--${flag} ${value}: the map has no entity of that class (map-entities lists them)`,
    );
  return ofClass[0].number;
}
/** The `key=value` words of a command line as pairs; a word that is not one stops the command. */
function pairsOf(command, words) {
  return words.map((word) => {
    const equals = word.indexOf("=");
    if (equals < 1) fail(`${command}: ${word} is not key=value`);
    return [word.slice(0, equals), word.slice(equals + 1)];
  });
}
/**
 * map-set: one change to a compiled map's entities, written to a new file: keys of one entity set (and its
 * place moved), an entity added, or one taken out.
 */
function mapSet({ command, file, rest, flags }) {
  const to = need(command, flags.o, "-o out.bsp");
  if (resolve(to) === resolve(file))
    fail(`${command}: -o is the map itself: write to a new file, never over the original`);
  const asked = ["entity", "add", "remove"].filter((name) => flags[name] !== undefined);
  if (asked.length !== 1)
    fail(
      `${command}: one of --entity <n|class> key=value ..., --add <class> [--at x,y,z] key=value ..., --remove <n|class>`,
    );
  const pairs = pairsOf(command, rest);
  const move = numbersOf(flags, "move", 3, "three numbers x,y,z");
  const at = numbersOf(flags, "at", 3, "three numbers x,y,z");
  const { bytes, bsp } = readCompiled(file);
  let entities = bsp.entities;
  let said;
  if (flags.entity !== undefined) {
    const number = entityNumber("entity", flags.entity, entities);
    if (!pairs.length && !move && flags.unset === undefined)
      fail(`${command}: nothing to change: give key=value, --move x,y,z or --unset key`);
    const changes = [];
    for (const [key, value] of pairs) {
      changes.push(`${key} ${maps.valueOf(entities[number], key) ?? "(not set)"} -> ${value}`);
      entities = maps.setKey(entities, number, key, value);
    }
    if (flags.unset !== undefined) {
      entities = maps.removeKey(entities, number, flags.unset);
      changes.push(`${flags.unset} taken out`);
    }
    if (move) {
      changes.push(
        `moved from ${maps.valueOf(entities[number], "origin") ?? "(no origin)"} to ${placeText(move)}`,
      );
      entities = maps.moveEntity(entities, number, move);
    }
    said = `entity ${number} (${maps.valueOf(entities[number], "classname")}): ${changes.join("; ")}`;
  } else if (flags.add !== undefined) {
    entities = maps.addEntity(entities, flags.add, at ?? null, pairs);
    said = `entity ${entities.length - 1} added: ${flags.add}${at ? ` at ${placeText(at)}` : ""}`;
  } else {
    const number = entityNumber("remove", flags.remove, entities);
    const classname = maps.valueOf(entities[number], "classname");
    entities = maps.removeEntity(entities, number);
    said = `entity ${number} (${classname}) taken out: those after it are numbered one less`;
  }
  save(to, maps.withEntities(bytes, entities));
  console.log(`${to}: ${said}`);
  console.log(
    "      the light, the visibility and the brushes are as compiled: only what the game reads when it runs has changed",
  );
}

// ── pictures of a map ──────────────────────────────────────────────────────
async function mapPlan({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  const area = numbersOf(flags, "area", 4, "four numbers x0,y0,x1,y1");
  const options = {
    ...pictureOptions(file, flags, listed),
    ...figureOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed) }),
    ...defined({
      z: numberOf(flags, "z"),
      scale: numberOf(flags, "scale"),
      slice: flags.slice,
      area: area && { min: [area[0], area[1]], max: [area[2], area[3]] },
      heights: flags.heights === true ? true : undefined,
      legend: flags.legend === true ? true : undefined,
    }),
  };
  const map = readEither(file);
  if (flags.reach === true) options.reach = maps.reachOf(map, { ...reachOptions(flags, listed), ...defined({ mod: options.mod }) }); // prettier-ignore
  const picture = isSource(file) ? maps.planOfSource(map, options) : maps.planOf(map, options);
  const { facts } = picture;
  const scale = Math.round(facts.scale * 1000) / 1000;
  const cut = facts.z === null ? "seen from above" : `cut at z ${facts.z}`;
  savePicture(
    to,
    picture,
    `${scale} pixels a unit, ${cut}; +y is up the picture and +x to its right; the bar is ${facts.bar} units`,
  );
  const shown = facts.marks.length > MARKS_PRINTED && !flags.list ? [] : facts.marks;
  for (const mark of shown)
    console.log(
      `${String(mark.number).padStart(4)}  ${mark.classname.padEnd(22)} ${placeText(mark.origin).padEnd(18)} at pixel ${mark.at.join(",")}`,
    );
  if (!shown.length && facts.marks.length)
    console.log(`      ${facts.marks.length} entities marked: --list prints each with its pixel`);
}
/** Where a view is taken from, from the flags: a point, or an entity. */
function standOf(flags, map) {
  const from = numbersOf(flags, "from", 3, "three numbers x,y,z");
  const to = numbersOf(flags, "to", 3, "three numbers x,y,z");
  if (from && flags.at !== undefined) fail("--from and --at both say where the eye is: give one");
  const stand = flags.at === undefined ? {} : maps.viewFrom(map, flags.at);
  return {
    ...stand,
    ...defined({
      from,
      to,
      yaw: numberOf(flags, "yaw"),
      pitch: numberOf(flags, "pitch"),
      fov: numberOf(flags, "fov"),
    }),
  };
}
async function mapView({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  const options = {
    ...pictureOptions(file, flags, listed),
    ...figureOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed) }),
  };
  const source = isSource(file);
  const map = readEither(file);
  const stand = standOf(flags, map);
  const picture = source
    ? maps.drawSource(map, { ...options, ...stand })
    : maps.drawMap(map, { ...options, ...stand });
  const { facts } = picture;
  savePicture(
    to,
    picture,
    `from ${placeText(facts.from)}, yaw ${facts.yaw}, pitch ${facts.pitch}, ${facts.fov} degrees across; ${facts.faces} faces; light: ${facts.light}`,
  );
  for (const mark of facts.marked.slice(0, MARKS_PRINTED))
    console.log(
      `      marked: ${mark.number} ${mark.classname} at pixel ${mark.at.join(",")}${mark.drawn === "mark" ? "" : `, its ${mark.drawn} ${mark.size}`}`,
    );
}
async function mapViews({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  if (isSource(file)) fail(`${command}: a compiled map (.bsp): of source, map-view and map-plan draw`);
  const options = {
    ...pictureOptions(file, flags, listed),
    ...figureOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed) }),
    ...defined({ count: numberOf(flags, "count"), cols: numberOf(flags, "cols") }),
    ...(flags.aim ? { aim: true } : {}),
    ...defined({ landmark: typeof flags.landmark === "string" ? flags.landmark : undefined }),
  };
  for (const name of ["count", "cols"])
    if (name in options && !(Number.isInteger(options[name]) && options[name] >= 1))
      fail(`--${name}: a whole number from 1, not ${options[name]}`);
  const { bsp } = readCompiled(file);
  if (flags["each-door"]) {
    // each door from both its sides at a standing player's eye, in sheets of --count (24) views: to.png, to-2.png, ...
    const only = flags["each-door"] === true ? undefined : String(flags["each-door"]).split(",");
    const stands = maps.doorViews(bsp, defined({ mod: options.mod, doors: only }));
    if (!stands.length) fail(`${command} --each-door: the map has no door with a place to stand before it`);
    const per = options.count ?? 24;
    for (let i = 0; i < stands.length; i += per) {
      const sheet = i ? to.replace(/(.png)?$/i, `-${i / per + 1}.png`) : to;
      const picture = maps.viewsOf(bsp, { ...options, at: stands.slice(i, i + per) });
      savePicture(sheet, picture, `${picture.facts.views.length} views of doors, ${i + 1} to ${i + picture.facts.views.length} of ${stands.length}`); // prettier-ignore
    }
    return;
  }
  const picture = maps.viewsOf(bsp, options);
  savePicture(to, picture, `${picture.facts.views.length} views; light: ${picture.facts.light}`);
  for (const view of picture.facts.views)
    console.log(`      ${view.name}, from ${placeText(view.from)}: ${view.faces} faces`);
}

/**
 * A map's dressing beside Valve's own (src/maps/dressing.mjs): a compiled map's walls, textures, lamps and floor
 * light; its source's brush roles (a .map, or `--source` beside a .bsp); `--against` another compiled map, its
 * numbers beside. `--json`: the rows.
 */
async function mapDressing({ command, file, rest, flags, listed }) {
  if (flags.learn) {
    // the bands of a folder of maps (or several maps), for a profile's `dressing` or --against
    const to = need(command, flags.o, "-o dressing.json");
    const files = [file, ...(rest ?? [])].flatMap((each) => {
      if (!existsSync(each)) fail(`no such file: ${each}`);
      return statSync(each).isDirectory() ? readdirSync(each).filter((name) => /\.bsp$/i.test(name)).sort().map((name) => join(each, name)) : [each]; // prettier-ignore
    });
    if (!files.length) fail(`${command}: no .bsp in ${[file, ...(rest ?? [])].join(", ")}`);
    const list = files.map((each) => ({ name: basename(each).replace(/\.bsp$/i, ""), measures: maps.measureDressing(readCompiled(each).bsp).measures })); // prettier-ignore
    const learned = maps.learnDressing(list, defined({ name: typeof flags.as === "string" ? flags.as : undefined, of: typeof flags.from === "string" ? flags.from : undefined })); // prettier-ignore
    save(to, `${JSON.stringify(learned, null, 1)}\n`);
    console.log(`${to}: the dressing of ${list.length} maps, [least (5th in 100), lower quartile, median, upper quartile, most (95th)] each`); // prettier-ignore
    for (const [key, band] of Object.entries(learned.measures)) console.log(`      ${key.padEnd(16)} ${[band.least, band.q1, band.median, band.q3, band.most].join("  ")}`); // prettier-ignore
    return;
  }
  if (isSource(file)) {
    const roles = maps.dressingOfSource(maps.readMap(readFileSync(existing(file), "utf8")));
    for (const [key, v] of Object.entries(roles)) console.log(`${key}: ${v === null ? "not measured" : key === "brushes" ? v : `${Math.round(v * 100)}%`}`);
    console.log("the face measures (walls, textures, lamps, light) are of a compiled map: compile it, and give the .bsp");
    return;
  }
  const source = typeof flags.source === "string" ? maps.readMap(readFileSync(existing(flags.source), "utf8")) : null;
  // the bands: a learned file's (--against x.json), the profile's own (--mod), else Valve's
  const learned = typeof flags.against === "string" && /\.json$/i.test(flags.against);
  const bands = learned ? JSON.parse(readFileSync(existing(flags.against), "utf8")) : (await profileOf(flags, listed))?.dressing; // prettier-ignore
  const mine = maps.dressingOf(readCompiled(file).bsp, defined({ source, against: bands }));
  const theirs = typeof flags.against === "string" && !learned ? maps.dressingOf(readCompiled(flags.against).bsp, defined({ against: bands })) : null; // prettier-ignore
  if (flags.json) return console.log(JSON.stringify({ rows: mine.rows, against: theirs?.rows ?? null }, null, 1));
  for (const line of mine.facts) console.log(line);
  for (const line of mine.warnings) console.log(`WARNING ${line}`);
  if (theirs) for (const row of theirs.rows) console.log(`  ${flags.against}: ${row.key} ${row.value}`);
}

function mapHeights({ command, file, flags }) {
  const dir = need(command, flags.o, "-o <folder>");
  const { bsp } = readCompiled(file);
  const cell = flags.cell === undefined ? 16 : numberOf(flags, "cell");
  const { legend, layers } = heightPlanOf(bsp, { cell, pixels: flags.pixels === undefined ? 4 : numberOf(flags, "pixels") });
  mkdirSync(dir, { recursive: true });
  layers.forEach(({ floor, room }, L) => {
    writeFileSync(join(dir, `floor-${L}.png`), smak.png(floor.width, floor.height, floor.rgba));
    writeFileSync(join(dir, `room-${L}.png`), smak.png(room.width, room.height, room.rgba));
  });
  writeFileSync(join(dir, "legend.json"), `${JSON.stringify(legend, null, 1)}\n`);
  console.log(`${dir}: ${legend.layers} layers of ${legend.width} x ${legend.height} cells of ${legend.cell} units (floor-N.png the floor's height, room-N.png the headroom over it; legend.json says which colour is which, and where the world's x0 and y1 are)`);
  console.log(`      ${legend.heights.length} floor heights from ${legend.heights[0]?.h} to ${legend.heights.at(-1)?.h}; read back by a map spec's floorplan: { dir }`);
}

function mapFgd({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o mod.fgd");
  // the program first, so that what an FGD says of a key (its choices, its labels) stands over the code's type
  const parts = [];
  const code = file ? maps.definitionsOfCode(existingFolder(file)) : null;
  if (code) parts.push(code);
  if (listed.dll?.length) parts.push(maps.definitionsOfDll(listed.dll.map(existing)));
  if (flags.maps) parts.push(maps.learnEntities(existingFolder(flags.maps)));
  if (listed.fgd?.length) parts.push(maps.definitionsOf(listed.fgd.map(existing)));
  if (!parts.length) fail(`${command}: the mod's source folder (dlls), or --fgd, --maps or --dll`);
  const all = maps.joinDefinitions(parts);
  const text = maps.writeFgd(all, { name: flags.name ?? basename(resolve(file ?? flags.maps ?? ".")) });
  save(to, text);
  const written = Object.keys(maps.definitionsOf(maps.readFgd(text)).classes).length;
  console.log(`${to}  ${written} classes, from ${all.from.join(", ")}`);
  for (const line of text.split("\n").slice(1, 3)) if (line.startsWith("// ")) console.log(`      ${line.slice(3)}`);
  for (const sentence of code?.unread ?? []) console.log(`WARN  ${sentence}`);
  // what the code reads that the FGDs given do not name: the keys a mapper cannot see in the editor
  const fgd = parts.find((part) => part.fgd);
  if (code && fgd) {
    const lacking = [];
    for (const [name, c] of Object.entries(code.classes)) {
      const f = fgd.classes[name];
      if (!f) continue;
      const keys = Object.entries(c.keys).filter(([key, k]) => !k.engine && !f.keys[key]).map(([key]) => key);
      if (keys.length) lacking.push(`${name}: ${keys.join(" ")}`);
    }
    if (lacking.length) console.log(`      ${lacking.length} classes have keys the code reads and the FGD given does not name (now written):`);
    for (const line of lacking.slice(0, flags.all ? lacking.length : MARKS_PRINTED)) console.log(`        ${line}`);
  }
}
async function contractCommand({ file, flags }) {
  const { contractOf, compareContract } = await import("../src/contract.mjs");
  const made = contractOf(readModelWithTextures(file));
  if (flags.against) {
    const { faults, notes } = compareContract(contractOf(readModelWithTextures(existing(flags.against))), made);
    for (const f of faults) console.log(`FAULT ${f}`);
    for (const n of notes) console.log(`note  ${n}`);
    if (!faults.length) console.log(`${basename(file)} keeps the contract of ${basename(flags.against)}`);
    if (faults.length) process.exit(1);
    return;
  }
  if (flags.json) return console.log(JSON.stringify(made, null, 2));
  console.log(`BONES (${made.bones.length}): ${made.bones.join(", ")}`);
  console.log(`ANIMATIONS (${made.sequences.length}), by number: ${made.sequences.map((s, i) => `${i} ${s.name}${s.activity ? ` (activity ${s.activity})` : ""}`).join(", ")}`);
  console.log(`ATTACHMENTS (${made.attachments.length}): ${made.attachments.map((a, i) => `${i} on ${a.bone}`).join(", ")}`);
  console.log(`BODYPARTS: ${made.bodyparts.map((b) => `${b.name} (${b.bodies} bodies)`).join(", ")}`);
  console.log(`HIT GROUPS: ${made.hitgroups.join(", ") || "none"}; CONTROLLERS: ${made.controllers.map((c) => c.bone).join(", ") || "none"}`);
}
/** A model read with its <name>t.mdl textures, as the other model commands read it. */
const readModelWithTextures = (file) => smak.readStudio(file).src;

/**
 * video: a smak.video/1 spec made into a video (MP4 with ffmpeg, a GIF without), or with --preview its contact
 * sheet only. Its models and maps are found in --models, or beside the spec; the map's textures in --wads.
 */
async function videoSpec({ command, file, flags, listed }) {
  const out = need(command, flags.o, "-o <folder>");
  mkdirSync(out, { recursive: true });
  const { toolsFor } = await import("../mcp/tools.mjs");
  const models = resolve(flags.models ?? dirname(resolve(file)));
  const folders = { work: resolve(out), models, wads: listed.wads ?? [] };
  const build = toolsFor(folders, { allowRun: false }).find((tool) => tool.name === "build");
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const answer = await build.call({ spec, preview: flags.preview === true });
  const said = answer.filter((piece) => piece.type === "text").map((piece) => piece.text).join("\n");
  answer
    .filter((piece) => piece.type === "image")
    .forEach((piece) => writeFileSync(join(out, `${spec.name}-sheet.png`), Buffer.from(piece.data, "base64")));
  console.log(said);
  if (!said.startsWith("OK")) process.exit(1);
}

// ── the walk test, the section, the storeys, the openings ──────────────────
/** An opening's size as a line prints it. */
const openingSize = (wide, high) => `${wide} wide, ${high === null ? "open above" : `${high} high`}`;
/** What the walk test found, printed: its facts, its openings and its warnings. */
function sayReach(reach) {
  for (const fact of reach.facts) console.log(`      ${fact}`);
  for (const opening of reach.openings.slice(0, MARKS_PRINTED))
    console.log(
      `      opening ${opening.number}  at ${placeText(opening.at)}  ${openingSize(opening.width, opening.height)}, across ${opening.across}${opening.fits.large ? "" : "  (closed to a large monster)"}`,
    );
  for (const warning of reach.warnings) console.log(`WARN  ${warning}`);
}
/**
 * map-reach: the walk test of a map. With -o, its plan with the walked floor tinted. Exit code 1 when an
 * entity a player goes to is not reached, or one stands in something solid.
 */
async function mapReach({ file, flags, listed }) {
  const map = readEither(file);
  const mod = await profileOf(flags, listed);
  const reach = maps.reachOf(map, { ...reachOptions(flags, listed), ...defined({ mod }) });
  const { walked: _walked, stands: _stands, ...plain } = reach;
  if (flags.json) console.log(JSON.stringify(plain, null, 1));
  else {
    console.log(`${file}: the walk test, on a grid of ${reach.cell}`);
    sayReach(reach);
  }
  if (flags.o) {
    const options = {
      ...pictureOptions(file, flags, listed),
      ...figureOptions(flags, listed),
      ...defined({ z: numberOf(flags, "z"), mod }),
      reach,
      heights: true,
      legend: true,
    };
    const picture = isSource(file) ? maps.planOfSource(map, options) : maps.planOf(map, options);
    if (flags.json) save(flags.o, smak.png(picture.width, picture.height, picture.rgba));
    else savePicture(flags.o, picture, "the plan, with the walk test tinted on it");
  }
  process.exit(reach.unreached.length || reach.stuck.length ? 1 : 0);
}
async function mapSection({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  const ends = `${command}: --from x,y and --to x,y, the two ends of the line`;
  const from = numbersOf(flags, "from", 2, "two numbers x,y") ?? fail(ends);
  const end = numbersOf(flags, "to", 2, "two numbers x,y") ?? fail(ends);
  if (flags.doors !== undefined && !DOORS.includes(flags.doors))
    fail(`--doors: ${DOORS.join(" or ")}, not ${flags.doors}`);
  const picture = maps.sectionOf(readEither(file), {
    from,
    to: end,
    ...figureOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed) }),
    ...defined({
      scale: numberOf(flags, "scale"),
      width: numberOf(flags, "width"),
      z: numbersOf(flags, "z", 2, "two numbers low,high"),
      near: flags.entities === false ? false : numberOf(flags, "near"),
      labels: flags.labels,
      heights: flags.heights,
      doors: flags.doors,
    }),
  });
  const { facts } = picture;
  savePicture(
    to,
    picture,
    `a section ${facts.length} units long, heights ${facts.z.map(Math.round).join(" to ")}, ${Math.round(facts.scale * 1000) / 1000} pixels a unit, seen looking yaw ${facts.looking}`,
  );
  const floors = facts.floors.filter((floor) => floor.to - floor.from >= 16);
  for (const floor of floors.slice(0, MARKS_PRINTED))
    console.log(`      floor at z ${floor.z}  from ${floor.from} to ${floor.to} along the line`);
  for (const mark of facts.marks.slice(0, MARKS_PRINTED))
    console.log(
      `${String(mark.number).padStart(4)}  ${mark.classname.padEnd(22)} ${mark.along} along the line, z ${mark.z}`,
    );
}
async function mapStoreys({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  const map = readEither(file);
  const cuts = flags.z === undefined ? undefined : String(flags.z).split(",").map(Number);
  if (cuts && !cuts.every(Number.isFinite)) fail(`--z: heights to cut at, a,b,c, not ${flags.z}`);
  const options = {
    ...pictureOptions(file, flags, listed),
    ...figureOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed) }),
    ...defined({ z: cuts, cols: numberOf(flags, "cols"), doors: flags.doors }),
  };
  if (flags.reach === true) options.reach = maps.reachOf(map, { ...reachOptions(flags, listed), ...defined({ mod: options.mod }) }); // prettier-ignore
  const picture = maps.storeysOf(map, options);
  savePicture(to, picture, `${picture.facts.storeys.length} storeys side by side, the highest first`);
  for (const storey of picture.facts.storeys)
    console.log(
      `      cut at z ${storey.z}${storey.floors ? `: floors from ${storey.floors[0]} to ${storey.floors[1]}, about ${storey.area} square units` : ""}; ${storey.marks.length} entities`,
    );
}
async function mapOpenings({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  const map = readEither(file);
  const mod = await profileOf(flags, listed);
  const reach = maps.reachOf(map, { ...reachOptions(flags, listed), ...defined({ mod }) });
  const picture = maps.openingViews(map, {
    ...pictureOptions(file, flags, listed),
    ...figureOptions(flags, listed),
    ...defined({ mod }),
    ...defined({
      count: numberOf(flags, "count"),
      cols: numberOf(flags, "cols"),
      both: flags.both === true ? true : undefined,
    }),
    reach,
  });
  savePicture(to, picture, `${picture.facts.views.length} views, each through an opening`);
  for (const view of picture.facts.views)
    console.log(
      `      opening ${view.opening}: ${openingSize(view.wide, view.high)}; from ${placeText(view.from)} looking yaw ${view.yaw}`,
    );
}

// ── textures of a map, and texture files ───────────────────────────────────
/** A map texture written as a PNG, its holes see-through; its line printed. */
function saveTexture(dir, texture, from) {
  const to = join(dir, `${pictureNameOf(texture.name)}.png`);
  const picture = maps.textureRgba(texture);
  save(to, smak.png(picture.width, picture.height, picture.rgba));
  console.log(
    `${to}  ${texture.width}x${texture.height}${texture.holes ? " with holes" : ""}${from ? `  ${from}` : ""}`,
  );
}
function mapTextures({ command, file, flags, listed }) {
  const dir = need(command, flags.o, "-o <folder>");
  const { bsp } = readCompiled(file);
  const found = maps.texturesFor(bsp, gameFolders(file, listed), { pixels: true });
  const fromWads = new Map(found.textures.map((each) => [each.name, each]));
  let missing = 0;
  for (const entry of bsp.textures) {
    if (entry.absent) continue;
    const inside = maps.embeddedTexture(bsp, entry.index);
    const outside = fromWads.get(entry.name);
    if (inside) saveTexture(dir, inside, "inside the map");
    else if (outside) saveTexture(dir, { ...outside.texture, name: entry.name }, `from ${outside.wad}`);
    else {
      missing++;
      console.log(
        `WARN  ${entry.name} ${entry.width}x${entry.height}: wanted from a .wad, and in none that was found`,
      );
    }
  }
  if (missing)
    console.log(
      `      ${missing} not found: the worldspawn lists ${maps.wantedTextures(bsp).wads.join(", ") || "no .wad file"}; --game <folder> says where to look`,
    );
}
function wad({ file, flags }) {
  const read = maps.readWad(readFileSync(file));
  for (const texture of read.textures) {
    if (flags.o) saveTexture(flags.o, texture, "");
    else
      console.log(
        `  ${texture.name.padEnd(16)} ${texture.width}x${texture.height}${texture.holes ? "  with holes" : ""}`,
      );
  }
  const others = read.others.length
    ? `, and ${read.others.length} things that are not map textures (not read)`
    : "";
  console.log(`${file}: ${read.textures.length} textures${others}`);
}
/** wad-make: a .wad from pictures, each texture named after its file. */
function wadMake({ command, file, rest, flags }) {
  const to = need(command, flags.o, "-o out.wad");
  const textures = [file, ...rest].map((pictureFile) => {
    const name = basename(pictureFile).replace(/\.(png|bmp)$/i, "");
    const bytes = readFileSync(existing(pictureFile));
    const isBmp = bytes.toString("latin1", 0, 2) === "BM";
    const read = isBmp ? smak.unbmp(bytes) : smak.unpng(bytes);
    return read.pixels ? { name, ...read } : { name, image: read };
  });
  save(to, maps.writeWad(textures));
  for (const texture of textures) {
    const size = texture.image ?? texture;
    console.log(
      `  ${texture.name.padEnd(16)} ${size.width}x${size.height}${maps.hasHoles(texture.name) ? "  with holes" : ""}`,
    );
  }
  console.log(`${to}: ${textures.length} textures`);
}

// ── sprite ─────────────────────────────────────────────────────────────────
/**
 * sprite: the sprites of a spec (docs/SPRITES.md) built: each .spr under -o at its own name (sprites/...), with
 * a contact sheet of its frames and an animated picture beside it, and the report. A reference picture the spec
 * names is read from beside the spec. Exit code 1 when a check fails.
 */
async function spriteCommand({ command, file, flags }) {
  const { buildSpriteSpec } = await import("../src/spec/sprite.mjs");
  const to = flags.o === undefined ? dirname(resolve(file)) : String(flags.o);
  const spec = specOf(command, file, "sprite");
  const { report, files } = buildSpriteSpec(spec, { readPicture: (name) => smak.unpicture(besideSpec(file)(name)) });
  for (const made of files) {
    const path = join(to, made.name);
    save(path, made.bytes);
    save(path.replace(/\.spr$/i, "-sheet.png"), made.sheet);
    save(path.replace(/\.spr$/i, "-animated.png"), made.animation);
    console.log(`      ${path} (with -sheet.png and -animated.png beside it)`);
  }
  reportOut(report, `${files.length} sprites built, and every check passed`);
}

// ── sound, music ───────────────────────────────────────────────────────────
/** A spec in JSON read, or the command stopped with what is wrong. */
function specOf(command, file, kind) {
  try {
    return JSON.parse(readFileSync(existing(file), "utf8"));
  } catch (error) {
    fail(`${command}: ${basename(file)} is not a ${kind} spec in JSON: ${error.message}`);
  }
}
/** A file a spec names (a take, a picture), read from beside the spec; `work:` is that folder too. */
const besideSpec = (file) => (name) => readFileSync(existing(join(dirname(resolve(file)), String(name).replace(/^work:/, ""))));
/** A spec's report as the sprite, sound and music commands print it; the exit code 1 when it is not OK. */
function reportOut(report, done) {
  for (const [label, list] of [["ERROR", report.errors], ["FAULT", report.faults], ["WARN ", report.warnings], ["note ", report.notes ?? []], ["fact ", report.facts]]) // prettier-ignore
    for (const line of list) console.log(`${label} ${line}`);
  if (report.parts && Object.keys(report.parts).length) {
    console.log("PARTS: id, triangles, from x y z to x y z");
    for (const [id, part] of Object.entries(report.parts)) console.log(`  ${id} ${part.tris} ${part.from.join(" ")} to ${part.to.join(" ")}`);
  }
  if (report.rooms && Object.keys(report.rooms).length) {
    console.log("ROOMS: id, from x y z to x y z, floor light");
    for (const [id, room] of Object.entries(report.rooms)) console.log(`  ${id} ${room.min.join(" ")} to ${room.max.join(" ")}${room.light === undefined ? "" : `, light ${room.light}`}`);
  }
  console.log(report.ok ? done : "NOT OK: fix what is said above and build again");
  process.exit(report.ok ? 0 : 1);
}

/**
 * sound: the sounds of a spec (docs/SOUNDS.md) built: each .wav under -o's sound/ at its own name, the picture
 * of them all (waveform over spectrogram, the game's own of their kind under them) beside the spec. A take or
 * a picture the spec names is read from beside the spec; the game folders given with --game are where a
 * sound in the place of the game's own, and a reference, are found.
 */
async function soundCommand({ command, file, flags, listed }) {
  const { buildSoundSpec } = await import("../src/spec/sound.mjs");
  const to = flags.o === undefined ? dirname(resolve(file)) : String(flags.o);
  const spec = specOf(command, file, "sound");
  const read = besideSpec(file);
  const { report, files, picture } = buildSoundSpec(spec, {
    games: (listed.game ?? []).map(existingFolder),
    readFile: read,
    readPicture: (name) => smak.unpicture(read(name)),
  });
  for (const made of files) {
    save(join(to, "sound", made.name), made.bytes);
    console.log(`      ${join(to, "sound", made.name)}`);
  }
  if (picture) {
    const first = (spec.name ?? spec.sounds?.[0]?.name ?? "sound").replace(/\.wav$/i, "").replace(/[^\w-]+/g, "_");
    const path = join(dirname(resolve(file)), `${first}.png`);
    save(path, smak.png(picture.width, picture.height, picture.rgba));
    console.log(`      ${path} (the picture)`);
  }
  reportOut(report, `${files.length} sounds built, and every check passed`);
}

/**
 * music: a take made the game's track (an MP3 under -o's media/, through ffmpeg) or a looped WAV bed (under
 * sound/), levelled by loudness (docs/SOUNDS.md). The take is read from beside the spec.
 */
async function musicCommand({ command, file, flags }) {
  const { buildMusicSpec } = await import("../src/spec/music.mjs");
  const to = flags.o === undefined ? dirname(resolve(file)) : String(flags.o);
  const spec = specOf(command, file, "music");
  const { report, files, picture } = buildMusicSpec(spec, { readFile: besideSpec(file), ...(flags.ffmpeg ? { ffmpeg: String(flags.ffmpeg) } : {}) });
  for (const made of files) {
    const path = join(to, (spec.as ?? "mp3") === "wav" ? "sound" : "", made.name);
    save(path, made.bytes);
    console.log(`      ${path}`);
  }
  if (picture) {
    const path = join(dirname(resolve(file)), `${(spec.name ?? `track${spec.track}`).replace(/\.(mp3|wav)$/i, "").replace(/[^\w-]+/g, "_")}.png`);
    save(path, smak.png(picture.width, picture.height, picture.rgba));
    console.log(`      ${path} (the picture)`);
  }
  reportOut(report, "the track built, and every check passed");
}

// ── build ──────────────────────────────────────────────────────────────────
/**
 * wad (smak.wad/1, docs/SPEC.md): the textures painted into a .wad, with a sheet of them, under -o (beside the
 * spec unless told). `preview: { map }` draws the map wearing them (its .wad files looked for in --game and the
 * map's own folders); `each: true` each texture at the place the map shows it best, with what it reads as there.
 */
async function wadSpecCommand({ command, file, flags, listed }) {
  const { buildWadSpec } = await import("../src/spec/wad.mjs");
  const spec = specOf(command, file, "wad");
  const folder = dirname(resolve(file));
  const out = flags.o === undefined ? folder : String(flags.o);
  // a picture read from beside the spec, its name said with what is wrong with it
  const readPicture = (name) => {
    try {
      return smak.unpicture(readFileSync(resolve(folder, String(name).replace(/^work:/, ""))));
    } catch (error) {
      throw new Error(`${name}: ${error.code === "ENOENT" ? "no such file beside the spec" : error.message}`);
    }
  };
  const { report, files } = buildWadSpec(spec, { out, folder, readPicture });
  for (const made of Object.values(files)) console.log(`      ${made}`);
  const preview = report.ok && spec.preview?.map ? previewOfWad(spec, files, resolve(folder, String(spec.preview.map).replace(/^work:/, "")), listed) : [];
  for (const line of preview) console.log(line);
  reportOut(report, `${spec.textures.length} textures built, and every check passed`);
}
/** A wad spec's preview: the map drawn wearing the textures, and with `each` every one at its place. */
function previewOfWad(spec, files, map, listed) {
  const lines = [];
  const bsp = maps.readBsp(readFileSync(existing(map)));
  const textures = maps.readWad(readFileSync(files.wad)).textures;
  const folders = [...(listed.game ?? []).map(existingFolder), ...maps.mapOwnFolders(map)];
  const base = files.wad.replace(/\.wad$/i, "");
  const views = maps.viewsOf(bsp, { count: spec.preview.views ?? 6, folders, textures });
  save(`${base}-views.png`, smak.png(views.width, views.height, views.rgba));
  lines.push(`      ${base}-views.png (${basename(map)} wearing them)`);
  const missing = views.facts?.missing ?? [];
  if (missing.length) lines.push(`note  the map wears textures this .wad does not have (drawn flat): ${missing.join(", ")}`);
  if (!spec.preview.each) return lines;
  // each texture of the spec on its own place in the map, from the camera and at the brightness the
  // reproduction judge uses: scale, turn and colour checked against a picture of the original's
  const mine = new Set(spec.textures.map((t) => t.name.toLowerCase()));
  const places = maps.texturePlaces(bsp).filter((p) => mine.has(p.name.toLowerCase()));
  const shots = places.map((p) => maps.placeView(bsp, p, { textures }));
  for (let i = 0; i < shots.length; i += 8) {
    const sheet = smak.tile(shots.slice(i, i + 8), 4, places.slice(i, i + 8).map((p) => p.name));
    const path = `${base}-places${i ? `-${i / 8 + 1}` : ""}.png`;
    save(path, smak.png(sheet.width, sheet.height, sheet.rgba));
    lines.push(`      ${path} (each where the map shows it best)`);
  }
  lines.push(`each texture where the map shows it best, at brightness ${maps.PLACE_BRIGHTNESS} (a colour read off such a view is the paint times the face's light: material seen: { colour, light }):`);
  // what it reads as there, the middle half of its view: set beside a colour read off a picture of the original's place
  const middleOf = (shot) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(shot.height / 4); y < (3 * shot.height) / 4; y++)
      for (let x = Math.floor(shot.width / 4); x < (3 * shot.width) / 4; x++, n++) for (let c = 0; c < 3; c++) sum[c] += shot.rgba[(y * shot.width + x) * 4 + c];
    return sum.map((v) => Math.round(v / (n || 1)));
  };
  places.forEach((p, i) =>
    lines.push(`  ${p.name}: on a ${p.wall ? "wall" : "floor or ceiling"}, the view spans ${p.across} texels across, the picture's top turned ${p.turned} degrees from ${p.wall ? "up" : "north"}, light [${p.light.join(", ")}]${p.lit ? "" : " (unlit: black in any view)"}; yours reads as RGB ${middleOf(shots[i]).join(", ")} in the middle of that view`),
  );
  // a texture the map keeps inside itself is the one the game wears: a .wad does not replace it
  const kept = places.filter((p) => bsp.textures.some((t) => t.name.toLowerCase() === p.name.toLowerCase() && t.embedded && !t.absent)).map((p) => p.name);
  for (const name of kept) lines.push(`  the map keeps its own ${name} inside it: the game (and this view) wears that, not the .wad's. Only a recompile without it, or a map that names the .wad, wears yours`);
  const absent = spec.textures.filter((t) => !places.some((p) => p.name.toLowerCase() === t.name.toLowerCase())).map((t) => t.name);
  if (absent.length) lines.push(`  not on the map's world faces: ${absent.join(", ")}`);
  return lines;
}

/** A picture beside another, scaled to its height: the person's drawing or reference beside what was built. */
function besideOf(first, second) {
  const k = second.height / first.height;
  const w = Math.max(1, Math.round(first.width * k));
  const width = w + 8 + second.width;
  const rgba = new Uint8Array(width * second.height * 4).fill(255);
  for (let y = 0; y < second.height; y++) {
    for (let x = 0; x < w; x++) {
      const from = (Math.min(first.height - 1, Math.floor(y / k)) * first.width + Math.min(first.width - 1, Math.floor(x / k))) * 4;
      rgba.set(first.rgba.subarray(from, from + 4), (y * width + x) * 4);
    }
    rgba.set(second.rgba.subarray(y * second.width * 4, (y + 1) * second.width * 4), (y * width + w + 8) * 4);
  }
  return { width, height: second.height, rgba };
}
/**
 * Against the last build of the same name in the folder: what changed, as lines, and the new summary kept beside
 * the model (`<name>.built.json`) for the next. A first build says nothing.
 */
async function changedSince(folder, base, kind, spec, report) {
  const { summaryOf, changesOf } = await import("../src/spec/changes.mjs");
  const file = join(folder, `${base}.built.json`);
  const now = summaryOf(kind, spec, report);
  const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  save(file, `${JSON.stringify(now, null, 1)}\n`);
  if (!before || before.kind !== kind) return [];
  return changesOf(before, now).lines.map((line) => `CHANGED since the last build of ${base}: ${line}`);
}
/**
 * A model built for Source (the spec's engine "source"): under -o, <name>_source/ with src/ (the compiler's files)
 * and addon/ (into garrysmod/addons/<name>/), compiled by GMod's studiomdl, held to the built model and drawn
 * (<name>-source-sheet.png); what it says goes into the build's report. --no-compile writes the files only.
 */
async function sourceOfBuilt({ command, flags, spec, base, mdl, pictures, baseFile, report, out, shown }) {
  const { summaryOf } = await import("../src/spec/changes.mjs");
  if (flags.collision !== undefined && !smak.source.COLLISIONS.includes(flags.collision))
    fail(`${command}: --collision ${smak.source.COLLISIONS.join(", ")}, not ${flags.collision}`);
  const mass = numberOf(flags, "mass");
  if (mass !== undefined && !(mass > 0)) fail(`${command}: --mass is kilograms, more than 0, not ${flags.mass}`);
  const to = join(out, `${base}_source`);
  let result;
  try {
    result = smak.source.builtToGmod(mdl, defined({
      pictures,
      baseFile,
      record: summaryOf("model", spec, report),
      out: to,
      name: smak.source.sourceName(base),
      folder: flags.folder,
      collision: flags.collision,
      surfaceprop: flags.surfaceprop,
      mass,
      studiomdl: flags.studiomdl,
      gmod: flags.gmod,
      compile: flags.compile !== false,
    })); // prettier-ignore
  } catch (error) {
    report.errors.push(`Source: ${error.message}`);
    report.ok = false;
    return;
  }
  report.warnings.push(...result.warnings.map((line) => `Source: ${line}`));
  report.faults.push(...result.faults.map((line) => `Source: ${line}`));
  report.facts.push(...result.said.map((line) => `Source: ${line}`), `Source: the QC ${result.qc}; the addon ${join(to, "addon")} (into garrysmod/addons/<name>/), models/${result.modelname}`); // prettier-ignore
  if (!result.passed) report.ok = false;
  if (result.picture) shown("source-sheet", result.picture, "six views of the Source model, read back from its compiled files");
}

/**
 * model (smak.model/1, docs/SPEC.md): the model written under -o (beside the spec unless told) with its sheet of
 * six views; a character on a base seen running; a weapon's files in the game's names in a folder of their own,
 * the game's first-person view beside the new one and its attack; --reference drawn beside it; --focus the parts
 * named seen close. A picture or a file the spec names is read from beside it; --game the folders a base or a
 * game's weapon is found in.
 */
async function modelSpecCommand({ command, file, flags, listed }) {
  const { buildModelSpec } = await import("../src/spec/model.mjs");
  // --engine source: the spec made for Source whatever it says
  const spec = flags.engine === undefined ? specOf(command, file, "model") : { ...specOf(command, file, "model"), engine: String(flags.engine) };
  const folder = dirname(resolve(file));
  const out = flags.o === undefined ? folder : String(flags.o);
  const name = spec.name ?? "model.mdl";
  const base = name.replace(/\.mdl$/i, "");
  const readPicture = (picture) => {
    try {
      return smak.unpicture(readFileSync(resolve(folder, String(picture).replace(/^(work|models):/, ""))));
    } catch (error) {
      throw new Error(`${picture}: ${error.code === "ENOENT" ? "no such file beside the spec" : error.message}`);
    }
  };
  const readFile = (given) => readFileSync(existing(resolve(folder, String(given).replace(/^(work|models):/, ""))));
  const { mdl, report, files = [], pictures, baseFile } = buildModelSpec(spec, { folder, out: join(out, name), games: (listed.game ?? []).map(existingFolder), readPicture, readFile });
  if (mdl) {
    save(join(out, name), mdl);
    console.log(`      ${join(out, name)} (${mdl.length} bytes)`);
    for (const line of await changedSince(out, base, "model", spec, report)) console.log(line);
    const shown = (suffix, picture, what) => {
      const path = join(out, `${base}-${suffix}.png`);
      save(path, smak.png(picture.width, picture.height, picture.rgba));
      console.log(`      ${path} (${what})`);
    };
    shown("sheet", smak.sheet(mdl, { seq: 0, size: 256 }), "six views");
    // a body on a base's skeleton: seen moving, a run (or a walk) from the side
    if (spec.base) {
      const moving = smak.sequences(mdl).findIndex((seq) => /run|walk/i.test(seq.name) && !seq.group);
      if (moving >= 0) shown("run", smak.strip(mdl, { seq: moving, count: 8, cols: 4, view: "side", width: 192, height: 192 }), "its run from the side");
    }
    if (typeof flags.reference === "string")
      shown("reference", besideOf(smak.unpicture(readFileSync(existing(flags.reference))), smak.render(mdl, { seq: 0, yaw: 35, pitch: 20, width: 512, height: 512 })), "beside the reference");
    // a weapon: its files in the game's names, in a folder of their own; the game's first-person view beside the
    // new one, the other views, and its attack as the player sees it
    if (files.length) {
      const weapon = join(out, `${base}_weapon`);
      for (const made of files) save(join(weapon, made.name), made.mdl ?? made.bytes);
      console.log(`      ${weapon}: ${files.map((made) => made.name).join(", ")} (the game's names: they take the place of its own in <mod>/models)`);
      const views = [];
      const labels = [];
      for (const made of files.filter((f) => f.view !== "sound")) {
        const first = made.view === "v";
        const draw = (src) => smak.render(src, { seq: 0, frame: 0, width: 320, height: 320, ...(first ? { view: "first" } : { yaw: 35, pitch: 20 }) });
        if (first && made.original) {
          views.push(draw(made.original));
          labels.push(`the game's ${made.name}`);
        }
        views.push(draw(made.mdl));
        labels.push(made.name);
      }
      shown("weapon", smak.tile(views, views.length, labels), "its views beside the game's");
      const v = files.find((made) => made.view === "v");
      if (v) {
        const list = smak.sequences(v.mdl);
        const attack = list.findIndex((seq) => /attack|fire|shoot|swing|hit|throw|stab|slash/i.test(seq.name));
        shown("attack", smak.strip(v.mdl, { seq: attack >= 0 ? attack : Math.min(1, list.length - 1), count: 8, cols: 4, view: "first", width: 192, height: 192 }), "its attack as the player sees it");
      }
    }
    // a close look at the parts asked for, from two sides and below: what a sheet of the whole is too small to show
    const focus = listed.focus ?? [];
    if (focus.length) {
      const boxes = focus.map((id) => {
        const part = report.parts[id] ?? Object.entries(report.parts).find(([key]) => key.startsWith(`${id}.`))?.[1];
        if (!part) fail(`--focus: no part ${id}; the parts are ${Object.keys(report.parts).join(", ")}`);
        return part;
      });
      const mn = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.from[k])));
      const mx = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.to[k])));
      const within = { mid: mn.map((v, k) => (v + mx[k]) / 2), far: Math.max(0.5, Math.hypot(...mx.map((v, k) => v - mn[k])) / 2) };
      const views = [[35, 20], [215, 20], [35, -35]].map(([yaw, pitch]) => smak.render(mdl, { seq: 0, yaw, pitch, within, width: 320, height: 320 }));
      shown("focus", smak.tile(views, 3, ["front", "back", "from below"]), `${focus.join(", ")} close`);
    }
    // made for Source: the file above is the step between; ported with its pictures in full colour, compiled by
    // GMod's studiomdl, held to itself and drawn from the compiled files (src/source/gmod.mjs, builtToGmod)
    if (spec.engine === "source") await sourceOfBuilt({ command, flags, spec, base, mdl, pictures, baseFile, report, out, shown });
  }
  reportOut(report, "built, and every check passed");
}

/**
 * map (smak.map/1, docs/SPEC-MAPS.md): the map built in a folder of its name beside the spec (-o another): its .map,
 * its own .wad, its models and sounds, compiled when the compilers are found (VHLT_DIR, the PATH or --vhlt) and
 * then walked and lit, and its pictures (plan, views, sections, props). --game the folders the game's .wad files
 * and models are found in; --fgd entity definitions its entities are held to; --reference drawn beside the plan;
 * --mod (or the spec's `mod`, a profile's file beside it) the mod it is a map of (src/maps/mod.mjs).
 */
async function mapSpecCommand({ command, file, flags, listed }) {
  const { buildMapSpec } = await import("../src/spec/map.mjs");
  const spec = specOf(command, file, "map");
  const folder = dirname(resolve(file));
  const name = spec.name ?? "specmap";
  const out = flags.o === undefined ? join(folder, name) : String(flags.o);
  const readPicture = (picture) => {
    try {
      return smak.unpicture(readFileSync(resolve(folder, String(picture).replace(/^(work|models):/, ""))));
    } catch (error) {
      throw new Error(`${picture}: ${error.code === "ENOENT" ? "no such file beside the spec" : error.message}`);
    }
  };
  const readFile = (given) => readFileSync(existing(resolve(folder, String(given).replace(/^(work|models):/, ""))));
  // a mod's profile: --mod, or the spec's own `mod` (a profile's file beside the spec, or goldsrc)
  // and a map for Half-Life itself (--game <Half-Life>/valve, no FGD named) is held to the kit's own profile of it,
  // since Half-Life ships no .fgd of its own to hold it to
  const forHalfLife = (listed.game ?? []).length > 0 && listed.game.every((given) => basename(resolve(given)).toLowerCase() === "valve") && !flags.fgd && !spec.fgd; // prettier-ignore
  const modGiven = flags.mod ?? (typeof spec.mod === "string" ? (spec.mod === "goldsrc" ? "goldsrc" : resolve(folder, spec.mod)) : forHalfLife ? "goldsrc" : undefined); // prettier-ignore
  const mod = await profileOf({ ...flags, mod: modGiven }, listed);
  const { report, files } = buildMapSpec(spec, {
    out,
    folder,
    mod,
    compilers: flags.vhlt === undefined ? undefined : String(flags.vhlt),
    fgd: (listed.fgd ?? []).map(existing),
    wads: (listed.game ?? []).map(existingFolder),
    readPicture,
    readFile,
  });
  if (report.rooms && Object.keys(report.rooms).length) for (const line of await changedSince(out, name, "map", spec, report)) console.log(line);
  for (const made of Object.values(files)) console.log(`      ${made}`);
  const plan = files.plan ?? files["plan-source"];
  if (plan && typeof flags.reference === "string") {
    const beside = besideOf(smak.unpicture(readFileSync(existing(flags.reference))), smak.unpng(readFileSync(plan)));
    const path = join(out, `${name}-reference.png`);
    save(path, smak.png(beside.width, beside.height, beside.rgba));
    console.log(`      ${path} (the plan beside the reference)`);
  }
  reportOut(report, "built, and every check passed");
}

/**
 * video (smak.video/1, docs/SPEC.md): a video of models and maps from its shots, its contact sheet beside it under
 * -o (beside the spec unless told); --preview the sheet alone, to look at before the frames are all drawn. The
 * models and maps it names are read from beside the spec; --game the folders their textures are found in. MP4
 * through ffmpeg when it is on the PATH, a GIF written here when not (or `format: "gif"`).
 */
async function videoSpecCommand({ command, file, flags, listed }) {
  const { buildVideoSpec } = await import("../src/spec/video.mjs");
  const spec = specOf(command, file, "video");
  const folder = dirname(resolve(file));
  const out = flags.o === undefined ? folder : String(flags.o);
  const near = (name) => existing(resolve(folder, String(name).replace(/^(work|models):/, "")));
  const { report, files } = await buildVideoSpec(spec, {
    model: (name) => smak.readStudio(near(name)).src,
    map: (name) => readFileSync(near(name)),
    folders: [folder, out, ...(listed.game ?? []).map(existingFolder)],
    preview: flags.preview === true,
  });
  const base = join(out, spec.name ?? "video");
  if (files?.sheet) {
    save(`${base}-sheet.png`, files.sheet);
    console.log(`      ${base}-sheet.png (a frame of each moment of each shot)`);
  }
  if (files?.video) {
    save(`${base}.${files.format}`, files.video);
    console.log(`      ${base}.${files.format} (${(files.video.length / 1e6).toFixed(2)} MB)`);
  }
  reportOut(report, files?.video ? "the video made, and every check passed" : "the preview drawn, and every check passed");
}

/** The spec builders by the spec each reads (docs/SPEC.md): `smak build` picks one by the spec's `spec`. */
const BUILDERS = {
  "smak.video/1": videoSpecCommand,
  "smak.map/1": mapSpecCommand,
  "smak.model/1": modelSpecCommand,
  "smak.wad/1": wadSpecCommand,
  "smak.sound/1": (given) => soundCommand(given),
  "smak.music/1": (given) => musicCommand(given),
  "smak.sprite/1": (given) => spriteCommand(given),
};
/** build: a spec built by the builder its `spec` names. */
async function buildCommand(given) {
  const spec = specOf(given.command, given.file, "smak");
  const run = BUILDERS[spec?.spec];
  if (!run) fail(`${given.command}: "spec" is one of ${Object.keys(BUILDERS).join(", ")}, not ${JSON.stringify(spec?.spec)}`);
  await run(given);
}

// ── map-overlay ────────────────────────────────────────────────────────────
/**
 * map-overlay: the map's edges drawn over a picture of it from a camera (green where they lie on the picture's
 * own, red where not), how far apart, and the faces the edges say are off. --locate: the camera found first by
 * the edges, from the camera given as a guess or from places over the map's floor.
 */
async function mapOverlay({ command, file, rest, flags }) {
  const { overlayOf, fitCamera } = await import("../src/maps/overlay.mjs");
  const [pictureFile] = rest;
  if (!pictureFile) fail(`${command} <map|bsp> <picture> --from x,y,z --yaw n [--pitch n] [--fov 90] [--locate] -o out.png`);
  const map = readEither(file);
  const picture = smak.unpicture(readFileSync(existing(pictureFile)));
  const from = numbersOf(flags, "from", 3, "three numbers x,y,z");
  let camera = from ? { from, yaw: numberOf(flags, "yaw") ?? 0, pitch: numberOf(flags, "pitch") ?? 0, fov: numberOf(flags, "fov") ?? 90 } : null;
  if (!camera && !flags.locate) fail(`${command}: the camera (--from x,y,z --yaw n), or --locate to find one`);
  if (flags.locate) {
    const found = fitCamera(map, picture, camera ?? {});
    camera = found.camera;
    console.log(`camera ${placeText(camera.from)} yaw ${camera.yaw} pitch ${camera.pitch} fov ${camera.fov}: found by the edges, ${found.score} pixels apart`);
  }
  const width = numberOf(flags, "width") ?? Math.min(640, picture.width);
  const o = overlayOf(map, picture, camera, { width, height: Math.round((width * picture.height) / picture.width) });
  console.log(`edges: ${o.score} pixels apart (the map's from the picture's ${o.toPicture}, the picture's from the map's ${o.fromPicture})`);
  for (const f of o.faces.slice(0, 8)) if (f.move !== 0) console.log(`      edges say ${f.axis} ${f.texture}: ${f.move > 0 ? "+" : ""}${f.move} units (${f.seen} edge pixels, ${f.better} pixels nearer)`);
  if (flags.o) {
    save(flags.o, smak.png(o.width, o.height, o.rgba));
    console.log(`${flags.o}  ${o.width}x${o.height}  the map's edges over the picture`);
  }
}

// ── map-light ──────────────────────────────────────────────────────────────
/**
 * map-light: the light on a compiled map's floors, from its lightmaps: all of it, and room by room (--rooms:
 * a JSON file of { name: { min, max } }) or as the dark stretches of it.
 */
function mapLight({ command, file, flags }) {
  const { bsp } = readCompiled(file);
  const rooms = flags.rooms === undefined ? null : JSON.parse(readFileSync(existing(flags.rooms), "utf8"));
  const dark = flags.dark === undefined ? undefined : numberOf(flags, "dark");
  const cell = flags.cell === undefined ? undefined : numberOf(flags, "cell");
  if (dark !== undefined && !(dark > 0)) fail(`${command}: --dark is a brightness, 1 to 255, not ${flags.dark}`);
  const reach = flags.walked ? maps.reachOf(bsp) : null;
  const switched = flags.switched === undefined ? undefined : String(flags.switched);
  if (switched !== undefined && !maps.SWITCHED.includes(switched))
    fail(`${command}: --switched ${maps.SWITCHED.join(" or ")}, not ${flags.switched}`);
  const report = maps.lightReport(bsp, defined({ rooms, dark, cell, reach, switched }));
  if (flags.json) {
    const { warnings, facts, ...rest } = report;
    console.log(JSON.stringify({ ...rest, warnings, facts }, null, 2));
    return;
  }
  for (const fact of report.facts) console.log(`      ${fact}`);
  for (const warning of report.warnings) console.log(`WARN  ${warning}`);
}

// ── map-spawns ─────────────────────────────────────────────────────────────
/**
 * map-spawns: how each spawn area's monsters come into the map (encounters.mjs): what fires the area, which
 * monsters can be seen appearing, which come back soon, which races fight, how far a reward appears from
 * the death that brings it. With -o, the plan with a line from where a player stands in each trigger to
 * each monster seen from it. Exit code 1 when a monster can be seen appearing or races fight.
 */
async function mapSpawns({ command, file, flags, listed }) {
  const mod = await profileOf(flags, listed);
  if (!mod?.spawns)
    fail(`${command}: --mod <profile> whose \`spawns\` says how the mod's spawn areas work (profiles/mastersword.mjs has one)`); // prettier-ignore
  const map = readEither(file);
  const report = maps.spawnsOf(map, { mod, ...defined({ sight: numberOf(flags, "sight"), quick: numberOf(flags, "quick"), near: numberOf(flags, "near"), far: numberOf(flags, "far") }) }); // prettier-ignore
  if (flags.json) console.log(JSON.stringify(report, (key, value) => (value === Infinity ? "endless" : value), 1));
  else {
    console.log(maps.spawnsTable(report));
    for (const fact of report.facts) console.log(`      ${fact}`);
    for (const warning of report.warnings) console.log(`WARN  ${warning}`);
  }
  if (flags.o) {
    const lines = report.areas.flatMap((area) =>
      area.seen.map((each) => ({ from: each.eye, to: area.templates.find((template) => template.number === each.number).at })), // prettier-ignore
    );
    const only = [...new Set(report.areas.flatMap((area) => [...area.by.map((source) => source.number), ...area.templates.map((template) => template.number)]).filter((number) => number !== undefined))]; // prettier-ignore
    const options = { ...pictureOptions(file, flags, listed), ...defined({ z: numberOf(flags, "z"), mod }), lines, only, legend: true }; // prettier-ignore
    const picture = isSource(file) ? maps.planOfSource(map, options) : maps.planOf(map, options);
    if (flags.json) save(flags.o, smak.png(picture.width, picture.height, picture.rgba));
    else savePicture(flags.o, picture, `the plan: the spawn areas' monsters and what fires them, a line from a trigger to each monster seen appearing from it (${lines.length})`); // prettier-ignore
  }
  process.exit(report.areas.some((area) => area.seen.length || area.fights.length) ? 1 : 0);
}

// ── map-teams ──────────────────────────────────────────────────────────────
/**
 * map-teams: a map's two teams as a team plugin plays it (teams.mjs; The Specialists' ts_matchmode, by its
 * profile's `teams`): the split of its spawns (or a spawn file's, --cfg), the nearest pair across the teams,
 * spawns in sight of the other side's, the walk between them and to a goal, and the balance of those walks.
 * --write-cfg: the spawn file the plugin reads, written. Exit code 1 on a FAIL.
 */
async function mapTeams({ command, file, flags, listed }) {
  const mod = await profileOf(flags, listed);
  if (!mod?.teams) fail(`${command}: --mod <profile> whose \`teams\` says how its team plugin splits a map (ts: profiles/specialists.mjs)`); // prettier-ignore
  const words = listed.goal ?? [];
  if (words.length > 1) fail(`${command}: one --goal (a point x,y,z, or an entity's number, classname or targetname)`);
  const point = words.length === 1 && words[0].includes(",");
  const goal = words.length === 0 ? undefined : point ? words[0].split(",").map(Number) : entityName(words[0]);
  if (point && (goal.length !== 3 || !goal.every(Number.isFinite))) fail(`--goal: a point x,y,z, not ${words[0]}`);
  const name = basename(file).replace(/\.(bsp|map)$/i, "");
  const { doors, jump, cell } = reachOptions(flags, listed);
  const cfg = typeof flags.cfg === "string" ? readFileSync(existing(flags.cfg), "utf8") : undefined;
  const report = maps.teamsOf(readEither(file), defined({ mod, goal, name, doors, jump, cell, cfg, each: flags.each === true || undefined, walk: flags.walk === false ? false : undefined })); // prettier-ignore
  if (flags["write-cfg"] !== undefined && flags["write-cfg"] !== false) {
    const asked = flags["write-cfg"] === true ? "." : String(flags["write-cfg"]);
    const to = /\.cfg$/i.test(asked) ? asked : join(asked, maps.spawnCfgName(name));
    save(to, report.cfg);
    const count = report.teams.map((team) => team.spawns.length);
    console.log(`${to}: ${count[0] + count[1]} spawns (team 1 ${count[0]}, team 2 ${count[1]}), each at its floor and turned ${goal === undefined ? "to the middle of the map" : "to the goal"}; it goes in addons/amxmodx/configs/ on the server`); // prettier-ignore
  }
  if (flags.json) {
    const { rules, ...rest } = report;
    console.log(JSON.stringify({ plugin: rules.plugin, ...rest }, null, 1));
  } else {
    for (const team of report.teams)
      console.log(`team ${team.team} ${team.name.padEnd(12)} ${String(team.spawns.length).padStart(3)} spawns${report.walks ? `   to the goal ${report.walks.teams[team.team - 1].median ?? "none"}` : ""}`); // prettier-ignore
    for (const fact of report.facts) console.log(`      ${fact}`);
    for (const warning of report.warnings) console.log(`WARN  ${warning}`);
    for (const fault of report.faults) console.log(`FAIL  ${fault}`);
  }
  process.exit(report.faults.length ? 1 : 0);
}

// ── map-wiring ─────────────────────────────────────────────────────────────
/**
 * map-wiring: what a map's entities are wired to do: its properties (doors by name), its switches and what
 * each works in the end, its lifts, the places that heal or hurt, what is said over the map.
 */
async function mapWiring({ file, flags, listed }) {
  const mod = await profileOf(flags, listed);
  const report = maps.wiringOf(readEither(file), defined({ mod }));
  if (flags.json) {
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  if (flags.list) {
    for (const property of report.properties)
      console.log(`  property ${property.name.padEnd(24)} ${String(property.doors.length).padStart(2)} doors at ${property.at?.map(Math.round).join(" ") ?? "?"}${property.opens.length ? `  opened by ${property.opens.join(" ")}` : ""}`); // prettier-ignore
    for (const one of report.switches)
      console.log(`  ${one.kind} ${String(one.number).padStart(4)} ${one.classname.padEnd(20)} -> ${one.works.length ? one.works.map((work) => `${work.kind} ${work.number}`).join(", ") : "nothing"}`); // prettier-ignore
  }
  for (const fact of report.facts) console.log(`      ${fact}`);
  for (const warning of report.warnings) console.log(`WARN  ${warning}`);
}

// ── map-character ──────────────────────────────────────────────────────────
/**
 * map-character: a compiled map's character in numbers (character.mjs), held against its mod's maps (the
 * profile's `character.figures`, or --against a file `--learn` wrote). Several maps: their figures side by
 * side. --learn: the figures of the maps given (files or folders of .bsp) as a reference, written to -o.
 */
async function mapCharacter({ command, file, flags, listed, rest }) {
  const mod = await profileOf(flags, listed);
  // a folder stands for every map in it
  const files = [file, ...(rest ?? [])].flatMap((each) => {
    if (!existsSync(each)) fail(`no such file: ${each}`);
    return statSync(each).isDirectory()
      ? readdirSync(each).filter((name) => /\.bsp$/i.test(name)).sort().map((name) => join(each, name))
      : [each];
  });
  if (!files.length) fail(`${command}: no .bsp in ${[file, ...(rest ?? [])].join(", ")}`);
  const measured = files.map((each) => ({
    name: basename(each).replace(/\.bsp$/i, ""),
    ...maps.characterOf(readCompiled(each).bsp, defined({ mod })),
  }));
  if (flags.learn) {
    const to = need(command, flags.o, "-o figures.json");
    const reference = maps.learnCharacter(measured, defined({ from: flags.from }));
    save(to, Buffer.from(JSON.stringify(reference, null, 1)));
    console.log(`${to}: the figures of ${measured.length} maps, [lower quartile, median, upper quartile] each`);
    for (const [name, [low, middle, high]] of Object.entries(reference.figures)) console.log(`      ${name.padEnd(13)} ${low}  ${middle}  ${high}`); // prettier-ignore
    return;
  }
  const reference = flags.against ? JSON.parse(readFileSync(existing(flags.against), "utf8")) : mod?.character?.figures ? mod.character : null; // prettier-ignore
  const told = measured.map((each) => ({ ...each, ...maps.characterAgainst(each.figures, reference) }));
  if (flags.json) {
    console.log(JSON.stringify(told.map(({ name, figures, plain, warning }) => ({ name, figures, plain, warning })), null, 1)); // prettier-ignore
    return;
  }
  if (told.length === 1) {
    console.log(`${files[0]}:`);
    for (const fact of told[0].facts) console.log(`      ${fact}`);
  } else {
    const names = ["offGrid", "sloped", "levels", "heightSpread", "textures", "props", "sounds", "music", "lights", "lampFaces", "lightMean", "shadow", "brightest"]; // prettier-ignore
    const width = Math.max(4, ...told.map((each) => each.name.length));
    console.log(`${"".padEnd(width)}  ${names.map((name) => name.slice(0, 11).padStart(12)).join("")}`);
    for (const each of told) console.log(`${each.name.padEnd(width)}  ${names.map((name) => String(each.figures[name] ?? "-").padStart(12)).join("")}`); // prettier-ignore
    if (reference) console.log(`${"(q1-q3)".padEnd(width)}  ${names.map((name) => (reference.figures[name] ? `${reference.figures[name][0]}-${reference.figures[name][2]}` : "-").padStart(12)).join("")}`); // prettier-ignore
  }
  if (!reference) console.log("      no figures to hold it against: --mod <profile> with `character.figures`, or --against <file of --learn>"); // prettier-ignore
  for (const each of told) {
    const who = told.length > 1 ? `${each.name}: ` : "";
    for (const text of each.plain) console.log(`PLAIN ${who}${text}`);
    if (each.warning) console.log(`WARN  ${who}${each.warning}`);
  }
}

// ── map-measure, map-compare ───────────────────────────────────────────────
/**
 * A name for each of several maps: those of --names (a,b,c), or each file's own name without its ending,
 * with its folder before it where two files are named alike.
 */
function namesOf(command, files, flags) {
  if (flags.names !== undefined) {
    const names = String(flags.names).split(",").map((name) => name.trim()); // prettier-ignore
    if (names.length !== files.length || names.some((name) => !name))
      fail(`${command}: --names is a name for each map with commas between (${files.length} of them), not ${flags.names}`); // prettier-ignore
    return names;
  }
  const own = files.map((each) => basename(each).replace(/\.(bsp|map)$/i, ""));
  return own.map((name, nth) =>
    own.filter((other) => other === name).length > 1 ? `${basename(dirname(files[nth]))}/${name}` : name,
  );
}
/**
 * map-measure: a map in numbers (how wide its floor is, how high, how far one sees, how much of its
 * footprint is floor), or several maps' numbers side by side.
 */
async function mapMeasure({ command, file, rest, flags, listed }) {
  const files = [file, ...rest.map(existing)];
  const names = namesOf(command, files, flags);
  const bands = flags.bands === undefined ? undefined : String(flags.bands).split(",").map(Number);
  if (bands && !bands.every((each, nth) => each > (bands[nth - 1] ?? 0)))
    fail(`--bands: the widths that part the floor, rising, with commas between (176,352), not ${flags.bands}`); // prettier-ignore
  const lengths = Object.fromEntries(
    ["grid", "sight", "eye", "precision"].map((name) => [name, numberOf(flags, name)]),
  );
  for (const [name, value] of Object.entries(lengths))
    if (value !== undefined && !(value > 0)) fail(`--${name}: a length in units, over 0, not ${value}`);
  const options = {
    ...reachOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed), bands, ...lengths }),
    every: flags.every === true,
  };
  const measured = files.map((each, nth) => {
    try {
      return { file: each, ...maps.measure(readEither(each), { ...options, name: names[nth] }) };
    } catch (error) {
      return fail(`${command}: ${each}: ${sayOf(error)}`);
    }
  });
  if (flags.json) {
    console.log(JSON.stringify(measured.length === 1 ? measured[0] : measured, null, 2));
    return;
  }
  if (measured.length === 1) {
    for (const fact of measured[0].facts) console.log(`      ${fact}`);
    for (const warning of measured[0].warnings) console.log(`WARN  ${warning}`);
    return;
  }
  for (const line of maps.measureTable(measured)) console.log(line);
  for (const each of measured)
    for (const warning of each.warnings) console.log(`WARN  ${each.name}: ${warning}`);
}
/**
 * map-waypoints: RCBot's waypoints for a map, from the walk test (src/maps/waypoints.mjs), written as the
 * bot's .rcw file. `--mod` is a profile (its game folder names the bot's folder for the mod) or the mod's
 * folder itself ("ts"); `--out` is the bot's folder (<Half-Life>/rcbot), under which the file goes where the
 * bot looks: waypoints/<mod>/<map>.rcw. `-o` writes it anywhere; with neither, <map>.rcw here.
 */
async function mapWaypoints({ command, file, flags, listed }) {
  const map = readEither(file);
  const word = flags.mod;
  const isProfile = word !== undefined && (word === "goldsrc" || existsSync(word));
  const mod = isProfile ? await profileOf(flags, listed) : undefined;
  const folder =
    flags.folder ?? (isProfile ? (mod?.folders?.[0] ? basename(mod.folders[0]) : undefined) : word);
  if (folder !== undefined && !/^[A-Za-z0-9_.-]+$/.test(folder))
    fail(`${command}: --mod (or --folder): the mod's folder, one word ("ts"), not ${folder}`);
  const mapName = flags.name ?? basename(file).replace(/\.(bsp|map)$/i, "");
  const lengths = Object.fromEntries(
    ["spacing", "paths", "drop", "most"].map((name) => [name, numberOf(flags, name)]),
  );
  for (const [name, value] of Object.entries(lengths))
    if (value !== undefined && !(value > 0)) fail(`--${name}: a number over 0, not ${value}`);
  let made;
  try {
    made = maps.waypointsOf(map, {
      ...reachOptions(flags, listed),
      ...defined({ mod, ...lengths }),
      jump: flags.jump !== false,
      crouch: flags.crouch !== false,
    });
  } catch (error) {
    fail(`${command}: ${sayOf(error)}`);
  }
  let bytes;
  try {
    bytes = maps.writeRcw(made.waypoints, { mapName });
  } catch (error) {
    fail(`${command}: ${sayOf(error)}`);
  }
  if (flags.out !== undefined && folder === undefined)
    fail(`${command}: --out puts the file under waypoints/<mod>/: say the mod, --mod ts (or a profile)`);
  const to =
    flags.o ??
    (flags.out !== undefined ? join(flags.out, "waypoints", folder, `${mapName}.rcw`) : `${mapName}.rcw`);
  save(to, bytes);
  if (flags.json) {
    const { reach: _reach, ...plain } = made;
    console.log(JSON.stringify({ file: to, mapName, folder, ...plain }, null, 1));
  } else {
    console.log(`${to}: ${made.waypoints.length} waypoints for the map ${mapName}, RCBot's .rcw (version 4)`);
    for (const fact of made.facts) console.log(`      ${fact}`);
    for (const warning of made.warnings) console.log(`WARN  ${warning}`);
    console.log(
      `      where the bot reads it: <Half-Life>/rcbot/waypoints/${folder ?? "<mod>"}/${mapName}.rcw; it works out its visibility table (rcbot/visibility/${folder ?? "<mod>"}/${mapName}.rcv) when the map first loads`,
    );
  }
  if (flags.plan) {
    const lines = [];
    const { waypoints } = made;
    waypoints.forEach((waypoint, number) => {
      for (const to of waypoint.paths) {
        const other = waypoints[to];
        const both = other.paths.includes(number);
        const end = both
          ? other.origin
          : waypoint.origin.map((value, axis) => (value + other.origin[axis]) / 2);
        lines.push({
          from: waypoint.origin.slice(0, 2),
          to: end.slice(0, 2),
          colour: both ? [60, 200, 60] : [255, 150, 0],
        });
      }
    });
    for (const waypoint of waypoints) {
      const [x, y] = waypoint.origin;
      const colour = waypoint.flags & maps.RCW_FLAGS.LADDER ? [40, 140, 255] : waypoint.flags & maps.RCW_FLAGS.JUMP ? [255, 0, 255] : waypoint.flags & maps.RCW_FLAGS.CROUCH ? [0, 230, 230] : waypoint.kind === "start" ? [255, 255, 0] : [230, 40, 40]; // prettier-ignore
      lines.push(
        { from: [x - 8, y - 8], to: [x + 8, y + 8], colour },
        { from: [x - 8, y + 8], to: [x + 8, y - 8], colour },
      );
    }
    const options = {
      ...pictureOptions(file, flags, listed),
      ...defined({ z: numberOf(flags, "z"), mod }),
      lines,
      entities: false,
    };
    const picture = isSource(file) ? maps.planOfSource(map, options) : maps.planOf(map, options);
    if (flags.json) return save(flags.plan, smak.png(picture.width, picture.height, picture.rgba));
    savePicture(flags.plan, picture, "the plan with the waypoints (a cross: red on the floor, yellow at a start, blue a ladder, magenta a jump, cyan crouching) and their paths (green both ways, orange one way, drawn half way)"); // prettier-ignore
  }
}
/**
 * map-compare: several maps from above at one scale in one picture. --z is one height for them all, or one
 * for each map in the order given, with `-` for a map that is seen from above.
 */
async function mapCompare({ command, file, rest, flags, listed }) {
  const to = need(command, flags.o, "-o out.png");
  const files = [file, ...rest.map(existing)];
  const names = namesOf(command, files, flags);
  const cuts = flags.z === undefined ? [] : String(flags.z).split(",").map((word) => word.trim()); // prettier-ignore
  const badCut = cuts.find((word) => word !== "-" && (word === "" || Number.isNaN(Number(word))));
  if (badCut !== undefined || (cuts.length > 1 && cuts.length !== files.length))
    fail(`--z: one height for every map, or one for each of the ${files.length} with commas between and - for a map seen from above (100,100,-), not ${flags.z}`); // prettier-ignore
  const cutOf = (nth) => {
    const word = cuts.length === 1 ? cuts[0] : cuts[nth];
    return word === undefined || word === "-" ? undefined : Number(word);
  };
  const options = {
    ...pictureOptions(file, flags, listed),
    ...figureOptions(flags, listed),
    ...defined({ mod: await profileOf(flags, listed) }),
    ...defined({ scale: numberOf(flags, "scale"), cols: numberOf(flags, "cols"), slice: flags.slice }),
  };
  if ("cols" in options && !(Number.isInteger(options.cols) && options.cols >= 1))
    fail(`--cols: a whole number from 1, not ${options.cols}`);
  // each map's own folder is looked in for its .wad files, after the game's
  options.folders = [...new Set([...options.folders, ...files.flatMap((each) => maps.mapOwnFolders(each))])];
  const picture = maps.compareOf(
    files.map((each, nth) => ({ map: readEither(each), name: names[nth], ...defined({ z: cutOf(nth) }) })),
    options,
  );
  const { facts } = picture;
  savePicture(
    to,
    picture,
    `${facts.maps.length} maps at one scale, ${Math.round(facts.scale * 1000) / 1000} pixels a unit; +y is up the picture and +x to its right; the bar is ${facts.bar} units`,
  );
  for (const each of facts.maps)
    console.log(
      `      ${each.name}: ${each.size.join(" x ")} units, ${each.z === null ? "seen from above" : `cut at z ${each.z}`}; its plan ${each.width}x${each.height} at pixel ${each.left},${each.top}`,
    );
}

// ── map-compile ────────────────────────────────────────────────────────────
/**
 * --timeout as `compileMap` takes it: seconds for every program ("600"), or for some by name
 * ("hlvis=600,hlrad=1200"). Undefined without the flag.
 */
function timeoutOf(command, said) {
  if (said === undefined) return undefined;
  if (/^\d+(\.\d+)?$/.test(said)) return Number(said) * 1000;
  const each = {};
  for (const word of String(said).split(",")) {
    const [tool, seconds] = word.split("=");
    if (!maps.COMPILERS.includes(tool) || !(Number(seconds) > 0))
      fail(`${command}: --timeout is seconds ("600"), or seconds by program ("hlvis=600,hlrad=1200"), not ${said}`); // prettier-ignore
    each[tool] = Number(seconds) * 1000;
  }
  return each;
}
function mapCompile({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.bsp");
  if (!isSource(file))
    fail(`${command}: brush source (a .map file) is what is compiled, not ${basename(file)}`);
  const wads = (listed.wad ?? []).map(existing);
  const result = maps.compileMap(file, {
    out: to,
    wads,
    wadinclude: Boolean(flags.wadinclude),
    fast: Boolean(flags.fast),
    vis: flags.vis !== false,
    light: flags.light !== false,
    compilers: flags.vhlt === undefined ? undefined : { folder: flags.vhlt },
    timeout: timeoutOf(command, flags.timeout),
    // what the compilers print is handed on as they work, on standard error: asked for, or to a terminal
    progress: flags.progress === undefined ? Boolean(process.stderr.isTTY) : Boolean(flags.progress),
  });
  for (const log of result.logs)
    console.log(
      `      ${log.tool}  ${log.seconds.toFixed(1)} s  ${log.code === 0 ? "ended" : log.code === null ? "stopped" : `code ${log.code}`}`,
    );
  if (result.portals) console.log(`      portals  ${maps.portalsLine(result)}`);
  for (const fact of result.facts) console.log(`      ${fact}`);
  for (const warning of result.warnings) console.log(`WARN  ${warning}`);
  for (const error of result.errors) console.log(`ERROR ${error}`);
  console.log(result.bsp ? `${result.bsp}: compiled` : "not compiled");
  process.exit(result.bsp ? 0 : 1);
}

// ── a map from a sketch ────────────────────────────────────────────────────
/** A sketch read and made a map's source, as `smak sketch` and `map-viewer` do: `{ map, sketch, wads }`. */
function sketchOf(command, file, flags, listed) {
  if (flags.legend === true) fail(`${command}: --legend needs the legend's file after it`);
  const legend = flags.legend === undefined ? {} : JSON.parse(readFileSync(existing(flags.legend), "utf8"));
  const scale = numberOf(flags, "scale") ?? legend.scale;
  let shapes;
  if (/\.svg$/i.test(file))
    shapes = maps.readSvgSketch(readFileSync(file, "utf8"), defined({ scale, grid: legend.grid }));
  else if (/\.png$/i.test(file)) {
    if (!legend.colours) fail(`${command}: a PNG is read by its colours: give --legend with "colours"`);
    shapes = maps.readPngSketch(readFileSync(file), defined({ colours: legend.colours, scale }));
  } else fail(`${command}: a sketch is an .svg or a .png, not ${basename(file)}`);
  const sketch = maps.sketchSpaces(shapes, legend);
  const wads = (listed.wad ?? legend.wad ?? []).map(existing);
  const map = maps.sketchMap(sketch, {
    wall: numberOf(flags, "wall") ?? legend.wall ?? 16,
    texture: flags.texture ?? legend.texture ?? "rock",
    sun: legend.sun,
    worldspawn: wads.length ? { wad: wads } : {},
  });
  return { map, sketch, wads };
}

/**
 * sketch: a drawing (an SVG from Inkscape, a PNG painted in flat colours) made a map's source: its shapes
 * read as spaces by the legend and their labels, carved from one block of rock, and written as a .map.
 */
function sketchCommand({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.map");
  if (!/\.map$/i.test(to)) fail(`${command}: -o names the .map to write, not ${basename(to)}`);
  const { map, sketch, wads } = sketchOf(command, file, flags, listed);
  // what the person added by hand to the map written last time (in J.A.C.K., to the .map itself) is kept:
  // the kit's own copy of what it wrote says what was the kit's
  const own = to.replace(/\.map$/i, ".smak.map");
  const made = maps.writeMap(map);
  let kept = null;
  if (flags.keep !== false && existsSync(to) && existsSync(own)) {
    kept = maps.additions(maps.readMap(readFileSync(to, "utf8")), maps.readMap(readFileSync(own, "utf8")));
    map.brushes.push(...kept.brushes);
    map.entities.push(...kept.entities);
  } else if (flags.keep !== false && existsSync(to) && !existsSync(own))
    fail(`${command}: ${basename(to)} is there and was not written by smak sketch (no ${basename(own)} beside it): give another -o, or take it away`);
  save(own, made);
  save(to, maps.writeMap(map));
  if (kept) console.log(`      kept what was added by hand: ${kept.brushes.length} brushes, ${kept.entities.length} entities`);
  for (const space of sketch.spaces)
    console.log(`      ${String(space.name).padEnd(16)} floor ${space.floor}, ceiling ${space.ceiling}`);
  console.log(
    `      ${sketch.spaces.length} spaces, ${sketch.starts.length || 1} places to start, ${sketch.lights.length} lamps; ${map.brushes.length} brushes`,
  );
  for (const left of sketch.skipped) console.log(`WARN  left out: ${left.label || "a shape"}: ${left.why}`);
  const plan = maps.checkPlan(map, { wads });
  for (const warning of plan.warnings) console.log(`WARN  ${warning}`);
  for (const error of plan.errors) console.log(`ERROR ${error}`);
  if (flags.plan !== undefined) {
    const picture = maps.planOfSource(map, {});
    savePicture(flags.plan, picture, "the sketch's map from above; +y is up the picture");
  }
  console.log(`${to}: written (map-compile it; map-reach on the .bsp walks it)`);
}

// ── map-viewer, map-props ──────────────────────────────────────────────────
/**
 * map-viewer: a map in 3D in the browser, reloaded as its file changes. A sketch (.svg, .png) is made a map
 * each time, as `smak sketch` makes it.
 */
async function mapViewer({ command, file, flags, listed }) {
  const { serveMapViewer } = await import("../viewer/map-serve.mjs");
  const sketch = /\.(svg|png)$/i.test(file);
  const load = sketch ? () => sketchOf(command, file, flags, listed).map : () => readEither(file);
  const files = [file, ...(flags.legend && flags.legend !== true ? [flags.legend] : [])];
  const options = defined({ folders: gameFolders(file, listed), mod: await profileOf(flags, listed) });
  await serveMapViewer({ load, files, name: basename(file), options, ...defined({ port: numberOf(flags, "port") }) });
  await new Promise(() => {});
}

/**
 * map-doors: room for a standing player before each door, on both its sides; the props (with --game, their boxes
 * from their models) counted as solid where they stand. Exit code 1 when a door has a side with no room.
 */
async function mapDoors({ command, file, flags, listed }) {
  const map = readEither(file);
  const options = defined({ folders: gameFolders(file, listed), mod: await profileOf(flags, listed) });
  // a thing that walks (a start, an NPC) is not a prop before a door: it moves, or it is where players appear
  const props = flags.props === false ? [] : maps.propsOf(map, options).props.filter((prop) => !maps.STARTS.test(prop.classname) && !maps.WALKERS.test(prop.classname)); // prettier-ignore
  const report = maps.doorClearance(map, defined({ mod: options.mod, props }));
  if (flags.json) {
    console.log(JSON.stringify(report, null, 1));
    process.exit(report.warnings.length ? 1 : 0);
  }
  const shut = report.doors.filter((door) => door.sides.some((side) => !side.room));
  const lines = report.doors.map((door) => `${String(door.number).padStart(4)}  ${door.classname.padEnd(20)} ${(door.targetname ?? "").padEnd(28)} ${placeText(door.at).padEnd(18)} ${door.width} wide, ${door.sides.map((side) => `${side.side} ${side.room ? "room" : side.prop ? `NONE (${side.prop.file ?? side.prop.classname} ${side.prop.number})` : "NONE"}`).join(", ")}`); // prettier-ignore
  const warnings = report.warnings.map((warning) => `WARN  ${warning}`);
  answered(command, file, flags, {
    detail: [...lines, `      ${report.doors.length} doors, ${props.length} props counted`, ...warnings],
    passed: !shut.length,
    said: shut.length ? `${shut.length} of ${report.doors.length} doors with no room before them on a side` : `room before every one of ${report.doors.length} doors, on both sides (${props.length} props counted)`, // prettier-ignore
    shown: [...lines.filter((_, i) => report.doors[i].sides.some((side) => !side.room)), ...warnings],
    look: shut.length ? "look: map-props --views shows a prop from in front of it; or a view from the door (map-view)" : "no picture to look at: the boxes decided", // prettier-ignore
  });
  process.exit(shut.length ? 1 : 0);
}

/**
 * map-props: each point entity with a model or a body held against the world: in a wall, floating, its nose
 * to a wall. --views: a picture of each warned one, from in front of it.
 */
async function mapProps({ command, file, flags, listed }) {
  const map = readEither(file);
  const options = defined({ folders: gameFolders(file, listed), mod: await profileOf(flags, listed) });
  const { props, warned, noted } = maps.propsOf(map, options);
  if (flags.json) {
    const numbers = (list) => list.map((prop) => prop.number);
    console.log(JSON.stringify({ props, warned: numbers(warned), noted: numbers(noted) }, null, 1));
    return;
  }
  const shown = flags.all ? props : [...warned, ...noted].sort((a, b) => a.number - b.number);
  for (const prop of shown) {
    const clear = Object.entries(prop.clear).map(([way, distance]) => `${way} ${distance ?? "-"}`).join(", ");
    console.log(
      `${String(prop.number).padStart(4)}  ${prop.classname.padEnd(18)} ${(prop.file ?? prop.targetname ?? "").padEnd(22)} ${placeText(prop.origin).padEnd(18)} yaw ${String(prop.yaw).padEnd(6)} walls: ${clear}`,
    );
    for (const warning of prop.warnings) console.log(`WARN        ${warning}`);
    for (const note of prop.notes) console.log(`NOTE        ${note}`);
  }
  console.log(`      ${props.length} entities with a model or a body; ${warned.length} warned, ${noted.length} with a note to look at${flags.all ? "" : " (--all lists every one)"}`);
  if (flags.views !== undefined && flags.views !== true && warned.length + noted.length) {
    mkdirSync(flags.views, { recursive: true });
    const draw = isSource(file) ? maps.drawSource : maps.drawMap;
    for (const prop of [...warned, ...noted].slice(0, 60)) {
      const centre = [0, 1, 2].map((axis) => (prop.min[axis] + prop.max[axis]) / 2);
      // from the way with the most room before a wall: in front of it when there is room there
      const turn = { front: 0, left: 90, back: 180, right: -90 };
      const roomiest = Object.keys(turn).reduce((best, way) =>
        (prop.clear[way] ?? Infinity) > (prop.clear[best] ?? Infinity) + 24 ? way : best, "front");
      const yaw = ((prop.yaw + turn[roomiest]) * Math.PI) / 180;
      const size = Math.max(prop.max[0] - prop.min[0], prop.max[1] - prop.min[1]);
      const away = Math.min(size / 2 + 96, size / 2 + (prop.clear[roomiest] ?? Infinity) - 8);
      const from = [centre[0] + Math.cos(yaw) * away, centre[1] + Math.sin(yaw) * away, centre[2] + 40];
      const to = join(flags.views, `${prop.number}_${prop.classname}.png`);
      try {
        const picture = draw(map, { folders: options.folders, mod: options.mod, models: true, from, to: centre, entities: "all" });
        save(to, smak.png(picture.width, picture.height, picture.rgba));
        console.log(`${to}  from its ${roomiest} (${roomiest === "front" ? "the way it faces" : "the most room"}), looking at it`);
      } catch (error) {
        console.log(`      ${prop.number}: no view: ${error.message}`);
      }
    }
  }
}

// ── map-decompile ──────────────────────────────────────────────────────────
/**
 * map-decompile: a compiled map made back into brush source. The .wad files its worldspawn lists are kept
 * where they are found: in the --game folders, and in the folder its maps/ folder is in (`valve` for
 * valve/maps/x.bsp). What it carries inside it that none of them has is written beside the .map as
 * <name>_dc.wad, already named in the `wad` key.
 */
function mapDecompile({ command, file, flags, listed }) {
  const to = need(command, flags.o, "-o out.map");
  if (isSource(file)) fail(`${command}: a compiled map (.bsp) is what is decompiled, not ${basename(file)}`);
  const name = basename(file).replace(/\.bsp$/i, "");
  const folders = [...new Set([...(listed.game ?? []).map(existingFolder), dirname(dirname(resolve(file)))])];
  const started = performance.now();
  const result = maps.decompile(readFileSync(file), {
    name,
    folders,
    canon: flags.canon !== false,
    tips: flags.tips !== false,
    cuts: flags.cuts !== false,
    merge: flags.merge !== false,
  });
  save(to, result.map);
  console.log(`      ${maps.decompileSummary(result)}`);
  if (result.wad) {
    const wadFile = join(dirname(to), result.wad.name);
    save(wadFile, result.wad.bytes);
    console.log(`      ${result.wad.textures.length === 1 ? "1 texture" : `${result.wad.textures.length} textures`} it carries inside it, in none of its .wad files: ${wadFile}`); // prettier-ignore
  }
  for (const warning of result.warnings) console.log(`WARN  ${warning}`);
  console.log(`${to}: decompiled in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

// ── the Source engine (GMod) ───────────────────────────────────────────────
/**
 * gmod-port: a GoldSrc model ported to Garry's Mod (src/source/gmod.mjs): its compiler's files and an addon
 * folder under -o, compiled by GMod's studiomdl, the compiled model held to the original and drawn.
 */
function gmodPort({ command, file, flags }) {
  const out = need(command, flags.o, "-o <folder>: where the port goes (src/ and addon/ under it)");
  if (flags.collision !== undefined && !smak.source.COLLISIONS.includes(flags.collision))
    fail(`${command}: --collision ${smak.source.COLLISIONS.join(", ")}, not ${flags.collision}`);
  const mass = numberOf(flags, "mass");
  if (mass !== undefined && !(mass > 0)) fail(`${command}: --mass is kilograms, more than 0, not ${flags.mass}`);
  if (flags.kind !== undefined && !smak.source.PORT_KINDS.includes(flags.kind))
    fail(`${command}: --kind ${smak.source.PORT_KINDS.join(", ")}, not ${flags.kind}`);
  const handRoll = numberOf(flags, "hand-roll");
  const result = smak.source.portToGmod(
    file,
    defined({
      out,
      name: flags.name,
      folder: flags.folder,
      collision: flags.collision,
      surfaceprop: flags.surfaceprop,
      mass,
      kind: flags.kind,
      handRoll,
      upper: flags.upper === true ? true : undefined,
      studiomdl: flags.studiomdl,
      gmod: flags.gmod,
      compile: flags.compile !== false,
    }),
  );
  const warnings = result.warnings.map((warning) => `WARN  ${warning}`);
  const faults = result.faults.map((fault) => `ERROR ${fault}`);
  let look;
  if (result.picture) {
    const to = join(out, "sheet.png");
    save(to, smak.png(result.picture.width, result.picture.height, result.picture.rgba));
    look = `look at ${to}: six views of the compiled model, read back from its own files`;
  }
  const where = `${join(out, "addon")} (into garrysmod/addons/<name>/), models/${result.modelname}`;
  answered(command, file, flags, {
    detail: [...result.said.map((line) => `      ${line}`), `      the QC: ${result.qc}`, `      the addon: ${where}`, ...warnings, ...faults], // prettier-ignore
    passed: result.passed,
    said:
      flags.compile === false
        ? `written, not compiled (--no-compile): ${result.qc}`
        : result.passed
          ? `compiled and whole: ${where}; ${result.said.find((line) => /^collides as/.test(line))}${warnings.length ? `; ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`
          : `${faults.length} things lost on the way to Source`,
    shown: [...faults, ...warnings],
    look,
  });
  process.exit(result.passed ? 0 : 1);
}

// ── s&box (Source 2) ───────────────────────────────────────────────────────
/**
 * sbox-port: a GoldSrc model ported to s&box (src/sbox/port.mjs): DMX, a .vmdl, PNG and .vmat under -o (a project's
 * Assets folder), compiled by s&box's own resourcecompiler.
 */
/** The options a model's port to s&box is made with, from the flags (sbox-port's, and sbox-check's to make it again). */
function sboxPortOptions(command, flags) {
  if (flags.kind !== undefined && !smak.source.PORT_KINDS.includes(flags.kind))
    fail(`${command}: --kind ${smak.source.PORT_KINDS.join(", ")}, not ${flags.kind}`);
  if (flags.collision !== undefined && !smak.source.COLLISIONS.includes(flags.collision))
    fail(`${command}: --collision ${smak.source.COLLISIONS.join(", ")}, not ${flags.collision}`);
  const mass = numberOf(flags, "mass");
  if (mass !== undefined && !(mass > 0)) fail(`${command}: --mass is kilograms, more than 0, not ${flags.mass}`);
  if (flags.lighting !== undefined && !["sbox", "goldsrc"].includes(flags.lighting))
    fail(`${command}: --lighting sbox or goldsrc, not ${flags.lighting}`);
  return { name: flags.name, folder: flags.folder, kind: flags.kind, collision: flags.collision, surfaceprop: flags.surfaceprop, mass, lighting: flags.lighting, sbox: flags.sbox }; // prettier-ignore
}

/** A glTF model's port (a .glb or .gltf given to sbox-port): its skin and animations as they are (src/sbox/glb.mjs). */
function sboxPortGlb({ command, file, flags, out }) {
  const result = smak.sbox.glbToSboxFile(existing(file), defined({ out, name: flags.name, folder: flags.folder, sbox: flags.sbox, compile: flags.compile !== false })); // prettier-ignore
  const f = result.facts;
  const warnings = result.warnings.map((warning) => `WARN  ${warning}`);
  const notes = (result.compiled?.notes ?? []).map((note) => `NOTE  ${note}`);
  const made = `${f.bones.length} bones, ${f.triangles} triangles, ${f.materials} materials, ${f.animations.length} animations (${f.animations.map((a) => a.name).join(", ")})`; // prettier-ignore
  answered(command, file, flags, {
    detail: [`      ${made}`, `      the model: ${result.written}`, ...notes, ...warnings],
    passed: true,
    said:
      flags.compile === false
        ? `written, not compiled (--no-compile): ${result.written}`
        : `compiled in ${(result.compiled.took / 1000).toFixed(1)} s: ${result.vmdl} (${made})${warnings.length ? `; ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`,
    shown: [...notes, ...warnings],
  });
}

function sboxPort({ command, file, flags }) {
  const out = need(command, flags.o, "-o <folder>: an s&box project's Assets folder (models/ and materials/ under it)");
  if (/\.(glb|gltf)$/i.test(file)) return sboxPortGlb({ command, file, flags, out });
  const result = smak.sbox.portToSboxFile(
    existing(file),
    defined({ out, ...sboxPortOptions(command, flags), compile: flags.compile !== false }),
  );
  const f = result.facts;
  const warnings = result.warnings.map((warning) => `WARN  ${warning}`);
  const notes = (result.compiled?.notes ?? []).map((note) => `NOTE  ${note}`);
  const { physics } = result;
  const collides = !physics
    ? "collides as nothing"
    : f.collision === "ragdoll"
      ? `collides as a ragdoll of ${physics.shapes.length} pieces and ${physics.joints.length} joints (${physics.shapes[0].surface})`
      : `collides as its ${f.collision} (${physics.shapes[0].surface})`;
  const graph = result.graph ? ` (${f.poses.join(", ")} blended in its graph)` : "";
  const sounds = f.sounds ? `; ${f.sounds} ${f.sounds === 1 ? "sound" : "sounds"} its events play` : "";
  const made = `${f.bones.length} bones, ${f.meshes.length} meshes, ${f.sequences.length} animations${graph}, ${f.skins} ${f.skins === 1 ? "skin" : "skins"}, ${f.bodygroups.length} bodygroups, ${f.attachments.length} attachments, ${f.hitboxes} hit boxes; ${collides}${sounds}`; // prettier-ignore
  answered(command, file, flags, {
    detail: [`      ${made}`, `      the model: ${result.written}`, ...(result.graph ? [`      its animation graph: ${result.graph}`] : []), ...notes, ...warnings], // prettier-ignore
    passed: true,
    said:
      flags.compile === false
        ? `written, not compiled (--no-compile): ${result.written}`
        : `compiled in ${(result.compiled.took / 1000).toFixed(1)} s: ${result.vmdl} (${made})${warnings.length ? `; ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`,
    shown: [...notes, ...warnings],
  });
}

/**
 * sbox-check: a model's port read back in s&box's editor and held to the original (src/sbox/check.mjs): its
 * bones, animations, parts, skins, attachments and hit boxes, and each animation's poses bone by bone.
 */
async function sboxCheck({ command, file, flags }) {
  const project = need(command, flags.project, "--project <folder>: the s&box project the port is in (its .sbproj's folder)");
  // a .glb or .gltf held to its own nodes (src/sbox/glb.mjs), a GoldSrc model to its frames
  const glb = /\.(glb|gltf)$/i.test(file);
  const result = await (glb ? smak.sbox.checkSboxGlb : smak.sbox.checkSboxPort)(
    existing(file),
    defined({
      project,
      ...sboxPortOptions(command, flags),
      perSequence: numberOf(flags, "frames"),
      tolerance: numberOf(flags, "tolerance"),
      look: flags.look !== false,
      shot: flags.o,
    }),
  );
  const faults = result.faults.map((fault) => `ERROR ${fault}`);
  answered(command, file, flags, {
    detail: [...result.said.map((line) => `      ${line}`), `      the editor: ${result.opened ? "opened for the check, and closed" : "the one open on the project"}`, ...faults], // prettier-ignore
    passed: result.passed,
    said: result.passed ? `whole in s&box: ${result.said.join("; ")}` : `${faults.length} things not as the original has them`,
    shown: faults,
    look: result.shot ? (glb ? `look at ${result.shot}: s&box's own pictures of it in its first animation's first frame, from four sides` : `look at ${result.shot}: the original drawn by the kit (above) and the port by s&box (below), four views`) : undefined, // prettier-ignore
  });
  process.exit(result.passed ? 0 : 1);
}

/**
 * sbox-map: a GoldSrc map made an s&box scene (src/sbox/map.mjs): its faces as the scene editor's meshes, its
 * textures, sky, clip brushes, starts and lights, under -o (a project's Assets folder).
 */
async function sboxMap({ command, file, flags, listed }) {
  const out = need(command, flags.o, "-o <folder>: an s&box project's Assets folder (scenes/ and materials/ under it)");
  // --mod: the game's own start classes (MSC's ms_player_spawn and ms_player_begin)
  const mod = await profileOf(flags, listed);
  const result = smak.sbox.portMapToSboxFile(
    existing(file),
    defined({ out, name: flags.name, folder: flags.folder, folders: flags.game ? [existingFolder(flags.game)] : undefined, starts: mod?.starts, lighting: flags.lighting }), // prettier-ignore
  );
  const f = result.facts;
  const warnings = result.warnings.map((warning) => `WARN  ${warning}`);
  const clips = result.meshes.filter((m) => m.collision === "Hull").length;
  const made = `${f.faces} faces in ${f.meshes - clips} meshes, ${clips} clip brushes, ${f.materials} materials, sky ${f.sky ?? "none"}, ${f.spawns} ${f.spawns === 1 ? "start" : "starts"}, ${f.lights} ${f.lights === 1 ? "light" : "lights"}`; // prettier-ignore
  answered(command, file, flags, {
    detail: [`      ${made}`, `      the scene: ${join(out, result.scene)}`, ...warnings],
    passed: true,
    said: `written: ${result.scene} (${made})${warnings.length ? `; ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`, // prettier-ignore
    shown: warnings,
  });
}

/**
 * sbox-map-check: a map's port opened in s&box's editor and held to the GoldSrc map (src/sbox/mapcheck.mjs): its
 * meshes and materials, where a player is blocked, its starts' floors, and its light pictured beside GoldSrc's.
 */
async function sboxMapCheck({ command, file, flags, listed }) {
  const project = need(command, flags.project, "--project <folder>: the s&box project the port goes in (its .sbproj's folder)");
  const mod = await profileOf(flags, listed);
  const result = await smak.sbox.checkSboxMap(
    existing(file),
    defined({
      project,
      name: flags.name,
      folder: flags.folder,
      folders: flags.game ? [existingFolder(flags.game)] : undefined,
      starts: mod?.starts,
      lighting: flags.lighting,
      count: numberOf(flags, "count"),
      seed: numberOf(flags, "seed"),
      allow: numberOf(flags, "allow"),
      light: flags.light !== false,
      sbox: flags.sbox,
      shot: flags.o,
    }),
  );
  const faults = result.faults.map((fault) => `ERROR ${fault}`);
  answered(command, file, flags, {
    detail: [...result.said.map((line) => `      ${line}`), `      the editor: ${result.opened ? "opened for the check, and closed" : "the one open on the project"}`, ...faults], // prettier-ignore
    passed: result.passed,
    said: result.passed ? `whole in s&box: ${result.said.join("; ")}` : `${faults.length} things not as the GoldSrc map has them`,
    shown: faults,
    look: result.shot ? `look at ${result.shot}: GoldSrc's view from the first start (left) beside s&box's (right)` : undefined,
  });
  process.exit(result.passed ? 0 : 1);
}

/**
 * gmod-map: a GoldSrc map rewritten as a Source map for Garry's Mod (src/source/map.mjs), its geometry, light and
 * visibility kept, its collision rebuilt, its physics made by GMod's own vphysics: an addon folder under -o.
 */
function gmodMap({ command, file, flags }) {
  const out = need(command, flags.o, "-o <folder>: where the port goes (addon/ under it)");
  const result = smak.source.portMapToGmod(
    existing(file),
    defined({
      out,
      name: flags.name,
      folder: flags.folder,
      folders: flags.game ? [existingFolder(flags.game)] : undefined,
      valve: flags.valve === undefined ? undefined : flags.valve === "none" ? null : existingFolder(flags.valve),
      physics: flags.physics !== false,
      vphysics: flags.vphysics,
      gmod: flags.gmod,
      studiomdl: flags.studiomdl,
    }),
  );
  const f = result.facts;
  const warnings = result.warnings.map((warning) => `WARN  ${warning}`);
  const where = `${join(out, "addon")} (into garrysmod/addons/<name>/), maps/${result.name}.bsp`;
  answered(command, file, flags, {
    detail: [
      `      ${f.faces} faces, ${f.brushes} brushes (${f.clipBrushes} clip), ${f.clusters} clusters, ${f.leaves} leaves (${f.solidSplitOff} solid split off)`, // prettier-ignore
      `      textures from ${f.textureSources.join(", ") || "none"}; ${f.packed} files inside the map, ${result.files.length} shared in the addon; sky ${f.sky}`, // prettier-ignore
      `      physics: ${f.physics ? "made by GMod's vphysics" : "none"}; props ported: ${result.props.length}`,
      `      the addon: ${where}`,
      ...warnings,
    ],
    passed: true,
    said: `written: ${where}; ${f.faces} faces, ${f.brushes} brushes, ${f.physics ? "with" : "without"} physics${warnings.length ? `; ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`, // prettier-ignore
    shown: warnings,
  });
}

/** The RCON options a command was given: --host, --port, --password (else SMAK_RCON_PASSWORD). */
const rconOf = (flags) => defined({ host: flags.host, port: numberOf(flags, "port"), password: flags.password });

/** gmod-rcon: console commands sent to a running GMod, its answer printed. */
async function gmodRcon({ file, rest, flags }) {
  process.stdout.write(await smak.source.rcon([file, ...rest], rconOf(flags)));
}

/**
 * gmod-probe: a Lua probe run in the game (a file, or a built-in one by its name: map), its PASS, FAIL and
 * NOTE lines said, and PASS or FAIL for the whole: FAIL on any failed line, or no DONE in time.
 */
async function gmodProbe({ command, file, flags }) {
  const own = existsSync(file) && !statSync(file).isDirectory();
  const lua = own ? readFileSync(file, "utf8") : smak.source.builtInProbe(file);
  if (lua === null) fail(`${command}: no file ${file}, and no built-in probe of that name (${smak.source.builtInProbes().join(", ")})`);
  const name = flags.name ?? basename(file).replace(/\.lua$/i, "").replace(/\W/g, "_");
  const wait = numberOf(flags, "wait");
  const answer = await smak.source.runProbe(lua, defined({ name, game: flags.game, client: flags.client === true, wait, ...rconOf(flags) }));
  const lines = [
    ...answer.passed.map((line) => `PASS  ${line}`),
    ...answer.notes.map((line) => `NOTE  ${line}`),
    ...answer.failed.map((line) => `FAIL  ${line}`),
  ];
  if (answer.timedOut) lines.push(`FAIL  no DONE from the probe in ${(wait ?? 30000) / 1000} s${answer.text ? "" : ": it never called done(), or the game did not run it (its console says)"}`); // prettier-ignore
  const passed = !answer.failed.length && !answer.timedOut;
  if (flags.o) save(flags.o, `${lines.join("\n")}\n`);
  else for (const line of lines) console.log(line);
  console.log(`${passed ? "PASS" : "FAIL"}: probe ${name}: ${answer.passed.length} passed, ${answer.failed.length + (answer.timedOut ? 1 : 0)} failed${flags.o ? ` (the lines: ${flags.o})` : ""}`); // prettier-ignore
  process.exit(passed ? 0 : 1);
}

/**
 * gmod-collision: a GoldSrc map held against its port loaded in the game, spot by spot. PASS when they agree
 * on all but --allow of the spots (in hundredths of one: 0.5 is half of one in a hundred).
 */
async function gmodCollision({ command, file, flags }) {
  const allow = numberOf(flags, "allow") ?? 0.5;
  const result = await smak.source.checkCollision(
    existing(file),
    defined({
      name: flags.name,
      count: numberOf(flags, "count"),
      seed: numberOf(flags, "seed"),
      ducked: flags.ducked === true,
      noclip: flags.noclip === true,
      game: flags.game,
      wait: numberOf(flags, "wait"),
      ...rconOf(flags),
    }),
  );
  const { spots, both, free, onlyGoldSrc, onlySource, intoWorld, unexplained } = result;
  const show = (list) => list.slice(0, numberOf(flags, "show") ?? 15).map((p) => p.join(" ")).join(" | ");
  // a spot where the drawn world is inside the player's box is blocked rightly by Source, whatever GoldSrc's
  // looser hull says
  const off = onlyGoldSrc.length + unexplained.length;
  const share = (100 * off) / spots;
  const passed = share <= allow;
  answered(command, file, flags, {
    detail: [
      `      ${spots} spots: blocked in both ${both}, free in both ${free}`,
      `      blocked only in GoldSrc ${onlyGoldSrc.length}${onlyGoldSrc.length ? `: ${show(onlyGoldSrc)}` : ""}`,
      `      blocked only in the port ${onlySource.length}: ${intoWorld.length} with the drawn world inside the player's box (GoldSrc's hull looser than its geometry), ${unexplained.length} not${unexplained.length ? `: ${show(unexplained)}` : ""}`, // prettier-ignore
    ],
    passed,
    said: `${spots} spots, ${off} where GoldSrc and the port disagree (${share.toFixed(2)} in a hundred; ${allow} allowed); ${intoWorld.length} more blocked only in the port, rightly, the world inside the box`, // prettier-ignore
    shown: [
      ...(onlyGoldSrc.length ? [`only GoldSrc (the player's middle): ${show(onlyGoldSrc)}`] : []),
      ...(unexplained.length ? [`only the port, the world not in the box (the player's middle): ${show(unexplained)}`] : []),
    ],
  });
  process.exit(passed ? 0 : 1);
}

/**
 * gmod-server: a dedicated GMod server (SteamCMD's app 4020) started on a map, the console in
 * garrysmod/console.log; it runs until it is stopped.
 */
async function gmodServer({ command, file, flags }) {
  const map = need(command, flags.map, "--map <name>: the map it starts on");
  const child = smak.source.startGmodServer(
    file,
    defined({ map, port: numberOf(flags, "port"), password: flags.password, gamemode: flags.gamemode, players: numberOf(flags, "players") }),
  );
  console.log(`gmod-server: srcds started on ${map}, port ${child.port}, its console in ${child.log}; stopped by gmod-rcon quit --port ${child.port}`);
  await new Promise((resolve) => child.process.on("exit", resolve));
}

/** gmod-shoot: a screenshot from GMod's client with the eye at x y z, looking along pitch yaw. */
async function gmodShoot({ command, file, rest, flags }) {
  const [y, z, pitch = 0, yaw = 0] = rest;
  if (z === undefined) fail(`${command}: <x> <y> <z> [pitch yaw]: the eye's place, and where it looks`);
  const shot = await smak.source.shoot([file, y, z], [pitch, yaw], defined({ game: flags.game, fov: numberOf(flags, "fov"), ...rconOf(flags) })); // prettier-ignore
  if (flags.o) {
    save(flags.o, readFileSync(shot));
    console.log(flags.o);
  } else console.log(shot);
}

/**
 * A Source model named on the command line: a .mdl on the disk (its .vvd and .vtx beside it, its materials
 * looked for under the folder that holds its models/, --addon, and GMod's), or a path under the game
 * (models/kleiner.mdl) found in GMod's folders and packs.
 */
function sourceModelOf(command, file, flags) {
  const gmod = flags.gmod ?? smak.source.findGmod();
  const onDisk = existsSync(file);
  let path = file;
  const more = flags.addon ? [existingFolder(flags.addon)] : [];
  if (onDisk) {
    // the folder above models/ is an addon's (or the game's), where its materials are
    const full = resolve(file).replace(/\\/g, "/");
    const at = full.toLowerCase().lastIndexOf("/models/");
    if (at < 0) fail(`${command}: ${file} is not under a models/ folder, and its materials are looked for beside that`);
    more.unshift(full.slice(0, at));
    path = full.slice(at + 1);
  }
  const files = gmod ? smak.source.gmodFiles(gmod, { more }) : smak.source.sourceFiles({ folders: more });
  if (!onDisk && !files.has(path)) fail(`${command}: no file ${file}, and none of that path in GMod's folders and packs${gmod ? "" : " (no GMod found: --gmod)"}`); // prettier-ignore
  return smak.source.readSourceModel(path, files);
}

/** source-info: what a Source model holds. */
function sourceInfo({ command, file, flags }) {
  const model = sourceModelOf(command, file, flags);
  const { mdl } = model;
  if (flags.json) {
    const materials = model.materials.map(({ texture, ...m }) => ({ ...m, texture: texture && { width: texture.width, height: texture.height, format: texture.format } })); // prettier-ignore
    console.log(JSON.stringify({ ...mdl, triangles: model.triangles.length, materials, missing: model.missing }));
    return;
  }
  console.log(`${mdl.name}: Source model, version ${mdl.version}; ${model.triangles.length} triangles`);
  console.log(`  bones (${mdl.bones.length}): ${mdl.bones.map((b) => b.name).join(", ")}`);
  console.log(`  bodygroups: ${mdl.bodyparts.map((part) => `${part.name} [${part.models.map((m) => `${m.name || "blank"} ${m.vertices}v`).join(", ")}]`).join("; ")}`); // prettier-ignore
  for (const material of model.materials)
    console.log(`  material ${material.name}: ${material.vmt ? `${material.shader}, ${material.texture ? `${material.texture.width}x${material.texture.height}` : "its picture not found"}` : "not found"}`); // prettier-ignore
  console.log(`  skin families: ${mdl.skins.length}; attachments: ${mdl.attachments.map((a) => a.name).join(", ") || "none"}; hit boxes: ${mdl.hitboxes.length}`); // prettier-ignore
  console.log(`  animations (${mdl.sequences.length}): ${mdl.sequences.map((s) => (s.activity ? `${s.name} (${s.activity})` : s.name)).join(", ")}`); // prettier-ignore
}

/** source-render, source-sheet: a Source model drawn by the kit (render's views; --body, --skin). */
function sourceRender({ command, file, flags }) {
  const to = need(command, flags.o, "-o out.png");
  const model = sourceModelOf(command, file, flags);
  const options = defined({
    sheet: command === "source-sheet",
    size: numberOf(flags, "size"),
    view: flags.view,
    yaw: numberOf(flags, "yaw"),
    pitch: numberOf(flags, "pitch"),
    zoom: numberOf(flags, "zoom"),
    width: numberOf(flags, "width"),
    height: numberOf(flags, "height"),
    body: numberOf(flags, "body"),
    skin: numberOf(flags, "skin"),
  });
  const picture = smak.source.renderSource(model, options);
  save(to, smak.png(picture.width, picture.height, picture.rgba));
  if (model.missing.length) console.log(`WARN  materials found nowhere (drawn grey): ${model.missing.join(", ")}`);
  console.log(to);
}

// ── play ───────────────────────────────────────────────────────────────────
/**
 * play: a map seen in the game itself, in a browser build of the engine at an address. The steps are checked
 * and Playwright looked for before any browser is opened; each thing done is printed as it is done, and the
 * pictures' paths at the end.
 */
async function playMap({ command, file: url, flags, listed }) {
  const { playOf, playPartOf, messagesOf, playwrightFrom, browserDriver, playSession, patternOf, HARDWARE_GL } = smak.play;
  const { serveSession, attachSession, closeSession, sessionState, expectationLine, fightLine, summaryLines, SESSION_PORT } =
    smak.play;
  /** The steps of a file, or the command stopped: a file that is not there, or is no JSON. */
  const stepsOf = (file) => {
    if (file === undefined) return [];
    try {
      return JSON.parse(readFileSync(existing(file), "utf8"));
    } catch (error) {
      return fail(`${command}: --steps is a JSON file that holds a list of steps, and ${file} does not read as JSON (${error.message})`); // prettier-ignore
    }
  };
  // what a run tells as it goes (a line a step): printed as it comes with --verbose, else kept for the run's
  // folder (told.txt), so that a run that passes prints five lines or fewer
  let told = [];
  const tell = (line) => (flags.verbose ? console.log(line) : told.push(line));
  /** The lines of the run so far, written beside its pictures: the file's path. */
  const toldFile = (out, more) => {
    const to = join(out, "told.txt");
    save(to, `${[...told, ...more].join("\n")}\n`);
    told = [];
    return to;
  };
  /**
   * One run printed: whether what it expected held, last, as PASS or FAIL, and which picture to look at.
   * Every line of before 0.27 (each picture, each fight, each section) is in told.txt, and printed with
   * --verbose. False when an expectation did not hold.
   */
  const report = (run) => {
    const failed = run.expectations.filter((each) => !each.passed);
    const held = `${run.expectations.length - failed.length} of ${run.expectations.length} expectations held   (${(run.took / 1000).toFixed(1)} s)`; // prettier-ignore
    const last = run.expectations.length
      ? `${failed.length ? "FAIL" : "PASS"}: ${held}`
      : `PASS: done in ${(run.took / 1000).toFixed(1)} s (nothing was expected of it: its pictures are the test)`;
    const fights = (run.fights ?? []).map(fightLine);
    const summary = run.summary ? summaryLines(run.summary) : [];
    const detail = [
      `${run.pictures.length} pictures in ${run.out}${run.sheet ? `, all of them in ${run.sheet}` : ""}`,
      ...run.pictures.map((picture) => `  ${picture}`),
      `what the game said: ${run.logFile}${run.linesFile ? ` (and ${run.linesFile})` : ""}`,
      ...fights,
      ...summary,
      ...run.expectations.map(expectationLine),
    ];
    const pictures = run.sheet ?? run.pictures.at(-1);
    const look = !pictures
      ? "no picture was taken"
      : !run.expectations.length
        ? `look at ${pictures}: nothing was expected, so only the pictures tell`
        : failed.length
          ? `look at ${pictures} (the pictures, ${run.pictures.length}) beside the lines that failed`
          : "no picture to look at: the expectations decided";
    const file = toldFile(run.out, [...detail, look, last]);
    if (flags.verbose) for (const line of detail) console.log(line);
    else {
      console.log(`what was done: ${file}; what the game said: ${run.logFile}`);
      if (failed.length) for (const each of failed) console.log(expectationLine(each));
      // one fight's line is the measure of its difficulty; the run's own line counts the rest
      console.log(fights.length === 1 ? fights[0] : (summary.at(-1) ?? `${run.steps?.length ?? 0} steps`));
    }
    console.log(look);
    console.log(last);
    return failed.length === 0;
  };
  /** A run that stopped, printed; false. */
  const stopped = (error, out) => {
    const lines = [
      ...(error.fights ?? []).map(fightLine),
      ...(error.summary ? summaryLines(error.summary) : []),
      ...(error.expectations ?? []).map(expectationLine),
      ...(error.sheet ? [`the pictures up to there: ${error.sheet}`] : []),
      ...(error.logFile ? [`what the game said up to there: ${error.logFile}`] : []),
    ];
    const last = `FAIL: ${/^play: /.test(error.message) ? error.message : `${command}: ${sayOf(error)}`}`;
    // the last steps done say where it stopped; all of them are in told.txt
    if (!flags.verbose) for (const line of told.slice(-STOPPED_STEPS)) console.error(line);
    if (told.length && out) console.error(`what was done up to there: ${toldFile(out, [...lines, last])}`);
    for (const line of lines) console.error(line);
    console.error(last);
    return false;
  };
  // `smak play native ...`: the person's own game from Steam, by its console, in place of a page
  const native = url === "native";
  try {
    if (!native && !/^https?:\/\//i.test(url))
      fail(
        `${command}: the address of the page that runs the game comes first (http://...), or native for the game Steam installed, not ${url}${flags.attach ? `: with --attach it is the session's (http://127.0.0.1:${SESSION_PORT})` : ""}`,
      );
    if (native && flags.attach) fail(`${command}: native plays the installed game from here; --attach is a page's session`); // prettier-ignore
    if (flags.attach && flags.close) {
      await closeSession(url);
      return console.log(`${url}: the session is closed`);
    }
    // each --map is a run, with the --steps given in the same place; -o is its folder, or theirs
    const mapsGiven = listed.map ?? [];
    const stay = flags.stay === true;
    if (!flags.serve && !stay && !mapsGiven.length)
      fail(`${command}: --map <name>: the map to load, as the console's \`map\` takes it`);
    if (stay && (!flags.attach || mapsGiven.length))
      fail(`${command}: --stay goes on in the map a session is in: with --attach, and without --map`);
    const stepFiles = listed.steps ?? [];
    if (stepFiles.length > Math.max(1, mapsGiven.length))
      fail(`${command}: ${stepFiles.length} --steps and ${mapsGiven.length} --map: a list of steps goes with a map`); // prettier-ignore
    const patterns = (name) => (listed[name] ?? []).filter((each) => patternOf(each, `--${name}`));
    const expect = patterns("expect");
    const expectNot = patterns("expect-not");
    const put = (listed.put ?? []).map((each) => {
      const [path, ...rest] = each.split("=");
      if (!path || !rest.length) fail(`${command}: --put <place in the game's files>=<file>, not ${each}`);
      return { path, file: existing(rest.join("=")) };
    });
    // a folder laid over the game's: what changed in it since the session had it is put
    const over = (listed.over ?? []).map((each) => {
      const [path, ...rest] = each.split("=");
      if (!path || !rest.length) fail(`${command}: --over <place in the game's files>=<folder>, not ${each}`);
      return { path, folder: rest.join("=") };
    });
    const out = flags.o ?? "play";
    const runs = (stay ? [null] : mapsGiven).map((map, index, all) => ({
      ...(stay ? { stay: true } : { map }),
      steps: stepsOf(stepFiles[index]),
      out: all.length > 1 ? join(out, `${index + 1}-${String(map).replace(/[^A-Za-z0-9_-]/g, "_")}`) : out,
      ...defined({ loads: numberOf(flags, "loads"), from: index ? undefined : flags.from }),
      ...{ expect, expectNot, sheet: flags.sheet !== false },
      // a third of the page each way unless told: the size that tells where the player is and what he sees
      shrink: flags["full-pictures"] === true ? 1 : PLAY_SHRINK,
      // the files are put once, before the first map
      put: index ? [] : put,
      ...(over.length ? { over } : {}),
    }));

    // a session served elsewhere: the steps are checked there, against its profile
    if (flags.attach) {
      await sessionState(url);
      let held = true;
      for (const run of runs) {
        tell(`${url}: ${run.stay ? "staying" : `map ${run.map}`}, ${run.steps.length} steps      (from the start, it took, what)`); // prettier-ignore
        held = (await attachSession(url, run, { tell }).then(report, (error) => stopped(error, run.out))) && held; // prettier-ignore
      }
      if (!held) process.exit(1);
      return;
    }

    const mod = await profileOf(flags, listed);
    for (const run of runs) playOf(run.steps, { mod });
    const [wide, high] = playPartOf(mod).screen ?? [];
    const width = numberOf(flags, "width") ?? wide;
    const height = numberOf(flags, "height") ?? high;
    // the game's folder: --game-folder, else the profile's (ts, msc), else Half-Life's own
    const gameFolder = flags["game-folder"] ?? maps.mapProfileOf(flags.mod)?.folder ?? "valve";
    const driver = native
      ? smak.play.nativeDriver(
          defined({
            ...{ halfLife: flags["half-life"], mod: gameFolder, width, height },
            ...{ input: flags.input === true, quiet: numberOf(flags, "quiet") },
            pictures: flags["window-pictures"] === true ? "window" : undefined,
          }),
        )
      : browserDriver(
          defined({ url, playwright: playwrightFrom(flags.playwright ?? process.env.PLAYWRIGHT_DIR), width, height, messages: messagesOf(mod), headless: flags.show !== true, args: flags.gpu ? HARDWARE_GL : undefined }), // prettier-ignore
        );
    if (wide && (width !== wide || height !== high))
      console.log(`WARN  the profile's clicks were measured on a page of ${wide} by ${high}, and this one is ${width} by ${height}`); // prettier-ignore
    // a session served keeps printing what its runs do: it is the window onto the runs attached to it
    const session = playSession({ driver, mod, over, tell: flags.serve ? (line) => console.log(line) : tell });

    if (flags.serve) {
      const began = Date.now();
      const served = await serveSession({
        ...{ session, tell: (line) => console.log(line) },
        ...defined({ port: numberOf(flags, "port") }),
      });
      console.log(`the engine is up (${((Date.now() - began) / 1000).toFixed(1)} s). The session is served at ${served.address}:`); // prettier-ignore
      console.log(`  smak play ${served.address} --attach --map <name> --steps steps.json -o <folder>     a run in it`); // prettier-ignore
      console.log(`  smak play ${served.address} --attach --close                                        its end`); // prettier-ignore
      let held = true;
      for (const run of runs) held = (await session.run(run).then(report, (error) => stopped(error, run.out))) && held; // prettier-ignore
      await served.closed;
      console.log("the session is closed");
      if (!held) process.exit(1);
      return;
    }

    let held = true;
    try {
      for (const run of runs) {
        tell(`${url}: map ${run.map}, ${run.steps.length} steps      (from the start, it took, what)`);
        held = (await session.run(run).then(report, (error) => stopped(error, run.out))) && held;
      }
    } finally {
      await session.close().catch(() => {});
    }
    if (!held) process.exit(1);
  } catch (error) {
    if (error.logFile) console.error(`the game's console up to there: ${error.logFile}`);
    fail(/^play: /.test(error.message) ? error.message : `${command}: ${sayOf(error)}`);
  }
}

// ── the commands ───────────────────────────────────────────────────────────
// A command's name, its function, and its lines of the help. `page: true`: it is handed the path as it is (a
// folder will do) and does not read a model. `own: true`: its file is not a model, and it reads it itself.
const COMMANDS = {
  info: {
    run: info,
    help: `  info <mdl> [--json] [--hitboxes] [--boxes]  what is in it: bones, bodyparts and their body numbers, textures, animations (with their
                                            activity, and how far and how fast each travels), events, attachments, hit boxes
                                            (--hitboxes: each with its bone, group and size; --boxes: each animation's box)`,
  },
  check: {
    run: check,
    help: `  check <mdl> [--engine goldsrc|xash|source] [--source original.mdl]   what would break or draw wrong in the game (exit code 1 on
                                            an error); --source: warnings the original has too are marked "inherited". Ends in a
                                            line PASS or FAIL; the facts go to a file (--report <file>), --verbose prints them
  check rp <file.rp.json | file.script.json> [--rp <map.rp.json>]
                                            an RP map's contract (format, npcs, missions, rewards, walking graph), or a smak_script
                                            file (levels/rp/script.mjs) with the NPC names of its map's rp.json; ends in PASS or FAIL`,
  },
  render: {
    run: draw,
    help: `  render <mdl> -o out.png                   one picture       [--view orbit|first|side|front|top] [--yaw 30] [--pitch 15] [--zoom 1]
                                            [--ground]: with --view side or front, a line where z = 0 is (the floor)`,
  },
  sheet: {
    run: draw,
    help: `  sheet <mdl> -o out.png                    six views in one  [--size 384]`,
  },
  strip: {
    run: draw,
    help: `  strip <mdl> -o out.png --seq <name|n>     an animation, frame by frame   [--count 12] [--cols 4] [--from f] [--to f] [--view first]
                                            a walk judged by its feet: --view side --ground (one camera for every frame, the floor a line)
        (render, sheet and strip all take --seq --frame --body --skin --width --height --no-light --no-cull)`,
  },
  gif: {
    run: gifs,
    help: `  gif <mdl> -o out.gif --seq <name|n|all>     an animation as a looping GIF, each frame labelled (--seq all: every one, -o a folder)
                                            [--view side --ground] [--yaw] [--pitch] [--width] [--height] [--body] [--skin], as strip`,
  },
  textures: {
    run: textures,
    help: `  textures <mdl> -o <folder> [--bmp]        every texture as a file (PNG; --bmp: 8-bit BMP with its palette as it is)`,
  },
  uv: {
    run: uv,
    help: `  uv <mdl> -o <folder> [--texture name|n]   every texture (or one) enlarged, with the triangles that wear it drawn over it`,
  },
  islands: {
    run: islands,
    help: `  islands <mdl> [-o <folder>] [--texture name|n] [--body n] [--min 1] [--seq name|n|rest]
                                            the islands each picture is cut into: their ids, boxes, bones, places and open borders;
                                            with -o, every texture (or one) with its islands tinted and numbered
                                            (--body: only the islands that body's submodels use, with that body's own triangles)`,
  },
  layers: {
    run: layers,
    help: `  layers <mdl> [layers.mjs] [name=expression ...] [--texture name|n] [--body n] [--seq name|n|rest] [--min 30] [-o out.png]
                                            layers of a texture, to check a mask before painting with it: each one's pixels and its
                                            regions (box, centre, size, place on the body); with -o, the texture with the layers tinted
                                            over it. layers.mjs: a module that exports \`layers\` (what paint takes; \`pose\` and \`tex\` too
                                            if it likes). name=expression: a layer in one line of JavaScript over what paint hands its
                                            function, with lum and sat (of rgb) and W (the workshop):  "mail=busy(3)>0.25"  "dark=lum<0.1&&!layer.mail"`,
  },
  retexture: {
    run: retexture,
    help: `  retexture <mdl> <texture name|n> <picture.png|.bmp> -o out.mdl [--holes] [--flags n]
                                            another picture on that texture (any size; cut to 256 colours unless an 8-bit BMP)`,
  },
  sequence: {
    run: sequence,
    help: `  sequence <mdl> <name|n> -o seq.json       an animation as numbers: for each frame, for each bone, [x, y, z, about x, about y, about z]`,
  },
  "sequence-set": {
    run: sequenceFromFile,
    help: `  sequence-set <mdl> <name|n> seq.json -o out.mdl      the same file put back (frames, fps, loops), in the place it had`,
  },
  "sequence-add": {
    run: sequenceFromFile,
    help: `  sequence-add <mdl> seq.json -o out.mdl    as a new animation after the others (seq.json: { name, fps, loops, frames })
  sequence-add <mdl> --from <name|n> --frames 80-57 --name kneel_down -o out.mdl [--loop] [--fps 25] [--events]
                                            a new animation of frames of one it has, in that order ("80-57": backwards; "57,58,57")`,
  },
  reproportion: {
    run: reproportioned,
    help: `  reproportion <mdl> "Bip01 L Thigh=1.2" "Bip01 Spine=1,1,1.05" ... -o out.mdl [--no-mirror] [--stride n]
                              [--reference <seq>[:frame] | rest] [--no-ground] [--body n] [--hitboxes all]
                                            bones made longer or shorter: a factor is a bone's length (where the bones hanging
                                            from it stand), x,y,z in its own axes; the other side follows unless --no-mirror.
                                            Every animation keeps its turns, those in <name>01.mdl too (read for their boxes, not
                                            changed); the roots and every travel follow the legs (--stride), the feet stay on
                                            the ground (fitted over every frame that stands; --reference: the pose of its level).
                                            A hit box grows along its bone only (--hitboxes all: across it too)`,
  },
  "figure-survey": {
    run: figureSurvey,
    own: true,
    folder: true,
    help: `  figure-survey <Half-Life folder | game folder | models folder> --mod <profile> [--kind hd] [--as <corpus>] [--library <file>]
                              [--judges style,texture,shape]
                                            the game's own figures measured for the figure judges, into a library of yours (unless
                                            told: SMAK_FIGURES, else ~/.smak/figures.json; never in the kit). --mod: whose figures
                                            (msc, ts, halflife; the profile names the folder), or --as <name> for a game with no
                                            profile. Each corpus is kept beside the others; surveying one again replaces it`,
  },
  "figure-judge": {
    run: figureJudge,
    own: true,
    help: `  figure-judge <mdl> --mod <profile> [--kind hd] [--against <corpus,...>] [--library <file>] [--weights library|even] [--all] [--json]
                                            the style judge: 52 measures of the figure against the game's own figures, a score of
                                            0 to 100 and what is out (the part or texture at fault, what to do), weighed as the
                                            profile says the game's manner is told (--weights library: as the corpora of the
                                            library tell each other apart)`,
  },
  "figure-texture": {
    run: figureTexture,
    own: true,
    help: `  figure-texture <mdl | atlas.png> --mod <profile> [--against <corpus,...>] [--box x0,y0,x1,y1] [--scale <px a texel>]
                              [--reference <atlas.png | model.mdl | folder of models>] [--reference-box ...] [--reference-scale 4]
                              [--sheet out.png] [--json] [--library <file>]
                                            the texture judge: the texture as painting (repetition, flat fills, ramps, speckle,
                                            slant, charts, occlusion, value, colours) against the game's figures and a reference in
                                            the manner wanted: a picture of an atlas (its pixels a texel found, or --reference-scale),
                                            or models (each measure's median). What is off, in words. --sheet: the atlases and bars`,
  },
  "figure-shape": {
    run: figureShape,
    own: true,
    help: `  figure-shape <mdl | picture.png --mask m.png> --mod <profile> [--against <corpus,...>]
                              [--reference <model.mdl | folder of models> | --reference <view>=mask.png ... [--reference-picture <view>=shot.png ...]]
                              [--pose pose.mjs] [--sheet out.png] [--json] [--library <file>]
                                            the shape judge: silhouettes (holes, notches, inner edges, symmetry) and mesh (pieces,
                                            layers, mirror, likeness, boxes) against the game's figures and a reference's. --pose:
                                            a module exporting pose(src) (the bones' matrices) and views ({ front: { yaw, pitch,
                                            dist, fov, target } }): the model drawn in the reference's pose, from its cameras, framed
                                            as its masks' figure stands. The three judges end in a line PASS or FAIL (style: at or
                                            over the game's own figures' lower quarter; texture, shape: no measure far out of the
                                            corpus' middle half), exit code 0 either way; the detail goes to a file (--report),
                                            --verbose prints it; the sheets are drawn small unless --full-pictures`,
  },
  "figure-validate": {
    run: figureValidate,
    own: true,
    help: `  figure-validate <library.json> [--judge style|texture|shape] [--weights library|even|profiles] [--json]
                                            does a judge tell the library's corpora apart: each corpus' own figures against the
                                            others' (AUC: 1 perfect, 0.5 a coin), who stands best where, the measures by how far
                                            apart they put the games. --weights profiles: each corpus with its profile's weights`,
  },
  reskin: {
    run: reskin,
    help: `  reskin <mdl> <rules.json|rules.mjs> -o out.mdl [--body n] [--pictures <folder>]
                                            its textures recoloured, weathered and painted over by rules (docs/RESKIN.md, "A re-skin
                                            by rules"); --pictures: each changed texture before and after; checked against the original`,
  },
  inline: {
    run: inline,
    help: `  inline <mdl> -o out.mdl                   a model whose textures are in <name>t.mdl, with them put inside it`,
  },
  pieces: {
    run: pieces,
    help: `  pieces <mdl> [--min 6] [--seq name|n|rest] [--body n]   its loose pieces (a pouch, a plate, a pack), each with its number, place and size
                                            (every submodel's; with --body, those of the submodels that body number shows)`,
  },
  obj: {
    run: obj,
    own: true,
    help: `  obj <file.obj> -o out.mdl [--scale 1] [--up y|z] [--turn 0] [--ground] [--centre] [--name x.mdl] [--max-texture 512]
                                            a model from a Wavefront .obj: its .mtl and their pictures (PNG, BMP) are found beside it
                                            by the names in the file. --up: which axis of the file is up (y: what Blender writes);
                                            --turn: degrees about the upright axis; --ground: its lowest point at z = 0;
                                            --centre: its middle at the origin. One bone, one still animation: a prop the game can load`,
  },
  import: {
    run: imported,
    own: true,
    folder: true,
    help: `  import <file.fbx|.glb|.gltf|.obj> [-o out.mdl] [--scale 1] [--fit <units>] [--origin base|centre] [--turn 0] [--texture pic.png]
                                            a model of another tool: what is in it (meshes, triangles, materials and their
                                            pictures, bones, animations, axes, units, box); with -o, a prop: one bone, one still
                                            animation, its pictures found beside it, cut to 256 colours and within the engine's
                                            size. --scale: times its true size (39.37 units a metre); --fit: its longest side
                                            that many units; --origin base: standing on z = 0, centre: about its middle;
                                            --pictures: six views beside the .mdl; --save-pictures <folder>: the pictures inside
                                            the file, as they are; --json. With --anim [name,...]  [--fps 30]: a model with the
                                            file's skeleton and animations, each point on the bone that weighs most on it.
                                            --triangles <n>: at most n, the shape brought down first, each mesh and material
                                            by its share, the edges where they meet kept
  import <folder> -o <folder> [--only fbx,glb] [--fit n] ...
                                            every model under a folder as a prop, by the same paths, with sheet.png (each one
                                            drawn with its textures), a table (import.json) and HEAVY against what GoldSrc
                                            would not draw at its ease (docs/IMPORT.md)`,
  },
  item: {
    run: item,
    own: true,
    help: `  item <piece.mjs> --mod <profile> --game <folder> --family <name> --name <word> -o <folder> [--texture name.bmp] [--base <folder>] [--pictures]
                                            a new item in the models a game shows its kind from: the module's default export is the
                                            piece ({ tris, image }) or a function that makes it; the family (which files, bodyparts,
                                            bones, the game's own thing each is laid on) is one of the profile's \`items\`. Each file is
                                            read from --base when it is there, else from the game; written under -o with what the
                                            item's script is to say (docs/ITEMS.md). Exit code 1 when a check fails.
                                            <piece.mjs> may be a bought model instead (.fbx, .glb, .gltf, .obj): --texture is then
                                            its picture's file (found beside it unless told), and how it lies is found or told:
                                            [--as haft|plain|shield] [--axis x|y|z|-x..] [--grip low|high] [--flip] [--triangles n]
                                            (docs/IMPORT.md)`,
  },
  scripts: {
    run: scripts,
    own: true,
    folder: true,
    help: `  scripts <folder> [more folders, maps ...] --mod <profile> --game <folder> [--shipped <the pack unpacked>] [--json]
                                            scripts of your own against the scripts the game ships, for a mod whose profile says how
                                            scripts are named: each one "replaces" a game script, is "new" and named (by a map given
                                            here, by a script, by the game itself), or is new and named by nothing: a warning, since
                                            laid over the game's pack it replaces nothing and is never read. map-check says the same
                                            of the folders it is given with --scripts`,
  },
  view: {
    run: view,
    page: true,
    help: `  view <folder|mdl> [more ...] [--port 8098]   a page in the browser: any two models side by side, turned and animated together`,
  },
  edit: {
    run: edit,
    page: true,
    help: `  edit <folder|mdl> [--port 8097] [--work smak-projects] [--engine goldsrc|xash]
                                            the editor, a page in the browser: animations re-timed and re-posed, events, textures
                                            (the models are only read; projects and saved models go to the --work folder)`,
  },
  "map-info": {
    run: mapInfo,
    own: true,
    help: `
  maps (docs/MAPS.md, docs/MAPS-MAKING.md): a compiled map is a .bsp, its source a .map, its textures a .wad
  map-info <bsp> [--json]                   what is in a map: its size, lumps, entities by class, textures and which are wanted from .wad files, light`,
  },
  "map-check": {
    run: mapCheck,
    own: true,
    help: `  map-check <bsp|map> [--engine goldsrc|xash] [--game <folder> ...] [--mod <profile.mjs|.json|goldsrc>] [--fgd <file.fgd> ...]
                            [--learned <file> ...] [--wad <file.wad> ...] [--cache <file>] [--scripts <folder> ...] [--all]
                                            what an engine would refuse (exit code 1 on an error); with --game (the mod's folder,
                                            then valve), its .wad files and textures are looked for there. A .map: its plan, before
                                            any compile. With --mod (a mod's profile), --fgd or --learned (what map-learn wrote): its
                                            entities against the mod: a class or a key that does not exist, a value of the wrong
                                            kind, a name nothing answers to, the mod's rules, the files it names (--scripts: folders of
                                            scripts of your own, for a profile whose mod names scripts: of those named by nothing,
                                            this map's own are warned of, and every one with --all). Ends in a line PASS or FAIL;
                                            the facts go to a file (--report <file>), --verbose prints them`,
  },
  "map-fgd": {
    run: mapFgd,
    own: true,
    folder: true,
    help: `  map-fgd [<source folder>] -o mod.fgd [--fgd file ...] [--maps <folder of .bsp>] [--dll file] [--all]
                                            an FGD for a mod: its classes and the keys its C++ code reads (each typed by what the
                                            code does with it), joined with its own FGDs and its maps; what the code reads that the
                                            FGD given lacks is listed`,
  },
  "map-learn": {
    run: mapLearn,
    own: true,
    folder: true,
    help: `  map-learn <folder of .bsp> -o learned.json [--class name] [--all]
                                            what a mod's own maps say of its entities, for a mod with no FGD or a wrong one: each
                                            class with how often, each key with its commonest values, the keys that go together`,
  },
  "map-entities": {
    run: mapEntities,
    own: true,
    help: `  map-entities <bsp> [--class name] [--json]   every entity with its number, class, place and keys`,
  },
  "map-set": {
    run: mapSet,
    own: true,
    help: `  map-set <bsp> -o out.bsp --entity <n|class> [key=value ...] [--move x,y,z] [--unset key]
  map-set <bsp> -o out.bsp --add <class> [--at x,y,z] [key=value ...]
  map-set <bsp> -o out.bsp --remove <n|class>
                                            one change to a compiled map's entities, written to a new file. The light, the
                                            visibility and the brushes stay as compiled: a moved light lights nothing new`,
  },
  "map-plan": {
    run: mapPlan,
    own: true,
    help: `  map-plan <bsp|map> -o out.png [--z height] [--no-slice] [--scale px] [--area x0,y0,x1,y1] [--no-entities] [--labels|--no-labels] [--list]
                             [--heights] [--legend] [--reach]
                                            the map from above, +y up the picture: floors, walls, every entity marked with its
                                            number, a scale. --z: a cut at that height, solid filled (a .map is always a cut).
                                            --heights: each floor's height written on it; --legend: the entities listed beside it;
                                            --reach: the walk test tinted on it (with what map-reach takes)`,
  },
  "map-view": {
    run: mapView,
    own: true,
    help: `  map-view <bsp|map> -o out.png [--from x,y,z | --at <entity n|class>] [--yaw 0] [--pitch 0] [--to x,y,z] [--fov 90]
                                            a view from inside the map, textured and lit by its lightmaps (a .map: flat colours).
                                            Without a place: from the first place to start. --yaw 90 looks along +y; --pitch over 0, up`,
  },
  "map-views": {
    run: mapViews,
    own: true,
    help: `  map-views <bsp> -o out.png [--count 8] [--cols 4] [--aim] [--landmark <n|name|class>] [--each-door [n|name,...]]
                                            several views in one picture: from the places to start and the largest rooms;
                                            --aim: also aimed at what the map has (its water, its largest standing piece, its lamps,
                                            its crowd, each storey, the landmark), and no level view that faces a wall
                                            (places to start that stand together get one view between them; a view that is nearly
                                            one colour is left out for the next largest room, and that is said);
                                            --each-door: each door (or those named) from both its sides at a standing player's eye,
                                            two steps back, in sheets of --count (24): out.png, out-2.png, ... (what stands before a
                                            door, as a player meets it; map-doors measures the same)
        (the three take --width --height --game <folder> --wad <file.wad> --no-light --light start|off|steady|all --brightness 1.55 --entities all|models|game|none (game: only what is drawn by its model or sprite, no boxes);
         an entity that stands is drawn as the box it moves with: --body <class|targetname>=large|standing|crouching says which;
         --models draws the models that are named, from the --game folders, textured, in the body, skin, sequence, scale and
         angles their entities give (--no-model-scale: at their own size); --model <class|targetname|scriptfile>=models/x.mdl names one;
         with --game the sky is its own picture (skyname) and a sprite its first frame: --no-sky or --sky r,g,b, and --no-sprites, say otherwise;
         --mod <profile.mjs|.json|goldsrc> (with --game, --scripts <folder>): the mod's folders, the box each of its classes moves with and,
         with --models, the model the mod gives an entity that names none, a monster's from its script; map-section, map-storeys
         and map-openings take it too)`,
  },
  "map-dressing": {
    run: mapDressing,
    own: true,
    folder: true,
    help: `  map-dressing <bsp|map> [--source <map>] [--against <bsp|bands.json>] [--mod <profile>] [--json]
                                            its dressing beside Valve's own campaign, measured: tall walls banded and where,
                                            texture scale and shift, lamp faces a light, faces off the axes, detail a floor's
                                            256 x 256, the floor's dark share and contrast; of source, its brushes' roles (panels,
                                            strips, lamps, angled). A measure outside Valve's 5th to 95th in 100 is a WARNING,
                                            with which way to go. --mod: the mod's own bands where its profile has them
                                            (dressing: ts's, measured over its 29 maps), Valve's for the rest; --against bands.json
  map-dressing <bsp or folders ...> --learn -o bands.json [--as "whose"] [--from "the maps in words"]
                                            the bands of those maps' dressing (5th in 100, quartiles, median, 95th), for
                                            --against or a profile's dressing`,
  },
  "map-sweep": {
    run: async ({ file, flags }) => {
      const { sweepOf } = await import("../src/maps/sweep.mjs");
      const swept = sweepOf(readFileSync(existing(file)));
      if (flags.json) console.log(JSON.stringify(swept, null, 1));
      else for (const line of swept.facts) console.log(line);
    },
    own: true,
    help: `  map-sweep <bsp> [--json]           what a player walking it would find wrong: drops that hurt (over ${210} units: Half-Life's
                                            safe fall) and lights in mid-air (nothing solid within 32), each with its place`,
  },
  "map-reach": {
    run: mapReach,
    own: true,
    help: `  map-reach <bsp|map> [-o plan.png] [--mod <profile>] [--start <n|class> ...] [--goal <n|class> ...] [--jump [45|63]] [--doors open|closed]
                              [--open <n|class|name> ...] [--shut <n|class|name> ...] [--walls standing|gone] [--body name=large ...]
                              [--cell 8] [--no-parts] [--json]
                                            the walk test: where a standing player gets on foot from the places to start (steps of 18,
                                            any drop; ladders, liquids and teleports carry it on). Says which entities are not reached
                                            and what it would take, which stand in something solid or hang, the openings with their
                                            width and height, the walk to each --goal, and the one-way places: floor a player gets into
                                            and not out of (--exit <n|class|name>: a way out of the map). How much of the floor a
                                            player fits on is walked to, and each part that is not with what it takes: a jump,
                                            crouching, the brush entities in the way by name, open air (--no-parts: not looked at).
                                            Doors are open (--doors closed: not); what breaks or is switched off is a wall (--walls
                                            gone: not). A slope too steep to stand on is slid down, never walked up
                                            (--no-slopes: walked like any floor). --jump: jumps are part of the walk, up 45 and across
                                            a gap as far as a run carries (--speed 320 --gravity 800), and what only a jump reaches is
                                            told apart. With -o: the plan with the walked floor green, the rest red, floor only a jump
                                            reaches blue and one-way places amber. With --mod, the profile's exits, markers, wiring and
                                            off are used, and --exit adds to them. Exit code 1 on a fault`,
  },
  "map-section": {
    run: mapSection,
    own: true,
    help: `  map-section <bsp|map> -o out.png --from x,y --to x,y [--z low,high] [--scale px] [--near 64] [--no-heights] [--no-entities]
                                            a side section: an upright cut along that line, floors with their heights, the entities near it`,
  },
  "map-storeys": {
    run: mapStoreys,
    own: true,
    help: `  map-storeys <bsp|map> -o out.png [--z a,b,c] [--cols 3] [--reach]
                                            the storeys side by side: one plan for each, cut at its own height (found, or --z), with
                                            every floor's height written on it and the entities of that storey`,
  },
  "map-openings": {
    run: mapOpenings,
    own: true,
    help: `  map-openings <bsp|map> -o out.png [--count 12] [--both] [--cols 4]
                                            a view through each gate and doorway the walk test finds, from a player's eyes before it`,
  },
  "map-textures": {
    run: mapTextures,
    own: true,
    help: `  map-textures <bsp> -o <folder> [--game <folder> ...]   every texture of a map as a PNG: those inside it, and those found in its .wad files`,
  },
  wad: {
    run: wad,
    own: true,
    help: `  wad <file.wad> [-o <folder>]              the textures of a .wad listed; with -o, each written as a PNG named after it`,
  },
  sprite: {
    run: spriteCommand,
    own: true,
    help: `  sprite <spec.json> [-o <folder>]           the sprites of a spec built (docs/SPRITES.md): layers of glows, flares, fire,
                                            smoke, explosions, billows, sparks, rings and beams, each .spr written under the
                                            folder (the spec's own unless told) with a sheet of its frames and an animated
                                            picture, and measured against Half-Life's own of its kind`,
  },
  contract: {
    run: contractCommand,
    help: `  contract <mdl> [--json] [--against reference.mdl]
                                            what a mod's code asks of a model by name or number: bones, animations in their
                                            order with activities, attachments, bodyparts, hit groups; --against: what the model
                                            breaks of a reference's (exit code 1 when it breaks any)`,
  },
  build: {
    run: buildCommand,
    own: true,
    help: `  build <spec.json> [-o <folder>] [--game <folder>]... [--reference x.png] [--focus <part> ...] [--fgd x.fgd ...] [--vhlt <folder>] [--mod <profile>] [--engine source]
                                            a spec built by its kind (its "spec"; docs/SPEC.md): smak.map/1 a map of rooms laid
                                            out by words, in a folder of its name: its .map and own .wad, compiled when VHLT is
                                            found, walked, lit, its plan, views and sections drawn (--mod, or the spec's "mod":
                                            a mod's map, its starts, classes, textures and rooms' uses); smak.model/1 a model of parts,
                                            checked, with its sheet of six views (a character on a game's skeleton, a weapon in
                                            place of a game's; --reference drawn beside it, --focus parts seen close; --engine
                                            source, or the spec's "engine": made for Source, held to Half-Life 2's, compiled for
                                            GMod under <name>_source/, docs/SOURCE.md); smak.wad/1
                                            textures painted into a .wad with a sheet of them (preview: { map, each }: the map
                                            drawn wearing them, each at its place); smak.video/1 a video of models and maps from
                                            its shots (MP4 with ffmpeg, a GIF without; --preview its contact sheet alone);
                                            smak.sound/1, smak.music/1, smak.sprite/1 as the commands of their names`,
  },
  sound: {
    run: soundCommand,
    own: true,
    help: `  sound <spec.json> [-o <folder>] [--game <folder>]...
                                            the sounds of a spec built (docs/SOUNDS.md): layers of noise, tones, FM, struck
                                            modes, particles and recordings, each .wav written under the folder's sound/
                                            (the spec's own folder unless told), checked as the engine needs it, measured
                                            against the game's own of its kind; their picture beside the spec`,
  },
  music: {
    run: musicCommand,
    own: true,
    help: `  music <spec.json> [-o <folder>] [--ffmpeg <program>]
                                            a take made a track (docs/SOUNDS.md): cut, faded, filtered and levelled by
                                            loudness, written as the game's MP3 under media/ (through ffmpeg) or as a looped
                                            WAV bed under sound/`,
  },
  "wad-make": {
    run: wadMake,
    own: true,
    help: `  wad-make <picture.png|.bmp> [more ...] -o out.wad   a .wad of pictures, each texture named after its file (15 letters at most,
                                            sides multiples of 16; a name that begins with { has holes where its PNG is see-through)`,
  },
  "map-wiring": {
    run: mapWiring,
    own: true,
    help: `  map-wiring <bsp|map> [--mod <profile>] [--list] [--json]
                                            what the map's entities are wired to do, as a role-play map is judged: its properties
                                            (the doors by name; doors of one name open together), its switches and triggers and what
                                            each works in the end through relays (lights, sounds, lifts, doors, places that heal or
                                            hurt), its trains and their stops, the names said over the map from many speakers, its
                                            teleports, what comes back after it is broken. --list: each property and switch`,
  },
  "map-heights": {
    run: mapHeights,
    own: true,
    help: `  map-heights <bsp> -o <folder> [--cell 16]   the map's height plan: one picture a layer of floor (floor-0.png the lowest at each
                                            place, floor-1.png the next above it...) with each cell's height as a colour, room-N.png
                                            the headroom over it, legend.json the colours' heights. A map spec's floorplan: { dir }
                                            reads it back as its space: storeys over storeys carved in one`,
  },
  "map-overlay": {
    run: mapOverlay,
    own: true,
    help: `  map-overlay <map|bsp> <picture> --from x,y,z --yaw n [--pitch n] [--fov 90] [--locate] [--width n] -o out.png
                                            the map's edges over a picture of it from that camera, green where they meet the
                                            picture's own and red where not, how far apart, and the faces the edges say are
                                            off (by how many units along their normal); --locate finds the camera first by the
                                            edges, from that guess or from places over the map's floor`,
  },
  "map-light": {
    run: mapLight,
    own: true,
    help: `  map-light <bsp> [--rooms rooms.json] [--dark 24] [--cell 128] [--walked] [--switched start|off|on] [--json]
                                            the light on the map's floors, from its lightmaps, with no picture and no game: the mean
                                            of the samples the compiler stored (0 to 255), and what is dark of it: room by room
                                            (--rooms: { "name": { "min": [x, y, z], "max": [x, y, z] } }) or as the dark stretches
                                            of floor. The game lights what stands in a room by the floor under it. --walked: only
                                            floor the walk test gets to. A draft's light (--fast) has no bounces: it is darker.
                                            A switched light counts as the map starts: on unless made to start dark
                                            (spawnflags 1); --switched off or on counts them all one way`,
  },
  "map-character": {
    run: mapCharacter,
    own: true,
    folder: true,
    help: `  map-character <bsp> [more .bsp or folders] [--mod <profile>] [--kind compact] [--against figures.json] [--json]
                                            a map's character in numbers: walls off the grid, floor that slopes, floor levels, the
                                            spread of its heights, textures, props, sounds, music, lights, the light on the floor and
                                            its shadow; held against the mod's own maps (the profile's character.figures, or
                                            --against): PLAIN, a figure under their lower quartile where low is plain (over the upper,
                                            for the floor's light); WARN, five or more such. Several maps: side by side.
  map-character <bsp or folders ...> --learn -o figures.json [--from "words"]
                                            the figures of those maps as [lower quartile, median, upper quartile], for --against`,
  },
  "map-teams": {
    run: mapTeams,
    own: true,
    help: `  map-teams <bsp|map> --mod ts [--cfg tsm_spawns_<map>.cfg] [--goal x,y,z | <n|class|name>] [--each] [--write-cfg [folder|file]] [--json]
                                            a map's two teams as Havoc9's ts_matchmode plays it: its spawns gathered and split as the
                                            plugin splits them (info_player_deathmatch then info_player_start, 64 at most, the farthest
                                            pair the anchors), or a spawn file's (--cfg); the nearest spawns across the teams (FAIL
                                            under 512, WARN under 1400: the profile's teams.cross), spawns of one team in sight of the
                                            other's (FAIL), the walk between them, and to --goal from each team (its nearest spawn;
                                            --each: the median of each spawn's walk), the balance (WARN over 10%, FAIL over 25%).
                                            --write-cfg: tsm_spawns_<map>.cfg as amx_tsm_spawn_save writes it, each spawn at its floor
                                            (z the player's origin, floor + 36) and turned to the goal or the middle. Without --game the
                                            installed Half-Life is found (SMAK_HALF_LIFE, or Steam's libraries). Exit code 1 on a FAIL`,
  },
  "map-spawns": {
    run: mapSpawns,
    own: true,
    help: `  map-spawns <bsp|map> --mod <profile> [--game <folder> ...] [--scripts <folder>] [-o plan.png] [--json]
                                            how each spawn area's monsters come: at the start, on arrival, or fired, and by what (a
                                            trigger walked into, a button, a breakable, a death, an area cleared, a script), followed
                                            back through relays and counters. SEEN: monsters with a clear line from a player's eyes in
                                            the trigger that brings them (--sight 3000 units). QUICK: back at their own spot under
                                            --quick 60 s. FIGHT: races that attack each other, near (--near 1024) and in one band.
                                            A reward over --far 1024 units from the death that brings it. -o: the plan, a line from
                                            each trigger to each monster seen. Exit code 1 on SEEN or FIGHT`,
  },
  "map-waypoints": {
    run: mapWaypoints,
    own: true,
    help: `  map-waypoints <bsp|map> --mod ts|<profile> [--out <Half-Life>/rcbot | -o x.rcw] [--name <map>] [--spacing 160] [--paths 16]
                              [--drop 250] [--no-jump] [--no-crouch] [--plan p.png] [--cell 8] [--doors ...] [--open ...] [--json]
                                            RCBot's waypoints from the walk test: one at each start, the foot and top of each
                                            ladder, where each jump to floor only a jump reaches is made, the ends of stairs, each
                                            opening, then every --spacing units of walk, corners mended until every two neighbours
                                            are joined by a straight line a body walks (both ways) or drops down (one way); floor
                                            only a crouching body fits that joins two places gets crouching waypoints. Written
                                            as the bot's .rcw: --out the bot's folder puts it at waypoints/<mod>/<map>.rcw. The bot
                                            works out its visibility table when the map first loads. --plan: drawn on the plan`,
  },
  "map-measure": {
    run: mapMeasure,
    own: true,
    help: `  map-measure <bsp|map> [more maps ...] [--every] [--grid 32] [--bands 176,352] [--sight 700] [--names a,b,...] [--json]
                              [--mod <profile>] [--exit <n|class|name> ...] [--open ...] [--shut ...] [--doors open|closed] [--start ...]
                                            a map in numbers, to lay beside another's: at every place of its floor (a grid of 32) the
                                            width (the narrowest of eight lines through the place), the headroom and how far one sees;
                                            then the share of the floor by width (under 176, 176 to 352, 352 and over: --bands),
                                            medians and quartiles, the headroom of corridors and of rooms, the share of places that
                                            see beyond --sight, the openings, the floors' heights and how many lie one over another,
                                            the footprint and the share of it that is floor. Several maps: a table, a map a column.
                                            The floor is what the walk test gets to (with what map-reach takes); --every: every place
                                            a player fits, walked to or not, for a map the walk gets to only part of`,
  },
  "map-compare": {
    run: mapCompare,
    own: true,
    help: `  map-compare <bsp|map> <bsp|map> [more ...] -o out.png [--scale px] [--z 100,100,-] [--names a,b,...] [--cols n] [--no-slice]
                                            the maps from above at ONE scale in one picture, each under its name and the size of its
                                            world, with one scale bar: is the new map the size of the game's? --z: the height a plan
                                            is cut at, one for all or one for each map in order, - for a map seen from above. Without
                                            --scale: the largest at which all fit 1920 x 1080 (--width --height). No entity is marked
                                            unless --entities says (with what map-plan takes: --game, --mod, --no-light ...)`,
  },
  sketch: {
    run: sketchCommand,
    own: true,
    help: `  sketch <file.svg|file.png> -o out.map [--legend legend.json] [--scale units] [--wall 16] [--texture NAME] [--wad <file.wad> ...] [--plan out.png] [--no-keep]
                                            a map's source from a drawing: each shape a space (floor, ceiling, texture, a lamp) by its
                                            label ("hall floor=0 ceiling=256"), its layer's, its colour in the legend or its name there;
                                            in an SVG a line with a stroke and no fill is a corridor of its width; in a PNG each colour
                                            the legend names is a space, and white, black and others are rock. Made again over a .map
                                            a person added to (in J.A.C.K.), what they added is kept (out.smak.map is the kit's own
                                            copy; --no-keep: not kept). docs/MAPS-SKETCH.md`,
  },
  "map-viewer": {
    run: mapViewer,
    own: true,
    help: `  map-viewer <bsp|map|svg|png> [--game <folder> ...] [--mod <profile>] [--legend legend.json] [--port 8099]
                                            the map in 3D in the browser: walked through with the mouse and the keys, textured (and
                                            lit, compiled), its entities as their models with an arrow the way each faces, those in
                                            a wall, floating or facing a wall marked; floors coloured by height; ceilings and clips
                                            shown or hidden. It loads again when the file changes (a sketch is made a map each time)`,
  },
  "map-props": {
    run: mapProps,
    own: true,
    help: `  map-props <bsp|map> [--game <folder> ...] [--mod <profile>] [--all] [--json] [--views <folder>]
                                            each prop, NPC, monster, chest and start held against the world: the share of its box
                                            in solid, the gap under it, how far a wall is in front, behind and aside by the way it
                                            faces; warned: in a wall, floating, its nose to a wall with room behind (turned the
                                            wrong way?). --views: a picture of each warned one from in front of it`,
  },
  "map-doors": {
    run: mapDoors,
    own: true,
    help: `  map-doors <bsp|map> [--game <folder> ...] [--mod <profile>] [--no-props] [--json]
                                            room for a standing player before each door, on both its sides, just past the leaf and a
                                            step further: a prop or a wall set before a door is named. Props are counted by their
                                            model's box (--game finds the models; --no-props: the map's solids only)`,
  },
  "map-decompile": {
    run: mapDecompile,
    own: true,
    help: `  map-decompile <bsp> -o out.map [--game <folder> ...] [--no-canon] [--no-tips] [--no-cuts] [--no-merge]
                                            a compiled map made back into brush source (Valve 220): a brush for each solid region of
                                            its tree, every face wearing the texture it wore. Its .wad files are kept where found
                                            (--game, and the folder above its maps/); what it carries inside it that none has goes to
                                            <name>_dc.wad beside the .map. --no-*: one of its rules off, to see what that rule does`,
  },
  "map-compile": {
    run: mapCompile,
    own: true,
    help: `  map-compile <file.map> -o out.bsp [--wad <file.wad> ...] [--wadinclude] [--fast] [--no-vis] [--no-light] [--vhlt <folder>]
                              [--timeout <seconds | hlvis=600,hlrad=1200>] [--progress | --no-progress]
                                            compiles brush source with VHLT (an outside program: VHLT_DIR, the PATH or --vhlt);
                                            a leak and every error in a sentence, exit code 1 unless it compiled. Each program's
                                            seconds are printed, and the portals hlbsp left hlvis (its work: many are foretold).
                                            --timeout: a program that runs longer is stopped, and that is said (unless told: 120 s
                                            for hlcsg and hlbsp, 900 for hlvis and hlrad). --progress: what the compilers print is
                                            handed on as they work, on standard error (so by itself, to a terminal)`,
  },
  play: {
    run: playMap,
    own: true,
    address: true,
    help: `  play <url> --map <name> [--steps steps.json] [-o <folder>] [--mod <profile>] [--game <folder> ...] [--playwright <folder>]
                              [--width 1024] [--height 768] [--loads ms] [--expect <pattern> ...] [--expect-not <pattern> ...]
                              [--put <place>=<file> ...] [--no-sheet] [--show] [--gpu] [--full-pictures] [--verbose]
                                            the map seen in the game itself: a browser build of Xash3D at that address is opened,
                                            the map loaded, the game entered as the mod's profile says, and the steps done
                                            (steps.json: a list such as [{ "walk": 3000, "shot": "gate" }, { "face": 90, "look": -20 },
                                            { "say": "hail", "until": "welcome", "shot": "spoken" }, { "expect": "You receive" }];
                                            docs/PLAY.md has every step). The pictures go to the folder as PNG files with sheet.png,
                                            all of them in one; what the game said is in log.txt and log.jsonl, each line with its
                                            time. --expect, --expect-not: lines the whole run is held to. It ends with 1 when an
                                            expectation did not hold or the run stopped. --map and --steps given several times: one
                                            run each, in one start of the engine. --put: a file written into the engine first.
                                            A run ends in a line PASS or FAIL and says which picture to look at, if any; what
                                            it did step by step is in told.txt (--verbose: printed as it goes). The pictures
                                            are a third of the page each way (--full-pictures: the page's size).
                                            It needs Playwright, an outside program: --playwright names the folder that holds its
                                            node_modules (or PLAYWRIGHT_DIR)
  play native --map <name> [--mod ts] [--half-life <folder>] [--game-folder ts] [--steps ...] [-o ...] [--expect ...]
              [--input [--quiet 5000]] [--window-pictures]
                                            the same run in the game Steam installed (hl.exe, -insecure, never a server), by its
                                            console: no view read or set; walks and turns by time, commands, what it says and its
                                            own screenshots. The Half-Life folder is found in Steam's libraries (or --half-life,
                                            SMAK_HALF_LIFE); the game's folder is the profile's (or --game-folder). --input: real
                                            keys and mouse buttons to its window (ask the person first): only while it is in front,
                                            after the keyboard and mouse are left alone --quiet ms, and stopped if they are touched.
                                            --window-pictures: the pictures are of its window, as the person sees it
  play <url> --serve [--port 8098] [--over <place>=<folder> ...] [--mod ...] [--playwright ...]
                                            the game started and KEPT: a session served on this machine, for runs that pay for
                                            their map and not for the engine. --over: a folder laid over the game's (msc=mine/msc),
                                            marked now; a run with the same --over puts what changed in it since
  play <session> --attach --map <name> [--steps steps.json] [-o <folder>] [--expect ...] [--put ...] [--over ...]   a run in that session
  play <session> --attach --stay [--steps steps.json] [-o <folder>] [--from <section|step>]   more steps where the last run left the player
  play <session> --attach --close                                        the session ended
`,
  },
  "gmod-map": {
    run: gmodMap,
    own: true,
    help: `  gmod-map <bsp> -o <folder> [--name n] [--folder smak] [--game <mod folder>] [--valve <folder>|none] [--no-physics]
                              [--vphysics <dll>] [--gmod <folder>] [--studiomdl <exe>]
                                            a GoldSrc map rewritten as a Source map (BSP 20) for Garry's Mod, ported from
                                            stevenlafl's converter: its geometry, baked light and visibility kept lump by lump,
                                            its collision brushes rebuilt from the tree (clip brushes from the player's hulls), its
                                            entities as Source reads them, its textures, sky and sprites as VTF and VMT (a wad's
                                            shared in the addon; the map's own and Valve's inside the map), its physics made by
                                            GMod's own vphysics (bin/win64/vphysics.dll, through a small helper built once with
                                            Visual Studio; SMAK_VPHYSICS, SMAK_VCOLLIDE). <folder>/addon goes into
                                            garrysmod/addons/<name>/. --game: the mod's folder, for its wads, skies, sprites and
                                            models. --valve: Half-Life's valve folder (found in Steam's libraries unless given).
`,
  },
  "gmod-port": {
    run: gmodPort,
    own: true,
    help: `  gmod-port <mdl> -o <folder> [--name n] [--folder smak] [--collision auto|hull|box|ragdoll|none] [--surfaceprop wood] [--mass kg]
                              [--kind thing|view|held|player] [--upper] [--hand-roll degrees] [--studiomdl <exe>] [--gmod <folder>] [--no-compile]
                                            a GoldSrc model ported to Garry's Mod: its bones, animations (those in <name>01.mdl
                                            too), bodygroups, skins, attachments and hit boxes as Source's compiler's files
                                            (<folder>/src: the QC and SMDs) and its textures as VTF and VMT (<folder>/addon), then
                                            compiled by GMod's own studiomdl (an outside program that comes with GMod; --studiomdl,
                                            SMAK_STUDIOMDL), the compiled model read back and held to the original, corner by
                                            corner, and drawn (<folder>/sheet.png). <folder>/addon goes into garrysmod/addons/<name>/.
                                            What Source has no place for is warned of. Ends in PASS or FAIL.
                                            --collision (auto): a hull for a model of one bone (a physics prop that rolls), a
                                            ragdoll for a figure with hit boxes (pieces fitted to the body, joints that bend as its
                                            animations bend them), box, none. --surfaceprop:
                                            what it is made of (taken from a kit-built model's record, else default; flesh for a
                                            ragdoll); --mass: kg (else its hull's volume at its surfaceprop's density; 90 a ragdoll).
                                            --kind: view (a v_ model: no fades, activities by name, a muzzle), held (a p_ model)
                                            and player (one under models/player/): Valve's bone names and hands, so GMod finds the
                                            hand; a player also stands on its feet and has GMod's hand attachments. --upper: a
                                            player's animations each copied from the spine up (<name>_upper). The sounds its events
                                            play are copied under addon/sound/<folder>/.`,
  },
  "sbox-port": {
    run: sboxPort,
    own: true,
    help: `  sbox-port <mdl | glb | gltf> -o <Assets folder> [--name n] [--folder smak] [--kind thing|view|held|player] [--collision auto|hull|box|ragdoll|none]
                              [--surfaceprop wood] [--mass kg] [--lighting sbox|goldsrc] [--sbox <folder>] [--no-compile]
                                            a GoldSrc model ported to s&box: its meshes and animations (those in <name>01.mdl
                                            too) as DMX, its bodygroups, skins, attachments, hit boxes, animations' activities,
                                            events and travel in a .vmdl (models/<folder>/<name>.vmdl), its textures as PNG and
                                            .vmat (materials/models/<folder>/<name>/), under -o, an s&box project's Assets folder;
                                            then compiled by s&box's own resourcecompiler (an outside program that comes with
                                            s&box; --sbox, SMAK_SBOX). A loop's travel is taken out as root motion. An event that
                                            plays a sound plays it in s&box (AE_CL_PLAYSOUND): its .wav copied from the game's
                                            sound/ folders (its mod's, then valve's) under sounds/<folder>/, beside it a .sound
                                            heard as far as GoldSrc heard it, a loop told in its .meta; any other event, and one
                                            whose sound is not found, is kept as s&box's generic one (its number, its options).
                                            It collides as gmod-port's
                                            does (--collision, --surfaceprop, --mass as there): its hull, or a ragdoll of a hull
                                            a piece and joints that bend as its animations bend it (a hinge or a cone), its weight
                                            shared by volume; pieces that meet at rest and are not joined are trimmed apart. An
                                            animation's blends (Half-Life's aiming) go in an animation graph (<name>.vanmgrph):
                                            an animation chosen by its "sequence", blended by blend_xr and the like, as GoldSrc's
                                            game code did; each blend is an animation of its own too.
                                            --lighting goldsrc: lit as GoldSrc lights a model (shaders/smak_studio.shader: one
                                            light, the sky's or the floor's, that the game hands its renderer; docs/SBOX.md).
                                            A .glb or .gltf: its skin (four bones a vertex), its animations (each once, at 30 fps;
                                            those named idle, walk, run... loop) and its materials' colours or PNG pictures, as
                                            they are, no .mdl on the way (src/sbox/glb.mjs; --name, --folder, --sbox, --no-compile).`,
  },
  "sbox-check": {
    run: sboxCheck,
    own: true,
    help: `  sbox-check <mdl | glb | gltf> --project <folder> [-o shot.png] [--name n] [--folder smak] [--kind ...] [--collision ...] [--surfaceprop s] [--mass kg]
                              [--frames 2] [--tolerance 0.1] [--no-look] [--sbox <folder>]
                                            a model's port (sbox-port's, in the project's Assets) read back in s&box's own editor
                                            and held to the original: every bone under its parent, every animation of its length,
                                            the bodygroups, skins, attachments and hit boxes, and each animation stopped at
                                            --frames of its frames (its first and middle by default) with every bone where
                                            GoldSrc's frame puts it, within --tolerance units; each blend too, and the graph's
                                            blends at their start, middle and end, where GoldSrc's renderer mixes them. What it
                                            collides as: each piece's hull, mass, surface and joint as the port wrote them, then
                                            tried in a physics world of its own: held at rest (no piece pushes another), held in
                                            the poses inside its joints' limits, and dropped onto a floor (it comes to rest, its
                                            joints together). Its sounds: each .sound as the editor compiled it, as long, as far
                                            heard and as loud, 10 ms by 10 ms, as the original; played, a loop still playing
                                            after its length; and each animation played through, its sound events heard. Every
                                            material compiled by the editor (one that is not, s&box draws red). How it looks
                                            (--no-look: not pictured): drawn by s&box from four views round it in a scene of its
                                            own, and by the kit's own renderer from the same eyes: its silhouette and its colours,
                                            region by region, the original's. Give it the port's options (--name, --collision...).
                                            Uses the editor open on the project, else opens one (sbox-cli, which comes with s&box)
                                            and closes it after. -o: the two rows of pictures. Ends in PASS or FAIL.`,
  },
  "sbox-map": {
    run: sboxMap,
    own: true,
    help: `  sbox-map <bsp> -o <Assets folder> [--name n] [--folder smak] [--game <mod folder>] [--mod msc] [--lighting lights]
                                            a GoldSrc map made an s&box scene (scenes/<folder>/<name>.scene), under -o, an s&box
                                            project's Assets folder: each face of the BSP a polygon of the scene editor's own
                                            meshes (MeshComponent: drawn, collided with, editable), the world's in one, each
                                            brush entity's in its own at its origin; its clip brushes rebuilt from the player's
                                            hulls (as gmod-map's), solid, seen in the editor only; its textures as PNG and .vmat
                                            (a wad's under materials/<folder>/<wad>/, shared), its sky one picture round the world;
                                            its starts as SpawnPoints at their feet; its light the map's own lightmaps (one
                                            picture of the map's, read by SMAK's shader as GoldSrc lays light on a texture),
                                            its light entities as s&box's lights for what moves. --lighting lights: s&box's
                                            lights instead (a face whose texture shines lit by itself with a light before it, an
                                            indirect light volume to bake). --game: the mod's folder, for its wads and sky. --mod: a
                                            profile (msc, ts, or a file), whose start classes the starts are. Not yet:
                                            doors, buttons and other moving brushes (drawn where they start), items, sounds.`,
  },
  "sbox-map-check": {
    run: sboxMapCheck,
    own: true,
    help: `  sbox-map-check <bsp> --project <folder> [-o shot.png] [--name n] [--folder smak] [--game <mod folder>] [--mod msc]
                              [--lighting lights] [--count 5000] [--seed 1] [--allow 0.5] [--no-light] [--sbox <folder>]
                                            the map ported (sbox-map's, into the project's Assets) and held to the GoldSrc map in
                                            s&box's own editor: every mesh with its faces and its materials compiled, the sky, the
                                            starts and lights where they were; where a player is blocked, at --count spots
                                            standing and ducked (GoldSrc's hulls against s&box's physics; within --allow in a
                                            hundred, as gmod-collision); each start's floor where GoldSrc's is; and its light,
                                            pictured from each start beside GoldSrc's lightmaps as the game draws them, as bright
                                            and lit in the same places. Uses the editor open on the project, else opens one and
                                            closes it after. -o: GoldSrc's view from the first start beside s&box's. Ends in PASS
                                            or FAIL.`,
  },
  "gmod-rcon": {
    run: gmodRcon,
    own: true,
    address: true,
    help: `  gmod-rcon <command> [<command> ...] [--password p] [--host a] [--port 27015]
                                            console commands sent to a running GMod over Source's RCON (a dedicated server, or
                                            the game started with -usercon +rcon_password p), its answer printed. It is looked for
                                            on 127.0.0.1 and each LAN address (a listen server answers on the LAN's);
                                            SMAK_RCON_HOST, SMAK_RCON_PASSWORD. A command a line: several at once trip GMod's
                                            guard against floods, so longer Lua goes by gmod-probe.`,
  },
  "gmod-probe": {
    run: gmodProbe,
    own: true,
    address: true,
    help: `  gmod-probe <file.lua | map> [--name n] [--client] [--wait ms] [--game <folder>] [-o lines.txt] [--password p] ...
                                            a Lua probe run inside the game: written under garrysmod/lua/ (a new name each run),
                                            run by lua_openscript over RCON (--client: lua_openscript_cl), its lines read from
                                            garrysmod/data/. The probe calls check(ok, what), note(text) and done() (by a timer
                                            too); an error is a FAIL. Ends in PASS or FAIL. Built in: map (a gmod-map port loaded:
                                            the world's physics, each start's floor and room, the floors' surfaceprops, a crate
                                            dropped that lands; the models the game lacks noted). --game: the folder holding
                                            garrysmod/ (a dedicated server's install), else GMod's.`,
  },
  "gmod-collision": {
    run: gmodCollision,
    own: true,
    help: `  gmod-collision <GoldSrc bsp> [--count 5000] [--seed 1] [--ducked] [--noclip] [--allow 0.5] [--name n] [--game <folder>] [--port p] [--password p]
                                            where a player is blocked in a GoldSrc map and in its gmod-map port loaded in the
                                            game, ported from stevenlafl's check-collision: random spots inside the map, each asked
                                            of the GoldSrc map's hull 1 (the standing player's, clip brushes in it; --ducked: hull 3)
                                            and of the game (a player-sized TraceHull, MASK_PLAYERSOLID, the world only; --noclip:
                                            player and NPC clip left out). PASS when they disagree on no more than --allow spots in
                                            a hundred. --game: the server's install (the folder holding garrysmod/).`,
  },
  "gmod-server": {
    run: gmodServer,
    own: true,
    folder: true,
    help: `  gmod-server <dedicated server folder> --map <name> [--port 27016] [--password p] [--gamemode sandbox] [--players 4]
                                            a dedicated GMod server (SteamCMD: app_update 4020) started on a map for probes and
                                            gmod-collision: off the server list (sv_lan 1), cheats on, RCON with --password
                                            (SMAK_RCON_PASSWORD), its console in garrysmod/console.log. Port 27016 by default, so the
                                            game's own 27015 stays free. On Windows in a minimized window of its own, until
                                            gmod-rcon quit --port 27016.`,
  },
  "gmod-shoot": {
    run: gmodShoot,
    own: true,
    address: true,
    help: `  gmod-shoot <x> <y> <z> [pitch yaw] [-o shot.jpg] [--fov 75] [--game <folder>] [--password p] ...
                                            a screenshot from GMod's client (a listen server, -usercon): player 1 in noclip with
                                            its eye at x y z looking along pitch yaw, the HUD and view model off for it.`,
  },
  "source-info": {
    run: sourceInfo,
    own: true,
    address: true,
    help: `  source-info <mdl | models/...mdl> [--json] [--gmod <folder>] [--addon <folder>]
                                            what a Source model holds: bones, bodygroups, materials (found as the game finds them),
                                            skins, attachments, hit boxes, animations. A path under the game (models/kleiner.mdl) is
                                            read from GMod's folders and packs`,
  },
  "source-render": {
    run: sourceRender,
    own: true,
    address: true,
    help: `  source-render <mdl | models/...mdl> -o out.png [--view ...] [--yaw] [--pitch] [--zoom] [--body n] [--skin n]
  source-sheet <mdl | models/...mdl> -o out.png [--size 384]
                                            a Source model drawn at rest, as render and sheet draw a GoldSrc one`,
  },
  "source-sheet": { run: sourceRender, own: true, address: true },
  mcp: {
    run: mcp,
    help: `  mcp --work <folder> [--models <folder>] [--no-run]
                                            an MCP server on stdin and stdout, for a client with no shell (mcp/README.md);
                                            --no-run: without the tool that runs scripts`,
  },
};
const HELP = `smak <command> <model.mdl | map.bsp | file> [...]        (node bin/smak.mjs ...)

${Object.values(COMMANDS)
  // a command said in another's help (source-sheet in source-render's) has none of its own
  .filter((entry) => entry.help)
  .map((entry) => entry.help)
  .join("\n")}
`;

// ── the start ──────────────────────────────────────────────────────────────
const { flags, args, listed } = parseArgs(process.argv.slice(2));
// `check --publish <folder>`: the folder was taken for the flag's value
if (args[0] === "check" && typeof flags.publish === "string") {
  args.splice(1, 0, flags.publish);
  flags.publish = true;
}
const [command, file, ...rest] = args;
if (!command || command === "help" || flags.help) {
  console.log(HELP);
  process.exit(0);
}
// `check rp <file>`: an RP map's contract (<map>.rp.json) or a plugin script (<map>.script.json); no model is read
if (command === "check" && file === "rp") {
  checkFlags(flags);
  const target = rest[0];
  if (!target || !existsSync(target)) fail(`check rp: give an rp.json or a script.json that exists${target ? ` (no such file: ${target})` : ""}`);
  const { checkRpFile } = await import("../levels/rp/script.mjs");
  let result;
  try {
    result = checkRpFile(target, { rp: typeof flags.rp === "string" ? flags.rp : undefined });
  } catch (error) {
    fail(`check rp: ${sayOf(error)}`);
  }
  answered("check-rp", target, flags, result);
  process.exit(result.passed ? 0 : 1);
}
// the MCP server is given folders by flags, not a file
if (command === "mcp") await mcp({ flags });
if (!file) fail(HELP);
const entry = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
// `address: true`: what follows the command is a page's address, not a file
if (!entry?.address && !existsSync(file)) fail(`no such file: ${file}`);
// check --publish is handed a folder to be shared, not a model
if (command === "check" && flags.publish) {
  checkFlags(flags);
  try {
    checkPublish({ file, flags, listed });
  } catch (error) {
    fail(`check --publish: ${sayOf(error)}`);
  }
}
// a page is handed a folder as readily as a model; every other command reads a file
if (!entry?.page && !entry?.folder && !entry?.address) existing(file);
checkFlags(flags);
// whatever a command throws is said in a sentence, with the command's name before it
try {
  // a page never comes back from `run`, and a command that reads its own file ends the run with it
  if (entry?.page || entry?.own) {
    await entry.run({ command, file, rest, flags, listed });
    process.exit(0);
  }
  // the file is read before the command is looked up: what cannot be read is said first
  const src = readModel(file, command);
  if (!entry) fail(`no command ${command}\n\n${HELP}`);
  await entry.run({ command, file, rest, flags, src });
} catch (error) {
  fail(`${command}: ${sayOf(error)}`);
}
