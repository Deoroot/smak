// A sprite file written is the file read: a group and a single frame, and Half-Life's own where the game is there,
// byte for byte (make/sprite/spr.mjs writes it, make/maps/sprites.mjs reads it).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeSpr } from "../make/sprite/spr.mjs";
import * as smak from "../src/index.mjs";
import { test, sure } from "./helper.mjs";

test("a sprite file written is the file read: Half-Life's own, where the game is there, byte for byte", () => {
  // a group and a single frame, written and read back
  const frame = (v) => ({ left: -4, up: 4, width: 8, height: 8, pixels: new Uint8Array(64).fill(v) });
  const bytes = writeSpr({ type: "oriented", format: "alpha test", palette: new Uint8Array(768).fill(7), frames: [frame(1), frame(2), frame(3)], groups: [{ first: 1, count: 2, ends: [0.1, 0.25] }] }); // prettier-ignore
  const back = smak.maps.readSpr(bytes);
  sure(back.type === "oriented" && back.frames.length === 3 && back.groups[0].count === 2 && Math.abs(back.groups[0].ends[1] - 0.25) < 1e-6 && Buffer.compare(writeSpr(back), bytes) === 0, JSON.stringify(back.groups)); // prettier-ignore
  const game = [process.env.SMAK_HALF_LIFE, join(homedir(), ".steam/steam/steamapps/common/Half-Life"), "C:/Program Files (x86)/Steam/steamapps/common/Half-Life"]
    .filter(Boolean)
    .map((folder) => join(folder, "valve", "sprites"))
    .find((folder) => existsSync(folder)); // prettier-ignore
  if (!game) return;
  const files = readdirSync(game).filter((f) => f.endsWith(".spr"));
  const differ = files.filter((f) => Buffer.compare(writeSpr(smak.maps.readSpr(readFileSync(join(game, f)))), readFileSync(join(game, f))) !== 0); // prettier-ignore
  sure(files.length && !differ.length, `${differ.length} of ${files.length} differ: ${differ.slice(0, 5)}`);
});
