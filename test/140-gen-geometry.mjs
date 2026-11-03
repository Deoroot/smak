// The map generator's stage 10, geometry (the Xash adapter, levels/experimental-city/stage10-geometry.mjs, geometry-xash.mjs):
// New Byzantium's Core built as brush source from 01-09 (the carve of rock with its spaces clipped to the tile's box,
// building shells of world with detail inside, streets, stairs, the forms, every door, switch, lift, light, sound and
// spawn of the wiring contract by its name) and gated by the source checks: checkPlan, no leak, the counts within
// the tile's share, the carve's heights within rock.maxHeights, every texture on the clients (or the kit's), every
// name present and at most 31 characters. The same .map twice; the R2 pictures drawn; a .map changed after its
// artifact is refused as stale; and each check failing a broken case by its sentence (a brush with no volume, a
// leak, a name too long or on two entities, a target no one answers, an entity count past the share, a texture no
// client has, a carve past its heights, a contract name missing).
import { join } from "node:path";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { testAsync, test, sure, tmp, HERE } from "./helper.mjs";
import { runGenerator } from "../levels/experimental-city/runner.mjs";
import { stage, sourceChecks, tileLimits, staysInGame } from "../levels/experimental-city/stage10-geometry.mjs";
import { stepsFor, buildTile, entityName, nameKeys, _internal as G } from "../levels/experimental-city/geometry-xash.mjs";
import { metreRules } from "../levels/experimental-city/stage3-programs.mjs";
import { leakHint } from "../src/maps/plan.mjs";
import { textureResolver } from "../levels/experimental-city/geometry-textures.mjs";
import { reviewPictures } from "../levels/experimental-city/geometry-pictures.mjs";
import { FILES, writeArtifact, staleness, sha256 } from "../levels/experimental-city/artifact.mjs";
import { carvePlan } from "../src/maps/ground.mjs";
import { playerStart, light, box, brushEntity, shapeOf } from "../src/maps/source.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const RULES = join(HERE, "../levels/rules/architecture.json");
const rulebook = JSON.parse(readFileSync(RULES, "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const has = (list, ...words) => list.some((f) => words.every((w) => f.includes(w)));
const say = (r) => (r.failures ?? []).slice(0, 4).join(" | ") || "nothing (it passed)";

/** A sealed room carved by carvePlan with a light and a spawn: a map that passes. */
function roomMap() {
  const rock = carvePlan([{ outline: [[0, 0], [512, 0], [512, 384], [0, 384]], floor: 0, ceiling: 192 }], 64, "crete33");
  return { worldspawn: { wad: ["specialists.wad"] }, brushes: rock, entities: [light([256, 192, 160], {}), playerStart([128, 128, 0], 0, "info_player_deathmatch")] }; // prettier-ignore
}

test("gen geometry: the source checks pass a sealed room and fail each broken case by its sentence", () => {
  const ok = sourceChecks(roomMap(), { limits: { brushes: 100, structural: 100, rock: 100, brushModels: 10, entities: 10 }, rock: 6 });
  sure(!ok.failures.length, say(ok));
  sure(ok.counts.staying === 1 && ok.counts.world >= 6, JSON.stringify(ok.counts)); // the untargeted light is freed
  // a brush with no volume
  let m = roomMap();
  m.brushes.push({ faces: box([0, 0, 0], [8, 8, 8], "crete33").faces.map((f) => ({ ...f, points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] })) });
  let v = sourceChecks(m);
  sure(has(v.failures, "checkPlan:"), say(v));
  // a leak: the rock over the room taken away
  m = roomMap();
  m.brushes = m.brushes.filter((b) => shapeOf(b).min[2] < 192);
  v = sourceChecks(m);
  sure(has(v.failures, "leak: the map is open to the void"), say(v));
  // names: too long, on two entities, a target no one answers
  m = roomMap();
  m.entities.push(brushEntity("func_door", [box([200, 200, 0], [208, 264, 96], "door006")], { targetname: "a_name_of_forty_characters_is_too_long_x" })); // prettier-ignore
  m.entities.push(brushEntity("func_door", [box([300, 200, 0], [308, 264, 96], "door006")], { targetname: "twice" }));
  m.entities.push(brushEntity("func_button", [box([300, 100, 40], [304, 108, 48], "door006")], { targetname: "twice", target: "nobody" })); // prettier-ignore
  v = sourceChecks(m);
  sure(has(v.failures, "name a_name_of_forty_characters_is_too_long_x (func_door) is 40 characters, at most 31"), say(v));
  sure(has(v.failures, "name twice is on 2 entities"), say(v));
  sure(has(v.failures, "func_button twice targets nobody, which no entity is named"), say(v));
  // entities past the tile's share
  v = sourceChecks(m, { limits: { entities: 2 } });
  sure(has(v.failures, "entities that stay: 4, at most 2"), say(v));
  // a light with a name stays, one without does not
  sure(staysInGame({ classname: "light", targetname: "x" }) && !staysInGame({ classname: "light" }) && !staysInGame({ classname: "func_detail" }), "staysInGame"); // prettier-ignore
});

test("gen geometry: textures resolved to what the clients have, stand-ins listed, the kit behind its flag", () => {
  const desc = JSON.parse(readFileSync(SPEC, "utf8"));
  const tex = textureResolver({ desc });
  sure(tex.ofRole("marble-wall-dark", "sinmarblewall") === "sinmarblewall", "an on-client texture kept");
  sure(tex.ofRole("msr-wall", "MJSTWALL04") === "wallvault2", `majestic.wad's MSR wall is on no client: ${tex.ofRole("msr-wall", "MJSTWALL04")}`);
  sure(tex.ofRole("road-asphalt", "asphalt04") === "masphalt5", "asphalt04 exists nowhere: masphalt5");
  sure(tex.ofRole("a-role-nobody-has") === "crete33", "an unknown role: the named fallback");
  const a = tex.audit();
  sure(!a.unresolved.length && a.wads[0] === "specialists.wad" || a.wads.includes("specialists.wad"), JSON.stringify(a.wads));
  sure(has(a.standIns.map((s) => `${s.role} ${s.used} ${s.why}`), "msr-wall wallvault2 MJSTWALL04 is not on the clients (majestic.wad"), JSON.stringify(a.standIns)); // prettier-ignore
  sure(has(a.standIns.map((s) => `${s.role} ${s.why}`), "a-role-nobody-has", "no stand-in for the role: the fallback crete33"), JSON.stringify(a.standIns)); // prettier-ignore
  const kit = textureResolver({ desc, kit: true });
  sure(kit.ofRole("msr-wall", "MJSTWALL04") === "nbm_wall1" && kit.audit().wads.at(-1) === "newbyzantium.wad", `the kit's MSR wall, its WAD last: ${JSON.stringify(kit.audit().wads)}`); // prettier-ignore
  // a name used directly that no client has and no stand-in covers is unresolved
  const bare = textureResolver({ desc, clients: { wads: [{ short: "X", file: "x.wad", onClients: true, names: ["a"] }], notOnClients: {}, standIns: { byRole: {}, byName: {}, fallback: "missing_too" } } }); // prettier-ignore
  bare.ofRole("whatever");
  sure(bare.audit().unresolved.includes("missing_too"), JSON.stringify(bare.audit()));
});

test("gen geometry: a flight's risers two by two within a step, outlines clipped to the tile, boxes less holes", () => {
  sure(stepsFor(109, 14) === 7 && stepsFor(200, 10) === 10, `${stepsFor(109, 14)} ${stepsFor(200, 10)}`); // 15.6 units a step; 20 would not
  const c = G.clipToBox([[-10, 0], [10, 0], [10, 10], [-10, 10]], [0, 0, 100, 100]);
  sure(c && Math.min(...c.map((p) => p[0])) === 0, JSON.stringify(c));
  sure(G.clipToBox([[-10, 0], [-5, 0], [-5, 5]], [0, 0, 100, 100]) === null, "outside the box: nothing");
  const parts = G.boxMinus([0, 0, 10, 10], [[4, 4, 6, 6]]);
  sure(parts.length === 4 && parts.reduce((s, p) => s + (p[2] - p[0]) * (p[3] - p[1]), 0) === 96, JSON.stringify(parts));
});

test("gen geometry: an artifact whose .map changed or went missing after it was made is stale", () => {
  const dir = join(tmp, "gen-geometry-files");
  mkdirSync(dir, { recursive: true });
  const text = "// a map\n";
  writeFileSync(join(dir, "t.map"), text);
  writeArtifact(dir, "10-geometry.json", { format: "smak-gen/1", stage: "geometry", n: 10, inputs: {}, params: { tile: "t", seed: 1 }, files: [{ file: "t.map", sha256: sha256(text) }], gate: { pass: true } }); // prettier-ignore
  sure(staleness(dir, "10-geometry.json", {}, { tile: "t", seed: 1 }) === null, "fresh");
  writeFileSync(join(dir, "t.map"), "// changed\n");
  const why = staleness(dir, "10-geometry.json", {}, { tile: "t", seed: 1 });
  sure(why === "10-geometry.json is stale: its file t.map changed after it was made", why);
});

let core = null;
await testAsync("gen geometry: the Core built as brush source, every source check passing, within the tile's share", "gen geometry core", async () => {
  // the stages 0-9 of the Core: SMAK_GEN_FORMS (a folder of 00-09), else the forms tests' run, else run here
  let OUT = process.env.SMAK_GEN_FORMS ?? join(tmp, "gen-forms");
  if (!existsSync(join(OUT, "09-forms.json"))) {
    OUT = join(tmp, "gen-geometry");
    const desc = JSON.parse(readFileSync(SPEC, "utf8"));
    const res = await runGenerator({ desc, out: OUT, tile: "c1_r1", until: 9 });
    sure(res.ok, `the run to stage 9: ${res.refused ?? `stopped at ${res.stopped?.n} ${res.stopped?.name}: ${res.stopped?.failures?.slice(0, 2).join(" | ")}`}`); // prettier-ignore
  }
  const inputs = {};
  for (const f of readdirSync(OUT)) if (/^0\d-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  const desc = inputs["00-description.json"].description; // what 01-09 were made from
  const ctx = { description: desc, rulebook, params: inputs["09-forms.json"].params, inputs, options: {} };
  const body = stage.run(ctx);
  const art = { format: "smak-gen/1", stage: "geometry", n: 10, inputs: {}, params: ctx.params, ...body };
  const v = stage.gate(art, ctx);
  sure(!v.failures.length, say(v));
  const text = body[FILES][art.files[0].file];
  sure(text.startsWith("{") && text.includes('"mapversion" "220"') && text.includes('"skyname" "nbstorm"') && text.includes('"MaxRange" "32768"'), "worldspawn's keys"); // prettier-ignore
  // the counts within the tile's share; the rock, the structure, the carve's heights
  const L = tileLimits(desc);
  const c = art.counts;
  sure(c.brushes <= L.brushes && c.structural <= L.structural && c.rock <= L.rock && c.staying <= L.entities && c.brushModels <= L.brushModels, JSON.stringify({ c, L })); // prettier-ignore
  for (const [lid, hs] of Object.entries(art.heights)) sure(hs.length <= desc.rules.rock.maxHeights[lid], `${lid}: ${hs.join(", ")}`);
  sure(!art.checks.leak && !art.checks.errors.length, JSON.stringify(art.checks).slice(0, 300));
  // the texture audit: every name in a client's WAD
  sure(!art.textures.unresolved.length && art.textures.wads.includes("specialists.wad"), JSON.stringify(art.textures.wads));
  // the wiring contract: every door, switch, switchable light and lift by its name; the spawns in 07's order
  const W = inputs["07-wiring.json"];
  const names = new Set(art.targetnames);
  for (const d of W.doors) sure(names.has(d.name), `door ${d.name} missing`);
  for (const s of W.switches) sure(names.has(s.name), `switch ${s.name} missing`);
  for (const l of W.lights) sure(names.has(l.name), `light ${l.name} missing`);
  sure(art.contract.spawns.join() === W.spawns.order.join(), "the spawns in 07's order");
  sure(art.counts.entitiesByClass.info_player_deathmatch === W.spawns.order.length, JSON.stringify(art.counts.entitiesByClass));
  // the cells' fronts real bars within the rule where they fit, the masked fallback where they do not
  const R = rulebook.dimensions.cellBars;
  for (const cell of art.contract.cells) sure(cell.fallback === "masked" || (cell.bars <= R.maxBrushes && cell.gap_m <= R.clearGap.max + 1e-9), JSON.stringify(cell)); // prettier-ignore
  sure(art.contract.cells.some((x) => x.bars > 0), "some cell fronts real bars");
  // the same map from the same inputs
  const again = stage.run(ctx);
  sure(again[FILES][art.files[0].file] === text, "stage 10 wrote a different .map the second time");
  core = { art, ctx, inputs, text };
});

await testAsync("gen geometry: the Core's gate fails a broken copy by its sentence; the R2 pictures drawn", "gen geometry broken", async () => {
  sure(core, "no Core (the case before failed)");
  const { art, ctx } = core;
  let b = copy(art);
  b.counts.staying = 999;
  let v = stage.gate(b, ctx);
  sure(has(v.failures, "entities that stay: 999, at most 412"), say(v));
  b = copy(art);
  b.counts.rock = 2000;
  v = stage.gate(b, ctx);
  sure(has(v.failures, "carved rock: 2000, at most 1500"), say(v));
  b = copy(art);
  b.heights.L1 = [0, 0.75, 1.5, 2.25, 3, 3.75, 4];
  v = stage.gate(b, ctx);
  sure(has(v.failures, "rock: c1_r1 on L1 is carved at 7 distinct heights", "at most 6 (rock.maxHeights)"), say(v));
  b = copy(art);
  b.textures.unresolved = ["MJSTWALL04"];
  v = stage.gate(b, ctx);
  sure(has(v.failures, "texture MJSTWALL04 is in no WAD the clients have (the texture audit)"), say(v));
  b = copy(art);
  const door = ctx.inputs["07-wiring.json"].doors[0].name;
  b.targetnames = b.targetnames.filter((n) => n !== door);
  v = stage.gate(b, ctx);
  sure(has(v.failures, `the contract's door ${door} is not in the map`), say(v));
  // the R2 pictures: a plan a layer, the tile's two sections, the streets and the buildings
  const { readMap } = await import("../src/maps/source.mjs");
  const pics = reviewPictures(readMap(core.text), { site: ctx.inputs["01-site.json"], plans: ctx.inputs["05-plans.json"], origin: art.units.origin, width: 400, streets: false }); // prettier-ignore
  const names = pics.map((p) => p.name);
  sure(["plan-c1_r1-L1", "plan-c1_r1-L2", "plan-c1_r1-L3", "section-c1_r1-ew", "section-c1_r1-ns"].every((n) => names.includes(n)), names.join(", ")); // prettier-ignore
  sure(names.includes("building-msr_nexus-ew") && pics.every((p) => p.width > 0 && p.rgba.length === p.width * p.height * 4), names.join(", ")); // prettier-ignore
});

test("gen geometry: a name made from a form's id holds letters, digits and _ only, the names it targets alike", () => {
  sure(entityName("edges.train.e") === "edges_train_e" && entityName("nb_train_e_a") === "nb_train_e_a", entityName("edges.train.e"));
  const k = nameKeys({ targetname: "edges.train.e", target: "nb.train-e:a", speed: 320, message: "ambience/nb_train.wav" });
  sure(k.targetname === "edges_train_e" && k.target === "nb_train_e_a" && k.speed === 320 && k.message === "ambience/nb_train.wav", JSON.stringify(k)); // prettier-ignore
});

await testAsync("gen geometry: an outer tile's air beyond the city carved, a canal at no height of its own, a passage under every height", "gen geometry edge cases", async () => {
  sure(core, "no Core (the case before failed)");
  const build = (mutate, descOf = (d) => d) => {
    const inputs = copy(core.ctx.inputs);
    mutate(inputs);
    const ctx = { ...core.ctx, description: descOf(copy(core.ctx.description)), inputs };
    return buildTile(ctx, textureResolver({ desc: ctx.description }), metreRules(ctx));
  };
  const [bx0, by0, bx1, by1] = core.ctx.inputs["01-site.json"].tile.box;
  const ym = (by0 + by1) / 2;
  // 1. the Core's east side made the city's: a pocket beyond it (z 20 to 28) with a strobe on the side's line, a train
  // named from its form's id on two path_corners in the pocket, one point past the pocket (left out)
  const b = build((I) => {
    const F = I["09-forms.json"];
    F.world = { ...F.world, edge: { layer: "L2", wallTop: 20, sky: 28, depth: 10, tileSides: ["e"], pockets: [{ id: "pocket.e.test", side: "e", box: [bx1, by0, bx1 + 10, by1], z: [20, 28] }], roads: [] } }; // prettier-ignore
    const car = { shape: "box", poly: [[bx1 + 4, ym - 1], [bx1 + 5, ym - 1], [bx1 + 5, ym + 1], [bx1 + 4, ym + 1]], z: [22, 22.75], build: "entity", entity: "func_train", group: "edges.train.t", keys: { targetname: "edges.train.t", target: "nb_train_t_a", speed: 320 } }; // prettier-ignore
    F.forms.push({ id: "edges.test", family: "edges", kind: "backdrop", layer: "L2", build: "entity", parts: [car], points: [
      { classname: "env_sprite", at: [bx1, ym, 23.25], keys: { model: "sprites/glow01.spr" } },
      { classname: "path_corner", at: [bx1 + 5, ym - 5, 22], keys: { targetname: "nb_train_t_a", target: "nb_train_t_b" } },
      { classname: "path_corner", at: [bx1 + 5, ym + 5, 22], keys: { targetname: "nb_train_t_b", target: "nb_train_t_a" } },
      { classname: "info_target", at: [bx1 + 15, ym, 22], keys: {} },
    ] }); // prettier-ignore
  });
  const pocket = b.spaces.find((s) => s.name === "pocket.e.test");
  sure(pocket && Math.max(...pocket.outlines[0].map((p) => p[0])) > b.tileU[2] && pocket.floor === 20 * 128 && pocket.ceiling === 28 * 128, JSON.stringify(pocket?.outlines)); // prettier-ignore
  const ents = b.map.entities;
  sure(ents.some((e) => e.classname === "env_sprite") && ents.filter((e) => e.classname === "path_corner" && /^nb_train_t_/.test(e.targetname)).length === 2, "the strobe and the train's path kept"); // prettier-ignore
  sure(ents.some((e) => e.classname === "func_train" && e.targetname === "edges_train_t" && e.target === "nb_train_t_a"), "the train named of letters, digits and _"); // prettier-ignore
  sure(b.dropped.length === 1 && b.dropped[0].startsWith("info_target"), b.dropped.join("; "));
  const leak = leakHint(b.map);
  sure(!leak.leak, `a leak from ${leak.leak?.entity.classname} near ${leak.leak?.at}`);
  // 2. a canal under a way: carved up to the way's floor, so L1 has no height of 0.01
  const c = build((I) => {
    I["01-site.json"].ways.push({ id: "t_canal", class: "canal", layer: "L1", width: 8, water: 5, parts: [[[bx0 + 2, by0 + 6], [bx0 + 12, by0 + 6]]] }); // prettier-ignore
  });
  const canal = c.spaces.find((s) => s.name === "canal:t_canal#0");
  sure(canal && canal.ceiling === 0 && canal.floor === -128, JSON.stringify(canal?.cells));
  sure(c.heights.L1.every((z) => z === Math.round(z * 4) / 4), c.heights.L1.join(", "));
  // 3. a passage under the lowest floor (a secret stub at z -0.81 to -0.06) on a layer over its heights: no height
  // under its floor to move onto, so it stays (not -Infinity, which carvePlan refuses)
  const d = build((I) => {
    I["04-network.json"].connectors.push({ id: "t_stub", type: "secret", stops: [], form: "straight", pieces: [{ kind: "stub", poly: [[bx0 + 4, by0 + 4], [bx0 + 10, by0 + 4], [bx0 + 10, by0 + 4.5], [bx0 + 4, by0 + 4.5]], z: [-0.81, -0.06] }] }); // prettier-ignore
  }, (desc) => ({ ...desc, rules: { ...desc.rules, rock: { ...desc.rules.rock, maxHeights: { ...desc.rules.rock.maxHeights, L1: 2 } } } })); // prettier-ignore
  const stub = d.spaces.find((s) => s.name === "conn:t_stub#0");
  sure(stub && Number.isFinite(stub.floor) && stub.floor === -1.5 * 128 && stub.ceiling === 0, JSON.stringify(stub?.cells));
});

test("gen geometry: switchbacks walled as stair cores of the city's material, the sky lit, lamps by their space, every door seated", async () => {
  sure(core, "no Core (the case before failed)");
  const { art, text, inputs } = core;
  const { readMap } = await import("../src/maps/source.mjs");
  const map = readMap(text);
  const dk = art.counts.detailByKind;
  // 1. stairs: every switchback in the tile has core walls, the lanes a spine where they stand apart, no wooden flight
  sure(dk["stair-core"] > 0 && dk["stair-spine"] > 0, JSON.stringify(dk));
  const switchbacks = inputs["04-network.json"].connectors.filter((c) => c.form === "switchback" && !c.unplaced && c.type !== "lift");
  for (const c of switchbacks) sure(art.notes.some((n) => n.startsWith("stair cores:") && n.includes(`${c.id} `)), `${c.id} has no core`);
  const woodRe = new RegExp(rulebook.dimensions.stairs.material.wood, "i");
  for (const e of map.entities.filter((x) => x.classname === "func_detail" && /^connector:/.test(String(x._group))))
    for (const b of e.brushes) sure(!b.faces.some((f) => woodRe.test(f.texture)), `${e._group} wears wood`);
  // the forum's stairs: their L2 stop's floor is wooden, so they take the L3 stop's marble
  const forum = map.entities.find((x) => x._group === "connector:c32_forum_stair_w");
  sure(forum && forum.brushes.some((b) => b.faces.some((f) => f.texture === "marb")), "the forum stair in marble");
  // 2. the sky's light: one light_environment of the rulebook's colour; it takes no edict
  const sky = map.entities.filter((e) => e.classname === "light_environment");
  const S = rulebook.lighting.sky;
  sure(sky.length === 1 && String(sky[0]._light) === [...S.colour, S.brightness].join(" ") && !staysInGame(sky[0]), JSON.stringify(sky));
  // lamps by the size of what they light: within the rule, a tall or wide space's brighter than a room's
  const L = rulebook.lighting.lamps;
  const lamps = map.entities.filter((e) => e.classname === "light").map((e) => Number(String(e._light).split(" ")[3]));
  sure(lamps.length && lamps.every((v) => v >= L.min && v <= L.max) && Math.max(...lamps) > 2 * Math.min(...lamps), `${Math.min(...lamps)}-${Math.max(...lamps)}`); // prettier-ignore
  // 3. doors: only gates slide up; every leaf but a cell's bars hangs with solid beside both jambs and over its head
  const W = new Map(inputs["07-wiring.json"].doors.map((d) => [d.name, d]));
  const solids = [...map.brushes, ...map.entities.filter((e) => /^func_(detail|wall)$/.test(e.classname)).flatMap((e) => e.brushes)].map((b) => shapeOf(b)); // prettier-ignore
  const solid = (p) => solids.some((s) => p.every((v, i) => v >= s.min[i] - 0.5 && v <= s.max[i] + 0.5) && s.faces.every((f) => !f.normal || f.normal[0] * p[0] + f.normal[1] * p[1] + f.normal[2] * p[2] - f.dist <= 0.5)); // prettier-ignore
  const floating = [];
  for (const e of map.entities.filter((x) => /^func_door/.test(x.classname) && W.has(x.targetname))) {
    const d = W.get(e.targetname);
    if (String(e.angles) === "-90 0 0") sure(d.kind === "gate", `${d.name} (${d.kind}) slides up`);
    if (["house", "shop", "interior", "public", "post"].includes(d.kind)) sure(e.classname === "func_door_rotating", `${d.name} (${d.kind}) is a ${e.classname}`);
    if (d.kind === "cell" || d.kind === "hatch") continue;
    const sh = e.brushes.map((b) => shapeOf(b)).filter((s) => !s.faces.every((f) => /origin/i.test(f.texture)));
    const min = [0, 1, 2].map((i) => Math.min(...sh.map((s) => s.min[i])));
    const max = [0, 1, 2].map((i) => Math.max(...sh.map((s) => s.max[i])));
    const ax = max[0] - min[0] >= max[1] - min[1] ? 0 : 1;
    const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const side = (v) => (ax === 0 ? [v, c[1], c[2]] : [c[0], v, c[2]]);
    if (!solid(side(min[ax] - 8)) || !solid(side(max[ax] + 8)) || !solid([c[0], c[1], max[2] + 8])) floating.push(d.name);
  }
  sure(!floating.length, `doors standing in open air: ${floating.join(", ")}`);
});
