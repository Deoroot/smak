// levels/assembly, part P: the second library of authored pieces, the Mese, for The Specialists (README.md, "The
// second kit"). The sibling of make-hl.mjs: the same frames, grid, storey, walls, doorways and stair, re-skinned in
// marble, brick-and-stone, dark wood and gold, and the street's own pieces (columns, architraves, porticoes, shop
// fronts and windows, paving, an honorific column).
//
//   node levels/assembly/pieces/make-mese.mjs                     writes pieces/mese/<id>.map, library.json and
//                                                                 lights.rad, and checks every texture against the
//                                                                 three wads together
//   node levels/assembly/pieces/make-mese.mjs --swatches          and draws pieces/mese/swatches.png: every texture
//                                                                 considered for the palette, its name and size under it
//   node levels/assembly/pieces/make-mese.mjs --pictures <work>   and puts each piece in a sealed test chamber, compiles
//                                                                 it with VHLT in <work> (the H9 wad included in the
//                                                                 .bsp), and draws pieces/mese/pictures/<id>.png and
//                                                                 pieces/mese/sheet.png
//   --ts-wad <specialists.wad> --wad <halflife.wad> --mese-wad <alexandria_msr_b4v3_generated.wad> --vhlt <folder>
//                                                                 where they are (or TS_WAD, HL_WAD, MESE_WAD, VHLT_DIR)
//
// Frames: as make-hl.mjs's (edge, rail, corner, floor, ceiling, stair, lamp), and
//   column       the grid vertex at (0,0): a column standing z 0..176 round it (base and capital 40 square)
//   architrave   an edge, run along +x from (0,0) to (64,0): the beam y -8..8, z 176..192, resting on the columns'
//                capitals at its two vertices
//   portico      the cell (0,0)..(64,64): its ceiling slab z 176..192, coffered in gold underneath, a roof on top
//   landmark     the cells (0,0)..(192,192), 3 x 3: the honorific column at their middle (96,96), z 0 the paving's top
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  box, prism, wedge, solid, cylinder, cone, fitted, brushEntity, originBrush, light, textureLights, playerStart, hollow, writeMap, readMap,
} from "../../../src/maps/source.mjs";
import { sconce, chandelier } from "../../../src/maps/pieces.mjs";
import { loadLibrary, pieceHash, placed, pieceFor, checkTextures, doorwayOf } from "../library.mjs";
import { boundsOf, fitTo, smallPng } from "./make-hl.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "mese");
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const WADS = {
  ts: flag("--ts-wad") ?? process.env.TS_WAD ?? null,
  hl: flag("--wad") ?? process.env.HL_WAD ?? null,
  mese: flag("--mese-wad") ?? process.env.MESE_WAD ?? null,
};
const VHLT = flag("--vhlt") ?? process.env.VHLT_DIR ?? null;
/** A place the person gives (a flag or the environment), or the run stops with the sentence that says which. */
const need = (value, what) => value ?? (console.log(`FAIL: ${what} is not given; pass it as a flag or in the environment`), process.exit(1)); // prettier-ignore
/** The three wads by file name, as library.json lists them; the third is put inside every .bsp (wadinclude). */
export const WAD_NAMES = ["specialists.wad", "halflife.wad", "alexandria_msr_b4v3_generated.wad"];
export const WADINCLUDE = ["alexandria_msr_b4v3_generated"];

// ── the palette: names in the three wads, checked below; looked at in swatches.png before they were chosen ──
export const PALETTE = {
  wall: "sinmarblewall", // H9: warm travertine blocks, every wall inside (the corners' faces outside take `brick`)
  brick: "sinbrickwall", // H9: red and grey brick, the outer face of exterior walls and facades
  band: "muro7", // TS: pale pink-veined stone, the bands laid through the brick (Byzantine opus mixtum) and cornices
  floor: "sinpalacefloor", // H9: the palace's cream marble inlay, a shop's or a hall's floor
  home: "sinwoodwallluxu", // H9: dark wood planks, a home's floor
  paving: "marb", // H9: dark veined marble, the street and the square, as New Byzantium's Mese
  ceiling: "sinceiling3", // H9: gold ornament, every slab's underside and the portico's coffers
  roof: "pkf_concrete5b", // H9: cement slabs, the roof's top (seen only from above)
  trim: "singold", // H9: worked gold, casings, fascias, rings, capitals, rails
  frame: "marb", // H9: dark marble, door reveals, linings, sills, thresholds, treads, the architrave
  shaft: "marb", // H9: dark marble, a portico column's shaft (stone and gold)
  stone: "sinmarblewall", // H9: travertine, the bases of columns and the landmark's steps and pedestal
  porphyry: "cd_mrbblack", // H9: near-black marble, the landmark's shaft (porphyry's place)
  wood: "cd_woodwall", // H9: dark red wood, the rails' balusters and the stair's spine
  door: "wood8dn", // H9: a dark plank door, 64 x 128, fitted to every leaf
  sign: "sintrim", // H9: a marble plaque in a silver frame, the shop's sign board (blank: a name painted later)
  glass: "GLASS_MED", // HL: grey-green glass, windows and shop windows
  lamp: "+0~LIGHT4A", // HL: a warm yellow glow, the chandelier's glass (a texture light)
  sconce: "+0~generic86", // H9: a warm square glow, the wall lamp's glass (a texture light)
  metal: "singold", // H9: the lamps' metal
};
/** Texture lights: VHLT reads them from an info_texlights entity or from lights.rad (written beside the pieces). */
export const TEXLIGHTS = { "+0~LIGHT4A": [255, 214, 150, 1600], "+0~generic86": [255, 206, 150, 900], po_lightgrtyel: [255, 206, 130, 500] };

/** Every texture looked at before the palette was chosen (swatches.png). */
export const SWATCHES = [
  "marb", "singold", "sintrim", "sinmarblewall", "sinwall32", "sinpalacefloor", "sinceiling3", "sinfinewood",
  "sinwoodwallluxu", "sinwoodenfloor2", "sinwoodenfloor5", "sinbrickwall", "sinbankbrick", "wht_pillar3", "sintilesfloor", "sintilesplain",
  "sinrug", "sinrug2", "sinfloor1", "cd_mrbblack", "cd_wood", "cd_woodwall", "cd_glass1", "glass_dark",
  "WOODFLOOR02_256", "booth_wood_1", "dark_bwallgrt", "fap-ceiling03", "pkf_trim1a", "sintexture", "sinwoodentextur", "dgreybase",
  "dtanbase", "dsupport", "dtrim7", "greywall1", "hogroof", "cd_trim2", "pkf_concrete5b", "po_concretwall",
  "wood8dn", "homedoor1dn", "greywall2", "grey_creteflr", "pkf_inwall2", "po_slasphalblgr", "RD_CEILING01", "congo6",
  "wooddark", "bricks", "brickx2", "stonewall1", "stonewall1a", "granite1", "plaster1", "stucco",
  "tilez1", "tilez2", "pavement", "Pavement001", "outpave002", "outwall002", "adobe1", "muro",
  "muro1", "muro7", "wood2", "wood21", "wood4a", "door003", "door006", "checkered_floor",
  "floor002", "floor004", "crete22", "concrete2", "wall1", "wall3", "wall4", "rustic1",
  "PILLARSIDE", "GLASS_BRIGHT", "GLASS_DARK", "GLASS_MED", "CRETE4_STP01", "CHROMEBAR", "FIFTIES_DR1K", "FIFTIES_DR6",
  "TRRM_WOOD", "C1A1_TRIM1", "FIFTIES_WALL14", "CRETE2_FLR01", "CRETE3_WALL01", "+0~FIFTS_LGHT4", "+0~FIFTIES_LGT2", "+0~LIGHT2A",
  "+0~LIGHT3A", "+0~LIGHT4A", "+0~LIGHT6A", "+0~DRKMTLLGT1", "+0~GYMLIGHT", "~SPOTYELLOW", "+0~white", "+0~generic86",
];

const P = PALETTE;
const W = 8; // half a wall
const CLEAR = 176;
const FULL = 192;
/** The heights where an exterior wall's brick gives way to a band of stone (the storey's band hides the slab's edge). */
const BANDS = [[80, 96], [160, 192]];
const leafFit = (name, min, max) => fitted(name, [64, 128], min, max, { whole: true, faces: ["north", "south"], rest: P.frame });

// ── the pieces: each { brushes (world), entities } in its frame ──
const detail = (brushes) => brushEntity("func_detail", brushes);

/**
 * A stretch of wall x x0..x1, z z0..z1, centred on y = 0 (16 thick): inside it wears the palette's wall; an exterior
 * one (`outer`) is cut at the bands, its outer face (y = -8) brick between them and stone in them. `faces` puts
 * other textures on some of its faces (`east`, `west`, `bottom`: a reveal's lining, a head's underside).
 */
function wallPart(x0, x1, z0, z1, { outer = false, faces = {} } = {}) {
  if (!outer) return [box([x0, -W, z0], [x1, W, z1], { sides: P.wall, ...faces })];
  const cuts = [z0, z1];
  for (const [a, b] of BANDS) for (const z of [a, b]) if (z > z0 && z < z1) cuts.push(z);
  cuts.sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const inBand = BANDS.some(([lo, hi]) => a >= lo && b <= hi);
    parts.push(box([x0, -W, a], [x1, W, b], { sides: P.wall, south: inBand ? P.band : P.brick, top: P.band, ...faces }));
  }
  return parts;
}

const LEAF = 4; // a leaf's thickness
const USE_ONLY = 256; // func_door_rotating: opened by use, not by touch (the RP plugin locks it by its name)
const ONE_WAY = 16;

/**
 * A door leaf hinged at (hx, hy), its closed box x hx..x1, y hy..hy+4, z z0..z1; it turns +90 (anticlockwise seen
 * from above) into +y, opened by use only. Gives the func_door_rotating (its targetname left for the assembler to
 * fill) and the `open` entry, as make-hl.mjs's.
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
    speed: 100, distance: 90, wait: 4, spawnflags: ONE_WAY + USE_ONLY, angles: [0, 0, 0], // one way, +90: into +y; used, never touched; it swings back after 4 s (with wait -1 and no toggle flag, 32, a used door never closes again)
  });
  return { entity, open };
}

// A doorway on two edges, the house's geometry exactly (make-hl.mjs, `doorway`): the opening x 32..96, z 0..112, the
// leaf in front of the inside face (y 10..14) hinged at (32, 10), open at x 28..32, y 10..74. Reveals and the head's
// underside in dark marble; gold casings on both faces round the opening; `front` adds the street side's own
// dressing (a shop's pilasters and sign) to the casings.
const DOOR = { x0: 32, x1: 96, head: 112, edges: 2 };
function doorway({ top, outer, threshold, leafName, outside, front = [] }) {
  const { x0, x1, head } = DOOR;
  const brushes = [
    ...wallPart(0, 128, head, top, { outer, faces: { bottom: P.frame } }),
    ...wallPart(0, x0, 0, head, { outer, faces: { east: P.frame } }),
    ...wallPart(x1, 128, 0, head, { outer, faces: { west: P.frame } }),
    box([x0, -W, -16], [x1, W, 0], threshold),
  ];
  const casing = [
    box([24, W, 0], [28, W + 2, head + 4], P.trim),
    box([x1, W, 0], [x1 + 4, W + 2, head + 4], P.trim),
    box([24, W, head], [x1 + 4, W + 2, head + 4], P.trim),
    box([x0 - outside.wide, -W - outside.deep, 0], [x0, -W, head + outside.wide], P.trim),
    box([x1, -W - outside.deep, 0], [x1 + outside.wide, -W, head + outside.wide], P.trim),
    box([x0, -W - outside.deep, head], [x1, -W, head + outside.wide], P.trim),
    ...front,
  ];
  const l = leaf(x0, W + 2, x1, 1, head - 1, leafName);
  return { made: { brushes, entities: [detail(casing), l.entity] }, open: l.open };
}

/** A railing from x0 to x1 along y = 0 at z = 0: a gold handrail 36..40 and bottom rail, dark wood balusters every 10 or so; and a CLIP over it. */
function railParts(x0, x1) {
  const parts = [box([x0, -2, 36], [x1, 2, 40], P.trim), box([x0, -2, 0], [x1, 2, 3], P.trim)];
  const n = Math.round((x1 - x0) / 10);
  for (let i = 1; i < n; i++) {
    const x = x0 + Math.round(((x1 - x0) * i) / n);
    parts.push(box([x - 1, -1, 3], [x + 1, 1, 36], P.wood));
  }
  return { detail: parts, clip: box([x0, -2, 40], [x1, 2, 96], "CLIP") };
}

/** A square frustum round (cx, cy): `r0` half across at z0, `r1` at z1 (a capital's bell). */
const frustum = (cx, cy, r0, r1, z0, z1, tex) =>
  solid([[-r0, -r0, z0], [r0, -r0, z0], [r0, r0, z0], [-r0, r0, z0], [-r1, -r1, z1], [r1, -r1, z1], [r1, r1, z1], [-r1, r1, z1]].map(([x, y, z]) => [cx + x, cy + y, z]), tex);

const PIECES = [];
const add = (entry, made) => PIECES.push({ entry, made });
const EDGE_FRAME = "the edge runs along +x from (0,0) to (64,0); the wall is centred on y = 0 (y -8..8); z = 0 is the floor top; the inside (where a door opens to) is +y";
const EXT_FRAME = `${EDGE_FRAME}; the outer face is y = -8 (brick, bands of stone at z 80..96 and 160..192); it stands to z 192, closing the slab's edge outside`;

add({ id: "wall", slot: "edge", kinds: ["interior"], frame: EDGE_FRAME, notes: "travertine both faces, z 0..176" }, { brushes: wallPart(0, 64, 0, CLEAR), entities: [] });
add(
  { id: "wall-exterior", slot: "edge", kinds: ["exterior"], frame: EXT_FRAME, notes: "inside travertine; outside brick with two bands of stone (z 80..96, and 160..192 over the slab's edge), as the Theodosian walls lay them" },
  { brushes: wallPart(0, 64, 0, FULL, { outer: true }), entities: [] },
);
add(
  {
    id: "facade", slot: "edge", kinds: ["facade"], frame: EXT_FRAME,
    notes: "an exterior wall facing the street: wall-exterior's brick and bands, and a cornice of stone (4 proud, z 180..192) on a gold fascia (2 proud, z 176..180) along its outer face (func_detail)",
  },
  {
    brushes: wallPart(0, 64, 0, FULL, { outer: true }),
    entities: [detail([box([0, -W - 4, 180], [64, -W, FULL], P.band), box([0, -W - 2, 176], [64, -W, 180], P.trim)])],
  },
);

const DOOR_FRAME = "the two edges run along +x from (0,0) to (128,0), the middle vertex at (64,0) (no post there: the piece covers it); the wall is centred on y = 0 (y -8..8); z = 0 is the floor top; the inside (where the door opens to) is +y";
const DOOR_CONNECTOR = [{ type: "doorway-64x112", at: [64, 0, 0], facing: [0, 1, 0] }];
const NAMED = { key: "targetname", entity: "func_door_rotating", note: "the assembler gives each leaf its name (one a property: the RP plugin hands it out as a key); the piece leaves it unset" };
{
  const d = doorway({ top: CLEAR, outer: false, threshold: { top: P.frame, sides: P.frame }, leafName: P.door, outside: { deep: 2, wide: 4 } });
  add(
    {
      id: "wall-door", slot: "edge", kinds: ["door"], edges: 2, frame: DOOR_FRAME, connectors: DOOR_CONNECTOR, open: d.open, named: NAMED,
      notes: "the house's wall-door re-skinned: two edges (128), the opening x 32..96, z 0..112, clear 64 x 112 with the leaf open; dark marble reveals and head; gold casings 4 wide and 2 proud on both faces round the opening (func_detail), none in it; a dark marble threshold flush with the floor (world, z -16..0); the leaf a func_door_rotating 64 x 4 x 110 of dark planks (y 10..14), hinged at (32, 10), opening one way 90 into +y by use only (spawnflags 16 + 256; wait 4, it swings back by itself), where it stands at x 28..32, y 10..74 (`open`)",
    },
    d.made,
  );
}
{
  const d = doorway({ top: FULL, outer: true, threshold: { top: P.frame, sides: P.frame }, leafName: P.door, outside: { deep: 4, wide: 6 } });
  add(
    {
      id: "wall-entrance", slot: "edge", kinds: ["entrance"], edges: 2, frame: `${DOOR_FRAME}; the outer face is y = -8 (brick and bands); it stands to z 192`,
      connectors: DOOR_CONNECTOR, open: d.open, named: NAMED,
      notes: "a home's street door: as wall-door on two edges with the opening x 32..96, z 0..112, clear 64 x 112 with the leaf open; outside, gold casings 6 wide carried 4 out of the brick; the leaf hinged at (32, 10), opening one way 90 into the building (+y) by use only",
    },
    d.made,
  );
}
{
  // the shop's street door: the doorway, and on the street side pilasters of dark marble with gold bases and heads,
  // an entablature over them and the sign board on it
  const front = [
    box([18, -W - 8, 0], [30, -W, 120], P.frame), box([98, -W - 8, 0], [110, -W, 120], P.frame), // pilasters, 12 wide, 8 out
    box([16, -W - 9, 0], [32, -W, 8], P.trim), box([96, -W - 9, 0], [112, -W, 8], P.trim), // their gold bases
    box([16, -W - 10, 120], [112, -W, 128], P.trim), // the entablature's gold fascia over both
    box([20, -W - 6, 128], [108, -W, 132], P.frame), // a dark marble ledge for the sign
    box([24, -W - 4, 132], [104, -W, 164], fitted(P.sign, [128, 128], [24, -W - 4, 132], [104, -W, 164], { whole: true, faces: ["south"], rest: P.trim })), // the sign board
  ];
  const d = doorway({ top: FULL, outer: true, threshold: { top: P.frame, sides: P.frame }, leafName: P.door, outside: { deep: 4, wide: 2 }, front });
  add(
    {
      id: "shopfront", slot: "edge", kinds: ["shopfront"], edges: 2, frame: `${DOOR_FRAME}; the outer face (the street) is y = -8, brick and bands; it stands to z 192`,
      connectors: DOOR_CONNECTOR, open: d.open, named: NAMED,
      sign: { box: [[24, -12, 132], [104, -8, 164]], face: "south", note: "the sign board's street face wears the blank plaque fitted whole: a shop's name can be painted on a copy of it" },
      notes: "a shop's street door on two edges, the doorway of wall-door (opening x 32..96, z 0..112, clear 64 x 112 with the leaf open; the leaf inside, hinged at (32, 10), opening one way into the shop by use only); on the street side (func_detail) pilasters of dark marble 12 wide and 8 proud at x 18..30 and 98..110 on gold bases, a gold entablature z 120..128 across x 16..112, a dark marble ledge and over it the sign board, x 24..104, z 132..164, 4 proud",
    },
    d.made,
  );
}

add(
  {
    id: "wall-window", slot: "edge", kinds: ["window"], frame: EXT_FRAME,
    connectors: [{ type: "window-48x80", at: [32, 0, 40], facing: [0, 1, 0] }],
    glass: { entity: "func_breakable", material: 0, box: [[12, -1, 44], [52, 1, 116]], clear: [[12, 44], [52, 116]] },
    notes: "the house's window re-skinned: opening 48 wide, sill at 40, head at 120; dark marble linings 4 (func_detail): clear 40 x 72 (x 12..52, z 44..116); an outer sill of stone standing 6 out of the brick; the pane a func_breakable of glass (material 0, health 30), see-through (rendermode 2, renderamt 80)",
  },
  {
    brushes: [...wallPart(0, 64, 0, 40, { outer: true }), ...wallPart(0, 64, 120, FULL, { outer: true }), ...wallPart(0, 8, 40, 120, { outer: true }), ...wallPart(56, 64, 40, 120, { outer: true })],
    entities: [
      detail([
        box([8, -W, 40], [12, W, 120], P.frame),
        box([52, -W, 40], [56, W, 120], P.frame),
        box([12, -W, 40], [52, W, 44], P.frame),
        box([12, -W, 116], [52, W, 120], P.frame),
        box([8, -14, 36], [56, -W, 44], P.band),
      ]),
      brushEntity("func_breakable", [box([12, -1, 44], [52, 1, 116], P.glass)], { material: 0, health: 30, rendermode: 2, renderamt: 80 }),
    ],
  },
);
add(
  {
    id: "shop-window", slot: "edge", kinds: ["shop-window"], frame: `${EXT_FRAME}; the street is -y`,
    connectors: [{ type: "window-48x112", at: [32, 0, 32], facing: [0, 1, 0] }],
    glass: { entity: "func_breakable", material: 0, box: [[12, -1, 36], [52, 1, 140]], clear: [[12, 36], [52, 140]] },
    notes: "a shop's window on one edge: the opening x 8..56 (all of the edge between its posts), sill at 32, head at 144; dark marble linings 4 with a gold sill board (func_detail): clear 40 x 104 (x 12..52, z 36..140); outside a stone sill 8 out and a gold head moulding; the glass a func_breakable of glass (material 0, health 40), see-through (rendermode 2, renderamt 70): broken, a crouching player climbs through",
  },
  {
    brushes: [...wallPart(0, 64, 0, 32, { outer: true }), ...wallPart(0, 64, 144, FULL, { outer: true }), ...wallPart(0, 8, 32, 144, { outer: true }), ...wallPart(56, 64, 32, 144, { outer: true })],
    entities: [
      detail([
        box([8, -W, 32], [12, W, 144], P.frame),
        box([52, -W, 32], [56, W, 144], P.frame),
        box([12, -W, 32], [52, W, 36], P.trim),
        box([12, -W, 140], [52, W, 144], P.frame),
        box([4, -W - 8, 26], [60, -W, 32], P.band),
        box([4, -W - 4, 144], [60, -W, 150], P.trim),
      ]),
      brushEntity("func_breakable", [box([12, -1, 36], [52, 1, 140], P.glass)], { material: 0, health: 40, rendermode: 2, renderamt: 70 }),
    ],
  },
);

add({ id: "wall-open", slot: "edge", kinds: ["open"], frame: EDGE_FRAME, notes: "nothing: an edge inside one room" }, null);

{
  const rail = railParts(4, 60);
  add(
    { id: "rail", slot: "rail", kinds: ["rail"], frame: `${EDGE_FRAME}; the void is -y`, notes: "a railing 40 high over a void (func_detail: gold handrail and bottom rail, dark wood balusters 10 apart), and a CLIP from 40 to 96; it runs x 4..60 between the newels of corner-rail (or into a wall's post)" },
    { brushes: [rail.clip], entities: [detail(rail.detail)] },
  );
}

// corners: every mask has the same post, banded as the exterior walls are (its faces of travertine take the brick
// where the assembler says they look outside; its bands are stone all round)
const CORNER_FRAME = "the grid vertex is (0,0); the post stands z 0..192 (16 x 16), the walls of the vertex's edges overlap it by 8; the mask is N 8, E 4, S 2, W 1";
const post = () => {
  const cuts = [0, ...BANDS.flat(), FULL].filter((z, i, all) => all.indexOf(z) === i).sort((a, b) => a - b);
  const brushes = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const inBand = BANDS.some(([lo, hi]) => a >= lo && b <= hi);
    brushes.push(box([-W, -W, a], [W, W, b], inBand ? P.band : P.wall));
  }
  return { brushes, entities: [] };
};
const CORNER_NOTES = "a post 16 x 16 cut at the bands: travertine (brick on its outside faces, which the assembler names) with stone at z 80..96 and 160..192 all round";
add({ id: "corner-L", slot: "corner", kinds: ["wall"], masks: [12, 6, 3, 9], frame: CORNER_FRAME, notes: CORNER_NOTES }, post());
add({ id: "corner-T", slot: "corner", kinds: ["wall"], masks: [14, 13, 11, 7], frame: CORNER_FRAME, notes: CORNER_NOTES }, post());
add({ id: "corner-cross", slot: "corner", kinds: ["wall"], masks: [15], frame: CORNER_FRAME, notes: CORNER_NOTES }, post());
add({ id: "corner-straight", slot: "corner", kinds: ["wall"], masks: [10, 5], frame: CORNER_FRAME, notes: CORNER_NOTES }, post());
add({ id: "corner-end", slot: "corner", kinds: ["wall"], masks: [8, 4, 2, 1], frame: CORNER_FRAME, notes: CORNER_NOTES }, post());
add(
  { id: "corner-rail", slot: "corner", kinds: ["rail"], masks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], frame: "the grid vertex is (0,0); a newel 8 x 8, 44 high, where only rails meet" },
  { brushes: [], entities: [detail([box([-4, -4, 0], [4, 4, 40], P.frame), box([-5, -5, 40], [5, 5, 44], P.trim)])] },
);

const FLOOR_FRAME = "the cell (0,0)..(64,64); the slab z -16..0, its top the floor, its underside the ceiling of the storey below";
add({ id: "floor", slot: "floor", kinds: ["floor"], frame: FLOOR_FRAME, notes: "the palace's marble inlay; gold ornament under it" }, { brushes: [box([0, 0, -16], [64, 64, 0], { top: P.floor, bottom: P.ceiling, sides: P.wall })], entities: [] });
add({ id: "floor-home", slot: "floor", kinds: ["home"], frame: FLOOR_FRAME, notes: "a home's floor of dark wood planks; gold ornament under it" }, { brushes: [box([0, 0, -16], [64, 64, 0], { top: P.home, bottom: P.ceiling, sides: P.wall })], entities: [] });
add(
  { id: "paving", slot: "floor", kinds: ["paving"], frame: "the cell (0,0)..(64,64) of the street or the square; the slab z -16..0, its top the paving", notes: "dark veined marble, laid on the world's grid so neighbouring cells run on" },
  { brushes: [box([0, 0, -16], [64, 64, 0], { top: P.paving, sides: P.stone })], entities: [] },
);
add(
  { id: "ceiling-roof", slot: "ceiling", kinds: ["roof"], frame: "the cell (0,0)..(64,64) of the top storey; z = 0 its floor top; the roof slab z 176..192" },
  { brushes: [box([0, 0, CLEAR], [64, 64, FULL], { top: P.roof, bottom: P.ceiling, sides: P.wall })], entities: [] },
);

// the stair: the house's, stone for wood
{
  const f1 = { top: P.frame, south: P.stone, sides: P.wall };
  const f2 = { top: P.frame, north: P.stone, sides: P.wall };
  const brushes = [];
  for (let i = 1; i <= 5; i++) brushes.push(box([0, 64 + 24 * (i - 1), 0], [64, 64 + 24 * i, 16 * i], f1)); // flight 1, up +y
  brushes.push(box([0, 184, 0], [128, 256, 96], { top: P.frame, south: P.stone, sides: P.wall })); // the landing
  brushes.push(box([68, 64, 0], [128, 184, 96], P.wall)); // under flight 2
  for (let j = 1; j <= 5; j++) brushes.push(box([68, 184 - 24 * j, 96], [128, 184 - 24 * (j - 1), 96 + 16 * j], f2)); // flight 2, up -y
  brushes.push(box([0, 0, 176], [128, 64, FULL], { top: P.floor, bottom: P.ceiling, sides: P.frame })); // the upper landing
  brushes.push(prism("x", [[64, 0], [184, 0], [184, 148], [64, 228]], 64, 68, P.wall)); // the spine between the flights
  brushes.push(wedge([0, 40, 0], [64, 184, 96], "+y", "CLIP"));
  brushes.push(wedge([68, 64, 96], [128, 208, 192], "-y", "CLIP"));
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
      notes: "the house's stair-u, the same brushes: 12 risers of 16 and treads of 24, flight 1 (x 0..64) from y 64 to the landing (y 184..256, z 96), flight 2 (x 68..128) back to the upper landing at z 192; dark marble treads, travertine risers, a gold cap on the spine and a gold-and-wood rail over flight 1; a CLIP ramp over each flight. Foot \"south\" is turn 0, \"east\" 90, \"north\" 180, \"west\" 270",
    },
    {
      brushes,
      entities: [detail([...rail.detail.map(at), prism("x", [[64, 228], [184, 148], [184, 152], [64, 232]], 63, 69, P.trim)])],
    },
  );
}

// lamps
{
  const c = chandelier({ centre: [32, 32], top: CLEAR, drop: 36, radius: 18, tiers: 2, tier: 8, sides: 8, glass: P.lamp, metal: P.metal, lens: "under" });
  add(
    {
      id: "lamp-ceiling", slot: "lamp", kinds: ["ceiling"],
      frame: "the cell (0,0)..(64,64) under a ceiling at z 176; the fitting hangs from it at the cell's middle",
      connectors: [{ type: "ceiling", at: [32, 32, 176], facing: [0, 0, -1] }],
      light: `both: a gold polycandelon of two tiers, gold rings whose undersides and cone are glass wearing ${P.lamp}, a texture light (library.json's texlights: an info_texlights or lights.rad), and a light entity 12 under it (brightness 200) so the room is lit without them; its lowest point at z ${c.low}`,
    },
    { brushes: [], entities: [detail(c.brushes), light(c.light, { color: [255, 220, 170], brightness: 200 })] },
  );
}
{
  const s = sconce({ at: [32, W, 104], facing: 90, width: 16, height: 24, depth: 8, glass: P.sconce, metal: P.metal, shape: "fan" });
  add(
    {
      id: "lamp-wall", slot: "lamp", kinds: ["wall"],
      frame: `${EDGE_FRAME}; the sconce stands on the wall's +y face (y = 8) at x 32, z 104..128`,
      connectors: [{ type: "wall-face", at: [32, W, 104], facing: [0, 1, 0] }],
      light: `both: a gold fan whose glass wears ${P.sconce}, a texture light, and a light entity before it (brightness 60)`,
    },
    { brushes: [], entities: [detail(s.brushes), light(s.light, { color: [255, 226, 180], brightness: 60 })] },
  );
}

// a switch on a wall: the room's lamps (a light switch) or the cells' doors (the jail's control, its face swapped)
export const SWITCH = { x: 112, face: "+0SW3S", jail: "+0SW2S" };
{
  // a gold back plate 14 x 20 and on it the switch, 10 x 14, its face H9's lever (+0SW3S, its +A frame the lever
  // thrown: a toggle button shows its state); one func_button, used and never touched (spawnflags: 1 it does not
  // move, 32 it toggles: it fires its target pressed and again released), the lightswitch's sound (14)
  const back = box([-7, W, 38], [7, W + 1, 58], P.trim);
  const face = box([-5, W + 1, 41], [5, W + 2, 55], fitted(SWITCH.face, [32, 32], [-5, W + 1, 41], [5, W + 2, 55], { whole: true, faces: ["north"], rest: P.trim })); // prettier-ignore
  add(
    {
      id: "switch", slot: "switch", kinds: ["light", "control"],
      frame: `${EDGE_FRAME}; the plate stands on the wall's +y face (y = 8) centred on x 0, z 38..58 (hand height 48); placed at x ${SWITCH.x} of a doorway piece's frame, the latch side, clear of the casing (x 96..100) and of a wall meeting the doorway's end (x 120)`,
      connectors: [{ type: "wall-face", at: [0, W, 48], facing: [0, 1, 0] }],
      named: { key: "target", entity: "func_button", note: "the assembler gives each button its target (the room's lamps' name, or the jail's multi_manager); the piece leaves it unset" },
      notes: `a func_button of two brushes, 2 proud of the wall: a gold back plate 14 x 20 (x -7..7, z 38..58) and the switch 10 x 14 (x -5..5, z 41..55) whose face wears ${SWITCH.face} (H9: a lever on a grey plate; ${SWITCH.face.replace("+0", "+A")} the lever thrown); spawnflags 33 (does not move, toggles), sounds 14 (the lightswitch), wait 1. The jail's control is this piece with its face swapped to ${SWITCH.jail} (a red lamp over a red button)`,
    },
    { brushes: [], entities: [brushEntity("func_button", [back, face], { spawnflags: 33, sounds: 14, wait: 1 })] },
  );
}

// ── the street's pieces ──
{
  // a column of the portico: a travertine plinth and a gold ring, a twelve-sided shaft of dark marble, a gold necking,
  // bell and abacus
  const parts = [
    box([-20, -20, 0], [20, 20, 12], P.stone),
    cylinder("z", [0, 0], 17, 12, 20, P.trim, { sides: 12, snap: 1 }),
    cylinder("z", [0, 0], 13, 20, 148, P.shaft, { sides: 12, snap: 1 }),
    cylinder("z", [0, 0], 15, 148, 152, P.trim, { sides: 12, snap: 1 }),
    frustum(0, 0, 14, 20, 152, 166, P.trim),
    box([-20, -20, 166], [20, 20, CLEAR], P.trim),
  ];
  add(
    {
      id: "column", slot: "column", kinds: ["portico"],
      frame: "the grid vertex is (0,0); the column stands on the floor (or paving) top z 0 and reaches z 176, where the architrave's underside is",
      connectors: [{ type: "architrave-seat", at: [0, 0, 176], facing: [0, 0, 1] }],
      notes: "func_detail: a travertine plinth 40 square, z 0..12; a gold torus (12 sides, 34 across) z 12..20; the shaft, 12 sides 26 across, dark marble, z 20..148; a gold necking z 148..152; a gold bell from 28 to 40 square z 152..166 and a gold abacus 40 square z 166..176. Its top is the architrave's bottom: they meet at 176",
    },
    { brushes: [], entities: [detail(parts)] },
  );
}
add(
  {
    id: "architrave", slot: "architrave", kinds: ["portico"],
    frame: "the edge runs along +x from (0,0) to (64,0), column to column; the beam is centred on y = 0 (y -8..8), z 176..192; the street is -y, the portico +y",
    notes: "a world beam of dark marble 64 x 16 x 16 at z 176..192 resting on the abacus of the column at each end; gold fascias (func_detail) 2 proud along both faces, z 176..180 and 188..192",
  },
  {
    brushes: [box([0, -W, CLEAR], [64, W, FULL], P.frame)],
    entities: [detail([box([0, -W - 2, CLEAR], [64, -W, 180], P.trim), box([0, W, CLEAR], [64, W + 2, 180], P.trim), box([0, -W - 2, 188], [64, -W, FULL], P.trim), box([0, W, 188], [64, W + 2, FULL], P.trim)])],
  },
);
{
  const coffer = fitted(P.ceiling, [256, 256], [0, 0, CLEAR], [64, 64, FULL], { whole: true, faces: ["bottom"], rest: P.frame });
  add(
    {
      id: "portico", slot: "portico", kinds: ["portico"],
      frame: "the cell (0,0)..(64,64) of the portico; z = 0 the paving's top; the slab z 176..192",
      notes: "a world slab z 176..192, its top the roof's cement, its underside one gold medallion (sinceiling3 fitted whole) in a coffer; gold ribs 3 wide and 4 deep (func_detail, z 172..176) round the cell's four sides, so two cells side by side show a rib of 6",
    },
    {
      brushes: [box([0, 0, CLEAR], [64, 64, FULL], { ...coffer, top: P.roof })],
      entities: [detail([
        box([0, 0, 172], [64, 3, CLEAR], P.trim), box([0, 61, 172], [64, 64, CLEAR], P.trim),
        box([0, 3, 172], [3, 61, CLEAR], P.trim), box([61, 3, 172], [64, 61, CLEAR], P.trim),
      ])],
    },
  );
}
{
  // the honorific column, after Constantine's in his forum: three steps, a pedestal, a shaft of dark stone bound by gold
  // rings (as the porphyry drums were by laurel), a gold capital, a drum and a finial
  const c = [96, 96];
  const steps = [box([8, 8, 0], [184, 184, 16], P.stone), box([24, 24, 16], [168, 168, 32], P.stone), box([40, 40, 32], [152, 152, 48], P.stone)];
  const pedestal = [
    box([52, 52, 48], [140, 140, 58], P.frame),
    box([58, 58, 58], [134, 134, 136], P.stone),
    box([52, 52, 136], [140, 140, 146], P.frame),
    box([56, 56, 146], [136, 136, 150], P.trim),
  ];
  const column = [
    cylinder("z", c, 28, 150, 162, P.trim, { sides: 16, snap: 1 }),
    cylinder("z", c, 24, 162, 420, P.porphyry, { sides: 16, snap: 1 }),
    ...[226, 290, 354].map((z) => cylinder("z", c, 26, z, z + 4, P.trim, { sides: 16, snap: 1 })),
    cylinder("z", c, 27, 420, 426, P.trim, { sides: 16, snap: 1 }),
    frustum(96, 96, 26, 36, 426, 444, P.trim),
    box([58, 58, 444], [134, 134, 456], P.trim),
    cylinder("z", c, 14, 456, 480, P.trim, { sides: 12, snap: 1 }),
    cone("z", c, 14, 480, 504, P.trim, { sides: 12, snap: 1 }),
  ];
  add(
    {
      id: "landmark", slot: "landmark", kinds: ["column"],
      frame: "the cells (0,0)..(192,192), 3 x 3; the column's axis at (96,96); z = 0 the paving's top (the square's paving is laid by the assembler under and round it, not part of the piece)",
      footprint: [[0, 0], [192, 192]],
      notes: "func_detail: three travertine steps of 16 (176, 144, 112 square, z 0..48), a pedestal of travertine between dark marble mouldings and a gold band (z 48..150), a gold torus, the shaft 16 sides 48 across of near-black marble z 162..420 bound by three gold rings, a gold capital and abacus (z 420..456), a gold drum and finial to z 504",
    },
    { brushes: [], entities: [detail([...steps, ...pedestal, ...column])] },
  );
}

// ── the skyline's pieces: what stands on the roofs and juts from the fronts, so a block is not a box ──
/** A round frustum on the z axis round (cx, cy): `r0` at z0, `r1` at z1 (0: a point), its rings snapped to whole units. */
const roundFrustum = (cx, cy, r0, r1, z0, z1, tex, sides = 16) => {
  const ring = (r, z) => (r > 0 ? Array.from({ length: sides }, (_, i) => [Math.round(cx + r * Math.cos((2 * Math.PI * i) / sides)), Math.round(cy + r * Math.sin((2 * Math.PI * i) / sides)), z]) : [[cx, cy, z]]); // prettier-ignore
  return solid([...ring(r0, z0), ...ring(r1, z1)], tex);
};
const CROWN_FRAME = `${EDGE_FRAME.replace("z = 0 is the floor top", "z = 0 is the wall's top (the roof's top)")}; the outside is -y`;
add(
  {
    id: "parapet", slot: "crown", kinds: ["parapet"], frame: CROWN_FRAME,
    notes: "the wall of a crenellated parapet on a roof's edge, as the land walls' (func_detail, no clip: no one walks the roofs): stone 16 thick, 2 proud of the brick outside, z 0..24, its top gold, its underside on the wall NULL (no face); one brush, stretched along a straight run of edges by the assembler, with a `merlon` on each edge",
  },
  { brushes: [], entities: [detail([box([0, -10, 0], [64, 6, 24], { sides: P.band, top: P.trim, bottom: "NULL" })])] },
);
add(
  {
    id: "merlon", slot: "crown", kinds: ["merlon"], frame: CROWN_FRAME,
    notes: "a merlon on the parapet's wall at the edge's middle (func_detail, no clip): stone x 20..44, y -10..6, z 24..44, its top gold, so the edges along a roof make battlements of 64; its inner face (+y, over the roof, seen by nobody) NULL",
  },
  { brushes: [], entities: [detail([box([20, -10, 24], [44, 6, 44], { sides: P.band, top: P.trim, north: "NULL" })])] },
);
add(
  {
    id: "merlon-both", slot: "crown", kinds: ["merlon-both"], frame: CROWN_FRAME,
    notes: "the merlon seen from both sides, for a wall with a street on each: as `merlon`, its inner face stone",
  },
  { brushes: [], entities: [detail([box([20, -10, 24], [44, 6, 44], { sides: P.band, top: P.trim })])] },
);
add(
  {
    id: "crown-corner", slot: "crown", kinds: ["corner"], frame: "the grid vertex is (0,0), a roof's outer corner; z = 0 the wall's top",
    notes: "a turret on a roof's corner over the parapets' meeting (func_detail, no clip): a brick pier 28 square z 0..64 (its underside NULL, its top stone), and a gold pyramid to a point at z 96",
  },
  {
    brushes: [],
    entities: [detail([box([-14, -14, 0], [14, 14, 64], { sides: P.brick, top: P.band, bottom: "NULL" }), solid([[-14, -14, 64], [14, -14, 64], [14, 14, 64], [-14, 14, 64], [0, 0, 96]], P.trim)])],
  },
);
/** A Byzantine dome on a drum: the drum `drum` high of radius `r`, a stone ring at its top, the dome a hemisphere of four rings and a cap, a gold lantern and finial. */
function dome(r, drum) {
  const parts = [
    cylinder("z", [0, 0], r, 0, drum - 8, P.brick, { sides: 16, snap: 1 }),
    cylinder("z", [0, 0], r + 4, drum - 8, drum, P.band, { sides: 16, snap: 1 }),
  ];
  const rings = [0, 22.5, 45, 67.5].map((a) => [Math.round(r * Math.cos((a * Math.PI) / 180)), drum + Math.round(r * Math.sin((a * Math.PI) / 180))]);
  for (let i = 0; i + 1 < rings.length; i++) parts.push(roundFrustum(0, 0, rings[i][0], rings[i + 1][0], rings[i][1], rings[i + 1][1], P.trim));
  const [rt, zt] = rings[rings.length - 1];
  const top = drum + r;
  parts.push(roundFrustum(0, 0, rt, 8, zt, top, P.trim));
  parts.push(cylinder("z", [0, 0], 8, top, top + 16, P.band, { sides: 8, snap: 1 }), cone("z", [0, 0], 10, top + 16, top + 40, P.trim, { sides: 8, snap: 1 }));
  return { brushes: [], entities: [detail(parts)] };
}
const DOME_FRAME = "the dome's axis at (0,0), a roof's middle; z = 0 the roof's top";
add({ id: "dome-large", slot: "crown", kinds: ["dome-large"], frame: DOME_FRAME, notes: "func_detail, no clip: a brick drum 16 sides, radius 144, z 0..208 under a stone ring (tall, as the later churches' drums, to stand over the parapets seen from the street); a gold hemisphere to z 352; a stone lantern and a gold finial to z 392. For a roof 6 cells across or more" }, dome(144, 208)); // prettier-ignore
add({ id: "dome", slot: "crown", kinds: ["dome"], frame: DOME_FRAME, notes: "func_detail, no clip: a brick drum 16 sides, radius 88, z 0..176 under a stone ring; a gold hemisphere to z 264; a stone lantern and a gold finial to z 304. For a roof 4 cells across or more" }, dome(88, 176)); // prettier-ignore
add(
  {
    id: "balcony", slot: "front", kinds: ["balcony"], frame: `${EXT_FRAME}; z = 0 the floor top of the window's storey; the balcony stands out to -y`,
    notes: "a balcony under an upper window (func_detail): a dark marble slab x 4..60, 32 out (y -40..-8), z -10..0, on two stone corbels; a stone balustrade 4 thick on its edges z 0..32, its top gold. Nobody steps on it (the window is glass); its underside is at 182 over the street",
  },
  {
    brushes: [],
    entities: [detail([
      box([4, -40, -10], [60, -W, 0], { sides: P.frame, top: P.floor, north: "NULL" }),
      solid([[10, -W, -10], [10, -34, -10], [10, -W, -32], [18, -W, -10], [18, -34, -10], [18, -W, -32]], P.band),
      solid([[46, -W, -10], [46, -34, -10], [46, -W, -32], [54, -W, -10], [54, -34, -10], [54, -W, -32]], P.band),
      box([4, -40, 0], [60, -36, 32], { sides: P.band, top: P.trim }),
      box([4, -36, 0], [8, -W, 32], { sides: P.band, top: P.trim, north: "NULL" }), box([56, -36, 0], [60, -W, 32], { sides: P.band, top: P.trim, north: "NULL" }),
    ])],
  },
);
add(
  {
    id: "hood", slot: "front", kinds: ["hood"], edges: 2, frame: `${DOOR_FRAME}; the outside is -y`,
    notes: "a hood over a street door (func_detail): a dark marble canopy x 16..112, 4 thick, from z 136 at the wall to z 124 at its front, 40 out, a gold edge on its front, on two gold brackets; over the door's head (112) and under the street's glows (150)",
  },
  {
    brushes: [],
    entities: [detail([
      solid([[16, -W, 136], [112, -W, 136], [16, -46, 124], [112, -46, 124], [16, -W, 132], [112, -W, 132], [16, -46, 120], [112, -46, 120]], { sides: P.frame, top: P.roof }),
      box([14, -50, 118], [114, -46, 126], P.trim),
      solid([[20, -W, 132], [20, -40, 122], [20, -W, 100], [24, -W, 132], [24, -40, 122], [24, -W, 100]], P.trim),
      solid([[104, -W, 132], [104, -40, 122], [104, -W, 100], [108, -W, 132], [108, -40, 122], [108, -W, 100]], P.trim),
    ])],
  },
);

// ── the sewer's pieces: the first level under the streets (README, "Below the streets") ──
// Their frame: z 0 is the walkway's top; a tunnel's vault is SEWER_VAULT over it, a channel 32 under it with 16 of
// water; the textures are H9's undercity set (notes-h9.md section 7: po_sewerfloor, po_sewerwall), each part of the
// sewer re-skinned by its look in the theme as the districts are
export const SEWER = {
  wall: "po_sewerwall", // H9: dark wet brick, the tunnels' walls
  floor: "po_sewerfloor", // H9: stained concrete, the walkways and the channel's bed
  kerb: "po_slsidewlkg", // H9: worn kerb slabs, the walkway's edge over the channel and the walls' tops
  vault: "crete3_ceil03c", // H9: coffered concrete, the tunnels' ceiling
  water: "!gwater3", // H9: dark green water (a world brush of water: no entity)
  ladder: "{po_laddrust", // H9: a rusty ladder, masked
  hatch: "{grate1", // H9: an expanded-metal grate, masked: the manhole's lid
  grate: "{po_rustygrtsm", // H9: a rusty square grate, masked: the drain's
  bars: "{grate2", // H9: a riveted grille, masked: the bars across a dead end
  lamp: "po_lightgrtyel", // H9: a caged bulb, a texture light
  metal: "metal5", // H9: rusted steel, the lamp's and the hatch's frames
  stone: "stonewall1", // TS: rough stone, the cistern's plinths
};
/** The sewer's heights in its frame: the vault's underside over the walkway; the channel's bed and its water under it. */
export const SEWER_VAULT = 208;
export const SEWER_CHANNEL = { bed: -32, water: -16 };
const SEWER_FRAME = "z = 0 is the sewer's walkway top (levels/specs' `below.floor`, the street 384 over it in byzantium-01)";
add(
  {
    id: "sewer-wall", slot: "edge", kinds: ["sewer"], frame: `${EDGE_FRAME.replace("z = 0 is the floor top", SEWER_FRAME)}; the wall stands from the channel's bed (-48) to over the vault (224)`, // prettier-ignore
    notes: "one brush of wet brick 16 thick on the edge, z -48..224, its top kerb stone; the assembler stretches it along a straight run (8 past each end, so two runs meet in a corner) and from the floor under the air it closes to the ceiling over it",
  },
  { brushes: [box([0, -W, -48], [64, W, SEWER_VAULT + 16], { sides: SEWER.wall, top: SEWER.kerb })], entities: [] },
);
add(
  {
    id: "sewer-kerb", slot: "edge", kinds: ["kerb"], frame: `${EDGE_FRAME.replace("z = 0 is the floor top", SEWER_FRAME)}; the channel on one side, the walkway on the other`, // prettier-ignore
    notes: "the walkway's edge over the channel: one brush z -48..0, kerb slabs on top, brick down to the channel's bed (32 under the walkway, the water 16 under it)",
  },
  { brushes: [box([0, -W, -48], [64, W, 0], { sides: SEWER.wall, top: SEWER.kerb })], entities: [] },
);
add(
  { id: "sewer-walk", slot: "floor", kinds: ["sewer-walk"], frame: `the cell (0,0)..(64,64); the slab z -16..0, ${SEWER_FRAME}`, notes: "a walkway's slab of stained concrete; joined into rectangles by the assembler as the buildings' floors" }, // prettier-ignore
  { brushes: [box([0, 0, -16], [64, 64, 0], { top: SEWER.floor, sides: SEWER.wall })], entities: [] },
);
add(
  {
    id: "sewer-channel", slot: "floor", kinds: ["sewer-channel"], frame: `the cell (0,0)..(64,64); ${SEWER_FRAME}; the bed's slab z -48..-32, the water -32..-16`, // prettier-ignore
    notes: "the channel: its bed 32 under the walkway and 16 of water over it (a world brush of !gwater3: water to the engine, no entity, its surface 16 under the walkway: a player wades it, and steps out by a jump of 32 or at a bridge)",
  },
  { brushes: [box([0, 0, -48], [64, 64, SEWER_CHANNEL.bed], { top: SEWER.floor, sides: SEWER.wall }), box([0, 0, SEWER_CHANNEL.bed], [64, 64, SEWER_CHANNEL.water], SEWER.water)], entities: [] }, // prettier-ignore
);
add(
  { id: "sewer-vault", slot: "ceiling", kinds: ["sewer"], frame: `the cell (0,0)..(64,64); ${SEWER_FRAME}; the slab z ${SEWER_VAULT}..${SEWER_VAULT + 16}`, notes: "the tunnel's ceiling, coffered concrete under it; placed at the part's own height (a hall's is higher)" }, // prettier-ignore
  { brushes: [box([0, 0, SEWER_VAULT], [64, 64, SEWER_VAULT + 16], { bottom: SEWER.vault, sides: SEWER.wall })], entities: [] }, // prettier-ignore
);
{
  // a steel plate 4 thick on the wall's face, the rungs 2 proud of it (one masked face 32 wide, a rung every 32: the
  // picture at half scale), and the func_ladder the engine climbs, 4 deep before them; all stretched up the shaft by
  // the assembler. The plate's face stands off the grid of 8 (at y 12): a walk test's body at the ladder's top then
  // stands on the plate's top beside its grid's place (reach.mjs: a ladder climbed out of a shaft 48 across)
  const rungs = { north: { name: SEWER.ladder, scale: [0.5, 0.5], offset: [-32, 0] }, sides: "NULL" };
  add(
    {
      id: "ladder", slot: "ladder", kinds: ["rungs"], frame: `${EDGE_FRAME.replace("z = 0 is the floor top", "z = 0 is the floor at its foot")}; a steel plate on the wall's +y face (y 8..12, x 8..56), the ladder before it (x 16..48); 64 high here, stretched up its shaft by the assembler`, // prettier-ignore
      notes: "a world plate of rusted steel 48 x 4 on the wall (y 8..12) from the floor to the top of the shaft, its top flush with the floor over it; the rungs a func_wall 2 proud of it (y 12..14) wearing {po_laddrust masked (rendermode 4), its other faces NULL (the assembler joins every ladder's rungs into one func_wall); a func_ladder 32 x 4 before them (x 16..48, y 12..16; what the engine climbs, unseen: the game draws it at no amount; it wears the rungs' texture, which the .bsp holds, not zhlt.wad's), 16 over the shaft's top to step off by",
    },
    {
      brushes: [box([8, W, 0], [56, W + 4, 64], { sides: SEWER.metal, top: SEWER.kerb })],
      entities: [
        brushEntity("func_ladder", [box([16, W + 4, 0], [48, W + 8, 64], SEWER.ladder)]),
        brushEntity("func_wall", [box([16, W + 4, 0], [48, W + 6, 64], rungs)], { rendermode: 4, renderamt: 255 }),
      ],
    },
  );
}
{
  // a lid over a hole of one cell (its shaft's walls 8 in from each edge: 48 clear): a grate on the street, slid
  // aside by use (func_door, +x, 52 of its 56: lip 4), back after 4 s; or (the drain's) a grate that breaks
  const lid = box([4, 4, 0], [60, 60, 4], { top: SEWER.hatch, bottom: SEWER.hatch, sides: SEWER.metal });
  add(
    {
      id: "hatch", slot: "hatch", kinds: ["manhole", "trapdoor"], frame: "the cell (0,0)..(64,64) over a shaft; z = 0 the street's (or a room's floor) top; the lid lies on it",
      footprint: [[0, 0], [128, 64]],
      open: { entity: "func_door", box: [[56, 4, 0], [112, 60, 4]] },
      notes: "a func_door lid 56 x 56 x 4 lying on the floor over the hole, masked grate on top and under it ({grate1, rendermode 4: the light falls through, the way is seen), rusted steel edges; used, never touched (spawnflags 256), it slides +x 52 (lip 4) over the floor of the cell east of it at speed 80 and back after 4 s; the assembler places it unturned (a func_door's `angles` is the way it moves, which placing does not turn). A den's trapdoor is the same lid wearing its floor's texture, not masked, named as the hideout's doors",
    },
    { brushes: [], entities: [brushEntity("func_door", [lid], { spawnflags: 256, speed: 80, wait: 4, lip: 4, angles: [0, 0, 0], rendermode: 4, renderamt: 255 })] }, // prettier-ignore
  );
  add(
    {
      id: "drain-grate", slot: "hatch", kinds: ["drain"], frame: "the cell (0,0)..(64,64) over a shaft; z = 0 the street's top; the grate lies in the hole, flush",
      notes: "a func_breakable grate 56 x 56 x 4 (z -4..0) wearing {po_rustygrtsm masked (rendermode 4), metal (material 2), health 40: shot or struck open, a way down for good",
    },
    { brushes: [], entities: [brushEntity("func_breakable", [box([4, 4, -4], [60, 60, 0], { top: SEWER.grate, bottom: SEWER.grate, sides: SEWER.metal })], { material: 2, health: 40, rendermode: 4, renderamt: 255 })] }, // prettier-ignore
  );
}
{
  // a caged bulb on a wall: a steel back plate, the cage's faces the lit grate, a light before it
  add(
    {
      id: "lamp-sewer", slot: "lamp", kinds: ["sewer"], frame: `${EDGE_FRAME.replace("z = 0 is the floor top", SEWER_FRAME)}; the fitting on the wall's +y face (y = 8) at x 32, z 126..146`, // prettier-ignore
      connectors: [{ type: "wall-face", at: [32, W, 136], facing: [0, 1, 0] }],
      light: `both: one box 16 x 10 x 20 (x 24..40, z 126..146) whose sides wear ${SEWER.lamp}, a texture light, its top and underside rusted steel, its back on the wall NULL (5 faces: a sewer of 20 lamps); a light entity before it (brightness 85: a tunnel with a lamp every 4 cells lit some 30 of 255 at its median in a draft, dim beside the street's 48)`,
    },
    {
      brushes: [],
      entities: [
        detail([box([24, W, 126], [40, W + 10, 146], { sides: SEWER.lamp, top: SEWER.metal, bottom: SEWER.metal, south: "NULL" })]),
        light([32, W + 28, 132], { color: [255, 196, 120], brightness: 85 }),
      ],
    },
  );
}
add(
  {
    id: "bars", slot: "edge", kinds: ["bars"], frame: `${EDGE_FRAME.replace("z = 0 is the floor top", SEWER_FRAME)}; the grille centred on y = 0, from the channel's bed (-32) to the vault (${SEWER_VAULT})`, // prettier-ignore
    notes: "a riveted grille across a tunnel's end: a func_wall 4 thick wearing {grate2 masked (rendermode 4) on both faces at half scale, its edges NULL; stretched along its run by the assembler, one func_wall for all of the sewer's",
  },
  { brushes: [], entities: [brushEntity("func_wall", [box([0, -2, -32], [64, 2, SEWER_VAULT], { north: { name: SEWER.bars, scale: [0.5, 0.5] }, south: { name: SEWER.bars, scale: [0.5, 0.5] }, sides: "NULL" })], { rendermode: 4, renderamt: 255 })] }, // prettier-ignore
);
export const CISTERN = { vault: 288 };
add(
  {
    id: "cistern-pier", slot: "column", kinds: ["pier"], frame: `the grid vertex is (0,0); ${SEWER_FRAME}; the pier stands on the basin's bed (-32) to the cistern's vault (${CISTERN.vault})`, // prettier-ignore
    notes: `a pier of rough stone in four boxes (func_detail; 24 faces, where the portico's twelve-sided column on a plinth came to some 120): a plinth 48 square from the basin's bed to 96 with a stone cap 56 square to 112 (the water's line and a ledge, as the Basilica Cistern's columns stand on blocks), a shaft 32 square to 264, a capital 48 square to the vault at ${CISTERN.vault}`,
  },
  {
    brushes: [],
    entities: [detail([
      box([-24, -24, -32], [24, 24, 96], SEWER.stone), box([-28, -28, 96], [28, 28, 112], P.band),
      box([-16, -16, 112], [16, 16, 264], SEWER.stone), box([-24, -24, 264], [24, 24, CISTERN.vault], P.band),
    ])],
  },
);

// ── written: the maps, library.json, lights.rad ──
const APPROVALS = "approvals.json";

export function writeLibrary(folder = OUT) {
  mkdirSync(folder, { recursive: true });
  const approvals = existsSync(join(folder, APPROVALS)) ? JSON.parse(readFileSync(join(folder, APPROVALS), "utf8")) : {};
  const approved = (id, text) => approvals[id]?.sha1 === pieceHash(text);
  const entries = PIECES.map(({ entry, made }) => {
    if (!made) return { ...entry, file: null, size: [0, 0, 0], bounds: null, entities: false, approved: approved(entry.id, "") };
    const file = `${entry.id}.map`;
    const text = writeMap({ worldspawn: { wad: WAD_NAMES, _piece: entry.id }, brushes: made.brushes, entities: made.entities });
    writeFileSync(join(folder, file), text);
    const { min, max } = boundsOf(made);
    let open;
    if (entry.open && entry.connectors?.some((c) => c.type.startsWith("doorway"))) {
      const d = doorwayOf({ id: entry.id, map: readMap(text), connectors: entry.connectors, open: entry.open });
      if (d.failures.length) throw new Error(d.failures.join("; "));
      open = { ...entry.open, clear: { width: d.width, height: d.height, span: d.span } };
    }
    return {
      id: entry.id, file, slot: entry.slot, kinds: entry.kinds, ...(entry.edges ? { edges: entry.edges } : {}), ...(entry.masks ? { masks: entry.masks } : {}),
      size: max.map((v, i) => Math.round((v - min[i]) * 100) / 100), bounds: [min, max],
      ...(entry.footprint ? { footprint: entry.footprint } : {}),
      frame: entry.frame, connectors: entry.connectors ?? [], ...(open ? { open } : entry.open ? { open: entry.open } : {}), ...(entry.named ? { named: entry.named } : {}),
      ...(entry.glass ? { glass: entry.glass } : {}), ...(entry.sign ? { sign: entry.sign } : {}),
      entities: made.entities.length > 0,
      ...(entry.cells ? { cells: entry.cells } : {}), ...(entry.light ? { light: entry.light } : {}), ...(entry.notes ? { notes: entry.notes } : {}),
      approved: approved(entry.id, text),
    };
  });
  const library = {
    format: "smak-pieces/1", game: "ts", wad: WAD_NAMES, wadinclude: WADINCLUDE, grid: 64, storeyHeight: 192,
    palette: PALETTE, texlights: TEXLIGHTS, pieces: entries,
  };
  writeFileSync(join(folder, "library.json"), JSON.stringify(library, null, 2) + "\n");
  const rad = Object.entries(TEXLIGHTS).map(([name, v]) => `${name} ${v.join(" ")}`).join("\n");
  writeFileSync(join(folder, "lights.rad"), `// the pieces' texture lights, for VHLT's hlrad (or give the map an info_texlights with the same)\n${rad}\n`);
  return library;
}

// ── the wads: read once, all three ──
const wadFiles = () => [need(WADS.ts, "specialists.wad (--ts-wad, TS_WAD)"), need(WADS.hl, "halflife.wad (--wad, HL_WAD)"), need(WADS.mese, "the H9 wad (--mese-wad, MESE_WAD)")];

async function swatches() {
  const { readWad } = await import("../../../src/maps/wad.mjs");
  const { textureRgba } = await import("../../../src/maps/miptex.mjs");
  const { tile } = await import("../../../src/render.mjs");
  const all = new Map();
  for (const f of wadFiles()) for (const t of readWad(readFileSync(f)).textures) if (!all.has(t.name.toUpperCase())) all.set(t.name.toUpperCase(), { t, wad: basename(f) });
  const [w, h] = [160, 180];
  const cells = [];
  const labels = [];
  for (const name of SWATCHES) {
    const img = { width: w, height: h, rgba: new Uint8Array(w * h * 4) };
    for (let i = 0; i < w * h; i++) img.rgba.set([24, 24, 28, 255], i * 4);
    const found = all.get(name.toUpperCase());
    if (!found) { cells.push(img); labels.push(`${name} MISSING`); continue; }
    const { t } = found;
    const src = textureRgba(t);
    const k = Math.min(w / t.width, (h - 20) / t.height);
    for (let y = 0; y < Math.floor(t.height * k); y++)
      for (let x = 0; x < Math.floor(t.width * k); x++) {
        const i = (Math.floor(y / k) * t.width + Math.floor(x / k)) * 4;
        img.rgba.set([src.rgba[i], src.rgba[i + 1], src.rgba[i + 2], 255], ((y + 20) * w + x) * 4);
      }
    cells.push(img);
    labels.push(`${Object.values(PALETTE).some((n) => n.toUpperCase() === name.toUpperCase()) ? "* " : ""}${t.name} ${t.width}x${t.height}`);
  }
  const out = tile(cells, 8, labels);
  writeFileSync(join(OUT, "swatches.png"), smallPng(out.width, out.height, out.rgba));
  console.log(`swatches: ${SWATCHES.length} textures (* the palette's) in ${join(OUT, "swatches.png")}`);
}

// ── pictures: each piece in a sealed chamber, compiled and drawn ──
const CHAMBER = { floor: "CRETE3_FLR04", ceiling: "CRETE3_FLR04", wall: "CRETE3_WALL01" };

/** What stands round a piece in its chamber, and where it is looked at from. */
function sceneOf(id, lib, { open = false } = {}) {
  const piece = lib.pieces.get(id);
  const get = (pid) => lib.pieces.get(pid);
  const cellsOf = (pid, xs, ys, z = 0) => { for (const x of xs) for (const y of ys) parts.push(placed(get(pid), { at: [x * 64, y * 64, z] })); };
  const parts = [];
  const cells = (xs, ys, z = 0) => cellsOf("floor", xs, ys, z);
  const long = 64 * (piece.edges ?? 1);
  const outerKinds = ["exterior", "facade", "entrance", "shopfront", "window", "shop-window"];
  const outer = piece.slot === "edge" && piece.kinds.some((k) => outerKinds.includes(k));
  const ends = () => {
    for (const x of [0, long]) parts.push(placed(get("corner-end"), { at: [x, 0, 0], outside: outer ? ["south", x ? "east" : "west"] : undefined }));
  };
  let views;
  let deep = false;
  let dim = false;
  const slot = piece.slot;
  if (SEWER_PIECES.has(id)) return sewerScene(id, lib);
  if (slot === "edge" || id === "lamp-wall" || slot === "switch") {
    cells(long > 64 ? [-1, 0, 1, 2] : [-1, 0, 1], [0, 1]);
    cellsOf(outer ? "paving" : "floor", long > 64 ? [-1, 0, 1, 2] : [-1, 0, 1], [-2, -1]);
    ends();
    if (id === "lamp-wall") parts.push(placed(get("wall"), { at: [0, 0, 0] }));
    // a switch beside a doorway, where the assembler puts it (x 112 of the doorway's frame), and the jail's face
    if (slot === "switch") parts.push(placed(get("wall-door"), { at: [-112, 0, 0] }), placed(get("wall"), { at: [16, 0, 0] }), placed(piece, { at: [48, 0, 0] }).entities.map((e) => ({ ...e, brushes: e.brushes.map((b) => ({ ...b, faces: b.faces.map((f) => (f.texture === "+0SW3S" ? { ...f, texture: "+0SW2S" } : f)) })) })).reduce((a, e) => ({ brushes: [], entities: [...a.entities, e] }), { brushes: [], entities: [] }));
    parts.push(placed(piece, { at: [0, 0, 0], open }));
    const m = long / 2;
    views = [
      { name: "inside +y", from: [m + 98, 170, 110], to: [m, 0, 80] },
      { name: "outside -y", from: [m - 102, -170, 110], to: [m, 0, 80] },
      { name: "along the wall", from: [long + 106, 60, 60], to: [m, 0, 60] },
    ];
    if (outer) views[2] = { name: "outside, along the wall", from: [long + 110, -70, 70], to: [m, 0, 90] };
    if (open) views = [
      { name: "OPEN, inside +y", from: [m + 110, 150, 120], to: [m - 8, 20, 60] },
      { name: "OPEN, eye height 64 through it", from: [m, -150, 64], to: [m, 100, 64] },
      { name: "OPEN, eye height 64 from inside", from: [m, 170, 64], to: [m, -100, 64] },
    ];
    if (slot === "switch") { views = [{ name: "beside a door, the jail's face at x 48", from: [10, 150, 70], to: [0, 8, 48] }, { name: "the switch at the eye, 48 away", from: [0, 56, 64], to: [0, 8, 48] }, { name: "from the side", from: [36, 30, 52], to: [0, 9, 48] }]; dim = false; }
    if (id === "lamp-wall") { views = [{ name: "the sconce", from: [100, 110, 90], to: [32, 8, 116] }, { name: "below", from: [40, 60, 40], to: [32, 8, 116] }]; dim = true; }
  } else if (slot === "rail") {
    cells([-1, 0, 1], [0, 1]);
    deep = true;
    parts.push(placed(get("corner-rail"), { at: [0, 0, 0] }), placed(get("corner-rail"), { at: [64, 0, 0] }));
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [{ name: "from the floor", from: [90, 140, 100], to: [32, 0, 20] }, { name: "from the void", from: [-30, -150, -40], to: [32, 0, 10] }];
  } else if (slot === "corner") {
    const mask = piece.masks[0];
    cells([-2, -1, 0, 1], [-2, -1, 0, 1]);
    const ways = [[8, 90], [4, 0], [2, 270], [1, 180]];
    for (const [bit, turn] of ways) if (mask & bit) parts.push(placed(get(id === "corner-rail" ? "rail" : "wall-exterior"), { at: [0, 0, 0], turn }));
    // the exterior walls' outsides look away from the vertex's first quadrant: the post's faces that way take the brick
    parts.push(placed(piece, { at: [0, 0, 0], outside: id === "corner-rail" ? undefined : ["south", "west"] }));
    views = [{ name: `mask ${mask} from sw`, from: [-170, -150, 260], to: [0, 0, 60] }, { name: "from ne", from: [170, 150, 260], to: [0, 0, 60] }];
  } else if (slot === "floor") {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) parts.push(placed(piece, { at: [x * 64, y * 64, 0] }));
    views = [{ name: "2 x 2 cells", from: [200, -80, 120], to: [64, 64, 0] }];
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
    views = [{ name: "the lamp", from: [-90, -90, 70], to: [32, 32, 150] }];
    dim = true;
  } else if (slot === "column") {
    cellsOf("paving", [-2, -1, 0, 1], [-2, -1, 0, 1]);
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [{ name: "from the street", from: [-150, -170, 110], to: [0, 0, 90] }, { name: "the capital", from: [70, -60, 130], to: [0, 0, 165] }, { name: "the base", from: [60, -70, 40], to: [0, 0, 12] }];
  } else if (slot === "architrave" || slot === "portico") {
    // a portico of two bays: columns at (0,0), (64,0), (128,0), architraves between them, its ceiling over the two
    // cells behind them, and a facade at y 64 closing it
    cellsOf("paving", [-1, 0, 1, 2], [-2, -1, 0]);
    for (const x of [0, 64, 128]) parts.push(placed(get("column"), { at: [x, 0, 0] }));
    for (const x of [0, 64]) parts.push(placed(get("architrave"), { at: [x, 0, 0] }), placed(get("portico"), { at: [x, 0, 0] }));
    for (const x of [0, 64]) parts.push(placed(get("facade"), { at: [x, 64, 0] }));
    views = [
      { name: "from the street", from: [200, -200, 120], to: [64, 32, 140] },
      { name: "under the portico", from: [150, 40, 56], to: [10, 24, 172] },
      { name: "the architrave on the capitals", from: [96, -70, 150], to: [64, 0, 178] },
      { name: "from above", from: [-80, -160, 380], to: [64, 32, 192] },
    ];
  } else if (slot === "crown" || slot === "front") {
    // a block of n x n cells, `storeys` high, its outside walls and corners, its roof; the crown round its roof's edge
    // (and the dome at its middle), or the front piece on its south side
    const n = id === "dome-large" ? 6 : slot === "front" ? 3 : 4;
    const storeys = slot === "front" ? 2 : 1;
    const top = storeys * FULL;
    cellsOf("paving", [-2, -1, ...Array.from({ length: n }, (_, i) => i), n, n + 1], [-3, -2, -1]);
    for (let s = 0; s < storeys; s++) {
      const z = s * FULL;
      for (let i = 0; i < n; i++) {
        const southWall = slot === "front" && i < 2 && s === 0 && id === "hood" ? null : slot === "front" && i === 1 && s === 1 ? "wall-window" : "wall-exterior";
        if (southWall) parts.push(placed(get(southWall), { at: [i * 64, 0, z], turn: 0 }));
        parts.push(placed(get("wall-exterior"), { at: [(i + 1) * 64, n * 64, z], turn: 180 }));
        parts.push(placed(get("wall-exterior"), { at: [0, (i + 1) * 64, z], turn: 270 }));
        parts.push(placed(get("wall-exterior"), { at: [n * 64, i * 64, z], turn: 90 }));
      }
      if (id === "hood" && s === 0) parts.push(placed(get("wall-entrance"), { at: [0, 0, 0] }));
      for (const [at, mask, outside] of [[[0, 0, z], 12, ["south", "west"]], [[n * 64, 0, z], 9, ["south", "east"]], [[n * 64, n * 64, z], 3, ["north", "east"]], [[0, n * 64, z], 6, ["north", "west"]]])
        parts.push(placed(pieceFor(lib, "corner", mask), { at, outside }));
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) parts.push(placed(get(s === storeys - 1 ? "ceiling-roof" : "floor"), { at: [x * 64, y * 64, s === storeys - 1 ? z : z + FULL] }));
    }
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) parts.push(placed(get("floor"), { at: [x * 64, y * 64, 0] }));
    const far = n * 64;
    if (slot === "crown") {
      for (let i = 0; i < n; i++) {
        for (const [at, turn] of [[[i * 64, 0, top], 0], [[(i + 1) * 64, far, top], 180], [[0, (i + 1) * 64, top], 270], [[far, i * 64, top], 90]])
          parts.push(placed(get("parapet"), { at, turn }), placed(get("merlon"), { at, turn }));
      }
      for (const at of [[0, 0, top], [far, 0, top], [far, far, top], [0, far, top]]) parts.push(placed(get("crown-corner"), { at }));
      if (piece.kinds[0].startsWith("dome")) parts.push(placed(piece, { at: [far / 2, far / 2, top] }));
      views = [
        { name: "from the street", from: [far + 260, -320, 120], to: [far / 2, far / 2, top + 40] },
        { name: "from a roof's height", from: [-200, -260, top + 160], to: [far / 2, far / 2, top + 30] },
        { name: "the corner", from: [-90, -110, top + 70], to: [0, 0, top + 30] },
      ];
    } else {
      parts.push(placed(piece, { at: [id === "hood" ? 0 : 64, 0, id === "hood" ? 0 : FULL] }));
      views = id === "hood"
        ? [{ name: "from the street", from: [260, -260, 100], to: [64, 0, 110] }, { name: "under it", from: [64, -110, 60], to: [64, -10, 130] }, { name: "from the side", from: [-150, -60, 120], to: [64, -20, 120] }]
        : [{ name: "from the street", from: [300, -300, 120], to: [96, 0, 220] }, { name: "from under it", from: [96, -110, 70], to: [96, -20, 190] }, { name: "from the side", from: [-160, -70, 230], to: [96, -20, 210] }];
    }
  } else if (slot === "landmark") {
    cellsOf("paving", [-1, 0, 1, 2, 3], [-1, 0, 1, 2, 3]);
    parts.push(placed(piece, { at: [0, 0, 0] }));
    views = [
      { name: "from the square", from: [-260, -300, 120], to: [96, 96, 250] },
      { name: "the plinth", from: [-60, -90, 70], to: [96, 96, 60] },
      { name: "the capital and finial", from: [-80, -120, 420], to: [96, 96, 460] },
    ];
  }
  return { parts, views, deep, dim };
}

/** The sewer's pieces, drawn in a stretch of tunnel of their own (README, "Below the streets"). */
const SEWER_PIECES = new Set(["sewer-wall", "sewer-kerb", "sewer-walk", "sewer-channel", "sewer-vault", "ladder", "hatch", "drain-grate", "lamp-sewer", "bars", "cistern-pier"]); // prettier-ignore
/**
 * A tunnel 3 cells across (a walkway, the channel, a walkway) and 3 long, open at both ends (the chamber's light comes
 * in there), its walls, kerbs, vault and a lamp; a shaft over the north walkway's middle cell up to a street 384 over
 * it, its ladder on its north wall and the lid (or the drain's grate) on it; bars across the east end. The cistern's
 * pier stands alone on a basin with its vault over it.
 */
function sewerScene(id, lib) {
  const get = (pid) => lib.pieces.get(pid);
  const parts = [];
  const put = (pid, at, turn = 0) => parts.push(placed(get(pid), { at, turn }));
  const STREET = 384;
  if (id === "cistern-pier") {
    for (const x of [-2, -1, 0, 1]) for (const y of [-2, -1, 0, 1]) {
      put(Math.abs(x + 0.5) < 1 && Math.abs(y + 0.5) < 1 ? "sewer-channel" : "sewer-walk", [x * 64, y * 64, 0]);
      put("sewer-vault", [x * 64, y * 64, 80]);
    }
    put("cistern-pier", [0, 0, 0]);
    return { parts, views: [{ name: "the pier over its basin", from: [-150, -170, 60], to: [0, 0, 140] }, { name: "its plinth at the water", from: [70, -80, 20], to: [0, 0, 40] }], deep: true, dim: false }; // prettier-ignore
  }
  for (let x = 0; x < 3; x++) {
    put("sewer-walk", [x * 64, 0, 0]);
    put("sewer-channel", [x * 64, 64, 0]);
    put("sewer-walk", [x * 64, 128, 0]);
    if (x !== 1) put("sewer-vault", [x * 64, 128, 0]);
    put("sewer-vault", [x * 64, 0, 0]);
    put("sewer-vault", [x * 64, 64, 0]);
    put("sewer-wall", [x * 64, 0, 0]); // the south wall, its face north
    put("sewer-wall", [(x + 1) * 64, 192, 0], 180); // the north wall, its face south
    put("sewer-kerb", [x * 64, 64, 0]);
    put("sewer-kerb", [(x + 1) * 64, 128, 0], 180);
  }
  // the shaft over the north walkway's middle cell, its walls over the vault to the street, the street round it
  for (const z of [160]) {
    put("sewer-wall", [128, 192, z], 180);
    put("sewer-wall", [64, 128, z]);
    put("sewer-wall", [64, 128, z], 90);
    put("sewer-wall", [128, 192, z], 270);
  }
  for (const x of [-1, 0, 1, 2, 3]) for (const y of [0, 1, 2, 3, 4]) if (!(x === 1 && y === 2)) put("paving", [x * 64, y * 64, STREET]);
  for (let z = 0; z < STREET; z += 64) put("ladder", [128, 192, z], 180);
  put(id === "drain-grate" ? "drain-grate" : "hatch", [64, 128, STREET]);
  put("lamp-sewer", [64, 0, 0]);
  for (const y of [0, 1, 2]) put("bars", [192, y * 64, 0], 90);
  const views = {
    "sewer-wall": [{ name: "along the tunnel, west", from: [-160, 96, 130], to: [150, 96, 70] }, { name: "a wall and the vault", from: [40, 150, 40], to: [130, 0, 140] }],
    "sewer-kerb": [{ name: "the kerbs over the channel", from: [-120, 40, 90], to: [120, 100, -20] }, { name: "a kerb's edge", from: [20, 30, 30], to: [90, 70, -20] }],
    "sewer-walk": [{ name: "the walkways", from: [-140, 30, 70], to: [150, 60, 0] }],
    "sewer-channel": [{ name: "the channel and its water", from: [-120, 96, 60], to: [140, 96, -24] }, { name: "from the walkway", from: [40, 16, 60], to: [110, 100, -20] }],
    "sewer-vault": [{ name: "the vault", from: [-120, 96, 60], to: [120, 96, 208] }],
    "lamp-sewer": [{ name: "the lamp", from: [130, 110, 110], to: [96, 8, 136] }, { name: "below", from: [96, 60, 40], to: [96, 10, 136] }],
    bars: [{ name: "the bars at the tunnel's end", from: [20, 96, 110], to: [192, 96, 90] }, { name: "through them", from: [300, 60, 100], to: [150, 96, 80] }],
    ladder: [{ name: "the ladder up the shaft", from: [96, 150, 40], to: [96, 186, 300] }, { name: "its foot", from: [60, 60, 70], to: [96, 186, 60] }],
    hatch: [{ name: "the lid on the street", from: [-60, 40, 470], to: [96, 160, STREET] }, { name: "the lid from below", from: [96, 150, 120], to: [96, 160, STREET] }],
    "drain-grate": [{ name: "the drain's grate on the street", from: [-60, 40, 470], to: [96, 160, STREET] }, { name: "from below", from: [96, 150, 120], to: [96, 160, STREET] }],
  };
  return { parts, views: views[id], deep: true, dim: id === "lamp-sewer" };
}

async function pictures(work) {
  const { compileMap } = await import("../../../src/maps/compile.mjs");
  const { readBsp } = await import("../../../src/maps/bsp.mjs");
  const { drawMap, sectionOf, planOf } = await import("../../../src/maps/draw.mjs");
  const { readWad } = await import("../../../src/maps/wad.mjs");
  const { tile } = await import("../../../src/render.mjs");
  const png = smallPng;
  mkdirSync(work, { recursive: true });
  const pics = join(OUT, "pictures");
  mkdirSync(pics, { recursive: true });
  const lib = loadLibrary(OUT);
  const wads = wadFiles();
  const textures = wads.flatMap((f) => readWad(readFileSync(f)).textures);
  const folder = need(VHLT, "the VHLT folder (--vhlt, VHLT_DIR)");
  const sheet = [];
  const names = [];
  const report = [];
  const compile = (file, tag) => {
    const result = compileMap(file, { wads, wadinclude: WADINCLUDE, fast: true, compilers: { folder } });
    report.push(`${tag}: ${result.bsp ? "compiled" : "FAILED"}${result.errors.length ? ` errors: ${result.errors.join(" | ")}` : ""}${result.leak ? " LEAK" : ""}`);
    for (const w of result.warnings) report.push(`${tag}: WARN ${w}`);
    return result.bsp ? readBsp(readFileSync(result.bsp)) : null;
  };
  const chamber = (id, piece, { parts, deep, dim }, tag = "") => {
    const brushes = parts.flatMap((p) => p.brushes);
    const entities = parts.flatMap((p) => p.entities);
    const { min, max } = boundsOf({ brushes, entities });
    const lo = [min[0] - 200, min[1] - 200, deep ? -224 : Math.min(min[2], -16)];
    const hi = [max[0] + 200, max[1] + 200, Math.max(max[2], FULL) + 200];
    const map = {
      worldspawn: { wad: wads },
      brushes: [...hollow(lo, hi, 16, CHAMBER), ...brushes],
      entities: [
        playerStart([lo[0] + 40, lo[1] + 40, lo[2]], 45),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
          light([(min[0] + max[0]) / 2 + sx * ((max[0] - min[0]) / 2 + 100), (min[1] + max[1]) / 2 + sy * ((max[1] - min[1]) / 2 + 100), Math.max(max[2], CLEAR) + 40], { brightness: dim ? 25 : 260 })),
        textureLights([lo[0] + 40, lo[1] + 40, hi[2] - 40], TEXLIGHTS),
        ...(piece.slot === "ceiling" ? [light([64, 64, 90], { brightness: 160 })] : []),
        ...(piece.slot === "portico" || piece.slot === "architrave" ? [light([64, 32, 120], { brightness: 140 })] : []),
        ...entities,
      ],
    };
    const file = join(work, `${id}${tag}.map`);
    writeFileSync(file, writeMap(map));
    return { map, bsp: compile(file, `${id}${tag}`) };
  };
  const only = flag("--only")?.split(",");
  for (const [id, piece] of lib.pieces) {
    if (!piece.file || (only && !only.includes(id))) continue;
    const scene = sceneOf(id, lib);
    if (!scene.views) continue;
    const { map, bsp } = chamber(id, piece, scene);
    if (!bsp) continue;
    const { views } = scene;
    const shots = views.map((v) => drawMap(bsp, { from: v.from, to: v.to, textures, width: 400, height: 300, entities: false }));
    const labels = views.map((v) => `${id}: ${v.name}`);
    if (piece.slot === "stair") {
      for (const x of [32, 96]) {
        shots.push(fitTo(sectionOf(map, { from: [x, -60], to: [x, 280], scale: 1.0, z: [-24, 248] }), 400, 300));
        labels.push(`${id}: section x ${x}`);
      }
    }
    if (piece.slot === "landmark" || piece.slot === "column") {
      const c = piece.slot === "landmark" ? 96 : 0;
      shots.push(fitTo(sectionOf(map, { from: [c - 140, c], to: [c + 140, c], scale: piece.slot === "landmark" ? 0.55 : 1.4, z: [-24, piece.slot === "landmark" ? 520 : 200] }), 400, 300));
      labels.push(`${id}: section through its axis`);
    }
    if (piece.open && piece.connectors?.some((c) => c.type.startsWith("doorway"))) {
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
        labels.push(`${id}: OPEN, plan at z 64: ${line}`);
      }
    }
    const one = tile(shots, Math.min(shots.length, 3), labels);
    writeFileSync(join(pics, `${id}.png`), png(one.width, one.height, one.rgba));
    sheet.push(drawMap(bsp, { from: views[0].from, to: views[0].to, textures, width: 320, height: 240, entities: false }));
    names.push(id);
  }
  if (!only) {
    const all = tile(sheet, 5, names);
    writeFileSync(join(OUT, "sheet.png"), png(all.width, all.height, all.rgba));
  }
  // the joins: a shop of 3 x 2 cells on the street, its portico in front, put together from the pieces
  if (!only || only.includes("joins")) {
    const room = joinsStreet(lib, wads);
    const file = join(work, "joins.map");
    writeFileSync(file, writeMap(room.map));
    const bsp = compile(file, "joins");
    if (bsp) {
      const shots = room.views.map((v) => drawMap(bsp, { from: v.from, to: v.to, textures, width: 400, height: 300, entities: false }));
      const one = tile(shots, 3, room.views.map((v) => `joins: ${v.name}`));
      writeFileSync(join(pics, "joins.png"), png(one.width, one.height, one.rgba));
    }
  }
  console.log(report.join("\n"));
}

/** A shop of 3 x 2 cells from the pieces: a shopfront and a shop window on the street (south, y 0), its portico of three bays in front on four columns, walls with a window, a lamp, the street paved. */
function joinsStreet(lib, wads) {
  const parts = [];
  const put = (id, at, turn = 0, outside) => parts.push(placed(lib.pieces.get(id), { at, turn, outside }));
  for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) { put("floor", [x * 64, y * 64, 0]); put("ceiling-roof", [x * 64, y * 64, 0]); }
  for (let x = -2; x < 5; x++) for (let y = -4; y < 0; y++) put("paving", [x * 64, y * 64, 0]);
  for (let y = 0; y < 3; y++) { put("paving", [-128, y * 64, 0]); put("paving", [-64, y * 64, 0]); put("paving", [192, y * 64, 0]); put("paving", [256, y * 64, 0]); }
  for (let x = -2; x < 5; x++) put("paving", [x * 64, 128, 0]);
  // the street front: shopfront x 0..128 and a shop window x 128..192 (run +x, inside +y)
  put("shopfront", [0, 0, 0]); put("shop-window", [128, 0, 0]);
  put("wall-exterior", [192, 0, 0], 90); put("wall-exterior", [192, 64, 0], 90);
  put("wall-exterior", [192, 128, 0], 180); put("wall-window", [128, 128, 0], 180); put("wall-exterior", [64, 128, 0], 180);
  put("wall-exterior", [0, 128, 0], 270); put("wall-exterior", [0, 64, 0], 270);
  for (const [at, mask, outside] of [
    [[0, 0, 0], 12, ["south", "west"]], [[192, 0, 0], 9, ["south", "east"]], [[192, 128, 0], 3, ["north", "east"]], [[0, 128, 0], 6, ["north", "west"]],
    [[128, 0, 0], 5, ["south"]], [[192, 64, 0], 10, ["east"]], [[128, 128, 0], 5, ["north"]], [[64, 128, 0], 5, ["north"]], [[0, 64, 0], 10, ["west"]],
  ]) parts.push(placed(pieceFor(lib, "corner", mask), { at, outside }));
  // the portico: cells y -64..0, columns on the street line y = -64, the architrave between them
  for (let x = 0; x < 3; x++) put("portico", [x * 64, -64, 0]);
  for (let x = 0; x <= 3; x++) put("column", [x * 64, -64, 0]);
  for (let x = 0; x < 3; x++) put("architrave", [x * 64, -64, 0]);
  put("lamp-ceiling", [64, 64, 0]); put("lamp-wall", [192, 0, 0], 90);
  const brushes = parts.flatMap((p) => p.brushes);
  const entities = parts.flatMap((p) => p.entities);
  const lo = [-400, -500, -16];
  const hi = [600, 420, 460];
  const map = {
    worldspawn: { wad: wads },
    brushes: [...hollow(lo, hi, 16, CHAMBER), ...brushes],
    entities: [
      playerStart([-200, -300, 0], 45),
      ...[[-250, -400], [450, -400], [450, 350], [-250, 350]].map(([x, y]) => light([x, y, 340], { brightness: 300 })),
      light([96, -32, 120], { brightness: 120 }),
      textureLights([-360, -460, 420], TEXLIGHTS),
      ...entities,
    ],
  };
  const views = [
    { name: "the street front from the south east", from: [380, -330, 150], to: [96, -20, 100] },
    { name: "the street front from the south west", from: [-220, -300, 140], to: [96, -20, 100] },
    { name: "under the portico, to the shopfront", from: [160, -32, 64], to: [20, -4, 96] },
    { name: "inside: the shopfront", from: [130, 110, 64], to: [64, 0, 70] },
    { name: "inside: the shop window", from: [60, 100, 70], to: [160, 0, 80] },
    { name: "from above", from: [-150, -420, 420], to: [96, 0, 120] },
  ];
  return { map, views };
}

// ── run ──
if (process.argv[1]?.split("\\").join("/").endsWith("pieces/make-mese.mjs")) {
  writeLibrary(OUT);
  const lib = loadLibrary(OUT);
  const files = [WADS.ts, WADS.hl, WADS.mese];
  if (files.every((f) => f && existsSync(f))) {
    const { wadTextureNames } = await import("../../../src/maps/plan.mjs");
    const names = files.flatMap((f) => wadTextureNames(readFileSync(f)));
    const check = checkTextures(lib, names, WAD_NAMES.join(" + "));
    console.log(check.failures.length ? `FAIL: ${check.failures.join("; ")}` : `PASS: every texture of the ${lib.pieces.size} pieces is in ${WAD_NAMES.join(", ")} (${check.used.length} names)`);
    if (check.failures.length) process.exitCode = 1;
  } else console.log(`(the three wads are not all given (TS_WAD, HL_WAD, MESE_WAD): the textures are not checked)`);
  if (args.includes("--swatches")) await swatches();
  const work = flag("--pictures");
  if (work) await pictures(work);
}
