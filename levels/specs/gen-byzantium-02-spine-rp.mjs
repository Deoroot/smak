// The role-play layer of the Spine that the site's spec carries: four mission arenas under the city (z -3200, as the design
// says: inside +-4096, out of the way of S1), their givers on the streets, the four missions, and the districts' quotas of
// citizens (the virtual roster of smak_npc: 24 people for a slice this size). The shops, jobs, stations and dialogue are the
// four files beside the map (levels/rp/{items,jobs,law,scripts}/smak_rp_byz02s.*.json).
const NAME = "smak_rp_byz02s";
const t = (arena, what) => `${NAME}_arena_${arena}_${what}`;
export const rp = {
  arenas: [
    { id: "smuggle", plan: "yard", at: [0, 0, -3200], size: [1024, 768, 256], back: [[2112, 480, 180], [2176, 480, 180]] },
    { id: "courier", plan: "room", spawns: 2, at: [2560, 0, -3200], size: [512, 512, 192], back: [[2848, 1400, 90], [2912, 1400, 90]] },
    { id: "debt", plan: "vault", at: [1280, 0, -3200], size: [1024, 768, 256], back: [[2200, 1888, 270], [2264, 1888, 270]] },
    { id: "heist", plan: "tunnel", at: [0, 1024, -3200], size: [1536, 896, 192], back: [[3872, 800, 180], [3872, 864, 180]] },
  ],
  rp: {
    quotas: { market: 10, hippodrome: 7, hollow: 7 },
    npcs: [
      { id: "broker", name: "Ilias el Intermediario", model: "models/player/proletarian_dirty/proletarian_dirty.mdl", at: [352, 800, 0], yaw: 90, gives: ["smuggle_job"] },
      { id: "courier", name: "Mara la Mensajera", model: "models/player/prole_bfem/prole_bfem.mdl", at: [2848, 672, 0], yaw: 90, gives: ["courier_job"] },
      { id: "debtor", name: "Basilio el Cobrador", model: "models/player/merc/merc.mdl", at: [2336, 1888, 0], yaw: 270, gives: ["debt_job"] },
      { id: "insurgent", name: "Ireneo el Insurgente", model: "models/player/ins_medic/ins_medic.mdl", at: [4000, 928, 0], yaw: 180, gives: ["heist_job"] },
    ],
    missions: [
      {
        id: "smuggle_job", title: "Contrabando para el Hipodromo", giver: "broker", arena: "smuggle", party: [1, 4], time: 240,
        steps: [
          { do: "destroy", target: t("smuggle", "crate1"), say: "Rompe la primera caja del almacen: el cargamento no figura en el registro." },
          { do: "destroy", target: t("smuggle", "crate2"), say: "Ahora la segunda caja, junto al muelle este." },
          { do: "destroy", target: t("smuggle", "crate3"), say: "La tercera esta al fondo, tras las pilas." },
          { do: "reach", target: t("smuggle", "goal"), say: "Sube por la escalera al muelle de carga y pisa la plataforma verde." },
        ],
        done: { say: "Ilias cuenta las monedas y no pregunta nada.", reward: { frags: 2, money: 300 } },
      },
      {
        id: "courier_job", title: "Recado Urgente", giver: "courier", arena: "courier", party: [1, 2], time: 120,
        steps: [
          { do: "reach", target: t("courier", "goal"), say: "Cruza la sala hasta la plataforma verde." },
          { do: "use", target: t("courier", "button"), say: "Pulsa el interruptor de la pared este." },
        ],
        done: { say: "Mara guarda el mensaje y te da unas monedas.", reward: { frags: 1, money: 150 } },
      },
      {
        id: "debt_job", title: "La Boveda de la Puerta", giver: "debtor", arena: "debt", party: [1, 4], time: 240,
        steps: [
          { do: "use", target: t("debt", "button"), say: "Pulsa el boton junto a la puerta de la boveda. Se cierra sola a los veinte segundos." },
          { do: "reach", target: t("debt", "goal"), say: "Cruza la puerta y llega a la plataforma verde del fondo." },
          { do: "destroy", target: t("debt", "crate"), say: "Revienta el cofre del deudor." },
        ],
        done: { say: "Basilio tacha un nombre de su lista y te paga.", reward: { frags: 3, money: 450 } },
      },
      {
        id: "heist_job", title: "La Cisterna de los Datos", giver: "insurgent", arena: "heist", party: [1, 4], time: 300,
        steps: [
          { do: "use", target: t("heist", "button"), say: "Sigue el conducto hasta la mitad y acciona la valvula." },
          { do: "reach", target: t("heist", "goal"), say: "Sigue hasta la camara del fondo y pisa la plataforma verde." },
          { do: "survive", time: 45, say: "Aguanta en la camara cuarenta y cinco segundos mientras Ireneo despeja el paso." },
        ],
        done: { say: "Ireneo sonrie: la Hondonada te debe un favor y algo de dinero.", reward: { frags: 3, money: 400 } },
      },
    ],
  },
};
