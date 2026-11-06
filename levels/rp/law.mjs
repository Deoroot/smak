// The offline check of a map's police stations (levels/rp/plugin/smak_law.sma): `<map>.law.json`, format
// "smak-law/1". It reads the file as the plugin does and says, in sentences, what the plugin would leave out.
export const LAW_FORMAT = "smak-law/1";
/** The plugin's fixed tables: stations on a map, bytes of an id and of a name (minus the end of the string). */
export const LIMITS = { stations: 8, id: 31, name: 47 };
const ID = /^[a-z][a-z0-9_]*$/;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Returns { errors, warnings, facts }; errors are what the plugin would refuse or leave out. */
export function checkLaw(law) {
  const errors = [];
  const warnings = [];
  const facts = [];
  if (!law || typeof law !== "object" || Array.isArray(law)) return { errors: ["the law file is not a JSON object"], warnings, facts };
  if (law.format !== LAW_FORMAT) errors.push(`the law file has format ${JSON.stringify(law.format)}, not "${LAW_FORMAT}"`);
  if (typeof law.map !== "string" || !law.map) errors.push("the law file names no map");
  const list = Array.isArray(law.stations) ? law.stations : null;
  if (!list) {
    errors.push("the law file has no `stations` list");
    return { errors, warnings, facts };
  }
  if (list.length > LIMITS.stations) errors.push(`${law.map} has ${list.length} stations; the plugin keeps ${LIMITS.stations}`);
  if (!list.length) warnings.push("no station: /multa can never be used on this map");
  const seen = new Set();
  list.forEach((s, i) => {
    const at = `station ${i + 1}${typeof s?.id === "string" ? ` (${s.id})` : ""}`;
    if (!s || typeof s !== "object") return errors.push(`${at} is not an object`);
    if (typeof s.id !== "string" || !s.id) errors.push(`${at} has no id`);
    else if (!ID.test(s.id) || s.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, up to ${LIMITS.id} characters`);
    else if (seen.has(s.id)) errors.push(`the station id ${s.id} is used twice`);
    else seen.add(s.id);
    if (typeof s.name !== "string" || !s.name.trim()) errors.push(`${at} has no name`);
    else if (Buffer.byteLength(s.name) > LIMITS.name) errors.push(`${at}: the name is longer than ${LIMITS.name} bytes`);
    if (!Array.isArray(s.origin) || s.origin.length !== 3 || !s.origin.every(isNum)) errors.push(`${at}: origin must be [x, y, z]`);
    else if (s.origin.some((v) => Math.abs(v) > 4096)) warnings.push(`${at}: origin ${JSON.stringify(s.origin)} is past +-4096`);
    if (!isNum(s.radius) || s.radius <= 0) errors.push(`${at}: it needs a radius of more than 0`);
    else if (s.radius > 512) warnings.push(`${at}: radius ${s.radius} is large: the fine can be paid from far away`);
  });
  facts.push(`${law.map}: ${list.length} stations`);
  return { errors, warnings, facts };
}
