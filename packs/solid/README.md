# packs/solid: booleans on the kit's meshes

An optional pack (ARCHITECTURE.md 2.6). The kit's solids (`core/solids.mjs`: box, cyl, lathe, loft, extrudeTris,
sweepTris ...) build up; nothing in the kit cuts. This pack takes one solid out of another, joins them, keeps what
they share, through [manifold-3d](https://github.com/elalish/manifold), whose booleans always return a closed
mesh. A hole through a plate, a window with rounded corners, a vent's slots, a handle's pocket, a recessed band.

```js
import { solids as S } from "file:///C:/path/to/smak/src/index.mjs";
import { minus, union, roundedRect } from "file:///C:/path/to/smak/packs/solid/solid.mjs";
const plate = { tris: S.trisOf(S.box(place, 40, 20, 4, { bevel: 0.5 })), texture: paint };
const slot = { tris: S.extrudeTris(roundedRect(3, 12, 1.5), [0, 0, -5], [0, 0, 5], { up: [0, 1, 0] }), texture: bare };
const { meshes, facts } = await minus(plate, slot);    // meshes: [{ tris, texture }], buildMdl's own
```

| Function | What |
| --- | --- |
| `union(...operands)`, `minus(body, ...cutters)`, `common(...operands)` | The booleans. An operand is a mesh `{ tris, texture }` or a list of them (a result's `meshes`). Returns `{ meshes, facts }`, `facts`: triangles in and out, the volume, each input's, the time. |
| `hull(...operands)` | The convex hull of all their points, in the first one's texture (it comes free with the library). |
| `planar(meshes)` | Gives corners with no `uv` one, by the rule below: for pieces that are not cut, so that the whole prop is laid alike. |
| `roundedRect(sx, sy, r, steps = 4)` | An outline with its corners rounded, for `extrudeTris`: a slot (r = half the width), a window. The kit has a cylinder (`cyl`) but no rounded outline for a model. |

What goes through a cut: **the texture**: each triangle keeps its mesh's; the faces a cut makes are the cutter's own
surface, so they wear the cutter's texture. **uv**: a corner that had one keeps it (carried as a property); one with
none is laid planar on its face's main axis at 3 texels a unit (`make/unwrap.mjs`'s density), from the result's box,
less where that box would run off the picture (the kit does not repeat a studio model's picture). **Normals**: a
corner's own `n` is carried and turned over on a cutter's faces; with none, buildMdl smooths at 40 degrees, and faces
of different operands never share a normal (`group`), so a cut's edge is a crease and a round bore is lit round.
**Bones**: an operand hangs from one bone, kept. Every WASM object is freed (`delete()`) before the answer.

Refused, with one sentence, before any WASM: an operand that is not closed ("is not closed: 3 open edges ... in 11
triangles"), that faces inwards, that hangs from two bones, that is not a mesh. With the package absent, every
function answers how to install it.

**Budget: 600 lines**, every `.mjs` under this folder (layers.json `packs`); its test is `test/203-pack-solid.mjs`.

## The dependency

`manifold-3d` **3.5.5** (2026-11-13, the newest when it was pinned), Apache-2.0, by Emmett Lalish and the Manifold
authors: a WASM build loaded by an ES module (`import Module from "manifold-3d"; const m = await Module();
m.setup();`). It is in package.json's `optionalDependencies`, pinned exactly: `npm install` in the kit's folder installs
it; without it the kit and its tests run as before and this pack's cases say they are skipped.

**What it brings with it.** From 3.3.0 on the package depends on others for its ManifoldCAD editor (gltf-transform,
esbuild-wasm, and through them sharp, a native image library), none of which `manifold.js`, the only file the pack
loads, uses: `npm install` adds 37 packages, 48 MB (measured with 3.5.5). The owner chose the newest all the same
(2026-11-14), for the fixes since 3.2.1: normals (3.4.1, 3.5.0), the same result on every machine (3.5.0), crashes.
3.2.1 (2025-08-06) is the last with no dependencies (0.6 MB) and the pack ran on it first: the four props of the
proof come out the same bytes on 3.2.1 and on 3.5.5 (compared), and the pack's tests pass on both.

The API the pack uses (Manifold's booleans and hull, Mesh with properties, merge vectors and run ids, `reserveIDs`,
`delete`) was read in 3.2.1's .d.ts and runs unchanged on 3.5.5. A cutter's normals are turned over by the pack,
whichever way the library hands them back: it compares each with its face.

## Verified with (2026-11-14, Node 20.20, Windows 11)

`test/203-pack-solid.mjs`: a box minus a 16-sided prism (volume the arithmetic's to 1e-3, closed by
`core/solids.mjs closed`, its box, 12 + 60 triangles in and 80 out, each face's texture, the bore's walls facing into
the hole, uv inside 0..1); two boxes' union (1875) and common (125) with every face's texture the box it lies on;
a hull; a corner's own uv and normal carried and a cutter's turned over; a plate with three rounded slots built into
a model that passes `check`, the same bytes twice. The four props of the proof (a grille, a hull window, a transit
case, an I-beam bracket) each cut in 2 to 70 ms; the WASM loads in about 22 ms. Nothing was tried in the game.

**A known limit, the format's**: a studio model keeps each corner's place on the picture in whole texels (meshOf
rounds), so a corner a cut puts off the texel grid moves its triangle's picture up to half a texel; a straight line
in the picture (a panel line) kinks by that much where two such triangles meet. A picture with no long lines, or one
at more texels a unit, hides it. The kit's own lathe and sweep corners do the same.

## Brushes are not in scope

A map's brush is a convex solid of planes, and the compiler wants convex brushes. Cutting one would take: each
brush as a closed mesh (its planes clipped against each other), the boolean, then the result split back into convex
pieces whose faces are planes on the grid the compiler keeps, each face's texture axes carried by its plane, and no
sliver under the compiler's limits (`brushFaults`, make/maps/profiles.mjs). manifold-3d returns triangles, not convex
parts (its `decompose` splits pieces that do not touch, no more): the convex split is the missing step, and is not in
the library. The kit cuts brushes today by its own means: a box out of a box (`subtract`, make/maps/source.mjs), an
arch (`arch`), a wall's brushes round an opening.
