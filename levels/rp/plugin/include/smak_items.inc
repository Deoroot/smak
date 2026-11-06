/*
 * smak_items.inc -- natives of smak_items.amxx (levels/rp/plugin/smak_items.sma), the items, inventory and shops of
 * the pseudo-MSC system (levels/rp/NPCS.md, sections 5.8 and 5.11, phase 4).
 *
 * Use:   #include <smak_items>      (compile with -ilevels/rp/plugin/include)
 * smak_items.amxx must be running, listed AFTER smak_core.amxx in plugins.ini. A plugin that wants it only if
 * present defines SMAK_ITEMS_OPTIONAL before the include, sets a native filter and tests
 * LibraryExists("smak_items", LibType_Library) before calling.
 *
 * Items are named by their id in configs/smak_rp/items.json ("botiquin"). A player's inventory is usable once their
 * character is (smak_char_loaded_fw of smak_core); until then every native refuses (0/false) and changes nothing.
 * Guests have an inventory for the session only.
 *
 * A plugin that cannot depend on this one (smak_script, which only wants to open a shop) can call it by name:
 *     callfunc_begin("smak_shop_open", "smak_items.amxx");  callfunc_push_int(id);  callfunc_push_str("marco");
 *     callfunc_end();                                          // returns 1 when the shop opened
 */

#if defined _smak_items_included
	#endinput
#endif
#define _smak_items_included

#if !defined SMAK_ITEMS_PLUGIN && !defined SMAK_ITEMS_OPTIONAL
	#pragma reqlib smak_items
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib smak_items
	#endif
#endif

/**
 * How many of an item the player has. 0 when none, when the item id is unknown, or when the inventory is not usable.
 */
native smak_item_count(id, const item[]);

/**
 * Put count (> 0) of an item into the inventory. All or nothing: refused when the item is unknown, the stack limit
 * would be passed, there is no free slot, or the inventory is not usable yet.
 *
 * @return  1 done, 0 refused (the reason goes to the AMXX log)
 */
native bool:smak_item_give(id, const item[], count);

/**
 * Take count (> 0) of an item out. All or nothing: refused when the player has fewer.
 *
 * @return  1 done, 0 refused
 */
native bool:smak_item_take(id, const item[], count);

/**
 * A key item opens a property of the map (a door group of rp.json "properties"): the item says so with "opens":
 * "<property id>" in items.json. Does the player hold at least one key item that opens this property? False when
 * the inventory is not usable yet.
 */
native bool:smak_key_has(id, const property[]);

/**
 * The id of the (first) key item of the catalogue that opens this property, into out[].
 *
 * @return  true if there is one; false (and an empty out) if no item opens it
 */
native bool:smak_key_item(const property[], out[], len);

#if !defined SMAK_ITEMS_PLUGIN && !defined SMAK_ITEMS_OPTIONAL
/**
 * Open a shop's buy/sell menu to a player, wherever they stand. The same function can be called by name with
 * callfunc_begin("smak_shop_open", "smak_items.amxx") from a plugin that does not include this file.
 *
 * @param shop  the shop's id in configs/smak_rp/<map>.shops.json
 * @return      1 the menu opened, 0 refused (no such shop on this map, character not usable)
 */
forward smak_shop_open(id, const shop[]);
#endif
