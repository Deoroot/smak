// The offline check of a map's doors (levels/rp/plugin/smak_doors.sma): `<map>.doors.json`, format "smak-doors/1",
// the prices and policies of its homes. It reads the file as the plugin does and says, in sentences, what the
// plugin would leave out, and what would leave a home with no key. Given the map's rp.json it holds the property
// ids against it; given the items catalogue it holds that every home offered has a key item that opens it.
export const DOORS_FORMAT = "smak-doors/1";
export const POLICIES = ["open", "key", "guard", "gate"];
/** The plugin's fixed tables: properties on a map, leaves of a property, copies of keys, bytes of an id and of a name. */
export const LIMITS = { properties: 128, leaves: 8, keys: 256, id: 31, name: 47, price: 1_000_000, days: 365 };
const ID = /^[a-z][a-z0-9_]*$/;
const isInt = (v) => Number.isInteger(v);

/**
 * Returns { errors, warnings, facts }. errors are what the plugin would refuse or leave out; warnings are loadable
 * but doubtful. `ctx.rp`: the map's rp.json (object); `ctx.items`: the items catalogue (object); `ctx.leaves`: how
 * many entities of the compiled map carry each door name ({ targetname: count }), since one name can be several leaves
 * (a double door, a manor's eight); without it each door name counts as one leaf.
 */
export function checkDoors(doors, ctx = {}) {
  const errors = [];
  const warnings = [];
  const facts = [];
  if (!doors || typeof doors !== "object" || Array.isArray(doors)) return { errors: ["the doors file is not a JSON object"], warnings, facts };
  if (doors.format !== DOORS_FORMAT) errors.push(`the doors file has format ${JSON.stringify(doors.format)}, not "${DOORS_FORMAT}"`);
  if (typeof doors.map !== "string" || !doors.map) errors.push("the doors file names no map");
  const map = typeof doors.map === "string" ? doors.map : "?";

  const money = (at, what, v, { min = 0, max = LIMITS.price } = {}) => {
    if (!isInt(v)) errors.push(`${at}: ${what} must be a whole number`);
    else if (v < min || v > max) errors.push(`${at}: ${what} ${v} is outside ${min} to ${max}`);
  };
  const def = doors.defaults?.home;
  if (doors.defaults !== undefined && (typeof doors.defaults !== "object" || doors.defaults === null || Array.isArray(doors.defaults))) errors.push("defaults must be an object ({ home: { price, rent, rent_days } })"); // prettier-ignore
  else if (def !== undefined) {
    if (typeof def !== "object" || def === null) errors.push("defaults.home must be an object");
    else {
      if (def.price !== undefined) money("defaults.home", "price", def.price);
      if (def.rent !== undefined) money("defaults.home", "rent", def.rent);
      if (def.rent_days !== undefined) money("defaults.home", "rent_days", def.rent_days, { min: 1, max: LIMITS.days });
    }
  }

  const list = Array.isArray(doors.properties) ? doors.properties : doors.properties === undefined ? [] : null;
  if (list === null) {
    errors.push("`properties` must be a list");
    return { errors, warnings, facts };
  }
  const rpProps = new Map();
  if (ctx.rp) {
    if (ctx.rp.map !== undefined && ctx.rp.map !== doors.map) errors.push(`the doors file is for ${map} but the rp.json is for ${ctx.rp.map}`);
    const ps = Array.isArray(ctx.rp.properties) ? ctx.rp.properties : [];
    if (ps.length > LIMITS.properties) errors.push(`the map has ${ps.length} properties; the plugin keeps ${LIMITS.properties}`);
    for (const p of ps) {
      rpProps.set(p.id, p);
      const n = Array.isArray(p.doors) ? p.doors.reduce((a, name) => a + (ctx.leaves?.[name] ?? 1), 0) : 0;
      if (n > LIMITS.leaves) errors.push(`property ${p.id} has ${n} door leaves; the plugin keeps ${LIMITS.leaves} leaves of a property and leaves the rest unlocked`); // prettier-ignore
    }
  }
  const keys = new Map();
  for (const it of ctx.items?.items ?? []) if (it?.kind === "key" && typeof it.opens === "string" && !keys.has(it.opens)) keys.set(it.opens, it.id);

  const seen = new Set();
  let offered = 0;
  list.forEach((p, i) => {
    const at = `property ${i + 1}${typeof p?.id === "string" ? ` (${p.id})` : ""}`;
    if (!p || typeof p !== "object") return errors.push(`${at} is not an object`);
    if (typeof p.id !== "string" || !p.id) errors.push(`${at} has no id`);
    else if (!ID.test(p.id) || p.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, starting with a letter, up to ${LIMITS.id} characters`);
    else if (seen.has(p.id)) errors.push(`the property id ${p.id} is used twice`);
    else seen.add(p.id);
    if (p.name !== undefined && (typeof p.name !== "string" || !p.name.trim() || Buffer.byteLength(p.name) > LIMITS.name)) errors.push(`${at}: name must be text of 1 to ${LIMITS.name} bytes`);
    if (p.price !== undefined) money(at, "price", p.price);
    if (p.rent !== undefined) money(at, "rent", p.rent);
    if (p.rent_days !== undefined) money(at, "rent_days", p.rent_days, { min: 1, max: LIMITS.days });
    if (p.policy !== undefined && !POLICIES.includes(p.policy)) errors.push(`${at} has policy ${JSON.stringify(p.policy)}; the policies are ${POLICIES.join(", ")}`);
    const rp = rpProps.get(p.id);
    if (ctx.rp && !rp) errors.push(`${at} names a property the map's rp.json does not have: the plugin leaves it out`);
    const kind = rp?.kind ?? (p.price !== undefined || p.rent !== undefined || p.policy === undefined ? "home" : "other");
    const price = p.price ?? def?.price ?? 0;
    const rent = p.rent ?? def?.rent ?? 0;
    if (rp && kind !== "home" && (p.price !== undefined || p.rent !== undefined)) warnings.push(`${at} is a ${kind}, not a home: its price and rent are ignored`);
    if (kind === "home" && isInt(price) && isInt(rent)) {
      if (price > 0 || rent > 0) offered++;
      if (price > 0 && rent > 0 && price <= rent) warnings.push(`${at}: buying (${price}) costs no more than one rent (${rent}): nobody will rent it`);
      if (price === 0 && rent === 0) warnings.push(`${at} is not for sale or rent`);
      if ((price > 0 || rent > 0) && ctx.items && !keys.has(p.id)) warnings.push(`${at} is offered but no key item opens it: add an item of kind key with "opens": "${p.id}" (the buyer would get no key)`); // prettier-ignore
    }
  });
  // homes of the rp.json that this file leaves to the defaults
  if (ctx.rp && def) {
    for (const [id, p] of rpProps) {
      if (p.kind === "home" && !seen.has(id) && ctx.items && !keys.has(id) && (def.price > 0 || def.rent > 0)) warnings.push(`home ${id} (left to the defaults) has no key item that opens it`);
    }
  }
  if (list.length > LIMITS.properties) errors.push(`${map} lists ${list.length} properties; the plugin keeps ${LIMITS.properties}`);
  facts.push(`${map}: ${list.length} properties listed, ${offered} homes offered`);
  return { errors, warnings, facts };
}
