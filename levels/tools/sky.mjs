#!/usr/bin/env node
// sky: New Byzantium's sky, rendered by us (PLAN.md "Form, scale and the art kit"; notes-megastructure.md 7.1). A
// procedural megacity under a toxic red storm, seen from an L3 street (megablocks rising past the eye into the storm,
// giant frames of the mega-structure, decks, fires, searchlights, rain, the orbital skylift's line), built from a
// seed in Blender (levels/tools/sky-megacity.py, Eevee) and rendered from the city's eye as GoldSrc's six faces.
//
//   node levels/tools/sky.mjs --out <folder> [--name nbstorm] [--seed 1] [--render 1024] [--ship 1024,512,256]
//                             [--samples 32] [--eye 41] [--density 1] [--quick] [--keep] [--blender <program>]
//
//   --out      where everything goes (outside the repository: the renders are megabytes)
//   --name     the worldspawn's skyname: files <size>/<name>{rt,lf,bk,ft,up,dn}.tga
//   --render   the size Blender renders; --ship the sizes written, each the render shrunk by block means
//   --samples  Eevee's samples a pixel; --eye the camera's height (metres); --density the city's count, x1
//   --quick    256 pixels, 8 samples, half the city: for looking while tuning
//   --keep     keep Blender's PNG renders (renders/face_<suffix>.png)
//
// Writes <out>/<size>/<name><suffix>.tga, <out>/<name>-cross.png (the faces unfolded: rt ft lf bk in a row, up
// over rt, dn under it), <out>/<name>-panorama.png (equirectangular, +x in the middle) and <out>/sky.json (the
// options, the city's counts, seconds, the seam check). The faces' orientation is the engine's own table
// (src/maps/sky.mjs, `wayOfSide`). Exit code 0 when written, 1 on a failure, 2 on wrong arguments.
import { parseSkyArgs, renderSky } from "../lib/sky-megacity.mjs";

const usage =
  "usage: sky --out <folder> [--name nbstorm] [--seed 1] [--render 1024] [--ship 1024,512,256] [--samples 32] [--eye 41] [--density 1] [--quick] [--keep] [--blender <program>]";
const parsed = parseSkyArgs(process.argv.slice(2));
if (parsed.help) {
  console.log(usage);
  process.exit(0);
}
if (parsed.error) {
  console.error(`sky: ${parsed.error}\n${usage}`);
  process.exit(2);
}
try {
  const report = renderSky(parsed.options);
  const s = report.seams;
  console.log(`sky ${report.name}, seed ${report.seed}: ${report.city.towers} towers, ${report.city.frames} frames, ${report.city.fires} fires, ${report.city.beams} beams`);
  console.log(`rendered ${report.render} px in ${report.seconds.blender.toFixed(1)} s (total ${report.seconds.total.toFixed(1)} s), Blender ${report.blender}`);
  console.log(`seams: ${s.ok ? "none" : "SEAMS"}: mean step across an edge ${s.across.toFixed(2)}, to the next pixel in ${s.beside.toFixed(2)} (ratio ${s.ratio.toFixed(2)}, under 1.5 is no seam)`);
  console.log(`files: ${report.files.length} Targa in ${parsed.options.out}`);
  console.log(`cross: ${report.cross}\npanorama: ${report.panorama}`);
} catch (e) {
  console.error(`sky: ${e.message}`);
  process.exit(1);
}
