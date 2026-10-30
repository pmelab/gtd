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
  /** Carried by every scratch or temp file name, so concurrent gtd runs never share one. */
  readonly pid: number
  /** `undefined` where the platform has no POSIX user ids. */
  readonly uid: number | undefined
  /** The command that runs this gtd again: its script under the running runtime, or `gtd` off `PATH` when there is none. */
  readonly self: readonly [string, ...string[]]
  /** Standard input read to its end, as UTF-8. */
  readonly stdin: Effect.Effect<string, Error>
}

/** The output half of the process's stdio, which the CLI writes before any layer is built. */
export interface Stdio {
  readonly stdout: (chunk: string | Uint8Array) => void
  readonly stderr: (chunk: string) => void
  readonly exit: (code: number) => void
}

/** The slice of Node's `process` the live host reads; a contract test hands in a fake one. */
export type NodeProcess = Pick<
  NodeJS.Process,
  "argv" | "execPath" | "pid" | "getuid" | "stdin" | "stdout" | "stderr" | "exitCode"
>

type HostOpsInput = Pick<HostOps, "root" | "home" | "env"> & Partial<HostOps>

/** `TMPDIR` when set and non-empty, else the host's own `fallback`. */
export const scratchDirOf = (env: HostOps["env"], fallback: string): string => {
  const dir = env["TMPDIR"]
  return dir !== undefined && dir.length > 0 ? dir : fallback
}

const readAll = (stream: AsyncIterable<Buffer | string>): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      return Buffer.concat(chunks).toString("utf8")
    },
    catch: toError,
  })

const makeHostOps = (opts: HostOpsInput, proc: NodeProcess): HostOps => {
  const script = proc.argv[1]
  return {
    scratchDir: scratchDirOf(opts.env, tmpdir()),
    realPath: (path: string) => Effect.try({ try: () => realpathSync(path), catch: toError }),
    pid: proc.pid,
    uid: proc.getuid?.(),
    self: script === undefined ? ["gtd"] : [proc.execPath, script],
    // Lazy: touching `process.stdin` opens it, which the LSP and the pin hand-over must not see.
    stdin: Effect.suspend(() => readAll(proc.stdin)),
    ...opts,
  }
}

export const nodeStdio = (proc: NodeProcess = process): Stdio => ({
  // `stdout.write` is asynchronous whenever stdout is a pipe or socket —
  // passing a completion callback (and never force-closing, see `exit`
  // below) keeps a queued remainder from being discarded, so a large
  // artifact still reaches a slow reader even after a non-zero exit.
  stdout: (chunk) => {
    proc.stdout.write(chunk, () => {})
  },
  stderr: (chunk) => {
    proc.stderr.write(chunk)
  },
  // Never `process.exit(code)`: that tears the process down out from under
  // an undrained `stdout.write` above and truncates the artifact mid-pipe.
  // Setting `exitCode` lets the event loop drain any queued write first.
  exit: (code) => {
    proc.exitCode = code
  },
})

/** Every member not given in `opts` comes from Node: `proc`, `node:os`, `node:fs`. */
export class Host extends Context.Service<Host, HostOps>()("Host") {
  static layer = (opts: HostOpsInput, proc: NodeProcess = process): Layer.Layer<Host> =>
    Layer.succeed(Host, makeHostOps(opts, proc))
  static Live = Host.layer({ root: process.cwd(), home: homedir(), env: process.env })
}
