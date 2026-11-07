/*
 * smak_skills.sma -- skills that grow with use (levels/rp/NPCS.md, 5.6 and 5.11 phase 6). Needs smak_core.amxx
 * (listed before it in plugins.ini): the character's identity comes from smak_char_ident.
 *
 *   punteria     hits with firearms on other players        cuerpo      melee / kung-fu hits on other players
 *   atletismo    distance run on foot                        resistencia damage taken from players and survived
 *
 * XP comes from Ham_TakeDamage (post) on players: the same hook smak_npc already uses, so it works wherever that
 * does. It counts only when attacker and victim are two different human players, the attacker's own body did the
 * damage (inflictor == attacker: bullets and blows, not grenades, barrels, falls or the world), nobody is a bot
 * (cvar smak_skills_bots), and they are not on the same team (smak_skills_teamcheck). Each skill has a cap of XP per
 * minute (smak_skills_cap) and each attacker/victim pair a smaller one, so two friends cannot trade blows
 * forever. Walls, props and smak_npc's citizens give nothing: they are not detectable here; a script rewards a
 * mission with the smak_give_xp native (which is not capped).
 *
 * Effect: resistencia gives +smak_skills_hp_per_level (default 2) health per level, applied after spawn (Ham_Spawn)
 * and at once when the level rises or the skills load. The other three have no effect yet: nothing that TS does not
 * overwrite has been verified for speed or gravity. They are progress only.
 *
 * Persistence: table skills(ident, skill, xp) in data/sqlite3/smak_rp.sq3 (the file smak_core uses; this plugin
 * touches only its own table). Guests (and a player whose load failed) keep their skills for the session and are
 * never saved. Saves are threaded queries, debounced by SAVE_DELAY, one multi-row REPLACE per player.
 * Cost: no per-frame work. One Ham post hook per damage event, one 4 s task over the players, one 60 s task.
 */

#define SMAK_SKILLS_PLUGIN
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <sqlx>
#include <tsfun>
#include <smak_core>
#include <smak_skills>

#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK skills"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define DB_NAME      "smak_rp"
#define MAXPL        33
#define NSK          4
#define SK_PUNTERIA  0
#define SK_CUERPO    1
#define SK_ATLETISMO 2
#define SK_RESIST    3

// level L needs XP_UNIT * L * L experience in total (level 1 = 40, 5 = 1000, 10 = 4000, 20 = 16000)
#define XP_UNIT      40
#define MAX_LEVEL    20
#define XP_MAX       100000

#define SAVE_DELAY   10.0
#define RUN_SECONDS  4.0
#define MAX_TRIES    3
#define RETRY_SECONDS 10.0

#define TASK_SAVE    1000
#define TASK_FX      2000
#define TASK_RETRY   3000
#define TASK_RUN     4000
#define TASK_MINUTE  4001

// smak_event (smak_core.inc) is optional: an older smak_core without it makes smak_say() fall back to chat.
public event_native_filter(const name[], index, trap)
{
	if (!trap && equal(name, "smak_event", 10)) return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
}

// ---- the SQL. One statement per macro, so test-skills-sql.mjs can run them against a real SQLite. -----------------
// %s is a text already passed through sql_quote() (inside '...'), %d an integer. The skill names in Q_UPSERT are
// SK_NAME below, in order.
#define Q_CREATE_SKILLS "CREATE TABLE IF NOT EXISTS skills (ident TEXT NOT NULL, skill TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ident, skill))"
#define Q_SELECT        "SELECT skill, xp FROM skills WHERE ident = '%s'"
#define Q_UPSERT        "INSERT OR REPLACE INTO skills (ident, skill, xp) VALUES ('%s','punteria',%d),('%s','cuerpo',%d),('%s','atletismo',%d),('%s','resistencia',%d)"

new const SK_NAME[NSK][] = { "punteria", "cuerpo", "atletismo", "resistencia" };
new const SK_SHOW[NSK][] = { "Punteria", "Cuerpo a cuerpo", "Atletismo", "Resistencia" };

enum
{
	ST_NONE = 0,     // not loaded yet
	ST_LOADING,
	ST_SAVED,        // skills of a saved character
	ST_SESSION       // guest, or load failed: kept for the session, never written
}

new g_state[MAXPL], g_gen[MAXPL], g_tries[MAXPL];
new g_xp[MAXPL][NSK];
new g_minute[MAXPL][NSK];         // XP gained from events in the current minute
new g_pair[MAXPL][MAXPL];         // XP an attacker got from one victim this minute (punteria + cuerpo)
new bool:g_dirty[MAXPL];
new g_ident[MAXPL][96];
new g_hpbonus[MAXPL];             // health bonus already added since the last spawn
new Float:g_last[MAXPL][3];
new bool:g_haslast[MAXPL];
new g_dist[MAXPL];                // distance not yet turned into XP
new g_maxplayers;
new bool:g_dbok;
new Handle:g_tuple = Empty_Handle;
new g_pCap, g_pPairCap, g_pBots, g_pTeam, g_pHp, g_pRun, g_pDebug, g_pNotify;

// ---- helpers ------------------------------------------------------------------------------------------------------

stock bool:valid_id(id)
{
	return id >= 1 && id <= g_maxplayers;
}

stock bool:ready(id)
{
	return valid_id(id) && (g_state[id] == ST_SAVED || g_state[id] == ST_SESSION);
}

sql_quote(const src[], dst[], len)
{
	new j = 0;
	for (new i = 0; src[i] && j < len - 2; i++)
	{
		new c = src[i];
		if (c < 32 || c == '%') continue;
		if (c == 39) dst[j++] = 39;
		dst[j++] = c;
	}
	dst[j] = 0;
}

// Level for an amount of experience: the largest L (0..MAX_LEVEL) with XP_UNIT * L * L <= xp.
level_of(xp)
{
	new l = 0;
	while (l < MAX_LEVEL && xp >= XP_UNIT * (l + 1) * (l + 1)) l++;
	return l;
}

skill_find(const name[])
{
	for (new s = 0; s < NSK; s++)
	{
		if (equali(name, SK_NAME[s])) return s;
	}
	if (equali(name, "aim")) return SK_PUNTERIA;
	if (equali(name, "melee")) return SK_CUERPO;
	if (equali(name, "athletics")) return SK_ATLETISMO;
	if (equali(name, "endurance") || equali(name, "resistance")) return SK_RESIST;
	if (is_str_num(name))
	{
		new n = str_to_num(name);
		if (n >= 0 && n < NSK) return n;
	}
	return -1;
}

// ---- database -----------------------------------------------------------------------------------------------------

setup_db()
{
	g_dbok = false;
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_skills] ERROR: no sqlite driver. Skills last the session only.");
		return;
	}
	new datadir[96], dir[128];
	get_datadir(datadir, charsmax(datadir));
	formatex(dir, charsmax(dir), "%s/sqlite3", datadir);
	if (!dir_exists(dir)) mkdir(dir);

	g_tuple = SQL_MakeDbTuple("", "", "", DB_NAME);
	new err[256], errcode;
	new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
	if (db == Empty_Handle)
	{
		log_amx("[smak_skills] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}
	new Handle:h = SQL_PrepareQuery(db, "%s", Q_CREATE_SKILLS);
	if (SQL_Execute(h)) g_dbok = true;
	else
	{
		SQL_QueryError(h, err, charsmax(err));
		log_amx("[smak_skills] ERROR: cannot create table skills: %s", err);
	}
	SQL_FreeHandle(h);
	SQL_FreeHandle(db);
}

build_upsert(id, q[], len)
{
	new qi[200];
	sql_quote(g_ident[id], qi, charsmax(qi));
	formatex(q, len, Q_UPSERT, qi, g_xp[id][0], qi, g_xp[id][1], qi, g_xp[id][2], qi, g_xp[id][3]);
}

save_async(id)
{
	if (g_state[id] != ST_SAVED || !g_dbok || g_tuple == Empty_Handle) return;
	new q[700];
	build_upsert(id, q, charsmax(q));
	g_dirty[id] = false;
	new data[1];
	data[0] = id;
	SQL_ThreadQuery(g_tuple, "th_save", q, data, 1);
}

public th_save(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate == TQUERY_SUCCESS) return;
	log_amx("[smak_skills] SAVE FAILED for slot %d: %s", data[0], error);
	if (valid_id(data[0]) && g_state[data[0]] == ST_SAVED) mark_dirty(data[0]);
}

mark_dirty(id)
{
	g_dirty[id] = true;
	if (g_state[id] == ST_SAVED && !task_exists(id + TASK_SAVE)) set_task(SAVE_DELAY, "task_save", id + TASK_SAVE);
}

public task_save(taskid)
{
	new id = taskid - TASK_SAVE;
	if (valid_id(id) && g_dirty[id]) save_async(id);
}

// ---- loading ------------------------------------------------------------------------------------------------------

clear_player(id)
{
	g_state[id] = ST_NONE;
	g_gen[id]++;
	g_tries[id] = 0;
	g_dirty[id] = false;
	g_ident[id][0] = 0;
	g_hpbonus[id] = 0;
	g_haslast[id] = false;
	g_dist[id] = 0;
	for (new s = 0; s < NSK; s++)
	{
		g_xp[id][s] = 0;
		g_minute[id][s] = 0;
	}
	for (new v = 0; v < MAXPL; v++)
	{
		g_pair[id][v] = 0;
		g_pair[v][id] = 0;
	}
}

drop_player(id)
{
	if (!valid_id(id)) return;
	remove_task(id + TASK_SAVE);
	remove_task(id + TASK_FX);
	remove_task(id + TASK_RETRY);
	if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);      // the query keeps its own copy of the values
	clear_player(id);
}

// Called by smak_core once the character is usable (loaded, or a guest). Also at plugin start for players already in.
begin_load(id)
{
	if (!valid_id(id) || !is_user_connected(id)) return;
	clear_player(id);
	if (smak_char_guest(id) || !g_dbok)
	{
		session_only(id, smak_char_guest(id) ? "guest" : "no database");
		return;
	}
	smak_char_ident(id, g_ident[id], charsmax(g_ident[]));
	if (!g_ident[id][0])
	{
		session_only(id, "no identity");
		return;
	}
	g_state[id] = ST_LOADING;
	send_select(id);
}

session_only(id, const why[])
{
	g_state[id] = ST_SESSION;
	g_ident[id][0] = 0;
	if (get_pcvar_num(g_pDebug)) log_amx("[smak_skills] slot %d: skills for the session only (%s)", id, why);
	loaded(id);
}

send_select(id)
{
	new qi[200], q[300];
	sql_quote(g_ident[id], qi, charsmax(qi));
	formatex(q, charsmax(q), Q_SELECT, qi);
	new data[2];
	data[0] = id; data[1] = g_gen[id];
	SQL_ThreadQuery(g_tuple, "th_select", q, data, 2);
}

public th_select(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	new id = data[0];
	if (!valid_id(id) || g_gen[id] != data[1] || g_state[id] != ST_LOADING) return;      // the slot moved on
	if (failstate != TQUERY_SUCCESS)
	{
		log_amx("[smak_skills] load failed for slot %d (try %d): %s", id, g_tries[id] + 1, error);
		if (++g_tries[id] >= MAX_TRIES)
		{
			// never save over what we could not read
			session_only(id, "load failed");
			client_print(id, print_chat, "[SMAK] No se pudieron cargar tus habilidades: esta sesion no se guardaran.");
		}
		else set_task(RETRY_SECONDS, "task_retry", id + TASK_RETRY);
		return;
	}
	new name[32];
	while (SQL_MoreResults(query))
	{
		SQL_ReadResult(query, 0, name, charsmax(name));
		new s = skill_find(name);
		if (s >= 0) g_xp[id][s] = clamp(SQL_ReadResult(query, 1), 0, XP_MAX);      // unknown skills in the table are ignored
		SQL_NextRow(query);
	}
	g_state[id] = ST_SAVED;
	if (get_pcvar_num(g_pDebug))
		log_amx("[smak_skills] slot %d loaded: %d/%d/%d/%d xp (%s) in %.3fs", id, g_xp[id][0], g_xp[id][1], g_xp[id][2], g_xp[id][3], g_ident[id], queuetime);
	loaded(id);
}

public task_retry(taskid)
{
	new id = taskid - TASK_RETRY;
	if (valid_id(id) && g_state[id] == ST_LOADING && is_user_connected(id)) send_select(id);
}

loaded(id)
{
	apply_hp(id);
}

// smak_core can announce the character (a guest above all) from client_authorized, before the player is in the
// server, when begin_load turns it away; so the player is taken again here (smak_core is earlier in plugins.ini).
public client_putinserver(id)
{
	if (smak_char_loaded(id)) begin_load(id);
}

public smak_char_loaded_fw(id)
{
	begin_load(id);
}

// ---- effects ------------------------------------------------------------------------------------------------------

// resistencia: +hp_per_level health per level. Adds only the difference since the last spawn, so it can be called at
// load, at level up and at spawn without stacking.
apply_hp(id)
{
	if (!ready(id) || !is_user_alive(id)) return;
	new bonus = level_of(g_xp[id][SK_RESIST]) * get_pcvar_num(g_pHp);
	new delta = bonus - g_hpbonus[id];
	if (delta == 0) return;
	new Float:hp;
	pev(id, pev_health, hp);
	hp += float(delta);
	if (hp < 1.0) hp = 1.0;
	set_pev(id, pev_health, hp);
	set_pev(id, pev_max_health, 100.0 + float(bonus));
	g_hpbonus[id] = bonus;
}

public fw_spawn(id)
{
	if (!is_user_alive(id)) return HAM_IGNORED;
	g_hpbonus[id] = 0;
	g_haslast[id] = false;
	remove_task(id + TASK_FX);
	set_task(0.4, "task_fx", id + TASK_FX);      // after TS has set the health of the new life
	return HAM_IGNORED;
}

public task_fx(taskid)
{
	apply_hp(taskid - TASK_FX);
}

// ---- experience ---------------------------------------------------------------------------------------------------

// Add xp to a skill. capped: respect the per-minute cap (events); false for a script or an admin. pair: the other
// player of an attacker/victim event (0 for none). Returns the XP really given.
add_xp(id, s, amount, bool:capped, pair)
{
	if (!ready(id) || amount <= 0) return 0;
	if (capped)
	{
		new room = get_pcvar_num(g_pCap) - g_minute[id][s];
		if (s == SK_ATLETISMO) room = min(room, get_pcvar_num(g_pCap) / 3);
		if (pair)
		{
			room = min(room, get_pcvar_num(g_pPairCap) - g_pair[id][pair]);
		}
		if (room <= 0) return 0;
		if (amount > room) amount = room;
		g_minute[id][s] += amount;
		if (pair) g_pair[id][pair] += amount;
	}
	new old = level_of(g_xp[id][s]);
	g_xp[id][s] = min(XP_MAX, g_xp[id][s] + amount);
	new lvl = level_of(g_xp[id][s]);
	if (get_pcvar_num(g_pDebug)) log_amx("[smak_skills] slot %d %s +%d = %d xp (level %d)", id, SK_NAME[s], amount, g_xp[id][s], lvl);
	if (g_state[id] == ST_SAVED) mark_dirty(id);
	if (lvl > old)
	{
		if (get_pcvar_num(g_pNotify))
		{
			smak_say(id, EV_JOB, "Habilidad %s: nivel %d", SK_SHOW[s], lvl);
		}
		if (s == SK_RESIST) apply_hp(id);
	}
	return amount;
}

public task_minute()
{
	for (new a = 1; a <= g_maxplayers; a++)
	{
		for (new s = 0; s < NSK; s++) g_minute[a][s] = 0;
		for (new v = 1; v <= g_maxplayers; v++) g_pair[a][v] = 0;
	}
}

// A player's damage to another player, after the game applied it.
public fw_hurt(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (damage <= 0.0 || victim == attacker) return HAM_IGNORED;
	if (!valid_id(attacker) || !valid_id(victim) || inflictor != attacker) return HAM_IGNORED;
	if (!ready(attacker) && !ready(victim)) return HAM_IGNORED;
	if (!get_pcvar_num(g_pBots) && (is_user_bot(attacker) || is_user_bot(victim))) return HAM_IGNORED;
	if (!is_user_connected(attacker) || !is_user_alive(attacker)) return HAM_IGNORED;
	if (get_pcvar_num(g_pTeam))
	{
		new ta = get_user_team(attacker), tv = get_user_team(victim);
		if (ta != 0 && ta == tv) return HAM_IGNORED;
	}
	new dmg = floatround(damage);

	// the attacker: what was he holding?
	new wpn = ts_getuserwpn(attacker);
	new s = SK_PUNTERIA;
	switch (wpn)
	{
		case TSW_KUNG_FU, TSW_CKNIFE, TSW_SKNIFE, TSW_TKNIFE, TSW_KATANA: s = SK_CUERPO;
		case TSW_M61GRENADE, TSW_C4: s = -1;      // thrown or planted: not aim
	}
	if (s >= 0) add_xp(attacker, s, clamp(dmg / 8, 1, 10), true, victim);

	// the victim: damage taken and survived (alive after the hit)
	if (is_user_alive(victim)) add_xp(victim, SK_RESIST, clamp(dmg / 10, 1, 6), true, attacker);
	return HAM_IGNORED;
}

// atletismo: horizontal distance on foot, sampled every RUN_SECONDS. A jump of more than 1500 units in one sample
// (a teleport, a mission) and a player in the air do not count.
public task_run()
{
	if (!get_pcvar_num(g_pRun)) return;
	new Float:o[3];
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (!ready(id) || !is_user_alive(id) || (is_user_bot(id) && !get_pcvar_num(g_pBots)))
		{
			g_haslast[id] = false;
			continue;
		}
		pev(id, pev_origin, o);
		if (g_haslast[id] && (pev(id, pev_flags) & FL_ONGROUND))
		{
			new Float:dx = o[0] - g_last[id][0], Float:dy = o[1] - g_last[id][1];
			new d = floatround(floatsqroot(dx * dx + dy * dy));
			if (d >= 40 && d <= 1500)
			{
				g_dist[id] += d;
				if (g_dist[id] >= 100)
				{
					new xp = g_dist[id] / 100;      // 1 XP per 100 units
					g_dist[id] -= xp * 100;
					add_xp(id, SK_ATLETISMO, xp, true, 0);
				}
			}
		}
		g_last[id][0] = o[0]; g_last[id][1] = o[1]; g_last[id][2] = o[2];
		g_haslast[id] = true;
	}
}

// ---- commands -----------------------------------------------------------------------------------------------------

show_skills(id)
{
	if (!ready(id))
	{
		client_print(id, print_chat, "[SMAK] Tus habilidades aun se estan cargando, espera un momento.");
		return;
	}
	client_print(id, print_chat, "[SMAK] Habilidades%s:", g_state[id] == ST_SESSION ? " (solo esta sesion, no se guardan)" : "");
	for (new s = 0; s < NSK; s++)
	{
		new xp = g_xp[id][s], lvl = level_of(xp);
		new bar[11], filled = 0;
		if (lvl >= MAX_LEVEL) filled = 10;
		else
		{
			new from = XP_UNIT * lvl * lvl, to = XP_UNIT * (lvl + 1) * (lvl + 1);
			filled = (xp - from) * 10 / (to - from);
		}
		for (new i = 0; i < 10; i++) bar[i] = i < filled ? '#' : '-';
		bar[10] = 0;
		if (lvl >= MAX_LEVEL) client_print(id, print_chat, "[SMAK] %s: nivel %d (maximo) [%s] %d xp", SK_SHOW[s], lvl, bar, xp);
		else client_print(id, print_chat, "[SMAK] %s: nivel %d [%s] %d/%d xp", SK_SHOW[s], lvl, bar, xp, XP_UNIT * (lvl + 1) * (lvl + 1));
	}
}

public cmd_skills(id)
{
	show_skills(id);
	return PLUGIN_HANDLED;
}

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/habilidades") || equali(a, "/skills"))
	{
		show_skills(id);
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}

bool:can_admin(id)
{
	if (id == 0) return true;
	if (get_user_flags(id) & ADMIN_RCON) return true;
	new p = get_cvar_pointer("smak_core_dev");      // the listen-server host, for testing, as in smak_core
	return p && get_pcvar_num(p) && !is_dedicated_server() && id == 1;
}

public cmd_give_xp(id)
{
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] smak_give_xp: needs ADMIN_RCON (or the listen-server host with smak_core_dev 1)");
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 4)
	{
		console_print(id, "[SMAK] usage: smak_give_xp <name|#userid> <punteria|cuerpo|atletismo|resistencia> <amount>");
		return PLUGIN_HANDLED;
	}
	new who[48], sk[32], num[16];
	read_argv(1, who, charsmax(who));
	read_argv(2, sk, charsmax(sk));
	read_argv(3, num, charsmax(num));
	new s = skill_find(sk);
	if (s < 0)
	{
		console_print(id, "[SMAK] smak_give_xp: unknown skill '%s'", sk);
		return PLUGIN_HANDLED;
	}
	if (!is_str_num(num) || strlen(num) > 6 || str_to_num(num) < 1 || str_to_num(num) > XP_MAX)
	{
		console_print(id, "[SMAK] smak_give_xp: the amount must be a whole number from 1 to %d", XP_MAX);
		return PLUGIN_HANDLED;
	}
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF | CMDTARGET_NO_BOTS);
	if (!target) return PLUGIN_HANDLED;
	if (!ready(target))
	{
		console_print(id, "[SMAK] smak_give_xp: that player's skills are not loaded yet");
		return PLUGIN_HANDLED;
	}
	add_xp(target, s, str_to_num(num), false, 0);
	new tname[48];
	get_user_name(target, tname, charsmax(tname));
	console_print(id, "[SMAK] smak_give_xp: %s now has %d xp in %s (level %d)", tname, g_xp[target][s], SK_NAME[s], level_of(g_xp[target][s]));
	return PLUGIN_HANDLED;
}

// ---- natives ------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	set_native_filter("event_native_filter");
	register_library("smak_skills");
	register_native("smak_give_xp", "_give_xp");
	register_native("smak_skill_level", "_skill_level");
	register_native("smak_skill_xp", "_skill_xp");
}

public bool:_give_xp(plugin, params)
{
	new id = get_param(1), name[32];
	get_string(2, name, charsmax(name));
	new amount = get_param(3);
	new s = skill_find(name);
	if (s < 0 || amount < 1 || amount > XP_MAX || !ready(id)) return false;
	add_xp(id, s, amount, false, 0);
	return true;
}

public _skill_level(plugin, params)
{
	new id = get_param(1), name[32];
	get_string(2, name, charsmax(name));
	new s = skill_find(name);
	if (s < 0 || !ready(id)) return -1;
	return level_of(g_xp[id][s]);
}

public _skill_xp(plugin, params)
{
	new id = get_param(1), name[32];
	get_string(2, name, charsmax(name));
	new s = skill_find(name);
	if (s < 0 || !ready(id)) return -1;
	return g_xp[id][s];
}

// ---- plugin -------------------------------------------------------------------------------------------------------

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();

	g_pCap = create_cvar("smak_skills_cap", "150", FCVAR_NONE, "most XP a skill gains from events in one minute (atletismo: a third of it)");
	g_pPairCap = create_cvar("smak_skills_pair_cap", "60", FCVAR_NONE, "most XP one attacker gets from one victim in one minute");
	g_pBots = create_cvar("smak_skills_bots", "0", FCVAR_NONE, "1: damage to or from bots counts");
	g_pTeam = create_cvar("smak_skills_teamcheck", "1", FCVAR_NONE, "1: damage between players of the same (non-zero) team does not count");
	g_pHp = create_cvar("smak_skills_hp_per_level", "2", FCVAR_NONE, "health per level of resistencia, added after spawn");
	g_pRun = create_cvar("smak_skills_run", "1", FCVAR_NONE, "1: distance run on foot gives atletismo");
	g_pNotify = create_cvar("smak_skills_notify", "1", FCVAR_NONE, "1: tell the player in chat when a skill levels up");
	g_pDebug = create_cvar("smak_skills_debug", "0", FCVAR_NONE, "1: log every XP gain and load");

	RegisterHamPlayer(Ham_TakeDamage, "fw_hurt", 1);
	RegisterHamPlayer(Ham_Spawn, "fw_spawn", 1);
	register_forward(FM_ClientDisconnect, "fw_disconnect");

	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_clcmd("smak_skills", "cmd_skills");
	register_concmd("smak_give_xp", "cmd_give_xp", ADMIN_ALL, "<name|#userid> <skill> <amount> -- give experience (ADMIN_RCON)");
}

public plugin_cfg()
{
	setup_db();
	// players already loaded by smak_core before this plugin started
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (is_user_connected(id) && smak_char_loaded(id)) begin_load(id);
	}
	set_task(RUN_SECONDS, "task_run", TASK_RUN, _, _, "b");
	set_task(60.0, "task_minute", TASK_MINUTE, _, _, "b");
	log_amx("[smak_skills] %s started: db %s, cap %d/min, pair cap %d/min", VERSION, g_dbok ? "ok" : "unavailable", get_pcvar_num(g_pCap), get_pcvar_num(g_pPairCap));
}

public fw_disconnect(id)
{
	drop_player(id);
	return FMRES_IGNORED;
}

public client_disconnected(id)
{
	drop_player(id);
}

public plugin_end()
{
	if (g_tuple == Empty_Handle) return;
	new bool:any = false;
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == ST_SAVED && g_dirty[id]) any = true;
	}
	if (any && g_dbok)
	{
		new err[256], errcode;
		new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
		if (db == Empty_Handle) log_amx("[smak_skills] plugin_end: cannot open the database (%d: %s); skills not saved", errcode, err);
		else
		{
			new q[700];
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] != ST_SAVED || !g_dirty[id]) continue;
				build_upsert(id, q, charsmax(q));
				new Handle:h = SQL_PrepareQuery(db, "%s", q);
				if (!SQL_Execute(h))
				{
					SQL_QueryError(h, err, charsmax(err));
					log_amx("[smak_skills] SAVE FAILED at map end for slot %d: %s", id, err);
				}
				SQL_FreeHandle(h);
			}
			SQL_FreeHandle(db);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}
