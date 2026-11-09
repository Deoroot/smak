/*
 * smak_tpguard -- nobody ends up stuck inside another player after a teleport, and the metro car's doors work as Cry of Fear's
 * inter_door does (The Specialists on H9 / Xash3D). It needs no JSON and no other plugin; a map with neither teleports nor car
 * doorways costs it nothing but two hooks.
 *
 * Why a plugin of its own: smak_rp and smak_npc read levels/rp CONTRACT JSON and return from plugin_init on a map without it
 * (smak_npc also with no NPCs), and the guard has to work on any map with a trigger_teleport.
 *
 * 1. The arrival guard (cvar smak_tpguard 1; 0 = off).
 *    A player is "teleported" when (a) a trigger_teleport's Touch moved him (Ham_Touch pre and post: his origin differs by more than
 *    16 units; this covers the metro's departure and arrival zones, the ride's fallback exit, manholes and ladders that are
 *    trigger_teleports) or (b) his origin is more than smak_tpguard_jump (256) from where the last frame left it with no respawn
 *    in between (every other teleport: another plugin's set_pev/engfunc SetOrigin, a mission arena's entry). Then his hull
 *    (standing HULL_HUMAN, ducking HULL_HEAD) is traced AT the landing point against the world and every solid entity (players,
 *    solid NPCs). Free: nothing happens. Blocked:
 *      - rings of 40, 80 and 120 units, 12 angles each, are searched in that order; a spot is taken when
 *        the walk there (a hull trace from the landing point, world only) is clear, so it is on the same side of every wall;
 *        the floor under it is within 18 units of the landing point's (a hull trace down: no pit, no drop through a floor or
 *        into a track), and the hull there is free of players and the world;
 *      - none free: he is made SOLID_NOT (the idea of smak_npc's solid_sync) and only restored when no player is within 38 units
 *        of him on the same storey for three checks in a row (every 0.2 s; it is solid again at 32 touching, so 38 is the
 *        hysteresis), or after smak_tpguard_ghost (12) seconds at the most. A ghost is not hit by bullets, so it is brief.
 *    Why Touch and not only the position: Touch gives the exact teleport, with no false positive from a fall or a lag spike;
 *    the position check is the net under the rest. A doorway use (below) is a teleport that calls the same guard.
 *
 * 2. The car doorways, as Cry of Fear's inter_door: use, a short fade, a teleport, no moving leaf to wait for. The map (levels/assembly/
 *    metro.mjs trainDoors) places for each doorway of a parked car two info_targets at the floor, `smak_cd_<name>_<n>_in` inside the car
 *    and `smak_cd_<name>_<n>_out` on the platform. A player within 72 units of a doorway's middle and facing it (the other
 *    spot is within 55 degrees of his view, so the Partir button on the end wall and a platform wall's use are not taken) who presses
 *    use is faded out (0.15 s), carried to the other spot (the guard applied) and faded in (0.3 s). The fade is a ScreenFade message to him
 *    alone: it is what an env_fade with "activator only" (4) sends, without an entity per doorway. The car's doors are shut
 *    in its model and never move (a CLIP plug fills each doorway): the only way through is this use. It works only while the doorway's
 *    LOCK is open. The lock is a func_door `<name>_doors` the map keeps as a state flag, one a doorway (a 2-high passable plate in the
 *    wall, invisible, the one whose slide is nearest the doorway's middle): the ride manager toggles it by name, shut from the countdown
 *    to the end of the ride, and then use says "Las puertas estan cerradas" (smak_tpguard_doors 0 turns the doorways off). The first
 *    time a player looks at a doorway he is told "Usa (E) para subir" or "para bajar".
 *
 * Never hooks FM_KeyValue, never reads a KVD, never reads the info-key buffer (Xash crashes). Cvars: smak_tpguard, smak_tpguard_jump,
 * smak_tpguard_ghost, smak_tpguard_doors, smak_tpguard_debug.
 */

#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>

#define PLUGIN  "SMAK tpguard"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define MAXPL        33
#define MAX_DOORWAYS 96
#define KEY_LEN      72
#define LEAF_MAX     64
#define RING_N       3
#define ANGLE_N      12
#define TASK_GHOST   7400
#define TASK_FADE    7500   // + player id

new g_cv_on, g_cv_jump, g_cv_ghost, g_cv_doors, g_cv_debug;
new g_msg_fade;

new Float:g_pre[MAXPL][3];       // origin before a trigger_teleport's Touch
new bool:g_pre_set[MAXPL];
new Float:g_last[MAXPL][3];      // origin at the end of the last frame
new bool:g_last_ok[MAXPL];       // false after a spawn (the first frame is not a jump)
new bool:g_ghost[MAXPL];
new Float:g_ghost_since[MAXPL];
new g_clear_n[MAXPL];
new Float:g_next_use[MAXPL];
new Float:g_next_hint[MAXPL];
new bool:g_hinted[MAXPL];         // told once how a doorway is used

new g_dw_n;
new g_dw_key[MAX_DOORWAYS][KEY_LEN];
new Float:g_dw_in[MAX_DOORWAYS][3];
new Float:g_dw_out[MAX_DOORWAYS][3];
new bool:g_dw_has_in[MAX_DOORWAYS];
new bool:g_dw_has_out[MAX_DOORWAYS];
new g_dw_leaf_name[MAX_DOORWAYS][KEY_LEN];
new g_fade_to[MAXPL];            // the doorway being used (-1 none) and which way: +1 out, 0 in is encoded in g_fade_dir
new g_fade_dir[MAXPL];

new g_leaf[LEAF_MAX];
new g_leaf_n;

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	register_cvar("smak_tpguard_version", VERSION, FCVAR_SERVER | FCVAR_SPONLY);
	g_cv_on = register_cvar("smak_tpguard", "1");
	g_cv_jump = register_cvar("smak_tpguard_jump", "256");
	g_cv_ghost = register_cvar("smak_tpguard_ghost", "12");
	g_cv_doors = register_cvar("smak_tpguard_doors", "1");
	g_cv_debug = register_cvar("smak_tpguard_debug", "0");
	g_msg_fade = get_user_msgid("ScreenFade");
	RegisterHam(Ham_Touch, "trigger_teleport", "fw_tp_pre", 0);
	RegisterHam(Ham_Touch, "trigger_teleport", "fw_tp_post", 1);
	RegisterHamPlayer(Ham_Spawn, "fw_spawn", 1);
	RegisterHamPlayer(Ham_Killed, "fw_killed", 1);
	register_forward(FM_PlayerPreThink, "fw_prethink");
	register_forward(FM_PlayerPostThink, "fw_postthink");
	for (new i = 0; i < MAXPL; i++) g_fade_to[i] = -1;
}

public plugin_cfg()
{
	find_doorways();
	log_amx("[smak_tpguard] %d car doorway(s), %d door leaf(ves) on this map; guard %s", g_dw_n, g_leaf_n, get_pcvar_num(g_cv_on) ? "on" : "off");
}

public client_putinserver(id)
{
	clear_player(id);
}

public client_disconnected(id)
{
	clear_player(id);
}

clear_player(id)
{
	g_pre_set[id] = false;
	g_last_ok[id] = false;
	g_ghost[id] = false;
	g_clear_n[id] = 0;
	g_next_use[id] = 0.0;
	g_next_hint[id] = 0.0;
	g_hinted[id] = false;
	g_fade_to[id] = -1;
	remove_task(TASK_FADE + id);
}

public fw_spawn(id)
{
	g_last_ok[id] = false;
	if (g_ghost[id]) unghost(id);
}

public fw_killed(id)
{
	g_last_ok[id] = false;
	g_ghost[id] = false;
}

// =======================================================================================================
// the arrival guard
// =======================================================================================================

public fw_tp_pre(ent, other)
{
	if (other >= 1 && other < MAXPL && is_user_alive(other))
	{
		pev(other, pev_origin, g_pre[other]);
		g_pre_set[other] = true;
	}
	return HAM_IGNORED;
}

public fw_tp_post(ent, other)
{
	if (other < 1 || other >= MAXPL || !g_pre_set[other]) return HAM_IGNORED;
	g_pre_set[other] = false;
	if (!is_user_alive(other) || !get_pcvar_num(g_cv_on)) return HAM_IGNORED;
	new Float:o[3];
	pev(other, pev_origin, o);
	if (vector_distance(o, g_pre[other]) > 16.0)
	{
		guard(other);
		g_last[other] = o;    // (guard may have moved him: refreshed below)
		pev(other, pev_origin, g_last[other]);
		g_last_ok[other] = true;
	}
	return HAM_IGNORED;
}

public fw_prethink(id)
{
	if (!is_user_alive(id)) return FMRES_IGNORED;
	if (get_pcvar_num(g_cv_on) && g_last_ok[id])
	{
		new Float:o[3];
		pev(id, pev_origin, o);
		if (vector_distance(o, g_last[id]) > get_pcvar_float(g_cv_jump))
		{
			guard(id);
		}
	}
	// the use key on a car doorway
	if (g_dw_n > 0 && g_fade_to[id] < 0)
	{
		new buttons = pev(id, pev_button);
		if ((buttons & IN_USE) && !(pev(id, pev_oldbuttons) & IN_USE)) try_doorway(id);
		else if (!g_hinted[id] && get_pcvar_num(g_cv_doors) && get_gametime() >= g_next_hint[id])
		{
			// the first time he looks at a doorway: how it is used (once a map, checked twice a second)
			g_next_hint[id] = get_gametime() + 0.5;
			new hdir;
			new hd = pick_doorway(id, hdir);
			if (hd >= 0)
			{
				g_hinted[id] = true;
				client_print(id, print_center, hdir ? "Usa (E) para bajar" : "Usa (E) para subir");
			}
		}
	}
	return FMRES_IGNORED;
}

public fw_postthink(id)
{
	if (!is_user_alive(id)) return FMRES_IGNORED;
	pev(id, pev_origin, g_last[id]);
	g_last_ok[id] = true;
	return FMRES_IGNORED;
}

/// The hull a player stands in: standing or ducking.
hull_of(id)
{
	return (pev(id, pev_flags) & FL_DUCKING) ? HULL_HEAD : HULL_HUMAN;
}

/// Is the player's hull, put at `p`, inside the world or a solid entity (another player, a solid NPC)? `world_only`: players and monsters ignored.
bool:blocked_at(id, const Float:p[3], hull, bool:world_only)
{
	engfunc(EngFunc_TraceHull, p, p, world_only ? IGNORE_MONSTERS : DONT_IGNORE_MONSTERS, hull, id, 0);
	return bool:(get_tr2(0, TR_StartSolid) || get_tr2(0, TR_AllSolid));
}

/// Is the hull free at the landing point? If not, the nearest free spot of the same floor; if none, the player passes through players for a while.
guard(id)
{
	new Float:o[3];
	pev(id, pev_origin, o);
	new hull = hull_of(id);
	if (!blocked_at(id, o, hull, false)) return;
	new bool:in_wall = blocked_at(id, o, hull, true);
	new Float:rings[RING_N] = {40.0, 80.0, 120.0};
	for (new r = 0; r < RING_N; r++)
	{
		for (new a = 0; a < ANGLE_N; a++)
		{
			new Float:ang = float(a) * 360.0 / float(ANGLE_N);
			new Float:p[3];
			p[0] = o[0] + rings[r] * floatcos(ang, degrees);
			p[1] = o[1] + rings[r] * floatsin(ang, degrees);
			p[2] = o[2];
			// the walk there: world only, so a wall between is a spot on the other side of it (skipped); not tried from inside a wall
			if (!in_wall)
			{
				engfunc(EngFunc_TraceHull, o, p, IGNORE_MONSTERS, hull, id, 0);
				new Float:fr;
				get_tr2(0, TR_flFraction, fr);
				if (fr < 1.0 || get_tr2(0, TR_StartSolid) || get_tr2(0, TR_AllSolid)) continue;
			}
			// the floor: a hull trace down; a pit (nothing within 20) or a step of more than 18 is another floor
			new Float:q[3];
			q = p;
			q[2] = o[2] - 20.0;
			engfunc(EngFunc_TraceHull, p, q, IGNORE_MONSTERS, hull, id, 0);
			new Float:ff;
			get_tr2(0, TR_flFraction, ff);
			if (ff >= 1.0 || get_tr2(0, TR_StartSolid) || get_tr2(0, TR_AllSolid)) continue;
			new Float:e[3];
			get_tr2(0, TR_vecEndPos, e);
			if (floatabs(e[2] - o[2]) > 18.0) continue;
			e[2] += 0.5;
			if (blocked_at(id, e, hull, false)) continue;
			set_pev(id, pev_origin, e);
			set_pev(id, pev_velocity, Float:{0.0, 0.0, 0.0});
			if (get_pcvar_num(g_cv_debug)) log_amx("[smak_tpguard] %d moved %.0f units (ring %d)", id, rings[r], r);
			return;
		}
	}
	// nothing free: through the others until the hulls part
	if (!g_ghost[id])
	{
		g_ghost[id] = true;
		g_ghost_since[id] = get_gametime();
		g_clear_n[id] = 0;
		set_pev(id, pev_solid, SOLID_NOT);
		if (!task_exists(TASK_GHOST)) set_task(0.2, "task_ghost", TASK_GHOST, _, _, "b");
		if (get_pcvar_num(g_cv_debug)) log_amx("[smak_tpguard] %d has no free spot: not solid until he is clear", id);
	}
}

unghost(id)
{
	g_ghost[id] = false;
	g_clear_n[id] = 0;
	if (is_user_alive(id)) set_pev(id, pev_solid, SOLID_SLIDEBOX);
}

public task_ghost()
{
	new any = 0;
	new Float:now = get_gametime();
	for (new id = 1; id < MAXPL; id++)
	{
		if (!g_ghost[id]) continue;
		if (!is_user_connected(id) || !is_user_alive(id))
		{
			g_ghost[id] = false;
			continue;
		}
		new Float:o[3];
		pev(id, pev_origin, o);
		new bool:near = false;
		for (new j = 1; j < MAXPL && !near; j++)
		{
			if (j == id || !is_user_alive(j)) continue;
			new Float:q[3];
			pev(j, pev_origin, q);
			if (floatabs(q[2] - o[2]) < 76.0 && (q[0] - o[0]) * (q[0] - o[0]) + (q[1] - o[1]) * (q[1] - o[1]) < 38.0 * 38.0) near = true;
		}
		if (near) g_clear_n[id] = 0;
		else g_clear_n[id]++;
		if (g_clear_n[id] >= 3 || now - g_ghost_since[id] > get_pcvar_float(g_cv_ghost))
		{
			unghost(id);
			continue;
		}
		set_pev(id, pev_solid, SOLID_NOT);   // (the game may put it back)
		any++;
	}
	if (!any) remove_task(TASK_GHOST);
}

// =======================================================================================================
// the car doorways
// =======================================================================================================

/// Reads the map's `smak_cd_<name>_<n>_in` / `_out` info_targets, and the leaves of every func_door with a name ending in `_doors`.
find_doorways()
{
	g_dw_n = 0;
	g_leaf_n = 0;
	new ent = -1;
	new name[KEY_LEN + 16];
	while ((ent = engfunc(EngFunc_FindEntityByString, ent, "classname", "info_target")) > 0)
	{
		pev(ent, pev_targetname, name, charsmax(name));
		if (strncmp(name, "smak_cd_", 8) != 0) continue;
		new len = strlen(name);
		new bool:is_in = (len > 3 && equal(name[len - 3], "_in"));
		new bool:is_out = (len > 4 && equal(name[len - 4], "_out"));
		if (!is_in && !is_out) continue;
		new key[KEY_LEN];
		copy(key, min(charsmax(key), len - (is_in ? 3 : 4) - 8), name[8]);
		new d = -1;
		for (new k = 0; k < g_dw_n; k++) if (equal(g_dw_key[k], key)) d = k;
		if (d < 0)
		{
			if (g_dw_n >= MAX_DOORWAYS)
			{
				log_amx("[smak_tpguard] CAP MAX_DOORWAYS (%d) exceeded", MAX_DOORWAYS);
				continue;
			}
			d = g_dw_n++;
			copy(g_dw_key[d], charsmax(g_dw_key[]), key);
			// the leaf's name: the key without its last `_<n>`, plus `_doors`
			new cut = strlen(key) - 1;
			while (cut > 0 && key[cut] != '_') cut--;
			copy(g_dw_leaf_name[d], charsmax(g_dw_leaf_name[]), key);
			g_dw_leaf_name[d][cut] = 0;
			add(g_dw_leaf_name[d], charsmax(g_dw_leaf_name[]), "_doors");
		}
		if (is_in)
		{
			pev(ent, pev_origin, g_dw_in[d]);
			g_dw_has_in[d] = true;
		}
		else
		{
			pev(ent, pev_origin, g_dw_out[d]);
			g_dw_has_out[d] = true;
		}
	}
	ent = -1;
	while ((ent = engfunc(EngFunc_FindEntityByString, ent, "classname", "func_door")) > 0)
	{
		pev(ent, pev_targetname, name, charsmax(name));
		new len = strlen(name);
		if (len < 7 || !equal(name[len - 6], "_doors")) continue;
		if (g_leaf_n < LEAF_MAX) g_leaf[g_leaf_n++] = ent;
	}
}

/// Is the doorway's leaf shut? The leaf of its name whose box is nearest the doorway's middle ALONG the wall: a shut leaf is within
/// 26 of it (the doorway is 52 wide), an open one has slid its own width into the pier.
bool:doorway_shut(d)
{
	new Float:mid[3], Float:dir[3];
	for (new k = 0; k < 3; k++) mid[k] = (g_dw_in[d][k] + g_dw_out[d][k]) * 0.5;
	dir[0] = g_dw_out[d][0] - g_dw_in[d][0];
	dir[1] = g_dw_out[d][1] - g_dw_in[d][1];
	new Float:l = floatsqroot(dir[0] * dir[0] + dir[1] * dir[1]);
	if (l < 1.0) return false;
	// the wall's tangent: perpendicular to the way through
	new Float:tx = -dir[1] / l, Float:ty = dir[0] / l;
	new Float:best = 99999.0;
	new name[KEY_LEN + 16];
	for (new i = 0; i < g_leaf_n; i++)
	{
		new ent = g_leaf[i];
		if (!pev_valid(ent)) continue;
		pev(ent, pev_targetname, name, charsmax(name));
		if (!equal(name, g_dw_leaf_name[d])) continue;
		new Float:mn[3], Float:mx[3];
		pev(ent, pev_absmin, mn);
		pev(ent, pev_absmax, mx);
		new Float:cx = (mn[0] + mx[0]) * 0.5 - mid[0];
		new Float:cy = (mn[1] + mx[1]) * 0.5 - mid[1];
		if (floatabs(cx * dir[0] / l + cy * dir[1] / l) > 48.0) continue;   // not at this wall
		new Float:along = floatabs(cx * tx + cy * ty);
		if (along < best) best = along;
	}
	return best < 26.0;
}

/// The doorway a player is at and facing (within 72 of its middle, the other spot within 55 degrees of his view), or -1; `bdir` 1: he goes out to the platform, 0: in.
pick_doorway(id, &bdir)
{
	new Float:o[3], Float:ang[3], Float:fwd[3];
	pev(id, pev_origin, o);
	pev(id, pev_v_angle, ang);
	angle_vector(ang, ANGLEVECTOR_FORWARD, fwd);
	new best = -1;
	bdir = 0;
	new Float:bd = 72.0;
	for (new d = 0; d < g_dw_n; d++)
	{
		if (!g_dw_has_in[d] || !g_dw_has_out[d]) continue;
		new Float:mid[3];
		for (new k = 0; k < 3; k++) mid[k] = (g_dw_in[d][k] + g_dw_out[d][k]) * 0.5;
		if (floatabs(mid[2] + 36.0 - o[2]) > 40.0) continue;
		new Float:dist = floatsqroot((mid[0] - o[0]) * (mid[0] - o[0]) + (mid[1] - o[1]) * (mid[1] - o[1]));
		if (dist >= bd) continue;
		// which side: nearer the in spot, he goes out
		new Float:di = (g_dw_in[d][0] - o[0]) * (g_dw_in[d][0] - o[0]) + (g_dw_in[d][1] - o[1]) * (g_dw_in[d][1] - o[1]);
		new Float:dout = (g_dw_out[d][0] - o[0]) * (g_dw_out[d][0] - o[0]) + (g_dw_out[d][1] - o[1]) * (g_dw_out[d][1] - o[1]);
		new dir = (di < dout) ? 1 : 0;   // 1: out to the platform, 0: in to the car
		new Float:to[3];
		to[0] = (dir ? g_dw_out[d][0] : g_dw_in[d][0]) - o[0];
		to[1] = (dir ? g_dw_out[d][1] : g_dw_in[d][1]) - o[1];
		new Float:tl = floatsqroot(to[0] * to[0] + to[1] * to[1]);
		if (tl < 1.0) continue;
		// facing it: 55 degrees (cos 0.57) of the other spot, horizontally
		new Float:fl = floatsqroot(fwd[0] * fwd[0] + fwd[1] * fwd[1]);
		if (fl < 0.01 || (fwd[0] * to[0] + fwd[1] * to[1]) / (fl * tl) < 0.57) continue;
		best = d;
		bdir = dir;
		bd = dist;
	}
	return best;
}

try_doorway(id)
{
	if (!get_pcvar_num(g_cv_doors)) return;
	new Float:now = get_gametime();
	if (now < g_next_use[id]) return;
	new bdir;
	new best = pick_doorway(id, bdir);
	if (best < 0) return;
	g_next_use[id] = now + 1.0;
	if (doorway_shut(best))
	{
		client_print(id, print_center, "Las puertas estan cerradas");
		return;
	}
	g_fade_to[id] = best;
	g_fade_dir[id] = bdir;
	fade(id, 0.15, 0.0, true);
	set_task(0.15, "task_cross", TASK_FADE + id);
}

public task_cross(taskid)
{
	new id = taskid - TASK_FADE;
	new d = g_fade_to[id];
	g_fade_to[id] = -1;
	if (d < 0 || !is_user_alive(id)) return;
	new Float:p[3];
	if (g_fade_dir[id]) p = g_dw_out[d];
	else p = g_dw_in[d];
	p[2] += 36.0;                 // the spots are at the floor, as a teleport destination is
	new Float:v[3];
	set_pev(id, pev_origin, p);
	set_pev(id, pev_velocity, v);
	set_pev(id, pev_flags, pev(id, pev_flags) & ~FL_ONGROUND);
	// facing the way on: from the spot he left toward the one he stands on, then on
	new Float:from[3];
	if (g_fade_dir[id]) from = g_dw_in[d];
	else from = g_dw_out[d];
	new Float:dx = p[0] - from[0], Float:dy = p[1] - from[1];
	new Float:a[3];
	a[1] = floatatan2(dy, dx, degrees);
	set_pev(id, pev_angles, a);
	set_pev(id, pev_v_angle, a);
	set_pev(id, pev_fixangle, 1);
	guard(id);
	pev(id, pev_origin, g_last[id]);
	g_last_ok[id] = true;
	fade(id, 0.3, 0.0, false);
}

/// A ScreenFade to one player (what an env_fade with "activator only" sends): black, `secs` to go (out: stay out) or to clear (in).
fade(id, Float:secs, Float:hold, bool:out)
{
	message_begin(MSG_ONE_UNRELIABLE, g_msg_fade, _, id);
	write_short(floatround(secs * 4096.0));
	write_short(floatround(hold * 4096.0));
	write_short(out ? 0x0001 | 0x0004 : 0x0000);   // FFADE_OUT (| STAYOUT) / FFADE_IN
	write_byte(0);
	write_byte(0);
	write_byte(0);
	write_byte(255);
	message_end();
}
