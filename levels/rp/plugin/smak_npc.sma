/*
 * smak_npc -- the city's own people for role-play maps made with SMAK (The Specialists on H9 / Xash3D).
 * Phase 1 of levels/rp/NPCS.md (option C: NPCs the plugin makes, with a player model and a brain in AMXX).
 *
 * Separate from smak_rp.sma so the server's leader can switch it off: take its line out of plugins.ini, or
 * set smak_npc_enable 0. It reads the same file as smak_rp (addons/amxmodx/configs/smak_rp/<map>.rp.json,
 * format smak-rp/1, levels/rp/CONTRACT.md) and refuses one whose "map" is not the map running.
 *
 *   - a game clock (a day lasts smak_npc_day real minutes, 48 by default), with day and night shifts;
 *   - roles from the places' kinds: shopkeepers (kind shop), a barman (bar), a medic (clinic), a mechanic
 *     (workshop), then workers (home -> workshop -> bar -> home) and citizens (home, the streets, home);
 *   - they walk the JSON's "paths" graph by A*, over walk and stair links, opening the plain doors they meet;
 *     never a checkpoint gate (unless smak_npc_gates 1), a lid, a grate, a secret door, a trapdoor, a ladder
 *     or a jump-down; never into another's home, the police rooms, the cells or the hideout;
 *   - gunfire and a hurt player make those within smak_npc_hear flee to a node away from it (some roll,
 *     cartwheel or sprint first: the "cybernetic" stunt), cower a few seconds, and go back to their day;
 *   - use key on one: a short line by role and time of day (smak_npc_lang 0 English, 1 Spanish);
 *   - budget: at most smak_npc_max (24, hard cap 40); one with no player within smak_npc_near (1500) AND out of
 *     every player's sight (a clear line, smak_npc_see) is moved by a 1 Hz step along its route (no collision,
 *     no animation cost); the others walk for real at 10 Hz, with the animation's frame and animtime advanced
 *     each step so the client interpolates the move. Blocked in sight, they never jump through a door or wall:
 *     they retry the door, take another way, or wait. smak_npc_debug 1 logs a summary every 10 s.
 *
 * Phase 2 hooks (not built): ROLE_PATROL, ROLE_SMUGGLER and ROLE_WANTED are reserved below; the single
 * place a patrol's reaction goes is npc_scare(); a role's day is the one switch in npc_slot().
 *
 * Modules: amxmodx, fakemeta, hamsandwich, engine, json. Models: only those H9 already has, by path.
 */

#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <engine>
#include <json>

#define PLUGIN  "SMAK NPC"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

// ---- limits ---------------------------------------------------------------------------------------------

#define MAX_NODES    1024
#define MAX_EDGES    4096
#define MAX_PROPS    96
#define MAX_PLACES   64
#define MAX_DOORS    160
#define MAX_ROAM     192
#define MAX_NPC      40
#define ROUTE_LEN    160
#define ROUTE_TMP    400
#define HEAP_MAX     8192
#define MAXPL        33
#define NAME_LEN     48
#define SPOTS        8

#define TASK_TICK    7300
#define TICK         0.1

// node kinds
#define NK_STREET    0
#define NK_SEWER     1
#define NK_ROOM      2
#define NK_PLACE     3
#define NK_DOOR      4
#define NK_STAIR     5
#define NK_LADDER    6
#define NK_HATCH     7

// property kinds
#define PK_OTHER     0
#define PK_HOME      1
#define PK_SHOP      2
#define PK_PUBLIC    3

// place kinds that give a role
#define PL_NONE      0
#define PL_SHOP      1
#define PL_BAR       2
#define PL_CLINIC    3
#define PL_WORKSHOP  4

// roles
#define ROLE_KEEPER    0
#define ROLE_WORKER    1
#define ROLE_CITIZEN   2
#define ROLE_PATROL    3   // phase 2: MSR patrol
#define ROLE_SMUGGLER  4   // phase 2: the level below
#define ROLE_WANTED    5   // phase 2

// the line tables: one per kind of person
#define LT_SHOP      0
#define LT_BAR       1
#define LT_MEDIC     2
#define LT_MECHANIC  3
#define LT_WORKER    4
#define LT_CITIZEN   5

// slots of the day
#define SLOT_HOME    0
#define SLOT_WORK    1
#define SLOT_EVENING 2
#define SLOT_ROAM    3

// states
#define ST_IDLE      0
#define ST_WALK      1
#define ST_FLEE      2
#define ST_COWER     3
#define ST_TALK      4
#define ST_STUNT     5
#define ST_WAIT      6   // waiting for the path queue

#define ARRIVE       22.0
#define USE_RANGE    96.0

// ---- the map (from the JSON) ----------------------------------------------------------------------------

new bool:g_ready;
new g_map[64];

new g_node_count;
new Float:g_n_at[MAX_NODES][3];
new g_n_kind[MAX_NODES];
new g_n_part[MAX_NODES];
new g_n_place[MAX_NODES];
new g_n_roam[MAX_NODES];
new bool:g_n_approach[MAX_NODES];
new Trie:g_t_node;
new Trie:g_t_part;
new Trie:g_t_place;
new Trie:g_t_door;

new g_edge_count;
new g_head[MAX_NODES];
new g_e_to[MAX_EDGES];
new g_e_next[MAX_EDGES];
new Float:g_e_len[MAX_EDGES];
new g_e_door[MAX_EDGES];       // door slot or -1
new g_e_prop[MAX_EDGES];       // property of the door or -1
new g_e_gate[MAX_EDGES];       // 0 none, 1 plain door, 2 checkpoint gate
new g_skipped_links;

new g_door_count;
new g_door_name[MAX_DOORS][NAME_LEN];

new g_prop_count;
new g_p_id[MAX_PROPS][32];
new g_p_kind[MAX_PROPS];
new g_p_building[MAX_PROPS][16];
new bool:g_p_hollow[MAX_PROPS];
new g_p_node[MAX_PROPS];       // a home's node, -1 for none

new g_place_count;
new g_pl_id[MAX_PLACES][32];
new g_pl_kind[MAX_PLACES];
new g_pl_building[MAX_PLACES][16];
new g_pl_node[MAX_PLACES];
new g_pl_spots[MAX_PLACES][SPOTS];
new g_pl_nspots[MAX_PLACES];

new g_roam_count;
new g_roam[MAX_ROAM];
new g_shop_count;
new g_shop_node[MAX_PLACES];

// ---- A* -------------------------------------------------------------------------------------------------

new Float:g_a_g[MAX_NODES];
new g_a_from[MAX_NODES];
new g_a_state[MAX_NODES];
new g_hn[HEAP_MAX];
new Float:g_hf[HEAP_MAX];
new g_heap_n;
new g_pop_node;
new g_tmp[ROUTE_TMP];
new g_tmp_len;
new g_gates;

// ---- cvars ----------------------------------------------------------------------------------------------

new g_cv_enable, g_cv_max, g_cv_workers, g_cv_day, g_cv_near, g_cv_walk, g_cv_run, g_cv_hear, g_cv_lang, g_cv_gates, g_cv_debug, g_cv_solid, g_cv_see;

// ---- the people -----------------------------------------------------------------------------------------

new g_count;
new g_ent[MAX_NPC];
new g_role[MAX_NPC];
new g_lt[MAX_NPC];             // line table
new g_name[MAX_NPC][16];
new g_id[MAX_NPC][32];          // stable id (role + home place, or role + number); also the entity's targetname
new g_home[MAX_NPC];           // node
new g_home_prop[MAX_NPC];
new g_work[MAX_NPC];
new g_eve[MAX_NPC];
new g_open_h[MAX_NPC];         // for a keeper: hours it works
new Float:g_jit[MAX_NPC];
new g_state[MAX_NPC];
new g_slot[MAX_NPC];
new g_cur[MAX_NPC];            // last node reached
new g_want[MAX_NPC];           // node wanted while waiting for a path
new bool:g_want_flee[MAX_NPC];
new Float:g_scare[MAX_NPC][3];
new g_route[MAX_NPC][ROUTE_LEN];
new g_rlen[MAX_NPC];
new g_rpos[MAX_NPC];
new g_dest[MAX_NPC];
new bool:g_use_goal[MAX_NPC];
new Float:g_goal[MAX_NPC][3];
new Float:g_last[MAX_NPC];
new Float:g_idle_until[MAX_NPC];
new Float:g_until[MAX_NPC];    // cower / talk / stunt end
new Float:g_flee_t[MAX_NPC];
new Float:g_blocked[MAX_NPC];
new Float:g_door_t[MAX_NPC];
new g_fail[MAX_NPC];
new g_stunt[MAX_NPC];
new Float:g_stunt_yaw[MAX_NPC];
new g_seq[MAX_NPC];
new Float:g_rate[MAX_NPC];
new g_sq_idle[MAX_NPC], g_sq_walk[MAX_NPC], g_sq_run[MAX_NPC];
new g_sq_st[MAX_NPC][3];
new Float:g_gs_walk[MAX_NPC], Float:g_gs_run[MAX_NPC];
new bool:g_hidden[MAX_NPC];
new g_mdl[MAX_NPC];
new Float:g_anim_t[MAX_NPC];     // when pev_frame was last brought up to date (pev_animtime)
new Float:g_fr_cur[MAX_NPC];     // the playing sequence's frames per second, as the engine counts: 256 * fps / (frames - 1)
new bool:g_loops_cur[MAX_NPC];
new Float:g_info_fr[MAX_NPC][6]; // the same for idle, walk, run, the three stunts
new bool:g_info_loop[MAX_NPC][6];
new g_ban_a[MAX_NPC], g_ban_b[MAX_NPC];   // a link this NPC is not to take for a while (it was blocked there)
new Float:g_ban_t[MAX_NPC];
new bool:g_vis[MAX_NPC];         // some player can see it (a clear line), last tested at g_vis_t
new Float:g_vis_t[MAX_NPC];
new bool:g_far[MAX_NPC];         // moved by the 1 Hz step on the last think
new g_av_a = -1, g_av_b = -1;    // the link A* leaves out
new Float:g_pe[MAXPL][3];        // eyes of the players who may see: connected, not dead
new g_pe_n;
new g_dbg_jump, g_dbg_retry, g_dbg_giveway, g_dbg_far;

new g_rr[MAX_NPC][MAX_ROAM];     // the roam spots NPC i can reach, by its own rules
new g_rr_n[MAX_NPC];
new g_sr[MAX_NPC][16];           // the shops it can reach
new g_sr_n[MAX_NPC];
new g_q[MAX_NODES];
new g_settle[MAX_NPC];

new g_queue_at;
new g_tick;
new g_shift;                   // seconds, moves the game clock (smak_npc_hour)
new Float:g_next_use[MAXPL];
new Float:g_noise_t[MAXPL];
new g_maxpl;
new Float:g_pp[MAXPL][3];
new g_pn;

// stunts: the model's own moves, with the speed burst that goes with each
new const g_st_name[3][] = { "roll_f", "roll_f_high", "wheel_f" };
new const Float:g_st_speed[3] = { 150.0, 230.0, 125.0 };
new const Float:g_st_time[3] = { 0.89, 0.97, 1.03 };

// the models H9 has (by path, never copied); 0-2 men, 3-4 women, 5 the medic
new const g_model[6][] = {
	"models/player/proletarian/proletarian.mdl",
	"models/player/proletarian_dirty/proletarian_dirty.mdl",
	"models/player/proletarian_healthy/proletarian_healthy.mdl",
	"models/player/prole_fem/prole_fem.mdl",
	"models/player/prole_bfem/prole_bfem.mdl",
	"models/player/ins_medic/ins_medic.mdl"
};
new bool:g_model_ok[6];

// names: the first 12 are men's, the rest women's
new const g_names_m[][] = { "Dmitri", "Nikos", "Leon", "Maxim", "Teo", "Yuri", "Stavros", "Boris", "Andreas", "Pavel", "Kosta", "Ivo" };
new const g_names_f[][] = { "Anya", "Irene", "Zoe", "Sofia", "Vera", "Katya", "Lina", "Mira", "Olga", "Elena", "Dara", "Nadia" };

// what they say: [line table * 4 + state], state 0 at work / out by day, 1 evening, 2 at home by night, 3 scared
new const g_say_en[][] = {
	"Welcome. Mind the shelves, the regime counts what leaves here.",
	"We close when the street gets quiet. Not before.",
	"Nobody should be walking about at this hour. Shop is shut.",
	"Please, I only sell things. I do not see anything.",

	"Sit down if you like. The bar is open.",
	"Busy night. Everyone wants to forget the day.",
	"Closed. Come back when the lamps are on.",
	"Get away from the door! I do not want trouble here.",

	"The clinic is quiet today. Look after yourself out there.",
	"Evening shift. Everyone has the same complaint: tired hands.",
	"It is late. If you are bleeding, knock louder.",
	"Stay down! I am not a fighter, I fix people!",

	"These arms are mine, but the parts are never cheap.",
	"Another day of oil. Tomorrow the same.",
	"The workshop is shut. Go home, friend.",
	"Whatever you are doing, do it away from my tools!",

	"Shift is long. The machines do not get tired, we do.",
	"After the shift, the bar. That is what keeps us human.",
	"I am off to sleep. Do not wake the building.",
	"Run! They are shooting!",

	"Another day in Byzantium. Keep your head down.",
	"The lights come on and the city changes. Be careful.",
	"Curfew is close. Go home.",
	"Not me! I saw nothing!"
};
new const g_say_es[][] = {
	"Bienvenido. Cuidado con los estantes, el regimen cuenta lo que sale.",
	"Cerramos cuando la calle se calma. No antes.",
	"Nadie deberia andar por aqui a esta hora. La tienda esta cerrada.",
	"Por favor, yo solo vendo cosas. No veo nada.",

	"Sientate si quieres. La barra esta abierta.",
	"Noche movida. Todos quieren olvidar el dia.",
	"Cerrado. Vuelve cuando se enciendan las lamparas.",
	"Lejos de la puerta! No quiero problemas aqui.",

	"La clinica esta tranquila hoy. Cuidate ahi fuera.",
	"Turno de tarde. Todos con la misma queja: manos cansadas.",
	"Es tarde. Si sangras, golpea mas fuerte.",
	"Al suelo! Yo no peleo, yo arreglo gente!",

	"Estos brazos son mios, pero las piezas nunca son baratas.",
	"Otro dia de aceite. Manana igual.",
	"El taller esta cerrado. Vete a casa, amigo.",
	"Hagas lo que hagas, hazlo lejos de mis herramientas!",

	"El turno es largo. Las maquinas no se cansan, nosotros si.",
	"Despues del turno, el bar. Eso nos mantiene humanos.",
	"Me voy a dormir. No despiertes el edificio.",
	"Corre! Estan disparando!",

	"Otro dia en Bizancio. Mantén la cabeza baja.",
	"Se encienden las luces y la ciudad cambia. Ten cuidado.",
	"Se acerca el toque de queda. Vete a casa.",
	"Yo no! No vi nada!"
};

// =======================================================================================================
// start
// =======================================================================================================

public plugin_precache()
{
	g_ready = false;
	get_mapname(g_map, charsmax(g_map));
	for (new m = 0; m < 6; m++)
	{
		g_model_ok[m] = bool:file_exists(g_model[m]);
		if (g_model_ok[m])
		{
			precache_model(g_model[m]);
		}
	}
	load_rp();
}

// The game clock for other plugins (smak_script): include/smak_npc.inc.
public plugin_natives()
{
	register_library("smak_npc");
	register_native("smak_npc_hour", "_npc_hour");
	register_native("smak_npc_find", "_npc_find");
	register_native("smak_npc_id", "_npc_id");
	register_native("smak_npc_count", "_npc_count");
	register_native("smak_npc_name", "_npc_name");
}

/// smak_npc_find(const id[]): the entity of the NPC with this id, 0 if there is none (or it is not made).
public _npc_find(plid, num)
{
	new want[32];
	get_string(1, want, charsmax(want));
	for (new i = 0; i < g_count; i++)
	{
		if (equal(g_id[i], want)) return (g_ent[i] > 0 && pev_valid(g_ent[i])) ? g_ent[i] : 0;
	}
	return 0;
}

/// smak_npc_id(ent, id[], len): copies the id of the NPC entity into id; false if the entity is not one of ours.
public bool:_npc_id(plid, num)
{
	new ent = get_param(1);
	for (new i = 0; i < g_count; i++)
	{
		if (ent > 0 && g_ent[i] == ent)
		{
			set_string(2, g_id[i], get_param(3));
			return true;
		}
	}
	return false;
}

/// smak_npc_count(): how many NPCs were generated (0 when the plugin is off or the map has none).
public _npc_count(plid, num)
{
	return g_count;
}

/// smak_npc_name(const id[], name[], len): the first name of that NPC; false if there is no such id.
public bool:_npc_name(plid, num)
{
	new want[32];
	get_string(1, want, charsmax(want));
	for (new i = 0; i < g_count; i++)
	{
		if (equal(g_id[i], want))
		{
			set_string(2, g_name[i], get_param(3));
			return true;
		}
	}
	return false;
}

public Float:_npc_hour()
{
	return clock_hour();
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_cvar("smak_npc_version", VERSION, FCVAR_SERVER | FCVAR_SPONLY);
	g_cv_enable = register_cvar("smak_npc_enable", "1");
	g_cv_max = register_cvar("smak_npc_max", "24");
	g_cv_workers = register_cvar("smak_npc_workers", "6");
	g_cv_day = register_cvar("smak_npc_day", "48");
	g_cv_near = register_cvar("smak_npc_near", "1500");
	g_cv_walk = register_cvar("smak_npc_walk", "100");
	g_cv_run = register_cvar("smak_npc_run", "220");
	g_cv_hear = register_cvar("smak_npc_hear", "1100");
	g_cv_lang = register_cvar("smak_npc_lang", "0");
	g_cv_gates = register_cvar("smak_npc_gates", "0");
	g_cv_debug = register_cvar("smak_npc_debug", "0");
	g_cv_solid = register_cvar("smak_npc_solid", "3");     // 3 SOLID_SLIDEBOX (a monster's), 2 SOLID_BBOX
	g_cv_see = register_cvar("smak_npc_see", "6000");      // a player this far or less, with a clear line, sees an NPC
	g_maxpl = get_maxplayers();

	register_concmd("smak_npc_status", "cmd_status", ADMIN_RCON, "- lists the NPCs: role, state, slot, place");
	register_concmd("smak_npc_hour", "cmd_hour", ADMIN_RCON, "<hour 0-24> - sets the game clock");
	register_concmd("smak_npc_scare", "cmd_scare", ADMIN_RCON, "- NPCs near you flee, as if shot at");
}

public plugin_cfg()
{
	// the config files have run: the cvars are the server's
	if (!g_ready || !get_pcvar_num(g_cv_enable))
	{
		if (g_ready) log_amx("[smak_npc] smak_npc_enable is 0: no NPCs");
		return;
	}
	find_doors();
	assign_npcs();
	if (g_count == 0)
	{
		return;
	}
	register_forward(FM_PlayerPreThink, "fw_prethink");
	register_forward(FM_PlaybackEvent, "fw_playback");
	RegisterHamPlayer(Ham_TakeDamage, "fw_hurt", 1);
	set_task(TICK, "task_tick", TASK_TICK, _, _, "b");
	log_amx("[smak_npc] %s: %d NPC(s) (clock: a day is %d min, it is %.1f h)", g_map, g_count, get_pcvar_num(g_cv_day), clock_hour());
}

// =======================================================================================================
// reading the JSON
// =======================================================================================================

load_rp()
{
	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.rp.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_npc] no %s: no NPCs on this map", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_npc] %s is not a JSON object", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[96];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, "smak-rp/1"))
	{
		log_amx("[smak_npc] %s: format is '%s', not smak-rp/1; no NPCs", path, text);
		json_free(root);
		return;
	}
	json_object_get_string(root, "map", text, charsmax(text));
	if (!equal(text, g_map))
	{
		log_amx("[smak_npc] %s is for map '%s', the map running is '%s'; it is refused", path, text, g_map);
		json_free(root);
		return;
	}

	g_t_node = TrieCreate();
	g_t_part = TrieCreate();
	g_t_place = TrieCreate();
	g_t_door = TrieCreate();
	read_places(root);
	read_nodes(root);
	read_props(root);
	read_links(root);
	json_free(root);

	if (g_node_count == 0 || g_edge_count == 0)
	{
		log_amx("[smak_npc] the JSON has no paths graph (%d nodes, %d edges); no NPCs", g_node_count, g_edge_count);
		return;
	}
	g_ready = true;
	log_amx("[smak_npc] graph: %d nodes, %d edges for NPCs (%d links left out), %d homes/shops/..., %d places, %d doors, %d roam spots",
		g_node_count, g_edge_count, g_skipped_links, g_prop_count, g_place_count, g_door_count, g_roam_count);
}

read_vec3(JSON:array, Float:out[3])
{
	out[0] = out[1] = out[2] = 0.0;
	if (array == Invalid_JSON || !json_is_array(array)) return;
	new n = min(json_array_get_count(array), 3);
	for (new k = 0; k < n; k++)
	{
		out[k] = json_array_get_real(array, k);
	}
}

read_places(JSON:root)
{
	new JSON:list = json_object_get_value(root, "places");
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	new kind[24];
	for (new i = 0; i < count && g_place_count < MAX_PLACES; i++)
	{
		new JSON:one = json_array_get_value(list, i);
		new p = g_place_count;
		json_object_get_string(one, "id", g_pl_id[p], charsmax(g_pl_id[]));
		json_object_get_string(one, "kind", kind, charsmax(kind));
		json_object_get_string(one, "building", g_pl_building[p], charsmax(g_pl_building[]));
		g_pl_kind[p] = PL_NONE;
		if (equal(kind, "shop")) g_pl_kind[p] = PL_SHOP;
		else if (equal(kind, "bar")) g_pl_kind[p] = PL_BAR;
		else if (equal(kind, "clinic")) g_pl_kind[p] = PL_CLINIC;
		else if (equal(kind, "workshop")) g_pl_kind[p] = PL_WORKSHOP;
		g_pl_node[p] = -1;
		g_pl_nspots[p] = 0;
		TrieSetCell(g_t_place, g_pl_id[p], p);
		g_place_count++;
		json_free(one);
	}
	json_free(list);
}

read_nodes(JSON:root)
{
	new JSON:paths = json_object_get_value(root, "paths");
	if (paths == Invalid_JSON) return;
	new JSON:list = json_object_get_value(paths, "nodes");
	json_free(paths);
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	new id[32], kind[16], part[48], place[32];
	new parts = 0;
	for (new i = 0; i < count && g_node_count < MAX_NODES; i++)
	{
		new JSON:one = json_array_get_value(list, i);
		new n = g_node_count;
		json_object_get_string(one, "id", id, charsmax(id));
		json_object_get_string(one, "kind", kind, charsmax(kind));
		json_object_get_string(one, "part", part, charsmax(part));
		new JSON:at = json_object_get_value(one, "at");
		read_vec3(at, g_n_at[n]);
		if (at != Invalid_JSON) json_free(at);

		g_n_kind[n] = NK_STREET;
		if (equal(kind, "sewer")) g_n_kind[n] = NK_SEWER;
		else if (equal(kind, "room")) g_n_kind[n] = NK_ROOM;
		else if (equal(kind, "place")) g_n_kind[n] = NK_PLACE;
		else if (equal(kind, "door")) g_n_kind[n] = NK_DOOR;
		else if (equal(kind, "stair")) g_n_kind[n] = NK_STAIR;
		else if (equal(kind, "ladder")) g_n_kind[n] = NK_LADDER;
		else if (equal(kind, "hatch")) g_n_kind[n] = NK_HATCH;

		new pid = -1;
		if (!TrieGetCell(g_t_part, part, pid))
		{
			pid = parts++;
			TrieSetCell(g_t_part, part, pid);
		}
		g_n_part[n] = pid;

		g_n_place[n] = -1;
		json_object_get_string(one, "place", place, charsmax(place));
		if (place[0])
		{
			new pl = -1;
			if (TrieGetCell(g_t_place, place, pl))
			{
				g_n_place[n] = pl;
				g_pl_node[pl] = n;
			}
		}
		g_n_roam[n] = -1;
		if (json_object_has_value(one, "roam") && g_roam_count < MAX_ROAM)
		{
			g_n_roam[n] = g_roam_count;
			g_roam[g_roam_count++] = n;
		}
		g_n_approach[n] = json_object_get_bool(one, "approach");
		g_head[n] = -1;
		TrieSetCell(g_t_node, id, n);
		g_node_count++;
		json_free(one);
	}
	json_free(list);

	// the nodes that stand with a place in its room: where the people of a place can stand
	for (new p = 0; p < g_place_count; p++)
	{
		new pn = g_pl_node[p];
		if (pn < 0) continue;
		g_pl_spots[p][g_pl_nspots[p]++] = pn;
		for (new n = 0; n < g_node_count && g_pl_nspots[p] < SPOTS; n++)
		{
			if (n != pn && g_n_part[n] == g_n_part[pn] && (g_n_kind[n] == NK_ROOM || g_n_kind[n] == NK_PLACE))
			{
				g_pl_spots[p][g_pl_nspots[p]++] = n;
			}
		}
		if (g_pl_kind[p] == PL_SHOP && g_shop_count < MAX_PLACES)
		{
			g_shop_node[g_shop_count++] = pn;
		}
	}
}

read_props(JSON:root)
{
	new JSON:list = json_object_get_value(root, "properties");
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	new kind[24], district[24], room[32], part[56], door[NAME_LEN];
	for (new i = 0; i < count && g_prop_count < MAX_PROPS; i++)
	{
		new JSON:one = json_array_get_value(list, i);
		new p = g_prop_count;
		json_object_get_string(one, "id", g_p_id[p], charsmax(g_p_id[]));
		json_object_get_string(one, "kind", kind, charsmax(kind));
		json_object_get_string(one, "building", g_p_building[p], charsmax(g_p_building[]));
		json_object_get_string(one, "district", district, charsmax(district));
		g_p_kind[p] = PK_OTHER;
		if (equal(kind, "home")) g_p_kind[p] = PK_HOME;
		else if (equal(kind, "shop")) g_p_kind[p] = PK_SHOP;
		else if (equal(kind, "public")) g_p_kind[p] = PK_PUBLIC;
		g_p_hollow[p] = bool:equal(district, "hollow");
		g_p_node[p] = -1;

		new JSON:doors = json_object_get_value(one, "doors");
		if (doors != Invalid_JSON)
		{
			new dc = json_array_get_count(doors);
			for (new d = 0; d < dc; d++)
			{
				json_array_get_string(doors, d, door, charsmax(door));
				if (g_door_count < MAX_DOORS && !TrieKeyExists(g_t_door, door))
				{
					copy(g_door_name[g_door_count], NAME_LEN - 1, door);
					TrieSetCell(g_t_door, door, g_door_count);
					// the property of a door: kept in the slot's low bits, see door_prop()
					g_door_count++;
				}
				TrieSetCell(g_t_door_prop(), door, p);
			}
			json_free(doors);
		}

		if (g_p_kind[p] == PK_HOME)
		{
			new JSON:rooms = json_object_get_value(one, "rooms");
			if (rooms != Invalid_JSON)
			{
				new rc = json_array_get_count(rooms);
				for (new r = 0; r < rc && g_p_node[p] < 0; r++)
				{
					json_array_get_string(rooms, r, room, charsmax(room));
					formatex(part, charsmax(part), "%s.%s", g_p_building[p], room);
					g_p_node[p] = home_node_of(part);
				}
				json_free(rooms);
			}
			if (g_p_node[p] < 0)
			{
				log_amx("[smak_npc] home %s has no node; nobody lives there", g_p_id[p]);
			}
		}
		g_prop_count++;
		json_free(one);
	}
	json_free(list);
}

/// A trie from a door's name to its property; made on first use.
Trie:g_t_door_prop()
{
	static Trie:t = Invalid_Trie;
	if (t == Invalid_Trie) t = TrieCreate();
	return t;
}

home_node_of(const part[])
{
	new pid = -1;
	if (!TrieGetCell(g_t_part, part, pid)) return -1;
	new n;
	for (n = 0; n < g_node_count; n++)
	{
		if (g_n_part[n] == pid && g_n_kind[n] == NK_ROOM) return n;
	}
	for (n = 0; n < g_node_count; n++)
	{
		if (g_n_part[n] == pid && g_n_kind[n] == NK_PLACE) return n;
	}
	for (n = 0; n < g_node_count; n++)
	{
		if (g_n_part[n] == pid && g_n_kind[n] == NK_DOOR && g_n_approach[n]) return n;
	}
	return -1;
}

read_links(JSON:root)
{
	new JSON:paths = json_object_get_value(root, "paths");
	if (paths == Invalid_JSON) return;
	new JSON:list = json_object_get_value(paths, "links");
	json_free(paths);
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	new a_id[32], b_id[32], how[16], gate[16], via[NAME_LEN];
	for (new i = 0; i < count; i++)
	{
		new JSON:one = json_array_get_value(list, i);
		json_object_get_string(one, "a", a_id, charsmax(a_id));
		json_object_get_string(one, "b", b_id, charsmax(b_id));
		json_object_get_string(one, "how", how, charsmax(how));
		json_object_get_string(one, "gate", gate, charsmax(gate));
		json_object_get_string(one, "via", via, charsmax(via));
		new bool:one_way = json_object_get_bool(one, "oneWay");
		json_free(one);

		new a = -1, b = -1;
		if (!TrieGetCell(g_t_node, a_id, a) || !TrieGetCell(g_t_node, b_id, b))
		{
			g_skipped_links++;
			continue;
		}
		// walk and stair only: a ladder or a jump-down is not for a phase-1 NPC
		if (!equal(how, "walk") && !equal(how, "stair"))
		{
			g_skipped_links++;
			continue;
		}
		new kind = 0, door = -1, prop = -1;
		if (gate[0])
		{
			if (equal(gate, "door")) kind = 1;
			else if (equal(gate, "gate")) kind = 2;
			else
			{
				// a lid, a grate, a secret door, a trapdoor: never
				g_skipped_links++;
				continue;
			}
			if (!TrieGetCell(g_t_door, via, door))
			{
				g_skipped_links++;
				continue;
			}
			if (kind == 1)
			{
				if (!TrieGetCell(g_t_door_prop(), via, prop))
				{
					g_skipped_links++;
					continue;
				}
			}
		}
		add_edge(a, b, kind, door, prop);
		if (!one_way) add_edge(b, a, kind, door, prop);
	}
	json_free(list);
}

add_edge(a, b, kind, door, prop)
{
	if (g_edge_count >= MAX_EDGES) return;
	new e = g_edge_count++;
	g_e_to[e] = b;
	g_e_len[e] = vector_distance(g_n_at[a], g_n_at[b]);
	g_e_door[e] = door;
	g_e_prop[e] = prop;
	g_e_gate[e] = kind;
	g_e_next[e] = g_head[a];
	g_head[a] = e;
}

// =======================================================================================================
// the clock and the days
// =======================================================================================================

Float:clock_hour()
{
	new daysec = max(60, floatround(get_pcvar_float(g_cv_day) * 60.0));
	new t = (get_systime() + g_shift) % daysec;
	if (t < 0) t += daysec;
	return float(t) * 24.0 / float(daysec);
}

/// What an NPC should be doing at hour h.
npc_slot(i, Float:hour)
{
	new Float:h = hour + g_jit[i];
	if (h >= 24.0) h -= 24.0;
	switch (g_role[i])
	{
		case ROLE_KEEPER:
		{
			if (g_open_h[i] == 1)
			{
				// the barman: from the afternoon to the small hours
				return (h >= 15.0 || h < 2.0) ? SLOT_WORK : SLOT_HOME;
			}
			return (h >= 7.0 && h < 20.0) ? SLOT_WORK : SLOT_HOME;
		}
		case ROLE_WORKER:
		{
			if (h >= 7.0 && h < 17.0) return SLOT_WORK;
			if (h >= 17.0 && h < 22.0) return (g_eve[i] >= 0) ? SLOT_EVENING : SLOT_HOME;
			return SLOT_HOME;
		}
		case ROLE_CITIZEN:
		{
			if (h >= 8.0 && h < 19.0) return SLOT_ROAM;
			if (h >= 19.0 && h < 22.0) return (g_eve[i] >= 0) ? SLOT_EVENING : SLOT_ROAM;
			return SLOT_HOME;
		}
	}
	// phase 2: a patrol's rounds, a smuggler's night market
	return SLOT_HOME;
}

// =======================================================================================================
// roles: who lives and works where
// =======================================================================================================

bool:home_free(p, bool:used[])
{
	return (g_p_kind[p] == PK_HOME && g_p_node[p] >= 0 && !used[p]);
}

/// A home: not yet used, in this building, or (building empty) in a non-hollow place, or any. -1 for none.
take_home(const building[], bool:hollow, bool:any, bool:used[])
{
	new p;
	for (p = 0; p < g_prop_count; p++)
	{
		if (!home_free(p, used)) continue;
		if (building[0] && !equal(g_p_building[p], building)) continue;
		if (!building[0] && !any && g_p_hollow[p] != hollow) continue;
		used[p] = true;
		return p;
	}
	return -1;
}

assign_npcs()
{
	new cap = clamp(get_pcvar_num(g_cv_max), 0, MAX_NPC);
	new bool:used[MAX_PROPS];
	for (new p = 0; p < MAX_PROPS; p++) used[p] = false;
	new bar = -1, workshop = -1;
	for (new k = 0; k < g_place_count; k++)
	{
		if (g_pl_kind[k] == PL_BAR && bar < 0 && g_pl_node[k] >= 0) bar = k;
		if (g_pl_kind[k] == PL_WORKSHOP && workshop < 0 && g_pl_node[k] >= 0) workshop = k;
	}

	// keepers: the people of the places that open and close
	for (new k = 0; k < g_place_count && g_count < cap; k++)
	{
		if (g_pl_kind[k] == PL_NONE || g_pl_node[k] < 0) continue;
		new home = take_home(g_pl_building[k], false, true, used);
		if (home < 0)
		{
			// no flat in its building: any home, then the first one again
			home = take_home("", false, true, used);
		}
		if (home < 0)
		{
			log_amx("[smak_npc] place %s has no home to give its keeper; it stays empty", g_pl_id[k]);
			continue;
		}
		new i = new_npc(ROLE_KEEPER);
		g_home[i] = g_p_node[home];
		g_home_prop[i] = home;
		g_work[i] = g_pl_node[k];
		g_eve[i] = -1;
		g_open_h[i] = (g_pl_kind[k] == PL_BAR) ? 1 : 0;
		switch (g_pl_kind[k])
		{
			case PL_SHOP: g_lt[i] = LT_SHOP;
			case PL_BAR: g_lt[i] = LT_BAR;
			case PL_CLINIC: g_lt[i] = LT_MEDIC;
			case PL_WORKSHOP: g_lt[i] = LT_MECHANIC;
		}
		dress_npc(i, (g_pl_kind[k] == PL_CLINIC));
		switch (g_pl_kind[k])
		{
			case PL_SHOP: formatex(g_id[i], charsmax(g_id[]), "shopkeeper_%s", g_pl_id[k]);
			case PL_BAR: formatex(g_id[i], charsmax(g_id[]), "barman_%s", g_pl_id[k]);
			case PL_CLINIC: formatex(g_id[i], charsmax(g_id[]), "medic_%s", g_pl_id[k]);
			case PL_WORKSHOP: formatex(g_id[i], charsmax(g_id[]), "mechanic_%s", g_pl_id[k]);
		}
	}
	new keepers = g_count;

	// workers, then citizens
	new workers = (workshop >= 0) ? min(get_pcvar_num(g_cv_workers), cap - g_count) : 0;
	for (new k = 0; k < workers; k++)
	{
		new home = take_home("", true, false, used);
		if (home < 0) home = take_home("", false, true, used);
		if (home < 0) break;
		new i = new_npc(ROLE_WORKER);
		g_home[i] = g_p_node[home];
		g_home_prop[i] = home;
		g_work[i] = g_pl_node[workshop];
		g_eve[i] = (bar >= 0) ? g_pl_node[bar] : -1;
		g_lt[i] = LT_WORKER;
		dress_npc(i, false);
		formatex(g_id[i], charsmax(g_id[]), "worker_%02d", k + 1);
	}
	new citizen_no = 0;
	while (g_count < cap)
	{
		new home = take_home("", false, false, used);
		if (home < 0) home = take_home("", false, true, used);
		if (home < 0) break;
		new i = new_npc(ROLE_CITIZEN);
		g_home[i] = g_p_node[home];
		g_home_prop[i] = home;
		g_work[i] = -1;
		g_eve[i] = (bar >= 0) ? g_pl_node[bar] : -1;
		g_lt[i] = LT_CITIZEN;
		dress_npc(i, false);
		formatex(g_id[i], charsmax(g_id[]), "citizen_%02d", ++citizen_no);
	}
	new bool:any_made = false;
	for (new i = 0; i < g_count; i++)
	{
		npc_reach(i);
		if (make_ent(i)) any_made = true;
	}
	if (!any_made)
	{
		g_count = 0;
	}
	// the ids depend on the JSON and the cvars only: places and homes are taken in file order, no random call decides them
	new ids[1024];
	new len = 0;
	for (new i = 0; i < g_count; i++)
	{
		len += formatex(ids[len], charsmax(ids) - len, "%s%s", i ? ", " : "", g_id[i]);
	}
	log_amx("[smak_npc] ids: %s", ids);
	log_amx("[smak_npc] roles: %d keepers, %d workers, %d citizens", keepers, g_count_role(ROLE_WORKER), g_count_role(ROLE_CITIZEN));
}

/// What NPC i can reach from its home by its own rules (its home's door, shops' and public doors, no gates):
/// its roam spots and shops; its evening spot is dropped when the bar is out of reach.
npc_reach(i)
{
	g_gates = get_pcvar_num(g_cv_gates);
	for (new n = 0; n < g_node_count; n++) g_a_state[n] = 0;
	new qh = 0, qt = 0;
	g_q[qt++] = g_home[i];
	g_a_state[g_home[i]] = 2;
	while (qh < qt)
	{
		new u = g_q[qh++];
		for (new e = g_head[u]; e >= 0; e = g_e_next[e])
		{
			if (!edge_ok(e, g_home_prop[i])) continue;
			new v = g_e_to[e];
			if (g_a_state[v] == 2) continue;
			g_a_state[v] = 2;
			g_q[qt++] = v;
		}
	}
	g_rr_n[i] = 0;
	for (new r = 0; r < g_roam_count; r++)
	{
		if (g_a_state[g_roam[r]] == 2) g_rr[i][g_rr_n[i]++] = g_roam[r];
	}
	g_sr_n[i] = 0;
	for (new s = 0; s < g_shop_count && g_sr_n[i] < 16; s++)
	{
		if (g_a_state[g_shop_node[s]] == 2) g_sr[i][g_sr_n[i]++] = g_shop_node[s];
	}
	if (g_eve[i] >= 0 && g_a_state[g_eve[i]] != 2)
	{
		g_eve[i] = -1;
	}
	if (g_work[i] >= 0 && g_a_state[g_work[i]] != 2)
	{
		log_amx("[smak_npc] npc %d (%s): its work is out of reach from its home; it stays home", i, g_name[i]);
		g_work[i] = -1;
	}
}

g_count_role(role)
{
	new n = 0;
	for (new i = 0; i < g_count; i++)
	{
		if (g_role[i] == role) n++;
	}
	return n;
}

new_npc(role)
{
	new i = g_count++;
	g_role[i] = role;
	g_ent[i] = 0;
	g_state[i] = ST_IDLE;
	g_slot[i] = -1;
	g_cur[i] = -1;
	g_fail[i] = 0;
	g_jit[i] = random_float(0.0, 0.75);
	g_hidden[i] = false;
	g_open_h[i] = 0;
	g_want_flee[i] = false;
	g_use_goal[i] = false;
	g_stunt[i] = -1;
	g_seq[i] = -1;
	g_rate[i] = 0.0;
	g_dest[i] = -1;
	g_flee_t[i] = -100.0;
	g_door_t[i] = -100.0;
	return i;
}

/// A name and a model for the person (stored: the model index goes in g_mdl, used until the entity is made).
dress_npc(i, bool:medic)
{
	new female = random_num(0, 1);
	if (female)
	{
		copy(g_name[i], charsmax(g_name[]), g_names_f[(i * 5 + 3) % sizeof g_names_f]);
		g_mdl[i] = 3 + random_num(0, 1);
	}
	else
	{
		copy(g_name[i], charsmax(g_name[]), g_names_m[(i * 7 + 1) % sizeof g_names_m]);
		g_mdl[i] = random_num(0, 2);
	}
	if (medic)
	{
		copy(g_name[i], charsmax(g_name[]), "Doc");
		g_mdl[i] = 5;
	}
	if (!g_model_ok[g_mdl[i]])
	{
		// the nearest model the game has
		for (new m = 0; m < 6; m++)
		{
			if (g_model_ok[m]) g_mdl[i] = m;
		}
	}
}

// =======================================================================================================
// making the entities
// =======================================================================================================

bool:make_ent(i)
{
	new m = g_mdl[i];
	if (!g_model_ok[m])
	{
		log_amx("[smak_npc] no model for npc %d; it is not made", i);
		return false;
	}
	new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"));
	if (ent <= 0) return false;
	set_pev(ent, pev_classname, "smak_npc");
	set_pev(ent, pev_targetname, g_id[i]);
	engfunc(EngFunc_SetModel, ent, g_model[m]);
	engfunc(EngFunc_SetSize, ent, Float:{-16.0, -16.0, -36.0}, Float:{16.0, 16.0, 36.0});
	set_pev(ent, pev_solid, get_pcvar_num(g_cv_solid) == 2 ? SOLID_BBOX : SOLID_SLIDEBOX);
	set_pev(ent, pev_movetype, MOVETYPE_STEP);
	set_pev(ent, pev_takedamage, DAMAGE_NO);
	set_pev(ent, pev_gravity, 1.0);

	// the model's own sequences, by name; the ground speed of walk and run sets the animation's rate
	new Float:fr, bool:loops, Float:gs;
	for (new k = 0; k < 6; k++)
	{
		g_info_fr[i][k] = 256.0 * 25.0 / 30.0;
		g_info_loop[i][k] = true;
	}
	g_sq_idle[i] = lookup_sequence(ent, "standard_idle", fr, loops, gs);
	if (g_sq_idle[i] < 0) g_sq_idle[i] = 0;
	else keep_info(i, 0, fr, loops);
	g_sq_walk[i] = lookup_sequence(ent, "walk2", fr, loops, gs);
	g_gs_walk[i] = (g_sq_walk[i] >= 0 && gs > 1.0) ? gs : 70.0;
	if (g_sq_walk[i] >= 0) keep_info(i, 1, fr, loops);
	g_sq_run[i] = lookup_sequence(ent, "run2", fr, loops, gs);
	g_gs_run[i] = (g_sq_run[i] >= 0 && gs > 1.0) ? gs : 240.0;
	if (g_sq_run[i] >= 0) keep_info(i, 2, fr, loops);
	if (g_sq_walk[i] < 0) g_sq_walk[i] = g_sq_idle[i];
	if (g_sq_run[i] < 0) g_sq_run[i] = g_sq_walk[i];
	for (new s = 0; s < 3; s++)
	{
		g_sq_st[i][s] = lookup_sequence(ent, g_st_name[s], fr, loops, gs);
		if (g_sq_st[i][s] >= 0) keep_info(i, 3 + s, fr, loops);
	}
	if (get_pcvar_num(g_cv_debug) && i == 0)
	{
		log_amx("[smak_npc] sequence info of npc 0: idle %d (%.1f f/s), walk %d (%.1f), run %d (%.1f); the engine counts 256*fps/(frames-1): 31 frames at 30 fps is 256",
			g_sq_idle[i], g_info_fr[i][0], g_sq_walk[i], g_info_fr[i][1], g_sq_run[i], g_info_fr[i][2]);
	}

	// where it starts: where its hour has it, so the whole city does not set out from its beds together
	new Float:hour = clock_hour();
	g_slot[i] = npc_slot(i, hour);
	new node = g_home[i];
	if (g_slot[i] == SLOT_WORK && g_work[i] >= 0) node = g_work[i];
	else if (g_slot[i] == SLOT_EVENING && g_eve[i] >= 0) node = g_eve[i];
	else if (g_slot[i] == SLOT_ROAM && g_rr_n[i] > 0) node = g_rr[i][random_num(0, g_rr_n[i] - 1)];
	g_cur[i] = node;
	new Float:origin[3];
	origin[0] = g_n_at[node][0];
	origin[1] = g_n_at[node][1];
	origin[2] = g_n_at[node][2] + 1.0;
	engfunc(EngFunc_SetOrigin, ent, origin);
	new Float:angles[3];
	angles[1] = random_float(0.0, 359.0);
	set_pev(ent, pev_angles, angles);
	g_ent[i] = ent;
	npc_anim(i, g_sq_idle[i], 1.0, true);
	engfunc(EngFunc_DropToFloor, ent);
	g_last[i] = get_gametime();
	g_idle_until[i] = g_last[i] + random_float(1.0, 5.0);
	return true;
}

keep_info(i, k, Float:fr, bool:loops)
{
	// a sequence of one frame, or a failed lookup, gives 0 or a silly number: keep the default
	if (fr > 1.0 && fr < 5000.0) g_info_fr[i][k] = fr;
	g_info_loop[i][k] = loops;
}

/// Plays `seq` from its first frame. Every change of sequence or rate restarts at frame 0 and sets animtime.
npc_anim(i, seq, Float:rate, bool:force = false)
{
	if (!force && g_seq[i] == seq && floatabs(g_rate[i] - rate) < 0.05) return;
	if (g_seq[i] != seq || force)
	{
		// the rate of this sequence: which of ours is it?
		new k = -1;
		if (seq == g_sq_idle[i]) k = 0;
		else if (seq == g_sq_walk[i]) k = 1;
		else if (seq == g_sq_run[i]) k = 2;
		else
		{
			for (new s = 0; s < 3; s++)
			{
				if (seq == g_sq_st[i][s]) k = 3 + s;
			}
		}
		g_fr_cur[i] = (k >= 0) ? g_info_fr[i][k] : (256.0 * 25.0 / 30.0);
		g_loops_cur[i] = (k >= 0) ? g_info_loop[i][k] : true;
		g_seq[i] = seq;
		set_pev(g_ent[i], pev_frame, 0.0);
	}
	else
	{
		npc_advance(i, get_gametime());
	}
	g_rate[i] = rate;
	new ent = g_ent[i];
	set_pev(ent, pev_sequence, seq);
	set_pev(ent, pev_framerate, rate);
	set_pev(ent, pev_animtime, get_gametime());
	g_anim_t[i] = get_gametime();
}

/// The way a Half-Life monster does it (CBaseAnimating::StudioFrameAdvance): bring pev_frame up to where the
/// animation is now, and stamp pev_animtime with the time. The client takes the frame from (frame + (time -
/// animtime) * framerate * fps) and, for a MOVETYPE_STEP entity, lerps the origin and angles from the previous
/// update to this one over 0.1 s counted from animtime: an animtime that does not change gives a jump per tick.
npc_advance(i, Float:now)
{
	new ent = g_ent[i];
	new Float:iv = now - g_anim_t[i];
	if (iv < 0.001)
	{
		return;
	}
	new Float:frame;
	pev(ent, pev_frame, frame);
	frame += iv * g_fr_cur[i] * g_rate[i];
	if (frame >= 256.0 || frame < 0.0)
	{
		if (g_loops_cur[i])
		{
			frame -= float(floatround(frame / 256.0, floatround_floor)) * 256.0;
		}
		else
		{
			frame = (frame < 0.0) ? 0.0 : 255.0;
		}
	}
	set_pev(ent, pev_frame, frame);
	set_pev(ent, pev_animtime, now);
	g_anim_t[i] = now;
}

/// Can some player see NPC i: within smak_npc_see and a clear line from the eye to its feet, middle or head.
bool:npc_seen(i)
{
	new ent = g_ent[i];
	new Float:o[3];
	pev(ent, pev_origin, o);
	new Float:see = get_pcvar_float(g_cv_see);
	new tr = create_tr2();
	new bool:seen = false;
	for (new k = 0; k < g_pe_n && !seen; k++)
	{
		if (vector_distance(g_pe[k], o) > see) continue;
		for (new h = 0; h < 3 && !seen; h++)
		{
			new Float:p[3];
			p[0] = o[0];
			p[1] = o[1];
			p[2] = o[2] + ((h == 0) ? 0.0 : ((h == 1) ? 30.0 : -30.0));
			engfunc(EngFunc_TraceLine, g_pe[k], p, IGNORE_MONSTERS, ent, tr);
			new Float:frac;
			get_tr2(tr, TR_flFraction, frac);
			if (frac >= 1.0) seen = true;
		}
	}
	free_tr2(tr);
	return seen;
}

find_doors()
{
	// nothing to cache: the door entities are found by name when one is used (a door of two leaves moves both)
}

// =======================================================================================================
// the path: A* over the JSON's graph
// =======================================================================================================

heap_push(node, Float:f)
{
	if (g_heap_n >= HEAP_MAX) return;
	new c = g_heap_n++;
	while (c > 0)
	{
		new p = (c - 1) / 2;
		if (g_hf[p] <= f) break;
		g_hn[c] = g_hn[p];
		g_hf[c] = g_hf[p];
		c = p;
	}
	g_hn[c] = node;
	g_hf[c] = f;
}

heap_pop()
{
	g_pop_node = g_hn[0];
	g_heap_n--;
	if (g_heap_n <= 0) return;
	new node = g_hn[g_heap_n];
	new Float:f = g_hf[g_heap_n];
	new c = 0;
	for (;;)
	{
		new l = c * 2 + 1;
		if (l >= g_heap_n) break;
		new r = l + 1;
		if (r < g_heap_n && g_hf[r] < g_hf[l]) l = r;
		if (g_hf[l] >= f) break;
		g_hn[c] = g_hn[l];
		g_hf[c] = g_hf[l];
		c = l;
	}
	g_hn[c] = node;
	g_hf[c] = f;
}

bool:edge_ok(e, own)
{
	if (g_e_gate[e] == 2 && !g_gates) return false;
	new p = g_e_prop[e];
	if (p >= 0)
	{
		switch (g_p_kind[p])
		{
			case PK_HOME: return (p == own);
			case PK_SHOP, PK_PUBLIC: return true;
		}
		return false;
	}
	return true;
}

/// The route from node `from` to node `to` for someone whose own home is property `own`, in g_tmp.
/// Returns its length (0: already there), or -1 for no route.
astar(from, to, own)
{
	if (from < 0 || to < 0) return -1;
	if (from == to)
	{
		g_tmp_len = 0;
		return 0;
	}
	g_gates = get_pcvar_num(g_cv_gates);
	for (new n = 0; n < g_node_count; n++) g_a_state[n] = 0;
	g_heap_n = 0;
	g_a_g[from] = 0.0;
	g_a_from[from] = -1;
	g_a_state[from] = 1;
	heap_push(from, vector_distance(g_n_at[from], g_n_at[to]));
	new bool:found = false;
	while (g_heap_n > 0)
	{
		heap_pop();
		new u = g_pop_node;
		if (g_a_state[u] == 2) continue;
		g_a_state[u] = 2;
		if (u == to)
		{
			found = true;
			break;
		}
		for (new e = g_head[u]; e >= 0; e = g_e_next[e])
		{
			if (!edge_ok(e, own)) continue;
			new v = g_e_to[e];
			if ((u == g_av_a && v == g_av_b) || (u == g_av_b && v == g_av_a)) continue;
			if (g_a_state[v] == 2) continue;
			new Float:ng = g_a_g[u] + g_e_len[e];
			if (g_e_door[e] >= 0) ng += 40.0;
			if (g_a_state[v] == 0 || ng < g_a_g[v])
			{
				g_a_g[v] = ng;
				g_a_from[v] = u;
				g_a_state[v] = 1;
				heap_push(v, ng + vector_distance(g_n_at[v], g_n_at[to]));
			}
		}
	}
	if (!found) return -1;
	new n = 0;
	for (new c = to; c != from && c >= 0; c = g_a_from[c]) n++;
	g_tmp_len = min(n, ROUTE_TMP);
	new k = n;
	for (new c = to; c != from && c >= 0; c = g_a_from[c])
	{
		k--;
		if (k < ROUTE_TMP) g_tmp[k] = c;
	}
	return g_tmp_len;
}

/// Gives NPC i a route to `to`; false for none.
bool:plan_route(i, to)
{
	new from = nearest_node(g_ent[i]);
	if (from < 0) return false;
	if (get_gametime() < g_ban_t[i])
	{
		g_av_a = g_ban_a[i];
		g_av_b = g_ban_b[i];
	}
	new n = astar(from, to, g_home_prop[i]);
	g_av_a = g_av_b = -1;
	if (n < 0) return false;
	g_rlen[i] = min(n, ROUTE_LEN);
	for (new k = 0; k < g_rlen[i]; k++) g_route[i][k] = g_tmp[k];
	g_rpos[i] = 0;
	g_cur[i] = from;
	g_dest[i] = to;
	g_use_goal[i] = false;
	g_blocked[i] = 0.0;
	return true;
}

nearest_node(ent)
{
	new Float:o[3];
	pev(ent, pev_origin, o);
	new best = -1;
	new Float:bd = 1000000.0;
	for (new n = 0; n < g_node_count; n++)
	{
		if (g_n_kind[n] == NK_LADDER || g_n_kind[n] == NK_HATCH) continue;
		new Float:dz = floatabs(g_n_at[n][2] - o[2]);
		if (dz > 70.0) continue;
		new Float:dx = g_n_at[n][0] - o[0];
		new Float:dy = g_n_at[n][1] - o[1];
		new Float:d = dx * dx + dy * dy + dz * dz * 4.0;
		if (d < bd)
		{
			bd = d;
			best = n;
		}
	}
	return best;
}

edge_between(a, b)
{
	for (new e = g_head[a]; e >= 0; e = g_e_next[e])
	{
		if (g_e_to[e] == b) return e;
	}
	return -1;
}

// =======================================================================================================
// the brain: one tick, every 0.1 s
// =======================================================================================================

public task_tick()
{
	g_tick++;
	new Float:now = get_gametime();

	// where the players are
	g_pn = 0;
	g_pe_n = 0;
	for (new id = 1; id <= g_maxpl; id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id)) continue;
		new Float:eye[3], Float:ofs[3];
		pev(id, pev_origin, eye);
		if (is_user_alive(id))
		{
			pev(id, pev_origin, g_pp[g_pn]);
			g_pn++;
			pev(id, pev_view_ofs, ofs);
			eye[0] += ofs[0];
			eye[1] += ofs[1];
			eye[2] += ofs[2];
		}
		// a spectator or a dead player sees too: its eye is where it is
		g_pe[g_pe_n][0] = eye[0];
		g_pe[g_pe_n][1] = eye[1];
		g_pe[g_pe_n][2] = eye[2];
		g_pe_n++;
	}

	// one path at most each tick (a flee first)
	run_queue();

	new Float:hour = clock_hour();
	new Float:near_r = get_pcvar_float(g_cv_near);
	for (new i = 0; i < g_count; i++)
	{
		if (g_ent[i] <= 0 || !pev_valid(g_ent[i])) continue;
		new Float:o[3];
		pev(g_ent[i], pev_origin, o);
		new Float:nd = 1000000.0;
		for (new k = 0; k < g_pn; k++)
		{
			new Float:d = vector_distance(o, g_pp[k]);
			if (d < nd) nd = d;
		}
		new bool:near = (nd < near_r);
		// "far" is not seen: within reach of the walk, or in the line of sight of any player, it walks for real
		if (!near)
		{
			if (now >= g_vis_t[i])
			{
				g_vis_t[i] = now + 0.4;
				g_vis[i] = npc_seen(i);
			}
			near = g_vis[i];
		}
		else
		{
			g_vis[i] = true;
			g_vis_t[i] = now + 0.4;
		}
		if (!near && ((g_tick + i) % 10) != 0) continue;
		new Float:dt = now - g_last[i];
		g_last[i] = now;
		if (dt > 1.5) dt = 1.5;
		if (near && g_far[i]) dt = TICK;   // just came into sight: one ordinary step, not the seconds it was not walked
		g_far[i] = !near;
		if (near) npc_advance(i, now);
		npc_think(i, now, dt, near, hour, o);
	}
	if (get_pcvar_num(g_cv_debug) && g_tick % 100 == 0)
	{
		new real = 0;
		for (new i = 0; i < g_count; i++)
		{
			if (!g_far[i]) real++;
		}
		log_amx("[smak_npc] %d NPC(s): %d walk for real, %d far; in the last 10 s: %d far steps, %d door retries, %d jumps unseen, %d detours/waits", g_count, real, g_count - real, g_dbg_far, g_dbg_retry, g_dbg_jump, g_dbg_giveway);
		g_dbg_far = g_dbg_retry = g_dbg_jump = g_dbg_giveway = 0;
	}
}

npc_think(i, Float:now, Float:dt, bool:near, Float:hour, Float:o[3])
{
	if (g_hidden[i] && g_state[i] != ST_IDLE) set_hidden(i, false);
	switch (g_state[i])
	{
		case ST_TALK:
		{
			if (now >= g_until[i])
			{
				g_state[i] = ST_IDLE;
				g_idle_until[i] = now;
			}
			return;
		}
		case ST_STUNT:
		{
			stunt_step(i, now, dt);
			return;
		}
		case ST_COWER:
		{
			if (now >= g_until[i])
			{
				g_state[i] = ST_IDLE;
				g_idle_until[i] = now;
				g_slot[i] = -1;
			}
			return;
		}
		case ST_WAIT:
		{
			return;
		}
		case ST_WALK, ST_FLEE:
		{
			if (near) walk_near(i, now, dt, o);
			else walk_far(i, now, dt, o);
			return;
		}
	}

	// ST_IDLE: show or hide a sleeper, then see whether the day asks something else of it
	set_hidden(i, !near && g_slot[i] == SLOT_HOME && vector_distance(o, g_n_at[g_home[i]]) < 200.0);
	new slot = npc_slot(i, hour);
	if (g_work[i] < 0 && slot == SLOT_WORK) slot = SLOT_HOME;
	if (slot != g_slot[i] || (slot == SLOT_ROAM && now >= g_idle_until[i]) || (g_fail[i] > 0 && now >= g_idle_until[i]))
	{
		npc_plan_day(i, slot, now);
	}
	else
	{
		npc_anim(i, g_sq_idle[i], 1.0);
	}
	if (near)
	{
		set_hidden(i, false);
	}
}

set_hidden(i, bool:hide)
{
	if (g_hidden[i] == hide) return;
	g_hidden[i] = hide;
	new fx = pev(g_ent[i], pev_effects);
	set_pev(g_ent[i], pev_effects, hide ? (fx | EF_NODRAW) : (fx & ~EF_NODRAW));
}

/// Decides where NPC i goes for `slot` and queues the path.
npc_plan_day(i, slot, Float:now)
{
	new dest = -1;
	switch (slot)
	{
		case SLOT_HOME: dest = g_home[i];
		case SLOT_WORK: dest = g_work[i];
		case SLOT_EVENING: dest = g_eve[i];
		case SLOT_ROAM:
		{
			// a street or a room within 200..1400 units; sometimes a shop
			if (g_sr_n[i] > 0 && random_num(0, 99) < 20)
			{
				dest = g_sr[i][random_num(0, g_sr_n[i] - 1)];
			}
			else if (g_rr_n[i] > 0)
			{
				new Float:o[3];
				pev(g_ent[i], pev_origin, o);
				for (new tries = 0; tries < 8 && dest < 0; tries++)
				{
					new n = g_rr[i][random_num(0, g_rr_n[i] - 1)];
					new Float:d = vector_distance(o, g_n_at[n]);
					if (d > 200.0 && d < 1400.0) dest = n;
				}
				if (dest < 0) dest = g_rr[i][random_num(0, g_rr_n[i] - 1)];
			}
		}
	}
	g_slot[i] = slot;
	if (dest < 0)
	{
		g_idle_until[i] = now + random_float(10.0, 25.0);
		return;
	}
	if (vector_distance_ent(i, dest) < 40.0)
	{
		g_dest[i] = dest;
		g_idle_until[i] = now + random_float(15.0, 45.0);
		return;
	}
	g_want[i] = dest;
	g_want_flee[i] = false;
	g_settle[i] = 0;
	g_state[i] = ST_WAIT;
}

Float:vector_distance_ent(i, node)
{
	new Float:o[3];
	pev(g_ent[i], pev_origin, o);
	return vector_distance(o, g_n_at[node]);
}

/// The path queue: one A* each tick, a flee before a walk.
run_queue()
{
	new pick = -1;
	new n = g_count;
	for (new k = 0; k < n && pick < 0; k++)
	{
		new i = (g_queue_at + k) % n;
		if (g_state[i] == ST_WAIT && g_want_flee[i]) pick = i;
	}
	for (new k = 0; k < n && pick < 0; k++)
	{
		new i = (g_queue_at + k) % n;
		if (g_state[i] == ST_WAIT) pick = i;
	}
	if (pick < 0) return;
	g_queue_at = (pick + 1) % n;
	new Float:now = get_gametime();
	new i = pick;
	if (g_want_flee[i])
	{
		if (start_flee(i, now)) return;
		// nowhere to run: it cowers where it stands
		g_state[i] = ST_COWER;
		g_until[i] = now + random_float(4.0, 7.0);
		npc_anim(i, g_sq_idle[i], 1.0);
		g_want_flee[i] = false;
		return;
	}
	if (plan_route(i, g_want[i]))
	{
		g_state[i] = ST_WALK;
		g_fail[i] = 0;
		g_blocked[i] = 0.0;
		if (g_rlen[i] == 0)
		{
			npc_arrived(i, now);
		}
		return;
	}
	g_fail[i]++;
	g_state[i] = ST_IDLE;
	g_idle_until[i] = now + 10.0;
	if (get_pcvar_num(g_cv_debug))
	{
		log_amx("[smak_npc] npc %d (%s): no route to node %d (%d failures)", i, g_name[i], g_want[i], g_fail[i]);
	}
	if (g_slot[i] == SLOT_EVENING)
	{
		// the bar cannot be reached from where it lives: no evening out
		g_eve[i] = -1;
		g_slot[i] = -1;
		g_fail[i] = 0;
	}
	else if (g_fail[i] >= 3 && g_slot[i] != SLOT_HOME)
	{
		g_slot[i] = -1;
	}
}

// =======================================================================================================
// walking
// =======================================================================================================

/// The point NPC i is walking to, false when it has none. The origin of a body: a node's z, plus 1.
bool:walk_target(i, Float:t[3])
{
	if (g_use_goal[i])
	{
		t[0] = g_goal[i][0];
		t[1] = g_goal[i][1];
		t[2] = g_goal[i][2];
		return true;
	}
	if (g_rpos[i] >= g_rlen[i]) return false;
	new nd = g_route[i][g_rpos[i]];
	t[0] = g_n_at[nd][0];
	t[1] = g_n_at[nd][1];
	t[2] = g_n_at[nd][2] + 1.0;
	return true;
}

/// A node reached: step on, and open the door of the next link.
node_reached(i, Float:now)
{
	g_cur[i] = g_route[i][g_rpos[i]];
	g_rpos[i]++;
	g_blocked[i] = 0.0;
	if (g_rpos[i] < g_rlen[i])
	{
		new e = edge_between(g_cur[i], g_route[i][g_rpos[i]]);
		if (e >= 0 && g_e_door[e] >= 0) open_door(i, g_e_door[e], now);
	}
}

open_door(i, slot, Float:now)
{
	if (now - g_door_t[i] < 1.5) return;
	g_door_t[i] = now;
	new ent = -1;
	new found = 0;
	// DoorUse acts only on a door that is shut (or open with no auto-return): a door already open ignores it
	while ((ent = find_ent_by_tname(ent, g_door_name[slot])) > 0)
	{
		dllfunc(DLLFunc_Use, ent, g_ent[i]);
		found++;
	}
	g_dbg_retry++;
	if (get_pcvar_num(g_cv_debug) > 1 || (found == 0 && get_pcvar_num(g_cv_debug)))
	{
		log_amx("[smak_npc] npc %d (%s) uses door '%s': %d entit%s", i, g_name[i], g_door_name[slot], found, found == 1 ? "y" : "ies");
	}
}

/// Near a player: real steps, with the world's collision, ten times a second.
walk_near(i, Float:now, Float:dt, Float:o[3])
{
	new ent = g_ent[i];
	new bool:flee = (g_state[i] == ST_FLEE);
	new Float:speed = get_pcvar_float(flee ? g_cv_run : g_cv_walk);
	new Float:t[3];
	if (!walk_target(i, t))
	{
		npc_arrived(i, now);
		return;
	}
	new Float:dx = t[0] - o[0];
	new Float:dy = t[1] - o[1];
	new Float:dh = floatsqroot(dx * dx + dy * dy);
	if (dh < ARRIVE && floatabs(t[2] - o[2]) < 50.0)
	{
		if (g_use_goal[i])
		{
			g_use_goal[i] = false;
			npc_arrived(i, now);
		}
		else
		{
			node_reached(i, now);
			if (g_rpos[i] >= g_rlen[i]) npc_arrived(i, now);
		}
		return;
	}
	new Float:dir[3], Float:ang[3];
	dir[0] = dx;
	dir[1] = dy;
	dir[2] = 0.0;
	vector_to_angle(dir, ang);
	ang[0] = 0.0;
	ang[2] = 0.0;
	set_pev(ent, pev_angles, ang);
	if (g_blocked[i] > 0.3 && !g_use_goal[i])
	{
		// held up (a bench, a door that is opening): stand, do not walk on the spot
		npc_anim(i, g_sq_idle[i], 1.0);
	}
	else if (flee) npc_anim(i, g_sq_run[i], speed / g_gs_run[i]);
	else npc_anim(i, g_sq_walk[i], speed / g_gs_walk[i]);

	// the door after the node ahead: open it in good time, a leaf takes about a second to swing
	if (!g_use_goal[i] && g_rpos[i] + 1 < g_rlen[i] && dh < 110.0)
	{
		new e2 = edge_between(g_route[i][g_rpos[i]], g_route[i][g_rpos[i] + 1]);
		if (e2 >= 0 && g_e_door[e2] >= 0) open_door(i, g_e_door[e2], now);
	}

	new Float:step = speed * dt;
	if (step > dh) step = dh;
	engfunc(EngFunc_WalkMove, ent, ang[1], step, WALKMOVE_NORMAL);

	new Float:o2[3];
	pev(ent, pev_origin, o2);
	new Float:moved = floatsqroot((o2[0] - o[0]) * (o2[0] - o[0]) + (o2[1] - o[1]) * (o2[1] - o[1]));
	if (moved < step * 0.3)
	{
		g_blocked[i] += dt;
		if (g_blocked[i] > 0.5 && g_rpos[i] < g_rlen[i])
		{
			// a closed door in the way? try its use again
			new e = edge_between(g_cur[i], g_route[i][g_rpos[i]]);
			if (e >= 0 && g_e_door[e] >= 0) open_door(i, g_e_door[e], now);
		}
		if (g_blocked[i] > 1.5)
		{
			if (!npc_seen(i))
			{
				// stuck where nobody sees it: a short slide toward the point, then the node itself
				nudge(i, o2, t, 16.0);
				g_dbg_jump++;
				if (g_blocked[i] > 6.0)
				{
					nudge(i, o2, t, 9999.0);
					g_blocked[i] = 0.0;
				}
			}
			else if (g_blocked[i] > 4.0)
			{
				// somebody is looking: never through a door or a wall; another way, or wait
				give_way(i, now);
			}
		}
	}
	else
	{
		g_blocked[i] = 0.0;
	}
}

/// Blocked for seconds in sight of a player: leave out the link it is stuck on and plan again; with no other
/// way, stop where it is and try again later (its day replans it).
give_way(i, Float:now)
{
	g_dbg_giveway++;
	g_blocked[i] = 0.0;
	if (get_pcvar_num(g_cv_debug))
	{
		new Float:o[3];
		pev(g_ent[i], pev_origin, o);
		log_amx("[smak_npc] npc %d (%s) is held up at %.0f %.0f %.0f in sight: another way or wait", i, g_name[i], o[0], o[1], o[2]);
	}
	if (!g_use_goal[i] && g_rpos[i] < g_rlen[i] && g_dest[i] >= 0)
	{
		g_ban_a[i] = g_cur[i];
		g_ban_b[i] = g_route[i][g_rpos[i]];
		g_ban_t[i] = now + 40.0;
		new dest = g_dest[i];
		if (plan_route(i, dest)) return;
	}
	g_rlen[i] = 0;
	g_rpos[i] = 0;
	g_use_goal[i] = false;
	if (g_state[i] == ST_FLEE)
	{
		g_state[i] = ST_COWER;
		g_until[i] = now + random_float(4.0, 7.0);
	}
	else
	{
		g_state[i] = ST_IDLE;
		g_idle_until[i] = now + 6.0;
		g_slot[i] = -1;
	}
	npc_anim(i, g_sq_idle[i], 1.0);
}

bool:player_near_point(const Float:p[3], Float:r)
{
	for (new k = 0; k < g_pn; k++)
	{
		if (vector_distance(g_pp[k], p) < r) return true;
	}
	return false;
}

/// Moves NPC i `len` units toward t (the whole way for a big len), unless a player stands there.
nudge(i, const Float:from[3], const Float:t[3], Float:len)
{
	new Float:d = vector_distance(from, t);
	new Float:p[3];
	if (d <= len || d < 1.0)
	{
		p[0] = t[0];
		p[1] = t[1];
		p[2] = t[2];
	}
	else
	{
		new Float:f = len / d;
		p[0] = from[0] + (t[0] - from[0]) * f;
		p[1] = from[1] + (t[1] - from[1]) * f;
		p[2] = from[2] + (t[2] - from[2]) * f;
	}
	if (player_near_point(p, 56.0)) return;
	engfunc(EngFunc_SetOrigin, g_ent[i], p);
}

/// Not near and not seen by any player (npc_seen): a 1 Hz step along the route, no collision, no animation.
walk_far(i, Float:now, Float:dt, Float:o[3])
{
	new ent = g_ent[i];
	new bool:flee = (g_state[i] == ST_FLEE);
	new Float:speed = get_pcvar_float(flee ? g_cv_run : g_cv_walk);
	new Float:left = speed * dt;
	new Float:p[3];
	p[0] = o[0];
	p[1] = o[1];
	p[2] = o[2];
	new Float:face = 0.0;
	new bool:moved = false;
	new guard = 0;
	while (left > 0.5 && guard++ < 24)
	{
		new Float:t[3];
		if (!walk_target(i, t))
		{
			break;
		}
		new Float:d = vector_distance(p, t);
		if (d <= left)
		{
			left -= d;
			p[0] = t[0];
			p[1] = t[1];
			p[2] = t[2];
			moved = true;
			if (g_use_goal[i])
			{
				g_use_goal[i] = false;
			}
			else
			{
				g_cur[i] = g_route[i][g_rpos[i]];
				g_rpos[i]++;
			}
		}
		else
		{
			new Float:f = left / d;
			new Float:dir[3], Float:ang[3];
			dir[0] = t[0] - p[0];
			dir[1] = t[1] - p[1];
			dir[2] = 0.0;
			vector_to_angle(dir, ang);
			face = ang[1];
			p[0] += (t[0] - p[0]) * f;
			p[1] += (t[1] - p[1]) * f;
			p[2] += (t[2] - p[2]) * f;
			left = 0.0;
			moved = true;
		}
	}
	if (moved)
	{
		g_dbg_far++;
		engfunc(EngFunc_SetOrigin, ent, p);
		if (face != 0.0)
		{
			new Float:a[3];
			a[1] = face;
			set_pev(ent, pev_angles, a);
		}
	}
	new Float:t2[3];
	if (!walk_target(i, t2) || (g_rpos[i] >= g_rlen[i] && !g_use_goal[i]))
	{
		npc_arrived(i, now);
	}
}

/// The end of a route.
npc_arrived(i, Float:now)
{
	g_rlen[i] = 0;
	g_rpos[i] = 0;
	g_use_goal[i] = false;
	if (g_state[i] == ST_FLEE)
	{
		g_state[i] = ST_COWER;
		g_until[i] = now + random_float(6.0, 10.0);
		npc_anim(i, g_sq_idle[i], 1.0);
		return;
	}
	g_state[i] = ST_IDLE;
	npc_anim(i, g_sq_idle[i], 1.0);
	g_idle_until[i] = now + ((g_slot[i] == SLOT_ROAM) ? random_float(15.0, 45.0) : 5.0);

	// somebody already standing here? take a place beside
	new Float:o[3];
	pev(g_ent[i], pev_origin, o);
	if (g_settle[i] < 2 && crowded(i, o))
	{
		g_settle[i]++;
		for (new k = 0; k < 8; k++)
		{
			new Float:a = float(k) * 45.0;
			new Float:c[3];
			c[0] = o[0] + 40.0 * floatcos(a, degrees);
			c[1] = o[1] + 40.0 * floatsin(a, degrees);
			c[2] = o[2];
			if (crowded(i, c)) continue;
			if (!hull_clear(g_ent[i], o, c)) continue;
			g_goal[i][0] = c[0];
			g_goal[i][1] = c[1];
			g_goal[i][2] = c[2];
			g_use_goal[i] = true;
			g_state[i] = ST_WALK;
			break;
		}
	}
}

bool:crowded(i, const Float:p[3])
{
	for (new j = 0; j < g_count; j++)
	{
		if (j == i || g_ent[j] <= 0 || !pev_valid(g_ent[j])) continue;
		new Float:q[3];
		pev(g_ent[j], pev_origin, q);
		if (floatabs(q[2] - p[2]) < 40.0 && floatabs(q[0] - p[0]) < 34.0 && floatabs(q[1] - p[1]) < 34.0) return true;
	}
	return false;
}

bool:hull_clear(ent, const Float:a[3], const Float:b[3])
{
	new tr = create_tr2();
	engfunc(EngFunc_TraceHull, a, b, DONT_IGNORE_MONSTERS, HULL_HUMAN, ent, tr);
	new Float:frac;
	get_tr2(tr, TR_flFraction, frac);
	new bool:solid = bool:(get_tr2(tr, TR_AllSolid) || get_tr2(tr, TR_StartSolid));
	free_tr2(tr);
	return (frac >= 1.0 && !solid);
}

// =======================================================================================================
// fleeing
// =======================================================================================================

/// Gunfire or a hurt player at `src`: every NPC within `radius` runs.
npc_scare(const Float:src[3], Float:radius)
{
	new Float:now = get_gametime();
	for (new i = 0; i < g_count; i++)
	{
		if (g_ent[i] <= 0 || !pev_valid(g_ent[i])) continue;
		if (g_state[i] == ST_STUNT) continue;
		if (g_state[i] == ST_FLEE && now - g_flee_t[i] < 3.0) continue;
		if (g_state[i] == ST_WAIT && g_want_flee[i]) continue;
		new Float:o[3];
		pev(g_ent[i], pev_origin, o);
		if (vector_distance(o, src) > radius) continue;
		g_scare[i][0] = src[0];
		g_scare[i][1] = src[1];
		g_scare[i][2] = src[2];
		g_want_flee[i] = true;
		g_state[i] = ST_WAIT;
		g_flee_t[i] = now;
		set_hidden(i, false);
	}
}

/// Picks a flee node (away from the scare, 120..1100 units off) and starts the run. False for none.
bool:start_flee(i, Float:now)
{
	new Float:o[3];
	pev(g_ent[i], pev_origin, o);
	new Float:dsrc = vector_distance(o, g_scare[i]);
	new best[3], Float:score[3];
	for (new k = 0; k < 3; k++)
	{
		best[k] = -1;
		score[k] = 1000000.0;
	}
	for (new n = 0; n < g_node_count; n++)
	{
		new kind = g_n_kind[n];
		if (kind != NK_STREET && kind != NK_ROOM && kind != NK_STAIR && kind != NK_PLACE) continue;
		new Float:dn = vector_distance(o, g_n_at[n]);
		if (dn < 120.0 || dn > 1100.0) continue;
		new Float:ds = vector_distance(g_scare[i], g_n_at[n]);
		if (ds < dsrc + 250.0) continue;
		new Float:sc = dn - 0.3 * ds;
		for (new k = 0; k < 3; k++)
		{
			if (sc < score[k])
			{
				for (new m = 2; m > k; m--)
				{
					score[m] = score[m - 1];
					best[m] = best[m - 1];
				}
				score[k] = sc;
				best[k] = n;
				break;
			}
		}
	}
	g_want_flee[i] = false;
	for (new k = 0; k < 3; k++)
	{
		if (best[k] < 0) continue;
		if (!plan_route(i, best[k])) continue;
		g_state[i] = ST_FLEE;
		g_flee_t[i] = now;
		g_blocked[i] = 0.0;
		maybe_stunt(i, now);
		return true;
	}
	return false;
}

/// A roll, a cartwheel or a sprint-roll from the model: only with a clear floor ahead (traced), and only
/// where somebody can see it.
maybe_stunt(i, Float:now)
{
	if (random_num(0, 99) >= 60) return;
	new Float:o[3];
	pev(g_ent[i], pev_origin, o);
	new bool:seen = false;
	for (new k = 0; k < g_pn && !seen; k++)
	{
		if (vector_distance(o, g_pp[k]) < get_pcvar_float(g_cv_near)) seen = true;
	}
	if (!seen) return;
	new Float:t[3];
	if (!walk_target(i, t)) return;
	// not in front of a door we are about to open
	if (g_rlen[i] > 0)
	{
		new e = edge_between(g_cur[i], g_route[i][0]);
		if (e >= 0 && g_e_door[e] >= 0) return;
	}
	new Float:dir[3], Float:ang[3];
	dir[0] = t[0] - o[0];
	dir[1] = t[1] - o[1];
	dir[2] = 0.0;
	if (vector_length(dir) < 100.0) return;
	vector_to_angle(dir, ang);
	for (new tries = 0; tries < 3; tries++)
	{
		new s = random_num(0, 2);
		if (g_sq_st[i][s] < 0) continue;
		new Float:len = g_st_speed[s] * g_st_time[s];
		if (len > vector_length(dir) - 40.0) continue;
		new Float:fwd[3], Float:end[3];
		angle_vector(ang, ANGLEVECTOR_FORWARD, fwd);
		end[0] = o[0] + fwd[0] * (len + 24.0);
		end[1] = o[1] + fwd[1] * (len + 24.0);
		end[2] = o[2];
		if (!hull_clear(g_ent[i], o, end)) continue;
		// the floor at the end and half way: within a stair's step of the floor under its feet
		if (!floor_near(o, end, o[2] - 36.0)) continue;
		new Float:mid[3];
		mid[0] = (o[0] + end[0]) * 0.5;
		mid[1] = (o[1] + end[1]) * 0.5;
		mid[2] = o[2];
		if (!floor_near(o, mid, o[2] - 36.0)) continue;
		g_stunt[i] = s;
		g_stunt_yaw[i] = ang[1];
		g_until[i] = now + g_st_time[s];
		g_state[i] = ST_STUNT;
		npc_anim(i, g_sq_st[i][s], 1.0, true);
		new Float:a[3];
		a[1] = ang[1];
		set_pev(g_ent[i], pev_angles, a);
		return;
	}
}

bool:floor_near(const Float:o[3], const Float:p[3], Float:floor_z)
{
	new Float:a[3], Float:b[3];
	a[0] = p[0];
	a[1] = p[1];
	a[2] = o[2];
	b[0] = p[0];
	b[1] = p[1];
	b[2] = o[2] - 90.0;
	new tr = create_tr2();
	engfunc(EngFunc_TraceLine, a, b, IGNORE_MONSTERS, 0, tr);
	new Float:frac, Float:hit[3];
	get_tr2(tr, TR_flFraction, frac);
	get_tr2(tr, TR_vecEndPos, hit);
	free_tr2(tr);
	if (frac >= 1.0) return false;
	return (floatabs(hit[2] - floor_z) <= 18.0);
}

stunt_step(i, Float:now, Float:dt)
{
	new s = g_stunt[i];
	if (s < 0 || now >= g_until[i])
	{
		g_stunt[i] = -1;
		g_state[i] = ST_FLEE;
		npc_anim(i, g_sq_run[i], get_pcvar_float(g_cv_run) / g_gs_run[i], true);
		return;
	}
	new Float:before[3], Float:after[3];
	pev(g_ent[i], pev_origin, before);
	new Float:step = g_st_speed[s] * dt;
	engfunc(EngFunc_WalkMove, g_ent[i], g_stunt_yaw[i], step, WALKMOVE_NORMAL);
	pev(g_ent[i], pev_origin, after);
	if (vector_distance(before, after) < step * 0.3)
	{
		// a wall, a step too high, somebody: the stunt ends here
		g_until[i] = now;
	}
}

// =======================================================================================================
// hearing: gunfire and hurt players
// =======================================================================================================

public fw_playback(flags, invoker, eventindex, Float:delay, Float:origin[3], Float:angles[3], Float:fparam1, Float:fparam2, iparam1, iparam2, bparam1, bparam2)
{
	if (invoker < 1 || invoker > g_maxpl) return FMRES_IGNORED;
	new Float:now = get_gametime();
	if (now - g_noise_t[invoker] < 0.4) return FMRES_IGNORED;
	if (!is_user_alive(invoker)) return FMRES_IGNORED;
	g_noise_t[invoker] = now;
	new Float:p[3];
	pev(invoker, pev_origin, p);
	npc_scare(p, get_pcvar_float(g_cv_hear));
	return FMRES_IGNORED;
}

public fw_hurt(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (damage < 1.0 || !is_user_connected(victim)) return HAM_IGNORED;
	new Float:p[3];
	pev(victim, pev_origin, p);
	npc_scare(p, get_pcvar_float(g_cv_hear) * 1.2);
	return HAM_IGNORED;
}

// =======================================================================================================
// talking
// =======================================================================================================

npc_looked_at(id)
{
	new Float:eye[3], Float:ofs[3], Float:view[3], Float:fwd[3];
	pev(id, pev_origin, eye);
	pev(id, pev_view_ofs, ofs);
	eye[0] += ofs[0];
	eye[1] += ofs[1];
	eye[2] += ofs[2];
	pev(id, pev_v_angle, view);
	angle_vector(view, ANGLEVECTOR_FORWARD, fwd);
	new best = -1;
	new Float:best_dot = 0.9;
	for (new i = 0; i < g_count; i++)
	{
		if (g_ent[i] <= 0 || !pev_valid(g_ent[i])) continue;
		new Float:at[3], Float:to[3];
		pev(g_ent[i], pev_origin, at);
		for (new k = 0; k < 3; k++) to[k] = at[k] - eye[k];
		new Float:dist = vector_length(to);
		if (dist > USE_RANGE + 16.0 || dist < 1.0) continue;
		new Float:dot = (to[0] * fwd[0] + to[1] * fwd[1] + to[2] * fwd[2]) / dist;
		if (dot > best_dot)
		{
			best_dot = dot;
			best = i;
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
	if (pev(id, pev_flags) & FL_DUCKING) return FMRES_IGNORED;     // use while ducking is smak_script's (its menus)
	new Float:now = get_gametime();
	if (now < g_next_use[id]) return FMRES_IGNORED;
	new i = npc_looked_at(id);
	if (i < 0) return FMRES_IGNORED;
	g_next_use[id] = now + 0.6;
	talk_to(id, i, now);
	return FMRES_IGNORED;
}

talk_to(id, i, Float:now)
{
	new bool:scared = (g_state[i] == ST_FLEE || g_state[i] == ST_COWER || now - g_flee_t[i] < 12.0);
	new Float:hour = clock_hour();
	new mood = 0;
	if (scared) mood = 3;
	else if (g_slot[i] == SLOT_HOME || (g_lt[i] != LT_CITIZEN && g_lt[i] != LT_WORKER && g_slot[i] != SLOT_WORK)) mood = 2;
	else if (g_slot[i] == SLOT_EVENING || hour >= 17.0) mood = 1;
	if (hour >= 22.0 || hour < 6.0) mood = scared ? 3 : 2;
	new idx = g_lt[i] * 4 + mood;

	new greet[48];
	greet[0] = 0;
	new lang = get_pcvar_num(g_cv_lang);
	if (!scared)
	{
		if (hour >= 5.0 && hour < 12.0) copy(greet, charsmax(greet), lang ? "Buenos dias. " : "Good morning. ");
		else if (hour >= 12.0 && hour < 19.0) copy(greet, charsmax(greet), lang ? "Buenas tardes. " : "Good afternoon. ");
		else copy(greet, charsmax(greet), lang ? "Buenas noches. " : "Good evening. ");
	}
	if (lang) client_print(id, print_chat, "[%s] %s%s", g_name[i], greet, g_say_es[idx]);
	else client_print(id, print_chat, "[%s] %s%s", g_name[i], greet, g_say_en[idx]);

	// it stops, turns to the player and looks at them for a few seconds (unless it is running)
	if (g_state[i] == ST_IDLE || g_state[i] == ST_WALK)
	{
		new Float:o[3], Float:p[3], Float:dir[3], Float:ang[3];
		pev(g_ent[i], pev_origin, o);
		pev(id, pev_origin, p);
		dir[0] = p[0] - o[0];
		dir[1] = p[1] - o[1];
		dir[2] = 0.0;
		vector_to_angle(dir, ang);
		ang[0] = 0.0;
		ang[2] = 0.0;
		set_pev(g_ent[i], pev_angles, ang);
		g_state[i] = ST_TALK;
		g_until[i] = now + 4.0;
		g_idle_until[i] = now + 4.0;
		g_rlen[i] = 0;
		g_rpos[i] = 0;
		g_slot[i] = -1;
		npc_anim(i, g_sq_idle[i], 1.0);
	}
}

// =======================================================================================================
// admin commands
// =======================================================================================================

public cmd_status(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
	new const roles[][] = { "keeper", "worker", "citizen", "patrol", "smuggler", "wanted" };
	new const states[][] = { "idle", "walk", "flee", "cower", "talk", "stunt", "wait" };
	new const slots[][] = { "home", "work", "evening", "roam" };
	console_print(id, "smak_npc: %d NPC(s), game hour %.1f (a day is %d min), gates %d", g_count, clock_hour(), get_pcvar_num(g_cv_day), get_pcvar_num(g_cv_gates));
	for (new i = 0; i < g_count; i++)
	{
		new Float:o[3];
		pev(g_ent[i], pev_origin, o);
		new s = g_slot[i];
		console_print(id, "%2d %-8s %-7s %-6s %-8s at %.0f %.0f %.0f  dest node %d  %s%s", i, roles[g_role[i]], g_name[i], states[g_state[i]], (s >= 0) ? slots[s] : "-", o[0], o[1], o[2], g_dest[i], g_far[i] ? "far" : "real", g_vis[i] ? " seen" : "");
	}
	return PLUGIN_HANDLED;
}

public cmd_hour(id, level, cid)
{
	if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
	new text[16];
	read_argv(1, text, charsmax(text));
	new Float:h = floatstr(text);
	if (h < 0.0 || h >= 24.0001)
	{
		console_print(id, "smak_npc_hour <0-24>");
		return PLUGIN_HANDLED;
	}
	new daysec = max(60, floatround(get_pcvar_float(g_cv_day) * 60.0));
	new want = floatround(h * float(daysec) / 24.0);
	g_shift = (want - (get_systime() % daysec)) % daysec;
	if (g_shift < 0) g_shift += daysec;
	console_print(id, "smak_npc: game hour is now %.1f", clock_hour());
	return PLUGIN_HANDLED;
}

public cmd_scare(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
	if (id < 1 || !is_user_alive(id))
	{
		console_print(id, "smak_npc_scare: from a player in game");
		return PLUGIN_HANDLED;
	}
	new Float:p[3];
	pev(id, pev_origin, p);
	npc_scare(p, 1500.0);
	console_print(id, "smak_npc: the NPCs within 1500 units run");
	return PLUGIN_HANDLED;
}
