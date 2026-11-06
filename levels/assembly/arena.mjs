// A mission arena for a role-play site (levels/rp/CONTRACT.md, "What the map holds for a mission"): one sealed place
// far from the city, where a party is put to play a job and from which it is put back in the city. Written from the
// site's `arenas`:
//
//   { "id": "workshop", "at": [-3072, 0, 0], "size": [768, 768, 256], "back": [[640, 576, 90], ...], "look": "lab", "plan": "room" }
//
//   at, size   the arena's inside, its least corner and its size, in units: out in the void beside the city (nothing
//              joins it to the city but the plugin's teleport), inside +-4096, the most a plugin's message carries
//   back       where the party is put in the city when the job ends: floor points [x, y, yaw], on public floor
//   look       "lab", "yard", "dark" or "cistern": the textures, names from halflife.wad; the default is the plan's own
//   plan       "room" (the default), "yard", "vault" or "tunnel" (PLANS: each wants a least size)
//   spawns     how many starts to make, 1 to 4 (4 by default: the most a party has; each is an entity, and the engine
//              holds about 1200)
//
// Plan "room": a box room (carved from 16 of rock, its walls and floor and roof sealed), four starts for the party
// (info_target `spawn1..4`), a goal pad (trigger_multiple `goal`, NE corner), a button (func_button `button`, east
// wall), a crate (func_breakable `crate`), the reset (multi_manager `reset`, which rings a bell: a run's start is
// heard), four lights; and an info_target for each of `back` in the city. Every name `<site>_arena_<id>_<what>`.
// Every plan has the spawns, back, goal, button and reset of that; and
//   yard    a loading yard: solid stacks of crates for cover, breakables `crate1..3` in the open, a dock 64 up four steps
//           of 16 (a stair of 160 across) with the pad on it, the button on the east wall
//   vault   two rooms and a partition between, a doorway shut by a func_door `vaultdoor` that slides into the wall; the
//           button `button` (outer room) and `button_in` (inner room) fire it; the pad and the strongbox `crate` in the
//           inner room. The door goes back by itself after 20 s (a door cannot be told to shut, only to toggle), so
//           the reset does not fire it
//   tunnel  a snake of corridors 128 wide with a turn at each end, the button halfway (the middle lane), the pad in a
//           chamber at the far end (room to survive in); no crate
//
//   arenasOf(site, name)   -> { brushes, entities, arenas: [contract entry], report: { failures, notes } }
import { carve, box, light, pointEntity, brushEntity, stairs } from "../../src/maps/source.mjs";

const LOOKS = {
  lab: { floor: "C1A0_LABFLR", wall: "C1A0_LABW4", ceiling: "C1A0_C1" },
  yard: { floor: "OUT_GRND1", wall: "C2A4_W1A", ceiling: "C1A0_C1" },
  dark: { floor: "DRKMTLT_FLR01", wall: "DRKMTLT_WALL07", ceiling: "DRKMTLT_CEIL01" },
  cistern: { floor: "OUT_GRVL2", wall: "C1A1_W1", ceiling: "C1A1_C1" },
};
/** A plan: the look it wears when the arena names none, and the least size its layout fits in. */
const PLANS = {
  room: { look: "lab", min: [512, 512, 192] },
  yard: { look: "yard", min: [1024, 768, 192] },
  vault: { look: "dark", min: [896, 512, 192] },
  tunnel: { look: "cistern", min: [1024, 640, 192] },
};
/** A plugin's message carries a coordinate inside +-4096. */
const LIMIT = 4096;
const WALL = 16;
const PAD_TEXTURE = { top: "C1A0_LABGLU", sides: "C1A0_LABGLU", bottom: "C1A0_LABGLU" };
const DOCK = 64;

/** The solid stacks and lights of the yard's plan, and what it adds to the room's list (all relative to x0, y0, z0). */
function yardPlan({ x0, y0, z0, W, D, H, named, look }) {
  const at = (x, y, z = 0) => [x0 + x, y0 + y, z0 + z];
  const stack = (x, y, w, d, h, texture) => box(at(x, y), at(x + w, y + d, h), texture);
  const dock = box(at(W - 320, D - 352), at(W, D, DOCK), "C2A4_FLR1");
  const flight = stairs(at(W - 448, D - 272), at(W - 320, D - 112, DOCK), "+x", "C2A4_FLR1", { steps: 4, rise: 16 });
  const cover = [stack(200, 64, 96, 96, 96, "CRATE03"), stack(232, 520, 128, 96, 64, "CRATE04"), stack(440, 224, 96, 96, 128, "CRATE05"), stack(376, 400, 32, 160, 64, "CRATE06")]; // prettier-ignore
  const crate = (n, x, y) => brushEntity("func_breakable", box(at(x, y), at(x + 64, y + 64, 64), "CRATE01"), { targetname: named(`crate${n}`), material: 1, health: 30 });
  const pad = [at(W - 160, D - 192, DOCK), at(W - 32, D - 32, DOCK + 96)];
  return {
    brushes: [dock, ...flight, ...cover],
    pad: { min: pad[0], max: pad[1], slab: z0 + DOCK + 2 },
    entities: [crate(1, 320, 160), crate(2, W - 192, 64), crate(3, 320, 640)],
    lights: [[W / 4, D / 4], [W / 4, (3 * D) / 4], [(3 * W) / 4, D / 4], [(3 * W) / 4, (3 * D) / 4]].map(([x, y]) => light(at(x, y, H - 16), { brightness: 300 })), // prettier-ignore
    button: [at(W - 8, 144, 48), at(W, 176, 80)],
  };
}

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
    const planName = a.plan ?? "room";
    const plan = PLANS[planName];
    if (!plan) {
      failures.push(`${label}: its plan is ${JSON.stringify(a.plan)}; it wants ${Object.keys(PLANS).join(", ")}`);
      continue;
    }
    if (W < 512 || D < 512 || H < 192) failures.push(`${label}: ${W} x ${D} x ${H} is too small a room for four players and its targets; it wants 512 x 512 x 192 at least`);
    else if (W < plan.min[0] || D < plan.min[1] || H < plan.min[2]) failures.push(`${label}: ${W} x ${D} x ${H} is too small for the plan ${planName}; its layout wants ${plan.min.join(" x ")} at least`);
    for (const [v, lo, hi] of [[x0 - WALL, 0, 0], [y0 - WALL, 0, 0], [x0 + W + WALL, 0, 0], [y0 + D + WALL, 0, 0]])
      if (Math.abs(v) > LIMIT) failures.push(`${label}: it reaches ${v}, past +-${LIMIT} (the most a plugin's message carries)`);
    const look = LOOKS[a.look ?? plan.look];
    if (!look) {
      failures.push(`${label}: its look is ${JSON.stringify(a.look)}; it wants ${Object.keys(LOOKS).join(" or ")}`);
      continue;
    }
    if (W < plan.min[0] || D < plan.min[1] || H < plan.min[2]) continue; // (its layout would not fit: the sentence is given)
    const at = (x, y, z = 0) => [x0 + x, y0 + y, z0 + z];
    const mid = y0 + D / 2;
    // each plan gives: rooms (carved), brushes (more solids), pad {min, max, slab}, spawns, lights, entities (its own
    // targets: the goal, button and crate, in the order of the room's)
    let rooms = [{ min: [x0, y0, z0], max: [x0 + W, y0 + D, z0 + H] }];
    let spawns = [-96, -32, 32, 96].map((dy) => [x0 + 96, mid + dy, z0, 0]);
    let pad = { min: [x0 + W - 160, y0 + D - 192, z0], max: [x0 + W - 32, y0 + D - 32, z0 + 96], slab: z0 + 2 };
    let more = [];
    let lights = [
      light([x0 + W / 3, y0 + D / 4, z0 + H - 16], { brightness: 300 }),
      light([x0 + W / 3, y0 + (3 * D) / 4, z0 + H - 16], { brightness: 300 }),
      light([x0 + (2 * W) / 3, y0 + D / 4, z0 + H - 16], { brightness: 300 }),
      light([x0 + (2 * W) / 3, y0 + (3 * D) / 4, z0 + H - 16], { color: [255, 230, 160], brightness: 320 }),
    ];
    let button = [[x0 + W - 8, y0 + 144, z0 + 48], [x0 + W, y0 + 176, z0 + 80]]; // prettier-ignore
    let buttonKeys = { angles: [0, 0, 0] };
    let own = [];
    let manager = [x0 + W / 2, mid, z0 + H - 56]; // (a plan whose middle is rock puts it in a room)
    let crates = [brushEntity("func_breakable", box([x0 + W / 2 - 32, y0 + 96, z0], [x0 + W / 2 + 32, y0 + 160, z0 + 64], "CRATE01"), { targetname: named("crate"), material: 1, health: 30 })]; // prettier-ignore
    if (planName === "yard") {
      const y = yardPlan({ x0, y0, z0, W, D, H, named, look });
      more = y.brushes;
      pad = y.pad;
      crates = y.entities;
      lights = y.lights;
      button = y.button;
    } else if (planName === "vault") {
      // the partition in the middle (32 thick), a doorway 128 wide and 128 tall in it, shut by the door; the outer room
      // west of it (the party starts there), the inner east
      const px = x0 + Math.round(W / 2 / 16) * 16;
      const dy = [mid - 64, mid + 64];
      rooms = [
        { min: [x0, y0, z0], max: [px - 16, y0 + D, z0 + H] },
        { min: [px + 16, y0, z0], max: [x0 + W, y0 + D, z0 + H] },
        { min: [px - 16, dy[0], z0], max: [px + 16, dy[1], z0 + 128] },
      ];
      spawns = [-96, -32, 32, 96].map((d) => [x0 + 96, mid + d, z0, 0]);
      more = [
        box([x0 + 200, y0 + 64, z0], [x0 + 296, y0 + 160, z0 + 96], "CRATE03"),
        box([x0 + 200, y0 + D - 160, z0], [x0 + 296, y0 + D - 64, z0 + 64], "CRATE04"),
      ];
      pad = { min: [x0 + W - 160, y0 + D - 192, z0], max: [x0 + W - 32, y0 + D - 32, z0 + 96], slab: z0 + 2 };
      crates = [brushEntity("func_breakable", box([x0 + W - 128, y0 + 96, z0], [x0 + W - 64, y0 + 160, z0 + 64], "CRATE01"), { targetname: named("crate"), material: 1, health: 30 })]; // prettier-ignore
      lights = [[(px - x0) / 2, D / 4], [(px - x0) / 2, (3 * D) / 4], [px - x0 + (x0 + W - px) / 2, D / 4], [px - x0 + (x0 + W - px) / 2, (3 * D) / 4]].map(([x, y]) => light([x0 + x, y0 + y, z0 + H - 16], { brightness: 300 })); // prettier-ignore
      button = [[px - 24, mid + 96, z0 + 48], [px - 16, mid + 128, z0 + 80]];
      buttonKeys = { angles: [0, 0, 0] };
      manager = [x0 + W / 4, mid, z0 + H - 56];
      own = [
        brushEntity("func_door", box([px - 16, dy[0], z0], [px + 16, dy[1], z0 + 128], "C2A3_DOOR"), { targetname: named("vaultdoor"), angles: [0, 90, 0], speed: 100, lip: 4, wait: 20, dmg: 0, spawnflags: 0 }), // prettier-ignore
        brushEntity("func_button", box([px + 16, mid + 96, z0 + 48], [px + 24, mid + 128, z0 + 80], "+0BUTTON1"), { targetname: named("button_in"), target: named("vaultdoor"), angles: [0, 180, 0], speed: 50, lip: 4, wait: 1, sounds: 0 }), // prettier-ignore
      ];
    } else if (planName === "tunnel") {
      // a snake: lanes 128 across along x, 256 apart, joined at their ends by links (east end after an even lane, west
      // after an odd), a chamber 192 x 176 at the far end of the last lane
      const lanes = Math.floor((D - 128) / 256) + 1;
      const lane = (k) => y0 + 256 * k;
      rooms = [];
      for (let k = 0; k < lanes; k++) {
        rooms.push({ min: [x0, lane(k), z0], max: [x0 + W, lane(k) + 128, z0 + H] });
        if (k + 1 < lanes) {
          const east = k % 2 === 0;
          rooms.push({ min: [east ? x0 + W - 128 : x0, lane(k), z0], max: [east ? x0 + W : x0 + 128, lane(k + 1) + 128, z0 + H] });
        }
      }
      const last = lanes - 1;
      const farEast = last % 2 === 0;
      rooms.push({ min: [farEast ? x0 + W - 192 : x0, lane(last) - 48, z0], max: [farEast ? x0 + W : x0 + 192, lane(last) + 128, z0 + H] });
      const padX = farEast ? x0 + W - 128 : x0 + 32;
      pad = { min: [padX, lane(last) + 16, z0], max: [padX + 96, lane(last) + 112, z0 + 96], slab: z0 + 2 };
      spawns = [[64, 40], [64, 88], [128, 40], [128, 88]].map(([dx, dy]) => [x0 + dx, y0 + dy, z0, 0]);
      const m = Math.floor(lanes / 2);
      button = [[x0 + W / 2 - 16, lane(m) + 120, z0 + 48], [x0 + W / 2 + 16, lane(m) + 128, z0 + 80]];
      buttonKeys = { angles: [0, 90, 0] };
      crates = [];
      manager = [x0 + W / 2, lane(0) + 64, z0 + H - 56];
      lights = [];
      for (let k = 0; k < lanes; k++) for (let x = 320; x < W; x += 640) lights.push(light([x0 + x, lane(k) + 64, z0 + H - 16], { brightness: 340 })); // (few lights: the engine holds about 1200 entities)
      lights.push(light([farEast ? x0 + W - 96 : x0 + 96, lane(last) + 64, z0 + H - 16], { color: [255, 230, 160], brightness: 320 }));
    }
    brushes.push(...carve(rooms, WALL, look), ...more);
    brushes.push(box(pad.min, [pad.max[0], pad.max[1], pad.slab], PAD_TEXTURE));
    if (a.spawns !== undefined && !(Number.isInteger(a.spawns) && a.spawns >= 1 && a.spawns <= spawns.length)) {
      failures.push(`${label}: spawns is how many starts to make, a whole number from 1 to ${spawns.length}, not ${JSON.stringify(a.spawns)}`);
    } else if (a.spawns !== undefined) spawns = spawns.slice(0, a.spawns);
    const back = (a.back ?? []).map(([x, y, yaw = 0]) => [x, y, 0, yaw]);
    if (!back.length) failures.push(`${label}: it has no \`back\`, no place in the city to put the party when the job ends`);
    // an info_target where each point is, at a standing player's middle (a picture or a check finds it)
    const marker = (what, [x, y, z, yaw]) => pointEntity("info_target", [x, y, z + 36], { targetname: named(what), angles: [0, yaw, 0] });
    const buttonEntity = brushEntity("func_button", box(button[0], button[1], "+0BUTTON1"), {
      targetname: named("button"),
      ...(planName === "vault" ? { target: named("vaultdoor") } : {}),
      ...buttonKeys,
      speed: 50,
      lip: 4,
      wait: 1,
      sounds: 0,
    });
    entities.push(
      ...spawns.map((p, i) => marker(`spawn${i + 1}`, p)),
      ...back.map((p, i) => marker(`back${i + 1}`, p)),
      ...lights,
      brushEntity("trigger_multiple", box(pad.min, pad.max, "AAATRIGGER"), { targetname: named("goal"), spawnflags: 0, wait: 1 }),
      buttonEntity,
      ...own,
      ...crates,
      pointEntity("multi_manager", manager, { targetname: named("reset"), [named("bell")]: 0 }),
      pointEntity("ambient_generic", manager, { targetname: named("bell"), message: "buttons/bell1.wav", health: 10, pitch: 100, pitchstart: 100, spawnflags: 50 }), // prettier-ignore
    );
    arenas.push({ id: a.id, spawns, back, reset: [named("reset")] });
  }
  return { brushes, entities, arenas, report: { failures } };
}
