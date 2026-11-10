// The viewer: a page that shows any two models side by side, turning and playing their animations together.
//
//   node bin/smak.mjs view <folder or model> [more ...] [--port 8098]        then open http://127.0.0.1:8098/
//
// This server reads the .mdl files with the kit and hands the page triangles already posed, frame by frame;
// the page (view.html) only draws them, so what it shows is what the kit reads. Every .mdl under the folders
// given is listed, and a file written later shows up after a reload. It listens on this machine only.
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as smak from "../../src/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// this machine only, and the port unless told
const HOST = "127.0.0.1";
const VIEWER_PORT = 8098;
// a studio model's header: its length in bytes, and where in it the number of textures is written. A model
// with none there keeps them in <name>t.mdl beside it
const HEADER_BYTES = 184;
const TEXTURE_COUNT_AT = 180;
// a texture's flag for "masked": its last colour is a hole
const MASKED = 64;
// what the page is sent of a triangle: for each of its 3 corners a place in the picture (2 numbers), and,
// frame by frame, a point and a normal (3 numbers each)
const UV_PER_TRIANGLE = 6;
const FLOATS_PER_CORNER = 6;
const FLOATS_PER_TRIANGLE = 18;
// how many posed frames of one model are kept before they are all let go
const FRAMES_KEPT = 400;

const withoutMdl = (name) => name.replace(/\.mdl$/i, "");
const round4 = (value) => Math.round(value * 1e4) / 1e4;

/**
 * Every .mdl under a folder, but for the side files of another model beside them: <name>t.mdl (its textures)
 * and <name>01.mdl (its animations).
 */
function modelsUnder(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = new Set(
    entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name.toLowerCase()),
  );
  const isSideFile = (name) => {
    const parts = /^(.+?)(t|\d\d)\.mdl$/i.exec(name);
    return Boolean(parts) && files.has(`${parts[1].toLowerCase()}.mdl`);
  };
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modelsUnder(path);
    return /\.mdl$/i.test(entry.name) && !isSideFile(entry.name) ? [path] : [];
  });
}
/**
 * The models the roots hold, as the page lists them: { id (the root's number, then the path under it), group
 * (what it is listed under), name, file }.
 */
function listModels(roots) {
  return roots.flatMap((root, number) => {
    if (!statSync(root).isDirectory())
      return [
        {
          id: `${number}/${basename(root)}`,
          group: basename(dirname(root)),
          name: withoutMdl(basename(root)),
          file: root,
        },
      ];
    return modelsUnder(root).map((file) => {
      const under = relative(root, file).replace(/\\/g, "/");
      // grouped by the first folder under the root
      const folder = under.includes("/") ? under.split("/")[0] : "";
      const group = !folder ? basename(root) : roots.length > 1 ? `${basename(root)} / ${folder}` : folder;
      return { id: `${number}/${under}`, group, name: withoutMdl(basename(file)), file };
    });
  });
}

/**
 * A model by its id, read and laid out for the page: its triangles put in the order the page draws them (by
 * texture, so that each texture is one run), their places in the picture, and room for its posed frames.
 * Null: no such model. `opened`: the models read before, by id; one is read again only when its file has
 * changed.
 */
function openModel(roots, opened, id) {
  const listed = listModels(roots).find((model) => model.id === id);
  if (!listed) return null;
  const stamp = statSync(listed.file).mtimeMs;
  const kept = opened.get(id);
  if (kept?.stamp === stamp) return kept;
  let src = readFileSync(listed.file);
  // textures kept in the file beside it
  const textureFile = listed.file.replace(/\.mdl$/i, "t.mdl");
  if (src.length > HEADER_BYTES && !src.readInt32LE(TEXTURE_COUNT_AT) && existsSync(textureFile))
    src = smak.withTextures(src, readFileSync(textureFile));
  const info = smak.readMdl(src);
  const seqs = smak.sequences(src);
  const textureNames = info.textures.map((texture) => texture.name);
  const textureOf = (triangle) => (triangle.tex ? textureNames.indexOf(triangle.tex.name) : -1);

  // the triangles in the order the page draws them: by texture, so that each texture is one run
  const triangles = smak.posed(src, { seq: seqs.length ? 0 : null }).tris;
  const order = triangles
    .map((_, i) => i)
    .sort((a, b) => textureOf(triangles[a]) - textureOf(triangles[b]) || a - b);
  // a run: a texture, and which corners of the ordered list wear it
  const runs = [];
  for (const i of order) {
    const texture = textureOf(triangles[i]);
    const last = runs.at(-1);
    if (last?.tex === texture) last.count += 3;
    else runs.push({ tex: texture, start: runs.reduce((sum, run) => sum + run.count, 0), count: 3 });
  }
  // each corner's place in its picture, 0 to 1
  const uv = new Float32Array(order.length * UV_PER_TRIANGLE);
  order.forEach((i, at) =>
    triangles[i].c.forEach((corner, k) => {
      const picture = triangles[i].tex;
      uv[at * UV_PER_TRIANGLE + k * 2] = picture ? corner.u / picture.width : 0;
      uv[at * UV_PER_TRIANGLE + k * 2 + 1] = picture ? corner.v / picture.height : 0;
    }),
  );
  const model = {
    stamp,
    src,
    info,
    seqs,
    order,
    runs,
    uv,
    frames: new Map(),
    bytes: src.length,
    check: smak.check(src, "goldsrc"),
  };
  opened.set(id, model);
  return model;
}
/**
 * A model's triangles at a frame of an animation, in the page's order: a point and a normal for each corner.
 * An animation kept in another file cannot be read: the model is shown at rest.
 */
function posedFrame(model, seq, frame) {
  const key = `${seq}:${frame}`;
  if (model.frames.has(key)) return model.frames.get(key);
  const readable = model.seqs.length && !model.seqs[seq]?.group;
  const triangles = smak.posed(model.src, { seq: readable ? seq : null, frame }).tris;
  const floats = new Float32Array(model.order.length * FLOATS_PER_TRIANGLE);
  model.order.forEach((i, at) =>
    triangles[i].c.forEach((corner, k) => {
      floats.set(corner.p, at * FLOATS_PER_TRIANGLE + k * FLOATS_PER_CORNER);
      floats.set(corner.n, at * FLOATS_PER_TRIANGLE + k * FLOATS_PER_CORNER + 3);
    }),
  );
  if (model.frames.size > FRAMES_KEPT) model.frames.clear();
  model.frames.set(key, floats);
  return floats;
}

// ── what the page asks of one model: each answers { type, body } ───────────
const JSON_TYPE = "application/json";
function describeModel(model) {
  const submodels = model.info.bodyparts.flatMap((bodypart) =>
    bodypart.models.map((submodel) => ({
      part: bodypart.name,
      name: submodel.name,
      points: submodel.numverts,
      triangles: submodel.meshes.reduce((sum, mesh) => sum + mesh.numtris, 0),
    })),
  );
  const described = {
    bytes: model.bytes,
    bones: model.info.bones.length,
    triangles: model.order.length,
    runs: model.runs,
    uv: Array.from(model.uv, round4),
    textures: model.info.textures.map((texture) => ({
      name: texture.name,
      width: texture.width,
      height: texture.height,
      flags: texture.flags,
    })),
    sequences: model.seqs.map((seq) => ({
      name: seq.name,
      frames: seq.frames,
      fps: seq.fps,
      loops: seq.loops,
    })),
    submodels,
    check: model.check,
  };
  return { type: JSON_TYPE, body: JSON.stringify(described) };
}
function texturePicture(model, query) {
  const texture = smak.textureOf(model.src, Number(query.get("n")));
  const holes = Boolean(texture.flags & MASKED);
  return { type: "image/png", body: smak.png(texture.width, texture.height, smak.rgbaOf(texture, holes)) };
}
function frameFloats(model, query) {
  const floats = posedFrame(model, Number(query.get("seq")), Number(query.get("frame")));
  return {
    type: "application/octet-stream",
    body: Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength),
  };
}
// the page asks for each of these with ?id=<model>
const MODEL_CALLS = {
  "/api/model": describeModel,
  "/api/texture": texturePicture,
  "/api/frame": frameFloats,
};

/**
 * Starts the viewer over `roots` (folders, or single .mdl files). Resolves to the server once it listens;
 * rejects when it cannot (the port is taken).
 */
export function view(roots, port = VIEWER_PORT) {
  roots = roots.map((root) => resolve(root));
  const opened = new Map();
  const answer = (req, res) => {
    const send = (type, body) =>
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
    // an address that cannot be read is answered, not thrown: nothing a request holds stops the server
    let url;
    try {
      url = new URL(req.url, "http://x");
    } catch {
      res.writeHead(400).end(`the address ${req.url} cannot be read`);
      return;
    }
    const query = url.searchParams;
    try {
      if (url.pathname === "/")
        return send("text/html; charset=utf-8", readFileSync(join(HERE, "view.html")));
      if (url.pathname === "/api/models") {
        const listed = listModels(roots).map(({ id, group, name }) => ({ id, group, name }));
        return send(JSON_TYPE, JSON.stringify(listed));
      }
      const model = openModel(roots, opened, query.get("id"));
      if (!model) {
        res.writeHead(404).end("no such model");
        return;
      }
      if (!Object.hasOwn(MODEL_CALLS, url.pathname)) {
        res.writeHead(404).end("not found");
        return;
      }
      const made = MODEL_CALLS[url.pathname](model, query);
      send(made.type, made.body);
    } catch (error) {
      res.writeHead(500).end(String(error?.stack ?? error));
    }
  };
  return new Promise((ready, refuse) => {
    const server = createServer(answer);
    server.once("error", refuse);
    server.listen(port, HOST, () => {
      console.log(
        `smak viewer: http://${HOST}:${port}/   (${listModels(roots).length} models; Ctrl+C stops it)`,
      );
      ready(server);
    });
  });
}
