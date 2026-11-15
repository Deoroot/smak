// The packs' checkers broken in one way each: the assets pack's prop (packs/assets/prop.mjs makeProp, which
// `node packs/assets/bin.mjs prop` ends in PASS or FAIL by) given a small glTF written in test/fixture-assets.mjs
// that lies on its side where Poly Haven says it stands, and one with more points than one submodel holds that the
// reducer cannot take away. The twins are the same files whole.
import { join } from "node:path";
import { makeProp } from "../../packs/assets/prop.mjs";
import { writePropGltf } from "../fixture-assets.mjs";
import { tmp } from "../helper.mjs";
import { broken } from "./case.mjs";

const REAL = [0.4, 0.4, 1];
const upright = writePropGltf(join(tmp, "broken-prop-upright"));

broken("makeProp", "a file lying on its side where Poly Haven says it stands a metre high", {
  said: /^the file stands 0\.400 m high where Poly Haven says 1\.000 m: it may lie on its side$/,
  broken: () => makeProp(writePropGltf(join(tmp, "broken-prop-lying"), { lying: true }), { name: "lying.mdl", scale: 1, real: REAL }).errors, // prettier-ignore
  whole: () => makeProp(upright, { name: "upright.mdl", scale: 1, real: REAL }).errors,
});

broken(
  "makeProp",
  "600 small closed pieces beside it, 2400 points the reducer cannot take away: more than one submodel holds",
  {
    said: /^not one prop GoldSrc draws at its ease: \d+ triangles on \d+ points: more than one submodel of GoldSrc holds \(2048 points\), so it is in 2 bodyparts$/, // prettier-ignore
    broken: () => makeProp(writePropGltf(join(tmp, "broken-prop-heavy"), { pieces: 600 }), { name: "heavy.mdl", scale: 1 }).errors, // prettier-ignore
    whole: () => makeProp(writePropGltf(join(tmp, "broken-prop-light"), { pieces: 300 }), { name: "light.mdl", scale: 1 }).errors, // prettier-ignore
  },
);

const twins = writePropGltf(join(tmp, "broken-prop-twins"), { twin: true });
broken("makeProp", "a part asked for of a file that holds two objects: the third", {
  said: /^there is no part "3": the file holds 2 \(1: test_prop; 2: test_prop_b\)$/,
  broken: () => { try { makeProp(twins, { name: "third.mdl", scale: 1, part: 3 }); return []; } catch (error) { return [error.message]; } }, // prettier-ignore
  whole: () => { try { makeProp(twins, { name: "second.mdl", scale: 1, part: 2 }); return []; } catch (error) { return [error.message]; } }, // prettier-ignore
});
