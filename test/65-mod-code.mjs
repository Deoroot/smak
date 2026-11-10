// A mod's entity definitions read from its C++ source, and an FGD written from them.
//   definitionsOfCode: a class LINK_ENTITY_TO_CLASS makes, with the keys its KeyValue and its bases' read,
//   each typed by what the code does with the value; keys handed on to a helper; the engine's own keys; a
//   class written inside its class body; the macro's own definition is no class
//   writeFgd: an FGD read back is the same classes, keys, types, defaults, choices and flags; the code's keys
//   join an FGD's, and an FGD's whole number is made a fraction where the code reads one
//   `smak map-fgd`
//   boneIn: a Biped bone named in English, Italian or the older limb names found as the base names it
// Where goldsrc.net's mod-ts source is on the machine, its classes are read too (none of it is kept here).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as maps from "../check/maps/index.mjs";
import { boneIn, otherSideOf } from "../make/biped.mjs";
import { test, sure, tmp, runSmak } from "./helper.mjs";

const folder = join(tmp, "modcode");
mkdirSync(join(folder, "dlls"), { recursive: true });
writeFileSync(
  join(folder, "dlls", "util.cpp"),
  `TYPEDESCRIPTION gEntvarsDescription[] = {
  DEFINE_ENTITY_FIELD(classname, FIELD_STRING),
  DEFINE_ENTITY_FIELD(targetname, FIELD_STRING),
  DEFINE_ENTITY_FIELD(angles, FIELD_VECTOR),
  DEFINE_ENTITY_FIELD(framerate, FIELD_FLOAT),
  DEFINE_ENTITY_FIELD(nextthink, FIELD_TIME),
};
#define LINK_ENTITY_TO_CLASS(mapClassName, DLLClassName) extern "C" void mapClassName(entvars_t* pev)
`,
);
writeFileSync(
  join(folder, "dlls", "things.cpp"),
  `class CBaseDelay : public CBaseEntity { };
class CLamp : public CBaseDelay
{
public:
  void KeyValue(KeyValueData* pkvd) override
  {
    if (FStrEq(pkvd->szKeyName, "glow")) { m_glow = atof(pkvd->szValue); pkvd->fHandled = true; }
    else CBaseDelay::KeyValue(pkvd);
  }
};
LINK_ENTITY_TO_CLASS( item_lamp, CLamp );
// LINK_ENTITY_TO_CLASS(info_gone, CGone);
void CBaseDelay::KeyValue(KeyValueData* pkvd)
{
  if (FStrEq(pkvd->szKeyName, "delay")) m_flDelay = atof(pkvd->szValue);
  else if (FStrEq(pkvd->szKeyName, "killtarget")) m_iszKillTarget = ALLOC_STRING(pkvd->szValue);
}
class CSmoke : public CBaseDelay { void KeyValue(KeyValueData* pkvd); };
LINK_ENTITY_TO_CLASS(env_puff, CSmoke);
void CSmoke::KeyValue(KeyValueData* pkvd)
{
  if (FStrEq(pkvd->szKeyName, "count")) { m_count = atoi(pkvd->szValue); return; }
  if (FStrEq(pkvd->szKeyName, "noise")) { PRECACHE_SOUND(STRING(ALLOC_STRING(pkvd->szValue))); return; }
  if (s_Puffs.PuffKeyValue(&m_data, pkvd->szKeyName, pkvd->szValue)) return;
}
int CPuffs::PuffKeyValue(puff_s* p, const char* key, const char* val)
{
  if (FStrEq(key, "spread")) { ParseVec(val, p->spread); return 1; }
  return 0;
}
class CDoorish : public CBaseDelay { };
LINK_ENTITY_TO_CLASS(func_slider, CDoorish);
`,
);
const code = maps.definitionsOfCode(join(folder, "dlls"));

test("definitionsOfCode: classes with the keys their code and their bases' read, typed by use", () => {
  sure(Object.keys(code.classes).join(" ") === "env_puff func_slider item_lamp", Object.keys(code.classes).join(" "));
  const lamp = code.classes.item_lamp;
  sure(lamp.cclass === "CLamp" && lamp.kind === "point", JSON.stringify(lamp));
  sure(lamp.keys.glow.type === "float" && lamp.keys.delay.type === "float" && lamp.keys.killtarget.type === "string");
  const puff = code.classes.env_puff;
  sure(puff.keys.count.type === "integer" && puff.keys.noise.type === "sound", JSON.stringify(puff.keys));
  sure(puff.keys.spread?.type === "vector", "a key handed to a helper is read from the helper");
  sure(code.classes.func_slider.kind === "solid", "func_ is made of brushes");
  sure(lamp.keys.targetname.engine && lamp.keys.framerate.type === "float" && !lamp.keys.nextthink.engine === false);
  sure(!code.unread.length, code.unread.join("; "));
});

const FGD = `@PointClass size(-8 -8 0, 8 8 16) studio("models/lamp.mdl") = item_lamp : "A lamp"
[
  glow(integer) : "Glow" : 2
  colour(choices) : "Colour" : 1 = [ 1 : "Red" 2 : "Green" ]
  spawnflags(flags) = [ 1 : "Starts off" : 1  4 : "Flickers" : 0 ]
  framerate(integer) : "Frames per second" : 10
]
@PointClass = item_old : "Gone from the code" []
`;

test("writeFgd: an FGD read back is the same, the code's keys joined to it, its types mended by the code", () => {
  const fgd = maps.definitionsOf(maps.readFgd(FGD));
  const again = maps.definitionsOf(maps.readFgd(maps.writeFgd(fgd, { name: "test" })));
  const lamp = again.classes.item_lamp;
  sure(lamp.size.maxs[2] === 16 && lamp.model === "models/lamp.mdl" && lamp.description === "A lamp");
  sure(lamp.keys.colour.choices.join() === "1,2" && lamp.keys.colour.labels[2] === "Green" && lamp.keys.colour.default === "1");
  sure(lamp.keys.spawnflags.flags.join() === "1,4" && lamp.keys.spawnflags.default === "1");
  sure(again.classes.item_old, "with no program, every class an FGD names is written");
  const text = maps.writeFgd(maps.joinDefinitions(code, fgd), { name: "test" });
  const joined = maps.definitionsOf(maps.readFgd(text));
  sure(!joined.classes.item_old && /not in the program \(left out\): item_old/.test(text), "a class the program lacks is left out, and said");
  sure(joined.classes.item_lamp.keys.delay && joined.classes.item_lamp.keys.colour.type === "choices", "the FGD's type stands");
  sure(joined.classes.item_lamp.keys.glow.type === "float", "an FGD's whole number the code reads as a fraction");
  sure(joined.classes.item_lamp.keys.framerate.type === "float", "and one the engine reads as a fraction");
  sure(joined.classes.env_puff.keys.count.type === "integer" && joined.classes.env_puff.keys.targetname);
  sure(!joined.classes.env_puff.keys.nextthink, "an engine key nothing gives is not written");
  sure(joined.classes.func_slider.kind === "solid");
});

test("smak map-fgd: an FGD from the source and an FGD, with the keys the FGD lacked listed", () => {
  writeFileSync(join(folder, "lamp.fgd"), FGD);
  const out = runSmak("map-fgd", join(folder, "dlls"), "-o", join(folder, "out.fgd"), "--fgd", join(folder, "lamp.fgd"));
  sure(/3 classes/.test(out) && /item_lamp: delay killtarget/.test(out), out);
  sure(maps.readFgd(readFileSync(join(folder, "out.fgd"), "latin1")).classes.env_puff);
});

const MODTS = join(homedir(), "Projects/goldsrc.net/mod-ts/dlls");
test("definitionsOfCode: The Specialists' source, where it is on the machine", () => {
  if (!existsSync(MODTS)) return "skipped: no mod-ts source";
  const ts = maps.definitionsOfCode(MODTS);
  sure(Object.keys(ts.classes).length > 150 && ts.classes.ts_groundweapon?.keys.tsweaponid?.type === "integer");
  sure(ts.classes.ts_emitter.keys.epshigh?.type === "float", "the emitter's keys, read in its helper");
  sure(!ts.classes.info_node, "a class whose line is commented out is not there");
});

test("boneIn: 3ds Max Biped's bones in English, Italian and the older limb names, and their other side", () => {
  const italian = ["Bip01 Testa", "Bip01 SX Mano", "Bip01 Dorso1", "Bip01 Dito mano DX01", "Bip01 SX Braccio superiore", "Bip01 DX Polpaccio", "Bip01 SX Clavicola"];
  const english = ["Bip01 Head", "Bip01 L Hand", "Bip01 Spine1", "Bip01 R Finger01", "Bip01 L Arm1", "Bip01 R Leg1", "Bip01 L Arm"];
  sure(english.map((n) => boneIn(n, italian)).join() === italian.join(), english.map((n) => boneIn(n, italian)).join());
  sure(italian.map((n) => boneIn(n, english)).join() === english.join(), italian.map((n) => boneIn(n, english)).join());
  sure(boneIn("Bip01 L UpperArm", english) === "Bip01 L Arm1" && boneIn("bip01 head", english) === "Bip01 Head");
  sure(boneIn("Bip01 Tail", english) === null);
  sure(otherSideOf("Bip01 Dito mano SX0") === "Bip01 Dito mano DX0" && otherSideOf("Bip01 L Arm1") === "Bip01 R Arm1" && otherSideOf("Bip01 Spine") === "Bip01 Spine");
});
