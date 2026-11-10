// levels/assembly, part P: the first library of authored pieces for Half-Life (README.md, "A piece").
//
//   node levels/assembly/pieces/make-hl.mjs                     writes pieces/hl/<id>.map, library.json and lights.rad,
//                                                               and checks every texture against halflife.wad
//   node levels/assembly/pieces/make-hl.mjs --pictures <work>   and puts each piece in a sealed test chamber, compiles
//                                                               it with VHLT in <work>, and draws pieces/hl/pictures/
//                                                               <id>.png and pieces/hl/sheet.png
//   --wad <halflife.wad>  --vhlt <folder>                        where they are (or HL_WAD, VHLT_DIR)
//
// Frames (every piece authored at the origin in its own frame; z = 0 is the floor top of its storey):
//   edge, rail   the edge runs along +x from (0,0) to (64,0); the wall is centred on y = 0 (16 thick, y -8..8).
//                The inside of the building (the room a door opens into) is +y, the left of the edge's run; an
//                exterior piece's outer face (brick) is y = -8. Interior walls stand 0..176; exterior ones 0..192,
//                their top 16 closing the slab's edge on the outside (and the roof's on the top storey)
//   corner       the grid vertex at (0,0): a post 16 x 16, z 0..192, under the joins of the walls (walls run the
//                whole 64 of their edge, so they overlap the post by 8; nothing is left open at any mask)
//   floor        the cell (0,0)..(64,64): its slab z -16..0
//   ceiling      the cell (0,0)..(64,64) of the top storey: the roof slab z 176..192
//   stair        the stairwell (0,0)..(128,256), 2 x 4 cells, the foot at the short end y = 0: flight 1 up +y in
//                x 0..64 from y 64, the landing y 184..256 at z 96, flight 2 up -y in x 68..128 to the upper
//                landing (y 0..64, top z 192, part of the piece); a spine x 64..68 between the flights
//   lamp         ceiling: the cell (0,0)..(64,64) under a ceiling at z 176; wall: on the +y face (y = 8) of an
//                edge as above
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import zlib from "node:zlib";
import { indexed } from "../../../src/image.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  box, prism, wedge, fitted, brushEntity, originBrush, light, textureLights, playerStart, hollow, writeMap, readMap, shapeOf,
} from "../../../src/maps/source.mjs";
import { sconce } from "../../../src/maps/pieces.mjs";
import { loadLibrary, pieceHash, placed, pieceFor, checkTextures, doorwayOf } from "../library.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "hl");
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const WAD = flag("--wad") ?? process.env.HL_WAD ?? null;
const VHLT = flag("--vhlt") ?? process.env.VHLT_DIR ?? null;
/** A place the person gives (a flag or the environment), or the run stops with the sentence that says which. */
const need = (value, what) => value ?? (console.log(`FAIL: ${what} is not given; pass it as a flag or in the environment`), process.exit(1)); // prettier-ignore

// ── the palette: names in halflife.wad, checked below ──
export const PALETTE = {
  wall: "FIFTIES_WALL14A", // plaster, every wall inside
  brick: "FIFTIES_WALL12", // the outer face of an exterior wall
  floor: "FIFTIES_FLR03", // checker tiles, every floor
  ceiling: "FIFTIES_CEIL01", // acoustic tiles, every slab's underside
  roof: "CRETE2_FLR01", // the roof's top
  trim: "FIFTIES_DR1A", // wood strip: jambs, heads, sills, rails
  wood: "FIFTIES_DR1", // plain wood: treads, risers, landing, thresholds
  door: "FIFTIES_DR1K", // a room's door leaf
  entrance: "FIFTIES_DR2", // the front door's leaf
  stone: "CRETE4_STP01", // the entrance's threshold
  glass: "GLASS_BRIGHT", // a window's pane
  lamp: "+0~FIFTS_LGHT4", // the ceiling lamp's panel (a texture light)
  sconce: "+0~FIFTIES_LGT2", // the wall lamp's glass (a texture light)
  metal: "CHROMEBAR", // lamps' metal
};
/** Texture lights: VHLT reads them from an info_texlights entity or from lights.rad (written beside the pieces). */
export const TEXLIGHTS = { "+0~FIFTS_LGHT4": [255, 244, 222, 2200], "+0~FIFTIES_LGT2": [255, 240, 210, 1200] };

const P = PALETTE;
const W = 8; // half a wall
const CLEAR = 176;
const FULL = 192;
const interior = P.wall;
const exterior = { south: P.brick, sides: P.wall };
const leafFit = (name, min, max) => fitted(name, [64, 96], min, max, { whole: true, faces: ["north", "south"], rest: P.trim });

// ── the pieces: each { brushes (world), entities } in its frame ──
const detail = (brushes) => brushEntity("func_detail", brushes);

const LEAF = 4; // a leaf's thickness
/** A wall's textures with one face (`top`, `east`...) wearing another. */
const withFace = (tex, side, name) => (typeof tex === "string" ? { sides: tex, [side]: name } : { ...tex, [side]: name });

/**
 * A door leaf hinged at (hx, hy), its closed box x hx..x1, y hy..hy+4, z z0..z1; it turns +90 (anticlockwise seen
 * from above) into +y. Gives the func_door_rotating and the `open` entry: the hinge, the angle, the closed box and
 * the box the leaf fills when open (the closed one turned about the hinge).
 */
function leaf(hx, hy, x1, z0, z1, name) {
  const min = [hx, hy, z0];
  const max = [x1, hy + LEAF, z1];
  const turn = ([x, y]) => [hx - (y - hy), hy + (x - hx)];
  const a = turn(min);
  const b = turn(max);
  const open = {
    entity: "func_door_rotating",
    hinge: [hx, hy, 0],
    axis: [0, 0, 1],
    angle: 90,
    closed: [min, max],
    box: [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), z0], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), z1]],
  };
  const entity = brushEntity("func_door_rotating", [box(min, max, leafFit(name, min, max)), originBrush([hx, hy, (z0 + z1) / 2], 4)], {
    speed: 100, distance: 90, wait: 4, spawnflags: 16, angles: [0, 0, 0], // 16: one way, +90 (anticlockwise): into +y
  });
  return { entity, open };
}

// A doorway on two edges (README.md, "Units and the grid"): the wall x 0..128 with the opening x 32..96, z 0..112
// cut through it, the middle vertex (64,0) inside the opening; casings on both faces AROUND the opening (none in it);
// the leaf in front of the inside face, against the casings' edge (y 10..14), hinged at the left jamb's line (32, 10):
// open, it stands at x 28..32, y 10..74, beside the opening, and takes nothing from its 64. Its sweep stays at
// y >= 10, in front of the casings (y 8..10) and under the head casing (z 112..), so it reaches its 90.
const DOOR = { x0: 32, x1: 96, head: 112, edges: 2 };
function doorway({ top, wallTex, threshold, leafName, outside }) {
  const { x0, x1, head } = DOOR;
  const brushes = [
    box([0, -W, head], [128, W, top], withFace(wallTex, "bottom", P.trim)),
    box([0, -W, 0], [x0, W, head], withFace(wallTex, "east", P.trim)),
    box([x1, -W, 0], [128, W, head], withFace(wallTex, "west", P.trim)),
    box([x0, -W, -16], [x1, W, 0], threshold),
  ];
  // inside (+y): 4 wide, 2 proud; the hinge side's casing stands clear of the open leaf (x 24..28)
  const casing = [
    box([24, W, 0], [28, W + 2, head + 4], P.trim),
    box([x1, W, 0], [x1 + 4, W + 2, head + 4], P.trim),
    box([24, W, head], [x1 + 4, W + 2, head + 4], P.trim),
    // outside (-y): `outside` deep (2 for a room's door, 4 on the brick), 4 wide (6 on the brick)
    box([x0 - outside.wide, -W - outside.deep, 0], [x0, -W, head + outside.wide], P.trim),
    box([x1, -W - outside.deep, 0], [x1 + outside.wide, -W, head + outside.wide], P.trim),
    box([x0, -W - outside.deep, head], [x1, -W, head + outside.wide], P.trim),
  ];
  const l = leaf(x0, W + 2, x1, 1, head - 1, leafName);
  return { made: { brushes, entities: [detail(casing), l.entity] }, open: l.open };
}

/** A railing from x0 to x1 along y = 0 at z = 0: a handrail 36..40, a bottom rail, balusters every 10 or so; and a CLIP over it. */
function railParts(x0, x1) {
  const parts = [box([x0, -2, 36], [x1, 2, 40], P.trim), box([x0, -2, 0], [x1, 2, 3], P.trim)];
  const n = Math.round((x1 - x0) / 10);
  for (let i = 1; i < n; i++) {
    const x = x0 + Math.round(((x1 - x0) * i) / n);
    parts.push(box([x - 1, -1, 3], [x + 1, 1, 36], P.trim));
  }
  return { detail: parts, clip: box([x0, -2, 40], [x1, 2, 96], "CLIP") };
}

const PIECES = [];
const add = (entry, made) => PIECES.push({ entry, made });
const EDGE_FRAME = "the edge runs along +x from (0,0) to (64,0); the wall is centred on y = 0 (y -8..8); z = 0 is the floor top; the inside (where a door opens to) is +y";
const EXT_FRAME = `${EDGE_FRAME}; the outer face is y = -8 (brick); it stands to z 192, closing the slab's edge outside`;

add({ id: "wall", slot: "edge", kinds: ["interior"], frame: EDGE_FRAME }, { brushes: [box([0, -W, 0], [64, W, CLEAR], interior)], entities: [] });
add({ id: "wall-exterior", slot: "edge", kinds: ["exterior"], frame: EXT_FRAME }, { brushes: [box([0, -W, 0], [64, W, FULL], exterior)], entities: [] });

const DOOR_FRAME = "the two edges run along +x from (0,0) to (128,0), the middle vertex at (64,0) (no post there: the piece covers it); the wall is centred on y = 0 (y -8..8); z = 0 is the floor top; the inside (where the door opens to) is +y";
{
  const d = doorway({ top: CLEAR, wallTex: interior, threshold: { top: P.wood, sides: P.trim }, leafName: P.door, outside: { deep: 2, wide: 4 } });
  add(
    {
      id: "wall-door", slot: "edge", kinds: ["door"], edges: 2, frame: DOOR_FRAME,
      connectors: [{ type: "doorway-64x112", at: [64, 0, 0], facing: [0, 1, 0] }],
      open: d.open,
      notes: "two edges (128): the opening x 32..96, z 0..112 cut through the wall, clear 64 x 112 with the leaf open; its reveals and head's underside in wood trim; casings 4 wide and 2 proud on both faces round the opening (func_detail), none in it (inside, the hinge side's casing at x 24..28, clear of the open leaf); a wood threshold flush with the floor (world, z -16..0: write it after the floor slabs so its top wins); the leaf a func_door_rotating 64 x 4 x 110, in front of the inside face (y 10..14), hinged at (32, 10), opening one way 90 into +y, where it stands at x 28..32, y 10..74 (`open`)",
    },
    d.made,
  );
}
{
  const d = doorway({ top: FULL, wallTex: exterior, threshold: { top: P.stone, sides: P.trim }, leafName: P.entrance, outside: { deep: 4, wide: 6 } });
  add(
    {
      id: "wall-entrance", slot: "edge", kinds: ["entrance"], edges: 2, frame: `${DOOR_FRAME}; the outer face is y = -8 (brick); it stands to z 192, closing the slab's edge outside`,
      connectors: [{ type: "doorway-64x112", at: [64, 0, 0], facing: [0, 1, 0] }],
      open: d.open,
      notes: "the front door, as wall-door on two edges (128) with the opening x 32..96, z 0..112, clear 64 x 112 with the leaf open; outside, casings 6 wide carried 4 out of the brick; inside as wall-door's; a stone threshold flush with the floor; the leaf (y 10..14) hinged at (32, 10), opening one way 90 into the building (+y), where it stands at x 28..32, y 10..74 (`open`)",
    },
    d.made,
  );
}

add(
  {
    id: "wall-window", slot: "edge", kinds: ["window"], frame: EXT_FRAME,
    connectors: [{ type: "window-48x80", at: [32, 0, 40], facing: [0, 1, 0] }],
    glass: { entity: "func_breakable", material: 0, box: [[12, -1, 44], [52, 1, 116]], clear: [[12, 44], [52, 116]] },
    notes: "opening 48 wide, sill at 40, head at 120; jambs, sill and head linings 4 (func_detail): clear 40 x 72 (x 12..52, z 44..116), through which a crouching player (32 x 36) climbs once the glass is broken; an outer sill standing 6 out of the brick; the pane a func_breakable of glass (material 0, health 30) drawn see-through (rendermode 2, renderamt 80). The pane seals nothing: the building stands in a sealed world",
  },
  {
    brushes: [
      box([0, -W, 0], [64, W, 40], exterior),
      box([0, -W, 120], [64, W, FULL], exterior),
      box([0, -W, 40], [8, W, 120], exterior),
      box([56, -W, 40], [64, W, 120], exterior),
    ],
    entities: [
      detail([
        box([8, -W, 40], [12, W, 120], P.trim),
        box([52, -W, 40], [56, W, 120], P.trim),
        box([12, -W, 40], [52, W, 44], P.trim),
        box([12, -W, 116], [52, W, 120], P.trim),
        box([8, -14, 36], [56, -W, 44], P.trim),
      ]),
      brushEntity("func_breakable", [box([12, -1, 44], [52, 1, 116], P.glass)], { material: 0, health: 30, rendermode: 2, renderamt: 80 }),
    ],
  },
);

add({ id: "wall-open", slot: "edge", kinds: ["open"], frame: EDGE_FRAME, notes: "nothing: an edge inside one room" }, null);

{
  const rail = railParts(4, 60);
  add(
    { id: "rail", slot: "rail", kinds: ["rail"], frame: `${EDGE_FRAME}; the void is -y`, notes: "a railing 40 high over a void (func_detail: handrail, bottom rail, balusters 10 apart), and a CLIP from 40 to 96 so it is not jumped over; it runs x 4..60 between the newels of corner-rail (or into a wall's post)" },
    { brushes: [rail.clip], entities: [detail(rail.detail)] },
  );
}

// corners: every mask has the same post; the walls run the whole edge and meet in it
const CORNER_FRAME = "the grid vertex is (0,0); the post stands z 0..192 (16 x 16), the walls of the vertex's edges overlap it by 8; the mask is N 8, E 4, S 2, W 1";
const post = () => ({ brushes: [box([-W, -W, 0], [W, W, FULL], interior)], entities: [] });
add({ id: "corner-L", slot: "corner", kinds: ["wall"], masks: [12, 6, 3, 9], frame: CORNER_FRAME }, post());
add({ id: "corner-T", slot: "corner", kinds: ["wall"], masks: [14, 13, 11, 7], frame: CORNER_FRAME }, post());
add({ id: "corner-cross", slot: "corner", kinds: ["wall"], masks: [15], frame: CORNER_FRAME }, post());
add({ id: "corner-straight", slot: "corner", kinds: ["wall"], masks: [10, 5], frame: CORNER_FRAME }, post());
add({ id: "corner-end", slot: "corner", kinds: ["wall"], masks: [8, 4, 2, 1], frame: CORNER_FRAME }, post());
add(
  { id: "corner-rail", slot: "corner", kinds: ["rail"], masks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], frame: "the grid vertex is (0,0); a newel 8 x 8, 44 high, where only rails meet" },
  { brushes: [], entities: [detail([box([-4, -4, 0], [4, 4, 44], P.trim)])] },
);

add(
  { id: "floor", slot: "floor", kinds: ["floor"], frame: "the cell (0,0)..(64,64); the slab z -16..0, its top the floor, its underside the ceiling of the storey below" },
  { brushes: [box([0, 0, -16], [64, 64, 0], { top: P.floor, bottom: P.ceiling, sides: P.wall })], entities: [] },
);
add(
  { id: "ceiling-roof", slot: "ceiling", kinds: ["roof"], frame: "the cell (0,0)..(64,64) of the top storey; z = 0 its floor top; the roof slab z 176..192" },
  { brushes: [box([0, 0, CLEAR], [64, 64, FULL], { top: P.roof, bottom: P.ceiling, sides: P.wall })], entities: [] },
);

// the stair: the whole stairwell for one storey
{
  const f1 = { top: P.wood, south: P.wood, sides: P.wall };
  const f2 = { top: P.wood, north: P.wood, sides: P.wall };
  const brushes = [];
  for (let i = 1; i <= 5; i++) brushes.push(box([0, 64 + 24 * (i - 1), 0], [64, 64 + 24 * i, 16 * i], f1)); // flight 1, up +y
  brushes.push(box([0, 184, 0], [128, 256, 96], { top: P.wood, south: P.wood, sides: P.wall })); // the landing
  brushes.push(box([68, 64, 0], [128, 184, 96], P.wall)); // under flight 2
  for (let j = 1; j <= 5; j++) brushes.push(box([68, 184 - 24 * j, 96], [128, 184 - 24 * (j - 1), 96 + 16 * j], f2)); // flight 2, up -y
  brushes.push(box([0, 0, 176], [128, 64, FULL], { top: P.floor, bottom: P.ceiling, sides: P.trim })); // the upper landing
  brushes.push(prism("x", [[64, 0], [184, 0], [184, 148], [64, 228]], 64, 68, P.wall)); // the spine between the flights
  brushes.push(wedge([0, 40, 0], [64, 184, 96], "+y", "CLIP")); // flight 1 walked smoothly
  brushes.push(wedge([68, 64, 96], [128, 208, 192], "-y", "CLIP")); // flight 2
  const rail = railParts(0, 64);
  const at = (b) => ({ faces: b.faces.map((f) => ({ ...f, points: f.points.map(([x, y, z]) => [x, y + 62, z + FULL]) })) });
  brushes.push(at(rail.clip));
  add(
    {
      id: "stair-u", slot: "stair", kinds: ["u-turn"],
      frame: "the stairwell (0,0)..(128,256), 2 x 4 cells, the foot at its short end y = 0; z = 0 the lower storey's floor top, 192 the upper's",
      footprint: [[0, 0], [128, 256]],
      connectors: [
        { type: "stair-foot", at: [32, 0, 0], facing: [0, -1, 0] },
        { type: "stair-top", at: [96, 0, 192], facing: [0, -1, 0] },
      ],
      cells: {
        lower: "all 8 cells stand on floor slabs the assembler lays (the stair stands on z = 0); row y 0..64 is open floor: the approach to flight 1 (x 0..64) and a nook under the upper landing (x 64..128)",
        upper: "row y 0..64 (cells [0,0], [1,0]) is the upper landing, part of this piece (top z 192): lay no floor there; rows 1..3 are void, the piece's own rail closes the landing's edge over flight 1",
        void: [[0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]],
      },
      notes: "12 risers of 16 and treads of 24: flight 1 (x 0..64) rises from y 64 to the landing (y 184..256, z 96), flight 2 (x 68..128) from the landing back to y 64 and onto the upper landing at z 192. Solid under every step (nothing floats); a spine x 64..68 stands 36 over flight 2's nosings and carries a wood cap; a CLIP ramp over each flight. The stairwell's outer edges are the layout's walls; foot \"south\" is turn 0, \"east\" 90, \"north\" 180, \"west\" 270 (only this hand: flight 1 on the left going up)",
    },
    {
      brushes,
      entities: [detail([...rail.detail.map(at), prism("x", [[64, 228], [184, 148], [184, 152], [64, 232]], 63, 69, P.trim)])],
    },
  );
}

// lamps
add(
  {
    id: "lamp-ceiling", slot: "lamp", kinds: ["ceiling"],
    frame: "the cell (0,0)..(64,64) under a ceiling at z 176; the fitting hangs from it at the cell's middle",
    connectors: [{ type: "ceiling", at: [32, 32, 176], facing: [0, 0, -1] }],
    light: "both: the panel's underside wears +0~FIFTS_LGHT4, a texture light (library.json's texlights: an info_texlights or lights.rad), and a light entity under it (brightness 220) so the room is lit without them",
  },
  {
    brushes: [],
    entities: [
      detail([box([16, 12, 170], [48, 52, CLEAR], fitted(P.lamp, [64, 80], [16, 12, 170], [48, 52, CLEAR], { whole: true, faces: ["bottom"], rest: P.metal }))]),
      light([32, 32, 150], { color: [255, 244, 222], brightness: 220 }),
    ],
  },
);
{
  const s = sconce({ at: [32, W, 112], facing: 90, width: 16, height: 24, depth: 8, glass: P.sconce, metal: P.metal, shape: "drum" });
  add(
    {
      id: "lamp-wall", slot: "lamp", kinds: ["wall"],
      frame: `${EDGE_FRAME}; the sconce stands on the wall's +y face (y = 8) at x 32, z 112..136`,
      connectors: [{ type: "wall-face", at: [32, W, 112], facing: [0, 1, 0] }],
      light: "both: its glass wears +0~FIFTIES_LGT2, a texture light, and a light entity before it (brightness 60)",
    },
    { brushes: [], entities: [detail(s.brushes), light(s.light, { color: [255, 236, 200], brightness: 60 })] },
  );
}

// ── written: the maps, library.json, lights.rad ──
export function boundsOf(made) {
  const all = [...made.brushes, ...made.entities.flatMap((e) => e.brushes ?? [])];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of all) {
    const s = shapeOf(b);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], s.min[i]);
      max[i] = Math.max(max[i], s.max[i]);
    }
  }
  const r = (v) => Math.round(v * 100) / 100;
  return { min: min.map(r), max: max.map(r) };
}

// The person's approvals, kept apart from what this script writes: { id: { on, by, sha1 } }, sha1 being the piece's
// .map text when it was approved. A piece is approved while its .map is that text: changing its shape (or texture)
// takes the approval away until the person looks again.
const APPROVALS = "approvals.json";

export function writeLibrary(folder = OUT) {
  mkdirSync(folder, { recursive: true });
  const approvals = existsSync(join(folder, APPROVALS)) ? JSON.parse(readFileSync(join(folder, APPROVALS), "utf8")) : {};
  const approved = (id, text) => approvals[id]?.sha1 === pieceHash(text);
  const entries = PIECES.map(({ entry, made }) => {
    if (!made) return { ...entry, file: null, size: [0, 0, 0], bounds: null, entities: false, approved: approved(entry.id, "") };
    const file = `${entry.id}.map`;
    const text = writeMap({ worldspawn: { wad: ["halflife.wad"], _piece: entry.id }, brushes: made.brushes, entities: made.entities });
    writeFileSync(join(folder, file), text);
    const { min, max } = boundsOf(made);
    // a leaf's open place, with the doorway's clear opening measured from the .map as written (the leaf open)
    let open;
    if (entry.open) {
      const d = doorwayOf({ id: entry.id, map: readMap(text), connectors: entry.connectors, open: entry.open });
      if (d.failures.length) throw new Error(d.failures.join("; "));
      open = { ...entry.open, clear: { width: d.width, height: d.height, span: d.span } };
    }
    return {
      id: entry.id, file, slot: entry.slot, kinds: entry.kinds, ...(entry.edges ? { edges: entry.edges } : {}), ...(entry.masks ? { masks: entry.masks } : {}),
      size: max.map((v, i) => Math.round((v - min[i]) * 100) / 100), bounds: [min, max],
      ...(entry.footprint ? { footprint: entry.footprint } : {}),
      frame: entry.frame, connectors: entry.connectors ?? [], ...(open ? { open } : {}), ...(entry.glass ? { glass: entry.glass } : {}),
      entities: made.entities.length > 0,
      ...(entry.cells ? { cells: entry.cells } : {}), ...(entry.light ? { light: entry.light } : {}), ...(entry.notes ? { notes: entry.notes } : {}),
      approved: approved(entry.id, text),
    };
  });
  const library = {
    format: "smak-pieces/1", game: "halflife", wad: "valve/halflife.wad", grid: 64, storeyHeight: 192,
    palette: PALETTE, texlights: TEXLIGHTS, pieces: entries,
  };
  writeFileSync(join(folder, "library.json"), JSON.stringify(library, null, 2) + "\n");
  const rad = Object.entries(TEXLIGHTS).map(([name, v]) => `${name} ${v.join(" ")}`).join("\n");
  writeFileSync(join(folder, "lights.rad"), `// the pieces' texture lights, for VHLT's hlrad (or give the map an info_texlights with the same)\n${rad}\n`);
  return library;
}

// ── pictures: each piece in a sealed chamber, compiled and drawn ──
const CHAMBER = { floor: "CRETE3_FLR04", ceiling: "CRETE3_FLR04", wall: "CRETE3_WALL01" };

/** What stands round a piece in its chamber, and where it is looked at from. */
function sceneOf(id, lib, { open = false } = {}) {
  const piece = lib.pieces.get(id);
  const floorAt = (cx, cy, z = 0) => placed(lib.pieces.get("floor"), { at: [cx * 64, cy * 64, z] });
  const parts = [];
  const cells = (xs, ys, z = 0) => { for (const x of xs) for (const y of ys) parts.push(floorAt(x, y, z)); };
  const long = 64 * (piece.edges ?? 1);
  const ends = (pid = "corner-end") => { parts.push(placed(lib.pieces.get(pid), { at: [0, 0, 0] }), placed(lib.pieces.get(pid), { at: [long, 0, 0] })); };
  let views;
  let deep = false;
  let dim = false;
  const slot = piece.slot;
  if (slot === "edge" || id === "lamp-wall") {
    cells(long > 64 ? [-1, 0, 1, 2] : [-1, 0, 1], [-2, -1, 0, 1]);
    ends();
    if (id === "lamp-wall") parts.push(placed(lib.pieces.get("wall"), { at: [0, 0, 0] }));
    parts.push(placed(piece, { at: [0, 0, 0], open }));
    const m = long / 2;
    views = [
      { name: "inside +y", from: [m + 98, 170, 110], to: [m, 0, 80] },
      { name: "outside -y", from: [m - 102, -170, 110], to: [m, 0, 80] },
      { name: "along the wall", from: [long + 106, 60, 60], to: [m, 0, 60] },
    ];
    if (open) views = [
      { name: "OPEN, inside +y", from: [m + 110, 150, 120], to: [m - 8, 20, 60] },
      { name: "OPEN, eye height 64 through it", from: [m, -150, 64], to: [m, 100, 64] },
      { name: "OPEN, eye height 64 from inside", from: [m, 170, 64], to: [m, -100, 64] },
    ];
    if (id === "lamp-wall") { views = [{ name: "the sconce", from: [100, 110, 90], to: [32, 8, 118] }, { name: "below", from: [40, 60, 40], to: [32, 8, 120] }]; dim = true; }
  } else if (slot === "rail") {
    cells([-1, 0, 1], [0, 1]);
    deep = true;
    parts.push(placed(lib.pieces.get("corner-rail"), { at: [0, 0, 0] }), placed(lib.pieces.get("corner-rail"), { at: [64, 0, 0] }));
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [{ name: "from the floor", from: [90, 140, 100], to: [32, 0, 20] }, { name: "from the void", from: [-30, -150, -40], to: [32, 0, 10] }];
  } else if (slot === "corner") {
    const mask = piece.masks[0];
    cells([-2, -1, 0, 1], [-2, -1, 0, 1]);
    const ways = [[8, [0, 0, 0], 90], [4, [0, 0, 0], 0], [2, [0, 0, 0], 270], [1, [0, 0, 0], 180]];
    for (const [bit, at, turn] of ways) if (mask & bit) parts.push(placed(lib.pieces.get(id === "corner-rail" ? "rail" : "wall"), { at, turn }));
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [{ name: `mask ${mask} from sw`, from: [-170, -150, 260], to: [0, 0, 60] }, { name: "from ne", from: [170, 150, 260], to: [0, 0, 60] }];
  } else if (slot === "floor") {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) parts.push(placed(piece, { at: [x * 64, y * 64, 0] }));
    views = [{ name: "2 x 2 floors", from: [200, -80, 120], to: [64, 64, 0] }];
  } else if (slot === "ceiling") {
    cells([0, 1], [0, 1]);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) parts.push(placed(piece, { at: [x * 64, y * 64, 0] }));
    views = [{ name: "under", from: [-60, -60, 60], to: [64, 64, 176] }, { name: "over", from: [-60, -60, 320], to: [64, 64, 192] }];
  } else if (slot === "stair") {
    cells([0, 1], [-2, -1, 0, 1, 2, 3]);
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [
      { name: "from above", from: [300, -100, 360], to: [64, 140, 110] },
      { name: "from the foot", from: [40, -150, 110], to: [48, 160, 70] },
      { name: "down flight 2", from: [110, 245, 180], to: [96, 64, 170] },
      { name: "upper landing", from: [-60, -100, 260], to: [64, 64, 200] },
    ];
  } else if (id === "lamp-ceiling") {
    cells([-1, 0, 1], [-1, 0, 1]);
    cells([-1, 0, 1], [-1, 0, 1], FULL);
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [{ name: "the lamp", from: [-90, -90, 70], to: [32, 32, 172] }];
    dim = true;
  }
  return { parts, views, deep, dim };
}

async function pictures(work) {
  const { compileMap } = await import("../../../src/maps/compile.mjs");
  const { readBsp } = await import("../../../src/maps/bsp.mjs");
  const { drawMap, sectionOf, planOf } = await import("../../../src/maps/draw.mjs");
  const { readWad } = await import("../../../src/maps/wad.mjs");
  const { tile } = await import("../../../src/render.mjs");
  const png = smallPng; // the pictures kept in the folder: RGB, filtered, packed hard
  mkdirSync(work, { recursive: true });
  const pics = join(OUT, "pictures");
  mkdirSync(pics, { recursive: true });
  const lib = loadLibrary(OUT);
  const textures = readWad(readFileSync(need(WAD, "halflife.wad (--wad, HL_WAD)"))).textures;
  const sheet = [];
  const names = [];
  const report = [];
  // a piece in its sealed chamber, compiled: { map, bsp } (bsp null when it did not compile)
  const chamber = (id, piece, { parts, deep, dim }, tag = "") => {
    const brushes = parts.flatMap((p) => p.brushes);
    const entities = parts.flatMap((p) => p.entities);
    const { min, max } = boundsOf({ brushes, entities });
    const lo = [min[0] - 200, min[1] - 200, deep ? -224 : Math.min(min[2], -16)];
    const hi = [max[0] + 200, max[1] + 200, Math.max(max[2], FULL) + 200];
    const map = {
      worldspawn: { wad: [WAD] },
      brushes: [...hollow(lo, hi, 16, CHAMBER), ...brushes],
      entities: [
        playerStart([lo[0] + 40, lo[1] + 40, lo[2]], 45),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
          light([(min[0] + max[0]) / 2 + sx * ((max[0] - min[0]) / 2 + 100), (min[1] + max[1]) / 2 + sy * ((max[1] - min[1]) / 2 + 100), Math.max(max[2], CLEAR) + 40], { brightness: dim ? 25 : 260 })),
        textureLights([lo[0] + 40, lo[1] + 40, hi[2] - 40], TEXLIGHTS),
        ...(slot(piece) === "ceiling" ? [light([64, 64, 90], { brightness: 160 })] : []),
        ...entities,
      ],
    };
    const file = join(work, `${id}${tag}.map`);
    writeFileSync(file, writeMap(map));
    const result = compileMap(file, { wads: [WAD], fast: true, compilers: { folder: need(VHLT, "the VHLT folder (--vhlt, VHLT_DIR)") } });
    report.push(`${id}${tag}: ${result.bsp ? "compiled" : "FAILED"}${result.errors.length ? ` errors: ${result.errors.join(" | ")}` : ""}${result.leak ? " LEAK" : ""}`);
    return { map, bsp: result.bsp ? readBsp(readFileSync(result.bsp)) : null };
  };
  for (const [id, piece] of lib.pieces) {
    if (!piece.file) continue;
    const scene = sceneOf(id, lib);
    const { map, bsp } = chamber(id, piece, scene);
    if (!bsp) continue;
    const { views } = scene;
    const shots = views.map((v) => drawMap(bsp, { from: v.from, to: v.to, textures, width: 400, height: 300, entities: false }));
    const labels = views.map((v) => `${id}: ${v.name}`);
    if (slot(piece) === "stair") {
      for (const x of [32, 96]) {
        const cut = sectionOf(map, { from: [x, -60], to: [x, 280], scale: 1.0, z: [-24, 248] });
        shots.push(fitTo(cut, 400, 300));
        labels.push(`${id}: section x ${x}`);
      }
    }
    if (piece.open) {
      // the leaf drawn open: a chamber with it as world brush at its open place, seen from eye height through it
      const d = doorwayOf(piece);
      const line = `clear width with the leaf open: ${d.width} (x ${d.span[0]}..${d.span[1]}), height ${d.height}`;
      report.push(`${id}: ${line}`);
      const opened = sceneOf(id, lib, { open: true });
      const o = chamber(id, piece, opened, "-open");
      if (o.bsp) {
        for (const v of opened.views) {
          shots.push(drawMap(o.bsp, { from: v.from, to: v.to, textures, width: 400, height: 300, entities: false }));
          labels.push(`${id}: ${v.name}`);
        }
        const plan = planOf(o.bsp, { z: 64, area: { min: [-24, -56], max: [152, 104] }, width: 400, height: 300 });
        shots.push(fitTo(plan, 400, 300));
        labels.push(`${id}: OPEN, plan cut at z 64: ${line}`);
      }
    }
    const one = tile(shots, Math.min(shots.length, 3), labels);
    writeFileSync(join(pics, `${id}.png`), png(one.width, one.height, one.rgba));
    sheet.push(drawMap(bsp, { from: views[0].from, to: views[0].to, textures, width: 320, height: 240, entities: false }));
    names.push(id);
  }
  const all = tile(sheet, 5, names);
  writeFileSync(join(OUT, "sheet.png"), png(all.width, all.height, all.rgba));

  // the joins: a room of 3 x 2 cells put together from the pieces at every turn, a partition with a door, roofed
  const room = joinsRoom(lib);
  const file = join(work, "joins.map");
  writeFileSync(file, writeMap(room.map));
  const result = compileMap(file, { wads: [WAD], fast: true, compilers: { folder: need(VHLT, "the VHLT folder (--vhlt, VHLT_DIR)") } });
  report.push(`joins: ${result.bsp ? "compiled" : "FAILED"}${result.errors.length ? ` errors: ${result.errors.join(" | ")}` : ""}${result.leak ? " LEAK" : ""}`);
  if (result.bsp) {
    const bsp = readBsp(readFileSync(result.bsp));
    const shots = room.views.map((v) => drawMap(bsp, { from: v.from, to: v.to, textures, width: 400, height: 300, entities: false }));
    const one = tile(shots, 3, room.views.map((v) => `joins: ${v.name}`));
    writeFileSync(join(pics, "joins.png"), png(one.width, one.height, one.rgba));
  }
  console.log(report.join("\n"));
}

/** A room of 3 x 2 cells from the pieces: walls at all four turns, posts by their masks with brick outside, an entrance and a partition's door on two edges each, windows. */
function joinsRoom(lib) {
  const parts = [];
  const put = (id, at, turn = 0, outside) => parts.push(placed(lib.pieces.get(id), { at, turn, outside }));
  for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) { put("floor", [x * 64, y * 64, 0]); put("ceiling-roof", [x * 64, y * 64, 0]); }
  // south, run +x (turn 0); east, run +y (90); north, run -x (180); west, run -y (270)
  // the entrance on two edges, x 0..128 (no post at (64, 0)): its leaf opens 74 into the room, which is two cells deep
  put("wall-entrance", [0, 0, 0]); put("wall-exterior", [128, 0, 0]);
  put("wall-exterior", [192, 0, 0], 90); put("wall-exterior", [192, 64, 0], 90);
  put("wall-exterior", [192, 128, 0], 180); put("wall-window", [128, 128, 0], 180); put("wall-exterior", [64, 128, 0], 180);
  put("wall-exterior", [0, 128, 0], 270); put("wall-window", [0, 64, 0], 270);
  // the partition at x 128: a door on both its edges (run +y), no post at (128, 64); its leaf opens to -x, into the 2 x 2 side
  put("wall-door", [128, 0, 0], 90);
  for (const [at, mask, outside] of [
    [[0, 0, 0], 12, ["south", "west"]], [[192, 0, 0], 9, ["south", "east"]], [[192, 128, 0], 3, ["north", "east"]], [[0, 128, 0], 6, ["north", "west"]],
    [[128, 0, 0], 13, ["south"]], [[192, 64, 0], 10, ["east"]], [[128, 128, 0], 7, ["north"]], [[64, 128, 0], 5, ["north"]], [[0, 64, 0], 10, ["west"]],
  ]) parts.push(placed(pieceFor(lib, "corner", mask), { at, outside }));
  put("lamp-ceiling", [0, 64, 0]); put("lamp-wall", [192, 0, 0], 90);
  const brushes = parts.flatMap((p) => p.brushes);
  const entities = parts.flatMap((p) => p.entities);
  const lo = [-320, -320, -16];
  const hi = [512, 448, 420];
  const map = {
    worldspawn: { wad: [WAD] },
    brushes: [...hollow(lo, hi, 16, CHAMBER), ...brushes],
    entities: [
      playerStart([-200, -200, -16], 45),
      ...[[-200, -200], [400, -200], [400, 350], [-200, 350]].map(([x, y]) => light([x, y, 300], { brightness: 300 })),
      light([160, 64, 120], { brightness: 120 }),
      textureLights([-280, -280, 380], TEXLIGHTS),
      ...entities,
    ],
  };
  const views = [
    { name: "outside from the south east", from: [360, -200, 160], to: [120, 64, 90] },
    { name: "outside from the north west", from: [-180, 300, 160], to: [80, 64, 90] },
    { name: "inside: the partition's door", from: [24, 110, 64], to: [128, 64, 60] },
    { name: "inside: the north window", from: [70, 20, 70], to: [96, 128, 70] },
    { name: "inside: the entrance", from: [100, 120, 64], to: [64, 0, 60] },
    { name: "inside: the north-west corner", from: [100, 30, 90], to: [0, 128, 90] },
  ];
  return { map, views };
}
const slot = (piece) => piece.slot;

/** A picture put in the middle of a w x h one (cut or padded). */
export function fitTo(img, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([24, 24, 28, 255], i * 4);
  const ox = Math.floor((w - img.width) / 2);
  const oy = Math.floor((h - img.height) / 2);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const tx = x + ox;
      const ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      out.set(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (ty * w + tx) * 4);
    }
  return { width: w, height: h, rgba: out };
}

// ── run ──
if (process.argv[1]?.split("\\").join("/").endsWith("pieces/make-hl.mjs")) {
  writeLibrary(OUT);
  const lib = loadLibrary(OUT);
  if (existsSync(WAD)) {
    const { wadTextureNames } = await import("../../../src/maps/plan.mjs");
    const check = checkTextures(lib, wadTextureNames(readFileSync(WAD)));
    console.log(check.failures.length ? `FAIL: ${check.failures.join("; ")}` : `PASS: every texture of the ${lib.pieces.size} pieces is in halflife.wad (${check.used.length} names)`);
    if (check.failures.length) process.exitCode = 1;
  } else console.log(`(no halflife.wad at ${WAD}: the textures are not checked)`);
  const work = flag("--pictures");
  if (work) await pictures(work);
}

/** A PNG of an RGBA picture in 256 colours (the kit's median cut), packed at deflate's level 9: a fifth of `png`'s size for these views. */
export function smallPng(width, height, rgba) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  const { pixels, palette } = indexed({ width, height, rgb }, "picture", 256);
  const rows = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(rows, y * (width + 1) + 1);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3; // palette
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("PLTE", Buffer.from(palette.subarray(0, 768))),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
