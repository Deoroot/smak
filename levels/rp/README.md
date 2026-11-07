# smak_rp: missions for SMAK's role-play maps (TS on H9)

GTA-style missions: a player talks to a mission giver, picks a job, and they and their party are put in a sealed
arena of the map to do it. However it ends, the survivors are put back in the city. What the map and the plugin
promise each other is in `CONTRACT.md`.

**First version: compiled, never played.** The list at the end is what has to be tried in the game.

## What the plugin does

- Reads `addons/amxmodx/configs/smak_rp/<mapname>.rp.json` (`smak-rp/1`) when the map loads. No file: the plugin
  does nothing on that map. A file whose `map` is not the map running is refused; either way the server's AMXX
  log (`addons/amxmodx/logs/`) says so, and says what it loaded, every mission it left out and why, and every step
  target or reset the map does not have.
- Makes each NPC: its model standing at `at` (the floor point), facing `yaw`, a solid player-sized box.
- Press **use** looking at an NPC within about 96 units: a menu of its missions, with how many players each
  takes and "busy" when its arena is in use. Only a party's leader (or a player alone) can take one.
- The members of the leader's party within 512 units of the NPC are asked "go with them?" (15 seconds). Too few
  yes for the mission's least: nothing happens. Then: the arena is held, its `reset` entities fired, its
  `destroy` targets put back, the members put at `spawns` with full health, the time started.
- The steps in order, each `say` shown in the middle of the screen and in chat; a line at the top shows the
  mission, the step and the time left. `reach` (touch the `trigger_multiple`), `use` (press the `func_button`),
  `destroy` (the `func_breakable` broken, by anyone), `survive` (the step's `time` passes).
- Ends **done** (reward: frags, to every member still in it), **failed** (time out, or no member left in it) or
  **quit**. Every member still in the mission is put at `back`. A member who dies or leaves the server is out;
  the mission goes on with the rest.

## Chat commands

| command | what it does |
| --- | --- |
| `/party` | menu: invite a player near you (512 units), join a party you were invited to, leave the party, who is in it. At most 4. The invited player also gets a join/no menu at once. A leader who leaves hands the party to the next member. |
| `/quit` | leave the mission. The mission's leader calls it off for everyone; another member leaves alone and is put back in the city. |

## Install (on the H9 server)

1. `levels/rp/plugin/build/smak_rp.amxx` to `ts/addons/amxmodx/plugins/`.
2. A line `smak_rp.amxx` at the end of `ts/addons/amxmodx/configs/plugins.ini`.
3. The map's `.bsp` to `ts/maps/`, its `.rp.json` to `ts/addons/amxmodx/configs/smak_rp/` (make the folder).
4. The modules it uses are all in H9's `modules/`: fakemeta, hamsandwich, engine, json (they load by themselves).

To compile it again (nothing is written into the game folder):

```
"C:/Juegos/H9XASH/ts/addons/amxmodx/scripting/amxxpc.exe" levels/rp/plugin/smak_rp.sma -iC:/Juegos/H9XASH/ts/addons/amxmodx/scripting/include -olevels/rp/plugin/build/smak_rp.amxx
```

## The test map

`node levels/rp/test-map.mjs` builds `levels/rp/build/smak_rp_mtest.bsp` and `smak_rp_mtest.rp.json` (VHLT at
`C:/Herramientas/vhlt`, Half-Life's `halflife.wad`, which H9 has in `valve/`). A lit hall with four starts and
the spot of one giver (Marco the Fixer, TS's `merc` model), and far east a sealed yard: a green pad in the far
left corner (the `reach` goal), a small button on the far wall (the `use`), a crate by the south wall (the
`destroy`), and a reset that rings a bell when a run starts. Two missions, 1 to 4 players, 2 minutes each:

- **The Signal**: get to the green pad, then press the button. Reward 1 frag.
- **Break and Hold**: break the crate, then hold out 20 seconds. Reward 2 frags.

To try it: install as above, `map smak_rp_mtest`, walk to the NPC at the far end of the hall, press use. With a
second player (or a bot that will not answer: it is left behind after 15 s), `/party` first.

The `.bsp` names Half-Life's textures; keep it on your machine (it is not to be shared).

## Untested (needs the game)

Everything that happens at run time. In particular:
- the NPC: is it drawn, at the right height (feet on the floor), playing `standard_idle`, solid; does a player's
  use reach the plugin (TS's own use of the key for weapons)
- menus (`menu_create`) on TS: shown, numbered keys work, the join/no menu while moving
- the teleport: player stuck, view turned to `yaw`, during TS slow motion or a stunt, while ducking
- health filled (TS's own health handling, kevlar), frags added and shown on the scoreboard (only `pev_frags` is
  set: the scoreboard may show it late)
- `trigger_multiple` touch, `func_button` use and `func_breakable` death seen by the hooks in TS
- the crate put back for a second run (spawned again from its map keys), the bell heard
- a member's death seen at once (TS respawns fast; a one-second check also catches it)


# smak_npc: the city's own people (phase 1)

A second plugin, separate from `smak_rp` so H9's leader can switch it off (take its line out of `plugins.ini`, or
`smak_npc_enable 0`). It reads the same `configs/smak_rp/<map>.rp.json`, refusing one whose `map` is not the map
running. Design: `NPCS.md` (option C). **First version: compiled, never played.** The offline check
(`npc-sim.mjs`) holds only what the JSON gives; how they look and move is for the game to say.

## What it does

- **Clock**: a day lasts `smak_npc_day` real minutes (48), taken from the server's wall clock so it survives a map
  change. Shifts: shopkeepers, medic, mechanic 7-20 h (the barman 15-02 h); workers at the workshop 7-17, the bar
  17-22, home otherwise; citizens out on the streets 8-19, the bar 19-22, home otherwise. Each person has up to 45
  minutes of game-time jitter, so the city does not move on the hour.
- **Roles from the JSON's `places` kinds**: `shop` shopkeeper, `bar` barman, `clinic` medic (`ins_medic`),
  `workshop` mechanic; then up to `smak_npc_workers` workers (live in `hollow` flats, work at the workshop) and
  citizens, up to `smak_npc_max` (24; hard cap 40). Each lives in a `home` property: a keeper in its own building
  if it has a flat. On `smak_rp_byz01` at 24: 5 shopkeepers, 1 barman, 1 medic, 1 mechanic, 6 workers, 10 citizens.
- **Movement**: A* over `paths` using `walk` and `stair` links only. A link through a plain `door` is taken
  when the door belongs to a shop or a public room, or is the walker's own home (it opens the door by its
  targetname, as a use). Never: checkpoint gates (`smak_npc_gates 1` lets them through), lids, grates, the secret
  door, the trapdoor, ladders, jump-downs, other people's flats, the police rooms, the cells, the hideout.
  A citizen of Mese cannot reach the market's bar without a gate, so its evening is on its streets.
- **Animation**: the player model's own full-body `walk2` and `run2` (the rate set from the model's ground speed),
  `standard_idle`. (The player models' leg-and-torso split is for players; an NPC entity plays one sequence.)
- **Reactions**: a shot (any player's weapon event) or a hurt player makes those within `smak_npc_hear` (1100)
  run to a node 120-1100 units off and farther from the sound, with a 60% chance of a stunt first (`roll_f`,
  `roll_f_high` or `wheel_f` with a speed burst, only after a hull trace of the path and of the floor under it),
  cower 6-10 s, then go back to their day.
- **Talk**: use key on one within 96 units: a line by role and time of day, in English (`smak_npc_lang 0`) or
  Spanish (1; no accents, the chat font may not have them). It stops and turns to you for 4 s. No buying and no
  healing yet (no currency; see `NPCS.md`).
- **Budget**: one with no player within `smak_npc_near` (1500) is stepped once a second along its route, with no
  collision and no animation; the others think ten times a second. One path (A*) is computed each tenth of a
  second at most, flees first. One asleep at home with nobody near is not drawn.

## Install

1. `levels/rp/plugin/build/smak_npc.amxx` to `ts/addons/amxmodx/plugins/`.
2. A line `smak_npc.amxx` after `smak_rp.amxx` in `ts/addons/amxmodx/configs/plugins.ini`.
3. The map's `.rp.json` in `ts/addons/amxmodx/configs/smak_rp/` (the missions plugin's file; the same one).
4. Models, already in H9: `player/proletarian`, `proletarian_dirty`, `proletarian_healthy`, `prole_fem`,
   `prole_bfem`, `ins_medic`. One missing is left out (the log says so).

Cvars (put them in `server.cfg`): `smak_npc_enable 1`, `smak_npc_max 24`, `smak_npc_workers 6`, `smak_npc_day 48`,
`smak_npc_near 1500`, `smak_npc_walk 100`, `smak_npc_run 220`, `smak_npc_hear 1100`, `smak_npc_lang 0`,
`smak_npc_gates 0`, `smak_npc_debug 0`. Admin (rcon) commands: `smak_npc_status`, `smak_npc_hour <0-24>`,
`smak_npc_scare`.

To compile again (nothing is written into the game folder):

```
"C:/Juegos/H9XASH/ts/addons/amxmodx/scripting/amxxpc.exe" levels/rp/plugin/smak_npc.sma -iC:/Juegos/H9XASH/ts/addons/amxmodx/scripting/include -olevels/rp/plugin/build/smak_npc.amxx
node levels/rp/npc-sim.mjs <map>.rp.json     # roles, counts and routes; PASS / FAIL on the last line
```

## Trying it in the game

1. `map smak_rp_byz01`; the AMXX log (`addons/amxmodx/logs/`) says `[smak_npc] ... N NPC(s)`, the roles and the
   graph size. A line `no model` or `refused` says why not.
2. `smak_npc_status` (console): 24 lines, role, state, slot, position. They should be standing in their places
   for the hour; `smak_npc_hour 12` then `smak_npc_hour 23` moves the clock.
3. Walk up to a shop in the Mese by day: a keeper stands inside, idle pose, feet on the floor, facing any way.
4. `smak_npc_hour 8`, stand in a street: citizens come out of their doors (the door opens, they pass), walk (legs
   move, not sliding), stop, wander. Watch a stair: do they climb it or float up it?
5. `smak_npc_hour 22`: they walk home and go in; the street empties.
6. Fire a shot (any weapon) near one: it should run (arm and leg cycle), away from you, maybe roll first; it
   stops 6-10 s later and goes on. `smak_npc_scare` does the same without a shot.
7. Use key on one: a line in the chat, and it turns to you.
8. Stand in a doorway or a stair while they walk: nobody should get stuck in you or you in them; if one stays
   still more than a few seconds, note where (`smak_npc_status` gives its place) and `smak_npc_debug 1`.
9. Count entities with 24 NPCs: the city's ~1470 plus 24.

## Phase 0 probe (`smak_probe`)

A throwaway plugin that answers the unverified assumptions of `NPCS.md` 5.12 on the H9 server before any
character code is written. It changes nothing but its own files (`data/sqlite3/smak_probe.sq3`,
`data/vault/smak_probe.vault`, `logs/smak_probe.log`) and the stats of the admin who types `/probe`.

**Install**

1. `levels/rp/plugin/build/smak_probe.amxx` to `ts/addons/amxmodx/plugins/`.
2. A line `smak_probe.amxx` in `ts/addons/amxmodx/configs/plugins.ini`.
3. Start the server (dedicated) and join once. Do not add `sqlite` or `nvault` to `modules.ini`: the probe asks for
   them itself, and that is part of what it tests.

**In the game** (an admin with ADMIN_RCON, or the host of a listen server; the player must be alive)

1. Join. Read the log (below): the startup tests and the join/userinfo lines are already there.
2. Say `/probe` (or `smak_probe` in the console). Look: two HUD messages (yellow upper middle on channel 3, blue
   lower middle on channel 4, the second with three lines, the last one long) and a MOTD page. Say what you saw:
   did both HUDs show, was the long line cut, did the MOTD draw colours, a heading, a list and a table.
   Run around and jump: is it faster, floatier? Wait 5 seconds.
3. Say `/probe off`.
4. Join with a second client (the H9 one, and if you can a non-H9 one) and send the log again.

**Where to read** `ts/addons/amxmodx/logs/smak_probe.log` (the same lines are in `L<date>.log`). One line per test,
`[smak_probe] <test>: OK|FAIL <detail>`:

| Test | When | What it says |
| --- | --- | --- |
| `start` | map load | version, map, data folder, dedicated or not |
| `lib_sqlx`, `lib_sqlite`, `lib_nvault` | map load | did the includes' autoload bring the modules up |
| `sqlite_sync` | map load | connect, create table, insert, select back; the file path found; time (gametime may read 0.0) |
| `sqlite_threaded` | a moment later | the same through `SQL_ThreadQuery`; the queue time |
| `nvault` | map load | set, get, close, reopen, get |
| `summary` | when the six above are done | `OK|FAIL n OK, m FAIL of 6` |
| `player_auth`, `player_join` | a player joins | authid, ip, name, bot, hltv, admin flag |
| `userinfo`, `userinfo_ids`, `userinfo_named` | 2 s after joining | every userinfo key name; values of keys with `id` or `steam` in the name; `*sid`, `*hid`, `h9id`, ... read one by one |
| `probe_before`, `probe_readback_now` / `_0.5s` / `_3s` | `/probe` | stats before, then what `pev` reads right after setting, 0.5 s and 3 s later (`OK` = still 400 / 0.5 / 150 / 75, `CHANGED` = TS moved it) |
| `probe_hud_motd` | `/probe` | that the HUD and the MOTD were sent (what showed is for the person to say) |
| `probe_off`, `probe_readback_after_off` | `/probe off` | restore (health 100, speed and armor as before `/probe`, gravity 1.0) |

Compile again (nothing is written into the game folder):

```
"C:/Juegos/H9XASH/ts/addons/amxmodx/scripting/amxxpc.exe" levels/rp/plugin/smak_probe.sma -iC:/Juegos/H9XASH/ts/addons/amxmodx/scripting/include -olevels/rp/plugin/build/smak_probe.amxx
```

## Phase 1: characters and money (`smak_core`)

One saved character per player identity, with money, in SQLite on the server (`NPCS.md` 5.5, 5.6, 5.7, 5.11).
**Compiled, never played.** The probe (phase 0) proved the calls it uses: sqlite through `SQL_ThreadQuery`, a file in
`data/sqlite3/`.

**Install**

1. `levels/rp/plugin/build/smak_core.amxx` to `ts/addons/amxmodx/plugins/`.
2. A line `smak_core.amxx` in `ts/addons/amxmodx/configs/plugins.ini`, **before** any plugin that will use its natives.
   (`smak_rp` and `smak_npc` do not use it yet; reward.money is phase 2.) Nothing in `modules.ini`: it asks for sqlite
   itself, like the probe.
3. Optional cvars in `configs/amxx.cfg` or `server.cfg` (defaults shown):

| cvar | default | what |
| --- | --- | --- |
| `smak_core_dev` | `0` | `1`: the host of a listen server (`ID_LOOPBACK`) is a normal identity and may use the admin commands. Set it only to test on a local server; every local player then shares one character |
| `smak_core_currency` | `creditos` | the money's name in messages |
| `smak_core_start_money` | `100` | money of a new character (and of a guest, each session) |
| `smak_core_notify` | `1` | `1`: an event-box line when the money changes |
| `smak_core_events` | `1` | `1`: events are drawn in the event box (HUD, upper-left); `0`: they are chat lines (see "The event box") |

**Who is who.** The key is `auth:<get_user_authid>`. `STEAM_ID_LAN`, `VALVE_ID_LAN`, `STEAM_ID_PENDING` (still pending when
the player is in), empty, bots, HLTV, and `ID_LOOPBACK` (with `smak_core_dev 0`) play as **guests**: a character with the
starting money that is never saved; the chat says so on join. One function, `core_identity()`, decides this, so phase 9
(`/register`, `/login`, H9's own id) changes only that.

**Commands**

| where | command | who | what |
| --- | --- | --- | --- |
| chat | `/dinero`, `/money` | everyone | the balance |
| chat | `/yo`, `/me` | everyone | name, money, time played (`/me text` is left to chat plugins) |
| console | `smak_money`, `smak_me` | everyone | the same, when chat is not available |
| console | `smak_give <name\|#userid> <amount>` | ADMIN_RCON, the server console, or the listen host with `smak_core_dev 1` | add money |
| console | `smak_take <name\|#userid> <amount>` | same | take money (refused if the player has less) |
| console | `smak_setmoney <name\|#userid> <amount>` | same | set the balance |

**For other plugins** (`plugin/include/smak_core.inc`, compile with `-ilevels/rp/plugin/include`): `smak_char_loaded(id)`,
`smak_char_guest(id)`, `smak_char_ident(id, out[], len)`, `smak_money_get(id)`, `smak_money_add(id, amount, reason[])`,
`smak_money_take(id, amount, reason[])` (false if not enough), `smak_currency(out[], len)`, and the forward
`public smak_char_loaded_fw(id)`. Until a character is usable the money natives refuse (false/0): wait for the forward.

**Files it writes** (in `ts/addons/amxmodx/`): `data/sqlite3/smak_rp.sq3` (the database; back it up by copying it),
`logs/smak_money.log` (one line per money change: key, name, amount, before -> after, reason, plugin; also character
creation and any failed save, with the balance that was lost), and lines `[smak_core]` in the AMXX log.

**In the game, with a dedicated server** (a player with a real `STEAM_0:` id, an ADMIN_RCON account; or on a local server
with `smak_core_dev 1` and the console command from your own game)

1. Join. The AMXX log says `database ... ready, schema version 1` at map start and `character N '<name>' created` on
   join. Chat: "Personaje creado ... Empiezas con 100 creditos". `/dinero` says 100. `/yo` shows name, money, time.
2. `smak_give <name> 500` in the console. Chat: `+500 creditos (tienes 600)`. `smak_take <name> 50`, then
   `smak_take <name> 99999`: refused, nothing taken. `smak_money.log` has each line.
3. **Leave and come back** (disconnect from the menu). Wait 1 s, rejoin: "Personaje cargado ... 550 creditos".
4. **Kill the connection:** `smak_give <name> 77`, wait 6 s (the debounced save), then kill the client process (or pull the
   network). Rejoin after the server times it out: the 77 is there. Then repeat without waiting the 6 s: the change is
   kept only if a disconnect hook ran; tell which (log lines `slot N: character ...` and `sweep: slot N is gone`).
5. Change the map (`changelevel`): the log says `plugin_end: 1 of 1 character(s) saved`; rejoin: same money.
6. Join with a client that sends `STEAM_ID_LAN` (a non-H9 one): "Juegas como invitado". `smak_give` works on it for
   the session; after leaving, it is gone.
7. Look for `ERROR`, `SAVE FAILED` and `refused` in the AMXX log and in `smak_money.log`.

Offline check of the SQL: `node levels/rp/test-core-sql.mjs` (needs Node 22 for `node:sqlite`, or python with sqlite3).

Compile again (nothing is written into the game folder):

```
"C:/Juegos/H9XASH/ts/addons/amxmodx/scripting/amxxpc.exe" levels/rp/plugin/smak_core.sma -iC:/Juegos/H9XASH/ts/addons/amxmodx/scripting/include -ilevels/rp/plugin/include -olevels/rp/plugin/build/smak_core.amxx
```

## Phase 2: missions pay money (`smak_rp`)

A mission's `done.reward.money` (optional integer 0..100000, still `smak-rp/1`) is paid in full to every party member
still in the mission, through `smak_money_add(id, n, "mission:<id>")`; failed or abandoned missions pay nothing.
`smak_core` is optional: without it `smak_rp` loads, pays frags only and logs the unpaid sum. `checkRewards` in
`contract.mjs` refuses negative, fractional or too large sums. The mtest missions pay 150 and 250.

## Phase 3: events and actions in JSON (`smak_script`)

`plugin/smak_script.sma` reads `configs/smak_rp/<map>.script.json` and optionally `global.script.json`
(`smak-script/1`, see `script.mjs`), and the NPCs of `<map>.rp.json`. Events `use`, `say`, `hour`, `spawn`;
conditions `flag`, `no_flag`, `money`, `hour`, `chance`; actions `say`, `give_money`, `take_money`, `set_flag`,
`clear_flag`, `open_menu`, `open_shop` (calls `smak_shop_open` in `smak_items`), `cooldown`. Flags are per
character in its own table `script_flags` of `smak_rp.sq3`. A bad file is refused whole (`[smak_script] REFUSED
...`) and the map keeps running. Check before copying: `node bin/smak.mjs check rp <file.rp.json|file.script.json>`
(an rp.json also checks the `.script.json` beside it). The mtest script is `scripts/smak_rp_mtest.script.json`:
its menus open when Marco is used **ducking** (standing still opens the missions). `smak_npc` exports
`smak_npc_hour()` (`include/smak_npc.inc`) so `hour` rules follow its clock. Console: `smak_script_status`,
`smak_script_reload`, `smak_script_flags`.

## Phase 4: items, inventory and shops (`smak_items`)

`plugin/smak_items.sma` reads `configs/smak_rp/items.json` (`smak-items/1`) and `configs/smak_rp/<map>.shops.json`
(`smak-shops/1`); examples in `items/`. Inventory per character in its own table `items_inventory` of
`smak_rp.sq3`; guests keep it for the session. Chat `/inventario` (`/inv`), `/tienda` (`/shop`); admin
`smak_itemgive`, `smak_itemtake <name|#userid> <item> [count]`. Every sale goes through smak_core with the reason
`shop:<shop>:<item>`. Natives in `include/smak_items.inc`. Cvars `smak_items_slots 20`, `smak_items_death 0`
(0 keep all, 1 lose all but documents and keys, 2 lose all), `smak_items_weapon_ammo 60`. Weapons use
`ts_giveweapon` (untried on this reTS). Offline: `checkItems` in `items.mjs` (including the buy-cheap, sell-dear
trap), `test/164-rp-items.mjs`, `node levels/rp/test-items-sql.mjs`. Needs `smak_core` loaded first, and `tsfun`.

## Phase 6: skills that grow with use (`smak_skills`)

Four skills, level 0..20 (level L costs 40·L² XP): `punteria`, `cuerpo`, `atletismo`, `resistencia`. Only
damage between human players of different teams, dealt by the attacker's own body, counts (`Ham_TakeDamage`);
caps per minute per skill (`smak_skills_cap 150`) and per pair (`smak_skills_pair_cap 60`); bots only with
`smak_skills_bots 1`. Effect: `resistencia` gives +2 health a level at spawn (`smak_skills_hp_per_level`); the
others only track progress for now. `/habilidades` (`/skills`); admin `smak_give_xp <player> <skill> <n>`; native
`smak_give_xp` in `include/smak_skills.inc`. Own table `skills` in `smak_rp.sq3`. Offline:
`node levels/rp/test-skills-sql.mjs`.

## Phase 5: implants (`smak_implants`)

Six implants in `implants/implants.json`, one per body slot (legs, skin, blood, head): speed (+15 %, +30 %),
armor on spawn (50, 100), regeneration to 100 hp, 12 % less damage taken. Installed and removed at a clinic
(`<map>.clinics.json`, a circle like a shop) with `/clinica`; `/implantes` lists them. Removal refunds about a
third, never more than the price (`levels/rp/implants.mjs` checks it). Table `implants(ident, slot, implant)`.
Effects only use what TS was seen to keep: maxspeed and armor hold; gravity is forced to 1.0 and health over
100 decays, so neither is offered. Admin: `smak_implant_give`, `smak_implant_clear`.

## Phase 7: wanted and fines (`smak_law`)

Hurting or killing a player who is not wanted raises the attacker's wanted level (0-5 stars) and adds a fine;
nothing counts inside a mission arena (`smak_rp_in_arena`). A level falls every `smak_law_decay_min` minutes
without an offence, and the fine is forgiven at 0. Dying while wanted takes the fine from the money
(`fine:death`); `/multa` at a police station (`<map>.law.json`) pays it (`fine:paid`); `/buscado` shows it.
Table `law_wanted(ident, level, fine, updated)`. Admin: `smak_wanted <player> <0..5>`.

**Jail.** An arrest (`/arrestar` of a guard player in `smak_jobs`, or a guard NPC's arrest in `smak_npc`: both call
`smak_law_arrest`) also puts the player in a cell. The cells are the rp.json `places` of kind `cell` (the jail
properties' rooms; byz01: `post_holding`, `nexus_cell1..3`); the nearest to the arrest, a cell with two prisoners
counting as 2000 units farther. The sentence is `smak_law_jail_sec` (60) + `smak_law_jail_star` (15) for each star over
the first, at most `smak_law_jail_max` (180); `smak_law_jail_sec 0` turns the jail off. A prisoner is stripped of his
weapons (every 2 s), held within `smak_law_jail_radius` (192) of the cell's middle, cannot use `kill`, `explode` or
`spectate`, and starts every new life in the cell. At the end he is put on the public floor outside the cell's
building, not let out through the cell door (a toggle door a guard may have shut, a player may have blocked): the
building's `spawns` with role `release` if the map has any, else the last two of its role `guard` ones (the two
outside the street door), else where he was arrested. A map without cells has no jail. The sentence is kept in
`law_jail(ident, release_at)`: a reconnect or a map change does not free him. Natives `smak_law_jailed(id)` (seconds
left) and `smak_law_release(id)`; admin `smak_unjail <player>`. Other plugins that move players should leave a
prisoner where he is (`smak_jobs` does).

**Role spawns.** `smak_jobs`: a player on duty with a `lawful` job (the guard) starts each life at a random rp.json
spawn with role `guard` (cvar `smak_jobs_role_spawn`, 1). Others keep the game's spawns.

## Stable NPC ids

`smak_npc` names the people it generates `<role>_<place>` (keepers, e.g. `medic_clinic_clinic`) and
`worker_NN` / `citizen_NN`, the same on every load; `smak_script` rules bind to them with `"npc"`, and
`smak check rp --rp <map.rp.json>` derives the same list. Use while ducking is for scripts: `smak_npc`'s own
talk answers only a standing use. See NPCS.md, "Stable ids".

## The event box (`smak_core`, `smak_event`)

Every plugin used to say what happened as `[SMAK] ...` chat lines, bottom-left among player chat, where they were missed.
Now they go to one panel, like Master Sword's event box: the player's last events as one HUD block with a colour and a
tag per kind, each line fading after 10 s. Server-side only (HUD messages; no DHUD, which needs the director message
and is not proven on Xash).

- **Where**: upper-left (x 0.02, y 0.07), five lines at most, each cut to 47 characters. Chat and TS's health/armour are
  bottom-left, ammo bottom-right, the crosshair centre; the other SMAK HUD is centre-top (mission timer y 0.12, jail y 0.1),
  centre (mission step y 0.30) or left from y 0.55 down (wanted, guard, drone), so the upper-left corner is free.
- **Colour**: one HUD message has one colour, so the block takes the colour of its **newest** line's kind, and dims in that
  line's last 3 s; each line also starts with its tag. `[$]` money (green), `[LEY]` law (amber), `[TRAB]` job and skills
  (blue), `[MIS]` mission (yellow), `[!]` danger (red), `[OBJ]` items, keys, implants, houses (violet), `[i]` other (white).
- **Cost**: one sync object (one HUD channel). It is redrawn when a line is added and once a second by one task, and
  only while some line is alive; the last line's expiry clears it.
- **Native** (`smak_core.inc`): `smak_event(id, kind, const fmt[], any:...)`, id 0 = everyone; kinds `EV_INFO 0, EV_MONEY 1,
  EV_LAW 2, EV_JOB 3, EV_MISSION 4, EV_DANGER 5, EV_ITEM 6`. A plugin calls the stock **`smak_say(id, kind, fmt, ...)`** of
  the same include: the native when `LibraryExists("smak_event")`, else a chat line. A plugin that uses it sets a native
  filter that lets `smak_event` be missing (all of them do; `smak_rp`, which does not include `smak_core.inc`, has its
  own `rp_event`). smak_core registers a library `smak_event` for the test.
- **Cvar** `smak_core_events` (default 1): 0 sends every event to chat as `[SMAK] ...` (the history is still kept).
- **`/eventos`** (or console `smak_events`): the last 10 events with their age, in the console, the newest five in chat.
- **What stays in chat**: answers to what the player typed (`/tienda`, `/buscado`, `/empleo`, errors such as "no te alcanza"),
  help lines, admin console replies, NPC dialogue.

HUD channels and sync objects in use (the engine has four channels; sync objects with channel -1 share them when they
overlap in time, so a message may displace an older one; only the game shows if that happens):

| plugin | object / channel | where | what |
| --- | --- | --- | --- |
| smak_core | `g_sync_ev`, auto | left, y 0.07 | the event box |
| smak_law | `g_sync`, auto | left, y 0.55 | BUSCADO [stars] fine (every 2 s while wanted) |
| smak_law | `g_sync_jail`, auto | centre, y 0.10 | PRESO: seconds left (1 s) |
| smak_rp | `g_hud_step`, auto | centre, y 0.30 | a mission step's words (5 s) |
| smak_rp | `g_hud_timer`, auto | centre, y 0.12 | mission title, step, time left (1 s) |
| smak_npc | `g_hud`, auto | left, y 0.62 | a guard watches / hunts you |
| smak_npc | `g_dhud`, auto | left, y 0.58 | the drone follows you |
| smak_npc | channel 2 (fixed) | centre, y 0.62 | arrest bar, taser |
| smak_probe | channels 3 and 4 | centre | the probe only (not on a play server) |

Lines moved from chat to the box: smak_core 1 (money in and out), smak_law 16, smak_jobs 11, smak_items 9, smak_implants 4,
smak_skills 1, smak_doors 10, smak_rp 9 (mission start, step, member down, done, rewards, failed, called off).

## Load order in plugins.ini

`smak_core`, `smak_npc`, `smak_rp`, `smak_items`, `smak_skills`, `smak_law`, `smak_implants`, `smak_script` (natives bind at load).

## Known issues (first test in the game, 2026-11-06)

- **The shop menu once led to the inventory.** After buying one bandage, `/tienda` would not let the player buy
  again, and key 1 opened the inventory. It could not be made to happen again. With `smak_items_dev 1` every
  shop and inventory menu, and every key pressed in one, is logged (`[smak_items] menu mh_... item ... info ...`):
  if it comes back, those lines show which menu took the key.
- Fixed in that test: `copy_infokey_buffer(engfunc(EngFunc_GetInfoKeyBuffer, id))` crashes Xash3D FWGS 0.21
  (smak_probe no longer uses it); smak_items and smak_skills missed a guest announced from `client_authorized`
  and now take the player again in `client_putinserver`.
- Seen with `/probe`: the MOTD shows HTML as text (plugin windows must be plain text); TS keeps gravity at 1.0;
  `pev_max_health` stays 100 when health is raised.

**Surveillance drones** (`smak_npc`): at 4 stars a flying drone (`models/smak/drone.mdl`, to be installed with the mod; without it they are off) follows the hunted player, lights him and tells the guards where he is; it can be shot down. Cvars `smak_drone_enable, _stars, _max, _health, _speed, _height, _sight, _lose, _cooldown, _dmg, _debug`; see `NPCS.md`, "Surveillance drones".
