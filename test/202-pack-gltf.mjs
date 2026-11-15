// The glTF pack (packs/gltf): the kit's two rooms written as a .glb and held against the .bsp by what does not
// come from the writer: the file against the specification's points (packs/gltf/test/validate.mjs), each
// texture's area against the faces' own, the rooms' walls facing in from where a player stands (a mirror or a
// wrong winding turns them out), the grate where the map has it, a view of the file against map-view's, a `{`
// texture masked at the game's cut-off with no mipmaps, a tool's texture and the sky left out, and a model placed
// three times: one mesh for the two in one light, each tinted by the floor's light under it as the game lights a model.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { mapGlb } from "../packs/gltf/gltf.mjs";
import { validateGlb } from "../packs/gltf/test/validate.mjs";
import { drawGlb, difference } from "../packs/gltf/test/draw.mjs";
import { test, sure, HERE, tmp } from "./helper.mjs";

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
