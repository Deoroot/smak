// A GoldSrc demo (.dem, the console's `record`) read: what the client knew every frame. The engine writes, with each
// network message it took in, the view's parameters it drew that frame with (ref_params_t: where the player is as
// the client predicted them, their speed, whether on the ground, the eye's height), the command the client sent
// (usercmd_t) and the server's movement settings (movevars_t). So a demo of a run is a trace of the player's own
// movement, frame by frame, as exact as the game had it, with the rules it moved by.
//
//   readDemo(bytes) -> { map, gameDir, demoProtocol, netProtocol, frames, commands }
//     frames: [{ time, frametime, origin, velocity, onGround, waterLevel, viewHeight, viewAngles, cmd, movevars }]
//             each network message's (types 0 and 1), in order; cmd { msec, forward, side, up, buttons, viewAngles }
//     commands: [{ time, command }] the console commands the demo kept (type 3)
//
// The layout is the engine's (Xash3D's client/cl_demo.c, which reads Half-Life's demos): a header (HLDEMO, the demo
// protocol 5, the network protocol, the map, the game's folder, the map's CRC, where the directory is), the frames
// of each segment (the loading one and the playback one), and the directory last. A frame is its type (a byte),
// time (float) and frame number (int), then its own fields.
const HEADER = 544;
const ENTRY = 92;
/** demo_info_t as written: the timestamp, ref_params_t (232 bytes), usercmd_t (52), movevars_t (132), view, model. */
const INFO = 436;
const SEQUENCES = 28;

/** A demo read (the module's head). Throws when it is not a GoldSrc demo. */
export function readDemo(bytes) {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
  if (b.toString("latin1", 0, 6) !== "HLDEMO") throw new Error("readDemo: not a GoldSrc demo (no HLDEMO)");
  const text = (at, length) => {
    const raw = b.subarray(at, at + length);
    const end = raw.indexOf(0);
    return raw.toString("latin1", 0, end < 0 ? length : end);
  };
  const demoProtocol = b.readInt32LE(8);
  const netProtocol = b.readInt32LE(12);
  const map = text(16, 260);
  const gameDir = text(276, 260);
  const directory = b.readInt32LE(540);
  const entries = b.readInt32LE(directory);
  const segments = [];
  for (let k = 0; k < entries; k++) {
    const at = directory + 4 + k * ENTRY;
    segments.push({
      type: b.readInt32LE(at),
      offset: b.readInt32LE(at + 84),
      length: b.readInt32LE(at + 88),
    });
  }
  const frames = [];
  const commands = [];
  const vec = (at) => [b.readFloatLE(at), b.readFloatLE(at + 4), b.readFloatLE(at + 8)];
  for (const segment of segments) {
    let at = segment.offset;
    const end = segment.offset + segment.length;
    while (at + 9 <= Math.min(end, b.length)) {
      const type = b.readUInt8(at);
      const time = b.readFloatLE(at + 1);
      at += 9;
      if (type === 5) break; // the segment's end
      if (type === 0 || type === 1) {
        const ref = at + 4;
        const cmd = ref + 232;
        const mv = cmd + 52;
        frames.push({
          time,
          frametime: b.readFloatLE(ref + 60),
          origin: vec(ref + 100),
          velocity: vec(ref + 88),
          onGround: b.readInt32LE(ref + 80) !== 0,
          waterLevel: b.readInt32LE(ref + 84),
          viewHeight: vec(ref + 112),
          viewAngles: vec(ref + 128),
          cmd: {
            msec: b.readUInt8(cmd + 2),
            viewAngles: vec(cmd + 4),
            forward: b.readFloatLE(cmd + 16),
            side: b.readFloatLE(cmd + 20),
            up: b.readFloatLE(cmd + 24),
            buttons: b.readUInt16LE(cmd + 30),
          },
          movevars: {
            gravity: b.readFloatLE(mv),
            stopspeed: b.readFloatLE(mv + 4),
            maxspeed: b.readFloatLE(mv + 8),
            accelerate: b.readFloatLE(mv + 16),
            airaccelerate: b.readFloatLE(mv + 20),
            friction: b.readFloatLE(mv + 28),
            edgefriction: b.readFloatLE(mv + 32),
            entgravity: b.readFloatLE(mv + 40),
            stepsize: b.readFloatLE(mv + 48),
            maxvelocity: b.readFloatLE(mv + 52),
          },
        });
        at += INFO + SEQUENCES;
        at += 4 + b.readInt32LE(at);
      } else if (type === 2) {
        // the playback's start: no fields
      } else if (type === 3) {
        commands.push({ time, command: text(at, 64) });
        at += 64;
      } else if (type === 4) at += 32;
      else if (type === 6) at += 84;
      else if (type === 7) at += 8;
      else if (type === 8) {
        at += 4;
        at += 4 + b.readInt32LE(at) + 16;
      } else if (type === 9) at += 4 + b.readInt32LE(at);
      else
        throw new Error(`readDemo: a frame of type ${type} at byte ${at - 9}, which GoldSrc does not write`);
    }
  }
  return { map, gameDir, demoProtocol, netProtocol, frames, commands };
}
