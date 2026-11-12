// The bones of 3ds Max's Biped under the names its other languages give them. A model made in an Italian 3ds
// Max names its bones "Bip01 Testa" and "Bip01 DX Mano" where an English one says "Bip01 Head" and
// "Bip01 R Hand": The Specialists' own players (gordon, the mod's canonical skeleton) are of the Italian kind,
// and many of its players of the English. The bones are the same; only the names differ.
//
//   boneIn(name, names) -> the name of `names` that is that bone, in whichever language; null when none is
//   otherSideOf(name)   -> the bone on the other side (L and R, SX and DX)

/** English Biped words, and the Italian for each. */
const ITALIAN = [
  ["Pelvis", "Bacino"],
  ["Spine", "Dorso"],
  ["Neck", "Collo"],
  ["Head", "Testa"],
  ["Clavicle", "Clavicola"],
  ["UpperArm", "Braccio superiore"],
  ["Forearm", "Avambraccio"],
  ["Hand", "Mano"],
  ["Thigh", "Coscia"],
  ["Calf", "Polpaccio"],
  ["Foot", "Piede"],
];
const SIDES = { L: "SX", R: "DX" };
/** The older Biped's names for the limbs (Half-Life's own models: "Bip01 L Arm1" is the upper arm), and the newer. */
const OLDER = { Arm: "Clavicle", Arm1: "UpperArm", Arm2: "Forearm", Leg: "Thigh", Leg1: "Calf" };

/** The names a bone may go by: itself, and the same bone in the other language. */
function namesOf(name) {
  const out = [name];
  const older = name.match(/^(\S+) ([LR]) (Arm|Arm1|Arm2|Leg|Leg1)$/i);
  if (older) {
    const word = Object.keys(OLDER).find((k) => k.toLowerCase() === older[3].toLowerCase());
    return [name, ...namesOf(`${older[1]} ${older[2]} ${OLDER[word]}`)];
  }
  // English: "Bip01 L Thigh", "Bip01 Spine2", "Bip01 L Finger01", "Bip01 R Toe0"
  let m = name.match(/^(\S+) (?:([LR]) )?([A-Za-z]+?)(\d*)$/);
  if (m) {
    const [, root, side, word, digits] = m;
    const italian = ITALIAN.find(([en]) => en.toLowerCase() === word.toLowerCase())?.[1];
    if (italian) out.push(`${root}${side ? ` ${SIDES[side]}` : ""} ${italian}${digits}`);
    if (/^finger$/i.test(word) && side) out.push(`${root} Dito mano ${SIDES[side]}${digits}`);
    if (/^toe$/i.test(word) && side) out.push(`${root} Dito piede ${SIDES[side]}${digits}`);
  }
  // Italian: "Bip01 SX Coscia", "Bip01 Dorso2", "Bip01 Dito mano SX01"
  m = name.match(/^(\S+) Dito (mano|piede) (SX|DX)(\d*)$/i);
  if (m) out.push(`${m[1]} ${m[3].toUpperCase() === "SX" ? "L" : "R"} ${m[2].toLowerCase() === "mano" ? "Finger" : "Toe"}${m[4]}`);
  m = name.match(/^(\S+) (?:(SX|DX) )?([A-Za-z ]+?)(\d*)$/);
  if (m) {
    const [, root, side, word, digits] = m;
    const english = ITALIAN.find(([, it]) => it.toLowerCase() === word.toLowerCase())?.[0];
    if (english) out.push(`${root}${side ? ` ${side.toUpperCase() === "SX" ? "L" : "R"}` : ""} ${english}${digits}`);
  }
  // and the older Biped's name of a limb named the newer way, in whichever language it came
  for (const each of [...out]) {
    const newer = each.match(/^(\S+) ([LR]) (Clavicle|UpperArm|Forearm|Thigh|Calf)$/i);
    if (newer) out.push(`${newer[1]} ${newer[2]} ${Object.entries(OLDER).find(([, v]) => v.toLowerCase() === newer[3].toLowerCase())[0]}`);
  }
  return out;
}

/** A Biped bone's name with its root's number left out: "Bip02 L Leg" and "Bip01 L Leg" are one bone. */
const rootless = (name) => name.toLowerCase().replace(/^bip\d+(\s|$)/, "bip$1");

/**
 * The name among `names` that is the bone `name` stands for, in whichever language and under whichever Biped root
 * (Valve's scientist is rooted at Bip02); null when none is.
 */
export function boneIn(name, names) {
  if (typeof name !== "string") return null;
  const list = [...names];
  for (const each of namesOf(name)) {
    const found = list.find((n) => n === each) ?? list.find((n) => n.toLowerCase() === each.toLowerCase());
    if (found) return found;
  }
  for (const each of namesOf(name)) {
    const found = list.find((n) => rootless(n) === rootless(each));
    if (found) return found;
  }
  return null;
}

/** The same bone on the other side of the body: L and R, SX and DX. Other names come back as they are. */
export function otherSideOf(name) {
  if (!name) return name;
  const swap = { L: "R", R: "L", SX: "DX", DX: "SX" };
  return name.replace(/(^|\s)(L|R|SX|DX)(\s|\d|$)/, (all, before, side, after) => `${before}${swap[side]}${after}`);
}
