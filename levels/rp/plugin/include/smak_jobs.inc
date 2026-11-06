/*
 * smak_jobs.inc -- natives and forward of smak_jobs.amxx (levels/rp/plugin/smak_jobs.sma), the player jobs of the
 * pseudo-MSC RP server.
 *
 * Use:   #include <smak_jobs>      (compile with -ilevels/rp/plugin/include)
 * The plugin that includes this one needs smak_jobs.amxx running, listed AFTER smak_core.amxx in plugins.ini.
 * A plugin that wants smak_jobs only if present should define SMAK_JOBS_OPTIONAL before the include, set a native
 * filter and test LibraryExists("smak_jobs", LibType_Library) before calling.
 *
 * A job is the id from configs/smak_rp/jobs.json: "unemployed" (everybody's default), "guardia", "medico",
 * "mecanico", "comerciante". Until a player's job is loaded (or he is a guest, whose job lasts the session) the
 * natives answer "not known": smak_job_get returns 0 and writes an empty string, smak_job_is returns false.
 */

#if defined _smak_jobs_included
	#endinput
#endif
#define _smak_jobs_included

#if !defined SMAK_JOBS_PLUGIN && !defined SMAK_JOBS_OPTIONAL
	#pragma reqlib smak_jobs
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_jobs
	#endif
#endif

#define SMAK_JOB_UNEMPLOYED "unemployed"

/**
 * The id of the player's job.
 *
 * @param id    player index
 * @param out   buffer for the job id
 * @param len   size of the buffer
 * @return      characters written; 0 (and an empty string) while the job is not loaded
 */
native smak_job_get(id, out[], len);

/**
 * Does the player have this job (the id, case does not matter)? False while the job is not loaded.
 */
native bool:smak_job_is(id, const job[]);

/**
 * Called when a player's job is known or changes: after the load, and when he takes, quits or loses a job, or an
 * admin sets it. Not called when he leaves.
 *
 * @param id    player index
 * @param job   the job id, "unemployed" for none
 */
forward smak_job_changed_fw(id, const job[]);
