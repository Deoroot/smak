// Working on a model by place: where a point is on the body, not where it is in a picture or which mesh
// holds it. Painting across texture seams, finding and taking off loose pieces, and moving a part from one
// model to another. Each subject is in a module of its own; this one hands them all out, as it always did.
//
//   surface.mjs   surface, spot             the model's surface, and the place on it nearest a point
//   islands.mjs   uvIslands, islandMap      the patches each picture is cut into
//   layers.mjs    layersOf, layerMap        what each pixel of an old picture is, declared by rule
//   paint.mjs     paint                     painting by place, in passes, over layers
//   pieces.mjs    pieces, dropTriangles     loose pieces, and taking triangles off
//   bodies.mjs    graft, copyBody, together, putBody, putRigid, layoutMoved
//                                           whole bodies moved, copied and added
//   carry.mjs     carryPicture              a painted picture carried to a changed shape
//
// What they share and do not hand out is in place-shared.mjs (islands, pixels in triangles), picture.mjs
// (the making of layers) and pixels.mjs.
export * from "./surface.mjs";
export * from "./islands.mjs";
export * from "./layers.mjs";
export * from "./paint.mjs";
export * from "./pieces.mjs";
export * from "./bodies.mjs";
export * from "./carry.mjs";
