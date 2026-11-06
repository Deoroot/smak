/*
 * smak_implants.inc -- natives of smak_implants.amxx (levels/rp/plugin/smak_implants.sma), the cybernetic implants
 * of the pseudo-MSC system: bought and installed at a clinic, one per body slot, saved with the character.
 *
 * Use:   #include <smak_implants>      (compile with -ilevels/rp/plugin/include)
 * The plugin that includes this one needs smak_implants.amxx running, listed AFTER smak_core.amxx in plugins.ini.
 * A plugin that can live without it should use set_native_filter and LibraryExists("smak_implants", LibType_Library)
 * instead of including the #pragma below (define SMAK_IMPLANTS_OPTIONAL before the include to skip the pragma).
 *
 * Slots: "legs", "skin", "blood", "head". Implant ids are those of configs/smak_rp/implants.json
 * (levels/rp/implants/implants.json), for example "servos_piernas".
 */

#if defined _smak_implants_included
	#endinput
#endif
#define _smak_implants_included

#if !defined SMAK_IMPLANTS_PLUGIN && !defined SMAK_IMPLANTS_OPTIONAL
	#pragma reqlib smak_implants
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_implants
	#endif
#endif

/**
 * Does this player have this implant installed?
 *
 * @param id        player index
 * @param implant   implant id from the catalogue
 * @return          1 yes, 0 no (also: unknown implant, character not loaded yet)
 */
native bool:smak_implant_has(id, const implant[]);

/**
 * How many implants this player has installed (0 to 4); -1 when the character is not usable yet.
 */
native smak_implant_count(id);

/**
 * The implant installed in a slot.
 *
 * @param slot      "legs", "skin", "blood" or "head"
 * @param out       buffer for the implant id (empty when the slot is free)
 * @return          characters written (0 for a free slot, an unknown slot or a character not loaded)
 */
native smak_implant_in_slot(id, const slot[], out[], len);
