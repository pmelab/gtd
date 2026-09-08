import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

/** One shim's own exec target: a program to run, plus its own leading argv (BEFORE the shim's own passed-through `"$@"`). A worktree's own `node_modules/.bin/gtd` is directly executable on its own (`args: []`); the server's own running build needs `node <script>` (`args: [script]`) since `process.execPath` is the interpreter, not the entry point. */
export interface ShimTarget {
  readonly exec: string
  readonly args: readonly string[]
}

/**
 * Node's own `execPath` plus the script it was invoked with — the exact
 * binary driving THIS `gtd serve` process. Captured once so a worktree with
 * NO local `@pmelab/gtd` install of its own still gets a working shim
 * (`createShim`'s own default fallback), regardless of what a bare `gtd` on
 * `$PATH` would otherwise resolve to (a different global install, or
 * nothing at all).
 */
export const ownGtdBinary = (): ShimTarget => ({
  exec: process.execPath,
  args: [process.argv[1] ?? ""],
})

/** Single-quotes `value` for a POSIX shell, escaping any embedded single quote. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * The shim `gtd` script's own content: execs `target.exec` with
 * `target.args` then argv passed through verbatim (never re-parsed by a
 * shell, and never combined into one string) so a bare `gtd check <mode>
 * '<file>'` inside a loop command's emitted script resolves to exactly the
 * binary `target` names.
 */
export const shimScript = (target: ShimTarget): string => {
  const argv = [target.exec, ...target.args].map(shellQuote).join(" ")
  return `#!/bin/sh\nexec ${argv} "$@"\n`
}

/**
 * That worktree's own `node_modules/.bin/gtd` when it exists, else
 * `fallback` — mirrors `Beat.ts#liveRunInWorktree`'s own `$PATH` precedence
 * (`<cwd>/node_modules/.bin` prepended ahead of the inherited `$PATH`) for
 * exactly the same reason: a worktree pinned to a DIFFERENT `@pmelab/gtd`
 * version (`readLocalGtdVersionAt` already reads that version for the beat)
 * must have that same version drive its `gtd check`/`gtd land` calls too —
 * not the server's own running build, which the earlier shape of this
 * module always used unconditionally. A stat failure for any reason (no
 * permission, a `node_modules` that's a broken symlink, …) reads as "no
 * local install" and falls back, same as a plain miss — resolving which
 * binary drives a loop is never worth failing the whole spawn over.
 */
const resolveShimTarget = (
  fs: FileSystem.FileSystem,
  worktreePath: string,
  fallback: ShimTarget,
): Effect.Effect<ShimTarget> =>
  Effect.gen(function* () {
    const localGtd = join(worktreePath, "node_modules/.bin/gtd")
    const hasLocalGtd = yield* fs.exists(localGtd).pipe(Effect.orElseSucceed(() => false))
    return hasLocalGtd ? { exec: localGtd, args: [] } : fallback
  })

/**
 * Creates a fresh temp directory containing one executable file named `gtd`,
 * resolved to `worktreePath`'s own local install when it has one (see
 * `resolveShimTarget`), else `fallback` (the server's own running build by
 * default). One call per spawn: two worktrees driven at once each get their
 * own directory, with no crosstalk — never shared or reused across
 * worktrees.
 */
export const createShim = (
  fs: FileSystem.FileSystem,
  worktreePath: string,
  fallback: ShimTarget = ownGtdBinary(),
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const target = yield* resolveShimTarget(fs, worktreePath, fallback)
    const dir = yield* fs.makeTempDirectory({ prefix: "gtd-shim-" })
    const path = join(dir, "gtd")
    yield* fs.writeFileString(path, shimScript(target))
    yield* fs.chmod(path, 0o755)
    return dir
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))
