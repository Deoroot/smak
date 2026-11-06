// Runs the SQL statements of plugin/smak_skills.sma (the Q_* macros) against a real SQLite, in memory, the way the
// plugin uses them: its own table next to smak_core's `characters` (which it must not change), a load of nothing, a
// first save, a second save that replaces, a quote with an apostrophe, a second run of the schema. Also checks the
// level curve (XP_UNIT * L * L, MAX_LEVEL) that the plugin keeps in #defines.
// Uses node:sqlite (Node 22+); on older Node it falls back to Python's sqlite3; else it says SKIP and exits 0.
// Run: node levels/rp/test-skills-sql.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rd = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = rd("./plugin/smak_skills.sma");
const core = rd("./plugin/smak_core.sma");
const Q = {};
for (const m of src.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) Q[m[1]] = m[2];
for (const n of ["Q_CREATE_SKILLS", "Q_SELECT", "Q_UPSERT"]) if (!Q[n]) { console.log(`FAIL: ${n} not found in smak_skills.sma`); process.exit(1); }
const C = {};
for (const m of core.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) C[m[1]] = m[2];

const D = {};
for (const m of src.matchAll(/^#define (XP_UNIT|MAX_LEVEL|XP_MAX|NSK)\s+(\d+)/gm)) D[m[1]] = +m[2];
const names = [...src.matchAll(/new const SK_NAME\[NSK\]\[\] = \{([^}]*)\}/g)][0][1].match(/"(\w+)"/g).map(s => s.slice(1, -1));
const upsertNames = [...Q.Q_UPSERT.matchAll(/'(\w+)',%d/g)].map(m => m[1]);

const fill = (q, ...a) => { let i = 0; return q.replace(/%[sd]/g, () => a[i++]); };
const ID = "auth:STEAM_0:1:O''Brien";            // as sql_quote() makes it from an ident with an apostrophe
const up = (a, b, c, d) => fill(Q.Q_UPSERT, ID, a, ID, b, ID, c, ID, d);
const get = r => Object.fromEntries(r.map(x => [x[0], x[1]]));
const steps = [
  ["characters (smak_core's table, already there)", C.Q_CREATE_CHARACTERS],
  ["characters row", fill(C.Q_INSERT, "auth:A", "A", 100, 1, 1)],
  ["skills table", Q.Q_CREATE_SKILLS],
  ["skills table twice", Q.Q_CREATE_SKILLS],
  ["select (none)", fill(Q.Q_SELECT, ID), r => r.length === 0],
  ["first save", up(10, 20, 30, 40)],
  ["select", fill(Q.Q_SELECT, ID), r => r.length === 4 && get(r).punteria === 10 && get(r).resistencia === 40],
  ["second save replaces", up(50, 0, 30, 41)],
  ["select again", fill(Q.Q_SELECT, ID), r => r.length === 4 && get(r).punteria === 50 && get(r).cuerpo === 0 && get(r).resistencia === 41],
  ["other ident untouched", fill(Q.Q_SELECT, "auth:other"), r => r.length === 0],
  ["characters untouched", "SELECT ident, money FROM characters", r => r.length === 1 && r[0][1] === 100],
  ["only the skills table was added", "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", r => r.map(x => x[0]).join() === "characters,skills"],
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

// the curve and the tables of names, mirrored from the plugin
const lvl = xp => { let l = 0; while (l < D.MAX_LEVEL && xp >= D.XP_UNIT * (l + 1) ** 2) l++; return l; };
t("names: SK_NAME matches Q_UPSERT", names.join() === upsertNames.join() && names.length === D.NSK, `${names} vs ${upsertNames}`);
t("curve: level 0 below 40 xp", lvl(0) === 0 && lvl(39) === 0 && lvl(40) === 1);
t("curve: level 5 at 1000, 10 at 4000, 20 at 16000", lvl(999) === 4 && lvl(1000) === 5 && lvl(4000) === 10 && lvl(16000) === 20);
t("curve: capped at MAX_LEVEL", lvl(D.XP_MAX) === D.MAX_LEVEL && D.XP_UNIT * D.MAX_LEVEL ** 2 <= D.XP_MAX);
let mono = true; for (let x = 1; x < 20000; x++) if (lvl(x) < lvl(x - 1)) mono = false;
t("curve: never goes down", mono);

let res, engine = "node:sqlite";
try { res = await runNode(); } catch { engine = "python sqlite3"; res = runPython(); }
if (!res) { console.log("SKIP: no node:sqlite (Node 22+) and no python with sqlite3; the SQL was not run"); process.exit(bad ? 1 : 0); }
for (const [n, ok, d] of res) t(n, ok, d);
console.log(bad ? `FAIL: ${bad} of ${total} steps failed (${engine})` : `PASS: ${total} steps of smak_skills.sma (curve, names and SQL) ran against SQLite (${engine})`);
process.exit(bad ? 1 : 0);
