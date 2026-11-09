/*
 * smak_tele.inc -- the pieces of a teleport that more than one plugin needs: the black fade (what an env_fade with "activator
 * only" sends), the free-spot search (a landing that must not be inside a wall, a solid entity or another player), and the
 * arrival (origin, no speed, facing). Copied from smak_tpguard.sma (the guard() ring search, fade(), task_cross()'s arrival) so
 * that smak_doors can carry a player through a door without that plugin; smak_tpguard uses it too.
 *
 * Use:  #include <fakemeta>  then  #include <smak_tele>   (compile with -ilevels/rp/plugin/include)
 *
 *   smak_tele_fade(id, secs, hold, bool:out)   a ScreenFade to one player: black, `secs` to go (out: and stay out) or to clear (in)
 *   smak_tele_hull(id)                         the hull he stands in: standing or ducking
 *   bool:smak_tele_blocked(id, p, hull, bool:world_only)
 *                                              is his hull, put at p, in the world or (not world_only) a solid entity / another player
 *   bool:smak_tele_free(id, want, out)         `want` itself when his hull is free there, else the nearest free spot of the same floor
 *                                              in rings of 40, 80 and 120 units round it (12 angles each); false when there is none.
 *                                              The walk to a ring spot is a hull trace that must not hit the world (a wall between is a
 *                                              spot on the other side: skipped); `want` inside a wall is not walked from. Does not move him.
 *   smak_tele_put(id, p, Float:yaw)            sets his origin to p, speed 0, off the ground, facing yaw (view locked for a frame)
 */

#if defined _smak_tele_included
	#endinput
#endif
#define _smak_tele_included

#include <fakemeta>

#define SMAK_TELE_RING_N  3
#define SMAK_TELE_ANGLE_N 12

stock smak_tele_fade(id, Float:secs, Float:hold, bool:out)
{
	static msg;
	if (!msg) msg = get_user_msgid("ScreenFade");
	message_begin(MSG_ONE_UNRELIABLE, msg, _, id);
	write_short(floatround(secs * 4096.0));
	write_short(floatround(hold * 4096.0));
	write_short(out ? 0x0001 | 0x0004 : 0x0000);   // FFADE_OUT (| STAYOUT) / FFADE_IN
	write_byte(0);
	write_byte(0);
	write_byte(0);
	write_byte(255);
	message_end();
}

stock smak_tele_hull(id)
{
	return (pev(id, pev_flags) & FL_DUCKING) ? HULL_HEAD : HULL_HUMAN;
}

stock bool:smak_tele_blocked(id, const Float:p[3], hull, bool:world_only)
{
	engfunc(EngFunc_TraceHull, p, p, world_only ? IGNORE_MONSTERS : DONT_IGNORE_MONSTERS, hull, id, 0);
	return bool:(get_tr2(0, TR_StartSolid) || get_tr2(0, TR_AllSolid));
}

stock bool:smak_tele_free(id, const Float:want[3], Float:out[3])
{
	new hull = smak_tele_hull(id);
	out[0] = want[0];
	out[1] = want[1];
	out[2] = want[2];
	if (!smak_tele_blocked(id, want, hull, false)) return true;
	new bool:in_wall = smak_tele_blocked(id, want, hull, true);
	new Float:rings[SMAK_TELE_RING_N] = {40.0, 80.0, 120.0};
	for (new r = 0; r < SMAK_TELE_RING_N; r++)
	{
		for (new a = 0; a < SMAK_TELE_ANGLE_N; a++)
		{
			new Float:ang = float(a) * 360.0 / float(SMAK_TELE_ANGLE_N);
			new Float:p[3];
			p[0] = want[0] + rings[r] * floatcos(ang, degrees);
			p[1] = want[1] + rings[r] * floatsin(ang, degrees);
			p[2] = want[2];
			if (!in_wall)
			{
				engfunc(EngFunc_TraceHull, want, p, IGNORE_MONSTERS, hull, id, 0);
				new Float:fr;
				get_tr2(0, TR_flFraction, fr);
				if (fr < 1.0 || get_tr2(0, TR_StartSolid) || get_tr2(0, TR_AllSolid)) continue;
			}
			// the floor: a hull trace down; a pit (nothing within 20) or a step of more than 18 is another floor
			new Float:q[3];
			q = p;
			q[2] = want[2] - 20.0;
			engfunc(EngFunc_TraceHull, p, q, IGNORE_MONSTERS, hull, id, 0);
			new Float:ff;
			get_tr2(0, TR_flFraction, ff);
			if (ff >= 1.0 || get_tr2(0, TR_StartSolid) || get_tr2(0, TR_AllSolid)) continue;
			new Float:e[3];
			get_tr2(0, TR_vecEndPos, e);
			if (floatabs(e[2] - want[2]) > 18.0) continue;
			e[2] += 0.5;
			if (smak_tele_blocked(id, e, hull, false)) continue;
			out[0] = e[0];
			out[1] = e[1];
			out[2] = e[2];
			return true;
		}
	}
	return false;
}

stock smak_tele_put(id, const Float:p[3], Float:yaw)
{
	new Float:v[3];
	set_pev(id, pev_origin, p);
	set_pev(id, pev_velocity, v);
	set_pev(id, pev_flags, pev(id, pev_flags) & ~FL_ONGROUND);
	new Float:a[3];
	a[1] = yaw;
	set_pev(id, pev_angles, a);
	set_pev(id, pev_v_angle, a);
	set_pev(id, pev_fixangle, 1);
}
