// The RP items and shops check (levels/rp/items.mjs, levels/rp/plugin/smak_items.sma): the example catalogue and the
// mtest shop pass with nothing said; a shop that sells an item for less than another buys it back for is refused
// (the money-duplication trap of NPCS.md 5.5); the shops may be one file or several; the plugin's and the checker's
// limits are the same numbers. The failures, one by one, are in test/broken/rp-items.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { checkItems, LIMITS, ITEM_KINDS } from "../levels/rp/items.mjs";

const dir = join(HERE, "../levels/rp/items");
const items = JSON.parse(readFileSync(join(dir, "items.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(dir, "smak_rp_mtest.shops.json"), "utf8"));
const copy = (o) => JSON.parse(JSON.stringify(o));

test("rp items: the example catalogue and the mtest shop pass with no error and no warning", () => {
  const r = checkItems(items, shops);
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  sure(r.facts.some((f) => /^8 items/.test(f)) && r.facts.some((f) => /smak_rp_mtest: 1 shops/.test(f)), r.facts.join(" | "));
  sure(ITEM_KINDS.every((k) => items.items.some((i) => i.kind === k)), "the example has one of every kind");
});

test("rp items: the catalogue alone passes, and shops come as one file or several", () => {
  sure(checkItems(items).errors.length === 0, "the catalogue alone");
  sure(checkItems(items, [shops, { ...copy(shops), map: "other_map" }]).errors.length === 0, "two files");
});

test("rp items: buying an item and selling it back never pays, across shops and maps", () => {
  const other = copy(shops);
  other.map = "other_map";
  other.shops[0].stock = [];
  other.shops[0].buys = [{ item: "vendaje", price: 16 }]; // the first shop sells vendaje for 15
  const r = checkItems(items, [shops, other]);
  sure(r.errors.length === 1 && /vendaje is sold for 15 in shop marco and bought back for 16 in shop marco: buying and selling again makes 1 each round/.test(r.errors[0]), r.errors.join(" | ")); // prettier-ignore
  other.shops[0].buys = [{ item: "vendaje", price: 15 }]; // equal: no profit
  sure(checkItems(items, [shops, other]).errors.length === 0, "an equal price is no profit");
});

test("rp items: the limits the plugin keeps are the checker's", () => {
  const src = readFileSync(join(HERE, "../levels/rp/plugin/smak_items.sma"), "utf8");
  const def = (n) => Number(src.match(new RegExp(`^#define ${n}[ ]+([0-9]+)`, "m"))?.[1]);
  sure(def("MAX_ITEMS") === LIMITS.items && def("MAX_SHOPS") === LIMITS.shops, "items or shops");
  sure(def("MAX_STOCK") === LIMITS.stock && def("MAX_BUYS") === LIMITS.buys, "stock or buys");
  sure(def("NAME_LEN") === LIMITS.name + 1 && def("ID_LEN") === LIMITS.id + 1, "name or id length");
});
