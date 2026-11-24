// A file checked out of git without Git LFS is a few lines of text in place of the file. The readers of
// maps, textures and models say so, instead of a format error (the Hive remaster: 4 maps installed as these).

const POINTER = "version https://git-lfs";

/** Throws, in words, when `bytes` are a Git LFS pointer and not the file they stand for. */
export function refuseLfsPointer(bytes) {
  if (bytes.length < 1024 && String.fromCharCode(...bytes.subarray(0, POINTER.length)) === POINTER)
    throw new Error(`a Git LFS pointer of ${bytes.length} bytes, not the file it stands for: run git lfs pull (or git lfs smudge) in its repository`); // prettier-ignore
}
