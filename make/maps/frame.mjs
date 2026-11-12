// A frame: where a hand-written composition stands in a map. A building, a gate, a stall made in its own
// coordinates (its corner or its middle at [0, 0, 0], its front along +x or wherever the author chose) is
// dropped on a map turned and moved: its brushes (`turned`, exactly, so the pictures turn with their faces and
// the pieces of a form keep sharing their planes), its entities (origin turned and moved, `angles` and `angle` turned) and the
// brushes of its brush entities (a door's leaf and its origin brush).
//
//   const f = frame({ at: [512, -256, 0], yaw: 30 });
//   const { brushes, entities } = f.place({ brushes: shell, entities: [door, lamp] });
//   f.point([64, 0, 32])      → where that point of the composition lands in the map
import { turned, moved } from "./source.mjs";

const tidy = (value) => Math.round(value * 1e6) / 1e6;
const wrap = (degrees) => tidy(((degrees % 360) + 360) % 360);

/**
 * A frame at `at` ([x, y, z], the composition's own origin) turned `yaw` degrees anticlockwise seen from above.
 * `place({ brushes, entities, snap })` returns the same, placed (either may be left out); `snap` is `turned`'s:
 * exact unless given, `snap: 1` rounds the corners to whole units (a lone box; never the pieces of a form, which
 * stop sharing their planes). `point([x, y, z])` is one point of the composition in the map's coordinates;
 * `angle(degrees)` a yaw of the composition in the map's.
 */
export function frame({ at = [0, 0, 0], yaw = 0 } = {}) {
  if (!(Array.isArray(at) && at.length === 3 && at.every(Number.isFinite)))
    throw new Error(`frame: at is [x, y, z], not ${JSON.stringify(at)}`);
  if (!Number.isFinite(yaw)) throw new Error(`frame: yaw is an angle in degrees, not ${yaw}`);
  const radians = (yaw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const point = ([x, y, z]) => [tidy(x * cos - y * sin + at[0]), tidy(x * sin + y * cos + at[1]), tidy(z + at[2])];
  const brushesOf = (list, snap) => (list?.length ? moved(turned(list, yaw, [0, 0, 0], { snap }), at) : []);
  const keysOf = (keys) => {
    const out = { ...keys };
    if (keys.origin !== undefined) {
      const origin = (typeof keys.origin === "string" ? keys.origin.trim().split(/\s+/).map(Number) : keys.origin);
      if (!(origin.length === 3 && origin.every(Number.isFinite))) throw new Error(`frame: an origin is [x, y, z], not ${JSON.stringify(keys.origin)}`);
      const placed = point(origin);
      out.origin = typeof keys.origin === "string" ? placed.join(" ") : placed;
    }
    if (keys.angles !== undefined) {
      const [pitch, turn, roll] = (typeof keys.angles === "string" ? keys.angles.trim().split(/\s+/).map(Number) : keys.angles);
      const angles = [pitch, wrap(turn + yaw), roll];
      out.angles = angles.join(" ");
    }
    // `angle` is a yaw; -1 and -2 (up, down) are directions that stay as they are
    if (keys.angle !== undefined && Number(keys.angle) >= 0) out.angle = String(wrap(Number(keys.angle) + yaw));
    return out;
  };
  return {
    at: [...at],
    yaw,
    point,
    angle: (degrees) => wrap(degrees + yaw),
    place({ brushes = [], entities = [], snap } = {}) {
      return {
        brushes: brushesOf(brushes, snap),
        entities: entities.map(({ brushes: own, ...keys }) => {
          const placed = keysOf(keys);
          return own?.length ? { ...placed, brushes: brushesOf(own, snap) } : placed;
        }),
      };
    },
  };
}
