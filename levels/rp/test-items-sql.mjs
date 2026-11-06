// Runs the SQL statements of plugin/smak_items.sma (the Q_* macros) against a real SQLite, in memory, the way the
// plugin uses them: the table beside smak_core's own (which it must leave alone), an empty load, a multi-row save, a
// load, an item that runs out (count 0, skipped by the load), a replace, a quote with an apostrophe, a second run.
// Uses node:sqlite (Node 22+); on older Node it falls back to Python's sqlite3 if python is on the PATH; else it
// says SKIP and exits 0.   Run: node levels/rp/test-items-sql.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
const grab = (src) => {
  const Q = {};
  for (const m of src.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) Q[m[1]] = m[2];
  return Q;
};
const Q = grab(own("./plugin/smak_items.sma"));
const C = grab(own("./plugin/smak_core.sma"));
for (const n of ["Q_CREATE_INV", "Q_SELECT_INV", "Q_UPSERT_HEAD", "Q_UPSERT_ROW"]) if (!Q[n]) { console.log(`FAIL: ${n} not found in smak_items.sma`); process.exit(1); }
for (const n of ["Q_CREATE_VERSION", "Q_CREATE_CHARACTERS"]) if (!C[n]) { console.log(`FAIL: ${n} not found in smak_core.sma`); process.exit(1); }
// the head ends in "VALUES " (a #define trims nothing); the macro text has its own trailing space
const fill = (q, ...a) => { let i = 0; return q.replace(/%[sd]/g, () => a[i++]); };
const rows = (...r) => Q.Q_UPSERT_HEAD + r.map((x) => fill(Q.Q_UPSERT_ROW, ...x)).join(",");
const ID = "auth:STEAM_0:1:1";
const OTHER = "auth:STEAM_0:1:2";
const O = "O''Brien";                          // as sql_quote() makes it from O'Brien

const steps = [
  ["smak_core's tables first", C.Q_CREATE_VERSION],
  ["characters", C.Q_CREATE_CHARACTERS],
  ["items_inventory", Q.Q_CREATE_INV],
  ["items_inventory twice", Q.Q_CREATE_INV],
  ["select (none)", fill(Q.Q_SELECT_INV, ID), (r) => r.length === 0],
  ["save three rows in one statement", rows([ID, "vendaje", 3], [ID, "botiquin", 1], [ID, "chatarra", 12])],
  ["another character's row", rows([OTHER, "vendaje", 9])],
  ["select", fill(Q.Q_SELECT_INV, ID) + " ORDER BY item", (r) => r.length === 3 && r[0][0] === "botiquin" && r[2][0] === "vendaje" && r[2][1] === 3],
  ["an item runs out (count 0) and another changes", rows([ID, "botiquin", 0], [ID, "vendaje", 2])],
  ["select skips the zero and sees the change", fill(Q.Q_SELECT_INV, ID) + " ORDER BY item", (r) => r.length === 2 && r[1][0] === "vendaje" && r[1][1] === 2],
  ["the other character is untouched", fill(Q.Q_SELECT_INV, OTHER), (r) => r.length === 1 && r[0][1] === 9],
  ["an apostrophe in the key", rows([O, "chatarra", 1])],
  ["select by that key", fill(Q.Q_SELECT_INV, O), (r) => r.length === 1],
  ["one row per (ident, item)", "SELECT COUNT(*) FROM items_inventory WHERE ident = '" + ID + "'", (r) => r[0][0] === 3],
  ["smak_core's tables untouched", "SELECT COUNT(*) FROM characters", (r) => r[0][0] === 0],
].filter((s) => s[1]);

function runNode() {
  return import("node:sqlite").then(({ DatabaseSync }) => {
    const db = new DatabaseSync(":memory:");
    return steps.map(([n, q, chk]) => {
      let out = [];
      try { const st = db.prepare(q); out = /^\s*select/i.test(q) ? st.all().map((o) => Object.values(o)) : (st.run(), []); }
      catch (e) { return [n, false, String(e.message)]; }
      return [n, chk ? !!chk(out) : true, JSON.stringify(out)];
    });
  });
}

function runPython() {
  const py = `import sqlite3,sys,json\nsteps=json.load(sys.stdin)\ndb=sqlite3.connect(':memory:')\nout=[]\nfor n,q in steps:\n  try:\n    cur=db.execute(q); rows=cur.fetchall() if q.lstrip().lower().startswith('select') else []\n    out.append([n,None,rows])\n  except Exception as e:\n    out.append([n,False,str(e)])\nprint(json.dumps(out))`;
  for (const exe of ["python3", "python"]) {
    const r = spawnSync(exe, ["-I", "-c", py], { input: JSON.stringify(steps.map((s) => [s[0], s[1]])), encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) {
      return JSON.parse(r.stdout).map(([n, ok, got], i) => (ok === false ? [n, false, got] : [n, steps[i][2] ? !!steps[i][2](got) : true, JSON.stringify(got)]));
    }
  }
  return null;
}

let res, engine = "node:sqlite";
try { res = await runNode(); } catch { engine = "python sqlite3"; res = runPython(); }
if (!res) { console.log("SKIP: no node:sqlite (Node 22+) and no python with sqlite3; the SQL was not run"); process.exit(0); }
let bad = 0;
for (const [n, ok, d] of res) { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${n} ${ok ? "" : d}`); }
console.log(bad ? `FAIL: ${bad} of ${res.length} steps failed (${engine})` : `PASS: ${res.length} SQL steps of smak_items.sma ran against SQLite (${engine})`);
process.exit(bad ? 1 : 0);
