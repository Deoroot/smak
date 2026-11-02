// Stage 7, the RP wiring contract (PLAN.md Phase 3, "The RP wiring contract"): what the map promises the game, in
// names. Every door named with its owner group, building, unit, zone, the key that opens it, use-only and lockable;
// the zones (every building, district, public way, plaza and MSR area); the spawn groups in entity order; the cells
// with their doors; the switches with their targets (lamps, sounds, the alarm, the checkpoints' gates); the lifts
// with their stops and call buttons; the secrets with their doors; and the entities the tile keeps. Neutral: no RP
// plugin's format (levels/gen/wiring-apollo.mjs turns it into one). Writes 07-wiring.json.
//
// Written rules:
// - Names. A property door keeps stage 5's name (housing.doorNaming: {building}_{unit} a home, {building} a
//   business, {place}_cell{n} a cell, the secret's id a secret door). Every other door is named after the key that
//   opens it, `{key}_i{n}` in stage 5's door order; its key is the property name of the unit of the room it opens
//   into (the room it leaves when it opens onto the street), else its building's id. A checkpoint's doors:
//   `{checkpoint}_gate` (`_gate_b` ... a gate room), `{checkpoint}_post` (`_post_b` a second), `{checkpoint}_cell{n}`.
//   A secret connector's or secret passage's hatch at each end in the tile: `{id}_a`, `{id}_b` by its stop. Lights
//   `lt_{tile}_{nn}`, sound targets `snd_{tile}_{nn}`, switches `sw_{tile}_{nn}`, the city alarm `alarm_city`
//   (one name every speaker shares), a lift its connector's id, its stops `{lift}_s{n}`, its call buttons
//   `{lift}_call{n}`. Tile ids lose their underscore in names (c1r1).
// - Owner group: the unit's (home residents, business business, msr msr, public city, insurgent insurgents); a
//   shared room's: residents when every unit on its storey is a home, else the building's owner; checkpoints and
//   MSR connectors msr; public connectors city.
// - Use-only: every door (spawnflag 256). Lockable: property doors, cells, gates and posts, and inner doors into a
//   room of the rulebook's private, secure or staff zone; never a secret door or a hatch.
// - Switches: one a switchable light (06), one a switchable sound (06) up to the tile's share of wiring.switches
//   less the lights, gates and alarms, one opening each checkpoint's gates from its guard post, and the alarm
//   (wiring.alarms, a count for the city: only in the tile of the MSR's Nexus) in the MSR building's briefing room
//   or guard post nearest the tile's first, sounding every alarm speaker (each tile's speakers carry its name).
//   Each on the wall beside its room's entrance door, facing into the room, at the rulebook's
//   typical height: dressing.mjs's switchSpots (latch side first, the spot stage 8 keeps clear; a room's second
//   switch SWITCH_STEP further along). A checkpoint's guard post folded into a building is that 05 room; one
//   standing alone (no plan, no door yet) takes its wall facing the gate, beside the middle, facing in.
// - Checkpoint rooms stage 3 folded into a building (05's room carries the checkpoint) are named once: their door
//   is 05's (a holding cell's keeps {checkpoint}_cell{n}, the guard post's own door its 05 name), listed with the
//   checkpoint; no second door is made for them.
// - Entities that stay: doors and hatches, buttons (switches and call buttons), each lift's train and stops, the
//   switchable lights (untargeted lights are freed at compile), every looping sound, spawns, the signs (one
//   func_wall a signed building); held to the tile's share of engine.limits.entities.
import { r3, rectCentre } from "./geom.mjs";
import { tileBox, districtAt, tileAt } from "./site.mjs";
import { metreRules } from "./stage3-programs.mjs";
import { tileBudget } from "./stage6-palette.mjs";
import { roomFloor, roomDoors, switchSpots, modelPropCap } from "./dressing.mjs";

const OWNER_OF_UNIT = { home: "residents", business: "business", msr: "msr", public: "city", insurgent: "insurgents" };
const LOCK_ZONES = new Set(["private", "secure", "staff"]);
const PROPERTY_KINDS = new Set(["house", "shop", "public", "gate", "cell"]);
const NAME_RE = /^[A-Za-z0-9_]+$/;

const boxOfRects = (rs) => [Math.min(...rs.map((r) => r.x)), Math.min(...rs.map((r) => r.y)), Math.max(...rs.map((r) => r.x + r.w)), Math.max(...rs.map((r) => r.y + r.d))].map(r3); // prettier-ignore
const boxOfPts = (ps) => [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))].map(r3); // prettier-ignore
const nearestOnRect = (r, p) => [Math.max(r.x, Math.min(r.x + r.w, p[0])), Math.max(r.y, Math.min(r.y + r.d, p[1]))];

export const stage = {
  n: 7,
  name: "wiring",
  reads: ["description", "rulebook", "01-site.json", "02-lots.json", "03-programs.json", "04-network.json", "05-plans.json", "06-palette.json"], // prettier-ignore
  run(ctx) {
    const desc = ctx.description;
    const rules = metreRules(ctx);
    const tile = ctx.params.tile;
    const T = tile.replace("_", "");
    const site = ctx.inputs["01-site.json"];
    const lots = ctx.inputs["02-lots.json"];
    const net = ctx.inputs["04-network.json"];
    const plans = ctx.inputs["05-plans.json"];
    const pal = ctx.inputs["06-palette.json"];
    const cell = desc.grid.cell;
    const bOf = Object.fromEntries(desc.buildings.map((b) => [b.id, b]));
    const lotOf = Object.fromEntries(lots.lots.filter((l) => l.building).map((l) => [l.building, l]));
    const nodeOf = Object.fromEntries(site.nodes.map((n) => [n.id, n]));
    const layerOf = Object.fromEntries(site.layers.map((L) => [L.id, L]));
    const doorTex = {};
    for (const t of pal.things) if (t.kind === "door" || t.kind === "checkpoint") doorTex[t.id] = (t.slots.door ?? t.slots.wall)?.texture ?? null; // prettier-ignore

    // ── zones ──
    const zones = [];
    const zoneOf = {};
    const layerZ = (L) => [layerOf[L]?.floor ?? layerOf[L]?.z?.[0] ?? 0, layerOf[L]?.top ?? (layerOf[L]?.floor ?? 0) + 4];
    const addZone = (id, kind, ref, layer, box, owner, extra = {}) => {
      zones.push({ id, kind, ref, layer, box, owner, ...extra, z: (extra.z ?? layerZ(layer)).map(r3) });
      zoneOf[ref] = id;
    };
    const tbox = tileBox(desc, tile);
    for (const d of desc.districts) {
      const [x0, y0, x1, y1] = d.area;
      const box = [Math.max(x0, tbox[0]), Math.max(y0, tbox[1]), Math.min(x1, tbox[2]), Math.min(y1, tbox[3])];
      if (box[0] >= box[2] || box[1] >= box[3] || !layerOf[d.layer]) continue;
      addZone(`z_${d.id}`, "district", d.id, d.layer, box, "city", { name: d.name });
    }
    for (const w of site.ways) {
      if (!w.lengthInTile) continue;
      const pts = w.parts.flat();
      const pad = w.width / 2;
      const b = boxOfPts(pts);
      const box = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad].map(r3);
      if (w.class === "service") addZone(`z_${w.id}`, "msr", w.id, w.layer, box, "msr", { of: "service hallway" });
      else addZone(`z_${w.id}`, "way", w.id, w.layer, box, "city", { name: w.name ?? null, district: w.district });
    }
    for (const p of site.plazas) if (p.tile === tile) addZone(`z_${p.id}`, "plaza", p.id, p.layer, p.box, "city", { name: p.name ?? null }); // prettier-ignore
    for (const b of plans.buildings) {
      const l = lotOf[b.id];
      const r = l?.rect ?? b.lot?.rect;
      const z0 = l?.zBase ?? 0;
      const z1 = z0 + (b.storeys?.length ?? bOf[b.id].storeys ?? 1) * ((b.frame?.storeyHeight_m ?? 4.877) / cell);
      addZone(`z_${b.id}`, "building", b.id, b.layer, [r.x, r.y, r.x + r.w, r.y + r.d].map(r3), bOf[b.id].owner, { district: bOf[b.id].district, name: bOf[b.id].name ?? null, z: [z0, z1] }); // prettier-ignore
    }
    for (const cp of net.checkpoints) addZone(`z_${cp.id}`, "msr", cp.id, cp.layer, boxOfRects(cp.rooms.map((r) => r.rect)), "msr", { of: "checkpoint" }); // prettier-ignore
    for (const p of net.posts) addZone(`z_${p.id}`, "msr", p.id, p.layer, [p.rect.x, p.rect.y, p.rect.x + p.rect.w, p.rect.y + p.rect.d].map(r3), "msr", { of: "post" }); // prettier-ignore

    // ── doors ──
    const doors = [];
    const openings = [];
    const count = {};
    for (const b of plans.buildings) {
      const desB = bOf[b.id];
      const lot = lotOf[b.id];
      const zBase = lot?.zBase ?? 0;
      const sh = (b.frame?.storeyHeight_m ?? 4.877) / cell;
      const unitOf = Object.fromEntries((b.units ?? []).map((u) => [u.id, u]));
      const roomOf = Object.fromEntries(b.rooms.map((r) => [r.id, r]));
      const storeyAllHomes = (storey) => {
        const us = new Set(b.rooms.filter((r) => r.storey === storey && r.unit).map((r) => unitOf[r.unit]?.kind));
        return us.size > 0 && [...us].every((k) => k === "home");
      };
      for (const d of b.doors) {
        if (d.kind === "opening" && !d.name) {
          openings.push({ id: d.id, building: b.id, from: d.from, to: d.to, storey: d.storey });
          continue;
        }
        const inner = roomOf[d.to] ? d.to : roomOf[d.from] ? d.from : null;
        const room = inner ? roomOf[inner] : null;
        const unit = room?.unit ? unitOf[room.unit] : null;
        const owner = unit ? (OWNER_OF_UNIT[unit.kind] ?? desB.owner) : room && storeyAllHomes(room.storey) ? "residents" : desB.owner; // prettier-ignore
        const key = d.kind === "secret" ? d.name : (unit?.door ?? b.id);
        let name = d.name;
        if (!name) {
          count[key] = (count[key] ?? 0) + 1;
          name = `${key}_i${count[key]}`;
        }
        const zone = LOCK_ZONES.has(rules.roomKinds?.[room?.kind]?.zone);
        const property = !!d.name && d.kind !== "secret";
        doors.push({
          name,
          id: d.id,
          source: "05-plans",
          kind: d.kind,
          building: b.id,
          unit: unit?.id ?? null,
          unitClass: unit?.class ?? null,
          room: inner,
          zone: zoneOf[b.id],
          owner,
          key,
          property,
          use: true,
          lockable: d.kind !== "secret" && (property || PROPERTY_KINDS.has(d.kind) || zone),
          at: [r3(d.cells[0]), r3(d.cells[1]), r3(zBase + d.storey * sh)],
          storey: d.storey,
          width_m: d.width,
          texture: doorTex[`door:${d.id}`] ?? null,
        });
      }
    }
    // checkpoints: the gates, the guard post, the holding cells
    const cells = [];
    // stage 4's checkpoint rooms stage 3 folded into a building: the 05 room of that checkpoint and kind over the 04 rect
    const folded = { post: new Map() };
    const foldedOf = (cpId, r) => {
      for (const b of plans.buildings)
        for (const room of b.rooms) {
          if (room.checkpoint !== cpId || room.kind !== r.kind) continue;
          const c0 = room.cells[0];
          const ox = Math.min(c0.x + c0.w, r.rect.x + r.rect.w) - Math.max(c0.x, r.rect.x);
          const oy = Math.min(c0.y + c0.d, r.rect.y + r.rect.d) - Math.max(c0.y, r.rect.y);
          if (ox > 0.05 && oy > 0.05) return { b, room };
        }
      return null;
    };
    for (const cp of net.checkpoints) {
      const post = cp.rooms.find((r) => r.kind === "guard-post");
      const pc = post ? rectCentre(post.rect) : rectCentre(cp.rooms[0].rect);
      let g = 0;
      let c = 0;
      let gp = 0; // guard posts (the front gate has two): the second _post_b, as a second gate is _gate_b
      cp.rooms.forEach((r, i) => {
        const z = r.z?.[0] ?? layerOf[cp.layer]?.floor ?? 0;
        // a room stage 3 folded into a building (05's room carries the checkpoint): named once, by 05's door into it
        const f = foldedOf(cp.id, r);
        // its door: a holding cell's cell door; a guard post's own door onto the street (plans.mjs gives it one facing its gate)
        const own = f && (r.kind === "holding-cell" ? f.b.doors.find((x) => x.to === f.room.id && x.kind === "cell") : r.kind === "guard-post" ? f.b.doors.find((x) => (x.to === f.room.id || x.from === f.room.id) && (x.street || x.from === "street" || x.from === "outside")) : f.b.doors.find((x) => x.to === f.room.id || x.from === f.room.id)); // prettier-ignore
        const d5 = own && doors.find((x) => x.id === own.id);
        if (d5) {
          d5.checkpoint = cp.id;
          if (r.kind === "gate") g++;
          if (r.kind === "holding-cell") {
            c++;
            const c0 = f.room.cells[0];
            cells.push({ name: d5.name, place: cp.id, room: f.room.id, door: d5.name, at: [r3(c0.x + c0.w / 2), r3(c0.y + c0.d / 2), r3(z)] }); // prettier-ignore
          }
          if (r.kind === "guard-post") folded.post.set(cp.id, { b: f.b, room: f.room, door: d5 });
          return;
        }
        let name = null;
        let kind = null;
        let at = rectCentre(r.rect);
        if (r.kind === "gate") (name = `${cp.id}_gate${g ? `_${String.fromCharCode(97 + g)}` : ""}`), (kind = "gate"), g++;
        else if (r.kind === "guard-post") (name = `${cp.id}_post${gp ? `_${String.fromCharCode(97 + gp)}` : ""}`), (kind = "post"), gp++;
        else if (r.kind === "holding-cell") {
          c++;
          name = (desc.housing?.doorNaming?.cell ?? "{place}_cell{n}").replace("{place}", cp.id).replace("{n}", String(c));
          kind = "cell";
          at = nearestOnRect(r.rect, pc);
        } else return;
        doors.push({ name, id: `${cp.id}.${i}`, source: "04-checkpoint", kind, building: null, checkpoint: cp.id, unit: null, room: `${cp.id}.${i}`, zone: zoneOf[cp.id], owner: "msr", key: cp.id, property: true, use: true, lockable: true, at: [r3(at[0]), r3(at[1]), r3(z)], storey: 0, width_m: null, texture: doorTex[`checkpoint:${cp.id}.${i}`] ?? null }); // prettier-ignore
        if (kind === "cell") cells.push({ name, place: cp.id, room: `${cp.id}.${i}`, door: name, at: [r3(rectCentre(r.rect)[0]), r3(rectCentre(r.rect)[1]), r3(z)] }); // prettier-ignore
      });
    }
    // building cells (the cell and holding-cell rooms' doors)
    for (const b of plans.buildings) {
      for (const r of b.rooms) {
        if ((r.kind !== "cell" && r.kind !== "holding-cell") || r.checkpoint) continue; // a checkpoint's cell: listed under its checkpoint
        const d = doors.find((x) => x.building === b.id && x.room === r.id && x.kind !== "secret");
        const lot = lotOf[b.id];
        const sh = (b.frame?.storeyHeight_m ?? 4.877) / cell;
        const c0 = r.cells[0];
        cells.push({ name: d?.name ?? null, place: b.id, room: r.id, door: d?.name ?? null, at: [r3(c0.x + c0.w / 2), r3(c0.y + c0.d / 2), r3((lot?.zBase ?? 0) + r.storey * sh)] }); // prettier-ignore
      }
    }
    // secrets: the doors of the description's secret doors; hatches at the ends of secret connectors and passages
    const secrets = [];
    const inTileB = new Set(plans.buildings.map((b) => b.id));
    for (const s of desc.secrets ?? []) {
      if (s.kind === "door" && inTileB.has(s.in)) secrets.push({ id: s.id, kind: "door", building: s.in, doors: doors.filter((d) => d.kind === "secret" && d.name === s.id).map((d) => d.name) }); // prettier-ignore
      if (s.kind === "passage") {
        const ends = [s.from, s.to].map((e, i) => ({ e, i })).filter(({ e }) => inTileB.has(e) || nodeOf[e]?.inTile);
        if (!ends.length) continue;
        const names = [];
        for (const { e, i } of ends) {
          // where stage 4's tunnel for it (one crossing a seam) starts, when it has one
          const tunnel = (net.passages ?? []).find((p) => p.id === s.id && !p.noSeamWay)?.ends?.find((x) => x.id === e)?.at;
          const at = tunnel ?? nodeOf[e]?.at ?? (lotOf[e] ? rectCentre(lotOf[e].rect) : [0, 0]);
          const z = nodeOf[e]?.z ?? lotOf[e]?.zBase ?? 0;
          const name = `${s.id}_${"ab"[i]}`;
          names.push(name);
          doors.push({ name, id: `${s.id}@${e}`, source: "description-secret", kind: "hatch", building: inTileB.has(e) ? e : null, unit: null, room: null, zone: zoneOf[e] ?? null, owner: inTileB.has(e) ? bOf[e].owner : "city", key: s.id, property: false, use: true, lockable: false, at: [r3(at[0]), r3(at[1]), r3(z)], storey: 0, width_m: null, texture: null }); // prettier-ignore
        }
        secrets.push({ id: s.id, kind: "passage", from: s.from, to: s.to, doors: names });
      }
    }
    for (const c of net.connectors) {
      if (c.type !== "secret" || !(c.inTile ?? []).length) continue;
      const names = [];
      for (const stop of c.inTile) {
        const i = c.stops.indexOf(stop);
        const ex = (c.exits ?? []).find((e) => e.stop === stop);
        const at = ex?.at ?? nodeOf[stop]?.at ?? (lotOf[stop] ? rectCentre(lotOf[stop].rect) : [0, 0]);
        const z = ex?.z ?? nodeOf[stop]?.z ?? lotOf[stop]?.zBase ?? 0;
        const name = `${c.id}_${"abcdefgh"[i]}`;
        names.push(name);
        doors.push({ name, id: `${c.id}@${stop}`, source: "04-connector", kind: "hatch", building: inTileB.has(stop) ? stop : null, unit: null, room: null, zone: zoneOf[stop] ?? null, owner: inTileB.has(stop) ? bOf[stop].owner : "city", key: c.id, property: false, use: true, lockable: false, at: [r3(at[0]), r3(at[1]), r3(z)], storey: 0, width_m: null, texture: null }); // prettier-ignore
      }
      secrets.push({ id: c.id, kind: "connector", stops: c.stops, inTile: c.inTile, doors: names });
    }

    // ── lights, sounds, switches, the alarm ──
    const budget = tileBudget(desc, tile);
    const lights = pal.lamps.filter((l) => l.switchable).map((l, i) => ({ name: `lt_${T}_${String(i + 1).padStart(2, "0")}`, lamp: l.id, space: l.space, style: l.style, at: [l.at[0], l.at[1], l.z], colour: l.colour })); // prettier-ignore
    const alarmSounds = pal.sounds.filter((s) => s.kind === "alarm");
    const swSounds = pal.sounds.filter((s) => s.switchable && s.kind !== "alarm");
    // the city's alarm switch (wiring.alarms: a count for the city) stands in the tile of the MSR's Nexus, in its
    // briefing room or guard post; every other tile's speakers carry its target name (alarm_city) and sound with it
    const nexus = (desc.buildings ?? []).find((b) => b.id === desc.rules?.msr?.nexus);
    const alarmTile = !nexus?.at || tileAt(desc, nexus.at) === tile;
    const alarmsWanted = alarmTile ? Math.min(desc.wiring?.alarms ?? 0, alarmSounds.length ? 1 : 0) : 0;
    const nGates = net.checkpoints.filter((cp) => cp.rooms.some((r) => r.kind === "gate")).length;
    // up to the tile's target, never past its maximum (at a small share the rounded target may pass the floored max)
    const soundRoom = Math.max(0, Math.min(budget.switches.target, budget.switches.max) - lights.length - nGates - alarmsWanted);
    const sounds = pal.sounds.map((s) => ({ name: s.kind === "alarm" ? "alarm_city" : null, sound: s.id, kind: s.kind, space: s.space, sample: s.name, at: [s.at[0], s.at[1], s.z], looping: true })); // prettier-ignore
    let sn = 0;
    for (const s of swSounds.slice(0, soundRoom)) sounds.find((x) => x.sound === s.id).name = `snd_${T}_${String(++sn).padStart(2, "0")}`; // prettier-ignore
    const switches = [];
    // the wall spot beside a room's entrance door (dressing.mjs's switchSpots), in cells, with its facing
    const roomIx = new Map(plans.buildings.flatMap((b) => b.rooms.map((r) => [r.id, { b, r }])));
    const used = [];
    const wallSpot = (roomId) => {
      const hit = roomIx.get(roomId);
      if (!hit) return null;
      const { b, r } = hit;
      const floor = roomFloor(r);
      const o = b.frame.origin_cells;
      const z0 = b.storeys.find((s) => s.storey === r.storey)?.z_m ?? 0;
      for (const sp of switchSpots(b, r, floor, roomDoors(b, r, floor), rules)) {
        const at = [o[0] + sp.at[0] / cell, o[1] + sp.at[1] / cell, (z0 + sp.at[2]) / cell];
        if (used.some((u) => Math.hypot(u[0] - at[0], u[1] - at[1]) < 0.1 / cell && Math.abs(u[2] - at[2]) < 0.01)) continue;
        used.push(at);
        return { at, facing: sp.facing, building: b.id, room: r.id, door: sp.door };
      }
      return null;
    };
    // a checkpoint's guard post standing alone: its wall facing the gate, beside the middle, facing in
    const postSpot = (cp, post) => {
      const gate = cp.rooms.find((x) => x.kind === "gate");
      const r = post.rect;
      const gc = gate ? rectCentre(gate.rect) : rectCentre(r);
      const c = rectCentre(r);
      const dx = gc[0] - c[0];
      const dy = gc[1] - c[1];
      const side = Math.abs(dx) / r.w >= Math.abs(dy) / r.d ? (dx >= 0 ? "e" : "w") : dy >= 0 ? "n" : "s";
      const inset = 0.1 / cell;
      const along = Math.min(0.85 / cell, (side === "n" || side === "s" ? r.w : r.d) / 2 - 0.2 / cell);
      const at = side === "e" ? [r.x + r.w - inset, c[1] + along] : side === "w" ? [r.x + inset, c[1] + along] : side === "n" ? [c[0] + along, r.y + r.d - inset] : [c[0] + along, r.y + inset]; // prettier-ignore
      const facing = side === "e" ? [-1, 0] : side === "w" ? [1, 0] : side === "n" ? [0, -1] : [0, 1];
      const z = (post.z?.[0] ?? layerOf[cp.layer]?.floor ?? 0) + rules.keepClear.switch.mountHeight.typical / cell;
      return { at: [...at, z], facing, building: null, room: null, door: null };
    };
    const addSwitch = (kind, spot, fallback, space, targets, extra = {}) => switches.push({ name: `sw_${T}_${String(switches.length + 1).padStart(2, "0")}`, kind, at: (spot?.at ?? fallback).map(r3), facing: spot?.facing ?? null, space, building: spot?.building ?? null, room: spot?.room ?? null, door: spot?.door ?? null, ...extra, targets }); // prettier-ignore
    const roomOfSpace = (space) => (String(space).startsWith("room:") ? String(space).slice(5) : null);
    for (const l of lights) addSwitch("lamp", wallSpot(roomOfSpace(l.space)), l.at, l.space, [l.name]);
    for (const s of sounds.filter((x) => x.name && x.kind !== "alarm")) addSwitch("sound", wallSpot(roomOfSpace(s.space)), s.at, s.space, [s.name]); // prettier-ignore
    for (const cp of net.checkpoints) {
      const gates = doors.filter((d) => d.checkpoint === cp.id && d.kind === "gate").map((d) => d.name);
      if (!gates.length) continue;
      const fp = folded.post.get(cp.id);
      const post = cp.rooms.find((r) => r.kind === "guard-post");
      const fallback = doors.find((d) => d.name === gates[0]).at;
      if (fp) addSwitch("gate", wallSpot(fp.room.id), fallback, `room:${fp.room.id}`, gates, { checkpoint: cp.id });
      else addSwitch("gate", post ? postSpot(cp, post) : null, fallback, `checkpoint:${cp.id}`, gates, { checkpoint: cp.id });
    }
    if (alarmsWanted) {
      const msrRooms = plans.buildings.filter((b) => bOf[b.id].owner === "msr").flatMap((b) => b.rooms.filter((r) => r.kind === "briefing" || r.kind === "guard-post")); // prettier-ignore
      const r = msrRooms[0];
      addSwitch("alarm", r ? wallSpot(r.id) : null, [...alarmSounds[0].at, alarmSounds[0].z], r ? `room:${r.id}` : alarmSounds[0].space, ["alarm_city"]); // prettier-ignore
    }
    // ── lifts ──
    const lifts = [];
    for (const c of net.connectors) {
      if (c.type !== "lift" || !(c.inTile ?? []).length) continue;
      const stops = c.stops.map((stop, i) => {
        const ex = (c.exits ?? []).find((e) => e.stop === stop);
        const inTile = (c.inTile ?? []).includes(stop);
        return { stop, n: i, name: `${c.id}_s${i + 1}`, layer: ex?.layer ?? null, z: ex?.z ?? null, at: ex?.at ?? null, inTile, call: inTile && ex ? `${c.id}_call${i + 1}` : null }; // prettier-ignore
      });
      lifts.push({ id: c.id, name: c.id, title: c.name ?? null, access: c.access, owner: c.access === "msr" ? "msr" : "city", stops, car: c.dims?.car_m ?? null }); // prettier-ignore
    }
    // ── spawns ──
    const groups = [...new Set(net.spawns.map((s) => s.group))];
    const spawns = { order: net.spawns.map((s) => s.id), groups: groups.map((g) => ({ id: g, spawns: net.spawns.filter((s) => s.group === g).map((s) => s.id) })), first32Groups: [...new Set(net.spawns.slice(0, 32).map((s) => s.group))].length }; // prettier-ignore
    // ── entities that stay ──
    const signs = plans.buildings.filter((b) => bOf[b.id].sign).length;
    const ent = {
      doors: doors.length,
      buttons: switches.length + lifts.reduce((s, l) => s + l.stops.filter((x) => x.call).length, 0),
      lifts: lifts.reduce((s, l) => s + 1 + l.stops.length, 0),
      lights: lights.length,
      sounds: sounds.length,
      spawns: net.spawns.length,
      signs,
      // the model props stage 8 may place (dressing.mjs's modelPropCap: the rest are brushes, no entity)
      props: modelPropCap(desc, rules, tile, Object.values({ doors: doors.length, b: switches.length, l: lights.length, s: sounds.length, sp: net.spawns.length, sg: signs }).reduce((s, x) => s + x, 0) + lifts.reduce((s, l) => s + 1 + l.stops.length + l.stops.filter((x) => x.call).length, 0)).cap, // prettier-ignore
    };
    ent.total = Object.values(ent).reduce((s, x) => s + x, 0);
    ent.limit = budget.entities.limit;
    return {
      tile: plans.tile ?? null,
      grid: { cell, cellUnits: desc.grid.cellUnits, origin: desc.grid.origin ?? [0, 0], note: "positions in cells (x, y, z); engine units = (x - origin) x cellUnits, z x cellUnits" }, // prettier-ignore
      naming: { doorNaming: desc.housing?.doorNaming ?? null, maxNameLength: desc.rules?.doors?.maxNameLength ?? 31, groups: Object.keys(desc.housing?.groups ?? {}) }, // prettier-ignore
      doors,
      openings,
      zones,
      spawns,
      cells,
      lights,
      sounds,
      switches,
      lifts,
      secrets,
      entities: ent,
      measures: {
        doors: doors.length,
        namedDoors: doors.filter((d) => d.name).length,
        propertyDoors: doors.filter((d) => d.property).length,
        lockable: doors.filter((d) => d.lockable).length,
        byOwner: Object.fromEntries(Object.keys(desc.housing?.groups ?? {}).map((g) => [g, doors.filter((d) => d.owner === g).length])), // prettier-ignore
        keys: new Set(doors.map((d) => d.key)).size,
        zones: zones.length,
        cells: cells.length,
        switches: switches.length,
        switchableLights: lights.length,
        lifts: lifts.length,
        secrets: secrets.length,
        spawns: net.spawns.length,
        entities: ent.total,
      },
    };
  },
  gate(artifact, ctx) {
    const desc = ctx.description;
    const failures = [];
    const notes = [];
    const max = desc.rules?.doors?.maxNameLength ?? 31;
    const groups = new Set(Object.keys(desc.housing?.groups ?? {}));
    // names: unique, short, plain
    const seen = new Map();
    const named = [...artifact.doors.map((d) => ["door", d.name]), ...artifact.lights.map((l) => ["light", l.name]), ...artifact.switches.map((s) => ["switch", s.name]), ...artifact.sounds.filter((s) => s.name && s.name !== "alarm_city").map((s) => ["sound", s.name]), ...artifact.lifts.flatMap((l) => [["lift", l.name], ...l.stops.map((s) => ["lift stop", s.name]), ...l.stops.filter((s) => s.call).map((s) => ["call button", s.call])])]; // prettier-ignore
    for (const [what, n] of named) {
      if (!n) {
        failures.push(`names: a ${what} has no name`);
        continue;
      }
      if (n.length > max) failures.push(`names: ${what} ${n} is ${n.length} characters, at most ${max}`);
      if (!NAME_RE.test(n)) failures.push(`names: ${what} ${n} holds a character outside letters, digits and _`);
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    for (const [n, k] of seen) if (k > 1) failures.push(`names: ${n} is given ${k} times, wanted once`);
    // every door of 05 present, its property name kept
    const plans = ctx.inputs["05-plans.json"];
    const byId = new Map(artifact.doors.map((d) => [d.id, d]));
    const opened = new Set(artifact.openings.map((o) => o.id));
    for (const b of plans?.buildings ?? [])
      for (const d of b.doors) {
        if (opened.has(d.id)) continue;
        const got = byId.get(d.id);
        if (!got) failures.push(`doors: ${b.id}'s door ${d.id}${d.name ? ` (${d.name})` : ""} from 05-plans.json is missing from the contract`); // prettier-ignore
        else if (d.name && got.name !== d.name) failures.push(`doors: ${d.id} is named ${got.name}, 05-plans.json names it ${d.name}`); // prettier-ignore
      }
    // owner groups, zones, use-only
    const zoneIds = new Set(artifact.zones.map((z) => z.id));
    for (const d of artifact.doors) {
      if (!groups.has(d.owner)) failures.push(`doors: ${d.name} has owner group ${d.owner}, not one of ${[...groups].join(", ")}`); // prettier-ignore
      if (d.zone && !zoneIds.has(d.zone)) failures.push(`doors: ${d.name} is in zone ${d.zone}, which is not in the zones`);
      if (!d.zone && d.building) failures.push(`doors: ${d.name} of ${d.building} has no zone`);
      if (d.use !== true) failures.push(`doors: ${d.name} is not use-only (spawnflag 256): an RP plugin cannot lock a door opened by touch`); // prettier-ignore
    }
    for (const z of artifact.zones) if (!groups.has(z.owner)) failures.push(`zones: ${z.id} has owner group ${z.owner}, not one of ${[...groups].join(", ")}`); // prettier-ignore
    const zid = new Set();
    for (const z of artifact.zones) zid.has(z.id) ? failures.push(`zones: ${z.id} is given twice`) : zid.add(z.id);
    for (const b of plans?.buildings ?? []) if (!artifact.zones.some((z) => z.kind === "building" && z.ref === b.id)) failures.push(`zones: building ${b.id} has no zone`); // prettier-ignore
    // cells match the checkpoints' programs and the buildings' cell rooms
    const net = ctx.inputs["04-network.json"];
    for (const cp of net?.checkpoints ?? []) {
      const want = cp.program?.["holding-cell"] ?? 0;
      const rooms = cp.rooms.filter((r) => r.kind === "holding-cell").length;
      const got = artifact.cells.filter((c) => c.place === cp.id && c.door).length;
      if (got !== want || rooms !== want) failures.push(`cells: checkpoint ${cp.id} has ${got} cell doors and ${rooms} holding cells, its program asks ${want}`); // prettier-ignore
    }
    for (const b of plans?.buildings ?? []) {
      const want = b.rooms.filter((r) => (r.kind === "cell" || r.kind === "holding-cell") && !r.checkpoint).length;
      const got = artifact.cells.filter((c) => c.place === b.id && c.door).length;
      if (got !== want) failures.push(`cells: ${b.id} has ${got} cells with a door, its plan has ${want} cell rooms`);
    }
    // switches and lights
    const B = tileBudget(desc, ctx.params.tile);
    const S = artifact.switches.length;
    if (S < B.switches.min || S > B.switches.max) failures.push(`switches: ${S} in tile ${ctx.params.tile}, wanted ${B.switches.min} to ${B.switches.max} (its ${Math.round(B.share * 100)} % share of ${desc.rules?.wiring?.switches?.min}-${desc.rules?.wiring?.switches?.max})`); // prettier-ignore
    if (artifact.lights.length > B.switchable.limit) failures.push(`switches: ${artifact.lights.length} switchable lights in tile ${ctx.params.tile}, at most ${B.switchable.limit} (of ${desc.rules?.wiring?.switchableLights?.max ?? 32} light styles)`); // prettier-ignore
    const styles = artifact.lights.map((l) => l.style);
    if (new Set(styles).size !== styles.length) failures.push(`switches: two switchable lights share a light style`);
    const targets = new Set([...artifact.doors.map((d) => d.name), ...artifact.lights.map((l) => l.name), ...artifact.sounds.filter((s) => s.name).map((s) => s.name)]); // prettier-ignore
    for (const s of artifact.switches) {
      if (!s.targets.length) failures.push(`switches: ${s.name} targets nothing`);
      if (!Array.isArray(s.facing)) failures.push(`switches: ${s.name} (${s.kind} in ${s.space}) has no wall spot beside its room's entrance door: no facing`); // prettier-ignore
      for (const t of s.targets) if (!targets.has(t)) failures.push(`switches: ${s.name} targets ${t}, which is no door, light or sound of the tile`); // prettier-ignore
    }
    for (const l of artifact.lights) if (!artifact.switches.some((s) => s.targets.includes(l.name))) failures.push(`switches: light ${l.name} is on no switch`); // prettier-ignore
    // lifts
    for (const l of artifact.lifts) {
      if (l.stops.length < 2) failures.push(`lifts: ${l.id} has ${l.stops.length} stop, wanted 2 or more`);
      for (const s of l.stops) if (s.inTile && !s.call) failures.push(`lifts: ${l.id}'s stop ${s.stop} has no call button`);
    }
    // secrets: every secret door of the tile's buildings with its door
    const inTile = new Set((plans?.buildings ?? []).map((b) => b.id));
    for (const s of desc.secrets ?? []) {
      if (s.kind !== "door" || !inTile.has(s.in)) continue;
      const got = artifact.secrets.find((x) => x.id === s.id);
      if (!got || !got.doors.length) failures.push(`secrets: ${s.id} in ${s.in} has no door in the contract`);
    }
    // spawns: in entity order, every group among the first 32
    const groupsAll = artifact.spawns.groups.length;
    if (artifact.spawns.first32Groups < Math.min(groupsAll, 32)) failures.push(`spawns: the first 32 spawns hold ${artifact.spawns.first32Groups} of ${groupsAll} groups: TS reads only the first 32, interleave them`); // prettier-ignore
    if (net && artifact.spawns.order.length !== net.spawns.length) failures.push(`spawns: ${artifact.spawns.order.length} in the contract, 04-network.json has ${net.spawns.length}`); // prettier-ignore
    // entities
    const E = artifact.entities;
    if (E.total > B.entities.limit) failures.push(`entities: an estimated ${E.total} entities stay in tile ${ctx.params.tile}, at most ${B.entities.limit} (its ${Math.round(B.maxShare * 100)} % share of ${desc.engine?.limits?.entities?.value})`); // prettier-ignore
    const M = artifact.measures;
    notes.push(`doors: ${M.doors} named (${M.propertyDoors} property doors, ${M.lockable} lockable, ${M.keys} keys); owners ${Object.entries(M.byOwner).map(([k, v]) => `${k} ${v}`).join(", ")}; ${artifact.openings.length} openings without a leaf`); // prettier-ignore
    notes.push(`zones ${M.zones}, cells ${M.cells}, switches ${M.switches} (target ${B.switches.target}), switchable lights ${M.switchableLights}, lifts ${M.lifts}, secrets ${M.secrets}, spawns ${M.spawns} in ${groupsAll} groups`); // prettier-ignore
    notes.push(`entities: ${E.total} of ${B.entities.limit} (doors ${E.doors}, buttons ${E.buttons}, lifts ${E.lifts}, lights ${E.lights}, sounds ${E.sounds}, spawns ${E.spawns}, signs ${E.signs}, model props reserved ${E.props ?? 0}); untargeted lamps are freed at compile; props that may be brushes are (no entity)`); // prettier-ignore
    return { failures, notes };
  },
};
