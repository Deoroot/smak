# Vermintide 2's files, read (investigation, 2026-10-31)

Python scripts that read Warhammer: Vermintide 2's bundles on this machine, read-only. Nothing of the game's goes
into this repository: what they extract goes to `out/`, `names.txt`, `index.tsv`, `known.tsv`, `idents.txt` and `ident_hashes.tsv` beside them,
which are local and not to be committed. Needs Python with `zstandard` (a scratch venv: `python -m venv env`,
`env/Scripts/python -m pip install zstandard`).

| script | what it does |
| --- | --- |
| `bundle.py` | a bundle decompressed (zstd chunks, the game's `bundle/compression.dictionary`) |
| `vt2index.py` | MurmurHash64A (Stingray's names), every bundle's index, a count of files by type |
| `files.py` | a bundle's files whole |
| `strings.py`, `resolve.py` | path strings from the Lua and units, hashed back to names (`known.tsv`) |
| `machine.py` | a state machine's clips (animation hashes found in its bytes), extracted |
| `getres.py` | one resource by type and path |
| `skeleton.py` | a skeleton: bone names (`bones`) and parents (the unit's scene graph, joined by name hash) |
| `anim.py` | a clip decoded and sampled; the format is written at its top |
| `survey.py`, `draw.py` | clips ranked by hand speed; stick figures from the eye and above |
| `idents.py` | every identifier of `names.txt` hashed, to name states and events back |
| `luajit.py` | the game's LuaJIT bytecode: constants, and the main chunk followed for the tables it builds |
| `statemachine.py` | a state machine's layers and states (name, clips, events, transitions); the layout is at its top |
| `attacks.py` | every action of the melee and ranged weapon templates: its events, damage window or fire time, and the states and clips they play, followed through the combo chains, with blend-in times (`out/attacks.json`) |
| `timing.py` | a check: each swing's peak hand speed against its damage window |
| `weapons.py` | each template's weapon unit (from the item lists) and its tip and butt, read from every geometry of the unit's mesh placed by its node (the unit's scene graph), kept when its handle passes through the hand (`out/weapons.json`) |
| `arms.py` | each hero's first-person arm mesh (units/beings/player/<hero>/first_person_base/chr_first_person_mesh): bind-pose bones, skinned vertices, triangles (`out/arms.json`, local), for `anim/tools/arms.mjs survey` |
| `thirdperson.py` | the third person (the body other players see): for each hero who can wield a template (the item lists' `can_wield`), the hero's third-person machine and skeleton (`units/beings/player/<hero>/third_person_base/chr_third_person_base`, `units/beings/player/third_person_base/<hero>/chr_third_person_base`), the template's `wield_anim` and every event followed layer by layer to its state, clip and blend-in (`out/attacks3p.json`, `out/tp_skeleton_<hero>.json`), for `anim/tools/body.mjs` |
| `ranged.py` | a check on ranged clips: the kick against fire time, the off hand against the weapon, the weapon parts moved |

The order: `strings.py` and `resolve.py` once (some 7 minutes), then `machine.py <state machine path>`, then
`getres.py bones|unit units/beings/player/first_person_base/chr_first_person_base`, `skeleton.py`, `survey.py`.
For the attacks: `idents.py`, then `attacks.py` (a few seconds; it extracts the clips it needs, and writes each
template's idle clips to `out/templates.json`), `weapons.py`, then `timing.py`. The third person: `thirdperson.py`
(after `strings.py`, `idents.py` and `attacks.py`; a minute), then `node anim/tools/body.mjs`. SMAK's judge then reads the cache
through `anim/lib/vt2.mjs` (Node; no Python needed past this point): `node anim/tools/defects.mjs --games vt2`,
`node anim/tools/judge.mjs survey --game vt2` (the default reference's bands), and pictures with
`node anim/tools/vt2view.mjs <template> [<event>] [--idle]` (into build/anim/vt2/, local).
