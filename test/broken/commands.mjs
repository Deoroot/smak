// The command lines that say PASS or FAIL by their exit code, run on a file broken in one way: `smak check` on a
// model of 129 bones, `smak map-check` on a plan with no place to start, `smak map-reach` on a house whose study
// has no door, `smak contract --against` on a model that lacks one of its reference's animations. Each
// must exit 1 and name the fault; its twin must exit 0. What the library says is held word for word in the other files; here, that the command passes it on and fails by it.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../../src/index.mjs";
import * as maps from "../../check/maps/index.mjs";
import { tmp, runRefused, SMAK_CLI, HERE } from "../helper.mjs";
import { broken } from "./case.mjs";

const folder = join(tmp, "broken-commands");
mkdirSync(folder, { recursive: true });

/** A command run on a file written here: an exit code that is not 0 and what it printed, or nothing. */
const failed = (name, bytes, ...args) => {
  const file = join(folder, name);
  writeFileSync(file, bytes);
  const run = runRefused(SMAK_CLI, args[0], file, ...args.slice(1));
  return run.code === 0 ? [] : [`exit ${run.code}: ${run.out}${run.err}`];
};

const chain = (count) => Array.from({ length: count }, (_, i) => ({ name: `b${i}`, parent: i - 1, pos: [1, 0, 0] }));
const triangle = [{ p: [0, 0, 0], uv: [0, 0] }, { p: [1, 0, 0], uv: [1, 0] }, { p: [0, 1, 1], uv: [0, 1] }];
const model = (bones) =>
  smak.buildMdl({
    name: "chain.mdl",
    bones,
    bodyparts: [{ name: "body", models: [{ name: "m", meshes: [{ tris: [triangle.map((c) => ({ ...c, bone: "b0" }))], texture: { name: "a.bmp", width: 8, height: 8, pixels: new Uint8Array(64), palette: new Uint8Array(768).fill(128), flags: 0 } }] }] }], // prettier-ignore
    sequences: [{ name: "idle", fps: 10, frames: [bones.map((b) => [...b.pos, 0, 0, 0])] }],
  });

broken("smak check", "a model of 129 bones", {
  said: /^exit 1: [\s\S]*129 bones: the engine holds 128/,
  broken: () => failed("bones129.mdl", model(chain(129)), "check"),
  whole: () => failed("bones128.mdl", model(chain(128)), "check"),
});

const TEXTURES = { floor: "SMAKFLOOR", ceiling: "SMAKCEIL", wall: "SMAKWALL" };
const room = (entities) => maps.writeMap({ worldspawn: { wad: "smak.wad" }, brushes: maps.hollow([0, 0, 0], [256, 256, 128], 16, TEXTURES), entities }); // prettier-ignore
broken("smak map-check", "a plan with no place to start", {
  said: /^exit 1: [\s\S]*no info_player_start/,
  broken: () => failed("nostart.map", room([maps.light([128, 128, 96])]), "map-check"),
  whole: () => failed("room.map", room([maps.playerStart([64, 64, 0], 0), maps.light([128, 128, 96])]), "map-check"),
});

const house = (door) =>
  maps.writeMap({
    worldspawn: {},
    brushes: maps.carve([{ min: [0, 0, 0], max: [320, 256, 160] }, { min: [352, 0, 16], max: [608, 256, 144] }, ...(door ? [{ min: [320, 96, 16], max: [352, 160, 112] }] : [])], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }), // prettier-ignore
    entities: [maps.playerStart([96, 128, 0], 0), maps.pointEntity("monster_zombie", [480, 128, 16]), maps.light([160, 128, 140])],
  });
broken("smak map-reach", "a monster in a room with no door", {
  said: /^exit 1: [\s\S]*monster_zombie at 480 128 16: no opening leads to it/,
  broken: () => failed("nodoor.map", house(false), "map-reach"),
  whole: () => failed("door.map", house(true), "map-reach"),
});

// the reference's three animations; a model made for it with one of them left out
const animated = (names) =>
  smak.buildMdl({
    name: "walker.mdl",
    bones: chain(2),
    bodyparts: [{ name: "body", models: [{ name: "m", meshes: [] }] }],
    sequences: names.map((name) => ({ name, fps: 10, frames: [chain(2).map((b) => [...b.pos, 0, 0, 0])] })),
  });
writeFileSync(join(folder, "reference.mdl"), animated(["idle", "walk", "attack"]));
broken("smak contract", "a model made for a reference with one of its animations left out", {
  said: /^exit 1: [\s\S]*1 of the reference's 3 animations are missing: attack/,
  broken: () => failed("lacks.mdl", animated(["idle", "walk"]), "contract", "--against", join(folder, "reference.mdl")),
  whole: () => failed("keeps.mdl", animated(["idle", "walk", "attack"]), "contract", "--against", join(folder, "reference.mdl")), // prettier-ignore
});

// ── smak check-pvs: the faces drawn from where players stand ──
const fixture = (name) => readFileSync(join(HERE, "fixtures", name));
broken("smak check-pvs", "a map compiled without vis", {
  said: /^exit 1: .*FAIL: the map was compiled without vis/s,
  broken: () => failed("novis.bsp", fixture("tworooms-novis.bsp"), "check-pvs"),
  whole: () => failed("whole.bsp", fixture("tworooms.bsp"), "check-pvs"),
});
