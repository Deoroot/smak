// Changing a model that exists: its mesh swapped for another piece, bodies, meshes and bones added,
// animations replaced and added, and textures kept in another file put inside.
import * as smak from "../src/index.mjs";
import { blunt } from "../kits/bluntkit.mjs";
import { test, sure, near, poseGap, knife } from "./helper.mjs";

const WAVE = 1; // the wave animation's number in the knife
const IDLE = 0;

/** the errors check finds in a model, as one line: empty when it is fit */
const errorsOf = (mdl) => smak.check(mdl).errors;

// ── meshes ──

test("swapMesh lays a new piece over the old one", () => {
  // a club 19 long, from the blunt kit: a haft and a steel head
  const club = blunt({
    seed: 5,
    haft: {
      profile: [
        [0, 0.6],
        [14, 0.7],
      ],
    },
    parts: [
      {
        profile: [
          [13, 0.7],
          [14, 1.6],
          [18, 1.6],
          [19, 0.6],
        ],
        metal: "steel",
      },
    ],
  });

  // in the knife's place it is stretched to the knife's length (16) and hangs on the knife's bone
  const { mdl: swapped, report } = smak.swapMesh(knife.mdl, {
    body: 0,
    piece: club,
    texture: smak.indexed(smak.shrink(club.image, 4), "club.bmp"),
  });
  sure(report.now === club.tris.length && report.bone === "hand", JSON.stringify(report));
  near(report.scale, 16 / 19, 0.02, "stretched to the old length");
  sure(!errorsOf(swapped).length, errorsOf(swapped).join("; "));
  sure(smak.readMdl(swapped).textures.length === 2, "its texture was added");

  // told to keep its own size, it is not stretched
  const ownSize = smak.swapMesh(knife.mdl, {
    body: 0,
    piece: club,
    texture: smak.indexed(smak.shrink(club.image, 4), "club.bmp"),
    size: "own",
  }).report;
  near(ownSize.scale, 1, 1e-9, "kept its own size");
});

test("addModel, addMesh, emptyMesh, filterMesh, retexture, addBones", () => {
  const firstMesh = { bodypart: 0, model: 0, mesh: 0 };

  // each step adds to the result of the one before
  let mdl = smak.addModel(knife.mdl, 0, "second");
  sure(smak.readMdl(mdl).bodyparts[0].models.length === 2, "addModel");

  mdl = smak.addMesh(mdl, { bodypart: 0, model: 0 });
  sure(smak.readMdl(mdl).bodyparts[0].models[0].meshes.length === 2, "addMesh");

  mdl = smak.retexture(mdl, firstMesh, { ...knife.texture, name: "other.bmp" });
  sure(smak.readMdl(mdl).textures.length === 2, "retexture");

  // keep the triangles whose first corner is on bone 1, the hand: all of them
  mdl = smak.filterMesh(mdl, firstMesh, (triangleBones) => triangleBones[0] === 1);

  // a third bone at the knife's tip: the two old bones keep their numbers and their motion
  mdl = smak.addBones(mdl, [{ name: "tip", parent: 1, pos: [16, 0, 0] }]);
  sure(smak.bones(mdl).length === 3 && smak.bones(mdl)[2].name === "tip", "addBones");
  near(
    poseGap(smak.poseAt(mdl, WAVE, 5).slice(0, 2), smak.poseAt(knife.mdl, WAVE, 5)),
    0,
    1e-6,
    "the old bones moved",
  );
  sure(!errorsOf(mdl).length, errorsOf(mdl).join("; "));

  const emptied = smak.emptyMesh(mdl, firstMesh);
  sure(smak.readMdl(emptied).bodyparts[0].models[0].meshes[0].numtris === 0, "emptyMesh");
});

// ── bones put among the others ──

// a hip with two legs and a tail, and a head on the root: the legs move and turn in every frame, so a bone
// put between them and the hip has to keep them where they were through their own motion
const strider = (() => {
  const bones = [
    { name: "root", parent: -1, pos: [0, 0, 0] },
    { name: "hip", parent: 0, pos: [0, 0, 10], rot: [0.1, 0, 0.2] },
    { name: "legL", parent: 1, pos: [2, 0, -3] },
    { name: "legR", parent: 1, pos: [-2, 0, -3], rot: [0, 0.3, 0] },
    { name: "tail", parent: 1, pos: [0, -3, 0] },
    { name: "head", parent: 0, pos: [0, 0, 20] },
  ];
  const still = bones.map((bone) => [...bone.pos, ...(bone.rot ?? [0, 0, 0])]);
  const swing = (frame, side) => Math.sin((frame / 7) * 2 * Math.PI) * side;
  const walk = (lean) =>
    Array.from({ length: 8 }, (_, frame) => [
      [0, swing(frame, 0.5), 0, 0, 0, swing(frame, 0.1)],
      [0, 0, 10 + swing(frame, 0.4), 0.1 + lean, 0, 0.2],
      [2 + swing(frame, 0.8), swing(frame, 1.5), -3, swing(frame, 0.5), 0, 0],
      [-2, -swing(frame, 1.5), -3 + swing(frame, 0.6), 0, 0.3 - swing(frame, 0.4), 0],
      [0, -3, swing(frame, 0.7), 0, 0, swing(frame, 0.3)],
      [0, swing(frame, 0.2), 20, 0, swing(frame, 0.2), 0],
    ]);
  // a little block on each bone, to see every corner stay where it was
  const block = (bone, [x, y, z]) => [
    [
      { p: [x, y, z], uv: [0, 0], bone },
      { p: [x + 1, y, z], uv: [1, 0], bone },
      { p: [x, y + 1, z + 0.5], uv: [0, 1], bone },
    ],
  ];
  const tris = [
    block("root", [0, 0, 0]),
    block("hip", [0, 0, 10]),
    block("legL", [2, 0, 6]),
    block("legR", [-2, 0, 6]),
    block("tail", [0, -3, 10]),
    block("head", [0, 0, 20]),
  ].flat();
  return smak.buildMdl({
    name: "strider.mdl",
    bones,
    bodyparts: [{ name: "body", models: [{ name: "body", meshes: [{ tris, texture: knife.texture }] }] }],
    sequences: [
      { name: "idle", fps: 10, loops: true, frames: [still] },
      { name: "walk", fps: 10, frames: walk(0), blendFrames: [walk(0.4)] },
    ],
    hitboxes: bones.map((bone) => ({ bone: bone.name, min: [-1, -1, -1], max: [1, 1, 1] })),
    attachments: [
      { name: "footL", bone: "legL", pos: [0, 0, -4] },
      { name: "eye", bone: "head", pos: [1, 0, 0] },
    ],
    controllers: [
      { bone: "head", type: smak.MOTION.ZR, start: -45, end: 45, index: 0 },
      { bone: "legR", type: smak.MOTION.X, start: -2, end: 2, index: 1 },
    ],
  });
})();

/**
 * That `after` is `before` with bones put in: every old bone (`kept[i]` its number in `after`) is where it
 * was in every frame of every blend of every animation, every corner too, and the attachments, hit boxes and
 * bone controllers are on the bones they were.
 */
function sameBones(before, after, kept) {
  const names = smak.readMdl(before).bones;
  const newNames = smak.readMdl(after).bones;
  sure(
    kept.every((at, i) => newNames[at] === names[i]),
    `the old bones in the new list: ${newNames.join()}`,
  );
  const cornersOf = (mdl, pose) => {
    const model = smak.readMdl(mdl).bodyparts[0].models[0];
    return smak
      .readMesh(mdl, model, model.meshes[0])
      .flatMap((tri) => tri.map((c) => smak.apply34(pose[c.bone], c.p)));
  };
  smak.sequences(before).forEach((sequence, q) => {
    for (let blend = 0; blend < sequence.blends; blend++)
      for (let frame = 0; frame < sequence.frames; frame++) {
        const was = smak.poseAt(before, q, frame, blend);
        const is = smak.poseAt(after, q, frame, blend);
        const what = `${sequence.name}, blend ${blend}, frame ${frame}`;
        near(
          poseGap(
            kept.map((at) => is[at]),
            was,
          ),
          0,
          1e-4,
          `${what}: an old bone moved`,
        );
        const cornersWere = cornersOf(before, was);
        const cornersAre = cornersOf(after, is);
        near(
          Math.max(...cornersAre.flatMap((p, i) => p.map((v, axis) => Math.abs(v - cornersWere[i][axis])))),
          0,
          1e-4,
          `${what}: a corner moved`,
        );
      }
  });
  const onBones = (mdl, list) => list.map((item) => smak.readMdl(mdl).bones[item.bone]).join();
  sure(onBones(after, smak.attachments(after)) === onBones(before, smak.attachments(before)), "attachments");
  sure(onBones(after, smak.hitboxes(after)) === onBones(before, smak.hitboxes(before)), "hit boxes");
  sure(
    onBones(after, smak.boneControllers(after)) === onBones(before, smak.boneControllers(before)),
    "bone controllers",
  );
  sure(!errorsOf(after).length, errorsOf(after).join("; "));
}

test("insertBones puts a bone in the middle, and everything on a bone follows it to its new number", () => {
  const before = Buffer.from(strider);
  const mdl = smak.insertBones(strider, [
    { name: "spine", parent: 1, pos: [0, 0, 1], rot: [0.1, 0, 0], at: 2 },
  ]);
  sure(strider.equals(before), "the file given was changed");
  sure(smak.readMdl(mdl).bones.join() === "root,hip,spine,legL,legR,tail,head", "the new order");
  sure(smak.boneParents(mdl).join() === "-1,0,1,1,1,1,0", "the parents renumbered");
  sameBones(strider, mdl, [0, 1, 3, 4, 5, 6]);
  // the new bone rests in every frame
  const walk = smak.sequences(mdl).findIndex((s) => s.name === "walk");
  for (let frame = 0; frame < 8; frame++)
    near(
      Math.max(
        ...smak.frameValues(mdl, walk, frame, 1)[2].map((v, j) => Math.abs(v - [0, 0, 1, 0.1, 0, 0][j])),
      ),
      0,
      1e-6,
      "the new bone moved",
    );
});

test("insertBones: a bone put between a hip and its legs adopts them, and they stay where they were", () => {
  const mdl = smak.insertBones(strider, [
    { name: "pelvis", parent: 1, pos: [0, 0.5, -1], at: 2, adopt: [2, 3] },
  ]);
  sure(smak.readMdl(mdl).bones.join() === "root,hip,pelvis,legL,legR,tail,head", "the new order");
  sure(smak.boneParents(mdl).join() === "-1,0,1,2,2,1,0", "the legs hang from the new bone");
  // an adopted bone rests where it did less the new bone's place
  const rest = smak.bones(mdl)[3].pos;
  near(
    Math.max(...rest.map((v, axis) => Math.abs(v - [2, -0.5, -2][axis]))),
    0,
    1e-6,
    "an adopted bone's rest",
  );
  sameBones(strider, mdl, [0, 1, 3, 4, 5, 6]);

  // a neck taking the head, with a jaw on it (by its name) and no place asked for: it goes at the end
  const necked = smak.insertBones(strider, [
    { name: "neck", parent: 0, pos: [0, 0, 18], at: 5, adopt: [5] },
    { name: "jaw", parent: "neck", pos: [1, 0, 0] },
  ]);
  sure(
    smak.readMdl(necked).bones.join() === "root,hip,legL,legR,tail,neck,head,jaw",
    "the order with a neck",
  );
  sure(smak.boneParents(necked).join() === "-1,0,1,1,1,0,5,5", "the parents with a neck");
  sameBones(strider, necked, [0, 1, 2, 3, 4, 6]);
});

test("insertBones refuses what would break the skeleton", () => {
  const refuses = (bones, words, what) => {
    let message = "";
    try {
      smak.insertBones(strider, bones);
    } catch (error) {
      message = error.message;
    }
    sure(message.includes(words), `${what}: ${message || "no error"}`);
  };
  refuses([{ name: "x", parent: 4, at: 2 }], "a parent comes before", "a parent after the new bone");
  refuses(
    [{ name: "x", parent: 1, at: 2, rot: [0, 0, 0.1], adopt: [2] }],
    "is turned",
    "adopting with a bone that is turned",
  );
  refuses(
    [{ name: "x", parent: 1, at: 5, adopt: [2] }],
    "a parent comes before",
    "an adopted bone before it",
  );
  refuses(
    [{ name: "x", parent: 0, at: 2, adopt: [2] }],
    "does not hang from",
    "adopting another bone's child",
  );
  refuses([{ name: "hip", parent: 0 }], "already has a bone", "a name the model has");
  refuses([{ name: "x", parent: "nobody" }], "none of the new bones", "a parent that is not there");
  // an animation said to be kept in another file
  const elsewhere = Buffer.from(strider);
  elsewhere.writeInt32LE(1, elsewhere.readInt32LE(168) + 156); // the first sequence's seqgroup
  let message = "";
  try {
    smak.insertBones(elsewhere, [{ name: "x", parent: 0, at: 1 }]);
  } catch (error) {
    message = error.message;
  }
  sure(message.includes("kept in another file"), `a sequence in another file: ${message || "no error"}`);
});

// ── animations ──

test("replaceSequence keeps the others, and widens a bone's scale when it must", () => {
  // the wave replaced by its own frames: every pose is exactly what it was
  const sameFrames = smak.replaceSequence(knife.mdl, "wave", {
    frames: smak.readSequence(knife.mdl, "wave").frames,
  });
  near(poseGap(smak.poseAt(sameFrames, WAVE, 9), smak.poseAt(knife.mdl, WAVE, 9)), 0, 0, "the same frames");

  // frames that take the hand thousands of units away: farther than the bone's scale could pack, so the scale
  // is widened, which repacks the other animations of that bone too
  const farFrames = knife.wave.map((frame, t) => [frame[0], [8 + 400 * t, 0, 0, 0, frame[1][4] + 2, 0.3]]);
  const replaced = smak.replaceSequence(knife.mdl, WAVE, { frames: farFrames, fps: 15, loops: true });
  const wave = smak.sequences(replaced)[WAVE];
  sure(wave.fps === 15 && wave.loops && wave.frames === 12, "fps, loops, frames");
  near(
    poseGap(smak.poseAt(replaced, WAVE, 11), smak.boneMatrices(knife.bones, farFrames[11])),
    0,
    0.2,
    "a long way off",
  );
  near(
    poseGap(smak.poseAt(replaced, IDLE, 0), smak.poseAt(knife.mdl, IDLE, 0)),
    0,
    0.2,
    "idle after the scale widened",
  );
  sure(!errorsOf(replaced).length, errorsOf(replaced).join("; "));
});

test("addSequence goes after the others, with its events", () => {
  const STAB = 2; // the number the new animation gets

  // the wave played backwards, with a sound on frame 3
  const added = smak.addSequence(knife.mdl, {
    name: "stab",
    fps: 30,
    frames: knife.wave.slice().reverse(),
    events: [{ frame: 3, event: 5004, options: "weapons/knife.wav" }],
  });
  const animations = smak.sequences(added);
  sure(animations.map((animation) => animation.name).join() === "idle,wave,stab", "order");
  near(poseGap(smak.poseAt(added, STAB, 0), smak.poseAt(knife.mdl, WAVE, 11)), 0, 1e-6, "its frames");
  near(poseGap(smak.poseAt(added, WAVE, 4), smak.poseAt(knife.mdl, WAVE, 4)), 0, 0, "the others");

  // its event is there, and can be taken off again
  const events = smak.events(added, "stab");
  sure(events.length === 1 && events[0].frame === 3 && events[0].options === "weapons/knife.wav", "events");
  sure(!errorsOf(added).length, errorsOf(added).join("; "));
  sure(smak.events(smak.setEvents(added, "stab", []), "stab").length === 0, "setEvents to none");
});

test("a long animation of many frames packs and reads back", () => {
  // 700 frames: the hand jumps one unit at frame 300 and turns slowly all the way. The format packs a bone's
  // values in runs of at most 255, so frames either side of 255 and of the jump are the ones to read back
  const longFrames = Array.from({ length: 700 }, (_, frame) => [
    knife.still[0],
    [8, 0, frame < 300 ? 0 : 1, 0, Math.sin(frame / 20), 0.3],
  ]);
  const added = smak.addSequence(knife.mdl, { name: "long", frames: longFrames });
  const LONG = 2;
  for (const frame of [0, 254, 255, 299, 300, 511, 699])
    near(
      poseGap(smak.poseAt(added, LONG, frame), smak.boneMatrices(knife.bones, longFrames[frame])),
      0,
      2e-3,
      `frame ${frame}`,
    );
});

// ── textures ──

test("textures kept in another file are put inside", () => {
  // the knife as a game keeps some models: the header says it has no textures (the count is at byte 180),
  // and they are in a second file, here the whole knife
  const NUMTEXTURES_AT = 180;
  const withoutTextures = Buffer.from(knife.mdl);
  withoutTextures.writeInt32LE(0, NUMTEXTURES_AT);

  const inlined = smak.withTextures(withoutTextures, knife.mdl);
  const pictureNow = smak.textureOf(inlined, 0);
  const pictureBefore = smak.textureOf(knife.mdl, 0);
  sure(
    Buffer.from(pictureNow.pixels).equals(Buffer.from(pictureBefore.pixels)) &&
      pictureNow.name === pictureBefore.name,
    "the picture",
  );
  sure(!errorsOf(inlined).length, errorsOf(inlined).join("; "));
});

test("an angle at exactly half a turn survives a rewrite of the animations (a bicycle's crank)", () => {
  // the crank rests at 0 with a rotation scale of a half turn over 32768 steps, kept in float32 a hair over it:
  // read back after another bone widens its scale, half a turn came out a step past the range and was refused
  const bones = [{ name: "root", parent: -1, pos: [0, 0, 0] }, { name: "crank", parent: 0, pos: [0, 0, 10] }, { name: "arm", parent: 0, pos: [5, 0, 0] }];
  const tri = [{ p: [0, 0, 0], uv: [0, 0], bone: 1 }, { p: [4, 0, 0], uv: [1, 0], bone: 1 }, { p: [0, 0, 4], uv: [0, 1], bone: 1 }];
  const still = bones.map((b) => [...b.pos, 0, 0, 0]);
  const texture = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(192).fill(128) }, "t.bmp");
  let mdl = smak.buildMdl({ name: "t.mdl", bones, bodyparts: [{ name: "b", models: [{ name: "m", meshes: [{ texture, tris: [tri] }] }] }], sequences: ["idle", "spin", "swing"].map((name) => ({ name, fps: 10, frames: [still, still] })) });
  mdl = smak.replaceSequence(mdl, "spin", { frames: [0, Math.PI, 2 * Math.PI - 1e-9].map((a) => still.map((v, i) => (i === 1 ? [...v.slice(0, 3), a, 0, 0] : v))) });
  mdl = smak.replaceSequence(mdl, "swing", { frames: [0, 3000].map((d) => still.map((v, i) => (i === 2 ? [v[0] + d, v[1], v[2], 0, 0, 3] : v))) });
  const back = smak.readSequence(mdl, "spin").frames[1][1][3];
  near(Math.abs(back), Math.PI, 1e-3, "the crank at half a turn, either way round");
});
