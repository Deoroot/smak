// A .glb drawn as a map view is (the kit's map-view camera: cameraOf), to lay beside the kit's own picture of the
// .bsp. It reads the file with validate.mjs, not with the writer, and turns glTF's axes back by the
// specification's convention alone: glTF (x, y, z) in metres is the map's (x, -z, y) x 39.37. Faces are culled
// from behind (glTF's front is anticlockwise), so a file wound or mirrored wrong draws holes, not a picture.
//
//   drawGlb(bytes, { from, to, yaw, pitch, fov, width, height })   `{ width, height, rgba, drawn }`
//   difference(a, b, { skip })   `{ mean, share, compared }` of two pictures: the mean of |a - b| a channel
//                                (0 to 255) and the share of pixels off by more than 48, where neither is `skip`
import { cameraOf } from "../../../check/maps/draw.mjs";
import { validateGlb } from "./validate.mjs";

const UNITS = 39.37;
const NEAR = 4;
const BACKGROUND = [14, 14, 18];
const encode = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function drawGlb(bytes, { from, to, yaw = 0, pitch = 0, fov = 90, width = 640, height = 480 }) {
  const { errors, triangles } = validateGlb(bytes);
  if (errors.length) throw new Error(`drawGlb: the file is not whole: ${errors[0]}`);
  const view = cameraOf({ from, to, yaw, pitch, fov }, width, height);
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < width * height; at++) rgba.set([...BACKGROUND, 255], at * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  let drawn = 0;
  triangles(({ corners, uvs, colours, material, picture }) => {
    // to the map's axes, then to the eye's: [right, up, forward]
    const eyed = corners.map(([x, y, z]) => {
      const p = [x * UNITS - view.eye[0], -z * UNITS - view.eye[1], y * UNITS - view.eye[2]];
      return [0, 1, 2].map((k) => [view.right, view.up, view.forward][k].reduce((sum, v, i) => sum + v * p[i], 0));
    });
    // the corners as [eye x, eye y, eye z, u, v, r, g, b], cut at the near plane
    let polygon = eyed.map((p, k) => [...p, ...uvs[k], ...(colours?.[k] ?? [1, 1, 1])]);
    const kept = [];
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      if (a[2] >= NEAR) kept.push(a);
      if (a[2] >= NEAR !== b[2] >= NEAR) kept.push(a.map((v, k) => v + ((b[k] - v) * (NEAR - a[2])) / (b[2] - a[2])));
    });
    if (kept.length < 3) return;
    const screen = kept.map((p) => [view.centreX + (view.focal * p[0]) / p[2], view.centreY - (view.focal * p[1]) / p[2], 1 / p[2], ...p.slice(3).map((v) => v / p[2])]); // prettier-ignore
    const mask = material?.alphaMode === "MASK";
    for (let k = 1; k + 1 < screen.length; k++) {
      const [a, b, c] = [screen[0], screen[k], screen[k + 1]];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      // anticlockwise in the world is clockwise on a picture whose y runs down: a front face has area < 0
      if (!(area < 0) && !material?.doubleSided) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const [px, py] = [x + 0.5, y + 0.5];
          const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
          const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const at = (k) => wa * a[k] + wb * b[k] + wc * c[k];
          const inverse = at(2);
          const z = 1 / inverse;
          if (z >= depth[y * width + x]) continue;
          const [u, v] = [at(3) * z, at(4) * z];
          let texel = [255, 255, 255, 255];
          if (picture) {
            const tx = ((Math.floor(u * picture.width) % picture.width) + picture.width) % picture.width;
            const ty = ((Math.floor(v * picture.height) % picture.height) + picture.height) % picture.height;
            texel = [...picture.rgba.subarray((ty * picture.width + tx) * 4, (ty * picture.width + tx) * 4 + 4)];
          }
          if (mask && texel[3] < 128) continue;
          const factor = material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
          const shade = [at(5) * z, at(6) * z, at(7) * z];
          depth[y * width + x] = z;
          for (let ch = 0; ch < 3; ch++) rgba[(y * width + x) * 4 + ch] = Math.round(255 * Math.min(1, encode(decode(texel[ch] / 255) * factor[ch] * shade[ch]))); // prettier-ignore
          drawn++;
        }
    }
  });
  return { width, height, rgba, drawn };
}

export function difference(a, b, { skip = null } = {}) {
  let sum = 0;
  let off = 0;
  let compared = 0;
  const same = (image, at) => skip && image.rgba[at] === skip[0] && image.rgba[at + 1] === skip[1] && image.rgba[at + 2] === skip[2];
  for (let at = 0; at < a.rgba.length; at += 4) {
    if (same(a, at) || same(b, at)) continue;
    compared++;
    const gap = [0, 1, 2].reduce((most, ch) => most + Math.abs(a.rgba[at + ch] - b.rgba[at + ch]), 0) / 3;
    sum += gap;
    if (gap > 48) off++;
  }
  return { mean: sum / Math.max(1, compared), share: off / Math.max(1, compared), compared: compared / (a.rgba.length / 4) };
}
