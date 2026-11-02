// The map generator's stages 1, 2, 4, 6 and 7 on New Byzantium's edge tiles: the cases the Core never met. A winding
// way's zigzag meeting the seam at a vertex (its portal) still caps there; a facade under the sky in the deck layer's
// ring keeps its density's spread under the layer's cap and a height of its own beside its neighbours; a hallway's
// bridge as high as every way its band meets, not only the one the raster gave the cell; a hallway through a third
// tile starting at its portal on this tile's seam, and ending at the nearer of a checkpoint's two guard posts; a
// secret stair's stub hidden in the slab under its stop's floor; a vehicle ramp that cannot run straight wound as a
// helix; a footbridge's lamp off the canal's water and a plaza's lamp out of a well standing on it; the city's alarm
// switch only in the Nexus's tile, the switches within the tile's share, a checkpoint's second post its own door.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { testAsync, test, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator } from "../levels/gen/runner.mjs";
import { rampDims } from "../levels/gen/connectors.mjs";
import { tileBudget } from "../levels/gen/stage6-palette.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const box = (poly) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))]; // prettier-ignore

/** Runs a tile to stage `until` and returns its artifacts by number. */
async function runTile(tile, until) {
  const out = join(tmp, `edge-${tile}-${until}`);
  const res = await runGenerator({ desc, out, tile, until });
  const got = {};
  for (const r of res.results) got[r.n] = JSON.parse(readFileSync(join(out, r.file), "utf8"));
  return { res, got };
}
const failuresOf = (res) => res.results.flatMap((r) => r.failures);

await testAsync("a vehicle ramp that cannot run straight is a helix round the vehicle's turning radius", "ramp helix", async () => {
  const { got } = await runTile("c1_r0", 0);
  const rb = got[0].rulebook; // as stage 0 loads it, in the engine's units
  const grid = desc.grid;
  const v = desc.vehicle;
  const h = rampDims({ id: "r", length: 76, width: 2 }, 7, 1, rb, grid, v);
  sure(h.form === "helix" && h.radius === v.turningRadius && h.well.across === 10 && h.well.deep === 10, JSON.stringify(h));
  sure(Math.abs(h.turns - 76 / (2 * Math.PI * v.turningRadius)) < 0.01 && !h.fits.length, `turns ${h.turns}, ${h.fits}`);
  // a turn of a tight helix (radius 1.25 at the grade cap rises about 1.2) under a 2-cell-high vehicle
  const tight = rampDims({ id: "r", width: 1.25 }, 5, 1, rb, grid, { turningRadius: 1, height: 2, margin: 0.125 });
  sure(tight.fits.some((f) => f.includes("helix rises")), `a turn under the vehicle's height: ${tight.fits}`);
  const walk = rampDims({ id: "w", length: 30 }, 5, 1, rb, grid, v);
  sure(walk.form === "switchback" && walk.legs >= 2, `a walk ramp keeps its switchback: ${JSON.stringify(walk)}`);
  const straight = rampDims({ id: "s", length: 40, width: 2 }, 5, 45, rb, grid, v);
  sure(straight.form === "straight", "stops far enough apart: straight");
});

test("a tile's switch target never past its share's maximum (the small edge tiles)", () => {
  for (const t of ["c0_r2", "c1_r0", "c1_r1"]) {
    const B = tileBudget(desc, t);
    sure(Math.min(B.switches.target, B.switches.max) <= B.switches.max && B.switches.min <= B.switches.max, `${t}: ${JSON.stringify(B.switches)}`); // prettier-ignore
  }
});

await testAsync("c0_r1: a winding lane caps at its portal; a hallway bridges at the higher way's clearance", "edge c0_r1", async () => {
  const { res, got } = await runTile("c0_r1", 4);
  const site = got[1];
  const alley = site.ways.find((w) => w.id === "s3_palace_alley");
  sure(alley.caps.some((c) => c.seam && c.portal === "p_s3_palace_alley"), `palace alley caps ${JSON.stringify(alley.caps)}`);
  const gallery = site.ways.find((w) => w.id === "s3_gallery_b");
  sure(gallery.caps.some((c) => c.seam && c.portal === "p_s3_gallery_b"), `gallery lane caps ${JSON.stringify(gallery.caps)}`);
  const net = got[4];
  const fl = failuresOf(res);
  sure(!fl.some((f) => /overlap: hallway/.test(f)), fl.join(" | "));
  const sv = net.hallways.find((h) => h.id === "sv3_w");
  for (const b of sv.bridges) if (b.over.includes("s3_west")) sure(b.z[0] >= 12 + 2.5 - 1e-6, `bridge over s3_west at z ${b.z}`);
});

await testAsync("c0_r0: facades in the deck's sky ring keep a dense district's spread and differ beside each other", "edge c0_r0", async () => {
  const { got } = await runTile("c0_r0", 2);
  const ring = got[2].lots.filter((l) => l.kind === "facade" && l.layer === "L2" && l.district === "d2_stacks" && l.rect.x + l.rect.w / 2 < 22); // prettier-ignore
  sure(ring.length >= 3, `${ring.length} ring facades`);
  sure(ring.every((l) => l.facade.storeys >= 2 && l.facade.storeys <= 4), ring.map((l) => l.facade.storeys).join(","));
  sure(new Set(ring.map((l) => l.facade.storeys)).size >= 2, "one height in the ring");
  const byBlock = new Map();
  for (const l of ring) (byBlock.get(l.block) ?? byBlock.set(l.block, []).get(l.block)).push(l);
  for (const ls of byBlock.values()) for (let i = 1; i < ls.length; i++) sure(ls[i].facade.storeys !== ls[i - 1].facade.storeys, `${ls[i - 1].id} and ${ls[i].id} one height`); // prettier-ignore
});

await testAsync("c1_r0: the canal ramp a helix, the gate hallway to the nearer post, a second post _post_b, no alarm switch", "edge c1_r0", async () => {
  const { res, got } = await runTile("c1_r0", 7);
  const fl = failuresOf(res).filter((f) => !/^(variety|room|lift|msr_|stacks)/.test(f));
  sure(res.results.every((r) => r.n > 7 || r.pass), fl.join(" | "));
  const net = got[4];
  const ramp = net.connectors.find((c) => c.id === "c21_ramp");
  sure(ramp.form === "helix" && ramp.pieces.some((p) => p.kind === "well") && ramp.exits.length === 2, JSON.stringify(ramp.exits));
  for (const e of ramp.exits) sure(box(e.approach)[2] - box(e.approach)[0] <= ramp.dims.width + 1e-6 || box(e.approach)[3] - box(e.approach)[1] <= ramp.dims.width + 1e-6, "an exit one ramp wide"); // prettier-ignore
  const cp = net.checkpoints.find((k) => k.id === "cp2_gate");
  const posts = cp.rooms.filter((r) => r.kind === "guard-post");
  sure(posts.length === 2, `${posts.length} posts`);
  const hall = net.hallways.find((h) => h.id === "sv2_gate");
  const end = hall.path[hall.path.length - 1];
  const near = posts.map((p) => dist([p.rect.x + p.rect.w / 2, p.rect.y + p.rect.d / 2], end)).sort((a, b) => a - b);
  sure(near[0] < 2, `the hallway ends ${near[0]} from the nearer post`);
  const w = got[7];
  const names = w.doors.filter((d) => d.checkpoint === "cp2_gate" && d.kind === "post").map((d) => d.name).sort();
  sure(JSON.stringify(names) === JSON.stringify(["cp2_gate_post", "cp2_gate_post_b"]), names.join(","));
  sure(!w.switches.some((s) => s.kind === "alarm"), "an alarm switch outside the Nexus's tile");
  const B = tileBudget(desc, "c1_r0");
  sure(w.switches.length <= B.switches.max, `${w.switches.length} switches, at most ${B.switches.max}`);
});

await testAsync("c1_r2: a secret stair's stub runs in the slab under its stop's floor", "edge c1_r2", async () => {
  const { res, got } = await runTile("c1_r2", 4);
  const salon = got[4].connectors.find((c) => c.id === "c32_secret_salon");
  const stub = salon.pieces.find((p) => p.kind === "stub");
  sure(stub && stub.z[1] <= 5 + 1e-6 && stub.z[0] > 4 - 1e-6, `stub z ${stub?.z}`);
  sure(!failuresOf(res).some((f) => /secret_salon/.test(f)), failuresOf(res).join(" | "));
});

await testAsync("c2_r0/c2_r1: a hallway from its own seam's portal; lamps off the water and out of wells", "edge c2", async () => {
  const a = await runTile("c2_r0", 6);
  const sv = a.got[4].hallways.find((h) => h.id === "sv3_helix");
  const p2 = desc.tiles.portals.find((p) => p.id === "p_sv3_helix_2");
  sure(dist(sv.path[0], p2.at) < 2 || dist(sv.path[sv.path.length - 1], p2.at) < 2, `sv3_helix from ${sv.path[0]}, its portal ${p2.at}`);
  const wells = a.got[4].connectors.flatMap((c) => c.pieces.filter((p) => p.kind === "well" || p.kind === "shaft").map((p) => box(p.poly)));
  for (const l of a.got[6].lamps.filter((x) => x.kind === "plaza")) sure(!wells.some((b) => l.at[0] > b[0] && l.at[0] < b[2] && l.at[1] > b[1] && l.at[1] < b[3]), `${l.id} in a well`); // prettier-ignore
  const b = await runTile("c2_r1", 6);
  const canals = b.got[1].ways.filter((w) => w.water > 0);
  const segD = (p, q, r) => { const L2 = (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2 || 1; const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1])) / L2)); return dist(p, [q[0] + t * (r[0] - q[0]), q[1] + t * (r[1] - q[1])]); }; // prettier-ignore
  for (const l of b.got[6].lamps.filter((x) => /bridge/.test(x.space))) {
    sure(l.mount, `${l.id} unfixed: ${l.why}`);
    for (const c of canals) for (const part of c.parts) for (let i = 1; i < part.length; i++) sure(segD(l.at, part[i - 1], part[i]) >= c.water / 2, `${l.id} over ${c.id}'s water`); // prettier-ignore
  }
});

