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
