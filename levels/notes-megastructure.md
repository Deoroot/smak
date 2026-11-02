# A form vocabulary for New Byzantium as a mega-structure (2026-11-02)

The person's complaint about every earlier attempt: the city comes out "all square", boxes on a grid, where it
should read as part of one mega-structure. This note gives the generator a vocabulary of forms that make it read so,
within GoldSrc's limits (Xash3D, BSP2, H9's budget), rules a generator can check, and a count of where the map needs
each form and what it costs against PLAN.md's budget.

What was read: `levels/specs/newbyzantium.json` (and `check-city`'s estimate of it today), `levels/specs/CITY.md`,
`levels/rules/architecture.json` and its README, PLAN.md Phase 3 ("The map generator", "Brush economy",
"Targets"), `levels/notes-generator.md`, `levels/notes-h9.md`, `levels/notes-rp-city.md`, `levels/notes-l4d2.md`,
`levels/notes-vt2.md`, and the Core's R1 review sheets (`r1-forum`: plans of the three layers, the N-S and E-W
sections, the building sheets). The references (Kowloon Walled City, arcologies, megablocks, City 17, Byzantine
Constantinople) are from public knowledge: measures and principles only, nothing copied. Where a number is
approximate it says so.

Units as in the description: 1 cell = 128 units = 3.25 m; a storey 1.5 cells (192 units); the half-storey grid 0.75
cells (96 units). L1 z 0-4, L2 z 5-11, L3 z 12-20 (cells). The deck: L3's bounds, x and y 22-98 (76 x 76 cells,
247 m square), 1 cell thick (L2's top at 11, L3's floor at 12).

## 1. Why the Core reads as boxes (the R1 sheets)

- **Every outline is an axis-aligned rectangle.** Lots, buildings, plazas, ways: all rectangles in plan; no corner is
  cut, turned or marked. The building sheets (msr_nexus, hearth_terrace ...) are good floor plans inside rectangles.
- **In section the layers are three flat bands.** L1 is a box 4 cells high with a flat lid; the deck is a line at z
  11-12 with nothing under it; L2's facades are hatched boxes 2 to 4.5 cells high standing free under it, with air
  between their flat tops and the deck. Nothing carries the deck. It reads as boxes on a table under a lid.
- **No structure is bigger than a building.** A mega-structure is read from a frame larger than its units (piers,
  decks, walls, cores); the Core has none: the deck, the city's edge and the spine are invisible as structure.
- **The skyline is capped flat.** L3's sky is at z 20; the Nexus's tower crown is held 1.28 m under it
  (`dimensions.towers.topClearance`), so every roof, tower and the Column live under one lid.
- **The cistern is nearly empty.** The Cistern (14 x 14 cells) shows about nine columns; the Basilica Cistern it
  stands for has a column every 4.9 m.
- **The old builds' same fault** (notes-generator.md section 3): every space a box (`kit.mjs:34`), "walls on the grid,
  floors flat"; the old Nexus's dome was read as "some monument dome", a hollow shell (notes-h9.md section 5).

## 2. What the references teach, as measures and principles

| reference | measures (public sources, approximate where marked) | principle for New Byzantium |
| --- | --- | --- |
| Kowloon Walled City (demolished 1993-94) | about 2.6-2.7 ha, roughly 210 x 120 m; some 300-350 buildings fused into one mass, up to 14 storeys, the height capped by the Kai Tak flight path; alleys 1-2 m; pipes, cables and drains run along every alley ceiling | **separate buildings fused under a common cap read as one structure.** Under the deck, L2's facades should rise into the deck and fuse with it, their tops broken by add-ons (cages, bays, pipes), not stand free under it. Services along the ceilings of narrow ways |
| Arcologies (Paolo Soleri, *Arcology: the City in the Image of Man*, 1969); megastructure theory (Reyner Banham, *Megastructure: Urban Futures of the Recent Past*, 1976; Fumihiko Maki, *Investigations in Collective Form*, 1964) | a mega-structure is a large, long-lived frame into which smaller, short-lived units are plugged; two scales, the frame several times the unit | **two scales, frame and infill.** The frame (piers, deck, girders, walls, cores) is one material and one rhythm city-wide; the infill (the districts' lots) varies. The frame's bay is at least twice the infill's lot frontage |
| Megablocks (Mega-City One, *Dredd* 2012: the 200-storey Peach Trees block round a central atrium); *Blade Runner* (1982) | a block as a hollow tower: galleries stacked round an atrium; at street level a fine grain of signs and stalls under enormous plain forms | **vertical contrast of grain**: fine and cluttered at the hull's height, huge and plain overhead. The Stacks' light-well court as an atrium ringed by galleries; the deck and the city wall as the plain giants |
| Half-Life 2's City 17 and its Citadel (2004) | an old 4-6 storey European town cut through by the regime's walls and towers, of another material, continuous and unbroken; the Citadel seen from everywhere (in Source, by a 3D skybox) | **the regime's structure intrudes and is continuous; the people's fabric is irregular.** The MSR's dark marble and gold runs as one unbroken frame (deck edge, colonnades, the Nexus's spine through all three layers); the infill below is broken and patched. GoldSrc has no 3D skybox: the far view is a 2D sky and flat cards (F21) |
| Kevin Lynch, *The Image of the City* (1960) | paths, edges, districts, nodes, landmarks | the mega-structure is read at its **edges** (the deck edge, the city wall) and its **landmarks** (the Nexus, the spine, the Helix): those get the frame's strongest forms |
| The Basilica Cistern (6th c.) | 138 x 65 m; 336 columns, 9 m tall, in 12 rows of 28, about 4.9 m apart; brick cross vaults on the columns | the L1 cistern hall: game scale (rulebook `scale`: horizontal 1.6, ceilings 1.5) gives a pitch of 7.8 m (2.4 cells) and columns of 13.5 m (4.1 cells), L1's own height: **a column forest filling the layer** |
| The Cistern of Philoxenos (Binbirdirek) | about 64 x 56 m; 224 columns, each of two shafts stacked | a stacked column (two shafts and a collar) for the deeper wells where L1 and L2's piers meet |
| Hagia Sophia (537) | main dome about 31 m across, its crown about 55 m over the floor; a ring of 40 windows and ribs at its base; carried on four great piers by pendentives, with half-domes east and west and buttress masses outside | **domes stand on piers and are shouldered by buttresses**: a dome on the skyline has a drum, a ring of ribs or windows, and masses at its foot. Never an empty dome over nothing (the old Nexus's fault) |
| The Theodosian Walls (5th c.) | inner wall about 5 m thick and 12 m high; 96 towers about 15-20 m high, roughly 55 m apart (the spacing varies); an outer wall about 8.5 m high and a moat about 20 m wide in front | the city wall's rhythm: **a tower every 15-20 cells (about 55 m = 17 cells), projecting and rising over the wall** |
| The Aqueduct of Valens | about 970 m surviving, up to about 29 m high, two tiers of arches | a two-tier arcade as the way a high structure crosses a low district (the Helix's approach, the Mese's edge over the Bazaar) |
| The Mese, the fora | the Mese 25 m with porticoes both sides (PLAN.md Targets); fora with colonnades and a column | already in the description (the Mese 8 cells with porticoes, the Nexus Forum with its Column) |
| L4D2's urban maps (notes-l4d2.md) | floor width 23 m from the world alone, 12.5 m with props as they collide; sight 50.7 m median; props roof 2 % of the floor | **detail and props roughly halve the box the brushes make**: the world makes the box, the detail breaks it. The forms below are mostly detail for that reason |
| Vermintide 2's urban levels (notes-vt2.md) | floor run 18.8 m; open spaces every 83 m (72-112) along the path; height range (p5-p95) 54 m | **a view or event every ~25 cells** along a route; the city's 65 m stack is at the top of that band, so the vertical must be seen (deck edges, oculi, shafts) |

## 3. What a form costs in GoldSrc

Each form is built from one of four kinds of brush, and the kind decides what it costs (PLAN.md "Brush economy",
CITY.md "The rock term", notes-h9.md section 3):

| kind | what it is | brushes | leaves | notes |
| --- | --- | --- | --- | --- |
| **rock (R)** | the carve's own rock, changed by a form that cuts the outline of a way, a plaza or a well | the estimate counts **1 brush per outline corner per height band** of its tile and layer (`perCornerBand`; the carve's merge may make it less) | about 2.2 a structural brush (the old build) | the dearest kind: one new corner on an L2 tile with 9 heights costs up to 8 brushes and ~18 leaves; **a new height costs every corner of the tile-layer** |
| **world (W)** | a solid brush added in carved air, not detail (a tower's shell, a big roof mass) | 1 a convex piece | uncalibrated; a freestanding brush splits the air round it, guessed 4-6 | worth it only where the mass hides what stands behind (it closes vis between districts) |
| **detail (D)** | `func_detail`: merged into the world, cuts no vis leaf | 1 a convex piece | 0 | the default for every form here; still counts against the 25,000 brushes, the faces and the clipnodes; does not seal |
| **entity (E)** | a brush model (`func_wall`, `func_illusionary`) | 1 a piece, plus one brush model and one entity each | touches at most 24 leaves in BSP2 | only where a masked (`{`) texture must show through (grates, skyline cards): GoldSrc draws a world brush's `{` texture opaque |

Building rules that hold for every form:
- **One convex brush may have any convex outline**: a chamfered box, an octagon, a frustum. A chamfer, a bevel, a
  flared capital or a tapered tower costs nothing extra as a brush; it costs only when it has to cut rock.
- **So: carve rectangles, add shapes.** The carve keeps its few outlines and heights; everything that breaks the box
  is added (detail, or world where it must hide). A shape that would need rock taken away (a rounded block corner,
  a sunken plaza) is instead masked by something added (a corner turret, a raised podium).
- **Cylinders**: 8 sides up to 1 cell across (columns, pipes), 12 from 1 to 3 cells, 16 from 3 cells (towers, the
  Nexus, the Helix's drum). Every vertex on whole units (SMAK snaps them, `onWholePoints`); no edge under 8 units
  (a pipe of radius under 12 units takes 6 sides, or 4).
- **Arches as segments**: each segment one brush, from its chord on the curve up to a flat top line above the crown
  (convex by construction). 4 segments for a span up to 2 cells, 6 up to 4, 8 beyond (12 only for show). A segmental
  arch (a low arc, the industrial and cement districts) takes 3-4.
- **Vaults**: a barrel vault over a way is two long chamfer brushes in the ceiling's corners (a three-faceted
  soffit), one pair per straight run, plus a transverse rib (an arch) every few cells. A groin vault bay: four
  wedge brushes. A dome seen from inside is a shell of N x M segments (12 x 3 = 36), from outside a stack of 3-4
  frustums: never build an inside dome where only the outside is seen.
- **Relief under 16 units does not read**: hlrad's luxel is 16 units (notes-h9.md 3.2); a ledge thinner than that
  gets no shadow of its own. Trims at least 16 deep, pilasters and cornices 32-64, bays and balconies 96 or more.
- **Detail keeps out of the keep-clear volumes** (`keepClear` in the rulebook: doors, stairs, lights, signs, spawns)
  and out of a way's clear width and clearance; a form at the hull's height never narrows a way under its class.

## 4. The vocabulary

Each form: what it is; where it goes; its structural logic; its size; how it is built; what it costs (brushes per
instance, kind). Sizes in cells (c) and metres.

### The frame (one material per layer, city-wide, across districts)

**F1. Deck pier and capital.** A giant square or octagonal pier carrying the deck, with a flared capital (haunch)
where the girders spring. *Where*: L2 under the deck, on the street walls (engaged, half in the facade, so the
facades become infill between piers) and freestanding in the under-deck plazas (Bazaar Square, Forum Gate square);
at the deck edge (F8). *Logic*: the deck and L3 above stand on a pier grid; L2's buildings are infill between piers.
*Size*: pitch 6-8 c (19.5-26 m) along a way; section at least 1 c (3.25 m) over L2's clear 6 c (19.5 m): a short
column by ACI 318's slenderness limit (kLu/r <= 22, r ~ 0.3 h, so height <= 6.6 x width), which is what makes it read
massive; engaged piers project 0.5 c from the facade; capital 0.75 c high, flaring 0.25 c each side. *Built*: one
prism (chamfered square or 8-sided) + one frustum capital + (freestanding) one plinth. *Cost*: 2 D engaged, 3-4 D
freestanding.

**F2. Pier foot (L1).** The same pier's continuation in L1: squat, wider (1.5 c), with an impost block from which
L1's arches spring. *Where*: wherever an L2 pier stands over an L1 way or hall; in the Cistern every fourth column.
*Logic*: loads go down; the undercity's vaults spring from the city's piers. *Cost*: 2 D.

**F3. Girder rib (under-deck nave).** A transverse girder across an under-deck way from pier to pier, with haunched
ends: the way becomes a nave of bays. *Where*: every under-deck street and avenue, one per pier pair. *Logic*: the
deck spans the way between the facades' piers. *Size*: depth >= span / 12 (ACI 318-19 Table 9.3.1.1 gives L/16 for a
simply supported beam; deepened for a transfer girder, judged), in game height x1.5: a 6-c avenue takes a 1-c rib
under the deck (z 10-11), clear of the avenue's 3-c clearance (z 8) by two cells. *Built*: one box with chamfered
lower edges (one brush) + two haunch wedges. *Cost*: 1-3 D.

**F4. Coffered soffit.** Secondary beams in both directions every 2 c, making coffers (the Pantheon's and the
brutalists' ceiling alike). *Where*: under-deck plazas only. *Cost*: one brush a beam, 6-12 D a plaza.

**F5. Deck truss.** A steel truss of two chords, verticals and diagonals spanning a plaza or a long deck-edge bay.
*Where*: over Bazaar Square and the Forum Gate square (14 and 10 c spans); at deck-edge bays over the widest ways.
*Size*: depth span / 10 (judged, steel truss practice L/10-L/12): 1-1.5 c. *Built*: chords 2, a vertical and a
diagonal every 2 c, each a thin box (diagonals rotated: watch the whole-unit vertices). *Cost*: 10-15 D a truss.

**F6. Hanging services.** Pipes (8-sided), ducts (boxes), cable trays, a lamp gantry, slung under the girders.
*Where*: under-deck naves and plazas, the deck edge's underside, L1's ceilings. *Logic*: the mega-structure feeds
the city above through its underside (Kowloon's ceilings). *Size*: pipes 0.25-0.5 c across, kept above the way's
clearance. *Cost*: 1 D a straight run; 3 D every 8 c of nave.

**F7. Fusion band.** Where a facade under the deck meets the soffit: a band 1-1.5 c high in which the girders' ends
bear on the facade's piers, pipes enter, and the lot's top storey is broken by cages and bays (F15). *Where*: every
under-deck street wall. *Logic*: the facades are grown into the deck, not boxes under it (Kowloon). *Cost*: 1 D a
lot face (a corbel course); the rest is counted in F3, F6, F15.

**F8. Deck edge.** The deck's cantilever over the outer ring: a fascia, a row of brackets (corbels) under it, edge
piers at the grid's pitch, the L3 parapet on top, services hung beneath. *Where*: the whole deck perimeter, 304 c
(about 990 m): seen from the Stacks, the Foundry, Gate Ward and Lantern Row, it is the mega-structure's main edge.
*Logic*: a cantilever of 1-2 c past the edge piers (ACI's cantilever depth L/8 allows 8 c on a 1-c deck; 1-2 c reads
as a cornice of the whole city). *Size*: fascia 1 c (the deck's thickness, faced), brackets every 2-4 c, 0.75 c deep;
parapet per `dimensions.parapets` (1.28 m). *Built*: per 8-c bay one fascia trim, four bracket wedges, one engaged
edge pier with capital; parapet one brush a run. *Cost*: about 7 D a bay, 9 with the parapet.

**F9. Oculus and light shaft.** An opening through the deck, guarded by a grate or a parapet, letting the sky down
to L2; and the shafts through L2's floor to L1's basins (the layer's own note: "light shafts to the street above at
the basins"). *Where*: over the under-deck plazas, in an L3 way or plaza that stands above them (the Mese over
Bazaar Square, a square in the Forum's portico over the Forum Gate square); over the West and East Basins. *Logic*:
the upper city's floor is the lower city's ceiling: the poor get light through the rich's gratings. *Size*: 2 x 4 c to
4 x 4 c. *Built*: carved through the deck's band (the only frame form that cuts rock), a grate as one `func_wall`
with a `{` texture, or a parapet ring (4 D). *Cost*: ~8 R, 4-6 D, 1 E. *Vis*: each joins two layers' views; few of
them (<= 6), over spaces already open. Whether hlrad passes light through a `{` grate as a pattern (VHLT's opaque
entity with an alpha-tested texture) is to verify on the first compile.

**F20. City wall with towers.** The city's outer rock frame faced as a wall, with projecting towers on the
Theodosian rhythm, and the front gate flanked by two big towers. *Where*: the 480-c perimeter, seen from L2's open
outer ring and from L3 over the deck edge. *Logic*: the city is a well inside a larger structure; the wall is its
edge. *Size*: towers every 15-20 c, projecting 2 c, 3-4 c wide (octagonal or half-round), rising 1.5 c over the
wall's top; the wall's top at least z 20. *Built*: each tower one 8- or 12-sided prism + cornice + crown (detail
against the rock wall, which seals). *Cost*: 4-6 D a tower; gate towers 10-12 D.

**F21. Backdrop beyond the playable city.** The structure continuing past the wall, cheaply, in three depths: the
2D sky (6 images, painted with the mega-structure's further decks, towers and lights below the horizon band; GoldSrc
has no 3D skybox), silhouette cards (one `func_illusionary` each, render mode solid, a masked `{` texture painted
with a skyline, scaled up, standing on the wall's top behind a clip, in the air between the wall and a raised sky
lid), and the wall's own towers. *Where*: all four sides; most on the sides L3 looks out over (east and west, the
deck edge at 22 and 98 c from the wall). *Needs*: the sky lid over the outer ring raised above z 20 (to about z 28:
an open question). *Cost*: 0 brushes for the sky; 1 brush, 1 brush model, 1 entity a card (16-24 cards); a card
spanning more than 24 leaves drops out of view in BSP2, so cards stand in a simple pocket of air above the wall.

**F26. Exposed cores.** The regime's vertical structures shown as structure: the Nexus's spine as a ribbed
16-sided drum going down through the deck into L2 (round the precinct's lift and stair) and into the Cistern; the
Helix's drum as a ribbed cylinder seen from the Foundry; the Ascents' stair halls as towers rising through the deck
edge. *Logic*: City 17's Citadel: one continuous regime structure through every layer, a landmark from each. *Cost*:
ribs or pilasters round the carved well, 8-16 D a layer a core.

### Vaults and arches

**F10. Arch and arcade.** Round arches on piers along a street or square edge (Alexander 119, arcades), segmental
arches in the industrial districts. *Where*: L2: Bazaar Square's edges (the market's arcade), Lantern Square, Gate
Square; L1: arches springing from F2 pier feet across the mains. *Size*: span 2-3 c, piers 0.75-1 c. *Cost*: 4
segments + 1 pier = 5 D an arch.

**F11. Barrel vault by chamfers and ribs.** L1's ways (the sewer mains, 1.25-c alleys, 4-c streets) vaulted by two
chamfer brushes in the ceiling's corners per straight run, with a transverse rib every 6 c; the canal (8 c of water
and quays, 11 c wall to wall) vaulted by segmental arches every 6-8 c. *Logic*: the undercity is built vaults under
the city's piers, not a slab. *Cost*: 2 D a run, 3 D a rib; the canal's arches 4-6 D each.

**F12. Cistern hall.** A forest of columns with impost blocks and arches (or groin bays) under a flat rock vault.
*Where*: the Cistern (14 x 14 c under the Hearth), smaller in the Drain Market (10 x 10). *Size*: column pitch 2-2.5
c (the Basilica's 4.9 m at game scale is 2.4 c), columns the layer's clear height (4 c, the Basilica's 9 m x 1.5);
every fourth column a pier foot (F2) under an L2 pier. *Cost*: a column 3 D (8-sided shaft, base, impost), an arch 4
D; the Cistern at 2 c pitch: 36 columns and 42 arches in one direction, about 280 D (at 2.5 c: 25 and 30, about 195).

### Masses, facades and roofs

**F13. Buttress.** A stepped or sloped mass against a wall, a tower or a dome's drum. *Where*: the MSR's buildings
(the Nexus, the Ministry, the barracks: the regime's weight), the city wall between towers, the Ascents' towers.
*Size*: 1-1.5 c deep at the foot, stepping back twice. *Cost*: 2 D (two stacked wedges or one sloped prism).

**F14. Cantilevered balcony and gallery.** A slab, a parapet and two brackets; galleries running along a court's
storeys. *Where*: the Stacks' tenements (galleries round the light-well court as a megablock's atrium), Palace Row
and Spire Heights (loggias), the Hearth. *Size*: depth per `dimensions.balconies` (2.9 m min, 3.25 typical); a
gallery 1 c deep. *Cost*: 4-6 D a balcony; a gallery 2 D a storey a side.

**F15. Bay window and cage.** A closed projecting bay (one trapezoid prism with the window's texture) on facades, and
Kowloon's add-ons on the poor districts' facades: window cages, boxes, patched extensions on brackets. *Where*: L2
Stacks, Lantern Row, Gate Ward; the fusion band (F7). *Size*: 0.5-1 c out, 1-2 c wide, one storey. *Cost*: 1-3 D.

**F16. Setback and terrace.** Upper storeys stepped back from the street (a terrace, an attic, a ziggurat of tiers).
*Where*: L3 under the sky: the Ministry (stepped, MSR), the Palace residence, Spire manors; L2's outer ring. *Built*:
**above one rock base height, as added tiers**: the carve keeps the block's rock to a single base height per
tile-layer, the tiers are world prisms (they hide) standing on it. A setback by the carve would add a height and cost
every corner of the tile-layer. *Cost*: 1 W a tier.

**F17. Corner piece.** What a block does at a junction instead of a square corner: a round or octagonal turret
projecting half its width into the way, a giant corner pier, a splay (a 45-degree face), a corner entrance, a setback.
*Where*: every block corner on a street, avenue or plaza (alleys exempt). *Built*: turrets and piers are detail
cylinders centred on the rock's square corner, masking it; a true chamfer is carved only where the tile-layer has
few heights (L1). *Size*: turret 1-2 c across, never into a way's clear width (on a sidewalk or a portico's line).
*Cost*: 2 D (shaft + cap); a carved chamfer 1 R per band.

**F18. Wall-run services.** Pipes, ducts and cable bundles along walls, with brackets every few cells and drops into
the ground. *Where*: L1 everywhere (`pipe-rust`), the Foundry and Gate Ward, the backs of the Stacks. *Cost*: 1 D a
straight run (8 c); elbows 1 D.

**F19. Gantry, catwalk, skybridge.** Bridges between facades over a way at upper storeys, maintenance catwalks
under the deck. *Where*: the Stacks, the Hearth, the Foundry (its described catwalk over the roofs), over L1's
canal. *Built*: a plate, two rails (thin boxes), two brackets; out of reach (clipped) unless the description names it
as a way. *Cost*: 4-5 D.

**F22. Dome.** A dome on a drum, shouldered. *Where*: the skyline of L3 only, over a named program (the Palace Row
salon, a ministry hall), never over empty air. *Size*: 4-10 c across (Hagia Sophia's 31 m is 9.5 c); drum 1 c with
a ring of ribs or windows. *Built*: outside, a 12- or 16-sided drum + 3-4 stacked frustums + a lantern; 8-16 rib
pilasters on the drum. *Cost*: 5-6 W (it hides) + 8-16 D.

**F23. Tower silhouette.** A non-enterable shaft over a building (the format's `tower`: round, octagon, square),
extended with stepped crowns, a spire (a pyramid), a lantern, a belvedere. *Where*: one landmark per L3 district,
each a different kind; MSR towers on the regime's buildings. *Cost*: within `dimensions.towers.maxBrushes` (24): 5-10
W.

**F24. Roofline.** What a roof does: a parapet and a cornice, an attic storey, a pitched roof (one wedge), a sawtooth
(the Foundry's: a wedge a bay), chimneys and vents (8-sided prisms), tanks and antennas. *Where*: every roof under the
sky (L3, L2's outer ring); under the deck the fusion band replaces it. *Rule*: heights only from the tile-layer's own
half-storey set (no new carve height). *Cost*: 1-3 D a lot.

**F25. Ground variety.** Level changes inside a layer: a raised podium with steps or a ramp, a terrace along a
street, kerbs, a stepped plaza edge. *Built*: always **raised, by detail** (a sunken floor needs a carve height);
steps at the rulebook's 0.2 m riser, 12 to a half-storey; a podium of 0.5-0.75 c. *Cost*: a podium 1 D + a flight
6-12 D (or a ramp brush and its clip, 2).

**F27. Colonnade capital and base.** The regime's "stone-gold pillar" (the person's named theme): every portico
column of the Mese and the Forum given a gold capital (a flared frustum) and a base. *Where*: L3's porticoes. *Cost*:
1-2 D a column on top of the shaft the estimate already counts.

## 5. Rules the generator can check

In the rulebook's spirit: each a number with its source, or "judged" with its reason. They would sit in
`architecture.json` (a new `forms` section) and a description's `frame` field; each fails with a sentence naming the
thing and the number it wanted.

| # | rule | value | source | checked at |
| --- | --- | --- | --- | --- |
| M1 | deck pier pitch along every under-deck public way and plaza edge | <= 8 c (26 m); never over 10 | judged from M2: a 26 m span at L/12 gives a 1-c girder (game height) that fits between an avenue's clearance (z 8) and the deck (z 11); a longer span cuts the clearance | plan (5) and source (9) |
| M2 | girder depth; its soffit over the way | depth >= span / 12 (game height); soffit >= the way's clearance + 0.5 c | ACI 318-19 Table 9.3.1.1 (L/16 simply supported), deepened for transfer girders (judged) | 9 |
| M3 | pier width | >= max(1 c, clear height / 6.6) | ACI 318 6.2.5, short column kLu/r <= 22 with r ~ 0.3 h: a pier never reads slender | 9 |
| M4 | every deck pier lands; every L3 mass over 2 storeys stands on something | an L2 pier stands on rock, a structural wall or an L1 pier foot within 0.5 c below; a tower, dome or setback mass over a pier or an L2 building | judged: the structure reads continuous through the layers | 9 |
| M5 | the frame seen under the deck | a pier, rib or truss within every 8 c of under-deck public way; >= 90 % of its length | judged (Banham, Maki: the frame is what is read) | 9 |
| M6 | two scales | the frame's bay >= 2 x the median lot frontage under the deck | judged from Maki and Banham | 2 and 9 |
| M7 | deck edge | never bare: fascia >= 1 c, a bracket every <= 4 c, an edge pier at the grid's pitch, parapet per the rulebook | judged; `dimensions.parapets` | 9 |
| M8 | straight unbroken facade | <= 4 c (13 m) at the ground storey and <= 8 c above, in one plane and one material, without an opening or relief >= 24 units | Jan Gehl, *Close Encounters with Buildings* (2006): active fronts of 15-25 doors per 100 m, units of 5-6 m; x1.6 (rulebook `scale.horizontal`) gives ~9 m; 4 c with margin (judged) | 9 (scan coplanar faces along each street face) |
| M9 | facade relief | every face: trims >= 16 units; per storey band an element >= 48 units deep (pilaster, cornice, bay); per lot one >= 2.9 m (balcony, bay, buttress, pier) | hlrad's 16-unit luxel (notes-h9.md 3.2); `dimensions.balconies.depth.min` | 9 |
| M10 | corner treatment | each block corner at a street, avenue or plaza node has one of turret, pier, splay, chamfer, setback, corner entrance; no two corners of one node alike | judged (Lynch's nodes read by their corners) | 2 (assign) and 9 |
| M11 | adjacent massing | two lots side by side on a face differ in >= 2 of: roof height (>= 0.75 c), roof form, cornice height, bay or balcony pattern, wall role; a lot's massing signature repeats <= 10 % city-wide | the rp-city cities repeat 0 buildings; PLAN.md's rooms target <= 10 %; the old build repeated 76 % | 2 and 9 |
| M12 | skyline along a face | >= 3 roof heights a 20 c of face; <= 2 consecutive lots at one height; heights only from the tile-layer's existing set | judged; `rock.maxHeights` (a new height costs every corner of the tile-layer) | 2 |
| M13 | landmarks | each L3 district >= 1 silhouette >= 2 storeys over its median roof; each silhouette kind (round, octagon, stepped, dome, spire) <= once a layer | Lynch's landmarks; judged | 3 and 9 |
| M14 | wall rhythm | a tower every 15-20 c, projecting >= 2 c, >= 1.5 c over the wall's top; the wall's top >= z 20 | the Theodosian Walls (~55 m = 17 c) | 9 |
| M15 | views along routes | <= 25 c (81 m) between view events (a plaza, an oculus, a deck-edge view, a landmark on axis, an arcade's end) | Vermintide 2: open spaces every 83 m (notes-vt2.md) | 1 (graph) |
| M16 | oculi | every under-deck plaza has an oculus or a deck-edge view within 12 c; <= 6 deck oculi city-wide; each guarded (parapet or grate) | judged (light below; vis kept); `dimensions.parapets` | 4 |
| M17 | vault rhythm (L1) | a rib or arch every <= 6 c of way; cistern columns at 2-2.5 c, as tall as the layer's clear height | the Basilica Cistern at game scale | 9 |
| M18 | form budgets | per instance at most: pier 4, rib 3, arch 8, truss 15, tower 24 (already `towers.maxBrushes`), dome 22, balcony 6, turret 3, wall tower 12 | judged: each the convex pieces of its drawing above | 9 |
| M19 | carve neutrality | no form adds a carve height; only oculi and shafts cut rock; all forms' rock <= 2 % of the rock target (120) | PLAN.md "Brush economy" | 9 |
| M20 | frame material | the frame (piers, ribs, deck edge, wall, cores) wears one frame role per layer (cement on L1-L2, dark marble and gold on L3), the same across districts | City 17's regime material; the closed palette needs a frame slot (open question) | 6 |
| M21 | backdrop | from every public place under the sky, the view toward the edge at eye level meets the wall, a tower or a card before the sky; no sky below the horizontal | judged: the structure continues | 11 (rays on the compiled map) |

## 6. Where the map needs them, how many, and the cost

Measured from the description (2026-11-02): public ways L3 308 c (avenues 97, streets 153, alleys 58), L2 600 c of
which **356 c run under the deck**, L1 413 c of alleys and streets and 177 c of canal; nodes L3 13, L2 18, L1 16;
plazas under the deck: Bazaar Square (14 x 14) and the Forum Gate square (10 x 10). Under the deck lie the whole
Bazaar and Hearth Ward and the inner edges of the Stacks, the Foundry, Gate Ward and Lantern Row; the deck edge runs
through those four.

### Where they are needed most (in order)

1. **L2 under the deck** (the Core's L2, the Bazaar, the Hearth): the worst of the box reading (the sections). Naves
   of piers and ribs, the fusion band, hanging services, trusses and coffers over the two plazas, oculi from the Mese
   and the Forum. About half of the frame's cost.
2. **The deck edge**, all round (304 c), seen from the Stacks, the Foundry, Gate Ward and Lantern Row: the
   mega-structure's defining edge, with the Ascents' towers piercing it (F26).
3. **The city wall and the backdrop** (F20, F21): from L2's outer ring and from L3's edges; needs the sky lid raised.
4. **L1's vaults and the Cistern** (F11, F12): the Drains' mains, the canal, the Cistern under the Hearth (with the
   spine's drum, F26, in it), the Drain Market as a smaller column hall.
5. **L3's skyline and colonnades**: capitals on the Mese and the Forum (F27), one landmark per district (the Nexus's
   tower exists; the Ministry stepped, Palace Row a dome, Spire Heights a spire), corners and rooflines.

By district: the Mese (capitals, the Nexus's drum, corners); Spire Heights (spire, loggias, the Sky Garden's edge);
Palace Row (dome, loggias, the deck edge at x 22); Ministry Court (setbacks, buttresses, the deck edge at y 22);
Gate Ward (the wall, the gate towers, the deck edge, shafts to the basins); the Bazaar (arcade, trusses, coffers, the
Mese's oculus); the Stacks (atrium galleries, cages, skybridges, the deck edge); Hearth Ward (naves, fusion band, the
spine's drum, the Forum's oculus); the Foundry (sawtooth, chimneys, the Helix's drum, catwalks, the deck edge);
Lantern Row (arcade on its square, cages, the deck edge); the Drains (vaults, pipes, the Cistern, the Drain Market);
the Canal (arches, quay piers, light shafts); the Hollow (pump-house trusses).

### Count and cost

| layer | forms | count | brushes | kind |
| --- | --- | --- | --- | --- |
| L3 | F27 capitals (Forum 64 with bases, Mese ~112) | 176 columns | 240 | D |
| L3 | F8 deck edge with parapet | 38 bays | 340 | D |
| L3 | F22, F23, F24 landmarks (5-6) and rooflines (~60 lots) | | 180 | ~40 W, rest D |
| L3 | F17 corners (13 nodes), F13 buttresses (MSR), F16 setbacks, F26 Ascent towers | | 140 | D, 6 W |
| L2 | F1 + F3 naves under the deck (356 c, a bay every 7 c) and the plazas' piers | 51 bays, 8 piers | 290 | D |
| L2 | F5 trusses, F4 coffers over the two plazas | | 90 | D |
| L2 | F6 hanging services, F7 fusion band | | 225 | D |
| L2 | F9 oculi (4) and basin shafts (2) | 6 | 36 + 48 rock | D, R, 6 E |
| L2 | F10 arcades (Bazaar Square, Lantern Square, one side each) | 24 arches | 120 | D |
| L2 | F14, F15 balconies, galleries, bays, cages (Stacks, Lantern, Gate) | | 300 | D |
| L2 | F17 corners (17 nodes), F19 skybridges (25), F24 Foundry roofs, F18 pipes | | 270 | D |
| L2 | F20 city wall towers (28) and gate towers (2) | 30 | 190 | D |
| L2 | F25 podiums and steps | ~15 | 180 | D |
| L2 | F26 the spine's drum, the Helix's drum | 2 | 32 | D |
| L1 | F12 the Cistern (2 c pitch) and the Drain Market | 2 halls | 400 | D |
| L1 | F11 vaults over 413 c of ways (runs and ribs every 6 c) | | 310 | D |
| L1 | F11 canal arches (every 6 c) and chamfers | ~30 | 195 | D |
| L1 | F2 pier feet, F18 pipes, the basins' quay arches, the Hollow's trusses | | 195 | D |
| edge | F21 cards | 24 | 24 | E |
| | **in all** | | **~3,800** | ~3,650 D, ~45 W, ~50 R, ~30 E |

Leaves: the rock adds about 110 (2.2 a brush), the world masses an uncalibrated 200-300 (a freestanding brush splits
the air round it, guessed 4-6 leaves); detail none. Faces about +19,000 (5 a brush; 51,249 of 262,144 now),
clipnodes about +8,400 (2.2 a brush; 35,541 of 524,288), light data about +1.5 MB (6.7 of 32 MB), brush models and
entities +30 each. Only the brushes bind.

### Against the budget

| | brushes | leaves | structural | rock |
| --- | --- | --- | --- | --- |
| description estimate today (`check-city`) | 16,155 | 18,734 (uncalibrated) | 3,666 | 3,504 |
| stage 8's dressing, extrapolated from the Core (1,869 prop brushes there: 13.2 a room for 115 rooms, 350 in streets) to 347 rooms and every tile, less the 694 already counted | **~21,850** | same | same | same |
| + the forms above | **~25,650** | ~19,100 | ~3,760 | ~3,550 |
| PLAN.md target / limit | 20,000 / 25,000 | 20,000 / 25,000 | 8,000 | 6,000 |

**Over the limit, before any form**, the city is already past PLAN.md's 20,000 target once stage 8's prop brushes are
counted city-wide (the Core alone: 5,791 against its 5,000 target and 6,250 cap, R1's own note). Leaves, structural
and rock stay well inside: the forms are almost all detail. So the trades are in brushes, and the dressing pays first.

**What to trade**, in order (savings approximate):
1. **Room dressing from 13 brushes a room to 6** (furniture as fewer, larger pieces; small things as model props
   inside the entity budget, 721 of 1,650 now): about -2,400.
2. **Street props replaced by the forms** (a pier, a podium's steps, an arcade's pier is the street's furniture):
   halve the street dressing: about -900.
3. **Facade relief inside the facade allowance**: the estimate already gives facades a detail brush per cell of
   perimeter per storey; spend it on bays, balconies and pilasters (M9, F14, F15) and draw windows as
   texture, not frames: the 300 of balconies and bays come out of it: -300.
4. **Cheaper vaults**: the canal's arches every 8 c with 4 segments, L1's ribs every 8 c, the Cistern at 2.5 c:
   about -250.
5. **Ground variety by ramps and single podium brushes** where steps are not needed: -100.
6. **Far forms to the sky**: what is never reached or seen near (the wall's towers on the sides no public place
   faces closely, the deck edge's outer brackets above z 12) drawn on the cards and the sky: about -150.

That gives about **21,550 brushes (86 % of the limit)**, still about 1,500 over the 20,000 target. To come under it,
furniture goes further to model props (about 500 more, each replacing ~4 brushes: -2,000, entities to ~1,250 of
1,650), or the target is relaxed to the limit with less room for fixes: the person's choice.

**Per tile.** The Core binds: 5,791 after dressing, plus about 1,200 of forms (the Cistern, its share of the naves and
both under-deck plazas, three oculi, the Forum's and the Mese's capitals, the spine's drum) is ~7,000, past its cap
of 6,250. With trades 1, 2 and 4 in the Core (-805, -175, -80) and no column bases in the Forum (-64): about 5,870,
under the cap and still past the 5,000 target. The other tiles carry 925-2,700 brushes today and take 300-450 of
forms each (the deck edge and the wall run through all eight): none passes 3,500.

## 7. Scale illusion: a city too big for people, with no visible end

The playable city is 120 cells (15,360 units, 390 m) square, inside H9's extent of +-32,768 (+-16,384 where the roam
bots must walk, notes-h9.md 3.1). The city takes +-7,680, so **about 8,700 units (68 cells) on every side** are free
for what is seen and never reached. The aim: no player ever sees where the structure stops, and everything near is
human-sized beside things that are not.

### What Xash3D FWGS and GoldSrc give, and what to verify

From what is known of GoldSrc, the HL SDK and Xash3D FWGS. Nothing here was tried on H9's build; each "verify" is a
one-map test before the city depends on it (the bigtest idea, notes-h9.md 3.1).

| feature | what is known | for us | verify |
| --- | --- | --- | --- |
| **far clip** | worldspawn's `MaxRange` sets `sv_zmax` (the SDK's `CWorld`); the default 4,096 clips the far city and can clip the sky | set `MaxRange` 32,768 (the playable diagonal is 21,700, the backdrop beyond) | that FWGS and reTS keep the key and draw that far |
| **skybox** | six images `gfx/env/<name>{rt,lf,bk,ft,up,dn}.tga`; GoldSrc's are 256 x 256; FWGS loads them through its own image loader (TGA, also BMP and PNG) at larger sizes, and HD sky packs for Xash use 512-1,024 | render at 1,024, ship 512 with a 256 fallback | the size H9's client takes, and each face's rotation (a test sky with labelled faces) |
| **distance fog** | GoldSrc draws fog only when the client DLL asks (TriAPI `Fog`, as Counter-Strike's client does for `env_fog`); FWGS implements TriAPI; underwater fog from a `func_water`'s render colour is native | if reTS's client does not ask, fog is faked (cards, sprites) or added by an H9 patch (a worldspawn fog key) | whether reTS's client calls TriAPI `Fog`; if not, whether H9 will patch it |
| **models** | a `.mdl` is one entity, no brush; GoldSrc's limit 2,048 vertices a submodel (several submodels a model); textures 8-bit indexed; culled by its bounding box, and like every entity drawn only when its leaf is in the viewer's PVS | a backdrop model stands in **carved air** seen from the city, never in the void outside the hull; `$bbox` set to its whole size | the largest model FWGS draws without culling errors; the fullbright texture flag (`STUDIO_NF_FULLBRIGHT`, which FWGS and HL25 read) so a far model is not lit by the dark point it stands on |
| **fullbright and texlights** | world faces are always lightmapped; a `~` texture or a `lights.rad`/`info_texlights` texlight makes a face emit light at compile (hlrad); brush entities in additive render mode are drawn unlit, at full brightness | lit windows on far facades and cards: texlights or additive sheets | light data from many texlights (6.7 of 32 MB now) |
| **`func_rotating`** | a brush entity spinning on an axis at a set speed, with an optional sound | fans and flywheels: 1 entity, 1 brush model, its brushes | that it touches <= 24 leaves (BSP2) |
| **`func_train`** | a brush entity following `path_corner`s (each a point entity that stays) | far trains and lifts of the mega-structure | that a mover far away is sent and drawn (the bigtest's shuttle) |
| **animated model** | a model's sequence may move its parts anywhere inside its bounding box, looping | airships and far traffic **without path entities**: one entity whose animation is the whole flight | bbox culling over a long path |
| **sprites and beams** | `env_sprite` (additive glow, `renderfx` strobe, pulse, flicker), `env_beam` (needs two targets); animated textures (`+0name` ... `+9name`) on any face cycle by themselves | blinking lights by animated textures (no entity) or strobing sprites; light shafts as additive brush volumes | the frame rate of animated textures |
| **sound** | looping `ambient_generic` takes one of 256 static channels (240 kept, 55 used now); `env_sound` sets the room's echo | 3-5 far loops (a horn in a minute-long loop, the deck's rumble), `env_sound` halls under the deck and in the Cistern | none |

There is no 3D skybox in GoldSrc. The fake one is the sky plus models and cards in the air between the wall and a
raised sky lid (F21).

### The eight means, each with where it goes and what it costs

**1. A generated megacity sky.** Our own render, not a found image: Blender headless (Phase 1's adapter) builds a city
from a script (thousands of towers, decks and bridges as instanced blocks, a window grid shader lit at random, a
volume of haze), and a camera of 90 degrees renders the six faces from the city's centre at eye height on L3. The
horizon band carries the structure going on for kilometres, fading into haze; the up face the night with the tops of
the farthest towers and a high bridge or deck crossing; the down face haze and lights. The windows are one or two
pixels at 1,024. *Where*: everywhere; seen most from L3 and L2's outer ring. *Cost*: 0 brushes, 0 entities, texture
data a few MB (outside the wads). The sky's light (`light_environment`) takes its colour from the render's haze. *Made*: `levels/tools/sky.mjs` (notes-art-kit.md, "Our sky, made").

**2. Backdrop models: a fake 3D skybox.** Huge low-poly models (towers with lit windows, deck stubs, cooling towers,
the far end of the canal's tunnel), one entity each, standing in pockets of carved air 20-60 cells beyond the wall
under the raised sky lid, fullbright, darker and hazier the farther they stand. Two to four depths: the wall's
towers (brushes, F20), models, cards (F21), the sky. *Where*: east and west first (L3 looks out over the deck edges
at x 22 and 98, 22 cells from the wall), then north beyond Lantern Row and south round the front gate. *Cost*: 8-16
entities, 0 brushes; the pockets' carve a few dozen rock brushes (one outline and two heights each, outside the
tiles' playable area).

**3. Fog and haze to hide the ends.** If reTS's client draws distance fog: a night haze from about 60 c, so the city's
far side and the backdrop melt. If not (the likely case until verified): **fog cards**, large sheets of a soft
gradient texture in texture or additive render mode, layered at depth across the backdrop pockets, the gate's
approach road and the canal's tunnel ends, and haze sprites under the deck (the old build used fog sprites).
Underwater fog in the canal and the Cistern's water is native. *Cost*: 15-25 cards (1 brush, 1 brush model and 1
entity each), 10-20 sprites.

**4. Vertical voids.** Space that falls away or rises out of reach, so the city has no floor and no roof in view:
- **The deck seen from below**: the deck edge (F8) is a 7-cell cliff overhead from L2's outer ring; under the deck the
  soffit's coffers, trusses and fans (F4-F6) at 6 cells up.
- **Bottomless shafts**: a well in the Drains (beside the Drain Market) and one in the Hollow, dropping below L1's
  floor (z 0) into darkness and haze, seen through a grate or over a parapet, never walked into (if one is, a
  `trigger_hurt` at the bottom). They take the extent below the city (z down to about -2,000 units), carved as one
  outline of two heights each.
- **Looking up**: the Helix's drum as an open void ringed by its ramp; the Nexus's spine drum from the Cistern up; the
  Stacks' light-well court as an atrium open to the sky.
- **Catwalks over voids**: the Foundry's described catwalk over the casting hall; maintenance catwalks under the deck
  over Bazaar Square (F19); the canal's footbridges (the Bend and Yard Bridges).
*Cost*: shafts ~20 rock each and a grate (1 entity); the rest is counted in F4-F8, F19, F26.

**5. Scale cues.** Size is read only against something known: a door, a railing, a lamp, a person.
- **Human-sized things against the giants**: a door, a railing, a lamp or a sign at the foot of every pier, under
  every fan, beside every drum; maintenance ladders and doors high on the piers and the deck edge (out of reach, a
  door 2.5 m on a pier 19.5 m tall).
- **Giant fans**: ventilation fans in the deck's soffit over the Bazaar and the Hearth and in the canal's vault, 3-5 c
  across, turning slowly (`func_rotating`). Flywheels and gears in the Foundry and the pump house.
- **Light shafts**: additive volumes under each oculus and basin shaft (F9), searchlight beams rising from the Forum
  and the wall's towers (the regime watching).
*Cost*: 6-8 fans (1 entity, 4-8 brushes each), 4 machines (same), 10-14 beam volumes (1 entity, 1-4 brushes each).

**6. Motion far away.** A still backdrop is a painting; a moving one is a city.
- **Trains**: one `func_train` (a few brushes) on a viaduct across a backdrop pocket (east or west), crossing every
  minute or two, and the mega-structure's freight lift moving on the far wall: about 2 trains and 15-20 `path_corner`s.
- **Airships and far traffic**: animated models (one entity each, the flight in the sequence), 2-3 of them.
- **Blinking lights**: animated textures on the backdrop's and the wall's crowns (no entity); strobing sprites on the
  Nexus's tower and the tallest wall towers (8-12).
- **Distant sound**: 3-5 loops: the city's hum, a far horn, the deck's rumble (already in the Hearth's palette),
  trains; `env_sound` echoes under the deck and in the Cistern.
*Cost*: about 35-45 entities, under 20 brushes, 3-5 sound channels.

**7. Edges that are never flat walls.** Where public floor meets the city's limit, it ends in one of:
- **a drop**: the deck edge from L3 (parapet); on the Foundry's east side a fence over a fall to an industrial
  level below, models of refineries beyond;
- **a fence over a void**: chain-link (`{` texture, `func_wall`) over a shaft or the drop;
- **a closed gate with the street going on**: the front gate (`n2_gate`, `outside`) gets an approach road of 20-30 c
  beyond it, lamps receding into fog cards; a second, sealed gate at Lantern Row's north end the same; the canal's
  ends pass under grated arches into tunnels lit away into haze;
- **the wall with towers** (F20), never a bare face, buildings grown into it in the Stacks (Kowloon).
*Cost*: the gate roads and tunnels ~30 rock each, 6-10 lamps, a few cards; fences 1 entity each.

**8. Winding sight lines, so the whole is never seen.** Ways that bend and jog (the description's `winding`,
`space.maxStraightRun` of 11 c, now provisional), naves under the deck that close every 6-8 c with a rib, plazas
framed by porticoes, the deck itself hiding L3 from L2. Long views are given on purpose only at named views, and
each named view ends in the backdrop, not in the city's limit.

### Checks (stage 9 for keys, 11 and 12 on the compiled map)

| # | check | value | source |
| --- | --- | --- | --- |
| V1 | **every long sight line ends in depth**: of the level lines `measure.mjs` already casts from each public place (16 a place), each longer than 11 c (35 m) ends in the sky, in a backdrop pocket (it leaves the playable bounds into carved backdrop air, where the models and cards stand: models are not in the BSP, so the pocket is the test), on a fog card, or on a facade or frame face with relief; never on the outer frame's bare face | 0 failures | PLAN.md's sight target (20-35 m, named views longer); judged |
| V2 | **never the whole**: from any public place, the share of its layer's public floor in direct sight | <= 20 %, named views excepted | judged; the rp-city cities' median sight 19-28 m |
| V3 | **edge kinds**: every stretch of public floor within 4 c of the city's limit or a deck edge is a guarded drop, a fence over a void, a gate with its way going on, or the wall with towers; no bare wall face over 4 c | 0 failures | judged; M8 |
| V4 | **the far clip and the lid**: worldspawn `MaxRange` >= the longest line from public floor to the backdrop + 10 %; the sky lid over every backdrop model's top | at stage 9 | the SDK's `MaxRange` |
| V5 | **the backdrop is drawn**: each backdrop entity's leaf is in the PVS of some public leaf; a brush one touches <= 24 leaves | at stage 10 | BSP2's 24 leaves an entity (notes-h9.md 3.3) |
| V6 | **life**: from each district's main plaza, at least one moving or blinking thing in sight (a ray to its origin unblocked) | >= 1 | judged |
| V7 | **voids guarded**: every drop of more than 2.4 m from public floor has a parapet or fence unless it is a named one-way drop; every shaft's bottom is out of reach or kills | 0 failures | `dimensions.parapets`; L4D2's drops 2.4 m (notes-l4d2.md) |
| V8 | **scale pairs**: every element over 3 c in a dimension (pier, fan, drum, deck edge) has a human-sized one (door, railing, lamp, sign) within 6 c in the same view | >= 1 each | judged |

### Cost in all

| | brushes | entities | brush models | other |
| --- | --- | --- | --- | --- |
| sky (1) | 0 | 0 | 0 | 2-6 MB of sky images |
| backdrop models and pockets (2) | ~100 rock | 8-16 | 0 | models' textures |
| fog cards and sprites (3) | 20 | 30-45 | 20 | |
| voids (4): two shafts, grates | 40 rock | 2-4 | 2-4 | |
| scale cues (5): fans, machines, beams | 90 | 20-26 | 20-26 | |
| motion (6) | 20 | 35-45 | 2 | 3-5 sound channels |
| edges (7): gate roads, tunnels, fences | 90 rock + 20 | 15-20 | 6 | |
| **in all** | **~380 (~230 rock, outside the playable tiles)** | **~110-155** | **~50-60** | |

Against the budget: brushes stay where section 6 leaves them (+380, mostly rock in pockets that cut few leaves and lie
outside the nine tiles' playable floor); entities 721 + ~150 = ~870 of 1,650 (53 %); brush models ~515 of 2,048.
The pockets and the extent below z 0 add to the map's size, not to the tiles' shares. The leaves are the risk: a
backdrop pocket in view from much of the city enlarges what each leaf sees (the PHS, notes-h9.md 3.4), so pockets
stay few, simple and sky-roofed, and the first compile measures them.

## 8. Open questions for the person

1. **Under the deck, facades fused to the soffit** (recommended: one carve height, the Kowloon read, the fusion band
   breaks their tops) or free rooflines under a void (costs a carve height per roofline and reads as boxes on a
   table)?
2. **Raise the sky lid** over L3 and the outer ring (to about z 28) so domes, spires and the backdrop cards can rise
   over z 20? The description's L3 top and `towers.topClearance` assume the lid at 20.
3. **A frame role in the closed palette** (M20): the frame crosses districts, which the closed set forbids today; a
   shared or faction slot `frame` per layer?
4. **The brush budget**: accept ~21,500 (86 % of the limit, past the 20,000 target) or move furniture to model
   props to come under 20,000? Either way the Core needs its dressing cut.
5. **The pier grid**: one global 8-c grid through all three layers (structurally honest, L1's vaults spring from it)
   or bays per street (cheaper, follows the ways)? Recommended: bays per street, snapped to a global grid where the
   grid lands on a way's wall.
6. **Skybridges and catwalks**: walkable (public floor, reach and keep-clear checks, RP use) or dressing out of reach?
7. **To verify on the first compile**: the sky's image size on H9's Xash (GoldSrc 256 x 256), how the masked cards and
   grates render and light, the leaves a freestanding world brush adds; the rock coefficients and the leaves are
   uncalibrated until the Core is compiled (PLAN.md).
8. Piers stay out of the carriageway (the vehicle reservation): engaged piers on the facades, freestanding ones only
   in plazas and on porticoes' lines.
9. **Scale illusion (section 7)**: does reTS's client draw distance fog (TriAPI), or will H9 patch a fog key into the
   engine? Which sky size does H9's client load? May the map use the extent beyond the city (backdrop pockets, shafts
   below z 0) and a `MaxRange` of 32,768? Should the bottomless shafts be reachable (a death fall) or seen only
   through grates?

## Sources

- In the repository: PLAN.md Phase 3; `levels/specs/CITY.md`, `newbyzantium.json` and `check-city`'s estimate;
  `levels/rules/architecture.json` (`scale`, `dimensions.balconies`, `parapets`, `porticoes`, `towers`, `keepClear`);
  `levels/notes-generator.md`, `notes-h9.md` (limits, luxel, BSP2's 24 leaves an entity), `notes-rp-city.md`,
  `notes-l4d2.md`, `notes-vt2.md`; the Core's R1 sheets (plans, sections, building sheets, the dressing gate's
  brush note).
- Structure: ACI 318-19, Table 9.3.1.1 (minimum beam depths, L/16 simply supported, L/8 cantilever) and 6.2.5
  (slenderness, kLu/r <= 22).
- Urban form: Kevin Lynch, *The Image of the City* (MIT 1960); Jan Gehl, L. J. Kaefer, S. Reigstad, "Close encounters with
  buildings" (*Urban Design International* 11, 2006), and Gehl's *Cities for People* (2010); Christopher Alexander,
  *A Pattern Language* (1977), 119 arcades, 167 six-foot balcony; Reyner Banham, *Megastructure: Urban Futures of the
  Recent Past* (1976); Fumihiko Maki, *Investigations in Collective Form* (1964); Paolo Soleri, *Arcology: the City in
  the Image of Man* (1969).
- Places (Wikipedia articles of those names, measures approximate): Kowloon Walled City; Basilica Cistern; Cistern of
  Philoxenos; Hagia Sophia; Walls of Constantinople; Valens Aqueduct; Mese (Constantinople).
- Engine (section 7), from public knowledge, not tried on H9's build: the Half-Life SDK (worldspawn `MaxRange` to
  `sv_zmax`, `func_rotating`, `func_train`, `env_sprite`, `ambient_generic`, `env_sound`), GoldSrc's sky and
  TriAPI fog, VHLT's texlights, Xash3D FWGS (its image loader, TriAPI, studio flags); every engine claim is marked to
  verify on a test map.
- Games and films, principles only: Half-Life 2 (Valve 2004), City 17 and the Citadel; *Blade Runner* (1982); *Dredd*
  (2012); Left 4 Dead 2's and Vermintide 2's urban maps as measured in the notes above.
