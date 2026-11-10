// Texture lights for Half-Life's own maps: which textures shine, in what colour and how brightly, for hlrad.
// Valve's maps are lit largely by `~light` textures declared when they were compiled, and Valve compiled each
// map with a list of its own that never shipped. SDHLT ships the classic list with every line commented out,
// so a recompile of a retail map with no list comes out black wherever only such textures light it.
//
// PROVENANCE. This table was calibrated against the retail lightmaps by Steven Linn's goldsrc.net project
// (godot/mods/valve/src/maps/lights.rad and rad/<map>.rad, made by tools/bsp2map's texlights.py,
// texlight_colours.py and calibrate_texlights.py, 2026-09-04). The classic Valve/ZHLT list, uncommented; the
// emitters recovered from the retail lightmaps (a texture whose faces average near-white light wherever it
// appears); liquids that glow; each colour from the saturated luxels of the emitter's own faces (their 25th
// percentile, channel by channel); each brightness scaled until a recompile's light near the emitter matched
// retail's. With these, a recompile of the retail set has its light within 25% of retail's on 112 of 127
// maps (median 0.97), measured by `lightParity` (fidelity.mjs). The numbers hold under the reflectivity
// they were calibrated with: hlrad's `-texreflectgamma 1.0 -texreflectscale 0.7` (TEXLIGHT_RAD_ARGS).
//
//   TEXLIGHTS          [{ name, rgb, value, group }]: the list for every map. `group`: "classic" (the
//                      Valve/ZHLT list), "recovered", "second" and "third" (three scans of the retail
//                      lightmaps), "liquid" (a `!` texture that glows)
//   TEXLIGHTS_BY_MAP   { map: [{ name, rgb, value }] }: where one map's light needed other values (it wins)
//   NOT_EMITTERS       textures that looked like emitters and are not: only `saturated` per cent of their
//                      retail luxels are at full brightness, where an emitter's own face is all at full
//                      (qrad lit an emitter's face with its whole value); lamps lit them
//   texlightsFor(map)  the list in force for a map; texlightsRad(map) the same as a lights.rad;
//                      texlightsEntity(map) as the keys of an info_texlights entity (source.mjs textureLights)
//
// A texture's numbers are its authors' measurements of Valve's maps; no picture of a texture is here.

/** What hlrad is told for the light these values were calibrated under: a texture reflects its linear average colour times 0.7. */
export const TEXLIGHT_RAD_ARGS = ["-texreflectgamma", "1.0", "-texreflectscale", "0.7"];

/** The texture lights for every map. */
export const TEXLIGHTS = [
  { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 5200, group: "classic" },
  { name: "+0~GENERIC85", rgb: [161, 217, 255], value: 20700, group: "classic" },
  { name: "+0~GENERIC86", rgb: [255, 241, 172], value: 16100, group: "classic" },
  { name: "+0~GENERIC86B", rgb: [133, 255, 224], value: 21000, group: "classic" },
  { name: "+0~GENERIC86R", rgb: [255, 0, 0], value: 13600, group: "classic" },
  { name: "GENERIC87A", rgb: [160, 255, 160], value: 1900, group: "classic" },
  { name: "GENERIC88A", rgb: [255, 160, 160], value: 1000, group: "classic" },
  { name: "GENERIC89A", rgb: [141, 141, 255], value: 1200, group: "classic" },
  { name: "GENERIC90A", rgb: [255, 255, 255], value: 1000, group: "classic" },
  { name: "GENERIC105", rgb: [255, 147, 148], value: 1400, group: "classic" },
  { name: "GENERIC106", rgb: [255, 255, 233], value: 1500, group: "classic" },
  { name: "GENERIC107", rgb: [254, 134, 255], value: 1500, group: "classic" },
  { name: "GEN_VEND1", rgb: [118, 255, 118], value: 2100, group: "classic" },
  { name: "EMERGLIGHT", rgb: [255, 226, 160], value: 60000, group: "classic" },
  { name: "+0~FIFTS_LGHT01", rgb: [210, 218, 255], value: 2500, group: "classic" },
  { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 2600, group: "classic" },
  { name: "+0~FIFTS_LGHT4", rgb: [210, 218, 255], value: 3000, group: "classic" },
  { name: "+0~LIGHT1", rgb: [131, 161, 255], value: 2500, group: "classic" },
  { name: "+0~LIGHT3A", rgb: [226, 226, 255], value: 27700, group: "classic" },
  { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 8600, group: "classic" },
  { name: "+0~LIGHT5A", rgb: [147, 181, 255], value: 7600, group: "classic" },
  { name: "+0~LIGHT6A", rgb: [255, 33, 33], value: 15900, group: "classic" },
  { name: "+0~TNNL_LGT1", rgb: [255, 250, 164], value: 17100, group: "classic" },
  { name: "+0~TNNL_LGT2", rgb: [255, 233, 110], value: 14500, group: "classic" },
  { name: "+0~TNNL_LGT3", rgb: [215, 215, 255], value: 5900, group: "classic" },
  { name: "+0~TNNL_LGT4", rgb: [255, 175, 119], value: 3200, group: "classic" },
  { name: "+0LAB1_W6D", rgb: [255, 255, 255], value: 4000, group: "classic" },
  { name: "+0LAB1_W6", rgb: [215, 223, 255], value: 9300, group: "classic" },
  { name: "+0LAB1_W7", rgb: [255, 252, 236], value: 2000, group: "classic" },
  { name: "SKKYLITE", rgb: [255, 209, 128], value: 1700, group: "classic" },
  { name: "+0~DRKMTLS1", rgb: [255, 2, 2], value: 2800, group: "classic" },
  { name: "+0~DRKMTLGT1", rgb: [255, 255, 255], value: 6000, group: "classic" },
  { name: "+0~DRKMTLS2", rgb: [255, 228, 151], value: 36400, group: "classic" },
  { name: "+0~DRKMTLS2C", rgb: [255, 226, 160], value: 42000, group: "classic" },
  { name: "+0DRKMTL_SCRN", rgb: [123, 143, 255], value: 36200, group: "classic" },
  { name: "~LAB_CRT9B", rgb: [169, 167, 255], value: 300, group: "classic" },
  { name: "~LIGHT3A", rgb: [255, 82, 82], value: 1700, group: "classic" },
  { name: "~LIGHT3B", rgb: [207, 207, 255], value: 4800, group: "classic" },
  { name: "~LIGHT3C", rgb: [255, 249, 210], value: 3300, group: "classic" },
  { name: "~LIGHT3E", rgb: [140, 255, 219], value: 3200, group: "classic" },
  { name: "C1A3C_MAP", rgb: [255, 255, 255], value: 100, group: "classic" },
  { name: "+0~LAB_CRT8", rgb: [123, 123, 255], value: 2600, group: "classic" },
  { name: "ELEV2_CIEL", rgb: [255, 227, 166], value: 1200, group: "classic" },
  { name: "YELLOW", rgb: [255, 226, 160], value: 3000, group: "classic" },
  { name: "RED", rgb: [255, 3, 2], value: 1700, group: "classic" },
  { name: "EXITLFT", rgb: [255, 255, 255], value: 39900, group: "recovered" },
  { name: "EXITRT", rgb: [255, 255, 255], value: 2400, group: "recovered" },
  { name: "FLATBED_LITE1", rgb: [255, 247, 230], value: 9000, group: "recovered" },
  { name: "~SPOTYELLOW", rgb: [255, 240, 203], value: 23100, group: "recovered" },
  { name: "~TRN_LT1", rgb: [255, 233, 217], value: 3300, group: "recovered" },
  { name: "~GENERIC87", rgb: [205, 242, 255], value: 25600, group: "recovered" },
  { name: "+0~FIFTS_LGHT5", rgb: [232, 255, 165], value: 12100, group: "recovered" },
  { name: "+0~LIGHT2A", rgb: [255, 255, 151], value: 2800, group: "recovered" },
  { name: "LITEPANEL1", rgb: [255, 241, 202], value: 400, group: "recovered" },
  { name: "TECH_LITE1", rgb: [255, 212, 131], value: 21400, group: "recovered" },
  { name: "+A~FIFTIES_LGT2", rgb: [247, 255, 205], value: 2000, group: "recovered" },
  { name: "FLATBED_HLITE2", rgb: [242, 255, 255], value: 1500, group: "recovered" },
  { name: "+0~FIFTS_LGHT3", rgb: [255, 171, 80], value: 9500, group: "recovered" },
  { name: "~LIGHT3F", rgb: [255, 222, 67], value: 9300, group: "recovered" },
  { name: "~LAB_CRT3", rgb: [167, 225, 255], value: 10500, group: "recovered" },
  { name: "~SPOTGREEN", rgb: [125, 255, 180], value: 9800, group: "recovered" },
  { name: "~LAB1_COMP7", rgb: [218, 232, 255], value: 5500, group: "recovered" },
  { name: "~LIGHT5D", rgb: [147, 255, 147], value: 900, group: "recovered" },
  { name: "SUBWAY_LIGHTS", rgb: [217, 224, 255], value: 2000, group: "recovered" },
  { name: "SKKYLITE2", rgb: [255, 168, 103], value: 700, group: "recovered" },
  { name: "+A~GENERIC78A", rgb: [255, 250, 228], value: 2500, group: "recovered" },
  { name: "~TRN_LT1B", rgb: [255, 255, 152], value: 4200, group: "recovered" },
  { name: "FIFTIES_MON3B", rgb: [255, 214, 124], value: 2700, group: "recovered" },
  { name: "C2A4_CMP1", rgb: [255, 248, 226], value: 1200, group: "second" },
  { name: "CRYS_2TOP", rgb: [142, 255, 215], value: 700, group: "second" },
  { name: "+0~GYMLIGHT", rgb: [255, 223, 123], value: 6100, group: "second" },
  { name: "~LIGHT5A", rgb: [255, 255, 200], value: 1000, group: "second" },
  { name: "FLATBED_TLITE2", rgb: [255, 156, 156], value: 2800, group: "second" },
  { name: "+A~FIFTS_LGHT3", rgb: [255, 217, 142], value: 2500, group: "second" },
  { name: "~LAB_CRT5", rgb: [166, 223, 255], value: 10800, group: "second" },
  { name: "~SPOTBLUE", rgb: [8, 200, 255], value: 16100, group: "second" },
  { name: "C3A2_LIGHT2", rgb: [255, 196, 0], value: 200, group: "second" },
  { name: "!TOXICGRN2", rgb: [71, 255, 0], value: 200, group: "liquid" },
  { name: "!TOXICGRN", rgb: [71, 255, 0], value: 400, group: "liquid" },
  { name: "!RADIO", rgb: [72, 255, 2], value: 300, group: "liquid" },
  { name: "!GWATER4A", rgb: [111, 255, 119], value: 200, group: "liquid" },
  { name: "FILL1", rgb: [190, 255, 190], value: 1700, group: "third" },
  { name: "FILL2", rgb: [255, 208, 147], value: 800, group: "third" },
  { name: "C3A2_LIGHT", rgb: [255, 168, 0], value: 2000, group: "third" },
  { name: "C3A2SIGN34", rgb: [255, 255, 255], value: 3300, group: "third" },
  { name: "C3A2SIGN45", rgb: [255, 202, 15], value: 2300, group: "third" },
  { name: "C3A2SIGN48", rgb: [255, 199, 9], value: 100, group: "third" },
  { name: "C3A2SIGN49", rgb: [255, 199, 11], value: 100, group: "third" },
  { name: "C3A2SIGN50", rgb: [255, 199, 9], value: 100, group: "third" },
  { name: "C3A2SIGN51", rgb: [255, 197, 12], value: 1500, group: "third" },
  { name: "~LAB1_COMP3B", rgb: [241, 255, 255], value: 22100, group: "third" },
];

/** Not emitters: kept for the record, never written. */
export const NOT_EMITTERS = [
  { name: "~LAB_CRT9A", rgb: [255, 225, 244], value: 100, saturated: 14, group: "classic" },
  { name: "~LAB_CRT9C", rgb: [195, 255, 235], value: 100, saturated: 7, group: "classic" },
  { name: "FIFTIES_MON1B", rgb: [183, 182, 255], value: 3100, saturated: 4, group: "classic" },
  { name: "+0~WHITE", rgb: [255, 255, 255], value: 5700, saturated: 5, group: "recovered" },
  { name: "C3A2SIGN07", rgb: [252, 254, 255], value: 1000, saturated: 6, group: "third" },
  { name: "C3A2SIGN16", rgb: [255, 255, 255], value: 200, saturated: 9, group: "third" },
  { name: "C3A2SIGN17", rgb: [255, 206, 173], value: 100, saturated: 3, group: "third" },
  { name: "+0RECHARGE", rgb: [156, 255, 75], value: 1000, saturated: 2, group: "third" },
  { name: "+0MEDKIT", rgb: [255, 246, 183], value: 1000, saturated: 1, group: "third" },
  { name: "AMMO02", rgb: [222, 232, 255], value: 500, saturated: 2, group: "third" },
];

/** Where one map needed other values: these win over TEXLIGHTS, by name. */
export const TEXLIGHTS_BY_MAP = {
  bounce: [{ name: "SUBWAY_LIGHTS", rgb: [217, 224, 255], value: 1300 }],
  c1a0b: [
    { name: "+0LAB1_W6", rgb: [215, 223, 255], value: 6800 },
    { name: "+0~DRKMTLS2", rgb: [255, 228, 151], value: 22700 },
    { name: "+0~GENERIC86B", rgb: [133, 255, 224], value: 10900 },
    { name: "+0~GENERIC86R", rgb: [255, 0, 0], value: 4400 },
    { name: "+0~LIGHT1", rgb: [131, 161, 255], value: 2100 },
    { name: "FLATBED_HLITE2", rgb: [242, 255, 255], value: 3700 },
    { name: "RED", rgb: [255, 3, 2], value: 1200 },
    { name: "+0~LIGHT5A", rgb: [147, 181, 255], value: 9200 },
  ],
  c1a3a: [
    { name: "+0~DRKMTLS2C", rgb: [255, 226, 160], value: 25400 },
    { name: "+0~FIFTIES_LGT2", rgb: [255, 255, 255], value: 8000 },
    { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 15000 },
    { name: "+0~LIGHT1", rgb: [131, 161, 255], value: 1600 },
    { name: "+0~LIGHT2A", rgb: [255, 255, 151], value: 1000 },
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 11100 },
    { name: "+A~FIFTIES_LGT2", rgb: [247, 255, 205], value: 3400 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 6300 },
    { name: "~LIGHT3C", rgb: [255, 249, 210], value: 5400 },
  ],
  c1a3d: [
    { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 6700 },
    { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 13200 },
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 10100 },
    { name: "+A~FIFTIES_LGT2", rgb: [247, 255, 205], value: 6200 },
    { name: "RED", rgb: [255, 10, 10], value: 2900 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 9700 },
    { name: "+0~DRKMTLS2C", rgb: [255, 226, 160], value: 34000 },
  ],
  c2a2: [
    { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 3600 },
    { name: "+0~FIFTS_LGHT5", rgb: [232, 255, 165], value: 15500 },
    { name: "+0~TNNL_LGT1", rgb: [255, 250, 164], value: 21900 },
    { name: "+0~TNNL_LGT2", rgb: [255, 233, 110], value: 23800 },
    { name: "+A~FIFTIES_LGT2", rgb: [247, 255, 205], value: 7500 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 10600 },
    { name: "~LIGHT3C", rgb: [255, 249, 210], value: 4400 },
  ],
  c2a2a: [
    { name: "+0~DRKMTLS1", rgb: [255, 2, 2], value: 3900 },
    { name: "+0~FIFTS_LGHT5", rgb: [232, 255, 165], value: 15800 },
    { name: "+0~GENERIC86", rgb: [255, 241, 172], value: 20600 },
    { name: "+0~GENERIC86B", rgb: [133, 255, 224], value: 26900 },
    { name: "+0~LIGHT6A", rgb: [255, 33, 33], value: 22000 },
    { name: "+0~TNNL_LGT1", rgb: [255, 250, 164], value: 21900 },
    { name: "+0~TNNL_LGT2", rgb: [255, 233, 110], value: 18500 },
    { name: "FLATBED_HLITE2", rgb: [242, 255, 255], value: 2000 },
    { name: "FLATBED_TLITE2", rgb: [255, 156, 156], value: 3900 },
    { name: "RED", rgb: [255, 3, 2], value: 2100 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 8400 },
    { name: "~LIGHT3C", rgb: [255, 249, 210], value: 4400 },
    { name: "~LIGHT3F", rgb: [255, 222, 67], value: 11000 },
  ],
  c2a3e: [{ name: "+0~GENERIC86", rgb: [255, 241, 172], value: 13300 }],
  c2a4b: [
    { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 6600 },
    { name: "+0~FIFTS_LGHT3", rgb: [255, 171, 80], value: 6900 },
    { name: "+0~FIFTS_LGHT5", rgb: [232, 255, 165], value: 9800 },
    { name: "+0~GENERIC86R", rgb: [255, 0, 0], value: 21100 },
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 13700 },
    { name: "+0~TNNL_LGT4", rgb: [255, 185, 123], value: 7400 },
    { name: "+A~FIFTS_LGHT3", rgb: [255, 217, 142], value: 11200 },
  ],
  c2a4d: [
    { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 600 },
    { name: "+0~FIFTS_LGHT01", rgb: [210, 218, 255], value: 2100 },
    { name: "+0~GENERIC86", rgb: [255, 241, 172], value: 3000 },
    { name: "+0~GENERIC86B", rgb: [133, 255, 224], value: 3200 },
    { name: "+0~GENERIC86R", rgb: [255, 0, 0], value: 5500 },
    { name: "RED", rgb: [255, 3, 2], value: 1200 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 1900 },
    { name: "~LIGHT3C", rgb: [255, 249, 210], value: 2700 },
    { name: "~SPOTYELLOW", rgb: [255, 240, 203], value: 6800 },
  ],
  c2a4e: [
    { name: "+0~FIFTIES_LGT2", rgb: [1, 131, 255], value: 1000 },
    { name: "+0~FIFTS_LGHT01", rgb: [210, 218, 255], value: 1600 },
    { name: "+0~FIFTS_LGHT5", rgb: [255, 255, 255], value: 5500 },
    { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 300 },
    { name: "+0~GENERIC86", rgb: [255, 241, 172], value: 3900 },
    { name: "+0~GENERIC86B", rgb: [133, 255, 224], value: 13200 },
    { name: "RED", rgb: [255, 0, 0], value: 1200 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 2100 },
    { name: "~LIGHT3C", rgb: [255, 249, 210], value: 2200 },
    { name: "~SPOTYELLOW", rgb: [255, 240, 203], value: 5200 },
    { name: "~TRN_LT1", rgb: [255, 233, 217], value: 2700 },
    { name: "~LIGHT5A", rgb: [255, 255, 200], value: 1200 },
  ],
  c2a4f: [
    { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 500 },
    { name: "+0~FIFTS_LGHT5", rgb: [232, 255, 165], value: 8800 },
    { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 2100 },
    { name: "+0~GENERIC86", rgb: [255, 241, 172], value: 3900 },
    { name: "+0~GENERIC86B", rgb: [133, 255, 224], value: 9500 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 1600 },
    { name: "~LIGHT3C", rgb: [255, 249, 210], value: 9000 },
    { name: "~LIGHT5A", rgb: [255, 255, 200], value: 1600 },
    { name: "~SPOTYELLOW", rgb: [255, 240, 203], value: 7400 },
  ],
  c3a2: [
    { name: "+0~FIFTIES_LGT2", rgb: [217, 224, 255], value: 6600 },
    { name: "+0~LIGHT3A", rgb: [226, 226, 255], value: 19200 },
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 13600 },
    { name: "+0~LIGHT6A", rgb: [255, 33, 33], value: 10100 },
    { name: "+A~FIFTIES_LGT2", rgb: [247, 255, 205], value: 3000 },
  ],
  c4a1c: [{ name: "TECH_LITE1", rgb: [255, 212, 131], value: 24700 }],
  c4a1e: [{ name: "TECH_LITE1", rgb: [255, 212, 131], value: 32600 }],
  disposal: [
    { name: "!GWATER4A", rgb: [111, 255, 119], value: 100 },
    { name: "!RADIO", rgb: [72, 255, 2], value: 100 },
    { name: "!TOXICGRN", rgb: [71, 255, 0], value: 100 },
    { name: "+0LAB1_W6", rgb: [215, 223, 255], value: 3700 },
    { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 2100 },
    { name: "+0~GENERIC85", rgb: [161, 217, 255], value: 6900 },
    { name: "+0~GENERIC86", rgb: [249, 255, 174], value: 7700 },
    { name: "+0~GENERIC86R", rgb: [255, 0, 0], value: 2200 },
    { name: "+0~LIGHT2A", rgb: [255, 255, 210], value: 1700 },
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 1400 },
    { name: "GENERIC105", rgb: [255, 147, 148], value: 200 },
    { name: "GENERIC89A", rgb: [141, 141, 255], value: 200 },
    { name: "~LIGHT3F", rgb: [255, 223, 67], value: 5900 },
    { name: "~TRN_LT1B", rgb: [255, 255, 152], value: 2000 },
  ],
  hldemo2: [
    { name: "+0~FIFTS_LGHT01", rgb: [210, 218, 255], value: 1600 },
    { name: "+0~GENERIC65", rgb: [255, 255, 255], value: 2500 },
    { name: "+0~GENERIC86", rgb: [255, 241, 172], value: 7000 },
    { name: "+0~LIGHT3A", rgb: [226, 226, 255], value: 17600 },
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 12300 },
    { name: "+0~LIGHT6A", rgb: [255, 33, 33], value: 13300 },
    { name: "GENERIC105", rgb: [255, 145, 145], value: 1000 },
  ],
  rustmill: [
    { name: "+0~LIGHT4A", rgb: [255, 249, 197], value: 16000 },
    { name: "+0~LIGHT5A", rgb: [147, 181, 255], value: 8700 },
    { name: "SKKYLITE2", rgb: [255, 168, 103], value: 600 },
    { name: "~LIGHT3B", rgb: [207, 207, 255], value: 5700 },
  ],
};

/** A map's name as the table keys it: its file's name without the folder, `.bsp` or `.map`, in lower case. */
const mapKey = (map) =>
  String(map ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.(bsp|map)$/i, "")
    .toLowerCase();

/**
 * The texture lights in force for a map: TEXLIGHTS with the map's own values over them, by name whatever its
 * case: [{ name, rgb, value }]. Without a map, TEXLIGHTS alone.
 */
export function texlightsFor(map) {
  const byName = new Map(TEXLIGHTS.map(({ name, rgb, value }) => [name.toLowerCase(), { name, rgb, value }]));
  for (const { name, rgb, value } of TEXLIGHTS_BY_MAP[mapKey(map)] ?? [])
    byName.set(name.toLowerCase(), { name, rgb, value });
  return [...byName.values()];
}

/**
 * The texture lights as a lights.rad, the file hlrad reads (one line a texture: name, red, green, blue,
 * brightness). Give it to hlrad as `-lights <file>`, with TEXLIGHT_RAD_ARGS:
 *   compileMap(file, { args: { hlrad: ["-lights", rad, ...TEXLIGHT_RAD_ARGS] } })
 */
export function texlightsRad(map) {
  const key = mapKey(map);
  const lines = [
    `// texture lights${key ? ` for ${key}` : ""}, calibrated against the retail lightmaps by goldsrc.net's bsp2map (smak texlights.mjs)`,
    ...texlightsFor(map).map(({ name, rgb, value }) => `${name}\t${rgb.join("\t")}\t${value}`),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The texture lights as the keys of an info_texlights entity, which Vluzacn's compilers and SDHLT read from
 * the map itself: `{ NAME: [r, g, b, brightness] }`, for `textureLights(origin, texlightsEntity(map))`.
 */
export function texlightsEntity(map) {
  return Object.fromEntries(texlightsFor(map).map(({ name, rgb, value }) => [name, [...rgb, value]]));
}
