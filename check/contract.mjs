// A model's contract with the code that uses it: what a mod's code asks of a model by name or by number. Its
// bones (a mod turns "Bip01 Spine" to aim), its animations in their order (the game plays them by number, or
// looks them up by name: The Specialists' "dive_f_" and a weapon's suffix), each animation's activity (a
// monster asks for "a walk" by it), its attachments (where a muzzle flash or a shell comes from), its
// bodyparts and how many bodies each has (a backpack shown or not), its hit box groups and its bone
// controllers. A model made for a mod keeps its reference's contract, or the code breaks without a word.
//
//   contractOf(mdl) -> { bones, sequences: [{ name, activity }], attachments: [{ bone }], bodyparts: [{ name, bodies }],
//                       hitgroups, controllers: [{ bone }] }
//   compareContract(reference, made) -> { faults, notes }: what of the reference the model lacks or moved
//   sharedContract(contracts) -> the contract every one of a mod's stock models keeps: what its code can rely on
import { readMdl, bones as bonesOf, sequences, attachments, hitboxes, boneControllers } from "../core/mdl.mjs";

export function contractOf(mdl) {
  const boneNames = bonesOf(mdl).map((b) => b.name);
  const info = readMdl(mdl);
  let hitgroups = [];
  try {
    hitgroups = [...new Set(hitboxes(mdl).map((h) => `${boneNames[h.bone] ?? h.bone}:${h.group}`))];
  } catch {}
  // from the file's own table: `readMdl` gives no controllers, and read from it they were never found
  let controllers = [];
  try {
    controllers = boneControllers(mdl).map((c) => ({ bone: boneNames[c.bone] ?? c.bone }));
  } catch {}
  return {
    bones: boneNames,
    sequences: sequences(mdl).map((s) => ({ name: s.name, activity: s.activity ?? 0 })),
    attachments: attachments(mdl).map((a) => ({ bone: boneNames[a.bone] ?? a.bone })),
    bodyparts: info.bodyparts.map((b) => ({ name: b.name, bodies: b.models.length })),
    hitgroups,
    controllers,
  };
}

/**
 * What the made model breaks of the reference's contract. FAULTS: a bone of the reference missing; an
 * animation missing, or at another number than the reference's (code plays them by number); an activity
 * changed; an attachment missing or on another bone; a bodypart missing or with fewer bodies. NOTES: what the
 * model has beyond it, and hit groups that differ.
 */
export function compareContract(reference, made) {
  const faults = [];
  const notes = [];
  const missingBones = reference.bones.filter((b) => !made.bones.includes(b));
  if (missingBones.length) faults.push(`${missingBones.length} bones of the reference are missing: ${missingBones.slice(0, 8).join(", ")}${missingBones.length > 8 ? " ..." : ""}`);
  const moved = [];
  const missing = [];
  const activity = [];
  reference.sequences.forEach((s, i) => {
    const at = made.sequences.findIndex((m) => m.name.toLowerCase() === s.name.toLowerCase());
    if (at < 0) missing.push(s.name);
    else {
      if (at !== i) moved.push(`${s.name} (${i} -> ${at})`);
      if (made.sequences[at].activity !== s.activity) activity.push(`${s.name} (${s.activity} -> ${made.sequences[at].activity})`);
    }
  });
  if (missing.length) faults.push(`${missing.length} of the reference's ${reference.sequences.length} animations are missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " ..." : ""}`);
  if (moved.length) faults.push(`${moved.length} animations are at another number than the reference's (code plays them by number): ${moved.slice(0, 8).join(", ")}`);
  if (activity.length) faults.push(`${activity.length} animations ask for another activity: ${activity.slice(0, 8).join(", ")}`);
  reference.attachments.forEach((a, i) => {
    const m = made.attachments[i];
    if (!m) faults.push(`attachment ${i} (on ${a.bone}) is missing`);
    else if (m.bone !== a.bone) faults.push(`attachment ${i} is on ${m.bone}, the reference's on ${a.bone}`);
  });
  reference.bodyparts.forEach((b, i) => {
    const m = made.bodyparts.find((x) => x.name === b.name) ?? made.bodyparts[i];
    if (!m) faults.push(`bodypart ${b.name} is missing`);
    else if (m.bodies < b.bodies) faults.push(`bodypart ${b.name} has ${m.bodies} bodies, the reference ${b.bodies}: a body the code asks for by number is not there`);
  });
  const extraSeq = made.sequences.length - reference.sequences.length;
  if (extraSeq > 0) notes.push(`${extraSeq} animations beyond the reference's, after its last (as they must be)`);
  const groups = (c) => new Set(c.hitgroups);
  const diff = [...groups(reference)].filter((g) => !groups(made).has(g));
  if (diff.length) notes.push(`${diff.length} of the reference's hit groups differ: ${diff.slice(0, 6).join(", ")}`);
  return { faults, notes };
}

/**
 * What every one of several models keeps of a contract: the mod's code works with each of its stock models, so this
 * is what it relies on (The Specialists' own players lack 12 and 33 of the bones its gordon.mdl has). The bones all
 * have; each animation at the number all have it, with the activity all give it; attachments and controllers up to
 * the first number where they differ (code asks for them by number); the bodyparts all have, at the fewest bodies;
 * the hit groups all have.
 */
export function sharedContract(contracts) {
  const [first, ...rest] = contracts;
  if (!first) throw new Error("sharedContract: no contracts");
  const inAll = (test) => rest.every(test);
  const prefix = (list, key) => {
    const out = [];
    for (const [i, item] of list.entries()) {
      if (!inAll((c) => c[key][i] && c[key][i].bone === item.bone)) break;
      out.push(item);
    }
    return out;
  };
  return {
    bones: first.bones.filter((b) => inAll((c) => c.bones.includes(b))),
    sequences: first.sequences.filter((s, i) => inAll((c) => c.sequences[i]?.name.toLowerCase() === s.name.toLowerCase() && c.sequences[i].activity === s.activity)),
    attachments: prefix(first.attachments, "attachments"),
    bodyparts: first.bodyparts.filter((b) => inAll((c) => c.bodyparts.some((x) => x.name === b.name))).map((b) => ({ ...b, bodies: Math.min(b.bodies, ...rest.map((c) => c.bodyparts.find((x) => x.name === b.name).bodies)) })),
    hitgroups: first.hitgroups.filter((h) => inAll((c) => c.hitgroups.includes(h))),
    controllers: prefix(first.controllers, "controllers"),
  };
}
