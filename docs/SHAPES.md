# Shapes: new meshes made, and put into a model that is there

A shape is a list of triangles and a painted picture, made in the workshop ("Making a shape"). It goes into a
model in place of an old weapon's mesh, as a new body (a helmet, a pack), or placed where the game's own piece
of its kind sits; pieces come off, move between models, and keep their paint when the shape changes. A whole
new file is `docs/MODELS.md`; a weapon, shield or bow
in a game's own model files `docs/ITEMS.md`. Each recipe that has a runnable example in `examples/` names it. Read the example first; it is the template.

## A new shape in place of an old one: `examples/02-swap-mesh.mjs`

Use this for any weapon or item the game already has a model for. The model keeps its hands, bones, animations,
events and attachments, so the game notices nothing.

```js
import { swapMesh, indexed, shrink, check } from "./smak/src/index.mjs";

const piece = makeMyPiece();                       // { tris, image }: see "Making a shape"
const texture = indexed(shrink(piece.image, 2), "mygun_smak.bmp");
const { mdl, report } = swapMesh(src, { body: 3, piece, texture, size: "own" });
```

- `body`: the number `info` shows beside the submodel to replace.
- `pick`: which of its meshes are the old piece. By default all but those whose texture name contains `hands`,
  `arms` or `body`. If the mod names its hand textures otherwise, pass your own `(mesh) => boolean`.
- `size: "old"` stretches the piece to the old one's length (like for like). `size: "own"` keeps the size you
  drew it at, in units, and holds its low-x end (the grip) where the old one's was.
- `place: "bone"` skips the fitting: the piece's points are already in the space of the bone that carried the
  old one. Use it when the automatic fit turns the piece the wrong way; measure with `measure()` and `frameOf()`.
- `report.left` is how far the new outline is from the old, in units. Large means look closely at the picture.

A weapon usually has two or three models: `v_` (first person), `p_` (in another player's hands) and `w_` (lying
in the world). Do all of them, the world ones with a smaller texture (`shrink(image, 4)`).

## Making a shape

A shape is a list of triangles and a painted picture. `src/workshop.mjs` gives the two tools:

```js
import { workshop, indexed } from "./smak/src/index.mjs";
const S = workshop.sheet(512, 256);                // the picture being painted
const M = workshop.shape(512, 256);                // the triangles being built

// a turned part: a barrel 10 long, radius 0.6, drawn in a zone of the picture
const BARREL = { x: 8, y: 8, w: 300, h: 60 };
const barrel = M.turn([[0, 0.6], [9.5, 0.6], [10, 0.5]], BARREL, { name: "barrel", sides: 10, caps: [true, true] });
S.zone(BARREL, (u, v) => workshop.iron(u / 12, v / 12, workshop.cylinderLight(v / BARREL.h), 7));
// a sight on top of it: a small ridge on the barrel's own surface, in a zone of its own
M.ridge(barrel, [[8.6, Math.PI / 2], [9.4, Math.PI / 2]], { x: 8, y: 76, w: 60, h: 12 }, { name: "sight", width: 0.2, height: 0.25, ends: ["run", "cut"] });

const piece = { tris: M.tris, image: S.image() };
```

**A turned surface: `M.turn(rings, zone, options)`.** Rings along an axis, joined: barrels, grips, pots,
helmets, bottles, magazines with `sides: 4`. A ring is `[s, radius]`, or an object when it is more than a circle:

```js
const dip = (a) => -2.2 * Math.max(0, Math.cos(a)) ** 3;                    // the rim drops at the front (angle 0): a chin
const wall = M.turn([{ s: 0.3, r: [5.25, 4.3], ds: dip }, [3.4, [5.5, 4.5]], [7.2, [5.5, 4.5]], { s: 9.9, r: [5.4, 4.4], crease: true }], Z.WALL, {
  name: "wall", sides: 16, seam: Math.PI, lie: "across", at: (s, a, b) => [s, 1 + a, b],
  caps: [false, { dome: 3.1, rings: 3, zone: Z.CAP }], lining: { inset: 0.12, zone: Z.INSIDE, to: 2, cap: 2.5 } });
```

- **A ring's outline**: `r` is a radius, `[ra, rb]` (an oval) or a function of the angle. `ds(angle)` moves its
  points along the axis (a rim that dips); `off: [a, b]` moves its centre; `tilt` leans it; `crease: true`
  makes a hard edge there (elsewhere bands that meet gently are smooth).
- **Caps**: each end `false` (open), `true` (flat), a number (a dome that high; under 0 a dimple), or
  `{ dome, rings, profile, zone }`. Give a dome a `zone` and it is laid there as a disc, the way a round thing
  is painted.
- **`lining`** is the inside: the same rings facing inwards, `inset` units in, in a zone of its own, with a
  `rim` between outside and inside and a `cap` that closes its far end. Without it an open shape seen from
  below shows nothing: the game draws a face from its front only.
- **`seam`** is the angle where the picture's two edges meet: put it at the back. **`lie: "across"`** stands
  the surface up in its zone (the turn left to right, the first ring at the bottom), the way a helmet's wall or
  a label is easiest to paint.
- **`at(s, a, b)`** places a point (x, y, z unless told): to stand a part on another, or along another axis.
- **The picture follows the real surface**: each band gets the share of the zone that it has of the shape, and
  a ring's `w` weighs its band up or down. `workshop.allot(width, height, { WALL: [girth, length], CAP: [...] })`
  shares a whole picture out by the parts' real sizes, which a surface reports (`length`, `girth`, `reach`): run
  it once, paste the zones into the script and keep them, so that a later change of shape moves none.
- It **returns the surface**: `wall.at(s, angle, out)` is the point of the built faces at `s` along and `angle`
  round, `out` units off them, with the normal there and its place in the picture: `{ p, n, uv }`. `wall.ends`
  are the middles of its two ends (the dome's point) and the way each looks: where a finial stands.

**On a surface.** These take the surface a `turn` or a `tube` returned, and a zone of their own:

```js
M.ridge(wall, [[0.9, 0], [7.0, 0]], Z.BAR, { name: "bar", width: 0.9, height: 0.21 });                  // a bar down the face
M.band(wall, 9.4, Z.BAND, { width: 0.6, height: 0.12 });                                               // a hoop round it
M.studs(wall, [[7.6, 0.4], [7.6, 2 * Math.PI - 0.4]], Z.RIVET, { count: 14, radius: 0.17, height: 0.1 });   // a row of rivets, one picture for all
M.boss(wall, [8.2, 0], Z.BOSS, { radius: 0.7, height: 0.3, rings: 2 });                                 // a domed stud on the brow
```

A path is `[[s, angle], ...]` on the surface. A ridge's `ends` are `"point"` (it narrows and falls to a point),
`"run"` (it falls into the surface at its full width), `"cut"` or `"open"`; its feet go a little under the
surface (`sink`) so that no gap shows. Whether a rivet is worth its eight triangles or is better painted is
yours to judge: a painted one costs nothing and reads as well from two steps away.

**Along a curve, and thin sheets.**

```js
M.tube([[0, 0, 13, 0.3], [0.5, 0, 15, [0.85, 1.3]], [-2.9, 0, 15.3, [1.3, 2]], [-5.4, 0, 12, 0]], Z.PLUME, { name: "plume", sides: 6 });   // x, y, z, radius: to a point
M.leaf([[[0, 0, 0], [0, 2, 0]], [[0, 0, 3], [0, 2, 3]]], Z.FLAG, { name: "flag" });                                                   // a grid of points: seen from both sides
```

- `M.tube(path, zone)`: a tube, a horn, a tail, a strap: `[x, y, z, r]` along its middle line, `r` a radius or
  `[up, sideways]`, 0 at an end for a point. It returns a surface too (`s` is the length along the path).
- `M.leaf(rows, zone)`: a plume's feather, a cloth flap, a leaf, a fin. One call makes both sides, each with
  its own normals, so it is there from both and lit on each. (A `plate` with no thickness is not: it shows
  from one side only.)

**The older tools**, still what the kits are made of:

- `M.lathe(profile, zone, options)`: the first turned solid. Its picture goes by the profile's own numbers and
  its seam is at angle 0; anything new is better made with `turn`.
- `M.plate(stations, zoneA, zoneB, options)`: a flat thing with a section and a thickness, two faces. Blades,
  slides, stocks.
- `M.quad` / `M.tri` with `M.V(point, [pixelX, pixelY])`: anything else, corner by corner. The last argument is
  a point inside the solid, so that the face is turned outwards for you.

**The picture.**

- `S.zone({ x, y, w, h }, (u, v) => [r, g, b])`: paints that rectangle; colours are 0 to 1.
- Materials: `steel`, `iron`, `wood`, `leatherWrap`, `rust`; noise: `fbm`, `noise`; shading helpers:
  `cylinderLight`, `bell`, `step`, `mix`, `times`, `rivet`.
- Or put the shape in a model first and paint it **by place** (`paint`): the function is told the point of the
  shape each pixel colours, so a seam line, a slot or a dent is placed in units on the shape and not in pixels
  on a zone, and nothing has to be worked out from the layout.
- **Paint the light into the picture.** The engine lights models softly and flatly; edges, bevels, grooves and
  wear have to be in the texture. Keep painted shadow gentle: the piece is seen from every side.

Every part the newer calls make names itself (`name`), and its corners carry that (`of`) with their place in the
part: it is what lets a painted picture follow the shape when you change it ("Changing a shape after it was
painted"). A shape's triangles are plain data: move them all with
`tris.map((t) => t.map((c) => ({ ...c, p: move(c.p) })))`.

`kits/` holds four finished builders made this way, each a function from a description to `{ tris, image }`:
`sword` (any blade: knives, katanas, machetes), `axe`, `blunt` (bats, clubs, hammers, batons) and `bow`. Their
headers document every option. For anything else (a firearm, a grenade, a tool), write the piece from `shape`
and `sheet` directly, a part at a time, checking each in a picture; the kits are the worked examples to read.

Budget: a first-person weapon of 300 to 1500 triangles with one 512x256 or 512x512 texture is typical for
GoldSrc; a world model a third of that with a 128 or 256 texture.

### Turned and swept shapes, and no bare boxes

`solids.lathe(place, [[radius, z], ...], { n, mat })` turns a profile into a solid; `solids.sweepTris(profile, path,
{ up, closed, caps })` and `extrudeTris(profile, p0, p1)` draw any closed 2-D profile (concave too) along a path, mitred at
the bends, as triangles `[[{ p, k }]]` facing out (`solids.closed` says they are watertight). A bend in one plane keeps
the profile's width; a path that climbs and turns twists a little at the join. For a map's brushes the same profiles are
cut into convex parts (`maps.extrudeProfile`, `maps.sweepProfile`; docs/MAPS-MAKING.md). The reason, and the numbers
that say a shape is a pile of boxes (`smak form`): docs/MODELS.md, "Form".

## A new body from triangles, in a model that is there

How a game adds a helmet, a pack or a weapon skin to a file of them: one more **body** (a submodel) after the
ones it has, chosen by its number. The triangles come from the workshop (see "Making a shape"); `putBody` puts
them in.

```js
import { putBody, indexed, check, sheet, png, workshop as W } from "./smak/src/index.mjs";

const M = W.shape(256, 256), S = W.sheet(256, 256);                          // the triangles and their picture
const BODY = { x: 4, y: 4, w: 200, h: 120 }, LID = { x: 4, y: 130, w: 60, h: 60 };
M.turn([[0, 3], [5, 3.4], { s: 6, r: 3, crease: true }], BODY, { name: "flask", sides: 10, caps: [true, { dome: 1.5, zone: LID }] });
S.zone(BODY, (u, v) => W.iron(u / 12, v / 12, W.cylinderLight(v / BODY.h), 7)); S.zone(LID, (u, v) => W.iron(u / 12, v / 12, 1, 9));

const { mdl, body, warnings } = putBody(src, { name: "flask", tris: M.tris, texture: indexed(S.image(), "flask.bmp"), bone: "Bip01 Pelvis" });
console.log(`body ${body}`, warnings, check(mdl).errors);                    // tell the person the number: scripts choose bodies by it
const six = sheet(mdl, { body, seq: 0 }); writeFileSync("flask.png", png(six.width, six.height, six.rgba));
```

- **`name`** makes a new body, after the others of its bodypart: its number is the old count (times the
  bodypart's `base`), and every body the game knows keeps its number. **`body`** instead (a number or a
  submodel's name) puts the triangles in that body's place.
- **`bone`** is the bone it hangs on, and the triangles' points are **in that bone's own space**: `[0, 0, 0]` is
  the bone's joint, and its axes are the bone's, not the model's (in a biped's head bone `+x` is up the head and
  `+y` forwards). Measure before building: `boxIn(src, body, bone)` gives the box of a body the game already
  hangs there. If you would rather build in model space, as the model stands in a pose, pass `pose: { seq: 0,
  frame: 0 }` and `putBody` takes each point into its bone's space.
- One bone a corner, so a piece does not bend: hang it on the bone that moves least under it (a spine bone for
  the back, a thigh for a holster). A corner may name its own `bone` where a piece spans two.
- **Read `warnings`.** They are also printed. One says that the body you replaced was painted for another
  layout ("Changing a shape after it was painted"); one that the file already has a texture of that name with another picture, which
  the body then wears: give yours a name of its own, or change the file's with `replaceTexture`.
- `texture` is a texture, an image with a `name`, or the name of a texture the file has (a second body in the
  same picture: the woman's helmet beside the man's).
- A whole new **file** is `buildMdl` (docs/MODELS.md, "A whole new model"); a new shape in the place of a **weapon** the game
  holds is `swapMesh` ("A new shape in place of an old one"), which also fits it to the old one's grip.

## Taking pieces off, and moving parts between models

```js
import { pieces, dropTriangles, graft } from "./smak/src/index.mjs";

const P = pieces(src, pose);                                  // P.list: [{ id, tex, tris, mid, mn, mx }]; `smak pieces` prints it
const { mdl } = dropTriangles(src, (t) => [59, 36].includes(P.of(t)), pose);          // those two pieces off
const helmetOff = graft(dropTriangles(src, (t) => HELMET.includes(P.of(t)), pose).mdl, other, (mesh) => /head/i.test(mesh.texture.name));
```

- A piece is a group of triangles that touch. Tell what each is from its place and size, then **draw the model
  without it before trusting it**: what looks like armour is often the body itself, with no limb under it.
  A gap in the picture means the piece has to stay.
- `dropTriangles` also takes any rule on a triangle's place: `(t) => t.mid[2] > 60`, or on the island of the
  picture it is in: `const I = uvIslands(src); dropTriangles(src, (t) => I.of(t) === 12)`.
- `smak pieces <mdl>` lists every submodel's pieces; `--body n` lists those of the submodels that body shows.
- `graft` needs both models on the same skeleton and finds bones **by name**, so the two files may number them
  differently. It throws when a bone is missing; with `{ missing: "ancestor" }` as its sixth argument the corners
  of such a bone (a head's jaw, on a body that has none) hang on the nearest bone above it that the target has.
  Draw a run or a jump afterwards: a part on the wrong bone shows at once in motion.
- To **look** at several models as one (a helmet on a head with an armour), nothing has to be grafted by hand:
  `sheet(together([{ mdl: armour, body: 40 }, { mdl: head, body: 3 }, { mdl: helmets, body: 34 }]), { seq: 0 })`.
- A new piece of gear made in the workshop goes into a model with `putBody`: "A new body from triangles", above.
- None of this touches bones, animations, hit boxes or attachments.

## A helmet, or any worn piece: placed where the game's own sits, checked against what is under it

A worn piece that looks right alone can sit too high, cut through the head or float off the collar. Measure the
game's own piece of that kind first, build yours to those numbers, and check it by number and by picture.

```js
import { bodyIn, boxIn, facingOf, fitBetween, clearance, bodyCounts, putBody, together, lineup, png } from "./smak/src/index.mjs";

const HEAD = "Bip01 Head", theirs = bodyIn(helmets, 2, HEAD), box = boxIn(helmets, 2, HEAD);       // the game's great helm, in the head bone's space
const crown = facingOf(theirs.filter((t) => t.every((c) => c.p[0] > box.mx[0] - 1.6)));           // which way its top looks: how it is tilted
const tilt = Math.atan2(-crown[1], crown[0]), place = ([h, f, l]) => [h * Math.cos(tilt) + f * Math.sin(tilt), -h * Math.sin(tilt) + f * Math.cos(tilt), l];
const mine = makeMyHelm().map((t) => t.map((c) => ({ ...c, p: place(c.p) })));                    // built upright (h up, f forwards, l left), then stood as theirs stands

const head = bodyIn(reference, 3, HEAD, { only: true, bodypart: 1 }), fit = clearance(head, mine);
console.log(fit.fits, fit.outside, fit.tightest.gap, fit.tightest.at);                             // none outside; the tightest place and where
const woman = fitBetween(theirs, bodyIn(helmets, 16, HEAD));                                       // the game's woman's helm from the man's
const hers = mine.map((t) => t.map((c) => ({ ...c, p: woman.at(c.p) })));

const man = putBody(helmets, { name: "my_helm", tris: mine, texture, bone: HEAD }), both = putBody(man.mdl, { name: "my_helm_female", tris: hers, texture: texture.name, bone: HEAD });
const worn = (file, body) => together([{ mdl: armour, body: 40 }, { mdl: reference, body: 3, pick: (mesh, model) => model.name === "head_visible" }, { mdl: file, body }]);
const pic = lineup([["the game's", worn(helmets, 2)], ["mine", worn(both.mdl, man.body)]], { yaws: [0, 90, 180, 270], seq: 0, zoom: 2.7, target: [1.5, 0.5, 67.5] });
```

1. **Where theirs sits.** `boxIn(file, body, bone)` is a body's box in the bone's own space: its rim, its top,
   how far it stands off the face. `bodyIn` gives its triangles there, and `facingOf` of its top ones the tilt of
   its crown (one game's helmets lean 8 degrees forward of the head bone's axis: a helm built straight up the
   bone looks thrown back). `bodyCounts(file)` lists every body's triangles and their `median`: what a helmet
   weighs in that file.
2. **The head.** The player's body is usually another file on the same skeleton; `only: true` takes just the
   triangles on the head bone, `bodypart` the bodypart that holds heads (`smak info` lists them). The same bone's
   name means the same space in both files.
3. **`clearance(head, shell)`** counts the head's corners inside the shell, poking **outside** it, and **open**
   (not covered: the neck, below the rim), and gives the tightest place: `gap` units from the wall, at `at`. A
   lining, or a dark cone closing the inside, is not counted as wall. Aim for none outside and a gap of a
   quarter unit or more; a brow or a nose at 0.1 will flicker through.
4. **The other sex, or another build.** Games often keep a second body for each piece, a scaled and shifted
   copy. `fitBetween(theirs, theirOther)` finds that fit (`k`, `t`), from the points when the two have the same
   ones in the same order and from their boxes otherwise (`by` says which); `fit.at(p)` applies it to yours.
5. **Worn, in a picture.** `together` makes one model of the armour's body, a head and a helmet's body; draw it
   from four sides, zoomed on the head, next to the game's own worn the same way. Look at the collar: the rim
   must neither float above it nor cut into it. `clearance(armourPoints, mine)` counts what of the armour is
   under the helm.
6. Draw it alone from below as well (`pitch: -45`): an open helmet shows its inside, which is what a `lining`
   is for.

## Changing a shape after it was painted

A texture is painted for one layout: each pixel colours one place of the shape. Change the shape and the
painting may no longer fit, and nothing looks wrong until the model is drawn.

```js
const before = makeHelm(D), after = makeHelm({ ...D, WALL: taller });           // the same script, another description
const next = putBody(painted, { body: 36, tris: after.tris, texture: "helm.bmp", bone: "Bip01 Head" });
console.log(next.warnings);                // "64 in 100 of the pixels of helm.bmp that body 36 wears now colour another place..."
const { mdl, report } = carryPicture(painted, next.mdl, { body: 36, was: before.tris, is: after.tris, soft: 2 });
```

- **Keep each part in a zone of its own**, written down in the script (`workshop.allot` shares a picture out
  once; paste what it gives). A part that changes then moves nothing but itself, and a part that only moves in
  space (a finial that goes up with the crown) keeps its pixels as they are.
- **`putBody` warns** when the body it replaces was painted for another layout, and `layoutMoved(old, now,
  { body })` gives the share of pixels on its own.
- **`carryPicture(old, now, { body, was, is })`** repaints the new shape's texture from the old one. With `was`
  and `is` (the old and the new triangles, from the same script run with the old and the new description) it goes
  part by part: a ring that both have is the same place, so what was painted beside it stays beside it, and the
  bands that grew are stretched. Without them it goes by place: the nearest point of the old shape facing the
  same way, which is right wherever the shape did not move, and is also how the paint of a shape made another
  way is put on a new one (`{ body: 36, from: 34, tex: "new.bmp", fromTex: "old.bmp", reach: 1.5 }`).
- If the painting was done outside the file (in a picture program), hand it over: `picture:
  unpng(readFileSync("painted.png"))`.
- Read `report`: `lost` pixels found no place and are as the new file had them. A part with no counterpart (a
  lining where there was none) is yours to paint. Then draw before and after side by side.
- To add a ring **without** moving anything on the picture, give `turn` the old build's `places`
  (`M.turn(rings, zone, { places: old.places })`): the rings that were there stay on their pixels.
