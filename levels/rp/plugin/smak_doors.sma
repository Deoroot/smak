/*
 * smak_doors.sma -- better doors for the pseudo-MSC RP server on H9 (TS on Xash): locks by kind, keys, homes you
 * buy or rent, lockpicking, and the natives the guard NPCs use. Needs smak_core.amxx (listed before it in
 * plugins.ini). Optional, through a native filter and LibraryExists: smak_items (keys, the lockpick), smak_jobs
 * (who is a guard), smak_law (a break-in makes a player wanted; gates can close to wanted players).
 *
 * The map's doors. configs/smak_rp/<map>.rp.json lists "properties": [{ id, kind, doors: [targetnames] }]; every
 * leaf with such a targetname is a door of the property. No file, or no properties: the plugin does nothing (no hook
 * is registered). Per-map prices and overrides: configs/smak_rp/<map>.doors.json (format "smak-doors/1";
 * levels/rp/doors.mjs checks it offline).
 *
 * The policy of a door, by the kind of its property (a property may override it with "policy" in doors.json):
 *   shop, public, hideout, other   open: everybody
 *   home    key     locked to everybody but the owner (or renter) and the holders of a copy of the key. The owner can
 *                   leave it unlocked (/abrir) and lock it again (/cerrar); it is locked again after a map change.
 *   police, jail  guard   only a player whose smak_jobs job is one of smak_doors_guard_jobs (default "guardia", the
 *                   job with the arrest permission); smak_jobs not loaded: open
 *   gate    gate    open, except to a player wanted at smak_doors_gate_wanted stars or more (0 = never; smak_law
 *                   loaded), guards excepted
 * Enforced by a Ham_Use PRE hook on the classes the property doors have (func_door_rotating, func_door, and a button
 * if a property lists one): a PLAYER the policy refuses gets a short message and a locked sound (at most one per
 * 1.5 s) and the use is dropped. A use whose caller is not a player (an NPC through DLLFunc_Use, a trigger or a
 * button that fires the door) always passes: the guard NPCs decide for themselves whether to wait or breach (natives).
 * A door whose use was allowed closes as the map made it; the lock is checked at every use, so a locked door is locked
 * again as soon as it has closed (nothing to undo).
 *
 * Homes (/casa near a home's door): buy (price, permanent) or rent (rent for rent_days, renewable up to
 * smak_doors_rent_max_days ahead). The owner gets a key item (smak_items: the item whose "opens" is the property id,
 * for example llave_m2_flat1), can lock or unlock the door he looks at (/cerrar, /abrir), give a copy to a player near
 * him (smak_doors_copy_price; at most smak_doors_max_copies), change the lock (copies stop working) and give the
 * home up. Table homes(property, owner_ident, until) (until 0 = bought; property is "<map>:<id>", the shared
 * database serves several maps) and home_keys(property, ident), the copies given. A copy opens the door only while
 * its holder is listed there AND carries the item: a key stolen or left from a former owner opens nothing. Rent that
 * runs out frees the home, clears the copies and takes the key from whoever carries it. Guests (session-only
 * characters) cannot own or hold copies: it could not be saved.
 *
 * Lockpicking: an item "ganzua" (smak_items, sold at the fence). Using a locked HOME door with one in the pocket
 * and holding use for smak_doors_pick_time seconds (progress on the HUD) forces it: smak_doors_pick_chance %
 * success (the door opens, free for smak_doors_breach_open seconds, then locked again, and the player is wanted for
 * smak_doors_pick_wanted levels: "allanamiento"); otherwise the pick breaks. Letting go of use, moving away or dying
 * cancels it for nothing.
 *
 * Teleport doors (a site built with "doors": "teleport", levels/assembly/assemble.mjs). The leaf of such a door is a func_wall that
 * never moves, with the property's targetname, and the map has two info_targets `<name>_<n>_a` and `<name>_<n>_b` (n numbers the doors that share a name), one on each side at the
 * floor. Cry of Fear's inter_door: USE facing the door (within TELE_REACH of its middle, the near spot in sight) asks the same policy as
 * a moving leaf (can_pass: owner, key, guard, wanted at a gate, a breach or a picked lock keeping it free); allowed, the screen fades to
 * black, the player is put at the other spot (the nearest free hull if somebody stands there: smak_tele.inc) and the screen clears.
 * Refused, he is told (deny(): the lock message, and holding USE forces a home with a lockpick, which then carries him through). A
 * door with no spots, or a moving leaf of another kind (a checkpoint gate, a cell), works as it always did, and so does the use assist.
 *
 * Natives for the guards (include/smak_doors.inc): smak_door_locked, smak_door_breach, smak_door_property,
 * smak_door_kind.
 *
 * Persistence: the shared data/sqlite3/smak_rp.sq3, only its own tables. Everything is loaded once at map start (a
 * threaded select), and changes are saved by threaded queries, retried by a 60 s sweep. No per-frame work: one Ham
 * hook per door class and a 0.25 s task while someone is picking a lock.
 *
 * Never hooks FM_KeyValue, never reads a KVD, never reads the info-key buffer (Xash crashes).
 * Chat: /casa  /cerrar  /abrir (Spanish, no accents).  Admin console: smak_door_status, smak_door_sethome,
 * smak_door_clearhome.
 */

#define SMAK_DOORS_PLUGIN
#define SMAK_ITEMS_OPTIONAL
#define SMAK_JOBS_OPTIONAL
#define SMAK_LAW_OPTIONAL
#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <sqlx>
#include <json>
#include <smak_core>
#include <smak_items>
#include <smak_jobs>
#include <smak_law>
#include <smak_doors>
#include <smak_tele>

#if AMXX_VERSION_NUM >= 175
	#pragma reqlib sqlite
	#if !defined AMXMODX_NOAUTOLOAD
		#pragma loadlib sqlite
	#endif
#endif

#define PLUGIN  "SMAK doors"
#define VERSION "0.1"
#define AUTHOR  "SMAK"

#define DB_NAME       "smak_rp"
#define MAXPL         33
#define MAX_PROPS     192
#define MAX_LEAVES    8
#define MAX_KEYS      256
#define ID_LEN        32
#define NAME_LEN      48
#define IDENT_LEN     96
#define DOORS_FORMAT  "smak-doors/1"
#define RP_FORMAT     "smak-rp/1"
#define PICK_ITEM     "ganzua"
#define PRICE_MAX     1000000

#define SWEEP_SECONDS 60.0
#define DENY_GAP      1.5
#define REACH_AIM     128.0
#define REACH_NEAR    160.0

#define TASK_SWEEP    3000
#define TASK_PICK     9000
#define TASK_ASSIST   12000
#define TASK_TELE     15000   // + player id: the fade is out, the player is carried
#define MAX_TELE      320
#define TELE_REACH    88.0    // a teleport door is used from this far (flat) from its middle, facing it
#define TELE_PAIR     80.0    // a leaf and its pair of spots: the middle of the pair is this near (flat) the middle of the leaf
#define TELE_GAP      0.8     // seconds between two uses by one player
#define TELE_OUT      0.15
#define TELE_IN       0.3
#define ASSIST_REACH  60.0    // a leaf this near (its box) and in front is used for the player when the engine did not
#define ASSIST_DELAY  0.18

#define SND_LOCKED    "buttons/latchlocked2.wav"
#define SND_UNLOCK    "buttons/latchunlocked1.wav"
#define SND_PICK      "buttons/lightswitch2.wav"
#define SND_BREACH    "debris/bustcrate1.wav"
#define SND_DOOR_GO   "doors/doormove3.wav"
#define SND_DOOR_END  "doors/doorstop1.wav"

// ---- the SQL. One statement per macro, so test-doors-sql.mjs can run them against a real SQLite. -------------------
// %s is a text already passed through sql_quote() (it sits inside '...'), %d an integer.
#define Q_CREATE_HOMES  "CREATE TABLE IF NOT EXISTS homes (property TEXT NOT NULL PRIMARY KEY, owner_ident TEXT NOT NULL, until INTEGER NOT NULL DEFAULT 0)"
#define Q_CREATE_KEYS   "CREATE TABLE IF NOT EXISTS home_keys (property TEXT NOT NULL, ident TEXT NOT NULL, PRIMARY KEY (property, ident))"
#define Q_SELECT_HOMES  "SELECT property, owner_ident, until FROM homes"
#define Q_SELECT_KEYS   "SELECT property, ident FROM home_keys"
#define Q_UPSERT_HOME   "INSERT OR REPLACE INTO homes (property, owner_ident, until) VALUES ('%s','%s',%d)"
#define Q_DELETE_HOME   "DELETE FROM homes WHERE property = '%s'"
#define Q_INSERT_KEY    "INSERT OR REPLACE INTO home_keys (property, ident) VALUES ('%s','%s')"
#define Q_DELETE_KEYS   "DELETE FROM home_keys WHERE property = '%s'"

enum
{
	K_SHOP = 0,
	K_PUBLIC,
	K_GATE,
	K_HOME,
	K_JAIL,
	K_POLICE,
	K_HIDEOUT,
	K_OTHER
}

enum
{
	POL_OPEN = 0,
	POL_KEY,
	POL_GUARD,
	POL_GATE
}

new g_pcount;
new g_p_id[MAX_PROPS][ID_LEN], g_p_name[MAX_PROPS][NAME_LEN], g_p_kind[MAX_PROPS][12];
new g_p_kindn[MAX_PROPS], g_p_pol[MAX_PROPS];
new g_p_ent[MAX_PROPS][MAX_LEAVES], g_p_nent[MAX_PROPS];
new g_p_price[MAX_PROPS], g_p_rent[MAX_PROPS], g_p_days[MAX_PROPS];
new Float:g_p_free[MAX_PROPS];            // gametime until which the door is free (breach, picked lock)
new bool:g_p_unlocked[MAX_PROPS];         // the owner left it unlocked

new bool:g_h_has[MAX_PROPS];
new g_h_owner[MAX_PROPS][IDENT_LEN];
new g_h_until[MAX_PROPS];
new bool:g_h_dirty[MAX_PROPS];

new g_k_count;                            // copies of keys given: (property, ident)
new bool:g_keys_capped;
new g_k_prop[MAX_KEYS];
new g_k_ident[MAX_KEYS][IDENT_LEN];

new g_class_n;
new g_class[6][24];

new bool:g_ready[MAXPL], bool:g_guest[MAXPL];
new g_gen[MAXPL];
new g_ident[MAXPL][IDENT_LEN];
new Float:g_deny_t[MAXPL];
new g_menu_p[MAXPL], g_menu_t[MAXPL];     // the property of the open menu, the player chosen for a copy
new g_pick_p[MAXPL], g_pick_ent[MAXPL];
new Float:g_pick_t0[MAXPL];

new g_maxplayers;
new g_map[64];
new g_dbgen;
new g_pAssist;
new bool:g_dbok, bool:g_homes_loaded, bool:g_keys_loaded, bool:g_active;
new Handle:g_tuple = Empty_Handle;

new g_t_n;                                // the teleport doors: the leaf, its property, the two spots
new g_t_ent[MAX_TELE], g_t_p[MAX_TELE];
new Float:g_t_a[MAX_TELE][3], Float:g_t_b[MAX_TELE][3];
new g_t_to[MAXPL], g_t_dir[MAXPL];        // the door a player is being carried through, and which way (1: a to b)
new Float:g_t_next[MAXPL];
new g_assist_leaves;                      // leaves of the properties that move (the use assist is for these)

new g_pEnable, g_pGuards, g_pGateWanted, g_pPickTime, g_pPickChance, g_pPickWanted, g_pCopyPrice, g_pRekeyPrice;
new g_pMaxCopies, g_pRentMax, g_pBreachOpen, g_pAdminBypass, g_pDev, g_pDebug;

// ---- helpers ------------------------------------------------------------------------------------------------------

stock bool:valid_id(id)
{
	return id >= 1 && id <= g_maxplayers;
}

stock bool:is_player(ent)
{
	return ent >= 1 && ent <= g_maxplayers && is_user_connected(ent);
}

bool:lib_items()
{
	return bool:LibraryExists("smak_items", LibType_Library);
}

bool:lib_jobs()
{
	return bool:LibraryExists("smak_jobs", LibType_Library);
}

bool:lib_law()
{
	return bool:LibraryExists("smak_law", LibType_Library);
}

sql_quote(const src[], dst[], len)
{
	new j = 0;
	for (new i = 0; src[i] && j < len - 2; i++)
	{
		new c = src[i];
		if (c < 32 || c == '%') continue;
		if (c == 39) dst[j++] = 39;
		dst[j++] = c;
	}
	dst[j] = 0;
}

currency(out[], len)
{
	if (!smak_currency(out, len)) copy(out, len, "creditos");
}

// the key the shared database stores a property under: "<map>:<id>"
db_key(p, out[], len)
{
	formatex(out, len, "%s:%s", g_map, g_p_id[p]);
}

find_prop(const id[])
{
	for (new p = 0; p < g_pcount; p++)
	{
		if (equal(g_p_id[p], id)) return p;
	}
	return -1;
}

// the property a door entity belongs to, -1 for none
prop_of(ent)
{
	if (ent <= g_maxplayers) return -1;
	for (new p = 0; p < g_pcount; p++)
	{
		for (new k = 0; k < g_p_nent[p]; k++)
		{
			if (g_p_ent[p][k] == ent) return p;
		}
	}
	return -1;
}

kind_of(const text[])
{
	if (equal(text, "shop")) return K_SHOP;
	if (equal(text, "public")) return K_PUBLIC;
	if (equal(text, "gate")) return K_GATE;
	if (equal(text, "home")) return K_HOME;
	if (equal(text, "jail")) return K_JAIL;
	if (equal(text, "police")) return K_POLICE;
	if (equal(text, "hideout")) return K_HIDEOUT;
	return K_OTHER;
}

policy_default(kind)
{
	switch (kind)
	{
		case K_HOME: return POL_KEY;
		case K_JAIL, K_POLICE: return POL_GUARD;
		case K_GATE: return POL_GATE;
	}
	return POL_OPEN;
}

// distance from a player to the box of an entity (a door's origin is its pivot, not its middle)
Float:box_dist(ent, id)
{
	new Float:o[3], Float:mn[3], Float:mx[3];
	pev(id, pev_origin, o);
	pev(ent, pev_absmin, mn);
	pev(ent, pev_absmax, mx);
	new Float:d2 = 0.0;
	for (new k = 0; k < 3; k++)
	{
		new Float:d = 0.0;
		if (o[k] < mn[k]) d = mn[k] - o[k];
		else if (o[k] > mx[k]) d = o[k] - mx[k];
		d2 += d * d;
	}
	return floatsqroot(d2);
}

// the leaf of a property nearest to the player, and how far (-1 / 99999 when none)
nearest_leaf(id, p, &Float:dist)
{
	new best = -1;
	dist = 99999.0;
	for (new k = 0; k < g_p_nent[p]; k++)
	{
		new ent = g_p_ent[p][k];
		if (!pev_valid(ent)) continue;
		new Float:d = box_dist(ent, id);
		if (d < dist)
		{
			dist = d;
			best = ent;
		}
	}
	return best;
}

// the property whose door the player is looking at (within REACH_AIM), else the nearest one within REACH_NEAR
// whose kind passes kindmask (bit per K_*); -1 for none
pick_property(id, kindmask, &leaf)
{
	leaf = 0;
	new Float:o[3], Float:vo[3], Float:va[3], Float:fwd[3], Float:end[3];
	pev(id, pev_origin, o);
	pev(id, pev_view_ofs, vo);
	pev(id, pev_v_angle, va);
	for (new k = 0; k < 3; k++) o[k] += vo[k];
	engfunc(EngFunc_MakeVectors, va);
	global_get(glb_v_forward, fwd);
	for (new k = 0; k < 3; k++) end[k] = o[k] + fwd[k] * REACH_AIM;
	engfunc(EngFunc_TraceLine, o, end, DONT_IGNORE_MONSTERS, id, 0);
	new hit = get_tr2(0, TR_pHit);
	if (hit > g_maxplayers)
	{
		new p = prop_of(hit);
		if (p != -1 && (kindmask & (1 << g_p_kindn[p])))
		{
			leaf = hit;
			return p;
		}
	}
	new best = -1;
	new Float:bd = REACH_NEAR;
	for (new p = 0; p < g_pcount; p++)
	{
		if (!(kindmask & (1 << g_p_kindn[p]))) continue;
		new Float:d;
		new ent = nearest_leaf(id, p, d);
		if (ent != -1 && d < bd)
		{
			bd = d;
			best = p;
			leaf = ent;
		}
	}
	return best;
}

// ---- guards ------------------------------------------------------------------------------------------------------

bool:is_guard(id)
{
	if (!lib_jobs()) return false;
	new list[96], one[32], rest[96];
	get_pcvar_string(g_pGuards, list, charsmax(list));
	while (list[0])
	{
		rest[0] = 0;
		strtok(list, one, charsmax(one), rest, charsmax(rest), ' ');
		trim(one);
		if (one[0] && smak_job_is(id, one)) return true;
		copy(list, charsmax(list), rest);
		trim(list);
	}
	return false;
}

// ---- homes: who owns, who holds a key ---------------------------------------------------------------------------

bool:home_active(p)
{
	return g_h_has[p] && (g_h_until[p] == 0 || g_h_until[p] > get_systime());
}

bool:is_owner(id, p)
{
	if (!valid_id(id) || !g_ready[id] || g_guest[id] || !g_ident[id][0]) return false;
	return home_active(p) && equal(g_h_owner[p], g_ident[id]);
}

key_row(p, const ident[])
{
	for (new i = 0; i < g_k_count; i++)
	{
		if (g_k_prop[i] == p && equal(g_k_ident[i], ident)) return i;
	}
	return -1;
}

key_count_of(p)
{
	new n = 0;
	for (new i = 0; i < g_k_count; i++)
	{
		if (g_k_prop[i] == p) n++;
	}
	return n;
}

// the owner, or a listed holder of a copy who also carries the item (smak_items)
bool:holds_key(id, p)
{
	if (is_owner(id, p)) return true;
	if (!home_active(p) || !g_ready[id] || g_guest[id] || !g_ident[id][0]) return false;
	if (key_row(p, g_ident[id]) == -1) return false;
	return lib_items() && smak_key_has(id, g_p_id[p]);
}

// Can this player pass this door now? The one place the policy lives.
bool:can_pass(id, p)
{
	if (get_gametime() < g_p_free[p]) return true;
	if (get_pcvar_num(g_pAdminBypass) && (get_user_flags(id) & ADMIN_RCON)) return true;
	switch (g_p_pol[p])
	{
		case POL_KEY:
		{
			if (g_p_unlocked[p] && home_active(p)) return true;
			return holds_key(id, p);
		}
		case POL_GUARD:
		{
			if (!lib_jobs()) return true;      // nobody can say who is a guard: do not lock the city
			return is_guard(id);
		}
		case POL_GATE:
		{
			new stars = get_pcvar_num(g_pGateWanted);
			if (stars <= 0 || !lib_law()) return true;
			if (smak_law_level(id) < stars) return true;
			return is_guard(id);
		}
	}
	return true;
}

// ---- database -----------------------------------------------------------------------------------------------------

setup_db()
{
	g_dbok = false;
	if (!SQL_SetAffinity("sqlite"))
	{
		log_amx("[smak_doors] ERROR: no sqlite driver. Homes last the session only.");
		return;
	}
	new datadir[96], dir[128];
	get_datadir(datadir, charsmax(datadir));
	formatex(dir, charsmax(dir), "%s/sqlite3", datadir);
	if (!dir_exists(dir)) mkdir(dir);

	g_tuple = SQL_MakeDbTuple("", "", "", DB_NAME);
	new err[256], errcode;
	new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
	if (db == Empty_Handle)
	{
		log_amx("[smak_doors] ERROR: cannot open %s/%s.sq3, code %d: %s", dir, DB_NAME, errcode, err);
		return;
	}
	g_dbok = true;
	for (new t = 0; t < 2; t++)
	{
		new Handle:h = SQL_PrepareQuery(db, "%s", t == 0 ? Q_CREATE_HOMES : Q_CREATE_KEYS);
		if (!SQL_Execute(h))
		{
			SQL_QueryError(h, err, charsmax(err));
			log_amx("[smak_doors] ERROR: cannot create table %s: %s", t == 0 ? "homes" : "home_keys", err);
			g_dbok = false;
		}
		SQL_FreeHandle(h);
	}
	SQL_FreeHandle(db);
}

send_loads()
{
	if (!g_dbok || g_tuple == Empty_Handle)
	{
		g_homes_loaded = true;      // nothing to load: the session starts empty
		g_keys_loaded = true;
		return;
	}
	new data[1];
	data[0] = g_dbgen;
	SQL_ThreadQuery(g_tuple, "th_homes", Q_SELECT_HOMES, data, 1);
	SQL_ThreadQuery(g_tuple, "th_keys", Q_SELECT_KEYS, data, 1);
}

// "<map>:<id>" -> the property index, or -1 when it is another map's or unknown
prop_of_key(const key[])
{
	new plen = strlen(g_map);
	if (strncmp(key, g_map, plen) != 0 || key[plen] != ':') return -1;
	return find_prop(key[plen + 1]);
}

public th_homes(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (data[0] != g_dbgen) return;
	if (failstate != TQUERY_SUCCESS)
	{
		log_amx("[smak_doors] load of homes failed: %s (homes unknown this map; saves are held back)", error);
		g_dbok = false;      // never write over what could not be read
		g_homes_loaded = true;
		return;
	}
	new n = 0;
	while (SQL_MoreResults(query))
	{
		new key[96], owner[IDENT_LEN];
		SQL_ReadResult(query, 0, key, charsmax(key));
		SQL_ReadResult(query, 1, owner, charsmax(owner));
		new until = SQL_ReadResult(query, 2);
		new p = prop_of_key(key);
		if (p != -1 && g_p_kindn[p] == K_HOME)
		{
			g_h_has[p] = true;
			copy(g_h_owner[p], IDENT_LEN - 1, owner);
			g_h_until[p] = max(0, until);
			n++;
		}
		SQL_NextRow(query);
	}
	g_homes_loaded = true;
	log_amx("[smak_doors] %d home(s) loaded", n);
	expire_homes();
	notify_all();
}

public th_keys(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (data[0] != g_dbgen) return;
	if (failstate != TQUERY_SUCCESS)
	{
		log_amx("[smak_doors] load of copies of keys failed: %s", error);
		g_keys_loaded = true;
		return;
	}
	while (SQL_MoreResults(query))
	{
		new key[96], ident[IDENT_LEN];
		SQL_ReadResult(query, 0, key, charsmax(key));
		SQL_ReadResult(query, 1, ident, charsmax(ident));
		new p = prop_of_key(key);
		if (p != -1 && g_k_count >= MAX_KEYS && key_row(p, ident) == -1)
		{
			if (!g_keys_capped) log_amx("[smak_doors] cap MAX_KEYS (%d) reached: the keys from the database beyond it are left out", MAX_KEYS);
			g_keys_capped = true;
		}
		else if (p != -1 && key_row(p, ident) == -1)
		{
			g_k_prop[g_k_count] = p;
			copy(g_k_ident[g_k_count], IDENT_LEN - 1, ident);
			g_k_count++;
		}
		SQL_NextRow(query);
	}
	g_keys_loaded = true;
}

// A threaded statement (a save). A failure marks the property dirty: the sweep writes it again.
run_query(const q[], p)
{
	if (!g_dbok || g_tuple == Empty_Handle) return;
	new data[1];
	data[0] = p;
	SQL_ThreadQuery(g_tuple, "th_save", q, data, 1);
}

public th_save(failstate, Handle:query, error[], errnum, data[], size, Float:queuetime)
{
	if (failstate == TQUERY_SUCCESS) return;
	new p = data[0];
	log_amx("[smak_doors] SAVE FAILED for property %d: %s", p, error);
	if (p >= 0 && p < g_pcount) g_h_dirty[p] = true;
}

// Write the home row (or delete it) as memory has it now.
save_home(p)
{
	if (!g_dbok || !g_homes_loaded) return;
	new key[96], qk[200], q[500];
	db_key(p, key, charsmax(key));
	sql_quote(key, qk, charsmax(qk));
	g_h_dirty[p] = false;
	if (g_h_has[p])
	{
		new qo[200];
		sql_quote(g_h_owner[p], qo, charsmax(qo));
		formatex(q, charsmax(q), Q_UPSERT_HOME, qk, qo, g_h_until[p]);
	}
	else formatex(q, charsmax(q), Q_DELETE_HOME, qk);
	run_query(q, p);
}

save_key_add(p, const ident[])
{
	if (!g_dbok) return;
	new key[96], qk[200], qi[200], q[500];
	db_key(p, key, charsmax(key));
	sql_quote(key, qk, charsmax(qk));
	sql_quote(ident, qi, charsmax(qi));
	formatex(q, charsmax(q), Q_INSERT_KEY, qk, qi);
	run_query(q, p);
}

save_keys_clear(p)
{
	if (!g_dbok) return;
	new key[96], qk[200], q[300];
	db_key(p, key, charsmax(key));
	sql_quote(key, qk, charsmax(qk));
	formatex(q, charsmax(q), Q_DELETE_KEYS, qk);
	run_query(q, p);
}

mem_keys_clear(p)
{
	new j = 0;
	for (new i = 0; i < g_k_count; i++)
	{
		if (g_k_prop[i] == p) continue;
		if (i != j)
		{
			g_k_prop[j] = g_k_prop[i];
			copy(g_k_ident[j], IDENT_LEN - 1, g_k_ident[i]);
		}
		j++;
	}
	g_k_count = j;
}

// ---- players ------------------------------------------------------------------------------------------------------

clear_player(id)
{
	g_ready[id] = false;
	g_guest[id] = false;
	g_gen[id]++;
	g_ident[id][0] = 0;
	g_deny_t[id] = 0.0;
	g_t_to[id] = -1;
	g_t_next[id] = 0.0;
	remove_task(id + TASK_TELE);
	g_menu_p[id] = -1;
	g_menu_t[id] = 0;
	stop_pick(id, false);
}

// Forget a player. Idempotent: FM_ClientDisconnect, client_disconnected and the sweep all call it.
doors_drop(id)
{
	if (!valid_id(id)) return;
	if (!g_ready[id] && g_pick_p[id] < 0 && !g_ident[id][0]) return;
	menu_cancel(id);
	clear_player(id);
}

// Takes the player once his character is usable (called from smak_char_loaded_fw, client_putinserver and
// plugin_cfg for the same player: it does nothing when he is already taken).
begin_load(id)
{
	if (!valid_id(id) || !is_user_connected(id) || g_ready[id]) return;
	clear_player(id);
	g_ready[id] = true;
	g_guest[id] = smak_char_guest(id) != 0;
	if (!g_guest[id]) smak_char_ident(id, g_ident[id], charsmax(g_ident[]));
	if (!g_ident[id][0]) g_guest[id] = true;
	if (g_homes_loaded) notify_player(id);
}

public client_putinserver(id)
{
	if (smak_char_loaded(id)) begin_load(id);
}

public smak_char_loaded_fw(id)
{
	begin_load(id);
}

public fw_disconnect(id)
{
	doors_drop(id);
	return FMRES_IGNORED;
}

public client_disconnected(id)
{
	doors_drop(id);
}

// What a player should know about his homes when he comes in or the homes are loaded.
notify_player(id)
{
	if (!g_ready[id] || g_guest[id]) return;
	for (new p = 0; p < g_pcount; p++)
	{
		if (!is_owner(id, p)) continue;
		if (g_h_until[p] > 0)
		{
			new left = g_h_until[p] - get_systime();
			client_print(id, print_chat, "[SMAK] Tu casa %s esta alquilada: vence en %d dias y %d horas. /casa junto a la puerta para renovar.", g_p_name[p], left / 86400, (left % 86400) / 3600);
		}
		else client_print(id, print_chat, "[SMAK] Tu casa %s: /cerrar y /abrir mirando la puerta.", g_p_name[p]);
		if (lib_items() && !smak_key_has(id, g_p_id[p]))
			client_print(id, print_chat, "[SMAK] No llevas la llave de %s. /casa junto a la puerta para reponerla.", g_p_name[p]);
	}
}

notify_all()
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_ready[id]) notify_player(id);
	}
}

// the connected player carrying this identity, 0 for none
player_of_ident(const ident[])
{
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (g_ready[id] && !g_guest[id] && is_user_connected(id) && equal(g_ident[id], ident)) return id;
	}
	return 0;
}

// take the key item of a property from a player, if he carries one
take_key_item(id, p)
{
	if (!lib_items() || !is_user_connected(id)) return;
	new item[ID_LEN];
	if (smak_key_item(g_p_id[p], item, charsmax(item)) && smak_key_has(id, g_p_id[p])) smak_item_take(id, item, 1);
}

// ---- use assist ---------------------------------------------------------------------------------------------------
// The engine's use (PlayerUse) takes, among the usable things in a 64-unit sphere round the player, the one whose box
// centre is most in line with his aim. Inside a shop, against the wall of the doorway, the leaf is not that one (the other
// leaf, a button, a sign beside it are in the sphere too, and the leaf's own centre is off to the side), and E reached nothing
// until he stepped back. So: when USE goes down, and 0.18 s later no property leaf near him has started to move, the leaf in
// front of him (the most in line within ASSIST_REACH of its box) is used for him, through the same Ham_Use hook, so the lock,
// the key and the guards' rules apply as ever. A leaf already moving (the engine took the press) is never touched.
public fw_prethink(id)
{
	if (!g_active) return FMRES_IGNORED;
	if (!(pev(id, pev_button) & IN_USE) || (pev(id, pev_oldbuttons) & IN_USE)) return FMRES_IGNORED;
	if (!is_user_alive(id)) return FMRES_IGNORED;
	if (g_t_n > 0 && try_tele(id)) return FMRES_IGNORED;      // a teleport door took the press
	if (!g_assist_leaves || !get_pcvar_num(g_pAssist) || task_exists(id + TASK_ASSIST)) return FMRES_IGNORED;
	set_task(ASSIST_DELAY, "task_assist", id + TASK_ASSIST);
	return FMRES_IGNORED;
}

bool:leaf_moving(ent)
{
	new Float:v[3];
	pev(ent, pev_avelocity, v);
	if (floatabs(v[0]) + floatabs(v[1]) + floatabs(v[2]) > 0.5) return true;
	pev(ent, pev_velocity, v);
	return floatabs(v[0]) + floatabs(v[1]) + floatabs(v[2]) > 0.5;
}

public task_assist(taskid)
{
	new id = taskid - TASK_ASSIST;
	if (!valid_id(id) || !is_user_alive(id) || !(pev(id, pev_button) & IN_USE)) return;
	new Float:o[3], Float:va[3], Float:fwd[3];
	pev(id, pev_origin, o);
	pev(id, pev_v_angle, va);
	va[0] = 0.0;
	engfunc(EngFunc_MakeVectors, va);
	global_get(glb_v_forward, fwd);
	new best = 0;
	new Float:bd = 0.35;
	for (new p = 0; p < g_pcount; p++)
	{
		for (new k = 0; k < g_p_nent[p]; k++)
		{
			new ent = g_p_ent[p][k];
			if (!pev_valid(ent) || tele_of(ent) >= 0) continue;
			new Float:d = box_dist(ent, id);
			if (d > ASSIST_REACH + 40.0) continue;
			if (leaf_moving(ent)) return;      // the engine took this press
			if (d > ASSIST_REACH) continue;
			new Float:mn[3], Float:mx[3], Float:to[2];
			pev(ent, pev_absmin, mn);
			pev(ent, pev_absmax, mx);
			// from the player to the nearest point of the leaf's box, flat
			for (new c = 0; c < 2; c++)
			{
				new Float:q = o[c];
				if (q < mn[c]) q = mn[c];
				if (q > mx[c]) q = mx[c];
				to[c] = q - o[c];
			}
			new Float:len = floatsqroot(to[0] * to[0] + to[1] * to[1]);
			new Float:dot = len < 1.0 ? 1.0 : (to[0] * fwd[0] + to[1] * fwd[1]) / len;
			if (dot > bd)
			{
				bd = dot;
				best = ent;
			}
		}
	}
	if (best) dllfunc(DLLFunc_Use, best, id);
}

// ---- teleport doors -----------------------------------------------------------------------------------------------

// the teleport door whose leaf is this entity, -1 for none
tele_of(ent)
{
	for (new t = 0; t < g_t_n; t++)
	{
		if (g_t_ent[t] == ent) return t;
	}
	return -1;
}

// the spot entity of a name, its origin in `out`; false when the map has none
bool:spot_named(const name[], Float:out[3])
{
	new ent = engfunc(EngFunc_FindEntityByString, 0, "targetname", name);
	if (ent <= 0) return false;
	pev(ent, pev_origin, out);
	return true;
}

// Every leaf of a property that is a func_wall and has both spots in the map. A property's doors share its name (a shop's street door and its
// back door), so the spots are numbered: `<targetname>_<n>_a` and `<targetname>_<n>_b`, n from 1; a leaf takes the pair whose middle is nearest
// to its own, within TELE_PAIR of it.
find_tele()
{
	g_t_n = 0;
	g_assist_leaves = 0;
	for (new p = 0; p < g_pcount; p++)
	{
		for (new k = 0; k < g_p_nent[p]; k++)
		{
			new ent = g_p_ent[p][k];
			new cls[24];
			pev(ent, pev_classname, cls, charsmax(cls));
			if (!equal(cls, "func_wall"))
			{
				g_assist_leaves++;
				continue;
			}
			new tn[64], sn[80];
			pev(ent, pev_targetname, tn, charsmax(tn));
			new Float:mn[3], Float:mx[3];
			pev(ent, pev_absmin, mn);
			pev(ent, pev_absmax, mx);
			new Float:best = TELE_PAIR;
			new Float:ba[3], Float:bb[3];
			new bool:found = false;
			for (new n = 1; n <= 40; n++)
			{
				new Float:a[3], Float:b[3];
				formatex(sn, charsmax(sn), "%s_%d_a", tn, n);
				if (!spot_named(sn, a)) break;
				formatex(sn, charsmax(sn), "%s_%d_b", tn, n);
				if (!spot_named(sn, b)) break;
				new Float:dx = (a[0] + b[0]) * 0.5 - (mn[0] + mx[0]) * 0.5;
				new Float:dy = (a[1] + b[1]) * 0.5 - (mn[1] + mx[1]) * 0.5;
				new Float:d = floatsqroot(dx * dx + dy * dy);
				if (d < best)
				{
					best = d;
					ba = a;
					bb = b;
					found = true;
				}
			}
			if (!found || g_t_n >= MAX_TELE)
			{
				log_amx("[smak_doors] property %s: the wall %s has %s: not a teleport door", g_p_id[p], tn, g_t_n >= MAX_TELE ? "no room in the table" : "no pair of spots _<n>_a and _<n>_b within reach of it");
				continue;
			}
			g_t_ent[g_t_n] = ent;
			g_t_p[g_t_n] = p;
			g_t_a[g_t_n] = ba;
			g_t_b[g_t_n] = bb;
			g_t_n++;
		}
	}
}

// is the player nearer the door's spot a than b (flat)?
bool:tele_near_is_a(t, const Float:o[3])
{
	new Float:da = (g_t_a[t][0] - o[0]) * (g_t_a[t][0] - o[0]) + (g_t_a[t][1] - o[1]) * (g_t_a[t][1] - o[1]);
	new Float:db = (g_t_b[t][0] - o[0]) * (g_t_b[t][0] - o[0]) + (g_t_b[t][1] - o[1]) * (g_t_b[t][1] - o[1]);
	return da <= db;
}

// The use key: the teleport door in front of the player. True when one is (whether it let him through or not).
bool:try_tele(id)
{
	new Float:now = get_gametime();
	if (now < g_t_next[id] || g_t_to[id] >= 0) return false;
	new Float:o[3], Float:vo[3], Float:va[3], Float:fwd[3];
	pev(id, pev_origin, o);
	pev(id, pev_view_ofs, vo);
	pev(id, pev_v_angle, va);
	va[0] = 0.0;
	engfunc(EngFunc_MakeVectors, va);
	global_get(glb_v_forward, fwd);
	new best = -1;
	new Float:bd = TELE_REACH;
	for (new t = 0; t < g_t_n; t++)
	{
		if (!pev_valid(g_t_ent[t])) continue;
		if (floatabs(g_t_a[t][2] + 36.0 - o[2]) > 40.0) continue;
		new Float:mx = (g_t_a[t][0] + g_t_b[t][0]) * 0.5 - o[0];
		new Float:my = (g_t_a[t][1] + g_t_b[t][1]) * 0.5 - o[1];
		new Float:dist = floatsqroot(mx * mx + my * my);
		if (dist >= bd) continue;
		// facing the door: 60 degrees of its middle (he may stand at the wall beside it, or in the doorway)
		if (dist > 20.0 && (fwd[0] * mx + fwd[1] * my) / dist < 0.5) continue;
		// on his side of the wall: a clear line from his eyes to the near spot
		new Float:to[3], Float:eye[3];
		for (new c = 0; c < 3; c++) eye[c] = o[c] + vo[c];
		if (tele_near_is_a(t, o)) to = g_t_a[t];
		else to = g_t_b[t];
		to[2] = eye[2];
		engfunc(EngFunc_TraceLine, eye, to, IGNORE_MONSTERS, id, 0);
		new Float:fr;
		get_tr2(0, TR_flFraction, fr);
		if (fr < 0.97) continue;
		best = t;
		bd = dist;
	}
	if (best < 0) return false;
	g_t_next[id] = now + TELE_GAP;
	new p = g_t_p[best];
	if (!can_pass(id, p))
	{
		deny(id, g_t_ent[best], p);
		return true;
	}
	begin_cross(id, best);
	return true;
}

// Carry the player through door t: fade out, then task_tele puts him at the other spot. A spot with nobody's hull on it is needed
// before the screen goes black (else he is told, and nothing happens).
begin_cross(id, t)
{
	new Float:o[3], Float:want[3], Float:spare[3];
	pev(id, pev_origin, o);
	new dir = tele_near_is_a(t, o) ? 1 : 0;      // 1: from a to b
	if (dir) want = g_t_b[t];
	else want = g_t_a[t];
	want[2] += 36.0;
	if (!smak_tele_free(id, want, spare))
	{
		client_print(id, print_center, "Hay gente al otro lado de la puerta.");
		return;
	}
	stop_pick(id, false);
	g_t_to[id] = t;
	g_t_dir[id] = dir;
	g_t_next[id] = get_gametime() + TELE_GAP;
	smak_tele_fade(id, TELE_OUT, 0.0, true);
	emit_sound(g_t_ent[t], CHAN_ITEM, SND_DOOR_GO, 0.7, ATTN_NORM, 0, PITCH_NORM);
	set_task(TELE_OUT, "task_tele", TASK_TELE + id);
}

public task_tele(taskid)
{
	new id = taskid - TASK_TELE;
	new t = g_t_to[id];
	g_t_to[id] = -1;
	if (t < 0 || !is_user_alive(id)) return;
	new Float:want[3], Float:from[3], Float:spare[3];
	if (g_t_dir[id])
	{
		want = g_t_b[t];
		from = g_t_a[t];
	}
	else
	{
		want = g_t_a[t];
		from = g_t_b[t];
	}
	want[2] += 36.0;
	if (!smak_tele_free(id, want, spare))
	{
		smak_tele_fade(id, TELE_IN, 0.0, false);      // somebody took the spot meanwhile: he stays where he is
		client_print(id, print_center, "Hay gente al otro lado de la puerta.");
		return;
	}
	// facing on: from the spot he left toward the one he arrives at
	smak_tele_put(id, spare, floatatan2(want[1] - from[1], want[0] - from[0], degrees));
	smak_tele_fade(id, TELE_IN, 0.0, false);
	emit_sound(g_t_ent[t], CHAN_ITEM, SND_DOOR_END, 0.7, ATTN_NORM, 0, PITCH_NORM);
}

// ---- enforcement --------------------------------------------------------------------------------------------------

public fw_use(ent, caller, activator, use_type, Float:value)
{
	if (!g_active) return HAM_IGNORED;
	if (caller < 1 || caller > g_maxplayers) return HAM_IGNORED;      // an NPC, a trigger, a button: always passes
	new p = prop_of(ent);
	if (p == -1 || !is_user_connected(caller)) return HAM_IGNORED;
	if (can_pass(caller, p)) return HAM_IGNORED;
	deny(caller, ent, p);
	return HAM_SUPERCEDE;
}

deny(id, ent, p)
{
	new Float:now = get_gametime();
	if (g_p_pol[p] == POL_KEY) start_pick(id, ent, p);
	if (now < g_deny_t[id]) return;
	g_deny_t[id] = now + DENY_GAP;
	emit_sound(ent, CHAN_ITEM, SND_LOCKED, VOL_NORM, ATTN_NORM, 0, PITCH_NORM);
	switch (g_p_pol[p])
	{
		case POL_KEY:
		{
			if (g_pick_p[id] == p) client_print(id, print_center, "Puerta cerrada con llave. Manten USE para forzarla.");
			else client_print(id, print_center, "Puerta cerrada con llave.");
		}
		case POL_GUARD: client_print(id, print_center, "Solo para guardias.");
		case POL_GATE: client_print(id, print_center, "El puesto no te deja pasar: eres buscado.");
		default: client_print(id, print_center, "Cerrado.");
	}
}

// Free the door of a property for a few seconds (a breach, a picked lock), and open every leaf by `by`.
free_and_open(p, by)
{
	g_p_free[p] = get_gametime() + get_pcvar_float(g_pBreachOpen);
	for (new k = 0; k < g_p_nent[p]; k++)
	{
		new ent = g_p_ent[p][k];
		if (pev_valid(ent) && tele_of(ent) < 0) dllfunc(DLLFunc_Use, ent, pev_valid(by) ? by : 0);      // (a teleport leaf has nothing to open: free is all it needs)
	}
}

// ---- lockpicking --------------------------------------------------------------------------------------------------

start_pick(id, ent, p)
{
	if (g_pick_p[id] != -1 || g_p_kindn[p] != K_HOME || !g_ready[id]) return;
	if (get_pcvar_float(g_pPickTime) <= 0.0 || !is_user_alive(id)) return;
	if (!lib_items() || smak_item_count(id, PICK_ITEM) < 1) return;
	g_pick_p[id] = p;
	g_pick_ent[id] = ent;
	g_pick_t0[id] = get_gametime();
	set_task(0.25, "task_pick", id + TASK_PICK, _, _, "b");
}

stop_pick(id, bool:say)
{
	if (g_pick_p[id] == -1) return;
	remove_task(id + TASK_PICK);
	g_pick_p[id] = -1;
	g_pick_ent[id] = 0;
	if (say && is_user_connected(id)) client_print(id, print_center, "Dejas de forzar la cerradura.");
}

public task_pick(taskid)
{
	new id = taskid - TASK_PICK;
	if (!valid_id(id) || g_pick_p[id] == -1)
	{
		remove_task(taskid);
		return;
	}
	new p = g_pick_p[id];
	if (!is_user_alive(id) || !(pev(id, pev_button) & IN_USE) || !pev_valid(g_pick_ent[id]) || box_dist(g_pick_ent[id], id) > 130.0)
	{
		stop_pick(id, is_user_alive(id) ? true : false);
		return;
	}
	if (can_pass(id, p))
	{
		stop_pick(id, false);      // someone opened it meanwhile
		return;
	}
	new Float:total = get_pcvar_float(g_pPickTime);
	new Float:done = (get_gametime() - g_pick_t0[id]) / total;
	if (done < 1.0)
	{
		new bar[16], n = floatround(done * 10.0);
		for (new i = 0; i < 10; i++) bar[i] = i < n ? '#' : '-';
		bar[10] = 0;
		client_print(id, print_center, "Forzando cerradura [%s]", bar);
		emit_sound(g_pick_ent[id], CHAN_STATIC, SND_PICK, 0.3, ATTN_NORM, 0, PITCH_NORM);
		return;
	}
	new ent = g_pick_ent[id];
	stop_pick(id, false);
	if (random_num(1, 100) <= get_pcvar_num(g_pPickChance))
	{
		emit_sound(ent, CHAN_ITEM, SND_UNLOCK, VOL_NORM, ATTN_NORM, 0, PITCH_NORM);
		smak_say(id, EV_ITEM, "Has forzado la cerradura de %s", g_p_name[p]);
		log_amx("[smak_doors] slot %d picked the lock of %s", id, g_p_id[p]);
		free_and_open(p, id);
		new t = tele_of(ent);
		if (t >= 0) begin_cross(id, t);      // the lock is forced: he goes through
		new lv = get_pcvar_num(g_pPickWanted);
		if (lv > 0 && lib_law()) smak_law_add(id, clamp(lv, 1, SMAK_LAW_MAX_LEVEL), "allanamiento");
	}
	else
	{
		if (lib_items()) smak_item_take(id, PICK_ITEM, 1);
		emit_sound(ent, CHAN_ITEM, SND_LOCKED, VOL_NORM, ATTN_NORM, 0, PITCH_NORM);
		smak_say(id, EV_ITEM, "Se rompio la ganzua. Sigue cerrada");
		log_amx("[smak_doors] slot %d broke a pick at %s", id, g_p_id[p]);
	}
}

// ---- homes: buying, renting, keys ---------------------------------------------------------------------------------

// A home leaves its owner: memory, database, copies, and the key item of whoever carries it now.
release_home(p, const why[])
{
	new owner = g_h_has[p] ? player_of_ident(g_h_owner[p]) : 0;
	log_amx("[smak_doors] home %s released (%s), owner %s", g_p_id[p], why, g_h_owner[p]);
	if (owner) take_key_item(owner, p);
	for (new i = 0; i < g_k_count; i++)
	{
		if (g_k_prop[i] != p) continue;
		new holder = player_of_ident(g_k_ident[i]);
		if (holder) take_key_item(holder, p);
	}
	mem_keys_clear(p);
	save_keys_clear(p);
	g_h_has[p] = false;
	g_h_owner[p][0] = 0;
	g_h_until[p] = 0;
	g_p_unlocked[p] = false;
	save_home(p);
	if (owner) smak_say(owner, EV_ITEM, "Ya no tienes la casa %s (%s)", g_p_name[p], why);
}

expire_homes()
{
	new now = get_systime();
	for (new p = 0; p < g_pcount; p++)
	{
		if (g_h_has[p] && g_h_until[p] > 0 && g_h_until[p] <= now) release_home(p, "rent ran out");
	}
}

public task_sweep()
{
	if (!g_active) return;
	expire_homes();
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if ((g_ready[id] || g_ident[id][0]) && !is_user_connected(id))
		{
			log_amx("[smak_doors] sweep: slot %d is gone and no disconnect hook ran; dropping it now", id);
			doors_drop(id);
		}
	}
	for (new p = 0; p < g_pcount; p++)
	{
		if (g_h_dirty[p]) save_home(p);
	}
}

// can this player deal with this home now?
bool:casa_context(id, p)
{
	if (!g_ready[id])
	{
		client_print(id, print_chat, "[SMAK] Tu personaje aun se esta cargando, espera un momento.");
		return false;
	}
	if (g_guest[id])
	{
		client_print(id, print_chat, "[SMAK] Los invitados no pueden tener casa: no se podria guardar.");
		return false;
	}
	if (!g_homes_loaded || !g_keys_loaded || !g_dbok)
	{
		client_print(id, print_chat, "[SMAK] Las casas no estan disponibles ahora mismo.");
		return false;
	}
	new Float:d;
	if (nearest_leaf(id, p, d) == -1 || d > REACH_NEAR + 40.0)
	{
		client_print(id, print_chat, "[SMAK] Te has alejado de la puerta.");
		return false;
	}
	return true;
}

days_left_text(p, out[], len)
{
	new left = max(0, g_h_until[p] - get_systime());
	formatex(out, len, "%d dias %d h", left / 86400, (left % 86400) / 3600);
}

public cmd_casa(id)
{
	if (!g_active)
	{
		client_print(id, print_chat, "[SMAK] Este mapa no tiene casas.");
		return;
	}
	new leaf;
	new p = pick_property(id, 1 << K_HOME, leaf);
	if (p == -1)
	{
		client_print(id, print_chat, "[SMAK] No hay una casa cerca. Acercate a la puerta de una casa y escribe /casa.");
		return;
	}
	if (!casa_context(id, p)) return;
	open_casa(id, p);
}

open_casa(id, p)
{
	g_menu_p[id] = p;
	new cur[32], title[96], line[96];
	currency(cur, charsmax(cur));
	new bool:mine = is_owner(id, p);
	new bool:free = !home_active(p);
	if (mine) formatex(title, charsmax(title), "\yTu casa %s", g_p_name[p]);
	else if (free) formatex(title, charsmax(title), "\yCasa %s: libre", g_p_name[p]);
	else formatex(title, charsmax(title), "\yCasa %s: ocupada", g_p_name[p]);
	new menu = menu_create(title, "mh_casa");
	if (free)
	{
		if (g_p_price[p] > 0)
		{
			formatex(line, charsmax(line), "Comprar por %d %s", g_p_price[p], cur);
			menu_additem(menu, line, "buy");
		}
		if (g_p_rent[p] > 0)
		{
			formatex(line, charsmax(line), "Alquilar %d dias por %d %s", g_p_days[p], g_p_rent[p], cur);
			menu_additem(menu, line, "rent");
		}
		if (g_p_price[p] <= 0 && g_p_rent[p] <= 0) menu_additem(menu, "No esta en venta", "none");
	}
	else if (mine)
	{
		if (g_h_until[p] > 0)
		{
			new left[40];
			days_left_text(p, left, charsmax(left));
			formatex(line, charsmax(line), "Renovar alquiler +%d dias (%d %s) [%s]", g_p_days[p], g_p_rent[p], cur, left);
			menu_additem(menu, line, "rent");
			if (g_p_price[p] > 0)
			{
				formatex(line, charsmax(line), "Comprarla (%d %s)", g_p_price[p], cur);
				menu_additem(menu, line, "buy");
			}
		}
		formatex(line, charsmax(line), "Dar una copia de la llave (%d %s)", get_pcvar_num(g_pCopyPrice), cur);
		menu_additem(menu, line, "copy");
		formatex(line, charsmax(line), "Cambiar la cerradura: anula las copias (%d %s)", get_pcvar_num(g_pRekeyPrice), cur);
		menu_additem(menu, line, "rekey");
		menu_additem(menu, "Reponer mi llave", "key");
		menu_additem(menu, "Renunciar a la casa (sin reembolso)", "leave");
	}
	else menu_additem(menu, "Esta casa tiene dueno", "none");
	menu_setprop(menu, MPROP_EXIT, MEXIT_ALL);
	menu_display(id, menu, 0);
}

public mh_casa(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new info[16], access, cb;
	menu_item_getinfo(menu, item, access, info, charsmax(info), _, _, cb);
	menu_destroy(menu);
	new p = g_menu_p[id];
	if (p < 0 || p >= g_pcount || !casa_context(id, p)) return PLUGIN_HANDLED;
	if (equal(info, "buy")) buy_home(id, p, false);
	else if (equal(info, "rent")) buy_home(id, p, true);
	else if (equal(info, "copy")) copy_menu(id, p);
	else if (equal(info, "rekey")) rekey_home(id, p);
	else if (equal(info, "key")) replace_key(id, p);
	else if (equal(info, "leave")) leave_home(id, p);
	return PLUGIN_HANDLED;
}

buy_home(id, p, bool:rent)
{
	new amount = rent ? g_p_rent[p] : g_p_price[p];
	new cur[32];
	currency(cur, charsmax(cur));
	new bool:mine = is_owner(id, p);
	if (amount <= 0)
	{
		client_print(id, print_chat, "[SMAK] Esa casa no se ofrece asi.");
		return;
	}
	if (home_active(p) && !mine)
	{
		client_print(id, print_chat, "[SMAK] Alguien se ha adelantado: la casa ya tiene dueno.");
		return;
	}
	if (!rent && mine && g_h_until[p] == 0)
	{
		client_print(id, print_chat, "[SMAK] La casa ya es tuya.");
		return;
	}
	new now = get_systime();
	new Float:cap = float(get_pcvar_num(g_pRentMax) * 86400);
	if (rent && mine && float(g_h_until[p] - now + g_p_days[p] * 86400) > cap)
	{
		client_print(id, print_chat, "[SMAK] No puedes pagar tanto por adelantado (maximo %d dias).", get_pcvar_num(g_pRentMax));
		return;
	}
	if (smak_money_get(id) < amount)
	{
		client_print(id, print_chat, "[SMAK] No te alcanza: cuesta %d %s y tienes %d.", amount, cur, smak_money_get(id));
		return;
	}
	new item[ID_LEN], bool:gave = false;
	if (lib_items())
	{
		if (!smak_key_item(g_p_id[p], item, charsmax(item)))
			log_amx("[smak_doors] WARN: no key item of the catalogue opens %s: the buyer gets no key item", g_p_id[p]);
		else if (!smak_key_has(id, g_p_id[p]))
		{
			if (!smak_item_give(id, item, 1))
			{
				client_print(id, print_chat, "[SMAK] No puedes llevar la llave: libera sitio en el inventario.");
				return;
			}
			gave = true;
		}
	}
	new reason[64];
	formatex(reason, charsmax(reason), "home:%s:%s", rent ? "rent" : "buy", g_p_id[p]);
	if (!smak_money_take(id, amount, reason))
	{
		if (gave) smak_item_take(id, item, 1);
		client_print(id, print_chat, "[SMAK] No se pudo cobrar, intentalo de nuevo.");
		return;
	}
	if (!mine) copy(g_h_owner[p], IDENT_LEN - 1, g_ident[id]);
	if (rent)
	{
		new base = (mine && g_h_until[p] > now) ? g_h_until[p] : now;
		g_h_until[p] = base + g_p_days[p] * 86400;
	}
	else g_h_until[p] = 0;
	g_h_has[p] = true;
	g_p_unlocked[p] = false;
	save_home(p);
	log_amx("[smak_doors] slot %d (%s) %s home %s for %d, until %d", id, g_ident[id], rent ? "rents" : "bought", g_p_id[p], amount, g_h_until[p]);
	if (rent)
	{
		new left[40];
		days_left_text(p, left, charsmax(left));
		smak_say(id, EV_ITEM, "Casa %s alquilada por %d (%s)", g_p_name[p], amount, left);
	}
	else smak_say(id, EV_ITEM, "Compraste la casa %s por %d", g_p_name[p], amount);
	client_print(id, print_chat, "[SMAK] Mirando la puerta: /cerrar y /abrir. /casa para dar copias de la llave.");
}

leave_home(id, p)
{
	if (!is_owner(id, p)) return;
	release_home(p, "owner gave it up");
}

replace_key(id, p)
{
	if (!is_owner(id, p)) return;
	if (!lib_items())
	{
		client_print(id, print_chat, "[SMAK] Sin inventario no hay llaves: eres el dueno y la puerta te abre igualmente.");
		return;
	}
	if (smak_key_has(id, g_p_id[p]))
	{
		client_print(id, print_chat, "[SMAK] Ya llevas la llave.");
		return;
	}
	new item[ID_LEN];
	if (!smak_key_item(g_p_id[p], item, charsmax(item)))
	{
		client_print(id, print_chat, "[SMAK] No hay llave para esta casa: la puerta te abre igualmente.");
		return;
	}
	smak_item_give(id, item, 1);
}

rekey_home(id, p)
{
	if (!is_owner(id, p)) return;
	new price = get_pcvar_num(g_pRekeyPrice);
	new cur[32], reason[64];
	currency(cur, charsmax(cur));
	if (key_count_of(p) == 0)
	{
		client_print(id, print_chat, "[SMAK] No has dado copias: no hace falta cambiar la cerradura.");
		return;
	}
	formatex(reason, charsmax(reason), "home:rekey:%s", g_p_id[p]);
	if (price > 0 && !smak_money_take(id, price, reason))
	{
		client_print(id, print_chat, "[SMAK] No te alcanza: cambiar la cerradura cuesta %d %s.", price, cur);
		return;
	}
	for (new i = 0; i < g_k_count; i++)
	{
		if (g_k_prop[i] != p) continue;
		new holder = player_of_ident(g_k_ident[i]);
		if (holder)
		{
			take_key_item(holder, p);
			smak_say(holder, EV_ITEM, "Tu llave de %s ya no sirve", g_p_name[p]);
		}
	}
	mem_keys_clear(p);
	save_keys_clear(p);
	log_amx("[smak_doors] slot %d changed the lock of %s", id, g_p_id[p]);
	client_print(id, print_chat, "[SMAK] Cerradura cambiada: las copias ya no sirven.");
}

// the players near the owner who could take a copy
copy_menu(id, p)
{
	if (!is_owner(id, p)) return;
	if (!lib_items())
	{
		client_print(id, print_chat, "[SMAK] Sin inventario no se pueden dar copias.");
		return;
	}
	if (key_count_of(p) >= get_pcvar_num(g_pMaxCopies))
	{
		client_print(id, print_chat, "[SMAK] Ya diste el maximo de copias (%d). Cambia la cerradura para anularlas.", get_pcvar_num(g_pMaxCopies));
		return;
	}
	new menu = menu_create("\yDar copia de la llave a:", "mh_copy");
	new n = 0, Float:me[3], Float:o[3];
	pev(id, pev_origin, me);
	for (new t = 1; t <= g_maxplayers; t++)
	{
		if (t == id || !is_user_connected(t) || !g_ready[t] || g_guest[t]) continue;
		pev(t, pev_origin, o);
		if (get_distance_f(me, o) > 256.0) continue;
		new name[32], info[8];
		get_user_name(t, name, charsmax(name));
		num_to_str(get_user_userid(t), info, charsmax(info));
		menu_additem(menu, name, info);
		n++;
	}
	if (!n)
	{
		menu_destroy(menu);
		client_print(id, print_chat, "[SMAK] Nadie cerca (256 unidades) que pueda recibir una copia. Los invitados no pueden.");
		return;
	}
	menu_display(id, menu, 0);
}

public mh_copy(id, menu, item)
{
	if (item == MENU_EXIT || !valid_id(id))
	{
		menu_destroy(menu);
		return PLUGIN_HANDLED;
	}
	new info[8], access, cb;
	menu_item_getinfo(menu, item, access, info, charsmax(info), _, _, cb);
	menu_destroy(menu);
	new p = g_menu_p[id];
	new t = find_player("k", str_to_num(info));
	if (p < 0 || p >= g_pcount || !casa_context(id, p) || !is_owner(id, p)) return PLUGIN_HANDLED;
	if (!t || !g_ready[t] || g_guest[t] || !g_ident[t][0])
	{
		client_print(id, print_chat, "[SMAK] Ese jugador ya no esta.");
		return PLUGIN_HANDLED;
	}
	give_copy(id, t, p);
	return PLUGIN_HANDLED;
}

give_copy(id, t, p)
{
	new item[ID_LEN], cur[32], reason[64], tname[32];
	currency(cur, charsmax(cur));
	get_user_name(t, tname, charsmax(tname));
	if (key_count_of(p) >= get_pcvar_num(g_pMaxCopies) || g_k_count >= MAX_KEYS)
	{
		client_print(id, print_chat, "[SMAK] Ya diste el maximo de copias.");
		return;
	}
	if (key_row(p, g_ident[t]) != -1 && smak_key_has(t, g_p_id[p]))
	{
		client_print(id, print_chat, "[SMAK] %s ya tiene una copia.", tname);
		return;
	}
	if (!smak_key_item(g_p_id[p], item, charsmax(item)))
	{
		client_print(id, print_chat, "[SMAK] No hay llave para esta casa: no se pueden hacer copias.");
		return;
	}
	new price = get_pcvar_num(g_pCopyPrice);
	if (price > 0 && smak_money_get(id) < price)
	{
		client_print(id, print_chat, "[SMAK] No te alcanza: una copia cuesta %d %s.", price, cur);
		return;
	}
	if (!smak_key_has(t, g_p_id[p]) && !smak_item_give(t, item, 1))
	{
		client_print(id, print_chat, "[SMAK] %s no puede llevar mas cosas.", tname);
		return;
	}
	formatex(reason, charsmax(reason), "home:copy:%s", g_p_id[p]);
	if (price > 0 && !smak_money_take(id, price, reason))
	{
		smak_item_take(t, item, 1);
		client_print(id, print_chat, "[SMAK] No se pudo cobrar la copia.");
		return;
	}
	if (key_row(p, g_ident[t]) == -1)
	{
		g_k_prop[g_k_count] = p;
		copy(g_k_ident[g_k_count], IDENT_LEN - 1, g_ident[t]);
		g_k_count++;
		save_key_add(p, g_ident[t]);
	}
	log_amx("[smak_doors] slot %d gave a copy of %s to slot %d", id, g_p_id[p], t);
	smak_say(id, EV_ITEM, "Diste una copia de la llave a %s", tname);
	smak_say(t, EV_ITEM, "Recibes una copia de la llave de %s", g_p_name[p]);
}

// /cerrar and /abrir: the owner (or a holder of a copy) locks or unlocks the door he looks at
lock_command(id, bool:unlock)
{
	if (!g_active)
	{
		client_print(id, print_chat, "[SMAK] Este mapa no tiene puertas con llave.");
		return;
	}
	new leaf;
	new p = pick_property(id, 1 << K_HOME, leaf);
	if (p == -1)
	{
		client_print(id, print_chat, "[SMAK] Mira la puerta de tu casa, de cerca.");
		return;
	}
	if (!holds_key(id, p))
	{
		client_print(id, print_chat, "[SMAK] No tienes la llave de esta puerta.");
		return;
	}
	if (unlock && !is_owner(id, p))
	{
		client_print(id, print_chat, "[SMAK] Solo el dueno puede dejar la puerta abierta a todos.");
		return;
	}
	g_p_unlocked[p] = unlock;
	emit_sound(leaf, CHAN_ITEM, unlock ? SND_UNLOCK : SND_LOCKED, VOL_NORM, ATTN_NORM, 0, PITCH_NORM);
	if (unlock) smak_say(id, EV_ITEM, "Puerta sin llave: pasa cualquiera");
	else smak_say(id, EV_ITEM, "Puerta cerrada con llave");
}

public cmd_say(id)
{
	new a[48];
	read_args(a, charsmax(a));
	remove_quotes(a);
	trim(a);
	if (a[0] != '/') return PLUGIN_CONTINUE;
	if (equali(a, "/casa") || equali(a, "/home"))
	{
		cmd_casa(id);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/cerrar") || equali(a, "/lock"))
	{
		lock_command(id, false);
		return PLUGIN_HANDLED;
	}
	if (equali(a, "/abrir") || equali(a, "/unlock"))
	{
		lock_command(id, true);
		return PLUGIN_HANDLED;
	}
	return PLUGIN_CONTINUE;
}

// ---- admin --------------------------------------------------------------------------------------------------------

bool:can_admin(id)
{
	if (id == 0) return true;
	if (get_user_flags(id) & ADMIN_RCON) return true;
	return get_pcvar_num(g_pDev) && !is_dedicated_server() && id == 1;
}

public cmd_status(id)
{
	if (!can_admin(id)) return PLUGIN_HANDLED;
	console_print(id, "[smak_doors] %d properties, %d home(s) known, %d key copies, hooks on: %d class(es), homes %s", g_pcount, count_homes(), g_k_count, g_class_n, g_homes_loaded ? "loaded" : "not loaded yet");
	for (new p = 0; p < g_pcount; p++)
	{
		if (g_p_kindn[p] != K_HOME && !(read_argc() > 1)) continue;
		new owner[40];
		if (home_active(p)) formatex(owner, charsmax(owner), "%s until %d", g_h_owner[p], g_h_until[p]);
		else copy(owner, charsmax(owner), "-");
		console_print(id, "  %-18s %-8s policy %d leaves %d price %d rent %d/%dd %s%s", g_p_id[p], g_p_kind[p], g_p_pol[p], g_p_nent[p], g_p_price[p], g_p_rent[p], g_p_days[p], owner, g_p_unlocked[p] ? " [unlocked]" : "");
	}
	return PLUGIN_HANDLED;
}

count_homes()
{
	new n = 0;
	for (new p = 0; p < g_pcount; p++)
	{
		if (home_active(p)) n++;
	}
	return n;
}

// smak_door_sethome <name|#userid> <property> [days; 0 or none = for good]
public cmd_sethome(id)
{
	if (!can_admin(id)) return PLUGIN_HANDLED;
	if (read_argc() < 3)
	{
		console_print(id, "[smak_doors] usage: smak_door_sethome <name|#userid> <property id> [days]");
		return PLUGIN_HANDLED;
	}
	new who[48], pid[ID_LEN], days[12];
	read_argv(1, who, charsmax(who));
	read_argv(2, pid, charsmax(pid));
	read_argv(3, days, charsmax(days));
	new p = find_prop(pid);
	if (p == -1 || g_p_kindn[p] != K_HOME)
	{
		console_print(id, "[smak_doors] smak_door_sethome: %s is not a home of this map", pid);
		return PLUGIN_HANDLED;
	}
	new t = cmd_target(id, who, CMDTARGET_ALLOW_SELF);
	if (!t) return PLUGIN_HANDLED;
	if (!g_ready[t] || g_guest[t] || !g_homes_loaded)
	{
		console_print(id, "[smak_doors] smak_door_sethome: that player has no saved character (guest or still loading), or homes are not loaded");
		return PLUGIN_HANDLED;
	}
	if (home_active(p) && !equal(g_h_owner[p], g_ident[t])) release_home(p, "admin gave it to another player");
	copy(g_h_owner[p], IDENT_LEN - 1, g_ident[t]);
	g_h_has[p] = true;
	g_h_until[p] = (days[0] && str_to_num(days) > 0) ? get_systime() + str_to_num(days) * 86400 : 0;
	save_home(p);
	if (lib_items())
	{
		new item[ID_LEN];
		if (smak_key_item(g_p_id[p], item, charsmax(item)) && !smak_key_has(t, g_p_id[p])) smak_item_give(t, item, 1);
	}
	new name[32];
	get_user_name(t, name, charsmax(name));
	console_print(id, "[smak_doors] %s now holds %s (until %d)", name, g_p_id[p], g_h_until[p]);
	log_amx("[smak_doors] admin %d gave home %s to slot %d (%s) until %d", id, g_p_id[p], t, name, g_h_until[p]);
	return PLUGIN_HANDLED;
}

public cmd_clearhome(id)
{
	if (!can_admin(id)) return PLUGIN_HANDLED;
	new pid[ID_LEN];
	read_argv(1, pid, charsmax(pid));
	new p = find_prop(pid);
	if (p == -1)
	{
		console_print(id, "[smak_doors] usage: smak_door_clearhome <property id>");
		return PLUGIN_HANDLED;
	}
	if (g_h_has[p]) release_home(p, "admin cleared it");
	console_print(id, "[smak_doors] %s is free", g_p_id[p]);
	return PLUGIN_HANDLED;
}

// ---- natives ------------------------------------------------------------------------------------------------------

public plugin_natives()
{
	register_library("smak_doors");
	register_native("smak_door_locked", "_door_locked");
	register_native("smak_door_breach", "_door_breach");
	register_native("smak_door_property", "_door_property");
	register_native("smak_door_kind", "_door_kind");
	set_native_filter("native_filter");
}

// smak_items, smak_jobs and smak_law are optional: a native that is missing is never called (lib_*() is asked first)
public native_filter(const name[], index, trap)
{
	if (!trap) return PLUGIN_HANDLED;
	return PLUGIN_CONTINUE;
}

public bool:_door_locked(plugin, params)
{
	new p = prop_of(get_param(1));
	if (p == -1 || get_gametime() < g_p_free[p]) return false;
	switch (g_p_pol[p])
	{
		case POL_KEY: return !(g_p_unlocked[p] && home_active(p));
		case POL_GUARD: return lib_jobs();
	}
	return false;
}

public _door_breach(plugin, params)
{
	new ent = get_param(1), by = get_param(2);
	new p = prop_of(ent);
	if (p == -1) return 0;
	new src[64];
	get_plugin(plugin, src, charsmax(src));
	log_amx("[smak_doors] breach: property %s (%s) door %d by entity %d, from %s", g_p_id[p], g_p_kind[p], ent, by, src);
	emit_sound(ent, CHAN_STATIC, SND_BREACH, VOL_NORM, ATTN_NONE, 0, PITCH_NORM);
	free_and_open(p, by);
	return 1;
}

public _door_property(plugin, params)
{
	new p = prop_of(get_param(1));
	new len = get_param(3);
	if (p == -1)
	{
		set_string(2, "", len);
		return 0;
	}
	return set_string(2, g_p_id[p], len);
}

public _door_kind(plugin, params)
{
	new p = prop_of(get_param(1));
	new len = get_param(3);
	if (p == -1)
	{
		set_string(2, "", len);
		return 0;
	}
	return set_string(2, g_p_kind[p], len);
}

// ---- the map's files ----------------------------------------------------------------------------------------------

// the leaves of a property: every entity of the map named like one of its doors
add_leaves(p, const name[])
{
	new ent = 0;
	while ((ent = engfunc(EngFunc_FindEntityByString, ent, "targetname", name)) > 0)
	{
		new cls[24];
		pev(ent, pev_classname, cls, charsmax(cls));
		if (!equal(cls, "func_door") && !equal(cls, "func_door_rotating") && !equal(cls, "func_button") && !equal(cls, "momentary_door") && !equal(cls, "func_rot_button") && !equal(cls, "func_wall")) continue;
		if (g_p_nent[p] >= MAX_LEAVES)
		{
			log_amx("[smak_doors] property %s has more than %d leaves: %s (entity %d) left out", g_p_id[p], MAX_LEAVES, name, ent);
			continue;
		}
		g_p_ent[p][g_p_nent[p]++] = ent;
		new bool:known = false;
		for (new c = 0; c < g_class_n; c++)
		{
			if (equal(g_class[c], cls)) known = true;
		}
		if (!known && g_class_n < 6 && !equal(cls, "func_wall")) copy(g_class[g_class_n++], 23, cls);   // (a teleport leaf is not used by the engine: no Ham_Use hook)
	}
}

load_props()
{
	g_pcount = 0;
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.rp.json", dir, g_map);
	if (!file_exists(path))
	{
		log_amx("[smak_doors] no %s: this map has no properties, the doors are left alone", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_doors] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[64];
	json_object_get_string(root, "map", text, charsmax(text));
	if (!equal(text, g_map))
	{
		log_amx("[smak_doors] ERROR: %s is for map ^"%s^", not ^"%s^": refused", path, text, g_map);
		json_free(root);
		return;
	}
	new JSON:list = json_object_get_value(root, "properties");
	if (list != Invalid_JSON)
	{
		new count = json_array_get_count(list);
		for (new i = 0; i < count; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			if (g_pcount >= MAX_PROPS)
			{
				log_amx("[smak_doors] more than %d properties: the rest are left out", MAX_PROPS);
				json_free(one);
				break;
			}
			new p = g_pcount;
			g_p_id[p][0] = 0;
			json_object_get_string(one, "id", g_p_id[p], ID_LEN - 1);
			json_object_get_string(one, "kind", g_p_kind[p], 11);
			new JSON:doors = json_object_get_value(one, "doors");
			if (!g_p_id[p][0] || find_prop(g_p_id[p]) != -1 || doors == Invalid_JSON)
			{
				log_amx("[smak_doors] property %d has no id, a repeated one or no doors: left out", i + 1);
				if (doors != Invalid_JSON) json_free(doors);
				json_free(one);
				continue;
			}
			copy(g_p_name[p], NAME_LEN - 1, g_p_id[p]);
			g_p_kindn[p] = kind_of(g_p_kind[p]);
			g_p_pol[p] = policy_default(g_p_kindn[p]);
			g_p_nent[p] = 0;
			g_p_price[p] = 0;
			g_p_rent[p] = 0;
			g_p_days[p] = 7;
			g_p_free[p] = 0.0;
			g_p_unlocked[p] = false;
			g_h_has[p] = false;
			g_h_owner[p][0] = 0;
			g_h_until[p] = 0;
			g_h_dirty[p] = false;
			for (new d = 0, n = json_array_get_count(doors); d < n; d++)
			{
				new dn[64];
				json_array_get_string(doors, d, dn, charsmax(dn));
				add_leaves(p, dn);
			}
			json_free(doors);
			json_free(one);
			if (g_p_nent[p] == 0)
			{
				log_amx("[smak_doors] property %s: none of its doors is in the map: left out", g_p_id[p]);
				continue;
			}
			g_pcount++;
		}
		json_free(list);
	}
	json_free(root);
}

// <map>.doors.json: defaults by kind and per-property prices, names and policy overrides
load_prices()
{
	new dir[96], path[160];
	get_configsdir(dir, charsmax(dir));
	formatex(path, charsmax(path), "%s/smak_rp/%s.doors.json", dir, g_map);
	new defprice = 0, defrent = 0, defdays = 7;
	if (!file_exists(path))
	{
		log_amx("[smak_doors] no %s: homes are not for sale or rent on this map", path);
		return;
	}
	new JSON:root = json_parse(path, true);
	if (root == Invalid_JSON || !json_is_object(root))
	{
		log_amx("[smak_doors] ERROR: %s is not a JSON object: refused", path);
		if (root != Invalid_JSON) json_free(root);
		return;
	}
	new text[40];
	json_object_get_string(root, "format", text, charsmax(text));
	if (!equal(text, DOORS_FORMAT))
	{
		log_amx("[smak_doors] ERROR: %s has format ^"%s^", not ^"%s^": refused", path, text, DOORS_FORMAT);
		json_free(root);
		return;
	}
	if (json_object_has_value(root, "defaults.home.price", JSONNumber, true)) defprice = json_object_get_number(root, "defaults.home.price", true);
	if (json_object_has_value(root, "defaults.home.rent", JSONNumber, true)) defrent = json_object_get_number(root, "defaults.home.rent", true);
	if (json_object_has_value(root, "defaults.home.rent_days", JSONNumber, true)) defdays = json_object_get_number(root, "defaults.home.rent_days", true);
	for (new p = 0; p < g_pcount; p++)
	{
		if (g_p_kindn[p] != K_HOME) continue;
		g_p_price[p] = clamp(defprice, 0, PRICE_MAX);
		g_p_rent[p] = clamp(defrent, 0, PRICE_MAX);
		g_p_days[p] = clamp(defdays, 1, 365);
	}
	new JSON:list = json_object_get_value(root, "properties");
	if (list != Invalid_JSON)
	{
		for (new i = 0, n = json_array_get_count(list); i < n; i++)
		{
			new JSON:one = json_array_get_value(list, i);
			new pid[ID_LEN];
			json_object_get_string(one, "id", pid, charsmax(pid));
			new p = find_prop(pid);
			if (p == -1)
			{
				log_amx("[smak_doors] %s: property ^"%s^" is not on this map: left out", path, pid);
				json_free(one);
				continue;
			}
			new nm[NAME_LEN];
			json_object_get_string(one, "name", nm, charsmax(nm));
			if (nm[0]) copy(g_p_name[p], NAME_LEN - 1, nm);
			if (json_object_has_value(one, "price", JSONNumber)) g_p_price[p] = clamp(json_object_get_number(one, "price"), 0, PRICE_MAX);
			if (json_object_has_value(one, "rent", JSONNumber)) g_p_rent[p] = clamp(json_object_get_number(one, "rent"), 0, PRICE_MAX);
			if (json_object_has_value(one, "rent_days", JSONNumber)) g_p_days[p] = clamp(json_object_get_number(one, "rent_days"), 1, 365);
			new pol[12];
			json_object_get_string(one, "policy", pol, charsmax(pol));
			if (equal(pol, "open")) g_p_pol[p] = POL_OPEN;
			else if (equal(pol, "key")) g_p_pol[p] = POL_KEY;
			else if (equal(pol, "guard")) g_p_pol[p] = POL_GUARD;
			else if (equal(pol, "gate")) g_p_pol[p] = POL_GATE;
			else if (pol[0]) log_amx("[smak_doors] property %s: policy ^"%s^" is not open, key, guard or gate: ignored", pid, pol);
			json_free(one);
		}
		json_free(list);
	}
	json_free(root);
}

// ---- plugin lifecycle ---------------------------------------------------------------------------------------------

public plugin_precache()
{
	precache_sound(SND_LOCKED);
	precache_sound(SND_UNLOCK);
	precache_sound(SND_PICK);
	precache_sound(SND_BREACH);
	precache_sound(SND_DOOR_GO);
	precache_sound(SND_DOOR_END);
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	g_maxplayers = get_maxplayers();
	get_mapname(g_map, charsmax(g_map));

	g_pEnable = create_cvar("smak_doors_enable", "1", FCVAR_NONE, "0: the plugin leaves every door alone");
	g_pGuards = create_cvar("smak_doors_guard_jobs", "guardia", FCVAR_NONE, "smak_jobs job ids (space separated) that open the doors of police and jail");
	g_pGateWanted = create_cvar("smak_doors_gate_wanted", "0", FCVAR_NONE, "wanted stars from which the gates stay shut to a player (0 never; smak_law may raise it)");
	g_pPickTime = create_cvar("smak_doors_pick_time", "8.0", FCVAR_NONE, "seconds of holding use to force a lock with a lockpick (0 turns lockpicking off)");
	g_pPickChance = create_cvar("smak_doors_pick_chance", "60", FCVAR_NONE, "percent chance a lockpick works; else it breaks");
	g_pPickWanted = create_cvar("smak_doors_pick_wanted", "1", FCVAR_NONE, "wanted levels a break-in adds (0 none)");
	g_pCopyPrice = create_cvar("smak_doors_copy_price", "20", FCVAR_NONE, "price of a copy of a home key");
	g_pRekeyPrice = create_cvar("smak_doors_rekey_price", "30", FCVAR_NONE, "price of changing a home's lock (voids the copies)");
	g_pMaxCopies = create_cvar("smak_doors_max_copies", "3", FCVAR_NONE, "copies of one home key the owner may hand out");
	g_pRentMax = create_cvar("smak_doors_rent_max_days", "28", FCVAR_NONE, "most days of rent that can be paid ahead");
	g_pBreachOpen = create_cvar("smak_doors_breach_open", "6.0", FCVAR_NONE, "seconds a breached or picked door stays free before it locks again");
	g_pAdminBypass = create_cvar("smak_doors_admin_bypass", "0", FCVAR_NONE, "1: ADMIN_RCON players pass every door");
	g_pDev = create_cvar("smak_doors_dev", "0", FCVAR_NONE, "1: the host of a listen server may use the admin commands");
	g_pDebug = create_cvar("smak_doors_debug", "0", FCVAR_NONE, "1: log the doors found");

	for (new id = 1; id < MAXPL; id++)
	{
		g_pick_p[id] = -1;
		g_menu_p[id] = -1;
		g_t_to[id] = -1;
	}
	g_pAssist = create_cvar("smak_doors_assist", "1", FCVAR_NONE, "1: pressing USE next to a door the engine did not take (too close, a usable thing nearer the aim) uses it anyway");
	register_forward(FM_ClientDisconnect, "fw_disconnect");
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	register_concmd("smak_door_status", "cmd_status", ADMIN_ALL, "[all] -- doors, homes and owners (ADMIN_RCON)");
	register_concmd("smak_door_sethome", "cmd_sethome", ADMIN_ALL, "<name|#userid> <property> [days] -- give a home (ADMIN_RCON)");
	register_concmd("smak_door_clearhome", "cmd_clearhome", ADMIN_ALL, "<property> -- free a home (ADMIN_RCON)");

	if (!get_pcvar_num(g_pEnable))
	{
		log_amx("[smak_doors] smak_doors_enable is 0: the doors are left alone");
		return;
	}
	load_props();
	load_prices();
	// one Ham hook for each door class the properties have; none when the map has no property
	for (new c = 0; c < g_class_n; c++) RegisterHam(Ham_Use, g_class[c], "fw_use", 0);
	g_active = g_pcount > 0;
	if (g_active) find_tele();
	if (g_active) register_forward(FM_PlayerPreThink, "fw_prethink");
	if (g_active)
	{
		new homes = 0, locked = 0;
		for (new p = 0; p < g_pcount; p++)
		{
			if (g_p_kindn[p] == K_HOME) homes++;
			if (g_p_pol[p] != POL_OPEN) locked++;
			if (get_pcvar_num(g_pDebug)) log_amx("[smak_doors] %s kind %s policy %d: %d leaf(s), price %d rent %d/%dd", g_p_id[p], g_p_kind[p], g_p_pol[p], g_p_nent[p], g_p_price[p], g_p_rent[p], g_p_days[p]);
		}
		log_amx("[smak_doors] %s (map %s): %d propert%s (%d homes, %d with a lock), Ham_Use hooked on %d class(es), %d teleport door(s), %d moving leaf(ves)", VERSION, g_map, g_pcount, g_pcount == 1 ? "y" : "ies", homes, locked, g_class_n, g_t_n, g_assist_leaves);
	}
}

public plugin_cfg()
{
	if (!g_active) return;
	setup_db();
	g_dbgen++;
	send_loads();
	for (new id = 1; id <= g_maxplayers; id++)
	{
		if (is_user_connected(id) && smak_char_loaded(id)) begin_load(id);       // started late: take the players already in
	}
	set_task(SWEEP_SECONDS, "task_sweep", TASK_SWEEP, _, _, "b");
}

// map end: nothing is held back: every change was sent when it was made, a failed one is dirty
public plugin_end()
{
	if (g_tuple == Empty_Handle) return;
	new bool:any = false;
	for (new p = 0; p < g_pcount && !any; p++)
	{
		if (g_h_dirty[p]) any = true;
	}
	if (any && g_dbok)
	{
		new err[256], errcode;
		new Handle:db = SQL_Connect(g_tuple, errcode, err, charsmax(err));
		if (db == Empty_Handle) log_amx("[smak_doors] plugin_end: cannot open the database (%d: %s); changed homes not saved", errcode, err);
		else
		{
			for (new p = 0; p < g_pcount; p++)
			{
				if (!g_h_dirty[p]) continue;
				new key[96], qk[200], q[500];
				db_key(p, key, charsmax(key));
				sql_quote(key, qk, charsmax(qk));
				if (g_h_has[p])
				{
					new qo[200];
					sql_quote(g_h_owner[p], qo, charsmax(qo));
					formatex(q, charsmax(q), Q_UPSERT_HOME, qk, qo, g_h_until[p]);
				}
				else formatex(q, charsmax(q), Q_DELETE_HOME, qk);
				new Handle:h = SQL_PrepareQuery(db, "%s", q);
				if (!SQL_Execute(h))
				{
					SQL_QueryError(h, err, charsmax(err));
					log_amx("[smak_doors] plugin_end: save of %s failed: %s", g_p_id[p], err);
				}
				SQL_FreeHandle(h);
			}
			SQL_FreeHandle(db);
		}
	}
	SQL_FreeHandle(g_tuple);
	g_tuple = Empty_Handle;
}
