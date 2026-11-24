// The remaster pack (packs/remaster): a shipped map remastered by zones, each changing only what its box holds, merged
// in one build; the textures of all in one .wad; what an eye sees that a zone cannot change. On the kit's two rooms.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maps } from "../src/index.mjs";
import { applyZones, sharedWad, pickFaces } from "../packs/remaster/remaster.mjs";
import { shipped, zone, writeZones, TWOROOMS_MAP, WEST } from "./fixture-remaster.mjs";
import { wholeWad } from "./fixture-wad.mjs";
import { testAsync, test, sure, tmp, HERE, runRefused } from "./helper.mjs";

const BIN = join(HERE, "../packs/remaster/bin.mjs");

await testAsync("applyZones: two rooms retextured each by its zone, a crate and a lamp added; the shipped map's brushes kept", "remaster zones", async () => {
  const map = shipped();
  const count = map.brushes.length;
  const made = await applyZones(map, [zone("west"), zone("east")]);
  sure(!made.errors.length, made.errors.join(" | "));
  sure(made.facts.join("; ") === "zone west: 1 brushes, 2 entities; zone east: 0 brushes, 0 entities", made.facts.join("; "));
  sure(map.brushes.length === count && map.entities.length === 6, `${map.brushes.length} brushes, ${map.entities.length} entities`);
  // the wall between the rooms (x 192 to 224): its west face is the west zone's, its east face the east's
  const between = map.brushes[2].faces.map((f) => f.texture);
  sure(between.includes("smakfloor") && between.includes("smakwall"), between.join());
  // each fault said in its own words
  const said = async (fault) => (await applyZones(shipped(), [zone("west", fault), zone("east")])).errors.join(" | ");
  sure(/the boxes of west and east overlap/.test(await said("overlap")), "overlap");
  sure(/west changed \d+ faces or brushes outside its box/.test(await said("outside")), "outside");
  sure(/west: 2 brushes it adds are outside its box/.test(await said("brush")), "brush");
  sure(/west put entities into the map itself/.test(await said("pushed")), "pushed");
  sure(/west: its light at 280 200 64 is outside its box/.test(await said("entity")), "entity");
});

test("sharedWad: several .wad files in one, each picture once; one name for two pictures refused", () => {
  const [a, b] = [join(tmp, "remaster-a.wad"), join(tmp, "remaster-b.wad")];
  writeFileSync(a, wholeWad());
  writeFileSync(b, wholeWad());
  const one = sharedWad([a, b]);
  const read = maps.readWad(one.bytes);
  sure(!one.errors.length && one.count === read.textures.length + read.others.length && read.textures.length > 0, `${one.count} ${one.errors}`); // prettier-ignore
  const other = Buffer.from(wholeWad());
  other[12 + 40 + 5] ^= 0xff; // a texel of the first picture changed (after the file's head and the picture's)
  writeFileSync(b, other);
  sure(/is another picture in remaster-b\.wad than in a \.wad before it/.test(sharedWad([a, b]).errors.join()), sharedWad([a, b]).errors.join());
});

test("pickFaces: from the west room's start, every face seen is the west zone's; a box short of the far wall (y 192) leaves it out", () => {
  const map = shipped();
  const seen = pickFaces(map, { eye: [96, 96, 64], yaw: 90, fov: 90, box: WEST });
  sure(seen.cells.length === 16 * 9 && !seen.outside.length, seen.said);
  const short = pickFaces(map, { eye: [96, 96, 64], yaw: 90, fov: 90, box: { ...WEST, max: [192, 150, 144] } });
  sure(short.outside.some((face) => face.centre[1] === 192) && /faces seen have their centre outside the box/.test(short.said), short.said);
});

test("packs/remaster/bin.mjs: build writes the merged map and wads.txt; pick answers PASS or FAIL; a fault is a FAIL", () => {
  const [west, east] = writeZones(join(tmp, "remaster-zones"));
  const out = join(tmp, "remaster-out", "merged.map");
  const built = runRefused(BIN, "build", TWOROOMS_MAP, "--zone", west, "--zone", east, "-o", out);
  sure(built.code === 0 && /PASS: .*merged\.map: 2 zones, each in its box/.test(built.out), built.out + built.err);
  sure(maps.readMap(readFileSync(out, "latin1")).entities.some((e) => e.classname === "func_detail"), "the crate's func_detail");
  const picked = runRefused(BIN, "pick", TWOROOMS_MAP, "--zone", west, "--eye", "96,96,64", "--yaw", "90", "--fov", "90");
  sure(picked.code === 0 && /PASS: west: every face seen/.test(picked.out), picked.out);
  const across = runRefused(BIN, "pick", TWOROOMS_MAP, "--zone", east, "--eye", "96,96,64", "--yaw", "90", "--fov", "90");
  sure(across.code === 1 && /FAIL: east: \d+ faces seen have their centre outside the box/.test(across.out), across.out);
  sure(/FAIL: build: -o <out\.map>/.test(runRefused(BIN, "build", TWOROOMS_MAP, "--zone", west).out), "no -o");
});
