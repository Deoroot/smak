// levels/assembly part N, the navmesh walk (levels/assembly/navwalk.mjs): the second walk test, on Recast & Detour
// (npm recast-navigation), sharing no walking code with reachOf. On the kit's two rooms (a func_wall closing the
// second): the closed room is an island of its own. On maps compiled here (two rooms on two storeys joined by a
// stair, a sealed room no way reaches): the upper room reached, with a path; the sealed room not, in a sentence that
// names it; the stair lifted 32 off the floor breaks the walk, and the sentence names the upper room; a func_door
// across the stair's top shut with `doors: "closed"` and gone with "open"; the same report twice. The command ends
// in its PASS or FAIL line. Skipped with a note when the library is not installed; the compiled cases when VHLT is not
// named in VHLT_DIR.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as maps from "../src/maps/index.mjs";
import { testAsync, sure, tmp, HERE } from "./helper.mjs";
import { navWalk, navAvailable } from "../levels/assembly/navwalk.mjs";

const folder = join(tmp, "navwalk");
mkdirSync(folder, { recursive: true });
const CLI = join(HERE, "../levels/tools/navwalk.mjs");
const say = (r) => r.failures.join(" | ") || "no failure";
const steady = (r) => JSON.stringify({ ...r, navmesh: { ...r.navmesh, seconds: 0 } });

/** Two rooms on two storeys joined by a stair, and a sealed room; "lifted": the stair 32 off the floor; "door": a func_door across the stair's top. */
function testMap(variant) {
  const T = "WALL";
  const brushes = [
    ...maps.hollow([0, 0, 0], [1024, 512, 384], 16, T), // the lower room x 0..512, floor 0
    maps.box([512, 0, 0], [1024, 512, 192], T), // under the upper room: its floor at 192
    ...maps.hollow([0, 1024, 0], [256, 1280, 128], 16, T), // the sealed room
  ];
  let flight = maps.stairs([320, 0, 0], [512, 128, 192], "+x", T, { steps: 12 });
  if (variant === "lifted") flight = maps.moved(flight, [0, 0, 32]);
  brushes.push(...flight);
  const entities = [
    maps.playerStart([128, 256, 0]),
    maps.light([256, 256, 300], { brightness: 300 }),
    maps.light([768, 256, 300], { brightness: 300 }),
    maps.light([128, 1152, 100], { brightness: 300 }),
  ];
  if (variant === "door") entities.push(maps.brushEntity("func_door", [maps.box([512, 0, 192], [528, 128, 304], T)], { angle: -1, targetname: "stairdoor" })); // prettier-ignore
  return { worldspawn: {}, brushes, entities };
}
const TARGETS = [
  { name: "the lower room's middle", at: [256, 256, 0] },
  { name: "the upper room's middle", at: [768, 256, 192] },
  { name: "the sealed room's middle", at: [128, 1152, 0] },
  { name: "the stair's foot", at: [290, 64, 0] },
  { name: "the stair's top", at: [560, 64, 192] },
];
const target = (r, name) => r.targets.find((t) => t.name === name);

if (!(await navAvailable()))
  console.log("skip  the navmesh walk\n      skipped: the npm package recast-navigation is not installed (npm install in the kit's folder)"); // prettier-ignore
else {
  await testAsync(
    "navwalk: on the kit's two rooms, the room a func_wall closes is an island of its own; a start given by hand",
    "navwalk two rooms",
    async () => {
      const bytes = readFileSync(join(HERE, "fixtures", "tworooms.bsp"));
      const r = await navWalk(bytes);
      sure(/func_wall \*1/.test(r.geometry), r.geometry);
      sure(
        r.islands.length === 2 && r.islands.filter((i) => i.start).length === 1,
        JSON.stringify(r.islands),
      );
      sure(
        r.failures.length === 1 && /is not reached from the start: navmesh island 2 of 2/.test(r.failures[0]),
        say(r),
      );
      const given = await navWalk(bytes, { from: [[96, 352, 36]], islands: "report" });
      sure(given.ok && given.starts[0].island === 2, `${say(given)} ${JSON.stringify(given.starts)}`);
    },
  );

  const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
  if (!compilers.found)
    console.log(`skip  the navmesh walk on compiled maps\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run them)`); // prettier-ignore
  else {
    const wad = join(folder, "navwalk.wad");
    writeFileSync(wad, maps.writeWad([{ name: "WALL", image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }])); // prettier-ignore
    const built = {};
    for (const variant of ["good", "lifted", "door"]) {
      const map = testMap(variant);
      map.worldspawn.wad = [wad];
      const file = join(folder, `${variant}.map`);
      writeFileSync(file, maps.writeMap(map));
      const made = maps.compileMap(file, { fast: true, compilers, wads: [wad] });
      built[variant] = made.bsp ? readFileSync(made.bsp) : made.errors.join("; ");
    }
    const bspOf = (v) => {
      sure(typeof built[v] !== "string", `the ${v} map did not compile: ${built[v]}`);
      return built[v];
    };

    await testAsync(
      "navwalk: the upper room is reached up the stair, with a path; the sealed room is not, by name",
      "navwalk reached",
      async () => {
        const r = await navWalk(bspOf("good"), { targets: TARGETS });
        for (const name of [
          "the lower room's middle",
          "the upper room's middle",
          "the stair's foot",
          "the stair's top",
        ])
          sure(target(r, name).reached, `${name}: ${JSON.stringify(target(r, name))}; ${say(r)}`);
        const up = target(r, "the upper room's middle");
        sure(up.pathLength > 640 && up.pathLength < 1200, `the path up: ${up.pathLength}`);
        sure(
          !target(r, "the sealed room's middle").reached,
          JSON.stringify(target(r, "the sealed room's middle")),
        );
        sure(r.failures.length === 1 && r.failures[0].startsWith("the sealed room's middle (128 1152 0) is not reached from the start: its floor is on another island"), say(r)); // prettier-ignore
      },
    );

    await testAsync(
      "navwalk: the stair lifted 32 off the floor breaks the walk, and the sentence names the upper room",
      "navwalk lifted",
      async () => {
        const r = await navWalk(bspOf("lifted"), { targets: TARGETS });
        sure(target(r, "the stair's foot").reached && !target(r, "the upper room's middle").reached, say(r));
        sure(r.failures.some((f) => f.startsWith("the upper room's middle (768 256 192) is not reached from the start")), say(r)); // prettier-ignore
        // the lifted flight is an island of its own, between the two floors
        sure(
          r.islands.some((i) => !i.start && i.at[2] > 40 && i.at[2] < 192),
          JSON.stringify(r.islands),
        );
      },
    );

    await testAsync(
      "navwalk: a func_door across the stair's top is a wall with doors closed and gone with doors open",
      "navwalk doors",
      async () => {
        const shut = await navWalk(bspOf("door"), { targets: TARGETS, doors: "closed" });
        sure(!target(shut, "the upper room's middle").reached && /1 solid brush entities \(func_door/.test(shut.geometry), `${say(shut)} ${shut.geometry}`); // prettier-ignore
        const open = await navWalk(bspOf("door"), { targets: TARGETS, doors: "open" });
        sure(target(open, "the upper room's middle").reached && /1 func_door/.test(open.geometry), `${say(open)} ${open.geometry}`); // prettier-ignore
      },
    );

    await testAsync(
      "navwalk: the same map gives the same report twice; the command ends in its FAIL line and names its detail",
      "navwalk same",
      async () => {
        const a = await navWalk(bspOf("lifted"), { targets: TARGETS });
        const b = await navWalk(bspOf("lifted"), { targets: TARGETS });
        sure(steady(a) === steady(b), "two walks of one map differ");
        const targets = join(folder, "targets.json");
        writeFileSync(targets, JSON.stringify(TARGETS));
        const report = join(folder, "lifted-walk.json");
        let text = "";
        let code = 0;
        try {
          text = execFileSync(process.execPath, [CLI, join(folder, "lifted.bsp"), "--targets", targets, "--report", report], { encoding: "utf8" }); // prettier-ignore
        } catch (e) {
          text = e.stdout;
          code = e.status;
        }
        const last = text.trim().split("\n").pop();
        sure(code === 1 && last.startsWith("FAIL: lifted.bsp: 2 of 5 targets reached"), `${code}: ${last}`);
        sure(JSON.parse(readFileSync(report, "utf8")).targets.length === 5 && text.includes(report), text);
      },
    );
  }
}
