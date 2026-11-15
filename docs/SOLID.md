# Cutting: one solid out of another (the solid pack)

The kit's solids build up (a box with its edges cut, a lathe, a profile swept); none of them cuts. A hole through a
plate, a window with rounded corners, a vent's slots, a handle's pocket, a band sunk round a lid are cuts, and without
them a prop is built of pieces that meet inside each other, with the hole left out. The optional pack `packs/solid/`
does booleans on the kit's meshes through manifold-3d, and every result is one closed mesh.

**Install once**: `npm install` in the kit's folder (manifold-3d 3.5.5, Apache-2.0; it brings 37 packages, 48 MB, of which the pack loads one file). Without
it, every function of the pack answers with the sentence that says so; the rest of the kit needs nothing.

## The functions

```js
import { solids as S, buildMdl } from "file:///C:/path/to/smak/src/index.mjs";
import { union, minus, common, hull, planar, roundedRect } from "file:///C:/path/to/smak/packs/solid/solid.mjs";
```

- A **mesh** is buildMdl's: `{ tris, texture }`, corners `{ p, uv?, n?, bone? }`, counter-clockwise from outside, as
  `S.trisOf`, `S.extrudeTris`, `S.sweepTris` give them. An **operand** is one mesh or a list (a result's `meshes`).
- `await minus(body, ...cutters)`, `await union(...)`, `await common(...)`, `await hull(...)` return `{ meshes, facts }`:
  `meshes` one a texture, straight into buildMdl's `meshes` or into the next boolean; `facts.triangles` in and out.
- `roundedRect(sx, sy, r)` is an outline for `S.extrudeTris`: a slot when r is half the width.
- `planar(meshes)` gives uv to pieces you do not cut, by the same rule as the cuts (below).

## What it does with the texture, the uv and the light

- **A cut's faces wear the cutter's texture**: they are the cutter's surface. Give the cutter the texture the cut is to
  show (bare metal in a painted plate, a dark pocket). The body keeps its own.
- **uv**: kept where the corner had one; otherwise planar on each face's main axis at 3 texels a unit, less when the
  prop would run off the picture (the kit does not repeat a model's picture).
- **Normals**: buildMdl works them out at 40 degrees, and the faces of two operands never share one: the edge of a
  cut is crisp and a round bore (16 sides) is lit round. A corner's own `n` is carried.

## A worked example: the window frame of a station's hull

`examples/09-cut.mjs` in full. The plate stands in the (y, z) plane facing +x.

```js
const facing = S.place([0, 0, 36], [1, 0, 0], [0, 1, 0]);
const throughX = (outline, x0, x1, texture) =>
  ({ tris: S.extrudeTris(outline, [x0, 0, 36], [x1, 0, 36], { up: [0, 0, 1] }), texture });
const plate = { tris: S.trisOf(S.box(facing, 112, 72, 8, { bevel: 1.5 })), texture: PAINT };
const cut = await minus(plate,
  throughX(roundedRect(84, 48, 20, 6), -6, 6, BARE),     // the opening, corners of 20
  throughX(roundedRect(92, 56, 24, 6), 1, 6, BARE));     // the rebate, 3 deep from the front
const whole = await union(cut.meshes, ...rivets);        // domed heads sunk 0.4 into the plate
const mdl = buildMdl({ name: "window.mdl", bodyparts: [{ name: "body", models: [{ name: "window", meshes: whole.meshes }] }] });
```

It prints `244 triangles in, 256 out` for the cut and `2232 in, 2336 out` with 26 rivets, `check` has no error, and the
form's boxiness is 0.66 (the same frame built of extruded halves without cutting: 0.81, with 44 doubled faces inside it
and its outer edge left sharp).

## Before you cut

- **Every operand closed.** A piece with an open edge is refused with how many ("is not closed: 3 open edges"): the
  kit's solids are closed; a mesh you put together by hand may not be. One facing in is refused too.
- **A cutter may end on a face**: manifold-3d settles faces that lie on each other (a bore from -2 to 2 through a plate
  4 thick gives the same 80 triangles and volume as one from -5 to 5; tried). A blind cut (a pocket) simply stops short.
- **Pieces that only touch** (a rivet on a plate) are united by sinking them a little (0.4) into it.
- **Look at the picture**, close: the triangles of a cut face fan to its corners, and each corner keeps its place on
  the picture in whole texels (the format), so a long straight line in the picture kinks by up to half a texel there.
- One operand hangs from one bone: cut each bone's piece apart, then build.
- Brushes are not cut (a map's brush is convex planes): packs/solid/README.md says what that would take.

`smak form` measures the silhouette and the surface: a hole through a plate changes little of either (the bracket's web
with three holes: boxiness 0.87, then 0.86). The picture shows what a hole does; the numbers do not.
