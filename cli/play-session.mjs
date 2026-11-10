// A session of `play` (cli/play.mjs) kept by one process and used by others: the game is started once, by
// the process that serves, and every run after it pays for its map and not for the engine.
//
//   one terminal:    smak play http://127.0.0.1:8097/?args= --serve --mod <profile> --playwright <folder>
//   any other:       smak play http://127.0.0.1:8098 --attach --map yard --steps steps.json -o work/run1
//                    smak play http://127.0.0.1:8098 --attach --map road --steps more.json -o work/run2
//                    smak play http://127.0.0.1:8098 --attach --close
//
//   import { play } from "./smak/src/index.mjs";
//   const served = await play.serveSession({ session: play.playSession({ driver, mod }), port: 8098 });
//   const run = await play.attachSession(served.address, { map: "yard", steps, out: "work/run1" });
//
// It speaks HTTP on this machine only, with Node's own server and nothing else:
//   GET  /        the session's state: { smak: "play session", up, map, entered, runs, busy }
//   POST /run     a run, as `playSession`'s run takes it, in JSON. The answer is a line of JSON for each
//                 thing done, `{ "tell": "..." }`, as it is done, a `{ "beat": seconds }` every half a minute
//                 while nothing else is said (a fight of ten minutes says nothing until its end), and a last
//                 one: `{ "result": {...} }` or `{ "failure": "the sentence", ... }`. One run at a time: a
//                 second is refused while one goes
//
// A run may be long, and the run's answer is read with node:http and not with fetch: fetch (undici) gives up
// on an answer whose headers, or whose next bytes, take over 300 seconds ("terminated"), while the run goes on
// in the session. The beat keeps any other client that reads it so (curl, a proxy) awake as well.
//   POST /close   the game closed and the server ended
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

/** The port a session is served on unless told. */
export const SESSION_PORT = 8098;
/** Milliseconds between two beats of a run's answer while the run says nothing. */
export const BEAT = 30000;
const NAME = "play session";
const shown = (value) => (value === undefined ? "nothing" : JSON.stringify(value));

/** The whole of what was sent, as text. */
const bodyOf = (request) =>
  new Promise((done, failed) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    request.on("error", failed);
  });

/**
 * A session served: resolves, once the engine is up and the port is listened on, to
 * `{ address, port, close(), closed }`: `closed` is a promise that resolves when the session has ended, by
 * `close()` here or by a `POST /close`.
 *
 *   session   a `playSession`
 *   port      the port (8098); host: the address listened on ("127.0.0.1": this machine only)
 *   tell      a function handed a line for what the server does (a run begun, its end)
 *   beat      milliseconds between the beats of a run's answer while it says nothing (30000)
 */
export async function serveSession({ session, port = SESSION_PORT, host = "127.0.0.1", tell, beat = BEAT } = {}) {
  if (typeof session?.run !== "function" || typeof session.ready !== "function")
    throw new Error("play: session is what playSession gives, with its ready, run and close");
  if (!(Number.isInteger(port) && port > 0 && port < 65536))
    throw new Error(`play: port is a port's number, not ${shown(port)}`);
  if (!(typeof beat === "number" && beat > 0))
    throw new Error(`play: beat is a number of milliseconds over 0, not ${shown(beat)}`);
  let busy = false;
  let ended = null;
  const closed = new Promise((done) => (ended = done));
  const answer = (response, code, value) => {
    response.writeHead(code, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://x").pathname;
    try {
      if (request.method === "GET" && path === "/")
        return answer(response, 200, { smak: NAME, ...session.state, busy });
      if (request.method === "POST" && path === "/close") {
        answer(response, 200, { closed: true });
        return void close();
      }
      if (!(request.method === "POST" && path === "/run"))
        return answer(response, 404, { failure: `a play session has /, /run and /close, not ${path}` });
      if (busy) return answer(response, 409, { failure: "play: the session is in a run: wait for its end" });
      let run;
      try {
        run = JSON.parse(await bodyOf(request));
      } catch (error) {
        return answer(response, 400, { failure: `play: the run sent is not JSON: ${error.message}` });
      }
      busy = true;
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      // the headers now, and not with the first line: a run's first step may be long
      response.flushHeaders();
      const began = Date.now();
      let said = began;
      const line = (value) => {
        said = Date.now();
        response.write(`${JSON.stringify(value)}\n`);
      };
      const beating = setInterval(() => {
        if (Date.now() - said >= beat) line({ beat: Math.round((Date.now() - began) / 1000) });
      }, Math.min(beat, 1000));
      tell?.(
        `run: ${run.stay ? "staying" : `map ${run.map}`}, ${run.steps?.length ?? 0} steps -> ${run.out}`,
      );
      try {
        const {
          lines: _lines,
          log: _log,
          ...result
        } = await session.run({
          ...run,
          tell: (text) => line({ tell: text }),
        });
        line({ result });
        tell?.(`     ${result.passed ? "passed" : "FAILED"} in ${(result.took / 1000).toFixed(1)} s`);
      } catch (error) {
        const { pictures, logFile, sheet, expectations, fights, summary, summaryFile } = error;
        line({ failure: error.message, pictures, logFile, sheet, expectations, fights, summary, summaryFile });
        tell?.(`     ${error.message}`);
      } finally {
        clearInterval(beating);
      }
      busy = false;
      response.end();
    } catch (error) {
      busy = false;
      if (!response.headersSent) answer(response, 500, { failure: error.message });
      else response.end();
    }
  });
  async function close() {
    await new Promise((done) => server.close(done));
    server.closeAllConnections?.();
    await session.close().catch(() => {});
    ended();
  }
  await new Promise((done, failed) => {
    server.once("error", (error) =>
      failed(
        new Error(
          error.code === "EADDRINUSE"
            ? `play: port ${port} is taken: is a session already served there? (--port <n> for another)`
            : `play: the session could not be served on port ${port}: ${error.message}`,
        ),
      ),
    );
    server.listen(port, host, done);
  });
  try {
    await session.ready();
  } catch (error) {
    await new Promise((done) => server.close(done));
    throw error;
  }
  return { address: `http://${host}:${port}`, port, close, closed };
}

/** What a session's address answers, or a refusal that says nothing is served there. */
async function ask(address, path, options) {
  if (!(typeof address === "string" && /^https?:\/\//i.test(address)))
    throw new Error(
      `play: a session's address is where it is served (http://127.0.0.1:${SESSION_PORT}), not ${shown(address)}`,
    );
  try {
    return await fetch(new URL(path, address), options);
  } catch (error) {
    throw new Error(
      `play: no session answers at ${address}: start one with \`smak play <the game's address> --serve\` (${error.cause?.code ?? error.message})`,
      { cause: error },
    );
  }
}

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const textOf = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * A POST whose answer may be long in coming and long: node:http, with no time it gives up at (fetch's
 * undici gives up at 300 seconds of silence). Resolves to the answer, a stream, once its headers are in.
 */
async function posted(address, path, body) {
  const url = new URL(path, address);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((done, failed) => {
    const asked = send(url, { method: "POST", headers: { "content-type": "application/json" } }, done);
    asked.on("error", (error) =>
      failed(new Error(`play: the session at ${address} went away during the run (${error.code ?? error.message})`, { cause: error })), // prettier-ignore
    );
    asked.end(body);
  });
}

/** A session's state: `{ up, map, entered, runs, busy }`. */
export async function sessionState(address) {
  const state = await (await ask(address, "/")).json().catch(() => null);
  if (state?.smak !== NAME) throw new Error(`play: what answers at ${address} is no play session`);
  return state;
}

/** A session closed: its game ended and its port let go. */
export async function closeSession(address) {
  await ask(address, "/close", { method: "POST" });
}

/**
 * A run done in a session served elsewhere: resolves to the run's result (as `playSession`'s run, without
 * `lines` and `log`: they are in its files), or throws what the run threw, with `pictures`, `logFile`,
 * `sheet` and `expectations` on the error.
 *
 *   address   where the session is served
 *   run       `{ map, stay, steps, out, expect, expectNot, put, over, loads, pause, sheet }`; `out`, the
 *             files of `put` and the folders of `over` are taken from this process's folder, whatever folder
 *             the session was started in
 *   tell      a function handed each line as the session does a thing
 */
export async function attachSession(address, run = {}, { tell } = {}) {
  await sessionState(address);
  const sent = {
    ...run,
    out: typeof run.out === "string" ? resolve(run.out) : run.out,
    put: (run.put ?? []).map((each) => (each?.file ? { ...each, file: resolve(each.file) } : each)),
    ...(run.over ? { over: [run.over].flat().map((each) => (typeof each?.folder === "string" ? { ...each, folder: resolve(each.folder) } : each)) } : {}), // prettier-ignore
  };
  const response = await posted(address, "/run", JSON.stringify(sent));
  if (response.statusCode !== 200) {
    const said = await textOf(response);
    throw new Error(parsed(said)?.failure ?? "play: the run was refused");
  }
  let last = null;
  let kept = "";
  const take = (text) => {
    const told = JSON.parse(text);
    if (told.tell !== undefined) tell?.(told.tell);
    else if (told.beat === undefined) last = told;
  };
  const decoder = new TextDecoder();
  try {
    for await (const chunk of response) {
      const lines = (kept + decoder.decode(chunk, { stream: true })).split("\n");
      kept = lines.pop();
      for (const each of lines) if (each.trim()) take(each);
    }
  } catch (error) {
    throw new Error(`play: the session at ${address} went away during the run (${error.code ?? error.message})`, { cause: error }); // prettier-ignore
  }
  if (kept.trim()) take(kept);
  if (last?.result) return last.result;
  const { failure, ...rest } = last ?? {};
  throw Object.assign(new Error(failure ?? "play: the session ended before the run did"), rest);
}
