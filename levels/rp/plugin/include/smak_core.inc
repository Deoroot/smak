/*
 * smak_core.inc -- natives of smak_core.amxx (levels/rp/plugin/smak_core.sma), the character and money plugin of
 * the pseudo-MSC system (levels/rp/NPCS.md, section 5).
 *
 * Use:   #include <smak_core>      (compile with -ilevels/rp/plugin/include)
 * The plugin that includes this one needs smak_core.amxx running (and listed BEFORE it in plugins.ini): the
 * #pragma below makes AMXX refuse to load it otherwise.
 *
 * "Usable" (smak_char_loaded) means the character is in memory: loaded from the database, or a guest. A guest is a
 * player whose identity is shared or unknown (STEAM_ID_LAN, a bot, ...): they get a session-only character with the
 * starting money, which is never saved. Until a character is usable, every money native refuses (returns 0/false)
 * and changes nothing: wait for smak_char_loaded_fw, or check smak_char_loaded, then try again.
 */

#if defined _smak_core_included
	#endinput
#endif
#define _smak_core_included

#if !defined SMAK_CORE_PLUGIN
	#pragma reqlib smak_core
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_core
	#endif
#endif

#define SMAK_MAX_MONEY 1000000000

/**
 * Is this player's character in memory and usable (loaded, or a guest)?
 *
 * @param id    player index
 * @return      1 yes, 0 no (still loading, failed to load, not connected)
 */
native smak_char_loaded(id);

/**
 * Is this player a guest (session-only character, never saved)?
 *
 * @return      1 guest, 0 saved character or not usable yet
 */
native smak_char_guest(id);

/**
 * The key the character is stored under, such as "auth:STEAM_0:1:1234". Empty for a guest or while loading.
 * Do not show it to other players.
 *
 * @param id    player index
 * @param out   buffer
 * @param len   size of the buffer
 * @return      characters written (0 for none)
 */
native smak_char_ident(id, out[], len);

/**
 * The balance. 0 when the character is not usable (check smak_char_loaded to tell it from a real 0).
 */
native smak_money_get(id);

/**
 * Give money. amount must be > 0. The change is saved a few seconds later and logged with its reason and the plugin
 * that asked, to addons/amxmodx/logs/smak_money.log.
 *
 * @param reason    short text for the audit log, for example "mission:harbor_run"
 * @return          1 done, 0 refused (not usable, amount <= 0, or the balance would pass SMAK_MAX_MONEY)
 */
native bool:smak_money_add(id, amount, const reason[]);

/**
 * Take money. amount must be > 0. Fails, changing nothing, when the player has less than amount.
 *
 * @return          1 done, 0 refused (not usable, amount <= 0, or not enough money)
 */
native bool:smak_money_take(id, amount, const reason[]);

/**
 * The currency's name, from the cvar smak_core_currency ("creditos" by default).
 *
 * @return          characters written
 */
native smak_currency(out[], len);

#if !defined SMAK_CORE_PLUGIN
/**
 * Called once a player's character is usable: loaded from the database or made a guest. Not called when the player leaves first.
 * Define it in your plugin as:   public smak_char_loaded_fw(id) { ... }
 *
 * @param id    player index
 */
forward smak_char_loaded_fw(id);
#endif
