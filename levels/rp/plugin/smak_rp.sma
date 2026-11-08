/*
 * smak_rp -- GTA-style missions for role-play maps made with SMAK (The Specialists on H9 / Xash3D).
 *
 * A player talks to a mission giver (an NPC the plugin makes), picks a mission, and the player and their
 * party are put in a sealed arena of the map to play it: reach a place, press a button, break something,
 * hold out for a time. However it ends, the survivors are put back in the city.
 *
 * Everything the plugin knows of the map comes from one file beside it:
 *     addons/amxmodx/configs/smak_rp/<mapname>.rp.json      (format "smak-rp/1", levels/rp/CONTRACT.md)
 * The plugin never holds positions of its own, and the map never holds plugin logic.
 *
 * Chat commands:
 *     /party   the party menu: invite a player near you, accept an invite, leave, see who is in it
 *     /quit    leave the mission you are in (the party's leader ends it for everyone)
 *
 * Modules: amxmodx, fakemeta, hamsandwich, engine, json. No TS-specific module is needed.
 */

#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <engine>
#include <json>

// smak_core.amxx (the character and money plugin) is an OPTIONAL dependency: smak_core.inc is not included, because it
// demands the library (#pragma reqlib). These are its natives (same signatures); a native filter lets this plugin
// load without them, and money_ok() says whether they can be called.
native bool:smak_money_add(id, amount, const reason[]);
native smak_currency(out[], len);
// smak_law.amxx, also optional: a prisoner (smak_law_jailed > 0) takes no mission and joins no party.
native smak_law_jailed(id);
// The event box of smak_core (same native as smak_core.inc; an older smak_core lacks it, then rp_event() says it in chat).
native smak_event(id, kind, const fmt[], any:...);
#define EV_MONEY    1
#define EV_MISSION  4
#define EV_DANGER   5

#define PLUGIN  "SMAK RP missions"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

// ---- limits -------------------------------------------------------------------------------------------

#define MAX_NPCS      32
#define MAX_ARENAS    16
#define MAX_MISSIONS  32
#define MAX_STEPS     8
#define MAX_POINTS    8     // spawns or back points of one arena
#define MAX_RESETS    4     // reset names of one arena
#define MAX_BREAK     16    // func_breakables the plugin can put back
#define MAX_KV        24    // keys of one func_breakable
#define ID_LEN        32
#define NAME_LEN      64
#define TEXT_LEN      128
#define MAXPL         33

#define PARTY_MAX     4
#define USE_RANGE     96.0   // how far a giver can be talked to
#define NEAR_RANGE    512.0  // how near a member must be to the giver (or a player to the inviter)
#define ASK_SECONDS   15.0   // how long members have to answer "join the mission?"
#define INVITE_SECONDS 60.0

// step kinds
#define STEP_REACH    1
#define STEP_USE      2
#define STEP_DESTROY  3
#define STEP_SURVIVE  4

// arena states
#define ARENA_FREE    0
#define ARENA_ASKING  1   // held: the members are being asked
#define ARENA_PLAYING 2

// mission ends
#define END_DONE      0
#define END_FAILED    1
#define END_QUIT      2

#define TASK_ASK      5100  // + arena index
#define TASK_TICK     5200
#define TASK_GIVER    5300  // the givers' solid, five times a second

// ---- what the JSON gave -------------------------------------------------------------------------------

new bool:g_ready;                 // a JSON for this map was read and accepted
new g_map[64];
new g_build[64];

new g_npc_count;
new g_npc_id[MAX_NPCS][ID_LEN];
new g_npc_name[MAX_NPCS][NAME_LEN];
new g_npc_model[MAX_NPCS][NAME_LEN];
new Float:g_npc_at[MAX_NPCS][3];
new Float:g_npc_yaw[MAX_NPCS];
new g_npc_ent[MAX_NPCS];

new g_arena_count;
new g_arena_id[MAX_ARENAS][ID_LEN];
new Float:g_spawn[MAX_ARENAS][MAX_POINTS][4];   // x, y, z (the floor), yaw
new g_spawn_count[MAX_ARENAS];
new Float:g_back[MAX_ARENAS][MAX_POINTS][4];
new g_back_count[MAX_ARENAS];
new g_reset[MAX_ARENAS][MAX_RESETS][NAME_LEN];
new g_reset_count[MAX_ARENAS];

new g_mis_count;
new g_mis_id[MAX_MISSIONS][ID_LEN];
new g_mis_title[MAX_MISSIONS][NAME_LEN];
new g_mis_giver[MAX_MISSIONS];    // npc index
new g_mis_arena[MAX_MISSIONS];    // arena index
new g_mis_min[MAX_MISSIONS];
new g_mis_max[MAX_MISSIONS];
new g_mis_time[MAX_MISSIONS];     // seconds
new g_mis_steps[MAX_MISSIONS];
new g_step_do[MAX_MISSIONS][MAX_STEPS];
new g_step_target[MAX_MISSIONS][MAX_STEPS][NAME_LEN];
new g_step_say[MAX_MISSIONS][MAX_STEPS][TEXT_LEN];
new g_step_time[MAX_MISSIONS][MAX_STEPS];
new g_mis_done_say[MAX_MISSIONS][TEXT_LEN];
new g_mis_frags[MAX_MISSIONS];
new g_mis_money[MAX_MISSIONS];

// ---- func_breakables, kept to be put back before each run ---------------------------------------------
// A func_breakable that breaks is removed from the game for good, and no map entity brings it back; so the
// contract's "breakables" give the keys every destroy-step target was spawned with (smak-rp/1, CONTRACT.md), and
// the plugin spawns it again from them. (Not recorded by a FM_KeyValue hook: that crashes Xash3D FWGS 0.21.)

new g_brk_count;
new g_brk_class[MAX_BREAK][32];
new g_brk_name[MAX_BREAK][NAME_LEN];
new g_brk_key[MAX_BREAK][MAX_KV][32];
new g_brk_val[MAX_BREAK][MAX_KV][NAME_LEN];
new g_brk_kvs[MAX_BREAK];


// ---- the runs (one per arena at most) -----------------------------------------------------------------

new g_arena_state[MAX_ARENAS];
new g_run_mission[MAX_ARENAS];
new g_run_leader[MAX_ARENAS];
new g_run_step[MAX_ARENAS];
new Float:g_run_end[MAX_ARENAS];       // gametime the mission's time runs out
new Float:g_run_step_end[MAX_ARENAS];  // gametime a survive step is done

// ---- the players --------------------------------------------------------------------------------------

new g_in_arena[MAXPL];            // arena of the run the player is in, -1 for none
new g_asked_arena[MAXPL];         // arena of the run the player is being asked to join, -1 for none
new bool:g_accepted[MAXPL];
new g_party[MAXPL];               // the party's leader, 0 for a player alone
new g_invite_from[MAXPL];
new Float:g_invite_until[MAXPL];
new Float:g_next_use[MAXPL];

new g_hud_step, g_hud_timer;

// =======================================================================================================
// start
// =======================================================================================================

public plugin_precache()
{
	for (new a = 0; a < MAX_ARENAS; a++)
	{
		g_run_mission[a] = -1;
	}
	for (new id = 0; id < MAXPL; id++)
	{
		reset_player(id);
	}
	load_rp();
	if (!g_ready)
	{
		return;
	}
	for (new n = 0; n < g_npc_count; n++)
	{
		if (file_exists(g_npc_model[n]))
		{
			precache_model(g_npc_model[n]);
		}
		else
		{
			log_amx("[smak_rp] npc %s: there is no model %s; it is not made", g_npc_id[n], g_npc_model[n]);
			g_npc_model[n][0] = 0;
		}
	}
}

/// Lets the plugin load when smak_core is not there (its natives are then not called).
public plugin_natives()
{
	set_native_filter("native_filter");
	register_library("smak_rp");
	register_native("smak_rp_in_arena", "_rp_in_arena");
}

// smak_rp_in_arena(id): true while the player is in a mission's arena (smak_law does not count offences there).
public _rp_in_arena(plugin, params)
{
	new id = get_param(1);
	if (id < 1 || id >= MAXPL) return 0;
	return g_in_arena[id] >= 0;
}

public native_filter(const name[], index, trap)
{
	if (!trap) return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
}

/// Is smak_core loaded, so its natives can be called?
bool:money_ok()
{
	return bool:LibraryExists("smak_core", LibType_Library);
}

/// Is the player in smak_law's jail (when smak_law is loaded)?
bool:jailed(id)
{
	return LibraryExists("smak_law", LibType_Library) && smak_law_jailed(id) > 0;
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_cvar("smak_rp_version", VERSION, FCVAR_SERVER | FCVAR_SPONLY);

	if (!g_ready)
	{
		return;
	}
	fill_breakable_models();

	register_clcmd("say /party", "cmd_party");
	register_clcmd("say_team /party", "cmd_party");
	register_clcmd("say /quit", "cmd_quit");
	register_clcmd("say_team /quit", "cmd_quit");

	register_forward(FM_PlayerPreThink, "fw_prethink");
	register_touch("trigger_multiple", "player", "fw_touch_trigger");
	RegisterHam(Ham_Use, "func_button", "fw_button_use", 0);
	RegisterHam(Ham_Killed, "func_breakable", "fw_breakable_killed", 0);
	RegisterHamPlayer(Ham_Killed, "fw_player_killed", 1);

	g_hud_step = CreateHudSyncObj();
	g_hud_timer = CreateHudSyncObj();

	for (new n = 0; n < g_npc_count; n++)
	{
		make_npc(n);
	}
	check_targets();
	set_task(1.0, "task_tick", TASK_TICK, _, _, "b");
	set_task(0.2, "task_giver_solid", TASK_GIVER, _, _, "b");
	log_amx("[smak_rp] %s (build %s): %d npc(s), %d arena(s), %d mission(s), %d breakable(s) kept",
		g_map, g_build, g_npc_count, g_arena_count, g_mis_count, g_brk_count);
}

public client_putinserver(id)
{
	reset_player(id);
}

public client_disconnected(id)
{
	if (!g_ready)
	{
		return;
	}
	if (g_in_arena[id] >= 0)
	{
		leave_run(id, "left the server", false);
	}
	g_asked_arena[id] = -1;
	party_leave(id, true);
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_invite_from[i] == id)
		{
			g_invite_from[i] = 0;
		}
	}
	reset_player(id);
}

reset_player(id)
{
	g_in_arena[id] = -1;
	g_asked_arena[id] = -1;
	g_accepted[id] = false;
	g_party[id] = 0;
	g_invite_from[id] = 0;
	g_invite_until[id] = 0.0;
	g_next_use[id] = 0.0;
}

// =======================================================================================================
// reading the JSON
// =======================================================================================================

load_rp()
{
	g_ready = false;
	get_mapname(g_map, charsmax(g_map));

	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.rp.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_rp] no %s: no missions on this map", path);
		return;
	}

	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_rp] %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}

	new text[64];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, "smak-rp/1"))
	{
		log_amx("[smak_rp] %s: format is ^"%s^", not ^"smak-rp/1^": refused", path, text);
		json_free(root);
		return;
	}
	json_object_get_string(root, "map", text, charsmax(text));
	if (!equali(text, g_map))
	{
		log_amx("[smak_rp] %s is for the map ^"%s^", not %s: refused", path, text, g_map);
		json_free(root);
		return;
	}
	json_object_get_string(root, "build", g_build, charsmax(g_build));

	load_npcs(root);
	load_arenas(root);
	load_missions(root);
	load_breakables(root);
	json_free(root);

	g_ready = true;
}

load_npcs(JSON:root)
{
	new JSON:list = json_object_get_value(root, "npcs");
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	for (new i = 0; i < count; i++)
	{
		if (g_npc_count >= MAX_NPCS)
		{
			log_amx("[smak_rp] cap MAX_NPCS (%d) reached: %d entr%s of the file left out", MAX_NPCS, count - i, (count - i) == 1 ? "y" : "ies");
			break;
		}
		new JSON:one = json_array_get_value(list, i);
		new n = g_npc_count;
		json_object_get_string(one, "id", g_npc_id[n], charsmax(g_npc_id[]));
		json_object_get_string(one, "name", g_npc_name[n], charsmax(g_npc_name[]));
		json_object_get_string(one, "model", g_npc_model[n], charsmax(g_npc_model[]));
		g_npc_yaw[n] = json_object_get_real(one, "yaw");
		new JSON:at = json_object_get_value(one, "at");
		new Float:point[4];
		new got = read_point(at, point);
		if (at != Invalid_JSON) json_free(at);
		json_free(one);
		if (!g_npc_id[n][0] || got < 3)
		{
			log_amx("[smak_rp] npc %d has no id or no [x, y, z] at: left out", i);
			continue;
		}
		g_npc_at[n][0] = point[0];
		g_npc_at[n][1] = point[1];
		g_npc_at[n][2] = point[2];
		if (!g_npc_name[n][0]) copy(g_npc_name[n], charsmax(g_npc_name[]), g_npc_id[n]);
		g_npc_count++;
	}
	json_free(list);
}

load_arenas(JSON:root)
{
	new JSON:list = json_object_get_value(root, "arenas");
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	for (new i = 0; i < count; i++)
	{
		if (g_arena_count >= MAX_ARENAS)
		{
			log_amx("[smak_rp] cap MAX_ARENAS (%d) reached: %d entr%s of the file left out", MAX_ARENAS, count - i, (count - i) == 1 ? "y" : "ies");
			break;
		}
		new JSON:one = json_array_get_value(list, i);
		new a = g_arena_count;
		json_object_get_string(one, "id", g_arena_id[a], charsmax(g_arena_id[]));
		g_spawn_count[a] = read_points(one, "spawns", g_spawn[a]);
		g_back_count[a] = read_points(one, "back", g_back[a]);
		new JSON:resets = json_object_get_value(one, "reset");
		if (resets != Invalid_JSON)
		{
			new rc = json_array_get_count(resets);
			for (new r = 0; r < rc && g_reset_count[a] < MAX_RESETS; r++)
			{
				json_array_get_string(resets, r, g_reset[a][g_reset_count[a]], NAME_LEN - 1);
				g_reset_count[a]++;
			}
			json_free(resets);
		}
		json_free(one);
		if (!g_arena_id[a][0] || !g_spawn_count[a] || !g_back_count[a])
		{
			log_amx("[smak_rp] arena %d has no id, no spawns or no back: left out", i);
			g_spawn_count[a] = 0;
			g_back_count[a] = 0;
			g_reset_count[a] = 0;
			continue;
		}
		g_arena_count++;
	}
	json_free(list);
}

load_missions(JSON:root)
{
	new JSON:list = json_object_get_value(root, "missions");
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	new text[ID_LEN];
	for (new i = 0; i < count; i++)
	{
		if (g_mis_count >= MAX_MISSIONS)
		{
			log_amx("[smak_rp] cap MAX_MISSIONS (%d) reached: %d entr%s of the file left out", MAX_MISSIONS, count - i, (count - i) == 1 ? "y" : "ies");
			break;
		}
		new JSON:one = json_array_get_value(list, i);
		new m = g_mis_count;
		new bool:good = true;

		json_object_get_string(one, "id", g_mis_id[m], charsmax(g_mis_id[]));
		json_object_get_string(one, "title", g_mis_title[m], charsmax(g_mis_title[]));
		if (!g_mis_title[m][0]) copy(g_mis_title[m], charsmax(g_mis_title[]), g_mis_id[m]);

		json_object_get_string(one, "giver", text, charsmax(text));
		g_mis_giver[m] = npc_by_id(text);
		if (g_mis_giver[m] < 0)
		{
			log_amx("[smak_rp] mission %s: no npc ^"%s^"", g_mis_id[m], text);
			good = false;
		}
		json_object_get_string(one, "arena", text, charsmax(text));
		g_mis_arena[m] = arena_by_id(text);
		if (g_mis_arena[m] < 0)
		{
			log_amx("[smak_rp] mission %s: no arena ^"%s^"", g_mis_id[m], text);
			good = false;
		}

		g_mis_min[m] = 1;
		g_mis_max[m] = PARTY_MAX;
		new JSON:party = json_object_get_value(one, "party");
		if (party != Invalid_JSON)
		{
			if (json_array_get_count(party) >= 2)
			{
				g_mis_min[m] = clamp(json_array_get_number(party, 0), 1, PARTY_MAX);
				g_mis_max[m] = clamp(json_array_get_number(party, 1), g_mis_min[m], PARTY_MAX);
			}
			json_free(party);
		}
		g_mis_time[m] = json_object_get_number(one, "time");
		if (g_mis_time[m] <= 0) g_mis_time[m] = 300;

		// the steps, in order
		new JSON:steps = json_object_get_value(one, "steps");
		if (steps != Invalid_JSON)
		{
			new sc = json_array_get_count(steps);
			if (sc > MAX_STEPS)
			{
				log_amx("[smak_rp] mission %s: %d steps, the most is %d", g_mis_id[m], sc, MAX_STEPS);
				good = false;
			}
			for (new s = 0; s < sc && s < MAX_STEPS; s++)
			{
				new JSON:step = json_array_get_value(steps, s);
				json_object_get_string(step, "do", text, charsmax(text));
				json_object_get_string(step, "target", g_step_target[m][s], NAME_LEN - 1);
				json_object_get_string(step, "say", g_step_say[m][s], TEXT_LEN - 1);
				g_step_time[m][s] = json_object_get_number(step, "time");
				json_free(step);

				if (equal(text, "reach")) g_step_do[m][s] = STEP_REACH;
				else if (equal(text, "use")) g_step_do[m][s] = STEP_USE;
				else if (equal(text, "destroy")) g_step_do[m][s] = STEP_DESTROY;
				else if (equal(text, "survive")) g_step_do[m][s] = STEP_SURVIVE;
				else
				{
					log_amx("[smak_rp] mission %s step %d: no such step ^"%s^"", g_mis_id[m], s + 1, text);
					good = false;
				}
				if (g_step_do[m][s] == STEP_SURVIVE && g_step_time[m][s] <= 0)
				{
					log_amx("[smak_rp] mission %s step %d: survive needs a time", g_mis_id[m], s + 1);
					good = false;
				}
				if (g_step_do[m][s] != STEP_SURVIVE && !g_step_target[m][s][0])
				{
					log_amx("[smak_rp] mission %s step %d: no target", g_mis_id[m], s + 1);
					good = false;
				}
			}
			g_mis_steps[m] = min(sc, MAX_STEPS);
			json_free(steps);
		}
		if (!g_mis_steps[m])
		{
			log_amx("[smak_rp] mission %s has no steps", g_mis_id[m]);
			good = false;
		}

		new JSON:done = json_object_get_value(one, "done");
		if (done != Invalid_JSON)
		{
			json_object_get_string(done, "say", g_mis_done_say[m], charsmax(g_mis_done_say[]));
			g_mis_frags[m] = json_object_get_number(done, "reward.frags", true);
			g_mis_money[m] = clamp(json_object_get_number(done, "reward.money", true), 0, 100000);
			json_free(done);
		}
		json_free(one);

		if (good && g_mis_arena[m] >= 0 && g_spawn_count[g_mis_arena[m]] < g_mis_max[m])
		{
			log_amx("[smak_rp] mission %s: arena %s has %d spawn(s) for a party of up to %d (they will share)",
				g_mis_id[m], g_arena_id[g_mis_arena[m]], g_spawn_count[g_mis_arena[m]], g_mis_max[m]);
		}
		if (!good)
		{
			log_amx("[smak_rp] mission %s: left out", g_mis_id[m]);
			g_mis_steps[m] = 0;
			continue;
		}
		g_mis_count++;
	}
	json_free(list);
}

/// [x, y, z] or [x, y, z, yaw] into out; returns how many numbers were read.
read_point(JSON:array, Float:out[4])
{
	out[0] = out[1] = out[2] = out[3] = 0.0;
	if (array == Invalid_JSON || !json_is_array(array)) return 0;
	new count = min(json_array_get_count(array), 4);
	for (new k = 0; k < count; k++)
	{
		out[k] = json_array_get_real(array, k);
	}
	return count;
}

/// A list of [x, y, z, yaw] under key into out; returns how many were read.
read_points(JSON:object, const key[], Float:out[MAX_POINTS][4])
{
	new JSON:list = json_object_get_value(object, key);
	if (list == Invalid_JSON) return 0;
	new got = 0;
	new count = json_array_get_count(list);
	for (new i = 0; i < count && got < MAX_POINTS; i++)
	{
		new JSON:one = json_array_get_value(list, i);
		new Float:point[4];
		if (read_point(one, point) >= 3)
		{
			out[got] = point;
			got++;
		}
		json_free(one);
	}
	json_free(list);
	return got;
}

npc_by_id(const id[])
{
	for (new n = 0; n < g_npc_count; n++)
	{
		if (equal(g_npc_id[n], id)) return n;
	}
	return -1;
}

arena_by_id(const id[])
{
	for (new a = 0; a < g_arena_count; a++)
	{
		if (equal(g_arena_id[a], id)) return a;
	}
	return -1;
}

/// Says in the log which step targets the map does not have: a mission with one cannot be finished.
check_targets()
{
	for (new m = 0; m < g_mis_count; m++)
	{
		for (new s = 0; s < g_mis_steps[m]; s++)
		{
			if (g_step_do[m][s] == STEP_SURVIVE) continue;
			if (engfunc(EngFunc_FindEntityByString, -1, "targetname", g_step_target[m][s]) <= 0)
			{
				log_amx("[smak_rp] mission %s step %d: the map has no entity named %s",
					g_mis_id[m], s + 1, g_step_target[m][s]);
			}
		}
	}
	for (new a = 0; a < g_arena_count; a++)
	{
		for (new r = 0; r < g_reset_count[a]; r++)
		{
			if (engfunc(EngFunc_FindEntityByString, -1, "targetname", g_reset[a][r]) <= 0)
			{
				log_amx("[smak_rp] arena %s: the map has no reset entity named %s", g_arena_id[a], g_reset[a][r]);
			}
		}
	}
}

// =======================================================================================================
// the breakables' keys, from the contract
// =======================================================================================================

/// "breakables": [{ "name": ..., "keys": { "classname": ..., "model": "*N", ... } }]; only those a destroy step names are kept.
load_breakables(JSON:root)
{
	new JSON:list = json_object_get_value(root, "breakables");
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	for (new i = 0; i < count; i++)
	{
		if (g_brk_count >= MAX_BREAK)
		{
			log_amx("[smak_rp] cap MAX_BREAK (%d) reached: %d entr%s of the file left out", MAX_BREAK, count - i, (count - i) == 1 ? "y" : "ies");
			break;
		}
		new JSON:one = json_array_get_value(list, i);
		new b = g_brk_count;
		json_object_get_string(one, "name", g_brk_name[b], charsmax(g_brk_name[]));
		new JSON:keys = json_object_get_value(one, "keys");
		json_free(one);
		if (!g_brk_name[b][0] || keys == Invalid_JSON || !json_is_object(keys) || !is_destroy_target(g_brk_name[b]))
		{
			if (keys != Invalid_JSON) json_free(keys);
			continue;
		}
		g_brk_kvs[b] = 0;
		g_brk_class[b][0] = 0;
		new kc = json_object_get_count(keys);
		for (new k = 0; k < kc && g_brk_kvs[b] < MAX_KV; k++)
		{
			new JSON:val = json_object_get_value_at(keys, k);
			new n = g_brk_kvs[b];
			json_object_get_name(keys, k, g_brk_key[b][n], charsmax(g_brk_key[][]));
			json_get_string(val, g_brk_val[b][n], charsmax(g_brk_val[][]));
			json_free(val);
			if (equal(g_brk_key[b][n], "classname")) copy(g_brk_class[b], charsmax(g_brk_class[]), g_brk_val[b][n]);
			else g_brk_kvs[b]++;
		}
		json_free(keys);
		if (!g_brk_class[b][0]) copy(g_brk_class[b], charsmax(g_brk_class[]), "func_breakable");
		g_brk_count++;
	}
	json_free(list);
}

/// A breakable whose keys have no "model" takes it from the live entity, now that the map has spawned (it is whole).
fill_breakable_models()
{
	for (new b = 0; b < g_brk_count; b++)
	{
		new has = false;
		for (new k = 0; k < g_brk_kvs[b]; k++)
		{
			if (equal(g_brk_key[b][k], "model")) has = true;
		}
		if (has || g_brk_kvs[b] >= MAX_KV) continue;
		new ent = engfunc(EngFunc_FindEntityByString, -1, "targetname", g_brk_name[b]);
		if (ent <= 0)
		{
			log_amx("[smak_rp] breakable %s: no such entity in the map and no model in the contract", g_brk_name[b]);
			continue;
		}
		new k = g_brk_kvs[b]++;
		copy(g_brk_key[b][k], charsmax(g_brk_key[][]), "model");
		pev(ent, pev_model, g_brk_val[b][k], charsmax(g_brk_val[][]));
	}
}

bool:is_destroy_target(const name[])
{
	for (new m = 0; m < g_mis_count; m++)
	{
		for (new s = 0; s < g_mis_steps[m]; s++)
		{
			if (g_step_do[m][s] == STEP_DESTROY && equal(g_step_target[m][s], name)) return true;
		}
	}
	return false;
}

/// Puts back every kept breakable a mission of this arena breaks: spawned again when it is gone, healed when not.
rebuild_breakables(a)
{
	for (new b = 0; b < g_brk_count; b++)
	{
		if (!arena_breaks(a, g_brk_name[b])) continue;
		new ent = engfunc(EngFunc_FindEntityByString, -1, "targetname", g_brk_name[b]);
		if (ent > 0)
		{
			for (new k = 0; k < g_brk_kvs[b]; k++)
			{
				if (equal(g_brk_key[b][k], "health")) set_pev(ent, pev_health, str_to_float(g_brk_val[b][k]));
			}
			continue;
		}
		ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, g_brk_class[b]));
		if (ent <= 0) continue;
		for (new k = 0; k < g_brk_kvs[b]; k++)
		{
			if (equal(g_brk_key[b][k], "classname")) continue;
			set_kvd(0, KV_ClassName, g_brk_class[b]);
			set_kvd(0, KV_KeyName, g_brk_key[b][k]);
			set_kvd(0, KV_Value, g_brk_val[b][k]);
			set_kvd(0, KV_fHandled, 0);
			dllfunc(DLLFunc_KeyValue, ent, 0);
		}
		dllfunc(DLLFunc_Spawn, ent);
	}
}

bool:arena_breaks(a, const name[])
{
	for (new m = 0; m < g_mis_count; m++)
	{
		if (g_mis_arena[m] != a) continue;
		for (new s = 0; s < g_mis_steps[m]; s++)
		{
			if (g_step_do[m][s] == STEP_DESTROY && equal(g_step_target[m][s], name)) return true;
		}
	}
	return false;
}

// =======================================================================================================
// the givers
// =======================================================================================================

make_npc(n)
{
	if (!g_npc_model[n][0]) return;
	new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"));
	if (ent <= 0) return;
	set_pev(ent, pev_classname, "smak_rp_npc");
	engfunc(EngFunc_SetModel, ent, g_npc_model[n]);
	// a standing player's box: the origin is the middle of the body, 36 above the floor
	engfunc(EngFunc_SetSize, ent, Float:{-16.0, -16.0, -36.0}, Float:{16.0, 16.0, 36.0});
	set_pev(ent, pev_solid, SOLID_BBOX);
	set_pev(ent, pev_movetype, MOVETYPE_NONE);
	set_pev(ent, pev_takedamage, DAMAGE_NO);

	new Float:origin[3];
	origin[0] = g_npc_at[n][0];
	origin[1] = g_npc_at[n][1];
	origin[2] = g_npc_at[n][2] + 37.0;
	engfunc(EngFunc_SetOrigin, ent, origin);
	new Float:angles[3];
	angles[1] = g_npc_yaw[n];
	set_pev(ent, pev_angles, angles);

	// stand still in an idle pose (TS player models call it standard_idle)
	new seq = lookup_sequence(ent, "standard_idle");
	if (seq < 0) seq = lookup_sequence(ent, "idle");
	if (seq < 0) seq = 0;
	set_pev(ent, pev_sequence, seq);
	set_pev(ent, pev_frame, 0.0);
	set_pev(ent, pev_framerate, 1.0);
	set_pev(ent, pev_animtime, get_gametime());

	engfunc(EngFunc_DropToFloor, ent);
	g_npc_ent[n] = ent;
}

npc_of_ent(ent)
{
	if (ent <= 0) return -1;
	for (new n = 0; n < g_npc_count; n++)
	{
		if (g_npc_ent[n] == ent) return n;
	}
	return -1;
}

/// The giver the player looks at within USE_RANGE, or -1.
npc_looked_at(id)
{
	new Float:eye[3], Float:ofs[3], Float:view[3], Float:fwd[3], Float:end[3];
	pev(id, pev_origin, eye);
	pev(id, pev_view_ofs, ofs);
	eye[0] += ofs[0]; eye[1] += ofs[1]; eye[2] += ofs[2];
	pev(id, pev_v_angle, view);
	angle_vector(view, ANGLEVECTOR_FORWARD, fwd);
	for (new k = 0; k < 3; k++) end[k] = eye[k] + fwd[k] * (USE_RANGE + 16.0);

	// what the eye's line hits first
	new tr = create_tr2();
	engfunc(EngFunc_TraceLine, eye, end, DONT_IGNORE_MONSTERS, id, tr);
	new hit = get_tr2(tr, TR_pHit);
	free_tr2(tr);
	new n = npc_of_ent(hit);
	if (n >= 0) return n;

	// or the one nearest the middle of the view, close enough and plainly in front
	new best = -1;
	new Float:best_dot = 0.9;
	for (n = 0; n < g_npc_count; n++)
	{
		if (g_npc_ent[n] <= 0 || !pev_valid(g_npc_ent[n])) continue;
		new Float:at[3], Float:to[3];
		pev(g_npc_ent[n], pev_origin, at);
		for (new k = 0; k < 3; k++) to[k] = at[k] - eye[k];
		new Float:dist = vector_length(to);
		if (dist > USE_RANGE + 16.0 || dist < 1.0) continue;
		new Float:dot = (to[0] * fwd[0] + to[1] * fwd[1] + to[2] * fwd[2]) / dist;
		if (dot > best_dot)
		{
			best_dot = dot;
			best = n;
		}
	}
	return best;
}

public fw_prethink(id)
{
	if (!is_user_alive(id)) return FMRES_IGNORED;
	new buttons = pev(id, pev_button);
	new old = pev(id, pev_oldbuttons);
	if (!(buttons & IN_USE) || (old & IN_USE)) return FMRES_IGNORED;
	new Float:now = get_gametime();
	if (now < g_next_use[id]) return FMRES_IGNORED;
	new n = npc_looked_at(id);
	if (n < 0) return FMRES_IGNORED;
	g_next_use[id] = now + 0.5;
	talk_to_npc(id, n);
	return FMRES_IGNORED;
}

talk_to_npc(id, n)
{
	if (jailed(id))
	{
		chat(id, "%s: no trabajo con presos.", g_npc_name[n]);
		return;
	}
	if (g_in_arena[id] >= 0)
	{
		chat(id, "You are on a mission already. Say /quit to leave it.");
		return;
	}
	if (leader_of(id) != id)
	{
		chat(id, "%s: only your party's leader can take a mission.", g_npc_name[n]);
		return;
	}

	new title[96], item[128], info[8];
	formatex(title, charsmax(title), "%s^nMissions:", g_npc_name[n]);
	new menu = menu_create(title, "menu_npc");
	new shown = 0;
	for (new m = 0; m < g_mis_count; m++)
	{
		if (g_mis_giver[m] != n) continue;
		new a = g_mis_arena[m];
		if (g_mis_min[m] == g_mis_max[m])
			formatex(item, charsmax(item), "%s (%d player%s)", g_mis_title[m], g_mis_min[m], g_mis_min[m] == 1 ? "" : "s");
		else
			formatex(item, charsmax(item), "%s (%d-%d players)", g_mis_title[m], g_mis_min[m], g_mis_max[m]);
		if (g_arena_state[a] != ARENA_FREE) add(item, charsmax(item), " - busy");
		num_to_str(m, info, charsmax(info));
		menu_additem(menu, item, info);
		shown++;
	}
	if (!shown)
	{
		menu_destroy(menu);
		chat(id, "%s has no work for you.", g_npc_name[n]);
		return;
	}
	menu_display(id, menu);
}

public menu_npc(id, menu, item)
{
	if (item == MENU_EXIT)
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new info[8], name[64], access, callback;
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback);
	menu_destroy(menu);
	start_asking(id, str_to_num(info));
	return PLUGIN_HANDLED;
}

// =======================================================================================================
// starting a mission: the arena held, the members asked
// =======================================================================================================

start_asking(leader, m)
{
	if (!is_user_alive(leader) || g_in_arena[leader] >= 0 || leader_of(leader) != leader) return;
	new a = g_mis_arena[m];
	if (g_arena_state[a] != ARENA_FREE)
	{
		chat(leader, "Someone is on that job already. Try again later.");
		return;
	}
	new n = g_mis_giver[m];
	new near[MAXPL], count = 0;
	near[count++] = leader;
	for (new i = 1; i < MAXPL; i++)
	{
		if (i == leader || !is_user_alive(i) || g_party[i] != leader || g_in_arena[i] >= 0) continue;
		if (entity_range(i, g_npc_ent[n]) > NEAR_RANGE) continue;
		near[count++] = i;
	}
	if (count < g_mis_min[m])
	{
		chat(leader, "%s needs at least %d players of your party near %s.", g_mis_title[m], g_mis_min[m], g_npc_name[n]);
		return;
	}

	g_arena_state[a] = ARENA_ASKING;
	g_run_mission[a] = m;
	g_run_leader[a] = leader;
	g_asked_arena[leader] = a;
	g_accepted[leader] = true;

	if (count == 1)
	{
		begin_run(a);
		return;
	}
	new title[160];
	new leader_name[32];
	get_user_name(leader, leader_name, charsmax(leader_name));
	formatex(title, charsmax(title), "%s takes the job ^"%s^".^nGo with them?", leader_name, g_mis_title[m]);
	for (new k = 1; k < count; k++)
	{
		new i = near[k];
		g_asked_arena[i] = a;
		g_accepted[i] = false;
		new menu = menu_create(title, "menu_join");
		new info[8];
		num_to_str(a, info, charsmax(info));
		menu_additem(menu, "Yes, I go", info);
		menu_additem(menu, "No", info);
		menu_setprop(menu, MPROP_EXIT, MEXIT_NEVER);
		menu_display(i, menu);
	}
	chat(leader, "Asking your party (%d s)...", floatround(ASK_SECONDS));
	set_task(ASK_SECONDS, "task_ask_done", TASK_ASK + a);
}

public menu_join(id, menu, item)
{
	if (item == MENU_EXIT || item < 0)
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new info[8], name[64], access, callback;
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback);
	menu_destroy(menu);
	new a = str_to_num(info);
	if (g_asked_arena[id] != a || g_arena_state[a] != ARENA_ASKING)
	{
		chat(id, "Too late: that mission has gone.");
		return PLUGIN_HANDLED;
	}
	g_accepted[id] = (item == 0);
	if (!g_accepted[id])
	{
		g_asked_arena[id] = -1;
		chat_arena_asked(a, id, "says no.");
	}
	// everyone answered: no need to wait
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_asked_arena[i] == a && !g_accepted[i]) return PLUGIN_HANDLED;
	}
	remove_task(TASK_ASK + a);
	begin_run(a);
	return PLUGIN_HANDLED;
}

public task_ask_done(task)
{
	new a = task - TASK_ASK;
	if (g_arena_state[a] == ARENA_ASKING) begin_run(a);
}

/// Those who said yes go; too few, and the arena is let go again.
begin_run(a)
{
	new m = g_run_mission[a];
	new leader = g_run_leader[a];
	new going[PARTY_MAX], count = 0;
	// the leader first, then the others who accepted, up to the mission's most
	if (is_user_alive(leader) && g_asked_arena[leader] == a) going[count++] = leader;
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_asked_arena[i] != a) continue;
		g_asked_arena[i] = -1;
		if (i == leader || !g_accepted[i] || !is_user_alive(i)) continue;
		if (count >= g_mis_max[m])
		{
			chat(i, "The job takes %d at most: you stay here.", g_mis_max[m]);
			continue;
		}
		going[count++] = i;
	}
	g_asked_arena[leader] = -1;
	if (count < g_mis_min[m] || !count)
	{
		for (new k = 0; k < count; k++)
		{
			chat(going[k], "%s needs %d players and only %d said yes.", g_mis_title[m], g_mis_min[m], count);
		}
		if (is_user_connected(leader) && !count) chat(leader, "%s: nobody is going.", g_mis_title[m]);
		free_arena(a);
		return;
	}

	// the arena put back as it was
	for (new r = 0; r < g_reset_count[a]; r++)
	{
		fire_targets(g_reset[a][r]);
	}
	rebuild_breakables(a);

	g_arena_state[a] = ARENA_PLAYING;
	new Float:now = get_gametime();
	g_run_end[a] = now + float(g_mis_time[m]);
	g_run_step[a] = -1;
	for (new k = 0; k < count; k++)
	{
		new id = going[k];
		g_in_arena[id] = a;
		new spot = k % g_spawn_count[a];
		put_at(id, g_spawn[a][spot]);
		new Float:full = Float:pev(id, pev_max_health);
		if (full < 100.0) full = 100.0;
		set_pev(id, pev_health, full);
		rp_event(id, EV_MISSION, "Mision: %s (%d:%02d)", g_mis_title[m], g_mis_time[m] / 60, g_mis_time[m] % 60);
	}
	log_amx("[smak_rp] mission %s begins in arena %s with %d player(s)", g_mis_id[m], g_arena_id[a], count);
	next_step(a);
}

free_arena(a)
{
	remove_task(TASK_ASK + a);
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_asked_arena[i] == a) g_asked_arena[i] = -1;
	}
	g_arena_state[a] = ARENA_FREE;
	g_run_mission[a] = -1;
	g_run_leader[a] = 0;
	g_run_step[a] = -1;
}

/// Uses every entity with this targetname.
fire_targets(const name[])
{
	new ent = -1;
	for (new guard = 0; guard < 64; guard++)
	{
		ent = engfunc(EngFunc_FindEntityByString, ent, "targetname", name);
		if (ent <= 0) break;
		dllfunc(DLLFunc_Use, ent, 0);
	}
}

/// Puts a player standing on the floor point (x, y, z), facing yaw.
put_at(id, const Float:point[4])
{
	new Float:origin[3], Float:angles[3];
	origin[0] = point[0];
	origin[1] = point[1];
	origin[2] = point[2] + 37.0;
	angles[1] = point[3];
	set_pev(id, pev_velocity, Float:{0.0, 0.0, 0.0});
	set_pev(id, pev_basevelocity, Float:{0.0, 0.0, 0.0});
	engfunc(EngFunc_SetOrigin, id, origin);
	set_pev(id, pev_angles, angles);
	set_pev(id, pev_v_angle, angles);
	set_pev(id, pev_fixangle, 1);
}

// =======================================================================================================
// the steps
// =======================================================================================================

next_step(a)
{
	new m = g_run_mission[a];
	g_run_step[a]++;
	new s = g_run_step[a];
	if (s >= g_mis_steps[m])
	{
		end_run(a, END_DONE);
		return;
	}
	if (g_step_do[m][s] == STEP_SURVIVE)
	{
		g_run_step_end[a] = get_gametime() + float(g_step_time[m][s]);
	}
	if (g_step_say[m][s][0])
	{
		announce(a, g_step_say[m][s]);
	}
}

/// The arena whose current step is of this kind and this target, and which this player is playing; or -1.
arena_waiting_for(kind, const target[], id)
{
	for (new a = 0; a < g_arena_count; a++)
	{
		if (g_arena_state[a] != ARENA_PLAYING) continue;
		if (id > 0 && g_in_arena[id] != a) continue;
		new m = g_run_mission[a];
		new s = g_run_step[a];
		if (s < 0 || s >= g_mis_steps[m]) continue;
		if (g_step_do[m][s] == kind && equal(g_step_target[m][s], target)) return a;
	}
	return -1;
}

public fw_touch_trigger(trigger, id)
{
	if (id < 1 || id >= MAXPL || g_in_arena[id] < 0 || !is_user_alive(id)) return PLUGIN_CONTINUE;
	new name[NAME_LEN];
	pev(trigger, pev_targetname, name, charsmax(name));
	if (!name[0]) return PLUGIN_CONTINUE;
	new a = arena_waiting_for(STEP_REACH, name, id);
	if (a >= 0) next_step(a);
	return PLUGIN_CONTINUE;
}

public fw_button_use(button, caller, activator, use_type, Float:value)
{
	if (activator < 1 || activator >= MAXPL || g_in_arena[activator] < 0) return HAM_IGNORED;
	new name[NAME_LEN];
	pev(button, pev_targetname, name, charsmax(name));
	if (!name[0]) return HAM_IGNORED;
	new a = arena_waiting_for(STEP_USE, name, activator);
	if (a >= 0) next_step(a);
	return HAM_IGNORED;
}

public fw_breakable_killed(ent, attacker, shouldgib)
{
	new name[NAME_LEN];
	pev(ent, pev_targetname, name, charsmax(name));
	if (!name[0]) return HAM_IGNORED;
	// broken by anyone or anything: the step is done for the arena waiting on it
	new a = arena_waiting_for(STEP_DESTROY, name, 0);
	if (a >= 0) next_step(a);
	return HAM_IGNORED;
}

public fw_player_killed(id, attacker, shouldgib)
{
	if (g_in_arena[id] >= 0) leave_run(id, "is down", false);
	return HAM_IGNORED;
}

/// Once a second: the time, the survive steps, and runs whose players are all gone.
/// Anti-stuck for the givers: while a player's box overlaps a giver's it is SOLID_NOT (a player who spawns on it walks out);
/// it is SOLID_BBOX again once no player is within 34 (a hysteresis: a solid one counts a player at 30, a not-solid one waits for 34).
public task_giver_solid()
{
	for (new n = 0; n < g_npc_count; n++)
	{
		new ent = g_npc_ent[n];
		if (ent <= 0 || !pev_valid(ent)) continue;
		new Float:o[3];
		pev(ent, pev_origin, o);
		new bool:was_not = (pev(ent, pev_solid) == SOLID_NOT);
		new Float:half = was_not ? 34.0 : 30.0, Float:high = was_not ? 74.0 : 70.0;
		new bool:inside = false;
		for (new id = 1; id < MAXPL && !inside; id++)
		{
			if (!is_user_alive(id)) continue;
			new Float:p[3];
			pev(id, pev_origin, p);
			if (floatabs(p[0] - o[0]) < half && floatabs(p[1] - o[1]) < half && floatabs(p[2] - o[2]) < high) inside = true;
		}
		if (inside == was_not) continue;
		set_pev(ent, pev_solid, inside ? SOLID_NOT : SOLID_BBOX);
		engfunc(EngFunc_SetOrigin, ent, o);   // linked in or out of the world
	}
}

public task_tick()
{
	new Float:now = get_gametime();
	for (new a = 0; a < g_arena_count; a++)
	{
		if (g_arena_state[a] != ARENA_PLAYING) continue;
		new m = g_run_mission[a];

		// a member the hooks missed (died and already respawned, or no longer alive)
		for (new i = 1; i < MAXPL; i++)
		{
			if (g_in_arena[i] == a && !is_user_alive(i)) leave_run(i, "is down", false);
		}
		if (g_arena_state[a] != ARENA_PLAYING) continue;

		if (now >= g_run_end[a])
		{
			end_run(a, END_FAILED);
			continue;
		}
		new s = g_run_step[a];
		if (g_step_do[m][s] == STEP_SURVIVE && now >= g_run_step_end[a])
		{
			next_step(a);
			if (g_arena_state[a] != ARENA_PLAYING) continue;
			s = g_run_step[a];
		}

		new left = floatround(g_run_end[a] - now, floatround_ceil);
		new line[160];
		if (g_step_do[m][s] == STEP_SURVIVE)
		{
			new hold = floatround(g_run_step_end[a] - now, floatround_ceil);
			formatex(line, charsmax(line), "%s  -  step %d/%d  -  hold out %d s  -  %d:%02d left",
				g_mis_title[m], s + 1, g_mis_steps[m], hold, left / 60, left % 60);
		}
		else
		{
			formatex(line, charsmax(line), "%s  -  step %d/%d  -  %d:%02d left",
				g_mis_title[m], s + 1, g_mis_steps[m], left / 60, left % 60);
		}
		for (new i = 1; i < MAXPL; i++)
		{
			if (g_in_arena[i] != a) continue;
			set_hudmessage(255, 200, 80, -1.0, 0.12, 0, 0.0, 1.2, 0.0, 0.0, -1);
			ShowSyncHudMsg(i, g_hud_timer, "%s", line);
		}
	}
}

// =======================================================================================================
// ending
// =======================================================================================================

/// A member is out of the mission: died, left the server, or quit alone. Put back in the city when asked.
leave_run(id, const why[], bool:send_back)
{
	new a = g_in_arena[id];
	if (a < 0) return;
	g_in_arena[id] = -1;
	new name[32];
	get_user_name(id, name, charsmax(name));
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_in_arena[i] == a) rp_event(i, EV_DANGER, "%s %s: fuera de la mision", name, why);
	}
	if (send_back && is_user_alive(id))
	{
		put_at(id, g_back[a][random(g_back_count[a])]);
	}
	if (count_in(a) == 0)
	{
		end_run(a, END_FAILED);
	}
}

count_in(a)
{
	new count = 0;
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_in_arena[i] == a) count++;
	}
	return count;
}

end_run(a, how)
{
	new m = g_run_mission[a];
	new k = 0;
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_in_arena[i] != a) continue;
		g_in_arena[i] = -1;
		switch (how)
		{
			case END_DONE:
			{
				if (g_mis_done_say[m][0]) rp_event(i, EV_MISSION, "%s", g_mis_done_say[m]);
				else rp_event(i, EV_MISSION, "%s: completada", g_mis_title[m]);
				if (g_mis_frags[m])
				{
					set_pev(i, pev_frags, Float:pev(i, pev_frags) + float(g_mis_frags[m]));
					rp_event(i, EV_MISSION, "Recompensa: %d frag%s", g_mis_frags[m], g_mis_frags[m] == 1 ? "" : "s");
				}
				if (g_mis_money[m] > 0)
				{
					if (!money_ok())
					{
						log_amx("[smak_rp] mission %s: reward.money %d not paid, smak_core is not loaded", g_mis_id[m], g_mis_money[m]);
					}
					else
					{
						new reason[48], cur[32];
						formatex(reason, charsmax(reason), "mission:%s", g_mis_id[m]);
						if (smak_money_add(i, g_mis_money[m], reason))
						{
							smak_currency(cur, charsmax(cur));
							rp_event(i, EV_MISSION, "Recompensa: %d %s", g_mis_money[m], cur);
						}
						else
						{
							chat(i, "No se pudo pagar la recompensa de la mision (tu personaje no esta listo).");
							log_amx("[smak_rp] mission %s: smak_money_add refused for player %d", g_mis_id[m], i);
						}
					}
				}
			}
			case END_FAILED: rp_event(i, EV_MISSION, "%s: fallida", g_mis_title[m]);
			case END_QUIT: rp_event(i, EV_MISSION, "%s: cancelada", g_mis_title[m]);
		}
		if (is_user_alive(i))
		{
			put_at(i, g_back[a][k % g_back_count[a]]);
			k++;
		}
	}
	new const ends[][] = { "done", "failed", "quit" };
	log_amx("[smak_rp] mission %s in arena %s: %s", g_mis_id[m], g_arena_id[a], ends[how]);
	free_arena(a);
}

public cmd_quit(id)
{
	new a = g_in_arena[id];
	if (a < 0)
	{
		chat(id, "You are not on a mission.");
		return PLUGIN_HANDLED;
	}
	// the run's leader calls it off for everyone; when the leader is gone, anyone left may
	new leader = g_run_leader[a];
	if (id == leader || leader < 1 || leader >= MAXPL || g_in_arena[leader] != a)
	{
		end_run(a, END_QUIT);
	}
	else
	{
		leave_run(id, "quit", true);
	}
	return PLUGIN_HANDLED;
}

// =======================================================================================================
// the party
// =======================================================================================================

leader_of(id)
{
	return g_party[id] ? g_party[id] : id;
}

party_size(leader)
{
	if (!g_party[leader]) return 1;
	new count = 0;
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_party[i] == leader) count++;
	}
	return count;
}

public cmd_party(id)
{
	new menu = menu_create("Party", "menu_party");
	menu_additem(menu, "Invite a player near you", "invite");
	if (g_invite_from[id] && get_gametime() < g_invite_until[id] && is_user_connected(g_invite_from[id]))
	{
		new name[32], item[64];
		get_user_name(g_invite_from[id], name, charsmax(name));
		formatex(item, charsmax(item), "Join %s's party", name);
		menu_additem(menu, item, "accept");
	}
	menu_additem(menu, "Leave the party", "leave");
	menu_additem(menu, "Who is in it", "list");
	menu_display(id, menu);
	return PLUGIN_HANDLED;
}

public menu_party(id, menu, item)
{
	if (item == MENU_EXIT)
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new info[16], name[64], access, callback;
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback);
	menu_destroy(menu);
	if (equal(info, "invite")) invite_menu(id);
	else if (equal(info, "accept")) party_accept(id);
	else if (equal(info, "leave"))
	{
		if (g_in_arena[id] >= 0) chat(id, "Not during a mission: say /quit first.");
		else if (!g_party[id]) chat(id, "You are not in a party.");
		else party_leave(id, false);
	}
	else if (equal(info, "list")) party_list(id);
	return PLUGIN_HANDLED;
}

invite_menu(id)
{
	if (leader_of(id) != id)
	{
		chat(id, "Only your party's leader can invite.");
		return;
	}
	if (party_size(id) >= PARTY_MAX)
	{
		chat(id, "Your party is full (%d).", PARTY_MAX);
		return;
	}
	new menu = menu_create("Invite whom?", "menu_invite");
	new shown = 0, name[32], info[8];
	for (new i = 1; i < MAXPL; i++)
	{
		if (i == id || !is_user_connected(i) || g_party[i]) continue;
		if (!is_user_alive(i) || !is_user_alive(id) || entity_range(id, i) > NEAR_RANGE) continue;
		get_user_name(i, name, charsmax(name));
		num_to_str(get_user_userid(i), info, charsmax(info));
		menu_additem(menu, name, info);
		shown++;
	}
	if (!shown)
	{
		menu_destroy(menu);
		chat(id, "Nobody near you is free to invite.");
		return;
	}
	menu_display(id, menu);
}

public menu_invite(id, menu, item)
{
	if (item == MENU_EXIT)
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new info[8], name[64], access, callback;
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback);
	menu_destroy(menu);
	new target = find_player("k", str_to_num(info));
	if (!target || g_party[target])
	{
		chat(id, "That player is not free any more.");
		return PLUGIN_HANDLED;
	}
	g_invite_from[target] = id;
	g_invite_until[target] = get_gametime() + INVITE_SECONDS;
	new me[32];
	get_user_name(id, me, charsmax(me));
	chat(id, "Invited %s.", name);

	new title[96];
	formatex(title, charsmax(title), "%s invites you to a party.", me);
	new ask = menu_create(title, "menu_accept");
	menu_additem(ask, "Join", "yes");
	menu_additem(ask, "No thanks", "no");
	menu_setprop(ask, MPROP_EXIT, MEXIT_NEVER);
	menu_display(target, ask);
	return PLUGIN_HANDLED;
}

public menu_accept(id, menu, item)
{
	if (item == MENU_EXIT || item < 0)
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	menu_destroy(menu);
	if (item == 0) party_accept(id);
	else
	{
		if (is_user_connected(g_invite_from[id]))
		{
			new name[32];
			get_user_name(id, name, charsmax(name));
			chat(g_invite_from[id], "%s says no.", name);
		}
		g_invite_from[id] = 0;
	}
	return PLUGIN_HANDLED;
}

party_accept(id)
{
	new from = g_invite_from[id];
	g_invite_from[id] = 0;
	if (jailed(id))
	{
		chat(id, "No puedes unirte a un grupo desde el calabozo.");
		return;
	}
	if (!from || !is_user_connected(from) || get_gametime() > g_invite_until[id])
	{
		chat(id, "That invite has run out.");
		return;
	}
	if (g_party[id])
	{
		chat(id, "Leave your party first.");
		return;
	}
	new leader = leader_of(from);
	if (party_size(leader) >= PARTY_MAX)
	{
		chat(id, "That party is full.");
		return;
	}
	g_party[leader] = leader;
	g_party[id] = leader;
	new name[32];
	get_user_name(id, name, charsmax(name));
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_party[i] == leader) chat(i, "%s joins the party.", name);
	}
}

/// Leaves the party; a leader who leaves hands it to the next member. A party of one is no party.
party_leave(id, bool:quietly)
{
	new leader = g_party[id];
	if (!leader) return;
	g_party[id] = 0;
	new name[32];
	get_user_name(id, name, charsmax(name));
	if (!quietly) chat(id, "You leave the party.");

	new heir = leader;
	if (leader == id)
	{
		heir = 0;
		for (new i = 1; i < MAXPL; i++)
		{
			if (g_party[i] == id)
			{
				if (!heir) heir = i;
				g_party[i] = heir;
			}
		}
		if (!heir) return;
	}
	new left = 0, last = 0;
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_party[i] == heir)
		{
			left++;
			last = i;
			chat(i, "%s leaves the party.", name);
		}
	}
	if (left <= 1 && last) g_party[last] = 0;
	else if (heir != leader)
	{
		new heir_name[32];
		get_user_name(heir, heir_name, charsmax(heir_name));
		for (new i = 1; i < MAXPL; i++)
		{
			if (g_party[i] == heir) chat(i, "%s leads the party now.", heir_name);
		}
	}
}

party_list(id)
{
	if (!g_party[id])
	{
		chat(id, "You are alone. Say /party and invite someone near you.");
		return;
	}
	new leader = g_party[id];
	new line[192], name[32];
	get_user_name(leader, name, charsmax(name));
	formatex(line, charsmax(line), "Party (%d/%d): %s (leader)", party_size(leader), PARTY_MAX, name);
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_party[i] != leader || i == leader) continue;
		get_user_name(i, name, charsmax(name));
		add(line, charsmax(line), ", ");
		add(line, charsmax(line), name);
	}
	chat(id, "%s", line);
}

// =======================================================================================================
// words to the players
// =======================================================================================================

chat(id, const fmt[], any:...)
{
	if (!is_user_connected(id)) return;
	new text[192];
	vformat(text, charsmax(text), fmt, 3);
	client_print(id, print_chat, "[Mission] %s", text);
}

/// A line in the event box of smak_core (upper-left), or in chat when smak_core has no box.
rp_event(id, kind, const fmt[], any:...)
{
	if (!is_user_connected(id)) return;
	new text[160];
	vformat(text, charsmax(text), fmt, 4);
	if (LibraryExists("smak_event", LibType_Library)) smak_event(id, kind, "%s", text);
	else chat(id, "%s", text);
}

/// A step's words, to every member of the run: in the middle of the screen and in the chat.
announce(a, const text[])
{
	for (new i = 1; i < MAXPL; i++)
	{
		if (g_in_arena[i] != a) continue;
		set_hudmessage(80, 220, 255, -1.0, 0.30, 0, 0.0, 5.0, 0.2, 0.5, -1);
		ShowSyncHudMsg(i, g_hud_step, "%s", text);
		rp_event(i, EV_MISSION, "%s", text);
	}
}

/// To the leader and everyone else asked to join run a, about player id.
chat_arena_asked(a, id, const what[])
{
	new name[32];
	get_user_name(id, name, charsmax(name));
	if (is_user_connected(g_run_leader[a])) chat(g_run_leader[a], "%s %s", name, what);
}
