/*
 * smak_law.sma -- a wanted level (0..5) and fines for the pseudo-MSC RP server. Needs smak_core.amxx (listed before
 * it in plugins.ini): the character's identity comes from smak_char_ident and the fines from smak_money_take.
 *
 * Offences (human or bot players only; never suicide, the world, or a victim who is already wanted: hunting a
 * wanted player is lawful):
 *   - killing a player (Ham_Killed, post)         + smak_law_kill_levels   (default 2)
 *   - hurting players (Ham_TakeDamage, post)      +1 for each smak_law_hurt_damage points of damage dealt
 *                                                  (default 150), but hurting alone never takes the level past
 *                                                  smak_law_hurt_max (default 2)
 * Each level added puts smak_law_fine_level (default 100) on the fine the character owes. Every
 * smak_law_decay_min minutes (default 5) without a new offence the level drops by one; at 0 the fine is forgiven.
 * Time counts while the player is away too (the record keeps the time of the last offence).
 *
 * Dying while wanted: the fine is taken from the money (as much as there is: money_take "fine:death"), the level
 * and the fine are cleared, the player is told.
 *
 * Police station: configs/smak_rp/<map>.law.json (format "smak-law/1", levels/rp/law.mjs checks it offline), a list
 * of stations { id, name, origin [x,y,z], radius }. Near one, /multa pays the fine in full (money_take "fine:paid")
 * and clears the level. /buscado shows the level and the fine anywhere.
 *
 * Not an offence: anything done by or to a player inside a smak_rp mission arena (smak_rp_in_arena, optional).
 *
 * Persistence: table law_wanted(ident, level, fine, updated) in data/sqlite3/smak_rp.sq3 (the file smak_core uses;
 * this plugin touches only its own table). `updated` is the unix time of the last offence. Guests (and a player
 * whose load failed) keep the record for the session and it is never saved. Saves are threaded queries.
 * Cost: no per-frame work. One Ham post hook on damage and on death, one 2 s HUD task, one 60 s sweep.
 *
 * Natives: levels/rp/plugin/include/smak_law.inc. Console: smak_wanted <name|#userid> <level 0..5> (ADMIN_RCON, or
 * the host of a listen server with smak_law_dev 1).
 */

#define SMAK_LAW_PLUGIN
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <sqlx>
#include <json>
#include <smak_core>
#include <smak_law>

#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

// smak_rp (optional, through the native filter): true while a player is in a mission's arena.
native smak_rp_in_arena(id);

#define PLUGIN  "SMAK law"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define DB_NAME       "smak_rp"
#define MAXPL         33
#define MAX_STATIONS  8
#define ID_LEN        32
#define NAME_LEN      48
#define FINE_MAX      1000000
#define LAW_FORMAT    "smak-law/1"

#define SAVE_DELAY    5.0
#define SWEEP_SECONDS 60.0
#define HUD_SECONDS   2.0
#define MAX_TRIES     3
#define RETRY_SECONDS 10.0

#define TASK_SAVE     1000
#define TASK_RETRY    2000
#define TASK_SWEEP    3000
#define TASK_HUD      3001

// ---- the SQL. One statement per macro, so test-law-sql.mjs can run them against a real SQLite. ---------------------
// %s is a text already passed through sql_quote() (inside '...'), %d an integer.
#define Q_CREATE_LAW "CREATE TABLE IF NOT EXISTS law_wanted (ident TEXT NOT NULL PRIMARY KEY, level INTEGER NOT NULL DEFAULT 0, fine INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)"
#define Q_SELECT     "SELECT level, fine, updated FROM law_wanted WHERE ident = '%s'"
#define Q_UPSERT     "INSERT OR REPLACE INTO law_wanted (ident, level, fine, updated) VALUES ('%s',%d,%d,%d)"

enum
{
	ST_NONE = 0,     // not loaded yet
	ST_LOADING,
	ST_SAVED,        // record of a saved character
	ST_SESSION       // guest, or load failed: kept for the session, never written
}

new g_state[MAXPL], g_gen[MAXPL], g_tries[MAXPL];
new g_level[MAXPL], g_fine[MAXPL], g_stamp[MAXPL];     // stamp: unix time of the last offence (or last decay)
new Float:g_hurt[MAXPL];                                // damage dealt to lawful victims, not yet turned into a level
new bool:g_dirty[MAXPL];
new g_ident[MAXPL][96];
new g_maxplayers;
new bool:g_dbok;
new Handle:g_tuple = Empty_Handle;
new g_sync;
new g_map[64];

new g_st_count;
new g_st_id[MAX_STATIONS][ID_LEN];
new g_st_name[MAX_STATIONS][NAME_LEN];
new Float:g_st_org[MAX_STATIONS][3];
new Float:g_st_rad[MAX_STATIONS];

new g_pKill, g_pHurtDmg, g_pHurtMax, g_pFineLevel, g_pDecay, g_pHud, g_pDev, g_pDebug;

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

currency(out[], len)
{
	if (!smak_currency(out, len)) copy(out, len, "creditos");
}

// "***--" for level 3 of 5
stars(level, out[], len)
{
	new n = 0;
	for (new i = 0; i < SMAK_LAW_MAX_LEVEL && n < len - 1; i++) out[n++] = (i < level) ? '*' : '-';
	out[n] = 0;
}

// ---- database -----------------------------------------------------------------------------------------------------

setup_db()
{
	g_dbok = false;
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_law] ERROR: no sqlite driver. Wanted levels last the session only.");
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
		log_amx("[smak_law] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}
	new Handle:h = SQL_PrepareQuery(db, "%s", Q_CREATE_LAW);
	if (SQL_Execute(h)) g_dbok = true;
	else
	{
		SQL_QueryError(h, err, charsmax(err));
		log_amx("[smak_law] ERROR: cannot create table law_wanted: %s", err);
	}
	SQL_FreeHandle(h);
	SQL_FreeHandle(db);
}

build_upsert(id, q[], len)
{
	new qi[200];
	sql_quote(g_ident[id], qi, charsmax(qi));
	formatex(q, len, Q_UPSERT, qi, g_level[id], g_fine[id], g_stamp[id]);
}

save_async(id)
{
	if (g_state[id] != ST_SAVED || !g_dbok || g_tuple == Empty_Handle) return;
	new q[400];
	build_upsert(id, q, charsmax(q));
	g_dirty[id] = false;
	new data[1];
	data[0] = id;
	SQL_ThreadQuery(g_tuple, "th_save", q, data, 1);
}

public th_save(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate == TQUERY_SUCCESS) return;
	log_amx("[smak_law] SAVE FAILED for slot %d: %s", data[0], error);
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
	g_level[id] = 0;
	g_fine[id] = 0;
	g_stamp[id] = 0;
	g_hurt[id] = 0.0;
}

// Forget a player. Idempotent: FM_ClientDisconnect, client_disconnected and the sweep all call it.
law_drop(id)
{
	if (!valid_id(id) || g_state[id] == ST_NONE) return;
	remove_task(id + TASK_SAVE);
	remove_task(id + TASK_RETRY);
	if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);      // the query keeps its own copy of the values
	clear_player(id);
}

// Takes the player once his character is usable. Does nothing when he is already taken (it may be called from
// smak_char_loaded_fw, client_putinserver and plugin_cfg for the same player).
begin_load(id)
{
	if (!valid_id(id) || !is_user_connected(id) || g_state[id] != ST_NONE) return;
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
	if (get_pcvar_num(g_pDebug)) log_amx("[smak_law] slot %d: record for the session only (%s)", id, why);
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
		log_amx("[smak_law] load failed for slot %d (try %d): %s", id, g_tries[id] + 1, error);
		if (++g_tries[id] >= MAX_TRIES)
		{
			// never save over what we could not read
			session_only(id, "load failed");
			client_print(id, print_chat, "[SMAK] No se pudo cargar tu registro de buscado: esta sesion no se guardara.");
		}
		else set_task(RETRY_SECONDS, "task_retry", id + TASK_RETRY);
		return;
	}
	if (SQL_MoreResults(query))
	{
		g_level[id] = clamp(SQL_ReadResult(query, 0), 0, SMAK_LAW_MAX_LEVEL);
		g_fine[id] = clamp(SQL_ReadResult(query, 1), 0, FINE_MAX);
		g_stamp[id] = SQL_ReadResult(query, 2);
	}
	g_state[id] = ST_SAVED;
	if (g_level[id] > 0)
	{
		// the time away counts: one level for each full decay period since the last offence
		new period = max(1, get_pcvar_num(g_pDecay)) * 60;
		new drop = (get_systime() - g_stamp[id]) / period;
		if (g_stamp[id] > 0 && drop > 0)
		{
			set_level(id, g_level[id] - drop, false);
			g_stamp[id] = get_systime();
		}
	}
	if (get_pcvar_num(g_pDebug))
		log_amx("[smak_law] slot %d loaded: level %d fine %d (%s) in %.3fs", id, g_level[id], g_fine[id], g_ident[id], queuetime);
	if (g_level[id] > 0)
		client_print(id, print_chat, "[SMAK] Eres buscado: nivel %d. Escribe /buscado para ver tu multa.", g_level[id]);
}

public task_retry(taskid)
{
	new id = taskid - TASK_RETRY;
	if (valid_id(id) && g_state[id] == ST_LOADING && is_user_connected(id)) send_select(id);
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

public fw_disconnect(id)
{
	law_drop(id);
	return FMRES_IGNORED;
}

public client_disconnected(id)
{
	law_drop(id);
}

// ---- the record ---------------------------------------------------------------------------------------------------

// Set the level (0..max). At 0 the fine is forgiven (decay, admin) unless keepfine.
set_level(id, level, bool:keepfine)
{
	g_level[id] = clamp(level, 0, SMAK_LAW_MAX_LEVEL);
	if (g_level[id] == 0 && !keepfine) g_fine[id] = 0;
	mark_dirty(id);
}

// An offence: raise the level and the fine, restart the countdown, tell the player.
offence(id, levels, const reason[])
{
	if (!ready(id) || levels <= 0) return;
	new before = g_level[id];
	g_level[id] = min(SMAK_LAW_MAX_LEVEL, g_level[id] + levels);
	g_fine[id] = min(FINE_MAX, g_fine[id] + levels * max(0, get_pcvar_num(g_pFineLevel)));
	g_stamp[id] = get_systime();
	mark_dirty(id);
	new cur[32], st[8];
	currency(cur, charsmax(cur));
	stars(g_level[id], st, charsmax(st));
	client_print(id, print_chat, "[SMAK] Buscado por la ley (%s): nivel %d [%s]. Multa pendiente: %d %s.", reason, g_level[id], st, g_fine[id], cur);
	log_amx("[smak_law] slot %d: +%d level(s) for %s, now level %d fine %d (was level %d)", id, levels, reason, g_level[id], g_fine[id], before);
}

public task_sweep()
{
	new now = get_systime();
	new period = max(1, get_pcvar_num(g_pDecay)) * 60;
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == ST_NONE) continue;
		if (!is_user_connected(id))
		{
			log_amx("[smak_law] sweep: slot %d is gone and no disconnect hook ran; dropping it now", id);
			law_drop(id);
			continue;
		}
		if (!ready(id)) continue;
		if (g_level[id] > 0 && now - g_stamp[id] >= period)
		{
			set_level(id, g_level[id] - 1, false);
			g_stamp[id] = now;
			if (g_level[id] == 0) client_print(id, print_chat, "[SMAK] Ya no eres buscado. La multa queda perdonada.");
			else client_print(id, print_chat, "[SMAK] La ley te busca menos: nivel %d.", g_level[id]);
		}
		if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);      // only what changed
	}
}

public task_hud()
{
	if (!get_pcvar_num(g_pHud)) return;
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (!ready(id) || g_level[id] <= 0 || !is_user_alive(id)) continue;
		new st[8];
		stars(g_level[id], st, charsmax(st));
		set_hudmessage(255, 70, 50, 0.02, 0.55, 0, 0.0, HUD_SECONDS + 0.5, 0.0, 0.0, -1);
		ShowSyncHudMsg(id, g_sync, "BUSCADO [%s]  multa %d", st, g_fine[id]);
	}
}

// ---- offences: death and damage -----------------------------------------------------------------------------------

// attacker and victim are two different players who both have a record, and the victim is not wanted
bool:unlawful(victim, attacker)
{
	if (attacker < 1 || attacker > g_maxplayers || attacker == victim) return false;
	if (!ready(attacker) || !ready(victim)) return false;
	if (in_arena(attacker) || in_arena(victim)) return false;     // a mission's fight is not a crime
	return g_level[victim] == 0;
}

bool:in_arena(id)
{
	if (!LibraryExists("smak_rp", LibType_Library)) return false;
	return smak_rp_in_arena(id) != 0;
}

public fw_killed(victim, attacker, shouldgib)
{
	if (!valid_id(victim) || !ready(victim)) return HAM_IGNORED;
	if (unlawful(victim, attacker))
	{
		g_hurt[attacker] = 0.0;
		offence(attacker, max(1, get_pcvar_num(g_pKill)), "homicidio");
	}
	if (g_level[victim] > 0)
	{
		new owed = g_fine[victim];
		new pay = min(owed, smak_money_get(victim));
		new cur[32];
		currency(cur, charsmax(cur));
		if (pay > 0 && smak_money_take(victim, pay, "fine:death"))
		{
			client_print(victim, print_chat, "[SMAK] Moriste siendo buscado: te cobran %d de %d %s de multa. Quedas limpio.", pay, owed, cur);
			log_amx("[smak_law] slot %d died wanted: fine %d of %d taken", victim, pay, owed);
		}
		else
		{
			client_print(victim, print_chat, "[SMAK] Moriste siendo buscado: no tenias dinero para la multa. Quedas limpio.");
			log_amx("[smak_law] slot %d died wanted: fine %d, nothing taken", victim, owed);
		}
		g_fine[victim] = 0;
		set_level(victim, 0, false);
	}
	g_hurt[victim] = 0.0;
	return HAM_IGNORED;
}

public fw_damage(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (damage <= 0.0 || !is_user_alive(victim)) return HAM_IGNORED;      // a killing blow is the death's business
	if (!unlawful(victim, attacker)) return HAM_IGNORED;
	if (g_level[attacker] >= get_pcvar_num(g_pHurtMax)) return HAM_IGNORED;
	g_hurt[attacker] += damage;
	new Float:need = float(max(1, get_pcvar_num(g_pHurtDmg)));
	if (g_hurt[attacker] >= need)
	{
		g_hurt[attacker] = 0.0;
		offence(attacker, 1, "agresion");
	}
	return HAM_IGNORED;
}

// ---- stations and commands ----------------------------------------------------------------------------------------

load_stations()
{
	g_st_count = 0;
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.law.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_law] no %s: this map has no police station (/multa will not work)", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_law] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[32];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, LAW_FORMAT))
	{
		log_amx("[smak_law] ERROR: %s has format ^"%s^", not ^"%s^": refused", path, text, LAW_FORMAT);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "stations");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && g_st_count < MAX_STATIONS; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new s = g_st_count;
			g_st_id[s][0] = 0;
			g_st_name[s][0] = 0;
			json_object_get_string(one, "id", g_st_id[s], ID_LEN - 1);
			json_object_get_string(one, "name", g_st_name[s], NAME_LEN - 1);
			g_st_rad[s] = json_object_get_real(one, "radius");
			new JSON:at = json_object_get_value(one, "origin");
			new bool:placed = false;
			if (at != Invalid_JSON)
			{
				if (json_is_array(at) && json_array_get_count(at) >= 3)
				{
					g_st_org[s][0] = json_array_get_real(at, 0);
					g_st_org[s][1] = json_array_get_real(at, 1);
					g_st_org[s][2] = json_array_get_real(at, 2);
					placed = true;
				}
				json_free(at);
			}
			json_free(one);
			if (!g_st_id[s][0] || !placed || g_st_rad[s] <= 0.0)
			{
				log_amx("[smak_law] station %d has no id, no origin or no radius: left out", i + 1);
				continue;
			}
			g_st_count++;
			log_amx("[smak_law] station %s ^"%s^" at %.0f %.0f %.0f radius %.0f", g_st_id[s], g_st_name[s], g_st_org[s][0], g_st_org[s][1], g_st_org[s][2], g_st_rad[s]);
		}
		json_free(list);
	}
	json_free(root);
}

near_station(id)
{
	new Float:org[3];
	pev(id, pev_origin, org);
	for (new s = 0; s < g_st_count; s++)
	{
		if (get_distance_f(org, g_st_org[s]) <= g_st_rad[s]) return s;
	}
	return -1;
}

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/multa") || equali(a, "/fine"))
	{
		pay_fine(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/buscado") || equali(a, "/wanted"))
	{
		show_wanted(id);
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}

show_wanted(id)
{
	if (!ready(id))
	{
		client_print(id, print_chat, "[SMAK] Tu registro aun se esta cargando, espera un momento.");
		return;
	}
	if (g_level[id] <= 0)
	{
		client_print(id, print_chat, "[SMAK] No eres buscado.");
		return;
	}
	new cur[32], st[8];
	currency(cur, charsmax(cur));
	stars(g_level[id], st, charsmax(st));
	new left = max(0, max(1, get_pcvar_num(g_pDecay)) * 60 - (get_systime() - g_stamp[id]));
	client_print(id, print_chat, "[SMAK] Buscado nivel %d [%s]. Multa: %d %s. Bajas un nivel en %d s sin nuevos delitos. Paga con /multa en una comisaria.",
		g_level[id], st, g_fine[id], cur, left);
}

pay_fine(id)
{
	if (!ready(id))
	{
		client_print(id, print_chat, "[SMAK] Tu registro aun se esta cargando, espera un momento.");
		return;
	}
	if (g_level[id] <= 0 && g_fine[id] <= 0)
	{
		client_print(id, print_chat, "[SMAK] No tienes multas pendientes.");
		return;
	}
	if (near_station(id) == -1)
	{
		client_print(id, print_chat, "[SMAK] Debes estar en una comisaria para pagar la multa.");
		return;
	}
	new cur[32];
	currency(cur, charsmax(cur));
	new owed = g_fine[id];
	if (owed > 0)
	{
		if (smak_money_get(id) < owed)
		{
			client_print(id, print_chat, "[SMAK] No te alcanza: la multa es de %d %s y tienes %d.", owed, cur, smak_money_get(id));
			return;
		}
		if (!smak_money_take(id, owed, "fine:paid"))
		{
			client_print(id, print_chat, "[SMAK] No se pudo cobrar la multa, intentalo de nuevo.");
			return;
		}
	}
	g_fine[id] = 0;
	set_level(id, 0, false);
	client_print(id, print_chat, "[SMAK] Multa pagada (%d %s). Estas limpio.", owed, cur);
	log_amx("[smak_law] slot %d paid a fine of %d at a station", id, owed);
}

bool:can_admin(id)
{
	if (id == 0) return true;
	if (get_user_flags(id) & ADMIN_RCON) return true;
	return get_pcvar_num(g_pDev) && !is_dedicated_server() && id == 1;
}

public cmd_wanted(id)
{
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] smak_wanted: needs ADMIN_RCON (or the listen-server host with smak_law_dev 1)");
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 3)
	{
		console_print(id, "[SMAK] usage: smak_wanted <name|#userid> <level 0..%d>", SMAK_LAW_MAX_LEVEL);
		return PLUGIN_HANDLED;
	}
	new who[48], num[16];
	read_argv(1, who, charsmax(who));
	read_argv(2, num, charsmax(num));
	if (!is_str_num(num) || strlen(num) > 2 || str_to_num(num) > SMAK_LAW_MAX_LEVEL)
	{
		console_print(id, "[SMAK] smak_wanted: the level is a whole number from 0 to %d", SMAK_LAW_MAX_LEVEL);
		return PLUGIN_HANDLED;
	}
	new level = str_to_num(num);
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF);
	if (!target) return PLUGIN_HANDLED;
	if (!ready(target))
	{
		console_print(id, "[SMAK] smak_wanted: that player's record is not loaded yet");
		return PLUGIN_HANDLED;
	}
	g_hurt[target] = 0.0;
	if (level == 0)
	{
		g_fine[target] = 0;
		set_level(target, 0, false);
	}
	else
	{
		g_fine[target] = min(FINE_MAX, level * max(0, get_pcvar_num(g_pFineLevel)));
		g_stamp[target] = get_systime();
		set_level(target, level, true);
	}
	new name[32];
	get_user_name(target, name, charsmax(name));
	console_print(id, "[SMAK] smak_wanted: %s is now level %d, fine %d", name, g_level[target], g_fine[target]);
	log_amx("[smak_law] admin %d set slot %d (%s) to level %d fine %d", id, target, name, g_level[target], g_fine[target]);
	client_print(target, print_chat, "[SMAK] Un administrador fijo tu nivel de buscado en %d.", g_level[target]);
	return PLUGIN_HANDLED;
}

// ---- natives ------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	register_library("smak_law");
	register_native("smak_law_level", "_law_level");
	register_native("smak_law_add", "_law_add");
	register_native("smak_law_clear", "_law_clear");
	set_native_filter("native_filter");
}

public native_filter(const name[], index, trap)
{
	if (!trap) return PLUGIN_HANDLED;      // smak_rp_in_arena is optional: missing, in_arena() is never asked
	return PLUGIN_CONTINUE;
}

public _law_level(plugin, params)
{
	new id = get_param(1);
	if (!ready(id)) return 0;
	return g_level[id];
}

public bool:_law_add(plugin, params)
{
	new id = get_param(1), levels = get_param(2);
	new reason[64], src[64];
	get_string(3, reason, charsmax(reason));
	get_plugin(plugin, src, charsmax(src));
	if (!ready(id) || levels < 1 || levels > SMAK_LAW_MAX_LEVEL)
	{
		log_amx("[smak_law] smak_law_add(%d, %d, '%s') from %s refused: %s", id, levels, reason, src, levels < 1 || levels > SMAK_LAW_MAX_LEVEL ? "levels must be 1 to 5" : "record not usable");
		return false;
	}
	log_amx("[smak_law] smak_law_add from %s", src);
	offence(id, levels, reason);
	return true;
}

public bool:_law_clear(plugin, params)
{
	new id = get_param(1);
	new src[64];
	get_plugin(plugin, src, charsmax(src));
	if (!ready(id)) return false;
	g_fine[id] = 0;
	g_hurt[id] = 0.0;
	set_level(id, 0, false);
	log_amx("[smak_law] smak_law_clear(%d) from %s", id, src);
	return true;
}

// ---- plugin lifecycle ---------------------------------------------------------------------------------------------

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();
	get_mapname(g_map, charsmax(g_map));

	g_pKill = create_cvar("smak_law_kill_levels", "2", FCVAR_NONE, "wanted levels for killing a player who was not wanted");
	g_pHurtDmg = create_cvar("smak_law_hurt_damage", "150", FCVAR_NONE, "damage dealt to lawful players that adds one wanted level");
	g_pHurtMax = create_cvar("smak_law_hurt_max", "2", FCVAR_NONE, "level that hurting alone cannot pass (killing and scripts can)");
	g_pFineLevel = create_cvar("smak_law_fine_level", "100", FCVAR_NONE, "fine added for each wanted level gained");
	g_pDecay = create_cvar("smak_law_decay_min", "5", FCVAR_NONE, "minutes without an offence for the level to drop by one");
	g_pHud = create_cvar("smak_law_hud", "1", FCVAR_NONE, "1: show the stars on the HUD of a wanted player");
	g_pDev = create_cvar("smak_law_dev", "0", FCVAR_NONE, "1: the host of a listen server may use smak_wanted");
	g_pDebug = create_cvar("smak_law_debug", "0", FCVAR_NONE, "1: log loads");

	register_forward(FM_ClientDisconnect, "fw_disconnect");
	RegisterHamPlayer(Ham_Killed, "fw_killed", 1);
	RegisterHamPlayer(Ham_TakeDamage, "fw_damage", 1);
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_concmd("smak_wanted", "cmd_wanted", ADMIN_ALL, "<name|#userid> <level 0..5> -- set the wanted level (ADMIN_RCON)");
	g_sync = CreateHudSyncObj();
}

public plugin_cfg()
{
	load_stations();
	setup_db();
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (is_user_connected(id) && smak_char_loaded(id)) begin_load(id);       // started late: take the players already in
	}
	set_task(SWEEP_SECONDS, "task_sweep", TASK_SWEEP, _, _, "b");
	set_task(HUD_SECONDS, "task_hud", TASK_HUD, _, _, "b");
	log_amx("[smak_law] %s started: %d station(s), database %s", VERSION, g_st_count, g_dbok ? "ok" : "NOT available (session-only records)");
}

// map end: synchronous, like smak_core
public plugin_end()
{
	if (g_tuple == Empty_Handle) return;
	new bool:any = false;
	for (new id = 1; id <= g_maxplayers && !any; id++)
	{
		if (g_state[id] == ST_SAVED && g_dirty[id]) any = true;
	}
	if (any && g_dbok)
	{
		new err[256], errcode;
		new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
		if (db == Empty_Handle)
		{
			log_amx("[smak_law] plugin_end: cannot open the database (%d: %s); changed records not saved", errcode, err);
		}
		else
		{
			new saved = 0;
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] != ST_SAVED || !g_dirty[id]) continue;
				new q[400];
				build_upsert(id, q, charsmax(q));
				new Handle:h = SQL_PrepareQuery(db, "%s", q);
				if (SQL_Execute(h)) saved++;
				else
				{
					SQL_QueryError(h, err, charsmax(err));
					log_amx("[smak_law] plugin_end: save of %s failed: %s", g_ident[id], err);
				}
				SQL_FreeHandle(h);
			}
			SQL_FreeHandle(db);
			log_amx("[smak_law] plugin_end: %d changed record(s) saved", saved);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}
