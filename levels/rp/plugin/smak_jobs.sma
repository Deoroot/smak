/*
 * smak_jobs.sma -- player jobs, salaries and permissions for the pseudo-MSC RP server. Needs smak_core.amxx (listed
 * before it in plugins.ini): the character's identity comes from smak_char_ident and the salaries from smak_money_add.
 * Optional (a native filter and LibraryExists): smak_law (arrests, a guard who turns wanted loses the job) and
 * smak_skills (a job's skill requirement; without it the requirement is not asked).
 *
 * Jobs: configs/smak_rp/jobs.json (format "smak-jobs/1", levels/rp/jobs.mjs checks it offline; the example is
 * levels/rp/jobs/jobs.json). Each job: id, name, salary (per paycheck), max (players holding it at once, 0 = no limit),
 * requires { skill, level } (optional), perms (arrest, heal, repair, lawful). "unemployed" is everybody's default.
 * Employment offices: configs/smak_rp/<map>.jobs.json (format "smak-jobsites/1"): circles { id, name, origin, radius },
 * optionally "jobs": [ids] that office offers. /trabajo inside one opens the menu to take or quit a job.
 *
 * Salary: every smak_jobs_pay_min minutes (default 5) a player with a job, alive, on duty (/servicio toggles it) and
 * who has been moving (not standing idle) is paid his job's salary: smak_money_add "salary:<job>". The clock restarts
 * when the job changes; a player who leaves loses the minutes since his last paycheck. The money is new money: the
 * server's economy has to be sized with it in mind.
 *
 * Permissions (chat commands, no key binding):
 *   /arrestar  guardia: aim at a wanted player (smak_law level >= 1) within smak_jobs_arrest_range: he pays the fine
 *              (or all he has) through smak_law_arrest, is cleared, and the guard gets smak_jobs_arrest_pct % of what
 *              was collected ("bonus:arrest"). Cooldown smak_jobs_arrest_cd s. "lawful" jobs (the guard) are lost the
 *              moment the player turns wanted (checked every 5 s).
 *   /curar     medico: aim at a hurt player within smak_jobs_heal_range; the patient is asked (15 s menu) and, if he
 *              accepts, pays smak_jobs_heal_fee to the medic ("heal:fee" / "heal:income") and goes to 100 health.
 *   /reparar   mecanico: not made yet (says so).
 *
 * Role spawns: a player of a "lawful" job (the guard) who is on duty starts each new life at a random spawn with
 * role "guard" of the map's rp.json `spawns` (contract.mjs guardSpawnsOf: a post's or the Nexus's guard room and the
 * street outside it), one with no living player within 40 units when there is one. Cvar smak_jobs_role_spawn 1 (0:
 * the game's spawns). Not for a prisoner (smak_law_jailed), nor for the very first spawn before the job is loaded.
 * Other chat: /empleo (your job, salary, next paycheck), /servicio (on or off duty), /trabajo (at an office).
 *
 * Persistence: table jobs(ident, job, since) in data/sqlite3/smak_rp.sq3 (the file smak_core uses; this plugin touches
 * only its own table). `since` is the unix time he took the job. Guests (and a player whose load failed) keep the
 * job for the session and it is never saved. Saves are threaded queries. A job that is no longer in jobs.json loads
 * as unemployed. The slot count of a job (max) counts the players online only.
 * Cost: no per-frame work. Tasks: a 30 s pay tick, a 5 s watch of guards, a 60 s sweep.
 *
 * Natives and forward: levels/rp/plugin/include/smak_jobs.inc. Console: smak_setjob <name|#userid> <job id> (ADMIN_RCON,
 * or the host of a listen server with smak_jobs_dev 1); it ignores requirements, max and cooldown.
 * Never used (they crash Xash3D): FM_KeyValue, get_kvd, copy_infokey_buffer, EngFunc_GetInfoKeyBuffer.
 */

#define SMAK_JOBS_PLUGIN
#define SMAK_LAW_OPTIONAL
#define SMAK_SKILLS_PLUGIN
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <sqlx>
#include <json>
#include <smak_core>
#include <smak_law>
#include <smak_skills>
#include <smak_jobs>

#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK jobs"
#define VERSION "0.2"
#define AUTHOR  "SMAK"

#define DB_NAME       "smak_rp"
#define MAXPL         33
#define MAX_JOBS      8
#define MAX_SITES     8
#define ID_LEN        32
#define NAME_LEN      48
#define SKILL_LEN     16
#define SALARY_MAX    10000
#define JOB_MAX_SLOTS 32
#define JOBS_FORMAT   "smak-jobs/1"
#define SITES_FORMAT  "smak-jobsites/1"
#define UNEMPLOYED    "unemployed"

#define PERM_ARREST   1
#define PERM_HEAL     2
#define PERM_REPAIR   4
#define PERM_LAWFUL   8

#define SAVE_DELAY    5.0
#define SWEEP_SECONDS 60.0
#define PAY_TICK      30
#define WATCH_SECONDS 5.0
#define HEAL_ASK_SECS 15
#define MAX_TRIES     3
#define RETRY_SECONDS 10.0
#define MOVE_UNITS    32.0
#define MIN_ACTIVE    2

#define TASK_SAVE     1000
#define TASK_RETRY    2000
#define TASK_SWEEP    3000
#define TASK_PAY      3001
#define TASK_WATCH    3002
#define TASK_SPAWN    4000

#define MAX_SPAWNS    48
#define BLD_LEN       32
#define ROLE_LEN      12
#define SPAWN_CLEAR   40.0       // units a role spawn must keep from a player who is alive

// ---- the SQL. One statement per macro, so test-jobs-sql.mjs can run them against a real SQLite. -----------------------
// %s is a text already passed through sql_quote() (inside '...'), %d an integer.
#define Q_CREATE_JOBS "CREATE TABLE IF NOT EXISTS jobs (ident TEXT NOT NULL PRIMARY KEY, job TEXT NOT NULL, since INTEGER NOT NULL DEFAULT 0)"
#define Q_SELECT      "SELECT job, since FROM jobs WHERE ident = '%s'"
#define Q_UPSERT      "INSERT OR REPLACE INTO jobs (ident, job, since) VALUES ('%s','%s',%d)"

enum
{
	ST_NONE = 0,     // not loaded yet
	ST_LOADING,
	ST_SAVED,        // job of a saved character
	ST_SESSION       // guest, or load failed: kept for the session, never written
}

new g_state[MAXPL], g_gen[MAXPL], g_tries[MAXPL];
new g_job[MAXPL], g_since[MAXPL];
new bool:g_dirty[MAXPL];
new g_ident[MAXPL][96];
new bool:g_duty[MAXPL];
new g_acc[MAXPL], g_active[MAXPL];                 // seconds on duty since the last paycheck; ticks spent moving
new Float:g_lastpos[MAXPL][3];
new g_changed[MAXPL];                              // unix time of the last change the player made himself
new Float:g_cd_arrest[MAXPL], Float:g_cd_heal[MAXPL];
new g_heal_medic[MAXPL], g_heal_fee[MAXPL];        // pending heal offer made to this patient
new Float:g_heal_until[MAXPL];
new g_maxplayers;
new bool:g_dbok;
new Handle:g_tuple = Empty_Handle;
new g_map[64];
new g_fw_changed = -1;

new g_job_count, g_unemp = -1;
new g_job_id[MAX_JOBS][ID_LEN];
new g_job_name[MAX_JOBS][NAME_LEN];
new g_job_salary[MAX_JOBS], g_job_max[MAX_JOBS], g_job_perm[MAX_JOBS];
new g_job_skill[MAX_JOBS][SKILL_LEN], g_job_sklevel[MAX_JOBS];

// the rp.json `spawns` (levels/rp/CONTRACT.md): where a role starts. A "lawful" job (the guard) starts at role "guard".
new g_sp_count;
new g_sp_role[MAX_SPAWNS][ROLE_LEN];
new Float:g_sp_org[MAX_SPAWNS][3];                        // floor points
new g_pRoleSpawn;

new g_site_count;
new g_site_id[MAX_SITES][ID_LEN];
new g_site_name[MAX_SITES][NAME_LEN];
new Float:g_site_org[MAX_SITES][3];
new Float:g_site_rad[MAX_SITES];
new g_site_mask[MAX_SITES];                        // bit n: job n is offered here; 0 = every job

new g_pPayMin, g_pChange, g_pArrRange, g_pArrPct, g_pArrCd, g_pHealFee, g_pHealRange, g_pHealCd, g_pDev, g_pDebug;

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

bool:law_ok()
{
	return bool:LibraryExists("smak_law", LibType_Library);
}

bool:skills_ok()
{
	return bool:LibraryExists("smak_skills", LibType_Library);
}

bool:has_perm(id, perm)
{
	return ready(id) && g_job[id] >= 0 && (g_job_perm[g_job[id]] & perm) != 0;
}

find_job(const jid[])
{
	for (new j = 0; j < g_job_count; j++)
	{
		if (equali(g_job_id[j], jid)) return j;
	}
	return -1;
}

// players online who hold this job
count_job(job)
{
	new n = 0;
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (ready(id) && g_job[id] == job && is_user_connected(id)) n++;
	}
	return n;
}

// ---- database -----------------------------------------------------------------------------------------------------

setup_db()
{
	g_dbok = false;
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_jobs] ERROR: no sqlite driver. Jobs last the session only.");
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
		log_amx("[smak_jobs] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}
	new Handle:h = SQL_PrepareQuery(db, "%s", Q_CREATE_JOBS);
	if (SQL_Execute(h)) g_dbok = true;
	else
	{
		SQL_QueryError(h, err, charsmax(err));
		log_amx("[smak_jobs] ERROR: cannot create table jobs: %s", err);
	}
	SQL_FreeHandle(h);
	SQL_FreeHandle(db);
}

build_upsert(id, q[], len)
{
	new qi[200], qj[64];
	sql_quote(g_ident[id], qi, charsmax(qi));
	sql_quote(g_job_id[g_job[id]], qj, charsmax(qj));
	formatex(q, len, Q_UPSERT, qi, qj, g_since[id]);
}

save_async(id)
{
	if (g_state[id] != ST_SAVED || !g_dbok || g_tuple == Empty_Handle || g_job[id] < 0) return;
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
	log_amx("[smak_jobs] SAVE FAILED for slot %d: %s", data[0], error);
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
	g_job[id] = -1;
	g_since[id] = 0;
	g_duty[id] = true;
	g_acc[id] = 0;
	g_active[id] = 0;
	g_lastpos[id][0] = g_lastpos[id][1] = g_lastpos[id][2] = 0.0;
	g_changed[id] = 0;
	g_cd_arrest[id] = 0.0;
	g_cd_heal[id] = 0.0;
	g_heal_medic[id] = 0;
	g_heal_fee[id] = 0;
	g_heal_until[id] = 0.0;
	remove_task(id + TASK_SPAWN);
}

// Forget a player. Idempotent: FM_ClientDisconnect, client_disconnected and the sweep all call it.
jobs_drop(id)
{
	if (!valid_id(id) || g_state[id] == ST_NONE) return;
	remove_task(id + TASK_SAVE);
	remove_task(id + TASK_RETRY);
	if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);      // the query keeps its own copy of the values
	for (new p = 1; p <= g_maxplayers; p++)
	{
		if (g_heal_medic[p] == id) g_heal_medic[p] = 0;         // an offer from a medic who left
	}
	clear_player(id);
}

// Takes the player once his character is usable. Does nothing when he is already taken (it may be called from
// smak_char_loaded_fw, client_putinserver and plugin_cfg for the same player).
begin_load(id)
{
	if (!valid_id(id) || !is_user_connected(id) || g_state[id] != ST_NONE) return;
	clear_player(id);
	if (g_job_count == 0 || smak_char_guest(id) || !g_dbok)
	{
		session_only(id, g_job_count == 0 ? "no jobs" : smak_char_guest(id) ? "guest" : "no database");
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
	g_job[id] = g_unemp;
	if (get_pcvar_num(g_pDebug)) log_amx("[smak_jobs] slot %d: job for the session only (%s)", id, why);
	announce(id);
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
		log_amx("[smak_jobs] load failed for slot %d (try %d): %s", id, g_tries[id] + 1, error);
		if (++g_tries[id] >= MAX_TRIES)
		{
			// never save over what we could not read
			session_only(id, "load failed");
			client_print(id, print_chat, "[SMAK] No se pudo cargar tu empleo: esta sesion no se guardara.");
		}
		else set_task(RETRY_SECONDS, "task_retry", id + TASK_RETRY);
		return;
	}
	g_job[id] = g_unemp;
	if (SQL_MoreResults(query))
	{
		new jid[ID_LEN];
		SQL_ReadResult(query, 0, jid, charsmax(jid));
		g_since[id] = SQL_ReadResult(query, 1);
		new j = find_job(jid);
		if (j >= 0) g_job[id] = j;
		else
		{
			log_amx("[smak_jobs] slot %d had job '%s' which jobs.json no longer has: unemployed", id, jid);
			mark_dirty(id);
		}
	}
	g_state[id] = ST_SAVED;
	if (get_pcvar_num(g_pDebug))
		log_amx("[smak_jobs] slot %d loaded: job %s (%s) in %.3fs", id, g_job_id[g_job[id]], g_ident[id], queuetime);
	announce(id);
}

public task_retry(taskid)
{
	new id = taskid - TASK_RETRY;
	if (valid_id(id) && g_state[id] == ST_LOADING && is_user_connected(id)) send_select(id);
}

// the job is known: tell the others (the forward) and the player if he has one
announce(id)
{
	fire_changed(id);
	if (g_job[id] >= 0 && g_job[id] != g_unemp)
		client_print(id, print_chat, "[SMAK] Tu empleo: %s. Escribe /empleo para ver tu sueldo.", g_job_name[g_job[id]]);
}

fire_changed(id)
{
	if (g_fw_changed < 0 || g_job[id] < 0) return;
	new ret;
	ExecuteForward(g_fw_changed, ret, id, g_job_id[g_job[id]]);
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
	jobs_drop(id);
	return FMRES_IGNORED;
}

public client_disconnected(id)
{
	jobs_drop(id);
}

// ---- changing job -------------------------------------------------------------------------------------------------

set_job(id, job, const why[])
{
	new before = g_job[id];
	g_job[id] = job;
	g_since[id] = get_systime();
	g_acc[id] = 0;
	g_active[id] = 0;
	mark_dirty(id);
	log_amx("[smak_jobs] slot %d: job %s -> %s (%s)", id, before >= 0 ? g_job_id[before] : "-", g_job_id[job], why);
	fire_changed(id);
}

// why the player may not take the job now, or "" when he may; text in Spanish for the player
requirement_failure(id, job, why[], len)
{
	why[0] = 0;
	if (g_job_sklevel[job] > 0 && g_job_skill[job][0] && skills_ok())
	{
		new have = smak_skill_level(id, g_job_skill[job]);
		if (have < g_job_sklevel[job])
			formatex(why, len, "Necesitas %s nivel %d (tienes %d).", g_job_skill[job], g_job_sklevel[job], max(have, 0));
	}
}

take_job(id, job)
{
	if (!ready(id) || g_job[id] < 0 || job < 0 || job >= g_job_count) return;
	new s = near_site(id);
	if (s == -1)
	{
		client_print(id, print_chat, "[SMAK] Debes estar en una oficina de empleo.");
		return;
	}
	if (job == g_unemp)
	{
		quit_job(id);
		return;
	}
	if (g_site_mask[s] && !(g_site_mask[s] & (1 << job)))
	{
		client_print(id, print_chat, "[SMAK] Esta oficina no ofrece ese empleo.");
		return;
	}
	if (g_job[id] == job)
	{
		client_print(id, print_chat, "[SMAK] Ya eres %s.", g_job_name[job]);
		return;
	}
	new wait = get_pcvar_num(g_pChange) - (get_systime() - g_changed[id]);
	if (g_changed[id] > 0 && wait > 0)
	{
		client_print(id, print_chat, "[SMAK] Cambiaste de empleo hace poco. Espera %d s.", wait);
		return;
	}
	if (g_job_max[job] > 0 && count_job(job) >= g_job_max[job])
	{
		client_print(id, print_chat, "[SMAK] No hay plazas de %s (%d de %d ocupadas).", g_job_name[job], count_job(job), g_job_max[job]);
		return;
	}
	new why[96];
	requirement_failure(id, job, why, charsmax(why));
	if (why[0])
	{
		client_print(id, print_chat, "[SMAK] No puedes ser %s. %s", g_job_name[job], why);
		return;
	}
	g_changed[id] = get_systime();
	set_job(id, job, "took it");
	client_print(id, print_chat, "[SMAK] Ahora eres %s. Sueldo: %d cada %d min en servicio.", g_job_name[job], g_job_salary[job], max(1, get_pcvar_num(g_pPayMin)));
}

quit_job(id)
{
	if (!ready(id) || g_job[id] < 0) return;
	if (g_job[id] == g_unemp)
	{
		client_print(id, print_chat, "[SMAK] Ya estas sin empleo.");
		return;
	}
	new old = g_job[id];
	g_changed[id] = get_systime();
	set_job(id, g_unemp, "quit");
	client_print(id, print_chat, "[SMAK] Dejaste tu empleo de %s.", g_job_name[old]);
}

// ---- the sweep, the paycheck and the watch -------------------------------------------------------------------------

public task_sweep()
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_state[id] == ST_NONE) continue;
		if (!is_user_connected(id))
		{
			log_amx("[smak_jobs] sweep: slot %d is gone and no disconnect hook ran; dropping it now", id);
			jobs_drop(id);
			continue;
		}
		if (g_state[id] == ST_SAVED && g_dirty[id]) save_async(id);      // only what changed
	}
}

public task_pay()
{
	new need = max(1, get_pcvar_num(g_pPayMin)) * 60;
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (!ready(id) || !is_user_connected(id)) continue;
		new job = g_job[id];
		if (job < 0 || job == g_unemp || g_job_salary[job] <= 0) continue;
		if (!g_duty[id] || !is_user_alive(id)) continue;
		new Float:org[3];
		pev(id, pev_origin, org);
		if (get_distance_f(org, g_lastpos[id]) >= MOVE_UNITS) g_active[id]++;
		g_lastpos[id][0] = org[0]; g_lastpos[id][1] = org[1]; g_lastpos[id][2] = org[2];
		g_acc[id] += PAY_TICK;
		if (g_acc[id] < need) continue;
		g_acc[id] = 0;
		new active = g_active[id];
		g_active[id] = 0;
		if (active < MIN_ACTIVE)
		{
			client_print(id, print_chat, "[SMAK] Sin sueldo esta vez: estuviste quieto. Muevete mientras trabajas.");
			continue;
		}
		new reason[64], cur[32];
		formatex(reason, charsmax(reason), "salary:%s", g_job_id[job]);
		currency(cur, charsmax(cur));
		if (smak_money_add(id, g_job_salary[job], reason))
			client_print(id, print_chat, "[SMAK] Sueldo de %s: +%d %s.", g_job_name[job], g_job_salary[job], cur);
		else
			log_amx("[smak_jobs] salary of %d for slot %d (%s) refused by smak_core", g_job_salary[job], id, g_job_id[job]);
	}
}

public task_watch()
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (!ready(id) || !is_user_connected(id)) continue;
		if (g_heal_medic[id] && get_gametime() > g_heal_until[id]) g_heal_medic[id] = 0;
		if (!has_perm(id, PERM_LAWFUL) || !law_ok()) continue;
		if (smak_law_level(id) > 0)
		{
			new old = g_job[id];
			g_changed[id] = get_systime();
			set_job(id, g_unemp, "lost: turned wanted");
			client_print(id, print_chat, "[SMAK] Cometiste un delito: pierdes tu empleo de %s.", g_job_name[old]);
		}
	}
}

// ---- who is looked at ---------------------------------------------------------------------------------------------

// the live player under the crosshair within range, or 0
find_aimed(id, Float:range)
{
	new Float:start[3], Float:view[3], Float:ang[3], Float:fwd[3], Float:end[3];
	pev(id, pev_origin, start);
	pev(id, pev_view_ofs, view);
	pev(id, pev_v_angle, ang);
	start[0] += view[0]; start[1] += view[1]; start[2] += view[2];
	engfunc(EngFunc_MakeVectors, ang);
	global_get(glb_v_forward, fwd);
	end[0] = start[0] + fwd[0] * range;
	end[1] = start[1] + fwd[1] * range;
	end[2] = start[2] + fwd[2] * range;
	engfunc(EngFunc_TraceLine, start, end, DONT_IGNORE_MONSTERS, id, 0);
	new hit = get_tr2(0, TR_pHit);
	if (hit < 1 || hit > g_maxplayers || hit == id) return 0;
	if (!is_user_connected(hit) || !is_user_alive(hit)) return 0;
	return hit;
}

// ---- the files ------------------------------------------------------------------------------------------------------

// Jobs: configs/smak_rp/jobs.json. Missing or refused: no jobs, everybody stays unemployed.
load_jobs()
{
	g_job_count = 0;
	g_unemp = -1;
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/jobs.json", dir);
	if (!file_exists(path))
	{
		log_amx("[smak_jobs] no %s: there are no jobs (everybody stays unemployed)", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_jobs] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[32];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, JOBS_FORMAT))
	{
		log_amx("[smak_jobs] ERROR: %s has format ^"%s^", not ^"%s^": refused", path, text, JOBS_FORMAT);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "jobs");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && g_job_count < MAX_JOBS; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new j = g_job_count;
			g_job_id[j][0] = 0;
			g_job_name[j][0] = 0;
			g_job_skill[j][0] = 0;
			g_job_sklevel[j] = 0;
			g_job_perm[j] = 0;
			json_object_get_string(one, "id", g_job_id[j], ID_LEN - 1);
			json_object_get_string(one, "name", g_job_name[j], NAME_LEN - 1);
			g_job_salary[j] = json_object_get_number(one, "salary");
			g_job_max[j] = json_object_get_number(one, "max");
			new JSON:req = json_object_get_value(one, "requires");
			if (req != Invalid_JSON)
			{
				json_object_get_string(req, "skill", g_job_skill[j], SKILL_LEN - 1);
				g_job_sklevel[j] = json_object_get_number(req, "level");
				json_free(req);
			}
			new JSON:perms = json_object_get_value(one, "perms");
			if (perms != Invalid_JSON)
			{
				for (new k = 0, n = json_array_get_count(perms); k < n; k++)
				{
					new p[16];
					json_array_get_string(perms, k, p, charsmax(p));
					if (equal(p, "arrest")) g_job_perm[j] |= PERM_ARREST;
					else if (equal(p, "heal")) g_job_perm[j] |= PERM_HEAL;
					else if (equal(p, "repair")) g_job_perm[j] |= PERM_REPAIR;
					else if (equal(p, "lawful")) g_job_perm[j] |= PERM_LAWFUL;
					else log_amx("[smak_jobs] job %s: unknown permission ^"%s^" ignored", g_job_id[j], p);
				}
				json_free(perms);
			}
			json_free(one);
			if (!g_job_id[j][0] || !g_job_name[j][0] || find_job(g_job_id[j]) != -1 || g_job_salary[j] < 0 || g_job_salary[j] > SALARY_MAX
				|| g_job_max[j] < 0 || g_job_max[j] > JOB_MAX_SLOTS || g_job_sklevel[j] < 0 || g_job_sklevel[j] > SMAK_SKILL_MAX_LEVEL)
			{
				log_amx("[smak_jobs] job %d has no id or name, is repeated, or a number is out of range: left out", i + 1);
				continue;
			}
			g_job_count++;
			if (equal(g_job_id[j], UNEMPLOYED)) g_unemp = j;
			log_amx("[smak_jobs] job %s ^"%s^" salary %d max %d perms %d requires %s %d", g_job_id[j], g_job_name[j], g_job_salary[j], g_job_max[j], g_job_perm[j], g_job_skill[j], g_job_sklevel[j]);
		}
		json_free(list);
	}
	json_free(root);
	if (g_unemp < 0)
	{
		log_amx("[smak_jobs] ERROR: %s has no job '%s': refused", path, UNEMPLOYED);
		g_job_count = 0;
	}
}

load_sites()
{
	g_site_count = 0;
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.jobs.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_jobs] no %s: this map has no employment office (/trabajo will not work)", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_jobs] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[32];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, SITES_FORMAT))
	{
		log_amx("[smak_jobs] ERROR: %s has format ^"%s^", not ^"%s^": refused", path, text, SITES_FORMAT);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "sites");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && g_site_count < MAX_SITES; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new s = g_site_count;
			g_site_id[s][0] = 0;
			g_site_name[s][0] = 0;
			g_site_mask[s] = 0;
			json_object_get_string(one, "id", g_site_id[s], ID_LEN - 1);
			json_object_get_string(one, "name", g_site_name[s], NAME_LEN - 1);
			g_site_rad[s] = json_object_get_real(one, "radius");
			new JSON:at = json_object_get_value(one, "origin");
			new bool:placed = false;
			if (at != Invalid_JSON)
			{
				if (json_is_array(at) && json_array_get_count(at) >= 3)
				{
					g_site_org[s][0] = json_array_get_real(at, 0);
					g_site_org[s][1] = json_array_get_real(at, 1);
					g_site_org[s][2] = json_array_get_real(at, 2);
					placed = true;
				}
				json_free(at);
			}
			new JSON:offer = json_object_get_value(one, "jobs");
			if (offer != Invalid_JSON)
			{
				for (new k = 0, n = json_array_get_count(offer); k < n; k++)
				{
					new jid[ID_LEN];
					json_array_get_string(offer, k, jid, charsmax(jid));
					new j = find_job(jid);
					if (j >= 0 && j != g_unemp) g_site_mask[s] |= (1 << j);
					else log_amx("[smak_jobs] office %s offers an unknown job ^"%s^": ignored", g_site_id[s], jid);
				}
				json_free(offer);
			}
			json_free(one);
			if (!g_site_id[s][0] || !placed || g_site_rad[s] <= 0.0)
			{
				log_amx("[smak_jobs] office %d has no id, no origin or no radius: left out", i + 1);
				continue;
			}
			g_site_count++;
			log_amx("[smak_jobs] office %s ^"%s^" at %.0f %.0f %.0f radius %.0f", g_site_id[s], g_site_name[s], g_site_org[s][0], g_site_org[s][1], g_site_org[s][2], g_site_rad[s]);
		}
		json_free(list);
	}
	json_free(root);
}

near_site(id)
{
	new Float:org[3];
	pev(id, pev_origin, org);
	for (new s = 0; s < g_site_count; s++)
	{
		if (get_distance_f(org, g_site_org[s]) <= g_site_rad[s]) return s;
	}
	return -1;
}

// ---- chat commands -------------------------------------------------------------------------------------------------

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/trabajo") || equali(a, "/job") || equali(a, "/jobs"))
	{
		open_menu(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/empleo") || equali(a, "/myjob"))
	{
		show_job(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/servicio") || equali(a, "/duty"))
	{
		toggle_duty(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/arrestar") || equali(a, "/arrest"))
	{
		do_arrest(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/curar") || equali(a, "/heal"))
	{
		offer_heal(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/reparar") || equali(a, "/repair"))
	{
		if (!ready(id)) loading_message(id);
		else if (!has_perm(id, PERM_REPAIR)) client_print(id, print_chat, "[SMAK] Solo un mecanico puede reparar.");
		else client_print(id, print_chat, "[SMAK] Las reparaciones aun no estan disponibles.");
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}

loading_message(id)
{
	client_print(id, print_chat, "[SMAK] Tu empleo aun se esta cargando, espera un momento.");
}

show_job(id)
{
	if (!ready(id) || g_job[id] < 0)
	{
		loading_message(id);
		return;
	}
	new job = g_job[id];
	if (job == g_unemp)
	{
		client_print(id, print_chat, "[SMAK] No tienes empleo. Busca una oficina de empleo y escribe /trabajo.");
		return;
	}
	new cur[32];
	currency(cur, charsmax(cur));
	new need = max(1, get_pcvar_num(g_pPayMin)) * 60;
	new left = max(0, need - g_acc[id]);
	client_print(id, print_chat, "[SMAK] Empleo: %s. Sueldo: %d %s cada %d min. Proximo pago en %d s. %s.",
		g_job_name[job], g_job_salary[job], cur, need / 60, left, g_duty[id] ? "En servicio" : "Fuera de servicio (/servicio)");
}

toggle_duty(id)
{
	if (!ready(id) || g_job[id] < 0)
	{
		loading_message(id);
		return;
	}
	if (g_job[id] == g_unemp)
	{
		client_print(id, print_chat, "[SMAK] No tienes empleo.");
		return;
	}
	g_duty[id] = !g_duty[id];
	if (g_duty[id]) client_print(id, print_chat, "[SMAK] Estas en servicio: cobras tu sueldo.");
	else client_print(id, print_chat, "[SMAK] Estas fuera de servicio: no cobras ni puedes usar los permisos del empleo.");
}

// ---- the menu at an office -----------------------------------------------------------------------------------------

open_menu(id)
{
	if (!ready(id) || g_job[id] < 0)
	{
		loading_message(id);
		return;
	}
	if (g_job_count == 0)
	{
		client_print(id, print_chat, "[SMAK] No hay empleos en este servidor.");
		return;
	}
	new s = near_site(id);
	if (s == -1)
	{
		client_print(id, print_chat, "[SMAK] Debes estar en una oficina de empleo.");
		return;
	}
	new title[128], cur[32];
	currency(cur, charsmax(cur));
	formatex(title, charsmax(title), "\y%s^n\wTu empleo: %s", g_site_name[s], g_job_name[g_job[id]]);
	new menu = menu_create(title, "mh_jobs");
	for (new j = 0; j < g_job_count; j++)
	{
		if (j == g_unemp) continue;
		if (g_site_mask[s] && !(g_site_mask[s] & (1 << j))) continue;
		new line[128], info[ID_LEN], slots[24], req[40];
		slots[0] = 0;
		req[0] = 0;
		if (g_job_max[j] > 0) formatex(slots, charsmax(slots), " [%d/%d]", count_job(j), g_job_max[j]);
		if (g_job_sklevel[j] > 0 && g_job_skill[j][0]) formatex(req, charsmax(req), " req %s %d", g_job_skill[j], g_job_sklevel[j]);
		formatex(line, charsmax(line), "%s \d- %d %s%s%s", g_job_name[j], g_job_salary[j], cur, slots, req);
		copy(info, charsmax(info), g_job_id[j]);
		menu_additem(menu, line, info);
	}
	menu_additem(menu, "Renunciar a mi empleo", UNEMPLOYED);
	menu_setprop(menu, MPROP_EXITNAME, "Salir");
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(id, menu, 0);
}

public mh_jobs(id, menu, item)
{
	if (item < 0)
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new access, info[ID_LEN], name[64], cb;
	menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	if (!is_user_connected(id) || !ready(id)) return PLUGIN_HANDLED;
	new j = find_job(info);
	if (j == g_unemp) quit_job(id);
	else if (j >= 0) take_job(id, j);
	return PLUGIN_HANDLED;
}

// ---- guard: /arrestar -----------------------------------------------------------------------------------------------

do_arrest(id)
{
	if (!ready(id) || g_job[id] < 0)
	{
		loading_message(id);
		return;
	}
	if (!has_perm(id, PERM_ARREST))
	{
		client_print(id, print_chat, "[SMAK] Solo un guardia puede arrestar.");
		return;
	}
	if (!g_duty[id] || !is_user_alive(id))
	{
		client_print(id, print_chat, "[SMAK] Debes estar vivo y en servicio.");
		return;
	}
	if (!law_ok())
	{
		client_print(id, print_chat, "[SMAK] El sistema de ley no esta activo.");
		return;
	}
	new Float:now = get_gametime();
	if (now < g_cd_arrest[id])
	{
		client_print(id, print_chat, "[SMAK] Espera %d s para otro arresto.", floatround(g_cd_arrest[id] - now, floatround_ceil));
		return;
	}
	new range = max(32, get_pcvar_num(g_pArrRange));
	new t = find_aimed(id, float(range));
	if (!t)
	{
		client_print(id, print_chat, "[SMAK] Apunta a un buscado a menos de %d unidades.", range);
		return;
	}
	new name[32];
	get_user_name(t, name, charsmax(name));
	if (!ready(t) || smak_law_level(t) < 1)
	{
		client_print(id, print_chat, "[SMAK] %s no es buscado.", name);
		return;
	}
	new paid = smak_law_arrest(t);
	if (paid < 0)
	{
		client_print(id, print_chat, "[SMAK] No se pudo arrestar a %s.", name);
		return;
	}
	g_cd_arrest[id] = now + float(max(0, get_pcvar_num(g_pArrCd)));
	new bonus = paid * clamp(get_pcvar_num(g_pArrPct), 0, 100) / 100;
	new cur[32], gname[32];
	currency(cur, charsmax(cur));
	get_user_name(id, gname, charsmax(gname));
	if (bonus > 0 && !smak_money_add(id, bonus, "bonus:arrest"))
	{
		log_amx("[smak_jobs] arrest bonus of %d for slot %d refused by smak_core", bonus, id);
		bonus = 0;
	}
	client_print(id, print_chat, "[SMAK] Arrestaste a %s: cobraste %d %s de multa. Tu parte: %d %s.", name, paid, cur, bonus, cur);
	if (smak_law_jailed(t) > 0) client_print(id, print_chat, "[SMAK] %s va al calabozo %d s.", name, smak_law_jailed(t));
	log_amx("[smak_jobs] guard %d (%s) arrested slot %d (%s): collected %d, bonus %d", id, gname, t, name, paid, bonus);
}

// ---- medic: /curar --------------------------------------------------------------------------------------------------

offer_heal(id)
{
	if (!ready(id) || g_job[id] < 0)
	{
		loading_message(id);
		return;
	}
	if (!has_perm(id, PERM_HEAL))
	{
		client_print(id, print_chat, "[SMAK] Solo un medico puede curar.");
		return;
	}
	if (!g_duty[id] || !is_user_alive(id))
	{
		client_print(id, print_chat, "[SMAK] Debes estar vivo y en servicio.");
		return;
	}
	new Float:now = get_gametime();
	if (now < g_cd_heal[id])
	{
		client_print(id, print_chat, "[SMAK] Espera %d s para curar de nuevo.", floatround(g_cd_heal[id] - now, floatround_ceil));
		return;
	}
	new range = max(32, get_pcvar_num(g_pHealRange));
	new t = find_aimed(id, float(range));
	if (!t)
	{
		client_print(id, print_chat, "[SMAK] Apunta a un herido a menos de %d unidades.", range);
		return;
	}
	new name[32], mname[32];
	get_user_name(t, name, charsmax(name));
	get_user_name(id, mname, charsmax(mname));
	if (!ready(t))
	{
		client_print(id, print_chat, "[SMAK] %s aun no esta listo.", name);
		return;
	}
	new Float:hp;
	pev(t, pev_health, hp);
	if (hp >= 100.0)
	{
		client_print(id, print_chat, "[SMAK] %s no necesita curas.", name);
		return;
	}
	if (g_heal_medic[t] && now < g_heal_until[t])
	{
		client_print(id, print_chat, "[SMAK] %s ya tiene una oferta pendiente.", name);
		return;
	}
	new fee = max(0, get_pcvar_num(g_pHealFee));
	g_cd_heal[id] = now + float(max(0, get_pcvar_num(g_pHealCd)));
	g_heal_medic[t] = id;
	g_heal_fee[t] = fee;
	g_heal_until[t] = now + float(HEAL_ASK_SECS);
	new title[128], cur[32];
	currency(cur, charsmax(cur));
	formatex(title, charsmax(title), "\y%s te ofrece curarte^n\wPrecio: %d %s", mname, fee, cur);
	new menu = menu_create(title, "mh_heal");
	menu_additem(menu, "Aceptar", "yes");
	menu_additem(menu, "Rechazar", "no");
	menu_setprop(menu, MPROP_EXIT, MEXIT_NEVER);
	menu_setprop(menu, MPROP_PERPAGE, 0);
	menu_display(t, menu, 0, HEAL_ASK_SECS);
	client_print(id, print_chat, "[SMAK] Oferta enviada a %s (%d s).", name, HEAL_ASK_SECS);
}

public mh_heal(id, menu, item)
{
	new access, info[8], name[32], cb;
	if (item >= 0) menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), cb);
	menu_destroy(menu);
	new medic = g_heal_medic[id];
	new fee = g_heal_fee[id];
	new Float:until = g_heal_until[id];
	if (item < 0 || !equal(info, "yes"))
	{
		g_heal_medic[id] = 0;
		return PLUGIN_HANDLED;
	}
	g_heal_medic[id] = 0;
	if (!is_user_connected(id) || !ready(id) || !medic || get_gametime() > until) return PLUGIN_HANDLED;
	if (!is_user_alive(id) || !valid_id(medic) || !is_user_connected(medic) || !is_user_alive(medic) || !has_perm(medic, PERM_HEAL) || !g_duty[medic])
	{
		client_print(id, print_chat, "[SMAK] El medico ya no puede atenderte.");
		return PLUGIN_HANDLED;
	}
	new Float:a[3], Float:b[3];
	pev(id, pev_origin, a);
	pev(medic, pev_origin, b);
	if (get_distance_f(a, b) > float(max(32, get_pcvar_num(g_pHealRange))) + 64.0)
	{
		client_print(id, print_chat, "[SMAK] El medico esta demasiado lejos.");
		return PLUGIN_HANDLED;
	}
	new Float:hp;
	pev(id, pev_health, hp);
	if (hp >= 100.0)
	{
		client_print(id, print_chat, "[SMAK] Ya no necesitas curas.");
		return PLUGIN_HANDLED;
	}
	new cur[32], mname[32], pname[32];
	currency(cur, charsmax(cur));
	get_user_name(medic, mname, charsmax(mname));
	get_user_name(id, pname, charsmax(pname));
	if (fee > 0)
	{
		if (smak_money_get(id) < fee)
		{
			client_print(id, print_chat, "[SMAK] No te alcanza: la cura cuesta %d %s y tienes %d.", fee, cur, smak_money_get(id));
			return PLUGIN_HANDLED;
		}
		if (!smak_money_take(id, fee, "heal:fee"))
		{
			client_print(id, print_chat, "[SMAK] No se pudo cobrar la cura.");
			return PLUGIN_HANDLED;
		}
		if (!smak_money_add(medic, fee, "heal:income"))
		{
			smak_money_add(id, fee, "heal:refund");        // the medic's side failed: give it back
			log_amx("[smak_jobs] heal fee %d from slot %d could not be paid to medic slot %d: refunded", fee, id, medic);
			client_print(id, print_chat, "[SMAK] No se pudo pagar al medico: no se te cobro.");
			return PLUGIN_HANDLED;
		}
	}
	set_pev(id, pev_health, 100.0);
	client_print(id, print_chat, "[SMAK] %s te curo (-%d %s). Salud al maximo.", mname, fee, cur);
	client_print(medic, print_chat, "[SMAK] Curaste a %s: +%d %s.", pname, fee, cur);
	log_amx("[smak_jobs] medic %d (%s) healed slot %d (%s) for %d", medic, mname, id, pname, fee);
	return PLUGIN_HANDLED;
}

// ---- admin ----------------------------------------------------------------------------------------------------------

bool:can_admin(id)
{
	if (id == 0) return true;
	if (get_user_flags(id) & ADMIN_RCON) return true;
	return get_pcvar_num(g_pDev) && !is_dedicated_server() && id == 1;
}

public cmd_setjob(id)
{
	if (!can_admin(id))
	{
		console_print(id, "[SMAK] smak_setjob: needs ADMIN_RCON (or the listen-server host with smak_jobs_dev 1)");
		return PLUGIN_HANDLED;
	}
	if (read_argc() < 3)
	{
		console_print(id, "[SMAK] usage: smak_setjob <name|#userid> <job id>");
		return PLUGIN_HANDLED;
	}
	new who[48], jid[ID_LEN];
	read_argv(1, who, charsmax(who));
	read_argv(2, jid, charsmax(jid));
	new job = find_job(jid);
	if (job < 0)
	{
		console_print(id, "[SMAK] smak_setjob: unknown job '%s'", jid);
		return PLUGIN_HANDLED;
	}
	new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF);
	if (!target) return PLUGIN_HANDLED;
	if (!ready(target) || g_job[target] < 0)
	{
		console_print(id, "[SMAK] smak_setjob: that player's job is not loaded yet");
		return PLUGIN_HANDLED;
	}
	set_job(target, job, "admin");
	new name[32];
	get_user_name(target, name, charsmax(name));
	console_print(id, "[SMAK] smak_setjob: %s is now %s", name, g_job_id[job]);
	log_amx("[smak_jobs] admin %d set slot %d (%s) to %s", id, target, name, g_job_id[job]);
	client_print(target, print_chat, "[SMAK] Un administrador te dio el empleo: %s.", g_job_name[job]);
	return PLUGIN_HANDLED;
}

// ---- role spawns ------------------------------------------------------------------------------------------------------

// configs/smak_rp/<map>.rp.json, `spawns`: [{ id, role, building, district, at: [x, y, z] floor point }]. Missing, or
// without spawns: nobody is moved at spawn.
load_spawns()
{
	g_sp_count = 0;
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.rp.json", dir, g_map);
	if (!file_exists(path)) return;
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[64];
	json_object_get_string(root, "map", text, charsmax(text));
	if (!equali(text, g_map))
	{
		log_amx("[smak_jobs] %s is for map ^"%s^", not ^"%s^": no role spawns", path, text, g_map);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "spawns");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count && g_sp_count < MAX_SPAWNS; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new s = g_sp_count;
			g_sp_role[s][0] = 0;
			json_object_get_string(one, "role", g_sp_role[s], ROLE_LEN - 1);
			new JSON:at = json_object_get_value(one, "at");
			new bool:placed = false;
			if (at != Invalid_JSON)
			{
				if (json_is_array(at) && json_array_get_count(at) >= 3)
				{
					for (new k = 0; k < 3; k++) g_sp_org[s][k] = json_array_get_real(at, k);
					placed = true;
				}
				json_free(at);
			}
			json_free(one);
			if (g_sp_role[s][0] && placed) g_sp_count++;
		}
		json_free(list);
	}
	json_free(root);
}

// The role a job starts at: a "lawful" job (the guard) is the regime's guards'.
bool:role_of(id, role[], len)
{
	if (!ready(id) || g_job[id] < 0 || !g_duty[id]) return false;
	if (!(g_job_perm[g_job[id]] & PERM_LAWFUL)) return false;
	copy(role, len, "guard");
	return true;
}

// A spawn of the role clear of the living: from a random one on, the first with no player within SPAWN_CLEAR; all
// taken, the random one.
bool:pick_spawn(id, const role[], Float:out[3])
{
	new total = 0;
	for (new s = 0; s < g_sp_count; s++)
	{
		if (equal(g_sp_role[s], role)) total++;
	}
	if (total <= 0) return false;
	new start = random_num(0, total - 1);
	new Float:first[3];
	new bool:have = false;
	for (new k = 0; k < total; k++)
	{
		new want = (start + k) % total, seen = 0;
		for (new s = 0; s < g_sp_count; s++)
		{
			if (!equal(g_sp_role[s], role)) continue;
			if (seen++ != want) continue;
			if (!have)
			{
				first[0] = g_sp_org[s][0]; first[1] = g_sp_org[s][1]; first[2] = g_sp_org[s][2];
				have = true;
			}
			new bool:taken = false;
			for (new p = 1; p <= g_maxplayers && !taken; p++)
			{
				if (p == id || !is_user_alive(p)) continue;
				new Float:po[3];
				pev(p, pev_origin, po);
				new Float:dx = po[0] - g_sp_org[s][0];
				new Float:dy = po[1] - g_sp_org[s][1];
				if (floatsqroot(dx * dx + dy * dy) < SPAWN_CLEAR && floatabs(po[2] - 37.0 - g_sp_org[s][2]) < 72.0) taken = true;
			}
			if (!taken)
			{
				out[0] = g_sp_org[s][0]; out[1] = g_sp_org[s][1]; out[2] = g_sp_org[s][2];
				return true;
			}
		}
	}
	out[0] = first[0]; out[1] = first[1]; out[2] = first[2];
	return have;
}

move_to_role_spawn(id)
{
	if (!get_pcvar_num(g_pRoleSpawn) || g_sp_count == 0 || !is_user_alive(id)) return;
	new role[ROLE_LEN];
	if (!role_of(id, role, charsmax(role))) return;
	if (law_ok() && smak_law_jailed(id) > 0) return;          // a prisoner starts in his cell
	new Float:point[3], Float:origin[3];
	if (!pick_spawn(id, role, point)) return;
	origin[0] = point[0];
	origin[1] = point[1];
	origin[2] = point[2] + 37.0;
	set_pev(id, pev_velocity, Float:{0.0, 0.0, 0.0});
	set_pev(id, pev_basevelocity, Float:{0.0, 0.0, 0.0});
	engfunc(EngFunc_SetOrigin, id, origin);
}

public fw_spawn(id)
{
	if (!valid_id(id) || !is_user_alive(id)) return HAM_IGNORED;
	if (!ready(id) || g_job[id] < 0) return HAM_IGNORED;     // the first spawn, before the job is known: the game's
	move_to_role_spawn(id);
	remove_task(id + TASK_SPAWN);
	set_task(0.3, "task_spawn", id + TASK_SPAWN);              // after TS has placed the new life
	return HAM_IGNORED;
}

public task_spawn(taskid)
{
	move_to_role_spawn(taskid - TASK_SPAWN);
}

// ---- natives ----------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	register_library("smak_jobs");
	register_native("smak_job_get", "_job_get");
	register_native("smak_job_is", "_job_is");
	set_native_filter("native_filter");
}

// smak_law_* and smak_skill_* are optional: missing, they are never called (law_ok / skills_ok ask first)
public native_filter(const name[], index, trap)
{
	if (trap) return PLUGIN_CONTINUE;
	if (equal(name, "smak_law_", 9) || equal(name, "smak_skill_", 11)) return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
}

public _job_get(plugin, params)
{
	new id = get_param(1), len = get_param(3);
	if (!ready(id) || g_job[id] < 0)
	{
		set_string(2, "", len);
		return 0;
	}
	return set_string(2, g_job_id[g_job[id]], len);
}

public bool:_job_is(plugin, params)
{
	new id = get_param(1);
	new jid[ID_LEN];
	get_string(2, jid, charsmax(jid));
	if (!ready(id) || g_job[id] < 0) return false;
	return equali(g_job_id[g_job[id]], jid) != 0;
}

// ---- plugin lifecycle ---------------------------------------------------------------------------------------------

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();
	get_mapname(g_map, charsmax(g_map));

	g_pPayMin = create_cvar("smak_jobs_pay_min", "5", FCVAR_NONE, "minutes on duty between paychecks");
	g_pChange = create_cvar("smak_jobs_change_sec", "60", FCVAR_NONE, "seconds a player must wait between taking or quitting jobs");
	g_pArrRange = create_cvar("smak_jobs_arrest_range", "128", FCVAR_NONE, "units: how near a guard must aim at a wanted player to arrest him");
	g_pArrPct = create_cvar("smak_jobs_arrest_pct", "25", FCVAR_NONE, "percent of the fine collected that the guard keeps");
	g_pArrCd = create_cvar("smak_jobs_arrest_cd", "15", FCVAR_NONE, "seconds between a guard's arrests");
	g_pHealFee = create_cvar("smak_jobs_heal_fee", "30", FCVAR_NONE, "what a patient pays the medic for a cure");
	g_pHealRange = create_cvar("smak_jobs_heal_range", "128", FCVAR_NONE, "units: how near a medic must aim at the patient");
	g_pHealCd = create_cvar("smak_jobs_heal_cd", "10", FCVAR_NONE, "seconds between a medic's offers");
	g_pDev = create_cvar("smak_jobs_dev", "0", FCVAR_NONE, "1: the host of a listen server may use smak_setjob");
	g_pDebug = create_cvar("smak_jobs_debug", "0", FCVAR_NONE, "1: log loads");

	g_pRoleSpawn = create_cvar("smak_jobs_role_spawn", "1", FCVAR_NONE, "1: a guard on duty spawns at the map's role ^"guard^" spawns (rp.json spawns); 0: at the game's");
	register_forward(FM_ClientDisconnect, "fw_disconnect");
	RegisterHamPlayer(Ham_Spawn, "fw_spawn", 1);
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_concmd("smak_setjob", "cmd_setjob", ADMIN_ALL, "<name|#userid> <job id> -- set a job (ADMIN_RCON)");
	g_fw_changed = CreateMultiForward("smak_job_changed_fw", ET_IGNORE, FP_CELL, FP_STRING);
	for (new id = 0; id < MAXPL; id++) g_job[id] = -1;
}

public plugin_cfg()
{
	load_jobs();
	load_sites();
	load_spawns();
	setup_db();
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (is_user_connected(id) && smak_char_loaded(id)) begin_load(id);       // started late: take the players already in
	}
	set_task(SWEEP_SECONDS, "task_sweep", TASK_SWEEP, _, _, "b");
	set_task(float(PAY_TICK), "task_pay", TASK_PAY, _, _, "b");
	set_task(WATCH_SECONDS, "task_watch", TASK_WATCH, _, _, "b");
	if (!skills_ok()) log_amx("[smak_jobs] smak_skills is not loaded: skill requirements are not asked");
	if (!law_ok()) log_amx("[smak_jobs] smak_law is not loaded: /arrestar does not work and guards keep their job when wanted");
	log_amx("[smak_jobs] %s started: %d job(s), %d office(s), %d role spawn(s), database %s", VERSION, g_job_count, g_site_count, g_sp_count, g_dbok ? "ok" : "NOT available (session-only jobs)");
}

// map end: synchronous, like smak_core
public plugin_end()
{
	if (g_fw_changed >= 0) DestroyForward(g_fw_changed);
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
			log_amx("[smak_jobs] plugin_end: cannot open the database (%d: %s); changed jobs not saved", errcode, err);
		}
		else
		{
			new saved = 0;
			for (new id = 1; id <= g_maxplayers; id++)
			{
				if (g_state[id] != ST_SAVED || !g_dirty[id] || g_job[id] < 0) continue;
				new q[400];
				build_upsert(id, q, charsmax(q));
				new Handle:h = SQL_PrepareQuery(db, "%s", q);
				if (SQL_Execute(h)) saved++;
				else
				{
					SQL_QueryError(h, err, charsmax(err));
					log_amx("[smak_jobs] plugin_end: save of %s failed: %s", g_ident[id], err);
				}
				SQL_FreeHandle(h);
			}
			SQL_FreeHandle(db);
			log_amx("[smak_jobs] plugin_end: %d changed job(s) saved", saved);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}
