import { relative, resolve } from "node:path"

/**
 * Resolves a client-supplied `filePath`/`path` against the served
 * worktree's root, refusing (returning `undefined`) whenever the result
 * would land outside it — `../../../etc/passwd`, an absolute path that
 * ignores `root` entirely (`path.resolve`'s own documented behaviour for a
 * second, absolute argument), or any relative path whose `..` segments walk
 * past `root`. The confirmed path-injection defect `worktreePath` leaving
 * every procedure input was meant to close: a client can no longer NAME the
 * worktree, but `filePath`/`path` are still client strings, and a plain
 * `join` never refuses a path that escapes through them.
 */
export const resolveWithinRoot = (root: string, relativePath: string): string | undefined => {
  const resolvedRoot = resolve(root)
  const candidate = resolve(resolvedRoot, relativePath)
  const rel = relative(resolvedRoot, candidate)
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")) ? candidate : undefined
}
