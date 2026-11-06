// The RP doors check (levels/rp/doors.mjs checkDoors) broken in one way each, and the key rule it leans on in the
// items check (a key item that opens nothing). The byz01 doors file, held against the catalogue and a rp.json made
// from its own ids, is the whole twin.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { checkDoors } from "../../levels/rp/doors.mjs";
import { checkItems } from "../../levels/rp/items.mjs";

const dir = join(HERE, "../levels/rp");
const doors = JSON.parse(readFileSync(join(dir, "doors/smak_rp_byz01.doors.json"), "utf8"));
const items = JSON.parse(readFileSync(join(dir, "items/items.json"), "utf8"));
const rpOf = (d) => ({
  map: "smak_rp_byz01",
  properties: d.properties.map((p) => ({ id: p.id, kind: p.price !== undefined ? "home" : "public", doors: [`smak_rp_byz01_${p.id}`] })),
});
const copy = (o) => JSON.parse(JSON.stringify(o));
/** What checkDoors says (`field`: errors or warnings) after `change(doors, items, rp)` is made to copies. */
const said = (change, field = "errors") => {
  const d = copy(doors);
  const i = copy(items);
  const rp = rpOf(d);
  change?.(d, i, rp);
  return checkDoors(d, { items: i, rp })[field];
};
const whole = () => said();

broken("checkDoors", "a file of another format", {
  said: /the doors file has format "smak-doors\/2", not "smak-doors\/1"/,
  broken: () => said((d) => (d.format = "smak-doors/2")),
  whole,
});
broken("checkDoors", "a negative price", {
  said: /property 1 \(m1_flat2\): price -5 is outside 0 to 1000000/,
  broken: () => said((d) => (d.properties[0].price = -5)),
  whole,
});
broken("checkDoors", "a rent for no whole number of days", {
  said: /property 1 \(m1_flat2\): rent_days 0 is outside 1 to 365/,
  broken: () => said((d) => (d.properties[0].rent_days = 0)),
  whole,
});
broken("checkDoors", "a property id used twice", {
  said: /the property id m1_flat2 is used twice/,
  broken: () => said((d) => d.properties.push({ ...d.properties[0] })),
  whole,
});
broken("checkDoors", "a policy that does not exist", {
  said: /property 1 \(m1_flat2\) has policy "locked"; the policies are open, key, guard, gate/,
  broken: () => said((d) => (d.properties[0].policy = "locked")),
  whole,
});
broken("checkDoors", "a property the map's rp.json does not have", {
  said: /property 34 \(m9_flat9\) names a property the map's rp.json does not have: the plugin leaves it out/,
  broken: (() => {
    const d = copy(doors);
    d.properties.push({ id: "m9_flat9", price: 100, rent: 10 });
    return () => checkDoors(d, { items, rp: rpOf(doors) }).errors;
  })(),
  whole,
});
broken("checkDoors", "a property with more doors than the plugin keeps", {
  said: /property m1_flat2 has 9 door leaves; the plugin keeps 8 leaves of a property/,
  broken: () => said((d, i, rp) => (rp.properties[0].doors = ["a", "b", "c", "d", "e", "f", "g", "h", "i"])),
  whole,
});
broken("checkDoors", "one door name the compiled map gives to more leaves than the plugin keeps", {
  said: /property m1_flat2 has 9 door leaves; the plugin keeps 8 leaves of a property and leaves the rest unlocked/,
  broken: () => {
    const d = copy(doors);
    const rp = rpOf(d);
    return checkDoors(d, { items, rp, leaves: { smak_rp_byz01_m1_flat2: 9 } }).errors;
  },
  whole,
});
broken("checkDoors", "a home offered for which no key item exists", {
  said: /property 2 \(m1_flat1\) is offered but no key item opens it: add an item of kind key with "opens": "m1_flat1"/,
  broken: () => said((d, i) => (i.items = i.items.filter((x) => x.opens !== "m1_flat1")), "warnings"),
  whole: () => said(undefined, "warnings"),
});
broken("checkDoors", "buying a home that costs no more than renting it once", {
  said: /property 1 \(m1_flat2\): buying \(100\) costs no more than one rent \(120\): nobody will rent it/,
  broken: () => said((d) => (d.properties[0].price = 100), "warnings"),
  whole: () => said(undefined, "warnings"),
});
broken("checkItems", "a key item that opens nothing", {
  said: /item 3 \(llave_piso_a\) is a key with no valid "opens": the id of the property it opens/,
  broken: () => {
    const i = copy(items);
    delete i.items[2].opens;
    return checkItems(i).errors;
  },
  whole: () => checkItems(items).errors,
});
