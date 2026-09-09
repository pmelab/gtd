import { realpathSync } from "node:fs"
import { dirname, relative, resolve, sep } from "node:path"

/**
 * `realpathSync`'s ancestor for `path` — walks up until it finds a segment
 * that actually exists, `realpath`s THAT, then re-appends the tail
 * unresolved. A leaf that doesn't exist yet (a file about to be written, a
 * name mid-typo) must never turn into an `ENOENT` throw here: the candidate
 * is real up to whichever ancestor exists, and the parts that don't exist
 * yet can't hide a symlink anyway. Any OTHER `realpath` failure (`EACCES`,
 * `ELOOP`, …) propagates — `resolveWithinRoot` below treats that as a
 * refusal, never as "assume it's fine".
 */
const realpathExistingAncestor = (path: string): string => {
  try {
    return realpathSync(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
    const parent = dirname(path)
    if (parent === path) throw e
    const tail = relative(parent, path)
    return resolve(realpathExistingAncestor(parent), tail)
  }
}

/**
 * Resolves a client-supplied `filePath`/`path` against the served
 * worktree's root, refusing (returning `undefined`) whenever the result
 * would land outside it — `../../../etc/passwd`, an absolute path that
 * ignores `root` entirely (`path.resolve`'s own documented behaviour for a
 * second, absolute argument), any relative path whose `..` segments walk
 * past `root`, OR a symlink anywhere in `candidate`'s ancestry (including
 * one INSIDE `root`) whose real target lands outside it. Worktrees are
 * agent-writable, so a symlink pointing outside the tree it's served from is
 * a plausible attack, not a hypothetical: neither the string containment
 * check below nor a plain `join` sees through it, only `realpath` does.
 *
 * `root` itself is realpath'd too — a worktree reached through a symlinked
 * parent directory (common: `~/worktrees/foo -> /var/somewhere/foo`) must
 * not refuse its OWN files just because `root`'s literal path isn't the one
 * `candidate`'s realpath resolves through.
 *
 * The containment test compares PATH SEGMENTS against `root`, never a raw
 * string prefix (`rel.startsWith("..")`): a file legitimately named `..foo`
 * resolves to a relative path of `..foo`, which a string-prefix test
 * misreads as "walks above root" and wrongly refuses. Comparing
 * `rel.split(sep)`'s first segment against exactly `".."` accepts `..foo`
 * (whose first segment is `..foo`, not `..`) while still refusing `../x`
 * (whose first segment IS `..`).
 */
export const resolveWithinRoot = (root: string, relativePath: string): string | undefined => {
  const resolvedRoot = resolve(root)
  const candidate = resolve(resolvedRoot, relativePath)
  try {
    const realRoot = realpathExistingAncestor(resolvedRoot)
    const realCandidate = realpathExistingAncestor(candidate)
    const rel = relative(realRoot, realCandidate)
    const firstSegment = rel.split(sep)[0]
    return rel === "" || firstSegment !== ".." ? candidate : undefined
  } catch {
    return undefined
  }
}
