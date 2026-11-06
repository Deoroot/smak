// The implants and clinics check (levels/rp/implants.mjs checkImplants) broken in one way each: an unknown slot, a
// repeated implant id, one with no name, a refund of more than the price, an effect that does nothing, an unknown
// effect, a regen with no interval, a clinic offering an unknown implant, a clinic with no place, a repeated clinic
// id. The example catalogue and the mtest clinic are the whole twin.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { checkImplants } from "../../levels/rp/implants.mjs";

const dir = join(HERE, "../levels/rp/implants");
const implants = JSON.parse(readFileSync(join(dir, "implants.json"), "utf8"));
const clinics = JSON.parse(readFileSync(join(dir, "smak_rp_mtest.clinics.json"), "utf8"));
const copy = (o) => JSON.parse(JSON.stringify(o));
/** What checkImplants says is wrong (errors only) after `change` is made to copies of the catalogue and the clinics. */
const errors = (change) => {
  const i = copy(implants);
  const c = copy(clinics);
  change?.(i, c);
  return checkImplants(i, c).errors;
};
const whole = () => errors();
const imp = (i, id) => i.implants.find((x) => x.id === id);

broken("checkImplants", "a slot the body does not have", {
  said: /implant 1 \(servos_piernas\) has slot "tail"; the slots are legs, skin, blood, head/,
  broken: () => errors((i) => (imp(i, "servos_piernas").slot = "tail")),
  whole,
});
broken("checkImplants", "an implant id used twice", {
  said: /the implant id placa_dermica is used twice \(implants 3 and 7\)/,
  broken: () => errors((i) => i.implants.push({ ...imp(i, "placa_dermica") })),
  whole,
});
broken("checkImplants", "an implant with no name", {
  said: /implant 6 \(chip_reflejo\) has no name/,
  broken: () => errors((i) => delete imp(i, "chip_reflejo").name),
  whole,
});
broken("checkImplants", "a refund of more than the price", {
  said: /implant 2 \(servos_militares\) refunds 900 but costs 700: installing and removing it again makes money/,
  broken: () => errors((i) => (imp(i, "servos_militares").refund = 900)),
  whole,
});
broken("checkImplants", "a price of 0", {
  said: /implant 3 \(placa_dermica\): price must be a whole number of 1 or more/,
  broken: () => errors((i) => (imp(i, "placa_dermica").price = 0)),
  whole,
});
broken("checkImplants", "an effect the plugin does not have", {
  said: /implant 1 \(servos_piernas\): the effect gravity_pct is not one the plugin has/,
  broken: () => errors((i) => (imp(i, "servos_piernas").effect = { speed_pct: 15, gravity_pct: 20 })),
  whole,
});
broken("checkImplants", "an effect that does nothing", {
  said: /implant 5 \(nanorreparador\) does nothing: its effect has none of speed_pct, armor, regen_hp, damage_pct/,
  broken: () => errors((i) => (imp(i, "nanorreparador").effect = {})),
  whole,
});
broken("checkImplants", "a regeneration with no interval", {
  said: /implant 5 \(nanorreparador\): regen_hp needs regen_every \(seconds\)/,
  broken: () => errors((i) => delete imp(i, "nanorreparador").effect.regen_every),
  whole,
});
broken("checkImplants", "a speed bonus past the plugin's range", {
  said: /implant 1 \(servos_piernas\): speed_pct must be a whole number from 1 to 100/,
  broken: () => errors((i) => (imp(i, "servos_piernas").effect.speed_pct = 250)),
  whole,
});
broken("checkImplants", "a clinic that offers an implant the catalogue does not have", {
  said: /clinic 1 of smak_rp_mtest \(clinica_sur\): offer names the implant ojo_laser, which is not in the catalogue/,
  broken: () => errors((i, c) => (c.clinics[0].offer = ["ojo_laser"])),
  whole,
});
broken("checkImplants", "a clinic with no place to stand", {
  said: /clinic 1 of smak_rp_mtest \(clinica_sur\) has no origin of three numbers/,
  broken: () => errors((i, c) => delete c.clinics[0].origin),
  whole,
});
broken("checkImplants", "two clinics with the same id", {
  said: /the clinic id clinica_sur is used twice on smak_rp_mtest/,
  broken: () => errors((i, c) => c.clinics.push({ ...copy(c.clinics[0]) })),
  whole,
});
