import { realpathSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { Context, Effect, Layer } from "effect"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

export interface HostOps {
  readonly root: string
  readonly home: string
  readonly env: Readonly<Record<string, string | undefined>>
  /** `env["TMPDIR"]` when set, `node:os`'s `tmpdir()` otherwise — never a `/tmp` literal or `mktemp` (`tests/tooling/no-tmp-assumption.test.ts` scans for both). */
  readonly scratchDir: string
  /** The real, symlink-resolved form of `path` — used to compare a possibly-symlinked cwd (macOS `/tmp` → `/private/tmp`) against git's own resolution. */
  readonly realPath: (path: string) => Effect.Effect<string, Error>
}

interface HostOpsInput {
  readonly root: string
  readonly home: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly scratchDir?: string
  readonly realPath?: (path: string) => Effect.Effect<string, Error>
}

const makeHostOps = (opts: HostOpsInput): HostOps => ({
  root: opts.root,
  home: opts.home,
  env: opts.env,
  scratchDir:
    opts.scratchDir ??
    (opts.env["TMPDIR"] !== undefined && opts.env["TMPDIR"]!.length > 0
      ? opts.env["TMPDIR"]!
      : tmpdir()),
  realPath:
    opts.realPath ??
    ((path: string) => Effect.try({ try: () => realpathSync(path), catch: toError })),
})

export class Host extends Context.Tag("Host")<Host, HostOps>() {
  static layer = (opts: HostOpsInput): Layer.Layer<Host> => Layer.succeed(Host, makeHostOps(opts))
  static Live = Host.layer({ root: process.cwd(), home: homedir(), env: process.env })
}
