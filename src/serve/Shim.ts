import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

/**
 * Node's own `execPath` plus the script it was invoked with — the exact
 * binary driving THIS `gtd serve` process, captured once so every shim
 * points at the same running build regardless of what a bare `gtd` on `$PATH`
 * would otherwise resolve to (a different global install, or nothing at
 * all).
 */
export const ownGtdBinary = (): { readonly exec: string; readonly script: string } => ({
  exec: process.execPath,
  script: process.argv[1] ?? "",
})

/** Single-quotes `value` for a POSIX shell, escaping any embedded single quote. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * The shim `gtd` script's own content: execs the captured binary with argv
 * passed through verbatim (never re-parsed by a shell, and never combined
 * into one string) so a bare `gtd check <mode> '<file>'` inside a loop
 * command's emitted script resolves to this exact running build.
 */
export const shimScript = (binary: { readonly exec: string; readonly script: string }): string =>
  `#!/bin/sh\nexec ${shellQuote(binary.exec)} ${shellQuote(binary.script)} "$@"\n`

/**
 * Creates a fresh temp directory containing one executable file named `gtd`.
 * One call per spawn — T1's "two worktrees driven at once each get their own
 * shim, with no crosstalk" is this: a distinct directory per call, never
 * shared or reused across worktrees.
 */
export const createShim = (
  fs: FileSystem.FileSystem,
  binary: { readonly exec: string; readonly script: string } = ownGtdBinary(),
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const dir = yield* fs.makeTempDirectory({ prefix: "gtd-shim-" })
    const path = join(dir, "gtd")
    yield* fs.writeFileString(path, shimScript(binary))
    yield* fs.chmod(path, 0o755)
    return dir
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))
