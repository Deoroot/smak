// Stage 10's textures (the Xash adapter): every surface's role from stage 6 turned into a texture name an H9 client
// has, and the audit of every name the .map wears (PLAN.md Phase 3, stage 10: "every texture or material present";
// "Each fault, its cause": stage 10's texture audit).
//
// Written rules:
//   - A role takes, in order: the kit's texture serving it (only with the kit on: a built or approved texture of
//     levels/art/newbyzantium-kit.json whose `serves` names the role), the texture stage 6 chose for the thing when a
//     client has it, the role's own textures in the description (`materials.<role>.textures`, the first a client
//     has), else the role's stand-in (levels/art/client-textures.json `standIns.byRole`), else the clearly named
//     fallback (`standIns.fallback`). Every stand-in and fallback is listed with the role, what it wanted and why.
//   - A part's own texture name (a form's grate, a light shaft) is used when a client has it, else its stand-in by
//     name (`standIns.byName`), else the role's.
//   - A name "a client has" is in a WAD of levels/art/client-textures.json marked `onClients` (a partial record: the
//     names the art-kit survey wrote down), or, given the WAD files (`wadFiles`), in their directories; the tool
//     textures (sky, origin, clip, null...) always. Matching is case-blind, as the engine's.
//   - The worldspawn's WAD list: the WADs a used name comes from, in the record's order (on-client first), the
//     kit's newbyzantium.wad last when the kit is on.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { HERE } from "./common.mjs";
import { wadTextureNames } from "../../src/maps/plan.mjs";

export const CLIENTS_PATH = join(HERE, "../art/client-textures.json");
export const KIT_PATH = join(HERE, "../art/newbyzantium-kit.json");
export const KIT_WAD = "newbyzantium.wad";
/** The compilers' and the engine's own names: never looked up in a WAD. */
const TOOLS = new Set(["sky", "origin", "clip", "null", "skip", "hint", "aaatrigger", "bevel", "nullnoclip", "noclip", "solidhint"]); // prettier-ignore
/** A role the kit serves under another name (the frame is the mega-structure's soffit and piers). */
const KIT_ALIASES = { "frame-cement": ["role:deck-soffit", "role:pier"], "frame-marble-gold": ["role:pier"], water: ["water:canal"] };

const low = (s) => String(s).toLowerCase();

/**
 * The resolver for one build. `desc` the description (its materials), `clients` the record (parsed; default the
 * file), `kit` true to prefer the kit's textures, `wadFiles` WAD paths whose directories replace the record for
 * those files. Returns { ofRole(role, wanted, why), ofName(name, role), onClients(name), audit() }.
 */
export function textureResolver({ desc, clients = null, kit = false, kitManifest = null, wadFiles = [] } = {}) {
  clients ??= JSON.parse(readFileSync(CLIENTS_PATH, "utf8"));
  const wads = clients.wads.map((w) => ({ ...w, set: new Set(w.names.map(low)) }));
  const skipped = [];
  for (const file of wadFiles) {
    // the decal WADs are passed over: tempdecal and pldecal are never searched (src/maps/wad.mjs), and decals.wad's
    // letters are for the game's decals, not counted on for brushes (levels/art/client-textures.json's note)
    if (/^(decals|tempdecal|pldecal|custom)\.wad$/i.test(basename(file))) {
      skipped.push(basename(file));
      continue;
    }
    const names = new Set(wadTextureNames(readFileSync(file)).map(low));
    const at = wads.find((w) => low(w.file) === low(basename(file)));
    if (at) Object.assign(at, { set: names, read: file });
    else wads.push({ short: basename(file), file: basename(file), onClients: true, set: names, read: file });
  }
  const notOn = new Map();
  for (const [why, names] of Object.entries(clients.notOnClients ?? {})) for (const n of names) notOn.set(low(n), why);
  const S = clients.standIns ?? {};
  let kitBy = new Map();
  if (kit) {
    kitManifest ??= JSON.parse(readFileSync(KIT_PATH, "utf8"));
    for (const t of kitManifest.textures ?? []) {
      if (!["built", "approved"].includes(t.status)) continue;
      for (const s of t.serves ?? []) if (!kitBy.has(s)) kitBy.set(s, t.name);
    }
  }
  const kitNames = new Set([...kitBy.values()].map(low));
  const materials = desc?.materials ?? {};

  /** The WAD a name is in, or null. */
  const wadOf = (name) => {
    const n = low(name);
    if (TOOLS.has(n)) return "(tool)";
    if (kit && kitNames.has(n)) return KIT_WAD;
    for (const w of wads) if (w.onClients && w.set.has(n)) return w.file;
    return null;
  };
  const used = new Map(); // name -> { wad, roles: Set, uses }
  const standIns = new Map(); // role|wanted -> { role, wanted, used, why, uses }
  const note = (name, role) => {
    const u = used.get(name) ?? { name, wad: wadOf(name), roles: new Set(), uses: 0 };
    if (role) u.roles.add(role);
    u.uses++;
    used.set(name, u);
    return name;
  };
  const standIn = (role, wanted, name, why) => {
    const k = `${role}|${wanted ?? ""}`;
    const s = standIns.get(k) ?? { role, wanted: wanted ?? null, used: name, why, uses: 0 };
    s.uses++;
    standIns.set(k, s);
    return note(name, role);
  };
  const whyNot = (name) => (notOn.has(low(name)) ? `${name} is not on the clients (${notOn.get(low(name))})` : `${name} is in no WAD the clients have (as recorded)`); // prettier-ignore

  function ofRole(role, wanted = null) {
    if (!role) return standIn("(none)", wanted, S.fallback, "no role: the fallback");
    if (kit) for (const key of [role, ...(KIT_ALIASES[role] ?? [])]) if (kitBy.has(key)) return note(kitBy.get(key), role);
    if (wanted && wadOf(wanted)) return note(wanted, role);
    const own = materials[role]?.textures ?? [];
    const onClient = own.find((t) => wadOf(t));
    if (onClient) return note(onClient, role);
    const why = wanted ? whyNot(wanted) : own.length ? `its textures (${own.join(", ")}) are on no client` : `the role names no texture`; // prettier-ignore
    const si = S.byRole?.[role];
    if (si && wadOf(si)) return standIn(role, wanted ?? own[0] ?? null, si, why);
    return standIn(role, wanted ?? own[0] ?? null, S.fallback, `${why}; no stand-in for the role: the fallback ${S.fallback}`);
  }
  const roleOfName = new Map();
  for (const [r, m] of Object.entries(materials)) for (const n of m.textures ?? []) if (!roleOfName.has(low(n))) roleOfName.set(low(n), r);
  function ofName(name, role = null) {
    role ??= roleOfName.get(low(name)) ?? null;
    if (wadOf(name)) return note(name, role);
    const si = S.byName?.[name];
    if (si && wadOf(si)) return standIn(role ?? `(texture ${name})`, name, si, whyNot(name));
    return ofRole(role, null);
  }
  function audit() {
    const textures = [...used.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((u) => ({ name: u.name, wad: u.wad, roles: [...u.roles].sort(), uses: u.uses })); // prettier-ignore
    const wadsUsed = [];
    for (const w of wads) if (textures.some((t) => t.wad === w.file)) wadsUsed.push(w.file);
    if (kit && textures.some((t) => t.wad === KIT_WAD)) wadsUsed.push(KIT_WAD);
    return {
      record: wadFiles.length ? `levels/art/client-textures.json, the directories of ${wads.filter((w) => w.read).map((w) => w.file).join(", ") || "no WAD"} read from the files${skipped.length ? ` (${skipped.join(", ")} passed over: decals)` : ""}` : "levels/art/client-textures.json (partial: the names the survey recorded)", // prettier-ignore
      kit,
      wads: wadsUsed,
      textures,
      unresolved: textures.filter((t) => !t.wad).map((t) => t.name),
      tooLong: textures.filter((t) => t.name.length > 15).map((t) => t.name),
      standIns: [...standIns.values()].sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0)),
    };
  }
  return { ofRole, ofName, wadOf, audit };
}
