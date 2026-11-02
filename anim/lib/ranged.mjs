// What the hands do with a ranged weapon: the melee judge's grip measures are a handle's line, which a gun, a bow
// or a staff has not. These are taken in the space of the hand that holds the weapon (its weapon attach bone,
// else the hand), so they carry to any rig, and lengths are in forearms, as the judge's:
//
//   offhand.gap        the off hand's distance from its place on the weapon (where the clip's first frame puts it:
//                      a shot starts from the aim, not the idle), median
//   offhand.gapMost    the same, its most held 0.1 s (a hand slipping off a foregrip)
//   offhand.away       the share of the clip the off hand is off the weapon (farther than OFF forearms): a reload
//   offhand.leave      when it first goes off (seconds), null if it stays
//   offhand.back       when it is last back on (seconds), null if it stays off or never left
//   kick.back          the weapon's most travel towards the eye in KICK seconds after the shot (forearms)
//   kick.turn          the weapon's most turn in the same span (degrees): the muzzle's rise and twist
//   kick.settle        from the shot until the weapon is back within a quarter of its most travel (seconds)
//   parts.moving       how many of the weapon's own bones (a rig's parts under the hands: a crossbow's string,
//                      a hammer) move more than PART forearms against the bone they hang from
//
// Only measures, nothing of a game's. Vermintide 2's shots and reloads (vt2Shots) are what the bands are of.
import { readFileSync, existsSync } from "node:fs";
import { VT2_CACHE, VT2_ARMS, vt2Model, readClip } from "./vt2.mjs";
import { band } from "./judge.mjs";

const DEG = 180 / Math.PI;
const origin = (m) => [m[0][3], m[1][3], m[2][3]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const tr = (a) => [0, 1, 2].map((r) => [a[0][r], a[1][r], a[2][r]]);
const mm = (a, b) =>
  [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
const angleOf = (r) => Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2))) * DEG;
/** A point in a bone's space. */
const into = (m, q) => {
  const d = sub(q, origin(m));
  return [0, 1, 2].map((k) => m[0][k] * d[0] + m[1][k] * d[1] + m[2][k] * d[2]);
};

/** Farther than this (forearms) from its place, the off hand is off the weapon. */
export const OFF = 0.5;
/** A slip seen: held this long (seconds). */
const HOLD = 0.1;
/** The kick is looked for this long after the shot (seconds). */
export const KICK = 0.3;
/** A weapon part that moves this far (forearms) moves. */
const PART = 0.05;

/**
 * The measures of one ranged clip: { values, info }. `model` as the judge takes (bones, pose, sequences);
 * opts: seq, idle (sequence names or numbers), fps, arms ({ R, L: { shoulder, elbow, hand } } by bone name),
 * hold ("R" or "L": the hand the weapon is on), attach (that hand's weapon bone's name, else the hand), fire
 * (seconds into the clip as played, or null), parts (a test on bone names: the weapon's own bones), offhand
 * (false for a weapon the off hand has no place on: a thrown one, whose hand lets it fly).
 */
export function measureRanged(
  model,
  { seq, idle, fps, arms, hold = "R", attach = null, fire = null, parts = null, offhand = true },
) {
  const B = (name) => model.bones.findIndex((b) => b.name === name);
  const s = model.sequenceAt(seq);
  const i0 = model.sequenceAt(idle);
  const n = model.sequences[s].frames;
  const offSide = hold === "R" ? "L" : "R";
  const holdBone = attach !== null && B(attach) >= 0 ? B(attach) : B(arms[hold].hand);
  const offHand = B(arms[offSide].hand);
  const rest = model.pose(i0, 0);
  const F =
    ["R", "L"]
      .map((k) => len(sub(origin(rest[B(arms[k].hand)]), origin(rest[B(arms[k].elbow)]))))
      .reduce((a, b) => a + b, 0) / 2 || 1;
  const poses = Array.from({ length: n }, (_, f) => model.pose(s, f));
  const v = {};
  const put = (k, x) =>
    (v[k] = x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(4)));

  // ── the off hand on the weapon ──
  if (offhand) {
    const place = into(poses[0][holdBone], origin(poses[0][offHand]));
    const gaps = poses.map((p) => len(sub(into(p[holdBone], origin(p[offHand])), place)) / F);
    const sorted = [...gaps].sort((a, b) => a - b);
    put("offhand.gap", sorted[Math.floor(sorted.length / 2)]);
    const hold1 = Math.max(1, Math.ceil(HOLD * fps));
    let most = 0;
    for (let f = 0; f + hold1 <= n; f++) most = Math.max(most, Math.min(...gaps.slice(f, f + hold1)));
    put("offhand.gapMost", most);
    const off = gaps.map((g) => g > OFF);
    put("offhand.away", off.filter(Boolean).length / n);
    const first = off.indexOf(true);
    const lastOff = off.lastIndexOf(true);
    put("offhand.leave", first < 0 ? null : first / fps);
    put("offhand.back", first < 0 || lastOff === n - 1 ? null : (lastOff + 1) / fps);
  }

  // ── the kick ──
  if (fire !== null && fire >= 0 && fire * fps < n - 1) {
    const at = Math.round(fire * fps);
    const until = Math.min(n - 1, at + Math.round(KICK * fps));
    const W0 = poses[at][holdBone];
    // towards the eye: the judge's view looks along +x
    const back = (f) => -(origin(poses[f][holdBone])[0] - origin(W0)[0]) / F;
    let top = 0;
    let topAt = at;
    let turn = 0;
    for (let f = at; f <= until; f++) {
      if (back(f) > top) [top, topAt] = [back(f), f];
      turn = Math.max(turn, angleOf(mm(tr(W0), poses[f][holdBone])));
    }
    put("kick.back", top);
    put("kick.turn", turn);
    let settle = null;
    if (top > 0)
      for (let f = topAt; f < n; f++)
        if (back(f) <= top / 4) {
          settle = (f - at) / fps;
          break;
        }
    put("kick.settle", settle);
  }

  // ── the weapon's own parts ──
  if (parts) {
    let moving = 0;
    model.bones.forEach((b, k) => {
      if (!parts(b.name)) return;
      const up = b.parent;
      if (up < 0) return;
      const p0 = into(poses[0][up], origin(poses[0][k]));
      if (poses.some((p) => len(sub(into(p[up], origin(p[k])), p0)) / F > PART)) moving++;
    });
    put("parts.moving", moving);
  }
  return { values: v, info: { frames: n, fps, unit: F, hold, fire } };
}

/** A ranged template's kind of weapon, by its name. */
export function rangedClass(template) {
  const t = template.toLowerCase();
  if (/staff|beam|fireball|geiser|spark|flame|deus/.test(t)) return "staves";
  if (/crossbow/.test(t)) return "crossbows";
  if (/bow/.test(t)) return "bows";
  if (/pistol/.test(t)) return "pistols";
  if (/throw|javelin|axe|bomb/.test(t)) return "thrown";
  return "guns";
}

/**
 * Vermintide 2's ranged clips from the local cache, one per clip: { template, kind ("shot" or "reload"), class,
 * event, model, opts } for measureRanged. A shot is an event with "shoot", "fire" or "throw" in it; a reload has
 * "reload" in it or is the event the action plays after (`anim_event_secondary`). The weapon is in the right hand
 * but for bows and Kerillian's repeating crossbow (the left).
 */
export function* vt2Shots({ cache = VT2_CACHE, fps = 60, log = () => {} } = {}) {
  const need = ["attacks.json", "templates.json", "fp_skeleton.json"];
  if (!need.every((f) => existsSync(cache + f))) {
    log(`vt2: no cache at ${cache}`);
    return;
  }
  const [attacks, templates, skeleton] = need.map((f) => JSON.parse(readFileSync(cache + f, "utf8")));
  const weapons = existsSync(cache + "weapons.json")
    ? JSON.parse(readFileSync(cache + "weapons.json", "utf8"))
    : {};
  const seen = new Set();
  for (const r of attacks) {
    if (r.family !== "ranged" || r.template.endsWith("_vs")) continue;
    const ev = r.anim_event;
    const kind =
      /reload/.test(ev) || r.event_field === "anim_event_secondary"
        ? "reload"
        : /shoot|fire|throw/.test(ev)
          ? "shot"
          : null;
    const tpl = templates[r.template];
    if (!kind || !tpl?.idle_clips.length) continue;
    // every variant's clip (hip and aimed, loaded and empty); blend states left out
    for (const clip of r.states.filter((st) => st.clips.length === 1).map((st) => st.clips[0])) {
      if (seen.has(clip)) continue;
      seen.add(clip);
      yield* shotOf(r, clip, tpl);
    }
  }

  function* shotOf(r, clip, tpl) {
    const ev = r.anim_event;
    const kind = /reload/.test(ev) || r.event_field === "anim_event_secondary" ? "reload" : "shot";
    const short = r.template.split(".").pop();
    let model;
    try {
      model = vt2Model({
        skeleton,
        fps,
        name: short,
        clips: [
          { name: ev, buf: readFileSync(cache + "anim/" + clip) },
          { name: "idle", buf: readFileSync(cache + "anim/" + tpl.idle_clips[0]) },
        ],
      });
      if (readClip(readFileSync(cache + "anim/" + clip)).tracks !== skeleton.names.length)
        throw new Error("another rig");
    } catch (e) {
      log(`vt2: ${short} ${ev} left out: ${e.message}`);
      return;
    }
    const w = weapons[short];
    const hold =
      w?.left && !w.right
        ? "L"
        : /bow/.test(short) && !/crossbow/.test(short)
          ? "L"
          : /crossbow_elf/.test(short)
            ? "L"
            : "R";
    const scale = r.anim_time_scale || 1;
    yield {
      template: short,
      kind,
      class: rangedClass(short),
      event: ev,
      model,
      opts: {
        seq: ev,
        idle: "idle",
        fps: fps * scale,
        arms: VT2_ARMS,
        hold,
        attach: `j_${hold === "R" ? "right" : "left"}weaponattach`,
        // a thrown weapon leaves the hand: no place for the off hand, no kick
        offhand: rangedClass(short) !== "thrown",
        fire:
          kind === "shot" && rangedClass(short) !== "thrown" && typeof r.fire_time === "number"
            ? r.fire_time / scale
            : null,
        // the weapon's own bones: the attach bone's components, both hands'
        parts: (name) => /^j_(left|right)weaponcomponent\d+$/.test(name),
      },
    };
  }
}

/** Bands of a list of measured clips ({ values, kind, class }): overall and by kind, and by kind and class. */
export function rangedBands(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.values)))];
  const of = (list) =>
    Object.fromEntries(keys.map((k) => [k, band(list.map((r) => r.values[k] ?? null))]).filter(([, b]) => b));
  const out = { n: rows.length, kinds: {} };
  for (const kind of [...new Set(rows.map((r) => r.kind))]) {
    const list = rows.filter((r) => r.kind === kind);
    out.kinds[kind] = { n: list.length, all: of(list), classes: {} };
    for (const c of [...new Set(list.map((r) => r.class))]) {
      const cl = list.filter((r) => r.class === c);
      out.kinds[kind].classes[c] = { n: cl.length, ...of(cl) };
    }
  }
  return out;
}
