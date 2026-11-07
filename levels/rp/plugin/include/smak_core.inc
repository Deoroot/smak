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

// ---- the event box -------------------------------------------------------------------------------------------------
// A panel of the player's last events (money, law, jobs, missions, danger, items), drawn as one HUD block in the
// upper-left corner, one line per event, each fading after ~10 s. smak_core owns it (cvar smak_core_events, command
// /eventos). Use smak_say() below, not smak_event() directly: it falls back to chat when smak_core is an older
// build without the box, or when the box is off.

#define EV_INFO     0     // general
#define EV_MONEY    1     // money in and out
#define EV_LAW      2     // crimes, stars, fines, arrest, jail
#define EV_JOB      3     // hired, fired, pay
#define EV_MISSION  4     // mission start, step, done, failed
#define EV_DANGER   5     // drone, guards chasing you
#define EV_ITEM     6     // items bought, used, keys, implants

/**
 * Add a line to a player's event box.
 *
 * @param id    player index; 0 = every connected player
 * @param kind  EV_INFO ... EV_ITEM (colour and tag)
 * @param fmt   format, plain ASCII without accents; cut to 47 characters
 * @return      lines delivered (players reached)
 */
native smak_event(id, kind, const fmt[], any:...);

#if !defined SMAK_CORE_PLUGIN
/**
 * smak_event() when smak_core has it, else a chat line "[SMAK] ...". Your plugin must set a native filter that lets
 * it load without smak_event (names beginning "smak_event"); every SMAK plugin already does.
 */
stock smak_say(id, kind, const fmt[], any:...)
{
	#pragma unused fmt
	new buf[160];
	vdformat(buf, charsmax(buf), 3, 4);
	if (LibraryExists("smak_event", LibType_Library)) return smak_event(id, kind, "%s", buf);
	if (id == 0)
	{
		new n = 0;
		for (new i = 1; i <= 32; i++)
		{
			if (!is_user_connected(i)) continue;
			client_print(i, print_chat, "[SMAK] %s", buf);
			n++;
		}
		return n;
	}
	client_print(id, print_chat, "[SMAK] %s", buf);
	return 1;
}
#endif
