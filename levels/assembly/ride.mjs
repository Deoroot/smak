// levels/assembly: the metro's ride, a fake one as the first level of Half-Life and Cry of Fear do it (reference numbers only: a
// static player car, the scenery a func_train at 450 between two path_corners looping by a teleport, an env_shake). A station's
// parked train (metro.mjs, `trench.train`) never moves. Boarding: a func_button "Partir" in a parked car fires a multi_manager that
//
//   t 0      says the doors close (game_text) and locks the station's doorways (the lock of each, a func_door toggled by name, slides: the car's doors are shut in its model and never move)
//   t 5      opens the DEPARTURE window: a multisource (the manager is its only input, it toggles it on) is the `master` of
//            the trigger_teleports that fill the parked cars' interiors; whoever stands inside is carried to the same place of the
//            ride car; t 5.6 the manager toggles it off again
//   t 5.6    env_shake in the ride car; the ride lasts `time` seconds (16)
//   t 21.6   the ARRIVAL manager: two windows (a second, a few seconds later, for a straggler) of the trigger_teleports that fill
//            the ride car, each carrying its place to the same place of the destination station's parked car
//   t 23.6   the origin station's doorways are unlocked again
//
// and a button in the ride car ("exit") runs the arrival at once (nobody is stranded). Every car interior is cut into slices
// (3 along x 2 across) and each slice has its own destination, so several players go to places of their own and not to one point.
// The ride room: a car shell like the parked ones (metro.mjs trainBrushes, doorways plugged: the model's doors are shut) in a tunnel; the tunnel's lining (floor, walls,
// ceiling, pillars every 256, lamps, rails and sleepers) is one func_train 4096 long that slides 1280 and goes back to its start by a
// path_corner with spawnflags 2 (Teleport: the corner a train goes TO is the one that teleports it, so it is the first), seamless
// because everything on it repeats every 256; a static shell round it holds the room and the lights.
//
//   rides: [{ id: "ab", from: "st-a", to: "st-b", at: [x, y, z], time: 16, reverse: { id: "ba", at: [x, y, z] } }]    (`below.rides`)
//
//   ridesOf(plan, name)   -> { brushes, entities, rides: [{ id, from, to, names }], report: { failures, notes } }
//   checkRides(plan)      -> { failures, warnings, measures }
import { box, carve, pointEntity, brushEntity, light } from "../../src/maps/source.mjs";
import { trainOf, trainBrushes, trainProps, TRAIN, METRO_TEX, along } from "./metro.mjs";

export const RIDE = {
  time: [8, 40], // seconds on the ride car: long enough to be a ride, short enough to wait
  period: 256, // what repeats along the lining
  shift: 1280, // how far the lining slides before the corner sends it back: five periods
  from: -2304, // the lining's ends along x, from the car's first end
  to: 1792,
  speed: 450,
  limit: 4096, // the world's coordinate a plugin and the engine's bounds keep inside
  countdown: 5,
  window: 0.6,
  slices: [3, 2], // along, across
  source: "the person's word, 2026-11-08 (the train as the first level of Half-Life has one); levels/assembly/README.md, 'A metro under the streets'",
};
const TUNNEL = { y: [-56, 176], z: [-40, 128], shell: 16 }; // (the floor 40 under the car's, as a station's trench is: the model's wheels stand on the rails)
const DOORS = (name, hall) => `${name}_${hall.replace(/-/g, "_")}_doors`;
const lowname = (s) => String(s).replace(/[^A-Za-z0-9_]/g, "_");

/** The directions of the rides of a spec: [{ id, from, to, at, time }]. */
export function directionsOf(rides = []) {
  const out = [];
  for (const r of rides) {
    out.push({ id: r.id, from: r.from, to: r.to, at: r.at, time: r.time ?? 16 });
    if (r.reverse) out.push({ id: r.reverse.id, from: r.to, to: r.from, at: r.reverse.at, time: r.reverse.time ?? r.time ?? 16 });
  }
  return out;
}

const hallOf = (plan, id) => plan.below?.deep?.halls.find((h) => h.id === id);

/** The slices of a car's interior: [{ u: [a, b], w: [a, b], centre: [u, w], rel: [u, w] }] (rel: from the car's first end and its first wall). */
function slicesOf(car) {
  const [nu, nw] = RIDE.slices;
  const [u0, u1] = car.inner.u;
  const [w0, w1] = car.inner.w;
  const out = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nw; j++) {
      const u = [u0 + ((u1 - u0) * i) / nu, u0 + ((u1 - u0) * (i + 1)) / nu];
      const w = [w0 + ((w1 - w0) * j) / nw, w0 + ((w1 - w0) * (j + 1)) / nw];
      // (the slice's destination stands in the free width: the benches are along the track-side wall, 20 deep, so the rows are 28 and 72 from the platform-side wall of a car whose platform wall is at w[0], 52 and 96 from w[0] where it is at w[1])
      const centre = [(u[0] + u[1]) / 2, car.w[0] + (car.pw === 0 ? [28, 72] : [52, 96])[j]];
      out.push({ u, w, centre, rel: [centre[0] - car.u[0], centre[1] - car.w[0]], i, j });
    }
  return out;
}
const mirrorW = (rel, from, to) => (from === to ? rel : [rel[0], TRAIN.width - rel[1]]);
const yawOf = (T, pw) => (T.axis === 0 ? (pw === 0 ? 90 : 270) : pw === 0 ? 0 : 180); // the way a rider faces: at the track-side windows

/** One direction: the ride room, and the parked cars' departure zones and the ride car's arrival zones. */
function direction(plan, name, d, failures) {
  const from = hallOf(plan, d.from);
  const to = hallOf(plan, d.to);
  const pre = `${name}_ride_${lowname(d.id)}`;
  const label = `ride ${d.id}`;
  const A = trainOf(from, from?.floor);
  const B = trainOf(to, to?.floor);
  if (!from || !to || !A || !B) {
    failures.push(`${label}: ${!from ? `no station ${d.from}` : !to ? `no station ${d.to}` : `${!A ? d.from : d.to} has no train`}; a ride runs from a station with a parked train to another`);
    return null;
  }
  if (A.cars.length !== B.cars.length) failures.push(`${label}: ${d.from} has ${A.cars.length} cars and ${d.to} ${B.cars.length}; the ride car is the one train of both`);
  if (!Array.isArray(d.at) || d.at.length !== 3 || !d.at.every(Number.isFinite)) {
    failures.push(`${label}: it wants \`at\` [x, y, z], the corner of its car`);
    return null;
  }
  const cars = Math.min(A.cars.length, B.cars.length);
  const [ax, ay, az] = d.at;
  const brushes = [];
  const entities = [];
  const R = (x, y, z) => [ax + x, ay + y, az + z];
  const B3 = (x0, x1, y0, y1, z0, z1, tex) => box(R(x0, y0, z0), R(x1, y1, z1), tex);
  const side = A.side;
  // ── the ride car: the parked car's shell, doorways shut, its first end at x = 0
  const fake = { floor: az, trench: { axis: 0, a: [ax - 72, ax + 4000], v: side === 0 ? [ay - 10, ay + 182] : [ay - 62, ay + 130], train: { side, cars, from: 72 } } };
  const carBrushes = []; // (func_detail: a car's walls and benches seal nothing, and as world brushes they would cut the room into many leaves)
  const collect = { detail: (b) => b && carBrushes.push(b), world: (b) => b && carBrushes.push(b) };
  const carLights = trainBrushes(fake, collect, { F: az, bed: az + TUNNEL.z[0] });
  const ride = trainOf(fake, az);
  entities.push(brushEntity("func_detail", carBrushes));
  entities.push(...trainProps(fake, az, pointEntity)); // the cars are models; the brushes above are their collision (CLIP), the doorways plugged
  // ── the tunnel: a static shell round the room; its lining is the func_train
  const xa = RIDE.from;
  const xb = RIDE.to;
  const [y0, y1] = TUNNEL.y;
  const [z0, z1] = TUNNEL.z;
  const S = TUNNEL.shell;
  const dark = "crete41";
  brushes.push(...carve([{ min: R(xa - S, y0 - S, z0 - S), max: R(xb + S, y1 + S, z1 + S) }], 16, dark));
  const lining = [];
  const wall = "po_concretwall";
  lining.push(B3(xa, xb, y0 - S, y1 + S, z0 - S, z0, { top: "Pavement001", sides: wall, bottom: wall })); // floor
  lining.push(B3(xa, xb, y0 - S, y0, z0, z1, wall)); // wall
  lining.push(B3(xa, xb, y1, y1 + S, z0, z1, wall)); // wall
  lining.push(B3(xa, xb, y0 - S, y1 + S, z1, z1 + S, { top: "bigcrete2", bottom: "bigcrete2", sides: wall })); // ceiling
  const wm = (y0 + y1) / 2;
  for (const dy of [-16, 16]) lining.push(B3(xa, xb, wm + dy - 2, wm + dy + 2, z0, z0 + 6, METRO_TEX.rail)); // rails
  const lampLights = [];
  for (let x = xa + RIDE.period / 2; x < xb; x += RIDE.period) {
    for (const [p0, p1] of [[y0, y0 + 16], [y1 - 16, y1]]) lining.push(B3(x - 12, x + 12, p0, p1, z0, z1, METRO_TEX.pillar)); // pillars
    lining.push(B3(x - 24, x + 24, wm - 6, wm + 6, z1 - 3, z1, METRO_TEX.housing));
    lining.push(B3(x - 20, x + 20, wm - 4, wm + 4, z1 - 4, z1 - 3, { bottom: METRO_TEX.lamp, top: METRO_TEX.housing, sides: METRO_TEX.housing }));
    lampLights.push(R(x, wm, z1 - 14));
    for (let k = 0; k < 4; k++) lining.push(B3(x - RIDE.period / 2 + 64 * k + 29, x - RIDE.period / 2 + 64 * k + 35, wm - 40, wm + 40, z0, z0 + 3, METRO_TEX.wood)); // sleepers (every 64)
  }
  const centre = R((xa + xb) / 2, wm, (z0 - S + z1 + S) / 2);
  const c1 = `${pre}_c1`;
  const c2 = `${pre}_c2`;
  entities.push(
    brushEntity("func_train", lining, { target: c1, speed: RIDE.speed, dmg: 0, spawnflags: 8 }), // (no name: it starts at once; not solid: nothing it carries touches a player)
    pointEntity("path_corner", centre, { targetname: c1, target: c2, spawnflags: 2 }),
    pointEntity("path_corner", [centre[0] + RIDE.shift, centre[1], centre[2]], { targetname: c2, target: c1 }),
    ...lampLights.map((p) => light(p, { color: [205, 205, 225], brightness: 220 })),
    ...carLights.map((p) => light(p, { color: [215, 205, 185], brightness: 130 })),
  );
  // ── the zones and their destinations
  const mid = R(392, 60, 40);
  const t0 = RIDE.countdown;
  const win = RIDE.window;
  const slicesA = A.cars.slice(0, cars).map((c) => ({ car: c, slices: slicesOf(c) }));
  const slicesR = ride.cars.slice(0, cars).map((c) => ({ car: c, slices: slicesOf(c) }));
  const slicesB = B.cars.slice(0, cars).map((c) => ({ car: c, slices: slicesOf(c) }));
  const zone = (T, F, hallCar, s, target, master) => brushEntity("trigger_teleport", box(...(() => {
    const a = along(T, s.u[0], s.w[0]);
    const b = along(T, s.u[1], s.w[1]);
    return [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), F + 2], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), F + 74], "AAATRIGGER"];
  })()), { target, master, spawnflags: 0 });
  const dest = (T, F, pw, centrePoint, targetname) => {
    const p = along(T, centrePoint[0], centrePoint[1]);
    return pointEntity("info_teleport_destination", [p[0], p[1], F + 2], { targetname, angles: [0, yawOf(T, pw), 0] });
  };
  const TA = from.trench;
  const TB = to.trench;
  const TR = fake.trench;
  let n = 0;
  slicesA.forEach(({ car, slices }, ci) =>
    slices.forEach((s) => {
      const target = `${pre}_d${n++}`;
      const rel = s.rel;
      entities.push(zone(TA, from.floor, car, s, target, `${pre}_dep_ms`));
      const rc = slicesR[ci].car;
      entities.push(dest(TR, az, ride.side, [rc.u[0] + rel[0], rc.w[0] + rel[1]], target));
    }),
  );
  n = 0;
  slicesR.forEach(({ car, slices }, ci) =>
    slices.forEach((s) => {
      const target = `${pre}_a${n++}`;
      entities.push(zone(TR, az, car, s, target, `${pre}_arr_ms`));
      const bc = slicesB[ci].car;
      const rel = mirrorW(s.rel, ride.side, B.side);
      entities.push(dest(TB, to.floor, B.side, [bc.u[0] + rel[0], bc.w[0] + rel[1]], target));
    }),
  );
  // ── the buttons: "Partir" on the first end wall inside each parked car; the ride car's exit
  const btn = (T, F, c, name, target, wait) => {
    const wmid = (c.inner.w[0] + c.inner.w[1]) / 2;
    const a = along(T, c.inner.u[0], wmid - 8);
    const b = along(T, c.inner.u[0] + 4, wmid + 8);
    const yaw = T.axis === 0 ? 180 : 270; // it presses into the wall behind it
    return brushEntity("func_button", box([Math.min(a[0], b[0]), Math.min(a[1], b[1]), F + 44], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), F + 60], "+0BUTTON1"), { targetname: name, target, angles: [0, yaw, 0], speed: 50, lip: 2, wait, sounds: 7 });
  };
  A.cars.slice(0, cars).forEach((c, i) => entities.push(btn(TA, from.floor, c, `${pre}_btn${i}`, `${pre}_go`, 30)));
  entities.push(btn(TR, az, ride.cars[0], `${pre}_exit`, `${pre}_arr`, 10));
  // ── the managers, the multisources, the shake, the message
  const T = d.time;
  const doors = DOORS(name, d.from);
  const first = A.cars[0].inner;
  const where = (T0, c, F) => {
    const p = along(T0, (c.inner.u[0] + c.inner.u[1]) / 2, (c.inner.w[0] + c.inner.w[1]) / 2);
    return [p[0], p[1], F + 60];
  };
  const go = where(TA, A.cars[0], from.floor);
  void first;
  entities.push(
    pointEntity("multisource", go, { targetname: `${pre}_dep_ms` }),
    pointEntity("multisource", mid, { targetname: `${pre}_arr_ms` }),
    pointEntity("multi_manager", go, {
      targetname: `${pre}_go`,
      [`${pre}_msg`]: 0,
      [doors]: 0.5,
      [`${pre}_dep_ms`]: t0,
      [`${pre}_dep_ms#1`]: t0 + win,
      [`${pre}_shake`]: t0 + win,
      [`${pre}_arr`]: t0 + win + T,
      [`${doors}#1`]: t0 + win + T + 2,
    }),
    pointEntity("multi_manager", mid, {
      targetname: `${pre}_arr`,
      [`${pre}_arr_ms`]: 0,
      [`${pre}_arr_ms#1`]: win,
      [`${pre}_arr_ms#2`]: 3,
      [`${pre}_arr_ms#3`]: 3 + win,
    }),
    pointEntity("env_shake", mid, { targetname: `${pre}_shake`, amplitude: 3, frequency: 80, duration: T, radius: 500 }),
    pointEntity("game_text", go, { targetname: `${pre}_msg`, message: "Las puertas se cierran. Salida en cinco segundos.", x: -1, y: 0.7, effect: 0, color: "255 255 255", color2: "255 255 255", fadein: 0.2, fadeout: 0.5, holdtime: 4, fxtime: 0.1, channel: 3, spawnflags: 1 }),
  );
  return { brushes, entities, names: { pre, doors, go: `${pre}_go`, arr: `${pre}_arr`, depMs: `${pre}_dep_ms`, arrMs: `${pre}_arr_ms`, exit: `${pre}_exit` }, extent: { min: R(xa - S - 16, y0 - S - 16, z0 - S - 16), max: R(xb + S + 16, y1 + S + 16, z1 + S + 16) }, zones: { departure: slicesA.reduce((s, c) => s + c.slices.length, 0), arrival: slicesR.reduce((s, c) => s + c.slices.length, 0) }, cars, duration: t0 + win + T + 2 };
}

/** The rides of a planned site: `{ brushes, entities, rides, report }`. Nothing where the spec has none. */
export function ridesOf(plan, name) {
  const failures = [];
  const brushes = [];
  const entities = [];
  const rides = [];
  for (const d of directionsOf(plan.site?.below?.rides)) {
    const got = direction(plan, name, d, failures);
    if (!got) continue;
    brushes.push(...got.brushes);
    entities.push(...got.entities);
    rides.push({ id: d.id, from: d.from, to: d.to, names: got.names, zones: got.zones, cars: got.cars, duration: got.duration, extent: got.extent });
  }
  return { brushes, entities, rides, report: { failures, notes: [] } };
}

/** The rides held to RIDE: stations with trains of one length of cars, a time, a room inside the world's limits, rooms that do not overlap, no name used twice. */
export function checkRides(plan, base = {}) {
  const rules = { ...RIDE, ...(base.ride ?? {}) };
  const cite = ` (${rules.source})`;
  const failures = [];
  const warnings = [];
  const measures = { rides: 0, directions: 0, zones: 0 };
  const list = plan.site?.below?.rides ?? [];
  const shift = plan.site?.recentre ?? [0, 0];
  const seen = new Set();
  const extents = [];
  const dirs = directionsOf(list);
  measures.rides = list.length;
  measures.directions = dirs.length;
  for (const d of dirs) {
    if (seen.has(d.id)) failures.push(`the ride ${d.id} is named twice; the names of its entities would be one${cite}`);
    seen.add(d.id);
    if (!(d.time >= rules.time[0] && d.time <= rules.time[1])) failures.push(`the ride ${d.id} lasts ${d.time} seconds; it wants ${rules.time[0]} to ${rules.time[1]}${cite}`);
  }
  const sink = [];
  const got = ridesOf(plan, "check");
  failures.push(...got.report.failures);
  void sink;
  for (const r of got.rides) {
    measures.zones += r.zones.departure + r.zones.arrival;
    const [lo, hi] = [r.extent.min, r.extent.max];
    for (const [v, what] of [[lo[0] + shift[0], "x"], [hi[0] + shift[0], "x"], [lo[1] + shift[1], "y"], [hi[1] + shift[1], "y"], [lo[2], "z"], [hi[2], "z"]])
      if (Math.abs(v) > rules.limit) failures.push(`the ride ${r.id}'s room reaches ${Math.round(v)} along ${what}, past +-${rules.limit} (the most the engine and a plugin's message keep)${cite}`);
    extents.push([r.id, lo, hi]);
  }
  for (let i = 0; i < extents.length; i++)
    for (let j = i + 1; j < extents.length; j++) {
      const [a, b] = [extents[i], extents[j]];
      if ([0, 1, 2].every((k) => a[1][k] < b[2][k] && b[1][k] < a[2][k])) failures.push(`the rooms of the rides ${a[0]} and ${b[0]} overlap; one is in the other${cite}`);
    }
  // the same room clear of the city's own arenas is the plan's affair (site.arenas): said here only where they meet
  for (const a of plan.site?.arenas ?? []) {
    const [lo, hi] = [a.at, [a.at[0] + a.size[0], a.at[1] + a.size[1], a.at[2] + a.size[2]]];
    for (const [id, l2, h2] of extents) if ([0, 1, 2].every((k) => lo[k] - 16 < h2[k] && l2[k] < hi[k] + 16)) failures.push(`the room of the ride ${id} overlaps the arena ${a.id}${cite}`);
  }
  return { failures, warnings, measures };
}
