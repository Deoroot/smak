"""Every bundle's index: how many files of each type, and their sizes. Read-only.

    python types.py [--limit N]
"""
import struct, sys, os, collections
from bundle import GAME, dctx

M = 0xC6A4A7935BD1E995
MASK = (1 << 64) - 1


def murmur64(s, seed=0):
    """MurmurHash64A, as Stingray names its resources."""
    data = s.encode() if isinstance(s, str) else s
    r, n = 47, len(data)
    h = (seed ^ (n * M)) & MASK
    for i in range(0, n - n % 8, 8):
        (k,) = struct.unpack_from("<Q", data, i)
        k = (k * M) & MASK
        k ^= k >> r
        k = (k * M) & MASK
        h ^= k
        h = (h * M) & MASK
    tail = data[n - n % 8 :]
    for i in range(len(tail) - 1, -1, -1):
        h ^= tail[i] << (8 * i)
    if tail:
        h = (h * M) & MASK
    h ^= h >> r
    h = (h * M) & MASK
    h ^= h >> r
    return h


TYPES = """animation animation_curves apb bik bones bsi_ lua material mesh mod package particles physics physics_properties
render_config scene shader shader_library shader_library_group shading_environment shading_environment_mapping slug
slug_album sound_environment spu_job state_machine strings surface_properties texture timpani_bank timpani_master
tome unit vector_field wwise_bank wwise_dep wwise_metadata wwise_stream level navdata network_config entity flow
font data config ivf script_flow_nodes sound_environment strings level_set apex_cloth baked_lighting chroma
import_options keys timeline volume_type wav ogg dds texture_category shader_node mouse_cursor flow_editor
""".split()
NAMES = {murmur64(t): t for t in TYPES}


def index(path, d=None):
    """The bundle's entries: [(type, name, size)], decompressing only as far as the index reaches."""
    d = d or dctx()
    b = open(path, "rb").read()
    (size,) = struct.unpack_from("<I", b, 4)
    at, out = 12, bytearray()
    need = 4
    while len(out) < need and at < len(b):
        (n,) = struct.unpack_from("<I", b, at)
        chunk = b[at + 4 : at + 4 + n]
        at += 4 + n
        out += d.decompress(chunk, max_output_size=0x10000) if chunk[:4] == b"\x28\xb5\x2f\xfd" else chunk
        if len(out) >= 4:
            (count,) = struct.unpack_from("<I", out, 0)
            need = 4 + 256 + count * 24
    (count,) = struct.unpack_from("<I", out, 0)
    entries = []
    for i in range(count):
        t, nm, flags, sz = struct.unpack_from("<QQII", out, 4 + 256 + i * 24)
        entries.append((t, nm, sz))
    return entries


if __name__ == "__main__":
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    d = dctx()
    files = [f for f in sorted(os.listdir(GAME)) if len(f) == 16][:limit]
    count, total, where = collections.Counter(), collections.Counter(), collections.defaultdict(set)
    for f in files:
        try:
            for t, nm, sz in index(os.path.join(GAME, f), d):
                count[t] += 1
                total[t] += sz
                where[t].add(f)
        except Exception as e:
            print("skip", f, e)
    print(f"{len(files)} bundles")
    for t, n in count.most_common():
        print(f"{NAMES.get(t, hex(t)):24} {n:7} files {total[t] / 1e6:9.1f} MB  in {len(where[t])} bundles")
