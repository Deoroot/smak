// The Specialists' profile held against role-play cities (profiles/specialists.mjs, kind "roleplay"), for the
// command line, which hands a profile only the --game folders:
//
//   smak map-character city.bsp --mod smak/profiles/specialists-roleplay.mjs --game <Half-Life>/ts --game <Half-Life>/valve
import specialists from "./specialists.mjs";

export default (given = {}) => specialists({ ...given, kind: "roleplay" });
