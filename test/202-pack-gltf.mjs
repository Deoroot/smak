// The glTF pack (packs/gltf): the kit's two rooms written as a .glb and held against the .bsp by what does not
// come from the writer: the file against the specification's points (packs/gltf/test/validate.mjs), each
// texture's area against the faces' own, the rooms' walls facing in from where a player stands (a mirror or a
// wrong winding turns them out), the grate where the map has it, a view of the file against map-view's, a `{`
// texture masked at the game's cut-off with no mipmaps, a tool's texture and the sky left out, and a model placed
// three times: one mesh for the two in one light, each tinted by the floor's light under it as the game lights a model.
// The lit way: lit materials and no baked light, a set's normal, roughness, metalness and occlusion with TANGENT
// held against the triangles' own u and v, the lamps at the game's brightness, a texture light emissive and its
// lamps held against hlrad's arithmetic, a set of another texture left out, the props lit like the world.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { mapGlb } from "../packs/gltf/gltf.mjs";
import { validateGlb } from "../packs/gltf/test/validate.mjs";
import { drawGlb, difference } from "../packs/gltf/test/draw.mjs";
import { test, sure, HERE, tmp } from "./helper.mjs";
import { unpng } from "../core/image.mjs";
import { writeLitSet, GREYS, domes } from "./fixture-gltf.mjs";

const FIXTURES = join(HERE, "fixtures");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const UNITS = 39.37;
/** glTF (x, y, z) in metres is the map's (x, -z, y) x 39.37: the specification's +y up, read back independently. */
const toMap = ([x, y, z]) => [x * UNITS, -z * UNITS, y * UNITS];
const sub = (a, b) => a.map((v, k) => v - b[k]);
const crossOf = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const areaOf = (a, b, c) => Math.hypot(...crossOf(sub(b, a), sub(c, a))) / 2;

/** The .bsp's own drawn faces: the area of each texture's (m²), from the faces' polygons; sky and tools left out. */
function bspAreas(bytes) {
  const bsp = maps.readBsp(bytes);
  const areas = new Map();
  for (const face of bsp.faces) {
    const name = bsp.textures[bsp.texinfo[face.texinfo].texture].name;
    const kind = maps.textureKind(name);
    if (kind.sky || kind.tool) continue;
    const polygon = maps.facePolygon(bsp, face);
    let area = 0;
    for (let k = 1; k + 1 < polygon.length; k++) area += areaOf(polygon[0], polygon[k], polygon[k + 1]);
    areas.set(name, (areas.get(name) ?? 0) + area / UNITS ** 2);
  }
  return areas;
}
/** What a .glb holds, read back: each material's triangles and area (m²), and the triangles as the map's points. */
function readBack(glb) {
  const read = validateGlb(glb);
  const byMaterial = new Map();
  const triangles = [];
  read.triangles((each) => {
    const name = each.material?.name ?? "";
    const area = areaOf(...each.corners);
    const was = byMaterial.get(name) ?? { triangles: 0, area: 0 };
    byMaterial.set(name, { triangles: was.triangles + 1, area: was.area + area, material: each.material, picture: each.picture }); // prettier-ignore
    triangles.push({ ...each, points: each.corners.map(toMap) });
  });
  return { ...read, byMaterial, triangles };
}
const made = mapGlb(tworoomsBytes);
const back = readBack(made.glb);

test("the two rooms as a .glb: whole by the specification, each texture's area the faces' own, the triangles all there", () => {
  sure(!back.errors.length, back.errors.join("; "));
  sure(back.json.asset.version === "2.0" && back.json.extensionsUsed.includes("KHR_materials_unlit") && back.json.extensionsUsed.includes("KHR_lights_punctual"), JSON.stringify(back.json.extensionsUsed)); // prettier-ignore
  const total = [...back.byMaterial.values()].reduce((sum, each) => sum + each.triangles, 0);
  sure(total === made.facts.triangles.world && made.facts.triangles.props === 0, `${total} read, ${made.facts.triangles.world} written`);
  // cut on the lightmaps' grid: more triangles than the faces fanned, the same surface
  sure(made.facts.faces === 43 && made.facts.fanned === 112 && total > made.facts.fanned, `${made.facts.faces} faces, ${made.facts.fanned} fanned, ${total}`); // prettier-ignore
  const want = bspAreas(tworoomsBytes);
  for (const [name, area] of want) {
    const got = [...back.byMaterial].filter(([material]) => material.split(" ")[0] === name).reduce((sum, [, each]) => sum + each.area, 0); // prettier-ignore
    sure(Math.abs(got - area) < 1e-4 * area, `${name}: ${got} m² in the file, ${area} in the map`);
  }
  sure(back.json.nodes.length === 6 && back.json.extensions.KHR_lights_punctual.lights.length === 2, `${back.json.nodes.length} nodes`);
  const start = back.json.nodes.find((node) => node.extras?.classname === "info_player_start");
  sure(start.extras.origin.join() === "96,96,40" && start.extras.keys.angles === "0 90 0", JSON.stringify(start.extras));
  const [x, y, z] = start.translation;
  sure(Math.abs(x - 96 / UNITS) < 1e-6 && Math.abs(y - 40 / UNITS) < 1e-6 && Math.abs(z + 96 / UNITS) < 1e-6, `${start.translation}`);
});

test("handedness: every face of room A looks into it from where the player starts, the grate stands where the map has it", () => {
  const eye = [96, 96, 64];
  let inA = 0;
  for (const { points } of back.triangles) {
    if (!points.every(([x, y, z]) => x > -1 && x < 193 && y > -1 && y < 193 && z > -1 && z < 129)) continue;
    inA++;
    const facing = crossOf(sub(points[1], points[0]), sub(points[2], points[0]));
    sure(facing.reduce((sum, v, k) => sum + v * (eye[k] - points[0][k]), 0) > 0, `a face of room A at ${points[0]} turns away from the room`);
  }
  sure(inA > 100, `${inA} triangles in room A`);
  const grate = back.triangles.filter((each) => each.material?.name === "{smakgrate masked").flatMap((each) => each.points);
  const low = [0, 1, 2].map((k) => Math.min(...grate.map((p) => p[k])));
  const high = [0, 1, 2].map((k) => Math.max(...grate.map((p) => p[k])));
  sure([...low, ...high].map((v) => Math.round(v)).join() === "204,320,0,208,384,96", `the grate from ${low} to ${high}`);
});

test("a view of the .glb is map-view's: the corridor from room A, its doorway on the left", () => {
  const camera = { from: [272, 150, 60], yaw: 90, pitch: -10, width: 320, height: 240 };
  const kit = maps.drawMap(maps.readBsp(tworoomsBytes), { ...camera, entities: "game", labels: false });
  const ours = drawGlb(made.glb, camera);
  const gap = difference(kit, ours);
  sure(ours.drawn > 0.95 * 320 * 240 && gap.mean < 16 && gap.share < 0.02, `mean ${gap.mean.toFixed(1)}, ${(gap.share * 100).toFixed(1)}% off; ${ours.drawn} drawn`); // prettier-ignore
  // the measure tells views apart: the same camera moved 176 units west is far from map-view's (a mirrored file fails above, in the walls facing in)
  const elsewhere = drawGlb(made.glb, { ...camera, from: [96, 150, 60] });
  sure(difference(kit, elsewhere).mean > gap.mean * 2, "a view from elsewhere is not as near: the measure tells");
});

test("a `{` texture on an entity in render mode 4 is masked, its holes see-through; the world's light is COLOR_0 on unlit materials", () => {
  const grate = back.byMaterial.get("{smakgrate masked");
  // the game's alpha test for a brush entity in render mode 4 (Xash gl_rsurf.c: GL_GREATER 0.25)
  sure(grate?.material.alphaMode === "MASK" && grate.material.alphaCutoff === 0.25, JSON.stringify(grate?.material));
  const alpha = [];
  for (let at = 3; at < grate.picture.rgba.length; at += 4) alpha.push(grate.picture.rgba[at]);
  sure(alpha.includes(0) && alpha.includes(255) && alpha.every((a) => a === 0 || a === 255), "holes and texels");
  // its mip levels would average the holes into the bars (under the cut-off from the fourth on, the grate gone in
  // Godot): the masked texture is sampled with no mipmaps, every other with them
  const samplerOf = (material) => back.json.samplers[back.json.textures[material.pbrMetallicRoughness.baseColorTexture.index].sampler]; // prettier-ignore
  sure(samplerOf(grate.material).minFilter === 9729, JSON.stringify(samplerOf(grate.material)));
  const wall = back.byMaterial.get("smakwall");
  sure(samplerOf(wall.material).minFilter === 9987, JSON.stringify(samplerOf(wall.material)));
  sure(wall.material.alphaMode === undefined && wall.material.extensions.KHR_materials_unlit, JSON.stringify(wall.material));
  const shades = back.triangles.filter((each) => each.colours).flatMap((each) => each.colours.map((c) => c[0]));
  sure(shades.length === back.triangles.length * 3 && Math.min(...shades) < 0.2 && Math.max(...shades) > 0.6, `${Math.min(...shades)} to ${Math.max(...shades)}`); // prettier-ignore
});

test("a tool's texture and the sky are left out: no material, no triangle, the rest whole", () => {
  // the floor's texture renamed aaatrigger in the map's texture lump: its faces go, the walls stay
  const bytes = Buffer.from(tworoomsBytes);
  const bsp = maps.readBsp(bytes);
  const floor = bsp.textures.find((texture) => texture.name === "smakfloor");
  bytes.fill(0, floor.at, floor.at + 16);
  bytes.write("aaatrigger", floor.at, "latin1");
  const tool = readBack(mapGlb(bytes).glb);
  sure(!tool.errors.length && ![...tool.byMaterial.keys()].some((name) => /aaatrigger|smakfloor/.test(name)), [...tool.byMaterial.keys()].join()); // prettier-ignore
  const walls = (read) => read.byMaterial.get("smakwall").area;
  sure(Math.abs(walls(tool) - walls(back)) < 1e-6, "the walls are as they were");
  const skygap = readFileSync(join(FIXTURES, "skygap.bsp"));
  const sky = readBack(mapGlb(skygap).glb);
  sure(!sky.errors.length && !sky.byMaterial.has("sky") && sky.byMaterial.size === 3, [...sky.byMaterial.keys()].join());
  const want = [...bspAreas(skygap).values()].reduce((a, b) => a + b, 0);
  const got = [...sky.byMaterial.values()].reduce((sum, each) => sum + each.area, 0);
  sure(Math.abs(got - want) < 1e-4 * want, `${got} against ${want}`);
});

/** The light of the floor under a point, read from the .bsp by the faces' polygons (not the pack's walk of the tree). */
function floorSample(bsp, [x, y]) {
  for (const face of bsp.faces.slice(0, bsp.models[0].faceCount)) {
    const polygon = maps.facePolygon(bsp, face);
    if (maps.faceNormal(bsp, face)[2] < 0.99 || Math.abs(polygon[0][2]) > 0.5) continue;
    const sides = polygon.map((a, i) => { const b = polygon[(i + 1) % polygon.length]; return Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])); }); // prettier-ignore
    const inside = sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
    const light = maps.faceLightmap(bsp, face);
    if (!inside || !light) continue;
    const { s, t } = bsp.texinfo[face.texinfo];
    const u = Math.round((s[0] * x + s[1] * y + s[3] - light.originS) / maps.LUXEL);
    const v = Math.round((t[0] * x + t[1] * y + t[3] - light.originT) / maps.LUXEL);
    return [0, 1, 2].map((c) => light.styles.reduce((sum, style) => sum + style.rgb[(v * light.width + u) * 3 + c], 0)); // prettier-ignore
  }
  return null;
}

test("a model placed three times: one mesh for those in one light, each node where its entity stands and turned by its angles, lit as the game lights a model", () => {
  const game = join(tmp, "pack-gltf", "game");
  mkdirSync(join(game, "models"), { recursive: true });
  const palette = new Uint8Array(768).fill(200);
  // a wedge whose point is +x, 32 long: where the point ends up says how the model was turned
  const corner = (index, s, t) => [index, 0, s, t];
  writeFileSync(join(game, "models", "wedge.mdl"), smak.writeMdl({
    name: "wedge.mdl",
    bones: [{ name: "root", parent: -1 }],
    sequences: [{ name: "idle", fps: 10, frames: [[[0, 0, 0, 0, 0, 0]]] }],
    textures: [{ name: "wedge.bmp", width: 8, height: 8, pixels: new Uint8Array(64), palette, flags: 0 }],
    bodyparts: [{ name: "wedge", models: [{ name: "wedge", verts: [[32, 0, 0], [0, -8, 0], [0, 8, 0], [0, 0, 16]], vertBones: [0, 0, 0, 0], meshes: [{ skin: 0, norms: [[1, 0, 0]], normBones: [0], tris: [[corner(0, 0, 0), corner(3, 8, 0), corner(1, 0, 8)], [corner(0, 0, 0), corner(2, 8, 8), corner(3, 8, 0)], [corner(0, 0, 0), corner(1, 0, 8), corner(2, 8, 8)], [corner(1, 0, 8), corner(3, 8, 0), corner(2, 8, 8)]] }] }] }], // prettier-ignore
  }));
  let entities = maps.readBsp(tworoomsBytes).entities;
  entities = maps.addEntity(entities, "env_model", [96, 96, 0], { model: "models/wedge.mdl", angles: "0 90 0" });
  entities = maps.addEntity(entities, "env_model", [8, 180, 0], { model: "models/wedge.mdl", angles: "0 0 0" });
  entities = maps.addEntity(entities, "env_model", [96, 96, 0], { model: "models/wedge.mdl", angles: "0 180 0" });
  const bytes = maps.withEntities(tworoomsBytes, entities);
  const placed = mapGlb(bytes, { folders: [game] });
  const read = readBack(placed.glb);
  sure(!read.errors.length && placed.facts.props === 3 && placed.facts.shared === 2, `${read.errors} ${placed.facts.props} ${placed.facts.shared}`);
  const nodes = read.json.nodes.filter((node) => node.extras?.classname === "env_model");
  // the two on one spot turned about the upright alone are lit alike and share; the one elsewhere has a light of its own
  sure(nodes.length === 3 && nodes[0].mesh === nodes[2].mesh && nodes[0].mesh !== nodes[1].mesh, "the two in one light share their mesh"); // prettier-ignore
  const of = (node) => read.triangles.filter((each) => each.node === read.json.nodes.indexOf(node));
  const tips = [nodes[0], nodes[1]].flatMap((node) => of(node).flatMap((each) => each.points));
  const near = (point) => tips.some((p) => Math.hypot(...sub(p, point)) < 1e-3);
  sure(near([96, 128, 0]) && near([40, 180, 0]) && near([96, 96, 16]), "the point of the one turned 90 is north of its origin, the other's east");
  const want = 3 * [[[32, 0, 0], [0, 0, 16], [0, -8, 0]], [[32, 0, 0], [0, 8, 0], [0, 0, 16]], [[32, 0, 0], [0, -8, 0], [0, 8, 0]], [[0, -8, 0], [0, 0, 16], [0, 8, 0]]].reduce((sum, [a, b, c]) => sum + areaOf(a, b, c), 0) / UNITS ** 2; // prettier-ignore
  sure(Math.abs(placed.facts.area.props - want) < 1e-6, `${placed.facts.area.props} m² of props, ${want} made`);
  // the game's light for a model (Xash gl_studio.c): the floor's sample under it, on an unlit material; every normal of
  // the wedge lies flat (1, 0, 0), so each corner keeps 1 - 0.9 x 0.495 / 1.495 of it; and the map's 1.55 x 0.745
  const bsp = maps.readBsp(bytes);
  const [lit, dim] = [floorSample(bsp, [96, 96]), floorSample(bsp, [8, 180])];
  sure(Math.max(...dim) < Math.max(...lit) - 20, `under the lamp ${lit}, in the corner ${dim}: lights of their own`);
  for (const [n, sample] of [[0, lit], [1, dim]]) {
    const expected = sample.map((s) => Math.min(1, (s * 1.55 * 0.745 * (1 - (0.9 * 0.495) / 1.495)) / 255)).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); // prettier-ignore
    const got = of(nodes[n]);
    sure(got.every((each) => each.material.extensions?.KHR_materials_unlit && each.colours.every((colour) => colour.every((c, k) => Math.abs(c - expected[k]) < 1.5 / 255))), `wedge ${n} on ${sample}: ${got[0].colours[0]} against ${expected}`); // prettier-ignore
  }
});

// ── the lit way ──
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sets = writeLitSet(join(tmp, "pack-gltf", "lit-sets"));
/** The two rooms with smakfloor a texture light (info_texlights, as hlrad is told), written lit with smakwall's set. */
const glowing = maps.withEntities(tworoomsBytes, maps.addEntity(maps.readBsp(tworoomsBytes).entities, "info_texlights", [0, 0, 0], { smakfloor: "255 128 0 500" })); // prettier-ignore
const litMade = mapGlb(glowing, { light: "lit", sets: [sets] });
const lit = readBack(litMade.glb);

test("the lit way: whole by the specification, no baked light (no COLOR_0, nothing unlit, no cut on the light's grid), each texture's area the faces' own", () => {
  sure(!lit.errors.length, lit.errors.join("; "));
  sure(!lit.json.extensionsUsed.includes("KHR_materials_unlit") && lit.triangles.every((each) => !each.colours), JSON.stringify(lit.json.extensionsUsed)); // prettier-ignore
  // the faces fanned, not cut (a fan's triangle with no area left out: the areas below say none is missing)
  sure(litMade.facts.triangles.world <= litMade.facts.fanned && litMade.facts.fanned === 112 && made.facts.triangles.world > 3 * litMade.facts.triangles.world, `${litMade.facts.triangles.world} triangles, ${litMade.facts.fanned} fanned, ${made.facts.triangles.world} baked`); // prettier-ignore
  for (const [name, area] of bspAreas(tworoomsBytes)) {
    const got = [...lit.byMaterial].filter(([material]) => material.split(" ")[0] === name).reduce((sum, [, each]) => sum + each.area, 0); // prettier-ignore
    sure(Math.abs(got - area) < 1e-4 * area, `${name}: ${got} m² in the file, ${area} in the map`);
  }
  // the grate is cut out as in the baked way; the default is baked, byte for byte; a way it does not know is refused
  const grate = lit.byMaterial.get("{smakgrate masked").material;
  sure(grate.alphaMode === "MASK" && grate.alphaCutoff === 0.25, JSON.stringify(grate));
  sure(Buffer.compare(mapGlb(tworoomsBytes, { light: "baked", sets: [sets] }).glb, made.glb) === 0, "light baked is the default's bytes");
  let refused = "";
  try { mapGlb(tworoomsBytes, { light: "dark" }); } catch (error) { refused = error.message; } // prettier-ignore
  sure(refused === 'light "dark": baked or lit', refused);
});

test("the lit way: smakwall's set as glTF wants it, the normal as written and each TANGENT along u, its w turning up the picture (v falling)", () => {
  const wall = lit.byMaterial.get("smakwall").material;
  const pictureOf = (info) => { const view = lit.json.bufferViews[lit.json.images[lit.json.textures[info.index].source].bufferView]; return unpng(lit.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)); }; // prettier-ignore
  const orm = pictureOf(wall.pbrMetallicRoughness.metallicRoughnessTexture);
  sure(orm.rgba[0] === GREYS.occlusion && orm.rgba[1] === GREYS.roughness && orm.rgba[2] === GREYS.metalness, `R G B ${orm.rgba.slice(0, 3)}`); // prettier-ignore
  sure(wall.occlusionTexture.index === wall.pbrMetallicRoughness.metallicRoughnessTexture.index && wall.pbrMetallicRoughness.metallicFactor === 1 && wall.pbrMetallicRoughness.roughnessFactor === 1, JSON.stringify(wall)); // prettier-ignore
  sure(Buffer.compare(Buffer.from(pictureOf(wall.normalTexture).rgba), Buffer.from(domes().rgba)) === 0, "the normal is the set's, as it is");
  // a texture with no set: lit, roughness 1 (GoldSrc draws no highlight), no normal
  const floor = lit.byMaterial.get("smakfloor").material;
  sure(!floor.normalTexture && floor.pbrMetallicRoughness.roughnessFactor === 1 && floor.pbrMetallicRoughness.metallicFactor === 0, JSON.stringify(floor)); // prettier-ignore
  const walls = lit.triangles.filter((each) => each.material?.name === "smakwall");
  sure(walls.length > 10 && walls.every((each) => each.tangents) && lit.triangles.every((each) => each.material?.name === "smakwall" || !each.tangents), "TANGENT on smakwall's triangles alone"); // prettier-ignore
  for (const { corners: [p0, p1, p2], uvs: [a, b, c], tangents } of walls) {
    // the triangle's own derivatives of its position by u and by v (glTF's axes), from its corners and uvs alone
    const [e1, e2] = [sub(p1, p0), sub(p2, p0)];
    const [du1, dv1, du2, dv2] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
    const r = 1 / (du1 * dv2 - du2 * dv1);
    const byU = e1.map((v, k) => (v * dv2 - e2[k] * dv1) * r);
    const byV = e2.map((v, k) => (v * du1 - e1[k] * du2) * r);
    const n = crossOf(e1, e2);
    const [tx, ty, tz, w] = tangents[0];
    sure(dot([tx, ty, tz], byU) / Math.hypot(...byU) > 0.999, `a tangent ${tangents[0]} is not along u ${byU}`);
    sure(dot(crossOf(n, [tx, ty, tz]).map((v) => v * w), byV) < 0, `w ${w}: normal x tangent runs down the picture`);
  }
});

test("the lit way's lamps: the game's brightness (1.55, x 2.62 in linear) on hlrad's; a texture light emissive, its faces lamps by hlrad's arithmetic", () => {
  const lights = (read) => read.json.extensions.KHR_lights_punctual.lights;
  for (const [n, light] of lights(back).entries()) sure(Math.abs(lights(lit)[n].intensity - light.intensity * 1.55 ** 2.2) < 1e-9 * light.intensity, `${light.intensity} baked, ${lights(lit)[n].intensity} lit`); // prettier-ignore
  const floor = lit.byMaterial.get("smakfloor");
  sure(floor.material.emissiveFactor.join() === [1, 128 / 255, 0].join() && floor.material.emissiveTexture.index === floor.material.pbrMetallicRoughness.baseColorTexture.index, JSON.stringify(floor.material)); // prettier-ignore
  // hlrad (sdHLRAD lightmap.cpp): a face's light x its area x the texture's reflectivity (mean (c / 255)^1.76 x 0.7) / pi,
  // over d², scaled by 2 where 256 is white; here the red of every lamp of smakfloor's cells, in candela
  const glows = lights(lit).filter((light) => light.name === "texture light smakfloor");
  const { rgba } = floor.picture;
  let reflect = 0;
  for (let at = 0; at < rgba.length; at += 4) reflect += (rgba[at] / 255) ** 1.76;
  reflect = (reflect / (rgba.length / 4)) * 0.7;
  const area = bspAreas(tworoomsBytes).get("smakfloor") * UNITS ** 2;
  const want = (((500 * area * reflect) / Math.PI) * 2 * 1.55 ** 2.2) / 256 / UNITS ** 2;
  const got = glows.reduce((sum, light) => sum + light.intensity * light.color[0], 0);
  sure(glows.length >= 1 && Math.abs(got - want) < 1e-6 * want, `${glows.length} lamps, ${got} cd of red against ${want}`);
  // a floor faces up: each is a spot whose -z (the way it shines) is glTF's +y, a hemisphere
  const nodes = lit.json.nodes.filter((node) => glows.includes(lights(lit)[node.extensions?.KHR_lights_punctual?.light]));
  sure(nodes.length === glows.length && nodes.every((node) => node.matrix[9] < -0.999) && glows.every((light) => light.type === "spot" && light.spot.outerConeAngle === Math.PI / 2), "spots shining up"); // prettier-ignore
  sure(lit.json.nodes[0].extras.ambient.length === 3 && litMade.facts.ambient.every((c) => c > 0 && c < 1), JSON.stringify(lit.json.nodes[0].extras)); // prettier-ignore
});

test("the lit way: a set of another texture is left out and said, as is a set of a part; props lit by the lamps, one mesh for every place", () => {
  const other = mapGlb(tworoomsBytes, { light: "lit", sets: [writeLitSet(join(tmp, "pack-gltf", "lit-wrong"), { wrong: true })] });
  sure(other.facts.sets === 0 && other.facts.notes.some((note) => /^smakwall: the set in .* is not of this texture \(its smakwall\.png differs by [\d.]+\): left out$/.test(note)), other.facts.notes.join(" | ")); // prettier-ignore
  sure(!readBack(other.glb).byMaterial.get("smakwall").material.normalTexture, "no normal map");
  const part = mapGlb(tworoomsBytes, { light: "lit", sets: [writeLitSet(join(tmp, "pack-gltf", "lit-part"), { part: [0, 0, 0.5, 0.5] })] });
  sure(part.facts.sets === 0 && part.facts.notes.some((note) => /^smakwall: its set is the whole source, the texture a part of it/.test(note)), part.facts.notes.join(" | ")); // prettier-ignore
  const game = join(tmp, "pack-gltf", "game");
  let entities = maps.readBsp(tworoomsBytes).entities;
  for (const [at, angles] of [[[96, 96, 0], "0 90 0"], [[8, 180, 0], "0 0 0"]]) entities = maps.addEntity(entities, "env_model", at, { model: "models/wedge.mdl", angles }); // prettier-ignore
  const placed = mapGlb(maps.withEntities(tworoomsBytes, entities), { folders: [game], light: "lit" });
  const read = readBack(placed.glb);
  const props = read.triangles.filter((each) => each.material?.name?.includes("wedge"));
  sure(placed.facts.props === 2 && placed.facts.shared === 1 && props.length === 8 && props.every((each) => !each.colours && !each.material.extensions), `${placed.facts.props} props, ${placed.facts.shared} meshes`); // prettier-ignore
});
