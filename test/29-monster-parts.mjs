// What a monster has beyond a prop: hit boxes, attachments, bone controllers, where it sees from, and what
// its animations say besides their frames (an activity, how far they travel, the box they are drawn within).
// A small monster is written from nothing with all of them and read back; the same parts are set on the
// knife, whose meshes, textures and animations must not notice; the boxes studiomdl would make are worked
// out by hand; and each of check's sentences about these parts is met beside a model it leaves alone.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, checked, near, tmp, runSmak, knife } from "./helper.mjs";

// ── the monster: a body 30 high with a head on it ──

/** The twelve triangles of a box from `low` to `high` (in the model's space), every corner on `bone`. */
const block = (low, high, bone) => {
  const corner = (x, y, z) => ({
    p: [x ? high[0] : low[0], y ? high[1] : low[1], z ? high[2] : low[2]],
    uv: [x ? 0.9 : 0.1, (y ? 0.5 : 0.1) + (z ? 0.4 : 0)],
    bone,
  });
  // each side as four corners, going round it
  const sides = [
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ];
  return sides.flatMap(([a, b, c, d]) => [
    [corner(...a), corner(...b), corner(...c)],
    [corner(...a), corner(...c), corner(...d)],
  ]);
};

// the body's bone is 10 up from the floor, and the head's 22 above it (32 up)
const BONES = [
  { name: "body", parent: -1, pos: [0, 0, 10] },
  { name: "head", parent: 0, pos: [0, 0, 22] },
];
const BODY = 0;
const HEAD = 1;
// the body from the floor to 30 up, the head from 32 to 40: in the model's space
const SHAPE = [...block([-4, -3, 0], [4, 3, 30], "body"), ...block([-3, -3, 32], [3, 3, 40], "head")];
const GREY = smak.indexed({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(140) }, "grey.bmp");

/** One frame: the bones at rest, the body `up` higher and the head turned `nod` about y. */
const frameOf = (up = 0, nod = 0) => [
  [0, 0, 10 + up, 0, 0, 0],
  [0, 0, 22, 0, nod, 0],
];
const STILL = [frameOf()];
// five frames in which the body bobs 2 up and 2 down and is back where it began
const BOB = [0, 2, 0, -2, 0].map((up) => frameOf(up));

/** The monster, as buildMdl is asked for it; `more` says what a case wants otherwise. */
const monsterOf = (more = {}) =>
  smak.buildMdl({
    name: "monster.mdl",
    bones: BONES,
    bodyparts: [{ name: "body", models: [{ name: "monster", meshes: [{ tris: SHAPE, texture: GREY }] }] }],
    sequences: [
      { name: "idle", fps: 10, loops: true, frames: STILL, activity: 1 },
      {
        name: "walk",
        fps: 10,
        loops: true,
        frames: BOB,
        activity: 3,
        actweight: 2,
        movement: [30, 0, 0],
        events: [{ frame: 2, event: 1004, options: "common/npc_step1.wav" }],
      },
    ],
    hitboxes: [
      { bone: "body", group: smak.HITGROUP.chest, min: [-4, -3, -10], max: [4, 3, 20] },
      { bone: "head", group: smak.HITGROUP.head, min: [-3, -3, 0], max: [3, 3, 8] },
    ],
    attachments: [
      { name: "mouth", bone: "head", pos: [3, 0, 2] },
      { name: "", bone: BODY, pos: [4.5, 0, 0] },
    ],
    controllers: [{ bone: "head", type: smak.MOTION.ZR, start: -60, end: 60 }],
    eyes: [0, 0, 38],
    ...more,
  });
const monster = monsterOf();

/** The largest difference between two lists of numbers. */
const gap = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
/**
 * Everything the kit's readers tell of a model but its hit boxes, attachments and bone controllers, as text:
 * its bones, every mesh's triangles, every texture's pixels, the skins, and every animation with its frames
 * and events. Where a table lies in the file is left out: a change moves the tables and must change none.
 */
const restOf = (mdl) => {
  const info = smak.readMdl(mdl);
  return JSON.stringify({
    bones: smak.bones(mdl),
    meshes: info.bodyparts.map((bodypart) => [
      bodypart.name,
      bodypart.base,
      bodypart.models.map((model) => [
        model.name,
        model.meshes.map((mesh) => [mesh.skinref, smak.readMesh(mdl, model, mesh)]),
      ]),
    ]),
    textures: info.textures.map((_, i) => {
      const texture = smak.textureOf(mdl, i);
      return { ...texture, pixels: [...texture.pixels], palette: [...texture.palette] };
    }),
    skins: smak.skinFamilies(mdl),
    sequences: smak.sequences(mdl).map((_, q) => [smak.readSequence(mdl, q), smak.events(mdl, q)]),
  });
};

test("a monster written from nothing reads back: hit boxes, attachments, a controller, eyes", () => {
  const boxes = smak.hitboxes(monster);
  sure(
    JSON.stringify(boxes) ===
      JSON.stringify([
        { bone: BODY, group: 2, min: [-4, -3, -10], max: [4, 3, 20] },
        { bone: HEAD, group: 1, min: [-3, -3, 0], max: [3, 3, 8] },
      ]),
    `the hit boxes: ${JSON.stringify(boxes)}`,
  );
  const fastened = smak.attachments(monster);
  sure(
    JSON.stringify(fastened) ===
      JSON.stringify([
        { name: "mouth", bone: HEAD, pos: [3, 0, 2] },
        { name: "", bone: BODY, pos: [4.5, 0, 0] },
      ]),
    `the attachments: ${JSON.stringify(fastened)}`,
  );
  const controllers = smak.boneControllers(monster);
  sure(
    JSON.stringify(controllers) ===
      JSON.stringify([{ bone: HEAD, type: smak.MOTION.ZR, start: -60, end: 60, rest: 0, index: 0 }]),
    `the bone controller: ${JSON.stringify(controllers)}`,
  );
  // studiohdr_t.eyeposition: three floats from byte 76 of the file (studio.h)
  const EYEPOSITION = 76;
  sure(
    [0, 4, 8].map((at) => monster.readFloatLE(EYEPOSITION + at)).join() === "0,0,38",
    "where it sees from",
  );
  for (const engine of ["goldsrc", "xash"]) {
    const result = checked(monster, engine);
    sure(!result.errors.length && !result.warnings.length, [...result.errors, ...result.warnings].join("; "));
  }
});

test("its animations say their activity, how far they travel and the box they are drawn within", () => {
  const [idle, walk] = smak.sequences(monster);
  sure(idle.activity === 1 && idle.actweight === 1, "an activity with no weight told weighs 1");
  sure(idle.motiontype === 0 && idle.movement.join() === "0,0,0" && idle.speed === 0, "idle stays");
  sure(walk.activity === 3 && walk.actweight === 2 && walk.loops && walk.flags === 1, "the walk's activity");
  sure(walk.movement.join() === "30,0,0", `the walk travels ${walk.movement}`);
  // a travel along x alone is STUDIO_LX, 64
  sure(walk.motiontype === smak.MOTION.LX && walk.motiontype === 64, `its motion type: ${walk.motiontype}`);
  // 30 units in the 4 steps of its 5 frames, at 10 frames a second: 0.4 seconds
  near(walk.speed, 75, 1e-9, "its speed");
  // the box about the model through the frames: at rest it stands from the floor to 40 up, 8 by 6 across;
  // in the walk the body, and the head on it, go 2 higher and 2 lower
  near(gap([...idle.bbmin, ...idle.bbmax], [-4, -3, 0, 4, 3, 40]), 0, 1e-4, "idle's box");
  near(gap([...walk.bbmin, ...walk.bbmax], [-4, -3, -2, 4, 3, 42]), 0, 1e-3, "the walk's box");
  // what readSequence adds to that is the frames
  const read = smak.readSequence(monster, "walk");
  sure(read.activity === 3 && read.movement[0] === 30 && read.frames.length === 5, "readSequence");
  near(read.frames[1][BODY][2], 12, 1e-3, "the body 2 up in frame 1");
  sure(
    JSON.stringify(smak.events(monster, "walk")) ===
      JSON.stringify([{ frame: 2, event: 1004, type: 0, options: "common/npc_step1.wav" }]),
    "the walk's event",
  );
  // the header's boxes: every animation's together unless told, and as told
  const HDR_MIN = 88; // studiohdr_t: min, max, bbmin, bbmax, four vec3 from byte 88
  const boxesOf = (mdl) => Array.from({ length: 12 }, (_, k) => mdl.readFloatLE(HDR_MIN + k * 4));
  near(gap(boxesOf(monster).slice(6), [-4, -3, -2, 4, 3, 42]), 0, 1e-3, "the header's bbmin and bbmax");
  const told = monsterOf({ min: [-16, -16, 0], max: [16, 16, 72], bbmin: [0, 0, 0], bbmax: [0, 0, 0] });
  sure(boxesOf(told).join() === "-16,-16,0,16,16,72,0,0,0,0,0,0", "the header's boxes as told");
});

test("the same parts set on a model that is there leave everything else as it was", () => {
  const before = restOf(knife.mdl);
  const boxes = [{ bone: "hand", group: smak.HITGROUP.rightArm, min: [0, -1, -1], max: [16, 1, 1] }];
  const fastened = [{ name: "tip", bone: "hand", pos: [16, 0, 0] }];
  const controllers = [
    { bone: "arm", type: smak.MOTION.XR | smak.MOTION.RLOOP, start: 0, end: 360, index: 1 },
  ];
  let changed = smak.setHitboxes(knife.mdl, boxes);
  changed = smak.setAttachments(changed, fastened);
  changed = smak.setBoneControllers(changed, controllers);
  sure(restOf(changed) === before, "its bones, meshes, textures, skins or animations changed");
  sure(
    JSON.stringify(smak.hitboxes(changed)) === JSON.stringify([{ ...boxes[0], bone: 1 }]),
    "the hit box set",
  );
  sure(
    JSON.stringify(smak.attachments(changed)) === JSON.stringify([{ ...fastened[0], bone: 1 }]),
    "the attachment set",
  );
  sure(
    JSON.stringify(smak.boneControllers(changed)) ===
      JSON.stringify([{ bone: 0, type: 0x8008, start: 0, end: 360, rest: 0, index: 1 }]),
    "the bone controller set",
  );
  sure(!checked(changed).errors.length, checked(changed).errors.join("; "));
  // set again, each replaces what was there; an empty list takes them all away
  const emptied = smak.setBoneControllers(smak.setAttachments(smak.setHitboxes(changed, []), []), []);
  sure(
    !smak.hitboxes(emptied).length &&
      !smak.attachments(emptied).length &&
      !smak.boneControllers(emptied).length &&
      restOf(emptied) === before,
    "emptied",
  );
  // the knife itself was not written into
  sure(!smak.hitboxes(knife.mdl).length, "the model given was changed");
});

test("replaceSequence and addSequence take the travel, the activity and the box", () => {
  const framesBefore = JSON.stringify(smak.readSequence(monster, "walk").frames);
  // sideways now: the frames, the events and the box stay
  const sideways = smak.replaceSequence(monster, "walk", { movement: [0, 20, 0], activity: 11 });
  const walk = smak.readSequence(sideways, "walk");
  sure(walk.movement.join() === "0,20,0" && walk.motiontype === smak.MOTION.LY, "travels along y: LY");
  sure(walk.activity === 11 && walk.actweight === 2, "the activity changed, its weight kept");
  sure(JSON.stringify(walk.frames) === framesBefore && smak.events(sideways, "walk").length === 1, "frames");
  near(gap([...walk.bbmin, ...walk.bbmax], [-4, -3, -2, 4, 3, 42]), 0, 1e-3, "the box kept");
  // a motion type told outright is written as it is: hgrunt's strafes say LX + LY of a travel along y
  const both = smak.replaceSequence(sideways, "walk", { motiontype: smak.MOTION.LX | smak.MOTION.LY });
  sure(smak.sequences(both)[1].motiontype === 192 && smak.sequences(both)[1].movement[1] === 20, "192");
  // no travel: the bits go
  sure(smak.sequences(smak.replaceSequence(both, "walk", { movement: [0, 0, 0] }))[1].motiontype === 0, "0");
  // new frames: the box is measured again (the body 5 up at the most, none down)
  const higher = smak.replaceSequence(monster, "walk", { frames: [0, 5, 0].map((up) => frameOf(up)) });
  near(gap(smak.sequences(higher)[1].bbmax, [4, 3, 45]), 0, 1e-3, "the box of the new frames");
  near(smak.sequences(higher)[1].bbmin[2], 0, 1e-3, "and its floor");
  sure(smak.sequences(higher)[1].movement[0] === 30, "the travel stays with new frames");
  // unless it is told
  const toldBox = smak.replaceSequence(monster, "walk", {
    frames: BOB,
    bbmin: [-9, -9, -9],
    bbmax: [9, 9, 9],
  });
  sure(smak.sequences(toldBox)[1].bbmax.join() === "9,9,9", "the box as told");

  // a new animation: its box measured, or with `like` that animation's
  const leap = { name: "leap", fps: 20, frames: [0, 8, 0].map((up) => frameOf(up)), activity: 8 };
  const added = smak.sequences(smak.addSequence(monster, { ...leap, movement: [40, 0, 6], actweight: 3 }))[2];
  near(gap([...added.bbmin, ...added.bbmax], [-4, -3, 0, 4, 3, 48]), 0, 1e-3, "the new animation's box");
  sure(added.activity === 8 && added.actweight === 3, "its activity and weight");
  sure(added.motiontype === (smak.MOTION.LX | smak.MOTION.LZ), "travels along x and z: LX + LZ");
  // 40 forwards and 6 up in the 2 steps of its 3 frames at 20 a second
  near(added.speed, Math.hypot(40, 6) * 10, 1e-3, "its speed");
  const liked = smak.sequences(smak.addSequence(monster, { ...leap, like: 0 }))[2];
  near(
    gap([...liked.bbmin, ...liked.bbmax], [-4, -3, 0, 4, 3, 40]),
    0,
    1e-4,
    "the box of the one it is like",
  );
});

test("autoHitboxes makes the boxes studiomdl would, worked out by hand", () => {
  // In each bone's own space. The body's bone is 10 up, so its block (floor to 30) is from -10 to 20 there,
  // and its box reaches on to the head's bone, 22 up from it; the head's block is from 0 to 8 above its
  // bone. Every box holds its bone's own origin.
  const byHand = [
    { bone: BODY, group: 0, min: [-4, -3, -10], max: [4, 3, 22] },
    { bone: HEAD, group: 0, min: [-3, -3, 0], max: [3, 3, 8] },
  ];
  const bare = monsterOf({ hitboxes: [] });
  const sameAs = (made, wanted) =>
    made.length === wanted.length &&
    made.every(
      (box, i) =>
        box.bone === wanted[i].bone &&
        box.group === wanted[i].group &&
        gap([...box.min, ...box.max], [...wanted[i].min, ...wanted[i].max]) < 1e-4,
    );
  sure(sameAs(smak.autoHitboxes(bare), byHand), `of a file: ${JSON.stringify(smak.autoHitboxes(bare))}`);
  // a group is the bone's own, or the one of the bone it hangs from
  const headed = smak.autoHitboxes(bare, { groups: { head: smak.HITGROUP.head } });
  sure(headed[0].group === 0 && headed[1].group === 1, "the head's group");
  const chested = smak.autoHitboxes(bare, { groups: { body: smak.HITGROUP.chest } });
  sure(chested[0].group === 2 && chested[1].group === 2, "the head takes the body's group");
  // a box has to be thicker than `thin` on every axis, and both are 6 across y (the head is 6 by 6 by 8, the
  // body's box 8 by 6 by 32)
  const thick = smak.autoHitboxes(bare, { thin: 6.5 });
  sure(!thick.length, "both are 6 across y: too thin for 6.5");
  sure(smak.autoHitboxes(bare, { thin: 5.9 }).length === 2, "not thin");
  // and its bone has to carry `least` points: neither block has a thousand
  sure(!smak.autoHitboxes(bare, { least: 1000 }).length, "least");
  // asked of buildMdl, they are in the file
  sure(sameAs(smak.hitboxes(monsterOf({ hitboxes: "auto" })), byHand), "hitboxes: auto");
  const grouped = smak.hitboxes(monsterOf({ hitboxes: { groups: { head: 1 } } }));
  sure(sameAs(grouped, [byHand[0], { ...byHand[1], group: 1 }]), "hitboxes: { groups }");
  // set on a file that is there
  sure(sameAs(smak.hitboxes(smak.setHitboxes(bare, smak.autoHitboxes(bare))), byHand), "set");
});

test("what is asked wrongly is refused with a sentence", () => {
  const refused = (run) => {
    try {
      run();
    } catch (e) {
      return e.message;
    }
    return "";
  };
  const box = { min: [0, 0, 0], max: [1, 1, 1] };
  sure(
    /hit box 0 is on the bone "neck", and the model has no such bone: it has 2 \(body, head\)/.test(
      refused(() => smak.setHitboxes(monster, [{ ...box, bone: "neck" }])),
    ),
    "a hit box on a bone it has not",
  );
  sure(
    /hit box 1 is on the bone 2,/.test(
      refused(() =>
        monsterOf({
          hitboxes: [
            { ...box, bone: 0 },
            { ...box, bone: 2 },
          ],
        }),
      ),
    ),
    "by number",
  );
  sure(
    /hit box 0: max needs three numbers/.test(
      refused(() => smak.setHitboxes(monster, [{ bone: 0, min: [0, 0, 0] }])),
    ),
    "no max",
  );
  sure(
    /attachment 0 is on the bone "tail"/.test(
      refused(() => smak.setAttachments(monster, [{ bone: "tail" }])),
    ),
    "an attachment",
  );
  sure(
    /bone controller 0 has type 64: it turns one of a bone's six values/.test(
      refused(() => smak.setBoneControllers(monster, [{ bone: 0, type: smak.MOTION.LX, start: 0, end: 1 }])),
    ),
    "a controller of no axis",
  );
  sure(
    /bone controller 0 needs a start and an end/.test(
      refused(() => smak.setBoneControllers(monster, [{ bone: 0, type: 8 }])),
    ),
    "no range",
  );
  sure(
    /walk: movement needs three numbers \[x, y, z\], not 30/.test(
      refused(() => smak.replaceSequence(monster, "walk", { movement: 30 })),
    ),
    "a travel of one number",
  );
  sure(
    /groups names the bone "skull"/.test(refused(() => smak.autoHitboxes(monster, { groups: { skull: 1 } }))),
    "a group for no bone",
  );
});

test("check: a hit box, an attachment or a controller on a bone the model has not", () => {
  // The tables' places are in the header (studio.h): hitboxindex at 160, attachmentindex at 216; a hit box
  // begins with its bone, and an attachment has its bone after its name and type (byte 36).
  const HITBOXINDEX = 160;
  const ATTACHMENTINDEX = 216;
  const ATTACHMENT_BONE = 36;
  const broken = Buffer.from(monster);
  broken.writeInt32LE(7, broken.readInt32LE(HITBOXINDEX));
  broken.writeInt32LE(-1, broken.readInt32LE(ATTACHMENTINDEX) + ATTACHMENT_BONE);
  const { errors } = checked(broken);
  sure(
    errors.includes(
      "hit box 0 is on bone 7, and the model has 2: the engine would read a bone that is not there",
    ),
    `the hit box: ${errors.join("; ")}`,
  );
  sure(
    errors.some((e) => e.startsWith("attachment 0 is on bone -1, and the model has 2")),
    "the attachment",
  );
  sure(errors.length === 2, "and nothing else");
  // beside it, the monster as it was written
  sure(!checked(monster).errors.length, "the sound one");
});

test("check: a model that travels and has no hit boxes is noted, not refused", () => {
  const noted = (mdl) => checked(mdl).facts.filter((fact) => fact.startsWith("it has no hit boxes"));
  const bare = checked(monsterOf({ hitboxes: [] }));
  const note = bare.facts.find((fact) => fact.startsWith("it has no hit boxes"));
  sure(
    note?.startsWith(
      "it has no hit boxes: traces against it use the entity's box (and 1 of its animations travel, walk:",
    ),
    `the note: ${bare.facts.join("; ")}`,
  );
  sure(!bare.errors.length && !bare.warnings.length, "it is a note: no error, no warning");
  // with hit boxes, or with none and nothing that travels (the knife, a thing that is held), nothing is said
  sure(!noted(monster).length, "a monster with hit boxes");
  sure(!noted(knife.mdl).length && !smak.hitboxes(knife.mdl).length, "the knife");
});

test("check: an animation whose box has no size", () => {
  const flat = smak.replaceSequence(monster, "walk", { bbmin: [0, 0, 0], bbmax: [0, 0, 0] });
  const { warnings, errors } = checked(flat);
  sure(
    warnings.length === 1 &&
      warnings[0].startsWith(
        "1 animations have a box of no size (walk): their bbmin and bbmax are the same point, and the engine decides by that box whether the model is in view",
      ),
    `the warning: ${warnings.join("; ")}`,
  );
  sure(!errors.length, "a warning, not an error");
  // measured again from its own frames, it is sound
  const mended = smak.replaceSequence(flat, "walk", { frames: smak.readSequence(flat, "walk").frames });
  sure(!checked(mended).warnings.length, checked(mended).warnings.join("; "));
  near(smak.sequences(mended)[1].bbmax[2], 42, 1e-3, "its box again");
});

test("check: a looping animation that does not come back to where it starts", () => {
  // the walk again, but in its last frame the body is 3 higher and the head turned 0.2 radians (11.5 degrees)
  const open = [...BOB.slice(0, 4), frameOf(3, 0.2)];
  const jerky = smak.replaceSequence(monster, "walk", { frames: open });
  const { warnings } = checked(jerky);
  sure(warnings.length === 1, `one warning: ${warnings.join("; ")}`);
  // the bone the furthest out is named, with how far: 3 units is three times what is let pass, 11.5 degrees
  // nearly six times
  sure(
    warnings[0].startsWith(
      "the looping animation walk does not come back to where it starts: in its last frame head is 0.00 units and 11.5 degrees from where it is in the first.",
    ),
    warnings[0],
  );
  // the body alone
  const lifted = smak.replaceSequence(monster, "walk", { frames: [...BOB.slice(0, 4), frameOf(3)] });
  sure(/in its last frame body is 3\.00 units and 0\.0 degrees/.test(checked(lifted).warnings[0]), "body");
  // beside them: the walk as written, whose last frame is its first; the same open frames in an animation
  // that plays once; and a last frame a hair out, which is let pass
  sure(!checked(monster).warnings.length, "the walk that closes");
  const once = smak.replaceSequence(monster, "walk", { frames: open, loops: false });
  sure(!checked(once).warnings.length, "an animation that does not loop");
  const hair = smak.replaceSequence(monster, "walk", { frames: [...BOB.slice(0, 4), frameOf(0.5, 0.02)] });
  sure(!checked(hair).warnings.length, "half a unit and one degree");
});

test("smak info tells the travel, the activity, the hit boxes and the attachments", () => {
  const file = join(tmp, "monster.mdl");
  writeFileSync(file, monster);
  const said = runSmak("info", file);
  sure(/idle +1 frames at 10 fps, loops, activity 1 ACT_IDLE\n/.test(said), "idle's line");
  sure(
    /walk +5 frames at 10 fps, loops, activity 3 ACT_WALK \(weight 2\), moves 30 0 0 \(LX\): 75 units a second/.test(
      said,
    ),
    `the walk's line:\n${said}`,
  );
  sure(
    /ATTACHMENTS \(2\)\n {2}0 "mouth" on head at 3\.00 0\.00 2\.00\n {2}1 on body at 4\.50/.test(said),
    "attachments",
  );
  sure(/BONE CONTROLLERS \(1\)\n {2}0 turns head on ZR from -60 to 60/.test(said), "the controller");
  sure(/EYES at 0 0 38/.test(said), "the eyes");
  sure(
    /2 hit boxes on 2 bones, in the groups 1 head, 2 chest {3}\(--hitboxes lists them\)/.test(said),
    "summary",
  );
  sure(!/group 1 head {2}6 x 6 x 8/.test(said), "the boxes are listed only when asked");
  const listed = runSmak("info", file, "--hitboxes", "--boxes");
  sure(/0 body +group 2 chest {2}8 x 6 x 30 {2}from -4 -3 -10 to 4 3 20/.test(listed), "the body's box");
  sure(/1 head +group 1 head {2}6 x 6 x 8 {2}from -3 -3 0 to 3 3 8/.test(listed), "the head's box");
  sure(/box -4 -3 -2 to 4 3 42/.test(listed), "the walk's box with --boxes");
  const json = JSON.parse(runSmak("info", file, "--json"));
  const walk = json.sequences[1];
  sure(
    walk.movement.join() === "30,0,0" && walk.speed === 75 && walk.activity === 3 && walk.motiontype === 64,
    "--json: the walk",
  );
  sure(walk.activityName === "ACT_WALK" && walk.bbmax.join() === "4,3,42", "--json: its name and box");
  sure(json.hitboxes === 2 && json.hitboxList[1].bone === "head", "--json: the hit boxes");
  sure(json.hitboxList[1].groupName === "head" && json.hitboxList[1].size.join() === "6,6,8", "their size");
  sure(json.boneControllers[0].bone === "head" && json.eyes.join() === "0,0,38", "--json: the rest");
});

test("a strip from the side has the floor as a line, the same in every frame", () => {
  // the line's own colour, in render.mjs
  const GROUND = [240, 200, 70];
  const TILE = 160;
  const picture = smak.strip(monster, { seq: "walk", view: "side", ground: true, width: TILE, height: TILE });
  sure(picture.width === 4 * TILE && picture.height === 2 * TILE, "five frames, four to a row");
  /** The rows of the tile whose left edge is at `left` and top at `top` that are the line, at its edge. */
  const lineRows = (left, top) => {
    const rows = [];
    for (let y = 0; y < TILE; y++) {
      const at = ((top + y) * picture.width + left + 1) * 4;
      if (GROUND.every((v, k) => picture.rgba[at + k] === v)) rows.push(y);
    }
    return rows;
  };
  const first = lineRows(0, 0);
  sure(first.length === 1, `one row of the first frame is the floor: ${first}`);
  for (const [left, top] of [
    [TILE, 0],
    [2 * TILE, 0],
    [3 * TILE, 0],
    [0, TILE],
  ])
    sure(lineRows(left, top).join() === first.join(), "the floor is at one height in every frame");
  // It is where z = 0 is: the model stands from 2 under the floor to 42 over it through the walk, and the
  // strip looks at the middle of that (20 up), the line that far under the picture's middle.
  sure(first[0] > TILE / 2 && first[0] < TILE, `under the middle: ${first[0]}`);
  // without it asked, no line; and only a level view has one
  const plain = smak.render(monster, { seq: "walk", view: "side", width: TILE, height: TILE });
  let lined = 0;
  for (let i = 0; i < TILE * TILE; i++) if (GROUND.every((v, k) => plain.rgba[i * 4 + k] === v)) lined++;
  sure(!lined, "no line unless asked");
  let refusal = "";
  try {
    smak.render(monster, { pitch: 15, ground: true });
  } catch (e) {
    refusal = e.message;
  }
  sure(/ground: the line of z = 0 is drawn in a level view/.test(refusal), "a view from above is refused");
  // the command line draws it, and says so of a view that has none
  const out = join(tmp, "walk-side.png");
  sure(
    runSmak(
      "strip",
      join(tmp, "monster.mdl"),
      "--seq",
      "walk",
      "--view",
      "side",
      "--ground",
      "-o",
      out,
    ).includes("walk-side.png"),
    "smak strip",
  );
});
