// The RP law check (levels/rp/law.mjs, levels/rp/plugin/smak_law.sma): the mtest police station passes with nothing
// said, the station is inside the test room and clear of the shop, and the plugin's table sizes are the checker's.
// The failures, one by one, are in test/broken/rp-law.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { checkLaw, LIMITS, LAW_FORMAT } from "../levels/rp/law.mjs";

const dir = join(HERE, "../levels/rp");
const law = JSON.parse(readFileSync(join(dir, "law/smak_rp_mtest.law.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(dir, "items/smak_rp_mtest.shops.json"), "utf8"));

test("rp law: the mtest police station passes with no error and no warning", () => {
  const r = checkLaw(law);
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  sure(r.facts.some((f) => /smak_rp_mtest: 1 stations/.test(f)), r.facts.join(" | "));
});

test("rp law: the station is inside the test room and its circle does not touch the shop's", () => {
  const room = { min: [-3072, 0, 0], max: [-2432, 512, 192] }; // levels/rp/test-map.mjs ROOM
  const st = law.stations[0];
  sure(st.origin.every((v, k) => v >= room.min[k] && v <= room.max[k]), `origin ${st.origin} outside the room`);
  const sh = shops.shops[0];
  const d = Math.hypot(...st.origin.map((v, k) => v - sh.origin[k]));
  sure(d > st.radius + sh.radius, `distance ${d.toFixed(0)} <= ${st.radius + sh.radius}`);
});

test("rp law: the limits the plugin keeps are the checker's", () => {
  const src = readFileSync(join(dir, "plugin/smak_law.sma"), "utf8");
  const def = (n) => Number(src.match(new RegExp(`^#define ${n}[ ]+([0-9]+)`, "m"))?.[1]);
  sure(def("MAX_STATIONS") === LIMITS.stations, "stations");
  sure(def("NAME_LEN") === LIMITS.name + 1 && def("ID_LEN") === LIMITS.id + 1, "name or id length");
  sure(src.includes(`#define LAW_FORMAT    "${LAW_FORMAT}"`), "format");
});
