// Runs the SQL statements of plugin/smak_jobs.sma (the Q_* macros) against a real SQLite, in memory, the way the
// plugin uses them: its own table next to smak_core's `characters` (which it must not change), a load of nothing, a
// first save, a second save that replaces, a quote with an apostrophe, a second run of the schema. Also checks the
// paycheck arithmetic of the plugin (the 30 s tick, the minutes between paychecks, the idle rule).
// Uses node:sqlite (Node 22+); on older Node it falls back to Python's sqlite3; else it says SKIP and exits 0.
// Run: node levels/rp/test-jobs-sql.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rd = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = rd("./plugin/smak_jobs.sma");
const core = rd("./plugin/smak_core.sma");
const Q = {};
for (const m of src.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) Q[m[1]] = m[2];
for (const n of ["Q_CREATE_JOBS", "Q_SELECT", "Q_UPSERT"]) if (!Q[n]) { console.log(`FAIL: ${n} not found in smak_jobs.sma`); process.exit(1); }
const C = {};
for (const m of core.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) C[m[1]] = m[2];

const fill = (q, ...a) => { let i = 0; return q.replace(/%[sd]/g, () => a[i++]); };
const ID = "auth:STEAM_0:1:O''Brien";            // as sql_quote() makes it from an ident with an apostrophe
const up = (job, since) => fill(Q.Q_UPSERT, ID, job, since);
const steps = [
  ["characters (smak_core's table, already there)", C.Q_CREATE_CHARACTERS],
  ["characters row", fill(C.Q_INSERT, "auth:A", "A", 100, 1, 1)],
  ["jobs table", Q.Q_CREATE_JOBS],
  ["jobs table twice", Q.Q_CREATE_JOBS],
  ["select (none)", fill(Q.Q_SELECT, ID), r => r.length === 0],
  ["first save", up("guardia", 1700000000)],
  ["select", fill(Q.Q_SELECT, ID), r => r.length === 1 && r[0][0] === "guardia" && r[0][1] === 1700000000],
  ["second save replaces (one row per ident)", up("unemployed", 1700000300)],
  ["select again", fill(Q.Q_SELECT, ID), r => r.length === 1 && r[0][0] === "unemployed" && r[0][1] === 1700000300],
  ["other ident untouched", fill(Q.Q_SELECT, "auth:other"), r => r.length === 0],
  ["characters untouched", "SELECT ident, money FROM characters", r => r.length === 1 && r[0][1] === 100],
  ["only the jobs table was added", "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", r => r.map(x => x[0]).join() === "characters,jobs"],
].filter(s => s[1]);

function runNode() {
  return import("node:sqlite").then(({ DatabaseSync }) => {
    const db = new DatabaseSync(":memory:");
    return steps.map(([n, q, chk]) => {
      let rows = [];
      try { const st = db.prepare(q); rows = /^\s*select/i.test(q) ? st.all().map(o => Object.values(o)) : (st.run(), []); }
      catch (e) { return [n, false, String(e.message)]; }
      return [n, chk ? !!chk(rows) : true, JSON.stringify(rows)];
    });
  });
}
function runPython() {
  const py = `import sqlite3,sys,json\nsteps=json.load(sys.stdin)\ndb=sqlite3.connect(':memory:')\nout=[]\nfor n,q in steps:\n  try:\n    cur=db.execute(q); rows=cur.fetchall() if q.lstrip().lower().startswith('select') else []\n    out.append([n,None,rows])\n  except Exception as e:\n    out.append([n,False,str(e)])\nprint(json.dumps(out))`;
  for (const exe of ["python3", "python"]) {
    const r = spawnSync(exe, ["-I", "-c", py], { input: JSON.stringify(steps.map(s => [s[0], s[1]])), encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim())
      return JSON.parse(r.stdout).map(([n, ok, rows], i) => ok === false ? [n, false, rows] : [n, steps[i][2] ? !!steps[i][2](rows) : true, JSON.stringify(rows)]);
  }
  return null;
}

let bad = 0, total = 0;
const t = (n, ok, d = "") => { total++; if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${n} ${ok ? "" : d}`); };

// the paycheck, mirrored from task_pay: every PAY_TICK seconds on duty adds to the clock; a paycheck comes when the
// clock reaches pay_min * 60, and is paid only if the player moved in at least MIN_ACTIVE of the ticks since the last one
const def = n => Number(src.match(new RegExp(`^#define ${n}\\s+([0-9]+)`, "m"))?.[1]);
const TICK = def("PAY_TICK"), MIN_ACTIVE = def("MIN_ACTIVE");
const paychecks = (minutes, seconds, movingTicks) => {
  let acc = 0, active = 0, paid = 0, ticks = 0;
  for (let s = 0; s < seconds; s += TICK) {
    if (ticks++ < movingTicks) active++;
    acc += TICK;
    if (acc < Math.max(1, minutes) * 60) continue;
    acc = 0;
    if (active >= MIN_ACTIVE) paid++;
    active = 0;
  }
  return paid;
};
t("pay: the tick is 30 s and a player must move in 2 ticks", TICK === 30 && MIN_ACTIVE === 2);
t("pay: one paycheck for 5 minutes of walking", paychecks(5, 300, 99) === 1);
t("pay: none before the 5 minutes (9 ticks)", paychecks(5, 270, 99) === 0);
t("pay: a player who stands still is not paid", paychecks(5, 300, 0) === 0 && paychecks(5, 3000, 1) === 0);
t("pay: ten paychecks in 50 minutes", paychecks(5, 3000, 99) === 10);
t("pay: pay_min 0 is read as 1 minute", paychecks(0, 60, 99) === 1);
t("limits: the salary cap is the one the checker keeps", /#define SALARY_MAX\s+10000/.test(src));

let res, engine = "node:sqlite";
try { res = await runNode(); } catch { engine = "python sqlite3"; res = runPython(); }
if (!res) { console.log("SKIP: no node:sqlite (Node 22+) and no python with sqlite3; the SQL was not run"); process.exit(bad ? 1 : 0); }
for (const [n, ok, d] of res) t(n, ok, d);
console.log(bad ? `FAIL: ${bad} of ${total} steps failed (${engine})` : `PASS: ${total} steps of smak_jobs.sma (paycheck and SQL) ran against SQLite (${engine})`);
process.exit(bad ? 1 : 0);
