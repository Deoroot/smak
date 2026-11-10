// How well lit a compiled map's FLOORS are, room by room, from the light its compiler baked: no picture, no
// game. It is the floor that tells whether a place plays dark. A view's mean brightness says how bright the
// walls, the ceiling and the floor of one picture are together, and a lamp high on a wall makes a bright
// picture of a room whose floor is black; and the game lights everything that stands in a room (a monster,
// a chest, the player's own hands) by the light of the floor under it (the engine's R_LightPoint walks
// down from the thing to the first lit face), so a dark floor is a room of dark things.
//
// WHAT THE NUMBERS ARE. A sample is the byte hlrad stored, 0 to 255 a colour, the styles that are on when
// the map starts added up (0, the flickers 1 to 31, and the switched lights not made to start dark: see
// `stylesAtStart`); a floor's light here is the mean of its samples'
// brightness (0.3 r + 0.59 g + 0.11 b). The game shows more than the bytes: Xash's GL renderer with its
// defaults (gl_overbright 1; gamma, lightgamma 2.5, brightness 0: the engine's client/gamma.c makes a table
// that is then a straight line) draws texture x sample x 2 / 255, cut off at white, and lifts the texture a
// little by its texgamma; this kit's views use texture x sample x 1.55 / 255, fitted to screenshots of the
// browser build. So a floor whose samples average 24 shows its texture at about a fifth of its colour in
// the game: on a mid-grey stone that is some 25 of 255, where shapes are still made out and little else.
// That is DARK_FLOOR, this kit's own line and no engine's; a map may mean a room to be darker.
//
// A DRAFT'S LIGHT IS NOT THE MAP'S. hlrad with `-fast` (compileMap's `fast: true`) bounces no light: a
// surface no lamp sees directly stays black, where the full compile fills it from the walls about it. A
// report of a fast compile says how the DRAFT is lit, and is darker than the map will be.
import { modelFaces, faceLightmap, facePolygon, faceNormal, LUXEL } from "../../core/maps/bsp.mjs";
import { valueOf } from "../../core/maps/entities.mjs";

/** A floor whose samples average under this (of 255) is said to be dark: see above. */
export const DARK_FLOOR = 24;
/**
 * A room whose floor has under this share of the light of the map's middling room is said to be dim beside
 * the rest, whatever its own number: the eye settles to the rooms it came through, and the one that has
 * half their light is the one that plays dark. Measured on one map: a round tomb lit by one lamp under its
 * roof had 70 on its floor where the middling room had 132 (a share of 0.53), was called dark by those who
 * played it, and was not once it had four more lamps (145). Asked only of maps of three rooms or more.
 */
const DIM_SHARE = 0.6;
const DIM_ROOMS_LEAST = 3;
/** A face that looks this much upwards is a floor (the z of its normal): a slope a player stands on. */
const FLOOR_LEAST = 0.7;
/** The styles that are on by themselves: 0, and the game's own flickers. From 32 up a switch turns them on. */
export const SWITCHED_FROM = 32;
/**
 * The classes that own a switched style, and the flag that makes one start dark. The SDK's dlls/lights.cpp,
 * CLight::Spawn (light, light_spot, light_environment are all CLight): a light whose style is 32 or more
 * sets that style "a" (off) when its spawnflags have SF_LIGHT_START_OFF (1), and its pattern, or "m" (on),
 * when not. hlcsg gives every light that has a targetname a style of 32 or more (one a name) and writes it
 * into the entity's `style`. A style no entity sets is drawn on by the engine (an empty lightstyle is 256).
 * So a switched light is ON when the map starts unless it was made to start dark: in a role-play city,
 * where nearly every room's lamp has a switch, they are nearly all on.
 */
const LIGHT_CLASSES = ["light", "light_spot", "light_environment"];
const START_OFF = 1;
/** How the switched styles are counted: as the map starts, all off, or all on. */
export const SWITCHED = ["start", "off", "on"];
/** The grid a map with no rooms named is looked over on, in units, and how far apart in height two cells
 *  of one patch may be (a stair's steps are one place). */
const CELL = 128;
const SAME_STOREY = 72;
/** A sample is counted when its place is this near its face at the most (units): the patch of a lightmap
 *  runs a sample past its face on every side. */
const NEAR_FACE = 4;
/** A dark patch smaller than this many cells is not listed (a corner behind a pillar). */
const PATCH_LEAST = 2;
/** How many of one list a sentence names before it counts the rest. */
const LISTED = 12;

const some = (list, most = LISTED) =>
  `${list.slice(0, most).join("; ")}${list.length > most ? `; and ${list.length - most} more` : ""}`;
const brightnessOf = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const place = (point) => point.map((value) => Math.round(value)).join(" ");

/** The 3 by 3 inverse of three rows, or null when they have none. */
function inverse3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/** Whether a point of a face's plane is inside the face, or within `slack` of its edge. */
function insideFace(polygon, normal, point, slack) {
  for (let nth = 0; nth < polygon.length; nth++) {
    const from = polygon[nth];
    const to = polygon[(nth + 1) % polygon.length];
    const edge = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(...edge) || 1;
    // the way into the face from this edge: the edge turned about the face's normal (the corners go
    // clockwise seen from the front)
    const inwards = [
      (edge[1] * normal[2] - edge[2] * normal[1]) / length,
      (edge[2] * normal[0] - edge[0] * normal[2]) / length,
      (edge[0] * normal[1] - edge[1] * normal[0]) / length,
    ];
    const off =
      (point[0] - from[0]) * inwards[0] + (point[1] - from[1]) * inwards[1] + (point[2] - from[2]) * inwards[2];
    if (off < -slack) return false;
  }
  return true;
}

/**
 * The light styles on when the map starts, from its light entities (above):
 * `{ on(style), dark: [styles that start dark], switched: [every style of 32 or more the lights name] }`.
 */
export function stylesAtStart(bsp) {
  const flags = new Map();
  for (const entity of bsp.entities ?? []) {
    if (!LIGHT_CLASSES.includes(valueOf(entity, "classname"))) continue;
    const style = Number.parseInt(valueOf(entity, "style") ?? "", 10);
    if (!(style >= SWITCHED_FROM)) continue;
    const startsOff = (Number.parseInt(valueOf(entity, "spawnflags") ?? "0", 10) & START_OFF) !== 0;
    // the last light to spawn sets the style; a style is told dark only when every light of it starts dark
    flags.set(style, (flags.get(style) ?? true) && startsOff);
  }
  const dark = [...flags].filter(([, off]) => off).map(([style]) => style).sort((a, b) => a - b);
  const off = new Set(dark);
  return { on: (style) => !off.has(style), dark, switched: [...flags.keys()].sort((a, b) => a - b) };
}

/**
 * The patterns the game gives the styles under 32 as a map starts (the SDK's dlls/world.cpp, W_Precache; TS's the
 * same): a letter a tenth of a second, "a" dark, "m" the light as baked, "z" twice it nearly. A style none sets
 * is drawn as baked.
 */
export const GOLDSRC_STYLES = new Map([
  [0, "m"],
  [1, "mmnmmommommnonmmonqnmmo"],
  [2, "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba"],
  [3, "mmmmmaaaaammmmmaaaaaabcdefgabcdefg"],
  [4, "mamamamamama"],
  [5, "jklmnopqrstuvwxyzyxwvutsrqponmlkj"],
  [6, "nmonqnmomnmomomno"],
  [7, "mmmaaaabcdefgmmmmaaaammmaamm"],
  [8, "mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa"],
  [9, "aaaaaaaazzzzzzzz"],
  [10, "mmamammmmammamamaaamammma"],
  [11, "abcdefghijklmnopqrrqponmlkjihgfedcba"],
  [12, "mmnnmmnnnmmnn"],
  [63, "a"],
]);
/**
 * Each style's pattern as the map starts (`GOLDSRC_STYLES`, and a switched light's as CLight::Spawn sets it: "a"
 * when every light of the style starts dark, else its `pattern`, or "m"): a Map of style to pattern; a style not
 * in it is drawn as baked ("m").
 */
export function stylePatterns(bsp) {
  const patterns = new Map(GOLDSRC_STYLES);
  const start = stylesAtStart(bsp);
  for (const entity of bsp.entities ?? []) {
    if (!LIGHT_CLASSES.includes(valueOf(entity, "classname"))) continue;
    const style = Number.parseInt(valueOf(entity, "style") ?? "", 10);
    if (!(style >= SWITCHED_FROM)) continue;
    const startsOff = (Number.parseInt(valueOf(entity, "spawnflags") ?? "0", 10) & START_OFF) !== 0;
    if (!start.on(style)) patterns.set(style, "a");
    else if (!startsOff) patterns.set(style, valueOf(entity, "pattern") || "m");
  }
  return patterns;
}
/** Which styles a count adds up, by `switched` (`SWITCHED`): a test of a style. */
export function stylesCounted(bsp, switched = "start") {
  if (!SWITCHED.includes(switched))
    throw new Error(`switched: ${SWITCHED.join(", ")}, not ${JSON.stringify(switched)}`);
  if (switched === "on") return () => true;
  if (switched === "off") return (style) => style < SWITCHED_FROM;
  const start = stylesAtStart(bsp);
  return (style) => style < SWITCHED_FROM || start.on(style);
}

/**
 * The samples of the world's floors, each where it is: `each(point, brightness, area)` is called with the
 * sample's place in the map, its brightness 0 to 255 and the square units of floor it stands for. `counted`
 * says which styles are added up (`stylesCounted`).
 */
export function floorSamples(bsp, each, counted) {
  for (const face of modelFaces(bsp, 0)) {
    const normal = faceNormal(bsp, face);
    if (normal[2] < FLOOR_LEAST) continue;
    const light = faceLightmap(bsp, face);
    if (!light) continue;
    const on = light.styles.filter((style) => counted(style.style));
    if (!on.length) continue;
    const texinfo = bsp.texinfo[face.texinfo];
    const plane = bsp.planes[face.plane];
    // a sample is at a pixel (s, t) of the texture, on the face's plane: three planes meet at its place
    const back = inverse3([texinfo.s.slice(0, 3), texinfo.t.slice(0, 3), plane.normal]);
    if (!back) continue;
    const at = (s, t) => {
      const want = [s - texinfo.s[3], t - texinfo.t[3], plane.dist];
      return back.map((row) => row[0] * want[0] + row[1] * want[1] + row[2] * want[2]);
    };
    // the floor one sample stands for: a step along s and one along t, as they lie on the face
    const origin = at(0, 0);
    const alongS = at(LUXEL, 0).map((value, axis) => value - origin[axis]);
    const alongT = at(0, LUXEL).map((value, axis) => value - origin[axis]);
    const area = Math.hypot(
      alongS[1] * alongT[2] - alongS[2] * alongT[1],
      alongS[2] * alongT[0] - alongS[0] * alongT[2],
      alongS[0] * alongT[1] - alongS[1] * alongT[0],
    );
    const polygon = facePolygon(bsp, face);
    for (let down = 0; down < light.height; down++)
      for (let across = 0; across < light.width; across++) {
        const point = at(light.originS + across * LUXEL, light.originT + down * LUXEL);
        if (!insideFace(polygon, normal, point, NEAR_FACE)) continue;
        const sample = (down * light.width + across) * 3;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const style of on) {
          r += style.rgb[sample];
          g += style.rgb[sample + 1];
          b += style.rgb[sample + 2];
        }
        each(point, brightnessOf(Math.min(255, r), Math.min(255, g), Math.min(255, b)), area);
      }
  }
}

/** A running sum of floor: its area, its light, how much of it is dark. */
const tally = () => ({ area: 0, sum: 0, darkArea: 0, least: Infinity, most: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }); // prettier-ignore
function count(into, point, brightness, area, dark) {
  into.area += area;
  into.sum += brightness * area;
  if (brightness < dark) into.darkArea += area;
  into.least = Math.min(into.least, brightness);
  into.most = Math.max(into.most, brightness);
  for (let axis = 0; axis < 3; axis++) {
    into.min[axis] = Math.min(into.min[axis], point[axis]);
    into.max[axis] = Math.max(into.max[axis], point[axis]);
  }
}
const summed = (sum) => ({
  area: Math.round(sum.area),
  mean: sum.area ? Math.round((sum.sum / sum.area) * 10) / 10 : null,
  least: sum.area ? Math.round(sum.least) : null,
  most: sum.area ? Math.round(sum.most) : null,
  darkShare: sum.area ? Math.round((sum.darkArea / sum.area) * 100) / 100 : null,
});

/**
 * The light on a compiled map's floors.
 *   rooms   { name: { min, max } }: the map's rooms as boxes, to be told of one by one (a floor sample is of
 *           the room it is in whose foot is nearest under it; what is in none is counted as "elsewhere").
 *           Unless given, the floor is looked over on a grid and the dark of it gathered into patches
 *   dark    a floor whose samples average under this is dark (24 of 255: `DARK_FLOOR`)
 *   cell    the grid, in units (128)
 *   reach   what `reachOf` gave for the map: only floor a player walks is counted (a roof, a ledge nobody
 *           gets to and the floor under a pillar say nothing of how the map plays)
 *   switched  the lights a switch works: "start" (the default) as they are when the map starts, on unless
 *           made to start dark (`stylesAtStart`); "off" all off; "on" all on
 * Returns {
 *   lit       false for a map with no light data (compiled without hlrad: the game draws it fully bright)
 *   floor     { area, mean, least, most, darkShare }: all of it. `mean` is of the samples as stored, 0 to 255
 *   rooms     [{ name, area, mean, least, most, darkShare, dark, dim, walked }] for the rooms given: `dark` by its
 *             own number, `dim` beside the map's middling room (under 0.6 of its light); with `reach`, `walked` false
 *             for a room with lit floor of which none is walked (said "not walked to", its area 0). A box may be of
 *             any height: a floor is of the box whose foot is nearest under it, then of the smallest
 *   patches   [{ at, min, max, area, mean }] without rooms: the dark places, the largest first, each a
 *             stretch of floor on one storey whose every cell is dark
 *   warnings, facts   sentences
 * }
 * A map's light is what its compile made it: of a draft (`fast`) it is direct light only (see above).
 */
/** A box's volume. */
const volumeOf = ({ min, max }) => (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);

export function lightReport(bsp, { rooms = null, dark = DARK_FLOOR, cell = CELL, reach = null, switched = "start" } = {}) { // prettier-ignore
  if (!bsp?.faces || !bsp.lumps) throw new Error("lightReport: a compiled map, as readBsp gives it");
  const counted = stylesCounted(bsp, switched);
  const warnings = [];
  const facts = [];
  const lit = bsp.lumps.lighting.length > 0;
  if (!lit) {
    facts.push("the map has no light data (compiled without hlrad): the game draws it fully bright");
    return { lit, floor: summed(tally()), rooms: [], patches: [], warnings, facts };
  }
  const all = tally();
  const named = Object.entries(rooms ?? {}).map(([name, box]) => ({ name, box, sum: tally(), unwalked: [] }));
  const elsewhere = tally();
  const cells = new Map();
  // the room of a point: of the boxes round it, the one whose foot is nearest under it (a gallery's floor stands in
  // the box of the portico under it when the boxes are tall, and is the gallery's), then the smallest (a house's
  // floor stands in its yard's box, and is the house's)
  const roomOf = (point) =>
    named
      .filter(({ box }) => point.every((value, axis) => value >= box.min[axis] - 1 && value <= box.max[axis] + 1))
      .reduce((a, b) => (!a || b.box.min[2] > a.box.min[2] || (b.box.min[2] === a.box.min[2] && volumeOf(b.box) < volumeOf(a.box)) ? b : a), null); // prettier-ignore
  floorSamples(bsp, (point, brightness, area) => {
    if (reach && !reach.on(point[0], point[1], point[2] + 1).walked) {
      // a room with lit floor and none of it walked is said to be not walked to, not to have no floor
      if (rooms) roomOf(point)?.unwalked.push(area);
      return;
    }
    count(all, point, brightness, area, dark);
    if (rooms) {
      const room = roomOf(point);
      count(room ? room.sum : elsewhere, point, brightness, area, dark);
      return;
    }
    const key = `${Math.floor(point[0] / cell)} ${Math.floor(point[1] / cell)} ${Math.round(point[2] / SAME_STOREY)}`;
    if (!cells.has(key)) cells.set(key, tally());
    count(cells.get(key), point, brightness, area, dark);
  }, counted);
  const start = stylesAtStart(bsp);
  if (start.switched.length)
    facts.push(
      switched === "start"
        ? `${start.switched.length} switched light styles, counted as the map starts: ${start.switched.length - start.dark.length} on${start.dark.length ? `, ${start.dark.length} made to start dark (${some(start.dark.map(String))})` : ""}`
        : `${start.switched.length} switched light styles, all counted ${switched}`,
    );
  const floor = summed(all);
  facts.push(
    all.area
      ? `the light on the floor${reach ? " a player walks" : ""}: ${floor.mean} of 255 on average over ${floor.area} square units (the samples as the compiler stored them; the game shows about twice that share of a texture's colour), from ${floor.least} to ${floor.most}; ${Math.round(floor.darkShare * 100)} in 100 of it is under ${dark}`
      : "the map's light has no floor in it",
  );

  // the rooms given, each by itself
  const told = named.map(({ name, sum, unwalked }) => ({ name, ...summed(sum), dark: sum.area > 0 && sum.sum / sum.area < dark, dim: false, ...(reach ? { walked: sum.area > 0 || !unwalked.length } : {}) })); // prettier-ignore
  if (rooms) {
    if (elsewhere.area) told.push({ name: "elsewhere", ...summed(elsewhere), dark: elsewhere.sum / elsewhere.area < dark, dim: false }); // prettier-ignore
    // the middling room, and those that have little of its light
    const means = told.filter((room) => room.area && room.name !== "elsewhere").map((room) => room.mean).sort((a, b) => a - b); // prettier-ignore
    const middling = means.length >= DIM_ROOMS_LEAST ? means[Math.floor(means.length / 2)] : null;
    if (middling !== null)
      for (const room of told) room.dim = room.area > 0 && !room.dark && room.name !== "elsewhere" && room.mean < middling * DIM_SHARE; // prettier-ignore
    const dimRooms = told.filter((room) => room.dim);
    if (dimRooms.length)
      warnings.push(
        `${dimRooms.length} rooms are dim beside the rest: their floor has under ${DIM_SHARE} of the light of the map's middling room (${middling}): ${some(dimRooms.map((room) => `${room.name} ${room.mean}`))}. A player comes into them from brighter rooms and finds them dark, whatever a view of their walls says`,
      );
    const lines = told.filter((room) => room.area).map((room) => `${room.name} ${room.mean}${room.darkShare ? ` (${Math.round(room.darkShare * 100)} in 100 under ${dark})` : ""}`); // prettier-ignore
    if (lines.length) facts.push(`by room, the floor's mean: ${some(lines, 40)}`);
    const away = told.filter((room) => room.walked === false).map((room) => room.name);
    if (away.length) facts.push(`not walked to (lit floor, none of it walked, so its light is not measured): ${some(away)}`);
    const empty = told.filter((room) => !room.area && room.walked !== false).map((room) => room.name);
    if (empty.length) facts.push(`no lit floor in: ${some(empty)}`);
    const darkRooms = told.filter((room) => room.dark);
    if (darkRooms.length)
      warnings.push(
        `${darkRooms.length} rooms are dark on the floor (a mean under ${dark} of 255): ${some(darkRooms.map((room) => `${room.name} ${room.mean}`))}. The game lights whatever stands in a room by the floor under it, so a monster there is as dark; a lamp high on a wall brightens a view of the room and not its floor`,
      );
  }

  // or the dark of the floor gathered: cells that are dark and touch, on one storey
  const patches = [];
  if (!rooms) {
    const isDark = (sum) => sum.area > 0 && sum.sum / sum.area < dark;
    const seen = new Set();
    for (const [key, sum] of cells) {
      if (seen.has(key) || !isDark(sum)) continue;
      const patch = tally();
      let size = 0;
      const waiting = [key];
      seen.add(key);
      while (waiting.length) {
        const at = waiting.pop();
        const here = cells.get(at);
        size++;
        patch.area += here.area;
        patch.sum += here.sum;
        for (let axis = 0; axis < 3; axis++) {
          patch.min[axis] = Math.min(patch.min[axis], here.min[axis]);
          patch.max[axis] = Math.max(patch.max[axis], here.max[axis]);
        }
        const [x, y, z] = at.split(" ").map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) // prettier-ignore
          for (const dz of [0, 1, -1]) {
            const next = `${x + dx} ${y + dy} ${z + dz}`;
            if (seen.has(next) || !cells.has(next) || !isDark(cells.get(next))) continue;
            seen.add(next);
            waiting.push(next);
          }
      }
      if (size >= PATCH_LEAST)
        patches.push({
          at: patch.min.map((value, axis) => Math.round((value + patch.max[axis]) / 2)),
          min: patch.min.map(Math.round),
          max: patch.max.map(Math.round),
          area: Math.round(patch.area),
          mean: Math.round((patch.sum / patch.area) * 10) / 10,
        });
    }
    patches.sort((a, b) => b.area - a.area);
    if (patches.length)
      warnings.push(
        `${patches.length} stretches of floor are dark (a mean under ${dark} of 255 over every ${cell} units of them), the largest first: ${some(patches.map((patch) => `about ${place(patch.at)}, ${patch.area} square units from ${place(patch.min)} to ${place(patch.max)}, mean ${patch.mean}`))}. The game lights whatever stands there by the floor under it; name the map's rooms (\`rooms\`) to be told of each`,
      );
    else if (all.area) facts.push(`no stretch of floor of ${PATCH_LEAST} cells of ${cell} units or more is dark`);
  }
  return { lit, floor, rooms: told, patches, warnings, facts };
}
