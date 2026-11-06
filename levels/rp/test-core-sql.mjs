// Runs the SQL statements of plugin/smak_core.sma (the Q_* macros) against a real SQLite, in memory, the way the
// plugin uses them: schema, a new character, a load, a save, a quote with an apostrophe, a second run of the schema.
// Uses node:sqlite (Node 22+); on older Node it falls back to Python's sqlite3 if python is on the PATH; else it
// says SKIP and exits 0.   Run: node levels/rp/test-core-sql.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./plugin/smak_core.sma", import.meta.url)), "utf8");
const Q = {};
for (const m of src.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) Q[m[1]] = m[2];
const need = ["Q_BEGIN", "Q_COMMIT", "Q_CREATE_VERSION", "Q_VERSION_GET", "Q_VERSION_SET", "Q_CREATE_CHARACTERS", "Q_SELECT", "Q_INSERT", "Q_UPDATE"];
for (const n of need) if (!Q[n]) { console.log(`FAIL: ${n} not found in smak_core.sma`); process.exit(1); }

const fill = (q, ...a) => { let i = 0; return q.replace(/%[sd]/g, () => a[i++]); };
const NAME = "O''Brien";                       // as sql_quote() makes it from O'Brien
const steps = [
  ["schema_version", Q.Q_CREATE_VERSION],
  ["version get (empty)", Q.Q_VERSION_GET, r => r[0][0] === null],
  ["BEGIN", Q.Q_BEGIN], ["characters", Q.Q_CREATE_CHARACTERS], ["version set", fill(Q.Q_VERSION_SET, 1, 1000)], ["COMMIT", Q.Q_COMMIT],
  ["version get", Q.Q_VERSION_GET, r => r[0][0] === 1],
  ["select (none)", fill(Q.Q_SELECT, "auth:STEAM_0:1:1"), r => r.length === 0],
  ["insert", fill(Q.Q_INSERT, "auth:STEAM_0:1:1", NAME, 100, 1000, 1000)],
  ["insert again (ignored, no error)", fill(Q.Q_INSERT, "auth:STEAM_0:1:1", "other", 5, 2000, 2000)],
  ["select", fill(Q.Q_SELECT, "auth:STEAM_0:1:1"), r => r.length === 1 && r[0][1] === "O'Brien" && r[0][2] === 100 && r[0][4] === 0],
  ["update", fill(Q.Q_UPDATE, 250, 3000, 77, 1)],
  ["select after update", fill(Q.Q_SELECT, "auth:STEAM_0:1:1"), r => r[0][2] === 250 && r[0][4] === 77],
  ["schema twice", Q.Q_CREATE_CHARACTERS],
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
    if (r.status === 0 && r.stdout.trim()) {
      return JSON.parse(r.stdout).map(([n, ok, rows], i) => ok === false ? [n, false, rows] : [n, steps[i][2] ? !!steps[i][2](rows) : true, JSON.stringify(rows)]);
    }
  }
  return null;
}

let res, engine = "node:sqlite";
try { res = await runNode(); } catch { engine = "python sqlite3"; res = runPython(); }
if (!res) { console.log("SKIP: no node:sqlite (Node 22+) and no python with sqlite3; the SQL was not run"); process.exit(0); }
let bad = 0;
for (const [n, ok, d] of res) { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${n} ${ok ? "" : d}`); }
console.log(bad ? `FAIL: ${bad} of ${res.length} steps failed (${engine})` : `PASS: ${res.length} SQL steps of smak_core.sma ran against SQLite (${engine})`);
process.exit(bad ? 1 : 0);
