// The RP items and shops check (levels/rp/items.mjs checkItems) broken in one way each: an unknown item in a shop, a
// repeated item id, an item with no name, a negative price, the money-duplication trap (sold for less than bought
// back), a repeated shop id, a shop with no place, a consumable that does nothing, a weapon with no TS weapon, a
// stack of 0, an item listed twice in a stock. The example catalogue and the mtest shop are the whole twin.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { checkItems } from "../../levels/rp/items.mjs";

const dir = join(HERE, "../levels/rp/items");
const items = JSON.parse(readFileSync(join(dir, "items.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(dir, "smak_rp_mtest.shops.json"), "utf8"));
const copy = (o) => JSON.parse(JSON.stringify(o));
/** What checkItems says is wrong (errors only) after `change` is made to copies of the catalogue and the shops. */
const errors = (change) => {
  const i = copy(items);
  const s = copy(shops);
  change?.(i, s);
  return checkItems(i, s).errors;
};
const whole = () => errors();
const item = (i, id) => i.items.find((x) => x.id === id);

broken("checkItems", "a shop that sells an item the catalogue does not have", {
  said: /shop 1 of smak_rp_mtest \(marco\): stock names the item pistola_laser, which is not in the catalogue/,
  broken: () => errors((i, s) => s.shops[0].stock.push("pistola_laser")),
  whole,
});
broken("checkItems", "an item id used twice", {
  said: /the item id vendaje is used twice \(items 4 and 42\)/,
  broken: () => errors((i) => i.items.push({ ...item(i, "vendaje") })),
  whole,
});
broken("checkItems", "an item with no name", {
  said: /item 7 \(chatarra\) has no name/,
  broken: () => errors((i) => delete item(i, "chatarra").name),
  whole,
});
broken("checkItems", "a negative price", {
  said: /item 8 \(glock18\) has a negative price \(-5\)/,
  broken: () => errors((i) => (item(i, "glock18").price = -5)),
  whole,
});
broken("checkItems", "an item a shop sells for less than a shop buys it back for", {
  said: /botiquin is sold for 45 in shop marco and bought back for 50 in shop marco: buying and selling again makes 5 each round/,
  broken: () => errors((i) => (item(i, "botiquin").sell = 50)),
  whole,
});
broken("checkItems", "the same trap between two shops", {
  said: /vendaje is sold for 15 in shop marco and bought back for 20 in shop barato: buying and selling again makes 5 each round/,
  broken: () => errors((i, s) => s.shops.push({ id: "barato", name: "Barato", origin: [0, 0, 0], radius: 100, buys: [{ item: "vendaje", price: 20 }] })),
  whole,
});
broken("checkItems", "two shops with the same id", {
  said: /the shop id marco is used twice on smak_rp_mtest/,
  broken: () => errors((i, s) => s.shops.push({ ...copy(s.shops[0]), stock: [], buys: [] })),
  whole,
});
broken("checkItems", "a shop with no place to stand", {
  said: /shop 1 of smak_rp_mtest \(marco\) has neither an origin with a radius nor an npc to stand near/,
  broken: () => errors((i, s) => { delete s.shops[0].origin; delete s.shops[0].radius; }),
  whole,
});
broken("checkItems", "a consumable that heals nothing", {
  said: /item 5 \(botiquin\) is a consumable with no use: \{ "heal": n \} of more than 0/,
  broken: () => errors((i) => delete item(i, "botiquin").use),
  whole,
});
broken("checkItems", "a weapon with no TS weapon", {
  said: /item 8 \(glock18\) is a weapon with no ts_weapon/,
  broken: () => errors((i) => delete item(i, "glock18").ts_weapon),
  whole,
});
broken("checkItems", "a stack of 0", {
  said: /item 7 \(chatarra\): stack must be a whole number from 1 to 99/,
  broken: () => errors((i) => (item(i, "chatarra").stack = 0)),
  whole,
});
broken("checkItems", "an item listed twice in one stock", {
  said: /shop 1 of smak_rp_mtest \(marco\): stock lists vendaje twice/,
  broken: () => errors((i, s) => s.shops[0].stock.push("vendaje")),
  whole,
});
