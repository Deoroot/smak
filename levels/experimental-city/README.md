# levels/experimental-city: the city generator, paused

The first way SMAK made maps from a description: stages 1 to 10 computing every brush of New Byzantium's tiles
(`ARTIFACTS.md` has the contract). Paused on 2026-11-02 after the first build was walked in H9's Xash client
(PLAN.md, Phase 3, "Paused"): a good attempt whose cost did not give good results. Kept as a test case and a source
of parts, not offered as a feature. Moved here from `levels/gen` the same day so that work on the new method,
`levels/assembly` (authored pieces joined by typed connectors), is not confused with it.

What the new method may still take from here: nothing by import. Its rules in `levels/rules/architecture.json` were
written for this city (a `hall` there is a great public hall, not a house's entry): take a rule into a style's own
rulebook with its source, never the whole file. Tests 126 and 130 failed before the move (and 122, as PLAN.md says).
