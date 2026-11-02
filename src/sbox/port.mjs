// A GoldSrc model (.mdl, version 10) made the files s&box's compiler builds a model from: a DMX for each submodel
// and each animation, a .vmdl that says how they go together, and a PNG and a .vmat for each texture.
//
//   portToSbox(src, { name, folder, groups, kind, collision, surfaceprop, mass, sounds, lighting })   -> { name, vmdl, files, warnings, facts }
//   writeSboxPort(port, out)                         the files written under `out` (a project's Assets folder)
//   portToSboxFile(file, { out, name, folder, kind, collision, surfaceprop, mass, sounds, lighting, compile, sbox })   the whole port
//
// WHAT GOES WHERE (under `out`, laid out as an s&box project's Assets):
//   models/<folder>/<name>.vmdl                          the model's document; compiled beside it (.vmdl_c)
//   models/<folder>/<name>.vanmgrph                      its animation graph, when an animation blends
//   models/<folder>/<name>/<submodel>.dmx, anims/*.dmx   its meshes and animations
//   models/<folder>/<name>/physics/*.dmx                 what it collides as: a hull, or a ragdoll's pieces
//   materials/models/<folder>/<name>/<texture>.png .vmat (and <texture>_mask.png, a masked one's holes)
//   sounds/<folder>/<its path>.wav .sound (and .wav.meta, a loop's)   the sounds its events play (sound.mjs)
//
// IT IS SOURCE'S PORT, WRITTEN FOR s&box: portToSource (source/port.mjs) works the model out once (its bones and
// their names made unique, each submodel in the model's space, each animation's frames with a loop's travel put
// back, the skins, attachments, hit boxes, events, chrome worked out) and hands its parts as data; this writes them
// as s&box reads them. What differs from the GMod port:
// - DMX for SMD, which s&box reads not at all; and no turn (GMod's QC turns with $origin, s&box's compiler turns
//   nothing: see dmx.mjs);
// - a loop's travel taken out by the compiler (ExtractMotion on its root bone, along the axes GoldSrc's was:
//   LX, LY, LZ), as root motion the game moves the model by;
// - an event that plays a sound (1004 a step, 1008 a voice, 5004 a view model's clip) as s&box's that play one
//   (AE_CL_PLAYSOUND, 5004's at the model's first attachment, as GoldSrc's client played it): its .wav copied
//   from the game's sound folders (`sounds`) under sounds/<folder>/, beside it a .sound heard as far as GoldSrc
//   heard it (1004 and 1008 at ATTN_IDLE, 500 units; 5004 at ATTN_NORM, 1250). SkinnedModelRenderer plays it, with
//   no code of the game's. Any other event, and one whose sound is not found, is kept as s&box's generic one
//   (AE_GENERIC_EVENT): its number as Int, its options (a sound's file, a script's words) as StringData, for the
//   game's code (SkinnedModelRenderer.OnGenericEvent);
// - what it collides as made by Source's port (a prop's convex hull, a figure's ragdoll) and written as ModelDoc's
//   physics nodes (physics.mjs);
// - an animation's blends in an animation graph (graph.mjs), the way s&box blends: each blend an animation of its
//   own, the graph choosing an animation by its name and blending it by the GMod port's pose parameters (blend_xr).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { readStudio, sequenceFilesOf } from "../studio-file.mjs";
import { sequenceGroups } from "../mdl.mjs";
import { png } from "../image.mjs";
import { bleedHoles, powerOfTwo } from "../source/vtf.mjs";
import { portToSource, sourceName, PORT_FOLDER, SOUND_EVENTS } from "../source/port.mjs";
import { soundFoldersOf } from "../source/gmod.mjs";
import { sboxSound, distanceOf, ATTENUATION, SOUND_FOLDER } from "./sound.mjs";
import { dmxOf, boneNameOf } from "./dmx.mjs";
import { vmdlOf, vmatOf, WHITE_PNG } from "./vmdl.mjs";
import { studioShader, studioVmatOf, STUDIO_SHADER } from "./studio.mjs";
import { compileVmdl, compileSounds } from "./compile.mjs";
import { physicsOf } from "./physics.mjs";
import { graphOf, GRAPH_SEQUENCE } from "./graph.mjs";

/** GoldSrc's masked texture flag (STUDIO_NF_MASKED): its palette's last colour a hole. */
const MASKED = 64;
/** And its fullbright one (STUDIO_NF_FULLBRIGHT): drawn lit by itself. */
const FULLBRIGHT = 4;
/** And its additive one (STUDIO_NF_ADDITIVE). */
const ADDITIVE = 32;
/** A node's name as ModelDoc takes it: a hyphen in a mesh's name fails its compile, unsaid why. */
const nodeName = (name) => String(name).replace(/[^A-Za-z0-9_]/g, "_");

/** A masked texture's holes as a picture: white where it is drawn, black where it is not. */
function maskOf({ width, height, rgba }) {
  const mask = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3];
    mask.set([a, a, a, 255], i * 4);
  }
  return mask;
}

/** A view model's sound event (CL_EVENT_SOUND): GoldSrc's client played it at the model's first attachment, at
 * ATTN_NORM (pfnPlaySoundByNameAtLocation); a monster's (1004, 1008) its game code played at ATTN_IDLE. */
const CLIENT_SOUND = 5004;

/**
 * The port of a model read from its file's bytes (`src`, its textures in it). `sounds`: the game's sound folders,
 * where the sounds its events name are looked for (sound/ of its mod, then valve's: soundFoldersOf).
 */
export function portToSbox(
  src,
  { name, folder = PORT_FOLDER, groups, kind, collision = "auto", surfaceprop, mass, sounds = [], lighting = "sbox" } = {},
) {
  if (!["sbox", "goldsrc"].includes(lighting)) throw new Error(`portToSbox: lighting is "sbox" or "goldsrc", not ${lighting}`);
  if (!name) throw new Error("portToSbox: the model's name in s&box (name)");
  // a v_ model is a view model, as for GMod; a p_ one is not made a held one unless told: GMod's port gives it
  // Valve's biped's bone names (ValveBiped.Bip01_R_Hand) so GMod finds its hand, which s&box does not look for, and
  // whose hit boxes it then could not find ("Unknown bone", Half-Life's p_ models)
  const madeAs = kind ?? (/^v_/i.test(sourceName(name)) ? "view" : "thing");
  // a p_ model is a weapon in a hand: nothing to collide as unless told, as GMod's port's held one
  const collides = collision === "auto" && /^p_/i.test(sourceName(name)) ? "none" : collision;
  const port = portToSource(src, {
    name,
    folder,
    groups,
    kind: madeAs,
    collision: collides,
    surfaceprop,
    mass,
  });
  const { parts } = port;
  // a folder may be nested ("ts/props"): each of its parts named as the rest are
  const where = String(folder).split(/[\/]+/).filter(Boolean).map(sourceName).join("/");
  const base = `models/${where}/${port.name}`;
  const files = [];
  // the Source port's warnings but GMod's own: a weapon script's activities and the Lua that plays a view model's
  // sounds (s&box plays them from the model), and its muzzle said as s&box's
  const warnings = port.warnings
    .filter((w) => !/SendWeaponAnim|played by Lua/.test(w))
    .map((w) => w.replace("where GMod puts its muzzle flash", "where a game looks for its muzzle"));
  const view = port.facts.view;
  // the bones named as s&box keeps them, two that would come out one (Bip01 L and Bip01_L) kept apart as _2
  const boneNames = [];
  for (const bone of parts.bones) {
    const kept = boneNameOf(bone.name);
    let named = kept;
    for (let n = 2; boneNames.some((taken) => taken.toLowerCase() === named.toLowerCase()); n++)
      named = `${kept}_${n}`;
    boneNames.push(named);
  }
  const boneOf = new Map(parts.bones.map((bone, i) => [bone.name, boneNames[i]]));
  const sboxBones = parts.bones.map((bone, i) => ({ ...bone, name: boneNames[i] }));
  const dmxData = (path) => ({ ...parts.smd.get(path), bones: sboxBones });

  // ── the textures: a PNG and a .vmat each ──
  const materials = parts.textures.map((texture) => {
    let t = texture;
    let mask;
    if (t.flags & MASKED) {
      // a power of two each way: s&box's texture compiler makes no mipmaps of a mask whose sides are not, and the
      // material fails (Counter-Strike's trees, pi_tree1's branches 256 by 206); a model's coordinates are fractions
      // of its picture. Its holes in the mask, and the picture opaque, a hole its neighbours' colour
      t = { ...t, ...powerOfTwo(t, { alpha: true }) };
      mask = `materials/${base}/${t.name}_mask.png`;
      files.push({ path: mask, data: png(t.width, t.height, maskOf(t)) });
      const rgba = Uint8Array.from(t.rgba);
      bleedHoles(rgba, t.width, t.height);
      for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;
      t = { ...t, rgba };
    } else if (t.flags & ADDITIVE) {
      // a translucent material's mipmaps are weighted by alpha, which the compiler does only on a power of two
      // each way too (MSR's serpentsword, 492 by 490)
      t = { ...t, ...powerOfTwo(t) };
    }
    const color = `materials/${base}/${t.name}.png`;
    files.push({ path: color, data: png(t.width, t.height, t.rgba) });
    let illum;
    if (t.flags & FULLBRIGHT) {
      illum = `materials/${base}/white.png`;
      if (!files.some((f) => f.path === illum)) files.push({ path: illum, data: WHITE_PNG });
    }
    const path = `materials/${base}/${t.name}.vmat`;
    // lit as GoldSrc lights a model (studio.mjs), but for an additive texture, which needs a pass of its own
    const goldsrc = lighting === "goldsrc" && !(t.flags & ADDITIVE);
    if (goldsrc && !files.some((f) => f.path === STUDIO_SHADER)) files.push({ path: STUDIO_SHADER, data: studioShader() });
    files.push({ path, data: goldsrc ? studioVmatOf({ color, mask, flags: t.flags }) : vmatOf({ color, mask, illum, flags: t.flags }) }); // prettier-ignore
    return { name: t.name, path };
  });
  const pathOf = (material) => `materials/${base}/${material}.vmat`;
  // each skin after the first, as the materials of the first it changes
  const skins = parts.skins
    .slice(1)
    .map((row) =>
      row
        .map((to, j) => ({ from: pathOf(parts.skins[0][j]), to: pathOf(to) }))
        .filter((r) => r.from !== r.to),
    );

  // ── the meshes, and the bodygroups they make ──
  const meshes = [];
  const meshOf = new Map();
  for (const group of parts.bodygroups)
    for (const file of group.models) {
      if (!file || meshOf.has(file)) continue;
      const stem = file.replace(/\.smd$/, "");
      const mesh = { name: nodeName(stem), file: `${base}/${stem}.dmx` };
      files.push({ path: mesh.file, data: dmxOf(dmxData(file), { name: stem }) });
      meshes.push(mesh);
      meshOf.set(file, mesh.name);
    }
  // a model of one bodypart of one submodel has none to choose: its mesh is always drawn
  const choosing = parts.bodygroups.length > 1 || parts.bodygroups.some((g) => g.models.length > 1);
  // s&box finds a bodygroup by its name, and GoldSrc let two have one (v_9mmhandgun.mdl's two "studio"): the second is
  // <name>_2. ModelDoc renumbers a bodygroup whose name ends in a number after a letter (loader.mdl's leg1 to leg4 came
  // out leg1, leg3, leg5, leg7); after an underscore the number is kept, so leg2 is leg_2
  const groupNames = [];
  for (const g of parts.bodygroups) {
    const wanted = g.name.replace(/([A-Za-z])(\d+)$/, "$1_$2");
    let named = wanted;
    for (let n = 2; groupNames.some((taken) => taken.toLowerCase() === named.toLowerCase()); n++)
      named = `${wanted}_${n}`;
    groupNames.push(named);
  }
  const bodygroups = choosing
    ? parts.bodygroups.map((g, k) => ({
        name: groupNames[k],
        choices: g.models.map((file, i) => ({
          name: file ? meshOf.get(file) : `blank${i}`,
          meshes: file ? [meshOf.get(file)] : [],
        })),
      }))
    : [];

  // ── the sounds its events play: each found in the game's sound folders, as a .sound heard as far as GoldSrc heard
  // it (the farthest, when two kinds of event play one) ──
  const soundOf = new Map(port.sounds.map(({ from, to }) => [to, { from, distance: 0 }]));
  for (const s of parts.sequences)
    for (const e of s.events)
      if (SOUND_EVENTS.includes(e.event)) {
        const named = soundOf.get(e.options.trim().replace(/^[*]+/, ""));
        if (named) named.distance = Math.max(named.distance, distanceOf(e.event === CLIENT_SOUND ? ATTENUATION.norm : ATTENUATION.idle)); // prettier-ignore
      }
  const unfound = [];
  const unread = [];
  const played = [];
  for (const [to, named] of soundOf) {
    const found = sounds.map((f) => join(f, named.from)).find((path) => existsSync(path));
    if (!found) {
      unfound.push(named.from);
      continue;
    }
    const made = sboxSound(readFileSync(found), { path: `${SOUND_FOLDER}/${to}`, distance: named.distance });
    if (made.unread) {
      unread.push(`${named.from} (${made.unread})`);
      continue;
    }
    const { files: written, ...sound } = made;
    files.push(...written);
    named.made = made;
    played.push({ from: named.from, ...sound });
  }
  // an event as s&box's: one whose sound was made plays it, any other is kept as a generic one
  const firstAttachment = parts.attachments[0]?.name;
  const eventOf = (e) => {
    const made = SOUND_EVENTS.includes(e.event) && soundOf.get(e.options.trim().replace(/^[*]+/, ""))?.made;
    if (!made) return e;
    return { frame: e.frame, event: e.event, sound: made.sound, attachment: e.event === CLIENT_SOUND ? firstAttachment : undefined }; // prettier-ignore
  };

  // ── the animations ──
  const root = boneNames[parts.bones.findIndex((b) => b.parent < 0)] ?? "";
  const sequences = parts.sequences.length
    ? parts.sequences
    : parts.smd.has("anims/idle.smd")
      ? [
          {
            name: "idle",
            files: ["anims/idle.smd"],
            fps: 30,
            loops: false,
            activity: null,
            weight: 1,
            travel: [],
            blends: [],
            events: [],
          },
        ]
      : [];
  const renamed = [];
  // each animation, and after them all each blend after an animation's first (its own animation, <name>_blend1, so
  // that the others keep GoldSrc's numbers), which the graph blends
  const blendsAfter = [];
  const animationOf = (s, path, named, first) => {
    const stem = path.replace(/\.smd$/, "");
    const file = `${base}/${stem}.dmx`;
    files.push({
      path: file,
      data: dmxOf(dmxData(path), { fps: s.fps, name: stem.replace(/^anims\//, "") }),
    });
    return {
      name: named,
      file,
      fps: s.fps,
      loops: s.loops,
      // a blend is played by the graph, never asked for by its activity; its events are the first's
      activity: first ? s.activity : null,
      weight: s.weight,
      fade: view ? 0 : 0.2,
      travel: s.travel,
      root,
      events: first ? s.events.map(eventOf) : [],
    };
  };
  const graphed = sequences.map((s) => {
    const named = nodeName(s.name);
    if (named !== s.name) renamed.push(`${s.name} as ${named}`);
    const names = s.files.map((path, b) => (b ? `${named}_blend${b}` : named));
    s.files.slice(1).forEach((path, k) => blendsAfter.push(animationOf(s, path, names[k + 1], false)));
    return { name: named, loops: s.loops, blends: s.files.length > 1 ? s.blends : [], files: names };
  });
  const animations = [...sequences.map((s, i) => animationOf(s, s.files[0], graphed[i].name, true)), ...blendsAfter];
  // the graph that blends them, when one does: each blend axis's parameter over the values of every animation on it
  const ranges = new Map();
  for (const { pose, start, end } of graphed.flatMap((g) => g.blends)) {
    const [low, high] = ranges.get(pose) ?? [Infinity, -Infinity];
    ranges.set(pose, [Math.min(low, start, end), Math.max(high, start, end)]);
  }
  const poses = [...ranges].map(([name, [min, max]]) => ({ name, min, max }));
  let graph = "";
  if (poses.length) {
    graph = `models/${where}/${port.name}.vanmgrph`;
    files.push({ path: graph, data: graphOf({ sequences: graphed, poses, fade: view ? 0 : 0.2, preview: `models/${where}/${port.name}.vmdl` }) }); // prettier-ignore
    const blending = graphed.filter((g) => g.blends.length).map((g) => g.name);
    warnings.push(`${blending.length} animations blend (${blending.join(", ")}): in its animation graph (${graph}), chosen by its "${GRAPH_SEQUENCE}" and blended by ${poses.map((p) => `${p.name} (${p.min} to ${p.max})`).join(", ")}; each blend after the first is an animation of its own too (<name>_blend1)`); // prettier-ignore
  }
  if (renamed.length) warnings.push(`animations named as s&box's compiler takes them: ${renamed.join(", ")}`);
  const allEvents = animations.flatMap((a) => a.events);
  const sounding = allEvents.filter((e) => e.sound).length;
  const generic = allEvents.length - sounding;
  if (generic) warnings.push(`${generic} events kept as s&box's generic ones (AE_GENERIC_EVENT: its number as Int, its options as StringData), for the game's code`); // prettier-ignore
  if (unfound.length) warnings.push(`${unfound.length === 1 ? "a sound" : `${unfound.length} sounds`} its events play not found in ${sounds.length ? sounds.join(", ") : "no sound folder"}, so ${unfound.length === 1 ? "its events are" : "their events are"} kept as generic ones, playing nothing: ${unfound.slice(0, 4).join(", ")}${unfound.length > 4 ? ` and ${unfound.length - 4} more` : ""}`); // prettier-ignore
  if (unread.length) warnings.push(`${unread.length === 1 ? "a sound" : `${unread.length} sounds`} not read as a WAVE file, left out (their events kept as generic ones): ${unread.slice(0, 4).join(", ")}`); // prettier-ignore

  // ── what a monster has ──
  const attachments = parts.attachments.map((a) => ({ name: a.name, bone: boneOf.get(a.bone), pos: a.pos }));
  const hitboxes = parts.hitboxes.map((h, i) => ({
    name: `hitbox${i}`,
    bone: boneOf.get(h.bone),
    group: h.group,
    min: h.min,
    max: h.max,
  }));

  // ── what it collides as: Source's port's hull or ragdoll (an animated model with no hit boxes, a view model:
  // nothing) ──
  let physics = null;
  if (parts.collision) {
    const data = parts.smd.get(parts.collision.file);
    physics = physicsOf(parts.collision, data, sboxBones, data.frames[0], { base, nameOf: (bone) => boneOf.get(bone) }); // prettier-ignore
    files.push(...physics.files);
    warnings.push(...physics.warnings);
  } else if (!view) warnings.push("nothing to collide as (collision: hull, box or ragdoll to make it)");

  const vmdl = `models/${where}/${port.name}.vmdl`;
  files.push({
    path: vmdl,
    data: vmdlOf({
      meshes,
      materials,
      skins,
      bodygroups,
      sequences: animations,
      attachments,
      hitboxes,
      physics,
      graph,
    }),
  });
  return {
    name: port.name,
    vmdl,
    files,
    warnings,
    // Source's port's parts it was written from (sbox/check.mjs holds the compiled model to them)
    parts,
    // what it collides as, as written (sbox/check.mjs holds the compiled model's physics to it), or null
    physics,
    // its animation graph (.vanmgrph, under Assets) when an animation blends, else ""; and what is in it
    graph,
    graphed: { sequences: graphed, poses },
    // the sounds its events play, as written: [{ from (the path the event named), wav, sound, vsnd, duration, loop,
    // distance }]; and its sound events, by animation ([{ sequence, loops, sounds: [.sound] }])
    sounds: played,
    soundEvents: animations
      .filter((a) => a.events.some((e) => e.sound))
      .map((a) => ({ sequence: a.name, loops: Boolean(a.loops), sounds: a.events.filter((e) => e.sound).map((e) => e.sound) })), // prettier-ignore
    facts: {
      bones: boneNames,
      meshes: meshes.map((m) => m.name),
      sequences: animations.map((a) => a.name),
      poses: poses.map((p) => p.name),
      materials: materials.map((m) => m.name),
      skins: 1 + skins.length,
      bodygroups: bodygroups.map((g) => ({ name: g.name, choices: g.choices.length })),
      attachments: attachments.map((a) => a.name),
      hitboxes: hitboxes.length,
      collision: parts.collision?.kind ?? "none",
      sounds: played.length,
      soundEvents: sounding,
    },
  };
}

/** The port's files written under `out`. Returns the .vmdl's full path. */
export function writeSboxPort(port, out) {
  for (const { path, data } of port.files) {
    const to = join(out, path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, data);
  }
  return join(out, port.vmdl);
}

/**
 * The whole port of one model file: read (its textures from <name>T.mdl, its animations from <name>01.mdl...
 * when they are beside it; its sounds from `sounds`, else the sound folders of the mod it is in and valve's),
 * written under `out`, and compiled by s&box's resourcecompiler (unless compile is false), its animation graph and
 * its sounds' files too (a .sound the editor compiles). Returns { ...the port, written (the .vmdl's path), compiled:
 * { compiled, notes, took, graph (its graph's compile, when it has one), sounds (its sounds', when it has any) } or
 * null }.
 */
export function portToSboxFile(
  file,
  { out, name, folder, kind, collision, surfaceprop, mass, sounds, lighting, compile = true, sbox } = {},
) {
  if (!out) throw new Error("portToSboxFile: the folder the port goes to (out: a project's Assets)");
  const { src } = readStudio(file);
  const groups = sequenceGroups(src).length > 1 ? sequenceFilesOf(file, src) : undefined;
  const own = String(file).replace(/\\/g, "/").split("/").pop();
  const port = portToSbox(src, {
    name: name ?? sourceName(own),
    folder,
    groups,
    kind,
    collision,
    surfaceprop,
    mass,
    sounds: sounds ?? soundFoldersOf(file),
    lighting,
  });
  const written = writeSboxPort(port, resolve(out));
  const materials = port.files.map((f) => f.path).filter((path) => path.endsWith(".vmat"));
  const compiled = compile ? compileVmdl(resolve(out), port.vmdl, { sbox, materials }) : null;
  // and its graph, which the model's compile names but does not make
  if (compile && port.graph) compiled.graph = compileVmdl(resolve(out), port.graph, { sbox });
  // and the sounds' files, in one run; their .sound assets the editor compiles
  if (compile && port.sounds.length) compiled.sounds = compileSounds(resolve(out), port.sounds.map((s) => s.wav), { sbox }); // prettier-ignore
  return { ...port, written, compiled };
}
