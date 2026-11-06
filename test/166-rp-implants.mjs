// The RP implants and clinics check (levels/rp/implants.mjs, levels/rp/plugin/smak_implants.sma): the example
// catalogue and the mtest clinic pass with nothing said; the plugin's and the checker's limits, slots and effect
// keys are the same; a refund of more than the price is refused. The failures, one by one, are in
// test/broken/rp-implants.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { checkImplants, LIMITS, SLOTS, EFFECTS } from "../levels/rp/implants.mjs";

const dir = join(HERE, "../levels/rp/implants");
const implants = JSON.parse(readFileSync(join(dir, "implants.json"), "utf8"));
const clinics = JSON.parse(readFileSync(join(dir, "smak_rp_mtest.clinics.json"), "utf8"));
const copy = (o) => JSON.parse(JSON.stringify(o));
const plugin = readFileSync(join(HERE, "../levels/rp/plugin/smak_implants.sma"), "utf8");

test("rp implants: the example catalogue and the mtest clinic pass with no error and no warning", () => {
  const r = checkImplants(implants, clinics);
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  sure(r.facts.some((f) => /^6 implants/.test(f)) && r.facts.some((f) => /smak_rp_mtest: 1 clinics/.test(f)), r.facts.join(" | "));
  sure(SLOTS.every((s) => implants.implants.some((i) => i.slot === s)), "the example has an implant for every slot");
});

test("rp implants: the catalogue alone passes, and clinics come as one file or several", () => {
  sure(checkImplants(implants).errors.length === 0, "the catalogue alone");
  sure(checkImplants(implants, [clinics, { ...copy(clinics), map: "other_map" }]).errors.length === 0, "two files");
});

test("rp implants: no implant refunds more than it costs, so installing and removing never pays", () => {
  sure(implants.implants.every((i) => i.refund <= i.price), "the example refunds at most its price");
});

test("rp implants: the limits, slots and effects the plugin keeps are the checker's", () => {
  const def = (n) => Number(plugin.match(new RegExp(`^#define ${n}[ ]+([0-9]+)`, "m"))?.[1]);
  sure(def("MAX_IMPL") === LIMITS.implants && def("MAX_CLINICS") === LIMITS.clinics, "implants or clinics");
  sure(def("NAME_LEN") === LIMITS.name + 1 && def("ID_LEN") === LIMITS.id + 1, "name or id length");
  sure(def("NSLOT") === SLOTS.length, "slot count");
  const names = plugin.match(/SLOT_NAME\[NSLOT\]\[\] = \{([^}]*)\}/)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
  sure(names.join() === SLOTS.join(), `slot names ${names}`);
  for (const k of Object.keys(EFFECTS)) sure(plugin.includes(`"${k}"`), `the plugin does not read ${k}`);
});
