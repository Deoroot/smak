// Xash3D's BSP2 read beside version 30: one small map written here in both layouts (no game file), told
// apart by its header, read into the same shape with the same numbers, walked, lit and seen alike; BSP2's
// 32 bit numbers and float boxes kept whole; a BSP2 map whose light is grey; and checkBsp on each.
import * as maps from "../check/maps/index.mjs";
import { test, sure } from "./helper.mjs";

// ── the map: a closed room 128 x 128 x 128, its floor at z 0 ──
// its six sides, each looking in: floor, ceiling, then the walls at x 0 and 128, y 0 and 128
const SIDES = [
  [[0, 0, 1], 0],
  [[0, 0, -1], -128],
  [[1, 0, 0], 0],
  [[-1, 0, 0], -128],
  [[0, 1, 0], 0],
  [[0, -1, 0], -128],
];
// planes 0 to 5 the room's sides; 6 to 11 the same moved in by half a standing player (16 across, 36 up)
const STANDING = [36, 36, 16, 16, 16, 16];
const PLANES = [
  ...SIDES.map(([normal, dist]) => ({ normal, dist, type: normal.findIndex(Boolean) })),
  ...SIDES.map(([normal, dist], side) => ({ normal, dist: dist + STANDING[side], type: normal.findIndex(Boolean) })),
];
const VERTICES = [
  [0, 0, 0],
  [128, 0, 0],
  [128, 128, 0],
  [0, 128, 0],
];
// edge 0 is not used: a surfedge of 0 could not be walked backwards
const EDGES = [
  [0, 0],
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];
const SURFEDGES = [1, 2, 3, 4];
const TEXINFO = [{ s: [1, 0, 0, 0], t: [0, 1, 0, 0], texture: 0, flags: 0 }];
const FACES = [
  { plane: 0, side: 0, firstEdge: 0, edgeCount: 4, texinfo: 0, styles: [0, 255, 255, 255], lightOffset: 0 },
];
// node N cuts at side N: behind it leaf 0 (solid), in front node N + 1, and in front of the last leaf 1 (open)
const NODES = SIDES.map((_, side) => ({
  plane: side,
  children: [side < SIDES.length - 1 ? side + 1 : -2, -1],
  mins: [0, 0, 0],
  maxs: [128, 128, 128],
  firstFace: 0,
  faceCount: side === 0 ? 1 : 0,
}));
const LEAVES = [
  { contents: -2, visOffset: -1, mins: [0, 0, 0], maxs: [0, 0, 0], firstMarkSurface: 0, markSurfaceCount: 0, ambient: [0, 0, 0, 0] },
  { contents: -1, visOffset: 0, mins: [0, 0, 0], maxs: [128, 128, 128], firstMarkSurface: 0, markSurfaceCount: 1, ambient: [1, 2, 3, 4] },
];
const MARKSURFACES = [0];
// hulls 1 to 3: the same chain over the moved planes, a child under 0 being the contents (-1 empty, -2 solid)
const CLIPNODES = SIDES.map((_, side) => ({
  plane: SIDES.length + side,
  children: [side < SIDES.length - 1 ? side + 1 : -1, -2],
}));
const MODELS = [
  { mins: [0, 0, 0], maxs: [128, 128, 128], origin: [0, 0, 0], headNodes: [0, 0, 0, 0], visLeaves: 1, firstFace: 0, faceCount: 1 },
];
// a 128 unit face with its texture's axes along x and y: 9 x 9 samples of light
const SAMPLES = 9 * 9;
const LIGHT_RGB = Buffer.from(Array.from({ length: SAMPLES * 3 }, (_, at) => (at * 7) % 256));
const LIGHT_GREY = Buffer.from(Array.from({ length: SAMPLES }, (_, at) => (at * 3) % 256));
// leaf 1 sees leaf 1
const VISIBILITY = Buffer.from([0x01]);
const ENTITIES = '{\n"classname" "worldspawn"\n"wad" "\\\\half-life\\\\valve\\\\halflife.wad"\n}\n{\n"classname" "info_player_start"\n"origin" "64 64 64"\n}\n\0';

const BSP2 = 0x32505342;
/** The lumps' order in the header (lumps.mjs, as bspfile.h). */
const ORDER = ["entities", "planes", "textures", "vertices", "visibility", "nodes", "texinfo", "faces", "lighting", "clipnodes", "leaves", "marksurfaces", "edges", "surfedges", "models"]; // prettier-ignore

/** A list of entries written one after another, `write(buffer, entry)` filling each of `size` bytes. */
function packed(list, size, write) {
  const out = Buffer.alloc(list.length * size);
  list.forEach((entry, nth) => write(out.subarray(nth * size, (nth + 1) * size), entry));
  return out;
}
const floats = (b, at, values) => values.forEach((value, nth) => b.writeFloatLE(value, at + nth * 4));
const shorts = (b, at, values) => values.forEach((value, nth) => b.writeInt16LE(value, at + nth * 2));
const ints = (b, at, values) => values.forEach((value, nth) => b.writeInt32LE(value, at + nth * 4));

/** The textures lump: one texture, "floor", 16 x 16, wanted from a .wad (no pixels). */
function texturesLump() {
  const out = Buffer.alloc(8 + 40);
  out.writeInt32LE(1, 0);
  out.writeInt32LE(8, 4);
  out.write("floor", 8, "latin1");
  out.writeUInt32LE(16, 8 + 16);
  out.writeUInt32LE(16, 8 + 20);
  return out;
}

/**
 * The map's file in one layout: `format` "bsp30" or "bsp2". `map` the lists above, changed where a case
 * wants; `light` the lighting lump.
 */
function written(format, map = {}, light = LIGHT_RGB) {
  const m = { PLANES, VERTICES, EDGES, SURFEDGES, TEXINFO, FACES, NODES, LEAVES, MARKSURFACES, CLIPNODES, MODELS, ...map }; // prettier-ignore
  const wide = format === "bsp2";
  const lumps = {
    entities: Buffer.from(ENTITIES, "latin1"),
    planes: packed(m.PLANES, 20, (b, p) => {
      floats(b, 0, [...p.normal, p.dist]);
      b.writeInt32LE(p.type, 16);
    }),
    textures: texturesLump(),
    vertices: packed(m.VERTICES, 12, (b, v) => floats(b, 0, v)),
    visibility: VISIBILITY,
    nodes: wide
      ? packed(m.NODES, 44, (b, n) => {
          ints(b, 0, [n.plane, ...n.children]);
          floats(b, 12, [...n.mins, ...n.maxs]);
          ints(b, 36, [n.firstFace, n.faceCount]);
        })
      : packed(m.NODES, 24, (b, n) => {
          b.writeInt32LE(n.plane, 0);
          shorts(b, 4, [...n.children, ...n.mins, ...n.maxs]);
          b.writeUInt16LE(n.firstFace, 20);
          b.writeUInt16LE(n.faceCount, 22);
        }),
    texinfo: packed(m.TEXINFO, 40, (b, t) => {
      floats(b, 0, [...t.s, ...t.t]);
      ints(b, 32, [t.texture, t.flags]);
    }),
    faces: wide
      ? packed(m.FACES, 28, (b, f) => {
          ints(b, 0, [f.plane, f.side, f.firstEdge, f.edgeCount, f.texinfo]);
          Buffer.from(f.styles).copy(b, 20);
          b.writeInt32LE(f.lightOffset, 24);
        })
      : packed(m.FACES, 20, (b, f) => {
          b.writeUInt16LE(f.plane, 0);
          b.writeUInt16LE(f.side, 2);
          b.writeInt32LE(f.firstEdge, 4);
          b.writeUInt16LE(f.edgeCount, 8);
          b.writeUInt16LE(f.texinfo, 10);
          Buffer.from(f.styles).copy(b, 12);
          b.writeInt32LE(f.lightOffset, 16);
        }),
    lighting: light,
    clipnodes: wide
      ? packed(m.CLIPNODES, 12, (b, c) => ints(b, 0, [c.plane, ...c.children]))
      : packed(m.CLIPNODES, 8, (b, c) => {
          b.writeInt32LE(c.plane, 0);
          shorts(b, 4, c.children);
        }),
    leaves: wide
      ? packed(m.LEAVES, 44, (b, l) => {
          ints(b, 0, [l.contents, l.visOffset]);
          floats(b, 8, [...l.mins, ...l.maxs]);
          ints(b, 32, [l.firstMarkSurface, l.markSurfaceCount]);
          Buffer.from(l.ambient).copy(b, 40);
        })
      : packed(m.LEAVES, 28, (b, l) => {
          ints(b, 0, [l.contents, l.visOffset]);
          shorts(b, 8, [...l.mins, ...l.maxs]);
          b.writeUInt16LE(l.firstMarkSurface, 20);
          b.writeUInt16LE(l.markSurfaceCount, 22);
          Buffer.from(l.ambient).copy(b, 24);
        }),
    marksurfaces: wide
      ? packed(m.MARKSURFACES, 4, (b, face) => b.writeInt32LE(face, 0))
      : packed(m.MARKSURFACES, 2, (b, face) => b.writeUInt16LE(face, 0)),
    edges: wide
      ? packed(m.EDGES, 8, (b, e) => ints(b, 0, e))
      : packed(m.EDGES, 4, (b, e) => e.forEach((v, nth) => b.writeUInt16LE(v, nth * 2))),
    surfedges: packed(m.SURFEDGES, 4, (b, s) => b.writeInt32LE(s, 0)),
    models: packed(m.MODELS, 64, (b, model) => {
      floats(b, 0, [...model.mins, ...model.maxs, ...model.origin]);
      ints(b, 36, [...model.headNodes, model.visLeaves, model.firstFace, model.faceCount]);
    }),
  };
  const header = Buffer.alloc(4 + ORDER.length * 8);
  header.writeInt32LE(wide ? BSP2 : 30, 0);
  const parts = [header];
  let at = header.length;
  ORDER.forEach((name, slot) => {
    const bytes = lumps[name];
    header.writeInt32LE(at, 4 + slot * 8);
    header.writeInt32LE(bytes.length, 8 + slot * 8);
    const pad = Buffer.alloc((4 - (bytes.length % 4)) % 4);
    parts.push(bytes, pad);
    at += bytes.length + pad.length;
  });
  return Buffer.concat(parts);
}

/** A map's lists without the file's own bytes and header: what both formats must give alike. */
const contentOf = (bsp) => {
  const { bytes, version, format, lumps, ...rest } = bsp;
  return rest;
};
/** The shape of a value: its keys and the kinds of their values, all the way down (a list by its first). */
const shapeOf = (value) =>
  Array.isArray(value)
    ? [value.length ? shapeOf(value[0]) : "empty"]
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]))
      : typeof value;
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};

const v30 = written("bsp30");
const bsp2 = written("bsp2");
const a = maps.readBsp(v30);
const b = maps.readBsp(bsp2);

test("a BSP2 map is told by the letters BSP2 where version 30 has its number", () => {
  sure(bsp2.toString("latin1", 0, 4) === "BSP2", "the file begins BSP2");
  sure(maps.BSP2_VERSION === bsp2.readInt32LE(0), "BSP2_VERSION is those letters as a number");
  sure(a.format === "bsp30" && a.version === 30, `${a.format} ${a.version}`);
  sure(b.format === "bsp2" && b.version === maps.BSP2_VERSION, `${b.format} ${b.version}`);
  const located = maps.locateLumps(bsp2);
  sure(located.format === "bsp2" && !located.blueShift, "locateLumps tells it too");
  sure(maps.entrySizesOf("bsp2").nodes === 44 && maps.entrySizesOf("bsp30").nodes === 24, "entry sizes per format");
  sure(maps.lightSamples(a) === 3 && maps.lightSamples(b) === 3, "both maps' light is r g b");
});

test("version 30 and BSP2 read into the same shape and the same numbers", () => {
  sure(JSON.stringify(shapeOf(contentOf(a))) === JSON.stringify(shapeOf(contentOf(b))), "the shapes differ");
  sure(JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b)), "the numbers differ");
  // what was written is what is read
  sure(JSON.stringify(b.nodes) === JSON.stringify(NODES), `nodes ${JSON.stringify(b.nodes)}`);
  sure(JSON.stringify(b.leaves) === JSON.stringify(LEAVES), "leaves");
  sure(JSON.stringify(b.faces) === JSON.stringify(FACES), "faces");
  sure(JSON.stringify(b.clipnodes) === JSON.stringify(CLIPNODES), "clipnodes");
  sure(JSON.stringify(b.edges) === JSON.stringify(EDGES), "edges");
  sure(JSON.stringify(b.marksurfaces) === JSON.stringify(MARKSURFACES), "marksurfaces");
  sure(b.entities.length === 2 && b.textures[0].name === "floor", "entities and textures");
});

test("a BSP2 map is walked, lit and seen as its version 30 twin", () => {
  for (const bsp of [a, b]) {
    sure(maps.contentsAt(bsp, [64, 64, 10]) === maps.CONTENTS.EMPTY, "open over the floor");
    sure(maps.contentsAt(bsp, [64, 64, -10]) === maps.CONTENTS.SOLID, "solid under it");
    sure(maps.floorUnder(bsp, [64, 64, 100]) === 0, "the floor at 0");
    sure(maps.floorUnder(bsp, [64, 64, 64], { hull: 1 }) === 36, "a standing player's middle at 36");
    sure(maps.leafAt(bsp, [64, 64, 10]) === 1, "leaf 1");
    sure(JSON.stringify(maps.visibleFrom(bsp, 1)) === "[1]", "leaf 1 sees itself");
    sure(JSON.stringify(maps.facePolygon(bsp, 0)) === JSON.stringify(VERTICES), "the floor's corners");
    const light = maps.faceLightmap(bsp, 0);
    sure(light.width === 9 && light.height === 9, `${light.width} x ${light.height}`);
    sure(light.styles[0].rgb.equals(LIGHT_RGB), "the light as written");
  }
  const reachA = maps.reachOf(a);
  const reachB = maps.reachOf(b);
  sure(reachA.share === 1 && reachA.area === reachB.area && reachB.share === 1, `walked ${reachA.area} / ${reachB.area}`);
});

test("BSP2 keeps numbers past 16 bits and boxes between whole units", () => {
  const far = 70000; // past an unsigned short
  const wide = written("bsp2", {
    EDGES: [...EDGES, [far, far + 1]],
    MARKSURFACES: [0, far],
    NODES: [{ ...NODES[0], mins: [-0.5, 0.25, -16.75], firstFace: far, faceCount: far + 2 }],
    LEAVES: [LEAVES[0], { ...LEAVES[1], firstMarkSurface: far, markSurfaceCount: 1, maxs: [128.5, 128, 128] }],
    CLIPNODES: [{ plane: 6, children: [1, far] }, ...CLIPNODES.slice(1)],
    FACES: [{ ...FACES[0], plane: 40000, texinfo: far, side: 1 }],
  });
  const read = maps.readBsp(wide);
  sure(JSON.stringify(read.edges.at(-1)) === `[${far},${far + 1}]`, "an edge's vertices");
  sure(read.marksurfaces[1] === far, "a marksurface");
  sure(read.nodes[0].firstFace === far && read.nodes[0].faceCount === far + 2, "a node's faces");
  sure(JSON.stringify(read.nodes[0].mins) === "[-0.5,0.25,-16.75]", "a node's box in floats");
  sure(read.leaves[1].firstMarkSurface === far && read.leaves[1].maxs[0] === 128.5, "a leaf's");
  sure(read.clipnodes[0].children[1] === far, "a clipnode's child");
  sure(read.faces[0].plane === 40000 && read.faces[0].texinfo === far && read.faces[0].side === 1, "a face's");
});

test("a BSP2 map whose light is grey is lit as Xash lights it: each sample three times", () => {
  const grey = maps.readBsp(written("bsp2", {}, LIGHT_GREY));
  sure(maps.lightSamples(grey) === 1, `${maps.lightSamples(grey)} bytes a sample`);
  const rgb = maps.faceLightmap(grey, 0).styles[0].rgb;
  sure(rgb.length === SAMPLES * 3, `${rgb.length} bytes`);
  sure([...LIGHT_GREY].every((value, at) => rgb[at * 3] === value && rgb[at * 3 + 1] === value && rgb[at * 3 + 2] === value), "grey made r g b"); // prettier-ignore
});

test("formats that are not GoldSrc's nor BSP2 are still refused; a BSP2 map cut short is refused", () => {
  const quake = Buffer.from(v30);
  quake.writeInt32LE(29, 0);
  sure(refuses(() => maps.readBsp(quake), /Quake 1/), "version 29");
  const other = Buffer.from(bsp2);
  other.write("2PSB", 0, "latin1");
  sure(refuses(() => maps.readBsp(other), /2PSB/), "2PSB");
  sure(refuses(() => maps.readBsp(bsp2.subarray(0, bsp2.length - 40)), /cut short/), "cut short");
});

test("checkBsp: a BSP2 map passes for Xash, with its own lumps' sizes, and not for GoldSrc", () => {
  const forXash = maps.checkBsp(bsp2, { engine: "xash" });
  sure(!forXash.errors.some((e) => /funny lump size|BSP2/.test(e)), forXash.errors.join("; "));
  sure(forXash.facts.some((f) => /version BSP2/.test(f)), forXash.facts.join("; "));
  const forGoldsrc = maps.checkBsp(bsp2, { engine: "goldsrc" });
  sure(forGoldsrc.errors.some((e) => /BSP2, which Half-Life's own engine does not load/.test(e)), forGoldsrc.errors.join("; "));
  const v30Goldsrc = maps.checkBsp(v30, { engine: "goldsrc" });
  sure(!v30Goldsrc.errors.some((e) => /BSP2|funny lump size/.test(e)), v30Goldsrc.errors.join("; "));
  // a BSP2 lump that is not whole 44 byte nodes is caught by BSP2's size, not version 30's
  const broken = Buffer.from(bsp2);
  const nodesSlot = 4 + ORDER.indexOf("nodes") * 8;
  broken.writeInt32LE(broken.readInt32LE(nodesSlot + 4) - 20, nodesSlot + 4);
  sure(maps.checkBsp(broken, { engine: "xash" }).errors.some((e) => /nodes lump .* 44 byte/.test(e)), "a short nodes lump");
});
