// A map as a 3D scene and the things in it held against the world (check/maps/scene3d.mjs), and the map viewer
// that serves it (cli/viewer/map-serve.mjs): a compiled map's faces with their lightmaps packed, brush source's
// faces textured from its .wad, polygons wound by their faces' own normals, a monster stuck in a wall, a prop
// floating, one on another, one with its nose to a wall; and the page's scene, textures and version.
import { readFileSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { serveMapViewer } from "../cli/viewer/map-serve.mjs";
import { test, testAsync, sure, tmp, HERE } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const folder = join(tmp, "map-viewer");
mkdirSync(folder, { recursive: true });

/** Whether every triangle of a batch that looks up (a floor) is wound so that its normal looks up. */
const floorsLookUp = (world) =>
  world.some((batch) => {
    const p = batch.positions;
    for (let at = 0; at < p.length; at += 9) {
      const u = [p[at + 3] - p[at], p[at + 4] - p[at + 1], p[at + 5] - p[at + 2]];
      const v = [p[at + 6] - p[at], p[at + 7] - p[at + 1], p[at + 8] - p[at + 2]];
      if (u[0] * v[1] - u[1] * v[0] > 0) return true;
    }
    return false;
  });

test("sceneOf3d: a compiled map's faces by texture, its lightmaps in one picture, floors wound to look up", () => {
  const bsp = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
  const scene = maps.sceneOf3d(bsp);
  sure(scene.compiled && scene.world.length > 0, "batches");
  sure(
    scene.world.every(
      (batch) => batch.positions.length % 9 === 0 && batch.uv.length * 3 === batch.positions.length * 2,
    ),
    "whole triangles, a place on the texture each corner",
  );
  if (bsp.lumps.lighting.length) {
    sure(
      scene.lightmap &&
        scene.lightmap.width === 1024 &&
        scene.lightmap.rgba.length === scene.lightmap.width * scene.lightmap.height * 4,
      "the lightmaps' picture",
    );
    const lit = scene.world.find((batch) => batch.luv);
    sure(lit && lit.luv.some((value) => value >= 0 && value <= 1), "places on it");
  }
  sure(floorsLookUp(scene.world), "a floor looks up");
  sure(
    scene.things.some((thing) => /player_start|deathmatch/.test(thing.classname)),
    "its start",
  );
  sure(
    scene.textures.every((entry) => entry.width > 0),
    "its textures",
  );
  const picture = maps.sceneTextureRgba(scene.textures[0]);
  sure(picture.rgba.length === picture.width * picture.height * 4, "a texture as RGBA");
});

test("sceneOf3d on brush source: textured from its .wad, tools apart, a brush entity's faces as an entity's", () => {
  const map = maps.readMap(readFileSync(join(FIXTURES, "tworooms.map"), "utf8"));
  map.worldspawn.wad = join(FIXTURES, "tworooms.wad");
  map.brushes.push(maps.box([0, 0, 0], [16, 16, 16], "CLIP"));
  map.entities.push(
    maps.brushEntity("func_wall", [maps.box([32, 32, 0], [48, 48, 16], map.brushes[0].faces[0].texture)]),
  );
  const scene = maps.sceneOf3d(map);
  sure(!scene.compiled, "source");
  sure(
    scene.world.some((batch) => batch.kind === "tool"),
    "the clip in a batch of its own",
  );
  sure(
    scene.world.some((batch) => batch.kind === "entity"),
    "the func_wall's faces",
  );
  sure(
    scene.textures.some((entry) => entry.pixels),
    "a texture's picture from the .wad",
  );
  sure(floorsLookUp(scene.world), "a floor looks up");
});

test("propsOf: a monster stuck in a wall, a box floating, one on another, a monster's nose to a wall", () => {
  const room = maps.hollow([0, 0, 0], [512, 512, 256], 16, "W");
  const map = {
    worldspawn: {},
    brushes: [...room, maps.box([200, 0, 0], [232, 512, 128], "W")],
    entities: [
      maps.playerStart([100, 100, 0]),
      // half in the wall at x 200
      maps.pointEntity("monster_stuck", [200, 300, 36], {}),
      // its nose (+x) 4 from the wall at x 200, room behind
      maps.pointEntity("monster_facing", [180, 100, 36], { angles: "0 0 0" }),
      maps.pointEntity("crate_floating", [400, 400, 100], {}),
      maps.pointEntity("crate_under", [400, 100, 16], {}),
      maps.pointEntity("crate_on", [400, 100, 48], {}),
    ],
  };
  const bodies = { crate_floating: { half: 16, height: 32, feet: 16 }, crate_under: { half: 16, height: 32, feet: 16 }, crate_on: { half: 16, height: 32, feet: 16 } }; // prettier-ignore
  const { props, warned, noted } = maps.propsOf(map, { bodies, models: false });
  const of = (classname) => props.find((prop) => prop.classname === classname);
  sure(
    of("monster_stuck").warnings.some((w) => /stuck/.test(w)),
    `the monster in the wall: ${JSON.stringify(of("monster_stuck"))}`,
  );
  sure(!of("info_player_start").warnings.length, "the start stands clear");
  sure(
    of("monster_facing").notes.some((w) => /wrong way/.test(w)),
    `its nose to the wall: ${JSON.stringify(of("monster_facing").clear)}`,
  );
  sure(
    of("crate_floating").notes.some((w) => /over the floor/.test(w)),
    "the floating crate told (a body: the game drops it)",
  );
  sure(
    of("crate_on").notes.some((w) => /stands on entity/.test(w)),
    "the crate on the crate stands on it",
  );
  sure(warned.length >= 1 && noted.length >= 2, "warned and noted apart");
});

test("propsOf: a picture with wall behind most of it hangs; one in a doorway, a jamb at its edge, floats", () => {
  const room = maps.hollow([0, 0, 0], [512, 512, 256], 16, "W");
  // a wall across the room at x 300, a doorway in it from y 280 to 344, 160 high
  const wall = [maps.box([300, 0, 0], [316, 280, 256], "W"), maps.box([300, 344, 0], [316, 512, 256], "W"), maps.box([300, 280, 160], [316, 344, 256], "W")];
  const map = {
    worldspawn: {},
    brushes: [...room, ...wall],
    entities: [
      maps.playerStart([100, 100, 0]),
      maps.pointEntity("picture_hung", [324, 150, 120], {}),
      maps.pointEntity("picture_door", [324, 296, 120], {}),
    ],
  };
  // their boxes as their models would give them (a model, not a body: the game does not drop it)
  const figures = new Map([[2, { min: [316, 142, 104], max: [332, 158, 136] }], [3, { min: [316, 288, 104], max: [332, 304, 136] }]]);
  const { props } = maps.propsOf(map, { figures, models: false });
  const of = (classname) => props.find((prop) => prop.classname === classname);
  sure(!of("picture_hung").warnings.length, JSON.stringify(of("picture_hung")));
  sure(of("picture_door").warnings.some((w) => /floats/.test(w)), JSON.stringify(of("picture_door")));
});

await testAsync(
  "the map viewer serves a scene, its textures and a version that changes with the file",
  "the map viewer",
  async () => {
    const file = join(folder, "tworooms.map");
    const map = maps.readMap(readFileSync(join(FIXTURES, "tworooms.map"), "utf8"));
    map.worldspawn.wad = join(FIXTURES, "tworooms.wad");
    writeFileSync(file, maps.writeMap(map));
    const said = [];
    const server = await serveMapViewer({
      load: () => maps.readMap(readFileSync(file, "utf8")),
      files: [file],
      name: "tworooms.map",
      port: 8187,
      say: (line) => said.push(line),
    });
    try {
      const get = (path) => fetch(`http://127.0.0.1:8187${path}`);
      const page = await (await get("/")).text();
      sure(/WebGL|webgl/.test(page), "the page");
      const scene = await (await get("/scene")).json();
      sure(
        scene.world.length && scene.triangles > 0 && scene.floors,
        `the scene: ${JSON.stringify(scene).slice(0, 200)}`,
      );
      const picture = await get("/tex/0.png");
      sure(picture.status === 200 && (await picture.arrayBuffer()).byteLength > 50, "a texture as a PNG");
      const before = (await (await get("/version")).json()).version;
      utimesSync(file, new Date(), new Date(Date.now() + 5000));
      const after = (await (await get("/version")).json()).version;
      sure(before !== after, "a new version when the file changes");
      sure(
        said.some((line) => /triangles/.test(line)),
        "what it read, said",
      );
    } finally {
      server.close();
    }
  },
);
