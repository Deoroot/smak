// One compiler run with its output passing through while it works: `compileMap` starts this file as a
// program of its own when it is asked for `progress`, since a program run and waited for in one call
// (spawnSync) gives what it printed only at its end, and hlvis may work for many minutes.
//
//   node compile-run.mjs <milliseconds> <file to keep the output in> <the program> [its arguments ...]
//
// Everything the program prints goes at once to this one's standard error (the caller's, so a terminal shows
// it as it comes) and into the file, which the caller reads when this ends. It ends with the program's own
// code; with TIMED_OUT when the program was stopped for running longer than the milliseconds given (0: no
// limit); with COULD_NOT_RUN when it could not be started.
import { spawn } from "node:child_process";
import { openSync, writeSync, closeSync } from "node:fs";

/** The codes this program ends with for what is not the compiler's own word (`compileMap` reads them). */
export const TIMED_OUT = 124;
export const COULD_NOT_RUN = 126;

// run only as a program: imported for its two codes, it does nothing
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/compile-run.mjs")) {
  const [limit, keepIn, program, ...args] = process.argv.slice(2);
  const kept = openSync(keepIn, "w");
  const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stopped = false;
  const timer =
    Number(limit) > 0
      ? setTimeout(() => {
          stopped = true;
          child.kill();
        }, Number(limit))
      : null;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      writeSync(kept, chunk);
      process.stderr.write(chunk);
    });
  child.on("error", (error) => {
    writeSync(kept, `\n${error.code ?? error.message}\n`);
    closeSync(kept);
    process.exit(COULD_NOT_RUN);
  });
  child.on("close", (code) => {
    if (timer) clearTimeout(timer);
    closeSync(kept);
    process.exit(stopped ? TIMED_OUT : (code ?? 1));
  });
}
