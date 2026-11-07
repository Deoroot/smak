// The RP doors check (levels/rp/doors.mjs, levels/rp/plugin/smak_doors.sma): the byz01 doors file passes with nothing
// said, alone and against the items catalogue (every home it offers has a key item); a rp.json held against it; the
// plugin's table sizes, format and key columns are the checker's. The failures, one by one, are in
// test/broken/rp-doors.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { checkDoors, LIMITS, DOORS_FORMAT, POLICIES } from "../levels/rp/doors.mjs";
import { checkItems } from "../levels/rp/items.mjs";

const dir = join(HERE, "../levels/rp");
const doors = JSON.parse(readFileSync(join(dir, "doors/smak_rp_byz01.doors.json"), "utf8"));
const items = JSON.parse(readFileSync(join(dir, "items/items.json"), "utf8"));
const rp = {
  map: "smak_rp_byz01",
  properties: doors.properties.map((p) => ({ id: p.id, kind: p.price !== undefined ? "home" : "public", doors: [`smak_rp_byz01_${p.id}`] })),
};

test("rp doors: the byz01 doors file passes with no error and no warning, against the catalogue too", () => {
  for (const [what, ctx] of [["alone", {}], ["with the items", { items }], ["with the items and an rp.json", { items, rp }]]) {
    const r = checkDoors(doors, ctx);
    sure(r.errors.length === 0 && r.warnings.length === 0, `${what}: errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  }
  sure(checkDoors(doors).facts.some((f) => /smak_rp_byz01: 33 properties listed, 30 homes offered/.test(f)), checkDoors(doors).facts.join(" | "));
});

test("rp doors: the catalogue the keys live in is still clean, and every key opens a different property", () => {
  const r = checkItems(items);
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  const keys = items.items.filter((i) => i.kind === "key");
  sure(keys.length === 37 && new Set(keys.map((k) => k.opens)).size === 37, `${keys.length} keys`);
  sure(items.items.some((i) => i.id === "ganzua"), "the lockpick item");
  const shops = JSON.parse(readFileSync(join(dir, "items/smak_rp_byz01.shops.json"), "utf8"));
  sure(shops.shops.find((s) => s.id === "trastienda").stock.some((s) => s.item === "ganzua"), "the fence sells the lockpick");
});

test("rp doors: the limits, the format and the tables the plugin keeps are the checker's", () => {
  const src = readFileSync(join(dir, "plugin/smak_doors.sma"), "utf8");
  const def = (n) => Number(src.match(new RegExp(`^#define ${n}[ ]+([0-9]+)`, "m"))?.[1]);
  sure(def("MAX_PROPS") === LIMITS.properties && def("MAX_LEAVES") === LIMITS.leaves && def("MAX_KEYS") === LIMITS.keys, "tables");
  sure(def("NAME_LEN") === LIMITS.name + 1 && def("ID_LEN") === LIMITS.id + 1 && def("PRICE_MAX") === LIMITS.price, "lengths and prices");
  sure(src.includes(`#define DOORS_FORMAT  "${DOORS_FORMAT}"`), "format");
  for (const p of POLICIES) sure(src.includes(`equal(pol, "${p}")`), `policy ${p}`);
  sure(/CREATE TABLE IF NOT EXISTS homes \(property TEXT NOT NULL PRIMARY KEY, owner_ident TEXT NOT NULL, until INTEGER/.test(src), "homes table");
  const inc = readFileSync(join(dir, "plugin/include/smak_doors.inc"), "utf8");
  for (const n of ["smak_door_locked(ent)", "smak_door_breach(ent, by)", "smak_door_property(ent, out[], len)", "smak_door_kind(ent, out[], len)"]) sure(inc.includes(n), n);
});
