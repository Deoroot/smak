// The two folders the server works in, and the rule every tool keeps to: a file a client names is inside
// one of them, or it is refused in words.
//
//   models  the game's models (or anyone's): only ever read
//   work    where everything made is written, and read back
//
// A name is a path under one of the two. "work:pot.mdl" and "models:player/gordon.mdl" say which; a bare
// "pot.mdl" is looked for in the work folder first, then among the models, so that a model that was changed
// is found before the one it was made from.
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** What a name may begin with to say which folder it is in. */
const PREFIX = /^(work|models):/;
/** A folder that is never listed and never counted as written: where the kit is linked for scripts. */
export const LINK_FOLDER = "node_modules";

/** Whether `path` is `folder` or under it. */
const isInside = (folder, path) => {
  const under = relative(folder, path);
  return !under.startsWith("..") && !isAbsolute(under);
};

/** `path` as it really is on the disk, links followed; a path that is not there yet is left as it is. */
const realOf = (path) => (existsSync(path) ? realpathSync(path) : path);

/**
 * The folders the server was started with: { models (null when none was given), work }, both whole paths.
 * The work folder is made when it is not there; a models folder that is not there is refused.
 */
export function openFolders({ models, work }) {
  if (typeof work !== "string") throw new Error("no work folder: --work <dir>");
  if (models !== undefined && typeof models !== "string") throw new Error("--models <dir>: which folder?");
  mkdirSync(work, { recursive: true });
  if (models && !existsSync(models)) throw new Error(`no such models folder: ${models}`);
  return { models: models ? realpathSync(models) : null, work: realpathSync(work) };
}

/**
 * The whole path of a file a client named, which must be in the work folder, or (unless `write`) among the
 * models. It throws, in words, for a path outside both, and for a file that is to be read and is not there.
 */
export function pathOf(folders, name, { write = false } = {}) {
  if (typeof name !== "string" || !name) throw new Error("a file's name is needed");
  const said = PREFIX.exec(name)?.[1];
  const bare = name.replace(PREFIX, "");
  const roots = [said !== "models" && folders.work, said !== "work" && !write && folders.models].filter(
    Boolean,
  );
  const candidates = roots.map((root) => resolve(root, bare)).filter((path, i) => isInside(roots[i], path));
  // a link inside a folder that leads out of it is outside too
  const allowed = candidates.filter((path) => roots.some((root) => isInside(root, realOf(path))));
  if (!allowed.length)
    throw new Error(
      `${name} is outside the ${write ? "work folder" : "models and work folders"}: refused. Name files by their path under one of them`,
    );
  if (write) return allowed[0];
  const found = allowed.find((path) => existsSync(path) && statSync(path).isFile());
  if (!found) throw new Error(`no such file: ${name} (the tool \`models\` lists what there is)`);
  return found;
}

/**
 * Every file under a folder: [{ name (its path under the folder, with /), bytes, stamp (when it was last
 * written) }], sorted by name. The folder the kit is linked in is left out.
 */
export function filesUnder(folder, under = "") {
  const entries = readdirSync(join(folder, under), { withFileTypes: true });
  const files = entries.flatMap((entry) => {
    const name = under ? `${under}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return entry.name === LINK_FOLDER ? [] : filesUnder(folder, name);
    if (!entry.isFile()) return [];
    const stat = statSync(join(folder, name));
    return [{ name, bytes: stat.size, stamp: stat.mtimeMs }];
  });
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
