# A scanned model as a prop: Poly Haven's CC0 models

A prop made from boxes reads as a program's; a generator costs money. Poly Haven has some five hundred scanned,
textured models under CC0 (public domain) and a public API with no key. The optional pack `packs/assets/` searches
them and makes one a GoldSrc prop through the kit's own import door (docs/IMPORT.md): reduced to a budget, its base
colour as 8-bit textures, at its true size, standing on z = 0, checked, and drawn beside the source. `smak` has no
such command (the kit never imports a pack): the pack has its own entry.

```
node packs/assets/bin.mjs search fire extinguisher
node packs/assets/bin.mjs prop korean_fire_extinguisher_01 -o work/extinguisher.mdl --scale 1
```

`search` prints each model's id, name, categories, tags, real size (metres and units) and triangles; every word must
be in its id, name, tags or categories. `prop` downloads the glTF at 1k into `<temp>/smak/assets` (or `--cache`),
never into a repository, and writes beside the `.mdl` its `<name>.credit.txt` and `<name>.png`.

## The options of prop

- `--scale 1` its true size (39.37 units a metre), or `--height <units>`: one of them, always.
- `--triangles n`: unless told, 40 a unit of its longest side, 1000 to 2000 (packs/assets/README.md, "What a prop
  is made of", says why: Half-Life's own props are about 100 triangles, but a scan brought that low is a lump).
- `--texture 256|512`: the longest side of a texture (512).

## Read the answer, then the picture

It ends in `PASS:` or `FAIL:`. FAIL: an error of `check`; a foot off z = 0; a height that is not the one Poly Haven
gives (10 % off: the file lies on its side); more than one submodel holds. Every `WARN` is printed, on a pass too,
and each is a fault to name to the person:

| WARN | What to do |
| --- | --- |
| `the reducer stopped short: ... refused for they would turn a face over` / `where two charts of its picture meet` | It has more triangles than asked: thin parts (a lid, sheet metal) or a picture cut in many charts. Look at those parts in the sheet: they bend first |
| `heavy: n triangles` | Over 2500: fine for one prop, not for a room of them |
| `the file holds n objects side by side` | Poly Haven often shows a thing twice (open and closed, clean and rusted) or a kit of parts. The prop is all of them: say so; a part alone is not made by this pack |
| `the material ... is see-through (BLEND)` | A label or a glass: with an opacity map it has holes where that is under half, else it is solid |
| `form: ...` | Boxier than 19 of 20 of Half-Life's props (docs/MODELS.md, "Form"): a scan seldom is; look |

Then look at `<name>.png`: six views, each the source (left) and the prop (right) from one camera, the floor's line
on the level ones; the last two from a player's eye 96 and 256 away, as many pixels as the game shows. What to look
for: the same object at those two distances; a texture smeared where large triangles now cross it; a part bent or
gone (a lid, a strap, a tag); holes; a texture black or missing. Then place it (below) and draw the room.

## In a map

A prop is a point entity whose `model` names it (`cycler_sprite` in Half-Life; the mod's own, `ts_model` in The
Specialists), its origin on the floor (its foot is at its origin), with a CLIP box over it so players do not walk
through it (docs/MAPS-CHECKS.md, "Room before a door"). Put the `.mdl` under a folder you give `--game`, and draw:
`smak map-view room.map -o v.png --from x,y,64 --game <that folder> --game <valve>` (64: a standing player's eye),
beside a 72-tall player if the size is in doubt. On a compiled map `map-battery --game ...` says in `props` whether
each stands on the floor. A new `.mdl` name must be precached by the mod (AGENTS.md, rule 8).

## The terms

The models are CC0: no credit is required. The API's terms ask every call to name the software (the pack's
User-Agent does) and software that shows its content to say "Powered by Poly Haven" (each command prints it). The
credit file is kept with the model. The pack downloads only the base colour and opacity maps, and asks the list once
a week.

## What it does not do

- A part of a file: Poly Haven's crate is two crates, its dustbin two dustbins, its air duct a kit of 17 pieces; the
  prop is the whole file (the duct, 9240 triangles in five bodyparts, is a FAIL).
- Normal, roughness and metal maps; the light baked into a scan's colour is kept as it is.
- Animation: a rigged model (a tool chest's lid) is drawn at rest, one still sequence.
- Nothing is tried in the game: the pictures are the kit's, not the engine's.
