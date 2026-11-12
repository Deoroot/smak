// What the game's eye shows of a view model, spoiled one way each (test/fixture-viewmodel.mjs: a forearm made from
// nothing, open at its elbow's end), for judgeScreen over screenOf (check/screen.mjs): each must give the one sentence
// of its fault, and the clean model none. `smak motion` says them as WARN lines of a view model.
import * as smak from "../../src/index.mjs";
import { viewModel } from "../fixture-viewmodel.mjs";
import { broken } from "./case.mjs";

const faultsOf = (way) => smak.judgeScreen(smak.screenOf(viewModel(way).mdl, { seq: "swing" })).faults;

const CASES = [
  ["cover", "a fist of a box before the eye, half the screen", /^screen: swing: frames 0 to 6, the mesh covers up to 4\d% of a 16:9 screen \(frame \d\), over the 35%/],
  ["open", "the forearm's open end turned to the eye in the middle of the screen", /^screen: swing: frames? [\d ,to]+, the player sees into forearm's mesh through its open end, about \d+% across and \d+% down \(middle\)/],
  ["near", "the forearm pulled through the near plane where the screen shows it", /^screen: swing: frames? [\d ,to]+, forearm's mesh crosses the near plane \(4 units from the eye\) on the screen/],
];
for (const [way, defect, said] of CASES) broken("judgeScreen", defect, { said, broken: () => faultsOf(way), whole: () => faultsOf("clean") });
