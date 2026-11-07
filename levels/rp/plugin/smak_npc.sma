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
 * Never in the way ("clearance", after the walking code): an NPC idles, waits or talks only where it blocks nothing. A spot
 * within 52 units of a door leaf's box, 64 of a way down (manhole, drain, ladder, trapdoor, stair to the sewer) or in a
 * passage narrower than smak_npc_narrow (80) is left for the nearest clear one (hull-traced); a player pushing into one
 * (the keys toward it, 0.7 s) makes it step aside with a word ("Perdon"), never a guard hunting that player; use on a
 * citizen or worker says its line and steps aside; one that makes no headway for smak_npc_unstick (6) seconds is
 * moved on, unseen, or re-planned, in sight. Cvars: smak_npc_clear 1, smak_npc_narrow 80, smak_npc_yield 1, smak_npc_unstick 6.
 *
 * Surveillance drones ("drones", at the end): at smak_drone_stars (4) a wanted player gets a flying drone
 * (models/smak/drone.mdl) that follows him, lights him and feeds his place to the guards; it can be shot down.
 * Cvars: smak_drone_enable 1, _stars 4, _max 2 (cap 4), _health 60, _speed 340, _height 150, _sight 1800,
 * _lose 45, _cooldown 60, _dmg 0 (off), _debug 0. At most 4 entities, "smak_drone" class.
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
#define SMAK_LAW_OPTIONAL
#include <smak_law>
#define SMAK_DOORS_OPTIONAL
#include <smak_doors>

// optional natives (a native filter and LibraryExists tell whether they are there): smak_law, smak_doors, smak_rp
native smak_rp_in_arena(id);

#define PLUGIN  "SMAK NPC"
#define VERSION "0.2"
#define AUTHOR  "SMAK"

// ---- limits ---------------------------------------------------------------------------------------------

#define MAX_NODES    1024
#define MAX_EDGES    4096
#define MAX_PROPS    96
#define MAX_PLACES   64
#define MAX_DOORS    160
#define MAX_ROAM     192
#define MAX_NPC      40
#define MAX_WP       24
#define MAX_GUARDS   8
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
#define PK_POLICE    4
#define PK_JAIL      5

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
#define ROLE_GUARD     3   // the regime's guards (see "guards" below)
#define ROLE_SMUGGLER  4   // phase 2: the level below
#define ROLE_WANTED    5   // phase 2

// the line tables: one per kind of person
#define LT_SHOP      0
#define LT_BAR       1
#define LT_MEDIC     2
#define LT_MECHANIC  3
#define LT_WORKER    4
#define LT_CITIZEN   5
#define LT_GUARD     6

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

// what a route is planned for: a civilian's number is its home property (0 or more); a guard's is one of these
#define OWN_PATROL   -2   // streets, shops, public halls, police rooms, gates; no homes
#define OWN_BREACH   -3   // a hunt at 3 stars: everywhere, locked doors too (they are breached when met)
#define OWN_HUNT     -4   // a hunt: everywhere through the doors that are not locked

// a guard's modes
#define GM_PATROL    0
#define GM_WATCH     1
#define GM_CHASE     2
#define GM_SEARCH    3
#define GM_BREACH    4
#define GM_ARREST    5

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
new bool:g_door_isgate[MAX_DOORS];   // a checkpoint gate: a guard always passes it
new bool:g_dl[MAX_DOORS];            // locked, as smak_doors last said (see locks_refresh)
new Float:g_dl_t[MAX_DOORS];

// every door leaf's closed pose, taken at map start: a toggle door (wait -1) closes at a second use, so a door is used
// only while it is shut, never while it is open or moving
#define MAX_LEAVES   320
new g_lf_n;
new g_lf_ent[MAX_LEAVES];
new Float:g_lf_org[MAX_LEAVES][3];
new Float:g_lf_ang[MAX_LEAVES][3];
new Float:g_lf_min[MAX_LEAVES][3];     // the leaf's box at map start (closed)
new Float:g_lf_max[MAX_LEAVES][3];

// the ways down (a manhole, a drain, a ladder's ends, a trapdoor, the sewer's stair): nobody stands on or under one
#define MAX_WAYS     48
new g_way_n;
new Float:g_way_at[MAX_WAYS][3];

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
new bool:g_pl_post[MAX_PLACES];       // a police place: a post where a guard stands

new g_wp_count, g_wp_posts, g_wp_src;  // the guards' waypoints: posts first, then the gates' two sides (g_wp_src: 1 places, 2 police properties, 3 gates)
new g_wp[MAX_WP];

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

new g_cv_clear, g_cv_narrow, g_cv_yield, g_cv_unstick;
new g_cv_enable, g_cv_max, g_cv_workers, g_cv_day, g_cv_near, g_cv_walk, g_cv_run, g_cv_hear, g_cv_lang, g_cv_gates, g_cv_debug, g_cv_solid, g_cv_see;

// ---- the guards (their code is in "guards", below) ---------------------------------------------------

enum
{
	GC_ENABLE, GC_COUNT, GC_RANGE, GC_FOV, GC_CLOSE, GC_JOG, GC_LOSE1, GC_CALL, GC_BREACH, GC_BREACH_SEC,
	GC_ARR_RANGE, GC_ARR_SEC, GC_STOP_SEC, GC_GRAB, GC_GRAB_SCALE, GC_SEARCH_SEC, GC_SEARCH_RAD, GC_REPLAN,
	GC_ESCAPE, GC_ESCAPE_CD, GC_DEBUG, GC_KNOCK, GC_N
};
new g_gc[GC_N];

new const g_gm_name[][] = { "patrol", "watch", "chase", "search", "breach", "arrest" };

new g_gcount;                      // guards made
new g_gm[MAX_NPC];                 // mode
new g_gtgt[MAX_NPC];               // the player it hunts, 0 for none
new Float:g_gseen[MAX_NPC];        // when this guard last saw the target, or was told where he is
new Float:g_glk[MAX_NPC][3];       // the last known place of the target
new Float:g_gt_enter[MAX_NPC];     // when the mode began
new g_gwp[MAX_NPC];                // the waypoint it patrols to / from
new bool:g_gdw[MAX_NPC];           // standing at a waypoint or a search node
new Float:g_gdw_until[MAX_NPC];
new Float:g_gturn[MAX_NPC];        // next look-about
new Float:g_gplan[MAX_NPC];        // next plan (0: not planned in this mode yet)
new Float:g_gwarn[MAX_NPC];        // next thing it may shout
new Float:g_gsearch_end[MAX_NPC];  // 0: the search has not started
new Float:g_garr[MAX_NPC];         // seconds the target has been held
new Float:g_gstill[MAX_NPC];       // seconds the target has stood still
new Float:g_glook[MAX_NPC];        // next look for a wanted player
new g_gbdoor[MAX_NPC];             // the door slot of a breach
new Float:g_gbend[MAX_NPC];
new Float:g_gbmsg[MAX_NPC];
new Float:g_gbpos[MAX_NPC][3];     // the door's middle
new g_wl[MAXPL];                   // wanted level now (0 inside an arena or when smak_law is not there)
new g_wlp[MAXPL];                  // at the last poll
new Float:g_pseen[MAXPL];          // when a guard last saw the player
new Float:g_pcall[MAXPL];          // last radio call about him
new bool:g_phunt[MAXPL];           // guards are on him
new Float:g_pescape[MAXPL];        // last time he lost them
new bool:g_any_wanted;
new g_hud;
new g_plan_tick;
new g_dl_at;                       // round-robin of the lock cache

new bool:g_has_law, bool:g_has_doors, bool:g_has_arena;
new bool:g_dr_on;                  // the surveillance drones are on (see "drones", at the end)

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
new Float:g_clr_t[MAX_NPC];      // next test of the spot it stands at (clearance)
new Float:g_push[MAX_NPC];       // seconds a player has pushed into it
new Float:g_say_t[MAX_NPC];      // it may say "Perdon" again after this
new Float:g_stk_t[MAX_NPC];      // next progress test of a walk
new Float:g_stk_o[MAX_NPC][3];
new g_pid[MAXPL];                // the player of g_pp[k]
new Float:g_pwish[MAXPL][2];     // where his keys send him (a unit vector, flat)
new bool:g_pwish_on[MAXPL];
new g_dbg_aside, g_dbg_unstick;

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
new const g_model[9][] = {
	"models/player/proletarian/proletarian.mdl",
	"models/player/proletarian_dirty/proletarian_dirty.mdl",
	"models/player/proletarian_healthy/proletarian_healthy.mdl",
	"models/player/prole_fem/prole_fem.mdl",
	"models/player/prole_bfem/prole_bfem.mdl",
	"models/player/ins_medic/ins_medic.mdl",
	"models/player/msrdroid_bot/msrdroid_bot.mdl",     // 6-8: the guard's, the first of them there is (all have the same 171 sequences)
	"models/player/merc/merc.mdl",
	"models/player/agent/agent.mdl"
};
new bool:g_model_ok[9];
new g_guard_mdl = -1;

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
	g_guard_mdl = -1;
	for (new m = 6; m < 9 && g_guard_mdl < 0; m++)
	{
		if (file_exists(g_model[m]))
		{
			g_model_ok[m] = true;
			g_guard_mdl = m;
			precache_model(g_model[m]);
		}
	}
	drone_precache();
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
	set_native_filter("native_filter");
}

// smak_law, smak_doors and smak_rp are optional: a missing one is never called (g_has_law, g_has_doors, g_has_arena)
public native_filter(const name[], index, trap)
{
	if (trap) return PLUGIN_CONTINUE;
	if (equal(name, "smak_law_", 9) || equal(name, "smak_door_", 10) || equal(name, "smak_rp_in_arena")) return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
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
	g_cv_clear = register_cvar("smak_npc_clear", "1");      // 1: nobody idles in a doorway, on a way down or in a narrow passage
	g_cv_narrow = register_cvar("smak_npc_narrow", "80");   // a passage narrower than this (wall to wall) is not a place to stand
	g_cv_yield = register_cvar("smak_npc_yield", "1");      // 1: one a player pushes into steps aside; use on a citizen too
	g_cv_unstick = register_cvar("smak_npc_unstick", "6");  // seconds with no headway before an NPC is moved on (0: off)
	guard_register();
	drone_register();
	g_maxpl = get_maxplayers();

	register_concmd("smak_npc_status", "cmd_status", ADMIN_RCON, "- lists the NPCs: role, state, slot, place");
	register_concmd("smak_npc_hour", "cmd_hour", ADMIN_RCON, "<hour 0-24> - sets the game clock");
	register_concmd("smak_npc_scare", "cmd_scare", ADMIN_RCON, "- NPCs near you flee, as if shot at");
	register_concmd("smak_guards", "cmd_guards", ADMIN_RCON, "- lists the guards: mode, target, place");
	register_clcmd("say /guardias", "cmd_guards_say");
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
	g_has_law = bool:LibraryExists("smak_law", LibType_Library);
	g_has_doors = bool:LibraryExists("smak_doors", LibType_Library);
	g_has_arena = bool:LibraryExists("smak_rp", LibType_Library);
	assign_npcs();
	if (g_count == 0)
	{
		return;
	}
	log_amx("[smak_npc] clearance: smak_npc_clear %d, smak_npc_narrow %.0f, smak_npc_yield %d, smak_npc_unstick %.0f s; %d door leaves, %d ways-down spots kept clear", get_pcvar_num(g_cv_clear), get_pcvar_float(g_cv_narrow), get_pcvar_num(g_cv_yield), get_pcvar_float(g_cv_unstick), g_lf_n, g_way_n);
	register_forward(FM_PlayerPreThink, "fw_prethink");
	register_forward(FM_PlaybackEvent, "fw_playback");
	RegisterHamPlayer(Ham_TakeDamage, "fw_hurt", 1);
	set_task(TICK, "task_tick", TASK_TICK, _, _, "b");
	drone_start();
	log_amx("[smak_npc] %s: %d NPC(s) (clock: a day is %d min, it is %.1f h)", g_map, g_count, get_pcvar_num(g_cv_day), clock_hour());
	if (g_gcount > 0)
	{
		log_amx("[smak_guard] %d guard(s), %d waypoint(s) (%d posts, source %d); smak_law %d, smak_doors %d (0: every door counts as unlocked)%s", g_gcount, g_wp_count, g_wp_posts, g_wp_src, g_has_law ? 1 : 0, g_has_doors ? 1 : 0, g_has_law ? "" : ": the guards only patrol");
	}
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
	read_ways(root);
	find_waypoints();
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
		g_pl_post[p] = bool:(containi(kind, "police") >= 0 || containi(kind, "guard") >= 0 || equal(kind, "post") || equal(kind, "booking"));
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

/// The ways down: the ends of each (paths.ways top and foot), and every hatch or ladder node.
read_ways(JSON:root)
{
	g_way_n = 0;
	for (new n = 0; n < g_node_count; n++)
	{
		if (g_n_kind[n] == NK_HATCH || g_n_kind[n] == NK_LADDER) add_way_at(g_n_at[n]);
	}
	new JSON:paths = json_object_get_value(root, "paths");
	if (paths == Invalid_JSON) return;
	new JSON:list = json_object_get_value(paths, "ways");
	json_free(paths);
	if (list == Invalid_JSON) return;
	new count = json_array_get_count(list);
	new id[32];
	for (new i = 0; i < count; i++)
	{
		new JSON:one = json_array_get_value(list, i);
		for (new e = 0; e < 2; e++)
		{
			json_object_get_string(one, e ? "foot" : "top", id, charsmax(id));
			new nd = -1;
			if (id[0] && TrieGetCell(g_t_node, id, nd)) add_way_at(g_n_at[nd]);
		}
		json_free(one);
	}
	json_free(list);
}

add_way_at(const Float:at[3])
{
	for (new w = 0; w < g_way_n; w++)
	{
		if (vector_distance(g_way_at[w], at) < 1.0) return;
	}
	if (g_way_n < MAX_WAYS) copy_vec(g_way_at[g_way_n++], at);
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
		else if (equal(kind, "police")) g_p_kind[p] = PK_POLICE;
		else if (equal(kind, "jail")) g_p_kind[p] = PK_JAIL;
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

		if (g_p_kind[p] == PK_HOME || g_p_kind[p] == PK_POLICE)
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
			if (g_p_node[p] < 0 && g_p_kind[p] == PK_HOME)
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
		if (kind == 2 && door >= 0) g_door_isgate[door] = true;
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
	// the guards come out of the 40: they are made last, so the others keep their ids and their places
	new nguards = (gci(GC_ENABLE) && g_wp_count > 0) ? clamp(gci(GC_COUNT), 0, MAX_GUARDS) : 0;
	cap = min(cap, MAX_NPC - nguards);
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
	new civilians = g_count;
	for (new k = 0; k < nguards; k++)
	{
		new i = new_npc(ROLE_GUARD);
		g_gwp[i] = k % g_wp_count;
		g_home[i] = g_wp[g_gwp[i]];
		g_home_prop[i] = OWN_PATROL;
		g_work[i] = -1;
		g_eve[i] = -1;
		g_lt[i] = LT_GUARD;
		formatex(g_id[i], charsmax(g_id[]), "guard_%02d", k + 1);
		formatex(g_name[i], charsmax(g_name[]), "Guardia%d", k + 1);
		g_mdl[i] = g_guard_mdl;
		if (g_mdl[i] < 0)
		{
			// none of the regime's models is there: the first the game has
			for (new m = 0; m < 6; m++)
			{
				if (g_model_ok[m]) g_mdl[i] = m;
			}
		}
	}
	new bool:any_made = false;
	for (new i = 0; i < g_count; i++)
	{
		if (g_role[i] != ROLE_GUARD) npc_reach(i);
		if (make_ent(i)) any_made = true;
	}
	if (!any_made)
	{
		g_count = 0;
	}
	g_gcount = g_count_role(ROLE_GUARD);
	if (nguards > 0 && civilians + nguards != g_count) log_amx("[smak_guard] %d guard(s) asked for, %d made", nguards, g_gcount);
	// the ids depend on the JSON and the cvars only: places and homes are taken in file order, no random call decides them
	new ids[1024];
	new len = 0;
	for (new i = 0; i < g_count; i++)
	{
		len += formatex(ids[len], charsmax(ids) - len, "%s%s", i ? ", " : "", g_id[i]);
	}
	log_amx("[smak_npc] ids: %s", ids);
	log_amx("[smak_npc] roles: %d keepers, %d workers, %d citizens, %d guards", keepers, g_count_role(ROLE_WORKER), g_count_role(ROLE_CITIZEN), g_count_role(ROLE_GUARD));
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
	g_gm[i] = GM_PATROL;
	g_gtgt[i] = 0;
	g_gseen[i] = 0.0;
	g_gdw[i] = false;
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
	// the door entities are found by name when one is used (a door of two leaves moves both); here only the pose each leaf
	// has now, before anything has moved it
	g_lf_n = 0;
	for (new d = 0; d < g_door_count; d++)
	{
		new ent = -1;
		while ((ent = find_ent_by_tname(ent, g_door_name[d])) > 0 && g_lf_n < MAX_LEAVES)
		{
			new k = g_lf_n++;
			g_lf_ent[k] = ent;
			pev(ent, pev_origin, g_lf_org[k]);
			pev(ent, pev_angles, g_lf_ang[k]);
			pev(ent, pev_absmin, g_lf_min[k]);
			pev(ent, pev_absmax, g_lf_max[k]);
		}
	}
}

/// Is this door leaf where it stood at map start (shut, not opening, not closing)? A leaf not recorded counts as shut.
bool:leaf_shut(ent)
{
	for (new k = 0; k < g_lf_n; k++)
	{
		if (g_lf_ent[k] != ent) continue;
		new Float:o[3], Float:a[3];
		pev(ent, pev_origin, o);
		pev(ent, pev_angles, a);
		if (vector_distance(o, g_lf_org[k]) > 1.5) return false;
		for (new c = 0; c < 3; c++)
		{
			new Float:d = floatabs(a[c] - g_lf_ang[k][c]);
			if (d > 180.0) d = 360.0 - d;
			if (d > 1.5) return false;
		}
		return true;
	}
	return true;
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
	if (own <= OWN_PATROL) return guard_edge_ok(e, own);
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
			if (own == OWN_BREACH && g_e_gate[e] == 1 && door_locked(g_e_door[e])) ng += 500.0;   // a breach takes its time: go round if it is not much longer
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
	new own = g_home_prop[i];
	if (g_role[i] == ROLE_GUARD) own = guard_own(i);
	new n = astar(from, to, own);
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
	return node_near_point(o);
}

node_near_point(const Float:o[3])
{
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
			g_pid[g_pn] = id;
			wish_of(id, g_pwish[g_pn], g_pwish_on[g_pn]);
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
	if ((g_gcount > 0 || g_dr_on) && g_tick % 5 == 0) guards_poll(now);
	if (g_dr_on) drone_tick(now);

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
		if (g_role[i] == ROLE_GUARD && g_gm[i] != GM_PATROL) near = true;   // a hunt is walked for real: it meets doors and walls
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
		if (near) push_check(i, now, dt, o);
		npc_think(i, now, dt, near, hour, o);
	}
	if (get_pcvar_num(g_cv_debug) && g_tick % 100 == 0)
	{
		new real = 0;
		for (new i = 0; i < g_count; i++)
		{
			if (!g_far[i]) real++;
		}
		log_amx("[smak_npc] %d NPC(s): %d walk for real, %d far; in the last 10 s: %d far steps, %d door retries, %d jumps unseen, %d detours/waits, %d steps aside, %d unstuck", g_count, real, g_count - real, g_dbg_far, g_dbg_retry, g_dbg_jump, g_dbg_giveway, g_dbg_aside, g_dbg_unstick);
		g_dbg_far = g_dbg_retry = g_dbg_jump = g_dbg_giveway = g_dbg_aside = g_dbg_unstick = 0;
	}
}

npc_think(i, Float:now, Float:dt, bool:near, Float:hour, Float:o[3])
{
	if (g_hidden[i] && g_state[i] != ST_IDLE) set_hidden(i, false);
	if (g_role[i] == ROLE_GUARD)
	{
		guard_think(i, now, dt, near, o);
		return;
	}
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
	if (get_pcvar_num(g_cv_clear) && now >= g_clr_t[i])
	{
		g_clr_t[i] = now + 1.5;
		if (clear_stop(i, now, o)) return;
	}
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

open_door(i, slot, Float:now, bool:here = true)
{
	if (now - g_door_t[i] < 1.5) return;
	// a guard obeys the locks (non-player use passes in smak_doors): it breaches, or goes round
	if (g_role[i] == ROLE_GUARD && !guard_door_ok(i, slot, here, now)) return;
	g_door_t[i] = now;
	new ent = -1;
	new found = 0;
	// DoorUse acts on a door that is shut; on an open one with an auto-return it does nothing, but on a toggle door (wait -1)
	// it closes it again: so a leaf that is open or moving is left alone
	while ((ent = find_ent_by_tname(ent, g_door_name[slot])) > 0)
	{
		found++;
		if (!leaf_shut(ent)) continue;
		dllfunc(DLLFunc_Use, ent, g_ent[i]);
	}
	g_dbg_retry++;
	if (get_pcvar_num(g_cv_debug) > 1 || (found == 0 && get_pcvar_num(g_cv_debug)))
	{
		log_amx("[smak_npc] npc %d (%s) uses door '%s': %d entit%s", i, g_name[i], g_door_name[slot], found, found == 1 ? "y" : "ies");
	}
}

/// How fast NPC i walks now: a civilian walks or, fleeing, runs; a guard by its mode.
Float:npc_speed(i, bool:flee)
{
	if (g_role[i] == ROLE_GUARD) return guard_speed(i);
	return get_pcvar_float(flee ? g_cv_run : g_cv_walk);
}

/// Near a player: real steps, with the world's collision, ten times a second.
walk_near(i, Float:now, Float:dt, Float:o[3])
{
	new ent = g_ent[i];
	new bool:flee = (g_state[i] == ST_FLEE);
	new Float:speed = npc_speed(i, flee);
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
			g_blocked[i] = 0.0;
			g_clr_t[i] = now + 0.6;
			// a step aside taken on the way: the route goes on; a settle at its end: it is there
			if (g_rpos[i] >= g_rlen[i]) npc_arrived(i, now);
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
	else if (flee || speed > 130.0) npc_anim(i, g_sq_run[i], speed / g_gs_run[i]);
	else npc_anim(i, g_sq_walk[i], speed / g_gs_walk[i]);

	// the door after the node ahead: open it in good time, a leaf takes about a second to swing
	if (!g_use_goal[i] && g_rpos[i] + 1 < g_rlen[i] && dh < 110.0)
	{
		new e2 = edge_between(g_route[i][g_rpos[i]], g_route[i][g_rpos[i] + 1]);
		if (e2 >= 0 && g_e_door[e2] >= 0) open_door(i, g_e_door[e2], now, false);
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
	check_progress(i, now, o2);
}

/// No headway for smak_npc_unstick seconds (a stuck that blocked-time does not catch: a corner it slides along, a prop
/// that pushes it back): out of sight it is moved on along its path; in sight it plans another way.
check_progress(i, Float:now, const Float:o[3])
{
	new Float:sec = get_pcvar_float(g_cv_unstick);
	if (sec <= 0.0) return;
	if (now > g_stk_t[i] + sec * 2.0)
	{
		copy_vec(g_stk_o[i], o);
		g_stk_t[i] = now + sec;
		return;
	}
	if (now < g_stk_t[i]) return;
	new Float:dx = o[0] - g_stk_o[i][0];
	new Float:dy = o[1] - g_stk_o[i][1];
	copy_vec(g_stk_o[i], o);
	g_stk_t[i] = now + sec;
	if (dx * dx + dy * dy > 24.0 * 24.0) return;
	g_dbg_unstick++;
	new Float:t[3];
	if (!walk_target(i, t)) return;
	if (get_pcvar_num(g_cv_debug)) log_amx("[smak_npc] npc %d (%s) made no headway for %.0f s at %.0f %.0f %.0f", i, g_name[i], sec, o[0], o[1], o[2]);
	g_blocked[i] = 0.0;
	if (!npc_seen(i))
	{
		// a short way along its path (to the next node when it is near, else 120 units toward it)
		new Float:d = vector_distance(o, t);
		nudge(i, o, t, d < 150.0 ? d : 120.0);
		g_dbg_jump++;
	}
	else
	{
		give_way(i, now);
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
	new Float:speed = npc_speed(i, flee);
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
	g_clr_t[i] = now + 0.6;
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
			if (near_hazard(c)) continue;
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
// clearance: nobody stands in a doorway, on a way down or in a passage that is one body wide
// =======================================================================================================

/// Where a player's keys send him on the floor: a unit vector, `on` false when no move key is held.
wish_of(id, Float:w[2], &bool:on)
{
	new btn = pev(id, pev_button);
	new Float:va[3], Float:fw[3], Float:rt[3];
	pev(id, pev_v_angle, va);
	va[0] = 0.0;
	angle_vector(va, ANGLEVECTOR_FORWARD, fw);
	angle_vector(va, ANGLEVECTOR_RIGHT, rt);
	new Float:f = 0.0, Float:s = 0.0;
	if (btn & IN_FORWARD) f += 1.0;
	if (btn & IN_BACK) f -= 1.0;
	if (btn & IN_MOVERIGHT) s += 1.0;
	if (btn & IN_MOVELEFT) s -= 1.0;
	w[0] = fw[0] * f + rt[0] * s;
	w[1] = fw[1] * f + rt[1] * s;
	new Float:l = floatsqroot(w[0] * w[0] + w[1] * w[1]);
	on = (l > 0.5);
	if (on)
	{
		w[0] /= l;
		w[1] /= l;
	}
}

/// Within 52 units (on the floor plan) of a door leaf's box, or 64 of a way down.
bool:near_hazard(const Float:p[3])
{
	for (new k = 0; k < g_lf_n; k++)
	{
		if (p[2] < g_lf_min[k][2] - 48.0 || p[2] > g_lf_max[k][2] + 48.0) continue;
		new Float:dx = 0.0, Float:dy = 0.0;
		if (p[0] < g_lf_min[k][0]) dx = g_lf_min[k][0] - p[0];
		else if (p[0] > g_lf_max[k][0]) dx = p[0] - g_lf_max[k][0];
		if (p[1] < g_lf_min[k][1]) dy = g_lf_min[k][1] - p[1];
		else if (p[1] > g_lf_max[k][1]) dy = p[1] - g_lf_max[k][1];
		if (dx * dx + dy * dy < 52.0 * 52.0) return true;
	}
	for (new w = 0; w < g_way_n; w++)
	{
		new Float:dx = p[0] - g_way_at[w][0];
		new Float:dy = p[1] - g_way_at[w][1];
		if (dx * dx + dy * dy < 64.0 * 64.0 && floatabs(p[2] - g_way_at[w][2]) < 80.0) return true;
	}
	return false;
}

/// How far the walls are apart where p is: the least of four lines through it (a wall each side, 96 units at most each way).
Float:passage_width(const Float:p[3], ent)
{
	new Float:least = 1000.0;
	new tr = create_tr2();
	for (new a = 0; a < 4; a++)
	{
		new Float:sum = 0.0;
		for (new sgn = 0; sgn < 2; sgn++)
		{
			new Float:ang = float(a) * 45.0 + (sgn ? 180.0 : 0.0);
			new Float:e[3];
			e[0] = p[0] + 96.0 * floatcos(ang, degrees);
			e[1] = p[1] + 96.0 * floatsin(ang, degrees);
			e[2] = p[2];
			engfunc(EngFunc_TraceLine, p, e, IGNORE_MONSTERS, ent, tr);
			new Float:fr;
			get_tr2(tr, TR_flFraction, fr);
			sum += 96.0 * fr;
		}
		if (sum < least) least = sum;
	}
	free_tr2(tr);
	return least;
}

/// mask 1: doors and ways down, 2: narrow passages.
bool:stop_bad(const Float:p[3], mask, ent)
{
	if ((mask & 1) && near_hazard(p)) return true;
	if ((mask & 2) && passage_width(p, ent) < get_pcvar_float(g_cv_narrow)) return true;
	return false;
}

/// Floor under c (within a step of where a body stands), the way from o clear for the hull, nobody there.
bool:spot_ok(i, const Float:o[3], const Float:c[3], mask)
{
	if (stop_bad(c, mask, g_ent[i])) return false;
	if (!hull_clear(g_ent[i], o, c)) return false;
	new Float:e[3];
	copy_vec(e, c);
	e[2] -= 60.0;
	new tr = create_tr2();
	engfunc(EngFunc_TraceLine, c, e, IGNORE_MONSTERS, g_ent[i], tr);
	new Float:fr;
	get_tr2(tr, TR_flFraction, fr);
	free_tr2(tr);
	if (fr >= 1.0 || floatabs(60.0 * fr - 36.0) > 16.0) return false;
	if (crowded(i, c)) return false;
	if (player_near_point(c, 48.0)) return false;
	return true;
}

/// The nearest clear spot to o. With `from` (a player's place) it keeps out of his way: to the side, a little away, then straight back.
bool:find_spot(i, const Float:o[3], const Float:from[3], bool:has_from, Float:out[3], mask)
{
	if (has_from)
	{
		new Float:dx = o[0] - from[0];
		new Float:dy = o[1] - from[1];
		new Float:h = floatsqroot(dx * dx + dy * dy);
		if (h < 1.0)
		{
			dx = 1.0;
			dy = 0.0;
			h = 1.0;
		}
		dx /= h;
		dy /= h;
		new Float:first = (random_num(0, 1) == 0) ? 1.0 : -1.0;
		new const Float:rad[4] = { 56.0, 80.0, 110.0, 150.0 };
		for (new r = 0; r < 4; r++)
		{
			for (new sgn = 0; sgn < 2; sgn++)
			{
				new Float:side = (sgn == 0) ? first : -first;
				out[0] = o[0] + (-dy * side) * rad[r] + dx * rad[r] * 0.3;
				out[1] = o[1] + (dx * side) * rad[r] + dy * rad[r] * 0.3;
				out[2] = o[2];
				if (spot_ok(i, o, out, mask)) return true;
			}
		}
		for (new r = 0; r < 2; r++)
		{
			new Float:back = (r == 0) ? 64.0 : 100.0;
			out[0] = o[0] + dx * back;
			out[1] = o[1] + dy * back;
			out[2] = o[2];
			if (spot_ok(i, o, out, mask)) return true;
		}
		return false;
	}
	new const Float:ring[6] = { 56.0, 80.0, 110.0, 150.0, 200.0, 260.0 };
	new Float:a0 = random_float(0.0, 360.0);
	for (new r = 0; r < 6; r++)
	{
		for (new k = 0; k < 16; k++)
		{
			new Float:a = a0 + float(k) * 22.5;
			out[0] = o[0] + ring[r] * floatcos(a, degrees);
			out[1] = o[1] + ring[r] * floatsin(a, degrees);
			out[2] = o[2];
			if (spot_ok(i, o, out, mask)) return true;
		}
	}
	return false;
}

/// Sends NPC i to the spot c on foot (a route it had goes on from there).
send_aside(i, Float:now, const Float:c[3])
{
	copy_vec(g_goal[i], c);
	g_use_goal[i] = true;
	g_state[i] = ST_WALK;
	g_blocked[i] = 0.0;
	g_clr_t[i] = now + 1.0;
	g_dbg_aside++;
}

/// NPC i stands somewhere it blocks (a doorway, a way down, a narrow passage): to the nearest clear spot. Then true.
bool:clear_stop(i, Float:now, const Float:o[3])
{
	if (!stop_bad(o, 3, g_ent[i])) return false;
	new bool:hz = near_hazard(o);
	new Float:c[3], Float:none[3];
	if (find_spot(i, o, none, false, c, 3) || (hz && find_spot(i, o, none, false, c, 1)))
	{
		if (get_pcvar_num(g_cv_debug)) log_amx("[smak_npc] npc %d (%s) stands in the way at %.0f %.0f %.0f: moves to %.0f %.0f", i, g_name[i], o[0], o[1], o[2], c[0], c[1]);
		send_aside(i, now, c);
		return true;
	}
	g_clr_t[i] = now + 8.0;     // no clear spot near: try again later, not every step
	return false;
}

/// NPC i steps out of the way of a player at `from`, saying a word to player `pid` sometimes (0: said already). False when no spot.
bool:yield_to(i, Float:now, const Float:from[3], pid)
{
	new Float:o[3], Float:c[3];
	pev(g_ent[i], pev_origin, o);
	if (!find_spot(i, o, from, true, c, 3) && !find_spot(i, o, from, true, c, 1)) return false;
	send_aside(i, now, c);
	if (pid > 0 && now - g_say_t[i] > 8.0 && random_num(0, 99) < 45)
	{
		g_say_t[i] = now;
		new const es[][] = { "Perdon.", "Paso, paso.", "Disculpa.", "Con permiso." };
		new const en[][] = { "Excuse me.", "Coming through, sorry.", "Sorry, sorry.", "After you." };
		new k = random_num(0, 3);
		client_print(pid, print_chat, "[%s] %s", g_name[i], get_pcvar_num(g_cv_lang) ? es[k] : en[k]);
	}
	return true;
}

/// A player pushing into NPC i (his keys toward it, within 46 units) for 0.7 s: it gives way. Not a guard in a hunt, nor
/// one that is fleeing, cowering or stunting.
push_check(i, Float:now, Float:dt, const Float:o[3])
{
	if (!get_pcvar_num(g_cv_yield)) return;
	new st = g_state[i];
	if (st == ST_FLEE || st == ST_COWER || st == ST_STUNT || st == ST_WAIT || (g_role[i] == ROLE_GUARD && g_gm[i] != GM_PATROL))
	{
		g_push[i] = 0.0;
		return;
	}
	new bool:pushed = false;
	new Float:pp[3];
	new who = 0;
	for (new k = 0; k < g_pn && !pushed; k++)
	{
		new Float:dx = o[0] - g_pp[k][0];
		new Float:dy = o[1] - g_pp[k][1];
		new Float:h = floatsqroot(dx * dx + dy * dy);
		if (h > 46.0 || h < 1.0 || floatabs(o[2] - g_pp[k][2]) > 60.0 || !g_pwish_on[k]) continue;
		if ((g_pwish[k][0] * dx + g_pwish[k][1] * dy) / h > 0.5)
		{
			pushed = true;
			copy_vec(pp, g_pp[k]);
			who = g_pid[k];
		}
	}
	if (pushed) g_push[i] += dt;
	else if (g_push[i] > 0.0) g_push[i] = floatmax(0.0, g_push[i] - dt * 2.0);
	if (g_push[i] >= 0.7)
	{
		g_push[i] = 0.0;
		yield_to(i, now, pp, who);
	}
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
		if (g_role[i] == ROLE_GUARD) continue;     // a guard does not run: see guard_hear
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
// guards: the regime's patrol. They hunt wanted players (smak_law) by stars, GTA style.
//
//   PATROL  walk between the posts (police places) and the checkpoint gates, stand a while at each, look about.
//   WATCH   1 star, seen by this guard: follows at walk speed and tells the player to stop; if the player stands
//           still for smak_guard_stop_sec it walks up and arrests; sight lost for smak_guard_lose1 s ends it.
//   CHASE   2+ stars: runs at smak_npc_run to the player (straight at him in sight and close, otherwise by the graph,
//           planned again every smak_guard_replan s); the guard who sees calls the others within smak_guard_call
//           (at 3 stars, everybody, and the place where the level became 3 is known to all).
//   SEARCH  sight lost and the last known place reached: visits graph nodes within smak_guard_search_radius for
//           smak_guard_search_sec seconds (twice that at 3 stars), then goes back to patrol; if no guard is left
//           on the player he drops a level (smak_law_lower, never below 1 star).
//   BREACH  3 stars only: a locked door (smak_doors) on the way: it stands at the door smak_npc_breach_sec seconds,
//           the player is told, then smak_door_breach. Below 3 stars a locked door is not passed: the route is
//           planned to the nearest node it can reach and the guards search around there.
//   ARREST  within smak_guard_arrest_range of the target and not shot at: after smak_guard_arrest_sec s,
//           smak_law_arrest. From 2 stars the guard also holds him: his horizontal speed is cut while it is near.
//
// A guard never touches a player who is not wanted, and never acts on one inside a mission arena. No damage is
// dealt (see NPCS.md).
// =======================================================================================================


Float:gcf(k)
{
	return get_pcvar_float(g_gc[k]);
}

gci(k)
{
	return get_pcvar_num(g_gc[k]);
}

copy_vec(Float:dst[3], const Float:src[3])
{
	dst[0] = src[0];
	dst[1] = src[1];
	dst[2] = src[2];
}

guard_register()
{
	g_gc[GC_ENABLE] = register_cvar("smak_guard_enable", "1");
	g_gc[GC_COUNT] = register_cvar("smak_guard_count", "4");            // guards (ids guard_01..), 0 to 8
	g_gc[GC_RANGE] = register_cvar("smak_guard_range", "900");          // sight at 1 star; +25% for each star more
	g_gc[GC_FOV] = register_cvar("smak_guard_fov", "140");              // view cone, degrees
	g_gc[GC_CLOSE] = register_cvar("smak_guard_close", "150");          // inside this a guard needs no cone, only a clear line
	g_gc[GC_JOG] = register_cvar("smak_guard_jog", "150");              // speed while searching
	g_gc[GC_LOSE1] = register_cvar("smak_guard_lose1", "6");            // 1 star: seconds without sight that end the watch
	g_gc[GC_CALL] = register_cvar("smak_guard_call", "2000");           // 2 stars: radio call radius (3 stars: all)
	g_gc[GC_BREACH] = register_cvar("smak_guard_breach", "1");          // 3 stars: breach locked doors
	g_gc[GC_BREACH_SEC] = register_cvar("smak_npc_breach_sec", "5");
	g_gc[GC_ARR_RANGE] = register_cvar("smak_guard_arrest_range", "80");
	g_gc[GC_ARR_SEC] = register_cvar("smak_guard_arrest_sec", "3");
	g_gc[GC_STOP_SEC] = register_cvar("smak_guard_stop_sec", "2");      // 1 star: a player still this long is walked up to
	g_gc[GC_GRAB] = register_cvar("smak_guard_grab", "1");              // 2+ stars: slow the held player
	g_gc[GC_GRAB_SCALE] = register_cvar("smak_guard_grab_scale", "0.4");
	g_gc[GC_SEARCH_SEC] = register_cvar("smak_guard_search_sec", "25");
	g_gc[GC_SEARCH_RAD] = register_cvar("smak_guard_search_radius", "600");
	g_gc[GC_REPLAN] = register_cvar("smak_guard_replan", "0.7");
	g_gc[GC_ESCAPE] = register_cvar("smak_guard_escape", "1");          // a player who lost them drops a level
	g_gc[GC_ESCAPE_CD] = register_cvar("smak_guard_escape_cd", "60");
	g_gc[GC_DEBUG] = register_cvar("smak_guard_debug", "0");            // log every change of mode
	g_gc[GC_KNOCK] = register_cvar("smak_guard_knock", "");             // a sound path to play each second of a breach
	g_hud = CreateHudSyncObj();
}

// ---- the places a guard stands at ----------------------------------------------------------------------

bool:wp_add(node)
{
	if (node < 0 || g_wp_count >= MAX_WP) return false;
	for (new k = 0; k < g_wp_count; k++)
	{
		if (g_wp[k] == node) return false;
	}
	g_wp[g_wp_count++] = node;
	return true;
}

/// The posts: the nodes of places of a police kind; failing those, of police properties; then the checkpoint
/// gates' two sides. g_wp_posts is how many of the list are posts (the rest are gates).
find_waypoints()
{
	g_wp_count = 0;
	g_wp_src = 0;
	for (new p = 0; p < g_place_count; p++)
	{
		if (g_pl_post[p] && g_pl_node[p] >= 0 && wp_add(g_pl_node[p])) g_wp_src = 1;
	}
	if (g_wp_count == 0)
	{
		for (new p = 0; p < g_prop_count; p++)
		{
			if (g_p_kind[p] == PK_POLICE && g_p_node[p] >= 0 && wp_add(g_p_node[p])) g_wp_src = 2;
		}
	}
	g_wp_posts = g_wp_count;
	for (new n = 0; n < g_node_count; n++)
	{
		for (new e = g_head[n]; e >= 0; e = g_e_next[e])
		{
			if (g_e_gate[e] != 2) continue;
			new v = g_e_to[e];
			if (g_n_kind[v] != NK_DOOR && wp_add(v) && g_wp_src == 0) g_wp_src = 3;
		}
	}
}

// ---- doors: the lock cache -----------------------------------------------------------------------------

bool:door_read(slot)
{
	new bool:locked = false;
	new ent = -1;
	while ((ent = find_ent_by_tname(ent, g_door_name[slot])) > 0)
	{
		if (!smak_door_locked(ent)) continue;
		// smak_doors keeps police and jail rooms from players: a guard of the regime has the keys
		new kind[16];
		smak_door_kind(ent, kind, charsmax(kind));
		if (!equal(kind, "police") && !equal(kind, "jail")) locked = true;
	}
	g_dl[slot] = locked;
	g_dl_t[slot] = get_gametime();
	return locked;
}

/// What the cache says (A* asks it for every door it meets): a checkpoint gate is never locked for a guard.
bool:door_locked(slot)
{
	if (!g_has_doors || slot < 0 || g_door_isgate[slot]) return false;
	return g_dl[slot];
}

/// A fresh answer (at most half a second old), for the door a guard is at or about to use: a locked door must never be
/// opened by a guard's own use, which smak_doors lets through.
bool:door_locked_now(slot)
{
	if (!g_has_doors || slot < 0 || g_door_isgate[slot]) return false;
	if (get_gametime() - g_dl_t[slot] < 0.5) return g_dl[slot];
	return door_read(slot);
}

/// Sixteen doors each poll: the cache is never older than a few seconds and costs next to nothing.
locks_refresh()
{
	if (!g_has_doors || g_door_count == 0) return;
	for (new k = 0; k < 16; k++)
	{
		g_dl_at = (g_dl_at + 1) % g_door_count;
		if (!g_door_isgate[g_dl_at]) door_read(g_dl_at);
	}
}

// ---- what a guard may walk through ---------------------------------------------------------------------

/// Patrol: the streets, shops, public halls and the police rooms. A hunt (own OWN_HUNT) goes into homes and the
/// rest too, through the doors that are not locked; OWN_BREACH also through locked ones (they are breached).
bool:guard_edge_ok(e, own)
{
	if (g_e_gate[e] == 2) return true;
	new p = g_e_prop[e];
	if (p < 0) return true;
	new kind = g_p_kind[p];
	if (kind != PK_SHOP && kind != PK_PUBLIC && kind != PK_POLICE && own == OWN_PATROL) return false;
	if (own != OWN_BREACH && door_locked(g_e_door[e])) return false;
	return true;
}

guard_own(i)
{
	if (g_gm[i] == GM_PATROL || g_gm[i] == GM_WATCH) return OWN_PATROL;
	new t = g_gtgt[i];
	if (t > 0 && g_wl[t] >= 3 && gci(GC_BREACH) && g_has_doors) return OWN_BREACH;
	return OWN_HUNT;
}

Float:guard_speed(i)
{
	if (g_gm[i] == GM_CHASE) return get_pcvar_float(g_cv_run);
	if (g_gm[i] == GM_SEARCH) return gcf(GC_JOG);
	return get_pcvar_float(g_cv_walk);
}

/// Of the nodes a guard can reach (by its own rules), the one nearest to the point p: where it waits when the
/// node it wants is behind a door it may not pass.
reach_nearest(from, own, const Float:p[3])
{
	for (new n = 0; n < g_node_count; n++) g_a_state[n] = 0;
	new qh = 0, qt = 0;
	g_q[qt++] = from;
	g_a_state[from] = 2;
	new best = from;
	new Float:bd = 100000000.0;
	while (qh < qt)
	{
		new u = g_q[qh++];
		new Float:dx = g_n_at[u][0] - p[0];
		new Float:dy = g_n_at[u][1] - p[1];
		new Float:dz = g_n_at[u][2] - p[2];
		new Float:d = dx * dx + dy * dy + dz * dz * 4.0;
		if (d < bd)
		{
			bd = d;
			best = u;
		}
		for (new e = g_head[u]; e >= 0; e = g_e_next[e])
		{
			if (!edge_ok(e, own)) continue;
			new v = g_e_to[e];
			if (g_a_state[v] == 2) continue;
			g_a_state[v] = 2;
			g_q[qt++] = v;
		}
	}
	return best;
}

/// One path planned a tick among the guards: A* clears and fills the whole graph.
bool:guard_may_plan()
{
	if (g_plan_tick == g_tick) return false;
	g_plan_tick = g_tick;
	return true;
}

/// A route to node `to` by the guard's rules. A guard already walking keeps going to the node ahead and is planned from it
/// (it does not turn back to the node behind).
bool:guard_route(i, to)
{
	new own = guard_own(i);
	new from = -1;
	new bool:cont = false;
	if (!g_use_goal[i] && g_state[i] == ST_WALK && g_rpos[i] < g_rlen[i])
	{
		from = g_route[i][g_rpos[i]];
		cont = true;
	}
	else
	{
		from = nearest_node(g_ent[i]);
	}
	if (from < 0) return false;
	if (get_gametime() < g_ban_t[i])
	{
		g_av_a = g_ban_a[i];
		g_av_b = g_ban_b[i];
	}
	new n = astar(from, to, own);
	g_av_a = g_av_b = -1;
	if (n < 0) return false;
	new k0 = cont ? 1 : 0;
	if (cont) g_route[i][0] = from;
	g_rlen[i] = min(n + k0, ROUTE_LEN);
	for (new k = 0; k + k0 < g_rlen[i]; k++) g_route[i][k + k0] = g_tmp[k];
	g_rpos[i] = 0;
	if (!cont) g_cur[i] = from;
	g_dest[i] = to;
	g_use_goal[i] = false;
	g_blocked[i] = 0.0;
	g_settle[i] = 0;
	g_state[i] = ST_WALK;
	return true;
}

/// To the place p: the node nearest to it, or when that one cannot be reached, the nearest the guard can reach.
bool:guard_go(i, const Float:p[3])
{
	new to = node_near_point(p);
	if (to < 0) return false;
	if (guard_route(i, to)) return true;
	new from = nearest_node(g_ent[i]);
	if (from < 0) return false;
	new near_to = reach_nearest(from, guard_own(i), p);
	if (near_to == from || near_to == to) return false;
	return guard_route(i, near_to);
}

// ---- modes ---------------------------------------------------------------------------------------------

guard_mode(i, mode, const why[])
{
	if (g_gm[i] == mode) return;
	if (gci(GC_DEBUG))
	{
		new t = g_gtgt[i];
		new name[32];
		name[0] = 0;
		if (t > 0 && is_user_connected(t)) get_user_name(t, name, charsmax(name));
		log_amx("[smak_guard] %s: %s -> %s (%s) target %d '%s' level %d", g_id[i], g_gm_name[g_gm[i]], g_gm_name[mode], why, t, name, (t > 0) ? g_wl[t] : 0);
	}
	g_gm[i] = mode;
	g_gt_enter[i] = get_gametime();
	g_garr[i] = 0.0;
	g_gstill[i] = 0.0;
	g_gplan[i] = 0.0;
	g_gsearch_end[i] = 0.0;
	g_gdw[i] = false;
	if (g_state[i] == ST_WAIT) g_state[i] = ST_IDLE;
}

bool:any_hunter(t)
{
	for (new j = 0; j < g_count; j++)
	{
		if (g_role[j] == ROLE_GUARD && g_gtgt[j] == t && g_gm[j] != GM_PATROL) return true;
	}
	return false;
}

guard_to_patrol(i, const why[])
{
	new t = g_gtgt[i];
	guard_mode(i, GM_PATROL, why);
	g_gtgt[i] = 0;
	g_state[i] = ST_IDLE;
	g_rlen[i] = 0;
	g_rpos[i] = 0;
	g_use_goal[i] = false;
	// the nearest waypoint is where the round resumes
	new Float:o[3];
	pev(g_ent[i], pev_origin, o);
	new best = 0;
	new Float:bd = 100000000.0;
	for (new k = 0; k < g_wp_count; k++)
	{
		new Float:d = vector_distance(o, g_n_at[g_wp[k]]);
		if (d < bd)
		{
			bd = d;
			best = k;
		}
	}
	g_gwp[i] = (best + g_wp_count - 1) % g_wp_count;
	g_gdw[i] = true;
	g_gdw_until[i] = get_gametime();
	g_gturn[i] = get_gametime() + 3.0;
	if (t > 0 && !any_hunter(t)) g_phunt[t] = false;
}

/// Nobody hunts him any more because they searched and found nothing: he drops a level (never to 0).
guard_giveup(i)
{
	new t = g_gtgt[i];
	new bool:last = (t > 0 && g_phunt[t]);
	guard_to_patrol(i, "gave up");
	if (!last || t < 1 || any_hunter(t)) return;
	new Float:now = get_gametime();
	if (!gci(GC_ESCAPE) || !g_has_law || g_wl[t] < 2 || now - g_pescape[t] < gcf(GC_ESCAPE_CD)) return;
	g_pescape[t] = now;
	new res = smak_law_lower(t, 1, 1, "despistaste a los guardias");
	if (res >= 0) g_wl[t] = res;
	if (gci(GC_DEBUG)) log_amx("[smak_guard] slot %d lost the guards: level now %d", t, res);
}

bool:guard_target_ok(t)
{
	return (t >= 1 && t <= g_maxpl && is_user_connected(t) && is_user_alive(t) && g_wl[t] >= 1);
}

guard_face(i, const Float:tp[3])
{
	new Float:o[3], Float:dir[3], Float:ang[3];
	pev(g_ent[i], pev_origin, o);
	dir[0] = tp[0] - o[0];
	dir[1] = tp[1] - o[1];
	dir[2] = 0.0;
	vector_to_angle(dir, ang);
	ang[0] = 0.0;
	ang[2] = 0.0;
	set_pev(g_ent[i], pev_angles, ang);
}

/// Stand still, looking at p.
guard_stand(i, const Float:p[3])
{
	g_state[i] = ST_IDLE;
	g_rlen[i] = 0;
	g_rpos[i] = 0;
	g_use_goal[i] = false;
	guard_face(i, p);
	npc_anim(i, g_sq_idle[i], 1.0);
}

/// Straight at the target: in the same floor's reach, a clear hull to a point just short of him.
bool:can_direct(i, const Float:o[3], const Float:p[3], Float:hdist)
{
	if (hdist > 450.0 || floatabs(p[2] - o[2]) > 40.0) return false;
	new Float:q[3];
	new Float:back = (hdist > 40.0) ? (hdist - 40.0) / hdist : 0.0;
	q[0] = o[0] + (p[0] - o[0]) * back;
	q[1] = o[1] + (p[1] - o[1]) * back;
	q[2] = o[2];
	return hull_clear(g_ent[i], o, q);
}

/// Move toward tp, stopping `stop` units short: straight when it is in sight, else by the graph (planned again every
/// smak_guard_replan seconds).
guard_approach(i, Float:now, const Float:o[3], const Float:tp[3], bool:direct_ok, Float:stop)
{
	new Float:dx = tp[0] - o[0];
	new Float:dy = tp[1] - o[1];
	new Float:h = floatsqroot(dx * dx + dy * dy);
	if (h <= stop)
	{
		guard_stand(i, tp);
		return;
	}
	if (direct_ok && can_direct(i, o, tp, h))
	{
		g_goal[i][0] = tp[0];
		g_goal[i][1] = tp[1];
		g_goal[i][2] = o[2];
		g_use_goal[i] = true;
		g_rlen[i] = 0;
		g_rpos[i] = 0;
		g_state[i] = ST_WALK;
		return;
	}
	if (now >= g_gplan[i] && guard_may_plan())
	{
		g_gplan[i] = now + gcf(GC_REPLAN);
		if (!guard_go(i, tp) && g_state[i] != ST_WALK) guard_stand(i, tp);
	}
}

// ---- seeing and hearing --------------------------------------------------------------------------------

/// A guard looks for wanted players: within range (more stars, farther), inside its view cone (or very close) and a
/// clear line from its eye to the player's eye.
guard_look(i, Float:now, const Float:o[3])
{
	new ent = g_ent[i];
	new Float:eye[3], Float:ang[3], Float:fwd[3];
	copy_vec(eye, o);
	eye[2] += 28.0;
	pev(ent, pev_angles, ang);
	angle_vector(ang, ANGLEVECTOR_FORWARD, fwd);
	new Float:half = floatcos(gcf(GC_FOV) * 0.5, degrees);
	new Float:range0 = gcf(GC_RANGE);
	new Float:close = gcf(GC_CLOSE);
	new best = 0;
	new Float:bd = 100000000.0;
	new tr = create_tr2();
	for (new id = 1; id <= g_maxpl; id++)
	{
		if (g_wl[id] < 1 || !is_user_alive(id)) continue;
		new Float:p[3], Float:ofs[3], Float:pe[3];
		pev(id, pev_origin, p);
		new Float:d = vector_distance(o, p);
		if (d > range0 * (1.0 + 0.25 * float(g_wl[id] - 1))) continue;
		if (d > close)
		{
			new Float:dx = p[0] - o[0];
			new Float:dy = p[1] - o[1];
			new Float:h = floatsqroot(dx * dx + dy * dy);
			if (h > 1.0 && (dx * fwd[0] + dy * fwd[1]) / h < half) continue;
		}
		pev(id, pev_view_ofs, ofs);
		pe[0] = p[0] + ofs[0];
		pe[1] = p[1] + ofs[1];
		pe[2] = p[2] + ofs[2];
		engfunc(EngFunc_TraceLine, eye, pe, IGNORE_MONSTERS, ent, tr);
		new Float:frac;
		get_tr2(tr, TR_flFraction, frac);
		if (frac >= 1.0 && d < bd)
		{
			bd = d;
			best = id;
		}
	}
	free_tr2(tr);
	if (best > 0) guard_sighted(i, best, now);
}

guard_sighted(i, id, Float:now)
{
	new Float:p[3];
	pev(id, pev_origin, p);
	new cur = g_gtgt[i];
	// already on another wanted player it saw lately: stays on him
	if (cur > 0 && cur != id && g_gm[i] != GM_PATROL && guard_target_ok(cur) && now - g_gseen[i] < 3.0) return;
	g_gtgt[i] = id;
	g_gseen[i] = now;
	copy_vec(g_glk[i], p);
	g_pseen[id] = now;
	g_phunt[id] = true;
	new lvl = g_wl[id];
	new want = (lvl >= 2) ? GM_CHASE : GM_WATCH;
	new mode = g_gm[i];
	if (mode == GM_PATROL || mode == GM_SEARCH || (mode == GM_WATCH && want == GM_CHASE) || (mode == GM_CHASE && want == GM_WATCH))
	{
		guard_mode(i, want, "sees him");
	}
	if (now >= g_gwarn[i] && (g_gm[i] == GM_WATCH || g_gm[i] == GM_CHASE))
	{
		g_gwarn[i] = now + ((lvl >= 2) ? 8.0 : 10.0);
		if (lvl >= 2) client_print(id, print_chat, "[%s] Alto! Policia! Al suelo!", g_name[i]);
		else client_print(id, print_chat, "[%s] Alto! Quedate donde estas, estas buscado.", g_name[i]);
	}
	if (lvl >= 2) guard_alert(i, id, p, lvl >= 3);
}

/// The radio: the guards within smak_guard_call of the one who saw him (all of them at 3 stars, or when i is -1) go to
/// where he is. At most one call every two seconds for a player.
guard_alert(from_i, id, const Float:pos[3], bool:everyone)
{
	new Float:now = get_gametime();
	if (now - g_pcall[id] < 2.0) return;
	g_pcall[id] = now;
	new Float:fo[3];
	if (from_i >= 0) pev(g_ent[from_i], pev_origin, fo);
	new Float:radius = gcf(GC_CALL);
	for (new j = 0; j < g_count; j++)
	{
		if (g_role[j] != ROLE_GUARD || j == from_i || g_ent[j] <= 0 || !pev_valid(g_ent[j])) continue;
		if (g_gm[j] == GM_BREACH || g_gm[j] == GM_ARREST) continue;
		if (g_gm[j] == GM_CHASE && g_gtgt[j] != id && guard_target_ok(g_gtgt[j]) && now - g_gseen[j] < 3.0) continue;
		if (!everyone && from_i >= 0)
		{
			new Float:q[3];
			pev(g_ent[j], pev_origin, q);
			if (vector_distance(q, fo) > radius) continue;
		}
		g_gtgt[j] = id;
		g_gseen[j] = now;
		copy_vec(g_glk[j], pos);
		guard_mode(j, GM_CHASE, "radio");
	}
}

/// A shot from a wanted player (2+ stars) within hearing: the guards near it go to the place.
guard_hear(shooter, const Float:p[3])
{
	if (!g_has_law || shooter < 1 || shooter > g_maxpl || g_wl[shooter] < 2) return;
	new Float:now = get_gametime();
	new Float:hear = get_pcvar_float(g_cv_hear);
	for (new j = 0; j < g_count; j++)
	{
		if (g_role[j] != ROLE_GUARD || g_ent[j] <= 0 || !pev_valid(g_ent[j])) continue;
		if (g_gm[j] != GM_PATROL && g_gm[j] != GM_SEARCH) continue;
		new Float:q[3];
		pev(g_ent[j], pev_origin, q);
		if (vector_distance(q, p) > hear) continue;
		g_gtgt[j] = shooter;
		g_gseen[j] = now;
		copy_vec(g_glk[j], p);
		g_phunt[shooter] = true;
		guard_mode(j, GM_CHASE, "heard a shot");
	}
}

// ---- the poll: who is wanted, the HUD, the locks (every half second) ----------------------------------------

guards_poll(Float:now)
{
	g_any_wanted = false;
	for (new id = 1; id <= g_maxpl; id++)
	{
		new lvl = 0;
		if (g_has_law && is_user_connected(id) && is_user_alive(id) && !is_user_hltv(id))
		{
			lvl = smak_law_level(id);
			if (lvl > 0 && g_has_arena && smak_rp_in_arena(id)) lvl = 0;
		}
		g_wlp[id] = g_wl[id];
		g_wl[id] = lvl;
		if (lvl <= 0)
		{
			g_phunt[id] = false;
			continue;
		}
		g_any_wanted = true;
		if (lvl >= 3 && g_wlp[id] < 3)
		{
			// the place where the level became 3 is known to everybody
			new Float:p[3];
			pev(id, pev_origin, p);
			g_pseen[id] = now;
			g_phunt[id] = true;
			g_pcall[id] = 0.0;
			guard_alert(-1, id, p, true);
			if (gci(GC_DEBUG)) log_amx("[smak_guard] slot %d reached 3 stars: every guard is called to %.0f %.0f %.0f", id, p[0], p[1], p[2]);
		}
		// what the player is told
		new worst = -1;
		for (new j = 0; j < g_count; j++)
		{
			if (g_role[j] != ROLE_GUARD || g_gtgt[j] != id) continue;
			new m = g_gm[j];
			new rank = (m == GM_WATCH) ? 0 : ((m == GM_SEARCH) ? 1 : ((m == GM_PATROL) ? -1 : 2));
			if (rank > worst) worst = rank;
		}
		if (worst >= 0)
		{
			set_hudmessage(255, 200, 40, 0.02, 0.62, 0, 0.0, 1.2, 0.0, 0.0, -1);
			if (worst == 0) ShowSyncHudMsg(id, g_hud, "Un guardia te vigila...");
			else if (worst == 1) ShowSyncHudMsg(id, g_hud, "Te buscan...");
			else ShowSyncHudMsg(id, g_hud, "Te persiguen!");
		}
	}
	locks_refresh();
}

// ---- the brain of a guard ------------------------------------------------------------------------------

guard_think(i, Float:now, Float:dt, bool:near, Float:o[3])
{
	if (g_state[i] == ST_TALK)
	{
		if (now >= g_until[i] || g_gm[i] != GM_PATROL) g_state[i] = ST_IDLE;
		else return;
	}
	if (g_has_law && g_any_wanted && now >= g_glook[i])
	{
		g_glook[i] = now + 0.25;
		guard_look(i, now, o);
	}
	if (g_gm[i] != GM_PATROL && !guard_target_ok(g_gtgt[i])) guard_to_patrol(i, "target gone");
	switch (g_gm[i])
	{
		case GM_PATROL: patrol_step(i, now);
		case GM_WATCH: watch_step(i, now, dt, o);
		case GM_CHASE: chase_step(i, now, o);
		case GM_SEARCH: search_step(i, now);
		case GM_BREACH: breach_step(i, now);
		case GM_ARREST: arrest_step(i, now, dt, o);
	}
	if (g_state[i] == ST_WALK)
	{
		if (near) walk_near(i, now, dt, o);
		else walk_far(i, now, dt, o);
	}
	else if (g_state[i] == ST_IDLE)
	{
		// a guard at its post stands clear of the doors too (only on patrol: a hunt stands where it must)
		if (g_gm[i] == GM_PATROL && g_gdw[i] && get_pcvar_num(g_cv_clear) && now >= g_clr_t[i])
		{
			g_clr_t[i] = now + 1.5;
			if (clear_stop(i, now, o)) return;
		}
		npc_anim(i, g_sq_idle[i], 1.0);
	}
}

/// A turn on the spot, to look about.
guard_look_about(i, Float:now)
{
	if (now < g_gturn[i]) return;
	g_gturn[i] = now + random_float(2.5, 4.5);
	new Float:ang[3];
	pev(g_ent[i], pev_angles, ang);
	ang[1] += random_float(60.0, 120.0) * ((random_num(0, 1) == 0) ? 1.0 : -1.0);
	ang[0] = 0.0;
	ang[2] = 0.0;
	set_pev(g_ent[i], pev_angles, ang);
}

patrol_step(i, Float:now)
{
	if (g_state[i] == ST_WALK || g_state[i] == ST_WAIT || g_wp_count == 0) return;
	if (!g_gdw[i])
	{
		g_gdw[i] = true;
		new bool:post = (g_gwp[i] < g_wp_posts);
		g_gdw_until[i] = now + (post ? random_float(8.0, 18.0) : random_float(3.0, 7.0));
		g_gturn[i] = now + 3.0;
	}
	guard_look_about(i, now);
	if (now < g_gdw_until[i] || !guard_may_plan()) return;
	for (new tries = 0; tries < g_wp_count; tries++)
	{
		g_gwp[i] = (g_gwp[i] + 1) % g_wp_count;
		if (guard_route(i, g_wp[g_gwp[i]]))
		{
			g_gdw[i] = false;
			return;
		}
	}
	g_gdw_until[i] = now + 10.0;       // no way to any of them just now
}

/// 1 star.
watch_step(i, Float:now, Float:dt, const Float:o[3])
{
	new t = g_gtgt[i];
	if (g_wl[t] >= 2)
	{
		guard_mode(i, GM_CHASE, "level rose");
		return;
	}
	new bool:sees = (now - g_gseen[i] < 0.6);
	if (!sees && now - g_gseen[i] > gcf(GC_LOSE1))
	{
		guard_to_patrol(i, "lost sight");
		return;
	}
	new Float:p[3], Float:v[3];
	pev(t, pev_origin, p);
	pev(t, pev_velocity, v);
	new Float:pspd = floatsqroot(v[0] * v[0] + v[1] * v[1]);
	if (sees && pspd < 40.0) g_gstill[i] += dt;
	else g_gstill[i] = 0.0;
	new Float:dx = p[0] - o[0];
	new Float:dy = p[1] - o[1];
	new Float:h = floatsqroot(dx * dx + dy * dy);
	if (sees && h < gcf(GC_ARR_RANGE) && floatabs(p[2] - o[2]) < 64.0 && g_gstill[i] >= 0.5)
	{
		guard_mode(i, GM_ARREST, "he stands still");
		return;
	}
	if (!sees)
	{
		// goes to where it saw him last and waits there for the time to run out
		guard_approach(i, now, o, g_glk[i], false, 40.0);
		return;
	}
	if (g_gstill[i] >= gcf(GC_STOP_SEC)) guard_approach(i, now, o, p, true, 30.0);   // he stands still: walk up and take him
	else guard_approach(i, now, o, p, true, 180.0);                                   // he moves: keep after him
}

/// 2+ stars.
chase_step(i, Float:now, const Float:o[3])
{
	new t = g_gtgt[i];
	if (g_wl[t] < 2)
	{
		guard_mode(i, GM_WATCH, "level fell");
		return;
	}
	new bool:sees = (now - g_gseen[i] < 0.6);
	new Float:p[3];
	pev(t, pev_origin, p);
	if (sees) copy_vec(g_glk[i], p);
	new Float:dx = g_glk[i][0] - o[0];
	new Float:dy = g_glk[i][1] - o[1];
	new Float:h = floatsqroot(dx * dx + dy * dy);
	new Float:dz = floatabs(g_glk[i][2] - o[2]);
	if (sees && h < gcf(GC_ARR_RANGE) && dz < 64.0)
	{
		guard_mode(i, GM_ARREST, "contact");
		return;
	}
	// at the last known place, or at the nearest node it could reach and it has stopped there: search
	if (!sees && g_gplan[i] > 0.0 && now - g_gt_enter[i] > 0.5 && ((h < 70.0 && dz < 80.0) || g_state[i] == ST_IDLE))
	{
		guard_mode(i, GM_SEARCH, "last known place");
		return;
	}
	guard_approach(i, now, o, g_glk[i], sees, 0.0);
}

/// Sight lost: the nodes around the last known place, until the time runs out.
search_step(i, Float:now)
{
	if (g_gsearch_end[i] <= 0.0)
	{
		new Float:s = gcf(GC_SEARCH_SEC) * ((g_gtgt[i] > 0 && g_wl[g_gtgt[i]] >= 3) ? 2.0 : 1.0);
		g_gsearch_end[i] = now + s;
	}
	if (now >= g_gsearch_end[i])
	{
		guard_giveup(i);
		return;
	}
	if (g_state[i] == ST_WALK || g_state[i] == ST_WAIT) return;
	if (!g_gdw[i])
	{
		g_gdw[i] = true;
		g_gdw_until[i] = now + random_float(1.5, 3.5);
		g_gturn[i] = now;
	}
	guard_look_about(i, now);
	if (now < g_gdw_until[i] || !guard_may_plan()) return;
	new Float:rad = gcf(GC_SEARCH_RAD);
	new cands = 0;
	for (new n = 0; n < g_node_count; n++)
	{
		if (search_node_ok(n, g_glk[i], rad)) cands++;
	}
	for (new tries = 0; tries < 4 && cands > 0; tries++)
	{
		new pick = random_num(0, cands - 1);
		new chosen = -1;
		for (new n = 0; n < g_node_count && chosen < 0; n++)
		{
			if (search_node_ok(n, g_glk[i], rad))
			{
				if (pick == 0) chosen = n;
				pick--;
			}
		}
		if (chosen >= 0 && guard_route(i, chosen))
		{
			g_gdw[i] = false;
			return;
		}
	}
	g_gdw_until[i] = now + 2.0;
}

bool:search_node_ok(n, const Float:c[3], Float:rad)
{
	new kind = g_n_kind[n];
	if (kind != NK_STREET && kind != NK_ROOM && kind != NK_PLACE && kind != NK_STAIR) return false;
	if (floatabs(g_n_at[n][2] - c[2]) > 110.0) return false;
	return (vector_distance(g_n_at[n], c) <= rad);
}

/// Holds the target: still for smak_guard_arrest_sec seconds and not shooting, then smak_law_arrest.
arrest_step(i, Float:now, Float:dt, const Float:o[3])
{
	new t = g_gtgt[i];
	new Float:p[3], Float:v[3];
	pev(t, pev_origin, p);
	pev(t, pev_velocity, v);
	new Float:dx = p[0] - o[0];
	new Float:dy = p[1] - o[1];
	new Float:h = floatsqroot(dx * dx + dy * dy);
	new lvl = g_wl[t];
	new bool:sees = (now - g_gseen[i] < 1.0);
	if (!sees || h > gcf(GC_ARR_RANGE) * 1.6 || floatabs(p[2] - o[2]) > 80.0)
	{
		guard_mode(i, (lvl >= 2) ? GM_CHASE : GM_WATCH, "he got away");
		return;
	}
	guard_stand(i, p);
	new Float:pspd = floatsqroot(v[0] * v[0] + v[1] * v[1]);
	new bool:shooting = (now - g_noise_t[t] < 1.5);
	if (g_garr[i] <= 0.0 && !shooting) client_print(t, print_chat, "[%s] Quieto! Quedas detenido.", g_name[i]);
	if (shooting || (lvl == 1 && pspd >= 150.0)) g_garr[i] = 0.0;
	else g_garr[i] += dt;
	if (lvl >= 2 && gci(GC_GRAB))
	{
		new Float:s = gcf(GC_GRAB_SCALE);
		v[0] *= s;
		v[1] *= s;
		set_pev(t, pev_velocity, v);
	}
	if (g_garr[i] >= gcf(GC_ARR_SEC)) do_arrest(i, t);
}

do_arrest(i, t)
{
	new paid = smak_law_arrest(t);
	new name[32];
	get_user_name(t, name, charsmax(name));
	if (paid < 0)
	{
		log_amx("[smak_guard] %s could not arrest slot %d (%s): smak_law refused", g_id[i], t, name);
		g_garr[i] = 0.0;
		guard_to_patrol(i, "arrest refused");
		return;
	}
	log_amx("[smak_guard] %s arrested slot %d (%s): collected %d", g_id[i], t, name, paid);
	g_wl[t] = 0;
	g_phunt[t] = false;
	for (new j = 0; j < g_count; j++)
	{
		if (g_role[j] == ROLE_GUARD && g_gtgt[j] == t) guard_to_patrol(j, "arrested");
	}
}

// ---- locked doors ----------------------------------------------------------------------------------------

bool:breach_ok(i)
{
	new t = g_gtgt[i];
	return (g_has_doors && gci(GC_BREACH) && t > 0 && g_wl[t] >= 3 && g_gm[i] == GM_CHASE);
}

/// open_door() for a guard: true when it may use the door now. A locked door: at 3 stars (in a chase) it stands there and
/// breaches; otherwise the link is left out of its plans for a while and the route is dropped (the mode replans).
bool:guard_door_ok(i, slot, bool:here, Float:now)
{
	if (!door_locked_now(slot)) return true;
	if (!here) return false;
	if (breach_ok(i))
	{
		begin_breach(i, slot, now);
		return false;
	}
	if (g_rpos[i] < g_rlen[i])
	{
		g_ban_a[i] = g_cur[i];
		g_ban_b[i] = g_route[i][g_rpos[i]];
		g_ban_t[i] = now + 40.0;
	}
	if (gci(GC_DEBUG)) log_amx("[smak_guard] %s: door '%s' is locked, no breach: it goes round or waits", g_id[i], g_door_name[slot]);
	g_rlen[i] = 0;
	g_rpos[i] = 0;
	g_use_goal[i] = false;
	g_state[i] = ST_IDLE;
	g_gplan[i] = 0.0;
	return false;
}

begin_breach(i, slot, Float:now)
{
	new Float:c[3];
	c[0] = g_n_at[g_cur[i]][0];
	c[1] = g_n_at[g_cur[i]][1];
	c[2] = g_n_at[g_cur[i]][2];
	new ent = find_ent_by_tname(-1, g_door_name[slot]);
	if (ent > 0)
	{
		new Float:a[3], Float:b[3];
		pev(ent, pev_absmin, a);
		pev(ent, pev_absmax, b);
		c[0] = (a[0] + b[0]) * 0.5;
		c[1] = (a[1] + b[1]) * 0.5;
		c[2] = (a[2] + b[2]) * 0.5;
	}
	guard_mode(i, GM_BREACH, "locked door");
	copy_vec(g_gbpos[i], c);
	g_gbdoor[i] = slot;
	g_gbend[i] = now + gcf(GC_BREACH_SEC);
	g_gbmsg[i] = 0.0;
	guard_stand(i, c);
	if (gci(GC_DEBUG))
	{
		new prop[32], kind[32];
		prop[0] = kind[0] = 0;
		if (ent > 0)
		{
			smak_door_property(ent, prop, charsmax(prop));
			smak_door_kind(ent, kind, charsmax(kind));
		}
		log_amx("[smak_guard] %s starts breaching '%s' (property '%s', kind '%s') for %.0f s", g_id[i], g_door_name[slot], prop, kind, gcf(GC_BREACH_SEC));
	}
}

breach_step(i, Float:now)
{
	new t = g_gtgt[i];
	new slot = g_gbdoor[i];
	if (g_wl[t] < 3 || !gci(GC_BREACH))
	{
		guard_mode(i, (g_wl[t] >= 2) ? GM_CHASE : GM_WATCH, "no longer 3 stars");
		return;
	}
	guard_stand(i, g_gbpos[i]);
	new Float:left = g_gbend[i] - now;
	if (now >= g_gbmsg[i])
	{
		g_gbmsg[i] = now + 1.0;
		new secs = max(0, floatround(left, floatround_ceil));
		client_print(t, print_chat, "[%s] Abre! Los guardias fuerzan la puerta (%d s).", g_name[i], secs);
		for (new id = 1; id <= g_maxpl; id++)
		{
			if (id == t || !is_user_connected(id) || !is_user_alive(id)) continue;
			new Float:p[3];
			pev(id, pev_origin, p);
			if (vector_distance(p, g_gbpos[i]) < 350.0) client_print(id, print_chat, "[SMAK] Unos guardias fuerzan una puerta cerca.");
		}
		new snd[64];
		get_pcvar_string(g_gc[GC_KNOCK], snd, charsmax(snd));
		if (snd[0]) emit_sound(g_ent[i], CHAN_ITEM, snd, 1.0, ATTN_NORM, 0, PITCH_NORM);
	}
	if (left > 0.0) return;
	new ent = -1;
	while ((ent = find_ent_by_tname(ent, g_door_name[slot])) > 0)
	{
		smak_door_breach(ent, g_ent[i]);
	}
	g_door_t[i] = 0.0;
	g_dl[slot] = false;
	if (gci(GC_DEBUG)) log_amx("[smak_guard] %s breached '%s'", g_id[i], g_door_name[slot]);
	guard_mode(i, GM_CHASE, "door breached");
}

// ---- admin: /guardias, smak_guards ------------------------------------------------------------------------

print_guards(id)
{
	new const src[][] = { "none", "places", "police properties", "gates" };
	new wanted = 0;
	for (new p = 1; p <= g_maxpl; p++)
	{
		if (g_wl[p] > 0) wanted++;
	}
	console_print(id, "smak_guard: %d guard(s), %d waypoint(s) (%d posts, from %s), smak_law %d, smak_doors %d, %d wanted", g_gcount, g_wp_count, g_wp_posts, src[g_wp_src], g_has_law ? 1 : 0, g_has_doors ? 1 : 0, wanted);
	new Float:now = get_gametime();
	for (new i = 0; i < g_count; i++)
	{
		if (g_role[i] != ROLE_GUARD || g_ent[i] <= 0 || !pev_valid(g_ent[i])) continue;
		new Float:o[3];
		pev(g_ent[i], pev_origin, o);
		new tname[32];
		tname[0] = 0;
		if (g_gtgt[i] > 0 && is_user_connected(g_gtgt[i])) get_user_name(g_gtgt[i], tname, charsmax(tname));
		if (!tname[0]) copy(tname, charsmax(tname), "-");
		console_print(id, "%-9s %-7s target %-16s level %d seen %4.1fs ago  at %.0f %.0f %.0f  wp %d  %s", g_id[i], g_gm_name[g_gm[i]], tname, g_gtgt[i] > 0 ? g_wl[g_gtgt[i]] : 0, (g_gseen[i] > 0.0) ? now - g_gseen[i] : -1.0, o[0], o[1], o[2], g_gwp[i], g_far[i] ? "far" : "real");
	}
	for (new p = 1; p <= g_maxpl; p++)
	{
		if (g_wl[p] < 1) continue;
		new name[32];
		get_user_name(p, name, charsmax(name));
		console_print(id, "wanted: %s level %d, last seen by a guard %.0f s ago", name, g_wl[p], (g_pseen[p] > 0.0) ? now - g_pseen[p] : -1.0);
	}
}

public cmd_guards(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
	print_guards(id);
	return PLUGIN_HANDLED;
}

public cmd_guards_say(id)
{
	if (!(get_user_flags(id) & ADMIN_RCON))
	{
		client_print(id, print_chat, "[SMAK] Solo para administradores.");
		return PLUGIN_HANDLED;
	}
	print_guards(id);
	client_print(id, print_chat, "[SMAK] %d guardias: el detalle esta en tu consola.", g_gcount);
	return PLUGIN_HANDLED;
}

// ---- talking to a guard ------------------------------------------------------------------------------------

guard_talk(id, i, Float:now)
{
	if (g_gm[i] != GM_PATROL) return;
	new Float:hour = clock_hour();
	new lang = get_pcvar_num(g_cv_lang);
	new idx = 0;
	if (g_wl[id] > 0) idx = 3;
	else if (hour >= 22.0 || hour < 6.0) idx = 2;
	else if (hour >= 17.0) idx = 1;
	new const en[][] = {
		"Move along. We keep order here.",
		"Curfew is close. Get home.",
		"Nobody should be out at this hour. The gates are watched.",
		"Hands where I can see them. You are wanted."
	};
	new const es[][] = {
		"Circulen. Aqui mantenemos el orden.",
		"El toque de queda se acerca. A casa.",
		"Nadie deberia andar fuera a esta hora. Los controles estan vigilados.",
		"Las manos donde pueda verlas. Estas buscado."
	};
	if (lang) client_print(id, print_chat, "[%s] %s", g_name[i], es[idx]);
	else client_print(id, print_chat, "[%s] %s", g_name[i], en[idx]);
	new Float:p[3];
	pev(id, pev_origin, p);
	guard_face(i, p);
	g_state[i] = ST_TALK;
	g_until[i] = now + 3.0;
	g_rlen[i] = 0;
	g_rpos[i] = 0;
	g_use_goal[i] = false;
	g_gdw[i] = false;
	npc_anim(i, g_sq_idle[i], 1.0);
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
	guard_hear(invoker, p);
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
	if (g_role[i] == ROLE_GUARD)
	{
		guard_talk(id, i, now);
		return;
	}
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

	// a citizen or worker has nothing to sell: its line said, it steps out of the way (keepers keep their word with the player)
	if ((g_role[i] == ROLE_CITIZEN || g_role[i] == ROLE_WORKER) && (g_state[i] == ST_IDLE || g_state[i] == ST_WALK) && get_pcvar_num(g_cv_yield))
	{
		new Float:p[3];
		pev(id, pev_origin, p);
		if (yield_to(i, now, p, 0)) return;
	}
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
	new const roles[][] = { "keeper", "worker", "citizen", "guard", "smuggler", "wanted" };
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

// =======================================================================================================
// drones: flying surveillance. At smak_drone_stars (4) a wanted player gets a drone (models/smak/drone.mdl) that
// flies to him, keeps above and beside him, lights him and tells the guards where he is. It can be shot down.
//   - at most smak_drone_max (2, hard cap MAX_DRONES) at once, one for each hunted player: that is every entity
//     the drones ever add (a dying one keeps its slot until it is removed, 4 s after it falls);
//   - it starts out of sight: above the guard post nearest to the player (a trace up finds the roof or the sky),
//     else high above the street near him;
//   - it moves with MOVETYPE_FLY by velocity every 0.1 s; each step is a hull trace first, and a blocked one
//     tries up, then to either side, then waits; it never sets its origin, so it cannot pass through the world;
//   - it sees the player along a clear line within smak_drone_sight; seeing him it turns to him, plays "alert",
//     feeds his place to the guards (guard_alert: the radio), lights him (TE_DLIGHT) and warns him in chat;
//     without sight it goes to the last place it saw him, then rises to look;
//   - it flies up and is removed when his stars drop below the threshold, he is jailed, dead, gone, in a mission
//     arena (g_wl is 0 there), or smak_drone_lose seconds pass without sight; a new one is not sent to that
//     player for 20 s;
//   - shot down (smak_drone_health), it plays "die", falls and is removed; no drone is sent to anybody for
//     smak_drone_cooldown seconds;
//   - smak_drone_dmg above 0 (off by default): from 5 stars it hurts the player it sees every 1.5 s.
// If models/smak/drone.mdl is not in the game, the drones are off and a line in the log says so; nothing else changes.
// =======================================================================================================

#define MAX_DRONES    4
#define DRONE_MODEL   "models/smak/drone.mdl"
#define DR_FREE       0
#define DR_FLY        1
#define DR_LEAVE      2
#define DR_DEAD       3
#define DQ_IDLE       0
#define DQ_MOVE       1
#define DQ_ALERT      2
#define DQ_DIE        3

enum { DC_ENABLE, DC_STARS, DC_MAX, DC_HEALTH, DC_SPEED, DC_HEIGHT, DC_SIGHT, DC_LOSE, DC_COOL, DC_DMG, DC_DEBUG, DC_N };
new g_dc[DC_N];

new bool:g_dr_model;
new g_dr_ent[MAX_DRONES];
new g_dr_mode[MAX_DRONES];
new g_dr_tgt[MAX_DRONES];
new g_dr_seq[MAX_DRONES];
new Float:g_dr_seen[MAX_DRONES];
new Float:g_dr_until[MAX_DRONES];
new Float:g_dr_warn[MAX_DRONES];
new Float:g_dr_shot[MAX_DRONES];
new Float:g_dr_lk[MAX_DRONES][3];
new bool:g_dr_see[MAX_DRONES];
new Float:g_dr_cd;                    // no drone is sent before this time (one was shot down)
new Float:g_dr_next;                  // next try after a spawn that found no place
new Float:g_dr_pcd[MAXPL];            // no drone for this player before this time
new g_dhud;

drone_register()
{
	g_dc[DC_ENABLE] = register_cvar("smak_drone_enable", "1");
	g_dc[DC_STARS] = register_cvar("smak_drone_stars", "4");           // wanted level that sends a drone
	g_dc[DC_MAX] = register_cvar("smak_drone_max", "2");               // drones at once, 0 to 4
	g_dc[DC_HEALTH] = register_cvar("smak_drone_health", "60");
	g_dc[DC_SPEED] = register_cvar("smak_drone_speed", "340");         // units a second
	g_dc[DC_HEIGHT] = register_cvar("smak_drone_height", "150");       // above the player
	g_dc[DC_SIGHT] = register_cvar("smak_drone_sight", "1800");
	g_dc[DC_LOSE] = register_cvar("smak_drone_lose", "45");           // seconds without sight before it leaves
	g_dc[DC_COOL] = register_cvar("smak_drone_cooldown", "60");        // seconds without a new drone after one is shot down
	g_dc[DC_DMG] = register_cvar("smak_drone_dmg", "0");               // damage every 1.5 s from 5 stars, 0 off
	g_dc[DC_DEBUG] = register_cvar("smak_drone_debug", "0");
}

drone_precache()
{
	g_dr_model = bool:file_exists(DRONE_MODEL);
	if (g_dr_model) precache_model(DRONE_MODEL);
}

drone_start()
{
	for (new s = 0; s < MAX_DRONES; s++)
	{
		g_dr_ent[s] = 0;
		g_dr_mode[s] = DR_FREE;
	}
	g_dr_on = false;
	if (!get_pcvar_num(g_dc[DC_ENABLE]))
	{
		log_amx("[smak_drone] smak_drone_enable is 0: no drones");
		return;
	}
	if (!g_dr_model)
	{
		log_amx("[smak_drone] %s is not in the game: no drones", DRONE_MODEL);
		return;
	}
	if (!g_has_law)
	{
		log_amx("[smak_drone] smak_law is not running: no drones (there are no stars)");
		return;
	}
	g_dr_on = true;
	g_dhud = CreateHudSyncObj();
	RegisterHam(Ham_TakeDamage, "info_target", "fw_drone_hurt", 0);
	register_forward(FM_ClientDisconnect, "fw_drone_disc");
	log_amx("[smak_drone] model ok, max %d, at %d stars", clamp(get_pcvar_num(g_dc[DC_MAX]), 0, MAX_DRONES), get_pcvar_num(g_dc[DC_STARS]));
}

public plugin_end()
{
	for (new s = 0; s < MAX_DRONES; s++) drone_free(s);
}

public fw_drone_disc(id)
{
	if (!g_dr_on) return FMRES_IGNORED;
	g_dr_pcd[id] = 0.0;
	for (new s = 0; s < MAX_DRONES; s++)
	{
		if (g_dr_mode[s] == DR_FLY && g_dr_tgt[s] == id) drone_leave(s, "player gone", get_gametime());
	}
	return FMRES_IGNORED;
}

/// Damage to a drone: the health goes down here and nothing else of the engine's runs (it would remove the entity).
public fw_drone_hurt(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (!g_dr_on || victim <= g_maxpl || !pev_valid(victim)) return HAM_IGNORED;
	new cls[16];
	pev(victim, pev_classname, cls, charsmax(cls));
	if (!equal(cls, "smak_drone")) return HAM_IGNORED;
	new s = drone_slot(victim);
	if (s < 0 || g_dr_mode[s] == DR_DEAD) return HAM_SUPERCEDE;
	new Float:hp;
	pev(victim, pev_health, hp);
	hp -= damage;
	set_pev(victim, pev_health, hp);
	if (hp <= 0.0) drone_kill(s, attacker);
	return HAM_SUPERCEDE;
}

drone_slot(ent)
{
	for (new s = 0; s < MAX_DRONES; s++)
	{
		if (g_dr_mode[s] != DR_FREE && g_dr_ent[s] == ent) return s;
	}
	return -1;
}

drone_free(s)
{
	if (g_dr_mode[s] == DR_FREE) return;
	if (g_dr_ent[s] > 0 && pev_valid(g_dr_ent[s])) engfunc(EngFunc_RemoveEntity, g_dr_ent[s]);
	g_dr_ent[s] = 0;
	g_dr_mode[s] = DR_FREE;
}

drone_kill(s, attacker)
{
	new ent = g_dr_ent[s];
	new Float:now = get_gametime();
	g_dr_mode[s] = DR_DEAD;
	g_dr_until[s] = now + 4.0;
	g_dr_cd = now + get_pcvar_float(g_dc[DC_COOL]);
	set_pev(ent, pev_takedamage, DAMAGE_NO);
	set_pev(ent, pev_solid, SOLID_NOT);
	set_pev(ent, pev_movetype, MOVETYPE_TOSS);
	set_pev(ent, pev_effects, 0);
	set_pev(ent, pev_gravity, 1.0);
	new Float:v[3];
	v[0] = random_float(-30.0, 30.0);
	v[1] = random_float(-30.0, 30.0);
	v[2] = 0.0;
	set_pev(ent, pev_velocity, v);
	g_dr_seq[s] = -1;
	drone_seq(s, DQ_DIE);
	if (attacker >= 1 && attacker <= g_maxpl && is_user_connected(attacker))
	{
		client_print(attacker, print_chat, "[Vigilancia] Derribaste un dron de vigilancia.");
	}
	if (get_pcvar_num(g_dc[DC_DEBUG])) log_amx("[smak_drone] drone %d shot down by %d; no new one for %d s", s, attacker, get_pcvar_num(g_dc[DC_COOL]));
}

/// It flies up and is removed after a few seconds; the player is not sent another one for 20 s.
drone_leave(s, const why[], Float:now)
{
	if (g_dr_mode[s] != DR_FLY) return;
	new t = g_dr_tgt[s];
	if (t >= 1 && t <= g_maxpl) g_dr_pcd[t] = now + 20.0;
	g_dr_mode[s] = DR_LEAVE;
	g_dr_until[s] = now + 3.5;
	drone_seq(s, DQ_MOVE);
	if (get_pcvar_num(g_dc[DC_DEBUG])) log_amx("[smak_drone] drone %d leaves (%s)", s, why);
}

/// Play sequence q (only when it changes: the client runs the animation from animtime).
drone_seq(s, q)
{
	if (g_dr_seq[s] == q) return;
	g_dr_seq[s] = q;
	new ent = g_dr_ent[s];
	set_pev(ent, pev_sequence, q);
	set_pev(ent, pev_frame, 0.0);
	set_pev(ent, pev_framerate, 1.0);
	set_pev(ent, pev_animtime, get_gametime());
}

/// A clear flight for the drone's body from a to b (ent: the drone itself, or 0 for a place to start from).
bool:drone_clear(ent, const Float:a[3], const Float:b[3])
{
	new tr = create_tr2();
	engfunc(EngFunc_TraceHull, a, b, IGNORE_MONSTERS, HULL_HEAD, ent, tr);
	new Float:frac;
	get_tr2(tr, TR_flFraction, frac);
	new bool:solid = bool:(get_tr2(tr, TR_AllSolid) || get_tr2(tr, TR_StartSolid));
	free_tr2(tr);
	return (frac >= 1.0 && !solid);
}

/// The z of the roof or the sky straight above `from`, at most `maxup` up.
Float:drone_ceiling(ent, const Float:from[3], Float:maxup)
{
	new Float:e[3];
	copy_vec(e, from);
	e[2] += maxup;
	new tr = create_tr2();
	engfunc(EngFunc_TraceLine, from, e, IGNORE_MONSTERS, ent, tr);
	get_tr2(tr, TR_vecEndPos, e);
	free_tr2(tr);
	return e[2];
}

/// Where a new drone starts, out of sight: over the guard post nearest to the player, else high over the street near
/// him. false when there is no place now.
bool:drone_start_pos(const Float:tp[3], Float:out[3])
{
	new used[MAX_WP];
	new nposts = (g_wp_posts > 0) ? g_wp_posts : g_wp_count;
	for (new round = 0; round < nposts; round++)
	{
		new best = -1;
		new Float:bd = 100000000.0;
		for (new k = 0; k < nposts; k++)
		{
			if (used[k]) continue;
			new Float:d = vector_distance(g_n_at[g_wp[k]], tp);
			if (d < bd)
			{
				bd = d;
				best = k;
			}
		}
		if (best < 0) break;
		used[best] = 1;
		new Float:base[3];
		copy_vec(base, g_n_at[g_wp[best]]);
		base[2] += 40.0;
		new Float:top = drone_ceiling(0, base, 1000.0) - 40.0;
		new Float:z = floatmin(top, base[2] + 450.0);
		if (z - base[2] < 120.0) continue;
		new Float:p[3];
		copy_vec(p, base);
		p[2] = z;
		if (!drone_clear(0, p, p)) continue;
		copy_vec(out, p);
		return true;
	}
	for (new tries = 0; tries < 6; tries++)
	{
		new Float:a = random_float(0.0, 6.2831);
		new Float:r = (tries < 4) ? 350.0 : 0.0;
		new Float:base[3];
		base[0] = tp[0] + floatcos(a, radian) * r;
		base[1] = tp[1] + floatsin(a, radian) * r;
		base[2] = tp[2] + 60.0;
		new Float:top = drone_ceiling(0, base, 800.0) - 40.0;
		new Float:z = floatmin(top, tp[2] + 400.0);
		if (z - tp[2] < 120.0) continue;
		new Float:p[3];
		copy_vec(p, base);
		p[2] = z;
		if (!drone_clear(0, p, p)) continue;
		copy_vec(out, p);
		return true;
	}
	return false;
}

drone_spawn(t, Float:now)
{
	new s = -1;
	for (new k = 0; k < MAX_DRONES; k++)
	{
		if (g_dr_mode[k] == DR_FREE)
		{
			s = k;
			break;
		}
	}
	if (s < 0) return;
	new Float:tp[3], Float:p[3];
	pev(t, pev_origin, tp);
	if (!drone_start_pos(tp, p))
	{
		g_dr_next = now + 5.0;
		if (get_pcvar_num(g_dc[DC_DEBUG])) log_amx("[smak_drone] no place to start a drone for slot %d", t);
		return;
	}
	new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"));
	if (ent <= 0) return;
	set_pev(ent, pev_classname, "smak_drone");
	engfunc(EngFunc_SetModel, ent, DRONE_MODEL);
	engfunc(EngFunc_SetSize, ent, Float:{-20.0, -20.0, -10.0}, Float:{20.0, 20.0, 10.0});
	engfunc(EngFunc_SetOrigin, ent, p);
	set_pev(ent, pev_solid, SOLID_BBOX);
	set_pev(ent, pev_movetype, MOVETYPE_FLY);
	set_pev(ent, pev_takedamage, DAMAGE_YES);
	set_pev(ent, pev_health, get_pcvar_float(g_dc[DC_HEALTH]));
	set_pev(ent, pev_skin, 1);
	set_pev(ent, pev_effects, EF_DIMLIGHT);
	g_dr_ent[s] = ent;
	g_dr_mode[s] = DR_FLY;
	g_dr_tgt[s] = t;
	g_dr_seen[s] = now;
	g_dr_warn[s] = 0.0;
	g_dr_shot[s] = now + 2.0;
	g_dr_see[s] = false;
	copy_vec(g_dr_lk[s], tp);
	g_dr_seq[s] = -1;
	drone_seq(s, DQ_MOVE);
	if (get_pcvar_num(g_dc[DC_DEBUG])) log_amx("[smak_drone] drone %d sent to slot %d from %.0f %.0f %.0f", s, t, p[0], p[1], p[2]);
}

/// Every second: who needs a drone.
drone_manage(Float:now)
{
	if (now < g_dr_cd || now < g_dr_next) return;
	new maxd = clamp(get_pcvar_num(g_dc[DC_MAX]), 0, MAX_DRONES);
	new stars = get_pcvar_num(g_dc[DC_STARS]);
	new active = 0;
	for (new s = 0; s < MAX_DRONES; s++)
	{
		if (g_dr_mode[s] == DR_FLY) active++;
	}
	for (new t = 1; t <= g_maxpl && active < maxd; t++)
	{
		if (g_wl[t] < stars || !guard_target_ok(t) || now < g_dr_pcd[t]) continue;
		if (smak_law_jailed(t) > 0) continue;
		new bool:has = false;
		for (new s = 0; s < MAX_DRONES; s++)
		{
			if (g_dr_mode[s] == DR_FLY && g_dr_tgt[s] == t) has = true;
		}
		if (has) continue;
		drone_spawn(t, now);
		if (now < g_dr_next) return;
		active++;
	}
}

/// One step of the flight toward goal: the first of several directions whose hull trace is clear. v is the velocity.
drone_steer(ent, const Float:o[3], const Float:goal[3], Float:speed, Float:v[3])
{
	new Float:dx = goal[0] - o[0];
	new Float:dy = goal[1] - o[1];
	new Float:dz = goal[2] - o[2];
	new Float:dist = floatsqroot(dx * dx + dy * dy + dz * dz);
	v[0] = 0.0;
	v[1] = 0.0;
	v[2] = 0.0;
	if (dist < 10.0) return;
	new Float:ux = dx / dist;
	new Float:uy = dy / dist;
	new Float:uz = dz / dist;
	new Float:spd = speed;
	if (dist < 120.0) spd = floatmax(40.0, speed * dist / 120.0);
	new Float:look = floatmax(60.0, floatmin(dist, speed * 0.4));
	new Float:c[7][3];
	c[0][0] = ux;       c[0][1] = uy;       c[0][2] = uz;
	c[1][0] = ux;       c[1][1] = uy;       c[1][2] = uz + 0.9;
	c[2][0] = 0.0;      c[2][1] = 0.0;      c[2][2] = 1.0;
	c[3][0] = -uy;      c[3][1] = ux;       c[3][2] = 0.4;
	c[4][0] = uy;       c[4][1] = -ux;      c[4][2] = 0.4;
	c[5][0] = -uy;      c[5][1] = ux;       c[5][2] = 0.0;
	c[6][0] = uy;       c[6][1] = -ux;      c[6][2] = 0.0;
	for (new k = 0; k < 7; k++)
	{
		new Float:l = floatsqroot(c[k][0] * c[k][0] + c[k][1] * c[k][1] + c[k][2] * c[k][2]);
		if (l < 0.01) continue;
		new Float:e[3];
		e[0] = o[0] + c[k][0] / l * look;
		e[1] = o[1] + c[k][1] / l * look;
		e[2] = o[2] + c[k][2] / l * look;
		if (!drone_clear(ent, o, e)) continue;
		v[0] = c[k][0] / l * spd;
		v[1] = c[k][1] / l * spd;
		v[2] = c[k][2] / l * spd;
		return;
	}
}

drone_tick(Float:now)
{
	if (g_tick % 10 == 0) drone_manage(now);
	for (new s = 0; s < MAX_DRONES; s++)
	{
		if (g_dr_mode[s] == DR_FREE) continue;
		new ent = g_dr_ent[s];
		if (ent <= 0 || !pev_valid(ent))
		{
			g_dr_ent[s] = 0;
			g_dr_mode[s] = DR_FREE;
			continue;
		}
		switch (g_dr_mode[s])
		{
			case DR_DEAD:
			{
				if (now >= g_dr_until[s]) drone_free(s);
			}
			case DR_LEAVE:
			{
				new Float:o[3], Float:up[3], Float:v[3];
				pev(ent, pev_origin, o);
				copy_vec(up, o);
				up[2] += 60.0;
				v[0] = 0.0;
				v[1] = 0.0;
				v[2] = drone_clear(ent, o, up) ? 220.0 : 0.0;
				set_pev(ent, pev_velocity, v);
				if (now >= g_dr_until[s]) drone_free(s);
			}
			case DR_FLY: drone_fly(s, ent, now);
		}
	}
}

drone_fly(s, ent, Float:now)
{
	new t = g_dr_tgt[s];
	if (!guard_target_ok(t) || g_wl[t] < get_pcvar_num(g_dc[DC_STARS]) || smak_law_jailed(t) > 0)
	{
		drone_leave(s, "target gone or stars dropped", now);
		return;
	}
	if (now - g_dr_seen[s] > get_pcvar_float(g_dc[DC_LOSE]))
	{
		drone_leave(s, "lost him", now);
		return;
	}
	new Float:o[3], Float:tp[3], Float:ofs[3], Float:pe[3];
	pev(ent, pev_origin, o);
	pev(t, pev_origin, tp);
	pev(t, pev_view_ofs, ofs);
	pe[0] = tp[0] + ofs[0];
	pe[1] = tp[1] + ofs[1];
	pe[2] = tp[2] + ofs[2];

	// does it see him: a clear line, within range
	new bool:see = false;
	if (vector_distance(o, tp) <= get_pcvar_float(g_dc[DC_SIGHT]))
	{
		new tr = create_tr2();
		new Float:frac;
		engfunc(EngFunc_TraceLine, o, pe, IGNORE_MONSTERS, ent, tr);
		get_tr2(tr, TR_flFraction, frac);
		free_tr2(tr);
		see = (frac >= 1.0);
	}
	g_dr_see[s] = see;
	new Float:goal[3];
	new Float:height = get_pcvar_float(g_dc[DC_HEIGHT]);
	if (see)
	{
		g_dr_seen[s] = now;
		copy_vec(g_dr_lk[s], tp);
		// above him and to one side, turning slowly; lower where there is a roof, straight above him where the side is walled
		new Float:a = now * 0.4 + float(s) * 3.1416;
		new Float:head[3];
		copy_vec(head, tp);
		head[2] += 40.0;
		new Float:top = drone_ceiling(t, head, height + 60.0) - 30.0;
		new Float:z = floatmax(tp[2] + 70.0, floatmin(tp[2] + height, top));
		goal[0] = tp[0] + floatcos(a, radian) * 90.0;
		goal[1] = tp[1] + floatsin(a, radian) * 90.0;
		goal[2] = z;
		if (!drone_clear(ent, goal, goal))
		{
			goal[0] = tp[0];
			goal[1] = tp[1];
		}
		drone_mark(s, t, now, tp);
	}
	else
	{
		copy_vec(goal, g_dr_lk[s]);
		goal[2] += height + ((now - g_dr_seen[s] > 3.0) ? 100.0 : 0.0);
	}
	new Float:v[3];
	drone_steer(ent, o, goal, get_pcvar_float(g_dc[DC_SPEED]), v);
	set_pev(ent, pev_velocity, v);

	// where it looks: at him when it sees him, else where it goes
	new Float:want = -1000.0;
	new Float:cur[3];
	pev(ent, pev_angles, cur);
	if (see)
	{
		new Float:d[3], Float:ang[3];
		d[0] = tp[0] - o[0];
		d[1] = tp[1] - o[1];
		d[2] = 0.0;
		vector_to_angle(d, ang);
		want = ang[1];
	}
	else if (v[0] * v[0] + v[1] * v[1] > 625.0)
	{
		new Float:d[3], Float:ang[3];
		d[0] = v[0];
		d[1] = v[1];
		d[2] = 0.0;
		vector_to_angle(d, ang);
		want = ang[1];
	}
	if (want > -999.0)
	{
		new Float:diff = want - cur[1];
		while (diff > 180.0) diff -= 360.0;
		while (diff < -180.0) diff += 360.0;
		cur[1] += floatmax(-35.0, floatmin(35.0, diff));
	}
	cur[0] = 0.0;
	cur[2] = 0.0;
	set_pev(ent, pev_angles, cur);
	new Float:sp = floatsqroot(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
	drone_seq(s, see ? DQ_ALERT : ((sp > 25.0) ? DQ_MOVE : DQ_IDLE));
}

/// It sees the player: the guards are told, he is lit and warned (and, from 5 stars if smak_drone_dmg is set, hurt).
drone_mark(s, t, Float:now, const Float:tp[3])
{
	g_pseen[t] = now;
	g_phunt[t] = true;
	guard_alert(-1, t, tp, true);          // at most one call every 2 s for a player
	if (g_tick % 3 == 0)
	{
		new org[3];
		org[0] = floatround(tp[0]);
		org[1] = floatround(tp[1]);
		org[2] = floatround(tp[2]) + 30;
		message_begin(MSG_PVS, SVC_TEMPENTITY, org);
		write_byte(TE_DLIGHT);
		write_coord(org[0]);
		write_coord(org[1]);
		write_coord(org[2]);
		write_byte(12);
		write_byte(200);
		write_byte(220);
		write_byte(255);
		write_byte(4);
		write_byte(3);
		message_end();
	}
	if (now >= g_dr_warn[s])
	{
		g_dr_warn[s] = now + 25.0;
		client_print(t, print_chat, "[Vigilancia] Un dron de vigilancia te sigue.");
		set_hudmessage(120, 190, 255, 0.02, 0.58, 0, 0.0, 3.0, 0.0, 0.0, -1);
		ShowSyncHudMsg(t, g_dhud, "Un dron de vigilancia te sigue");
	}
	new Float:dmg = get_pcvar_float(g_dc[DC_DMG]);
	if (dmg > 0.0 && g_wl[t] >= 5 && now >= g_dr_shot[s])
	{
		g_dr_shot[s] = now + 1.5;
		ExecuteHamB(Ham_TakeDamage, t, g_dr_ent[s], g_dr_ent[s], dmg, DMG_BULLET);
	}
}
