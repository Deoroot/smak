# Level styles: bands per kind of game

What Phase 3's level checks read (PLAN.md, "Styles are a kind of game plus a theme"): the surveyed levels
tagged by kind (`tags.json`), and each kind's measures banded from its own levels only, never pooled across
kinds. Made by `node levels/tools/styles.mjs` from `levels/corpus/levels-*.json` with
`levels/lib/styles.mjs`; run it again after a survey. This file is written by the tool: change the tool, not
the tables. Measures and bands only.

**How to read a cell**: median (p10–p90), then the median in player heights (ph: 72 units = 1.83 m in
GoldSrc and Source, 1.8 m in Vermintide 2), then n maps. A map is one vote, and in a kind with two games
each game's maps weigh as much together as the other's. **bare**: Left 4 Dead 2 measures width and sight
twice; the band uses every solid static prop as the engine collides with it (its collision hulls,
`withPropCollision`: dressed), *bare* is the world alone (far too wide). A cell of several "game: value" is a measure the games take too
differently to pool. A measure no game of a kind takes is a gap, listed under the kind.

## Kinds

| kind | maps | from | left out |
| --- | --- | --- | --- |
| coop-campaign | 91 | Left 4 Dead 2 57, Vermintide 2 34 | 0 |
| linear | 91 | Half-Life 91 | 12 |
| arena | 41 | Half-Life 12, The Specialists 29 | 0 |
| exploration | 75 | Master Sword Rebirth 75 | 11 |
| rp-city | 3 | The Specialists role-play cities 3 | 0 |

Exploration's settings (Master Sword Rebirth): dungeon 22, town 4, mixed 13, outdoors 35, unclear 1. Bands of a setting of its own need 8 maps. Left out of every kind: Counter-Strike
(not one of the five kinds) and Master Sword Classic (the same maps as Rebirth, older); GoldSrc maps whose walk
reached under a tenth of their floor (it began boxed in); ms_soccer (a minigame). Each kind's file lists its
left-out maps and why. The role-play cities (rp-city) carry measures of their own (streets, buildings, layers,
variety, light, furniture), banded in their own section below.

## Style: fantasy dungeon (exploration)

rpg_sbox's first dungeon. Master Sword Rebirth's exploration: hubs, branches, dead ends with rewards. The dungeon setting's bands first, the whole kind's where a setting band is missing; the co-op campaign's bands (Vermintide 2's 30 % of floor off the route) for a mixed route with side areas.

Bands from **exploration/dungeon (22 maps)**; the whole exploration kind beside it; the co-op campaign (91
maps) as the fallback for a route with side areas mixed in.

| measure | exploration/dungeon | exploration (all) | fallback: coop-campaign |
| --- | --- | --- | --- |
| floor width (map's median place) | 8.48 m (5 m–19.61 m), 4.64 ph n22 | 12.22 m (6.22 m–19.86 m), 6.68 ph n75 | 7.98 m (5.01 m–16.1 m), 4.43 ph; bare 8.1 m n91 |
| corridor width (map's p5 place: its narrowest common floor) | 3.43 m (2.41 m–7.45 m), 1.88 ph n22 | 3.94 m (2.62 m–6.45 m), 2.15 ph n75 | 2.36 m (1.76 m–4.35 m), 1.31 ph; bare 2.43 m n91 |
| passage width (gaps between walls, median) | 2.74 m (2.03 m–3.76 m), 1.5 ph n20 | 2.74 m (2.01 m–3.72 m), 1.5 ph n73 | 2.16 m (1.76 m–2.78 m), 1.2 ph n34 |
| main path width (median) | — | — | 4.96 m (3.74 m–6.78 m), 2.76 ph n34 |
| narrow floor share (under 2 player heights) | 8 % (1 %–34 %) n22 | 4 % (1 %–19 %) n75 | 14 % (3 %–31 %); bare 13 % n91 |
| open-space width (map's p95 place: its big rooms and yards) | 19.01 m (10.01 m–35.85 m), 10.4 ph n22 | 27.89 m (14.07 m–47.24 m), 15.25 ph n75 | 23.49 m (11.9 m–62.04 m), 12.85 ph; bare 28.68 m n91 |
| wide floor share (4 player heights and over) | 58 % (23 %–94 %) n22 | 77 % (38 %–93 %) n75 | 35 % (21 %–54 %) n34 |
| walked floor | 4 628 m² (738 m²–12 869 m²) n22 | 5 682 m² (1 519 m²–16 186 m²) n75 | 17 573 m² (7 033 m²–34 595 m²) n91 |
| headroom, roofed floor (median) | 6.13 m (3.52 m–24.87 m), 3.35 ph n22 | 6.5 m (4.06 m–15.52 m), 3.56 ph n75 | 4.19 m (3.25 m–7.9 m), 2.29 ph n57 |
| headroom over narrow floor (median) | 5.3 m (3.23 m–14.19 m), 2.9 ph n22 | 4.47 m (3.23 m–11.58 m), 2.44 ph n75 | 4.06 m (3.25 m–7.16 m), 2.22 ph n57 |
| floor under open sky | 0 % (0 %–9 %) n22 | 56 % (0 %–90 %) n75 | 83 % (15 %–95 %) n57 |
| height range of the walked floor (p5 to p95) | 27.36 m (0.02 m–98.57 m), 14.96 ph n22 | 21.67 m (2.84 m–75.18 m), 11.85 ph n75 | 24.04 m (8.27 m–102.17 m), 13.17 ph n91 |
| floor levels (heights holding 2 % of the floor) | 5 (1–11.9) n22 | 7 (3–13) n75 | 14.5 (9.9–18) n34 |
| sightline (map's median place: its longest line) | 22.64 m (17.67 m–43.71 m), 12.38 ph n22 | 34.47 m (20.29 m–56.51 m), 18.85 ph n75 | 50.67 m (32.93 m–76.2 m), 27.71 ph; bare 76.2 m n57 |
| crossing, walked | 233.76 m (51.07 m–452.21 m), 127.82 ph n13 | 244.25 m (84 m–426.39 m), 133.56 ph n53 | 703.89 m (300.31 m–1541.01 m), 384.89 ph n77 |
| walked / straight | 2.42 (1.06–3.12) n13 | 2.02 (1.07–3.36) n53 | 1.99 (1.3–5.84) n77 |
| winding per 100 m of route | — | — | 1.52 (1.31–1.97) n34 |
| loops (cycles round 512-unit tiles) | 0 (0–2.3) n22 | 1 (0–5) n75 | 6 (1–18.1) n34 |
| alternative routes | — | — | l4d2: 2; vt2: 0 |
| floor off the route | — | — | 30 % (17 %–40 %) n34 |
| stair riser (commonest) | 0.25 m (0.2 m–0.41 m), 0.14 ph n18 | 0.41 m (0.17 m–0.41 m), 0.22 ph n70 | 0.2 m (0.14 m–0.2 m), 0.11 ph n54 |
| stair flight rise | 1.07 m (0.81 m–3.03 m), 0.58 ph n14 | 1.02 m (0.81 m–2.48 m), 0.56 ph n51 | 1.51 m (0.81 m–2.55 m), 0.83 ph n54 |
| door width | 2.64 m (1.63 m–5.04 m), 1.44 ph n13 | 2.49 m (1.42 m–4.54 m), 1.36 ph n58 | 1.47 m (1.4 m–1.52 m), 0.81 ph n57 |
| door height | 3.25 m (2.44 m–5.6 m), 1.78 ph n13 | 3.25 m (2.44 m–4.88 m), 1.78 ph n58 | 2.72 m (2.67 m–2.84 m), 1.49 ph n57 |
| doors per map | 1 (0–14) n22 | 2 (0–15) n75 | 13 (3.2–37.8) n57 |
| drop height | — | — | l4d2: 2.41 m; vt2: 3.56 m |
| first event (fraction of the route) | — | — | l4d2: 0.625; vt2: 0.165 |
| events per km of route | — | — | l4d2: 3.2; vt2: 11.62 |
| spacing of open spaces along the route | — | — | 83.43 m (66.53 m–134.74 m), 46.35 ph n34 |

Gaps (no game of the kind takes them): branches and dead ends; floor off the route; drop height.

## Exploration by setting (Master Sword Rebirth)

| measure | dungeon (22) | mixed (13) | outdoors (35) |
| --- | --- | --- | --- |
| floor width (map's median place) | 8.48 m (5 m–19.61 m), 4.64 ph n22 | 10.21 m (6.33 m–23.44 m), 5.58 ph n13 | 14.12 m (8.74 m–19.15 m), 7.72 ph n35 |
| corridor width (map's p5 place: its narrowest common floor) | 3.43 m (2.41 m–7.45 m), 1.88 ph n22 | 3.38 m (2.36 m–5.91 m), 1.85 ph n13 | 4.44 m (2.69 m–6.27 m), 2.43 ph n35 |
| passage width (gaps between walls, median) | 2.74 m (2.03 m–3.76 m), 1.5 ph n20 | 2.44 m (1.79 m–3.33 m), 1.33 ph n13 | 3.05 m (2.24 m–4.37 m), 1.67 ph n35 |
| narrow floor share (under 2 player heights) | 8 % (1 %–34 %) n22 | 7 % (1 %–19 %) n13 | 3 % (1 %–11 %) n35 |
| open-space width (map's p95 place: its big rooms and yards) | 19.01 m (10.01 m–35.85 m), 10.4 ph n22 | 23.55 m (17.35 m–42.52 m), 12.88 ph n13 | 32.18 m (19.08 m–50.93 m), 17.6 ph n35 |
| wide floor share (4 player heights and over) | 58 % (23 %–94 %) n22 | 71 % (40 %–93 %) n13 | 83 % (64 %–92 %) n35 |
| walked floor | 4 628 m² (738 m²–12 869 m²) n22 | 4 945 m² (1 472 m²–19 871 m²) n13 | 6 303 m² (2 934 m²–16 186 m²) n35 |
| headroom, roofed floor (median) | 6.13 m (3.52 m–24.87 m), 3.35 ph n22 | 7.72 m (4.06 m–17.21 m), 4.22 ph n13 | 6.17 m (4.47 m–12.07 m), 3.38 ph n35 |
| headroom over narrow floor (median) | 5.3 m (3.23 m–14.19 m), 2.9 ph n22 | 4.88 m (3.58 m–14.06 m), 2.67 ph n13 | 4.29 m (2.95 m–8.94 m), 2.35 ph n35 |
| floor under open sky | 0 % (0 %–9 %) n22 | 38 % (26 %–51 %) n13 | 73 % (56 %–92 %) n35 |
| height range of the walked floor (p5 to p95) | 27.36 m (0.02 m–98.57 m), 14.96 ph n22 | 25.4 m (9.02 m–91.62 m), 13.89 ph n13 | 18.29 m (3.58 m–74.52 m), 10 ph n35 |
| floor levels (heights holding 2 % of the floor) | 5 (1–11.9) n22 | 9 (5–12.4) n13 | 8 (4–13) n35 |
| sightline (map's median place: its longest line) | 22.64 m (17.67 m–43.71 m), 12.38 ph n22 | 28.85 m (19.86 m–56.02 m), 15.78 ph n13 | 41.38 m (26.39 m–62.05 m), 22.62 ph n35 |
| crossing, walked | 233.76 m (51.07 m–452.21 m), 127.82 ph n13 | 290.91 m (137.64 m–515.72 m), 159.07 ph n10 | 252.23 m (99.23 m–414.9 m), 137.92 ph n26 |
| walked / straight | 2.42 (1.06–3.12) n13 | 2.75 (1.49–5.44) n10 | 1.8 (1.08–3.27) n26 |
| loops (cycles round 512-unit tiles) | 0 (0–2.3) n22 | 1 (0–4.2) n13 | 1 (0–5) n35 |
| stair riser (commonest) | 0.25 m (0.2 m–0.41 m), 0.14 ph n18 | 0.41 m (0.2 m–0.41 m), 0.22 ph n13 | 0.41 m (0.1 m–0.41 m), 0.22 ph n34 |
| stair flight rise | 1.07 m (0.81 m–3.03 m), 0.58 ph n14 | 0.81 m (0.81 m–3.86 m), 0.44 ph n11 | 1.02 m (0.81 m–2.35 m), 0.56 ph n22 |
| door width | 2.64 m (1.63 m–5.04 m), 1.44 ph n13 | 3.35 m (2.03 m–4.4 m), 1.83 ph n12 | 2.06 m (1.22 m–4.79 m), 1.13 ph n28 |
| door height | 3.25 m (2.44 m–5.6 m), 1.78 ph n13 | 3.66 m (2.99 m–5.85 m), 2 ph n12 | 3.15 m (2.16 m–5.02 m), 1.72 ph n28 |
| doors per map | 1 (0–14) n22 | 4 (0.8–16) n13 | 2 (0–13) n35 |

- **town** (4): under 8 maps: read the kind's bands. msr/deralia, msr/edana, msr/helena, msr/nightmare_edana.
- **unclear** (1): left out of the setting bands. msr/oceancrossing.

## Role-play cities (rp-city)

A role-play city: streets and plazas, buildings entered by named doors (homes, shops, cells), several layers joined by stairs and lifts, lit for night (The Specialists' role-play cities). 3 maps (tsrp/alexandria_msr_b5, tsrp/paradisecity_revival_final, tsrp/xenoncity_final). The city measures are levels/lib/city-measures.mjs's, on
the walked floor (levels/notes-rp-city.md says what each is). Each city's own value beside the band; with so
few cities the band's p10 and p90 are the cities' own extremes, near enough.

| measure | rp-city (3) | alexandria_msr_b5 | paradisecity_revival_final | xenoncity_final |
| --- | --- | --- | --- | --- |
| street floor under open sky | 1 862 m² (1 331 m²–2 828 m²) | 2 828 m² | 1 331 m² | 1 862 m² |
| street width under sky (median place) | 10.24 m (7.39 m–15.16 m), 5.6 ph | 15.16 m | 10.24 m | 7.39 m |
| street floor 4 m wide or more (vehicles) | 98 % (98 %–100 %) | 98 % | 98 % | 100 % |
| public floor (everything not behind a door) | 6 270 m² (3 006 m²–8 960 m²) | 8 960 m² | 6 270 m² | 3 006 m² |
| public floor that is roofed | 68 % (38 %–79 %) | 68 % | 79 % | 38 % |
| public way width (median place, roofed or not) | 8.15 m (6.35 m–8.81 m), 4.46 ph | 8.81 m | 6.35 m | 8.15 m |
| public way width (p10 place: the alleys) | 4.04 m (3.76 m–4.17 m), 2.21 ph | 4.04 m | 3.76 m | 4.17 m |
| public floor 4 m wide or more | 91 % (80 %–96 %) | 91 % | 80 % | 96 % |
| plazas (12 m wide both ways, 150 m2 or more) | 4 (1–5) | 5 | 1 | 4 |
| plaza floor (median plaza) | 229 m² (215 m²–296 m²) | 296 m² | 229 m² | 215 m² |
| junctions of the public ways (3 ways or more) | 25 (3–37) | 25 | 37 | 3 |
| junctions per hectare of public floor | 27.9 (9.98–59.02) | 27.9 | 59.02 | 9.98 |
| street length between junctions (median) | 8.94 m (8.94 m–11.07 m), 4.89 ph | 8.94 m | 11.07 m | 8.94 m |
| street width (median street's own median) | 5.69 m (4.36 m–6.09 m), 3.11 ph | 5.69 m | 4.36 m | 6.09 m |
| dead-end ways | 16 (2–28) | 28 | 16 | 2 |
| buildings behind doors | 22 (21–33) | 22 | 33 | 21 |
| buildings per hectare of walked floor | 26.61 (17.62–34.73) | 17.62 | 34.73 | 26.61 |
| rooms per building (median) | 2 (1–2) | 1 | 2 | 2 |
| room floor (median room) | 32 m² (25 m²–64 m²) | 64 m² | 32 m² | 25 m² |
| building floor (median building) | 73 m² (64 m²–133 m²) | 133 m² | 64 m² | 73 m² |
| apartment-sized buildings (15 to 150 m2) | 12 (9–24) | 12 | 24 | 9 |
| walked floor behind doors | 33 % (27 %–60 %) | 27 % | 33 % | 60 % |
| buildings named as homes | 9 (7–16) | 7 | 16 | 9 |
| buildings named as shops, bars, clubs | 4 (3–4) | 4 | 4 | 3 |
| buildings named as public (office, lab, bank, police ...) | 5 (2–8) | 2 | 8 | 5 |
| vertical layers (heights holding 2 % of the floor) | 9 (6–10) | 9 | 10 | 6 |
| lowest to highest layer | 34.44 m (34.14 m–71.53 m), 18.83 ph | 34.44 m | 34.14 m | 71.53 m |
| layer connectors (stairs and ramps, lifts, ladders, teleports) | 20 (20–34) | 20 | 34 | 20 |
| connectors per hectare | 25.34 (16.02–35.78) | 16.02 | 35.78 | 25.34 |
| lifts serving layers | 1 (1–6) | 1 | 6 | 1 |
| walk from public floor to the nearest connector (median) | 17.04 m (12.31 m–19.09 m), 9.32 ph | 19.09 m | 12.31 m | 17.04 m |
| walk from public floor to the nearest connector (p90) | 33.49 m (27.27 m–45.3 m), 18.31 ph | 45.3 m | 27.27 m | 33.49 m |
| rooms whose footprint repeats | 5 % (5 %–20 %) | 5 % | 5 % | 20 % |
| buildings whose footprint repeats | 0 % (0 %–0 %) | 0 % | 0 % | 0 % |
| brush models repeated (size and textures) | 35 % (31 %–62 %) | 31 % | 35 % | 62 % |
| world textures | 236 (64–444) | 444 | 236 | 64 |
| textures per 13 m tile (median) | 13 (12–13) | 13 | 12 | 13 |
| districts (like texture palettes, 3 tiles or more) | 13 (3–13) | 13 | 13 | 3 |
| district size (median) | 846 m² (846 m²–1 860 m²) | 846 m² | 846 m² | 1 860 m² |
| floor light (median place, 0 to 255) | 60.4 (55.5–94.3) | 55.5 | 60.4 | 94.3 |
| floor in shadow (light under 24) | 8 % (5 %–11 %) | 11 % | 8 % | 5 % |
| floor brightly lit (128 or more) | 10 % (4 %–24 %) | 10 % | 4 % | 24 % |
| public floor light (median) | 56.3 (52.6–94.3) | 52.6 | 56.3 | 94.3 |
| room floor light (median) | 70.6 (67.8–93.2) | 67.8 | 70.6 | 93.2 |
| light entities per hectare | 83.3 (55.8–117.8) | 83.3 | 55.8 | 117.8 |
| lights warm (red, orange, yellow) | 37 % (21 %–77 %) | 77 % | 21 % | 37 % |
| lights cool (green, cyan, blue, purple) | 23 % (16 %–55 %) | 16 % | 55 % | 23 % |
| lights white (pale) | 25 % (7 %–41 %) | 7 % | 25 % | 41 % |
| doors (func_door, rotating, momentary) | 99 (98–111) | 111 | 99 | 98 |
| doors with a name | 99 (98–109) | 109 | 99 | 98 |
| switches (buttons) | 46 (38–53) | 53 | 46 | 38 |
| spawn points | 15 (9–19) | 15 | 19 | 9 |
| cell doors (cell, jail, prison) | 7 (4–18) | 18 | 4 | 7 |
| lifts the walk rides | 2 (1–6) | 2 | 6 | 1 |
| trains (func_train) | 6 (6–8) | 8 | 6 | 6 |
| teleports | 3 (0–13) | 3 | 0 | 13 |
| ladders | 8 (6–8) | 6 | 8 | 8 |
| hidden ways (disguised doors, wall toggles, secret names) | 6 (5–15) | 5 | 15 | 6 |
| func_illusionary | 48 (44–57) | 44 | 48 | 57 |
| props (ts_model and the like) | 101 (70–214) | 101 | 214 | 70 |
| sounds | 47 (38–94) | 94 | 47 | 38 |

The kind's general measures (width, headroom, sight ...) are in the table of all kinds.

## All kinds side by side

| measure | coop-campaign (91) | linear (91) | arena (41) | exploration (75) | rp-city (3) |
| --- | --- | --- | --- | --- | --- |
| floor width (map's median place) | 7.98 m (5.01 m–16.1 m), 4.43 ph; bare 8.1 m n91 | 7.72 m (4.85 m–22.79 m), 4.22 ph n91 | 7.58 m (5.65 m–14.08 m), 4.15 ph n41 | 12.22 m (6.22 m–19.86 m), 6.68 ph n75 | 6.25 m (5.84 m–7.37 m), 3.42 ph n3 |
| corridor width (map's p5 place: its narrowest common floor) | 2.36 m (1.76 m–4.35 m), 1.31 ph; bare 2.43 m n91 | 3.43 m (2.41 m–7.06 m), 1.87 ph n91 | 3.23 m (2.61 m–4.44 m), 1.76 ph n41 | 3.94 m (2.62 m–6.45 m), 2.15 ph n75 | 2.92 m (2.49 m–3.02 m), 1.6 ph n3 |
| passage width (gaps between walls, median) | 2.16 m (1.76 m–2.78 m), 1.2 ph n34 | 2.44 m (1.51 m–3.66 m), 1.33 ph n84 | 2.86 m (2.39 m–4.06 m), 1.57 ph n41 | 2.74 m (2.01 m–3.72 m), 1.5 ph n73 | 1.93 m (1.63 m–2.24 m), 1.06 ph n3 |
| main path width (median) | 4.96 m (3.74 m–6.78 m), 2.76 ph n34 | — | — | — | — |
| narrow floor share (under 2 player heights) | 14 % (3 %–31 %); bare 13 % n91 | 7 % (1 %–16 %) n91 | 8 % (3 %–25 %) n41 | 4 % (1 %–19 %) n75 | 11 % (11 %–16 %) n3 |
| open-space width (map's p95 place: its big rooms and yards) | 23.49 m (11.9 m–62.04 m), 12.85 ph; bare 28.68 m n91 | 15.82 m (9.13 m–38.61 m), 8.65 ph n91 | 18.36 m (13.63 m–35.72 m), 10.04 ph n41 | 27.89 m (14.07 m–47.24 m), 15.25 ph n75 | 16.94 m (13.11 m–29.29 m), 9.26 ph n3 |
| wide floor share (4 player heights and over) | 35 % (21 %–54 %) n34 | 52 % (21 %–95 %) n91 | 51 % (34 %–78 %) n41 | 77 % (38 %–93 %) n75 | 40 % (33 %–50 %) n3 |
| walked floor | 17 573 m² (7 033 m²–34 595 m²) n91 | 1 727 m² (586 m²–7 362 m²) n91 | 3 977 m² (1 996 m²–9 608 m²) n41 | 5 682 m² (1 519 m²–16 186 m²) n75 | 9 447 m² (7 970 m²–12 539 m²) n3 |
| headroom, roofed floor (median) | 4.19 m (3.25 m–7.9 m), 2.29 ph n57 | 6.1 m (4.12 m–30.24 m), 3.33 ph n91 | 4.88 m (4.06 m–7.88 m), 2.67 ph n41 | 6.5 m (4.06 m–15.52 m), 3.56 ph n75 | 4.24 m (4.06 m–4.37 m), 2.32 ph n3 |
| headroom over narrow floor (median) | 4.06 m (3.25 m–7.16 m), 2.22 ph n57 | 4.06 m (3.25 m–12.24 m), 2.22 ph n89 | 4.35 m (3.25 m–6.16 m), 2.38 ph n40 | 4.47 m (3.23 m–11.58 m), 2.44 ph n75 | 3.51 m (3.45 m–4.09 m), 1.92 ph n3 |
| floor under open sky | 83 % (15 %–95 %) n57 | 0 % (0 %–75 %) n91 | 12 % (0 %–70 %) n41 | 56 % (0 %–90 %) n75 | 23 % (14 %–24 %) n3 |
| height range of the walked floor (p5 to p95) | 24.04 m (8.27 m–102.17 m), 13.17 ph n91 | 10.19 m (0.03 m–55.04 m), 5.57 ph n91 | 10.16 m (4.83 m–21.18 m), 5.56 ph n41 | 21.67 m (2.84 m–75.18 m), 11.85 ph n75 | 35.36 m (34.04 m–56.92 m), 19.33 ph n3 |
| floor levels (heights holding 2 % of the floor) | 14.5 (9.9–18) n34 | 5 (2–9) n91 | 7 (3–10.9) n41 | 7 (3–13) n75 | 12 (7–14) n3 |
| sightline (map's median place: its longest line) | 50.67 m (32.93 m–76.2 m), 27.71 ph; bare 76.2 m n57 | 23.09 m (15.42 m–61.89 m), 12.62 ph n91 | 25.99 m (19.1 m–45.32 m), 14.21 ph n41 | 34.47 m (20.29 m–56.51 m), 18.85 ph n75 | 22.71 m (19.2 m–28.45 m), 12.42 ph n3 |
| crossing, walked | 703.89 m (300.31 m–1541.01 m), 384.89 ph n77 | 87.74 m (37.87 m–205.08 m), 47.98 ph n56 | 117.47 m (76.77 m–185.57 m), 64.23 ph n41 | 244.25 m (84 m–426.39 m), 133.56 ph n53 | 19.1 m (13 m–366.37 m), 10.44 ph n3 |
| walked / straight | 1.99 (1.3–5.84) n77 | 1.98 (1.12–5.77) n56 | 2.45 (1.18–6.18) n41 | 2.02 (1.07–3.36) n53 | 1.08 (1.05–2.39) n3 |
| winding per 100 m of route | 1.52 (1.31–1.97) n34 | — | — | — | — |
| loops (cycles round 512-unit tiles) | 6 (1–18.1) n34 | 0 (0–2) n91 | 3 (0–6.1) n41 | 1 (0–5) n75 | 5 (4–6) n3 |
| alternative routes | l4d2: 2; vt2: 0 | — | — | — | — |
| floor off the route | 30 % (17 %–40 %) n34 | — | — | — | — |
| stair riser (commonest) | 0.2 m (0.14 m–0.2 m), 0.11 ph n54 | 0.2 m (0.13 m–0.41 m), 0.11 ph n80 | 0.2 m (0.2 m–0.41 m), 0.11 ph n41 | 0.41 m (0.17 m–0.41 m), 0.22 ph n70 | 0.2 m (0.2 m–0.23 m), 0.11 ph n3 |
| stair flight rise | 1.51 m (0.81 m–2.55 m), 0.83 ph n54 | 1.42 m (0.81 m–3.25 m), 0.78 ph n39 | 1 m (0.81 m–3.25 m), 0.55 ph n24 | 1.02 m (0.81 m–2.48 m), 0.56 ph n51 | 1.63 m (1.42 m–1.83 m), 0.89 ph n2 |
| door width | 1.47 m (1.4 m–1.52 m), 0.81 ph n57 | 2.44 m (1.63 m–5.87 m), 1.33 ph n66 | 2.44 m (1.37 m–5.03 m), 1.33 ph n21 | 2.49 m (1.42 m–4.54 m), 1.36 ph n58 | 1.47 m (1.42 m–1.8 m), 0.81 ph n3 |
| door height | 2.72 m (2.67 m–2.84 m), 1.49 ph n57 | 2.77 m (2.44 m–4.65 m), 1.51 ph n66 | 2.84 m (1.68 m–4.28 m), 1.56 ph n21 | 3.25 m (2.44 m–4.88 m), 1.78 ph n58 | 2.51 m (2.39 m–2.74 m), 1.37 ph n3 |
| doors per map | 13 (3.2–37.8) n57 | 3 (0–8.4) n91 | 1 (0–8.4) n41 | 2 (0–15) n75 | 81 (72–94) n3 |
| drop height | l4d2: 2.41 m; vt2: 3.56 m | — | — | — | — |
| first event (fraction of the route) | l4d2: 0.625; vt2: 0.165 | — | — | — | — |
| events per km of route | l4d2: 3.2; vt2: 11.62 | — | — | — | — |
| spacing of open spaces along the route | 83.43 m (66.53 m–134.74 m), 46.35 ph n34 | — | — | — | — |

Pacing, event positions by tenths of the route (each map one vote):
- Left 4 Dead 2 (crescendos and finale triggers, 52 maps): 3 % · 4 % · 5 % · 10 % · 8 % · 15 % · 14 % · 9 % · 16 % · 16 %
- Vermintide 2 (boss routes, 32 maps): 0 % · 11 % · 17 % · 11 % · 10 % · 11 % · 10 % · 10 % · 9 % · 9 %

## Gaps

- **coop-campaign**: branches and dead ends.
- **linear**: branches and dead ends; floor off the route; drop height.
- **arena**: branches and dead ends; floor off the route; drop height.
- **exploration**: branches and dead ends; floor off the route; drop height.
- **rp-city**: branches and dead ends; floor off the route; drop height.
- Every kind but rp-city: no corpus segments rooms (room size stands on the open-space width and walked
  floor), counts branches or dead ends, or measures cover. rp-city's rooms are cut at doors only (a room open
  to a street is street). Vermintide 2 has no solid geometry (no headroom, sight, doors or
  stairs); Left 4 Dead 2 only brackets width and sight. See levels/notes-*.md.
