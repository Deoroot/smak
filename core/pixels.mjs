// Small things about pictures that the drawing module (render.mjs) and the modules that work by place share.
// Internal to the kit: nothing here is part of what `index.mjs` hands out.

/** A texture's palette: 256 colours of three bytes, kept in the file right after its pixels. */
export const PALETTE_BYTES = 768;
/**
 * A map of a texture (uvMap, islandMap, layerMap) is enlarged until its longer side is about this many
 * pixels...
 */
const MAP_SIDE = 1024;
/** ...but never more than this many times. */
const MAP_SCALE_MOST = 8;

/** A number held between 0 and 1. */
export const clamp = (v) => Math.min(1, Math.max(0, v));

/** The pixels (one palette index each) and the palette of a texture, as they lie in the file `src`. */
export function bytesOf(src, texture) {
  const size = texture.width * texture.height;
  return {
    pixels: src.subarray(texture.index, texture.index + size),
    palette: src.subarray(texture.index + size, texture.index + size + PALETTE_BYTES),
  };
}

/** How many times a texture is enlarged in a map of it, when the caller does not say. */
export const mapScaleOf = (texture) =>
  Math.max(1, Math.min(MAP_SCALE_MOST, Math.floor(MAP_SIDE / Math.max(texture.width, texture.height))));

/**
 * A line of one colour ([r, g, b, a]) from `a` to `b` ([x, y]) on a picture of `width` by `height` in `rgba`.
 */
export function drawLine(rgba, width, height, a, b, colour) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * i) / steps);
    const y = Math.round(a[1] + ((b[1] - a[1]) * i) / steps);
    if (x >= 0 && y >= 0 && x < width && y < height) rgba.set(colour, (y * width + x) * 4);
  }
}

/** The brightness of the three colour bytes at `o` of `bytes`, 0 to 255: green counts most, blue least. */
export const brightnessAt = (bytes, o) => 0.3 * bytes[o] + 0.59 * bytes[o + 1] + 0.11 * bytes[o + 2];
