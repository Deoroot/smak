"""A compiled Stingray animation state machine, as far as it's needed: its layers, each layer's states with name
hash, clips and the events that leave them. Read-only.

Layout (as read here): u32 default state, u32 states, then the states; later layers the same, one after another.
A state: u64 x3 (the second is the state's name hash), u32 kind (0 clip, 2 blend...), u32 clips, clips x u64
animation hash, u32 weights, weights x f32, u32, u32, u8, u32 events, events x (u32 upper half of the event's
name hash, u32 transition, u8), u32 transitions, transitions x (u32 target state in the layer, f32 blend time, u32
mode, u32, u32, u32, u32), then a part not read here (variables, root motion...) ending in 0xFFFFFFFF. States
are found by their shape, not by reading that last part, so a layer whose first state has no clips can merge into
the previous layer: such layers are flagged (count != states found).
"""
import struct


def read(sm, anims, limit=400, split=False):
    """limit: the most events, transitions and states a layer may have (the third-person machines' full-body layer
    has some 1,600 states; 400 keeps the first-person reading as it was). split: cut a layer that ran into the ones
    after it at its count (the third-person machines; off by default, so the first-person reading is unchanged)."""
    u32 = lambda a: struct.unpack_from("<I", sm, a)[0]
    u64 = lambda a: struct.unpack_from("<Q", sm, a)[0]

    def head(at):
        start = at
        at += 24
        kind, n = u32(at), u32(at + 4); at += 8
        clips = [u64(at + 8 * i) for i in range(n)]; at += 8 * n
        nw = u32(at); weights = struct.unpack_from(f"<{nw}f", sm, at + 4); at += 4 + 4 * nw + 9
        ne = u32(at); events = [(u32(at + 4 + 9 * i), u32(at + 8 + 9 * i)) for i in range(ne)]; at += 4 + 9 * ne
        nt = u32(at); trans = [struct.unpack_from("<IfIIIII", sm, at + 4 + 28 * i) for i in range(nt)]; at += 4 + 28 * nt
        return dict(at=start, name=u64(start + 8), kind=kind, clips=clips, weights=weights,
                    events=events, trans=trans, end=at)

    def plausible(s):
        try:
            if u32(s + 28) > 64 or u32(s + 24) > 16: return None
            h = head(s)
            if len(h["events"]) < limit and len(h["trans"]) < limit and all(t[0] < limit for t in h["trans"]) \
                    and all(e[1] < len(h["trans"]) for e in h["events"]) and h["end"] <= len(sm):
                return h
        except (struct.error, IndexError, ValueError):
            pass
        return None

    with_clips = {a - 32 for a in range(32, len(sm) - 8)
                  if u64(a) in anims and 0 < u32(a - 4) < 64 and u32(a - 8) < 16}
    cands = sorted(with_clips | {a + 4 for a in range(4, len(sm) - 40) if u32(a) == 0xFFFFFFFF and plausible(a + 4)})
    states = {s: plausible(s) for s in cands}
    states = {s: h for s, h in states.items() if h}
    order = sorted(states)
    heads = [s for s in order if s == 8 or (s in with_clips and u32(s - 12) == 0xFFFFFFFF and u32(s - 4) > 0)]
    layers = []
    for i, s in enumerate(heads):
        end = heads[i + 1] if i + 1 < len(heads) else len(sm)
        st = [states[x] for x in order if s <= x < end]
        if split and len(st) > u32(s - 4) > 0:
            # a layer holding more states than it counts ran into the layers after it (their first state has no
            # clips): cut it at its count, and each layer after at its own (u32 default, u32 count before its first
            # state), as long as that header reads as one
            prev_end = None
            while st:
                head_at = st[0]["at"]
                d, c = u32(head_at - 8), u32(head_at - 4)
                lead = []
                if not (0 < c <= len(st) and (d < c or prev_end is None)) and prev_end is not None:
                    # the layer's first state is of a kind not read here (a blend of no clips): its header is
                    # further back, (0xFFFFFFFF, u32 default, u32 count) then that state; a placeholder keeps the
                    # transitions' indices (they count it)
                    for a in range(prev_end, head_at - 8):
                        dd, cc = u32(a + 4), u32(a + 8)
                        if u32(a) == 0xFFFFFFFF and dd < cc and 0 < cc - len(st[:cc]) <= 4:
                            d, c = dd, cc
                            lead = [dict(at=a + 12, name=u64(a + 20) if i == 0 else 0, kind=None, clips=[], weights=(),
                                         events=[], trans=[], end=a + 12, unread=True) for i in range(cc - len(st[:cc]))]
                            break
                if not (0 < c <= len(st) + len(lead)):
                    layers.append(dict(at=head_at, default=d, count=c, states=st, exact=False)); break
                take = c - len(lead)
                layers.append(dict(at=head_at, default=d, count=c, states=lead + st[:take], exact=True))
                prev_end = st[take - 1]["end"]; st = st[take:]
            continue
        layers.append(dict(at=s, default=u32(s - 8), count=u32(s - 4), states=st, exact=len(st) == u32(s - 4)))
    return layers


def resolve(layers, event_hash64):
    """Every state an event can lead to, as [(layer index, state index, state, source states)]: the states named as
    the event (sources empty: reached by name), and in every exact layer the targets of the event's transitions,
    with the states they are taken from. A ranged weapon's layer holds several states of one name (hip fire and
    zoomed, loaded and empty), each reached from its own context: all are kept."""
    hi = event_hash64 >> 32
    out = {}
    for i, L in enumerate(layers):
        for k, s in enumerate(L["states"]):
            if s["name"] == event_hash64:
                out.setdefault((i, k), [])
        if not L["exact"]:
            continue
        for s in L["states"]:
            for h, t in s["events"]:
                if h == hi:
                    k = s["trans"][t][0]
                    if k < len(L["states"]):
                        out.setdefault((i, k), []).append(s["name"])
    return [(i, k, layers[i]["states"][k], src) for (i, k), src in sorted(out.items())]
