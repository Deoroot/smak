// Connector pieces sized by the architecture rulebook (in the engine's units, as stage 0 loaded it): a stair's
// risers, treads, flights and landings, its form (a straight run when its stops stand far enough apart, a
// switchback well when they stand over one another), a lift's shaft, car and landing, a shaft's ladder well, a
// ramp's legs or helix. Everything returned in cells (plan, z) and metres (`_m`), rounded.
import { stairFits } from "../lib/architecture-rules.mjs";
import { r3 } from "./geom.mjs";

const up = (v) => Math.ceil(v * 2 - 1e-9) / 2; // up to the half cell

/** The stair kind of the rulebook for a connector: grand, public, service (the MSR's) or domestic (a secret). */
export const stairKind = (c) => (c.type === "grand-stair" ? "grand" : c.type === "secret" ? "domestic" : c.access === "msr" ? "service" : "public"); // prettier-ignore

/**
 * A stair climbing `rise` cells whose stops stand `horizontal` cells apart. Straight when the run fits between them
 * at the rulebook's steepest tread or gentler (treads up to the typical), else a switchback well at typical treads.
 */
export function stairDims(rise, horizontal, kind, rb, grid) {
  const mpu = rb.units.metresPerUnit;
  const m = (u) => u * mpu;
  const toC = (metres) => metres / grid.cell;
  const S = rb.dimensions.stairs;
  const riseM = rise * grid.cell;
  const N = Math.max(1, Math.ceil(riseM / m(S.rise.typical) - 1e-9));
  const r = riseM / N;
  const nf = Math.max(Math.ceil(N / S.maxRisersPerFlight), Math.ceil(riseM / m(S.maxFlightRise) - 1e-9));
  const per = Array.from({ length: nf }, (_, i) => Math.floor(N / nf) + (i < N % nf ? 1 : 0));
  const w = m(S.width[kind].typical);
  const L = Math.max(m(S.landing.minDepth), w);
  const gMin = Math.max(m(S.run.min), r / S.maxPitch);
  const gTyp = Math.max(m(S.run.typical), gMin);
  const D = horizontal * grid.cell;
  const straightMin = N * gMin + (nf - 1) * L;
  const form = D >= straightMin ? "straight" : "switchback";
  const g = form === "straight" ? Math.min(gTyp, Math.max(gMin, (D - (nf - 1) * L) / N)) : gTyp;
  const pathM = N * g + (nf - 1) * L;
  const fits = stairFits({ id: kind, kind, rise: r / mpu, run: g / mpu, width: w / mpu, headroom: S.headroom.min, risers: Math.max(...per), landing: L / mpu }, rb); // prettier-ignore
  return {
    form,
    kind,
    risers: N,
    riser_m: r3(r),
    tread_m: r3(g),
    pitch: r3(r / g),
    flights: nf,
    perFlight: per,
    width_m: r3(w),
    landing_m: r3(L),
    path: r3(toC(pathM)),
    width: r3(toC(w)),
    landing: r3(toC(L)),
    flightRuns: per.map((n) => r3(toC(n * g))),
    // a switchback well: two lanes of the stair's width side by side; its longest flight and a landing each end
    well: { across: up(toC(2 * w)), deep: up(toC(Math.max(...per) * g + 2 * L)) },
    headroom: r3(toC(m(S.headroom.min))),
    approach: r3(Math.max(toC(m(rb.keepClear.stair.minApproach)), toC(w))),
    fits: fits.failures,
  };
}

/** A lift: its shaft (car plus walls, on the half-cell grid), the car, and the landing before its door. */
export function liftDims(rb, grid) {
  const mpu = rb.units.metresPerUnit;
  const L = rb.dimensions.lifts;
  const wall = rb.dimensions.walls.interior.thickness.typical * mpu;
  const car = [L.car.width.typical * mpu, L.car.depth.typical * mpu, L.car.height.typical * mpu];
  const shaft = up((Math.max(car[0], car[1]) + 2 * wall) / grid.cell);
  return {
    shaft,
    car_m: car.map(r3),
    carHeight: r3(car[2] / grid.cell),
    landing: up(Math.max(L.landing.minDepth, rb.keepClear.lift.minLandingDepth) * mpu / grid.cell),
  };
}

/** A ladder shaft: the hull and its clearance each side, on the half-cell grid, at least a cell. */
export function shaftDims(rb, grid) {
  const hull = rb.hullNow;
  const side = Math.max(1, up(((hull.width + 2 * rb.hull.minClearance) * rb.units.metresPerUnit) / grid.cell));
  return { shaft: side, landing: 1, top: r3((hull.height * rb.units.metresPerUnit) / grid.cell) };
}

/**
 * A ramp: its width (the description's, else the rulebook's walk ramp), grade and legs. Straight when its stops stand
 * its length apart. Else a walk ramp folds into a switchback well, legs side by side, none longer than its landings'
 * interval (at least 8 cells); a vehicle ramp has no landings (dimensions.ramps.vehicle) and winds as a helix: a
 * square well round a circular run whose centre radius is the design vehicle's turning radius (`vehicle`, the
 * description's; at least the ramp's width), as many turns as its length makes there, each turn rising past the
 * vehicle's height and margin. A helix's foot and head may open on any side of its well, as a shaft's doors do.
 */
export function rampDims(c, rise, horizontal, rb, grid, vehicleSpec = null) {
  const mpu = rb.units.metresPerUnit;
  const R = rb.dimensions.ramps;
  const vehicle = (c.width ?? 0) * grid.cell >= R.vehicle.width.min * mpu;
  const spec = vehicle ? R.vehicle : R.walk;
  const width = c.width ?? up((R.walk.width.typical * mpu) / grid.cell);
  const length = Math.max(c.length ?? 0, rise / spec.maxGrade);
  const fits = rise / length > spec.maxGrade + 1e-9 ? [`ramp ${c.id}: grade ${r3(rise / length)} over ${spec.maxGrade}`] : [];
  if (horizontal < length && vehicle) {
    const radius = Math.max(vehicleSpec?.turningRadius ?? width, width);
    const turns = length / (2 * Math.PI * radius);
    const side = up(2 * radius + width);
    const clear = (vehicleSpec?.height ?? 0) + (vehicleSpec?.margin ?? 0);
    if (rise / turns < clear - 1e-9) fits.push(`ramp ${c.id}: its helix rises ${r3(rise / turns)} a turn, under the vehicle's ${r3(clear)}`);
    return {
      form: "helix",
      width,
      grade: r3(rise / length),
      path: r3(length),
      radius: r3(radius),
      turns: r3(turns),
      well: { across: side, deep: side },
      landing: width,
      headroom: 1.5,
      approach: width,
      fits,
    };
  }
  const form = horizontal >= length ? "straight" : "switchback";
  const legRun = R.walk.maxRunBetweenLandings * mpu / grid.cell;
  const legs = form === "straight" ? 1 : Math.max(2, Math.ceil(length / Math.max(legRun, 8)));
  return {
    form,
    width,
    grade: r3(rise / length),
    path: r3(length),
    legs,
    well: { across: up(legs * width), deep: up(length / legs + 2 * width) },
    landing: width,
    headroom: 1.5,
    approach: width,
    fits,
  };
}
