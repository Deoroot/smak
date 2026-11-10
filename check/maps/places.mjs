// Where each texture of a compiled map is best seen: its largest lit face of the world, with a camera square
// in front of it. The reproduction test's judge looks at a map's textures from these cameras, and the wad spec's
// preview (`preview: { map, each: true }`) draws a set of textures from the very same ones, so that what an
// agent checks is what is judged. With each place: how the face lays the texture (how many texels the view
// spans, which way the picture's up runs) and the light on it, which a colour read off such a view has to be
// divided by to be the paint (`material.seen: { colour, light }`).
//
//   texturePlaces(bsp) -> [{ name, width, height, from, yaw, pitch, area, lit, light, across, up, turned }]
//   placeView(bsp, place, { textures, folders, brightness }) -> a picture, as drawMap gives it
import { modelFaces, facePolygon, faceNormal, faceTexture, faceLightmap, faceTextureAxes, contentsAt, CONTENTS } from "../../core/maps/bsp.mjs";
import { drawMap } from "./draw.mjs";

/** Textures of the compilers' own and the sky's: never seen as a picture. */
const UNSEEN = /^(aaatrigger|sky|clip|null|origin|hint|skip|bevel)$/i;
/** The mean light (0 to 255) of a face's lightmap under which it counts as unlit: black in any picture. */
const LIT_LEAST = 12;
/** The brightness the judge's views are drawn at: three times the game's, so a texture in a dark corner shows. */
export const PLACE_BRIGHTNESS = 4.5;
/** The camera's field of view, and the picture's size. */
const PLACE_FOV = 70;
const PLACE_SIZE = [320, 240];

/** The area of a polygon of corners in space. */
function areaOf(corners) {
  let a = [0, 0, 0];
  for (let i = 1; i + 1 < corners.length; i++) {
    const u = corners[i].map((v, k) => v - corners[0][k]);
    const w = corners[i + 1].map((v, k) => v - corners[0][k]);
    a = a.map((s, k) => s + [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]][k] / 2);
  }
  return Math.hypot(...a);
}

/** The mean of a face's steady light, [r, g, b] each 0 to 255; zeros when it has none. */
function meanLight(bsp, face) {
  const rgb = faceLightmap(bsp, face)?.styles.find((style) => style.style === 0)?.rgb;
  if (!rgb?.length) return [0, 0, 0];
  const sum = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += rgb[i + c];
  return sum.map((v) => v / (rgb.length / 3));
}

/**
 * Each texture of the map's world, at its largest lit face (its largest when none is lit), with a camera that
 * looks square at it from in front: `{ name, width, height, from, yaw, pitch, area, lit, light, across, up,
 * turned }`, largest first. `light` is the face's mean steady light, [r, g, b], as the renderer lays it at
 * PLACE_BRIGHTNESS (a texel of colour c is seen as c times this, channel by channel, up to white: a lamp's
 * colour is in it); `across` how many of the
 * texture's texels the view spans side to side; `up` the world's direction the picture's top points along on
 * that face, and `turned` the degrees it is turned from the world's up (a wall) or north (a floor).
 */
export function texturePlaces(bsp) {
  const best = new Map();
  for (const face of modelFaces(bsp, 0)) {
    const texture = faceTexture(bsp, face);
    if (UNSEEN.test(texture.name)) continue;
    const corners = facePolygon(bsp, face);
    const area = areaOf(corners);
    const light = meanLight(bsp, face);
    const lit = (light[0] + light[1] + light[2]) / 3 >= LIT_LEAST;
    // a face the map leaves unlit is black in any picture: one that is lit stands before any that is not, and
    // one lit in every colour before one under a coloured lamp (under a blue one, a texture's red is not seen)
    const white = Math.min(...light) >= LIT_LEAST;
    const rank = area * (white ? 1 : lit ? 1e-3 : 1e-6);
    if (rank > (best.get(texture.name)?.rank ?? 0)) best.set(texture.name, { face, area, rank, lit, light, corners, texture });
  }
  return [...best.values()]
    .map(({ face, corners, texture, area, lit, light }) => {
      const normal = faceNormal(bsp, face);
      const mid = corners.reduce((s, c) => s.map((v, k) => v + c[k] / corners.length), [0, 0, 0]);
      const span = Math.sqrt(area);
      // back from the face as far as its size asks, but never through the wall, floor or ceiling across from it
      const wanted = Math.min(160, Math.max(40, span * 0.8));
      let free = 2;
      while (free < wanted && contentsAt(bsp, mid.map((v, k) => v + normal[k] * (free + 4))) !== CONTENTS.SOLID) free += 4;
      const dist = Math.max(8, Math.min(wanted, free * 0.9));
      const from = mid.map((v, k) => v + normal[k] * dist);
      const yaw = (Math.atan2(-normal[1], -normal[0]) * 180) / Math.PI;
      const pitch = (Math.asin(Math.max(-1, Math.min(1, -normal[2]))) * 180) / Math.PI;
      // the view's width at the face, in units, and in the texture's texels along s
      const { s, t } = faceTextureAxes(bsp, face);
      const widthUnits = 2 * dist * Math.tan((PLACE_FOV * Math.PI) / 360);
      const across = Math.round(widthUnits * Math.hypot(s[0], s[1], s[2]));
      // the picture's top: against t (t runs down it)
      const tLength = Math.hypot(t[0], t[1], t[2]) || 1;
      const up = [-t[0] / tLength, -t[1] / tLength, -t[2] / tLength].map((v) => Math.round(v * 100) / 100);
      const wall = Math.abs(normal[2]) < 0.7;
      // the world's up on a wall, north on a floor or a ceiling, laid into the face's plane
      const ref = wall ? [0, 0, 1] : [0, 1, 0];
      const inPlane = ref.map((v, k) => v - normal[k] * (ref[0] * normal[0] + ref[1] * normal[1] + ref[2] * normal[2]));
      const refLength = Math.hypot(...inPlane) || 1;
      const cos = (up[0] * inPlane[0] + up[1] * inPlane[1] + up[2] * inPlane[2]) / refLength;
      const cross = [inPlane[1] * up[2] - inPlane[2] * up[1], inPlane[2] * up[0] - inPlane[0] * up[2], inPlane[0] * up[1] - inPlane[1] * up[0]];
      const sin = (cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]) / refLength;
      const turned = Math.round((Math.atan2(sin, cos) * 180) / Math.PI);
      return {
        name: texture.name,
        width: texture.width,
        height: texture.height,
        from,
        yaw,
        pitch,
        area,
        lit,
        light: light.map((v) => Math.round((v / 255) * PLACE_BRIGHTNESS * 100) / 100),
        across,
        up,
        turned,
        wall,
      };
    })
    .sort((a, b) => b.area - a.area);
}

/**
 * A view of a texture's place: from its camera, at PLACE_BRIGHTNESS, the map wearing `textures` (a .wad's)
 * where given and the textures of `folders` otherwise. No entities, no labels: the texture and its wall.
 */
export function placeView(bsp, place, { textures, folders = [], brightness = PLACE_BRIGHTNESS, light, wearing } = {}) {
  return drawMap(bsp, {
    from: place.from,
    yaw: place.yaw,
    pitch: place.pitch,
    fov: PLACE_FOV,
    width: PLACE_SIZE[0],
    height: PLACE_SIZE[1],
    folders: textures ? [] : folders,
    textures,
    entities: "none",
    labels: false,
    brightness,
    ...(light === undefined ? {} : { light }),
    ...(wearing ? { wearing } : {}),
  });
}
