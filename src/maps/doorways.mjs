// Room before a door: whether a standing player fits on each side of every door of a map, just past its leaf and a
// step further on. A prop set down before a door (a bench, a crate, a plant with its clip) shuts it as surely as a
// wall, and a walk test that starts on one side never asks of the other: this asks of both. It reads brush source
// and compiled maps alike, through space.mjs, where a compiled map's own clip hull is asked, so a prop's CLIP brush
// counts as the game counts it.
//
// HOW. A door's box (its leaf where it stands shut) lies thin across one of x and y: that is the way through, and the
// other is its width. A door thin across z (a hatch, a lift) is passed over. Along its width, every 8 units with
// room for the body, the body's feet are set at the door's foot on each side, just clear of the leaf (half the leaf,
// the body's half and 2), and again a step of 32 further on. A side has room when at one place along the width the
// body fits at both, on a floor no more than a step (18) under it or over it. Doors are taken as open (their leaves
// stop nothing), so the leaf of the door itself, and of its twin in a double door, is not in the way.
//
// PROPS. A prop (a point entity with a model) stops nothing in the hull unless a CLIP brush was laid with it; the game
// may still make it solid, and a player sees a bench before a door as a door shut either way. `props` (`propsOf`'s,
// or any list of boxes `{ min, max }`) are counted as solid where their boxes stand, and the sentence names them.
//
// WHAT IT IS WORTH. Geometry only, as the walk test is: a side said to have room has room for the box of a player;
// one said to have none may be a door that only shows a face (a door painted on a wall, a door to the void left on
// purpose), which the sentence names so the person can say which it is.
import { spaceOf, restOf, bodyOf } from "./space.mjs";

/** How far past the leaf, besides half the leaf and the body's half, the first place is; and the step to the next. */
const CLEAR = 2;
const STEP = 32;
/** The most a floor before a door may lie under or over its foot: a step the engine walks up (`sv_stepsize`). */
const STEP_UP = 18;
/** How far apart the places along a door's width are. */
const ALONG = 8;
/** The names of the four sides, by the axis across the door and its sign. */
const SIDES = { "0,-1": "west", "0,1": "east", "1,-1": "south", "1,1": "north" };

/** The first of the props whose box a body with its feet at (x, y, z) is in, or null. */
const propAt = (props, x, y, z, body) =>
  props.find(
    (p) =>
      p.min[0] < x + body.half && p.max[0] > x - body.half &&
      p.min[1] < y + body.half && p.max[1] > y - body.half &&
      p.min[2] < z + body.height && p.max[2] > z + 1,
  ) ?? null;

/**
 * Whether a body stands at (x, y) by the height z: on a floor no more than a step under it or over it, clear of
 * every prop. True, or what stops it: a prop, or "solid".
 */
function standsAt(space, props, x, y, z, body) {
  const prop = propAt(props, x, y, z, body);
  if (prop) return prop;
  const rest = restOf(space, [x, y, z + 1], body);
  if (rest.fits) return (rest.floor !== null && rest.hang <= STEP_UP) || "solid";
  // a floor a step up before the door: stood on, when its top is within the step and the body fits over it
  return (rest.stretch[1] - z <= STEP_UP && restOf(space, [x, y, rest.stretch[1]], body).fits) || "solid";
}

/** A prop as a sentence names it: its model's file, or its class, and its number. */
const propName = (p) => [p.number !== undefined ? `${p.number}` : null, p.file ?? p.model ?? p.classname ?? "a prop"].filter(Boolean).join(" "); // prettier-ignore

/**
 * Whether a player has room to stand before each door of a map, on both its sides: `{ doors, warnings }`.
 *
 *   body   the body that goes through (the standing player unless told: one of `BODIES` or its name)
 *   mod    a mod's profile: its own classes of door, taken with the engine's
 *   props  boxes `{ min, max }` counted as solid besides the map's (`propsOf(map).props`: a prop with no CLIP)
 *
 * `doors`: `[{ number, classname, targetname, at, width, across, sides: [{ side, room, prop }] }]`, `across` the axis
 * the way through runs along ("x" or "y"), `at` the middle of the door's foot; a door thin across z is not
 * listed; `prop` is the prop that stops a side with no room, where one does. `warnings`: one sentence for the doors with a side that has no room, naming each and its side.
 */
export function doorClearance(map, { body = "standing", mod, props = [] } = {}) {
  body = bodyOf(body, "doorClearance");
  const space = spaceOf(map, { doors: "open", ...(mod ? { mod } : {}) });
  const doors = [];
  for (const door of space.doors) {
    const size = [0, 1, 2].map((k) => door.max[k] - door.min[k]);
    if (size[2] <= Math.min(size[0], size[1])) continue;
    const across = size[0] <= size[1] ? 0 : 1;
    const wide = 1 - across;
    const middle = [0, 1].map((k) => (door.min[k] + door.max[k]) / 2);
    const foot = door.min[2];
    const places = [];
    for (let a = door.min[wide] + body.half; a <= door.max[wide] - body.half + 0.5; a += ALONG) places.push(a);
    if (!places.length) places.push(middle[wide]);
    const sides = [-1, 1].map((sign) => {
      const near = size[across] / 2 + body.half + CLEAR;
      let prop = null;
      const room = places.some((a) =>
        [near, near + STEP].every((d) => {
          const p = [];
          p[across] = middle[across] + sign * d;
          p[wide] = a;
          const stands = standsAt(space, props, p[0], p[1], foot, body);
          if (stands !== true && stands !== "solid") prop ??= stands;
          return stands === true;
        }),
      );
      return { side: SIDES[`${across},${sign}`], room, prop: room ? null : prop };
    });
    doors.push({
      number: door.number,
      classname: door.classname,
      targetname: door.targetname ?? null,
      at: [...middle, foot].map(Math.round),
      width: size[wide],
      across: "xy"[across],
      sides,
    });
  }
  const shut = doors.filter((d) => d.sides.some((s) => !s.room));
  const warnings = shut.length
    ? [
        `${shut.length} of ${doors.length} doors have no room for ${body.words ?? body.name} before them on a side: ${shut
          .map(
            (d) =>
              `${d.number} ${d.classname}${d.targetname ? ` "${d.targetname}"` : ""} at ${d.at.join(" ")}, its ${d.sides
                .filter((s) => !s.room)
                .map((s) => (s.prop ? `${s.side} (${propName(s.prop)} there)` : s.side))
                .join(" and ")} side`,
          )
          .join("; ")} (something solid stands there, or the door only shows a face)`,
      ]
    : [];
  return { doors, warnings };
}

/** How far before a door its views are taken from, at the most; and the eye's height over the feet (the engine's
 * view offset, 28 over the middle of a standing body 72 high). */
const VIEW_BACK = 128;
const EYE = 64;

/**
 * Where to look at each door from: on each side of it, back from it by `back` (128: a bench or a plant before the
 * door in the picture with it) or nearer where a wall is closer, at a standing player's eye, looking at the door's
 * middle, from where the door is seen (not from the next room, behind a wall). `[{ from, to, name }]`, what `viewsOf` takes as `at`, named by the door's number, its name and its side.
 * A side with no place to stand within `back` is looked at from there all the same, at the eye, where that is open
 * (`no place to stand` in its name); one with no open air there has no view. `doors` limits it to those numbers or names.
 */
export function doorViews(map, { back = VIEW_BACK, body = "standing", mod, doors: only } = {}) {
  body = bodyOf(body, "doorViews");
  const space = spaceOf(map, { doors: "open", ...(mod ? { mod } : {}) });
  const { doors } = doorClearance(map, { body, mod });
  const wanted = only ? new Set([only].flat().map(String)) : null;
  const stands = [];
  for (const door of doors) {
    if (wanted && !wanted.has(String(door.number)) && !wanted.has(String(door.targetname))) continue;
    const across = door.across === "x" ? 0 : 1;
    for (const side of door.sides) {
      const sign = side.side === "east" || side.side === "north" ? 1 : -1;
      const name = `door ${door.number}${door.targetname ? ` ${door.targetname}` : ""} from ${side.side}`;
      const to = [door.at[0], door.at[1], door.at[2] + EYE - 16];
      const at = (d) => {
        const from = [...door.at];
        from[across] += sign * d;
        from[2] += EYE;
        return from;
      };
      let stand = null;
      for (let d = back; d >= 32 && !stand; d -= 16) {
        const from = at(d);
        // a place to stand that sees the door: not one in the next room, behind a wall
        if (restOf(space, [from[0], from[1], door.at[2] + 1], body).fits && space.sees(from, at(1))) stand = { from, to, name };
      }
      // no place to stand on that side (something solid before the door, which is what is to be seen): the eye alone,
      // where it is in the open
      if (!stand) {
        for (let d = back; d >= 32 && !stand; d -= 16) {
          const from = at(d);
          if (restOf(space, from, "point").fits && space.sees(from, at(1))) stand = { from, to, name: `${name}, no place to stand` };
        }
      }
      if (stand) stands.push(stand);
    }
  }
  return stands;
}
