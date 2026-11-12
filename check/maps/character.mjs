// A compiled map's character in numbers: the shape of its ground, its textures, what stands and sounds in
// it, and its light, held against a mod's own maps. What players call "all straight lines" or "flat" is
// in these numbers: walls that run along the grid, floors at few heights, one even light.
//
//   offGrid       the share of the wall area (faces standing within 17 degrees of upright) that runs along
//                 neither axis: a rock that leans, a wall that bends
//   sloped        the share of the floor area (faces looking up, 0.7 or more) that is not level
//   levels        how many heights of 32 units hold 2% of the floor or more: the storeys and terraces
//   heightSpread  the spread (standard deviation) of the floor's height, weighted by area
//   textures      how many textures the world's faces wear, the compilers' marks and the sky left out
//   props         entities of the profile's `character.props` (a model standing in the map)
//   sounds        entities of the profile's `character.sounds` (a sound that plays, a room's echo)
//   music         entities of the profile's `character.music`
//   lights        `light` and `light_spot` entities
//   lampFaces     faces (of every model) wearing a lamp's texture (dressing.mjs's `lampsOf`: the game's texture
//                 lights, a `~` name, a lamp's word, what the map's `info_texlights` names): a map lit by its
//                 texture lights has few light entities and many of these, and is no unlit map
//   lightMean     the floor's light, the mean of its samples, 0 to 255 (`lightReport`)
//   shadow        the share of the floor whose light is under 24 (`DARK_FLOOR`)
//   brightest     the floor's brightest light
//
// A profile's `character.figures` holds the mod's own maps' figures as [lower quartile, median, upper
// quartile] (`learnCharacter` makes them from a folder of maps). A figure under the lower quartile where low
// is plain (`LOW_IS_PLAIN`), or over the upper where high is, is told as plain; a map with five or more
// such figures is told it looks plain (`characterAgainst`). One figure alone is no fault: a bright field or
// a flat town can be a good map.
import { modelFaces, faceNormal, facePolygon, faceTexture, worldBounds } from "../../core/maps/bsp.mjs";
import { lightReport, DARK_FLOOR } from "./light.mjs";
import { textureKind } from "../../core/maps/miptex.mjs";
import { isCompiled } from "../../make/maps/space.mjs";
import { modOf, isNamed, GOLDSRC } from "../../make/maps/mod.mjs";
import { lampsOf } from "./dressing.mjs";

/** A face looking this much up is floor; one within this of upright is wall. */
const FLOOR = 0.7;
const WALL = 0.3;
/** A face this near an axis runs along it. */
const ALONG = 0.999;
/** The step of a floor's levels, and the share of the floor a level must hold. */
const LEVEL = 32;
const LEVEL_SHARE = 0.02;
/** The figures where a map under its mod's lower quartile is plain, and the one where over the upper is. */
export const LOW_IS_PLAIN = ["offGrid", "sloped", "levels", "heightSpread", "textures", "sounds", "shadow", "brightest"];
export const HIGH_IS_PLAIN = ["lightMean"];
/** How many plain figures make a plain map (`characterAgainst`). */
export const PLAIN_MOST = 5;
/** What each figure is, in words, and what a plain one does to a map. */
const SAID = {
  offGrid: ["walls off the grid", "%", "walls along the grid read as rooms, not as ground: lean a rock, bend a path or a bank"],
  sloped: ["floor that slopes", "%", "level floor everywhere is a floor of rooms: banks, ramps and uneven ground"],
  levels: ["floor levels", "", "few heights give no views: terraces, stairs, a high place to look from"],
  heightSpread: ["spread of the floor's height", " units", "a flat map: let the ground climb and fall"],
  textures: ["textures", "", "few textures make each place look like the last: a set of its own for each part"],
  sounds: ["sounds", "", "a silent map: water, wind, a room's echo"],
  shadow: ["floor in shadow", "%", "light with no dark between it has no depth and leads nowhere"],
  brightest: ["brightest light on the floor", "", "no pool of light to draw the eye: lamps, a sunlit opening"],
  lightMean: ["light on the floor", "", "lit evenly bright: put shade between the lights"],
};
const PERCENT = new Set(["offGrid", "sloped", "shadow"]);
const COMPILER_MARKS = /^(aaa|clip|null|origin|hint|skip|trigger|bevel|sky$|solidhint|black_hidden)/i;

/** The area of a polygon. */
function areaOf(points) {
  const sum = [0, 0, 0];
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum[0] += a[1] * b[2] - a[2] * b[1];
    sum[1] += a[2] * b[0] - a[0] * b[2];
    sum[2] += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(...sum) / 2;
}
/** The profile's classes for props, sounds and music. */
function classesOf(mod) {
  return {
    props: ["cycler", "cycler_sprite", "monster_furniture", "monster_generic"],
    sounds: ["ambient_generic", "env_sound"],
    music: [],
    ...mod?.character,
  };
}

/**
 * A compiled map's figures (above): `{ figures, facts }`. `mod` names the classes counted as props, sounds
 * and music (its `character`).
 */
export function characterOf(bsp, { mod } = {}) {
  if (!isCompiled(bsp)) throw new Error("characterOf: a compiled map (readBsp): its faces and its light are measured");
  const profile = modOf(mod) ?? GOLDSRC;
  const classes = classesOf(profile);
  let wall = 0;
  let wallOff = 0;
  let floor = 0;
  let floorSloped = 0;
  const heights = [];
  const textures = new Set();
  for (const face of modelFaces(bsp, 0)) {
    const name = faceTexture(bsp, face).name;
    const kind = textureKind(name);
    if (COMPILER_MARKS.test(name) || kind.sky || kind.tool) continue;
    textures.add(name.toLowerCase());
    const normal = faceNormal(bsp, face);
    const points = facePolygon(bsp, face);
    const area = areaOf(points);
    if (normal[2] >= FLOOR) {
      floor += area;
      if (normal[2] < ALONG) floorSloped += area;
      heights.push([points.reduce((sum, point) => sum + point[2], 0) / points.length, area]);
    } else if (Math.abs(normal[2]) < WALL) {
      wall += area;
      if (Math.max(Math.abs(normal[0]), Math.abs(normal[1])) < ALONG) wallOff += area;
    }
  }
  const mean = floor ? heights.reduce((sum, [z, area]) => sum + z * area, 0) / floor : 0;
  const spread = floor ? Math.sqrt(heights.reduce((sum, [z, area]) => sum + area * (z - mean) ** 2, 0) / floor) : 0;
  const bins = new Map();
  for (const [z, area] of heights) bins.set(Math.round(z / LEVEL), (bins.get(Math.round(z / LEVEL)) ?? 0) + area);
  const levels = [...bins.values()].filter((area) => floor && area / floor >= LEVEL_SHARE).length;
  const classnames = bsp.entities.map((pairs) => pairs.find((pair) => pair[0] === "classname")?.[1] ?? "");
  const counted = (list) => classnames.filter((name) => isNamed(list, name)).length;
  const light = lightReport(bsp);
  const lit = typeof light.floor?.mean === "number" && light.floor.area > 0;
  const { mins, maxs } = worldBounds(bsp);
  const isLamp = lampsOf(bsp);
  let lampFaces = 0;
  for (let model = 0; model < bsp.models.length; model++)
    for (const face of modelFaces(bsp, model)) if (isLamp(faceTexture(bsp, face)?.name ?? "")) lampFaces++;
  const figures = {
    size: maxs.map((value, axis) => Math.round(value - mins[axis])),
    faces: bsp.faces.length,
    floorArea: Math.round(floor),
    offGrid: wall ? round1((100 * wallOff) / wall) : 0,
    sloped: floor ? round1((100 * floorSloped) / floor) : 0,
    levels,
    heightSpread: Math.round(spread),
    textures: textures.size,
    props: counted(classes.props),
    sounds: counted(classes.sounds),
    music: counted(classes.music),
    lights: counted(["light", "light_spot"]),
    lampFaces,
    lightMean: lit ? round1(light.floor.mean) : null,
    shadow: lit ? round1(100 * light.floor.darkShare) : null,
    brightest: lit ? light.floor.most : null,
  };
  const facts = [
    `${figures.size.join(" x ")} units, ${figures.faces} faces, ${Math.round(floor / 1000)} thousand square units of floor`,
    `the ground: ${figures.offGrid}% of the walls off the grid, ${figures.sloped}% of the floor sloped, ${levels} floor levels (${LEVEL} units, ${LEVEL_SHARE * 100}% of the floor each), a height spread of ${figures.heightSpread}`, // prettier-ignore
    `the dressing: ${figures.textures} textures, ${figures.props} props, ${figures.sounds} sounds, ${figures.music} music, ${figures.lights} lights and ${figures.lampFaces} lamp faces (texture lights)`,
    figures.lightMean === null
      ? "the light: the map has none (no lightmaps)"
      : `the light on the floor: ${figures.lightMean} of 255 on average, ${figures.shadow}% of it under ${DARK_FLOOR}, the brightest ${figures.brightest}`,
  ];
  return { figures, facts };
}
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * A map's figures held against its mod's (`reference`: `{ from, figures: { name: [q1, median, q3] } }`):
 * `{ plain, warning }`. `plain`: a sentence for each figure on the plain side of the mod's middle half
 * (under its lower quartile where low is plain, over the upper where high is). `warning`: one sentence when
 * `most` (5) or more of the nine are, else null. One figure says little: of the game's own 94 maps, those
 * its players come back to have up to 3 (thornlands, a bright field, has 3; gatecity and challs, flat, 2);
 * the maps of a gauntlet a player called plain had 6 (the Old Orchard) and 8 (the Barrow Road); the game's
 * maps with 5 or more are its oldest and its betas (ms_swamp, ms_caves, ms_quest, ww1, orcplace2_beta).
 */
export function characterAgainst(figures, reference, { most = PLAIN_MOST } = {}) {
  if (!reference?.figures) return { plain: [], warning: null };
  const plain = [];
  const unit = (name) => (PERCENT.has(name) ? "%" : "");
  const range = (name, [low, middle, high]) =>
    `${reference.from ?? "the mod's maps"}: ${low}${unit(name)} to ${high}${unit(name)}, middling ${middle}${unit(name)}`;
  const told = (name, side) => {
    const [words, , why] = SAID[name];
    plain.push({ name, text: `${words}: ${figures[name]}${unit(name)}, ${side} ${range(name, reference.figures[name])}. ${why}` });
  };
  const has = (name) => reference.figures[name] && typeof figures[name] === "number";
  for (const name of LOW_IS_PLAIN) if (has(name) && figures[name] < reference.figures[name][0]) told(name, "under");
  for (const name of HIGH_IS_PLAIN) if (has(name) && figures[name] > reference.figures[name][2]) told(name, "over");
  const counted = [...LOW_IS_PLAIN, ...HIGH_IS_PLAIN].filter(has).length;
  const warning =
    plain.length >= most
      ? `the map looks plain beside ${reference.from ?? "the mod's maps"}: ${plain.length} of ${counted} figures are on the plain side of their middle half (${plain.map((each) => SAID[each.name][0]).join(", ")}); ${most} or more is a plain map (Master Sword's maps that players come back to have up to 3)`
      : null;
  return { plain: plain.map((each) => each.text), warning };
}

/**
 * The figures of many maps as a reference: `{ from, maps, figures: { name: [q1, median, q3] } }`. `list` is
 * `[{ name, figures }]` as `characterOf` gives them (a map with no light is left out of the light's figures).
 */
export function learnCharacter(list, { from } = {}) {
  const names = [...LOW_IS_PLAIN, ...HIGH_IS_PLAIN, "props", "lights", "lampFaces", "music", "floorArea", "faces"];
  const figures = {};
  for (const name of names) {
    const values = list.map((each) => each.figures[name]).filter((value) => typeof value === "number").sort((a, b) => a - b);
    if (!values.length) continue;
    const at = (share) => values[Math.min(values.length - 1, Math.floor(share * values.length))];
    figures[name] = [at(0.25), at(0.5), at(0.75)];
  }
  return { from: from ?? `${list.length} maps`, maps: list.map((each) => each.name), figures };
}
