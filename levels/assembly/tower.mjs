// levels/assembly, towers: a building raised over its two real storeys by `tower: n` in the site spec, n more storeys
// that are a SEALED SHELL (one solid mass per storey, its outside the building's own brick and bands). The layout has
// one stair, joining two storeys (building.mjs), so the storeys above them have no way up; a shell gives the skyline
// of a tall slum (Kowloon's) with no room, door, home or key that nothing could reach. What a player (or a guard, a
// drone) sees of them is the outside: the Kowloon facade (kowloon.mjs) dresses each bay of a shell storey with a window
// plate, frames, cages, add-on rooms and the roof's clutter, as it does the real storeys.
//
//   towerOf(b)                -> the extra storeys of a site building (0 when it has none)
//   towerLayout(b, layout)    -> the layout as the facade and the roof see it: `storeys` raised, the storey plans of the
//                                shell copied from the top real storey's outside edges (`shell` marks where they begin)
//   towerBrushes(b, layout, swap) -> the shell's world brushes
import { box } from "../../src/maps/source.mjs";

const GRID = 64;
const STOREY = 192;
const HALF_WALL = 8;
/** The heights, in a storey, where the exterior wall's brick gives way to a band (make-mese.mjs, BANDS). */
const CUTS = [0, 80, 96, 160, 192];
const BAND = [[80, 96], [160, 192]];
/** The most storeys a tower may add. */
export const TOWER_MOST = 6;

/** The extra storeys of a site building. */
export const towerOf = (b) => Math.max(0, Math.min(TOWER_MOST, Math.floor(b?.tower ?? 0)));

/** The layout as the facade and the roof see it. */
export function towerLayout(b, layout) {
  const extra = towerOf(b);
  if (!extra || !layout?.storeyPlans?.length) return layout;
  const real = layout.storeys;
  const top = layout.storeyPlans[real - 1];
  const plans = [...layout.storeyPlans];
  for (let k = 0; k < extra; k++) plans.push({ ...top, storey: real + k, edges: top.edges.filter((e) => (e.rooms ?? []).includes(null)) });
  return { ...layout, storeys: real + extra, shell: real, storeyPlans: plans };
}

/**
 * The shell's brushes: for each storey the footprint's rectangle (out to the wall's outer face), cut at the bands
 * as the exterior wall is; `swap` is the district's texture table (a theme's) applied to the Mese's names.
 */
export function towerBrushes(b, layout, swap = null) {
  const extra = towerOf(b);
  if (!extra) return [];
  const t = (n) => swap?.[n] ?? n;
  const [brick, band, roof] = [t("sinbrickwall"), t("muro7"), t("pkf_concrete5b")];
  const lo = [b.at[0] * GRID - HALF_WALL, b.at[1] * GRID - HALF_WALL];
  const hi = [(b.at[0] + b.size[0]) * GRID + HALF_WALL, (b.at[1] + b.size[1]) * GRID + HALF_WALL];
  const base = layout.base?.[2] ?? 0;
  const out = [];
  for (let k = 0; k < extra; k++) {
    const z0 = base + (layout.storeys + k) * STOREY;
    for (let i = 0; i + 1 < CUTS.length; i++) {
      const inBand = BAND.some(([a, c]) => CUTS[i] >= a && CUTS[i + 1] <= c);
      const last = k === extra - 1 && i + 2 === CUTS.length;
      const face = inBand ? band : brick;
      out.push(box([lo[0], lo[1], z0 + CUTS[i]], [hi[0], hi[1], z0 + CUTS[i + 1]], { sides: face, top: last ? roof : face, bottom: face }));
    }
  }
  return out;
}
