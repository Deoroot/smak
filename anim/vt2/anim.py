"""A Vermintide 2 clip decoded and sampled: each bone's local position, rotation and scale at a time, and the
skeleton's world matrices from them. Local only.

Clip layout (as read here): u32 0, u32 tracks, f32 length (s), u32 size, u32 events, events x (f32 time, u32
hash), u16 rest form, tracks x the rest values at time 0 (form 7: 3f position, 4f rotation xyzw, 3f scale; form
1, 3 clips of the game's: packed as the keys are, 3 x u16, a u32 smallest-three, 3 x u16), then a stream of keys in the order
they are needed: u16 kind < 0x4000 is a float key (2: event u32 hash + f32 time; 4: position, 5: rotation, 6:
scale: u16 bone, f32 time, the floats); top bits 0b11 a packed rotation (bone in bits 4-13, u16 ms, u32
smallest-three: bits 0-1 the largest's index, three 10-bit fields for the next ones round, range +-0.75); 0b10 a
packed position (u16 ms, 3 x u16 over +-10 m); 0b01 a packed scale (as position). A 2-byte tail.
"""
import struct, math, bisect


def unpack_quat(v):
    big = v & 3
    vals = [((v >> (2 + 10 * i)) & 1023) / 1023 * 1.5 - 0.75 for i in range(3)]
    q = [0.0] * 4
    q[big] = math.sqrt(max(0.0, 1 - sum(x * x for x in vals)))
    for i, x in enumerate(vals):
        q[(big + 1 + i) % 4] = x
    return q


def read_clip(b):
    tracks, length = struct.unpack_from("<If", b, 4)
    (nev,) = struct.unpack_from("<I", b, 16)
    events = [struct.unpack_from("<fI", b, 20 + 8 * i) for i in range(nev)]
    at = 20 + 8 * nev + 2
    keys = {k: [[] for _ in range(tracks)] for k in ("pos", "rot", "scl")}
    form = struct.unpack_from("<H", b, at - 2)[0]
    u3 = lambda o: [(x / 65535 * 2 - 1) * 10 for x in struct.unpack_from("<3H", b, o)]
    for i in range(tracks):
        if form == 7:
            p = struct.unpack_from("<3f", b, at); q = struct.unpack_from("<4f", b, at + 12); s = struct.unpack_from("<3f", b, at + 28)
            at += 40
        else:
            p, q, s = u3(at), unpack_quat(struct.unpack_from("<I", b, at + 6)[0]), u3(at + 10)
            at += 16
        keys["pos"][i].append((0.0, list(p))); keys["rot"][i].append((0.0, list(q))); keys["scl"][i].append((0.0, list(s)))
    end = len(b) - 2
    while at + 4 <= end:
        h, w = struct.unpack_from("<HH", b, at)
        top = h >> 14
        if top == 0:
            if h == 2:
                hsh, t = struct.unpack_from("<If", b, at + 2); events.append((t, hsh)); at += 10; continue
            t = struct.unpack_from("<f", b, at + 4)[0]
            if h == 4: keys["pos"][w].append((t, list(struct.unpack_from("<3f", b, at + 8)))); at += 20
            elif h == 5: keys["rot"][w].append((t, list(struct.unpack_from("<4f", b, at + 8)))); at += 24
            elif h == 6: keys["scl"][w].append((t, list(struct.unpack_from("<3f", b, at + 8)))); at += 20
            else: raise ValueError(f"key kind {h} at {at}")
            continue
        bone, t = (h >> 4) & 0x3FF, w / 1000
        if top == 3:
            keys["rot"][bone].append((t, unpack_quat(struct.unpack_from("<I", b, at + 4)[0]))); at += 8
        else:
            v = [(x / 65535 * 2 - 1) * 10 for x in struct.unpack_from("<3H", b, at + 4)]
            keys["pos" if top == 2 else "scl"][bone].append((t, v)); at += 10
    for k in keys:
        for i in range(tracks):
            keys[k][i].sort(key=lambda x: x[0])
    return {"tracks": tracks, "length": length, "events": sorted(events), "keys": keys}


def _at(track, t, rot):
    ts = [k[0] for k in track]
    j = bisect.bisect_right(ts, t)
    if j == 0: return track[0][1]
    if j >= len(track): return track[-1][1]
    (t0, a), (t1, b) = track[j - 1], track[j]
    u = (t - t0) / (t1 - t0) if t1 > t0 else 0
    if rot:
        if sum(x * y for x, y in zip(a, b)) < 0: b = [-x for x in b]
        q = [x + (y - x) * u for x, y in zip(a, b)]
        n = math.sqrt(sum(x * x for x in q)) or 1
        return [x / n for x in q]
    return [x + (y - x) * u for x, y in zip(a, b)]


def local(clip, bone, t):
    k = clip["keys"]
    return _at(k["pos"][bone], t, False), _at(k["rot"][bone], t, True), _at(k["scl"][bone], t, False)


def matrix(p, q, s):
    x, y, z, w = q
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], p[i]] for i in range(3)]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) + (a[i][3] if j == 3 else 0) for j in range(4)] for i in range(3)]


def world(clip, parents, t):
    out = [None] * len(parents)
    for i, p in enumerate(parents):
        m = matrix(*local(clip, i, t))
        out[i] = m if p < 0 else mul(out[p], m)
    return out
