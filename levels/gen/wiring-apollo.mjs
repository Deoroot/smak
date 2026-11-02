#!/usr/bin/env node
// wiring-apollo: the map generator's RP wiring contract (07-wiring.json, levels/gen/stage7-wiring.mjs) turned into a
// per-map seed for Apollo-RP, the AMX Mod X role-play suite for The Specialists (ARP_TS.amxx), which keys its
// properties on door targetnames.
//
//   node levels/gen/wiring-apollo.mjs <07-wiring.json> --map h9_tsrp_newbyzantium [--out <dir>]
//
// Writes, as Apollo-RP's own per-map configs do (configs/arp/maps/<map>/):
//   <map>.sql     CREATE TABLE IF NOT EXISTS + INSERT rows for arp_properties and arp_doors
//   jailmod.ini   one [section] a cell: origin "x y z" and command "n" (ARP_JailMod)
//   zones.ini     one "name" { "boundaries1" "x y z", "boundaries2" "x y z" } a zone (ARP_Zones)
//
// SOURCE (read 2026-11-01): github.com/DouglasSherk/Apollo-RP, master:
//   base/addons/amxmodx/configs/arp/maps/mecklenburgv5_a6/mecklenburgv5_a6.sql (the shipped per-map seed):
//     CREATE TABLE IF NOT EXISTS arp_doors (targetname VARCHAR(36),internalname VARCHAR(66),UNIQUE KEY (targetname))
//     CREATE TABLE IF NOT EXISTS arp_properties (internalname VARCHAR(66),externalname VARCHAR(66),ownername
//       VARCHAR(40),ownerauth VARCHAR(36),price INT(11),locked INT(11),access VARCHAR(27),profit INT(11),UNIQUE KEY (internalname))
//     INSERT INTO `arp_doors` VALUES ('t|md_doors2', 'mcmd')            -- "t|" + the door's targetname ("e|<index>" by entity index)
//     INSERT INTO `arp_properties` VALUES ('mcpd', 'Mecklenburg Police Department', '', '', 0, 1, 'a', 0)
//   base/addons/amxmodx/scripting/ARP_Core.sma: the same CREATE TABLEs; a door's targetname read into 32 characters
//     (so at most 31, the description's doors.maxNameLength); "t|"/"e|" stripped on load; func_door and
//     func_door_rotating only.
//   base/addons/amxmodx/configs/arp/maps/example_config/jailmod.ini and zones.ini: the two ini formats.
// KNOWN GAPS (labelled guesses below): ARP_Core.sma's default property table is "arp_property" (arp.ini:
// arp_table_property) while the shipped seeds write "arp_properties": PROPERTY_TABLE picks the seeds' name, change it
// to the server's arp.ini. Prices, access letters and the jobs table are game design, not in the contract: the
// prices are housing.price's relative rent times PRICE_UNIT (a guess sized to Mecklenburg's 350,000 flats), the
// access letters a guess (MSR 'a' as Mecklenburg's police, the city 'c', insurgents 'i', each business its own from
// 'd'), and no arp_jobs rows are written (jobs carry the access letters; the server's admins write them).
// The shipped seeds end their statements with no semicolon ("Apply using in-game tool or any SQL editor"); this
// writes a semicolon after each, which an SQL editor needs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROPERTY_TABLE = "arp_properties"; // GUESS between the seeds' arp_properties and ARP_Core's default arp_property
export const DOORS_TABLE = "arp_doors";
export const PRICE_UNIT = 60000; // GUESS: housing.price 6 (flat-l) = 360,000, as Mecklenburg's apartments (350,000)
export const BUSINESS_PRICE = 500000; // GUESS: Mecklenburg's diner and 7/11
export const PRICE_BY_CLASS = { hut: 1, slum: 1, "flat-s": 2, "flat-m": 3, house: 5, "flat-l": 6, manor: 10 }; // housing.price's defaults
export const GROUP_ACCESS = { msr: "a", city: "c", insurgents: "i" }; // GUESS
const BUSINESS_LETTERS = "defghjklmnopqrstuvwxyz".split("");
const PLAYER_Z = 36; // a standing player's origin over the floor, units

const q = (s) => `'${String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const title = (id) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The seed for one map from a wiring contract. `opts`: { map, prices: { class: relative rent } (the description's
 * housing.price), priceUnit, businessPrice }. Returns { files: { "<map>.sql", "jailmod.ini", "zones.ini" },
 * properties: [...], doors: [...], skipped: [{ name, why }], notes: [...] }.
 */
export function apolloSeed(wiring, { map = "map", prices = PRICE_BY_CLASS, priceUnit = PRICE_UNIT, businessPrice = BUSINESS_PRICE } = {}) {
  const g = wiring.grid ?? { cellUnits: 128, origin: [0, 0] };
  const u = (p) => [Math.round((p[0] - g.origin[0]) * g.cellUnits), Math.round((p[1] - g.origin[1]) * g.cellUnits), Math.round(p[2] * g.cellUnits)]; // prettier-ignore
  const zoneName = Object.fromEntries(wiring.zones.map((z) => [z.ref, z.name]));
  // properties: one a key held by a lockable, non-secret door
  const props = new Map();
  const skipped = [];
  const letters = {};
  let li = 0;
  for (const d of wiring.doors) {
    if (d.kind === "secret" || d.kind === "hatch") {
      skipped.push({ name: d.name, why: "a secret door or hatch: hidden and unlocked, no property" });
      continue;
    }
    if (!d.lockable) {
      skipped.push({ name: d.name, why: "not lockable (an inner door of a shared or public room)" });
      continue;
    }
    if (!props.has(d.key)) {
      let access = GROUP_ACCESS[d.owner] ?? "";
      if (d.owner === "business") access = letters[d.key] ??= BUSINESS_LETTERS[li++ % BUSINESS_LETTERS.length];
      const place = d.checkpoint ? `Checkpoint ${title(d.checkpoint)}` : (zoneName[d.building] ?? title(d.building ?? d.key));
      const unitNo = d.unit && /\.u(\d+)$/.exec(d.unit)?.[1];
      const price = d.owner === "residents" ? (prices[d.unitClass] ?? 1) * priceUnit : d.owner === "business" ? businessPrice : 0;
      props.set(d.key, {
        internalname: d.key,
        externalname: (unitNo ? `${place} ${unitNo}` : place).slice(0, 66),
        ownername: "",
        ownerauth: "",
        price,
        locked: d.owner === "city" ? 0 : 1,
        access,
        profit: 0,
        group: d.owner,
      });
    }
  }
  const doors = wiring.doors.filter((d) => props.has(d.key) && d.lockable && d.kind !== "secret" && d.kind !== "hatch").map((d) => ({ targetname: `t|${d.name}`, internalname: d.key })); // prettier-ignore
  const L = [];
  L.push(`# Apollo RP SQL Prebuilt configuration for "${map}"`);
  L.push(`# Written by SMAK's wiring-apollo from 07-wiring.json (tile ${wiring.tile?.id ?? wiring.tile ?? "?"}); apply using the in-game tool or any SQL editor`);
  L.push("");
  L.push(`CREATE TABLE IF NOT EXISTS ${DOORS_TABLE} (targetname VARCHAR(36),internalname VARCHAR(66),UNIQUE KEY (targetname));`);
  L.push("");
  for (const d of doors) L.push(`INSERT INTO \`${DOORS_TABLE}\` VALUES (${q(d.targetname)}, ${q(d.internalname)});`);
  L.push("");
  L.push(`CREATE TABLE IF NOT EXISTS ${PROPERTY_TABLE} (internalname VARCHAR(66),externalname VARCHAR(66),ownername VARCHAR(40),ownerauth VARCHAR(36),price INT(11),locked INT(11),access VARCHAR(27),profit INT(11),UNIQUE KEY (internalname));`); // prettier-ignore
  L.push("");
  for (const p of props.values()) L.push(`INSERT INTO \`${PROPERTY_TABLE}\` VALUES (${q(p.internalname)}, ${q(p.externalname)}, ${q(p.ownername)}, ${q(p.ownerauth)}, ${p.price}, ${p.locked}, ${q(p.access)}, ${p.profit});`); // prettier-ignore
  const sql = `${L.join("\n")}\n`;
  // jails: every cell, numbered in contract order
  const J = [];
  wiring.cells.forEach((c, i) => {
    const [x, y, z] = u(c.at);
    J.push(`[${title(c.place)} Cell ${i + 1}]`, `origin "${x} ${y} ${z + PLAYER_Z}"`, `command "${i + 1}"`, "");
  });
  // zones: buildings, districts, ways, plazas, the MSR's areas
  const Z = [];
  for (const z of wiring.zones) {
    const [a, b] = [u([z.box[0], z.box[1], z.z[0]]), u([z.box[2], z.box[3], z.z[1]])];
    Z.push(`"${(z.name ?? title(z.ref)).replace(/"/g, "'")} (${z.id})"`, "{", `\t"boundaries1" "${a.join(" ")}",`, `\t"boundaries2" "${b.join(" ")}"`, "}"); // prettier-ignore
  }
  const notes = [
    `${props.size} properties, ${doors.length} door rows, ${wiring.cells.length} jail cells, ${wiring.zones.length} zones; ${skipped.length} doors left out (secret, hatch or not lockable)`, // prettier-ignore
    `table ${PROPERTY_TABLE} is a guess between the shipped seeds' name and ARP_Core's default arp_property; prices and access letters are guesses; no arp_jobs rows`, // prettier-ignore
  ];
  return { files: { [`${map}.sql`]: sql, "jailmod.ini": `${J.join("\n")}`, "zones.ini": `${Z.join("\n")}\n` }, properties: [...props.values()], doors, skipped, notes }; // prettier-ignore
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = { _: [] };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
    else args._.push(a);
  }
  if (!args._[0]) {
    console.error("usage: wiring-apollo <07-wiring.json> --map <mapname> [--out <dir>]");
    process.exit(2);
  }
  const wiring = JSON.parse(readFileSync(args._[0], "utf8"));
  const res = apolloSeed(wiring, { map: args.map ?? "map" });
  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    for (const [f, text] of Object.entries(res.files)) writeFileSync(join(args.out, f), text);
  } else process.stdout.write(res.files[`${args.map ?? "map"}.sql`]);
  for (const n of res.notes) console.error(`note  ${n}`);
}
