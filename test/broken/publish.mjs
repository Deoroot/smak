// A folder about to be shared, broken in one way each against publishCheck: a file of the game's copied
// along, one of the game's textures inside a .wad of one's own, a path into the person's own folder, a token.
// The game is a small one made here: a .wad of one texture and a sound.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publishCheck } from "../../check/publish.mjs";
import { writeWad } from "../../core/maps/wad.mjs";
import { tmp } from "../helper.mjs";
import { broken } from "./case.mjs";

const root = join(tmp, "broken-publish");
const game = join(root, "Half-Life");
mkdirSync(join(game, "valve", "sound"), { recursive: true });
/** A texture of 16 by 16 whose pixels and palette are its own, by a seed. */
const texture = (name, seed) => ({
  ...{ name, width: 16, height: 16 },
  pixels: new Uint8Array(256).map((_, i) => (i * seed) % 256),
  palette: new Uint8Array(768).map((_, i) => (i * seed + 7) % 256),
});
writeFileSync(join(game, "valve", "halflife.wad"), writeWad([texture("CRATE1", 3)]));
writeFileSync(join(game, "valve", "sound", "door.wav"), Buffer.alloc(2000, 9));
const HOME = join(root, "home", "someone");

/** The folder to share, whole: a readme, a map's own .wad of its own texture; then the one defect put in. */
let made = 0;
const folderWith = (defect) => {
  const folder = join(root, `share${made++}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "readme.txt"), "A small map for Half-Life: put mymap.bsp in valve/maps.\n");
  writeFileSync(join(folder, "mymap.wad"), writeWad([texture("MINE", 5)]));
  defect?.(folder);
  return publishCheck(folder, { game, home: HOME }).errors;
};
const whole = () => folderWith();

broken("publishCheck", "a sound of the game's copied along", {
  said: /^sound\/door\.wav is valve\/sound\/door\.wav of the game's folder, byte for byte/,
  broken: () => folderWith((folder) => cpSync(join(game, "valve", "sound"), join(folder, "sound"), { recursive: true })), // prettier-ignore
  whole,
});
broken("publishCheck", "one of the game's textures inside the map's own .wad", {
  said: /^mymap\.wad holds 1 of the game's textures: valve\/halflife\.wad's CRATE1\./,
  broken: () => folderWith((folder) => writeFileSync(join(folder, "mymap.wad"), writeWad([texture("MINE", 5), { ...texture("MYCRATE", 3) }]))), // prettier-ignore
  whole,
});
broken("publishCheck", "a path into the person's own folder in a text", {
  said: /^notes\.txt names a folder of the person's own: /,
  broken: () => folderWith((folder) => writeFileSync(join(folder, "notes.txt"), `built from ${join(HOME, "maps", "mymap.map")}\n`)), // prettier-ignore
  whole,
});
broken("publishCheck", "a GitHub token left in a file", {
  said: /^deploy\.cfg holds what looks like a GitHub token/,
  broken: () => folderWith((folder) => writeFileSync(join(folder, "deploy.cfg"), `token "ghp_${"a1B2".repeat(9)}"\n`)), // prettier-ignore
  whole,
});
