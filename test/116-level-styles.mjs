// Level styles (levels/lib/styles.mjs): levels tagged by kind from a table, not from their measures' files;
// each game's measures put in one vocabulary (metres and player heights: 72 units in GoldSrc and Source, 1.8 m
// in Vermintide 2), Left 4 Dead 2's width bracketed, a measure the games take differently banded per game, two
// games of a kind weighed alike, and kinds never pooled. Corpora made here; the repository's own corpora and
// tags read when they are there (levels/ is not in the package).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, sure, near, HERE } from "./helper.mjs";

const LEVELS = join(HERE, "..", "levels");
const LIB = join(LEVELS, "lib", "styles.mjs");

if (existsSync(LIB)) {
  const S = await import(new URL(`file:///${LIB.replace(/\\/g, "/")}`).href);

  // a GoldSrc map in units, as survey-goldsrc.mjs writes it (only what the bands read)
  const gold = (name, o = {}) => ({
    name,
    group: o.group,
    reachedShare: o.reached ?? 0.8,
    area: 1000000,
    width: { median: o.width ?? 72, p5: 36, p95: 288 },
    narrowShare: 0.1,
    wideShare: 0.5,
    openSky: o.sky ?? 0,
    headroom: { median: 144 },
    sight: { median: 720 },
    passages: { width: { median: 96 } },
    vertical: { levels: 3, range90: 100 },
    steps: { commonRise: 16 },
    doors: { openings: 2, width: { median: 96 }, height: { median: 112 } },
    crossing: { to: o.to ?? "exit-to-exit", walk: 3600, ratio: 1.5 },
    loops: { tile512: { cycles: o.loops ?? 1 } },
  });
  const l4d2 = (name, o = {}) => ({
    name,
    width: { median: 720, p5: 144, p95: 1440 },
    withPropBoxes: { width: { median: 360, p5: 72, p95: 720 }, sight: { median: 1000 }, narrow: 0.2 },
    sight: { median: 3000 },
    bands: { narrow: 0.05 },
    walkable: { area: 4000000 },
    headroom: { under600: { median: 144 }, corridors: { median: 128 }, underSky: 0.8 },
    vertical: { p5p95: 500 },
    steps: { drops: { median: 72 }, stairRisers: { median: 8 } },
    doors: { openingWidth: { n: 10, median: 56 }, leafHeight: { median: 107 } },
    crossing: { walked: 14400, ratio: 1.6, finale: !!o.finale },
    loops: { alternatives: 2 },
    pacing: { crescendos: [0.6], finale: o.finale ? [0.9] : [] },
  });
  const vt2 = (name, width = 1.8) => ({
    name,
    reachedArea: 20000,
    width: { median: width, p5: 1, p95: 10 },
    narrowShare: 0.25,
    wideShare: 0.35,
    pathWidth: { median: 5 },
    openings: { width: { median: 2.2 } },
    vertical: { levels: 12, range90: 50 },
    crossing: { walk: 1200, ratio: 2.4, winding100: { median: 1.5 } },
    loops: { tile512: { cycles: 6 } },
    routes: { crossroads: 0, islandShare: 0.3 },
    pacing: { bossAt: [0.3, 0.7], events: 12, ledgeDrop: { median: 3.6 }, openSpacing: { median: 80 } },
  });
  const tags = {
    kinds: { "coop-campaign": "", linear: "", arena: "", exploration: "" },
    groups: { "hl/valve_sp": "linear", "hl/valve_dm": "arena", "hl/cstrike": null, msr: "exploration", l4d2: "coop-campaign", vt2: "coop-campaign" }, // prettier-ignore
    groupsLeftOut: { "hl/cstrike": "not asked" },
    settings: { msr: { dungeon: ["crypt"], town: ["burg"] } },
    exclude: { "msr/soccer": "a minigame" },
  };
  const corpora = {
    hl: {
      maps: [
        gold("c1", { group: "valve_sp", to: "farthest" }),
        gold("c2", { group: "valve_sp" }),
        gold("dm1", { group: "valve_dm", to: "farthest" }),
        gold("boxed", { group: "valve_sp", reached: 0.02 }),
        gold("cs1", { group: "cstrike" }),
      ],
    },
    msr: {
      maps: [
        gold("crypt"),
        gold("burg", { sky: 0.7 }),
        gold("field", { sky: 0.8 }),
        gold("cave", { sky: 0.05 }),
        gold("soccer"),
      ],
    },
    l4d2: { maps: [l4d2("a"), l4d2("b"), l4d2("c"), l4d2("f", { finale: true })] },
    vt2: { maps: [vt2("x", 10)] },
  };

  test("styles: levels tagged from the table, groups and maps left out with a reason, settings by table or measure", () => {
    const rows = S.tagLevels(corpora, tags);
    const by = (g, n) => rows.find((r) => r.game === g && r.name === n);
    sure(
      by("hl", "c1").kind === "linear" && by("hl", "dm1").kind === "arena",
      "HL campaign linear, deathmatch arena",
    );
    sure(by("hl", "cs1").left === "not asked", "a group tagged null is left out, with its reason");
    sure(/boxed in/.test(by("hl", "boxed").left ?? ""), "a walk that reached 2 % is left out");
    sure(by("msr", "soccer").left === "a minigame", "a map excluded by the table");
    sure(
      by("msr", "crypt").setting === "dungeon" && by("msr", "crypt").settingFrom === "table",
      "setting by table",
    );
    sure(
      by("msr", "field").setting === "outdoors" && by("msr", "field").settingFrom === "measure",
      "setting by sky",
    );
    sure(by("msr", "cave").setting === "dungeon", "a roofed map is a dungeon by measure");
    sure(by("vt2", "x").kind === "coop-campaign" && by("vt2", "x").engine === "vt2", "VT2 a co-op campaign");
    sure(!("kind" in corpora.hl.maps[0]), "the corpus is not written to");
  });

  test("styles: one vocabulary, metres and player heights; L4D2's width bracketed; finales out of the crossing", () => {
    const { kinds } = S.styleBands(corpora, tags);
    const lin = kinds.linear.bands;
    near(lin.width.band.median, 1.829, 0.01, "72 units are 1.83 m");
    near(lin.width.ph.median, 1, 0.01, "and one player height");
    sure(lin.crossing.band.n === 1, "a linear map's crossing from no way out is not a route");
    sure(kinds.arena.bands.crossing.band.n === 1, "an arena's start-to-farthest is");
    const coop = kinds["coop-campaign"].bands;
    sure(coop.width.bracketed.join() === "l4d2", "L4D2 brackets width");
    near(coop.width.bySource.l4d2.median, 360 * 0.0254, 0.01, "the band takes the dressed width");
    near(coop.width.bySource.l4d2.bare.median, 720 * 0.0254, 0.01, "the bare beside it");
    near(coop.width.bySource.vt2.ph.median, 10 / 1.8, 0.01, "VT2's player is 1.8 m");
    sure(
      coop.crossing.bySource.l4d2.n === 3 && coop.crossing.bySource.l4d2.of === 4,
      "the finale is not a crossing",
    );
    sure(
      coop.headroom.lacks.vt2 && coop.headroom.bySource.vt2 === undefined,
      "VT2 lacks headroom, and says why",
    );
    sure(
      coop.alternativeRoutes.band === null && coop.alternativeRoutes.pooled === false,
      "routes counted apart",
    );
    sure(Object.keys(coop.alternativeRoutes.bySource).join() === "l4d2,vt2", "each game's own count kept");
  });

  test("styles: two games of a kind weigh alike; kinds never pooled; settings banded only when there are enough", () => {
    // three maps of one game against one of another's: the one weighs as much as all three
    near(
      S.weightedQuantile(
        [
          [0, 1 / 3],
          [0, 1 / 3],
          [0, 1 / 3],
          [10, 1],
        ],
        0.5,
      ),
      2.5,
      1e-9,
      "weighted median",
    );
    near(
      S.weightedQuantile(
        [
          [1, 1],
          [2, 1],
          [3, 1],
        ],
        0.5,
      ),
      2,
      1e-9,
      "the plain median",
    );
    const res = S.styleBands(corpora, tags);
    const { kinds } = res;
    // four L4D2 maps at 9.144 m, a quarter each (at 1/8 to 7/8 of their half), and VT2's one at 10 m (at 3/4)
    near(kinds["coop-campaign"].bands.width.band.median, 9.144 + 0.856 * 0.2, 0.01, "between the two games");
    for (const [k, e] of Object.entries(kinds))
      for (const m of Object.values(e.bands))
        for (const g of Object.keys(m.bySource ?? {}))
          sure(
            e.sources.some((s) => s.game === g),
            `${k} holds only its own games' maps (${g})`,
          );
    sure(
      Object.keys(kinds.arena.bands.width.bySource).join() === "hl",
      "the arena holds HL deathmatch alone here",
    );
    const ex = kinds.exploration;
    sure(ex.n === 4 && ex.settings.dungeon.n === 2 && ex.settings.dungeon.tooFew, "two dungeons are too few");
    sure(ex.gaps.some((g) => g.key === "branches") && !ex.gaps.some((g) => g.key === "eventsPerKm"), "gaps");
    const style = S.styleOf(S.STYLES[0], res);
    sure(
      style.kind === "exploration" && style.fallback.kind === "coop-campaign",
      "the fantasy dungeon's kinds",
    );
    sure(/^exploration \(4/.test(style.bandsFrom), "too few dungeons: the kind's bands");
  });

  const tagsFile = join(LEVELS, "styles", "tags.json");
  if (existsSync(tagsFile) && existsSync(join(LEVELS, "corpus", "levels-msr.json")))
    test("styles: the repository's corpora and tags give every kind, MSR's dungeons their own bands", () => {
      const read = (g) => {
        const f = join(LEVELS, "corpus", `levels-${g}.json`);
        return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
      };
      const corp = Object.fromEntries(
        Object.keys(S.CORPORA)
          .map((g) => [g, read(g)])
          .filter(([, c]) => c),
      );
      const real = JSON.parse(readFileSync(tagsFile, "utf8"));
      const { kinds, untagged } = S.styleBands(corp, real);
      sure(!untagged.length, `every level has a kind: ${untagged.join(", ")}`);
      for (const k of Object.keys(real.kinds)) if (kinds[k]) sure(kinds[k].n > 0, `${k} has maps`);
      const ex = kinds.exploration;
      if (ex) {
        sure(ex.settings.dungeon.bands, "MSR's dungeons have bands of their own");
        const w = ex.settings.dungeon.bands.width.band;
        sure(w.p10 <= w.median && w.median <= w.p90, "a band in order");
        sure(w.median > 2 && w.median < 30, `a dungeon's width in metres (${w.median})`);
      }
      // every name in the table is a map of its corpus (a renamed map would be lost)
      for (const [game, settings] of Object.entries(real.settings ?? {}))
        if (corp[game])
          for (const names of Object.values(settings))
            for (const n of names)
              sure(
                corp[game].maps.some((m) => m.name === n),
                `${game}/${n} is in its corpus`,
              );
    });
}
