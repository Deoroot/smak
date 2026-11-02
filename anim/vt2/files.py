"""A bundle's files, whole: [(type, name, variants: [(language, data, stream_size)])]. Read-only on the game.

The decompressed bundle: u32 count, 256 bytes of properties, count x (u64 type, u64 name, u32 flags, u32 size),
then each file: u64 type, u64 name, u32 variants, u32 stream offset, variants x (u32 language, u32 size, u32
stream size), then the variants' data one after another.
"""
import struct
from bundle import decompress


def files(path):
    _, b = decompress(path)
    (count,) = struct.unpack_from("<I", b, 0)
    at = 4 + 256 + count * 24
    out = []
    for _ in range(count):
        t, nm, nv, stream_at = struct.unpack_from("<QQII", b, at)
        at += 24
        heads = [struct.unpack_from("<III", b, at + 12 * i) for i in range(nv)]
        at += 12 * nv
        vs = []
        for lang, size, ssize in heads:
            vs.append((lang, b[at : at + size], ssize))
            at += size
        out.append((t, nm, vs))
    return out
