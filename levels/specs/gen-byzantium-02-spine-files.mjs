#!/usr/bin/env node
// The files of the Spine beside its map that the RP plugins read, written from the build's <map>.rp.json (their origins are the
// places of the compiled map): levels/rp/items/smak_rp_byz02s.shops.json (8 shops), levels/rp/jobs/smak_rp_byz02s.jobs.json (4 job
// offices (the 3 jobs of the plan: stalls, courier, clinic; and the gate's)), levels/rp/law/smak_rp_byz02s.law.json (5 stations, one a post), levels/rp/doors/smak_rp_byz02s.doors.json (the 30 homes' prices and rents) and levels/rp/implants/smak_rp_byz02s.clinics.json (the dispensary). Run: node levels/specs/gen-byzantium-02-spine-files.mjs <rp.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "../rp");
const rp = JSON.parse(readFileSync(process.argv[2], "utf8"));
const MAP = rp.map;
// the map is recentred (the spec's `recentre`: the site's frame moved by this, so that it stands inside +-4096): the places read from the
// build's rp.json are already in the map's frame, a point written here from the site's is moved by it
const SHIFT = JSON.parse(readFileSync(join(HERE, "../specs/byzantium-02-spine.json"), "utf8")).recentre;
const STALL = [480 + SHIFT[0], 1056 + SHIFT[1], 36];
const place = (id) => {
  const p = rp.places.find((q) => q.id === id);
  if (!p) throw new Error(`no place ${id} in ${MAP}`);
  return [p.at[0], p.at[1], p.at[2] + 36];
};
const shop = (id, name, origin, stock, buys, radius = 200) => ({ id, name, origin, radius, stock, buys });
const shops = {
  format: "smak-shops/1",
  map: MAP,
  note: "Eight shops of the Spine at the places smak_npc stands its keepers in (rp.json places: general_shop, clinic_clinic, bar_bar, pawn_shop, casino_shop, betting_shop, blackmkt_shop) and a stall on the Market plaza. Origins are the places' floor points + 36. Buy-back prices never exceed the cheapest sale price of the item in any shop.",
  shops: [
    shop("mercado", "Puesto del Foro Menor", place("general_shop"), ["vendaje", "estimulante", "chatarra", "papeles_residencia"], ["vendaje", { item: "chatarra", price: 3 }]),
    shop("dispensario", "Dispensario del Hilo de Bronce", place("clinic_clinic"), [{ item: "vendaje", price: 12 }, "botiquin", { item: "estimulante", price: 55 }], [{ item: "vendaje", price: 5 }, { item: "botiquin", price: 15 }]),
    shop("cantina", "Cantina del Foro", place("bar_bar"), [{ item: "estimulante", price: 70 }, { item: "vendaje", price: 18 }], [{ item: "chatarra", price: 3 }]),
    shop("empeno", "Casa de Empeno de la Calle Baja", place("pawn_shop"), [{ item: "chatarra", price: 10 }, { item: "glock18", price: 320 }, { item: "ganzua", price: 70 }], [{ item: "glock18", price: 100 }, { item: "chatarra", price: 4 }, { item: "ganzua", price: 20 }]),
    shop("casino", "Casino del Hipodromo", place("casino_shop"), [{ item: "estimulante", price: 80 }, { item: "vendaje", price: 20 }], [{ item: "chatarra", price: 4 }]),
    shop("apuestas", "Casa de Apuestas de los Azules", place("betting_shop"), [{ item: "vendaje", price: 18 }, { item: "papeles_residencia", price: 60 }], [{ item: "chatarra", price: 3 }]),
    shop("mercado_negro", "Mercado Negro de la Hondonada", place("blackmkt_shop"), [{ item: "ganzua", price: 80 }, { item: "glock18", price: 340 }, { item: "estimulante", price: 75 }], [{ item: "glock18", price: 120 }, { item: "botiquin", price: 20 }, { item: "estimulante", price: 25 }]),
    shop("puesto", "Puesto del Foro (a cielo abierto)", STALL, [{ item: "vendaje", price: 16 }, { item: "chatarra", price: 11 }], [{ item: "chatarra", price: 4 }], 160),
  ],
};
const jobs = {
  format: "smak-jobsites/1",
  map: MAP,
  sites: [
    { id: "oficina_puestos", name: "Oficina de los puestos del Foro", origin: STALL, radius: 160, jobs: ["comerciante"] },
    { id: "oficina_mensajeria", name: "Mensajeria del Hipodromo", origin: place("betting_shop"), radius: 160, jobs: ["mensajero"] },
    { id: "oficina_dispensario", name: "Dispensario: plaza de medico", origin: place("clinic_clinic"), radius: 160, jobs: ["medico"] },
    // (the employment office of the plan's Gate 2 post: the regime's own jobs)
    { id: "oficina_p2", name: "Oficina de empleo de la Puerta Segunda", origin: place("p2_counter"), radius: 140, jobs: ["guardia", "mecanico"] },
  ],
};
const station = (id, name, post) => ({ id, name, origin: place(`${post}_counter`), radius: 140 });
const law = {
  format: "smak-law/1",
  map: MAP,
  stations: [
    station("puesto_p2", "Puesto de la Puerta Segunda (P2)", "p2"),
    station("puesto_p5", "Guardia Oeste del Hipodromo (P5)", "p5"),
    station("puesto_p8", "Carcel de la Hondonada (P8)", "p8"),
    station("puesto_p11", "Puesto del Camino de la Muralla Este (P11)", "p11"),
    station("puesto_p12", "Puesto del Foro (P12)", "p12"),
  ],
};
// The dispensary: smak_implants' clinic (the surgeon's chair) stands where its keeper does, as byz01's does.
const clinics = {
  format: "smak-clinics/1",
  map: MAP,
  clinics: [{ id: "dispensario", name: "Dispensario del Hilo de Bronce", origin: place("clinic_clinic"), radius: 160 }],
};
// The homes for sale and for rent. A flat is priced by its size (the spec's flatArea, in cells of 64, middle of the range) and its district
// (a price a cell: the Hippodrome dearest, the Market, the Hollow's towers and the flats over the black market cheapest); a tenement room has
// no stated area, 8 cells. Buying is 20 rents; rent is for 7 days. Homes are listed by the rp.json's order. The checkpoints are gates.
const spec = JSON.parse(readFileSync(join(HERE, "../specs/byzantium-02-spine.json"), "utf8"));
const PER_CELL = { market: 110, hippodrome: 135, hollow: 55 };
const BUILDING = { clinic: "el Dispensario", pawn: "la Casa de Empeno", bar: "la Cantina", general: "el Almacen", casino: "el Casino", betting: "las Apuestas", blackmkt: "el Mercado Negro" };
const round = (v, to) => Math.max(to, Math.round(v / to) * to);
const homes = rp.properties.filter((p) => p.kind === "home").map((p) => {
  const b = spec.buildings.find((q) => q.id === p.building);
  const cells = b?.flatArea ? (b.flatArea[0] + b.flatArea[1]) / 2 : 8;
  const price = round(cells * PER_CELL[p.district ?? "market"], 50);
  const rent = round(price / 20, 5);
  const n = p.id.match(/([0-9]+)$/)?.[1] ?? "";
  const name = BUILDING[p.building] ? `Piso ${n} sobre ${BUILDING[p.building]}` : `Cuarto ${n} de la Torre ${p.building.replace(/[^0-9]/g, "")}`;
  return { id: p.id, name, price, rent, rent_days: 7 };
});
const doors = {
  format: "smak-doors/1",
  map: MAP,
  note: "Homes cost 'price' to buy for good, or 'rent' for 'rent_days' real days (0 = not offered). Priced by size (the flat area of the spec) and district: a price a cell of 110 in the Market, 135 in the Hippodrome, 55 in the Hollow; rent a twentieth. A property may set \"policy\": open, key, guard or gate; the default follows its kind (home key, police and jail guard, gate gate, the rest open). Shops, public stairs and halls are open, the posts' rooms guard. Written by levels/specs/gen-byzantium-02-spine-files.mjs.",
  defaults: { home: { price: 1500, rent: 75, rent_days: 7 } },
  properties: [...homes, ...rp.properties.filter((p) => p.kind === "gate").map((p) => ({ id: p.id, policy: "gate" }))],
};
for (const [file, data] of [[`items/${MAP}.shops.json`, shops], [`jobs/${MAP}.jobs.json`, jobs], [`law/${MAP}.law.json`, law], [`doors/${MAP}.doors.json`, doors], [`implants/${MAP}.clinics.json`, clinics]]) {
  writeFileSync(join(HERE, file), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote levels/rp/${file}`);
}
