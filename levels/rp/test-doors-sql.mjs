// Runs the SQL statements of plugin/smak_doors.sma (the Q_* macros) against a real SQLite, in memory, the way the
// plugin uses them: its two tables beside smak_core's own (which they must leave alone), an empty load, a home bought
// and one rented, a replace (a renewal), two maps sharing the file (the key is "<map>:<property>"), an apostrophe in
// a key, a delete, copies of keys that are given twice and cleared for one property only. Uses node:sqlite (Node 22+);
// on older Node it falls back to Python's sqlite3 if python is on the PATH; else it says SKIP and exits 0.
//   Run: node levels/rp/test-doors-sql.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
const grab = (src) => {
  const Q = {};
  for (const m of src.matchAll(/^#define (Q_\w+)\s+"(.*)"\s*$/gm)) Q[m[1]] = m[2];
  return Q;
};
const Q = grab(own("./plugin/smak_doors.sma"));
const C = grab(own("./plugin/smak_core.sma"));
for (const n of ["Q_CREATE_HOMES", "Q_CREATE_KEYS", "Q_SELECT_HOMES", "Q_SELECT_KEYS", "Q_UPSERT_HOME", "Q_DELETE_HOME", "Q_INSERT_KEY", "Q_DELETE_KEYS"]) {
  if (!Q[n]) { console.log(`FAIL: ${n} not found in smak_doors.sma`); process.exit(1); }
}
for (const n of ["Q_CREATE_VERSION", "Q_CREATE_CHARACTERS"]) if (!C[n]) { console.log(`FAIL: ${n} not found in smak_core.sma`); process.exit(1); }
const fill = (q, ...a) => { let i = 0; return q.replace(/%[sd]/g, () => a[i++]); };
const A = "auth:STEAM_0:1:1";
const B = "auth:STEAM_0:1:2";
const P1 = "smak_rp_byz01:m1_flat1";
const P2 = "smak_rp_byz01:m2_flat3";
const OTHER_MAP = "smak_rp_other:m1_flat1";    // the same property id on another map must not clash
const APOS = "smak_rp_byz01:o''brien";         // as sql_quote() makes it from o'brien
const NOW = 1_800_000_000;

let total = 0, bad = 0;
const t = (n, ok, d = "") => { total++; if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${n} ${ok ? "" : d}`); };

// the key the plugin builds and the rows it keeps for its own map (prop_of_key): "<map>:" then the id
const mine = (key, map = "smak_rp_byz01") => key.startsWith(map + ":") ? key.slice(map.length + 1) : null;
t("key: a row of this map gives its property id", mine(P1) === "m1_flat1");
t("key: a row of another map, or with no colon, is not ours", mine(OTHER_MAP) === null && mine("m1_flat1") === null && mine("smak_rp_byz010:m1") === null);
t("key: rent runs out when until is not 0 and not after now", [[0, false], [NOW + 1, false], [NOW, true], [NOW - 5, true]].every(([u, exp]) => ((u > 0 && u <= NOW) === exp)));

const steps = [
  ["smak_core's tables first", C.Q_CREATE_VERSION],
  ["characters", C.Q_CREATE_CHARACTERS],
  ["homes", Q.Q_CREATE_HOMES],
  ["homes twice", Q.Q_CREATE_HOMES],
  ["home_keys", Q.Q_CREATE_KEYS],
  ["home_keys twice", Q.Q_CREATE_KEYS],
  ["select homes (none)", Q.Q_SELECT_HOMES, (r) => r.length === 0],
  ["select keys (none)", Q.Q_SELECT_KEYS, (r) => r.length === 0],
  ["a home bought for good (until 0)", fill(Q.Q_UPSERT_HOME, P1, A, 0)],
  ["a home rented", fill(Q.Q_UPSERT_HOME, P2, B, NOW + 7 * 86400)],
  ["the same property id on another map", fill(Q.Q_UPSERT_HOME, OTHER_MAP, B, 0)],
  ["select homes sees all three", Q.Q_SELECT_HOMES + " ORDER BY property", (r) => r.length === 3 && r[0][0] === P1 && r[0][1] === A && r[0][2] === 0],
  ["a renewal replaces the row, never doubles it", fill(Q.Q_UPSERT_HOME, P2, B, NOW + 14 * 86400)],
  ["still one row for it, with the new until", "SELECT COUNT(*), MAX(until) FROM homes WHERE property = '" + P2 + "'", (r) => r[0][0] === 1 && r[0][1] === NOW + 14 * 86400],
  ["a sale to another owner replaces the owner", fill(Q.Q_UPSERT_HOME, P1, B, 0)],
  ["the owner changed", "SELECT owner_ident FROM homes WHERE property = '" + P1 + "'", (r) => r[0][0] === B],
  ["an apostrophe in the key", fill(Q.Q_UPSERT_HOME, APOS, A, 0)],
  ["delete one home", fill(Q.Q_DELETE_HOME, P2)],
  ["only that one is gone", Q.Q_SELECT_HOMES, (r) => r.length === 3 && !r.some((x) => x[0] === P2)],
  ["the other map's row is untouched", "SELECT COUNT(*) FROM homes WHERE property = '" + OTHER_MAP + "'", (r) => r[0][0] === 1],
  ["copies of keys: two holders of one home", fill(Q.Q_INSERT_KEY, P1, A)],
  ["the second holder", fill(Q.Q_INSERT_KEY, P1, B)],
  ["a copy given twice is one row", fill(Q.Q_INSERT_KEY, P1, A)],
  ["a copy of another home", fill(Q.Q_INSERT_KEY, P2, A)],
  ["select keys", Q.Q_SELECT_KEYS + " ORDER BY property, ident", (r) => r.length === 3 && r[0][0] === P1 && r[0][1] === A && r[1][1] === B],
  ["changing the lock clears one property's copies only", fill(Q.Q_DELETE_KEYS, P1)],
  ["the other property's copy stays", Q.Q_SELECT_KEYS, (r) => r.length === 1 && r[0][0] === P2],
  ["smak_core's tables untouched", "SELECT COUNT(*) FROM characters", (r) => r[0][0] === 0],
];

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
if (!res) { console.log("SKIP: no node:sqlite (Node 22+) and no python with sqlite3; the SQL was not run"); process.exit(bad ? 1 : 0); }
for (const [n, ok, d] of res) t(n, ok, d);
console.log(bad ? `FAIL: ${bad} of ${total} steps failed (${engine})` : `PASS: ${total} steps of smak_doors.sma (keys and SQL) ran against SQLite (${engine})`);
process.exit(bad ? 1 : 0);
