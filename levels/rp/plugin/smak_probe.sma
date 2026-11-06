/*
 * smak_probe -- phase 0 of the pseudo-MSC system (levels/rp/NPCS.md, 5.11 row 0 and 5.12).
 *
 * It answers, on the H9 server (Xash3D + Metamod + AMXX 1.10 + TS via reTS), what the design only assumes:
 *   - do sqlite (sqlx) and nvault load and work (threaded and not)?
 *   - what identity does a joining player have (authid, ip, name, userinfo keys)?
 *   - can a plugin set maxspeed, gravity, health and armor, or does TS reset them?
 *   - what does a HUD message on two channels and an MOTD page look like in the H9 client?
 *
 * Every result is one line "[smak_probe] <test>: OK|FAIL <detail>" in the AMXX log and in
 * addons/amxmodx/logs/smak_probe.log. It writes only: data/sqlite3/smak_probe.sq3 (or data/smak_probe.sq3),
 * data/vault/smak_probe.vault and logs/smak_probe.log.
 *
 * Chat (admins with ADMIN_RCON, or the host of a listen server):  /probe   and   /probe off
 * Console fallback (same rights):  smak_probe   and   smak_probe off
 */

#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <fun>
#include <nvault>
#include <sqlx>

// sqlx.inc only auto-loads the mysql driver; the sqlite one has to be asked for.
#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK probe"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define LOGFILE "smak_probe.log"
#define TASK_A  100
#define TASK_B  200
#define TASK_C  300
#define N_STARTUP 6      // lib_sqlx, lib_sqlite, lib_nvault, sqlite_sync, sqlite_threaded, nvault

new g_done, g_ok, g_fail;
new bool:g_summarised;
new Handle:g_tuple;

new Float:g_defSpeed[33], Float:g_defGrav[33], Float:g_defArmor[33];
new bool:g_saved[33];

// ---- logging ------------------------------------------------------------------------------------------------

plog(const text[])
{
	log_amx("[smak_probe] %s", text);
	log_to_file(LOGFILE, "[smak_probe] %s", text);
}

// A startup test finished.
result(const test[], bool:ok, const detail[])
{
	plog(fmt("%s: %s %s", test, ok ? "OK" : "FAIL", detail));
	if (ok) g_ok++; else g_fail++;
	g_done++;
	if (g_done >= N_STARTUP && !g_summarised)
	{
		g_summarised = true;
		plog(fmt("summary: %s %d OK, %d FAIL of %d startup tests (player tests are logged as they happen)",
			g_fail ? "FAIL" : "OK", g_ok, g_fail, N_STARTUP));
	}
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_concmd("smak_probe", "cmd_console", ADMIN_RCON, "[off] -- run the player probe on yourself");
}

// ---- 1. storage ---------------------------------------------------------------------------------------------

public plugin_cfg()
{
	new ver[32]; get_amxx_verstring(ver, charsmax(ver));
	new datadir[96]; get_datadir(datadir, charsmax(datadir));
	new mapname[32]; get_mapname(mapname, charsmax(mapname));
	plog(fmt("start: smak_probe %s, AMXX %s, map %s, datadir %s, dedicated %d", VERSION, ver, mapname, datadir, is_dedicated_server()));

	new bool:hasSqlx = LibraryExists("sqlx", LibType_Class) != 0;
	new bool:hasSqlite = module_exists("sqlite") != 0;
	new bool:hasNv = LibraryExists("nvault", LibType_Library) != 0;
	result("lib_sqlx", hasSqlx, hasSqlx ? "class sqlx is present" : "class sqlx not present (module did not load; see the AMXX error log)");
	result("lib_sqlite", hasSqlite, hasSqlite ? "module sqlite is present" : "module sqlite not present (SQL_SetAffinity will fail)");
	result("lib_nvault", hasNv, hasNv ? "library nvault is present" : "library nvault not present");

	test_sqlite_sync(datadir);
	test_nvault();
}

sqlite_file_report(const datadir[], detail[], len)
{
	new p[128], q[128];
	formatex(p, charsmax(p), "%s/sqlite3/smak_probe.sq3", datadir);
	formatex(q, charsmax(q), "%s/smak_probe.sq3", datadir);
	formatex(detail, len, "file %s=%s, %s=%s", p, file_exists(p) ? "yes" : "no", q, file_exists(q) ? "yes" : "no");
}

test_sqlite_sync(const datadir[])
{
	if (!SQL_SetAffinity("sqlite"))
	{
		result("sqlite_sync", false, "SQL_SetAffinity(sqlite) returned 0: no sqlite driver loaded");
		result("sqlite_threaded", false, "skipped, no sqlite driver");
		return;
	}
	// the module keeps its files in data/sqlite3/ ; make it in case the folder is missing
	new dir[128]; formatex(dir, charsmax(dir), "%s/sqlite3", datadir);
	if (!dir_exists(dir)) mkdir(dir);

	new Handle:tuple = SQL_MakeDbTuple("", "", "", "smak_probe");
	new err[256], errcode;
	new Float:t0 = get_gametime();
	new Handle:db = SQL_Connect(tuple, errcode, err, charsmax(err));
	if (db == Empty_Handle)
	{
		result("sqlite_sync", false, fmt("connect failed, code %d: %s", errcode, err));
		SQL_FreeHandle(tuple);
		result("sqlite_threaded", false, "skipped, no connection");
		return;
	}

	new stamp = get_systime();
	new Handle:q = SQL_PrepareQuery(db, "CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, who TEXT, stamp INTEGER)");
	if (!SQL_Execute(q))
	{
		SQL_QueryError(q, err, charsmax(err));
		result("sqlite_sync", false, fmt("create failed: %s", err));
		SQL_FreeHandle(q); SQL_FreeHandle(db); SQL_FreeHandle(tuple);
		result("sqlite_threaded", false, "skipped, create failed");
		return;
	}
	SQL_FreeHandle(q);

	q = SQL_PrepareQuery(db, "INSERT INTO probe (who, stamp) VALUES ('sync', %d)", stamp);
	if (!SQL_Execute(q))
	{
		SQL_QueryError(q, err, charsmax(err));
		result("sqlite_sync", false, fmt("insert failed: %s", err));
		SQL_FreeHandle(q); SQL_FreeHandle(db); SQL_FreeHandle(tuple);
		result("sqlite_threaded", false, "skipped, insert failed");
		return;
	}
	SQL_FreeHandle(q);

	q = SQL_PrepareQuery(db, "SELECT COUNT(*), MAX(stamp) FROM probe WHERE who = 'sync'");
	if (!SQL_Execute(q) || !SQL_NumResults(q))
	{
		SQL_QueryError(q, err, charsmax(err));
		result("sqlite_sync", false, fmt("select failed: %s", err));
		SQL_FreeHandle(q); SQL_FreeHandle(db); SQL_FreeHandle(tuple);
		result("sqlite_threaded", false, "skipped, select failed");
		return;
	}
	new rows = SQL_ReadResult(q, 0), back = SQL_ReadResult(q, 1);
	SQL_FreeHandle(q);
	SQL_FreeHandle(db);
	new Float:dt = get_gametime() - t0;

	new fdet[260]; sqlite_file_report(datadir, fdet, charsmax(fdet));
	result("sqlite_sync", back == stamp && rows > 0,
		fmt("rows with who=sync: %d, wrote stamp %d read %d, gametime delta %.4f s (0.0 = clock frozen at plugin_cfg), %s",
			rows, stamp, back, dt, fdet));

	// threaded: insert, then select, in the handlers. The tuple is freed at the end of the chain.
	new data[2]; data[0] = stamp + 1;
	g_tuple = tuple;
	SQL_ThreadQuery(tuple, "th_insert", fmt("INSERT INTO probe (who, stamp) VALUES ('thread', %d)", stamp + 1), data, 1);
}

public th_insert(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate != TQUERY_SUCCESS)
	{
		result("sqlite_threaded", false, fmt("insert failstate %d, errnum %d: %s", failstate, errnum, error));
		SQL_FreeHandle(g_tuple);
		return;
	}
	new d[2]; d[0] = data[0];
	SQL_ThreadQuery(g_tuple, "th_select", "SELECT COUNT(*), MAX(stamp) FROM probe WHERE who = 'thread'", d, 1);
}

public th_select(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate != TQUERY_SUCCESS)
	{
		result("sqlite_threaded", false, fmt("select failstate %d, errnum %d: %s", failstate, errnum, error));
		SQL_FreeHandle(g_tuple);
		return;
	}
	new rows = 0, back = 0;
	if (SQL_NumResults(query))
	{
		rows = SQL_ReadResult(query, 0);
		back = SQL_ReadResult(query, 1);
	}
	result("sqlite_threaded", back == data[0] && rows > 0,
		fmt("rows with who=thread: %d, expected stamp %d read %d, last queue time %.4f s", rows, data[0], back, queuetime));
	SQL_FreeHandle(g_tuple);
}

test_nvault()
{
	new v = nvault_open("smak_probe");
	if (v == INVALID_HANDLE)
	{
		result("nvault", false, "nvault_open(smak_probe) returned INVALID_HANDLE");
		return;
	}
	new val[48]; formatex(val, charsmax(val), "probe-%d", get_systime());
	nvault_set(v, "probe", val);
	new got[48]; nvault_get(v, "probe", got, charsmax(got));
	new bool:first = equal(got, val) != 0;
	nvault_close(v);

	v = nvault_open("smak_probe");
	if (v == INVALID_HANDLE)
	{
		result("nvault", false, "reopen failed");
		return;
	}
	new got2[48]; nvault_get(v, "probe", got2, charsmax(got2));
	nvault_close(v);
	new bool:second = equal(got2, val) != 0;
	result("nvault", first && second, fmt("wrote '%s', read '%s', after close+reopen '%s' (file data/vault/smak_probe.vault)", val, got, got2));
}

// ---- 2. identity --------------------------------------------------------------------------------------------

public client_authorized(id)
{
	new auth[64], ip[48], name[48];
	get_user_authid(id, auth, charsmax(auth));
	get_user_ip(id, ip, charsmax(ip));
	get_user_name(id, name, charsmax(name));
	plog(fmt("player_auth: OK slot %d authid '%s' ip '%s' name '%s' bot %d hltv %d", id, auth, ip, name,
		is_user_bot(id), is_user_hltv(id)));
}

public client_putinserver(id)
{
	new auth[64], ip[48], name[48];
	get_user_authid(id, auth, charsmax(auth));
	get_user_ip(id, ip, charsmax(ip));
	get_user_name(id, name, charsmax(name));
	plog(fmt("player_join: OK slot %d authid '%s' ip '%s' name '%s' bot %d hltv %d admin_rcon %d",
		id, auth, ip, name, is_user_bot(id), is_user_hltv(id), (get_user_flags(id) & ADMIN_RCON) ? 1 : 0));
	g_saved[id] = false;
	set_task(2.0, "dump_userinfo", id + TASK_C);
}

public dump_userinfo(taskid)
{
	new id = taskid - TASK_C;
	if (!is_user_connected(id)) return;

	// Not copy_infokey_buffer(engfunc(EngFunc_GetInfoKeyBuffer, id), ...): on Xash3D FWGS 0.21 it crashes the
	// server inside amxmodx (2026-11-05). The keys are asked for by name instead.
	// the named keys asked for, read through get_user_info too (an empty value is "not set")
	new names[][] = { "*sid", "*hid", "*id", "h9id", "h9_id", "uid", "steamid", "hwid", "cl_hwid", "model", "name" };
	new out[300], one[96];
	for (new i = 0; i < sizeof names; i++)
	{
		one[0] = 0;
		get_user_info(id, names[i], one, charsmax(one));
		format(out, charsmax(out), "%s%s='%s' ", out, names[i], one);
	}
	plog(fmt("userinfo_named: OK slot %d via get_user_info: %s", id, out));
}

// ---- 3. /probe ----------------------------------------------------------------------------------------------

public cmd_console(id, level, cid)
{
	if (!is_user_connected(id)) return PLUGIN_HANDLED;
	if (!allowed(id))
	{
		console_print(id, "[smak_probe] needs ADMIN_RCON or the listen-server host");
		return PLUGIN_HANDLED;
	}
	new arg[16]; read_argv(1, arg, charsmax(arg));
	run_probe(id, equali(arg, "off") != 0);
	return PLUGIN_HANDLED;
}

public cmd_say(id)
{
	new a[64]; read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (!equali(a, "/probe", 6)) return PLUGIN_CONTINUE;
	new bool:off = equali(a, "/probe off") != 0;
	if (!off && a[6] != 0) return PLUGIN_CONTINUE;      // /probexyz is not ours

	if (!allowed(id))
	{
		client_print(id, print_chat, "[smak_probe] needs ADMIN_RCON or the listen-server host");
		plog(fmt("probe_cmd: FAIL slot %d refused (not ADMIN_RCON, not listen host)", id));
		return PLUGIN_HANDLED;
	}
	run_probe(id, off);
	return PLUGIN_HANDLED;
}

bool:allowed(id)
{
	if (get_user_flags(id) & ADMIN_RCON) return true;
	return !is_dedicated_server() && id == 1;       // the host of a listen server is slot 1
}

read_stats(id, const when[])
{
	new Float:sp, Float:gr, Float:hp, Float:ar, Float:mh;
	pev(id, pev_maxspeed, sp);
	pev(id, pev_gravity, gr);
	pev(id, pev_health, hp);
	pev(id, pev_armorvalue, ar);
	pev(id, pev_max_health, mh);
	new bool:ok = sp == 400.0 && gr == 0.5 && hp == 150.0 && ar == 75.0;
	plog(fmt("probe_readback_%s: %s slot %d pev maxspeed %.1f (fun %.1f) gravity %.2f (fun %.2f) health %.1f max_health %.1f armor %.1f  -- wanted 400 / 0.5 / 150 / 75",
		when, ok ? "OK" : "CHANGED", id, sp, get_user_maxspeed(id), gr, get_user_gravity(id), hp, mh, ar));
}

run_probe(id, bool:off)
{
	remove_task(id + TASK_A); remove_task(id + TASK_B);
	if (!is_user_alive(id))
	{
		plog(fmt("probe_cmd: FAIL slot %d is not alive, nothing to set", id));
		client_print(id, print_chat, "[smak_probe] you must be alive");
		return;
	}

	if (off)
	{
		new Float:sp = g_saved[id] ? g_defSpeed[id] : -1.0;
		set_user_health(id, 100);
		set_user_maxspeed(id, sp);
		set_user_gravity(id, 1.0);
		if (g_saved[id]) set_user_armor(id, floatround(g_defArmor[id]));
		plog(fmt("probe_off: OK slot %d health 100, maxspeed %.1f (value before /probe, -1 = unknown), gravity 1.0, armor %.0f",
			id, sp, g_saved[id] ? g_defArmor[id] : -1.0));
		client_print(id, print_chat, "[smak_probe] restored");
		read_stats(id, "after_off");
		g_saved[id] = false;
		return;
	}

	if (!g_saved[id])
	{
		pev(id, pev_maxspeed, g_defSpeed[id]);
		pev(id, pev_gravity, g_defGrav[id]);
		pev(id, pev_armorvalue, g_defArmor[id]);
		g_saved[id] = true;
	}
	new Float:hp0; pev(id, pev_health, hp0);
	plog(fmt("probe_before: OK slot %d maxspeed %.1f gravity %.2f health %.1f armor %.1f", id, g_defSpeed[id], g_defGrav[id], hp0, g_defArmor[id]));

	set_user_maxspeed(id, 400.0);
	set_user_gravity(id, 0.5);
	set_user_health(id, 150);
	set_user_armor(id, 75);
	read_stats(id, "now");
	set_task(0.5, "rb_a", id + TASK_A);
	set_task(3.0, "rb_b", id + TASK_B);

	// HUD on two channels, then an MOTD page: the person says what showed.
	set_hudmessage(255, 200, 0, -1.0, 0.25, 0, 0.0, 10.0, 0.1, 0.5, 3);
	show_hudmessage(id, "[smak_probe] HUD channel 3 (yellow, upper middle)");
	set_hudmessage(80, 200, 255, -1.0, 0.65, 1, 0.0, 10.0, 0.1, 0.5, 4);
	show_hudmessage(id, "[smak_probe] HUD channel 4 (blue, lower middle). Second line follows.^nLine 2: 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ^nLine 3: a longer line to see where the client cuts a message off, padded padded padded padded padded padded END");
	show_motd(id, "<html><body bgcolor='#202030' text='#ffffff'><h2 style='color:#ffcc00'>smak_probe MOTD</h2><p>If you see a <b style='color:#ff4444'>red bold word</b>, a heading in yellow and a dark blue background, the MOTD draws HTML.</p><ul><li>item one</li><li>item two</li></ul><table border='1'><tr><td>cell A</td><td>cell B</td></tr></table><p>Close it and tell what you saw.</p></body></html>", "smak_probe");
	plog(fmt("probe_hud_motd: OK slot %d sent HUD on channels 3 and 4 and an HTML MOTD; the person reports what showed", id));
	client_print(id, print_chat, "[smak_probe] set speed 400, gravity 0.5, health 150, armor 75; results in the log");
}

public rb_a(taskid)
{
	new id = taskid - TASK_A;
	if (is_user_alive(id)) read_stats(id, "0.5s");
}

public rb_b(taskid)
{
	new id = taskid - TASK_B;
	if (is_user_alive(id)) read_stats(id, "3s");
}

public client_disconnected(id)
{
	remove_task(id + TASK_A); remove_task(id + TASK_B); remove_task(id + TASK_C);
	g_saved[id] = false;
}
