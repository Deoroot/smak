// A shipped map remastered by zones (docs/MAPS-REMASTER.md): each zone is one place, a box that only it changes, made
// by its own hand (an agent, a person) and merged with the others in one build. The way the Hive remaster was made
// (2026-11-18 to 11-24: 22 zones, one build, no zone touching another's faces):
//   a zone   { id, BOX: { min: [x, y, z], max: [x, y, z] }, WADS: [its .wad files], apply(map, context) }
//   apply    changes the texture and alignment of faces whose CENTRE is in BOX (never moves, adds or removes a brush
//            of the shipped map) and returns { brushes, entities }: the entities to add (lights, models, and a
//            func_detail holding the brushes it made) and those brushes again, to be checked; it never pushes into
//            map.entities.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { maps } from "../../src/index.mjs";

const { shapeOf } = maps;
/** Whether a point is in a box, with a little slack for points written on its faces. */
export const inBox = (point, box, slack = 0.1) => point.every((c, i) => c >= box.min[i] - slack && c <= box.max[i] + slack);
const overlap = (a, b) => a.min.every((_, i) => a.min[i] < b.max[i] && b.min[i] < a.max[i]);
const centreOf = (polygon) => (polygon?.length ? polygon.reduce((sum, p) => sum.map((v, k) => v + p[k] / polygon.length), [0, 0, 0]) : null); // prettier-ignore
const faceKey = (face) => JSON.stringify([face.texture, face.u, face.v, face.rotation, face.scale]);
const allBrushes = (map) => [...map.brushes, ...map.entities.flatMap((entity) => entity.brushes ?? [])];

/**
 * The zones applied in turn to `map` (what readMap gives; changed in place): `{ errors, facts, wads }`, `wads` every
 * zone's .wad files once. `context` is handed to each `apply` (`{ src, prof, K }` for the Hive's zones). An error:
 * two boxes that overlap (nothing is applied); a zone that changed a face whose centre is outside its box, or moved,
 * added or took away a brush of the map; a brush it adds outside its box or broken; an entity it adds outside its box;
 * an entity pushed into the map by the zone itself, where it would not be checked.
 */
export async function applyZones(map, zones, context = {}) {
  const [errors, facts, wads] = [[], [], []];
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++)
      if (overlap(zones[i].BOX, zones[j].BOX)) errors.push(`the boxes of ${zones[i].id} and ${zones[j].id} overlap: both would change the same faces`); // prettier-ignore
  if (errors.length) return { errors, facts, wads };
  for (const zone of zones) {
    const before = allBrushes(map).map((brush) => { const shape = shapeOf(brush); return { brush, faces: brush.faces.map((f, k) => ({ key: faceKey(f), centre: centreOf(shape.faces[k]?.polygon) })) }; }); // prettier-ignore
    const count = map.entities.length;
    const { brushes = [], entities = [] } = (await zone.apply(map, context)) ?? {};
    if (map.entities.length !== count) errors.push(`${zone.id} put entities into the map itself: return them, so that they are checked`); // prettier-ignore
    const after = allBrushes(map);
    let outside = Math.abs(after.length - before.length);
    before.forEach(({ brush, faces }, i) => {
      if (after[i] !== brush) outside++;
      else brush.faces.forEach((f, k) => { if (faceKey(f) !== faces[k].key && !(faces[k].centre && inBox(faces[k].centre, zone.BOX, 0.6))) outside++; }); // prettier-ignore
    });
    if (outside) errors.push(`${zone.id} changed ${outside} faces or brushes outside its box (a face is the zone's only when its centre is in the box)`); // prettier-ignore
    const added = [...brushes, ...entities.flatMap((entity) => entity.brushes ?? [])].filter((brush) => { const s = shapeOf(brush); return !inBox(s.min, zone.BOX) || !inBox(s.max, zone.BOX) || s.faults.length; }); // prettier-ignore
    if (added.length) errors.push(`${zone.id}: ${added.length} brushes it adds are outside its box, or broken`);
    for (const entity of entities) if (entity.origin && !inBox(entity.origin.split(/\s+/).map(Number), zone.BOX, 1)) errors.push(`${zone.id}: its ${entity.classname} at ${entity.origin} is outside its box`); // prettier-ignore
    map.entities.push(...entities);
    for (const wad of zone.WADS ?? []) if (!wads.includes(wad)) wads.push(wad);
    facts.push(`zone ${zone.id}: ${brushes.length} brushes, ${entities.length} entities`);
  }
  return { errors, facts, wads };
}

/**
 * The textures of several .wad files in one (the zones' textures installed beside the map, not carried inside the .bsp):
 * `{ bytes, count, errors }`. A name given by two files must be the same picture, or it is an error.
 */
export function sharedWad(files) {
  const [lumps, errors] = [new Map(), []];
  for (const file of files) {
    const b = readFileSync(file);
    if (b.toString("latin1", 0, 4) !== "WAD3") { errors.push(`${basename(file)} is not a WAD3 file`); continue; } // prettier-ignore
    for (let i = 0, dir = b.readInt32LE(8); i < b.readInt32LE(4); i++) {
      const at = dir + i * 32, name = b.toString("latin1", at + 16, at + 32).replace(/\0.*$/s, "").toUpperCase(); // prettier-ignore
      const data = b.subarray(b.readInt32LE(at), b.readInt32LE(at) + b.readInt32LE(at + 4));
      if (lumps.has(name) && !lumps.get(name).data.equals(data)) errors.push(`${name} is another picture in ${basename(file)} than in a .wad before it`); // prettier-ignore
      else lumps.set(name, { name, type: b[at + 12], data });
    }
  }
  const all = [...lumps.values()];
  const dirAt = 12 + all.reduce((sum, l) => sum + l.data.length, 0);
  const bytes = Buffer.alloc(dirAt + all.length * 32);
  bytes.write("WAD3", 0, "latin1");
  bytes.writeInt32LE(all.length, 4);
  bytes.writeInt32LE(dirAt, 8);
  let at = 12;
  all.forEach((l, i) => {
    l.data.copy(bytes, at);
    const entry = dirAt + i * 32;
    [at, l.data.length, l.data.length].forEach((v, k) => bytes.writeInt32LE(v, entry + k * 4));
    bytes[entry + 12] = l.type;
    bytes.write(l.name.slice(0, 15), entry + 16, "latin1");
    at += l.data.length;
  });
  return { bytes, count: all.length, errors };
}

/** Faces no zone may change and no eye cares about. */
const UNSEEN = /^(NULL|CLIP|SKIP|AAATRIGGER|ORIGIN|HINT|BEVEL)$/i;

/**
 * What an eye sees of a map's brushes, ray by ray over a grid of the view: `{ cells, outside, said }`. A cell is
 * `{ row, col, texture, point, inside }`, `inside` whether the face it hits has its centre in `box`; `outside` the
 * faces seen that a zone of that box cannot change (texture and the point of the first ray). A big shipped face (a
 * floor 800 units across) can have its centre outside a box that covers all the eye sees: the Hive's c16 kept its
 * old floor for a round so. `eye` [x, y, z], `yaw` and `pitch` in degrees (pitch over 0 looks up), `fov` across,
 * `aspect` height over width. Triggers are not seen; brush entities are.
 */
export function pickFaces(map, { eye, yaw = 0, pitch = 0, fov = 90, aspect = 0.75, cols = 16, rows = 9, box }) {
  const solids = [];
  const add = (brush, tag) => {
    const shape = shapeOf(brush);
    if (shape.faults?.length) return;
    const planes = shape.faces.map((f, k) => (f.normal && f.polygon.length ? { n: f.normal, d: f.normal.reduce((s, v, i) => s + v * f.polygon[0][i], 0), texture: brush.faces[k].texture, centre: centreOf(f.polygon) } : null)).filter(Boolean); // prettier-ignore
    if (planes.length >= 4 && !planes.every((p) => UNSEEN.test(p.texture))) solids.push({ planes, tag });
  };
  map.brushes.forEach((brush, i) => add(brush, `world ${i}`));
  map.entities.forEach((e, j) => { if (!/^trigger_/.test(e.classname)) (e.brushes ?? []).forEach((brush) => add(brush, `${e.classname} ${j}`)); }); // prettier-ignore
  const [y, p] = [yaw, pitch].map((a) => (a * Math.PI) / 180);
  const fw = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
  const rt = [Math.sin(y), -Math.cos(y), 0];
  const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
  const half = Math.tan((fov / 2) * (Math.PI / 180));
  const hit = (dir) => {
    let best = null;
    for (const { planes, tag } of solids) {
      let [near, far, face] = [0, Infinity, null];
      for (const pl of planes) {
        const dn = pl.n.reduce((s, v, i) => s + v * dir[i], 0), dist = pl.d - pl.n.reduce((s, v, i) => s + v * eye[i], 0); // prettier-ignore
        if (Math.abs(dn) < 1e-9) { if (dist < 0) { near = Infinity; break; } continue; } // prettier-ignore
        const t = dist / dn;
        if (dn < 0 && t > near) [near, face] = [t, pl];
        else if (dn > 0 && t < far) far = t;
      }
      if (face && near <= far && !UNSEEN.test(face.texture) && (!best || near < best.t)) best = { t: near, face, tag };
    }
    return best;
  };
  const cells = [];
  const outside = new Map();
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const [sx, sy] = [((col + 0.5) / cols) * 2 - 1, (1 - ((row + 0.5) / rows) * 2) * aspect].map((v) => v * half);
      const d = [0, 1, 2].map((k) => fw[k] + rt[k] * sx + up[k] * sy);
      const dir = d.map((v) => v / Math.hypot(...d));
      const seen = hit(dir);
      if (!seen) continue;
      const point = eye.map((v, k) => Math.round(v + dir[k] * seen.t));
      const inside = !box || inBox(seen.face.centre, box, 0.6);
      cells.push({ row, col, texture: seen.face.texture, brush: seen.tag, point, inside });
      const key = `${seen.tag}:${seen.face.centre.join()}`;
      if (!inside && !outside.has(key)) outside.set(key, { texture: seen.face.texture, brush: seen.tag, point, centre: seen.face.centre.map(Math.round) }); // prettier-ignore
    }
  const share = cells.length ? cells.filter((c) => !c.inside).length / cells.length : 0;
  const said = outside.size
    ? `${outside.size} faces seen have their centre outside the box (${Math.round(share * 100)}% of the view): the zone cannot change them; widen the box to take their centres, or leave them: ${[...outside.values()].slice(0, 6).map((f) => `${f.texture} (${f.brush}, centre ${f.centre.join(" ")})`).join("; ")}` // prettier-ignore
    : `every face seen (${cells.length} rays) has its centre in the box`;
  return { cells, outside: [...outside.values()], said };
}
