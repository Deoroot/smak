// Valve's ICE cipher (Matthew Kwan's Information Concealment Engine, as Valve's IceKey.cpp has it), read only
// so a survey can see what a game's own scripts say: Left 4 Dead 2 ships its VScripts as `.nuc`, which are
// the `.nut` text under Thin-ICE (level 0, 8 rounds) with the key "SDhfi878". Blocks of 8 bytes; a last part
// shorter than a block is left as it is. Decrypted text is looked at, never written anywhere.
//
//   iceDecrypt(buffer, key, { level })   a Buffer of the same length
//   iceEncrypt(buffer, key, { level })   the reverse (for the tests)
//   NUC_KEY                              Left 4 Dead 2's key for its .nuc scripts
export const NUC_KEY = "SDhfi878";

const SMOD = [[333, 313, 505, 369], [379, 375, 319, 391], [361, 445, 451, 397], [397, 425, 395, 505]];
const SXOR = [[0x83, 0x85, 0x9b, 0xcd], [0xcc, 0xa7, 0xad, 0x41], [0x4b, 0x2e, 0xd4, 0x33], [0xea, 0xcb, 0x2e, 0x04]];
const PBOX = [
  0x00000001, 0x00000080, 0x00000400, 0x00002000, 0x00080000, 0x00200000, 0x01000000, 0x40000000,
  0x00000008, 0x00000020, 0x00000100, 0x00004000, 0x00010000, 0x00800000, 0x04000000, 0x20000000,
  0x00000004, 0x00000010, 0x00000200, 0x00008000, 0x00020000, 0x00400000, 0x08000000, 0x10000000,
  0x00000002, 0x00000040, 0x00000800, 0x00001000, 0x00040000, 0x00100000, 0x02000000, 0x80000000,
];
const KEYROT = [0, 1, 2, 3, 2, 1, 3, 0, 1, 3, 2, 0, 3, 1, 0, 2];

const gfMult = (a, b, m) => {
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    a <<= 1;
    b >>= 1;
    if (a >= 256) a ^= m;
  }
  return result;
};
const gfExp7 = (b, m) => {
  if (b === 0) return 0;
  let x = gfMult(b, b, m);
  x = gfMult(b, x, m);
  x = gfMult(x, x, m);
  return gfMult(b, x, m);
};
const perm32 = (x) => {
  let result = 0;
  for (let i = 0; x; i++, x >>>= 1) if (x & 1) result |= PBOX[i];
  return result >>> 0;
};
let SBOX = null;
const sboxes = () => {
  if (SBOX) return SBOX;
  SBOX = [0, 1, 2, 3].map(() => new Uint32Array(1024));
  for (let i = 0; i < 1024; i++) {
    const col = (i >> 1) & 0xff;
    const row = (i & 1) | ((i & 0x200) >> 8);
    for (let s = 0; s < 4; s++) SBOX[s][i] = perm32((gfExp7(col ^ SXOR[s][row], SMOD[s][row]) << (24 - s * 8)) >>> 0);
  }
  return SBOX;
};

/** The key schedule: `rounds` subkeys of three 20-bit words. */
function scheduleOf(key, level) {
  const size = level < 1 ? 1 : level;
  const rounds = level < 1 ? 8 : level * 16;
  const k = Buffer.from(key, "latin1");
  const schedule = Array.from({ length: rounds }, () => [0, 0, 0]);
  const build = (kb, n, rot) => {
    for (let i = 0; i < 8; i++) {
      const kr = KEYROT[rot + i];
      const sk = schedule[n + i];
      for (let j = 0; j < 15; j++)
        for (let q = 0; q < 4; q++) {
          const at = (kr + q) & 3;
          const bit = kb[at] & 1;
          sk[j % 3] = ((sk[j % 3] << 1) | bit) >>> 0;
          kb[at] = (kb[at] >> 1) | ((bit ^ 1) << 15);
        }
    }
  };
  if (rounds === 8) {
    const kb = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) kb[3 - i] = ((k[i * 2] ?? 0) << 8) | (k[i * 2 + 1] ?? 0);
    build(kb, 0, 0);
  } else
    for (let i = 0; i < size; i++) {
      const kb = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) kb[3 - j] = ((k[i * 8 + j * 2] ?? 0) << 8) | (k[i * 8 + j * 2 + 1] ?? 0);
      build(kb, i * 8, 0);
      build(kb, rounds - 8 - i * 8, 8); // the same words, as the first build left them
    }
  return schedule;
}

const roundF = (p, sk) => {
  const S = sboxes();
  const tl = ((p >>> 16) & 0x3ff) | (((p >>> 14) | (p << 18)) & 0xffc00);
  const tr = (p & 0x3ff) | ((p << 2) & 0xffc00);
  let al = sk[2] & (tl ^ tr);
  let ar = al ^ tr;
  al ^= tl;
  al ^= sk[0];
  ar ^= sk[1];
  return (S[0][al >>> 10] | S[1][al & 0x3ff] | S[2][ar >>> 10] | S[3][ar & 0x3ff]) >>> 0;
};

function run(buffer, key, level, decrypt) {
  const schedule = scheduleOf(key, level);
  const rounds = schedule.length;
  const out = Buffer.from(buffer);
  for (let at = 0; at + 8 <= out.length; at += 8) {
    let l = out.readUInt32BE(at);
    let r = out.readUInt32BE(at + 4);
    if (decrypt)
      for (let i = rounds - 1; i > 0; i -= 2) {
        l = (l ^ roundF(r, schedule[i])) >>> 0;
        r = (r ^ roundF(l, schedule[i - 1])) >>> 0;
      }
    else
      for (let i = 0; i < rounds; i += 2) {
        l = (l ^ roundF(r, schedule[i])) >>> 0;
        r = (r ^ roundF(l, schedule[i + 1])) >>> 0;
      }
    out.writeUInt32BE(r, at);
    out.writeUInt32BE(l, at + 4);
  }
  return out;
}

export const iceDecrypt = (buffer, key = NUC_KEY, { level = 0 } = {}) => run(buffer, key, level, true);
export const iceEncrypt = (buffer, key = NUC_KEY, { level = 0 } = {}) => run(buffer, key, level, false);
