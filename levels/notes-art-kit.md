# New Byzantium's art kit: what exists, what fits, what must be made

A read-only survey, 2026-11-02, for the textures, models, sprites and sky of New Byzantium (`levels/specs/newbyzantium.json`).
**Names, sizes and counts only.** No pixel, mesh or sound was copied; the WADs were read for their directory (name,
type, width x height, bytes) and nothing else; the models for their file name and size. A texture made by someone
else may be referenced by name in our `.map` when the players already have its WAD; it is never copied into our WAD
or embedded in our BSP.

Sources read:
- the generator's latest Core run (`06-palette.json`, `08-dressing.json` of the `final3` run, tile `c1_r1`, seed 1);
  the description and `levels/specs/CITY.md`; `levels/notes-h9.md`, `levels/notes-rp-city.md`; `PLAN.md` (Why, Phase 5);
- the H9 repository (`havoc-nine-src`, untrusted: nothing run or imported). Its sparse checkout holds no WAD or model;
  the git tree (`ls-tree`, 20,885 entries) lists them with their sizes, and the WAD blobs were read from the object
  store into a scratch folder for their directories. Models are Git LFS pointers: their real sizes come from the
  pointer. Docs read: `H9XASH/valve/REPLACEMENTS.md`, `docs/GAME_MODES.txt`, `docs/CLASSES.txt`;
- the delivered generator `h9_tsrp_newbyzantium` (untrusted, read only): `wads/majestic.wad` (directory), the texture
  lump of `out/h9_tsrp_newbyzantium.bsp` (names, sizes, embedded or not), `out/compile-v9.log` (the `-wadinclude`
  list), `out/h9_tsrp_newbyzantium.res`, `sky.mjs` (its header comment) and `out/sky/h9byz-panorama.png` (looked at);
- installed games: TS `C:/Juegos/TS30-clean` (`specialists.wad`, `decals.wad`, `models/`, `sprites/`, `gfx/env/`),
  Half-Life `C:/Juegos/Steam/steamapps/common/Half-Life/valve` (`halflife.wad`, `liquids.wad`, `xeno.wad`,
  `decals.wad`, `gfx/env/`).

The lister (a WAD2/WAD3 directory reader, 30 lines, and a BSP texture-lump reader) lives in the session's scratch
folder, not in the repository.

Short names used below:

| short | WAD | where it lives | on a TS client | on an H9 client | textures | bytes |
|---|---|---|---|---|---|---|
| TS | `specialists.wad` | TS `ts/` (H9 ships the same file, same MD5) | yes | yes | 116 | 6,774,156 |
| DEC | `decals.wad` | TS `ts/` (H9 ships the same file, same MD5) | yes | yes | 244 | 1,216,768 |
| AX | `alexandria_msr_b4v3_generated.wad` | H9 `ts/maps/` (b5's `alexandria_msr_b5_dc.wad` is the same less `sky`) | no | yes | 595 | 16,173,812 |
| XC | `xenoncity_true_b3v2_generated.wad` | H9 `ts/maps/` | no | yes | 83 | 2,922,664 |
| MR | `meridian.wad` | H9 `ts/` (the `mr_*` set of `h9_te_meridian`) | no | yes | 51 | 844,776 |
| H9HL | `halflife.wad` (H9's replacement) | H9 `valve/` | - | yes | 36 | 323,816 |
| MJ | `majestic.wad` (Randy Reddig, scmapdb) | only the NB generator's `wads/` | no | **no** | 25 | 978,552 |
| EMB | `avp2`, `cyberdynamics`, `paradise_missing`, `io_v1`, `submerged`, `techno` | the author's own disk; their textures exist only embedded in the old NB BSP | no | **no** | - | - |
| HL | Valve's `halflife.wad` | Steam Half-Life `valve/` | only if Half-Life is owned | **not shipped** | 3,116 | 37,914,096 |

---

## 1. What the players have, and the three surprises

- **An H9 client has no Valve `halflife.wad`.** H9's `valve/` folder "is not Half-Life's" (`REPLACEMENTS.md`): its
  `halflife.wad` holds 36 entries, the tool textures (`clip`, `aaatrigger`, `sky`, `{invisible`, `black`, `white`,
  `{blue`) and the 29 drawn textures TS's own maps use, all repainted for H9. Valve's 3,116 are there only for a
  player who owns Half-Life. **So nothing from Valve's `halflife.wad`, `liquids.wad`, `xeno.wad` or `decals.wad` may
  be counted on.** TS's `decals.wad` (244, Valve's 222 plus TS's own blood, splats and `{case`) is on every client.
- **The MSR's look is not on the clients.** The nine `MJST*` textures the description names for `msr-*` (514 of the
  Core tile's 1,391 role uses) come from `majestic.wad`, which H9 does not ship; the old New Byzantium embedded it
  with `-wadinclude` (its compile log: `majestic`, `avp2`, `cyberdynamics`, `paradise_missing`, `io_v1`, `submerged`,
  `techno`, 166 textures, 6.77 MB of mip data in the BSP). Referencing it means either H9 ships the WAD or we embed
  a third party's work whose licence is not recorded. The MSR set is the first thing to make (section 6).
- **Three names point at nothing.** `asphalt04` is in no WAD here and not in the old BSP's 163 textures; `{xc_sign1`
  and `{PC_sign1` are placeholders (the real families are `{xc_guns`, `{xc_gear`, ... in XC and `{PC_BANK`,
  `{PC_PAWNPRAWN`, ... embedded only). Eleven more named textures (`cd_wooddoor`, `garage03`, `o_mtldoor3`,
  `cd_sign_cafe`, `cds_tilefwhite`, `cds_tilefgray`, `cds_labdoor1`, `cds_wooddoor1`, `mo_rustwall1`, `gratefloor`,
  `mo_mtldoor1`) exist only embedded in the old BSP: their WADs (EMB) are on no client. Of the 13 materials these
  14 names serve, 7 have an on-client texture of the same kind and 6 only a stand-in (table, section 3).

The other 37 named materials have their named textures in TS, AX, XC or MR, all on an H9 client. AX and XC are the source cities' "generated" WADs: they gather textures from many origins
(names of Half-Life's, Counter-Strike's and other games' families sit beside the `sin*`, `po_*`, `cd*` sets), which is
one more reason to reference them by name and never embed them.

## 2. What H9 ships that fits the setting

**Textures** (names only, by family; sizes in texels):
- *Regal, L3* (AX): marble `marb`, `cd_mrbblack`, `sinmarblewall` 256, `sinwall32`; gold `singold` 512, `sintrim`,
  `sinceiling3` 256; floors `sinpalacefloor`, `sintilesfloor`, `sinwoodenfloor2/5`, `WOODFLOOR02_256`; wood
  `sinfinewood`, `sinwoodwallluxu`; rugs `sinrug`, `sinrug2`; pictures `ax_picture1/3/4/5`, `sinjappaint`, `hopaint2/3`.
  XC adds `marb062`, `hMarb_surfaced3` (160x128).
- *The MSR* (AX): `{ax_msr` 256x256 masked (by its name Alexandria MSR's mark), `{ax_detfac`, the six-frame
  animated `+0..+5purpledn` (64), the `dgrey1..9`/`dgreybase`/`dtan1..9`/`dsupport` panel sets, `wallvault1/1b/2`,
  `vaultfloor`, `stec_panel3/5/5b`, `armory11`, `{grate1`, `{grate2`, `{cxgate`, `{tension4`. MR adds `{mr_bars`
  (64x128), `mr_vaultdoor`, `mr_steel`, `mr_column`, `mr_ashlar`, `mr_stone`, `mr_bronze`, `mr_brass`.
- *Industrial, L2* (AX): `metal5` 256, `metaldoor*dn` (12), `gryrst04`, `gryrst6b`, `gryrstdr(1)`, `vbRustTrim`,
  `mtl8_cargo_door`, `mtl12_ggrate`, `cds_hexgrate`, `grate4`, `mtl7-grate`, `{gratestep2/3`, `wm_*` (30), `ob_*` (13),
  `epi_pipe00`, `pipe_st1`, `wm_pipes`, `ceilingpipec`, `ribbed_wall`, `greywall1..3`, `grey_creteflr(2)`,
  `po_concretwall`, `{pkf_fence1/2a/2c`, `{po_rustygrtsm`, `{grid1`; XC `{CA_Girder` (256x64 masked girder),
  `e6basegrate`, `e6bmetal(2)`, `cyberwall1..6`, `cyberfloor`, `cyberbar`; TS `bigcrete2`, `crete22..42a`,
  `concrete2`, `metal_rusty5ccc/eee`, `pipes1a`, `fact`, `masphalt..6`, `asfa1..6`, `parking`, `pavement`.
- *Undercity, L1* (AX): `po_sewerwall`, `po_sewerfloor`, `po_subtrash`, `po_slasphalblgr`, `po_rustmetalblu`,
  `singhettofloor`, `singhettowallwo`, `{po_laddrust`, `{po_ventfrrst`, `+0..5po_subvent`; liquids `!gwater3`,
  `!water1`, `!seawater`, `scrolltoxic`, `scrollgwater3`, `!fog`; TS `crapwood1c`, `rustic1`, `bricks`, `brickx2`.
- *Rain*: AX `+0..7animrain` (128, eight frames) and `+0..5rain1` (64, six frames): animated rain sheets for glass
  or open faces.
- *Signs and lettering*: XC `{xc_cp1/2`, `{xc_guns`, `{xc_gear`, `{xc_skybar`, `{xc_uncle`, `{xc_enjoy`,
  `{xc_credits`, `{xc_level1..3`, `{xc_xc`, `{dragon`, `{grafitti2/3`, `get_work`; AX `sign_*` (12: coffee, cocktails,
  ribs, steakhouse, open, ...), `jap_sign*` (5), `hb_sign_028`, `alexandriasigns`, `logo_*` (5, film-company names:
  not for us); MR `~mr_sign`, `~mr_hotel`, `~mr_cafe`, `~mr_exit`, `~mr_poster`, `mr_s_*` (7 plaques). DEC has a
  full stencil alphabet `{capsa..z` (16), digits `{small#s0..9` (16), `{med#s0..9` (32), `{large#s0..9` (48x96),
  road marks `{pstripe1..4`, `{stripeh/v`, `{arrow*`, `{turn*`, and grime `{rust001..4`, `{moss001..4`,
  `{lime001..4`, `{oil1/2`, `{drip*`, `{water1..3`, `{crack1..4`, `{scorch1..3`, `{graf001..005`.

**Models** (on H9 clients; about 230 of the 283 non-weapon, non-player ones are also in TS's own `models/`; sizes are the
LFS pointers'): statues `h9/statue.mdl` (252 KB), `NeoB_jagd_statue(_sm)` (89 KB), `sg_cstatue` (163 KB),
`3dm_statue` (21 KB), `chateau_shield` (67 KB); lamps `schmung/sg_streetlamp` (75 KB), `CLANKILL3R/GPC_Streetlight`
(33 KB), `chateau_lamp` (69 KB), `sg_clight_*` (11 KB); industry `h9/kotel` (a boiler, 104 KB), `h9/d3_maincontrol`
(151 KB), `CLANKILL3R/GPC_FORK` (a forklift, 366 KB), `GPC_PALLET(S)` (21 KB), `GPC_STEEKWAGEN` (pallet truck, 39 KB),
`hammertime/cg_pvcmain1/2`, `cg_pvcjoint1..3` (pipe runs, 7-42 KB), `cg_box01..03`, `cg_bucket01`, `cg_drill`,
`cg_radio01`, `alex-hlru/f3_crate` (281 KB), `propanegibs`; litter `h9/qk_trash`, `GPC_Envtrash2` (184 KB each),
`h9/re_dirt` (81 KB), `xen/xen_trashcanb` (134 KB); vehicles `bido_huey` (a helicopter, 485 KB), `GPC_XT_CAR1/2`,
`GPC_BMW` (~266 KB), `3dm_fastcar` (77 KB); rooms `mecklenburg/toilette` (45 KB), `GPC_flo_toilet` (262 KB),
`GPC_flo_becken` (a basin, 42 KB), `mecklenburg/refr2`, `simivalley/furniture/bed1/2`, `alex-hlru/bookcase`,
`cc_pr_LibBookShelf_1`, `d3_conf_table`, `s_leather_chair`, `h9/couch_leather-black`, `h9/barstool`, `cafe_bar1`;
plants and trees (`rdm_unplant*`, `sg_plant`, `3dm_plant01/02`, `xen_plant*` up to 726 KB, `h9/cemtree1/2` 304-588 KB).
The game-mode models (`tsm_uplink`, `tsm_turret_*`) are not props. The players' own MSR and Insurgent models are
named in `docs/CLASSES.txt` (`RepuHeavy*`, `RepuTengu`; `XCCP*`, `ins_proletarian`, `ins_medic_*`).

**Sprites**: H9's `h9_drain_fog`, `h9_drain_rain`, `h9_drain_splash`, `h9_lift_haze` (made by H9's own scripts),
TS's `rain_splash`, `rainsplash`, `taxi_rain`, `drop`, `black_smoke1`, `xsmoke1`, `glow01`, `WN_glow02..04`,
`redfl1`, `yelflare1`, `sparks`, `wires/*`. Rain, haze and smoke are covered.

**Skies** (`gfx/env`, six 256x256 TGA sides, 196,652 bytes each): H9 `h9byz` (the old New Byzantium's, painted by
`sky.mjs`: near-black navy, green-violet horizon glow, black ruined skyline, searchlights; looked at: green, not the
toxic red storm), `h9drain`, `h9lift`, `neuro`; TS `city1`, `tsccity_`, `LMcity_1`, `danight`, `g_night`, `deadlock`,
`construct_` and nine more. Half-Life's `city`, `night`, `dusk` are not on H9 clients.

**Our sky, made (2026-11-02): `levels/tools/sky.mjs`.** The red storm sky is rendered, not painted and not from an
HDRI: a procedural megacity from a seed in Blender (`levels/tools/sky-megacity.py`, Eevee). The eye stands in an
L3 street (41 m); round the playable city stand megablocks 400 m to kilometres tall (boxes, chamfered, octagonal
and round towers with setbacks, slabs, bridges between them), the near ones dark and rising out of the side faces
into the storm, lit walls of windows behind, haze beyond; colossal slabs and trusses cross overhead; open avenues
show the burning middle distance and, down one, the skylift's anchor and cable. A street haze, a height fog and
the storm's base (1,700 m, above which the city is lost) are in every material. Six faces turned by the engine's
table (`src/maps/sky.mjs`, `wayOfSide`), written as Targa at 1,024, 512 and 256 with a seam check, a cross sheet
and a panorama. About 10 s for Blender at 1,024; the same bytes every run. Outputs go outside the repository:

    node levels/tools/sky.mjs --out <folder> [--name nbstorm] [--seed 1] [--quick] [--keep]

It replaces the "CC0 stormy HDRI" row below (the toxic sky) as the plan. To verify on H9's Xash: the size taken
(512) and each face's turn, by the labelled test sky (notes-megastructure.md 7).

**H9's own sides and colours.** H9's game modes already set MSR against the Insurgents, with MSR **blue** and the
Insurgents **red** on rings, flags and silhouettes (`GAME_MODES.txt`, `COMMANDS.txt`), MSR anthems in its sounds, and
banner and flag sprites (`tsm_banner`, `tsm_zone_flag`). The regime's purple-and-gold in our description differs from
that blue (open question 2).

---

## 3. Coverage of the description's 110 materials

The description has **110 materials**, 55 with texture names and 55 without; the Core tile uses 62 of them (1,391
role uses in `06-palette.json`), 30 of those with no name (`rolesWithoutTextures`). Each is judged against what is on
an H9 client:

| | covered | stand-in | must make |
|---|---|---|---|
| all 110 materials | 61 | 39 | 10 |
| the 55 named | 43 | 12 | 0 |
| the 55 unnamed | 18 | 27 | 10 |
| the Core tile's 30 roles with no name | 8 | 15 | 7 |
| the Core tile's 1,391 role uses | 569 | 732 (514 of them `msr-*`) | 90 |

"Covered": a texture of that look is on every H9 client (sometimes under another name than the description's, which
the description should take). "Stand-in": something on the client will do until the kit exists, or the named
texture is not on the clients. "Make": nothing close. The "new" column counts the textures section 7 plans for it
(43 in all). `*` marks the Core tile's 30 roles with no texture.

| material | named | Core uses | status | new | on-client texture (WAD) and note |
|---|---|---|---|---|---|
| marble-dark-floor | yes | 8 | covered |  | `marb` AX, `marb062` XC |
| marble-wall-dark | yes | 18 | covered |  | `sinmarblewall` AX |
| marble-wall-pale | yes | 3 | covered |  | `sinwall32` AX |
| gold-trim | yes | 13 | covered |  | `sintrim` AX; `singold` AX is 512x512 (349 KB, the largest texture named) |
| gold-ceiling | yes | 1 | covered |  | `sinceiling3` AX |
| stone-gold-pillar | - | 61* | **make** | 2 | hero (the city's thread); stand-in `mr_column` MR (plain); nothing has gold bands |
| palace-floor | yes |  | covered |  | `sinpalacefloor` AX, `hMarb_surfaced3` XC |
| wood-dark-lux | yes |  | covered |  | `wooddark` TS, `sinfinewood`, `sinwoodwallluxu` AX |
| tile-lux-floor | yes | 1 | covered |  | `sintilesfloor` AX |
| ceiling-lux-panel | yes |  | covered |  | `fap-ceiling03` AX |
| lux-door | yes | 18 | stand-in | 1 | `cd_wooddoor` not on clients (EMB); stand-ins `wood8dn`, `home7dn` AX, `mr_walnut` MR |
| glass-lux | - | 2* | stand-in | 1 | `glass_dark`, `cd_glass1` AX |
| regal-window | - | 15* | **make** | 2 | hero (L3 facades): arched, gold mullions, purple glass; nothing close |
| stucco-ochre | - | 1* | stand-in | 1 | `stucco` TS (128x80), `mr_plaster` MR |
| wood-panel-red | - | 2* | stand-in | 1 | `mr_panel` MR, `cd_woodwall` AX (not red) |
| parquet-dark | yes | 1 | covered |  | `sinwoodenfloor5`, `WOODFLOOR02_256` AX |
| cement-polished | - | 2* | **make** | 1 | the gold inlay lines are the point; stand-in `concrete2` TS |
| cement-polished-floor | - | 1* | stand-in | 1 | `concrete2`, `crete33` TS |
| slit-window | - | 5* | stand-in |  | `glass_dark` AX in a narrow frame |
| sign-brass | - |  | stand-in |  | `mr_brass` and the `mr_s_*` plaques MR (bank words); a plaque per building is counted under signs |
| msr-wall | yes | 118 | stand-in | 3 | `MJSTWALL04/09/10` MJ: not on clients (embedded only), licence not recorded; on-client stand-ins `dgrey*`, `wallvault2`, `stec_panel5b` AX |
| msr-floor | yes | 111 | stand-in | 2 | `MJSTFLOOR01/02` MJ (as msr-wall); stand-in `cd_mrbblack` AX |
| msr-flat | yes | 123 | stand-in | 2 | `MJSTFLAT01/03` MJ; stand-in `dgreybase` AX |
| msr-trim | yes | 86 | stand-in | 1 | `MJSTTRIM01` MJ; stand-in `sintrim` AX |
| msr-door | yes | 76 | stand-in | 2 | `MJSTDOOR02` MJ; stand-in `metaldoor14dn` AX |
| cell-floor | yes | 20 | covered |  | `vaultfloor` AX |
| cell-wall | yes | 20 | covered |  | `stec_panel3` AX |
| cell-grate | yes | 20 | stand-in | 1 | hero; `{grate1` AX (96x64, a flat grille); `{mr_bars` MR (64x128) reads as bars; see section 5 |
| portcullis | yes | 5 | covered |  | `{grate2` AX |
| sign-msr | - | 3* | **make** |  | hero; `{ax_msr` AX (256x256, by its name the MSR mark of Alexandria) as stand-in; eagle, banners, posters counted in section 6 |
| cement-rough | yes |  | covered |  | `bigcrete2` TS |
| pavement-slab | yes |  | covered |  | `Pavement001` TS/AX |
| cement-rough-ceiling | - |  | stand-in |  | `crete3_ceil03c`, `RD_CEILING01` AX, `crete36` TS |
| steel-rail | - |  | covered |  | `{rail1b`, `chromebar`, `{pkf_fence1` AX |
| shutter-steel | yes |  | covered |  | `garage03` EMB only; `mr_shutter` MR (128x128) is a rolling shutter on clients |
| storage-door | yes |  | covered |  | `o_mtldoor3` EMB only; `metaldoor14dn`, `metaldoor18dn` AX |
| grille-window | - |  | covered |  | `{po_rustygrtsm`, `{grid1`, `{pkf_fence2a` AX |
| sign-stencil | - |  | stand-in | 1 | decals `{capsa..z`, `{large#s0..9` DEC; `danger`, `cautions`, `nuclearsign` TS |
| cyber-wall-panel | yes | 39 | covered |  | `cyberwall2/3` XC |
| tile-plain-wall | - | 2* | stand-in |  | `tilez1`, `tilez2` TS, `kit_white2` AX |
| tile-plain-floor | yes | 34 | covered |  | `sintilesplain` AX |
| cyber-floor | yes |  | covered |  | `cyberfloor` XC |
| canopy-cloth | - | 1* | stand-in | 1 | `mr_awning` MR (64x64) |
| cyber-ceiling | - | 31* | covered |  | `flr_panel02`, `d_drkmtl_mpanel` XC |
| cyber-trim-bar | yes | 37 | covered |  | `cyberbar` XC |
| brass-rail | - | 2* | covered |  | `mr_brass`, `mr_brassv` MR |
| shop-shutter | - | 18* | stand-in | 2 | `mr_shutter` MR unpainted; painted shutters to make |
| shopfront-glass | - | 6* | covered |  | `~mr_shopwin` MR (128x128, lit) |
| sign-neon-xc | yes |  | stand-in |  | `{xc_sign1` exists nowhere (a placeholder); the family on clients is `{xc_guns`, `{xc_gear`, `{xc_skybar`, `{xc_uncle`, `{xc_enjoy`, `{xc_credits`, `{xc_cp1/2`, `{xc_level1..3` XC |
| sign-painted | yes | 3 | stand-in |  | `cd_sign_cafe` EMB only; on clients `sign_coffee1/2`, `sign_cocktails`, `sign_ribs`, `sign_steakhouse`, `sign_open`, `jap_sign*`, `hb_sign_028` AX |
| brick-red | yes |  | covered |  | `sinbrickwall` AX |
| concrete-panel | yes |  | covered |  | `po_concretwall` AX |
| concrete-floor-worn | - |  | covered |  | `crete28`, `h_concrete4`, `dusty1` TS |
| pipe-ceiling | yes |  | covered |  | `ceilingpipec` AX |
| stair-metal-rail | - |  | covered |  | `{rail1b`, `chromebar` AX |
| home-door | yes | 45 | covered |  | `homedoor1dn` AX |
| poor-door | yes | 31 | covered |  | `door006` TS |
| tenement-window | - |  | stand-in | 1 | `windows001`, `window006` TS |
| sign-house-number | - |  | covered |  | decals `{small#s0..9`, `{med#s0..9`, `{large#s0..9` DEC on a plate |
| plaster-warm | - | 16* | covered |  | `plaster1` TS, `mr_plaster` MR |
| brick-yellow | yes | 49 | covered |  | `howall3b` AX |
| clinic-wall-white | yes | 6 | covered |  | `wht_wall1` AX |
| wood-floor-plain | - | 47* | covered |  | `wood2`, `wood21`, `floor002` TS, `sinwoodenfloor2` AX |
| clinic-tile-white | yes | 4 | stand-in |  | `cds_tilef*` EMB only; `cds_whitepad1..3`, `cd_white` AX |
| plaster-ceiling | - | 42* | covered |  | `plaster1` TS, `RD_CEILING01` AX |
| clinic-ceiling | - | 4* | covered |  | `cd_ceilpad` AX |
| stone-pillar-plain | - | 65* | stand-in |  | `mr_column` MR, `granite1`, `stonewall1` TS |
| clinic-door | yes | 3 | covered |  | `cds_labdoor1` EMB only; `cds_whitedoor` AX |
| sash-window | - | 19* | stand-in | 1 | `window006`, `windows001` TS |
| rust-metal-wall | yes |  | covered |  | `mo_rustwall1` EMB only; `metal_rusty5ccc/eee` TS, `gryrst04` AX |
| concrete-grey | - |  | covered |  | `greywall1..3` AX |
| concrete-grey-floor | yes |  | covered |  | `grey_creteflr2` AX |
| grate-floor | yes |  | covered |  | `gratefloor` EMB only; `mtl12_ggrate`, `cds_hexgrate`, `grate4` AX |
| steel-beam | yes |  | covered |  | `metal5` AX |
| workshop-door | yes |  | covered |  | `metaldoor2dn` AX |
| factory-window | - |  | stand-in | 1 | `{grid1` AX over `glass_dark`; wired glass to make |
| club-panel-dark | - |  | stand-in |  | `club_metal` AX, `dk_wall1` XC |
| neon-tile-wall | - | 1* | **make** | 2 | glossy tile lit pink/cyan; nothing |
| terrazzo-floor | - | 1* | **make** | 1 | nothing; ambientCG has terrazzo sets |
| wood-floor-dark-worn | - |  | covered |  | `sinwoodenfloor2` AX, `crapwood1c` TS |
| club-ceiling | - | 1* | stand-in |  | `black` (AX and H9 halflife.wad), `dgreybase` AX |
| neon-strip | - |  | stand-in | 2 | `~light3a..f`, `+0_cd_light0` AX (white and blue strips); pink and cyan to make |
| bar-door | yes |  | stand-in | 1 | `cds_wooddoor1` EMB only; `booth_wood_1`, `cd_wood` AX |
| stained-glass-bar | - |  | **make** | 1 | `ax_glassorienta` AX by name only; to make |
| sign-neon-pc | yes |  | stand-in |  | `{PC_sign1` exists nowhere; the `{PC_*` family is EMB only (paradise_missing is not on clients); stand-in the `{xc_*` family |
| sewer-wall | yes | 22 | covered |  | `po_sewerwall` AX |
| brick-black-damp | - | 17* | stand-in | 1 | `bricks`, `brickx2` TS (not black, not wet) |
| sewer-floor | yes | 8 | covered |  | `po_sewerfloor` AX |
| plank-floor-rotten | yes | 4 | covered |  | `singhettofloor` AX |
| sewer-vault | - | 10* | stand-in | 1 | `po_sewerwall` AX reused |
| pipe-rust | - | 36* | covered |  | `epi_pipe00`, `pipe_st1`, `wm_pipes`, `trk_pipe` AX, `pipes1a` TS |
| slum-door | yes |  | covered |  | `mo_mtldoor1` EMB only; `gryrstdr`, `gryrstdr1` AX |
| boarded-window | - | 27* | stand-in | 1 | `crapwood1c`, `wood3b` TS (planks, no frame) |
| sign-scrawl | - | 2* | stand-in |  | decals `{graf001..005` DEC, `{grafitti2/3` XC |
| quay-concrete | yes |  | covered |  | `pkf_concrete5a` AX/XC |
| tin-sheet | yes |  | covered |  | `po_rustmetalblu` AX |
| quay-slab | - |  | stand-in | 1 | `pkf_concrete5b` AX, `stonewall1a` TS (dry) |
| canal-vault | - |  | stand-in | 1 | `po_sewerwall` AX, `bigcrete2` TS |
| rope-timber | - |  | stand-in | 1 | `rustic1`, `wood4a` TS |
| hut-curtain | - |  | **make** | 1 | cloth over planks; nothing |
| hut-hatch | - |  | stand-in |  | `crapwood1c` TS |
| pump-house-brick | - |  | covered |  | `sinbankbrick` AX, `bricks` TS |
| concrete-floor-cracked | - |  | covered |  | `crete28`, `dusty1` TS + `{crack1..4` DEC |
| rust-bracing | - |  | covered |  | `vbRustTrim`, `gryrst6b` AX, `{CA_Girder` XC |
| blast-door-salvaged | - |  | stand-in | 1 | `mtl8_cargo_door`, `armory11` AX |
| sign-insurgent-mark | - |  | **make** |  | hero; `{graf00*` DEC are Half-Life's own scrawls; the insurgents' mark counted in section 6 |
| trash-floor | yes |  | covered |  | `po_subtrash` AX |
| road-asphalt | yes | 8 | covered |  | `asphalt04` exists nowhere (not in any wad here, not in the old BSP); `masphalt..6`, `asfa1..6`, `strada1` TS + `{pstripe*`, `{stripeh/v`, `{arrow*`, `{turn*` DEC |
| curb-pavement | yes | 9 | covered |  | `pkf_trimpavemen` AX (128x16) |
| sign-street-name | - | 7* | **make** |  | one family city-wide; stand-in decal letters `{capsa..z` DEC on a plate; counted in section 6 |

Gaps in the description itself: it has **no material for the mega-structure** (the deck's underside over L2, the
piers that carry it, trusses, big pipes, the structure's outer walls seen past the city's edge), no sky name, and no
rain or haze. Section 6 counts them; the description would need roles such as `deck-soffit`, `pier`, `truss`,
`megawall` before stage 6 can hand them out.

## 4. Stage 8's props (`08-dressing.json`, Core tile)

714 props: 661 brush props (no entity) and 53 models (entities, the tile's cap; 2 dropped past it). Seven of the 44
catalogue kinds build as models; the rest are brushes and need only a texture per kind, which stage 8 does not name yet.

| kind (Core count) | build | on-client model or texture | status |
|---|---|---|---|
| wc (9) | model | `mecklenburg/toilette.mdl` 45 KB (H9), `CLANKILL3R/GPC_flo_toilet.mdl` 262 KB | covered |
| basin (10) | model | `CLANKILL3R/GPC_flo_becken.mdl` 42 KB | covered |
| steel-wc (14) | model | nothing (a prison pan); `toilette` as stand-in | make, or build it from 2 brushes: it takes 14 of the 53 model slots |
| planter (13) | model | `rdm_unplant1/02`, `sg_plant`, `3dm_plant01/02`, `ts_theatre/xt_plant` | covered (lush; a dead or potted variant fits the setting better) |
| planter-large (0) | model | `h9/pi_treeb` 73 KB, `h9/cemtree1/2` 304-588 KB | stand-in (trees are heavy and off-theme) |
| trash-scatter (6) | model | `h9/qk_trash`, `GPC_Envtrash2` 184 KB, `h9/re_dirt` 81 KB | covered |
| rubble (1) | model | `h9/re_dirt`, `3dm_wall_gib` | stand-in |
| beds, bunk (36), cot (12), hospital-bed (8) | brush | `mattress1/4`, `au_bed`, `au_bedg`, `au_bedw2` AX, `metal5` frames | covered |
| wardrobe, dresser, cabinet | brush | `au_closet2`, `au_drawer`, `cd_wooddrwr`, `kit_wood*` AX | covered |
| desk (47), dining/display/map-table | brush | `tabletops`, `dsk2_06/07` AX | covered |
| bookshelf (25), filing-cabinet (44), shelving (77) | brush | `book_c01`, `cabnet02`, `cds_drawer1`, `gp_shelf1/2` AX | covered |
| locker-row (32) | brush | no locker face; `cds_metalwr1`, `metal13dn` AX | stand-in (1 texture to make) |
| weapon-rack (14) | brush | `armory11` AX, `ammo_gunboard2` XC | covered |
| counter, bar-counter, worktop, stove, fridge | brush | `booth_wood_1`, `kit_*`, `kit_stove`, `au_stove`, `KITCHEN-FRIDGE0`, `gp_fridgebeer`, `pv_cooker` AX | covered |
| sofa, armchair (17) | brush | `hocouch3` AX | covered |
| bench (41), street-bench (20) | brush | wood TS, `metal5` AX | covered |
| workbench, tool-rack, machine | brush | `wm_*`, `ob_*`, `cpu*dn` AX | covered |
| crate (75), crate-stack, barrel (21) | brush | `xcrate10a..e` AX, `nwbarrel`, `barreltop` AX | covered |
| stall-counter (12), market-stall (21) | brush | `mr_kiosk`, `mr_awning` MR | covered |
| bin (16) | brush | `bin` TS (256x256) | covered |
| lamp-post (40) | brush | `metal5` + `~light3*` AX; models `sg_streetlamp`, `GPC_Streetlight` exist but cost an entity each | stand-in for the MSR lamp (1 texture to make) |

Props: 4 of the 7 model kinds covered, 3 stand-in or make; brush kinds covered but for lockers and the MSR lamp.

## 5. Signs (the description's 16 `sign`s, one per building, and the city-wide families)

| sign | on-client stand-in | status |
|---|---|---|
| nexus-eagle-banner | `{ax_msr` AX | **make** (hero) |
| barracks-plaque, ministry-plaque, precinct-plaque | `mr_s_*` MR style, `{ax_msr` | make (3) |
| the-purple-salon | `sign_cocktails` AX | make |
| gilded-arcade-jewellers | none | make |
| bazaar-hall, emporium | `{xc_enjoy`, `sign_open` | make (2) |
| clinic-cross | none on clients | make |
| foundry-works, cutter-works | DEC stencil letters on a plate | make (2) |
| gate-garage | `{xc_gear` XC | make |
| club-lantern | `{xc_skybar` XC | make |
| the-rat-den | `sign_devilopen` AX | make |
| pawn-sign | `{PC_PAWNPRAWN` is EMB only | make |
| pump-house-boats | none | make |
| sign-street-name (city-wide) | DEC `{capsa..z` on a plate | make (one family, a plate per street) |
| sign-house-number | DEC `{small#s`, `{med#s`, `{large#s` digits | covered |
| sign-scrawl, sign-insurgent-mark | DEC `{graf001..005`, XC `{grafitti2/3` | stand-in; the insurgents' mark to make |

All 16 building signs carry a proper name, so all 16 are made; half have a stand-in that says the right trade.

## 6. The hero pieces (what gives the city its identity)

| piece | what exists | verdict |
|---|---|---|
| **The MSR's look**: walls, floors, ceilings, trim, doors | `MJST*` (MJ, not on clients); AX `dgrey*`, `wallvault*`, `stec_panel5b`, `+0..5purpledn` | make an own set of 11 (dark marble and gunmetal panels, gold trim, purple accents), replacing MJ |
| **The eagle** (emblem, banners, standards) | `{ax_msr` AX (by name), H9's `tsm_banner.spr` (a game-mode banner) | make: emblem 2 sizes, 3 hanging banners (masked, purple and gold), 1 standard model |
| **Propaganda posters** | `~mr_poster` MR (one), `poster10` AX (Half-Life family) | make 6 (and 2 defaced by the insurgents) |
| **Cell bars** (`cell-grate`, now `{grate1`, flat) | `{mr_bars` MR 64x128 | make 1 masked bar texture, and build bars as thin brushes or the texture on two crossed planes so they read from the side |
| **Column of the Republic** (porphyry shaft, 6 cells high, gold bands, on the Mese's axis) | statues `h9/statue.mdl` 252 KB, `NeoB_jagd_statue` 89 KB, `sg_cstatue` 163 KB as stand-in crowns; `mr_column` MR plain | make: porphyry shaft and gold band textures (2, shared with `stone-gold-pillar`) and one crown model (an eagle) |
| **The Nexus tower** (round shaft, 7 cells, 5 brushes) | none round; `mr_facade1/2` MR, `dgrey*` AX | make 2: a tall-panel facade with lit slits and a crown band; the brushes stay brushes |
| **Mega-structure surfaces** (deck underside, piers, trusses, big pipes, outer walls) | `ceilingpipec`, `wm_pipes`, `dsupport`, `bigcrete2`, `{CA_Girder` XC, `e6basegrate` XC, `{tension4` AX | make 12: deck soffit 2, pier 2, steel cladding 1, masked truss 2, pipe 2, outer wall 2, service-light strip 1 |
| **The toxic sky** (red storm) | `h9byz` (green-violet, painted by noise and shapes), TS night skies | make: six sides from a CC0 stormy HDRI (Poly Haven), graded to red and sulphur, with the far mega-structure painted into the horizon |
| **Rain and haze** | AX `+0..7animrain`, `+0..5rain1`; sprites `h9_drain_rain`, `h9_drain_fog`, `h9_lift_haze`, `rain_splash`, `taxi_rain` | covered (H9's own sprites); 3 rain-streak textures to make for walls |
| **Signage per shop type** | section 5 | make 16 + street plates |
| **Grime, rain streaks, graffiti** | DEC `{rust*`, `{moss*`, `{lime*`, `{oil*`, `{drip*`, `{water1..3`, `{crack*`, `{scorch*` | grime covered by DEC; streaks and the insurgents' graffiti to make |

A note on decals: `infodecal` draws only from `decals.wad`, as far as the engine sources go, so our own grime and
graffiti cannot be infodecals unless H9 ships a new `decals.wad` (it would change every map). They go in as masked
`{` textures on thin world (detail) brushes, which cost no entity and no brush model.

## 7. The kit estimate

GoldSrc textures: 8-bit, one 256-colour palette each, sides multiples of 16, four mip levels, `{` for masked (index
255 transparent), `+0..+9` for animation frames, `~` for self-lit (under the compiler's lights file), `!` for liquids.
A texture costs w x h x 85/64 bytes plus 40 of header and 770 of palette: 256x256 about 88 KB (stage 6's budget uses
88,149), 256x128 about 44 KB, 128x128 about 23 KB, 128x64 about 12 KB, 128x32 about 6 KB.

| theme | new textures | sizes | bytes |
|---|---|---|---|
| L3 regal (pillar 2, windows 2, glass, stucco, red wood, polished cement 2, lux door) | 10 | mostly 256 | 0.6 MB |
| MSR set (walls 3, floors 2, ceilings 2, trim, doors 2, cell bars) | 11 | 256 and 128 | 0.7 MB |
| MSR identity (eagle 2, banners 3, posters 6, plaque, screen, checkpoint stripe) | 14 | 128x256 masked mostly | 0.55 MB |
| L2 common (shutters 2, windows 3, neon tile 2, terrazzo, neon strips 2, bar door, stained glass, canopy) | 13 | 256 and 128 | 0.8 MB |
| L1 undercity (damp brick, sewer and canal vaults, boarded window, wet slab, rope, curtain, blast door) | 8 | 256 | 0.5 MB |
| Stage 8 (locker face, MSR lamp head) | 2 | 128 | 0.05 MB |
| Mega-structure | 12 | 256 mostly | 0.9 MB |
| Insurgents (mark 2, slogans 3, tally stencil, defaced posters 2, cloth banner) | 9 | 128 and 256x64 | 0.2 MB |
| Signs (16 building signs, 12 street plates, 6 trade signs) + 8 neon animation frames | 42 | 256x128, 128x32 | 1.3 MB |
| Decals as masked textures (rain streaks 3, grime 3, soot, puddle, stencil arrow) | 9 | 64x256, 128 | 0.2 MB |
| Liquid (red toxic canal water; `scrolltoxic`, `!gwater3` AX are stand-ins) | 1 | 128 | 0.02 MB |
| **WAD total** | **about 130** | | **about 5.7 MB** |

Sky: six TGA sides, 1.18 MB at 256x256 (the size every H9 sky uses); 4.7 MB at 512 if Xash FWGS takes larger sides
(not checked). Models: about 8 new (below), 0.3-0.6 MB.

**Download.** On FastDL a WAD is a plain file over HTTP. Measured gzip ratios on H9's WADs: 0.53 for MR (flat painted
textures), 0.65 for XC, 0.93 for TS (photographic): a photo-based kit would compress to about 4-5 MB, a zip of it in
H9's client package about the same. A first join would fetch about 7-8 MB (WAD 5.7, sky 1.2, models 0.5) beside the
BSP. Embedding our own WAD with `-wadinclude` moves the 5.7 MB into the BSP instead (the old BSP was 46.6 MB with
6.77 MB of embedded mip data); the 32 MB texture-data limit is far off either way. Referencing AX, XC, MR, TS and
DEC by name costs players nothing: they have them. Stage 6's budget allows 95 textures a tile (the Core tile uses 35
today), so the kit plus the on-client sets fit a tile with room.

**New models** (within 53 a tile; most appear once or a few times a tile):
1. the Column's crown, an eagle (1 in the city);
2. an MSR standard, eagle on a pole with a hanging banner (4-8 on the Forum and at checkpoints);
3. a surveillance camera (2-4 a tile in MSR space and at checkpoints);
4. a propaganda loudspeaker cluster (2-4 a tile, the `msr-announcer` sound's source);
5. an insurgent barricade of junk and sandbags (a few in the Hollow);
6. a canal skiff (3-6 at the huts and the pump house);
7. a bundle of hanging cables across an alley (L1, L2);
8. a steel cell toilet only if it is not built from brushes (section 4).

**From CC0, and what needs painting.** About 56 of the 130 start from CC0 photographs (ambientCG, Poly Haven),
downscaled and given their own palette: 14 directly (stucco, terrazzo, damp brick, vaults, wet slabs, cloth, rope,
boards, glass, polished cement floor), 22 with painted details over them (the MSR panels with gold inlay, polished
cement with gold lines, shutters, windows, the blast door), 12 mega-structure surfaces (concrete, steel plate,
corrugated metal, grates and chain-link with opacity to `{` masks), 7 grime and rain, 1 liquid; and the sky from a
CC0 HDRI. About 74 need design and painting: the eagle, banners, posters, all signs and plates, the insurgents' marks
and graffiti, neon, the regal and stained-glass windows, the porphyry-and-gold pillar bands. Procedural noise was
judged machine-made (PLAN.md, "Why"): the painted ones are drawn shapes and lettering laid over CC0 bases, not noise.
Each CC0 base goes into the project's ledger with its source (PLAN.md Phase 5).

## 8. Open questions

1. **Will H9 ship a WAD?** Our kit (about 5.7 MB) in H9's client package, or per map over FastDL, or embedded in
   the BSP. And does H9 want `majestic.wad` on its clients (its licence would need finding), or our own MSR set alone?
2. **The MSR's colour.** H9's game modes paint MSR blue and the Insurgents red; our regime is purple and gold. One
   palette for both, or the city's purple kept apart from the match modes' blue?
3. **Do external WADs in `ts/maps/` load?** AX and XC live in `ts/maps/`, not `ts/`; whether Xash finds a WAD
   named in worldspawn's `wad` key there must be tried on a build (or the textures we use from them embedded, which
   is redistribution and is ruled out).
4. **Sky size**: does Xash FWGS take 512x512 sky sides as H9 runs it?
5. **Decals**: confirm on Xash that `infodecal` reads only `decals.wad`; if H9 would ship an extended `decals.wad`,
   grime and graffiti become cheap decals.
6. **The description's own fixes**: drop the dangling names (`asphalt04`, `{xc_sign1`, `{PC_sign1`), take the
   on-client names of section 3 for the EMB ones, and add the mega-structure roles and a sky name.
7. **The MSR's mark**: is Alexandria's `{ax_msr` the canonical MSR emblem H9's players know? If so, ours should
   echo it (redrawn, not copied); the canon would need to come from H9.

## Follow-up (2026-11-02): how content reaches clients, and `{ax_msr`

- **Delivery.** H9 already has two routes: its own client package, H9XASH (stock TS 3.0 + reTS + H9 content + Xash FWGS, `xash3d-h9-patches/overlay/README_H9XASH.txt`), and a `.res` list beside each map for `sv_allowdownload` / FastDL (`sv_downloadurl`, `docs/COMMANDS.txt`); `ts/maps/h9_tsrp_newbyzantium.res` lists the old build`s sky, a sprite and 17 sounds. The old build embedded its WADs with `-wadinclude` instead. Recommended: our WAD as a separate file, listed in the map`s `.res` (any player joining gets it) and offered to H9 for the H9XASH package; not embedded, so the BSP stays small and a texture change (e.g. recolouring the MSR to H9`s blue) ships without a recompile. To test on the first build: Xash finding a WAD kept in `ts/maps/`.
- **`{ax_msr`.** A masked 256x256 texture: a grey inverted triangle with the serif letters MSR on the transparent blue. It belongs to the Alexandria family of `ax_` corporate logos (beside `ax_fsg`, "Frontiers Strategy Group", `ax_heavensent`, `ax_picture1-5`), so it dates from the 2012 hand-made Alexandria, not from H9`s own art; H9`s maps use it on 6-12 faces in two maps (`alexandria_msr_b4v3/b5`, `h9_tsrp_hive`), a sign, not a city-wide emblem. Recommended: our MSR emblem echoes it (inverted triangle, MSR lettering) redrawn as our own with the eagle, so players who know Alexandria recognise it; nothing of it copied. Seen by decoding the WAD for a look only (`scratchpad/wadpng.mjs`, outside the repo); the image is not kept.
- **Emblems chosen (2026-11-02).** Of the six designs drawn as our own vector art (`levels/tools/emblems.mjs`, SVG in `levels/art/emblems/`): MSR **B, Ascendant** (the eagle as the inverted triangle, stepped-slat wings, MSR inside) is the main emblem (`{nbi_eagle`, `{nbi_eaglesm`, banner 2, posters 2/4/5); **A, Bicephalus** (double-headed eagle over the triangle) the formal one for banners and the Column of the Republic (banners 1 and 3, posters 1/6); **C, Foundry** (triangle in a toothed wheel, laurel) the secondary seal for foundry and ministry plaques (`nbi_plaque`, poster 3). Insurgents: **3, the Claw** (the regime's triangle torn by three claw gashes) the main mark (`{nbr_mark`, `{nbr_marksm`), **1, the Upturned** (the triangle turned point-up on a cog base, cracked; a cut stencil) the stencilled alternative (`{nbr_upturn`, `{nbr_upturnsm`, new); 2, the snapped chain, dropped. Six posters (ORDER IS PEACE, REPORT DISSENT, WORK BINDS US, THE REPUBLIC PROVIDES, OBEY THE CURFEW, THE DECK SHELTERS ALL; the planned ONE CITY, ONE ORDER replaced, its pattern too near a real slogan), each with a defaced copy (`nbr_defaced1..6`, 3..6 new) sprayed with the Claw or the Upturned. Those entries are `approved`, their source the emblem tool.
