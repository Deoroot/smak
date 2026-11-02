# Level descriptions

A level described before any geometry exists: its spaces, how they link, the route, the pacing, the rewards and
the grid a modular kit lays it out on. Phase 3 of PLAN.md. The checks run on the description alone:

```
node levels/tools/check-description.mjs levels/specs/rpg-dungeon-01.json [--bands file.json|msr-provisional|none] [--json out.json] [--verbose]
```

A whole city (layers, districts, streets, buildings, homes, tiles) has its own format: CITY.md
(`smak-city-description/1`, `levels/tools/check-city.mjs`, first spec `newbyzantium.json`).
What today's generators (SMAK's and New Byzantium's) can and cannot build from these formats: `levels/notes-generator.md`.

Code: `levels/lib/description.mjs` (the format, validation, sizes), `levels/lib/description-checks.mjs` (the
checks, the bands held, a provisional MSR fixture). Tests: `test/117-level-description.mjs`.

## The format (`smak-level-description/1`)

```jsonc
{
  "format": "smak-level-description/1",
  "name": "rpg-dungeon-01",
  "style": { "kind": "rpg-exploration", "theme": "fantasy-dungeon" },   // kind picks the default bands
  "grid": { "cell": 2.5, "storey": 3.0, "wall": 0.225, "door": [1.3, 2.44], "gate": [3.25, 3.25], "stairRise": 0.1875, "stairRun": 0.3125 },
  "sizes": { "room": { "m": [4, 6] } },                                 // optional: override a size class, in cells
  "route": { "start": "gatehouse", "goal": "tomb", "hubs": ["great_hall"] },
  "spaces": [ { "id": "great_hall", "type": "hall", "size": "m", "storey": 0, "pacing": "fight",
                "encounters": [{ "size": "medium", "count": 1 }], "reward": { "kind": "loot" }, "key": "iron-key" } ],
  "links":  [ { "from": "great_hall", "to": "great_stair", "type": "gate", "key": "iron-key" } ]
}
```

- **grid**: `cell` and `storey` in metres are required (everything else is for the layout to come). Sizes are in
  cells, so one description fits any kit on that grid. `door` and `gate` are the clear [width, height] in metres of
  a door (and a secret door) and of a gate, held to the architecture rulebook (`levels/rules/`); a hall that
  stands over two storeys (`storey: [low, high]`) gets the rulebook's hall ceiling.
- **spaces**: `type` is room, corridor, hall, cave, yard or stair. `size` is a class (s, m, l, xl) or `cells:
  [w, d]` (halves allowed). The classes, in cells: room 3x3, 4x5, 6x6, 8x8; hall 4x6, 6x8, 8x10, 10x14;
  corridor 1x4, 1x6, 1x10, 2x14; cave 3x4, 5x6, 8x10, 12x14; yard 6x6, 8x8, 12x12, 16x16; stair 1x3, 2x4, 2x6,
  4x6. `storey` is an integer, or `[low, high]` for a stair, hall, cave or yard that stands over several.
  `pacing` is quiet (the default), tension, fight or rest; a fight wants `encounters` (slots sized small,
  medium, large or boss, weighing 1, 2, 4, 8, with a `count`). `reward` is `{ kind }` or a list; `key` (or
  `keys`) names a key lying there, which counts as a reward. `side: true` marks a co-op style side area.
- **links**: `type` is door, open, stair, drop, gate or secret. A gate needs its `key`; a drop goes one way, to a
  lower storey (or gives a `height` in metres within one); `oneWay: true` makes any link one way (a door that
  bars behind you). Door, open, gate and secret join spaces sharing a storey; a stair joins two.
- **route**: `start`, `goal`, and the `hubs` the designer means (each must have 3 neighbours).

A space's walk is its long side for a corridor or stair, the mean of its sides for the rest; a link costs half of
each space it joins. That gives the route length from size classes and the grid alone.

## The checks

Every level (FAIL when broken): valid, field by field; every space reachable from the start (secrets count, and
the spaces only a secret reaches are noted); the goal reachable without a secret; every key reachable with its
own gates shut; no state (a space and the keys held) the player can reach from which the goal is lost, so a drop
into a dead end fails; the hubs named have 3 neighbours.

Measured, and held to a bands object when given (`{ metrics: { name: { p5, q1, median, q3, p95, min, max } } }`;
outside min/p5..max/p95 fails, outside q1..q3 is a note): `spaces`, `area` (m², footprints), `storeys`,
`routeLength` (the critical walk: keys fetched, walking back included), `directLength` (every gate open),
`backtrack` (their ratio), `loops` (edges − spaces + parts, over links walked both ways, as the corpus's floods
walk no drop), `oneWayLoops` (cycles a drop or a one-way link closes), `hubs` (spaces with 3+ neighbours), `branches`
(links off the critical walk), `deadEnds`, `rewardedDeadEndShare`, `offPathShare` (area off the walk),
`fightShare`, `firstFightAt`, `lastFightAt`, `peakAt` (the heaviest encounter, as a fraction of the walk),
`lastThirdShare` (encounter weight in the walk's last third), `maxFightRun`, `restBeforePeak`, and counts of
keys, gates, drops, secrets and encounters. The pacing curve (each encounter space at its first visit) is in the
`--json` detail.

**Bands are provisional.** `MSR_EXPLORATION_PROVISIONAL` takes `directLength`, `area`, `storeys` from MSR's 31
interior maps and `loops` from all 84 (levels/corpus/levels-msr.json); the rest are judged, as no survey yet
measures rooms, branches or rewards. A style file of `levels/styles/` is read by `bandsFromStyle` (`--bands
levels/styles/fantasy-dungeon.json`): its `crossing`, `walkedArea`, `loops`, `branches` and `offPathShare`, where
banded, held against `directLength`, `area`, `loops`, `branches`, `offPathShare`.

## rpg-dungeon-01: The Sunken Abbey

MSR-style exploration for rpg_sbox, 2.5 m grid, 3.0 m storeys. Upper halls over crypts, 24 spaces on 3
storeys. Two hubs (great hall, crypt hub); the iron key in a branch off the library opens the stair down, the
crypt seal in a dead end off the bone pit opens the tomb. Two loops (the cloister above, the collapsed tunnel
below); five dead ends all rewarded, the treasury behind a secret. A co-op style side route: a drop from the
flooded gallery into the sunken channel (a horde) and a stair back up to the well room, the rest before the
boss. Its check: PASS against the provisional MSR bands and against `levels/styles/fantasy-dungeon.json` and
`exploration.json`: route 260 m (direct 124 m), 2 loops (and one the drop closes), 24 % off the path, fights at 0.10, 0.20, 0.62,
0.81 and the boss at 0.97.
