// The viewer, started on a free port and asked what its page asks: models side by side in the browser. No browser
// is needed: the page's requests are made here.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { testAsync, sure, tmp, apiCaller, quietly, knife } from "./helper.mjs";

// ── the viewer ──

await testAsync("the viewer serves the models it is given", "the viewer", async () => {
  const { view } = await import("../cli/viewer/serve.mjs");

  // three files in the temp folder. A model's textures may be kept in a file named <model>t.mdl: beside
  // knife.mdl, knifet.mdl is taken for that; desert.mdl ends in t too, but there is no "deser.mdl"
  writeFileSync(join(tmp, "knife.mdl"), knife.mdl);
  writeFileSync(join(tmp, "knifet.mdl"), knife.mdl);
  writeFileSync(join(tmp, "desert.mdl"), knife.mdl);

  // the server prints its address when it starts: that is kept off the test's output
  const server = await quietly(() => view([tmp], 0));
  const address = `http://127.0.0.1:${server.address().port}`;
  const get = (path) => fetch(address + path);
  let model;
  let frame;
  let texturePng;
  let page;

  // the server is stopped whatever a request does
  try {
    const models = await (await get("/api/models")).json();
    sure(
      models.some((listed) => listed.name === "desert") && !models.some((listed) => listed.name === "knifet"),
      "a name ending in t is listed, another model's texture file is not",
    );

    // everything the page asks for one model: its description, one frame's corners, a texture, the page
    const id = encodeURIComponent(models.find((listed) => listed.name === "knife").id);
    model = await (await get(`/api/model?id=${id}`)).json();
    frame = new Float32Array(await (await get(`/api/frame?id=${id}&seq=1&frame=3`)).arrayBuffer());
    texturePng = Buffer.from(await (await get(`/api/texture?id=${id}&n=0`)).arrayBuffer());
    page = await (await get("/")).text();
  } finally {
    server.close();
  }

  // the texture coordinates come as 6 numbers a triangle, a frame as 18
  sure(
    model.triangles === knife.piece.tris.length &&
      model.sequences.length === 2 &&
      model.uv.length === model.triangles * 6,
    "the model",
  );
  sure(frame.length === model.triangles * 18, "a frame");
  sure(smak.unpng(texturePng).width === 256, "a texture");
  sure(/<canvas/.test(page), "the page");
});
