# A new item in a game's own models

A GoldSrc mod that shows every weapon of a kind from one file (the arms and each weapon as a submodel of one
bodypart, picked by a number its scripts name) takes a new weapon as **one more submodel after the ones the
file has**. Nothing the file holds is moved, so every number the game's own scripts use still means what it
meant. This page is that recipe: `addFitted`, `addItem`, `itemSheet`, `keptWhole`, `iconPicture`
(`make/items.mjs`, `make/icon.mjs`) and the command `smak item`.

## The next item: a mesh function and one call

```js
import { readFileSync, writeFileSync } from "node:fs";
import * as smak from "smak";
import { blunt } from "smak/kits/bluntkit.mjs";
import { ITEM_FAMILIES } from "./smak/profiles/mastersword.mjs"; // one mod's families: data

const piece = blunt({ seed: 7, haft: { profile: [[0, 0.8], [26, 0.9]] }, parts: [/* a head */] });
const game = (file) => readFileSync(`C:/games/Half-Life/msc/${file}`);

const made = smak.addItem(game, { name: "club", piece, texture: "club_new.bmp" }, ITEM_FAMILIES.blunt1h);
for (const [file, bytes] of made.files) writeFileSync(`out/${file}`, bytes); // laid out for a server
console.log(smak.itemConstants(made).join("\n")); // const MODEL_VIEW_IDX 9, const MODEL_BODY_OFS 117 ...
```

or, with the piece as a module's default export (the piece, or a function that makes it):

```
smak item club.mjs --mod profiles/mastersword.mjs --game <Half-Life>/msc --family blunt1h --name club \
          --texture club_new.bmp -o out --pictures [--base <a folder that holds changed copies>]
```

It prints each placement, checks that what each file had is where it was (`keptWhole`), runs `check` for
both engines, writes the files under `-o` by the paths the family names, draws each new submodel beside the
one it was laid on (`--pictures`), and prints what the item's script is to say.

## What a family is

Data, kept in a mod's profile as `items` (nothing in the kit's `core/`, `make/`, `check/` or `cli/` knows a game):

```js
{
  title: "a one-handed blunt weapon",
  script: "items/blunt_mace",                    // the game's item to write the new one after
  constants: { MODEL_VIEW: "viewmodels/v_1hblunts.mdl", ANIM_PREFIX: "mace" },
  numbers: { MODEL_VIEW_IDX: "view", MODEL_BODY_OFS: "world" },   // a constant = the first submodel of a group
  how: "outline",                                // or "shield", for the whole family
  placements: [
    { group: "view", file: "models/viewmodels/v_1hblunts.mdl", bodypart: 0, like: "mace_ref",
      bone: "skullblade", name: "{name}_ref", shrink: 2, view: "first", seq: "idle1" },
    { group: "world", file: "models/weapons/p_weapons1.mdl", like: "mace_rhand", bone: "Bip01 R Hand",
      name: "{name}_rhand", shrink: 4, seq: "mace_idle" },
    // ... the left hand, the floor
  ],
}
```

Each placement is one `addFitted`: the piece becomes a new submodel of `bodypart`, laid on the submodel
`like` (the game's own thing that is held the same way), on `bone`, wearing the item's picture `shrink`
times smaller. `numbers` says how a script's constants follow: each is the number of the first submodel of
its group, and the group's submodels are checked to follow one another (a script reaches the others by
counting on).

`addFitted`'s ways of laying a piece (`how`):

| how | the piece is drawn | and is put |
| --- | --- | --- |
| `"outline"` | in its own axes, any size, +x its length; `haft: true` for a handle on x | over `like`: same length, same place, of the four turns the one whose outline follows best (`bestTurn`) |
| `"shield"` | +x along its length, +y across, +z out of its face, z = 0 its back | on the back plane of `like`, measured as a shield (`shieldFit`), as long as its body; a piece whose `shield` is a function is made to the straps' measures |
| `"bone"` | where it must be, in the carrying bone's space | as it is |

and of binding it to bones: `bone` (the bone it hangs on: unless told, the one that carries most of `like`);
`bones: [, "name"]` for the corners a piece marks `part: 1` (the kit's bow marks the middle of its string,
which goes on the bone that draws it); `rig: "nearest"` for a piece that is to bend as `like` does (each
corner takes the bone of the nearest corner of `like`); `keep` for meshes of `like` that go along as they
are (a bow's own nocked arrow).

`rig: "nearest"` goes by distance alone. Tried on a new bow it sent the stave's belly at the grip to the
string's bone, which is why a string is named by `part` and `bones` and not guessed: look at the pictures.

## The same file twice

A file that has been added to cannot be added to again: the new submodel would get the next number.
`addFitted` refuses a name the bodypart already has; with `existing: "same"` (what `smak item` and
`addItem`'s callers pass for a second run) it makes the piece all the same and compares: the very same
thing (every corner, bone and the picture) leaves the file as it is, with `kept: true`; another thing is
refused, since it cannot be changed where it is. So a step that adds items may be run again on its own
result, and a tool that writes the file whole (and so drops what was added) is simply followed by it.

## A bodypart that is not the last

The engine picks a bodypart's submodel from a body number as `floor(body / base) % count`
(`R_StudioSetupModel`), and a compiler writes for `base` the product of the counts of the bodyparts before.
`addModel` (which `putBody`, `copyBody` and `addFitted` use) raises the `base` of every bodypart after the
one it adds to, so the arms behind nine weapons are counted in tens once there are ten. `check` warns of a
base that is not by that rule (`basesByRule`), and refuses a base of 0.

## An icon

`iconPicture(mdl, { body, parts, lie: "diagonal", roll, lean, margin, levels })` draws one body on black,
filling a square: as it stands (give `view`), or with its long axis laid from the lower left to the upper
right, its heavy end up, which is how a long thin thing fills a square. `parts: [0]` leaves out the arms of
a first-person file (`render` takes `parts` too). It returns floats; `reducedPicture` brings it down to the
tile. The palette, the border and the sprite sheet are the game's, and stay in the game's own tool.
