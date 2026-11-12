// What a studio model holds, as data and as lines of text: the one description `smak info` prints and the MCP
// server's `info` answers with.
//
//   describeModel(src, file)                      -> bones, bodyparts, textures, animations (activity, travel,
//                                                    box, events), attachments, hit boxes, controllers, eyes
//   modelInfoLines(src, data, { compact, full, hitboxes, boxes, name })
//                                                 -> the lines: the command line's (padded, every event), or
//                                                    compact for a client's context (bones on one line, events
//                                                    counted unless `full`)
import { readMdl, bones as bonesOf, hitboxes as hitboxesOf, skinFamilies, sequences as sequencesOf, events as eventsOf, attachments as attachmentsOf, boneControllers, ACTIVITY, HITGROUP, MOTION } from "../core/mdl.mjs";
import { TEXTURE } from "./render.mjs";

/** The name the model gives itself: 64 bytes of the header, from byte 8. */
const NAME_AT = 8;
const NAME_END = 72;
/** Where the model sees from (eyeposition), three floats; its four boxes follow. */
const HDR_EYES_AT = 76;

/** A length as `info` gives it: to a hundredth of a unit. */
const round2 = (v) => +v.toFixed(2);
/** The names of the hit groups, by their numbers. */
export const HITGROUP_NAMES = Object.fromEntries(Object.entries(HITGROUP).map(([name, group]) => [group, name]));
/** The names of the bits of a motion type, joined with +. */
export const motionNames = (motiontype) =>
  Object.entries(MOTION)
    .filter(([, bit]) => motiontype & bit)
    .map(([name]) => name)
    .join("+");
/** The names of a texture's flags, joined with +. */
export const flagNames = (flags) =>
  Object.entries(TEXTURE)
    .filter(([, bit]) => flags & bit)
    .map(([name]) => name)
    .join("+");

/** Everything `info` tells of a model, as data (what `smak info --json` prints). */
export function describeModel(src, file) {
  const mdl = readMdl(src);
  const bones = bonesOf(src);
  const boneName = (number) => bones[number]?.name ?? number;
  const boxes = hitboxesOf(src);
  // studiohdr_t's eyeposition and its four boxes (min and max: the box it moves with; bbmin and bbmax: the
  // box it is clipped by), which follow its name and length: floats from byte 76 (studio.h)
  const floats = (at) => [0, 1, 2].map((axis) => round2(src.readFloatLE(at + axis * 4)));
  return {
    file,
    bytes: src.length,
    name: src.toString("latin1", NAME_AT, NAME_END).replace(/\0.*$/s, ""),
    bones: bones.map((bone, i) => ({ i, name: bone.name, parent: bone.parent, pos: bone.pos.map((v) => +v.toFixed(3)), rot: bone.rot.map((v) => +v.toFixed(4)) })),
    bodyparts: mdl.bodyparts.map((bodypart) => ({
      name: bodypart.name,
      base: bodypart.base,
      models: bodypart.models.map((model, k) => ({ body: k * bodypart.base, name: model.name, verts: model.numverts, meshes: model.meshes.map((mesh) => ({ tris: mesh.numtris, texture: mesh.texture?.name ?? null })) })),
    })),
    textures: mdl.textures.map((texture, i) => ({ i, name: texture.name, width: texture.width, height: texture.height, flags: texture.flags })),
    skinFamilies: skinFamilies(src).length,
    eyes: floats(HDR_EYES_AT),
    box: { min: floats(HDR_EYES_AT + 12), max: floats(HDR_EYES_AT + 24), bbmin: floats(HDR_EYES_AT + 36), bbmax: floats(HDR_EYES_AT + 48) },
    sequences: sequencesOf(src).map((seq, i) => ({
      i,
      name: seq.name,
      frames: seq.frames,
      fps: seq.fps,
      loops: seq.loops,
      blends: seq.blends,
      external: Boolean(seq.group),
      activity: seq.activity,
      activityName: ACTIVITY[seq.activity] ?? null,
      actweight: seq.actweight,
      movement: seq.movement.map(round2),
      speed: round2(seq.speed),
      motiontype: seq.motiontype,
      bbmin: seq.bbmin.map(round2),
      bbmax: seq.bbmax.map(round2),
      events: eventsOf(src, i),
    })),
    attachments: attachmentsOf(src).map((a) => ({ ...a, bone: boneName(a.bone) })),
    hitboxes: boxes.length,
    hitboxList: boxes.map((box, i) => ({ i, bone: boneName(box.bone), group: box.group, groupName: HITGROUP_NAMES[box.group] ?? null, min: box.min.map(round2), max: box.max.map(round2), size: box.max.map((v, axis) => round2(v - box.min[axis])) })),
    boneControllers: boneControllers(src).map((c) => ({ ...c, bone: boneName(c.bone) })),
  };
}

/**
 * The lines `info` says of a model. The command line's are padded into columns with every event (`hitboxes`
 * lists each hit box, `boxes` each animation's box); `compact` (a client's context) puts the bones on one line
 * and counts the events, unless `full` (each bone's place, each event). `name`: the file as it is shown.
 */
export function modelInfoLines(src, data, { compact = false, full = false, hitboxes = false, boxes = false, name = data.file } = {}) {
  const lines = [];
  const say = (line = "") => lines.push(line);
  const pad = (value, width) => (compact ? String(value) : String(value).padStart(width));
  const gap = compact ? "" : "\n";
  say(`${name}: "${data.name}", ${src.length} bytes`);

  // the places as the file has them, not as describeModel rounds them
  const bones = bonesOf(src);
  if (compact) {
    say(`BONES (${bones.length}): number name<parent`);
    if (full) for (const [i, bone] of bones.entries()) say(`  ${i} ${bone.name}<${bone.parent} at ${bone.pos.map((v) => v.toFixed(2)).join(" ")}`);
    else say(`  ${bones.map((bone, i) => `${i} ${bone.name}${bone.parent < 0 ? "" : `<${bone.parent}`}`).join(", ")}`);
  } else {
    say(`${gap}BONES (${bones.length})`);
    bones.forEach((bone, i) => say(`  ${pad(i, 3)} ${bone.name.padEnd(28)} parent ${pad(bone.parent, 3)}  at ${bone.pos.map((v) => v.toFixed(2)).join(" ")}`));
  }

  say(compact ? `BODYPARTS (${data.bodyparts.length}): a body number is the sum of one from each part` : `${gap}BODYPARTS (${data.bodyparts.length})   a body number is the sum of one "body" from each part`);
  for (const bodypart of data.bodyparts) {
    say(`  ${bodypart.name}`);
    for (const model of bodypart.models) {
      if (compact) say(`    body ${model.body} ${model.name}: ${model.verts} points, triangles ${model.meshes.map((mesh) => `${mesh.tris} on ${mesh.texture}`).join(", ") || "none (empty)"}`);
      else say(`    body ${pad(model.body, 4)}  ${model.name.padEnd(28)} ${pad(model.verts, 5)} points  ${model.meshes.map((mesh) => `${mesh.tris} on ${mesh.texture}`).join(", ") || "(empty)"}`);
    }
  }

  const families = data.skinFamilies > 1 ? `, ${data.skinFamilies} skin families` : "";
  say(`${gap}TEXTURES (${data.textures.length}${families})`);
  for (const texture of data.textures) {
    if (compact) say(`  ${texture.i} ${texture.name} ${texture.width}x${texture.height}${texture.flags ? ` ${flagNames(texture.flags)} (flags ${texture.flags})` : ""}`);
    else say(`  ${pad(texture.i, 3)} ${texture.name.padEnd(32)} ${texture.width}x${texture.height}${texture.flags ? `  ${flagNames(texture.flags) || ""} (flags ${texture.flags})` : ""}`);
  }

  say(compact ? `ANIMATIONS (${data.sequences.length}): the game asks for them by number` : `${gap}ANIMATIONS (${data.sequences.length})   the game asks for them by number: keep their order`);
  const listEvents = !compact || full;
  for (const seq of data.sequences) {
    const activity = seq.activity ? `, activity ${seq.activity}${seq.activityName ? ` ${seq.activityName}` : ""}${seq.actweight !== 1 ? ` (weight ${seq.actweight})` : ""}` : "";
    const travel = seq.movement.some((v) => v) ? `, moves ${seq.movement.join(" ")} (${motionNames(seq.motiontype) || "no motion type"}): ${seq.speed} units a second` : "";
    const events = !listEvents && seq.events.length ? `, ${seq.events.length} events` : "";
    const notes = `${seq.loops ? ", loops" : ""}${seq.blends > 1 ? `, ${seq.blends} blends` : ""}${activity}${travel}${seq.external ? ", KEPT IN ANOTHER FILE" : ""}${events}`;
    if (compact) say(`  ${seq.i} ${seq.name}: ${seq.frames} frames at ${seq.fps} fps${notes}`);
    else say(`  ${pad(seq.i, 3)} ${seq.name.padEnd(28)} ${pad(seq.frames, 4)} frames at ${seq.fps} fps${notes}`);
    if (boxes) say(`        box ${seq.bbmin.join(" ")} to ${seq.bbmax.join(" ")}`);
    if (listEvents) for (const event of seq.events) say(`${compact ? "      " : "        "}frame ${event.frame}: event ${event.event}${event.options ? ` "${event.options}"` : ""}`);
  }

  if (data.attachments.length && (!compact || full)) {
    say(`${gap}ATTACHMENTS (${data.attachments.length})`);
    data.attachments.forEach((a, i) => say(`  ${i}${a.name ? ` "${a.name}"` : ""} on ${a.bone} at ${a.pos.map((v) => v.toFixed(2)).join(" ")}`));
  }
  if (data.boneControllers.length) {
    say(`${gap}BONE CONTROLLERS (${data.boneControllers.length})`);
    data.boneControllers.forEach((c, i) => say(`  ${i} turns ${c.bone} on ${motionNames(c.type) || c.type} from ${c.start} to ${c.end}, the entity's controller ${c.index}`));
  }
  if (data.eyes.some((v) => v)) say(`${gap}EYES at ${data.eyes.join(" ")}`);

  // the hit boxes: how many, on how many bones and in which groups; each one when asked
  const groups = [...new Set(data.hitboxList.map((box) => box.group))].sort((a, b) => a - b);
  const inGroups = groups.map((group) => `${group}${HITGROUP_NAMES[group] ? ` ${HITGROUP_NAMES[group]}` : ""}`).join(", ");
  const summary = data.hitboxes ? ` on ${new Set(data.hitboxList.map((box) => box.bone)).size} bones, in the groups ${inGroups}${hitboxes || compact ? "" : "   (--hitboxes lists them)"}` : "";
  say(`${gap}${compact && !full ? `${data.attachments.length} attachments, ` : ""}${data.hitboxes} hit boxes${summary}`);
  if (hitboxes) for (const box of data.hitboxList) say(`  ${pad(box.i, 3)} ${String(box.bone).padEnd(28)} group ${box.group}${box.groupName ? ` ${box.groupName}` : ""}  ${box.size.join(" x ")}  from ${box.min.join(" ")} to ${box.max.join(" ")}`);
  return lines;
}
