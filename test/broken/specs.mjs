// The sound and sprite specs broken in one way each, against the spec's own validation: a sound of a layer of no
// kind, a sprite of a side that is no multiple of 8.
import { validateSoundSpec } from "../../src/audio/spec.mjs";
import { validateSpriteSpec } from "../../src/sprite/spec.mjs";
import { broken } from "./case.mjs";

const SOUND = { spec: "smak.sound/1", name: "weapons/hit.wav", length: 0.3, layers: [{ kind: "noise" }] };
broken("validateSoundSpec", "a layer of a kind the kit has not", {
  said: /^layers\[0\]\.kind: noise, tone, fm, modes, particles, sample$/,
  broken: () => validateSoundSpec({ ...SOUND, layers: [{ kind: "chime" }] }).errors,
  whole: () => validateSoundSpec(SOUND).errors,
});

const SPRITE = { spec: "smak.sprite/1", sprites: [{ name: "sprites/glow.spr", size: [32, 32], layers: [{ kind: "glow" }] }] }; // prettier-ignore
broken("validateSpriteSpec", "a sprite 30 wide, no multiple of 8", {
  said: /^sprites\[0\]\.size: \[width, height\], multiples of 8 up to \d+$/,
  broken: () => validateSpriteSpec({ ...SPRITE, sprites: [{ ...SPRITE.sprites[0], size: [30, 32] }] }).errors,
  whole: () => validateSpriteSpec(SPRITE).errors,
});
