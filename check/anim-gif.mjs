// An animation of a model as a looping GIF: every frame drawn by one camera at one scale, as `strip` draws them,
// each labelled with the animation's name and its frame, and played at the animation's own rate. For a person to
// watch a model move in any browser or chat, where an animated PNG may not play.
import { render, framing, label } from "../make/render.mjs";
import { sequences, sequenceAt } from "../core/mdl.mjs";
import { gif, gifFrame } from "./video.mjs";

/** The most frames one GIF holds: a longer animation is drawn at every n-th frame, its rate cut to match. */
export const GIF_FRAMES = 60;

/**
 * The GIF of one animation: `{ bytes, name, frames, fps, width, height }`. `opts` are `render`'s (view, yaw, pitch,
 * body, skin, ground, width, height, groups for an animation kept in another file...) and `seq` (a name or
 * number), `fps` (the animation's own unless told), `most` (the most frames, GIF_FRAMES).
 */
export function animationGif(src, opts = {}) {
  const all = sequences(src);
  if (!all.length) throw new Error("the model has no animations: render or sheet draws it as it rests");
  const number = sequenceAt(src, opts.seq ?? 0);
  const sequence = all[number];
  if (!sequence) throw new Error(`no animation ${opts.seq}`);
  const last = Math.max(0, sequence.frames - 1);
  const step = Math.max(1, Math.ceil(sequence.frames / (opts.most ?? GIF_FRAMES)));
  const frames = [];
  for (let f = 0; f <= last; f += step) frames.push(f);
  // a looping animation's last frame is its first again: drawn once, so the loop does not stutter
  if (sequence.loops && frames.length > 1 && frames.at(-1) === last) frames.pop();
  const first = opts.view === "first";
  const width = opts.width ?? (first ? 400 : 320);
  const height = opts.height ?? (first ? 300 : 320);
  const within = first ? undefined : framing(src, frames.map((frame) => ({ ...opts, seq: number, frame })));
  const fps = (opts.fps ?? (sequence.fps || 10)) / step;
  const pictures = frames.map((frame) => {
    const picture = render(src, { ...opts, width, height, within, seq: number, frame });
    label(picture, `${sequence.name} ${frame}/${last}`, 6, 6);
    return gifFrame(picture);
  });
  return { bytes: gif(pictures, { width, height, fps }), name: sequence.name, number, frames: frames.length, fps, width, height };
}

/** Every animation of a model as GIFs, in its order: `[{ bytes, name, number, ... }]`. */
export function animationGifs(src, opts = {}) {
  return sequences(src).map((_, number) => animationGif(src, { ...opts, seq: number }));
}
