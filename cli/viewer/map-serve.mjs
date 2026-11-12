// The map viewer: a page that draws a map in 3D, to be walked through with the mouse and the keys, its
// entities standing as their models with an arrow the way each faces, and the things that stand in a wall,
// float or face a wall marked (scene3d.mjs). It reloads by itself when the file changes, so that a sketch
// drawn in Inkscape, a map saved from J.A.C.K. or one compiled again is seen at once.
//
//   node bin/smak.mjs map-viewer <bsp | map | svg | png> [--game <folder> ...] [--mod <profile>] [--port 8099]
//
// The server reads the map with the kit and hands the page triangles, textures and the lightmaps as
// pictures; the page only draws them, so what it shows is what the kit reads. It listens on this machine only.
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { png } from "../../core/image.mjs";
import { sceneOf3d, sceneTextureRgba } from "../../check/maps/scene3d.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";
export const MAP_VIEWER_PORT = 8099;

/** The newest time any of the files was changed: the page's sign to load the scene again. */
const versionOf = (files) => files.map((file) => { try { return statSync(file).mtimeMs; } catch { return 0; } }).join(":"); // prettier-ignore

/** The z the floors run from and to: a floor is a face that looks up. */
function floorsOf(world) {
  let low = Infinity;
  let high = -Infinity;
  for (const batch of world) {
    if (batch.kind === "tool" || batch.kind === "sky") continue;
    const p = batch.positions;
    for (let at = 0; at < p.length; at += 9) {
      const a = [p[at], p[at + 1], p[at + 2]];
      const b = [p[at + 3], p[at + 4], p[at + 5]];
      const c = [p[at + 6], p[at + 7], p[at + 8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[2] / (Math.hypot(...n) || 1) > 0.7) {
        low = Math.min(low, a[2], b[2], c[2]);
        high = Math.max(high, a[2], b[2], c[2]);
      }
    }
  }
  return Number.isFinite(low) ? [low, high] : null;
}

/**
 * The viewer served. `load()` gives the map (a compiled map or brush source) as it is now; `files` are those
 * watched for a change; `options` go to `sceneOf3d` (folders, mod). Resolves with the server once it listens.
 */
export function serveMapViewer({
  load,
  files,
  name,
  options = {},
  port = MAP_VIEWER_PORT,
  say = console.log,
}) {
  let kept = null;
  const current = () => {
    const version = versionOf(files);
    if (kept?.version === version) return kept;
    try {
      const scene = sceneOf3d(load(), options);
      const triangles = [...scene.world, ...scene.things.flatMap((thing) => thing.batches)].reduce((sum, batch) => sum + batch.positions.length / 9, 0); // prettier-ignore
      const json = JSON.stringify({
        name,
        version,
        compiled: scene.compiled,
        triangles,
        bounds: scene.bounds,
        floors: floorsOf(scene.world),
        world: scene.world,
        things: scene.things,
        textures: scene.textures.map(({ name: textureName, width, height }) => ({
          name: textureName,
          width,
          height,
        })),
        lightmap: Boolean(scene.lightmap),
        notes: scene.notes,
      });
      kept = { version, scene, json, pictures: new Map() };
      const warned = scene.things.filter((thing) => thing.props?.warnings.length).length;
      const noted = scene.things.filter(
        (thing) => thing.props?.notes.length && !thing.props.warnings.length,
      ).length;
      say(
        `      ${name}: ${triangles} triangles, ${scene.things.length} entities, ${warned} with a warning, ${noted} with a note`,
      );
    } catch (error) {
      kept = { version, error: error.message };
      say(`      ${name}: ${error.message}`);
    }
    return kept;
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${HOST}`);
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    };
    try {
      if (url.pathname === "/")
        return send(200, "text/html; charset=utf-8", readFileSync(join(HERE, "map.html")));
      if (url.pathname === "/version")
        return send(200, "application/json", JSON.stringify({ version: versionOf(files) }));
      const now = current();
      if (url.pathname === "/scene")
        return send(200, "application/json", now.error ? JSON.stringify({ error: now.error }) : now.json);
      if (now.error) return send(404, "text/plain", now.error);
      let match = /^\/tex\/(\d+)\.png$/.exec(url.pathname);
      if (match) {
        const entry = now.scene.textures[Number(match[1])];
        if (!entry) return send(404, "text/plain", "no such texture");
        if (!now.pictures.has(match[1])) {
          const { width, height, rgba } = sceneTextureRgba(entry);
          now.pictures.set(match[1], png(width, height, rgba));
        }
        return send(200, "image/png", now.pictures.get(match[1]));
      }
      match = /^\/lightmap\.png$/.exec(url.pathname);
      if (match && now.scene.lightmap) {
        if (!now.pictures.has("light")) {
          const { width, height, rgba } = now.scene.lightmap;
          now.pictures.set("light", png(width, height, rgba));
        }
        return send(200, "image/png", now.pictures.get("light"));
      }
      send(404, "text/plain", "not here");
    } catch (error) {
      send(500, "text/plain", error.message);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(error.code === "EADDRINUSE" ? new Error(`port ${port} is taken: --port another`) : error),
    );
    server.listen(port, HOST, () => {
      say(`the map viewer: http://${HOST}:${port}/   (${basename(files[0])}; Ctrl+C stops it)`);
      current();
      resolve(server);
    });
  });
}
