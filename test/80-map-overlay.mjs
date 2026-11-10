// A map against pictures of it: its edges drawn over a picture from a camera and scored, a camera fitted by them,
// and a wall built off told by them. Ground truth is the kit's own: a carved room drawn by drawSource, and tworooms.bsp in its own .wad.
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { geometryOf, rasterOf, overlayOf, fitCamera } from "../check/maps/overlay.mjs";
import { test, sure, tmp, HERE, runSmak } from "./helper.mjs";

const { maps, png } = smak;
const FIXTURES = join(HERE, "fixtures");
const room = (west = 0) => ({
  worldspawn: {},
  brushes: [maps.carve([{ min: [west, 0, 0], max: [512, 384, 192] }, { min: [512, 160, 0], max: [576, 224, 112] }, { min: [576, 96, 0], max: [800, 288, 160] }], 16, { wall: "BRICK", floor: "FLOOR", ceiling: "CEIL" })],
  entities: [maps.playerStart([256, 192, 36], 0)],
});
const camera = { from: [400, 150, 64], yaw: 165, pitch: -5, fov: 90 };
const shot = maps.drawSource(room(0), { ...camera, width: 640, height: 480, entities: "none", labels: false });
const dist = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));

test("map overlay: a room's edges laid over a picture of it from its camera, and the camera found from a guess by them", () => {
  const geometry = geometryOf(room(0));
  sure(geometry.surfaces.length > 20 && geometry.surfaces.every((s) => s.plane && s.polygon.length >= 3), `${geometry.surfaces.length} faces`);
  const raster = rasterOf(geometry, camera, 160, 120);
  const seen = raster.face.reduce((n, f) => n + (f >= 0 ? 1 : 0), 0);
  sure(seen === 160 * 120, `inside a closed room every pixel shows a face: ${seen}`);
  // a pixel's point lies on its face's plane
  const k = 60 * 160 + 80;
  const s = geometry.surfaces[raster.face[k]];
  const p = raster.point(k);
  sure(Math.abs(s.normal[0] * p[0] + s.normal[1] * p[1] + s.normal[2] * p[2] - s.dist) < 0.5, `the middle pixel's point on its plane: ${p}`);
  const o = overlayOf(room(0), shot, camera, { width: 320, height: 240, offsets: false });
  sure(o.score < 1.5 && o.width === 320, `at the true camera the edges lie on the picture's: ${o.score}`);
  const off = overlayOf(room(0), shot, { ...camera, from: [430, 120, 70], yaw: 177 }, { width: 320, height: 240, offsets: false });
  sure(off.score > o.score + 1, `a camera 40 off scores worse: ${off.score} against ${o.score}`);
  const fitted = fitCamera(room(0), shot, { from: [430, 120, 70], yaw: 177 });
  sure(dist(fitted.camera.from, camera.from) < 40 && Math.abs(fitted.camera.yaw - camera.yaw) < 8, `found within 40 units and 8 degrees: ${JSON.stringify(fitted.camera)}`);
  sure(fitted.score < off.score, `and scores better than the guess: ${fitted.score}`);
});

test("map overlay: green on the picture's lines, red off a line that is there, amber where no line is near", () => {
  const count = (o) => {
    const n = { green: 0, red: 0, amber: 0 };
    for (let k = 0; k < o.rgba.length; k += 4) {
      const [r, g, b] = [o.rgba[k], o.rgba[k + 1], o.rgba[k + 2]];
      if (r === 60 && g === 255 && b === 60) n.green++;
      else if (r === 255 && g === 50 && b === 40) n.red++;
      else if (r === 235 && g === 180 && b === 40) n.amber++;
    }
    return n;
  };
  const right = count(overlayOf(room(0), shot, camera, { width: 320, height: 240, offsets: false }));
  sure(right.green > 4 * right.red && right.green > right.amber, `at the true camera mostly green: ${JSON.stringify(right)}`);
  const far = count(overlayOf(room(0), shot, { ...camera, from: [250, 300, 64], yaw: 120 }, { width: 320, height: 240, offsets: false }));
  sure(far.red + far.amber > far.green && far.amber > 0, `far off, red and amber: ${JSON.stringify(far)}`);
});

test("map overlay: a wall built 32 units off is told by the edges, the most off of the faces, and by about how much", () => {
  const o = overlayOf(room(32), shot, camera, { width: 320, height: 240 });
  const first = o.faces[0];
  sure(first && first.axis === "+x" && first.move <= -24 && first.move >= -44, `the west wall (+x), about -32: ${JSON.stringify(o.faces.slice(0, 3))}`);
  // the room as it is says no face is that far off
  const right = overlayOf(room(0), shot, camera, { width: 320, height: 240 });
  sure(!right.faces.some((f) => f.axis === "+x" && Math.abs(f.move) >= 24), JSON.stringify(right.faces.slice(0, 3)));
});

test("map overlay: a compiled map's faces, and its edges over a view of it in its own textures", () => {
  const bsp = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
  const textures = maps.readWad(readFileSync(join(FIXTURES, "tworooms.wad"))).textures;
  const geometry = geometryOf(bsp);
  sure(geometry.surfaces.length > 10, `${geometry.surfaces.length} faces`);
  const at = maps.viewFrom(bsp, "info_player_start");
  const cam = { from: at.from, yaw: at.yaw, pitch: 0, fov: 90 };
  const view = maps.drawMap(bsp, { ...cam, width: 320, height: 240, textures, entities: "none", labels: false });
  // a textured view has lines of its own beside the room's, so the edges tell the true camera from others only
  // narrowly here (a step of 45 units costs a third of a pixel): photo.mjs leads with features on such a view
  const o = overlayOf(bsp, view, cam, { offsets: false });
  const turned = overlayOf(bsp, view, { ...cam, yaw: cam.yaw + 10 }, { offsets: false });
  const stepped = overlayOf(bsp, view, { ...cam, from: [cam.from[0] + 32, cam.from[1] - 32, cam.from[2]] }, { offsets: false });
  sure(o.score < turned.score && o.score < stepped.score, `the edges of tworooms on its own view: ${o.score}, against ${turned.score} turned 10 degrees and ${stepped.score} stepped 45 units`);
});

test("map-overlay: the command draws the edges over the picture and says how far apart", () => {
  const folder = join(tmp, "map-overlay");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "room.map"), maps.writeMap(room(0)));
  writeFileSync(join(folder, "shot.png"), png(shot.width, shot.height, shot.rgba));
  const said = runSmak("map-overlay", join(folder, "room.map"), join(folder, "shot.png"), "--from", "400,150,64", "--yaw", "165", "--pitch", "-5", "-o", join(folder, "over.png"));
  sure(/^edges: [\d.]+ pixels apart/m.test(said) && /over\.png {2}640x480 {2}the map's edges over the picture/.test(said), said);
});

test("map-overlay --locate: the camera found by the edges from a guess, near the one the picture was drawn from", () => {
  const folder = join(tmp, "map-overlay");
  const said = runSmak("map-overlay", join(folder, "room.map"), join(folder, "shot.png"), "--from", "380,170,64", "--yaw", "160", "--locate");
  const found = /^camera (\S+) (\S+) (\S+) yaw (\S+) pitch (\S+) fov \S+: found by the edges/m.exec(said);
  sure(found && dist(found.slice(1, 4).map(Number), camera.from) < 24 && Math.abs(Number(found[4]) - camera.yaw) < 4, said);
});
