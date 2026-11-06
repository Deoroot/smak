/*
 * smak_script.sma -- data-driven events and actions for the SMAK role-play server (levels/rp/NPCS.md, 5.4 and 5.11, phase 3).
 *
 * Reads, when the map starts:
 *     addons/amxmodx/configs/smak_rp/<mapname>.script.json     format "smak-script/1"   (rules for this map)
 *     addons/amxmodx/configs/smak_rp/global.script.json        the same format         (rules for every map; optional)
 * and the map's  <mapname>.rp.json  (only its "npcs": id, name, at) to know the NPCs the rules name.
 * The format is in levels/rp/script.mjs (the offline checker: `node bin/smak.mjs check rp <file>`), and in
 * levels/rp/README.md. A bad file is refused WHOLE with one log line saying why; the other file and the map go on.
 *
 * Events:   use (a player uses an NPC of rp.json, or a named entity), say (a word or phrase said in chat, near an NPC or
 *           anywhere), hour (the game clock reaches an hour), spawn (a player spawns).
 * Conditions (all must hold): flag, no_flag, money (>=), hour ([from, to)), chance (percent).
 * Actions:  say, give_money, take_money, set_flag, clear_flag, open_menu, open_shop, cooldown.
 *
 * Rules are tried in file order (the map's file first, then global); for use and say the FIRST rule whose conditions
 * hold runs and the event ends (unless the rule says "continue": true); hour and spawn run every rule that matches.
 *
 * Flags are per character and persistent: own table script_flags(ident, flag, value) in
 * addons/amxmodx/data/sqlite3/smak_rp.sq3 (the file smak_core uses; this plugin touches no table of smak_core's).
 * Without smak_core (or for a guest, or if sqlite fails) flags last for the player's session only.
 *
 * smak_core is an OPTIONAL dependency (natives declared here, a native filter, no #pragma reqlib). smak_npc's clock is
 * optional too (levels/rp/plugin/include/smak_npc.inc). smak_items.amxx is called by name for open_shop.
 *
 * Never hooks FM_KeyValue and never uses get_kvd: that crashes Xash3D FWGS 0.21.
 */

#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <engine>
#include <json>
#include <sqlx>

// sqlx.inc only auto-loads the mysql driver; the sqlite one has to be asked for (as smak_core does).
#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

// smak_core (optional): same signatures as smak_core.inc, which is not included because it demands the library.
native smak_char_loaded(id);
native smak_char_ident(id, out[], len);
native smak_money_get(id);
native bool:smak_money_add(id, amount, const reason[]);
native bool:smak_money_take(id, amount, const reason[]);
native smak_currency(out[], len);
// smak_npc's clock (optional)
native Float:smak_npc_hour();
// smak_npc's generated people, by their stable ids (optional; levels/rp/plugin/include/smak_npc.inc)
native smak_npc_find(const id[]);
native bool:smak_npc_name(const id[], name[], len);
native smak_npc_count();

#define PLUGIN  "SMAK script"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define MAXPL          33
#define DB_NAME        "smak_rp"
#define FORMAT         "smak-script/1"

// ---- limits (script.mjs holds the same numbers) -------------------------------------------------------------------
#define MAX_RULES      96       // all files together
#define MAX_FILE_RULES 64       // one file
#define MAX_COND       256
#define MAX_ACT        400
#define MAX_TEXT       220
#define MAX_MENUS      24
#define MAX_FLAGS      128
#define MAX_WORDS      192
#define MAX_NPCS       32
#define MAX_RULE_COND  6
#define MAX_RULE_WORDS 8
#define MAX_LIST       12       // actions in one list
#define MAX_OPTIONS    7
#define MAX_DEPTH      2        // menus inside menus
#define SAY_LEN        150      // bytes of one line (the chat message holds ~190 with the name before it)
#define TITLE_LEN      60
#define OPTION_LEN     40
#define NAME_LEN       32
#define FLAG_LEN       24
#define WORD_LEN       24
#define TEXT_CELLS     (SAY_LEN + 2)
#define MAX_MONEY      100000

// events
#define EV_USE   1
#define EV_SAY   2
#define EV_HOUR  3
#define EV_SPAWN 4
// conditions
#define C_FLAG   1
#define C_NOFLAG 2
#define C_MONEY  3
#define C_HOUR   4
#define C_CHANCE 5
// actions
#define A_SAY    1
#define A_GIVE   2
#define A_TAKE   3
#define A_SET    4
#define A_CLEAR  5
#define A_MENU   6
#define A_SHOP   7
#define A_COOL   8

#define TASK_HOUR  100
#define TASK_SPAWN 200

// ---- the loaded rules ----------------------------------------------------------------------------------------------
new g_map[40];
new g_epoch;

new g_npc_count;
new g_npc_id[MAX_NPCS][NAME_LEN];
new g_npc_name[MAX_NPCS][NAME_LEN + 16];
new Float:g_npc_x[MAX_NPCS];
new Float:g_npc_y[MAX_NPCS];
new g_npc_ent[MAX_NPCS];

new g_rule_n;
new g_r_id[MAX_RULES][NAME_LEN];
new g_r_on[MAX_RULES];
new g_r_npc[MAX_RULES];                 // index in g_npc_*, -1 none
new g_r_ent[MAX_RULES][48];             // targetname for use
new g_r_speaker[MAX_RULES][NAME_LEN + 16];
new g_r_w0[MAX_RULES];
new g_r_wn[MAX_RULES];
new Float:g_r_radius[MAX_RULES];
new g_r_hour[MAX_RULES];
new bool:g_r_duck[MAX_RULES];
new bool:g_r_cont[MAX_RULES];
new g_r_c0[MAX_RULES];
new g_r_cn[MAX_RULES];
new g_r_a0[MAX_RULES];
new g_r_an[MAX_RULES];

new g_word_n;
new g_word[MAX_WORDS][WORD_LEN + 1];

new g_cond_n;
new g_c_type[MAX_COND];
new g_c_a[MAX_COND];
new g_c_b[MAX_COND];

new g_act_n;
new g_a_type[MAX_ACT];
new g_a_n[MAX_ACT];                     // amount, seconds, text index, flag index or menu index

new g_text_n;
new g_text[MAX_TEXT][TEXT_CELLS];

new g_menu_n;
new g_m_title[MAX_MENUS];
new g_m_n[MAX_MENUS];
new g_m_text[MAX_MENUS][MAX_OPTIONS];
new g_m_c0[MAX_MENUS][MAX_OPTIONS];
new g_m_cn[MAX_MENUS][MAX_OPTIONS];
new g_m_a0[MAX_MENUS][MAX_OPTIONS];
new g_m_an[MAX_MENUS][MAX_OPTIONS];

new g_flag_n;
new g_flag_name[MAX_FLAGS][FLAG_LEN + 1];

new g_err[200];                         // why the file being read was refused

// ---- clock, core, database -----------------------------------------------------------------------------------------
new bool:g_core_ok = true;              // smak_core's natives are bound
new bool:g_clock_ok = true;             // smak_npc_hour is bound
new bool:g_gen_ok = true;               // smak_npc's find/name/count natives are bound
new bool:g_npc_gen[MAX_NPCS];           // the NPC is one smak_npc generated (found by smak_npc_find), not one of rp.json
new g_pcv_day;
new g_last_hour = -1;
new Handle:g_tuple = Empty_Handle;
new bool:g_dbok;

// ---- per player ----------------------------------------------------------------------------------------------------
new g_bits[MAXPL][MAX_FLAGS / 32];
new bool:g_ready[MAXPL];                // flags known (loaded, or session only)
new g_gen[MAXPL];
new g_ident[MAXPL][96];
new Float:g_cool[MAXPL][MAX_RULES];
new Float:g_next_use[MAXPL];
new Float:g_next_wait[MAXPL];
new g_pm_epoch[MAXPL];
new g_pm_rule[MAXPL];
new g_pm_menu[MAXPL];
new g_pm_map[MAXPL][MAX_OPTIONS];

// =====================================================================================================================
// start
// =====================================================================================================================

public plugin_natives()
{
	set_native_filter("native_filter");
}

public native_filter(const name[], index, trap)
{
	if (!trap)
	{
		if (equal(name, "smak_npc_", 9))
		{
			g_clock_ok = false;
			g_gen_ok = false;
		}
		else if (equal(name, "smak_char_", 10) || equal(name, "smak_money_", 11) || equal(name, "smak_currency")) g_core_ok = false;
		return PLUGIN_HANDLED;          // keep loading
	}
	return PLUGIN_CONTINUE;
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_cvar("smak_script_version", VERSION, FCVAR_SERVER | FCVAR_SPONLY);
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_clcmd("smak_script_flags", "cmd_flags", ADMIN_ALL, "[clear] - lists your script flags (clear: admin, removes them)");
	register_concmd("smak_script_status", "cmd_status", ADMIN_RCON, "- what smak_script loaded");
	register_concmd("smak_script_reload", "cmd_reload", ADMIN_RCON, "- reads the script files again");
	register_forward(FM_PlayerPreThink, "fw_prethink");
	RegisterHamPlayer(Ham_Spawn, "fw_spawn", 1);
}

public plugin_cfg()
{
	get_mapname(g_map, charsmax(g_map));
	g_pcv_day = get_cvar_pointer("smak_npc_day");
	setup_db();
	load_all();
	set_task(2.0, "task_hour", TASK_HOUR, _, _, "b");
}

public plugin_end()
{
	if (g_tuple != Empty_Handle) SQL_FreeHandle(g_tuple);
}

public client_putinserver(id)
{
	begin_player(id);
}

begin_player(id)
{
	g_gen[id]++;
	arrayset(g_bits[id], 0, sizeof g_bits[]);
	g_ident[id][0] = 0;
	g_ready[id] = false;
	g_pm_epoch[id] = -1;
	g_next_use[id] = 0.0;
	g_next_wait[id] = 0.0;
	for (new r = 0; r < MAX_RULES; r++) g_cool[id][r] = 0.0;
	if (!core_ok())
	{
		g_ready[id] = true;
	}
	else if (smak_char_loaded(id))
	{
		load_flags(id);
	}
	// else: smak_core calls smak_char_loaded_fw when the character is usable
}

/// smak_core's forward: the character is usable (loaded, or a guest).
public smak_char_loaded_fw(id)
{
	if (!is_user_connected(id)) return;
	load_flags(id);
}

bool:core_ok()
{
	return g_core_ok && LibraryExists("smak_core", LibType_Library);
}

// =====================================================================================================================
// database: our own table script_flags(ident, flag, value)
// =====================================================================================================================

setup_db()
{
	g_dbok = false;
	if (g_tuple != Empty_Handle)
	{
		SQL_FreeHandle(g_tuple);
		g_tuple = Empty_Handle;
	}
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_script] no sqlite driver: flags last for the session only");
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
		log_amx("[smak_script] cannot open %s/%s.sq3, code %d: %s. Flags last for the session only.", dir, DB_NAME, errcode, err);
		return;
	}
	new Handle:h = SQL_PrepareQuery(db, "CREATE TABLE IF NOT EXISTS script_flags (ident TEXT NOT NULL, flag TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (ident, flag))");
	new bool:ok = SQL_Execute(h) != 0;
	if (!ok)
	{
		SQL_QueryError(h, err, charsmax(err));
		log_amx("[smak_script] cannot create table script_flags: %s. Flags last for the session only.", err);
	}
	SQL_FreeHandle(h);
	SQL_FreeHandle(db);
	g_dbok = ok;
}

/// A key safe to put in a quoted SQL string.
bool:safe_ident(const s[])
{
	new n = strlen(s);
	if (n < 6 || n > 90) return false;
	for (new i = 0; i < n; i++)
	{
		new c = s[i];
		if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ':' || c == '_' || c == '-' || c == '.')) return false;
	}
	return true;
}

load_flags(id)
{
	g_ident[id][0] = 0;
	arrayset(g_bits[id], 0, sizeof g_bits[]);
	g_ready[id] = true;
	if (!core_ok() || !g_dbok) return;
	new ident[96];
	smak_char_ident(id, ident, charsmax(ident));
	if (!ident[0]) return;                                  // a guest: session only
	if (!safe_ident(ident))
	{
		log_amx("[smak_script] player %d: the character key has odd characters, flags are session only", id);
		return;
	}
	copy(g_ident[id], charsmax(g_ident[]), ident);
	g_ready[id] = false;
	new q[200], data[2];
	formatex(q, charsmax(q), "SELECT flag FROM script_flags WHERE ident = '%s' AND value = 1", ident);
	data[0] = id;
	data[1] = g_gen[id];
	SQL_ThreadQuery(g_tuple, "th_load", q, data, 2);
}

public th_load(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	new id = data[0];
	if (!is_user_connected(id) || data[1] != g_gen[id]) return;
	g_ready[id] = true;
	if (failstate != TQUERY_SUCCESS)
	{
		log_amx("[smak_script] cannot read the flags of player %d (they are session only): %s", id, error);
		g_ident[id][0] = 0;
		return;
	}
	new name[FLAG_LEN + 1];
	while (SQL_MoreResults(query))
	{
		SQL_ReadResult(query, 0, name, charsmax(name));
		new f = find_flag(name);
		if (f >= 0) g_bits[id][f / 32] |= (1 << (f % 32));
		SQL_NextRow(query);
	}
}

save_flag(id, f, value)
{
	if (!g_dbok || !g_ident[id][0]) return;
	new q[256];
	formatex(q, charsmax(q), "INSERT OR REPLACE INTO script_flags (ident, flag, value) VALUES ('%s', '%s', %d)", g_ident[id], g_flag_name[f], value);
	new data[1];
	data[0] = f;
	SQL_ThreadQuery(g_tuple, "th_write", q, data, 1);
}

public th_write(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate != TQUERY_SUCCESS) log_amx("[smak_script] cannot save flag %s: %s", g_flag_name[data[0]], error);
}

// =====================================================================================================================
// flags in memory
// =====================================================================================================================

find_flag(const name[])
{
	for (new i = 0; i < g_flag_n; i++)
	{
		if (equal(g_flag_name[i], name)) return i;
	}
	return -1;
}

/// The index of a flag name, added when new; -1 when the table is full.
intern_flag(const name[])
{
	new f = find_flag(name);
	if (f >= 0) return f;
	if (g_flag_n >= MAX_FLAGS) return -1;
	copy(g_flag_name[g_flag_n], FLAG_LEN, name);
	return g_flag_n++;
}

bool:pflag(id, f)
{
	return (g_bits[id][f / 32] & (1 << (f % 32))) != 0;
}

set_flag_of(id, f, bool:on)
{
	if (pflag(id, f) == on) return;
	if (on) g_bits[id][f / 32] |= (1 << (f % 32));
	else g_bits[id][f / 32] &= ~(1 << (f % 32));
	save_flag(id, f, on ? 1 : 0);
}

// =====================================================================================================================
// reading the files
// =====================================================================================================================

bool:fail(const fmt[], any:...)
{
	vformat(g_err, charsmax(g_err), fmt, 2);
	return false;
}

bool:valid_name(const s[], maxlen)
{
	new n = strlen(s);
	if (n < 1 || n > maxlen) return false;
	for (new i = 0; i < n; i++)
	{
		new c = s[i];
		if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
	}
	return true;
}

load_all()
{
	g_rule_n = 0; g_word_n = 0; g_cond_n = 0; g_act_n = 0; g_text_n = 0; g_menu_n = 0; g_flag_n = 0;
	g_npc_count = 0;
	g_epoch++;
	for (new i = 0; i < MAX_NPCS; i++)
	{
		g_npc_ent[i] = 0;
		g_npc_gen[i] = false;
	}
	for (new id = 1; id < MAXPL; id++) g_pm_epoch[id] = -1;
	// flags are interned per load: players' bits are cleared, so ask the characters again
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));

	formatex(path, charsmax(path), "%s/smak_rp/%s.rp.json", dir, g_map);
	read_npcs(path);

	new loaded = 0;
	formatex(path, charsmax(path), "%s/smak_rp/%s.script.json", dir, g_map);
	if (file_exists(path))
	{
		if (load_file(path, false)) loaded++;
	}
	else
	{
		log_amx("[smak_script] no %s.script.json for this map", g_map);
	}
	formatex(path, charsmax(path), "%s/smak_rp/global.script.json", dir);
	if (file_exists(path))
	{
		if (load_file(path, true)) loaded++;
	}
	log_amx("[smak_script] %s: %d file(s) read, %d rule(s), %d flag name(s), %d action(s), %d menu(s); clock: %s",
		g_map, loaded, g_rule_n, g_flag_n, g_act_n, g_menu_n, (g_clock_ok ? "smak_npc" : "own (no smak_npc_hour native)"));
	for (new id = 1; id < MAXPL; id++)
	{
		if (is_user_connected(id)) begin_player(id);
	}
}

/// The map's npcs (id, name, at) from its rp.json. Missing file: no npcs (rules naming one are then refused).
read_npcs(const path[])
{
	if (!file_exists(path)) return;
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON) return;
	if (json_is_object_safe(root))
	{
		new JSON:list = json_object_get_value(root, "npcs");
		if (list != Invalid_JSON)
		{
			if (json_get_type(list) == JSONArray)
			{
				new count = min(json_array_get_count(list), MAX_NPCS);
				for (new i = 0; i < count; i++)
				{
					new JSON:one = json_array_get_value(list, i);
					if (one == Invalid_JSON) continue;
					new n = g_npc_count;
					json_object_get_string(one, "id", g_npc_id[n], NAME_LEN - 1);
					json_object_get_string(one, "name", g_npc_name[n], charsmax(g_npc_name[]));
					new JSON:at = json_object_get_value(one, "at");
					if (at != Invalid_JSON)
					{
						g_npc_x[n] = json_array_get_real(at, 0);
						g_npc_y[n] = json_array_get_real(at, 1);
						json_free(at);
					}
					if (g_npc_id[n][0]) g_npc_count++;
					json_free(one);
				}
			}
			json_free(list);
		}
	}
	json_free(root);
}

bool:json_is_object_safe(JSON:v)
{
	return json_get_type(v) == JSONObject;
}

/// One script file; false (and nothing kept) when it is refused. A refusal is logged with its reason.
bool:load_file(const path[], bool:global)
{
	new m_rule = g_rule_n, m_word = g_word_n, m_cond = g_cond_n, m_act = g_act_n, m_text = g_text_n, m_menu = g_menu_n, m_flag = g_flag_n;
	g_err[0] = 0;
	new bool:ok = read_script(path, global);
	if (!ok)
	{
		g_rule_n = m_rule; g_word_n = m_word; g_cond_n = m_cond; g_act_n = m_act; g_text_n = m_text; g_menu_n = m_menu; g_flag_n = m_flag;
		log_amx("[smak_script] REFUSED %s: %s", path, g_err);
	}
	return ok;
}

bool:read_script(const path[], bool:global)
{
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON) return fail("not valid JSON");
	if (json_get_type(root) != JSONObject)
	{
		json_free(root);
		return fail("the file is not a JSON object");
	}
	new bool:ok = read_root(root, global);
	json_free(root);
	return ok;
}

bool:allowed_keys(JSON:obj, const keys[][], count, const where[])
{
	new n = json_object_get_count(obj);
	new name[32];
	for (new i = 0; i < n; i++)
	{
		json_object_get_name(obj, i, name, charsmax(name));
		new bool:found = false;
		for (new k = 0; k < count; k++)
		{
			if (equal(name, keys[k]))
			{
				found = true;
				break;
			}
		}
		if (!found) return fail("%s: unknown key '%s'", where, name);
	}
	return true;
}

bool:read_root(JSON:root, bool:global)
{
	new const keys[][] = { "format", "map", "note", "rules" };
	if (!allowed_keys(root, keys, sizeof keys, "file")) return false;
	new text[64];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, FORMAT)) return fail("format is '%s', expected '%s'", text, FORMAT);
	if (json_object_has_value(root, "map"))
	{
		json_object_get_string(root, "map", text, charsmax(text));
		if (!global && !equal(text, g_map)) return fail("the file is for map %s, this map is %s", text, g_map);
	}
	new JSON:rules = json_object_get_value(root, "rules");
	if (rules == Invalid_JSON) return fail("no 'rules' list");
	new bool:ok = true;
	if (json_get_type(rules) != JSONArray) ok = fail("'rules' is not a list");
	else
	{
		new count = json_array_get_count(rules);
		if (count < 1 || count > MAX_FILE_RULES) ok = fail("'rules' has %d rules, from 1 to %d are allowed", count, MAX_FILE_RULES);
		else
		{
			new first = g_rule_n;
			for (new i = 0; i < count && ok; i++)
			{
				new JSON:one = json_array_get_value(rules, i);
				if (one == Invalid_JSON || json_get_type(one) != JSONObject)
				{
					ok = fail("rule %d is not an object", i + 1);
				}
				else
				{
					ok = read_rule(one, i + 1, global, first);
				}
				if (one != Invalid_JSON) json_free(one);
			}
		}
	}
	json_free(rules);
	return ok;
}

bool:read_rule(JSON:o, number, bool:global, first)
{
	new const keys[][] = { "id", "on", "npc", "entity", "words", "radius", "hour", "speaker", "duck", "continue", "if", "do" };
	new where[48];
	formatex(where, charsmax(where), "rule %d", number);
	if (!allowed_keys(o, keys, sizeof keys, where)) return false;
	if (g_rule_n >= MAX_RULES) return fail("%s: more than %d rules in all", where, MAX_RULES);
	new r = g_rule_n;

	new id[NAME_LEN + 8];
	json_object_get_string(o, "id", id, charsmax(id));
	if (!valid_name(id, NAME_LEN - 1)) return fail("%s: 'id' must be 1 to %d characters of a-z 0-9 _", where, NAME_LEN - 1);
	for (new k = first; k < r; k++)
	{
		if (equal(g_r_id[k], id)) return fail("%s: the id '%s' is used twice", where, id);
	}
	formatex(where, charsmax(where), "rule %s", id);
	copy(g_r_id[r], NAME_LEN - 1, id);

	new on[16];
	json_object_get_string(o, "on", on, charsmax(on));
	if (equal(on, "use")) g_r_on[r] = EV_USE;
	else if (equal(on, "say")) g_r_on[r] = EV_SAY;
	else if (equal(on, "hour")) g_r_on[r] = EV_HOUR;
	else if (equal(on, "spawn")) g_r_on[r] = EV_SPAWN;
	else return fail("%s: 'on' is '%s', expected use, say, hour or spawn", where, on);

	g_r_npc[r] = -1;
	g_r_ent[r][0] = 0;
	g_r_speaker[r][0] = 0;
	g_r_w0[r] = 0; g_r_wn[r] = 0;
	g_r_radius[r] = 300.0;
	g_r_hour[r] = -1;
	g_r_duck[r] = false;
	g_r_cont[r] = false;

	if (json_object_has_value(o, "npc"))
	{
		new npc[NAME_LEN + 8];
		if (json_object_has_value(o, "npc", JSONString) == false) return fail("%s: 'npc' is not a string", where);
		json_object_get_string(o, "npc", npc, charsmax(npc));
		for (new n = 0; n < g_npc_count; n++)
		{
			if (equal(g_npc_id[n], npc))
			{
				g_r_npc[r] = n;
				break;
			}
		}
		if (g_r_npc[r] < 0 && g_gen_ok)
		{
			// not in rp.json: a person smak_npc generated (its plugin_cfg ran first, so the list is made)
			new gname[NAME_LEN + 16];
			if (smak_npc_count() > 0 && smak_npc_name(npc, gname, charsmax(gname)) && g_npc_count < MAX_NPCS)
			{
				new n = g_npc_count++;
				copy(g_npc_id[n], charsmax(g_npc_id[]), npc);
				copy(g_npc_name[n], charsmax(g_npc_name[]), gname);
				g_npc_x[n] = 0.0;
				g_npc_y[n] = 0.0;
				g_npc_ent[n] = 0;
				g_npc_gen[n] = true;
				g_r_npc[r] = n;
			}
			else if (smak_npc_count() == 0)
			{
				log_amx("[smak_script] rule %s skipped: '%s' is not in rp.json and smak_npc made no NPCs (is smak_npc.amxx listed before smak_script.amxx, and smak_npc_enable 1?)", id, npc);
				return true;
			}
		}
		if (g_r_npc[r] < 0)
		{
			if (global)
			{
				log_amx("[smak_script] global rule %s skipped: this map has no NPC '%s'", id, npc);
				return true;
			}
			return fail("%s: the NPC '%s' is not in %s.rp.json", where, npc, g_map);
		}
		copy(g_r_speaker[r], charsmax(g_r_speaker[]), g_npc_name[g_r_npc[r]]);
	}
	if (json_object_has_value(o, "entity"))
	{
		if (!json_object_has_value(o, "entity", JSONString)) return fail("%s: 'entity' is not a string", where);
		json_object_get_string(o, "entity", g_r_ent[r], charsmax(g_r_ent[]));
		if (!g_r_ent[r][0] || strlen(g_r_ent[r]) > 47) return fail("%s: 'entity' must be a targetname of 1 to 47 characters", where);
	}
	if (json_object_has_value(o, "speaker"))
	{
		if (!json_object_has_value(o, "speaker", JSONString)) return fail("%s: 'speaker' is not a string", where);
		json_object_get_string(o, "speaker", g_r_speaker[r], NAME_LEN - 1);
	}
	if (json_object_has_value(o, "duck"))
	{
		if (!json_object_has_value(o, "duck", JSONBoolean)) return fail("%s: 'duck' is not true or false", where);
		g_r_duck[r] = json_object_get_bool(o, "duck");
	}
	if (json_object_has_value(o, "continue"))
	{
		if (!json_object_has_value(o, "continue", JSONBoolean)) return fail("%s: 'continue' is not true or false", where);
		g_r_cont[r] = json_object_get_bool(o, "continue");
	}
	if (json_object_has_value(o, "radius"))
	{
		if (!json_object_has_value(o, "radius", JSONNumber)) return fail("%s: 'radius' is not a number", where);
		new rad = json_object_get_number(o, "radius");
		if (rad < 32 || rad > 4000) return fail("%s: 'radius' is %d, from 32 to 4000 are allowed", where, rad);
		g_r_radius[r] = float(rad);
	}

	switch (g_r_on[r])
	{
		case EV_USE:
		{
			if ((g_r_npc[r] < 0) == (g_r_ent[r][0] == 0)) return fail("%s: a use rule names exactly one of 'npc' and 'entity'", where);
		}
		case EV_SAY:
		{
			if (!read_words(o, r, where)) return false;
		}
		case EV_HOUR:
		{
			if (!json_object_has_value(o, "hour", JSONNumber)) return fail("%s: an hour rule needs 'hour' (0 to 23)", where);
			g_r_hour[r] = json_object_get_number(o, "hour");
			if (g_r_hour[r] < 0 || g_r_hour[r] > 23) return fail("%s: 'hour' is %d, from 0 to 23 are allowed", where, g_r_hour[r]);
		}
	}

	g_r_c0[r] = g_cond_n; g_r_cn[r] = 0;
	if (json_object_has_value(o, "if"))
	{
		new JSON:conds = json_object_get_value(o, "if");
		new bool:ok = read_conds(conds, g_r_c0[r], g_r_cn[r], where);
		json_free(conds);
		if (!ok) return false;
	}
	new JSON:acts = json_object_get_value(o, "do");
	if (acts == Invalid_JSON) return fail("%s: no 'do' list", where);
	new bool:ok2 = read_actions(acts, 0, g_r_a0[r], g_r_an[r], where);
	json_free(acts);
	if (!ok2) return false;
	g_rule_n++;
	return true;
}

bool:read_words(JSON:o, r, const where[])
{
	new JSON:w = json_object_get_value(o, "words");
	if (w == Invalid_JSON) return fail("%s: a say rule needs 'words'", where);
	new bool:ok = true;
	if (json_get_type(w) != JSONArray) ok = fail("%s: 'words' is not a list", where);
	else
	{
		new count = json_array_get_count(w);
		if (count < 1 || count > MAX_RULE_WORDS) ok = fail("%s: 'words' has %d entries, from 1 to %d are allowed", where, count, MAX_RULE_WORDS);
		else if (g_word_n + count > MAX_WORDS) ok = fail("%s: too many keywords in all (%d)", where, MAX_WORDS);
		else
		{
			g_r_w0[r] = g_word_n;
			for (new i = 0; i < count && ok; i++)
			{
				new JSON:v = json_array_get_value(w, i);
				if (v == Invalid_JSON || json_get_type(v) != JSONString)
				{
					ok = fail("%s: word %d is not a string", where, i + 1);
				}
				else
				{
					new s[64];
					json_get_string(v, s, charsmax(s));
					normalise(s);
					if (strlen(s) < 2 || strlen(s) > WORD_LEN) ok = fail("%s: word %d must be 2 to %d letters after the case and marks are taken off", where, i + 1, WORD_LEN);
					else copy(g_word[g_word_n++], WORD_LEN, s);
				}
				if (v != Invalid_JSON) json_free(v);
			}
			g_r_wn[r] = g_word_n - g_r_w0[r];
		}
	}
	json_free(w);
	return ok;
}

bool:read_conds(JSON:arr, &first, &n, const where[])
{
	if (arr == Invalid_JSON || json_get_type(arr) != JSONArray) return fail("%s: 'if' is not a list", where);
	new count = json_array_get_count(arr);
	if (count > MAX_RULE_COND) return fail("%s: 'if' has %d conditions, at most %d", where, count, MAX_RULE_COND);
	if (g_cond_n + count > MAX_COND) return fail("%s: too many conditions in all (%d)", where, MAX_COND);
	first = g_cond_n;
	n = count;
	g_cond_n += count;
	for (new i = 0; i < count; i++)
	{
		new JSON:c = json_array_get_value(arr, i);
		new bool:ok = read_cond(c, first + i, where);
		if (c != Invalid_JSON) json_free(c);
		if (!ok) return false;
	}
	return true;
}

bool:read_cond(JSON:c, slot, const where[])
{
	if (c == Invalid_JSON || json_get_type(c) != JSONObject || json_object_get_count(c) != 1) return fail("%s: a condition is an object with one key", where);
	new key[16];
	json_object_get_name(c, 0, key, charsmax(key));
	new JSON:v = json_object_get_value_at(c, 0);
	new bool:ok = true;
	new JSONType:t = json_get_type(v);
	if (equal(key, "flag") || equal(key, "no_flag"))
	{
		new s[FLAG_LEN + 8];
		if (t != JSONString) ok = fail("%s: condition %s wants a flag name", where, key);
		else
		{
			json_get_string(v, s, charsmax(s));
			if (!valid_name(s, FLAG_LEN)) ok = fail("%s: the flag name '%s' must be 1 to %d characters of a-z 0-9 _", where, s, FLAG_LEN);
			else
			{
				new f = intern_flag(s);
				if (f < 0) ok = fail("%s: more than %d flag names in all", where, MAX_FLAGS);
				g_c_type[slot] = equal(key, "flag") ? C_FLAG : C_NOFLAG;
				g_c_a[slot] = f;
			}
		}
	}
	else if (equal(key, "money"))
	{
		if (t != JSONNumber) ok = fail("%s: condition money wants a number", where);
		else
		{
			g_c_type[slot] = C_MONEY;
			g_c_a[slot] = json_get_number(v);
			if (g_c_a[slot] < 1 || g_c_a[slot] > 1000000000) ok = fail("%s: money must be from 1 to 1000000000", where);
		}
	}
	else if (equal(key, "chance"))
	{
		if (t != JSONNumber) ok = fail("%s: condition chance wants a percent", where);
		else
		{
			g_c_type[slot] = C_CHANCE;
			g_c_a[slot] = json_get_number(v);
			if (g_c_a[slot] < 1 || g_c_a[slot] > 99) ok = fail("%s: chance must be from 1 to 99 (a percent)", where);
		}
	}
	else if (equal(key, "hour"))
	{
		if (t != JSONArray || json_array_get_count(v) != 2) ok = fail("%s: condition hour wants [from, to]", where);
		else
		{
			g_c_type[slot] = C_HOUR;
			g_c_a[slot] = json_array_get_number(v, 0);
			g_c_b[slot] = json_array_get_number(v, 1);
			if (g_c_a[slot] < 0 || g_c_a[slot] > 24 || g_c_b[slot] < 0 || g_c_b[slot] > 24 || g_c_a[slot] == g_c_b[slot]) ok = fail("%s: hour wants two different hours from 0 to 24", where);
		}
	}
	else ok = fail("%s: unknown condition '%s'", where, key);
	json_free(v);
	return ok;
}

add_text(const s[])
{
	copy(g_text[g_text_n], TEXT_CELLS - 1, s);
	return g_text_n++;
}

bool:read_actions(JSON:arr, depth, &first, &n, const where[])
{
	if (arr == Invalid_JSON || json_get_type(arr) != JSONArray) return fail("%s: 'do' is not a list", where);
	new count = json_array_get_count(arr);
	if (count < 1 || count > MAX_LIST) return fail("%s: an action list has %d entries, from 1 to %d are allowed", where, count, MAX_LIST);
	if (g_act_n + count > MAX_ACT) return fail("%s: too many actions in all (%d)", where, MAX_ACT);
	first = g_act_n;
	n = count;
	g_act_n += count;
	for (new i = 0; i < count; i++)
	{
		new JSON:a = json_array_get_value(arr, i);
		new bool:ok = read_action(a, first + i, depth, where);
		if (a != Invalid_JSON) json_free(a);
		if (!ok) return false;
	}
	return true;
}

bool:read_action(JSON:a, slot, depth, const where[])
{
	if (a == Invalid_JSON || json_get_type(a) != JSONObject || json_object_get_count(a) != 1) return fail("%s: an action is an object with one key", where);
	new key[16];
	json_object_get_name(a, 0, key, charsmax(key));
	new JSON:v = json_object_get_value_at(a, 0);
	new JSONType:t = json_get_type(v);
	new bool:ok = true;
	new s[SAY_LEN + 64];
	if (equal(key, "say"))
	{
		if (t != JSONString) ok = fail("%s: say wants a text", where);
		else
		{
			json_get_string(v, s, charsmax(s));
			if (!s[0] || strlen(s) > SAY_LEN) ok = fail("%s: a say line must be 1 to %d bytes, this one is %d", where, SAY_LEN, strlen(s));
			else if (g_text_n >= MAX_TEXT) ok = fail("%s: too many texts in all (%d)", where, MAX_TEXT);
			else
			{
				g_a_type[slot] = A_SAY;
				g_a_n[slot] = add_text(s);
			}
		}
	}
	else if (equal(key, "give_money") || equal(key, "take_money"))
	{
		if (t != JSONNumber) ok = fail("%s: %s wants a number", where, key);
		else
		{
			g_a_type[slot] = (key[0] == 'g') ? A_GIVE : A_TAKE;
			g_a_n[slot] = json_get_number(v);
			if (g_a_n[slot] < 1 || g_a_n[slot] > MAX_MONEY) ok = fail("%s: %s must be from 1 to %d", where, key, MAX_MONEY);
		}
	}
	else if (equal(key, "set_flag") || equal(key, "clear_flag"))
	{
		if (t != JSONString) ok = fail("%s: %s wants a flag name", where, key);
		else
		{
			json_get_string(v, s, charsmax(s));
			if (!valid_name(s, FLAG_LEN)) ok = fail("%s: the flag name '%s' must be 1 to %d characters of a-z 0-9 _", where, s, FLAG_LEN);
			else
			{
				new f = intern_flag(s);
				if (f < 0) ok = fail("%s: more than %d flag names in all", where, MAX_FLAGS);
				g_a_type[slot] = (key[0] == 's') ? A_SET : A_CLEAR;
				g_a_n[slot] = f;
			}
		}
	}
	else if (equal(key, "open_shop"))
	{
		if (t != JSONString) ok = fail("%s: open_shop wants a shop id", where);
		else
		{
			json_get_string(v, s, charsmax(s));
			if (!valid_name(s, NAME_LEN - 1)) ok = fail("%s: the shop id '%s' must be 1 to %d characters of a-z 0-9 _", where, s, NAME_LEN - 1);
			else if (g_text_n >= MAX_TEXT) ok = fail("%s: too many texts in all (%d)", where, MAX_TEXT);
			else
			{
				g_a_type[slot] = A_SHOP;
				g_a_n[slot] = add_text(s);
			}
		}
	}
	else if (equal(key, "cooldown"))
	{
		if (t != JSONNumber) ok = fail("%s: cooldown wants seconds", where);
		else
		{
			g_a_type[slot] = A_COOL;
			g_a_n[slot] = json_get_number(v);
			if (g_a_n[slot] < 1 || g_a_n[slot] > 86400) ok = fail("%s: cooldown must be from 1 to 86400 seconds", where);
		}
	}
	else if (equal(key, "open_menu"))
	{
		if (t != JSONObject) ok = fail("%s: open_menu wants an object {title, options}", where);
		else if (depth >= MAX_DEPTH) ok = fail("%s: menus inside menus go %d deep at most", where, MAX_DEPTH);
		else
		{
			g_a_type[slot] = A_MENU;
			ok = read_menu(v, depth + 1, g_a_n[slot], where);
		}
	}
	else ok = fail("%s: unknown action '%s'", where, key);
	json_free(v);
	return ok;
}

bool:read_menu(JSON:m, depth, &index, const where[])
{
	new const keys[][] = { "title", "options" };
	if (!allowed_keys(m, keys, sizeof keys, where)) return false;
	if (g_menu_n >= MAX_MENUS) return fail("%s: more than %d menus in all", where, MAX_MENUS);
	index = g_menu_n++;
	new s[TITLE_LEN + 64];
	json_object_get_string(m, "title", s, charsmax(s));
	if (!s[0] || strlen(s) > TITLE_LEN) return fail("%s: a menu title must be 1 to %d bytes", where, TITLE_LEN);
	if (g_text_n >= MAX_TEXT) return fail("%s: too many texts in all (%d)", where, MAX_TEXT);
	g_m_title[index] = add_text(s);
	new JSON:opts = json_object_get_value(m, "options");
	if (opts == Invalid_JSON) return fail("%s: a menu needs 'options'", where);
	new bool:ok = true;
	if (json_get_type(opts) != JSONArray) ok = fail("%s: 'options' is not a list", where);
	else
	{
		new count = json_array_get_count(opts);
		if (count < 1 || count > MAX_OPTIONS) ok = fail("%s: a menu has %d options, from 1 to %d are allowed", where, count, MAX_OPTIONS);
		else
		{
			g_m_n[index] = count;
			for (new i = 0; i < count && ok; i++)
			{
				new JSON:o = json_array_get_value(opts, i);
				ok = read_option(o, index, i, depth, where);
				if (o != Invalid_JSON) json_free(o);
			}
		}
	}
	json_free(opts);
	return ok;
}

bool:read_option(JSON:o, mi, oi, depth, const where[])
{
	new const keys[][] = { "text", "if", "do" };
	if (o == Invalid_JSON || json_get_type(o) != JSONObject) return fail("%s: a menu option is not an object", where);
	if (!allowed_keys(o, keys, sizeof keys, where)) return false;
	new s[OPTION_LEN + 64];
	json_object_get_string(o, "text", s, charsmax(s));
	if (!s[0] || strlen(s) > OPTION_LEN) return fail("%s: an option's text must be 1 to %d bytes", where, OPTION_LEN);
	if (g_text_n >= MAX_TEXT) return fail("%s: too many texts in all (%d)", where, MAX_TEXT);
	g_m_text[mi][oi] = add_text(s);
	g_m_c0[mi][oi] = g_cond_n; g_m_cn[mi][oi] = 0;
	if (json_object_has_value(o, "if"))
	{
		new JSON:conds = json_object_get_value(o, "if");
		new bool:ok = read_conds(conds, g_m_c0[mi][oi], g_m_cn[mi][oi], where);
		json_free(conds);
		if (!ok) return false;
	}
	new JSON:acts = json_object_get_value(o, "do");
	if (acts == Invalid_JSON) return fail("%s: a menu option needs 'do'", where);
	new bool:ok2 = read_actions(acts, depth, g_m_a0[mi][oi], g_m_an[mi][oi], where);
	json_free(acts);
	return ok2;
}

// =====================================================================================================================
// text
// =====================================================================================================================

/// Lower case, only a-z and 0-9 kept, any run of other characters becomes one space, no space at the ends.
normalise(s[])
{
	new out[160], n = 0;
	new bool:gap = true;
	new len = strlen(s);
	for (new i = 0; i < len && n < charsmax(out) - 1; i++)
	{
		new c = s[i];
		if (c >= 'A' && c <= 'Z') c += 32;
		if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
		{
			out[n++] = c;
			gap = false;
		}
		else if (!gap)
		{
			out[n++] = ' ';
			gap = true;
		}
	}
	if (n > 0 && out[n - 1] == ' ') n--;
	out[n] = 0;
	copy(s, len, out);
}

// =====================================================================================================================
// NPCs and what a player looks at
// =====================================================================================================================

/// The entity of an NPC: one smak_npc generated (by its id), or one of rp.json (smak_rp makes it, class smak_rp_npc, at the JSON's x and y); 0 if it is not there.
npc_entity(n)
{
	if (g_npc_gen[n]) return g_gen_ok ? smak_npc_find(g_npc_id[n]) : 0;
	new ent = g_npc_ent[n];
	if (ent > 0 && pev_valid(ent))
	{
		new cls[24];
		pev(ent, pev_classname, cls, charsmax(cls));
		if (equal(cls, "smak_rp_npc")) return ent;
	}
	g_npc_ent[n] = 0;
	ent = -1;
	while ((ent = find_ent_by_class(ent, "smak_rp_npc")) > 0)
	{
		new Float:o[3];
		pev(ent, pev_origin, o);
		if (floatabs(o[0] - g_npc_x[n]) < 6.0 && floatabs(o[1] - g_npc_y[n]) < 6.0)
		{
			g_npc_ent[n] = ent;
			return ent;
		}
	}
	return 0;
}

/// What the player's eye line hits in front of them (0 if nothing).
looked_ent(id)
{
	new Float:eye[3], Float:ofs[3], Float:ang[3], Float:fwd[3], Float:end[3];
	pev(id, pev_origin, eye);
	pev(id, pev_view_ofs, ofs);
	for (new k = 0; k < 3; k++) eye[k] += ofs[k];
	pev(id, pev_v_angle, ang);
	angle_vector(ang, ANGLEVECTOR_FORWARD, fwd);
	for (new k = 0; k < 3; k++) end[k] = eye[k] + fwd[k] * 112.0;
	new tr = create_tr2();
	engfunc(EngFunc_TraceLine, eye, end, DONT_IGNORE_MONSTERS, id, tr);
	new hit = get_tr2(tr, TR_pHit);
	free_tr2(tr);
	return (hit > 0) ? hit : 0;
}

/// Is the player using this NPC: the line hits it, or it is close and nearly in the middle of the view.
bool:aimed_at(id, ent, hit)
{
	if (ent <= 0) return false;
	if (hit == ent) return true;
	new Float:eye[3], Float:ofs[3], Float:ang[3], Float:fwd[3], Float:at[3], Float:to[3];
	pev(id, pev_origin, eye);
	pev(id, pev_view_ofs, ofs);
	for (new k = 0; k < 3; k++) eye[k] += ofs[k];
	pev(id, pev_v_angle, ang);
	angle_vector(ang, ANGLEVECTOR_FORWARD, fwd);
	pev(ent, pev_origin, at);
	for (new k = 0; k < 3; k++) to[k] = at[k] - eye[k];
	new Float:dist = vector_length(to);
	if (dist > 112.0 || dist < 1.0) return false;
	return (to[0] * fwd[0] + to[1] * fwd[1] + to[2] * fwd[2]) / dist > 0.9;
}

Float:distance_to(id, ent)
{
	new Float:a[3], Float:b[3];
	pev(id, pev_origin, a);
	pev(ent, pev_origin, b);
	return get_distance_f(a, b);
}

// =====================================================================================================================
// the game clock
// =====================================================================================================================

Float:game_hour()
{
	if (g_clock_ok) return smak_npc_hour();
	// the same formula as smak_npc, without the admin shift of smak_npc_hour
	new daysec = 48 * 60;
	if (g_pcv_day) daysec = max(60, floatround(get_pcvar_float(g_pcv_day) * 60.0));
	new t = get_systime() % daysec;
	return float(t) * 24.0 / float(daysec);
}

public task_hour()
{
	new cur = floatround(game_hour(), floatround_floor) % 24;
	if (g_last_hour < 0)
	{
		g_last_hour = cur;
		return;
	}
	if (cur == g_last_hour) return;
	new steps = (cur - g_last_hour + 24) % 24;
	if (steps > 6)
	{
		// the clock was set by hand: only the hour it is now
		fire_hour(cur);
	}
	else
	{
		for (new k = 1; k <= steps; k++) fire_hour((g_last_hour + k) % 24);
	}
	g_last_hour = cur;
}

fire_hour(hour)
{
	for (new r = 0; r < g_rule_n; r++)
	{
		if (g_r_on[r] != EV_HOUR || g_r_hour[r] != hour) continue;
		new ent = (g_r_npc[r] >= 0) ? npc_entity(g_r_npc[r]) : 0;
		for (new id = 1; id < MAXPL; id++)
		{
			if (!is_user_connected(id) || !is_user_alive(id) || !g_ready[id]) continue;
			if (g_r_npc[r] >= 0)
			{
				if (ent <= 0 || distance_to(id, ent) > g_r_radius[r]) continue;
			}
			try_rule(id, r);
		}
	}
}

// =====================================================================================================================
// events
// =====================================================================================================================

public fw_prethink(id)
{
	if (g_rule_n < 1 || !is_user_alive(id)) return FMRES_IGNORED;
	new buttons = pev(id, pev_button);
	if (!(buttons & IN_USE) || (pev(id, pev_oldbuttons) & IN_USE)) return FMRES_IGNORED;
	new Float:now = get_gametime();
	if (now < g_next_use[id]) return FMRES_IGNORED;
	new hit = looked_ent(id);
	new bool:any = false;
	for (new r = 0; r < g_rule_n; r++)
	{
		if (g_r_on[r] != EV_USE) continue;
		if (g_r_duck[r] && !(pev(id, pev_flags) & FL_DUCKING)) continue;
		if (g_r_npc[r] >= 0)
		{
			if (!aimed_at(id, npc_entity(g_r_npc[r]), hit)) continue;
		}
		else
		{
			if (hit <= 0) continue;
			new tn[48];
			pev(hit, pev_targetname, tn, charsmax(tn));
			if (!equal(tn, g_r_ent[r])) continue;
		}
		any = true;
		if (!g_ready[id])
		{
			wait_message(id);
			break;
		}
		if (try_rule(id, r) && !g_r_cont[r]) break;
	}
	if (any) g_next_use[id] = now + 0.5;
	return FMRES_IGNORED;
}

public cmd_say(id)
{
	if (g_rule_n < 1) return PLUGIN_CONTINUE;
	new msg[192];
	read_args(msg, charsmax(msg));
	remove_quotes(msg);
	normalise(msg);
	if (!msg[0]) return PLUGIN_CONTINUE;
	new padded[200];
	formatex(padded, charsmax(padded), " %s ", msg);
	for (new r = 0; r < g_rule_n; r++)
	{
		if (g_r_on[r] != EV_SAY) continue;
		new bool:heard = false;
		for (new w = g_r_w0[r]; w < g_r_w0[r] + g_r_wn[r]; w++)
		{
			new needle[WORD_LEN + 4];
			formatex(needle, charsmax(needle), " %s ", g_word[w]);
			if (contain(padded, needle) != -1)
			{
				heard = true;
				break;
			}
		}
		if (!heard) continue;
		if (g_r_npc[r] >= 0)
		{
			new ent = npc_entity(g_r_npc[r]);
			if (ent <= 0 || !is_user_alive(id) || distance_to(id, ent) > g_r_radius[r]) continue;
		}
		if (g_r_duck[r] && !(pev(id, pev_flags) & FL_DUCKING)) continue;
		if (!g_ready[id])
		{
			wait_message(id);
			break;
		}
		if (try_rule(id, r) && !g_r_cont[r]) break;
	}
	return PLUGIN_CONTINUE;           // the player's words still go to the chat
}

public fw_spawn(id)
{
	if (g_rule_n < 1 || !is_user_alive(id)) return HAM_IGNORED;
	remove_task(id + TASK_SPAWN);
	set_task(1.5, "task_spawn", id + TASK_SPAWN);
	return HAM_IGNORED;
}

public task_spawn(taskid)
{
	new id = taskid - TASK_SPAWN;
	if (!is_user_connected(id) || !is_user_alive(id) || !g_ready[id]) return;
	for (new r = 0; r < g_rule_n; r++)
	{
		if (g_r_on[r] == EV_SPAWN) try_rule(id, r);
	}
}

wait_message(id)
{
	new Float:now = get_gametime();
	if (now < g_next_wait[id]) return;
	g_next_wait[id] = now + 3.0;
	client_print(id, print_chat, "[SMAK] Tu personaje se esta cargando, espera un momento.");
}

// =====================================================================================================================
// rules: conditions and actions
// =====================================================================================================================

bool:conds_hold(id, c0, cn)
{
	for (new c = c0; c < c0 + cn; c++)
	{
		switch (g_c_type[c])
		{
			case C_FLAG:
			{
				if (!pflag(id, g_c_a[c])) return false;
			}
			case C_NOFLAG:
			{
				if (pflag(id, g_c_a[c])) return false;
			}
			case C_MONEY:
			{
				if (!core_ok() || smak_money_get(id) < g_c_a[c]) return false;
			}
			case C_HOUR:
			{
				new h = floatround(game_hour(), floatround_floor) % 24;
				new a = g_c_a[c], b = g_c_b[c];
				new bool:inside = (a < b) ? (h >= a && h < b) : (h >= a || h < b);
				if (!inside) return false;
			}
			case C_CHANCE:
			{
				if (random_num(1, 100) > g_c_a[c]) return false;
			}
		}
	}
	return true;
}

/// Runs a rule for a player if its cooldown is over and its conditions hold. True when it ran.
bool:try_rule(id, r)
{
	new Float:now = get_gametime();
	if (now < g_cool[id][r]) return false;
	if (!conds_hold(id, g_r_c0[r], g_r_cn[r])) return false;
	run_actions(id, r, g_r_a0[r], g_r_an[r]);
	return true;
}

speak(id, r, const text[])
{
	new line[SAY_LEN + 64], name[32];
	copy(line, charsmax(line), text);
	get_user_name(id, name, charsmax(name));
	replace_all(line, charsmax(line), "{jugador}", name);
	if (g_r_speaker[r][0]) client_print(id, print_chat, "[%s] %s", g_r_speaker[r], line);
	else client_print(id, print_chat, "%s", line);
}

currency_name(out[], len)
{
	if (core_ok()) smak_currency(out, len);
	if (!out[0]) copy(out, len, "creditos");
}

run_actions(id, r, a0, an)
{
	for (new a = a0; a < a0 + an; a++)
	{
		if (!is_user_connected(id)) return;
		switch (g_a_type[a])
		{
			case A_SAY:
			{
				speak(id, r, g_text[g_a_n[a]]);
			}
			case A_GIVE:
			{
				new reason[48], cur[32];
				formatex(reason, charsmax(reason), "script:%s", g_r_id[r]);
				if (!core_ok() || !smak_money_add(id, g_a_n[a], reason))
				{
					client_print(id, print_chat, "[SMAK] No se pudo pagar ahora.");
					log_amx("[smak_script] rule %s: give_money %d to player %d refused (no smak_core, or the character is not ready)", g_r_id[r], g_a_n[a], id);
					return;
				}
				currency_name(cur, charsmax(cur));
				client_print(id, print_chat, "[SMAK] Recibes %d %s.", g_a_n[a], cur);
			}
			case A_TAKE:
			{
				new reason[48], cur[32];
				formatex(reason, charsmax(reason), "script:%s", g_r_id[r]);
				currency_name(cur, charsmax(cur));
				if (!core_ok() || !smak_money_take(id, g_a_n[a], reason))
				{
					client_print(id, print_chat, "[SMAK] No tienes %d %s.", g_a_n[a], cur);
					return;           // the rest of the list is not run
				}
				client_print(id, print_chat, "[SMAK] Pagas %d %s.", g_a_n[a], cur);
			}
			case A_SET:
			{
				set_flag_of(id, g_a_n[a], true);
			}
			case A_CLEAR:
			{
				set_flag_of(id, g_a_n[a], false);
			}
			case A_COOL:
			{
				g_cool[id][r] = get_gametime() + float(g_a_n[a]);
			}
			case A_SHOP:
			{
				open_shop(id, g_text[g_a_n[a]]);
			}
			case A_MENU:
			{
				open_menu(id, r, g_a_n[a]);
			}
		}
	}
}

open_shop(id, const shop[])
{
	new found = callfunc_begin("smak_shop_open", "smak_items.amxx");
	if (found == 1)
	{
		callfunc_push_int(id);
		callfunc_push_str(shop, false);
		callfunc_end();
		return;
	}
	log_amx("[smak_script] open_shop %s: %s", shop, (found == -1) ? "smak_items.amxx is not running" : "smak_items.amxx has no public smak_shop_open(id, const shop[])");
	client_print(id, print_chat, "[SMAK] La tienda no esta disponible.");
}

open_menu(id, r, mi)
{
	new menu = menu_create(g_text[g_m_title[mi]], "menu_choice");
	new shown = 0;
	for (new o = 0; o < g_m_n[mi]; o++)
	{
		if (!conds_hold(id, g_m_c0[mi][o], g_m_cn[mi][o])) continue;
		menu_additem(menu, g_text[g_m_text[mi][o]], "", 0);
		g_pm_map[id][shown++] = o;
	}
	if (!shown)
	{
		menu_destroy(menu);
		client_print(id, print_chat, "[SMAK] No hay nada que elegir ahora.");
		return;
	}
	g_pm_epoch[id] = g_epoch;
	g_pm_rule[id] = r;
	g_pm_menu[id] = mi;
	menu_display(id, menu, 0);
}

public menu_choice(id, menu, item)
{
	new epoch = g_pm_epoch[id], r = g_pm_rule[id], mi = g_pm_menu[id];
	new o = (item >= 0 && item < MAX_OPTIONS) ? g_pm_map[id][item] : -1;
	menu_destroy(menu);
	g_pm_epoch[id] = -1;
	if (item < 0 || o < 0 || epoch != g_epoch || !is_user_connected(id)) return PLUGIN_HANDLED;
	if (!g_ready[id] || !conds_hold(id, g_m_c0[mi][o], g_m_cn[mi][o])) return PLUGIN_HANDLED;
	run_actions(id, r, g_m_a0[mi][o], g_m_an[mi][o]);
	return PLUGIN_HANDLED;
}

// =====================================================================================================================
// console
// =====================================================================================================================

public cmd_flags(id, level, cid)
{
	if (id < 1) return PLUGIN_HANDLED;
	new arg[16];
	read_argv(1, arg, charsmax(arg));
	if (equal(arg, "clear"))
	{
		if (!(get_user_flags(id) & ADMIN_RCON))
		{
			console_print(id, "smak_script_flags clear: admin only");
			return PLUGIN_HANDLED;
		}
		for (new f = 0; f < g_flag_n; f++) set_flag_of(id, f, false);
		console_print(id, "smak_script: your flags are cleared");
		return PLUGIN_HANDLED;
	}
	new list[256];
	for (new f = 0; f < g_flag_n; f++)
	{
		if (pflag(id, f))
		{
			add(list, charsmax(list), g_flag_name[f]);
			add(list, charsmax(list), " ");
		}
	}
	console_print(id, "smak_script: your flags: %s%s", list[0] ? list : "(none)", g_ready[id] ? "" : " (still loading)");
	return PLUGIN_HANDLED;
}

public cmd_status(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
	console_print(id, "smak_script %s: map %s, %d rule(s), %d flag name(s), %d action(s), %d menu(s), %d NPC(s) in rp.json", VERSION, g_map, g_rule_n, g_flag_n, g_act_n, g_menu_n, g_npc_count);
	console_print(id, "  smak_core: %s; smak_npc clock: %s (game hour %.1f); database: %s", core_ok() ? "yes" : "no", g_clock_ok ? "yes" : "no, own formula", game_hour(), g_dbok ? "yes" : "no (session flags)");
	for (new r = 0; r < g_rule_n; r++)
	{
		new const ev[][] = { "", "use", "say", "hour", "spawn" };
		console_print(id, "  %-24s on %-5s npc %s%s", g_r_id[r], ev[g_r_on[r]], (g_r_npc[r] >= 0) ? g_npc_id[g_r_npc[r]] : "-", (g_r_npc[r] >= 0 && npc_entity(g_r_npc[r]) <= 0) ? "  (ENTITY NOT FOUND)" : "");
	}
	return PLUGIN_HANDLED;
}

public cmd_reload(id, level, cid)
{
	if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
	load_all();
	console_print(id, "smak_script: reloaded, %d rule(s); see the AMXX log for any refusal", g_rule_n);
	return PLUGIN_HANDLED;
}
