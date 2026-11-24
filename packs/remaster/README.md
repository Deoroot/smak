# packs/remaster

A shipped map remastered by zones: each zone a box and a script that only changes what its box holds, merged in one
build and checked. The guide is docs/MAPS-REMASTER.md.

```
node packs/remaster/bin.mjs build <shipped.map> --zone <folder|zone.mjs> ... -o <out.map> [--wad <name>] [--k 1]
node packs/remaster/bin.mjs pick <map> --zone <folder|zone.mjs> --eye x,y,z [--yaw 0] [--pitch 0] [--fov 96.5] [--aspect 0.5625]
```

| File | What |
| --- | --- |
| `remaster.mjs` | `applyZones` (the zones applied and held to their boxes), `sharedWad` (their textures in one .wad), `pickFaces` (what an eye sees, and whether the zone owns it) |
| `bin.mjs` | the two commands, each ending PASS or FAIL |

Tested on the kit's two rooms (test/211-pack-remaster.mjs) and on the Hive remaster: its 22 zones rebuilt by `build`
give the .map and the shared .wad of the build that went to the game, byte for byte.
