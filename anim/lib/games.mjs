// The shipped games' blows, as this machine has them, for the tools that compare games (anim/tools/defects.mjs,
// anim/tools/styles.mjs): each game's melee attacks with what `measure` needs to read them. Nothing of a game's
// is written anywhere: the tools keep only the measures. "vt2" is Vermintide 2, read from anim/vt2/'s local cache
// (anim/lib/vt2.mjs); its `buf` is a model.
//
//   for (const b of gameBlows(["msr", "l4d2"])) measure(b.buf, b.opts)
//
// Each blow: { game, model, seq, family, buf, opts, weight }. `weight` shares one sequence's weight among the
// submodels it is shown with (MSR's v_1hswords plays one attack for many swords). "bad" is the bad set
// (anim/tools/badset.mjs), MSR's short sword spoiled one known fault at a time.
import { readFileSync, existsSync } from "node:fs";
import { meleeBlows, viewModel, VIEWMODELS } from "./corpus.mjs";
import { sourceViewModel, asModel } from "./model.mjs";
import { sourceFiles } from "../../src/source/draw.mjs";
import { vt2Blows } from "./vt2.mjs";

export const GAMES = ["vt2", "msr", "hl", "ts", "l4d2"];
const HL = "C:/Juegos/Steam/steamapps/common/Half-Life/valve/models";
const TS = "C:/Juegos/TS30-clean/models";
const L4D2 = "C:/Juegos/Steam/steamapps/common/Left 4 Dead 2";
const BAD = "build/anim/bad";
/** The Specialists' arms have no names: its hand and forearm bones, as `judge.mjs --arms` takes them. */
const TS_ARMS = { R: { hand: "Bone24", elbow: "Bone23" }, L: { hand: "Bone02", elbow: "Bone01" } };
const L4D2_MELEE = ["bat", "cricket_bat", "crowbar", "fireaxe", "katana", "machete", "frying_pan", "electric_guitar", "tonfa", "golfclub", "shovel", "pitchfork"];
const L4D2_TWO_HANDED = /fireaxe|bat|katana|guitar|shovel|pitchfork|golf/;
/** Each weapon's family, as MSR's are kept (judge.mjs FAMILIES), for the other games. */
const FAMILY = {
  v_crowbar: "blunts", v_katana: "2h swords", v_knife: "smallarms", v_sealknife: "smallarms", v_melee: "martial arts",
  v_bat: "blunts", v_cricket_bat: "blunts", v_fireaxe: "axes", v_machete: "1h swords", v_frying_pan: "blunts",
  v_electric_guitar: "blunts", v_tonfa: "blunts", v_golfclub: "blunts", v_shovel: "polearms", v_pitchfork: "polearms",
}; // prettier-ignore

/** The blows of `games` (some of GAMES, and "bad"); a game not installed is left out, said through `log`. */
export function* gameBlows(games = GAMES, { log = console.log } = {}) {
  if (games.includes("vt2")) for (const b of vt2Blows({ log })) yield { ...b, model: b.info.template, buf: b.model };
  if (games.includes("msr")) {
    if (!existsSync(VIEWMODELS)) log(`msr: not at ${VIEWMODELS}, left out`);
    else {
      const bufs = new Map();
      for (const e of meleeBlows()) {
        if (!bufs.has(e.model)) bufs.set(e.model, viewModel(e.model));
        const twoHanded = e.family === "2h swords" || e.family === "polearms" || /^v_2h/.test(e.model) ? true : undefined;
        yield { game: "msr", model: e.model, seq: e.seqName, family: e.family, buf: bufs.get(e.model), weight: e.weight, opts: { bodypart: e.bodypart, submodel: e.submodel, seq: e.seq, fist: e.family === "martial arts", twoHanded } };
      }
    }
  }
  if (games.includes("hl")) {
    if (!existsSync(HL)) log(`hl: not at ${HL}, left out`);
    else {
      const buf = readFileSync(`${HL}/v_crowbar.mdl`);
      for (const seq of ["attack1", "attack2", "attack3"]) yield { game: "hl", model: "v_crowbar", seq, family: FAMILY.v_crowbar, buf, weight: 1, opts: { seq } };
    }
  }
  if (games.includes("ts")) {
    if (!existsSync(TS)) log(`ts: not at ${TS}, left out`);
    else
      for (const [model, fist] of [["v_katana", false], ["v_knife", false], ["v_sealknife", false], ["v_melee", true]]) {
        const buf = readFileSync(`${TS}/${model}.mdl`);
        // a throw lets go of the weapon on purpose, and a block or a hold is no blow
        for (const s of asModel(buf).sequences.filter((s) => !/idle|draw|holster|select|throw|hold|block/i.test(s.name)))
          yield { game: "ts", model, seq: s.name, family: FAMILY[model], buf, weight: 1, opts: { seq: s.name, fist, arms: TS_ARMS } };
      }
  }
  if (games.includes("l4d2")) {
    if (!existsSync(L4D2)) log(`l4d2: not at ${L4D2}, left out`);
    else {
      const files = sourceFiles({ vpks: [`${L4D2}/update/pak01_dir.vpk`, `${L4D2}/left4dead2/pak01_dir.vpk`] });
      for (const name of L4D2_MELEE) {
        const anim = `models/weapons/melee/v_${name}.mdl`;
        const M = sourceViewModel({ files, anim, meshes: [anim, "models/weapons/arms/v_arms_coach_new.mdl"] });
        for (const s of M.sequences.filter((s) => /swing|attack|strong/i.test(s.name) && !/layer/i.test(s.name)))
          yield { game: "l4d2", model: `v_${name}`, seq: s.name, family: FAMILY[`v_${name}`], buf: M, weight: 1, opts: { seq: s.name, aspect: 16 / 9, twoHanded: L4D2_TWO_HANDED.test(name) || undefined } };
      }
    }
  }
  if (games.includes("bad")) {
    if (!existsSync(`${BAD}/manifest.json`)) log(`bad: no ${BAD}/manifest.json (node anim/tools/badset.mjs), left out`);
    else {
      const buf = readFileSync(`${BAD}/v_1hswords_bad.mdl`);
      for (const e of JSON.parse(readFileSync(`${BAD}/manifest.json`, "utf8")).sequences)
        yield { game: "bad", model: e.fault, seq: e.seq, family: "1h swords", buf, weight: 1, opts: { seq: e.seq } };
    }
  }
}
