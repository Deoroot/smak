// The Model Context Protocol, as much of it as a server of tools needs, by hand: JSON-RPC 2.0 messages, one
// a line, read from one stream and answered on another (the "stdio transport"). Nothing here knows about
// models: `serve` is handed the tools and calls them.
//
// What is answered: initialize, ping, tools/list and tools/call; the notifications a client sends
// (notifications/initialized, notifications/cancelled) are taken and not answered, as the protocol asks.
// A tool that throws is not a fault of the protocol: its message goes back as an ordinary result marked
// `isError`, so that the model that called it reads what went wrong.
import { createInterface } from "node:readline";

/** The versions of the protocol this server speaks, the newest first. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** JSON-RPC's numbers for what can be wrong with a message. */
export const ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
};

/** A piece of a tool's result: words. */
export const text = (words) => ({ type: "text", text: String(words) });

/** A piece of a tool's result: a picture, from the bytes of a PNG file. */
export const image = (pngBytes) => ({
  type: "image",
  data: Buffer.from(pngBytes).toString("base64"),
  mimeType: "image/png",
});

/** What a call that the client took back is answered with inside this file: nothing is sent for it. */
const TAKEN_BACK = Symbol("taken back");

/** An error a tool throws to say that it is the request that is wrong (an unknown tool), not the work. */
const protocolError = (code, message) => Object.assign(new Error(message), { code });

/**
 * Serves `tools` over two streams until the first one ends; the promise it returns is kept when the last
 * call has been answered.
 *   input, output  the streams (process.stdin and process.stdout)
 *   serverInfo     { name, version }, told to the client when it says hello
 *   instructions   a line or two the client may show its model beside the tools
 *   tools          [{ name, description, inputSchema, call }]. `call(args, { signal })` returns the pieces of
 *                  its result (see `text` and `image`), or { content, isError }; it may wait. `signal` is
 *                  aborted when the client takes the request back
 *   log            where a line about something odd is written (never the output stream)
 * Calls of tools are run one after another, in the order they came; everything else is answered at once.
 */
export function serve({ input, output, serverInfo, instructions, tools, log = () => {} }) {
  const send = (message) => output.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const sendError = (id, code, message) => send({ id, error: { code, message } });
  // the calls of tools still to be answered, by the request's id: each can be taken back
  const running = new Map();
  let lastCall = Promise.resolve();

  /** One tool called: its result as the protocol wants it. */
  const callTool = async ({ name, arguments: args = {} } = {}, signal) => {
    const tool = tools.find((one) => one.name === name);
    if (!tool) throw protocolError(ERROR.invalidParams, `no tool ${name}`);
    try {
      const made = await tool.call(args ?? {}, { signal });
      return Array.isArray(made) ? { content: made } : made;
    } catch (error) {
      return { content: [text(error?.message ?? error)], isError: true };
    }
  };

  // what each request is answered with; a function here may wait
  const METHODS = {
    initialize: ({ protocolVersion } = {}) => ({
      protocolVersion: PROTOCOL_VERSIONS.includes(protocolVersion) ? protocolVersion : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo,
      ...(instructions ? { instructions } : {}),
    }),
    ping: () => ({}),
    "tools/list": () => ({
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }),
    "tools/call": (params, id) => {
      const stop = new AbortController();
      running.set(id, stop);
      const answer = lastCall.then(() => callTool(params, stop.signal));
      // the next call waits for this one, whether it went well or not
      lastCall = answer.catch(() => {}).finally(() => running.delete(id));
      return answer.then((result) => (stop.signal.aborted ? TAKEN_BACK : result));
    },
  };

  /** A message that asks for nothing back. */
  const takeNotification = ({ method, params }) => {
    if (method === "notifications/cancelled") running.get(params?.requestId)?.abort();
  };

  const takeRequest = async ({ id, method, params }) => {
    if (!Object.hasOwn(METHODS, method)) return sendError(id, ERROR.methodNotFound, `no method ${method}`);
    try {
      const result = await METHODS[method](params, id);
      // a request the client took back is not answered
      if (result !== TAKEN_BACK) send({ id, result });
    } catch (error) {
      if (!error.code) log(`smak mcp: ${method}: ${error.stack ?? error}`);
      sendError(id, error.code ?? ERROR.invalidParams, error.message);
    }
  };

  const takeLine = (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return sendError(null, ERROR.parse, `not JSON: ${error.message}`);
    }
    const isObject = message !== null && typeof message === "object" && !Array.isArray(message);
    if (!isObject || message.jsonrpc !== "2.0")
      return sendError(message?.id ?? null, ERROR.invalidRequest, "not a JSON-RPC 2.0 message");
    // an answer to something this server never asks
    if (typeof message.method !== "string") return;
    if (message.id === undefined || message.id === null) return takeNotification(message);
    return takeRequest(message);
  };

  return new Promise((done) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", takeLine);
    lines.on("close", () => lastCall.then(done));
  });
}
