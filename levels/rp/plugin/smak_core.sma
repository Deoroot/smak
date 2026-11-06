/*
 * smak_core -- phase 1 of the pseudo-MSC system (levels/rp/NPCS.md, section 5): one saved character per player
 * identity, with money, kept in SQLite per server.
 *
 * What it does
 *   - Each player's identity (get_user_authid, in core_identity() below, the only place that knows how) picks a row of
 *     table `characters` in addons/amxmodx/data/sqlite3/smak_rp.sq3. First time: a character is made with the starting
 *     money. Shared or unknown identities (STEAM_ID_LAN, VALVE_ID_LAN, STEAM_ID_PENDING, bots, empty) play as guests:
 *     a session-only character that is never saved. ID_LOOPBACK (the host of a listen server) is an identity only
 *     when the cvar smak_core_dev is 1.
 *   - Loads on client_authorized / client_putinserver and saves with SQL_ThreadQuery, so the server never waits for
 *     the disk. Saves: 5 s after a change (debounced), on disconnect, every 60 s, and at plugin_end (map change; that
 *     one is synchronous).
 *   - Disconnect hook: FM_ClientDisconnect (fakemeta) AND client_disconnected, both calling the same idempotent
 *     function. The first because the H9 server log says AMXX disabled the client_disconnected forward; the engine
 *     forward does not depend on AMXX's gamedata. A 60 s sweep catches a slot both hooks missed.
 *   - Money: natives for the other plugins (smak_core.inc), chat and console commands, admin commands, and an audit
 *     line for every change in addons/amxmodx/logs/smak_money.log.
 *
 * Chat (and the console command of the same name without the slash, "smak_money" and "smak_me"):
 *     /dinero  /money     the balance
 *     /yo      /me        name, money, time played        ("/me something" is left alone for chat plugins)
 * Admin console (ADMIN_RCON, the server console, or the host of a listen server when smak_core_dev is 1):
 *     smak_give <name|#userid> <amount>      smak_take <name|#userid> <amount>      smak_setmoney <name|#userid> <amount>
 *
 * Cvars: smak_core_dev 0, smak_core_currency "creditos", smak_core_start_money 100, smak_core_notify 1.
 *
 * Modules: amxmodx, amxmisc, fakemeta, sqlite (asked for below; sqlx.inc only autoloads mysql).
 */

#define SMAK_CORE_PLUGIN
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <sqlx>
#include <smak_core>

// sqlx.inc only auto-loads the mysql driver; the sqlite one has to be asked for (proved by smak_probe on H9).
#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK core"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define DB_NAME        "smak_rp"
#define SCHEMA_VERSION 1
#define MONEYLOG       "smak_money.log"
#define MAXPL          33
#define MAX_TRIES      3          // load attempts before a player plays as a guest
#define SAVE_DELAY     5.0        // debounce of a money change
#define SWEEP_SECONDS  60.0
#define RETRY_SECONDS  10.0

#define TASK_SAVE      1000
#define TASK_RETRY     2000
#define TASK_ANNOUNCE  3000
#define TASK_SWEEP     4000

// ---- the SQL. One statement per macro, so test-core-sql.mjs can run them against a real SQLite. ------------------
// %s is a text already passed through sql_quote() (it sits inside '...'), %d an integer.

#define Q_CREATE_VERSION    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied INTEGER NOT NULL)"
#define Q_VERSION_GET       "SELECT MAX(version) FROM schema_version"
#define Q_VERSION_SET       "INSERT INTO schema_version (version, applied) VALUES (%d, %d)"
#define Q_CREATE_CHARACTERS "CREATE TABLE IF NOT EXISTS characters (id INTEGER PRIMARY KEY, ident TEXT NOT NULL UNIQUE, name TEXT NOT NULL, money INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, played_seconds INTEGER NOT NULL DEFAULT 0, extra TEXT NOT NULL DEFAULT '{}')"
#define Q_SELECT            "SELECT id, name, money, created, played_seconds FROM characters WHERE ident = '%s'"
#define Q_INSERT            "INSERT OR IGNORE INTO characters (ident, name, money, created, last_seen, played_seconds, extra) VALUES ('%s', '%s', %d, %d, %d, 0, '{}')"
#define Q_UPDATE            "UPDATE characters SET money = %d, last_seen = %d, played_seconds = %d WHERE id = %d"
#define Q_BEGIN             "BEGIN"
#define Q_COMMIT            "COMMIT"
#define Q_ROLLBACK          "ROLLBACK"

// ---- state --------------------------------------------------------------------------------------------------------

enum
{
	ST_NONE = 0,      // not connected, or not started yet
	ST_LOADING,       // query in flight
	ST_LOADED,        // saved character in memory
	ST_GUEST,         // session-only character
	ST_FAILED         // load failed, a retry is waiting
}

enum
{
	ID_OK = 0,        // a key that belongs to one player
	ID_GUEST,         // shared or unknown: play as a guest
	ID_PENDING        // not known yet: wait (guest if still unknown at putinserver)
}

new g_state[MAXPL], g_gen[MAXPL], g_tries[MAXPL];
new g_charid[MAXPL], g_money[MAXPL], g_created[MAXPL];
new g_played[MAXPL];              // seconds played before this session
new g_sess[MAXPL];                // systime when g_played was last brought up to date
new bool:g_dirty[MAXPL], bool:g_new[MAXPL];
new g_ident[MAXPL][96];
new g_cname[MAXPL][48];
new g_why[MAXPL][64];             // why a guest is a guest

new Handle:g_tuple = Empty_Handle;
new bool:g_dbok;
new g_maxplayers;
new g_fwLoaded;
new g_pDev, g_pCurrency, g_pStart, g_pNotify;

// ---- helpers ------------------------------------------------------------------------------------------------------

stock bool:valid_id(id)
{
	return id >= 1 && id <= g_maxplayers;
}

stock bool:usable(id)
{
	return valid_id(id) && (g_state[id] == ST_LOADED || g_state[id] == ST_GUEST);
}

// Quote a text for SQLite: double the single quotes, drop control characters and %, so the result can sit in '...'
// and in a format string.
sql_quote(const src[], dst[], len)
{
	new j = 0;
	for (new i = 0; src[i] && j < len - 2; i++)
	{
		new c = src[i];
		if (c < 32 || c == '%') continue;
		if (c == 39) dst[j++] = 39;      // ' is doubled
		dst[j++] = c;
	}
	dst[j] = 0;
}

currency(out[], len)
{
	get_pcvar_string(g_pCurrency, out, len - 1);
	if (!out[0]) copy(out, len - 1, "creditos");
}

fmt_time(secs, out[], len)
{
	if (secs >= 3600) formatex(out, len, "%d h %02d min", secs / 3600, (secs % 3600) / 60);
	else if (secs >= 60) formatex(out, len, "%d min", secs / 60);
	else formatex(out, len, "%d s", secs);
}

played_now(id)
{
	return g_played[id] + max(0, get_systime() - g_sess[id]);
}

audit(const text[])
{
	log_to_file(MONEYLOG, "%s", text);
}

// ---- identity: the only code that decides who a player is. Phase 9 (/register, /login, H9's own id) goes here. ------

// Fills ident (the key stored in characters.ident) and, when it is not ID_OK, why. final = the player is already in
// the game: a pending id will not improve any more.
core_identity(id, ident[], len, why[], whylen, bool:final)
{
	ident[0] = 0;
	if (is_user_hltv(id) || is_user_bot(id))
	{
		copy(why, whylen, "bot");
		return ID_GUEST;
	}
	new auth[64];
	get_user_authid(id, auth, charsmax(auth));
	trim(auth);
	if (!auth[0])
	{
		copy(why, whylen, "no id");
		return final ? ID_GUEST : ID_PENDING;
	}
	if (equali(auth, "STEAM_ID_PENDING"))
	{
		copy(why, whylen, "id pending");
		return final ? ID_GUEST : ID_PENDING;
	}
	if (equali(auth, "STEAM_ID_LAN") || equali(auth, "VALVE_ID_LAN") || equali(auth, "BOT") || equali(auth, "HLTV")
		|| equali(auth, "STEAM_0:0:0") || equali(auth, "STEAM_0:1:0"))
	{
		formatex(why, whylen, "shared id %s", auth);
		return ID_GUEST;
	}
	if (equali(auth, "ID_LOOPBACK") && !get_pcvar_num(g_pDev))
	{
		copy(why, whylen, "ID_LOOPBACK (listen server host; smak_core_dev 0)");
		return ID_GUEST;
	}
	formatex(ident, len, "auth:%s", auth);
	return ID_OK;
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
		log_amx("[smak_core] ERROR: SQL_SetAffinity(sqlite) failed: no sqlite driver. Characters will not be saved (everyone plays as a guest).");
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
		log_amx("[smak_core] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}

	new q[512];
	if (!sql_exec(db, Q_CREATE_VERSION, err, charsmax(err)))
	{
		log_amx("[smak_core] ERROR: create schema_version: %s", err);
		SQL_FreeHandle(db);
		return;
	}
	new Handle:h = SQL_PrepareQuery(db, Q_VERSION_GET);
	new ver = 0;
	if (SQL_Execute(h) && SQL_NumResults(h)) ver = SQL_ReadResult(h, 0);      // NULL (no row yet) reads 0
	SQL_FreeHandle(h);

	if (ver > SCHEMA_VERSION)
	{
		log_amx("[smak_core] ERROR: the database is schema version %d, this plugin knows %d. Update smak_core.amxx; characters are NOT used.", ver, SCHEMA_VERSION);
		SQL_FreeHandle(db);
		return;
	}

	// Migrations: one block per version, each inside a transaction. Version 2 will be an ALTER TABLE here.
	new from = ver;
	if (ver < 1)
	{
		sql_exec(db, Q_BEGIN, err, charsmax(err));
		new bool:ok = sql_exec(db, Q_CREATE_CHARACTERS, err, charsmax(err));
		if (ok)
		{
			formatex(q, charsmax(q), Q_VERSION_SET, 1, get_systime());
			ok = sql_exec(db, q, err, charsmax(err));
		}
		if (!ok)
		{
			log_amx("[smak_core] ERROR: migration to version 1 failed: %s", err);
			sql_exec(db, Q_ROLLBACK, err, charsmax(err));
			SQL_FreeHandle(db);
			return;
		}
		sql_exec(db, Q_COMMIT, err, charsmax(err));
		ver = 1;
	}
	// if (ver < 2) { ... ALTER TABLE characters ADD COLUMN ...; Q_VERSION_SET 2 ...; ver = 2; }

	SQL_FreeHandle(db);
	g_dbok = true;
	log_amx("[smak_core] database %s/%s.sq3 ready, schema version %d (was %d)", dir, DB_NAME, ver, from);
}

// ---- loading ------------------------------------------------------------------------------------------------------

make_guest(id, const why[])
{
	g_state[id] = ST_GUEST;
	g_charid[id] = 0;
	g_money[id] = get_pcvar_num(g_pStart);
	g_played[id] = 0;
	g_sess[id] = get_systime();
	g_dirty[id] = false;
	g_new[id] = false;
	g_ident[id][0] = 0;
	get_user_name(id, g_cname[id], charsmax(g_cname[]));
	copy(g_why[id], charsmax(g_why[]), why);
	log_amx("[smak_core] slot %d plays as a guest (%s)", id, why);
	set_task(3.0, "task_announce", id + TASK_ANNOUNCE);
	if (g_fwLoaded != INVALID_HANDLE)
	{
		new ret;
		ExecuteForward(g_fwLoaded, ret, id);
	}
}

begin_load(id, bool:final)
{
	if (!valid_id(id) || g_state[id] != ST_NONE) return;

	new ident[96], why[64];
	new kind = core_identity(id, ident, charsmax(ident), why, charsmax(why), final);
	if (kind == ID_PENDING) return;           // putinserver tries again
	g_gen[id]++;
	if (kind == ID_GUEST || !g_dbok)
	{
		make_guest(id, kind == ID_GUEST ? why : "database not available");
		return;
	}
	copy(g_ident[id], charsmax(g_ident[]), ident);
	g_state[id] = ST_LOADING;
	send_select(id, 0);
}

send_select(id, stage)
{
	new qi[200], q[400];
	sql_quote(g_ident[id], qi, charsmax(qi));
	formatex(q, charsmax(q), Q_SELECT, qi);
	new data[3];
	data[0] = id; data[1] = g_gen[id]; data[2] = stage;
	SQL_ThreadQuery(g_tuple, "th_select", q, data, 3);
}

send_insert(id)
{
	new qi[200], qn[120], pname[48], q[600];
	sql_quote(g_ident[id], qi, charsmax(qi));
	get_user_name(id, pname, charsmax(pname));
	if (!pname[0]) copy(pname, charsmax(pname), "player");
	sql_quote(pname, qn, charsmax(qn));
	new now = get_systime();
	formatex(q, charsmax(q), Q_INSERT, qi, qn, clamp(get_pcvar_num(g_pStart), 0, SMAK_MAX_MONEY), now, now);
	new data[3];
	data[0] = id; data[1] = g_gen[id]; data[2] = 1;
	SQL_ThreadQuery(g_tuple, "th_insert", q, data, 3);
}

load_failed(id, const what[], const error[])
{
	log_amx("[smak_core] load of slot %d failed (%s): %s", id, what, error);
	g_tries[id]++;
	if (g_tries[id] >= MAX_TRIES)
	{
		make_guest(id, "load failed");
		return;
	}
	g_state[id] = ST_FAILED;
	set_task(RETRY_SECONDS, "task_retry", id + TASK_RETRY);
}

public task_retry(taskid)
{
	new id = taskid - TASK_RETRY;
	if (!valid_id(id) || g_state[id] != ST_FAILED || !is_user_connected(id)) return;
	g_state[id] = ST_NONE;
	begin_load(id, true);
}

public th_select(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	new id = data[0];
	if (!valid_id(id) || g_gen[id] != data[1] || g_state[id] != ST_LOADING) return;     // the player left meanwhile
	if (failstate != TQUERY_SUCCESS)
	{
		load_failed(id, "select", error);
		return;
	}
	if (!SQL_NumResults(query))
	{
		if (data[2] == 0)
		{
			send_insert(id);
		}
		else
		{
			load_failed(id, "select after insert", "no row");
		}
		return;
	}
	g_charid[id] = SQL_ReadResult(query, 0);
	SQL_ReadResult(query, 1, g_cname[id], charsmax(g_cname[]));
	g_money[id] = SQL_ReadResult(query, 2);
	g_created[id] = SQL_ReadResult(query, 3);
	g_played[id] = SQL_ReadResult(query, 4);
	g_sess[id] = get_systime();
	g_dirty[id] = false;
	g_new[id] = data[2] != 0;
	g_tries[id] = 0;
	g_state[id] = ST_LOADED;
	log_amx("[smak_core] slot %d: character %d '%s' %s, money %d, played %d s, key %s (query %.3f s)",
		id, g_charid[id], g_cname[id], g_new[id] ? "created" : "loaded", g_money[id], g_played[id], g_ident[id], queuetime);
	if (g_new[id])
	{
		new line[160];
		formatex(line, charsmax(line), "%s | %s | new character, starting money %d | -> %d | created", g_ident[id], g_cname[id], g_money[id], g_money[id]);
		audit(line);
	}
	set_task(1.5, "task_announce", id + TASK_ANNOUNCE);
	new ret;
	ExecuteForward(g_fwLoaded, ret, id);
}

public th_insert(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	new id = data[0];
	if (!valid_id(id) || g_gen[id] != data[1] || g_state[id] != ST_LOADING) return;
	if (failstate != TQUERY_SUCCESS)
	{
		load_failed(id, "insert", error);
		return;
	}
	send_select(id, 1);
}

public task_announce(taskid)
{
	new id = taskid - TASK_ANNOUNCE;
	if (!valid_id(id) || !is_user_connected(id)) return;
	if (g_state[id] == ST_LOADING || g_state[id] == ST_FAILED)
	{
		set_task(2.0, "task_announce", taskid);
		return;
	}
	new cur[32]; currency(cur, charsmax(cur));
	if (g_state[id] == ST_LOADED)
	{
		if (g_new[id]) client_print(id, print_chat, "[SMAK] Personaje creado: %s. Empiezas con %d %s. Escribe /dinero o /yo.", g_cname[id], g_money[id], cur);
		else client_print(id, print_chat, "[SMAK] Personaje cargado: %s, %d %s.", g_cname[id], g_money[id], cur);
	}
	else if (g_state[id] == ST_GUEST)
	{
		client_print(id, print_chat, "[SMAK] Juegas como invitado (%s): tu personaje no se guarda. Tienes %d %s.", g_why[id], g_money[id], cur);
	}
}

// ---- saving -------------------------------------------------------------------------------------------------------

// Brings the played time up to date and writes the UPDATE statement for a saved character into q.
build_update(id, q[], len)
{
	new now = get_systime();
	g_played[id] += max(0, now - g_sess[id]);
	g_sess[id] = now;
	formatex(q, len, Q_UPDATE, g_money[id], now, g_played[id], g_charid[id]);
}

save_async(id)
{
	if (g_state[id] != ST_LOADED || !g_dbok) return;
	new q[200];
	build_update(id, q, charsmax(q));
	g_dirty[id] = false;
	new data[4];
	data[0] = id; data[1] = g_gen[id]; data[2] = g_charid[id]; data[3] = g_money[id];
	SQL_ThreadQuery(g_tuple, "th_save", q, data, 4);
}

public th_save(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate == TQUERY_SUCCESS) return;
	log_amx("[smak_core] SAVE FAILED for character %d (money %d): %s", data[2], data[3], error);
	new line[200];
	formatex(line, charsmax(line), "character %d | SAVE FAILED, balance was %d | %s", data[2], data[3], error);
	audit(line);
	new id = data[0];
	if (valid_id(id) && g_gen[id] == data[1] && g_state[id] == ST_LOADED)
	{
		g_dirty[id] = true;           // the player is still here: the next sweep tries again
	}
}

mark_dirty(id)
{
	if (g_state[id] != ST_LOADED) return;
	g_dirty[id] = true;
	if (!task_exists(id + TASK_SAVE)) set_task(SAVE_DELAY, "task_save", id + TASK_SAVE);
}

public task_save(taskid)
{
	new id = taskid - TASK_SAVE;
	if (valid_id(id) && g_state[id] == ST_LOADED && g_dirty[id]) save_async(id);
}

// Forget a player. Idempotent: it is called by FM_ClientDisconnect, by client_disconnected and by the sweep.
core_drop(id)
{
	if (!valid_id(id) || g_state[id] == ST_NONE) return;
	remove_task(id + TASK_SAVE);
	remove_task(id + TASK_RETRY);
	remove_task(id + TASK_ANNOUNCE);
	if (g_state[id] == ST_LOADED) save_async(id);        // the statement already holds the values: the slot can be reused at once
	g_state[id] = ST_NONE;
	g_gen[id]++;
	g_tries[id] = 0;
	g_dirty[id] = false;
	g_ident[id][0] = 0;
	g_charid[id] = 0;
	g_money[id] = 0;
}

public task_sweep()
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == ST_NONE) continue;
		if (!is_user_connected(id))
		{
			log_amx("[smak_core] sweep: slot %d is gone and no disconnect hook ran; saving it now", id);
			core_drop(id);
			continue;
		}
		if (g_state[id] == ST_LOADED) save_async(id);           // also brings played_seconds and last_seen up to date
	}
}

// ---- map end: synchronous -------------------------------------------------------------------------------------------

public plugin_end()
{
	if (g_tuple == Empty_Handle) return;
	new count = 0;
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == ST_LOADED) count++;
	}
	if (count && g_dbok)
	{
		new err[256], errcode;
		new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
		if (db == Empty_Handle)
		{
			log_amx("[smak_core] plugin_end: cannot open the database (%d: %s); %d character(s) not saved", errcode, err, count);
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] == ST_LOADED)
				{
					new line[200];
					formatex(line, charsmax(line), "%s | SAVE FAILED at map end, balance was %d | %s", g_ident[id], g_money[id], err);
					audit(line);
				}
			}
		}
		else
		{
			sql_exec(db, Q_BEGIN, err, charsmax(err));
			new saved = 0;
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] != ST_LOADED) continue;
				new q[200];
				build_update(id, q, charsmax(q));
				if (sql_exec(db, q, err, charsmax(err)))
				{
					saved++;
				}
				else
				{
					log_amx("[smak_core] plugin_end: save of character %d failed: %s", g_charid[id], err);
					new line[200];
					formatex(line, charsmax(line), "%s | SAVE FAILED at map end, balance was %d | %s", g_ident[id], g_money[id], err);
					audit(line);
				}
			}
			sql_exec(db, Q_COMMIT, err, charsmax(err));
			SQL_FreeHandle(db);
			log_amx("[smak_core] plugin_end: %d of %d character(s) saved", saved, count);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}

// ---- money --------------------------------------------------------------------------------------------------------

// The only place a balance changes. delta may be negative. Returns false, changing nothing, when it must be refused.
bool:money_change(id, delta, const reason[], const source[])
{
	if (!usable(id) || delta == 0) return false;
	new before = g_money[id];
	new after = before + delta;
	if (delta > 0 && (after > SMAK_MAX_MONEY || after < before)) return false;
	if (delta < 0 && after < 0) return false;
	g_money[id] = after;

	new why[96];
	copy(why, charsmax(why), reason);
	for (new i = 0; why[i]; i++)
	{
		if (why[i] < 32) why[i] = ' ';
	}
	new line[320];
	formatex(line, charsmax(line), "%s | %s | %s%d | %d -> %d | %s | from %s", g_state[id] == ST_LOADED ? g_ident[id] : "(guest, not saved)",
		g_cname[id], delta > 0 ? "+" : "", delta, before, after, why, source);
	audit(line);

	if (g_state[id] == ST_LOADED) mark_dirty(id);
	if (get_pcvar_num(g_pNotify))
	{
		new cur[32]; currency(cur, charsmax(cur));
		client_print(id, print_chat, "[SMAK] %s%d %s (tienes %d)", delta > 0 ? "+" : "", delta, cur, after);
	}
	return true;
}

// Absolute set, for smak_setmoney only.
bool:money_set(id, amount, const reason[], const source[])
{
	if (!usable(id) || amount < 0 || amount > SMAK_MAX_MONEY) return false;
	new delta = amount - g_money[id];
	if (delta == 0) return true;
	return money_change(id, delta, reason, source);
}

// ---- natives ------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	register_library("smak_core");
	register_native("smak_char_loaded", "_char_loaded");
	register_native("smak_char_guest", "_char_guest");
	register_native("smak_char_ident", "_char_ident");
	register_native("smak_money_get", "_money_get");
	register_native("smak_money_add", "_money_add");
	register_native("smak_money_take", "_money_take");
	register_native("smak_currency", "_currency");
}

public _char_loaded(plugin, params)
{
	return usable(get_param(1)) ? 1 : 0;
}

public _char_guest(plugin, params)
{
	new id = get_param(1);
	return valid_id(id) && g_state[id] == ST_GUEST ? 1 : 0;
}

public _char_ident(plugin, params)
{
	new id = get_param(1);
	new out[96];
	if (valid_id(id) && g_state[id] == ST_LOADED) copy(out, charsmax(out), g_ident[id]);
	return set_string(2, out, get_param(3));
}

public _money_get(plugin, params)
{
	new id = get_param(1);
	return usable(id) ? g_money[id] : 0;
}

public bool:_money_add(plugin, params)
{
	new id = get_param(1), amount = get_param(2);
	new reason[96], src[64];
	get_string(3, reason, charsmax(reason));
	get_plugin(plugin, src, charsmax(src));
	if (amount <= 0 || !usable(id))
	{
		log_amx("[smak_core] smak_money_add(%d, %d, '%s') from %s refused: %s", id, amount, reason, src, amount <= 0 ? "amount must be > 0" : "character not usable");
		return false;
	}
	return money_change(id, amount, reason, src);
}

public bool:_money_take(plugin, params)
{
	new id = get_param(1), amount = get_param(2);
	new reason[96], src[64];
	get_string(3, reason, charsmax(reason));
	get_plugin(plugin, src, charsmax(src));
	if (amount <= 0 || !usable(id))
	{
		log_amx("[smak_core] smak_money_take(%d, %d, '%s') from %s refused: %s", id, amount, reason, src, amount <= 0 ? "amount must be > 0" : "character not usable");
		return false;
	}
	return money_change(id, -amount, reason, src);
}

public _currency(plugin, params)
{
	new cur[32];
	currency(cur, charsmax(cur));
	return set_string(1, cur, get_param(2));
}

// ---- plugin lifecycle ----------------------------------------------------------------------------------------------

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();

	g_pDev = create_cvar("smak_core_dev", "0", FCVAR_NONE, "1: ID_LOOPBACK (the host of a listen server) is a normal identity, for testing");
	g_pCurrency = create_cvar("smak_core_currency", "creditos", FCVAR_NONE, "name of the money");
	g_pStart = create_cvar("smak_core_start_money", "100", FCVAR_NONE, "money of a new character (and of a guest each session)");
	g_pNotify = create_cvar("smak_core_notify", "1", FCVAR_NONE, "1: tell the player in chat when their money changes");

	g_fwLoaded = CreateMultiForward("smak_char_loaded_fw", ET_IGNORE, FP_CELL);

	register_forward(FM_ClientDisconnect, "fw_disconnect");
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_clcmd("smak_money", "cmd_money");
	register_clcmd("smak_me", "cmd_me");
	register_concmd("smak_give", "cmd_give", ADMIN_ALL, "<name|#userid> <amount> -- give money (ADMIN_RCON)");
	register_concmd("smak_take", "cmd_take", ADMIN_ALL, "<name|#userid> <amount> -- take money (ADMIN_RCON)");
	register_concmd("smak_setmoney", "cmd_setmoney", ADMIN_ALL, "<name|#userid> <amount> -- set the balance (ADMIN_RCON)");
}

public plugin_cfg()
{
	setup_db();
	// the plugin may start with players already in (reloaded, or a late plugins.ini): load them
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (is_user_connected(id) && g_state[id] == ST_NONE) begin_load(id, true);
	}
	set_task(SWEEP_SECONDS, "task_sweep", TASK_SWEEP, _, _, "b");
	new cur[32]; currency(cur, charsmax(cur));
	log_amx("[smak_core] %s started: dev %d, currency '%s', start money %d", VERSION, get_pcvar_num(g_pDev), cur, get_pcvar_num(g_pStart));
}

public client_authorized(id)
{
	begin_load(id, false);
}

public client_putinserver(id)
{
	begin_load(id, true);
}

public fw_disconnect(id)
{
	core_drop(id);
	return FMRES_IGNORED;
}

public client_disconnected(id)
{
	core_drop(id);
}

// ---- commands -----------------------------------------------------------------------------------------------------

bool:need_char(id)
{
	if (usable(id)) return true;
	client_print(id, print_chat, "[SMAK] Tu personaje aun se esta cargando, espera un momento.");
	return false;
}

show_money(id)
{
	if (!need_char(id)) return;
	new cur[32]; currency(cur, charsmax(cur));
	client_print(id, print_chat, "[SMAK] Tienes %d %s.", g_money[id], cur);
}

show_me(id)
{
	if (!need_char(id)) return;
	new cur[32], tm[32];
	currency(cur, charsmax(cur));
	fmt_time(played_now(id), tm, charsmax(tm));
	client_print(id, print_chat, "[SMAK] Personaje: %s%s", g_cname[id], g_state[id] == ST_GUEST ? " (invitado, no se guarda)" : "");
	client_print(id, print_chat, "[SMAK] Dinero: %d %s   Tiempo jugado: %s", g_money[id], cur, tm);
}

public cmd_money(id)
{
	if (id) show_money(id);
	return PLUGIN_HANDLED;
}

public cmd_me(id)
{
	if (id) show_me(id);
	return PLUGIN_HANDLED;
}

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/dinero") || equali(a, "/money"))
	{
		show_money(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/yo") || equali(a, "/me"))
	{
		show_me(id);
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}

bool:can_admin(id)
{
	if (id == 0) return true;                               // the server console
	if (get_user_flags(id) & ADMIN_RCON) return true;
	return get_pcvar_num(g_pDev) && !is_dedicated_server() && id == 1;      // the host of a listen server, for testing
}

// smak_give / smak_take / smak_setmoney: mode 0 give, 1 take, 2 set.
admin_money(id, mode)
{
	new cmdname[16];
	read_argv(0, cmdname, charsmax(cmdname));
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] %s: needs ADMIN_RCON (or the listen-server host with smak_core_dev 1)", cmdname);
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 3)
	{
		console_print(id, "[SMAK] usage: %s <name|#userid> <amount>", cmdname);
		return PLUGIN_HANDLED;
	}
	new who[48], num[16];
	read_argv(1, who, charsmax(who));
	read_argv(2, num, charsmax(num));
	if (!is_str_num(num) || strlen(num) > 10)
	{
		console_print(id, "[SMAK] %s: '%s' is not a whole number", cmdname, num);
		return PLUGIN_HANDLED;
	}
	new amount = str_to_num(num);
	if (amount < 0 || amount > SMAK_MAX_MONEY || (mode != 2 && amount == 0))
	{
		console_print(id, "[SMAK] %s: the amount must be %s and at most %d", cmdname, mode == 2 ? ">= 0" : "> 0", SMAK_MAX_MONEY);
		return PLUGIN_HANDLED;
	}
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF | CMDTARGET_NO_BOTS);
	if (!target) return PLUGIN_HANDLED;                    // cmd_target already said why
	if (!usable(target))
	{
		console_print(id, "[SMAK] %s: that player's character is not loaded yet", cmdname);
		return PLUGIN_HANDLED;
	}

	new aname[48], reason[96];
	if (id) get_user_name(id, aname, charsmax(aname)); else copy(aname, charsmax(aname), "server console");
	formatex(reason, charsmax(reason), "admin %s (%s)", cmdname, aname);
	new tname[48];
	get_user_name(target, tname, charsmax(tname));
	new cur[32]; currency(cur, charsmax(cur));

	new bool:ok;
	switch (mode)
	{
		case 0: ok = money_change(target, amount, reason, "smak_core");
		case 1: ok = money_change(target, -amount, reason, "smak_core");
		default: ok = money_set(target, amount, reason, "smak_core");
	}
	if (ok) console_print(id, "[SMAK] %s: %s now has %d %s", cmdname, tname, g_money[target], cur);
	else if (mode == 1) console_print(id, "[SMAK] %s: %s has only %d %s; nothing taken", cmdname, tname, g_money[target], cur);
	else console_print(id, "[SMAK] %s: refused (balance would pass %d)", cmdname, SMAK_MAX_MONEY);
	return PLUGIN_HANDLED;
}

public cmd_give(id)
{
	return admin_money(id, 0);
}

public cmd_take(id)
{
	return admin_money(id, 1);
}

public cmd_setmoney(id)
{
	return admin_money(id, 2);
}
