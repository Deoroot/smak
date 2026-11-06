// A mission arena for a role-play site (levels/rp/CONTRACT.md, "What the map holds for a mission"): one sealed room
// far from the city, where a party is put to play a job and from which it is put back in the city. Written from the
// site's `arenas`:
//
//   { "id": "workshop", "at": [-3072, 0, 0], "size": [768, 768, 256], "back": [[640, 576, 90], ...], "look": "lab" }
//
//   at, size   the room's inside, its least corner and its size, in units: out in the void beside the city (nothing
//              joins it to the city but the plugin's teleport), inside +-4096, the most a plugin's message carries
//   back       where the party is put in the city when the job ends: floor points [x, y, yaw], on public floor
//   look       "lab" (the default) or "yard": the textures, names from halflife.wad
//
// The room (carved from 16 of rock, its walls and floor and roof sealed), four starts for the party (info_target
// `spawn1..4`), a goal pad (trigger_multiple `goal`, NE corner), a button (func_button `button`, east wall), a crate
// (func_breakable `crate`), the reset (multi_manager `reset`, which rings a bell: a run's start is heard), four lights;
// and an info_target for each of `back` in the city. Every name `<site>_arena_<id>_<what>`.
//
//   arenasOf(site, name)   -> { brushes, entities, arenas: [contract entry], report: { failures, notes } }
import { carve, box, light, pointEntity, brushEntity } from "../../src/maps/source.mjs";

const LOOKS = {
  lab: { floor: "C1A0_LABFLR", wall: "C1A0_LABW4", ceiling: "C1A0_C1" },
  yard: { floor: "OUT_GRND1", wall: "C2A4_W1A", ceiling: "C1A0_C1" },
};
/** A plugin's message carries a coordinate inside +-4096. */
const LIMIT = 4096;
const WALL = 16;

export function arenasOf(site, name) {
  const failures = [];
  const brushes = [];
  const entities = [];
  const arenas = [];
  for (const a of site.arenas ?? []) {
    const label = `arena ${a.id}`;
    const named = (what) => `${name}_arena_${a.id}_${what}`;
    const ok = Array.isArray(a.at) && a.at.length === 3 && Array.isArray(a.size) && a.size.length === 3 && [...a.at, ...a.size].every(Number.isFinite);
    if (!a.id || !ok) {
      failures.push(`${label}: it wants an id, at [x, y, z] and size [w, d, h]`);
      continue;
    }
    const [x0, y0, z0] = a.at;
    const [W, D, H] = a.size;
    if (W < 512 || D < 512 || H < 192) failures.push(`${label}: ${W} x ${D} x ${H} is too small a room for four players and its targets; it wants 512 x 512 x 192 at least`);
    for (const [v, lo, hi] of [[x0 - WALL, 0, 0], [y0 - WALL, 0, 0], [x0 + W + WALL, 0, 0], [y0 + D + WALL, 0, 0]])
      if (Math.abs(v) > LIMIT) failures.push(`${label}: it reaches ${v}, past +-${LIMIT} (the most a plugin's message carries)`);
    const look = LOOKS[a.look ?? "lab"];
    if (!look) {
      failures.push(`${label}: its look is ${JSON.stringify(a.look)}; it wants ${Object.keys(LOOKS).join(" or ")}`);
      continue;
    }
    const room = { min: [x0, y0, z0], max: [x0 + W, y0 + D, z0 + H] };
    brushes.push(...carve([room], WALL, look));
    const pad = [[x0 + W - 160, y0 + D - 192, z0], [x0 + W - 32, y0 + D - 32, z0 + 96]];
    brushes.push(box(pad[0], [pad[1][0], pad[1][1], z0 + 2], { top: "C1A0_LABGLU", sides: "C1A0_LABGLU", bottom: "C1A0_LABGLU" }));
    const mid = y0 + D / 2;
    const spawns = [-96, -32, 32, 96].map((dy) => [x0 + 96, mid + dy, z0, 0]);
    const back = (a.back ?? []).map(([x, y, yaw = 0]) => [x, y, 0, yaw]);
    if (!back.length) failures.push(`${label}: it has no \`back\`, no place in the city to put the party when the job ends`);
    // an info_target where each point is, at a standing player's middle (a picture or a check finds it)
    const marker = (what, [x, y, z, yaw]) => pointEntity("info_target", [x, y, z + 36], { targetname: named(what), angles: [0, yaw, 0] });
    entities.push(
      ...spawns.map((p, i) => marker(`spawn${i + 1}`, p)),
      ...back.map((p, i) => marker(`back${i + 1}`, p)),
      light([x0 + W / 3, y0 + D / 4, z0 + H - 16], { brightness: 300 }),
      light([x0 + W / 3, y0 + (3 * D) / 4, z0 + H - 16], { brightness: 300 }),
      light([x0 + (2 * W) / 3, y0 + D / 4, z0 + H - 16], { brightness: 300 }),
      light([x0 + (2 * W) / 3, y0 + (3 * D) / 4, z0 + H - 16], { color: [255, 230, 160], brightness: 320 }),
      brushEntity("trigger_multiple", box(pad[0], pad[1], "AAATRIGGER"), { targetname: named("goal"), spawnflags: 0, wait: 1 }),
      brushEntity("func_button", box([x0 + W - 8, y0 + 144, z0 + 48], [x0 + W, y0 + 176, z0 + 80], "+0BUTTON1"), { targetname: named("button"), angles: [0, 0, 0], speed: 50, lip: 4, wait: 1, sounds: 0 }), // prettier-ignore
      brushEntity("func_breakable", box([x0 + W / 2 - 32, y0 + 96, z0], [x0 + W / 2 + 32, y0 + 160, z0 + 64], "CRATE01"), { targetname: named("crate"), material: 1, health: 30 }), // prettier-ignore
      pointEntity("multi_manager", [x0 + W / 2, mid, z0 + H - 56], { targetname: named("reset"), [named("bell")]: 0 }),
      pointEntity("ambient_generic", [x0 + W / 2, mid, z0 + H - 56], { targetname: named("bell"), message: "buttons/bell1.wav", health: 10, pitch: 100, pitchstart: 100, spawnflags: 50 }), // prettier-ignore
    );
    arenas.push({ id: a.id, spawns, back, reset: [named("reset")] });
  }
  return { brushes, entities, arenas, report: { failures } };
}
