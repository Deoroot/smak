// The tools the server offers, few on purpose. A client is sent every tool's description in every
// conversation, so each is a line or two; what an agent has to know to do the work is in the kit's guide,
// which the tool `guide` hands out a section at a time.
//
//   guide   the kit's guide and reference, by section
//   models  the files there are: models, maps and texture files
//   info    what is in a model, a map or a texture file
//   check   whether an engine will take a model or a map
//   render  a picture of a model or a map
//   run     a script over the kit (see run.mjs): the tool everything that makes or changes a model goes by
//
// There is no tool for each thing the kit does (paint, turn, putBody...): those take functions, and a
// function is written in a script.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import * as smak from "../../src/index.mjs";
import * as maps from "../../check/maps/index.mjs";
import { text, image } from "./protocol.mjs";
import { filesUnder, pathOf } from "./folders.mjs";
import { guide } from "./guide.mjs";
import { run, pictureWithin, TIMEOUT_SECONDS, OUTPUT_MOST, SHOWN_MOST, PICTURE_MOST } from "./run.mjs";

/** A picture's longer side in pixels when the call does not say: of one view, and of several in one. */
const SIZE_ONE = 512;
const SIZE_SEVERAL = 768;
/** How many pictures `sheet` puts in a row, and `strip` at most; how many moments `strip` draws unless told. */
const SHEET_COLUMNS = 3;
const STRIP_COLUMNS = 4;
const STRIP_COUNT = 8;
/** A first-person picture is this much as high as it is wide. */
const FIRST_PERSON_HEIGHT = 0.75;
/** `models` lists no more files than this of one folder. */
const LISTED_MOST = 200;
/** The files of the models folder that are listed: models, compiled maps, map source and texture files. */
const LISTED_KINDS = /\.(mdl|bsp|map|wad)$/i;
/** A map view is this much as high as it is wide; `views` puts this many in a row. */
const MAP_VIEW_HEIGHT = 0.75;
const MAP_VIEWS_COLUMNS = 4;
/** A map's picture is this many pixels on its longer side at the least. */
const MAP_SIZE_LEAST = 64;
/** `info` and a plan list no more entities than this unless asked for all (`full`). */
const ENTITIES_MOST = 40;
const isCompiledMap = (file) => /\.bsp$/i.test(file);
const isMapSource = (file) => /\.map$/i.test(file);
const isWad = (file) => /\.wad$/i.test(file);
/** A studio model's header: its length in bytes, and where in it the number of textures is written. */
const HEADER_BYTES = 184;
const TEXTURE_COUNT_AT = 180;
/** The name the model gives itself: 64 bytes of the header, from byte 8. */
const NAME_AT = 8;
const NAME_END = 72;
/** The sides `render` knows by name: where the camera stands, [yaw, pitch] in degrees. */
const SIDES = {
  front: [0, 0],
  left: [90, 0],
  back: [180, 0],
  right: [270, 0],
  top: [0, 90],
  below: [0, -90],
  quarter: [35, 20],
};

/**
 * A model a client named, read; one whose textures are in the file beside it (<name>t.mdl) is read with
 * them. Returns { src, file }.
 */
function readModel(folders, name) {
  const file = pathOf(folders, name);
  let src = readFileSync(file);
  const textureFile = file.replace(/\.mdl$/i, "t.mdl");
  const hasNone = src.length > HEADER_BYTES && !src.readInt32LE(TEXTURE_COUNT_AT);
  if (hasNone && existsSync(textureFile)) src = smak.withTextures(src, readFileSync(textureFile));
  return { src, file };
}

/** An animation as a call names it: "rest" is the bones at rest, digits a number, anything else a name. */
const seqOf = (src, seq) => {
  if (seq === undefined || seq === null) return smak.sequences(src).length ? 0 : null;
  if (seq === "rest") return null;
  return /^\d+$/.test(String(seq)) ? Number(seq) : seq;
};

// ── models ─────────────────────────────────────────────────────────────────
/**
 * The files of the two folders: every file of the work folder, and the models folder's models, maps and
 * texture files.
 */
function listModels(folders, { match } = {}) {
  const wanted = match ? String(match).toLowerCase() : "";
  const lines = [];
  const list = (title, folder, onlyModels) => {
    const files = filesUnder(folder).filter(
      (file) => (!onlyModels || LISTED_KINDS.test(file.name)) && file.name.toLowerCase().includes(wanted),
    );
    lines.push(`${title}: ${files.length} file${files.length === 1 ? "" : "s"}`);
    for (const file of files.slice(0, LISTED_MOST)) lines.push(`  ${file.name} ${file.bytes}`);
    if (files.length > LISTED_MOST)
      lines.push(`  and ${files.length - LISTED_MOST} more: narrow the list with \`match\``);
  };
  if (folders.models) list("models (read only; .mdl, .bsp, .map and .wad files)", folders.models, true);
  list("work", folders.work, false);
  return [text(lines.join("\n"))];
}

// ── info ───────────────────────────────────────────────────────────────────
/** The names of a texture's flags, joined with +. */
const flagNames = (flags) =>
  Object.entries(smak.TEXTURE)
    .filter(([, bit]) => flags & bit)
    .map(([name]) => name)
    .join("+");

/**
 * What is in a model, in few words: its bones (each with its parent's number), its bodies with their body
 * numbers, its textures and its animations. `full` adds where each bone is, the events and the attachments.
 */
function info(folders, { model, full = false }) {
  const named = pathOf(folders, model);
  if (isCompiledMap(named)) return mapInfo(named, full);
  if (isMapSource(named)) return sourceInfo(named);
  if (isWad(named)) return wadInfo(named);
  const { src, file } = readModel(folders, model);
  const mdl = smak.readMdl(src);
  const bones = smak.bones(src);
  const sequences = smak.sequences(src);
  const attachments = smak.attachments(src);
  const selfName = src.toString("latin1", NAME_AT, NAME_END).replace(/\0.*$/s, "");
  const place = (point) => point.map((value) => value.toFixed(2)).join(" ");
  const lines = [`${basename(file)}: "${selfName}", ${src.length} bytes`];

  lines.push(`BONES (${bones.length}): number name<parent`);
  if (full)
    for (const [i, bone] of bones.entries())
      lines.push(`  ${i} ${bone.name}<${bone.parent} at ${place(bone.pos)}`);
  else
    lines.push(
      `  ${bones.map((bone, i) => `${i} ${bone.name}${bone.parent < 0 ? "" : `<${bone.parent}`}`).join(", ")}`,
    );

  lines.push(`BODYPARTS (${mdl.bodyparts.length}): a body number is the sum of one from each part`);
  for (const bodypart of mdl.bodyparts) {
    lines.push(`  ${bodypart.name}`);
    bodypart.models.forEach((model, k) => {
      const meshes = model.meshes.map((mesh) => `${mesh.numtris} on ${mesh.texture?.name ?? null}`);
      lines.push(
        `    body ${k * bodypart.base} ${model.name}: ${model.numverts} points, triangles ${meshes.join(", ") || "none (empty)"}`,
      );
    });
  }

  const families = smak.skinFamilies(src).length;
  lines.push(`TEXTURES (${mdl.textures.length}${families > 1 ? `, ${families} skin families` : ""})`);
  for (const [i, texture] of mdl.textures.entries())
    lines.push(
      `  ${i} ${texture.name} ${texture.width}x${texture.height}${texture.flags ? ` ${flagNames(texture.flags)} (flags ${texture.flags})` : ""}`,
    );

  lines.push(`ANIMATIONS (${sequences.length}): the game asks for them by number`);
  for (const [i, seq] of sequences.entries()) {
    const notes = `${seq.loops ? ", loops" : ""}${seq.blends > 1 ? `, ${seq.blends} blends` : ""}${seq.group ? ", KEPT IN ANOTHER FILE" : ""}`;
    const events = smak.events(src, i);
    lines.push(
      `  ${i} ${seq.name}: ${seq.frames} frames at ${seq.fps} fps${notes}${events.length && !full ? `, ${events.length} events` : ""}`,
    );
    if (full)
      for (const event of events)
        lines.push(
          `      frame ${event.frame}: event ${event.event}${event.options ? ` "${event.options}"` : ""}`,
        );
  }

  lines.push(`${attachments.length} attachments, ${smak.hitboxes(src).length} hit boxes`);
  if (full)
    for (const [i, attachment] of attachments.entries())
      lines.push(
        `  attachment ${i} on ${bones[attachment.bone]?.name ?? attachment.bone} at ${place(attachment.pos)}`,
      );
  return [text(lines.join("\n"))];
}

// ── info of a map ──────────────────────────────────────────────────────────
/** An entity in a line: its number, its class, where it is, and (`full`) its other keys. */
function entityLine(entity, number, full) {
  const model = maps.brushModelOf(entity);
  const origin = maps.originOf(entity);
  const place = model !== null && number ? `brushes *${model}` : origin ? `at ${origin.join(" ")}` : "";
  const others = entity
    .filter(([key]) => !["classname", "origin"].includes(key) && !(key === "model" && model !== null))
    .map(([key, value]) => `${key}=${/\s/.test(value) ? `"${value}"` : value}`);
  const keys = full && others.length ? ` ${others.join(" ")}` : "";
  return `  ${number} ${maps.valueOf(entity, "classname") ?? "(no classname)"} ${place}${keys}`;
}
/**
 * What is in a compiled map, in few words: its size, its entities by class and one by one (the first
 * forty; `full`: all, with their keys), its textures and which are wanted from .wad files, its light.
 */
function mapInfo(file, full) {
  const bytes = readFileSync(file);
  const bsp = maps.readBsp(bytes);
  const { mins, maxs } = maps.worldBounds(bsp);
  const classes = new Map();
  for (const entity of bsp.entities) {
    const classname = maps.valueOf(entity, "classname") ?? "(no classname)";
    classes.set(classname, (classes.get(classname) ?? 0) + 1);
  }
  const byCount = [...classes]
    .sort((a, b) => b[1] - a[1])
    .map(([classname, count]) => `${classname} ${count}`);
  const wanted = maps.wantedTextures(bsp);
  const shown = full ? bsp.entities : bsp.entities.slice(0, ENTITIES_MOST);
  const textures = bsp.textures.map(
    (texture) => `${texture.name} ${texture.width}x${texture.height}${texture.embedded ? "" : " WANTED"}`,
  );
  const lines = [
    `${basename(file)}: a GoldSrc map, ${bytes.length} bytes; the world from ${mins.join(" ")} to ${maxs.join(" ")} (+z up)`,
    `${bsp.faces.length} faces, ${bsp.leaves.length} leaves, ${bsp.models.length - 1} brush entities; light ${bsp.lumps.lighting.length} bytes, visibility ${bsp.lumps.visibility.length} bytes`,
    `ENTITIES (${bsp.entities.length}): ${byCount.join(", ")}`,
    ...shown.map((entity, number) => entityLine(entity, number, full)),
  ];
  if (shown.length < bsp.entities.length)
    lines.push(`  and ${bsp.entities.length - shown.length} more: \`full\` lists all, with their keys`);
  lines.push(`TEXTURES (${bsp.textures.length}): ${textures.join(", ")}`);
  if (wanted.textures.length)
    lines.push(
      `${wanted.textures.length} are WANTED from .wad files: ${wanted.wads.join(", ") || "none listed"}`,
    );
  return [text(lines.join("\n"))];
}
/** What is in brush source: its brushes, its entities and the textures its faces name. */
function sourceInfo(file) {
  const map = maps.readMap(readFileSync(file, "utf8"));
  const names = new Set();
  const brushes = [...map.brushes.flat(), ...map.entities.flatMap((entity) => entity.brushes ?? [])];
  for (const brush of brushes) for (const face of brush.faces) names.add(face.texture);
  const placeOf = (entity) =>
    entity.brushes ? `${entity.brushes.length} brushes` : `at ${entity.origin ?? "no place"}`;
  const lines = [
    `${basename(file)}: brush source, ${map.brushes.flat().length} brushes of the world, ${map.entities.length} entities; wad: ${map.worldspawn.wad ?? "none"}`,
    ...map.entities.map((entity, index) => `  ${index + 1} ${entity.classname} ${placeOf(entity)}`),
    `TEXTURES named: ${[...names].sort().join(", ")}`,
  ];
  return [text(lines.join("\n"))];
}
/** The textures of a .wad file, each with its size. */
function wadInfo(file) {
  const read = maps.readWad(readFileSync(file));
  const listed = read.textures.map((texture) => `${texture.name} ${texture.width}x${texture.height}`);
  return [text(`${basename(file)}: ${read.textures.length} map textures: ${listed.join(", ")}`)];
}

// ── check ──────────────────────────────────────────────────────────────────
/** A list of entities as a call names them: "9, keeper" is entity 9 and the one named keeper. */
const namesOf = (value) =>
  value === undefined || value === null || value === ""
    ? undefined
    : String(value)
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => (/^\d+$/.test(word) ? Number(word) : word));

/** The walk test of a map, in lines: its facts, its openings, its warnings. */
function walkLines(map, args) {
  const reach = maps.reachOf(map, {
    to: namesOf(args.goal) ?? [],
    doors: args.doors ?? "open",
  });
  return [
    `the walk test, on a grid of ${reach.cell}:`,
    ...reach.facts,
    ...reach.openings
      .slice(0, ENTITIES_MOST)
      .map(
        (opening) =>
          `  opening ${opening.number} at ${opening.at.join(" ")}: ${opening.width} wide, ${opening.height === null ? "open above" : `${opening.height} high`}${opening.fits.large ? "" : " (closed to a large monster)"}`,
      ),
    ...reach.warnings.map((warning) => `WARN  ${warning}`),
  ];
}

/**
 * What a map's entities are checked against, from a call's `against`: files of the folders, with commas
 * between. An .fgd file and a file of learned definitions (`smak map-learn`) are entity definitions; another
 * .json file is a mod's profile, as data; `goldsrc` is the kit's own profile. A profile that is a module is
 * code, and is for the tool `run`.
 */
function againstMod(folders, file, args) {
  const against = {};
  const definitions = [];
  const names = String(args.against ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (name === "goldsrc") against.mod = { ...maps.GOLDSRC, folders: mapFolders(folders, file) };
    else if (/\.fgd$/i.test(name)) definitions.push(pathOf(folders, name));
    else if (/\.json$/i.test(name)) {
      const data = JSON.parse(readFileSync(pathOf(folders, name), "utf8"));
      // what was learned from a mod's maps has its classes; anything else is a profile
      if (data.classes && data.maps) definitions.push(data);
      else against.mod = data.folders?.length ? data : { ...data, folders: mapFolders(folders, file) };
    } else
      throw new Error(
        `against: ${name} is neither an .fgd file, a .json file (learned definitions, or a profile that is data) nor goldsrc. A profile that is a module (.mjs) is code: load it in a script, with the tool run (maps.loadMod)`,
      );
  }
  if (definitions.length) against.definitions = definitions;
  return against;
}

/**
 * What is wrong with brush source before any compile, as `checkPlan` finds it; with `walk`, the walk test
 * too.
 */
function checkSource(folders, file, args) {
  const map = maps.readMap(readFileSync(file, "utf8"));
  const report = maps.checkPlan(map, againstMod(folders, file, args));
  const lines = [
    ...report.facts,
    ...report.warnings.map((warning) => `WARN  ${warning}`),
    ...report.errors.map((error) => `ERROR ${error}`),
    report.errors.length
      ? `${report.errors.length} errors: fix them before compiling`
      : "no error in the plan",
    ...(args.walk ? walkLines(map, args) : []),
  ];
  return [text(lines.join("\n"))];
}

/** What an engine would refuse or draw wrong, as `smak check` and `smak map-check` print it. */
function check(folders, args) {
  const { model, engine = "goldsrc" } = args;
  const named = pathOf(folders, model);
  if (isMapSource(named)) return checkSource(folders, named, args);
  const report = isCompiledMap(named)
    ? maps.checkBsp(readFileSync(named), {
        engine,
        folders: mapFolders(folders, named),
        ...againstMod(folders, named, args),
      })
    : smak.check(readModel(folders, model).src, engine);
  const warned = report.warnings.length ? `, with ${report.warnings.length} warnings` : "";
  const verdict = report.errors.length
    ? `${report.errors.length} errors: not fit for ${engine}`
    : `fit for ${engine}${warned}`;
  const lines = [
    ...report.facts,
    ...report.warnings.map((warning) => `WARN  ${warning}`),
    ...report.errors.map((error) => `ERROR ${error}`),
    verdict,
    ...(args.walk && isCompiledMap(named) ? walkLines(maps.readBsp(readFileSync(named)), args) : []),
  ];
  return [text(lines.join("\n"))];
}

// ── render ─────────────────────────────────────────────────────────────────
/** The body numbers of a model, a line a bodypart: what is said when a body shows nothing. */
const bodyNumbers = (src) =>
  smak
    .readMdl(src)
    .bodyparts.map(
      (bodypart) =>
        `  ${bodypart.name}: ${bodypart.models.map((model, k) => `${k * bodypart.base}=${model.name}`).join(" ")}`,
    )
    .join("\n");

/** The four kinds of picture: each takes the model, the call's arguments and the size, and draws. */
const KINDS = {
  view: (src, args, size) => {
    const [yaw, pitch] = SIDES[args.side ?? "quarter"] ?? [];
    if (yaw === undefined) throw new Error(`side: one of ${Object.keys(SIDES).join(", ")}`);
    const first = args.first === true;
    return smak.render(src, {
      ...args.pose,
      view: first ? "first" : "orbit",
      yaw: args.yaw ?? yaw,
      pitch: args.pitch ?? pitch,
      dist: args.dist,
      zoom: args.zoom,
      width: size,
      height: first ? Math.round(size * FIRST_PERSON_HEIGHT) : size,
    });
  },
  sheet: (src, args, size) => smak.sheet(src, { ...args.pose, size: Math.floor(size / SHEET_COLUMNS) }),
  strip: (src, args, size) => {
    const count = args.count ?? STRIP_COUNT;
    const columns = Math.min(STRIP_COLUMNS, count);
    const side = Math.floor(size / columns);
    const first = args.first === true;
    return smak.strip(src, {
      ...args.pose,
      seq: args.pose.seq ?? 0,
      view: first ? "first" : "orbit",
      yaw: args.yaw,
      pitch: args.pitch,
      count,
      cols: columns,
      width: side,
      height: first ? Math.round(side * FIRST_PERSON_HEIGHT) : side,
    });
  },
  uv: (src, args, size) => {
    const which = /^\d+$/.test(String(args.texture ?? 0)) ? Number(args.texture ?? 0) : args.texture;
    const texture = smak.textureOf(src, which);
    const scale = Math.max(1, Math.floor(size / Math.max(texture.width, texture.height)));
    return smak.uvMap(src, which, { scale });
  },
};

// ── render, of a map ───────────────────────────────────────────────────────
/** Where a map's .wad files are looked for: beside it, then in the models folder. */
const mapFolders = (folders, file) => [dirname(file), folders.models].filter(Boolean);

/** Where a map view is taken from, as a call says it: "x y z", or an entity's number or class. */
function standOf(map, at) {
  if (at === undefined || at === null || at === "") return {};
  const numbers = String(at)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length === 3 && numbers.every(Number.isFinite)) return { from: numbers };
  return maps.viewFrom(map, at);
}

/** A point of the plan as a call says it: "x y" (a third number is passed over). */
function planPoint(value, what) {
  const numbers = String(value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length < 2 || !numbers.every(Number.isFinite))
    throw new Error(`${what}: a point of the plan, "x y", not ${value}`);
  return numbers.slice(0, 2);
}

/**
 * The kinds of picture of a map: each takes the map, whether it is source, the arguments and the size.
 */
const MAP_KINDS = {
  plan: (map, source, args, size) => {
    const options = {
      ...args.options,
      width: size,
      height: size,
      z: args.z ?? undefined,
      heights: args.heights === true,
      legend: args.legend === true,
      reach: args.reach === true ? true : undefined,
    };
    return source ? maps.planOfSource(map, options) : maps.planOf(map, options);
  },
  view: (map, source, args, size) => {
    const options = {
      ...args.options,
      ...standOf(map, args.at),
      width: size,
      height: Math.round(size * MAP_VIEW_HEIGHT),
    };
    if (args.yaw !== undefined) options.yaw = args.yaw;
    if (args.pitch !== undefined) options.pitch = args.pitch;
    return source ? maps.drawSource(map, options) : maps.drawMap(map, options);
  },
  views: (map, source, args, size) => {
    if (source) throw new Error("views: of a compiled map (.bsp); of source, kind view and plan");
    const side = Math.floor(size / MAP_VIEWS_COLUMNS);
    return maps.viewsOf(map, {
      ...args.options,
      count: args.count,
      width: side,
      height: Math.round(side * MAP_VIEW_HEIGHT),
      cols: MAP_VIEWS_COLUMNS,
    });
  },
  section: (map, source, args, size) =>
    maps.sectionOf(map, { from: planPoint(args.from, "from"), to: planPoint(args.to, "to"), width: size }),
  storeys: (map, source, args, size) => {
    const side = Math.max(MAP_SIZE_LEAST, Math.floor(size / 2));
    const reach = args.reach === true ? true : undefined;
    return maps.storeysOf(map, { ...args.options, width: side, height: side, cols: 2, reach });
  },
  openings: (map, source, args, size) => {
    const side = Math.floor(size / MAP_VIEWS_COLUMNS);
    return maps.openingViews(map, {
      ...args.options,
      count: args.count,
      width: side,
      height: Math.round(side * MAP_VIEW_HEIGHT),
      cols: MAP_VIEWS_COLUMNS,
    });
  },
};

/** What a map's picture shows, in lines: where it was taken from or how it lies, its marks, its notes. */
function mapShown(kind, facts, shrink) {
  const lines = [];
  if (kind === "plan") {
    const scale = (facts.scale * shrink).toFixed(3);
    const cut = facts.z === null ? "seen from above" : `cut at z ${facts.z}`;
    lines.push(
      `${cut}; +y up, +x right; a point (x, y) is at pixel ((x - ${Math.round(facts.x0)}) * ${scale}, (${Math.round(facts.y0)} - y) * ${scale})`,
    );
    for (const mark of facts.marks.slice(0, ENTITIES_MOST)) {
      const at = mark.at.map((value) => Math.round(value * shrink));
      lines.push(`  ${mark.number} ${mark.classname} ${mark.origin.join(" ")} at pixel ${at.join(",")}`);
    }
    if (facts.marks.length > ENTITIES_MOST)
      lines.push(`  and ${facts.marks.length - ENTITIES_MOST} more marks`);
  } else if (kind === "view") {
    lines.push(
      `from ${facts.from.join(" ")}, yaw ${facts.yaw}, pitch ${facts.pitch}; ${facts.faces} faces; light: ${facts.light}`,
    );
    for (const mark of facts.marked)
      lines.push(
        `  marked: ${mark.number} ${mark.classname}${mark.drawn === "mark" ? "" : `, its ${mark.drawn} ${mark.size}`}`,
      );
  } else if (kind === "section") {
    lines.push(
      `a section ${facts.length} units long from ${facts.from.join(" ")} (left) to ${facts.to.join(" ")} (right), heights ${facts.z.map(Math.round).join(" to ")}, seen looking yaw ${facts.looking}`,
    );
    for (const floor of facts.floors.filter((each) => each.to - each.from >= 16).slice(0, ENTITIES_MOST))
      lines.push(`  floor at z ${floor.z} from ${floor.from} to ${floor.to} along the line`);
    for (const mark of facts.marks.slice(0, ENTITIES_MOST))
      lines.push(`  ${mark.number} ${mark.classname} ${mark.along} along the line, z ${mark.z}`);
  } else if (kind === "storeys") {
    for (const storey of facts.storeys)
      lines.push(
        `  cut at z ${storey.z}${storey.floors ? `: floors from ${storey.floors[0]} to ${storey.floors[1]}` : ""}; ${storey.marks.length} entities`,
      );
  } else if (kind === "openings") {
    for (const view of facts.views)
      lines.push(
        `  opening ${view.opening}: ${view.wide} wide, ${view.high === null ? "open above" : `${view.high} high`}; from ${view.from.join(" ")} looking yaw ${view.yaw}`,
      );
  } else {
    lines.push(...facts.views.map((view) => `  ${view.name}, from ${view.from.join(" ")}`));
  }
  return [...lines, ...(facts.notes ?? [])];
}

/**
 * A picture of a map (.bsp) or of brush source (.map). `kind`: "plan" (unless told), "view", "views",
 * "section", "storeys" or "openings".
 */
function renderMap(folders, file, args) {
  const source = isMapSource(file);
  const map = source ? maps.readMap(readFileSync(file, "utf8")) : maps.readBsp(readFileSync(file));
  const kind = args.kind ?? "plan";
  if (!Object.hasOwn(MAP_KINDS, kind))
    throw new Error(`kind: for a map, one of ${Object.keys(MAP_KINDS).join(", ")}`);
  const asked = Math.round(args.size ?? (kind === "view" ? SIZE_ONE : SIZE_SEVERAL));
  const size = Math.min(PICTURE_MOST, Math.max(MAP_SIZE_LEAST, asked));
  const options = { folders: mapFolders(folders, file) };
  const picture = MAP_KINDS[kind](map, source, { ...args, options }, size);
  const bytes = pictureWithin(smak.png(picture.width, picture.height, picture.rgba));
  const drawn = smak.unpng(bytes);
  // a picture sent smaller than it was drawn has its marks at other pixels: they are said as sent
  const shown = mapShown(kind, picture.facts, drawn.width / picture.width);
  return [
    text(`${basename(file)} ${kind}: ${drawn.width}x${drawn.height}\n${shown.join("\n")}`),
    image(bytes),
  ];
}

/**
 * A picture of a model, with a line that says what it shows. `kind`: "view" (one side), "sheet" (six sides),
 * "strip" (an animation's frames) or "uv" (a texture with the triangles that wear it). `size` is the
 * picture's longer side in pixels.
 */
function render(folders, args) {
  const named = pathOf(folders, args.model);
  if (isCompiledMap(named) || isMapSource(named)) return renderMap(folders, named, args);
  const { src, file } = readModel(folders, args.model);
  const kind = args.kind ?? "view";
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`kind: one of ${Object.keys(KINDS).join(", ")}`);
  const size = Math.min(
    PICTURE_MOST,
    Math.max(1, Math.round(args.size ?? (kind === "view" || kind === "uv" ? SIZE_ONE : SIZE_SEVERAL))),
  );
  // an animation kept in <name>01.mdl beside the model is read from it
  const groups = smak.sequenceGroups(src).length > 1 ? smak.sequenceFilesOf(file, src) : undefined;
  const pose = { seq: seqOf(src, args.seq), frame: args.frame ?? 0, body: args.body ?? 0, groups };
  if (kind !== "uv" && !smak.posed(src, pose).tris.length)
    throw new Error(`body ${pose.body} shows no triangles. Its body numbers:\n${bodyNumbers(src)}`);
  const picture = KINDS[kind](src, { ...args, pose }, size);
  const shown =
    kind === "uv"
      ? `${picture.texture.name} ${picture.texture.width}x${picture.texture.height} x${picture.scale}, ${picture.triangles} triangles of ${picture.meshes} meshes`
      : `body ${pose.body}, ${pose.seq === null ? "at rest" : `animation ${pose.seq}${kind === "strip" ? "" : ` frame ${pose.frame}`}`}`;
  const bytes = pictureWithin(smak.png(picture.width, picture.height, picture.rgba));
  const drawn = smak.unpng(bytes);
  return [text(`${basename(file)} ${kind}: ${shown}; ${drawn.width}x${drawn.height}`), image(bytes)];
}

// ── the tools as a client is told of them ──────────────────────────────────
const MODEL = { type: "string", description: "path under the work or models folder" };
const object = (properties, required = []) => ({ type: "object", properties, required });

/**
 * The tools, for the folders the server was started with: [{ name, description, inputSchema, call }].
 * `allowRun: false` leaves out `run`, the one that runs code.
 */
export function toolsFor(folders, { allowRun = true } = {}) {
  const tools = [
    {
      name: "guide",
      description:
        "SMAK's guide for GoldSrc models (.mdl) and maps (.bsp, .map, .wad). No arguments: the list of sections and what the kit can and cannot do; read it first. `topic`: those sections' text.",
      inputSchema: object({
        topic: { type: "string", description: 'section numbers ("12,20") or words of one title' },
        doc: {
          type: "string",
          description:
            'another document: "api" (every function), "engines", "maps", "maps-making", or a path the list names',
        },
        find: { type: "string", description: "instead of topic: the lines holding these words" },
      }),
      call: (args) => [text(guide(args))],
    },
    {
      name: "models",
      description:
        "Lists the files: the models folder's .mdl, .bsp, .map and .wad (read only) and all of the work folder, with bytes.",
      inputSchema: object({ match: { type: "string", description: "only names holding this" } }),
      call: (args) => listModels(folders, args),
    },
    {
      name: "info",
      description:
        "What a model holds (bones, bodies with their body numbers, textures, animations), or a map (.bsp: entities, textures, light), a .map or a .wad.",
      inputSchema: object(
        {
          model: MODEL,
          full: {
            type: "boolean",
            description: "also bone places, events, attachments; a map: every entity, with its keys",
          },
        },
        ["model"],
      ),
      call: (args) => info(folders, args),
    },
    {
      name: "check",
      description:
        "Errors and warnings a game engine would have with a model or a .bsp map; of a .map, its plan's faults.",
      inputSchema: object(
        {
          model: MODEL,
          engine: { type: "string", enum: ["goldsrc", "xash"] },
          walk: {
            type: "boolean",
            description: "a map: what a player cannot reach on foot or stands in solid; the openings",
          },
          goal: { type: "string", description: 'walk: how far to these entities, "9, keeper"' },
          doors: { type: "string", enum: ["open", "closed"] },
          against: {
            type: "string",
            description:
              "a map's entities checked by these: .fgd, map-learn files, a profile (.json, goldsrc)",
          },
        },
        ["model"],
      ),
      call: (args) => check(folders, args),
    },
    {
      name: "render",
      description: `A picture, as an image. Of a model: kind "view" (default; one side), "sheet" (six sides), "strip" (an animation's frames), "uv" (a texture with its triangles). Of a map (.bsp, .map): "plan" (default; from above, entities marked), "view" (from inside), "views" (several), "section" (a side cut), "storeys" (a plan each), "openings" (a view through each doorway).`,
      inputSchema: object(
        {
          model: MODEL,
          kind: {
            type: "string",
            enum: [...Object.keys(KINDS), "plan", "views", "section", "storeys", "openings"],
          },
          body: { type: "number", description: "body number (0)" },
          seq: { type: "string", description: 'animation name or number, or "rest" (default: the first)' },
          frame: { type: "number" },
          side: { type: "string", enum: Object.keys(SIDES), description: "view: default quarter" },
          yaw: { type: "number", description: "degrees; 0 front, 90 left side; map view: 0 looks +x, 90 +y" },
          pitch: { type: "number", description: "degrees; 90 from above; map view: over 0 looks up" },
          at: {
            type: "string",
            description: 'map view: the eye, "x y z" or an entity number or class (default: the first start)',
          },
          z: { type: "number", description: "map plan: cut at this height" },
          from: { type: "string", description: 'section: one end of its line, "x y"' },
          to: { type: "string", description: "section: the other" },
          heights: { type: "boolean", description: "plan: floor heights written" },
          legend: { type: "boolean", description: "plan: entities listed" },
          reach: { type: "boolean", description: "plan, storeys: the walk test tinted" },
          zoom: { type: "number" },
          dist: { type: "number", description: "view: units from the eye, with perspective" },
          first: { type: "boolean", description: "as the player sees a v_ weapon" },
          count: { type: "number", description: `strip: frames drawn (${STRIP_COUNT}); map views: cells` },
          texture: { type: "string", description: "uv: name or number (0)" },
          size: {
            type: "number",
            description: `longer side in px: ${SIZE_ONE}, sheet and strip ${SIZE_SEVERAL}; ${PICTURE_MOST} at most`,
          },
        },
        ["model"],
      ),
      call: (args) => render(folders, args),
    },
    {
      name: "run",
      description: `Runs an ES module with Node in the work folder: how models are built, painted and changed. RUNS ARBITRARY CODE on the server's machine. Import "smak" (also "smak/workshop", "smak/kits/swordkit"; where the guide writes "./smak/src/index.mjs"); read models from process.env.SMAK_MODELS, write to the work folder (the cwd) only. Returns stdout and stderr (${OUTPUT_MOST} characters each at most) and the files written.`,
      inputSchema: object(
        {
          script: { type: "string" },
          show: {
            type: "array",
            items: { type: "string" },
            description: `up to ${SHOWN_MOST} PNG files it wrote, returned as images`,
          },
          timeout: { type: "number", description: `seconds (${TIMEOUT_SECONDS})` },
          name: {
            type: "string",
            description:
              "keep the script as <name>.mjs, to import, edit or run again (alone: runs it as kept)",
          },
          edits: {
            type: "array",
            items: object({ old: { type: "string" }, new: { type: "string" } }, ["old", "new"]),
            description: "with name, no script: each old (once in the kept script) becomes new, then it runs",
          },
        },
        [],
      ),
      call: (args, extra) => run(folders, args, extra),
    },
  ];
  return allowRun ? tools : tools.filter((tool) => tool.name !== "run");
}
