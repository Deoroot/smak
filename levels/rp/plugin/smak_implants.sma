/*
 * smak_implants.sma -- cybernetic implants for the techno-Byzantine RP city. Needs smak_core.amxx (listed before it
 * in plugins.ini): the character's identity and the money come from it.
 *
 * Catalogue: configs/smak_rp/implants.json (format "smak-implants/1"; levels/rp/implants/implants.json is the
 * example, levels/rp/implants.mjs checks it offline). Each implant has a slot (legs, skin, blood, head; at most one
 * implant per slot), a price, an install cost, a refund paid when it is taken out, and ONE effect block:
 *     speed_pct    % more pev_maxspeed. TS resets the speed now and then, so a 1 s tick looks at it: when the value
 *                  is not the one this plugin set, the new value is the base and the bonus is put on it again
 *     armor        armor given at every spawn (and at install) when the player has less
 *     regen_hp + regen_every   +regen_hp health every regen_every seconds, never past smak_implants_maxhp (100)
 *     damage_pct   % less of every damage taken (Ham_TakeDamage, before the game applies it)
 * Not offered, because TS undoes them (measured in the game): gravity, and health above 100.
 *
 * Clinics: configs/smak_rp/<mapname>.clinics.json (format "smak-clinics/1"): id, name, origin, radius and, optionally,
 * "offer": a list of implant ids (all by default). /clinica near one opens the menu (install, remove, my implants);
 * every step asks again, and the player must be alive and inside the circle. /implantes lists them anywhere.
 * Installing in a taken slot replaces the old implant and pays its refund.
 *
 * Persistence: table implants(ident, slot, implant) in data/sqlite3/smak_rp.sq3 (smak_core's file; only this table
 * is touched). A save is ONE multi-row REPLACE with the four slots (an empty implant for a free slot), threaded, sent
 * at once after a change and again by the 60 s sweep when it failed. Guests (and a player whose load failed) keep their
 * implants for the session and are never saved. The money is taken through smak_core (saved by it a few seconds
 * later), so a crash in that window can leave an implant paid for twice or for free: the same trade-off as smak_items.
 *
 * Admin: smak_implant_give <name|#userid> <implant> (free), smak_implant_clear <name|#userid> [slot] (no refund).
 * Natives: smak_implant_has, smak_implant_count, smak_implant_in_slot (smak_implants.inc).
 * Cvars: smak_implants_maxhp 100, smak_implants_maxspeed 520, smak_implants_refund 1 (0: removing pays nothing),
 *        smak_implants_debug 0. Never hooks FM_KeyValue and never reads the info key buffer (both crash Xash).
 */

#define SMAK_IMPLANTS_PLUGIN
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <sqlx>
#include <json>
#include <smak_core>
#include <smak_implants>

#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK implants"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define DB_NAME      "smak_rp"
#define MAXPL        33
#define NSLOT        4
#define MAX_IMPL     32
#define MAX_CLINICS  8
#define ID_LEN       32
#define NAME_LEN     48
#define DESC_LEN     152

#define MAX_TRIES     3
#define RETRY_SECONDS 10.0
#define SWEEP_SECONDS 60.0
#define TICK_SECONDS  1.0

#define TASK_FX      1000
#define TASK_RETRY   2000
#define TASK_TICK    3000
#define TASK_SWEEP   3001

// smak_event (smak_core.inc) is optional: an older smak_core without it makes smak_say() fall back to chat.
public event_native_filter(const name[], index, trap)
{
	if (!trap && equal(name, "smak_event", 10)) return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
}

// ---- the SQL. One statement per macro, so test-implants-sql.mjs can run them against a real SQLite. ---------------
// %s is a text already passed through sql_quote() (inside '...'). The slot names in Q_UPSERT are SLOT_NAME, in order.
#define Q_CREATE_IMPLANTS "CREATE TABLE IF NOT EXISTS implants (ident TEXT NOT NULL, slot TEXT NOT NULL, implant TEXT NOT NULL DEFAULT '', PRIMARY KEY (ident, slot))"
#define Q_SELECT          "SELECT slot, implant FROM implants WHERE ident = '%s'"
#define Q_UPSERT          "INSERT OR REPLACE INTO implants (ident, slot, implant) VALUES ('%s','legs','%s'),('%s','skin','%s'),('%s','blood','%s'),('%s','head','%s')"

new const SLOT_NAME[NSLOT][] = { "legs", "skin", "blood", "head" };
new const SLOT_SHOW[NSLOT][] = { "Piernas", "Piel", "Sangre", "Cabeza" };

enum
{
	ST_NONE = 0,     // not loaded yet
	ST_LOADING,
	ST_SAVED,        // implants of a saved character
	ST_SESSION       // guest, or load failed: kept for the session, never written
}

// catalogue
new g_i_id[MAX_IMPL][ID_LEN], g_i_name[MAX_IMPL][NAME_LEN], g_i_desc[MAX_IMPL][DESC_LEN];
new g_i_slot[MAX_IMPL], g_i_price[MAX_IMPL], g_i_install[MAX_IMPL], g_i_refund[MAX_IMPL];
new g_i_speed[MAX_IMPL], g_i_armor[MAX_IMPL], g_i_regen[MAX_IMPL], g_i_every[MAX_IMPL], g_i_dmg[MAX_IMPL];
new g_impl_count;

// clinics of this map
new g_c_id[MAX_CLINICS][ID_LEN], g_c_name[MAX_CLINICS][NAME_LEN];
new Float:g_c_org[MAX_CLINICS][3], Float:g_c_rad[MAX_CLINICS];
new bool:g_c_offer[MAX_CLINICS][MAX_IMPL];
new g_clinic_count;

// players
new g_state[MAXPL], g_gen[MAXPL], g_tries[MAXPL];
new g_have[MAXPL][NSLOT][ID_LEN];       // implant id per slot as stored (may name an implant the catalogue no longer has)
new g_idx[MAXPL][NSLOT];                // catalogue index per slot, -1 for none/unknown
new bool:g_dirty[MAXPL];
new g_ident[MAXPL][96];
new g_clinic[MAXPL];                    // clinic of the open menu
new g_sel[MAXPL];                       // implant (install) or slot (remove) chosen in the open menu
// effects of the installed implants, summed
new g_e_speed[MAXPL], g_e_armor[MAXPL], g_e_dmg[MAXPL];
new Float:g_e_rate[MAXPL], Float:g_e_acc[MAXPL];
new Float:g_lastset[MAXPL], Float:g_base[MAXPL];
new bool:g_armored[MAXPL];
new g_maxplayers;
new bool:g_dbok, bool:g_cat_ok;
new g_map[64];
new Handle:g_tuple = Empty_Handle;
new g_pMaxHp, g_pMaxSpeed, g_pRefund, g_pDebug;

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
	smak_currency(out, len - 1);
	if (!out[0]) copy(out, len - 1, "creditos");
}

slot_find(const name[])
{
	for (new s = 0; s < NSLOT; s++)
	{
		if (equali(name, SLOT_NAME[s])) return s;
	}
	return -1;
}

impl_find(const id[])
{
	for (new i = 0; i < g_impl_count; i++)
	{
		if (equal(g_i_id[i], id)) return i;
	}
	return -1;
}

// ---- catalogue and clinics ----------------------------------------------------------------------------------------

load_catalogue()
{
	g_cat_ok = false;
	g_impl_count = 0;
	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/implants.json", dir);
	if (!file_exists(path))
	{
		log_amx("[smak_implants] ERROR: no %s: there are no implants", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_implants] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[64];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, "smak-implants/1"))
	{
		log_amx("[smak_implants] ERROR: %s: format is ^"%s^", not ^"smak-implants/1^": refused", path, text);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "implants");
	if (list != Invalid_JSON && json_is_array(list))
	{
		new count = json_array_get_count(list);
		for (new k = 0; k < count; k++)
		{
			new JSON:one = json_array_get_value(list, k);
			if (one == Invalid_JSON) continue;
			if (!json_is_object(one))
			{
				json_free(one);
				continue;
			}
			if (g_impl_count >= MAX_IMPL)
			{
				log_amx("[smak_implants] more than %d implants: the rest are left out", MAX_IMPL);
				json_free(one);
				break;
			}
			new n = g_impl_count;
			json_object_get_string(one, "id", g_i_id[n], ID_LEN - 1);
			json_object_get_string(one, "name", g_i_name[n], NAME_LEN - 1);
			json_object_get_string(one, "desc", g_i_desc[n], DESC_LEN - 1);
			json_object_get_string(one, "slot", text, charsmax(text));
			g_i_slot[n] = slot_find(text);
			g_i_price[n] = json_object_get_number(one, "price");
			g_i_install[n] = json_object_get_number(one, "install");
			g_i_refund[n] = json_object_get_number(one, "refund");
			g_i_speed[n] = g_i_armor[n] = g_i_regen[n] = g_i_every[n] = g_i_dmg[n] = 0;
			new JSON:fx = json_object_get_value(one, "effect");
			if (fx != Invalid_JSON)
			{
				if (json_is_object(fx))
				{
					g_i_speed[n] = clamp(json_object_get_number(fx, "speed_pct"), 0, 100);
					g_i_armor[n] = clamp(json_object_get_number(fx, "armor"), 0, 100);
					g_i_regen[n] = clamp(json_object_get_number(fx, "regen_hp"), 0, 20);
					g_i_every[n] = clamp(json_object_get_number(fx, "regen_every"), 0, 120);
					g_i_dmg[n] = clamp(json_object_get_number(fx, "damage_pct"), 0, 60);
				}
				json_free(fx);
			}
			json_free(one);
			new bool:hasfx = g_i_speed[n] || g_i_armor[n] || (g_i_regen[n] && g_i_every[n]) || g_i_dmg[n];
			if (!g_i_id[n][0] || !g_i_name[n][0] || g_i_slot[n] < 0 || g_i_price[n] < 1 || g_i_install[n] < 0 || g_i_refund[n] < 0 || !hasfx || impl_find(g_i_id[n]) >= 0)
			{
				log_amx("[smak_implants] implant %d (%s) is not valid: left out", k + 1, g_i_id[n]);
				continue;
			}
			if (g_i_refund[n] > g_i_price[n]) g_i_refund[n] = g_i_price[n];      // never more than the price: no money from nothing
			g_impl_count++;
		}
	}
	if (list != Invalid_JSON) json_free(list);
	json_free(root);
	g_cat_ok = g_impl_count > 0;
	log_amx("[smak_implants] %d implants loaded from %s", g_impl_count, path);
}

load_clinics()
{
	g_clinic_count = 0;
	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.clinics.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_implants] no %s: no clinics on this map", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_implants] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[64];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, "smak-clinics/1"))
	{
		log_amx("[smak_implants] ERROR: %s: format is ^"%s^", not ^"smak-clinics/1^": refused", path, text);
		json_free(root);
		return;
	}
	json_object_get_string(root, "map", text, charsmax(text));
	if (!equal(text, g_map))
	{
		log_amx("[smak_implants] ERROR: %s is for map ^"%s^", this is ^"%s^": refused", path, text, g_map);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "clinics");
	if (list != Invalid_JSON && json_is_array(list))
	{
		new count = json_array_get_count(list);
		for (new k = 0; k < count; k++)
		{
			new JSON:one = json_array_get_value(list, k);
			if (one == Invalid_JSON) continue;
			if (!json_is_object(one) || g_clinic_count >= MAX_CLINICS)
			{
				json_free(one);
				continue;
			}
			new c = g_clinic_count;
			json_object_get_string(one, "id", g_c_id[c], ID_LEN - 1);
			json_object_get_string(one, "name", g_c_name[c], NAME_LEN - 1);
			g_c_rad[c] = json_object_get_real(one, "radius");
			new bool:placed = false;
			new JSON:at = json_object_get_value(one, "origin");
			if (at != Invalid_JSON)
			{
				if (json_is_array(at) && json_array_get_count(at) >= 3)
				{
					g_c_org[c][0] = json_array_get_real(at, 0);
					g_c_org[c][1] = json_array_get_real(at, 1);
					g_c_org[c][2] = json_array_get_real(at, 2);
					placed = true;
				}
				json_free(at);
			}
			for (new i = 0; i < MAX_IMPL; i++) g_c_offer[c][i] = false;
			new JSON:offer = json_object_get_value(one, "offer");
			if (offer != Invalid_JSON && json_is_array(offer))
			{
				new on = json_array_get_count(offer);
				for (new j = 0; j < on; j++)
				{
					json_array_get_string(offer, j, text, charsmax(text));
					new idx = impl_find(text);
					if (idx >= 0) g_c_offer[c][idx] = true;
					else log_amx("[smak_implants] clinic %s offers ^"%s^", which is not in the catalogue", g_c_id[c], text);
				}
			}
			else
			{
				for (new i = 0; i < g_impl_count; i++) g_c_offer[c][i] = true;
			}
			if (offer != Invalid_JSON) json_free(offer);
			json_free(one);
			if (!g_c_id[c][0] || !placed || g_c_rad[c] <= 0.0)
			{
				log_amx("[smak_implants] clinic %d (%s) has no id, origin or radius: left out", k + 1, g_c_id[c]);
				continue;
			}
			if (!g_c_name[c][0]) copy(g_c_name[c], NAME_LEN - 1, "Clinica");
			g_clinic_count++;
		}
	}
	if (list != Invalid_JSON) json_free(list);
	json_free(root);
	log_amx("[smak_implants] %d clinics on %s", g_clinic_count, g_map);
}

// The clinic whose circle the player stands in (the nearest), or -1.
clinic_near(id)
{
	new Float:org[3];
	pev(id, pev_origin, org);
	new best = -1;
	new Float:bestd = 99999.0;
	for (new c = 0; c < g_clinic_count; c++)
	{
		new Float:d = get_distance_f(org, g_c_org[c]);
		if (d <= g_c_rad[c] && d < bestd)
		{
			best = c;
			bestd = d;
		}
	}
	return best;
}

// ---- database -----------------------------------------------------------------------------------------------------

setup_db()
{
	g_dbok = false;
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_implants] ERROR: no sqlite driver. Implants last the session only.");
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
		log_amx("[smak_implants] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}
	new Handle:h = SQL_PrepareQuery(db, "%s", Q_CREATE_IMPLANTS);
	if (SQL_Execute(h)) g_dbok = true;
	else
	{
		SQL_QueryError(h, err, charsmax(err));
		log_amx("[smak_implants] ERROR: cannot create table implants: %s", err);
	}
	SQL_FreeHandle(h);
	SQL_FreeHandle(db);
}

build_upsert(id, q[], len)
{
	new qi[200], a[ID_LEN * 2], b[ID_LEN * 2], c[ID_LEN * 2], d[ID_LEN * 2];
	sql_quote(g_ident[id], qi, charsmax(qi));
	sql_quote(g_have[id][0], a, charsmax(a));
	sql_quote(g_have[id][1], b, charsmax(b));
	sql_quote(g_have[id][2], c, charsmax(c));
	sql_quote(g_have[id][3], d, charsmax(d));
	formatex(q, len, Q_UPSERT, qi, a, qi, b, qi, c, qi, d);
}

save_async(id)
{
	if (g_state[id] != ST_SAVED || !g_dbok || g_tuple == Empty_Handle) return;
	new q[1100];
	build_upsert(id, q, charsmax(q));
	g_dirty[id] = false;
	new data[1];
	data[0] = id;
	SQL_ThreadQuery(g_tuple, "th_save", q, data, 1);
}

public th_save(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate == TQUERY_SUCCESS) return;
	log_amx("[smak_implants] SAVE FAILED for slot %d: %s", data[0], error);
	if (valid_id(data[0]) && g_state[data[0]] == ST_SAVED) g_dirty[data[0]] = true;      // the sweep tries again
}

public task_sweep()
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);
	}
}

// ---- loading ------------------------------------------------------------------------------------------------------

clear_player(id)
{
	g_state[id] = ST_NONE;
	g_gen[id]++;
	g_tries[id] = 0;
	g_dirty[id] = false;
	g_ident[id][0] = 0;
	g_clinic[id] = -1;
	g_sel[id] = -1;
	for (new s = 0; s < NSLOT; s++)
	{
		g_have[id][s][0] = 0;
		g_idx[id][s] = -1;
	}
	g_e_speed[id] = g_e_armor[id] = g_e_dmg[id] = 0;
	g_e_rate[id] = g_e_acc[id] = 0.0;
	g_lastset[id] = g_base[id] = 0.0;
	g_armored[id] = false;
}

// Forget a player. Idempotent: FM_ClientDisconnect and client_disconnected both call it.
drop_player(id)
{
	if (!valid_id(id)) return;
	remove_task(id + TASK_FX);
	remove_task(id + TASK_RETRY);
	if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);      // the query keeps its own copy of the values
	clear_player(id);
}

// Called once the character is usable: from smak_char_loaded_fw and from client_putinserver (smak_core can announce a
// guest from client_authorized, before the player is connected). Taking a player twice changes nothing.
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
	if (get_pcvar_num(g_pDebug)) log_amx("[smak_implants] slot %d: implants for the session only (%s)", id, why);
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
		log_amx("[smak_implants] load failed for slot %d (try %d): %s", id, g_tries[id] + 1, error);
		if (++g_tries[id] >= MAX_TRIES)
		{
			// never save over what we could not read
			session_only(id, "load failed");
			client_print(id, print_chat, "[SMAK] No se pudieron cargar tus implantes: en esta sesion no se guardaran.");
		}
		else set_task(RETRY_SECONDS, "task_retry", id + TASK_RETRY);
		return;
	}
	new slot[16], impl[ID_LEN];
	while (SQL_MoreResults(query))
	{
		SQL_ReadResult(query, 0, slot, charsmax(slot));
		SQL_ReadResult(query, 1, impl, charsmax(impl));
		new s = slot_find(slot);
		if (s >= 0) copy(g_have[id][s], ID_LEN - 1, impl);      // unknown slots in the table are ignored
		SQL_NextRow(query);
	}
	g_state[id] = ST_SAVED;
	if (get_pcvar_num(g_pDebug))
		log_amx("[smak_implants] slot %d loaded: ^"%s^"/^"%s^"/^"%s^"/^"%s^" (%s) in %.3fs", id, g_have[id][0], g_have[id][1], g_have[id][2], g_have[id][3], g_ident[id], queuetime);
	loaded(id);
}

public task_retry(taskid)
{
	new id = taskid - TASK_RETRY;
	if (valid_id(id) && g_state[id] == ST_LOADING && is_user_connected(id)) send_select(id);
}

loaded(id)
{
	refresh(id);
	if (count_of(id) > 0) smak_say(id, EV_ITEM, "Tus implantes estan activos (/implantes)");
}

public client_putinserver(id)
{
	if (smak_char_loaded(id)) begin_load(id);
}

public smak_char_loaded_fw(id)
{
	begin_load(id);
}

// ---- effects ------------------------------------------------------------------------------------------------------

count_of(id)
{
	new n = 0;
	for (new s = 0; s < NSLOT; s++)
	{
		if (g_have[id][s][0]) n++;
	}
	return n;
}

// Recompute the catalogue index and the summed effects from what the slots hold, and apply them to a living player.
refresh(id)
{
	restore_speed(id);
	g_e_speed[id] = g_e_armor[id] = g_e_dmg[id] = 0;
	g_e_rate[id] = 0.0;
	for (new s = 0; s < NSLOT; s++)
	{
		new i = g_have[id][s][0] ? impl_find(g_have[id][s]) : -1;
		if (i >= 0 && g_i_slot[i] != s) i = -1;
		g_idx[id][s] = i;
		if (i < 0) continue;
		g_e_speed[id] += g_i_speed[i];
		g_e_armor[id] = max(g_e_armor[id], g_i_armor[i]);
		g_e_dmg[id] += g_i_dmg[i];
		if (g_i_regen[i] > 0 && g_i_every[i] > 0) g_e_rate[id] += float(g_i_regen[i]) / float(g_i_every[i]);
	}
	g_e_speed[id] = min(g_e_speed[id], 100);
	g_e_dmg[id] = min(g_e_dmg[id], 60);
	g_armored[id] = false;
	if (is_user_alive(id)) apply(id);
}

apply(id)
{
	if (!ready(id) || !is_user_alive(id)) return;
	if (g_e_armor[id] > 0 && !g_armored[id])
	{
		g_armored[id] = true;
		new Float:arm;
		pev(id, pev_armorvalue, arm);
		if (arm < float(g_e_armor[id])) set_pev(id, pev_armorvalue, float(g_e_armor[id]));
	}
	if (g_e_speed[id] > 0) tick_speed(id);
}

// Undo the speed bonus if the speed is still the one this plugin set (otherwise TS or someone changed it: leave it).
restore_speed(id)
{
	if (g_lastset[id] > 0.0 && is_user_connected(id))
	{
		new Float:cur;
		pev(id, pev_maxspeed, cur);
		if (floatabs(cur - g_lastset[id]) < 1.0) set_pev(id, pev_maxspeed, g_base[id]);
	}
	g_lastset[id] = 0.0;
}

// pev_maxspeed holds when set (measured), but TS sets it again at times (weapon, stance, a new life). So: when the value
// is not the one set here, it is the new base and the bonus is put on it. Below 100 means frozen/dead: not touched.
tick_speed(id)
{
	new Float:cur;
	pev(id, pev_maxspeed, cur);
	if (cur < 100.0)
	{
		g_lastset[id] = 0.0;
		return;
	}
	if (g_lastset[id] > 0.0 && floatabs(cur - g_lastset[id]) < 1.0) return;
	new Float:target = cur * (1.0 + float(g_e_speed[id]) / 100.0);
	new Float:cap = float(get_pcvar_num(g_pMaxSpeed));
	if (target > cap) target = cap;
	if (target < cur) target = cur;
	g_base[id] = cur;
	g_lastset[id] = target;
	set_pev(id, pev_maxspeed, target);
	if (get_pcvar_num(g_pDebug)) log_amx("[smak_implants] slot %d speed %.0f -> %.0f", id, cur, target);
}

public task_tick()
{
	new maxhp = get_pcvar_num(g_pMaxHp);
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (!ready(id) || !is_user_alive(id)) continue;
		if (g_e_speed[id] > 0) tick_speed(id);
		if (g_e_rate[id] > 0.0)
		{
			new Float:hpf;
			pev(id, pev_health, hpf);
			new hp = floatround(hpf, floatround_ceil);
			if (hp < 1 || hp >= maxhp)
			{
				g_e_acc[id] = 0.0;
				continue;
			}
			g_e_acc[id] += g_e_rate[id] * TICK_SECONDS;
			new give = floatround(g_e_acc[id], floatround_floor);
			if (give > 0)
			{
				g_e_acc[id] -= float(give);
				set_pev(id, pev_health, float(min(maxhp, hp + give)));
			}
		}
	}
}

public fw_spawn(id)
{
	if (!is_user_alive(id)) return HAM_IGNORED;
	g_armored[id] = false;
	g_lastset[id] = 0.0;
	g_e_acc[id] = 0.0;
	remove_task(id + TASK_FX);
	set_task(0.4, "task_fx", id + TASK_FX);      // after TS has set the armor, speed and health of the new life
	return HAM_IGNORED;
}

public task_fx(taskid)
{
	apply(taskid - TASK_FX);
}

public fw_damage(victim, inflictor, attacker, Float:damage, damagebits)
{
	if (!valid_id(victim) || g_e_dmg[victim] <= 0 || damage <= 0.0) return HAM_IGNORED;
	SetHamParamFloat(4, damage * float(100 - g_e_dmg[victim]) / 100.0);
	return HAM_HANDLED;
}

// ---- installing and removing --------------------------------------------------------------------------------------

bool:usable(id)
{
	return valid_id(id) && is_user_connected(id) && ready(id);
}

// Checks every menu step repeats: the character, life, a clinic, the circle. Tells the player why not.
bool:at_clinic(id, c)
{
	if (!g_cat_ok || c < 0 || c >= g_clinic_count) return false;
	if (!usable(id))
	{
		client_print(id, print_chat, "[SMAK] Tu personaje aun se esta cargando, espera un momento.");
		return false;
	}
	if (!is_user_alive(id))
	{
		client_print(id, print_chat, "[SMAK] Un muerto no puede pasar por la clinica.");
		return false;
	}
	if (clinic_near(id) != c)
	{
		client_print(id, print_chat, "[SMAK] Te has alejado de la clinica.");
		return false;
	}
	return true;
}

// Install implant i (index). Cost is price + install, less nothing: the old implant's refund is paid after. free: admin.
// Returns true when it is done.
bool:do_install(id, i, bool:free)
{
	new s = g_i_slot[i];
	if (equal(g_have[id][s], g_i_id[i])) return false;
	new old = g_idx[id][s];
	new cost = g_i_price[i] + g_i_install[i];
	new cur[32]; currency(cur, charsmax(cur));
	if (!free)
	{
		new reason[48];
		formatex(reason, charsmax(reason), "implant:%s", g_i_id[i]);
		if (!smak_money_take(id, cost, reason))
		{
			client_print(id, print_chat, "[SMAK] No tienes %d %s para este implante.", cost, cur);
			return false;
		}
		if (old >= 0 && g_i_refund[old] > 0 && get_pcvar_num(g_pRefund))
		{
			formatex(reason, charsmax(reason), "implant_refund:%s", g_i_id[old]);
			smak_money_add(id, g_i_refund[old], reason);
		}
	}
	copy(g_have[id][s], ID_LEN - 1, g_i_id[i]);
	changed(id);
	return true;
}

changed(id)
{
	refresh(id);
	if (g_state[id] == ST_SAVED) save_async(id);
}

public cmd_clinic(id)
{
	if (!g_cat_ok)
	{
		client_print(id, print_chat, "[SMAK] Los implantes no estan disponibles en este servidor.");
		return;
	}
	if (!usable(id))
	{
		client_print(id, print_chat, "[SMAK] Tu personaje aun se esta cargando, espera un momento.");
		return;
	}
	new c = clinic_near(id);
	if (c < 0)
	{
		client_print(id, print_chat, "[SMAK] No hay ninguna clinica cerca. Busca una clinica de implantes.");
		return;
	}
	if (!is_user_alive(id))
	{
		client_print(id, print_chat, "[SMAK] Un muerto no puede pasar por la clinica.");
		return;
	}
	g_clinic[id] = c;
	open_main(id, c);
}

open_main(id, c)
{
	new cur[32]; currency(cur, charsmax(cur));
	new title[144];
	formatex(title, charsmax(title), "\y%s\n\d%d %s\n\dImplantes: %d de %d", g_c_name[c], smak_money_get(id), cur, count_of(id), NSLOT);
	new menu = menu_create(title, "mh_main");
	menu_additem(menu, "Instalar un implante", "install");
	menu_additem(menu, "Quitar un implante", "remove");
	menu_additem(menu, "Mis implantes", "mine");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(id, menu, 0);
}

public mh_main(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[12], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new c = g_clinic[id];
	if (!at_clinic(id, c)) return PLUGIN_HANDLED;
	if (equal(info, "install")) open_install(id, c, 0);
	else if (equal(info, "remove")) open_remove(id, c);
	else
	{
		show_mine(id);
		open_main(id, c);
	}
	return PLUGIN_HANDLED;
}

open_install(id, c, page)
{
	new cur[32]; currency(cur, charsmax(cur));
	new title[96];
	formatex(title, charsmax(title), "\yInstalar implante\n\d%d %s", smak_money_get(id), cur);
	new menu = menu_create(title, "mh_install");
	new shown = 0;
	for (new i = 0; i < g_impl_count; i++)
	{
		if (!g_c_offer[c][i]) continue;
		new line[96], info[8];
		new s = g_i_slot[i];
		if (equal(g_have[id][s], g_i_id[i])) formatex(line, charsmax(line), "\d%s [%s] (instalado)", g_i_name[i], SLOT_SHOW[s]);
		else formatex(line, charsmax(line), "%s \d[%s] \y%d %s", g_i_name[i], SLOT_SHOW[s], g_i_price[i] + g_i_install[i], cur);
		num_to_str(i, info, charsmax(info));
		menu_additem(menu, line, info);
		shown++;
	}
	if (!shown)
	{
		menu_destroy(menu);
		client_print(id, print_chat, "[SMAK] Esta clinica no ofrece implantes.");
		return;
	}
	menu_setprop(menu, MPROP_BACKNAME, "Atras");
	menu_setprop(menu, MPROP_NEXTNAME, "Siguiente");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_display(id, menu, page);
}

public mh_install(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new c = g_clinic[id];
	new i = str_to_num(info);
	if (!at_clinic(id, c)) return PLUGIN_HANDLED;
	if (i < 0 || i >= g_impl_count || !g_c_offer[c][i]) return PLUGIN_HANDLED;
	if (equal(g_have[id][g_i_slot[i]], g_i_id[i]))
	{
		client_print(id, print_chat, "[SMAK] Ya llevas instalado %s.", g_i_name[i]);
		open_install(id, c, 0);
		return PLUGIN_HANDLED;
	}
	g_sel[id] = i;
	open_install_confirm(id, i);
	return PLUGIN_HANDLED;
}

open_install_confirm(id, i)
{
	new cur[32]; currency(cur, charsmax(cur));
	new s = g_i_slot[i];
	new old = g_idx[id][s];
	new title[400];
	formatex(title, charsmax(title), "\y%s \d[%s]\n\w%s\n\dPrecio %d + instalacion %d = \y%d %s", g_i_name[i], SLOT_SHOW[s], g_i_desc[i], g_i_price[i], g_i_install[i], g_i_price[i] + g_i_install[i], cur);
	if (old >= 0) format(title, charsmax(title), "%s\n\rReemplaza %s%s", title, g_i_name[old], get_pcvar_num(g_pRefund) && g_i_refund[old] > 0 ? " (te devuelven parte)" : " (sin devolucion)");
	else if (g_have[id][s][0]) format(title, charsmax(title), "%s\n\rReemplaza un implante desconocido (sin devolucion)", title);
	new menu = menu_create(title, "mh_install_confirm");
	menu_additem(menu, "Instalar", "yes");
	menu_additem(menu, "Cancelar", "no");
	menu_setprop(menu, MPROP_EXIT, MEXIT_NEVER);
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(id, menu, 0);
}

public mh_install_confirm(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new c = g_clinic[id];
	new i = g_sel[id];
	g_sel[id] = -1;
	if (!equal(info, "yes"))
	{
		if (at_clinic(id, c)) open_main(id, c);
		return PLUGIN_HANDLED;
	}
	if (!at_clinic(id, c)) return PLUGIN_HANDLED;
	if (i < 0 || i >= g_impl_count || !g_c_offer[c][i]) return PLUGIN_HANDLED;
	if (do_install(id, i, false))
	{
		smak_say(id, EV_ITEM, "Implante instalado: %s", g_i_name[i]);
		log_amx("[smak_implants] slot %d installed %s at %s", id, g_i_id[i], g_c_id[c]);
	}
	open_main(id, c);
	return PLUGIN_HANDLED;
}

open_remove(id, c)
{
	new menu = menu_create("\yQuitar implante", "mh_remove");
	new cur[32]; currency(cur, charsmax(cur));
	new shown = 0;
	for (new s = 0; s < NSLOT; s++)
	{
		if (!g_have[id][s][0]) continue;
		new line[96], info[8];
		new i = g_idx[id][s];
		if (i >= 0)
		{
			new back = get_pcvar_num(g_pRefund) ? g_i_refund[i] : 0;
			if (back > 0) formatex(line, charsmax(line), "%s \d[%s] \yte devuelven %d %s", g_i_name[i], SLOT_SHOW[s], back, cur);
			else formatex(line, charsmax(line), "%s \d[%s] sin devolucion", g_i_name[i], SLOT_SHOW[s]);
		}
		else formatex(line, charsmax(line), "Implante desconocido \d[%s]", SLOT_SHOW[s]);
		num_to_str(s, info, charsmax(info));
		menu_additem(menu, line, info);
		shown++;
	}
	if (!shown)
	{
		menu_destroy(menu);
		client_print(id, print_chat, "[SMAK] No llevas ningun implante.");
		open_main(id, c);
		return;
	}
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(id, menu, 0);
}

public mh_remove(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new c = g_clinic[id];
	new s = str_to_num(info);
	if (!at_clinic(id, c)) return PLUGIN_HANDLED;
	if (s < 0 || s >= NSLOT || !g_have[id][s][0]) return PLUGIN_HANDLED;
	g_sel[id] = s;
	new i = g_idx[id][s];
	new title[200];
	if (i >= 0) formatex(title, charsmax(title), "\yQuitar %s?\n\dLa cirugia es dolorosa y el aparato se pierde.", g_i_name[i]);
	else formatex(title, charsmax(title), "\yQuitar un implante desconocido?");
	new m2 = menu_create(title, "mh_remove_confirm");
	menu_additem(m2, "Quitar", "yes");
	menu_additem(m2, "Cancelar", "no");
	menu_setprop(m2, MPROP_EXIT, MEXIT_NEVER);
	menu_setprop(m2, MPROP_PERPAGE, 0);
	menu_display(id, m2, 0);
	return PLUGIN_HANDLED;
}

public mh_remove_confirm(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new c = g_clinic[id];
	new s = g_sel[id];
	g_sel[id] = -1;
	if (!equal(info, "yes"))
	{
		if (at_clinic(id, c)) open_main(id, c);
		return PLUGIN_HANDLED;
	}
	if (!at_clinic(id, c)) return PLUGIN_HANDLED;
	if (s < 0 || s >= NSLOT || !g_have[id][s][0]) return PLUGIN_HANDLED;
	new i = g_idx[id][s];
	new cur[32]; currency(cur, charsmax(cur));
	new back = (i >= 0 && get_pcvar_num(g_pRefund)) ? g_i_refund[i] : 0;
	new oldid[ID_LEN];
	copy(oldid, charsmax(oldid), g_have[id][s]);
	g_have[id][s][0] = 0;
	changed(id);
	if (back > 0)
	{
		new reason[48];
		formatex(reason, charsmax(reason), "implant_refund:%s", oldid);
		if (!smak_money_add(id, back, reason)) back = 0;
	}
	if (back > 0) smak_say(id, EV_ITEM, "Implante retirado. Recibes %d", back);
	else smak_say(id, EV_ITEM, "Implante retirado");
	log_amx("[smak_implants] slot %d removed %s (refund %d)", id, oldid, back);
	open_main(id, c);
	return PLUGIN_HANDLED;
}

// ---- commands -----------------------------------------------------------------------------------------------------

show_mine(id)
{
	if (!usable(id))
	{
		client_print(id, print_chat, "[SMAK] Tus implantes aun se estan cargando, espera un momento.");
		return;
	}
	client_print(id, print_chat, "[SMAK] Implantes%s:", g_state[id] == ST_SESSION ? " (solo esta sesion, no se guardan)" : "");
	for (new s = 0; s < NSLOT; s++)
	{
		new i = g_idx[id][s];
		if (i >= 0) client_print(id, print_chat, "[SMAK] %s: %s - %s", SLOT_SHOW[s], g_i_name[i], g_i_desc[i]);
		else if (g_have[id][s][0]) client_print(id, print_chat, "[SMAK] %s: implante desconocido (sin efecto)", SLOT_SHOW[s]);
		else client_print(id, print_chat, "[SMAK] %s: libre", SLOT_SHOW[s]);
	}
}

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/implantes") || equali(a, "/implants"))
	{
		show_mine(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/clinica") || equali(a, "/clinic"))
	{
		cmd_clinic(id);
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

public cmd_give(id)
{
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] smak_implant_give: needs ADMIN_RCON (or the listen-server host with smak_core_dev 1)");
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 3)
	{
		console_print(id, "[SMAK] usage: smak_implant_give <name|#userid> <implant id>");
		return PLUGIN_HANDLED;
	}
	new who[48], imp[ID_LEN];
	read_argv(1, who, charsmax(who));
	read_argv(2, imp, charsmax(imp));
	new i = impl_find(imp);
	if (i < 0)
	{
		console_print(id, "[SMAK] smak_implant_give: unknown implant '%s'", imp);
		return PLUGIN_HANDLED;
	}
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF | CMDTARGET_NO_BOTS);
	if (!target) return PLUGIN_HANDLED;
	if (!usable(target))
	{
		console_print(id, "[SMAK] smak_implant_give: that player's implants are not loaded yet");
		return PLUGIN_HANDLED;
	}
	do_install(target, i, true);
	console_print(id, "[SMAK] smak_implant_give: %s now has %s", who, g_i_name[i]);
	return PLUGIN_HANDLED;
}

public cmd_clear(id)
{
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] smak_implant_clear: needs ADMIN_RCON (or the listen-server host with smak_core_dev 1)");
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 2)
	{
		console_print(id, "[SMAK] usage: smak_implant_clear <name|#userid> [legs|skin|blood|head]");
		return PLUGIN_HANDLED;
	}
	new who[48], sl[16];
	read_argv(1, who, charsmax(who));
	read_argv(2, sl, charsmax(sl));
	new only = -1;
	if (sl[0])
	{
		only = slot_find(sl);
		if (only < 0)
		{
			console_print(id, "[SMAK] smak_implant_clear: unknown slot '%s'", sl);
			return PLUGIN_HANDLED;
		}
	}
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF | CMDTARGET_NO_BOTS);
	if (!target) return PLUGIN_HANDLED;
	if (!usable(target))
	{
		console_print(id, "[SMAK] smak_implant_clear: that player's implants are not loaded yet");
		return PLUGIN_HANDLED;
	}
	for (new s = 0; s < NSLOT; s++)
	{
		if (only < 0 || only == s) g_have[target][s][0] = 0;
	}
	changed(target);
	console_print(id, "[SMAK] smak_implant_clear: done for %s", who);
	return PLUGIN_HANDLED;
}

// ---- natives ------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	set_native_filter("event_native_filter");
	register_library("smak_implants");
	register_native("smak_implant_has", "_has");
	register_native("smak_implant_count", "_count");
	register_native("smak_implant_in_slot", "_in_slot");
}

public bool:_has(plugin, params)
{
	new id = get_param(1), name[ID_LEN];
	get_string(2, name, charsmax(name));
	if (!usable(id) || !name[0]) return false;
	for (new s = 0; s < NSLOT; s++)
	{
		if (equal(g_have[id][s], name)) return true;
	}
	return false;
}

public _count(plugin, params)
{
	new id = get_param(1);
	if (!usable(id)) return -1;
	return count_of(id);
}

public _in_slot(plugin, params)
{
	new id = get_param(1), slot[16];
	get_string(2, slot, charsmax(slot));
	new s = slot_find(slot);
	if (s < 0 || !usable(id) || !g_have[id][s][0])
	{
		set_string(3, "", get_param(4));
		return 0;
	}
	return set_string(3, g_have[id][s], get_param(4));
}

// ---- plugin -------------------------------------------------------------------------------------------------------

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();
	get_mapname(g_map, charsmax(g_map));

	g_pMaxHp = create_cvar("smak_implants_maxhp", "100", FCVAR_NONE, "what nano-repair regeneration stops at (TS undoes health above 100)");
	g_pMaxSpeed = create_cvar("smak_implants_maxspeed", "520", FCVAR_NONE, "the highest maxspeed a speed implant may give");
	g_pRefund = create_cvar("smak_implants_refund", "1", FCVAR_NONE, "1: taking an implant out (or replacing it) pays its refund; 0: nothing");
	g_pDebug = create_cvar("smak_implants_debug", "0", FCVAR_NONE, "1: log every load and speed change");

	for (new id = 0; id < MAXPL; id++) clear_player(id);

	RegisterHamPlayer(Ham_TakeDamage, "fw_damage", 0);
	RegisterHamPlayer(Ham_Spawn, "fw_spawn", 1);
	register_forward(FM_ClientDisconnect, "fw_disconnect");

	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_clcmd("smak_clinic", "cmd_clinic_con");
	register_clcmd("smak_implants", "cmd_implants_con");
	register_concmd("smak_implant_give", "cmd_give", ADMIN_ALL, "<name|#userid> <implant> -- install an implant for free (ADMIN_RCON)");
	register_concmd("smak_implant_clear", "cmd_clear", ADMIN_ALL, "<name|#userid> [slot] -- take implants out, no refund (ADMIN_RCON)");
}

public cmd_clinic_con(id)
{
	cmd_clinic(id);
	return PLUGIN_HANDLED;
}

public cmd_implants_con(id)
{
	show_mine(id);
	return PLUGIN_HANDLED;
}

public plugin_cfg()
{
	setup_db();
	load_catalogue();
	load_clinics();
	// players already loaded by smak_core before this plugin started
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (is_user_connected(id) && smak_char_loaded(id)) begin_load(id);
	}
	set_task(TICK_SECONDS, "task_tick", TASK_TICK, _, _, "b");
	set_task(SWEEP_SECONDS, "task_sweep", TASK_SWEEP, _, _, "b");
	log_amx("[smak_implants] %s started: db %s, %d implants, %d clinics", VERSION, g_dbok ? "ok" : "unavailable", g_impl_count, g_clinic_count);
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
		if (db == Empty_Handle) log_amx("[smak_implants] plugin_end: cannot open the database (%d: %s); implants not saved", errcode, err);
		else
		{
			new q[1100];
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] != ST_SAVED || !g_dirty[id]) continue;
				build_upsert(id, q, charsmax(q));
				new Handle:h = SQL_PrepareQuery(db, "%s", q);
				if (!SQL_Execute(h))
				{
					SQL_QueryError(h, err, charsmax(err));
					log_amx("[smak_implants] SAVE FAILED at map end for slot %d: %s", id, err);
				}
				SQL_FreeHandle(h);
			}
			SQL_FreeHandle(db);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}
