/*
 * smak_npc.inc -- the native smak_npc.amxx is to export so other plugins (smak_script) read its game clock.
 *
 * smak_npc.sma registers it in plugin_natives() (library "smak_npc"). List smak_npc.amxx BEFORE
 * smak_script.amxx in plugins.ini (a native is bound when the plugin loads). smak_script also loads
 * without it and then uses the same formula without the admin shift (smak_npc_hour).
 *
 * Plain include, no #pragma reqlib: the plugin that includes it keeps loading when smak_npc is not there.
 */
#if defined _smak_npc_included
	#endinput
#endif
#define _smak_npc_included

/**
 * The game clock of smak_npc: 0.0 up to (not including) 24.0. A day lasts the cvar smak_npc_day real minutes.
 */
native Float:smak_npc_hour();

/**
 * The people smak_npc generates at load have stable ids, a function of the map's rp.json and the cvars only (no random
 * call decides them): a keeper is <role>_<place id> (shopkeeper_ms1_shop, barman_bar_bar, medic_clinic_clinic,
 * mechanic_works_workshop), workers are worker_01.., citizens citizen_01.. in the order they are made. The id is also
 * the entity's targetname. smak_script binds a rule's "npc" to these ids (after the rp.json's own npcs).
 * levels/rp/npc-sim.mjs derives the same ids offline.
 */

/**
 * The entity of the generated NPC with this id; 0 if there is none (unknown id, or the NPC was not made).
 */
native smak_npc_find(const id[]);

/**
 * Copies the id of the generated NPC that is entity ent into id[]; false if ent is not one of them.
 */
native bool:smak_npc_id(ent, id[], len);

/**
 * The first name of the generated NPC with this id, into name[]; false if there is no such id.
 */
native bool:smak_npc_name(const id[], name[], len);

/**
 * How many NPCs smak_npc generated (0 when it is off or the map has none).
 */
native smak_npc_count();
