// The offline check of the RP implants and clinics (levels/rp/plugin/smak_implants.sma): `implants.json` (format
// "smak-implants/1") and one `<map>.clinics.json` per map (format "smak-clinics/1"). It reads the files as the plugin
// does and says, in sentences, what the plugin would leave out or what would let a player make money from nothing: a
// refund of more than the price.
export const IMPLANTS_FORMAT = "smak-implants/1";
export const CLINICS_FORMAT = "smak-clinics/1";
export const SLOTS = ["legs", "skin", "blood", "head"];
/** The effect keys the plugin reads, with the range it clamps each to. */
export const EFFECTS = { speed_pct: [1, 100], armor: [1, 100], regen_hp: [1, 20], regen_every: [1, 120], damage_pct: [1, 60] };
/** The plugin's fixed tables: implants in the catalogue, clinics on a map, name and description sizes. */
export const LIMITS = { implants: 32, clinics: 8, name: 47, desc: 150, id: 31, price: 1_000_000 };
const ID = /^[a-z][a-z0-9_]*$/;
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Checks a catalogue and, when given, the clinics of one map or several. Returns { errors, warnings, facts }. */
export function checkImplants(implantsJson, clinicsJson) {
  const errors = [];
  const warnings = [];
  const facts = [];
  const known = new Map();

  if (!implantsJson || typeof implantsJson !== "object" || Array.isArray(implantsJson)) {
    return { errors: ["the implants file is not a JSON object"], warnings, facts };
  }
  if (implantsJson.format !== IMPLANTS_FORMAT) errors.push(`the implants file has format ${JSON.stringify(implantsJson.format)}, not "${IMPLANTS_FORMAT}"`);
  const list = Array.isArray(implantsJson.implants) ? implantsJson.implants : null;
  if (!list) errors.push("the implants file has no `implants` list");
  else {
    if (list.length > LIMITS.implants) errors.push(`the catalogue has ${list.length} implants; the plugin keeps ${LIMITS.implants}`);
    list.forEach((it, i) => {
      const at = `implant ${i + 1}${typeof it?.id === "string" ? ` (${it.id})` : ""}`;
      if (!it || typeof it !== "object") return errors.push(`${at} is not an object`);
      if (typeof it.id !== "string" || !it.id) errors.push(`${at} has no id`);
      else if (!ID.test(it.id) || it.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, starting with a letter, up to ${LIMITS.id} characters`);
      else if (known.has(it.id)) errors.push(`the implant id ${it.id} is used twice (implants ${known.get(it.id)} and ${i + 1})`);
      else known.set(it.id, i + 1);
      if (typeof it.name !== "string" || !it.name.trim()) errors.push(`${at} has no name`);
      else if (Buffer.byteLength(it.name) > LIMITS.name) errors.push(`${at}: the name is ${Buffer.byteLength(it.name)} bytes; a menu line holds ${LIMITS.name}`);
      if (!SLOTS.includes(it.slot)) errors.push(`${at} has slot ${JSON.stringify(it.slot)}; the slots are ${SLOTS.join(", ")}`);
      if (!isInt(it.price) || it.price < 1) errors.push(`${at}: price must be a whole number of 1 or more`);
      else if (it.price > LIMITS.price) errors.push(`${at}: price ${it.price} is past ${LIMITS.price}`);
      if (!isInt(it.install) || it.install < 0) errors.push(`${at}: install must be a whole number of 0 or more`);
      if (!isInt(it.refund) || it.refund < 0) errors.push(`${at}: refund must be a whole number of 0 or more`);
      else if (isInt(it.price) && it.price >= 1 && it.refund > it.price) errors.push(`${at} refunds ${it.refund} but costs ${it.price}: installing and removing it again makes money`);
      if (it.desc !== undefined && (typeof it.desc !== "string" || Buffer.byteLength(it.desc) > LIMITS.desc)) errors.push(`${at}: desc must be text of up to ${LIMITS.desc} bytes`);
      if (!it.effect || typeof it.effect !== "object" || Array.isArray(it.effect)) return errors.push(`${at} has no effect block`);
      let useful = 0;
      for (const [k, v] of Object.entries(it.effect)) {
        const range = EFFECTS[k];
        if (!range) errors.push(`${at}: the effect ${k} is not one the plugin has (${Object.keys(EFFECTS).join(", ")})`);
        else {
          if (!isInt(v) || v < range[0] || v > range[1]) errors.push(`${at}: ${k} must be a whole number from ${range[0]} to ${range[1]}`);
          if (k !== "regen_every") useful++;
        }
      }
      if (it.effect.regen_hp !== undefined && it.effect.regen_every === undefined) errors.push(`${at}: regen_hp needs regen_every (seconds)`);
      if (it.effect.regen_every !== undefined && it.effect.regen_hp === undefined) errors.push(`${at}: regen_every without regen_hp does nothing`);
      if (!useful) errors.push(`${at} does nothing: its effect has none of speed_pct, armor, regen_hp, damage_pct`);
    });
    facts.push(`${list.length} implants: ${SLOTS.map((s) => `${list.filter((i) => i?.slot === s).length} ${s}`).join(", ")}`);
  }

  const files = clinicsJson === undefined || clinicsJson === null ? [] : Array.isArray(clinicsJson) ? clinicsJson : [clinicsJson];
  for (const file of files) {
    const map = typeof file?.map === "string" ? file.map : "?";
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      errors.push("a clinics file is not a JSON object");
      continue;
    }
    if (file.format !== CLINICS_FORMAT) errors.push(`the clinics file of ${map} has format ${JSON.stringify(file.format)}, not "${CLINICS_FORMAT}"`);
    if (typeof file.map !== "string" || !file.map) errors.push("a clinics file names no map");
    const clinics = Array.isArray(file.clinics) ? file.clinics : null;
    if (!clinics) {
      errors.push(`the clinics file of ${map} has no \`clinics\` list`);
      continue;
    }
    if (clinics.length > LIMITS.clinics) errors.push(`${map} has ${clinics.length} clinics; the plugin keeps ${LIMITS.clinics}`);
    const seen = new Set();
    clinics.forEach((c, i) => {
      const at = `clinic ${i + 1} of ${map}${typeof c?.id === "string" ? ` (${c.id})` : ""}`;
      if (!c || typeof c !== "object") return errors.push(`${at} is not an object`);
      if (typeof c.id !== "string" || !c.id) errors.push(`${at} has no id`);
      else if (seen.has(c.id)) errors.push(`the clinic id ${c.id} is used twice on ${map}`);
      else seen.add(c.id);
      if (c.name !== undefined && (typeof c.name !== "string" || Buffer.byteLength(c.name) > LIMITS.name)) errors.push(`${at}: name must be text of up to ${LIMITS.name} bytes`);
      if (!Array.isArray(c.origin) || c.origin.length !== 3 || !c.origin.every(isNum)) errors.push(`${at} has no origin of three numbers`);
      if (!isNum(c.radius) || c.radius <= 0) errors.push(`${at} has no radius of more than 0`);
      if (c.offer !== undefined) {
        if (!Array.isArray(c.offer)) errors.push(`${at}: offer must be a list of implant ids`);
        else {
          if (!c.offer.length) warnings.push(`${at} offers nothing`);
          const once = new Set();
          for (const o of c.offer) {
            if (list && !known.has(o)) errors.push(`${at}: offer names the implant ${o}, which is not in the catalogue`);
            if (once.has(o)) errors.push(`${at}: offer lists ${o} twice`);
            once.add(o);
          }
        }
      }
    });
    facts.push(`${map}: ${clinics.length} clinics`);
  }
  return { errors, warnings, facts };
}
