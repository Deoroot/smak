// levels/assembly, shells: a building that is its FACADE only. `program: "shell"` in a site's building (default
// `"interior"`: every other program, a building with rooms), so that a city can fill its blocks cheaply in brushes,
// visleafs, faces and edicts: byzantium-02 has some 110 buildings with interiors and some 60 shells.
//
// A shell is laid out as the building it stands for (its `facade` program, "shop-flats" unless told), so that its walls,
// windows, entrance, cornice, roof, balconies, hood and wall lamps are the building's own, at the same places, in the same
// pieces. What is left out is everything behind the wall:
//
//   - no room, no stair, no floor slab, no door between rooms: the footprint is ONE SOLID MASS (a world brush, no
//     entity) that cuts visibility like a block of stone, from the ground to the underside of the roof slab;
//   - a window is a recess in the wall, 8 deep, its back GLASS_DARK (the pane and its func_breakable are gone);
//   - the entrance is a locked door: the door piece's leaf stands shut as world brush (no func_door, no targetname);
//   - the roof is the building's own roof slab; `roof: "walk"` also fences the open edges of the roof with CLIP brushes
//     (the parapet's crown is a func_wall nobody collides with) so that a route may cross the roofs: the top is flat, a
//     solid mass under it with no gap, and a dome on it is refused.
//
// To the RP layer a shell does not exist: its layout in the plan holds no room, door, entrance or stair (`plan.layouts`),
// so no property, home, door entry, place or NPC spot is made for it; `plan.shells` holds the facade for the assembler.
//
//   isShell(b), roofWalks(b)                the description's fields
//   shellProgram(programs)                  the PROGRAMS entry "shell": the facade program's description
//   readShell(b, programs)                  -> failures: the shell's fields, in words
//   shellPlan(layout)                       -> { stub, facade }: what the plan keeps (stub) and the assembler uses (facade)
//   facadeOf(plan, b)                       -> the layout the assembler and the skyline see (the facade of a shell)
//   assembleShell(facade, library, options) -> { brushes, entities, report }: the shell's walls, mass and roof
//   roofRails(b, open, top)                 -> CLIP brushes along the open roof edges of a walkable roof
//   checkShells(plan, contract)             -> { failures, warnings }: no property, home, place, key or stair on a shell
import { box, moved, shapeOf } from "../../src/maps/source.mjs";
import { assemble, rectanglesOf } from "./assemble.mjs";

const GRID = 64;
export const SHELL = "shell";
/** The edge kinds that stay: the building's outside. */
export const FACADE_KINDS = new Set(["exterior", "window", "entrance"]);
/** What `roof` may say. */
export const ROOFS = ["closed", "walk"];
/** A window's back: dark, 8 behind the wall's face. */
export const FAKE = { window: "GLASS_DARK" };
/** The rail of a walkable roof, high over the roof (a jump of 45 cannot clear it), and how far past the edge line outwards it stands. */
export const ROOF_RAIL = { height: 64, out: 10, in: 4 };
/** The brush entities that are a working part of a building: a shell has the brushes of them, as world, and not the entity. */
/** A locked door's leaf stands this far back from where the real leaf hangs, out of the mass behind it (units, towards the street). */
export const DOOR_SET_BACK = 12;
const WORKING = new Set(["func_door_rotating", "func_door", "func_breakable", "func_button", "func_ladder"]);

export const isShell = (b) => b?.program === SHELL;
export const roofWalks = (b) => isShell(b) && b.roof === "walk";

/** The PROGRAMS entry: the description of the program whose facade the shell wears (`facade`, "shop-flats" unless told). */
export const shellProgram = (programs) => (b, w, h, style) => programs[b.facade ?? "shop-flats"](b, w, h, style);

/** The shell's own fields, checked: sentences. */
export function readShell(b, programs) {
  const out = [];
  if (b.program !== SHELL) {
    if (b.roof !== undefined) out.push(`building ${b.id}: roof is ${JSON.stringify(b.roof)}; only a shell (program "shell") has a roof setting`);
    return out;
  }
  if (b.roof !== undefined && !ROOFS.includes(b.roof)) out.push(`building ${b.id}: roof is ${JSON.stringify(b.roof)}; a shell's roof is ${ROOFS.map((r) => JSON.stringify(r)).join(" or ")}`); // prettier-ignore
  if (b.facade !== undefined && (b.facade === SHELL || !programs[b.facade])) out.push(`building ${b.id}: its facade is ${JSON.stringify(b.facade)}; it wants the name of a program with an interior (${Object.keys(programs).filter((k) => k !== SHELL).join(", ")})`); // prettier-ignore
  if (b.roof === "walk" && b.dome !== undefined) out.push(`building ${b.id}: a dome stands on a roof that is walked; a shell with roof "walk" has none`);
  if (b.tower) out.push(`building ${b.id}: a shell has no tower (sealed storeys over a real building's two)`);
  for (const k of ["property", "home", "key", "places", "npcs"]) if (b[k] !== undefined) out.push(`building ${b.id}: a shell is given a ${k}; a shell holds no property, home, key, place or NPC`); // prettier-ignore
  return out;
}

/**
 * What the plan keeps of a shell's layout. `stub`: the same building with no room, door, entrance, stair or storey plan
 * (what the RP layer, the dressing and the site's checks read: they find nothing in it); `facade`: the layout cut to the
 * building's outside walls, its cells and room kinds left as they were (the pieces pick shopfront or entrance by them).
 */
export function shellPlan(layout) {
  const stub = {
    format: layout.format,
    building: layout.building,
    seed: layout.seed,
    grid: layout.grid,
    storeyHeight: layout.storeyHeight,
    base: layout.base,
    size: layout.size,
    storeys: layout.storeys,
    shell: true,
    rooms: [],
    doors: [],
    entrances: [],
    storeyPlans: [],
    failures: layout.failures ?? [],
    warnings: layout.warnings ?? [],
  };
  const facade = {
    ...layout,
    shell: true,
    stairwell: null,
    rooms: [], // (no room, so no lamp; the kinds stay, for the pieces that go by them)
    roomKinds: Object.fromEntries(layout.rooms.map((r) => [r.id, r.kind])),
    doors: [],
    storeyPlans: layout.storeyPlans.map((p) => ({ ...p, edges: p.edges.filter((e) => FACADE_KINDS.has(e.kind)) })),
    failures: [],
    warnings: [],
  };
  return { stub, facade };
}

/** The layout the assembler and the skyline read for building b: a shell's facade, else the plan's layout. */
export const facadeOf = (plan, b) => plan.shells?.get(b.id) ?? plan.layouts.get(b.id);

/**
 * A door leaf of a shell, back out of the mass: the real leaf hangs just inside the wall's inner face, where the mass is
 * solid; the locked one stands DOOR_SET_BACK towards the street, along its doorway's way in.
 */
function setBack(brush, doorways) {
  const { min, max } = shapeOf(brush);
  const at = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const near = doorways.reduce((a, d) => (!a || Math.hypot(d.middle[0] - at[0], d.middle[1] - at[1]) < Math.hypot(a.middle[0] - at[0], a.middle[1] - at[1]) ? d : a), null); // prettier-ignore
  if (!near?.into) return [brush];
  return moved([brush], [-near.into[0] * DOOR_SET_BACK, -near.into[1] * DOOR_SET_BACK, 0]);
}

const dark = (brush, texture) => ({ ...brush, faces: brush.faces.map((f) => ({ ...f, texture })) });

/**
 * The shell as brushes: the building's walls (assemble.mjs on the facade: no floors, no lamps), its windows and door made
 * solid, and the mass behind them. `options` are assemble's own (edgeKind, floorKind, swap, mergeWalls, ...). The result
 * has the working parts of the pieces turned to world brush: a window's pane GLASS_DARK, a door's leaf as it stands
 * shut. `report.doorways` are the entrances (their place, for the hood), with no targetname.
 */
export function assembleShell(facade, library, options = {}) {
  const base = facade.base ?? [0, 0, 0];
  const [W, D] = facade.size;
  const H = facade.storeyHeight ?? 192;
  const everyCell = new Set();
  for (let s = 0; s < facade.storeys; s++) for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) everyCell.add(`${s}:${i},${j}`);
  const built = assemble(facade, library, {
    ...options,
    site: false,
    holes: everyCell,
    light: {},
    doorName: () => null,
    doorKeys: () => null,
    doorSwap: () => null,
    lampName: () => null,
  });
  const world = [...built.map.brushes];
  const entities = [];
  let doors = 0;
  let panes = 0;
  for (const e of built.map.entities) {
    if (WORKING.has(e.classname)) {
      const glass = e.classname === "func_breakable";
      for (const br of e.brushes ?? []) {
        if (br.faces.some((f) => /^ORIGIN$/i.test(f.texture))) continue;
        if (glass) world.push(dark(br, FAKE.window));
        else world.push(...setBack(br, built.report.doorways));
      }
      if (glass) panes++;
      else doors++;
    } else if (/^(light|info_|env_|ambient)/.test(e.classname)) continue; // a lamp's own light: a shell has no room to light
    else entities.push(e);
  }
  // the mass: every cell of the footprint, the ground to the roof's underside, to the wall's centre line (a window's hole
  // is the wall's outer half: a recess 8 deep, its back this)
  const cells = new Set();
  const plan = facade.storeyPlans.at(-1);
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if ((plan?.cells[j]?.[i] ?? null) !== null) cells.add(`${i},${j}`);
  const z0 = base[2] - 16;
  const z1 = base[2] + facade.storeys * H - 16;
  const swap = options.swap ?? null;
  const t = (n) => swap?.[n] ?? n;
  const wall = t("sinmarblewall");
  let mass = 0;
  for (const [i, j, rw, rh] of rectanglesOf(cells)) {
    world.push(box([base[0] + i * GRID, base[1] + j * GRID, z0], [base[0] + (i + rw) * GRID, base[1] + (j + rh) * GRID, z1], { sides: FAKE.window, top: wall, bottom: wall })); // prettier-ignore
    mass++;
  }
  return {
    brushes: world,
    entities,
    report: { failures: built.report.failures, warnings: built.report.warnings, doorways: built.report.doorways, counts: { ...built.report.counts, shellDoors: doors, shellWindows: panes, shellMass: mass } },
  };
}

/** CLIP brushes along the open edges of a walkable roof (`open`: per side, the edge indices with open sky outside), at roof height `top`. */
export function roofRails(b, open, top) {
  const [x0, y0] = [b.at[0] * GRID, b.at[1] * GRID];
  const [w, h] = [b.size[0] * GRID, b.size[1] * GRID];
  const { height, out, in: inn } = ROOF_RAIL;
  const rails = [];
  const runs = (set) => {
    const list = [...set].sort((a, c) => a - c);
    const r = [];
    for (const i of list) (r.at(-1)?.at(-1) === i - 1 ? r.at(-1).push(i) : r.push([i]));
    return r.map((run) => [run[0] * GRID, (run.at(-1) + 1) * GRID]);
  };
  const clip = (lo, hi) => box(lo, hi, "CLIP");
  for (const [a, c] of runs(open.south)) rails.push(clip([x0 + a, y0 - out, top], [x0 + c, y0 + inn, top + height]));
  for (const [a, c] of runs(open.north)) rails.push(clip([x0 + a, y0 + h - inn, top], [x0 + c, y0 + h + out, top + height]));
  for (const [a, c] of runs(open.west)) rails.push(clip([x0 - out, y0 + a, top], [x0 + inn, y0 + c, top + height]));
  for (const [a, c] of runs(open.east)) rails.push(clip([x0 + w - inn, y0 + a, top], [x0 + w + out, y0 + c, top + height]));
  return rails;
}

/**
 * A shell holds no property, home, door entry, place or NPC spot. Checked against the plan (its layout has no room) and,
 * when given, the RP contract and the built doorways: any property, place or door that names a shell is a failure.
 */
export function checkShells(plan, contract = null) {
  const failures = [];
  const warnings = [];
  const shells = new Set(plan.site.buildings.filter(isShell).map((b) => b.id));
  if (!shells.size) return { failures, warnings, measures: { shells: 0 } };
  for (const id of shells) {
    const l = plan.layouts.get(id);
    if (l && (l.rooms?.length || l.doors?.length || l.entrances?.length || l.storeyPlans?.length || l.stairwell))
      failures.push(`building ${id}: a shell has rooms, doors or a stair in the plan (${l.rooms?.length ?? 0} rooms); a shell is a facade and holds none`);
    if (!plan.shells?.has(id)) failures.push(`building ${id}: a shell has no facade in the plan; it cannot be built`);
  }
  for (const w of plan.below?.ways ?? []) if (shells.has(w.building)) failures.push(`building ${w.building}: the level below opens a ${w.kind} into a shell; a shell has no floor to cut`);
  for (const a of plan.site.arenas ?? []) if (shells.has(a.building)) failures.push(`building ${a.building}: an arena is set in a shell; a shell has no room`);
  if (contract) {
    for (const p of contract.properties ?? []) if (shells.has(p.building)) failures.push(`building ${p.building}: the RP contract gives a shell the property ${p.id}; a shell holds no property`);
    for (const p of contract.places ?? []) if (shells.has(p.building)) failures.push(`building ${p.building}: the RP contract gives a shell the place ${p.id}; a shell holds no place or NPC`);
    for (const n of contract.paths?.nodes ?? []) if (shells.has(n.building) && n.kind !== "roof") failures.push(`building ${n.building}: the walking graph has a ${n.kind} node (${n.id}) in a shell; a shell has no inside to walk`);
  }
  return { failures, warnings, measures: { shells: shells.size } };
}
