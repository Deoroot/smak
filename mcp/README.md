# SMAK as an MCP server

SMAK is used by an agent that reads `AGENTS.md` and writes short Node scripts with a shell. This folder is the
same kit for a client that has **no shell**: a [Model Context Protocol](https://modelcontextprotocol.io) server
that Claude Desktop, Claude Code or any other MCP client starts and talks to. The client's model reads the
guide a section at a time, looks at models and maps, and makes or changes them by sending scripts for the
server to run.

It needs Node 18 or later and nothing else: no `npm install`, no SDK. The protocol (JSON-RPC 2.0 over stdin and
stdout, one message a line) is written out in `protocol.mjs`.

## Starting it

```
node mcp/server.mjs --models <folder> --work <folder> [--no-run]
```

|            |                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--models` | The files to work from: a mod's `models` folder, say, or its `maps` folder (or the mod's own folder, for both). Only ever read. May be left out when everything is made from nothing. |
| `--work`   | Where everything made is written (models, pictures, kept scripts). Made when it is not there.                                |
| `--no-run` | Without the tool `run`: the server can then only read, check and draw.                                                       |

A client starts it itself; you only tell it how.

**Claude Desktop**, in `claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "smak": {
      "command": "node",
      "args": [
        "C:/path/to/smak/mcp/server.mjs",
        "--models",
        "C:/Games/Half-Life/ts/models",
        "--work",
        "C:/Users/me/smak-work"
      ]
    }
  }
}
```

**Claude Code:**

```
claude mcp add smak -- node <path>/mcp/server.mjs --models <dir> --work <dir>
```

## The warning about `run`

**`run` runs whatever code the client's model sends, on your machine, as you.** It is Node with no sandbox: the
script can read and write any file you can and reach the network. Nothing holds it inside the two folders; the
tool's description asks the model to write to the work folder only, and that is a request, not a wall. Start
the server with `run` only for a model and a conversation you would hand a shell to. With `--no-run` the server
never writes or runs anything: it lists, describes, checks and draws.

Every other tool takes a file only from inside `--models` or `--work`, and refuses anything else in words.

## The tools

Few on purpose: a client is sent every tool's description in every conversation (about 1100 tokens for all
six, maps included), so the long guidance stays behind `guide` and is read only when a task needs it.

| Tool     | What it does                                                                                                                                                      | Arguments                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guide`  | The kit's guide (`AGENTS.md` and the guides it sends to for models: `docs/COMMANDS.md`, `MODELS.md`, `RESKIN.md`, `SHAPES.md`, `TROUBLE.md`), cut at its headings when asked. With nothing: the list of sections, a line each, and the table of what the kit can and cannot do.  | `topic` (section numbers `"12,20"`, or words of one title), `doc` (`"api"`, `"engines"`, `"maps"`, `"maps-making"`, any other guide of `docs/` by its name in small letters such as `"play"` or `"spec-maps"`, or an example's or a kit's path), `find` (the lines that hold these words) |
| `models` | The files there are: the models folder's `.mdl`, `.bsp`, `.map` and `.wad` files and everything in the work folder, with their sizes.                              | `match`                                                                                                                                                             |
| `info`   | What a model holds: bones, bodies with their body numbers, textures, animations. Of a map (`.bsp`): its size, entities, textures, light; of a `.map` or a `.wad`, what is in it. | `model`, `full` (bone places, events, attachments; a map: every entity with its keys)                                                                               |
| `check`  | The errors and warnings an engine would have with a model or a compiled map; of a `.map`, what its plan has wrong before a compile. With `walk`, a map's walk test: what a player cannot reach on foot, what stands in something solid, the openings. With `against`, a map's entities held against its mod: classes, keys, values, names, the mod's rules. | `model`, `engine` (`goldsrc`, `xash`), `walk`, `goal` (entities to tell the walk to, `"9, keeper"`), `doors` (`open`, `closed`), `against` (files of the folders, with commas: `.fgd` files, what `smak map-learn` wrote, a profile that is a `.json` file; or `goldsrc`. A profile that is a module is code: `run`)                                      |
| `render` | A picture of a model or a map, returned as an image. A map's kinds are `plan` (from above, every entity marked with its pixel), `view` (from inside), `views`, `section` (a side cut along a line), `storeys` (a plan for each storey) and `openings` (a view through each doorway). | `model`, `kind` (`view`, `sheet`, `strip`, `uv`; a map: `plan`, `view`, `views`, `section`, `storeys`, `openings`), `body`, `seq`, `frame`, `side` or `yaw` / `pitch`, `zoom`, `dist`, `first`, `count`, `texture`, `at`, `z`, `from` and `to` (a section's ends, `"x y"`), `heights`, `legend`, `reach` (a plan), `size` |
| `run`    | Runs an ES module with Node in the work folder, with the kit importable. Returns what it printed, the files it wrote, and up to three of its PNG files as images. | `script`, `show`, `timeout` (seconds; 120 unless told, 600 at most), `name` (keep the script as `<name>.mjs`), `edits` (change a kept script in place)              |

A map's `.wad` files are looked for beside it and in the models folder; when that folder is the game's own
(it has `gfx/env` and `sprites`), a view shows the sky's picture and the sprites too. Models in a map's
pictures, jumps in its walk test and a way out named for it are options of the library, used by `run`. Changing a map's entities, making
one from brushes and compiling it go by `run`, as everything that makes or changes does (`guide { doc: "maps" }`
and `"maps-making"`).

A file is named by its path under one of the two folders. `work:pot.mdl` and `models:player/gordon.mdl` say
which; a bare `pot.mdl` is looked for in the work folder first, so that a changed model is found before the one
it was made from.

**Pictures.** A picture costs the model tokens by its area, and the client bytes by its file, so they are small
unless asked: 512 pixels on the longer side for one view or a texture, 768 for a sheet or a strip, 1024 at
most (`size`). They are sent with 32 levels of each colour in place of 256, which more than halves the file
and changes nothing a model is checked for. A picture a script wrote and asked to `show` is treated the same; the file
on the disk is left as the script wrote it.

**Scripts.** There is no tool for each thing the kit does, because building a shape or painting by place takes
functions (a colour for every pixel, a ring for every height), and a function is written in code. A script
imports the kit by name:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paint, check, sheet, png, workshop } from "smak"; // where the guide writes "./smak/src/index.mjs"
import { sword } from "smak/kits/swordkit"; // also "smak/workshop", "smak/src/<module>"

const src = readFileSync(join(process.env.SMAK_MODELS, "player/gordon.mdl")); // the models folder
writeFileSync("out.mdl", src); // the working folder is --work (also process.env.SMAK_WORK)
```

`"smak"` resolves because the server puts a link to the kit at `<work>/node_modules/smak` the first time `run`
is called (a junction on Windows, which needs no administrator's rights; a symbolic link elsewhere). The
script's own file is written to the work folder and removed after the run, unless it was given a `name`; a
named script stays, and a later one can `import "./<name>.mjs"`. A named script is also changed without being
sent again: `run` with its `name` and `edits: [{ old, new }]` (each `old` must be in the script exactly once)
changes it in place and runs it; with the `name` alone it runs as kept. What it prints comes back cut to 6000
characters a stream (its start and its end are kept), without the lines of a stack trace that are inside Node.

## A session

What a person might ask, and the calls a client makes for it.

> Make me a small wooden barrel prop with two iron hoops.

1. `guide` → the list of sections and the table of what the kit can do.
2. `guide { topic: "12,20,7" }` → "A whole new model", "Making a shape", "Conventions".
3. `run { script: "...", show: ["barrel.png"] }` → a script that turns the barrel in the workshop, paints its
   zones, writes `barrel.mdl` with `buildMdl`, prints what `check` says and writes a `sheet`. The answer has
   the printed lines, `written: barrel.mdl (...), barrel.png (...)` and the picture.
4. The picture shows the hoops too thin: `run` again with the script changed.
5. `check { model: "barrel.mdl" }`, then `render { model: "barrel.mdl", side: "below" }` to see the bottom.
6. The client tells the person where `barrel.mdl` is, what `check` said, and shows the picture.

> The security guard in my mod: make his vest dark green, and leave his skin and trousers alone.

1. `models { match: "barney" }`, `info { model: "barney.mdl" }` → the textures and the body numbers.
2. `render { model: "barney.mdl", kind: "sheet" }`, `render { model: "barney.mdl", kind: "uv", texture: "2" }`.
3. `guide { topic: "10,14" }` → "A new texture on an existing model", "Wear, damage and markings by place".
4. `run { script: "...", show: ["after.png"] }` → `paint` by place over the vest, the result written to the work
   folder and drawn from four sides.
5. `check { model: "barney_green.mdl" }`, and the report to the person: the file, what changed, the picture,
   and what the pictures cannot show (the game's own lighting).

## What is where

| File           |                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `server.mjs`   | The entry: the flags, the two folders, the start.                                                   |
| `protocol.mjs` | JSON-RPC over two streams: `initialize`, `ping`, `tools/list`, `tools/call`, and a call taken back. |
| `folders.mjs`  | The rule that a named file is inside `--models` or `--work`.                                        |
| `guide.mjs`    | The guide and the reference cut at their headings, read from the kit's own files each time.         |
| `tools.mjs`    | The tools: their descriptions as a client is told them, and `models`, `info`, `check`, `render`.    |
| `run.mjs`      | The tool `run`: the link to the kit, the child process, its time limit, what it wrote.              |

The cases that start the server and speak to it are in `test/16-mcp.mjs`.
