// Vermintide 2's first-person clips as models the judge reads (the shape of model.mjs), from the local cache that
// anim/vt2/'s Python scripts extract (anim/vt2/out/: clips, the first-person skeleton, every attack's clip, damage
// window and time scale, each template's idle and weapon). Nothing of the game's is in the repository.
//
//   readClip(buf)                         a clip decoded: { tracks, length, events, keys }
//   vt2Model({ skeleton, clips, fps })     clips (one is "idle") as a model: bones, sequences, pose(seq, frame)
//   vt2Blows({ cache, log })               every melee sweep with one clip, as { game, model, seq, family, opts }
//
// Space: the camera's at each frame (what the player sees), as the judge has it: +x ahead, +y left, +z up, the
// eye 1 unit above the origin. Units are the game's (metres). The clip layout is in anim/vt2/anim.py.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { edgeOf } from "./judge.mjs";

export const VT2_CACHE = fileURLToPath(new URL("../vt2/out/", import.meta.url));

// ── the clip ───────────────────────────────────────────────────────────────

/** A packed rotation: smallest three in 32 bits (the largest's index in the low 2, three 10-bit fields over +-0.75). */
function unpackQuat(v) {
  const big = v & 3;
  const q = [0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const x = (((v >>> (2 + 10 * i)) & 1023) / 1023) * 1.5 - 0.75;
    q[(big + 1 + i) % 4] = x;
    sum += x * x;
  }
  q[big] = Math.sqrt(Math.max(0, 1 - sum));
  return q;
}

/** A clip's bytes decoded: each track's keys of position, rotation (x, y, z, w) and scale, time-sorted. */
export function readClip(b) {
  const tracks = b.readUInt32LE(4);
  const length = b.readFloatLE(8);
  const nev = b.readUInt32LE(16);
  const events = [];
  for (let i = 0; i < nev; i++) events.push({ t: b.readFloatLE(20 + 8 * i), hash: b.readUInt32LE(24 + 8 * i) });
  // the rest values' form: 7 floats (position, rotation, scale: 40 bytes a track), 1 packed as the keys are
  // (3 x u16, smallest-three u32, 3 x u16: 16 bytes)
  const restForm = b.readUInt16LE(20 + 8 * nev);
  let at = 20 + 8 * nev + 2;
  const keys = { pos: [], rot: [], scl: [] };
  const f3 = (o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)];
  const u3 = (o) => [0, 1, 2].map((i) => ((b.readUInt16LE(o + 2 * i) / 65535) * 2 - 1) * 10);
  if (restForm !== 7 && restForm !== 1) throw new Error(`clip: rest values of form ${restForm}`);
  for (let i = 0; i < tracks; i++) {
    if (restForm === 7) {
      keys.pos.push([[0, f3(at)]]);
      keys.rot.push([[0, [...f3(at + 12), b.readFloatLE(at + 24)]]]);
      keys.scl.push([[0, f3(at + 28)]]);
      at += 40;
    } else {
      keys.pos.push([[0, u3(at)]]);
      keys.rot.push([[0, unpackQuat(b.readUInt32LE(at + 6))]]);
      keys.scl.push([[0, u3(at + 10)]]);
      at += 16;
    }
  }
  const end = b.length - 2;
  while (at + 4 <= end) {
    const h = b.readUInt16LE(at);
    const w = b.readUInt16LE(at + 2);
    const top = h >> 14;
    if (top === 0) {
      if (h === 2) {
        events.push({ hash: b.readUInt32LE(at + 2), t: b.readFloatLE(at + 6) });
        at += 10;
        continue;
      }
      const t = b.readFloatLE(at + 4);
      if (w >= tracks) throw new Error(`clip: key for bone ${w} of ${tracks} at ${at}`);
      if (h === 4) (keys.pos[w].push([t, f3(at + 8)]), (at += 20));
      else if (h === 5) (keys.rot[w].push([t, [...f3(at + 8), b.readFloatLE(at + 20)]]), (at += 24));
      else if (h === 6) (keys.scl[w].push([t, f3(at + 8)]), (at += 20));
      else throw new Error(`clip: key kind ${h} at ${at}`);
      continue;
    }
    const bone = (h >> 4) & 0x3ff;
    if (bone >= tracks) throw new Error(`clip: key for bone ${bone} of ${tracks} at ${at}`);
    const t = w / 1000;
    if (top === 3) {
      keys.rot[bone].push([t, unpackQuat(b.readUInt32LE(at + 4))]);
      at += 8;
    } else {
      const v = u3(at + 4);
      keys[top === 2 ? "pos" : "scl"][bone].push([t, v]);
      at += 10;
    }
  }
  for (const k of Object.keys(keys)) for (const tr of keys[k]) tr.sort((x, y) => x[0] - y[0]);
  events.sort((x, y) => x.t - y.t);
  return { tracks, length, events, keys };
}

function sampleTrack(track, t, rot) {
  let j = 0;
  while (j < track.length && track[j][0] <= t) j++;
  if (j === 0) return track[0][1];
  if (j >= track.length) return track[track.length - 1][1];
  const [t0, a] = track[j - 1];
  let [t1, b] = track[j];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  if (rot) {
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) b = b.map((x) => -x);
    const q = a.map((x, i) => x + (b[i] - x) * u);
    const n = Math.hypot(...q) || 1;
    return q.map((x) => x / n);
  }
  return a.map((x, i) => x + (b[i] - x) * u);
}

/** A 3x4 matrix from a position, a rotation (x, y, z, w) and a scale. */
function matrix(p, q, s) {
  const [x, y, z, w] = q;
  const r = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  return [0, 1, 2].map((i) => [r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], p[i]]);
}
const mul = (a, b) => [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + (j === 3 ? a[i][3] : 0)));
/** A rigid matrix's inverse. */
const invert = (m) => {
  const r = [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
  const t = [0, 1, 2].map((i) => -(r[i][0] * m[0][3] + r[i][1] * m[1][3] + r[i][2] * m[2][3]));
  return [0, 1, 2].map((i) => [...r[i], t[i]]);
};

// The camera's axes as the judge's: Stingray's camera looks down its +y, +z up, +x right; the judge's +x ahead,
// +y left, +z up, the eye 1 above the origin
const CAMERA_TO_JUDGE = [
  [0, 1, 0, 0],
  [-1, 0, 0, 0],
  [0, 0, 1, 1],
];

/** Every bone's world matrix of a clip at a time. */
export function worldAt(clip, parents, t) {
  const out = new Array(parents.length);
  for (let i = 0; i < parents.length; i++) {
    const k = clip.keys;
    const m = matrix(sampleTrack(k.pos[i], t, false), sampleTrack(k.rot[i], t, true), sampleTrack(k.scl[i], t, false));
    out[i] = parents[i] < 0 ? m : mul(out[parents[i]], m);
  }
  return out;
}

/**
 * Clips as a model: `skeleton` { names, parents } (anim/vt2/out/fp_skeleton.json), `clips` [{ name, buf }], each
 * sampled at `fps` over its length. Poses are in the camera's space at the same frame.
 */
export function vt2Model({ skeleton, clips, fps = 60, name = "vt2" }) {
  const decoded = clips.map((c) => ({ name: c.name, clip: readClip(c.buf) }));
  const camera = skeleton.names.indexOf("camera_node");
  const posed = new Map();
  return {
    kind: "vt2",
    name,
    bones: skeleton.names.map((n, i) => ({ name: n, parent: skeleton.parents[i] })),
    sequences: decoded.map((d) => ({ name: d.name, frames: Math.max(2, Math.round(d.clip.length * fps) + 1), fps, loops: false, activity: "" })),
    sequenceAt(s) {
      return typeof s === "number" ? s : decoded.findIndex((d) => d.name === s);
    },
    events: (i) => decoded[i].clip.events,
    pose(i, f) {
      const key = `${i}:${f}`;
      if (!posed.has(key)) {
        const W = worldAt(decoded[i].clip, skeleton.parents, Math.min(f / fps, decoded[i].clip.length));
        const view = mul(CAMERA_TO_JUDGE, invert(W[camera]));
        posed.set(key, W.map((m) => mul(view, m)));
      }
      return posed.get(key);
    },
    // the camera in the rig's own space (the poses above are in the camera's, so its motion is not in them): how
    // far the view turns and shifts with the blow
    camera(i, f) {
      return worldAt(decoded[i].clip, skeleton.parents, Math.min(f / fps, decoded[i].clip.length))[camera];
    },
    bodyparts: [],
    verts: () => [],
    tris: () => [],
  };
}

// ── the blows ──────────────────────────────────────────────────────────────

export const VT2_ARMS = {
  R: { shoulder: "j_rightarm", elbow: "j_rightforearm", hand: "j_righthand" },
  L: { shoulder: "j_leftarm", elbow: "j_leftforearm", hand: "j_lefthand" },
};

/** The earliest time (seconds of the clip) an action lets the next attack start, or null. */
export function chainPoint(r) {
  const t = (r.chains ?? []).filter((c) => c.action === "action_one" && typeof c.start_time === "number").map((c) => c.start_time);
  return t.length ? Math.min(...t) : null;
}

/** A template's family as the judge's: by the template's name first (es_deus_01 is a spear), else its state machine's. */
export function vt2Family(stateMachine, template = "") {
  const t = template.toLowerCase();
  if (/spear|halberd|billhook|scythe/.test(t)) return "polearms";
  if (/sword_dagger|axe_falchion|hammer_sword/.test(t)) return "1h swords";
  if (/dagger/.test(t)) return "smallarms";
  if (/two_handed_swords|bastard/.test(t)) return "2h swords";
  if (/axe/.test(t)) return "axes";
  if (/sword|falchion/.test(t)) return "1h swords";
  if (/hammer|mace|flail|crowbill|pick/.test(t)) return "blunts";
  const m = stateMachine.split("/").pop();
  if (/dagger/.test(m)) return "smallarms";
  if (/2h_sword|bastard/.test(m)) return "2h swords";
  if (/axe/.test(m)) return "axes";
  if (/sword|fencing|falchion|spells/.test(m)) return "1h swords";
  if (/polearm|spear|halberd|billhook|scythe/.test(m)) return "polearms";
  return "blunts";
}

/**
 * Every melee sweep that plays one clip, once per clip (the first template met names it): { game: "vt2", model,
 * seq, family, weight, opts, info }. The hit is the damage window's middle; times are as played (the clip's time
 * over anim_time_scale). Weapons are from anim/vt2/out/weapons.json; a dual wield's blow is the hand whose weapon
 * moves faster.
 */
export function* vt2Blows({ cache = VT2_CACHE, fps = 60, log = () => {} } = {}) {
  const need = ["attacks.json", "templates.json", "weapons.json", "fp_skeleton.json"];
  if (!need.every((f) => existsSync(cache + f))) {
    log(`vt2: no cache at ${cache} (run anim/vt2's scripts)`);
    return;
  }
  const read = (f) => JSON.parse(readFileSync(cache + f, "utf8"));
  const [attacks, templates, weapons, skeleton] = need.map(read);
  const seen = new Set();
  // each weapon's striking end decided by all its blows (a blow alone may lead with neither end): first the blows,
  // then the vote, then each blow given out with its weapon's end
  const pending = [];
  const votes = new Map();
  const skipped = { noWeapon: 0, blend: 0, unread: 0 };
  for (const r of attacks) {
    if (r.family !== "melee" || r.kind !== "sweep" || r.event_field !== "anim_event" || r.template.endsWith("_vs")) continue;
    const short = r.template.split(".").pop();
    const tpl = templates[r.template];
    const wpn = weapons[short];
    for (const s of r.states) {
      if (s.clips.length !== 1) {
        skipped.blend++;
        continue;
      }
      const clip = s.clips[0];
      if (seen.has(clip)) continue;
      seen.add(clip);
      if (!(wpn?.right || wpn?.left) || !tpl?.idle_clips.length) {
        skipped.noWeapon++;
        continue;
      }
      let model;
      try {
        model = vt2Model({
        skeleton,
        name: `${short}/${r.sub_action}`,
        fps,
        clips: [
          { name: r.anim_event, buf: readFileSync(cache + "anim/" + clip) },
          { name: "idle", buf: readFileSync(cache + "anim/" + tpl.idle_clips[0]) },
        ],
        });
        // a clip of another rig (its tracks are not the first-person skeleton's) is not this one's
        if (model.sequences.length !== 2 || readClip(readFileSync(cache + "anim/" + clip)).tracks !== skeleton.names.length) throw new Error("another rig");
      } catch (e) {
        skipped.unread++;
        log(`vt2: ${short}/${r.sub_action} ${clip} left out: ${e.message}`);
        continue;
      }
      // the striking hand: the one holding the weapon (the Warrior Priest's hammer is in his left, his book in the
      // right, which is no weapon here), or for a dual wield the hand whose weapon's tip moves faster
      let side = wpn.right ? "R" : "L";
      // (a dual wield by its template: the rapier's pistol, a shield or the elf spear's javelin is no second blade)
      const dual = wpn.right && wpn.left && /^dual_wield/.test(short);
      if (dual) {
        const speed = (k) => {
          const w = wpn[k === "R" ? "right" : "left"];
          const bone = model.bones.findIndex((b) => b.name === `j_${k === "R" ? "right" : "left"}weaponattach`);
          const n = model.sequences[0].frames;
          let top = 0;
          let last = null;
          for (let f = 0; f < n; f++) {
            const m = model.pose(0, f)[bone];
            const p = [0, 1, 2].map((i) => m[i][0] * w.tip[0] + m[i][1] * w.tip[1] + m[i][2] * w.tip[2] + m[i][3]);
            if (last) top = Math.max(top, Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]));
            last = p;
          }
          return top;
        };
        if (speed("L") > speed("R")) side = "L";
      }
      const attach = `j_${side === "R" ? "right" : "left"}weaponattach`;
      const twoHanded = /\/(2h_|polearm|bastard_sword)/.test(r.state_machine);
      let w = wpn[side === "R" ? "right" : "left"];
      const scale = r.anim_time_scale || 1;
      const [a, b] = r.damage_window;
      // the striking end is the one out ahead while the damage lands (weapons.json's tip is the end farther from
      // the hand: an axe held high on its haft has its head the nearer end)
      if (a !== null && b !== null) {
        const bone = model.bones.findIndex((x) => x.name === attach);
        const n = model.sequences[0].frames;
        let depth = 0;
        for (let f = Math.floor(a * fps); f <= Math.min(n - 1, Math.ceil(b * fps)); f++) {
          const A = model.pose(0, f)[bone];
          const x = (p) => A[0][0] * p[0] + A[0][1] * p[1] + A[0][2] * p[2] + A[0][3];
          depth += x(w.tip) - x(w.butt);
        }
        votes.set(short + side, (votes.get(short + side) ?? 0) + Math.sign(depth));
      }
      pending.push({
        key: short + side,
        game: "vt2",
        model,
        seq: r.anim_event,
        family: vt2Family(r.state_machine, short),
        // a heavy is released from a charge held past its threshold (anim/lib/charge.mjs), a light from a click
        strength: /heavy/.test(r.sub_action) ? "heavy" : "light",
        // what the hands hold: a weapon in each (dual), a weapon and a shield (Kruber's spear and shield is es_deus_01),
        // a weapon and a book (the Warrior Priest's), one weapon in both, or one in one
        loadout: /^dual_wield/.test(short) ? "dual" : /shield|^es_deus_01/.test(short) ? "shield" : /book/.test(short) ? "book" : /\/(2h_|polearm|bastard_sword)/.test(r.state_machine) || /^two_handed|scythe|halberd|spear|polearm/.test(short) ? "two-handed" : "one",
        weight: 1,
        info: { template: short, sub_action: r.sub_action, clip, chain: chainPoint(r), unit: w.unit, turned: false, blend_in: s.blend_in, window: r.damage_window, scale },
        opts: {
          seq: r.anim_event,
          idle: "idle",
          arms: VT2_ARMS,
          hand: side,
          fps: fps * scale,
          delay: a !== null && b !== null ? (a + b) / 2 / scale : null,
          aspect: 16 / 9,
          // the crossfade into the state (the longest its transitions set): shown mixed with the pose before
          settle: s.blend_in.length ? Math.max(...s.blend_in) : 0,
          // the chain point: the earliest the next attack may start (allowed_chain_actions' action_one entries)
          cut: chainPoint(r) === null ? null : chainPoint(r) / scale,
          // two-handed weapons: the off hand belongs on the handle
          twoHanded: /\/(2h_|polearm|bastard_sword)/.test(r.state_machine) || undefined,
          weapon: {
            name: w.unit.split("/").pop(),
            boneName: attach,
            bones: [attach],
            length: w.length,
            hand: side,
            tip: { bone: model.bones.findIndex((x) => x.name === attach), p: w.tip },
            butt: { bone: model.bones.findIndex((x) => x.name === attach), p: w.butt },
            // which way its edge faces (judge.edgeOf), from its mesh's points
            edge: ((d) => d && { bone: model.bones.findIndex((x) => x.name === attach), d })(edgeOf(w.points, w.tip, w.butt)),
          },
        },
      });
    }
  }
  for (const { key, ...b } of pending) {
    if ((votes.get(key) ?? 0) < 0) {
      // a two-handed weapon struck with its near end is held at its head with its haft behind: more likely a mesh
      // whose offset along its length is not read (node transforms; the elf 2h axe), so left out until it is
      if (b.opts.twoHanded) {
        skipped.unplaced = (skipped.unplaced ?? 0) + 1;
        continue;
      }
      const w = b.opts.weapon;
      b.opts.weapon = { ...w, tip: w.butt, butt: w.tip };
      b.info.turned = true;
    }
    yield b;
  }
  log(`vt2: ${seen.size} clips; ${skipped.noWeapon} without a weapon or idle, ${skipped.unread} not read, ${skipped.blend} blend states left out, ${skipped.unplaced ?? 0} blows of weapons not surely placed`);
}
