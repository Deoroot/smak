// How a charged attack is played: Vermintide 2's melee is not one clip per blow. A press of the attack button
// starts a charge clip (the weapon drawn back and held); let go before a threshold and the light blow plays,
// past it the heavy one, and held on the heavy fires by itself. The next press, from the blow's chain point, starts
// the next charge, which begins where the blow ended. So a heavy's clip starts cocked (its wind-up is the
// charge's), and a light's is crossfaded to from wherever the charge got to. These are that machinery's numbers, taken
// from a charge clip and the blows it releases, lengths in forearms as the judge's:
//
//   charge.heavyAt     from the press, the release after which the blow is the heavy (seconds)
//   charge.autoAt      from the press, when the heavy fires by itself if the button is still held (seconds)
//   charge.reach       when the charge is within a tenth of its travel from where it is at heavyAt (seconds)
//   charge.travel      the weapon tip's distance from the charge's first frame to its place at heavyAt
//   charge.creep       the tip's most distance from that place while the charge is held, heavyAt to autoAt
//   charge.deepAt      the charge's frame nearest the heavy clip's first: where the heavy is drawn from (seconds)
//   charge.deepGap     the tip's distance there: what the crossfade into the heavy hides
//   release.lightBlend the crossfade into the light blow (seconds)
//   release.heavyBlend the crossfade into the heavy blow (seconds)
//   release.lightHit   from the release, when the light's damage starts (seconds)
//   release.heavyHit   from the release, when the heavy's damage starts (seconds)
//   release.lightChain from the light's damage, when the next attack may start (its chain point; seconds)
//   release.heavyChain the same for the heavy
//   release.lightJoin  the tip's distance from the charge, TAP seconds in, to the light clip's first frame: what
//                      the crossfade into the light hides. Vermintide 2's are far (74 of 79 over half a forearm,
//                      the median 4.5): the charge draws back for the heavy, and a click's light is a clip with
//                      its own wind-up, crossfaded to in release.lightBlend
//   played.light       from the press to the light's damage for a click (TAP seconds held)
//   played.heavy       from the press to the heavy's damage, released at heavyAt
//   played.auto        the same, the button held until the heavy fires by itself
//
// Only measures, nothing of a game's. Vermintide 2's charges (vt2Charges) are what the bands are of.
import { readFileSync, existsSync } from "node:fs";
import { VT2_CACHE, VT2_ARMS, vt2Model, readClip, vt2Family, chainPoint } from "./vt2.mjs";
import { band } from "./judge.mjs";

/** A click: the button held this long (seconds). */
export const TAP = 0.1;
/** The charge has reached its place when within this share of its travel. */
const NEAR = 0.1;

const origin = (m) => [m[0][3], m[1][3], m[2][3]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The measures of one charge: { values, info }. `model` as the judge takes (bones, pose, sequences); opts: charge,
 * light, heavy, idle (sequence names; light and heavy may be null), fps, arms ({ R, L: { elbow, hand } } by bone
 * name or number), attach (the weapon's bone, by name or number), tip (the tip's place in that bone), heavyAt, autoAt (seconds from the press),
 * blends ({ light, heavy }: the crossfades' seconds), hits ({ light, heavy }: the damage's start, seconds from the
 * release), chains ({ light, heavy }: the chain points, seconds from the release), tap (seconds a click holds the
 * button).
 */
export function measureCharge(
  model,
  { charge, light = null, heavy = null, idle, fps, arms, attach, tip, heavyAt = null, autoAt = null, blends = {}, hits = {}, chains = {}, tap = TAP },
) {
  // bones by name or number
  const B = (name) => (typeof name === "number" ? name : model.bones.findIndex((b) => b.name === name));
  const bone = B(attach);
  if (bone < 0) throw new Error(`charge: no bone ${attach}`);
  const rest = model.pose(model.sequenceAt(idle), 0);
  const F =
    ["R", "L"]
      .map((k) => dist(origin(rest[B(arms[k].hand)]), origin(rest[B(arms[k].elbow)])))
      .reduce((a, b) => a + b, 0) / 2 || 1;
  const tipAt = (s, f) => {
    const M = model.pose(s, f)[bone];
    return [0, 1, 2].map((i) => M[i][0] * tip[0] + M[i][1] * tip[1] + M[i][2] * tip[2] + M[i][3]);
  };
  const cs = model.sequenceAt(charge);
  const n = model.sequences[cs].frames;
  const P = Array.from({ length: n }, (_, f) => tipAt(cs, f));
  const at = (t) => P[Math.max(0, Math.min(n - 1, Math.round(t * fps)))];
  const v = {};
  const put = (k, x) => (v[k] = x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(4)));
  put("charge.heavyAt", heavyAt);
  put("charge.autoAt", autoAt);

  // the charge drawn back: where it is when the heavy becomes the release's (else at its end)
  const held = at(heavyAt ?? (n - 1) / fps);
  const travel = dist(P[0], held);
  put("charge.travel", travel / F);
  let reach = null;
  for (let f = 0; f < n; f++)
    if (dist(P[f], held) <= NEAR * travel) {
      reach = f / fps;
      break;
    }
  put("charge.reach", reach);
  if (heavyAt !== null) {
    let creep = 0;
    const last = Math.min(n - 1, Math.round((autoAt ?? heavyAt) * fps));
    for (let f = Math.round(heavyAt * fps); f <= last; f++) creep = Math.max(creep, dist(P[f], held));
    put("charge.creep", creep / F);
  }

  // the heavy drawn from the charge's frame nearest its own first
  const hs = heavy === null ? -1 : model.sequenceAt(heavy);
  if (hs >= 0 && hs !== undefined) {
    const t0 = tipAt(hs, 0);
    let best = Infinity;
    let bestAt = 0;
    for (let f = 0; f < n; f++) {
      const g = dist(t0, P[f]);
      if (g < best) [best, bestAt] = [g, f];
    }
    put("charge.deepAt", bestAt / fps);
    put("charge.deepGap", best / F);
  }
  const ls = light === null ? -1 : model.sequenceAt(light);
  if (ls >= 0 && ls !== undefined) put("release.lightJoin", dist(tipAt(ls, 0), at(tap)) / F);

  put("release.lightBlend", blends.light ?? null);
  put("release.heavyBlend", blends.heavy ?? null);
  put("release.lightHit", hits.light ?? null);
  put("release.heavyHit", hits.heavy ?? null);
  const after = (c, h) => (c === null || c === undefined || h === null || h === undefined ? null : c - h);
  put("release.lightChain", after(chains.light, hits.light));
  put("release.heavyChain", after(chains.heavy, hits.heavy));
  put("played.light", hits.light === null || hits.light === undefined ? null : tap + hits.light);
  put("played.heavy", heavyAt === null || hits.heavy == null ? null : heavyAt + hits.heavy);
  put("played.auto", autoAt === null || hits.heavy == null ? null : autoAt + hits.heavy);
  return { values: v, info: { frames: n, fps, unit: F, seconds: n / fps } };
}

/**
 * Vermintide 2's charges from the local cache, one per charge clip (the first template met names it): { template,
 * family, place ("opening" for the first press, "combo" for a charge that follows a blow), event, model, opts } for
 * measureCharge. A charge is an action_one sub-action of kind melee_start; its light is the release chained from
 * 0 s, its heavy the release chained later, its auto-fire the chain with no input.
 */
export function* vt2Charges({ cache = VT2_CACHE, fps = 60, log = () => {} } = {}) {
  const need = ["attacks.json", "templates.json", "weapons.json", "fp_skeleton.json"];
  if (!need.every((f) => existsSync(cache + f))) {
    log(`vt2: no cache at ${cache} (run anim/vt2's scripts)`);
    return;
  }
  const [attacks, templates, weapons, skeleton] = need.map((f) => JSON.parse(readFileSync(cache + f, "utf8")));
  const rows = new Map();
  for (const r of attacks)
    if (r.family === "melee" && r.event_field === "anim_event" && !r.template.endsWith("_vs"))
      rows.set(`${r.template}|${r.action}|${r.sub_action}`, r);
  const seen = new Set();
  const one = (r) => (r?.states?.length === 1 && r.states[0].clips.length === 1 ? r.states[0] : null);
  for (const r of rows.values()) {
    if (r.kind !== "melee_start" || r.action !== "action_one" || !one(r)) continue;
    const short = r.template.split(".").pop();
    const w = weapons[short];
    const tpl = templates[r.template];
    const clip = one(r).clips[0];
    if (!(w?.right || w?.left) || !tpl?.idle_clips.length || seen.has(clip)) continue;
    seen.add(clip);
    const released = r.chains.filter((c) => c.action === "action_one" && c.input === "action_one_release");
    const lightChain = released.find((c) => !/heavy/.test(c.sub_action ?? ""));
    const heavyChain = released.find((c) => /heavy/.test(c.sub_action ?? ""));
    const autoChain = r.chains.find((c) => c.action === "action_one" && c.input == null && /heavy/.test(c.sub_action ?? ""));
    const lightRow = lightChain && rows.get(`${r.template}|action_one|${lightChain.sub_action}`);
    const heavyRow = heavyChain && rows.get(`${r.template}|action_one|${heavyChain.sub_action}`);
    const clips = [
      { name: "charge", buf: readFileSync(cache + "anim/" + clip) },
      { name: "idle", buf: readFileSync(cache + "anim/" + tpl.idle_clips[0]) },
    ];
    if (one(lightRow)) clips.push({ name: "light", buf: readFileSync(cache + "anim/" + one(lightRow).clips[0]) });
    if (one(heavyRow)) clips.push({ name: "heavy", buf: readFileSync(cache + "anim/" + one(heavyRow).clips[0]) });
    let model;
    try {
      if (clips.some((c) => c.name !== "idle" && readClip(c.buf).tracks !== skeleton.names.length)) throw new Error("another rig");
      model = vt2Model({ skeleton, fps, name: `${short}/${r.sub_action}`, clips });
    } catch (e) {
      log(`vt2: ${short}/${r.sub_action} left out: ${e.message}`);
      continue;
    }
    const side = w.right ? "R" : "L";
    const wp = w[side === "R" ? "right" : "left"];
    const blend = (row) => (one(row)?.blend_in?.length ? Math.max(...one(row).blend_in) : null);
    const chain = (row) => (row && chainPoint(row) !== null ? chainPoint(row) / (row.anim_time_scale || 1) : null);
    const hit = (row) => (typeof row?.damage_window?.[0] === "number" ? row.damage_window[0] / (row.anim_time_scale || 1) : null);
    yield {
      template: short,
      family: vt2Family(r.state_machine, short),
      // the first press's charge is the action's "default"; the others follow a blow
      place: r.sub_action === "default" ? "opening" : "combo",
      event: r.anim_event,
      model,
      opts: {
        charge: "charge",
        light: one(lightRow) ? "light" : null,
        heavy: one(heavyRow) ? "heavy" : null,
        idle: "idle",
        fps: fps * (r.anim_time_scale || 1),
        arms: VT2_ARMS,
        attach: `j_${side === "R" ? "right" : "left"}weaponattach`,
        tip: wp.tip,
        heavyAt: heavyChain?.start_time ?? null,
        autoAt: autoChain?.start_time ?? null,
        blends: { light: blend(lightRow), heavy: blend(heavyRow) },
        hits: { light: hit(lightRow), heavy: hit(heavyRow) },
        chains: { light: chain(lightRow), heavy: chain(heavyRow) },
      },
    };
  }
}

/** Bands of measured charges ({ values, family, place }): overall, by place and by family. */
export function chargeBands(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.values)))];
  const of = (list) => ({
    n: list.length,
    ...Object.fromEntries(keys.map((k) => [k, band(list.map((r) => r.values[k] ?? null))]).filter(([, b]) => b)),
  });
  const group = (by) => Object.fromEntries([...new Set(rows.map((r) => r[by]))].map((g) => [g, of(rows.filter((r) => r[by] === g))]));
  return { overall: of(rows), places: group("place"), families: group("family") };
}
