// Layouts of levels/assembly broken in one way each against their style (levels/assembly/styles/house.json): a
// bedroom with no window, a bedroom reached only through another, the entrance opening into a study, a living room
// lit from one side, a study narrower than its kind, a kitchen larger than its kind, a bedroom of two thin arms, the
// entrance off the front; two doors whose leaves sweep the same cells; and descriptions the style refuses: a kind it has not, an area band its kind cannot have.
// The layout is house-02 at seed 2, which keeps every rule of its style: each case is a copy changed in one place.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { layoutOf, checkLayout } from "../../levels/assembly/layout.mjs";
import { readBuilding, checkBuilding } from "../../levels/assembly/building.mjs";
import { loadStyle, checkStyle } from "../../levels/assembly/style.mjs";

const SPEC = JSON.parse(readFileSync(join(HERE, "../levels/specs/house-02.json"), "utf8"));
const d = readBuilding(SPEC);
const style = loadStyle("house");
const whole = layoutOf(SPEC, { seed: 2 });
const copy = (v) => JSON.parse(JSON.stringify(v));
const fails = (l, s = style, desc = d) => checkStyle(l, desc, s).failures;
const warns = (l, s = style, desc = d) => checkStyle(l, desc, s).warnings;
const windowsOf = (l, id) => l.storeyPlans.flatMap((p) => p.edges.filter((e) => e.kind === "window" && e.rooms.includes(id)));
const tightened = (kind, field, value) => {
  const s = structuredClone(style);
  s.kinds[kind][field] = value;
  return s;
};

broken("checkStyle", "a bedroom with no window", {
  said: /room bed3 .*it has no window; a bedroom wants one on an outside wall/,
  broken: () => {
    const l = copy(whole);
    for (const e of windowsOf(l, "bed3")) e.kind = "exterior";
    return fails(l);
  },
  whole: () => fails(whole),
});
broken("checkStyle", "a bedroom reached only through another bedroom", {
  said: /room bed3 .* is reached only through bed2 \(bedroom\); a room is not reached through a private room/,
  broken: () => {
    const l = copy(whole);
    l.doors.find((door) => door.rooms.includes("bed3")).rooms = ["bed2", "bed3"];
    return fails(l);
  },
  whole: () => fails(whole),
});
broken("checkStyle", "a study narrower than its kind's minSide", {
  said: /room study .*its largest rectangle is 3 x 3 cells; a study wants 4 across at least/,
  broken: () => fails(whole, tightened("study", "minSide", 4)),
  whole: () => fails(whole),
});
broken("checkStyle", "a kitchen larger than its kind's area", {
  said: /room kitchen .*: 15 cells; a kitchen is 6-12/,
  broken: () => fails(whole, tightened("kitchen", "maxArea", 12)),
  whole: () => fails(whole),
});
broken("checkStyle", "the entrance opening into a room of a kind no entrance opens into", {
  said: /the entrance opens into hall \(study\); it wants one of hall, living, kitchen/,
  others: true, // a study is private: the gradient closes every room behind it too
  broken: () => fails(whole, style, { ...d, rooms: d.rooms.map((r) => (r.id === "hall" ? { ...r, kind: "study" } : r)) }),
  whole: () => fails(whole),
});
broken("checkStyle", "a living room lit from one side", {
  said: /room living .*its windows are all on the \w+ wall; a living wants light from two sides/,
  broken: () => {
    const l = copy(whole);
    const own = windowsOf(l, "living");
    const keep = own[0].from[1] === own[0].to[1] ? (e) => e.from[1] === e.to[1] && e.from[1] === own[0].from[1] : (e) => e.from[0] === e.to[0] && e.from[0] === own[0].from[0]; // prettier-ignore
    for (const e of own) if (!keep(e)) e.kind = "exterior";
    return warns(l);
  },
  whole: () => warns(whole),
});
broken("checkStyle", "a bedroom of two thin arms", {
  said: /room bed2 .*its largest rectangle \(3 x 5\) holds 15 of its 17 cells \(0\.88\); a room wants 0\.95 at least/,
  broken: () => {
    const s = structuredClone(style);
    s.rules.compact.value = 0.95;
    return warns(whole, s).filter((w) => /room bed2/.test(w));
  },
  whole: () => warns(whole),
});
broken("checkStyle", "the entrance off the front", {
  said: /the entrance stands on the south wall; the front is north/,
  others: true, // turning the front round puts the kitchen before the living room as well
  broken: () => warns(whole, style, { ...d, front: "north" }),
  whole: () => warns(whole),
});

broken("checkStyleBuilding", "a room of a kind the style has not", {
  said: /room study: its kind office is not one of style house's/,
  broken: () => checkBuilding({ ...SPEC, rooms: SPEC.rooms.map((r) => (r.id === "study" ? { ...r, kind: "office" } : r)) }).failures,
  whole: () => checkBuilding(SPEC).failures,
});
broken("checkStyleBuilding", "a room whose area band its kind cannot have", {
  said: /room kitchen: wants 20-24 cells; a kitchen of style house is 6-18 cells/,
  broken: () => checkBuilding({ ...SPEC, rooms: SPEC.rooms.map((r) => (r.id === "kitchen" ? { ...r, area: [20, 24] } : r)) }).failures,
  whole: () => checkBuilding(SPEC).failures,
});

broken("checkLayout", "two doors whose leaves sweep the same cells as they open", {
  said: /door hall-study and door hall-study \(storey 0\) both swing into study over the cells .*; one leaf, open, stands in the other's way/,
  broken: () => {
    const l = copy(whole);
    l.doors.push(copy(l.doors.find((door) => door.rooms.join() === "hall,study")));
    return checkLayout(l).failures;
  },
  whole: () => checkLayout(whole).failures,
});
