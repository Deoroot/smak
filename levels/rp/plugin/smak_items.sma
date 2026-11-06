/*
 * smak_items -- phase 4 of the pseudo-MSC system (levels/rp/NPCS.md, sections 5.8 and 5.11): the items, a saved
 * inventory per character, and shops that sell and buy them for smak_core's money.
 *
 * What it does
 *   - Reads the catalogue configs/smak_rp/items.json (format "smak-items/1") and the shops of this map,
 *     configs/smak_rp/<mapname>.shops.json (format "smak-shops/1"). levels/rp/items.mjs checks both offline.
 *   - Keeps one inventory per character in table `items_inventory (ident, item, count)` of
 *     addons/amxmodx/data/sqlite3/smak_rp.sq3, the file smak_core uses. Only its own table is created: `characters`
 *     and `schema_version` are never touched. The key is smak_char_ident (the same "auth:<authid>"). Loaded after
 *     smak_char_loaded_fw; saved 5 s after a change, on disconnect (FM_ClientDisconnect and client_disconnected,
 *     one idempotent function), every 60 s and at plugin_end. A guest (smak_char_guest) has an inventory for the
 *     session only.
 *   - Every purchase and sale goes through smak_money_take / smak_money_add with the reason "shop:<shopid>:<item>",
 *     so it lands in smak_core's money log (logs/smak_money.log).
 *
 * Chat (and the console commands of the same name without the slash: smak_inv, smak_shop):
 *     /inventario  /inv     the inventory menu: pick an item, then use it, inspect it or destroy it
 *     /tienda      /shop    the shop whose circle the player stands in: buy and sell menus
 * Admin console (ADMIN_RCON or the server console):
 *     smak_itemgive <name|#userid> <item> [count]      smak_itemtake <name|#userid> <item> [count]
 *
 * Natives (smak_items.inc): smak_item_count, smak_item_give, smak_item_take. And, callable by name from another
 * plugin: public smak_shop_open(id, const shop[]).
 *
 * Cvars: smak_items_slots 20 (different items a player may carry), smak_items_maxhealth 100 (what healing stops at),
 *        smak_items_death 0 (what dying takes: 0 nothing, 1 all but documents and keys, 2 everything),
 *        smak_items_weapon_ammo 60 (spare rounds given with a weapon), smak_items_dev 0 (as smak_core_dev: see /yo).
 *
 * Modules: amxmodx, amxmisc, fakemeta, hamsandwich, sqlite, json, tsfun (only for ts_giveweapon of a weapon item).
 * Never hooks FM_KeyValue (it crashes Xash).
 */

#define SMAK_ITEMS_PLUGIN
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <sqlx>
#include <json>
#include <tsfun>
#include <smak_core>
#include <smak_items>

#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK items"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define DB_NAME      "smak_rp"
#define MAXPL        33
#define MAX_ITEMS    128
#define MAX_SHOPS    16
#define MAX_STOCK    32
#define MAX_BUYS     32
#define ID_LEN       32
#define NAME_LEN     48
#define DESC_LEN     152
#define MAX_TRIES    3
#define SAVE_DELAY   5.0
#define SWEEP_SECONDS 60.0
#define RETRY_SECONDS 10.0
#define ROWS_PER_QUERY 12
#define ITEMS_FILE   "items.json"

#define TASK_SAVE    1000
#define TASK_RETRY   2000
#define TASK_SWEEP   4000

// ---- the SQL. One statement per macro, so test-items-sql.mjs can run them against a real SQLite. -------------------
// %s is a text already passed through sql_quote() (it sits inside '...'), %d an integer. Rows are never deleted: an
// item that runs out is written with count 0 (the load skips those), so a save is one INSERT OR REPLACE.

#define Q_CREATE_INV  "CREATE TABLE IF NOT EXISTS items_inventory (ident TEXT NOT NULL, item TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ident, item))"
#define Q_SELECT_INV  "SELECT item, count FROM items_inventory WHERE ident = '%s' AND count > 0"
#define Q_UPSERT_HEAD "INSERT OR REPLACE INTO items_inventory (ident, item, count) VALUES "
#define Q_UPSERT_ROW  "('%s', '%s', %d)"

enum
{
	KIND_DOCUMENT = 0,
	KIND_KEY,
	KIND_CONSUMABLE,
	KIND_WEAPON,
	KIND_MISC
}

enum
{
	IS_NONE = 0,      // not connected, or no character yet
	IS_LOADING,       // the select is in flight
	IS_READY,         // saved inventory in memory
	IS_GUEST,         // session-only inventory
	IS_FAILED         // the load failed, a retry is waiting
}

new g_i_id[MAX_ITEMS][ID_LEN], g_i_name[MAX_ITEMS][NAME_LEN], g_i_desc[MAX_ITEMS][DESC_LEN];
new g_i_kind[MAX_ITEMS], g_i_price[MAX_ITEMS], g_i_sell[MAX_ITEMS], g_i_stack[MAX_ITEMS], g_i_heal[MAX_ITEMS], g_i_weapon[MAX_ITEMS];
new g_item_count;

new g_s_id[MAX_SHOPS][ID_LEN], g_s_name[MAX_SHOPS][NAME_LEN], g_s_npc[MAX_SHOPS][ID_LEN];
new Float:g_s_org[MAX_SHOPS][3], Float:g_s_rad[MAX_SHOPS];
new g_s_nstock[MAX_SHOPS], g_s_stock[MAX_SHOPS][MAX_STOCK], g_s_sprice[MAX_SHOPS][MAX_STOCK];
new g_s_nbuys[MAX_SHOPS], g_s_buys[MAX_SHOPS][MAX_BUYS], g_s_bprice[MAX_SHOPS][MAX_BUYS];
new g_shop_count;
new bool:g_items_ok;

new g_state[MAXPL], g_gen[MAXPL], g_tries[MAXPL];
new g_cnt[MAXPL][MAX_ITEMS];
new bool:g_idirty[MAXPL][MAX_ITEMS];
new g_ident[MAXPL][96];
new g_sel[MAXPL];                 // the inventory item chosen
new g_shop[MAXPL];                // the shop the player has open (an index)

new Handle:g_tuple = Empty_Handle;
new bool:g_dbok;
new g_maxplayers;
new g_pSlots, g_pMaxHealth, g_pDeath, g_pAmmo, g_pDev;
new g_map[64];

// ---- helpers ------------------------------------------------------------------------------------------------------

stock bool:valid_id(id)
{
	return id >= 1 && id <= g_maxplayers;
}

stock bool:usable(id)
{
	return valid_id(id) && (g_state[id] == IS_READY || g_state[id] == IS_GUEST);
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

find_item(const item[])
{
	for (new i = 0; i < g_item_count; i++)
	{
		if (equal(g_i_id[i], item)) return i;
	}
	return -1;
}

find_shop(const shop[])
{
	for (new s = 0; s < g_shop_count; s++)
	{
		if (equal(g_s_id[s], shop)) return s;
	}
	return -1;
}

kind_name(kind, out[], len)
{
	switch (kind)
	{
		case KIND_DOCUMENT: copy(out, len, "documento");
		case KIND_KEY: copy(out, len, "llave");
		case KIND_CONSUMABLE: copy(out, len, "consumible");
		case KIND_WEAPON: copy(out, len, "arma");
		default: copy(out, len, "objeto");
	}
}

// ---- reading the JSON ---------------------------------------------------------------------------------------------

load_items()
{
	g_items_ok = false;
	g_item_count = 0;
	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s", dir, ITEMS_FILE);
	if (!file_exists(path))
	{
		log_amx("[smak_items] ERROR: no %s: there are no items", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_items] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[64];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, "smak-items/1"))
	{
		log_amx("[smak_items] ERROR: %s: format is ^"%s^", not ^"smak-items/1^": refused", path, text);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "items");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && g_item_count < MAX_ITEMS; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new n = g_item_count;
			g_i_id[n][0] = 0;
			g_i_name[n][0] = 0;
			g_i_desc[n][0] = 0;
			json_object_get_string(one, "id", g_i_id[n], ID_LEN - 1);
			json_object_get_string(one, "name", g_i_name[n], NAME_LEN - 1);
			json_object_get_string(one, "desc", g_i_desc[n], DESC_LEN - 1);
			json_object_get_string(one, "kind", text, charsmax(text));
			g_i_price[n] = max(0, json_object_get_number(one, "price"));
			g_i_sell[n] = max(0, json_object_get_number(one, "sell"));
			g_i_stack[n] = clamp(json_object_get_number(one, "stack"), 1, 99);
			g_i_heal[n] = 0;
			g_i_weapon[n] = 0;
			new JSON:use = json_object_get_value(one, "use");
			if (use != Invalid_JSON)
			{
				g_i_heal[n] = max(0, json_object_get_number(use, "heal"));
				json_free(use);
			}
			g_i_weapon[n] = json_object_get_number(one, "ts_weapon");
			json_free(one);

			if (equal(text, "document")) g_i_kind[n] = KIND_DOCUMENT;
			else if (equal(text, "key")) g_i_kind[n] = KIND_KEY;
			else if (equal(text, "consumable")) g_i_kind[n] = KIND_CONSUMABLE;
			else if (equal(text, "weapon")) g_i_kind[n] = KIND_WEAPON;
			else if (equal(text, "misc")) g_i_kind[n] = KIND_MISC;
			else
			{
				log_amx("[smak_items] item %d (%s) has kind ^"%s^": left out", i, g_i_id[n], text);
				continue;
			}
			if (!g_i_id[n][0] || find_item(g_i_id[n]) != -1)
			{
				log_amx("[smak_items] item %d has no id or a repeated one (%s): left out", i, g_i_id[n]);
				continue;
			}
			if (!g_i_name[n][0]) copy(g_i_name[n], NAME_LEN - 1, g_i_id[n]);
			g_item_count++;
		}
		json_free(list);
	}
	json_free(root);
	g_items_ok = g_item_count > 0;
	log_amx("[smak_items] %d items read from %s", g_item_count, path);
}

// the position of an npc of <map>.rp.json (smak_rp's file), for a shop that says "npc" instead of "origin"
bool:npc_position(const npc[], Float:out[3])
{
	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.rp.json", dir, g_map);
	if (!file_exists(path)) return false;
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON) return false;
	new bool:found = false;
	new JSON:list = json_object_get_value(root, "npcs");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && !found; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new nid[ID_LEN];
			json_object_get_string(one, "id", nid, charsmax(nid));
			if (equal(nid, npc))
			{
				new JSON:at = json_object_get_value(one, "at");
				if (at != Invalid_JSON)
				{
					if (json_is_array(at) && json_array_get_count(at) >= 3)
					{
						out[0] = json_array_get_real(at, 0);
						out[1] = json_array_get_real(at, 1);
						out[2] = json_array_get_real(at, 2);
						found = true;
					}
					json_free(at);
				}
			}
			json_free(one);
		}
		json_free(list);
	}
	json_free(root);
	return found;
}

// a list of "item" or { "item": "...", "price": n } into ids and prices; returns how many were kept
read_rows(JSON:shop, const field[], ids[], prices[], cap, bool:selling, const shopid[])
{
	new JSON:list = json_object_get_value(shop, field);
	if (list == Invalid_JSON) return 0;
	new kept = 0;
	new count = json_array_get_count(list);
	for (new i = 0; i < count && kept < cap; i++)
	{
		new JSON:row = json_array_get_value(list, i);
		new item[ID_LEN];
		new price = -1;
		if (json_is_string(row))
		{
			json_get_string(row, item, charsmax(item));
		}
		else if (json_is_object(row))
		{
			json_object_get_string(row, "item", item, charsmax(item));
			if (json_object_has_value(row, "price")) price = json_object_get_number(row, "price");
		}
		json_free(row);
		new idx = find_item(item);
		if (idx == -1)
		{
			log_amx("[smak_items] shop %s: %s names the item ^"%s^", which is not in the catalogue: left out", shopid, field, item);
			continue;
		}
		ids[kept] = idx;
		prices[kept] = price >= 0 ? price : (selling ? g_i_price[idx] : g_i_sell[idx]);
		kept++;
	}
	json_free(list);
	return kept;
}

load_shops()
{
	g_shop_count = 0;
	new dir[128], path[192];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.shops.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_items] no %s: no shops on this map", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_items] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[64];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, "smak-shops/1"))
	{
		log_amx("[smak_items] ERROR: %s: format is ^"%s^", not ^"smak-shops/1^": refused", path, text);
		json_free(root);
		return;
	}
	json_object_get_string(root, "map", text, charsmax(text));
	if (!equali(text, g_map))
	{
		log_amx("[smak_items] ERROR: %s is for the map ^"%s^", not %s: refused", path, text, g_map);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "shops");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && g_shop_count < MAX_SHOPS; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new s = g_shop_count;
			g_s_id[s][0] = 0;
			g_s_name[s][0] = 0;
			g_s_npc[s][0] = 0;
			json_object_get_string(one, "id", g_s_id[s], ID_LEN - 1);
			json_object_get_string(one, "name", g_s_name[s], NAME_LEN - 1);
			json_object_get_string(one, "npc", g_s_npc[s], ID_LEN - 1);
			g_s_rad[s] = json_object_get_real(one, "radius");
			new bool:placed = false;
			new JSON:at = json_object_get_value(one, "origin");
			if (at != Invalid_JSON)
			{
				if (json_is_array(at) && json_array_get_count(at) >= 3)
				{
					g_s_org[s][0] = json_array_get_real(at, 0);
					g_s_org[s][1] = json_array_get_real(at, 1);
					g_s_org[s][2] = json_array_get_real(at, 2);
					placed = true;
				}
				json_free(at);
			}
			if (!placed && g_s_npc[s][0]) placed = npc_position(g_s_npc[s], g_s_org[s]);
			if (g_s_rad[s] <= 0.0) g_s_rad[s] = 160.0;
			if (!g_s_id[s][0] || find_shop(g_s_id[s]) != -1 || !placed)
			{
				log_amx("[smak_items] shop %d (%s) has no id, a repeated one or no place (origin, or an npc of the map's rp.json): left out", i, g_s_id[s]);
				json_free(one);
				continue;
			}
			if (!g_s_name[s][0]) copy(g_s_name[s], NAME_LEN - 1, g_s_id[s]);
			g_s_nstock[s] = read_rows(one, "stock", g_s_stock[s], g_s_sprice[s], MAX_STOCK, true, g_s_id[s]);
			g_s_nbuys[s] = read_rows(one, "buys", g_s_buys[s], g_s_bprice[s], MAX_BUYS, false, g_s_id[s]);
			json_free(one);
			g_shop_count++;
			log_amx("[smak_items] shop %s ^"%s^" at %.0f %.0f %.0f radius %.0f: %d for sale, %d bought", g_s_id[s], g_s_name[s],
				g_s_org[s][0], g_s_org[s][1], g_s_org[s][2], g_s_rad[s], g_s_nstock[s], g_s_nbuys[s]);
		}
		json_free(list);
	}
	json_free(root);
}

// ---- database -----------------------------------------------------------------------------------------------------

bool:sql_exec(Handle:db, const q[], err[], errlen)
{
	new Handle:h = SQL_PrepareQuery(db, "%s", q);
	new bool:ok = SQL_Execute(h) != 0;
	if (!ok) SQL_QueryError(h, err, errlen);
	SQL_FreeHandle(h);
	return ok;
}

setup_db()
{
	g_dbok = false;
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_items] ERROR: SQL_SetAffinity(sqlite) failed: no sqlite driver. Inventories will not be saved (session only).");
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
		log_amx("[smak_items] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}
	if (!sql_exec(db, Q_CREATE_INV, err, charsmax(err)))
	{
		log_amx("[smak_items] ERROR: create items_inventory: %s", err);
		SQL_FreeHandle(db);
		return;
	}
	SQL_FreeHandle(db);
	g_dbok = true;
	log_amx("[smak_items] database %s/%s.sq3 ready (table items_inventory)", dir, DB_NAME);
}

// ---- inventory ----------------------------------------------------------------------------------------------------

slots_used(id)
{
	new n = 0;
	for (new i = 0; i < g_item_count; i++)
	{
		if (g_cnt[id][i] > 0) n++;
	}
	return n;
}

// Why an item cannot be added, in Spanish for the player; empty when it can.
can_hold(id, idx, count, why[], len)
{
	why[0] = 0;
	if (g_cnt[id][idx] + count > g_i_stack[idx])
	{
		formatex(why, len, "No puedes llevar mas de %d de %s.", g_i_stack[idx], g_i_name[idx]);
		return false;
	}
	if (g_cnt[id][idx] == 0 && slots_used(id) >= get_pcvar_num(g_pSlots))
	{
		formatex(why, len, "Tu inventario esta lleno (%d objetos distintos).", get_pcvar_num(g_pSlots));
		return false;
	}
	return true;
}

mark_dirty(id, idx)
{
	if (g_state[id] != IS_READY) return;
	g_idirty[id][idx] = true;
	if (!task_exists(id + TASK_SAVE)) set_task(SAVE_DELAY, "task_save", id + TASK_SAVE);
}

bool:inv_add(id, idx, count)
{
	new why[96];
	if (!usable(id) || count <= 0 || !can_hold(id, idx, count, why, charsmax(why))) return false;
	g_cnt[id][idx] += count;
	mark_dirty(id, idx);
	return true;
}

bool:inv_remove(id, idx, count)
{
	if (!usable(id) || count <= 0 || g_cnt[id][idx] < count) return false;
	g_cnt[id][idx] -= count;
	mark_dirty(id, idx);
	return true;
}

// ---- loading ------------------------------------------------------------------------------------------------------

reset_slot(id)
{
	for (new i = 0; i < g_item_count; i++)
	{
		g_cnt[id][i] = 0;
		g_idirty[id][i] = false;
	}
	g_ident[id][0] = 0;
	g_sel[id] = -1;
	g_shop[id] = -1;
}

make_guest(id, const why[])
{
	reset_slot(id);
	g_state[id] = IS_GUEST;
	log_amx("[smak_items] slot %d has a session-only inventory (%s)", id, why);
}

send_select(id)
{
	new qi[200], q[400];
	sql_quote(g_ident[id], qi, charsmax(qi));
	formatex(q, charsmax(q), Q_SELECT_INV, qi);
	new data[2];
	data[0] = id; data[1] = g_gen[id];
	SQL_ThreadQuery(g_tuple, "th_load", q, data, 2);
}

begin_load(id)
{
	if (!valid_id(id) || !is_user_connected(id)) return;
	reset_slot(id);
	g_gen[id]++;
	if (!g_items_ok)
	{
		g_state[id] = IS_GUEST;
		return;
	}
	if (smak_char_guest(id) || !g_dbok)
	{
		make_guest(id, smak_char_guest(id) ? "guest" : "database not available");
		return;
	}
	if (!smak_char_ident(id, g_ident[id], charsmax(g_ident[])))
	{
		make_guest(id, "no character key");
		return;
	}
	g_state[id] = IS_LOADING;
	send_select(id);
}

public smak_char_loaded_fw(id)
{
	g_state[id] = IS_NONE;
	begin_load(id);
}

public th_load(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	new id = data[0];
	if (!valid_id(id) || g_gen[id] != data[1] || g_state[id] != IS_LOADING) return;
	if (failstate != TQUERY_SUCCESS)
	{
		log_amx("[smak_items] load of slot %d failed: %s", id, error);
		g_tries[id]++;
		if (g_tries[id] >= MAX_TRIES)
		{
			make_guest(id, "load failed");
			client_print(id, print_chat, "[SMAK] No se pudo cargar tu inventario: esta sesion no se guarda.");
			return;
		}
		g_state[id] = IS_FAILED;
		set_task(RETRY_SECONDS, "task_retry", id + TASK_RETRY);
		return;
	}
	new got = 0;
	while (SQL_MoreResults(query))
	{
		new item[ID_LEN];
		SQL_ReadResult(query, 0, item, charsmax(item));
		new cnt = SQL_ReadResult(query, 1);
		new idx = find_item(item);
		if (idx == -1)
		{
			log_amx("[smak_items] slot %d: the stored item ^"%s^" is not in the catalogue: kept in the database, not loaded", id, item);
		}
		else
		{
			g_cnt[id][idx] = clamp(cnt, 0, g_i_stack[idx]);
			got++;
		}
		SQL_NextRow(query);
	}
	g_tries[id] = 0;
	g_state[id] = IS_READY;
	log_amx("[smak_items] slot %d: %d kind(s) of item loaded for %s (query %.3f s)", id, got, g_ident[id], queuetime);
}

public task_retry(taskid)
{
	new id = taskid - TASK_RETRY;
	if (!valid_id(id) || g_state[id] != IS_FAILED || !is_user_connected(id)) return;
	g_state[id] = IS_LOADING;
	send_select(id);
}

// ---- saving -------------------------------------------------------------------------------------------------------

// Writes the changed items of a saved inventory: ROWS_PER_QUERY rows to a statement, threaded.
save_async(id)
{
	if (g_state[id] != IS_READY || !g_dbok) return;
	new qi[200];
	sql_quote(g_ident[id], qi, charsmax(qi));
	new q[4096], data[ROWS_PER_QUERY + 3];
	new rows = 0;
	for (new i = 0; i < g_item_count; i++)
	{
		if (!g_idirty[id][i]) continue;
		g_idirty[id][i] = false;
		new qn[ID_LEN * 2 + 2], row[320];
		sql_quote(g_i_id[i], qn, charsmax(qn));
		formatex(row, charsmax(row), Q_UPSERT_ROW, qi, qn, g_cnt[id][i]);
		if (rows == 0) formatex(q, charsmax(q), "%s%s", Q_UPSERT_HEAD, row);
		else add(q, charsmax(q), ",");
		if (rows > 0) add(q, charsmax(q), row);
		data[3 + rows] = i;
		rows++;
		if (rows == ROWS_PER_QUERY)
		{
			send_save(id, q, data, rows);
			rows = 0;
		}
	}
	if (rows) send_save(id, q, data, rows);
}

send_save(id, const q[], data[], rows)
{
	data[0] = id; data[1] = g_gen[id]; data[2] = rows;
	SQL_ThreadQuery(g_tuple, "th_save", q, data, 3 + rows);
}

public th_save(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate == TQUERY_SUCCESS) return;
	new id = data[0], rows = data[2];
	log_amx("[smak_items] SAVE FAILED for slot %d (%d item kinds): %s", id, rows, error);
	if (valid_id(id) && g_gen[id] == data[1] && g_state[id] == IS_READY)
	{
		for (new r = 0; r < rows; r++) g_idirty[id][data[3 + r]] = true;      // the next sweep tries again
	}
}

public task_save(taskid)
{
	new id = taskid - TASK_SAVE;
	if (valid_id(id) && g_state[id] == IS_READY) save_async(id);
}

// Forget a player. Idempotent: FM_ClientDisconnect, client_disconnected and the sweep all call it.
items_drop(id)
{
	if (!valid_id(id) || g_state[id] == IS_NONE) return;
	remove_task(id + TASK_SAVE);
	remove_task(id + TASK_RETRY);
	if (g_state[id] == IS_READY) save_async(id);        // the statements already hold the values
	g_state[id] = IS_NONE;
	g_gen[id]++;
	g_tries[id] = 0;
	reset_slot(id);
}

public task_sweep()
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == IS_NONE) continue;
		if (!is_user_connected(id))
		{
			log_amx("[smak_items] sweep: slot %d is gone and no disconnect hook ran; saving it now", id);
			items_drop(id);
			continue;
		}
		if (g_state[id] == IS_READY) save_async(id);        // only what changed
	}
}

// map end: synchronous, like smak_core
public plugin_end()
{
	if (g_tuple == Empty_Handle) return;
	new bool:any = false;
	for (new id = 1; id <= g_maxplayers && !any; id++)
	{
		if (g_state[id] != IS_READY) continue;
		for (new i = 0; i < g_item_count; i++)
		{
			if (g_idirty[id][i]) { any = true; break; }
		}
	}
	if (any && g_dbok)
	{
		new err[256], errcode;
		new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
		if (db == Empty_Handle)
		{
			log_amx("[smak_items] plugin_end: cannot open the database (%d: %s); changed inventories not saved", errcode, err);
		}
		else
		{
			new saved = 0;
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] != IS_READY) continue;
				new qi[200];
				sql_quote(g_ident[id], qi, charsmax(qi));
				for (new i = 0; i < g_item_count; i++)
				{
					if (!g_idirty[id][i]) continue;
					new qn[ID_LEN * 2 + 2], q[400], row[200];
					sql_quote(g_i_id[i], qn, charsmax(qn));
					formatex(row, charsmax(row), Q_UPSERT_ROW, qi, qn, g_cnt[id][i]);
					formatex(q, charsmax(q), "%s%s", Q_UPSERT_HEAD, row);
					if (sql_exec(db, q, err, charsmax(err))) saved++;
					else log_amx("[smak_items] plugin_end: save of %s / %s failed: %s", g_ident[id], g_i_id[i], err);
				}
			}
			SQL_FreeHandle(db);
			log_amx("[smak_items] plugin_end: %d changed row(s) saved", saved);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}

// ---- natives ------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	register_library("smak_items");
	register_native("smak_item_count", "_item_count");
	register_native("smak_item_give", "_item_give");
	register_native("smak_item_take", "_item_take");
}

public _item_count(plugin, params)
{
	new id = get_param(1);
	new item[ID_LEN];
	get_string(2, item, charsmax(item));
	new idx = find_item(item);
	if (idx == -1 || !usable(id)) return 0;
	return g_cnt[id][idx];
}

public bool:_item_give(plugin, params)
{
	new id = get_param(1), count = get_param(3);
	new item[ID_LEN], src[64], why[96];
	get_string(2, item, charsmax(item));
	get_plugin(plugin, src, charsmax(src));
	new idx = find_item(item);
	if (idx == -1 || !usable(id) || count <= 0)
	{
		log_amx("[smak_items] smak_item_give(%d, '%s', %d) from %s refused: %s", id, item, count, src, idx == -1 ? "unknown item" : (count <= 0 ? "count must be > 0" : "inventory not usable"));
		return false;
	}
	if (!can_hold(id, idx, count, why, charsmax(why)))
	{
		log_amx("[smak_items] smak_item_give(%d, '%s', %d) from %s refused: %s", id, item, count, src, why);
		return false;
	}
	inv_add(id, idx, count);
	client_print(id, print_chat, "[SMAK] Recibes %d x %s.", count, g_i_name[idx]);
	return true;
}

public bool:_item_take(plugin, params)
{
	new id = get_param(1), count = get_param(3);
	new item[ID_LEN], src[64];
	get_string(2, item, charsmax(item));
	get_plugin(plugin, src, charsmax(src));
	new idx = find_item(item);
	if (idx == -1 || !inv_remove(id, idx, count))
	{
		log_amx("[smak_items] smak_item_take(%d, '%s', %d) from %s refused", id, item, count, src);
		return false;
	}
	client_print(id, print_chat, "[SMAK] Pierdes %d x %s.", count, g_i_name[idx]);
	return true;
}

// ---- plugin lifecycle ---------------------------------------------------------------------------------------------

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();
	get_mapname(g_map, charsmax(g_map));

	g_pSlots = create_cvar("smak_items_slots", "20", FCVAR_NONE, "different items a player may carry");
	g_pMaxHealth = create_cvar("smak_items_maxhealth", "100", FCVAR_NONE, "health a healing item stops at");
	g_pDeath = create_cvar("smak_items_death", "0", FCVAR_NONE, "on death: 0 keep everything, 1 lose all but documents and keys, 2 lose everything");
	g_pAmmo = create_cvar("smak_items_weapon_ammo", "60", FCVAR_NONE, "spare rounds given with a weapon item");
	g_pDev = create_cvar("smak_items_dev", "0", FCVAR_NONE, "1: the host of a listen server may use smak_itemgive / smak_itemtake");

	register_forward(FM_ClientDisconnect, "fw_disconnect");
	RegisterHamPlayer(Ham_Killed, "fw_killed", 1);
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_clcmd("smak_inv", "cmd_inv");
	register_clcmd("smak_shop", "cmd_shop");
	register_concmd("smak_itemgive", "cmd_itemgive", ADMIN_ALL, "<name|#userid> <item> [count] -- give an item (ADMIN_RCON)");
	register_concmd("smak_itemtake", "cmd_itemtake", ADMIN_ALL, "<name|#userid> <item> [count] -- take an item (ADMIN_RCON)");
}

public plugin_cfg()
{
	load_items();
	load_shops();
	setup_db();
	for (new id = 1; id <= g_maxplayers; id++)
	{
		g_sel[id] = -1;
		g_shop[id] = -1;
		if (is_user_connected(id) && smak_char_loaded(id)) begin_load(id);       // started late: take the players already in
	}
	set_task(SWEEP_SECONDS, "task_sweep", TASK_SWEEP, _, _, "b");
	log_amx("[smak_items] %s started: %d items, %d shops, database %s", VERSION, g_item_count, g_shop_count, g_dbok ? "ok" : "NOT available (session-only inventories)");
}

// smak_core can announce the character (a guest above all) from client_authorized, before the player is in the
// server, when begin_load turns it away; so the player is taken again here (smak_core is earlier in plugins.ini).
public client_putinserver(id)
{
	if (smak_char_loaded(id)) begin_load(id);
}

public fw_disconnect(id)
{
	items_drop(id);
	return FMRES_IGNORED;
}

public client_disconnected(id)
{
	items_drop(id);
}

public fw_killed(victim, attacker, shouldgib)
{
	new mode = get_pcvar_num(g_pDeath);
	if (!mode || !valid_id(victim) || !usable(victim)) return HAM_IGNORED;
	new lost = 0;
	for (new i = 0; i < g_item_count; i++)
	{
		if (g_cnt[victim][i] <= 0) continue;
		if (mode == 1 && (g_i_kind[i] == KIND_DOCUMENT || g_i_kind[i] == KIND_KEY)) continue;
		lost += g_cnt[victim][i];
		inv_remove(victim, i, g_cnt[victim][i]);
	}
	if (lost) client_print(victim, print_chat, "[SMAK] Al morir pierdes %d objeto(s).", lost);
	return HAM_IGNORED;
}

// ---- commands -----------------------------------------------------------------------------------------------------

bool:need_inv(id)
{
	if (usable(id)) return true;
	client_print(id, print_chat, "[SMAK] Tu personaje aun se esta cargando, espera un momento.");
	return false;
}

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/inventario") || equali(a, "/inv"))
	{
		open_inventory(id, 0);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/tienda") || equali(a, "/shop"))
	{
		open_near_shop(id);
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}

public cmd_inv(id)
{
	if (id) open_inventory(id, 0);
	return PLUGIN_HANDLED;
}

public cmd_shop(id)
{
	if (id) open_near_shop(id);
	return PLUGIN_HANDLED;
}

bool:can_admin(id)
{
	if (id == 0) return true;
	if (get_user_flags(id) & ADMIN_RCON) return true;
	return get_pcvar_num(g_pDev) && !is_dedicated_server() && id == 1;
}

admin_item(id, bool:giving)
{
	new cmdname[16];
	read_argv(0, cmdname, charsmax(cmdname));
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] %s: needs ADMIN_RCON (or the listen-server host with smak_items_dev 1)", cmdname);
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 3)
	{
		console_print(id, "[SMAK] usage: %s <name|#userid> <item> [count]", cmdname);
		return PLUGIN_HANDLED;
	}
	new who[48], item[ID_LEN], num[16];
	read_argv(1, who, charsmax(who));
	read_argv(2, item, charsmax(item));
	new count = 1;
	if (read_argc() >= 4)
	{
		read_argv(3, num, charsmax(num));
		if (!is_str_num(num) || strlen(num) > 4)
		{
			console_print(id, "[SMAK] %s: '%s' is not a whole number", cmdname, num);
			return PLUGIN_HANDLED;
		}
		count = str_to_num(num);
	}
	new idx = find_item(item);
	if (idx == -1 || count <= 0)
	{
		console_print(id, "[SMAK] %s: %s", cmdname, idx == -1 ? "no such item in the catalogue" : "the count must be > 0");
		return PLUGIN_HANDLED;
	}
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF | CMDTARGET_NO_BOTS);
	if (!target) return PLUGIN_HANDLED;
	if (!usable(target))
	{
		console_print(id, "[SMAK] %s: that player's inventory is not loaded yet", cmdname);
		return PLUGIN_HANDLED;
	}
	new bool:ok;
	if (giving)
	{
		new why[96];
		ok = can_hold(target, idx, count, why, charsmax(why)) && inv_add(target, idx, count);
		if (!ok) console_print(id, "[SMAK] %s: refused (%s)", cmdname, why);
	}
	else
	{
		ok = inv_remove(target, idx, count);
		if (!ok) console_print(id, "[SMAK] %s: the player has only %d", cmdname, g_cnt[target][idx]);
	}
	if (ok)
	{
		new tname[48];
		get_user_name(target, tname, charsmax(tname));
		console_print(id, "[SMAK] %s: %s now has %d x %s", cmdname, tname, g_cnt[target][idx], item);
		client_print(target, print_chat, "[SMAK] %s%d x %s.", giving ? "Recibes " : "Pierdes ", count, g_i_name[idx]);
	}
	return PLUGIN_HANDLED;
}

public cmd_itemgive(id)
{
	return admin_item(id, true);
}

public cmd_itemtake(id)
{
	return admin_item(id, false);
}

// ---- the inventory menus ------------------------------------------------------------------------------------------

open_inventory(id, page)
{
	if (!need_inv(id)) return;
	if (!g_items_ok)
	{
		client_print(id, print_chat, "[SMAK] No hay objetos en este servidor.");
		return;
	}
	new cur[32]; currency(cur, charsmax(cur));
	new title[96];
	formatex(title, charsmax(title), "\yInventario \d(%d/%d)  \y%d %s", slots_used(id), get_pcvar_num(g_pSlots), smak_money_get(id), cur);
	new menu = menu_create(title, "mh_inv");
	if (get_pcvar_num(g_pDev)) log_amx("[smak_items] open inventory menu %d for slot %d", menu, id);
	new shown = 0;
	for (new i = 0; i < g_item_count; i++)
	{
		if (g_cnt[id][i] <= 0) continue;
		new line[96], info[8], kn[16];
		kind_name(g_i_kind[i], kn, charsmax(kn));
		formatex(line, charsmax(line), "%s \yx%d \d[%s]", g_i_name[i], g_cnt[id][i], kn);
		num_to_str(i, info, charsmax(info));
		menu_additem(menu, line, info);
		shown++;
	}
	if (!shown)
	{
		menu_destroy(menu);
		client_print(id, print_chat, "[SMAK] Tu inventario esta vacio.");
		return;
	}
	menu_setprop(menu, MPROP_BACKNAME, "Atras");
	menu_setprop(menu, MPROP_NEXTNAME, "Siguiente");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_display(id, menu, page);
}

public mh_inv(id, menu, item)
{
	menu_trace(id, "mh_inv", menu, item);
	if (item == MENU_EXIT || !usable(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new idx = str_to_num(info);
	if (idx < 0 || idx >= g_item_count || g_cnt[id][idx] <= 0) return PLUGIN_HANDLED;
	g_sel[id] = idx;
	open_item_menu(id);
	return PLUGIN_HANDLED;
}

open_item_menu(id)
{
	new idx = g_sel[id];
	if (idx < 0 || idx >= g_item_count || g_cnt[id][idx] <= 0)
	{
		open_inventory(id, 0);
		return;
	}
	new title[96];
	formatex(title, charsmax(title), "\y%s \dx%d", g_i_name[idx], g_cnt[id][idx]);
	new menu = menu_create(title, "mh_item");
	menu_additem(menu, "Usar", "use");
	menu_additem(menu, "Inspeccionar", "look");
	menu_additem(menu, "Destruir 1", "d1");
	new line[48];
	formatex(line, charsmax(line), "Destruir todos (%d)", g_cnt[id][idx]);
	menu_additem(menu, line, "dall");
	menu_additem(menu, "Volver al inventario", "back");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(id, menu, 0);
}

public mh_item(id, menu, item)
{
	menu_trace(id, "mh_item", menu, item);
	if (item == MENU_EXIT || !usable(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new idx = g_sel[id];
	if (idx < 0 || idx >= g_item_count || g_cnt[id][idx] <= 0)
	{
		open_inventory(id, 0);
		return PLUGIN_HANDLED;
	}
	if (equal(info, "use"))
	{
		use_item(id, idx);
		if (g_cnt[id][idx] > 0) open_item_menu(id); else open_inventory(id, 0);
	}
	else if (equal(info, "look"))
	{
		inspect_item(id, idx);
		open_item_menu(id);
	}
	else if (equal(info, "d1") || equal(info, "dall"))
	{
		new n = equal(info, "d1") ? 1 : g_cnt[id][idx];
		if (inv_remove(id, idx, n)) client_print(id, print_chat, "[SMAK] Destruyes %d x %s.", n, g_i_name[idx]);
		if (g_cnt[id][idx] > 0) open_item_menu(id); else open_inventory(id, 0);
	}
	else
	{
		open_inventory(id, 0);
	}
	return PLUGIN_HANDLED;
}

inspect_item(id, idx)
{
	new kn[16];
	kind_name(g_i_kind[idx], kn, charsmax(kn));
	client_print(id, print_chat, "[SMAK] %s (%s)", g_i_name[idx], kn);
	if (g_i_desc[idx][0]) client_print(id, print_chat, "[SMAK] %s", g_i_desc[idx]);
	if (g_i_kind[idx] == KIND_CONSUMABLE && g_i_heal[idx] > 0) client_print(id, print_chat, "[SMAK] Cura %d de salud.", g_i_heal[idx]);
}

use_item(id, idx)
{
	switch (g_i_kind[idx])
	{
		case KIND_CONSUMABLE:
		{
			if (!is_user_alive(id))
			{
				client_print(id, print_chat, "[SMAK] No puedes usar eso estando muerto.");
				return;
			}
			if (g_i_heal[idx] > 0)
			{
				new Float:hp, Float:top = float(get_pcvar_num(g_pMaxHealth));
				pev(id, pev_health, hp);
				if (hp >= top)
				{
					client_print(id, print_chat, "[SMAK] Ya tienes la salud al maximo.");
					return;
				}
				hp += float(g_i_heal[idx]);
				set_pev(id, pev_health, hp > top ? top : hp);
			}
			inv_remove(id, idx, 1);
			client_print(id, print_chat, "[SMAK] Usas %s.", g_i_name[idx]);
		}
		case KIND_WEAPON:
		{
			if (!is_user_alive(id))
			{
				client_print(id, print_chat, "[SMAK] No puedes equiparte estando muerto.");
				return;
			}
			if (g_i_weapon[idx] < 1)
			{
				client_print(id, print_chat, "[SMAK] %s no se puede equipar.", g_i_name[idx]);
				return;
			}
			if (!ts_giveweapon(id, g_i_weapon[idx], get_pcvar_num(g_pAmmo), 0))
			{
				client_print(id, print_chat, "[SMAK] No puedes cargar %s ahora (sin sitio o rechazada).", g_i_name[idx]);
				return;
			}
			inv_remove(id, idx, 1);
			client_print(id, print_chat, "[SMAK] Te equipas %s.", g_i_name[idx]);
		}
		case KIND_KEY:
		{
			client_print(id, print_chat, "[SMAK] %s: una llave se usa sola ante su puerta (todavia no hay puertas con llave).", g_i_name[idx]);
		}
		case KIND_DOCUMENT:
		{
			inspect_item(id, idx);
		}
		default:
		{
			client_print(id, print_chat, "[SMAK] %s no se puede usar.", g_i_name[idx]);
		}
	}
}

// ---- shops --------------------------------------------------------------------------------------------------------

// The shop whose circle the player stands in (the nearest), or -1.
shop_near(id)
{
	new Float:org[3];
	pev(id, pev_origin, org);
	new best = -1;
	new Float:bestd = 99999.0;
	for (new s = 0; s < g_shop_count; s++)
	{
		new Float:d = get_distance_f(org, g_s_org[s]);
		if (d <= g_s_rad[s] && d < bestd)
		{
			best = s;
			bestd = d;
		}
	}
	return best;
}

open_near_shop(id)
{
	if (!need_inv(id)) return;
	new s = shop_near(id);
	if (s == -1)
	{
		client_print(id, print_chat, "[SMAK] No hay ninguna tienda aqui.");
		return;
	}
	open_shop_menu(id, s);
}

// callable by name: callfunc_begin("smak_shop_open", "smak_items.amxx")
public smak_shop_open(id, const shop[])
{
	if (!valid_id(id) || !is_user_connected(id)) return 0;
	new s = find_shop(shop);
	if (s == -1)
	{
		log_amx("[smak_items] smak_shop_open(%d, '%s'): no such shop on %s", id, shop, g_map);
		return 0;
	}
	if (!need_inv(id)) return 0;
	open_shop_menu(id, s);
	return 1;
}

// A shop menu is for a player near it, unless it was opened by name (smak_shop_open) or the circle is generous.
bool:still_near(id, s)
{
	new Float:org[3];
	pev(id, pev_origin, org);
	return get_distance_f(org, g_s_org[s]) <= g_s_rad[s] * 2.0 + 64.0;
}

open_shop_menu(id, s)
{
	g_shop[id] = s;
	new cur[32]; currency(cur, charsmax(cur));
	new title[112];
	formatex(title, charsmax(title), "\y%s\n\d%d %s", g_s_name[s], smak_money_get(id), cur);
	new menu = menu_create(title, "mh_shop");
	if (get_pcvar_num(g_pDev)) log_amx("[smak_items] open shop menu %d for slot %d", menu, id);
	menu_additem(menu, "Comprar", "buy");
	menu_additem(menu, "Vender", "sell");
	menu_additem(menu, "Mi inventario", "inv");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(id, menu, 0);
}

// smak_items_dev 1: every menu key reaches the log (which handler, which item, its info), to follow a menu by a test.
menu_trace(id, const h[], menu, item)
{
	if (!get_pcvar_num(g_pDev)) return;
	new info[16], name[48], access, cb;
	if (item >= 0) menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	log_amx("[smak_items] menu %s slot %d menu %d item %d info '%s' name '%s' shop %d", h, id, menu, item, info, name, g_shop[id]);
}

public mh_shop(id, menu, item)
{
	menu_trace(id, "mh_shop", menu, item);
	if (item == MENU_EXIT || !usable(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new s = g_shop[id];
	if (s < 0 || s >= g_shop_count) return PLUGIN_HANDLED;
	if (equal(info, "buy")) open_buy_menu(id, s, 0);
	else if (equal(info, "sell")) open_sell_menu(id, s, 0);
	else open_inventory(id, 0);
	return PLUGIN_HANDLED;
}

open_buy_menu(id, s, page)
{
	if (!g_s_nstock[s])
	{
		client_print(id, print_chat, "[SMAK] %s no vende nada.", g_s_name[s]);
		return;
	}
	new cur[32]; currency(cur, charsmax(cur));
	new title[112];
	formatex(title, charsmax(title), "\yComprar en %s\n\d%d %s", g_s_name[s], smak_money_get(id), cur);
	new menu = menu_create(title, "mh_buy");
	for (new k = 0; k < g_s_nstock[s]; k++)
	{
		new idx = g_s_stock[s][k];
		new line[96], info[8];
		if (g_cnt[id][idx] > 0) formatex(line, charsmax(line), "%s \y%d %s \d(tienes %d)", g_i_name[idx], g_s_sprice[s][k], cur, g_cnt[id][idx]);
		else formatex(line, charsmax(line), "%s \y%d %s", g_i_name[idx], g_s_sprice[s][k], cur);
		num_to_str(k, info, charsmax(info));
		menu_additem(menu, line, info);
	}
	menu_setprop(menu, MPROP_BACKNAME, "Atras");
	menu_setprop(menu, MPROP_NEXTNAME, "Siguiente");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_display(id, menu, page);
}

public mh_buy(id, menu, item)
{
	menu_trace(id, "mh_buy", menu, item);
	if (item == MENU_EXIT || !usable(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new s = g_shop[id];
	new k = str_to_num(info);
	if (s < 0 || s >= g_shop_count || k < 0 || k >= g_s_nstock[s]) return PLUGIN_HANDLED;
	if (!still_near(id, s))
	{
		client_print(id, print_chat, "[SMAK] Te has alejado de la tienda.");
		return PLUGIN_HANDLED;
	}
	buy_item(id, s, k);
	open_buy_menu(id, s, item / 7);
	return PLUGIN_HANDLED;
}

buy_item(id, s, k)
{
	new idx = g_s_stock[s][k];
	new price = g_s_sprice[s][k];
	new why[96], cur[32];
	currency(cur, charsmax(cur));
	if (!can_hold(id, idx, 1, why, charsmax(why)))
	{
		client_print(id, print_chat, "[SMAK] %s", why);
		return;
	}
	if (price > 0)
	{
		if (smak_money_get(id) < price)
		{
			client_print(id, print_chat, "[SMAK] No tienes suficiente dinero: %s cuesta %d %s y tienes %d.", g_i_name[idx], price, cur, smak_money_get(id));
			return;
		}
		new reason[96];
		formatex(reason, charsmax(reason), "shop:%s:%s", g_s_id[s], g_i_id[idx]);
		if (!smak_money_take(id, price, reason))
		{
			client_print(id, print_chat, "[SMAK] No se pudo cobrar. No compras nada.");
			return;
		}
	}
	if (!inv_add(id, idx, 1))
	{
		// cannot happen after can_hold, but never keep the money for nothing
		if (price > 0)
		{
			new reason[96];
			formatex(reason, charsmax(reason), "shop:%s:%s:refund", g_s_id[s], g_i_id[idx]);
			smak_money_add(id, price, reason);
		}
		return;
	}
	client_print(id, print_chat, "[SMAK] Compras %s por %d %s.", g_i_name[idx], price, cur);
}

open_sell_menu(id, s, page)
{
	new cur[32]; currency(cur, charsmax(cur));
	new title[112];
	formatex(title, charsmax(title), "\yVender a %s\n\d%d %s", g_s_name[s], smak_money_get(id), cur);
	new menu = menu_create(title, "mh_sell");
	new shown = 0;
	for (new k = 0; k < g_s_nbuys[s]; k++)
	{
		new idx = g_s_buys[s][k];
		if (g_cnt[id][idx] <= 0 || g_s_bprice[s][k] <= 0) continue;
		new line[96], info[8];
		formatex(line, charsmax(line), "%s \yx%d \d- paga %d %s", g_i_name[idx], g_cnt[id][idx], g_s_bprice[s][k], cur);
		num_to_str(k, info, charsmax(info));
		menu_additem(menu, line, info);
		shown++;
	}
	if (!shown)
	{
		menu_destroy(menu);
		client_print(id, print_chat, "[SMAK] %s no te compra nada de lo que llevas.", g_s_name[s]);
		return;
	}
	menu_setprop(menu, MPROP_BACKNAME, "Atras");
	menu_setprop(menu, MPROP_NEXTNAME, "Siguiente");
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_display(id, menu, page);
}

public mh_sell(id, menu, item)
{
	menu_trace(id, "mh_sell", menu, item);
	if (item == MENU_EXIT || !usable(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, cb, info[8], name[8];
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new s = g_shop[id];
	new k = str_to_num(info);
	if (s < 0 || s >= g_shop_count || k < 0 || k >= g_s_nbuys[s]) return PLUGIN_HANDLED;
	if (!still_near(id, s))
	{
		client_print(id, print_chat, "[SMAK] Te has alejado de la tienda.");
		return PLUGIN_HANDLED;
	}
	sell_item(id, s, k);
	open_sell_menu(id, s, 0);
	return PLUGIN_HANDLED;
}

sell_item(id, s, k)
{
	new idx = g_s_buys[s][k];
	new price = g_s_bprice[s][k];
	new cur[32];
	currency(cur, charsmax(cur));
	if (g_cnt[id][idx] < 1 || price <= 0) return;
	new reason[96];
	formatex(reason, charsmax(reason), "shop:%s:%s", g_s_id[s], g_i_id[idx]);
	if (!smak_money_add(id, price, reason))
	{
		client_print(id, print_chat, "[SMAK] No puedes cobrar tanto dinero. No vendes nada.");
		return;
	}
	inv_remove(id, idx, 1);
	client_print(id, print_chat, "[SMAK] Vendes %s por %d %s.", g_i_name[idx], price, cur);
}
