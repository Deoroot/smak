// Valve's navigation mesh (`.nav`), read for its measures: the areas a bot walks (rectangles with a height at
// each corner), what joins them, and what the mesh marks on them. Written from the Source SDK 2013's
// nav_area.cpp / nav_file.cpp for the base, and from the bytes of Left 4 Dead 2's own files (version 16,
// subversion 14) for what that game adds. Only what is needed for measuring is kept; nothing of a map is
// written anywhere by this module.
//
// THE FILE, as Left 4 Dead 2 writes it (version 16):
//   u32 magic 0xFEEDFACE, u32 version, u32 subversion (v >= 10), u32 bsp size (v >= 4), u8 analyzed (v >= 14)
//   u16 place count, each: u16 length, the name with its NUL; u8 "has unnamed areas" (v > 11)
//   Left 4 Dead 2 (subversion 14): a NUL-ended name (the nav's mission name) and a u16 (0 in every file seen)
//   u32 area count, each area:
//     u32 id; u32 attributes (u16 to v12); f32 x3 north-west corner, f32 x3 south-east corner;
//     f32 height of the north-east corner, f32 of the south-west; for north, east, south, west: u32 count,
//     u32 ids; u8 hiding spots, each u32 id, f32 x3, u8 flags;
//     u32 encounter paths, each u32 from, u8 dir, u32 to, u8 dir, u8 spots, each u32 id, u8 t;
//     u16 place; for up, down: u32 count, u32 ladder ids; f32 x2 earliest occupy times; f32 x4 light (v>=11);
//     Left 4 Dead 2: u32 its spawn attributes (TerrorNavArea: saferoom, finale, ...), u16 unknown (0 mostly);
//     u32 visible areas, each u32 id, u8 flags; u32 the area its visibility is inherited from (v >= 16)
//   u32 ladder count, each: u32 id, f32 width, f32 x3 top, f32 x3 bottom, f32 length, u32 dir,
//     u32 x5 areas (top forward, left, right, behind; bottom)
// Flow distance (how far along the way an area lies) is NOT in the file: the game works it out when the map
// loads, from the start. The survey does the same, by the walked distance from the start areas.
//
//   readNav(buffer)   { version, subversion, mission, places, areas: [{ id, attributes, spawn, nw, se, neZ,
//                       swZ, links: [[ids] x4], ladders: [[up], [down]], place }], ladders, byId }
//   heightAt(area, x, y), centreOf(area), areaOf(area), meetingOf(a, b)

/** The base attributes (nav_mesh.h, NavAttributeType). */
export const NAV = {
  CROUCH: 0x1, JUMP: 0x2, PRECISE: 0x4, NO_JUMP: 0x8, STOP: 0x10, RUN: 0x20, WALK: 0x40, AVOID: 0x80,
  TRANSIENT: 0x100, DONT_HIDE: 0x200, STAND: 0x400, NO_HOSTAGES: 0x800, STAIRS: 0x1000, NO_MERGE: 0x2000,
  OBSTACLE_TOP: 0x4000, CLIFF: 0x8000,
};
/**
 * Left 4 Dead 2's spawn attributes (TerrorNavArea, as SourceMod's left4dhooks names them: the bits the game's
 * own `nav_mark` command sets).
 */
export const TERROR = {
  EMPTY: 0x2, STOP_SCAN: 0x4, BATTLESTATION: 0x20, FINALE: 0x40, PLAYER_START: 0x80, BATTLEFIELD: 0x100,
  IGNORE_VISIBILITY: 0x200, NOT_CLEARABLE: 0x400, CHECKPOINT: 0x800, OBSCURED: 0x1000, NO_MOBS: 0x2000,
  THREAT: 0x4000, RESCUE_VEHICLE: 0x8000, RESCUE_CLOSET: 0x10000, ESCAPE_ROUTE: 0x20000, DOOR: 0x40000,
  NOTHREAT: 0x80000, LYINGDOWN: 0x100000,
};

const MAGIC = 0xfeedface;

/** The `.nav` in a buffer: see the header. Throws on a file it cannot follow to the end of its ladders. */
export function readNav(buffer) {
  const b = buffer;
  let o = 0;
  const need = (n) => {
    if (o + n > b.length) throw new Error(`nav: the file ends at ${b.length}, inside a field at ${o}`);
  };
  const u8 = () => (need(1), b[o++]);
  const u16 = () => (need(2), (o += 2), b.readUInt16LE(o - 2));
  const u32 = () => (need(4), (o += 4), b.readUInt32LE(o - 4));
  const f32 = () => (need(4), (o += 4), b.readFloatLE(o - 4));
  if (u32() !== MAGIC) throw new Error("nav: not a navigation mesh (no 0xFEEDFACE)");
  const version = u32();
  if (version < 13 || version > 16) throw new Error(`nav: version ${version}; only 13 to 16 are read`);
  const subversion = u32();
  const bspSize = u32();
  const analyzed = version >= 14 ? u8() : 0;
  const places = [];
  for (let count = u16(), nth = 0; nth < count; nth++) {
    const length = u16();
    need(length);
    places.push(b.toString("latin1", o, o + length).replace(/\0[\s\S]*$/, ""));
    o += length;
  }
  u8(); // has unnamed areas
  const terror = subversion === 14;
  let mission = null;
  if (terror) {
    const begins = o;
    while (o < b.length && b[o]) o++;
    mission = b.toString("latin1", begins, o);
    o++;
    const extra = u16();
    if (extra) throw new Error(`nav: a Left 4 Dead 2 header with ${extra} where 0 was always seen; not read`);
  }
  const areas = [];
  const areaCount = u32();
  for (let nth = 0; nth < areaCount; nth++) {
    const id = u32();
    const attributes = u32();
    const nw = [f32(), f32(), f32()];
    const se = [f32(), f32(), f32()];
    const neZ = f32();
    const swZ = f32();
    const links = [];
    for (let way = 0; way < 4; way++) {
      const list = [];
      for (let count = u32(), k = 0; k < count; k++) list.push(u32());
      links.push(list);
    }
    const hiding = u8();
    need(hiding * 17);
    o += hiding * 17;
    for (let count = u32(), k = 0; k < count; k++) {
      need(10);
      o += 10;
      const spots = u8();
      need(spots * 5);
      o += spots * 5;
    }
    const place = u16();
    const ladders = [];
    for (let way = 0; way < 2; way++) {
      const list = [];
      for (let count = u32(), k = 0; k < count; k++) list.push(u32());
      ladders.push(list);
    }
    need(24);
    o += 8; // earliest occupy times
    o += 16; // light at the corners
    let spawn = 0;
    if (terror) {
      spawn = u32();
      u16();
    }
    if (version >= 16) {
      const visible = u32();
      need(visible * 5);
      o += visible * 5;
      u32();
    }
    if (!(se[0] >= nw[0] && se[1] >= nw[1]) || !nw.every(Number.isFinite) || !se.every(Number.isFinite))
      throw new Error(`nav: area ${nth} (id ${id}) has its corners crossed: the layout is not the one read here`);
    areas.push({ id, attributes, spawn, nw, se, neZ, swZ, links, ladders, place });
  }
  const ladderList = [];
  for (let count = u32(), k = 0; k < count; k++) {
    const id = u32();
    const width = f32();
    const top = [f32(), f32(), f32()];
    const bottom = [f32(), f32(), f32()];
    const length = f32();
    const dir = u32();
    const ends = [u32(), u32(), u32(), u32(), u32()];
    ladderList.push({ id, width, top, bottom, length, dir, topAreas: ends.slice(0, 4), bottomArea: ends[4] });
  }
  const byId = new Map(areas.map((area) => [area.id, area]));
  return { version, subversion, bspSize, analyzed, places, mission, areas, ladders: ladderList, byId, rest: b.length - o };
}

/** The height of an area's floor at a point (x, y) inside it, from its four corners. */
export function heightAt(area, x, y) {
  const { nw, se, neZ, swZ } = area;
  const sx = se[0] > nw[0] ? Math.min(1, Math.max(0, (x - nw[0]) / (se[0] - nw[0]))) : 0;
  const sy = se[1] > nw[1] ? Math.min(1, Math.max(0, (y - nw[1]) / (se[1] - nw[1]))) : 0;
  // corners: nw (x0, y0) at nw[2]; ne (x1, y0) at neZ; sw (x0, y1) at swZ; se (x1, y1) at se[2]
  const north = nw[2] + (neZ - nw[2]) * sx;
  const south = swZ + (se[2] - swZ) * sx;
  return north + (south - north) * sy;
}

/** An area's middle, at its floor. */
export function centreOf(area) {
  const x = (area.nw[0] + area.se[0]) / 2;
  const y = (area.nw[1] + area.se[1]) / 2;
  return [x, y, heightAt(area, x, y)];
}

/** An area's size seen from above, in square units. */
export const areaOf = (area) => (area.se[0] - area.nw[0]) * (area.se[1] - area.nw[1]);

/**
 * Where two joined areas meet: the middle of the stretch their facing edges share (or, when they do not
 * touch, of the gap between them), with each one's floor height there: `[x, y, zFrom, zTo]`.
 */
export function meetingOf(a, b) {
  const middle = (axis) => {
    const lo = Math.max(a.nw[axis], b.nw[axis]);
    const hi = Math.min(a.se[axis], b.se[axis]);
    return (lo + hi) / 2;
  };
  const x = middle(0);
  const y = middle(1);
  return [x, y, heightAt(a, x, y), heightAt(b, x, y)];
}
