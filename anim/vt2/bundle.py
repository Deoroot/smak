"""Vermintide 2 (Stingray) bundles: decompress one and list what it holds. Read-only on the game's files.

    python bundle.py <bundle file> [--dump <dir>]

Layout as read here: u32 version (0xF0000007), u32 size uncompressed, u32 0, then chunks of u32 size + a zstd
frame (dictionary bundle/compression.dictionary), 64 KiB each uncompressed.
"""
import struct, sys, os, zstandard

GAME = "C:/Juegos/Steam/steamapps/common/Warhammer Vermintide 2/bundle"
_dict = None


def dctx():
    global _dict
    if _dict is None:
        _dict = zstandard.ZstdCompressionDict(open(os.path.join(GAME, "compression.dictionary"), "rb").read())
    return zstandard.ZstdDecompressor(dict_data=_dict)


def decompress(path):
    b = open(path, "rb").read()
    version, size, zero = struct.unpack_from("<III", b, 0)
    at, out, d = 12, bytearray(), dctx()
    while len(out) < size and at < len(b):
        (n,) = struct.unpack_from("<I", b, at)
        at += 4
        chunk = b[at : at + n]
        at += n
        if chunk[:4] == b"\x28\xb5\x2f\xfd":
            out += d.decompress(chunk, max_output_size=0x10000)
        else:
            out += chunk  # stored
    return version, bytes(out[:size])


if __name__ == "__main__":
    path = sys.argv[1]
    version, data = decompress(path)
    print(f"version {version:#x} size {len(data)}")
    print(data[:320].hex(" ", 4))
