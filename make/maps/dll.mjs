// The entity classes a GoldSrc game's own program has, read from its library (`<mod>/dlls/*.dll`). The engine
// makes an entity by calling the function of the game's library that bears the classname (the SDK's
// LINK_ENTITY_TO_CLASS exports one for every class): a classname with no such function is "Can't init" in a
// console nobody reads, and the entity is not there. So the library's list of exported names is the one
// full and certain list of the classes that exist, where an FGD is what somebody wrote down and a mod's maps
// are what somebody happened to use.
//
// It says which classes exist and nothing of their keys. Only a Windows library (a PE file, 32 or 64 bit) is
// read; a Linux `.so` is refused in a sentence.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// ── the format (Microsoft's PE: winnt.h) ────────────────────────────────────
const DOS = { magic: 0x5a4d, peAt: 0x3c };
const PE_MAGIC = 0x00004550;
/** The file header after the PE letters, and the two kinds of optional header after it. */
const FILE_HEADER = { sections: 2, optionalSize: 16, sizeof: 20 };
const OPTIONAL = { pe32: 0x10b, pe32plus: 0x20b, directoriesAt: { 0x10b: 96, 0x20b: 112 } };
const SECTION = { virtualSize: 8, virtualAddress: 12, rawSize: 16, rawAt: 20, sizeof: 40 };
/** The export directory: how many names, and where the table of their addresses is. */
const EXPORTS = { names: 24, namesAt: 32, sizeof: 40 };
/** What every GoldSrc game library exports that is no entity class: the engine's way into it. */
const NOT_CLASSES = [
  "GiveFnptrsToDll", "GetEntityAPI", "GetEntityAPI2", "GetNewDLLFunctions", "Server_GetBlendingInterface",
  "Server_GetPhysicsInterface", "SV_SaveGameComment", "CreateInterface", "DelayedUse", "DllMain",
]; // prettier-ignore
/** A classname: letters, digits and `_`. A name with other marks is a C++ function, not a class. */
const CLASSNAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The entity classes a game library exports, sorted: `classesOfDll(bytes)`. `bytes` is the file
 * (`<mod>/dlls/hl.dll`, `mp.dll`, `ms.dll`: the `gamedll` line of the mod's `liblist.gam` names it). Throws,
 * in words, for a file that is no Windows library or exports nothing.
 */
export function classesOfDll(bytes) {
  const no = (why) => new Error(`not a Windows game library (.dll): ${why}`);
  if (bytes.length > 4 && bytes.toString("latin1", 1, 4) === "ELF")
    throw no(
      "this is a Linux library (ELF), which is not read. The game's Windows .dll has the same classes",
    );
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== DOS.magic) throw no("it does not begin with MZ");
  const pe = bytes.readUInt32LE(DOS.peAt);
  if (pe + 4 + FILE_HEADER.sizeof > bytes.length || bytes.readUInt32LE(pe) !== PE_MAGIC)
    throw no("it has no PE header");
  const header = pe + 4;
  const optional = header + FILE_HEADER.sizeof;
  const directoriesAt = OPTIONAL.directoriesAt[bytes.readUInt16LE(optional)];
  if (!directoriesAt) throw no("its optional header is neither PE32 nor PE32+");
  const sectionsAt = optional + bytes.readUInt16LE(header + FILE_HEADER.optionalSize);
  const sections = [];
  for (let index = 0; index < bytes.readUInt16LE(header + FILE_HEADER.sections); index++) {
    const at = sectionsAt + index * SECTION.sizeof;
    sections.push({
      address: bytes.readUInt32LE(at + SECTION.virtualAddress),
      size: Math.max(bytes.readUInt32LE(at + SECTION.virtualSize), bytes.readUInt32LE(at + SECTION.rawSize)),
      raw: bytes.readUInt32LE(at + SECTION.rawAt),
    });
  }
  /** Where in the file an address of the loaded library is. */
  const fileAt = (address) => {
    const section = sections.find((each) => address >= each.address && address < each.address + each.size);
    if (!section) throw no("an address in it points into no section: the file is cut short or packed");
    return address - section.address + section.raw;
  };
  const exportsAddress = bytes.readUInt32LE(optional + directoriesAt);
  if (!exportsAddress) throw no("it exports nothing");
  const directory = fileAt(exportsAddress);
  const count = bytes.readUInt32LE(directory + EXPORTS.names);
  const namesAt = fileAt(bytes.readUInt32LE(directory + EXPORTS.namesAt));
  const classes = [];
  for (let index = 0; index < count; index++) {
    const at = fileAt(bytes.readUInt32LE(namesAt + index * 4));
    const end = bytes.indexOf(0, at);
    const name = bytes.toString("latin1", at, end < 0 ? bytes.length : end);
    if (CLASSNAME.test(name) && !NOT_CLASSES.includes(name)) classes.push(name);
  }
  return classes.sort();
}

/**
 * The classes of game libraries as entity definitions, to put beside an FGD's and the maps' (`joinDefinitions`,
 * or a profile's `dlls`): `{ from, fgd: false, maps: 0, program: true, classes: { name: { exists: true,
 * keys: {} } } }`. `files`: the paths of the libraries. With these, a class the program does not have is an
 * error whatever an FGD says, and one it has is no fault though no FGD and no map knows it.
 */
export function definitionsOfDll(...files) {
  const classes = {};
  const from = [];
  for (const file of files.flat()) {
    for (const name of classesOfDll(readFileSync(file)))
      classes[name] = { exists: true, defined: false, keys: {} };
    from.push(`the game's program ${basename(file)}`);
  }
  return { from, fgd: false, maps: 0, program: true, classes };
}
