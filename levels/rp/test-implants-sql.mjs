// Runs the SQL statements of plugin/smak_implants.sma (the Q_* macros) against a real SQLite, in memory, the way the
// plugin uses them: its own table next to smak_core's `characters` (which it must not change), a load of nothing, a
// first save, a second save that replaces (and frees a slot with an empty implant), a quote with an apostrophe, a
// second run of the schema. Also holds the slot names of Q_UPSERT against SLOT_NAME.
// Uses node:sqlite (Node 22+); on older Node it falls back to Python's sqlite3; else it says SKIP and exits 0.
// Run: node levels/rp/test-implants-sql.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = rd("./plugin/smak_implants.sma");
const core = rd("./plugin/smak_core.sma");
const Q = {};
for (const m of src.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) Q[m[1]] = m[2];
for (const n of ["Q_CREATE_IMPLANTS", "Q_SELECT", "Q_UPSERT"]) if (!Q[n]) { console.log(`FAIL: ${n} not found in smak_implants.sma`); process.exit(1); }
const C = {};
for (const m of core.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) C[m[1]] = m[2];

const names = [...src.matchAll(/new const SLOT_NAME\[NSLOT\]\[\] = \{([^}]*)\}/g)][0][1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
const upsertNames = [...Q.Q_UPSERT.matchAll(/'(\w+)','%s'/g)].map((m) => m[1]);
const NSLOT = Number(src.match(/^#define NSLOT\s+(\d+)/m)[1]);

const fill = (q, ...a) => { let i = 0; return q.replace(/%[sd]/g, () => a[i++]); };
const ID = "auth:STEAM_0:1:O''Brien";            // as sql_quote() makes it from an ident with an apostrophe
const up = (a, b, c, d) => fill(Q.Q_UPSERT, ID, a, ID, b, ID, c, ID, d);
const get = (r) => Object.fromEntries(r.map((x) => [x[0], x[1]]));
const steps = [
  ["characters (smak_core's table, already there)", C.Q_CREATE_CHARACTERS],
  ["characters row", fill(C.Q_INSERT, "auth:A", "A", 100, 1, 1)],
  ["implants table", Q.Q_CREATE_IMPLANTS],
  ["implants table twice", Q.Q_CREATE_IMPLANTS],
  ["select (none)", fill(Q.Q_SELECT, ID), (r) => r.length === 0],
  ["first save", up("servos_piernas", "", "nanorreparador", "")],
  ["select", fill(Q.Q_SELECT, ID), (r) => r.length === 4 && get(r).legs === "servos_piernas" && get(r).skin === "" && get(r).blood === "nanorreparador"],
  ["second save replaces and frees a slot", up("servos_militares", "placa_dermica", "", "chip_reflejo")],
  ["select again", fill(Q.Q_SELECT, ID), (r) => r.length === 4 && get(r).legs === "servos_militares" && get(r).skin === "placa_dermica" && get(r).blood === "" && get(r).head === "chip_reflejo"],
  ["other ident untouched", fill(Q.Q_SELECT, "auth:other"), (r) => r.length === 0],
  ["characters untouched", "SELECT ident, money FROM characters", (r) => r.length === 1 && r[0][1] === 100],
  ["only the implants table was added", "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", (r) => r.map((x) => x[0]).join() === "characters,implants"],
].filter((s) => s[1]);

function runNode() {
  return import("node:sqlite").then(({ DatabaseSync }) => {
    const db = new DatabaseSync(":memory:");
    return steps.map(([n, q, chk]) => {
      let rows = [];
      try { const st = db.prepare(q); rows = /^\s*select/i.test(q) ? st.all().map((o) => Object.values(o)) : (st.run(), []); }
      catch (e) { return [n, false, String(e.message)]; }
      return [n, chk ? !!chk(rows) : true, JSON.stringify(rows)];
    });
  });
}
function runPython() {
  const py = `import sqlite3,sys,json\nsteps=json.load(sys.stdin)\ndb=sqlite3.connect(':memory:')\nout=[]\nfor n,q in steps:\n  try:\n    cur=db.execute(q); rows=cur.fetchall() if q.lstrip().lower().startswith('select') else []\n    out.append([n,None,rows])\n  except Exception as e:\n    out.append([n,False,str(e)])\nprint(json.dumps(out))`;
  for (const exe of ["python3", "python"]) {
    const r = spawnSync(exe, ["-I", "-c", py], { input: JSON.stringify(steps.map((s) => [s[0], s[1]])), encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim())
      return JSON.parse(r.stdout).map(([n, ok, rows], i) => ok === false ? [n, false, rows] : [n, steps[i][2] ? !!steps[i][2](rows) : true, JSON.stringify(rows)]);
  }
  return null;
}

let bad = 0, total = 0;
const t = (n, ok, d = "") => { total++; if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${n} ${ok ? "" : d}`); };

t("names: SLOT_NAME matches Q_UPSERT", names.join() === upsertNames.join() && names.length === NSLOT, `${names} vs ${upsertNames}`);

let res, engine = "node:sqlite";
try { res = await runNode(); } catch { engine = "python sqlite3"; res = runPython(); }
if (!res) { console.log("SKIP: no node:sqlite (Node 22+) and no python with sqlite3; the SQL was not run"); process.exit(bad ? 1 : 0); }
for (const [n, ok, d] of res) t(n, ok, d);
console.log(bad ? `FAIL: ${bad} of ${total} steps failed (${engine})` : `PASS: ${total} steps of smak_implants.sma (slot names and SQL) ran against SQLite (${engine})`);
process.exit(bad ? 1 : 0);
