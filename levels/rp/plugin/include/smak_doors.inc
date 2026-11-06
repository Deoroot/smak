/*
 * smak_doors.inc -- natives of smak_doors.amxx (levels/rp/plugin/smak_doors.sma), the doors, locks, keys and homes
 * of the pseudo-MSC RP server on H9.
 *
 * Use:   #include <smak_doors>      (compile with -ilevels/rp/plugin/include)
 * A plugin that wants smak_doors only if present (smak_npc's guards) defines SMAK_DOORS_OPTIONAL before the include,
 * sets a native filter (return PLUGIN_HANDLED when the trap argument is 0) and tests
 * LibraryExists("smak_doors", LibType_Library) before every call.
 *
 * A door is an entity of the map named by a property of <map>.rp.json ("properties": [{id, kind, doors: [targetnames]}]).
 * ent is the entity index of one leaf. A door that belongs to no property (or a map with no rp.json) answers
 * false / 0 / "".
 */

#if defined _smak_doors_included
	#endinput
#endif
#define _smak_doors_included

#if !defined SMAK_DOORS_PLUGIN && !defined SMAK_DOORS_OPTIONAL
	#pragma reqlib smak_doors
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_doors
	#endif
#endif

/**
 * Could a player with no key not open this door right now? True for a home that is locked, for rooms that only
 * guards may open (police, jail) while smak_jobs is loaded, and false while the door is free (a breach or a picked
 * lock holds it open for a few seconds, smak_doors_breach_open). False for a door of no property.
 * Non-player users (an NPC's use, a trigger) always pass, so this tells an NPC guard whether it must wait or breach.
 */
native bool:smak_door_locked(ent);

/**
 * The caller (an NPC entity or a player guard) has spent its delay at this door: every leaf of its property is
 * unlocked for smak_doors_breach_open seconds and opened (a use by `by`), a loud sound is played and the
 * property locks again by itself. Logged as "breach" in the AMXX log.
 *
 * @param ent  a leaf of the property
 * @param by   the entity that breaches (an NPC's entity, or a player's index); 0 if none
 * @return     1 done, 0 refused (the entity is a door of no property)
 */
native smak_door_breach(ent, by);

/**
 * The property id of a door entity ("m1_flat1"), "" if it has none. Returns the characters written.
 */
native smak_door_property(ent, out[], len);

/**
 * The kind of that property ("shop", "public", "gate", "home", "jail", "police", "hideout", "other"), "" if none.
 * Returns the characters written.
 */
native smak_door_kind(ent, out[], len);
