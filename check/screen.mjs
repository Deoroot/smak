// What the player's screen shows of a first-person view model, frame by frame: how much of it the arms cover, and
// where a mesh is seen cut (its open end, or the near plane through it). Every check of an animation (check, motion)
// measured joints and passed a blow whose forearms filled a third of the screen, aimed at the eye; the owner saw it at
// once in the game (ARCHITECTURE.md 8.5). This measures the picture the game's eye draws (make/render.mjs's gameEye:
// the screen's shape, Hor+ from a 4:3 fov, the near plane at 4), so an agent sees it first.
//
//   screenOf(mdl, { seq, bones, weapon, screen, fov, width, groups, sweep }) -> the measures of one animation (below)
//   judgeScreen(measures, { limits })                                   -> { faults, found }
//   SCREEN_LIMITS                                                       the limits, each with its reason
//
// The measures: { name, index, screen, fov, frames: [{ frame, cover, cuts: [{ kind, bone, x, y, share }] }], most }.
//   cover   the share of the screen's pixels the chosen bones' mesh covers (every mesh but the `weapon` bones' when they
//           are named; every mesh else)
//   cuts    each bone whose mesh's inside is the nearest thing on some of the screen (render's `inside`: a triangle seen
//           from behind, which the game does not draw, so the player sees through it): "near" when the bone's mesh
//           crosses the near plane where the screen shows it (the engine clips it open), "open" else (an open end: an arm
//           modelled to the elbow and cut there, turned to the eye). x and y: the middle of what is seen (0 to 1 from the
//           left and the top); `share`: of the screen. An open edge that lies on another surface (a glove's cuff on the
//           arm) shows no inside and is no cut.
//   sweep   with `sweep` ({ bones, from, to }: the forearms, the hand's fastest stretch): the share of the screen those
//           bones' own mesh covers in any of those frames (the onion's union: the fan of a blow). A fact: at fov 80 on
//           16:9 Half-Life's grenade throws sweep 10.8 to 16.5%, its crowbar 2.7% at most, a katana's own slashes 1.5% and
//           a remade one whose forearms fanned across the screen 5.6 to 9.1%: no limit parts them from Half-Life's.
import { posed, render, gameEye, bonesUnder, silhouette } from "../make/render.mjs";
import { bones as bonesOf, sequences, sequenceAt } from "../core/mdl.mjs";

/**
 * The limits, each the next round step over the most Half-Life's own view models reach. Measured 2026-11-11 by node
 * (screenOf at 16:9, fov 90, every mesh, 480 wide) over the 16 v_*.mdl of its valve/models folder (read where Steam keeps
 * them, never copied), every animation kept in the file: 133 animations, 5624 frames.
 *   COVER  the most any covers is 31.6% (v_rpg's reload, frame 39: the launcher across the screen); the crowbar's swings
 *          14.0%, the grenade's pin pull 20.2%, the shotgun's big shot 18.8%.
 *   OPEN   the inside of a mesh seen through its open end: 0.29% of the screen at most (v_satchel's draw, frame 32, the
 *          hand's cuff at the screen's foot; the crowbar's attack3 0.27%, a forearm's end for a frame).
 *   NEAR   the inside seen where the near plane cuts a mesh: 1.17% at most (v_grenade's throw1, frame 3: the forearm
 *          through the plane in the screen's lower right corner as it is thrown).
 */
export const SCREEN_LIMITS = {
  COVER: 0.35,
  OPEN: 0.003,
  NEAR: 0.012,
};

/** Where on the screen, in words: "lower right", "middle", ... from x and y (0 to 1). */
export function placeOnScreen(x, y) {
  const across = x < 1 / 3 ? "left" : x > 2 / 3 ? "right" : "";
  const down = y < 1 / 3 ? "upper" : y > 2 / 3 ? "lower" : "";
  return [down, across].filter(Boolean).join(" ") || "middle";
}

/**
 * One animation of a first-person view model as the game's eye sees it, frame by frame (the measures above). `bones`
 * (names or numbers, each with the bones under it) limits what is measured; `weapon` (the same) is left out of it.
 */
export function screenOf(mdl, { seq = 0, bones, weapon, screen = "16:9", fov = 90, width = 480, groups, body = 0, sweep } = {}) {
  const index = sequenceAt(mdl, seq);
  const sequence = sequences(mdl)[index];
  if (!sequence) throw new Error(`screenOf: no animation ${seq}`);
  const eye = gameEye({ screen, fov, width });
  const view = { view: "first", screen, fov, width, groups, body, seq: index };
  const chosen = bonesUnder(mdl, bones);
  const left = bonesUnder(mdl, weapon);
  const keep = (t) => (!chosen || chosen.has(t.c[0].bone)) && !left?.has(t.c[0].bone);
  const names = bonesOf(mdl).map((b) => b.name);
  const frames = [];
  const swept = sweep && new Set(sweep.bones.map((b) => (typeof b === "number" ? b : names.indexOf(b))));
  let fan = null;
  for (let frame = 0; frame < sequence.frames; frame++) {
    const { tris } = posed(mdl, { ...view, frame });
    const mine = tris.filter(keep);
    const { mask } = silhouette(mdl, mine, { ...view, frame });
    if (swept && frame >= sweep.from && frame <= sweep.to) {
      const arms = silhouette(mdl, tris.filter((t) => swept.has(t.c[0].bone)), { ...view, frame }).mask;
      fan ??= new Uint8Array(arms.length);
      arms.forEach((v, i) => (fan[i] |= v));
    }
    const cover = mask.reduce((s, v) => s + v, 0) / mask.length;
    const full = render(mdl, { ...view, frame, tris, depth: true, inside: true, light: false });
    const wide = full.width * full.dots;
    const high = full.height * full.dots;
    // the inside of a mesh seen: its dots by bone, their middle
    const seen = new Map();
    full.inside.forEach((v, i) => {
      if (!v) return;
      const b = seen.get(v - 1) ?? { dots: 0, x: 0, y: 0 };
      b.dots++;
      b.x += i % wide;
      b.y += Math.floor(i / wide);
      seen.set(v - 1, b);
    });
    // the bones whose mesh crosses the near plane where the screen shows it, facing the eye
    const crossing = new Set();
    for (const t of mine) {
      // in first person the eye is at the origin looking along +x: a point's x is how far in front of it
      const z = t.c.map((c) => c.p[0]);
      if (z.every((v) => v >= eye.near) || z.every((v) => v < eye.near)) continue;
      const on = t.c.filter((c) => c.p[0] >= eye.near).map((c) => full.at(c.p));
      if (on.some((p) => p && p[0] >= 0 && p[1] >= 0 && p[0] < wide && p[1] < high)) crossing.add(t.c[0].bone);
    }
    const cuts = [...seen].filter(([bone]) => keep({ c: [{ bone }] })).map(([bone, b]) => ({ kind: crossing.has(bone) ? "near" : "open", bone: names[bone] ?? bone, x: b.x / b.dots / wide, y: b.y / b.dots / high, share: b.dots / (wide * high) })); // prettier-ignore
    frames.push({ frame, cover, cuts });
  }
  let most = frames[0] ?? { frame: 0, cover: 0 };
  for (const f of frames) if (f.cover > most.cover) most = f;
  const sweptShare = fan ? fan.reduce((s, v) => s + v, 0) / fan.length : undefined;
  return { name: sequence.name, index, screen, fov: eye.fov, frames, most: { frame: most.frame, cover: most.cover }, sweep: sweptShare };
}

const pc = (v) => `${Math.round(v * 100)}%`;
const pc1 = (v) => `${Math.round(v * 1000) / 10}%`;
/** Frames as a run: "frame 4" or "frames 3 to 6" (or a list). */
export const framesSaid = (list) => (list.length === 1 ? `frame ${list[0]}` : list.at(-1) - list[0] === list.length - 1 ? `frames ${list[0]} to ${list.at(-1)}` : `frames ${list.join(", ")}`); // prettier-ignore

/**
 * The faults of what the screen shows (SCREEN_LIMITS): `faults` sentences, one a kind of fault a bone (one for the
 * cover), each with its frames, the worst frame, where on the screen and what to do; `found` the same as { key, frame,
 * bone, said }.
 */
export function judgeScreen(m, { limits = SCREEN_LIMITS } = {}) {
  const faults = [];
  const found = [];
  const fault = (key, frame, bone, said) => {
    found.push({ key, frame, bone, said });
    faults.push(said);
  };
  const over = m.frames.filter((f) => f.cover > limits.COVER);
  if (over.length) {
    const worst = over.reduce((a, b) => (b.cover > a.cover ? b : a));
    fault("cover", worst.frame, null, `screen: ${m.name}: ${framesSaid(over.map((f) => f.frame))}, the mesh covers up to ${pc(worst.cover)} of a ${m.screen} screen (frame ${worst.frame}), over the ${pc(limits.COVER)} Half-Life's view models reach at most (31.6%): the arms are too near the eye or too large in it; keep them lower and farther out, the blade crossing the screen and not the forearms`); // prettier-ignore
  }
  for (const kind of ["open", "near"]) {
    const byBone = new Map();
    for (const f of m.frames)
      for (const c of f.cuts)
        if (c.kind === kind && c.share > (kind === "open" ? limits.OPEN : limits.NEAR)) {
          if (!byBone.has(c.bone)) byBone.set(c.bone, []);
          byBone.get(c.bone).push({ frame: f.frame, ...c });
        }
    for (const [bone, list] of byBone) {
      const worst = list.reduce((a, b) => (b.share > a.share ? b : a));
      const where = `about ${pc(worst.x)} across and ${pc(worst.y)} down (${placeOnScreen(worst.x, worst.y)}), its inside ${pc1(worst.share)} of the screen in frame ${worst.frame}`; // prettier-ignore
      if (kind === "open")
        fault("open", worst.frame, bone, `screen: ${m.name}: ${framesSaid(list.map((c) => c.frame))}, the player sees into ${bone}'s mesh through its open end, ${where}, over the ${pc1(limits.OPEN)} Half-Life's view models show at most: the mesh is cut off where it is seen; keep that end below or beyond the screen's edge (the arm lower, or farther back), or model it longer`); // prettier-ignore
      else
        fault("near", worst.frame, bone, `screen: ${m.name}: ${framesSaid(list.map((c) => c.frame))}, ${bone}'s mesh crosses the near plane (4 units from the eye) on the screen ${where}, over the ${pc1(limits.NEAR)} Half-Life's view models show at most: the engine cuts it open there; keep it 4 units or more from the eye`); // prettier-ignore
    }
  }
  return { faults, found };
}
