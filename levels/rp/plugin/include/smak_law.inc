/*
 * smak_law.inc -- natives of smak_law.amxx (levels/rp/plugin/smak_law.sma), the wanted level and fines of the
 * pseudo-MSC system.
 *
 * Use:   #include <smak_law>      (compile with -ilevels/rp/plugin/include)
 * The plugin that includes this one needs smak_law.amxx running, listed AFTER smak_core.amxx in plugins.ini.
 * A plugin that wants smak_law only if present should define SMAK_LAW_OPTIONAL before the include, set a native
 * filter and test LibraryExists("smak_law", LibType_Library) before calling.
 *
 * The wanted level is 0 to SMAK_LAW_MAX_LEVEL. Each level added also adds smak_law_fine_level (cvar) to the fine
 * the character owes. Until a player's record is loaded (or he is a guest, whose record lasts the session) every
 * native refuses (returns 0) and changes nothing.
 */

#if defined _smak_law_included
	#endinput
#endif
#define _smak_law_included

#if !defined SMAK_LAW_PLUGIN && !defined SMAK_LAW_OPTIONAL
	#pragma reqlib smak_law
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_law
	#endif
#endif

#define SMAK_LAW_MAX_LEVEL 5

/**
 * The wanted level of a player, 0 to SMAK_LAW_MAX_LEVEL; 0 too when the record is not loaded.
 */
native smak_law_level(id);

/**
 * Raise the wanted level (and the fine) because of something the player did. The player is told in chat.
 * Restarts the countdown that lowers the level.
 *
 * @param id      player index
 * @param levels  levels to add, 1 to SMAK_LAW_MAX_LEVEL (the total stops at SMAK_LAW_MAX_LEVEL)
 * @param reason  short text for the log and the chat, in the language of the players, for example "robo"
 * @return        1 done, 0 refused (record not loaded, bad levels)
 */
native bool:smak_law_add(id, levels, const reason[]);

/**
 * Clear the level and the fine without any payment (a pardon, a mission that ends in an amnesty).
 *
 * @return        1 done, 0 refused (record not loaded)
 */
native bool:smak_law_clear(id);

/**
 * An arrest: take the fine the player owes from his money (as much as he has, reason "fine:arrest"), then clear the
 * level and the fine, and tell him. The caller (smak_jobs, a guard) decides who may arrest whom; this only does it.
 *
 * @return        the money taken (0 or more; less than the fine when he had less), or -1 when nothing was done
 *                (record not loaded, the player is not wanted, the money could not be taken)
 */
native smak_law_arrest(id);

/**
 * Lower the wanted level faster than the countdown does, because of something the player did well (smak_npc: he lost
 * the guards who hunted him). Never below min_level; the fine stays unless the level reaches 0 (pass min_level 1 to
 * keep a pardon from happening this way). Restarts the countdown that lowers the level. The player is told in chat.
 *
 * @param id         player index
 * @param levels     levels to take off, 1 or more
 * @param min_level  the level it must not go below, 0 to SMAK_LAW_MAX_LEVEL
 * @param reason     short text for the log and the chat, for example "despistaste a los guardias"
 * @return           the level after, or -1 when nothing was done (record not loaded, already at or below min_level)
 */
native smak_law_lower(id, levels, min_level, const reason[]);

/**
 * Seconds left of a player's jail sentence (an arrest by smak_law_arrest puts the player in a cell of the map for
 * smak_law_jail_sec seconds, more with the stars he had; see smak_law.sma), 0 when he is free. Another plugin that
 * moves players (missions, spawns by role) leaves a prisoner where he is.
 */
native smak_law_jailed(id);

/**
 * Let a prisoner out now, to a public point outside the building of his cell.
 *
 * @return        true done, false when he was not in jail
 */
native bool:smak_law_release(id);
