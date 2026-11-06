# The kit's own small map

Everything in this folder was made for SMAK's self-test. It is ours: no game's map, brush, or texture is in it,
and it may go wherever the kit goes.

| File | What it is |
| --- | --- |
| `tworooms.map` | The brush source: two rooms, 192 x 192 x 128 units each, joined by a corridor that both open on through a doorway 64 wide and 96 high. Neither room can see the other. Room A (the one at low `y`) holds the `info_player_start` and a `light`; the corridor holds a second `light`; the doorway of room C holds a `func_wall`, a thin grate, which is the map's model `*1`. |
| `tworooms.wad` | Its three textures: `smakwall` (64 x 64), `smakfloor` (32 x 32) and `{smakgrate` (32 x 32, with holes). |
| `tworooms.bsp` | The map compiled, with the textures' pixels inside it (26 KB). |
| `tworooms-wants-wad.bsp` | The same map compiled without them: it names its textures and wants them from `tworooms.wad` (16 KB). |
| `smakgame.fgd`, `smakbase.fgd` | The entity definitions of a made-up game of the kit's own, written by hand for the cases of `24-maps-mods.mjs`: starts, beasts that come out of dens, gates to other maps, things to pick up, and the classes the two rooms use. The first includes the second, under a name in other capitals. No game's FGD is in them. |
| `street-01-below.json` | A small level below the site `levels/specs/street-01.json`, for `158-assembly-site.mjs` and the broken cases of `checkBelow`: the street's main with its channel, a hall, a spur and a stair's foot, three ways down. Hand-written; nothing of any game's in it. |

## How it was made

1. **The textures** are drawn by code, in `test/fixture-maptextures.mjs`, and written with the kit's own
   `writeWad`. The self-test writes them again on every run and compares the result with `tworooms.wad`,
   byte for byte.
2. **The `.map`** was written once by a script, with a generator of the owner's from another project (not part
   of the kit) that carves rooms out of a solid block, so that the map cannot leak. It is plain text in the
   Valve 220 form and can be opened in an editor (J.A.C.K., TrenchBroom) or changed by hand.
3. **The two `.bsp`** were compiled with VHLT (`hlcsg`, `hlbsp`, `hlvis`, `hlrad`; "ZHLT v3.4 VL34, Aug 17
   2015", 64 bit), which is not part of the kit either.

## Rebuilding

Only needed when the `.map` or the textures change. In an empty working folder that holds a copy of
`tworooms.map` and `tworooms.wad`, with VHLT's folder on the path:

```
hlcsg_x64 -wadinclude tworooms tworooms
hlbsp_x64 tworooms
hlvis_x64 -full tworooms
hlrad_x64 tworooms
```

That gives `tworooms.bsp`. For `tworooms-wants-wad.bsp`, do the same in a second folder with the `.map` copied
as `tworooms-wants-wad.map`, and leave `-wadinclude tworooms` out of the first line. A line of the tools'
output that says `error`, `leak` or `no visibility` means the map did not compile right, whatever the exit
code. Copy the two `.bsp` back here and run `node test/selftest.mjs`: the cases in `20-maps-read.mjs` hold the
map's counts (faces, leaves, light) and will say which changed. Another version of the compilers can cut the
world differently and give other counts: then the numbers in those cases are what must change, not the kit.

The `.map`'s `wad` key is the bare file name, so no path of the machine it was compiled on is inside the
maps.
