// The offline check of the RP items and shops (levels/rp/plugin/smak_items.sma, levels/rp/NPCS.md 5.5, 5.8, 5.11):
// `items.json` (format "smak-items/1") and one `<map>.shops.json` per map (format "smak-shops/1"). It reads the two
// files as the plugin does and says, in sentences, what the plugin would refuse or what would let a player make
// money from nothing: an item a shop sells for less than a shop buys it back for.
export const ITEMS_FORMAT = "smak-items/1";
export const SHOPS_FORMAT = "smak-shops/1";
export const ITEM_KINDS = ["document", "key", "consumable", "weapon", "misc"];
/** The plugin's fixed tables: items in the catalogue, shops on a map, items in one shop's stock and in its buys. */
export const LIMITS = { items: 128, shops: 16, stock: 32, buys: 32, name: 47, desc: 150, id: 31, stack: 99, price: 1_000_000 };
const ID = /^[a-z][a-z0-9_]*$/;
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Checks a catalogue and, when given, the shops of one map or of several (an object, or an array of objects).
 * Returns { errors, warnings, facts }: errors are what the plugin would refuse or what breaks the money; warnings
 * are doubtful but loadable.
 */
export function checkItems(itemsJson, shopsJson) {
  const errors = [];
  const warnings = [];
  const facts = [];
  const known = new Map();
  const opens = new Map(); // property id -> the first key item that opens it

  if (!itemsJson || typeof itemsJson !== "object" || Array.isArray(itemsJson)) {
    return { errors: ["the items file is not a JSON object"], warnings, facts };
  }
  if (itemsJson.format !== ITEMS_FORMAT) errors.push(`the items file has format ${JSON.stringify(itemsJson.format)}, not "${ITEMS_FORMAT}"`);
  const list = Array.isArray(itemsJson.items) ? itemsJson.items : null;
  if (!list) errors.push("the items file has no `items` list");
  else {
    if (list.length > LIMITS.items) errors.push(`the catalogue has ${list.length} items; the plugin keeps ${LIMITS.items}`);
    list.forEach((it, i) => {
      const at = `item ${i + 1}${typeof it?.id === "string" ? ` (${it.id})` : ""}`;
      if (!it || typeof it !== "object") return errors.push(`${at} is not an object`);
      if (typeof it.id !== "string" || !it.id) errors.push(`${at} has no id`);
      else if (!ID.test(it.id) || it.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, starting with a letter, up to ${LIMITS.id} characters`);
      else if (known.has(it.id)) errors.push(`the item id ${it.id} is used twice (items ${known.get(it.id).n} and ${i + 1})`);
      else known.set(it.id, { ...it, n: i + 1 });
      if (typeof it.name !== "string" || !it.name.trim()) errors.push(`${at} has no name`);
      else if (Buffer.byteLength(it.name) > LIMITS.name) errors.push(`${at}: the name is ${Buffer.byteLength(it.name)} bytes; a menu line holds ${LIMITS.name}`);
      if (!ITEM_KINDS.includes(it.kind)) errors.push(`${at} has kind ${JSON.stringify(it.kind)}; the kinds are ${ITEM_KINDS.join(", ")}`);
      for (const f of ["price", "sell"]) {
        if (!isInt(it[f])) errors.push(`${at}: ${f} must be a whole number${it[f] === undefined ? " (it is missing)" : ""}`);
        else if (it[f] < 0) errors.push(`${at} has a negative ${f} (${it[f]})`);
        else if (it[f] > LIMITS.price) errors.push(`${at}: ${f} ${it[f]} is past ${LIMITS.price}`);
      }
      if (!isInt(it.stack) || it.stack < 1 || it.stack > LIMITS.stack) errors.push(`${at}: stack must be a whole number from 1 to ${LIMITS.stack}`);
      if (it.weight !== undefined && (!isNum(it.weight) || it.weight < 0)) errors.push(`${at}: weight must be a number of 0 or more`);
      if (it.desc !== undefined && (typeof it.desc !== "string" || Buffer.byteLength(it.desc) > LIMITS.desc)) errors.push(`${at}: desc must be text of up to ${LIMITS.desc} bytes (a chat line holds about 190)`);
      if (it.kind === "consumable") {
        if (!isInt(it.use?.heal) || it.use.heal <= 0) errors.push(`${at} is a consumable with no use: { "heal": n } of more than 0`);
      } else if (it.use !== undefined) warnings.push(`${at} has a use but is not a consumable: the plugin ignores it`);
      if (it.kind === "weapon") {
        if (!isInt(it.ts_weapon) || it.ts_weapon < 1 || it.ts_weapon > 40) errors.push(`${at} is a weapon with no ts_weapon (a Specialists weapon number from 1 to 40)`);
      } else if (it.ts_weapon !== undefined) warnings.push(`${at} has a ts_weapon but is not a weapon: the plugin ignores it`);
      if (it.kind === "key") {
        if (typeof it.opens !== "string" || !ID.test(it.opens) || it.opens.length > LIMITS.id) errors.push(`${at} is a key with no valid "opens": the id of the property it opens (lower-case letters, digits and _, up to ${LIMITS.id} characters)`);
        else if (opens.has(it.opens)) warnings.push(`${at} opens ${it.opens}, which ${opens.get(it.opens)} already opens: the doors plugin hands out the first`);
        else opens.set(it.opens, it.id);
      } else if (it.opens !== undefined) warnings.push(`${at} has an opens but is not a key: the plugin ignores it`);
    });
    facts.push(`${list.length} items: ${ITEM_KINDS.map((k) => `${list.filter((i) => i?.kind === k).length} ${k}`).join(", ")}`);
  }

  // ── the shops ──
  const files = shopsJson === undefined || shopsJson === null ? [] : Array.isArray(shopsJson) ? shopsJson : [shopsJson];
  const sold = new Map(); // item -> [{ shop, price }]
  const bought = new Map();
  const note = (map, item, shop, price) => map.set(item, [...(map.get(item) ?? []), { shop, price }]);
  for (const file of files) {
    const map = typeof file?.map === "string" ? file.map : "?";
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      errors.push("a shops file is not a JSON object");
      continue;
    }
    if (file.format !== SHOPS_FORMAT) errors.push(`the shops file of ${map} has format ${JSON.stringify(file.format)}, not "${SHOPS_FORMAT}"`);
    if (typeof file.map !== "string" || !file.map) errors.push("a shops file names no map");
    const shops = Array.isArray(file.shops) ? file.shops : null;
    if (!shops) {
      errors.push(`the shops file of ${map} has no \`shops\` list`);
      continue;
    }
    if (shops.length > LIMITS.shops) errors.push(`${map} has ${shops.length} shops; the plugin keeps ${LIMITS.shops}`);
    const seen = new Set();
    shops.forEach((s, i) => {
      const at = `shop ${i + 1} of ${map}${typeof s?.id === "string" ? ` (${s.id})` : ""}`;
      if (!s || typeof s !== "object") return errors.push(`${at} is not an object`);
      if (typeof s.id !== "string" || !s.id) errors.push(`${at} has no id`);
      else if (!ID.test(s.id) || s.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, up to ${LIMITS.id} characters`);
      else if (seen.has(s.id)) errors.push(`the shop id ${s.id} is used twice on ${map}`);
      else seen.add(s.id);
      const id = s.id ?? `#${i + 1}`;
      if (typeof s.name !== "string" || !s.name.trim()) errors.push(`${at} has no name`);
      else if (Buffer.byteLength(s.name) > LIMITS.name) errors.push(`${at}: the name is longer than ${LIMITS.name} bytes`);
      const hasOrigin = s.origin !== undefined;
      if (!hasOrigin && !s.npc) errors.push(`${at} has neither an origin with a radius nor an npc to stand near`);
      if (hasOrigin) {
        if (!Array.isArray(s.origin) || s.origin.length !== 3 || !s.origin.every(isNum)) errors.push(`${at}: origin must be [x, y, z]`);
        else if (s.origin.some((v) => Math.abs(v) > 4096)) warnings.push(`${at}: origin ${JSON.stringify(s.origin)} is past +-4096`);
        if (!isNum(s.radius) || s.radius <= 0) errors.push(`${at}: an origin needs a radius of more than 0`);
        else if (s.radius > 1024) warnings.push(`${at}: radius ${s.radius} is large: the shop opens from far away`);
      }
      if (s.hours !== undefined) {
        const h = s.hours;
        if (!Array.isArray(h) || h.length !== 2 || !h.every((v) => isNum(v) && v >= 0 && v <= 24)) errors.push(`${at}: hours must be [open, close], two numbers from 0 to 24 (close may be before open: past midnight; [0, 24] is always open)`);
        else if (h[0] === h[1] && !(h[0] === 0 || h[0] === 24)) errors.push(`${at}: hours ${JSON.stringify(h)} open and close at the same hour; write [0, 24] for a shop that is always open`);
      }
      if (s.period !== undefined) {
        if (s.period !== "day" && s.period !== "night") errors.push(`${at}: period must be "day" or "night" (a night shop opens when the city goes out; a day shop is shut at night)`);
        else {
          const h = s.hours ?? (s.period === "night" ? [20, 4] : [7, 20]);
          const openAt = (x) => (h[0] === h[1] ? true : h[0] < h[1] ? x >= h[0] && x < h[1] : x >= h[0] || x < h[1]);
          if (Array.isArray(h) && h.length === 2) {
            if (s.period === "night" && !openAt(0)) errors.push(`${at}: a night shop must be open at midnight, but its hours ${JSON.stringify(h)} are not`);
            if (s.period === "day" && !openAt(12)) errors.push(`${at}: a day shop must be open at noon, but its hours ${JSON.stringify(h)} are not`);
          }
        }
      }
      if (s.keeper !== undefined && (typeof s.keeper !== "string" || !s.keeper)) errors.push(`${at}: keeper must be the id of a generated keeper of smak_npc (shopkeeper_<place>)`);
      if (s.npc !== undefined && (typeof s.npc !== "string" || !s.npc)) errors.push(`${at}: npc must be the id of an npc of the map's rp.json`);
      else if (s.npc && !hasOrigin && s.radius !== undefined && (!isNum(s.radius) || s.radius <= 0)) errors.push(`${at}: radius must be more than 0`);
      for (const [field, cap, into] of [["stock", LIMITS.stock, sold], ["buys", LIMITS.buys, bought]]) {
        const rows = s[field] ?? [];
        if (!Array.isArray(rows)) {
          errors.push(`${at}: ${field} must be a list`);
          continue;
        }
        if (rows.length > cap) errors.push(`${at}: ${field} has ${rows.length} entries; the plugin keeps ${cap}`);
        const once = new Set();
        for (const row of rows) {
          const item = typeof row === "string" ? row : row?.item;
          const over = typeof row === "object" && row ? row.price : undefined;
          if (typeof item !== "string") {
            errors.push(`${at}: an entry of ${field} names no item`);
            continue;
          }
          const def = known.get(item);
          if (!def) {
            errors.push(`${at}: ${field} names the item ${item}, which is not in the catalogue`);
            continue;
          }
          if (once.has(item)) errors.push(`${at}: ${field} lists ${item} twice`);
          once.add(item);
          if (over !== undefined && (!isInt(over) || over < 0)) {
            errors.push(`${at}: ${field} gives ${item} ${over < 0 ? "a negative" : "a non-whole"} price (${over})`);
            continue;
          }
          const price = over ?? (field === "stock" ? def.price : def.sell);
          if (isInt(price)) note(into, item, id, price);
          if (field === "buys" && price === 0) warnings.push(`${at} buys ${item} for 0: the player gets nothing for it`);
          if (field === "stock" && price === 0 && def.kind !== "document") warnings.push(`${at} gives ${item} away for 0`);
        }
      }
    });
    facts.push(`${map}: ${shops.length} shops`);
  }

  // ── the trap: buying an item and selling it back must never pay ──
  for (const [item, buys] of bought) {
    const sells = sold.get(item);
    if (!sells) continue;
    const cheapest = sells.reduce((a, b) => (b.price < a.price ? b : a));
    const dearest = buys.reduce((a, b) => (b.price > a.price ? b : a));
    if (dearest.price > cheapest.price) {
      errors.push(
        `${item} is sold for ${cheapest.price} in shop ${cheapest.shop} and bought back for ${dearest.price} in shop ${dearest.shop}: ` +
          `buying and selling again makes ${dearest.price - cheapest.price} each round`,
      );
    }
  }
  return { errors, warnings, facts };
}
