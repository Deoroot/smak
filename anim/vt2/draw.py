"""Stick figures of a clip's arms in the camera's space: from the eye (top row) and from above (bottom row)."""
import sys, json, math, zlib, struct
from anim import read_clip, world
sk = json.load(open("out/fp_skeleton.json")); names, parents = sk["names"], sk["parents"]
B = {n: i for i, n in enumerate(names)}
CHAINS = [["j_leftshoulder", "j_leftarm", "j_leftforearm", "j_lefthand", "j_leftweaponattach"],
          ["j_rightshoulder", "j_rightarm", "j_rightforearm", "j_righthand", "j_rightweaponattach"]]
def inv_apply(m, p):
    d = [p[i] - m[i][3] for i in range(3)]
    return [sum(m[r][c] * d[r] for r in range(3)) for c in range(3)]
clip = read_clip(open("out/anim/" + sys.argv[1], "rb").read())
frames = int(sys.argv[2]) if len(sys.argv) > 2 else 8
S = 200
W, H = S * frames, S * 2
img = bytearray([30, 32, 40] * W * H)
def dot(x, y, col, r=1):
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            if 0 <= x + dx < W and 0 <= y + dy < H: img[3 * ((y + dy) * W + x + dx):3 * ((y + dy) * W + x + dx) + 3] = bytes(col)
def line(a, b, col):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    for k in range(n + 1): dot(int(a[0] + (b[0] - a[0]) * k / n), int(a[1] + (b[1] - a[1]) * k / n), col)
# which camera axis is forward: the one the hands sit furthest along at rest
W0 = world(clip, parents, 0); cam0 = W0[B["camera_node"]]
h0 = inv_apply(cam0, [W0[B["j_righthand"]][i][3] for i in range(3)])
fwd = max(range(3), key=lambda i: abs(h0[i])); sgn = 1 if h0[fwd] > 0 else -1
side, up = [i for i in range(3) if i != fwd]
print("hand at rest in camera space", [round(x, 3) for x in h0], "forward axis", "xyz"[fwd], sgn)
for k in range(frames):
    t = clip["length"] * k / (frames - 1)
    Wt = world(clip, parents, t); cam = Wt[B["camera_node"]]
    for ci, chain in enumerate(CHAINS):
        pts = [inv_apply(cam, [Wt[B[n]][i][3] for i in range(3)]) for n in chain]
        col = (230, 120, 90) if ci == 0 else (120, 200, 240)
        eye = [(k * S + S / 2 + p[side] / max(0.05, p[fwd] * sgn) * S * 0.45, S / 2 - p[up] / max(0.05, p[fwd] * sgn) * S * 0.45) for p in pts]
        top = [(k * S + S / 2 + p[side] * S * 0.6, S + S * 0.85 - p[fwd] * sgn * S * 0.6) for p in pts]
        for v in (eye, top):
            for a, b in zip(v, v[1:]): line(a, b, col)
            dot(int(v[-1][0]), int(v[-1][1]), (255, 255, 255), 2)
raw = b"".join(b"\0" + bytes(img[3 * W * y:3 * W * (y + 1)]) for y in range(H))
png = b"\x89PNG\r\n\x1a\n" + b"".join(struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d)) for t, d in [(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)), (b"IDAT", zlib.compress(raw)), (b"IEND", b"")])
open(sys.argv[3] if len(sys.argv) > 3 else "clip.png", "wb").write(png)
