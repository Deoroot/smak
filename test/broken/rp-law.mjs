// The RP law check (levels/rp/law.mjs checkLaw) broken in one way each. The mtest police station is the whole twin.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { checkLaw } from "../../levels/rp/law.mjs";

const law = JSON.parse(readFileSync(join(HERE, "../levels/rp/law/smak_rp_mtest.law.json"), "utf8"));
const copy = (o) => JSON.parse(JSON.stringify(o));
/** What checkLaw says is wrong (errors only) after `change` is made to a copy of the file. */
const errors = (change) => {
  const l = copy(law);
  change?.(l);
  return checkLaw(l).errors;
};
const whole = () => errors();

broken("checkLaw", "a file of another format", {
  said: /the law file has format "smak-law\/2", not "smak-law\/1"/,
  broken: () => errors((l) => (l.format = "smak-law/2")),
  whole,
});
broken("checkLaw", "a station with no radius", {
  said: /station 1 \(comisaria\): it needs a radius of more than 0/,
  broken: () => errors((l) => delete l.stations[0].radius),
  whole,
});
broken("checkLaw", "a station with a bad origin", {
  said: /station 1 \(comisaria\): origin must be \[x, y, z\]/,
  broken: () => errors((l) => (l.stations[0].origin = [1, 2])),
  whole,
});
broken("checkLaw", "a station id used twice", {
  said: /the station id comisaria is used twice/,
  broken: () => errors((l) => l.stations.push(copy(l.stations[0]))),
  whole,
});
broken("checkLaw", "more stations than the plugin keeps", {
  said: /smak_rp_mtest has 13 stations; the plugin keeps 12/,
  broken: () => errors((l) => { l.stations = Array.from({ length: 13 }, (_, i) => ({ ...copy(l.stations[0]), id: `s${i}` })); }),
  whole,
});
broken("checkLaw", "a file with no stations list", {
  said: /the law file has no `stations` list/,
  broken: () => errors((l) => delete l.stations),
  whole,
});
