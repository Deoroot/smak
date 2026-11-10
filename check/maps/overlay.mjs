// A map's geometry laid over a picture of it, from a camera: the edges a room's faces make (where a wall meets the
// floor, a door's frame, a beam, a texture's join) drawn over the picture, and how far they lie from the picture's
// own edges. The models' pictures are fitted the same way, by outline (posefit.mjs, project.mjs); a room is seen
// from inside and has no outline, so here the room's edges are its outline. Steven, 2026-10-17: "You'd find an
// angle with a camera, build against that camera, then every shot becomes trying to match it."
//
//   geometryOf(map)                                  -> the faces a view draws: { surfaces: [{ polygon, normal,
//                                                       dist, texture, plane }] } of brush source or a .bsp
//   rasterOf(geometry, camera, width, height)        -> which face each pixel shows, how far, and where in the map
//   geometryEdges(raster, geometry)                  -> its edge pixels: creases and depth steps, texture joins
//   pictureEdges(picture, { least })                 -> the picture's edges that lie on long straight lines
//   overlayOf(map, picture, camera, options)         -> { width, height, rgba, score, faces } (the edges drawn over
//                                                       the picture, green where they meet its own, red where not)
//   fitCamera(map, picture, { from, yaw, pitch, fov, ... }) -> the camera that best lays the map's edges on the
//                                                       picture's, searched from a guess (or from places over the
//                                                       map's floor), and its score
//
// `camera`: { from: [x, y, z], yaw, pitch, fov } as drawMap takes them (fov 90 unless told: GoldSrc's own). Scores
// are in pixels of the picture; `faces` gives, for each large face whose edges are seen, how far it would have to
// move along its own normal (in units) to lie on the picture's edges, which is the maker's critique.
import { sub, dot, cross, unit } from "../../core/vec.mjs";
import { cameraOf } from "./draw.mjs";
import { facePolygon, faceNormal, modelFaces } from "../../core/maps/bsp.mjs";
import { shapeOf } from "../../make/maps/source.mjs";
import { textureKind } from "../../core/maps/miptex.mjs";
import { valueOf, originOf, brushModelOf } from "../../core/maps/entities.mjs";

/** Nearer than this to the eye (units) is cut off, as drawMap does. */
const NEAR = 2;
/** Two faces whose normals turn more than this (degrees) meet in a crease a picture shows. */
const CREASE = 20;
/** A depth step of more than this share of the depth is an edge (one face in front of another). */
const DEPTH_STEP = 0.06;
/** A picture's edge pixel counts when this many pixels of one straight run carry it (texture specks do not). */
const LINE_LEAST = 10;
/** How far (pixels) a geometry edge may be from the picture's before it counts as missing it. */
const REACH = 24;
/**
 * Each distance is counted to this at the most (pixels) in a score: a picture leaves out an edge between two
 * faces lit alike, and a geometry edge with no picture edge near it then costs the same wherever the camera is,
 * rather than pulling the camera to where such edges hide (a nudged guess drifted 70 units so, 2026-10-17).
 */
const TRUNCATE = 6;
/** In an overlay, an edge with no picture line within this many pixels has nothing to be compared with: amber. */
const NO_LINE = 10;
/** Brush entities a picture never shows. */
const UNSEEN = /^(trigger_|func_ladder$|func_buyzone$|func_bomb_target$|func_monsterclip$|env_)/;

/** The faces a view of the map draws, each with the key of its plane (coplanar faces of one plane share it). */
export function geometryOf(map) {
  const surfaces = [];
  const planeKey = (normal, dist) => `${normal.map((v) => Math.round(v * 1000)).join(",")},${Math.round(dist * 4)}`;
  const add = (polygon, normal, dist, texture, shift = [0, 0, 0]) => {
    const kind = textureKind(texture ?? "");
    if (kind.tool || kind.sky) return;
    const moved = polygon.map((p) => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]]);
    const d = dist + dot(normal, shift);
    surfaces.push({ polygon: moved, normal, dist: d, texture: texture ?? "", plane: planeKey(normal, d) });
  };
  if (map?.faces && map.planes) {
    const faceOf = (face, shift) => {
      const texinfo = map.texinfo[face.texinfo];
      const name = map.textures[texinfo.texture]?.name ?? "";
      const plane = map.planes[face.plane];
      add(facePolygon(map, face), faceNormal(map, face), face.side ? -plane.dist : plane.dist, name, shift);
    };
    for (const face of modelFaces(map, 0)) faceOf(face, [0, 0, 0]);
    map.entities.forEach((entity, n) => {
      const model = n === 0 ? null : brushModelOf(entity);
      if (model === null || !map.models[model]) return;
      const classname = valueOf(entity, "classname") ?? "";
      if (UNSEEN.test(classname) || (valueOf(entity, "rendermode") && valueOf(entity, "renderamt") === "0")) return;
      for (const face of modelFaces(map, model)) faceOf(face, originOf(entity) ?? [0, 0, 0]);
    });
  } else if (map && Array.isArray(map.brushes)) {
    const brushFaces = (brush) => {
      for (const face of shapeOf(brush).faces) if (face.normal && face.area > 0) add(face.polygon, face.normal, face.dist, face.texture);
    };
    for (const brush of map.brushes.flat()) brushFaces(brush);
    for (const entity of map.entities ?? []) {
      if (!entity.brushes?.length || UNSEEN.test(String(entity.classname ?? ""))) continue;
      for (const brush of entity.brushes) brushFaces(brush);
    }
  } else throw new Error("a map: what readBsp gives, or brush source ({ worldspawn, brushes, entities })");
  return { surfaces };
}

/** A camera as drawMap makes it, from what a caller gives. */
export const viewCamera = (camera, width, height) => cameraOf({ fov: 90, yaw: 0, pitch: 0, ...camera }, width, height);

/**
 * Which face each pixel shows: `{ width, height, face (Int32, -1 none), depth (Float32, along the ray's length
 * over the forward axis), point(i) -> [x, y, z] }`. Faces turned away from the eye are left out; the nearest wins.
 */
export function rasterOf(geometry, camera, width, height) {
  const view = viewCamera(camera, width, height);
  const face = new Int32Array(width * height).fill(-1);
  const depth = new Float32Array(width * height).fill(Infinity);
  const toCam = (p) => {
    const o = sub(p, view.eye);
    return [dot(o, view.right), dot(o, view.up), dot(o, view.forward)];
  };
  geometry.surfaces.forEach((s, index) => {
    if (s.dist - dot(s.normal, view.eye) > -0.01) return; // seen from behind, or edge on
    let poly = s.polygon.map(toCam);
    // cut what is nearer than NEAR
    const kept = [];
    poly.forEach((here, i) => {
      const next = poly[(i + 1) % poly.length];
      if (here[2] >= NEAR) kept.push(here);
      if (here[2] >= NEAR !== next[2] >= NEAR) {
        const t = (NEAR - here[2]) / (next[2] - here[2]);
        kept.push(here.map((v, a) => v + (next[a] - v) * t));
      }
    });
    if (kept.length < 3) return;
    poly = kept.map(([x, y, z]) => [view.centreX + (x * view.focal) / z, view.centreY - (y * view.focal) / z]);
    let y0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p[1]))));
    let y1 = Math.min(height - 1, Math.ceil(Math.max(...poly.map((p) => p[1]))));
    const nCam = [dot(s.normal, view.right), dot(s.normal, view.up), dot(s.normal, view.forward)];
    const planeD = s.dist - dot(s.normal, view.eye);
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
          const x = ax + ((yc - ay) / (by - ay)) * (bx - ax);
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      }
      if (lo > hi) continue;
      const xs = Math.max(0, Math.ceil(lo - 0.5));
      const xe = Math.min(width - 1, Math.floor(hi - 0.5));
      // the ray of a pixel in camera space: ((x - cx) / f, -(y - cy) / f, 1); depth along forward = planeD / (n . ray)
      const ry = -(yc - view.centreY) / view.focal;
      for (let x = xs; x <= xe; x++) {
        const rx = (x + 0.5 - view.centreX) / view.focal;
        const along = nCam[0] * rx + nCam[1] * ry + nCam[2];
        if (along >= 0) continue;
        const z = planeD / along;
        const k = y * width + x;
        if (z > 0 && z < depth[k]) {
          depth[k] = z;
          face[k] = index;
        }
      }
    }
  });
  const point = (k) => {
    const x = (k % width) + 0.5;
    const y = Math.floor(k / width) + 0.5;
    const z = depth[k];
    const rx = ((x - view.centreX) / view.focal) * z;
    const ry = (-(y - view.centreY) / view.focal) * z;
    return [0, 1, 2].map((a) => view.eye[a] + view.right[a] * rx + view.up[a] * ry + view.forward[a] * z);
  };
  return { width, height, face, depth, point, view };
}

/**
 * The geometry's edge pixels: `{ edge (Uint8: 1 a crease or a depth step, 2 a texture join on one plane), owner
 * (Int32: the face on the near side) }`.
 */
export function geometryEdges(raster, geometry) {
  const { width, height, face, depth } = raster;
  const edge = new Uint8Array(width * height);
  const owner = new Int32Array(width * height).fill(-1);
  const cosCrease = Math.cos((CREASE * Math.PI) / 180);
  const mark = (k, j) => {
    const a = face[k];
    const b = face[j];
    if (a === b) return;
    if (a < 0 || b < 0) {
      const near = a >= 0 ? k : j;
      edge[near] = 1;
      owner[near] = face[near];
      return;
    }
    const sa = geometry.surfaces[a];
    const sb = geometry.surfaces[b];
    const near = depth[k] <= depth[j] ? k : j;
    let kind = 0;
    if (sa.plane !== sb.plane) {
      const crease = dot(sa.normal, sb.normal) < cosCrease;
      const step = Math.abs(depth[k] - depth[j]) > DEPTH_STEP * Math.min(depth[k], depth[j]);
      if (crease || step) kind = 1;
    }
    if (!kind && sa.texture.toLowerCase() !== sb.texture.toLowerCase()) kind = 2;
    if (kind && (!edge[near] || kind < edge[near])) {
      edge[near] = kind;
      owner[near] = face[near];
    }
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      if (x + 1 < width) mark(k, k + 1);
      if (y + 1 < height) mark(k, k + width);
    }
  return { edge, owner };
}

/** A picture as grey, scaled to width x height (nearest-free box average). */
function greyOf(picture, width, height) {
  const { rgba } = picture;
  const out = new Float32Array(width * height);
  const sx = picture.width / width;
  const sy = picture.height / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.max(Math.floor(y * sy) + 1, Math.floor((y + 1) * sy)); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.max(Math.floor(x * sx) + 1, Math.floor((x + 1) * sx)); xx++) {
          const k = (yy * picture.width + xx) * 4;
          sum += 0.3 * rgba[k] + 0.59 * rgba[k + 1] + 0.11 * rgba[k + 2];
          n++;
        }
      out[y * width + x] = sum / n;
    }
  return out;
}

/**
 * A picture's edges that lie on long straight runs (a wall's foot, a door frame), the speckle of a texture left
 * out: Sobel gradients, their strong pixels thinned across the gradient, each kept when `least` pixels of the
 * same direction run on along it. Returns a Uint8Array (1 an edge) at `width` x `height`.
 */
export function pictureEdges(picture, width, height, { least = LINE_LEAST } = {}) {
  const g = greyOf(picture, width, height);
  const mag = new Float32Array(width * height);
  const ang = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const at = (dx, dy) => g[(y + dy) * width + x + dx];
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      mag[y * width + x] = Math.hypot(gx, gy);
      ang[y * width + x] = Math.atan2(gy, gx);
    }
  // the threshold: strong against this picture's own gradients
  const sorted = Float32Array.from(mag).sort();
  const strong = Math.max(24, sorted[Math.floor(sorted.length * 0.85)]);
  const thin = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const k = y * width + x;
      if (mag[k] < strong) continue;
      const dx = Math.round(Math.cos(ang[k]));
      const dy = Math.round(Math.sin(ang[k]));
      if (mag[k] >= mag[k + dy * width + dx] && mag[k] >= mag[k - dy * width - dx]) thin[k] = 1;
    }
  // kept where a straight run of `least` pixels of like direction carries it
  const out = new Uint8Array(width * height);
  const same = (a, b) => Math.abs(Math.sin(a - b)) < 0.26;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      if (!thin[k]) continue;
      // along the edge: perpendicular to the gradient
      const tx = -Math.sin(ang[k]);
      const ty = Math.cos(ang[k]);
      let run = 1;
      for (const s of [1, -1])
        for (let step = 1; step < least * 2; step++) {
          let hit = false;
          for (const off of [0, 1, -1]) {
            const xx = Math.round(x + s * step * tx + off * ty);
            const yy = Math.round(y + s * step * ty - off * tx);
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const j = yy * width + xx;
            if (thin[j] && same(ang[j], ang[k])) hit = true;
          }
          if (!hit) break;
          run++;
        }
      if (run >= least) out[k] = 1;
    }
  return out;
}

/** The distance (pixels) from every pixel to the nearest set one: two passes of the 3-4 chamfer, over 3. */
function distanceTo(mask, width, height) {
  const big = 1e6;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : big;
  const at = (x, y) => d[y * width + x];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = at(x, y);
      if (x > 0) v = Math.min(v, at(x - 1, y) + 3);
      if (y > 0) v = Math.min(v, at(x, y - 1) + 3);
      if (x > 0 && y > 0) v = Math.min(v, at(x - 1, y - 1) + 4);
      if (x + 1 < width && y > 0) v = Math.min(v, at(x + 1, y - 1) + 4);
      d[y * width + x] = v;
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      let v = at(x, y);
      if (x + 1 < width) v = Math.min(v, at(x + 1, y) + 3);
      if (y + 1 < height) v = Math.min(v, at(x, y + 1) + 3);
      if (x + 1 < width && y + 1 < height) v = Math.min(v, at(x + 1, y + 1) + 4);
      if (x > 0 && y + 1 < height) v = Math.min(v, at(x - 1, y + 1) + 4);
      d[y * width + x] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/**
 * How well a camera lays the map's edges on the picture's: `{ score, toPicture, fromPicture, geometryPixels,
 * picturePixels }`. `toPicture`: the mean distance from the geometry's edge pixels to the picture's (each
 * counted to TRUNCATE at most), `fromPicture` the other way, `score` the two with the picture's weighed
 * twice. Lower is better; 0 lies exactly.
 */
function scoreOf(geomEdge, picEdge, picDist, width, height) {
  const geomDist = distanceTo(geomEdge, width, height);
  let a = 0;
  let na = 0;
  let b = 0;
  let nb = 0;
  for (let i = 0; i < width * height; i++) {
    if (geomEdge[i]) {
      a += Math.min(TRUNCATE, picDist[i]);
      na++;
    }
    if (picEdge[i]) {
      b += Math.min(TRUNCATE, geomDist[i]);
      nb++;
    }
  }
  const toPicture = na ? a / na : TRUNCATE;
  const fromPicture = nb ? b / nb : TRUNCATE;
  // the picture's own long edges are sure; a geometry edge may be missing from the picture by its light
  return { score: (2 * fromPicture + toPicture) / 3, toPicture, fromPicture, geometryPixels: na, picturePixels: nb };
}

/** The picture's edges and their distance field, made once for a picture at a size. */
export function pictureField(picture, width, height) {
  const edges = pictureEdges(picture, width, height);
  return { width, height, edges, dist: distanceTo(edges, width, height) };
}

/** A camera's score against a picture's field. */
export function cameraScore(geometry, field, camera) {
  const raster = rasterOf(geometry, camera, field.width, field.height);
  const g = geometryEdges(raster, geometry);
  const geomEdge = Uint8Array.from(g.edge, (v) => (v === 1 ? 1 : 0));
  return { ...scoreOf(geomEdge, field.edges, field.dist, field.width, field.height), raster, edges: g };
}

/**
 * For each large face whose edges the view shows, how far it would have to move along its own normal to lie on
 * the picture's edges: its edge pixels' distances measured with the face moved by -range to +range (units), the
 * best kept. `[{ face, texture, normal, axis, seen (edge pixels), off (pixels as built), move (units along its
 * normal: over 0 out of the room), better (pixels moved) }]`, the largest moves first.
 */
export function faceOffsets(geometry, field, camera, { range = 64, step = 2, least = 25 } = {}) {
  const { width, height } = field;
  const base = cameraScore(geometry, field, camera);
  const counts = new Map();
  for (let i = 0; i < width * height; i++) if (base.edges.edge[i] === 1) counts.set(base.edges.owner[i], (counts.get(base.edges.owner[i]) ?? 0) + 1);
  const view = viewCamera(camera, width, height);
  const out = [];
  for (const [index, seen] of counts) {
    if (index < 0 || seen < least) continue;
    const s = geometry.surfaces[index];
    // that face's own crease pixels as the view shows them (a compiled wall is cut into many polygons along lines
    // no picture has: its outline would mislead), each a point of the map, moved along the face's normal and
    // drawn again
    const points = [];
    for (let i = 0; i < width * height; i++) if (base.edges.edge[i] === 1 && base.edges.owner[i] === index) points.push(base.raster.point(i));
    const errAt = (move) => {
      let sum = 0;
      let n = 0;
      for (const point of points) {
        const o = sub(point.map((v, a) => v + s.normal[a] * move), view.eye);
        const z = dot(o, view.forward);
        if (z < NEAR) continue;
        const x = Math.floor(view.centreX + (dot(o, view.right) * view.focal) / z);
        const y = Math.floor(view.centreY - (dot(o, view.up) * view.focal) / z);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        sum += Math.min(TRUNCATE * 2, field.dist[y * width + x]);
        n++;
      }
      return n ? sum / n : Infinity;
    };
    const asBuilt = errAt(0);
    let best = { move: 0, err: asBuilt };
    for (let move = -range; move <= range; move += step) {
      const err = errAt(move);
      if (err < best.err - 0.05) best = { move, err };
    }
    const big = s.normal.map(Math.abs).indexOf(Math.max(...s.normal.map(Math.abs)));
    out.push({ face: index, texture: s.texture, normal: s.normal.map((v) => Math.round(v * 100) / 100), axis: `${s.normal[big] > 0 ? "+" : "-"}${"xyz"[big]}`, seen, off: Math.round(asBuilt * 10) / 10, move: best.move, better: Math.round((asBuilt - best.err) * 10) / 10 });
  }
  return out.sort((a, b) => Math.abs(b.move) * b.better - Math.abs(a.move) * a.better);
}

/**
 * The map's edges drawn over the picture from a camera, with the score and the faces that are off: `{ width,
 * height, rgba, score, faces, camera }`. The picture is dimmed; an edge within 2 pixels of the picture's own
 * is green; one with a picture line 2 to NO_LINE pixels away is red (off: there is a line, and the edge is not on
 * it); one with no picture line within NO_LINE is amber (nothing to compare: a soft, low-contrast line the
 * detector missed, or a camera so far off nothing is near). A texture join is drawn thin and blue. `width` the
 * picture's unless told.
 */
export function overlayOf(map, picture, camera, { width = picture.width, height = picture.height, offsets = true } = {}) {
  const geometry = map.surfaces ? map : geometryOf(map);
  const field = pictureField(picture, width, height);
  const s = cameraScore(geometry, field, camera);
  const rgba = new Uint8Array(width * height * 4);
  const sx = picture.width / width;
  const sy = picture.height / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const j = (Math.floor(y * sy) * picture.width + Math.floor(x * sx)) * 4;
      for (let c = 0; c < 3; c++) rgba[k + c] = Math.round(picture.rgba[j + c] * 0.55);
      rgba[k + 3] = 255;
      if (field.edges[y * width + x]) {
        rgba[k] = Math.min(255, rgba[k] + 50);
        rgba[k + 1] = Math.min(255, rgba[k + 1] + 50);
        rgba[k + 2] = Math.min(255, rgba[k + 2] + 50);
      }
      const e = s.edges.edge[y * width + x];
      if (e === 1) {
        // red only where the picture has a line to be on and the edge is not: with no line near, amber. On the
        // true camera of a c1a0 view, soft shadowed beam undersides were red, read as off where they were right
        const d = field.dist[y * width + x];
        rgba.set(d <= 2 ? [60, 255, 60] : d <= NO_LINE ? [255, 50, 40] : [235, 180, 40], k);
      } else if (e === 2) rgba.set([70, 140, 255], k);
    }
  return {
    width,
    height,
    rgba,
    camera: { ...camera, fov: camera.fov ?? 90 },
    score: Math.round(s.score * 100) / 100,
    toPicture: Math.round(s.toPicture * 100) / 100,
    fromPicture: Math.round(s.fromPicture * 100) / 100,
    faces: offsets ? faceOffsets(geometry, field, camera) : [],
  };
}

/** Places a camera may stand over the map's floor: a grid over its faces that look up, at eye height 64. */
function standsOf(geometry, cell = 96) {
  const seen = new Set();
  const out = [];
  for (const s of geometry.surfaces) {
    if (s.normal[2] < 0.9) continue;
    const xs = s.polygon.map((p) => p[0]);
    const ys = s.polygon.map((p) => p[1]);
    for (let x = Math.ceil(Math.min(...xs) / cell) * cell; x <= Math.max(...xs); x += cell)
      for (let y = Math.ceil(Math.min(...ys) / cell) * cell; y <= Math.max(...ys); y += cell) {
        const z = (s.dist - s.normal[0] * x - s.normal[1] * y) / s.normal[2] + 64;
        const key = `${x},${y},${Math.round(z / 16)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([x, y, z]);
      }
  }
  return out;
}

/**
 * The camera that best lays the map's edges on a picture's: `{ camera, score, tried }`. From `from`/`yaw` (the
 * maker's guess) it refines by pattern search over x, y, z, yaw, pitch (and fov when `fitFov`); with none, it
 * first tries a grid of places over the map's floor at eye height, eight yaws each, and refines the best few.
 * `size`: the search's own picture width (160); the score is in pixels of that.
 */
export function fitCamera(map, picture, { from, yaw, pitch = 0, fov = 90, fitFov = false, size = 160, fine = 320, starts = 4, cell = 96, rounds = 60 } = {}) {
  const geometry = map.surfaces ? map : geometryOf(map);
  // the random steps are seeded: the same picture and guess give the same camera
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) & 0xffffff) / 0x1000000;
  const fieldAt = (w) => pictureField(picture, w, Math.round((w * picture.height) / picture.width));
  let field = fieldAt(size);
  let tried = 0;
  const cost = (c) => {
    tried++;
    const s = cameraScore(geometry, field, c);
    // a camera that sees no geometry edge at all is no answer
    return s.geometryPixels < 20 ? REACH * 2 : s.score;
  };
  const seeds = [];
  if (from) {
    const yaws = yaw === undefined ? [0, 45, 90, 135, 180, 225, 270, 315] : [yaw];
    for (const y of yaws) seeds.push({ from: [...from], yaw: y, pitch, fov });
  } else {
    for (const p of standsOf(geometry, cell)) for (const y of [0, 45, 90, 135, 180, 225, 270, 315]) seeds.push({ from: p, yaw: y, pitch, fov });
  }
  const scored = seeds.map((c) => ({ c, s: cost(c) })).sort((a, b) => a.s - b.s).slice(0, starts);
  // a pattern search from a camera: each of its numbers stepped both ways, the steps halved when none helps
  const refine = (start, s0, steps) => {
    let c = start;
    let s = s0;
    for (let r = 0; r < rounds; r++) {
      let moved = false;
      for (const key of Object.keys(steps)) {
        if (key === "fov" && !fitFov) continue;
        for (const sign of [1, -1]) {
          const t = { ...c, from: [...c.from] };
          if (key === "x") t.from[0] += sign * steps.x;
          else if (key === "y") t.from[1] += sign * steps.y;
          else if (key === "z") t.from[2] += sign * steps.z;
          else t[key] += sign * steps[key];
          const v = cost(t);
          if (v < s - 1e-3) {
            c = t;
            s = v;
            moved = true;
          }
        }
      }
      // steps across all the numbers at once: a step along one wall and a turn trade against each other in a box
      // room, a valley no step of one number at a time walks down (a guess 30 units off stayed so, 2026-10-17)
      for (let k = 0; k < 8 && !moved; k++) {
        const t = { ...c, from: [...c.from] };
        const g = () => (random() * 2 - 1) * 1.5;
        t.from[0] += g() * steps.x;
        t.from[1] += g() * steps.y;
        t.from[2] += g() * steps.z;
        t.yaw += g() * steps.yaw;
        t.pitch += g() * steps.pitch;
        if (fitFov) t.fov += g() * steps.fov;
        const v = cost(t);
        if (v < s - 1e-3) {
          c = t;
          s = v;
          moved = true;
        }
      }
      if (!moved) {
        for (const key of Object.keys(steps)) steps[key] /= 2;
        if (steps.x < 0.5 && steps.yaw < 0.25) break;
      }
    }
    return { camera: c, score: s };
  };
  let best = null;
  for (const { c: start, s: s0 } of scored) {
    const r = refine(start, s0, { x: 32, y: 32, z: 8, yaw: 8, pitch: 4, fov: 6 });
    if (!best || r.score < best.score) best = r;
  }
  // again on a finer picture from the best, with small steps: a pixel of the coarse picture is several units
  if (fine && fine > size) {
    field = fieldAt(fine);
    best = refine(best.camera, cost(best.camera), { x: 8, y: 8, z: 4, yaw: 2, pitch: 1, fov: 2 });
  }
  const round = (v, k = 10) => Math.round(v * k) / k;
  return { camera: { from: best.camera.from.map((v) => round(v)), yaw: round(best.camera.yaw), pitch: round(best.camera.pitch), fov: round(best.camera.fov) }, score: round(best.score, 100), tried, size: [field.width, field.height] };
}
