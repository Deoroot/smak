/*
 * smak_skills.inc -- natives of smak_skills.amxx (levels/rp/plugin/smak_skills.sma), the skills that grow with use
 * of the pseudo-MSC system (levels/rp/NPCS.md, 5.6 and 5.11 phase 6).
 *
 * Use:   #include <smak_skills>      (compile with -ilevels/rp/plugin/include)
 * The plugin that includes this one needs smak_skills.amxx running, listed AFTER smak_core.amxx in plugins.ini.
 *
 * Skills (the names the natives take; case does not matter):
 *   "punteria"    firearm hits on other players        (also "aim")
 *   "cuerpo"      melee and kung-fu hits on players    (also "melee")
 *   "atletismo"   distance run on foot                 (also "athletics")
 *   "resistencia" damage taken from players and survived (also "endurance")
 *
 * Until a player's skills are loaded (or he is a guest, whose skills last the session) every native refuses
 * (returns 0 / -1) and changes nothing.
 */

#if defined _smak_skills_included
	#endinput
#endif
#define _smak_skills_included

#if !defined SMAK_SKILLS_PLUGIN
	#pragma reqlib smak_skills
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_skills
	#endif
#endif

#define SMAK_SKILL_MAX_LEVEL 20

/**
 * Give experience. Not limited by the per-minute caps (a script decides how much a mission is worth); the player is
 * told in chat if he gains a level.
 *
 * @param id      player index
 * @param skill   skill name, see above
 * @param amount  experience, 1 to 100000
 * @return        1 done, 0 refused (unknown skill, bad amount, skills not loaded yet)
 */
native bool:smak_give_xp(id, const skill[], amount);

/**
 * Level of a skill, 0 to SMAK_SKILL_MAX_LEVEL; -1 when unknown skill or not loaded.
 */
native smak_skill_level(id, const skill[]);

/**
 * Experience of a skill; -1 when unknown skill or not loaded.
 */
native smak_skill_xp(id, const skill[]);
