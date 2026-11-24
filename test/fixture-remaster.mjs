// Two zones on the kit's two rooms (test/fixtures/tworooms.map), as a remaster has them (packs/remaster): the west
// room (x 0 to 192) and the east one (x 224 to 320), each retextured inside its box, the west given a crate and a lamp.
// A zone made broken in one way each for the broken cases.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maps } from "../src/index.mjs";
import { HERE } from "./helper.mjs";

export const TWOROOMS_MAP = join(HERE, "fixtures", "tworooms.map");
export const shipped = () => maps.readMap(readFileSync(TWOROOMS_MAP, "latin1"));

const centre = (brush, k) => { const p = maps.shapeOf(brush).faces[k]?.polygon ?? []; return p.length ? p.reduce((s, q) => s.map((v, i) => v + q[i] / p.length), [0, 0, 0]) : null; }; // prettier-ignore
const within = (point, box) => point && point.every((c, i) => c >= box.min[i] - 0.5 && c <= box.max[i] + 0.5);
/** Every face of the world whose centre is in `box` given `texture`; `all` every face, wherever it is (a fault). */
const retexture = (map, box, texture, all = false) => map.brushes.forEach((b) => b.faces.forEach((f, k) => { if (all || within(centre(b, k), box)) f.texture = texture; })); // prettier-ignore

export const WEST = { min: [-16, -16, -16], max: [192, 464, 144] };
export const EAST = { min: [200, -16, -16], max: [336, 464, 144] };

/** A zone: `fault` "overlap" (its box over the other room), "outside" (retextures every face), "brush" (a crate out of
 * its box), "pushed" (puts its lamp into the map itself), "entity" (a lamp out of its box). */
export function zone(which, fault) {
  const BOX = which === "west" ? (fault === "overlap" ? { ...WEST, max: [260, 464, 144] } : WEST) : EAST;
  return {
    id: which,
    BOX,
    WADS: [],
    apply(map) {
      retexture(map, BOX, which === "west" ? "smakfloor" : "smakwall", fault === "outside");
      if (which !== "west") return {};
      const crate = maps.box(fault === "brush" ? [150, 300, 0] : [40, 300, 0], fault === "brush" ? [250, 340, 40] : [80, 340, 40], "smakwall"); // prettier-ignore
      const lamp = { classname: "light", origin: fault === "entity" ? "280 200 64" : "96 300 64", _light: "255 200 150 120" };
      if (fault === "pushed") map.entities.push(lamp);
      return { brushes: [crate], entities: [{ classname: "func_detail", brushes: [crate] }, ...(fault === "pushed" ? [] : [lamp])] }; // prettier-ignore
    },
  };
}

/** The two zones written as folders with a zone.mjs each, for the command: their paths. */
export function writeZones(folder) {
  const made = [];
  for (const which of ["west", "east"]) {
    mkdirSync(join(folder, which), { recursive: true });
    writeFileSync(join(folder, which, "zone.mjs"), `import { zone } from ${JSON.stringify(new URL("./fixture-remaster.mjs", import.meta.url).href)};\nconst made = zone("${which}");\nexport const { BOX, WADS, apply } = made;\n`); // prettier-ignore
    made.push(join(folder, which));
  }
  return made;
}
