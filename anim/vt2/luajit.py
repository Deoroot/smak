"""LuaJIT 2 bytecode (as the game ships its scripts): every function's constants, including the constant table
templates (TDUP) that hold most of a weapon template's scalar fields. Local only.

    python luajit.py out/lua/<hash>
"""
import struct, sys


class R:
    def __init__(self, b, at=0):
        self.b, self.at = b, at

    def u8(self):
        v = self.b[self.at]; self.at += 1; return v

    def uleb(self):
        v = sh = 0
        while True:
            c = self.u8(); v |= (c & 0x7F) << sh; sh += 7
            if c < 0x80: return v

    def uleb33(self):
        c = self.u8(); isnum = c & 1; v = (c >> 1) & 0x3F; sh = 6
        if c >= 0x80:
            while True:
                c = self.u8(); v |= (c & 0x7F) << sh; sh += 7
                if c < 0x80: break
        return isnum, v

    def raw(self, n):
        v = self.b[self.at:self.at + n]; self.at += n; return v


def num(lo, hi):
    return struct.unpack("<d", struct.pack("<II", lo & 0xFFFFFFFF, hi & 0xFFFFFFFF))[0]


def ktabk(r):
    t = r.uleb()
    if t == 0: return None
    if t == 1: return False
    if t == 2: return True
    if t == 3:
        v = r.uleb(); return v - (1 << 32) if v >= 1 << 31 else v
    if t == 4:
        lo = r.uleb(); hi = r.uleb(); return num(lo, hi)
    return r.raw(t - 5).decode("latin-1")


class Proto:
    pass


def read(b):
    at = b.find(b"\x1bLJ")
    r = R(b, at + 3)
    ver = r.u8(); flags = r.uleb()
    strip = flags & 2
    name = None if strip else r.raw(r.uleb()).decode("latin-1")
    protos = []
    while True:
        if r.at >= len(b): break
        plen = r.uleb()
        if plen == 0: break
        end = r.at + plen
        p = Proto()
        p.flags, p.nparams, p.frame, p.nuv = r.u8(), r.u8(), r.u8(), r.u8()
        nkgc, nkn, nbc = r.uleb(), r.uleb(), r.uleb()
        dlen = 0
        if not strip:
            dlen = r.uleb()
            if dlen:
                p.line, p.nline = r.uleb(), r.uleb()
        p.bc = [struct.unpack_from("<I", b, r.at + 4 * i)[0] for i in range(nbc)]; r.at += 4 * nbc
        p.uv = [struct.unpack_from("<H", b, r.at + 2 * i)[0] for i in range(p.nuv)]; r.at += 2 * p.nuv
        p.kgc = []
        for _ in range(nkgc):
            t = r.uleb()
            if t == 0:
                p.kgc.append(("child", protos.pop() if protos else None))
            elif t == 1:
                na, nh = r.uleb(), r.uleb()
                arr = [ktabk(r) for _ in range(na)]
                h = {}
                for _ in range(nh):
                    k = ktabk(r); h[k] = ktabk(r)
                p.kgc.append(("tab", (arr, h)))
            elif t in (2, 3):
                lo, hi = r.uleb(), r.uleb(); p.kgc.append(("int64", lo | hi << 32))
            elif t == 4:
                a, b2, c, d = r.uleb(), r.uleb(), r.uleb(), r.uleb(); p.kgc.append(("complex", (num(a, b2), num(c, d))))
            else:
                p.kgc.append(("str", r.raw(t - 5).decode("latin-1")))
        p.kn = []
        for _ in range(nkn):
            isnum, lo = r.uleb33()
            if isnum:
                hi = r.uleb(); p.kn.append(num(lo, hi))
            else:
                p.kn.append(lo - (1 << 32) if lo >= 1 << 31 else lo)
        r.at = end
        protos.append(p)
    return name, protos


# LuaJIT 2.1 opcodes used to build tables (numbers as this game's build has them)
KSTR, KSHORT, KNUM, KPRI, MOV, FNEW, TNEW, TDUP, GGET, GSET, TGETS, TSETV, TSETS, TSETB = 39, 41, 42, 43, 18, 51, 52, 53, 54, 55, 57, 60, 61, 62
MULVN, ADDVN, SUBVN, DIVVN = 24, 22, 23, 25
RET1, CALL, TGETV = 76, 66, 56


class Sym(str):
    """A value the reader can't know (a call's result, a global, an expression)."""


def run(p):
    """The main chunk run for its tables only: returns the globals it sets and every table, by the path it was
    first stored at."""
    nk = len(p.kgc)
    K = lambda d: p.kgc[nk - 1 - d][1]
    reg, G, paths = {}, {}, {}
    def put(t, k, v, path):
        if isinstance(t, dict):
            t[k] = v
            if isinstance(v, dict) and id(v) not in paths:
                paths[id(v)] = (path, v)
    def name(t):
        return paths.get(id(t), ("?",))[0] if isinstance(t, dict) else str(t)
    for ins in p.bc:
        op, a, c, b, d = ins & 0xFF, (ins >> 8) & 0xFF, (ins >> 16) & 0xFF, ins >> 24, ins >> 16
        if op == KSTR: reg[a] = K(d)
        elif op == KSHORT: reg[a] = d - 65536 if d >= 32768 else d
        elif op == KNUM: reg[a] = p.kn[d]
        elif op == KPRI: reg[a] = [None, False, True][d] if d < 3 else None
        elif op == MOV: reg[a] = reg.get(d)
        elif op == TNEW: reg[a] = {}
        elif op == TDUP:
            arr, h = K(d); t = dict(h)
            for i, v in enumerate(arr):
                if v is not None: t[i] = v
            reg[a] = t
        elif op == GGET:
            g = K(d)
            if g not in G:  # a global read before it is set: a table to fill
                G[g] = {}; paths[id(G[g])] = (g, G[g])
            reg[a] = G[g]
        elif op == GSET:
            G[K(d)] = reg.get(a)
            if isinstance(reg.get(a), dict) and id(reg[a]) not in paths: paths[id(reg[a])] = (K(d), reg[a])
        elif op == TGETS:
            t, k = reg.get(b), K(c)
            reg[a] = t[k] if isinstance(t, dict) and k in t else Sym(f"{name(t)}.{k}")
        elif op == TGETV:
            t, k = reg.get(b), reg.get(c)
            reg[a] = t[k] if isinstance(t, dict) and isinstance(k, (str, int)) and k in t else Sym(f"{name(t)}.{k}")
        elif op == TSETS:
            t = reg.get(b); put(t, K(c), reg.get(a), f"{name(t)}.{K(c)}")
        elif op == TSETB:
            t = reg.get(b); put(t, c, reg.get(a), f"{name(t)}[{c}]")
        elif op == TSETV:
            t, k = reg.get(b), reg.get(c)
            if isinstance(k, (str, int, float)): put(t, k, reg.get(a), f"{name(t)}.{k}")
        elif op in (MULVN, ADDVN, SUBVN, DIVVN):
            x, n = reg.get(b), p.kn[c] if c < len(p.kn) else None
            if isinstance(x, (int, float)) and not isinstance(x, bool) and isinstance(n, (int, float)):
                reg[a] = {MULVN: x * n, ADDVN: x + n, SUBVN: x - n, DIVVN: x / n if n else None}[op]
            else: reg[a] = Sym("expr")
        elif op == FNEW: reg[a] = Sym("function")
        elif op == CALL:
            # table.clone / table.create_copy (weapon_template): the copy is read as the table itself
            f, args = reg.get(a), [reg.get(a + 1 + i) for i in range(c - 1)]
            tabs = [x for x in args if isinstance(x, dict) and x]
            # any other call's result: a table to fill (Script.new_table() for ItemMasterList)
            reg[a] = tabs[-1] if isinstance(f, str) and f.startswith("table.") and tabs else {}
        elif op == RET1:
            G["<return>"] = reg.get(a)  # what the chunk returns (a module's table)
            break
        else:
            reg[a] = Sym("?")  # anything else: its target register becomes unknown
    return G, paths


if __name__ == "__main__":
    name, protos = read(open(sys.argv[1], "rb").read())
    print(name, len(protos), "functions")
    main = protos[-1]
    for kind, v in main.kgc:
        if kind == "tab":
            arr, h = v
            if h: print({k: h[k] for k in h})
